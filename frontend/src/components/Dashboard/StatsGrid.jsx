// StatsGrid — the top KPI strip. Takes the `stats` array and maps each
// entry onto a <StatCard />. Presentational/derivation only, no state.
// Matches the four-up strip in Main_Dashboard_-_Cukai_AI.png.
// `compact` prop tightens the grid for the no-scroll viewport layout —
// cards shrink their internal padding/font via a prop passed to StatCard.
import StatCard from './StatCard';

const ArrowUp = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const ArrowDown = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="7" y1="7" x2="17" y2="17" />
    <polyline points="17 7 17 17 7 17" />
  </svg>
);

const ReceiptIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
    <line x1="8" y1="8" x2="16" y2="8" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

// Derive the card's presentational flags from the change string, so the data
// layer stays free of styling concerns and StatCard stays purely visual.
function presentationFor(change) {
  if (change.startsWith('+RM')) return { icon: <ArrowUp />, changeTone: 'success' };
  if (change.startsWith('-RM')) return { icon: <ArrowDown />, changeTone: 'success' };
  if (change.includes('opportunities')) return { icon: <SearchIcon />, changeTone: 'muted', highlight: true };
  return { icon: <ReceiptIcon />, changeTone: 'muted' };
}

function StatsGrid({ stats, compact = false }) {
  // `stats` is the array of { label, value, change }; one card per entry.
  return (
    // Always 3-up here since TaxHealthCard occupies the 4th column in the parent grid.
    <section className="grid h-full grid-cols-4 gap-3">
      {stats.map((stat) => {
        const { icon, changeTone, highlight } = presentationFor(stat.change);
        return (
          // key = stat.label: each label ("YTD Income", …) is unique, so React can
          // match each card to its data across re-renders and reorder/patch in place
          // instead of rebuilding the whole list. No stable id exists on stats, so
          // the label is the natural stable identifier here.
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            change={stat.change}
            changeIcon={icon}
            changeTone={changeTone}
            highlight={highlight}
            compact={compact}
          />
        );
      })}
    </section>
  );
}

export default StatsGrid;