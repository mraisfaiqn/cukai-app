import React, { useState, useEffect } from 'react';
import { getEntityMembers, updateEntityMember, removeEntityMember, getEntityAuditLog } from '../../services/api';

/* ---------- Icons (matched to ManageProfile's SVG icon set) ---------- */

const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const AuditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[16px] w-[16px] text-[#64748B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);
const XIcon = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const AlertTriangleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 text-[#D85A30]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const CrownIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z" />
  </svg>
);
const ShieldIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
const PencilIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);
const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const RefreshIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);
const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

/* ---------- Constants ---------- */

const ROLES = [
  {
    id: 'owner',
    title: 'Owner',
    Icon: CrownIcon,
    description: 'Full access to all entities and settings',
    permissions: ['Manage team', 'Edit entities', 'View all reports', 'Billing access'],
  },
  {
    id: 'admin',
    title: 'Admin',
    Icon: ShieldIcon,
    description: 'Manage team and entities, no billing',
    permissions: ['Manage team', 'Edit entities', 'View all reports'],
  },
  {
    id: 'editor',
    title: 'Editor',
    Icon: PencilIcon,
    description: 'Edit and submit tax documents',
    permissions: ['Edit entities', 'View all reports'],
  },
  {
    id: 'viewer',
    title: 'Viewer',
    Icon: EyeIcon,
    description: 'Read-only access to assigned entities',
    permissions: ['View all reports'],
  },
];

const roleBadgeClass = (role) => {
  switch (role) {
    case 'Owner': return 'bg-[#f0fdf9] text-[#0D9488] border border-emerald-100';
    case 'Admin': return 'bg-[#EFF6FF] text-[#1D4ED8] border border-blue-100';
    case 'Editor': return 'bg-[#fdf3ea] text-[#854F0B] border border-amber-100';
    default: return 'bg-slate-50 text-[#64748B] border border-slate-200';
  }
};

// ENTITIES is now derived from the entityNames prop passed by ManageAccount

// SEED_MEMBERS is now built dynamically from the logged-in user in ManagePermission

// Audit log — placeholder until a real audit_log table is implemented


/* ---------- Small UI primitives (matched to ManageProfile) ---------- */

const Field = ({ label, required, hint, children, span = 1 }) => (
  <div className={span === 2 ? 'col-span-2' : 'col-span-1'}>
    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
      {label}{required && <span className="text-[#D85A30]"> *</span>}
    </label>
    {children}
    {hint && <p className="text-[10px] text-[#94A3B8] mt-1">{hint}</p>}
  </div>
);

const inputClass = "w-full text-xs px-3 py-2 rounded-lg border border-slate-200 text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] transition-colors duration-150";
const selectClass = inputClass + " bg-white";

const TextInput = (props) => <input type="text" className={inputClass} {...props} />;
const SelectInput = ({ children, ...props }) => <select className={selectClass} {...props}>{children}</select>;

const SectionLabel = ({ children }) => (
  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#0D9488] mb-2.5">{children}</h4>
);

const initials = (name) => name.split(' ').map((n) => n[0]).join('').slice(0, 2);

/* =========================================================================
   ROLE PERMISSION CARDS
   ========================================================================= */

const RoleCard = ({ role }) => {
  const { title, Icon, description, permissions } = role;
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-2.5 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="w-5 h-5 rounded-md bg-[#f0fdf9] text-[#0D9488] border border-slate-100 flex items-center justify-center shrink-0">
          <Icon />
        </span>
        <h4 className="text-[11px] font-bold text-[#0F172A]">{title}</h4>
      </div>
      <p className="text-[10px] text-[#64748B] leading-snug">{description}</p>
      <ul className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
        {permissions.map((perm, idx) => (
          <li key={idx} className="flex items-center gap-1 text-[10px] text-[#0F172A]">
            <span className="text-[#0D9488]"><CheckIcon /></span>
            <span>{perm}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* =========================================================================
   INVITE / EDIT MEMBER SLIDE-OVER
   ========================================================================= */

const MemberPanel = ({ mode, member, onClose, onSave, entities = [] }) => {
  const isEdit = mode === 'edit';
  const [draft, setDraft] = useState(
    isEdit
      ? { name: member.name, email: member.email, role: member.role.toLowerCase(), entities: member.entities }
      : { name: '', email: '', role: 'viewer', entities: [] }
  );

  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });

  const toggleEntity = (entity) => {
    setDraft((d) => ({
      ...d,
      entities: d.entities.includes(entity) ? d.entities.filter((e) => e !== entity) : [...d.entities, entity],
    }));
  };

  // Edit mode: a role is always pre-selected so Save is always enabled
  // Invite mode (not currently exposed in UI): requires name, email, and at least one entity
  const canSubmit = isEdit
    ? !!draft.role
    : draft.name && draft.email && draft.entities.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative h-full w-full max-w-md bg-white shadow-xl flex flex-col animate-[slideIn_0.2s_ease-out]">
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-[#0F172A]">{isEdit ? 'Edit Member Access' : 'Invite Team Member'}</h3>
            <p className="text-[11px] text-[#64748B] mt-0.5">{isEdit ? `Update role and entity access for ${member.name}` : 'Grant a teammate access to your entities'}</p>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors duration-150 shrink-0" aria-label="Close panel">
            <XIcon />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-2.5">
          {!isEdit && (
            <>
              <SectionLabel>Invitee Details</SectionLabel>
              <Field label="Full name" required>
                <TextInput value={draft.name} onChange={set('name')} placeholder="Team member's name" />
              </Field>
              <Field label="Email address" required>
                <TextInput value={draft.email} onChange={set('email')} placeholder="name@email.com" type="email" />
              </Field>
            </>
          )}

          {isEdit && (
            <div className="flex items-center gap-2.5 p-3 rounded-lg bg-slate-50 mb-1">
              <div className={`w-8 h-8 rounded-full ${member.bg} text-white flex items-center justify-center font-bold text-[11px] shrink-0`}>
                {initials(member.name)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#0F172A] truncate">{member.name}</p>
                <p className="text-[11px] text-[#64748B] truncate">{member.email}</p>
              </div>
            </div>
          )}

          <SectionLabel><span className="mt-2 block">Role</span></SectionLabel>
          <Field label="Permission level" required hint="Determines what this person can see and do across their assigned entities">
            <SelectInput value={draft.role} onChange={set('role')}>
              {ROLES.filter((r) => r.id !== 'owner').map((r) => (
                <option key={r.id} value={r.id}>{r.title} — {r.description}</option>
              ))}
            </SelectInput>
          </Field>

          {/* Entity access shown only for invite mode — edit mode is scoped to the active entity */}
          {!isEdit && (
            <>
              <SectionLabel><span className="mt-2 block">Entity Access</span></SectionLabel>
              <p className="text-[10px] text-[#94A3B8] -mt-1.5 mb-1">Select which entities this person can access</p>
              <div className="flex flex-col gap-2">
                {(entities || []).map((ent) => (
                  <label key={ent.id} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-slate-100 cursor-pointer hover:bg-[#f0fdf9]/50 transition-colors duration-150">
                    <input
                      type="checkbox"
                      checked={draft.entities.includes(ent.name)}
                      onChange={() => toggleEntity(ent.name)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-[#0D9488] focus:ring-[#0D9488]/30"
                    />
                    <span className="text-xs font-medium text-[#0F172A]">{ent.name}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="flex-1 py-2 px-3 text-xs border border-slate-200 rounded-lg font-medium text-[#0F172A] hover:bg-slate-50 transition-colors duration-150">
            Cancel
          </button>
          <button
            onClick={() => canSubmit && onSave(draft)}
            disabled={!canSubmit}
            className="flex-1 py-2 px-3 text-xs bg-[#0D9488] text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 hover:bg-[#0f766e] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#0D9488] transition-colors duration-150"
          >
            <CheckIcon />{isEdit ? 'Save Changes' : 'Send Invite'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* =========================================================================
   AUDIT LOG SLIDE-OVER
   ========================================================================= */

const AuditLogPanel = ({ logs, loading, onClose }) => (
  <div className="fixed inset-0 z-50 flex justify-end">
    <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
    <div className="relative h-full w-full max-w-md bg-white shadow-xl flex flex-col animate-[slideIn_0.2s_ease-out]">
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

      <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#f0fdf9] rounded-lg border border-slate-100 shrink-0"><AuditIcon /></div>
          <div>
            <h3 className="text-sm font-bold text-[#0F172A]">Audit Log</h3>
            <p className="text-[11px] text-[#64748B]">Access and permission change history</p>
          </div>
        </div>
        <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors duration-150 shrink-0" aria-label="Close panel">
          <XIcon />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {loading && (
          <p className="text-xs text-[#94A3B8] text-center py-8">Loading audit log…</p>
        )}
        {!loading && logs.length === 0 && (
          <p className="text-xs text-[#94A3B8] text-center py-8">No activity recorded yet for this entity.</p>
        )}
        {!loading && logs.length > 0 && (
          <ol className="relative border-l border-slate-100 ml-1.5 flex flex-col gap-4">
            {logs.map((log) => (
              <li key={log.id} className="pl-4 relative">
                <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-[#0D9488]" />
                <p className="text-xs text-[#0F172A] leading-relaxed">
                  <span className="font-semibold">{log.actor}</span>{' '}
                  <span className="text-[#64748B]">{log.action}</span>{' '}
                  {log.target && <span className="font-semibold">{log.target}</span>}
                </p>
                {log.detail && <p className="text-[11px] text-[#64748B] mt-0.5">{log.detail}</p>}
                <p className="text-[10px] text-[#94A3B8] mt-0.5">{log.timestamp}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="shrink-0 px-5 py-4 border-t border-slate-100">
        <button onClick={onClose} className="w-full py-2 px-3 text-xs border border-slate-200 rounded-lg font-medium text-[#0F172A] hover:bg-slate-50 transition-colors duration-150">
          Close
        </button>
      </div>
    </div>
  </div>
);

/* =========================================================================
   REMOVE MEMBER CONFIRM MODAL
   ========================================================================= */

const RemoveMemberModal = ({ member, onClose, onConfirm }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
    <div className="w-full max-w-sm bg-white rounded-xl shadow-xl flex flex-col overflow-hidden">
      <div className="p-5">
        <div className="flex gap-3">
          <AlertTriangleIcon />
          <div className="flex-1">
            <h3 className="text-sm font-bold text-[#0F172A]">Remove {member.name}?</h3>
            <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
              This revokes their access to all assigned entities immediately. They'll need a new invite to regain access.
            </p>
          </div>
        </div>
      </div>
      <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
        <button onClick={onClose} className="flex-1 py-2 px-3 text-xs border border-slate-200 rounded-lg font-medium text-[#0F172A] hover:bg-slate-50 transition-colors duration-150">
          Cancel
        </button>
        <button onClick={onConfirm} className="flex-1 py-2 px-3 text-xs bg-[#D85A30] text-white rounded-lg font-semibold hover:bg-[#993C1D] transition-colors duration-150">
          Remove Member
        </button>
      </div>
    </div>
  </div>
);

/* =========================================================================
   MAIN COMPONENT
   ========================================================================= */

function ManagePermission({ entityData = [] }) {
  const storedName  = localStorage.getItem('userFullName') || 'Account Owner';
  const storedEmail = localStorage.getItem('userEmail')    || '';
  const storedId    = parseInt(localStorage.getItem('userId') || '0') || null;

  // entityData is [{ id, name }, ...] — fall back to a placeholder if empty
  const availableEntities = entityData.length > 0 ? entityData : [];
  const activeEntityObj   = availableEntities[0] || null;

  const [activeTab,      setActiveTab]      = useState(activeEntityObj);

  // Sync activeTab when entityData loads asynchronously after first render
  useEffect(() => {
    if (availableEntities.length > 0 && !activeTab) {
      setActiveTab(availableEntities[0]);
    }
  }, [entityData]);
  const [members,        setMembers]        = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [auditLog,       setAuditLog]       = useState([]);
  const [loadingAudit,   setLoadingAudit]   = useState(false);

  // Load members whenever the active entity changes
  useEffect(() => {
    if (!activeTab?.id) return;
    setLoadingMembers(true);
    getEntityMembers(activeTab.id)
      .then((rows) => {
        // Normalise API rows to match the shape the table expects
        setMembers(rows.map((m) => ({
          id:       m.id,
          personId: m.personId,
          name:     m.name     || m.invitedEmail || 'Unknown',
          email:    m.email    || m.invitedEmail || '',
          role:     m.role.charAt(0).toUpperCase() + m.role.slice(1),  // 'owner' → 'Owner'
          status:   m.status === 'active' ? 'Active' : 'Pending Invite',
          bg:       m.role === 'owner' ? 'bg-[#0D9488]' : m.role === 'admin' ? 'bg-[#1D4ED8]' : 'bg-slate-400',
          isYou:    storedId !== null && m.personId === storedId,
          entities: [activeTab.name],
        })));
      })
      .catch((err) => console.error('Failed to load members:', err))
      .finally(() => setLoadingMembers(false));
  }, [activeTab?.id]);

  // Load audit log whenever the active entity changes
  useEffect(() => {
    if (!activeTab?.id) return;
    setLoadingAudit(true);
    getEntityAuditLog(activeTab.id)
      .then(setAuditLog)
      .catch((err) => console.error('Failed to load audit log:', err))
      .finally(() => setLoadingAudit(false));
  }, [activeTab?.id]);

  const [searchQuery, setSearchQuery] = useState('');

  const [editingMember, setEditingMember] = useState(null);
  const [removingMember, setRemovingMember] = useState(null);
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  // Derive the current user's role in the active entity
  // This controls whether edit/remove actions appear in the UI
  const myMembership  = members.find((m) => m.personId === storedId);
  const myRole        = myMembership?.role?.toLowerCase() || 'viewer';
  const isOwner       = myRole === 'owner';
  const canManage     = isOwner;   // only owners can change roles or remove members

  // Members are already scoped to activeTab via the API; just apply search filter
  const visibleMembers = members.filter((m) => {
    if (searchQuery.trim() === '') return true;
    return (
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const handleSaveEdit = async (draft) => {
    if (!activeTab?.id) return;
    try {
      await updateEntityMember(activeTab.id, editingMember.id, draft.role, storedId);
      setMembers(members.map((m) =>
        m.id === editingMember.id
          ? { ...m, role: ROLES.find((r) => r.id === draft.role)?.title || draft.role }
          : m
      ));
      setEditingMember(null);
      showToast(`Updated access for ${editingMember.name}`);
      // Refresh audit log to show the new entry
      getEntityAuditLog(activeTab.id).then(setAuditLog).catch(() => {});
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to update member');
    }
  };

  const handleRemove = async () => {
    if (!activeTab?.id) return;
    try {
      await removeEntityMember(activeTab.id, removingMember.id, storedId || undefined);
      setMembers(members.filter((m) => m.id !== removingMember.id));
      showToast(`${removingMember.name} removed`);
      setRemovingMember(null);
      getEntityAuditLog(activeTab.id).then(setAuditLog).catch(() => {});
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to remove member');
      setRemovingMember(null);
    }
  };

  return (
    <div className="h-full flex flex-col gap-3 relative">

      {/* Role permissions — compact strip at top */}
      <div className="shrink-0 grid grid-cols-4 gap-2">
        {ROLES.map((role) => <RoleCard key={role.id} role={role} />)}
      </div>

      {/* Team members card — fills remaining height */}
      <div className="flex-1 min-h-0 bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col gap-2">
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">Team Members</h2>
            <p className="text-[11px] text-[#64748B]">
              Manage who has access to your entities.
              {myMembership && (
                <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${roleBadgeClass(myMembership.role)}`}>
                  Your role: {myMembership.role}
                </span>
              )}
            </p>
          </div>

        </div>

        <div className="flex items-center justify-between gap-3 shrink-0">
          <div className="flex gap-2">
            {availableEntities.map((ent) => (
              <button
                key={ent.id}
                onClick={() => setActiveTab(ent)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors duration-150 ${activeTab?.id === ent.id ? 'bg-[#0D9488] text-white' : 'bg-slate-100 text-[#64748B] hover:bg-slate-200'}`}
              >
                {ent.name}
              </button>
            ))}
          </div>
          <div className="relative w-48 shrink-0">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2"><SearchIcon /></div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search members"
              className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] transition-colors duration-150"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 border border-slate-100 rounded-xl overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="sticky top-0 border-b border-slate-100 bg-slate-50 text-[#64748B] font-semibold uppercase tracking-wider">
                <th className="py-2 px-3">Name</th><th className="py-2 px-3">Email</th><th className="py-2 px-3">Role</th><th className="py-2 px-3">Status</th><th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[#0F172A]">
              {loadingMembers && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#94A3B8] text-xs">
                    Loading members…
                  </td>
                </tr>
              )}
              {!loadingMembers && visibleMembers.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#94A3B8] text-xs">
                    No members match{searchQuery ? ' your search' : ' this entity'}.
                  </td>
                </tr>
              )}
              {visibleMembers.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50/40 transition-colors duration-150">
                  <td className="py-2.5 px-3 font-medium">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full ${member.bg} text-white flex items-center justify-center font-bold text-[10px] shrink-0`}>
                        {initials(member.name)}
                      </div>
                      <span>{member.name} {member.isYou && <span className="text-[#64748B] font-normal text-[10px]">(You)</span>}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-[#64748B]">{member.email}</td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full font-semibold text-[10px] ${roleBadgeClass(member.role)}`}>{member.role}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full font-semibold text-[10px] ${member.status === 'Active' ? 'bg-[#f0fdf9] text-[#0D9488] border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
                      {member.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {member.role === 'Owner' && (
                      <span className="text-[10px] text-[#94A3B8] italic">Protected</span>
                    )}
                    {/* Only owners can edit or remove non-owner members */}
                    {member.role !== 'Owner' && canManage && !member.isYou && (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => setEditingMember(member)}
                          className="text-[#64748B] hover:text-[#0F172A] transition-colors duration-150"
                          aria-label="Edit member"
                          title="Edit access"
                        >
                          <EditIcon />
                        </button>
                        <button
                          onClick={() => setRemovingMember(member)}
                          className="text-[#64748B] hover:text-[#D85A30] transition-colors duration-150"
                          aria-label="Remove member"
                          title="Remove member"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    )}
                    {/* Non-owners see their role as read-only */}
                    {member.role !== 'Owner' && !canManage && !member.isYou && (
                      <span className="text-[10px] text-[#94A3B8] italic">View only</span>
                    )}
                  </td>
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
        <button
          onClick={() => setAuditLogOpen(true)}
          className="text-xs font-semibold text-[#0F172A] hover:text-[#0D9488] underline underline-offset-4 shrink-0 transition-colors duration-150"
        >
          View Audit Log
        </button>
      </div>

      {/* Slide-overs & modals */}
      {editingMember && (
        <MemberPanel mode="edit" member={editingMember} onClose={() => setEditingMember(null)} onSave={handleSaveEdit} entities={availableEntities} />
      )}
      {removingMember && (
        <RemoveMemberModal member={removingMember} onClose={() => setRemovingMember(null)} onConfirm={handleRemove} />
      )}
      {auditLogOpen && (
        <AuditLogPanel logs={auditLog} loading={loadingAudit} onClose={() => setAuditLogOpen(false)} />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-[#0F172A] text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2 animate-[fadeIn_0.15s_ease-out]">
          <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          <span className="text-[#0D9488]"><CheckIcon /></span>
          {toast}
        </div>
      )}
    </div>
  );
}
export default ManagePermission;