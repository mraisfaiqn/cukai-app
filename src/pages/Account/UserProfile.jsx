import React from 'react';
import {NavLink} from 'react-router-dom';
import { BrowserRouter as Route, Router, Routes } from 'react-router-dom';
import UserNavigation from '../../components/UserNavigation';

// ── Shared Design Icons (Standardized to match PageHeader SVG metrics) ────────
const InfoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px] shrink-0 text-[#0D9488]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const BuildingIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px] text-[#64748B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <line x1="9" y1="22" x2="9" y2="16" />
    <line x1="15" y1="22" x2="15" y2="16" />
    <line x1="9" y1="16" x2="15" y2="16" />
    <path d="M8 6h2v2H8V6zm4 0h2v2h-2V6zm4 0h2v2h-2V6zM8 10h2v2H8v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z" />
  </svg>
);

const UsersIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px] text-[#64748B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const SwitchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 3 21 8 16 13" />
    <line x1="21" y1="8" x2="9" y2="8" />
    <polyline points="8 21 3 16 8 11" />
    <line x1="3" y1="16" x2="15" y2="16" />
  </svg>
);

const ShieldCheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-[#10B981]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 11 2 2 4-4" />
  </svg>
);

const SparklesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-[#10B981]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

const MoreVerticalIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#64748B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="19" r="1" />
  </svg>
);

// ── Sub-components styled using PageHeader guidelines ───────────────────────

const EntityCard = ({ Icon, name, type, ssmNo, tin, active, actionText }) => (
  <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm relative overflow-hidden">
    <div className="flex justify-between items-start mb-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-[#f0fdf9] rounded-lg border border-slate-100">
          <Icon />
        </div>
        <div>
          <h3 className="text-base font-bold text-[#0F172A]">{name}</h3>
          <p className="text-xs text-[#64748B]">{type}</p>
        </div>
      </div>
      {active && (
        <span className="bg-[#f0fdf9] text-[#0D9488] border border-emerald-100 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
          Active Entity
        </span>
      )}
    </div>
    
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs mb-6">
      <span className="text-[#64748B]">SSM No:</span>
      <span className="font-semibold text-[#0F172A]">{ssmNo}</span>
      <span className="text-[#64748B]">TIN:</span>
      <span className="font-semibold text-[#0F172A]">{tin}</span>
    </div>

    <div className="flex gap-2">
      {active ? (
        <>
          <button className="flex-1 text-center py-2 px-3 text-xs border border-slate-100 rounded-lg font-medium text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488] transition-colors duration-150">
            Edit Details
          </button>
          <button className="py-2 px-3 text-xs border border-slate-100 rounded-lg font-medium text-[#64748B] hover:bg-slate-50 transition-colors duration-150">
            Archive
          </button>
        </>
      ) : (
        <>
          <button className="flex-1 py-2 px-3 text-xs bg-[#0D9488] text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 hover:bg-[#0f766e] transition-colors duration-150">
            <SwitchIcon />
            {actionText}
          </button>
          <button className="py-2 px-3 text-xs border border-slate-100 rounded-lg font-medium text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488] transition-colors duration-150">
            Edit
          </button>
        </>
      )}
    </div>
  </div>
);

const TeamTable = () => {
  const team = [
    { name: 'Hafiz Razak', initial: 'H', email: 'hafiz@printingdesign.com', role: 'Owner', status: 'Active', statusColor: 'text-[#0D9488]' },
    { name: 'Siti Aminah', initial: 'S', email: 'siti.a@cukai.ai (External)', role: 'Admin', status: 'Active', statusColor: 'text-[#0D9488]' },
    { name: 'Lim Wei Kiat', initial: 'L', email: 'weikiat@accounting.co', role: 'Viewer', status: 'Pending Invite', statusColor: 'text-amber-600' },
  ];

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-slate-100 bg-white">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/50 text-xs font-semibold uppercase tracking-wider text-[#64748B]">
            <th className="py-3.5 px-5">Name</th>
            <th className="py-3.5 px-5">Email</th>
            <th className="py-3.5 px-5">Role</th>
            <th className="py-3.5 px-5">Status</th>
            <th className="py-3.5 px-5 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {team.map((member) => (
            <tr key={member.name} className="text-[#0F172A] transition-colors duration-150 hover:bg-slate-50/40">
              <td className="py-3.5 px-5 font-medium">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0F172A] text-white text-xs font-bold">
                    {member.initial}
                  </div>
                  <span>{member.name}</span>
                </div>
              </td>
              <td className="py-3.5 px-5 text-[#64748B]">{member.email}</td>
              <td className="py-3.5 px-5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${member.role === 'Owner' ? 'bg-[#f0fdf9] text-[#0D9488]' : 'bg-slate-100 text-[#64748B]'}`}>
                  {member.role}
                </span>
              </td>
              <td className="py-3.5 px-5">
                <span className={`inline-flex items-center gap-1.5 font-medium ${member.statusColor}`}>
                  <span className="h-1.5 w-1.5 rounded-full current-color bg-currentColor" />
                  {member.status}
                </span>
              </td>
              <td className="py-3.5 px-5 text-right">
                <div className="flex items-center justify-end gap-3">
                  {member.role === 'Owner' ? (
                    <span className="text-xs text-[#64748B]">Access Lock</span>
                  ) : member.status === 'Pending Invite' ? (
                    <div className="flex items-center gap-2">
                      <button className="text-xs font-medium text-[#64748B] hover:text-[#0F172A]">Remind</button>
                      <button className="rounded p-1 hover:bg-slate-100"><MoreVerticalIcon /></button>
                    </div>
                  ) : (
                    <button className="text-xs font-medium text-red-600 hover:text-red-700">Revoke Access</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Main View Panel ─────────────────────────────────────────────────────────

function UserProfile() {
  const tabs = ['Profile & Entities', 'Team Access', 'Notifications', 'Language & Display'];
  const activeTab = 'Profile & Entities';

  return (
    <div className="w-full space-y-8 py-4">
      {/* Page Title Header block */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">Account Settings</h1>
        <p className="text-sm text-[#64748B] mt-1">Manage your business entities, team members, and interface preferences.</p>
      </div>

      {/* Primary Tab Navigation Control matching PageHeader anchors */}
      <nav className="flex items-center gap-1 border-b border-slate-100 pb-px">
        {tabs.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <button
              key={tab}
              className={`relative px-4 py-2.5 text-sm font-medium transition-all duration-150 ${
                isActive 
                  ? 'text-[#0D9488] font-semibold' 
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              {tab}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#10B981]" />
              )}
            </button>
          );
        })}
      </nav>




      {/* Info Context Alert banner box */}
      <div className="flex gap-3.5 rounded-xl border border-slate-100 bg-[#f0fdf9] p-4 text-sm text-[#64748B]">
        <InfoIcon />
        <div className="space-y-1">
          <h4 className="font-semibold text-[#0F172A]">Entity Switcher Guide</h4>
          <p className="leading-relaxed">
            Switching entities lets you file Form P (Partnership) and Form B (Self-Employed/Sole Prop) from the same account. 
            All data remains siloed per entity for audit compliance.
          </p>
        </div>
      </div>

      {/* Workspace Business Entity Segment */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#0F172A]">Your Managed Entities</h2>
          <button className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D9488] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0f766e] transition-colors duration-150">
            <PlusIcon />
            Create New Entity
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <EntityCard 
            Icon={BuildingIcon}
            name="Hafiz Printing & Design" 
            type="Sole Proprietorship" 
            ssmNo="202103145678 (TR02145)" 
            tin="IG 8823415601" 
            active 
          />
          <EntityCard 
            Icon={UsersIcon}
            name="Urban Brew Partners" 
            type="General Partnership" 
            ssmNo="202301982734" 
            tin="D 1109283745" 
            actionText="Switch to Entity" 
          />
        </div>
      </div>

      {/* Team Access Allocation Control Segment */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#0F172A]">Team Access — Hafiz Printing</h2>
          <button className="inline-flex items-center gap-1.5 rounded-lg border border-slate-100 bg-white px-3.5 py-2 text-xs font-semibold text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488] transition-colors duration-150">
            <PlusIcon />
            Invite Member
          </button>
        </div>
        <TeamTable />
      </div>

      {/* Informative Promotional Widget cards layout matching custom designs */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex gap-4 rounded-xl border border-slate-100 bg-gradient-to-br from-[#0F172A] to-[#1E293B] p-6 text-white relative overflow-hidden">
          <div className="space-y-2 flex-1">
            <h3 className="text-lg font-bold tracking-tight">Automated Filing Beta</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Your entities are being synchronized with LHDN e-Filing protocols. Ensure your digital certificate is updated in the "Tax Documents" tab.
            </p>
          </div>
          <div className="opacity-20 shrink-0 self-center">
            <ShieldCheckIcon />
          </div>
        </div>

        <div className="flex gap-4 rounded-xl border border-slate-100 bg-[#f0fdf9]/30 p-6 relative overflow-hidden">
          <div className="space-y-2 flex-1">
            <h3 className="text-lg font-bold tracking-tight text-[#0F172A]">AI Co-Pilot</h3>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Optimizing entity structures for maximum tax relief eligibility seamlessly with standard accounting procedures.
            </p>
          </div>
          <div className="shrink-0 self-center">
            <SparklesIcon />
          </div>
        </div>
      </div>
    </div>
  );
}

function RoutingUser(){
  return(
    <Router> //This is not in use yet
          <UserNavigation />
          <Routes>
            <Route path="/profile" element={<UserProfiler />} />
            <Route path="/team-access" element={<>We are Building</>} />
            <Route path="/notifications" element={<>In Development</>} />
            <Route path="/language-display" element={<>Under Construction</>} />
          </Routes>
        </Router>
  )
}
export default UserProfile;