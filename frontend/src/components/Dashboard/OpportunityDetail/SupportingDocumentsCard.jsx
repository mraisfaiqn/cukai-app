// SupportingDocumentsCard — links the AI-matched invoice from the vault.
// Presentational only; the matched invoice arrives as a prop.
// Compact variant: reduced padding and font sizes to fit inside TaxProvisionCard.

const DocIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const InfoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

function SupportingDocumentsCard({
  matchingInvoice,
}) {
  return (
    // No outer bg/padding — this lives inside TaxProvisionCard's padded section
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-headings text-sm font-semibold text-headings">Link Supporting Documents</h2>
        <p className="mt-0.5 text-xs text-muted">Cukai.AI found a matching invoice in your vault.</p>
      </div>

      {/* AI-suggested match */}
      <div className="flex items-center mb-4 rounded-lg border border-dashed border-primary bg-primary-tint/50 p-3">
        <span className="text-primary"><DocIcon /></span>
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-primary">Suggested Match ({matchingInvoice.matchConfidence})</p>
          <p className="truncate text-xs font-semibold text-headings">{matchingInvoice.label}</p>
        </div>
      </div>

      {/* Manual upload */}
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border p-4 text-muted transition-colors hover:bg-primary-tint/30"
        >
          <UploadIcon />
          <span className="text-xs font-medium">Upload alternative invoice</span>
        </button>

        {/* Compliance note */}
        <div className="flex items-start gap-2 rounded-lg bg-[#FFF9E6] p-2.5">
          <span className="mt-0.5 text-muted"><InfoIcon /></span>
          <p className="text-[10px] leading-relaxed text-muted">
            LHDN requires audit-ready documentation to be kept for 7 years. Cukai.AI will automatically archive this link.
          </p>
        </div>
      </div>
    </div>
  );
}

export default SupportingDocumentsCard;