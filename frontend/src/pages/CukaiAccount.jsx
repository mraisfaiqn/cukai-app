import { useRef, useState, useCallback, useEffect } from 'react';
import * as API from '../services/api';
// ─── Design tokens (matches ManageAccount + UserNavigation) ───────────────────
// Design tokens: use text-primary/bg-primary (#0D9488), text-headings, text-muted, border-border — see design-system.md §4

// ─── Backend category taxonomy ────────────────────────────────────────────
// Previously hand-copied here as static arrays (Q1_CATEGORIES,
// RECLASSIFY_GROUPS, etc.) — that copy drifted out of sync with the
// backend across several taxonomy refactors (the CP500 split, the H6/H7/H8
// granularity split, and concretely, Bank Statement never being added as a
// selectable option at all, which caused a confirmed bug where the
// reclassify dropdown showed the wrong category for a bank statement
// document). Removed entirely — every component that needs the category
// list now receives it as a `categoryGroups` prop, fetched ONCE from
// GET /api/categories (see the CukaiAccount component below and api.js),
// so there is only one place the taxonomy is defined, ever.
//
// Two small lookup maps (category value -> bucket, category value ->
// backend status) are derived from that SAME fetched data and cached here
// at module level — this is genuinely static, identical-for-every-user
// reference data (not per-user state), so a plain module-level cache is a
// safe, simple way to make it available to the handful of standalone
// helper functions below (badgeStatusFor, the category filter) without
// threading a new prop through every intermediate component. Populated
// once by CukaiAccount's initial fetch effect; every reader has a sensible
// fallback for the brief window before that fetch completes.
let _categoryBucketCache = {};
let _categoryStatusCache = {};
let _categoryRoleCache = {};
function setCategoryLookupCache(categoryGroups) {
  const bucketMap = {};
  const statusMap = {};
  const roleMap = {};
  for (const group of categoryGroups || []) {
    for (const c of group.categories) {
      bucketMap[c.value] = group.bucket;
      statusMap[c.value] = c.status;
      roleMap[c.value] = c.role;
    }
  }
  _categoryBucketCache = bucketMap;
  _categoryStatusCache = statusMap;
  _categoryRoleCache = roleMap;
}
function getCategoryBucket(category) { return _categoryBucketCache[category] || null; }
function getCategoryStatus(category) { return _categoryStatusCache[category] || null; }
function getCategoryRole(category) { return _categoryRoleCache[category] || null; }

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

// Whether amount/date should be editable for a given document ROLE — used
// by ReclassifyModal, recomputed against whichever category is CURRENTLY
// SELECTED in the dropdown, not the document's original (possibly wrong)
// classification. Bug found in testing: a document originally
// misclassified as "Mixed / Pending Review" (role 'transaction', amount
// editable/required) that a user then reclassifies to "Bank Statement —
// Transaction Ledger" (role 'ledger_source', which is many lines, never a
// single amount) still demanded an amount before allowing the
// reclassification to be confirmed — because editability was frozen to the
// document's ORIGINAL role at the moment the modal opened, never
// recalculated as the user changed the category dropdown.
function editabilityForRole(role) {
  if (role === 'ledger_source')      return { amount: false, date: false };
  if (role === 'reference_document') return { amount: false, date: true };
  // 'registry_managed' (capital assets, CP500, H11, etc.), 'transaction',
  // and any unknown/null role (older docs, or still-loading taxonomy) all
  // behave like an ordinary single-amount/single-date document.
  return { amount: true, date: true };
}

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
  category_deprecated: { label: 'Category Removed', color: '#9F1239', bg: '#FFF1F2', dot: '#E11D48' },
  // A "mixed" category's status is the PERMANENT statutory nature of that
  // expense type (only ever partially deductible) — not a workflow state.
  // Once a human has confirmed the split, the document is done and should
  // never keep showing the same amber "Needs Review" treatment forever,
  // as if nothing happened. See badgeStatusFor's rationale below.
  deductible_partial: { label: 'Partially Deductible', color: '#0D9488', bg: '#ECFDF5', dot: '#0D9488' },
  relief:         { label: 'Relief',          color: '#7C3AED', bg: '#F5F3FF', dot: '#7C3AED' },
  donation:       { label: 'Donation',        color: '#0F6E56', bg: '#E1F5EE', dot: '#0F6E56' },
  non_deductible: { label: 'Personal',        color: '#DC2626', bg: '#FEF2F2', dot: '#DC2626' },
  capital:        { label: 'Capital Asset',   color: '#9A3412', bg: '#FFEDD5', dot: '#F97316' },
  not_applicable: { label: 'Not Applicable',  color: '#64748B', bg: '#F1F5F9', dot: '#94A3B8' },
  // CP500 installment notices/receipts — money already paid/scheduled toward
  // this year's tax bill, not a deductible expense and not "not applicable"
  // to the return the way a genuinely non-tax document is. Distinct blue-ish
  // tone so it doesn't read as either "Deductible" (teal) or the old gray
  // "Not Applicable" pill it used to incorrectly share (Ticket 1, 23 Jul 2026).
  tax_installment: { label: 'Tax Installment',  color: '#1D4ED8', bg: '#EFF6FF', dot: '#1D4ED8' },
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
    // Bug fix (found in review): computed live per-document by the backend
    // (_serialize_doc) — never year-scoped, so no risk of the same
    // scoping mismatch already found twice (Part G/H, the Overview
    // banner). categoryDeprecated means this document's stored category no
    // longer exists in the taxonomy at all; registryNote explains where a
    // registry-managed document's REAL figure actually lives (e.g. "feeds
    // your Capital Allowance schedule"), since it's correctly excluded from
    // this document's own totals and would otherwise just look like it
    // vanished with no explanation.
    categoryDeprecated: !!apiDoc.categoryDeprecated,
    registryNote: apiDoc.registryNote || null,
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
    // categoryDeprecated ALWAYS forces review regardless of the stored
    // aggregationState — a document's stored state can predate its category
    // being removed from the taxonomy, so this live-computed fact overrides it.
    needsReview:  apiDoc.categoryDeprecated
      ? true
      : (aggregationState
          ? (aggregationState === 'needs_apportionment' || aggregationState === 'needs_user_confirmation')
          : (apiDoc.taxStatus === 'mixed')),
    manual:       !!ed.manual_entry,
    accent:       STATUS_META[badgeStatusFor(apiDoc.category, apiDoc.taxStatus, apiDoc.status, aggregationState, ed.deductible_pct ?? null, apiDoc.categoryDeprecated)]?.color || '#64748B',
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
    content_truncated: !!ed.content_truncated,
    content_chars_dropped: ed.content_chars_dropped ?? null,
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
function badgeStatusFor(category, taxStatus, pipelineStatus, aggregationState, deductiblePct, categoryDeprecated) {
  // Takes priority over everything else — a document whose category no
  // longer exists needs reclassifying regardless of whatever status/
  // aggregationState happen to still be stored from before it was removed.
  if (categoryDeprecated) return 'category_deprecated';
  if (category && getCategoryBucket(category) === 'REFERENCE') return 'reference';
  // Bug fix: "mixed" describes a CATEGORY's permanent statutory nature
  // (only ever partially deductible under law) — it is NOT a workflow
  // state. Previously this badge showed "Needs Review" for a "mixed"
  // document FOREVER, even after a human confirmed its apportionment
  // split and the backend correctly resolved it (aggregationState ===
  // "resolved") — the document had genuinely left the review queue, but
  // the badge kept implying it hadn't, since it only ever looked at the
  // category's static taxStatus, never the actual resolution state.
  if (taxStatus === 'mixed' && aggregationState === 'resolved' && deductiblePct != null) {
    return 'deductible_partial';
  }
  return taxStatus || pipelineStatus;
}

function StatusBadge({ status, deductiblePct }) {
  // For completed docs show the tax_status; for in-flight show pipeline status
  const key = status || 'mixed';
  const m = STATUS_META[key] || STATUS_META.mixed;
  // Show the actual confirmed percentage ("50% Deductible") rather than the
  // generic fallback label, whenever we have it — more informative than a
  // one-size-fits-all "Partially Deductible" for every apportioned category.
  const label = (key === 'deductible_partial' && deductiblePct != null)
    ? `${deductiblePct}% Deductible`
    : m.label;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
      style={{ background: m.bg, color: m.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />
      {label}
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
function DocumentPreview({ doc, onClose, onReclassify, onArchive, onUnarchive, onMarkReviewed, onDelete }) {
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

  // Bug fix: "mixed" taxStatus is the PERMANENT statutory nature of an
  // apportioned category (e.g. Client & Corporate Gifts is only ever
  // partially deductible) — not a workflow state, so it never stops being
  // "mixed" even after a human confirms the split and the document is
  // fully resolved. Using the raw taxStatus here meant the action button
  // stayed stuck on "Review & Classify" (amber) forever, even for an
  // already-resolved document — never switching to "Re-classify" the way
  // an ordinary reclassified document does. doc.needsReview (driven by
  // aggregationState, already fixed for the Archive button below) is the
  // actual "does this still need the user's input" signal.
  const isMixed = doc.needsReview;
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
              {doc.content_truncated && (
                <span
                  title={doc.content_chars_dropped ? `${doc.content_chars_dropped.toLocaleString()} character(s) from later pages were not seen during classification` : undefined}
                  className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning border border-warning/30"
                >
                  Truncated — later pages not fully read
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
              <StatusBadge status={badgeStatusFor(doc.category, doc.taxStatus, doc.status, doc.aggregationState, doc.deductiblePct, doc.categoryDeprecated)} deductiblePct={doc.deductiblePct} />
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
            {/* Bank statements never resolve out of "needs review" on their
                own — their lines are matched once, at classification time,
                against whatever else existed then. This is the explicit
                human action that actually clears it (see PATCH
                /api/documents/{id}/mark-reviewed) — without it, a bank
                statement sits in the review queue forever with no way out. */}
            {doc.documentRole === 'ledger_source' && !isPipeline && doc.status !== 'archived' && doc.needsReview && (
              <button onClick={() => { handleClose(); onMarkReviewed(doc.id, true); }}
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover transition-colors duration-150">
                Mark as Reviewed
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
function ReclassifyModal({ doc, categoryGroups, onConfirm, onReset, onCancel }) {
  // Same fix as DocumentPreview above: "mixed" taxStatus is permanent for
  // an apportioned category, not a workflow state — use needsReview (the
  // real resolution signal) so the modal's heading/AI-reasoning block
  // correctly switches to "already classified" copy once a document is
  // actually resolved, instead of perpetually showing "AI couldn't decide"
  // for a document that's been confirmed and left the review queue.
  const isMixed = doc.needsReview;
  const amountMissing = !doc.amount || doc.amount === '—';
  const dateMissing = !doc.dateDisplay || doc.dateDisplay === '—';

  const [category, setCategory] = useState(
    doc.category && doc.category !== 'Unclassified' ? doc.category : 'Mixed / Pending Review'
  );

  // Amount/date are only meaningful for transaction-like documents. A balance
  // sheet / P&L / prior Form B (reference_document) or a bank statement
  // (ledger_source) is an aggregate, not one dated line item.
  //
  // Bug fix (found in testing): this now derives from whichever category is
  // CURRENTLY SELECTED in the dropdown (getCategoryRole(category), from the
  // taxonomy fetched via GET /api/categories), not the document's ORIGINAL
  // role. Previously, a document misclassified as "Mixed / Pending Review"
  // (role 'transaction') that a user reclassified to "Bank Statement —
  // Transaction Ledger" (role 'ledger_source' — many lines, never a single
  // amount) still demanded an amount before allowing confirmation, because
  // editability was frozen to the document's original role and never
  // recalculated as the category selection changed. Falls back to the
  // document's own stored role only while the taxonomy is still loading
  // (getCategoryRole returns null) or for the document's OWN unedited
  // category before any selection changes it.
  //   transaction / registry_managed → both amount and date are editable.
  //   reference_document (P&L, balance sheet, prior Form B, etc.) → carries
  //     no single transaction amount, but DOES have a meaningful document
  //     date, so the date is editable while the amount stays locked.
  //   ledger_source (bank statement) → neither; it's many lines, not one.
  //   unknown role (older/manual docs, or taxonomy still loading) → editable
  //     for both, as before.
  const selectedCategoryRole = getCategoryRole(category) || doc.documentRole || null;
  const { amount: amountRoleEditable, date: dateRoleEditable } = editabilityForRole(selectedCategoryRole);

  // Only the data points the LLM COULDN'T capture are editable — a field the AI
  // read correctly stays locked so the user can't accidentally corrupt it. The
  // "Edit anyway" override unlocks everything for the rare correction case.
  const [override, setOverride] = useState(false);
  const canEditAmount   = override ? amountRoleEditable : (amountRoleEditable && !doc.llmAmountCaptured);
  const canEditDate     = override ? dateRoleEditable   : (dateRoleEditable   && !doc.llmDateCaptured);
  const canEditCategory = override ? true : !doc.llmCategoryDecided;
  const nothingEditable = !canEditAmount && !canEditDate && !canEditCategory;

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

  // Derive status from selected category — now a direct lookup of the
  // backend's OWN persisted-status value for this category (via
  // GET /api/categories' `status` field, cached by getCategoryStatus),
  // never independently re-derived or guessed. This matters because
  // derivedStatus is sent straight to PATCH /api/documents/{id}/reclassify
  // as the actual `status` value (see handleConfirm below) — it must match
  // exactly what auto-classification would have produced for the same
  // category, not just approximate it.
  const derivedStatus = getCategoryStatus(category) || 'mixed';

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
        {doc.categoryDeprecated ? (
          <div className="rounded-lg border border-critical/30 bg-critical-bg px-3 py-2.5 mb-4">
            <p className="text-xs font-semibold text-critical mb-1">This category no longer exists</p>
            <p className="text-xs text-critical leading-relaxed">
              This document was classified as "{categoryLabel(doc.category)}", which is no longer part
              of the current category list — it may have been renamed or split during a taxonomy update.
              Please select a new category below.
            </p>
          </div>
        ) : isMixed ? (
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
            {/* Registry-managed documents (capital assets, CP500, breastfeeding,
                food waste/CCTV, departure levy) are correctly EXCLUDED from
                their own direct total — without this note, that exclusion
                just looks like the document vanished with no explanation.
                Bug fix: this was computed by the backend all along but never
                shown anywhere in the frontend. */}
            {doc.registryNote && (
              <div className="rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] px-3 py-2.5 mb-4">
                <p className="text-xs font-semibold text-[#075985] mb-1">This document isn't summed directly</p>
                <p className="text-xs text-[#0C4A6E] leading-relaxed">{doc.registryNote}</p>
              </div>
            )}
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
          categoryGroups === null ? (
            // Still fetching GET /api/categories — a plain, honest loading
            // state rather than a select with no options at all.
            <div className="w-full rounded-lg border border-border bg-[#F8FAFC] px-3 py-2 text-sm text-muted mb-2">
              Loading categories…
            </div>
          ) : categoryGroups.length === 0 ? (
            // Fetch failed — don't silently show a broken/empty dropdown;
            // fall back to read-only with a clear reason, same as the
            // "not editable" branch below.
            <div className="w-full rounded-lg border border-border bg-[#FCEBEB] px-3 py-2 text-sm text-critical mb-2">
              Couldn't load the category list — please refresh and try again.
            </div>
          ) : (
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-headings mb-2 focus:outline-none focus:border-primary cursor-pointer"
            >
              {categoryGroups.map(group => (
                <optgroup key={group.bucket} label={group.groupLabel}>
                  {group.categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </optgroup>
              ))}
            </select>
          )
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
          <StatusBadge status={getCategoryBucket(category) === 'REFERENCE' ? 'reference' : derivedStatus} />
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
function ManualUploadModal({ categoryGroups, onConfirm, onCancel }) {
  const [docType, setDocType] = useState('Invoice');
  const [vendor, setVendor] = useState('');
  const [vendorAddr, setVendorAddr] = useState('');
  const [docNo, setDocNo] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lineItems, setLineItems] = useState([{ desc: '', amt: '' }]);
  const [category, setCategory] = useState('Q3 — Cost of Goods Sold');
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
            {categoryGroups === null ? (
              <div className="w-full rounded-lg border border-border bg-[#F8FAFC] px-3 py-2 text-xs text-muted">Loading categories…</div>
            ) : categoryGroups.length === 0 ? (
              <div className="w-full rounded-lg border border-border bg-[#FCEBEB] px-3 py-2 text-xs text-critical">Couldn't load categories — refresh and try again.</div>
            ) : (
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs text-headings focus:outline-none focus:border-primary cursor-pointer">
                {categoryGroups.map(group => (
                  <optgroup key={group.bucket} label={group.groupLabel}>
                    {group.categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
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

function UploadTab({ docs, uploads, categoryGroups, onFileDrop, onRemove, onArchive, onUnarchive, onMarkReviewed, onRetry, onUpdateStatus, onReset, onManualAdd, initialStateFilter }) {
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

  // Deep-link support: if the URL has ?docId=N (from the Overview action
  // banner's "View Document" button for a specific pending item — see the
  // banner rework fixing the gap where clicking "Review" only ever landed
  // on a generic filtered list, never the actual flagged document), open
  // that document's preview automatically once it's loaded, instead of
  // making the user hunt for it in the list themselves. Guarded by a ref so
  // it only auto-opens ONCE per docId — closing the modal shouldn't make it
  // pop back open on some later, unrelated re-render.
  const autoOpenedDocIdRef = useRef(null);
  useEffect(() => {
    const docId = new URLSearchParams(window.location.search).get('docId');
    if (!docId || docs.length === 0 || autoOpenedDocIdRef.current === docId) return;
    const match = docs.find(d => String(d.id) === docId);
    if (match) {
      setPreviewDoc(match);
      autoOpenedDocIdRef.current = docId;
    }
  }, [docs]);

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
    { value: 'all',     label: 'All categories' },
    { value: 'Q1',      label: 'Business Income' },
    { value: 'Q2',      label: 'Personal Income' },
    { value: 'Q3',      label: 'Business Expense' },
    { value: 'Q4R',     label: 'Personal Relief' },
    { value: 'Q4D',     label: 'Donations (Part G)' },
    { value: 'Q4P',     label: 'Personal Expense (Non-deductible)' },
    { value: 'TAXPAID', label: 'Tax Installments Already Paid' },
    { value: 'REBATE',  label: 'Tax Rebates' },
    { value: 'REF',     label: 'Reference & Reconciliation' },
  ];

  const availableYears = [...new Set(completedDocs.map(d => d.date ? d.date.slice(0, 4) : null).filter(Boolean))].sort((a, b) => b - a);

  // Bug fix (17 Jul 2026): if every document in the currently-selected
  // yearFilter gets deleted, availableYears recomputes without that year,
  // but yearFilter itself was never reset — the <select> then silently
  // falls back to displaying its first option ("All Years") since its
  // bound value no longer matches any real <option>, while yearFilter's
  // actual STATE stays pinned to the now-nonexistent year. The filter
  // logic below still runs against that stale value, so every document —
  // including ones from other years — gets excluded, even though the
  // dropdown visually claims "All Years" is selected.
  useEffect(() => {
    if (yearFilter !== 'all' && !availableYears.includes(yearFilter)) {
      setYearFilter('all');
    }
  }, [availableYears, yearFilter]);

  let filtered = completedDocs.filter(d => {
    // ── State axis (cross-cutting) ──
    if (stateFilter === 'archived') return d.status === 'archived';
    if (d.status === 'archived') return false;               // hide archived unless viewing them
    if (stateFilter === 'failed' && d.status !== 'failed') return false;
    if (stateFilter === 'needs_review' && !d.needsReview) return false;

    // ── Category axis (bucket) — composes with the state axis ──
    if (categoryFilter !== 'all') {
      const cat = d.category || '';
      const bucket = getCategoryBucket(cat);
      if (categoryFilter === 'Q1'  && bucket !== 'Q1') return false;
      if (categoryFilter === 'Q2'  && bucket !== 'Q2') return false;
      if (categoryFilter === 'Q3'  && bucket !== 'Q3') return false;
      if (categoryFilter === 'Q4R' && !(bucket === 'Q4' && getCategoryStatus(cat) === 'relief')) return false;
      if (categoryFilter === 'Q4D' && bucket !== 'DONATIONS') return false;
      if (categoryFilter === 'Q4P' && !(bucket === 'Q4' && getCategoryStatus(cat) === 'non_deductible')) return false;
      if (categoryFilter === 'TAXPAID' && bucket !== 'TAX_INSTALLMENTS') return false;
      if (categoryFilter === 'REBATE'  && bucket !== 'REBATES') return false;
      if (categoryFilter === 'REF' && bucket !== 'REFERENCE') return false;
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
      setLimitToast('You can upload at most 10 files at once. Please select 10 or fewer.');
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
        <ReclassifyModal doc={reclassDoc} categoryGroups={categoryGroups} onConfirm={handleReclassifyConfirm} onReset={handleResetConfirm} onCancel={() => setReclassDoc(null)} />
      )}
      {previewDoc && (
        <DocumentPreview
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onReclassify={(d) => { setPreviewDoc(null); setReclassDoc(d); }}
          onArchive={(id) => { setPreviewDoc(null); onArchive(id); }}
          onUnarchive={(id) => { setPreviewDoc(null); onUnarchive(id); }}
          onMarkReviewed={(id, reviewed) => { setPreviewDoc(null); onMarkReviewed(id, reviewed); }}
          onDelete={(id) => { setPreviewDoc(null); onRemove(id); }}
        />
      )}
      {manualUploadOpen && (
        <ManualUploadModal
          categoryGroups={categoryGroups}
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
                      <StatusBadge status={badgeStatusFor(doc.category, doc.taxStatus, doc.status, doc.aggregationState, doc.deductiblePct, doc.categoryDeprecated)} deductiblePct={doc.deductiblePct} />
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
  // Insight deep-link: /account?doc=<id>&action=reclassify|classify opens that
  // document's modal directly (see UploadTab's deep-link effect).
  const deepLink = (() => {
    const p = new URLSearchParams(window.location.search);
    const docId = parseInt(p.get('doc') || '', 10);
    const action = p.get('action');
    return {
      docId: Number.isFinite(docId) ? docId : null,
      action: ['reclassify', 'classify'].includes(action) ? action : null,
    };
  })();
  const [docs, setDocs]     = useState([]);       // resolved backend docs (mapped)
  const [uploads, setUploads] = useState([]);     // in-flight upload entries
  const [docsLoading, setDocsLoading] = useState(true);
  const [activeEntity, setActiveEntity] = useState(null);
  // Canonical category taxonomy, fetched ONCE from the backend
  // (GET /api/categories — see api.js) rather than hand-copied here. This
  // is the fix for the taxonomy-drift bugs found in review: the old
  // hardcoded Q1_CATEGORIES/RECLASSIFY_GROUPS arrays fell out of sync with
  // the backend across several refactors (the CP500 split, the H6/H7/H8
  // granularity split, and — concretely — Bank Statement never being added
  // as a selectable reclassify option at all). Now there's only one place
  // the taxonomy is defined; this component can't drift from it again.
  const [categoryGroups, setCategoryGroups] = useState(null); // null = still loading
  // Uploads are gated until the first entity resolution completes: a file
  // dropped before then would be stored with entity_id=null and its insights
  // would never appear in an entity-filtered inbox fetch.
  const [entityResolved, setEntityResolved] = useState(false);
  // Doc IDs currently being polled, so the resume-poller never double-polls a
  // doc that a fresh upload / retry is already tracking.
  const pollingRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    API.getCategories()
      .then((data) => {
        const groups = data.groups || [];
        setCategoryLookupCache(groups);
        if (!cancelled) setCategoryGroups(groups);
      })
      .catch((err) => {
        console.error('Failed to load category taxonomy:', err);
        if (!cancelled) setCategoryGroups([]); // empty, not null — stop showing "loading" forever
      });
    return () => { cancelled = true; };
  }, []);

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
  // UploadTab's own MAX_FILES=10 guard (see handleFiles above) rejects
  // anything over 10 files before this function is ever called, showing
  // limitToast instead — so this function can never receive more than
  // MAX_BATCH_FILES (10) files, which a single batch-upload call already
  // handles in one request. That's why there's no chunking or pausing here:
  // a lone file goes through the single-upload endpoint (10/minute), and
  // anything from 2-10 files goes through one batchUploadDocuments() call
  // (rate-limited to 1/minute server-side, but since one call always covers
  // the full worst case of 10 files, that's still an effective 10 files/
  // minute ceiling — the same as the single-upload path, just reached via a
  // single request instead of one request per file.
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

    const handleDuplicateOrError = (entry, errorMessage, status) => {
      if (status === 409 && errorMessage.startsWith('DUPLICATE:')) {
        const [, existingId] = errorMessage.split(':');
        setDupToast({ fileName: entry.fileName, existingId });
        setTimeout(() => setDupToast(null), 6000);
      } else {
        console.error('[Upload] Failed:', entry.fileName, errorMessage);
      }
      URL.revokeObjectURL(entry.objectUrl);
      setUploads(prev => prev.filter(e => e.localId !== entry.localId));
    };

    if (entries.length === 1) {
      const entry = entries[0];
      try {
        const result = await API.uploadDocument(entry.file, userId, entityId);
        setUploads(prev => prev.map(e => e.localId === entry.localId
          ? { ...e, docId: result.document_id }
          : e
        ));
        pollUntilResolved(entry.localId, result.document_id, entry.objectUrl);
      } catch (err) {
        const detail = err?.response?.data?.detail || 'Upload failed.';
        handleDuplicateOrError(entry, detail, err?.response?.status);
      }
      return;
    }

    try {
      const result = await API.batchUploadDocuments(entries.map(e => e.file), userId, entityId);

      // The backend processes file_contents in the exact order submitted and
      // never reorders successes ahead of failures within that order, but a
      // batch can contain a MIX of queued and errored files — walk both
      // arrays back against entries by matching on fileName (unique per
      // entry via localId already; fileName is what the backend echoes back
      // in both `queued` and `errors`).
      const queuedByName = new Map((result.queued || []).map(q => [q.file_name, q]));
      const errorsByName = new Map((result.errors || []).map(e => [e.file_name, e]));

      entries.forEach(entry => {
        const queued = queuedByName.get(entry.fileName);
        const errored = errorsByName.get(entry.fileName);
        if (queued) {
          setUploads(prev => prev.map(e => e.localId === entry.localId
            ? { ...e, docId: queued.document_id }
            : e
          ));
          pollUntilResolved(entry.localId, queued.document_id, entry.objectUrl);
        } else if (errored) {
          // Batch errors carry the same "DUPLICATE:{id}:{name}" convention as
          // the single-file endpoint's 409 detail, just without an HTTP
          // status attached (the batch call itself succeeded as a request;
          // individual files failed inside it) — treat a DUPLICATE-prefixed
          // error the same way regardless.
          handleDuplicateOrError(entry, errored.error || 'Upload failed.', errored.error?.startsWith('DUPLICATE:') ? 409 : undefined);
        } else {
          // Shouldn't happen (every submitted file should land in one array
          // or the other), but don't leave an orphaned "uploading" card.
          handleDuplicateOrError(entry, 'No result returned for this file.', undefined);
        }
      });
    } catch (err) {
      // The whole batch request failed (e.g. a network error) — every file
      // gets the same treatment, since none were individually queued or
      // rejected by the server in this case.
      const detail = err?.response?.data?.detail || 'Upload failed.';
      entries.forEach(entry => handleDuplicateOrError(entry, detail, err?.response?.status));
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

  // ── Mark bank statement reviewed ────────────────────────────────────────
  // Unlike archive/unarchive (a simple status flip we can optimistically
  // guess), the resulting aggregation_state here is backend-computed (via
  // derive_aggregation_state's bank_statement_reviewed parameter) — so this
  // just uses the full, updated document the endpoint already returns,
  // rather than guessing the new state client-side.
  const markReviewedDoc = useCallback(async (id, reviewed = true) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    try {
      const full = await API.markDocumentReviewed(id, reviewed, userId, entityId);
      setDocs(prev => prev.map(d => d.id === id ? mapApiDoc(full) : d));
    } catch (e) {
      console.error('[MarkReviewed]', e);
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
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Cukai Documents</h1>
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
                categoryGroups={categoryGroups}
                onFileDrop={handleFileDrop}
                onRemove={removeDoc}
                onArchive={archiveDoc}
                onUnarchive={unarchiveDoc}
                onMarkReviewed={markReviewedDoc}
                onRetry={retryDoc}
                onUpdateStatus={updateDocStatus}
                onReset={resetDoc}
                onManualAdd={manualAddDoc}
                initialStateFilter={initialStateFilter}
                initialDocTarget={deepLink.docId}
                initialDocAction={deepLink.action}
              />
            )}
          </div>
        </div>

      </div>
    </main>
  );
}

export default CukaiAccount;