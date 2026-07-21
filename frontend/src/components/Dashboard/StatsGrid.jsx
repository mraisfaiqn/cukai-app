// StatsGrid — the top KPI strip. Takes the `stats` array and maps each
// entry onto a <StatCard />. Presentational/derivation only, no state.
// Matches the four-up strip in Main_Dashboard_-_Cukai_AI.png.
// `compact` prop tightens the grid for the no-scroll viewport layout —
// cards shrink their internal padding/font via a prop passed to StatCard.
import StatCard from './StatCard';
import { TbCash, TbCalculator, TbCoin, TbBuildingBank } from 'react-icons/tb';
// Icon chip per known metric, mirroring the design mock. Unknown labels
// (skeleton cards, fallback figures) simply get no chip.
const CARD_ICONS = {
  'Total Income':      { icon: <TbCash className="h-5 w-5" />,           tint: 'bg-teal-50 text-teal-600' },
  'Total Deductions':  { icon: <TbCalculator className="h-5 w-5" />,     tint: 'bg-blue-50 text-blue-600' },
  'Chargeable Income': { icon: <TbCoin className="h-5 w-5" />, tint: 'bg-purple-50 text-purple-600' },
  'Est. Tax Payable':  { icon: <TbBuildingBank className="h-5 w-5" />,       tint: 'bg-amber-50 text-amber-600' },
};
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

const MinusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

function iconForTrend(trend) {
  if (trend === 'up')   return <ArrowUp />;
  if (trend === 'down') return <ArrowDown />;
  return <MinusIcon />; // flat / no prior year to compare against
}

// Derive the card's presentational flags. When the data layer supplies an
// explicit YoY `trend` ('up'|'down'|'flat') and `tone`, those win — the arrow
// reflects the actual direction of movement and the colour reflects whether
// that movement is favourable for the metric (e.g. tax going UP is a red up
// arrow, not green). Otherwise fall back to inferring from the change string
// (used by the entity-figures fallback cards and the opportunities highlight).
function presentationFor(stat) {
  if (stat.trend) {
    return { icon: iconForTrend(stat.trend), changeTone: stat.tone || 'muted', highlight: false };
  }
  const change = stat.change || '';
  if (change.startsWith('+RM')) return { icon: <ArrowUp />, changeTone: 'success' };
  if (change.startsWith('-RM')) return { icon: <ArrowDown />, changeTone: 'success' };
  if (change.includes('opportunities')) return { icon: <SearchIcon />, changeTone: 'muted', highlight: true };
  return { icon: <ReceiptIcon />, changeTone: 'muted' };
}

function StatsGrid({ stats, compact = false }) {
  // `stats` is the array of { label, value, change }; one card per entry.
  return (
    // Always 3-up here since TaxHealthCard occupies the 4th column in the parent grid.
    //for the 4 tabs edit - Total Income, Total Deductions, Chargeable Income, Est. Tax Payable
    <section className="grid grid-cols-4 gap-3">
      {stats.map((stat) => {
        const { icon, changeTone, highlight } = presentationFor(stat);
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
            detail={stat.detail}
            icon={CARD_ICONS[stat.label]?.icon}
            iconTint={CARD_ICONS[stat.label]?.tint}
          />
        );
      })}
    </section>
  );
}

export default StatsGrid;