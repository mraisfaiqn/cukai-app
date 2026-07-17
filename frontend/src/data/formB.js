/**
 * formB.js — pure (non-React) logic for the Generate Forms tab.
 *
 * ============================================================================
 * REWRITE NOTE (this version)
 * ============================================================================
 * The previous version built the whole draft from `profile` (personal detail
 * toggles) and `entities` (manually-typed sole-prop financial fields) only —
 * completely disconnected from the document-classification pipeline. Reliefs
 * were valued at flat statutory maximums whenever a toggle was on, and it ran
 * its own independent tax-bracket table, which could silently drift out of
 * sync with the backend's.
 *
 * This version takes a THIRD argument, `taxSummary` — the raw response from
 * GET /api/profile/summary — and sources every financial figure from there.
 * `profile` is now used ONLY for identity/particulars fields that have no
 * document source (name, TIN, address, bank details, marital status, and a
 * handful of statutorily-flat reliefs). The backend's tax computation
 * (_estimate_tax, relief capping, zakat/rebate handling) is treated as the
 * single source of truth; this file does not recompute chargeable income or
 * tax payable — it only maps already-computed figures onto real Form B field
 * codes and gives a category-level breakdown for display.
 *
 * Field codes and layout below are taken directly from the LHDN Form B CP4A
 * (Pin. 2024) skeleton. Every dataGap entry documents a line this file cannot
 * currently populate and why — surfaced in the Generate Forms panel as a
 * "Data Coverage" list so gaps are visible to whoever's reviewing the draft,
 * not just buried in code comments.
 * ============================================================================
 */

// ── Filing year ───────────────────────────────────────────────────────────────
// Kept IDENTICAL to Overview.jsx's currentFilingYear() (30 June cutoff) so the
// dashboard and the generated form always agree on "today's" YA.
export function currentFilingYear(today = new Date()) {
  const year = today.getFullYear();
  const cutoff = new Date(year, 5, 30); // 30 June (month index 5)
  const deadlineYear = today > cutoff ? year + 1 : year;
  return deadlineYear - 1;
}

// ── Formatting helpers ────────────────────────────────────────────────────────
export const toNum = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
export const fmtRM = (v) => 'RM ' + Number(v || 0).toLocaleString('en-MY', { maximumFractionDigits: 0 });
// Amount "without sen" used by the government form cells (plain grouped integer).
export const fmtAmt = (v) => Number(Math.round(v || 0)).toLocaleString('en-MY');
export const dash = (v) => (v === '' || v === null || v === undefined ? '—' : v);
// Explicit "not yet available" marker for cells this file cannot populate at
// all, as distinct from a genuine RM0 — renders identically to `dash` today
// but kept as its own helper so a future pass can style/annotate it distinctly.
export const pending = () => '—';

// Every value shown on the form that has an LHDN reference code is rendered
// as "Label (code)" — e.g. "Male (1)", "Single (1)", "Divorcee / Widow /
// Widower (3)" — matching how the real form's option keys are printed
// alongside each field. withCode() centralises that "Label (code)" join so
// each field below only has to supply a label map and a code map.
const withCode = (label, code) => (code ? `${label} (${code})` : label);

const GENDER_LABEL = { male: 'Male', female: 'Female' };
const GENDER_CODE  = { male: '1', female: '2' };
export const genderLabel = (g) => GENDER_LABEL[g] || '—';
export const genderCode  = (g) => GENDER_CODE[g] || '';

// A4 "Status as at 31-12-YYYY" — the divorced/widowed states share one LHDN
// code (3), matching the real form's combined "Divorcee/widow/widower" option.
const MARITAL_LABEL = {
  single: 'Single',
  married: 'Married',
  'divorced-widowed': 'Divorcee / Widow / Widower',
  deceased: 'Deceased',
};
const MARITAL_CODE = { single: '1', married: '2', 'divorced-widowed': '3', deceased: '4' };
export const maritalLabel = (m) => MARITAL_LABEL[m] || '—';
export const maritalCode  = (m) => MARITAL_CODE[m] || '';

// A7 "Type of assessment" — codes 1-4 require an actual election and only
// apply when married; code 5 is automatic for every unmarried filer (single,
// divorced, widowed, or deceased) and isn't a real "election" at all, so it's
// never read from profile.assessmentType — buildFormData() substitutes it in
// directly whenever the person isn't married (see `effectiveAssessmentType`).
const ASSESSMENT_LABEL = {
  'joint-husband': 'Joint — in the name of husband',
  'joint-wife': 'Joint — in the name of wife',
  'separate': 'Separate',
  'self-spouse-no-income': 'Self whose spouse has no income, no source of income or has tax exempt income',
  'self-single': 'Self (Single / divorcee / widow / widower / deceased)',
};
const ASSESSMENT_CODE = {
  'joint-husband': '1', 'joint-wife': '2', 'separate': '3',
  'self-spouse-no-income': '4', 'self-single': '5',
};
export const assessmentLabel = (a) => ASSESSMENT_LABEL[a] || '—';
export const assessmentCode  = (a) => ASSESSMENT_CODE[a] || '';

// A3/A5 date fields are printed as dd/mm/yyyy on the real form, not the
// yyyy-mm-dd an <input type="date"> stores. Dash on anything unparseable
// rather than showing a mangled string.
export function fmtDateDMY(v) {
  if (!v) return '—';
  const parts = String(v).split('-');
  if (parts.length !== 3) return '—';
  const [y, m, d] = parts;
  if (!y || !m || !d) return '—';
  return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
}

// D6b e-Commerce business model.
const ECOMMERCE_MODEL_LABEL = {
  online_sales: 'Online sales / services',
  online_advertising: 'Online advertising',
  cloud_computing: 'Cloud computing',
  payment_services: 'Payment services',
  digital_currency: 'Digital currency / Digital token',
  e_hailing: 'E-Hailing / P-Hailing',
  others: 'Others',
};
const ECOMMERCE_MODEL_CODE = {
  online_sales: '1', online_advertising: '2', cloud_computing: '3', payment_services: '4',
  digital_currency: '5', e_hailing: '6', others: '7',
};

// D9 method of payment for tax refund.
const REFUND_METHOD_LABEL = { bank: 'Payment via bank account', duitnow: 'Payment via DuitNow' };
const REFUND_METHOD_CODE  = { bank: '1', duitnow: '2' };

// D11a DuitNow identification type (self).
const DUITNOW_ID_TYPE_LABEL = { ic: 'Identification card', passport: 'Passport' };
const DUITNOW_ID_TYPE_CODE  = { ic: '1', passport: '2' };

const joinAddress = (parts) => parts.filter(Boolean).join(', ');

// ══════════════════════════════════════════════════════════════════════════
// CATEGORY → FORM-LINE MAPPING
// Every pipeline category (see pipeline.py's Q1–Q4 taxonomy) is routed to the
// specific Form B field it feeds. Kept as flat lookup tables so a category
// rename in the backend taxonomy only needs a one-line update here.
// ══════════════════════════════════════════════════════════════════════════

// Q2 personal income → Part B statutory-income lines.
// B7 = employment, B8 = rents, B9 = interest/discounts/royalties/pensions/other.
// Foreign-source income (Q2 — Foreign-Source Income) belongs on Part F, which
// isn't modeled yet — excluded here, tracked as a dataGap.
const Q2_TO_B_LINE = {
  'Q2 — Employment Income (s.4b)':     'B7',
  'Q2 — Passive Rental Income (s.4d)': 'B8',
  'Q2 — Royalty Income (s.4d)':        'B9',
  'Q2 — Dividend Income (s.4c)':       'B9',
  'Q2 — Investment Interest (s.4c)':   'B9',
  'Q2 — Pension & Annuity (s.4e)':     'B9',
  'Q2 — Casual & Other Income (s.4f)': 'B9',
};

// Q1 business income → Part N statement-of-profit-or-loss lines.
// N3 = turnover; N11 = business-account interest.
// Bug fix (14 Jul 2026): capital gains (s.4(aa)) used to be routed to N13
// "Other income" here as a placeholder — but that was silently WRONG, not
// just an approximation: main.py was also summing it directly into B1 as
// ordinary business income, since it wasn't excluded from Q1 aggregation
// at all. Capital gains is now excluded from Q1 income entirely on the
// backend (see pipeline.py's REFERENCE_ONLY_CATEGORIES) and surfaced via
// cy.referenceDocuments instead — see the dataGap below, which reads from
// there now rather than from a (no-longer-existing) N13 entry.
// SST-02 filings carry no income of their own (liability pass-through) and
// are excluded entirely.
const Q1_TO_N_LINE = {
  'Q1 — Sales & Service Revenue':    'N3',
  'Q1 — e-Invoice / LHDN Validated': 'N3',
  'Q1 — Business Bank Interest':     'N11',
};

// Q3 business expense → Part N expenditure lines (N15–N24). Categories with
// status "capital" are excluded here entirely — they never reach this
// dictionary because the backend already keeps capital-tagged documents out
// of the deductions array (handled instead via the CapitalAsset schedule).
const Q3_TO_N_LINE = {
  'Q3 — Cost of Goods Sold':                'N5',  // purchases, not opex — routed separately, see buildFormData
  'Q3 — Business Loan Interest':            'N15',
  'Q3 — Payroll & Statutory Contributions': 'N16',
  'Q3 — Business Premises Rent':            'N17',
  'Q3 — CP58 Agent Commission':             'N19',
  'Q3 — Transport & Logistics':             'N21',
  'Q3 — Mixed-Use Vehicle Expenses':        'N21',
  'Q3 — Revenue Repairs & Maintenance':     'N22',
  'Q3 — Marketing & Advertising':           'N23',
  // Everything else deductible falls into N24 "Other expenses" — the real
  // form has no dedicated line for utilities, professional fees, admin
  // supplies, insurance, staff welfare, entertainment, or gifts.
  'Q3 — Business Utilities':                'N24',
  'Q3 — Professional & Legal Fees':         'N24',
  'Q3 — Office & Admin Supplies':           'N24',
  'Q3 — Business Insurance':                'N24',
  'Q3 — Staff Welfare & Benefits':          'N24',
  'Q3 — Client Entertainment (50% cap)':    'N24',
  'Q3 — Client & Corporate Gifts':          'N24',
  'Q3 — Hire Purchase & Leased Assets':     'N24', // interest portion only, once resolved (currently always needs_apportionment)
};

// Q4 personal relief → Part H line. Phase 2 split the categories that used
// to straddle multiple H-codes (parental vs self/spouse/child medical; SSPN
// vs childcare fees vs child relief) into their own pipeline categories, so
// each maps to exactly one H-line now — no more best-effort placement here.
// H16 (child relief) is intentionally absent: it's never document-derived
// (see buildProfileReliefItems) — it comes from the profile's child records,
// not from a receipt category.
const Q4_TO_H_LINE = {
  'Q4 — Life Insurance & Takaful Relief':       'H17i',
  'Q4 — EPF Personal Contribution':             'H17ii',
  // H5(i)/(ii)/(iii) split (14 Jul 2026): main.py's _cap_reliefs now emits
  // one breakdown row per individual category for this group too (same
  // fix as H6/H7/H8), so each maps to its real LHDN sub-line.
  'Q4 — Education Relief (Non-Postgraduate)':   'H5i',
  'Q4 — Education Relief (Postgraduate)':       'H5ii',
  'Q4 — Upskilling / Self-Enhancement Course':  'H5iii',
  // H9(i)/(ii)/(iii)/(iv) split (14 Jul 2026): main.py's _cap_reliefs now
  // emits one breakdown row per individual category for this group too.
  'Q4 — Books & Publications':                  'H9i',
  'Q4 — Personal Computer & Devices':            'H9ii',
  'Q4 — Internet Subscription':                  'H9iii',
  'Q4 — Personal Enrichment Course':             'H9iv',
  'Q4 — Medical Equipment Relief':              'H3',
  'Q4 — Private Retirement Scheme (PRS)':       'H18',
  'Q4 — SOCSO Personal Contribution':           'H20',
  'Q4 — EV Charging Equipment':                 'H21',
  // H2(i)/(ii) split (14 Jul 2026): main.py's _cap_reliefs now emits one
  // breakdown row per individual category for this group too.
  'Q4 — Parent Medical Care':                   'H2i',
  'Q4 — Parent Medical Care (Complete Examination)': 'H2ii',
  // H6/H7/H8 split (14 Jul 2026): main.py's _cap_reliefs now emits one
  // breakdown row PER individual category (not one merged "Q4 —
  // Self/Spouse/Child Medical" row as before), so each maps to its real
  // LHDN sub-line instead of collapsing into a single H6 total.
  'Q4 — Serious Disease Treatment':             'H6i',
  'Q4 — Fertility Treatment':                   'H6ii',
  'Q4 — Vaccination':                           'H6iii',
  'Q4 — Dental Examination & Treatment':        'H6iv',
  'Q4 — Complete Medical Examination':          'H7i',
  'Q4 — COVID-19 Detection Test':                'H7ii',
  'Q4 — Mental Health Examination':             'H7iii',
  'Q4 — Learning Disability Diagnosis':         'H8i',
  'Q4 — Learning Disability Early Intervention': 'H8ii',
  'Q4 — Childcare Fees':                        'H12',
  'Q4 — SSPN Net Deposit':                      'H13',
  'Q4 — Education & Medical Insurance':         'H19',
  // H10(i)/(ii)/(iii)/(iv) split (14 Jul 2026): same fix as H9 above.
  'Q4 — Sports Equipment':                      'H10i',
  'Q4 — Sports Facility Fee':                    'H10ii',
  'Q4 — Sports Competition Fee':                  'H10iii',
  'Q4 — Gym & Sports Training':                   'H10iv',
  'Q4 — Breastfeeding Equipment':               'H11',
  // Q4 — Zakat is intentionally absent: the backend already routes it to the
  // B27 rebate calculation (zakatRebate), never into the relief pool.
  // Q4 — Approved Donations is intentionally absent too: the backend routes
  // it to totals.approvedDonationsMyr (Part G / B17), a pre-relief income
  // deduction, never into q4ReliefsBreakdown / the H-code relief pool.
  // Q4 — Domestic Tourism Relief has no corresponding line on the current
  // (2024) form — the relief lapsed. Excluded; flagged as a dataGap.
};

const H_LINE_LABELS = {
  H2:    'H2  Expenses for parents',
  H2i:   'H2(i) Medical/dental treatment, special needs or carer (parents)',
  H2ii:  'H2(ii) Complete medical examination (parents)',
  H3:    'H3  Basic supporting equipment (disabled self/spouse/child/parent)',
  H5:    'H5  Education fees (self)',
  H5i:   'H5(i) Non-postgraduate course fees (self)',
  H5ii:  'H5(ii) Postgraduate (Master\'s/Doctorate) course fees (self)',
  H5iii: 'H5(iii) Upskilling / self-enhancement course (self)',
  H6i:   'H6(i) Serious disease treatment (self, spouse or child)',
  H6ii:  'H6(ii) Fertility treatment (self or spouse)',
  H6iii: 'H6(iii) Vaccination (self, spouse or child)',
  H6iv:  'H6(iv) Dental examination and treatment (self, spouse or child)',
  H7i:   'H7(i) Complete medical examination (self, spouse or child)',
  H7ii:  'H7(ii) COVID-19 detection test (self, spouse or child)',
  H7iii: 'H7(iii) Mental health examination or consultation (self, spouse or child)',
  H8i:   'H8(i) Learning disability diagnosis assessment (child ≤18)',
  H8ii:  'H8(ii) Learning disability early intervention/rehabilitation (child ≤18)',
  H9:    'H9  Lifestyle relief',
  H9i:   'H9(i) Books, journals, magazines, newspapers (self, spouse or child)',
  H9ii:  'H9(ii) Personal computer, smartphone or tablet (self, spouse or child)',
  H9iii: 'H9(iii) Internet subscription (self, spouse or child)',
  H9iv:  'H9(iv) Personal enrichment / hobby course (self, spouse or child)',
  H10:   'H10 Sports & fitness relief',
  H10i:   'H10(i) Sports equipment (self, spouse or child)',
  H10ii:  'H10(ii) Sports facility rental / entrance fee (self, spouse or child)',
  H10iii: 'H10(iii) Sports competition registration fee (self, spouse or child)',
  H10iv:  'H10(iv) Gym membership / sports training fee (self, spouse or child)',
  H11:   'H11 Breastfeeding equipment (once every 2 YAs)',
  H12:   'H12 Childcare fees (child aged 6 and below)',
  H13:   'H13 SSPN net deposit',
  H16:   'H16 Child relief',
  H17i:  'H17(i)  Life insurance / EPF (voluntary)',
  H17ii: 'H17(ii) EPF (voluntary or compulsory)',
  H18:   'H18 Private retirement scheme',
  H19:   'H19 Education & medical insurance',
  H20:   'H20 SOCSO contribution',
  H21:   'H21 EV charging equipment',
};

// ── Sum a taxSummary income/deduction array by mapped form line ──────────────
function sumByLine(entries, categoryMap, amountKey) {
  const byLine = {};
  const unmapped = [];
  for (const e of entries || []) {
    const line = categoryMap[e.category];
    const amt = Number(e[amountKey] ?? e.amountNumeric ?? 0);
    if (!line) {
      unmapped.push(e.category);
      continue;
    }
    byLine[line] = (byLine[line] || 0) + amt;
  }
  return { byLine, unmapped: [...new Set(unmapped)] };
}

// ── Statutory reliefs that are flat entitlements, not document-derived ──────
// H1 (auto, RM9,000) comes from taxSummary.totals.individualSelfRelief, not
// from here — it's applied automatically by the backend regardless of any
// profile toggle. This function covers the remaining profile-driven flat/
// derived amounts: H4 (disabled self), H14 (spouse/alimony), H15 (disabled
// spouse), and H16a/b/c (child relief).
//
// H16 (Phase 3, 14 Jul 2026): now computed from REAL per-child records
// (age/study/disability/eligibility — see models.py's Child and
// child_relief.py) whenever `bpr.childReliefSource === 'records'`. Falls
// back to the old flat RM2,000-per-child estimate (all routed to H16a) only
// for profiles that haven't migrated to real child records yet — flagged
// as its own dataGap by the caller, not silently assumed correct.
//
// `hasDocumentChildRelief`: as of the Phase 2 category split, NO pipeline
// category maps to H16 (see pipeline.py's docstring) — this guard exists so
// that if a future category IS ever mapped to H16, the double-counting
// guard automatically re-activates without another code change; today it
// always evaluates to false.
//
// `backendProfileReliefs` (bug fix, 14 Jul 2026): these amounts are sourced
// from main.py's totals.profileReliefs — the SAME figures actually
// subtracted from chargeable income server-side — rather than recomputed
// independently here, so B23 (Total Relief, built from this function) can
// never drift from what B24/B31 (backend-computed) actually reflect. Local
// recompute is kept ONLY as the pre-load fallback (taxSummary hasn't
// resolved yet), matching the pattern fallbackSkeletonTax() uses elsewhere.
function buildProfileReliefItems(profile, hasDocumentChildRelief, backendProfileReliefs) {
  const p = profile || {};
  const childCount = parseInt(p.numberOfChildren || '0', 10) || 0;
  const married = p.maritalStatus === 'married';
  // Bug fix round 1 (14 Jul 2026): H14's spouse-relief component applies
  // when EITHER jointly assessed in the filer's name OR the spouse has no
  // income — 'self-spouse-no-income' (Form B code 4) qualifies too.
  // Bug fix round 2 (14 Jul 2026, Phase 4 review): for the two JOINT codes
  // specifically, LHDN grants each relief component to a SPECIFIC spouse
  // (the one RECEIVING the transfer), not either one interchangeably — same
  // gender-direction check B21/B22 needs, not just an assessmentType match.
  // 'self-spouse-no-income' stays gender-neutral (framed generically as
  // "self" in LHDN's own wording, no "in the name of" direction).
  // Bug fix round 3 (14 Jul 2026, Phase 4 review): gated on `married` too —
  // the ManageProfile UI only shows the joint-assessment dropdown while
  // married, but changing marital status away from "married" doesn't clear
  // an already-selected assessmentType, it just stops rendering the field.
  // Without this gate, a divorced person with a stale 'joint-husband'/
  // 'joint-wife' value could still trigger this relief.
  const isJointElection = married && (p.assessmentType === 'joint-husband' || p.assessmentType === 'joint-wife');
  const isAggregatingThisReturn = isJointElection && (
    (p.assessmentType === 'joint-husband' && p.gender === 'male') ||
    (p.assessmentType === 'joint-wife' && p.gender === 'female')
  );
  const spouseReliefEligible = isJointElection ? isAggregatingThisReturn : p.assessmentType === 'self-spouse-no-income';
  const isDivorced = p.maritalStatus === 'divorced-widowed';
  const bpr = backendProfileReliefs;

  // A filed-Form-B year's chargeable income is LHDN's own ground truth and
  // deliberately does NOT have these flat estimates subtracted (see
  // get_tax_profile_summary's `appliedToChargeableIncome` flag) — showing
  // them here would reopen the same B23-vs-B24 mismatch this fix is for,
  // just for filed years instead of document-derived ones. Omit entirely
  // rather than estimate against a figure they were never part of.
  if (bpr && bpr.appliedToChargeableIncome === false) return [];

  const h4Amount  = bpr ? toNum(bpr.h4DisabledIndividualMyr) : (p.isDisabledSelf ? 6000 : 0);
  const h14Amount = bpr ? toNum(bpr.h14SpouseOrAlimonyMyr) : (
    married && spouseReliefEligible ? 4000 :
    isDivorced && p.alimonyPaidMyr ? Math.min(toNum(p.alimonyPaidMyr), 4000) : 0
  );
  const h15Amount = bpr ? toNum(bpr.h15DisabledSpouseMyr) : (married && p.spouseIsDisabled ? 5000 : 0);

  const items = [];
  if (p.isDisabledSelf && h4Amount > 0) items.push(['H4', 'Disabled individual', h4Amount, 'profile_toggle']);
  if ((married || isDivorced) && h14Amount > 0) items.push(['H14', 'Husband / wife / alimony to former wife', h14Amount, 'profile_toggle']);
  if (married && p.spouseIsDisabled && h15Amount > 0) items.push(['H15', 'Disabled husband / wife', h15Amount, 'profile_toggle']);

  // ── H16: real per-child records when available ──────────────────────
  if (!hasDocumentChildRelief) {
    if (bpr && bpr.childReliefSource === 'records') {
      const h16aAmount = toNum(bpr.h16aMyr);
      const h16bAmount = toNum(bpr.h16bMyr);
      const h16cAmount = toNum(bpr.h16cMyr);
      const detail = bpr.childReliefDetail || [];
      const namesFor = (line) => detail.filter((c) => c.hLine === line).map((c) => c.name).join(', ');
      if (h16aAmount > 0) items.push(['H16a', `Child — under 18${namesFor('H16a') ? ` (${namesFor('H16a')})` : ''}`, h16aAmount, 'child_record']);
      if (h16bAmount > 0) items.push(['H16b', `Child — 18+ and studying${namesFor('H16b') ? ` (${namesFor('H16b')})` : ''}`, h16bAmount, 'child_record']);
      if (h16cAmount > 0) items.push(['H16c', `Child — disabled${namesFor('H16c') ? ` (${namesFor('H16c')})` : ''}`, h16cAmount, 'child_record']);
    } else if (childCount > 0) {
      const h16aAmount = bpr ? toNum(bpr.h16aMyr) : (childCount * 2000);
      if (h16aAmount > 0) {
        items.push([
          'H16a',
          `Child relief — ${childCount} × RM 2,000 (base rate; add real child records for accurate age/study/disability tiering)`,
          h16aAmount,
          'profile_estimate',
        ]);
      }
    }
  }
  return items;
}

// Progressive resident tax bands — kept ONLY as an emergency fallback for
// display purposes if taxSummary hasn't loaded yet (e.g. panel opened before
// the fetch resolves). NEVER used once taxSummary is available: the real
// computation lives entirely in main.py's _estimate_tax(). This table is not
// guaranteed to match the backend's TAX_BRACKETS_BY_YA and must not be relied
// on for any figure that ends up in the printed form.
// Bug fix (14 Jul 2026): this table previously diverged from the real 2024
// schedule above RM250,000 (had a flat 26% top band instead of the real
// 26%/28%/30% tiers) — fixed to match main.py's _TAX_BRACKETS_YA2023_2025
// exactly, so the brief pre-load estimate never disagrees with the
// backend-authoritative figure once it arrives.
const TAX_BANDS_YA2023_2025 = [
  [5000, 0], [15000, 0.01], [15000, 0.03], [15000, 0.06],
  [20000, 0.11], [30000, 0.19], [300000, 0.25], [200000, 0.26],
  [1400000, 0.28], [Infinity, 0.30],
];
function fallbackSkeletonTax(ci) {
  let tax = 0, rem = ci;
  for (const [band, rate] of TAX_BANDS_YA2023_2025) {
    if (rem <= 0) break;
    const taxable = Math.min(rem, band);
    tax += taxable * rate;
    rem -= taxable;
  }
  return Math.round(tax);
}

// Pre-load fallback for B25a/B25b — mirrors main.py's _bracket_breakdown()
// exactly (same table, same band-by-band walk) so the two never disagree
// even before the real tax summary has loaded.
function fallbackBracketBreakdown(ci) {
  let cumulativeTax = 0, lowerBound = 0, remaining = ci;
  for (const [band, rate] of TAX_BANDS_YA2023_2025) {
    const taxableInBand = Math.min(remaining, band);
    if (taxableInBand <= 0) break;
    const isCurrentBand = remaining <= band;
    if (isCurrentBand) {
      const b25bTax = Math.round(taxableInBand * rate * 100) / 100;
      return {
        b25aLowerBoundMyr: lowerBound, b25aTaxMyr: Math.round(cumulativeTax * 100) / 100,
        b25bAmountMyr: taxableInBand, b25bRatePct: Math.round(rate * 100 * 100) / 100, b25bTaxMyr: b25bTax,
      };
    }
    cumulativeTax += taxableInBand * rate;
    lowerBound += taxableInBand;
    remaining -= taxableInBand;
  }
  return { b25aLowerBoundMyr: 0, b25aTaxMyr: 0, b25bAmountMyr: 0, b25bRatePct: 0, b25bTaxMyr: 0 };
}

// ══════════════════════════════════════════════════════════════════════════
// buildFormData — the main export
// ══════════════════════════════════════════════════════════════════════════
export function buildFormData(profile, entities, taxSummary) {
  const p = profile || {};
  const owned = entities || [];
  const dataGaps = [];

  const mainEntity = owned.length
    ? owned.reduce((best, e) => (toNum(e.salesTurnover) > toNum(best.salesTurnover) ? e : best), owned[0])
    : null;

  const married = p.maritalStatus === 'married';
  // A7 code 5 applies to every unmarried filer (single, divorced, widowed, or
  // deceased) — it's not a real election, so it's substituted directly rather
  // than depending on whatever profile.assessmentType happens to still hold
  // from a time when the person was married.
  const effectiveAssessmentType = married ? p.assessmentType : 'self-single';

  // ── No tax summary yet (still loading, or genuinely no documents) ────────
  const hasSummary = !!(taxSummary && taxSummary.currentYear);
  const cy = hasSummary ? taxSummary.currentYear : null;
  const totals = cy?.totals || {};

  if (!hasSummary) {
    dataGaps.push({
      part: 'B / H / N', severity: 'blocking',
      category: 'General',
      note: 'No tax profile summary loaded yet — every financial figure below is a placeholder until GET /api/profile/summary returns data for this year and entity.',
    });
  }

  // ── Part B: income lines from Q2 documents ────────────────────────────────
  const { byLine: bLines, unmapped: q2Unmapped } = sumByLine(cy?.q2PersonalIncome, Q2_TO_B_LINE, 'amountNumeric');
  if (q2Unmapped.length) {
    dataGaps.push({
      part: 'B', severity: 'info',
      category: 'B',
      note: `Q2 categories with no Part B mapping (excluded from B7–B10): ${q2Unmapped.join(', ')}. Foreign-source income belongs on Part F, which isn't modeled yet.`,
    });
  }
  const b7 = bLines.B7 || 0;
  const b8 = bLines.B8 || 0;
  const b9 = bLines.B9 || 0;

  // B33 MTD: sum of PCB withheld by employer(s), from Form EA extraction.
  const mtdWithheld = (cy?.q2PersonalIncome || [])
    .filter((e) => e.category === 'Q2 — Employment Income (s.4b)')
    .reduce((s, e) => s + toNum(e.formEa?.pcb_deducted), 0);

  // B1 statutory business income — backend-authoritative (Phase 3, 14 Jul
  // 2026: main.py now runs a full multi-year carry-forward engine per
  // entity — see carryforward.py — so this already correctly reflects Q1
  // income net of Q3 deductions, ONLY the capital allowance actually
  // absorbed this year (not the full statutory amount if income was
  // insufficient), and brought-forward losses absorbed against it. Never
  // re-derive this locally — the old `Math.max(0, q1 - q3TotalDeductions)`
  // formula silently let unabsorbed capital allowance offset OTHER income
  // and never tracked a current-year loss or M2 balance; both are real bugs
  // this endpoint now fixes server-side.
  const b1 = totals.businessIncomeB1Myr ?? 0;
  const b4 = b1;          // B2/B3 (partnerships, foreign business) not modeled — 0
  // B5: business losses brought forward, absorbed against B4 this year.
  const businessLossCf = totals.businessLossCarryforward || { broughtForwardMyr: 0, absorbedMyr: 0, carriedForwardMyr: 0 };
  const b5 = businessLossCf.absorbedMyr ?? 0;
  const b6 = Math.max(0, b4 - b5);
  const b11 = b6 + b7 + b8 + b9;   // B10 (foreign other income) not modeled — 0
  const b13 = b11;         // B12 (angel investor) not modeled — 0
  // B14: this year's OWN business loss, capped at what's left of B13 —
  // matches main.py's current_year_loss_applied exactly (both apply the
  // same "restricted to B13" cap independently; shown here for the printed
  // form's own B14 line, not re-used to derive B15 differently from what
  // the backend already computed for est_chargeable).
  const b14 = totals.currentYearBusinessLossAppliedMyr ?? 0;
  const b15 = Math.max(0, b13 - b14);
  // Approved donations (Part G / B17) — backend-authoritative, tiered caps
  // per G-line (Phase 5, 14 Jul 2026): G1/G2a-d share a combined 10%-of-B11
  // pool; G4/G6 each have their own individual RM20,000 cap; G3/G5/G7 are
  // uncapped. See main.py's tiered-cap block for the full reasoning. Falls
  // back to 0 only while no tax summary has loaded yet.
  const donationsByLine = totals.donationsByLine || {};
  const glineCapped = (g) => donationsByLine[g]?.cappedMyr ?? 0;
  const g1  = glineCapped('g1');
  const g2a = glineCapped('g2a');
  const g2b = glineCapped('g2b');
  const g2c = glineCapped('g2c');
  const g2d = glineCapped('g2d');
  const g2  = donationsByLine.g2Subtotal ?? 0;
  const g3  = glineCapped('g3');
  const g4  = glineCapped('g4');
  const g5  = glineCapped('g5');
  const g6  = glineCapped('g6');
  const g7  = glineCapped('g7');
  const donationsG8 = donationsByLine.g8 ?? totals.approvedDonationsMyr ?? 0;
  const b18 = Math.max(0, b15 - donationsG8); // B16 (Schedule 4) not modeled — 0
  const b20 = b18;         // B19 (pioneer income) not modeled — 0
  // B21: spouse's income transferred for joint assessment — backend-
  // authoritative (Phase 4, 14 Jul 2026). Only non-zero when THIS return is
  // the one in whose name the joint assessment is raised (gender-aware —
  // see totals.jointAssessment / main.py's B21/B22 block); otherwise
  // correctly stays 0, matching LHDN's own instruction that B21/B22 need
  // not be filled on the non-aggregating spouse's return.
  const jointAssessment = totals.jointAssessment || {};
  const b21 = jointAssessment.spouseIncomeTransferredMyr ?? 0;
  const b22 = b20 + b21;

  if (jointAssessment.note) {
    dataGaps.push({
      part: 'B21/B22 (joint assessment)',
      category: 'B',
      severity: jointAssessment.needsReview ? 'warning' : 'info',
      note: jointAssessment.note,
      affectedCodes: ['B21'],
    });
  }

  dataGaps.push({
    part: 'G3, G5, G7 (donation valuations)', severity: 'info',
    category: 'G',
    note: 'G1–G8 are now individually itemised with the correct per-line caps (Phase 5, 14 Jul 2026): G1/G2a–d share a combined 10%-of-B11 pool, G4 and G6 each have their own RM20,000 cap, and G3/G5/G7 are uncapped. One honest limitation remains: G3 (artefacts), G5 (disabled-facilities contributions in kind), and G7 (paintings) each require an official valuation from a named authority (Dept. of Museums/National Archives, the relevant local authority, or the National/state Art Gallery respectively) — a receipt alone can\'t confirm that valuation was actually obtained, so amounts in these three categories should be manually verified before filing.',
  });
  dataGaps.push({
    part: 'B3, B10, Part E, Part F', severity: 'out-of-scope',
    category: 'B',
    note: 'Business/partnership income and other income sourced outside Malaysia are out of scope for this feature (domestic sole-prop filing only) — not a gap to fill, left permanently at 0 / blank.',
  });
  dataGaps.push({
    part: 'B2, B2a, Part M3', severity: 'out-of-scope',
    category: 'B',
    note: 'Partnership statutory income and partnership capital-allowance carry-forward are out of scope for this feature (sole proprietors only) — not a gap to fill, left permanently at 0 / blank.',
  });
  const b7aSuggestion = cy?.b7aSuggestion || null;
  if (b7aSuggestion && b7aSuggestion.count > 0) {
    const multiEntryEmployerExists = b7aSuggestion.totalFormEaCount !== b7aSuggestion.distinctEmployerCount;
    // Bug fix (14 Jul 2026): this used to be an unconditional 'warning'
    // with affectedCodes: ['B7a'] — but B7a doesn't actually need active
    // review the way D3 does. Most filers on this platform are sole
    // proprietors who simply have NO employment outside their own
    // business — zero (or a small, confident count) is a normal, complete
    // answer here, not a gap. Downgraded to 'info' with no affectedCodes,
    // so it still explains the period-counting logic in Data Coverage but
    // no longer drives the review badge.
    dataGaps.push({
      part: 'B7a (number of employments)', severity: 'info',
      category: 'B',
      note: `Suggested as ${b7aSuggestion.count} — this counts employment PERIODS (matching LHDN's own worked examples), not just distinct employers: when the same employer appears on more than one Form EA this year, a >30-day gap between one stint's end and the next's start counts them as separate periods (e.g. leaving and later rejoining the same employer), while overlapping or back-to-back dates are merged into one continuous period (e.g. a reissued/duplicate EA). ${
        b7aSuggestion.hasUndatedMultiEntryEmployer
          ? "At least one employer had more than one Form EA this year without full start/end dates on all of them, so contiguity couldn't be determined — that employer was conservatively counted as ONE period. Verify manually if you know otherwise."
          : (multiEntryEmployerExists
            ? `You have ${b7aSuggestion.totalFormEaCount} Form EA document(s) across ${b7aSuggestion.distinctEmployerCount} distinct employer(s) — the period-gap logic above already accounts for this, but it's still worth a final check.`
            : 'One Form EA per employer this year — the straightforward case.')
      } One thing this still can't detect at all: two DIFFERENT legal entities in the same corporate group where one continued paying salary throughout a secondment to the other (LHDN counts that as ONE employment) — this only shows up as an issue if the seconding entity ALSO issued its own separate Form EA, which is rare.`,
    });
  }
  // Bug fix (14 Jul 2026): B32 is now wired to its real computed value
  // (max(0, (B29+B30) − B28)) instead of a permanent dash — see its
  // definition above. No dataGap needed anymore.

  dataGaps.push({
    part: 'B12, B16, B19, J1, J2', severity: 'out-of-scope',
    category: 'B',
    note: 'Angel-investor incentive (B12), Schedule 4 prospecting expenditure (B16), pioneer income (B19), paragraph 127(3)(b) special/further/double-deduction claims (J1), and ministerial 127(3A) claims (J2) are all out of scope for this feature — not a gap to fill, left permanently at 0 / blank. J1 previously supported claim codes 157 (secretarial & tax filing fee) and 148 (franchise fee) with their own Part J registry; this was removed by product decision (14 Jul 2026) — Part J is now out of scope on the same footing as B12/B16/B19/J2. Documents that used to be classified under those codes (e.g. company-secretary/tax-agent invoices) still count as ordinary deductible Q3 business expenses, they just no longer get itemised Part J disclosure.',
  });
  // Bug fix (16 Jul 2026): Part K is now modeled — see kDisclosures above,
  // fed by "Q1 — Voluntary Disclosure (Prior Year Income)" documents.
  // Only worth a note when there's nothing on file yet (the ordinary case
  // for most filers, not an anomaly) — no longer an "unmodeled" gap.
  if (!(cy?.kDisclosures || []).length) {
    dataGaps.push({
      part: 'K', severity: 'info',
      category: 'K',
      note: 'No prior-year non-employment income has been voluntarily disclosed. If you have undeclared income from an earlier year of assessment, upload the relevant document to populate Part K.',
    });
  }
  // Phase 7 (14 Jul 2026): D3 auto-population shipped — see employerTin's
  // construction above. Only push a dataGap when there's something to
  // actually flag: multiple employers seen this year (D3 can only hold
  // one), or no TIN available from either source at all.
  // Bug fix (14 Jul 2026, caught before building on top of it): this is a
  // top-level sibling of `totals` in main.py's response (same convention as
  // q3CapitalAssets/financialStatements/breastfeedingRelief below), NOT
  // nested inside totals — reading it off `totals` silently always
  // returned undefined.
  const h11Relief = cy?.breastfeedingRelief || null;
  if (h11Relief?.needsReview) {
    dataGaps.push({
      part: 'H11 (breastfeeding equipment)', severity: 'warning',
      category: 'H',
      affectedCodes: ['H11'],
      note: h11Relief.note || 'This year\'s H11 claim needs manual review before filing.',
    });
  }

  const d3Suggestion = cy?.d3EmployerTinSuggestion || {};
  // Bug fix (14 Jul 2026, badge system follow-up): this used to fire
  // whenever multiple employers were found, REGARDLESS of whether the
  // person had already confirmed a TIN — so accepting the "Use this"
  // suggestion (or typing one manually) and saving never cleared the
  // review dot. Once p.employerTin actually has a saved value, the person
  // HAS made their choice; the ambiguity is resolved, not still open.
  if (d3Suggestion.hasMultipleEmployers && !p.employerTin) {
    dataGaps.push({
      part: 'D3 (employer\'s TIN)', severity: 'warning',
      category: 'D',
      affectedCodes: ['D3'],
      note: 'More than one employer\'s E-number was found across this year\'s Form EA uploads — D3 only has room for one, so the one with the LATEST employment end date was used (per LHDN\'s own D3 instruction) as a suggestion. Confirm this is the right employer by saving it (or a different one) in Other Particulars.',
    });
  } else if (!p.employerTin && !d3Suggestion.value) {
    // Informational only, and genuinely low-priority — a sole prop with no
    // employment outside their own business legitimately has nothing to
    // enter here at all. Only relevant if you actually do have outside
    // employment income this year.
    dataGaps.push({
      part: 'D3 (employer\'s TIN)', severity: 'gap',
      category: 'D',
      note: 'No employer TIN on file — expected if you have no employment income outside your own business this year. If you do, enter it manually in Other Particulars, or upload a Form EA to auto-populate it.',
    });
  }

  // ── Part H: reliefs ────────────────────────────────────────────────────────
  const individualSelfRelief = totals.individualSelfRelief ?? 0; // H1, automatic
  const q4Breakdown = cy?.totals?.q4ReliefsBreakdown || [];
  const documentReliefItems = [];
  const q4Unmapped = [];
  for (const b of q4Breakdown) {
    const hLine = Q4_TO_H_LINE[b.category];
    if (!hLine) { q4Unmapped.push(b); continue; }
    documentReliefItems.push([hLine, H_LINE_LABELS[hLine] || hLine, Number(b.cappedTotal) || 0, 'document']);
  }
  if (q4Unmapped.length) {
    dataGaps.push({
      part: 'H', severity: 'info',
      category: 'H',
      note: `Q4 relief categories excluded from Part H (no line mapping): ${q4Unmapped.map((b) => b.category).join(', ')}. "Domestic Tourism Relief" has lapsed on the current form; Zakat is correctly routed to the B27 rebate instead of here.`,
    });
  }
  // Bug fix (14 Jul 2026, post-Phase-5 audit): this relief lapsed after
  // YA2022, but nothing previously gated it by year — the backend now
  // forces its capped total to 0 for later years (see main.py's
  // DOMESTIC_TOURISM_LAST_ELIGIBLE_YA), but that zeroing was otherwise
  // invisible: this category is deliberately excluded from Part H display
  // (no h-line mapping above), so a user whose receipt got silently reduced
  // to RM0 had no way to see why. Surface it explicitly and unconditionally
  // whenever a document actually landed in this category with a raw amount,
  // rather than relying on the generic "unmapped category" note above
  // (which wouldn't fire at all if this were the only unmapped category and
  // its own text didn't call out the RM0 outcome specifically).
  const lapsedTourism = q4Unmapped.find((b) => b.category === 'Q4 — Domestic Tourism Relief' && Number(b.rawTotal) > 0);
  if (lapsedTourism) {
    dataGaps.push({
      part: 'H (Domestic Tourism Relief)', severity: 'info',
      category: 'H',
      note: `RM ${Number(lapsedTourism.rawTotal).toLocaleString('en-MY', { minimumFractionDigits: 2 })} of documents were classified as Domestic Tourism Relief, but this relief lapsed after YA2022 and does not apply to this filing year — RM0 was applied, not the RM1,000 this category used to allow. These documents don't reduce your tax; consider reclassifying them (e.g. to Personal Travel & Leisure) if they aren't otherwise deductible.`,
    });
  }
  // Bug fix (15 Jul 2026): H18 (PRS/deferred annuity) is explicitly time-
  // boxed by LHDN's own notes ("effective from YA2012 until 2025"), but —
  // unlike Domestic Tourism above — H18 still has a real Part H line
  // mapping, so this can't reuse the "unmapped category" path. The backend
  // now forces this category's capped total to 0 for YA2026+ (see main.py's
  // H18_PRS_LAST_ELIGIBLE_YA and the lapsedForYear flag on its breakdown
  // entry) — surface that explicitly, the same way the Domestic Tourism
  // case is surfaced, so a real PRS contributor whose relief silently
  // dropped to RM0 isn't left wondering why.
  const lapsedPrs = q4Breakdown.find((b) => b.category === 'Q4 — Private Retirement Scheme (PRS)' && b.lapsedForYear && Number(b.rawTotal) > 0);
  if (lapsedPrs) {
    dataGaps.push({
      part: 'H18 (PRS / Deferred Annuity)', severity: 'info',
      category: 'H',
      note: `RM ${Number(lapsedPrs.rawTotal).toLocaleString('en-MY', { minimumFractionDigits: 2 })} of documents were classified as Private Retirement Scheme / deferred annuity contributions, but this relief lapsed after YA2025 and does not apply to this filing year — RM0 was applied, not the RM3,000 this category used to allow.`,
    });
  }
  // New (15 Jul 2026): Finance Act 2025 (Act 874) s.6(a)(v) introduces the
  // Tourist Attraction & Cultural Programme relief (RM1,000, YA2026 only) —
  // it's genuinely new, so it has no H-line mapping in Q4_TO_H_LINE above
  // and falls into q4Unmapped for a totally different reason than Domestic
  // Tourism Relief (which is unmapped because it lapsed). Unlike that case,
  // this relief IS being correctly applied to the total when eligible —
  // it just doesn't have a confirmed printed line number yet, since we only
  // have LHDN's YA2024 Form B skeleton, not a YA2026 one. Surface that
  // distinction explicitly so a real, correctly-granted relief doesn't read
  // as if something went wrong.
  const newTouristAttraction = q4Breakdown.find((b) => b.category === 'Q4 — Tourist Attraction & Cultural Programme' && Number(b.cappedTotal) > 0);
  if (newTouristAttraction) {
    dataGaps.push({
      part: 'H (Tourist Attraction & Cultural Programme)', severity: 'info',
      category: 'H',
      note: `RM ${Number(newTouristAttraction.cappedTotal).toLocaleString('en-MY', { minimumFractionDigits: 2 })} was correctly applied under the new YA2026-only Tourist Attraction & Cultural Programme relief (Finance Act 2025) — it's included in your total relief, but doesn't yet have a confirmed line number on the printed form since LHDN hasn't published a YA2026 Form B skeleton yet.`,
    });
  }
  // Same reasoning as newTouristAttraction above, for the three new
  // one-time reliefs sharing EV charging's RM2,500 pool from YA2026
  // (Finance Act 2025, Act 874, s.6(a)(vi)) — genuinely new lines, not
  // lapsed ones, so they need the same "correctly applied, just no
  // confirmed line number yet" framing rather than the generic unmapped-
  // category message.
  const NEW_HOME_IMPROVEMENT_CATEGORIES = ['Q4 — Food Waste Compost Machine', 'Q4 — Food Waste Grinder Machine', 'Q4 — Home CCTV'];
  const newHomeImprovementItems = q4Breakdown.filter((b) => NEW_HOME_IMPROVEMENT_CATEGORIES.includes(b.category) && Number(b.cappedTotal) > 0);
  if (newHomeImprovementItems.length) {
    const totalNew = newHomeImprovementItems.reduce((sum, b) => sum + Number(b.cappedTotal), 0);
    dataGaps.push({
      part: 'H21 (Food Waste Machine / CCTV)', severity: 'info',
      category: 'H',
      note: `RM ${totalNew.toLocaleString('en-MY', { minimumFractionDigits: 2 })} was correctly applied under new one-time reliefs introduced by Finance Act 2025 (food waste compost/grinder machine, home CCTV — each claimable once within its own eligibility window, sharing the RM2,500 pool with EV charging). Included in your total relief, but doesn't yet have a confirmed line number since LHDN hasn't published a YA2026 Form B skeleton yet.`,
    });
  }
  // Bug fix (14 Jul 2026): the H9/H10 sub-line split completes the full
  // set of H-relief granularity gaps identified in the original scan —
  // H2, H5, H6, H7, H8, H9, and H10 are all now split into their real,
  // individually-tracked LHDN sub-line categories. No dataGap needed here
  // anymore; the old "H9 / H10 not yet split" note has been removed rather
  // than left stale.

  // H16 double-counting fix: documentReliefItems may already contain a
  // document-derived 'H16' entry (from "Q4 — Child Relief" documents). The
  // profile's flat per-child estimate (H16a below) is a fallback for when NO
  // document data exists yet — it must never be added ON TOP OF a real
  // document total, or child relief gets counted twice in reliefTotal (and
  // therefore in the actual tax computation, not just the display).
  const hasDocumentChildRelief = documentReliefItems.some(([code]) => code.startsWith('H16'));
  if (hasDocumentChildRelief) {
    dataGaps.push({
      part: 'H16 (child relief source)', severity: 'info',
      category: 'H',
      note: 'Child relief is coming from your uploaded documents, not the flat per-child profile estimate — this avoids double-counting. If that document total looks low, it\'s likely missing the age/study/disability tiering (see the H2/H6/H12/H13/H16 gap above); it does not mean your child-count profile setting was ignored.',
    });
  }
  const backendProfileReliefs = totals.profileReliefs || null;
  const spouseReliefEligibleForGap = (p.assessmentType === 'joint-husband' || p.assessmentType === 'joint-wife')
    ? ((p.assessmentType === 'joint-husband' && p.gender === 'male') || (p.assessmentType === 'joint-wife' && p.gender === 'female'))
    : p.assessmentType === 'self-spouse-no-income';
  if (backendProfileReliefs && backendProfileReliefs.appliedToChargeableIncome === false
      && (p.isDisabledSelf || p.spouseIsDisabled || (married && spouseReliefEligibleForGap)
          || (p.maritalStatus === 'divorced-widowed' && p.alimonyPaidMyr) || parseInt(p.numberOfChildren || '0', 10) > 0)) {
    dataGaps.push({
      part: 'H4 / H14 / H15 / H16 (filed year)', severity: 'info',
      category: 'H',
      note: 'This year is sourced from a previously filed Form B, so its chargeable income (B24) is LHDN\'s own filed figure and already reflects whatever reliefs were actually claimed at the time. Your current profile settings (disability, joint assessment, alimony, child records) are not re-applied on top of that filed figure, so they\'re omitted from this year\'s Total Relief (B23) rather than double-counted.',
    });
  }
  const profileReliefItems = buildProfileReliefItems(p, hasDocumentChildRelief, backendProfileReliefs);
  const reliefItems = [
    ['H1', 'Individual & dependent relatives (automatic)', individualSelfRelief, 'automatic'],
    ...profileReliefItems,
    ...documentReliefItems,
  ];
  const reliefTotal = reliefItems.reduce((s, [, , v]) => s + v, 0);
  // Lookup by H-code so the full Part H layout (every line/sub-item from the
  // real form, populated or not) can pull "do we have a figure for H5?"
  // without caring how that figure was sourced. Codes with no entry here
  // render blank on the form — that's the correct representation of a gap,
  // not a bug to paper over with a 0.
  const reliefByCode = Object.fromEntries(reliefItems.map(([code, , amount]) => [code, amount]));
  // Phase 7 (14 Jul 2026): per-code provenance ('document' | 'profile_toggle' |
  // 'child_record' | 'profile_estimate' | 'automatic'), sourced from each
  // reliefItems tuple's own 4th element — the same tag buildProfileReliefItems
  // and the documentReliefItems loop already attach, just not previously
  // exposed to the UI. Extends the existing H16-only warning pattern to
  // every H-line instead of a single bottom paragraph.
  const reliefProvenanceByCode = Object.fromEntries(reliefItems.map(([code, , , prov]) => [code, prov]));

  // ── B23/B24: chargeable income — backend-authoritative ────────────────────
  const b23 = reliefTotal;
  const b24 = hasSummary ? (totals.estimatedChargeableIncome ?? 0) : Math.max(0, b22 - b23);

  // ── B25–B34: tax computation — backend-authoritative where available ─────
  const b26 = hasSummary ? (totals.taxChargedMyr ?? 0) : fallbackSkeletonTax(b24);
  // B25a/B25b — backend-authoritative band-by-band split (Phase 0-5 review,
  // 14 Jul 2026): previously these two rows showed nothing at all even
  // though B26 itself was already computed correctly — the total was right,
  // but the form's own required breakdown of HOW it was reached was blank.
  const bracketBreakdown = totals.bracketBreakdown || null;
  const fallbackBreakdown = !bracketBreakdown ? fallbackBracketBreakdown(b24) : null;
  const b25aLowerBoundMyr = bracketBreakdown ? bracketBreakdown.b25aLowerBoundMyr : fallbackBreakdown.b25aLowerBoundMyr;
  const b25aTaxMyr         = bracketBreakdown ? bracketBreakdown.b25aTaxMyr        : fallbackBreakdown.b25aTaxMyr;
  const b25bAmountMyr       = bracketBreakdown ? bracketBreakdown.b25bAmountMyr     : fallbackBreakdown.b25bAmountMyr;
  const b25bRatePct         = bracketBreakdown ? bracketBreakdown.b25bRatePct       : fallbackBreakdown.b25bRatePct;
  const b25bTaxMyr          = bracketBreakdown ? bracketBreakdown.b25bTaxMyr        : fallbackBreakdown.b25bTaxMyr;
  if (bracketBreakdown && bracketBreakdown.isRecomputedFromFiledFigure) {
    dataGaps.push({
      part: 'B25a/B25b (filed year)', severity: 'info',
      category: 'B',
      note: 'This year is sourced from a previously filed Form B, which doesn\'t retain the original bracket-by-bracket split — B25a/B25b are recomputed here from the filed chargeable income against the current tax schedule, which should match what was actually filed unless a different schedule applied that year.',
    });
  }
  const lowIncomeRebate = totals.lowIncomeRebate ?? 0;
  // B27ii — Husband/Wife rebate (Phase 0-5 review, 14 Jul 2026): a separate
  // RM400 rebate, on top of the Self rebate, when chargeable income doesn't
  // exceed RM35,000 AND a RM4,000 spouse deduction was actually granted
  // (H14's spouse component specifically — not alimony, which LHDN's own
  // B27 wording never mentions). Backend-authoritative; see main.py's
  // spouse_rebate_applied.
  const spouseRebate = totals.spouseRebate ?? 0;
  const zakatRebate = totals.zakatRebate ?? 0;
  const departureLevyRebate = totals.departureLevyRebateMyr ?? 0;
  const b27 = lowIncomeRebate + spouseRebate + departureLevyRebate + zakatRebate;
  const b28 = Math.max(0, b26 - b27);
  // Bug fix (16 Jul 2026): B29 (Section 110 withholding, others) is now
  // modeled — totals.estimatedTaxPayable already has it subtracted on the
  // backend (see main.py's section110_rebate_applied), so b31 is already
  // correct here with no frontend change needed beyond this comment. B30
  // (foreign tax credits) remains out of scope, always 0.
  const b31 = hasSummary ? (totals.estimatedTaxPayable ?? 0) : b28;
  const b29 = totals.section110RebateMyr ?? 0;
  // Bug fix (16 Jul 2026): B32 previously hardcoded b29 as 0 in its own
  // formula (rather than reading the real value) since B29 wasn't modeled
  // yet — now that it is, use the real figure so B32 stays the correct
  // mutually-exclusive mirror of B31 instead of silently under-computing
  // the repayable case now that b29 can be genuinely nonzero.
  const b32 = Math.max(0, b29 - b28); // = max(0, (b29 + b30) − b28), b30 remains always 0 (out of scope)
  const cp500Paid = totals.cp500Paid ?? 0;
  const section107d = totals.section107dWithheldMyr ?? 0;
  const b33 = mtdWithheld + cp500Paid + section107d;
  const balance = hasSummary ? (totals.balancePayableMyr ?? (b31 - b33)) : (b31 - b33);

  // Bug fix (16 Jul 2026): B27iii (departure levy) is now modeled — see
  // departureLevyRebate above, fed by compute_departure_levy_rebate_for_year
  // in one_time_relief.py. Always worth a note, even when correctly
  // computed, since this app can only count trips it has actually seen a
  // document for — it can never certify a taxpayer's FULL lifetime count.
  if (departureLevyRebate > 0) {
    dataGaps.push({
      part: 'B27iii (departure levy)', severity: 'info',
      category: 'B',
      note: `RM ${departureLevyRebate.toLocaleString('en-MY', { minimumFractionDigits: 2 })} departure levy rebate applied. This app can only count trips it has seen a document for — it cannot know about a trip claimed before you started uploading documents here. Confirm this is genuinely within your 2-trips-in-a-lifetime allowance before filing.`,
    });
  }
  dataGaps.push({
    part: 'B27i/ii/v (rebates)', severity: 'info',
    category: 'B',
    note: 'Self (B27i), Husband/Wife (B27ii), Departure Levy (B27iii), and Zakat (B27v) rebates are all backend-computed.',
  });
  // Bug fix (16 Jul 2026): B29 (Section 110, others) and B33ii (Section
  // 107D) are now both modeled — see b29/b33 above and main.py's
  // section110_rebate_applied / section107dWithheldMyr. Their dataGap
  // pushes are removed; they're no longer unmodeled.
  dataGaps.push({
    part: 'B30', severity: 'out-of-scope',
    category: 'B',
    note: 'Section 132/133 tax relief exists specifically for foreign-sourced income taxed abroad, which is out of scope for this feature — not a gap to fill, left permanently at 0.',
  });

  // ── Part N: financial particulars, gross figures ──────────────────────────
  // LHDN's Part N is explicitly "Main Business Only" — it must show a single
  // business's figures, not a combination, while B1/Part B correctly aggregate
  // ALL of the person's entities (see the B1/B4/B11 computation above). Filter
  // every Part N source list down to the main (highest-turnover) entity.
  // Only filter when there's more than one entity: a single-entity user's
  // documents may predate entityId being tagged on these records at all
  // (nullable, added later), and requiring an exact match in that case would
  // wrongly zero out Part N for the common single-business user.
  const filterToMainEntity = (entries) =>
    (owned.length > 1 && mainEntity)
      ? (entries || []).filter((e) => e.entityId === mainEntity.id)
      : (entries || []);

  const { byLine: nIncomeLines, unmapped: q1Unmapped } = sumByLine(filterToMainEntity(cy?.q1BusinessIncome), Q1_TO_N_LINE, 'amountNumeric');
  if (q1Unmapped.length) {
    dataGaps.push({
      part: 'N', severity: 'info',
      category: 'N',
      note: `Q1 categories with no Part N mapping (excluded from turnover/other income): ${q1Unmapped.join(', ')}. "SST-02 Sales Tax Return" correctly carries no income of its own (liability pass-through).`,
    });
  }
  const n3 = nIncomeLines.N3 || 0;
  const n11 = nIncomeLines.N11 || 0;
  // N13 "Other income" is now a genuine, plain catch-all — nothing routes
  // into it deliberately (capital gains no longer does, see the bug fix
  // below), so it correctly stays 0 unless some other real other-income
  // category exists in the future.
  const n13 = nIncomeLines.N13 || 0;

  // Bug fix (14 Jul 2026): capital gains (s.4(aa)) used to be silently
  // summed into N13 (and, worse, into B1 as ordinary business income) —
  // now excluded from Q1 aggregation entirely on the backend and surfaced
  // here as its own dataGap, reading the actual disposal/acquisition/
  // gain-loss figures from cy.referenceDocuments rather than a generic
  // "found something" note.
  const capitalGainsDocs = (cy?.referenceDocuments || []).filter(
    (d) => d.category === 'Q1 — Capital Gains (s.4aa)',
  );
  if (capitalGainsDocs.length) {
    const details = capitalGainsDocs.map((d) => {
      const parts = [];
      if (d.cgtDisposalConsideration) parts.push(`disposal RM${d.cgtDisposalConsideration}`);
      if (d.cgtAcquisitionCost) parts.push(`acquisition RM${d.cgtAcquisitionCost}`);
      if (d.cgtGainLoss) parts.push(d.cgtGainLoss);
      return parts.length ? `${d.fileName}: ${parts.join(', ')}` : d.fileName;
    }).join(' | ');
    dataGaps.push({
      part: 'Capital Gains (s.4aa)', severity: 'out-of-scope',
      category: 'N',
      note: `${capitalGainsDocs.length} document(s) show a disposal of unlisted shares/foreign capital assets — correctly EXCLUDED from B1 and N13 (this is a genuinely separate class of income under s.4(aa), not ordinary business income, the same way a real-property disposal gets its own RPGT treatment via D12a/D12b instead of being folded into income). Product decision (16 Jul 2026): computing or filing a s.4(aa) capital gains return is out of scope for this tool, on the same footing as RPGT — it needs to be handled as a separate filing. Detected figures: ${details}.`,
    });
  }

  // Phase 6 (14 Jul 2026): the main entity's FinancialStatementProfile, if
  // any P&L/BS document has been uploaded and extracted for this year — see
  // main.py's `financial_statements` (entityId-tagged, same convention as
  // q3CapitalAssets). At most one entry should match the main entity for a
  // given year (unique per user/entity/year on the backend); `find` is safe.
  const mainEntityFsp = (cy?.financialStatements || []).find(
    (f) => (owned.length > 1 && mainEntity) ? f.entityId === mainEntity.id : true,
  ) || null;
  const pl = mainEntityFsp?.pl || null;
  const bs = mainEntityFsp?.bs || null;

  // N9/N10/N12: now sourced from the P&L half when available (Phase 6) —
  // previously always 0. Falls back to 0 (with an honest gap note below)
  // when no P&L has been uploaded/extracted this year.
  const n9  = toNum(pl?.otherBusinessIncomeMyr);
  const n10 = toNum(pl?.dividendsMyr);
  const n12 = toNum(pl?.rentsRoyaltiesPremiumsMyr);
  const n14 = n9 + n10 + n11 + n12 + n13;

  // N15–N24: gross expense amounts (full amountNumeric, not the apportioned
  // deductibleNumeric) so N26 reflects real bookkeeping, matching how a real
  // P&L would read. N27 recovers the apportionment gap for reconciliation —
  // see the comment above Q3_TO_N_LINE and N27 below.
  const q3EntriesAll = cy?.q3Deductions || [];
  const q3Entries = filterToMainEntity(q3EntriesAll);
  const { byLine: nExpenseLinesGross } = sumByLine(q3Entries, Q3_TO_N_LINE, 'amountNumeric');
  const n5 = nExpenseLinesGross.N5 || 0; // COGS — purchases, not opex
  const n15 = nExpenseLinesGross.N15 || 0;
  const n16 = nExpenseLinesGross.N16 || 0;
  const n17 = nExpenseLinesGross.N17 || 0;
  const n19 = nExpenseLinesGross.N19 || 0;
  const n21 = nExpenseLinesGross.N21 || 0;
  const n22 = nExpenseLinesGross.N22 || 0;
  const n23 = nExpenseLinesGross.N23 || 0;
  const n24 = nExpenseLinesGross.N24 || 0;
  // N18 (contract/subcontracts) and N20 (bad debts): now sourced from the
  // P&L half when available (Phase 6) — previously always 0.
  const n18 = toNum(pl?.contractSubcontractsMyr);
  const n20 = toNum(pl?.badDebtsMyr);
  const n25 = n15 + n16 + n17 + n18 + n19 + n20 + n21 + n22 + n23 + n24;
  // N4/N6 (opening/closing inventory): now sourced from the P&L half when
  // available (Phase 6) — previously always 0, so N7 quietly collapsed to
  // N5 alone. Real LHDN formula is N7 = N4 + N5 − N6.
  const n4 = toNum(pl?.openingInventoryMyr);
  const n6 = toNum(pl?.closingInventoryMyr);
  const n7 = n4 + n5 - n6;
  const n8 = n3 - n7;
  const n26 = n8 + n14 - n25;

  // N27: the non-deductible PORTION of apportioned categories (entertainment
  // 50% cap, gifts, mixed-use vehicle, HP interest) — full amount minus the
  // backend's already-apportioned deductibleNumeric. This is what makes
  // N26 + N27 − capital allowance reconcile back to B1 exactly, FOR A
  // SINGLE-ENTITY USER — see the guarded reconciliation check below.
  const apportionedCategories = new Set([
    'Q3 — Client Entertainment (50% cap)',
    'Q3 — Client & Corporate Gifts',
    'Q3 — Mixed-Use Vehicle Expenses',
    'Q3 — Hire Purchase & Leased Assets',
  ]);
  const n27 = q3Entries
    .filter((e) => apportionedCategories.has(e.category))
    .reduce((s, e) => s + (toNum(e.amountNumeric) - toNum(e.deductibleNumeric)), 0);

  // Part N's capital allowance line, same main-entity-only filtering as above
  // — distinct from totals.q3CapitalAllowance, which correctly aggregates
  // every entity's assets for B1.
  const mainEntityCapitalAssets = filterToMainEntity(cy?.q3CapitalAssets);
  const capitalAllowance = mainEntityCapitalAssets.reduce(
    (s, a) => s + toNum(a.totalAllowanceThisYearMyr) + toNum(a.balancingAllowanceMyr) - toNum(a.balancingChargeMyr),
    0,
  );

  // Surfaces capital_allowance.py's own needsReview flag (set whenever an
  // asset was disposed this year — balancing allowance/charge is a
  // standard-case ESTIMATE, per that module's own docstring) — this signal
  // already existed on the backend but was never actually shown anywhere in
  // the UI until now; it only lived on the per-asset object. Anchored to
  // M2 (Business capital allowances carried forward) since a disposal's
  // balancing figure directly feeds next year's M2 balance, and there's no
  // dedicated per-asset row rendered in Part N/M to anchor to instead.
  const disposedAssetsNeedingReview = mainEntityCapitalAssets.filter((a) => a.needsReview);
  if (disposedAssetsNeedingReview.length) {
    dataGaps.push({
      part: 'Capital asset disposal(s)', severity: 'warning',
      category: 'N',
      affectedCodes: ['M2'],
      note: `${disposedAssetsNeedingReview.length} asset(s) were disposed this year — the balancing allowance/charge shown is a standard-case estimate (see each asset's own note in the Capital Assets section). Confirm with a tax agent, especially if any disposal was a controlled or related-party transfer.`,
    });
  }

  // The N26+N27−capitalAllowance ≈ B1 identity only holds for a single-entity
  // user, since B1 aggregates every entity while N is main-business-only by
  // design (matching the real form). For a multi-entity user, a mismatch is
  // EXPECTED, not a bug — only run this check when there's one entity.
  //
  // Bug fix (14 Jul 2026): this comparison must use the ABSORBED capital
  // allowance (totals.q3CapitalAllowanceAbsorbed), not the full statutory
  // schedule amount (`capitalAllowance` above) — B1 is now absorption-aware
  // (Phase 3's carryforward engine), so in a loss year or a year where
  // capital allowance exceeds available income, the full schedule amount
  // legitimately differs from what was actually absorbed. Using the full
  // amount here would falsely flag every such year as "a category is
  // missing from the N-line mapping" when nothing is actually wrong.
  if (owned.length <= 1) {
    const capitalAllowanceAbsorbed = totals.q3CapitalAllowanceAbsorbed ?? capitalAllowance;
    // Floored at 0 to mirror B1's own behavior in a loss year (B1 never
    // goes negative — a negative pre-CA result becomes a current-year loss,
    // B14, instead). Without this floor, a genuine loss year would show a
    // negative b1Reconciled that can never match B1's actual 0, falsely
    // flagging a perfectly normal loss year as a reconciliation mismatch.
    const b1Reconciled = Math.max(0, money2(n26 + n27 - capitalAllowanceAbsorbed));
    const b1Mismatch = hasSummary && Math.abs(b1Reconciled - b1) > 1;
    if (b1Mismatch) {
      dataGaps.push({
        part: 'N ↔ B1 reconciliation', severity: 'warning',
        category: 'N',
        affectedCodes: ['N26'],
        note: `Part N's own math (N26 + N27 − absorbed capital allowance = RM${fmtAmt(b1Reconciled)}) doesn't match the backend-authoritative B1 (RM${fmtAmt(b1)}). B1 is still used as the filed figure; this usually means a Q1/Q3 category is missing from the N-line mapping tables above and needs adding.`,
      });
    }
  } else {
    dataGaps.push({
      part: 'N (main-business-only) vs B1 (all entities)', severity: 'info',
      category: 'N',
      note: `You have ${owned.length} businesses on this profile. Part N intentionally shows only ${mainEntity ? dash(mainEntity.name) : 'the main'} business's figures (LHDN's own "Main Business Only" instruction), while B1 correctly aggregates all ${owned.length} — so Part N's own arithmetic will not equal B1, and that's expected, not an error.`,
    });
  }

  // N4/N6/N9/N10/N12/N18/N20: only flag as a genuine gap for whichever
  // fields the P&L half STILL didn't supply — Phase 6 fills these in once a
  // P&L has been uploaded and extracted, so this note should shrink (or
  // disappear) rather than stay static once real data exists.
  const stillMissingPlFields = [
    ['N4 (opening inventory)', pl?.openingInventoryMyr],
    ['N6 (closing inventory)', pl?.closingInventoryMyr],
    ['N9 (other business income)', pl?.otherBusinessIncomeMyr],
    ['N10 (dividends)', pl?.dividendsMyr],
    ['N12 (business rents/royalties/premiums)', pl?.rentsRoyaltiesPremiumsMyr],
    ['N18 (contract/subcontracts)', pl?.contractSubcontractsMyr],
    ['N20 (bad debts)', pl?.badDebtsMyr],
  ].filter(([, v]) => v === null || v === undefined).map(([label]) => label);
  if (stillMissingPlFields.length) {
    dataGaps.push({
      part: 'N4, N6, N9, N10, N12, N18, N20', severity: 'gap',
      category: 'N',
      note: pl
        ? `Your uploaded P&L didn't show a figure for: ${stillMissingPlFields.join(', ')} — left at 0 for those specific lines (values it did show are populated). Genuinely inapplicable for most simple sole-prop filings.`
        : 'No P&L has been uploaded and extracted for this year yet, so these lines default to 0: inventory opening/closing balances, other-business income, dividends, business-side rents/royalties, subcontract costs, and bad debts. Upload a Profit & Loss statement to populate them (Phase 6).',
    });
  }
  // Symmetric confidence check to the balance-sheet one below — a
  // low-confidence P&L extraction deserves the same "verify before filing"
  // flag the BS half already gets, not just the BS half.
  if (pl && pl.confidence !== null && pl.confidence !== undefined && pl.confidence < 70) {
    dataGaps.push({
      part: 'N4, N6, N9, N10, N12, N18, N20', severity: 'warning',
      category: 'N',
      affectedCodes: ['N4', 'N6', 'N9', 'N10', 'N12', 'N18', 'N20'],
      note: `The uploaded P&L was extracted with lower confidence (${pl.confidence}%) — verify these figures against the source document before filing.`,
    });
  }

  // N28–N50 (Statement of Financial Position) — Phase 6, 14 Jul 2026.
  // Sourced entirely from an uploaded Balance Sheet's structured extraction
  // (FinancialStatementProfile's bs_* half) — this section has NO other
  // derivation path, unlike N3–N27 above, which formB.js reconstructs from
  // ordinary classified income/expense documents. A balance sheet's assets/
  // liabilities/equity genuinely cannot be inferred from individual receipts.
  const n28 = toNum(bs?.landBuildingsMyr);
  const n29 = toNum(bs?.plantMachineryMyr);
  const n30 = toNum(bs?.motorVehiclesMyr);
  const n31 = toNum(bs?.otherNonCurrentAssetsMyr);
  const n32 = n28 + n29 + n30 + n31;
  const n33 = toNum(bs?.investmentsMyr);
  const n34 = toNum(bs?.inventoryMyr);
  const n35 = toNum(bs?.tradeDebtorsMyr);
  const n36 = toNum(bs?.sundryDebtorsMyr);
  const n37 = toNum(bs?.cashInHandMyr);
  const n38 = toNum(bs?.cashAtBankMyr);
  const n39 = toNum(bs?.otherCurrentAssetsMyr);
  const n40 = n34 + n35 + n36 + n37 + n38 + n39;
  const n41 = n32 + n33 + n40;
  const n42 = toNum(bs?.loansOverdraftsMyr);
  const n43 = toNum(bs?.tradeCreditorsMyr);
  const n44 = toNum(bs?.sundryCreditorsMyr);
  const n45 = n42 + n43 + n44;
  const n46 = toNum(bs?.capitalAccountMyr);
  const n47 = toNum(bs?.currentAccountBfMyr);
  // N48 "Current year profit/loss" is Part N's OWN P&L bottom line (N26),
  // not a separate BS-extracted figure — a balance sheet wouldn't restate
  // it independently, it just carries it into the equity section.
  const n48 = n26;
  const n49 = toNum(bs?.drawingsAdvanceNetMyr);
  const n50 = n47 + n48 - n49;

  // Phase 7 (14 Jul 2026): per-N-line provenance for inline badges, mirroring
  // reliefProvenanceByCode above. N3/N5/N7/N8/N11/N13-N17/N19/N21-N27 are
  // ALWAYS 'document' — formB.js reconstructs them from real classified
  // Q1/Q3 documents, not from a P&L summary. N4/N6/N9/N10/N12/N18/N20 are
  // 'document' only once the specific field the P&L actually supplied is
  // non-null (per-field, not per-category, since a single P&L can supply
  // some of these and omit others). N28-N50 are 'document' as a whole block
  // once a Balance Sheet exists, else null (in-scope, just not uploaded yet)
  // can't be partially inferred the way a P&L's other-income lines can.
  const alwaysDocumentNLines = ['N3', 'N5', 'N7', 'N8', 'N11', 'N13', 'N14', 'N15', 'N16', 'N17', 'N19', 'N21', 'N22', 'N23', 'N24', 'N25', 'N26', 'N27'];
  const nProvenance = {
    ...Object.fromEntries(alwaysDocumentNLines.map((code) => [code, 'document'])),
    // Bug fix (14 Jul 2026, badge system follow-up): these used to map to
    // 'not_available' when blank, which rendered a permanent grey "no data"
    // dot — but a missing P&L/BS is an IN-SCOPE, temporary state (upload one
    // and it fills in), not a structural limitation like the H-sublines
    // below. Returning null here lets FRow's own blank-value detection
    // drive the (yellow) review dot instead, which correctly disappears
    // once the field actually has a value.
    N4:  pl?.openingInventoryMyr != null ? 'document' : null,
    N6:  pl?.closingInventoryMyr != null ? 'document' : null,
    N9:  pl?.otherBusinessIncomeMyr != null ? 'document' : null,
    N10: pl?.dividendsMyr != null ? 'document' : null,
    N12: pl?.rentsRoyaltiesPremiumsMyr != null ? 'document' : null,
    N18: pl?.contractSubcontractsMyr != null ? 'document' : null,
    N20: pl?.badDebtsMyr != null ? 'document' : null,
    ...Object.fromEntries(
      ['N28', 'N29', 'N30', 'N31', 'N32', 'N33', 'N34', 'N35', 'N36', 'N37', 'N38', 'N39', 'N40', 'N41', 'N42', 'N43', 'N44', 'N45', 'N46', 'N47', 'N48', 'N49', 'N50']
        .map((code) => [code, bs ? 'document' : null]),
    ),
    capitalAllowance: 'document',
    // Part G (donations) — always document-derived, same as N15-N27; no
    // profile-estimate concept exists for donations (see Phase 5).
    G1: 'document', G2: 'document', G3: 'document', G4: 'document',
    G5: 'document', G6: 'document', G7: 'document', G8: 'document',
  };

  if (!bs) {
    dataGaps.push({
      part: 'N28–N50 (balance sheet)', severity: 'gap',
      category: 'N',
      note: 'Statement of Financial Position is not populated — no Balance Sheet has been uploaded and extracted for this year yet. Upload one to fill in N28–N50 (Phase 6); left entirely blank rather than falling back to old static entity fields, since those weren\'t document-derived either.',
    });
  } else if (bs.confidence !== null && bs.confidence !== undefined && bs.confidence < 70) {
    dataGaps.push({
      part: 'N28–N50 (balance sheet)', severity: 'warning',
      category: 'N',
      // Anchored to N28 (the first BS row) as a representative marker rather
      // than tagging all 23 balance-sheet rows individually — one shared
      // confidence flag doesn't need 23 review dots to be visible; the
      // section-level Review badge on Part N's header is the real signal.
      affectedCodes: ['N28'],
      note: `The uploaded Balance Sheet was extracted with lower confidence (${bs.confidence}%) — verify these figures against the source document before filing.`,
    });
  }

  // ── Reference documents (P&L / BS / prior Form B) — cross-check only ─────
  const referenceDocuments = cy?.referenceDocuments || [];
  const reconciliation = cy?.reconciliation || [];

  // Review-dot codes: every FRow `code` named in a 'warning'-severity
  // dataGap's affectedCodes, deduplicated into one flat list. This is the
  // SINGLE source of truth the review-dot/section-badge system reads from
  // (via ReviewContext in ManageProfile.jsx) — no separate flagging
  // mechanism, so a new warning added to dataGaps automatically gets a
  // review dot for free as long as it names its affectedCodes.
  // Whole-document provenance extension: Basic Particulars, Part A, most of
  // Part B, and Part D weren't covered by reliefProvenanceByCode/nProvenance
  // (those only ever covered Part G/H/N). Bulk-categorized by group rather
  // than guessed field-by-field — cross-checked against the exact FRow
  // codes rendered in ManageProfile.jsx's Part B/D blocks.
  const PROFILE_ENTERED_CODES = [
    '1', '2', '3', '4',                                        // Basic Particulars
    'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',                  // Part A
    'C1', 'C2', 'C3', 'C4',                                    // Part C — spouse particulars
    'D1', 'D2', 'D4', 'D6a', 'D6b', 'D7', 'D8',                // Part D
    'D9', 'D10a', 'D10b', 'D11a', 'D11b', 'D12a', 'D12b',
    'B21',  // spouse's transferred income — read off the SPOUSE'S saved profile figure
  ];
  const DOCUMENT_DERIVED_CODES = [
    'B1', 'B5', 'B7', 'B7a', 'B8', 'B9', 'B14',
    'B27v',    // zakat rebate — from zakat receipts, not a computed condition
    'B27iii',  // departure levy rebate — from boarding pass/visa documents (16 Jul 2026 fix)
    'B29',     // Section 110 (others) — from withholding certificates (16 Jul 2026 fix)
    'B33i',    // MTD — from Form EA's pcb_deducted
    'B33ii',   // Section 107D — from withholding statements (16 Jul 2026 fix)
    'B33iii',  // CP500 — from CP500 installment documents
    'M2',      // business capital allowances carried forward — carryforward.py, real computation
  ];
  const AUTOMATIC_CODES = [
    'B1a', 'B4', 'B6', 'B11', 'B13', 'B15', 'B17', 'B18', 'B20', 'B22',
    'B23', 'B24', 'B25a', 'B25b', 'B26', 'B27i', 'B27ii', 'B27', 'B28',
    'B31', 'B32', 'B33', 'B34',
  ];
  // Genuinely out of scope, always 0/blank BY DESIGN — not a temporary gap
  // like the P&L/BS fields above, and not something a review dot should
  // ever point at (there's nothing to review; the feature doesn't exist).
  // Distinct from 'null' (in-scope, just not filled in yet) — see FRow's
  // own blank-detection, which only auto-flags null-provenance blanks.
  const OUT_OF_SCOPE_B_CODES = [
    'B2', 'B2a', 'B3', 'B10', 'B12', 'B16', 'B19',
    'B30i', 'B30ii', 'B30',
    'E4', 'F4',  // business/partnership income outside Malaysia — out of scope
    'M3',        // partnership capital allowances — partnerships out of scope
    '5',         // Passport no. registered with LHDNM — removed from profile editor (14 Jul 2026)
    'D5',        // Foreign financial accounts — removed from profile editor (14 Jul 2026)
    // Bug fix (16 Jul 2026): J1/J2 (127(3)(b)/127(3A) incentive claims) were
    // never actually classified here despite being out of scope by product
    // decision — meaning they could spuriously show up in the Form B
    // Readiness panel as "needs review" just for being blank, when the
    // truth is this feature doesn't exist at all, the same reasoning as
    // every other item in this list.
    'J1', 'J2',
  ];
  const otherLineProvenance = {
    ...Object.fromEntries(PROFILE_ENTERED_CODES.map((c) => [c, 'profile_toggle'])),
    ...Object.fromEntries(DOCUMENT_DERIVED_CODES.map((c) => [c, 'document'])),
    ...Object.fromEntries(AUTOMATIC_CODES.map((c) => [c, 'automatic'])),
    ...Object.fromEntries(OUT_OF_SCOPE_B_CODES.map((c) => [c, 'out_of_scope'])),
  };

  const reviewCodes = [...new Set(
    dataGaps.filter((g) => g.severity === 'warning').flatMap((g) => g.affectedCodes || []),
  )];

  // ── Part J: incentive claims (paragraph 127(3)(b)) — OUT OF SCOPE ──────
  // Removed 14 Jul 2026 by product decision — see the B12/B16/B19/J1/J2
  // dataGap above. ManageProfile.jsx's Part J block now always renders the
  // blank placeholder rows (same as J2 always has) rather than reading a
  // fd.j1Claims value that no longer exists.

  return {
    hasSummary,
    dataGaps,
    reviewCodes,
    entityCount: owned.length,
    mainEntity,
    entities: owned,
    referenceDocuments,
    reconciliation,
    kDisclosures: cy?.kDisclosures || [],

    // Basic Particulars (items 1–5)
    name: dash(p.fullName),
    tin: dash(p.personalTin),
    // Each field shows exactly what the user entered for it, independently —
    // no "which type is primary" logic. Blank shows as a dash, same as every
    // other unset field on this form.
    idNo: dash(p.identificationNo),
    passportNo: dash(p.passportNo),
    // Out of scope (14 Jul 2026) — input removed from the profile editor;
    // always shown blank regardless of any value saved before this change.
    passportNoLhdnm: '—',

    // Part A
    citizen:          dash(p.citizenship),
    gender:           withCode(genderLabel(p.gender), genderCode(p.gender)),
    dob:              fmtDateDMY(p.dateOfBirth),
    marital:          withCode(maritalLabel(p.maritalStatus), maritalCode(p.maritalStatus)),
    maritalEventDate: fmtDateDMY(p.maritalEventDate),
    // A7: codes 1–4 require an actual election and only mean anything when
    // married; code 5 (self — single/divorcee/widow/widower/deceased) is
    // automatic otherwise and was never a real choice in profile.assessmentType,
    // so it's substituted in directly rather than read from the profile.
    assessment:       withCode(assessmentLabel(effectiveAssessmentType), assessmentCode(effectiveAssessmentType)),
    assessmentCode:   assessmentCode(effectiveAssessmentType),
    recordKeeping:    p.recordKeeping ? 'Yes (1)' : 'No (2)',

    // Part B — Computation of Income Tax
    b1, b4, b6, b7, b8, b9, b11, b13, b15,
    b7aSuggestedCount: b7aSuggestion?.count ?? null,
    g1, g2a, g2b, g2c, g2d, g2, g3, g4, g5, g6, g7,
    donationsG8, b18, b20, b22, b23, b24,
    b25aLowerBoundMyr, b25aTaxMyr, b25bAmountMyr, b25bRatePct, b25bTaxMyr,
    b26, b27, lowIncomeRebate, spouseRebate, zakatRebate,
    b28, b29, b30: 0, b31, b32, mtdWithheld, cp500Paid, section107d, b33, b34: balance,
    departureLevyRebate,
    departureLevyTripsThisYear: cy?.totals?.departureLevyTripsThisYear ?? null,

    // Part C — spouse
    married,
    spouseName: married ? dash(p.spouseName) : '—',
    spouseIdNo: married ? dash(p.spouseIdNo) : '—',
    spousePassportNo: married ? dash(p.spousePassportNo) : '—',
    spouseDob:  married ? fmtDateDMY(p.spouseDob) : '—',

    // Part D — other particulars
    phone: dash(p.phone),
    email: dash(p.email),
    correspondenceAddress: joinAddress([
      p.correspondenceAddress,
      [p.correspondencePostcode, p.correspondenceCity].filter(Boolean).join(' '),
      p.correspondenceState,
    ]) || '—',
    // D3/D4: employer's TIN. Bug fix (14 Jul 2026): this used to fall back
    // to the Form EA suggestion whenever the saved profile field was blank
    // — which meant deliberately clearing it in the profile and saving
    // never actually showed as blank here, since the fallback just silently
    // re-substituted the suggestion. The generated form now shows exactly
    // what's saved in the profile, full stop; the suggestion is still
    // available as an explicit "Use this" action in the profile editor
    // (see PersonalProfilePanel), which becomes a real saved value the
    // moment it's accepted — no more silent, unsaved substitution here.
    employerTin: dash(p.employerTin),
    // Bug fix (14 Jul 2026): D3 used to need review whenever it was blank,
    // full stop — but a sole prop with NO employment outside their own
    // business genuinely doesn't need an employer TIN at all; flagging it
    // regardless was the same mistake as B7a above. Now conditional on
    // whether a Form EA was actually uploaded and classified this year
    // (d3Suggestion.value is only non-null when one was): if none exists,
    // 'out_of_scope' — there's no evidence any employer TIN is even
    // relevant, so no review. If one DOES exist, provenance stays null,
    // which lets the normal blank-value review rule apply — an
    // unconfirmed TIN when employment income clearly exists IS worth
    // flagging.
    employerTinProvenance: d3Suggestion.value != null ? null : 'out_of_scope',
    taxBorneByEmployer: p.employerTin ? (p.taxBorneByEmployer ? 'Yes (1)' : 'No (2)') : '—',
    // Out of scope (14 Jul 2026) — toggle removed from the profile editor;
    // always shown blank regardless of any value saved before this change.
    hasForeignAccounts: '—',
    // D6a/D6b: the business model is only meaningful once e-Commerce is Yes.
    carriesOnEcommerce: p.carriesOnEcommerce ? 'Yes (1)' : 'No (2)',
    ecommerceModel: p.carriesOnEcommerce
      ? withCode(ECOMMERCE_MODEL_LABEL[p.ecommerceModel] || '—', ECOMMERCE_MODEL_CODE[p.ecommerceModel] || '')
      : '—',
    // D9/D10/D11: only the fields matching the selected refund method carry a
    // real value — showing stale bank details after switching to DuitNow (or
    // vice versa) would misrepresent what was actually elected.
    refundMethod: withCode(REFUND_METHOD_LABEL[p.refundMethod] || '—', REFUND_METHOD_CODE[p.refundMethod] || ''),
    bankName: p.refundMethod === 'bank' ? dash(p.bankName) : '—',
    bankAccountNo: p.refundMethod === 'bank' ? dash(p.bankAccountNo) : '—',
    duitnowIdType: p.refundMethod === 'duitnow'
      ? withCode(DUITNOW_ID_TYPE_LABEL[p.duitnowIdType] || '—', DUITNOW_ID_TYPE_CODE[p.duitnowIdType] || '')
      : '—',
    // D11b reuses the passport number already captured in Basic Particulars
    // rather than asking for it a second time — only shown when DuitNow +
    // passport is the selected identification type.
    duitnowPassportNo: (p.refundMethod === 'duitnow' && p.duitnowIdType === 'passport') ? dash(p.passportNo) : '—',
    // D12a/D12b: declaration status only means anything once a disposal is
    // actually reported.
    rpgtDisposal: p.rpgtDisposal ? 'Yes (1)' : 'No (2)',
    disposalDeclared: p.rpgtDisposal ? (p.disposalDeclared ? 'Yes (1)' : 'No (2)') : '—',

    // Part H — reliefs
    reliefItems, reliefTotal, reliefByCode, reliefProvenanceByCode,
    nProvenance, otherLineProvenance,

    // Part N — main business, financial particulars
    businessName:     mainEntity ? dash(mainEntity.name) : '—',
    businessRegNo:    mainEntity ? dash(mainEntity.ssmNo) : '—',
    businessCode:     mainEntity ? dash(mainEntity.businessCode) : '—',
    businessActivity: mainEntity ? dash(mainEntity.businessActivity) : '—',
    businessAddress: mainEntity
      ? (joinAddress([
          mainEntity.premiseAddress,
          [mainEntity.premisePostcode, mainEntity.premiseCity].filter(Boolean).join(' '),
          mainEntity.premiseState,
        ]) || '—')
      : '—',
    n3, n4, n5, n6, n7, n8, n9, n10, n11, n12, n13, n14,
    n15, n16, n17, n18, n19, n20, n21, n22, n23, n24, n25, n26, n27,
    n28, n29, n30, n31, n32, n33, n34, n35, n36, n37, n38, n39, n40,
    n41, n42, n43, n44, n45, n46, n47, n48, n49, n50,
    hasBalanceSheet: !!bs,
    capitalAllowance,

    // Part M — business losses (M1) & capital allowance (M2) carry-forward.
    // Backend-authoritative (Phase 3, 14 Jul 2026) — see carryforward.py.
    // Summed across every entity already (main.py sums per-entity schedules
    // when entity_id is null, same pattern as capital allowance/H11).
    m1BroughtForwardMyr: businessLossCf.broughtForwardMyr ?? 0,
    m1AbsorbedMyr:       businessLossCf.absorbedMyr ?? 0,
    m1CarriedForwardMyr: businessLossCf.carriedForwardMyr ?? 0,
    m2UnabsorbedCapitalAllowanceMyr: totals.unabsorbedCapitalAllowanceMyr ?? 0,
    businessLossVintages: totals.businessLossVintages || [],
    b5, b14,
    currentYearBusinessLossRawMyr: totals.currentYearBusinessLossMyr ?? 0,
    b21, jointAssessment,
    perEntityCarryforward: totals.perEntityCarryforward || [],

    // Convenience totals used by the on-screen (non-print) summary panel
    totalIncome: b22,
    chargeableIncome: b24,
    taxCharged: b26,
    rebate: b27,
    taxPayable: b31,
  };
}

// Local rounding helper (mirrors the backend's money() semantics closely
// enough for display purposes — this file never feeds a filed figure that
// didn't already come from the backend rounded).
function money2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}