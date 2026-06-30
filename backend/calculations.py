"""Form B calculation engine for cukai.ai.

Turns a person's classified documents (Document.category / .tax_status /
.extracted_data, produced by pipeline.py) into a full Form B Part B waterfall:

    Σ Q1 business income − Σ Q3 deductible business expenses
        = STATUTORY BUSINESS INCOME (4a), floored at 0 (negative → current-year loss)
    + Q2 income split into 4b (employment) / 4c (dividends & interest) /
        4d (rent & royalty) / 4e (pension & annuity) / 4f (casual & FSI)
        = AGGREGATE INCOME (B11)
    − current-year business loss + prior-year unabsorbed loss (from
        FormBProfile), capped at aggregate income
        = income after losses (B14)
    − approved donations, capped at 10% of aggregate income (B17 / G2)
        = TOTAL INCOME (B20)
    − Σ capped personal reliefs (Q4 documents + automatic individual/spouse/
        child reliefs from the Person record)
        = CHARGEABLE INCOME (B24)
    → progressive brackets → tax_before_rebate (B26)
    − individual rebate (RM400, conditional) − zakat rebate (B27)
        = TAX PAYABLE (B28)
    − CP500 instalments paid
        = BALANCE PAYABLE / REFUNDABLE (B34)

`calculate_form_b_for_person()` is the orchestrator: it queries the DB, runs
the pure functions below, and upserts the result into FormBCalculation (one
row per person per year of assessment). The pure functions themselves take no
DB/session arguments, so they can be unit tested independently of Postgres —
mirroring the structure of kenji/partnership-overview-frontend's
calculations.py, which this is adapted from.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models import Document, FormBCalculation, FormBProfile, Person
import tax_config

logger = logging.getLogger("uvicorn.error")

# Categories that are supporting evidence / informational rather than a clean,
# additive income or expense figure — counting them would double-count
# against the itemised Q1/Q3 documents above them. Excluded from totals.
_Q1_INFORMATIONAL_CATEGORIES = {
    "Q1 — Financial Statements (P&L)",
    "Q1 — Financial Statements (BS)",
    "Q1 — SST-02 Sales Tax Return",
    "Q1 — e-Invoice / LHDN Validated",
    "Q1 — Filed Form B (Prior Year)",
}

# Q3 categories subject to a statutory cap rather than full deduction.
_Q3_HALF_CAPPED_CATEGORIES = {
    "Q3 — Client Entertainment (50% cap)",  # s.39(1)(l)
    "Q3 — Client & Corporate Gifts",
    "Q3 — Mixed-Use Vehicle Expenses",      # simplification: 50% business-use apportionment
}

# Q3 categories that are not a direct deduction at all (capital expenditure
# goes through Schedule 3 capital allowances, which this engine does not yet
# compute; CP500 is an advance tax payment, not an expense).
_Q3_EXCLUDED_CATEGORIES = {
    "Q3 — Capital Assets & Equipment",
    "Q3 — Capital Renovation & Fit-Out",
    "Q3 — CP500 / Tax Installment",
}

# Q2 category → statutory income section.
_Q2_SECTION_MAP = {
    "Q2 — Employment Income (s.4b)":     "4b",
    "Q2 — Passive Rental Income (s.4d)": "4d",
    "Q2 — Royalty Income (s.4d)":        "4d",
    "Q2 — Dividend Income (s.4c)":       "4c",
    "Q2 — Investment Interest (s.4c)":   "4c",
    "Q2 — Pension & Annuity (s.4e)":     "4e",
    "Q2 — Casual & Other Income (s.4f)": "4f",
    "Q2 — Foreign-Source Income (FSI)":  "4f",
}

ZAKAT_CATEGORY = "Q4 — Zakat"
REVIEW_CATEGORY = "Mixed / Pending Review"
# NOTE: pipeline.py also sets tax_status="mixed" on Q3 — Client Entertainment,
# Client & Corporate Gifts, Mixed-Use Vehicle Expenses, and Hire Purchase &
# Leased Assets — but those mean "statutorily capped, apply the cap", NOT
# "needs human review". Only REVIEW_CATEGORY itself means the latter, so
# pending-review detection below matches on category, not on tax_status.


def _parse_amount(val) -> float:
    """Document amounts are stored as free text, e.g. 'RM 1,240.00' or None."""
    if val is None:
        return 0.0
    try:
        return float(str(val).replace("RM", "").replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


# ─── Pure calculation steps (no DB access) ─────────────────────────────────

def progressive_tax(income: float, ya: int = tax_config.DEFAULT_YA) -> float:
    """Tax on chargeable income using the YA's progressive bracket table.

    Only the slice of income within each band is taxed at that band's rate.
    """
    if income <= 0:
        return 0.0
    tax = 0.0
    for lower, upper, rate in tax_config.get_brackets(ya):
        if income <= lower:
            break
        taxable_in_band = min(income, upper) - lower
        tax += taxable_in_band * rate
    return round(tax, 2)


def apply_business_losses(aggregate_income: float, current_year_loss: float,
                           prior_year_unabsorbed: float = 0.0) -> dict:
    """Offset business losses (current year + brought-forward) against
    aggregate income (B14), capped at the income available."""
    aggregate_income = max(float(aggregate_income or 0), 0.0)
    total_claimed = max(float(current_year_loss or 0), 0.0) + max(float(prior_year_unabsorbed or 0), 0.0)
    applied = min(total_claimed, aggregate_income)
    return {
        "claimed":           round(total_claimed, 2),
        "applied":           round(applied, 2),
        "unabsorbed":        round(total_claimed - applied, 2),
        "income_after_losses": round(aggregate_income - applied, 2),
    }


def apply_donation_cap(income_after_losses: float, donations: float, aggregate_income: float,
                        ya: int = tax_config.DEFAULT_YA) -> dict:
    """Cap approved donations at a percentage of aggregate income (B17 / G2)."""
    income_after_losses = max(float(income_after_losses or 0), 0.0)
    donations = max(float(donations or 0), 0.0)
    aggregate_income = max(float(aggregate_income or 0), 0.0)
    cap = round(aggregate_income * tax_config.get_donation_cap_pct(ya), 2)
    applied = min(donations, cap, income_after_losses)
    return {
        "claimed":      round(donations, 2),
        "cap":          cap,
        "applied":      round(applied, 2),
        "total_income": round(income_after_losses - applied, 2),
    }


def apply_relief_caps(claims: dict, person: Person | None, ya: int = tax_config.DEFAULT_YA) -> list[dict]:
    """One row per relief code: catalogue cap, claimed amount, applied (capped)
    amount. Document-evidenced reliefs come from `claims` (code → summed
    amount); the always-on individual relief and the marital/child reliefs
    are derived straight from the Person record, not from documents.
    """
    rows = []
    for relief in tax_config.get_reliefs(ya):
        code = relief["code"]
        cap = relief["cap"]
        claimed = cap if relief.get("auto") else max(float(claims.get(code, 0) or 0), 0.0)
        applied = min(claimed, cap)
        rows.append({
            "code": code, "label": relief["label"], "cap": cap,
            "claimed": round(claimed, 2), "applied": round(applied, 2),
            "capped": claimed > cap,
        })

    if person is not None:
        if person.marital_status == "married" and (person.assessment_type or "").lower() in ("joint", "combined"):
            spouse_cap = tax_config.get_spouse_relief(ya)
            rows.append({"code": "spouse", "label": "Husband / wife relief", "cap": spouse_cap,
                         "claimed": spouse_cap, "applied": spouse_cap, "capped": False})

        children = int(person.number_of_children or 0)
        if children > 0:
            per_child, per_disabled_child = tax_config.get_child_relief_amounts(ya)
            amount_each = per_disabled_child if person.has_disabled_dependents else per_child
            total = round(amount_each * children, 2)
            rows.append({"code": "child", "label": f"Child relief ({children} child(ren))",
                         "cap": total, "claimed": total, "applied": total, "capped": False})

    return rows


# ─── Orchestrator (reads documents/person, writes FormBCalculation) ───────

def calculate_form_b_for_person(db: Session, person_id: int, year: int,
                                 ya: int = tax_config.DEFAULT_YA) -> FormBCalculation:
    """Run the full Form B waterfall for one person/year and upsert the
    result into FormBCalculation. Raises ValueError if the person doesn't
    exist. Safe to call repeatedly — re-running just updates the same row.
    """
    person = db.query(Person).filter(Person.id == person_id).first()
    if person is None:
        raise ValueError(f"No person found with id={person_id}")

    docs = (
        db.query(Document)
        .filter(
            Document.user_id == str(person_id),
            Document.year_of_assessment == year,
            Document.status == "completed",
        )
        .all()
    )

    section_totals = {"4a": 0.0, "4b": 0.0, "4c": 0.0, "4d": 0.0, "4e": 0.0, "4f": 0.0}
    q1_income_total = 0.0
    q3_deductible_total = 0.0
    q4_non_deductible_total = 0.0
    relief_claims: dict[str, float] = {}
    zakat_total = 0.0
    cp500_total_paid = 0.0
    pending_review_amount = 0.0
    pending_review_count = 0
    confidence_sum = 0
    source_document_ids: list[int] = []

    for doc in docs:
        ed = doc.extracted_data or {}
        category = doc.category or ""
        amount = _parse_amount(ed.get("amount"))
        confidence_sum += ed.get("confidence", 0) or 0
        source_document_ids.append(doc.id)

        if category == REVIEW_CATEGORY:
            pending_review_amount += amount
            pending_review_count += 1
            continue  # excluded from every total until the user resolves it

        if category in _Q1_INFORMATIONAL_CATEGORIES:
            continue  # supporting evidence only — would double-count income
        if category.startswith("Q1 —"):
            q1_income_total += amount
            continue

        if category in _Q2_SECTION_MAP:
            section_totals[_Q2_SECTION_MAP[category]] += amount
            continue

        if category in _Q3_EXCLUDED_CATEGORIES:
            if category == "Q3 — CP500 / Tax Installment":
                cp500_total_paid += _parse_amount(ed.get("installment_amount")) or amount
            continue
        if category.startswith("Q3 —"):
            rate = 0.5 if category in _Q3_HALF_CAPPED_CATEGORIES else 1.0
            q3_deductible_total += amount * rate
            continue

        if category == ZAKAT_CATEGORY:
            zakat_total += _parse_amount(ed.get("zakat_amount")) or amount
            continue
        if category in tax_config.RELIEF_CATEGORY_MAP:
            code = tax_config.RELIEF_CATEGORY_MAP[category]
            relief_claims[code] = relief_claims.get(code, 0.0) + amount
            continue
        if category.startswith("Q4 —"):  # non-deductible personal spend
            q4_non_deductible_total += amount
            continue
        # Unrecognised / Non-Tax Document categories contribute nothing.

    # ── 4a: statutory business income (can be negative → current-year loss) ──
    business_income_raw = q1_income_total - q3_deductible_total
    section_totals["4a"] = max(business_income_raw, 0.0)
    current_year_business_loss = max(-business_income_raw, 0.0)

    aggregate_income = round(sum(section_totals.values()), 2)

    prior_fb = (
        db.query(FormBProfile)
        .filter(FormBProfile.user_id == str(person_id), FormBProfile.year_of_assessment == year - 1)
        .first()
    )
    prior_unabsorbed_loss = float(prior_fb.unabsorbed_business_losses or 0) if prior_fb else 0.0

    loss_breakdown = apply_business_losses(aggregate_income, current_year_business_loss, prior_unabsorbed_loss)
    # No dedicated "approved donations" document category exists yet in the
    # classification taxonomy, so donations are always 0 for now — the
    # waterfall step still runs so the response shape matches Form B exactly.
    donation_breakdown = apply_donation_cap(loss_breakdown["income_after_losses"], 0.0, aggregate_income, ya)
    total_income = donation_breakdown["total_income"]

    relief_rows = apply_relief_caps(relief_claims, person, ya)
    total_relief = round(sum(r["applied"] for r in relief_rows), 2)

    chargeable_income = round(max(total_income - total_relief, 0.0), 2)
    tax_before_rebate = progressive_tax(chargeable_income, ya)

    rule = tax_config.get_rebate_rule(ya)
    individual_rebate = rule["amount"] if chargeable_income <= rule["chargeable_income_ceiling"] else 0.0
    zakat_rebate = round(min(zakat_total, max(tax_before_rebate - individual_rebate, 0.0)), 2)
    total_rebate = round(min(individual_rebate + zakat_rebate, tax_before_rebate), 2)
    tax_payable = round(max(tax_before_rebate - total_rebate, 0.0), 2)

    cp500_total_paid = round(cp500_total_paid, 2)
    balance_payable_refundable = round(tax_payable - cp500_total_paid, 2)

    doc_count = len(docs)
    avg_confidence = round(confidence_sum / doc_count) if doc_count else 0

    existing = (
        db.query(FormBCalculation)
        .filter(FormBCalculation.person_id == person_id, FormBCalculation.year_of_assessment == year)
        .first()
    )

    kwargs = dict(
        person_id=person_id,
        year_of_assessment=year,
        statutory_income_4a=section_totals["4a"],
        statutory_income_4b=section_totals["4b"],
        statutory_income_4c=section_totals["4c"],
        statutory_income_4d=section_totals["4d"],
        statutory_income_4e=section_totals["4e"],
        statutory_income_4f=section_totals["4f"],
        aggregate_income=aggregate_income,
        business_loss_claimed=loss_breakdown["claimed"],
        business_loss_applied=loss_breakdown["applied"],
        business_loss_unabsorbed=loss_breakdown["unabsorbed"],
        approved_donations_claimed=donation_breakdown["claimed"],
        approved_donations_applied=donation_breakdown["applied"],
        total_income=total_income,
        relief_breakdown=relief_rows,
        total_personal_reliefs=total_relief,
        chargeable_income=chargeable_income,
        tax_before_rebate=tax_before_rebate,
        individual_rebate=individual_rebate,
        zakat_rebate=zakat_rebate,
        total_rebate=total_rebate,
        tax_payable=tax_payable,
        cp500_total_paid=cp500_total_paid,
        balance_payable_refundable=balance_payable_refundable,
        total_business_income=round(q1_income_total, 2),
        total_business_deductions=round(q3_deductible_total, 2),
        total_non_deductible=round(q4_non_deductible_total, 2),
        pending_review_amount=round(pending_review_amount, 2),
        pending_review_count=pending_review_count,
        document_count=doc_count,
        average_confidence=avg_confidence,
        source_document_ids=source_document_ids,
        calculation_version="v1",
        updated_at=datetime.now(timezone.utc),
    )

    if existing:
        for k, v in kwargs.items():
            setattr(existing, k, v)
        record = existing
    else:
        record = FormBCalculation(**kwargs)
        db.add(record)

    db.commit()
    db.refresh(record)
    return record


def recalculate_form_b(db: Session, user_id: str | None, year: int | None,
                        ya: int = tax_config.DEFAULT_YA) -> FormBCalculation | None:
    """Best-effort wrapper for trigger sites (document upload/reclassify/
    archive/delete): swallows errors and returns None instead of raising, so
    a calculation problem never breaks the document operation that triggered
    it. Use calculate_form_b_for_person() directly when the caller (e.g. an
    API endpoint) should see failures.
    """
    if not user_id or year is None:
        return None
    try:
        person_id = int(user_id)
    except (TypeError, ValueError):
        logger.info(f"[Calculations] Skipping Form B recalculation — non-numeric user_id={user_id!r}")
        return None

    try:
        record = calculate_form_b_for_person(db, person_id, year, ya)
        logger.info(
            f"[Calculations] Form B recalculated for person_id={person_id} YA={year}: "
            f"chargeable_income={record.chargeable_income} tax_payable={record.tax_payable}"
        )
        return record
    except Exception as e:
        logger.error(f"[Calculations] Form B recalculation failed for person_id={person_id} YA={year}: {e}", exc_info=True)
        db.rollback()
        return None
