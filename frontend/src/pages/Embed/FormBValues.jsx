/**
 * FormBValues.jsx — copy-optimised Form B figures for the browser extension
 * side panel (route: /embed/formb).
 *
 * This is a THIN presentation layer. It reuses the exact same data path the
 * Generate Forms tab uses — getTaxProfileSummary + buildFormData (see
 * ../../data/formB.js) — so the numbers here always match the generated Form B
 * draft, and any taxonomy/cap change in the backend flows through automatically.
 *
 * What it adds on top:
 *   • a per-row "Copy" button, so each figure pastes straight into the matching
 *     LHDN e-Filing field in an adjacent browser tab;
 *   • a real LHDN field label next to every code, so there's no guessing where
 *     a value goes;
 *   • a search box + "hide empty" toggle, since the full form has dozens of
 *     lines and most users only need a handful at a time.
 */
import { useEffect, useMemo, useState } from 'react';
import { getPersonalDetails, getAllEntities, getTaxProfileSummary } from '../../services/api';
import { currentFilingYear, buildFormData, fmtAmt } from '../../data/formB';

// Static field definitions: [Form B code, label (string or (fd)=>string for
// a couple of dynamic labels), picker(fd), money=true].
//
// Rewrite (25 Jul 2026): this used to be a small hand-picked subset of
// fields (a handful of Part B/N lines) that had drifted out of sync with
// the real Generate Forms tab — most visibly, B33/B33i/B33ii/B33iii (Self
// Installments / CP500) were missing entirely, which is why searching "b33"
// here came up empty even though it's a real, populated field. Basic
// Particulars, and Parts A/C/D/G/M were missing altogether too.
//
// This now mirrors ManageProfile.jsx's <FormBDocument> section-for-section
// and code-for-code, reading from the exact same `fd` object it does (both
// ultimately come from the same buildFormData() call), so the two views can
// never show different figures for the same code. Deliberately excluded:
// Parts E, F, J, K, L — these are always-blank placeholder tables in
// FormBDocument too (no `fd` field backs them at all; see its own
// "not yet populated" footnote), so there is nothing there to ever copy.
// Reliefs (Part H) stay dynamic via fd.reliefItems below, since that
// already carries every populated H-line/sub-line with its real label —
// the same lookup FormBDocument's own hv(code) reads from.
const BASIC_PARTICULARS_DEFS = [
  ['1', 'Name (as per identification document)', (fd) => fd.name, false],
  ['2', 'Tax Identification No. (TIN)', (fd) => fd.tin, false],
  ['3', 'Identification no.', (fd) => fd.idNo, false],
  ['4', 'Current passport no.', (fd) => fd.passportNo, false],
  ['5', 'Passport no. registered with LHDNM', (fd) => fd.passportNoLhdnm, false],
];

const PART_A_DEFS = [
  ['A1', 'Citizen (country code)', (fd) => fd.citizen, false],
  ['A2', 'Gender', (fd) => fd.gender, false],
  ['A3', 'Date of birth', (fd) => fd.dob, false],
  ['A4', (fd, year) => `Status as at 31-12-${year}`, (fd) => fd.marital, false],
  ['A5', 'Date of marriage / divorce / demise', (fd) => fd.maritalEventDate, false],
  ['A6', 'Record-keeping', (fd) => fd.recordKeeping, false],
  ['A7', 'Type of assessment', (fd) => fd.assessment, false],
];

const PART_B_DEFS = [
  ['B1',  'Statutory income from businesses in Malaysia', (fd) => fd.b1, true],
  ['B1a', 'Number of businesses', (fd) => fd.entityCount, false],
  ['B4',  'Aggregate statutory income from businesses (B1 + B2 + B3)', (fd) => fd.b4, true],
  ['B6',  'TOTAL (B4 − B5)', (fd) => fd.b6, true],
  ['B7',  'Statutory income from employment in Malaysia', (fd) => fd.b7, true],
  ['B7a', 'Number of employments', (fd) => fd.b7aSuggestedCount, false],
  ['B8',  'Statutory income from rents in Malaysia', (fd) => fd.b8, true],
  ['B9',  'Interest, discounts, royalties, pensions & other income', (fd) => fd.b9, true],
  ['B11', 'AGGREGATE INCOME (B6 + B7 + B8 + B9 + B10)', (fd) => fd.b11, true],
  ['B13', 'TOTAL (B11 − B12)', (fd) => fd.b13, true],
  ['B14', 'LESS: Current year business losses', (fd) => fd.b14, true],
  ['B15', 'TOTAL (B13 − B14)', (fd) => fd.b15, true],
  ['B17', 'LESS: Approved donations / gifts / contributions (from G8)', (fd) => fd.donationsG8, true],
  ['B18', 'TOTAL (B15 − B16 − B17)', (fd) => fd.b18, true],
  ['B20', 'TOTAL INCOME [SELF] (B18 + B19)', (fd) => fd.b20, true],
  ['B21', 'Total income transferred from husband / wife for joint assessment', (fd) => fd.b21, true],
  ['B22', 'AGGREGATE OF TOTAL INCOME (B20 + B21)', (fd) => fd.b22, true],
  ['B23', 'Total relief (from H22)', (fd) => fd.b23, true],
  ['B24', 'CHARGEABLE INCOME', (fd) => fd.b24, true],
  ['B25a', (fd) => `Tax on the first RM${fmtAmt(fd.b25aLowerBoundMyr)}`, (fd) => fd.b25aTaxMyr, true],
  ['B25b', (fd) => `Tax on the balance RM${fmtAmt(fd.b25bAmountMyr)}, at rate ${fd.b25bRatePct}%`, (fd) => fd.b25bTaxMyr, true],
  ['B26', 'TOTAL INCOME TAX (B25a + B25b)', (fd) => fd.b26, true],
  ['B27i', 'Rebate — Self', (fd) => fd.lowIncomeRebate, true],
  ['B27ii', 'Rebate — Husband / Wife', (fd) => fd.spouseRebate, true],
  ['B27iii', 'Rebate — Departure levy (umrah / other religious travel)', (fd) => fd.departureLevyRebate, true],
  ['B27iv', 'Rebate — No. of trips', (fd) => fd.departureLevyTripsThisYear, false],
  ['B27v', 'Rebate — Zakat and fitrah', (fd) => fd.zakatRebate, true],
  ['B27', 'TOTAL REBATE', (fd) => fd.b27, true],
  ['B28', 'TOTAL TAX CHARGED (B26 − B27)', (fd) => fd.b28, true],
  ['B29', 'LESS: Section 110 tax deduction (others)', (fd) => fd.b29, true],
  ['B31', 'TAX PAYABLE [B28 − (B29 + B30)]', (fd) => fd.b31, true],
  ['B32', 'OR: TAX REPAYABLE [(B29 + B30) − B28]', (fd) => fd.b32, true],
  // B33 and its sub-lines (Self Installments / CP500) — previously missing
  // entirely, which is why "b33" turned up no results in this tab's search.
  ['B33i', 'Payment made — Monthly Tax Deductions (MTD)', (fd) => fd.mtdWithheld, true],
  ['B33ii', 'Payment made — Section 107D', (fd) => fd.section107d, true],
  ['B33iii', 'Payment made — Self installments / CP500', (fd) => fd.cp500Paid, true],
  ['B33', (fd, year) => `Payment made for ${year} income – SELF and HUSBAND / WIFE for joint assessment`, (fd) => fd.b33, true],
  ['B34', 'Balance of tax payable (B31 − B33) / Tax paid in excess', (fd) => Math.abs(fd.b34 || 0), true],
];

const PART_C_DEFS = [
  ['C1', 'Name of husband / wife', (fd) => fd.spouseName, false],
  ['C2', 'Identification no. (spouse)', (fd) => fd.spouseIdNo, false],
  ['C3', 'Date of birth (spouse)', (fd) => fd.spouseDob, false],
  ['C4', 'Passport no. (spouse)', (fd) => fd.spousePassportNo, false],
];

const PART_D_DEFS = [
  ['D1', 'Telephone no. / Handphone no.', (fd) => fd.phone, false],
  ['D2', 'E-mail', (fd) => fd.email, false],
  ['D3', "Employer's TIN", (fd) => fd.employerTin, false],
  ['D4', 'Tax borne by employer', (fd) => fd.taxBorneByEmployer, false],
  ['D5', 'Financial account(s) outside Malaysia', (fd) => fd.hasForeignAccounts, false],
  ['D6a', 'Carries on e-Commerce', (fd) => fd.carriesOnEcommerce, false],
  ['D6b', 'e-Commerce business model', (fd) => fd.ecommerceModel, false],
  ['D7', 'Address of business premise', (fd) => fd.businessAddress, false],
  ['D8', 'Correspondence address', (fd) => fd.correspondenceAddress, false],
  ['D9', 'Method of payment for tax refund', (fd) => fd.refundMethod, false],
  ['D10a', 'Name of bank', (fd) => fd.bankName, false],
  ['D10b', 'Bank account no.', (fd) => fd.bankAccountNo, false],
  ['D11a', 'DuitNow — identification type (self)', (fd) => fd.duitnowIdType, false],
  ['D11b', 'DuitNow — passport no. (if applicable)', (fd) => fd.duitnowPassportNo, false],
  ['D12a', 'Disposal of asset under RPGT Act 1976', (fd) => fd.rpgtDisposal, false],
  ['D12b', 'Disposal declared to LHDNM', (fd) => fd.disposalDeclared, false],
];

const PART_G_DEFS = [
  ['G1', 'Gift of money to Government / State Government / local authority', (fd) => fd.g1, true],
  ['G2a', 'Gift of money to approved institutions / organisations / funds', (fd) => fd.g2a, true],
  ['G2b', 'Gift of money for sports activity approved by the Minister of Finance', (fd) => fd.g2b, true],
  ['G2c', 'Gift of money / contribution in kind for a project of national interest', (fd) => fd.g2c, true],
  ['G2d', 'Gift of money — wakaf to religious body / endowment to public university', (fd) => fd.g2d, true],
  ['G2', 'Subtotal G2 (restricted to 10% of B11)', (fd) => fd.g2, true],
  ['G3', 'Gift of artefacts / manuscripts / paintings to the Government', (fd) => fd.g3, true],
  ['G4', 'Gift of money for library facilities (restricted to 20,000)', (fd) => fd.g4, true],
  ['G5', 'Gift for facilities in public places for disabled persons', (fd) => fd.g5, true],
  ['G6', 'Gift of medical equipment to an approved healthcare facility (restricted to 20,000)', (fd) => fd.g6, true],
  ['G7', 'Gift of paintings to the National Art Gallery / a state art gallery', (fd) => fd.g7, true],
  ['G8', 'Total approved donations / gifts / contributions (G1 to G7) → B17', (fd) => fd.donationsG8, true],
];

const PART_M_DEFS = [
  ['M2', 'Business capital allowances carried forward', (fd) => fd.m2UnabsorbedCapitalAllowanceMyr, true],
];

// Part N — identity fields are text; P&L and balance-sheet lines are money.
// N28-N50 (Statement of Financial Position) only ever carry a real figure
// once a Balance Sheet document has been uploaded and classified — same
// gating FormBDocument itself uses (fd.hasBalanceSheet) — otherwise there's
// genuinely nothing there yet, same as the real form shows blank.
const PART_N_DEFS = [
  ['N1', 'Name of business', (fd) => fd.businessName, false],
  ['N1a', 'Registration no.', (fd) => fd.businessRegNo, false],
  ['N2', 'Business code', (fd) => fd.businessCode, false],
  ['N2a', 'Type of business activity', (fd) => fd.businessActivity, false],
  ['N3', 'Sales or turnover', (fd) => fd.n3, true],
  ['N4', 'Opening inventory', (fd) => fd.n4, true],
  ['N5', 'Purchases and cost of production', (fd) => fd.n5, true],
  ['N6', 'Closing inventory', (fd) => fd.n6, true],
  ['N7', 'Cost of sales (N4 + N5 − N6)', (fd) => fd.n7, true],
  ['N8', 'GROSS PROFIT / LOSS (N3 − N7)', (fd) => fd.n8, true],
  ['N9', 'Other business(es)', (fd) => fd.n9, true],
  ['N10', 'Dividends', (fd) => fd.n10, true],
  ['N11', 'Interest and discounts', (fd) => fd.n11, true],
  ['N12', 'Rents, royalties and premiums', (fd) => fd.n12, true],
  ['N13', 'Other income', (fd) => fd.n13, true],
  ['N14', 'TOTAL (N9 to N13)', (fd) => fd.n14, true],
  ['N15', 'Loan interest', (fd) => fd.n15, true],
  ['N16', 'Salaries and wages', (fd) => fd.n16, true],
  ['N17', 'Rental / lease', (fd) => fd.n17, true],
  ['N18', 'Contract and subcontracts', (fd) => fd.n18, true],
  ['N19', 'Commissions', (fd) => fd.n19, true],
  ['N20', 'Bad debts', (fd) => fd.n20, true],
  ['N21', 'Travelling and transport', (fd) => fd.n21, true],
  ['N22', 'Repairs and maintenance', (fd) => fd.n22, true],
  ['N23', 'Promotion and advertisement', (fd) => fd.n23, true],
  ['N24', 'Other expenses', (fd) => fd.n24, true],
  ['N25', 'TOTAL EXPENDITURE (N15 to N24)', (fd) => fd.n25, true],
  ['N26', 'NET PROFIT / LOSS', (fd) => fd.n26, true],
  ['N27', 'Non-allowable expenses (apportioned / disallowed portion)', (fd) => fd.n27, true],
  ['', 'LESS: Capital allowance (Schedule 3, current-year IA + AA)', (fd) => fd.capitalAllowance, true],
  ['N28', 'Land and buildings', (fd) => fd.hasBalanceSheet ? fd.n28 : null, true],
  ['N29', 'Plant and machinery', (fd) => fd.hasBalanceSheet ? fd.n29 : null, true],
  ['N30', 'Motor vehicles', (fd) => fd.hasBalanceSheet ? fd.n30 : null, true],
  ['N31', 'Other non-current assets', (fd) => fd.hasBalanceSheet ? fd.n31 : null, true],
  ['N32', 'TOTAL NON-CURRENT ASSETS (N28 to N31)', (fd) => fd.hasBalanceSheet ? fd.n32 : null, true],
  ['N33', 'Investments', (fd) => fd.hasBalanceSheet ? fd.n33 : null, true],
  ['N34', 'Inventory', (fd) => fd.hasBalanceSheet ? fd.n34 : null, true],
  ['N35', 'Trade debtors', (fd) => fd.hasBalanceSheet ? fd.n35 : null, true],
  ['N36', 'Sundry debtors', (fd) => fd.hasBalanceSheet ? fd.n36 : null, true],
  ['N37', 'Cash in hand', (fd) => fd.hasBalanceSheet ? fd.n37 : null, true],
  ['N38', 'Cash at bank', (fd) => fd.hasBalanceSheet ? fd.n38 : null, true],
  ['N39', 'Other current assets', (fd) => fd.hasBalanceSheet ? fd.n39 : null, true],
  ['N40', 'TOTAL CURRENT ASSETS (N34 to N39)', (fd) => fd.hasBalanceSheet ? fd.n40 : null, true],
  ['N41', 'TOTAL ASSETS (N32 + N33 + N40)', (fd) => fd.hasBalanceSheet ? fd.n41 : null, true],
  ['N42', 'Loans and overdrafts', (fd) => fd.hasBalanceSheet ? fd.n42 : null, true],
  ['N43', 'Trade creditors', (fd) => fd.hasBalanceSheet ? fd.n43 : null, true],
  ['N44', 'Sundry creditors', (fd) => fd.hasBalanceSheet ? fd.n44 : null, true],
  ['N45', 'TOTAL LIABILITIES (N42 to N44)', (fd) => fd.hasBalanceSheet ? fd.n45 : null, true],
  ['N46', 'Capital account', (fd) => fd.hasBalanceSheet ? fd.n46 : null, true],
  ['N47', 'Current account balance brought forward', (fd) => fd.hasBalanceSheet ? fd.n47 : null, true],
  ['N48', 'Current year profit / loss', (fd) => fd.hasBalanceSheet ? fd.n48 : null, true],
  ['N49', 'Drawings / advance (Net)', (fd) => fd.hasBalanceSheet ? fd.n49 : null, true],
  ['N50', 'Current account balance carried forward', (fd) => fd.hasBalanceSheet ? fd.n50 : null, true],
];

function buildSections(fd, year) {
  const mk = (defs) => defs.map(([code, label, pick, money]) => ({
    code,
    label: typeof label === 'function' ? label(fd, year) : label,
    value: pick(fd),
    money: money !== false,
  }));
  const reliefRows = (fd.reliefItems || []).map(([code, label, amount]) => ({ code, label, value: amount, money: true }));
  return [
    { title: 'Basic Particulars',              rows: mk(BASIC_PARTICULARS_DEFS) },
    { title: 'Part A — Particulars of Individual', rows: mk(PART_A_DEFS) },
    { title: 'Part B — Computation of Income Tax', rows: mk(PART_B_DEFS) },
    { title: 'Part C — Particulars of Husband / Wife', rows: mk(PART_C_DEFS) },
    { title: 'Part D — Other Particulars',     rows: mk(PART_D_DEFS) },
    { title: 'Part G — Donations / Gifts / Contributions', rows: mk(PART_G_DEFS) },
    { title: 'Part H — Relief',                rows: reliefRows },
    { title: 'Part M — Carry-Forward',         rows: mk(PART_M_DEFS) },
    { title: 'Part N — Financial Particulars', rows: mk(PART_N_DEFS) },
  ];
}

// A genuine 0 (e.g. B27 rebate) is a real, COPYABLE figure — only null/blank
// count as "no value".
function hasValue(value) {
  return value !== null && value !== undefined && value !== '—'
    && !(typeof value === 'string' && value.trim() === '');
}
// "Empty" for the hide-empty filter is stricter: also treat a numeric 0 as
// empty, since a RM0 relief/expense line is effectively "not filled in".
function isBlankOrZero(value) {
  if (!hasValue(value)) return true;
  return Number(value) === 0;
}

// Legacy clipboard path: a hidden <textarea> + document.execCommand('copy').
// Works even when the async Clipboard API is refused — which happens in a
// cross-origin iframe unless the parent grants allow="clipboard-write" (see the
// extension's sidepanel.html). Returns true on success.
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}

function CopyRow({ code, label, value, money }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'copied' | 'failed'
  const [hovered, setHovered] = useState(false);
  const has = hasValue(value);
  const display = money ? (has ? `RM ${fmtAmt(value)}` : '—') : (has ? String(value) : '—');
  // Bare number for money fields (LHDN inputs reject "RM"/commas); plain string otherwise.
  const clip = money ? String(Math.round(Number(value) || 0)) : String(value ?? '');

  const flash = (s) => { setStatus(s); setTimeout(() => setStatus('idle'), 1400); };

  const copy = () => {
    if (!has) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clip)
        .then(() => flash('copied'))
        .catch(() => flash(legacyCopy(clip) ? 'copied' : 'failed'));
    } else {
      flash(legacyCopy(clip) ? 'copied' : 'failed');
    }
  };

  // Hover state matches the Chat tab's "New chat" button exactly
  // (hover:border-primary hover:text-primary — border and text switch to
  // the app's teal, background stays as-is). Only applies while idle and
  // with a real value: a disabled button, or one already flashing its own
  // copied/failed feedback color, shouldn't also react to hover.
  const isHoverable = has && status === 'idle';
  const btnColor = status === 'copied' ? '#0D9488' : status === 'failed' ? '#DC2626'
    : (isHoverable && hovered) ? '#0D9488' : '#64748B';
  const btnBorderColor = (isHoverable && hovered) ? '#0D9488' : '#E2E8F0';
  const btnLabel = status === 'copied' ? 'Copied' : status === 'failed' ? 'Failed' : 'Copy';

  return (
    <div style={S.row}>
      <div style={{ minWidth: 0 }}>
        <div style={S.rowLabel}>
          <span style={S.code}>{code}</span>
          <span style={S.labelText} title={label}>{label}</span>
        </div>
        <div style={{ ...S.value, color: has ? '#0F172A' : '#94A3B8' }}>{display}</div>
      </div>
      <button
        onClick={copy}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        disabled={!has}
        style={{ ...S.copyBtn, opacity: has ? 1 : 0.4, cursor: has ? 'pointer' : 'not-allowed', color: btnColor, borderColor: btnBorderColor }}
        title={has ? 'Copy value' : 'No value yet'}
      >
        {btnLabel}
      </button>
    </div>
  );
}

export default function FormBValues() {
  const [state, setState] = useState({ loading: true, error: null, fd: null });
  const [query, setQuery] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  const year = useMemo(() => currentFilingYear(), []);
  // Bumped to re-run the load effect below on demand (e.g. when the active
  // entity changes in another same-origin tab — see the storage listener
  // further down). A plain refetch() function reference wouldn't work as an
  // effect dependency by itself, so a counter is the simplest trigger.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const userId = localStorage.getItem('userId');
        const entityId = localStorage.getItem('activeEntityId') || null;
        if (!userId) throw new Error('Not logged in');

        const [profile, entities, taxSummary] = await Promise.all([
          getPersonalDetails(userId).catch(() => null),
          getAllEntities(userId).catch(() => []),
          getTaxProfileSummary(year, userId, entityId).catch(() => null),
        ]);
        if (cancelled) return;
        const fd = buildFormData(profile || {}, entities || [], taxSummary);
        setState({ loading: false, error: null, fd });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message, fd: null });
      }
    })();
    return () => { cancelled = true; };
  }, [year, reloadToken]);

  // Extension side panel fix: /embed/formb renders inside a same-origin
  // <iframe> in the browser extension's side panel, in a separate window/
  // document from the main app tab where the user actually edits things
  // (ManageAccount.jsx). That page notifies same-tab listeners via a
  // 'entitySwitch' CustomEvent on `window`, which — being scoped to that
  // one window — never reaches this iframe. Without this, the panel kept
  // showing stale Form B figures after an entity switch, or after any edit
  // in Manage Account (personal profile, business entity, child record),
  // until the panel was closed and reopened (forcing the iframe to reload
  // and re-read localStorage from scratch).
  //
  // The native `storage` event fires automatically in every OTHER
  // same-origin browsing context (other tabs, and same-origin iframes like
  // this one) whenever localStorage is written elsewhere — exactly the
  // main-tab → iframe direction needed here, with no extra plumbing. It
  // deliberately does not fire in the tab that made the write, which is
  // fine since that tab doesn't need to react to its own change. Same fix
  // as CukaiBot.jsx's entity-loading effect, applied here for the Form B
  // tab. Three keys are watched:
  //   - activeEntityId / userId — switching entity or account.
  //   - cukaiFormBDataUpdatedAt — a plain timestamp pulse ManageAccount.jsx
  //     writes from refetchTaxSummary() after ANY save that affects the tax
  //     computation (personal profile, entity create/save/delete, child
  //     create/save/delete all funnel through that one function). The value
  //     itself carries no meaning — only its change does — so editing, say,
  //     a business's registration number now refreshes this tab too, not
  //     just an entity switch.
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'activeEntityId' || e.key === 'userId' || e.key === 'cukaiFormBDataUpdatedAt') {
        setReloadToken((t) => t + 1);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Filter rows by search (code or label) and the hide-empty toggle. A search
  // query overrides hide-empty, so you can still find a specific zero field.
  const sections = useMemo(() => {
    if (!state.fd) return [];
    const q = query.trim().toLowerCase();
    return buildSections(state.fd, year)
      .map((section) => {
        const rows = section.rows.filter((r) => {
          const matches = !q || r.code.toLowerCase().includes(q) || r.label.toLowerCase().includes(q);
          if (!matches) return false;
          if (q) return true;                 // searching → show even empty/zero rows
          return hideEmpty ? !isBlankOrZero(r.value) : true;
        });
        return { ...section, rows };
      })
      .filter((section) => section.rows.length > 0);
  }, [state.fd, query, hideEmpty, year]);

  if (state.loading) return <div style={S.center}>Loading your Form B figures…</div>;
  // Standardized across both extension tabs — same heading, subtext, and
  // colors as App.jsx's EmbedLayout gate and CukaiBot.jsx's own equivalent
  // branch (see the comment there). This is the ONE message shown for a
  // logout, regardless of which of the app's three separate detection paths
  // (App.jsx's isAuthenticated flag, this page's own fresh localStorage
  // check below, or CukaiBot.jsx's `loggedIn` state) actually catches it.
  // A genuine non-auth failure (network error, etc.) still gets the plain
  // generic message beneath, since standardizing THAT would hide real
  // troubleshooting information behind a misleading "please log in" prompt.
  if (state.error === 'Not logged in') {
    return (
      <div style={S.loggedOut}>
        <div>
          <p style={S.loggedOutTitle}>Please log in first</p>
          Open the Cukai app in a browser tab and sign in to view your profile extension.
        </div>
      </div>
    );
  }
  if (state.error)   return <div style={S.center}>Couldn't load figures: {state.error}.<br />Make sure you're logged into the Cukai app.</div>;

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <p style={S.title}>Form B · YA{year}</p>
        <p style={S.sub}>Copy each value into the matching field on the LHDN e-Filing form.</p>
      </div>

      {/* Search + hide-empty controls (sticky so they stay reachable while scrolling) */}
      <div style={S.controls}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code or field (e.g. B7, relief, rent)…"
          style={S.search}
        />
        <label style={S.toggle}>
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide empty
        </label>
      </div>

      {sections.length === 0 ? (
        <div style={S.empty}>No fields match “{query.trim()}”.</div>
      ) : (
        sections.map((section) => (
          <div key={section.title} style={S.section}>
            <p style={S.sectionTitle}>{section.title}</p>
            {section.rows.map((r) => (
              <CopyRow key={r.code} code={r.code} label={r.label} value={r.value} money={r.money} />
            ))}
          </div>
        ))
      )}

      <p style={S.footnote}>
        These figures come from your uploaded documents and profile — the same
        calculation as the generated Form B draft. Always review before filing.
      </p>
    </div>
  );
}

// Inline styles (no Tailwind here — this route renders standalone in an iframe
// and shouldn't rely on the app's utility classes being present).
const S = {
  // #F7F6F2 matches the Cukai Bot tab's own background exactly — that page
  // uses Tailwind's `bg-background`, which resolves to this same hex via
  // index.css's --color-background theme variable. Kept as a literal value
  // here (not a CSS var) since this page renders standalone with no
  // Tailwind/theme setup of its own.
  wrap: { height: '100vh', overflowY: 'auto', background: '#F7F6F2', padding: '14px 12px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', boxSizing: 'border-box' },
  center: { display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, color: '#64748B', fontSize: 13, lineHeight: 1.5 },
  // Matches App.jsx's EmbedLayout gate / CukaiBot.jsx's equivalent branch
  // exactly — same navy background, neon teal heading, same copy.
  loggedOut: { display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: '#94A3B8', fontSize: 13, lineHeight: 1.6, background: '#0F172A' },
  loggedOutTitle: { fontWeight: 700, color: '#39FFD6', marginBottom: 6, fontSize: 14 },
  header: { marginBottom: 10 },
  title: { margin: 0, fontWeight: 700, fontSize: 15, color: '#0F172A' },
  sub: { margin: '3px 0 0', fontSize: 11.5, color: '#64748B', lineHeight: 1.4 },
  controls: { position: 'sticky', top: 0, zIndex: 1, background: '#F7F6F2', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 10px' },
  search: { flex: 1, minWidth: 0, padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 9, fontSize: 12.5, background: '#fff', color: '#0F172A', outline: 'none' },
  toggle: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748B', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' },
  empty: { textAlign: 'center', color: '#94A3B8', fontSize: 12, padding: '24px 8px' },
  section: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '6px 10px', marginBottom: 10 },
  sectionTitle: { margin: '4px 2px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 2px', borderTop: '1px solid #F1F5F9' },
  rowLabel: { display: 'flex', alignItems: 'baseline', gap: 6 },
  code: { fontSize: 10, fontWeight: 700, color: '#0D9488', fontFamily: 'ui-monospace, monospace', flexShrink: 0 },
  labelText: { fontSize: 12, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // Reduced one px from the chat tab's own title size (14px, matching
  // ChatHeaderTitle's `text-sm`) to fit more comfortably alongside the code
  // and label text on each row.
  value: { fontSize: 13, fontWeight: 700, marginTop: 1 },
  copyBtn: { flexShrink: 0, background: 'transparent', border: '1px solid #E2E8F0', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 600 },
  footnote: { fontSize: 10.5, color: '#94A3B8', lineHeight: 1.4, padding: '0 4px 8px' },
};