"""
Progressive resident-individual tax bracket computation (Schedule/Tax Rate
table, ITA 1967) and the B25a/B25b band-by-band breakdown.

Extracted out of main.py (Phase 7, 14 Jul 2026 — production QA pass) so this
pure, DB-free computation can actually be unit-tested in isolation. main.py
imports FastAPI/SQLAlchemy and creates a live engine connection as a side
effect of importing database.py, which makes main.py itself unimportable in
a test environment without a running Postgres instance. Every function here
takes plain Decimal/int/float arguments and returns plain dicts/Decimals —
no DB, no request context — same pattern as capital_allowance.py,
carryforward.py, child_relief.py, and breastfeeding_relief.py.
"""

from decimal import Decimal
from typing import Optional

from utils import money

# Progressive resident-individual bracket table as (band size, rate) tuples,
# keyed by year of assessment. Rates change between YAs, so tax for a given
# year must use that year's table — the same table can't be reused across a
# multi-year trend.
#
# The YA2023-2025 schedule (verified against LHDN-published rates, and
# cross-checked directly against the LHDN Explanatory Notes B 2024 tax
# schedule during the Phase 7 re-verification pass):
#   0-5k 0% . 5-20k 1% . 20-35k 3% . 35-50k 6% . 50-70k 11% . 70-100k 19%
#   100-400k 25% . 400-600k 26% . 600k-2m 28% . >2m 30%
# VERIFY against the LHDN gazette before relying on this for a filing, and
# add new years here as each Budget's rates are gazetted.
_TAX_BRACKETS_YA2023_2025 = [
  (5_000,        0.00),
  (15_000,       0.01),
  (15_000,       0.03),
  (15_000,       0.06),
  (20_000,       0.11),
  (30_000,       0.19),
  (300_000,      0.25),
  (200_000,      0.26),
  (1_400_000,    0.28),
  (float("inf"), 0.30),
]

TAX_BRACKETS_BY_YA: dict[int, list] = {
  2023: _TAX_BRACKETS_YA2023_2025,
  2024: _TAX_BRACKETS_YA2023_2025,
  2025: _TAX_BRACKETS_YA2023_2025,
}

# Automatic self relief every resident individual receives (Sch. 9 para 1)
# before any relief category is applied.
INDIVIDUAL_SELF_RELIEF_MYR = Decimal("9000")

# Standard tax rebate (s.6D) for chargeable income <= this threshold.
LOW_INCOME_REBATE_THRESHOLD_MYR = Decimal("35000")
LOW_INCOME_REBATE_MYR = Decimal("400")


def brackets_for_year(ya: Optional[int]) -> tuple[list, int]:
  """Return (bracket_table, basis_ya_used). For a year without its own table,
  fall back to the nearest earlier registered year (else the earliest), and
  report which year's table was actually used so the estimate stays honest."""
  registered = sorted(TAX_BRACKETS_BY_YA)
  if ya in TAX_BRACKETS_BY_YA:
    return TAX_BRACKETS_BY_YA[ya], ya
  basis = registered[0]
  for y in registered:
    if ya is not None and y <= ya:
      basis = y
  if ya is not None and ya > registered[-1]:
    basis = registered[-1]
  return TAX_BRACKETS_BY_YA[basis], basis


def estimate_tax(chargeable_income, ya: Optional[int] = None) -> Decimal:
  brackets, _ = brackets_for_year(ya)
  tax = Decimal("0")
  remaining = Decimal(chargeable_income)
  for band_size, rate in brackets:
    if remaining <= 0:
      break
    # band_size may be float('inf') for the top band; min() with a Decimal
    # returns `remaining` there (finite < inf), so no Decimal/inf arithmetic
    # is ever performed. rate is a float in the bracket table — convert via
    # str() so the marginal rate is applied without binary drift.
    taxable_in_band = min(remaining, band_size) if band_size != float("inf") else remaining
    tax += taxable_in_band * Decimal(str(rate))
    remaining -= taxable_in_band
  return money(tax)


def bracket_breakdown(chargeable_income, ya: Optional[int] = None) -> dict:
  """
  Split total income tax into Form B's own B25a/B25b/B26 structure:
    B25a - "Tax on the first {lower bound of the current band}" - the
           CUMULATIVE tax on every FULL band strictly below the one
           chargeable_income actually falls into.
    B25b - "Tax on the balance {amount within the current band}, at rate
           {the current band's own marginal rate}%" - tax on just the
           portion of chargeable_income that falls inside its own band.
    B26  - B25a + B25b, which is exactly estimate_tax()'s own total.

  Deliberately walks the SAME brackets table with the SAME band-by-band
  logic as estimate_tax() (rather than, say, deriving B25a as
  `estimate_tax(lower_bound)` after finding the band some other way) so the
  two can never numerically drift apart - B26 here is always identical to
  calling estimate_tax(chargeable_income, ya) directly.
  """
  brackets, _ = brackets_for_year(ya)
  chargeable_income = Decimal(chargeable_income)
  cumulative_tax = Decimal("0")
  lower_bound = Decimal("0")
  remaining = chargeable_income

  for band_size, rate in brackets:
    band_size_dec = None if band_size == float("inf") else Decimal(str(band_size))
    taxable_in_band = remaining if band_size_dec is None else min(remaining, band_size_dec)
    if taxable_in_band <= 0:
      break
    # This is the band chargeable_income itself falls into once it doesn't
    # fully consume the band (or this is the uncapped top band) - stop here
    # rather than continuing to walk lower-rate math into a higher band.
    is_current_band = (band_size_dec is None) or (remaining <= band_size_dec)
    if is_current_band:
      b25b_tax = money(taxable_in_band * Decimal(str(rate)))
      return {
        "b25aLowerBoundMyr": money(lower_bound),
        "b25aTaxMyr":        money(cumulative_tax),
        "b25bAmountMyr":     money(taxable_in_band),
        "b25bRatePct":       round(float(rate) * 100, 2),
        "b25bTaxMyr":        b25b_tax,
        "totalTaxMyr":       money(cumulative_tax + b25b_tax),
      }
    cumulative_tax += taxable_in_band * Decimal(str(rate))
    lower_bound += taxable_in_band
    remaining -= taxable_in_band

  # chargeable_income <= 0 - nothing to break down.
  return {
    "b25aLowerBoundMyr": Decimal("0.00"), "b25aTaxMyr": Decimal("0.00"),
    "b25bAmountMyr":     Decimal("0.00"), "b25bRatePct": 0.0,
    "b25bTaxMyr":        Decimal("0.00"), "totalTaxMyr": Decimal("0.00"),
  }


def bracket_headroom(chargeable_income, ya: Optional[int] = None) -> dict:
  """
  Locate which marginal band `chargeable_income` currently sits in and how
  much more chargeable income it could absorb before crossing into the next
  (higher-rate) band. Lets the UI show "RM X of headroom left in your
  current Y% bracket" - useful for year-end purchase/relief timing decisions.
  Returns None-filled values if already in the top band (no next bracket).

  Also returns the current band's own floor/ceiling (currentBandFloorMyr /
  currentBandCeilingMyr, the latter None for the unbounded top band) so a
  caller can render a "where you sit within this bracket" progress bar
  without needing its own independent copy of the bracket table — the
  frontend previously duplicated this table locally (Overview.jsx), which
  would have silently gone stale the next time this table is updated for a
  new YA or Budget change, since nothing would keep the two in sync.
  """
  brackets, _ = brackets_for_year(ya)
  # Display-only guidance ("RM X of headroom left"): compute in float so the
  # float('inf') top band arithmetic works. Precision here is immaterial -
  # this figure is never summed into a filed total.
  chargeable_income = float(chargeable_income)
  floor = 0.0
  for i, (band_size, rate) in enumerate(brackets):
    ceiling = floor + band_size
    if chargeable_income < ceiling or band_size == float("inf"):
      next_rate = brackets[i + 1][1] if i + 1 < len(brackets) else None
      headroom = round(ceiling - chargeable_income, 2) if ceiling != float("inf") else None
      return {
        "currentMarginalRatePct":   round(rate * 100, 2),
        "nextMarginalRatePct":      round(next_rate * 100, 2) if next_rate is not None else None,
        "headroomToNextBracketMyr": headroom,
        "currentBandFloorMyr":      round(floor, 2),
        "currentBandCeilingMyr":    round(ceiling, 2) if ceiling != float("inf") else None,
      }
    floor = ceiling
  # Unreachable given the inf top band, but keep a safe fallback.
  return {
    "currentMarginalRatePct": None, "nextMarginalRatePct": None, "headroomToNextBracketMyr": None,
    "currentBandFloorMyr": None, "currentBandCeilingMyr": None,
  }