import React from 'react';

const InfoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[16px] w-[16px] shrink-0 text-[#0D9488]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);
const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const BuildingIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[16px] w-[16px] text-[#64748B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" /><line x1="9" y1="22" x2="9" y2="16" /><line x1="15" y1="22" x2="15" y2="16" /><line x1="9" y1="16" x2="15" y2="16" />
    <path d="M8 6h2v2H8V6zm4 0h2v2h-2V6zM8 10h2v2H8v-2zm4 0h2v2h-2v-2z" />
  </svg>
);
const UsersIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[16px] w-[16px] text-[#64748B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const SwitchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 3 21 8 16 13" /><line x1="21" y1="8" x2="9" y2="8" /><polyline points="8 21 3 16 8 11" /><line x1="3" y1="16" x2="15" y2="16" />
  </svg>
);
const ShieldCheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-[#10B981]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 11 2 2 4-4" />
  </svg>
);
const SparklesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-[#10B981]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

const EntityCard = ({ Icon, name, type, ssmNo, tin, active, actionText }) => (
  <div className="h-full bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col text-left">
    <div className="flex justify-between items-start mb-3">
      <div className="flex items-center gap-2.5">
        <div className="p-2 bg-[#f0fdf9] rounded-lg border border-slate-100"><Icon /></div>
        <div>
          <h3 className="text-sm font-bold text-[#0F172A]">{name}</h3>
          <p className="text-[11px] text-[#64748B]">{type}</p>
        </div>
      </div>
      {active && (
        <span className="bg-[#f0fdf9] text-[#0D9488] border border-emerald-100 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0">
          Active
        </span>
      )}
    </div>
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs mb-3 flex-1">
      <span className="text-[#64748B]">SSM No:</span><span className="font-semibold text-[#0F172A]">{ssmNo}</span>
      <span className="text-[#64748B]">TIN:</span><span className="font-semibold text-[#0F172A]">{tin}</span>
    </div>
    <div className="flex gap-2">
      {active ? (
        <>
          <button className="flex-1 text-center py-1.5 px-3 text-xs border border-slate-100 rounded-lg font-medium text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488] transition-colors duration-150">Edit Details</button>
          <button className="py-1.5 px-3 text-xs border border-slate-100 rounded-lg font-medium text-[#64748B] hover:bg-slate-50 transition-colors duration-150">Archive</button>
        </>
      ) : (
        <>
          <button className="flex-1 py-1.5 px-3 text-xs bg-[#0D9488] text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 hover:bg-[#0f766e] transition-colors duration-150"><SwitchIcon />{actionText}</button>
          <button className="py-1.5 px-3 text-xs border border-slate-100 rounded-lg font-medium text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488] transition-colors duration-150">Edit</button>
        </>
      )}
    </div>
  </div>
);

export default function ProfileTab() {
  return (
    <div className="h-full flex flex-col gap-3">

      {/* Info banner */}
      <div className="shrink-0 flex gap-3 rounded-xl border border-slate-100 bg-[#f0fdf9] p-3 text-xs text-[#64748B]">
        <InfoIcon />
        <div>
          <h4 className="font-semibold text-[#0F172A] text-xs">Entity Switcher Guide</h4>
          <p className="leading-relaxed mt-0.5">Switching entities lets you file Form P (Partnership) and Form B (Self-Employed/Sole Prop) from the same account. All data remains siloed per entity for audit compliance.</p>
        </div>
      </div>

      {/* Entities — flex-1 so they fill remaining height */}
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-sm font-bold text-[#0F172A]">Your Managed Entities</h2>
          <button className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0f766e] transition-colors duration-150"><PlusIcon />Create New Entity</button>
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-3">
          <EntityCard Icon={BuildingIcon} name="Hafiz Printing & Design" type="Sole Proprietorship" ssmNo="202103145678 (TR02145)" tin="IG 8823415601" active />
          <EntityCard Icon={UsersIcon} name="Urban Brew Partners" type="General Partnership" ssmNo="202301982734" tin="D 1109283745" actionText="Switch to Entity" />
        </div>
      </div>

      {/* Bottom promo cards */}
      <div className="shrink-0 grid grid-cols-2 gap-3">
        <div className="flex gap-3 rounded-xl border border-slate-100 bg-gradient-to-br from-[#0F172A] to-[#1E293B] p-4 text-white">
          <div className="flex-1">
            <h3 className="text-sm font-bold tracking-tight">Automated Filing Beta</h3>
            <p className="text-[11px] text-slate-300 leading-relaxed mt-1">Your entities are being synchronized with LHDN e-Filing protocols. Ensure your digital certificate is updated in the "Tax Documents" tab.</p>
          </div>
          <div className="opacity-20 shrink-0 self-center"><ShieldCheckIcon /></div>
        </div>
        <div className="flex gap-3 rounded-xl border border-slate-100 bg-[#f0fdf9]/30 p-4">
          <div className="flex-1">
            <h3 className="text-sm font-bold tracking-tight text-[#0F172A]">AI Co-Pilot</h3>
            <p className="text-[11px] text-[#64748B] leading-relaxed mt-1">Optimizing entity structures for maximum tax relief eligibility seamlessly with standard accounting procedures.</p>
          </div>
          <div className="shrink-0 self-center"><SparklesIcon /></div>
        </div>
      </div>

    </div>
  );
}