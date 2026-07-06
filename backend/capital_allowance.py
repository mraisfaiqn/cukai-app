"""
Schedule 3 (ITA 1967) capital allowance computation.

Malaysian capital allowance is straight-line, not reducing-balance:
  - Initial Allowance (IA) is a fixed % of original cost, granted ONCE, in the
    year of acquisition.
  - Annual Allowance (AA) is a fixed % of original cost, granted every year
    the asset remains in use, until the accumulated allowances (IA + AA)
    equal the original cost — at which point the asset is fully written down
    and no further allowance is given.
  - On disposal, the difference between disposal proceeds and the written-down
    value (WDV) at disposal is either a balancing allowance (extra deduction,
    if proceeds < WDV) or a balancing charge (taxable add-back, if proceeds >
    WDV).

This module computes that schedule for a single target year of assessment,
purely from the facts on a CapitalAsset row (cost, rates, acquisition year,
disposal year/proceeds). Nothing about the schedule itself is stored — it's
re-derived on every call, so it can never drift out of sync with the asset
record, and a rate correction on the asset automatically corrects every past
and future year's figures.
"""

from decimal import Decimal

from utils import money


# ── Standard Schedule 3 rates (ITA 1967) ─────────────────────────────────────
# IA/AA percentages by broad asset class. These are the STANDARD rates:
#   heavy machinery / motor vehicles  IA 20% / AA 20%
#   general plant & machinery          IA 20% / AA 14%
#   office equipment, furniture, fit.  IA 20% / AA 10%
#   industrial building                IA 10% / AA  3%
# Accelerated regimes (ICT/computers, green tech, SME small-value) and the
# private motor-vehicle QE cap (RM50k/RM100k) are NOT modelled here and still
# need manual/agent review. Verify against the current LHDN Public Ruling before
# relying on these for a filing.
SCHEDULE_3_STANDARD_RATES = {
  "heavy_machinery":     {"ia": 20, "aa": 20},
  "motor_vehicle":       {"ia": 20, "aa": 20},
  "plant_machinery":     {"ia": 20, "aa": 14},
  "office_equipment":    {"ia": 20, "aa": 10},
  "furniture":           {"ia": 20, "aa": 10},
  "industrial_building": {"ia": 10, "aa":  3},
}

# Keyword → canonical class. First match wins, so order matters: the more
# specific classes are checked before the generic "plant_machinery" catch-all.
_ASSET_CLASS_ALIASES = [
  (("heavy machinery", "excavator", "bulldozer", "crane", "tractor", "loader", "forklift", "roller"), "heavy_machinery"),
  (("motor vehicle", "vehicle", "lorry", "truck", "van", "car", "motorcycle", "motorbike"), "motor_vehicle"),
  (("industrial building", "factory", "warehouse", "industrial"), "industrial_building"),
  (("office equipment", "printer", "photocopier", "scanner", "telephone"), "office_equipment"),
  (("furniture", "fitting", "fixture", "fit-out", "fit out"), "furniture"),
  (("plant", "machinery", "machine", "equipment", "compressor", "air cond", "aircond", "lift", "oven"), "plant_machinery"),
]


def canonical_asset_class(asset_class):
  """Map a free-text asset class to a canonical Schedule 3 class, or None."""
  s = (asset_class or "").lower()
  if not s:
    return None
  for keywords, key in _ASSET_CLASS_ALIASES:
    if any(k in s for k in keywords):
      return key
  return None


def _clamp_rate(v):
  try:
    return max(0, min(100, int(round(float(v)))))
  except (TypeError, ValueError):
    return None


def resolve_capital_allowance_rates(asset_class, llm_ia_rate, llm_aa_rate):
  """
  Decide the IA/AA percentages to persist for an asset, keeping LLM output from
  flowing unchecked into the tax computation.

  Returns (ia_pct, aa_pct, needs_review, note):
    - For a RECOGNISED asset class, the statutory Schedule 3 rate is the source
      of truth; if the LLM's value disagreed, it's overridden and noted.
    - For an UNRECOGNISED class, the LLM's rates are kept but clamped to 0..100
      and flagged for review (or defaulted to 0 and flagged if unparseable).
    - Motor vehicles are always flagged (private-use QE cap not applied here).
  """
  li, la = _clamp_rate(llm_ia_rate), _clamp_rate(llm_aa_rate)
  key = canonical_asset_class(asset_class)

  if key:
    std = SCHEDULE_3_STANDARD_RATES[key]
    note = None
    if (li is not None and li != std["ia"]) or (la is not None and la != std["aa"]):
      note = (
        f"Extracted IA/AA ({li}%/{la}%) replaced with the standard Schedule 3 rate "
        f"for {key.replace('_', ' ')} ({std['ia']}%/{std['aa']}%)."
      )
    needs_review = False
    if key == "motor_vehicle":
      needs_review = True
      note = (note + " " if note else "") + (
        "Private motor-vehicle qualifying expenditure is capped (RM50k/RM100k) — "
        "confirm the cap and business-use proportion."
      )
    return std["ia"], std["aa"], needs_review, note

  if li is None or la is None:
    return (li or 0), (la or 0), True, (
      "Asset class not recognised and IA/AA rates were missing or unparseable — "
      "defaulted to 0%. Enter the correct Schedule 3 rates before filing."
    )
  return li, la, True, (
    f"Asset class not recognised; using extracted IA/AA rates ({li}%/{la}%) "
    "unverified — confirm against Schedule 3."
  )


def compute_capital_allowance_for_year(asset, target_year: int) -> dict:
  """
  Compute the capital allowance schedule entry for one asset, for one YA.

  `asset` is a CapitalAsset model instance (or anything exposing the same
  attributes: cost, ia_rate_pct, aa_rate_pct, acquisition_year,
  disposal_year, disposal_proceeds, id, asset_class, description).
  """
  # Money is Decimal throughout so multi-year IA/AA accumulation and the
  # written-down-value walk don't drift on repeated rounding. cost/proceeds
  # come off Numeric columns (already Decimal); rates are integer percents.
  cost      = Decimal(asset.cost or 0)
  ia_rate   = Decimal(asset.ia_rate_pct or 0) / Decimal(100)
  aa_rate   = Decimal(asset.aa_rate_pct or 0) / Decimal(100)
  acq_year  = asset.acquisition_year
  ia_amount = money(cost * ia_rate)
  aa_amount = money(cost * aa_rate)

  # Sub-cent threshold below which the asset is treated as fully written down.
  _EPS = Decimal("0.005")
  _ZERO = Decimal("0.00")

  result = {
    "assetId":                   asset.id,
    "assetClass":                asset.asset_class,
    "description":                asset.description,
    "costMyr":                    money(cost),
    "acquisitionYear":             acq_year,
    "iaRatePct":                   asset.ia_rate_pct,
    "aaRatePct":                   asset.aa_rate_pct,
    "isAcquisitionYear":           target_year == acq_year,
    "initialAllowanceMyr":         _ZERO,
    "annualAllowanceMyr":          _ZERO,
    "totalAllowanceThisYearMyr":   _ZERO,
    "writtenDownValueEndMyr":      money(cost),
    "isFullyWrittenDown":          False,
    "balancingAllowanceMyr":       _ZERO,
    "balancingChargeMyr":          _ZERO,
    "needsReview":                 False,
    "note":                        None,
  }

  if target_year < acq_year:
    result["note"] = "Not yet acquired in this year of assessment."
    return result

  disposal_year = asset.disposal_year
  if disposal_year is not None and target_year > disposal_year:
    result["note"] = "Disposed in a prior year of assessment; no further allowance."
    result["writtenDownValueEndMyr"] = _ZERO
    result["isFullyWrittenDown"] = True
    return result

  # Walk the straight-line schedule year by year to find the written-down
  # value entering target_year — needed because the final year's AA (and any
  # balancing figure on disposal) is capped by whatever remains of the
  # original cost, not the full nominal AA amount.
  wdv = money(cost)
  for yr in range(acq_year, target_year + 1):
    is_disposal_year = disposal_year is not None and yr == disposal_year
    if wdv <= _EPS or is_disposal_year:
      # No ordinary IA/AA accrues in the disposal year itself — the disposal
      # is settled via the balancing allowance/charge below, against the WDV
      # brought forward from the end of the prior year.
      year_ia, year_aa = _ZERO, _ZERO
    elif yr == acq_year:
      year_ia = min(ia_amount, wdv)
      wdv = money(wdv - year_ia)
      year_aa = min(aa_amount, wdv)
      wdv = money(wdv - year_aa)
    else:
      year_ia = _ZERO
      year_aa = min(aa_amount, wdv)
      wdv = money(wdv - year_aa)

    if yr == target_year:
      result["initialAllowanceMyr"]       = money(year_ia)
      result["annualAllowanceMyr"]        = money(year_aa)
      result["totalAllowanceThisYearMyr"] = money(year_ia + year_aa)
      result["writtenDownValueEndMyr"]    = money(wdv)
      result["isFullyWrittenDown"]        = wdv <= _EPS

  # Disposal in the target year — balancing allowance / balancing charge.
  # This is a genuinely nuanced area of ITA 1967 (controlled transfers,
  # related-party sales, and partial business use all change the treatment),
  # so this is flagged for review rather than silently trusted like a normal
  # AA figure.
  if disposal_year == target_year and asset.disposal_proceeds is not None:
    proceeds = Decimal(asset.disposal_proceeds)
    wdv_at_disposal = result["writtenDownValueEndMyr"]
    if proceeds < wdv_at_disposal:
      result["balancingAllowanceMyr"] = money(wdv_at_disposal - proceeds)
    elif proceeds > wdv_at_disposal:
      total_allowances_claimed = money(cost - wdv_at_disposal)
      result["balancingChargeMyr"] = money(min(proceeds - wdv_at_disposal, total_allowances_claimed))
    result["needsReview"] = True
    result["note"] = (
      "Asset disposed this year — balancing allowance/charge shown is a standard-case "
      "estimate. Confirm with a tax agent, especially if this was a controlled or "
      "related-party transfer."
    )

  return result