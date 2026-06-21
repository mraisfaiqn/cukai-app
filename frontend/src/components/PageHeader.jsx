// To integrate the logout functionality seamlessly, we need to make adjustments in three specific areas of your file:

// 1. **The `Dropdown` Component:** It needs to check if an item contains an `onClick` callback (for the logout button) instead of blindly assuming every item is a link.
// 2. **The `PageHeader` Component:** It must accept the `onLogout` prop from `App.jsx` and use React Router's `useNavigate` to handle the redirection.
// 3. **The `accountItems` Array:** It needs to be moved *inside* the `PageHeader` component so it can access the `onLogout` logic directly.

import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom'; // 1. Added useNavigate here
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

const CalculatorIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <line x1="8" y1="6" x2="16" y2="6" />
    <line x1="8" y1="10" x2="8" y2="10" /><line x1="12" y1="10" x2="12" y2="10" /><line x1="16" y1="10" x2="16" y2="10" />
    <line x1="8" y1="14" x2="8" y2="14" /><line x1="12" y1="14" x2="12" y2="14" /><line x1="16" y1="14" x2="16" y2="18" />
    <line x1="8" y1="18" x2="12" y2="18" />
  </svg>
);

const AccountIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[16px] w-[16px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12H2" />
    <path d="M5 12V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6" />
    <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const BellIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
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

// ── Dropdown (generic) ────────────────────────────────────────────────────────

function Dropdown({ trigger, items, navLinks = false }) {
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
              : item.heading
              ? (
                <p key={i} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                  {item.label}
                </p>
              )
              : item.onClick
              ? (
                <button
                  key={i}
                  onClick={() => {
                    item.onClick();
                    setOpen(false); // ✅ Already handles closing correctly
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-[#0F172A] hover:bg-red-50 hover:text-red-600 transition-colors duration-150 text-left bg-transparent border-none cursor-pointer"
                >
                  {item.icon && <span className="text-[#64748B]">{item.icon}</span>}
                  {item.label}
                </button>
              )
              : navLinks
              ? (
                <NavLink 
                  key={i} 
                  to={item.href || '#'} 
                  onClick={() => setOpen(false)} // 🔥 Added to close dropdown on link click
                  className={({ isActive }) => `flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-150 ${isActive ? 'bg-[#f0fdf9] text-[#0D9488]' : 'text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}
                >
                  {item.icon && <span className="text-[#64748B]">{item.icon}</span>}
                  {item.label}
                  {item.badge && <span className="ml-auto rounded-full bg-[#10B981] px-1.5 py-0.5 text-[10px] font-semibold text-white">{item.badge}</span>}
                </NavLink>
              )
              : (
                <a 
                  key={i} 
                  href={item.href || '#'} 
                  onClick={() => setOpen(false)} // 🔥 Added to close dropdown on anchor click
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488] transition-colors duration-150"
                >
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

// ── Dropdown content ──────────────────────────────────────────────────────────

const insightsAIItems = [
  { label: 'Tax filing deadline soon', badge: 'New' },
  { label: 'Receipt #1042 processed' },
  { label: 'E-invoice generated' },
];

function InsightsAIDropdown({ trigger }) {
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
        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-slate-100 bg-white py-1 shadow-lg z-50">
          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">AI Insights✨</p>
          <div className="my-1 border-t border-slate-100" />
          {insightsAIItems.map((item, i) => (
            <div key={i} className="flex items-start gap-2.5 px-4 py-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#10B981]" />
              <span className="text-sm text-[#0F172A] leading-snug">{item.label}</span>
              {item.badge && (
                <span className="ml-auto shrink-0 rounded-full bg-[#10B981] px-1.5 py-0.5 text-[10px] font-semibold text-white">{item.badge}</span>
              )}
            </div>
          ))}
          <div className="my-1 border-t border-slate-100" />
          <NavLink
            to="/insightsinbox"
            onClick={() => setOpen(false)}
            className={({ isActive }) => `flex items-center justify-center px-4 py-2 text-sm font-medium transition-colors duration-150 ${isActive ? 'text-[#0D9488]' : 'text-[#0D9488] hover:bg-[#f0fdf9]'}`}
          >
            View All
          </NavLink>
        </div>
      )}
    </div>
  );
}

// ── Nav links ─────────────────────────────────────────────────────────────────

const navLinks = [
  { href: '/overview', label: 'Overview', Icon: OverviewIcon },
  { href: '/relief-calculator', label: 'Calculator', Icon: CalculatorIcon },
  { href: '/account', label: 'Account', Icon: AccountIcon },
];

// ── Component ─────────────────────────────────────────────────────────────────

// 4. UPDATED: Added { onLogout } prop to the main PageHeader component
function PageHeader({ onLogout }) {
  const navigate = useNavigate(); // 5. Added initialization hook

  const handleLogout = () => {
    onLogout();     // Changes isAuthenticated state to false
    navigate('/');  // Sends user back to landing page
  };

  // 6. MOVED & UPDATED: Added accountItems dynamically inside the component to use handleLogout
  const accountItems = [
    { heading: true, label: 'My Account' },
    { divider: true },
    { label: 'Manage Account', href: '/manageaccount' },
    { label: 'Documentation', href: '/documentation' },
    { label: 'Terms & Conditions', href: '/termsconditions' },
    { divider: true },
    { label: 'Log Out', onClick: handleLogout }, // <-- Assigned onClick callback here
  ];

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
            <NavLink key={label} to={href} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-base font-medium transition-colors duration-150 ${isActive ? 'bg-[#f0fdf9] text-[#0D9488]' : 'text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}>
              <Icon />
              {label}
            </NavLink>
          ))}
          <NavLink to="/cukaibot" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-base font-medium transition-colors duration-150 ${isActive ? 'bg-[#f0fdf9] text-[#0D9488]' : 'text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}>
            <img src={cukaiBot} alt="CukaiBot" className="h-6 w-6 -m-1 object-contain" />
            CukaiBot
          </NavLink>
        </nav>

        {/* Right icons */}
        <div className="flex items-center gap-1">

          {/* AI Insights */}
          <InsightsAIDropdown
            trigger={(open) => (
              <button className={`relative flex h-9 w-9 items-center justify-center rounded-lg text-[#64748B] transition-colors duration-150 hover:bg-[#f0fdf9] hover:text-[#0D9488] ${open ? 'bg-[#f0fdf9] text-[#0D9488]' : ''}`}>
                <BellIcon />
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#10B981]" />
              </button>
            )}
          />

          {/* Account */}
          <Dropdown
            navLinks
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