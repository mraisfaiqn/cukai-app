// OpportunitiesCard — the "Unclaimed Savings Opportunities" panel.
// Takes the `opportunities` array and maps each onto an <OpportunityRow />.
// Presentational only, no state. Matches Main_Dashboard_-_Cukai_AI.png.
import OpportunityRow from './OpportunityRow';

const ArrowRight = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

function OpportunitiesCard({ opportunities }) {
  // `opportunities` is the array of { id, title, provision, amount }; one row each.
  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      {/* Card header: title + "View all" link */}
      <div className="flex items-center justify-between">
        <h2 className="font-headings text-lg font-semibold text-headings">
          Unclaimed Savings Opportunities
        </h2>
        <a href="#" className="flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover">
          View all
          <ArrowRight />
        </a>
      </div>

      {/* Rows — divide-y draws the hairlines between them */}
      <div className="mt-2 divide-y divide-border">
        {opportunities.map((opp) => (
          // key = opp.id: the data carries a stable, unique id ("capital-allowance", …),
          // which is the ideal key. It lets React track each row to its underlying record
          // even if the list is reordered or filtered, preserving DOM/state and avoiding
          // mis-paired updates. Using the array index instead would break on reorder.
          <OpportunityRow
            key={opp.id}
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
