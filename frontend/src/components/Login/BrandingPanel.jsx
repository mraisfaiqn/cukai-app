const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);


export default function BrandingPanel() {
  return (
    <div className="w-[50%] h-screen flex-shrink-0 overflow-hidden relative">

      {/*Background image with dark fade */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url('https://images.unsplash.com/photo-1596422846543-75c6fc197f07?w=1400&q=80')`,
        }}
      />

      {/* Image dark overlay for text readability */}
      <div className="absolute inset-0 bg-[#0F172A]/80" />

      {/* Soft fade for right panel */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#0F172A] via-[#0F172A]/60 to-transparent" />

      {/* for placement of content, top of the background ── */}
      <div className="relative z-10 w-full max-w-[520px] h-full flex flex-col px-4 py-12 ml-16">

        {/* Centre content */}
        <div className="flex-1 flex flex-col justify-center">

          {/* Main headline */}
          <h1 className="text-[2.4rem] font-extrabold text-white leading-tight tracking-tight mt-2 mb-1">
            Tax Compliance Assisted by
          </h1>
          <h1 className="text-[2.4rem] font-extrabold text-[#10B981] leading-tight tracking-tight mb-2">
            Artificial Intelligence
          </h1>

          {/* Smaller sub text */}
          <p className="text-[#94A3B8] text-[14.5px] leading-relaxed max-w-[400px] mb-6 font-normal">
            Smart tax guidance tailored to your income profile.
            Discover overlooked deductions, estimate your tax position
            and file with confidence - powered by AI.
          </p>

          {/* Top most one line header */}
          <div className="flex-shrink-0 mb-6">
            <span className="inline-flex items-center gap-2 border border-primary/40 text-primary text-[11px] font-bold tracking-widest px-4 py-2 rounded-full bg-primary/10">
              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
              Less Tax Stress. More Peace of Mind
            </span>
          </div>

          {/* Features */}
          <div className="flex flex-col gap-3 m-2">
            {[
              "Automated receipt and document classifications and calculations",
              "Personalized tax insights designed around your income profile",
              "Discover hidden tax-saving opportunities in seconds",
            ].map((feat) => (
              <div key={feat} className="flex items-center gap-3">
                <span className="w-[22px] h-[22px] rounded-[6px] bg-primary flex items-center justify-center flex-shrink-0">
                  <CheckIcon />
                </span>
                <span className="text-[#CBD5E1] text-xs font-normal">{feat}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-5 mt-6">
            <span className="inline-flex items-center gap-2 border border-primary/40 text-primary text-[11px] font-bold tracking-widest px-4 py-2 rounded-full bg-primary/10">
              {["PDPA Compliant","LHDN Compliant", "Persistent Memory"].map((b) => (
                <span key={b} className="flex items-center gap-1.5 text-xs text-muted whitespace-nowrap">
                  <span className="text-primary text-[13px]">✓</span> {b}
                </span>
              ))}
            </span>
          </div>
        </div>     
      </div>
    </div>
  );
}