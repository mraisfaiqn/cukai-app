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

const AccountIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[16px] w-[16px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const InsightsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[16px] w-[16px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
    <path d="M4 17v2" />
    <path d="M5 18H3" />
  </svg>
);

const UserIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        <div className="absolute right-0 top-full mt-2 w-48 overflow-hidden rounded-xl border border-slate-100 bg-white pb-1 shadow-lg z-50">
          {items.map((item, i) =>
            item.divider
              ? <div key={i} className="my-1 border-t border-slate-100" />
              : item.heading
              ? (
                <p key={i} className="bg-[#0F172A] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#39FFD6]">
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
                  className={({ isActive }) => `flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-150 ${isActive ? 'bg-primary-tint text-primary' : 'text-[#0F172A] hover:bg-primary-tint hover:text-primary'}`}
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
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-[#0F172A] hover:bg-primary-tint hover:text-primary transition-colors duration-150"
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

// ── Nav links ─────────────────────────────────────────────────────────────────

const navLinks = [
  { href: '/overview', label: 'Overview', Icon: OverviewIcon },
  { href: '/account', label: 'Documents', Icon: AccountIcon },
  { href: '/insightsinbox', label: 'Insights', Icon: InsightsIcon },
];

// ── Component ─────────────────────────────────────────────────────────────────

// 4. UPDATED: Added { onLogout } prop to the main PageHeader component
function PageHeader({ onLogout }) {
  const navigate = useNavigate(); // 5. Added initialization hook

  const handleLogout = () => {
    // Clear every user-scoped key so the next login (even a different account
    // in the same browser) never inherits stale state — this was the cause of
    // a second test user seeing the previous user's selected entity on login.
    localStorage.removeItem('userId');
    localStorage.removeItem('userFullName');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('activeEntityId');
    // CukaiBot.jsx persists one "last active chat session" key per entity
    // (cukaiActiveSessionId:<entityId>) — there can be several of these (one
    // per entity the user had open), so they're swept by prefix rather than
    // removed by a single fixed key like the ones above.
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('cukaiActiveSessionId:')) localStorage.removeItem(key);
    }

    onLogout();     // Changes isAuthenticated state to false
    navigate('/');  // Sends user back to landing page
  };

  // 6. MOVED & UPDATED: Added accountItems dynamically inside the component to use handleLogout
  const accountItems = [
    { heading: true, label: 'My Account' },
    { divider: true },
    { label: 'Manage Account', href: '/manageaccount' },
    { label: 'User Manual', href: '/documentation' },
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
            cuk<span className="font-light text-[#64748B]">ai</span>
          </span>
        </a>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {navLinks.map(({ href, label, Icon }) => (
            <NavLink key={label} to={href} className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-base font-medium transition-colors duration-150 ${isActive ? 'bg-primary-tint text-primary' : 'text-[#0F172A] hover:bg-primary-tint hover:text-primary'}`}>
              <Icon />
              {label}
            </NavLink>
          ))}
          <NavLink to="/cukaibot" className={({ isActive }) => `flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-base font-medium transition-colors duration-150 ${isActive ? 'bg-primary-tint text-primary' : 'text-[#0F172A] hover:bg-primary-tint hover:text-primary'}`}>
            <img src={cukaiBot} alt="CukaiBot" className="h-6.5 w-6.5 pt-0.5 -m-1 object-contain" />
            Cukai Bot
          </NavLink>
        </nav>

        {/* Right icons */}
        <div className="flex items-center">
          {/* Account */}
          <Dropdown
            navLinks
            items={accountItems}
            trigger={(open) => (
              <button className={`group flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[#64748B] transition-colors duration-150 hover:text-primary ${open ? 'text-primary' : ''}`}>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0F172A] text-primary transition-colors duration-150 group-hover:text-[#39FFD6]">
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