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
// N3 = turnover; N11 = business-account interest; N13 = other/misc (capital
// gains routed here as a placeholder — s.4(aa) capital gains are actually a
// separate CGT filing, not part of Form B business income, so this is a
// deliberate approximation flagged as a dataGap, not a silent misclassification).
// SST-02 filings carry no income of their own (liability pass-through) and
// are excluded entirely.
const Q1_TO_N_LINE = {
  'Q1 — Sales & Service Revenue':    'N3',
  'Q1 — e-Invoice / LHDN Validated': 'N3',
  'Q1 — Business Bank Interest':     'N11',
  'Q1 — Capital Gains (s.4aa)':      'N13',
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

// Q4 personal relief → Part H line. Where a single pipeline category
// genuinely spans multiple H-codes (parental medical vs self/spouse/child
// medical; SSPN vs childcare fees vs child relief), this maps to the closest
// single H-line as a best-effort placement and is called out as a dataGap —
// splitting these properly needs a finer-grained category taxonomy upstream.
const Q4_TO_H_LINE = {
  'Q4 — Life Insurance & Takaful Relief':  'H17i',
  'Q4 — EPF Personal Contribution':        'H17ii',
  'Q4 — Education Relief':                 'H5',
  'Q4 — Lifestyle Relief':                 'H9',
  'Q4 — Medical Equipment Relief':         'H3',
  'Q4 — Private Retirement Scheme (PRS)':  'H18',
  'Q4 — SOCSO Personal Contribution':      'H20',
  'Q4 — EV Charging Equipment':            'H21',
  'Q4 — Medical & Parental Care':          'H6',  // approximation — see dataGaps
  'Q4 — Child Relief':                     'H16', // approximation — see dataGaps
  // Q4 — Zakat is intentionally absent: the backend already routes it to the
  // B27 rebate calculation (zakatRebate), never into the relief pool.
  // Q4 — Domestic Tourism Relief has no corresponding line on the current
  // (2024) form — the relief lapsed. Excluded; flagged as a dataGap.
};

const H_LINE_LABELS = {
  H3:    'H3  Basic supporting equipment (disabled self/spouse/child/parent)',
  H5:    'H5  Education fees (self)',
  H6:    'H6  Medical expenses (self, spouse or child)',
  H9:    'H9  Lifestyle relief',
  H16:   'H16 Child relief',
  H17i:  'H17(i)  Life insurance / EPF (voluntary)',
  H17ii: 'H17(ii) EPF (voluntary or compulsory)',
  H18:   'H18 Private retirement scheme',
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
// profile toggle. This function covers the remaining profile-toggle-driven
// flat amounts: disabled individual, spouse, and child relief. H16's tiering
// (2,000 / 8,000 / 6,000–14,000 depending on age/study/disability) can only
// be approximated here — the profile schema stores a single `numberOfChildren`
// count with no per-child age, study-status, or disability data, so every
// child is valued at the base H16a rate (RM2,000) until that data exists.
// This is flagged as a dataGap, not silently assumed correct.
function buildProfileReliefItems(profile) {
  const p = profile || {};
  const childCount = parseInt(p.numberOfChildren || '0', 10) || 0;
  const married = p.maritalStatus === 'married';
  const jointAssessment = (p.assessmentType || '').startsWith('joint');
  const items = [];
  if (p.hasDisabledDependents) items.push(['H4', 'Disabled individual', 6000, 'profile_toggle']);
  if (married && jointAssessment) items.push(['H14', 'Husband / wife / alimony', 4000, 'profile_toggle']);
  if (childCount > 0) {
    items.push([
      'H16a',
      `Child relief — ${childCount} × RM 2,000 (base rate; per-child age/study/disability not tracked)`,
      childCount * 2000,
      'profile_estimate',
    ]);
  }
  return items;
}

// Progressive resident tax bands — kept ONLY as an emergency fallback for
// display purposes if taxSummary hasn't loaded yet (e.g. panel opened before
// the fetch resolves). NEVER used once taxSummary is available: the real
// computation lives entirely in main.py's _estimate_tax(). This table is not
// guaranteed to match the backend's TAX_BRACKETS_BY_YA and must not be relied
// on for any figure that ends up in the printed form.
function fallbackSkeletonTax(ci) {
  const bands = [
    [5000, 0], [15000, 0.01], [15000, 0.03], [15000, 0.06],
    [20000, 0.11], [30000, 0.19], [150000, 0.25], [Infinity, 0.26],
  ];
  let tax = 0, rem = ci;
  for (const [band, rate] of bands) {
    if (rem <= 0) break;
    const taxable = Math.min(rem, band);
    tax += taxable * rate;
    rem -= taxable;
  }
  return Math.round(tax);
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
      note: 'No tax profile summary loaded yet — every financial figure below is a placeholder until GET /api/profile/summary returns data for this year and entity.',
    });
  }

  // ── Part B: income lines from Q2 documents ────────────────────────────────
  const { byLine: bLines, unmapped: q2Unmapped } = sumByLine(cy?.q2PersonalIncome, Q2_TO_B_LINE, 'amountNumeric');
  if (q2Unmapped.length) {
    dataGaps.push({
      part: 'B', severity: 'info',
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

  // B1 statutory business income — backend-authoritative (already nets Q1
  // income against Q3 deductions + capital allowance). NOT re-derived from
  // the N-line breakdown below, which exists for display/reconciliation only.
  const b1 = Math.max(0, (totals.q1BusinessIncome || 0) - (totals.q3TotalDeductions || 0));
  const b4 = b1;          // B2/B3 (partnerships, foreign business) not modeled — 0
  const b6 = b4;           // B5 (losses b/f) not modeled — 0
  const b11 = b6 + b7 + b8 + b9;   // B10 (foreign other income) not modeled — 0
  const b13 = b11;         // B12 (angel investor) not modeled — 0
  const b15 = b13;         // B14 (current-year losses) not modeled — 0
  const donationsG8 = 0;   // Part G not modeled — see dataGaps below
  const b18 = Math.max(0, b15 - donationsG8); // B16 (Schedule 4) not modeled — 0
  const b20 = b18;         // B19 (pioneer income) not modeled — 0
  const b22 = b20;         // B21 (joint-assessment transfer) not modeled — 0

  dataGaps.push({
    part: 'G', severity: 'gap',
    note: 'Approved donations (Part G / B17) have no category in the current pipeline taxonomy at all — every donation receipt today would fall into "Mixed / Pending Review" or be misclassified. Needs a new Q1-adjacent category, capped at 10% of B11, deducted before B18.',
  });
  dataGaps.push({
    part: 'B10 / Part F', severity: 'gap',
    note: 'Foreign-source income (Q2 — Foreign-Source Income) is classified by the pipeline but not routed anywhere on this form. Needs Part F line items + B10 total.',
  });
  dataGaps.push({
    part: 'B2–B3, B12, B14, B16, B19, B21 / Parts E, J, K, L, M', severity: 'out-of-scope-v1',
    note: 'Partnerships, foreign business income, angel-investor deduction, current-year/brought-forward business losses, Schedule 4 prospecting expenditure, pioneer income, and joint-assessment income transfer are not modeled. Left at 0 / blank, same as a real preparer would for a straightforward sole-prop return with none of these — not silently wrong, just not applicable to most users yet.',
  });
  dataGaps.push({
    part: 'B1a, B2a, B5, B7a, B32', severity: 'out-of-scope-v1',
    note: 'Count fields (number of businesses/partnerships/employments) and business-losses-brought-forward (B5) / tax-repayable-alternate (B32) aren\'t tracked as distinct figures — B1a/B2a/B7a could be derived by counting distinct entities/employers in the documents, which is a small addition; B5 needs loss carry-forward tracking (Part M).',
  });
  dataGaps.push({
    part: 'G1–G7 (donation sub-items)', severity: 'gap',
    note: 'Even once a donations category exists (see the Part G gap above), the pipeline would need to distinguish which specific G-line a donation belongs to (government vs approved institution vs sports vs national project vs library vs disabled-facilities vs medical equipment vs artefacts/paintings) — right now this can only be a single combined G8 figure, not itemised G1–G7.',
  });
  dataGaps.push({
    part: 'D3 (employer\'s TIN)', severity: 'gap',
    note: 'Employer\'s TIN is manually entered in Other Particulars for now. Auto-populating it from a Form EA upload would need the EA extraction schema to actually capture the employer\'s TIN (not just gross income / PCB) and a pipeline hook to write it into the profile — not yet wired.',
  });

  // ── Part H: reliefs ────────────────────────────────────────────────────────
  const individualSelfRelief = totals.individualSelfRelief ?? 0; // H1, automatic
  const q4Breakdown = cy?.totals?.q4ReliefsBreakdown || [];
  const documentReliefItems = [];
  const q4Unmapped = [];
  for (const b of q4Breakdown) {
    const hLine = Q4_TO_H_LINE[b.category];
    if (!hLine) { q4Unmapped.push(b.category); continue; }
    documentReliefItems.push([hLine, H_LINE_LABELS[hLine] || hLine, Number(b.cappedTotal) || 0, 'document']);
  }
  if (q4Unmapped.length) {
    dataGaps.push({
      part: 'H', severity: 'info',
      note: `Q4 relief categories excluded from Part H (no line mapping): ${q4Unmapped.join(', ')}. "Domestic Tourism Relief" has lapsed on the current form; Zakat is correctly routed to the B27 rebate instead of here.`,
    });
  }
  dataGaps.push({
    part: 'H2 / H6 / H12 / H13 / H16', severity: 'gap',
    note: '"Q4 — Medical & Parental Care" and "Q4 — Child Relief" are each broader than a single H-code (parental medical vs H2, self/spouse/child medical vs H6; SSPN vs H13, childcare fees vs H12, child relief vs H16). Both are placed on a best-effort single line below — splitting correctly needs finer-grained categories upstream.',
  });

  const profileReliefItems = buildProfileReliefItems(p);
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

  // ── B23/B24: chargeable income — backend-authoritative ────────────────────
  const b23 = reliefTotal;
  const b24 = hasSummary ? (totals.estimatedChargeableIncome ?? 0) : Math.max(0, b22 - b23);

  // ── B25–B34: tax computation — backend-authoritative where available ─────
  const b26 = hasSummary ? (totals.taxChargedMyr ?? 0) : fallbackSkeletonTax(b24);
  const lowIncomeRebate = totals.lowIncomeRebate ?? 0;
  const zakatRebate = totals.zakatRebate ?? 0;
  const b27 = lowIncomeRebate + zakatRebate; // husband/wife + departure-levy rebates not modeled — 0
  const b28 = Math.max(0, b26 - b27);
  const b31 = hasSummary ? (totals.estimatedTaxPayable ?? 0) : b28; // B29/B30 (foreign tax credits, s.110) not modeled — 0
  const cp500Paid = totals.cp500Paid ?? 0;
  const b33 = mtdWithheld + cp500Paid; // Section 107D not modeled — 0
  const balance = hasSummary ? (totals.balancePayableMyr ?? (b31 - b33)) : (b31 - b33);

  dataGaps.push({
    part: 'B25a / B25b', severity: 'gap',
    note: 'LHDN\'s printed schedule shows tax "on the first RM X" (cumulative published band amount) plus tax "on the balance at Y%". The backend only returns the final computed tax (taxChargedMyr), not a band-by-band breakdown, so B25a/B25b are left blank rather than guessed. main.py\'s _bracket_headroom() has the current marginal rate but not the full walk — would need a small addition to _estimate_tax() to expose the per-band breakdown.',
  });
  dataGaps.push({
    part: 'B27 (husband/wife, departure levy)', severity: 'out-of-scope-v1',
    note: 'Only the self low-income rebate and zakat rebate are modeled (both backend-computed). Spouse rebate requires joint-assessment support; departure levy for umrah/religious travel isn\'t tracked anywhere.',
  });
  dataGaps.push({
    part: 'B29 / B30', severity: 'out-of-scope-v1',
    note: 'Section 110 tax deduction and s.132/133 foreign tax relief are not modeled — left at 0, same as a domestic-only sole prop would show on a real form.',
  });

  // ── Part N: financial particulars, gross figures (reconciles against B1) ──
  const { byLine: nIncomeLines, unmapped: q1Unmapped } = sumByLine(cy?.q1BusinessIncome, Q1_TO_N_LINE, 'amountNumeric');
  if (q1Unmapped.length) {
    dataGaps.push({
      part: 'N', severity: 'info',
      note: `Q1 categories with no Part N mapping (excluded from turnover/other income): ${q1Unmapped.join(', ')}. "SST-02 Sales Tax Return" correctly carries no income of its own (liability pass-through).`,
    });
  }
  const n3 = nIncomeLines.N3 || 0;
  const n11 = nIncomeLines.N11 || 0;
  const n13 = nIncomeLines.N13 || 0;
  if (nIncomeLines.N13) {
    dataGaps.push({
      part: 'N13 (Capital Gains s.4aa)', severity: 'gap',
      note: 'Capital gains on disposal of unlisted shares/foreign assets are routed to N13 "Other income" as a placeholder. These are actually a separate CGT filing under s.4(aa), not Form B business income — needs its own treatment, not folded into Part N.',
    });
  }
  const n14 = n11 + n13; // N9, N10, N12 (other businesses, dividends, business-side rents/royalties) not modeled — 0

  // N15–N24: gross expense amounts (full amountNumeric, not the apportioned
  // deductibleNumeric) so N26 reflects real bookkeeping, matching how a real
  // P&L would read. N27 recovers the apportionment gap for reconciliation —
  // see the comment above Q3_TO_N_LINE and N27 below.
  const q3Entries = cy?.q3Deductions || [];
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
  // N18 (contract/subcontracts) and N20 (bad debts) have no source category —
  // always 0 today, flagged below rather than silently absent.
  const n25 = n15 + n16 + n17 + n19 + n21 + n22 + n23 + n24; // N18, N20 = 0
  const n7 = n5; // N4/N6 (opening/closing inventory) not tracked — 0
  const n8 = n3 - n7;
  const n26 = n8 + n14 - n25;

  // N27: the non-deductible PORTION of apportioned categories (entertainment
  // 50% cap, gifts, mixed-use vehicle, HP interest) — full amount minus the
  // backend's already-apportioned deductibleNumeric. This is what makes
  // N26 + N27 − capital allowance reconcile back to B1 exactly.
  const apportionedCategories = new Set([
    'Q3 — Client Entertainment (50% cap)',
    'Q3 — Client & Corporate Gifts',
    'Q3 — Mixed-Use Vehicle Expenses',
    'Q3 — Hire Purchase & Leased Assets',
  ]);
  const n27 = q3Entries
    .filter((e) => apportionedCategories.has(e.category))
    .reduce((s, e) => s + (toNum(e.amountNumeric) - toNum(e.deductibleNumeric)), 0);

  const capitalAllowance = totals.q3CapitalAllowance || 0;
  const b1Reconciled = money2(n26 + n27 - capitalAllowance);
  const b1Mismatch = hasSummary && Math.abs(b1Reconciled - b1) > 1;
  if (b1Mismatch) {
    dataGaps.push({
      part: 'N ↔ B1 reconciliation', severity: 'warning',
      note: `Part N's own math (N26 + N27 − capital allowance = RM${fmtAmt(b1Reconciled)}) doesn't match the backend-authoritative B1 (RM${fmtAmt(b1)}). B1 is still used as the filed figure; this usually means a Q1/Q3 category is missing from the N-line mapping tables above and needs adding.`,
    });
  }

  dataGaps.push({
    part: 'N4, N6, N9, N10, N12, N18, N20', severity: 'out-of-scope-v1',
    note: 'Inventory opening/closing balances, other-business income, dividends, business-side rents/royalties, subcontract costs, and bad debts have no source in the current pipeline — always 0. Genuinely inapplicable for most simple sole-prop uploads, but worth a category each if a user\'s documents actually cover them.',
  });
  dataGaps.push({
    part: 'N28–N50 (balance sheet)', severity: 'gap',
    note: 'Statement of Financial Position is not populated from documents at all — it needs the planned P&L/Balance Sheet structured extraction (FinancialStatementProfile) discussed earlier. Currently left entirely blank rather than falling back to the old static entity.totalAssets/totalLiabilities fields, since those aren\'t document-derived either.',
  });

  // ── Reference documents (P&L / BS / prior Form B) — cross-check only ─────
  const referenceDocuments = cy?.referenceDocuments || [];
  const reconciliation = cy?.reconciliation || [];

  return {
    hasSummary,
    dataGaps,
    entityCount: owned.length,
    mainEntity,
    entities: owned,
    referenceDocuments,
    reconciliation,

    // Basic Particulars (items 1–5)
    name: dash(p.fullName),
    tin: dash(p.personalTin),
    // Each field shows exactly what the user entered for it, independently —
    // no "which type is primary" logic. Blank shows as a dash, same as every
    // other unset field on this form.
    idNo: dash(p.identificationNo),
    passportNo: dash(p.passportNo),

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
    donationsG8, b18, b20, b22, b23, b24,
    b26, b27, lowIncomeRebate, zakatRebate,
    b28, b29: 0, b30: 0, b31, mtdWithheld, cp500Paid, b33, b34: balance,

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
    // D3/D4: employer's TIN is manually entered in Other Particulars today
    // (Form-EA auto-population isn't wired yet — see dataGaps). D4 only
    // means anything once an employer TIN actually exists.
    employerTin: dash(p.employerTin),
    taxBorneByEmployer: p.employerTin ? (p.taxBorneByEmployer ? 'Yes (1)' : 'No (2)') : '—',
    hasForeignAccounts: p.hasForeignAccounts ? 'Yes (1)' : 'No (2)',
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
    reliefItems, reliefTotal, reliefByCode,

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
    n3, n5, n7, n8, n11, n13, n14,
    n15, n16, n17, n19, n21, n22, n23, n24, n25, n26, n27,
    capitalAllowance,

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