// TaxProvisionCard — left summary card: the tax provision + headline saving.
// Presentational only; every value arrives as a prop from OpportunityDetail.
// The teal right-edge bar mirrors the accent in the design mockup.

function TaxProvisionCard({
  status,        // e.g. "Action Required" — shown as a red pill chip (omitted if falsy).
  provision,     // e.g. "Capital Allowance (Sch. 3 ITA)" — the provision heading.
  provisionNote, // one-line eligibility blurb under the heading.
  estSavings,    // headline figure, e.g. "RM 8,160.00" — rendered in primary teal.
}) {
  return (
    <section className="h-full rounded-xl border border-border border-r-4 border-r-primary bg-surface p-6">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Tax Provision</span>
        {status && (
          <span className="rounded-full bg-critical-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-critical">
            {status}
          </span>
        )}
      </div>

      <h2 className="mt-4 font-headings text-xl font-bold text-headings">{provision}</h2>
      <p className="mt-2 text-sm text-body-text">{provisionNote}</p>

      <hr className="my-5 border-border" />

      <p className="text-xs font-medium uppercase tracking-wide text-muted">Est. Savings</p>
      <p className="mt-1 font-headings text-3xl font-bold text-primary">{estSavings}</p>
    </section>
  );
}

export default TaxProvisionCard;
