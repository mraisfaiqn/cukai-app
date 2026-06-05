// TaxHealthCard — the "Your Tax Health" panel with two progress rings.
// Presentational only: the scores arrive as props. Matches the rings in
// Main_Dashboard_-_Cukai_AI.png (Health 78 teal, Literacy 42 violet).

// A single donut ring with the score centered. Stroke color comes from a
// Tailwind text-color class so this stays free of raw hex.
// `max` is the denominator the ring fills against (defaults to 100).
function Ring({ value, max = 100, color, track }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.min(Math.max(value / max, 0), 1); // clamp the fill to 0–100%
  const offset = circumference * (1 - ratio);          // how much of the ring stays "empty"

  return (
    <div className="relative h-28 w-28">
      {/* -rotate-90 makes the arc start at 12 o'clock instead of 3 o'clock */}
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        {/* Track ring (faint, full circle) */}
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="8" stroke="currentColor" className={track} />
        {/* Progress arc */}
        <circle
          cx="50" cy="50" r={radius} fill="none" strokeWidth="8" strokeLinecap="round"
          stroke="currentColor" className={color}
          strokeDasharray={circumference} strokeDashoffset={offset}
        />
      </svg>
      {/* Score sits on top, upright (outside the rotated svg).
          Show "value/max" for fraction scores (e.g. 7/9), else just the number. */}
      <span className="absolute inset-0 flex items-center justify-center font-headings text-2xl font-bold text-headings">
        {max === 100 ? value : `${value}/${max}`}
      </span>
    </div>
  );
}

function TaxHealthCard({
  scores, // array of { label, value, color, track } — one ring each.
          //   Kept as a prop array so the card maps over it like the other panels.
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <h2 className="font-headings text-lg font-semibold text-headings">Your Tax Health</h2>

      <div className="mt-4 flex items-center justify-around">
        {scores.map((s) => (
          // key = s.label: "Health" / "Literacy" are unique and stable, so React
          // keeps each ring paired with its score across re-renders.
          <div key={s.label} className="flex flex-col items-center gap-2">
            <Ring value={s.value} max={s.max} color={s.color} track={s.track} />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default TaxHealthCard;
