import React, { useState } from 'react';

const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#64748B] hover:text-[#0F172A] cursor-pointer transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#64748B] hover:text-red-600 cursor-pointer transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-emerald-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const AuditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px] text-[#64748B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
  </svg>
);

const RolePermissionCard = ({ iconColor, bgColor, icon, title, description, permissions }) => (
  <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between text-left">
    <div>
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className={`w-8 h-8 rounded-lg ${bgColor} ${iconColor} flex items-center justify-center font-bold text-sm`}>{icon}</span>
        <h4 className="text-sm font-bold text-[#0F172A]">{title}</h4>
      </div>
      <p className="text-xs text-[#64748B] mb-4 leading-relaxed">{description}</p>
      <ul className="space-y-2">
        {permissions.map((perm, idx) => (
          <li key={idx} className="flex items-center gap-2 text-xs text-[#0F172A]"><CheckIcon /><span>{perm}</span></li>
        ))}
      </ul>
    </div>
  </div>
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
    <div className="w-full space-y-6 text-left">
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#0F172A]">Team Members</h2>
            <p className="text-xs text-[#64748B] mt-0.5">Manage who has access to your entities.</p>
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F172A] text-white px-4 py-2 text-xs font-semibold hover:bg-slate-800 transition-colors self-start sm:self-auto"><PlusIcon />Invite Member</button>
        </div>

        <div className="flex gap-2">
          {['Hafiz Printing & Design', 'Urban Brew Partners'].map((entity) => (
            <button key={entity} onClick={() => setActiveTab(entity)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${activeTab === entity ? 'bg-[#0F172A] text-white' : 'bg-slate-100 text-[#64748B] hover:bg-slate-200'}`}>{entity}</button>
          ))}
        </div>

        <div className="w-full overflow-x-auto border border-slate-100 rounded-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-[#64748B] font-semibold uppercase tracking-wider">
                <th className="py-3 px-4">Name</th><th className="py-3 px-4">Email</th><th className="py-3 px-4">Role</th><th className="py-3 px-4">Status</th><th className="py-3 px-4 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[#0F172A]">
              {members.map((member) => (
                <tr key={member.email} className="hover:bg-slate-50/40 transition-colors">
                  <td className="py-3.5 px-4 font-medium">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-full ${member.bg} text-white flex items-center justify-center font-bold text-[11px]`}>{member.name.split(' ').map(n => n[0]).join('')}</div>
                      <span>{member.name} {member.isYou && <span className="text-[#64748B] font-normal text-[11px]">(You)</span>}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-[#64748B]">{member.email}</td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-block px-2 py-0.5 rounded-full font-medium text-[10px] ${member.role === 'Owner' ? 'bg-emerald-50 text-emerald-700' : member.role === 'Admin' ? 'bg-blue-50 text-blue-700' : member.role === 'Editor' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{member.role}</span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-block px-2 py-0.5 rounded-full font-semibold text-[10px] ${member.status === 'Active' ? 'bg-[#f0fdf9] text-[#0D9488]' : 'bg-amber-50 text-amber-600'}`}>{member.status}</span>
                  </td>
                  <td className="py-3.5 px-4 text-right">{!member.isYou && <div className="flex items-center justify-end gap-3.5"><EditIcon /><TrashIcon /></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3">
        <div><h2 className="text-base font-bold text-[#0F172A]">Role Permissions</h2><p className="text-xs text-[#64748B]">Overview of what each role can do</p></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <RolePermissionCard title="Owner" icon="♔" bgColor="bg-emerald-50" iconColor="text-emerald-700" description="Full access to all entities and settings" permissions={['Manage team', 'Edit entities', 'View all reports', 'Billing access']} />
          <RolePermissionCard title="Admin" icon="🛡" bgColor="bg-blue-50" iconColor="text-blue-700" description="Manage team and entities, no billing" permissions={['Manage team', 'Edit entities', 'View all reports']} />
          <RolePermissionCard title="Editor" icon="✎" bgColor="bg-amber-50" iconColor="text-amber-700" description="Edit and submit tax documents" permissions={['Edit entities', 'View all reports']} />
          <RolePermissionCard title="Viewer" icon="👁" bgColor="bg-slate-50" iconColor="text-slate-600" description="Read-only access to assigned entities" permissions={['View all reports']} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-[#f0fdf9]/40 p-4 text-xs">
        <div className="flex gap-3 items-center">
          <div className="p-2 bg-white rounded-lg border border-slate-100"><AuditIcon /></div>
          <div><h4 className="font-bold text-[#0F172A]">Access changes are logged for compliance</h4><p className="text-[#64748B] mt-0.5">All team member additions, removals, and role changes are recorded in the audit trail.</p></div>
        </div>
        <button className="text-xs font-semibold text-[#0F172A] hover:text-[#0D9488] underline underline-offset-4 shrink-0 transition-colors">View Audit Log</button>
      </div>
    </div>
  );
}
export default ManagePermission