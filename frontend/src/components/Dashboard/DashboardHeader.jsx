// DashboardHeader — the greeting block + entity context line at the top
// of the dashboard (below the global nav). Presentational only: the parent
// computes the time-of-day greeting and supplies the entity facts as props.
// Matches the "Good morning, Hafiz" header in Main_Dashboard_-_Cukai_AI.png.

const CalendarIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

function DashboardHeader({
  greeting,        // time-of-day phrase, e.g. "Good morning".
                   //   Computed by the parent (clock = state) and passed in, so this component stays stateless.
  name,            // user's first name, e.g. "Hafiz" — personalizes the headline.
  entity,          // active company, e.g. "Qafiz Printing & Design" — first item in the meta line.
  msic,            // industry classification code, e.g. "MSIC 1811" — shown as plain meta text.
  assessmentYear,  // year of assessment, e.g. "YA 2025" — rendered as a pill chip to stand out.
  deadlineNote,    // headline deadline reminder, e.g. "142 days to Form C".
}) {
  return (
    <header>
      {/* Greeting headline */}
      <h1 className="font-headings text-3xl font-bold tracking-tight text-headings">
        {greeting}, {name}
      </h1>

      {/* Entity context line: company · MSIC · [YA chip] · deadline */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span className="font-medium text-body-text">{entity}</span>
        <span aria-hidden="true">·</span>
        <span>{msic}</span>
        <span aria-hidden="true">·</span>

        {/* Assessment-year chip — pill-shaped per the design system's chip spec */}
        <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-semibold text-primary">
          {assessmentYear}
        </span>
        <span aria-hidden="true">·</span>

        {/* Deadline reminder — teal to read as a gentle call to action */}
        <span className="flex items-center gap-1.5 font-medium text-primary">
          <CalendarIcon />
          {deadlineNote}
        </span>
      </div>
    </header>
  );
}

export default DashboardHeader;