"""
CATEGORY_REGISTRY — single source of truth for the document taxonomy.

Drop-in replacement for pipeline.py's scattered taxonomy section (the old
Q1_BUSINESS_INCOME_CATEGORIES / Q1_REFERENCE_CATEGORIES / CATEGORY_STATUS_MAP /
_Q4_RELIEF_CATS / _Q4_NON_DED_CATS / _DONATION_CATS / REFERENCE_ONLY_CATEGORIES /
SCHEDULE_SOURCE_CATEGORIES / SUPPORTING_EVIDENCE_CATEGORIES block). Every one
of those becomes a one-line derived view over the single dict below.

Redesigned bucket structure (this session's full review):
  Q1              — genuine s.4(a) business trade income only
  Q2              — genuine personal income, s.4(b)-s.4(f)
  Q3              — genuine s.33(1)/Schedule 3 business expense
  Q4              — genuine personal relief, H2-H21 only (reduces B23 -> B24)
  DONATIONS       — Part G, reduces aggregate income at B17 (before B24)
  TAX_INSTALMENTS — feeds B33 (tax ALREADY PAID, reduces final balance)
  REBATES         — feeds B27 or B29 (reduces the TAX BILL, after B26/B28)
  REFERENCE       — never summed; sub-typed by `reference_type` (see below)
  NON_TAX         — zero financial content
  REVIEW          — genuinely ambiguous, needs a human

Two orthogonal fields replace the old overloaded `status`:
  tax_treatment      — what KIND of Form B effect this has
  computation_source — HOW its amount actually gets computed
    "direct"   — sum this document's own amount straight into a total
    "registry" — computed from multi-year history (capital allowance, H11,
                 CP500, food waste x2/CCTV, departure levy) — never summed
                 per-document, but always shown in a "feeds your X schedule"
                 bucket downstream, never silently excluded
    "ledger"   — bank statement; many lines, matched individually
    "none"     — reference-only or non-tax; nothing to compute

REFERENCE sub-typing (`reference_type`) — three genuinely different shapes
that were all flattened into one meaning before:
  "reconciliation_aid" — no dedicated form field of its own (P&L, BS, Filed
                         Form B) — exists only to help verify/reconstruct
                         other figures
  "feeds_other_part"   — DOES populate a specific real field, just not
                         B1-B34 (Voluntary Disclosure -> Part K;
                         Property Disposal -> D12a/D12b)
  "separate_tax_regime"— its own entirely separate tax/filing, genuinely no
                         Form B line at all (Capital Gains s.4aa; SST-02)
  "out_of_scope"       — real Form B line exists (Part F/L/B30 for FSI;
                         B2/B2a + HK-1B for Partnership Income) but
                         deliberately not built for v1 — see the module-level
                         SCOPE NOTE below
  "ledger"             — Bank Statement; many transactions, matched
                         line-by-line, never a single aggregate amount

REBATES sub-typing (`rebate_stage`) — B27 and B29 are different steps and
must be applied in the right order downstream (B27 before B29, per the form):
  "B27" — Zakat, Departure Levy
  "B29" — Section 110 Withholding (Others)

SCOPE NOTE (v1): Foreign-Source Income and Partnership Income are real,
named Form B lines (B10/Part F/Part L and B2/B2a/HK-1B respectively) that
this app deliberately does NOT compute for v1 — both route to REFERENCE
with reference_type="out_of_scope" so a document is captured and flagged
("consult a tax agent") rather than silently mis-summed or rejected as
Non-Tax. Both are explicit Phase 2 roadmap items, not permanent exclusions.
RPGT/CKHT property disposal is NOT in this same "out of scope" category —
it only ever needed a D12a/D12b disclosure flag, which IS built (see
"feeds_other_part" above) — the actual RPGT computation itself is a
genuinely separate filing (CKHT) that Form B never computes either, for
any user, so there's nothing being deferred there.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class CategoryDef:
  bucket: str                          # "Q1" | "Q2" | "Q3" | "Q4" | "DONATIONS"
                                        # | "TAX_INSTALMENTS" | "REBATES"
                                        # | "REFERENCE" | "NON_TAX" | "REVIEW"
  tax_treatment: str                   # "income" | "deductible" | "mixed" | "capital"
                                        # | "relief" | "non_deductible" | "donation"
                                        # | "tax_instalment" | "rebate" | "reference"
                                        # | "not_applicable" (NON_TAX/REVIEW only)
  computation_source: str              # "direct" | "registry" | "ledger" | "none"
  reference_type: Optional[str] = None # only set when bucket == "REFERENCE"
  rebate_stage: Optional[str] = None   # only set when bucket == "REBATES"
  apportioned: Optional[dict] = None   # only set for the 4 partially-deductible Q3 items


CATEGORY_REGISTRY: dict[str, CategoryDef] = {

  # ══════════════════════════════════════════════════════════════════════
  # Q1 — BUSINESS INCOME (ITA s.4(a)) — genuine trade income only.
  # e-Invoice merged in: an LHDN-validated e-Invoice IS the sale, not a
  # second income event — see the s82c_relevant note in build_extracted_data
  # for how the MyInvois UUID/QR + RM1,000,000 threshold metadata rides
  # along on this SAME category rather than a separate one.
  # ══════════════════════════════════════════════════════════════════════
  "Q1 — Sales & Service Revenue": CategoryDef(
    bucket="Q1", tax_treatment="income", computation_source="direct"),

  # ══════════════════════════════════════════════════════════════════════
  # Q2 — PERSONAL INCOME (ITA s.4(b)-s.4(f)).
  # Business Bank Interest moved IN from the old (wrong) Q1 placement —
  # bank interest is s.4(c) personal income regardless of which account it
  # lands in, unless the business's core activity IS deposit-taking/lending.
  # ══════════════════════════════════════════════════════════════════════
  "Q2 — Employment Income (s.4b)":     CategoryDef(bucket="Q2", tax_treatment="income", computation_source="direct"),
  "Q2 — Passive Rental Income (s.4d)": CategoryDef(bucket="Q2", tax_treatment="income", computation_source="direct"),
  "Q2 — Royalty Income (s.4d)":        CategoryDef(bucket="Q2", tax_treatment="income", computation_source="direct"),
  "Q2 — Dividend Income (s.4c)":       CategoryDef(bucket="Q2", tax_treatment="income", computation_source="direct"),
  "Q2 — Investment Interest (s.4c)":   CategoryDef(bucket="Q2", tax_treatment="income", computation_source="direct"),
  "Q2 — Business Bank Interest (s.4c)": CategoryDef(bucket="Q2", tax_treatment="income", computation_source="direct"),
  "Q2 — Pension & Annuity (s.4e)":     CategoryDef(bucket="Q2", tax_treatment="income", computation_source="direct"),
  "Q2 — Casual & Other Income (s.4f)": CategoryDef(bucket="Q2", tax_treatment="income", computation_source="direct"),

  # ══════════════════════════════════════════════════════════════════════
  # Q3 — BUSINESS EXPENSE (ITA s.33(1) / Schedule 3 / s.39(1)).
  # CP500 removed entirely — it was never a business expense (see
  # TAX_INSTALMENTS below); it's the proprietor's OWN personal tax
  # pre-payment, feeding B33, not Part N.
  # ══════════════════════════════════════════════════════════════════════
  "Q3 — Cost of Goods Sold":                CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — Payroll & Statutory Contributions": CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — Business Premises Rent":            CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — Business Utilities":                CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — Marketing & Advertising":           CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — Professional & Legal Fees":         CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — Transport & Logistics":             CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — Office & Admin Supplies":           CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — Business Insurance":                CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — Staff Welfare & Benefits":          CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — Business Loan Interest":            CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — Revenue Repairs & Maintenance":     CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),
  "Q3 — CP58 Agent Commission":             CategoryDef(bucket="Q3", tax_treatment="deductible", computation_source="direct"),

  # Partially deductible — carries `apportioned` metadata (mode/pct), same
  # 3 modes as before: 'statutory' (fixed by law), 'default' (user may
  # override), 'required' (no safe default, user must supply).
  "Q3 — Client Entertainment (50% cap)": CategoryDef(
    bucket="Q3", tax_treatment="mixed", computation_source="direct",
    apportioned={"mode": "statutory", "pct": 50}),
  "Q3 — Client & Corporate Gifts": CategoryDef(
    bucket="Q3", tax_treatment="mixed", computation_source="direct",
    apportioned={"mode": "default", "pct": 50}),
  "Q3 — Mixed-Use Vehicle Expenses": CategoryDef(
    bucket="Q3", tax_treatment="mixed", computation_source="direct",
    apportioned={"mode": "required", "pct": None}),
  "Q3 — Hire Purchase & Leased Assets": CategoryDef(
    # Bug fix (confirmed against LHDN's Form B Explanatory Notes, N15):
    # "Total expenditure on interest excluding interest on hire purchase /
    # lease" — HP interest is excluded from the ordinary Loan Interest line
    # (N15) and needs its own interest/principal split, but N15-N24 is
    # described as ONE single-basis-year "Expenses" range taken straight
    # from the Statement of Profit or Loss — there is no dedicated
    # multi-year working sheet for it anywhere (unlike genuine Schedule 3
    # capital allowance, which has HK-1's real year-over-year IA/AA
    # computation). Originally miscategorized as computation_source="registry"
    # by carrying forward the old codebase's SCHEDULE_SOURCE_CATEGORIES
    # grouping without re-verifying it against the actual form — it's
    # structurally identical to Client Entertainment/Gifts/Mixed-Use
    # Vehicle: confirm a %, sum that % of THIS document's amount, same
    # basis year, no schedule required.
    bucket="Q3", tax_treatment="mixed", computation_source="direct",
    apportioned={"mode": "required", "pct": None}),

  # Capital — Schedule 3 IA+AA, computed from the CapitalAsset registry
  # across years, never a direct per-document sum.
  "Q3 — Capital Assets & Equipment":    CategoryDef(bucket="Q3", tax_treatment="capital", computation_source="registry"),
  "Q3 — Capital Renovation & Fit-Out":  CategoryDef(bucket="Q3", tax_treatment="capital", computation_source="registry"),

  # ══════════════════════════════════════════════════════════════════════
  # Q4 — PERSONAL RELIEF — H2 through H21 ONLY (reduces B23 -> B24).
  # Zakat/Departure Levy/Section 110/Section 107D REMOVED — they're
  # REBATES/TAX_INSTALMENTS (a different computation stage), not this.
  # ══════════════════════════════════════════════════════════════════════
  "Q4 — Life Insurance & Takaful Relief": CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — EPF Personal Contribution":       CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Parent Medical Care":             CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Parent Medical Care (Complete Examination)": CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Serious Disease Treatment":       CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Fertility Treatment":             CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Vaccination":                     CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Dental Examination & Treatment":  CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Complete Medical Examination":    CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — COVID-19 Detection Test":         CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Mental Health Examination":       CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Learning Disability Diagnosis":   CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Learning Disability Early Intervention": CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Books & Publications":            CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Personal Computer & Devices":     CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Internet Subscription":           CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Personal Enrichment Course":      CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Education Relief (Non-Postgraduate)": CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Education Relief (Postgraduate)":     CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Upskilling / Self-Enhancement Course": CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Childcare Fees":                  CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — SSPN Net Deposit":                CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Medical Equipment Relief":        CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Private Retirement Scheme (PRS)": CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — SOCSO Personal Contribution":     CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Domestic Tourism Relief":         CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Tourist Attraction & Cultural Programme": CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — EV Charging Equipment":           CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Education & Medical Insurance":   CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Sports Equipment":                CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Sports Facility Fee":             CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Sports Competition Fee":          CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),
  "Q4 — Gym & Sports Training":           CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="direct"),

  # Registry-computed Q4 reliefs — claim-history-dependent, never a direct sum.
  "Q4 — Food Waste Compost Machine": CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="registry"),
  "Q4 — Food Waste Grinder Machine": CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="registry"),
  "Q4 — Home CCTV":                  CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="registry"),
  "Q4 — Breastfeeding Equipment":    CategoryDef(bucket="Q4", tax_treatment="relief", computation_source="registry"),

  # Non-deductible personal spend — still Q4 bucket (it's the "no relief
  # applies" sibling of the same real-world receipt types above), but a
  # distinct tax_treatment so it's never confused with an actual relief.
  "Q4 — Personal Living Expenses":       CategoryDef(bucket="Q4", tax_treatment="non_deductible", computation_source="direct"),
  "Q4 — Personal Travel & Leisure":      CategoryDef(bucket="Q4", tax_treatment="non_deductible", computation_source="direct"),
  "Q4 — Personal Dining & Entertainment": CategoryDef(bucket="Q4", tax_treatment="non_deductible", computation_source="direct"),
  "Q4 — Personal Shopping":              CategoryDef(bucket="Q4", tax_treatment="non_deductible", computation_source="direct"),
  "Q4 — Personal Medical Expenses":      CategoryDef(bucket="Q4", tax_treatment="non_deductible", computation_source="direct"),
  "Q4 — Family & Childcare Expenses":    CategoryDef(bucket="Q4", tax_treatment="non_deductible", computation_source="direct"),

  # ══════════════════════════════════════════════════════════════════════
  # DONATIONS — Part G, reduces AGGREGATE INCOME at B17 (before B24
  # chargeable income is even derived) — a genuinely earlier computation
  # stage than Q4 relief, regardless of which account paid the donation.
  # ══════════════════════════════════════════════════════════════════════
  "Q4 — Donation: Government/Local Authority": CategoryDef(bucket="DONATIONS", tax_treatment="donation", computation_source="direct"),
  "Q4 — Donation: Approved Institution":       CategoryDef(bucket="DONATIONS", tax_treatment="donation", computation_source="direct"),
  "Q4 — Donation: Approved Sports Activity":   CategoryDef(bucket="DONATIONS", tax_treatment="donation", computation_source="direct"),
  "Q4 — Donation: National Interest Project":  CategoryDef(bucket="DONATIONS", tax_treatment="donation", computation_source="direct"),
  "Q4 — Donation: Wakaf/Endowment":            CategoryDef(bucket="DONATIONS", tax_treatment="donation", computation_source="direct"),
  "Q4 — Donation: Artefacts to Government":    CategoryDef(bucket="DONATIONS", tax_treatment="donation", computation_source="direct"),
  "Q4 — Donation: Library Facilities":         CategoryDef(bucket="DONATIONS", tax_treatment="donation", computation_source="direct"),
  "Q4 — Donation: Disabled Facilities":        CategoryDef(bucket="DONATIONS", tax_treatment="donation", computation_source="direct"),
  "Q4 — Donation: Medical Equipment":          CategoryDef(bucket="DONATIONS", tax_treatment="donation", computation_source="direct"),
  "Q4 — Donation: Paintings to Art Gallery":   CategoryDef(bucket="DONATIONS", tax_treatment="donation", computation_source="direct"),

  # ══════════════════════════════════════════════════════════════════════
  # TAX_INSTALMENTS — feeds B33: money the proprietor ALREADY PAID toward
  # this year's tax bill (CP500 self-instalments, s.107D withholding on
  # agent/dealer/distributor payments) — reduces the final balance, not
  # chargeable income and not the tax bill itself. Personal, never a
  # business deduction, per your own confirmation this session.
  # ══════════════════════════════════════════════════════════════════════
  "Q3 — CP500 Instalment Notice": CategoryDef(bucket="TAX_INSTALMENTS", tax_treatment="tax_instalment", computation_source="registry"),
  "Q3 — CP500 Payment Receipt":   CategoryDef(bucket="TAX_INSTALMENTS", tax_treatment="tax_instalment", computation_source="registry"),
  "Q4 — Section 107D Withholding": CategoryDef(bucket="TAX_INSTALMENTS", tax_treatment="tax_instalment", computation_source="direct"),

  # ══════════════════════════════════════════════════════════════════════
  # REBATES — reduces the TAX BILL directly (ringgit-for-ringgit, capped at
  # tax otherwise payable), applied AFTER B26/B28, never touching chargeable
  # income. B27 and B29 are different steps in the form's own ordering —
  # rebate_stage preserves which one, since B27 must be applied before B29.
  # ══════════════════════════════════════════════════════════════════════
  "Q4 — Zakat": CategoryDef(bucket="REBATES", tax_treatment="rebate", computation_source="direct", rebate_stage="B27"),
  "Q4 — Departure Levy (Umrah/Religious Travel)": CategoryDef(
    bucket="REBATES", tax_treatment="rebate", computation_source="registry", rebate_stage="B27"),
  "Q4 — Section 110 Withholding (Others)": CategoryDef(
    bucket="REBATES", tax_treatment="rebate", computation_source="direct", rebate_stage="B29"),

  # ══════════════════════════════════════════════════════════════════════
  # REFERENCE — never summed into any total. Sub-typed by reference_type
  # (see module docstring) so a Balance Sheet, a Voluntary Disclosure, and a
  # descoped FSI document — three genuinely different shapes — are never
  # conflated the way "not_applicable"/"summary_statement" conflated them
  # before this redesign.
  # ══════════════════════════════════════════════════════════════════════
  "Q1 — Financial Statements (P&L)": CategoryDef(
    bucket="REFERENCE", tax_treatment="reference", computation_source="none", reference_type="reconciliation_aid"),
  "Q1 — Financial Statements (BS)": CategoryDef(
    bucket="REFERENCE", tax_treatment="reference", computation_source="none", reference_type="reconciliation_aid"),
  "Q1 — Filed Form B (Prior Year)": CategoryDef(
    bucket="REFERENCE", tax_treatment="reference", computation_source="none", reference_type="reconciliation_aid"),

  "Q1 — Voluntary Disclosure (Prior Year Income)": CategoryDef(
    bucket="REFERENCE", tax_treatment="reference", computation_source="none", reference_type="feeds_other_part"),
  "Property Disposal / CKHT Filing": CategoryDef(               # NEW category
    bucket="REFERENCE", tax_treatment="reference", computation_source="none", reference_type="feeds_other_part"),

  "Q1 — Capital Gains (s.4aa)": CategoryDef(
    bucket="REFERENCE", tax_treatment="reference", computation_source="none", reference_type="separate_tax_regime"),
  "Q1 — SST-02 Sales Tax Return": CategoryDef(
    bucket="REFERENCE", tax_treatment="reference", computation_source="none", reference_type="separate_tax_regime"),

  "Q2 — Foreign-Source Income (FSI)": CategoryDef(                 # descoped v1
    bucket="REFERENCE", tax_treatment="reference", computation_source="none", reference_type="out_of_scope"),
  "Partnership Income": CategoryDef(                               # NEW, descoped v1
    bucket="REFERENCE", tax_treatment="reference", computation_source="none", reference_type="out_of_scope"),
  "LLP Profit Distribution": CategoryDef(                          # NEW, descoped v1
    # Act 874 s.54C / Schedule 1 Part XXIII (YA2026+): a flat 2% tax on an
    # individual LLP partner's profit distributions exceeding RM100,000/year
    # — a genuinely separate computation from ordinary Partnership Income
    # (B2/HK-1B) above, since an LLP is its own distinct legal vehicle under
    # Malaysian law, not a plain partnership. Confirmed via Act 874 and PwC's
    # independent Malaysia Tax Booklet summary of the same provision.
    bucket="REFERENCE", tax_treatment="reference", computation_source="none", reference_type="out_of_scope"),

  "Bank Statement — Transaction Ledger": CategoryDef(
    bucket="REFERENCE", tax_treatment="reference", computation_source="ledger", reference_type="ledger"),

  # ══════════════════════════════════════════════════════════════════════
  # NON_TAX / REVIEW — unchanged from the original design; these were
  # already correctly separated from Q1-Q4 and don't need re-bucketing.
  # ══════════════════════════════════════════════════════════════════════
  "Non-Tax Document":        CategoryDef(bucket="NON_TAX", tax_treatment="not_applicable", computation_source="none"),
  "Mixed / Pending Review":  CategoryDef(bucket="REVIEW",   tax_treatment="mixed", computation_source="none"),
}


# ══════════════════════════════════════════════════════════════════════════
# Derived views — every one of these replaces an old hand-maintained list.
# Add or change a category ONLY in CATEGORY_REGISTRY above; everything below
# updates itself automatically.
# ══════════════════════════════════════════════════════════════════════════

REVIEW_CATEGORY          = "Mixed / Pending Review"
NON_TAX_CATEGORY         = "Non-Tax Document"
BANK_STATEMENT_CATEGORY  = "Bank Statement — Transaction Ledger"

ALL_Q1              = [c for c, d in CATEGORY_REGISTRY.items() if d.bucket == "Q1"]
ALL_Q2              = [c for c, d in CATEGORY_REGISTRY.items() if d.bucket == "Q2"]
ALL_Q3              = [c for c, d in CATEGORY_REGISTRY.items() if d.bucket == "Q3"]
ALL_Q4              = [c for c, d in CATEGORY_REGISTRY.items() if d.bucket == "Q4"]
ALL_DONATIONS       = [c for c, d in CATEGORY_REGISTRY.items() if d.bucket == "DONATIONS"]
ALL_TAX_INSTALMENTS = [c for c, d in CATEGORY_REGISTRY.items() if d.bucket == "TAX_INSTALMENTS"]
ALL_REBATES         = [c for c, d in CATEGORY_REGISTRY.items() if d.bucket == "REBATES"]
ALL_REFERENCE       = [c for c, d in CATEGORY_REGISTRY.items() if d.bucket == "REFERENCE"]

ALL_CATEGORIES = list(CATEGORY_REGISTRY.keys())

# tax_treatment lookup — the direct replacement for the old CATEGORY_STATUS_MAP.
# Note the vocabulary itself changed: "donation" | "tax_instalment" | "rebate" |
# "reference" are new values that didn't exist before (they were previously
# squeezed into "donation" [ok], "not_applicable" [wrong, for CP500], or
# "relief" [wrong, for Zakat/Section110/Departure Levy]).
CATEGORY_TAX_TREATMENT: dict[str, str] = {c: d.tax_treatment for c, d in CATEGORY_REGISTRY.items()}

VALID_TAX_TREATMENTS = {
  "income", "deductible", "mixed", "capital", "relief", "non_deductible",
  "donation", "tax_instalment", "rebate", "reference", "not_applicable",
}

# Bucket lookup — new; lets any downstream code ask "which of the 10 top-level
# buckets does this category belong to" without re-deriving it from tax_treatment.
CATEGORY_BUCKET: dict[str, str] = {c: d.bucket for c, d in CATEGORY_REGISTRY.items()}

# computation_source lookup — replaces the old derive_aggregation_state's
# category-membership checks. "registry" categories get their own visible
# "feeds your X schedule" bucket downstream (see the aggregation-loop
# iteration) instead of the old excluded_by_rule dead end.
CATEGORY_COMPUTATION_SOURCE: dict[str, str] = {c: d.computation_source for c, d in CATEGORY_REGISTRY.items()}

# Apportioned Q3 categories — same shape as the old APPORTIONED_CATEGORIES.
APPORTIONED_CATEGORIES: dict[str, dict] = {
  c: d.apportioned for c, d in CATEGORY_REGISTRY.items() if d.apportioned
}

# REFERENCE sub-typing — new; replaces the old flat REFERENCE_ONLY_CATEGORIES
# set with one that distinguishes WHY a document is reference-only.
REFERENCE_TYPE: dict[str, str] = {
  c: d.reference_type for c, d in CATEGORY_REGISTRY.items() if d.reference_type
}
REFERENCE_ONLY_CATEGORIES = set(REFERENCE_TYPE.keys())  # kept for any old call sites during migration

# REBATES sub-typing — new; B27 must be applied before B29 downstream.
REBATE_STAGE: dict[str, str] = {
  c: d.rebate_stage for c, d in CATEGORY_REGISTRY.items() if d.rebate_stage
}

# Categories whose amount is computed from multi-year history, never a
# direct per-document sum — replaces the old SCHEDULE_SOURCE_CATEGORIES.
SCHEDULE_SOURCE_CATEGORIES = {
  c for c, d in CATEGORY_REGISTRY.items() if d.computation_source == "registry"
}

# What schedule/registry a "registry_managed" document's real figure
# actually comes from — shown to the user so a document that's correctly
# EXCLUDED from a direct sum doesn't just look like it vanished. Shared
# between document_dispatch.py (the year-summary computation) and
# _serialize_doc (the individual-document listing) so there's one source,
# not two copies that could drift — the exact class of bug this whole
# registry redesign exists to prevent.
REGISTRY_SCHEDULE_LABELS: dict[str, str] = {
  "Q3 — Capital Assets & Equipment":    "Capital Allowance schedule",
  "Q3 — Capital Renovation & Fit-Out":  "Capital Allowance schedule",
  "Q3 — CP500 Instalment Notice":       "CP500 instalment reconciliation (B33)",
  "Q3 — CP500 Payment Receipt":         "CP500 instalment reconciliation (B33)",
  "Q4 — Breastfeeding Equipment":       "Breastfeeding Equipment relief (H11)",
  "Q4 — Food Waste Compost Machine":    "one-time relief tracker",
  "Q4 — Food Waste Grinder Machine":    "one-time relief tracker",
  "Q4 — Home CCTV":                     "one-time relief tracker",
  "Q4 — Departure Levy (Umrah/Religious Travel)": "Departure Levy lifetime-count tracker (B27iii)",
}


def registry_schedule_note(category: str) -> str:
  """Human-readable explanation for a registry_managed document — see
  REGISTRY_SCHEDULE_LABELS above."""
  label = REGISTRY_SCHEDULE_LABELS.get(category, "its own multi-year schedule")
  return (
    f"This document feeds your {label} — see that tab for its actual "
    "computed figure, not this document's raw amount."
  )