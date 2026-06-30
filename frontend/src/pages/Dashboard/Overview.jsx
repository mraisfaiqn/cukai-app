// Dashboard — composes the dashboard from presentational components,
// feeding each its slice of data from dashboardData.js. The greeting is
// derived from the current hour here (the only render-time computation);
// every child stays stateless and prop-driven.
//
// Layout changes:
//  - TaxHealthCard removed from top row; DeadlinesCarousel takes its slot (right 2 cols).
//  - Bottom right col (was DeadlinesCard) now holds PieChartsCarousel.
//  - Both carousels use dot-navigation to page through items.

import React, { useState, useEffect } from 'react';
import { getPersonalDetails, getAllEntities, getFormBReport } from '../../services/api';
import { CURRENT_YEAR_OF_ASSESSMENT } from '../../constants';
// Keep your imports exactly as they are—they act as excellent fallback mock data!
import { stats as initialStats, account as initialAccount, piecharts as initialPieCharts, opportunities, deadlines, alert, piecharts } from '../../data/dashboardData';
import DashboardHeader from '../../components/Dashboard/DashboardHeader';
import ActionBanner from '../../components/Dashboard/ActionBanner';
import StatsGrid from '../../components/Dashboard/StatsGrid';
import OpportunitiesCard from '../../components/Dashboard/OpportunitiesCard';

// Time-of-day greeting — computed once at render, not stored in state.
function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ── Urgency helpers (mirrors DeadlinesCard logic) ──────────────────────────────
function urgencyFor(daysLeft) {
  if (daysLeft <= 7)  return { bar: 'bg-critical', pill: 'bg-critical-bg text-critical' };
  if (daysLeft <= 45) return { bar: 'bg-warning',  pill: 'bg-warning-bg text-warning' };
  return { bar: 'bg-border', pill: 'bg-primary-tint text-muted' };
}

// ── DeadlinesCarousel ──────────────────────────────────────────────────────────
// Shows one deadline at a time with dot-navigation. Compact enough for the
// right col of the KPI strip row (matches the old TaxHealthCard height).
function DeadlinesCarousel({ deadlines }) {
  const [idx, setIdx] = useState(0);
  if (!deadlines || deadlines.length === 0) return null;
  const d = deadlines[idx];
  const tone = urgencyFor(d.daysLeft);

  return (
    <section className="flex h-full flex-col justify-between rounded-xl border border-border bg-surface p-3">
      <p className="text-xs font-medium text-muted shrink-0">Upcoming Deadlines</p>

      {/* Single deadline item */}
      <div className="flex items-start gap-3 flex-1 py-2">
        <span className={'mt-0.5 h-9 w-1 shrink-0 rounded-full ' + tone.bar} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-headings truncate">{d.label}</p>
          <p className="mt-0.5 text-xs text-muted truncate">{d.sub}</p>
        </div>
        <span className={'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ' + tone.pill}>
          {d.daysLeft}d
        </span>
      </div>

      {/* Dot navigation */}
      <div className="flex items-center justify-center gap-1.5 shrink-0 pt-1">
        {deadlines.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={
              'h-1.5 rounded-full transition-all duration-200 ' +
              (i === idx ? 'w-4 bg-[#0D9488]' : 'w-1.5 bg-slate-300 hover:bg-slate-400')
            }
          />
        ))}
      </div>
    </section>
  );
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

// ── PieChartsCarousel ──────────────────────────────────────────────────────────
// Cycles through 3 donut charts (Business, Personal, Tax Summary) with dots.
// Fills the right col of the body grid — the space previously held by DeadlinesCard.
function PieChartsCarousel({ charts }) {
  const [idx, setIdx] = useState(0);
  const [hovered, setHovered] = useState(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const chart = charts[idx];

  const SIZE = 120;
  const CX = SIZE / 2, CY = SIZE / 2;
  const R = SIZE * 0.39, INNER = SIZE * 0.22;
  const { slices, total } = buildSlices(chart.segments, CX, CY, R, INNER);

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-surface p-4">
      {/* Tooltip portal */}
      {hovered && (
        <div
          className="fixed z-[9999] pointer-events-none rounded-lg border border-border bg-surface px-3 py-2 shadow-lg"
          style={{ left: Math.min(mouse.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 800) - 200), top: mouse.y - 12, width: 176 }}
        >
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: hovered.color }} />
            <span className="text-[10px] font-semibold text-headings leading-tight">{hovered.label}</span>
          </div>
          <p className="text-[10px] text-muted mt-1">{fmtRM(hovered.value)}</p>
          <p className="text-[10px] text-muted">{pct(hovered.value, total)} of total</p>
        </div>
      )}

      <p className="text-xs font-medium text-muted shrink-0 mb-2">Expense Breakdown</p>

      {/* Chart title */}
      <div className="text-center shrink-0 mb-2">
        <p className="text-xs font-semibold text-headings">{chart.title}</p>
        {chart.subtitle && <p className="text-[10px] text-muted mt-0.5">{chart.subtitle}</p>}
      </div>

      {/* Donut */}
      <div className="flex justify-center shrink-0">
        {total === 0 ? (
          <div style={{ width: SIZE, height: SIZE }} className="flex items-center justify-center rounded-full border-2 border-dashed border-border">
            <p className="text-[9px] text-muted text-center px-2">No data yet</p>
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
              <text x={CX} y={CY - 4} textAnchor="middle" fontSize={SIZE * 0.07} fill="var(--color-muted, #94A3B8)" fontFamily="sans-serif">total</text>
              <text x={CX} y={CY + 9} textAnchor="middle" fontSize={SIZE * 0.075} fill="var(--color-headings, #0F172A)" fontWeight="700" fontFamily="sans-serif">
                {fmtRM(total)}
              </text>
            </svg>
          </div>
        )}
      </div>

      {/* Legend — scrollable if many items */}
      <div className="mt-3 flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
        {slices.map(sl => (
          <div key={sl.label} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: sl.color }} />
              <span className="truncate text-[10px] text-muted">{sl.label}</span>
            </div>
            <span className="text-[10px] font-semibold text-headings shrink-0">{pct(sl.value, total)}</span>
          </div>
        ))}
      </div>

      {/* Footer total row */}
      {chart.footerLabel && (
        <div className="shrink-0 mt-2 border-t border-border pt-2 flex justify-between items-center">
          <span className="text-[10px] text-muted">{chart.footerLabel}</span>
          <span className="text-[10px] font-bold" style={{ color: chart.footerColor || 'inherit' }}>{fmtRM(total)}</span>
        </div>
      )}

      {/* Dot navigation */}
      <div className="flex items-center justify-center gap-1.5 shrink-0 pt-2">
        {charts.map((_, i) => (
          <button
            key={i}
            onClick={() => { setIdx(i); setHovered(null); }}
            className={
              'h-1.5 rounded-full transition-all duration-200 ' +
              (i === idx ? 'w-4 bg-[#0D9488]' : 'w-1.5 bg-slate-300 hover:bg-slate-400')
            }
          />
        ))}
      </div>
    </section>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────────
export default function Overview() {
  // 1. Establish state variables using the static data as default placeholders
  const [liveAccount, setLiveAccount] = useState(initialAccount);
  const [liveStats, setLiveStats] = useState(initialStats);
  const [livePieCharts, setLivePieCharts] = useState(initialPieCharts);
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

      // Fetch person details and the user's full entity list in parallel.
      const [person, entities] = await Promise.all([
        getPersonalDetails(userId),
        getAllEntities(userId).catch(() => []),
      ]);

      // Same backend figure the Generate Report tab's "Total expenditure"
      // (Part N25) comes from — FormBCalculation.total_business_deductions,
      // recomputed automatically from this person's classified documents.
      // Falls back to null if nothing has been classified for this YA yet.
      const formBReport = await getFormBReport(userId, CURRENT_YEAR_OF_ASSESSMENT).catch(() => null);

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

      if (activeEntity) {
        // Same backend figure the Generate Report tab's "Sales/turnover"
        // (Part N3) comes from — FormBCalculation.total_business_income,
        // recomputed automatically from this person's classified documents.
        // Falls back to the entity's manually entered field only if no
        // documents have been classified for this YA yet.
        const turnover  = formBReport ? Number(formBReport.totalBusinessIncome) || 0
                                       : (parseFloat(activeEntity.salesTurnover) || 0);
        // Prefer the backend-computed figure (same source as Generate Report)
        // so the two pages never disagree; fall back to the entity's manually
        // entered field only if no documents have been classified yet.
        const expenses  = formBReport ? Number(formBReport.totalBusinessDeductions) || 0
                                       : (parseFloat(activeEntity.totalExpenditure) || 0);
        // Same logic as turnover/expenses: once a Form B calculation exists,
        // derive net profit from the SAME live figures shown above so the
        // card never disagrees with its own turnover/expenses rows.
        // Only fall back to the entity's manually entered net profit field
        // when there's no live data yet — and use a proper null/undefined
        // check (not `||`) so a genuine value of 0 isn't discarded.
        const manualNetProfit = activeEntity.netProfitLoss !== null
                              && activeEntity.netProfitLoss !== undefined
                              && activeEntity.netProfitLoss !== ''
                                 ? parseFloat(activeEntity.netProfitLoss)
                                 : null;
        const netProfit = formBReport
          ? (turnover - expenses)
          : (manualNetProfit !== null ? manualNetProfit : (turnover - expenses));
        // Same backend figure Generate Report's B28 "Total Tax Charged" comes
        // from — FormBCalculation.tax_payable, computed from the full
        // progressive bracket schedule against chargeable income (after
        // personal reliefs and individual/zakat rebates), not just net
        // business profit. Falls back to the old flat-rate approximation
        // only if no documents have been classified for this YA yet.
        const estimatedTax = formBReport
          ? (Number(formBReport.taxPayable) || 0)
          : (netProfit > 5000 ? netProfit * 0.03 : 0);

        setLiveStats([
          { label: 'Sales Turnover',    value: `RM ${turnover.toLocaleString()}`,    change: 'Live Sync',  trend: 'up' },
          { label: 'Total Expenditure', value: `RM ${expenses.toLocaleString()}`,    change: 'Live Sync',  trend: 'down' },
          { label: 'Net Profit / Loss', value: `RM ${netProfit.toLocaleString()}`,   change: 'Calculated', trend: netProfit >= 0 ? 'up' : 'down' },
          { label: 'Est. Tax Payable',  value: `RM ${estimatedTax.toLocaleString()}`, change: 'Formulaic',  trend: 'neutral' },
        ]);

        setLiveAccount({
          name:           person?.fullName || 'Taxpayer',
          entity:         activeEntity.name || 'My Business',
          msic:           activeEntity.businessCode ? `MSIC ${activeEntity.businessCode}` : 'No MSIC Set',
          assessmentYear: 'YA 2026',
          deadlineNote:   'Form B Sync Active',
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
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body">
      <div className="flex h-full w-full flex-col gap-3 p-3">
      {/* ── Header using dynamic backend account details ── */}
      <DashboardHeader
        greeting={timeOfDayGreeting()}
        name={liveAccount.name}
        entity={liveAccount.entity}
        msic={liveAccount.msic}
        assessmentYear={liveAccount.assessmentYear}
        deadlineNote={liveAccount.deadlineNote}
      />

      <ActionBanner
        title={alert.title}
        message={alert.message}
        actionLabel={alert.actionLabel}
        compact
      />

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
            <PieChartsCarousel charts={piecharts} />
          </div>
          <div className="col-span-1 min-h-0">
            <OpportunitiesCard opportunities={opportunities} scrollable />
          </div>
        </div>

      </div>
    </main>
  );
}