"""Pure tax-relief calculation engine — no FastAPI, no database, no I/O.

Everything here is a plain function of its inputs, so it is trivially unit
testable (see test_calculations.py). The API layer in main.py just validates
input with Pydantic and calls calculate_assessment().

Pipeline (individual / sole-prop owner):

    total_income
      − Σ capped reliefs        → chargeable_income
      → progressive brackets    → tax_before_rebate
      − rebates (RM400 + zakat) → tax_payable

    savings = tax(total_income, no reliefs) − tax(chargeable_income)
"""

from tax_config import get_reliefs, get_brackets, get_rebate_rule, DEFAULT_YA


def progressive_tax(income: float, ya: int = DEFAULT_YA) -> float:
    """Tax on a chargeable income using the YA's progressive bracket table.

    Only the slice of income that falls *within* each band is taxed at that
    band's rate — so earning one more ringgit never retroactively raises the
    rate on income below the threshold.
    """
    if income <= 0:
        return 0.0
    tax = 0.0
    for lower, upper, rate in get_brackets(ya):
        if income <= lower:
            break
        taxable_in_band = min(income, upper) - lower
        tax += taxable_in_band * rate
    return round(tax, 2)


def marginal_bracket(income: float, ya: int = DEFAULT_YA) -> dict:
    """The bracket the income's top ringgit falls into (for display)."""
    for lower, upper, rate in get_brackets(ya):
        if lower < income <= upper:
            return {"lower": lower, "upper": upper, "rate": rate}
    # income is 0 (or negative) → sits in the first, 0% band
    first = get_brackets(ya)[0]
    return {"lower": first[0], "upper": first[1], "rate": first[2]}


def apply_relief_caps(claims: dict, ya: int = DEFAULT_YA) -> list:
    """Cap each relief at its legal maximum.

    `claims` maps relief code → amount the user entered. Returns one row per
    relief in the catalogue with: the cap, the claimed amount, the applied
    amount (= min(claimed, cap)), and whether it was capped. `auto` reliefs are
    always granted at their cap regardless of what was sent.
    """
    rows = []
    for relief in get_reliefs(ya):
        code = relief["code"]
        cap = relief["cap"]
        if relief.get("auto"):
            claimed = cap
        else:
            claimed = max(float(claims.get(code, 0) or 0), 0.0)  # ignore negatives
        applied = min(claimed, cap)
        rows.append({
            "code": code,
            "label": relief["label"],
            "cap": cap,
            "claimed": round(claimed, 2),
            "applied": round(applied, 2),
            "capped": claimed > cap,
        })
    return rows


def calculate_assessment(total_income: float, reliefs: dict | None = None,
                         zakat: float = 0.0, ya: int = DEFAULT_YA) -> dict:
    """Run the full relief → chargeable → tax → savings pipeline.

    Returns a JSON-serialisable dict the frontend renders directly.
    """
    total_income = max(float(total_income or 0), 0.0)
    zakat = max(float(zakat or 0), 0.0)
    reliefs = reliefs or {}

    relief_rows = apply_relief_caps(reliefs, ya)
    total_relief = round(sum(r["applied"] for r in relief_rows), 2)

    chargeable_income = round(max(total_income - total_relief, 0.0), 2)

    tax_before_rebate = progressive_tax(chargeable_income, ya)

    # RM400 individual rebate is conditional on a chargeable-income ceiling.
    rule = get_rebate_rule(ya)
    individual_rebate = rule["amount"] if chargeable_income <= rule["chargeable_income_ceiling"] else 0.0

    # Rebates come off the tax bill directly and can't push it below zero.
    total_rebate = round(min(individual_rebate + zakat, tax_before_rebate), 2)
    tax_payable = round(max(tax_before_rebate - individual_rebate - zakat, 0.0), 2)

    # What the reliefs were worth: tax with no personal reliefs vs. with them.
    tax_without_reliefs = progressive_tax(total_income, ya)
    relief_savings = round(max(tax_without_reliefs - tax_before_rebate, 0.0), 2)

    return {
        "year_of_assessment": ya,
        "total_income": round(total_income, 2),
        "reliefs": relief_rows,
        "total_relief": total_relief,
        "chargeable_income": chargeable_income,
        "marginal_bracket": marginal_bracket(chargeable_income, ya),
        "tax_before_rebate": tax_before_rebate,
        "individual_rebate": round(individual_rebate, 2),
        "zakat": round(zakat, 2),
        "total_rebate": total_rebate,
        "tax_payable": tax_payable,
        "tax_without_reliefs": tax_without_reliefs,
        "relief_savings": relief_savings,
    }
