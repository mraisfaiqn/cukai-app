"""
TaxInsightEngine — the hybrid rule/LLM engine behind the AI Insights inbox.

FIVE CORE INSIGHT TYPES (deterministic, Pipeline A), all localized to LHDN
Form B rules for Malaysian sole proprietors:

  1. doc_gap          — Smart Deduction Tracker: recurring-vendor bill gaps
                        AND missing companion claims (e.g. vehicle/petrol
                        receipts with no mileage-log apportionment on file).
  2. provision        — Dynamic Tax Bracket Projections: monthly set-aside
                        guidance AND bracket-jump proximity warnings with
                        year-end optimisation levers (capital allowance,
                        EPF/PRS top-ups).
  3. deadline         — Proactive Deadline & Compliance: upcoming CP500
                        installments, the statutory Form B deadline (30 June
                        after the YA), missing CP500 payment records, missing
                        quarterly bank statements, and a missing prior-year
                        filed Form B.
  4. review_pending   — Audit Risk Flagging: per-document "needs answer"
                        cards AND deterministic expense-ratio anomaly checks
                        (Entertainment & Gifts / Travel Claims vs gross
                        revenue; >15% medium band, >25% high band).
  5. relief_headroom  — Saving Opportunities: ONE aggregated card summing all
                        unutilized Q4 personal relief headroom with the exact
                        tax saved at the user's marginal rate.

  (+ digest — the only LLM-phrased card, Pipeline B.)

Architecture (mirrors the contract documented in InsightsInbox.jsx):

  PIPELINE A (deterministic) — rules compute every number from the same year
  summary the dashboard already trusts (main.get_tax_profile_summary),
  emitting insight cards with auditable `signals`.
  PIPELINE B (LLM-hybrid) — a single digest card worded by Gemini from
  Pipeline A's computed facts (generated_by='llm').

  THE TWO PIPELINES ARE ISOLATED WITH INDEPENDENT COMMIT POINTS. Pipeline A's
  cards are committed in their own transaction BEFORE Pipeline B ever talks
  to Gemini; a Gemini timeout, rate-limit, or digest-persist failure can only
  ever lose the digest, never the deterministic insights. Each pipeline runs
  inside its own try/except; the InsightRun heartbeat commits last, in a
  third independent write, so the audit trail survives either failure.

  GEMINI BOUNDS + CIRCUIT BREAKER — the Gemini client carries an explicit
  15s HTTP timeout and at most one transient retry. On HTTP 429 /
  ResourceExhausted or a timeout, a process-wide circuit breaker opens for a
  cooldown window: overlapping bulk-upload runs skip the LLM immediately,
  log the skip to InsightRun.logs, and continue with the template digest.

Production-hardening invariants:

  ASSESSMENT-YEAR SCOPING — every run analyses exactly ONE Year of
  Assessment, taken from the triggering document's year_of_assessment, never
  from the calendar date. Dedupe keys carry the YA explicitly:
      u{user_id}:e{entity_id}:ya{assessment_year}:{insight_type}:{sub_key_hash}
  Pre-format rows are migrated by insights/backfill_dedupe_keys.py.

  TAX AMENDMENT LOCK — a YA with a filed Form B on record is FROZEN. The
  single source of truth is is_assessment_year_locked() below (FormBProfile
  row existence — rows are only ever created from uploaded, previously-filed
  returns; kept deliberately, per explicit product decision). The lock is
  checked PER ASSESSMENT YEAR: a batch spanning a locked and an open YA
  triggers separate per-document runs, so only the locked year's analysis is
  skipped — with an InsightRun log entry, never silently.

  CONCURRENCY SAFETY — sessions are tight (open → work → commit → close;
  never held across the LLM call). Writes happen in transactions guarded by
  PostgreSQL advisory transaction locks (pg_advisory_xact_lock on SHA-1
  hashes of the scope and each dedupe_key, acquired in sorted order), which
  serialise writers across threads AND across worker processes. Write
  transactions retry up to 3 times with jittered exponential backoff.

  RULE VERSIONING — every card is stamped with tax_rules.TAX_RULES_VERSION at
  write time. When a snoozed insight wakes under a newer version, the router
  flags it stale and triggers a SCOPED re-run (only_insight_types) so figures
  are recomputed through the normal, auditable path — never mutated in place.

Imports from `main` and `pipeline` are deferred to call time: main.py imports
pipeline.py, pipeline.py invokes this engine, and main.py mounts the insights
router which imports this module — top-level imports in either direction would
be circular. By the time the engine actually runs, both modules are fully
loaded.
"""

import hashlib
import json
import logging
import os
import random
import re
import statistics
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterable, Optional

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.orm import Session

from models import FormBProfile
from insights.models import Insight, InsightRun, InsightRunChange
from tax_rules import TAX_RULES_VERSION

logger = logging.getLogger("uvicorn.error")

# Types this engine owns. Cards of these types that stop being generated are
# auto-resolved (digest excepted — an old digest is history, not a resolved
# problem, so it simply ages out in the feed). formb_missing remains listed
# for legacy rows: its check is now folded into the deadline/compliance rule,
# so old standalone formb_missing cards auto-resolve on the next full run.
ENGINE_MANAGED_TYPES = (
    "deadline", "review_pending", "relief_headroom", "doc_gap",
    "provision", "formb_missing", "digest",
)
AUTO_RESOLVE_TYPES = tuple(t for t in ENGINE_MANAGED_TYPES if t != "digest")

# CP500 installments for individuals run bimonthly across six odd months of
# the year; the engine uses the 15th as the in-month due day for countdown
# purposes. Always cited to s.107B so the user can verify.
CP500_MONTHS = (1, 3, 5, 7, 9, 11)
CP500_DUE_DAY = 15
CP500_LOOKAHEAD_DAYS = 45

# Statutory Form B filing deadline: 30 June of the year following the YA.
FORM_B_DEADLINE_MONTH = 6
FORM_B_DEADLINE_DAY = 30
FORM_B_COUNTDOWN_WINDOW_DAYS = 180   # start counting down ~6 months out
FORM_B_OVERDUE_GRACE_DAYS = 60       # keep showing an overdue card this long

# doc_gap — recurring-vendor detection thresholds
DOC_GAP_MIN_MONTHS_PRESENT = 3
DOC_GAP_MAX_TRAILING_MISSING = 4

# doc_gap — companion-claim detection (Insight 1)
COMPANION_MIN_VEHICLE_RECEIPTS = 3
# Conservative default business-use proportion for a vehicle without a
# mileage log — LHDN disallows unapportioned claims in an audit, so this is
# the qualifying portion "at risk" until a logbook percentage is confirmed.
DEFAULT_VEHICLE_BUSINESS_USE_PCT = 50

# provision — bracket-jump warning (Insight 2)
BRACKET_WARNING_DISTANCE_MYR = 15_000

# review_pending — audit-risk ratio bands (Insight 4). Concrete thresholds:
# medium band above 15% of gross business revenue, high band above 25%.
AUDIT_RATIO_MEDIUM = 0.15
AUDIT_RATIO_HIGH = 0.25
# Band → severity mapping (existing enum; per explicit product decision:
# medium renders as the 'Suggested' tier, high as 'Action needed'). The raw
# band string still lives in the dedupe sub-key and signals.
AUDIT_BAND_SEVERITY = {"medium": "suggested", "high": "action_required"}

AUDIT_RATIO_GROUPS = [
    {
        "label": "Entertainment & Gifts",
        "slug": "entertainment-gifts",
        "categories": {"Q3 — Client Entertainment (50% cap)", "Q3 — Client & Corporate Gifts"},
        "citation": "LHDN audit selection criteria · PR No. 3/2020 (entertainment expenses) · ITA 1967 s.39(1)(l)",
    },
    {
        "label": "Travel Claims",
        "slug": "travel-claims",
        "categories": {"Q3 — Transport & Logistics", "Q3 — Mixed-Use Vehicle Expenses"},
        "citation": "LHDN audit selection criteria · LHDN PR No. 1/2014 (motor vehicle expenses) · ITA 1967 s.33(1)",
    },
]

# relief_headroom — aggregated card (Insight 5)
RELIEF_HEADROOM_MIN_CATEGORY_MYR = 100    # ignore trivial per-category slivers
RELIEF_HEADROOM_MIN_TOTAL_MYR = 500       # emit the card only above this total
RELIEF_HEADROOM_MAX_SIGNAL_LINES = 6

REVIEW_PENDING_MAX_CARDS = 8

# Reopen a dismissed/actioned insight only when its RM impact moved this much.
REOPEN_IMPACT_CHANGE_PCT = 0.15

# Gemini bounds (Pipeline B). Explicit HTTP timeout within the mandated
# 10–15s window; a single transient retry — the circuit breaker below adds
# NO further retries.
GEMINI_TIMEOUT_SECONDS = 15
GEMINI_MAX_RETRIES = 1
GEMINI_CIRCUIT_COOLDOWN_SECONDS = 120

# Write-transaction retry policy
UPSERT_MAX_ATTEMPTS = 3
UPSERT_BACKOFF_BASE_SECONDS = 0.1

_REVIEW_CITATIONS = {
    "Q3 — Client Entertainment (50% cap)": "ITA 1967 s.39(1)(l) · LHDN PR No. 3/2020",
    "Q3 — Client & Corporate Gifts":       "ITA 1967 s.39(1)(l)",
    "Q3 — Mixed-Use Vehicle Expenses":     "ITA 1967 s.33(1) · LHDN PR No. 1/2014",
    "Q3 — Hire Purchase & Leased Assets":  "ITA 1967 s.33 · Schedule 3",
}

_VEHICLE_EXPENSE_CATEGORIES = {"Q3 — Transport & Logistics", "Q3 — Mixed-Use Vehicle Expenses"}
_MILEAGE_EVIDENCE_CATEGORY = "Q3 — Mixed-Use Vehicle Expenses"


# ══════════════════════════════════════════════════════════════════════════════
# TAX AMENDMENT LOCK — single source of truth
# The lock condition is FormBProfile ROW EXISTENCE for (user, entity, YA):
# profiles are only ever created from uploaded, previously-FILED Form B
# returns, so existence means "already submitted to LHDN". Kept deliberately
# (explicit product decision) — revisit ONLY if an in-app draft-Form-B flow
# is ever added, at which point a status flag becomes necessary. Both the
# engine (skip analysis) and the router (is_locked flag + server-side action
# rejection) call THESE functions — the condition is defined exactly once.
# ══════════════════════════════════════════════════════════════════════════════

def is_assessment_year_locked(db: Session, user_id, entity_id: Optional[int],
                              assessment_year: int) -> bool:
    """True when (user, entity, assessment_year) has a filed Form B on record."""
    q = db.query(FormBProfile.id).filter(
        FormBProfile.user_id == str(user_id),
        FormBProfile.year_of_assessment == assessment_year,
    )
    if entity_id is not None:
        q = q.filter(FormBProfile.entity_id == entity_id)
    return bool(db.query(q.exists()).scalar())


def get_locked_year_pairs(db: Session, user_id,
                          pairs: Iterable[tuple[Optional[int], int]]) -> set[tuple[Optional[int], int]]:
    """Batched form of is_assessment_year_locked for the GET feed: one query
    against FormBProfile covering every distinct (entity_id, assessment_year)
    pair, applying the exact same match semantics (entity_id None → any of the
    user's filed returns for that YA locks it; entity_id set → only that
    entity's filed return locks it)."""
    pairs = set(pairs)
    years = {ya for _, ya in pairs if ya is not None}
    if not years:
        return set()
    rows = db.query(FormBProfile.entity_id, FormBProfile.year_of_assessment).filter(
        FormBProfile.user_id == str(user_id),
        FormBProfile.year_of_assessment.in_(years),
    ).all()
    entities_by_year: dict[int, set] = {}
    for ent, ya in rows:
        entities_by_year.setdefault(ya, set()).add(ent)
    locked = set()
    for ent, ya in pairs:
        filed_entities = entities_by_year.get(ya)
        if not filed_entities:
            continue
        if ent is None or ent in filed_entities:
            locked.add((ent, ya))
    return locked


# ══════════════════════════════════════════════════════════════════════════════
# GEMINI CIRCUIT BREAKER (Pipeline B only)
# ══════════════════════════════════════════════════════════════════════════════

_gemini_circuit = {"open_until": 0.0, "reason": ""}
_gemini_circuit_lock = threading.Lock()


def _gemini_circuit_open_reason() -> Optional[str]:
    with _gemini_circuit_lock:
        if time.monotonic() < _gemini_circuit["open_until"]:
            return _gemini_circuit["reason"]
    return None


def _trip_gemini_circuit(reason: str) -> None:
    with _gemini_circuit_lock:
        _gemini_circuit["open_until"] = time.monotonic() + GEMINI_CIRCUIT_COOLDOWN_SECONDS
        _gemini_circuit["reason"] = reason
    logger.warning(
        f"[Insights] Gemini circuit OPEN for {GEMINI_CIRCUIT_COOLDOWN_SECONDS}s: {reason}"
    )


def _is_rate_limit_error(e: Exception) -> bool:
    if type(e).__name__ in ("ResourceExhausted", "TooManyRequests", "RateLimitError"):
        return True
    s = str(e)
    return (
        "429" in s
        or "RESOURCE_EXHAUSTED" in s.upper()
        or "rate limit" in s.lower()
        or "quota" in s.lower()
    )


def _is_timeout_error(e: Exception) -> bool:
    if "Timeout" in type(e).__name__ or "Deadline" in type(e).__name__:
        return True
    s = str(e).lower()
    return "timed out" in s or "timeout" in s or "deadline exceeded" in s


# ── Small pure helpers ────────────────────────────────────────────────────────

def _fmt_rm(value) -> str:
    return f"RM {float(value):,.2f}"


def _slugify(text_value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text_value or "").lower()).strip("-")
    return s[:32] or "unknown"


def _month_str(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _next_month(ym: str) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    return f"{y + 1:04d}-01" if m == 12 else f"{y:04d}-{m + 1:02d}"


def _months_between(start_exclusive: str, end_inclusive: str) -> list[str]:
    """Months strictly after start_exclusive up to and including end_inclusive."""
    months, cur = [], _next_month(start_exclusive)
    while cur <= end_inclusive:
        months.append(cur)
        cur = _next_month(cur)
    return months


def _sub_key_hash(sub_key: str) -> str:
    return hashlib.sha1(sub_key.encode("utf-8")).hexdigest()[:12]


def _advisory_lock_key(value: str) -> int:
    """Map an arbitrary string to a signed 64-bit key for pg_advisory_xact_lock.
    SHA-1 keeps the mapping stable across processes and Python versions
    (unlike hash(), which is salted per process)."""
    digest = hashlib.sha1(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


def build_dedupe_key(user_id: int, entity_id: Optional[int], assessment_year: int,
                     insight_type: str, sub_key: str) -> str:
    """Canonical dedupe key. Shared with the backfill script so old rows are
    migrated to byte-identical keys."""
    ent = entity_id if entity_id is not None else "-"
    return f"u{user_id}:e{ent}:ya{assessment_year}:{insight_type}:{_sub_key_hash(sub_key)}"


class TaxInsightEngine:
    """One run = recompute insights for a single (user, entity,
    assessment_year) scope — optionally restricted to a subset of insight
    types (scoped re-run after a rule-version mismatch). Holds NO long-lived
    session: facts are gathered in one short session, rules and the LLM run
    with no session at all, and each pipeline's writes commit independently
    in fresh, advisory-locked, retried transactions."""

    def __init__(self, session_factory: Callable[[], Session], user_id: int,
                 entity_id: Optional[int], trigger: str,
                 assessment_year: Optional[int] = None,
                 only_insight_types: Optional[Iterable[str]] = None,
                 initial_logs: Optional[list[str]] = None,
                 run_id: Optional[int] = None):
        self.session_factory = session_factory
        self.user_id = user_id            # Integer — matches Person.id
        self.doc_user_id = str(user_id)   # Documents store user_id as String(128)
        self.entity_id = entity_id
        self.trigger = trigger
        self.run_id = run_id
        self.today = date.today()
        # The TAX year under analysis — from the triggering document, never
        # the wall clock. Out-of-range/absent values fall back to the current
        # year, which is also the correct default for manual refresh.
        if assessment_year is not None and 2000 <= int(assessment_year) <= 2100:
            self.ya = int(assessment_year)
        else:
            self.ya = self.today.year
        self.is_current_ya = self.ya == self.today.year
        # Scoped re-run support: when set, only these insight types are
        # recomputed AND housekeeping (wake / auto-resolve) is restricted to
        # them, so a scoped run can never resolve or wake unrelated cards.
        if only_insight_types:
            self.only_types: Optional[frozenset] = frozenset(only_insight_types) & frozenset(ENGINE_MANAGED_TYPES)
        else:
            self.only_types = None
        self.logs: list[str] = list(initial_logs or [])
        # Collected only after successful persistence transactions, then written
        # atomically beside the completed run heartbeat.
        self.change_events: list[dict] = []

    def _type_enabled(self, insight_type: str) -> bool:
        return self.only_types is None or insight_type in self.only_types

    # ── Scoped dedupe key ────────────────────────────────────────────────────
    def _key(self, insight_type: str, sub_key: str) -> str:
        return build_dedupe_key(self.user_id, self.entity_id, self.ya, insight_type, sub_key)

    def _scope_string(self) -> str:
        ent = self.entity_id if self.entity_id is not None else "-"
        return f"u{self.user_id}:e{ent}:ya{self.ya}"

    # ── Phase 1: fact gathering (one short session) ──────────────────────────
    def _gather_facts(self) -> dict:
        """Everything the rules need from the database, collected in a single
        short-lived session that is closed before any LLM call happens."""
        db = self.session_factory()
        try:
            if is_assessment_year_locked(db, self.doc_user_id, self.entity_id, self.ya):
                return {"locked": True, "summary": None, "cy": {}, "prior_formb_exists": False}

            # Reuse the dashboard's own year summary — totals, bracket
            # headroom, pending reviews, CP500 installments, relief caps —
            # instead of re-deriving any of it. Deferred import: see module
            # docstring.
            import main as main_module
            summary = None
            try:
                summary = main_module.get_tax_profile_summary(
                    year=self.ya,
                    user_id=self.doc_user_id,
                    entity_id=self.entity_id,
                    db=db,
                )
            except Exception as e:
                self.logs.append(f"summary load failed: {e}")

            prior_ya = self.ya - 1
            prior_q = db.query(FormBProfile.id).filter(
                FormBProfile.user_id == self.doc_user_id,
                FormBProfile.year_of_assessment == prior_ya,
            )
            if self.entity_id is not None:
                prior_q = prior_q.filter(FormBProfile.entity_id == self.entity_id)
            prior_formb_exists = db.query(prior_q.exists()).scalar()

            return {
                "locked": False,
                "summary": summary,
                "cy": (summary or {}).get("currentYear") or {},
                "prior_formb_exists": bool(prior_formb_exists),
            }
        finally:
            db.close()

    # ── Shared fact extractors (pure, over the year summary) ────────────────
    @staticmethod
    def _marginal_rate_pct(cy: dict) -> Optional[float]:
        """The user's current marginal rate, from the SAME bracket lookup the
        dashboard uses (main._bracket_headroom via the year summary) — never
        reimplemented here."""
        rate = (cy.get("totals") or {}).get("currentMarginalRatePct")
        return float(rate) if rate else None

    @staticmethod
    def _entries_in_categories(cy: dict, categories: set) -> list[dict]:
        """All document entries (resolved deductions AND pending-review items)
        whose category falls in `categories`. The two lists are disjoint by
        aggregation_state, so no amount is ever double counted."""
        out = []
        for entry in cy.get("q3Deductions") or []:
            if entry.get("category") in categories:
                out.append(entry)
        for entry in cy.get("mixedPendingReview") or []:
            if entry.get("category") in categories:
                out.append(entry)
        return out

    # ══════════════════════════════════════════════════════════════════════
    # INSIGHT 3 — deadline: upcoming CP500 installment countdown
    # ══════════════════════════════════════════════════════════════════════
    def _rule_cp500_deadline(self, cy: dict) -> list[dict]:
        installments = cy.get("cp500Installments") or []
        if not installments:
            return []
        n_paid = len(installments)
        if n_paid >= len(CP500_MONTHS):
            return []

        amounts = [float(i.get("installmentAmountNumeric") or 0) for i in installments]
        amounts = [a for a in amounts if a > 0]
        expected = round(statistics.median(amounts), 2) if amounts else None
        total_paid = round(sum(amounts), 2)

        # Due dates belong to the YA under analysis. For a past YA every date
        # has passed, so this rule naturally produces nothing — a backdated
        # receipt can't spawn a phantom deadline.
        upcoming = None
        for m in CP500_MONTHS:
            due = date(self.ya, m, CP500_DUE_DAY)
            if due >= self.today:
                upcoming = due
                break
        if upcoming is None:
            return []
        days_left = (upcoming - self.today).days
        if days_left > CP500_LOOKAHEAD_DAYS:
            return []

        next_no = n_paid + 1
        title = (
            f"CP500 installment #{next_no}"
            + (f" — {_fmt_rm(expected)} due soon" if expected else " due soon")
        )
        body = (
            f"Your next bimonthly tax installment"
            + (f" of {_fmt_rm(expected)}" if expected else "")
            + f" is due around {upcoming.strftime('%d %b %Y')}. You have paid "
            f"{n_paid} installment{'s' if n_paid != 1 else ''}"
            + (f" ({_fmt_rm(total_paid)})" if total_paid else "")
            + f" for YA {self.ya} so far. Missing an installment attracts a 10% "
            "late-payment penalty on the amount due under s.107B."
        )
        signals = [
            {"label": "Installments detected", "value": f"{n_paid} CP500 receipt{'s' if n_paid != 1 else ''} in your vault"},
            {"label": f"Total paid YA{self.ya}", "value": _fmt_rm(total_paid) if total_paid else "—"},
            {"label": "Next installment", "value": f"#{next_no} — due {upcoming.strftime('%d %b %Y')}"},
            {"label": "Typical installment", "value": _fmt_rm(expected) if expected else "Unknown — check your CP500 notice"},
        ]
        return [{
            "insight_type": "deadline",
            "severity": "deadline",
            "generated_by": "rule_template",
            "dedupe_key": self._key("deadline", f"cp500:{upcoming.year:04d}-{upcoming.month:02d}"),
            "title": title,
            "body": body,
            "rm_impact": expected,
            "deadline_date": upcoming,
            "citation": "ITA 1967 s.107B · LHDN CP500 guideline",
            "signals": signals,
            "source_document_ids": [i.get("documentId") for i in installments if i.get("documentId")],
            "action": {"label": "View installment history", "to": "/account"},
        }]

    # ══════════════════════════════════════════════════════════════════════
    # INSIGHT 3 — deadline: Form B statutory countdown + compliance gaps
    # One card per distinct missing requirement (sub-key = missing_item_type).
    # ══════════════════════════════════════════════════════════════════════
    def _rule_deadline_compliance(self, cy: dict, prior_formb_exists: bool) -> list[dict]:
        if (cy.get("documentCount") or 0) == 0:
            return []  # empty year — nothing to remind about yet
        cards: list[dict] = []

        # ── 3a. Statutory Form B filing deadline: 30 June after the YA ──────
        # This engine only runs for UNLOCKED years (a filed Form B skips
        # analysis entirely), so an approaching/overdue deadline here always
        # means "not filed yet".
        filing_deadline = date(self.ya + 1, FORM_B_DEADLINE_MONTH, FORM_B_DEADLINE_DAY)
        days_to_file = (filing_deadline - self.today).days
        if -FORM_B_OVERDUE_GRACE_DAYS <= days_to_file <= FORM_B_COUNTDOWN_WINDOW_DAYS:
            overdue = days_to_file < 0
            if overdue:
                title = f"YA {self.ya} Form B is past the 30 June deadline"
                body = (
                    f"The statutory deadline for filing your YA {self.ya} Form B was "
                    f"{filing_deadline.strftime('%d %b %Y')} and no filed return is on "
                    "record here. Late filing attracts penalties under s.112 ITA 1967 — "
                    "file as soon as possible, or upload your filed Form B if you have "
                    "already submitted it so this record can be closed."
                )
            else:
                title = f"YA {self.ya} Form B due in {days_to_file} day{'s' if days_to_file != 1 else ''}"
                body = (
                    f"Your YA {self.ya} Form B is due by {filing_deadline.strftime('%d %b %Y')} "
                    f"(paper filing; e-Filing typically has a short grace period). "
                    f"{cy.get('documentCount')} document{'s are' if cy.get('documentCount') != 1 else ' is'} "
                    "already classified for this year — resolve any pending review "
                    "questions below so your figures are complete before you file."
                )
            cards.append({
                "insight_type": "deadline",
                "severity": "deadline",
                "generated_by": "rule_template",
                "dedupe_key": self._key("deadline", "form_b_filing"),
                "title": title,
                "body": body,
                "rm_impact": None,
                "deadline_date": filing_deadline,
                "citation": "LHDN Form B filing deadline (s.77 ITA 1967) · s.112 late-filing penalty",
                "signals": [
                    {"label": "Statutory deadline", "value": filing_deadline.strftime("%d %b %Y")},
                    {"label": "Status", "value": "Overdue — no filed return on record" if overdue else f"{days_to_file} days remaining"},
                    {"label": f"Documents classified for YA{self.ya}", "value": str(cy.get("documentCount"))},
                    {"label": "Pending review items", "value": str(cy.get("pendingReviewCount") or 0)},
                ],
                "source_document_ids": [],
                "action": {"label": "Review your year summary", "to": "/overview"},
            })

        # ── 3b. Missing CP500 payment records ───────────────────────────────
        # Only when the user demonstrably IS on the CP500 scheme (≥1 receipt):
        # compare receipts on file against installments already due this YA.
        installments = cy.get("cp500Installments") or []
        if installments:
            expected_due = sum(
                1 for m in CP500_MONTHS if date(self.ya, m, CP500_DUE_DAY) < self.today
            )
            have = len(installments)
            if 0 < have < expected_due:
                shortfall = expected_due - have
                cards.append({
                    "insight_type": "deadline",
                    "severity": "action_required",
                    "generated_by": "rule_template",
                    "dedupe_key": self._key("deadline", "cp500_payment_missing"),
                    "title": f"{shortfall} CP500 payment record{'s' if shortfall != 1 else ''} missing for YA {self.ya}",
                    "body": (
                        f"By now, {expected_due} bimonthly CP500 installments were due for "
                        f"YA {self.ya}, but only {have} payment record{'s are' if have != 1 else ' is'} "
                        "in your vault. If you paid them, upload the receipts so your tax "
                        "position stays reconciled; if you missed them, note that unpaid "
                        "installments attract a 10% late-payment penalty under s.107B."
                    ),
                    "rm_impact": None,
                    "deadline_date": None,
                    "citation": "ITA 1967 s.107B · LHDN CP500 guideline",
                    "signals": [
                        {"label": "Installments due to date", "value": str(expected_due)},
                        {"label": "Payment records on file", "value": str(have)},
                        {"label": "Missing records", "value": str(shortfall)},
                    ],
                    "source_document_ids": [i.get("documentId") for i in installments if i.get("documentId")],
                    "action": {"label": "Upload the missing receipts", "to": "/account"},
                })

        # ── 3c. Missing quarterly business bank statements ───────────────────
        # Only when the user has established the pattern (≥1 bank statement
        # this YA) — one card per fully-ended quarter with no statement, so
        # Docling line-matching reconciliation can complete.
        bank_statements = cy.get("bankStatementReviews") or []
        if bank_statements:
            quarters_present = set()
            for bs in bank_statements:
                d = bs.get("date") or ""
                if re.match(r"^\d{4}-\d{2}", d) and int(d[:4]) == self.ya:
                    quarters_present.add((int(d[5:7]) - 1) // 3 + 1)
            for q in (1, 2, 3, 4):
                quarter_end = date(self.ya, 3 * q, 28)
                if self.today <= quarter_end:
                    continue  # quarter not over yet (or past-YA quarters all qualify)
                if q in quarters_present:
                    continue
                q_months = f"{date(self.ya, 3 * q - 2, 1).strftime('%b')}–{date(self.ya, 3 * q, 1).strftime('%b %Y')}"
                cards.append({
                    "insight_type": "deadline",
                    "severity": "action_required",
                    "generated_by": "rule_template",
                    "dedupe_key": self._key("deadline", f"bank_statement_q{q}_missing"),
                    "title": f"Q{q} {self.ya} bank statement missing",
                    "body": (
                        f"You upload business bank statements, but no statement covering "
                        f"{q_months} is in your vault. Statements are matched line-by-line "
                        "against your invoices and receipts to catch undocumented income "
                        "and missing expense records — this quarter can't be reconciled "
                        "until its statement is uploaded."
                    ),
                    "rm_impact": None,
                    "deadline_date": None,
                    "citation": "LHDN record-keeping requirement (s.82 ITA 1967)",
                    "signals": [
                        {"label": "Missing period", "value": f"Q{q} — {q_months}"},
                        {"label": "Statements on file this YA", "value": str(len(bank_statements))},
                        {"label": "Why it matters", "value": "Line-matching reconciliation incomplete for this quarter"},
                    ],
                    "source_document_ids": [bs.get("documentId") for bs in bank_statements if bs.get("documentId")],
                    "action": {"label": "Upload the statement", "to": "/account"},
                })

        # ── 3d. Prior-year filed Form B missing (folded from the old
        #        standalone formb_missing type) ──────────────────────────────
        if not prior_formb_exists:
            prior_ya = self.ya - 1
            cards.append({
                "insight_type": "deadline",
                "severity": "suggested",
                "generated_by": "rule_template",
                "dedupe_key": self._key("deadline", "prior_formb_missing"),
                "title": f"Upload your filed YA {prior_ya} Form B to unlock smarter insights",
                "body": (
                    f"We do not have your filed YA {prior_ya} Form B. Uploading it gives "
                    "the AI your official prior-year baseline — enabling carry-forward "
                    "tracking, year-on-year comparisons, and more accurate relief suggestions."
                ),
                "rm_impact": None,
                "deadline_date": None,
                "citation": "LHDN Form B (prior-year return)",
                "signals": [
                    {"label": "Prior-year Form B on file", "value": f"None found for YA {prior_ya}"},
                    {"label": "Unlocks", "value": "Carry-forward losses · YoY gaps · relief history"},
                ],
                "source_document_ids": [],
                "action": {"label": "Upload Form B", "to": "/account"},
            })

        return cards

    # ══════════════════════════════════════════════════════════════════════
    # INSIGHT 4 — review_pending: per-document "needs answer" cards
    # ══════════════════════════════════════════════════════════════════════
    def _rule_review_pending_docs(self, cy: dict) -> list[dict]:
        import main as main_module
        pending = cy.get("mixedPendingReview") or []
        cards = []
        for entry in pending[:REVIEW_PENDING_MAX_CARDS]:
            doc_id = entry.get("documentId")
            if not doc_id:
                continue
            amount = float(entry.get("amountNumeric") or 0)
            category = entry.get("category") or ""
            vendor = entry.get("vendor") or entry.get("fileName") or "a document"

            # Blocked value = what is currently EXCLUDED from the user's totals.
            # For apportioned categories with a known statutory/default split,
            # the realistic blocked deduction is pct% of the amount; otherwise
            # the whole amount is held out pending the answer.
            spec = main_module.APPORTIONED_CATEGORIES.get(category)
            if spec and spec.get("pct") is not None:
                blocked = round(amount * spec["pct"] / 100, 2)
            else:
                blocked = round(amount, 2)

            question = entry.get("question") or "Confirm how this document should be treated for tax."
            reason = entry.get("reason") or "The AI could not fully resolve this document's tax treatment."

            signals = [
                {"label": "Document", "value": f"{vendor} — {_fmt_rm(amount)}" if amount else str(vendor)},
                {"label": "Category", "value": category or "Pending review"},
                {"label": "Why it's stuck", "value": reason[:180]},
                {"label": "Held out of your totals", "value": _fmt_rm(blocked) if blocked else "—"},
            ]
            cards.append({
                "insight_type": "review_pending",
                "severity": "action_required",
                "generated_by": "rule_template",
                "dedupe_key": self._key("review_pending", f"doc-{doc_id}"),
                "title": (
                    f"One answer is blocking {_fmt_rm(blocked)} in your totals"
                    if blocked else "A document needs your answer to be counted"
                ),
                "body": f"{reason} {question}",
                "rm_impact": blocked or None,
                "deadline_date": None,
                "citation": _REVIEW_CITATIONS.get(category, "ITA 1967 s.33(1)"),
                "signals": signals,
                "source_document_ids": [doc_id],
                "action": {"label": "Answer now", "to": "/account"},
            })
        if len(pending) > REVIEW_PENDING_MAX_CARDS:
            self.logs.append(
                f"review_pending: {len(pending)} pending items, capped at {REVIEW_PENDING_MAX_CARDS} cards"
            )
        return cards

    # ══════════════════════════════════════════════════════════════════════
    # INSIGHT 4 — review_pending: audit-risk expense-ratio anomaly detection
    # Deterministic ratio check: Entertainment & Gifts / Travel Claims vs
    # gross business revenue. >15% → medium band, >25% → high band. Sub-key
    # is (category_slug, band) so a category crossing from medium into high
    # creates the high card and auto-resolves the medium one (material
    # variance), while repeated detections in the same band upsert in place.
    # ══════════════════════════════════════════════════════════════════════
    def _rule_audit_risk(self, cy: dict) -> list[dict]:
        totals = cy.get("totals") or {}
        revenue = float(totals.get("q1BusinessIncome") or 0)
        if revenue <= 0:
            return []

        cards = []
        for group in AUDIT_RATIO_GROUPS:
            entries = self._entries_in_categories(cy, group["categories"])
            group_total = round(sum(float(e.get("amountNumeric") or 0) for e in entries), 2)
            if group_total <= 0:
                continue
            ratio = group_total / revenue
            if ratio > AUDIT_RATIO_HIGH:
                band = "high"
            elif ratio > AUDIT_RATIO_MEDIUM:
                band = "medium"
            else:
                continue

            severity = AUDIT_BAND_SEVERITY[band]
            threshold_pct = int((AUDIT_RATIO_HIGH if band == "high" else AUDIT_RATIO_MEDIUM) * 100)
            doc_ids = [e.get("documentId") for e in entries if e.get("documentId")]
            cards.append({
                "insight_type": "review_pending",
                "severity": severity,
                "generated_by": "rule_template",
                "dedupe_key": self._key("review_pending", f"{group['slug']}:{band}"),
                "title": (
                    f"{group['label']} at {ratio * 100:.1f}% of revenue — "
                    + ("known LHDN audit trigger" if band == "high" else "above typical audit thresholds")
                ),
                "body": (
                    f"Your {group['label'].lower()} spend of {_fmt_rm(group_total)} is "
                    f"{ratio * 100:.1f}% of your YA {self.ya} gross business revenue "
                    f"({_fmt_rm(revenue)}) — above the {threshold_pct}% level that is a "
                    "known LHDN audit selection signal. The claims may be entirely "
                    "legitimate, but make sure every receipt carries a clear audit "
                    "trail: client names, business purpose notes, and (for vehicles) a "
                    "mileage log, so the deductions survive scrutiny."
                ),
                "rm_impact": None,
                "deadline_date": None,
                "citation": group["citation"],
                "signals": [
                    {"label": f"{group['label']} total", "value": _fmt_rm(group_total)},
                    {"label": "Gross business revenue", "value": _fmt_rm(revenue)},
                    {"label": "Ratio", "value": f"{ratio * 100:.1f}% (threshold: {threshold_pct}%)"},
                    {"label": "Risk band", "value": band},
                    {"label": "Documents in category", "value": str(len(entries))},
                ],
                "source_document_ids": doc_ids,
                "action": {"label": "Review these documents", "to": "/account"},
            })
        return cards

    # ══════════════════════════════════════════════════════════════════════
    # INSIGHT 5 — relief_headroom: ONE aggregated saving-opportunities card
    # (chosen over per-category cards: a single upsert-in-place summary with a
    # per-category breakdown in signals; sub-key is the constant
    # "q4-aggregate", so the card recomputes in place as claims accrue).
    # ══════════════════════════════════════════════════════════════════════
    def _rule_relief_headroom_aggregate(self, cy: dict) -> list[dict]:
        import main as main_module
        totals = cy.get("totals") or {}
        if float(totals.get("totalIncome") or 0) <= 0:
            return []
        marginal = self._marginal_rate_pct(cy)
        if not marginal or marginal <= 0:
            return []

        claimed_by_cat = {
            b["category"]: float(b.get("cappedTotal") or 0)
            for b in (totals.get("q4ReliefsBreakdown") or [])
        }

        lines = []
        total_headroom = 0.0
        for cat, cap in main_module.RELIEF_CAPS_FALLBACK_MYR.items():
            claimed = claimed_by_cat.get(cat, 0.0)
            headroom = round(float(cap) - claimed, 2)
            if headroom < RELIEF_HEADROOM_MIN_CATEGORY_MYR:
                continue
            total_headroom += headroom
            lines.append((cat.replace("Q4 — ", ""), claimed, float(cap), headroom))
        total_headroom = round(total_headroom, 2)
        if total_headroom < RELIEF_HEADROOM_MIN_TOTAL_MYR:
            return []

        lines.sort(key=lambda l: l[3], reverse=True)
        saving = round(total_headroom * marginal / 100, 2)
        window_close = date(self.ya, 12, 31) if self.is_current_ya else None

        signals = [
            {
                "label": short,
                "value": f"{_fmt_rm(claimed)} of {_fmt_rm(cap)} claimed — {_fmt_rm(headroom)} left",
            }
            for short, claimed, cap, headroom in lines[:RELIEF_HEADROOM_MAX_SIGNAL_LINES]
        ]
        if len(lines) > RELIEF_HEADROOM_MAX_SIGNAL_LINES:
            rest = round(sum(l[3] for l in lines[RELIEF_HEADROOM_MAX_SIGNAL_LINES:]), 2)
            signals.append({
                "label": f"+{len(lines) - RELIEF_HEADROOM_MAX_SIGNAL_LINES} more categories",
                "value": f"{_fmt_rm(rest)} additional headroom",
            })
        signals.append({"label": "Your marginal tax rate", "value": f"{marginal:.0f}%"})
        signals.append({
            "label": "Tax saved if fully used",
            "value": f"{_fmt_rm(total_headroom)} × {marginal:.0f}% = {_fmt_rm(saving)}",
        })
        if window_close:
            signals.append({"label": "Window closes", "value": window_close.strftime("%d %b %Y")})

        top = lines[0]
        if self.is_current_ya:
            body = (
                f"Across {len(lines)} personal relief categor{'ies' if len(lines) != 1 else 'y'}, "
                f"{_fmt_rm(total_headroom)} of headroom is still unclaimed for YA {self.ya} — "
                f"your largest gap is {top[0]} with {_fmt_rm(top[3])} unused. Qualifying "
                f"spending before 31 December could save you up to {_fmt_rm(saving)} in tax "
                f"at your current {marginal:.0f}% marginal rate."
            )
        else:
            body = (
                f"For YA {self.ya}, {_fmt_rm(total_headroom)} of personal relief headroom "
                f"went unclaimed across {len(lines)} categor{'ies' if len(lines) != 1 else 'y'} "
                f"(largest: {top[0]}, {_fmt_rm(top[3])} unused). If you hold qualifying "
                f"{self.ya} receipts that were never uploaded, claiming them is worth up to "
                f"{_fmt_rm(saving)} at your {marginal:.0f}% marginal rate for that year."
            )

        return [{
            "insight_type": "relief_headroom",
            "severity": "suggested",
            "generated_by": "rule_template",
            "dedupe_key": self._key("relief_headroom", "q4-aggregate"),
            "title": f"{_fmt_rm(total_headroom)} of personal relief headroom — up to {_fmt_rm(saving)} in tax savings",
            "body": body,
            "rm_impact": saving,
            "deadline_date": window_close,
            "citation": f"Schedule 9, ITA 1967 · LHDN personal relief guideline YA {self.ya}",
            "signals": signals,
            "source_document_ids": [],
            "action": {"label": "How to claim these", "to": "/cukaibot"},
        }]

    # ══════════════════════════════════════════════════════════════════════
    # INSIGHT 1 — doc_gap: recurring-vendor bill gaps
    # ══════════════════════════════════════════════════════════════════════
    def _rule_vendor_gap(self, cy: dict) -> list[dict]:
        """Recurring-expense gap: a vendor billed monthly for ≥3 months in this
        YA, then the trail goes cold — likely unclaimed deductions. The gap
        window never extends past the YA under analysis (December of that
        year), so a backdated run can't report months from the following year."""
        prev_month_end = self.today.replace(day=1) - timedelta(days=1)
        window_end = min(_month_str(prev_month_end), f"{self.ya:04d}-12")

        by_vendor: dict[str, dict] = {}
        for entry in cy.get("q3Deductions") or []:
            vendor = (entry.get("vendor") or "").strip()
            d = entry.get("date") or ""
            if not vendor or not re.match(r"^\d{4}-\d{2}", d):
                continue
            v = by_vendor.setdefault(vendor, {"months": {}, "doc_ids": []})
            month = d[:7]
            v["months"].setdefault(month, []).append(float(entry.get("amountNumeric") or 0))
            if entry.get("documentId"):
                v["doc_ids"].append(entry["documentId"])

        cards = []
        for vendor, v in by_vendor.items():
            months_present = sorted(v["months"])
            if len(months_present) < DOC_GAP_MIN_MONTHS_PRESENT:
                continue
            last_present = months_present[-1]
            if last_present >= window_end:
                continue  # trail is current for this YA — no gap
            missing = _months_between(last_present, window_end)
            if not missing or len(missing) > DOC_GAP_MAX_TRAILING_MISSING:
                continue

            monthly_totals = [sum(amts) for amts in v["months"].values()]
            avg = round(statistics.mean(monthly_totals), 2)
            if avg <= 0:
                continue
            unclaimed = round(avg * len(missing), 2)
            missing_names = ", ".join(
                date(int(m[:4]), int(m[5:7]), 1).strftime("%b") for m in missing
            )
            first_m, last_m = months_present[0], last_present
            span = (
                f"{date(int(first_m[:4]), int(first_m[5:7]), 1).strftime('%b')}–"
                f"{date(int(last_m[:4]), int(last_m[5:7]), 1).strftime('%b %Y')}"
            )
            cards.append({
                "insight_type": "doc_gap",
                "severity": "action_required",
                "generated_by": "rule_template",
                "dedupe_key": self._key("doc_gap", f"{_slugify(vendor)}:{missing[0]}"),
                "title": f"{vendor} bills stopped arriving in {date(int(missing[0][:4]), int(missing[0][5:7]), 1).strftime('%B')}",
                "body": (
                    f"Bills from {vendor} were uploaded every month from {span} "
                    f"(about {_fmt_rm(avg)}/month), but {missing_names} "
                    f"{'is' if len(missing) == 1 else 'are'} missing. That is roughly "
                    f"{_fmt_rm(unclaimed)} in business deductions currently unclaimed."
                ),
                "rm_impact": unclaimed,
                "deadline_date": None,
                "citation": "ITA 1967 s.33(1)",
                "signals": [
                    {"label": "Pattern detected", "value": f"{vendor} · monthly · {span}"},
                    {"label": "Average bill", "value": f"{_fmt_rm(avg)} / month"},
                    {"label": "Missing months", "value": missing_names},
                    {"label": "Estimated unclaimed", "value": f"{len(missing)} × {_fmt_rm(avg)} ≈ {_fmt_rm(unclaimed)}"},
                ],
                "source_document_ids": v["doc_ids"],
                "action": {"label": "Upload the missing bills", "to": "/account"},
            })
        return cards

    # ══════════════════════════════════════════════════════════════════════
    # INSIGHT 1 — doc_gap: missing companion claims (Smart Deduction Tracker)
    # Vehicle/petrol receipts with no mileage-log apportionment on file: LHDN
    # disallows unapportioned private-vehicle claims in an audit, so the
    # qualifying business proportion is "at risk" until a logbook percentage
    # is confirmed. Sub-key = (expense_category, missing_companion_type).
    # ══════════════════════════════════════════════════════════════════════
    def _rule_companion_claims(self, cy: dict) -> list[dict]:
        vehicle_entries = self._entries_in_categories(cy, _VEHICLE_EXPENSE_CATEGORIES)
        if len(vehicle_entries) < COMPANION_MIN_VEHICLE_RECEIPTS:
            return []

        # Mileage-log evidence = a mixed-use vehicle document whose business-use
        # percentage has been confirmed (deductible_pct persisted) — that is
        # exactly what the reclassify flow stores when the user supplies their
        # logbook proportion.
        mileage_evidence = any(
            e.get("category") == _MILEAGE_EVIDENCE_CATEGORY and e.get("deductiblePct") is not None
            for e in cy.get("q3Deductions") or []
        )
        if mileage_evidence:
            return []

        total_spend = round(sum(float(e.get("amountNumeric") or 0) for e in vehicle_entries), 2)
        if total_spend <= 0:
            return []
        qualifying = round(total_spend * DEFAULT_VEHICLE_BUSINESS_USE_PCT / 100, 2)
        marginal = self._marginal_rate_pct(cy)
        rm_impact = round(qualifying * marginal / 100, 2) if marginal else None
        doc_ids = [e.get("documentId") for e in vehicle_entries if e.get("documentId")]

        signals = [
            {"label": "Vehicle/petrol receipts found", "value": f"{len(vehicle_entries)} document{'s' if len(vehicle_entries) != 1 else ''}"},
            {"label": "Total vehicle spend", "value": _fmt_rm(total_spend)},
            {"label": "Mileage log on file", "value": "None found"},
            {"label": f"Qualifying portion at {DEFAULT_VEHICLE_BUSINESS_USE_PCT}% business use", "value": _fmt_rm(qualifying)},
        ]
        if rm_impact is not None:
            signals.append({
                "label": "Tax at stake",
                "value": f"{_fmt_rm(qualifying)} × {marginal:.0f}% marginal rate = {_fmt_rm(rm_impact)}",
            })

        return [{
            "insight_type": "doc_gap",
            "severity": "action_required",
            "generated_by": "rule_template",
            "dedupe_key": self._key("doc_gap", "vehicle_expense:missing_mileage_log"),
            "title": f"{len(vehicle_entries)} vehicle receipts but no mileage log — {_fmt_rm(qualifying)} of deductions at risk",
            "body": (
                f"You have {len(vehicle_entries)} vehicle and petrol receipts totalling "
                f"{_fmt_rm(total_spend)} for YA {self.ya}, but no mileage log or confirmed "
                "business-use percentage on file. LHDN disallows private-vehicle claims "
                "without a logbook in an audit. Confirm your business-use proportion "
                f"(a typical claim is around {DEFAULT_VEHICLE_BUSINESS_USE_PCT}%, worth "
                f"about {_fmt_rm(qualifying)} of these expenses"
                + (f" — roughly {_fmt_rm(rm_impact)} in tax at your marginal rate" if rm_impact is not None else "")
                + ") to secure the deduction."
            ),
            "rm_impact": rm_impact,
            "deadline_date": None,
            "citation": "LHDN PR No. 1/2014 (business deductions — motor vehicles) · Form B Guidebook",
            "signals": signals,
            "source_document_ids": doc_ids,
            "action": {"label": "Confirm business-use %", "to": "/account"},
        }]

    # ══════════════════════════════════════════════════════════════════════
    # INSIGHT 2 — provision: monthly set-aside guidance
    # ══════════════════════════════════════════════════════════════════════
    def _rule_provision_set_aside(self, summary: dict, cy: dict) -> list[dict]:
        # summary["projection"] is only produced for the current calendar year
        # (main.py guards on year == today.year), so a backdated YA run
        # naturally emits no provision card.
        proj = summary.get("projection") or {}
        projected_tax = float(proj.get("projectedTaxPayable") or 0)
        if projected_tax <= 0:
            return []
        cp500_paid = float((cy.get("totals") or {}).get("cp500Paid") or 0)
        remaining = round(projected_tax - cp500_paid, 2)
        if remaining <= 0:
            return []
        months_left = max(1, 12 - self.today.month)
        monthly = round(remaining / months_left, 2)
        return [{
            "insight_type": "provision",
            "severity": "info",
            "generated_by": "rule_template",
            "dedupe_key": self._key("provision", "set-aside"),
            "title": f"Set aside ~{_fmt_rm(monthly)}/month for your YA {self.ya} tax bill",
            "body": (
                f"Based on your income so far, your projected tax for YA {self.ya} is "
                f"about {_fmt_rm(projected_tax)}. After the {_fmt_rm(cp500_paid)} in "
                f"CP500 installments already paid, setting aside {_fmt_rm(monthly)} a "
                f"month over the remaining {months_left} month{'s' if months_left != 1 else ''} "
                "covers the balance comfortably by filing time."
            ),
            "rm_impact": None,
            "deadline_date": None,
            "citation": "Run-rate estimate — not a final tax computation",
            "signals": [
                {"label": "Projected tax (run-rate)", "value": _fmt_rm(projected_tax)},
                {"label": "CP500 already paid", "value": _fmt_rm(cp500_paid)},
                {"label": "Remaining to cover", "value": _fmt_rm(remaining)},
                {"label": "Suggested monthly set-aside", "value": f"{_fmt_rm(remaining)} ÷ {months_left} months ≈ {_fmt_rm(monthly)}"},
            ],
            "source_document_ids": [],
            "action": {"label": "See full breakdown", "to": "/overview"},
        }]

    # ══════════════════════════════════════════════════════════════════════
    # INSIGHT 2 — provision: bracket-jump proximity warning
    # Reuses the SAME bracket lookup as everything else — the year summary's
    # currentMarginalRatePct / nextMarginalRatePct / headroomToNextBracketMyr
    # come from main._bracket_headroom; no bracket math is reimplemented.
    # Sub-key = (current_bracket, next_bracket): the card recomputes in place
    # as net profit moves, and rolls to a new card only when the bracket
    # state itself changes (the old one then auto-resolves).
    # ══════════════════════════════════════════════════════════════════════
    def _rule_bracket_warning(self, summary: dict, cy: dict) -> list[dict]:
        totals = cy.get("totals") or {}
        chargeable = float(totals.get("estimatedChargeableIncome") or 0)
        if chargeable <= 0:
            return []
        cur_rate = totals.get("currentMarginalRatePct")
        next_rate = totals.get("nextMarginalRatePct")
        distance = totals.get("headroomToNextBracketMyr")
        if cur_rate is None or next_rate is None or distance is None:
            return []  # already in the top band, or no bracket data
        distance = float(distance)
        threshold = round(chargeable + distance, 2)  # next bracket floor

        proj = summary.get("projection") or {}
        proj_chargeable = float(proj.get("projectedChargeableIncome") or 0)
        projected_to_cross = proj_chargeable > threshold

        if distance > BRACKET_WARNING_DISTANCE_MYR and not projected_to_cross:
            return []

        # If the run-rate projection crosses the threshold, the extra tax on
        # the crossing portion is the concrete stake; otherwise no rm figure.
        rm_impact = None
        if projected_to_cross:
            rm_impact = round((proj_chargeable - threshold) * (float(next_rate) - float(cur_rate)) / 100, 2)

        basis_ya = totals.get("taxBracketBasisYa") or self.ya
        levers = (
            "Levers before 31 December: qualifying capital purchases (Schedule 3 "
            "capital allowance), EPF self-contribution (relief up to RM 4,000) or a "
            "PRS top-up (up to RM 3,000) — each reduces chargeable income."
            if self.is_current_ya else
            "If you hold unclaimed qualifying receipts or reliefs for this year, "
            "claiming them reduces the chargeable income counted against this bracket."
        )
        if projected_to_cross:
            headline = (
                f"On track to cross into the {next_rate:.0f}% bracket"
            )
            body = (
                f"Your YA {self.ya} chargeable income is {_fmt_rm(chargeable)} so far — "
                f"{_fmt_rm(distance)} below the {_fmt_rm(threshold)} threshold where the "
                f"marginal rate jumps from {cur_rate:.0f}% to {next_rate:.0f}%. At your "
                f"current run rate you are projected to reach {_fmt_rm(proj_chargeable)}, "
                f"crossing the line"
                + (f" — roughly {_fmt_rm(rm_impact)} extra tax on the portion above it" if rm_impact else "")
                + f". {levers}"
            )
        else:
            headline = f"{_fmt_rm(distance)} from the {next_rate:.0f}% tax bracket"
            body = (
                f"Your YA {self.ya} chargeable income of {_fmt_rm(chargeable)} sits in the "
                f"{cur_rate:.0f}% bracket, {_fmt_rm(distance)} below the {_fmt_rm(threshold)} "
                f"threshold where the rate rises to {next_rate:.0f}%. Every ringgit above "
                f"that line is taxed at the higher rate. {levers}"
            )

        signals = [
            {"label": "Chargeable income (estimated)", "value": _fmt_rm(chargeable)},
            {"label": "Current marginal rate", "value": f"{cur_rate:.0f}%"},
            {"label": "Next bracket", "value": f"{next_rate:.0f}% from {_fmt_rm(threshold)}"},
            {"label": "Distance to threshold", "value": _fmt_rm(distance)},
        ]
        if proj_chargeable:
            signals.append({
                "label": "Projected chargeable (run rate)",
                "value": _fmt_rm(proj_chargeable) + (" — crosses the threshold" if projected_to_cross else ""),
            })

        return [{
            "insight_type": "provision",
            "severity": "action_required" if projected_to_cross else "suggested",
            "generated_by": "rule_template",
            "dedupe_key": self._key("provision", f"bracket:{float(cur_rate):g}-{float(next_rate):g}"),
            "title": headline,
            "body": body,
            "rm_impact": rm_impact,
            "deadline_date": date(self.ya, 12, 31) if self.is_current_ya else None,
            "citation": f"LHDN Form B progressive tax rate schedule, YA {basis_ya}",
            "signals": signals,
            "source_document_ids": [],
            "action": {"label": "Plan year-end moves", "to": "/cukaibot"},
        }]

    # ── Pipeline B: the LLM-phrased digest (no session held) ────────────────
    def _build_digest(self, summary: dict, cy: dict, other_cards: list[dict]) -> list[dict]:
        totals = cy.get("totals") or {}
        income = float(totals.get("totalIncome") or 0)
        if income <= 0 and not other_cards:
            return []

        pending = [c for c in other_cards if c["insight_type"] == "review_pending"]
        pending_value = round(sum(c["rm_impact"] or 0 for c in pending), 2)
        reliefs = [c for c in other_cards if c["insight_type"] == "relief_headroom"]
        top_relief = reliefs[0] if reliefs else None
        deadlines = sorted(
            [c for c in other_cards if c["insight_type"] == "deadline" and c["deadline_date"]],
            key=lambda c: c["deadline_date"],
        )
        next_deadline = deadlines[0] if deadlines else None

        prior_income = None
        for yr in summary.get("yearlyTrend") or []:
            if yr.get("year") == self.ya - 1:
                prior_income = float((yr.get("totals") or {}).get("totalIncome") or 0)

        facts = {
            "assessment_year": self.ya,
            "is_current_year": self.is_current_ya,
            "generated_in_month": self.today.strftime("%B %Y"),
            "income_ytd_myr": round(income, 2),
            "prior_full_year_income_myr": prior_income,
            "pending_review_count": len(pending),
            "pending_review_blocked_myr": pending_value,
            "top_unclaimed_relief": top_relief["title"] if top_relief else None,
            "top_relief_potential_saving_myr": (top_relief["rm_impact"] if top_relief else None),
            "next_deadline": (next_deadline["title"] if next_deadline else None),
            "next_deadline_date": (
                next_deadline["deadline_date"].isoformat() if next_deadline else None
            ),
            "projected_tax_myr": float((summary.get("projection") or {}).get("projectedTaxPayable") or 0) or None,
        }

        signals = [
            {"label": f"YA{self.ya} income recorded", "value": _fmt_rm(income)},
        ]
        if prior_income:
            signals.append({"label": f"YA{self.ya - 1} total income", "value": _fmt_rm(prior_income)})
        signals.append({
            "label": "Pending review questions",
            "value": f"{len(pending)}" + (f" — worth ~{_fmt_rm(pending_value)}" if pending_value else ""),
        })
        if top_relief:
            signals.append({"label": "Unclaimed relief", "value": top_relief["title"]})
        if next_deadline:
            signals.append({"label": "Next deadline", "value": next_deadline["title"]})

        body, generated_by = self._phrase_digest_with_llm(facts)
        if body is None:
            body = self._phrase_digest_fallback(facts)
            generated_by = "rule_template"

        title = (
            f"Your {self.today.strftime('%B')} tax brief"
            if self.is_current_ya
            else f"Your YA {self.ya} catch-up brief"
        )
        return [{
            "insight_type": "digest",
            "severity": "info",
            "generated_by": generated_by,
            "dedupe_key": self._key("digest", self.today.strftime("%Y-%m")),
            "title": title,
            "body": body,
            "rm_impact": None,
            "deadline_date": None,
            "citation": None,
            "signals": signals,
            "source_document_ids": [],
            "action": {"label": "Ask CukaiBot about this", "to": "/cukaibot"},
        }]

    def _phrase_digest_with_llm(self, facts: dict) -> tuple[Optional[str], str]:
        """Ask Gemini to word the digest from rule-computed facts. Bounded:
        explicit 15s HTTP timeout, one transient retry, circuit breaker on
        rate-limit/timeout. Any failure returns (None, ...) so the
        deterministic fallback takes over — never raises. Runs with NO database
        session held (a 15s LLM stall must never pin a pooled connection)."""
        open_reason = _gemini_circuit_open_reason()
        if open_reason:
            self.logs.append(f"digest LLM skipped: circuit breaker open ({open_reason})")
            return None, "rule_template"

        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            self.logs.append("digest LLM skipped: GEMINI_API_KEY not set")
            return None, "rule_template"
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            from langchain_core.messages import HumanMessage, SystemMessage

            llm = ChatGoogleGenerativeAI(
                model="gemini-3.1-flash-lite",
                api_key=api_key,
                temperature=0.3,
                timeout=GEMINI_TIMEOUT_SECONDS,
                max_retries=GEMINI_MAX_RETRIES,
                convert_system_message_to_human=True,
            )
            system = (
                "You write a short tax brief for a Malaysian sole proprietor about one "
                "specific Year of Assessment (YA). Use ONLY the facts provided — do not "
                "invent numbers, deadlines, or advice beyond them. If is_current_year is "
                "false, frame it as a catch-up on that past year's records, not as "
                "this-month news. 2-3 sentences, warm but professional, amounts formatted "
                "like 'RM 1,234'. Lead with the single most useful thing the user should "
                "know. Return plain text only, no markdown, no preamble."
            )
            resp = llm.invoke([
                SystemMessage(content=system),
                HumanMessage(content="Facts (JSON):\n" + json.dumps(facts, default=str)),
            ])
            text_out = (resp.content or "").strip() if hasattr(resp, "content") else ""
            if isinstance(text_out, list):  # some LangChain versions return content parts
                text_out = " ".join(str(p) for p in text_out).strip()
            if not text_out or len(text_out) < 30:
                self.logs.append("digest LLM returned empty/too-short text — using template fallback")
                return None, "rule_template"
            return text_out[:2000], "llm"
        except Exception as e:
            if _is_rate_limit_error(e):
                reason = f"rate limited ({type(e).__name__})"
                _trip_gemini_circuit(reason)
                self.logs.append(f"digest LLM aborted: {reason}: {e} — circuit opened, template fallback used")
            elif _is_timeout_error(e):
                reason = f"timeout after {GEMINI_TIMEOUT_SECONDS}s ({type(e).__name__})"
                _trip_gemini_circuit(reason)
                self.logs.append(f"digest LLM aborted: {reason} — circuit opened, template fallback used")
            else:
                self.logs.append(f"digest LLM failed ({type(e).__name__}): {e}")
            return None, "rule_template"

    def _phrase_digest_fallback(self, facts: dict) -> str:
        year_label = f"YA {self.ya}"
        parts = [f"Recorded income for {year_label} is {_fmt_rm(facts['income_ytd_myr'])}."]
        if facts.get("prior_full_year_income_myr"):
            parts[-1] = (
                f"Recorded income for {year_label} is {_fmt_rm(facts['income_ytd_myr'])} "
                f"(YA{self.ya - 1} full-year total: {_fmt_rm(facts['prior_full_year_income_myr'])})."
            )
        if facts.get("pending_review_count"):
            parts.append(
                f"{facts['pending_review_count']} review question"
                f"{'s are' if facts['pending_review_count'] != 1 else ' is'} holding "
                f"~{_fmt_rm(facts['pending_review_blocked_myr'])} out of your totals."
            )
        if facts.get("top_relief_potential_saving_myr"):
            parts.append(
                f"Your unclaimed reliefs could save up to "
                f"{_fmt_rm(facts['top_relief_potential_saving_myr'])} in tax."
            )
        if facts.get("next_deadline"):
            parts.append(f"Coming up: {facts['next_deadline']}.")
        return " ".join(parts)

    # ── Phase 3: persistence (fresh session, advisory-locked, retried) ──────
    @staticmethod
    def _json_value(value):
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        return value

    @classmethod
    def _row_snapshot(cls, row: Insight) -> dict:
        return {
            "id": row.id,
            "state": row.state,
            "severity": row.severity,
            "title": row.title,
            "body": row.body,
            "rmImpact": float(row.rm_impact) if row.rm_impact is not None else None,
            "deadlineDate": cls._json_value(row.deadline_date),
            "signals": list(row.signals or []),
            "sourceDocumentIds": list(row.source_document_ids or []),
        }

    @classmethod
    def _card_snapshot(cls, card: dict, state: str = "new") -> dict:
        return {
            "state": state,
            "severity": card["severity"],
            "title": card["title"],
            "body": card["body"],
            "rmImpact": float(card["rm_impact"]) if card["rm_impact"] is not None else None,
            "deadlineDate": cls._json_value(card["deadline_date"]),
            "signals": list(card["signals"] or []),
            "sourceDocumentIds": list(card["source_document_ids"] or []),
        }

    @staticmethod
    def _impact_delta(before: Optional[float], after: Optional[float]) -> Optional[float]:
        if before is None and after is None:
            return None
        return round(float(after or 0) - float(before or 0), 2)

    def _persist_once(self, cards: list[dict], housekeeping: bool) -> tuple[int, int, int, int]:
        """One attempt at a write transaction. Everything below happens in a
        single transaction on a session opened here and closed here:

          1. pg_advisory_xact_lock on the (user, entity, YA) scope, then on
             each card's dedupe_key hash IN SORTED ORDER — consistent global
             lock ordering means concurrent bulk-upload runs queue instead of
             deadlocking, across threads and across worker processes.
          2. Snapshot existing lifecycle state (for the >15% reopen rule —
             the one deliberately SELECT-first path).
          3. Atomic INSERT ... ON CONFLICT (dedupe_key, assessment_year)
             DO UPDATE for every card, stamped with the current
             TAX_RULES_VERSION and stale=False. Content refreshes; user
             lifecycle state is never clobbered.
          4. When housekeeping=True (Pipeline A only): conditional reopen /
             snooze-wake / stale auto-resolve, scoped to this (user, entity,
             YA) and — on scoped re-runs — to the run's insight types only.
        """
        now = datetime.now(timezone.utc)
        cards = sorted(cards, key=lambda c: c["dedupe_key"])
        keys = [c["dedupe_key"] for c in cards]

        db = self.session_factory()
        try:
            attempt_changes: list[dict] = []
            # 1 — advisory locks (transaction-scoped: released on commit/rollback)
            lock_values = sorted({self._scope_string(), *keys})
            for value in lock_values:
                db.execute(
                    text("SELECT pg_advisory_xact_lock(:k)"),
                    {"k": _advisory_lock_key(value)},
                )

            # 2 — lifecycle snapshot for the reopen rule
            existing = {}
            if keys:
                rows = db.query(Insight).filter(
                    Insight.dedupe_key.in_(keys),
                    Insight.assessment_year == self.ya,
                ).all()
                for row in rows:
                    existing[row.dedupe_key] = self._row_snapshot(row)

            # 3 — atomic upserts (rule-version stamped)
            created = updated = 0
            for c in cards:
                stmt = pg_insert(Insight.__table__).values(
                    user_id=self.user_id,
                    entity_id=self.entity_id,
                    insight_type=c["insight_type"],
                    severity=c["severity"],
                    generated_by=c["generated_by"],
                    assessment_year=self.ya,
                    state="new",
                    dedupe_key=c["dedupe_key"],
                    title=c["title"],
                    body=c["body"],
                    rm_impact=c["rm_impact"],
                    deadline_date=c["deadline_date"],
                    citation=c["citation"],
                    signals=c["signals"],
                    source_document_ids=c["source_document_ids"],
                    action=c["action"],
                    rule_version=TAX_RULES_VERSION,
                    stale=False,
                    created_at=now,
                    updated_at=now,
                ).on_conflict_do_update(
                    index_elements=[
                        Insight.__table__.c.dedupe_key,
                        Insight.__table__.c.assessment_year,
                    ],
                    # Refresh content only — never clobber the user's lifecycle
                    # state, dismiss reason, snooze, or created_at on re-runs.
                    # rule_version/stale refresh: this IS the fresh, auditable
                    # recomputation a stale wake asked for.
                    set_={
                        "severity": c["severity"],
                        "generated_by": c["generated_by"],
                        "title": c["title"],
                        "body": c["body"],
                        "rm_impact": c["rm_impact"],
                        "deadline_date": c["deadline_date"],
                        "citation": c["citation"],
                        "signals": c["signals"],
                        "source_document_ids": c["source_document_ids"],
                        "action": c["action"],
                        "rule_version": TAX_RULES_VERSION,
                        "stale": False,
                        "updated_at": now,
                    },
                )
                insight_id = db.execute(
                    stmt.returning(Insight.__table__.c.id)
                ).scalar_one()
                old = existing.get(c["dedupe_key"])
                if old is None:
                    created += 1
                    after = self._card_snapshot(c)
                    attempt_changes.append({
                        "insight_id": insight_id,
                        "change_type": "created",
                        "impact_delta": self._impact_delta(None, after["rmImpact"]),
                        "before_data": None,
                        "after_data": after,
                    })
                else:
                    after = self._card_snapshot(c, state=old["state"])
                    comparable_old = {k: v for k, v in old.items() if k != "id"}
                    if comparable_old != after:
                        updated += 1
                        attempt_changes.append({
                            "insight_id": insight_id,
                            "change_type": "updated",
                            "impact_delta": self._impact_delta(old["rmImpact"], after["rmImpact"]),
                            "before_data": comparable_old,
                            "after_data": after,
                        })

            resolved = reopened = 0
            if housekeeping:
                # 4a — reopen dismissed/actioned insights whose impact moved > threshold
                for c in cards:
                    old = existing.get(c["dedupe_key"])
                    if not old or old["state"] not in ("dismissed", "actioned"):
                        continue
                    if self._impact_changed_significantly(old["rmImpact"], c["rm_impact"]):
                        db.query(Insight).filter(
                            Insight.dedupe_key == c["dedupe_key"],
                            Insight.assessment_year == self.ya,
                        ).update({
                            "state": "new",
                            "dismiss_reason": None,
                            "resolved_note": None,
                            "snooze_until": None,
                            "updated_at": now,
                        }, synchronize_session=False)
                        self.logs.append(
                            f"reopened {c['dedupe_key']}: rm_impact {old['rmImpact']} → {c['rm_impact']}"
                        )
                        reopened += 1
                        after = self._card_snapshot(c, state="new")
                        attempt_changes.append({
                            "insight_id": old["id"],
                            "change_type": "reopened",
                            "impact_delta": self._impact_delta(old["rmImpact"], after["rmImpact"]),
                            "before_data": {k: v for k, v in old.items() if k != "id"},
                            "after_data": after,
                        })

                # Scoped re-runs restrict housekeeping to their own types so
                # they can never wake or resolve unrelated cards.
                if self.only_types is None:
                    housekeeping_types = AUTO_RESOLVE_TYPES
                else:
                    housekeeping_types = tuple(t for t in AUTO_RESOLVE_TYPES if t in self.only_types)

                if housekeeping_types:
                    # 4b — wake expired snoozes for this scope. Version-mismatch
                    # handling isn't needed here: this same transaction has just
                    # upserted fresh, current-version figures for every card the
                    # rules still generate, and 4c resolves the ones they don't.
                    snooze_q = db.query(Insight).filter(
                        Insight.user_id == self.user_id,
                        Insight.assessment_year == self.ya,
                        Insight.insight_type.in_(housekeeping_types),
                        Insight.state == "dismissed",
                        Insight.snooze_until.isnot(None),
                        Insight.snooze_until <= self.today,
                    )
                    snooze_q = self._entity_scope(snooze_q)
                    snooze_q.update({
                        "state": "new", "dismiss_reason": None, "snooze_until": None, "updated_at": now,
                    }, synchronize_session=False)

                    # 4c — auto-resolve insights whose underlying condition no
                    # longer holds: engine-managed types (digest excepted) still
                    # active in THIS assessment year but not regenerated by this
                    # run. This also retires legacy formb_missing cards (their
                    # check now lives inside the deadline/compliance rule) and
                    # audit-risk cards whose ratio moved to a different band.
                    stale_q = db.query(Insight).filter(
                        Insight.user_id == self.user_id,
                        Insight.assessment_year == self.ya,
                        Insight.insight_type.in_(housekeeping_types),
                        Insight.state.in_(["new", "read"]),
                    )
                    stale_q = self._entity_scope(stale_q)
                    if keys:
                        stale_q = stale_q.filter(Insight.dedupe_key.notin_(keys))
                    stale_rows = stale_q.all()
                    resolved = len(stale_rows)
                    for row in stale_rows:
                        before = self._row_snapshot(row)
                        row.state = "actioned"
                        row.resolved_note = "Resolved automatically — the underlying condition no longer applies."
                        row.stale = False
                        row.updated_at = now
                        after = {**before, "state": "actioned"}
                        attempt_changes.append({
                            "insight_id": row.id,
                            "change_type": "resolved",
                            "impact_delta": None,
                            "before_data": {k: v for k, v in before.items() if k != "id"},
                            "after_data": {k: v for k, v in after.items() if k != "id"},
                        })

            db.commit()
            self.change_events.extend(attempt_changes)
            return created, updated, resolved, reopened
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _entity_scope(self, query):
        if self.entity_id is not None:
            return query.filter(Insight.entity_id == self.entity_id)
        return query.filter(Insight.entity_id.is_(None))

    def _persist_with_retry(self, cards: list[dict], housekeeping: bool) -> tuple[int, int, int, int]:
        """Jittered exponential backoff around the write transaction for
        transient lock contention / serialization failures. Each attempt uses
        a brand-new session (the failed one is already closed). This is the
        ONLY database retry loop — Gemini failures are handled upstream by
        the circuit breaker and never reach this code path."""
        last_exc: Optional[Exception] = None
        for attempt in range(UPSERT_MAX_ATTEMPTS):
            try:
                return self._persist_once(cards, housekeeping)
            except (OperationalError, DBAPIError) as e:
                last_exc = e
                if attempt == UPSERT_MAX_ATTEMPTS - 1:
                    break
                delay = UPSERT_BACKOFF_BASE_SECONDS * (2 ** attempt)
                delay += random.uniform(0, delay / 2)  # jitter
                self.logs.append(
                    f"persist attempt {attempt + 1} failed ({type(e).__name__}); retrying in {delay:.2f}s"
                )
                logger.warning(
                    f"[Insights] Persist attempt {attempt + 1}/{UPSERT_MAX_ATTEMPTS} failed for "
                    f"scope {self._scope_string()}: {e} — retrying in {delay:.2f}s"
                )
                time.sleep(delay)
        raise last_exc  # exhausted retries — caller logs and the run row records it

    @staticmethod
    def _impact_changed_significantly(old: Optional[float], new: Optional[float]) -> bool:
        if old is None and new is None:
            return False
        if old is None or new is None:
            # Impact appeared where there was none → reopen; impact vanished →
            # the auto-resolve/staleness pass handles that, don't reopen.
            return old is None
        if old == 0:
            return new != 0
        return abs(new - old) / abs(old) > REOPEN_IMPACT_CHANGE_PCT

    def _record_run(self, status: str, documents_in_scope: int = 0,
                    insights_matched: int = 0, evidence_signals: int = 0,
                    created: int = 0, updated: int = 0, resolved: int = 0,
                    reopened: int = 0) -> None:
        """Write the run heartbeat in its own short session — the third,
        independent commit point. The audit trail survives even when one (or
        both) pipeline commits failed."""
        db = self.session_factory()
        try:
            now = datetime.now(timezone.utc)
            run = db.query(InsightRun).filter(InsightRun.id == self.run_id).first() if self.run_id else None
            if run is None:
                # Compatibility for direct callers that have not moved to
                # queue_insight_run yet. New production paths always supply an ID.
                run = InsightRun(
                    user_id=self.user_id,
                    entity_id=self.entity_id,
                    assessment_year=self.ya,
                    trigger=self.trigger,
                    requested_triggers=[self.trigger],
                    status="running",
                    queued_at=now,
                    started_at=now,
                )
                db.add(run)
                db.flush()
                self.run_id = run.id

            run.status = status
            run.completed_at = now
            run.ran_at = now
            run.documents_in_scope = documents_in_scope
            run.insights_matched = insights_matched
            run.evidence_signals = evidence_signals
            run.insights_created = created
            run.insights_updated = updated
            run.insights_resolved = resolved
            run.insights_reopened = reopened
            # Legacy aliases keep the current frontend/API operational.
            run.documents_analysed = documents_in_scope
            run.signals_found = insights_matched
            run.logs = self.logs or None

            if self.change_events:
                db.add_all([
                    InsightRunChange(run_id=run.id, **event)
                    for event in self.change_events
                ])
            db.commit()
        except Exception as e:
            logger.error(f"[Insights] Could not record run row for user={self.user_id}: {e}")
            db.rollback()
        finally:
            db.close()

    # ── Entry point ──────────────────────────────────────────────────────────
    def run(self) -> None:
        # Phase 1 — facts (short session, closed inside)
        facts = self._gather_facts()

        # Tax Amendment Lock: per-YA, logged, never silent. This aborts only
        # THIS year's analysis — a batch spanning a locked and an open YA
        # triggers separate per-document runs, and the open year's run
        # proceeds normally.
        if facts["locked"]:
            msg = (
                f"YA {self.ya} is locked — a filed Form B is on record for this "
                f"assessment year, so its financial record is frozen pending a formal "
                f"amendment to LHDN. Document was received and stored, but insight "
                f"analysis was skipped (trigger: {self.trigger})."
            )
            self.logs.append(msg)
            logger.info(f"[Insights] {msg} (user={self.user_id}, entity={self.entity_id})")
            self._record_run(status="skipped")
            return

        summary = facts["summary"]
        cy = facts["cy"]
        documents_in_scope = cy.get("documentCount") or 0

        # ── PIPELINE A — deterministic rules, committed FIRST and alone ─────
        # The 5 core insight types, each backed by one or two rule functions.
        cards_a: list[dict] = []
        a_created = a_updated = a_resolved = a_reopened = 0
        pipeline_a_ok = True
        if summary is not None:
            rules: list[tuple[str, Callable[[], list[dict]]]] = [
                # Insight 3 — Proactive Deadline & Compliance
                ("deadline",        lambda: self._rule_cp500_deadline(cy)),
                ("deadline",        lambda: self._rule_deadline_compliance(cy, facts["prior_formb_exists"])),
                # Insight 4 — Audit Risk Flagging + per-document reviews
                ("review_pending",  lambda: self._rule_review_pending_docs(cy)),
                ("review_pending",  lambda: self._rule_audit_risk(cy)),
                # Insight 5 — Saving Opportunities (aggregated relief headroom)
                ("relief_headroom", lambda: self._rule_relief_headroom_aggregate(cy)),
                # Insight 1 — Smart Deduction Tracker
                ("doc_gap",         lambda: self._rule_vendor_gap(cy)),
                ("doc_gap",         lambda: self._rule_companion_claims(cy)),
                # Insight 2 — Dynamic Tax Bracket Projections
                ("provision",       lambda: self._rule_provision_set_aside(summary, cy)),
                ("provision",       lambda: self._rule_bracket_warning(summary, cy)),
            ]
            for i, (insight_type, rule) in enumerate(rules):
                if not self._type_enabled(insight_type):
                    continue
                try:
                    cards_a.extend(rule())
                except Exception as e:
                    self.logs.append(f"rule {insight_type}#{i} failed ({type(e).__name__}): {e}")
                    logger.error(
                        f"[Insights] Rule '{insight_type}' (#{i}) failed for user={self.user_id}: {e}",
                        exc_info=True,
                    )

        try:
            # Commit point 1: deterministic insights land regardless of
            # anything Gemini does afterwards. housekeeping only when the
            # summary actually loaded — otherwise cards_a is empty because the
            # FACTS are missing, not because every condition cleared, and the
            # auto-resolve pass would wrongly mass-resolve the whole scope.
            a_created, a_updated, a_resolved, a_reopened = self._persist_with_retry(
                cards_a, housekeeping=summary is not None)
        except Exception as e:
            pipeline_a_ok = False
            self.logs.append(f"pipeline A persist failed ({type(e).__name__}): {e}")
            logger.error(
                f"[Insights] Pipeline A persist failed for scope {self._scope_string()}: {e}",
                exc_info=True,
            )

        # ── PIPELINE B — LLM-hybrid digest, isolated try/except + commit ────
        # A Gemini timeout / 429 / persist failure here can only lose the
        # digest; Pipeline A's results are already committed above.
        cards_b: list[dict] = []
        b_created = b_updated = b_reopened = 0
        if summary is not None and self._type_enabled("digest"):
            try:
                cards_b = self._build_digest(summary, cy, cards_a)
            except Exception as e:
                self.logs.append(f"digest build failed ({type(e).__name__}): {e}")
                logger.error(f"[Insights] Digest failed for user={self.user_id}: {e}", exc_info=True)
            if cards_b:
                try:
                    # Commit point 2: digest only. housekeeping=False — the wake/
                    # auto-resolve passes already ran (and committed) with
                    # Pipeline A, and digests are never auto-resolved anyway.
                    b_created, b_updated, _, b_reopened = self._persist_with_retry(
                        cards_b, housekeeping=False)
                except Exception as e:
                    self.logs.append(f"pipeline B persist failed ({type(e).__name__}): {e}")
                    logger.error(
                        f"[Insights] Pipeline B persist failed for scope {self._scope_string()}: {e}",
                        exc_info=True,
                    )

        # ── Run heartbeat — commit point 3, independent of both pipelines ───
        self._record_run(
            status="completed" if pipeline_a_ok else "failed",
            documents_in_scope=documents_in_scope,
            insights_matched=len(cards_a) + len(cards_b),
            evidence_signals=sum(
                len(card.get("signals") or []) for card in (cards_a + cards_b)
            ),
            created=a_created + b_created,
            updated=a_updated + b_updated,
            resolved=a_resolved,
            reopened=a_reopened + b_reopened,
        )
        logger.info(
            f"[Insights] Run complete for scope {self._scope_string()} trigger={self.trigger}"
            + (f" (scoped to {sorted(self.only_types)})" if self.only_types else "")
            + f": {documents_in_scope} documents in scope → "
            f"{len(cards_a) + len(cards_b)} insights matched "
            f"({a_created + b_created} created, {a_updated + b_updated} updated, "
            f"{a_resolved} auto-resolved, {a_reopened + b_reopened} reopened)"
        )


# ── Per-scope run serialization ──────────────────────────────────────────────
# _gather_facts reads the year summary in its own short session, long BEFORE
# _persist_once takes the Postgres advisory lock. Two concurrent same-scope
# runs (e.g. a batch upload fanning out across the pipeline thread pool) could
# therefore both gather, then persist in either order — and the LAST writer's
# stale snapshot would auto-resolve cards its sibling just created. Serializing
# whole runs per (user, entity, ya) makes every run gather AFTER the previous
# same-scope run committed. Process-local by design: all trigger paths (the
# pipeline tail, FastAPI BackgroundTasks, main._queue_insight_refresh) run in
# this one uvicorn process. A multi-process deployment would need the advisory
# lock moved before the gather phase instead.

_SCOPE_RUN_LOCKS: dict = {}
_SCOPE_RUN_LOCKS_GUARD = threading.Lock()


def _scope_run_lock(user_id, entity_id, ya) -> threading.Lock:
    with _SCOPE_RUN_LOCKS_GUARD:
        return _SCOPE_RUN_LOCKS.setdefault((user_id, entity_id, ya), threading.Lock())


def queue_insight_run(user_id, entity_id, trigger: str, db_session_factory,
                      assessment_year=None, only_insight_types=None,
                      initial_logs=None) -> tuple[Optional[int], bool]:
    """Create or reuse one queued run for a (user, entity, YA) scope.

    Returns ``(run_id, created)``. A queued row is coalesced; a currently
    running row is not, because document changes that land after its fact
    snapshot need one follow-up run. The PostgreSQL advisory lock makes the
    check-and-create safe across threads and worker processes.
    """
    try:
        uid = int(user_id)
        ya = int(assessment_year) if assessment_year is not None else date.today().year
    except (TypeError, ValueError):
        logger.warning(
            f"[Insights] Cannot queue run: invalid user_id={user_id!r} or "
            f"assessment_year={assessment_year!r}."
        )
        return None, False
    if not 2000 <= ya <= 2100:
        logger.warning(f"[Insights] Cannot queue run: assessment year {ya} is out of range.")
        return None, False

    requested_types = (
        sorted(set(only_insight_types) & set(ENGINE_MANAGED_TYPES))
        if only_insight_types else None
    )
    db = db_session_factory()
    try:
        scope = f"queue:u{uid}:e{entity_id if entity_id is not None else '-'}:ya{ya}"
        db.execute(
            text("SELECT pg_advisory_xact_lock(:k)"),
            {"k": _advisory_lock_key(scope)},
        )
        queued_q = db.query(InsightRun).filter(
            InsightRun.user_id == uid,
            InsightRun.assessment_year == ya,
            InsightRun.status == "queued",
        )
        queued_q = (
            queued_q.filter(InsightRun.entity_id == entity_id)
            if entity_id is not None
            else queued_q.filter(InsightRun.entity_id.is_(None))
        )
        queued = queued_q.order_by(InsightRun.id.asc()).first()
        if queued:
            triggers = list(queued.requested_triggers or [queued.trigger])
            if trigger not in triggers:
                triggers.append(trigger)
            queued.requested_triggers = triggers

            # NULL means full run. Otherwise merge two scoped stale-wake runs.
            if queued.requested_insight_types is not None:
                if requested_types is None:
                    queued.requested_insight_types = None
                else:
                    queued.requested_insight_types = sorted(
                        set(queued.requested_insight_types) | set(requested_types)
                    )
            if initial_logs:
                queued.logs = list(queued.logs or []) + [str(line) for line in initial_logs]
            db.commit()
            return queued.id, False

        now = datetime.now(timezone.utc)
        queued = InsightRun(
            user_id=uid,
            entity_id=entity_id,
            assessment_year=ya,
            trigger=trigger,
            requested_triggers=[trigger],
            requested_insight_types=requested_types,
            status="queued",
            queued_at=now,
            logs=[str(line) for line in (initial_logs or [])] or None,
        )
        db.add(queued)
        db.commit()
        db.refresh(queued)
        return queued.id, True
    except Exception as e:
        logger.error(f"[Insights] Could not queue run for user={user_id}: {e}", exc_info=True)
        db.rollback()
        return None, False
    finally:
        db.close()


def run_insight_engine(user_id, entity_id, trigger: str, db_session_factory,
                       assessment_year=None, only_insight_types=None,
                       initial_logs=None, run_id=None) -> Optional[int]:
    """Fire an engine run for one (user, entity, assessment_year) scope,
    optionally restricted to specific insight types (scoped re-run after a
    rule-version mismatch on snooze wake). Never raises — callers include the
    document pipeline's tail and FastAPI background tasks, neither of which
    should ever fail because insight generation did. assessment_year comes
    from the triggering document's year_of_assessment; None falls back to the
    current year (correct for manual refresh)."""
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        logger.warning(f"[Insights] Skipping run: user_id '{user_id}' is not numeric.")
        return None

    if run_id is None:
        run_id, created = queue_insight_run(
            uid, entity_id, trigger, db_session_factory,
            assessment_year=assessment_year,
            only_insight_types=only_insight_types,
            initial_logs=initial_logs,
        )
        if run_id is None or not created:
            return run_id

    # Read the durable queue row before waiting on the process-local scope lock.
    # A follow-up run remains visibly "queued" until the preceding run releases.
    db = db_session_factory()
    try:
        queued = db.query(InsightRun).filter(InsightRun.id == run_id).first()
        if not queued:
            logger.warning(f"[Insights] Queued run ID {run_id} no longer exists.")
            return None
        uid = queued.user_id
        entity_id = queued.entity_id
        assessment_year = queued.assessment_year
    finally:
        db.close()

    engine = None
    try:
        with _scope_run_lock(uid, entity_id, assessment_year):
            db = db_session_factory()
            try:
                queued = db.query(InsightRun).filter(InsightRun.id == run_id).first()
                if not queued or queued.status != "queued":
                    return run_id
                queued.status = "running"
                queued.started_at = datetime.now(timezone.utc)
                db.commit()
                trigger = queued.trigger
                only_insight_types = queued.requested_insight_types
                initial_logs = list(queued.logs or [])
            finally:
                db.close()

            engine = TaxInsightEngine(
                db_session_factory, uid, entity_id, trigger,
                assessment_year=assessment_year,
                only_insight_types=only_insight_types,
                initial_logs=initial_logs,
                run_id=run_id,
            )
            engine.run()
        return run_id
    except Exception as e:
        logger.error(f"[Insights] Engine run failed for user={user_id}: {e}", exc_info=True)
        if engine is not None:
            engine.logs.append(f"engine run failed ({type(e).__name__}): {e}")
            engine._record_run(status="failed")
        else:
            db = db_session_factory()
            try:
                failed = db.query(InsightRun).filter(InsightRun.id == run_id).first()
                if failed:
                    now = datetime.now(timezone.utc)
                    failed.status = "failed"
                    failed.completed_at = now
                    failed.ran_at = now
                    failed.logs = list(failed.logs or []) + [
                        f"engine construction failed ({type(e).__name__}): {e}"
                    ]
                db.commit()
            except Exception as inner:
                logger.error(f"[Insights] Could not record failed run for user={user_id}: {inner}")
                db.rollback()
            finally:
                db.close()
        return run_id
