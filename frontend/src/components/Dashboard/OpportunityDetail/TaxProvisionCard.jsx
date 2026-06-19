// TaxProvisionCard — left summary card: the tax provision + headline saving.
// Presentational only; every value arrives as a prop from OpportunityDetail.
// The teal right-edge bar mirrors the accent in the design mockup.
import SupportingDocumentsCard from './SupportingDocumentsCard';
import { opportunityDetails } from '../../../data/dashboardData';
import { useParams } from 'react-router-dom';

function TaxProvisionCard({
  status,
  provision,
  provisionNote,
  estSavings,
}) {
  const { id } = useParams();
  const detail = opportunityDetails[id];

  return (
    <section className="h-full rounded-xl border border-border border-r-4 border-r-primary bg-surface p-5 flex flex-col min-h-0">
      {/* Status row */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Tax Provision</span>
        {status && (
          <span className="rounded-full bg-critical-bg px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-critical">
            {status}
          </span>
        )}
      </div>

      {/* Provision title + note */}
      <h2 className="mt-3 font-headings text-lg font-bold text-headings shrink-0">{provision}</h2>
      <p className="mt-1.5 text-xs text-body-text shrink-0">{provisionNote}</p>

      <hr className="my-3 border-border shrink-0" />

      {/* Savings headline */}
      <div className="shrink-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Est. Savings</p>
        <p className="mt-0.5 font-headings text-2xl font-bold text-primary">{estSavings}</p>
      </div>

      <hr className="my-5 border-border shrink-0" />

      {/* Supporting Documents — flex-1 so it fills remaining height */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SupportingDocumentsCard matchingInvoice={detail.matchingInvoice} />
      </div>
    </section>
  );
}

export default TaxProvisionCard;