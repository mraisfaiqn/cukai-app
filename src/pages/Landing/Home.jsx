import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import cukaiLogo from '../../assets/cukai-logo.png';
import cukaibotIcon from '../../assets/cukaibot-icon.png';

/* ─── Reusable hook: intersection observer reveal ─── */
function useReveal(threshold = 0.1) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold, rootMargin: '0px 0px -40px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

/* ─── Material Symbol helper ─── */
const Icon = ({ name, className = '', filled = false, style = {} }) => (
  <span
    className={`material-symbols-outlined ${className}`}
    style={{ fontVariationSettings: filled ? "'FILL' 1" : "'FILL' 0", ...style }}
  >
    {name}
  </span>
);

/* ══════════════════════════════════════════════════════
   SECTION 1: NAVBAR  (standalone, used via MainHeader
   in App.jsx — but the landing page design has its own
   sticky nav with language switcher + section anchors)
   We render a *landing-page-specific* nav here so it
   matches the original HTML exactly.
   ══════════════════════════════════════════════════════ */
function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id) => {
    setMobileOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <nav
      className={`fixed top-0 w-full z-50 transition-all duration-300 ${
        scrolled ? 'bg-white/90 backdrop-blur-xl border-b border-slate-200' : ''
      }`}
      style={{ animation: 'fadeInDown 0.5s cubic-bezier(0.16,1,0.3,1) forwards' }}
    >
      <div className="flex justify-between items-center max-w-[1280px] mx-auto px-4 md:px-12 h-20">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <img src={cukaiLogo} alt="Cukai.ai logo" className="h-10 w-10 shrink-0" />
          <span className="select-none text-xl font-bold tracking-tight text-[#0F172A]">
            cukai<span className="text-[#10B981]">.</span><span className="font-light text-[#64748B]">ai</span>
          </span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-8">
          {[
            { label: 'Features', id: 'features' },
            { label: 'How It Works', id: 'how-it-works' },
            { label: 'Cukai Bot', id: 'cukaibot' },
            { label: 'Pricing', id: 'pricing' },
            { label: 'FAQ', id: 'faq' },
          ].map(({ label, id }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className="relative text-[#45464D] font-medium text-[15px] hover:text-[#0F172A] transition-colors duration-200 after:content-[''] after:absolute after:w-0 after:h-0.5 after:bottom-[-4px] after:left-1/2 after:bg-[#0F172A] after:transition-all after:duration-300 hover:after:w-full hover:after:left-0"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-6">
          <div className="flex items-center bg-white border border-slate-200 rounded-full p-1 shadow-sm">
            {['EN', 'BM', '中文'].map((lang) => (
              <button key={lang} className="px-3 py-1 text-xs font-medium rounded-full text-[#45464D] hover:bg-slate-50 transition-colors first:bg-[#F1F5F9] first:text-[#0F172A]">
                {lang}
              </button>
            ))}
          </div>
          <Link to="/login" className="text-[15px] font-medium text-[#64748B] hover:text-[#0F172A] transition-colors">
            Log In
          </Link>
          <Link
            to="/getstarted"
            className="bg-[#10B981] hover:bg-emerald-400 text-white font-medium text-[15px] px-5 py-2.5 rounded-lg shadow-[0_4px_14px_rgba(16,185,129,0.35)] hover:shadow-[0_6px_20px_rgba(16,185,129,0.45)] transition-all duration-200 hover:-translate-y-0.5"
          >
            Get Started
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden flex items-center justify-center p-2 text-[#0F172A] hover:bg-slate-100 rounded-lg transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          <Icon name={mobileOpen ? 'close' : 'menu'} className="text-[24px]" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-b border-slate-200 shadow-lg absolute top-20 left-0 w-full" style={{ animation: 'fadeInDown 0.3s ease forwards' }}>
          <div className="flex flex-col px-4 py-4 space-y-4">
            {[
              { label: 'Features', id: 'features' },
              { label: 'How It Works', id: 'how-it-works' },
              { label: 'Cukai Bot', id: 'cukaibot' },
              { label: 'Pricing', id: 'pricing' },
              { label: 'FAQ', id: 'faq' },
            ].map(({ label, id }) => (
              <button key={id} onClick={() => scrollTo(id)} className="text-[#0F172A] font-medium py-2 border-b border-slate-100 text-left">
                {label}
              </button>
            ))}
            <div className="pt-4 flex flex-col gap-4">
              <Link to="/login" className="text-center font-medium text-[#64748B] py-2">Sign In</Link>
              <Link to="/getstarted" className="bg-[#10B981] text-white text-center font-medium px-5 py-3 rounded-lg shadow-sm">Get Started Free</Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

/* ══════════════════════════════════════════════════════
   SECTION 2: HERO
   ══════════════════════════════════════════════════════ */
function Hero() {
  const navigate = useNavigate();
  const scrollToHow = () => {
    document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <main
      id="hero"
      className="relative pt-[120px] pb-12 min-h-screen flex items-center overflow-hidden"
      style={{
        backgroundImage: 'linear-gradient(to right,rgba(15,23,42,.03) 1px,transparent 1px),linear-gradient(to bottom,rgba(15,23,42,.03) 1px,transparent 1px)',
        backgroundSize: '40px 40px',
        backgroundColor: '#F8F9FF',
      }}
    >
      {/* Radial glow */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full -z-10 pointer-events-none"
        style={{ background: 'rgba(204,251,241,0.4)', filter: 'blur(100px)', animation: 'pulseRadial 8s ease-in-out infinite' }} />

      <div className="max-w-[1280px] mx-auto px-4 md:px-12 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left column */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <div className="inline-flex items-center gap-2 bg-[#CCFBF1] text-[#0D9488] px-3 py-1.5 rounded-full w-max opacity-0"
              style={{ animation: 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) forwards' }}>
              <Icon name="auto_awesome" className="text-sm" filled style={{ fontSize: 14 }} />
              <span className="text-[12px] font-semibold uppercase tracking-wider">AI-Powered Tax Compliance · Malaysia</span>
            </div>

            <h1 className="font-bold text-[#0F172A] leading-[1.1] mt-1 mb-1" style={{ fontSize: 'clamp(48px,6vw,72px)', letterSpacing: '-0.03em' }}>
              <span className="inline-block opacity-0" style={{ animation: 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) 80ms forwards' }}>Tax </span>
              <span className="inline-block opacity-0" style={{ animation: 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) 160ms forwards' }}>Filing,</span>
              <br />
              <span className="inline-block opacity-0" style={{ animation: 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) 240ms forwards' }}>Finally </span>
              <span className="inline-block opacity-0" style={{
                animation: 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) 320ms forwards',
                background: 'linear-gradient(to right,#10B981,#0D9488)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>Intelligent.</span>
            </h1>

            <p className="text-[18px] leading-[1.7] text-[#1E293B] max-w-2xl opacity-0 mb-3"
              style={{ animation: 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) 400ms forwards' }}>
              Cukai.AI is your AI co-pilot for Malaysian tax compliance. Scan receipts, classify expenses, and file on MyTax — in English, BM, or Mandarin.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mt-2 opacity-0"
              style={{ animation: 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) 480ms forwards' }}>
              <button
                onClick={() => navigate('/getstarted')}
                className="h-[52px] px-8 bg-[#10B981] text-white rounded-lg font-medium hover:bg-[#0D9488] transition-all flex items-center justify-center gap-2 shadow-sm hover:-translate-y-0.5"
              >
                Start for Free <Icon name="arrow_forward" style={{ fontSize: 20 }} />
              </button>
              <button
                onClick={scrollToHow}
                className="h-[52px] px-8 bg-white border border-[#0F172A] text-[#0F172A] rounded-lg font-medium hover:bg-slate-50 transition-all flex items-center justify-center hover:-translate-y-0.5"
              >
                See How It Works
              </button>
            </div>

            {/* Trust signals */}
            <div className="mt-16 pt-12 flex flex-col gap-6 border-t border-slate-200/50 opacity-0"
              style={{ animation: 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) 560ms forwards' }}>
              <div className="flex items-center gap-3">
                <div className="flex -space-x-3">
                  {[
                    'https://lh3.googleusercontent.com/aida-public/AB6AXuDzxLKGslKKhXfZhNKW5zT6fZGy7PKzl4SpndMzjjdb70EgMYE-L4hJwgx9qbQjZYibg9e2jbS96nDNj8VSlquyIZ0kpSKrJGbKzGsufZVTMOfhauN7HqCa8KUVIxns9PlVICQhfkQlDM612i8ttrjA2AFXvwFcu9rzftsryx5rlRIJBPj3BYHXsJE8WmrujLUF-9-wBwxi-l8LNHtS1jA4L8GuAuL-lXpq8D9U57nw8tDrgc_atPClQ-g_L5eg1DgEcZeVZB_VdsSC',
                    'https://lh3.googleusercontent.com/aida-public/AB6AXuBvGCDNbH7FYEoLLjqpQnvynsmX6D-3RhumA5S0ktyCB33Z_ND-6WtBQa2t70DKqPKU6lDLbGY39TENh22NhtSWkHDNxQYnkeMtM6szFnvG3omDKJJwf6RUvGhEvCja22QD0MtD7Ab9Rkl_1VUQw-Wo-JZAgPmd_xpy4F1O4MDfqBUFU4HXIrA8BYwxJ4VSt261a8Q7ao2VjsE_BIAw-RkaVHNAxa5XBCcct3jOj6gbOpjN92A6ci2TzM1aNEEW0lx1b2cK4QS_Hr8P',
                    'https://lh3.googleusercontent.com/aida-public/AB6AXuBeFAMea0M_hfTf7sUjs0N6axO5UyjorB2HdEAePDgCteHTXAs1dY_pZLnVRH3vayXmZ_QMYGuUFuOMltMKJJ6cAAwflu_ldCWkAUmN0TwQaaZ7vt1fQJfrJ5zFA9cQO4oEiDBBJ0GTiMMTQb1nDUxTMD3matHiIuAV1F48b99k7pwaWCsMN9dM5ZCljBbqIeoBeF23FSjE-j6IMFM46r7ia2iGsJ1knTDGd-ukwYv97EareWCjH_aPmEeig3oPFPj9JsVeJKpSlzFB',
                    'https://lh3.googleusercontent.com/aida-public/AB6AXuDiCoeQZPJXVLv2zIv0xhxQMWFY9GMPXGvrgPQWtFmoiT5wuFyQRXfBoaVAnye2R_wtbpHpx4amZPXiboi4eSM-l4yd1PwK-Vqp1G_aLiZED6bqDutrOPaGyab6-SVP6fU5D33_OYX0RR5qBhXnSQa0dWeUoGjk0Ri2dRp_DhkohADCFRpaEPE0W8vvz0sqxNTLsa3X-edBdvwr6pDpSJwtjdtftv0Pk3GCemZnevy_qWib9QJebq3BvTzUO_wUSTMr-B5nIcVftKIe',
                  ].map((src, i) => (
                    <img key={i} src={src} alt="Avatar" className="w-10 h-10 rounded-full border-2 border-white object-cover shadow-sm" />
                  ))}
                  <div className="w-10 h-10 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-500 shadow-sm z-10">+5k</div>
                </div>
                <span className="text-[14px] text-slate-500">Trusted by 2,400+ Malaysian SMEs</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {[
                  { icon: 'verified_user', label: 'PDPA Compliant' },
                  { icon: 'verified', label: 'LHDN Verified Data' },
                  { icon: 'lock', label: '256-bit Encrypted' },
                ].map(({ icon, label }) => (
                  <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-full text-xs font-medium text-slate-500 shadow-sm">
                    <Icon name={icon} className="text-[#10B981]" style={{ fontSize: 16 }} filled />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column — dashboard card */}
          <div className="lg:col-span-5 relative hidden lg:block opacity-0"
            style={{ perspective: 1000, animation: 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) 640ms forwards' }}>
            <div className="relative w-full h-[600px]"
              style={{ transform: 'rotateY(-5deg) rotateX(5deg)', transformStyle: 'preserve-3d', animation: 'float 6s ease-in-out infinite' }}>
              {/* Main dashboard */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] rounded-[16px] p-6 z-10"
                style={{ background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(12px)', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 20px 40px -10px rgba(15,23,42,0.08)' }}>
                <h3 className="font-semibold text-slate-900 mb-6 flex items-center gap-2">
                  <Icon name="monitoring" className="text-slate-500" /> Tax Health Score
                </h3>
                <div className="relative w-32 h-32 mx-auto mb-6">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="#E2E8F0" strokeWidth="8" />
                    <circle cx="50" cy="50" r="45" fill="none" stroke="#10B981" strokeWidth="8" strokeDasharray="283" strokeDashoffset="42" className="transition-all duration-1000 ease-out" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-slate-900">85</span>
                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Health</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-sm text-slate-600">Saved</span>
                    <span className="font-semibold text-[#10B981]">RM 12,400</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                      <div className="font-semibold text-slate-900">47</div>
                      <div className="text-xs text-slate-500">Receipts</div>
                    </div>
                    <div className="p-3 rounded-lg border text-center relative overflow-hidden" style={{ borderColor: '#CCFBF1', backgroundColor: 'rgba(204,251,241,0.2)' }}>
                      <div className="font-semibold text-[#0D9488] relative z-10">3</div>
                      <div className="text-xs text-[#0D9488]/80 relative z-10">Reliefs Found</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating card: CukaiBot */}
              <div className="absolute -right-8 top-12 w-[280px] rounded-[12px] p-4 z-20"
                style={{ background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(12px)', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 20px 40px -15px rgba(15,23,42,0.1)', animation: 'float 6s ease-in-out 1s infinite' }}>
                <div className="flex gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-[#0D9488] flex items-center justify-center flex-shrink-0">
                    <Icon name="smart_toy" className="text-white text-sm" style={{ fontSize: 16 }} />
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg rounded-tl-none border border-slate-100 text-sm text-slate-700 leading-relaxed">
                    <span className="text-[#0D9488] font-semibold">✦</span> I found 3 unclaimed reliefs worth <strong>RM 2,100</strong>. Apply now?
                  </div>
                </div>
                <div className="flex gap-2 justify-end pl-11">
                  <button className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors">Review</button>
                  <button className="px-4 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors">Apply All</button>
                </div>
              </div>

              {/* Floating card: Receipt scan */}
              <div className="absolute -left-12 bottom-20 w-[240px] rounded-[12px] p-4 z-20 -rotate-6"
                style={{ background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(12px)', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 20px 40px -15px rgba(15,23,42,0.1)', animation: 'float 6s ease-in-out 2s infinite' }}>
                <div className="flex justify-between items-start mb-4">
                  <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center">
                    <Icon name="receipt_long" className="text-slate-400" />
                  </div>
                  <span className="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 uppercase tracking-wider">
                    <Icon name="check" style={{ fontSize: 12 }} /> Sec 33
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">Kedai Maju Sdn Bhd</div>
                  <div className="text-lg font-bold text-slate-900">RM 340.00</div>
                  <div className="text-[11px] text-slate-400">Deductible Expense</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ══════════════════════════════════════════════════════
   SECTION 3: SOCIAL PROOF BAR
   ══════════════════════════════════════════════════════ */
function TrustBar() {
  const [ref, visible] = useReveal(0.1);
  const brands = ['TechVenture MY', 'GigWork Pro', 'NusaBiz', 'CafeChain MY', 'FreelancerHub', 'Rimba Retail', 'KL Konsult', 'Maju Digital'];

  return (
    <section
      ref={ref}
      className="w-full h-[80px] bg-white border-y border-slate-200 flex items-center overflow-hidden transition-all duration-500"
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(10px)' }}
    >
      <div className="w-full max-w-[1280px] mx-auto px-4 md:px-12 h-full flex items-center justify-between">
        <div className="flex items-center flex-1 min-w-0 h-full relative">
          <div className="flex-shrink-0 flex items-center pr-6 mr-6 border-r border-slate-200 h-8 z-10 bg-white">
            <span className="text-[14px] text-slate-500 font-medium">Trusted by Malaysian businesses:</span>
          </div>
          <div className="flex-1 overflow-hidden relative">
            <div className="flex-shrink-0 absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent z-10" />
            <div className="flex-shrink-0 absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent z-10" />
            <div className="flex whitespace-nowrap items-center" style={{ animation: 'marquee 30s linear infinite' }}>
              {[...brands, ...brands].map((b, i) => (
                <span key={i} className="font-bold text-[#C6C6CD] px-6">{b}{i < brands.length * 2 - 1 && <span className="ml-6">·</span>}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="hidden md:flex items-center pl-12 ml-6 flex-shrink-0 space-x-6 z-10 relative before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-8 before:w-px before:bg-slate-200 before:-ml-4">
          <span className="font-mono text-sm font-semibold text-[#0F172A]">2,400+ Users</span>
          <span className="w-1 h-1 rounded-full bg-slate-300" />
          <span className="font-mono text-sm font-semibold text-[#0F172A]">RM 18M Saved</span>
          <span className="w-1 h-1 rounded-full bg-slate-300" />
          <span className="font-mono text-sm font-semibold text-[#0F172A]">99.5% Uptime</span>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════
   SECTION 4: CORE FEATURES GRID
   ══════════════════════════════════════════════════════ */
function AiBadge({ children }) {
  return (
    <span className="inline-flex items-center gap-1 bg-[#CCFBF1] text-[#0D9488] rounded-full px-3 py-1 text-[12px] font-semibold tracking-wide mb-4">
      {children}
    </span>
  );
}

function Features() {
  const [ref, visible] = useReveal(0.05);

  return (
    <section id="features" className="pt-20 pb-12 px-4 md:px-12">
      <div className="max-w-[1280px] mx-auto">
        <div
          ref={ref}
          className="text-center max-w-3xl mx-auto mb-16 transition-all duration-700"
          style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(20px)' }}
        >
          <AiBadge>✦ What Cukai.AI Does</AiBadge>
          <h2 className="text-[40px] font-bold text-[#0F172A] mb-4 tracking-tight mt-4 leading-[1.3]" style={{ letterSpacing: '-0.015em' }}>
            Everything you need for tax compliance — in one platform.
          </h2>
          <p className="text-[18px] leading-[1.7] text-[#1E293B]">
            Built specifically for Malaysian SMEs, freelancers, and sole proprietors. Every feature is grounded in LHDN guidelines and the ITA 1967.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6" style={{ gridAutoRows: 'minmax(180px,auto)' }}>
          {/* Card 1: Receipt Vault */}
          <FeatureCard delay={80} className="md:col-span-1 md:row-span-2 flex flex-col justify-between" borderLeft>
            <div>
              <AiBadge>✦ Receipt Vault</AiBadge>
              <h3 className="text-[#0F172A] mb-3 mt-2 text-xl font-semibold">Snap. Scan. Classify.</h3>
              <p className="text-[16px] text-[#475569] mb-6 leading-[1.6]">
                Upload JPG, PNG, or PDF receipts. Our OCR engine extracts vendor, date, and amount — then the AI classifies each expense as Deductible, Non-Deductible, or Mixed-Use under Section 33 of the ITA.
              </p>
              <ul className="space-y-3 mb-8">
                {['Batch upload 50+ receipts', 'Confidence score per classification', '7-year secure vault for LHDN audits'].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[#334155] text-[16px]">
                    <Icon name="check_circle" className="text-[#0D9488]" filled /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#F8FAFC] border border-slate-200 rounded-lg p-4 mt-auto">
              <div className="flex items-center justify-between mb-2">
                <div className="h-8 w-8 bg-gray-200 rounded flex-shrink-0" />
                <div className="flex-1 ml-3">
                  <div className="h-3 w-20 bg-gray-300 rounded mb-1" />
                  <div className="h-2 w-12 bg-gray-200 rounded" />
                </div>
                <div className="font-mono text-sm font-medium">RM 145.00</div>
              </div>
              <div className="border-t border-dashed border-slate-300 my-3" />
              <div className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-medium px-2 py-1 rounded border border-green-200">
                <Icon name="check" style={{ fontSize: 14 }} /> Deductible · 94% confidence
              </div>
            </div>
          </FeatureCard>

          {/* Card 2: Chrome Extension */}
          <FeatureCard delay={160} style={{ borderLeft: '3px solid #0D9488' }}>
            <AiBadge>✦ Chrome Extension</AiBadge>
            <h3 className="text-[#0F172A] mb-2 mt-2 text-xl font-semibold">Co-pilot inside MyTax</h3>
            <p className="text-[16px] text-[#475569] leading-[1.6]">
              Sidebar overlay on mytax.hasil.gov.my that maps your expenses to the correct LHDN form fields with one click.
            </p>
          </FeatureCard>

          {/* Card 3: CukaiBot */}
          <FeatureCard delay={240} className="flex flex-col justify-between">
            <div>
              <AiBadge>✦ CukaiBot</AiBadge>
              <h3 className="text-[#0F172A] mb-2 mt-2 text-xl font-semibold">Ask in EN, BM, or Mandarin</h3>
              <p className="text-[16px] text-[#475569] mb-4 leading-[1.6]">
                Conversational AI grounded in the ITA 1967. Understands Rojak mixed-language. Cites exact Sections.
              </p>
            </div>
            <div className="bg-[#F1F5F9] rounded-lg p-3 text-sm">
              <div className="text-right text-[#475569] mb-2">"Ada relief untuk medical expenses?"</div>
              <div className="text-left text-[#0D9488] font-medium flex items-start gap-1">
                <Icon name="check" style={{ fontSize: 16 }} className="mt-0.5" /> "Yes, up to RM 10,000..."
              </div>
            </div>
          </FeatureCard>

          {/* Card 4: Relief Recommender */}
          <FeatureCard delay={320}>
            <AiBadge>✦ Relief Recommender</AiBadge>
            <h3 className="text-[#0F172A] mb-2 mt-2 text-xl font-semibold">Never miss a deduction</h3>
            <p className="text-[16px] text-[#475569] leading-[1.6]">
              Analyzes income and expenses to surface ALL eligible tax reliefs — personal, lifestyle, medical, EPF.
            </p>
          </FeatureCard>

          {/* Card 5: e-Invoice Engine */}
          <FeatureCard delay={400}>
            <AiBadge>✦ e-Invoice Engine</AiBadge>
            <h3 className="text-[#0F172A] mb-2 mt-2 text-xl font-semibold">LHDN-compliant e-invoices</h3>
            <p className="text-[16px] text-[#475569] leading-[1.6]">
              Generate self-billed e-invoices in UBL 2.1 format. Satisfies LHDN's 2025–2026 mandate.
            </p>
          </FeatureCard>

          {/* Card 6: Audit-Ready (dark) */}
          <FeatureCard delay={480} dark className="md:col-span-2 md:col-start-2">
            <AiBadge style={{ backgroundColor: 'rgba(204,251,241,0.1)', color: '#5EEAD4' }}>✦ Audit-Ready</AiBadge>
            <h3 className="text-white mb-2 mt-2 text-xl font-semibold">Every AI decision is explainable.</h3>
            <p className="text-[16px] text-[#94A3B8] leading-[1.6]">
              Confidence scores. Legal citations. Generate a password-protected PDF audit pack in one click.
            </p>
          </FeatureCard>
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ children, delay = 0, dark = false, className = '', id, style = {}, borderLeft = false }) {
  const [ref, visible] = useReveal(0.1);
  const base = 'rounded-[12px] p-6 border transition-all duration-500';
  const light = 'bg-white border-slate-200 hover:shadow-[0_12px_40px_rgba(15,23,42,0.08)] hover:border-slate-300 hover:-translate-y-1';
  const darkCls = 'bg-[#0F172A] text-white border-[#1E293B] hover:border-[#334155] hover:shadow-[0_20px_40px_rgba(0,0,0,0.2)] hover:-translate-y-1';

  return (
    <div
      ref={ref}
      id={id}
      className={`${base} ${dark ? darkCls : light} ${className}`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        transition: `opacity 0.6s ease-out ${delay}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms, box-shadow 0.3s, border-color 0.3s`,
        ...(borderLeft ? { borderLeft: '3px solid #0D9488' } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   SECTION 5: HOW IT WORKS
   ══════════════════════════════════════════════════════ */
function HowItWorks() {
  const [ref, visible] = useReveal(0.1);

  const steps = [
    {
      num: '01', n: 1, icon: 'folder', color: '#10B981',
      title: 'Upload & Scan',
      desc: 'Drag-and-drop your receipts, invoices, or bank statements. Our OCR processes any format in under 5 seconds.',
      badge: '⚡ ≤ 5s processing',
    },
    {
      num: '02', n: 2, icon: 'psychology', color: '#0D9488',
      title: 'AI Classifies & Recommends',
      desc: 'The AI cross-references ITA Section 33, identifies all eligible reliefs, and prepares your tax summary — with full legal citations.',
      badge: '✦ 95% citation rate',
      badgeColor: '#0D9488',
    },
    {
      num: '03', n: 3, icon: 'web', color: '#10B981',
      title: 'File via MyTax — Guided',
      desc: 'Activate the Chrome Extension on mytax.hasil.gov.my. One click maps every figure to the correct field. Review, confirm, and submit.',
      badgeIcon: 'lock',
      badge: 'Your data, your control',
    },
  ];

  return (
    <section id="how-it-works" className="py-20 px-4 md:px-12 bg-white relative overflow-hidden">
      <div className="max-w-[1280px] mx-auto relative overflow-hidden">
        <div
          ref={ref}
          className="flex flex-col items-center text-center max-w-3xl mx-auto mb-12 transition-all duration-700"
          style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(20px)' }}
        >
          <span className="inline-flex items-center gap-2 bg-[#CCFBF1] text-[#0D9488] text-[12px] font-semibold uppercase px-3 py-1.5 rounded-full mb-6 tracking-wider">✦ The Process</span>
          <h2 className="text-[40px] font-bold text-[#0F172A] mb-6 leading-[1.3]" style={{ letterSpacing: '-0.015em' }}>
            From receipt to filed return — in three steps.
          </h2>
          <p className="text-[18px] leading-[1.7] text-[#45464D]">Most users complete their first tax profile in under 5 minutes.</p>
        </div>

        <div className="relative mb-20 max-w-5xl mx-auto">
          {/* connector line */}
          <div className="hidden md:block absolute top-[60px] left-[10%] right-[10%] h-[2px] z-0">
            <svg height="2" width="100%"><line stroke="#E2E8F0" strokeWidth="2" strokeDasharray="10,10" x1="0" x2="100%" y1="1" y2="1" /></svg>
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[#0D9488] rounded-full"
              style={{ boxShadow: '0 0 10px #0D9488', animation: 'slideDot 6s infinite ease-in-out', left: 0 }} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
            {steps.map(({ num, n, icon, color, title, desc, badge, badgeColor, badgeIcon }, i) => {
              const [sRef, sVis] = useReveal(0.1);
              return (
                <div
                  key={n}
                  ref={sRef}
                  className="flex flex-col items-center md:items-start text-center md:text-left group relative bg-white p-6 rounded-xl border border-transparent hover:border-slate-200 transition-all duration-300"
                  style={{ opacity: sVis ? 1 : 0, transform: sVis ? 'translateY(0)' : 'translateY(20px)', transition: `opacity 0.6s ease ${i * 100}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${i * 100}ms` }}
                >
                  <div className="relative w-full flex justify-center md:justify-start mb-6">
                    <span className="font-extrabold text-[64px] leading-none select-none text-[#F1F5F9]">{num}</span>
                    <div className="absolute left-1/2 md:left-[32px] top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-[#0D9488] text-white rounded-full flex items-center justify-center font-bold text-sm shadow-md">{n}</div>
                  </div>
                  <div className="w-12 h-12 rounded-lg bg-[#E5EEFF] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                    <Icon name={icon} style={{ color, fontSize: 24 }} filled />
                  </div>
                  <h3 className="text-[22px] font-semibold text-[#0F172A] mb-3">{title}</h3>
                  <p className="text-[16px] leading-[1.6] text-[#45464D] mb-6 min-h-[80px]">{desc}</p>
                  <div className="mt-auto inline-flex items-center gap-2 bg-[#F8F9FF] px-3 py-1.5 rounded-full border border-slate-200/50 text-sm font-medium text-[#45464D]">
                    {badgeIcon && <Icon name={badgeIcon} className="text-sm" />}
                    <span style={badgeColor ? { color: badgeColor } : {}}>{badge}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Video demo placeholder */}
        <div className="max-w-[900px] mx-auto relative group cursor-pointer">
          <div className="absolute -inset-1 rounded-[20px] blur-xl opacity-50 group-hover:opacity-100 transition duration-500"
            style={{ background: 'linear-gradient(to right, rgba(13,148,136,0.2), rgba(16,185,129,0.2))' }} />
          <div className="relative w-full aspect-video bg-[#0F172A] rounded-2xl overflow-hidden shadow-2xl border border-slate-700/50 flex flex-col items-center justify-center transition-transform duration-300 group-hover:-translate-y-1">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition duration-300 mb-6 relative z-10">
              <Icon name="play_arrow" className="text-[#10B981] ml-1" style={{ fontSize: 36 }} filled />
            </div>
            <p className="text-[12px] font-semibold text-white uppercase tracking-wider relative z-10 flex items-center gap-2">
              Watch a 90-second demo <Icon name="arrow_forward" className="text-sm" />
            </p>
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div className="absolute top-4 left-4 right-4 h-12 border-b border-white/20 flex items-center px-4 gap-2">
                {[0, 1, 2].map(i => <div key={i} className="w-3 h-3 rounded-full bg-white/30" />)}
              </div>
              <div className="absolute top-24 left-8 w-64 h-32 bg-white/5 rounded-lg border border-white/10" />
              <div className="absolute top-24 right-8 w-80 h-64 bg-white/5 rounded-lg border border-white/10" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════
   SECTION 6: AI PRODUCT SHOWCASE
   ══════════════════════════════════════════════════════ */
function ProductShowcase() {
  const navigate = useNavigate();

  return (
    <>
      {/* Block 1: CukaiBot */}
      <section id="cukaibot" className="py-20 px-4 md:px-12 bg-[#F8FAFC] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-[#EFF4FF] to-transparent opacity-50 pointer-events-none" />
        <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-20 items-center relative z-10">
          {/* Text */}
          <ShowcaseReveal>
            <div className="flex flex-col space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#CCFBF1] text-[#0D9488] w-fit">
                <img src={cukaibotIcon} alt="CukaiBot" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                <span className="text-[12px] font-semibold uppercase tracking-wide">CukaiBot</span>
              </div>
              <h2 className="text-[40px] font-bold text-[#0F172A] leading-[1.3]" style={{ letterSpacing: '-0.015em' }}>
                Ask your tax questions in any language.
              </h2>
              <p className="text-[18px] leading-[1.7] text-[#45464D] max-w-lg">
                Meet CukaiBot, your dedicated tax assistant. Grounded strictly in ITA 1967 and current LHDN guidelines, it provides accurate, source-cited answers to complex queries in seconds.
              </p>
              <ul className="space-y-3 py-3 text-[16px] text-[#45464D] leading-[1.6]">
                {[
                  { bold: 'Multilingual Support:', text: ' Converse fluently in English, Bahasa Melayu, or Mandarin.' },
                  { bold: 'Cites Sections:', text: ' Every claim is backed by specific legal references.' },
                  { bold: 'Zero-hallucination:', text: ' Strict grounding architecture ensures 100% compliance.' },
                ].map(({ bold, text }) => (
                  <li key={bold} className="flex items-start gap-3">
                    <Icon name="check_circle" className="text-[#006A61] mt-1 flex-shrink-0" style={{ fontSize: 20 }} />
                    <span><strong>{bold}</strong>{text}</span>
                  </li>
                ))}
              </ul>
              <div className="pt-2">
                <button
                  onClick={() => navigate('/getstarted')}
                  className="inline-flex items-center justify-center gap-3 px-12 py-3 rounded-lg bg-[#0F172A] text-white hover:bg-black transition-colors duration-200 text-[12px] font-semibold uppercase tracking-wider group"
                >
                  Try CukaiBot Free
                  <Icon name="arrow_forward" className="text-[18px] group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          </ShowcaseReveal>

          {/* Chat Mockup */}
          <div className="relative w-full max-w-md mx-auto lg:ml-auto" style={{ animation: 'float 6s ease-in-out infinite' }}>
            <div className="bg-white rounded-xl shadow-[0px_10px_15px_-3px_rgba(15,23,42,0.08)] border border-slate-200 overflow-hidden flex flex-col h-[500px]">
              <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-[#F8FAFC]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#131b2e] flex items-center justify-center">
                    <Icon name="smart_toy" className="text-white" style={{ fontSize: 20 }} />
                  </div>
                  <div>
                    <h4 className="text-[12px] font-semibold text-[#0F172A] flex items-center gap-1">
                      CukaiBot <Icon name="verified" className="text-[#0D9488]" style={{ fontSize: 14 }} filled />
                    </h4>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-[#006A61]" />
                      <span className="font-mono text-[12px] text-[#45464D]">Online</span>
                    </div>
                  </div>
                </div>
                <Icon name="more_horiz" className="text-[#76777D]" />
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#F8FAFC]">
                <div className="flex justify-end">
                  <div className="bg-[#0F172A] text-white rounded-lg rounded-tr-none px-3 py-2 max-w-[85%] text-[16px] leading-[1.6]">
                    Ada ke relief untuk anak pergi universiti?
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-200 shadow-sm rounded-lg rounded-tl-none px-3 py-2 max-w-[90%] text-[16px] leading-[1.6] text-[#0b1c30]">
                    <p className="mb-2">Ya! Di bawah Seksyen 46(1)(b), pelepasan sehingga RM 8,000 dibenarkan untuk anak berumur 18 tahun ke atas yang mengikuti pengajian tinggi sepenuh masa.</p>
                    <button className="inline-flex items-center gap-1 text-xs font-mono text-[#006A61] hover:text-[#005236] transition-colors border border-[#006A61]/20 rounded px-2 py-1 bg-[#006A61]/5 mt-1">
                      <Icon name="policy" style={{ fontSize: 14 }} /> Verify Source
                    </button>
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="bg-[#0F172A] text-white rounded-lg rounded-tr-none px-3 py-2 max-w-[85%] text-[16px] leading-[1.6]">
                    What about medical expenses?
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-200 shadow-sm rounded-lg rounded-tl-none px-3 py-2 max-w-[90%] text-[16px] leading-[1.6] text-[#0b1c30]">
                    Under S.46(1)(d), medical expenses for serious illness are claimable up to RM 10,000. This limit also includes full medical examination up to RM 1,000.
                  </div>
                </div>
              </div>
              <div className="p-3 bg-white border-t border-slate-200">
                <div className="relative">
                  <input disabled placeholder="Ask a tax question..." className="w-full bg-[#F1F5F9] rounded-lg py-3 px-3 pr-12 text-[16px] text-[#0b1c30] focus:ring-2 focus:ring-[#0F172A] outline-none transition-all" />
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-[#0F172A] hover:text-[#0F172A]/80 transition-colors">
                    <Icon name="send" />
                  </button>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex gap-3 whitespace-nowrap">
              {['3 Languages', '95% Cited', '< 3s Response'].map((t, i) => (
                <div key={t} className="bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-full font-mono text-xs text-[#0b1c30] shadow-sm border border-slate-200 flex items-center gap-1">
                  {i === 1 && <Icon name="check_circle" className="text-[#006A61]" style={{ fontSize: 14 }} />}
                  {i === 2 && <Icon name="bolt" className="text-[#0D9488]" style={{ fontSize: 14 }} />}
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Block 2: Receipt Vault */}
      <section className="py-20 px-4 md:px-12 bg-[#0F172A] text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, #86F2E4 0%, transparent 70%)' }} />
        <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-20 items-center relative z-10">
          {/* Receipt UI Mockup */}
          <div className="relative w-full max-w-lg mx-auto lg:mx-0 order-2 lg:order-1 opacity-0"
            style={{ animation: 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) 160ms forwards' }}>
            <div className="rounded-xl shadow-2xl overflow-hidden p-6" style={{ background: 'rgba(30,41,59,0.8)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)', animation: 'float 6s ease-in-out infinite' }}>
              <div className="flex items-center justify-between mb-6 pb-3 border-b border-white/10">
                <h3 className="text-[28px] font-semibold text-white leading-[1.4]" style={{ fontSize: 22 }}>Recent Receipts</h3>
                <Icon name="filter_list" className="text-[#76777D]" />
              </div>
              <div className="space-y-3">
                {[
                  { icon: 'storefront', name: 'Mydin Holdings', amt: 'RM 234.50', status: 'Deductible 97%', cls: 'bg-[#006A61]/20 text-[#89F5E7] border-[#006A61]/30', statusIcon: 'check' },
                  { icon: 'directions_car', name: 'Grab', amt: 'RM 45.00', status: 'Mixed-Use', cls: 'bg-[#F59E0B]/20 text-[#FCD34D] border-[#F59E0B]/30', statusIcon: 'warning' },
                  { icon: 'local_parking', name: 'Parking DBKL', amt: 'RM 12.00', status: 'Non-Deductible', cls: 'bg-red-900/20 text-red-300 border-red-700/30', statusIcon: 'close' },
                ].map(({ icon, name, amt, status, cls, statusIcon }) => (
                  <div key={name} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded bg-[#0F172A] flex items-center justify-center border border-white/10">
                        <Icon name={icon} className="text-white" />
                      </div>
                      <div>
                        <p className="text-[16px] font-medium text-white leading-[1.6]">{name}</p>
                        <p className="font-mono text-[12px] text-[#76777D]">{amt}</p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-semibold ${cls}`}>
                      <Icon name={statusIcon} style={{ fontSize: 14 }} /> {status}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Confidence badge */}
            <div className="absolute -right-6 -bottom-6 rounded-xl p-3 shadow-xl flex items-center gap-3 border border-white/10"
              style={{ background: 'rgba(30,41,59,0.8)', backdropFilter: 'blur(12px)', animation: 'float 6s ease-in-out 3s infinite' }}>
              <div className="relative w-12 h-12">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#89F5E7" strokeDasharray="85, 100" strokeWidth="4" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="font-mono text-[10px] text-white">85%</span>
                </div>
              </div>
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[#76777D]">Confidence</p>
                <p className="text-[16px] font-medium text-white leading-[1.6]">Classification</p>
              </div>
            </div>
          </div>

          {/* Text */}
          <div className="flex flex-col space-y-6 order-1 lg:order-2 opacity-0"
            style={{ animation: 'fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) 320ms forwards' }}>
            <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#CCFBF1]/10 text-[#89F5E7] border border-[#89F5E7]/20 w-fit">
              <Icon name="receipt_long" style={{ fontSize: 16 }} />
              <span className="text-[12px] font-semibold uppercase tracking-wide">Receipt Vault</span>
            </div>
            <h2 className="text-[40px] font-bold text-white leading-[1.3]" style={{ letterSpacing: '-0.015em' }}>
              7 years of audit-ready records. Organized by AI.
            </h2>
            <p className="text-[18px] leading-[1.7] text-[#76777D] max-w-lg">
              Never fear an LHDN audit again. Just snap a photo or forward an email. Our AI automatically extracts data, categorizes expenses, calculates deductibility, and stores a compliant PDF in your vault for the legally required 7 years.
            </p>
            <div className="pt-2">
              <button
                onClick={() => navigate('/getstarted')}
                className="inline-flex items-center gap-3 px-12 py-3 rounded-lg bg-[#006A61] text-white hover:bg-[#006A61]/90 transition-colors text-[12px] font-semibold uppercase tracking-wider group border border-transparent hover:border-[#89F5E7]/30 shadow-lg"
                style={{ boxShadow: '0 10px 25px rgba(0,106,97,0.3)' }}
              >
                Try Receipt Vault
                <Icon name="arrow_forward" className="text-[18px] group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function ShowcaseReveal({ children }) {
  const [ref, visible] = useReveal(0.1);
  return (
    <div ref={ref} className="transition-all duration-700" style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(20px)' }}>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   SECTION 7: TESTIMONIALS
   ══════════════════════════════════════════════════════ */
function Testimonials() {
  const [headerRef, headerVis] = useReveal(0.1);

  const testimonials = [
    {
      quote: '"As a freelance consultant, keeping track of deductible expenses was a nightmare. The AI categorisation feature completely automates my ledger. It feels like having a senior auditor on call 24/7."',
      name: 'Sarah Lin', role: 'Independent Consultant',
      badge: <><Icon name="check_circle" style={{ fontSize: 12 }} className="text-[#009668]" /> LHDN VERIFIED</>,
      badgeCls: 'bg-[#DCE9FF] text-[#0b1c30]',
      star5: true,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCGkw-753bl5uXcG3VGPsVcRKG7nKwrMbGZVBPYsRk9XaOB-4N7mP_BO0hPE3U12n-cudTTSCd3K0KxC2859tzdN3VLfK8jB3vktWiPssZoi_s-vDNp2_SzlAHXsRCjl5DtrN-TCSOLNlMXlCLWvfboYf90Jvmo51HFGZZGmsqbr_wRkg9hJYrXxmJ0wEK8E1NzHFH8ZUqW60A-rTPHRaZKFOCqsmFEM7SyTXgcNncgYeITpVOO_UR1k7mlKzYt28yvBetivrfHTojn',
      delay: 160,
    },
    {
      quote: '"The predictive tax liability modelling helped us avoid a major cash flow crisis during Q3. The system literally paid for itself within the first month. Incredible algorithmic precision."',
      name: 'Ahmad Fazrin', role: 'Director, NexaTech Solutions',
      badge: '✦ AI INSIGHT USER',
      badgeCls: 'bg-[#4EDEA3]/20 text-[#005236]',
      star5: true,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDP-NWPrQFGNby00lKQSXb_AL2Ecv5QrYtld-xSqnx1ZCCWxhEsRu6gYXqq7aNI_GCnn5ZMEm_MlNU4LMDYsw91hYojXrJuqNmYYunaPUsbl-uRn_eB7GVjrtCO_jZoBeAKB-33jhUgLhDM2jXj7Z4aeK5yXLnsKiTjs_eN9QvTTHl3Ruq5XWfexrk1bX4XTD46An_fghjxZQvN3EcT4NK3vwbTaqueDfAnyLhSeYLFoFbLK99TnxPfxmO783hbSepiEu-G7Kkf_iKI',
      delay: 240,
    },
    {
      quote: '"Switching our retail chain over to Cukai.AI was seamless. The interface is rigorous yet intuitive. It easily handles our multi-branch data and generates flawless e-Invoices instantly."',
      name: 'Michelle Wong', role: 'Operations Lead, Urban Grocers',
      badge: <><Icon name="verified" style={{ fontSize: 12 }} className="text-[#009668]" /> COMPLIANCE SUCCESS</>,
      badgeCls: 'bg-[#DCE9FF] text-[#0b1c30]',
      star5: false,
      img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD5zNfy6M6xLYrQcCCOHevgEW_d5MW6-aJ6Ow5dXS6V0604JaxLdT8rxXDlRIp9AfHMrSbmiRFj4Y6rVDqU5XFZ0wtu1U-tTTVkMKS4ee60Aw5nxNkXs_sdSV_0QWUcSIKSugLrrB0fk-pcf5DyZAfis0Sx-i9HfIIN35WUMqITP6v8YRIyYdepZb2856Ao_UpvYHrXQw3nsQw8Zh4ZAelNS3TD7R9TZ1HcoX0uyvF1-thZimBJHk87OPfpHrouDyfeeSxYLTQervx9',
      delay: 320,
    },
  ];

  return (
    <section className="py-20 px-4 md:px-12 overflow-hidden relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full pointer-events-none -z-10"
        style={{ background: 'rgba(134,242,228,0.2)', filter: 'blur(120px)' }} />
      <div className="max-w-[1280px] mx-auto flex flex-col gap-12">
        <div
          ref={headerRef}
          className="flex flex-col items-center text-center gap-3 transition-all duration-700"
          style={{ opacity: headerVis ? 1 : 0, transform: headerVis ? 'translateY(0)' : 'translateY(20px)' }}
        >
          <div className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#E5EEFF] rounded-full border border-[#DCE9FF] shadow-sm">
            <Icon name="verified_user" style={{ fontSize: 16 }} className="text-[#009668]" filled />
            <span className="text-[12px] font-semibold text-[#45464D]">Trusted by 2,400+ Malaysian Businesses</span>
          </div>
          <h2 className="text-[40px] font-bold text-[#0b1c30] max-w-2xl leading-[1.3]" style={{ letterSpacing: '-0.015em' }}>
            Compliance without the complexity.
          </h2>
        </div>

        {/* Hero testimonial */}
        <TestiReveal delay={80}>
          <div className="bg-[#213145] rounded-xl overflow-hidden shadow-2xl flex flex-col md:flex-row relative group border border-white/10">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
              style={{ background: 'radial-gradient(circle at center, white, transparent)' }} />
            <div className="md:w-2/5 relative h-64 md:h-auto overflow-hidden">
              <img
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCs7mKDIniaEoYO9uv84EYIZ_nJGtoJ7gGxLCQ4Xd4CYGDsdrMODGHk7Xg8n5mDW5RJbo_vuAHwSwzQStXYedPEUF-1UYPTGvww-HASi03GgME9MAHk4VlrJKRibIyRwgwXtxTbHWQisVJ2WQv3hzFLY8R7qtAmeLnXl7rg0uLYckTnzxdQ0Oc08p_Aa9S_n8DyLSSdxiXCeEcAXrKuAWu3CtBY82czAjNd7Qom5GJVIUcqO5Jqpk6k2kcEzOwIr0zFwRmFFf0K_ViL"
                alt="CEO Portrait"
                className="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-700 ease-out"
              />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #213145, rgba(33,49,69,0.4), transparent)' }} />
            </div>
            <div className="md:w-3/5 p-6 md:p-12 flex flex-col justify-center relative z-10">
              <Icon name="format_quote" className="text-[#565E74] mb-3 opacity-50" style={{ fontSize: 48 }} filled />
              <p className="text-[28px] font-semibold text-[#EAF1FF] mb-12 leading-[1.4]" style={{ letterSpacing: '-0.01em' }}>
                "Cukai.AI entirely transformed our quarterly reporting. What used to take our accounting team two weeks of manual reconciliation is now handled algorithmically in hours. The precision is unmatched, and the LHDN compliance gives us absolute peace of mind."
              </p>
              <div className="flex items-center justify-between border-t border-[#565E74]/30 pt-3 mt-auto">
                <div>
                  <div className="text-[18px] font-bold text-[#EAF1FF] leading-[1.7]">Dato' Azman Hashim</div>
                  <div className="text-[12px] font-semibold text-[#BEC6E0] mt-1">Founder & CEO, Meridian Logistics</div>
                </div>
                <div className="w-12 h-12 rounded-lg bg-[#565E74]/20 flex items-center justify-center border border-[#565E74]/30">
                  <Icon name="local_shipping" className="text-[#BEC6E0]" />
                </div>
              </div>
            </div>
          </div>
        </TestiReveal>

        {/* Testimonial grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map(({ quote, name, role, badge, badgeCls, star5, img, delay }) => (
            <TestiReveal key={name} delay={delay}>
              <div className="bg-[#F8F9FF] border border-[#C6C6CD]/40 rounded-xl p-6 flex flex-col gap-3 hover:-translate-y-2 hover:shadow-[0_10px_15px_-3px_rgba(15,23,42,0.08)] transition-all duration-300 ease-out relative overflow-hidden h-full">
                <div className="absolute top-0 right-0 w-24 h-24 bg-[#D3E4FE]/30 rounded-bl-full -z-10 pointer-events-none" />
                <div className="flex items-center justify-between mb-1">
                  <div className="flex gap-1 text-[#009668]">
                    {[...Array(star5 ? 5 : 4)].map((_, i) => (
                      <Icon key={i} name="star" style={{ fontSize: 18 }} filled />
                    ))}
                    {!star5 && <Icon name="star_half" style={{ fontSize: 18 }} filled />}
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold tracking-wider ${badgeCls}`}>{badge}</span>
                </div>
                <p className="text-[16px] leading-[1.6] text-[#45464D] flex-grow">{quote}</p>
                <div className="flex items-center gap-3 mt-6 pt-3 border-t border-[#C6C6CD]/20">
                  <img src={img} alt={name} className="w-10 h-10 rounded-full object-cover border border-[#C6C6CD]/30" />
                  <div>
                    <div className="text-[16px] font-bold text-[#0b1c30] leading-[1.6]">{name}</div>
                    <div className="text-[12px] font-semibold text-[#76777D]">{role}</div>
                  </div>
                </div>
              </div>
            </TestiReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function TestiReveal({ children, delay = 0 }) {
  const [ref, visible] = useReveal(0.1);
  return (
    <div ref={ref} style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(20px)', transition: `opacity 0.8s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.8s cubic-bezier(0.16,1,0.3,1) ${delay}ms` }}>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   SECTION 8: PRICING
   ══════════════════════════════════════════════════════ */
function Pricing() {
  const navigate = useNavigate();
  const [annual, setAnnual] = useState(true);
  const [ref, visible] = useReveal(0.1);

  return (
    <section id="pricing" className="py-20 px-4 md:px-12">
      <div className="max-w-[1280px] mx-auto w-full">
        <div
          ref={ref}
          className="text-center max-w-3xl mx-auto mb-12 transition-all duration-700"
          style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(20px)' }}
        >
          <h2 className="text-[40px] font-bold text-[#0b1c30] mb-3 leading-[1.3]" style={{ letterSpacing: '-0.015em' }}>Simple, transparent pricing</h2>
          <p className="text-[18px] leading-[1.7] text-[#45464D]">Built for Malaysian SMEs, freelancers, and growing teams.</p>
          <div className="inline-flex items-center mt-6 p-1 bg-[#DCE9FF] rounded-full border border-[#C6C6CD]/30">
            <button
              onClick={() => setAnnual(false)}
              className={`px-6 py-2 rounded-full text-[12px] font-semibold transition-colors ${!annual ? 'bg-white shadow text-[#0F172A]' : 'text-[#45464D] hover:text-[#0F172A]'}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-6 py-2 rounded-full text-[12px] font-semibold flex items-center gap-2 transition-colors ${annual ? 'bg-white shadow text-[#0F172A]' : 'text-[#45464D] hover:text-[#0F172A]'}`}
            >
              Annual <span className="bg-[#4EDEA3]/20 text-[#005236] px-2 py-0.5 rounded-full text-[10px]">Save 20%</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {/* Free */}
          <PriceCard navigate={navigate} plan="free" annual={annual} />
          {/* SME Pro */}
          <PriceCard navigate={navigate} plan="pro" annual={annual} featured />
          {/* Enterprise */}
          <PriceCard navigate={navigate} plan="enterprise" annual={annual} />
        </div>

        <div className="mt-12 text-center flex items-center justify-center gap-2 text-[#45464D] font-mono text-sm opacity-80">
          <Icon name="lock" style={{ fontSize: 16 }} />
          <span>No credit card required. Cancel anytime. 100% LHDN compliant.</span>
        </div>
      </div>
    </section>
  );
}

function PriceCard({ plan, annual, featured = false, navigate }) {
  const plans = {
    free: {
      name: 'Free Forever', price: 'RM 0', period: '/mo',
      desc: 'Perfect for freelancers.',
      features: ['5 receipt scans/mo', 'Basic CukaiBot', 'LHDN basic compliance'],
      cta: 'Get Started Free', ctaStyle: 'border-2 border-[#0F172A] text-[#0F172A] hover:bg-[#E5EEFF]',
    },
    pro: {
      name: 'SME Pro', price: annual ? 'RM 47' : 'RM 59', period: '/mo',
      desc: 'The standard for growing businesses.',
      features: ['Unlimited scans', 'Advanced CukaiBot (Full Legal Citations)', 'Chrome Extension', 'Audit-Ready PDF packs'],
      cta: 'Start 14-Day Free Trial', ctaStyle: 'bg-white text-[#131b2e] hover:bg-[#E5EEFF]',
    },
    enterprise: {
      name: 'Enterprise', price: 'Custom', period: '',
      desc: 'For large scale operations.',
      features: ['Multi-branch support', 'Dedicated Account Manager', 'API access', 'Custom LHDN reporting'],
      cta: 'Contact Sales', ctaStyle: 'border-2 border-slate-200 text-[#0b1c30] hover:border-[#0F172A] hover:text-[#0F172A]',
    },
  };
  const p = plans[plan];
  const [ref, visible] = useReveal(0.1);

  return (
    <div
      ref={ref}
      className={`rounded-xl p-6 flex flex-col h-full transition-all duration-700 ${featured
        ? 'bg-[#131b2e] border border-transparent shadow-2xl relative md:-mt-4 md:mb-[-16px] z-10'
        : 'bg-white border border-slate-200 hover:-translate-y-2 hover:shadow-[0_20px_25px_-5px_rgba(15,23,42,0.1)] transition-all duration-300'
      }`}
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(20px)' }}
    >
      {featured && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#4EDEA3] text-[#002113] px-3 py-1 rounded-full text-[12px] font-semibold flex items-center gap-1">
          <Icon name="star" style={{ fontSize: 14 }} filled /> Most Popular
        </div>
      )}
      <div className="mb-6 mt-2">
        <h3 className={`text-[28px] font-semibold leading-[1.4] ${featured ? 'text-white' : 'text-[#0b1c30]'}`}>{p.name}</h3>
        <div className="mt-3 flex items-baseline gap-1">
          <span className={`text-[40px] font-bold leading-[1.3] ${featured ? 'text-white' : 'text-[#0F172A]'}`}>{p.price}</span>
          {p.period && <span className={`text-[16px] leading-[1.6] ${featured ? 'text-[#7C839B]' : 'text-[#45464D]'}`}>{p.period}</span>}
        </div>
        <p className={`text-[16px] leading-[1.6] mt-1 ${featured ? 'text-[#7C839B]' : 'text-[#45464D]'}`}>{p.desc}</p>
      </div>
      <hr className={`mb-6 ${featured ? 'border-[#7C839B]/30' : 'border-slate-200'}`} />
      <ul className="flex-grow space-y-3 mb-12">
        {p.features.map((f) => (
          <li key={f} className="flex items-start gap-3">
            <Icon name="check_circle" className="text-[#4EDEA3] flex-shrink-0" style={{ fontSize: 20 }} filled />
            <span className={`text-[16px] leading-[1.6] ${featured ? 'text-white' : 'text-[#0b1c30]'}`}>{f}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={() => plan === 'enterprise' ? null : navigate('/getstarted')}
        className={`w-full py-3 rounded-lg text-[12px] font-semibold transition-colors ${p.ctaStyle}`}
      >
        {p.cta}
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   SECTION 9: FAQ
   ══════════════════════════════════════════════════════ */
const faqs = [
  { q: 'Is Cukai.AI officially recognized by LHDN?', a: 'While Cukai.AI is an independent software provider, our algorithms are strictly trained on the Income Tax Act 1967 (ITA 1967) and the latest e-Invoicing guidelines provided by LHDNM. We ensure your outputs are format-compliant for direct submission.' },
  { q: 'How secure is my financial data?', a: 'We treat your data with institutional-grade security. All financial records are protected using AES-256 encryption at rest and TLS 1.3 in transit. Our infrastructure is SOC2 compliant, ensuring strict access controls and regular security audits.' },
  { q: 'Can CukaiBot answer questions in Bahasa Melayu or Mandarin?', a: 'Yes. CukaiBot is built with native multilingual capabilities. It understands complex tax terminology and can accurately assist you in English, Bahasa Melayu, and Mandarin, making compliance accessible for all Malaysian business operators.' },
  { q: 'Does it replace my current accountant?', a: 'No, Cukai.AI is designed to complement professional services. It automates the tedious data entry, categorization, and initial compliance checks with algorithmic precision. This frees up your accountant to focus on strategic tax planning and advisory services.' },
  { q: 'What happens if I get audited?', a: 'You are fully prepared. Cukai.AI features a 7-year audit-ready vault that securely stores all your receipts, invoices, and categorization logic. You can generate comprehensive PDF export reports with a single click to provide a clear, chronological trail for auditors.' },
  { q: 'How long does it take to set up?', a: 'Setup typically takes less than 5 minutes. You simply create an account, connect your primary banking or invoicing data sources, and our AI immediately begins structuring your historical data into a compliant format.' },
];

function FAQ() {
  const [open, setOpen] = useState(null);
  const [ref, visible] = useReveal(0.1);
  const left = faqs.slice(0, 3);
  const right = faqs.slice(3);

  return (
    <section id="faq" className="py-20 px-4 md:px-12">
      <div className="max-w-[1280px] mx-auto">
        <div
          ref={ref}
          className="text-center max-w-3xl mx-auto mb-20 transition-all duration-700"
          style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(20px)' }}
        >
          <div className="inline-flex items-center gap-1 bg-[#CCFBF1] text-[#0D9488] px-3 py-1.5 rounded-full text-[12px] font-semibold mb-6">
            <Icon name="bolt" style={{ fontSize: 14 }} /> SUPPORT & FAQ
          </div>
          <h2 className="text-[40px] md:text-[56px] font-bold text-[#0F172A] mb-6 leading-[1.2]" style={{ letterSpacing: '-0.02em' }}>
            Everything you need to know about AI-powered compliance.
          </h2>
          <p className="text-[18px] leading-[1.7] text-[#45464D]">Common questions from Malaysian SMEs and business owners.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[left, right].map((col, ci) => (
            <div key={ci} className="space-y-3">
              {col.map((item, idx) => {
                const key = ci * 3 + idx;
                const isOpen = open === key;
                return (
                  <div
                    key={key}
                    className={`bg-[#EFF4FF] border border-slate-200 rounded-lg overflow-hidden cursor-pointer transition-shadow hover:shadow-sm ${isOpen ? 'shadow-sm' : ''}`}
                    onClick={() => setOpen(isOpen ? null : key)}
                  >
                    <div className="flex justify-between items-center p-6">
                      <h3 className="text-[18px] font-medium text-[#0F172A] leading-[1.7] pr-6">{item.q}</h3>
                      <Icon
                        name="expand_more"
                        className="text-[#76777D] flex-shrink-0 transition-transform duration-300"
                        style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: isOpen ? '#009668' : undefined }}
                      />
                    </div>
                    <div
                      className="overflow-hidden transition-all duration-300"
                      style={{ maxHeight: isOpen ? 500 : 0, opacity: isOpen ? 1 : 0, paddingBottom: isOpen ? 24 : 0 }}
                    >
                      <p className="px-6 text-[#45464D] text-[16px] leading-[1.6]">{item.a}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════
   SECTION 10: FINAL CTA + FOOTER
   ══════════════════════════════════════════════════════ */
function FinalCTA() {
  const navigate = useNavigate();
  const [ref, visible] = useReveal(0.1);

  return (
    <section className="py-20 px-4 md:px-12 max-w-[1280px] mx-auto relative overflow-hidden">
      <div className="bg-[#131b2e] rounded-[24px] relative overflow-hidden shadow-2xl">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(circle at 0% 0%, rgba(107,216,203,0.15) 0%, transparent 50%), radial-gradient(circle at 100% 100%, rgba(78,222,163,0.1) 0%, transparent 50%)' }} />
        <div
          ref={ref}
          className="relative z-10 py-20 px-4 md:px-12 flex flex-col items-center text-center max-w-3xl mx-auto transition-all duration-700"
          style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(20px)' }}
        >
          <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#CCFBF1] mb-6 border border-[#99F6E4]">
            <Icon name="magic_button" className="text-[#0D9488]" style={{ fontSize: 16 }} filled />
            <span className="text-[12px] font-semibold text-[#0D9488] uppercase tracking-wide">AI-POWERED COMPLIANCE</span>
          </div>
          <h2 className="text-[40px] font-bold text-white mb-6 leading-[1.3]" style={{ letterSpacing: '-0.015em' }}>
            Ready to make tax season your competitive advantage?
          </h2>
          <p className="text-[18px] leading-[1.7] text-[#7C839B] mb-12">
            Join 2,400+ Malaysian businesses automating their compliance with Cukai.AI. Setup takes less than 5 minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-6 items-center w-full sm:w-auto mb-6">
            <button
              onClick={() => navigate('/getstarted')}
              className="w-full sm:w-auto bg-white text-[#131b2e] text-[12px] font-semibold px-6 py-3 rounded-lg hover:bg-[#EFF4FF] transition-all duration-200 shadow-md hover:-translate-y-1"
            >
              Get Started Free
            </button>
            <button className="w-full sm:w-auto bg-transparent border border-[#C6C6CD] text-white text-[12px] font-semibold px-6 py-3 rounded-lg hover:bg-white/10 transition-all duration-200">
              Book a Demo
            </button>
          </div>
          <div className="flex items-center gap-1 text-[#7C839B] opacity-80">
            <Icon name="verified" style={{ fontSize: 16 }} />
            <span className="text-[12px] font-semibold">No Credit Card Required • LHDN Verified</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <footer className="bg-[#131b2e] text-[#7C839B] w-full text-[16px] leading-[1.6]">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6 max-w-[1280px] mx-auto px-4 md:px-12 py-12">
        <div className="col-span-1 md:col-span-2 pr-12 flex flex-col gap-6">
          <div className="text-[28px] font-bold text-white">Cukai.AI</div>
          <p className="text-[#7C839B]/80 max-w-sm">Automating tax compliance for Malaysian SMEs and freelancers with precision and institutional trust.</p>
          <div className="mt-auto pt-6 flex flex-col gap-1">
            <p className="text-[#7C839B]/80 text-sm">© 2024 Cukai.AI. All rights reserved. Built for Malaysian SMEs.</p>
            <p className="text-[#4EDEA3] text-sm font-medium flex items-center gap-1">Proudly made for Malaysia 🇲🇾</p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-white mb-1">Product</h4>
          <button onClick={() => scrollTo('features')} className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors text-left">Features</button>
          <button onClick={() => scrollTo('pricing')} className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors text-left">Pricing</button>
          <button onClick={() => scrollTo('cukaibot')} className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors text-left">Cukai Bot</button>
        </div>
        <div className="flex flex-col gap-3">
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-white mb-1">Resources</h4>
          <a href="#" className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors">Blog</a>
          <a href="#" className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors">LHDN Guidelines</a>
          <a href="#" className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors">Tax Calculator</a>
        </div>
        <div className="flex flex-col gap-3">
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-white mb-1">Company</h4>
          <a href="#" className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors">About Us</a>
          <a href="#" className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors">Careers</a>
          <a href="#" className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors">Contact</a>
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-white mt-3 mb-1">Legal</h4>
          <a href="#" className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors">Privacy</a>
          <a href="#" className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors">Terms</a>
          <a href="#" className="text-[#7C839B]/80 hover:text-[#6FFBBE] transition-colors">Security</a>
        </div>
      </div>
    </footer>
  );
}

/* ══════════════════════════════════════════════════════
   GLOBAL KEYFRAMES  (injected once)
   ══════════════════════════════════════════════════════ */
const globalStyles = `
@keyframes fadeUp {
  0%   { opacity:0; transform:translateY(20px); }
  100% { opacity:1; transform:translateY(0); }
}
@keyframes fadeInDown {
  from { opacity:0; transform:translateY(-10px); }
  to   { opacity:1; transform:translateY(0); }
}
@keyframes float {
  0%,100% { transform:translateY(0px); }
  50%      { transform:translateY(-10px); }
}
@keyframes pulseRadial {
  0%,100% { transform:scale(1); opacity:.8; }
  50%      { transform:scale(1.05); opacity:.6; }
}
@keyframes marquee {
  0%   { transform:translateX(0%); }
  100% { transform:translateX(-50%); }
}
@keyframes slideDot {
  0%   { left:0%; }
  50%  { left:50%; }
  100% { left:100%; }
}
`;

/* ══════════════════════════════════════════════════════
   ROOT EXPORT
   ══════════════════════════════════════════════════════ */
function Home() {
  return (
    <>
      <style>{globalStyles}</style>
      {/* Material Symbols font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        rel="stylesheet"
      />
      <div className="bg-[#F8F9FF] min-h-screen text-[#0b1c30] antialiased overflow-x-hidden">
        <LandingNav />
        <Hero />
        <TrustBar />
        <Features />
        <HowItWorks />
        <ProductShowcase />
        <Testimonials />
        <Pricing />
        <FAQ />
        <FinalCTA />
        <Footer />
      </div>
    </>
  );
}

export default Home;