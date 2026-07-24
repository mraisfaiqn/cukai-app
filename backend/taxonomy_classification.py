"""
Iteration 2 — wiring the registry into the actual classification pipeline.

This is the step where the confirmed bugs actually get fixed, not just
modeled around:
  - Issue #1 (Stage 7 status-override gap): ELIMINATED, not patched. The LLM
    is no longer asked for `status` at all, and nothing derives it from the
    LLM's opinion — tax_treatment is a pure registry lookup by category.
    There is no override chain left to have a missing branch.
  - Issue #2 (excluded_by_rule dead end): FIXED. Registry-managed categories
    (CP500, capital assets, H11, food waste x2, CCTV, departure levy, hire
    purchase) get their own aggregation_state ("managed_elsewhere") that IS
    read downstream — see the main.py sketch at the bottom of this file —
    instead of silently vanishing.
  - Issue #3 (no confidence gate): FIXED. One rule, applied uniformly to
    every category whose amount would otherwise be summed directly, not
    just the two whole-document Financial Statement uploads.
  - T1/T2 (frontend taxonomy drift): addressed in Iteration 5 (the
    /api/categories endpoint) — not this file, but this file's validation
    change (category must exist in CATEGORY_REGISTRY) is the backend half
    of what makes that safe.

Everything here assumes category_registry.py (the previous artifact) has
already been dropped into pipeline.py, replacing the old taxonomy section.
"""

from category_registry import (
  CATEGORY_REGISTRY, CATEGORY_TAX_TREATMENT, CATEGORY_BUCKET,
  CATEGORY_COMPUTATION_SOURCE, ALL_CATEGORIES,
  REVIEW_CATEGORY, NON_TAX_CATEGORY, BANK_STATEMENT_CATEGORY,
)

# Confidence floor applied uniformly to any "direct" transaction category.
# Matches the bar the old code already used for P&L/BS (see formB.js's
# pl.confidence < 70 check) — now the SAME rule for every document type,
# not a special case for two of them.
DIRECT_CONFIDENCE_FLOOR = 70


# ══════════════════════════════════════════════════════════════════════════
# document_role — now a pure registry lookup, no membership-list checks.
# Vocabulary renamed to match the registry's own concepts directly, rather
# than the old ad hoc names that had drifted from what they actually meant:
#   "transaction"          — direct amount, summed normally
#   "registry_managed"     — computed from multi-year history (was the old
#                            "schedule_source" — renamed so it reads as what
#                            it IS, not just where it comes from)
#   "ledger_source"         — bank statement, matched line-by-line
#   "reference_document"    — never summed; see reference_type for WHY
#   "non_tax"               — zero financial content
#   "needs_classification"  — genuinely ambiguous, needs a human (was
#                            REVIEW_CATEGORY's old role)
#   "unrecognized_category" — NEW: the stored category string no longer
#                            exists in CATEGORY_REGISTRY at all (see T1's
#                            migration handling below)
# ══════════════════════════════════════════════════════════════════════════

def derive_document_role(category: str) -> str:
  d = CATEGORY_REGISTRY.get(category)
  if d is None:
    return "unrecognized_category"
  if d.computation_source == "ledger":
    return "ledger_source"
  if d.bucket == "REFERENCE":
    return "reference_document"
  if d.computation_source == "registry":
    return "registry_managed"
  if d.bucket == "NON_TAX":
    return "non_tax"
  if d.bucket == "REVIEW":
    return "needs_classification"
  return "transaction"


# ══════════════════════════════════════════════════════════════════════════
# aggregation_state — the actual "is this safe to sum right now" signal.
# Confidence is now a REQUIRED parameter, not an afterthought carried for
# display only — this is what closes issue #3. category_deprecated and
# managed_elsewhere are new states; see the main.py sketch below for how
# each is surfaced (never silently dropped).
# ══════════════════════════════════════════════════════════════════════════

VALID_AGGREGATION_STATES = {
  "resolved",              # safe to sum directly, right now
  "needs_apportionment",   # genuinely mixed (entertainment/gifts/vehicle/HP)
  "needs_user_confirmation", # ambiguous, OR confidence below the floor
  "reference_only",        # REFERENCE bucket — never summed, shown for context
  "managed_elsewhere",     # registry-managed — never summed per-document,
                            # but ALWAYS shown in a "feeds your X schedule"
                            # bucket downstream (see main.py sketch)
  "excluded_not_applicable", # NON_TAX — genuinely irrelevant upload
  "category_deprecated",   # NEW — stored category no longer exists in the
                            # registry (pre-migration data); surfaced as an
                            # explicit "please reclassify" prompt, never
                            # guessed at
}


def derive_aggregation_state(
  category: str, confidence: int | None = None, deductible_pct=None,
  bank_statement_reviewed: bool = False,
) -> str:
  """
  Deterministic — derived from (category, confidence, deductible_pct,
  bank_statement_reviewed), via the registry. Never reads anything the LLM
  decided about status, because the LLM is no longer asked to decide status
  at all (see classify_and_extract_with_llm's trimmed-down contract below).

  deductible_pct: whether THIS SPECIFIC document already had its
  apportionment percentage confirmed by a human, via reclassify_document.
  This is a per-DOCUMENT fact, not a per-CATEGORY one — a "mixed" category
  is only "needs_apportionment" for a document that hasn't yet been
  resolved; once a user has confirmed a specific split (deductible_pct is
  set), that confirmation must be respected as "resolved" going forward,
  never silently re-flagged just because the category itself is generally
  apportioned. (Bug found via dispatch_comparison.py testing: without this
  parameter, EVERY previously-confirmed apportioned document would
  incorrectly revert to needing re-confirmation on every future summary
  computation, discarding the user's prior input.)

  bank_statement_reviewed: the SAME shape of per-document human
  confirmation, for a bank statement (ledger_source role) specifically. A
  bank statement's line-matching is a point-in-time check against whatever
  other documents existed at classification time — it never automatically
  resolves on its own, so without an explicit human action it would sit in
  "needs review" forever with no way to ever clear it (found in review: no
  code path anywhere ever changed a ledger_source document's state, and
  archive_document explicitly refuses to archive anything unresolved).
  Once a user has looked at the unmatched lines and confirmed the
  statement, this respects that and resolves it — same principle as
  deductible_pct above.
  """
  d = CATEGORY_REGISTRY.get(category)
  if d is None:
    return "category_deprecated"

  role = derive_document_role(category)

  if role == "needs_classification":
    return "needs_user_confirmation"
  if role == "ledger_source":
    # Reviewed statements resolve to "reference_only" (never summed, but no
    # longer pending) — the same non-pending state reference documents like
    # a P&L already use, since a bank statement's role once reviewed is
    # identical: informational, not a to-do item.
    return "reference_only" if bank_statement_reviewed else "needs_user_confirmation"
  if role == "reference_document":
    return "reference_only"
  if role == "registry_managed":
    return "managed_elsewhere"
  if role == "non_tax":
    return "excluded_not_applicable"

  # From here on, role == "transaction" — a document whose amount is a
  # candidate for direct summing.
  if d.tax_treatment == "mixed":
    if deductible_pct is not None:
      # Already confirmed by a human — respect it, don't re-flag. A
      # deliberate override of the confidence gate too: a human's explicit
      # confirmation is stronger evidence than the original OCR confidence.
      return "resolved"
    return "needs_apportionment"

  # THE CONFIDENCE GATE (issue #3) — one rule, applied to every remaining
  # category uniformly, not a P&L/BS-only special case.
  if confidence is not None and confidence < DIRECT_CONFIDENCE_FLOOR:
    return "needs_user_confirmation"

  return "resolved"


# ══════════════════════════════════════════════════════════════════════════
# Output validation — category must exist in the registry. This is the
# backend half of fixing T1: reclassify_document (main.py) must call this
# same check before persisting a user-picked category, so a stale frontend
# dropdown can never write a category string the backend doesn't recognize.
# ══════════════════════════════════════════════════════════════════════════

def validate_category(category: str) -> tuple[bool, str]:
  """Returns (is_valid, error_message). Use at BOTH the LLM-output
  validation step below AND main.py's reclassify_document endpoint —
  one function, two call sites, so this check can never drift between
  the two paths the way the old taxonomy did."""
  if category in CATEGORY_REGISTRY:
    return True, ""
  return False, (
    f"'{category}' is not a recognized category. If this category used to "
    "exist, it may have been renamed or split in a taxonomy update — "
    "please reclassify this document using the current category list."
  )


def validate_llm_result(llm_result: dict, filename: str) -> dict:
  """
  Sanitise LLM output. NOTE THE SHAPE CHANGE from the old version: the LLM
  is no longer asked for `status` or `quadrant` at all (see the trimmed
  system-prompt contract below) — both are 100% derived from `category` via
  the registry, every time, with no exceptions. This is what eliminates
  issue #1 by construction rather than patching its override chain.
  """
  raw_category = llm_result.get("category", REVIEW_CATEGORY)
  is_valid, _ = validate_category(raw_category)
  if not is_valid:
    import logging
    logging.getLogger("uvicorn.error").warning(
      f"[Pipeline] Unrecognized category '{raw_category}' from LLM for '{filename}' "
      f"— defaulting to '{REVIEW_CATEGORY}'."
    )
    llm_result["category"] = REVIEW_CATEGORY

  try:
    llm_result["confidence"] = max(0, min(100, int(llm_result.get("confidence", 0))))
  except (TypeError, ValueError):
    llm_result["confidence"] = 0

  # quadrant is now purely cosmetic derived data for display — filled from
  # the registry bucket, never trusted from the LLM's own guess.
  final_category = llm_result["category"]
  llm_result["bucket"] = CATEGORY_BUCKET.get(final_category, "REVIEW")

  return llm_result


# ══════════════════════════════════════════════════════════════════════════
# The run_document_pipeline classification block — BEFORE vs AFTER.
#
# BEFORE (the actual bug):
#   category = llm_result.get("category", REVIEW_CATEGORY)
#   status   = llm_result.get("status") or CATEGORY_STATUS_MAP.get(category, "mixed")
#   if category == NON_TAX_CATEGORY: status = "not_applicable"
#   elif category == BANK_STATEMENT_CATEGORY: status = "mixed"
#   elif category in (capital categories): status = "capital"
#   elif category in ALL_Q1 or category in ALL_Q2: status = "income"
#   elif category in _Q4_RELIEF_CATS: status = "relief"
#   elif category in _Q4_NON_DED_CATS: status = "non_deductible"
#   # <- CP500 and every plain Q3 category fall through NONE of these
#   #    branches, so the LLM's own (possibly wrong) status survives unchecked.
#
# AFTER — replace that entire block with this:
# ══════════════════════════════════════════════════════════════════════════

def resolve_classification(llm_result: dict) -> dict:
  """
  Call this immediately after validate_llm_result() inside
  run_document_pipeline, in place of the old override block entirely.

  tax_treatment is ALWAYS the registry's value for the final category —
  never the LLM's opinion, never partially overridden. There is nothing
  left for a future category addition to accidentally fall through,
  because there's no conditional chain anymore — just one dict lookup.
  """
  category = llm_result["category"]
  confidence = llm_result["confidence"]

  tax_treatment = CATEGORY_TAX_TREATMENT[category]   # guaranteed to exist —
                                                       # validate_llm_result
                                                       # already forced
                                                       # category into the
                                                       # registry above
  document_role = derive_document_role(category)
  aggregation_state = derive_aggregation_state(category, confidence)

  return {
    **llm_result,
    "tax_treatment": tax_treatment,
    "document_role": document_role,
    "aggregation_state": aggregation_state,
  }


# ══════════════════════════════════════════════════════════════════════════
# What this means for the LLM system prompt (EXTRACTION_SYSTEM_PROMPT):
# the JSON output contract's "status" field should be REMOVED entirely —
# stop asking the model to classify status/quadrant at all, since both are
# now always overridden anyway. This isn't just cleanup: every sentence in
# the current prompt that says "status: X" next to a category (e.g. "→ Q3 —
# CP500 Installment Notice; status: not_applicable") was already redundant
# instruction the moment status became a pure lookup — removing it also
# shortens the prompt, which is a real win given LLM_CONTENT_CHAR_LIMIT
# pressure. The model's ONLY job becomes: pick the right category, extract
# the fields, assign a confidence. That's a smaller, more reliable task —
# category selection alone is what LLMs are best at; status was always the
# derived, error-prone part to have them guess.
# ══════════════════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════════════════
# main.py sketch — what _build_year_summary's per-document branching
# becomes. NOT a full replacement (that file is huge and this needs your
# review before a full rewrite) — this shows the SHAPE of the change so you
# can see issue #2 actually get fixed, not just relocated.
#
# BEFORE: branches on `quadrant`/`tax_status`/specific category-name checks
# scattered through ~200 lines, with capital/breastfeeding/CP500/departure
# levy each getting their own hand-written "pass # handled via registry
# below, not per-document" no-op — the exact duplication T6 flagged.
#
# AFTER (sketch):
#
#   document_role = ed.get("document_role") or derive_document_role(doc.category or "")
#   aggregation_state = ed.get("aggregation_state") or derive_aggregation_state(
#       doc.category or "", ed.get("confidence")
#   )
#
#   if document_role == "unrecognized_category":
#       # NEW bucket, always shown — never silently dropped. This is the
#       # user-facing surface for T1's migration case (stale stored category).
#       category_deprecated_documents.append({**entry, "reason":
#           f"This document's category ('{doc.category}') is no longer "
#           "supported — please reclassify it."})
#       continue
#
#   if document_role == "registry_managed":
#       # NEW — replaces every individual "pass # handled via registry
#       # below" no-op. ONE branch instead of four separate hand-written
#       # exceptions (capital, breastfeeding, CP500, departure levy, food
#       # waste, CCTV, hire purchase all land here now).
#       registry_managed_documents.append({**entry,
#           "note": "This document feeds a multi-year schedule computed "
#                   "separately — see the relevant tab for its actual figure.",
#           "scheduleType": CATEGORY_BUCKET.get(doc.category)})
#       continue
#
#   if document_role == "ledger_source":
#       bank_statement_reviews.append({...})  # unchanged from before
#       continue
#
#   if document_role == "reference_document":
#       reference_documents.append({...})  # unchanged from before
#       continue
#
#   if document_role == "non_tax":
#       continue  # genuinely nothing to show — correct to drop silently,
#                 # unlike registry_managed above
#
#   # role == "transaction" from here — bucket tells you where it goes
#   bucket = CATEGORY_BUCKET.get(doc.category)
#   if bucket == "Q1": ... (income_q1.append(...) if aggregation_state == "resolved")
#   elif bucket == "Q2": ...
#   elif bucket == "Q3": ...
#   elif bucket == "Q4": ...
#   elif bucket == "DONATIONS": ...
#   elif bucket == "TAX_INSTALLMENTS": ...
#   elif bucket == "REBATES": ...
#
# The key structural win: every one of capital/breastfeeding/CP500/
# departure-levy/food-waste/CCTV/hire-purchase now takes the SAME one path
# (registry_managed) instead of seven hand-written special cases that each
# had to be remembered and kept in sync — and none of them disappear
# without a trace anymore.
# ══════════════════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════════════════
# reclassify_document (main.py) — the other T1 half. Add this check right
# after new_category is read from the payload, before anything else touches
# the document:
#
#   if new_category:
#     is_valid, err = validate_category(new_category)
#     if not is_valid:
#       raise HTTPException(status_code=422, detail=err)
#
# This is what makes it IMPOSSIBLE for a stale frontend dropdown (T2's bank-
# statement bug) to ever persist a category the backend doesn't recognize —
# previously reclassify_document had no such check at all.
# ══════════════════════════════════════════════════════════════════════════