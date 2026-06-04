const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);


export default function BrandingPanel() {
  return (
    <div className="w-[58%] h-screen flex-shrink-0 overflow-hidden relative">

      {/*Background image with dark fade */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url('https://images.unsplash.com/photo-1596422846543-75c6fc197f07?w=1400&q=80')`,
        }}
      />

      {/* Image dark overlay for text readability */}
      <div className="absolute inset-0 bg-[#0F172A]/80" />

      {/* Soft fade for left panel */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#0F172A] via-[#0F172A]/60 to-transparent" />

      {/* for placement of content, top of the background ── */}
      <div className="relative z-10 w-full max-w-[520px] h-full flex flex-col px-4 py-12 ml-16">

        {/* Top most one line header */}
        <div className="flex-shrink-0">
          <span className="inline-flex items-center gap-2 border border-[#10B981]/40 text-[#10B981] text-[11px] font-bold tracking-widest uppercase px-4 py-2 rounded-full bg-[#10B981]/10">
            <span className="w-2 h-2 rounded-full bg-[#10B981] flex-shrink-0" />
            Less Tax Stress. More Peace of Mind
          </span>
        </div>

        {/* Centre content */}
        <div className="flex-1 flex flex-col justify-center">

          {/* Main headline */}
          <h1 className="text-[2.4rem] font-extrabold text-white leading-tight tracking-tight mb-1">
            Your AI Co-Pilot for
          </h1>
          <h1 className="text-[2.4rem] font-extrabold text-[#10B981] leading-tight tracking-tight mb-5">
            Malaysian<br />Tax Compliance
          </h1>

          {/* Smaller sub text */}
          <p className="text-[#94A3B8] text-[14.5px] leading-relaxed max-w-[400px] mb-6 font-normal">
            Smart tax guidance tailored to your income profile.
            Discover overlooked deductions, estimate your tax position,
            and file with confidence— powered by AI.
          </p>

          {/* Features */}
          <div className="flex flex-col gap-3 mb-7">
            {[
              "Personalized tax insights designed around your income profile",
              "Spot hidden tax-saving opportunities in seconds",
              "Enterprise-grade security with LHDN-ready support",
            ].map((feat) => (
              <div key={feat} className="flex items-center gap-3">
                <span className="w-[22px] h-[22px] rounded-[6px] bg-[#0D9488] flex items-center justify-center flex-shrink-0">
                  <CheckIcon />
                </span>
                <span className="text-[#CBD5E1] text-[12px] font-normal">{feat}</span>
              </div>
            ))}
          </div>

          {/* Statistics */}
          <div className="flex gap-3">
            {[
              { value: "95%",     label: "Accuracy Rate" },
              { value: "12k+",   label: "Malaysians filed" },
              { value: "RM 3.2k", label: "Avg. savings" },
            ].map((s) => (
              <div
                key={s.label}
                className="w-[150px] h-[88px] flex-shrink-0 bg-[#1E293B]/80 backdrop-blur-sm rounded-[14px] px-5 flex flex-col justify-center border border-[#FFFFFF]/20"
              >
                <div className="text-white text-[1.4rem] font-extrabold leading-none mb-1.5">
                  {s.value}
                </div>
                <div className="text-[#64748B] text-[12px] font-medium">
                  {s.label}
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* Security footer */}
        <div className="flex-shrink-0 flex items-center gap-4 pt-5 border-t border-white/10">
          
          <div className="flex gap-5">
            {["SSO Encrypted", "LHDN Compliant", "PDPA Compliant"].map((b) => (
              <span key={b} className="flex items-center gap-1.5 text-[12px] text-[#64748B] whitespace-nowrap">
                <span className="text-[#10B981] text-[13px]">✓</span> {b}
              </span>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}