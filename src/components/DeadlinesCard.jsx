// DeadlinesCard — the "Upcoming Deadlines" panel. Takes the `deadlines`
// array and maps each onto a row whose urgency color is derived from
// daysLeft. Presentational only, no state. Matches Main_Dashboard_-_Cukai_AI.png.

// Map a day count to a traffic-light tier (critical → warning → neutral).
// <=7 days is critical (red), <=45 is warning (amber), beyond that is calm/neutral.
function urgencyFor(daysLeft) {
  if (daysLeft <= 7) return { bar: 'bg-critical', pill: 'bg-critical-bg text-critical' };
  if (daysLeft <= 45) return { bar: 'bg-warning', pill: 'bg-warning-bg text-warning' };
  return { bar: 'bg-border', pill: 'bg-primary-tint text-muted' };
}

function DeadlinesCard({ deadlines }) {
  // `deadlines` is the array of { label, sub, daysLeft }; one row each.
  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="font-headings text-lg font-semibold text-headings">
        Upcoming Deadlines
      </h2>

      <div className="mt-4 space-y-5">
        {deadlines.map((d) => {
          const tone = urgencyFor(d.daysLeft);
          return (
            // key = d.label: each deadline label ("PCB Nov", "SST Return", …) is unique
            // and stable, so React reuses each row's DOM node across re-renders rather
            // than tearing the list down. The array has no id field, making the label
            // the natural stable key; the array index would be unsafe under reordering.
            <div key={d.label} className="flex items-start gap-3">
              {/* Urgency bar */}
              <span className={'mt-0.5 h-10 w-1 shrink-0 rounded-full ' + tone.bar} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-headings">{d.label}</p>
                <p className="mt-0.5 text-xs text-muted">{d.sub}</p>
              </div>
              {/* Days-left pill, colored by the same tier */}
              <span className={'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ' + tone.pill}>
                {d.daysLeft} days
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default DeadlinesCard;
