// WhyYouQualifyCard — the AI explanation panel. Presentational only.
// Renders one paragraph per string and an optional legal-reference link.

const SparkleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  paragraphs, // array of strings — one <p> each (the AI's reasoning, in order).
  reference,  // legal reference text, e.g. "Public Ruling No. 12/2014" (optional link).
}) {
  return (
    <section className="h-full rounded-xl border border-border bg-primary-tint p-6">
      <div className="flex items-center gap-2">
        <span className="text-primary"><SparkleIcon /></span>
        <h2 className="font-headings text-lg font-semibold text-headings">Why you qualify</h2>
      </div>

      <div className="mt-3 space-y-3 text-sm leading-relaxed text-body-text">
        {/* Static, ordered prose that never reorders — index keys are safe here. */}
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {reference && (
        <a href="#" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover">
          <DocIcon />
          Reference: {reference}
        </a>
      )}
    </section>
  );
}

export default WhyYouQualifyCard;
