// OpportunityDetail — full detail page for one savings opportunity.
// The top nav (PageHeader) is supplied by the shared AppShell layout in App.jsx,
// like every other logged-in page — this component renders only the page body.
// Reads the :id from the URL, looks the record up in dashboardData, and hands
// each slice of it to a dedicated card.
import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { opportunityDetails } from '../../data/dashboardData';
import TaxProvisionCard from '../../components/Dashboard/OpportunityDetail/TaxProvisionCard';
import WhyYouQualifyCard from '../../components/Dashboard/OpportunityDetail/WhyYouQualifyCard';
import CalculationBreakdownCard from '../../components/Dashboard/OpportunityDetail/CalculationBreakdownCard';
import cukaiBot from '../../assets/cukaibot-icon.png';
const BotIcon = ({ className = 'h-4 w-4 object-contain' }) => (
  <img src={cukaiBot} alt="CukaiBot" className={className} />
);

function OpportunityDetail() {
  const { id } = useParams();
  const detail = opportunityDetails[id];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  return (
    // Match Overview's viewport-locked shell: full height minus navbar, no outer scroll
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body flex flex-col">
      {!detail ? (
        <div className="mx-auto max-w-7xl px-6 py-16 text-center">
          <h1 className="font-headings text-2xl font-bold text-headings">Opportunity not found</h1>
          <p className="mt-2 text-sm text-muted">No details available for &ldquo;{id}&rdquo;.</p>
          <Link to="/overview" className="mt-4 inline-block text-sm font-medium text-primary hover:text-primary-hover">
            ← Back to Dashboard
          </Link>
        </div>
      ) : (
        // flex-col so breadcrumb + main stack vertically and main can take remaining height
        <div className="flex flex-col flex-1 min-h-0">

          {/* Breadcrumb strip — unchanged */}
          <div className="border-b border-border bg-surface shrink-0">
            <nav className="mx-auto flex max-w-7xl items-center gap-2 px-6 py-3 text-sm">
              <Link to="/overview" className="font-medium text-muted transition-colors hover:text-primary">
                Dashboard
              </Link>
              <span className="text-muted" aria-hidden="true">›</span>
              <span className="truncate font-medium text-headings">{detail.title}</span>
            </nav>
          </div>

          {/* Content — fills remaining height, no overflow */}
          <div className="flex-1 min-h-0 flex flex-col mx-auto w-full max-w-7xl px-6 py-4 gap-3">

            {/* Page title + actions — unchanged */}
            <div className="flex flex-wrap items-start justify-between gap-4 shrink-0">
              <div>
                <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">{detail.title}</h1>
                <p className="mt-1 text-xs text-muted">{detail.subtitle}</p>
              </div>
              <div className="flex items-center gap-2 pr-[1.25rem]">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg border border-primary px-3 py-2 text-xs font-semibold text-primary transition-colors duration-150 hover:bg-primary hover:text-white"
                >
                  <BotIcon />
                  Ask CukaiBot
                </button>
                <Link
                  to="/overview"
                  className="rounded-lg bg-white border border-border px-3 py-2 text-xs font-semibold text-headings transition-colors duration-150 hover:bg-primary-tint"
                >
                  Back to Overview
                </Link>
              </div>
            </div>

            {/* Card grid — fills all remaining height. 3 cols, 2 rows.
                Col 1 (narrow): TaxProvisionCard spans both rows.
                Col 2-3 (wide): CalculationBreakdown top, WhyYouQualify bottom. */}
            <div className="flex-1 min-h-0 grid grid-cols-3 grid-rows-3 gap-2">

              {/* Left column: spans both rows */}
              <div className="col-start-1 col-span-1 row-start-1 row-span-3 min-h-0">
                <TaxProvisionCard
                  status={detail.status}
                  provision={detail.provision}
                  provisionNote={detail.provisionNote}
                  estSavings={detail.estSavings}
                />
              </div>

              {/* Top-right: Calculation Breakdown (only this scrolls internally) */}
              <div className="col-start-2 col-span-2 row-start-1 row-span-2 min-h-0">
                <CalculationBreakdownCard calculation={detail.calculation} />
              </div>

              {/* Bottom-right: Why You Qualify */}
              <div className="col-start-2 col-span-2 row-start-3 row-span-1 min-h-0">
                <WhyYouQualifyCard
                  paragraphs={detail.whyYouQualify}
                  reference={detail.legalReference.ruling}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default OpportunityDetail;