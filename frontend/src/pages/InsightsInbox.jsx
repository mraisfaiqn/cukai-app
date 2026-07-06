import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllEntities } from '../services/api';

// ═══════════════════════════════════════════════════════════════════════════════
// AI INSIGHTS INBOX — frontend-first demo of the insight engine workflow.
//
// Every mock insight below is shaped EXACTLY like a row from the future
// `insights` table, so swapping to `await API.getInsights(userId, entityId)`
// is a data-source change, not a rewrite:
//
//   insightType   deadline | review_pending | relief_headroom | doc_gap
//                 | provision | formb_missing | digest
//   severity      deadline > action_required > suggested > info
//                 (maps 1:1 onto the design system's critical/warning/success tiers)
//   signals       the raw computed facts the card was built from — rendered
//                 under "Why am I seeing this?" so every card is auditable
//   generatedBy   'rule_template' (deterministic) | 'llm' (AI-phrased → AI chip)
//   action        deep-link descriptor — every card ends in a next step
//   state         new | read | dismissed | actioned  (+ dismissReason)
//   dedupeKey     what the backend will upsert on — shown in the meta row
// ═══════════════════════════════════════════════════════════════════════════════

// ── Icons ─────────────────────────────────────────────────────────────────────

const SparkleIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

const ClockIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);

const CheckIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ChevronDownIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const XIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ArrowRightIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);

const InboxIcon = ({ className = 'h-5 w-5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

const RotateIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

const EyeIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

// ── Date helpers ──────────────────────────────────────────────────────────────
// Mock timestamps/deadlines are seeded RELATIVE to "now" so the demo always
// looks alive (countdowns tick down, "2 hours ago" stays fresh) regardless of
// when it's opened.

const DAY_MS = 86400000;
const daysFromNow = (n) => new Date(Date.now() + n * DAY_MS).toISOString();
const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();

function daysUntil(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso) - Date.now()) / DAY_MS);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(iso);
}

const fmtRM = (v) => 'RM ' + Number(v).toLocaleString('en-MY', { maximumFractionDigits: 0 });

// ── Severity → design-system traffic-light tiers ──────────────────────────────
const SEVERITY_META = {
  deadline:        { label: 'Deadline',      rank: 0, text: 'text-critical', bg: 'bg-critical-bg', dot: 'bg-critical', bar: 'border-l-critical' },
  action_required: { label: 'Action needed', rank: 1, text: 'text-warning',  bg: 'bg-warning-bg',  dot: 'bg-warning',  bar: 'border-l-warning' },
  suggested:       { label: 'Suggested',     rank: 2, text: 'text-success',  bg: 'bg-success-bg',  dot: 'bg-success',  bar: 'border-l-success' },
  info:            { label: 'Info',          rank: 3, text: 'text-muted',    bg: 'bg-background',  dot: 'bg-muted',    bar: 'border-l-border' },
};

// Filter groups shown as chips — each insight declares which group it belongs to
const GROUPS = ['All', 'Deadlines', 'Needs Answer', 'Savings', 'Advisory'];
const GROUP_OF = {
  deadline: 'Deadlines',
  review_pending: 'Needs Answer',
  relief_headroom: 'Savings',
  doc_gap: 'Savings',
  provision: 'Advisory',
  formb_missing: 'Advisory',
  digest: 'Advisory',
};

// ── Mock insight feed ─────────────────────────────────────────────────────────
// One coherent demo scenario ("Meridian Print Studio", YA 2026 in progress):
// projected tax RM8,400 · CP500 RM1,500 × 3 paid (RM4,500) · income tracking
// +12% vs last year · one stuck entertainment review worth RM240.
//
// TODO(backend): replace buildDemoInsights() with
// `await API.getInsights(userId, entityId)` in the same useEffect that
// re-runs on activeEntity?.id below — the card shape is already API-shaped.

function buildDemoInsights() {
  return [
    {
      id: 101,
      insightType: 'digest',
      severity: 'info',
      generatedBy: 'llm',
      state: 'new',
      dedupeKey: 'digest:2026-07',
      createdAt: hoursAgo(2),
      title: 'Your July tax brief',
      body: 'Income is tracking 12% ahead of last year — on pace for a bigger tax bill, so the RM3,000 of unclaimed PRS relief matters more than usual. Your single biggest unlock right now: one unanswered review question is holding back RM240 in deductions, and your CP500 installment lands in 11 days.',
      rmImpact: null,
      deadlineDate: null,
      citation: null,
      signals: [
        { label: 'Income YTD', value: 'RM 142,300 (+12% vs YA2025 same period)' },
        { label: 'Pending review questions', value: '1 — worth ~RM 240' },
        { label: 'Unclaimed relief headroom', value: 'RM 3,000 (PRS)' },
        { label: 'Next deadline', value: 'CP500 installment #4' },
      ],
      sourceDocumentIds: [],
      action: { label: 'Ask CukaiBot about this', to: '/cukaibot' },
    },
    {
      id: 102,
      insightType: 'deadline',
      severity: 'deadline',
      generatedBy: 'rule_template',
      state: 'new',
      dedupeKey: 'cp500_due:2026-07',
      createdAt: hoursAgo(2),
      title: 'CP500 installment #4 — RM 1,500 due soon',
      body: 'Your fourth bimonthly tax installment of RM 1,500 is coming up. You have paid 3 of 6 installments (RM 4,500) for YA 2026 so far. Missing an installment attracts a 10% late-payment penalty on the amount due.',
      rmImpact: 1500,
      deadlineDate: daysFromNow(11),
      citation: 'ITA 1967 s.107B',
      signals: [
        { label: 'Installments paid', value: 'Jan, Mar, May — RM 1,500 each' },
        { label: 'Total paid YA2026', value: 'RM 4,500 of RM 9,000' },
        { label: 'Next installment', value: `#4 — due ${fmtDate(daysFromNow(11))}` },
        { label: 'Detected from', value: '3 CP500 receipts in your vault' },
      ],
      sourceDocumentIds: [31, 35, 39],
      action: { label: 'View installment history', to: '/account' },
    },
    {
      id: 103,
      insightType: 'review_pending',
      severity: 'action_required',
      generatedBy: 'rule_template',
      state: 'new',
      dedupeKey: 'review_pending:doc-42',
      createdAt: hoursAgo(26),
      title: 'One answer is blocking RM 240 in deductions',
      body: 'The AI could not finish classifying your RM 480 receipt from Rustic Table Bistro. It needs to know: was this meal with business clients, or exclusively for your own staff? Client entertainment is 50% deductible; staff-only meals are 100% deductible.',
      rmImpact: 240,
      deadlineDate: null,
      citation: 'ITA 1967 s.39(1)(l) · LHDN PR No. 3/2020',
      signals: [
        { label: 'Document', value: 'Rustic Table Bistro — RM 480.00' },
        { label: 'AI confidence', value: '58% — flagged for review' },
        { label: 'If clients attended', value: '50% deductible → RM 240' },
        { label: 'If staff only', value: '100% deductible → RM 480' },
      ],
      sourceDocumentIds: [42],
      action: { label: 'Answer now', to: '/account' },
    },
    {
      id: 104,
      insightType: 'relief_headroom',
      severity: 'suggested',
      generatedBy: 'rule_template',
      state: 'new',
      dedupeKey: 'relief_headroom:prs:2026',
      createdAt: hoursAgo(26),
      title: 'RM 3,000 of PRS relief still unclaimed',
      body: 'You have not claimed any Private Retirement Scheme relief this year. Contributing before 31 December could save you up to RM 630 in tax at your current 21% marginal rate.',
      rmImpact: 630,
      deadlineDate: '2026-12-31T00:00:00',
      citation: 'Schedule 9, ITA 1967',
      signals: [
        { label: 'Claimed so far', value: 'RM 0 of RM 3,000 cap' },
        { label: 'Your marginal tax rate', value: '21%' },
        { label: 'Potential tax saving', value: 'RM 3,000 × 21% = RM 630' },
        { label: 'Window closes', value: '31 Dec 2026' },
      ],
      sourceDocumentIds: [],
      action: { label: 'How to claim this', to: '/cukaibot' },
    },
    {
      id: 105,
      insightType: 'doc_gap',
      severity: 'action_required',
      generatedBy: 'rule_template',
      state: 'read',
      dedupeKey: 'doc_gap:tnb:2026-05',
      createdAt: hoursAgo(50),
      title: 'Utility bills stopped arriving in May',
      body: 'TNB bills for your shop lot were uploaded every month from January to April (about RM 380/month), but May and June are missing. That is roughly RM 760 in business deductions currently unclaimed.',
      rmImpact: 760,
      deadlineDate: null,
      citation: 'ITA 1967 s.33(1)',
      signals: [
        { label: 'Pattern detected', value: 'TNB · monthly · Jan–Apr 2026' },
        { label: 'Average bill', value: 'RM 380 / month' },
        { label: 'Missing months', value: 'May, June' },
        { label: 'Estimated unclaimed', value: '2 × RM 380 ≈ RM 760' },
      ],
      sourceDocumentIds: [12, 18, 24, 29],
      action: { label: 'Upload the missing bills', to: '/account' },
    },
    {
      id: 106,
      insightType: 'provision',
      severity: 'info',
      generatedBy: 'rule_template',
      state: 'read',
      dedupeKey: 'provision:2026',
      createdAt: hoursAgo(50),
      title: 'Set aside ~RM 650/month for your YA 2026 tax bill',
      body: 'Based on your income so far, your projected tax for YA 2026 is about RM 8,400. After the RM 4,500 in CP500 installments already paid, setting aside RM 650 a month covers the remaining balance comfortably by filing time.',
      rmImpact: null,
      deadlineDate: null,
      citation: 'Run-rate estimate — not a final tax computation',
      signals: [
        { label: 'Projected tax (run-rate)', value: 'RM 8,400' },
        { label: 'CP500 already paid', value: 'RM 4,500' },
        { label: 'Remaining to cover', value: 'RM 3,900' },
        { label: 'Suggested monthly set-aside', value: 'RM 3,900 ÷ 6 months ≈ RM 650' },
      ],
      sourceDocumentIds: [],
      action: { label: 'See full breakdown', to: '/overview' },
    },
    {
      id: 107,
      insightType: 'formb_missing',
      severity: 'suggested',
      generatedBy: 'rule_template',
      state: 'read',
      dedupeKey: 'formb_missing:2025',
      createdAt: hoursAgo(96),
      title: 'Upload last year’s Form B to unlock smarter insights',
      body: 'We do not have your filed YA 2025 Form B. Uploading it gives the AI your official prior-year baseline — enabling carry-forward tracking, year-on-year comparisons, and more accurate relief suggestions.',
      rmImpact: null,
      deadlineDate: null,
      citation: null,
      signals: [
        { label: 'Prior-year Form B on file', value: 'None found for YA 2025' },
        { label: 'Unlocks', value: 'Carry-forward losses · YoY gaps · relief history' },
      ],
      sourceDocumentIds: [],
      action: { label: 'Upload Form B', to: '/account' },
    },
    // ── Lifecycle demo: already-resolved & dismissed cards ────────────────────
    {
      id: 108,
      insightType: 'review_pending',
      severity: 'action_required',
      generatedBy: 'rule_template',
      state: 'actioned',
      resolvedNote: 'You reclassified the document — deduction confirmed automatically.',
      dedupeKey: 'review_pending:doc-38',
      createdAt: hoursAgo(120),
      title: 'Mixed-use vehicle claim needed a logbook percentage',
      body: 'You confirmed 70% business use for your vehicle expenses. RM 1,890 of RM 2,700 is now claimed as deductible.',
      rmImpact: 1890,
      deadlineDate: null,
      citation: 'ITA 1967 s.33(1) · LHDN PR No. 1/2014',
      signals: [
        { label: 'Your answer', value: '70% business use (logbook kept)' },
        { label: 'Outcome', value: 'RM 2,700 × 70% = RM 1,890 deductible' },
      ],
      sourceDocumentIds: [38],
      action: null,
    },
    {
      id: 109,
      insightType: 'relief_headroom',
      severity: 'suggested',
      generatedBy: 'rule_template',
      state: 'dismissed',
      dismissReason: 'Not relevant this year',
      dedupeKey: 'relief_headroom:tourism:2026',
      createdAt: hoursAgo(140),
      title: 'RM 1,000 domestic tourism relief unclaimed',
      body: 'No qualifying local hotel or tour-package receipts found this year. Stays at registered Malaysian accommodation qualify for up to RM 1,000 in relief.',
      rmImpact: 210,
      deadlineDate: '2026-12-31T00:00:00',
      citation: 'Schedule 9, ITA 1967',
      signals: [
        { label: 'Claimed so far', value: 'RM 0 of RM 1,000 cap' },
      ],
      sourceDocumentIds: [],
      action: { label: 'How to claim this', to: '/cukaibot' },
    },
  ];
}

// Per-entity mock feed — keyed by entity ID so switching entities swaps the
// insight list, the same way a real per-entity endpoint will. Stored as
// factories (not pre-built arrays) so the relative timestamps inside
// buildDemoInsights() stay fresh on every switch rather than freezing at import.
//
// NOTE: the showcase feed is mapped to entity id 1 to match CukaiBot's
// MOCK_MESSAGES_BY_ENTITY convention. Point this at your actual demo entity's
// id if it isn't 1 (or add more keys to give each entity its own feed). Any
// unmapped entity falls through to an empty inbox — the honest state a real
// fetch returns for a brand-new entity with nothing detected yet.
//
// TODO(backend): replace getInitialInsightsForEntity() with
// `await getInsights(userId, entityId)` in the useEffect that re-runs on
// activeEntity?.id below — the card shape is already API-shaped.
const MOCK_INSIGHTS_BY_ENTITY = {
  1: () => buildDemoInsights(),
};

function getInitialInsightsForEntity(entityId) {
  const build = MOCK_INSIGHTS_BY_ENTITY[entityId];
  return build ? build() : [];
}

// Mirrors the future `insight_runs` row — surfaces WHEN the brain last looked
// so the inbox feels like a living system rather than a static list.
const DEMO_LAST_RUN = {
  ranAt: hoursAgo(2),
  trigger: 'document classified',
  documentsAnalysed: 27,
  signalsFound: 9,
};

// ── Small building blocks ─────────────────────────────────────────────────────

/** Pill-shaped AI chip (design system: amber highlight + sparkle) — marks AI-phrased content. */
function AiChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-ai-highlight px-2 py-0.5 text-[10px] font-bold text-warning">
      <SparkleIcon className="h-2.5 w-2.5" /> AI
    </span>
  );
}

function SeverityBadge({ severity }) {
  const m = SEVERITY_META[severity] || SEVERITY_META.info;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${m.bg} ${m.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

/** Countdown chip — turns red as a deadline approaches. */
function DeadlineChip({ deadlineDate }) {
  const days = daysUntil(deadlineDate);
  if (days === null) return null;
  const urgent = days <= 14;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${urgent ? 'bg-critical-bg text-critical' : 'bg-background text-muted'}`}>
      <ClockIcon className="h-2.5 w-2.5" />
      {days <= 0 ? 'Due today' : `${days} day${days === 1 ? '' : 's'} left`}
    </span>
  );
}

/** "Why am I seeing this?" — renders the raw signals so every card is auditable. */
function SignalList({ insight }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
        <EyeIcon /> Why am I seeing this?
      </p>
      <div className="space-y-1.5">
        {insight.signals.map((s, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4 text-xs">
            <span className="text-muted">{s.label}</span>
            <span className="text-right font-medium text-headings">{s.value}</span>
          </div>
        ))}
      </div>
      <p className="mt-2.5 border-t border-border pt-2 text-[9px] text-muted">
        {insight.generatedBy === 'llm' ? 'Numbers computed by the rule engine · wording by AI' : 'Computed by the rule engine — no AI involved'}
        {insight.sourceDocumentIds.length > 0 && ` · from ${insight.sourceDocumentIds.length} document${insight.sourceDocumentIds.length === 1 ? '' : 's'} in your vault`}
      </p>
    </div>
  );
}

/** Dismiss popover — "dismiss with memory" so regeneration won't resurrect the card. */
function DismissMenu({ onDismiss, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 top-7 z-20 w-48 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
        <button
          onClick={() => onDismiss('Not relevant this year')}
          className="block w-full px-3.5 py-2.5 text-left text-xs font-medium text-headings transition-colors hover:bg-background">
          Not relevant this year
          <span className="block text-[9px] font-normal text-muted">Hidden until next YA</span>
        </button>
        <button
          onClick={() => onDismiss('Snoozed for 2 weeks')}
          className="block w-full border-t border-border px-3.5 py-2.5 text-left text-xs font-medium text-headings transition-colors hover:bg-background">
          Remind me later
          <span className="block text-[9px] font-normal text-muted">Snoozes for 2 weeks</span>
        </button>
      </div>
    </>
  );
}

// ── Insight card ──────────────────────────────────────────────────────────────

function InsightCard({ insight, expanded, onToggle, onAction, onDismiss, onMarkDone, onRestore }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const m = SEVERITY_META[insight.severity] || SEVERITY_META.info;
  const isDigest = insight.insightType === 'digest';
  const isActive = insight.state === 'new' || insight.state === 'read';
  const unread = insight.state === 'new';

  return (
    <div
      className={`rounded-2xl border transition-all ${
        isDigest
          ? 'border-warning/25 bg-ai-highlight'
          : `bg-surface ${unread ? `border-l-4 ${m.bar} border-border` : 'border-border'}`
      } ${isActive ? 'cursor-pointer hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)]' : 'opacity-70'}`}
      onClick={isActive ? onToggle : undefined}>

      <div className="px-5 py-4">
        {/* Chip row */}
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          {isDigest ? <AiChip /> : <SeverityBadge severity={insight.severity} />}
          {isDigest && <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">Monthly digest</span>}
          {insight.deadlineDate && isActive && <DeadlineChip deadlineDate={insight.deadlineDate} />}
          {insight.rmImpact != null && isActive && (
            <span className="inline-flex rounded-full bg-primary-tint px-2 py-0.5 text-[10px] font-bold text-primary">
              {fmtRM(insight.rmImpact)} impact
            </span>
          )}
          {insight.state === 'actioned' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[10px] font-semibold text-success">
              <CheckIcon className="h-2.5 w-2.5" /> Resolved
            </span>
          )}
          {insight.state === 'dismissed' && (
            <span className="inline-flex rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-muted">
              Dismissed — {insight.dismissReason}
            </span>
          )}

          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted">
            {timeAgo(insight.createdAt)}
            {isActive && (
              <span className="relative" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setMenuOpen(v => !v)}
                  title="Dismiss"
                  className="rounded-lg p-1 text-muted transition-colors hover:bg-background hover:text-headings">
                  <XIcon className="h-3.5 w-3.5" />
                </button>
                {menuOpen && (
                  <DismissMenu
                    onClose={() => setMenuOpen(false)}
                    onDismiss={(reason) => { setMenuOpen(false); onDismiss(insight.id, reason); }}
                  />
                )}
              </span>
            )}
          </span>
        </div>

        {/* Title + body */}
        <p className={`text-sm leading-snug ${unread ? 'font-bold' : 'font-semibold'} text-headings`}>{insight.title}</p>
        <p className={`mt-1 text-xs leading-relaxed text-body-text ${expanded ? '' : 'line-clamp-2'}`}>{insight.body}</p>

        {/* Collapsed hint */}
        {!expanded && isActive && (
          <p className="mt-2 flex items-center gap-1 text-[10px] font-medium text-primary">
            <ChevronDownIcon className="h-3 w-3" /> Details &amp; actions
          </p>
        )}

        {/* Expanded detail */}
        {expanded && (
          <div className="mt-3 space-y-3" onClick={e => e.stopPropagation()}>
            <SignalList insight={insight} />

            {insight.resolvedNote && (
              <p className="rounded-xl bg-success-bg px-4 py-2.5 text-xs text-success">{insight.resolvedNote}</p>
            )}

            {insight.citation && (
              <p className="text-[10px] italic text-muted">Source: {insight.citation}</p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {isActive && insight.action && (
                <button
                  onClick={() => onAction(insight)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-hover">
                  {insight.action.label} <ArrowRightIcon />
                </button>
              )}
              {isActive && !isDigest && (
                <button
                  onClick={() => onMarkDone(insight.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-muted transition-colors hover:border-primary hover:text-primary">
                  <CheckIcon className="h-3 w-3" /> Mark as done
                </button>
              )}
              {!isActive && (
                <button
                  onClick={() => onRestore(insight.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-muted transition-colors hover:border-primary hover:text-primary">
                  <RotateIcon /> Restore to inbox
                </button>
              )}
              <span className="ml-auto font-mono text-[9px] text-muted/60">{insight.dedupeKey}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function InsightsInbox() {
  const navigate = useNavigate();
  const [activeEntity, setActiveEntity] = useState(null);

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
      } catch {
        // Entity resolution is non-fatal — the demo feed renders without it.
      }
    };
    loadEntity();
    window.addEventListener('entitySwitch', loadEntity);
    return () => window.removeEventListener('entitySwitch', loadEntity);
  }, []);

  // Start empty and let the entity-resolution effect below populate the feed
  // once activeEntity resolves — avoids a flash of the no-entity result.
  const [insights, setInsights] = useState([]);
  const [tab, setTab] = useState('active');          // active | resolved | dismissed
  const [activeGroup, setActiveGroup] = useState('All');
  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast] = useState('');

  // Reload the feed whenever the entity changes, so switching entities swaps
  // the insight list (and resets read/dismissed state) instead of carrying the
  // previous entity's cards over. Mock today; swap for the real per-entity
  // fetch once the backend exists — the effect shape stays the same.
  useEffect(() => {
    setInsights(getInitialInsightsForEntity(activeEntity?.id));
    setExpandedId(null);

    // ── Backend version (uncomment once GET /api/insights exists) ──
    // Add getInsights to the import at the top of this file. The `cancelled`
    // guard drops out-of-order responses: when you switch entities quickly, a
    // slow fetch for the OLD entity can resolve after the new one and overwrite
    // the correct list — this prevents that.
    //
    // let cancelled = false;
    // const userId = localStorage.getItem('userId');
    // (async () => {
    //   const rows = await getInsights(userId, activeEntity?.id).catch(() => []);
    //   if (!cancelled) { setInsights(rows); setExpandedId(null); }
    // })();
    // return () => { cancelled = true; };
  }, [activeEntity?.id]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2600); };

  // ── Lifecycle transitions (these become PATCH /api/insights/{id}/state) ────
  const dismissInsight = (id, reason) => {
    setInsights(p => p.map(i => i.id === id ? { ...i, state: 'dismissed', dismissReason: reason } : i));
    if (expandedId === id) setExpandedId(null);
    showToast(reason === 'Snoozed for 2 weeks' ? 'Snoozed — it will come back in 2 weeks' : 'Dismissed for this year');
  };
  const markDone = (id) => {
    setInsights(p => p.map(i => i.id === id ? { ...i, state: 'actioned', resolvedNote: 'Marked as done by you.' } : i));
    if (expandedId === id) setExpandedId(null);
    showToast('Moved to Resolved');
  };
  const restoreInsight = (id) => {
    setInsights(p => p.map(i => i.id === id ? { ...i, state: 'read', dismissReason: undefined, resolvedNote: undefined } : i));
    showToast('Restored to inbox');
    setTab('active');
  };
  const toggleExpand = (insight) => {
    const opening = expandedId !== insight.id;
    setExpandedId(opening ? insight.id : null);
    if (opening && insight.state === 'new') {
      setInsights(p => p.map(i => i.id === insight.id ? { ...i, state: 'read' } : i));
    }
  };
  // Deep-link: every card's primary action lands the user where the fix happens.
  const runAction = (insight) => { if (insight.action) navigate(insight.action.to); };

  // ── Derived views ───────────────────────────────────────────────────────────
  const active = insights.filter(i => i.state === 'new' || i.state === 'read');
  const resolved = insights.filter(i => i.state === 'actioned');
  const dismissed = insights.filter(i => i.state === 'dismissed');

  const needsAction = active.filter(i => i.severity === 'deadline' || i.severity === 'action_required');
  const potentialImpact = active.reduce((sum, i) => sum + (i.rmImpact || 0), 0);
  const nextDeadlineDays = active
    .map(i => daysUntil(i.deadlineDate))
    .filter(d => d !== null && d >= 0)
    .sort((a, b) => a - b)[0];

  const tabList = tab === 'active' ? active : tab === 'resolved' ? resolved : dismissed;
  const visible = tabList
    .filter(i => activeGroup === 'All' || GROUP_OF[i.insightType] === activeGroup)
    .sort((a, b) => {
      // Digest pinned first, then severity, then closest deadline, then RM impact
      if (a.insightType === 'digest') return -1;
      if (b.insightType === 'digest') return 1;
      const sev = SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank;
      if (sev !== 0) return sev;
      const da = daysUntil(a.deadlineDate) ?? Infinity;
      const db = daysUntil(b.deadlineDate) ?? Infinity;
      if (da !== db) return da - db;
      return (b.rmImpact || 0) - (a.rmImpact || 0);
    });

  return (
    <main className="h-[calc(100vh-4.1rem)] bg-background font-body flex flex-col overflow-hidden">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-headings px-4 py-3 text-sm font-medium text-white shadow-xl">
          <CheckIcon /> {toast}
        </div>
      )}

      <div className="mx-auto w-full max-w-4xl flex flex-col gap-4 px-6 py-5 h-full overflow-hidden">

        {/* ── Page header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4 shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-headings text-3xl font-bold tracking-tight text-headings">AI Insights</h1>
              {needsAction.length > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-critical px-1.5 text-[10px] font-bold text-white">
                  {needsAction.length}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">
              {activeEntity ? `Watching ${activeEntity.name}'s tax position` : 'Your tax position, watched continuously'} — insights appear when something needs you.
            </p>
            {/* Engine heartbeat — mirrors the future insight_runs record */}
            <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Last analysed {timeAgo(DEMO_LAST_RUN.ranAt)} · trigger: {DEMO_LAST_RUN.trigger} · {DEMO_LAST_RUN.documentsAnalysed} documents → {DEMO_LAST_RUN.signalsFound} signals
            </p>
          </div>

          {/* Stat strip */}
          <div className="flex gap-3">
            {[
              { label: 'Needs action', value: needsAction.length, tone: needsAction.length > 0 ? 'text-critical' : 'text-headings' },
              { label: 'Potential impact', value: potentialImpact > 0 ? fmtRM(potentialImpact) : '—', tone: 'text-primary' },
              { label: 'Next deadline', value: nextDeadlineDays != null ? `${nextDeadlineDays}d` : '—', tone: nextDeadlineDays != null && nextDeadlineDays <= 14 ? 'text-critical' : 'text-headings' },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-border bg-surface px-4 py-3 min-w-[104px]">
                <p className={`text-xl font-bold ${s.tone}`}>{s.value}</p>
                <p className="text-[10px] text-muted whitespace-nowrap">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Tabs + group filter chips ── */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {[
            { id: 'active', label: `Inbox${active.length ? ` (${active.length})` : ''}` },
            { id: 'resolved', label: `Resolved${resolved.length ? ` (${resolved.length})` : ''}` },
            { id: 'dismissed', label: `Dismissed${dismissed.length ? ` (${dismissed.length})` : ''}` },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setExpandedId(null); }}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${tab === t.id ? 'bg-headings text-white' : 'bg-surface border border-border text-muted hover:text-headings'}`}>
              {t.label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          {GROUPS.map(g => (
            <button
              key={g}
              onClick={() => setActiveGroup(g)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${activeGroup === g ? 'border-primary bg-primary-tint text-primary' : 'border-border bg-surface text-muted hover:border-primary hover:text-primary'}`}>
              {g}
            </button>
          ))}
        </div>

        {/* ── Insight feed ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="space-y-2.5 pb-2">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface py-16 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-success-bg">
                  {tab === 'active' ? <CheckIcon className="h-5 w-5 text-success" /> : <InboxIcon className="h-5 w-5 text-muted" />}
                </div>
                <p className="text-sm font-semibold text-headings">
                  {tab === 'active' ? 'All caught up' : tab === 'resolved' ? 'Nothing resolved yet' : 'Nothing dismissed'}
                </p>
                <p className="mt-1 max-w-xs text-xs text-muted">
                  {tab === 'active'
                    ? (nextDeadlineDays != null
                        ? `Nothing needs you right now. Next check: a deadline in ${nextDeadlineDays} days.`
                        : 'Upload documents and the tax brain will start watching for savings, gaps, and deadlines.')
                    : tab === 'resolved'
                      ? 'Insights you act on move here automatically.'
                      : 'Dismissed insights stay here and won’t be re-raised.'}
                </p>
              </div>
            ) : (
              visible.map(insight => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  expanded={expandedId === insight.id}
                  onToggle={() => toggleExpand(insight)}
                  onAction={runAction}
                  onDismiss={dismissInsight}
                  onMarkDone={markDone}
                  onRestore={restoreInsight}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Footer disclaimer ── */}
        <p className="shrink-0 text-center text-[10px] text-muted">
          AI-generated insights are for advisory purposes only. Always verify with a licensed tax agent or LHDN resources before taking action.
        </p>
      </div>
    </main>
  );
}

export default InsightsInbox;