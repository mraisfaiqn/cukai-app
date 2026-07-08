// WhyYouQualifyCard — the AI explanation panel. Presentational only.
// Renders one paragraph per string and an optional legal-reference link.
// "Ask CukaiBot" button is right-aligned in the header row

const SparkleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </svg>
);

const DocIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

function WhyYouQualifyCard({
  paragraphs,
  reference,
}) {
  return (
    <section className="h-full rounded-xl border border-border bg-primary-tint p-4 flex flex-col min-h-0">
      {/* Header row: icon + title on the left, button pinned to the right */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-primary"><SparkleIcon /></span>
          <h2 className="font-headings text-sm font-bold text-headings">Why you qualify</h2>
        </div>
        <div className="flex items-center gap-3 ml-auto">
          {reference && (
            <a href="#" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover">
              <DocIcon />
              Reference: {reference}
            </a>
          )}
          
        </div>
      </div>
      {/* Scrollable prose — grows to fill remaining card height */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-2 space-y-2 text-sm leading-relaxed text-body-text pr-1">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </section>
  );
}

export default WhyYouQualifyCard;