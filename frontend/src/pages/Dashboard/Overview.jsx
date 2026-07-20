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
// Deadline banner reads the same mock feed the Insights page shows, so the
// two can't contradict each other. When getInsights() replaces the mock feed,
// this import goes with it.
import { getInitialInsightsForEntity } from "../InsightsInbox";
import DashboardHeader from '../../components/Dashboard/DashboardHeader';
import ActionBanner from '../../components/Dashboard/ActionBanner';
import StatsGrid from '../../components/Dashboard/StatsGrid';
import OpportunitiesCard from '../../components/Dashboard/OpportunitiesCard';
import { TbCalendarEvent } from 'react-icons/tb';

// Route for the Cukai Account page's document upload tab.
const UPLOAD_TAB_ROUTE = '/account?tab=upload';
// Route for the Manage Account page's Generate Forms tab.
const FORMS_TAB_ROUTE = '/manageaccount?tab=forms';

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

// ── Small icons for the chart tabs ────────────────────────────────────────────
const TabPieIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" />
  </svg>
);
const TabFileIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
);
const TabGiftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
  </svg>
);
const TabBarChartIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" />
  </svg>
);


// ── Shared carousel shell ─────────────────────────────────────────────────────
// One slide visible at a time via dot navigation, but ALSO horizontally
// scrollable (trackpad / swipe) with the scrollbar hidden — so laptop users can
// side-scroll and PC users can click the (larger) dots. Dots reflect and drive
// the scroll position.
function CarouselShell({ label, slides, slideLabels, dotsUnderRight = false }) {
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

  // Tab buttons — one per slide name. Clicking a tab uses the same goTo()
  // that the dots use. Styled as filled cards: grey when inactive, white
  // with a teal underline when active (matches the design mock).
  let tabs = null;
  if (slideLabels) {
    tabs = (
      <div className="flex flex-1 items-center gap-5 ml-16">
        {slideLabels.map((item, i) => (
          <button
            key={item.name}
            onClick={() => goTo(i)}
            className={
              'whitespace-nowrap px-1 pb-2 text-xs -mb-px border-b-2 transition-colors ' +
              (i === idx
                ? 'text-primary font-semibold border-primary'
                : 'text-muted border-transparent hover:text-headings')
            }
          >
            {item.name}
          </button>
        ))}
      </div>
    );
  }
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
    <section className="flex h-full flex-col rounded-xl border border-border bg-surface p-3 shadow-md">
      <style>{'.cukai-carousel::-webkit-scrollbar{display:none}'}</style>
      {(label || tabs) && (
        <div className={'flex items-end gap-4 shrink-0 mb-2 ' + (tabs ? 'border-b border-border' : '')}>
          {label && <p className={'font-headings text-sm font-bold text-headings shrink-0 ' + (tabs ? 'pb-2' : '')}>{label}</p>}
          {tabs}
        </div>
      )}
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
      {!slideLabels && (dotsUnderRight ? (
        <div className="grid grid-cols-4 shrink-0 pt-2">
          <div />
          <div className="col-span-3">{dots}</div>
        </div>
      ) : (
        <div className="shrink-0 pt-2">{dots}</div>
      ))}
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

// Cut short the long titlelah
// "CP500 installment num. 4
function shortLabel(title) {
  const m = title.match(/CP500.*?#(\d+)/i);
  if (m) return `CP500 #${m[1]}`;
  return title.split('—')[0].trim();
}

// Turns deadline-type insights into the { label, sub, daysLeft } structure the dashboard expects. 
// It's a temporary connection until the real API provides deadlines in the expected format.
// currently using mock data from InsightsInbox.jsx. Takes the one due soonest
const DAY_MS = 86400000;
function deadlinesFromInsights(entityId) {
  return getInitialInsightsForEntity(entityId)
    .filter((i) => i.insightType === 'deadline' && i.deadlineDate)
    .map((i) => {
      const dt = new Date(i.deadlineDate);
      return {
        label: i.title,
        sub: i.rmImpact != null ? 'Amount due: ' + fmtRM(i.rmImpact) : '',
        daysLeft: Math.ceil((dt - Date.now()) / DAY_MS),
        month: dt.toLocaleDateString('en-MY', { month: 'short' }).toUpperCase(),
        day: dt.getDate(),
      };
    });
}

// ── Savings opportunities from insights, to sync for Unclaimed Savings (Overview) ───────────────────────────────────────
const SAVINGS_TYPES = ['relief_headroom', 'doc_gap'];
function savingsFromInsights(entityId) {
  return getInitialInsightsForEntity(entityId)
   .filter((i) =>
      SAVINGS_TYPES.includes(i.insightType) &&
      i.rmImpact != null &&
      i.state !== 'dismissed' &&
      i.state !== 'resolved'
    )
    .sort((a, b) => (b.rmImpact || 0) - (a.rmImpact || 0))
    .map((i) => ({
      id: i.id,
      title: i.title,
    provision: i.citation || (i.insightType === 'relief_headroom' ? 'Tax relief' : 'Business deduction'),
      amount: '+' + fmtRM(i.rmImpact),
    }));
  }


// ── DeadlineBanner ─────────────────────────────────────────────────────────────
// Wide top-of-page banner showing only the nearest deadline. The full list
// stays reachable via the link, so this trades completeness for prominence.
function DeadlineBanner({ deadlines, onViewAll }) {
  if (!deadlines || deadlines.length === 0) return null;
  const d = [...deadlines].sort((a, b) => a.daysLeft - b.daysLeft)[0];
  const tone = urgencyFor(d.daysLeft);

  return (
    <section className="flex flex-col rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">Upcoming Deadline</p>
        {onViewAll && (
          <button onClick={onViewAll}
            className="text-xs font-medium text-primary hover:underline whitespace-nowrap">
            View all
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div className="flex h-11 w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-critical-bg text-critical leading-none">
          <span className="text-[9px] font-semibold uppercase">{d.month}</span>
          <span className="text-base font-bold">{d.day}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-headings truncate">{d.label}</p>
          <p className="text-xs text-muted truncate">{d.sub}</p>
        </div>
        <span className="shrink-0 rounded-full bg-critical-bg px-2.5 py-1 text-[11px] font-semibold text-critical whitespace-nowrap">
          {d.daysLeft} days left
        </span>
      </div>
    </section>
  );
}

//CP500 card
// ── Cp500Card ──────────────────────────────────────────────────────────────────
// Shows what fraction of the estimated tax liability has been prepaid via CP500
// instalments. Reads cp500Paid and estimatedTaxPayable straight from the summary.
function Cp500Card({ totals }) {
  const paid = Number(totals?.cp500Paid) || 0;
  const liability = Number(totals?.estimatedTaxPayable) || 0;
  const pct = liability > 0 ? Math.round((paid / liability) * 100) : 0;
  const color = pct > 0 ? '#0D9488' : '#DC2626';

  return (
    <section className="flex flex-col rounded-xl border border-border bg-surface p-4">
  <div className="flex items-baseline gap-2">
        <p className="text-sm font-bold text-headings">CP500 Coverage</p>
        <p className="text-xs text-muted">YA 2026</p>
      </div>

      <div className="flex items-center gap-3 mt-3">
        <p className="text-2xl font-bold shrink-0" style={{ color }}>{pct}%</p>
        <div className="flex-1">
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
          </div>
          <p className="text-[11px] text-muted mt-1.5">
            {fmtRM(paid)} of {fmtRM(liability)} estimated liability prepaid via CP500
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Upcoming carousel ──────────────────────────────────────────────────────────
// Side-scrollable box (built on the shared CarouselShell) paging through three
// slides: nearest deadline, CP500 coverage, and tax bracket headroom.
function DeadlineSlide({ deadlines, onViewAll }) {
  if (!deadlines || deadlines.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted">No upcoming deadlines</p>
      </div>
    );
  }
  const d = [...deadlines].sort((a, b) => a.daysLeft - b.daysLeft)[0];
  const tone = urgencyFor(d.daysLeft);
  return (
    <div className="flex flex-1 flex-col justify-center">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-headings">Upcoming deadline</p>
        {onViewAll && (
          <button onClick={onViewAll}
            className="text-xs font-medium text-primary hover:underline whitespace-nowrap">
            View all
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-critical-bg text-critical leading-none">
          <span className="text-[9px] font-semibold uppercase">{d.month}</span>
          <span className="text-base font-bold">{d.day}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-headings truncate">{d.label}</p>
          <p className="text-xs text-muted truncate">{d.sub}</p>
        </div>
        <span className={'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ' + tone.pill}>
          {d.daysLeft} days left
        </span>
      </div>
    </div>
  );
}

function Cp500Slide({ totals }) {
  const paid = Number(totals?.cp500Paid) || 0;
  const liability = Number(totals?.estimatedTaxPayable) || 0;
  const coverage = liability > 0 ? Math.round((paid / liability) * 100) : 0;
  const color = coverage > 0 ? '#0D9488' : '#DC2626';
  return (
    <div className="flex flex-1 flex-col justify-center">
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-bold text-headings">CP500 coverage</p>
        <p className="text-xs text-muted">YA 2026</p>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <p className="text-2xl font-bold shrink-0" style={{ color }}>{coverage}%</p>
        <div className="flex-1">
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${coverage}%`, background: color }} />
          </div>
          <p className="text-[11px] text-muted mt-1.5">
            {fmtRM(paid)} of {fmtRM(liability)} estimated liability prepaid via CP500
          </p>
        </div>
      </div>
    </div>
  );
}

//Tax bracket info logic
const TAX_BRACKETS = [
  {category: 'A', floor: 0, ceiling: 5000, rate: 0},
  {category: 'B', floor: 5001, ceiling: 20000, rate: 1},
  {category: 'C', floor: 20001, ceiling: 35000, rate: 3},
  {category: 'D', floor: 35001, ceiling: 50000, rate: 6},
  {category: 'E', floor: 50001, ceiling: 70000, rate: 11},
  {category: 'F', floor: 70001, ceiling: 100000, rate: 19},
  {category: 'G', floor: 100001, ceiling: 400000, rate: 25},
  {category: 'H', floor: 400001, ceiling: 600000, rate: 26},
  {category: 'I', floor: 600001, ceiling: 2000000, rate: 28},
  {category: 'J', floor: 2000001, ceiling: Infinity, rate: 30},
];

function bracketHeadroom(chargeableIncome) {
  const income = Number(chargeableIncome) || 0;

  const index = TAX_BRACKETS.findIndex(b => income >= b.floor && income <= b.ceiling);
  const current = TAX_BRACKETS[index] || TAX_BRACKETS[0];
  const next = TAX_BRACKETS[index + 1] || null;

  const headroom = current.ceiling === Infinity ? null : current.ceiling - income;

  const span = current.ceiling === Infinity ? 0 : current.ceiling - current.floor;
  const filledPct = span > 0
  ? Math.min(100, Math.max(0, ((income-current.floor) / span) * 100))
  : 100;

  const suggestSdnBhd = current.rate >= 25;
  return {income, current, next, headroom, filledPct, suggestSdnBhd};
}
function HeadroomSlide() {
  return (
    <div className="flex flex-1 flex-col justify-center">
      <p className="text-sm font-bold text-headings">Tax bracket headroom</p>
      <p className="text-2xl font-bold text-headings mt-0.5">RM 246,299</p>
      <p className="text-xs text-muted">before your rate rises to 26% (Category H)</p>
      <div className="mt-2.5">
        <div className="h-2 bg-border rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: '18%', background: '#0D9488' }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-muted">
          <span>RM 100k</span>
          <span>you: RM 153,701</span>
          <span>RM 400k</span>
        </div>
      </div>
    {/* The extra advice box for the headroom box
    <div className="mt-2.5 rounded-lg bg-primary-tint p-2.5">
        <p className="text-xs font-semibold text-primary">Consider incorporating to an Sdn Bhd</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          At this income level a company is taxed at 15–17% instead of your 25%. Many sole proprietors speak to a tax professional here.
        </p>
      </div> */}
    </div>
  );
}

function UpcomingCarousel({ deadlines, totals, onViewAll }) {
  const slides = [
    <DeadlineSlide key="deadline" deadlines={deadlines} onViewAll={onViewAll} />,
    <Cp500Slide key="cp500" totals={totals} />,
    <HeadroomSlide key="headroom" />,
  ];
  return <CarouselShell slides={slides} />;
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

// Round an axis maximum up to a readable round number (1, 2, 2.5, or 5 × a
// power of 10) so y-axis ticks land on 20K/40K/60K rather than 18,460/36,920.
function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}
const fmtAxis = (v) => (v >= 1000 ? v / 1000 + 'K' : String(v));
const fmtBar = (v) => Number(v).toLocaleString('en-MY', { maximumFractionDigits: 0 });
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

// Facts for a donut slide's stats strip: how many source documents fed it,
// which category is biggest, and how it moved against the prior YA. Every
// value is read from data already on screen — nothing is estimated.
function slideStats({ entries, segments, currentTotal, priorTotal, priorLabel }) {
  const out = [];

  const docCount = (entries || []).length;
  if (docCount > 0) {
    out.push({ label: 'Documents', value: `${docCount} file${docCount === 1 ? '' : 's'}` });
  }

  const top = [...(segments || [])].sort((a, b) => b.value - a.value)[0];
  if (top && segments.length > 1) {
    out.push({ label: 'Largest', value: top.label });
  }

  if (priorTotal != null && currentTotal != null) {
    const delta = currentTotal - priorTotal;
    const sign = delta >= 0 ? '+' : '−';
    const pctTxt = priorTotal > 0
      ? ` (${sign}${Math.abs((delta / priorTotal) * 100).toFixed(0)}%)`
      : '';
    out.push({
      label: `vs YA ${priorLabel}`,
      value: `${sign}${fmtRM(Math.abs(delta)).slice(3)}${pctTxt}`,
      tone: delta >= 0 ? 'success' : 'danger',
    });
  }

  return out;
}

function detailFromEntries(entries) {
  const map = new Map();
  (entries || []).forEach((e) => {
    const key = prettyCategory(e.category);
    const row = map.get(key) || { label: key, amount: 0, count: 0 };
    row.amount += e.amountNumeric || 0;
    row.count += 1;
    map.set(key, row);
  });
  return Array.from(map.values())
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map((r) => ({
      label: r.label,
      amount: fmtRM(r.amount),
      raw: r.amount,
      count: `${r.count} document${r.count === 1 ? '' : 's'}`,
    }));
}
function reconcileComponents(components, headlineAmount, otherLabel) {
  const listed = components.reduce((s, c) => s + (c.raw || 0), 0);
  const gap = (headlineAmount || 0) - listed;
  if (Math.abs(gap) < 1) return components;
  return [...components, { label: otherLabel, amount: fmtRM(gap), raw: gap }];
}
// Builds an "a + b = total" equation string from a component list, so the
// equation shown can never disagree with the line items below it.
function equationFromComponents(components, total) {
  if (!components || components.length === 0) return null;
  return components.map((c) => fmtRM(c.raw || 0)).join(' + ') + ' = ' + fmtRM(total || 0);
}

// ── Pie slide (4-column: legend + footer | enlarged donut) ────────────────────
function PieSlide({ chart }) {
  const [hovered, setHovered] = useState(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  const SIZE = 150;                         // enlarged from 150
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
      {/* Left column (1/4) — title, legend (scrollable), footer total */}
      <div className="col-span-1 flex flex-col min-h-0">
        
       <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-start space-y-1.5 pr-0.5">
          {slices.length === 0 ? (
            <p className="text-xs text-muted">No data yet</p>
          ) : (
            slices.map(sl => (
              <div key={sl.label} className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-1.5 min-w-0">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-sm" style={{ background: sl.color }} />
                  <div className="min-w-0">
                    <span className="block leading-tight text-[11px] text-muted">{sl.label}</span>
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
    vals: BAR_METRICS.map(m => Math.max(0, Number(y.totals?.[m.key]) || 0)),
  }));
  const axisMax = niceCeil(Math.max(1, ...rows.flatMap(r => r.vals)));
  const TICKS = 5;

  // Fixed drawing surface, scaled to fit by the viewBox. Sized close to the
  // container's own aspect ratio so it fills rather than letterboxes.
  const W = 880, H = 300;
  const PAD_L = 64, PAD_R = 16, PAD_T = 26, PAD_B = 52;
  const baseline = H - PAD_B;
  const plotH = baseline - PAD_T;
  const plotW = W - PAD_L - PAD_R;
  const groupW = rows.length ? plotW / rows.length : plotW;
  const barW = Math.min(30, (groupW * 0.72) / BAR_METRICS.length);
  const barGap = barW * 0.28;
  const groupInner = BAR_METRICS.length * barW + (BAR_METRICS.length - 1) * barGap;

  return (
    <div className="grid flex-1 min-h-0 grid-cols-4 gap-3">
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

      {/* Left column — title + legend chips */}
      <div className="col-span-1 flex flex-col min-h-0">
        <div className="shrink-0 mb-2">
          <p className="font-headings text-sm font-bold text-headings">Tax Summary by Year</p>
          <p className="text-xs text-muted mt-0.5">Across years of assessment</p>
        </div>
        <div className="flex-1 min-h-0 flex flex-col justify-center gap-1.5">
          {BAR_METRICS.map(m => (
            <div key={m.key} className="flex items-center gap-2 min-w-0">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                style={{ background: m.color + '1A' }}>
                <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
              </span>
              <span className="truncate text-xs font-medium text-headings">{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right columns — the chart */}
      <div className="col-span-3 flex flex-col min-h-0">
        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-muted">No data yet</p>
          </div>
        ) : (
          <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
            onMouseLeave={() => setHovered(null)}>
            {Array.from({ length: TICKS + 1 }, (_, i) => {
              const val = (axisMax * i) / TICKS;
              const y = baseline - (i / TICKS) * plotH;
              return (
                <g key={i}>
                  <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y}
                    stroke="var(--color-border, #E2E8F0)" strokeWidth="1"
                    strokeDasharray={i === 0 ? 'none' : '3 4'} />
                  <text x={PAD_L - 10} y={y + 3} textAnchor="end" fontSize="10"
                    fill="var(--color-muted, #94A3B8)" fontFamily="sans-serif">{fmtAxis(val)}</text>
                </g>
              );
            })}

            <text x={16} y={PAD_T + plotH / 2} fontSize="10" fill="var(--color-muted, #94A3B8)"
              fontFamily="sans-serif" textAnchor="middle"
              transform={`rotate(-90 16 ${PAD_T + plotH / 2})`}>Amount (RM)</text>
            <text x={PAD_L + plotW / 2} y={H - 8} fontSize="10" fill="var(--color-muted, #94A3B8)"
              fontFamily="sans-serif" textAnchor="middle">Year of Assessment</text>

            {rows.map((r, gi) => {
              const gx = PAD_L + gi * groupW + (groupW - groupInner) / 2;
              return (
                <g key={r.year}>
                  {r.vals.map((v, bi) => {
                    const h = (v / axisMax) * plotH;
                    const x = gx + bi * (barW + barGap);
                    const barId = `${gi}-${bi}`;
                    const metric = BAR_METRICS[bi];
                    return (
                      <g key={bi}>
                        <rect x={x} y={baseline - h} width={barW} height={Math.max(h, v === 0 ? 0 : 1)}
                          rx="3" fill={metric.color}
                          opacity={hovered && hovered.id !== barId ? 0.35 : 1}
                          style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                          onMouseEnter={e => { setMouse({ x: e.clientX, y: e.clientY }); setHovered({ id: barId, label: metric.label, color: metric.color, value: v, year: r.year }); }}
                          onMouseMove={e => setMouse({ x: e.clientX, y: e.clientY })} />
                        {v > 0 && (
                          <text x={x + barW / 2} y={baseline - h - 6} textAnchor="middle" fontSize="8.5"
                            fill="var(--color-headings, #0F172A)" fontFamily="sans-serif"
                            style={{ pointerEvents: 'none' }}>{fmtBar(v)}</text>
                        )}
                      </g>
                    );
                  })}
                  <text x={gx + groupInner / 2} y={baseline + 18} textAnchor="middle" fontSize="11"
                    fill="var(--color-muted, #94A3B8)" fontFamily="sans-serif">{r.year}</text>
                </g>
              );
            })}
          </svg>
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

  // One tab per chart: a name plus a small icon, same style as the stat
  // card chips. The bar chart has no title field, so we name it here.
 const labels = (charts || []).map((c) => {
  if (c.type === 'bar') return { name: 'By Year' };
  if (c.title === 'Business Income') return { name: 'Business Income' };
  if (c.title === 'Personal Income') return { name: 'Personal Income' };
  if (c.title === 'Deductible Expenses') return { name: 'Deductions' };
  return { name: 'Reliefs' };
});

  return (
    <CarouselShell
      label="Breakdown & Trends"
      slides={slides}
      slideLabels={labels}
      dotsUnderRight
    />
  );
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
  const [liveTotals, setLiveTotals] = useState(null);
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
      setLoading(true);
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
      console.log('SUMMARY KEYS', Object.keys(cy || {}).join(', '));
      const totals = cy?.totals;
      setLiveTotals(totals);
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

   
      const selfRelief = Number(totals?.individualSelfRelief) || 0;
      const q4Reliefs = (totals?.q4ReliefsBreakdown || [])
        .reduce((s, b) => s + (b.cappedTotal || 0), 0);
      const reliefsApplied = selfRelief + q4Reliefs;
      // TEMPORARY — remove after checking.
      console.log('DEDUCTIONS CHECK', {
        q3Deductions: totals?.q3Deductions,
        q3CapitalAllowance: totals?.q3CapitalAllowance,
        q3TotalDeductions: totals?.q3TotalDeductions,
      });
      //

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
        const incomeComponents = reconcileComponents(
          detailFromEntries(cy?.q1BusinessIncome), totals.totalIncome, 'Other income');
       // Deductions popover = running expenses + capital allowance, matching
        // how the backend composes q3TotalDeductions. The raw Q3 entries list
        // can contain capital documents (e.g. hire purchase) at face value,
        // which are NOT deductions — so we anchor on the two backend totals
        // and reconcile any residue honestly.
        const capitalAllowance = Number(totals.q3CapitalAllowance) || 0;
        const deductionComponents = reconcileComponents(
          [
            { label: 'Business expenses', amount: fmtRM(totals.q3Deductions || 0),
              raw: Number(totals.q3Deductions) || 0,
              count: 'Running costs from your uploaded receipts' },
            ...(capitalAllowance ? [{ label: 'Capital allowance',
              amount: fmtRM(capitalAllowance), raw: capitalAllowance,
              count: 'Yearly write-off on equipment — the purchase price itself is not deductible' }] : []),
          ],
          totals.q3TotalDeductions,
          'Other deductions',
        );

        setLiveStats([
        { label: 'Total Income', value: fmtRM(totals.totalIncome || 0),
            ...yoy(totals.totalIncome, priorTotals?.totalIncome, 'up'),
            detail: {
              formula: 'This consist of all the money earned this year and added together — from your business and anywhere else  (e.g., freelance work, investments, rental).',
              formula2: 'Business Income + Other Income = Total Income',
              components: incomeComponents,
              equation: equationFromComponents(incomeComponents, totals.totalIncome),
            } },

          { label: 'Total Deductions', value: fmtRM(totals.q3TotalDeductions || 0),
            ...yoy(totals.q3TotalDeductions, priorTotals?.q3TotalDeductions, 'up'),
            detail: {
              formula: 'Money you spent running your business, plus a yearly write-off on equipment you bought. LHDN lets you subtract both before your tax is worked out.',
              formula2: 'Business Expenses + Capital Allowance = Total Deductions',
              components: deductionComponents,
              equation: equationFromComponents(deductionComponents, totals.q3TotalDeductions),
            } },

          { label: 'Chargeable Income', value: fmtRM(totals.estimatedChargeableIncome || 0),
            ...yoy(totals.estimatedChargeableIncome, priorTotals?.estimatedChargeableIncome, 'down'),
            detail: {
              formula: 'This consist of the part of your money that actually gets taxed.',
              formula2: 'Total Income − Total Deductions − Reliefs = Chargeable Income',
              equation: fmtRM(totals.totalIncome || 0)
                + ' − ' + fmtRM(totals.q3TotalDeductions || 0)
                + ' − ' + fmtRM(reliefsApplied)
                + ' = ' + fmtRM(totals.estimatedChargeableIncome || 0),
              components: [
                { label: 'Total income', amount: fmtRM(totals.totalIncome || 0) },
                { label: 'Business costs', amount: '− ' + fmtRM(totals.q3TotalDeductions || 0) },
                { label: 'Self relief', amount: '− ' + fmtRM(selfRelief),
                  count: 'Automatic — every resident gets this' },
                { label: 'Other reliefs', amount: '− ' + fmtRM(q4Reliefs),
                  count: 'From your uploaded relief receipts' },
              ],
              note: 'The smaller this number, the less tax you pay. Uploading relief receipts (insurance, PRS, lifestyle purchases) makes it smaller.',
            } },

          { label: 'Est. Tax Payable', value: fmtRM(totals.estimatedTaxPayable || 0),
            ...yoy(totals.estimatedTaxPayable, priorTotals?.estimatedTaxPayable, 'down'),
            detail: {
              formula: 'Your chargeable income is split into slices, and each slice is taxed at its own rate — from 0% on the first RM5,000 up to 30% at the top. Rebates are then subtracted directly from the tax.',
              equation: (Number(totals.lowIncomeRebate) || Number(totals.zakatRebate))
                ? fmtRM(totals.taxChargedMyr || 0)
                  + (Number(totals.lowIncomeRebate) ? ' − ' + fmtRM(totals.lowIncomeRebate) : '')
                  + (Number(totals.zakatRebate) ? ' − ' + fmtRM(totals.zakatRebate) : '')
                  + ' = ' + fmtRM(totals.estimatedTaxPayable || 0)
                : null,
              components: [
                { label: 'Tax on your chargeable income', amount: fmtRM(totals.taxChargedMyr || 0),
                  count: 'Calculated slice by slice at LHDN rates' },
                ...(Number(totals.lowIncomeRebate) ? [{ label: 'Low income rebate',
                  amount: '− ' + fmtRM(totals.lowIncomeRebate),
                  count: 'For chargeable income of RM35,000 or less' }] : []),
                ...(Number(totals.zakatRebate) ? [{ label: 'Zakat paid',
                  amount: '− ' + fmtRM(totals.zakatRebate) }] : []),
                ...(Number(totals.cp500Paid) ? [{ label: 'Already prepaid via CP500',
                  amount: fmtRM(totals.cp500Paid),
                  count: 'Instalments paid — reduces what is left to settle, not the tax itself' }] : []),
              ],
              note: Number(totals.cp500Paid)
                ? 'After your CP500 prepayments, the balance left to settle is '
                  + fmtRM(totals.balancePayableMyr || 0) + '. This is an estimate, not your official filing.'
                : 'This is an estimate to help you plan, based on your documents so far. It is not your official tax filing.',
            } },
          

        ]);
      }
      
      // ── Pie charts: each page built from a different slice of the
      // document-derived totals, so they repopulate as the user uploads more.
      // NOTE: q1BusinessIncome / q3Deductions / etc. live under
      // `currentYear`, not on the summary root — only currentYear, priorYear,
      // yearlyTrend, and projection are top-level keys.
      setLivePieCharts([
        {
          type: 'bar',                             //for the "By Year" chart to be the landing page of the donut charts carousel
          years: summary?.yearlyTrend || [],
        },
        {
          title: 'Business Income',
          subtitle: `YA ${assessmentYear}`,
          segments: segmentsByCategory(cy?.q1BusinessIncome),
          footerLabel: 'Total Business Income',
          footerColor: '#0D9488',
          
        },
        {
          title: 'Personal Income',
          subtitle: `YA ${assessmentYear}`,
          segments: segmentsByCategory(cy?.q2PersonalIncome),
          footerLabel: 'Total Personal Income',
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
   <main className="min-h-[calc(100vh-4.1rem)] overflow-y-auto bg-background font-body flex flex-col">  {/* for page scrolling */}
      <div className="mx-auto w-full max-w-7xl px-6 py-3 flex flex-col flex-1 min-h-0 gap-4">
      {/* ── Header using dynamic backend account details ── */}
     <div className="shrink-0">
        <DashboardHeader
          greeting={timeOfDayGreeting()}
          name={liveAccount.name}
          entity={liveAccount.entity}
          msic={liveAccount.msic}
          assessmentYear={liveAccount.assessmentYear}
          deadlineNote={liveAccount.deadlineNote}
          onDeadlineClick={() => navigate(FORMS_TAB_ROUTE)}
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
        {/* for display to fit to screen size and not overly stretched */}
     {/* Stat cards (left) + Upcoming carousel (right) */}
        <div className="shrink-0 grid grid-cols-6 gap-3">
          <div className="col-span-4 h-full">
            <StatsGrid stats={liveStats} compact />
          </div>
          <div className="col-span-2 h-[190px]"> 
            <UpcomingCarousel
            deadlines={deadlinesFromInsights(Number(localStorage.getItem('activeEntityId')))}
            totals={liveTotals}
            onViewAll={() => navigate('/insightsinbox?filter=Deadlines')}
          />
          </div>
        </div>

       {/* ── Middle row: chart + opportunities, fixed height so it doesn't
              stretch and leave the bottom half usable ── */}
       <div className="grid grid-cols-3 gap-3 h-[220px] shrink-0">
          <div className="col-span-2 min-h-0">
            <PieChartsCarousel charts={livePieCharts} />
          </div>
          <div className="col-span-1 min-h-0">
<OpportunitiesCard opportunities={savingsFromInsights(Number(localStorage.getItem('activeEntityId')))} scrollable />
          </div>
        </div>
      </div>
    </main>
  );
}