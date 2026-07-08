// StatCard — one KPI tile in the dashboard's top stats strip.
// Purely presentational: every value comes from props, no state, no fetching.
// Matches the four cards in Main_Dashboard_-_Cukai_AI.png.
// `compact` prop reduces padding and font sizes for the no-scroll layout.

function StatCard({
 label,                 // metric name shown above the number, e.g. "YTD Income".
                         //   Kept as a prop so one component renders all four cards from the stats array.
  value,                 // big preformatted number string, e.g. "RM 642,800".
                         //   Formatting lives in the data layer, not here — the card only displays it.
  change,                // secondary line under the value, e.g. "+RM 38,400" or "412 receipts".
                         //   Heterogeneous across cards (deltas vs counts), so it's a free string.
  changeIcon,            // optional React node rendered before `change` (trend arrow / receipt / search glyph).
                         //   Passed in so the card stays icon-agnostic and reusable.
  changeTone = 'muted',  // 'success' | 'muted' — colors the change line. Income/tax deltas read as success-green;
                         //   plain counts read as muted. Defaults to muted so a bare card looks neutral.
  highlight = false,     // when true, applies the teal-accent treatment of the "Unclaimed Savings" card
                         //   (left bar + tinted background + teal text). Lets the parent flag the lead metric
  compact = false,       // tighter padding + smaller value text for the no-scroll viewport layout
}) {
  const changeColor =
    changeTone === 'success' ? 'text-success'
    : changeTone === 'danger' ? 'text-critical'
    : 'text-muted';

  return (
    <div
      className={
        'flex h-full flex-col justify-between rounded-xl border ' +
        (compact ? 'p-3' : 'p-5') + ' ' +
        (highlight
          ? 'border-border border-l-4 border-l-primary bg-primary-tint'
          : 'border-border bg-surface')
      }
    >
      {/* Label — small, on the highlight card it picks up the teal tone */}
      <p className={'font-headings text-sm font' + (highlight ? 'text-primary' : 'text-muted')}>
        {label}
      </p>

      {/* Value — the headline figure, Plus Jakarta Sans via font-headings */}
      <p
        className={
          'font-headings font-bold tracking-tight ' +
          (compact ? 'mt-1 text-xl' : 'mt-2 text-3xl') + ' ' +
          (highlight ? 'text-primary' : 'text-headings')
        }
      >
        {value}
      </p>

      {/* Change line — icon + text, colored by tone */}
      {change && (
        <p
          className={
            'flex items-center gap-1 text-xs ' +
            (compact ? 'mt-1' : 'mt-2') + ' ' +
            (highlight ? 'text-primary' : changeColor)
          }
        >
          {changeIcon}
          {change}
        </p>
      )}
    </div>
  );
}

export default StatCard;