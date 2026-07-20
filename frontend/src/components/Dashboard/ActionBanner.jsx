// ActionBanner — the amber "Action Required" alert strip on the dashboard.
// Matches the warning banner in Main_Dashboard_-_Cukai_AI.png.
// `compact` prop reduces padding for the no-scroll viewport layout.
//
// Bug fix (found in review): the banner's count (pendingReviewCount) used to
// include several kinds of account-level reconciliation notes — a CP500
// notice with no matching payment receipt, a Breastfeeding-relief
// eligibility caveat, a Departure Levy lifetime-cap check, a One-Time-Relief
// unconfirmed-year gap, even a Joint Assessment PROFILE SETTING issue — none
// of which are tied to a real document. Clicking "Review" sent the user to
// CukaiAccount's document list, which can only ever show REAL documents'
// own needsReview flag — so a meaningful fraction of what the banner
// counted had nowhere to be found or resolved. The banner now takes the
// actual `items` array (mixedPendingReview from the backend) and expands
// inline to show each one's real reason/question, with the correct action
// per item — a document to open, or an upload/profile shortcut when
// there's no document at all.
import { useState, useRef, useEffect } from 'react';

const WarningIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ChevronIcon = ({ open }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// A document-linked item ("Q3 — Client & Corporate Gifts", a real receipt)
// needs a different action than an account-level note (CP500 reconciliation,
// a profile setting) — pick the right label + destination per item, rather
// than a single generic "Review" for everything.
function actionFor(item, { onOpenDocument, onGoToUpload, onGoToProfile }) {
  if (item.documentId != null) {
    return { label: 'Review Document', onClick: () => onOpenDocument(item.documentId) };
  }
  if (item.documentType === 'Profile Setting') {
    return { label: 'Go to Profile', onClick: onGoToProfile };
  }
  // Every other document-less item (CP500, Breastfeeding, Departure Levy,
  // One-Time Relief) is resolved by uploading supporting evidence.
  return { label: 'Upload Document', onClick: onGoToUpload };
}

function ActionBanner({
  title,         // bold lead-in, e.g. "Action Required" — names the kind of attention needed.
  message,       // explanatory sentence, e.g. why N items are pending. Free string from the parent.
  items = [],    // the ACTUAL pending items (mixedPendingReview) — what makes this expandable and useful.
  onOpenDocument,  // (documentId) => void — jump straight to that document in CukaiAccount.
  onGoToUpload,    // () => void — navigate to the Upload tab generally (no specific document).
  onGoToProfile,   // () => void — navigate to the profile settings page.
  compact = false, // when true: tighter padding + smaller text for the no-scroll layout
}) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef(null);

  // Click anywhere outside the banner/panel closes it — the usual
  // expectation for an overlay dropdown, now that the panel floats on top
  // of the page instead of being part of the normal document flow below.
  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expanded]);

  return (
    <div ref={containerRef} className={'relative rounded-lg border border-warning/30 bg-warning-bg ' + (compact ? 'px-4 py-2' : 'px-5 py-4')}>
      <div className="flex items-center justify-between gap-4">
        {/* Icon + text */}
        <div className="flex items-center gap-3">
          <span className="text-warning">
            <WarningIcon />
          </span>
          <div className="flex items-baseline gap-2">
            <p className={`font-semibold text-warning ${compact ? 'text-xs' : 'text-sm'}`}>{title}</p>
            <p className={`text-body-text ${compact ? 'text-xs' : 'text-sm'}`}>{message}</p>
          </div>
        </div>

        {/* Expand/collapse toggle — see what's pending without leaving the
            page. The panel below now floats ON TOP of the page content
            (absolute positioning) instead of pushing everything else down,
            so opening/closing it doesn't shove the stats grid around. */}
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className={
              'shrink-0 inline-flex items-center gap-1 rounded-lg bg-warning font-semibold text-white transition-colors duration-150 hover:opacity-90 ' +
              (compact ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm')
            }
          >
            {expanded ? 'Hide' : 'Review'}
            <ChevronIcon open={expanded} />
          </button>
        )}
      </div>

      {expanded && items.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto space-y-2 rounded-lg border border-warning/30 bg-white p-3 shadow-lg">
          {items.map((item, i) => {
            const action = actionFor(item, { onOpenDocument, onGoToUpload, onGoToProfile });
            return (
              <div key={item.documentId ?? `${item.documentType}-${i}`}
                className="flex items-start justify-between gap-3 rounded-lg bg-warning-bg/60 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-headings truncate">
                    {item.fileName || item.category || 'Item needing review'}
                  </p>
                  {item.reason && (
                    <p className="text-xs text-body-text mt-0.5 leading-relaxed">{item.reason}</p>
                  )}
                  {item.question && (
                    <p className="text-[11px] text-warning mt-1 leading-relaxed italic">{item.question}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={action.onClick}
                  className="shrink-0 rounded-lg border border-warning/40 bg-white px-2.5 py-1 text-[11px] font-semibold text-warning hover:bg-warning-bg transition-colors duration-150"
                >
                  {action.label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ActionBanner;