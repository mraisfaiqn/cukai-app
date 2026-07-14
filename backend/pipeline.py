import csv
import difflib
import io
import json
import logging
import os
import re
import threading
from datetime import date as _date_cls
from decimal import Decimal
from dotenv import load_dotenv
from typing import Literal

import pandas as pd
from sqlalchemy.orm import Session
from models import Document, FormBProfile, CapitalAsset, Entity
from utils import parse_amount
from capital_allowance import resolve_capital_allowance_rates

from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, EasyOcrOptions

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage

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
  "Q3 — CP500 / Tax Installment",          # bimonthly advance tax (s.107B); not a deduction — tracks tax paid

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
  "Q4 — Medical & Parental Care",          # parental medical, full-body check-up, special needs
  "Q4 — Lifestyle Relief",                 # books, internet, gym, personal device (up to RM2.5k)
  "Q4 — Education Relief",                 # proprietor's own further education fees (up to RM7k)
  "Q4 — Child Relief",                     # school fees for children, SSPN, child care (various caps)
  "Q4 — Medical Equipment Relief",         # disabled aids, medical devices for self/dependant
  "Q4 — Private Retirement Scheme (PRS)",  # PRS contributions (up to RM3k)
  "Q4 — SOCSO Personal Contribution",      # employee-share SOCSO (up to RM250)
  "Q4 — Domestic Tourism Relief",          # qualifying hotel stays & tourism packages (up to RM1k)
  "Q4 — EV Charging Equipment",            # EV charger purchase & installation (up to RM2.5k)
  "Q4 — Zakat",                            # zakat payment; rebate against tax PAYABLE (not income deduction)

  # Non-deductible personal spending (no tax relief but financially relevant)
  "Q4 — Personal Living Expenses",         # groceries, personal household spend; not deductible
  "Q4 — Personal Travel & Leisure",        # personal holidays, flights; not deductible
  "Q4 — Personal Dining & Entertainment",  # personal restaurant meals; not deductible
  "Q4 — Personal Shopping",               # clothing, home furniture, electronics (personal use)
  "Q4 — Personal Medical Expenses",        # own medical bills beyond relief caps; not deductible
  "Q4 — Family & Childcare Expenses",      # baby products, school fees beyond relief caps
]

# ── Special categories ────────────────────────────────────────────────────────
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

ALL_CATEGORIES = (
  ALL_Q1 + ALL_Q2 + ALL_Q3 + ALL_Q4
  + [REVIEW_CATEGORY, NON_TAX_CATEGORY, BANK_STATEMENT_CATEGORY]
)

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
VALID_STATUSES = {"income", "deductible", "mixed", "relief", "non_deductible", "not_applicable", "capital"}

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
CATEGORY_STATUS_MAP["Q3 — CP500 / Tax Installment"]         = "not_applicable"  # advance tax payment; not a deductible expense
# Q4 relief items
_Q4_RELIEF_CATS = {
  "Q4 — Life Insurance & Takaful Relief",
  "Q4 — EPF Personal Contribution",
  "Q4 — Medical & Parental Care",
  "Q4 — Lifestyle Relief",
  "Q4 — Education Relief",
  "Q4 — Child Relief",
  "Q4 — Medical Equipment Relief",
  "Q4 — Private Retirement Scheme (PRS)",
  "Q4 — SOCSO Personal Contribution",
  "Q4 — Domestic Tourism Relief",
  "Q4 — EV Charging Equipment",
  "Q4 — Zakat",
}
_Q4_NON_DED_CATS = {
  "Q4 — Personal Living Expenses",
  "Q4 — Personal Travel & Leisure",
  "Q4 — Personal Dining & Entertainment",
  "Q4 — Personal Shopping",
  "Q4 — Personal Medical Expenses",
  "Q4 — Family & Childcare Expenses",
}
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
#     schedule_source       — feeds a multi-year computation (capital asset, hire purchase)
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
}

SCHEDULE_SOURCE_CATEGORIES = {
  "Q3 — Capital Assets & Equipment",
  "Q3 — Capital Renovation & Fit-Out",
  "Q3 — Hire Purchase & Leased Assets",
}

SUPPORTING_EVIDENCE_CATEGORIES = {
  "Q3 — CP500 / Tax Installment",
  NON_TAX_CATEGORY,
}

VALID_DOCUMENT_ROLES = {"transaction", "summary_statement", "schedule_source", "supporting_evidence", "ledger_source"}
VALID_AGGREGATION_STATES = {
  "resolved", "needs_apportionment", "needs_user_confirmation",
  "reference_only", "excluded_by_rule",
}


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
      Document.status == "completed",
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
  • Tuition / school fee receipts           → Q4 — Child Relief or Q4 — Family & Childcare Expenses
  • Baby & infant product receipts          → Q4 — Family & Childcare Expenses
  • Medical clinic / pharmacy receipts      → Q4 — Personal Medical Expenses or Q4 — Medical & Parental Care
  • Grocery / supermarket receipts          → Q4 — Personal Living Expenses
  • Personal shopping receipts              → Q4 — Personal Shopping
  • Personal travel / hotel / flight invoices → Q4 — Personal Travel & Leisure
  • Restaurant receipts (personal use)      → Q4 — Personal Dining & Entertainment
  • Gym, streaming, lifestyle subscriptions → Q4 — Lifestyle Relief (if within cap) else Q4 — Personal Living Expenses
  • Gift recipient lists / hamper packing lists alongside a hamper invoice → Q3 — Client & Corporate Gifts
  • Any receipt or invoice showing a monetary amount IS financially relevant, even if non-deductible.

If truly Non-Tax, return ONLY:
{{
  "is_tax_relevant": false,
  "quadrant": null,
  "ita_section": null,
  "document_type": "<e.g. Identity Document, Medical Record, Photograph>",
  "category": "Non-Tax Document",
  "status": "not_applicable",
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
    → Q1 — Financial Statements (P&L)

  Balance Sheet / Statement of Financial Position
    → keywords: lembaran imbangan, balance sheet, statement of financial position,
      aset, liabiliti, ekuiti, assets, liabilities, equity
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
      CP500 installment notice (s.107B) → Q3 — CP500 / Tax Installment; status: not_applicable.
        CP500 is an advance payment of estimated tax — it is NOT a deductible business expense.
        It reduces the final tax payable at filing time. Extract installment_amount and
        installment_month. A CP502 must be filed before 30 June if estimated income drops.
      CP204 (company installment) → same treatment as CP500; Q3 — CP500 / Tax Installment.
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
      Classify as: Q1 — Filed Form B (Prior Year); status: income (it is a comprehensive income record).
      Populate the form_b field in the JSON output with all extracted fields above.
    → Q1 — Filed Form B (Prior Year)

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
    NOTE: Proprietor's own life insurance / medical card is a Q4 personal relief (up to RM3,000/year
      combined life insurance + EPF; medical insurance separately up to RM3,000).
    → Q4 — Life Insurance & Takaful Relief  [status: relief]

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
    NOTE: Employee-share SOCSO/EIS qualifies for personal relief up to RM250/year.
    → Q4 — SOCSO Personal Contribution  [status: relief]

  Medical Receipt (parental / own qualifying medical)
    → keywords: hospital bill (parent), medical receipt (parent), parental medical care,
      penjagaan perubatan ibu bapa, full body check-up, medical check-up, specialist bill,
      vaccination receipt, dental receipt, optical receipt (up to RM1,000 within lifestyle)
    NOTE: Medical expenses for PARENTS qualify for relief up to RM8,000/year.
      Own full-body medical check-up qualifies up to RM1,000/year (within Q4 Medical & Parental Care).
      Personal medical expenses beyond these caps → Q4 — Personal Medical Expenses; non_deductible.
    → Q4 — Medical & Parental Care  [status: relief]  or  Q4 — Personal Medical Expenses

  Lifestyle Relief Purchases (personal)
    → keywords: gym membership, fitness centre, personal internet bill (home broadband),
      personal phone bill, e-book, physical book, newspaper subscription,
      sports equipment, personal computer (for personal use), smartphone (personal)
    NOTE: Lifestyle relief cap is RM2,500/year. Items must be for personal (not business) use.
      Business-use equivalents go to Q3 instead.
    → Q4 — Lifestyle Relief  [status: relief]

  Education Fee Receipt (proprietor's own further education)
    → keywords: university fee, college fee, professional qualification, ACCA, CPA, CIMA,
      HRDF training (own), skills course, short course fee, professional development fee
    NOTE: Proprietor's own education relief up to RM7,000/year for approved courses.
      Children's school / tuition fees go to Q4 — Child Relief instead.
    → Q4 — Education Relief  [status: relief]

  SSPN / Child Relief Documents
    → keywords: SSPN, Skim Simpanan Pendidikan Nasional, SSPN deposit, child education savings,
      tuition fee receipt, school fee receipt, yuran tuisyen, yuran sekolah, nursery fee,
      kindergarten fee, tadika, tabika, child care fee, childcare centre
    NOTE: SSPN deposits + children's education fees qualify for relief up to RM8,000/year combined.
    → Q4 — Child Relief  [status: relief]

  Domestic Tourism / Hotel Receipt (personal stay)
    → keywords: hotel receipt (personal stay), accommodation receipt, resort booking,
      tourism package receipt, travel package, percutian, resort fee (personal)
    NOTE: Qualifying hotel accommodation and tour packages in Malaysia up to RM1,000/year relief.
      Contrast with personal non-qualifying trips → Q4 — Personal Travel & Leisure; non_deductible.
    → Q4 — Domestic Tourism Relief  [status: relief]  or  Q4 — Personal Travel & Leisure

  EV Charger Purchase / Installation Receipt
    → keywords: EV charger, electric vehicle charger, EV charging equipment, pengecas EV,
      EV charging installation, home EV charger
    NOTE: Purchase and installation of EV charging equipment qualifies for relief up to RM2,500/year.
    → Q4 — EV Charging Equipment  [status: relief]

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

STATUS DEFINITIONS:
  income         → document evidences money received; declared as income in the relevant
                   s.4 section of Form B; no deductibility question applies
  deductible     → wholly & exclusively incurred in producing business income (s.33(1));
                   reduces s.4(a) net profit
  mixed          → partially deductible or requires apportionment / user confirmation;
                   MUST include reason + question + source fields
  capital        → capital asset (deducted via Schedule 3 IA+AA, not directly) — equipment,
                   renovation/fit-out, or similar capitalised expenditure
  not_applicable → supporting document with no standalone deductibility (e.g. CP500 / tax
                   installment notice, generic non-tax document)
  relief         → reduces individual chargeable income; claimed in the personal relief
                   section of Form B (Schedule 9); subject to annual caps
  non_deductible → personal spending with no tax benefit of any kind

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
  • P&L / Balance Sheet: financial summaries — extract revenue, gross profit, net profit,
    total assets, total liabilities, equity into line_items. No standalone deductibility.
    These are DERIVED AGGREGATES, not a transaction — the system treats them as
    reference-only regardless of what is extracted, and will NEVER sum this document's
    amount into the user's income or deduction totals. Set the top-level "amount" field
    to null for these documents; put every figure (revenue, net profit, total assets,
    etc.) into line_items instead, each with a clear "desc" so it's obvious which figure
    is which. The same applies to a Filed Form B (Prior Year) document — it is a
    carry-forward reference, not current-year income; leave "amount" null there too.

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
    Medical insurance / takaful (separate sub-limit) : up to RM3,000
    EPF personal contribution (alone)                : up to RM4,000
    PRS contribution                                 : up to RM3,000
    SOCSO / EIS personal contribution                : up to RM250
    Medical & parental care                          : up to RM8,000 (parents); RM1,000 own check-up
    Medical equipment (disabled)                     : up to RM6,000
    Lifestyle (books, gym, internet, devices)        : up to RM2,500
    Education (own, approved course)                 : up to RM7,000
    Child relief (each child <18)                    : RM2,000/child
    Child education (18+, tertiary)                  : RM8,000/child
    SSPN net deposits                                : up to RM8,000
    Childcare / kindergarten fees                    : up to RM3,000
    Domestic tourism                                 : up to RM1,000
    EV charging equipment                            : up to RM2,500
    Zakat                                            : full amount paid (no cap; offsets tax PAYABLE not income)

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
    If the document is a CP500 notice, extract installment_amount and installment_month.
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
  "status": "<income | deductible | mixed | capital | not_applicable | relief | non_deductible>",
  "vendor": "<vendor/company/payer name, or 'Unknown'>",
  "vendor_reg": "<SSM/ROC/ROB number if visible, else null>",
  "vendor_addr": "<vendor address if visible, else null>",
  "doc_no": "<invoice/receipt/reference number, or null>",
  "date": "<document date DD Mon YYYY e.g. 15 Jun 2024, or null>",
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
  "installment_amount": <ONLY for CP500/CP204: installment amount as float, else null>,
  "installment_month": "<ONLY for CP500/CP204: e.g. Mar 2025, else null>",
  "relief_cap_myr": <ONLY for Q4 relief items: applicable annual cap as integer e.g. 3000, or null if no cap (Zakat)>,
  "zakat_amount": "<ONLY for Q4 — Zakat documents: total zakat paid as string e.g. RM 1,200.00, else null>",
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
    "unabsorbed_capital_allowance": "<string amount or null>"
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
    "ya_year": <integer or null>
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
  - Read all sheets (Excel) or the single sheet (CSV).
  - Drop completely empty rows/columns.
  - Convert each sheet to a markdown-style table.
  - Prepend a summary (sheet name, row/column counts, detected numeric columns).
  - Cap at 8,000 characters.
  """
  ext = os.path.splitext(file_path)[1].lower()
  sections: list[str] = []

  try:
    if ext == ".csv":
      sheets = {"Sheet1": pd.read_csv(file_path, dtype=str, keep_default_na=False)}
    else:
      xf = pd.ExcelFile(file_path, engine="openpyxl")
      sheets = {
        name: xf.parse(name, dtype=str, keep_default_na=False)
        for name in xf.sheet_names
      }
  except Exception as e:
    raise ValueError(f"Could not parse spreadsheet '{os.path.basename(file_path)}': {e}")

  for sheet_name, df in sheets.items():
    df = df.dropna(how="all").dropna(axis=1, how="all")
    if df.empty:
      sections.append(f"## Sheet: {sheet_name}\n(empty sheet — no data)\n")
      continue

    row_count, col_count = df.shape
    col_names = list(df.columns)
    numeric_cols = [
      c for c in col_names
      if pd.to_numeric(df[c], errors="coerce").notna().sum() > row_count * 0.5
    ]

    summary = (
      f"## Sheet: {sheet_name}\n"
      f"Rows: {row_count} | Columns: {col_count}\n"
      f"Columns: {', '.join(str(c) for c in col_names)}\n"
    )
    if numeric_cols:
      summary += f"Numeric columns (likely amounts): {', '.join(str(c) for c in numeric_cols)}\n"

    preview_df = df.head(50)
    try:
      table_md = preview_df.to_markdown(index=False)
    except Exception:
      buf = io.StringIO()
      preview_df.to_csv(buf, index=False)
      table_md = buf.getvalue()

    if row_count > 50:
      table_md += f"\n... ({row_count - 50} more rows not shown)"

    sections.append(f"{summary}\n{table_md}\n")

  combined = "\n".join(sections)
  return combined[:8000]


# ─── LLM call ─────────────────────────────────────────────────────────────────
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

  response = llm.invoke(messages)
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
  """Sanitise LLM output: enforce valid status, known category, and bounded confidence."""

  raw_status = llm_result.get("status", "")
  if raw_status not in VALID_STATUSES:
    logger.warning(
      f"[Pipeline] Invalid status '{raw_status}' for '{filename}' — defaulting to 'mixed'."
    )
    llm_result["status"] = "mixed"

  raw_category = llm_result.get("category", REVIEW_CATEGORY)
  if raw_category not in ALL_CATEGORIES:
    logger.warning(
      f"[Pipeline] Unknown category '{raw_category}' for '{filename}' — defaulting to '{REVIEW_CATEGORY}'."
    )
    llm_result["category"] = REVIEW_CATEGORY
    llm_result["status"] = "mixed"

  try:
    llm_result["confidence"] = max(0, min(100, int(llm_result.get("confidence", 0))))
  except (TypeError, ValueError):
    llm_result["confidence"] = 0

  # Enforce quadrant consistency
  cat = llm_result.get("category", "")
  if cat in ALL_Q1 and llm_result.get("quadrant") != "Q1":
    llm_result["quadrant"] = "Q1"
  elif cat in ALL_Q2 and llm_result.get("quadrant") != "Q2":
    llm_result["quadrant"] = "Q2"
  elif cat in ALL_Q3 and llm_result.get("quadrant") != "Q3":
    llm_result["quadrant"] = "Q3"
  elif cat in ALL_Q4 and llm_result.get("quadrant") != "Q4":
    llm_result["quadrant"] = "Q4"
  elif cat == NON_TAX_CATEGORY:
    llm_result["quadrant"] = "NonTax"
    llm_result["status"] = "not_applicable"

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
  """
  s = (raw_date or "").strip()

  if s:
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

    # CP500 / CP204 installment tracking
    "installment_amount":        llm_result.get("installment_amount"),
    "installment_month":         llm_result.get("installment_month"),

    # Q4 relief
    "relief_cap_myr":            llm_result.get("relief_cap_myr"),
    "zakat_amount":              llm_result.get("zakat_amount"),

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


# ─── Main pipeline ─────────────────────────────────────────────────────────────
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
    status   = llm_result.get("status") or CATEGORY_STATUS_MAP.get(category, "mixed")

    # Hard overrides — enforce correct status regardless of what the LLM returned
    if category == NON_TAX_CATEGORY:
      status = "not_applicable"
    elif category == BANK_STATEMENT_CATEGORY:
      status = "mixed"
    elif category in ("Q3 — Capital Assets & Equipment", "Q3 — Capital Renovation & Fit-Out"):
      status = "capital"
    elif category in ALL_Q1 or category in ALL_Q2:
      status = "income"
    elif category in _Q4_RELIEF_CATS:
      status = "relief"
    elif category in _Q4_NON_DED_CATS:
      status = "non_deductible"

    # Second & third dimensions — always derived in code, from the FINAL
    # (post-override) category/status, so they can never disagree with them.
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

    # ── If this is a capital asset, upsert a CapitalAsset registry record ──
    # This is what lets Annual Allowance keep being claimed in every year
    # after acquisition without the user re-uploading the invoice — see
    # capital_allowance.py for how the year-by-year schedule is derived.
    if status == "capital" and ya_int:
      try:
        cost = parse_amount(extracted_data.get("amount"))
        if cost > 0:
          acquisition_date = None
          if extracted_data.get("date"):
            try:
              from datetime import date as _date
              acquisition_date = _date.fromisoformat(extracted_data["date"])
            except (ValueError, TypeError):
              acquisition_date = None

          existing_asset = db.query(CapitalAsset).filter(
            CapitalAsset.source_document_id == document.id,
          ).first()

          # Validate the LLM's IA/AA rates against the statutory Schedule 3
          # table rather than trusting them — a hallucinated rate would
          # otherwise flow straight into the user's allowance figures.
          asset_class_raw = extracted_data.get("asset_class") or "Unclassified Asset"
          ia_pct, aa_pct, rate_needs_review, rate_note = resolve_capital_allowance_rates(
            asset_class_raw,
            extracted_data.get("ia_rate_pct"),
            extracted_data.get("aa_rate_pct"),
          )
          if rate_note:
            logger.info(f"[Pipeline] Document ID {doc_id} CA rate adjustment: {rate_note}")
            # Surface the adjustment on the document so the UI can show it.
            extracted_data["ca_rate_note"] = rate_note
            extracted_data["ca_rate_needs_review"] = rate_needs_review
            document.extracted_data = extracted_data

          asset_kwargs = dict(
            user_id            = document.user_id,
            entity_id          = document.entity_id,
            source_document_id = document.id,
            asset_class         = asset_class_raw,
            description         = llm_result.get("document_type"),
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
        else:
          logger.warning(
            f"[Pipeline] Document ID {doc_id} classified as capital but no positive "
            "amount was extracted — skipping CapitalAsset registry entry. This "
            "document will need manual review to enter the asset register."
          )
      except Exception as ca_e:
        logger.error(f"[Pipeline] CapitalAsset upsert failed for Document ID {doc_id}: {ca_e}")
        db.rollback()  # don't fail the main document record over a registry upsert error

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
    if document.user_id and document.year_of_assessment is not None:
      from insights.engine import queue_insight_run, run_insight_engine
      # assessment_year comes from the DOCUMENT, not the wall clock: a 2025
      # receipt uploaded in July 2026 must refresh the YA2025 feed, never
      # pollute YA2026. The engine also enforces the per-YA amendment lock
      # (filed Form B on record ⇒ analysis skipped, with an audit log entry).
      run_id, created = queue_insight_run(
        document.user_id, document.entity_id, "document_classified", db_session_factory,
        assessment_year=document.year_of_assessment,
      )
      if created:
        run_insight_engine(
          document.user_id, document.entity_id, "document_classified", db_session_factory,
          assessment_year=document.year_of_assessment, run_id=run_id,
        )
    elif document.user_id:
      # No year_of_assessment could be derived (undated/unparseable document).
      # The year summary filters on that exact column, so ANY year's engine
      # run would be blind to this document — a wall-clock-year run learns
      # nothing and risks auto-resolving unrelated current-year cards off an
      # unchanged snapshot. Skip, and leave a trace for debugging.
      logger.info(
        f"[Pipeline] Document ID {doc_id} classified without a year_of_assessment — "
        "insight engine run skipped (no year feed can see this document)."
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
