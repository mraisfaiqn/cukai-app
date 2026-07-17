"""
Business-loss (B5 / Part M1) and unabsorbed-capital-allowance (Part M2)
multi-year carry-forward, subsection 44(5F) ITA 1967.

Design (Phase 3, 14 Jul 2026):
  - A business's STATUTORY income (B1) can never be negative — if a
    business's income before capital allowance is itself negative, or is
    positive but smaller than the capital allowance available that year,
    the shortfall becomes either a CURRENT-YEAR BUSINESS LOSS (B14, if
    income-before-CA was negative) or UNABSORBED CAPITAL ALLOWANCE (M2, if
    income-before-CA was positive but CA exceeded it) — never both for the
    same shortfall, and never silently dropped. See
    compute_year_business_result() for that single-year split.
  - Unabsorbed CA carries forward INDEFINITELY (no statutory expiry).
  - An unabsorbed business loss may be carried forward and absorbed against
    business income for a MAXIMUM OF 10 CONSECUTIVE YEARS from the year it
    was incurred (s.44(5F)) — after that it expires unabsorbed, gone for
    good. This module tracks each year's loss as its own "vintage" with its
    own expiry, absorbing OLDEST vintage first (FIFO), matching the
    ordering of LHDN's own Part M1 "Losses of Prior Years" table.
  - Like capital_allowance.py and breastfeeding_relief.py, nothing about a
    TARGET year's schedule is persisted directly — it's re-derived fresh
    every call from (a) the entity's one-time OPENING balance (seeding
    pre-adoption history the app can't otherwise reconstruct) and (b) each
    subsequent year's ACTUAL computed business income / capital allowance,
    supplied by the caller. A correction to an earlier year's documents
    therefore automatically corrects every later year's carry-forward too.
"""

from decimal import Decimal

from utils import money

MAX_LOSS_CARRYFORWARD_YEARS = 10  # s.44(5F)


def compute_year_business_result(business_income_pre_ca: Decimal, capital_allowance_this_year: Decimal) -> dict:
    """
    Single-year split of (income before capital allowance) vs (capital
    allowance available that year) into: statutory business income (B1,
    never negative), any current-year business loss (B14), and any
    unabsorbed capital allowance arising THIS year (feeds M2).

    `business_income_pre_ca` may be negative (a loss before considering
    capital allowance at all) — that's the normal case for a business that
    simply had a bad year, independent of any asset purchases.
    """
    business_income_pre_ca = Decimal(business_income_pre_ca or 0)
    capital_allowance_this_year = Decimal(capital_allowance_this_year or 0)

    if business_income_pre_ca < 0:
        # Already a loss before capital allowance is even considered — none
        # of this year's capital allowance can be absorbed; it's entirely
        # unabsorbed and carries forward via M2. The loss itself is the full
        # negative amount (capital allowance doesn't make a loss "bigger" —
        # it simply couldn't be used this year).
        return {
            "b1Myr":                   Decimal("0.00"),
            "currentYearLossMyr":      money(-business_income_pre_ca),
            "capitalAllowanceAbsorbedMyr":   Decimal("0.00"),
            "capitalAllowanceUnabsorbedMyr": money(capital_allowance_this_year),
        }

    if capital_allowance_this_year <= business_income_pre_ca:
        # Normal case: enough income to fully absorb this year's allowance.
        return {
            "b1Myr":                   money(business_income_pre_ca - capital_allowance_this_year),
            "currentYearLossMyr":      Decimal("0.00"),
            "capitalAllowanceAbsorbedMyr":   money(capital_allowance_this_year),
            "capitalAllowanceUnabsorbedMyr": Decimal("0.00"),
        }

    # Income before CA was positive, but not enough to absorb the full
    # allowance — B1 floors at 0 (never negative), no current-year loss
    # (income before CA was positive), and the excess allowance carries
    # forward via M2.
    return {
        "b1Myr":                   Decimal("0.00"),
        "currentYearLossMyr":      Decimal("0.00"),
        "capitalAllowanceAbsorbedMyr":   money(business_income_pre_ca),
        "capitalAllowanceUnabsorbedMyr": money(capital_allowance_this_year - business_income_pre_ca),
    }


def compute_multi_year_carryforward(entity, year_business_data: dict, target_year: int) -> dict:
    """
    Walk forward year-by-year from the entity's opening balance (or the
    earliest year with data, if no opening balance is set) up to and
    including target_year, tracking:
      - a FIFO queue of business-loss "vintages" (each with its own
        10-year expiry from the year it arose), and
      - a single running unabsorbed-capital-allowance pool (no expiry).

    `year_business_data` is {year: {"businessIncomePreCaMyr": Decimal,
    "capitalAllowanceMyr": Decimal}} for every year from
    entity.opening_balance_year + 1 through target_year (inclusive) —
    supplied by the caller (main.py's _business_totals_for_year), since this
    module has no DB access. A year missing from this dict is treated as
    zero income and zero capital allowance for that year (e.g. a year
    before the user had any documents in this system) — it still counts
    against the loss vintages' 10-year clocks, since the statute doesn't
    pause for missing records.

    Returns the schedule AS OF target_year: B5 (brought forward + absorbed
    this year + carried forward), B14 (current year's own loss, if any),
    and M2 (unabsorbed capital allowance carried forward).
    """
    opening_year = entity.opening_balance_year
    opening_loss = Decimal(entity.opening_unabsorbed_business_loss_myr or 0)
    opening_ca   = Decimal(entity.opening_unabsorbed_capital_allowance_myr or 0)

    # Loss vintages: list of [year_arose, remaining_balance, original_amount,
    # absorbed_so_far]. The opening balance (if any) is treated as a single
    # vintage "arising" in opening_year for the purpose of its own 10-year
    # clock — an approximation for pre-adoption history where the exact
    # original incurred year(s) aren't individually known to this system.
    loss_vintages = []
    if opening_year is not None and opening_loss > 0:
        loss_vintages.append([opening_year, opening_loss, opening_loss, Decimal("0.00")])
    unabsorbed_ca = opening_ca

    # Nothing to walk if there's no opening year and no year data at all.
    if opening_year is None and not year_business_data:
        walk_years = [target_year] if target_year in year_business_data else []
    else:
        start_year = (opening_year + 1) if opening_year is not None else min(
            [target_year] + list(year_business_data.keys())
        )
        walk_years = list(range(start_year, target_year + 1))

    brought_forward_into_target = Decimal("0.00")
    absorbed_this_year = Decimal("0.00")
    current_year_loss = Decimal("0.00")
    b1_this_year = Decimal("0.00")
    ca_absorbed_this_year = Decimal("0.00")

    for y in walk_years:
        # Expire any loss vintage whose 10-year window has closed BEFORE
        # this year starts absorbing — an expired vintage is gone, not
        # available to offset y's income. A loss arising in year VY remains
        # usable through year VY+10 inclusive (10 full years of carry-
        # forward eligibility), expiring only once y exceeds VY+10.
        loss_vintages = [
            v for v in loss_vintages
            if (y - v[0]) <= MAX_LOSS_CARRYFORWARD_YEARS
        ]

        if y == target_year:
            brought_forward_into_target = money(sum(v[1] for v in loss_vintages))

        data = year_business_data.get(y, {})
        income_pre_ca = Decimal(data.get("businessIncomePreCaMyr", 0) or 0)
        ca_this_year  = Decimal(data.get("capitalAllowanceMyr", 0) or 0)

        year_result = compute_year_business_result(income_pre_ca, ca_this_year)
        unabsorbed_ca = money(unabsorbed_ca + year_result["capitalAllowanceUnabsorbedMyr"])

        # This year's own new loss (if any) becomes its own vintage,
        # available from THIS year onward (not yet expired, since it just
        # arose) — added AFTER the brought-forward absorption below, since
        # B5 (prior losses) and B14 (this year's own loss) are separate
        # Form B lines that don't compete against each other for the same
        # year's income in LHDN's own layout (B5 reduces B4→B6; B14 reduces
        # B13→B15, a later, separate step against aggregate income).
        b1 = year_result["b1Myr"]
        remaining_income_for_bf_losses = b1
        absorbed_this_step = Decimal("0.00")
        for vintage in loss_vintages:
            if remaining_income_for_bf_losses <= 0:
                break
            take = min(vintage[1], remaining_income_for_bf_losses)
            vintage[1] = money(vintage[1] - take)   # remaining balance
            vintage[3] = money(vintage[3] + take)   # cumulative absorbed
            remaining_income_for_bf_losses = money(remaining_income_for_bf_losses - take)
            absorbed_this_step = money(absorbed_this_step + take)
        loss_vintages = [v for v in loss_vintages if v[1] > 0]

        if y == target_year:
            absorbed_this_year = absorbed_this_step
            current_year_loss = year_result["currentYearLossMyr"]
            b1_this_year = b1
            ca_absorbed_this_year = year_result["capitalAllowanceAbsorbedMyr"]

        if year_result["currentYearLossMyr"] > 0:
            new_loss = year_result["currentYearLossMyr"]
            loss_vintages.append([y, new_loss, new_loss, Decimal("0.00")])

    carried_forward_after_target = money(sum(v[1] for v in loss_vintages))

    return {
        "b1Myr":               b1_this_year,
        "capitalAllowanceAbsorbedThisYearMyr": ca_absorbed_this_year,
        "b5BroughtForwardMyr": brought_forward_into_target,
        "b5AbsorbedMyr":       absorbed_this_year,
        "b5CarriedForwardMyr": carried_forward_after_target,
        "b14CurrentYearLossMyr": current_year_loss,
        "m2UnabsorbedCapitalAllowanceMyr": unabsorbed_ca,
        # Part M1 "Losses of Prior Years" detail — one row per surviving
        # vintage, giving the (e) original amount, (g) accumulated absorbed,
        # and (h) balance-unabsorbed columns LHDN's own table wants. (f) and
        # (k) — pioneer-business and PIA 1986 offsets — aren't modelled
        # (out of scope: no pioneer-status/PIA tracking in this system), so
        # they're always 0; (j) subsection 44(5F) disregarded amounts are
        # already reflected by vintages simply expiring out of this list.
        "lossVintagesRemaining": [
            {
                "yearArose":      v[0],
                "originalMyr":    v[2],
                "absorbedMyr":    v[3],
                "remainingMyr":   v[1],
                "expiresAfterYa": v[0] + MAX_LOSS_CARRYFORWARD_YEARS,
            }
            for v in loss_vintages
        ],
    }