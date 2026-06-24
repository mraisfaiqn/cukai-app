"""Pure tax-relief calculation engine — no FastAPI, no database, no I/O.

Everything here is a plain function of its inputs, so it is trivially unit
testable (see test_calculations.py). The API layer in main.py just validates
input with Pydantic and calls calculate_assessment().

Full pipeline (individual / sole-prop owner, mirrors Form B Part B):

    Σ statutory income per business (B1)
    + employment (B7) + rent (B8) + other income (B9)
      = AGGREGATE INCOME (B11)

    − current-year business losses, capped at aggregate income (B14)
      = TOTAL INCOME before donations

    − approved donations, capped at 10% of aggregate income (B17 / G2)
      = TOTAL INCOME (B20)

    − Σ capped personal reliefs (H22)            → CHARGEABLE INCOME (B24)
    → progressive brackets                        → tax_before_rebate (B26)
    − rebates (RM400 individual + zakat, B27)     → tax_payable (B28/B34)

`calculate_assessment()` accepts either a single `total_income` (the original,
still-supported shape) or the income-source breakdown above — whichever is
given, it runs the rest of the pipeline identically.
"""

from tax_config import get_reliefs, get_brackets, get_rebate_rule, get_donation_cap_pct, DEFAULT_YA


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


def aggregate_income(businesses: list | None = None, employment: float = 0.0,
                      rent: float = 0.0, other_income: float = 0.0) -> dict:
    """Sum statutory income across every source into AGGREGATE INCOME (B11).

    `businesses` is a list of statutory-income figures, one per business
    (matches B1a "number of businesses" — each entry is already net of gross
    income, allowable expenses, and capital allowances, since the calculator
    takes statutory income directly rather than deriving it). Negative entries
    are ignored (a loss-making business contributes 0 here; losses are handled
    separately via apply_business_losses so they offset *other* income too).
    """
    businesses = businesses or []
    clean_businesses = [max(float(b or 0), 0.0) for b in businesses]
    business_total = round(sum(clean_businesses), 2)
    employment = max(float(employment or 0), 0.0)
    rent = max(float(rent or 0), 0.0)
    other_income = max(float(other_income or 0), 0.0)
    total = round(business_total + employment + rent + other_income, 2)
    return {
        "businesses": clean_businesses,
        "business_total": business_total,
        "employment": employment,
        "rent": rent,
        "other_income": other_income,
        "aggregate_income": total,
    }


def apply_business_losses(aggregate_income_amount: float, current_year_losses: float = 0.0) -> dict:
    """Offset current-year business losses against aggregate income (B14).

    Capped at the aggregate income available — a loss can zero out total
    income but never push it negative. Any loss beyond that is "unabsorbed"
    (per Form B Part M it would carry forward to a future YA); the calculator
    has no multi-year state yet, so it just reports the figure rather than
    silently dropping it.
    """
    aggregate_income_amount = max(float(aggregate_income_amount or 0), 0.0)
    current_year_losses = max(float(current_year_losses or 0), 0.0)
    applied = min(current_year_losses, aggregate_income_amount)
    unabsorbed = round(current_year_losses - applied, 2)
    income_after_losses = round(aggregate_income_amount - applied, 2)
    return {
        "claimed": round(current_year_losses, 2),
        "applied": round(applied, 2),
        "unabsorbed": unabsorbed,
        "income_after_losses": income_after_losses,
    }


def apply_donation_cap(income_after_losses: float, donations: float, aggregate_income_amount: float,
                        ya: int = DEFAULT_YA) -> dict:
    """Cap approved donations at a percentage of aggregate income (B17 / G2).

    The cap is on AGGREGATE INCOME (B11), not on the loss-adjusted income it's
    actually deducted from — that's the order Form B uses, so a business loss
    can shrink the donation deduction's base even though the donation itself
    comes off the post-loss figure.
    """
    income_after_losses = max(float(income_after_losses or 0), 0.0)
    donations = max(float(donations or 0), 0.0)
    aggregate_income_amount = max(float(aggregate_income_amount or 0), 0.0)
    cap = round(aggregate_income_amount * get_donation_cap_pct(ya), 2)
    applied = min(donations, cap, income_after_losses)
    total_income = round(income_after_losses - applied, 2)
    return {
        "claimed": round(donations, 2),
        "cap": cap,
        "applied": round(applied, 2),
        "capped": donations > cap,
        "total_income": total_income,
    }


def calculate_assessment(total_income: float | None = None, reliefs: dict | None = None,
                          zakat: float = 0.0, ya: int = DEFAULT_YA,
                          businesses: list | None = None, employment: float = 0.0,
                          rent: float = 0.0, other_income: float = 0.0,
                          business_losses: float = 0.0, donations: float = 0.0) -> dict:
    """Run the full income → relief → chargeable → tax → savings pipeline.

    Two ways to call this:
      1. Pass `total_income` directly (original behaviour) — the income-source
         breakdown below is skipped (aggregate_income == total_income, no
         losses/donations applied).
      2. Leave `total_income` unset and pass `businesses` / `employment` /
         `rent` / `other_income` / `business_losses` / `donations` — the engine
         derives total_income by running the full Form B Part B waterfall
         (aggregate income → less losses → less donations) first.

    Returns a JSON-serialisable dict the frontend renders directly.
    """
    reliefs = reliefs or {}
    zakat = max(float(zakat or 0), 0.0)

    if total_income is not None:
        # Original shape: caller already knows total income. Still report the
        # breakdown fields (with income-source steps as no-ops) so the response
        # shape is identical either way and the frontend never has to branch.
        total_income = max(float(total_income), 0.0)
        income_breakdown = aggregate_income(businesses=[total_income], employment=0, rent=0, other_income=0)
        loss_breakdown = apply_business_losses(income_breakdown["aggregate_income"], 0)
        donation_breakdown = apply_donation_cap(loss_breakdown["income_after_losses"], 0, income_breakdown["aggregate_income"], ya)
        # Override total_income with the literal value passed in, in case the
        # no-op steps above introduced rounding drift.
        donation_breakdown["total_income"] = total_income
    else:
        income_breakdown = aggregate_income(businesses, employment, rent, other_income)
        loss_breakdown = apply_business_losses(income_breakdown["aggregate_income"], business_losses)
        donation_breakdown = apply_donation_cap(
            loss_breakdown["income_after_losses"], donations, income_breakdown["aggregate_income"], ya
        )
        total_income = donation_breakdown["total_income"]

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
        "income_breakdown": income_breakdown,
        "business_losses": loss_breakdown,
        "donations": donation_breakdown,
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
