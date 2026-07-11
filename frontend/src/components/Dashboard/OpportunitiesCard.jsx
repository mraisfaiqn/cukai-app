// OpportunitiesCard — the "Unclaimed Savings Opportunities" panel.
// Takes the `opportunities` array and maps each onto an <OpportunityRow />.
// Presentational only, no state.
// Presentational only, no state. Matches Main_Dashboard_-_Cukai_AI.png.
// `scrollable` prop: when true the list area overflows-y-auto so the card
// fills its parent height without causing the page to scroll.
import OpportunityRow from './OpportunityRow';

const ArrowRight = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

function OpportunitiesCard({ opportunities, scrollable = false }) {
  return (
    // h-full so the card expands to fill whatever height the parent grid cell gives it.
    <section className="flex h-full flex-col rounded-xl border border-border bg-surface p-4">
      {/* Card header — shrink-0 so it never gets squeezed */}
      <div className="flex shrink-0 items-center justify-between">
        <h2 className="font-headings text-sm font-bold text-headings">
          Unclaimed Savings Opportunities
        </h2>
        <a href="#" className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover">
          View all
          <ArrowRight />
        </a>
      </div>

      {/* Scrollable rows area */}
      {/* Rows — divide-y draws the hairlines between them */}
      <div
        className={
          'mt-2 divide-y divide-border ' +
          (scrollable ? 'min-h-0 flex-1 overflow-y-auto px-1' : '')
        }
      >
        {opportunities.map((opp) => (
          // key = opp.id: the data carries a stable, unique id ("capital-allowance", …),
          // which is the ideal key. It lets React track each row to its underlying record
          // even if the list is reordered or filtered, preserving DOM/state and avoiding
          // mis-paired updates. Using the array index instead would break on reorder.
          <OpportunityRow
            key={opp.id}
            id={opp.id}
            title={opp.title}
            provision={opp.provision}
            amount={opp.amount}
          />
        ))}
      </div>
    </section>
  );
}

export default OpportunitiesCard;