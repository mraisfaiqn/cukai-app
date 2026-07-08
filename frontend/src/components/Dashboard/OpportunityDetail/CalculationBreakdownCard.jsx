// CalculationBreakdownCard — itemized allowance maths. Presentational only.
// Takes the whole `calculation` object and lays out its rows top-to-bottom.
// The card is height-constrained by the grid; only the rows scroll internally.

function Line({ label, note, amount, amountClass = 'text-headings' }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div>
        <p className="text-sm font-medium text-headings">{label}</p>
        {note && <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">{note}</p>}
      </div>
      <p className={'shrink-0 text-sm font-semibold ' + amountClass}>{amount}</p>
    </div>
  );
}

function CalculationBreakdownCard({ calculation }) {
  const { assetCost, initialAllowance, annualAllowance, totalClaimable, projectedTaxReduction } = calculation;

  return (
    // h-full + flex-col so the scrollable middle expands to fill the grid cell
    <section className="h-full rounded-xl border border-border bg-surface p-4 flex flex-col min-h-0">
      
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-headings text-sm font-bold text-headings">Calculation Breakdown</h2>
        <button
          type="button"
          className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-primary-hover"
        >
          Apply to Tax Profile
        </button>
      </div>
      {/* Only this region scrolls when content overflows */}
      <div className="flex-1 min-h-0 text-xs overflow-y-auto divide-y divide-border mt-2 pr-1">
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
        {/* Totals — pinned to the bottom of the card, never scrolled away */}
        <div className="shrink-0 mt-3">
          <div className="flex items-center justify-between py-2.5">
            <p className="text-sm font-semibold text-headings">Total Claimable Allowance</p>
            <p className="font-headings text-sm font-bold text-headings bg-primary-tint">{totalClaimable}</p>
          </div>

          <div className="flex items-center justify-between py-2.5">
            <p className="text-sm text-muted">Projected Tax Reduction (at {projectedTaxReduction.rate} rate)</p>
            <p className="text-sm font-bold text-success">{projectedTaxReduction.amount}</p>
          </div>
        </div>
      </div>

      
    </section>
  );
}

export default CalculationBreakdownCard;