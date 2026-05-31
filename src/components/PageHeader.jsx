import { useState, useRef, useEffect } from 'react';
import cukaiLogo from '../assets/cukai-logo.png';
import cukaiBot from '../assets/cukaibot-icon.png';

// ── Icons ────────────────────────────────────────────────────────────────────

const OverviewIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);

const VaultIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12H2" />
    <path d="M5 12V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6" />
    <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const ReportsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
  </svg>
);

const BellIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const UserIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const ChevronDown = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// ── Dropdown ─────────────────────────────────────────────────────────────────

function Dropdown({ trigger, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen(o => !o)}>{trigger(open)}</div>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-slate-100 bg-white py-1 shadow-lg z-50">
          {items.map((item, i) =>
            item.divider
              ? <div key={i} className="my-1 border-t border-slate-100" />
              : (
                <a key={i} href={item.href || '#'} className="flex items-center gap-2.5 px-4 py-2 text-sm text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488] transition-colors duration-150">
                  {item.icon && <span className="text-[#64748B]">{item.icon}</span>}
                  {item.label}
                  {item.badge && <span className="ml-auto rounded-full bg-[#10B981] px-1.5 py-0.5 text-[10px] font-semibold text-white">{item.badge}</span>}
                </a>
              )
          )}
        </div>
      )}
    </div>
  );
}

// ── Dropdown content examples ─────────────────────────────────────────────────

const notificationItems = [
  { label: 'Notifications', icon: null },
  { divider: true },
  { label: 'Tax filing deadline soon', badge: 'New', href: '#' },
  { label: 'Receipt #1042 processed', href: '#' },
  { label: 'E-invoice sent to LHDN', href: '#' },
  { divider: true },
  { label: 'View all notifications', href: '#' },
];

const settingsItems = [
  { label: 'Settings', icon: null },
  { divider: true },
  { label: 'Company Profile', href: '/settings/company' },
  { label: 'Tax Preferences', href: '/settings/tax' },
  { label: 'Integrations', href: '/settings/integrations' },
  { divider: true },
  { label: 'Help & Support', href: '/support' },
];

const accountItems = [
  { label: 'My Account', icon: null },
  { divider: true },
  { label: 'Profile', href: '/account/profile' },
  { label: 'Billing & Plan', href: '/account/billing' },
  { label: 'Team Members', href: '/account/team' },
  { divider: true },
  { label: 'Log out', href: '/logout' },
];

// ── Nav links ─────────────────────────────────────────────────────────────────

const navLinks = [
  { href: '/overview', label: 'Overview', Icon: OverviewIcon },
  { href: '/vault', label: 'Vault', Icon: VaultIcon },
  { href: '/reports', label: 'Reports', Icon: ReportsIcon },
];

// ── Component ─────────────────────────────────────────────────────────────────

function PageHeader() {
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

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {navLinks.map(({ href, label, Icon }) => (
            <a key={label} href={href} className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-[#0F172A] transition-colors duration-150 hover:bg-[#f0fdf9] hover:text-[#0D9488]">
              <Icon />
              {label}
            </a>
          ))}
          <a href="/cukaibot" className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-[#0F172A] transition-colors duration-150 hover:bg-[#f0fdf9] hover:text-[#0D9488]">
            <img src={cukaiBot} alt="CukaiBot" className="h-[26px] w-[26px] -m-[5px] shrink-0 object-contain" />
            CukaiBot
          </a>
        </nav>

        {/* Right icons */}
        <div className="flex items-center gap-1">

          {/* Notifications */}
          <Dropdown
            items={notificationItems}
            trigger={(open) => (
              <button className={`relative flex h-9 w-9 items-center justify-center rounded-lg text-[#64748B] transition-colors duration-150 hover:bg-[#f0fdf9] hover:text-[#0D9488] ${open ? 'bg-[#f0fdf9] text-[#0D9488]' : ''}`}>
                <BellIcon />
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#10B981]" />
              </button>
            )}
          />

          {/* Settings */}
          <Dropdown
            items={settingsItems}
            trigger={(open) => (
              <button className={`flex h-9 w-9 items-center justify-center rounded-lg text-[#64748B] transition-colors duration-150 hover:bg-[#f0fdf9] hover:text-[#0D9488] ${open ? 'bg-[#f0fdf9] text-[#0D9488]' : ''}`}>
                <SettingsIcon />
              </button>
            )}
          />

          {/* Account */}
          <Dropdown
            items={accountItems}
            trigger={(open) => (
              <button className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[#64748B] transition-colors duration-150 hover:bg-[#f0fdf9] hover:text-[#0D9488] ${open ? 'bg-[#f0fdf9] text-[#0D9488]' : ''}`}>
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0F172A] text-white">
                  <UserIcon />
                </div>
                <ChevronDown />
              </button>
            )}
          />

        </div>
      </div>
    </header>
  );
}

export default PageHeader;