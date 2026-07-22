// OpportunitiesCard — the "Unclaimed Savings Opportunities" panel.
// Takes the `opportunities` array and maps each onto an <OpportunityRow />.
// Presentational only, no state.
// Presentational only, no state. Matches Main_Dashboard_-_Cukai_AI.png.
// `scrollable` prop: when true the list area overflows-y-auto so the card
// fills its parent height without causing the page to scroll.
import OpportunityRow from './OpportunityRow';
import { useNavigate } from 'react-router-dom';

function OpportunitiesCard({ opportunities, scrollable = false }) {
  const navigate = useNavigate();
  return (
    // h-full so the card expands to fill whatever height the parent grid cell gives it.
    // p-3 + shadow-md matches CarouselShell (Breakdown & Trends) exactly, so
    // the title baseline and separator line land at the same inset in both
    // cards when they sit side by side.
    <section className="flex h-full flex-col rounded-xl border border-border bg-surface p-3 shadow-md">
      {/* Card header — shrink-0 so it never gets squeezed */}
      <div className="flex shrink-0 items-center justify-between gap-4 mb-2 border-b border-border pb-2">
        <h2 className="font-headings text-sm font-bold text-headings">
          Saving Opportunities
        </h2>
        <button onClick={() => navigate('/insightsinbox')} className="text-xs font-medium text-primary hover:underline whitespace-nowrap">
          View all
        </button>
      </div>

      {/* Scrollable rows area */}
      {/* Rows — space-y since each row is now its own bordered card */}
      <div
        className={
          'space-y-2 ' +
          (scrollable ? 'min-h-0 flex-1 overflow-y-auto px-0.5' : '')
        }
      >
        {opportunities.length === 0 ? (
          <div className="flex h-full min-h-[140px] flex-col items-center justify-center px-4 py-6 text-center">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-background">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <p className="text-xs font-semibold text-headings">No data yet</p>
            <p className="mt-1 max-w-[220px] text-[11px] text-muted">
              No data to provide insights on yet — upload some documents to see savings opportunities here.
            </p>
          </div>
        ) : (
          opportunities.map((opp) => (
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
          ))
        )}
      </div>
    </section>
  );
}

export default OpportunitiesCard;