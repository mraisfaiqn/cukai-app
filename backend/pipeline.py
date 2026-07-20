import csv
import difflib
import io
import json
import logging
import os
import re
import threading
import time
from datetime import date as _date_cls
from decimal import Decimal
from dotenv import load_dotenv
from typing import Literal

import pandas as pd
from sqlalchemy.orm import Session
from models import Document, FormBProfile, CapitalAsset, BreastfeedingEquipmentClaim, FinancialStatementProfile, Entity, CP500Record, OneTimeReliefClaim
from utils import parse_amount
from category_registry import CATEGORY_REGISTRY, CATEGORY_BUCKET, CATEGORY_TAX_TREATMENT
# Aliased (not imported under the same names) — pipeline.py's OWN
# derive_document_role/derive_aggregation_state, defined further down in
# this file, are still exported unchanged for main.py call sites not yet
# migrated to the registry (e.g. _business_totals_for_year,
# reset_document_classification). Those still pass a STATUS STRING as the
# second argument; the new functions expect a CONFIDENCE INTEGER — importing
# them under the same name would silently shadow the old ones module-wide
# and break every un-migrated call site with a real type mismatch, not just
# a routing difference. Only run_document_pipeline's classification step
# (below) uses these aliased versions.
from taxonomy_classification import (
  derive_document_role as _new_derive_document_role,
  derive_aggregation_state as _new_derive_aggregation_state,
)
from capital_allowance import resolve_capital_allowance_rates

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, EasyOcrOptions

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage

from embeddings import chunk_text, embed_texts
import mongo as mongo_store

load_dotenv()

logger = logging.getLogger("uvicorn.error")

# ─── File type groups ──────────────────────────────────────────────────────────
DOCUMENT_EXTENSIONS    = {".pdf"}
IMAGE_EXTENSIONS       = {".png", ".jpg", ".jpeg", ".tiff", ".tif", ".webp"}
SPREADSHEET_EXTENSIONS = {".xlsx", ".xls", ".csv"}

ALLOWED_EXTENSIONS = DOCUMENT_EXTENSIONS | IMAGE_EXTENSIONS | SPREADSHEET_EXTENSIONS
ALLOWED_MIME_TYPES = {
  "application/pdf",
  "image/png", "image/jpeg", "image/tiff", "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv", "application/csv",
}
MAX_FILE_SIZE_MB = 20

# ══════════════════════════════════════════════════════════════════════════════
# FOUR-QUADRANT CATEGORY TAXONOMY
# Mirrors the LHDN Form B structure for Malaysian sole proprietors (ITA 1967)
#
#  Q1  BUSINESS INCOME    — s.4(a), s.4(aa)   → status: income
#  Q2  PERSONAL INCOME    — s.4(b)–s.4(f)     → status: income
#  Q3  BUSINESS EXPENSE   — s.33(1) / Sch 3   → status: deductible | mixed
#  Q4  PERSONAL RELIEF    — personal reliefs   → status: relief
#
#  Special: Mixed / Pending Review             → status: mixed
#           Non-Tax Document                   → status: not_applicable
# ══════════════════════════════════════════════════════════════════════════════

# ── Q1: Business Income ───────────────────────────────────────────────────────
# ITA s.4(a) — core trade / commerce / vocation
# ITA s.4(aa) — capital gains on disposal of unlisted shares / foreign assets (from 1 Jan 2024)
Q1_BUSINESS_INCOME_CATEGORIES = [
  "Q1 — Sales & Service Revenue",          # invoices issued, platform payouts, POS receipts
  "Q1 — Business Bank Interest",           # interest credited to a dedicated business account
  "Q1 — Capital Gains (s.4aa)",            # disposal of unlisted shares / foreign capital assets
  "Q1 — SST-02 Sales Tax Return",          # SST collected from customers; remittance to Kastam
  "Q1 — e-Invoice / LHDN Validated",       # MyInvois / Peppol-validated e-invoices received
]

# Reference / summary documents that sit structurally in the income quadrant but
# are NOT income themselves — they describe or reconcile the return (a P&L, a
# balance sheet, a prior Form B). Kept in a separate list so they don't read as
# business-income line items, but still folded into ALL_Q1 below so they remain
# valid categories with a Q1 quadrant. Their `document_role` is summary_statement
# (see SUMMARY_STATEMENT_CATEGORIES), which is what actually keeps their amounts
# OUT of the totals — this split is about organisation, not double-counting.
Q1_REFERENCE_CATEGORIES = [
  "Q1 — Financial Statements (P&L)",       # profit & loss / income statement
  "Q1 — Financial Statements (BS)",        # balance sheet / statement of financial position
  "Q1 — Filed Form B (Prior Year)",        # previously submitted Form B — YA baseline & carry-forward
  # Part K: non-employment income of a PRECEDING YA, voluntarily disclosed
  # now — belongs here, not in business-income, for the same reason a
  # prior Form B does: it's disclosure/reconciliation content about a
  # DIFFERENT year, not this year's own income to sum into B1/aggregate
  # income. Previously unmodeled entirely (16 Jul 2026 fix).
  "Q1 — Voluntary Disclosure (Prior Year Income)",
]

# ── Q2: Personal Income ───────────────────────────────────────────────────────
# ITA s.4(b) — employment income (Form EA, salary slips from an employer)
# ITA s.4(c) — dividends, interest, discounts from investments
# ITA s.4(d) — passive rental income, royalties, lease premiums
# ITA s.4(e) — pensions, annuities, periodical court-ordered payments
# ITA s.4(f) — casual / miscellaneous gains (finder's fees, one-off commissions)
Q2_PERSONAL_INCOME_CATEGORIES = [
  "Q2 — Employment Income (s.4b)",         # Form EA, payslip from an employer (not the business)
  "Q2 — Passive Rental Income (s.4d)",     # tenancy agreements, rental receipts as landlord
  "Q2 — Royalty Income (s.4d)",            # royalties from IP, publications, patents
  "Q2 — Dividend Income (s.4c)",           # taxable dividends (foreign equities, co-ops)
  "Q2 — Investment Interest (s.4c)",       # taxable fixed deposit interest, P2P financing returns
  "Q2 — Pension & Annuity (s.4e)",         # pension payouts, annuity statements
  "Q2 — Casual & Other Income (s.4f)",     # one-off referral fees, finder's fees, sundry gains
  "Q2 — Foreign-Source Income (FSI)",      # foreign consulting fees, overseas business income, foreign rental
]

# ── Q3: Business Expense ──────────────────────────────────────────────────────
# ITA s.33(1) — wholly & exclusively incurred in producing business income
# ITA s.39(1) — specific disallowances (proprietor drawings, fines, 50% entertainment cap, etc.)
# ITA Schedule 3 — capital allowance for fixed assets (cannot deduct purchase price directly)
Q3_BUSINESS_EXPENSE_CATEGORIES = [
  # ── Fully deductible operating costs (s.33(1)) ──
  "Q3 — Cost of Goods Sold",               # raw materials, inventory, direct stock purchases
  "Q3 — Payroll & Statutory Contributions",# salaries, EPF employer 13%, SOCSO, EIS employer
  "Q3 — Business Premises Rent",           # commercial/shop lot rent; office rent
  "Q3 — Business Utilities",               # TNB, water, internet, phone for business line only
  "Q3 — Marketing & Advertising",          # Google/Meta/TikTok Ads, printing, influencer fees
  "Q3 — Professional & Legal Fees",        # audit, accounting, tax agent, secretarial, legal
  "Q3 — Transport & Logistics",            # fuel, toll, parking for business trips; courier
  "Q3 — Office & Admin Supplies",          # stationery, SaaS subscriptions, software (opex)
  "Q3 — Business Insurance",               # fire, burglary, public liability, workmen comp
  "Q3 — Staff Welfare & Benefits",         # staff medical, group life, canteen, uniforms
  "Q3 — Business Loan Interest",           # interest/profit portion of business loans only
  "Q3 — Revenue Repairs & Maintenance",    # restores asset to original condition; fully deductible
  "Q3 — CP58 Agent Commission",            # commissions >RM5,000 to agents/dealers (s.83A)
  # Was a single "Q3 — CP500 / Tax Installment" category (split 15 Jul 2026):
  # conflating LHDN's instalment NOTICE (a schedule of what's due) with a
  # PAYMENT RECEIPT (proof an instalment was actually paid) meant both were
  # summed together into B33 — silently counting scheduled-but-unpaid
  # amounts as if paid. See cp500.py and SCHEDULE_SOURCE_CATEGORIES below.
  "Q3 — CP500 Instalment Notice",          # LHDN's schedule of what's due — NEVER counts as paid
  "Q3 — CP500 Payment Receipt",            # proof an instalment was actually paid — feeds B33

  # ── Partially deductible / subject to caps (s.39(1)) ──
  "Q3 — Client Entertainment (50% cap)",   # client meals, events; 50% rule under s.39(1)(l)
  "Q3 — Client & Corporate Gifts",         # hampers, door gifts; 50% or 100% see gift rules
  "Q3 — Mixed-Use Vehicle Expenses",       # personal car also used for business; apportion by km

  # ── Capital expenditure — Schedule 3 (not directly deductible; claim via IA+AA) ──
  "Q3 — Capital Assets & Equipment",       # laptops, machinery, furniture, signage, CCTV
  "Q3 — Capital Renovation & Fit-Out",     # new construction, first-time fit-out, major upgrades
  "Q3 — Hire Purchase & Leased Assets",    # HP agreements on business assets; interest deductible
]

# ── Q4: Personal Tax Relief ───────────────────────────────────────────────────
# These reduce the proprietor's personal chargeable income on Form B.
# They are NOT business deductions — they are personal reliefs claimed in
# the individual section of Form B (Schedule 9, ITA 1967).
Q4_PERSONAL_RELIEF_CATEGORIES = [
  "Q4 — Life Insurance & Takaful Relief",  # life insurance / takaful keluarga premiums (up to RM3k)
  "Q4 — EPF Personal Contribution",        # employee-share EPF (up to RM4k relief)

  # ── Medical & parental care split (Phase 2) ──
  # Previously a single "Medical & Parental Care" category conflated two
  # different H-codes with two different caps (H2 parent-only, RM8k; H6/H7/H8
  # self/spouse/child, RM10k combined). Splitting so each can be capped
  # correctly instead of guessing which sub-cap applies.
  "Q4 — Parent Medical Care",              # parent medical/dental/special needs/carer (H2(i), up to RM8k combined with H2(ii))
  "Q4 — Parent Medical Care (Complete Examination)", # H2(ii) — own RM1k sub-cap within the RM8k H2 pool

  # ── H6/H7/H8 granularity split (this pass, 14 Jul 2026) ──
  # Previously ONE combined "Q4 — Self/Spouse/Child Medical" category, which
  # correctly enforced the outer RM10,000 pool but couldn't show — or
  # individually cap — any of the sub-lines within it. Split into the 9
  # categories LHDN's own form actually has, matching its real nested-cap
  # structure (see RELIEF_CAP_GROUPS in main.py):
  #   H6(i)/(ii) share the RM10k pool with no individual sub-cap of their own
  #   H6(iii) vaccination and H6(iv) dental EACH have their own RM1,000 cap
  #   H7(i)+(ii)+(iii) TOGETHER share one RM1,000 sub-pool
  #   H8(i)+(ii) TOGETHER share one RM4,000 sub-pool
  #   ...and the combined total of all nine is still capped at RM10,000.
  "Q4 — Serious Disease Treatment",        # H6(i) — self/spouse/child, part of RM10k pool, no own sub-cap
  "Q4 — Fertility Treatment",              # H6(ii) — self/spouse only, part of RM10k pool, no own sub-cap
  "Q4 — Vaccination",                      # H6(iii) — self/spouse/child, own RM1k sub-cap
  "Q4 — Dental Examination & Treatment",   # H6(iv) — self/spouse/child, own RM1k sub-cap
  "Q4 — Complete Medical Examination",     # H7(i) — shares ONE RM1k pool with H7(ii)/H7(iii)
  "Q4 — COVID-19 Detection Test",          # H7(ii) — shares ONE RM1k pool with H7(i)/H7(iii)
  "Q4 — Mental Health Examination",        # H7(iii) — shares ONE RM1k pool with H7(i)/H7(ii)
  "Q4 — Learning Disability Diagnosis",    # H8(i) — child ≤18, shares ONE RM4k pool with H8(ii)
  "Q4 — Learning Disability Early Intervention", # H8(ii) — child ≤18, shares ONE RM4k pool with H8(i)

  "Q4 — Books & Publications",             # H9(i), up to RM2.5k combined with H9(ii)/(iii)/(iv)
  "Q4 — Personal Computer & Devices",       # H9(ii), same RM2.5k combined pool
  "Q4 — Internet Subscription",             # H9(iii), same RM2.5k combined pool
  "Q4 — Personal Enrichment Course",        # H9(iv), same RM2.5k combined pool

  # ── Education relief split (Phase 2) ──
  # H5's RM7,000 cap has an inner RM2,000 sub-cap specifically on H5(iii)
  # upskilling/self-enhancement courses — these need to be distinguishable
  # from ordinary further-education fees to enforce that sub-cap correctly.
  "Q4 — Education Relief (Non-Postgraduate)", # H5(i), up to RM7k combined with H5(ii)/(iii)
  "Q4 — Education Relief (Postgraduate)",     # H5(ii), same RM7k combined pool
  "Q4 — Upskilling / Self-Enhancement Course", # H5(iii) — non-accredited skills/hobby/language course (sub-capped at RM2k within the RM7k H5 pool)

  # ── Child relief split (Phase 2) ──
  # The old "Child Relief" category conflated three genuinely different
  # things: SSPN deposits (H13), registered childcare/kindergarten fees for a
  # child aged 6 and under (H12), and the fixed per-child H16 relief (which is
  # NOT receipt-driven at all — it depends on each child's age/study/
  # disability status, tracked on the profile, not on documents). Only H12
  # and H13 are genuinely document-derived; H16 is intentionally absent here.
  "Q4 — Childcare Fees",                   # registered childcare centre / kindergarten fee, child ≤6 (H12, up to RM3k)
  "Q4 — SSPN Net Deposit",                 # SSPN deposits net of withdrawals in the basis year (H13, up to RM8k)

  "Q4 — Medical Equipment Relief",         # disabled aids, medical devices for self/dependant (H3, up to RM6k)
  "Q4 — Private Retirement Scheme (PRS)",  # PRS contributions (up to RM3k, H18)
  "Q4 — SOCSO Personal Contribution",      # employee-share SOCSO (up to RM350, H20)
  "Q4 — Domestic Tourism Relief",          # qualifying hotel stays & tourism packages (up to RM1k) — lapsed on current form, kept for older YAs
  "Q4 — Tourist Attraction & Cultural Programme",  # Finance Act 2025 s.6(a)(v): entrance fees to tourist attractions / cultural & arts programmes (up to RM1k) — YA2026 ONLY, a genuinely new and different relief from Domestic Tourism Relief above, not a revival of it
  "Q4 — EV Charging Equipment",            # EV charger purchase & installation (up to RM2.5k, H21) — shared pool YA2026-27, see below
  "Q4 — Food Waste Compost Machine",       # Finance Act 2025: claim once across YA2025-2027, shares RM2.5k pool with EV charging etc. from YA2026
  "Q4 — Food Waste Grinder Machine",       # Finance Act 2025: claim once across YA2026-2027, same shared pool
  "Q4 — Home CCTV",                        # Finance Act 2025: claim once across YA2026-2027, same shared pool
  "Q4 — Education & Medical Insurance",    # education/medical insurance premiums for self/spouse/child (H19, up to RM3k)
  "Q4 — Sports Equipment",                 # H10(i), up to RM1k combined with H10(ii)/(iii)/(iv)
  "Q4 — Sports Facility Fee",              # H10(ii), same RM1k combined pool
  "Q4 — Sports Competition Fee",            # H10(iii), same RM1k combined pool
  "Q4 — Gym & Sports Training",             # H10(iv), same RM1k combined pool

  # ── Donations / Gifts / Contributions — Part G (Phase 5, 14 Jul 2026) ──
  # Split from a single "Q4 — Approved Donations" bucket into the real G1–G8
  # sub-lines, since they're subject to DIFFERENT caps under different ITA
  # 1967 subsections, not one flat 10%-of-B11 pool:
  #   Pool A — combined, capped at 10% of B11 (s.44(6)/(11B)/(11C)/(11D)):
  #     G1 (govt/state/local authority), G2a (approved institution),
  #     G2b (approved sports activity), G2c (national-interest project),
  #     G2d (wakaf/endowment)
  #   Individually capped at RM20,000 each (not part of Pool A):
  #     G4 (library facilities, s.44(8)), G6 (medical equipment, s.44(10))
  #   Uncapped (full value, but needs an official valuation to be genuinely
  #   verifiable from a receipt alone):
  #     G3 (artefacts/manuscripts/paintings to govt, s.44(6A)),
  #     G5 (disabled-persons public facilities, s.44(9)),
  #     G7 (paintings to National/state Art Gallery, s.44(11))
  # All ten still route to tax_status "donation" (NOT a personal Q4 relief —
  # deducted from aggregate income before chargeable income is derived) —
  # see main.py for the tiered-cap computation across all ten categories.
  "Q4 — Donation: Government/Local Authority",   # G1
  "Q4 — Donation: Approved Institution",         # G2a
  "Q4 — Donation: Approved Sports Activity",     # G2b
  "Q4 — Donation: National Interest Project",    # G2c
  "Q4 — Donation: Wakaf/Endowment",              # G2d
  "Q4 — Donation: Artefacts to Government",      # G3
  "Q4 — Donation: Library Facilities",           # G4
  "Q4 — Donation: Disabled Facilities",          # G5
  "Q4 — Donation: Medical Equipment",            # G6
  "Q4 — Donation: Paintings to Art Gallery",     # G7

  # ── H11 breastfeeding equipment (added 14 Jul 2026) ──
  # RM1,000 cap, but allowed only ONCE EVERY TWO YEARS OF ASSESSMENT — a
  # genuinely multi-year rule a plain per-document/per-year cap can't
  # express. Handled via its own claim registry (BreastfeedingEquipmentClaim
  # / breastfeeding_relief.py), same pattern as capital allowance — see
  # SCHEDULE_SOURCE_CATEGORIES above and sync_breastfeeding_claim_registry
  # below. Per-document status is still "relief" (it does reduce chargeable
  # income like any other Q4 item); it's the AGGREGATION across years that
  # needs the registry, not the per-document classification.
  "Q4 — Breastfeeding Equipment",          # breast pump/storage/cooler equipment for own use, child ≤2 (H11, up to RM1k, once/2 YAs)

  "Q4 — Zakat",                            # zakat payment; rebate against tax PAYABLE (not income deduction)

  # Bug fix (16 Jul 2026): B29 and B33ii were previously unmodeled entirely.
  # Both are credits against tax (not income deductions), same footing as
  # Zakat above — but at DIFFERENT points in the computation: B29 reduces
  # tax CHARGED to get tax PAYABLE (same step B30 would occupy, if it
  # weren't out of scope); B33ii is a PAYMENT already made, reducing the
  # final BALANCE payable alongside MTD/CP500, not tax payable itself.
  "Q4 — Section 110 Withholding (Others)", # domestic withholding on interest/royalties/s.4A/trust income → B29
  "Q4 — Section 107D Withholding",         # 2% withheld by a payer on cash payments to agents/dealers/distributors → B33ii
  # B27iii (16 Jul 2026 fix): rebate capped at 2 TRIPS IN A LIFETIME, not
  # a ringgit cap or a windowed count — needs the full claim history across
  # every year ever filed, same reasoning as SCHEDULE_SOURCE_CATEGORIES.
  "Q4 — Departure Levy (Umrah/Religious Travel)",

  # Non-deductible personal spending (no tax relief but financially relevant)
  "Q4 — Personal Living Expenses",         # groceries, personal household spend; not deductible
  "Q4 — Personal Travel & Leisure",        # personal holidays, flights; not deductible
  "Q4 — Personal Dining & Entertainment",  # personal restaurant meals; not deductible
  "Q4 — Personal Shopping",               # clothing, home furniture, electronics (personal use)
  "Q4 — Personal Medical Expenses",        # own medical bills beyond relief caps; not deductible
  "Q4 — Family & Childcare Expenses",      # school fees for a child over 6 (no H-code covers this),
                                            # baby products, other family spend beyond relief caps
]

# Historical note: H7 (complete medical exam/COVID test/mental health) and
# H8 (child learning-disability assessment/intervention) were ORIGINALLY
# folded into "Q4 — Self/Spouse/Child Medical" (Phase 2) — narrower/rarer
# document types than H6, deferred as not required to fix the more urgent
# RM10k outer-cap bug at the time. Actually split into their own categories
# in this pass (14 Jul 2026) — see the H6/H7/H8 granularity split above.
#   H11 (breastfeeding equipment) — WAS deferred here pending a 2-year claim
#     registry; that registry now exists (see "Q4 — Breastfeeding Equipment"
#     above, breastfeeding_relief.py, and BreastfeedingEquipmentClaim in
#     models.py), so this is no longer a deferred item.


# ── J1: Part J incentive claims (paragraph 127(3)(b)) — OUT OF SCOPE ────────
# Previously supported claim codes 157 (secretarial & tax filing fee) and 148
# (franchise fee, pre-commencement) as their own tracked J1 categories with
# Balance B/F -> Claimed -> Absorbed -> Balance C/F bookkeeping (see
# incentive_claims.py, now removed). Descoped by product decision (14 Jul
# 2026): Part J is out of scope going forward, same footing as B12/B16/B19/J2.
# Documents that used to be classified here (company-secretary/tax-agent
# invoices, franchise-fee invoices) now fall through to their ordinary Q3
# expense category instead (e.g. "Q3 — Professional & Legal Fees" for
# secretarial/tax-agent fees) — they're still real deductible business
# expenses, they just no longer get the special/further-deduction treatment
# or the itemised Part J disclosure. Do not re-add J1 categories without a
# fresh product decision; see form-b-roadmap.md.


REVIEW_CATEGORY  = "Mixed / Pending Review"   # genuinely straddles two quadrants; needs user input
NON_TAX_CATEGORY = "Non-Tax Document"         # no monetary transactions whatsoever
# A bank statement gets its own dedicated category rather than folding into
# Q1-Q4 or "Mixed / Pending Review" — see the BANK STATEMENT LINE MATCHING
# section below for why it needs fundamentally different handling: it's many
# transactions, not one, and most lines will duplicate documents already
# uploaded separately.
BANK_STATEMENT_CATEGORY = "Bank Statement — Transaction Ledger"

# ── Master category lists ─────────────────────────────────────────────────────
# ALL_Q1 = true business income + Q1 reference/summary docs, so both remain valid
# categories mapped to the Q1 quadrant; the two are only split for clarity above.
ALL_Q1 = Q1_BUSINESS_INCOME_CATEGORIES + Q1_REFERENCE_CATEGORIES
ALL_Q2 = Q2_PERSONAL_INCOME_CATEGORIES
ALL_Q3 = Q3_BUSINESS_EXPENSE_CATEGORIES
ALL_Q4 = Q4_PERSONAL_RELIEF_CATEGORIES

# ALL_CATEGORIES removed (dead code cleanup, this session): its only reader
# was the old validate_llm_result's category check, which now checks
# CATEGORY_REGISTRY membership instead (see category_registry.py) — this
# variable had zero remaining references anywhere once that change landed.

# Status vocabulary
# income       — a receipt of money (Q1 or Q2); no deductibility; declared as income on Form B
# deductible   — allowable business deduction under s.33(1); reduces s.4(a) profit
# mixed        — partially deductible or needs apportionment / user confirmation
# relief       — personal tax relief reducing individual chargeable income (Q4 eligible items)
# non_deductible — personal spend with no tax benefit (Q4 non-relief items)
# capital      — capital asset (deductibility via Schedule 3 IA+AA, not directly) — its own
#                bucket so the frontend never lumps it in with genuinely non-applicable documents
# not_applicable — non-financial / non-deductible supporting document with no standalone
#                  deductibility (e.g. CP500 installment notice, generic non-tax document)
VALID_STATUSES = {"income", "deductible", "mixed", "relief", "non_deductible", "not_applicable", "capital", "donation"}

# Default status per category
CATEGORY_STATUS_MAP: dict[str, str] = {}
for cat in ALL_Q1:
  CATEGORY_STATUS_MAP[cat] = "income"
for cat in ALL_Q2:
  CATEGORY_STATUS_MAP[cat] = "income"
for cat in ALL_Q3:
  # Capital and mixed categories override below
  CATEGORY_STATUS_MAP[cat] = "deductible"
CATEGORY_STATUS_MAP["Q3 — Client Entertainment (50% cap)"]  = "mixed"
CATEGORY_STATUS_MAP["Q3 — Client & Corporate Gifts"]        = "mixed"
CATEGORY_STATUS_MAP["Q3 — Mixed-Use Vehicle Expenses"]      = "mixed"
CATEGORY_STATUS_MAP["Q3 — Capital Assets & Equipment"]      = "capital"         # via Schedule 3 IA+AA
CATEGORY_STATUS_MAP["Q3 — Capital Renovation & Fit-Out"]    = "capital"         # via Schedule 3 / IBA
CATEGORY_STATUS_MAP["Q3 — Hire Purchase & Leased Assets"]   = "mixed"           # interest deductible; principal not
CATEGORY_STATUS_MAP["Q3 — CP500 Instalment Notice"]         = "not_applicable"  # schedule of what's due; not a deductible expense
CATEGORY_STATUS_MAP["Q3 — CP500 Payment Receipt"]           = "not_applicable"  # advance tax payment; not a deductible expense
# Q4 relief items
_Q4_RELIEF_CATS = {
  "Q4 — Life Insurance & Takaful Relief",
  "Q4 — EPF Personal Contribution",
  "Q4 — Parent Medical Care",
  "Q4 — Parent Medical Care (Complete Examination)",
  "Q4 — Serious Disease Treatment",
  "Q4 — Fertility Treatment",
  "Q4 — Vaccination",
  "Q4 — Dental Examination & Treatment",
  "Q4 — Complete Medical Examination",
  "Q4 — COVID-19 Detection Test",
  "Q4 — Mental Health Examination",
  "Q4 — Learning Disability Diagnosis",
  "Q4 — Learning Disability Early Intervention",
  "Q4 — Books & Publications",
  "Q4 — Personal Computer & Devices",
  "Q4 — Internet Subscription",
  "Q4 — Personal Enrichment Course",
  "Q4 — Education Relief (Non-Postgraduate)",
  "Q4 — Education Relief (Postgraduate)",
  "Q4 — Upskilling / Self-Enhancement Course",
  "Q4 — Childcare Fees",
  "Q4 — SSPN Net Deposit",
  "Q4 — Medical Equipment Relief",
  "Q4 — Private Retirement Scheme (PRS)",
  "Q4 — SOCSO Personal Contribution",
  "Q4 — Domestic Tourism Relief",
  "Q4 — Tourist Attraction & Cultural Programme",
  "Q4 — EV Charging Equipment",
  "Q4 — Food Waste Compost Machine",
  "Q4 — Food Waste Grinder Machine",
  "Q4 — Home CCTV",
  "Q4 — Education & Medical Insurance",
  "Q4 — Sports Equipment",
  "Q4 — Sports Facility Fee",
  "Q4 — Sports Competition Fee",
  "Q4 — Gym & Sports Training",
  "Q4 — Breastfeeding Equipment",
  "Q4 — Zakat",
  "Q4 — Section 110 Withholding (Others)",
  "Q4 — Section 107D Withholding",
  "Q4 — Departure Levy (Umrah/Religious Travel)",
}
_Q4_NON_DED_CATS = {
  "Q4 — Personal Living Expenses",
  "Q4 — Personal Travel & Leisure",
  "Q4 — Personal Dining & Entertainment",
  "Q4 — Personal Shopping",
  "Q4 — Personal Medical Expenses",
  "Q4 — Family & Childcare Expenses",
}
# Approved donations are not a capped personal relief — they're deducted from
# aggregate income before chargeable income is derived (Part G / B17). Split
# into 10 G-line categories (Phase 5, 14 Jul 2026) since they're subject to
# DIFFERENT caps (10%-of-B11 pool for some, individual RM20,000 caps for
# others, uncapped for others) — see the category list's comment above and
# main.py's tiered-cap computation. Kept off both sets above and given their
# own status so main.py routes them to the donation pools instead of the
# H-code relief cap logic.
_DONATION_CATS = {
  "Q4 — Donation: Government/Local Authority",
  "Q4 — Donation: Approved Institution",
  "Q4 — Donation: Approved Sports Activity",
  "Q4 — Donation: National Interest Project",
  "Q4 — Donation: Wakaf/Endowment",
  "Q4 — Donation: Artefacts to Government",
  "Q4 — Donation: Library Facilities",
  "Q4 — Donation: Disabled Facilities",
  "Q4 — Donation: Medical Equipment",
  "Q4 — Donation: Paintings to Art Gallery",
}
for cat in _DONATION_CATS:
  CATEGORY_STATUS_MAP[cat] = "donation"
for cat in _Q4_RELIEF_CATS:
  CATEGORY_STATUS_MAP[cat] = "relief"
for cat in _Q4_NON_DED_CATS:
  CATEGORY_STATUS_MAP[cat] = "non_deductible"
CATEGORY_STATUS_MAP[REVIEW_CATEGORY]        = "mixed"
CATEGORY_STATUS_MAP[NON_TAX_CATEGORY]       = "not_applicable"
CATEGORY_STATUS_MAP[BANK_STATEMENT_CATEGORY] = "mixed"  # individual lines matched, never bulk-summed

# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENT ROLE + AGGREGATION STATE
# Two further classification dimensions layered on top of `category`. Both are
# derived deterministically from (category, status) in code — never left to the
# LLM — so a prompt change can never silently alter which amounts get summed
# into the user's tax totals. This is what prevents documents like a balance
# sheet or a hire-purchase statement from having their full amount counted as
# if it were a resolved, standalone transaction.
#
#   document_role — what KIND of artifact is this, structurally?
#     transaction          — atomic evidence of a single dated amount (invoice, receipt)
#     summary_statement     — a derived aggregate (P&L, balance sheet, prior Form B);
#                             used for reconciliation / carry-forward only, NEVER summed
#     schedule_source       — feeds a multi-year computation (capital asset, hire purchase,
#                             breastfeeding-equipment 2-year gate)
#                             rather than a single one-off deduction
#     ledger_source         — a bank statement: many transactions, matched line-by-line
#                             against existing documents; the statement never adds a lump sum
#     supporting_evidence   — contextual proof with no amount that should independently
#                             enter totals (CP500 notice, generic non-tax document)
#
#   aggregation_state — is this specific amount safe to sum RIGHT NOW?
#     resolved                 — sum directly into totals
#     needs_apportionment      — genuinely mixed (HP interest/principal, mixed-use vehicle,
#                                 home/business utility split); excluded until a split is
#                                 computed or confirmed
#     needs_user_confirmation  — ambiguous; fully excluded from totals until the user
#                                 answers the flagged question
#     reference_only           — summary_statement or carry-forward document; never enters
#                                 current-year totals, used for reconciliation instead
#     excluded_by_rule         — deterministically non-deductible/non-taxable (HP principal,
#                                 PTPTN, personal mortgage, CP500); shown as RM0 with reason
# ══════════════════════════════════════════════════════════════════════════════

REFERENCE_ONLY_CATEGORIES = {
  "Q1 — Financial Statements (P&L)",
  "Q1 — Financial Statements (BS)",
  "Q1 — Filed Form B (Prior Year)",
  # Part K: discloses income belonging to a PRECEDING year, not this one —
  # must never be summed into THIS year's B1/aggregate income, same
  # reasoning as Filed Form B above. Previously unmodeled (16 Jul 2026 fix).
  "Q1 — Voluntary Disclosure (Prior Year Income)",
  # Bug fix (14 Jul 2026): "Q1 — Capital Gains (s.4aa)" was NOT in this set
  # before, meaning it had document_role="transaction" and (assuming a
  # normal status) aggregation_state="resolved" — it was being silently
  # SUMMED into B1 as ordinary business income. That's factually wrong: a
  # disposal gain on unlisted shares/foreign capital assets under s.4(aa)
  # is a genuinely separate class of income with its own gain/loss
  # computation (disposal proceeds minus acquisition cost) and its own
  # filing treatment — not part of this business's ordinary P&L, the same
  # way a real-property disposal triggers RPGT reporting instead of being
  # folded into income (see D12a/D12b, already handled as its own separate
  # flag, never merged into a Part N/B income line). Unlike the other three
  # entries in this set, a capital gains document isn't a DERIVED AGGREGATE
  # of other documents — it's reusing the same "reference_only, never
  # summed, still shown for reconciliation" mechanism because it's the
  # closest existing fit, not because it's semantically a summary statement.
  "Q1 — Capital Gains (s.4aa)",
}

SCHEDULE_SOURCE_CATEGORIES = {
  "Q3 — Capital Assets & Equipment",
  "Q3 — Capital Renovation & Fit-Out",
  "Q3 — Hire Purchase & Leased Assets",
  # H11 needs claim history across YEARS (the "once every 2 years" gate),
  # not just a same-year cap — see breastfeeding_relief.py and
  # sync_breastfeeding_claim_registry below, same pattern as capital assets.
  "Q4 — Breastfeeding Equipment",
  # CP500 needs claim history across years for a different but related
  # reason (15 Jul 2026): B33 for year Y must count ONLY payments, never
  # notices, and must attribute each payment to the YA its instalment
  # scheme was actually FOR — not just the calendar date it was uploaded
  # or paid. See cp500.py and sync_cp500_registry below, same "recompute
  # fresh from full history" pattern as capital assets / H11.
  "Q3 — CP500 Instalment Notice",
  "Q3 — CP500 Payment Receipt",
  # Finance Act 2025 (Act 874) s.6(a)(vi): each of these may be claimed only
  # ONCE across its own multi-year window — a genuine claim-history problem
  # needing the OneTimeReliefClaim registry + one_time_relief.py, same
  # reasoning as H11/CP500 above, just a different eligibility shape (once
  # ever in a window, not recurring).
  "Q4 — Food Waste Compost Machine",
  "Q4 — Food Waste Grinder Machine",
  "Q4 — Home CCTV",
  # B27iii (16 Jul 2026): 2-trips-IN-A-LIFETIME cap, needs the full claim
  # history across every year ever filed — not a windowed or per-year cap.
  "Q4 — Departure Levy (Umrah/Religious Travel)",
}


SUPPORTING_EVIDENCE_CATEGORIES = {
  NON_TAX_CATEGORY,
}

# VALID_DOCUMENT_ROLES / VALID_AGGREGATION_STATES removed (dead code
# cleanup, this session): neither had any reference anywhere beyond its own
# definition — they documented the valid literal values but nothing ever
# actually validated against them.


def derive_document_role(category: str) -> str:
  """Structural role of the document — gates HOW its amount should be used downstream."""
  if category == BANK_STATEMENT_CATEGORY:
    return "ledger_source"
  if category in REFERENCE_ONLY_CATEGORIES:
    return "summary_statement"
  if category in SCHEDULE_SOURCE_CATEGORIES:
    return "schedule_source"
  if category in SUPPORTING_EVIDENCE_CATEGORIES:
    return "supporting_evidence"
  return "transaction"


def derive_aggregation_state(category: str, status: str) -> str:
  """
  Whether this document's amount is safe to sum into the user's totals right now.
  Deterministic — derived only from (category, status), never trusted from the LLM,
  so it can't drift silently when the extraction prompt changes.
  """
  if category == BANK_STATEMENT_CATEGORY:
    # A bank statement is many transactions, not one. Its lines are matched
    # against existing documents for reconciliation (see
    # _match_bank_statement_lines below) — the statement itself never
    # contributes a lump amount to any total.
    return "needs_user_confirmation"
  if category in REFERENCE_ONLY_CATEGORIES:
    return "reference_only"
  if category == REVIEW_CATEGORY:
    return "needs_user_confirmation"
  if status == "mixed":
    return "needs_apportionment"
  if status in ("not_applicable", "non_deductible"):
    return "excluded_by_rule"
  return "resolved"


# ══════════════════════════════════════════════════════════════════════════════
# APPORTIONED Q3 CATEGORIES
# A handful of Q3 business expenses are only PARTIALLY deductible, so their full
# amount must never be summed into the deduction total. Historically these were
# simply parked in `needs_apportionment` (excluded entirely) with no way to
# resolve them. Instead, each carries a deductible percentage; on user
# confirmation the document is resolved and only `pct`% of its amount enters the
# Q3 deduction total (see the Q3 branch in the summary endpoint).
#
#   mode 'statutory' — fixed by law, NOT user-editable
#                      (client entertainment, s.39(1)(l) = 50%)
#   mode 'default'   — a sensible default the user MAY override
#                      (gifts: 50%, but 100% if they carry the business logo)
#   mode 'required'  — no safe default; the user MUST supply it
#                      (mixed-use vehicle business-use %, hire-purchase interest %)
# ══════════════════════════════════════════════════════════════════════════════

APPORTIONED_CATEGORIES: dict[str, dict] = {
  "Q3 — Client Entertainment (50% cap)": {"mode": "statutory", "pct": 50},
  "Q3 — Client & Corporate Gifts":       {"mode": "default",   "pct": 50},
  "Q3 — Mixed-Use Vehicle Expenses":     {"mode": "required",  "pct": None},
  "Q3 — Hire Purchase & Leased Assets":  {"mode": "required",  "pct": None},
}


def resolve_deductible_pct(category: str, requested_pct):
  """
  Decide the deductible percentage to persist for an apportioned Q3 category.

  Returns (pct, ok, error):
    - Non-apportioned category            → (None, True, None): full amount is deductible.
    - 'statutory' category                → its fixed pct, ignoring any requested value.
    - 'default' category, no request      → its default pct.
    - 'default'/'required' with a request → the request, clamped to 0..100.
    - 'required' category, no request      → (None, False, msg): the user must supply it.
  """
  spec = APPORTIONED_CATEGORIES.get(category)
  if not spec:
    return None, True, None
  if spec["mode"] == "statutory":
    return spec["pct"], True, None
  if requested_pct is None or requested_pct == "":
    if spec["mode"] == "default":
      return spec["pct"], True, None
    return None, False, (
      "This category is only partially deductible — enter the deductible "
      "percentage (e.g. business-use %) before confirming."
    )
  try:
    p = int(round(float(requested_pct)))
  except (TypeError, ValueError):
    return None, False, "Deductible percentage must be a number between 0 and 100."
  return max(0, min(100, p)), True, None


# ══════════════════════════════════════════════════════════════════════════════
# EA FORM SELF-EMPLOYMENT CROSS-CHECK
# A sole proprietor's business profit is already their taxable income under
# s.4(a). If they've also uploaded an EA form issued by their OWN business
# (informal self-payroll), treating it as separate s.4(b) employment income
# would double-count the same money. This can't be caught from the EA form
# alone — it requires comparing the form's employer name against the user's
# own registered entity, so it's done here in code rather than left to the
# extraction prompt.
# ══════════════════════════════════════════════════════════════════════════════

_BUSINESS_SUFFIX_RE = re.compile(
  r"\b(sdn\.?\s*bhd\.?|enterprise|trading|resources|group|holdings|services|sole\s*prop(rietor)?)\b"
)


def _normalize_business_name(name: str | None) -> str:
  if not name:
    return ""
  n = _BUSINESS_SUFFIX_RE.sub("", name.lower())
  n = re.sub(r"[^a-z0-9 ]", "", n)
  return re.sub(r"\s+", " ", n).strip()


def employer_matches_own_entity(employer_name: str | None, entity_name: str | None) -> bool:
  """True if an EA form's employer name looks like the user's own business."""
  a, b = _normalize_business_name(employer_name), _normalize_business_name(entity_name)
  if not a or not b:
    return False
  if a == b:
    return True
  return difflib.SequenceMatcher(None, a, b).ratio() >= 0.85


# ══════════════════════════════════════════════════════════════════════════════
# BANK STATEMENT LINE MATCHING
# A bank statement is fundamentally different from every other document type:
# it's not one transaction, it's many, and a large fraction of those lines
# will duplicate invoices/receipts already uploaded separately. Rather than
# force it through the single-document, single-category, single-amount
# pipeline (which is how a balance-sheet-style double-count bug happens
# again), each line is matched against the user's existing transaction
# documents by amount + date proximity. Matched lines are already accounted
# for elsewhere and are left out of any total. Unmatched lines are the
# actually useful signal — a credit with no matching invoice is possible
# undocumented income; a debit with no matching receipt is a possible missing
# expense document — surfaced for the user to review, never auto-summed.
# ══════════════════════════════════════════════════════════════════════════════

_MATCH_AMOUNT_TOLERANCE_MYR = Decimal("2.0")
_MATCH_DATE_TOLERANCE_DAYS  = 3


def match_bank_statement_lines(db: Session, document, line_items: list[dict]) -> list[dict]:
  candidates = (
    db.query(Document)
    .filter(
      Document.user_id == document.user_id,
      Document.id != document.id,
      # "archived" included alongside "completed" — same reasoning as
      # main.py's _docs_for_year: archiving only declutters the list, the
      # receipt is still a valid, documented transaction. Excluding it here
      # would make an already-documented (but archived) purchase show up as
      # an "unmatched" bank line, wrongly implying missing paperwork.
      Document.status.in_(["completed", "archived"]),
    )
    .all()
  )
  candidate_facts = []
  for c in candidates:
    ced = c.extracted_data or {}
    if ced.get("document_role") != "transaction":
      continue
    c_amt = parse_amount(ced.get("amount"))
    c_date_raw = ced.get("date")
    if c_amt <= 0 or not c_date_raw:
      continue
    try:
      c_date_obj = _date_cls.fromisoformat(c_date_raw)
    except (ValueError, TypeError):
      continue
    candidate_facts.append((c.id, c_amt, c_date_obj))

  annotated = []
  for li in (line_items or []):
    # parse_amount now yields Decimal; keep li_amt Decimal too so the
    # amount-tolerance comparison below is Decimal-vs-Decimal (mixing Decimal
    # and float in arithmetic raises TypeError).
    li_amt = parse_amount(li.get("amt"))
    li_date_obj = None
    if li.get("date"):
      try:
        li_date_obj = _date_cls.fromisoformat(li["date"])
      except (ValueError, TypeError):
        li_date_obj = None

    matched_id = None
    if li_amt > 0 and li_date_obj:
      for c_id, c_amt, c_date_obj in candidate_facts:
        if abs(c_amt - li_amt) <= _MATCH_AMOUNT_TOLERANCE_MYR and \
           abs((c_date_obj - li_date_obj).days) <= _MATCH_DATE_TOLERANCE_DAYS:
          matched_id = c_id
          break

    direction = (li.get("direction") or "").lower()
    if matched_id:
      match_status = "matched"
    elif direction == "credit":
      match_status = "unmatched_credit"
    elif direction == "debit":
      match_status = "unmatched_debit"
    else:
      match_status = "unmatched"

    annotated.append({**li, "matchStatus": match_status, "matchedDocumentId": matched_id})

  return annotated


# ── Build the category list string for injection into the system prompt ────────
def _fmt_cat_block(label: str, cats: list[str]) -> str:
  lines = [f"  • {c}" for c in cats]
  return f"{label}:\n" + "\n".join(lines)

_Q1_BLOCK = _fmt_cat_block(
  "QUADRANT 1 — Business Income  (status → income)",
  ALL_Q1,
)
_Q2_BLOCK = _fmt_cat_block(
  "QUADRANT 2 — Personal Income  (status → income)",
  ALL_Q2,
)
_Q3_BLOCK = _fmt_cat_block(
  "QUADRANT 3 — Business Expense  (status → deductible | mixed | capital | not_applicable)",
  ALL_Q3,
)
_Q4_BLOCK = _fmt_cat_block(
  "QUADRANT 4 — Personal Tax Relief / Personal Spend  (status → relief | non_deductible)",
  ALL_Q4,
)

# ─── System prompt ─────────────────────────────────────────────────────────────
EXTRACTION_SYSTEM_PROMPT = f"""You are an expert Malaysian tax document analyst for LHDN (Lembaga Hasil Dalam Negeri).
Your role is to extract structured financial data from uploaded documents and classify them accurately
for a Malaysian sole proprietor filing Form B under the Income Tax Act 1967 (ITA 1967).

The classification system uses FOUR QUADRANTS that map directly to the Form B structure:
  Q1 Business Income   — ITA s.4(a), s.4(aa)
  Q2 Personal Income   — ITA s.4(b) to s.4(f)
  Q3 Business Expense  — ITA s.33(1) / Schedule 3 / s.39(1)
  Q4 Personal Relief   — Individual reliefs reducing chargeable income; OR non-deductible personal spend

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — RELEVANCE GATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A document is "Non-Tax Document" ONLY when it contains NO monetary transactions,
invoices, receipts, payments, or financial figures whatsoever.

HANDWRITTEN, BLURRY, OR LOW-QUALITY DOCUMENTS:
  These are NOT Non-Tax Documents just because they are hard to read.
  A handwritten receipt, a blurry photo of a petrol slip, or a dark scan of a supplier
  invoice is still a tax-relevant financial document — it just has degraded OCR output.
  If an OCR QUALITY WARNING appears in the user message, apply the following rules:
    • Extract whatever partial fields are visible (partial vendor name, approximate amount,
      partial date, recognisable keywords like "Maybank", "KWSP", "Celcom", etc.)
    • Make a best-effort category assignment based on available evidence
    • Lower confidence per the quality thresholds stated in the warning
    • Set question to ask the user to confirm or re-upload
    • NEVER set category to "Non-Tax Document" solely because the text is sparse

NON-TAX examples (zero financial content):
  • Identity documents: IC, passport, driving licence
  • Medical records / lab reports that are NOT invoices or payment receipts
  • Academic certificates, transcripts, or result slips (not fee receipts)
  • Photographs or images with no text or financial data
  • Social media posts, chat screenshots, news articles
  • Legal contracts with no payment schedules or monetary clauses
  • Blank or corrupted files

These are NEVER Non-Tax Documents — they carry financial amounts:
  • Tuition / school fee receipts (child >6, no childcare/SSPN match) → Q4 — Family & Childcare Expenses
  • Childcare centre / kindergarten fee receipts (child ≤6) → Q4 — Childcare Fees
  • Breast pump / breast milk storage / cooler bag receipts → Q4 — Breastfeeding Equipment
  • Baby & infant product receipts          → Q4 — Family & Childcare Expenses
  • Medical clinic / pharmacy receipts      → Q4 — Personal Medical Expenses, Q4 — Parent Medical Care, or the specific H6/H7/H8 sub-category that matches (Serious Disease Treatment / Fertility Treatment / Vaccination / Dental Examination & Treatment / Complete Medical Examination / COVID-19 Detection Test / Mental Health Examination / Learning Disability Diagnosis / Learning Disability Early Intervention)
  • Grocery / supermarket receipts          → Q4 — Personal Living Expenses
  • Personal shopping receipts              → Q4 — Personal Shopping
  • Personal travel / hotel / flight invoices → Q4 — Personal Travel & Leisure
  • Restaurant receipts (personal use)      → Q4 — Personal Dining & Entertainment
  • Gym, sports club subscriptions          → Q4 — Gym & Sports Training (if within cap) else Q4 — Personal Living Expenses
  • Streaming, other lifestyle subscriptions → Q4 — Personal Living Expenses (not a relief category — Q4 relief only covers the specific items named under H9/H10 above, not general subscriptions)
  • Gift recipient lists / hamper packing lists alongside a hamper invoice → Q3 — Client & Corporate Gifts
  • Any receipt or invoice showing a monetary amount IS financially relevant, even if non-deductible.

If truly Non-Tax, return ONLY:
{{
  "is_tax_relevant": false,
  "quadrant": null,
  "ita_section": null,
  "document_type": "<e.g. Identity Document, Medical Record, Photograph>",
  "category": "Non-Tax Document",
  "note": "<one sentence: why this has no financial or tax relevance>",
  "confidence": 95
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — DOCUMENT TYPE IDENTIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Identify the document type precisely from content headers, vendor names, and filename keywords.

  ── INCOME DOCUMENTS ──

  Sales Invoice / Tax Invoice (issued by the proprietor to a customer)
    → keywords: invois cukai, tax invoice, e-invoice, e-invois, MyInvois, Peppol,
      invois konsolidasi, recipient-created invoice, proforma invoice, self-billed invoice
    → Q1 — Sales & Service Revenue or Q1 — e-Invoice / LHDN Validated

  Official Receipt / Payment Receipt (received from a customer)
    → keywords: resit rasmi, official receipt, O/R, payment receipt, bukti bayaran
    → Q1 — Sales & Service Revenue

  Form EA / Employment Income Statement
    → keywords: Borang EA, Form EA, duti penggajian, employer return, employment income,
      gross salary, PCB summary from employer, annual income statement from employer
    NOTE: This is income from a separate employment outside the proprietorship.
      Classify as Q2 — Employment Income (s.4b). Do NOT mix with Q3 payroll documents
      (which are salary PAID by the business to its employees).
      EXTRACT ALL of the following into the form_ea field in the JSON output:
        employer_name        : name of the employer
        employer_e_number    : employer E number (E/C number) if visible
        gross_income         : total gross income from Box 1 (string amount)
        pcb_deducted         : PCB/MTD withheld by employer (string amount or null)
        epf_employee         : employee-share EPF deducted (string amount or null)
        socso_employee       : employee-share SOCSO deducted (string amount or null)
        eis_employee         : employee-share EIS deducted (string amount or null)
        benefits_in_kind     : total BIK value if stated (string amount or null)
        ya_year              : Year of Assessment this Form EA covers (integer)
        employment_start_date_this_ya : if the form states or implies employment
          STARTED during this YA (hire date, or an explicit "period of
          employment" start date after 1 Jan), extract that date as
          YYYY-MM-DD. If employment was ALREADY ongoing from before the YA
          began (the normal case for most employees), leave this null.
        employment_end_date_this_ya : if the form states or implies employment
          ENDED during this YA (resignation/termination date, or an explicit
          "period of employment" end date before 31 Dec), extract that date
          as YYYY-MM-DD. If employment was ONGOING through 31 Dec of the YA
          (the normal case — most Form EAs don't state an end date because
          the person is still employed), leave this null. Do NOT guess a
          start or end date from the form's issue date — Form EA is
          typically issued in Jan/Feb of the FOLLOWING year regardless of
          whether employment continued, so the issue date is neither the
          start nor the end date of the employment period itself.
      Populate the form_ea field in the JSON output with all extracted fields above.
    → Q2 — Employment Income (s.4b)

  Tenancy Agreement / Rental Income Receipt (proprietor as LANDLORD)
    → keywords: perjanjian sewa, tenancy agreement, resit sewa diterima, pendapatan sewa,
      sewa diterima, landlord receipt, tuan tanah, subletting receipt
    NOTE: Rental income RECEIVED by the proprietor is ITA s.4(d) personal income,
      NOT business revenue, unless the proprietor's core business is property letting.
      Classify as Q2 — Passive Rental Income (s.4d).
      If the core business IS property letting, classify as Q1 — Sales & Service Revenue.
    → Q2 — Passive Rental Income (s.4d) [default] or Q1 — Sales & Service Revenue [property business]

  Royalty Income Statement / IP Licence Receipt
    → keywords: royalti, royalty statement, IP licence income, patent royalty, copyright royalty,
      pendapatan royalti, book royalty, music royalty, licensing income received
    NOTE: Certain royalties received by MALAYSIAN CITIZENS qualify for partial income tax exemption
      under the ITA 1967 and annual gazette orders:
      • Literary, artistic, or musical works published in Malaysia → partial exemption (verify gazette)
      • Translations of literary works → partial exemption
      • Patents registered under the Patents Act 1983 → partial exemption
      • Software royalties → generally FULLY TAXABLE with no exemption
      Always flag exemption status in the note and advise the proprietor to confirm with a tax agent.
    → Q2 — Royalty Income (s.4d)

  Dividend Voucher / Unit Trust Distribution Statement
    → keywords: dividend voucher, borang dividen, dividend warrant, unit trust distribution,
      ASB income, ASM income, foreign dividend, eSavings income, corporate distribution,
      dividend certificate, amanah saham, KWSP dividend (for EPF-registered investments)
    NOTE: Most Malaysian dividends under the single-tier system are tax-exempt.
      Taxable dividends include: foreign-sourced dividends, certain co-operative dividends,
      dividends from non-single-tier companies. Flag with a note on exemption status.
    → Q2 — Dividend Income (s.4c)

  Fixed Deposit / Savings Interest Statement
    → keywords: faedah simpanan tetap, fixed deposit interest, FD maturity statement,
      deposit certificate, savings account interest, peer-to-peer financing return,
      P2P return, Funding Societies, Modalku, pitchIN return
    NOTE: Interest on savings accounts and FDs from Malaysian licensed banks paid to
      Malaysian resident individuals is generally tax-exempt (s.127 ITA 1967 exemption).
      Interest from P2P platforms, foreign bank accounts, or unlicensed entities is taxable.
      Flag exemption status in the note.
    → Q2 — Investment Interest (s.4c)

  Pension / Annuity Statement
    → keywords: pencen, pension, annuity, EPF withdrawal (post-retirement), PRS payout,
      periodical payment, periodical maintenance, alimony, nafkah
    NOTE: Pension exempt if qualifying age/statutory retirement — flag for review.
      Court-ordered alimony received is taxable under s.4(e).
    → Q2 — Pension & Annuity (s.4e)

  Foreign-Source Income (FSI) Document
    → keywords: foreign income, overseas income, foreign consulting fee, foreign service income,
      remittance, foreign bank transfer, swift transfer, overseas dividend, foreign rental income,
      income from abroad, pendapatan luar negara, pendapatan asing, foreign employment income,
      overseas pension, foreign royalty, income remitted to Malaysia
    NOTE — FSI EXEMPTION STATUS (critical; verify gazette at filing time):
      Since 1 Jan 2022, foreign-source income remitted into Malaysia by resident individuals
      is generally taxable under ITA s.3 (world income basis for certain taxpayers).
      HOWEVER, a blanket individual exemption under Para 28 Sch 6 ITA has been extended
      for resident individuals — confirm current gazette year before making a call.
      RULE: Always flag FSI documents as Q2 — Foreign-Source Income (FSI); status income;
      include a note that exemption status depends on the current gazette and the proprietor
      MUST confirm with a tax agent whether this amount is taxable or exempt for the relevant YA.
      DO NOT classify FSI as Q1 business income unless the foreign income is directly from the
      sole proprietorship's own overseas trade activities (i.e. the proprietor invoiced a foreign
      client for services rendered — that is Q1 s.4(a) income, not remittance-basis FSI).
    → Q2 — Foreign-Source Income (FSI)

  Capital Gain Disposal Notice / Share Sale Contract (s.4aa)    → keywords: borang disposal, share sale agreement, contract note, disposal of shares,
      unlisted share transfer, capital gains, CGT notice, LHDN CGT, disposal of capital assets,
      sale of foreign assets, disposal of private company shares (effective 1 Jan 2024)
    NOTE: ITA s.4(aa) effective 1 January 2024. Gains from disposal of unlisted Malaysian
      company shares and foreign capital assets are taxable at a flat rate (currently 10%
      for companies, individuals see LHDN gazette). Separate from s.4(a) business income.
    → Q1 — Capital Gains (s.4aa)

  SST-02 / SST Return
    → keywords: SST-02, Borang SST-02, SST-02A, sales tax return, service tax return,
      cukai jualan, cukai perkhidmatan, kastam, Royal Malaysian Customs, SST declaration
    NOTE: SST COLLECTED from customers is a current liability being remitted to Kastam —
      it is NOT the proprietor's income or expense. The filing confirms SST registration.
      Classify as Q1 — SST-02 Sales Tax Return; status income (the document represents
      a revenue-side obligation). Extract the taxable period and SST payable amount.
    → Q1 — SST-02 Sales Tax Return

  Profit & Loss Statement / Income Statement
    → keywords: penyata untung rugi, P&L, profit and loss, income statement,
      trading account, revenue statement, statement of comprehensive income
    NOTE (Phase 6, 14 Jul 2026): EXTRACT ALL of the following into the
      financial_statement field in the JSON output (null any figure not
      shown on this document — do NOT guess or derive a missing figure from
      others on the page):
        sales_or_turnover        : gross sales/turnover (string amount or null)
        opening_inventory        : opening stock of finished goods (string amount or null)
        closing_inventory        : closing stock of finished goods (string amount or null)
        other_business_income    : income from a business OTHER than this one, if
                                    the statement covers more than one (string or null)
        dividends                : dividend income shown on this P&L (string or null)
        rents_royalties_premiums : rental/royalty/premium income shown here,
                                    business-side only (string or null)
        contract_subcontracts    : subcontractor cost as its own expense line,
                                    if shown separately from COGS (string or null)
        bad_debts                : bad debts written off (string or null)
        stated_revenue           : same as sales_or_turnover — kept separately so a
                                    reconciliation check never depends on how the
                                    "turnover" line was worded on this specific
                                    statement (string or null)
        stated_net_profit        : the statement's own bottom-line net profit/loss,
                                    signed (e.g. "-12,000.00" for a loss) (string or null)
      This is a DERIVED AGGREGATE, not a transaction — it is still treated as
      reference-only and its top-level "amount" must stay null (see the Q1
      rules below) — the financial_statement fields above are ADDITIONAL
      structured data, not a replacement for that rule.
    → Q1 — Financial Statements (P&L)

  Balance Sheet / Statement of Financial Position
    → keywords: lembaran imbangan, balance sheet, statement of financial position,
      aset, liabiliti, ekuiti, assets, liabilities, equity
    NOTE (Phase 6, 14 Jul 2026): EXTRACT ALL of the following into the SAME
      financial_statement field in the JSON output (null any figure not
      shown — this is Form B's Part N Statement of Financial Position,
      N28-N50, and it's the single hardest-to-reconstruct section since it
      genuinely cannot be inferred from ordinary income/expense receipts):
        land_buildings            : N28 (string amount or null)
        plant_machinery           : N29 (string amount or null)
        motor_vehicles            : N30 (string amount or null)
        other_non_current_assets  : N31 (string amount or null)
        investments               : N33 (string amount or null)
        inventory                 : N34, closing stock as shown on the BS itself
                                     (string amount or null; may differ from the
                                     P&L's own closing_inventory line above if
                                     the two documents disagree — do not
                                     reconcile them yourself, extract each as-is)
        trade_debtors             : N35 (string amount or null)
        sundry_debtors            : N36 (string amount or null)
        cash_in_hand              : N37 (string amount or null)
        cash_at_bank              : N38 (string amount or null)
        other_current_assets      : N39 (string amount or null)
        loans_overdrafts          : N42 (string amount or null)
        trade_creditors           : N43 (string amount or null)
        sundry_creditors          : N44 (string amount or null)
        capital_account           : N46 (string amount or null)
        current_account_bf        : N47, brought forward from the PRIOR year
                                     (string amount or null)
        drawings_advance_net      : N49, net drawings/cash advance for personal
                                     use this year (string amount or null)
      A combined "Financial Statements" package that includes both a P&L
      and a Balance Sheet section on different pages of the SAME document
      should still be classified by whichever statement is on the FIRST/
      primary page, but populate financial_statement fields from BOTH
      halves regardless of category — the sync logic keys off which fields
      are actually present, not solely off the category label.
    → Q1 — Financial Statements (BS)

  ── BUSINESS EXPENSE DOCUMENTS ──

  Supplier Invoice / Purchase Invoice (received FROM a supplier)
    → keywords: invois pembekal, supplier invoice, purchase invoice, purchase order,
      pesanan belian, PO, goods received note, GRN
    → Q3 — Cost of Goods Sold  [if goods for resale / raw materials]
    → Q3 — Office & Admin Supplies  [if office consumables / SaaS tools]

  Salary Slip / Payroll Summary (proprietor PAYING employees)
    → keywords: slip gaji, payslip, pay slip, salary advice, gaji bulanan,
      payroll summary, earnings statement
    NOTE: This is the business PAYING its employees — a Q3 deductible expense.
      It is the OPPOSITE of a Form EA (Q2 income). Do not confuse them.
    → Q3 — Payroll & Statutory Contributions

  EPF / SOCSO / EIS Contribution Statement (employer contributions)
    → keywords: KWSP, PERKESO, SOCSO, EIS, caruman, borang A, borang 8A, i-Akaun,
      EPF contribution schedule, SOCSO contribution statement, SIP statement
    NOTE: Employer contributions (EPF 13%, SOCSO, EIS) are Q3 deductible business costs.
      Employee-share EPF deducted from employee salary is classified Q4 — EPF Personal Contribution
      when the employee is the proprietor themselves and they upload their own EPF statement.
    → Q3 — Payroll & Statutory Contributions [employer contributions]
    → Q4 — EPF Personal Contribution [proprietor's own EPF statement as a personal relief]

  Utility Bill (business premises)
    → keywords: bil utiliti, TNB, Tenaga Nasional, electricity bill, bil elektrik,
      Syabas, SADA, SPAN, water bill, bil air, Unifi, TM, Streamyx, Maxis, Celcom,
      Digi, U Mobile, Astro, TIME, internet bill, bil telefon, phone bill
    → Q3 — Business Utilities  [if billed to business address]
    → Mixed / Pending Review  [if billed to home address shared with business; apportion]

  Business Premises Rent Invoice / Commercial Tenancy Receipt (proprietor as TENANT)
    → keywords: resit sewa premis, rental invoice (paid), shop lot rental, office rental,
      commercial tenancy, industrial tenancy, sublease, stamping receipt (as tenant)
    NOTE: Rent PAID for business premises is a Q3 deductible expense.
      Contrast with rental income RECEIVED (Q2).
    → Q3 — Business Premises Rent

  Marketing / Advertising Invoice
    → keywords: advertising invoice, Google Ads, Meta Ads, Facebook Ads, TikTok Ads,
      YouTube Ads, influencer marketing, KOL fee, content creator fee, sponsored post,
      SEO, SEM, email marketing, exhibition fee, booth rental, event sponsorship,
      printing invoice, banner, flyer, radio ad, newspaper ad, iklan, bayaran penajaan
    → Q3 — Marketing & Advertising

  Professional Services Invoice
    → keywords: professional fee, audit fee, accounting fee, legal fee, consultation fee,
      retainer fee, guaman, peguam, akauntan, juruaudit, secretary fee, SSM filing fee,
      HR consultant, IT consultant, tax agent fee, valuation fee, patent fee, trademark fee,
      notary fee, akuan bersumpah, recruitment fee, headhunter fee
    → Q3 — Professional & Legal Fees

  CP58 Commission Statement
    → keywords: CP58, Borang CP58, commission statement, dealer commission, agent commission,
      distributor payment, commission paid exceeding RM5,000, s.83A
    NOTE: CP58 must be issued to agents/dealers receiving >RM5,000 commission per year.
      Failure to issue is a s.120 offence. Classify as Q3 — CP58 Agent Commission; deductible.
    → Q3 — CP58 Agent Commission

  Client Gift / Hamper Invoice
    → keywords: hamper, gift hamper, corporate gift, buah tangan, goodie bag,
      hamper raya, hamper CNY, hamper Christmas, hamper Deepavali,
      gift basket, door gift, token of appreciation, hadiah korporat,
      complimentary gift, client appreciation gift
    → Q3 — Client & Corporate Gifts  [always mixed — see gift rules in Step 4]

  Hamper Contents List / Packing List
    → keywords: packing list, contents list, hamper contents, gift contents,
      senarai kandungan, kandungan hamper, hamper breakdown
    NOTE: Supporting document only; inspect for alcohol, tobacco, or luxury goods.
    → Q3 — Client & Corporate Gifts  [status: mixed; supporting evidence]

  Gift Distribution Record / Recipient List
    → keywords: gift list, recipient list, senarai penerima, distribution record,
      hamper recipient, gift log, gift acknowledgement, penerima hadiah
    NOTE: Supporting document; not independently deductible but required for audit.
    → Q3 — Client & Corporate Gifts  [status: not_applicable as standalone; required evidence]

  Asset Purchase Invoice / Capital Equipment Receipt
    → keywords: aset tetap, fixed asset, capital expenditure, capex, machinery, equipment,
      computer, laptop, server, vehicle purchase, renovation invoice (capital),
      air conditioner, forklift, printer, photocopier, furniture and fittings,
      signage, CCTV, security system, alarm system, lesen perisian, perpetual licence,
      right-of-use asset
    NOTE — capital allowance rates (Schedule 3):
      Computer hardware / servers:           IA 20% + AA 20%/year
      Office furniture & fittings:           IA 20% + AA 10%/year
      Plant & machinery (general):           IA 20% + AA 14%/year
      Motor vehicles (commercial):           IA 20% + AA 20%/year
      Signboards / signage:                  IA 20% + AA 10%/year
      Perpetual software licences:           IA 20% + AA 20%/year (treated as computer)
    Output MUST include: asset_class, ia_rate_pct, aa_rate_pct
    → Q3 — Capital Assets & Equipment  [status: capital; claim via Schedule 3 IA+AA]

  Renovation Invoice
    → keywords: renovation, ubahsuai, naik taraf, refurbishment, fitting-out works,
      contractor invoice, electrical works, plumbing works, M&E works, partitioning,
      interior design invoice
    NOTE:
      Capital renovation (adds value, extends life, first-time fit-out):
        → Q3 — Capital Renovation & Fit-Out; IBA 10%/year (owned premises) OR
          capital allowance on qualifying plant IA 20% + AA 14%/year (leased premises)
      Revenue repair (restores to original condition, routine maintenance):
        → Q3 — Revenue Repairs & Maintenance; 100% deductible under s.33(1)
      Mixed invoice (both capital and revenue items):
        → Mixed / Pending Review; split required
    → Q3 — Capital Renovation & Fit-Out  or  Q3 — Revenue Repairs & Maintenance  or  Mixed

  Bank Statement / Bank Slip
    → keywords: penyata bank, bank statement, account statement, bank slip, deposit slip,
      transaction history, Maybank, CIMB, RHB, Public Bank, Hong Leong, AmBank, BSN,
      Affin, UOB, OCBC, HSBC, Alliance Bank, Bank Rakyat, Bank Islam, Bank Muamalat,
      Boost Bank, GXBank, KAF Digital, e-statement
    NOTE — a bank statement is MANY transactions, not one. Do NOT assign it a single
      Q1-Q4 category or a single top-level "amount" — that would either miss most of
      the transactions or double-count them against invoices/receipts the user has
      already uploaded separately. Instead:
        1. Classify it as → Bank Statement — Transaction Ledger; status: mixed.
        2. Leave the top-level "amount" field null.
        3. Extract EVERY line as its own entry in line_items, each with:
             desc   — payee/payer description exactly as printed
             amt    — absolute transaction amount (always positive)
             date   — that specific line's date, "YYYY-MM-DD"
             direction — "credit" (money in) or "debit" (money out)
           Do not summarize or omit rows to save space — completeness here matters
           more than brevity, since each row is matched against the user's other
           documents downstream. If the statement is long, prioritise larger
           transactions and anything that looks business-related, but extract as
           many rows as the page allows.
    → Bank Statement — Transaction Ledger

  Loan Statement / Hire Purchase Statement
    → keywords: penyata pinjaman, loan statement, hire purchase, sewa beli, HP statement,
      PTPTN, mortgage statement, overdraft statement, term loan, Islamic financing,
      murabahah, BBA, overdraft, revolving credit, SME loan, BNM loan, TEKUN, PUNB
    NOTE: Interest/profit portion on a BUSINESS loan → Q3 — Business Loan Interest; deductible
          Capital repayment portion → NOT deductible (balance sheet movement)
          PTPTN repayments → non_deductible (personal education loan)
          Mortgage on PERSONAL home → non_deductible (Q4 — Personal Living Expenses)
          Overdraft interest for business working capital → Q3 — Business Loan Interest; deductible
          If statement does not separate interest from principal → Mixed / Pending Review
    → Q3 — Business Loan Interest  or  Mixed / Pending Review

  Insurance Premium Statement
    → keywords: premium insurans, insurance premium, takaful, fire insurance, motor insurance,
      policy renewal, sijil insurans, cover note, burglary insurance, public liability,
      professional indemnity, employers liability, workmen compensation, business interruption,
      all-risk policy, fidelity guarantee, takaful perniagaan, takaful am
    NOTE:
      Business fire/burglary/liability/workmen comp on business premises → Q3 — Business Insurance; deductible
      Motor insurance on business-use vehicle → Q3 — Business Insurance or Q3 — Transport & Logistics; deductible
      Motor insurance on personal vehicle also used for business → Mixed / Pending Review; apportion
      Life insurance / takaful keluarga for the proprietor → Q4 — Life Insurance & Takaful Relief; relief
      Employee group life / hospitalisation → Q3 — Staff Welfare & Benefits; deductible
      Life insurance assigned to bank as loan collateral → Mixed / Pending Review

  Staff Claims / Expense Report
    → keywords: tuntutan pekerja, staff claim, expense claim, reimbursement, claim form,
      travel claim, entertainment claim, mileage claim, tuntutan perbatuan, km claim,
      petrol claim, toll claim, overtime claim, staff medical claim, panel clinic
    NOTE:
      Mileage at or below LHDN approved rate (RM0.60/km car; RM0.30/km motorcycle) → Q3 deductible
      Mileage above approved rate → employer still deducts full amount but excess is employee income
      Employee medical claims → Q3 deductible; panel clinic cap RM300/employee/year (PR No. 5/2019)
      Entertainment claims by staff for clients → subject to 50% rule; flag as mixed
      Housing / car allowances >RM2,400/month → BIK; deductible to employer; must appear on EA form
    → Q3 — Transport & Logistics  or  Q3 — Client Entertainment (50% cap)  or  Mixed

  Petty Cash Voucher
    → keywords: baucar tunai runcit, petty cash, cash voucher, PCV, cash disbursement,
      wang runcit, cash advance
    → Deductibility follows nature of underlying purchase; apply same Q3/Q4 rules

  Digital Service Tax Invoice / Foreign Platform Receipt
    → keywords: Adobe, Microsoft 365, AWS, Amazon Web Services, Google Workspace,
      Google Cloud, Zoom, Dropbox, Slack, Notion, Canva, Xero, QuickBooks, Shopify,
      Stripe, PayPal fees, foreign subscription, overseas SaaS, platform fee,
      digital service tax 8%, service tax on imported services, SST on digital services
    NOTE: 8% SST on digital services is non-recoverable; forms part of the deductible cost.
    → Q3 — Office & Admin Supplies  [productivity / SaaS tools]
    → Q3 — Marketing & Advertising  [ad platforms like Google Ads, Meta]

  CP204 / CP500 / CP204A / Form B / Form P / CP39 Tax Documents
    → keywords: CP204, CP500, CP58, Form B, Borang B, Form P, Borang BE, e-Filing,
      PCB, MTD, CP204A, CP107D, e-CP204, CP204B, CP39, CP39A
    NOTE:
      CP500 is an advance payment of estimated tax under s.107B — it is NOT a deductible
        business expense, but it DOES reduce the final tax payable at filing time (B33iii).
        Two genuinely different documents share the CP500 name — distinguish them carefully,
        since conflating them silently overstates B33 (a notice is NOT proof of payment):

        (a) CP500 Instalment Notice — LHDN's SCHEDULE of what's due across the year, not a
            receipt. Look for: a table of SEVERAL future-dated amounts, no payment
            confirmation, no bank/transaction reference, keywords "Notis Ansuran Cukai
            Pendapatan", "notis ansuran", "jadual bayaran ansuran". Extract:
              ya_year                : year of assessment this schedule is FOR (integer)
              total_scheduled_amount : the year's total scheduled instalments (string amount)
            → Q3 — CP500 Instalment Notice; status: not_applicable.

        (b) CP500 Payment Receipt — proof an instalment was ACTUALLY PAID. Look for: a
            specific payment DATE that has already occurred, a bank/transaction reference or
            LHDNM bill number, exactly ONE amount tied to ONE payment event (not a schedule),
            keywords "ByrHASiL", "bill number", "no. bil", "resit bayaran", "e-TT", "Virtual
            Account", "LHDNM e-Billing". Extract:
              ya_year        : the YA this payment is FOR — this may NOT be the same as the
                               calendar year the payment date falls in (e.g. a late instalment
                               for YA2024 paid in January 2025 is still FOR YA2024). If the
                               document doesn't make the target YA clear, leave this null
                               rather than guessing from the payment date.
              amount         : the amount actually paid (string)
              reference_no   : bank/transaction reference or LHDN bill number
            → Q3 — CP500 Payment Receipt; status: not_applicable.

        If a document shows a multi-row future-dated schedule with no payment confirmation,
        it is (a) even if the letterhead looks similar to a receipt.
      CP204 (company installment) → same distinction as CP500, same two categories.
      CP39 (monthly PCB remittance) → Q3 — Payroll & Statutory Contributions; deductible.
      CP58 → Q3 — CP58 Agent Commission; see above.

  Filed Form B / Borang B (Previously Submitted Return)
    → keywords: Borang B, Form B, LHDN e-Filing, borang cukai pendapatan individu,
      individual income tax return, year of assessment, tahun taksiran, e-Filing receipt,
      LHDN acknowledgement, cukai yang perlu dibayar, baki cukai, lebihan cukai,
      pendapatan berkanun, jumlah pendapatan, potongan peribadi, pendapatan bercukai,
      cukai yang ditetapkan, bayaran ansuran CP500, CP500 dibayar, baki cukai kena bayar
    NOTE — CRITICAL: This is a PREVIOUSLY FILED tax return, not a supporting receipt.
      It is the single most valuable document a sole proprietor can upload.
      It provides: prior-year statutory income by s.4 section, all personal reliefs claimed,
      CP500 installments paid, carry-forward losses, chargeable income, and final tax payable.
      EXTRACT ALL of the following into the form_b fields in the JSON output:
        ya_year              : Year of Assessment (integer, e.g. 2023)
        statutory_income_4a  : s.4(a) business/trade income (string amount e.g. "RM 85,000.00")
        statutory_income_4b  : s.4(b) employment income (string amount or null)
        statutory_income_4c  : s.4(c) dividends/interest (string amount or null)
        statutory_income_4d  : s.4(d) rental/royalties (string amount or null)
        statutory_income_4e  : s.4(e) pension/annuity (string amount or null)
        statutory_income_4f  : s.4(f) casual income (string amount or null)
        aggregate_income     : total income before reliefs (string amount)
        total_business_deductions : total Q3 allowable deductions (string amount or null)
        approved_donations   : s.44 approved donations deducted (string amount or null)
        total_personal_reliefs    : sum of all personal reliefs claimed (string amount or null)
        chargeable_income    : aggregate income after all reliefs (string amount)
        tax_charged          : tax on chargeable income before rebates (string amount)
        zakat_rebate         : zakat rebate applied (string amount or null)
        tax_payable          : final tax payable after rebates (string amount)
        cp500_total_paid     : total CP500 installments paid for that YA (string amount or null)
        balance_payable_refundable : balance payable or refund amount (string amount or null)
        unabsorbed_business_losses : carried-forward losses to next YA (string amount or null)
        unabsorbed_capital_allowance : carried-forward CA to next YA (string amount or null)
        n8_gross_profit      : Part N line N8 "GROSS PROFIT / LOSS", ONLY if this Form B
                                also includes the optional Part N financial particulars page
                                (string amount or null — most filers don't attach Part N,
                                so this will usually be null, which is fine)
        n26_net_profit        : Part N line N26 "NET PROFIT / LOSS", same condition as above
                                (string amount or null)
        # NOTE: total_business_deductions is frequently null, because LHDN's printed Form B
        # has NO single line item literally called "total business deductions" — it's a
        # working-sheet figure most filers never attach. When it's null but n8_gross_profit
        # AND n26_net_profit are BOTH present (i.e. this Form B happens to include Part N),
        # the main.py summary derives it as n8 - n26 (gross profit minus net profit =
        # total expenditure) rather than leaving the deductions trend chart empty for that
        # year (bug fix, 17 Jul 2026).
      Classify as: Q1 — Filed Form B (Prior Year); status: income (it is a comprehensive income record).
      Populate the form_b field in the JSON output with all extracted fields above.
    → Q1 — Filed Form B (Prior Year)

  Voluntary Disclosure of Prior-Year Income (Part K)
    → keywords: undeclared income, prior year income, voluntary disclosure, amended declaration,
      income not previously declared, tambahan pendapatan tahun terdahulu
    NOTE — CRITICAL: this covers non-employment income (e.g. rent, interest) from a PRECEDING
      year of assessment that the taxpayer is only now voluntarily declaring — it is NOT part
      of the CURRENT year's income and must never be summed into this year's B1/aggregate
      income. It's a disclosure table (Part K), not a computation input. Extract:
        income_type   : what kind of income this is (e.g. "rental income", "interest") (string)
        disclosed_ya   : the YEAR OF ASSESSMENT this income actually belongs to — this will
                         almost always be an EARLIER year than the document's own date, since
                         the whole point is declaring something from the past (integer or null
                         if genuinely unclear)
        amount         : the amount being disclosed (string)
      Classify as: Q1 — Voluntary Disclosure (Prior Year Income); status: income (kept out of
      this year's totals entirely by its document_role, not by status — see
      REFERENCE_ONLY_CATEGORIES).
    → Q1 — Voluntary Disclosure (Prior Year Income)

  Transport & Vehicle Documents
    → keywords: petrol receipt, parking receipt, toll receipt, Touch 'n Go, mileage log,
      car service invoice, tyre receipt, road tax, vehicle insurance, grab receipt (business)
    NOTE: Apportionment REQUIRED for any personal vehicle used for business.
      No logbook = LHDN will disallow the claim in an audit → flag as mixed.
    → Q3 — Transport & Logistics  or  Q3 — Mixed-Use Vehicle Expenses  or  Mixed

  ── PERSONAL RELIEF DOCUMENTS ──

  Life Insurance / Takaful Premium Statement
    → keywords: premium insurans hayat, life insurance premium, takaful keluarga, takaful hayat,
      policy anniversary, premium notice, medical card premium, hospitalisation insurance (personal)
    NOTE — CRITICAL: extract policy_life_insured ("self" | "spouse" | "child" | "unclear") — whose
      life the policy is actually contracted on, not who is paying the premium. This matters
      because the rule is year-dependent:
        Before YA2026: a policy on a CHILD's life does NOT qualify — ITA 1967 explicitly
          excludes this (premiums on the proprietor's or spouse's own life still qualify as
          normal). Route a clearly child-life policy to Q4 — Personal Living Expenses instead
          for pre-2026 filings.
        YA2026 onward (Finance Act 2025, Act 874, s.7): a policy on a child's life NOW
          qualifies too, under the same pool as self/spouse.
      Most statements won't make "whose life" fully explicit — don't assume "self" just
      because the account holder/payer is the proprietor; a payer can insure a child. Use
      "unclear" rather than guessing when the statement doesn't say.
    NOTE: Proprietor's own life insurance / medical card is a Q4 personal relief (up to RM3,000/year
      combined life insurance + EPF; medical insurance separately up to RM3,000).
    → Q4 — Life Insurance & Takaful Relief  [status: relief]  or  Q4 — Personal Living Expenses

  Personal EPF Statement (proprietor's own EPF account)
    → keywords: penyata KWSP peribadi, i-Akaun penyata, EPF annual statement, KWSP
      annual statement, EPF contributions (own account), Kumpulan Wang Simpanan Pekerja
    NOTE: Proprietor's own EPF contributions (employee-share) qualify for personal relief
      up to RM4,000/year. The employer-share EPF already captured in Q3 — Payroll.
    → Q4 — EPF Personal Contribution  [status: relief]

  Private Retirement Scheme (PRS) Statement
    → keywords: PRS statement, skim persaraan swasta, Private Retirement Scheme, PRS contribution,
      PRS unit trust, PPA Malaysia
    NOTE: PRS contributions qualify for personal relief up to RM3,000/year.
    → Q4 — Private Retirement Scheme (PRS)  [status: relief]

  Personal SOCSO Statement
    → keywords: SOCSO personal, PERKESO caruman peribadi, EIS personal
    NOTE: Employee-share SOCSO/EIS qualifies for personal relief up to RM350/year.
    → Q4 — SOCSO Personal Contribution  [status: relief]

  Medical/Dental/Carer Receipt — PARENT (H2(i))
    → keywords: hospital bill (parent), medical receipt (parent), parental medical care,
      penjagaan perubatan ibu bapa, dental treatment (parent), receipt made out to /
      treating a mother/father/parent-in-law, carer / caregiver receipt for a parent
    NOTE: Medical treatment, dental treatment, special needs, or carer expenses for the
      taxpayer's own PARENTS (natural or foster) — RM8,000/year combined with H2(ii)
      below. This is entirely separate from, and must never be merged with, medical
      expenses for the taxpayer's own self/spouse/child (see the H6/H7/H8 categories
      elsewhere). Only classify here when the patient named on the receipt is clearly a
      parent, not the taxpayer/spouse/child. Does NOT include a complete/full medical
      examination — that's H2(ii) below, which has its own inner RM1,000 sub-cap.
    → Q4 — Parent Medical Care  [status: relief]

  Complete Medical Examination Receipt — PARENT (H2(ii))
    → keywords: complete medical examination (parent), full medical checkup (parent),
      pemeriksaan perubatan lengkap ibu bapa, health screening (parent)
    NOTE: A COMPLETE/FULL medical examination specifically (not routine treatment) for
      the taxpayer's own parent — RM1,000/year sub-cap, within the SAME RM8,000 combined
      pool as H2(i) above. Only classify here when the receipt is clearly for a full/
      complete checkup rather than treatment for a specific ailment — an ordinary
      consultation or treatment receipt belongs in H2(i) instead.
    → Q4 — Parent Medical Care (Complete Examination)  [status: relief]

  Medical Receipt — SERIOUS DISEASE TREATMENT, self/spouse/child (H6i)
    → keywords: hospital bill (self/spouse/child), specialist bill, cancer treatment,
      dialysis / renal failure, leukemia treatment, AIDS treatment, Parkinson's treatment,
      heart attack treatment, organ transplant, major burns treatment, major amputation
    NOTE: Part of the combined H6+H7+H8 pool capped at RM10,000/year — this specific
      sub-line has NO cap of its own beyond that shared pool. For the taxpayer's OWN
      self, spouse, or child only. Do not use for a parent (→ Parent Medical Care) or
      for anyone else / amounts beyond the pool (→ Personal Medical Expenses).
    → Q4 — Serious Disease Treatment  [status: relief]  or  Q4 — Personal Medical Expenses

  Medical Receipt — FERTILITY TREATMENT, self or spouse (H6ii)
    → keywords: fertility treatment, IUI, IVF, in vitro fertilization, intrauterine
      insemination, fertility clinic, fertility consultation and medicines
    NOTE: Part of the combined H6+H7+H8 pool capped at RM10,000/year — this specific
      sub-line has NO cap of its own beyond that shared pool. Self or spouse ONLY (not
      children). Requires the taxpayer to be married.
    → Q4 — Fertility Treatment  [status: relief]  or  Q4 — Personal Medical Expenses

  Medical Receipt — VACCINATION, self/spouse/child (H6iii)
    → keywords: vaccination receipt, vaccine, immunisation, jab, suntikan vaksin
    NOTE — CRITICAL, year-dependent scope (Finance Act 2025 / Act 874, s.6(a)(i)–(ii),
      effective YA2026 onward per s.3(1)):
        YA2026 onward: ANY vaccine registered with the National Pharmaceutical Regulatory
          Agency (NPRA) qualifies — no longer limited to a fixed list.
        Before YA2026: only the historical fixed list qualifies — pneumococcal, HPV,
          influenza/flu, rotavirus, varicella/chickenpox, meningococcal, Tdap, COVID-19.
      Since eligibility depends on which YA this receipt is FOR (not just today's rules),
      extract BOTH of the following so the backend can apply the right-year test:
        vaccine_name     : the specific vaccine/immunisation named on the receipt
        npra_registered  : "yes" | "no" | "unclear" — whether the receipt or product
                           states NPRA registration. Ordinary vaccine receipts will
                           usually be "unclear" — don't infer "yes" just because it's a
                           common, obviously-legitimate vaccine.
      Still classify here regardless of npra_registered's value or which YA this turns
      out to be for — the backend decides eligibility per year, not this step.
    NOTE: Own RM1,000/year sub-cap, in addition to sitting inside the combined
      H6+H7+H8 RM10,000 pool. For the taxpayer's own self, spouse, or child.
    → Q4 — Vaccination  [status: relief]  or  Q4 — Personal Medical Expenses

  Medical Receipt — DENTAL EXAMINATION & TREATMENT, self/spouse/child (H6iv)
    → keywords: dental receipt, dentist, dental clinic, dental examination, teeth
      cleaning/scaling, filling, root canal, dental treatment
    NOTE: Own RM1,000/year sub-cap, in addition to sitting inside the combined
      H6+H7+H8 RM10,000 pool. For the taxpayer's own self, spouse, or child.
    → Q4 — Dental Examination & Treatment  [status: relief]  or  Q4 — Personal Medical Expenses

  Basic Supporting Equipment Receipt — disabled self/spouse/child/parent (H3)
    → keywords: wheelchair, wheel chair, hemodialysis machine, dialysis machine, artificial
      leg, prosthetic limb, hearing aid, alat bantuan pendengaran, kerusi roda, mesin
      dialisis, kaki palsu, basic supporting equipment, alat sokongan asas
    EXCLUDED — do NOT classify here even if sold by the same disability-equipment
      supplier: spectacles, optical lenses, reading/prescription glasses (LHDN's own
      notes explicitly exclude these from H3, unlike the other items above).
    NOTE — CRITICAL: this relief is allowed up to RM6,000/year ONLY if the disabled
      person the equipment is FOR (self, spouse, child, or parent) is registered with
      the Department of Social Welfare (Jabatan Kebajikan Masyarakat / JKM) as a
      disabled person — an invoice for a wheelchair or hearing aid, on its own, proves
      the PURCHASE but never proves DSW registration, which is a separate legal fact
      no receipt can establish. Extract dsw_registered:
        "yes"     — the document itself explicitly states or references DSW/JKM
                    registration (e.g. an OKU card number, a JKM referral letter
                    attached to the same document, explicit wording on the receipt)
        "no"      — the document explicitly indicates the person is NOT registered
        "unclear" — the document is a plain equipment purchase receipt with no
                    registration information at all (this will be the ORDINARY case —
                    do not infer "yes" just because the item is a wheelchair or
                    hearing aid; the item type alone says nothing about registration)
      Do not let dsw_registered affect the category or status below — always classify
      qualifying equipment here regardless of the answer; the backend handles review.
    → Q4 — Medical Equipment Relief  [status: relief]  or  Q4 — Personal Medical Expenses

  Medical Receipt — COMPLETE MEDICAL EXAMINATION, self/spouse/child (H7i)
    → keywords: full body check-up, complete medical examination, comprehensive health
      screening, medical check-up package
    NOTE: Shares ONE combined RM1,000/year sub-pool with H7(ii) COVID-19 testing and
      H7(iii) mental health consultation — NOT its own separate RM1,000, the three
      together share one. That RM1,000 pool then sits inside the combined H6+H7+H8
      RM10,000 pool.
    → Q4 — Complete Medical Examination  [status: relief]  or  Q4 — Personal Medical Expenses

  Medical Receipt — COVID-19 DETECTION TEST, self/spouse/child (H7ii)
    → keywords: COVID-19 test, PCR test, RTK / rapid test kit, self-detection test kit,
      antigen test kit
    NOTE: Shares ONE combined RM1,000/year sub-pool with H7(i) complete medical exam and
      H7(iii) mental health consultation — see H7(i)'s note above.
    → Q4 — COVID-19 Detection Test  [status: relief]  or  Q4 — Personal Medical Expenses

  Medical Receipt — MENTAL HEALTH EXAMINATION, self/spouse/child (H7iii)
    → keywords: psychiatrist, clinical psychologist, counsellor / counselor consultation,
      mental health examination, therapy session receipt
    NOTE: Shares ONE combined RM1,000/year sub-pool with H7(i) complete medical exam and
      H7(ii) COVID-19 testing — see H7(i)'s note above. Practitioner must be a registered
      psychiatrist, Allied-Health-Council-registered clinical psychologist, or a
      Board-of-Counsellors-registered counsellor.
    → Q4 — Mental Health Examination  [status: relief]  or  Q4 — Personal Medical Expenses

  Medical Receipt — LEARNING DISABILITY DIAGNOSIS, child ≤18 (H8i)
    → keywords: learning disability assessment, autism spectrum disorder assessment,
      ADHD assessment, Attention Deficit Hyperactivity Disorder, Global Developmental
      Delay / GDD assessment, intellectual disability assessment, Down Syndrome
      assessment, specific learning disability diagnosis
    NOTE: Shares ONE combined RM4,000/year sub-pool with H8(ii) early intervention/
      rehabilitation — NOT its own separate RM4,000. Child must be 18 or below. That
      RM4,000 pool then sits inside the combined H6+H7+H8 RM10,000 pool.
    → Q4 — Learning Disability Diagnosis  [status: relief]  or  Q4 — Personal Medical Expenses

  Medical Receipt — LEARNING DISABILITY EARLY INTERVENTION/REHABILITATION, child ≤18 (H8ii)
    → keywords: early intervention programme, rehabilitation treatment, speech therapy,
      occupational therapy, behavioural therapy (for a diagnosed learning disability)
    NOTE: Shares ONE combined RM4,000/year sub-pool with H8(i) diagnosis — see H8(i)'s
      note above. Child must be 18 or below.
    → Q4 — Learning Disability Early Intervention  [status: relief]  or  Q4 — Personal Medical Expenses

  Books, Journals & Publications Receipt (H9(i))
    → keywords: e-book, physical book, newspaper subscription, magazine subscription,
      journal subscription, buku, majalah, akhbar
    NOTE: Purchase or subscription of books/journals/magazines/newspapers/similar
      publications (hardcopy or electronic, excluding banned reading materials) for
      the taxpayer, spouse, or child. RM2,500/year combined with H9(ii)/(iii)/(iv)
      below. Personal (not business) use only.
    → Q4 — Books & Publications  [status: relief]

  Personal Computer / Smartphone / Tablet Receipt (H9(ii))
    → keywords: personal computer (for personal use), laptop (personal), smartphone
      (personal), tablet (personal) — NOT including any additional warranty charge
    NOTE: Purchase of a personal computer, smartphone, or tablet for the taxpayer,
      spouse, or child — NOT for the taxpayer's own business use (that goes to Q3
      instead). Same RM2,500/year combined pool as H9(i)/(iii)/(iv).
    → Q4 — Personal Computer & Devices  [status: relief]

  Internet Subscription Bill (H9(iii))
    → keywords: personal internet bill (home broadband), unifi bill, personal phone bill
      data plan, wifi subscription (residential)
    NOTE: Monthly internet subscription bill registered under the taxpayer's own name,
      for the taxpayer, spouse, or child. Same RM2,500/year combined pool as
      H9(i)/(ii)/(iv). A personal MOBILE PHONE data/call plan bill also qualifies here.
    → Q4 — Internet Subscription  [status: relief]

  Personal Enrichment / Hobby Course Receipt (H9(iv))
    → keywords: hobby class, language class, personal enrichment course, cooking class,
      photography class, art class, music class (NOT conducted by a body recognised
      under the National Skills Development Act — see Q4 — Upskilling / Self-Enhancement
      Course below for that case)
    NOTE: Payment for a course aimed at upskilling or self-enhancement, OTHER than the
      National-Skills-Development-Act-recognised courses that belong to H5(iii) (Q4 —
      Upskilling / Self-Enhancement Course) — this is a DIFFERENT LHDN line (H9(iv), not
      H5(iii)) with a different cap, despite the similar-sounding description. The course
      does NOT need to be registered or recognised by any government body — it covers
      hobby/language/personal-enrichment courses. Same RM2,500/year combined pool as
      H9(i)/(ii)/(iii). If a course fee IS from a National-Skills-Development-Act-
      recognised body, classify as Q4 — Upskilling / Self-Enhancement Course (H5(iii))
      instead, not here.
    → Q4 — Personal Enrichment Course  [status: relief]

  Education Fee Receipt — Non-Postgraduate (proprietor's own further education, H5(i))
    → keywords: university fee, college fee, degree fee (bachelor's/undergraduate),
      diploma fee, professional qualification, ACCA, CPA, CIMA, law/accounting/
      Islamic-finance/technical/vocational/industrial/scientific/technological course
      fee at a recognised institution
    NOTE: Any course of study up to tertiary level OTHER than a Master's or Doctorate
      — RM7,000/year combined with H5(ii) below AND the upskilling category (see the
      RM2,000 inner sub-cap on that one). Children's school / tuition fees go to
      Q4 — Family & Childcare Expenses instead — there is no Form B relief for a
      school-age child's general tuition fees beyond the childcare/SSPN categories
      below. If the fee receipt doesn't specify a level, DEFAULT here rather than to
      H5(ii) — Master's/Doctorate fees are usually explicitly labelled as such.
    → Q4 — Education Relief (Non-Postgraduate)  [status: relief]

  Education Fee Receipt — Postgraduate (proprietor's own further education, H5(ii))
    → keywords: master's fee, masters fee, MBA fee, doctorate fee, PhD fee,
      postgraduate fee, doctoral programme fee
    NOTE: Any course of study specifically at Master's or Doctorate level — SAME
      RM7,000/year combined pool as H5(i) above (no separate cap of its own), but
      tracked as its own category since it's a distinct line on the printed form
      (H5(ii), not H5(i)). Only classify here when the receipt explicitly indicates
      a Master's/Doctorate programme — otherwise use H5(i) above.
    → Q4 — Education Relief (Postgraduate)  [status: relief]

  Upskilling / Self-Enhancement Course Receipt (H5(iii))
    → keywords: upskilling course, self-enhancement course, hobby class, language class,
      short course NOT tied to a formal degree/professional qualification, skill area
      recognised by the Director General of Skills Development, HRDF-adjacent short course
      for personal (not job-related) enhancement
    NOTE: A narrower sub-case of H5 — course fees for upskilling or self-enhancement that do
      NOT need to be government-recognised or tied to a formal qualification (e.g. a hobby,
      religion, or language course). This is sub-capped at RM2,000/year WITHIN the same
      RM7,000 combined H5 pool as ordinary Education Relief above — kept as its own category
      so that sub-cap can be enforced instead of silently letting it consume the full RM7,000.
      If a receipt is ambiguous between a formal qualification and a self-enhancement course,
      prefer Q4 — Education Relief (Non-Postgraduate) unless the course is clearly
      informal/hobby-oriented, or Q4 — Education Relief (Postgraduate) if it's
      explicitly a Master's/Doctorate programme.
    → Q4 — Upskilling / Self-Enhancement Course  [status: relief]

  Childcare Fee Receipt — child aged 6 and below, OR 7 to 12 from YA2026 (H12)
    → keywords: nursery fee, kindergarten fee, tadika, tabika, child care fee, childcare
      centre receipt, after-school care, care centre, registered with Department of Social
      Welfare (DSW), registered with Ministry of Education, Care Centres Act 1993
    NOTE: Fees paid to a DSW-registered child care centre or MOE-registered kindergarten,
      for a child aged 6 or below, qualify for relief up to RM3,000/year (regardless of how
      many children qualify).
      Finance Act 2025 (Act 874) s.6(a)(iv), effective YA2026 onward (s.3(1)): a SECOND,
      NEW track now shares the SAME RM3,000 pool — fees paid to a care centre registered
      under the Care Centres Act 1993, for a child aged 7 to 12. This is a genuinely
      different registration regime from the ≤6 band above (Care Centres Act 1993, not
      DSW/Child Care Centre Act 1984 or MOE/Education Act 1996), and only applies for
      YA2026 onward — a 7-to-12 child's fees do NOT qualify before YA2026 even if the
      centre happens to be Care-Centres-Act-registered.
      Fees for a child OVER 12, or an unregistered provider at any age, do not qualify
      here regardless of year — route those to Q4 — Family & Childcare Expenses
      (non_deductible) instead.
      Extract child_age_band so the backend can apply the correct year-gated test:
        "6 or under"  — qualifies in any year
        "7 to 12"     — only qualifies from YA2026 onward, and only if the provider is a
                        registered CARE CENTRE (not just any nursery/kindergarten)
        "over 12"     — never qualifies
        "unclear"     — receipt doesn't state or imply the child's age at all
      Also extract provider_registration_status:
        "registered"   — the receipt/letterhead explicitly states DSW, MOE, or Care
                         Centres Act registration (a registration number, "berdaftar
                         dengan JKM/KPM", or similar)
        "unregistered" — the document explicitly indicates it is NOT a registered provider
        "unclear"      — an ordinary fee receipt with no registration information either
                         way (this will be the ORDINARY case for most receipts — do not
                         infer "registered" just because it's a nursery, kindergarten, or
                         care centre; plenty of unregistered private providers use those
                         same words)
      Still classify here whenever the receipt is plausibly for a qualifying-age child —
      the backend applies the year/age gate, not this step.
    → Q4 — Childcare Fees  [status: relief]  or  Q4 — Family & Childcare Expenses

  SSPN Deposit / Statement (H13)
    → keywords: SSPN, Skim Simpanan Pendidikan Nasional, SSPN deposit, SSPN penyata,
      child education savings account statement
    NOTE: Only the NET amount deposited in the basis year (total deposits minus total
      withdrawals in that year) is deductible, up to RM8,000/year — a prior year's brought-
      forward balance is never part of this figure. If the statement shows deposit and
      withdrawal lines separately, extract both sspn_deposit_myr and sspn_withdrawal_myr so
      the backend can compute the net; if only a single net "total deposit this year" figure
      is shown, put that in sspn_deposit_myr and leave sspn_withdrawal_myr null.
    → Q4 — SSPN Net Deposit  [status: relief]

  Education / Medical Insurance Premium Statement (H19)
    → keywords: education insurance premium, education policy premium, medical insurance
      premium (family/individual policy, NOT the proprietor's business insurance), takaful
      pendidikan, takaful perubatan, rider premium (payor benefit / dreadful disease / medical)
    NOTE: Premiums for an education or medical insurance policy covering the taxpayer,
      spouse, or child qualify for relief up to RM3,000/year. This is distinct from
      Q4 — Life Insurance & Takaful Relief (life insurance / EPF pool) and from
      Q3 — Business Insurance (the proprietor's business cover, a business deduction, not a
      personal relief).
    → Q4 — Education & Medical Insurance  [status: relief]

  Sports Equipment Purchase Receipt (H10(i))
    → keywords: sports equipment purchase, sports gear, racket, ball, sports shoes
      (EXCLUDING motorised two-wheel bicycles)
    NOTE: Purchase of sports equipment for any activity listed under the Sports
      Development Act 1997, for the taxpayer, spouse, or child. RM1,000/year combined
      with H10(ii)/(iii)/(iv) below.
    → Q4 — Sports Equipment  [status: relief]

  Sports Facility Rental / Entrance Fee Receipt (H10(ii))
    → keywords: sports facility rental, court rental, field rental, entrance fee (sports
      facility), swimming pool entrance fee
    NOTE: Rental or entrance fee to any sports facility, for the taxpayer, spouse, or
      child. Same RM1,000/year combined pool as H10(i)/(iii)/(iv).
    → Q4 — Sports Facility Fee  [status: relief]

  Sports Competition Registration Fee Receipt (H10(iii))
    → keywords: sports competition registration, race entry fee, tournament registration
      fee
    NOTE: Registration fee for a sports competition where the organiser is approved and
      licensed by the Commissioner of Sports under the Sports Development Act 1997, for
      the taxpayer, spouse, or child. Same RM1,000/year combined pool as
      H10(i)/(ii)/(iv).
    → Q4 — Sports Competition Fee  [status: relief]

  Gym Membership / Sports Training Fee Receipt (H10(iv))
    → keywords: gym membership, fitness centre membership, sports training fee, personal
      trainer fee, yoga studio membership, sports club membership
    NOTE: Gym membership or sports training fees provided by a sports association/club
      registered with the Commissioner of Sports, or a company incorporated under the
      Companies Act 2016, for carrying out an activity listed under the Sports
      Development Act 1997. Same RM1,000/year combined pool as H10(i)/(ii)/(iii). This
      is separate from, and in addition to, H9's group (Books & Publications /
      Personal Computer & Devices / Internet Subscription / Personal Enrichment Course).
    → Q4 — Gym & Sports Training  [status: relief]

  ── DONATIONS / GIFTS / CONTRIBUTIONS (Part G / B17) ──
  CRITICAL DISTINCTION shared by all ten categories below: an approved
  donation is NOT a personal relief capped by a fixed ringgit amount like the
  Q4 relief categories above. It is deducted from aggregate income BEFORE
  chargeable income is derived (Part G, transferred to B17) — the actual cap
  applied (10% of B11 combined for some, an individual RM20,000 for others,
  or no cap at all) can only be computed once total income for the year is
  known, not per-document; that's handled in main.py, not here. Only
  classify into ANY of these ten when the receipt is clearly from a
  Government body, local authority, or an institution/fund/sports body/
  project/facility explicitly APPROVED by the Director General of Inland
  Revenue, Minister of Finance, or the relevant valuing authority named
  below — a receipt from an unapproved charity does not qualify for ANY of
  these and should NOT be classified here (treat as
  Q4 — Personal Living Expenses; non_deductible, and note the approval
  uncertainty). When approval can't be confirmed from the receipt alone,
  still classify into the closest-matching category below but flag
  needsReview — do not silently default to non-deductible on ambiguous cases
  the way you would for the earlier Q4 relief categories, since donations
  receipts rarely state their own approval status explicitly.

  Government / Local Authority Donation (G1)
    → keywords: donation to Government, gift to State Government, local authority receipt,
      resit derma kerajaan, sumbangan kepada kerajaan negeri
    NOTE: Gift of money to the Government, a State Government, or a local authority.
      Subsection 44(6). Part of the combined 10%-of-B11 pool with G2a–G2d.
    → Q4 — Donation: Government/Local Authority  [status: donation]

  Approved Institution / Organisation / Fund Donation (G2a)
    → keywords: approved institution receipt, donation to registered NGO, resit derma badan
      kebajikan diluluskan, LHDN-approved organisation, tax-exempt donation receipt
    NOTE: Gift of money to institutions/organisations/funds approved by the Director General
      of Inland Revenue — this is the most common donation category for a typical filer (e.g.
      a receipt from a registered charity/NGO that states LHDN approval or a tax-exemption
      reference number). Subsection 44(6) and proviso. Part of the combined 10%-of-B11 pool.
    → Q4 — Donation: Approved Institution  [status: donation]

  Approved Sports Activity Donation (G2b)
    → keywords: donation for sports activity, sumbangan sukan, gift to sports body approved
      by Minister of Finance
    NOTE: Gift of money for a sports activity approved by the Minister of Finance.
      Subsection 44(11B) and proviso. Part of the combined 10%-of-B11 pool.
    → Q4 — Donation: Approved Sports Activity  [status: donation]

  National Interest Project Donation (G2c)
    → keywords: donation for national interest project, contribution in kind for approved
      project, sumbangan projek kepentingan negara
    NOTE: Gift of money OR cost of contribution in kind for a project of national interest
      approved by the Minister of Finance. Subsection 44(11C) and proviso. Part of the
      combined 10%-of-B11 pool.
    → Q4 — Donation: National Interest Project  [status: donation]

  Wakaf / Endowment Donation (G2d)
    → keywords: wakaf receipt, endowment to public university, gift to religious authority,
      derma wakaf, sumbangan endowmen universiti awam
    NOTE: Gift of money in the form of wakaf to a religious authority/body/public university
      allowed to receive wakaf, OR endowment to a public university. Subsection 44(11D). Part
      of the combined 10%-of-B11 pool (explicitly stated in LHDN's own notes for this one).
    → Q4 — Donation: Wakaf/Endowment  [status: donation]

  Artefacts / Manuscripts / Paintings to Government (G3)
    → keywords: gift of artefacts to Government, donation of manuscripts, painting donated
      to State Government, value determined by Department of Museums Malaysia or National
      Archives
    NOTE: Gift of artefacts, manuscripts, or paintings to the Government or a State
      Government, valued by the Department of Museums Malaysia or the National Archives.
      Subsection 44(6A). NOT part of the 10%-of-B11 pool, and no separate ringgit cap — but
      the VALUE must come from one of those two named valuing authorities, not the donor's
      own estimate; flag needsReview if the receipt doesn't show an official valuation.
    → Q4 — Donation: Artefacts to Government  [status: donation]

  Library Facilities Donation (G4)
    → keywords: donation for library facilities, gift of money to library, sumbangan
      kemudahan perpustakaan, school library donation receipt
    NOTE: Gift of money (not exceeding RM20,000) for the provision of library facilities to
      public libraries and libraries of schools/institutions of higher education. Subsection
      44(8). Capped INDIVIDUALLY at RM20,000 — NOT part of the 10%-of-B11 pool.
    → Q4 — Donation: Library Facilities  [status: donation]

  Disabled-Persons Facilities Donation (G5)
    → keywords: donation for disabled facilities, contribution in kind for OKU facilities,
      sumbangan kemudahan orang kurang upaya, value determined by local authority
    NOTE: Gift of money OR contribution in kind for the provision of public facilities for
      the benefit of disabled persons, valued by the relevant local authority. Subsection
      44(9). NOT part of the 10%-of-B11 pool, no separate ringgit cap — flag needsReview if a
      contribution-in-kind receipt doesn't show a local-authority valuation.
    → Q4 — Donation: Disabled Facilities  [status: donation]

  Medical Equipment Donation to Healthcare Facility (G6)
    → keywords: gift of medical equipment, donation to hospital approved by Ministry of
      Health, sumbangan peralatan perubatan, MOH-approved healthcare facility
    NOTE: Gift of money, or the cost/value (certified by the Ministry of Health) of medical
      equipment, to a healthcare facility approved by the Ministry of Health — not exceeding
      RM20,000. Subsection 44(10). Capped INDIVIDUALLY at RM20,000 — NOT part of the
      10%-of-B11 pool.
    → Q4 — Donation: Medical Equipment  [status: donation]

  Paintings to National/State Art Gallery (G7)
    → keywords: painting donated to National Art Gallery, gift to state art gallery, value
      determined by National Art Gallery
    NOTE: Gift of paintings to the National Art Gallery or any state art gallery, valued by
      that gallery. Subsection 44(11). NOT part of the 10%-of-B11 pool, no separate ringgit
      cap — flag needsReview if the receipt doesn't show an official gallery valuation.
    → Q4 — Donation: Paintings to Art Gallery  [status: donation]

  Domestic Tourism / Hotel Receipt (personal stay)
    → keywords: hotel receipt (personal stay), accommodation receipt, resort booking,
      tourism package receipt, travel package, percutian, resort fee (personal)
    NOTE: Qualifying hotel accommodation and tour packages in Malaysia up to RM1,000/year relief.
      Contrast with personal non-qualifying trips → Q4 — Personal Travel & Leisure; non_deductible.
    → Q4 — Domestic Tourism Relief  [status: relief]  or  Q4 — Personal Travel & Leisure

  Tourist Attraction / Cultural & Arts Programme Entrance Fee Receipt
    → keywords: entrance fee, admission ticket, tourist attraction, cultural programme,
      arts programme, heritage site, theme park admission, museum entrance, cultural festival
    NOTE — CRITICAL, YA2026 ONLY: Finance Act 2025 (Act 874) s.6(a)(v) introduces this as a
      genuinely NEW relief (RM1,000/year) for entrance fees to tourist attractions or
      cultural/arts programmes — it is NOT a revival of the older, separate "Domestic
      Tourism Relief" above (which covers hotel stays/tour packages and remains lapsed).
      Per s.3(2), this relief applies to YA2026 ONLY — not before, and not automatically
      after, regardless of when this document happens to be uploaded or dated. The backend
      enforces the exact-year gate; still classify entrance-fee receipts here whenever they
      plausibly qualify by description, whatever year they're dated.
    → Q4 — Tourist Attraction & Cultural Programme  [status: relief]  or  Q4 — Personal Travel & Leisure

  EV Charger Purchase / Installation Receipt
    → keywords: EV charger, electric vehicle charger, EV charging equipment, pengecas EV,
      EV charging installation, home EV charger
    NOTE: Purchase and installation of EV charging equipment for the taxpayer's own vehicle
      (not for business use). Stated eligible years: 2023-2027 (Finance Act 2025, Act 874,
      s.6(a)(vi)). From YA2026-2027, this shares ONE RM2,500 pool with three new items below
      (food waste compost/grinder machines, home CCTV) rather than having its own standalone
      cap — the backend applies the correct pool depending on the filing year.
    → Q4 — EV Charging Equipment  [status: relief]

  Food Waste Compost Machine Purchase Receipt
    → keywords: food waste compost machine, food waste composter, kitchen compost machine,
      mesin kompos sisa makanan
    NOTE — Finance Act 2025 (Act 874) s.6(a)(vi): household food waste compost machine,
      claimable ONCE across YA2025, 2026, or 2027 (not once per year — once across the
      whole window), sharing the RM2,500 pool with EV charging/grinder/CCTV from YA2026
      onward. Still classify here regardless of which year within the window this is —
      the backend's registry decides whether this specific year is the eligible claim.
    → Q4 — Food Waste Compost Machine  [status: relief]

  Food Waste Grinder Machine Purchase / Installation Receipt
    → keywords: food waste grinder, food waste disposal unit, kitchen waste grinder,
      mesin pengisar sisa makanan
    NOTE — Finance Act 2025 (Act 874) s.6(a)(vi): household food waste grinder machine
      (purchase or installation), claimable ONCE across YA2026 or 2027, sharing the
      RM2,500 pool with EV charging/compost machine/CCTV.
    → Q4 — Food Waste Grinder Machine  [status: relief]

  Home CCTV Purchase / Installation Receipt
    → keywords: CCTV, closed-circuit television, home security camera system, CCTV
      installation, kamera litar tertutup
    NOTE — Finance Act 2025 (Act 874) s.6(a)(vi): household CCTV (purchase or
      installation), claimable ONCE across YA2026 or 2027, sharing the RM2,500 pool with
      EV charging/compost machine/grinder machine. A CCTV system installed for BUSINESS
      premises security belongs in Q3 business expenses instead — only a household/
      residential system belongs here.
    → Q4 — Home CCTV  [status: relief]  or  Q3 — Business Utilities (if clearly for business premises)

  Zakat Payment Receipt / Zakat Confirmation
    → keywords: zakat, bayaran zakat, resit zakat, zakat pendapatan, zakat harta, zakat perniagaan,
      zakat fitrah, MAIS, Lembaga Zakat Selangor, LZS, Majlis Agama Islam, pusat zakat,
      zakat certificate, e-zakat, bayaran zakat online, zakat receipt
    NOTE — CRITICAL DISTINCTION: Zakat is NOT a personal tax relief that reduces chargeable income.
      It is a TAX REBATE that offsets tax PAYABLE ringgit-for-ringgit, applied after tax is computed.
      This means: (1) it applies after all income, deductions, and personal reliefs are calculated;
      (2) the full zakat amount paid reduces the final tax bill directly (subject to the amount of
      tax payable — cannot create a refund); (3) it applies to Muslim proprietors only.
      Extract the total zakat amount paid and the issuing zakat authority.
      Set status: relief; set relief_cap_myr: null (no statutory cap — full amount offsets tax payable).
    → Q4 — Zakat  [status: relief]

  Section 110 Withholding Tax Certificate / Statement (Others) — B29
    → keywords: seksyen 110, section 110 withholding, tax withheld at source, withholding tax
      certificate, potongan cukai, interest withholding, royalty withholding, trust income
      withholding, s.4A income withholding
    NOTE — CRITICAL DISTINCTION: like Zakat, this is a REBATE against tax PAYABLE, not an
      income-reducing relief — but unlike Zakat, it's a CREDIT for tax LHDN considers you to
      have already effectively paid via withholding (domestic withholding on interest,
      royalties, s.4A income, or trust income — NOT the section 107A withholding on
      non-resident contractor payments, and NOT section 107D below, which is its own
      separate B-line). Extract the withheld amount and what kind of income it relates to.
      Set status: relief; set relief_cap_myr: null (no statutory cap).
    → Q4 — Section 110 Withholding (Others)  [status: relief]

  Section 107D Withholding Tax Statement (agent/dealer/distributor payments) — B33ii
    → keywords: seksyen 107D, section 107D, 2% withholding, agent commission withholding,
      dealer withholding, distributor withholding, potongan cukai 2%, CP107D
    NOTE — CRITICAL DISTINCTION: this is a PAYMENT already made on the proprietor's behalf
      (the 2% a payer company withholds when paying its agents/dealers/distributors in cash),
      economically the same role as MTD or a CP500 instalment — it reduces the final BALANCE
      of tax payable (B33/B34), not tax payable itself (unlike B29/Zakat above, which reduce
      tax payable directly). Mainly relevant to direct-sales/MLM-style businesses receiving
      commission income. Extract the withheld amount and the paying company's name.
      Set status: relief; set relief_cap_myr: null (no statutory cap).
    → Q4 — Section 107D Withholding  [status: relief]

  Departure Levy Receipt / Boarding Pass + Visa (Umrah or Other Religious Pilgrimage) — B27iii
    → keywords: departure levy, levi berlepas, boarding pass, umrah visa, resit levi berlepas,
      religious pilgrimage verification, RM8/RM20/RM50/RM150 departure levy rate
    NOTE — CRITICAL: this is a REBATE (offsets tax payable directly), for air travel
      specifically for UMRAH or another religious pilgrimage — explicitly NOT hajj (hajj has
      no departure-levy rebate under this line). Evidenced by a boarding pass plus (for umrah)
      a Saudi embassy visa copy, or (for other pilgrimages) written verification from a
      recognised religious body. CRITICAL CAP: limited to 2 TRIPS IN A LIFETIME — not 2 per
      year, not 2 within some window, but 2 EVER across every year this taxpayer has ever
      filed. This app cannot know about trips claimed before it started tracking documents,
      so this will always need a review flag rather than being silently trusted past the
      cap. Extract:
        amount     : the departure levy amount actually paid (string) — NOT the cost of the
                    trip itself, only the levy (RM8/RM50 ASEAN economy/other-class, RM20/RM150
                    non-ASEAN economy/other-class, per current rates)
        trip_type  : "umrah" | "other_religious" | "unclear"
      Set status: relief; set relief_cap_myr: null (capped by trip COUNT, not a ringgit
      amount — the backend enforces the lifetime count from the full claim history).
    → Q4 — Departure Levy (Umrah/Religious Travel)  [status: relief]  or  Q4 — Personal Travel & Leisure

  ── PART J INCENTIVE CLAIMS — OUT OF SCOPE ──
  Part J (paragraph 127(3)(b) special/further/double deductions) is out of
  scope for this feature (product decision, 14 Jul 2026). Do NOT classify any
  document as a J1/claim-code category — it no longer exists. A company
  secretary / tax agent fee invoice belongs in the ordinary
  "Q3 — Professional & Legal Fees" category instead (still a real deductible
  business expense, just without the special-deduction treatment); a
  franchise fee invoice belongs in an ordinary Q3 expense category too.

  Breastfeeding Equipment Purchase Receipt (H11)
    → keywords: breast pump, breast pump kit, ice pack for breast milk, breast milk storage
      bag, breast milk collection equipment, cooler bag, cooler set, pam susu, beg simpanan
      susu ibu
    NOTE: Deduction up to RM1,000, for a breastfeeding mother's OWN purchase of qualifying
      equipment (breast pump kit and ice pack; breast milk collection/storage equipment;
      cooler set or cooler bag) for her own use to breastfeed her own child aged 2 years or
      below. Allowed only ONCE EVERY TWO YEARS OF ASSESSMENT — this multi-year eligibility
      check is done in main.py from a persisted claim registry, not per-document, so just
      extract the amount and date here; do not attempt to determine eligibility yourself.
      Set relief_cap_myr: null (the RM1,000 cap and the 2-year gate are both enforced at the
      registry level, not per-document).
    → Q4 — Breastfeeding Equipment  [status: relief]

  ── SPREADSHEET TYPES ──

  Spreadsheet — Expense Report
    → columns likely contain: date, description/particulars, category, amount, receipt no.

  Spreadsheet — Sales Ledger
    → columns likely contain: invoice no., customer, date, amount, balance, payment status

  Spreadsheet — Payroll Register
    → columns likely contain: employee name, IC/staff ID, basic salary, EPF, SOCSO, net pay

  Spreadsheet — General Ledger / Trial Balance
    → columns likely contain: account code, account name, debit, credit, balance

  Spreadsheet — Purchase Ledger
    → columns likely contain: supplier, PO number, invoice date, amount, payment date

  Spreadsheet — Asset Register
    → columns likely contain: asset description, acquisition date, cost, IA, AA, NBV

  Spreadsheet — Unknown
    → use when the spreadsheet structure does not match any of the above patterns

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — QUADRANT & CATEGORY ASSIGNMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Assign the document to EXACTLY ONE quadrant and EXACTLY ONE category.

{_Q1_BLOCK}

{_Q2_BLOCK}

{_Q3_BLOCK}

{_Q4_BLOCK}

SPECIAL:
  • Mixed / Pending Review
    Use ONLY when a single document genuinely straddles two quadrants or requires a split
    calculation mandated by ITA 1967. Do NOT use as a catch-all for uncertainty —
    choose the closest category and lower confidence instead.
  • Non-Tax Document
    Zero financial content whatsoever (see Step 1).

ITA SECTION TAGGING — always populate the ita_section field:
  s.4a    → Q1 core business income
  s.4aa   → Q1 capital gains (from 1 Jan 2024)
  s.4b    → Q2 employment income
  s.4c    → Q2 dividends / interest
  s.4d    → Q2 passive rental / royalties
  s.4e    → Q2 pension / annuity / periodical
  s.4f    → Q2 casual / miscellaneous
  s.33    → Q3 fully deductible operating expense
  s.39    → Q3 expense subject to disallowance / cap
  sch3    → Q3 capital allowance (Schedule 3); not directly deductible
  relief  → Q4 personal tax relief
  nil     → Q4 personal spend with no tax benefit; or Non-Tax Document

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4 — DEDUCTIBILITY & COMPLIANCE RULES (ITA 1967)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

──────────────────────────────────────────────────
Q1 BUSINESS INCOME RULES
──────────────────────────────────────────────────

  • Accrual basis (s.24): income is recognised when the invoice is ISSUED or when the right
    to receive arises — not when cash is received. If the document is a sales invoice for
    goods/services delivered in a prior period, flag this in the note field.
  • SST collected from customers is a liability remitted to Kastam — it is NOT the proprietor's
    income. Do not include SST amounts in the income figure; extract them into gst_sst_amount.
  • Capital gains (s.4aa): taxed at flat rate; separate from s.4(a) business profit.
    Extract disposal_consideration, acquisition_cost, and gain/loss in line_items.
  • e-Invoice (s.82C): if the document is an LHDN MyInvois / Peppol-validated e-invoice,
    note this in the note field. If gross business revenue appears to exceed RM1,000,000,
    flag in the note that e-invoice compliance may be mandatory.
  • P&L / Balance Sheet (Phase 6, 14 Jul 2026): financial summaries — extract every
    figure into the financial_statement field (see its schema below), NOT into
    line_items. These are DERIVED AGGREGATES, not a transaction — the system
    treats them as reference-only regardless of what is extracted, and will
    NEVER sum this document's amount into the user's income or deduction
    totals. Set the top-level "amount" field to null for these documents.
    The same applies to a Filed Form B (Prior Year) document — it is a
    carry-forward reference, not current-year income; leave "amount" null there
    too (its own structured fields go in form_b, not financial_statement).

──────────────────────────────────────────────────
Q2 PERSONAL INCOME RULES
──────────────────────────────────────────────────

  • Form EA / Employment Income (s.4b): declare the GROSS income from box 1 of Form EA.
    PCB deducted by employer is a withholding; it offsets the proprietor's final tax bill.
    Extract: gross_income, pcb_deducted, epf_employee, socso_employee.
  • Passive Rental Income (s.4d): declare on NET basis. Allowable deductions AGAINST rental
    income include: quit rent (cukai tanah), assessment tax (cukai pintu), mortgage INTEREST
    on the rental property (not capital repayment), fire insurance on rental property,
    management fee, and maintenance charges. Net rental loss CANNOT be carried forward.
  • Royalties (s.4d): gross amount received. Malaysian citizen exemptions may apply:
      literary/artistic/musical works published in Malaysia and patents registered under
      the Patents Act 1983 may qualify for partial exemption (verify gazette each YA).
      Software royalties are generally fully taxable. Always flag and advise tax agent review.
  • Dividends (s.4c): most Malaysian single-tier dividends are tax-exempt (s.127);
    foreign dividends and co-operative dividends are taxable. Flag exemption status.
  • Investment interest (s.4c): Malaysian bank savings / FD interest for resident individuals
    generally exempt. P2P financing returns, foreign interest, and unlicensed entity interest
    are taxable. Flag exemption status.
  • Pension (s.4e): exempt if received from an approved fund on reaching retirement age (55+)
    or compulsory retirement. Early retirement or informal pension may be taxable — flag.
  • Alimony / periodical payments (s.4e): taxable in the recipient's hands.
  • Casual income (s.4f): fully taxable; no exemption.
  • Foreign-source income (FSI): remittance of overseas income into Malaysia.
      Since 1 Jan 2022 resident individuals are subject to world-income taxation in principle,
      but a blanket individual exemption has been extended annually under Sch 6 Para 28.
      ALWAYS flag FSI documents with a note that the exemption status must be confirmed
      against the gazette for the relevant year of assessment — do not make a taxable/exempt
      call from the document alone. Route to Q2 — Foreign-Source Income (FSI); status income.
      Exception: if the foreign income is from the proprietor's own trade invoiced to a foreign
      client (e.g. a freelancer billing an overseas company), classify as Q1 — Sales & Service
      Revenue (s.4a) — that is active business income, not remittance-basis FSI.

──────────────────────────────────────────────────
Q3 BUSINESS EXPENSE RULES
──────────────────────────────────────────────────

ALWAYS DEDUCTIBLE (s.33(1) — wholly & exclusively in producing business income):
  • Cost of goods sold: raw materials, inventory, direct freight-in
  • Employee salaries, EPF employer 13%, SOCSO employer, EIS employer
  • Business premises rent and commercial utilities (TNB, water, business internet/phone)
  • Professional fees: audit, accounting, legal, tax agent, secretarial, SSM fees
  • Advertising and marketing costs; promotional materials
  • Business insurance: fire, burglary, public liability, workmen compensation,
    professional indemnity on business assets/premises
  • Employee group hospitalisation / group term life as staff welfare benefit
  • Business loan / overdraft / hire purchase INTEREST portion only (s.33(1)(a))
    — capital repayment is balance-sheet movement, NOT deductible
  • Business travel: fuel, toll, parking for client visits with logbook evidence
  • Mileage reimbursement to employees at LHDN approved rate (RM0.60/km car; RM0.30/km motorcycle)
  • Foreign currency expenses at Bank Negara Malaysia rate on the transaction date (not invoice date)
  • SaaS / software subscriptions (monthly/annual) for business use: deductible as revenue opex
    under s.33(1); 8% SST on digital services is non-recoverable but forms part of the deductible cost
  • Revenue repairs restoring asset to original condition (no enhancement)
  • Petty cash on qualifying business items (same deductibility rules as full invoices)
  • CP58 commission payments to agents/dealers (s.83A)

NEVER DEDUCTIBLE (s.39(1) disallowances):
  • Proprietor's own drawings or informal "salary" — proprietors draw profits, not wages (s.39(1)(c))
  • Personal living expenses: groceries, personal phone, personal clothing
  • Fines, penalties, traffic summons (s.39(1)(d))
  • Personal loan / PTPTN capital repayments
  • Home renovation (unless home = registered sole business address; apportion by floor area)
  • Capital repayment portion of any loan or hire purchase (principal; not interest)
  • Book depreciation in the accounts — replaced by Schedule 3 capital allowance (do not double-count)
  • Life insurance / takaful premiums for the proprietor (personal benefit; goes to Q4)
  • Rental income received as landlord — this is Q2 income, not a Q3 expense

MIXED / REQUIRES APPORTIONMENT:

  • Client entertainment (s.39(1)(l) — 50% cap):
    - 50% applies to the TOTAL bill inclusive of SST
    - Zero deduction if no demonstrable business connection
    - Staff-only meals / team lunches (no clients present) → 100% deductible under s.33(1);
      flag as mixed to confirm no clients attended
    - question: "Was this a meal/event with business clients/prospects, or exclusively for your own staff?"
    - source: "ITA 1967 s.39(1)(l); LHDN PR No. 3/2020"

  • Client & corporate gifts (always mixed — apply the appropriate case):
      CASE A — Unbranded festive hamper (Raya, CNY, Deepavali, Christmas):
        50% deductible under s.39(1)(l).
        question: "Are these hampers branded with your company logo or name?"
        source: "ITA 1967 s.39(1)(l); LHDN PR No. 3/2020"
      CASE B — Branded promotional hamper/gift with company logo, distributed to general public
        on a non-discriminatory basis:
        100% deductible as promotional expense under s.33(1).
        Still flag as mixed — LLM cannot verify branding or distribution method from invoice alone.
        question: "Are these gifts customised with your company logo and distributed to the general
          public on a non-discriminatory basis (not just selected clients)?"
        source: "ITA 1967 s.33(1); LHDN PR No. 3/2020"
      CASE C — Hamper contents include disqualifying items (alcohol, tobacco, watches, jewellery,
        designer handbags visible in packing list or line items):
        Disqualifying portion → non_deductible outright; remaining may qualify under Case A/B.
        question: "Does the hamper contain alcohol, tobacco, or luxury goods (watches, jewellery,
          designer items)? If so, please provide the value breakdown."
        source: "ITA 1967 s.39(1)(c), s.39(1)(l); LHDN PR No. 3/2020"
      CASE D — Gift to proprietor's own family member / personal associate:
        Fully non_deductible — treated as proprietor drawings under s.39(1)(c).
        question: "Are any of these gifts intended for your own family members or personal contacts?"
        source: "ITA 1967 s.39(1)(c); LHDN PR No. 3/2020"
      CASE E — Hamper / gift for employees only (bona fide staff welfare):
        100% deductible under s.33(1); not subject to s.39(1)(l) entertainment restriction.
        Still flag as mixed to confirm recipients are employees, not directors or family.
        question: "Are these hampers/gifts given exclusively to employees (not clients, directors,
          or the proprietor's family)?"
        source: "ITA 1967 s.33(1); LHDN PR No. 3/2020"
      If only generic "gifts" / "door gifts" with no detail → treat as Case A.
      If Hamper Contents List uploaded → inspect before assigning Case A or B; escalate to Case C
        if disqualifying items appear.
      Documentation: vendor invoice + gift distribution record required for ALL cases.

  • Home office (s.33(1)):
    - Portion of rent/utilities if home = registered business address
    - Apportion by (business floor area m²) / (total floor area m²)
    - question: "What percentage of your home floor area is used exclusively for the business?"
    - source: "ITA 1967 s.33(1)"

  • Mixed-use vehicle (personal car also used for business):
    - Apportion all costs by (business km) / (total km) using a mileage logbook
    - No logbook = LHDN will disallow the claim entirely
    - Includes: fuel, toll, parking, car insurance, road tax, car maintenance
    - question: "Do you maintain a mileage logbook? What percentage of total km is for business use?"
    - source: "ITA 1967 s.33(1); LHDN PR No. 1/2014"

  • Mixed-use phone / internet:
    - Apportion by estimated business use % (e.g. 70% business, 30% personal)
    - question: "What percentage of this phone/internet usage is for business purposes?"
    - source: "ITA 1967 s.33(1)"

  • Insurance — mixed scenarios:
    - Life insurance assigned to bank as loan collateral → interest deductible but premium is personal; flag
    - Motor insurance on vehicle used for both personal and business → apportion by business use %
    - question: "Is this insurance policy solely for a business asset/premises, or does it also cover personal use?"
    - source: "ITA 1967 s.33(1)"

  • Loan / HP statement (interest vs principal not split):
    - question: "Please provide the interest vs principal breakdown from your loan schedule,
        or confirm the monthly interest amount."
    - source: "ITA 1967 s.33(1)(a)"

  • Renovation invoice (capital and revenue items mixed):
    - question: "Does this renovation invoice include any new construction or major structural upgrades,
        or is it purely repair and maintenance work?"
    - source: "ITA 1967 Schedule 3; LHDN PR No. 2/2001"

  • Leased-premises renovation:
    - Tenant CANNOT claim Industrial Building Allowance (IBA) — only the building owner can
    - Tenant CAN claim capital allowance on qualifying plant (AC, partitions, cabling): IA 20% + AA 14%/year
    - Structural works enhancing the building shell → non-deductible for the tenant
    - question: "Is this renovation on leased or owned premises? What items are included —
        new fit-out, structural changes, or routine repairs?"
    - source: "ITA 1967 Schedule 3; LHDN PR No. 2/2001"

  • Software subscriptions:
    - SaaS / recurring (monthly / annual) → revenue opex; deductible under s.33(1) in year paid
    - Perpetual licence (one-time, no expiry) → capital expenditure; IA 20% + AA 20%/year (Schedule 3)
    - Dual personal/business use → apportion by business use %; flag as mixed if <50% business
    - question: "Is this subscription used exclusively for business, or shared with personal use?
        If shared, what is the estimated business-use percentage?"
    - source: "ITA 1967 s.33(1); Schedule 3"

  • Staff housing/car allowances exceeding LHDN prescribed limits:
    - Deductible to employer as payroll cost; but BIK for employee — must appear on employee's EA form
    - source: "ITA 1967 s.13(1)(b); LHDN PR No. 5/2019"

  • Employee medical reimbursements:
    - Deductible to employer; panel clinic cap RM300/employee/year for tax-free benefit to employee
    - source: "LHDN PR No. 5/2019"

  • Overseas trips (business + personal days):
    - Airfare: 100% deductible if PRIMARY purpose is business; 0% if primary purpose is personal
    - Accommodation & meals abroad: apportion strictly by (business days) / (total trip days)
    - Local transport at destination: deductible only on business days
    - Conference / exhibition / seminar fees: 100% deductible if business-related
    - Personal day activities: non_deductible
    - Documentation: travel itinerary, meeting agendas, boarding passes, hotel invoices required
    - question: "What was the primary purpose of this trip — business or personal?
        How many days were spent on business vs personal activities?"
    - source: "ITA 1967 s.33(1); LHDN PR No. 9/2015"

  • Foreign currency expenses:
    - Deductible at Bank Negara Malaysia official rate on the DATE OF PAYMENT (not invoice date)
    - If MYR equivalent not stated on document → flag as mixed
    - question: "Please confirm the MYR equivalent using the Bank Negara Malaysia rate
        on the date payment was made."
    - source: "ITA 1967 s.33(1); LHDN PR No. 9/2015"

  CAPITAL ALLOWANCE RULES (Schedule 3):
    Assets are NOT deducted in the year of purchase. Instead, claim:
      Initial Allowance (IA): once, in year of acquisition
      Annual Allowance (AA): each year of qualifying use
    NEVER deduct the full purchase price of a capital asset as a P&L expense.
    Output fields asset_class, ia_rate_pct, aa_rate_pct MUST be populated for any capital asset.

──────────────────────────────────────────────────
Q4 PERSONAL RELIEF RULES
──────────────────────────────────────────────────

  Q4 relief items reduce the proprietor's INDIVIDUAL chargeable income on Form B.
  They are NOT business deductions — they apply AFTER net business profit is computed.
  Always note the applicable annual relief cap in the note field.

  Relief caps (YA 2025 — verify against current gazette at filing):
    Life insurance + EPF (combined)                  : up to RM7,000 (RM3k insurance + RM4k EPF)
    EPF personal contribution (alone)                : up to RM4,000
    PRS contribution                                 : up to RM3,000
    SOCSO / EIS personal contribution                : up to RM350
    Parent medical care (H2)                         : up to RM8,000
    Self/spouse/child medical (H6+H7+H8 combined)    : up to RM10,000
    Medical equipment (disabled)                     : up to RM6,000
    Lifestyle (books, internet, devices)             : up to RM2,500
    Education, own (H5(i)/(ii)+(iii) combined)       : up to RM7,000 — of which upskilling/
                                                        self-enhancement (H5(iii)) alone is
                                                        further sub-capped at RM2,000
    Childcare / kindergarten fees, child ≤6 (H12)    : up to RM3,000
    SSPN net deposits (H13)                          : up to RM8,000 (net of withdrawals — see
                                                        the SSPN Deposit / Statement entry above)
    Education & medical insurance (H19)              : up to RM3,000
    Sports & fitness (H10)                           : up to RM1,000
    Breastfeeding equipment (H11)                     : up to RM1,000, once every 2 YAs (see
                                                        the Breastfeeding Equipment entry above)
    Domestic tourism                                 : up to RM1,000
    EV charging equipment                            : up to RM2,500
    Zakat                                            : full amount paid (no cap; offsets tax PAYABLE not income)
    Approved donations                               : capped at 10% of B11 (aggregate income) —
                                                        NOT a fixed ringgit amount, so set
                                                        relief_cap_myr: null here; the backend
                                                        computes the 10% cap once B11 is known.

  Note: the fixed per-child relief (H16 — RM2,000/RM8,000/RM6,000–14,000 depending on age,
  study status, and disability) is intentionally NOT in this list. It is never derived from a
  receipt — it depends on each child's recorded age/study/disability status — so no document
  should ever be classified in a way that claims to represent it directly.

  Expenses that EXCEED relief caps are non_deductible personal spending — reclassify the
  excess portion as Q4 — Personal Living Expenses or the relevant Q4 non-deductible category.

  ZAKAT — special treatment (tax rebate, not relief):
    Zakat operates differently from all other Q4 items. It is a REBATE against tax payable,
    applied at the final stage of the Form B computation AFTER chargeable income and personal
    reliefs are already summed. The full zakat amount paid is credited against the tax payable
    figure. It cannot produce a refund (rebate limited to tax payable). Set relief_cap_myr: null.
    Applicable to Muslim proprietors only. Extract the zakat amount and issuing authority.

  Q4 non-relief personal spend (status: non_deductible):
    • Personal groceries, household bills → Q4 — Personal Living Expenses
    • Personal leisure travel, flights, hotels (non-tourism relief) → Q4 — Personal Travel & Leisure
    • Personal dining, restaurants (no business client present) → Q4 — Personal Dining & Entertainment
    • Personal clothing, electronics, home furniture → Q4 — Personal Shopping
    • Personal medical expenses beyond parental / check-up caps → Q4 — Personal Medical Expenses
    • Baby products, school fees beyond child-relief caps → Q4 — Family & Childcare Expenses

──────────────────────────────────────────────────
CROSS-CUTTING COMPLIANCE CHECKS
──────────────────────────────────────────────────

  s.82 — 7-Year Record Keeping:
    Every financial document must be retained for 7 years.
    Populate the tax_year field with the financial year the document belongs to.
    This allows a document management system to track when documents may be safely purged.

  s.82C — e-Invoice Compliance:
    If gross annual business revenue appears to exceed RM1,000,000, note in the note field
    that the proprietor may be required to issue LHDN-validated e-invoices (MyInvois / Peppol).
    Flag the document as a Q1 — e-Invoice / LHDN Validated if it carries a MyInvois UUID
    or QR code linked to the LHDN portal.

  s.107B — CP500 Tax Installments:
    Distinguish an instalment NOTICE (extract ya_year, total_scheduled_amount) from a
    PAYMENT RECEIPT (extract ya_year, amount, reference_no) — see the CP500 section above
    for the full distinguishing criteria. Never extract a notice's schedule into `amount`.
    Note: CP502 must be filed before 30 June if estimated income drops by >30%.

  s.83A — CP58 Obligation:
    If the document is a CP58 or shows commission payments to a single agent/dealer
    exceeding RM5,000 in a calendar year, flag this obligation in the note field.

  s.112 / s.113 — Penalties:
    If a document reveals under-reported income or a late-filed period, note the risk
    of penalty (up to 300% of tax undercharged under s.113(2)).

  s.24 — Accrual Basis (income):
    If a Q1 income document covers a period that spans multiple tax years (e.g. a rental
    agreement with advance rental), flag this in the note field for the accountant to review.

  s.77A — Form B Filing Deadline:
    The sole proprietor's Form B must be filed by 30 June of the following year (e-Filing).
    If a document reveals income or expenses belonging to a year where the filing deadline
    has already passed, flag in the note field that a late submission may attract penalties
    under s.112 (failure to furnish return) — up to RM2,000 fine or 3x tax undercharged.

  FSI — Foreign-Source Income Exemption Status:
    Any document classified as Q2 — Foreign-Source Income (FSI) must carry a note that the
    exemption status under Sch 6 Para 28 ITA 1967 is gazette-dependent and year-specific.
    Do not make a taxable/exempt determination — flag for tax agent review at filing time.

──────────────────────────────────────────────────
CONFIDENCE SCORING
──────────────────────────────────────────────────

  90–100 → Clear document type; vendor name, amount, date, and doc number all present;
            business or personal context is unambiguous; SSM/ROC number visible on B2B invoices
  70–89  → Most fields present; minor ambiguity (no SSM/ROC, vendor is consumer-facing,
            or one key field missing)
  50–69  → Key fields missing or partially legible; best-estimate classification;
            personal vs business nature unclear from document alone
  <50    → Severely damaged, illegible, or insufficient context

  PENALTY TRIGGERS (reduce confidence by 10–20 points):
    - No vendor SSM/ROC/ROB number on what appears to be a B2B invoice
    - Foreign currency with no MYR conversion stated
    - Amount present but date missing (or vice versa)
    - Document is a photo that is partially cut off or skewed
    - Line items present but descriptions are generic ("services rendered", "miscellaneous")
    - Quadrant assignment is uncertain (could plausibly be Q2 or Q3)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT — return ONLY valid JSON, no markdown fences, no preamble
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{
  "is_tax_relevant": true,
  "quadrant": "<Q1 | Q2 | Q3 | Q4 | Mixed | NonTax>",
  "ita_section": "<s.4a | s.4aa | s.4b | s.4c | s.4d | s.4e | s.4f | s.33 | s.39 | sch3 | relief | nil>",
  "document_type": "<precise label from Step 2>",
  "category": "<exactly one category from Step 3>",
  "vendor": "<vendor/company/payer name, or 'Unknown'>",
  "vendor_reg": "<SSM/ROC/ROB number if visible, else null>",
  "vendor_addr": "<vendor address if visible, else null>",
  "doc_no": "<invoice/receipt/reference number, or null>",
  "date": "<document date DD Mon YYYY e.g. 15 Jun 2024, or null. If the document shows a PERIOD/RANGE instead of a single date (e.g. 'Statement Period: 01/01/2024 - 31/12/2024', 'Billing Period: Feb 2024', a tenancy/coverage/policy period), extract the END date of that range/period — never the start date>",
  "tax_year": "<financial year this document belongs to, e.g. 2024, or null>",
  "amount": "<total amount as string e.g. RM 1,240.00, or null>",
  "gst_sst_amount": "<SST amount if separately stated, else null>",
  "currency": "<MYR unless foreign currency shown>",
  "note": "<one sentence: what this document is, which quadrant and s.4x / s.33 / relief category it feeds, and any compliance flag>",
  "confidence": <integer 0–100>,
  "line_items": [
    {{"desc": "<item or service>", "qty": <number or null>, "unit_price": <float or null>, "amt": <float>,
      "date": "<ONLY for Bank Statement — Transaction Ledger: this line's own date, YYYY-MM-DD, else null>",
      "direction": "<ONLY for Bank Statement — Transaction Ledger: 'credit' or 'debit', else null>"}}
  ],
  "asset_class": "<ONLY for Q3 capital assets: e.g. Computer, Furniture, Plant & Machinery, Motor Vehicle, Signage, Renovation>",
  "ia_rate_pct": <ONLY for Q3 capital assets: IA rate as integer e.g. 20, else null>,
  "aa_rate_pct": <ONLY for Q3 capital assets: AA rate as integer e.g. 14, else null>,
  "cgt_disposal_consideration": "<ONLY for s.4(aa) CGT documents: disposal/sale price as string e.g. RM 50,000.00, else null>",
  "cgt_acquisition_cost": "<ONLY for s.4(aa) CGT documents: original acquisition cost as string, else null>",
  "cgt_gain_loss": "<ONLY for s.4(aa) CGT documents: computed gain or loss as string e.g. Gain RM 12,000.00, else null>",
  "ya_year": "<ONLY for CP500/CP204 notice or receipt: the year of assessment the instalment scheme is FOR — may differ from tax_year/date if this is a late payment for a prior YA, as integer e.g. 2024, else null>",
  "total_scheduled_amount": "<ONLY for a CP500/CP204 INSTALMENT NOTICE (schedule of what's due, not a receipt): the year's total scheduled amount as string, else null>",
  "reference_no": "<ONLY for a CP500/CP204 PAYMENT RECEIPT: bank/transaction reference or LHDN bill number, else null>",
  "relief_cap_myr": <ONLY for Q4 relief items: applicable annual cap as integer e.g. 3000, or null if no cap (Zakat, Approved Donations — see the Q4 rules above for why)>,
  "zakat_amount": "<ONLY for Q4 — Zakat documents: total zakat paid as string e.g. RM 1,200.00, else null>",
  "sspn_deposit_myr": "<ONLY for Q4 — SSPN Net Deposit documents: total deposited in the basis year as string, else null>",
  "sspn_withdrawal_myr": "<ONLY for Q4 — SSPN Net Deposit documents: total withdrawn in the basis year as string, or null if the statement shows no withdrawals>",
  "dsw_registered": "<ONLY for Q4 — Medical Equipment Relief: 'yes' | 'no' | 'unclear', else null>",
  "provider_registration_status": "<ONLY for Q4 — Childcare Fees: 'registered' | 'unregistered' | 'unclear', else null>",
  "child_age_band": "<ONLY for Q4 — Childcare Fees: '6 or under' | '7 to 12' | 'over 12' | 'unclear', else null>",
  "vaccine_name": "<ONLY for Q4 — Vaccination: the specific vaccine/immunisation named, else null>",
  "npra_registered": "<ONLY for Q4 — Vaccination: 'yes' | 'no' | 'unclear', else null>",
  "policy_life_insured": "<ONLY for Q4 — Life Insurance & Takaful Relief: 'self' | 'spouse' | 'child' | 'unclear', else null>",
  "income_type": "<ONLY for Q1 — Voluntary Disclosure (Prior Year Income): what kind of income, else null>",
  "disclosed_ya": "<ONLY for Q1 — Voluntary Disclosure (Prior Year Income): the YA this income belongs to, as integer, else null>",
  "trip_type": "<ONLY for Q4 — Departure Levy (Umrah/Religious Travel): 'umrah' | 'other_religious' | 'unclear', else null>",
  "fsi_source_country": "<ONLY for Q2 — Foreign-Source Income: country of origin e.g. Singapore, else null>",
  "reason": "<ONLY if mixed: the specific ITA 1967 rule causing ambiguity>",
  "question": "<ONLY if mixed: single most important clarifying question for the user>",
  "source": "<ONLY if mixed: cite LHDN Public Ruling number or ITA 1967 section e.g. s.39(1)(l)>",
  "form_b": {{
    "ONLY for Q1 — Filed Form B (Prior Year). All fields are strings unless noted. Null any field not found on the document.",
    "ya_year": <integer e.g. 2023 or null>,
    "statutory_income_4a": "<string amount e.g. RM 85,000.00 or null>",
    "statutory_income_4b": "<string amount or null>",
    "statutory_income_4c": "<string amount or null>",
    "statutory_income_4d": "<string amount or null>",
    "statutory_income_4e": "<string amount or null>",
    "statutory_income_4f": "<string amount or null>",
    "aggregate_income": "<string amount or null>",
    "total_business_deductions": "<string amount or null>",
    "approved_donations": "<string amount or null>",
    "total_personal_reliefs": "<string amount or null>",
    "chargeable_income": "<string amount or null>",
    "tax_charged": "<string amount or null>",
    "zakat_rebate": "<string amount or null>",
    "tax_payable": "<string amount or null>",
    "cp500_total_paid": "<string amount or null>",
    "balance_payable_refundable": "<string amount or null>",
    "unabsorbed_business_losses": "<string amount or null>",
    "unabsorbed_capital_allowance": "<string amount or null>",
    "n8_gross_profit": "<string amount or null — ONLY if Part N financial particulars is also on this document>",
    "n26_net_profit": "<string amount or null — same condition as n8_gross_profit>"
  }},
  "form_ea": {{
    "ONLY for Q2 — Employment Income (s.4b). Null any field not found on the document.",
    "employer_name": "<string or null>",
    "employer_e_number": "<string or null>",
    "gross_income": "<string amount or null>",
    "pcb_deducted": "<string amount or null>",
    "epf_employee": "<string amount or null>",
    "socso_employee": "<string amount or null>",
    "eis_employee": "<string amount or null>",
    "benefits_in_kind": "<string amount or null>",
    "ya_year": <integer or null>,
    "employment_start_date_this_ya": "<YYYY-MM-DD or null — null means employment was already ongoing from before the YA began>",
    "employment_end_date_this_ya": "<YYYY-MM-DD or null — null means employment was ongoing through 31 Dec of the YA>"
  }},
  "financial_statement": {{
    "ONLY for Q1 — Financial Statements (P&L) or Q1 — Financial Statements (BS). Null any field not shown on this document — do not derive a missing figure from others.",
    "sales_or_turnover": "<string amount or null>",
    "opening_inventory": "<string amount or null>",
    "closing_inventory": "<string amount or null>",
    "other_business_income": "<string amount or null>",
    "dividends": "<string amount or null>",
    "rents_royalties_premiums": "<string amount or null>",
    "contract_subcontracts": "<string amount or null>",
    "bad_debts": "<string amount or null>",
    "stated_revenue": "<string amount or null>",
    "stated_net_profit": "<string amount or null, signed e.g. -12,000.00 for a loss>",
    "land_buildings": "<string amount or null>",
    "plant_machinery": "<string amount or null>",
    "motor_vehicles": "<string amount or null>",
    "other_non_current_assets": "<string amount or null>",
    "investments": "<string amount or null>",
    "inventory": "<string amount or null>",
    "trade_debtors": "<string amount or null>",
    "sundry_debtors": "<string amount or null>",
    "cash_in_hand": "<string amount or null>",
    "cash_at_bank": "<string amount or null>",
    "other_current_assets": "<string amount or null>",
    "loans_overdrafts": "<string amount or null>",
    "trade_creditors": "<string amount or null>",
    "sundry_creditors": "<string amount or null>",
    "capital_account": "<string amount or null>",
    "current_account_bf": "<string amount or null>",
    "drawings_advance_net": "<string amount or null>"
  }}
}}"""


# ─── File validation ───────────────────────────────────────────────────────────
def validate_upload(filename: str, content_type: str, file_size_bytes: int) -> tuple[bool, str]:
  """Validate file extension, MIME type, and size. Returns (is_valid, error_message)."""
  ext = os.path.splitext(filename)[1].lower()
  if ext not in ALLOWED_EXTENSIONS:
    supported = "PDF, images (PNG, JPG, TIFF, WebP), or spreadsheets (XLSX, XLS, CSV)"
    return False, f"'{ext}' files are not supported. Please upload a {supported}."
  if content_type and content_type not in ALLOWED_MIME_TYPES:
    logger.warning(
      f"[Validation] Unexpected content-type '{content_type}' for '{filename}' — proceeding on extension."
    )
  size_mb = file_size_bytes / (1024 * 1024)
  if size_mb > MAX_FILE_SIZE_MB:
    return False, f"File size {size_mb:.1f} MB exceeds the {MAX_FILE_SIZE_MB} MB limit."
  return True, ""


# ── Content limits ────────────────────────────────────────────────────────────
# Single cap applied once at extraction time (spreadsheets) or at the LLM call site
# (PDFs/images). Spreadsheets are capped inside extract_text_from_spreadsheet()
# because the truncation logic there is aware of sheet structure. For OCR content
# we cap here, once, and pass the full result to the LLM without a second slice.
LLM_CONTENT_CHAR_LIMIT = 12_000   # ~3,000 tokens; comfortably within Gemini context

# OCR quality thresholds for low-quality image detection
OCR_MIN_CHARS          = 40    # below this → unreadable; classification attempted on partial content
OCR_LOW_QUALITY_CHARS  = 200   # below this → low quality; confidence penalised automatically
def get_file_kind(file_path: str) -> Literal["document", "image", "spreadsheet"]:
  """Determine extraction pathway from file extension."""
  ext = os.path.splitext(file_path)[1].lower()
  if ext in DOCUMENT_EXTENSIONS:
    return "document"
  if ext in IMAGE_EXTENSIONS:
    return "image"
  if ext in SPREADSHEET_EXTENSIONS:
    return "spreadsheet"
  raise ValueError(f"Unsupported file extension: {ext}")


# ─── Extraction pathways ───────────────────────────────────────────────────────
# Building a DocumentConverter loads the EasyOCR (torch) models, which is slow
# and memory-heavy. The pipeline runs on a fixed pool of worker threads, so we
# cache one converter PER THREAD (thread-local) and reuse it across every
# document that thread handles. Thread-local (rather than a single shared
# converter) avoids concurrent convert() calls racing on the same torch models.
_converter_local = threading.local()


def _get_document_converter() -> DocumentConverter:
  converter = getattr(_converter_local, "converter", None)
  if converter is None:
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = True
    # "en" = English; "ms" = Malay (Bahasa Malaysia) — Malaysian documents use both.
    # EasyOCR shares the Latin character set between both languages so there is no
    # meaningful accuracy penalty for loading both models together.
    pipeline_options.ocr_options = EasyOcrOptions(lang=["en", "ms"], use_gpu=False)
    converter = DocumentConverter(
      format_options={
        InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
      }
    )
    _converter_local.converter = converter
  return converter


def extract_text_with_docling(file_path: str) -> tuple[str, dict]:
  """
  OCR extraction for PDFs and images via Docling.

  Returns
  -------
  (text, ocr_meta) where ocr_meta contains:
    char_count      : int   — number of non-whitespace characters extracted
    quality         : str   — "good" | "low" | "unreadable"
    quality_note    : str   — human-readable explanation of quality assessment
  """
  converter = _get_document_converter()
  result   = converter.convert(file_path)
  text     = result.document.export_to_markdown()
  stripped = text.strip()
  char_count = len(stripped.replace(" ", "").replace("\n", ""))

  if char_count < OCR_MIN_CHARS:
    quality      = "unreadable"
    quality_note = (
      f"OCR extracted only {char_count} non-whitespace characters. "
      "The document may be a blurry scan, a low-resolution photo, a handwritten receipt "
      "with illegible writing, a blank page, or a password-protected PDF. "
      "Classification will be attempted on partial content but accuracy will be very low."
    )
  elif char_count < OCR_LOW_QUALITY_CHARS:
    quality      = "low"
    quality_note = (
      f"OCR extracted {char_count} non-whitespace characters — below the threshold for "
      "confident extraction. The document may be a handwritten receipt, a dark or skewed "
      "scan, or a photo taken at an angle. Key fields (amount, date, vendor) may be missing "
      "or misread. Classification confidence will be penalised automatically."
    )
  else:
    quality      = "good"
    quality_note = ""

  ocr_meta = {
    "char_count":   char_count,
    "quality":      quality,
    "quality_note": quality_note,
  }
  return text, ocr_meta


def extract_text_from_spreadsheet(file_path: str) -> str:
  """
  Parse Excel or CSV files into a plain-text representation for the LLM.

  Strategy:
  - Read all sheets (Excel) or the single sheet (CSV) with NO header row
    assumed (header=None). Real-world spreadsheets routinely have a title/
    watermark row, blank rows, and label/value metadata rows (e.g.
    "Business: ...", "Period: 01/01/2024 - 31/12/2024") BEFORE the actual
    data table starts. Blindly trusting row 1 as the header (pandas'
    default) silently swallows all of that into a single garbled column
    under a meaningless header, corrupting the table before the LLM ever
    sees it — this was the root cause of financial-statement and CP500
    xlsx uploads sometimes extracting no fields / no amount at all (bug
    fix, 17 Jul 2026). Passing the full raw grid instead — every row
    shown, nothing pre-judged as metadata vs. header vs. data — lets the
    LLM itself locate the real table structure from complete context, the
    same "don't pre-guess, give full context" approach used elsewhere in
    this pipeline.
  - Drop completely empty rows/columns.
  - Convert each sheet to a markdown-style table, with the ORIGINAL 1-based
    row numbers kept as the index so the LLM can still refer back to "row 3"
    etc. when explaining what it read.
  - Prepend a summary (sheet name, row/column counts, detected numeric columns).
  - Cap at 8,000 characters.
  """
  ext = os.path.splitext(file_path)[1].lower()
  sections: list[str] = []

  try:
    if ext == ".csv":
      sheets = {"Sheet1": pd.read_csv(file_path, dtype=str, keep_default_na=False, header=None)}
    else:
      xf = pd.ExcelFile(file_path, engine="openpyxl")
      sheets = {
        name: xf.parse(name, dtype=str, keep_default_na=False, header=None)
        for name in xf.sheet_names
      }
  except Exception as e:
    raise ValueError(f"Could not parse spreadsheet '{os.path.basename(file_path)}': {e}")

  for sheet_name, df in sheets.items():
    # Preserve original row numbers BEFORE dropping empty rows, so the row
    # numbers shown to the LLM (and usable in any follow-up reference) match
    # what a human would count looking at the actual spreadsheet, not a
    # renumbered post-drop index.
    df.index = range(1, len(df) + 1)
    df = df.dropna(how="all").dropna(axis=1, how="all")
    if df.empty:
      sections.append(f"## Sheet: {sheet_name}\n(empty sheet — no data)\n")
      continue

    row_count, col_count = df.shape
    # No real header row is assumed, so columns get simple positional labels
    # rather than pandas' default 0/1/2 integer columns (which read
    # ambiguously once mixed into markdown output).
    df.columns = [f"Col{i + 1}" for i in range(col_count)]
    numeric_cols = [
      c for c in df.columns
      if pd.to_numeric(df[c], errors="coerce").notna().sum() > row_count * 0.5
    ]

    summary = (
      f"## Sheet: {sheet_name}\n"
      f"Rows: {row_count} | Columns: {col_count}\n"
      f"(No header row assumed — every row below is shown with its original "
      f"spreadsheet row number in the leftmost index column. Identify the "
      f"real header/label row(s) and data table yourself from context; "
      f"title, watermark, and metadata rows may appear before the real "
      f"table starts.)\n"
    )
    if numeric_cols:
      summary += f"Columns with mostly-numeric values: {', '.join(str(c) for c in numeric_cols)}\n"

    preview_df = df.head(50)
    try:
      table_md = preview_df.to_markdown(index=True)
    except Exception:
      buf = io.StringIO()
      preview_df.to_csv(buf, index=True)
      table_md = buf.getvalue()

    if row_count > 50:
      table_md += f"\n... ({row_count - 50} more rows not shown)"

    sections.append(f"{summary}\n{table_md}\n")

  combined = "\n".join(sections)
  return combined[:8000]


# ─── LLM call ─────────────────────────────────────────────────────────────────
# ── LLM call pacing & quota retry (bug fix, 17 Jul 2026) ─────────────────────
# main.py's pipeline thread pool runs up to 4 documents concurrently
# (ThreadPoolExecutor max_workers=4). With no coordination between those
# workers, a burst of documents (e.g. a 10-file batch upload) could have
# several of them calling the Gemini API within the same few seconds —
# comfortably enough to exceed the free tier's per-minute input-token quota
# (generativelanguage.googleapis.com/generate_content_free_tier_input_token_count),
# which is shared across the WHOLE app, not scoped to any one upload or user.
#
# _throttle_llm_call() serializes only the START of each call across every
# worker thread, spacing them at least LLM_MIN_CALL_INTERVAL_SECONDS apart —
# OCR and everything else in the pipeline still runs fully in parallel; only
# the moment a thread is about to actually invoke the model gets gated, and
# the lock is released again before the (multi-second) API round trip itself,
# so one slow call never blocks another thread from at least taking its turn.
#
# _invoke_llm_with_quota_retry() additionally retries specifically on a
# RESOURCE_EXHAUSTED/429 response, honouring Gemini's own suggested wait
# ("Please retry in 13.47s" / retryDelay) when the error provides one, rather
# than guessing — previously any quota hit permanently failed the document
# (status: "failed", needing a manual re-upload) even though the condition is
# transient and normally clears within seconds once the per-minute window
# rolls over. Non-quota errors are re-raised immediately and unaffected.
LLM_MIN_CALL_INTERVAL_SECONDS = 6.0
LLM_MAX_RETRIES_ON_QUOTA = 3
LLM_DEFAULT_QUOTA_RETRY_SECONDS = 20.0  # used only if Gemini's own error has no retry hint to parse

_llm_call_lock = threading.Lock()
_llm_last_call_started_at = 0.0


def _throttle_llm_call() -> None:
  global _llm_last_call_started_at
  with _llm_call_lock:
    now = time.monotonic()
    wait_needed = LLM_MIN_CALL_INTERVAL_SECONDS - (now - _llm_last_call_started_at)
    if wait_needed > 0:
      time.sleep(wait_needed)
    _llm_last_call_started_at = time.monotonic()


def _extract_retry_delay_seconds(error_message: str) -> float | None:
  """Parse Gemini's own suggested wait out of a RESOURCE_EXHAUSTED error message,
  e.g. "Please retry in 13.467381968s." or a structured retryDelay: '13s' field —
  trust the provider's own figure over a guessed default when it's available."""
  match = re.search(r"retry in (\d+(?:\.\d+)?)s", error_message)
  if match:
    return float(match.group(1))
  match = re.search(r"retryDelay['\"]?\s*:\s*['\"](\d+(?:\.\d+)?)s", error_message)
  if match:
    return float(match.group(1))
  return None


def _invoke_llm_with_quota_retry(llm, messages):
  last_error = None
  for attempt in range(1, LLM_MAX_RETRIES_ON_QUOTA + 1):
    _throttle_llm_call()
    try:
      return llm.invoke(messages)
    except Exception as e:
      msg = str(e)
      is_quota_error = "RESOURCE_EXHAUSTED" in msg or "429" in msg
      if not is_quota_error or attempt == LLM_MAX_RETRIES_ON_QUOTA:
        raise
      wait_seconds = _extract_retry_delay_seconds(msg) or LLM_DEFAULT_QUOTA_RETRY_SECONDS
      logger.warning(
        f"[Pipeline] Gemini quota exceeded (attempt {attempt}/{LLM_MAX_RETRIES_ON_QUOTA}) — "
        f"waiting {wait_seconds:.1f}s before retrying, per the provider's own retry hint."
      )
      time.sleep(wait_seconds)
      last_error = e
  raise last_error


def classify_and_extract_with_llm(
  content: str,
  filename: str,
  is_spreadsheet: bool = False,
  ocr_meta: dict | None = None,
) -> dict:
  """Send extracted text to Gemini and return a validated structured dict."""
  GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
  if not GEMINI_API_KEY:
    raise EnvironmentError("GEMINI_API_KEY is not set.")

  llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    api_key=GEMINI_API_KEY,
    temperature=0.0,
    convert_system_message_to_human=True,
  )

  spreadsheet_hint = (
    "\n\nNOTE: This content was extracted from a spreadsheet (Excel/CSV). "
    "Each section shows a sheet name, column summary, and a tabular preview. "
    "Classify based on the dominant transaction type across all rows. "
    "Use 'line_items' to capture representative rows — you do not need to list every row."
  ) if is_spreadsheet else ""

  # ── OCR quality hint ──────────────────────────────────────────────────────
  # Injected when Docling extraction flagged the document as low quality or
  # unreadable (blurry scan, handwritten receipt, dark photo, etc.).
  # Instructs the LLM to lower its confidence and surface a clarifying question.
  ocr_quality_hint = ""
  if ocr_meta and ocr_meta.get("quality") in ("low", "unreadable"):
    quality = ocr_meta["quality"]
    note    = ocr_meta.get("quality_note", "")
    ocr_quality_hint = (
      f"\n\n⚠️  OCR QUALITY WARNING ({quality.upper()}): {note}\n"
      "Because the extracted text is sparse or degraded, you MUST:\n"
      "  1. Set confidence to ≤40 for 'unreadable' quality, ≤65 for 'low' quality.\n"
      "  2. Set category to 'Mixed / Pending Review' if you cannot determine the\n"
      "     document type with reasonable certainty from the partial text.\n"
      "  3. Set question to ask the user to re-upload a clearer version or manually\n"
      "     confirm the document type, vendor, amount, and date.\n"
      "  4. Set note to explain that OCR quality was degraded and key fields may be\n"
      "     missing or inaccurate.\n"
      "  5. Still extract whatever partial fields are legible (vendor fragment,\n"
      "     partial amount, partial date) — do not return all nulls if any text exists.\n"
      "  6. If you can partially identify the document type (e.g. you can see 'Maybank'\n"
      "     and a monetary amount but nothing else), make a best-effort classification\n"
      "     and flag it as mixed with a clarifying question."
    )

  # Single content cap applied here — no second truncation in the message string.
  # Spreadsheets are pre-capped inside extract_text_from_spreadsheet().
  capped_content = content[:LLM_CONTENT_CHAR_LIMIT]

  user_message = (
    f"Filename: {filename}\n\n"
    f"Extracted content:\n---\n{capped_content}\n---"
    f"{spreadsheet_hint}"
    f"{ocr_quality_hint}\n\n"
    "Return ONLY valid JSON. No markdown code fences, no preamble, no explanation."
  )

  messages = [
    SystemMessage(content=EXTRACTION_SYSTEM_PROMPT),
    HumanMessage(content=user_message),
  ]

  response = _invoke_llm_with_quota_retry(llm, messages)
  raw_content = response.content

  if isinstance(raw_content, list):
    raw = "".join(
        block.get("text", "") if isinstance(block, dict) else str(block)
        for block in raw_content
    ).strip()
  else:
    raw = str(raw_content).strip() if raw_content is not None else ""

  if not raw:
    logger.error(f"[Pipeline] LLM returned empty response for '{filename}'")
    raise ValueError("LLM returned an empty response.")

  json_match = re.search(r"(\{.*\})", raw, re.DOTALL)
  if json_match:
    raw = json_match.group(1)

  try:
    return json.loads(raw)
  except json.JSONDecodeError as e:
    logger.error(f"[Pipeline] JSON parse failed for '{filename}': {e}")
    logger.debug(f"[Pipeline] Raw LLM output (first 300 chars): {raw[:300]}")
    return {
      "is_tax_relevant": True,
      "quadrant": "Mixed",
      "ita_section": None,
      "document_type": "Unclassified",
      "category": REVIEW_CATEGORY,
      "status": "mixed",
      "vendor": "Unknown",
      "confidence": 0,
      "note": f"Auto-classification failed — JSON parse error: {e}",
      "line_items": [],
    }


# ─── Output validation ─────────────────────────────────────────────────────────
def validate_llm_result(llm_result: dict, filename: str) -> dict:
  """
  Sanitise LLM output: enforce a known category and bounded confidence.

  NOTE THE SHAPE CHANGE (taxonomy redesign, this session): `status` is no
  longer read from, validated, or trusted in the LLM's output at all — it
  is never part of the JSON contract the model is asked to fill in (see
  EXTRACTION_SYSTEM_PROMPT). The model's ONLY classification job is picking
  the right `category`; tax_treatment/bucket/document_role/aggregation_state
  are ALWAYS derived from CATEGORY_REGISTRY by category name alone, with no
  exceptions and no override chain to have a missing branch — this is what
  eliminates (not patches) the original override-gap bug: a category like
  "Q4 — Donation: Library Facilities" or "Q3 — CP500 Instalment Notice" can
  no longer be silently mis-tagged just because the model guessed a
  different status than the canonical one.
  """
  raw_category = llm_result.get("category", REVIEW_CATEGORY)
  if raw_category not in CATEGORY_REGISTRY:
    logger.warning(
      f"[Pipeline] Unknown category '{raw_category}' for '{filename}' — defaulting to '{REVIEW_CATEGORY}'."
    )
    llm_result["category"] = REVIEW_CATEGORY

  try:
    llm_result["confidence"] = max(0, min(100, int(llm_result.get("confidence", 0))))
  except (TypeError, ValueError):
    llm_result["confidence"] = 0

  # Quadrant is now cosmetic/display-only, filled straight from the
  # registry's bucket for the FINAL category — never left for the LLM's own
  # guess to drift from what the category itself implies.
  llm_result["quadrant"] = CATEGORY_BUCKET.get(llm_result["category"], "REVIEW")

  return llm_result


_MONTH_NAMES = {
  'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
  'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
  'aug': 8, 'august': 8, 'sep': 9, 'sept': 9, 'september': 9, 'oct': 10, 'october': 10,
  'nov': 11, 'november': 11, 'dec': 12, 'december': 12,
}


def normalize_date(raw_date: str | None, tax_year: str | int | None = None) -> dict:
  """
  Parse an LLM-extracted date string (which can arrive in inconsistent
  formats, or be entirely absent) into a canonical shape the frontend can
  reliably sort, filter, and display:

    { "date": "YYYY-MM-DD" | "YYYY-MM" | "YYYY" | None, "date_precision": "day" | "month" | "year" | "unknown" }

  Falls back to tax_year (year-only precision) when no usable date string
  is present, and to "unknown" only when nothing at all is extractable —
  this is common for documents that genuinely carry no date (e.g. a torn
  receipt) or that only ever state a year/month (e.g. annual summaries).
  We deliberately do not fabricate a day (e.g. defaulting to the 1st) for
  month/year-only documents, since that would silently imply false precision.

  Also defensively handles a RANGE/PERIOD string (e.g. "01/01/2024 - 31/12/2024",
  "1 Jan 2024 to 31 Dec 2024") even though the extraction prompt now asks the
  LLM to return only the range's END date directly (bug fix, 17 Jul 2026) —
  real-world extraction won't always follow that instruction perfectly, so
  this is a second line of defense: if a range slips through anyway, split on
  the separator and re-parse just the END half through the normal single-date
  logic below, rather than letting the whole string fall through to
  "Unrecognized date format" and lose day-level precision entirely.
  """
  s = (raw_date or "").strip()

  if s:
    # Range/period string — split on a dash/en-dash/em-dash/"to" separator
    # (requires whitespace on both sides, so a plain single date like
    # "15-03-2024" or an ISO "2024-01-15" is never mistaken for a range and
    # accidentally split) and keep only the END date, then fall through to
    # the normal single-date parsing below.
    range_match = re.match(r"^.+?\s+(?:-|–|—|to)\s+(.+)$", s, re.IGNORECASE)
    if range_match:
      s = range_match.group(1).strip()

    # DD Mon YYYY / DD Month YYYY  e.g. "15 Jun 2024", "5 June 2024"
    m = re.match(r"^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$", s)
    if m:
      day, mon_name, year = m.groups()
      month = _MONTH_NAMES.get(mon_name.lower())
      if month and 1 <= int(day) <= 31:
        return {"date": f"{year}-{month:02d}-{int(day):02d}", "date_precision": "day"}

    # YYYY-MM-DD (already ISO)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if m:
      return {"date": s, "date_precision": "day"}

    # DD/MM/YYYY or DD-MM-YYYY
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$", s)
    if m:
      day, month, year = m.groups()
      if 1 <= int(month) <= 12 and 1 <= int(day) <= 31:
        return {"date": f"{year}-{int(month):02d}-{int(day):02d}", "date_precision": "day"}

    # Mon YYYY / Month YYYY  e.g. "Jun 2024", "June 2024"  — month precision only
    m = re.match(r"^([A-Za-z]+)\s+(\d{4})$", s)
    if m:
      mon_name, year = m.groups()
      month = _MONTH_NAMES.get(mon_name.lower())
      if month:
        return {"date": f"{year}-{month:02d}", "date_precision": "month"}

    # YYYY-MM
    m = re.match(r"^(\d{4})-(\d{2})$", s)
    if m:
      return {"date": s, "date_precision": "month"}

    # Bare year e.g. "2024"
    m = re.match(r"^(\d{4})$", s)
    if m:
      return {"date": s, "date_precision": "year"}

    logger.warning(f"[Date Normalize] Unrecognized date format from LLM: '{raw_date}' — falling back.")

  # No usable date string — fall back to tax_year (year precision only)
  ty = str(tax_year).strip() if tax_year else ""
  if re.match(r"^\d{4}$", ty):
    return {"date": ty, "date_precision": "year"}

  return {"date": None, "date_precision": "unknown"}


def build_extracted_data(
  llm_result: dict,
  content_preview: str,
  file_kind: str,
  ocr_meta: dict | None = None,
  document_role: str | None = None,
  aggregation_state: str | None = None,
) -> dict:
  """Merge LLM output and extraction metadata into the JSONB payload."""
  form_b_raw = llm_result.get("form_b") or {}
  form_ea_raw = llm_result.get("form_ea") or {}
  date_info = normalize_date(llm_result.get("date"), llm_result.get("tax_year"))

  return {
    # Core classification
    "is_tax_relevant":    llm_result.get("is_tax_relevant", True),
    "file_kind":          file_kind,
    "ocr_quality":        ocr_meta.get("quality")    if ocr_meta else None,
    "ocr_char_count":     ocr_meta.get("char_count") if ocr_meta else None,
    "quadrant":           llm_result.get("quadrant"),
    "ita_section":        llm_result.get("ita_section"),

    # Second & third classification dimensions — computed deterministically in
    # code (see derive_document_role / derive_aggregation_state), never from the
    # LLM. Gates whether `amount` is safe to sum into the user's totals.
    "document_role":      document_role,
    "aggregation_state":  aggregation_state,

    # Document identity
    "vendor":             llm_result.get("vendor", "Unknown"),
    "vendor_reg":         llm_result.get("vendor_reg"),
    "vendor_addr":        llm_result.get("vendor_addr"),
    "doc_no":             llm_result.get("doc_no"),
    "date":               date_info["date"],
    "date_precision":     date_info["date_precision"],
    "date_raw":           llm_result.get("date"),  # original LLM string, kept for debugging/audit
    "tax_year":           llm_result.get("tax_year"),

    # Financial figures
    "amount":             llm_result.get("amount"),
    "gst_sst_amount":     llm_result.get("gst_sst_amount"),
    "currency":           llm_result.get("currency", "MYR"),

    # Capital asset fields (Schedule 3)
    "asset_class":               llm_result.get("asset_class"),
    "ia_rate_pct":               llm_result.get("ia_rate_pct"),
    "aa_rate_pct":               llm_result.get("aa_rate_pct"),

    # Capital gains tax fields (s.4aa)
    "cgt_disposal_consideration": llm_result.get("cgt_disposal_consideration"),
    "cgt_acquisition_cost":       llm_result.get("cgt_acquisition_cost"),
    "cgt_gain_loss":              llm_result.get("cgt_gain_loss"),

    # CP500 / CP204 instalment notice vs. payment receipt (15 Jul 2026 split)
    "ya_year":                   llm_result.get("ya_year"),
    "total_scheduled_amount":    llm_result.get("total_scheduled_amount"),
    "reference_no":              llm_result.get("reference_no"),

    # Q4 relief
    "relief_cap_myr":            llm_result.get("relief_cap_myr"),
    "zakat_amount":              llm_result.get("zakat_amount"),
    "sspn_deposit_myr":          llm_result.get("sspn_deposit_myr"),
    "sspn_withdrawal_myr":       llm_result.get("sspn_withdrawal_myr"),
    "dsw_registered":            llm_result.get("dsw_registered"),
    "provider_registration_status": llm_result.get("provider_registration_status"),
    "child_age_band":              llm_result.get("child_age_band"),
    "vaccine_name":               llm_result.get("vaccine_name"),
    "npra_registered":            llm_result.get("npra_registered"),
    "policy_life_insured":        llm_result.get("policy_life_insured"),
    "income_type":                llm_result.get("income_type"),
    "disclosed_ya":               llm_result.get("disclosed_ya"),
    "trip_type":                  llm_result.get("trip_type"),

    # Q2 foreign-source income
    "fsi_source_country":        llm_result.get("fsi_source_country"),

    # ── Form EA (Q2 — Employment Income) explicit field mapping ───────────────
    # Surfaced at the top level for clean frontend aggregation (not just buried in line_items)
    "form_ea": {
      "employer_name":    form_ea_raw.get("employer_name"),
      "employer_e_number": form_ea_raw.get("employer_e_number"),
      "gross_income":     form_ea_raw.get("gross_income"),
      "pcb_deducted":     form_ea_raw.get("pcb_deducted"),
      "epf_employee":     form_ea_raw.get("epf_employee"),
      "socso_employee":   form_ea_raw.get("socso_employee"),
      "eis_employee":     form_ea_raw.get("eis_employee"),
      "benefits_in_kind": form_ea_raw.get("benefits_in_kind"),
      "ya_year":          form_ea_raw.get("ya_year"),
      "employment_start_date_this_ya": form_ea_raw.get("employment_start_date_this_ya"),
      "employment_end_date_this_ya": form_ea_raw.get("employment_end_date_this_ya"),
    } if form_ea_raw else None,

    # ── Filed Form B (Q1 — Prior Year) explicit field mapping ─────────────────
    # Enables carry-forward awareness, YA baseline, and tax profile pre-population
    "form_b": {
      "ya_year":                      form_b_raw.get("ya_year"),
      "statutory_income_4a":          form_b_raw.get("statutory_income_4a"),
      "statutory_income_4b":          form_b_raw.get("statutory_income_4b"),
      "statutory_income_4c":          form_b_raw.get("statutory_income_4c"),
      "statutory_income_4d":          form_b_raw.get("statutory_income_4d"),
      "statutory_income_4e":          form_b_raw.get("statutory_income_4e"),
      "statutory_income_4f":          form_b_raw.get("statutory_income_4f"),
      "aggregate_income":             form_b_raw.get("aggregate_income"),
      "total_business_deductions":    form_b_raw.get("total_business_deductions"),
      "approved_donations":           form_b_raw.get("approved_donations"),
      "total_personal_reliefs":       form_b_raw.get("total_personal_reliefs"),
      "chargeable_income":            form_b_raw.get("chargeable_income"),
      "tax_charged":                  form_b_raw.get("tax_charged"),
      "zakat_rebate":                 form_b_raw.get("zakat_rebate"),
      "tax_payable":                  form_b_raw.get("tax_payable"),
      "cp500_total_paid":             form_b_raw.get("cp500_total_paid"),
      "balance_payable_refundable":   form_b_raw.get("balance_payable_refundable"),
      "unabsorbed_business_losses":   form_b_raw.get("unabsorbed_business_losses"),
      "unabsorbed_capital_allowance": form_b_raw.get("unabsorbed_capital_allowance"),
      "n8_gross_profit":              form_b_raw.get("n8_gross_profit"),
      "n26_net_profit":               form_b_raw.get("n26_net_profit"),
    } if form_b_raw else None,

    # Narrative / audit trail
    "note":               llm_result.get("note", ""),
    "confidence":         llm_result.get("confidence", 0),
    "line_items":         llm_result.get("line_items", []),
    "reason":             llm_result.get("reason"),
    "question":           llm_result.get("question"),
    "source":             llm_result.get("source"),
    "content_preview":    content_preview[:1000],
  }


# Maps get_file_kind()'s extraction-pathway vocabulary ("document" | "image" |
# "spreadsheet") onto the frontend's preview-renderer vocabulary ("pdf" |
# "image" | "excel" — see CukaiAccount.jsx's apiDoc.fileType and
# CukaiBot.jsx's DocumentPreviewModal). DOCUMENT_EXTENSIONS is PDF-only today,
# so "document" always means "pdf" in practice, but the explicit map keeps
# this from silently breaking if that ever changes.
_FILE_KIND_TO_FRONTEND_TYPE = {
  "document":   "pdf",
  "image":      "image",
  "spreadsheet": "excel",
}


def build_rag_summary_text(document: "Document") -> str:
  """
  Build the short, clean natural-language summary that gets embedded for RAG
  retrieval — e.g. "Category: Business Expense, Office Supplies, RM150,
  dated 2026-03-04, vendor ABC Sdn Bhd." This is deliberately NOT the raw
  extracted_content (which is noisy OCR text); a clean summary embeds and
  matches user questions far better than raw receipt text does.
  """
  data = document.extracted_data or {}
  parts = [f"Category: {document.category or 'Unclassified'}"]
  if data.get("vendor"):
    parts.append(f"Vendor: {data['vendor']}")
  if data.get("amount") is not None:
    parts.append(f"Amount: RM{data['amount']}")
  if data.get("date"):
    parts.append(f"Date: {data['date']}")
  if document.year_of_assessment:
    parts.append(f"Year of Assessment: {document.year_of_assessment}")
  if data.get("ita_section"):
    parts.append(f"ITA Section: {data['ita_section']}")
  if document.tax_status:
    parts.append(f"Tax status: {document.tax_status}")
  if data.get("note"):
    parts.append(f"Note: {data['note']}")
  return ". ".join(parts)


def embed_document_for_rag(document: "Document") -> None:
  """
  Ingestion-side RAG hook: turn a newly classified document into one or more
  embedded chunks in MongoDB so CukaiBot's chat retrieval can find it later.

  Called once, right after a document finishes classification and its
  extracted_data is committed to Postgres (see run_document_pipeline below).
  Failures here are logged and swallowed rather than raised — a chatbot
  indexing failure should never fail the underlying document upload/
  classification the user is actually waiting on.
  """
  try:
    summary_text = build_rag_summary_text(document)
    if not summary_text.strip():
      return

    chunks = chunk_text(summary_text)
    if not chunks:
      return

    vectors = embed_texts([c.text for c in chunks], task_type="retrieval_document")

    # Relative URL into this backend's own /files/ static mount (see main.py's
    # STORAGE_DIR mount) — deliberately NOT an absolute host:port URL, so it
    # keeps working across environments the same way fileBasename does for
    # CukaiAccount.jsx's preview panel (frontend prefixes it with its own API
    # base URL). Lets CitationCard open an in-page preview for a user's own
    # document straight from the chunk, without a Postgres lookback.
    source_url = None
    file_type = None
    if document.file_path:
      basename = os.path.basename(document.file_path)
      source_url = f"/files/{basename}"
      try:
        file_type = _FILE_KIND_TO_FRONTEND_TYPE.get(get_file_kind(document.file_path))
      except ValueError:
        file_type = None  # Unrecognized extension — preview button just won't render.

    for chunk, vector in zip(chunks, vectors):
      mongo_store.insert_chunk(
        text=chunk.text,
        embedding=vector,
        user_id=document.user_id,
        entity_id=document.entity_id,
        source="document",
        doc_id=document.id,
        year_of_assessment=document.year_of_assessment,
        category=document.category,
        source_url=source_url,
        file_type=file_type,
        starts_mid_sentence=chunk.starts_mid_sentence,
      )

    logger.info(f"[Pipeline] Embedded {len(chunks)} chunk(s) for Document ID {document.id} into MongoDB.")
  except Exception as e:
    # Mirrors the "never take down the main upload flow" principle already
    # used elsewhere in this pipeline (e.g. insight generation failures).
    logger.error(f"[Pipeline] RAG embedding failed for Document ID {document.id}: {e}")


# ─── Main pipeline ─────────────────────────────────────────────────────────────
def sync_capital_asset_registry(db, document, category: str, status: str, ya_int, extracted_data: dict, description, doc_id) -> None:
  """
  Create/update/remove the CapitalAsset registry row for `document` so it
  always matches its CURRENT category/status — called from the initial
  classification pipeline below AND from main.py's manual reclassify/reset
  endpoints, so a document's capital-allowance schedule never silently
  drifts out of sync with whatever category is most recently assigned to it.

  Without the removal branch, reclassifying a document AWAY from a capital
  category would leave a stale CapitalAsset row behind, silently generating
  Annual Allowance forever even after a human said "this isn't a capital
  asset" — a real correctness bug, not just a missing feature.
  """
  existing_asset = db.query(CapitalAsset).filter(
    CapitalAsset.source_document_id == document.id,
  ).first()

  if status != "capital" or not ya_int:
    if existing_asset:
      db.delete(existing_asset)
      db.commit()
      logger.info(f"[Pipeline] Removed CapitalAsset for Document ID {doc_id} (no longer classified as capital)")
    return

  try:
    cost = parse_amount(extracted_data.get("amount"))
    if cost <= 0:
      logger.warning(
        f"[Pipeline] Document ID {doc_id} classified as capital but no positive "
        "amount was extracted — skipping CapitalAsset registry entry. This "
        "document will need manual review to enter the asset register."
      )
      return

    acquisition_date = None
    if extracted_data.get("date"):
      try:
        from datetime import date as _date
        acquisition_date = _date.fromisoformat(extracted_data["date"])
      except (ValueError, TypeError):
        acquisition_date = None

    # Validate the LLM's IA/AA rates against the statutory Schedule 3 table
    # rather than trusting them — a hallucinated rate would otherwise flow
    # straight into the user's allowance figures.
    asset_class_raw = extracted_data.get("asset_class") or "Unclassified Asset"
    ia_pct, aa_pct, rate_needs_review, rate_note = resolve_capital_allowance_rates(
      asset_class_raw,
      extracted_data.get("ia_rate_pct"),
      extracted_data.get("aa_rate_pct"),
    )
    if rate_note:
      logger.info(f"[Pipeline] Document ID {doc_id} CA rate adjustment: {rate_note}")
      extracted_data["ca_rate_note"] = rate_note
      extracted_data["ca_rate_needs_review"] = rate_needs_review
      document.extracted_data = extracted_data

    asset_kwargs = dict(
      user_id            = document.user_id,
      entity_id          = document.entity_id,
      source_document_id = document.id,
      asset_class         = asset_class_raw,
      description         = description,
      cost                = cost,
      acquisition_date    = acquisition_date,
      acquisition_year    = ya_int,
      ia_rate_pct         = ia_pct,
      aa_rate_pct         = aa_pct,
    )

    if existing_asset:
      for k, v in asset_kwargs.items():
        setattr(existing_asset, k, v)
      logger.info(f"[Pipeline] Updated CapitalAsset for Document ID {doc_id}")
    else:
      db.add(CapitalAsset(**asset_kwargs))
      logger.info(f"[Pipeline] Created CapitalAsset for Document ID {doc_id}")

    db.commit()
  except Exception as ca_e:
    logger.error(f"[Pipeline] CapitalAsset upsert failed for Document ID {doc_id}: {ca_e}")
    db.rollback()  # don't fail the main document record over a registry upsert error


def sync_breastfeeding_claim_registry(db, document, category: str, ya_int, extracted_data: dict, description, doc_id) -> None:
  """
  Create/update/remove the BreastfeedingEquipmentClaim registry row for
  `document` so it always matches its CURRENT category — mirrors
  sync_capital_asset_registry above for exactly the same reason (manual
  reclassify/reset must not leave a stale H11 claim silently affecting a
  future year's 2-year eligibility check, or fail to create one when a
  document is reclassified INTO this category).

  Only the raw purchase amount/year is persisted here — eligibility (the
  "once every 2 years of assessment" gate) and the RM1,000 cap are both
  computed fresh for a target year from the FULL claim history in
  breastfeeding_relief.py, not decided at write time.
  """
  existing_claim = db.query(BreastfeedingEquipmentClaim).filter(
    BreastfeedingEquipmentClaim.source_document_id == document.id,
  ).first()

  if category != "Q4 — Breastfeeding Equipment" or not ya_int:
    if existing_claim:
      db.delete(existing_claim)
      db.commit()
      logger.info(f"[Pipeline] Removed BreastfeedingEquipmentClaim for Document ID {doc_id} (no longer classified as H11)")
    return

  try:
    claim_amount = parse_amount(extracted_data.get("amount"))
    if claim_amount <= 0:
      logger.warning(
        f"[Pipeline] Document ID {doc_id} classified as H11 breastfeeding equipment but no "
        "positive amount was extracted — skipping BreastfeedingEquipmentClaim registry entry. "
        "This document will need manual review to enter the claim."
      )
      return

    claim_kwargs = dict(
      user_id            = document.user_id,
      entity_id          = document.entity_id,
      source_document_id = document.id,
      description         = description,
      amount              = claim_amount,
      year_of_assessment  = ya_int,
    )

    if existing_claim:
      for k, v in claim_kwargs.items():
        setattr(existing_claim, k, v)
      logger.info(f"[Pipeline] Updated BreastfeedingEquipmentClaim for Document ID {doc_id}")
    else:
      db.add(BreastfeedingEquipmentClaim(**claim_kwargs))
      logger.info(f"[Pipeline] Created BreastfeedingEquipmentClaim for Document ID {doc_id}")

    db.commit()
  except Exception as bc_e:
    logger.error(f"[Pipeline] BreastfeedingEquipmentClaim upsert failed for Document ID {doc_id}: {bc_e}")
    db.rollback()  # don't fail the main document record over a registry upsert error


def sync_cp500_registry(db, document, category: str, ya_int, extracted_data: dict, doc_id) -> None:
  """
  Create/update/remove the CP500Record registry row for `document` —
  mirrors sync_capital_asset_registry's upsert-by-source-document pattern.
  Handles BOTH CP500 categories (notice and receipt) since they share the
  same table, distinguished only by `record_type`.

  `ya_int` here is the document's fully-resolved year of assessment (see
  the ya_raw chain above, which already prefers CP500's own extracted
  ya_year over the document's date) — NOT necessarily the calendar year
  the document was uploaded or dated, which matters for a late instalment
  paid in a different calendar year than the YA it's for.
  """
  existing = db.query(CP500Record).filter(CP500Record.source_document_id == document.id).first()

  is_notice  = category == "Q3 — CP500 Instalment Notice"
  is_receipt = category == "Q3 — CP500 Payment Receipt"

  if not (is_notice or is_receipt) or not ya_int:
    if existing:
      db.delete(existing)
      db.commit()
      logger.info(f"[Pipeline] Removed CP500Record for Document ID {doc_id} (no longer classified as CP500)")
    return

  try:
    if is_notice:
      amount       = parse_amount(extracted_data.get("total_scheduled_amount"))
      record_type  = "notice"
      reference_no = None
    else:
      amount       = parse_amount(extracted_data.get("amount"))
      record_type  = "payment"
      reference_no = extracted_data.get("reference_no")

    if amount <= 0:
      logger.warning(
        f"[Pipeline] Document ID {doc_id} classified as {category} but no positive amount "
        "was extracted — skipping CP500Record registry entry. This document will need "
        "manual review to enter the instalment figure."
      )
      return

    record_kwargs = dict(
      user_id            = document.user_id,
      source_document_id = document.id,
      record_type        = record_type,
      year_of_assessment = ya_int,
      amount             = amount,
      reference_no       = reference_no,
    )

    if existing:
      for k, v in record_kwargs.items():
        setattr(existing, k, v)
      logger.info(f"[Pipeline] Updated CP500Record for Document ID {doc_id}")
    else:
      db.add(CP500Record(**record_kwargs))
      logger.info(f"[Pipeline] Created CP500Record for Document ID {doc_id}")

    db.commit()
  except Exception as cp_e:
    logger.error(f"[Pipeline] CP500Record upsert failed for Document ID {doc_id}: {cp_e}")
    db.rollback()  # don't fail the main document record over a registry upsert error


# Categories handled by sync_one_time_relief_registry — kept as one constant
# so a future addition only needs one line here plus the registry
# constants/window in main.py, rather than touching this function's body.
ONE_TIME_RELIEF_CATEGORIES = {
  "Q4 — Food Waste Compost Machine",
  "Q4 — Food Waste Grinder Machine",
  "Q4 — Home CCTV",
  # B27iii (16 Jul 2026): reuses the SAME OneTimeReliefClaim storage table
  # (upsert-by-source-document is identical) — only the ELIGIBILITY logic
  # differs (lifetime trip count, not a windowed claim-once test), which is
  # why this has its OWN compute function (compute_departure_levy_rebate_
  # for_year in one_time_relief.py) even though it shares this table.
  "Q4 — Departure Levy (Umrah/Religious Travel)",
}


def sync_one_time_relief_registry(db, document, category: str, ya_int, extracted_data: dict, doc_id) -> None:
  """
  Create/update/remove the OneTimeReliefClaim registry row for `document`.
  Mirrors sync_cp500_registry's upsert-by-source-document pattern, just
  across three categories sharing one table (distinguished by `category`
  itself, rather than a record_type column, since these three don't share
  CP500's notice/receipt distinction — every document here IS a claim).
  """
  existing = db.query(OneTimeReliefClaim).filter(OneTimeReliefClaim.source_document_id == document.id).first()

  if category not in ONE_TIME_RELIEF_CATEGORIES or not ya_int:
    if existing:
      db.delete(existing)
      db.commit()
      logger.info(f"[Pipeline] Removed OneTimeReliefClaim for Document ID {doc_id} (no longer classified as a one-time relief)")
    return

  try:
    amount = parse_amount(extracted_data.get("amount"))
    if amount <= 0:
      logger.warning(
        f"[Pipeline] Document ID {doc_id} classified as {category} but no positive amount "
        "was extracted — skipping OneTimeReliefClaim registry entry."
      )
      return

    record_kwargs = dict(
      user_id            = document.user_id,
      source_document_id = document.id,
      category           = category,
      year_of_assessment = ya_int,
      amount             = amount,
    )

    if existing:
      for k, v in record_kwargs.items():
        setattr(existing, k, v)
      logger.info(f"[Pipeline] Updated OneTimeReliefClaim for Document ID {doc_id}")
    else:
      db.add(OneTimeReliefClaim(**record_kwargs))
      logger.info(f"[Pipeline] Created OneTimeReliefClaim for Document ID {doc_id}")

    db.commit()
  except Exception as otr_e:
    logger.error(f"[Pipeline] OneTimeReliefClaim upsert failed for Document ID {doc_id}: {otr_e}")
    db.rollback()  # don't fail the main document record over a registry upsert error


# P&L-side and BS-side field maps: extracted_data key → FinancialStatementProfile
# column. Kept as module-level dicts so both halves of
# sync_financial_statement_profile (and any future cleanup code) walk the
# same list rather than two independently-maintained field-by-field blocks.
_FSP_PL_FIELD_MAP = {
  "opening_inventory":        "pl_opening_inventory",
  "closing_inventory":        "pl_closing_inventory",
  "other_business_income":    "pl_other_business_income",
  "dividends":                "pl_dividends",
  "rents_royalties_premiums": "pl_rents_royalties_premiums",
  "contract_subcontracts":    "pl_contract_subcontracts",
  "bad_debts":                "pl_bad_debts",
  "stated_revenue":           "pl_stated_revenue",
  "stated_net_profit":        "pl_stated_net_profit",
}
_FSP_BS_FIELD_MAP = {
  "land_buildings":           "bs_land_buildings",
  "plant_machinery":          "bs_plant_machinery",
  "motor_vehicles":           "bs_motor_vehicles",
  "other_non_current_assets": "bs_other_non_current_assets",
  "investments":               "bs_investments",
  "inventory":                 "bs_inventory",
  "trade_debtors":             "bs_trade_debtors",
  "sundry_debtors":            "bs_sundry_debtors",
  "cash_in_hand":              "bs_cash_in_hand",
  "cash_at_bank":              "bs_cash_at_bank",
  "other_current_assets":      "bs_other_current_assets",
  "loans_overdrafts":          "bs_loans_overdrafts",
  "trade_creditors":           "bs_trade_creditors",
  "sundry_creditors":          "bs_sundry_creditors",
  "capital_account":           "bs_capital_account",
  "current_account_bf":        "bs_current_account_bf",
  "drawings_advance_net":      "bs_drawings_advance_net",
}


def sync_financial_statement_profile(db, document, category: str, ya_int, extracted_data: dict, description, doc_id) -> None:
  """
  Create/update/clear the FinancialStatementProfile HALF this document
  contributes (Phase 6, 14 Jul 2026) so Part N's Statement of Financial
  Position (N28-N50) never silently drifts out of sync with whichever
  category a P&L/BS document currently holds — same reasoning and calling
  convention as sync_capital_asset_registry / sync_breastfeeding_claim_registry
  above (called from the main pipeline below AND from main.py's manual
  reclassify/reset endpoints).

  Structurally different from those two: this record is keyed by
  (user_id, entity_id, year_of_assessment) like FormBProfile, but unlike
  FormBProfile it can be filled by TWO different document categories, each
  owning one HALF of the same row (pl_* fields vs bs_* fields). Reclassifying
  a document away from its half must clear ONLY that half — not delete the
  whole row, since the OTHER half may belong to a completely different
  document. The row itself is only deleted once BOTH halves are empty.
  """
  # Bug fix (14 Jul 2026, post-Phase-6 self-review): this used to bail out
  # entirely with `if not ya_int: return` BEFORE even looking up a stale
  # half to clear — inconsistent with sync_capital_asset_registry /
  # sync_breastfeeding_claim_registry, which both look up the existing
  # row FIRST (keyed only by source_document_id, no year needed) and clean
  # it up as part of the same "not applicable any more" branch. As written,
  # a document that lost its year (e.g. reclassified to something whose
  # date couldn't be parsed) would keep a stale P&L/BS half alive forever,
  # silently continuing to feed outdated Part N figures. Fixed: cleanup
  # below no longer depends on ya_int at all; only the CREATE/UPDATE path
  # (which genuinely needs a year to key the row) is gated on it.
  is_pl = category == "Q1 — Financial Statements (P&L)"
  is_bs = category == "Q1 — Financial Statements (BS)"

  def _num(v):
    if v is None or v == "":
      return None
    try:
      return float(str(v).replace("RM", "").replace(",", "").strip())
    except (ValueError, TypeError):
      return None

  try:
    # ── Clear this document's own half wherever it's stale ──────────────
    # A document can only ever own ONE half at a time (its category is
    # singular), so if it's no longer P&L, clear any pl_* half it used to
    # own; if no longer BS, clear any bs_* half. Also clear regardless of
    # category if ya_int is now missing — a half can't be safely kept
    # without a year to key it. Search by source_document_id directly
    # (not scoped to ya_int) since the row that needs clearing may live
    # under an OLD year if the document's year_of_assessment itself changed
    # on reclassification.
    stale_pl = db.query(FinancialStatementProfile).filter(
      FinancialStatementProfile.pl_source_document_id == document.id
    ).first()
    if stale_pl and (not is_pl or not ya_int or stale_pl.year_of_assessment != ya_int):
      for col in _FSP_PL_FIELD_MAP.values():
        setattr(stale_pl, col, None)
      stale_pl.pl_source_document_id = None
      stale_pl.pl_confidence = None
      logger.info(f"[Pipeline] Cleared stale P&L half of FinancialStatementProfile for Document ID {doc_id}")

    stale_bs = db.query(FinancialStatementProfile).filter(
      FinancialStatementProfile.bs_source_document_id == document.id
    ).first()
    if stale_bs and (not is_bs or not ya_int or stale_bs.year_of_assessment != ya_int):
      for col in _FSP_BS_FIELD_MAP.values():
        setattr(stale_bs, col, None)
      stale_bs.bs_source_document_id = None
      stale_bs.bs_confidence = None
      logger.info(f"[Pipeline] Cleared stale BS half of FinancialStatementProfile for Document ID {doc_id}")

    # Delete either row if it's now completely empty on both halves (only
    # meaningful if stale_pl/stale_bs turned out to be the SAME row as each
    # other, or as `existing` — re-fetch to check post-clear state).
    for row in {id(r): r for r in (stale_pl, stale_bs) if r is not None}.values():
      db.flush()
      if row.pl_source_document_id is None and row.bs_source_document_id is None:
        db.delete(row)
        logger.info(f"[Pipeline] Removed empty FinancialStatementProfile row (id={row.id}) — both halves cleared")

    if not (is_pl or is_bs) or not ya_int:
      # No usable year means we can't safely create/update a keyed row even
      # if the category itself is P&L/BS — cleanup above already ran, so
      # this is a safe no-op rather than guessing which year to write into.
      db.commit()
      return

    fs = extracted_data.get("financial_statement") or {}
    if not fs:
      logger.warning(
        f"[Pipeline] Document ID {doc_id} classified as {category} but no "
        "financial_statement fields were extracted — no profile saved."
      )
      db.commit()
      return

    # Re-fetch `existing` in case it was one of the rows just cleared/deleted
    # above, or needs creating fresh.
    existing = db.query(FinancialStatementProfile).filter(
      FinancialStatementProfile.user_id == document.user_id,
      FinancialStatementProfile.entity_id == document.entity_id,
      FinancialStatementProfile.year_of_assessment == ya_int,
    ).first()

    field_map = _FSP_PL_FIELD_MAP if is_pl else _FSP_BS_FIELD_MAP
    half_kwargs = {col: _num(fs.get(src_key)) for src_key, col in field_map.items()}
    if is_pl:
      half_kwargs["pl_source_document_id"] = document.id
      half_kwargs["pl_confidence"] = int(_num(extracted_data.get("confidence")) or 0)
    else:
      half_kwargs["bs_source_document_id"] = document.id
      half_kwargs["bs_confidence"] = int(_num(extracted_data.get("confidence")) or 0)

    if existing:
      for k, v in half_kwargs.items():
        setattr(existing, k, v)
      logger.info(f"[Pipeline] Updated FinancialStatementProfile ({'P&L' if is_pl else 'BS'} half) for Document ID {doc_id}")
    else:
      db.add(FinancialStatementProfile(
        user_id=document.user_id, entity_id=document.entity_id,
        year_of_assessment=ya_int, **half_kwargs,
      ))
      logger.info(f"[Pipeline] Created FinancialStatementProfile ({'P&L' if is_pl else 'BS'} half) for Document ID {doc_id}")

    db.commit()
  except Exception as fsp_e:
    logger.error(f"[Pipeline] FinancialStatementProfile sync failed for Document ID {doc_id}: {fsp_e}")
    db.rollback()  # don't fail the main document record over a registry upsert error


def run_document_pipeline(doc_id: int, file_path: str, db_session_factory):
  db: Session = db_session_factory()
  document = None
  try:
    document = db.query(Document).filter(Document.id == doc_id).first()
    if not document:
      logger.warning(f"[Pipeline] Document ID {doc_id} not found.")
      return

    document.status = "processing"
    db.commit()

    filename  = os.path.basename(file_path)
    file_kind = get_file_kind(file_path)
    logger.info(f"[Pipeline] Document ID {doc_id}: '{filename}' → kind={file_kind}")

    # ── Extraction ────────────────────────────────────────────────────────
    ocr_meta: dict | None = None
    if file_kind == "spreadsheet":
      extracted_content = extract_text_from_spreadsheet(file_path)
      is_spreadsheet = True
    else:
      extracted_content, ocr_meta = extract_text_with_docling(file_path)
      is_spreadsheet = False

    logger.info(
      f"[Pipeline] Extraction complete for Document ID {doc_id} "
      f"({len(extracted_content)} chars"
      + (f", OCR quality={ocr_meta['quality']}" if ocr_meta else "")
      + ")"
    )

    # ── OCR unreadable guard ──────────────────────────────────────────────
    # If Docling extracted almost nothing, the LLM will produce noise.
    # Mark as failed with a user-friendly message instead of wasting an LLM call.
    if ocr_meta and ocr_meta["quality"] == "unreadable" and len(extracted_content.strip()) < OCR_MIN_CHARS:
      raise ValueError(
        "Document is unreadable after OCR. "
        f"{ocr_meta['quality_note']} "
        "Please re-upload a clearer scan or photo. Tips: ensure good lighting, "
        "hold the camera level, and avoid shadows across the document."
      )

    if len(extracted_content.strip()) < 20:
      raise ValueError(
        "Extracted fewer than 20 characters — file may be blank, corrupted, or unreadable."
      )

    # ── LLM classification ────────────────────────────────────────────────
    llm_result = classify_and_extract_with_llm(extracted_content, filename, is_spreadsheet, ocr_meta)
    llm_result = validate_llm_result(llm_result, filename)

    category = llm_result.get("category", REVIEW_CATEGORY)

    # NO MORE OVERRIDE CHAIN, and the LLM's own guess is NEVER trusted. The
    # original bug was never that CATEGORY_STATUS_MAP's own values were
    # wrong — CP500 and donations were already correctly mapped there. The
    # bug was purely that the override chain could be bypassed (it had no
    # branch for donations/CP500/etc.) and the LLM's own guessed status,
    # when present, won outright. Removing the "llm_result.get('status') or"
    # fallback and the elif chain entirely — status is now ALWAYS this
    # dict's canonical value for the category, no exceptions.
    #
    # Deliberately still CATEGORY_STATUS_MAP (the original dict), not the
    # new registry's CATEGORY_TAX_TREATMENT — the new registry introduces
    # vocabulary ("tax_instalment", "rebate", "reference") that other,
    # not-yet-migrated code still reading this persisted value from
    # doc.tax_status (e.g. main.py's _business_totals_for_year, used by the
    # carryforward engine) doesn't yet know how to interpret. Swapping the
    # PERSISTED vocabulary is a separate, later migration step, done
    # together with migrating those other call sites — not bundled into
    # this fix, to avoid a cross-module mismatch this session's testing
    # (dispatch_comparison.py) doesn't cover.
    status = CATEGORY_STATUS_MAP.get(category, "mixed")

    # document_role/aggregation_state: kept on pipeline.py's OWN existing
    # functions here too (not the new registry-based ones), for the exact
    # same reason — those old functions already interpret CATEGORY_STATUS_MAP's
    # vocabulary correctly and are what every other un-migrated call site
    # in main.py still expects. The override-chain elimination above is the
    # actual root-cause fix; swapping these two functions' own internals is
    # a separate, later step.
    document_role     = derive_document_role(category)
    aggregation_state = derive_aggregation_state(category, status)

    logger.info(
      f"[Pipeline] Document ID {doc_id} classified: "
      f"quadrant='{llm_result.get('quadrant')}' | "
      f"ita='{llm_result.get('ita_section')}' | "
      f"type='{llm_result.get('document_type')}' | "
      f"category='{category}' | status='{status}' | "
      f"role='{document_role}' | aggregation_state='{aggregation_state}' | "
      f"confidence={llm_result.get('confidence')}% | "
      f"tax_relevant={llm_result.get('is_tax_relevant', True)}"
    )

    # ── Persist ───────────────────────────────────────────────────────────
    extracted_data = build_extracted_data(
      llm_result, extracted_content, file_kind, ocr_meta,
      document_role=document_role, aggregation_state=aggregation_state,
    )

    # ── EA form self-employment cross-check ─────────────────────────────
    # A sole proprietor's business profit already IS their taxable income
    # under s.4(a) — an EA form issued by their own business would double
    # count it as separate s.4(b) employment income. Can only be caught by
    # comparing against the user's own registered entity name, so it's done
    # here in code rather than left to the extraction prompt.
    if category == "Q2 — Employment Income (s.4b)" and extracted_data.get("form_ea"):
      employer_name = extracted_data["form_ea"].get("employer_name")
      entity = db.query(Entity).filter(Entity.id == document.entity_id).first() if document.entity_id else None
      if entity and employer_matches_own_entity(employer_name, entity.name):
        status             = "mixed"
        aggregation_state  = "needs_user_confirmation"
        extracted_data["document_role"]     = document_role
        extracted_data["aggregation_state"] = aggregation_state
        extracted_data["reason"] = (
          f"This EA form's employer ('{employer_name}') appears to match your own "
          f"registered business ('{entity.name}'). Your business profit already IS "
          "your taxable income under s.4(a) — a self-issued EA form would double-count "
          "the same money as separate s.4(b) employment income."
        )
        extracted_data["question"] = (
          "Is this EA form from an employer OTHER than your own sole proprietorship? "
          "If it was self-issued payroll, it should not be added as separate income."
        )
        logger.info(
          f"[Pipeline] Document ID {doc_id}: EA employer '{employer_name}' matches "
          f"own entity '{entity.name}' — flagged for user confirmation."
        )

    # ── Hire purchase — explicit interest/capital split guidance ─────────
    # HP is deliberately NOT auto-added to the capital-asset registry. Under
    # Schedule 3 the qualifying expenditure for an HP asset accrues with the
    # CAPITAL REPAYMENTS made each basis period (not the full price up front),
    # and the finance/interest portion is a separate s.33 deduction. Neither
    # split can be derived reliably from a single statement, so auto-creating
    # an asset from the gross amount would overstate allowances. Instead we
    # keep it in needs_apportionment and tell the user exactly what to do.
    if category == "Q3 — Hire Purchase & Leased Assets":
      aggregation_state = "needs_apportionment"
      extracted_data["aggregation_state"] = aggregation_state
      extracted_data["reason"] = (
        "Hire purchase has two tax treatments that can't be split automatically "
        "from this statement: the interest/finance charge is a deductible business "
        "expense (Q3, s.33), while the asset's capital cost is claimed via Schedule 3 "
        "capital allowance based on the capital repaid each year — not the full price."
      )
      extracted_data["question"] = (
        "Enter (1) the finance/interest charged this year and (2) the asset's cash "
        "price and Schedule 3 asset class, so the interest can be deducted and the "
        "asset added to your capital allowance schedule."
      )
      logger.info(f"[Pipeline] Document ID {doc_id}: hire purchase flagged for interest/capital split.")

    # Promote year_of_assessment to a top-level indexed column for YA-scoped queries
    ya_raw = extracted_data.get("tax_year") or (
      extracted_data.get("form_b") or {}
    ).get("ya_year") or (
      extracted_data.get("form_ea") or {}
    ).get("ya_year") or (
      # CP500 notices/receipts extract a top-level ya_year (the YA the
      # instalment scheme is FOR), which may differ from the document's own
      # date — e.g. a late instalment for YA2024 paid in January 2025 is
      # still FOR YA2024. Must be checked before the date[:4] fallback below,
      # or a late payment would be silently misattributed to the wrong year.
      extracted_data.get("ya_year") if category in (
        "Q3 — CP500 Instalment Notice", "Q3 — CP500 Payment Receipt",
      ) else None
    ) or (
      extracted_data.get("date")[:4] if extracted_data.get("date") else None
    )
    try:
      ya_int = int(ya_raw) if ya_raw is not None else None
      if ya_int and not (2000 <= ya_int <= 2100):
        ya_int = None
    except (TypeError, ValueError):
      ya_int = None

    document.status             = "completed"
    document.document_type      = llm_result.get("document_type", "Unclassified")
    document.category           = category
    document.tax_status         = status
    document.year_of_assessment = ya_int
    document.extracted_data     = extracted_data
    db.commit()

    # ── RAG ingestion — embed this document's summary into MongoDB so
    #    CukaiBot's chat retrieval can find it later. Non-fatal on failure. ──
    embed_document_for_rag(document)

    # ── If this is a filed Form B, upsert a FormBProfile record ──────────
    if category == "Q1 — Filed Form B (Prior Year)":
      fb = extracted_data.get("form_b") or {}
      # Prefer the Form B's own ya_year; fall back to the document's derived YA
      # so a missing ya_year doesn't drop the whole profile.
      ya_fb = fb.get("ya_year") or ya_int
      if not fb:
        logger.warning(f"[Pipeline] Document ID {doc_id} classified as Filed Form B but no form_b fields were extracted — no profile saved.")
      if fb and ya_fb:
        try:
          # Upsert: one FormBProfile per (user_id, entity_id, ya_year), so two
          # entities can each file a Form B for the same year without clobbering
          # each other. document.entity_id may be None (no active entity) — that
          # matches the existing NULL-entity row via IS NULL.
          existing = db.query(FormBProfile).filter(
            FormBProfile.user_id == document.user_id,
            FormBProfile.entity_id == document.entity_id,
            FormBProfile.year_of_assessment == int(ya_fb),
          ).first()

          # FormBProfile columns are Numeric; the LLM returns currency-formatted
          # strings ("RM 45,000.00"). Inserting those raw makes Postgres reject
          # the row and the whole upsert silently rolls back — which is why filed
          # Form B years showed no data. Coerce every money field to a float.
          def _num(v):
            if v is None or v == "":
              return None
            try:
              return float(str(v).replace("RM", "").replace(",", "").strip())
            except (ValueError, TypeError):
              return None

          profile_kwargs = dict(
            user_id                      = document.user_id,
            entity_id                    = document.entity_id,
            year_of_assessment           = int(ya_fb),
            source_document_id           = document.id,
            statutory_income_4a          = _num(fb.get("statutory_income_4a")),
            statutory_income_4b          = _num(fb.get("statutory_income_4b")),
            statutory_income_4c          = _num(fb.get("statutory_income_4c")),
            statutory_income_4d          = _num(fb.get("statutory_income_4d")),
            statutory_income_4e          = _num(fb.get("statutory_income_4e")),
            statutory_income_4f          = _num(fb.get("statutory_income_4f")),
            aggregate_income             = _num(fb.get("aggregate_income")),
            total_business_deductions    = _num(fb.get("total_business_deductions")),
            approved_donations           = _num(fb.get("approved_donations")),
            total_personal_reliefs       = _num(fb.get("total_personal_reliefs")),
            chargeable_income            = _num(fb.get("chargeable_income")),
            tax_charged                  = _num(fb.get("tax_charged")),
            zakat_rebate                 = _num(fb.get("zakat_rebate")),
            tax_payable                  = _num(fb.get("tax_payable")),
            cp500_total_paid             = _num(fb.get("cp500_total_paid")),
            balance_payable_refundable   = _num(fb.get("balance_payable_refundable")),
            unabsorbed_business_losses   = _num(fb.get("unabsorbed_business_losses")),
            unabsorbed_capital_allowance = _num(fb.get("unabsorbed_capital_allowance")),
            raw_extracted                = fb,
            confidence                   = int(_num(llm_result.get("confidence")) or 0),
          )

          if existing:
            for k, v in profile_kwargs.items():
              setattr(existing, k, v)
            logger.info(f"[Pipeline] Updated FormBProfile for user={document.user_id} entity={document.entity_id} YA={ya_fb}")
          else:
            db.add(FormBProfile(**profile_kwargs))
            logger.info(f"[Pipeline] Created FormBProfile for user={document.user_id} entity={document.entity_id} YA={ya_fb}")

          db.commit()
        except Exception as fb_e:
          logger.error(f"[Pipeline] FormBProfile upsert failed for Document ID {doc_id}: {fb_e}")
          db.rollback()  # don't fail the main document record over a profile upsert error

    # ── Keep the CapitalAsset, BreastfeedingEquipmentClaim, and (Phase 6)
    # FinancialStatementProfile registries in sync with this document's
    # final category/status. All three are no-ops (beyond a possible
    # stale-row cleanup) unless the category actually calls for them — see
    # each function above for why they're shared with main.py's manual
    # reclassify/reset endpoints.
    sync_capital_asset_registry(db, document, category, status, ya_int, extracted_data, llm_result.get("document_type"), doc_id)
    sync_breastfeeding_claim_registry(db, document, category, ya_int, extracted_data, llm_result.get("document_type"), doc_id)
    sync_cp500_registry(db, document, category, ya_int, extracted_data, doc_id)
    sync_one_time_relief_registry(db, document, category, ya_int, extracted_data, doc_id)
    sync_financial_statement_profile(db, document, category, ya_int, extracted_data, llm_result.get("document_type"), doc_id)

    # ── Bank statement line matching ────────────────────────────────────
    # Match each extracted line against the user's existing transaction
    # documents so duplicates are identified and unmatched lines (possible
    # undocumented income/expense) are surfaced. Never touches any total —
    # aggregation_state for this category is always needs_user_confirmation.
    if category == BANK_STATEMENT_CATEGORY:
      try:
        matched_lines = match_bank_statement_lines(db, document, extracted_data.get("line_items", []))
        extracted_data["line_items"] = matched_lines
        extracted_data["bank_statement_summary"] = {
          "totalLines":              len(matched_lines),
          "matchedLines":            sum(1 for li in matched_lines if li["matchStatus"] == "matched"),
          "unmatchedCreditTotalMyr": round(sum(li.get("amt") or 0 for li in matched_lines if li["matchStatus"] == "unmatched_credit"), 2),
          "unmatchedDebitTotalMyr":  round(sum(li.get("amt") or 0 for li in matched_lines if li["matchStatus"] == "unmatched_debit"), 2),
        }
        document.extracted_data = extracted_data
        db.commit()
        logger.info(
          f"[Pipeline] Document ID {doc_id} bank statement matched: "
          f"{extracted_data['bank_statement_summary']}"
        )
      except Exception as bs_e:
        logger.error(f"[Pipeline] Bank statement matching failed for Document ID {doc_id}: {bs_e}")
        db.rollback()  # don't fail the main document record over a matching error

    logger.info(f"[Pipeline] Document ID {doc_id} committed successfully.")

    # ── Insight engine ───────────────────────────────────────────────────
    # Recompute the user's insight feed now that a new document is classified.
    # This whole pipeline already runs off the request thread (submitted to
    # main._pipeline_executor at upload time), so the upload response was
    # never blocked on it — the engine simply runs at the tail of the same
    # background execution. Deferred import: insights.engine reaches back
    # into main/pipeline at call time, so importing it at module top here
    # would be circular. run_insight_engine never raises — an insight
    # failure must not fail an already-committed document.
    if document.user_id:
      from insights.engine import run_insight_engine
      # assessment_year comes from the DOCUMENT, not the wall clock: a 2025
      # receipt uploaded in July 2026 must refresh the YA2025 feed, never
      # pollute YA2026. The engine also enforces the per-YA amendment lock
      # (filed Form B on record ⇒ analysis skipped, with an audit log entry).
      run_insight_engine(
        document.user_id, document.entity_id, "document_classified", db_session_factory,
        assessment_year=document.year_of_assessment,
      )

  except Exception as e:
    logger.error(f"[Pipeline Error] Document ID {doc_id}: {e}", exc_info=True)
    db.rollback()
    try:
      document = db.query(Document).filter(Document.id == doc_id).first()
      if document:
        document.status = "failed"
        document.extracted_data = {"error_message": str(e)}
        db.commit()
    except Exception as inner_e:
      logger.error(
        f"[Pipeline Error] Could not write failure state for Document ID {doc_id}: {inner_e}"
      )
  finally:
    db.close()