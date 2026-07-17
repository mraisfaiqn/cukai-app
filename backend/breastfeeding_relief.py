"""
H11 (breastfeeding equipment relief, paragraph 46(1)(q) ITA 1967) computation.

Added 14 Jul 2026 as part of completing Phase 2, replacing what used to be
deferred here pending exactly this kind of multi-year tracking (see
pipeline.py's category history).

RM1,000 cap for equipment (breast pump kit and ice pack; breast milk
collection/storage equipment; cooler set or cooler bag) purchased by a
breastfeeding mother for her own use, to breastfeed her own child aged 2
years or below. Allowed only ONCE EVERY TWO YEARS OF ASSESSMENT — e.g. a
claim in YA2024 makes the taxpayer ineligible for YA2025, with the next
eligible year being YA2026. This is a genuinely multi-year rule, so it can't
be enforced from a single year's documents in isolation — this module
re-derives eligibility for a target YA from the FULL claim history (every
year that has at least one BreastfeedingEquipmentClaim row), mirroring the
pattern in capital_allowance.py: nothing about eligibility is persisted
directly, it's recomputed fresh on every call, so a correction to an earlier
year's claim (e.g. deleting a misclassified document) automatically
corrects every later year's eligibility too.

Not modelled: LHDN's own worked example for this relief notes it's only
claimable on the WIFE's own filing, even under a joint assessment raised in
the husband's name — this system doesn't yet track filer gender or
joint-assessment aggregation (that's Phase 4), so this is flagged for manual
review rather than silently allowed or disallowed.
"""

from decimal import Decimal

from utils import money

H11_CAP_MYR = Decimal("1000")
H11_ELIGIBILITY_GAP_YEARS = 2  # "once every 2 years of assessment"


def compute_breastfeeding_relief_for_year(claims: list, target_year: int) -> dict:
  """
  Compute the H11 relief entry for one YA.

  `claims` is every BreastfeedingEquipmentClaim row for this user/entity
  across ALL years (not pre-filtered to target_year) — passed in full so the
  "once every 2 years" rule can look BACKWARD from target_year to find the
  most recent year the relief was actually GRANTED, rather than only ever
  inspecting target_year's own documents in isolation.

  Important distinction: a document can exist for a year (e.g. a user
  uploads a receipt every year without realising the 2-year rule) without
  that year's claim ever having been GRANTED — an ineligible year must NOT
  itself become a new anchor for the gate, or one blocked year would
  incorrectly cascade and keep blocking every year after it too. This is why
  eligibility is simulated chronologically below (year by year, up to and
  including target_year) rather than just checking "was there a claim in
  the single most recent year with documents" — that simpler check gives
  the wrong answer whenever a blocked year has a positive amount on file.
  """
  _ZERO = Decimal("0.00")

  result = {
    "label":             "Breastfeeding equipment (H11)",
    "isClaimYear":        False,
    "amountPurchasedMyr": _ZERO,
    "amountClaimedMyr":   _ZERO,
    "wasCapped":          False,
    "isEligibleYear":     True,
    "nextEligibleYear":   None,
    "needsReview":        False,
    "note":               None,
  }

  # Sum every claim BY YEAR so we can see how much was purchased each year.
  totals_by_year: dict[int, Decimal] = {}
  for c in claims:
    yr = c.year_of_assessment
    totals_by_year[yr] = totals_by_year.get(yr, Decimal("0")) + Decimal(c.amount or 0)

  raw_total_this_year = money(totals_by_year.get(target_year, Decimal("0")))
  result["amountPurchasedMyr"] = raw_total_this_year
  result["isClaimYear"] = raw_total_this_year > 0

  if not result["isClaimYear"]:
    result["note"] = "No qualifying documents for this relief in this year of assessment."
    return result

  # Simulate every year with a positive claim, in chronological order, UP TO
  # AND INCLUDING target_year, tracking only the most recent year the relief
  # was actually GRANTED (not just claimed) — a year is granted if there's no
  # prior grant yet, or the gap since the last grant is >= the statutory gap.
  claim_years_up_to_target = sorted(
    yr for yr, total in totals_by_year.items() if total > 0 and yr <= target_year
  )
  last_granted_year = None
  for yr in claim_years_up_to_target:
    if last_granted_year is None or (yr - last_granted_year) >= H11_ELIGIBILITY_GAP_YEARS:
      last_granted_year = yr
    # else: yr was blocked by the 2-year gate — does NOT become a new anchor.

  target_was_granted = last_granted_year == target_year
  if not target_was_granted:
    result["isEligibleYear"] = False
    # last_granted_year here is necessarily an EARLIER year than target_year
    # (since target_year itself wasn't granted), so this is well-defined.
    result["nextEligibleYear"] = (last_granted_year or target_year) + H11_ELIGIBILITY_GAP_YEARS

  if not result["isEligibleYear"]:
    # A document exists for this year, but the taxpayer already claimed H11
    # within the last H11_ELIGIBILITY_GAP_YEARS years — don't silently
    # absorb it as if it were a fresh eligible claim. Flag instead of
    # guessing which year should "win".
    result["needsReview"] = True
    result["note"] = (
      f"A breastfeeding equipment purchase was found for this year, but this relief was "
      f"already claimed in YA{last_granted_year} — it's only allowed once every "
      f"{H11_ELIGIBILITY_GAP_YEARS} years of assessment, so it isn't eligible again until "
      f"YA{result['nextEligibleYear']}. Excluded from this year's relief pending manual "
      "confirmation (e.g. if the earlier claim was made in error, or this purchase belongs "
      "to a different qualifying child)."
    )
    return result

  capped_amount = min(raw_total_this_year, H11_CAP_MYR)
  was_capped = raw_total_this_year > H11_CAP_MYR
  result["amountClaimedMyr"] = money(capped_amount)
  result["wasCapped"] = was_capped

  notes = []
  if was_capped:
    notes.append(f"Claimed amount exceeded the RM{H11_CAP_MYR:,.0f} cap — capped accordingly.")
  notes.append(
    "This relief is only available to a breastfeeding mother, for equipment purchased for "
    "her own use, for her own child aged 2 years or below — confirm these eligibility facts "
    "before filing, since they can't be verified from the invoice amount alone. It's also "
    "only claimable on the wife's own filing even under a joint assessment raised in the "
    "husband's name."
  )
  result["needsReview"] = True
  result["note"] = " ".join(notes)

  return result