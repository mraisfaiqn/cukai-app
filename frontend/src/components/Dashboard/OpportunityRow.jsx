// OpportunityRow — a single line in the Saving Opportunities list.
// Presentational: title / provision / amount come in as props; the whole row
// is a link to that opportunity's detail page.
// Matches the rows in Main_Dashboard_-_Cukai_AI.png.
import { Link } from 'react-router-dom';

function OpportunityRow({
  id,        // unique opportunity id, e.g. "capital-allowance" — builds the link target below.
  title,     // headline of the opportunity, e.g. "Capital allowance (RM45k cutting machine)".
  provision, // the legal basis cited, e.g. "Sch. 3 ITA" — shown as a muted sub-line for transparency.
  amount,    // estimated saving, e.g. "+RM 8,160" — success-green to read as money gained.
}) {
  return (
    // <Link> is react-router's navigation element. It renders a normal <a> tag,
    // but instead of doing a full-page browser reload it updates the URL and lets
    // the router swap in the matching route — a fast, client-side transition.
    // `to` is the destination path; here we interpolate the id, so this row points
    // at "/opportunities/capital-allowance" etc. That path matches the
    // "/opportunities/:id" route in App.jsx, and the id we put in the URL is exactly
    // what useParams() reads back on the detail page.
    <Link
      to="/insightsinbox?filter=Savings"
      className="flex items-center justify-between gap-4 rounded-lg border border-border bg-[#F8FAFC] px-3 py-3 transition-colors hover:border-primary/40 hover:bg-primary-tint/50"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold leading-snug text-headings">{title}</p>
        <p className="mt-1 text-[11px] text-muted">{provision}</p>
      </div>
      {/* Saving amount */}
      <p className="shrink-0 text-base font-bold text-success">{amount}</p>
    </Link>
  );
}

export default OpportunityRow;