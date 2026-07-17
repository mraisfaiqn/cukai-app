"""
Generic "claim once within a multi-year eligibility window" relief
computation. Added 15 Jul 2026 for Finance Act 2025 (Act 874) s.6(a)(vi),
which introduces three reliefs of exactly this shape at once (food waste
compost machine, food waste grinder machine, home CCTV) — deliberately
built generic (category + window supplied by the caller) rather than one
bespoke module per item, since this shape is likely to recur in future
Finance Acts.

This is a genuinely different eligibility shape from H11 (breastfeeding
relief, once every 2 years, recurring indefinitely — see
breastfeeding_relief.py) or capital allowance (an ongoing multi-year
schedule with no "used up" concept — see capital_allowance.py): here, the
relief is available for exactly one claim across its ENTIRE eligibility
window, and once used in any year within that window, it's gone for every
other year in the same window — there's no recurrence at all.

Like every other registry-backed relief in this codebase, nothing about a
target year's eligibility is stored directly — it's re-derived on every
call from the FULL claim history for this category, so a correction to an
earlier year's claim (e.g. deleting a misclassified document) automatically
corrects every other year's eligibility too.
"""

from decimal import Decimal

from utils import money


def compute_one_time_relief_for_year(
    claims: list,
    category: str,
    target_year: int,
    eligible_window: tuple,
) -> dict:
  """
  Compute the one-time-relief entry for one category, for one YA.

  `claims` is every OneTimeReliefClaim row for this user across ALL years
  and ALL categories (not pre-filtered) — this function does its own
  category and year scoping, mirroring breastfeeding_relief.py's own
  reasoning for why it takes the full history rather than a single year's
  documents in isolation.

  `eligible_window` is an inclusive (first_year, last_year) tuple — the
  window within which this relief may be claimed AT MOST ONCE, not once
  PER year in the window.

  Returns:
    isEligibleYear   — False if target_year falls outside eligible_window
                       at all, or if this category was already claimed in
                       an EARLIER year within the window.
    amountMyr        — 0 unless this year is both in-window and the first
                       claim within the window.
    alreadyClaimedYa — the earlier year this was claimed, if blocked for
                       that reason; else None.
    needsReview      — True whenever the figure shouldn't be silently
                       trusted (blocked, or multiple documents landed in
                       the same year for this one-time category).
    note             — human-readable explanation, or None if clean.
  """
  _ZERO = Decimal("0.00")
  first_year, last_year = eligible_window

  result = {
    "category":         category,
    "isEligibleYear":    True,
    "amountMyr":         _ZERO,
    "alreadyClaimedYa":  None,
    "needsReview":       False,
    "note":              None,
  }

  if not (first_year <= target_year <= last_year):
    result["isEligibleYear"] = False
    result["note"] = (
      f"This relief is only available for YA{first_year}"
      + (f"-{last_year}" if last_year != first_year else "")
      + f" — not eligible for YA{target_year}."
    )
    return result

  # Every claim for THIS category within the window, chronologically —
  # mirrors breastfeeding_relief.py's own "simulate chronologically" caution:
  # a document existing for a year doesn't necessarily mean the claim was
  # ever actually usable there, but for a flat "once ever in the window"
  # rule (unlike H11's recurring gate), the first claim chronologically is
  # simply the one that wins — there's no cascading-block subtlety here.
  same_category_in_window = sorted(
    (c for c in claims if c.category == category and first_year <= c.year_of_assessment <= last_year),
    key=lambda c: c.year_of_assessment,
  )

  if not same_category_in_window:
    # Nothing claimed at all — target_year is simply unused so far, which
    # is the ordinary case, not an anomaly.
    return result

  first_claim_year = same_category_in_window[0].year_of_assessment

  if first_claim_year != target_year:
    result["isEligibleYear"] = False
    result["alreadyClaimedYa"] = first_claim_year
    result["needsReview"] = True
    result["note"] = (
      f"Already claimed in YA{first_claim_year} — this relief may only be claimed once within "
      f"YA{first_year}-{last_year}, so it isn't eligible again this year."
    )
    return result

  # This year IS the first (and by construction, only) claim year.
  this_year_claims = [c for c in same_category_in_window if c.year_of_assessment == target_year]
  raw_total = money(sum(Decimal(c.amount or 0) for c in this_year_claims))
  result["amountMyr"] = raw_total

  if len(this_year_claims) > 1:
    # More than one document landed in the same year for a one-time-only
    # relief — plausible (e.g. duplicate upload, or genuinely two purchases
    # in the same year) but worth a human look rather than silently summing.
    result["needsReview"] = True
    result["note"] = (
      f"{len(this_year_claims)} documents were classified into this one-time relief for the same "
      "year — confirm this isn't a duplicate before relying on the combined amount."
    )

  return result


MAX_DEPARTURE_LEVY_TRIPS_LIFETIME = 2


def compute_departure_levy_rebate_for_year(claims: list, target_year: int) -> dict:
  """
  Compute the B27iii departure levy rebate for one YA, from the FULL
  lifetime claim history — a genuinely different shape from
  compute_one_time_relief_for_year above: the cap here is a COUNT of trips
  (2 IN A LIFETIME, per LHDN's own wording — "restricted to 2 trips in a
  lifetime"), not a claim-once-within-a-window test, and each qualifying
  trip gets its OWN rebate (the actual levy paid for that trip), not a
  shared ringgit pool.

  `claims` is every departure-levy claim on file for this user, across
  EVERY year this app has ever processed a document for — not just recent
  ones, since the lifetime count has no window to bound it. This means an
  important, unavoidable limitation: this app can only count trips it has
  actually seen a document for. It has no way to know about a trip claimed
  years before the user started uploading documents here, so the result
  is ALWAYS flagged for review rather than silently trusted, even when
  well within the cap — the honest position is "at least this many, as
  far as this app can see", not "definitely only this many, ever".

  Claims are ordered chronologically by year (then by whatever order they
  arrive from the DB query within the same year, since this app has no
  finer-grained date to break ties on across different receipts) — the
  first MAX_DEPARTURE_LEVY_TRIPS_LIFETIME claims chronologically are the
  ones that count; anything after that is blocked.
  """
  _ZERO = Decimal("0.00")

  result = {
    "amountMyr":        _ZERO,
    "tripsClaimedThisYear": 0,
    "tripsClaimedLifetimeBeforeThisYear": 0,
    "tripsBlockedThisYear": 0,
    "needsReview":      True,   # ALWAYS — see docstring; this app can never
                                # be certain of a taxpayer's full lifetime count.
    "note":             None,
  }

  ordered_claims = sorted(claims, key=lambda c: (c.year_of_assessment, c.id))

  trips_used_before_target_year = sum(1 for c in ordered_claims if c.year_of_assessment < target_year)
  this_year_claims = [c for c in ordered_claims if c.year_of_assessment == target_year]

  result["tripsClaimedLifetimeBeforeThisYear"] = trips_used_before_target_year

  remaining_allowance = max(0, MAX_DEPARTURE_LEVY_TRIPS_LIFETIME - trips_used_before_target_year)
  allowed_this_year = this_year_claims[:remaining_allowance]
  blocked_this_year = this_year_claims[remaining_allowance:]

  result["tripsClaimedThisYear"] = len(allowed_this_year)
  result["tripsBlockedThisYear"] = len(blocked_this_year)
  result["amountMyr"] = money(sum(Decimal(c.amount or 0) for c in allowed_this_year))

  notes = [
    "This app can only count departure-levy trips it has actually seen a document for — "
    "it cannot know about a trip claimed before you started uploading documents here. "
    "Confirm this is genuinely within your 2-trips-in-a-lifetime allowance before filing."
  ]
  if blocked_this_year:
    notes.append(
      f"{len(blocked_this_year)} of this year's departure levy document(s) were excluded — "
      f"{trips_used_before_target_year} trip(s) already counted in earlier years, leaving only "
      f"{remaining_allowance} of the lifetime allowance for this year."
    )
  result["note"] = " ".join(notes)

  return result