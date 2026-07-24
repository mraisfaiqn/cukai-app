"""
CP500 self-installment (s.107B ITA 1967) reconciliation for Form B's B33
"Self-Installments / CP500" line.

Added 15 Jul 2026 to fix a real bug found in production review: `main.py`
was previously summing every "Q3 — CP500 / Tax Installment" document's
`installment_amount` into B33 unconditionally — with no distinction between
a CP500 INSTALLMENT NOTICE (LHDN's schedule of what's due, not yet paid) and
a CP500 PAYMENT RECEIPT (proof an installment was actually paid). A user who
uploaded only the notice — e.g. to have it on file, without ever having
paid it — had that scheduled-but-unpaid amount silently counted as if paid,
directly corrupting B33 and (via B31/B32) the tax-payable/refund figure.

HK-10's own instruction is explicit: B33 must reflect installments ACTUALLY
PAID for THIS year of assessment, and must NOT include "payments made in
respect of outstanding tax for previous years of assessment." That's a
genuinely multi-year reconciliation problem — the correct figure for target
year Y depends on being able to tell a notice from a receipt, and on
attributing each receipt to the YA its installment scheme was actually for
(not just the calendar date the bank transfer happened to clear) — so this
follows the same "recompute fresh from the full history" pattern as
capital_allowance.py, breastfeeding_relief.py, and carryforward.py: nothing
about a target year's B33 figure is persisted directly, it's re-derived on
every call from every CP500Record row on file, so correcting a
misclassified document (e.g. a receipt wrongly tagged to the wrong YA)
automatically corrects every affected year's figure.

Not modelled (until the extension below): matching an individual payment
to a specific installment NUMBER within the year's schedule (e.g. "this was
installment 3 of 6") — compute_cp500_for_year() only ever produces the
year-level totals needed for B33 and does not (and must not) change.
compute_cp500_schedule_status(), added below, is a SEPARATE, purely
informational computation for the Overview dashboard's "next installment
due" tracker — its output never feeds into B33/B31/B32.
"""

from datetime import date
from decimal import Decimal

from utils import money

# HK-10 / B33 tolerance: a payment total up to this many ringgit ABOVE the
# scheduled total is treated as an ordinary rounding/timing difference (e.g.
# LHDN revises the schedule mid-year) rather than flagged for review. Above
# this, overpayment is unusual enough to be worth a human look before it's
# trusted as this year's own figure rather than, say, a misattributed
# following-year installment paid early.
OVERPAYMENT_REVIEW_THRESHOLD_MYR = Decimal("50")

# LHDN's fixed bimonthly CP500 due dates for individuals/sole proprietors
# (s.107B ITA 1967) — the same six dates every year, expressed as
# (month, day, year_offset), where year_offset=1 means "in January of the
# YEAR AFTER the YA" (the 6th and final installment). These are LHDN's own
# published due dates — fixed calendar points, not derived from anything
# printed on any individual notice.
CP500_STANDARD_DUE_DATES = (
  (3, 31, 0),   # Installment 1 — 31 March
  (5, 31, 0),   # Installment 2 — 31 May
  (7, 31, 0),   # Installment 3 — 31 July
  (9, 30, 0),   # Installment 4 — 30 September
  (11, 30, 0),  # Installment 5 — 30 November
  (1, 31, 1),   # Installment 6 — 31 January of the FOLLOWING year
)


def compute_cp500_for_year(records: list, target_year: int) -> dict:
  """
  Compute the B33iii CP500 figure for one YA from the FULL CP500Record
  history (every 'notice' and 'payment' row on file for this person, across
  all years — not pre-filtered to target_year, so this function can do its
  own year-scoping and cross-year sanity checks).

  `records` is a list of CP500Record rows (or anything exposing the same
  attributes: record_type ('notice'|'payment'), year_of_assessment, amount,
  event_date, reference_no, id). Scoped to one PERSON, not one entity — a
  sole proprietor's CP500 installment scheme covers their aggregate estimated
  tax, not any single business, the same reasoning multi-entity B1
  aggregation already uses (see Phase 1 of the roadmap).

  Returns:
    totalPaidMyr        — feeds B33iii directly. ONLY 'payment' records
                           attributed to target_year are ever summed here;
                           a 'notice' amount never contributes to this
                           figure under any circumstance.
    totalScheduledMyr    — informational only (what LHDN's own notice says
                           is due for the year) — never fed into B33.
    wasFullyPaid         — totalPaidMyr >= totalScheduledMyr, when a
                           schedule exists to compare against.
    hasNoticeOnFile       — whether any notice exists for this year at all.
    hasPaymentOnFile      — whether any payment exists for this year at all.
    needsReview          — True whenever the figure shouldn't be silently
                           trusted (see note for the specific reason).
    note                 — human-readable explanation, or None if clean.
  """
  _ZERO = Decimal("0.00")

  result = {
    "totalPaidMyr":      _ZERO,
    "totalScheduledMyr": _ZERO,
    "wasFullyPaid":       None,   # None = "no schedule to compare against"
    "hasNoticeOnFile":    False,
    "hasPaymentOnFile":   False,
    "needsReview":        False,
    "note":               None,
  }

  # Scope to this target year only — B33 must NEVER include a payment
  # attributed to a different YA's installment scheme, even if the bank
  # transfer cleared during the target year's calendar dates (a late
  # payment against last year's outstanding CP500 balance is explicitly
  # excluded by HK-10's own wording).
  notices_this_year  = [r for r in records if r.record_type == "notice"  and r.year_of_assessment == target_year]
  payments_this_year = [r for r in records if r.record_type == "payment" and r.year_of_assessment == target_year]

  total_scheduled = money(sum(Decimal(r.amount or 0) for r in notices_this_year))
  total_paid      = money(sum(Decimal(r.amount or 0) for r in payments_this_year))

  result["totalScheduledMyr"] = total_scheduled
  result["totalPaidMyr"]      = total_paid
  result["hasNoticeOnFile"]   = len(notices_this_year) > 0
  result["hasPaymentOnFile"]  = len(payments_this_year) > 0

  notes = []

  if not notices_this_year and not payments_this_year:
    # Nothing at all for this year — B33iii is correctly 0, no note needed;
    # this is the ordinary case for most years, not an anomaly.
    return result

  if notices_this_year and not payments_this_year:
    # A schedule is on file but no evidence of actual payment — B33 stays
    # at 0 (correct: notices never count), but the user should know why
    # their scheduled installments aren't showing up as a B33 deduction.
    result["needsReview"] = True
    notes.append(
      f"A CP500 installment notice for RM{total_scheduled:,.2f} is on file for this year, but no "
      "payment receipts have been uploaded yet — B33 reflects installments actually PAID, so it "
      "stays at RM0.00 until payment evidence is provided."
    )

  if payments_this_year and not notices_this_year:
    # Payments exist with no matching notice — could be legitimate (the
    # notice was never uploaded, only the receipts) but worth a light flag
    # since there's nothing to cross-check the payment total against.
    result["needsReview"] = True
    notes.append(
      "Payment receipt(s) found for this year with no matching CP500 installment notice on file — "
      "the paid total is used for B33, but consider uploading the notice as well so the amount can "
      "be cross-checked against LHDN's own schedule."
    )

  if notices_this_year and payments_this_year:
    result["wasFullyPaid"] = total_paid >= total_scheduled
    shortfall = money(total_scheduled - total_paid)
    overpayment = money(total_paid - total_scheduled)
    if shortfall > 0:
      # Under-payment is completely normal mid-year (installments are paid
      # progressively), so this is informational, not a review flag, unless
      # the filing year itself has already closed — this module has no
      # concept of "today's date" so it can't distinguish those cases; the
      # caller (main.py) is better placed to decide whether a shortfall in
      # the CURRENT filing year is expected-and-fine vs. a closed prior
      # year that should have been fully settled.
      notes.append(f"RM{shortfall:,.2f} of the scheduled CP500 installments for this year appears unpaid.")
    elif overpayment > OVERPAYMENT_REVIEW_THRESHOLD_MYR:
      result["needsReview"] = True
      notes.append(
        f"Payments (RM{total_paid:,.2f}) exceed the scheduled installments (RM{total_scheduled:,.2f}) "
        f"by RM{overpayment:,.2f} — confirm this isn't a payment meant for a different year of "
        "assessment before relying on this figure."
      )

  if notes:
    result["note"] = " ".join(notes)

  return result


def cp500_standard_schedule(target_year: int, total_scheduled: Decimal) -> list:
  """
  Build the 6-installment bimonthly schedule LHDN actually uses for a CP500
  scheme, splitting `total_scheduled` evenly across the 6 fixed due dates
  in CP500_STANDARD_DUE_DATES.

  Real CP500 notices split the year's estimated tax into 6 EQUAL
  installments (LHDN's own s.107B notices work this way) — but this module
  only ever sees the notice's extracted TOTAL for the year (CP500Record
  stores one row per document with a single `amount`, not a per-line
  breakdown), so an even split is the only option available today. If a
  future extraction pass captures the notice's own per-line amounts
  (uneven schedules are possible after a CP502 revision), this is the
  function to extend to prefer those over the even split.

  Any rounding remainder from dividing by 6 is absorbed into the LAST
  installment, so the six lines always sum back to exactly total_scheduled.
  """
  if total_scheduled is None or total_scheduled <= 0:
    return []

  per_installment = money(total_scheduled / 6)
  first_five_total = money(per_installment * 5)
  last_installment = money(total_scheduled - first_five_total)

  schedule = []
  for i, (month, day, year_offset) in enumerate(CP500_STANDARD_DUE_DATES, start=1):
    amount = last_installment if i == 6 else per_installment
    schedule.append({
      "installmentNo": i,
      "dueDate":      date(target_year + year_offset, month, day),
      "amountMyr":    amount,
    })
  return schedule


def compute_cp500_schedule_status(records: list, target_year: int) -> dict:
  """
  Allocate this year's CP500 PAYMENTS against the standard 6-installment
  bimonthly schedule (FIFO by installment due-date order) to answer "how
  many installments are fully covered so far, and what/when is the next one
  actually due". Purely informational for the Overview dashboard's CP500
  tracker — this NEVER feeds into B33/B31/B32; compute_cp500_for_year()
  remains the only source for those figures, untouched by this function.

  A combined/lump-sum receipt (e.g. one payment covering two installments
  at once, or a payment made ahead of its due date) is allocated purely by
  running total against the schedule's amounts, in due-date order — NOT by
  whatever installment number(s) the receipt's own text claims to cover.
  This is deliberate: a person who pays RM200 against two RM100 installments
  in one transaction is "ahead of schedule" by the same amount regardless
  of how the receipt happens to describe itself.

  Returns:
    totalInstallments            — always 6.
    installmentsCoveredCount     — how many installments (in due-date order)
                                   are fully paid off by the running total.
    nextInstallmentNo            — 1-6, or None if every installment for the
                                   year is already fully covered.
    nextInstallmentDueDate       — ISO date string, or None (see above).
    nextInstallmentAmountDueMyr  — remaining amount owed on that installment
                                   (0 only if it's about to become "covered"
                                   the moment the next payment posts).
    schedule                    — the full 6-line schedule (installmentNo,
                                   dueDate as a date object, amountMyr),
                                   for any caller that wants to render the
                                   whole year, not just "what's next".
  """
  _ZERO = Decimal("0.00")
  result = {
    "totalInstallments":           6,
    "installmentsCoveredCount":    0,
    "nextInstallmentNo":           None,
    "nextInstallmentDueDate":      None,
    "nextInstallmentAmountDueMyr": _ZERO,
    "schedule":                   [],
  }

  notices_this_year = [r for r in records if r.record_type == "notice" and r.year_of_assessment == target_year]
  total_scheduled = money(sum(Decimal(r.amount or 0) for r in notices_this_year))
  if total_scheduled <= 0:
    # No notice on file for this year — nothing to allocate payments
    # against yet, so there's no "next due" to show.
    return result

  schedule = cp500_standard_schedule(target_year, total_scheduled)
  result["schedule"] = schedule

  payments_this_year = [r for r in records if r.record_type == "payment" and r.year_of_assessment == target_year]
  total_paid = money(sum(Decimal(r.amount or 0) for r in payments_this_year))

  remaining = total_paid
  covered_count = 0
  for line in schedule:
    if remaining >= line["amountMyr"]:
      remaining = money(remaining - line["amountMyr"])
      covered_count += 1
    else:
      break

  result["installmentsCoveredCount"] = covered_count
  if covered_count < len(schedule):
    next_line = schedule[covered_count]
    result["nextInstallmentNo"]           = next_line["installmentNo"]
    result["nextInstallmentDueDate"]      = next_line["dueDate"].isoformat()
    result["nextInstallmentAmountDueMyr"] = money(next_line["amountMyr"] - remaining)

  return result