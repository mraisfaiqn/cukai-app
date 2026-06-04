// SupportingDocumentsCard — links the AI-matched invoice from the vault.
// Presentational only; the matched invoice arrives as a prop.

const DocIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const InfoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

function SupportingDocumentsCard({
  matchingInvoice, // { matchConfidence, label } — the invoice Cukai.AI matched.
}) {
  return (
    <section className="h-full rounded-xl border border-border bg-surface p-6">
      <h2 className="font-headings text-lg font-semibold text-headings">Link Supporting Documents</h2>
      <p className="mt-1 text-sm text-muted">Cukai.AI found a matching invoice in your vault.</p>

      {/* AI-suggested match — dashed teal frame */}
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-dashed border-primary bg-primary-tint/50 p-4">
        <span className="text-primary"><DocIcon /></span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-primary">Suggested Match ({matchingInvoice.matchConfidence})</p>
          <p className="truncate text-sm font-semibold text-headings">{matchingInvoice.label}</p>
        </div>
      </div>

      {/* Manual alternative */}
      <button
        type="button"
        className="mt-3 flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-4 text-muted transition-colors hover:bg-primary-tint/30"
      >
        <UploadIcon />
        <span className="text-sm font-medium">Upload alternative invoice</span>
      </button>

      {/* Compliance note */}
      <div className="mt-4 flex items-start gap-2 rounded-lg bg-primary-tint/40 p-3">
        <span className="mt-0.5 text-muted"><InfoIcon /></span>
        <p className="text-xs text-muted">
          LHDN requires audit-ready documentation to be kept for 7 years. Cukai.AI will automatically archive this link.
        </p>
      </div>
    </section>
  );
}

export default SupportingDocumentsCard;
