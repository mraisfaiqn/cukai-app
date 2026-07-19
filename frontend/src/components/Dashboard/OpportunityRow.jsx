// OpportunityRow — a single line in the Unclaimed Savings list.
// Presentational: title / provision / amount come in as props; the whole row
// is a link to that opportunity's detail page.
// Matches the rows in Main_Dashboard_-_Cukai_AI.png.
import { Link } from 'react-router-dom';

// Default leading glyph (a tag) used when the parent doesn't supply a specific icon.
const TagIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

function OpportunityRow({
  id,        // unique opportunity id, e.g. "capital-allowance" — builds the link target below.
  title,     // headline of the opportunity, e.g. "Capital allowance (RM45k cutting machine)".
  provision, // the legal basis cited, e.g. "Sch. 3 ITA" — shown as a muted sub-line for transparency.
  amount,    // estimated saving, e.g. "+RM 8,160" — success-green to read as money gained.
  icon,      // optional leading glyph; falls back to TagIcon so the row is self-sufficient.
}) {
  return (
    // <Link> is react-router's navigation element. It renders a normal <a> tag,
    // but instead of doing a full-page browser reload it updates the URL and lets
    // the router swap in the matching route — a fast, client-side transition.
    // `to` is the destination path; here we interpolate the id, so this row points
    // at "/opportunities/capital-allowance" etc. That path matches the
    // "/opportunities/:id" route in App.jsx, and the id we put in the URL is exactly
    // what useParams() reads back on the detail page.
    <div
      className="flex items-center justify-between gap-4 rounded-lg px-2 py-4"
    >
  
      <div className="flex items-start gap-3">
        {/* Icon chip — teal-tinted square per the design's chip language */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
          {icon ?? <TagIcon />}
        </span>
        <div>
          <p className="text-sm font-semibold text-headings">{title}</p>
          <p className="mt-0.5 text-xs text-muted">{provision}</p>
        </div>
      </div>
      {/* Saving amount */}
      <p className="shrink-0 text-sm font-semibold text-success">{amount}</p>
    </div>
  );
}

export default OpportunityRow;