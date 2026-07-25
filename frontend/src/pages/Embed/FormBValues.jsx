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

// Static field definitions: [Form B code, LHDN field label, picker(fd)].
// Reliefs (Part H) are NOT listed here — they come dynamically from
// buildFormData's own reliefItems (which already carry each relief's real LHDN
// sub-line label + amount), so this view stays complete as the taxonomy grows.
const INCOME_DEFS = [
  ['B1',  'Statutory income from business',                (fd) => fd.b1],
  ['B7',  'Statutory income from employment',              (fd) => fd.b7],
  ['B8',  'Statutory income from rents',                   (fd) => fd.b8],
  ['B9',  'Interest, discounts, royalties & other income', (fd) => fd.b9],
  ['B11', 'Aggregate income',                              (fd) => fd.b11],
  ['B22', 'Total income (self)',                           (fd) => fd.b22],
];

const BUSINESS_DEFS = [
  ['N3',  'Sales / turnover',                 (fd) => fd.n3],
  ['N5',  'Purchases / cost of goods sold',   (fd) => fd.n5],
  ['N11', 'Business bank interest received',  (fd) => fd.n11],
  ['N15', 'Loan / financing interest',        (fd) => fd.n15],
  ['N16', 'Salaries, wages & staff costs',    (fd) => fd.n16],
  ['N17', 'Rental of business premises',      (fd) => fd.n17],
  ['N19', 'Commissions (CP58)',               (fd) => fd.n19],
  ['N21', 'Travelling & transport',           (fd) => fd.n21],
  ['N22', 'Repairs & maintenance',            (fd) => fd.n22],
  ['N23', 'Advertising & marketing',          (fd) => fd.n23],
  ['N24', 'Other expenses',                   (fd) => fd.n24],
];

const TAX_DEFS = [
  ['B23', 'Total relief',            (fd) => fd.reliefTotal],
  ['B24', 'Chargeable income',       (fd) => fd.chargeableIncome],
  ['B26', 'Tax charged',             (fd) => fd.taxCharged],
  ['B27', 'Total rebate (zakat, etc.)', (fd) => fd.rebate],
  ['B31', 'Tax payable',             (fd) => fd.taxPayable],
];

function buildSections(fd) {
  const mk = (defs) => defs.map(([code, label, pick]) => ({ code, label, value: pick(fd), money: true }));
  const reliefRows = (fd.reliefItems || []).map(([code, label, amount]) => ({ code, label, value: amount, money: true }));
  return [
    { title: 'Income — Part B',            rows: mk(INCOME_DEFS) },
    { title: 'Business P&L — Part N',      rows: mk(BUSINESS_DEFS) },
    { title: 'Reliefs — Part H',           rows: reliefRows },
    { title: 'Chargeable income & tax',    rows: mk(TAX_DEFS) },
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

  const btnColor = status === 'copied' ? '#0D9488' : status === 'failed' ? '#DC2626' : '#64748B';
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
        disabled={!has}
        style={{ ...S.copyBtn, opacity: has ? 1 : 0.4, cursor: has ? 'pointer' : 'not-allowed', color: btnColor }}
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
  }, [year]);

  // Filter rows by search (code or label) and the hide-empty toggle. A search
  // query overrides hide-empty, so you can still find a specific zero field.
  const sections = useMemo(() => {
    if (!state.fd) return [];
    const q = query.trim().toLowerCase();
    return buildSections(state.fd)
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
  }, [state.fd, query, hideEmpty]);

  if (state.loading) return <div style={S.center}>Loading your Form B figures…</div>;
  if (state.error)   return <div style={S.center}>Couldn't load figures: {state.error}.<br />Make sure you're logged into the Cukai app.</div>;

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <p style={S.title}>Form B figures · YA{year}</p>
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
  wrap: { height: '100vh', overflowY: 'auto', background: '#F8FAFC', padding: '14px 12px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', boxSizing: 'border-box' },
  center: { display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, color: '#64748B', fontSize: 13, lineHeight: 1.5 },
  header: { marginBottom: 10 },
  title: { margin: 0, fontWeight: 700, fontSize: 15, color: '#0F172A' },
  sub: { margin: '3px 0 0', fontSize: 11.5, color: '#64748B', lineHeight: 1.4 },
  controls: { position: 'sticky', top: 0, zIndex: 1, background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 10px' },
  search: { flex: 1, minWidth: 0, padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 9, fontSize: 12.5, background: '#fff', color: '#0F172A', outline: 'none' },
  toggle: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748B', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' },
  empty: { textAlign: 'center', color: '#94A3B8', fontSize: 12, padding: '24px 8px' },
  section: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '6px 10px', marginBottom: 10 },
  sectionTitle: { margin: '4px 2px 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 2px', borderTop: '1px solid #F1F5F9' },
  rowLabel: { display: 'flex', alignItems: 'baseline', gap: 6 },
  code: { fontSize: 10, fontWeight: 700, color: '#0D9488', fontFamily: 'ui-monospace, monospace', flexShrink: 0 },
  labelText: { fontSize: 12, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  value: { fontSize: 14, fontWeight: 700, marginTop: 1 },
  copyBtn: { flexShrink: 0, background: 'transparent', border: '1px solid #E2E8F0', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 600 },
  footnote: { fontSize: 10.5, color: '#94A3B8', lineHeight: 1.4, padding: '0 4px 8px' },
};
