// OpportunityRow — a single line in the Unclaimed Savings list.
// Presentational only: title / provision / amount come in as props.
// Matches the rows in Main_Dashboard_-_Cukai_AI.png.

// Default leading glyph (a tag) used when the parent doesn't supply a specific icon.
const TagIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

function OpportunityRow({
  title,     // headline of the opportunity, e.g. "Capital allowance (RM45k cutting machine)".
  provision, // the legal basis cited, e.g. "Sch. 3 ITA" — shown as a muted sub-line for transparency.
  amount,    // estimated saving, e.g. "+RM 8,160" — success-green to read as money gained.
  icon,      // optional leading glyph; falls back to TagIcon so the row is self-sufficient.
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="flex items-start gap-3">
        {/* Icon chip — teal-tinted square per the design's chip language */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
          {icon ?? <TagIcon />}
        </span>
        <div>
          <p className="text-sm font-medium text-headings">{title}</p>
          <p className="mt-0.5 text-xs text-muted">{provision}</p>
        </div>
      </div>
      {/* Saving amount */}
      <p className="shrink-0 text-sm font-semibold text-success">{amount}</p>
    </div>
  );
}

export default OpportunityRow;
