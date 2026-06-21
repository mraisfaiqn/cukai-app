// PersonalScope — the PRIVATE "My Tax" view (Form B layer).
// Only ever the logged-in partner's own picture: their firm share joins their
// own businesses + other income, then reliefs → chargeable income → tax, plus
// their CP500 instalments. No other partner can see this.
// Presentational only: all data arrives as props from PartnershipOverview.

// Status → chip styling for a CP500 instalment.
const instalmentChip = {
  paid: 'bg-success-bg text-success',
  due: 'bg-warning-bg text-warning',
  upcoming: 'bg-background text-muted',
};
const instalmentLabel = { paid: 'Paid', due: 'Due now', upcoming: 'Upcoming' };

// One step in the personal income → tax waterfall.
function WaterfallRow({ label, value, note, tone = 'plain' }) {
  return (
    <div className={'flex items-baseline justify-between py-2.5 ' + (tone === 'total' ? 'border-t border-border pt-3' : '')}>
      <div>
        <span className={'text-sm ' + (tone === 'total' ? 'font-semibold text-headings' : 'text-body-text')}>
          {tone === 'deduct' ? '− ' : ''}{label}
        </span>
        {note && <span className="ml-2 text-xs text-muted">{note}</span>}
      </div>
      <span className={'font-headings text-sm font-semibold tabular-nums ' + (tone === 'total' ? 'text-lg text-primary' : 'text-headings')}>
        {value}
      </span>
    </div>
  );
}

function PersonalScope({ personal, name }) {
  return (
    <div className="space-y-6">

      {/* Income → chargeable income → tax */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-headings text-lg font-semibold text-primary">{name}’s Tax Picture</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ai-highlight px-2.5 py-0.5 text-xs font-semibold text-warning">
            Private · Form B
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Your firm share joins your own income and reliefs here. Only you can see this.
        </p>

        <div className="mt-4 divide-y divide-border">
          <WaterfallRow label="Share from Meridian Print Studio" value={personal.shareFromFirm} note="from Form P" />
          {personal.ownBusinesses.map((b) => (
            <WaterfallRow key={b.name} label={b.name} value={b.amount} />
          ))}
          {personal.otherIncome.map((o) => (
            <WaterfallRow key={o.name} label={o.name} value={o.amount} />
          ))}
          <WaterfallRow label="Aggregate income" value={personal.aggregateIncome} tone="total" />
          <WaterfallRow label="Personal reliefs" value={personal.reliefs} tone="deduct" />
          <WaterfallRow label="Chargeable income" value={personal.chargeableIncome} tone="total" />
        </div>

        {/* Tax payable callout */}
        <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-primary-tint px-4 py-3">
          <span className="text-sm font-medium text-primary">Estimated tax payable</span>
          <span className="font-headings text-xl font-bold text-primary tabular-nums">{personal.taxPayable}</span>
        </div>
      </section>

      {/* CP500 instalments */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="font-headings text-lg font-semibold text-primary">CP500 Instalments</h2>
        <p className="mt-1 text-sm text-muted">
          Bi-monthly pre-payments toward your tax. The balance is settled when you file Form B.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {personal.instalments.map((it) => (
            <div key={it.period} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-headings">{it.period}</span>
                <span className={'rounded-full px-2 py-0.5 text-[10px] font-semibold ' + instalmentChip[it.status]}>
                  {instalmentLabel[it.status]}
                </span>
              </div>
              <p className="mt-1 text-sm text-body-text tabular-nums">{it.amount}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default PersonalScope;
