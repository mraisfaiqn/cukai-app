"""
Iteration 3 — the real main.py cutover.

This replaces the per-document dispatch block inside _build_year_summary
(the part that currently branches on `quadrant`/`tax_status`/individual
category-name checks) with one driven entirely by the registry's `bucket`
and `document_role`. Nothing else in _build_year_summary changes — relief-
cap-group tiering, donation tiering, carryforward, joint-assessment, H16,
reconciliation, and the final totals assembly are UNTOUCHED by this file.

Two new output lists are added to the function's return dict (see the
bottom of this file for exactly where):
  registryManagedDocuments — replaces every scattered "pass # handled via
    registry below, not per-document" no-op (capital assets, CP500, H11,
    food waste x2, CCTV, departure levy) with ONE visible
    list, so a registry-managed document is always shown somewhere,
    never silently absent (this is the actual fix for issue #2).
  categoryDeprecatedDocuments — surfaces any document whose stored
    category no longer exists in CATEGORY_REGISTRY at all (the T1
    migration case), each with an explicit "please reclassify" prompt.

Import this at the top of main.py, alongside the existing pipeline import:

    from category_registry import CATEGORY_REGISTRY, CATEGORY_BUCKET, CATEGORY_TAX_TREATMENT
    from taxonomy_classification import derive_document_role, derive_aggregation_state, validate_category
"""

from decimal import Decimal
from utils import money, parse_amount as _parse_amount

from category_registry import CATEGORY_BUCKET, CATEGORY_TAX_TREATMENT, registry_schedule_note
from taxonomy_classification import derive_document_role, derive_aggregation_state


def dispatch_document(
  doc, ed: dict, entry: dict, target_year: int, is_married: bool,
  # Output collections — same objects _build_year_summary already
  # maintains locally; passed in so this function has no globals of its own.
  income_q1: list, income_q2: list, deductions_q3: list,
  reliefs_q4: list, non_deductible_q4: list,
  zakat_entries: list, section110_entries: list, section107d_entries: list,
  donation_entries_by_gline: dict, DONATION_CATEGORY_TO_GLINE: dict,
  reference_documents: list, bank_statement_reviews: list,
  k_disclosures: list, mixed_pending: list,
  registry_managed_documents: list, category_deprecated_documents: list,
  # Year-gated constants/results already computed earlier in
  # _build_year_summary — passed straight through unchanged.
  H12_CARE_CENTRE_BAND_YA: int, H6_VACCINATION_NPRA_EXPANSION_YA: int,
  H6_VACCINATION_PRE_2026_FIXED_LIST: tuple, H17_CHILD_LIFE_INSURANCE_YA: int,
  _one_time_relief_results: dict,
) -> None:
  """
  Route ONE document to its correct downstream bucket. Called once per
  document inside _build_year_summary's main loop, replacing the entire
  old `if quadrant == "Q1": ... elif quadrant == "Q2": ...` chain.
  """
  category = doc.category or ""
  confidence = ed.get("confidence", 0) or 0

  # CRITICAL: always recompute fresh from the registry — NEVER read
  # document_role/aggregation_state back from extracted_data. Every
  # document classified before this redesign already has these fields
  # populated with OLD-vocabulary values ("schedule_source",
  # "summary_statement", "excluded_by_rule"), which don't match any of the
  # new checks below and would silently fall through to the wrong branch —
  # confirmed on real data via dispatch_comparison.py, where this exact
  # bug caused a Capital Asset purchase to be double-counted as a full Q3
  # deduction on top of its own separate capital-allowance schedule. The
  # persisted fields are still WRITTEN for display purposes elsewhere, but
  # must never be READ back and trusted for a routing decision.
  document_role = derive_document_role(category)
  aggregation_state = derive_aggregation_state(
    category, confidence, ed.get("deductible_pct"), bool(ed.get("bank_statement_reviewed"))
  )
  entry["documentRole"] = document_role
  entry["aggregationState"] = aggregation_state
  entry["needsReview"] = aggregation_state in ("needs_apportionment", "needs_user_confirmation")

  # ── T1 migration case: category no longer exists at all ──────────────
  if document_role == "unrecognized_category":
    category_deprecated_documents.append({
      **entry,
      "reason": f"This document's category ('{category}') is no longer supported — please reclassify it.",
    })
    if entry["needsReview"]:
      mixed_pending.append({
        **entry, "reason": entry["reason"],
        "question": "Reclassify this document using the current category list.",
      })
    return

  # ── Bank statement — many lines, matched individually, never a lump sum ──
  if document_role == "ledger_source":
    line_items = ed.get("line_items", [])
    is_reviewed = bool(ed.get("bank_statement_reviewed"))
    bank_statement_reviews.append({
      **entry, "summary": ed.get("bank_statement_summary"),
      "reviewed": is_reviewed,
      "unmatchedLines": [
        li for li in line_items
        if li.get("matchStatus") in ("unmatched_credit", "unmatched_debit", "unmatched")
      ],
    })
    # Bug fix (found in testing): previously returned here unconditionally,
    # so a bank statement NEVER appeared in mixed_pending — meaning
    # pendingReviewCount (which drives the Overview action banner) never
    # counted it, even though the SAME document's own aggregationState
    # field correctly showed "needs_user_confirmation" and drove
    # CukaiAccount's per-document badge/filter. Two signals, only one of
    # them right. Now: an unreviewed statement correctly appears in both;
    # once marked reviewed (see PATCH /api/documents/{id}/mark-reviewed),
    # it correctly disappears from both, instead of sitting in "needs
    # review" forever with no way to ever resolve it.
    if not is_reviewed:
      mixed_pending.append({
        **entry, "reason": "This bank statement has unmatched transaction lines that may need a supporting document.",
        "question": "Review the unmatched lines, then mark this statement as reviewed once you've confirmed nothing is missing.",
      })
    return

  # ── Reference bucket — never summed; sub-typed for WHY it's here ──────
  if document_role == "reference_document":
    from category_registry import CATEGORY_REGISTRY
    reference_type = CATEGORY_REGISTRY[category].reference_type
    if category == "Q1 — Capital Gains (s.4aa)":
      reference_documents.append({
        **entry, "referenceType": reference_type,
        "cgtDisposalConsideration": ed.get("cgt_disposal_consideration"),
        "cgtAcquisitionCost":       ed.get("cgt_acquisition_cost"),
        "cgtGainLoss":              ed.get("cgt_gain_loss"),
      })
    elif category == "Q1 — Voluntary Disclosure (Prior Year Income)":
      k_disclosures.append({
        **entry, "referenceType": reference_type,
        "incomeType":  ed.get("income_type"),
        "disclosedYa": ed.get("disclosed_ya"),
      })
    elif reference_type == "out_of_scope":
      reference_documents.append({
        **entry, "referenceType": reference_type,
        "note": (
          "This document type is outside this app's current scope — "
          "consult a tax agent for the relevant Form B section."
        ),
      })
    else:
      reference_documents.append({**entry, "referenceType": reference_type, "lineItems": ed.get("line_items", [])})
    return

  # ── Registry-managed — the actual fix for issue #2. Every category that
  # used to get its own hand-written "pass # handled elsewhere" no-op
  # (capital assets, CP500 x2, H11, food waste x2, CCTV, departure levy,
  # hire purchase — since fixed, see below) now lands in exactly ONE place, always visible. ──────
  if document_role == "registry_managed":
    bucket = CATEGORY_BUCKET[category]
    registry_managed_documents.append({
      **entry, "bucket": bucket,
      "note": registry_schedule_note(category),
    })
    return

  # ── Non-tax — genuinely nothing to compute or show ────────────────────
  if document_role == "non_tax":
    return

  # ── needs_classification (REVIEW bucket) — still flag, nothing to sum ──
  if document_role == "needs_classification":
    mixed_pending.append({
      **entry, "reason": ed.get("reason"), "question": ed.get("question"), "source": ed.get("source"),
    })
    return

  # ══════════════════════════════════════════════════════════════════
  # From here down: document_role == "transaction" — bucket decides
  # where it goes. This replaces the old quadrant-based branching.
  # ══════════════════════════════════════════════════════════════════
  bucket = CATEGORY_BUCKET[category]
  amount = entry["amountNumeric"]

  if bucket == "Q1":
    if aggregation_state == "resolved":
      income_q1.append(entry)

  elif bucket == "Q2":
    if aggregation_state == "resolved":
      income_q2.append({**entry, "formEa": ed.get("form_ea"), "fsiSourceCountry": ed.get("fsi_source_country")})

  elif bucket == "Q3":
    if aggregation_state == "resolved":
      _ded_pct = ed.get("deductible_pct")
      deductible = money(amount * Decimal(_ded_pct) / Decimal(100)) if _ded_pct is not None else amount
      deductions_q3.append({**entry, "deductibleNumeric": deductible, "deductiblePct": _ded_pct})

  elif bucket == "DONATIONS":
    gline = DONATION_CATEGORY_TO_GLINE.get(category)
    if gline and aggregation_state == "resolved":
      donation_entries_by_gline[gline].append({**entry, "reliefCapMyr": ed.get("relief_cap_myr")})

  elif bucket == "TAX_INSTALMENTS":
    # Section 107D is the only DIRECT (non-registry) TAX_INSTALMENTS member
    # left here — CP500 is always registry_managed (handled above).
    if category == "Q4 — Section 107D Withholding" and aggregation_state == "resolved":
      section107d_entries.append({**entry, "reliefCapMyr": ed.get("relief_cap_myr")})

  elif bucket == "REBATES":
    # Zakat and Section 110 are direct; Departure Levy is registry_managed
    # and never reaches this branch (handled above).
    if category == "Q4 — Zakat" and aggregation_state == "resolved":
      zakat_entries.append({**entry, "zakatAmount": ed.get("zakat_amount")})
    elif category == "Q4 — Section 110 Withholding (Others)" and aggregation_state == "resolved":
      section110_entries.append({**entry, "reliefCapMyr": ed.get("relief_cap_myr")})

  elif bucket == "Q4":
    relief_entry = {**entry, "reliefCapMyr": ed.get("relief_cap_myr")}

    # ── The genuine per-category tax-rule checks (DSW registration, H12
    # age band, H6 vaccination NPRA scope, H6(ii) marital status, H17
    # child-life-policy scope, one-time relief window) are preserved
    # UNCHANGED from the old code below — these are real statutory rules,
    # not classification bugs, so they don't move just because the
    # dispatch mechanism around them changed. ──────────────────────────

    if CATEGORY_TAX_TREATMENT[category] == "non_deductible":
      non_deductible_q4.append(entry)
      return

    if category == "Q4 — Medical Equipment Relief":
      dsw = (ed.get("dsw_registered") or "unclear").lower()
      dsw_note = {
        "yes":     "The document indicates DSW registration — confirm this matches your actual DSW/JKM registration before filing.",
        "no":      "The document indicates the disabled person is NOT registered with DSW — this relief is not allowed unless DSW registration is confirmed. Excluded pending correction.",
        "unclear": "This relief requires the disabled person (self/spouse/child/parent) to be registered with the Department of Social Welfare (DSW) — a purchase receipt alone can't confirm this. Confirm registration before filing.",
      }.get(dsw, "Confirm DSW registration for the disabled person before filing.")
      if dsw == "no":
        non_deductible_q4.append({**entry, "reason": dsw_note})
        mixed_pending.append({**entry, "amount": str(amount), "needsReview": True, "reason": dsw_note,
                               "question": "This claim is currently excluded — confirm DSW registration to include it."})
      elif aggregation_state == "resolved":
        reliefs_q4.append({**relief_entry, "needsReview": True, "reason": dsw_note})
        mixed_pending.append({**entry, "amount": str(amount), "needsReview": True, "reason": dsw_note,
                               "question": "Confirm DSW/JKM registration for the disabled person before filing."})
      return

    if category == "Q4 — Childcare Fees":
      reg = (ed.get("provider_registration_status") or "unclear").lower()
      age_band = (ed.get("child_age_band") or "unclear").lower()
      if age_band == "over 12":
        non_deductible_q4.append({**entry, "reason": "Child is over 12 — H12 does not apply at any age above 12, even from YA2026."})
      elif age_band == "7 to 12" and target_year < H12_CARE_CENTRE_BAND_YA:
        non_deductible_q4.append({**entry, "reason": f"The 7-12 age band for H12 only applies from YA{H12_CARE_CENTRE_BAND_YA} onward — not eligible for this filing year."})
      elif aggregation_state == "resolved":
        entry_out = {**relief_entry}
        if reg == "unclear":
          reason = "Could not confirm provider registration from this receipt — confirm before filing."
          entry_out["needsReview"] = True
          entry_out["reason"] = reason
          mixed_pending.append({**entry, "amount": str(amount), "needsReview": True, "reason": reason,
                                 "question": "Confirm this childcare provider is registered."})
        reliefs_q4.append(entry_out)
      return

    if category == "Q4 — Vaccination":
      vaccine_name = (ed.get("vaccine_name") or "").lower()
      npra = (ed.get("npra_registered") or "unclear").lower()
      if target_year >= H6_VACCINATION_NPRA_EXPANSION_YA:
        if npra == "no":
          non_deductible_q4.append({**entry, "reason": "Not NPRA-registered — not eligible even under the expanded YA2026+ rule."})
        elif aggregation_state == "resolved":
          entry_out = {**relief_entry}
          if npra == "unclear":
            reason = "Could not confirm NPRA registration — confirm before filing."
            entry_out["needsReview"] = True
            entry_out["reason"] = reason
            mixed_pending.append({**entry, "amount": str(amount), "needsReview": True, "reason": reason,
                                   "question": "Confirm this vaccine is NPRA-registered."})
          reliefs_q4.append(entry_out)
      else:
        matches_old_list = any(v in vaccine_name for v in H6_VACCINATION_PRE_2026_FIXED_LIST)
        if not vaccine_name or matches_old_list:
          if aggregation_state == "resolved":
            reliefs_q4.append(relief_entry)
        else:
          reason = f"'{ed.get('vaccine_name')}' is not on the pre-YA2026 eligible list."
          non_deductible_q4.append({**entry, "reason": reason})
          mixed_pending.append({**entry, "amount": str(amount), "needsReview": True, "reason": reason,
                                 "question": "This vaccine isn't on the eligible list for this filing year — confirm or reclassify."})
      return

    if category == "Q4 — Fertility Treatment" and not is_married:
      non_deductible_q4.append({**entry, "reason": "H6(ii) fertility treatment relief requires the taxpayer to be married."})
      mixed_pending.append({**entry, "amount": str(amount), "needsReview": True,
                             "reason": "Excluded: requires married status per current profile.",
                             "question": "If your marital status is out of date, update it in Basic Particulars."})
      return

    if category == "Q4 — Life Insurance & Takaful Relief":
      life_insured = (ed.get("policy_life_insured") or "unclear").lower()
      if life_insured == "child" and target_year < H17_CHILD_LIFE_INSURANCE_YA:
        non_deductible_q4.append({**entry, "reason": f"A child-life policy only qualifies from YA{H17_CHILD_LIFE_INSURANCE_YA} onward."})
      elif aggregation_state == "resolved":
        reliefs_q4.append(relief_entry)
      return

    if category == "Q4 — SSPN Net Deposit":
      sspn_deposit    = _parse_amount(ed.get("sspn_deposit_myr"))
      sspn_withdrawal = _parse_amount(ed.get("sspn_withdrawal_myr"))
      sspn_net        = max(Decimal("0"), sspn_deposit - sspn_withdrawal)
      if aggregation_state == "resolved":
        reliefs_q4.append({**relief_entry, "amountNumeric": sspn_net,
                            "sspnDepositMyr": money(sspn_deposit), "sspnWithdrawalMyr": money(sspn_withdrawal)})
      return

    if category in _one_time_relief_results:
      otr_result = _one_time_relief_results[category]
      if otr_result["isEligibleYear"] and aggregation_state == "resolved":
        reliefs_q4.append(relief_entry)
      else:
        non_deductible_q4.append({**entry, "reason": otr_result["note"] or "Not eligible for this filing year."})
        if otr_result["needsReview"]:
          mixed_pending.append({**entry, "amount": str(amount), "needsReview": True, "reason": otr_result["note"],
                                 "question": "Confirm this one-time relief's eligible year before relying on this claim."})
      return

    # Every other plain Q4 relief category — no special per-category rule.
    if aggregation_state == "resolved":
      reliefs_q4.append(relief_entry)

  # Matches the real (old) code's own final check exactly: EVERY document
  # needing review is surfaced here, unconditionally, regardless of bucket.
  # (An earlier version of this file wrongly excluded Q3 on the assumption
  # apportioned items were already surfaced elsewhere — they weren't; this
  # was caught via dispatch_comparison.py finding Client & Corporate Gifts
  # silently missing from mixed_pending.)
  if entry["needsReview"]:
    mixed_pending.append({**entry, "reason": ed.get("reason"), "question": ed.get("question"), "source": ed.get("source")})


# ══════════════════════════════════════════════════════════════════════════
# What changes in _build_year_summary's main loop (main.py):
#
# Replace the entire block from `if doc.category == "Q3 — CP500 Instalment
# Notice"...` down through the final `if is_pending_review: mixed_pending...`
# with a single call:
#
#   dispatch_document(
#     doc, ed, entry, target_year, is_married,
#     income_q1, income_q2, deductions_q3, reliefs_q4, non_deductible_q4,
#     zakat_entries, section110_entries, section107d_entries,
#     donation_entries_by_gline, DONATION_CATEGORY_TO_GLINE,
#     reference_documents, bank_statement_reviews, k_disclosures, mixed_pending,
#     registry_managed_documents, category_deprecated_documents,
#     H12_CARE_CENTRE_BAND_YA, H6_VACCINATION_NPRA_EXPANSION_YA,
#     H6_VACCINATION_PRE_2026_FIXED_LIST, H17_CHILD_LIFE_INSURANCE_YA,
#     _one_time_relief_results,
#   )
#
# NOTE: is_married is computed further down in the current function (right
# before the H4/H14/H15/H16 block) — it needs to move EARLIER, before the
# main per-document loop starts, since dispatch_document needs it for the
# H6(ii) fertility check. This is the one real ordering change required.
#
# Two new empty lists need declaring alongside the existing ones at the top
# of _build_year_summary:
#   registry_managed_documents = []
#   category_deprecated_documents = []
#
# And two new keys added to the function's final return dict:
#   "registryManagedDocuments": registry_managed_documents,
#   "categoryDeprecatedDocuments": category_deprecated_documents,
#
# ══════════════════════════════════════════════════════════════════════════