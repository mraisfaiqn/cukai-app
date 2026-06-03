// Dashboard — composes the dashboard from presentational components,
// feeding each its slice of data from dashboardData.js. The greeting is
// derived from the current hour here (the only render-time computation);
// every child stays stateless and prop-driven.
import { stats, opportunities, deadlines, account, alert, healthScores } from '../data/dashboardData';
import DashboardHeader from '../components/DashboardHeader';
import ActionBanner from '../components/ActionBanner';
import StatsGrid from '../components/StatsGrid';
import OpportunitiesCard from '../components/OpportunitiesCard';
import QuickActions from '../components/QuickActions';
import TaxHealthCard from '../components/TaxHealthCard';
import DeadlinesCard from '../components/DeadlinesCard';

// Time-of-day greeting — computed once at render, not stored in state.
function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Dashboard() {
  return (
    <main className="min-h-screen bg-background font-body">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">

        {/* Greeting + entity context */}
        <DashboardHeader
          greeting={timeOfDayGreeting()}
          name={account.name}
          entity={account.entity}
          msic={account.msic}
          assessmentYear={account.assessmentYear}
          deadlineNote={account.deadlineNote}
        />

        {/* "Action Required" alert */}
        <ActionBanner
          title={alert.title}
          message={alert.message}
          actionLabel={alert.actionLabel}
        />

        {/* KPI strip */}
        <StatsGrid stats={stats} />

        {/* Two-column body */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

          {/* Left column (wider) */}
          <div className="space-y-6 lg:col-span-2">
            <OpportunitiesCard opportunities={opportunities} />
            <QuickActions />
          </div>

          {/* Right column (narrower) */}
          <div className="space-y-6">
            <TaxHealthCard scores={healthScores} />
            <DeadlinesCard deadlines={deadlines} />
          </div>

        </div>

      </div>
    </main>
  );
}

export default Dashboard;
