import { useState } from 'react';

// ── Icons ─────────────────────────────────────────────────────────────────────

const SparkleIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const FilterIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

const ArchiveIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const InboxIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

// ── Mock Data ─────────────────────────────────────────────────────────────────

const MOCK_INSIGHTS = [
  {
    id: 1,
    title: 'Deductible Expense Opportunity Detected',
    summary: 'Your recent broadband bills (RM249/month) may qualify as a business expense under Section 33(1) ITA 1967. Based on your linked receipts, an estimated RM2,988 is potentially deductible for YA 2024.',
    category: 'Deduction',
    priority: 'high',
    read: false,
    archived: false,
    timestamp: '2025-05-29T09:14:00',
    source: 'CukaiVault Analysis',
    actionable: true,
    tag: 'Section 33(1)',
  },
  {
    id: 2,
    title: 'E-Invoice Compliance Reminder',
    summary: "Your business falls under Phase 2 of LHDN's mandatory e-invoicing rollout (revenue RM25M–RM100M). The deadline is 1 January 2025. Ensure your accounting system is MyInvois-compatible.",
    category: 'Compliance',
    priority: 'high',
    read: false,
    archived: false,
    timestamp: '2025-05-28T14:30:00',
    source: 'LHDN Regulation Update',
    actionable: true,
    tag: 'e-Invoice',
  },
  {
    id: 3,
    title: 'Capital Allowance Not Yet Claimed',
    summary: 'Equipment purchases totalling RM14,500 in Q1 2024 have not been linked to any capital allowance claim. Under Schedule 3, ITA 1967, you may be entitled to an initial allowance of 20% and annual allowance of 14%.',
    category: 'Tax Saving',
    priority: 'medium',
    read: false,
    archived: false,
    timestamp: '2025-05-27T11:05:00',
    source: 'CukaiVault Analysis',
    actionable: true,
    tag: 'Schedule 3',
  },
  {
    id: 4,
    title: 'Payroll PCB Reconciliation Advisory',
    summary: 'A mismatch of RM320 was detected between your monthly PCB submissions and your payroll summary for March 2024. This should be reconciled before submitting Form E to avoid LHDN penalties.',
    category: 'Advisory',
    priority: 'medium',
    read: true,
    archived: false,
    timestamp: '2025-05-25T08:50:00',
    source: 'Payroll Module',
    actionable: true,
    tag: 'PCB / Form E',
  },
  {
    id: 5,
    title: 'Personal Tax Relief: Medical Expenses',
    summary: 'Medical receipts for your parents totalling RM3,200 are eligible for relief under Section 46(1)(c). Your current claim of RM1,000 appears incomplete — review and update your YA 2024 return.',
    category: 'Deduction',
    priority: 'medium',
    read: true,
    archived: false,
    timestamp: '2025-05-22T16:20:00',
    source: 'CukaiBot Session',
    actionable: true,
    tag: 'Section 46(1)(c)',
  },
  {
    id: 6,
    title: 'Form CP58 Submission Approaching',
    summary: 'If your company paid commission to agents exceeding RM5,000 in 2024, you are required to submit Form CP58 by 31 March 2025. Based on your records, 3 agents may qualify.',
    category: 'Compliance',
    priority: 'low',
    read: true,
    archived: false,
    timestamp: '2025-05-20T10:00:00',
    source: 'LHDN Regulation Update',
    actionable: false,
    tag: 'Form CP58',
  },
  {
    id: 7,
    title: 'Audit Trail: Missing Source Documents',
    summary: '2 of your linked CukaiVault reports are missing supporting source documents. Adding bank statements and supplier invoices strengthens your audit trail and reduces risk during LHDN review.',
    category: 'Advisory',
    priority: 'low',
    read: true,
    archived: false,
    timestamp: '2025-05-18T13:45:00',
    source: 'CukaiVault Analysis',
    actionable: true,
    tag: 'Audit Trail',
  },
  {
    id: 8,
    title: 'YA 2023 Report Summary Ready',
    summary: 'Your tax summary for YA 2023 has been compiled. Total reported income: RM182,400. Total deductible expenses: RM41,200. Estimated tax impact: RM28,560. Review is recommended before filing.',
    category: 'Report',
    priority: 'low',
    read: true,
    archived: true,
    timestamp: '2025-04-10T09:00:00',
    source: 'CukaiVault Report',
    actionable: false,
    tag: 'YA 2023',
  },
  {
    id: 9,
    title: 'YA 2024 Report Summary Ready',
    summary: 'Your tax summary for YA 2023 has been compiled. Total reported income: RM182,400. Total deductible expenses: RM41,200. Estimated tax impact: RM28,560. Review is recommended before filing.',
    category: 'Report',
    priority: 'low',
    read: true,
    archived: true,
    timestamp: '2025-04-10T09:00:00',
    source: 'CukaiVault Report',
    actionable: false,
    tag: 'YA 2024',
  },
  {
    id: 10,
    title: 'YA 2025 Report Summary Ready',
    summary: 'Your tax summary for YA 2023 has been compiled. Total reported income: RM182,400. Total deductible expenses: RM41,200. Estimated tax impact: RM28,560. Review is recommended before filing.',
    category: 'Report',
    priority: 'low',
    read: true,
    archived: true,
    timestamp: '2025-04-10T09:00:00',
    source: 'CukaiVault Report',
    actionable: false,
    tag: 'YA 2025',
  },
];

const CATEGORIES = ['All', 'Deduction', 'Compliance', 'Tax Saving', 'Advisory', 'Report'];
const SORT_OPTIONS = ['Newest First', 'Oldest First', 'Priority', 'Unread First'];
const PRIORITY_COLOR = {
  high: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', dot: 'bg-red-500' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', dot: 'bg-amber-400' },
  low: { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400' },
};
const CATEGORY_COLOR = {
  Deduction: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Compliance: 'bg-blue-50 text-blue-700 border-blue-200',
  'Tax Saving': 'bg-teal-50 text-teal-700 border-teal-200',
  Advisory: 'bg-purple-50 text-purple-700 border-purple-200',
  Report: 'bg-slate-50 text-slate-600 border-slate-200',
};

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today, ' + d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Insight Detail Modal ───────────────────────────────────────────────────────

function InsightModal({ insight, onClose, onMarkRead, onArchive, onDelete }) {
  if (!insight) return null;
  const pr = PRIORITY_COLOR[insight.priority];
  const cat = CATEGORY_COLOR[insight.category] || 'bg-slate-50 text-slate-600 border-slate-200';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 px-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f0fdf9]">
              <SparkleIcon className="h-4 w-4 text-[#0D9488]" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#64748B]">{insight.source}</p>
              <p className="text-xs text-[#94A3B8]">{new Date(insight.timestamp).toLocaleString('en-MY')}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[#64748B] hover:bg-slate-100">
            <XIcon />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${pr.bg} ${pr.text} ${pr.border}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${pr.dot}`} />
              {insight.priority.charAt(0).toUpperCase() + insight.priority.slice(1)} Priority
            </span>
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${cat}`}>{insight.category}</span>
            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-mono text-[#64748B]">{insight.tag}</span>
          </div>
          <h2 className="text-base font-bold text-[#0F172A] leading-snug">{insight.title}</h2>
          <p className="text-sm leading-relaxed text-[#334155]">{insight.summary}</p>
          {insight.actionable && (
            <div className="rounded-xl border border-[#10B981]/20 bg-[#f0fdf9] px-4 py-3">
              <p className="text-xs font-semibold text-[#0D9488]">Action Recommended</p>
              <p className="mt-1 text-xs text-[#334155]">Review the relevant documents in CukaiVault and verify with your tax agent before taking action.</p>
            </div>
          )}
          <p className="text-[10px] text-[#94A3B8]">AI-generated insight. Always verify with a licensed tax agent or LHDN official resources before making tax decisions.</p>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-100 px-6 py-4">
          {!insight.read && (
            <button onClick={() => { onMarkRead(insight.id); onClose(); }} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F172A] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1E293B]">
              <CheckIcon /> Mark Read
            </button>
          )}
          <button onClick={() => { onArchive(insight.id); onClose(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-[#64748B] hover:bg-slate-50">
            <ArchiveIcon /> Archive
          </button>
          <button onClick={() => { onDelete(insight.id); onClose(); }} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-100 px-3.5 py-2 text-xs font-semibold text-red-500 hover:bg-red-50">
            <TrashIcon /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

function InsightsInbox() {
  const [insights, setInsights] = useState(MOCK_INSIGHTS);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [sortBy, setSortBy] = useState('Newest First');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState(null);
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const markRead = (id) => {
    setInsights(p => p.map(i => i.id === id ? { ...i, read: true } : i));
    showToast('Marked as read');
  };
  const markAllRead = () => {
    setInsights(p => p.map(i => ({ ...i, read: true })));
    showToast('All insights marked as read');
  };
  const archiveInsight = (id) => {
    setInsights(p => p.map(i => i.id === id ? { ...i, archived: true } : i));
    showToast('Insight archived');
  };
  const deleteInsight = (id) => {
    setInsights(p => p.filter(i => i.id !== id));
    showToast('Insight deleted');
  };

  const unreadCount = insights.filter(i => !i.read && !i.archived).length;

  const filtered = insights
    .filter(i => showArchived ? i.archived : !i.archived)
    .filter(i => activeCategory === 'All' || i.category === activeCategory)
    .filter(i => !search || i.title.toLowerCase().includes(search.toLowerCase()) || i.summary.toLowerCase().includes(search.toLowerCase()) || i.tag.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'Newest First') return new Date(b.timestamp) - new Date(a.timestamp);
      if (sortBy === 'Oldest First') return new Date(a.timestamp) - new Date(b.timestamp);
      if (sortBy === 'Priority') {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.priority] - order[b.priority];
      }
      if (sortBy === 'Unread First') return (a.read ? 1 : 0) - (b.read ? 1 : 0);
      return 0;
    });

  return (
    // ── CHANGED: min-h-screen → h-[calc(100vh-4rem)] + flex flex-col overflow-hidden
    // This locks the component to exactly the remaining viewport below the h-16 navbar,
    // preventing the outer page from ever needing to scroll.
    <main className="h-[calc(100vh-4.1rem)] bg-background font-body flex flex-col overflow-hidden">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-[#0F172A] px-4 py-3 text-sm font-medium text-white shadow-xl">
          <CheckIcon /> {toast}
        </div>
      )}

      {/* Detail Modal */}
      <InsightModal
        insight={selectedInsight}
        onClose={() => setSelectedInsight(null)}
        onMarkRead={markRead}
        onArchive={archiveInsight}
        onDelete={deleteInsight}
      />

      {/*
        ── CHANGED: removed space-y-6, added flex flex-col gap-4 h-full overflow-hidden
        The container is now a flex column that fills the full height of <main>.
        overflow-hidden here is essential — without it the container would expand
        past the viewport and re-introduce outer scrolling.
      */}
      <div className="mx-auto w-full max-w-7xl flex flex-col gap-4 px-6 py-5 h-full overflow-hidden">

        {/* ── Page Header ── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-headings text-3xl font-bold tracking-tight text-headings">AI Insights Inbox</h1>
              {unreadCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#10B981] px-1.5 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[#64748B]">
              AI-generated tax insights, compliance alerts, and advisory notifications — timestamped and organised.
            </p>
          </div>
          {/* ── Stats Strip ── */}
          {!showArchived && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 shrink-0">
              {[
                { label: 'Unread', value: insights.filter(i => !i.read && !i.archived).length, color: 'text-[#0F172A]' },
                { label: 'High Priority', value: insights.filter(i => i.priority === 'high' && !i.archived).length, color: 'text-red-500' },
                { label: 'Actionable', value: insights.filter(i => i.actionable && !i.archived).length, color: 'text-[#0D9488]' },
                { label: 'Total Insights', value: insights.filter(i => !i.archived).length, color: 'text-[#64748B]' },
              ].map(s => (
                <div key={s.label} className="rounded-xl border border-slate-100 bg-white px-4 py-3.5 shadow-sm">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-[#64748B]">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Search & Sort Bar ── */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch shrink-0">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]"><SearchIcon /></span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search insights, tags, topics…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-[#0F172A] placeholder-[#94A3B8] shadow-sm outline-none transition-all focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/10"
            />
          </div>
          <div className="flex h-full gap-2">
            <button
              onClick={() => setShowArchived(v => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold shadow-sm transition-colors h-full ${showArchived ? 'border-[#0D9488] bg-[#f0fdf9] text-[#0D9488]' : 'border-slate-200 bg-white text-[#64748B] hover:bg-slate-50'}`}
            >
              <ArchiveIcon /> {showArchived ? 'View Inbox' : 'Archived'}
            </button>
            {!showArchived && unreadCount > 0 && (
              <button 
                onClick={markAllRead} 
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-[#64748B] shadow-sm hover:bg-slate-50 hover:text-[#64748B] h-full"
              >
                <CheckIcon /> Mark All Read
              </button>
            )}
          </div>
          <div className="relative h-full">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]"><FilterIcon /></span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="h-full appearance-none rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-xs font-semibold text-[#64748B] shadow-sm outline-none transition-all focus:border-[#0D9488]"
            >
              {SORT_OPTIONS.map(o => <option key={o}>{o}</option>)}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]"><ChevronDownIcon /></span>
          </div>
        </div>

        {/* ── Category Filter Chips ── */}
        <div className="flex flex-wrap gap-2 shrink-0">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all ${activeCategory === cat ? 'border-[#0F172A] bg-[#0F172A] text-white' : 'border-slate-200 bg-white text-[#64748B] hover:border-[#0D9488] hover:text-[#0D9488]'}`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/*
          ── CHANGED: wrapped insight list + footer note in a scrollable container.
          flex-1 makes it consume all remaining vertical space after the fixed elements above.
          min-h-0 is the critical flexbox fix — without it, a flex child won't shrink below
          its content height, so overflow-y-auto would never actually activate.
        */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── Insight List ── */}
          <div className="space-y-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50">
                  <InboxIcon className="h-5 w-5 text-slate-300" />
                </div>
                <p className="text-sm font-semibold text-[#0F172A]">No insights found</p>
                <p className="mt-1 text-xs text-[#64748B]">{showArchived ? 'Nothing archived yet.' : 'All caught up! Try adjusting your filters.'}</p>
              </div>
            ) : (
              filtered.map(insight => {
                const pr = PRIORITY_COLOR[insight.priority];
                const cat = CATEGORY_COLOR[insight.category] || 'bg-slate-50 text-slate-600 border-slate-200';
                return (
                  <div
                    key={insight.id}
                    onClick={() => { setSelectedInsight(insight); if (!insight.read) markRead(insight.id); }}
                    className={`group flex cursor-pointer items-start gap-4 rounded-2xl border bg-white px-5 py-4 shadow-sm transition-all hover:border-[#0D9488]/30 hover:shadow-md ${!insight.read ? 'border-l-4 border-l-[#10B981]' : 'border-slate-100'}`}
                  >
                    {/* Priority dot */}
                    <div className="mt-1.5 shrink-0">
                      <span className={`flex h-2.5 w-2.5 rounded-full ${pr.dot}`} />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${cat}`}>{insight.category}</span>
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono text-[#64748B]">{insight.tag}</span>
                        {insight.actionable && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#0D9488]/20 bg-[#f0fdf9] px-2 py-0.5 text-[10px] font-semibold text-[#0D9488]">
                            <SparkleIcon className="h-2.5 w-2.5" /> Action Required
                          </span>
                        )}
                      </div>
                      <p className={`text-sm font-semibold leading-snug ${insight.read ? 'text-[#334155]' : 'text-[#0F172A]'}`}>{insight.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#64748B]">{insight.summary}</p>
                    </div>

                    {/* Meta */}
                    <div className="shrink-0 text-right space-y-2">
                      <p className="text-[10px] text-[#94A3B8] whitespace-nowrap">{formatDate(insight.timestamp)}</p>
                      <p className="text-[10px] font-medium text-[#64748B]">{insight.source}</p>
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        <button onClick={() => archiveInsight(insight.id)} title="Archive" className="rounded-lg p-1.5 text-[#64748B] hover:bg-slate-100">
                          <ArchiveIcon />
                        </button>
                        <button onClick={() => deleteInsight(insight.id)} title="Delete" className="rounded-lg p-1.5 text-red-400 hover:bg-red-50">
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>{/* end scrollable region */}
        {/* ── Footer note (scrolls with the list) ── */}
        <p className="text-center text-[10px] text-[#94A3B8]">
          AI-generated insights are for advisory purposes only. Always verify with a licensed tax agent or LHDN resources before taking action.
        </p>
      </div>
    </main>
  );
}

export default InsightsInbox;