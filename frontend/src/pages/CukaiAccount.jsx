import { useRef, useState, useCallback, useEffect } from 'react';
import * as API from '../services/api';
// ─── Design tokens (matches ManageAccount + UserNavigation) ───────────────────
// Design tokens: use text-primary/bg-primary (#0D9488), text-headings, text-muted, border-border — see design-system.md §4

// Broadcast that the document set changed on the backend (upload classified,
// manual entry, delete, reclassify, reset, archive, retry) so other pages —
// chiefly the AI Insights inbox — know to refresh. Same window-event pattern
// as ManageAccount's 'entitySwitch'. The sessionStorage timestamp covers the
// cross-page case: InsightsInbox may MOUNT after the event already fired
// (upload here → navigate there), so it checks the timestamp on mount too.
const notifyDocumentsChanged = () => {
  sessionStorage.setItem('documentsChangedAt', String(Date.now()));
  window.dispatchEvent(new Event('documentsChanged'));
};

// ─── Backend category taxonomy (mirrors pipeline.py exactly) ─────────────────
const Q1_CATEGORIES = [
  'Q1 — Sales & Service Revenue',
  'Q1 — Business Bank Interest',
  'Q1 — Capital Gains (s.4aa)',
  'Q1 — SST-02 Sales Tax Return',
  'Q1 — Financial Statements (P&L)',
  'Q1 — Financial Statements (BS)',
  'Q1 — e-Invoice / LHDN Validated',
  'Q1 — Filed Form B (Prior Year)',
];
const Q2_CATEGORIES = [
  'Q2 — Employment Income (s.4b)',
  'Q2 — Passive Rental Income (s.4d)',
  'Q2 — Royalty Income (s.4d)',
  'Q2 — Dividend Income (s.4c)',
  'Q2 — Investment Interest (s.4c)',
  'Q2 — Pension & Annuity (s.4e)',
  'Q2 — Casual & Other Income (s.4f)',
  'Q2 — Foreign-Source Income (FSI)',
];
const Q3_CATEGORIES = [
  'Q3 — Cost of Goods Sold',
  'Q3 — Payroll & Statutory Contributions',
  'Q3 — Business Premises Rent',
  'Q3 — Business Utilities',
  'Q3 — Marketing & Advertising',
  'Q3 — Professional & Legal Fees',
  'Q3 — Transport & Logistics',
  'Q3 — Office & Admin Supplies',
  'Q3 — Business Insurance',
  'Q3 — Staff Welfare & Benefits',
  'Q3 — Business Loan Interest',
  'Q3 — Revenue Repairs & Maintenance',
  'Q3 — CP58 Agent Commission',
  'Q3 — CP500 / Tax Installment',
  'Q3 — Client Entertainment (50% cap)',
  'Q3 — Client & Corporate Gifts',
  'Q3 — Mixed-Use Vehicle Expenses',
  'Q3 — Capital Assets & Equipment',
  'Q3 — Capital Renovation & Fit-Out',
  'Q3 — Hire Purchase & Leased Assets',
];
const Q4_RELIEF_CATEGORIES = [
  'Q4 — Life Insurance & Takaful Relief',
  'Q4 — EPF Personal Contribution',
  'Q4 — Parent Medical Care',
  'Q4 — Self/Spouse/Child Medical',
  'Q4 — Lifestyle Relief',
  'Q4 — Education Relief',
  'Q4 — Upskilling / Self-Enhancement Course',
  'Q4 — Childcare Fees',
  'Q4 — SSPN Net Deposit',
  'Q4 — Medical Equipment Relief',
  'Q4 — Private Retirement Scheme (PRS)',
  'Q4 — SOCSO Personal Contribution',
  'Q4 — Domestic Tourism Relief',
  'Q4 — EV Charging Equipment',
  'Q4 — Education & Medical Insurance',
  'Q4 — Sports & Fitness Relief',
  'Q4 — Breastfeeding Equipment',
  'Q4 — Zakat',
];
// Donations (Part G) — kept SEPARATE from Q4_RELIEF_CATEGORIES (Phase 5, 14
// Jul 2026 fix): a donation is not a personal relief (status 'relief') at
// all, it's deducted from aggregate income before chargeable income is
// derived — folding these into the relief list would have misclassified
// every reclassify-to-donation action with the wrong status. Split into the
// 10 real G-line categories since they're subject to different caps: G1/
// G2a-d share a combined 10%-of-B11 pool; G4/G6 each have their own
// RM20,000 cap; G3/G5/G7 are uncapped. See pipeline.py / main.py.
const Q4_DONATION_CATEGORIES = [
  'Q4 — Donation: Government/Local Authority',
  'Q4 — Donation: Approved Institution',
  'Q4 — Donation: Approved Sports Activity',
  'Q4 — Donation: National Interest Project',
  'Q4 — Donation: Wakaf/Endowment',
  'Q4 — Donation: Artefacts to Government',
  'Q4 — Donation: Library Facilities',
  'Q4 — Donation: Disabled Facilities',
  'Q4 — Donation: Medical Equipment',
  'Q4 — Donation: Paintings to Art Gallery',
];
const Q4_NON_DED_CATEGORIES = [
  'Q4 — Personal Living Expenses',
  'Q4 — Personal Travel & Leisure',
  'Q4 — Personal Dining & Entertainment',
  'Q4 — Personal Shopping',
  'Q4 — Personal Medical Expenses',
  'Q4 — Family & Childcare Expenses',
];

// Summary / reference documents that describe or reconcile the return rather
// than contributing a line-item amount to any quadrant total (P&L, balance
// sheet, prior Form B, CP500 installment tracking). Their values are unchanged
// — this only regroups them for display so they don't read as "Business Income".
const REFERENCE_CATEGORIES = [
  'Q1 — Financial Statements (P&L)',
  'Q1 — Financial Statements (BS)',
  'Q1 — Filed Form B (Prior Year)',
  'Q3 — CP500 / Tax Installment',
];
const Q1_INCOME_CATEGORIES = Q1_CATEGORIES.filter(c => !REFERENCE_CATEGORIES.includes(c));
const Q3_EXPENSE_CATEGORIES = Q3_CATEGORIES.filter(c => !REFERENCE_CATEGORIES.includes(c));

// Part J (127(3)(b) incentive claims) was removed by product decision (14
// Jul 2026) — out of scope going forward. The two categories that used to
// live here ("J1 — Secretarial & Tax Filing Fee", "J1 — Franchise Fee
// (Pre-Commencement)") no longer exist on the backend; a company-secretary/
// tax-agent invoice now reclassifies to the ordinary
// "Q3 — Professional & Legal Fees" category instead. See form-b-roadmap.md.

// For the reclassify modal — grouped for the dropdown (friendly labels, no Q-prefix)
const RECLASSIFY_GROUPS = [
  { label: 'Business Income',                 cats: Q1_INCOME_CATEGORIES },
  { label: 'Personal Income',                 cats: Q2_CATEGORIES },
  { label: 'Business Expense',                cats: Q3_EXPENSE_CATEGORIES },
  { label: 'Personal Relief',                 cats: Q4_RELIEF_CATEGORIES },
  { label: 'Donations (Part G)',              cats: Q4_DONATION_CATEGORIES },
  { label: 'Personal Expense (Non-deductible)', cats: Q4_NON_DED_CATEGORIES },
  { label: 'Reference & Reconciliation',      cats: REFERENCE_CATEGORIES },
];

// Apportioned Q3 categories are only PARTIALLY deductible. Each carries a
// deductible % that the backend uses to sum only that portion into the
// deduction total. Mirrors APPORTIONED_CATEGORIES in pipeline.py.
//   mode 'statutory' — fixed by law, shown locked (entertainment s.39(1)(l) = 50%)
//   mode 'default'   — a sensible default the user may override
//   mode 'required'  — no default; the user must enter it before confirming
const APPORTIONED_META = {
  'Q3 — Client Entertainment (50% cap)': {
    mode: 'statutory', default: 50,
    hint: 'Client entertainment is 50% deductible under s.39(1)(l).',
  },
  'Q3 — Client & Corporate Gifts': {
    mode: 'default', default: 50,
    hint: 'Business gifts are usually 50% deductible — enter 100% if they carry your business logo.',
  },
  'Q3 — Mixed-Use Vehicle Expenses': {
    mode: 'required', default: null,
    hint: 'Enter the business-use % of this vehicle expense (personal use is not deductible).',
  },
  'Q3 — Hire Purchase & Leased Assets': {
    mode: 'required', default: null,
    hint: 'Enter the deductible % — the interest portion of the total is deductible, the principal is not.',
  },
};

// Display label for a stored category value: strip the "Qn — " prefix (users
// don't think in quadrants) and rename the review category to "Pending Review".
// The stored value is never changed — only what the user sees.
function categoryLabel(cat) {
  if (!cat || cat === 'Unclassified') return 'Unclassified';
  if (cat === 'Mixed / Pending Review') return 'Pending Review';
  if (cat === 'Non-Tax Document') return 'Non-Tax Document';
  if (cat === 'Bank Statement — Transaction Ledger') return 'Bank Statement';
  return cat.replace(/^Q[1-4]\s*[—-]\s*/, '');
}

// ─── Status meta ──────────────────────────────────────────────────────────────
const STATUS_META = {
  income:         { label: 'Income',          color: '#0369A1', bg: '#EFF6FF', dot: '#0369A1' },
  deductible:     { label: 'Deductible',      color: '#0D9488', bg: '#ECFDF5', dot: '#0D9488' },
  mixed:          { label: 'Needs Review',    color: '#B45309', bg: '#FFFBEB', dot: '#F59E0B' },
  relief:         { label: 'Relief',          color: '#7C3AED', bg: '#F5F3FF', dot: '#7C3AED' },
  donation:       { label: 'Donation',        color: '#0F6E56', bg: '#E1F5EE', dot: '#0F6E56' },
  non_deductible: { label: 'Personal',        color: '#DC2626', bg: '#FEF2F2', dot: '#DC2626' },
  capital:        { label: 'Capital Asset',   color: '#9A3412', bg: '#FFEDD5', dot: '#F97316' },
  not_applicable: { label: 'Not Applicable',  color: '#64748B', bg: '#F1F5F9', dot: '#94A3B8' },
  reference:      { label: 'Reference',       color: '#0E7490', bg: '#ECFEFF', dot: '#06B6D4' },
  pending:        { label: 'Uploading…',      color: '#64748B', bg: '#F8FAFC', dot: '#CBD5E1' },
  processing:     { label: 'Classifying…',   color: '#0369A1', bg: '#EFF6FF', dot: '#0369A1' },
  failed:         { label: 'Failed',          color: '#DC2626', bg: '#FEF2F2', dot: '#DC2626' },
  archived:       { label: 'Archived',        color: '#64748B', bg: '#F1F5F9', dot: '#94A3B8' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseAmt = (s) => parseFloat((s || '').replace(/[^\d.]/g, '')) || 0;
const fmtRM = (v) => 'RM ' + Number(v).toLocaleString('en-MY', { maximumFractionDigits: 0 });
// ─── Status badge ─────────────────────────────────────────────────────────────
// ─── Date formatting ────────────────────────────────────────────────────────────
// Documents can have a full day-precision date, or no usable date at all (when
// OCR/the LLM couldn't extract one, or only captured a partial month/year —
// see normalize_date() in the backend pipeline). Rather than guessing at a
// display format for partial precision, we show a complete date when we have
// one and an em dash otherwise — exactly mirroring how `amount` is handled —
// and let the user fill in the date manually via the reclassify modal,
// the same way they can for amount.
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDocDate(date, precision) {
  if (precision === 'day' && typeof date === 'string') {
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const [, y, mo, d] = m;
      const monthIdx = parseInt(mo, 10) - 1;
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${parseInt(d, 10)} ${MONTH_SHORT[monthIdx]} ${y}`;
      }
    }
  }
  return '—';
}

function mapApiDoc(apiDoc) {
  const ed = apiDoc.extractedData || {};
  // Treat anything other than an explicit, well-formed day-precision date as
  // "not captured" for display purposes — partial (month/year-only) dates
  // are still stored for record-keeping but aren't shown as if they were a
  // full date.
  const datePrecision = ed.date_precision === 'day' ? 'day' : 'unknown';

  // Amount is stored inconsistently across paths: OCR may yield "RM 1,240.00"
  // (string) while a user edit is persisted as a bare float (1240). Normalise
  // to a single numeric value + one formatted display string here so the "RM"
  // prefix is never lost on reload and sorting has a real number to work with.
  let amountNumber = null;
  if (typeof ed.amount === 'number') amountNumber = ed.amount;
  else if (typeof ed.amount === 'string' && /\d/.test(ed.amount)) amountNumber = parseAmt(ed.amount);

  // A null category means "not classified yet" (pending/processing/failed) — it
  // is NOT the LLM's genuine "Mixed / Pending Review" escape hatch. Don't
  // conflate them, or every in-flight/failed doc looks like a review item.
  const aggregationState = apiDoc.aggregationState || ed.aggregation_state || null;
  const documentRole     = apiDoc.documentRole     || ed.document_role     || null;

  // Which fields did the LLM actually capture? Editing is later restricted to
  // the ones it COULDN'T. Read from the original snapshot when the doc has been
  // edited, otherwise from the current extraction (which is the LLM's output).
  const orig = ed._original || ed;
  const origAmount = (typeof orig.amount === 'number')
    ? orig.amount
    : (typeof orig.amount === 'string' && /\d/.test(orig.amount) ? parseAmt(orig.amount) : null);
  const llmAmountCaptured = origAmount != null;
  const llmDateCaptured = orig.date_precision === 'day' && !!orig.date;
  const llmCategoryDecided = !!orig.category
    && orig.category !== 'Mixed / Pending Review'
    && orig.aggregation_state !== 'needs_user_confirmation'
    && orig.aggregation_state !== 'needs_apportionment';
  const edited = !!ed.user_reclassified;

  return {
    id:           apiDoc.id,
    name:         apiDoc.fileName,
    type:         apiDoc.documentType || 'Unclassified',
    date:         ed.date || null,                 // canonical value when day-precision; otherwise raw partial/null
    datePrecision,
    dateDisplay:  formatDocDate(ed.date, datePrecision),
    dateSortKey:  datePrecision === 'day' ? ed.date : null,
    amount:       amountNumber != null ? fmtRM(amountNumber) : '—',
    amountNumber,                                  // numeric companion for sorting / re-edit prefill
    status:       apiDoc.status,           // 'pending'|'processing'|'completed'|'failed'|'archived'
    taxStatus:    apiDoc.taxStatus,       // 'income'|'deductible'|'mixed'|'relief'|'non_deductible'|'not_applicable'|'capital'
    category:     apiDoc.category || 'Unclassified',
    documentRole,
    aggregationState,
    deductiblePct: ed.deductible_pct ?? null,   // apportioned Q3 categories only
    llmAmountCaptured,
    llmDateCaptured,
    llmCategoryDecided,
    edited,
    // A document needs the user's input when the backend's aggregation gate says
    // so (needs apportionment / confirmation) — the single source of truth,
    // shared with the overview's pending-review count. A 'mixed' status alone no
    // longer forces review: an apportioned category the user has confirmed is
    // 'resolved' and must leave the queue. Only fall back to the mixed-status
    // signal for legacy docs that predate aggregation_state.
    needsReview:  aggregationState
      ? (aggregationState === 'needs_apportionment' || aggregationState === 'needs_user_confirmation')
      : (apiDoc.taxStatus === 'mixed'),
    manual:       !!ed.manual_entry,
    accent:       STATUS_META[badgeStatusFor(apiDoc.category, apiDoc.taxStatus, apiDoc.status)]?.color || '#64748B',
    quadrant:     ed.quadrant,
    ita_section:  ed.ita_section,
    vendor:       ed.vendor,
    vendor_addr:  ed.vendor_addr,
    doc_no:       ed.doc_no,
    note:         ed.note,
    reason:       ed.reason,
    question:     ed.question,
    source:       ed.source,
    confidence:   ed.confidence ?? null,
    ocr_quality:  ed.ocr_quality,
    lineItems:    ed.line_items || [],
    asset_class:  ed.asset_class,
    ia_rate_pct:  ed.ia_rate_pct,
    aa_rate_pct:  ed.aa_rate_pct,
    relief_cap:   ed.relief_cap_myr,
    fileBasename: apiDoc.fileBasename || null,      // server-served preview URL basename
    // Kept for preview renderer
    fileType:     /\.(jpg|jpeg|png|webp|tiff?)$/i.test(apiDoc.fileName) ? 'image'
                : /\.(xlsx?|csv)$/i.test(apiDoc.fileName) ? 'excel'
                : 'pdf',
    _apiRaw: apiDoc,  // full record for debugging
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD PROGRESS ROW TRACKING
// Each newly uploaded file gets a transient "upload entry" that lives in local
// state and drives the animated loading bar while the pipeline runs. Once the
// backend resolves (completed / failed) we merge it into the main docs list.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Individual upload progress row ───────────────────────────────────────────
// Purely visual: animates a progress bar while the parent polls the backend.
// The parent (CukaiAccount) drives the lifecycle via `entry.phase`:
//   'uploading'  → file is being POSTed
//   'processing' → pipeline is running (docId acquired)
//   'done'       → pipeline completed (row will disappear shortly)
//   'failed'     → pipeline failed
function UploadProgressEntry({ entry }) {
  // Initialise from the current phase so a doc that's already processing (e.g.
  // after a tab switch / reload) starts the bar near where it actually is,
  // rather than snapping back to the beginning each time the page remounts.
  const phaseFloor = (ph) => (ph === 'done' || ph === 'failed') ? 100 : ph === 'processing' ? 65 : 8;
  const [progress, setProgress] = useState(() => phaseFloor(entry.phase));

  // Smooth progress animation capped at phase-appropriate ceiling
  useEffect(() => {
    const phase = entry.phase || 'uploading';
    if (phase === 'done' || phase === 'failed') {
      setProgress(phase === 'done' ? 100 : 100);
      return;
    }
    const MAX  = phase === 'uploading' ? 30 : 85;
    const STEP = phase === 'uploading' ? 8  : 2;
    const MS   = phase === 'uploading' ? 120 : 600;
    if (progress >= MAX) return;
    const t = setTimeout(() => setProgress(p => Math.min(p + STEP, MAX)), MS);
    return () => clearTimeout(t);
  }, [progress, entry.phase]);

  // Jump progress forward when docId appears (upload POST returned)
  useEffect(() => {
    if (entry.docId && (entry.phase === 'uploading' || !entry.phase)) {
      setProgress(32);
    }
  }, [entry.docId, entry.phase]);

  const phase = entry.phase || 'uploading';
  const barColor = phase === 'failed' ? '#DC2626'
    : phase === 'done' ? '#0D9488'
    : phase === 'processing' ? '#0369A1'
    : '#94A3B8';

  const phaseLabel = phase === 'uploading' ? 'Uploading…'
    : phase === 'processing' ? 'Classifying with AI…'
    : phase === 'done' ? 'Done'
    : 'Failed';

  return (
    <tr className="border-b border-[#F1F5F9] bg-[#FAFBFC]">
      <td className="py-3 pl-4 pr-3" colSpan={3}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-7 w-7 shrink-0 rounded-lg flex items-center justify-center bg-[#F1F5F9] text-[#94A3B8]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-headings truncate">{entry.fileName}</p>
            <div className="mt-1.5 h-1 w-full rounded-full bg-border overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${progress}%`, background: barColor, transition: 'width 0.4s ease' }}
              />
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3" colSpan={3}>
        <div className="flex items-center justify-end gap-2">
          {(phase === 'uploading' || phase === 'processing') && (
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: barColor }}>
              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: barColor }} />
              {phaseLabel}
            </span>
          )}
          {phase === 'done' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-primary font-semibold">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Classified
            </span>
          )}
          {phase === 'failed' && (
            <span className="text-[1px] text-critical font-semibold">Failed — check file</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
// Reference / reconciliation documents (P&L, balance sheet, prior Form B,
// CP500) don't contribute to any total, so they shouldn't wear an Income /
// Not-Applicable badge — they get their own neutral "Reference" tag instead.
function badgeStatusFor(category, taxStatus, pipelineStatus) {
  if (category && REFERENCE_CATEGORIES.includes(category)) return 'reference';
  return taxStatus || pipelineStatus;
}

function StatusBadge({ status }) {
  // For completed docs show the tax_status; for in-flight show pipeline status
  const key = status || 'mixed';
  const m = STATUS_META[key] || STATUS_META.mixed;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
      style={{ background: m.bg, color: m.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

// ─── Confidence badge ─────────────────────────────────────────────────────────
function ConfidenceBadge({ value }) {
  if (value === null || value === undefined) return null;
  // Maps 1:1 onto the design system's success/warning/critical tiers (§4) —
  // uses semantic classes instead of inline hex now that all three tiers
  // have a documented token equivalent.
  const tone = value >= 90 ? 'bg-success-bg text-success' : value >= 70 ? 'bg-warning-bg text-warning' : 'bg-critical-bg text-critical';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      {value}%
    </span>
  );
}

// ─── File Preview — real file rendering ───────────────────────────────────────
// Renders the actual uploaded file using browser-native mechanisms:
//   PDF   → <embed> (browser PDF renderer)
//   Image → <img>
//   Excel/CSV → SpreadsheetTable (on structured data) or iframe
function FilePreviewRenderer({ doc, fileUrl }) {
  // Manually-entered documents are backed by a plain-text receipt on the
  // server (so the record persists like any other), but that .txt file
  // isn't meant for browser preview — always render the structured canvas
  // receipt for these instead.
  if (doc.manual && doc.lineItems && doc.lineItems.length > 0) {
    return <DocumentCanvas doc={doc} />;
  }

  if (!fileUrl) {
    // Fallback canvas renderer for any other doc with structured line items
    // but no resolvable file URL (e.g. file moved/missing server-side).
    if (doc.lineItems && doc.lineItems.length > 0) {
      return <DocumentCanvas doc={doc} />;
    }
    return (
      <div className="flex h-full items-center justify-center text-center p-8">
        <div>
          <svg className="mx-auto mb-3 h-12 w-12 text-[#CBD5E1]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <p className="text-xs text-[#94A3B8]">File preview not available.</p>
          <p className="text-[10px] text-[#CBD5E1] mt-1">The original file may have been moved or the server is offline.</p>
        </div>
      </div>
    );
  }

  if (doc.fileType === 'pdf') {
    return (
      <embed
        src={fileUrl}
        type="application/pdf"
        className="w-full h-full"
        title={doc.name}
      />
    );
  }

  if (doc.fileType === 'image') {
    return (
      <div className="flex h-full items-center justify-center bg-[#E8EBEF] p-4">
        <img
          src={fileUrl}
          alt={doc.name}
          className="max-h-full max-w-full object-contain rounded-lg shadow-xl border border-border"
          onError={e => { e.target.style.display = 'none'; }}
        />
      </div>
    );
  }

  if (doc.fileType === 'excel') {
    // If we have structured rows from a manual doc, render them
    if (doc.sheetRows) return <SpreadsheetTable rows={doc.sheetRows} />;
    // Otherwise show download link (browser can't natively render xlsx)
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <svg className="mx-auto mb-3 h-12 w-12 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
          </svg>
          <p className="text-xs font-medium text-headings">{doc.name}</p>
          <p className="text-[10px] text-muted mt-1">Spreadsheet files cannot be previewed in-browser.</p>
          <a href={fileUrl} download={doc.name}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover transition-colors duration-150">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download to view
          </a>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Document Preview slide-over ──────────────────────────────────────────────
function DocumentPreview({ doc, onClose, onReclassify, onArchive, onUnarchive, onDelete }) {
  const [visible, setVisible] = useState(false);
  const [fileUrl, setFileUrl] = useState(null);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  // Build a URL to the file served by the backend's /files/ static mount.
  // Prefer the server-provided basename (available for every persisted doc) so
  // the preview works after a retry or a full page reload — not only while the
  // original session blob is still around.
  useEffect(() => {
    if (!doc) return;
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    const basename = doc.fileBasename
      || doc._apiRaw?.fileBasename
      || (doc._apiRaw?.file_path ? doc._apiRaw.file_path.split(/[\\/]/).pop() : null);
    if (basename) {
      setFileUrl(`${API_URL}/files/${encodeURIComponent(basename)}`);
    } else if (doc._localObjectUrl) {
      // Fallback: blob URL created at upload time — still valid this session.
      setFileUrl(doc._localObjectUrl);
    }
    // No cleanup needed: backend URLs don't need revocation; blob URLs are
    // revoked when the parent upload entry is cleared.
  }, [doc?.fileBasename, doc?._apiRaw?.file_path, doc?._localObjectUrl]);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 300); };

  const isMixed = doc.taxStatus === 'mixed' || doc.status === 'mixed';
  const isPipeline = doc.status === 'pending' || doc.status === 'processing';

  return (
    <div className="fixed inset-0 z-50 flex" onClick={handleClose}>
      <div className={`flex-1 bg-black/40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`relative flex h-full w-[640px] max-w-full flex-col bg-surface shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3 bg-[#F8FAFC] shrink-0">
          <div className="min-w-0">
            <p className="text-base font-bold text-headings truncate">{doc.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-muted">{doc.type || 'Document'}</p>
              {doc.dateDisplay && <><span className="text-[#CBD5E1]">·</span><p className="text-xs text-muted">{doc.dateDisplay}</p></>}
              {doc.ocr_quality && doc.ocr_quality !== 'good' && (
                <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning border border-warning/30">
                  OCR: {doc.ocr_quality}
                </span>
              )}
            </div>
          </div>
          <button onClick={handleClose} className="text-[#94A3B8] hover:text-headings transition-colors shrink-0 ml-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* File preview area */}
        <div className="flex-1 min-h-0 overflow-hidden bg-[#E8EBEF]">
          {isPipeline ? (
            <div className="flex h-full items-center justify-center flex-col gap-3 p-8 text-center">
              <div className="h-10 w-10 rounded-full border-4 border-[#0369A1] border-t-transparent animate-spin" />
              <p className="text-sm font-medium text-headings">AI is reading your document…</p>
              <p className="text-xs text-muted">Classification usually takes 15–45 seconds depending on file complexity.</p>
            </div>
          ) : (
            <div className="h-full overflow-auto">
              <FilePreviewRenderer doc={doc} fileUrl={fileUrl} />
            </div>
          )}
        </div>

        {/* Classification footer */}
        <div className="shrink-0 border-t border-border bg-surface px-5 py-4 space-y-3">
          {/* Status + confidence row */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Classification</span>
            <div className="flex items-center gap-2">
              <ConfidenceBadge value={doc.confidence} />
              <StatusBadge status={badgeStatusFor(doc.category, doc.taxStatus, doc.status)} />
            </div>
          </div>

          {/* Category */}
          {doc.category && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Category</span>
              <span className="text-xs font-medium text-headings text-right max-w-[260px] truncate">{categoryLabel(doc.category)}</span>
            </div>
          )}

          {/* ITA section */}
          {doc.ita_section && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">ITA Reference</span>
              <span className="text-xs font-mono text-[#0369A1]">{doc.ita_section}</span>
            </div>
          )}

          {/* Amount */}
          {doc.amount && doc.amount !== '—' && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Amount</span>
              <span className="text-sm font-bold text-headings">{doc.amount}</span>
            </div>
          )}

          {/* AI note */}
          {doc.note && (
            <div className="rounded-lg bg-[#F8FAFC] border border-border px-3 py-2">
              <p className="text-xs font-bold text-muted uppercase tracking-wider mb-0.5">AI Note</p>
              <p className="text-xs text-[#334155] leading-relaxed">{doc.note}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            {isMixed && !isPipeline && (
              <button onClick={() => { handleClose(); onReclassify(doc); }}
                className="flex-1 rounded-lg bg-warning px-3 py-2 text-sm font-semibold text-white hover:bg-warning/85 transition-colors duration-150">
                Review &amp; Classify
              </button>
            )}
            {!isMixed && !isPipeline && doc.status !== 'archived' && (
              <button onClick={() => { handleClose(); onReclassify(doc); }}
                className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-muted hover:border-primary hover:text-primary transition-colors duration-150">
                Re-classify
              </button>
            )}
            {/* Archive is unavailable while a document still needs review —
                use doc.needsReview (the aggregation-gate signal), not the
                narrower isMixed/taxStatus check, so this always matches the
                backend's own guard on the archive endpoint exactly. */}
            {doc.status !== 'archived' && !isPipeline && !doc.needsReview && (
              <button onClick={() => { handleClose(); onArchive(doc.id); }}
                className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-muted hover:border-muted transition-colors duration-150"
                title="Archive">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
                </svg>
              </button>
            )}
            {doc.status === 'archived' && (
              <button onClick={() => { handleClose(); onUnarchive(doc.id); }}
                className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-muted hover:border-primary hover:text-primary transition-colors duration-150"
                title="Unarchive — move back to the main document list">
                <span className="inline-flex items-center gap-1.5">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="14" y1="15" x2="10" y2="15"/><polyline points="9 12 12 9 15 12"/><line x1="12" y1="9" x2="12" y2="16"/>
                  </svg>
                  Unarchive
                </span>
              </button>
            )}
            <button onClick={() => { handleClose(); onDelete(doc.id); }}
              className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-critical/60 hover:border-critical hover:text-critical transition-colors duration-150"
              title="Delete">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reclassify Modal ─────────────────────────────────────────────────────────
// Shows AI reasoning (note, reason, question, source) with a category picker.
// Handles both "mixed" (undecided) and "re-classify" (override confirmed) modes.
function ReclassifyModal({ doc, onConfirm, onReset, onCancel }) {
  const isMixed = doc.taxStatus === 'mixed' || doc.status === 'mixed';
  const amountMissing = !doc.amount || doc.amount === '—';
  const dateMissing = !doc.dateDisplay || doc.dateDisplay === '—';

  // Amount/date are only meaningful for transaction-like documents. A balance
  // sheet / P&L / prior Form B (summary_statement) or a bank statement
  // (ledger_source) is an aggregate, not one dated line item — the backend
  // rejects amount/date edits on those, so we hide the inputs here too. When
  // the role is unknown (older or manual docs) we default to editable.
  // Amount and date editability differ by document role.
  //   transaction / schedule_source → both amount and date are editable.
  //   summary_statement (P&L, balance sheet, prior Form B — the REFERENCE_ONLY
  //     categories) → carries no single transaction amount, but DOES have a
  //     meaningful document date (e.g. the year a prior Form B relates to), so
  //     the date is editable while the amount stays locked.
  //   ledger_source (bank statement) → neither; it's many lines, not one.
  //   unknown role (older/manual docs) → editable for both, as before.
  const amountRoleEditable = !doc.documentRole
    || doc.documentRole === 'transaction'
    || doc.documentRole === 'schedule_source';
  const dateRoleEditable = amountRoleEditable
    || doc.documentRole === 'summary_statement';

  // Only the data points the LLM COULDN'T capture are editable — a field the AI
  // read correctly stays locked so the user can't accidentally corrupt it. The
  // "Edit anyway" override unlocks everything for the rare correction case.
  const [override, setOverride] = useState(false);
  const canEditAmount   = override ? amountRoleEditable : (amountRoleEditable && !doc.llmAmountCaptured);
  const canEditDate     = override ? dateRoleEditable   : (dateRoleEditable   && !doc.llmDateCaptured);
  const canEditCategory = override ? true : !doc.llmCategoryDecided;
  const nothingEditable = !canEditAmount && !canEditDate && !canEditCategory;

  const [category, setCategory] = useState(
    doc.category && doc.category !== 'Unclassified' ? doc.category : 'Mixed / Pending Review'
  );
  // Prefill with current values so a mistaken first entry can be re-edited,
  // instead of the fields disappearing once any value exists.
  const [amountInput, setAmountInput] = useState(doc.amountNumber != null ? String(doc.amountNumber) : '');
  const [amountError, setAmountError] = useState('');
  const [dateInput, setDateInput] = useState(doc.datePrecision === 'day' && doc.date ? doc.date : '');
  const [dateError, setDateError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      await onReset(doc.id);
    } finally {
      setResetting(false);
    }
  };

  // Derive status from selected category. Apportioned Q3 categories (client
  // entertainment, gifts, mixed-use vehicle, hire purchase) resolve to
  // 'deductible' — they ARE business deductions, just partial ones; the
  // deductible portion is captured separately via the % field below, so they
  // no longer sit permanently in 'mixed'/Needs-Review.
  const deriveStatus = (cat) => {
    if (Q1_CATEGORIES.includes(cat) || Q2_CATEGORIES.includes(cat)) return 'income';
    if (['Q3 — Capital Assets & Equipment', 'Q3 — Capital Renovation & Fit-Out'].includes(cat)) return 'capital';
    if (cat === 'Q3 — CP500 / Tax Installment') return 'not_applicable';
    if (Q4_DONATION_CATEGORIES.includes(cat)) return 'donation';
    if (Q4_RELIEF_CATEGORIES.includes(cat)) return 'relief';
    if (Q4_NON_DED_CATEGORIES.includes(cat)) return 'non_deductible';
    if (Q3_CATEGORIES.includes(cat)) return 'deductible'; // incl. apportioned — % handled via deductible_pct
    return 'mixed';
  };

  const derivedStatus = deriveStatus(category);

  // Apportionment: when the selected category is only partially deductible,
  // collect the deductible %. Prefill from the doc's stored value, else the
  // category's default. Reset whenever the selected category changes so a
  // leftover % from a previous selection can't leak across categories.
  const apportionMeta = APPORTIONED_META[category] || null;
  const [pctInput, setPctInput] = useState(
    doc.deductiblePct != null ? String(doc.deductiblePct)
      : (APPORTIONED_META[category]?.default != null ? String(APPORTIONED_META[category].default) : '')
  );
  const [pctError, setPctError] = useState('');
  useEffect(() => {
    const meta = APPORTIONED_META[category] || null;
    if (!meta) { setPctInput(''); setPctError(''); return; }
    if (meta.mode === 'statutory') { setPctInput(String(meta.default)); setPctError(''); return; }
    // For default/required: keep the doc's saved value if it's for THIS category,
    // otherwise fall back to the category default (blank for 'required').
    setPctInput(doc.deductiblePct != null && doc.category === category
      ? String(doc.deductiblePct)
      : (meta.default != null ? String(meta.default) : ''));
    setPctError('');
  }, [category, doc.deductiblePct, doc.category]);

  const confidence = isMixed ? (doc.confidence ?? 50) : (doc.confidence ?? 75);
  // Same success/warning/critical tiers as ConfidenceBadge — semantic classes
  // instead of inline hex now that every tier has a documented token.
  const confToneClass = confidence >= 90 ? 'bg-success-bg text-success'
    : confidence >= 70 ? 'bg-warning-bg text-warning'
    : 'bg-critical-bg text-critical';

  const handleConfirm = async () => {
    let amountToSend = null;
    let dateToSend = null;
    if (canEditAmount) {
      if (amountInput.trim() !== '') {
        const parsed = parseFloat(amountInput);
        if (isNaN(parsed) || parsed < 0) {
          setAmountError('Enter a valid amount.');
          return;
        }
        amountToSend = parsed;
      } else if (amountMissing) {
        setAmountError('Enter a valid amount to continue.');
        return;
      }
    }
    if (canEditDate) {
      if (dateInput) {
        dateToSend = dateInput;
      } else if (dateMissing && amountRoleEditable) {
        // A real transaction needs a date; a reference/summary document's date
        // is optional metadata, so don't block confirming it without one.
        setDateError('Enter the document date to continue.');
        return;
      }
    }

    // Apportioned categories carry a deductible %. Statutory ones are fixed;
    // 'default' ones fall back to their default when left blank; 'required'
    // ones (vehicle/HP) must be entered before we can resolve the document.
    let pctToSend = null;
    if (apportionMeta) {
      if (apportionMeta.mode === 'statutory') {
        pctToSend = apportionMeta.default;
      } else if (pctInput.trim() !== '') {
        const p = parseInt(pctInput, 10);
        if (isNaN(p) || p < 0 || p > 100) {
          setPctError('Enter a whole number between 0 and 100.');
          return;
        }
        pctToSend = p;
      } else if (apportionMeta.mode === 'required') {
        setPctError('Enter the deductible % to continue.');
        return;
      } else {
        pctToSend = apportionMeta.default;
      }
    }

    setAmountError('');
    setDateError('');
    setPctError('');
    setSaving(true);
    try {
      await onConfirm(derivedStatus, category, amountToSend, dateToSend, pctToSend);
    } finally {
      setSaving(false);
    }
  };

  // Fallback text when LLM fields are null
  const fallbackReason = `The AI matched this document to "${doc.category}" based on the vendor name, line items, and amount. It assigned ${confidence}% confidence to this classification.`;
  const fallbackQuestion = 'Does this classification look correct? If not, please select the most accurate category below and confirm.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-border w-[480px] max-h-[88vh] overflow-y-auto p-6 mx-4" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-headings">
              {isMixed ? 'Classify this document' : 'Re-classify this document'}
            </p>
            <p className="text-xs text-muted mt-0.5 truncate">{doc.name} · {doc.amount}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col items-end">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${confToneClass}`}>
                {confidence}% confidence
              </span>
              <span className="text-xs text-[#94A3B8] mt-0.5 mr-0.5">
                {isMixed ? 'AI is undecided' : 'AI classification accuracy'}
              </span>
            </div>
            <button onClick={onCancel} className="text-[#94A3B8] hover:text-headings transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* AI Reasoning block */}
        {isMixed ? (
          <>
            {/* Why the AI couldn't decide */}
            <div className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2.5 mb-3">
              <p className="text-xs font-semibold text-warning mb-1">Why the AI couldn't decide</p>
              <p className="text-xs text-warning leading-relaxed">
                {doc.reason || fallbackReason}
              </p>
              {doc.source && (
                <p className="text-xs text-warning/80 mt-1.5 italic">Source: {doc.source}</p>
              )}
            </div>
            {/* Guiding question */}
            <div className="rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] px-3 py-2.5 mb-4">
              <p className="text-xs font-semibold text-[#075985] mb-1">A question to help you decide</p>
              <p className="text-xs text-[#0C4A6E] leading-relaxed">
                {doc.question || fallbackQuestion}
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Why the AI placed it here */}
            <div className="rounded-lg border border-border bg-[#F8FAFC] px-3 py-2.5 mb-3">
              <p className="text-xs font-semibold text-[#334155] mb-1">Why the AI classified it this way</p>
              <p className="text-xs text-muted leading-relaxed">
                {doc.note || fallbackReason}
              </p>
              <p className="text-xs text-[#94A3B8] mt-1.5">
                Currently: <span className="font-semibold text-headings">{STATUS_META[doc.taxStatus]?.label || doc.taxStatus}</span> · <span className="font-semibold text-headings">{categoryLabel(doc.category)}</span>
              </p>
            </div>
            <div className="rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] px-3 py-2.5 mb-4">
              <p className="text-xs font-semibold text-[#075985] mb-1">Does this still look right?</p>
              <p className="text-xs text-[#0C4A6E] leading-relaxed">
                {doc.question || fallbackQuestion}
              </p>
            </div>
          </>
        )}

        {/* ITA reference if available */}
        {doc.ita_section && (
          <div className="mb-3 flex items-center gap-2 text-xs text-muted">
            <span className="rounded bg-[#EFF6FF] px-2 py-0.5 font-mono text-[#0369A1] font-semibold">{doc.ita_section}</span>
            <span>ITA 1967 reference</span>
          </div>
        )}

        {/* Amount & date — each field is editable ONLY if the LLM couldn't
            capture it; a captured field is shown locked so it can't be
            corrupted. "Edit anyway" (below) unlocks everything if needed. */}
        {(dateRoleEditable || amountRoleEditable) ? (
          <>
            {dateRoleEditable && (
              <div className="mb-3">
                <label className="block text-xs font-semibold text-headings mb-1.5">
                  Date{' '}
                  <span className="font-normal text-[#94A3B8]">
                    {canEditDate ? "(OCR couldn't read this — please enter it)" : '(read from document)'}
                  </span>
                </label>
                {canEditDate ? (
                  <input
                    type="date"
                    value={dateInput}
                    onChange={e => { setDateInput(e.target.value); if (dateError) setDateError(''); }}
                    className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-headings focus:outline-none ${dateError ? 'border-[#FCA5A5] focus:border-critical' : 'border-border focus:border-primary'}`}
                  />
                ) : (
                  <div className="w-full rounded-lg border border-border bg-[#F8FAFC] px-3 py-2 text-sm text-muted">
                    {doc.dateDisplay && doc.dateDisplay !== '—' ? doc.dateDisplay : '—'}
                  </div>
                )}
                {dateError && <p className="mt-1 text-xs text-critical">{dateError}</p>}
              </div>
            )}

            {amountRoleEditable ? (
              <div className="mb-3">
                <label className="block text-xs font-semibold text-headings mb-1.5">
                  Amount{' '}
                  <span className="font-normal text-[#94A3B8]">
                    {canEditAmount ? "(OCR couldn't read this — please enter it)" : '(read from document)'}
                  </span>
                </label>
                {canEditAmount ? (
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">RM</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={amountInput}
                      onChange={e => { setAmountInput(e.target.value); if (amountError) setAmountError(''); }}
                      placeholder="0.00"
                      className={`w-full rounded-lg border bg-white pl-9 pr-3 py-2 text-sm text-headings focus:outline-none ${amountError ? 'border-[#FCA5A5] focus:border-critical' : 'border-border focus:border-primary'}`}
                    />
                  </div>
                ) : (
                  <div className="w-full rounded-lg border border-border bg-[#F8FAFC] px-3 py-2 text-sm text-muted">
                    {doc.amount && doc.amount !== '—' ? doc.amount : '—'}
                  </div>
                )}
                {amountError && <p className="mt-1 text-xs text-critical">{amountError}</p>}
              </div>
            ) : (
              <div className="mb-3 rounded-lg border border-border bg-[#F8FAFC] px-3 py-2.5">
                <p className="text-xs text-muted leading-relaxed">
                  This is a summary / statement document — it has no single amount to edit.
                  You can still correct its date above and its category below.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="mb-3 rounded-lg border border-border bg-[#F8FAFC] px-3 py-2.5">
            <p className="text-xs text-muted leading-relaxed">
              This document doesn't carry a single amount or date to edit. You can still correct its category below.
            </p>
          </div>
        )}

        {/* Category picker */}
        <label className="block text-xs font-semibold text-headings mb-1.5">
          {canEditCategory ? 'Select the correct category' : 'Category (classified by AI)'}
        </label>
        {canEditCategory ? (
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-headings mb-2 focus:outline-none focus:border-primary cursor-pointer"
          >
            {RECLASSIFY_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.cats.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
              </optgroup>
            ))}
            <option value="Mixed / Pending Review">Pending Review</option>
            <option value="Non-Tax Document">Non-Tax Document</option>
          </select>
        ) : (
          <div className="w-full rounded-lg border border-border bg-[#F8FAFC] px-3 py-2 text-sm text-muted mb-2">
            {categoryLabel(category)}
          </div>
        )}

        {/* Deductible % — only for apportioned Q3 categories (entertainment,
            gifts, mixed-use vehicle, hire purchase). Statutory rates are shown
            locked; the rest are entered/edited by the user. */}
        {apportionMeta && (
          <div className="mb-2">
            <label className="block text-xs font-semibold text-headings mb-1.5">
              Deductible portion{' '}
              <span className="font-normal text-[#94A3B8]">
                {apportionMeta.mode === 'statutory' ? '(fixed by law)' : '(% of the amount that is deductible)'}
              </span>
            </label>
            <div className="relative w-32">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                inputMode="numeric"
                value={pctInput}
                disabled={apportionMeta.mode === 'statutory'}
                onChange={e => { setPctInput(e.target.value); if (pctError) setPctError(''); }}
                placeholder={apportionMeta.mode === 'required' ? '— %' : ''}
                className={`w-full rounded-lg border bg-white pr-7 pl-3 py-2 text-sm text-headings focus:outline-none disabled:bg-[#F8FAFC] disabled:text-muted ${pctError ? 'border-[#FCA5A5] focus:border-critical' : 'border-border focus:border-primary'}`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
            </div>
            <p className="mt-1 text-xs text-muted leading-relaxed">{apportionMeta.hint}</p>
            {pctError && <p className="mt-1 text-xs text-critical">{pctError}</p>}
          </div>
        )}

        {/* Edit-anyway override + reset */}
        <div className="mb-4 flex items-center justify-between">
          {nothingEditable && !override ? (
            <p className="text-xs text-[#94A3B8]">
              The AI captured every field.{' '}
              <button onClick={() => setOverride(true)} className="font-semibold text-primary hover:text-primary-hover underline">
                Edit anyway
              </button>
            </p>
          ) : !override ? (
            <button onClick={() => setOverride(true)} className="text-xs text-[#94A3B8] hover:text-primary underline">
              Edit a locked field
            </button>
          ) : <span />}
          {doc.edited && (
            <button
              onClick={handleReset}
              disabled={resetting}
              className="text-xs font-semibold text-muted hover:text-critical underline disabled:opacity-60">
              {resetting ? 'Resetting…' : 'Reset to AI original'}
            </button>
          )}
        </div>

        {/* Derived status preview */}
        <div className="flex items-center gap-2 mb-5 px-1">
          <span className="text-xs text-muted">Will be classified as:</span>
          <StatusBadge status={REFERENCE_CATEGORIES.includes(category) ? 'reference' : derivedStatus} />
          {apportionMeta && pctInput !== '' && (
            <span className="text-xs font-semibold text-primary">· {pctInput}% deductible</span>
          )}
        </div>

        {/* Confirm */}
        <button
          onClick={handleConfirm}
          disabled={saving}
          className="w-full rounded-xl border-2 border-primary bg-primary-tint px-4 py-3 text-sm font-bold text-primary hover:bg-[#D1FAE5] transition-colors disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Confirm Classification'}
        </button>
      </div>
    </div>
  );
}

// ─── Document Canvas (fallback for manual / legacy docs) ─────────────────────
function DocumentCanvas({ doc }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 580, H = 760, dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);
    const accent = doc.accent || '#0D9488';
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    // Branded header
    ctx.fillStyle = accent; ctx.fillRect(0, 0, W, 88);
    ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(doc.vendor || 'Vendor', 36, 40);
    ctx.font = '11px sans-serif';
    ctx.fillText(doc.vendor_addr || doc.vendorAddr || '', 36, 60);
    ctx.textAlign = 'right'; ctx.font = 'bold 15px sans-serif';
    ctx.fillText((doc.type || 'Document').toUpperCase(), W - 36, 40);
    ctx.font = '11px sans-serif';
    ctx.fillText(`No: ${doc.doc_no || doc.docNo || '—'}`, W - 36, 60);
    let y = 120;
    ctx.textAlign = 'left'; ctx.fillStyle = '#0F172A'; ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`Date: ${doc.dateDisplay || doc.date || ''}`, 36, y); y += 26;
    ctx.fillStyle = '#F1F5F9'; ctx.fillRect(36, y - 14, W - 72, 26);
    ctx.fillStyle = '#334155'; ctx.font = 'bold 11px sans-serif';
    ctx.fillText('Description', 44, y + 3); ctx.textAlign = 'right';
    ctx.fillText('Amount (RM)', W - 44, y + 3); y += 30;
    ctx.font = '12px sans-serif';
    (doc.lineItems || []).forEach(item => {
      const amt = typeof item.amt === 'number' ? item.amt : parseFloat(item.amt) || 0;
      ctx.textAlign = 'left'; ctx.fillStyle = '#334155';
      ctx.fillText(item.desc || '', 44, y);
      ctx.textAlign = 'right';
      ctx.fillText(amt.toLocaleString('en-MY', { minimumFractionDigits: 2 }), W - 44, y);
      y += 18; ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(36, y); ctx.lineTo(W - 36, y); ctx.stroke(); y += 18;
    });
    y += 6; ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = accent;
    ctx.textAlign = 'left'; ctx.fillText('Total Due', 44, y);
    ctx.textAlign = 'right'; ctx.fillText(doc.amount || '', W - 44, y);
    ctx.textAlign = 'center'; ctx.fillStyle = '#94A3B8'; ctx.font = '9px sans-serif';
    ctx.fillText('Generated by cukai.ai', W / 2, H - 28);
  }, [doc]);
  return <canvas ref={canvasRef} className="block mx-auto rounded-lg shadow-xl border border-border" style={{ background: '#fff' }} />;
}

// ─── Spreadsheet table renderer ───────────────────────────────────────────────
function SpreadsheetTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  const colLetters = Array.from({ length: rows[0].length }, (_, i) => String.fromCharCode(65 + i));
  return (
    <div className="rounded-lg border border-border overflow-hidden shadow-xl bg-surface m-4">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr>
            <th className="w-8 border border-border bg-[#E8EBEF] text-[10px] text-[#94A3B8]"></th>
            {colLetters.map(l => <th key={l} className="border border-border bg-[#E8EBEF] text-[10px] font-medium text-[#94A3B8] py-1">{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri === 0 ? 'bg-primary' : ri % 2 === 0 ? 'bg-surface' : 'bg-[#FAFBFC]'}>
              <td className="border border-border bg-[#F1F5F9] text-center text-[10px] text-[#94A3B8] py-1.5">{ri + 1}</td>
              {row.map((cell, ci) => (
                <td key={ci} className={`border border-border px-2.5 py-1.5 whitespace-nowrap ${ri === 0 ? 'font-bold text-white' : ci === row.length - 1 ? 'text-right font-medium text-headings' : 'text-[#334155]'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Manual Upload Modal ──────────────────────────────────────────────────────
function ManualUploadModal({ onConfirm, onCancel }) {
  const [docType, setDocType] = useState('Invoice');
  const [vendor, setVendor] = useState('');
  const [vendorAddr, setVendorAddr] = useState('');
  const [docNo, setDocNo] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lineItems, setLineItems] = useState([{ desc: '', amt: '' }]);
  const [category, setCategory] = useState(Q3_CATEGORIES[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const updateLineItem = (i, field, value) =>
    setLineItems(prev => prev.map((li, idx) => idx === i ? { ...li, [field]: value } : li));
  const addLineItem = () => setLineItems(prev => [...prev, { desc: '', amt: '' }]);
  const removeLineItem = (i) => setLineItems(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

  const total = lineItems.reduce((s, li) => s + (parseFloat(li.amt) || 0), 0);
  const formattedDate = date ? new Date(date).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const isValid = vendor.trim() && docNo.trim() && date && lineItems.every(li => li.desc.trim() && parseFloat(li.amt) > 0);

  const buildPayload = () => ({
    document_type: docType,
    vendor,
    vendor_addr: vendorAddr,
    doc_no: docNo,
    date,
    category,
    notes,
    line_items: lineItems.map(li => ({ desc: li.desc, amt: parseFloat(li.amt) || 0 })),
  });

  const handleSubmit = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await onConfirm(buildPayload());
    } catch (e) {
      setSaveError(e?.response?.data?.detail || 'Could not save this document — please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-border w-[520px] max-h-[90vh] overflow-y-auto p-6 mx-4" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-headings">Manually add a document</p>
            <p className="text-[10px] text-muted mt-0.5">No file? Enter the details and we'll save the record.</p>
          </div>
          <button onClick={onCancel} className="text-[#94A3B8] hover:text-headings transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-muted mb-1.5">Document type</label>
              <select value={docType} onChange={e => setDocType(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-headings focus:outline-none focus:border-primary cursor-pointer">
                {['Invoice', 'Receipt', 'Utility Bill', 'Payroll', 'Purchase Order', 'Bank Statement', 'Other'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted mb-1.5">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-headings focus:outline-none focus:border-primary" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-muted mb-1.5">Vendor / payee name</label>
            <input type="text" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. ABC Trading Sdn Bhd"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-headings focus:outline-none focus:border-primary placeholder:text-[#CBD5E1]" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-muted mb-1.5">Vendor address</label>
            <input type="text" value={vendorAddr} onChange={e => setVendorAddr(e.target.value)} placeholder="e.g. No. 12, Jalan Damai, KL"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-headings focus:outline-none focus:border-primary placeholder:text-[#CBD5E1]" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-muted mb-1.5">Document / receipt number</label>
            <input type="text" value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="e.g. INV-2026-0001"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-headings focus:outline-none focus:border-primary placeholder:text-[#CBD5E1]" />
          </div>
          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[10px] font-medium text-muted">Line items</label>
              <button onClick={addLineItem} className="text-[10px] text-primary font-semibold hover:text-primary-hover transition-colors">+ Add item</button>
            </div>
            <div className="space-y-2">
              {lineItems.map((li, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="text" value={li.desc} onChange={e => updateLineItem(i, 'desc', e.target.value)} placeholder="Description"
                    className="flex-1 min-w-0 rounded-lg border border-border bg-white px-3 py-2 text-xs text-headings focus:outline-none focus:border-primary placeholder:text-[#CBD5E1]" />
                  <input type="number" value={li.amt} onChange={e => updateLineItem(i, 'amt', e.target.value)} placeholder="0.00"
                    className="w-24 shrink-0 rounded-lg border border-border bg-white px-3 py-2 text-xs text-headings text-right focus:outline-none focus:border-primary placeholder:text-[#CBD5E1]" />
                  <button onClick={() => removeLineItem(i)} className="shrink-0 text-[#CBD5E1] hover:text-critical transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#F1F5F9]">
              <span className="text-[10px] font-semibold text-muted">Total</span>
              <span className="text-xs font-bold text-headings">{fmtRM(total)}</span>
            </div>
          </div>
          {/* Category */}
          <div>
            <label className="block text-[10px] font-medium text-muted mb-1.5">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-headings focus:outline-none focus:border-primary cursor-pointer">
              {RECLASSIFY_GROUPS.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.cats.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          {/* Notes */}
          <div>
            <label className="block text-[10px] font-medium text-muted mb-1.5">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any additional context for this document"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-headings focus:outline-none focus:border-primary placeholder:text-[#CBD5E1] resize-none" />
          </div>
        </div>
        <button
          onClick={handleSubmit}
          disabled={!isValid || saving}
          className={`w-full mt-6 rounded-xl px-4 py-3 text-sm font-bold transition-colors ${isValid && !saving ? 'bg-primary text-white hover:bg-primary-hover cursor-pointer' : 'bg-[#F1F5F9] text-[#CBD5E1] cursor-not-allowed'}`}>
          {saving ? 'Saving…' : 'Save Document'}
        </button>
        {saveError && <p className="text-[10px] text-critical text-center mt-2">{saveError}</p>}
        {!isValid && !saveError && <p className="text-[10px] text-[#94A3B8] text-center mt-2">Fill in vendor name, document number, date, and at least one line item.</p>}
      </div>
    </div>
  );
}

function UploadTab({ docs, uploads, onFileDrop, onRemove, onArchive, onUnarchive, onRetry, onUpdateStatus, onReset, onManualAdd, initialStateFilter }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  // Two orthogonal filter axes that compose:
  //   stateFilter    — cross-cutting document STATE (all | needs_review | failed | archived)
  //   categoryFilter — quadrant CATEGORY (all | Q1 | Q2 | Q3 | Q4R | Q4P)
  // Previously "classifications" (tax status) and "categories" (quadrant) were
  // two dropdowns covering the same taxonomy; they're now one category axis plus
  // state chips for the things a quadrant can't express.
  const [stateFilter, setStateFilter] = useState(
    ['needs_review', 'failed', 'archived'].includes(initialStateFilter) ? initialStateFilter : 'all'
  );
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [reclassDoc, setReclassDoc] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [manualUploadOpen, setManualUploadOpen] = useState(false);
  const [limitToast, setLimitToast] = useState('');

  const viewingArchived = stateFilter === 'archived';

  // Separate completed/failed docs from in-flight uploads
  const completedDocs = docs.filter(d => d.status !== 'pending' && d.status !== 'processing');
  const failedDocs = completedDocs.filter(d => d.status === 'failed');
  // "Needs review" now uses the same signal as the overview banner — the
  // backend's aggregation gate (surfaced via mapApiDoc's `needsReview`) — so the
  // two counts describe the same thing rather than diverging.
  //
  // A document can no longer BE archived while still unresolved (the backend
  // rejects it — see archive_document's guard), so `d.status !== 'archived'`
  // here is now just defensive belt-and-braces, not load-bearing: it should
  // be a no-op in practice, since an archived document should never have
  // needsReview === true in the first place.
  const mixed = completedDocs.filter(d => d.needsReview && d.status !== 'archived');

  // Documents still processing/pending that AREN'T represented by a live upload
  // entry — e.g. after a tab switch, reload, or the backend's crash re-queue.
  // Rendered as progress rows so an in-flight doc is never invisible.
  const uploadDocIds = new Set(uploads.map(u => u.docId).filter(Boolean));
  const resumingDocs = docs.filter(
    d => (d.status === 'pending' || d.status === 'processing') && !uploadDocIds.has(d.id)
  );

  // Cross-cutting state chips (shown with live counts). Selected colours follow
  // each state's tag colour; archived is a neutral pastel grey.
  const STATE_CHIPS = [
    { value: 'all',          label: 'All' },
    { value: 'needs_review', label: `Needs review${mixed.length ? ` (${mixed.length})` : ''}` },
    { value: 'failed',       label: `Failed${failedDocs.length ? ` (${failedDocs.length})` : ''}` },
    { value: 'archived',     label: 'Archived' },
  ];
  // Semantic classes instead of inline hex — all/needs_review/failed map onto
  // the design system's primary/warning/critical tokens (§4); archived has no
  // status-tone equivalent, so it uses the sanctioned neutral slate utility
  // classes (§4's "slate, never gray" rule) rather than a one-off hex.
  const CHIP_SELECTED_CLASS = {
    all:          'bg-primary text-white border-primary',
    needs_review: 'bg-warning-bg text-warning border-warning',
    failed:       'bg-critical-bg text-critical border-critical',
    archived:     'bg-slate-200 text-slate-600 border-slate-300',
  };

  // Category axis — quadrant, but labelled the way users think (no "Qn —"
  // prefix). Reference & Reconciliation is its own option so summary docs
  // (P&L, balance sheet, prior Form B, CP500) don't sit under Business Income.
  const CATEGORY_FILTER_OPTIONS = [
    { value: 'all',  label: 'All categories' },
    { value: 'Q1',   label: 'Business Income' },
    { value: 'Q2',   label: 'Personal Income' },
    { value: 'Q3',   label: 'Business Expense' },
    { value: 'Q4R',  label: 'Personal Relief' },
    { value: 'Q4D',  label: 'Donations (Part G)' },
    { value: 'Q4P',  label: 'Personal Expense (Non-deductible)' },
    { value: 'REF',  label: 'Reference & Reconciliation' },
  ];

  const availableYears = [...new Set(completedDocs.map(d => d.date ? d.date.slice(0, 4) : null).filter(Boolean))].sort((a, b) => b - a);

  let filtered = completedDocs.filter(d => {
    // ── State axis (cross-cutting) ──
    if (stateFilter === 'archived') return d.status === 'archived';
    if (d.status === 'archived') return false;               // hide archived unless viewing them
    if (stateFilter === 'failed' && d.status !== 'failed') return false;
    if (stateFilter === 'needs_review' && !d.needsReview) return false;

    // ── Category axis (quadrant) — composes with the state axis ──
    if (categoryFilter !== 'all') {
      const cat = d.category || '';
      const isReference = REFERENCE_CATEGORIES.includes(cat);
      if (categoryFilter === 'Q1'  && (!cat.startsWith('Q1') || isReference)) return false;
      if (categoryFilter === 'Q2'  && !cat.startsWith('Q2'))  return false;
      if (categoryFilter === 'Q3'  && (!cat.startsWith('Q3') || isReference)) return false;
      if (categoryFilter === 'Q4R' && !(cat.startsWith('Q4') && Q4_RELIEF_CATEGORIES.includes(cat))) return false;
      if (categoryFilter === 'Q4D' && !(cat.startsWith('Q4') && Q4_DONATION_CATEGORIES.includes(cat))) return false;
      if (categoryFilter === 'Q4P' && !(cat.startsWith('Q4') && Q4_NON_DED_CATEGORIES.includes(cat))) return false;
      if (categoryFilter === 'REF' && !isReference) return false;
    }
    if (yearFilter !== 'all') {
      if (!d.date || d.date.slice(0, 4) !== yearFilter) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!(d.name || '').toLowerCase().includes(q) &&
          !(d.vendor || '').toLowerCase().includes(q) &&
          !(d.category || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'date_desc' || sortBy === 'date_asc') {
      // Docs with no extractable date have nothing to compare on a timeline —
      // always push them to the bottom, regardless of sort direction.
      if (!a.dateSortKey && !b.dateSortKey) return 0;
      if (!a.dateSortKey) return 1;
      if (!b.dateSortKey) return -1;
      return sortBy === 'date_desc'
        ? b.dateSortKey.localeCompare(a.dateSortKey)
        : a.dateSortKey.localeCompare(b.dateSortKey);
    }
    if (sortBy === 'amount_desc') return parseAmt(b.amount) - parseAmt(a.amount);
    if (sortBy === 'amount_asc') return parseAmt(a.amount) - parseAmt(b.amount);
    if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '');
    return 0;
  });

  const handleReclassifyConfirm = async (status, category, amount, date, deductiblePct) => {
    await onUpdateStatus(reclassDoc.id, status, category, amount, date, deductiblePct);
    setReclassDoc(null);
    setPreviewDoc(null);
  };

  const handleResetConfirm = async (id) => {
    await onReset(id);
    setReclassDoc(null);
    setPreviewDoc(null);
  };

  const MAX_FILES = 10;

  const handleFiles = useCallback((files) => {
    const list = Array.from(files);
    if (list.length > MAX_FILES) {
      setLimitToast('You can add at most 10 attachments to a message. Please select fewer attachments.');
      setTimeout(() => setLimitToast(''), 5000);
      return;
    }
    onFileDrop(list);
  }, [onFileDrop]);

  const handleInputChange = useCallback((e) => {
    handleFiles(e.target.files);
    // Reset the input's value so selecting the exact same file again (e.g.
    // after deleting it) still fires onChange — browsers don't fire change
    // events when the selected file list is unchanged from last time.
    e.target.value = '';
  }, [handleFiles]);

  return (
    <>
      {limitToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-xl border border-critical/30 bg-critical-bg px-5 py-3 shadow-xl">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-critical shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <p className="text-[11px] font-semibold text-critical">{limitToast}</p>
          <button onClick={() => setLimitToast('')} className="text-critical/60 hover:text-critical ml-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}
      {reclassDoc && (
        <ReclassifyModal doc={reclassDoc} onConfirm={handleReclassifyConfirm} onReset={handleResetConfirm} onCancel={() => setReclassDoc(null)} />
      )}
      {previewDoc && (
        <DocumentPreview
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onReclassify={(d) => { setPreviewDoc(null); setReclassDoc(d); }}
          onArchive={(id) => { setPreviewDoc(null); onArchive(id); }}
          onUnarchive={(id) => { setPreviewDoc(null); onUnarchive(id); }}
          onDelete={(id) => { setPreviewDoc(null); onRemove(id); }}
        />
      )}
      {manualUploadOpen && (
        <ManualUploadModal
          onConfirm={async (payload) => { await onManualAdd(payload); setManualUploadOpen(false); }}
          onCancel={() => setManualUploadOpen(false)}
        />
      )}

      <div className="flex h-full min-h-0 flex-col gap-3">
        {/* Drop zone */}
        <div
          className={`shrink-0 rounded-xl border-2 border-dashed p-5 text-center transition-colors cursor-pointer ${dragging ? 'border-primary bg-success-bg' : 'border-[#CBD5E1] bg-[#F8FAFC] hover:border-primary'}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}>
          <input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.xlsx,.xls,.csv"
            className="hidden" onChange={handleInputChange} />
          <div className="mx-auto mb-2 h-9 w-9 rounded-full bg-success-bg flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-headings">Drop files here or <span className="text-primary">browse</span></p>
          <p className="mt-0.5 text-[11px] text-muted">PDF, JPG, PNG, XLSX, CSV · Max 20 MB per file · Up to 10 files at once</p>
          <p className="mt-2 text-[12px] text-[#94A3B8]">
            No file?{' '}
            <button onClick={e => { e.stopPropagation(); setManualUploadOpen(true); }}
              className="text-primary font-semibold hover:text-primary-hover underline transition-colors">
              Manually add a document
            </button>
          </p>
        </div>

        {/* Filter, search, sort bar */}
        <div className="shrink-0 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search documents…"
                className="rounded-lg border border-border bg-white pl-7 pr-3 py-1.5 text-xs text-[#334155] focus:outline-none focus:border-primary w-44"
              />
            </div>

            {/* State chips — cross-cutting document state (compose with the category axis) */}
            <div className="flex items-center gap-1.5">
              {STATE_CHIPS.map(chip => {
                const selected = stateFilter === chip.value;
                return (
                  <button
                    key={chip.value}
                    onClick={() => setStateFilter(chip.value)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      selected ? CHIP_SELECTED_CLASS[chip.value] : 'border-border bg-surface text-[#334155] font-medium hover:border-primary'
                    }`}>
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Category (quadrant) axis + year + sort — apply within any state view */}
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs text-[#334155] focus:outline-none focus:border-primary cursor-pointer">
              {CATEGORY_FILTER_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select value={yearFilter} onChange={e => setYearFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs text-[#334155] focus:outline-none focus:border-primary cursor-pointer">
              <option value="all">All years</option>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs text-[#334155] focus:outline-none focus:border-primary cursor-pointer">
              <option value="date_desc">Newest first</option>
                  <option value="date_asc">Oldest first</option>
                  <option value="amount_desc">Amount: high → low</option>
                  <option value="amount_asc">Amount: low → high</option>
                  <option value="name_asc">Name A–Z</option>
                </select>
          </div>
        </div>

        {/* Document table */}
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-border bg-surface">
          {uploads.length === 0 && resumingDocs.length === 0 && filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <svg className="mx-auto mb-3 h-10 w-10 text-[#CBD5E1]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p className="text-xs text-[#94A3B8]">
                  {docs.length === 0 ? 'No documents yet — drop files above to start.' : 'No documents match the current filters.'}
                </p>
              </div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#F8FAFC]">
                <tr className="border-b border-border">
                  {['File', 'Amount', 'Category', 'Classification', 'Date', ''].map(h => (
                    <th key={h} className="py-2.5 px-3 first:pl-4 last:pr-4 text-left text-[12px] font-semibold text-muted last:text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* In-flight uploads first */}
                {!viewingArchived && uploads.map(entry => (
                  <UploadProgressEntry
                    key={entry.localId}
                    entry={entry}
                  />
                ))}
                {/* Docs still processing after a tab switch / reload / re-queue,
                    not tracked by a live upload entry — shown so they're never invisible. */}
                {!viewingArchived && resumingDocs.map(d => (
                  <UploadProgressEntry
                    key={`resume-${d.id}`}
                    entry={{ localId: `resume-${d.id}`, fileName: d.name, docId: d.id,
                             phase: d.status === 'processing' ? 'processing' : 'uploading' }}
                  />
                ))}
                {/* Resolved docs */}
                {filtered.map(doc => (
                  <tr key={doc.id}
                    onClick={() => setPreviewDoc(doc)}
                    className="border-b border-[#F1F5F9] last:border-0 cursor-pointer bg-surface hover:bg-[#F8FAFC] transition-colors">
                    <td className="py-2.5 pl-4 pr-3 min-w-0">
                      <p className="font-medium text-headings text-xs leading-tight truncate max-w-[160px]">{doc.name}</p>
                      <p className="text-[11px] text-[#94A3B8] mt-0.5 truncate max-w-[160px]">{doc.type}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-semibold text-headings whitespace-nowrap">{doc.amount}</td>
                    <td className="px-3 py-2.5 text-xs text-[#334155] max-w-[140px]">
                      <span className="block truncate">{categoryLabel(doc.category)}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={badgeStatusFor(doc.category, doc.taxStatus, doc.status)} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted whitespace-nowrap">{doc.dateDisplay}</td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Retry — only for failed docs */}
                        {doc.status === 'failed' && (
                          <button
                            onClick={e => { e.stopPropagation(); onRetry(doc); }}
                            className="p-1.5 rounded-md text-[#CBD5E1] hover:text-[#0369A1] hover:bg-[#F0F9FF] transition-colors"
                            title="Retry classification">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                            </svg>
                          </button>
                        )}
                        {/* Archive — hidden while the document still needs
                            review; matches the detail panel's guard and the
                            backend's own rejection on the archive endpoint. */}
                        {doc.status !== 'archived' && !doc.needsReview && (
                          <button onClick={e => { e.stopPropagation(); onArchive(doc.id); }}
                            className="p-1.5 rounded-md text-[#CBD5E1] hover:text-muted hover:bg-[#F8FAFC] transition-colors" title="Archive">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
                            </svg>
                          </button>
                        )}
                        {/* Unarchive — only ever visible when filtered to the
                            Archived state, since archived docs are hidden
                            from the default list. Restores the document to
                            the main list (status: 'completed'). */}
                        {doc.status === 'archived' && (
                          <button onClick={e => { e.stopPropagation(); onUnarchive(doc.id); }}
                            className="p-1.5 rounded-md text-[#CBD5E1] hover:text-primary hover:bg-primary-tint/40 transition-colors" title="Unarchive — move back to the main list">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="14" y1="15" x2="10" y2="15"/><polyline points="9 12 12 9 15 12"/><line x1="12" y1="9" x2="12" y2="16"/>
                            </svg>
                          </button>
                        )}
                        {/* Delete */}
                        <button onClick={e => { e.stopPropagation(); onRemove(doc.id); }}
                          className="p-1.5 rounded-md text-[#CBD5E1] hover:text-critical hover:bg-critical-bg/40 transition-colors" title="Delete">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer count */}
        <p className="shrink-0 text-[10px] text-[#94A3B8]">
          {viewingArchived
            ? `${filtered.length} archived document${filtered.length !== 1 ? 's' : ''}`
            : `${filtered.length} of ${completedDocs.filter(d => d.status !== 'archived').length} documents shown`}
          {uploads.length > 0 && ` · ${uploads.length} uploading`}
          {' '}· Click a row to preview
        </p>
      </div>
    </>
  );
}


// ─── Root ─────────────────────────────────────────────────────────────────────
function CukaiAccount() {
  // When navigated here with ?filter=needs_review (e.g. the overview's "Review"
  // banner button), preselect that state chip on the upload tab.
  const initialStateFilter = (() => {
    const p = new URLSearchParams(window.location.search).get('filter');
    return ['needs_review', 'failed', 'archived'].includes(p) ? p : null;
  })();
  const [docs, setDocs]     = useState([]);       // resolved backend docs (mapped)
  const [uploads, setUploads] = useState([]);     // in-flight upload entries
  const [docsLoading, setDocsLoading] = useState(true);
  const [activeEntity, setActiveEntity] = useState(null);
  // Uploads are gated until the first entity resolution completes: a file
  // dropped before then would be stored with entity_id=null and its insights
  // would never appear in an entity-filtered inbox fetch.
  const [entityResolved, setEntityResolved] = useState(false);
  // Doc IDs currently being polled, so the resume-poller never double-polls a
  // doc that a fresh upload / retry is already tracking.
  const pollingRef = useRef(new Set());

  // Load the active entity name and listen for switches from ManageProfile
  useEffect(() => {
    const loadEntity = async () => {
      const userId = localStorage.getItem('userId');
      if (!userId) return;
      try {
        // Don't assume activeEntityId already exists — this page can be the
        // first one a user lands on right after login. Resolve a default
        // entity here too, the same way Overview and ManageAccount do.
        const entities = await API.getAllEntities(userId).catch(() => []);
        const storedId = parseInt(localStorage.getItem('activeEntityId') || '0');
        let entity = entities.find((e) => e.id === storedId);
        if (!entity && entities.length > 0) {
          entity = entities[0];
          localStorage.setItem('activeEntityId', String(entity.id));
        }
        setActiveEntity(entity || null);
      } catch (_) {}
      // Resolution finished (even if it yielded no entity — a user with zero
      // entities legitimately uploads with entity_id=null). Unblock uploads.
      setEntityResolved(true);
    };
    loadEntity();
    window.addEventListener('entitySwitch', loadEntity);
    return () => window.removeEventListener('entitySwitch', loadEntity);
  }, []);

  // ── Document load — re-runs whenever the active entity changes, so switching
  // entities in Manage Account refreshes the Upload tab's document list with
  // only that entity's documents.
  useEffect(() => {
    let cancelled = false;
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    (async () => {
      setDocsLoading(true);
      try {
        const raw = await API.getDocuments(userId, entityId);
        if (!cancelled) setDocs(raw.map(mapApiDoc));
      } catch (e) {
        console.error('[CukaiAccount] Failed to load documents:', e);
      } finally {
        if (!cancelled) setDocsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeEntity?.id]);

  // ── Resume polling for interrupted documents ─────────────────────────────
  // A document keeps processing server-side even when this component unmounts
  // (tab/page switch) or the user reloads — and the backend re-queues anything
  // left mid-flight after a restart. On (re)mount, the doc list re-loads from
  // the backend including any 'pending'/'processing' rows; this attaches a
  // poller to each so the user always sees it resolve, without depending on the
  // transient in-session upload entries. Guarded by pollingRef so a doc that a
  // live upload/retry is already tracking isn't polled twice.
  const ensurePolling = useCallback((docId) => {
    if (pollingRef.current.has(docId)) return;
    pollingRef.current.add(docId);
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    const INTERVALS = [2000, 3000, 3000, 5000, 5000, 8000, 10000];
    let attempt = 0;
    const poll = async () => {
      try {
        const statusData = await API.getDocumentStatus(docId, userId, entityId);
        if (statusData.status === 'completed' || statusData.status === 'failed') {
          try {
            const full = await API.getDocument(docId, userId, entityId);
            setDocs(prev => prev.map(d => d.id === docId
              ? { ...mapApiDoc(full), _localObjectUrl: d._localObjectUrl } : d));
          } catch (_) {
            setDocs(prev => prev.map(d => d.id === docId ? { ...d, status: statusData.status } : d));
          }
          pollingRef.current.delete(docId);
          // A resumed document finished classifying — the insight engine ran
          // at the pipeline tail, so tell the inbox to pick up the new feed.
          if (statusData.status === 'completed') notifyDocumentsChanged();
          return;
        }
      } catch (_) {}
      setTimeout(poll, INTERVALS[Math.min(attempt++, INTERVALS.length - 1)]);
    };
    setTimeout(poll, INTERVALS[attempt++]);
  }, [activeEntity?.id]);

  useEffect(() => {
    docs.forEach(d => {
      if (d.status === 'pending' || d.status === 'processing') ensurePolling(d.id);
    });
  }, [docs, ensurePolling]);

  // ── Duplicate / retry toast ──────────────────────────────────────────────────
  const [dupToast, setDupToast] = useState(null); // { fileName, existingId, retryHint }

  // ── File drop handler ───────────────────────────────────────────────────────
  const handleFileDrop = useCallback(async (files) => {
    const userId = localStorage.getItem('userId');
    if (!files.length) return;
    if (!entityResolved) {
      // See entityResolved above — uploading now would mis-scope the document.
      setDupToast({ message: 'Still loading your account — drop the file again in a moment.' });
      setTimeout(() => setDupToast(null), 4000);
      return;
    }
    const entityId = activeEntity?.id || null;

    const entries = files.map(f => ({
      localId: `${Date.now()}-${Math.random()}`,
      fileName: f.name,
      file: f,
      docId: null,
      phase: 'uploading',
      objectUrl: URL.createObjectURL(f),
    }));
    setUploads(prev => [...prev, ...entries]);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      try {
        const result = await API.uploadDocument(entry.file, userId, entityId);
        setUploads(prev => prev.map(e => e.localId === entry.localId
          ? { ...e, docId: result.document_id }
          : e
        ));
        pollUntilResolved(entry.localId, result.document_id, entry.objectUrl);
      } catch (err) {
        const detail = err?.response?.data?.detail || '';
        if (err?.response?.status === 409 && detail.startsWith('DUPLICATE:')) {
          const [, existingId] = detail.split(':');
          setDupToast({ fileName: entry.fileName, existingId });
          setTimeout(() => setDupToast(null), 6000);
        } else {
          console.error('[Upload] Failed:', entry.fileName, err);
        }
        URL.revokeObjectURL(entry.objectUrl);
        setUploads(prev => prev.filter(e => e.localId !== entry.localId));
      }
    }
  }, [activeEntity?.id, entityResolved]);

  // ── Manual document entry ────────────────────────────────────────────────────
  // No file, no OCR — persisted directly via a dedicated backend endpoint so
  // it survives reloads/entity switches like every other document. Throws on
  // failure so ManualUploadModal can surface the error and keep itself open.
  const manualAddDoc = useCallback(async (payload) => {
    const userId = localStorage.getItem('userId');
    if (!entityResolved) {
      // Entity still resolving (fresh login / hard reload) — creating the
      // document now would scope it (and its insights) to entity NULL, which
      // an entity-filtered insights fetch would then never show.
      throw new Error('Still loading your account — try again in a moment.');
    }
    const entityId = activeEntity?.id || null;
    const created = await API.createManualDocument(payload, userId, entityId);
    setDocs(prev => [mapApiDoc(created), ...prev]);
    notifyDocumentsChanged();
  }, [activeEntity?.id, entityResolved]);

  const pollUntilResolved = useCallback((localId, docId, objectUrl) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    const INTERVALS = [2000, 3000, 3000, 5000, 5000, 8000, 10000];
    let attempt = 0;
    let cancelled = false;
    pollingRef.current.add(docId);

    setUploads(prev => prev.map(e => e.localId === localId ? { ...e, phase: 'processing' } : e));

    const poll = async () => {
      if (cancelled) return;
      try {
        const statusData = await API.getDocumentStatus(docId, userId, entityId);
        if (statusData.status === 'completed' || statusData.status === 'failed') {
          pollingRef.current.delete(docId);
          setUploads(prev => prev.map(e =>
            e.localId === localId ? { ...e, phase: statusData.status === 'completed' ? 'done' : 'failed' } : e
          ));
          // Classification done → the engine ran at the pipeline tail; let
          // the AI Insights inbox know there's a fresh run to pick up.
          if (statusData.status === 'completed') notifyDocumentsChanged();
          setTimeout(async () => {
            try {
              const full = await API.getDocument(docId, userId, entityId);
              const mapped = mapApiDoc(full);
              mapped._localObjectUrl = objectUrl;
              setDocs(prev => [mapped, ...prev.filter(d => d.id !== docId)]);
            } catch (_) {
              setDocs(prev => [mapApiDoc({ ...statusData, id: docId, fileName: statusData.fileName || '' }), ...prev.filter(d => d.id !== docId)]);
            }
            setUploads(prev => prev.filter(e => e.localId !== localId));
          }, 800);
          return;
        }
      } catch (_) {}
      if (!cancelled) {
        const delay = INTERVALS[Math.min(attempt++, INTERVALS.length - 1)];
        setTimeout(poll, delay);
      }
    };
    setTimeout(poll, INTERVALS[attempt++]);
    return () => { cancelled = true; };
  }, [activeEntity?.id]);

  // ── Remove ──────────────────────────────────────────────────────────────────
  const removeDoc = useCallback(async (id) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    setDocs(prev => prev.filter(d => d.id !== id));
    try {
      await API.deleteDocument(id, userId, entityId);
      notifyDocumentsChanged();
    } catch (e) { console.error('[Delete]', e); }
  }, [activeEntity?.id]);

  // ── Archive ─────────────────────────────────────────────────────────────────
  const archiveDoc = useCallback(async (id) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    setDocs(prev => prev.map(d => d.id === id ? { ...d, status: 'archived' } : d));
    try {
      await API.archiveDocument(id, userId, entityId);
      notifyDocumentsChanged();
    } catch (e) {
      console.error('[Archive]', e);
      try {
        const full = await API.getDocument(id, userId, entityId);
        setDocs(prev => prev.map(d => d.id === id ? mapApiDoc(full) : d));
      } catch (_) {}
    }
  }, [activeEntity?.id]);

  // ── Unarchive ────────────────────────────────────────────────────────────────
  // Restores an archived document back to the main list. Mirrors archiveDoc:
  // optimistic local update first, backend call to persist, and a re-fetch
  // to reconcile local state if the request fails.
  const unarchiveDoc = useCallback(async (id) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    setDocs(prev => prev.map(d => d.id === id ? { ...d, status: 'completed' } : d));
    try { await API.unarchiveDocument(id, userId, entityId); } catch (e) {
      console.error('[Unarchive]', e);
      try {
        const full = await API.getDocument(id, userId, entityId);
        setDocs(prev => prev.map(d => d.id === id ? mapApiDoc(full) : d));
      } catch (_) {}
    }
  }, [activeEntity?.id]);

  // ── Re-classify ─────────────────────────────────────────────────────────────
  const updateDocStatus = useCallback(async (id, status, category, amount = null, date = null, deductiblePct = null) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    setDocs(prev => prev.map(d => d.id === id
      ? {
          ...d, taxStatus: status, category, status: 'completed',
          ...(amount !== null ? { amount: fmtRM(amount), amountNumber: amount } : {}),
          ...(date !== null ? { date, datePrecision: 'day', dateDisplay: formatDocDate(date, 'day'), dateSortKey: date } : {}),
          ...(deductiblePct !== null ? { deductiblePct } : {}),
        }
      : d
    ));
    try {
      await API.reclassifyDocument(id, status, category, userId, entityId, amount, date, deductiblePct);
      notifyDocumentsChanged();
      // Re-fetch so the row reflects recomputed role/aggregation AND the new
      // edited/original flags (which drive the Reset button and field locks).
      const full = await API.getDocument(id, userId, entityId);
      setDocs(prev => prev.map(d => d.id === id ? { ...mapApiDoc(full), _localObjectUrl: d._localObjectUrl } : d));
    } catch (e) {
      console.error('[Reclassify]', e);
      try {
        const full = await API.getDocument(id, userId, entityId);
        setDocs(prev => prev.map(d => d.id === id ? { ...mapApiDoc(full), _localObjectUrl: d._localObjectUrl } : d));
      } catch (_) {}
    }
  }, [activeEntity?.id]);

  // ── Reset a document to the LLM's original classification ────────────────────
  const resetDoc = useCallback(async (id) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    try {
      const full = await API.resetDocument(id, userId, entityId);
      setDocs(prev => prev.map(d => d.id === id ? { ...mapApiDoc(full), _localObjectUrl: d._localObjectUrl } : d));
      notifyDocumentsChanged();
    } catch (e) {
      console.error('[Reset]', e);
    }
  }, [activeEntity?.id]);

  // ── Retry failed upload ─────────────────────────────────────────────────────
  // The original file is still stored on disk server-side, so retry re-queues
  // it through the pipeline directly — no re-upload needed from the user.
  //
  // Two things have to both be true for retry to look right:
  //  1. VISIBLE while it's running — the table only renders docs whose
  //     status isn't 'pending'/'processing' (see `completedDocs` below); those
  //     in-flight statuses are meant to be shown via the `uploads` progress
  //     row instead. So we add an `uploads` entry here, same as a fresh
  //     upload, purely to drive the animated "Classifying…" row.
  //  2. NEVER LOST — unlike a fresh upload, the doc already exists in `docs`.
  //     We update it in place (status -> 'processing') rather than filtering
  //     it out, so even if the `uploads` entry is somehow lost (tab switch,
  //     remount, etc.) before polling resolves, the document itself is still
  //     sitting in `docs` and a page refresh will show its real backend
  //     status — it can never just disappear.
  const retryDoc = useCallback(async (doc) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    const localId = `retry-${doc.id}`;
    pollingRef.current.add(doc.id);

    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'processing', taxStatus: null } : d));
    setUploads(prev => [...prev, {
      localId,
      fileName: doc.name,
      file: null,
      docId: doc.id,
      phase: 'processing',
      objectUrl: doc._localObjectUrl || null,
    }]);

    try {
      await API.retryDocument(doc.id, userId, entityId);
    } catch (e) {
      console.error('[Retry]', e);
      pollingRef.current.delete(doc.id);
      setUploads(prev => prev.filter(u => u.localId !== localId));
      try {
        const full = await API.getDocument(doc.id, userId, entityId);
        setDocs(prev => prev.map(d => d.id === doc.id ? mapApiDoc(full) : d));
      } catch (_) {
        setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'failed' } : d));
      }
      return;
    }

    // Poll until the pipeline resolves. The doc row stays in `docs` the
    // whole time (status 'processing' keeps it out of the visible table,
    // same as a fresh upload) — we just update it in place once resolved,
    // and drop the transient progress row.
    const INTERVALS = [2000, 3000, 3000, 5000, 5000, 8000, 10000];
    let attempt = 0;
    const poll = async () => {
      try {
        const statusData = await API.getDocumentStatus(doc.id, userId, entityId);
        if (statusData.status === 'completed' || statusData.status === 'failed') {
          pollingRef.current.delete(doc.id);
          try {
            const full = await API.getDocument(doc.id, userId, entityId);
            setDocs(prev => prev.map(d => d.id === doc.id
              ? { ...mapApiDoc(full), _localObjectUrl: d._localObjectUrl } : d));
          } catch (_) {
            setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status: statusData.status } : d));
          }
          setUploads(prev => prev.filter(u => u.localId !== localId));
          if (statusData.status === 'completed') notifyDocumentsChanged();
          return;
        }
      } catch (_) {}
      const delay = INTERVALS[Math.min(attempt++, INTERVALS.length - 1)];
      setTimeout(poll, delay);
    };
    setTimeout(poll, INTERVALS[attempt++]);
  }, [activeEntity?.id]);

  return (
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body flex flex-col">
      {/* Duplicate / retry toast */}
      {dupToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-xl border border-warning/30 bg-warning-bg px-5 py-3 shadow-xl">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-warning shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <p className="text-[11px] font-semibold text-warning">
            {dupToast.message
              ? dupToast.message
              : dupToast.retryHint
                ? `Failed record cleared — drop "${dupToast.fileName}" again to retry.`
                : `"${dupToast.fileName}" was uploaded recently. Drop again to force re-upload.`}
          </p>
          <button onClick={() => setDupToast(null)} className="text-warning/60 hover:text-warning ml-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      <div className="mx-auto w-full max-w-7xl px-6 py-4 flex flex-col flex-1 min-h-0 gap-3">

        {/* Header */}
        <div className="shrink-0">
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Cukai Account</h1>
          <p className="text-xs text-muted mt-1">Upload receipts and classify your expenses{activeEntity ? ` — ${activeEntity.name}` : ''}.</p>
        </div>

        {/* Documents */}
        <div className="flex flex-1 min-h-0 gap-5">
          <div className="flex-1 min-w-0 min-h-0">
            {docsLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                  <p className="text-sm text-muted">Loading your documents…</p>
                </div>
              </div>
            ) : (
              <UploadTab
                docs={docs}
                uploads={uploads}
                onFileDrop={handleFileDrop}
                onRemove={removeDoc}
                onArchive={archiveDoc}
                onUnarchive={unarchiveDoc}
                onRetry={retryDoc}
                onUpdateStatus={updateDocStatus}
                onReset={resetDoc}
                onManualAdd={manualAddDoc}
                initialStateFilter={initialStateFilter}
              />
            )}
          </div>
        </div>

      </div>
    </main>
  );
}

export default CukaiAccount;