"""
HTTP surface for the AI Insights inbox.

  GET   /api/insights                    — the feed + last engine run heartbeat.
                                           Computes is_locked per distinct
                                           (entity_id, assessment_year) pair in
                                           ONE batched FormBProfile query, wakes
                                           expired snoozes, and — when a woken
                                           insight was computed under an older
                                           TAX_RULES_VERSION — flags it stale and
                                           triggers a SCOPED background engine
                                           re-run for just that (entity, YA,
                                           insight_type) set.
  PATCH /api/insights/{id}/state         — lifecycle transitions (read/dismiss/
                                           snooze/mark-done/restore). Rejects any
                                           mutating action on a locked assessment
                                           year with 423 Locked — defence in
                                           depth behind the UI disable.
  POST  /api/insights/run                — manual engine refresh, runs via
                                           FastAPI BackgroundTasks (202).
  POST  /api/insights/test-data/generate — DEV-ONLY seeded scenario that
                                           triggers all 5 insight types, then
                                           runs the engine synchronously and
                                           returns the generated cards.
                                           Double-gated: 403 outside a
                                           development environment AND 403 for
                                           any entity whose name is not
                                           'test-'-prefixed (sandbox marker).

Scoping follows the same temporary pattern as the document endpoints in
main.py: user_id is a required parameter (no session auth yet), an insight
belonging to someone else 404s exactly like a missing one, and a supplied
entity_id must belong to the requesting user.
"""

import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import models
from models import CapitalAsset, Document, FormBProfile
from database import SessionLocal
from insights.engine import (
    get_locked_year_pairs, is_assessment_year_locked, run_insight_engine,
)
from insights.models import Insight, InsightRun
from insights.schemas import (
    InsightFeedOut, InsightOut, InsightRunRequestOut, InsightStateUpdate,
    serialize_insight, serialize_run,
)
from tax_rules import TAX_RULES_VERSION

router = APIRouter(prefix="/api/insights", tags=["insights"])

SNOOZE_DAYS_DEFAULT = 14

LOCKED_YA_DETAIL = (
    "This Assessment Year has been filed and locked. Its records are frozen "
    "pending a formal amendment to LHDN, so this insight can no longer be changed."
)

# Matches main.py's document storage location so synthetic test files live
# alongside real uploads and preview URLs keep working.
STORAGE_DIR = "./stored_documents"

TEST_ENTITY_PREFIX = "test-"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _verify_entity_owned(db: Session, user_id: int, entity_id: Optional[int]) -> None:
    """Same guard as main.py's — duplicated locally because main.py imports this
    router, so importing back from main would be circular."""
    if entity_id is None:
        return
    entity = db.query(models.Entity).filter(models.Entity.id == entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found.")
    if entity.person_id != user_id:
        raise HTTPException(status_code=403, detail="This entity does not belong to the requesting user.")


def _scoped_insight_or_404(db: Session, insight_id: int, user_id: int) -> Insight:
    insight = db.query(Insight).filter(
        Insight.id == insight_id, Insight.user_id == user_id,
    ).first()
    if not insight:
        raise HTTPException(status_code=404, detail=f"Insight ID {insight_id} not found.")
    return insight


def _wake_expired_snoozes(db: Session, background_tasks: BackgroundTasks,
                          user_id: int, entity_id: Optional[int]) -> None:
    """Wake dismissed insights whose snooze has expired. Version-aware: an
    insight computed under an older TAX_RULES_VERSION must not blindly serve
    its stale figures — it is flagged stale (figures untouched — mutation only
    ever happens inside the engine) and a SCOPED engine re-run is queued for
    just its (entity, assessment_year, insight_type), never a full entity
    re-analysis. The mismatch is logged into that run's InsightRun.logs."""
    now = datetime.now(timezone.utc)
    wake_q = db.query(Insight).filter(
        Insight.user_id == user_id,
        Insight.state == "dismissed",
        Insight.snooze_until.isnot(None),
        Insight.snooze_until <= date.today(),
    )
    if entity_id is not None:
        wake_q = wake_q.filter(Insight.entity_id == entity_id)
    expired = wake_q.all()
    if not expired:
        return

    # (entity_id, assessment_year) → {insight_type, ...} needing re-scoring,
    # plus per-scope log lines describing exactly which cards mismatched.
    rerun_types: dict[tuple[Optional[int], int], set] = {}
    rerun_logs: dict[tuple[Optional[int], int], list] = {}

    for row in expired:
        row.state = "new"
        row.dismiss_reason = None
        row.snooze_until = None
        row.updated_at = now
        if row.rule_version != TAX_RULES_VERSION:
            row.stale = True
            scope = (row.entity_id, row.assessment_year)
            rerun_types.setdefault(scope, set()).add(row.insight_type)
            rerun_logs.setdefault(scope, []).append(
                f"rule version mismatch on snooze wake: insight id={row.id} "
                f"({row.insight_type}, {row.dedupe_key}) was computed under "
                f"'{row.rule_version}' but current is '{TAX_RULES_VERSION}' — "
                f"flagged stale and re-scored via scoped engine re-run."
            )
    db.commit()

    for (ent, ya), types in rerun_types.items():
        background_tasks.add_task(
            run_insight_engine,
            user_id, ent, "stale_wake", SessionLocal,
            assessment_year=ya,
            only_insight_types=sorted(types),
            initial_logs=rerun_logs[(ent, ya)],
        )


@router.get("", response_model=InsightFeedOut)
def get_insights(
    background_tasks: BackgroundTasks,
    user_id:   int           = Query(..., description="Owner of the insights — required so the feed is scoped to one user."),
    entity_id: Optional[int] = Query(default=None, description="Active entity; when supplied, restricts to that entity's insights."),
    db: Session = Depends(get_db),
):
    _verify_entity_owned(db, user_id, entity_id)

    # Wake any snoozes that have expired before building the feed, so a
    # "remind me later" card reappears on schedule even if no engine run
    # happened in the meantime. Rule-version mismatches are flagged stale and
    # queued for a scoped background re-score (see _wake_expired_snoozes).
    _wake_expired_snoozes(db, background_tasks, user_id, entity_id)

    q = db.query(Insight).filter(Insight.user_id == user_id)
    if entity_id is not None:
        q = q.filter(Insight.entity_id == entity_id)
    insights = q.order_by(Insight.created_at.desc(), Insight.id.desc()).all()

    # Tax Amendment Lock visibility: ONE batched query over the distinct
    # (entity_id, assessment_year) pairs in the result set — never a
    # per-insight-row lookup. Uses the exact same lock condition as the
    # engine (insights.engine.is_assessment_year_locked / FormBProfile row
    # existence — profiles only exist for filed returns).
    pairs = {(i.entity_id, i.assessment_year) for i in insights}
    locked_pairs = get_locked_year_pairs(db, user_id, pairs)

    run_q = db.query(InsightRun).filter(InsightRun.user_id == user_id)
    if entity_id is not None:
        run_q = run_q.filter(InsightRun.entity_id == entity_id)
    last_run = run_q.order_by(InsightRun.ran_at.desc(), InsightRun.id.desc()).first()

    return InsightFeedOut(
        insights=[
            serialize_insight(i, is_locked=((i.entity_id, i.assessment_year) in locked_pairs))
            for i in insights
        ],
        lastRun=serialize_run(last_run) if last_run else None,
    )


@router.patch("/{insight_id}/state", response_model=InsightOut)
def update_insight_state(
    insight_id: int,
    payload: InsightStateUpdate,
    user_id: int = Query(..., description="Owner of the insight."),
    db: Session = Depends(get_db),
):
    insight = _scoped_insight_or_404(db, insight_id, user_id)
    now = datetime.now(timezone.utc)

    # Tax Amendment Lock — defence in depth behind the UI disable: even if a
    # client sends the request anyway, a locked assessment year rejects every
    # lifecycle mutation. Sole exception: marking an unread card as read (a
    # view receipt, not a change to the year's records).
    ya_locked = is_assessment_year_locked(db, user_id, insight.entity_id, insight.assessment_year)
    if ya_locked and not (payload.state == "read" and insight.state == "new"):
        raise HTTPException(status_code=423, detail=LOCKED_YA_DETAIL)

    if payload.state == "dismissed":
        insight.state = "dismissed"
        insight.dismiss_reason = payload.dismissReason or "Dismissed"
        insight.resolved_note = None
        if payload.snoozeUntil is not None:
            insight.snooze_until = payload.snoozeUntil
        elif payload.dismissReason and "snooze" in payload.dismissReason.lower():
            # "Snoozed for 2 weeks" / "Remind me later" semantics
            insight.snooze_until = date.today() + timedelta(days=SNOOZE_DAYS_DEFAULT)
        elif payload.dismissReason and "this year" in payload.dismissReason.lower():
            # "Not relevant this year" — hidden until 1 Jan after the insight's
            # assessment year (its tax year, not the calendar year of dismissal)
            base_year = insight.assessment_year or date.today().year
            insight.snooze_until = date(base_year + 1, 1, 1)
        else:
            insight.snooze_until = None

    elif payload.state == "actioned":
        insight.state = "actioned"
        insight.resolved_note = payload.resolvedNote or "Marked as done by you."
        insight.dismiss_reason = None
        insight.snooze_until = None

    else:  # "new" | "read" — includes "restore to inbox"
        insight.state = payload.state
        insight.dismiss_reason = None
        insight.resolved_note = None
        insight.snooze_until = None

    insight.updated_at = now
    db.commit()
    db.refresh(insight)
    return serialize_insight(insight, is_locked=ya_locked)


@router.post("/run", status_code=202, response_model=InsightRunRequestOut)
def trigger_insight_run(
    background_tasks: BackgroundTasks,
    user_id:   int           = Query(..., description="User to recompute insights for."),
    entity_id: Optional[int] = Query(default=None),
    assessment_year: Optional[int] = Query(
        default=None, ge=2000, le=2100,
        description="Assessment year to recompute. Omitted → the current year "
                    "(the engine's default) — pass explicitly to refresh a "
                    "prior year's feed.",
    ),
    db: Session = Depends(get_db),
):
    """Manual refresh. The engine runs after the response is sent (FastAPI
    BackgroundTasks) with its own DB session — the request never blocks on
    rule evaluation or the digest's Gemini call."""
    _verify_entity_owned(db, user_id, entity_id)
    background_tasks.add_task(
        run_insight_engine, user_id, entity_id, "manual_refresh", SessionLocal,
        assessment_year=assessment_year,
    )
    return InsightRunRequestOut(
        message="Insight engine run queued.",
        trigger="manual_refresh",
    )


# ══════════════════════════════════════════════════════════════════════════════
# TEST DOCUMENT GENERATOR — development aid, double safety-gated
# ══════════════════════════════════════════════════════════════════════════════

def _test_data_enabled() -> bool:
    """Environment gate: the generator only exists in development. Set
    ENV=development (or APP_ENV=development / TESTING=true) to enable."""
    env = (os.getenv("ENV") or os.getenv("APP_ENV") or "").strip().lower()
    testing = (os.getenv("TESTING") or "").strip().lower()
    return env in ("development", "dev", "local") or testing in ("1", "true", "yes")


def _write_test_file(label: str) -> tuple[str, str]:
    """Create a small real file on disk so Document.file_path (NOT NULL) points
    at something previewable, exactly like manual-entry documents do."""
    os.makedirs(STORAGE_DIR, exist_ok=True)
    safe_filename = f"{uuid.uuid4().hex}_testdata_{label}.txt"
    safe_file_path = os.path.join(STORAGE_DIR, safe_filename)
    with open(safe_file_path, "w", encoding="utf-8") as fh:
        fh.write(
            f"SYNTHETIC TEST DOCUMENT — {label}\n"
            "Generated by POST /api/insights/test-data/generate.\n"
            "This record exists only in a sandbox entity for insight-engine testing.\n"
        )
    return safe_filename, safe_file_path


@router.post("/test-data/generate", status_code=201)
def generate_test_data(
    assessment_year: int = Query(..., ge=2000, le=2100, description="Target YA for the seeded scenario."),
    user_id:         int = Query(..., description="Owner of the sandbox entity."),
    entity_id:       int = Query(..., description="Sandbox entity (name MUST start with 'test-')."),
    db: Session = Depends(get_db),
):
    """Seed one predefined scenario that triggers all 5 insight types, run the
    engine SYNCHRONOUSLY (test aid — no background task), and return the
    generated insights so the caller verifies all cards in one request.

    Scenario contents:
      • 3 sales invoices totalling RM 80,000            → revenue baseline
      • 4 petrol receipts, no mileage log               → Insight 1 (doc_gap)
      • net profit ≈ RM 66k, ~RM 4k below the 19% band  → Insight 2 (provision)
      • 1 of 3 due CP500 receipts + Q2 bank stmt missing → Insight 3 (deadline)
      • RM 15,000 entertainment = 18.75% of revenue      → Insight 4 (review_pending)
      • lifestyle RM 1,000 / medical RM 500, far below caps → Insight 5 (relief_headroom)
      • prior-YA FormBProfile + a prior-YA capital asset → richer digest/CA context
    """
    # ── Safety gate 1: environment ───────────────────────────────────────────
    if not _test_data_enabled():
        raise HTTPException(
            status_code=403,
            detail="Test data generation is disabled outside development environments. "
                   "Set ENV=development (or TESTING=true) on the server to enable it.",
        )

    # ── Safety gate 2: sandbox entity only ──────────────────────────────────
    entity = db.query(models.Entity).filter(models.Entity.id == entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found.")
    if entity.person_id != user_id:
        raise HTTPException(status_code=403, detail="This entity does not belong to the requesting user.")
    if not (entity.name or "").strip().lower().startswith(TEST_ENTITY_PREFIX):
        raise HTTPException(
            status_code=403,
            detail=f"Test data can only be generated into a sandbox entity whose name "
                   f"starts with '{TEST_ENTITY_PREFIX}' (got: '{entity.name}'). This "
                   f"protects real entities even in shared development databases.",
        )

    # Generating into a locked YA is pointless (the engine would skip it) and
    # a FormBProfile for the target year must never be fabricated — that would
    # lock the year and defeat the test.
    if is_assessment_year_locked(db, user_id, entity_id, assessment_year):
        raise HTTPException(
            status_code=409,
            detail=f"YA {assessment_year} is locked for this entity (filed Form B on "
                   "record) — the engine would skip analysis. Pick an unfiled year.",
        )

    ya = assessment_year
    uid_str = str(user_id)

    def _mk_doc(label: str, file_name: str, document_type: str, category: str,
                tax_status: str, quadrant: Optional[str], amount: Optional[float],
                vendor: str, doc_date: str, role: str, agg: str, **extra) -> Document:
        _, path = _write_test_file(label)
        ed = {
            "is_tax_relevant": True,
            "file_kind": "manual",
            "quadrant": quadrant,
            "ita_section": None,
            "vendor": vendor,
            "date": doc_date,
            "date_precision": "day",
            "date_raw": doc_date,
            "tax_year": str(ya),
            "amount": amount,
            "currency": "MYR",
            "confidence": 95,
            "document_role": role,
            "aggregation_state": agg,
            "note": "Synthetic test document generated by /api/insights/test-data/generate.",
            "test_data": True,
            **extra,
        }
        return Document(
            user_id=uid_str,
            entity_id=entity_id,
            file_name=file_name,
            file_path=path,
            status="completed",
            document_type=document_type,
            category=category,
            tax_status=tax_status,
            year_of_assessment=ya,
            extracted_data=ed,
        )

    docs: list[Document] = []

    # ── Revenue baseline: 3 sales invoices = RM 80,000 ──────────────────────
    for i, (month, amt) in enumerate([(2, 30000.0), (4, 28000.0), (6, 22000.0)], start=1):
        docs.append(_mk_doc(
            f"invoice{i}", f"TEST_Sales_Invoice_{i}_{ya}.txt", "Sales Invoice",
            "Q1 — Sales & Service Revenue", "income", "Q1", amt,
            "Test Client Sdn Bhd", f"{ya:04d}-{month:02d}-10", "transaction", "resolved",
        ))

    # ── Insight 1 trigger: 4 petrol receipts, NO mileage log ────────────────
    for i, month in enumerate((1, 2, 3, 4), start=1):
        docs.append(_mk_doc(
            f"petrol{i}", f"TEST_Petrol_Receipt_{i}_{ya}.txt", "Petrol Receipt",
            "Q3 — Transport & Logistics", "deductible", "Q3", 200.0,
            "Petronas", f"{ya:04d}-{month:02d}-08", "transaction", "resolved",
        ))

    # ── Plain deductible expense (keeps net profit calibrated) ──────────────
    docs.append(_mk_doc(
        "office", f"TEST_Office_Supplies_{ya}.txt", "Supplier Invoice",
        "Q3 — Office & Admin Supplies", "deductible", "Q3", 2000.0,
        "Test Stationery Enterprise", f"{ya:04d}-03-15", "transaction", "resolved",
    ))

    # ── Insight 4 trigger: entertainment at 18.75% of revenue (medium band);
    #    also yields a per-document review_pending card (status: mixed) ──────
    docs.append(_mk_doc(
        "entertainment", f"TEST_Client_Entertainment_{ya}.txt", "Client Entertainment Invoice",
        "Q3 — Client Entertainment (50% cap)", "mixed", "Q3", 15000.0,
        "Grand Banquet Restaurant", f"{ya:04d}-05-20", "transaction", "needs_apportionment",
        reason="Client entertainment is capped at 50% deductibility under s.39(1)(l); the business portion needs confirmation.",
        question="Were these meals exclusively with business clients? Confirm to apply the statutory 50% deduction.",
    ))

    # ── Insight 3 trigger: only 1 CP500 receipt on file (3 due by mid-year) ─
    docs.append(_mk_doc(
        "cp500", f"TEST_CP500_Installment_1_{ya}.txt", "CP500 Installment Notice",
        "Q3 — CP500 / Tax Installment", "not_applicable", "Q3", 1500.0,
        "LHDN", f"{ya:04d}-01-12", "supporting_evidence", "excluded_by_rule",
        installment_amount="1500.00", installment_month="January",
    ))

    # ── Insight 3 trigger: bank statement for Q1 only (Q2 missing) ──────────
    docs.append(_mk_doc(
        "bankstmt", f"TEST_Bank_Statement_Feb_{ya}.txt", "Bank Statement",
        "Bank Statement — Transaction Ledger", "mixed", None, None,
        "Test Bank Berhad", f"{ya:04d}-02-28", "ledger_source", "needs_user_confirmation",
        line_items=[
            {"desc": "TEST CLIENT SDN BHD PAYMENT", "amt": 30000.0, "date": f"{ya:04d}-02-11",
             "direction": "credit", "matchStatus": "matched", "matchedDocumentId": None},
            {"desc": "UNKNOWN TRANSFER IN", "amt": 1200.0, "date": f"{ya:04d}-02-18",
             "direction": "credit", "matchStatus": "unmatched_credit", "matchedDocumentId": None},
        ],
        bank_statement_summary={
            "totalLines": 2, "matchedLines": 1,
            "unmatchedCreditTotalMyr": 1200.0, "unmatchedDebitTotalMyr": 0.0,
        },
    ))

    # ── Insight 5 trigger: relief spend far below caps ───────────────────────
    docs.append(_mk_doc(
        "lifestyle", f"TEST_Lifestyle_Receipt_{ya}.txt", "Lifestyle Purchase Receipt",
        "Q4 — Lifestyle Relief", "relief", "Q4", 1000.0,
        "Test Bookstore", f"{ya:04d}-03-05", "transaction", "resolved",
        relief_cap_myr=2500,
    ))
    docs.append(_mk_doc(
        "medical", f"TEST_Medical_Receipt_{ya}.txt", "Medical Receipt",
        "Q4 — Medical & Parental Care", "relief", "Q4", 500.0,
        "Test Specialist Clinic", f"{ya:04d}-04-22", "transaction", "resolved",
        relief_cap_myr=10000,
    ))

    for d in docs:
        db.add(d)

    # ── Prior-year context: filed Form B (locks ONLY ya-1) + capital asset ──
    formb_created = 0
    prior_ya = ya - 1
    prior_exists = db.query(FormBProfile.id).filter(
        FormBProfile.user_id == uid_str,
        FormBProfile.entity_id == entity_id,
        FormBProfile.year_of_assessment == prior_ya,
    ).first()
    if not prior_exists:
        db.add(FormBProfile(
            user_id=uid_str,
            entity_id=entity_id,
            year_of_assessment=prior_ya,
            source_document_id=None,
            statutory_income_4a=71000.0,
            aggregate_income=71000.0,
            total_business_deductions=9500.0,
            total_personal_reliefs=10500.0,
            chargeable_income=51000.0,
            tax_charged=1960.0,
            tax_payable=1960.0,
            cp500_total_paid=1800.0,
            balance_payable_refundable=160.0,
            raw_extracted={"test_data": True, "note": "Synthetic prior-year Form B for insight testing."},
            confidence=95,
        ))
        formb_created = 1

    ca_created = 0
    if not db.query(CapitalAsset.id).filter(
        CapitalAsset.user_id == uid_str,
        CapitalAsset.entity_id == entity_id,
        CapitalAsset.description == "TEST Laptop (synthetic)",
    ).first():
        db.add(CapitalAsset(
            user_id=uid_str,
            entity_id=entity_id,
            source_document_id=None,
            asset_class="Computer hardware / servers",
            description="TEST Laptop (synthetic)",
            cost=3000.0,
            acquisition_date=date(prior_ya, 6, 1),
            acquisition_year=prior_ya,
            ia_rate_pct=20,
            aa_rate_pct=20,
        ))
        ca_created = 1

    db.commit()

    # ── Run the engine SYNCHRONOUSLY (test aid) and return the cards ────────
    run_insight_engine(
        user_id, entity_id, "test_data_seed", SessionLocal,
        assessment_year=ya,
    )

    generated = db.query(Insight).filter(
        Insight.user_id == user_id,
        Insight.entity_id == entity_id,
        Insight.assessment_year == ya,
    ).order_by(Insight.id.asc()).all()
    types_present = sorted({i.insight_type for i in generated})

    return {
        "message": (
            f"Seeded {len(docs)} synthetic documents into sandbox entity "
            f"'{entity.name}' for YA {ya} and ran the engine synchronously."
        ),
        "assessmentYear": ya,
        "documentsCreated": len(docs),
        "formBProfilesCreated": formb_created,
        "capitalAssetsCreated": ca_created,
        "insightTypesGenerated": types_present,
        "insights": [serialize_insight(i, is_locked=False) for i in generated],
    }
