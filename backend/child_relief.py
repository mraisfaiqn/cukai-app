"""
H16 (child relief, paragraphs 48(1)/(2)/(3) ITA 1967) tiering computation.

Replaces the old flat "childCount * RM2,000" profile estimate (formB.js's
H16a fallback, still kept as a pre-migration fallback for profiles with no
Child records yet) with the real LHDN tiering, computed per child from the
Child model's recorded facts:

  H16a — unmarried, under 18 at any time in the basis year         : RM2,000
  H16b — unmarried, 18+, full-time student                         : RM2,000
         ... OR RM8,000 if the study ALSO meets the qualifying
             programme criteria (local university/college excluding
             matriculation/pre-degree/A-Level; OR trade/professional
             articles/indentures; OR a full degree programme outside
             Malaysia)
  H16c — disabled child (any age)                                  : RM6,000
         ... PLUS an additional RM8,000 if ALSO 18+ and satisfies the
             same qualifying-programme criteria as H16b

A child who is 18+ but NOT a full-time student (and not disabled) gets no
relief at all — LHDN's rule doesn't cover an 18+ non-studying, non-disabled
child.

Each child's eligibility_pct (100 or 50) is applied to whatever tier amount
applies, since Form B's own H16 sub-table has exactly that column — this is
what lets two divorced co-parents each claim half of the same child's relief
without either side's Form B silently doubling or dropping the amount.

"Age at any time in the basis year" is computed as of 31 December of the
target year of assessment, matching how LHDN's own worked examples treat it
(a child who turns 18 partway through the year is still "18 years and
above... at any time in the basis year").
"""

from datetime import date
from decimal import Decimal

from utils import money

H16A_RATE = Decimal("2000")   # under 18
H16B_BASE_RATE = Decimal("2000")   # 18+, studying, not a qualifying programme
H16B_HIGHER_ED_RATE = Decimal("8000")   # 18+, studying, qualifying programme
H16C_BASE_RATE = Decimal("6000")   # disabled child, any age
H16C_HIGHER_ED_BONUS = Decimal("8000")   # disabled AND 18+ AND qualifying programme (on top of H16C_BASE_RATE)


def _age_at_year_end(dob: date, target_year: int) -> int:
    """Age as of 31 December of target_year — matches LHDN's "at any time in
    the basis year" phrasing for the under/over-18 threshold."""
    year_end = date(target_year, 12, 31)
    age = year_end.year - dob.year
    if (year_end.month, year_end.day) < (dob.month, dob.day):
        age -= 1
    return age


def compute_child_relief(child, target_year: int) -> dict:
    """
    Compute one child's H16 tier + amount for a given YA.

    `child` is a Child model instance (or anything exposing the same
    attributes: date_of_birth, is_disabled, is_full_time_student,
    is_higher_education, eligibility_pct, name, id).
    """
    dob = child.date_of_birth
    age = _age_at_year_end(dob, target_year) if dob else None
    eligibility_pct = Decimal(child.eligibility_pct or 100) / Decimal(100)

    result = {
        "childId":        getattr(child, "id", None),
        "name":            child.name,
        "age":             age,
        "hLine":           None,       # 'H16a' | 'H16b' | 'H16c' | None (not eligible)
        "baseAmountMyr":   Decimal("0.00"),
        "amountMyr":       Decimal("0.00"),  # after eligibility_pct
        "eligibilityPct":  child.eligibility_pct or 100,
        "needsReview":     False,
        "note":            None,
    }

    if dob is None:
        result["needsReview"] = True
        result["note"] = "Date of birth missing — cannot determine age tier. Excluded from this year's relief pending correction."
        return result

    is_18_plus = age is not None and age >= 18
    qualifies_higher_ed = is_18_plus and bool(child.is_full_time_student) and bool(child.is_higher_education)
    is_studying_18_plus = is_18_plus and bool(child.is_full_time_student)

    if child.is_disabled:
        base = H16C_BASE_RATE
        if qualifies_higher_ed:
            base += H16C_HIGHER_ED_BONUS
        result["hLine"] = "H16c"
        result["baseAmountMyr"] = base
    elif not is_18_plus:
        result["hLine"] = "H16a"
        result["baseAmountMyr"] = H16A_RATE
    elif is_studying_18_plus:
        base = H16B_HIGHER_ED_RATE if qualifies_higher_ed else H16B_BASE_RATE
        result["hLine"] = "H16b"
        result["baseAmountMyr"] = base
    else:
        # 18+, not disabled, not a full-time student — no H16 relief for
        # this child under any sub-line. Not an error; just genuinely 0.
        result["note"] = "Child is 18 or above and not recorded as a full-time student or disabled — not eligible for child relief this year."
        return result

    result["amountMyr"] = money(result["baseAmountMyr"] * eligibility_pct)
    if child.eligibility_pct and child.eligibility_pct != 100:
        result["note"] = f"Eligibility restricted to {child.eligibility_pct}% per the profile record for this child."

    # Bug fix (15 Jul 2026): subsection 48(5) ITA 1967 — this relief is
    # disallowed entirely if the child has their OWN income exceeding the
    # relief amount otherwise due, EXCEPT scholarships/grants/similar
    # allowances (Sch. 6 para 24) and payments to a child serving under
    # articles/indentures, neither of which count toward this test. This
    # was previously unmodelled — a child's own income was never asked
    # about at all, so a working 18+ child (e.g. one on a part-time salary
    # alongside full-time study) could have been silently over-relieved.
    # Compared against baseAmountMyr (the pre-eligibility-split figure,
    # matching LHDN's own "amount of deduction otherwise due" wording)
    # rather than the post-split amountMyr, since eligibility_pct reflects
    # a co-parenting SPLIT of the relief, not the statutory deduction size
    # this test is actually measured against.
    own_income = Decimal(child.own_income_myr or 0)
    if own_income > 0 and not child.own_income_is_exempt_type and own_income > result["baseAmountMyr"]:
        disallowed_amount = result["amountMyr"]
        result["hLine"] = None
        result["amountMyr"] = Decimal("0.00")
        result["note"] = (
            f"This child's own income (RM{own_income:,.2f}) exceeds the RM{result['baseAmountMyr']:,.2f} "
            "relief otherwise due, so subsection 48(5) ITA 1967 disallows this child's relief entirely "
            f"(would otherwise have been RM{disallowed_amount:,.2f}). This test excludes scholarships/"
            "grants and articled-service payments — mark this child's income as exempt-type in the "
            "profile if it qualifies for that exclusion."
        )
    return result


def compute_h16_for_children(children: list, target_year: int) -> dict:
    """
    Compute the full H16 schedule for a person, for one YA.

    Returns per-child detail plus H16a/H16b/H16c pool totals (each pool is
    its own Form B line — they are NOT combined into one H16 figure, since
    the printed form itself breaks them out separately).
    """
    per_child = [compute_child_relief(c, target_year) for c in children]

    totals = {"H16a": Decimal("0.00"), "H16b": Decimal("0.00"), "H16c": Decimal("0.00")}
    for c in per_child:
        if c["hLine"] in totals:
            totals[c["hLine"]] = money(totals[c["hLine"]] + c["amountMyr"])

    return {
        "perChild": per_child,
        "totalsByLine": totals,
        "grandTotalMyr": money(sum(totals.values())),
        "hasAnyReviewFlags": any(c["needsReview"] for c in per_child),
    }