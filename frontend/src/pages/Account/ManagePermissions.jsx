import React, { useState } from 'react';

const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-[#64748B] hover:text-[#0F172A] cursor-pointer transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-[#64748B] hover:text-red-600 cursor-pointer transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-emerald-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const AuditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[16px] w-[16px] text-[#64748B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);



function ManagePermission() {
  const [activeTab, setActiveTab] = useState('Hafiz Printing & Design');
  const members = [
    { name: 'Hafiz Razak', email: 'hafiz@printing.com', role: 'Owner', status: 'Active', bg: 'bg-emerald-500', isYou: true },
    { name: 'Siti Ahmad', email: 'siti.a@cukai.ai', role: 'Admin', status: 'Active', bg: 'bg-blue-500' },
    { name: 'Lim Wei Kiat', email: 'weikiat@accounting.co', role: 'Viewer', status: 'Pending Invite', bg: 'bg-slate-400' },
    { name: 'Raj Kumar', email: 'raj@consulting.by', role: 'Editor', status: 'Active', bg: 'bg-amber-500' },
  ];

  return (
    <div className="h-full flex flex-col gap-3">

      {/* Role permissions — compact strip at top */}
      <div className="shrink-0 grid grid-cols-4 gap-2">
          {[
            { title: 'Owner', icon: '♔', bgColor: 'bg-emerald-50', iconColor: 'text-emerald-700', description: 'Full access to all entities and settings', permissions: ['Manage team', 'Edit entities', 'View all reports', 'Billing access'] },
            { title: 'Admin', icon: '🛡', bgColor: 'bg-blue-50', iconColor: 'text-blue-700', description: 'Manage team and entities, no billing', permissions: ['Manage team', 'Edit entities', 'View all reports'] },
            { title: 'Editor', icon: '✎', bgColor: 'bg-amber-50', iconColor: 'text-amber-700', description: 'Edit and submit tax documents', permissions: ['Edit entities', 'View all reports'] },
            { title: 'Viewer', icon: '👁', bgColor: 'bg-slate-50', iconColor: 'text-slate-600', description: 'Read-only access to assigned entities', permissions: ['View all reports'] },
          ].map(({ title, icon, bgColor, iconColor, description, permissions }) => (
            <div key={title} className="bg-white rounded-lg border border-slate-100 shadow-sm p-2.5 flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className={`w-5 h-5 rounded ${bgColor} ${iconColor} flex items-center justify-center font-bold text-[10px]`}>{icon}</span>
                <h4 className="text-[11px] font-bold text-[#0F172A]">{title}</h4>
              </div>
              <p className="text-[10px] text-[#64748B] leading-snug">{description}</p>
              <ul className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                {permissions.map((perm, idx) => (
                  <li key={idx} className="flex items-center gap-1 text-[10px] text-[#0F172A]"><CheckIcon /><span>{perm}</span></li>
                ))}
              </ul>
            </div>
          ))}
      </div>

      {/* Team members card — fills remaining height */}
      <div className="flex-1 min-h-0 bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col gap-2">
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">Team Members</h2>
            <p className="text-[11px] text-[#64748B]">Manage who has access to your entities.</p>
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F172A] text-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-800 transition-colors"><PlusIcon />Invite Member</button>
        </div>

        <div className="flex gap-2 shrink-0">
          {['Hafiz Printing & Design', 'Urban Brew Partners'].map((entity) => (
            <button key={entity} onClick={() => setActiveTab(entity)} className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${activeTab === entity ? 'bg-[#0F172A] text-white' : 'bg-slate-100 text-[#64748B] hover:bg-slate-200'}`}>{entity}</button>
          ))}
        </div>

        <div className="flex-1 min-h-0 border border-slate-100 rounded-xl overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="sticky top-0 border-b border-slate-100 bg-slate-50 text-[#64748B] font-semibold uppercase tracking-wider">
                <th className="py-2 px-3">Name</th><th className="py-2 px-3">Email</th><th className="py-2 px-3">Role</th><th className="py-2 px-3">Status</th><th className="py-2 px-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[#0F172A]">
              {members.map((member) => (
                <tr key={member.email} className="hover:bg-slate-50/40 transition-colors">
                  <td className="py-2.5 px-3 font-medium">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full ${member.bg} text-white flex items-center justify-center font-bold text-[10px]`}>{member.name.split(' ').map(n => n[0]).join('')}</div>
                      <span>{member.name} {member.isYou && <span className="text-[#64748B] font-normal text-[10px]">(You)</span>}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-[#64748B]">{member.email}</td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full font-medium text-[10px] ${member.role === 'Owner' ? 'bg-emerald-50 text-emerald-700' : member.role === 'Admin' ? 'bg-blue-50 text-blue-700' : member.role === 'Editor' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{member.role}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full font-semibold text-[10px] ${member.status === 'Active' ? 'bg-[#f0fdf9] text-[#0D9488]' : 'bg-amber-50 text-amber-600'}`}>{member.status}</span>
                  </td>
                  <td className="py-2.5 px-3 text-right">{!member.isYou && <div className="flex items-center justify-end gap-3"><EditIcon /><TrashIcon /></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit footer */}
      <div className="shrink-0 flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-[#f0fdf9]/40 p-3 text-xs">
        <div className="flex gap-3 items-center">
          <div className="p-1.5 bg-white rounded-lg border border-slate-100 shrink-0"><AuditIcon /></div>
          <div>
            <h4 className="font-bold text-[#0F172A]">Access changes are logged for compliance</h4>
            <p className="text-[#64748B] mt-0.5">All team member additions, removals, and role changes are recorded in the audit trail.</p>
          </div>
        </div>
        <button className="text-xs font-semibold text-[#0F172A] hover:text-[#0D9488] underline underline-offset-4 shrink-0 transition-colors">View Audit Log</button>
      </div>

    </div>
  );
}
export default ManagePermission;