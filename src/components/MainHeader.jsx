import cukaiLogo from '../assets/cukai-logo.png';

const PricingIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const FeaturesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const DocsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const navLinks = [
  { href: '/pricing', label: 'Pricing', Icon: PricingIcon },
  { href: '/features', label: 'Features', Icon: FeaturesIcon },
  { href: '/docs', label: 'Docs', Icon: DocsIcon },
];

function MainHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-100 bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2.5">
          <img src={cukaiLogo} alt="Cukai.ai logo" className="h-10 w-10 shrink-0" />
          <span className="select-none text-xl font-bold tracking-tight text-[#0F172A]">
            cukai
            <span className="text-[#10B981]">.</span>
            <span className="font-light text-[#64748B]">ai</span>
          </span>
        </a>
        {/* Navigation Link */}
        <nav className="flex items-center gap-1">
          {navLinks.map(({ href, label, Icon }) => (
            <a key={label} href={href} className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-[#0F172A] transition-colors duration-150 hover:bg-[#f0fdf9] hover:text-[#0D9488]">
              <Icon />
              {label}
            </a>
          ))}
        </nav>
        {/* Login and Get Started */}
        <div className="flex items-center gap-2">
          <a href="/auth" className="rounded-lg border-[1.5px] border-[#0F172A] px-[18px] py-2 text-sm font-medium text-[#0F172A] transition-colors duration-150 hover:bg-[#0F172A] hover:text-white">
            Login
          </a>
          <a href="/demo" className="rounded-lg border-[1.5px] border-[#10B981] bg-[#10B981] px-[18px] py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-[#0D9488] hover:border-[#0D9488]">
            Demo
          </a>
        </div>

      </div>
    </header>
  );
}

export default MainHeader;