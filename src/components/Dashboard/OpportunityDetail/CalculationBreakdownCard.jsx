// CalculationBreakdownCard — itemized allowance maths. Presentational only.
// Takes the whole `calculation` object and lays out its rows top-to-bottom.

// One label/amount line. `note` is an optional uppercase sub-label; `amountClass`
// lets the parent color the figure (headings vs success-green).
function Line({ label, note, amount, amountClass = 'text-headings' }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div>
        <p className="text-sm font-medium text-headings">{label}</p>
        {note && <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted">{note}</p>}
      </div>
      <p className={'shrink-0 text-sm font-semibold ' + amountClass}>{amount}</p>
    </div>
  );
}

function CalculationBreakdownCard({ calculation }) {
  const { assetCost, initialAllowance, annualAllowance, totalClaimable, projectedTaxReduction } = calculation;

  return (
    <section className="h-full rounded-xl border border-border bg-surface p-6">
      <h2 className="font-headings text-lg font-semibold text-headings">Calculation Breakdown</h2>

      <div className="mt-2 divide-y divide-border">
        <Line label="Asset Cost (Machine)" amount={assetCost} />
        <Line
          label={`Initial Allowance (${initialAllowance.rate})`}
          note={initialAllowance.note}
          amount={initialAllowance.amount}
          amountClass="text-success"
        />
        <Line
          label={`Annual Allowance (${annualAllowance.rate})`}
          note={annualAllowance.note}
          amount={annualAllowance.amount}
          amountClass="text-success"
        />
      </div>

      {/* Total — emphasized with a tinted band */}
      <div className="mt-3 flex items-center justify-between rounded-lg bg-primary-tint px-4 py-3">
        <p className="text-sm font-semibold text-headings">Total Claimable Allowance</p>
        <p className="font-headings text-lg font-bold text-headings">{totalClaimable}</p>
      </div>

      {/* Resulting tax reduction */}
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm text-muted">Projected Tax Reduction (at {projectedTaxReduction.rate} rate)</p>
        <p className="text-sm font-bold text-success">{projectedTaxReduction.amount}</p>
      </div>
    </section>
  );
}

export default CalculationBreakdownCard;
