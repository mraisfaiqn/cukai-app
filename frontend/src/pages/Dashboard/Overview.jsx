// Dashboard — composes the dashboard from presentational components,
// feeding each its slice of data from dashboardData.js. The greeting is
// derived from the current hour here (the only render-time computation);
// every child stays stateless and prop-driven.

import { stats, opportunities, deadlines, account, alert, healthScores } from '../../data/dashboardData';
import DashboardHeader from '../../components/Dashboard/DashboardHeader';
import ActionBanner from '../../components/Dashboard/ActionBanner';
import StatsGrid from '../../components/Dashboard/StatsGrid';
import OpportunitiesCard from '../../components/Dashboard/OpportunitiesCard';
import QuickActions from '../../components/Dashboard/QuickActions';
import TaxHealthCard from '../../components/Dashboard/TaxHealthCard';
import DeadlinesCard from '../../components/Dashboard/DeadlinesCard';

// Time-of-day greeting — computed once at render, not stored in state.
function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Overview() {
  return (
    // Outer shell: viewport-height minus nav (adjust 5rem to match your nav).
    // overflow-hidden here prevents any accidental body scroll.
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body">
      <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-4 mx-auto max-w-7xl">

        {/* ── Greeting + entity context (unchanged, full width) ── */}
        <DashboardHeader
          greeting={timeOfDayGreeting()}
          name={account.name}
          entity={account.entity}
          msic={account.msic}
          assessmentYear={account.assessmentYear}
          deadlineNote={account.deadlineNote}
        />

        {/* ── Action banner — compact, full width ── */}
        <ActionBanner
          title={alert.title}
          message={alert.message}
          actionLabel={alert.actionLabel}
          compact
        />

        {/* ── KPI strip + Tax Health in one 4-column row ──
              StatsGrid takes 3 cols, TaxHealthCard takes 1 col.
              Both are shrunk to the same visual weight. */}
        <div className="grid grid-cols-6 gap-3">
          {/* StatsGrid spans 3 cols */}
          <div className="col-span-4">
            <StatsGrid stats={stats} compact />
          </div>
          {/* TaxHealthCard in the 4th col, matching height */}
          <div className="col-span-2">
            <TaxHealthCard scores={healthScores} compact />
          </div>
        </div>

        {/* ── Body: 3-column grid, fills remaining height ──
              Col 1-2: Opportunities (scrollable) + QuickActions stacked
              Col 3:   Deadlines (scrollable) spanning full height */}
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">

          {/* Left 2 cols: stacked with flex-col */}
          
            {/* OpportunitiesCard grows to fill, scrolls internally */}
            <div className="col-span-2 flex-1 min-h-0 flex-1">
              <OpportunitiesCard opportunities={opportunities} scrollable />
            </div>
            
          

          {/* Right col: DeadlinesCard spans full height, scrolls internally */}
          <div className="col-span-1 flex min-h-0 flex-col gap-3">
            <div className="min-h-0 flex-1">
              <DeadlinesCard deadlines={deadlines} scrollable />
            </div>
            {/* QuickActions — fixed/natural height, sits at the bottom */}
            <div className="shrink-0">
              <QuickActions compact />
            </div>
          </div>

        </div>

      </div>
    </main>
  );
}

export default Overview;