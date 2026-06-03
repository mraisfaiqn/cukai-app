// QuickActions — the row of shortcut tiles under the opportunities list.
// Presentational only, no state. "Ask CukaiBot" is the emphasized (dark) tile.
// Matches the four tiles in Main_Dashboard_-_Cukai_AI.png.

// ── Tile icons ────────────────────────────────────────────────────────────────
const CaptureIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <rect x="8" y="8" width="8" height="8" rx="1" />
  </svg>
);
const InvoiceIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="13" y2="17" />
  </svg>
);
const BotIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 4v4M9 14h.01M15 14h.01" />
  </svg>
);
const SimulateIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

// Static tile config — icons are JSX, so they live here rather than in the data file.
// `primary` flags the emphasized dark tile (Ask CukaiBot).
const tiles = [
  { label: 'Capture receipt', icon: <CaptureIcon /> },
  { label: 'New e-invoice', icon: <InvoiceIcon /> },
  { label: 'Ask CukaiBot', icon: <BotIcon />, primary: true },
  { label: 'Simulate scenario', icon: <SimulateIcon /> },
];

function QuickActions() {
  return (
    <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {tiles.map((tile) => (
        // key = tile.label: each shortcut label is unique and stable.
        <button
          key={tile.label}
          type="button"
          className={
            'flex flex-col items-center justify-center gap-2 rounded-xl border p-4 transition-colors duration-150 ' +
            (tile.primary
              ? 'border-headings bg-headings text-white hover:opacity-90'
              : 'border-border bg-surface text-headings hover:bg-primary-tint')
          }
        >
          {/* Icon disc */}
          <span
            className={
              'flex h-10 w-10 items-center justify-center rounded-full ' +
              (tile.primary ? 'bg-primary text-white' : 'bg-primary-tint text-primary')
            }
          >
            {tile.icon}
          </span>
          <span className="text-sm font-medium">{tile.label}</span>
        </button>
      ))}
    </section>
  );
}

export default QuickActions;
