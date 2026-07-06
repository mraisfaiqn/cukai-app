/**
 * formB.js — pure (non-React) logic for the Generate Forms tab.
 *
 * Everything here is plain data/formatting/computation: no JSX, no components.
 * It lives in its own module (rather than inside ManageProfile.jsx) for two
 * reasons:
 *   1. React Fast Refresh only hot-updates a file in place when EVERY export in
 *      that file is a React component. A component file that also exports (or is
 *      edited alongside) helpers/constants can't be a "refresh boundary", so
 *      saving it reloads the whole app instead of just the component. Keeping
 *      this logic in a components-free module keeps ManageProfile.jsx a clean
 *      refresh boundary.
 *   2. It's the reusable core of the Form B draft, independent of how it's
 *      rendered — easy to test and to share with other pages later.
 */

// ── Filing year ───────────────────────────────────────────────────────────────
// Form B is filed for income earned in YEAR by the following year's deadline, so
// the YA actively being filed is last calendar year until this year's deadline
// passes, then it rolls forward. This is kept IDENTICAL to Overview.jsx's
// currentFilingYear() so the dashboard and the generated form always agree on
// "today's" YA. (Overview uses a 30 June cutoff — new Date(year, 5, 30) — so we
// match that here. If Overview is later changed to the 15 July e-Filing cutoff,
// change it here too, or import a single shared copy.)
export function currentFilingYear(today = new Date()) {
  const year = today.getFullYear();
  const cutoff = new Date(year, 5, 30); // 30 June (month index 5) — matches Overview.jsx
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

export const genderLabel = (g) => (g === 'male' ? 'Male' : g === 'female' ? 'Female' : '—');
export const maritalLabel = (m) => (m ? m.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
export const assessmentLabel = (a) =>
  ({
    'separate': 'Separate',
    'joint-husband': 'Joint — in the name of husband',
    'joint-wife': 'Joint — in the name of wife',
  }[a] || '—');
// LHDN A7 assessment-type codes (1–5) shown on the form.
export const assessmentCode = (a) =>
  ({ 'joint-husband': '1', 'joint-wife': '2', 'separate': '3' }[a] || '');

const joinAddress = (parts) => parts.filter(Boolean).join(', ');

// ── Statutory relief caps ─────────────────────────────────────────────────────
// The profile stores which reliefs apply as booleans, not amounts, so each
// enabled relief is valued at its LHDN maximum cap — an estimate the user
// verifies before filing. The individual relief is automatic for every resident.
export function buildReliefItems(profile) {
  const childCount = parseInt(profile.numberOfChildren || '0', 10) || 0;
  const married = profile.maritalStatus === 'married';
  const jointAssessment = (profile.assessmentType || '').startsWith('joint');
  const items = [['H1', 'Individual & dependent relatives', 9000]];
  if (profile.hasDisabledDependents)        items.push(['H4', 'Disabled individual', 6000]);
  if (profile.hasDependentParents)          items.push(['H2', 'Expenses for parents', 8000]);
  if (childCount > 0)                        items.push(['H16', `Child relief (${childCount} × RM 2,000)`, childCount * 2000]);
  if (married && jointAssessment)           items.push(['H14', 'Husband / wife / alimony', 4000]);
  if (profile.hasEpfLifeInsurance)          items.push(['H17', 'Life insurance & EPF', 7000]);
  if (profile.hasEducationMedicalInsurance) items.push(['H19', 'Education & medical insurance', 3000]);
  if (profile.hasLifestylePurchases)        items.push(['H9', 'Lifestyle', 2500]);
  if (profile.hasSspnEvOther)               items.push(['H13', 'SSPN / EV / other reliefs', 8000]);
  return items;
}

// Progressive resident tax bands (LHDN schedule).
export function calcTax(ci) {
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

// ── Form B dataset ────────────────────────────────────────────────────────────
// Rolls the profile + all owned entities into a single Form B dataset. Financials
// are accumulated across entities; the main business (highest sales turnover, or
// the sole entity) supplies the Part N business particulars.
export function buildFormData(profile, entities) {
  const p = profile || {};
  const owned = entities || [];

  const totals = owned.reduce(
    (a, e) => ({
      turnover:    a.turnover    + toNum(e.salesTurnover),
      expenditure: a.expenditure + toNum(e.totalExpenditure),
      netProfit:   a.netProfit   + toNum(e.netProfitLoss),
      assets:      a.assets      + toNum(e.totalAssets),
      liabilities: a.liabilities + toNum(e.totalLiabilities),
    }),
    { turnover: 0, expenditure: 0, netProfit: 0, assets: 0, liabilities: 0 }
  );

  const mainEntity = owned.length
    ? owned.reduce((best, e) => (toNum(e.salesTurnover) > toNum(best.salesTurnover) ? e : best), owned[0])
    : null;

  const businessIncome = totals.netProfit !== 0 ? totals.netProfit : totals.turnover - totals.expenditure;
  const totalIncome = businessIncome;

  const reliefItems = buildReliefItems(p);
  const reliefTotal = reliefItems.reduce((s, [, , v]) => s + v, 0);

  const chargeableIncome = Math.max(0, totalIncome - reliefTotal);
  const taxCharged = calcTax(chargeableIncome);
  const rebate = chargeableIncome > 0 && chargeableIncome <= 35000 ? 400 : 0; // s.6A individual rebate
  const lessInstalment = 0; // no CP500 instalment data captured in the profile
  const taxCharged280 = Math.max(0, taxCharged - rebate);
  const taxPayable = Math.max(0, taxCharged280 - lessInstalment);

  const married = p.maritalStatus === 'married';

  return {
    entityCount: owned.length,
    mainEntity,
    entities: owned,
    totals,
    // Income & tax computation
    totalIncome, reliefItems, reliefTotal, chargeableIncome,
    taxCharged, rebate, lessInstalment, taxCharged280, taxPayable,
    // Basic particulars / Part A
    name:            dash(p.fullName),
    tin:             dash(p.personalTin),
    idNo:            dash(p.identificationNo),
    citizen:         dash(p.citizenship),
    gender:          genderLabel(p.gender),
    dob:             dash(p.dateOfBirth),
    marital:         maritalLabel(p.maritalStatus),
    maritalEventDate: dash(p.maritalEventDate),
    assessment:      assessmentLabel(p.assessmentType),
    assessmentCode:  assessmentCode(p.assessmentType),
    recordKeeping:   p.recordKeeping ? 'Yes (1)' : 'No (2)',
    // Part C — spouse
    married,
    spouseName: married ? dash(p.spouseName) : '—',
    spouseIdNo: married ? dash(p.spouseIdNo) : '—',
    spouseDob:  married ? dash(p.spouseDob) : '—',
    // Part D — other particulars
    phone: dash(p.phone),
    email: dash(p.email),
    correspondenceAddress: joinAddress([
      p.correspondenceAddress,
      [p.correspondencePostcode, p.correspondenceCity].filter(Boolean).join(' '),
      p.correspondenceState,
    ]) || '—',
    refundMethod: p.refundMethod === 'duitnow' ? 'DuitNow (2)' : 'Bank account (1)',
    bankName: dash(p.bankName),
    bankAccountNo: dash(p.bankAccountNo),
    hasForeignAccounts: p.hasForeignAccounts ? 'Yes (1)' : 'No (2)',
    rpgtDisposal: p.rpgtDisposal ? 'Yes (1)' : 'No (2)',
    // Part N — main business
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
  };
}