/**
 * FormBValues.jsx — compact, copy-optimised Form B figures for the browser
 * extension side panel (route: /embed/formb).
 *
 * This is a THIN presentation layer. It deliberately reuses the exact same
 * data path the Generate Forms tab uses — getTaxProfileSummary + buildFormData
 * (see ../../data/formB.js) — so the numbers shown here are guaranteed to match
 * the generated Form B draft, and any taxonomy/cap change in the backend flows
 * through automatically with no second implementation to keep in sync.
 *
 * The one job it adds on top: a per-row "Copy" button, so the user can paste
 * each figure straight into the corresponding field on the LHDN e-Filing
 * portal in an adjacent browser tab.
 */
import { useEffect, useMemo, useState } from 'react';
import { getPersonalDetails, getAllEntities, getTaxProfileSummary } from '../../services/api';
import { currentFilingYear, buildFormData, fmtAmt } from '../../data/formB';

// Which fields to surface, in filing order, grouped into the sections a user
// actually types into on e-Filing. Each entry: [Form B code, human label,
// picker(fd) -> raw value]. Kept as a flat curated list rather than dumping all
// ~50 N-lines — these are the headline figures that matter when filling the
// online form. `money` marks amount fields (rendered "RM ...", copied as a bare
// number LHDN's fields expect).
const SECTIONS = [
  {
    title: 'Income',
    rows: [
      ['B1',  'Statutory income from business', (fd) => fd.b1, true],
      ['B7',  'Statutory income from employment', (fd) => fd.b7, true],
      ['B11', 'Aggregate income', (fd) => fd.b11, true],
      ['B22', 'Total income (self)', (fd) => fd.totalIncome, true],
    ],
  },
  {
    title: 'Relief & chargeable income',
    rows: [
      ['B23', 'Total relief', (fd) => fd.reliefTotal, true],
      ['B24', 'Chargeable income', (fd) => fd.chargeableIncome, true],
    ],
  },
  {
    title: 'Tax',
    rows: [
      ['B26', 'Tax charged', (fd) => fd.taxCharged, true],
      ['B27', 'Rebate (zakat etc.)', (fd) => fd.rebate, true],
      ['B31', 'Tax payable', (fd) => fd.taxPayable, true],
    ],
  },
];

// Legacy clipboard path: a hidden <textarea> + document.execCommand('copy').
// This runs INSIDE the same iframe on a genuine user gesture, so it works even
// when the async Clipboard API is refused — which happens in a cross-origin
// iframe unless the parent grants allow="clipboard-write" (see the extension's
// sidepanel.html). Returns true on success.
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
  // 'idle' | 'copied' | 'failed'
  const [status, setStatus] = useState('idle');
  const has = value !== null && value !== undefined && value !== '—' && !(money && Number(value) === 0);
  const display = money ? (has ? `RM ${fmtAmt(value)}` : '—') : (has ? String(value) : '—');
  // What actually lands on the clipboard: the bare number for money fields
  // (LHDN inputs reject "RM"/commas), the plain string otherwise.
  const clip = money ? String(Math.round(Number(value) || 0)) : String(value ?? '');

  const flash = (s) => { setStatus(s); setTimeout(() => setStatus('idle'), 1400); };

  const copy = () => {
    if (!has) return;
    // Try the modern async API first; on rejection (or if it's unavailable),
    // fall back to the legacy execCommand path. Only show "Failed" if BOTH
    // paths fail — so the button never silently does nothing again.
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
          <span style={S.labelText}>{label}</span>
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

  if (state.loading) return <div style={S.center}>Loading your Form B figures…</div>;
  if (state.error)   return <div style={S.center}>Couldn't load figures: {state.error}.<br />Make sure you're logged into the Cukai app.</div>;

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <p style={S.title}>Form B figures · YA{year}</p>
        <p style={S.sub}>Copy each value into the matching field on the LHDN e-Filing form.</p>
      </div>
      {SECTIONS.map((section) => (
        <div key={section.title} style={S.section}>
          <p style={S.sectionTitle}>{section.title}</p>
          {section.rows.map(([code, label, pick, money]) => (
            <CopyRow key={code} code={code} label={label} value={pick(state.fd)} money={money} />
          ))}
        </div>
      ))}
      <p style={S.footnote}>
        These figures come from your uploaded documents and profile — the same
        calculation as the generated Form B draft. Always review before filing.
      </p>
    </div>
  );
}

// Inline styles (no Tailwind dependency here — this route renders standalone in
// an iframe and shouldn't rely on the app's utility classes being present).
const S = {
  wrap: { height: '100vh', overflowY: 'auto', background: '#F8FAFC', padding: '14px 12px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', boxSizing: 'border-box' },
  center: { display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, color: '#64748B', fontSize: 13, lineHeight: 1.5 },
  header: { marginBottom: 12 },
  title: { margin: 0, fontWeight: 700, fontSize: 15, color: '#0F172A' },
  sub: { margin: '3px 0 0', fontSize: 11.5, color: '#64748B', lineHeight: 1.4 },
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
