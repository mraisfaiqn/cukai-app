// ActionBanner — the amber "Action Required" alert strip on the dashboard.
// Presentational only: text and the click handler arrive via props, no state.
// Matches the warning banner in Main_Dashboard_-_Cukai_AI.png.

const WarningIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

function ActionBanner({
  title,         // bold lead-in, e.g. "Action Required" — names the kind of attention needed.
  message,       // explanatory sentence, e.g. why 3 receipts are blocked. Free string from the parent.
  actionLabel,   // text for the CTA button, e.g. "Review". A prop so the same banner can drive different actions.
  onAction,      // click handler for the button. Accepting a callback keeps the component presentational —
                 //   it reports the click upward; it doesn't decide what happens. Optional.
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-warning/30 bg-warning-bg px-5 py-4">
      {/* Icon + text */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-warning">
          <WarningIcon />
        </span>
        <div>
          <p className="text-sm font-semibold text-warning">{title}</p>
          <p className="mt-0.5 text-sm text-body-text">{message}</p>
        </div>
      </div>

      {/* CTA — amber to match the warning context, white label */}
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:opacity-90"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default ActionBanner;
