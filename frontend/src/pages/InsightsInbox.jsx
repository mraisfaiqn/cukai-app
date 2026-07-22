import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAllEntities, getInsights, updateInsightState, runInsightEngine } from '../services/api';

// ═══════════════════════════════════════════════════════════════════════════════
// AI INSIGHTS INBOX — live view over the backend insight engine.
//
// Data source: GET /api/insights?user_id&entity_id which returns a WRAPPED
// payload { insights: [...], lastRun: {...}|null }. Each insight row carries:
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
//   dedupeKey     what the backend upserts on — shown in the meta row
//   assessmentYear the tax Year of Assessment the insight belongs to
//
// Lifecycle transitions PATCH /api/insights/{id}/state; the UI updates
// optimistically and the server write is fire-and-forget.
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

const LockIcon = ({ className = 'h-2.5 w-2.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

// Tooltip text for actions blocked by the Tax Amendment Lock (isLocked cards)
const LOCKED_TOOLTIP = 'This Assessment Year has been filed and locked.';

// ── Date helpers ──────────────────────────────────────────────────────────────

const DAY_MS = 86400000;

function daysUntil(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso) - Date.now()) / DAY_MS);
}

// Statutory Form B filing deadline: 30 June following the year of assessment.
// Mirrors Overview.jsx's daysToFormBDeadline() exactly — kept here too as a
// direct backstop so "Next deadline" always has a real compliance deadline to
// show, even when the engine hasn't surfaced a `deadline` card for Form B yet
// (insights/engine.py only turns it into an active card once it's within its
// 180-day countdown window). Without this fallback, "Next deadline" reads
// "Nothing due" for most of the year while Overview's header still (rightly)
// counts down to the same date — this keeps both surfaces in agreement.
function daysToFormBDeadline(today = new Date()) {
  const year = today.getFullYear();
  let deadline = new Date(year, 5, 30); // June is month index 5
  if (today > deadline) deadline = new Date(year + 1, 5, 30);
  return Math.max(0, Math.ceil((deadline - today) / DAY_MS));
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

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function runHeartbeat(run) {
  if (!run) return '';
  if (run.status === 'queued') {
    return `Analysis queued${run.assessmentYear ? ` for YA${run.assessmentYear}` : ''}`;
  }
  if (run.status === 'running') {
    return `Analysing${run.assessmentYear ? ` YA${run.assessmentYear}` : ''}…`;
  }
  const when = run.completedAt || run.ranAt;
  if (run.status === 'failed') {
    return `Analysis failed${when ? ` ${timeAgo(when)}` : ''}`;
  }
  if (run.status === 'skipped') {
    return `Analysis skipped${run.assessmentYear ? ` for YA${run.assessmentYear}` : ''}`;
  }
  const documents = run.documentsInScope ?? run.documentsAnalysed ?? 0;
  // insightsMatched is useful engine telemetry, but it includes cards that
  // remain resolved or dismissed. Showing it beside the Inbox count therefore
  // implies that all matched cards should be visible, which is not true.
  return `Last analysed ${timeAgo(when)} · Based on ${plural(documents, 'document')}`;
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
  const signals = insight.signals || [];
  const sourceCount = (insight.sourceDocumentIds || []).length;
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
        <EyeIcon /> Why am I seeing this?
      </p>
      <div className="space-y-1.5">
        {signals.map((s, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4 text-xs">
            <span className="text-muted">{s.label}</span>
            <span className="text-right font-medium text-headings">{s.value}</span>
          </div>
        ))}
      </div>
      <p className="mt-2.5 border-t border-border pt-2 text-[10px] text-muted">
        {insight.generatedBy === 'llm' ? 'Numbers computed by the rule engine · wording by AI' : 'Computed by the rule engine — no AI involved'}
        {sourceCount > 0 && ` · from ${sourceCount} document${sourceCount === 1 ? '' : 's'} in your vault`}
        {insight.assessmentYear && ` · YA ${insight.assessmentYear}`}
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
          <span className="block text-[10px] font-normal text-muted">Hidden until next YA</span>
        </button>
        <button
          onClick={() => onDismiss('Snoozed for 2 weeks')}
          className="block w-full border-t border-border px-3.5 py-2.5 text-left text-xs font-medium text-headings transition-colors hover:bg-background">
          Remind me later
          <span className="block text-[10px] font-normal text-muted">Snoozes for 2 weeks</span>
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
  // Tax Amendment Lock: this card's assessment year has a filed Form B on
  // record — lifecycle actions are disabled here AND rejected server-side.
  const locked = !!insight.isLocked;

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
          {locked && (
            <span
              title={LOCKED_TOOLTIP}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold text-muted">
              <LockIcon /> YA {insight.assessmentYear} filed
            </span>
          )}
          {insight.isStale && isActive && (
            <span
              title="Tax rules changed since this was computed — figures are being re-checked."
              className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning">
              <RotateIcon className="h-2.5 w-2.5" /> Re-checking figures
            </span>
          )}
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
            {!isActive && !locked && (
                <button onClick={(e) => { e.stopPropagation(); onRestore(insight.id); }} 
                className="ml-1 text-[10px] font-bold underline hover:text-headings"> (Undo)
                </button>
              )}
            {timeAgo(insight.createdAt)}
            {isActive && (
              <span
                className="relative"
                onClick={e => e.stopPropagation()}
                title={locked ? LOCKED_TOOLTIP : undefined}>
                <button
                  onClick={() => !locked && setMenuOpen(v => !v)}
                  disabled={locked}
                  title={locked ? undefined : 'Dismiss'}
                  className={`rounded-lg p-1 text-muted transition-colors ${locked ? 'pointer-events-none opacity-40' : 'hover:bg-background hover:text-headings'}`}>
                  <XIcon className="h-3.5 w-3.5" />
                </button>
                {menuOpen && !locked && (
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
                <span title={locked ? LOCKED_TOOLTIP : undefined}>
                  <button
                    onClick={() => !locked && onMarkDone(insight.id)}
                    disabled={locked}
                    className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-muted transition-colors ${locked ? 'pointer-events-none opacity-40' : 'hover:border-primary hover:text-primary'}`}>
                    <CheckIcon className="h-3 w-3" /> Mark as done
                  </button>
                </span>
              )}
              {!isActive && (
                <span title={locked ? LOCKED_TOOLTIP : undefined}>
                  <button
                    onClick={() => !locked && onRestore(insight.id)}
                    disabled={locked}
                    className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-4 py-2 text-xs font-semibold text-muted transition-colors ${locked ? 'pointer-events-none opacity-40' : 'hover:border-primary hover:text-primary'}`}>
                    <RotateIcon /> Restore to inbox
                  </button>
                </span>
              )}
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
        // Entity resolution is non-fatal — the feed still loads user-scoped.
      }
    };
    loadEntity();
    window.addEventListener('entitySwitch', loadEntity);
    return () => window.removeEventListener('entitySwitch', loadEntity);
  }, []);

  const [insights, setInsights] = useState([]);
  const [lastRun, setLastRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);         // fetch failed (≠ empty feed)
  const [refreshing, setRefreshing] = useState(false); // freshness poll in flight
  const [tab, setTab] = useState('active');  
  const [searchParams] = useSearchParams();
  const [activeGroup, setActiveGroup] = useState('All');
  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast] = useState('');
  const lastRunRef = useRef(null);   // latest lastRun seen — freshness-poll baseline
  const pollTokenRef = useRef(0);    // lets a newer poll supersede an older loop
  const mountPollDoneRef = useRef(false);


  // Deep-link support: /insightsinbox?filter=Savings opens on that chip.
  // Runs on mount AND whenever the URL changes, so links from other pages
  // switch the tab even when this page is already open.
  useEffect(() => {
    const wanted = (searchParams.get('filter') || '').trim().toLowerCase();
    if (!wanted) return;
    const match = GROUPS.find((g) => g.toLowerCase() === wanted);
    if (match) setActiveGroup(match);
  }, [searchParams]);

  // Load the real feed whenever the entity changes. The endpoint returns a
  // WRAPPED payload { insights, lastRun } — never map the response directly.
  const refreshInsights = useCallback(async () => {
    const userId = localStorage.getItem('userId');
    if (!userId) {
      setInsights([]);
      setLastRun(null);
      lastRunRef.current = null;
      setLoading(false);
      return null;
    }
    try {
      const data = await getInsights(userId, activeEntity?.id ?? null);
      setInsights(data.insights || []);
      setLastRun(data.lastRun || null);
      lastRunRef.current = data.lastRun || null;
      setError(false);
      return data;
    } catch {
      // A fetch failure is NOT an empty inbox: keep whatever is already on
      // screen and flag the error — the error panel below only renders when
      // there is nothing older to keep showing.
      setError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeEntity]);

  // After a documentsChanged signal, a durable queued row appears immediately
  // and the engine completes later on a backend thread. Poll until a new/changed
  // run reaches a terminal state; a queue timestamp alone is not fresh output.
  const startFreshnessPoll = useCallback(() => {
    const token = ++pollTokenRef.current;
    const baselineId = lastRunRef.current?.id ?? null;
    const baselineCompletedAt = lastRunRef.current?.completedAt ?? null;
    setRefreshing(true);
    let tries = 0;
    const tick = async () => {
      if (pollTokenRef.current !== token) return; // superseded by a newer poll
      const data = await refreshInsights();
      const run = data?.lastRun ?? null;
      const terminal = run && ['completed', 'failed', 'skipped'].includes(run.status);
      const advanced = run && (
        run.id !== baselineId || (run.completedAt ?? null) !== baselineCompletedAt
      );
      // A queued row is now created immediately. Do not mistake that queue
      // timestamp for finished analysis; wait for a terminal state.
      if ((data && terminal && advanced) || ++tries >= 10) {
        if (pollTokenRef.current === token) setRefreshing(false);
        return;
      }
      setTimeout(tick, 3000);
    };
    tick();
  }, [refreshInsights]);

  // Live cross-page refresh: CukaiAccount broadcasts 'documentsChanged' when
  // a document mutation lands on the backend (upload classified, manual add,
  // delete, reclassify, reset, archive) — the same pattern as 'entitySwitch'.
  useEffect(() => {
    const onDocsChanged = () => startFreshnessPoll();
    window.addEventListener('documentsChanged', onDocsChanged);
    return () => window.removeEventListener('documentsChanged', onDocsChanged);
  }, [startFreshnessPoll]);

  useEffect(() => {
    setLoading(true);
    setExpandedId(null);
    // Cross-page case: the documentsChanged event fired BEFORE this page
    // mounted (upload on the account page → navigate here). If that was
    // recent, the engine run may still be landing — poll instead of trusting
    // a single fetch. Once per mount; entity switches use the plain fetch.
    const changedAt = Number(sessionStorage.getItem('documentsChangedAt') || 0);
    if (!mountPollDoneRef.current && changedAt && Date.now() - changedAt < 90_000) {
      mountPollDoneRef.current = true;
      startFreshnessPoll();
    } else {
      refreshInsights();
    }
  }, [refreshInsights, startFreshnessPoll]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2600); };

  // Manual re-run (202 fire-and-forget per year), then poll for the result.
  // Covers the current year plus any prior years already represented in the
  // feed, so a prior-YA card refreshes too — capped to keep it cheap.
  const manualRefresh = async () => {
    const userId = localStorage.getItem('userId');
    if (!userId || refreshing) return;
    const years = [...new Set([
      new Date().getFullYear(),
      ...insights.map(i => i.assessmentYear).filter(Boolean),
    ])].slice(0, 3);
    try {
      await Promise.all(years.map(y => runInsightEngine(userId, activeEntity?.id ?? null, y)));
    } catch {
      // Queueing failed for some year — the poll below still reconciles
      // whatever DID queue, and the error state covers a dead backend.
    }
    startFreshnessPoll();
  };

  // Fire-and-forget server write behind every optimistic local transition.
  const patchState = (id, payload) => {
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    updateInsightState(id, payload, userId).catch(() => {
      // Non-fatal: the optimistic UI stays; the server reconciles on next load.
    });
  };

  // ── Lifecycle transitions (PATCH /api/insights/{id}/state) ────────────────
  const dismissInsight = (id, reason) => {
    setInsights(p => p.map(i => i.id === id ? { ...i, state: 'dismissed', dismissReason: reason } : i));
    if (expandedId === id) setExpandedId(null);
    patchState(id, { state: 'dismissed', dismissReason: reason });
    showToast(reason === 'Snoozed for 2 weeks' ? 'Snoozed — it will come back in 2 weeks' : 'Dismissed for this year');
  };
  const markDone = (id) => {
    setInsights(p => p.map(i => i.id === id ? { ...i, state: 'actioned', resolvedNote: 'Marked as done by you.' } : i));
    if (expandedId === id) setExpandedId(null);
    patchState(id, { state: 'actioned' });
    showToast('Moved to Resolved');
  };
  const restoreInsight = (id) => {
    setInsights(p => p.map(i => i.id === id ? { ...i, state: 'read', dismissReason: undefined, resolvedNote: undefined } : i));
    patchState(id, { state: 'read' });
    showToast('Restored to inbox');
  };
  const toggleExpand = (insight) => {
    const opening = expandedId !== insight.id;
    setExpandedId(opening ? insight.id : null);
    if (opening && insight.state === 'new') {
      setInsights(p => p.map(i => i.id === insight.id ? { ...i, state: 'read' } : i));
      patchState(insight.id, { state: 'read' });
    }
  };
  // Deep-link: every card's primary action lands the user where the fix happens.
  // A CukaiBot destination additionally carries this insight's id as a URL
  // param so the chat can ground its first reply in it (see CukaiBot.jsx's
  // mount effect + api.js's sendChatMessage) instead of opening a blank chat.
  const runAction = (insight) => {
    if (!insight.action) return;
    if (insight.action.to === '/cukaibot') {
      navigate(`/cukaibot?insightId=${insight.id}`);
    } else {
      navigate(insight.action.to);
    }
  };

  // ── Derived views ───────────────────────────────────────────────────────────
  const active = insights.filter(i => i.state === 'new' || i.state === 'read');
  const resolved = insights.filter(i => i.state === 'actioned');
  const dismissed = insights.filter(i => i.state === 'dismissed');

  const needsAction = active.filter(i => i.severity === 'deadline' || i.severity === 'action_required');

  // "Potential impact" = tax you could still avoid paying by acting — known
  // relief headroom, a detected missing recurring deduction, or an avoidable
  // bracket-jump (the provision rule's rm_impact is the extra tax you'll pay
  // unless you act before 31 Dec — same shape as a savings opportunity, just
  // framed as "avoid" instead of "claim"; its other sub-type, the monthly
  // set-aside card, always carries rm_impact: None, so including the whole
  // type is safe). Deliberately excludes:
  //  - `deadline`: rmImpact there (e.g. a CP500 installment amount) is money
  //    OWED, not saved.
  //  - `review_pending`: its rmImpact is money currently EXCLUDED pending an
  //    answer (e.g. a mixed-use gift invoice awaiting a branding/alcohol
  //    confirmation) — genuinely contingent, since the eventual deductible
  //    portion depends on how the user answers. Folding a not-yet-resolved
  //    figure into "confirmed savings" overstates it; it's already reflected
  //    in "Needs action" and on the card itself.
  const IMPACT_INSIGHT_TYPES = new Set(['relief_headroom', 'doc_gap', 'provision']);
  const potentialImpact = active
    .filter(i => IMPACT_INSIGHT_TYPES.has(i.insightType))
    .reduce((sum, i) => sum + (i.rmImpact || 0), 0);
  // "Next deadline" must be an actual statutory/compliance deadline, not any
  // insight that happens to carry a deadlineDate — relief_headroom cards also
  // set one (the calendar-year relief-claim window, 31 Dec), which used to
  // leak in here whenever no real `deadline` card was active, silently
  // turning "next deadline" into "days left in the year."
  const nextDeadlineInsight = active
    .filter(i => i.insightType === 'deadline')
    .map(i => ({ insight: i, days: daysUntil(i.deadlineDate) }))
    .filter(x => x.days !== null && x.days >= 0)
    .sort((a, b) => a.days - b.days)[0]?.insight || null;

  // Fall back to the statutory Form B date directly when no `deadline` card
  // is currently active (Form B is usually far enough out that the engine
  // hasn't surfaced a card for it yet) — see daysToFormBDeadline() above for
  // why. Both Overview and this tile show "Form B" for now as a result.
  const nextDeadlineDays = nextDeadlineInsight
    ? daysUntil(nextDeadlineInsight.deadlineDate)
    : daysToFormBDeadline();

  // Short, stable subtitle for the deadline tile — the insight's own `title`
  // is a full sentence ("YA 2026 Form B due in 162 days"), too long for a
  // stat card, so map its dedupeKey to a couple of words instead. Falls back
  // to "Form B filing" when there's no active card (the fallback above).
  function shortDeadlineLabel(insight) {
    if (!insight) return 'Form B filing';
    const key = insight.dedupeKey || '';
    if (key.startsWith('cp500:')) return 'CP500 installment';
    if (key === 'form_b_filing') return 'Form B filing';
    if (key.startsWith('bank_statement_')) return 'Bank statement';
    return insight.title;
  }

  const tabList = tab === 'active' ? active : tab === 'resolved' ? resolved : dismissed;
  const visible = tabList
    .filter(i => activeGroup === 'All' || GROUP_OF[i.insightType] === activeGroup)
    .sort((a, b) => {
      // Digest pinned first, then severity, then closest deadline, then RM impact
      if (a.insightType === 'digest') return -1;
      if (b.insightType === 'digest') return 1;
      const sev = (SEVERITY_META[a.severity] || SEVERITY_META.info).rank - (SEVERITY_META[b.severity] || SEVERITY_META.info).rank;
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

      <div className="mx-auto w-full max-w-7xl flex flex-col gap-4 px-6 py-4 h-full overflow-hidden">

        {/* ── Page header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4 shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">AI Insights</h1>
              {needsAction.length > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
                  {needsAction.length}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              {activeEntity ? `Watching ${activeEntity.name}'s tax position` : 'Your tax position, watched continuously'} — insights appear when something needs you.
            </p>
            {/* Engine heartbeat — the latest insight_runs record — + manual re-run */}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {lastRun ? (
                <p className="flex items-center gap-1.5 text-[10px] text-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${lastRun.status === 'failed' ? 'bg-critical' : lastRun.status === 'queued' || lastRun.status === 'running' ? 'bg-warning animate-pulse' : lastRun.status === 'skipped' ? 'bg-muted' : 'bg-success'}`} />
                  {runHeartbeat(lastRun)}
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-[10px] text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                  No analysis run yet — upload a document and the tax brain wakes up.
                </p>
              )}
              <button
                onClick={manualRefresh}
                disabled={refreshing}
                className={`inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold transition-colors ${refreshing ? 'text-muted cursor-wait' : 'text-muted hover:border-primary hover:text-primary'}`}>
                <RotateIcon className={`h-2.5 w-2.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Analysing…' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Stat strip */}
          <div className="flex gap-3">
            {[
              { label: 'Needs action', value: needsAction.length, tone: needsAction.length > 0 ? 'text-critical' : 'text-headings' },
              { label: 'Potential impact', value: potentialImpact > 0 ? fmtRM(potentialImpact) : '—', tone: 'text-primary' },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-border bg-surface px-4 py-3 min-w-[104px]">
                <p className="font-headings text-sm text-muted whitespace-nowrap">{s.label}</p>
                <p className={`font-headings text-xl font-bold tracking-tight ${s.tone}`}>{s.value}</p>
              </div>
            ))}

            {/* Next deadline — a real compliance deadline (CP500 / Form B /
                missing records), with the "what" alongside the "when". Falls
                back to the statutory Form B date when no card is active yet,
                so this always agrees with Overview's own Form B countdown.
                Clicking goes to that insight's action, or to Overview when
                using the fallback. */}
            <button
              type="button"
              onClick={() => nextDeadlineInsight ? runAction(nextDeadlineInsight) : navigate('/overview')}
              className="rounded-xl border border-border bg-surface px-4 py-3 min-w-[104px] text-left cursor-pointer transition-colors hover:border-primary">
              <p className="font-headings text-sm text-muted whitespace-nowrap">Next deadline</p>
              <p className={`font-headings text-xl font-bold tracking-tight ${nextDeadlineDays <= 14 ? 'text-critical' : 'text-headings'}`}>
                {nextDeadlineDays}d
              </p>
              <p className="text-[10px] text-muted truncate max-w-[110px]">{shortDeadlineLabel(nextDeadlineInsight)}</p>
            </button>
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
            {loading ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface py-16 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-background">
                  <SparkleIcon className="h-5 w-5 text-muted" />
                </div>
                <p className="text-sm font-semibold text-headings">Loading your insights…</p>
              </div>
            ) : error && insights.length === 0 ? (
              // Fetch failed and there is nothing older on screen — say so
              // explicitly instead of masquerading as an empty inbox.
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface py-16 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-critical-bg">
                  <XIcon className="h-5 w-5 text-critical" />
                </div>
                <p className="text-sm font-semibold text-headings">Couldn’t load your insights</p>
                <p className="mt-1 max-w-xs text-xs text-muted">
                  The insights service didn’t respond. Your documents are safe — this is just the feed.
                </p>
                <button
                  onClick={() => { setLoading(true); refreshInsights(); }}
                  className="mt-4 rounded-lg bg-headings px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90">
                  Try again
                </button>
              </div>
            ) : visible.length === 0 ? (
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
