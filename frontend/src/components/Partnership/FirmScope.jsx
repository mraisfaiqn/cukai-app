// FirmScope — the SHARED "Our Firm" view (Form P layer).
// Visible to every member of the partnership. It shows the firm P&L down to
// divisible income, then the allocation table (how the pie is split). It NEVER
// shows any partner's personal reliefs or final tax — that lives in Form B.
// Presentational only: all data arrives as props from PartnershipOverview.

// A small lock glyph used to signal "this is private to that partner".
const LockIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

// One line in the firm P&L waterfall. `tone` colours the figure:
// 'deduct' reads as a subtraction, 'total' is the bold divisible-income result.
function PnlRow({ label, value, note, tone = 'plain' }) {
  const valueColor =
    tone === 'total' ? 'text-headings' : tone === 'deduct' ? 'text-body-text' : 'text-headings';
  return (
    <div className={'flex items-baseline justify-between py-2.5 ' + (tone === 'total' ? 'border-t border-border pt-3' : '')}>
      <div>
        <span className={'text-sm ' + (tone === 'total' ? 'font-semibold text-headings' : 'text-body-text')}>
          {tone === 'deduct' ? '− ' : ''}{label}
        </span>
        {note && <span className="ml-2 text-xs text-muted">{note}</span>}
      </div>
      <span className={'font-headings text-sm font-semibold tabular-nums ' + (tone === 'total' ? 'text-lg text-primary' : valueColor)}>
        {value}
      </span>
    </div>
  );
}

function FirmScope({ firm, allocation, currentTaxpayerId }) {
  return (
    <div className="space-y-6">

      {/* Firm P&L → divisible income */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-headings text-lg font-semibold text-primary">Firm Profit &amp; Loss</h2>
          <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-semibold text-primary">
            Feeds Form P
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          The partnership pays no tax itself — this works out the profit and how it is divided.
        </p>

        <div className="mt-4 divide-y divide-border">
          <PnlRow label="Revenue" value={firm.revenue} />
          <PnlRow label="Shared expenses" value={firm.sharedExpenses} tone="deduct" />
          <PnlRow label="Capital allowances" value={firm.capitalAllowances} tone="deduct" />
          <PnlRow label="Divisible income" value={firm.divisibleIncome} tone="total" />
        </div>
      </section>

      {/* Allocation table — the Form P split */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="font-headings text-lg font-semibold text-primary">Profit Allocation</h2>
        <p className="mt-1 text-sm text-muted">
          Partner salaries are an <span className="font-medium text-body-text">appropriation</span>, not a firm
          expense — they’re allocated first, then the remainder is split by profit-share.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-4 font-medium">Partner</th>
                <th className="py-2 pr-4 font-medium">Share</th>
                <th className="py-2 pr-4 font-medium text-right">Salary</th>
                <th className="py-2 pr-4 font-medium text-right">Profit share</th>
                <th className="py-2 pr-4 font-medium text-right">Total allocated</th>
                <th className="py-2 font-medium text-right">Personal tax</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allocation.map((p) => {
                const isYou = p.taxpayerId === currentTaxpayerId;
                return (
                  <tr key={p.taxpayerId} className={isYou ? 'bg-primary-tint/40' : ''}>
                    <td className="py-3 pr-4">
                      <span className="font-medium text-headings">{p.name}</span>
                      {isYou && (
                        <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-surface">
                          You
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-body-text tabular-nums">{p.sharePct}</td>
                    <td className="py-3 pr-4 text-right text-body-text tabular-nums">{p.salary}</td>
                    <td className="py-3 pr-4 text-right text-body-text tabular-nums">{p.profitShare}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-headings tabular-nums">{p.total}</td>
                    <td className="py-3 text-right">
                      {/* The boundary made visible: you see your own onward picture,
                          but every co-partner's Form B is locked away. */}
                      {isYou ? (
                        <span className="text-xs font-medium text-primary">View in “My Tax” →</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted">
                          <LockIcon /> Private
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default FirmScope;
