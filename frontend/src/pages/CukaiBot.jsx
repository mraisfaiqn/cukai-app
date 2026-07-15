import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { getAllEntities, getChatSessions, searchChatSessions, getChatHistory, sendChatMessage, deleteChatSession } from '../services/api';
import cukaiBot from '../assets/cukaibot-icon.png';
// import { jsPDF } from 'jspdf';

// ── Icons ────────────────────────────────────────────────────────────────────

const BotIcon = ({ className = 'h-5 w-5' }) => (
  <img src={cukaiBot} alt="CukaiBot" className={className} />
);

const SendIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const AttachIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const BookIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

// Used instead of ExternalLinkIcon for citations of a user's own uploaded
// document (isInternal:true) — signals "preview here" rather than "leaves
// the page", since these open an in-page modal, not a new tab.
const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const ClearIcon = () => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className="h-4 w-4" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <polyline points="3 3 3 8 8 8" />
  </svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const SparkleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

const FileTextIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

// Sidebar-toggle icon: a rectangle with a vertical divider near the left edge,
// the same "panel" glyph most chat apps (including Claude's own sidebar
// toggle) use — familiar enough that it doesn't need a text label next to it.
const PanelLeftIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const PlusIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TrashIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const MessageSquareIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const SearchIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const XIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ── Mock conversation data ───────────────────────────────────────────────────
// No longer wired up — kept as reference/fallback. The real conversation now
// comes from GET /api/chat/{session_id}/history via getChatHistory() in the
// component below, backed by ChatSession/ChatMessage in Postgres.

const suggestedPrompts = [
  'Can I claim broadband as a business expense?',
  'What is the Section 33 deduction limit?',
  'Explain the 2025 e-invoicing phases.',
  'How do I claim medical relief for my parents?',
];

const MOCK_MESSAGES_BY_ENTITY = {
  // Seed conversation for the demo "Meridian Print Studio" entity (id 1 in
  // the mock entity set used elsewhere in the app). Any other entity ID
  // falls through to an empty conversation / welcome state.
  1: [
    {
      id: 1,
      role: 'user',
      text: 'What are the rules and limits for claiming medical expenses for my parents this year?',
    },
    {
      id: 2,
      role: 'assistant',
      text: "You can claim a tax relief for medical treatment, special needs, and carer expenses for your parents. Here is the breakdown for the current assessment year:",
      structured: {
        highlight: { label: 'MAXIMUM CLAIMABLE AMOUNT', value: 'RM8,000', note: 'This relief is granted under Section 46(1)(c) of the Income Tax Act (ITA) 1967.' },
        checkItems: [
          { bold: 'Eligible Expenses:', text: 'Medical care and treatment provided by a nursing home, and non-cosmetic dental treatment.' },
          { bold: 'Condition:', text: 'The medical condition must be certified by a qualified medical practitioner.' },
          { bold: 'Documentation:', text: 'Original receipts and a medical report must be retained for audit purposes.' },
        ],
      },
      citations: [
        { tag: 'ITA 1967', title: 'Section 46(1)(c)', snippet: '"medical treatment, special needs or carer expenses expended in that basis year by that individual for his..."', verified: 'Verified against 2024 Gazette' },
        { tag: 'PUBLIC RULING', title: 'PR No. 11/2021', snippet: 'Guidelines on the deduction for expenses in relation to medical treatment for parents.' },
      ],
    },
  ],
};

/** Mirrors what a real per-entity chat history fetch would resolve to. */
function getInitialMessagesForEntity(entityId) {
  return MOCK_MESSAGES_BY_ENTITY[entityId] || [];
}

// ── Sidebar helpers ──────────────────────────────────────────────────────────

/** Same relative-time convention already used in InsightsInbox.jsx, reused
 * here so timestamps read consistently across the app. */
function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Buckets sessions into the same "Today / Yesterday / Previous 7 Days /
 * Older" groups Claude's own sidebar uses, based on each session's
 * updatedAt (so a session you just replied in jumps back to "Today" rather
 * than staying pinned to when it was first created). Sessions arrive
 * pre-sorted most-recent-first from getChatSessions(), and that order is
 * preserved within each bucket.
 */
function groupSessionsByRecency(sessions) {
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const today = startOfDay(new Date());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

  const groups = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ];
  for (const s of sessions) {
    const updated = startOfDay(s.updatedAt);
    if (updated.getTime() === today.getTime()) groups[0].items.push(s);
    else if (updated.getTime() === yesterday.getTime()) groups[1].items.push(s);
    else if (updated > weekAgo) groups[2].items.push(s);
    else groups[3].items.push(s);
  }
  return groups.filter((g) => g.items.length > 0);
}

// ── Sub-components ───────────────────────────────────────────────────────────

/**
 * Renders markdown text (bold, bullet lists, paragraphs) using the same
 * typographic scale the plain <p> tags used before, so switching this in
 * doesn't change the overall look — it just stops showing raw "**"/"##"/"- "
 * characters to the user. The backend's CHAT_SYSTEM_PROMPT now asks Gemini
 * for lightly-formatted prose rather than heavy markdown structure (see
 * main.py), so this only needs to handle a handful of element types.
 */
function MarkdownText({ text, className = '' }) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-headings">{children}</strong>,
          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          // Headings collapse to bold inline text rather than large heading
          // sizes — CHAT_SYSTEM_PROMPT discourages "###" now, but this keeps
          // any that slip through from blowing up the chat bubble's layout.
          h1: ({ children }) => <p className="mb-2 font-semibold text-headings last:mb-0">{children}</p>,
          h2: ({ children }) => <p className="mb-2 font-semibold text-headings last:mb-0">{children}</p>,
          h3: ({ children }) => <p className="mb-2 font-semibold text-headings last:mb-0">{children}</p>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CitationCard({ citation, onPreview }) {
  // No click-based "did it work?" detection here on purpose. window.open()
  // with 'noopener' set gives no trustworthy signal either way: some
  // browsers return null even on a successful open (noopener deliberately
  // drops the reference back), and there's no way to observe whether a
  // cross-origin destination actually loaded or 404'd from this page.
  // A previous version tried to infer failure from the return value and
  // ended up flagging perfectly working links as broken. Instead, the
  // fallback index link (when available) is just always shown as a small
  // secondary option — accurate in every case, since it doesn't depend on
  // guessing.
  //
  // isInternal citations (a user's own uploaded document, served from this
  // backend's own /files/ mount — see main.py's _chunks_to_citations) skip
  // all of that: there's no cross-origin uncertainty and no link rot to
  // guard against, so these just open the in-page preview modal instead.
  const handleOpenSource = () => {
    if (citation.isInternal) {
      onPreview?.(citation);
      return;
    }
    window.open(citation.sourceUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="inline-flex items-center rounded-full bg-headings px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          {citation.tag}
        </span>
        {citation.sourceUrl && (
          <button
            className="text-muted transition-colors hover:text-primary"
            onClick={handleOpenSource}
            title={citation.isInternal ? 'Preview document' : (citation.pageNumber ? `Open source document (page ${citation.pageNumber})` : 'Open source document')}
          >
            {citation.isInternal ? <EyeIcon /> : <ExternalLinkIcon />}
          </button>
        )}
      </div>
      <p className="text-sm font-semibold text-headings">{citation.title}</p>
      {citation.pageNumber && (
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">Page {citation.pageNumber}</p>
      )}
      <p className="mt-1.5 font-mono text-xs leading-relaxed text-muted">{citation.snippet}</p>
      {citation.verified && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5">
          <CheckCircleIcon />
          <span className="text-xs font-medium text-primary">{citation.verified}</span>
        </div>
      )}
      {citation.fallbackUrl && (
        <div className="mt-2.5 border-t border-border pt-2.5">
          <p className="text-[11px] text-muted">
            {citation.sourceUrl ? 'Link not opening?' : 'Direct link unavailable —'}{' '}
            <button
              className="text-primary underline"
              onClick={() => window.open(citation.fallbackUrl, '_blank', 'noopener,noreferrer')}
            >
              search the official LHDN index instead
            </button>
            .
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Document Preview modal (for CitationCard's isInternal citations) ────────
// A lighter-weight cousin of CukaiAccount.jsx's DocumentPreview slide-over:
// same embed/img rendering approach and the same "prefix a relative /files/
// path with the API base URL" trick, but read-only — no reclassify/archive/
// delete footer, since this is opened from a chat citation, not the document
// manager. citation.sourceUrl is already the relative path main.py's
// _chunks_to_citations put on the chunk (see pipeline.py's
// embed_document_for_rag), so no Postgres lookback is needed here at all.
function DocumentPreviewModal({ citation, onClose }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 300); };

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const fileUrl = citation.sourceUrl ? `${API_URL}${citation.sourceUrl}` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`relative flex h-full max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl transition-all duration-300 ease-out ${visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3 bg-[#F8FAFC] shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-bold text-headings truncate">{citation.title}</p>
            {citation.tag && <p className="text-[10px] text-muted mt-0.5">{citation.tag}</p>}
          </div>
          <button onClick={handleClose} className="text-[#94A3B8] hover:text-headings transition-colors shrink-0 ml-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* File preview area */}
        <div className="flex-1 min-h-0 overflow-auto bg-[#E8EBEF]">
          {!fileUrl ? (
            <div className="flex h-full items-center justify-center text-center p-8">
              <p className="text-xs text-[#94A3B8]">File preview not available.</p>
            </div>
          ) : citation.fileType === 'image' ? (
            <div className="flex h-full items-center justify-center p-4">
              <img
                src={fileUrl}
                alt={citation.title}
                className="max-h-full max-w-full object-contain rounded-lg shadow-xl border border-border"
                onError={e => { e.target.style.display = 'none'; }}
              />
            </div>
          ) : citation.fileType === 'excel' ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <svg className="mx-auto mb-3 h-12 w-12 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
                </svg>
                <p className="text-xs font-medium text-headings">{citation.title}</p>
                <p className="text-[10px] text-muted mt-1">Spreadsheet files cannot be previewed in-browser.</p>
                <a href={fileUrl} download
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover transition-colors duration-150">
                  <DownloadIcon />
                  Download to view
                </a>
              </div>
            </div>
          ) : (
            // Default to PDF rendering — file_type is "pdf" for the vast
            // majority of uploaded receipts/invoices (DOCUMENT_EXTENSIONS is
            // PDF-only, see pipeline.py), and an <embed> here degrades
            // gracefully to a browser download prompt if it somehow isn't.
            <embed src={fileUrl} type="application/pdf" className="w-full h-full" title={citation.title} />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyCitationsPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-slate-50/50 p-6 text-center">
      <FileTextIcon className="mb-2 h-8 w-8 text-slate-300" />
      <p className="mt-2 text-xs text-muted">Ask more questions to generate relevant citations.</p>
    </div>
  );
}

function AssistantMessage({ message, isActive, onSelectCitations }) {
  const citationCount = message.citations?.length || 0;
  return (
    <div className="flex gap-4">
      {/* Bot avatar */}
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-primary-tint text-primary">
        <BotIcon className="h-6 w-6 object-contain" />
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        <button
          type="button"
          onClick={() => onSelectCitations?.(message)}
          title={citationCount ? 'View this reply\'s sources' : undefined}
          className={`block w-[calc(100%+0.75rem)] select-text rounded-xl px-3 py-2 -ml-3 text-left transition-colors ${
            isActive ? 'bg-primary-tint/60 ring-1 ring-primary/30' : 'hover:bg-slate-50'
          }`}
        >
          <MarkdownText text={message.text} className="select-text text-xs leading-relaxed text-[#334155]" />
          {citationCount > 0 && (
            <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-muted">
              <FileTextIcon className="h-3 w-3" />
              {citationCount} source{citationCount === 1 ? '' : 's'}
            </span>
          )}
        </button>

        {message.structured && (
          <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
            {/* Highlight block */}
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-center gap-2 mb-1">
                <SparkleIcon />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  {message.structured.highlight.label}
                </span>
              </div>
              <p className="font-headings text-xl font-bold tracking-tight text-headings">{message.structured.highlight.value}</p>
              <p className="mt-1 text-xs text-muted">{message.structured.highlight.note}</p>
            </div>

            {/* Check items */}
            <div className="divide-y divide-slate-50 px-5 py-2">
              {message.structured.checkItems.map((item, i) => (
                <div key={i} className="flex items-start gap-3 py-3">
                  <CheckCircleIcon />
                  <p className="text-xs text-[#334155]">
                    <span className="font-semibold text-headings">{item.bold} </span>
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ message, isActive, onSelectCitations }) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={() => onSelectCitations?.(message)}
        title="View sources for this question's reply"
        className={`max-w-[75%] select-text rounded-2xl rounded-tr-sm border px-4 py-3 text-left shadow-sm transition-colors ${
          isActive
            ? 'border-primary/40 bg-primary-tint ring-2 ring-primary/50'
            : 'border-border bg-surface hover:bg-slate-50'
        }`}
      >
        <p className="select-text text-xs leading-relaxed text-headings">{message.text}</p>
      </button>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-primary-tint text-primary">
        <BotIcon className="h-6 w-6 object-contain" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3 shadow-sm">
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: '0ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: '150ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

// ── Chat history sidebar ─────────────────────────────────────────────────────
// Claude-style collapsible left sidebar: lists this entity's chat sessions
// (from Postgres via getChatSessions), grouped by recency, with a "new chat"
// action and a per-row delete. Collapses to a slim icon rail rather than
// disappearing entirely, so the toggle stays reachable — mirrors how
// Claude's own sidebar collapse behaves.

function ChatHistorySidebar({
  isOpen, onToggle, sessions, isLoading, isLoadingMore, hasMore, onLoadMore, activeSessionId, onSelectSession, onNewChat, onDeleteSession,
  searchQuery, onSearchQueryChange, searchResults, searchLoading, isSearchActive,
}) {
  const grouped = groupSessionsByRecency(sessions);

  // Fires onLoadMore once the list is scrolled within ~80px of its bottom —
  // the same "near the end" threshold pattern most infinite-scroll lists
  // use, so the next page starts fetching a little before the user actually
  // hits the hard bottom edge rather than after, keeping the scroll feeling
  // continuous instead of pausing on a visible edge each time. Only relevant
  // to the normal paginated list — search results aren't paginated, so this
  // is a no-op (onLoadMore isn't called) while a search is active.
  function handleScroll(e) {
    if (isSearchActive) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 80) {
      onLoadMore?.();
    }
  }

  // Collapsed rail: just the toggle and a "new chat" icon button, both still
  // reachable with one click — collapsing shouldn't strand the user.
  if (!isOpen) {
    return (
      <div className="hidden lg:flex w-14 shrink-0 h-full flex-col items-center gap-2 rounded-2xl border border-border bg-surface py-3 shadow-sm">
        <button
          onClick={onToggle}
          title="Show chat history"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-slate-50 hover:text-headings"
        >
          <PanelLeftIcon />
        </button>
        <button
          onClick={onNewChat}
          title="New chat"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-slate-50 hover:text-headings"
        >
          <PlusIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="hidden lg:flex lg:flex-col w-64 shrink-0 h-full min-h-0 rounded-2xl border border-border bg-surface shadow-sm overflow-hidden">
      {/* Header: title + collapse toggle */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3 shrink-0">
        <span className="text-sm font-bold text-headings">Chat history</span>
        <button
          onClick={onToggle}
          title="Hide chat history"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-slate-50 hover:text-headings"
        >
          <PanelLeftIcon className="h-4 w-4" />
        </button>
      </div>

      {/* New chat button */}
      <div className="px-3 pt-3 shrink-0">
        <button
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-headings shadow-sm transition-colors hover:bg-slate-50"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New chat
        </button>
      </div>

      {/* Search box — matches both session titles and message content (see
          searchChatSessions), since titles alone are short AI-generated
          summaries that won't capture a specific figure or vendor name. */}
      <div className="px-3 pt-2.5 shrink-0">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-slate-50/50 px-2.5 py-2 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search chats…"
            className="min-w-0 flex-1 bg-transparent text-xs text-headings placeholder-[#94A3B8] outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchQueryChange('')}
              title="Clear search"
              className="shrink-0 rounded-md p-0.5 text-slate-300 transition-colors hover:text-headings"
            >
              <XIcon />
            </button>
          )}
        </div>
      </div>

      {/* Session list — only the current page (20 most recent, then 20 more
          per scroll-triggered fetch) is ever in `sessions`, never the user's
          full chat history at once. While a search is active, this renders
          `searchResults` instead (a single ranked list, not paginated). */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 py-3 space-y-4" onScroll={handleScroll}>
        {isSearchActive ? (
          searchLoading && searchResults.length === 0 ? (
            <p className="px-2 text-xs text-muted">Searching…</p>
          ) : searchResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
              <SearchIcon className="h-6 w-6 text-slate-300" />
              <p className="text-xs text-muted">No conversations match "{searchQuery.trim()}".</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {searchResults.map((s) => (
                <SessionRow
                  key={s.sessionId}
                  session={s}
                  isActive={s.sessionId === activeSessionId}
                  onSelectSession={onSelectSession}
                  onDeleteSession={onDeleteSession}
                  matchedIn={s.matchedIn}
                  snippet={s.snippet}
                />
              ))}
            </div>
          )
        ) : isLoading ? (
          <p className="px-2 text-xs text-muted">Loading…</p>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
            <MessageSquareIcon className="h-6 w-6 text-slate-300" />
            <p className="text-xs text-muted">No conversations yet. Ask a question to start one.</p>
          </div>
        ) : (
          <>
            {grouped.map((group) => (
              <div key={group.label}>
                <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map((s) => (
                    <SessionRow
                      key={s.sessionId}
                      session={s}
                      isActive={s.sessionId === activeSessionId}
                      onSelectSession={onSelectSession}
                      onDeleteSession={onDeleteSession}
                    />
                  ))}
                </div>
              </div>
            ))}
            {/* Bottom-of-list state: either a small spinner row while the
                next page is being fetched, or (once hasMore is false) an
                "end of history" marker so it's clear scrolling further
                won't reveal anything — rather than looking like it's
                just silently stuck. */}
            {isLoadingMore ? (
              <p className="px-2 pt-1 text-center text-[10px] text-muted">Loading more…</p>
            ) : !hasMore ? (
              <p className="px-2 pt-1 text-center text-[10px] text-slate-300">No more conversations</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Single row in the sidebar's session list — shared between the normal
 * recency-grouped list and search results, so the two only differ in what's
 * shown below the title: search results additionally show a "Title"/"Message"
 * badge and a matched snippet (from searchChatSessions' matchedIn/snippet),
 * while the normal list just shows the relative timestamp.
 */
function SessionRow({ session: s, isActive, onSelectSession, onDeleteSession, matchedIn, snippet }) {
  return (
    <div
      onClick={() => onSelectSession(s.sessionId)}
      className={`group flex items-center gap-1.5 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
        isActive ? 'bg-primary-tint' : 'hover:bg-slate-50'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className={`truncate text-xs font-medium ${isActive ? 'text-primary' : 'text-headings'}`}>
          {s.title || 'New conversation'}
        </p>
        {matchedIn ? (
          <div className="flex items-center gap-1">
            <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
              {matchedIn === 'title' ? 'Title' : 'Message'}
            </span>
            {matchedIn === 'message' && (
              <p className="truncate text-[10px] text-muted">{snippet}</p>
            )}
          </div>
        ) : (
          <p className="truncate text-[10px] text-muted">{timeAgo(s.updatedAt)}</p>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDeleteSession(s.sessionId); }}
        title="Delete conversation"
        className="shrink-0 rounded-md p-1 text-slate-300 opacity-0 transition-all hover:bg-critical-bg hover:text-critical group-hover:opacity-100"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

function CukaiBot() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [activeCitations, setActiveCitations] = useState([]);
  // Which assistant message's citations are currently shown in the side
  // panel — lets the UI highlight "you're viewing message X's sources" and
  // gives handleSelectCitations something to compare against. null when no
  // message has been explicitly selected yet (falls back to the newest
  // citation-bearing message, same as the old default behavior).
  const [activeCitationsMessageId, setActiveCitationsMessageId] = useState(null);
  const [activeEntity, setActiveEntity] = useState(null);
  // Which citation's document is currently open in the in-page preview
  // modal (see DocumentPreviewModal below) — null when closed. Only ever
  // set for citations with isInternal:true (a user's own uploaded document
  // served from this backend's /files/ mount); external LHDN links still
  // open in a new tab via CitationCard's existing window.open path.
  const [previewCitation, setPreviewCitation] = useState(null);
  // Backend-issued chat session id — null until the first message is sent
  // (or until an existing session is resolved for this entity), mirroring
  // how a WhatsApp thread gets its ID on its first message.
  const [sessionId, setSessionId] = useState(null);

  // ── Chat history sidebar state ─────────────────────────────────────────
  const SESSIONS_PAGE_SIZE = 20;
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  // Whether an older page of sessions is currently being fetched (separate
  // from sessionsLoading, which is only the very first page's spinner) —
  // lets the list show a small "loading more…" row at the bottom instead of
  // blanking the whole sidebar while paging.
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);
  // Whether there's another page of older sessions the backend hasn't sent
  // yet. Starts true so the very first scroll-to-bottom check (before the
  // initial load even resolves) doesn't skip fetching.
  const [sessionsHasMore, setSessionsHasMore] = useState(true);

  // ── Chat history search ─────────────────────────────────────────────────
  // Searches BOTH session titles and message content (see searchChatSessions
  // / the backend's /api/chat/search) rather than titles alone — titles are
  // short AI-generated summaries that won't capture a specific figure, vendor
  // name, or ITA section a person might search for. Kept entirely separate
  // from the paginated `sessions` list above: while a search query is active
  // the sidebar renders `searchResults` instead of the normal recency-grouped
  // list, and scroll-triggered pagination is suspended (a search's results
  // already come back as one ranked list, not a page to infinitely-scroll).
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const isSearchActive = searchQuery.trim().length > 0;
  // Defaults open on desktop, same as Claude's own sidebar; persisted so a
  // returning user's collapse preference sticks across visits/reloads.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const stored = localStorage.getItem('cukaiChatSidebarOpen');
    return stored === null ? true : stored === 'true';
  });

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Load active entity for context and listen for entity switches
  useEffect(() => {
    const loadEntity = async () => {
      const userId = localStorage.getItem('userId');
      if (!userId) return;
      try {
        // Don't assume activeEntityId already exists — this page can be the
        // first one a user lands on right after login. Resolve a default
        // entity here too, the same way Overview and ManageAccount do.
        const entities = await getAllEntities(userId).catch(() => []);
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

  // Load the conversation for the active entity whenever it changes, so
  // switching entities swaps the chat history instead of carrying over the
  // previous entity's conversation. This page doesn't yet persist "the last
  // session_id used for entity X" anywhere the way activeEntityId is
  // persisted, so switching entities starts a fresh session — the first
  // message sent against the new entity creates it. Existing sessions can
  // still be resumed by whatever surface passes a sessionId in via
  // `?session=` (see the URL-param read below).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramSessionId = params.get('session');
    const userId = localStorage.getItem('userId');

    if (!paramSessionId || !userId) {
      setMessages([]);
      setActiveCitations([]);
      setActiveCitationsMessageId(null);
      setSessionId(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const history = await getChatHistory(paramSessionId, userId);
        if (cancelled) return;
        setSessionId(history.sessionId);
        setMessages(history.messages || []);
        const lastWithCitations = [...(history.messages || [])].reverse().find(m => m.citations?.length);
        setActiveCitations(lastWithCitations?.citations || []);
        setActiveCitationsMessageId(lastWithCitations?.id ?? null);
      } catch (_) {
        if (cancelled) return;
        // Session id was invalid/stale/not owned by this user — fall back to
        // the same empty/welcome state a brand-new entity would show.
        setMessages([]);
        setActiveCitations([]);
        setActiveCitationsMessageId(null);
        setSessionId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [activeEntity?.id]);

  // Load the sidebar's session list for the active entity, and reload it
  // whenever the entity changes — mirrors the message-history effect above,
  // so switching entities swaps both the conversation AND the sidebar list
  // together rather than leaving a stale list from the previous entity.
  //
  // Only ever fetches the first page (20 most-recent sessions) — this is
  // what runs on initial page load / entity switch, so the page never pulls
  // in a user's entire chat history just to render the sidebar. Older
  // sessions are fetched on demand by loadMoreSessions below, as the user
  // scrolls the list toward its bottom.
  async function refreshSessions() {
    const userId = localStorage.getItem('userId');
    if (!userId) { setSessions([]); setSessionsHasMore(false); return; }
    setSessionsLoading(true);
    try {
      const page = await getChatSessions(userId, activeEntity?.id ?? null, SESSIONS_PAGE_SIZE, 0);
      setSessions(page?.sessions || []);
      setSessionsHasMore(!!page?.hasMore);
    } catch (_) {
      setSessions([]);
      setSessionsHasMore(false);
    } finally {
      setSessionsLoading(false);
    }
  }

  // Sidebar infinite-scroll: fetches the next 20-session page and appends it
  // to the list already on screen. Guards against duplicate fetches (e.g.
  // a fast double-scroll firing the handler twice) by bailing out whenever
  // a fetch is already in flight or the backend has already said there's
  // nothing left to page in.
  async function loadMoreSessions() {
    if (sessionsLoadingMore || sessionsLoading || !sessionsHasMore) return;
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    setSessionsLoadingMore(true);
    try {
      const page = await getChatSessions(userId, activeEntity?.id ?? null, SESSIONS_PAGE_SIZE, sessions.length);
      setSessions((prev) => [...prev, ...(page?.sessions || [])]);
      setSessionsHasMore(!!page?.hasMore);
    } catch (_) {
      // Leave the existing list as-is on a failed page fetch — the user can
      // just scroll again to retry, rather than losing what's already shown.
    } finally {
      setSessionsLoadingMore(false);
    }
  }

  useEffect(() => {
    refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntity?.id]);

  // Debounced chat-history search: waits 300ms after the user stops typing
  // before hitting the backend, the standard "don't fire a request per
  // keystroke" pattern. Clearing the box (or it being all whitespace) just
  // empties the results and skips the network call entirely — the sidebar
  // falls back to rendering the normal paginated `sessions` list in that
  // case (see isSearchActive).
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    const userId = localStorage.getItem('userId');
    if (!userId) return;

    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchChatSessions(trimmed, userId, activeEntity?.id ?? null);
        if (!cancelled) setSearchResults(res?.results || []);
      } catch (_) {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery, activeEntity?.id]);

  useEffect(() => {
    if (messages.length > 2) { 
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  async function handleSend(text) {
    const trimmed = (text || inputValue).trim();
    if (!trimmed) return;

    const userId = localStorage.getItem('userId');
    if (!userId) return;

    const userMsg = { id: Date.now(), role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);
    setActiveCitations([]);
    setActiveCitationsMessageId(null);

    try {
      const res = await sendChatMessage(trimmed, userId, activeEntity?.id ?? null, sessionId);
      // First message of a brand-new conversation returns a freshly created
      // session_id — remember it so every subsequent message in this tab
      // continues the same thread instead of spawning a new one each time.
      if (res.sessionId && res.sessionId !== sessionId) {
        setSessionId(res.sessionId);
        const params = new URLSearchParams(window.location.search);
        params.set('session', res.sessionId);
        window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
      }
      const botMsg = {
        id: res.message.id,
        role: 'assistant',
        text: res.message.text,
        citations: res.message.citations || [],
      };
      setMessages((prev) => [...prev, botMsg]);
      setActiveCitations(botMsg.citations);
      setActiveCitationsMessageId(botMsg.id);
      // Sidebar list needs refreshing either way: a brand-new session must
      // now appear in it (already carrying its final AI-generated title —
      // see main.py's post_chat_message, which resolves the title
      // synchronously as part of the classification call before this
      // response is even returned), and an existing one's updatedAt (used
      // for the "Today" grouping and sort order) has just changed too.
      refreshSessions();
    } catch (err) {
      const errMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        text: "Sorry, something went wrong reaching Cukai Bot. Please try again in a moment.",
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsTyping(false);
    }
  }

  async function handleClear() {
    const userId = localStorage.getItem('userId');
    if (sessionId && userId) {
      deleteChatSession(sessionId, userId).catch(() => {});
    }
    setMessages([]);
    setActiveCitations([]);
    setActiveCitationsMessageId(null);
    setInputValue('');
    setSessionId(null);
    const params = new URLSearchParams(window.location.search);
    params.delete('session');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    // The header's "Clear Chat" button deletes the current session outright
    // (existing behavior, unchanged) — remove it from the sidebar list too
    // rather than waiting for the next natural refresh.
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  }

  // Sidebar "New chat" button: unlike handleClear, this does NOT delete the
  // current session — it just deselects it, so the conversation the person
  // was just in still shows up in the sidebar to come back to. A fresh
  // session is only actually created once they send their first message
  // (same as any brand-new conversation — see handleSend).
  function handleNewChat() {
    setMessages([]);
    setActiveCitations([]);
    setActiveCitationsMessageId(null);
    setInputValue('');
    setSessionId(null);
    const params = new URLSearchParams(window.location.search);
    params.delete('session');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }

  // Sidebar row click: load that session's full history and make it active,
  // the same way resuming via a `?session=` URL param already works (see
  // the history-loading effect above) — just triggered by a click instead
  // of a page load.
  async function handleSelectSession(targetSessionId) {
    // Selecting a session (including re-selecting the one already open, if
    // that's what a search result pointed at) always dismisses any active
    // search — the sidebar should return to the normal recency list once the
    // user has picked what they were looking for, the same way typing a
    // search in Claude/ChatGPT and clicking a result closes the search UI.
    setSearchQuery('');
    if (targetSessionId === sessionId) return;
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    try {
      const history = await getChatHistory(targetSessionId, userId);
      setSessionId(history.sessionId);
      setMessages(history.messages || []);
      const lastWithCitations = [...(history.messages || [])].reverse().find((m) => m.citations?.length);
      setActiveCitations(lastWithCitations?.citations || []);
      setActiveCitationsMessageId(lastWithCitations?.id ?? null);
      const params = new URLSearchParams(window.location.search);
      params.set('session', history.sessionId);
      window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
    } catch (_) {
      // Stale/deleted session clicked from a list that hasn't refreshed yet
      // — drop it from the sidebar rather than leaving a dead entry.
      setSessions((prev) => prev.filter((s) => s.sessionId !== targetSessionId));
    }
  }

  // Message click handler (both UserMessage and AssistantMessage wire into
  // this): shows THAT turn's own citations in the side panel, instead of
  // always defaulting to only the newest response's. A user question has no
  // citations of its own — it's answered by the very next assistant message
  // in the array — so clicking a user bubble looks one slot ahead to find
  // the reply it produced. Clicking an assistant message with no citations
  // (e.g. a profile/small-talk answer that needed no retrieval — see
  // _classify_and_maybe_answer's fast path) still selects it, correctly
  // clearing the panel to empty for that turn rather than leaving a
  // different turn's sources looking active.
  function handleSelectCitations(clickedMessage) {
    let target = clickedMessage;
    if (clickedMessage.role === 'user') {
      const idx = messages.findIndex((m) => m.id === clickedMessage.id);
      target = idx !== -1 ? messages[idx + 1] : null;
    }
    if (!target || target.role !== 'assistant') return;
    setActiveCitations(target.citations || []);
    setActiveCitationsMessageId(target.id);
  }

  // Sidebar row's trash icon: deletes ANY session in the list, not just the
  // currently open one (that's the difference from handleClear, which only
  // ever acts on the active session). If the deleted session happens to be
  // the one currently open, also clear the main view so it doesn't keep
  // showing a conversation that no longer exists.
  async function handleDeleteSessionFromSidebar(targetSessionId) {
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    setSessions((prev) => prev.filter((s) => s.sessionId !== targetSessionId));
    if (targetSessionId === sessionId) {
      handleNewChat();
    }
    try {
      await deleteChatSession(targetSessionId, userId);
    } catch (_) {
      // Deletion failed server-side after we'd already optimistically
      // removed it from view — refresh from the server to reconcile rather
      // than leaving the sidebar showing a session that's actually still there.
      refreshSessions();
    }
  }

  function toggleSidebar() {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('cukaiChatSidebarOpen', String(next));
      return next;
    });
  }

  // ── Export the current chat session to a downloadable PDF ──────────────────
  // Dumps every message in the transcript, then appends the sidebar's
  // "Active Citations" (the same `activeCitations` state driving the right
  // panel) as its own section at the very end of the document.
  function handleExportPDF() {
    if (!messages || messages.length === 0) return;

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 48;
    const maxWidth = pageWidth - margin * 2;
    let y = margin;

    const addLine = (text, { size = 10, style = 'normal', color = [15, 23, 42], gap = 14 } = {}) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      const lines = doc.splitTextToSize(text, maxWidth);
      lines.forEach((line) => {
        if (y > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += gap;
      });
    };

    const addRule = (gapBefore = 6, gapAfter = 16) => {
      y += gapBefore;
      if (y > pageHeight - margin) { doc.addPage(); y = margin; }
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y, pageWidth - margin, y);
      y += gapAfter;
    };

    // ── Document header ──
    addLine('Cukai Bot Conversation', { size: 16, style: 'bold', gap: 22 });
    if (activeEntity) addLine(`Entity: ${activeEntity.name}`, { size: 9, color: [100, 116, 139], gap: 12 });
    addLine(`Exported ${new Date().toLocaleString('en-MY')}`, { size: 9, color: [100, 116, 139], gap: 20 });

    // ── Messages ──
    messages.forEach((msg) => {
      const speaker = msg.role === 'user' ? 'You' : 'Cukai Bot';
      addLine(speaker, { size: 10, style: 'bold', color: msg.role === 'user' ? [15, 23, 42] : [13, 148, 136], gap: 14 });
      addLine(msg.text, { size: 10, gap: 14 });

      if (msg.structured) {
        const h = msg.structured.highlight;
        if (h) {
          addLine(`${h.label}: ${h.value}`, { size: 10, style: 'bold', gap: 14 });
          if (h.note) addLine(h.note, { size: 9, color: [100, 116, 139], gap: 12 });
        }
        (msg.structured.checkItems || []).forEach((item) => {
          addLine(`\u2022 ${item.bold} ${item.text}`, { size: 9, gap: 12 });
        });
      }

      y += 8; // gap between messages
    });

    // ── Active Citations — appended as its own section at the end, mirroring
    //    the right-hand sidebar's current state rather than per-message data ──
    if (activeCitations && activeCitations.length > 0) {
      addRule();
      addLine('Active Citations', { size: 13, style: 'bold', gap: 18 });
      activeCitations.forEach((c) => {
        addLine(`[${c.tag}] ${c.title}`, { size: 10, style: 'bold', gap: 13 });
        if (c.snippet) addLine(c.snippet, { size: 9, style: 'italic', color: [100, 116, 139], gap: 12 });
        if (c.verified) addLine(c.verified, { size: 8, color: [13, 148, 136], gap: 11 });
        y += 6;
      });
    }

    const entityPart = activeEntity ? activeEntity.name.replace(/[^\w-]+/g, '_') : 'session';
    const datePart = new Date().toISOString().slice(0, 10);
    doc.save(`cukaibot-${entityPart}-${datePart}.pdf`);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const showEmptyState = messages.length === 0;
  // Once a question has been asked, swap the static "Tax Advisory Assistant"
  // header for this conversation's own title — same title shown in the
  // sidebar (see main.py's post_chat_message, which generates it via the
  // classification call for a brand-new session). Looked up from `sessions`
  // rather than stored separately, since that list already carries every
  // session's title and stays in sync via refreshSessions(). Falls back to
  // the original static label whenever there's no active session yet (the
  // empty/welcome state) or its title hasn't loaded/generated yet.
  const activeSessionTitle = !showEmptyState
    ? sessions.find((s) => s.sessionId === sessionId)?.title
    : null;

  return (
    <main className="h-[calc(100vh-4.1rem)] bg-background font-body flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-7xl flex flex-col gap-4 px-6 py-4 h-full overflow-hidden">

        {/* ── Page Header (shrink-0 prevents it from squishing) ── */}
        <div className="shrink-0">
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Cukai Bot</h1>
      {activeEntity && <p className="text-xs text-muted mt-0.5">Context: {activeEntity.name}</p>}
          <p className="mt-1 text-xs text-muted">
            Ask anything about Malaysian tax regulations, deductions, or e-invoicing — powered by LHDN 2024 Guidelines.
          </p>
        </div>

        {/* ── Master Split Layout Area ── */}
        <div className="flex flex-1 gap-6 min-h-0 overflow-hidden">

          {/* ── Chat History Sidebar (collapsible) ── */}
          <ChatHistorySidebar
            isOpen={sidebarOpen}
            onToggle={toggleSidebar}
            sessions={sessions}
            isLoading={sessionsLoading}
            isLoadingMore={sessionsLoadingMore}
            hasMore={sessionsHasMore}
            onLoadMore={loadMoreSessions}
            activeSessionId={sessionId}
            onSelectSession={handleSelectSession}
            onNewChat={handleNewChat}
            onDeleteSession={handleDeleteSessionFromSidebar}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searchResults={searchResults}
            searchLoading={searchLoading}
            isSearchActive={isSearchActive}
          />

          {/* ── Left Column: Interactive Chat Stream Area ── */}
          <div className="flex-1 flex flex-col h-full min-w-0 rounded-2xl border border-border bg-surface shadow-sm overflow-hidden">
            
            {/* ── RE-ADDED CHAT HEADER (shrink-0 captures correct layout boundary) ── */}
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-tint">
                  <BotIcon className="h-6 w-6 object-contain" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-headings">
                    {activeSessionTitle || 'Tax Advisory Assistant'}
                  </p>
                  <p className="text-xs text-muted">Powered by LHDN 2024 Guidelines</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClear}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-muted shadow-sm transition-colors hover:bg-slate-50 hover:text-headings"
                >
                  <ClearIcon />
                  Clear Chat
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={showEmptyState}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-muted shadow-sm transition-colors hover:bg-slate-50 hover:text-headings disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <DownloadIcon />
                  Export
                </button>
              </div>
            </div>

            {/* Scrollable Message Flow Box */}
            <div className="flex-1 overflow-y-auto min-h-0 px-5 py-6 space-y-5">
              
              {/* Empty / welcome state */}
              {showEmptyState && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-tint">
                    <BotIcon className="h-8 w-8 object-contain" />
                  </div>
                  <h2 className="font-headings text-2xl font-bold tracking-tight text-headings">How can I assist with your taxes today?</h2>
                  <p className="mt-2 max-w-xs text-xs text-muted">
                    Ask me anything about Malaysian tax regulations, deductions, or e-invoicing phases.
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {suggestedPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleSend(prompt)}
                        className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-[#334155] shadow-sm transition-all hover:border-primary hover:bg-primary-tint hover:text-primary"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Messages List */}
              {(messages || []).map((msg, i) => {
                if (msg.role === 'user') {
                  // A user turn's "active" state mirrors its paired reply's
                  // (the next message) — there's nothing citation-bearing on
                  // the question itself to compare against directly.
                  const reply = messages[i + 1];
                  const isActive = !!reply && reply.role === 'assistant' && reply.id === activeCitationsMessageId;
                  return <UserMessage key={msg.id} message={msg} isActive={isActive} onSelectCitations={handleSelectCitations} />;
                }
                return (
                  <AssistantMessage
                    key={msg.id}
                    message={msg}
                    isActive={msg.id === activeCitationsMessageId}
                    onSelectCitations={handleSelectCitations}
                  />
                );
              })}

              {isTyping && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>

            {/* Contextual Chips Tray Container */}
            {!showEmptyState && (
              <div className="border-t border-slate-50 px-5 py-2.5 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-none">
                {(suggestedPrompts || []).slice(0, 3).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    className="shrink-0 rounded-full border border-border bg-slate-50 px-3 py-1.5 text-xs font-medium text-muted transition-all hover:border-primary hover:bg-primary-tint hover:text-primary"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {/* Locked Footer Action/Input Tray */}
            <div className="border-t border-border p-4 shrink-0">
              <div className="flex items-end gap-2 rounded-xl border border-border bg-slate-50/50 px-3 py-2 transition-all focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about deductions, regulations, or upload a notice..."
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-xs text-headings placeholder-[#94A3B8] outline-none py-2 align-middle"
                  style={{ maxHeight: '96px' }}
                />
                <div className="flex shrink-0 items-center gap-1 pb-0.5">
                  <button type="button" className="rounded-lg p-1.5 text-muted transition-colors hover:bg-slate-200">
                    <AttachIcon />
                  </button>
                  <button
                    onClick={() => handleSend()}
                    disabled={!inputValue.trim() || isTyping}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-sm transition-all hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <SendIcon />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-center text-[10px] text-[#94A3B8]">
                AI can make mistakes. Always verify with official LHDN resources.
              </p>
            </div>
          </div>

          {/* ── Right Column: Fixed Side Panel ── */}
          <div className="hidden lg:flex lg:flex-col w-80 shrink-0 h-full min-h-0 gap-4 overflow-hidden">
            
            {/* Citation Box */}
            <div className="flex-1 flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm overflow-hidden">
              <div className="mb-4 flex items-center gap-2 shrink-0">
                <BookIcon className="text-primary" />
                <h2 className="text-sm font-bold text-headings">Active Citations</h2>
              </div>
              <p className="mb-4 text-xs text-muted shrink-0">
                {activeCitationsMessageId && activeCitationsMessageId !== messages[messages.length - 1]?.id
                  ? 'Sources for the selected message below. Click any other message to switch.'
                  : 'Sources referenced in the current response. Click an earlier message to view its sources.'}
              </p>

              {/* Scrollable container strictly within the right panel */}
              <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
                {(activeCitations || []).length > 0 ? (
                  activeCitations.map((citation, i) => (
                    <CitationCard key={i} citation={citation} onPreview={setPreviewCitation} />
                  ))
                ) : (
                  <EmptyCitationsPlaceholder />
                )}
              </div>
            </div>

            {/* Disclaimer Notice Block */}
            <div className="rounded-2xl border border-warning/30 bg-warning-bg p-4 shrink-0">
              <p className="text-xs font-semibold text-warning">Important Notice</p>
              <p className="mt-1.5 text-xs leading-relaxed text-warning">
                Cukai Bot provides guidance based on publicly available LHDN regulations. Always consult a licensed tax agent for filing advice specific to your situation.
              </p>
            </div>

          </div>
        </div>
      </div>

      {previewCitation && (
        <DocumentPreviewModal citation={previewCitation} onClose={() => setPreviewCitation(null)} />
      )}
    </main>
  );
}

export default CukaiBot;