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

const VaultIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

const SunIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const DocsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-[15px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
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
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-[#0F172A] hover:bg-red-50 hover:text-red-600 transition-colors duration-150 text-left bg-transparent border-none cursor-pointer"
                >
                  {item.icon && <span className="text-[#64748B]">{item.icon}</span>}
                  {item.label}
                </button>
              )
              : navLinks
              ? (
                <NavLink key={i} to={item.href || '#'} className={({ isActive }) => `flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-150 ${isActive ? 'bg-[#f0fdf9] text-[#0D9488]' : 'text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}>
                  {item.icon && <span className="text-[#64748B]">{item.icon}</span>}
                  {item.label}
                  {item.badge && <span className="ml-auto rounded-full bg-[#10B981] px-1.5 py-0.5 text-[10px] font-semibold text-white">{item.badge}</span>}
                </NavLink>
              )
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
          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Notifications</p>
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
            View all insights
          </NavLink>
        </div>
      )}
    </div>
  );
}

function SettingsDropdown({ trigger }) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState('EN'); 
  const [theme, setTheme] = useState('Light'); 
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
        <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-slate-100 bg-white py-1 shadow-lg z-50">
          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Settings</p>
          <div className="my-1 border-t border-slate-100" />

          {/* Language toggle */}
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-sm text-[#0F172A]">Language</span>
            <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
              <button
                onClick={() => setLang('EN')}
                className={`px-2.5 py-1 transition-colors duration-150 ${lang === 'EN' ? 'bg-[#0D9488] text-white' : 'text-[#64748B] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}
              >
                EN
              </button>
              <button
                onClick={() => setLang('BM')}
                className={`px-2.5 py-1 transition-colors duration-150 ${lang === 'BM' ? 'bg-[#0D9488] text-white' : 'text-[#64748B] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}
              >
                BM
              </button>
            </div>
          </div>

          {/* Light/Dark toggle */}
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-sm text-[#0F172A]">Appearance</span>
            <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
              <button
                onClick={() => setTheme('Light')}
                className={`flex items-center gap-1 px-2.5 py-1 transition-colors duration-150 ${theme === 'Light' ? 'bg-[#0D9488] text-white' : 'text-[#64748B] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}
              >
                <SunIcon />
              </button>
              <button
                onClick={() => setTheme('Dark')}
                className={`flex items-center gap-1 px-2.5 py-1 transition-colors duration-150 ${theme === 'Dark' ? 'bg-[#0D9488] text-white' : 'text-[#64748B] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}
              >
                <MoonIcon />
              </button>
            </div>
          </div>

          <div className="my-1 border-t border-slate-100" />

          {/* Docs link */}
          <NavLink to="/userdocs" className={({ isActive }) => `flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-150 ${isActive ? 'bg-[#f0fdf9] text-[#0D9488]' : 'text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}>
            <span className="text-[#64748B]"><DocsIcon /></span>
            Docs
          </NavLink>
        </div>
      )}
    </div>
  );
}

/* 3. MOVED: Removed static accountItems from here and placed inside PageHeader below */

// ── Nav links ─────────────────────────────────────────────────────────────────

const navLinks = [
  { href: '/overview', label: 'Overview', Icon: OverviewIcon },
  { href: '/vault', label: 'Vault', Icon: VaultIcon },
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
    { label: 'Terms & Conditions', href: '/termsconditions' },
    { divider: true },
    { label: 'Log out', onClick: handleLogout }, // <-- Assigned onClick callback here
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
            <NavLink key={label} to={href} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-150 ${isActive ? 'bg-[#f0fdf9] text-[#0D9488]' : 'text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}>
              <Icon />
              {label}
            </NavLink>
          ))}
          <NavLink to="/cukaibot" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-150 ${isActive ? 'bg-[#f0fdf9] text-[#0D9488]' : 'text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}>
            <img src={cukaiBot} alt="CukaiBot" className="h-[26px] w-[26px] -m-[5px] shrink-0 object-contain" />
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

          {/* Settings */}
          <SettingsDropdown
            trigger={(open) => (
              <button className={`flex h-9 w-9 items-center justify-center rounded-lg text-[#64748B] transition-colors duration-150 hover:bg-[#f0fdf9] hover:text-[#0D9488] ${open ? 'bg-[#f0fdf9] text-[#0D9488]' : ''}`}>
                <SettingsIcon />
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