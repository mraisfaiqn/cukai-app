// Dashboard — composes the dashboard from presentational components,
// feeding each its slice of data from dashboardData.js. The greeting is
// derived from the current hour here (the only render-time computation);
// every child stays stateless and prop-driven.
//
// Layout changes:
//  - TaxHealthCard removed from top row; DeadlinesCarousel takes its slot (right 2 cols).
//  - Bottom right col (was DeadlinesCard) now holds PieChartsCarousel.
//  - Both carousels use dot-navigation to page through items.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPersonalDetails, getAllEntities, getTaxProfileSummary } from '../../services/api';
// Static content that isn't document-derived yet (opportunities + deadlines).
import { opportunities, deadlines } from '../../data/dashboardData';
import DashboardHeader from '../../components/Dashboard/DashboardHeader';
import ActionBanner from '../../components/Dashboard/ActionBanner';
import StatsGrid from '../../components/Dashboard/StatsGrid';
import OpportunitiesCard from '../../components/Dashboard/OpportunitiesCard';

// Route for the Cukai Account page's document upload tab.
const UPLOAD_TAB_ROUTE = '/account?tab=upload';

// Time-of-day greeting — computed once at render, not stored in state.
function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Form B (sole-prop) statutory e-Filing deadline is 30 June each year.
// Returns how many whole days remain until the next occurrence of that date.
function daysToFormBDeadline(today = new Date()) {
  const year = today.getFullYear();
  let deadline = new Date(year, 5, 30); // June is month index 5
  if (today > deadline) deadline = new Date(year + 1, 5, 30);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.ceil((deadline - today) / msPerDay));
}

// Form B is filed for income earned in YEAR by 30 June of YEAR+1. So the YA
// actively being filed right now is last calendar year, up until this year's
// e-Filing deadline (15 July) passes, after which it rolls forward to the year
// that just ended. This MUST match currentFilingYear() in CukaiAccount.jsx —
// documents are tagged with the YA they're actually for, not today's calendar
// year, so querying the wrong year here means the dashboard silently misses
// anything (stats, pending-review counts) filed under the real active YA.
// NOTE: Malaysia Form B deadlines are 30 June (manual paper) and 15 July
// (online e-Filing). cukai.ai is an e-Filing assistant, so the cutoff is 15 Jul
// — the prior YA stays the default through 1–15 July while users finish filing.
function currentFilingYear(today = new Date()) {
  const year = today.getFullYear();
  const eFilingCutoff = new Date(year, 5, 30); // 15 July (month index 6)
  const deadlineYear = today > eFilingCutoff ? year + 1 : year;
  return deadlineYear - 1;
}

// ── Urgency helpers (mirrors DeadlinesCard logic) ──────────────────────────────
function urgencyFor(daysLeft) {
  if (daysLeft <= 7)  return { bar: 'bg-critical', pill: 'bg-critical-bg text-critical' };
  if (daysLeft <= 45) return { bar: 'bg-warning',  pill: 'bg-warning-bg text-warning' };
  return { bar: 'bg-border', pill: 'bg-primary-tint text-muted' };
}

// ── Shared carousel shell ─────────────────────────────────────────────────────
// One slide visible at a time via dot navigation, but ALSO horizontally
// scrollable (trackpad / swipe) with the scrollbar hidden — so laptop users can
// side-scroll and PC users can click the (larger) dots. Dots reflect and drive
// the scroll position.
function CarouselShell({ label, slides, dotsUnderRight = false }) {
  const scrollRef = useRef(null);
  const [idx, setIdx] = useState(0);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1));
    setIdx(prev => (prev !== i ? i : prev));
  }, []);

  const goTo = (i) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  const dots = (
    <div className="flex items-center justify-center gap-2">
      {slides.map((_, i) => (
        <button
          key={i}
          onClick={() => goTo(i)}
          aria-label={`Go to slide ${i + 1}`}
          className={
            'h-2 rounded-full transition-all duration-200 ' +
            (i === idx ? 'w-6 bg-[#0D9488]' : 'w-2 bg-slate-300 hover:bg-slate-400')
          }
        />
      ))}
    </div>
  );

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-surface p-3">
      <style>{'.cukai-carousel::-webkit-scrollbar{display:none}'}</style>
      {label && <p className="font-headings text-sm font-bold text-headings shrink-0 mb-2">{label}</p>}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="cukai-carousel flex flex-1 min-h-0 overflow-x-auto snap-x snap-mandatory"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {slides.map((node, i) => (
          <div key={i} className="flex w-full shrink-0 snap-center min-h-0 flex-col">
            {node}
          </div>
        ))}
      </div>
      {dotsUnderRight ? (
        <div className="grid grid-cols-4 shrink-0 pt-2">
          <div />
          <div className="col-span-3">{dots}</div>
        </div>
      ) : (
        <div className="shrink-0 pt-2">{dots}</div>
      )}
    </section>
  );
}

// ── DeadlinesCarousel ──────────────────────────────────────────────────────────
// Shows one deadline at a time; dot nav + hidden side-scroll via CarouselShell.
function DeadlinesCarousel({ deadlines }) {
  if (!deadlines || deadlines.length === 0) return null;
  const slides = deadlines.map((d) => {
    const tone = urgencyFor(d.daysLeft);
    return (
      <div className="flex flex-1 items-start gap-3 py-2 px-0.5">
        <span className={'mt-0.5 h-9 w-1 shrink-0 rounded-full ' + tone.bar} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-headings truncate">{d.label}</p>
          <p className="mt-0.5 text-xs text-muted truncate">{d.sub}</p>
        </div>
        <span className={'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ' + tone.pill}>
          {d.daysLeft}d
        </span>
      </div>
    );
  });
  return <CarouselShell label="Upcoming Deadlines" slides={slides} />;
}

// ── DonutSlice helper ──────────────────────────────────────────────────────────
function buildSlices(segments, cx, cy, r, inner) {
  const total = segments.reduce((s, sg) => s + sg.value, 0);
  if (total === 0) return { slices: [], total };
  const nonZero = segments.filter(s => s.value > 0);
  if (nonZero.length === 1) {
    const sg = nonZero[0];
    const outerPath = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r}`;
    const innerPath = `M ${cx} ${cy - inner} A ${inner} ${inner} 0 1 0 ${cx} ${cy + inner} A ${inner} ${inner} 0 1 0 ${cx} ${cy - inner}`;
    return { slices: [{ ...sg, d: `${outerPath} Z ${innerPath} Z` }], total };
  }
  let cum = -Math.PI / 2;
  const slices = nonZero.map(sg => {
    const angle = (sg.value / total) * 2 * Math.PI;
    const s = cum; cum += angle; const e = cum;
    const large = angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(s),    y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e),    y2 = cy + r * Math.sin(e);
    const ix1 = cx + inner * Math.cos(s), iy1 = cy + inner * Math.sin(s);
    const ix2 = cx + inner * Math.cos(e), iy2 = cy + inner * Math.sin(e);
    const d = [`M ${x1} ${y1}`, `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
      `L ${ix2} ${iy2}`, `A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1}`, 'Z'].join(' ');
    return { ...sg, d };
  });
  return { slices, total };
}

const fmtRM = (v) => 'RM ' + Number(v).toLocaleString('en-MY', { maximumFractionDigits: 0 });
const pct = (v, t) => t ? ((v / t) * 100).toFixed(1) + '%' : '0%';

// Color palette cycled across categories so charts stay readable regardless
// of how many distinct categories a user's documents happen to produce.
const SEGMENT_PALETTE = ['#0D9488', '#F59E0B', '#6366F1', '#EC4899', '#10B981', '#F97316', '#3B82F6', '#8B5CF6', '#EF4444', '#14B8A6'];

// Strip the "Qn — " quadrant prefix from a category so chart legends read in
// plain language (users don't think in quadrant numbers).
function prettyCategory(cat) {
  if (!cat) return 'Uncategorised';
  if (cat === 'Mixed / Pending Review') return 'Pending Review';
  return cat.replace(/^Q[1-4]\s*[—-]\s*/, '');
}

// Groups a list of document-derived entries (each with `category` and
// `amountNumeric`) into chart segments, summing amounts per category.
function segmentsByCategory(entries) {
  const totals = new Map();
  (entries || []).forEach((e) => {
    const label = prettyCategory(e.category);
    totals.set(label, (totals.get(label) || 0) + (e.amountNumeric || 0));
  });
  return Array.from(totals.entries())
    .filter(([, value]) => value > 0)
    .map(([label, value], i) => ({ label, value, color: SEGMENT_PALETTE[i % SEGMENT_PALETTE.length] }));
}

// Same idea, but for the already-grouped relief breakdown the backend
// returns (each item has `category`, `rawTotal`, `cap`, `cappedTotal`,
// `wasCapped`). We carry the cap fields through so the legend can show each
// relief's progress toward its statutory cap.
function segmentsFromReliefBreakdown(breakdown) {
  return (breakdown || [])
    .filter((b) => (b.cappedTotal || 0) > 0)
    .map((b, i) => ({
      label: prettyCategory(b.category),
      value: b.cappedTotal,
      color: SEGMENT_PALETTE[i % SEGMENT_PALETTE.length],
      cap: (b.cap ?? null),           // statutory ceiling for this relief (RM), or null if uncapped
      rawTotal: (b.rawTotal ?? null), // total the user actually uploaded, before capping
      wasCapped: !!b.wasCapped,       // true once uploads exceed the cap
    }));
}

// ── Pie slide (4-column: legend + footer | enlarged donut) ────────────────────
function PieSlide({ chart }) {
  const [hovered, setHovered] = useState(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  const SIZE = 190;                         // enlarged from 150
  const CX = SIZE / 2, CY = SIZE / 2;
  const R = SIZE * 0.40, INNER = SIZE * 0.23;
  const { slices, total } = buildSlices(chart.segments, CX, CY, R, INNER);

  return (
    <div className="grid flex-1 min-h-0 grid-cols-4 gap-3">
      {/* Tooltip portal */}
      {hovered && (
        <div
          className="fixed z-[9999] pointer-events-none rounded-lg border border-border bg-surface px-3 py-2 shadow-lg"
          style={{ left: Math.min(mouse.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 800) - 200), top: mouse.y - 12, width: 176 }}
        >
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: hovered.color }} />
            <span className="text-xs font-semibold text-headings leading-tight">{hovered.label}</span>
          </div>
          <p className="text-xs text-muted mt-1">{fmtRM(hovered.value)}</p>
          <p className="text-xs text-muted">{pct(hovered.value, total)} of total</p>
          {hovered.cap != null && (
            <p className={'text-[10px] mt-1 ' + (hovered.wasCapped ? 'text-warning font-semibold' : 'text-muted')}>
              {hovered.wasCapped
                ? `Cap reached — RM${Number(hovered.rawTotal || hovered.value).toLocaleString('en-MY',{maximumFractionDigits:0})} claimed, capped at ${fmtRM(hovered.cap)}`
                : `Relief cap: ${fmtRM(hovered.cap)}`}
            </p>
          )}
        </div>
      )}

      {/* Left column (1/4) — legend (scrollable) + footer total */}
      <div className="col-span-1 flex flex-col min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-center space-y-1.5 pr-0.5">
          {slices.length === 0 ? (
            <p className="text-xs text-muted">No data yet</p>
          ) : (
            slices.map(sl => (
              <div key={sl.label} className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-1.5 min-w-0">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-sm" style={{ background: sl.color }} />
                  <div className="min-w-0">
                    <span className="block truncate text-sm text-muted">{sl.label}</span>
                    {/* Relief-cap progress: shown only for capped relief categories.
                        Amber once the statutory ceiling is reached. */}
                    {sl.cap != null && (
                      <span className={'block text-[10px] leading-tight ' + (sl.wasCapped ? 'text-warning font-semibold' : 'text-muted')}>
                        {fmtRM(Math.min(sl.value, sl.cap))} / {fmtRM(sl.cap)}
                        {sl.wasCapped ? ' · cap reached' : ' cap'}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-sm font-semibold text-headings shrink-0">{pct(sl.value, total)}</span>
              </div>
            ))
          )}
        </div>
        {chart.footerLabel && (
          <div className="shrink-0 mt-2 border-t border-border pt-2">
            <p className="text-sm text-muted">{chart.footerLabel}</p>
            <p className="text-sm font-bold" style={{ color: chart.footerColor || 'inherit' }}>{fmtRM(total)}</p>
          </div>
        )}
      </div>

      {/* Right columns (3/4) — title fixed at top, donut centered in the remaining space (matches bar chart layout) */}
      <div className="col-span-3 flex flex-col min-h-0">
        <div className="text-center shrink-0 mb-2">
          <p className="font-headings text-sm font-bold text-headings">{chart.title}</p>
          {chart.subtitle && <p className="text-sm text-muted mt-0.5">{chart.subtitle}</p>}
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center">
        {total === 0 ? (
          <div style={{ width: SIZE, height: SIZE }} className="flex items-center justify-center rounded-full border-2 border-dashed border-border">
            <p className="text-xs text-muted text-center px-2">No data yet</p>
          </div>
        ) : (
          <div className="relative" style={{ width: SIZE, height: SIZE }}>
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}
              onMouseLeave={() => setHovered(null)} style={{ overflow: 'visible' }}>
              {slices.map(sl => (
                <path key={sl.label} d={sl.d} fill={sl.color} fillRule="evenodd"
                  opacity={hovered && hovered.label !== sl.label ? 0.4 : 1}
                  style={{ cursor: 'pointer', transition: 'opacity 0.15s, transform 0.1s',
                    transformOrigin: `${CX}px ${CY}px`,
                    transform: hovered?.label === sl.label ? 'scale(1.04)' : 'scale(1)' }}
                  onMouseEnter={e => { setMouse({ x: e.clientX, y: e.clientY }); setHovered(sl); }}
                  onMouseMove={e => setMouse({ x: e.clientX, y: e.clientY })} />
              ))}
              <text x={CX} y={CY - 5} textAnchor="middle" fontSize={SIZE * 0.065} fill="var(--color-muted, #94A3B8)" fontFamily="sans-serif">Total</text>
              <text x={CX} y={CY + 10} textAnchor="middle" fontSize={SIZE * 0.072} fill="var(--color-headings, #0F172A)" fontWeight="700" fontFamily="sans-serif">
                {fmtRM(total)}
              </text>
            </svg>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

// ── Bar slide — grouped bars of the key tax figures for each year ─────────────
// Total Income / Total Deductions / Chargeable Income / Est. Tax are DIFFERENT
// measures (not parts of one whole), so they're drawn as a grouped bar per year
// rather than stacked, which would visually imply they sum together.
const BAR_METRICS = [
  { key: 'totalIncome',                label: 'Total Income',      color: '#0D9488' },
  { key: 'q3TotalDeductions',          label: 'Total Deductions',  color: '#F59E0B' },
  { key: 'estimatedChargeableIncome',  label: 'Chargeable Income', color: '#6366F1' },
  { key: 'estimatedTaxPayable',        label: 'Est. Tax Payable',  color: '#DC2626' },
];

function BarSlide({ chart }) {
  const [hovered, setHovered] = useState(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  const years = (chart.years || []).filter(Boolean);
  const rows = years.map(y => ({
    year: y.year,
    vals: BAR_METRICS.map(m => Number(y.totals?.[m.key]) || 0),
  }));
  const maxAbs = Math.max(1, ...rows.flatMap(r => r.vals.map(v => Math.abs(v))));

  // SVG geometry (responsive via viewBox).
  const H = 150, PAD_BOTTOM = 22, PAD_TOP = 8;
  const baseline = H - PAD_BOTTOM;
  const maxBarUp = baseline - PAD_TOP;
  const groupW = 60, barW = 11, barGap = 2;
  const groupInner = BAR_METRICS.length * barW + (BAR_METRICS.length - 1) * barGap;
  const W = Math.max(rows.length * groupW + 16, 160);

  return (
    <div className="grid flex-1 min-h-0 grid-cols-4 gap-3">
      {/* Tooltip portal — same interaction as the donut slides */}
      {hovered && (
        <div
          className="fixed z-[9999] pointer-events-none rounded-lg border border-border bg-surface px-3 py-2 shadow-lg"
          style={{ left: Math.min(mouse.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 800) - 200), top: mouse.y - 12, width: 176 }}
        >
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: hovered.color }} />
            <span className="text-xs font-semibold text-headings leading-tight">{hovered.label}</span>
          </div>
          <p className="text-xs text-muted mt-1">{fmtRM(hovered.value)}</p>
          <p className="text-xs text-muted">YA {hovered.year}</p>
        </div>
      )}

      {/* Left column — metric legend */}
      <div className="col-span-1 flex flex-col justify-center gap-2 min-h-0">
        {BAR_METRICS.map(m => (
          <div key={m.key} className="flex items-center gap-1.5 min-w-0">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: m.color }} />
            <span className="truncate text-sm text-muted">{m.label}</span>
          </div>
        ))}
      </div>

      {/* Right columns — title + grouped bars */}
      <div className="col-span-3 flex flex-col min-h-0">
        <div className="text-center shrink-0 mb-2">
          <p className="font-headings text-sm font-bold text-headings">Tax Summary by Year</p>
          <p className="text-sm text-muted mt-0.5">Across years of assessment</p>
        </div>
        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-muted">No data yet</p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-x-auto cukai-carousel" style={{ scrollbarWidth: 'none' }}>
            <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ minWidth: W, overflow: 'visible' }}
              onMouseLeave={() => setHovered(null)}>
              <line x1="0" y1={baseline} x2={W} y2={baseline} stroke="var(--color-border, #E2E8F0)" strokeWidth="1" />
              {rows.map((r, gi) => {
                const gx = 8 + gi * groupW + (groupW - 16 - groupInner) / 2;
                return (
                  <g key={r.year}>
                    {r.vals.map((v, bi) => {
                      const h = Math.min(Math.abs(v) / maxAbs * maxBarUp, maxBarUp);
                      const x = gx + bi * (barW + barGap);
                      const up = v >= 0;
                      const y = up ? baseline - h : baseline;
                      const drawH = up ? h : Math.min(h, PAD_BOTTOM - 6);
                      const barId = `${gi}-${bi}`;
                      const metric = BAR_METRICS[bi];
                      const baseOpacity = up ? 1 : 0.6;
                      return (
                        <rect key={bi} x={x} y={y} width={barW} height={Math.max(drawH, v === 0 ? 0 : 1)}
                          rx="1.5" fill={metric.color}
                          opacity={hovered && hovered.id !== barId ? 0.35 : baseOpacity}
                          style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                          onMouseEnter={e => { setMouse({ x: e.clientX, y: e.clientY }); setHovered({ id: barId, label: metric.label, color: metric.color, value: v, year: r.year }); }}
                          onMouseMove={e => setMouse({ x: e.clientX, y: e.clientY })} />
                      );
                    })}
                    <text x={gx + groupInner / 2} y={H - 7} textAnchor="middle" fontSize="10"
                      fill="var(--color-muted, #94A3B8)" fontFamily="sans-serif">{r.year}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PieChartsCarousel ──────────────────────────────────────────────────────────
// Donut slides (Business / Deductible / Reliefs) plus a per-year bar slide,
// navigated by dots or by side-scrolling. Fills the right col of the body grid.
function PieChartsCarousel({ charts }) {
  const slides = (charts || []).map((c, i) =>
    c.type === 'bar' ? <BarSlide key={i} chart={c} /> : <PieSlide key={i} chart={c} />
  );
  return <CarouselShell label="Breakdown & Trends" slides={slides} dotsUnderRight />;
}

// ── Neutral placeholders shown until the first fetch resolves ──────────────────
// Using neutral skeletons (not the mock dashboardData) means the first paint
// shows empty "—" cards and "No data yet" charts rather than fake figures that
// then snap to real ones — no jarring flash of numbers that were never real.
const SKELETON_STATS = [
  { label: 'Total Income',      value: '—', change: '' },
  { label: 'Total Deductions',  value: '—', change: '' },
  { label: 'Chargeable Income', value: '—', change: '' },
  { label: 'Est. Tax Payable',  value: '—', change: '' },
];
const SKELETON_PIES = [
  { title: 'Business Income',     subtitle: '', segments: [], footerLabel: 'Total Business Income',  footerColor: '#0D9488' },
  { title: 'Deductible Expenses', subtitle: '', segments: [], footerLabel: 'Total Deductions',       footerColor: '#F59E0B' },
  { title: 'Personal Reliefs',    subtitle: '', segments: [], footerLabel: 'Total Reliefs Claimed',  footerColor: '#6366F1' },
];
const SKELETON_ACCOUNT = { name: '', entity: '', msic: '', assessmentYear: '', deadlineNote: '' };

// ── Overview ───────────────────────────────────────────────────────────────────
export default function Overview() {
  const navigate = useNavigate();

  // 1. Establish state variables using neutral skeletons as placeholders
  const [liveAccount, setLiveAccount] = useState(SKELETON_ACCOUNT);
  const [liveStats, setLiveStats] = useState(SKELETON_STATS);
  const [livePieCharts, setLivePieCharts] = useState(SKELETON_PIES);
  const [liveAlert, setLiveAlert] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load dashboard data for the currently active entity.
  // IMPORTANT: this must not assume activeEntityId already exists in localStorage.
  // Right after login, Overview is often the FIRST page the user lands on —
  // ManageAccount (which used to be the only place that picked a default entity)
  // may never have run yet. So Overview resolves and persists its own default
  // here, the same way ManageAccount does, instead of depending on it.
  const fetchDashboardMetrics = React.useCallback(async () => {
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) return;

      const assessmentYear = currentFilingYear();

      // Fetch person details and the user's full entity list first — we need
      // to know which entity is active before requesting an entity-scoped
      // tax summary, otherwise switching entities wouldn't change anything
      // shown on this page.
      const [person, entities] = await Promise.all([
        getPersonalDetails(userId),
        getAllEntities(userId).catch(() => []),
      ]);

      // Resolve which entity should be active:
      // 1. Use the stored activeEntityId ONLY if it actually belongs to this user.
      // 2. Otherwise fall back to the user's first entity and persist that choice.
      // 3. If the user has no entities at all, there's nothing to show.
      let storedEntityId = parseInt(localStorage.getItem('activeEntityId') || '0');
      const storedIsValid = entities.some((e) => e.id === storedEntityId);

      let activeEntity = null;
      if (storedIsValid) {
        activeEntity = entities.find((e) => e.id === storedEntityId);
      } else if (entities.length > 0) {
        activeEntity = entities[0];
        localStorage.setItem('activeEntityId', String(activeEntity.id));
      }

      // Now fetch the document-derived tax summary scoped to the resolved
      // active entity, so the stats/pie charts/banner update on entity switch.
      const summary = await getTaxProfileSummary(
        assessmentYear, userId, activeEntity?.id ?? null,
      ).catch(() => null);

      const cy = summary?.currentYear;
      const totals = cy?.totals;
      const docCount = cy?.documentCount ?? 0;
      const pendingReview = cy?.pendingReviewCount ?? 0;
      // The actual items behind pendingReview — some are real documents,
      // some are account-level reconciliation notes (CP500, Breastfeeding,
      // Departure Levy, One-Time Relief) or even a profile-setting issue
      // (Joint Assessment) with no document at all. Previously only the
      // bare count was ever used; the banner had no way to show WHAT was
      // actually pending or let the user act on it directly.
      const pendingItems = cy?.mixedPendingReview ?? [];
      const daysLeft = daysToFormBDeadline();

      // ── Stats grid: derived from uploaded-document totals only when this
      // year actually has processed documents. Without the docCount guard the
      // summary always returns a (zeroed) totals object, so a year with no
      // documents would show RM0 everywhere instead of the entity's own figures.
      if (totals && docCount > 0) {
        // Year-over-year movement vs the prior YA's totals (from the same
        // summary payload). The arrow shows the direction of change; the colour
        // shows whether that direction is *favourable* for the metric — income
        // and deductions rising is good (green), chargeable income and tax
        // rising is bad (red). `favorable` encodes "which way is good".
        const priorTotals = summary?.priorYear?.totals || null;
        const priorLabel  = assessmentYear - 1;
        const fmtDelta = (n) =>
          (n >= 0 ? '+' : '−') + 'RM ' +
          Number(Math.abs(n)).toLocaleString('en-MY', { maximumFractionDigits: 0 });
        const yoy = (curr, prior, favorable) => {
          if (prior == null) return { change: 'No prior YA to compare', trend: 'flat', tone: 'muted' };
          const delta = (Number(curr) || 0) - (Number(prior) || 0);
          if (Math.abs(delta) < 0.5) return { change: `No change vs YA ${priorLabel}`, trend: 'flat', tone: 'muted' };
          const trend = delta > 0 ? 'up' : 'down';
          const good  = (delta > 0) === (favorable === 'up');
          return { change: `${fmtDelta(delta)} vs YA ${priorLabel}`, trend, tone: good ? 'success' : 'danger' };
        };

        setLiveStats([
          { label: 'Total Income',      value: fmtRM(totals.totalIncome || 0),
            ...yoy(totals.totalIncome, priorTotals?.totalIncome, 'up') },
          { label: 'Total Deductions',  value: fmtRM(totals.q3TotalDeductions || 0),
            ...yoy(totals.q3TotalDeductions, priorTotals?.q3TotalDeductions, 'up') },
          { label: 'Chargeable Income', value: fmtRM(totals.estimatedChargeableIncome || 0),
            ...yoy(totals.estimatedChargeableIncome, priorTotals?.estimatedChargeableIncome, 'down') },
          { label: 'Est. Tax Payable',  value: fmtRM(totals.estimatedTaxPayable || 0),
            ...yoy(totals.estimatedTaxPayable, priorTotals?.estimatedTaxPayable, 'down') },
        ]);
      } else if (activeEntity) {
        const turnover  = parseFloat(activeEntity.salesTurnover)    || 0;
        const expenses  = parseFloat(activeEntity.totalExpenditure) || 0;
        const netProfit = parseFloat(activeEntity.netProfitLoss)    || (turnover - expenses);
        const estimatedTax = netProfit > 5000 ? netProfit * 0.03 : 0;

        setLiveStats([
          { label: 'Sales Turnover',    value: fmtRM(turnover),    change: 'Live Sync',  trend: 'up' },
          { label: 'Total Expenditure', value: fmtRM(expenses),    change: 'Live Sync',  trend: 'down' },
          { label: 'Net Profit / Loss', value: fmtRM(netProfit),   change: 'Calculated', trend: netProfit >= 0 ? 'up' : 'down' },
          { label: 'Est. Tax Payable',  value: fmtRM(estimatedTax), change: 'Formulaic',  trend: 'neutral' },
        ]);
      }

      // ── Pie charts: each page built from a different slice of the
      // document-derived totals, so they repopulate as the user uploads more.
      // NOTE: q1BusinessIncome / q3Deductions / etc. live under
      // `currentYear`, not on the summary root — only currentYear, priorYear,
      // yearlyTrend, and projection are top-level keys.
      setLivePieCharts([
        {
          title: 'Business Income',
          subtitle: `YA ${assessmentYear}`,
          segments: segmentsByCategory(cy?.q1BusinessIncome),
          footerLabel: 'Total Business Income',
          footerColor: '#0D9488',
        },
        {
          title: 'Deductible Expenses',
          subtitle: `YA ${assessmentYear}`,
          segments: segmentsByCategory(cy?.q3Deductions),
          footerLabel: 'Total Deductions',
          footerColor: '#F59E0B',
        },
        {
          title: 'Personal Reliefs',
          subtitle: `YA ${assessmentYear}`,
          segments: segmentsFromReliefBreakdown(totals?.q4ReliefsBreakdown),
          footerLabel: 'Total Reliefs Claimed',
          footerColor: '#6366F1',
        },
        {
          type: 'bar',
          years: summary?.yearlyTrend || [],
        },
      ]);

      // ── Action banner: reflects documents waiting on review in the Upload
      // Documents tab. Hidden entirely once nothing needs attention.
      setLiveAlert(
        pendingReview > 0
          ? {
              title: 'Action Required',
              message: `${pendingReview} of ${docCount} document${docCount === 1 ? '' : 's'} for YA ${assessmentYear} need${pendingReview === 1 ? 's' : ''} your review before filing.`,
              items: pendingItems,
            }
          : null
      );

      if (activeEntity) {
        setLiveAccount({
          name:           person?.fullName || 'Taxpayer',
          entity:         activeEntity.name || 'My Business',
          msic:           activeEntity.businessCode ? `MSIC ${activeEntity.businessCode}` : 'No MSIC Set',
          assessmentYear: `YA ${assessmentYear}`,
          deadlineNote:   `${daysLeft} day${daysLeft === 1 ? '' : 's'} to Form B`,
        });
      }
    } catch (err) {
      console.error('Error fetching dashboard metrics:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and listen for entity switches triggered from ManageProfile
  useEffect(() => {
    fetchDashboardMetrics();

    const handleEntitySwitch = () => fetchDashboardMetrics();
    window.addEventListener('entitySwitch', handleEntitySwitch);
    return () => window.removeEventListener('entitySwitch', handleEntitySwitch);
  }, [fetchDashboardMetrics]);

  return (
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body flex flex-col">
      <div className="mx-auto w-full max-w-7xl px-6 py-4 flex flex-col flex-1 min-h-0 gap-3">
      {/* ── Header using dynamic backend account details ── */}
      <div className="shrink-0">
        <DashboardHeader
          greeting={timeOfDayGreeting()}
          name={liveAccount.name}
          entity={liveAccount.entity}
          msic={liveAccount.msic}
          assessmentYear={liveAccount.assessmentYear}
          deadlineNote={liveAccount.deadlineNote}
        />
      </div>

      {/* ── Action banner: now expands inline to show the ACTUAL pending
            items (not just a count) — some are real documents, some are
            account-level reconciliation notes or a profile-setting issue
            with no document at all, so each item routes to the right
            place rather than one generic "Review" destination. ── */}
      {liveAlert && (
        <ActionBanner
          title={liveAlert.title}
          message={liveAlert.message}
          items={liveAlert.items}
          onOpenDocument={(docId) => navigate(`${UPLOAD_TAB_ROUTE}&filter=needs_review&docId=${docId}`)}
          // No &filter=needs_review here — this button is for account-level
          // notes with NO document at all (CP500, Breastfeeding, Departure
          // Levy, One-Time Relief). Applying the document-level filter would
          // show OTHER, unrelated needs-review documents, misleading the
          // user into thinking those are what this specific note is about.
          // The plain upload tab (add a new document to resolve this) is
          // the correct destination — onOpenDocument (above) already
          // handles the genuinely document-tied case with a direct deep link.
          onGoToUpload={() => navigate(UPLOAD_TAB_ROUTE)}
          onGoToProfile={() => navigate('/manageaccount')}
          compact
        />
      )}

      <div className="grid grid-cols-6 gap-3">
        <div className="col-span-4">
          {/* ── Stats grid using dynamic numbers from Postgres ── */}
          <StatsGrid stats={liveStats} compact />
        </div>
        <div className="col-span-2">
          <DeadlinesCarousel deadlines={deadlines} />
        </div>
      </div>

        {/* ── Body: 3-column grid, fills remaining height ──
              Col 1-2: Opportunities (scrollable)
              Col 3:   Pie Charts Carousel */}
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
          <div className="col-span-2 min-h-0">
            <PieChartsCarousel charts={livePieCharts} />
          </div>
          <div className="col-span-1 min-h-0">
            <OpportunitiesCard opportunities={opportunities} scrollable />
          </div>
        </div>

      </div>
    </main>
  );
}