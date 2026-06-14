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
import SupportingDocumentsCard from '../../components/Dashboard/OpportunityDetail/SupportingDocumentsCard';

const BotIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 4v4M9 14h.01M15 14h.01" />
  </svg>
);

function OpportunityDetail() {
  // 1) Read the dynamic URL segment defined by the "/opportunities/:id" route.
  const { id } = useParams();
  // 2) Use that id as the key into the detail lookup table in dashboardData.js.
  const detail = opportunityDetails[id];

  // Scroll back to the top whenever the opportunity changes. React Router reuses
  // this same component instance when navigating between /opportunities/:id
  // values, so the browser keeps the previous scroll position unless we reset it.
  // Depending on [id] re-runs the effect on every id change (and on first mount).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  return (
    <div className="min-h-screen bg-background font-body">
      {/* Guard: an id with no matching record (e.g. an opportunity we haven't
          authored detail data for yet) shows a friendly fallback instead of crashing. */}
      {!detail ? (
        <div className="mx-auto max-w-7xl px-6 py-16 text-center">
          <h1 className="font-headings text-2xl font-bold text-headings">Opportunity not found</h1>
          <p className="mt-2 text-sm text-muted">No details available for &ldquo;{id}&rdquo;.</p>
          <Link to="/overview" className="mt-4 inline-block text-sm font-medium text-primary hover:text-primary-hover">
            ← Back to Dashboard
          </Link>
        </div>
      ) : (
        <>
          {/* Breadcrumb strip */}
          <div className="border-b border-border bg-surface">
            <nav className="mx-auto flex max-w-7xl items-center gap-2 px-6 py-3 text-sm">
              <Link to="/overview" className="font-medium text-muted transition-colors hover:text-primary">
                Dashboard
              </Link>
              <span className="text-muted" aria-hidden="true">›</span>
              <span className="truncate font-medium text-headings">{detail.title}</span>
            </nav>
          </div>

          <main className="mx-auto max-w-7xl px-6 py-8">
            {/* Page title + actions */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="font-headings text-2xl font-bold text-headings">{detail.title}</h1>
                <p className="mt-1 text-sm text-muted">{detail.subtitle}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary-tint"
                >
                  <BotIcon />
                  Ask CukaiBot
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
                >
                  Apply to Tax Profile
                </button>
              </div>
            </div>

            {/* Asymmetric 3-col grid:
                Row 1 → ProvisionCard (1) + WhyYouQualify (2)
                Row 2 → CalculationBreakdown (2) + SupportingDocuments (1) */}
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <TaxProvisionCard
                  status={detail.status}
                  provision={detail.provision}
                  provisionNote={detail.provisionNote}
                  estSavings={detail.estSavings}
                />
              </div>
              <div className="lg:col-span-2">
                <WhyYouQualifyCard
                  paragraphs={detail.whyYouQualify}
                  reference={detail.legalReference.ruling}
                />
              </div>
              <div className="lg:col-span-2">
                <CalculationBreakdownCard calculation={detail.calculation} />
              </div>
              <div className="lg:col-span-1">
                <SupportingDocumentsCard matchingInvoice={detail.matchingInvoice} />
              </div>
            </div>

            {/* Trust footer */}
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
              <span>Bank-grade Encryption</span>
              <span>Audit Trail Active</span>
              <span>Updated {detail.legalReference.act.includes('1967') ? 'ITA 1967 (2024 Edition)' : detail.legalReference.act}</span>
            </div>

            <Link
              to="/overview"
              className="mt-6 inline-flex rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-headings transition-colors hover:bg-primary-tint"
            >
              Back to Overview
            </Link>
          </main>
        </>
      )}
    </div>
  );
}

export default OpportunityDetail;
