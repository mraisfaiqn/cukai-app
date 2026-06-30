import { useRef, useState, useCallback, useEffect } from 'react';
import * as API from '../services/api';
import cukaiLogo from '../assets/cukai-logo.png';

// ─── Design tokens (matches ManageAccount + UserNavigation) ───────────────────
// Primary teal: #0F6E56  Active: #0D9488  Text: #0F172A  Muted: #64748B  Border: #E2E8F0

// ─── User scenarios ───────────────────────────────────────────────────────────
const USER_SCENARIOS = {
  A: {
    label: 'Sole Proprietor', description: 'You operate as a sole proprietor.',
    canViewFormP: false, canFileFormP: false, canFileFormB: true, firm: null,
  },
  B: {
    label: 'Principal Partner', description: 'You are the principal partner of Meridian Print Studio.',
    canViewFormP: true, canFileFormP: true, canFileFormB: true,
    firm: { name: 'Meridian Print Studio', msic: '1811', type: 'Partnership', share: '50%' },
  },
  C: {
    label: 'Partner (Non-Principal)', description: 'You are a partner of Meridian Print Studio, but not the principal partner.',
    canViewFormP: true, canFileFormP: false, canFileFormB: true,
    firm: { name: 'Meridian Print Studio', msic: '1811', type: 'Partnership', share: '30%' },
  },
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
  'Q4 — Medical & Parental Care',
  'Q4 — Lifestyle Relief',
  'Q4 — Education Relief',
  'Q4 — Child Relief',
  'Q4 — Medical Equipment Relief',
  'Q4 — Private Retirement Scheme (PRS)',
  'Q4 — SOCSO Personal Contribution',
  'Q4 — Domestic Tourism Relief',
  'Q4 — EV Charging Equipment',
  'Q4 — Zakat',
];
const Q4_NON_DED_CATEGORIES = [
  'Q4 — Personal Living Expenses',
  'Q4 — Personal Travel & Leisure',
  'Q4 — Personal Dining & Entertainment',
  'Q4 — Personal Shopping',
  'Q4 — Personal Medical Expenses',
  'Q4 — Family & Childcare Expenses',
];

// For the reclassify modal — grouped for the dropdown
const RECLASSIFY_GROUPS = [
  { label: 'Q1 — Business Income', cats: Q1_CATEGORIES },
  { label: 'Q2 — Personal Income', cats: Q2_CATEGORIES },
  { label: 'Q3 — Business Expense', cats: Q3_CATEGORIES },
  { label: 'Q4 — Relief', cats: Q4_RELIEF_CATEGORIES },
  { label: 'Q4 — Personal (Non-deductible)', cats: Q4_NON_DED_CATEGORIES },
];

// ─── Status meta ──────────────────────────────────────────────────────────────
const STATUS_META = {
  income:         { label: 'Income',          color: '#0369A1', bg: '#EFF6FF', dot: '#0369A1' },
  deductible:     { label: 'Deductible',      color: '#0F6E56', bg: '#ECFDF5', dot: '#0F6E56' },
  mixed:          { label: 'Needs Review',    color: '#B45309', bg: '#FFFBEB', dot: '#F59E0B' },
  relief:         { label: 'Relief',          color: '#7C3AED', bg: '#F5F3FF', dot: '#7C3AED' },
  non_deductible: { label: 'Personal',        color: '#DC2626', bg: '#FEF2F2', dot: '#DC2626' },
  not_applicable: { label: 'Capital / N/A',   color: '#64748B', bg: '#F1F5F9', dot: '#94A3B8' },
  pending:        { label: 'Uploading…',      color: '#64748B', bg: '#F8FAFC', dot: '#CBD5E1' },
  processing:     { label: 'Classifying…',   color: '#0369A1', bg: '#EFF6FF', dot: '#0369A1' },
  failed:         { label: 'Failed',          color: '#DC2626', bg: '#FEF2F2', dot: '#DC2626' },
  archived:       { label: 'Archived',        color: '#64748B', bg: '#F1F5F9', dot: '#94A3B8' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseAmt = (s) => parseFloat((s || '').replace(/[^\d.]/g, '')) || 0;
const fmtRM = (v) => 'RM ' + Number(v).toLocaleString('en-MY', { maximumFractionDigits: 0 });
// ─── Tab navigation ───────────────────────────────────────────────────────────
function CukaiTabNav({ active, onChange }) {
  const tabs = [
    { id: 'upload', label: 'Upload Documents' },
    { id: 'generate', label: 'Generate Report' },
  ];
  return (
    <nav className="flex items-center gap-2 border-b border-slate-100 pb-px shrink-0">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`relative px-4 py-2.5 text-sm font-medium transition-all duration-150 select-none ${
            active === t.id ? 'text-[#0D9488] font-semibold' : 'text-[#64748B] hover:text-[#0F172A]'
          }`}>
          {t.label}
          {active === t.id && <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-[#0F6E56]" />}
        </button>
      ))}
    </nav>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function mapApiDoc(apiDoc) {
  const ed = apiDoc.extractedData || {};
  return {
    id:           apiDoc.id,
    name:         apiDoc.fileName,
    type:         apiDoc.documentType || 'Unclassified',
    date:         ed.date || apiDoc.uploadedAt || '',
    amount:       ed.amount || '—',
    status:       apiDoc.status,           // 'pending'|'processing'|'completed'|'failed'|'archived'
    taxStatus:    apiDoc.taxStatus,       // 'income'|'deductible'|'mixed'|'relief'|'non_deductible'|'not_applicable'
    category:     apiDoc.category || 'Mixed / Pending Review',
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
  const [progress, setProgress] = useState(5);

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
    : phase === 'done' ? '#0F6E56'
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
            <p className="text-[11px] font-medium text-[#0F172A] truncate">{entry.fileName}</p>
            <div className="mt-1.5 h-1 w-full rounded-full bg-[#E2E8F0] overflow-hidden">
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
            <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: barColor }}>
              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: barColor }} />
              {phaseLabel}
            </span>
          )}
          {phase === 'done' && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[#0F6E56] font-semibold">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Classified
            </span>
          )}
          {phase === 'failed' && (
            <span className="text-[10px] text-[#DC2626] font-semibold">Failed — check file</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  // For completed docs show the tax_status; for in-flight show pipeline status
  const key = status || 'mixed';
  const m = STATUS_META[key] || STATUS_META.mixed;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
      style={{ background: m.bg, color: m.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

// ─── Confidence badge ─────────────────────────────────────────────────────────
function ConfidenceBadge({ value }) {
  if (value === null || value === undefined) return null;
  const color = value >= 90 ? '#0F6E56' : value >= 70 ? '#B45309' : '#DC2626';
  const bg    = value >= 90 ? '#ECFDF5' : value >= 70 ? '#FFFBEB' : '#FEF2F2';
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: bg, color }}>
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
  if (!fileUrl) {
    // Fallback canvas renderer for locally-generated manual docs
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
          className="max-h-full max-w-full object-contain rounded-lg shadow-xl border border-[#E2E8F0]"
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
          <svg className="mx-auto mb-3 h-12 w-12 text-[#0F6E56]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
          </svg>
          <p className="text-xs font-medium text-[#0F172A]">{doc.name}</p>
          <p className="text-[10px] text-[#64748B] mt-1">Spreadsheet files cannot be previewed in-browser.</p>
          <a href={fileUrl} download={doc.name}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#0F6E56] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0A5140] transition-colors">
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
function DocumentPreview({ doc, onClose, onReclassify, onArchive, onDelete }) {
  const [visible, setVisible] = useState(false);
  const [fileUrl, setFileUrl] = useState(null);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  // Build a URL to the file served by the backend's /files/ static mount
  useEffect(() => {
    if (!doc) return;
    if (doc._apiRaw?.file_path) {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      // file_path is stored as e.g. "./stored_documents/abc123_receipt.pdf"
      // The /files/ static mount serves from the stored_documents directory,
      // so we just need the basename.
      const basename = doc._apiRaw.file_path.split(/[\\/]/).pop();
      setFileUrl(`${API_URL}/files/${encodeURIComponent(basename)}`);
    } else if (doc._localObjectUrl) {
      // Blob URL created at upload time — still valid if same session
      setFileUrl(doc._localObjectUrl);
    }
    // No cleanup needed: backend URLs don't need revocation; blob URLs are
    // revoked when the parent upload entry is cleared.
  }, [doc?._apiRaw?.file_path, doc?._localObjectUrl]);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 300); };

  const isMixed = doc.taxStatus === 'mixed' || doc.status === 'mixed';
  const isPipeline = doc.status === 'pending' || doc.status === 'processing';

  return (
    <div className="fixed inset-0 z-50 flex" onClick={handleClose}>
      <div className={`flex-1 bg-black/40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`relative flex h-full w-[640px] max-w-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3 bg-[#F8FAFC] shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#0F172A] truncate">{doc.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[10px] text-[#64748B]">{doc.type || 'Document'}</p>
              {doc.date && <><span className="text-[#CBD5E1]">·</span><p className="text-[10px] text-[#64748B]">{doc.date}</p></>}
              {doc.ocr_quality && doc.ocr_quality !== 'good' && (
                <span className="rounded-full bg-[#FFFBEB] px-2 py-0.5 text-[9px] font-semibold text-[#B45309] border border-[#FDE68A]">
                  OCR: {doc.ocr_quality}
                </span>
              )}
            </div>
          </div>
          <button onClick={handleClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors shrink-0 ml-3">
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
              <p className="text-sm font-medium text-[#0F172A]">AI is reading your document…</p>
              <p className="text-[10px] text-[#64748B]">Classification usually takes 15–45 seconds depending on file complexity.</p>
            </div>
          ) : (
            <div className="h-full overflow-auto">
              <FilePreviewRenderer doc={doc} fileUrl={fileUrl} />
            </div>
          )}
        </div>

        {/* Classification footer */}
        <div className="shrink-0 border-t border-[#E2E8F0] bg-white px-5 py-4 space-y-3">
          {/* Status + confidence row */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#64748B]">Classification</span>
            <div className="flex items-center gap-2">
              <ConfidenceBadge value={doc.confidence} />
              <StatusBadge status={doc.taxStatus || doc.status} />
            </div>
          </div>

          {/* Category */}
          {doc.category && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#64748B]">Category</span>
              <span className="text-[10px] font-medium text-[#0F172A] text-right max-w-[260px] truncate">{doc.category}</span>
            </div>
          )}

          {/* ITA section */}
          {doc.ita_section && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#64748B]">ITA Reference</span>
              <span className="text-[10px] font-mono text-[#0369A1]">{doc.ita_section}</span>
            </div>
          )}

          {/* Amount */}
          {doc.amount && doc.amount !== '—' && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#64748B]">Amount</span>
              <span className="text-xs font-bold text-[#0F172A]">{doc.amount}</span>
            </div>
          )}

          {/* AI note */}
          {doc.note && (
            <div className="rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2">
              <p className="text-[9px] font-semibold text-[#64748B] uppercase tracking-wide mb-0.5">AI Note</p>
              <p className="text-[10px] text-[#334155] leading-relaxed">{doc.note}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            {isMixed && !isPipeline && (
              <button onClick={() => { handleClose(); onReclassify(doc); }}
                className="flex-1 rounded-lg bg-[#B45309] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#92400E] transition-colors">
                Review &amp; Classify
              </button>
            )}
            {!isMixed && !isPipeline && doc.status !== 'archived' && (
              <button onClick={() => { handleClose(); onReclassify(doc); }}
                className="flex-1 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2.5 text-xs font-semibold text-[#64748B] hover:border-[#0D9488] hover:text-[#0D9488] transition-colors">
                Re-classify
              </button>
            )}
            {doc.status !== 'archived' && !isPipeline && (
              <button onClick={() => { handleClose(); onArchive(doc.id); }}
                className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2.5 text-xs font-semibold text-[#64748B] hover:border-[#64748B] transition-colors"
                title="Archive">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
                </svg>
              </button>
            )}
            <button onClick={() => { handleClose(); onDelete(doc.id); }}
              className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2.5 text-xs font-semibold text-[#DC2626]/60 hover:border-[#DC2626] hover:text-[#DC2626] transition-colors"
              title="Delete">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
function ReclassifyModal({ doc, onConfirm, onCancel }) {
  const isMixed = doc.taxStatus === 'mixed' || doc.status === 'mixed';

  const [category, setCategory] = useState(doc.category || 'Mixed / Pending Review');
  const [saving, setSaving] = useState(false);

  // Derive status from selected category
  const deriveStatus = (cat) => {
    if (Q1_CATEGORIES.includes(cat) || Q2_CATEGORIES.includes(cat)) return 'income';
    if (Q3_CATEGORIES.filter(c => !['Q3 — Client Entertainment (50% cap)', 'Q3 — Client & Corporate Gifts', 'Q3 — Mixed-Use Vehicle Expenses', 'Q3 — Capital Assets & Equipment', 'Q3 — Capital Renovation & Fit-Out', 'Q3 — Hire Purchase & Leased Assets', 'Q3 — CP500 / Tax Installment'].includes(c)).includes(cat)) return 'deductible';
    if (['Q3 — Capital Assets & Equipment', 'Q3 — Capital Renovation & Fit-Out', 'Q3 — CP500 / Tax Installment'].includes(cat)) return 'not_applicable';
    if (['Q3 — Client Entertainment (50% cap)', 'Q3 — Client & Corporate Gifts', 'Q3 — Mixed-Use Vehicle Expenses', 'Q3 — Hire Purchase & Leased Assets'].includes(cat)) return 'mixed';
    if (Q4_RELIEF_CATEGORIES.includes(cat)) return 'relief';
    if (Q4_NON_DED_CATEGORIES.includes(cat)) return 'non_deductible';
    return 'mixed';
  };

  const derivedStatus = deriveStatus(category);

  const confidence = isMixed ? (doc.confidence ?? 50) : (doc.confidence ?? 75);
  const confTone = confidence >= 90 ? { color: '#0F6E56', bg: '#ECFDF5' }
    : confidence >= 70 ? { color: '#B45309', bg: '#FFFBEB' }
    : { color: '#DC2626', bg: '#FEF2F2' };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onConfirm(derivedStatus, category);
    } finally {
      setSaving(false);
    }
  };

  // Fallback text when LLM fields are null
  const fallbackReason = `The AI matched this document to "${doc.category}" based on the vendor name, line items, and amount. It assigned ${confidence}% confidence to this classification.`;
  const fallbackQuestion = 'Does this classification look correct? If not, please select the most accurate category below and confirm.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#E2E8F0] w-[480px] max-h-[88vh] overflow-y-auto p-6 mx-4" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#0F172A]">
              {isMixed ? 'Classify this document' : 'Re-classify this document'}
            </p>
            <p className="text-[10px] text-[#64748B] mt-0.5 truncate">{doc.name} · {doc.amount}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col items-end">
              <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: confTone.bg, color: confTone.color }}>
                {confidence}% confidence
              </span>
              <span className="text-[8px] text-[#94A3B8] mt-0.5 mr-0.5">
                {isMixed ? 'AI is undecided' : 'AI classification accuracy'}
              </span>
            </div>
            <button onClick={onCancel} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors">
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
            <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5 mb-3">
              <p className="text-[10px] font-semibold text-[#B45309] mb-1">Why the AI couldn't decide</p>
              <p className="text-[10px] text-[#92400E] leading-relaxed">
                {doc.reason || fallbackReason}
              </p>
              {doc.source && (
                <p className="text-[9px] text-[#B45309]/80 mt-1.5 italic">Source: {doc.source}</p>
              )}
            </div>
            {/* Guiding question */}
            <div className="rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] px-3 py-2.5 mb-4">
              <p className="text-[10px] font-semibold text-[#075985] mb-1">A question to help you decide</p>
              <p className="text-[10px] text-[#0C4A6E] leading-relaxed">
                {doc.question || fallbackQuestion}
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Why the AI placed it here */}
            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 mb-3">
              <p className="text-[10px] font-semibold text-[#334155] mb-1">Why the AI classified it this way</p>
              <p className="text-[10px] text-[#64748B] leading-relaxed">
                {doc.note || fallbackReason}
              </p>
              <p className="text-[9px] text-[#94A3B8] mt-1.5">
                Currently: <span className="font-semibold text-[#0F172A]">{STATUS_META[doc.taxStatus]?.label || doc.taxStatus}</span> · <span className="font-semibold text-[#0F172A]">{doc.category}</span>
              </p>
            </div>
            <div className="rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] px-3 py-2.5 mb-4">
              <p className="text-[10px] font-semibold text-[#075985] mb-1">Does this still look right?</p>
              <p className="text-[10px] text-[#0C4A6E] leading-relaxed">
                {doc.question || fallbackQuestion}
              </p>
            </div>
          </>
        )}

        {/* ITA reference if available */}
        {doc.ita_section && (
          <div className="mb-3 flex items-center gap-2 text-[10px] text-[#64748B]">
            <span className="rounded bg-[#EFF6FF] px-2 py-0.5 font-mono text-[#0369A1] font-semibold">{doc.ita_section}</span>
            <span>ITA 1967 reference</span>
          </div>
        )}

        {/* Category picker */}
        <label className="block text-[10px] font-semibold text-[#0F172A] mb-1.5">Select the correct category</label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] mb-2 focus:outline-none focus:border-[#0D9488] cursor-pointer"
        >
          {RECLASSIFY_GROUPS.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.cats.map(c => <option key={c} value={c}>{c}</option>)}
            </optgroup>
          ))}
          <option value="Mixed / Pending Review">Mixed / Pending Review</option>
          <option value="Non-Tax Document">Non-Tax Document</option>
        </select>

        {/* Derived status preview */}
        <div className="flex items-center gap-2 mb-5 px-1">
          <span className="text-[10px] text-[#64748B]">Will be classified as:</span>
          <StatusBadge status={derivedStatus} />
        </div>

        {/* Confirm */}
        <button
          onClick={handleConfirm}
          disabled={saving}
          className="w-full rounded-xl border-2 border-[#0F6E56] bg-[#F0FDF9] px-4 py-3 text-sm font-bold text-[#0F6E56] hover:bg-[#D1FAE5] transition-colors disabled:opacity-60"
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
    const accent = doc.accent || '#0F6E56';
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
    ctx.fillText(`Date: ${doc.date}`, 36, y); y += 26;
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
  return <canvas ref={canvasRef} className="block mx-auto rounded-lg shadow-xl border border-[#E2E8F0]" style={{ background: '#fff' }} />;
}

// ─── Spreadsheet table renderer ───────────────────────────────────────────────
function SpreadsheetTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  const colLetters = Array.from({ length: rows[0].length }, (_, i) => String.fromCharCode(65 + i));
  return (
    <div className="rounded-lg border border-[#E2E8F0] overflow-hidden shadow-xl bg-white m-4">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr>
            <th className="w-8 border border-[#E2E8F0] bg-[#E8EBEF] text-[9px] text-[#94A3B8]"></th>
            {colLetters.map(l => <th key={l} className="border border-[#E2E8F0] bg-[#E8EBEF] text-[9px] font-medium text-[#94A3B8] py-1">{l}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri === 0 ? 'bg-[#0F6E56]' : ri % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFC]'}>
              <td className="border border-[#E2E8F0] bg-[#F1F5F9] text-center text-[9px] text-[#94A3B8] py-1.5">{ri + 1}</td>
              {row.map((cell, ci) => (
                <td key={ci} className={`border border-[#E2E8F0] px-2.5 py-1.5 whitespace-nowrap ${ri === 0 ? 'font-bold text-white' : ci === row.length - 1 ? 'text-right font-medium text-[#0F172A]' : 'text-[#334155]'}`}>
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

  const updateLineItem = (i, field, value) =>
    setLineItems(prev => prev.map((li, idx) => idx === i ? { ...li, [field]: value } : li));
  const addLineItem = () => setLineItems(prev => [...prev, { desc: '', amt: '' }]);
  const removeLineItem = (i) => setLineItems(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

  const total = lineItems.reduce((s, li) => s + (parseFloat(li.amt) || 0), 0);
  const formattedDate = date ? new Date(date).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const isValid = vendor.trim() && docNo.trim() && date && lineItems.every(li => li.desc.trim() && parseFloat(li.amt) > 0);
  const derivedStatus = Q4_RELIEF_CATEGORIES.includes(category) ? 'relief'
    : Q4_NON_DED_CATEGORIES.includes(category) ? 'non_deductible'
    : (Q1_CATEGORIES.includes(category) || Q2_CATEGORIES.includes(category)) ? 'income'
    : 'deductible';

  const buildDoc = () => ({
    id: Date.now() + Math.random(),
    name: `${docType.replace(/\s+/g, '_')}_${(vendor || 'Manual').replace(/\s+/g, '_')}_${date || 'undated'}.pdf`,
    type: docType, fileType: 'pdf', date: formattedDate, amount: fmtRM(total),
    status: 'completed', taxStatus: derivedStatus, category,
    note: notes || 'Manually entered by user.',
    vendor, vendor_addr: vendorAddr, doc_no: docNo,
    accent: derivedStatus === 'deductible' ? '#0F6E56' : derivedStatus === 'non_deductible' ? '#DC2626' : '#64748B',
    lineItems: lineItems.map(li => ({ desc: li.desc, amt: parseFloat(li.amt) || 0 })),
    confidence: 100,
    manual: true,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#E2E8F0] w-[520px] max-h-[90vh] overflow-y-auto p-6 mx-4" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-[#0F172A]">Manually add a document</p>
            <p className="text-[10px] text-[#64748B] mt-0.5">No file? Enter the details and we'll save the record.</p>
          </div>
          <button onClick={onCancel} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Document type</label>
              <select value={docType} onChange={e => setDocType(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] cursor-pointer">
                {['Invoice', 'Receipt', 'Utility Bill', 'Payroll', 'Purchase Order', 'Bank Statement', 'Other'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488]" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Vendor / payee name</label>
            <input type="text" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. ABC Trading Sdn Bhd"
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1]" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Vendor address</label>
            <input type="text" value={vendorAddr} onChange={e => setVendorAddr(e.target.value)} placeholder="e.g. No. 12, Jalan Damai, KL"
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1]" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Document / receipt number</label>
            <input type="text" value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="e.g. INV-2026-0001"
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1]" />
          </div>
          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[10px] font-medium text-[#64748B]">Line items</label>
              <button onClick={addLineItem} className="text-[10px] text-[#0D9488] font-semibold hover:text-[#0F6E56] transition-colors">+ Add item</button>
            </div>
            <div className="space-y-2">
              {lineItems.map((li, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="text" value={li.desc} onChange={e => updateLineItem(i, 'desc', e.target.value)} placeholder="Description"
                    className="flex-1 min-w-0 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1]" />
                  <input type="number" value={li.amt} onChange={e => updateLineItem(i, 'amt', e.target.value)} placeholder="0.00"
                    className="w-24 shrink-0 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] text-right focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1]" />
                  <button onClick={() => removeLineItem(i)} className="shrink-0 text-[#CBD5E1] hover:text-[#DC2626] transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#F1F5F9]">
              <span className="text-[10px] font-semibold text-[#64748B]">Total</span>
              <span className="text-xs font-bold text-[#0F172A]">{fmtRM(total)}</span>
            </div>
          </div>
          {/* Category */}
          <div>
            <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] cursor-pointer">
              {RECLASSIFY_GROUPS.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.cats.map(c => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          {/* Notes */}
          <div>
            <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any additional context for this document"
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1] resize-none" />
          </div>
        </div>
        <button
          onClick={() => isValid && onConfirm(buildDoc())}
          disabled={!isValid}
          className={`w-full mt-6 rounded-xl px-4 py-3 text-sm font-bold transition-colors ${isValid ? 'bg-[#0F6E56] text-white hover:bg-[#0A5140] cursor-pointer' : 'bg-[#F1F5F9] text-[#CBD5E1] cursor-not-allowed'}`}>
          Save Document
        </button>
        {!isValid && <p className="text-[9px] text-[#94A3B8] text-center mt-2">Fill in vendor name, document number, date, and at least one line item.</p>}
      </div>
    </div>
  );
}

function UploadTab({ docs, uploads, onFileDrop, onRemove, onArchive, onRetry, onUpdateStatus }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');     // 'all'|taxStatus|'archived'
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [reclassDoc, setReclassDoc] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [manualUploadOpen, setManualUploadOpen] = useState(false);

  // Separate completed/failed docs from in-flight uploads
  const completedDocs = docs.filter(d => d.status !== 'pending' && d.status !== 'processing');
  const failedDocs = completedDocs.filter(d => d.status === 'failed');
  const mixed = completedDocs.filter(d => d.taxStatus === 'mixed');

  // Static high-level category filter options — quadrant level only, not deep taxonomy.
  // This avoids a reactive list that changes as docs load, and is cleaner for filtering.
  const CATEGORY_FILTER_OPTIONS = [
    { value: 'all',  label: 'All categories' },
    { value: 'Q1',   label: 'Q1 — Business Income' },
    { value: 'Q2',   label: 'Q2 — Personal Income' },
    { value: 'Q3',   label: 'Q3 — Business Expense' },
    { value: 'Q4R',  label: 'Q4 — Tax Relief' },
    { value: 'Q4P',  label: 'Q4 — Personal (Non-deductible)' },
    { value: 'MIX',  label: 'Mixed / Pending Review' },
  ];

  const availableYears = [...new Set(completedDocs.map(d => {
    const m = (d.date || '').match(/\d{4}/);
    return m ? m[0] : null;
  }).filter(Boolean))].sort((a, b) => b - a);

  let filtered = completedDocs.filter(d => {
    if (showArchived) return d.status === 'archived';
    if (d.status === 'archived') return false;
    // 'failed' filter matches pipeline-failed docs by status, not taxStatus
    if (statusFilter === 'failed') return d.status === 'failed';
    if (statusFilter !== 'all' && d.taxStatus !== statusFilter) return false;
    // Quadrant-level category filter
    if (categoryFilter !== 'all') {
      const cat = d.category || '';
      if (categoryFilter === 'Q1'  && !cat.startsWith('Q1'))  return false;
      if (categoryFilter === 'Q2'  && !cat.startsWith('Q2'))  return false;
      if (categoryFilter === 'Q3'  && !cat.startsWith('Q3'))  return false;
      if (categoryFilter === 'Q4R' && !(cat.startsWith('Q4') && Q4_RELIEF_CATEGORIES.includes(cat))) return false;
      if (categoryFilter === 'Q4P' && !(cat.startsWith('Q4') && Q4_NON_DED_CATEGORIES.includes(cat))) return false;
      if (categoryFilter === 'MIX' && cat !== 'Mixed / Pending Review') return false;
    }
    if (yearFilter !== 'all') {
      const m = (d.date || '').match(/\d{4}/);
      if (!m || m[0] !== yearFilter) return false;
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
    if (sortBy === 'date_desc') return new Date(b.date || 0) - new Date(a.date || 0);
    if (sortBy === 'date_asc') return new Date(a.date || 0) - new Date(b.date || 0);
    if (sortBy === 'amount_desc') return parseAmt(b.amount) - parseAmt(a.amount);
    if (sortBy === 'amount_asc') return parseAmt(a.amount) - parseAmt(b.amount);
    if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '');
    return 0;
  });

  const handleReclassifyConfirm = async (status, category) => {
    await onUpdateStatus(reclassDoc.id, status, category);
    setReclassDoc(null);
    setPreviewDoc(null);
  };

  const handleFiles = useCallback((files) => {
    onFileDrop(Array.from(files));
  }, [onFileDrop]);

  return (
    <>
      {reclassDoc && (
        <ReclassifyModal doc={reclassDoc} onConfirm={handleReclassifyConfirm} onCancel={() => setReclassDoc(null)} />
      )}
      {previewDoc && (
        <DocumentPreview
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onReclassify={(d) => { setPreviewDoc(null); setReclassDoc(d); }}
          onArchive={(id) => { setPreviewDoc(null); onArchive(id); }}
          onDelete={(id) => { setPreviewDoc(null); onRemove(id); }}
        />
      )}
      {manualUploadOpen && (
        <ManualUploadModal
          onConfirm={(newDoc) => { onFileDrop([], newDoc); setManualUploadOpen(false); }}
          onCancel={() => setManualUploadOpen(false)}
        />
      )}

      <div className="flex h-full min-h-0 flex-col gap-3">
        {/* Drop zone */}
        <div
          className={`shrink-0 rounded-xl border-2 border-dashed p-5 text-center transition-colors cursor-pointer ${dragging ? 'border-[#0D9488] bg-[#ECFDF5]' : 'border-[#CBD5E1] bg-[#F8FAFC] hover:border-[#0D9488]'}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}>
          <input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.xlsx,.xls,.csv"
            className="hidden" onChange={e => handleFiles(e.target.files)} />
          <div className="mx-auto mb-2 h-9 w-9 rounded-full bg-[#ECFDF5] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-[#0F172A]">Drop files here or <span className="text-[#0D9488]">browse</span></p>
          <p className="mt-0.5 text-[10px] text-[#64748B]">PDF, JPG, PNG, XLSX, CSV · Max 20 MB per file · Up to 10 files at once</p>
          <p className="mt-2 text-[10px] text-[#94A3B8]">
            No file?{' '}
            <button onClick={e => { e.stopPropagation(); setManualUploadOpen(true); }}
              className="text-[#0D9488] font-semibold hover:text-[#0F6E56] underline transition-colors">
              Manually add a document
            </button>
          </p>
        </div>

        {/* Needs-review banner */}
        {mixed.length > 0 && !showArchived && (
          <div className="shrink-0 flex items-center justify-between gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <svg className="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <p className="text-[11px] font-semibold text-[#B45309]">
                {mixed.length} document{mixed.length > 1 ? 's' : ''} need your input to classify
              </p>
            </div>
            <button onClick={() => setStatusFilter('mixed')}
              className="shrink-0 rounded-lg bg-[#B45309] px-3 py-1 text-[10px] font-semibold text-white hover:bg-[#92400E] transition-colors">
              Review now
            </button>
          </div>
        )}

        {/* Filter, search, sort bar */}
        <div className="shrink-0 flex items-center gap-2 flex-wrap">
          {/* Archive toggle */}
          <button
            onClick={() => { setShowArchived(v => !v); setStatusFilter('all'); }}
            className={`rounded-full px-3 py-1 text-[10px] font-medium transition-colors flex items-center gap-1 ${showArchived ? 'bg-[#64748B] text-white' : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
            </svg>
            {showArchived ? 'Showing archived' : 'Archived'}
          </button>

          {!showArchived && [
            { id: 'all', label: 'All' },
            { id: 'income', label: 'Income' },
            { id: 'deductible', label: 'Deductible' },
            { id: 'relief', label: 'Relief' },
            { id: 'non_deductible', label: 'Personal' },
            { id: 'not_applicable', label: 'Capital / N/A' },
            { id: 'mixed', label: `Review${mixed.length ? ` (${mixed.length})` : ''}` },
            { id: 'failed', label: `Failed${failedDocs.length ? ` (${failedDocs.length})` : ''}` },
          ].map(f => (
            <button key={f.id} onClick={() => setStatusFilter(f.id)}
              className={`rounded-full px-3 py-1 text-[10px] font-medium transition-colors ${statusFilter === f.id ? 'bg-[#0F6E56] text-white' : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'}`}>
              {f.label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
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
                className="rounded-lg border border-[#E2E8F0] bg-white pl-7 pr-3 py-1.5 text-[10px] text-[#334155] focus:outline-none focus:border-[#0D9488] w-44"
              />
            </div>
            {!showArchived && (
              <>
                <select value={yearFilter} onChange={e => setYearFilter(e.target.value)}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[10px] text-[#334155] focus:outline-none focus:border-[#0D9488] cursor-pointer">
                  <option value="all">All years</option>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[10px] text-[#334155] focus:outline-none focus:border-[#0D9488] cursor-pointer">
                  {CATEGORY_FILTER_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[10px] text-[#334155] focus:outline-none focus:border-[#0D9488] cursor-pointer">
                  <option value="date_desc">Newest first</option>
                  <option value="date_asc">Oldest first</option>
                  <option value="amount_desc">Amount: high → low</option>
                  <option value="amount_asc">Amount: low → high</option>
                  <option value="name_asc">Name A–Z</option>
                </select>
              </>
            )}
          </div>
        </div>

        {/* Document table */}
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white">
          {uploads.length === 0 && filtered.length === 0 ? (
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
                <tr className="border-b border-[#E2E8F0]">
                  {['File', 'Amount', 'Category', 'Status', 'Date', ''].map(h => (
                    <th key={h} className="py-2.5 px-3 first:pl-4 last:pr-4 text-left text-[10px] font-semibold text-[#64748B] last:text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* In-flight uploads first */}
                {!showArchived && uploads.map(entry => (
                  <UploadProgressEntry
                    key={entry.localId}
                    entry={entry}
                  />
                ))}
                {/* Resolved docs */}
                {filtered.map(doc => (
                  <tr key={doc.id}
                    onClick={() => setPreviewDoc(doc)}
                    className="border-b border-[#F1F5F9] last:border-0 cursor-pointer bg-white hover:bg-[#F8FAFC] transition-colors">
                    <td className="py-2.5 pl-4 pr-3 min-w-0">
                      <p className="font-medium text-[#0F172A] text-[11px] leading-tight truncate max-w-[160px]">{doc.name}</p>
                      <p className="text-[9px] text-[#94A3B8] mt-0.5 truncate max-w-[160px]">{doc.type}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-semibold text-[#0F172A] whitespace-nowrap">{doc.amount}</td>
                    <td className="px-3 py-2.5 text-[10px] text-[#334155] max-w-[140px]">
                      <span className="block truncate">{doc.category}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={doc.taxStatus || doc.status} />
                    </td>
                    <td className="px-3 py-2.5 text-[10px] text-[#64748B] whitespace-nowrap">{doc.date}</td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center justify-end gap-2">
                        {/* Retry — only for failed docs */}
                        {doc.status === 'failed' && (
                          <button
                            onClick={e => { e.stopPropagation(); onRetry(doc); }}
                            className="text-[#CBD5E1] hover:text-[#0369A1] transition-colors"
                            title="Retry classification">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                            </svg>
                          </button>
                        )}
                        {/* Archive */}
                        {doc.status !== 'archived' && (
                          <button onClick={e => { e.stopPropagation(); onArchive(doc.id); }}
                            className="text-[#CBD5E1] hover:text-[#64748B] transition-colors" title="Archive">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
                            </svg>
                          </button>
                        )}
                        {/* Delete */}
                        <button onClick={e => { e.stopPropagation(); onRemove(doc.id); }}
                          className="text-[#CBD5E1] hover:text-[#DC2626] transition-colors" title="Delete">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          {showArchived
            ? `${filtered.length} archived document${filtered.length !== 1 ? 's' : ''}`
            : `${filtered.length} of ${completedDocs.filter(d => d.status !== 'archived').length} documents shown`}
          {uploads.length > 0 && ` · ${uploads.length} uploading`}
          {' '}· Click a row to preview
        </p>
      </div>
    </>
  );
}

// ─── PDF Preview slide-over ───────────────────────────────────────────────────
function PdfPreview({ formId, formData, sc, onClose }) {
  const [zoom, setZoom] = useState(100);
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 300); };

  const { deductibleTotal, nonDeductibleTotal, reviewTotal, totalIncome, chargeableIncome,
    taxCharged, lessInstalment, taxPayable } = formData;

  return (
    <div className="fixed inset-0 z-50 flex" onClick={handleClose}>
      <div className={`flex-1 bg-black/40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`relative flex h-full w-[680px] max-w-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3 bg-[#F8FAFC] shrink-0">
          <div>
            <p className="text-sm font-bold text-[#0F172A]">
              Form {formId} Preview — {formId === 'B' ? 'YA 2025 Personal Return' : `${sc.firm?.name || 'Partnership'} Return`}
            </p>
            <p className="text-[10px] text-[#64748B] mt-0.5">This is a pre-filled draft for your reference. Verify all values before submitting to LHDN.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2 py-1">
              <button onClick={() => setZoom(z => Math.max(60, z - 10))}
                className="text-[#64748B] hover:text-[#0F172A] px-1 text-sm font-bold">−</button>
              <span className="text-[10px] text-[#64748B] w-8 text-center">{zoom}%</span>
              <button onClick={() => setZoom(z => Math.min(150, z + 10))}
                className="text-[#64748B] hover:text-[#0F172A] px-1 text-sm font-bold">+</button>
            </div>
            <button
              className="flex items-center gap-1.5 rounded-lg bg-[#0F6E56] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0A5140] transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export PDF
            </button>
            <button onClick={handleClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors ml-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#E8EBEF] p-6">
          <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', transition: 'transform 0.2s' }}>
            <div className="bg-white mx-auto shadow-xl rounded-lg overflow-hidden" style={{ width: 580 }}>
              <div className="px-6 py-5 flex items-start gap-4 border-b border-[#E2E8F0]">
                <img src={cukaiLogo} alt="cukai.ai logo" className="h-10 w-10 shrink-0" />
                <div className="min-w-0">
                  <span className="select-none text-xl font-bold tracking-tight text-[#0F172A]">
                    cukai<span className="text-[#10B981]">.</span><span className="font-light text-[#64748B]">ai</span>
                  </span>
                  <p className="text-[10px] text-[#64748B] mt-0.5">
                    {formId === 'B' ? 'Pre-filled draft of your personal income tax return' : 'Pre-filled draft of your partnership return'}
                  </p>
                </div>
                <div className="ml-auto shrink-0 text-right">
                  <p className="text-[9px] text-[#94A3B8] uppercase tracking-wider">Form</p>
                  <p className="text-2xl font-black leading-none text-[#0F6E56]">{formId}</p>
                  <p className="text-[9px] text-[#94A3B8] mt-0.5">YA 2025</p>
                </div>
              </div>

              <div className="px-6 py-5 space-y-5 text-[11px]">
                {formId === 'B' ? (
                  <>
                    <PreviewSection title="BASIC PARTICULARS">
                      <PreviewField label="1  Name" value="Aisyah binti Ahmad" />
                      <PreviewField label="2  Tax Identification No. (TIN)" value="SG 12345678901" />
                      <PreviewField label="3  Identification No." value="900101-14-5678" />
                      <PreviewField label="4  Correspondence address" value="No. 12, Jalan Damai 3, 50450 Kuala Lumpur" />
                    </PreviewSection>

                    <PreviewSection title="PART A — PARTICULARS OF INDIVIDUAL">
                      <PreviewField label="A1  Citizen" value="MYS" /><PreviewField label="A2  Gender" value="Female" />
                      <PreviewField label="A3  Date of birth" value="01/01/1990" /><PreviewField label="A4  Status" value="Married" />
                      <PreviewField label="A6  Record-keeping" value="Yes" /><PreviewField label="A7  Type of assessment" value="3 – Separate" />
                    </PreviewSection>

                    <PreviewSection title="PART B — COMPUTATION OF INCOME TAX">
                      <PreviewField label="B1   Statutory income from businesses in Malaysia" value={fmtRM(deductibleTotal)} highlight />
                      <PreviewField label="B2   Statutory income from partnerships in Malaysia" value="RM 235,000" highlight />
                      <PreviewField label="B4   Aggregate statutory income from businesses" value={fmtRM(deductibleTotal + 235000)} />
                      <PreviewField label="B7   Statutory income from employment" value="—" />
                      <PreviewField label="B8   Statutory income from rents" value="—" />
                      <PreviewField label="B11  AGGREGATE INCOME" value={fmtRM(totalIncome)} bold />
                      <PreviewField label="B17  Less: Approved donations / gifts" value="—" />
                      <PreviewField label="B20  TOTAL INCOME [SELF]" value={fmtRM(totalIncome)} bold />
                      <PreviewField label="B23  Total Relief" value="RM 18,000" />
                      <PreviewField label="B24  CHARGEABLE INCOME" value={fmtRM(chargeableIncome)} highlight bold />
                      <PreviewField label="B26  Total Income Tax" value={fmtRM(taxCharged)} />
                      <PreviewField label="B27  Less: Rebates (self)" value="RM 400" />
                      <PreviewField label="B28  TOTAL TAX CHARGED" value={fmtRM(Math.max(0, taxCharged - 400))} bold />
                      <PreviewField label="B33  Less: CP500 instalments paid" value={fmtRM(lessInstalment)} />
                      <PreviewField label="B34  BALANCE TAX PAYABLE" value={fmtRM(taxPayable)} highlight bold />
                    </PreviewSection>

                    <PreviewSection title="PART H — RELIEF">
                      <PreviewField label="H1   Individual and dependent relatives" value="RM 9,000" />
                      <PreviewField label="H2   Expenses for parents" value="—" />
                      <PreviewField label="H5   Education fees (Self)" value="—" />
                      <PreviewField label="H6   Medical expenses (serious diseases)" value="—" />
                      <PreviewField label="H9   Lifestyle (books, internet, devices)" value="—" />
                      <PreviewField label="H13  SSPN net deposit" value="—" />
                      <PreviewField label="H14  Husband / wife" value="—" />
                      <PreviewField label="H16  Child relief" value="—" />
                      <PreviewField label="H17  Life insurance and EPF" value="RM 7,000" />
                      <PreviewField label="H18  Private retirement scheme" value="—" />
                      <PreviewField label="H19  Education and medical insurance" value="RM 2,000" />
                      <PreviewField label="H20  SOCSO contribution" value="—" />
                      <PreviewField label="H22  TOTAL RELIEF" value="RM 18,000" bold highlight />
                    </PreviewSection>

                    <PreviewSection title="PART N — FINANCIAL PARTICULARS (MAIN BUSINESS)">
                      <PreviewField label="N1   Name of business" value="Meridian Print Studio (Sole Prop)" />
                      <PreviewField label="N2   Business code (MSIC)" value="1811" />
                      <PreviewField label="N3   Sales or turnover" value={fmtRM(deductibleTotal + 12000)} />
                      <PreviewField label="N7   Cost of sales" value="—" />
                      <PreviewField label="N8   Gross Profit / Loss" value={fmtRM(deductibleTotal + 12000)} />
                      <PreviewField label="N14  Total other income" value="—" />
                      <PreviewField label="N15  Loan interest" value="—" />
                      <PreviewField label="N16  Salaries and wages" value={fmtRM(14500)} />
                      <PreviewField label="N17  Rental / lease" value={fmtRM(1240)} />
                      <PreviewField label="N22  Repairs and maintenance" value="—" />
                      <PreviewField label="N23  Promotion and advertisement" value={fmtRM(3200)} />
                      <PreviewField label="N25  TOTAL EXPENDITURE" value={fmtRM(deductibleTotal)} bold />
                      <PreviewField label="N26  NET PROFIT / LOSS" value={fmtRM(deductibleTotal + 12000 - deductibleTotal)} bold highlight />
                      <PreviewField label="N27  Non-allowable expenses" value={fmtRM(nonDeductibleTotal)} />
                    </PreviewSection>

                    {reviewTotal > 0 && (
                      <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3">
                        <p className="text-[10px] font-semibold text-[#B45309]">⚠ {fmtRM(reviewTotal)} in expenses are still under review</p>
                        <p className="text-[9px] text-[#92400E] mt-0.5">Classify all mixed items in the OCR Evidence tab before final submission to LHDN.</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <PreviewSection title="PARTNERSHIP DETAILS">
                      <PreviewField label="1   Name of partnership" value="Meridian Print Studio" />
                      <PreviewField label="2   Income tax no." value="D 1234567890" />
                      <PreviewField label="3   Reference no. (Reg no.)" value="ROB/2020/001234" />
                      <PreviewField label="4   Number of partners" value="3" />
                      <PreviewField label="5   Basis of apportionment" value="Profit-sharing ratio" />
                      <PreviewField label="6   Record-keeping" value="Yes" />
                    </PreviewSection>

                    <PreviewSection title="PART A — BUSINESS INCOME">
                      <PreviewField label="A1  Business code (MSIC)" value="1811 — Printing of newspapers" />
                      <PreviewField label="A2  Divisible income / loss" value="RM 450,000" highlight bold />
                      <PreviewField label="A3  Partners' benefits (salaries + interest)" value="RM 160,000" />
                      <PreviewField label="A4  Balancing charge" value="—" />
                      <PreviewField label="A5  Balancing allowance and capital allowance" value="RM 60,000" />
                    </PreviewSection>

                    <PreviewSection title="PART F — PARTICULARS OF PARTNERSHIP">
                      <PreviewField label="F1  Registered address" value="No. 12, Jalan Damai 3, 50450 Kuala Lumpur" />
                      <PreviewField label="F2  Main business address" value="Lot 5, Jalan Industri 2, Shah Alam" />
                      <PreviewField label="F5  Employer's no." value="E 1234567890" />
                      <PreviewField label="F6  Precedent partner's name" value="Aisyah binti Ahmad" />
                      <PreviewField label="F7  Telephone no." value="03-1234 5678" />
                    </PreviewSection>

                    <PreviewSection title="PART G — PARTICULARS OF PARTNERS">
                      <div className="bg-[#F8FAFC] rounded-lg overflow-hidden border border-[#F1F5F9]">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="bg-[#F1F5F9]">
                              {['Partner', 'ID No.', 'Share', 'Salary', 'Profit Share', 'Total Allocated'].map(h => (
                                <th key={h} className="px-2 py-1.5 text-left text-[9px] font-semibold text-[#64748B]">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { name: 'Aisyah', id: '900101-14-5678', share: '50%', salary: 'RM 60,000', profit: 'RM 175,000', total: 'RM 235,000' },
                              { name: 'Bopha', id: '880212-10-3456', share: '30%', salary: 'RM 40,000', profit: 'RM 105,000', total: 'RM 145,000' },
                              { name: 'Chong', id: '910330-08-7890', share: '20%', salary: '—', profit: 'RM 70,000', total: 'RM 70,000' },
                            ].map((p, i) => (
                              <tr key={p.name} className={i % 2 === 0 ? '' : 'bg-[#FAFBFC]'}>
                                <td className="px-2 py-1.5 font-semibold text-[#0F172A]">{p.name}</td>
                                <td className="px-2 py-1.5 text-[#64748B]">{p.id}</td>
                                <td className="px-2 py-1.5">{p.share}</td>
                                <td className="px-2 py-1.5">{p.salary}</td>
                                <td className="px-2 py-1.5">{p.profit}</td>
                                <td className="px-2 py-1.5 font-semibold text-[#0F6E56]">{p.total}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </PreviewSection>

                    <PreviewSection title="PART H — FINANCIAL PARTICULARS">
                      <PreviewField label="H2   Sales or turnover" value="RM 920,000" bold />
                      <PreviewField label="H3   Opening stock" value="—" />
                      <PreviewField label="H4   Purchases and cost of production" value="RM 310,000" />
                      <PreviewField label="H6   Cost of sales" value="RM 310,000" />
                      <PreviewField label="H7   GROSS PROFIT" value="RM 610,000" bold />
                      <PreviewField label="H14  Loan interest" value="—" />
                      <PreviewField label="H15  Salaries and wages" value="RM 100,000" />
                      <PreviewField label="H16  Rental / lease" value="RM 24,000" />
                      <PreviewField label="H22  Other expenses" value="RM 36,000" />
                      <PreviewField label="H24  TOTAL EXPENDITURE" value="RM 160,000" bold />
                      <PreviewField label="H25  NET PROFIT" value="RM 450,000" bold highlight />
                    </PreviewSection>

                    {!sc.canFileFormP && (
                      <div className="rounded-lg border border-[#E0E7FF] bg-[#EEF2FF] px-4 py-3">
                        <p className="text-[10px] font-semibold text-[#4338CA]">View only — submission by Aisyah (Principal Partner)</p>
                        <p className="text-[9px] text-[#4338CA]/80 mt-0.5">You can review this form but only the principal partner can submit Form P to LHDN.</p>
                      </div>
                    )}
                  </>
                )}

                <div className="border-t border-[#E2E8F0] pt-4 text-[9px] text-[#94A3B8] text-center">
                  <p>This is a cukai.ai pre-filled draft — for reference only. File via mytax.hasil.gov.my · Due: 30 Jun 2025</p>
                  <p className="mt-0.5">Contact Hasil Care Line: 03-8911 1000 (Local) / 603-8911 1000 (Overseas)</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewSection({ title, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="h-px flex-1 bg-[#E2E8F0]" />
        <p className="text-[9px] font-bold uppercase tracking-widest text-[#64748B] shrink-0">{title}</p>
        <div className="h-px flex-1 bg-[#E2E8F0]" />
      </div>
      <div className="rounded-lg overflow-hidden border border-[#F1F5F9] divide-y divide-[#F1F5F9]">
        {children}
      </div>
    </div>
  );
}

function PreviewField({ label, value, highlight, bold }) {
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 ${highlight ? 'bg-[#F0FDF4]' : ''}`}>
      <span className={`text-[10px] ${bold ? 'font-semibold text-[#0F172A]' : 'text-[#64748B]'}`}>{label}</span>
      <span className={`text-[10px] ml-4 text-right ${bold ? 'font-bold' : 'font-medium'} ${highlight ? 'text-[#0F6E56]' : 'text-[#0F172A]'}`}>{value}</span>
    </div>
  );
}

// ─── Generate Report Tab ──────────────────────────────────────────────────────
function GenerateTab({ docs, scenario, activeScenario, setActiveScenario, selectedForm, setSelectedForm, showPreview, setShowPreview }) {
  const sc = USER_SCENARIOS[activeScenario];

  const deductibleTotal    = docs.filter(d => d.status === 'deductible').reduce((s, d) => s + parseAmt(d.amount), 0);
  const nonDeductibleTotal = docs.filter(d => d.status === 'non_deductible').reduce((s, d) => s + parseAmt(d.amount), 0);
  const reviewTotal        = docs.filter(d => d.status === 'mixed').reduce((s, d) => s + parseAmt(d.amount), 0);
  const partnerShare       = sc.firm ? 235000 : 0;
  const totalIncome        = deductibleTotal + partnerShare;
  const chargeableIncome   = Math.max(0, totalIncome - 18000);

  const calcTax = (ci) => {
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
  };
  const taxCharged     = calcTax(chargeableIncome);
  const lessInstalment = Math.round(taxCharged * 0.7);
  const taxPayable     = Math.max(0, taxCharged - 400 - lessInstalment);

  const formData = { deductibleTotal, nonDeductibleTotal, reviewTotal, totalIncome,
    chargeableIncome, taxCharged, lessInstalment, taxPayable };

  const forms = [
    sc.canFileFormB && { id: 'B', title: 'Form B', subtitle: 'Personal income tax — resident who carries on business', tag: 'YA 2025', canGenerate: true, readOnly: false },
    (sc.canViewFormP || sc.canFileFormP) && { id: 'P', title: 'Form P', subtitle: sc.firm ? `${sc.firm.name} · Partnership Return` : 'Partnership Return', tag: sc.firm ? `MSIC ${sc.firm.msic}` : 'Partnership', canGenerate: sc.canFileFormP, readOnly: !sc.canFileFormP },
  ].filter(Boolean);

  return (
    <>
      {showPreview && selectedForm && (
        <PdfPreview formId={selectedForm} formData={formData} sc={sc} onClose={() => setShowPreview(false)} />
      )}
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        {/* Scenario switcher */}
        <div className="shrink-0 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-[#0F172A]">{sc.label}</p>
              <p className="text-[10px] text-[#64748B] mt-0.5">{sc.description}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(USER_SCENARIOS).map(([k, v]) => (
                <button key={k} onClick={() => { setActiveScenario(k); setSelectedForm(null); }}
                  className={`rounded-full px-3 py-1 text-[10px] font-medium transition-colors ${
                    activeScenario === k ? 'bg-[#0F6E56] text-white' : 'bg-white border border-[#E2E8F0] text-[#64748B] hover:border-[#0D9488]'
                  }`}>{v.label}</button>
              ))}
            </div>
          </div>
          {sc.firm && (
            <div className="mt-3 flex items-center gap-3 flex-wrap border-t border-[#E2E8F0] pt-3">
              <span className="text-[10px] text-[#64748B]">Firm: <span className="font-semibold text-[#0F172A]">{sc.firm.name}</span></span>
              <span className="text-[10px] text-[#64748B]">Share: <span className="font-semibold text-[#0F172A]">{sc.firm.share}</span></span>
              {sc.canFileFormP
                ? <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-semibold text-[#0F6E56]">Principal Partner</span>
                : <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#64748B]">Partner</span>}
            </div>
          )}
        </div>

        {/* Form cards */}
        <div className="shrink-0 grid gap-3 sm:grid-cols-2">
          {forms.map(form => (
            <button key={form.id} onClick={() => setSelectedForm(form.id)}
              className={`text-left rounded-xl border-2 p-4 transition-all ${
                selectedForm === form.id ? 'border-[#0D9488] bg-[#ECFDF5] shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-[#0D9488]'
              } ${form.readOnly ? 'opacity-75' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="h-10 w-10 rounded-xl bg-[#0F6E56] flex items-center justify-center">
                  <span className="text-base font-black text-white">{form.id}</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[9px] font-medium text-[#64748B]">{form.tag}</span>
                  {form.readOnly && <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[9px] font-medium text-[#B45309]">View Only</span>}
                </div>
              </div>
              <p className="text-xs font-bold text-[#0F172A]">{form.title}</p>
              <p className="text-[10px] text-[#64748B] mt-0.5 leading-tight">{form.subtitle}</p>
              {!form.readOnly
                ? <p className="mt-2 text-[10px] text-[#0D9488] font-medium">Click to prepare →</p>
                : <p className="mt-2 text-[10px] text-[#B45309]">Principal partner files this form.</p>}
            </button>
          ))}
        </div>

        {/* Form summary + actions */}
        {selectedForm && (() => {
          const form = forms.find(f => f.id === selectedForm);
          return (
            <div className="shrink-0 rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <div>
                  <p className="text-xs font-semibold text-[#0F172A]">
                    Form {selectedForm} — {selectedForm === 'B' ? 'Personal Return YA 2025' : `${sc.firm?.name || 'Partnership'} Return YA 2025`}
                  </p>
                  <p className="text-[10px] text-[#64748B] mt-0.5">Auto-populated from uploaded documents · Verify before submitting to LHDN</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowPreview(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-[#0F6E56] bg-white px-3 py-2 text-xs font-semibold text-[#0F6E56] hover:bg-[#ECFDF5] transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                    Preview
                  </button>
                  {!form?.readOnly && (
                    <button onClick={() => setShowPreview(true)}
                      className="flex items-center gap-1.5 rounded-lg bg-[#0F6E56] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0A5140] transition-colors">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      Export PDF
                    </button>
                  )}
                </div>
              </div>

              <div className="px-5 py-4 space-y-4">
                {selectedForm === 'B' ? (
                  <>
                    <InlineSummary title="Part B — Income Computation">
                      <SRow label="B1  Business income (sole prop / expense deductions)" value={fmtRM(deductibleTotal)} />
                      <SRow label="B2  Partnership income (Meridian Print Studio)" value={sc.firm ? 'RM 235,000' : '—'} />
                      <SRow label="B4  Aggregate business income" value={fmtRM(deductibleTotal + (sc.firm ? 235000 : 0))} />
                      <SRow label="B11 Aggregate income" value={fmtRM(totalIncome)} bold />
                      <SRow label="B17 Less: Donations / gifts" value="—" />
                      <SRow label="B23 Total relief" value="RM 18,000" />
                      <SRow label="B24 Chargeable income" value={fmtRM(chargeableIncome)} bold highlight />
                      <SRow label="B26 Total income tax" value={fmtRM(taxCharged)} />
                      <SRow label="B28 Tax charged (after rebate RM 400)" value={fmtRM(Math.max(0, taxCharged - 400))} bold />
                      <SRow label="B33 Less: CP500 instalments" value={fmtRM(lessInstalment)} />
                      <SRow label="B34 Balance tax payable" value={fmtRM(taxPayable)} bold highlight />
                    </InlineSummary>
                    <InlineSummary title="Part H — Relief Breakdown">
                      <SRow label="H1  Individual & dependent relatives" value="RM 9,000" />
                      <SRow label="H17 Life insurance & EPF" value="RM 7,000" />
                      <SRow label="H19 Education & medical insurance" value="RM 2,000" />
                      <SRow label="H22 TOTAL RELIEF" value="RM 18,000" bold highlight />
                    </InlineSummary>
                    <InlineSummary title="Part N — Business Financial Particulars">
                      <SRow label="N3  Sales / turnover (estimated)" value={fmtRM(deductibleTotal + 12000)} />
                      <SRow label="N16 Salaries and wages" value="RM 14,500" />
                      <SRow label="N17 Rental / lease" value="RM 1,240" />
                      <SRow label="N23 Marketing and promotion" value="RM 3,200" />
                      <SRow label="N25 Total expenditure" value={fmtRM(deductibleTotal)} bold />
                      <SRow label="N27 Non-allowable (personal) expenses" value={fmtRM(nonDeductibleTotal)} />
                    </InlineSummary>
                    {reviewTotal > 0 && (
                      <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3">
                        <p className="text-[10px] font-semibold text-[#B45309]">⚠ {fmtRM(reviewTotal)} still under review</p>
                        <p className="text-[9px] text-[#92400E] mt-0.5">Classify remaining items in the OCR Evidence tab before filing.</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <InlineSummary title="Part A — Business Income (Partnership)">
                      <SRow label="A1  Business code (MSIC)" value="1811" />
                      <SRow label="A2  Divisible income" value="RM 450,000" bold highlight />
                      <SRow label="A3  Partners' benefits (salaries + interest)" value="RM 160,000" />
                      <SRow label="A5  Capital allowances" value="RM 60,000" />
                    </InlineSummary>
                    <InlineSummary title="Part G — Partner Profit Allocation">
                      <SRow label="Aisyah (YOU) · 50% · Salary RM 60,000" value="Total RM 235,000" bold highlight />
                      <SRow label="Bopha · 30% · Salary RM 40,000" value="Total RM 145,000" />
                      <SRow label="Chong · 20% · No salary" value="Total RM 70,000" />
                    </InlineSummary>
                    <InlineSummary title="Part H — Financial Particulars">
                      <SRow label="H2  Revenue" value="RM 920,000" />
                      <SRow label="H6  Cost of sales" value="RM 310,000" />
                      <SRow label="H7  Gross profit" value="RM 610,000" bold />
                      <SRow label="H15 Salaries and wages" value="RM 100,000" />
                      <SRow label="H16 Rental" value="RM 24,000" />
                      <SRow label="H24 Total expenditure" value="RM 160,000" bold />
                      <SRow label="H25 NET PROFIT (divisible income)" value="RM 450,000" bold highlight />
                    </InlineSummary>
                    {!sc.canFileFormP && (
                      <div className="rounded-lg border border-[#E0E7FF] bg-[#EEF2FF] p-3">
                        <p className="text-[10px] text-[#4338CA] font-semibold">You can view but cannot submit Form P.</p>
                        <p className="text-[9px] text-[#4338CA]/80 mt-0.5">Only Aisyah (principal partner) can file this form with LHDN.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}

function InlineSummary({ title, children }) {
  return (
    <div>
      <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#94A3B8]">{title}</p>
      <div className="rounded-lg border border-[#F1F5F9] divide-y divide-[#F1F5F9] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function SRow({ label, value, bold, highlight }) {
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 ${highlight ? 'bg-[#F0FDF4]' : ''}`}>
      <span className={`text-[10px] ${bold ? 'font-semibold text-[#0F172A]' : 'text-[#64748B]'}`}>{label}</span>
      <span className={`text-[10px] ml-6 text-right ${bold ? 'font-bold' : 'font-medium'} ${highlight ? 'text-[#0F6E56]' : 'text-[#0F172A]'}`}>{value}</span>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
function CukaiAccount() {
  const [tab, setTab]       = useState('upload');
  const [docs, setDocs]     = useState([]);       // resolved backend docs (mapped)
  const [uploads, setUploads] = useState([]);     // in-flight upload entries
  const [docsLoading, setDocsLoading] = useState(true);
  const [userScenario]      = useState('B');
  const [activeEntity, setActiveEntity] = useState(null);

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

  // ── Duplicate / retry toast ──────────────────────────────────────────────────
  const [dupToast, setDupToast] = useState(null); // { fileName, existingId, retryHint }

  // ── File drop handler ───────────────────────────────────────────────────────
  const handleFileDrop = useCallback(async (files, manualDoc = null) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    if (manualDoc) {
      setDocs(prev => [manualDoc, ...prev]);
      return;
    }
    if (!files.length) return;

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
  }, [activeEntity?.id]);

  const pollUntilResolved = useCallback((localId, docId, objectUrl) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    const INTERVALS = [2000, 3000, 3000, 5000, 5000, 8000, 10000];
    let attempt = 0;
    let cancelled = false;

    setUploads(prev => prev.map(e => e.localId === localId ? { ...e, phase: 'processing' } : e));

    const poll = async () => {
      if (cancelled) return;
      try {
        const statusData = await API.getDocumentStatus(docId, userId, entityId);
        if (statusData.status === 'completed' || statusData.status === 'failed') {
          setUploads(prev => prev.map(e =>
            e.localId === localId ? { ...e, phase: statusData.status === 'completed' ? 'done' : 'failed' } : e
          ));
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
    try { await API.deleteDocument(id, userId, entityId); } catch (e) { console.error('[Delete]', e); }
  }, [activeEntity?.id]);

  // ── Archive ─────────────────────────────────────────────────────────────────
  const archiveDoc = useCallback(async (id) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    setDocs(prev => prev.map(d => d.id === id ? { ...d, status: 'archived' } : d));
    try { await API.archiveDocument(id, userId, entityId); } catch (e) {
      console.error('[Archive]', e);
      try {
        const full = await API.getDocument(id, userId, entityId);
        setDocs(prev => prev.map(d => d.id === id ? mapApiDoc(full) : d));
      } catch (_) {}
    }
  }, [activeEntity?.id]);

  // ── Re-classify ─────────────────────────────────────────────────────────────
  const updateDocStatus = useCallback(async (id, status, category) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    setDocs(prev => prev.map(d => d.id === id ? { ...d, taxStatus: status, category, status: 'completed' } : d));
    try {
      await API.reclassifyDocument(id, status, category, userId, entityId);
    } catch (e) {
      console.error('[Reclassify]', e);
      try {
        const full = await API.getDocument(id, userId, entityId);
        setDocs(prev => prev.map(d => d.id === id ? mapApiDoc(full) : d));
      } catch (_) {}
    }
  }, [activeEntity?.id]);

  // ── Retry failed upload ─────────────────────────────────────────────────────
  // We don't retain the original File object once it has failed, so we delete
  // the failed record (clearing the duplicate-check window) and prompt the user
  // to drop the file again.
  const retryDoc = useCallback(async (doc) => {
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id || null;
    try { await API.deleteDocument(doc.id, userId, entityId); } catch (_) {}
    setDocs(prev => prev.filter(d => d.id !== doc.id));
    setDupToast({ fileName: doc.name, existingId: null, retryHint: true });
    setTimeout(() => setDupToast(null), 5000);
  }, [activeEntity?.id]);

  // Generate Report tab state lifted to root so the Generate tab retains its
  // selected scenario/form when switching away to Upload and back.
  const [activeScenario, setActiveScenario] = useState('B');
  const [selectedForm, setSelectedForm] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  return (
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body flex flex-col">
      {/* Duplicate / retry toast */}
      {dupToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-5 py-3 shadow-xl">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <p className="text-[11px] font-semibold text-[#B45309]">
            {dupToast.retryHint
              ? `Failed record cleared — drop "${dupToast.fileName}" again to retry.`
              : `"${dupToast.fileName}" was uploaded recently. Drop again to force re-upload.`}
          </p>
          <button onClick={() => setDupToast(null)} className="text-[#B45309]/60 hover:text-[#B45309] ml-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      <div className="mx-auto w-full max-w-7xl px-6 py-4 flex flex-col flex-1 min-h-0 gap-3">

        {/* Header */}
        <div className="shrink-0">
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Cukai Account</h1>
          <p className="text-xs text-[#64748B] mt-1">Upload receipts, classify expenses, and generate your tax return draft{activeEntity ? ` — ${activeEntity.name}` : ''}.</p>
        </div>

        {/* Tab nav */}
        <CukaiTabNav active={tab} onChange={setTab} />

        {/* Tab content */}
        <div className="flex flex-1 min-h-0 gap-5">
          <div className="flex-1 min-w-0 min-h-0">
            {tab === 'upload' && (
              docsLoading ? (
                <div className="flex h-full items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-8 w-8 rounded-full border-4 border-[#0F6E56] border-t-transparent animate-spin" />
                    <p className="text-sm text-[#64748B]">Loading your documents…</p>
                  </div>
                </div>
              ) : (
                <UploadTab
                  docs={docs}
                  uploads={uploads}
                  onFileDrop={handleFileDrop}
                  onRemove={removeDoc}
                  onArchive={archiveDoc}
                  onRetry={retryDoc}
                  onUpdateStatus={updateDocStatus}
                />
              )
            )}
            {tab === 'generate' && (
              <GenerateTab
                docs={docs} scenario={userScenario}
                activeScenario={activeScenario} setActiveScenario={setActiveScenario}
                selectedForm={selectedForm} setSelectedForm={setSelectedForm}
                showPreview={showPreview} setShowPreview={setShowPreview}
              />
            )}
          </div>
        </div>

      </div>
    </main>
  );
}

export default CukaiAccount;