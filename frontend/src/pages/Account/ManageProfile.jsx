import React, { useState } from 'react';

/* ---------- Icons ---------- */

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
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const XIcon = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const ChevronLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const StarIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M12 2l2.9 6.6L22 9.3l-5 4.9 1.2 7.1L12 17.8l-6.2 3.5L7 14.2 2 9.3l7.1-0.7L12 2z" />
  </svg>
);
const MapPinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 shrink-0 text-[#94A3B8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);
const AlertTriangleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 text-[#D85A30]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const UserIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px] text-[#0D9488]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);
const ChevronRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

/* ---------- Constants ---------- */

const MALAYSIAN_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang',
  'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor',
  'Terengganu', 'W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya',
];

const BLANK_SOLE_PROP = {
  entityType: 'sole-prop',
  name: '',
  businessCode: '',
  businessActivity: '',
  ssmNo: '',
  tin: '',
  premiseAddress: '',
  premisePostcode: '',
  premiseCity: '',
  premiseState: '',
  // Financial particulars (Form N)
  salesTurnover: '',
  totalExpenditure: '',
  netProfitLoss: '',
  totalAssets: '',
  totalLiabilities: '',
};

const BLANK_PARTNERSHIP = {
  entityType: 'partnership',
  name: '',
  isPrecedentPartner: null, // true | false
  businessCode: '',
  businessActivity: '',
  ssmNo: '',
  tin: '', // Income tax no. with D prefix
  partnerCount: '',
  basisOfApportionment: '',
  employerNo: '',
  precedentPartnerName: '',
  mainBusinessAddress: '',
  mainBusinessPostcode: '',
  mainBusinessCity: '',
  mainBusinessState: '',
  partners: [],
};

const BLANK_PARTNER = {
  name: '',
  identificationNo: '',
  incomeTaxNo: '',
  countryOfResidence: 'MYS',
  profitShare: '',
  dateAppointed: '',
};

const BLANK_PERSONAL_PROFILE = {
  // Identity & residency
  fullName: 'Mohd Rais Faiq Nichol',
  idType: 'ic',
  identificationNo: '950312-10-5521',
  personalTin: 'IG 4471002938',
  citizenship: 'MYS',
  gender: 'male',
  dateOfBirth: '1995-03-12',
  // Marital / dependents
  maritalStatus: 'single',
  maritalEventDate: '',
  spouseName: '',
  spouseIdNo: '',
  spouseDob: '',
  assessmentType: 'self-single',
  numberOfChildren: '0',
  hasDisabledDependents: false,
  // Contact
  phone: '012-345 6789',
  email: 'faiq.nichol@example.com',
  correspondenceAddress: 'No. 7, Jalan SS19/1',
  correspondencePostcode: '47500',
  correspondenceCity: 'Subang Jaya',
  correspondenceState: 'Selangor',
  refundMethod: 'bank',
  bankName: '',
  bankAccountNo: '',
  // Compliance flags
  recordKeeping: true,
  hasForeignAccounts: false,
  rpgtDisposal: false,
  // Relief category toggles
  hasDependentParents: false,
  hasEpfLifeInsurance: true,
  hasEducationMedicalInsurance: true,
  hasLifestylePurchases: true,
  hasSspnEvOther: false,
};

/* ---------- Small UI primitives ---------- */

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

const ToggleRow = ({ label, hint, checked, onChange }) => (
  <label className="flex items-start justify-between gap-3 py-2 cursor-pointer">
    <div className="min-w-0">
      <p className="text-xs font-semibold text-[#0F172A]">{label}</p>
      {hint && <p className="text-[10px] text-[#94A3B8] mt-0.5 leading-relaxed">{hint}</p>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-9 h-5 rounded-full transition-colors duration-150 ${checked ? 'bg-[#0D9488]' : 'bg-slate-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  </label>
);

const formatMoney = (val) => {
  if (val === '' || val === null || val === undefined) return null;
  const num = Number(val);
  if (Number.isNaN(num)) return val;
  return `RM ${num.toLocaleString()}`;
};

const formatAddress = (entity) => {
  const isPartnership = entity.entityType === 'partnership';
  const line = isPartnership ? entity.mainBusinessAddress : entity.premiseAddress;
  const city = isPartnership ? entity.mainBusinessCity : entity.premiseCity;
  const state = isPartnership ? entity.mainBusinessState : entity.premiseState;
  const postcode = isPartnership ? entity.mainBusinessPostcode : entity.premisePostcode;
  const cityLine = [postcode, city].filter(Boolean).join(' ');
  return [line, cityLine, state].filter(Boolean).join(', ');
};

/* ---------- Badges ---------- */

const RoleBadge = ({ isPrecedentPartner }) => {
  if (isPrecedentPartner) {
    return (
      <span className="inline-flex items-center gap-1 bg-[#fdf3ea] text-[#854F0B] border border-amber-100 px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0">
        <StarIcon /> Precedent
      </span>
    );
  }
  return (
    <span className="inline-flex items-center bg-slate-50 text-[#64748B] border border-slate-200 px-1.5 py-0.5 rounded-full text-[9px] font-semibold shrink-0">
      Partner
    </span>
  );
};

/* =========================================================================
   PERSONAL PROFILE — account-level section
   ========================================================================= */

const PersonalProfileSummary = ({ profile, onOpen }) => {
  const childLabel = profile.numberOfChildren === '0' || !profile.numberOfChildren
    ? 'No dependents'
    : `${profile.numberOfChildren} ${Number(profile.numberOfChildren) === 1 ? 'child' : 'children'} on record`;

  return (
    <button
      onClick={onOpen}
      className="w-full bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center gap-4 text-left hover:border-[#0D9488]/40 transition-colors duration-150"
    >
      <div className="h-11 w-11 rounded-full bg-[#f0fdf9] border border-slate-100 flex items-center justify-center shrink-0">
        <UserIcon />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold text-[#0F172A] truncate">{profile.fullName || 'Your name'}</h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#64748B] mt-0.5">
          <span>{profile.personalTin || 'No TIN set'}</span>
          <span className="text-slate-300">•</span>
          <span className="capitalize">{profile.maritalStatus.replace('-', ' ')}</span>
          <span className="text-slate-300">•</span>
          <span>{childLabel}</span>
        </div>
      </div>
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#0D9488] shrink-0">
        <EditIcon />Edit profile
      </span>
    </button>
  );
};

const PersonalProfilePanel = ({ profile, onClose, onSave }) => {
  const [draft, setDraft] = useState(profile);
  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });
  const setVal = (key) => (val) => setDraft({ ...draft, [key]: val });

  const isMarried = draft.maritalStatus === 'married';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative h-full w-full max-w-md bg-white shadow-xl flex flex-col animate-[slideIn_0.2s_ease-out]">
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        <div className="shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-full bg-[#f0fdf9] border border-slate-100 flex items-center justify-center shrink-0">
              <UserIcon />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-[#0F172A] truncate">Personal Profile</h3>
              <p className="text-[11px] text-[#64748B]">Used across all entities you file for</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors duration-150 shrink-0" aria-label="Close panel">
            <XIcon />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-2.5">

          <SectionLabel>Identity & Residency</SectionLabel>
          <Field label="Full name (as per IC/passport)" required>
            <TextInput value={draft.fullName} onChange={set('fullName')} placeholder="Full legal name" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="ID type">
              <SelectInput value={draft.idType} onChange={set('idType')}>
                <option value="ic">Identification card</option>
                <option value="passport">Passport</option>
              </SelectInput>
            </Field>
            <Field label={draft.idType === 'ic' ? 'IC no.' : 'Passport no.'} required>
              <TextInput value={draft.identificationNo} onChange={set('identificationNo')} placeholder={draft.idType === 'ic' ? 'YYMMDD-PB-XXXX' : 'A12345678'} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Tax Identification No. (TIN)" required>
              <TextInput value={draft.personalTin} onChange={set('personalTin')} placeholder="IG 1234567890" />
            </Field>
            <Field label="Citizenship" hint="Country code, MYS if Malaysian">
              <TextInput value={draft.citizenship} onChange={set('citizenship')} placeholder="MYS" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Gender">
              <SelectInput value={draft.gender} onChange={set('gender')}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </SelectInput>
            </Field>
            <Field label="Date of birth">
              <input type="date" className={inputClass} value={draft.dateOfBirth} onChange={set('dateOfBirth')} />
            </Field>
          </div>

          <SectionLabel><span className="mt-2 block">Marital Status & Dependents</span></SectionLabel>
          <Field label="Marital status as at 31 Dec">
            <SelectInput value={draft.maritalStatus} onChange={set('maritalStatus')}>
              <option value="single">Single</option>
              <option value="married">Married</option>
              <option value="divorced-widowed">Divorcee / widow / widower</option>
              <option value="deceased">Deceased</option>
            </SelectInput>
          </Field>
          {(draft.maritalStatus === 'divorced-widowed' || draft.maritalStatus === 'deceased') && (
            <Field label="Date of divorce / demise">
              <input type="date" className={inputClass} value={draft.maritalEventDate} onChange={set('maritalEventDate')} />
            </Field>
          )}
          {isMarried && (
            <>
              <Field label="Date of marriage">
                <input type="date" className={inputClass} value={draft.maritalEventDate} onChange={set('maritalEventDate')} />
              </Field>
              <Field label="Spouse's name">
                <TextInput value={draft.spouseName} onChange={set('spouseName')} placeholder="Full name" />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Spouse's IC no.">
                  <TextInput value={draft.spouseIdNo} onChange={set('spouseIdNo')} placeholder="YYMMDD-PB-XXXX" />
                </Field>
                <Field label="Spouse's date of birth">
                  <input type="date" className={inputClass} value={draft.spouseDob} onChange={set('spouseDob')} />
                </Field>
              </div>
              <Field label="Type of assessment election">
                <SelectInput value={draft.assessmentType} onChange={set('assessmentType')}>
                  <option value="joint-husband">Joint — in the name of husband</option>
                  <option value="joint-wife">Joint — in the name of wife</option>
                  <option value="separate">Separate</option>
                  <option value="self-spouse-no-income">Self — spouse has no income</option>
                </SelectInput>
              </Field>
            </>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Number of children">
              <TextInput value={draft.numberOfChildren} onChange={set('numberOfChildren')} inputMode="numeric" placeholder="0" />
            </Field>
            <div className="flex items-end pb-2">
              <ToggleRow
                label="Disabled dependents"
                checked={draft.hasDisabledDependents}
                onChange={setVal('hasDisabledDependents')}
              />
            </div>
          </div>

          <SectionLabel><span className="mt-2 block">Contact & Correspondence</span></SectionLabel>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Phone / handphone">
              <TextInput value={draft.phone} onChange={set('phone')} placeholder="012-345 6789" />
            </Field>
            <Field label="Email">
              <TextInput value={draft.email} onChange={set('email')} placeholder="name@email.com" />
            </Field>
          </div>
          <Field label="Correspondence address">
            <TextInput value={draft.correspondenceAddress} onChange={set('correspondenceAddress')} placeholder="Street address" />
          </Field>
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="Postcode">
              <TextInput value={draft.correspondencePostcode} onChange={set('correspondencePostcode')} placeholder="47500" />
            </Field>
            <Field label="City">
              <TextInput value={draft.correspondenceCity} onChange={set('correspondenceCity')} placeholder="Subang Jaya" />
            </Field>
            <Field label="State">
              <SelectInput value={draft.correspondenceState} onChange={set('correspondenceState')}>
                <option value="" disabled>Select</option>
                {MALAYSIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </SelectInput>
            </Field>
          </div>
          <Field label="Tax refund method">
            <SelectInput value={draft.refundMethod} onChange={set('refundMethod')}>
              <option value="bank">Bank account</option>
              <option value="duitnow">DuitNow</option>
            </SelectInput>
          </Field>
          {draft.refundMethod === 'bank' && (
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Bank name">
                <TextInput value={draft.bankName} onChange={set('bankName')} placeholder="e.g. Maybank" />
              </Field>
              <Field label="Account no.">
                <TextInput value={draft.bankAccountNo} onChange={set('bankAccountNo')} placeholder="1234567890" />
              </Field>
            </div>
          )}

          <SectionLabel><span className="mt-2 block">Compliance Flags</span></SectionLabel>
          <div className="divide-y divide-slate-50">
            <ToggleRow
              label="Record-keeping"
              hint="You maintain business records as required by LHDN"
              checked={draft.recordKeeping}
              onChange={setVal('recordKeeping')}
            />
            <ToggleRow
              label="Foreign financial accounts"
              hint="You hold account(s) at financial institutions outside Malaysia"
              checked={draft.hasForeignAccounts}
              onChange={setVal('hasForeignAccounts')}
            />
            <ToggleRow
              label="Asset disposal under RPGT 1976"
              hint="You disposed of an asset under the Real Property Gains Tax Act this year"
              checked={draft.rpgtDisposal}
              onChange={setVal('rpgtDisposal')}
            />
          </div>

          <SectionLabel><span className="mt-2 block">Relief Categories to Prompt For</span></SectionLabel>
          <p className="text-[11px] text-[#64748B] -mt-1.5 mb-1 leading-relaxed">
            These toggles determine which Part H relief questions you'll be asked during filing.
          </p>
          <div className="divide-y divide-slate-50">
            <ToggleRow
              label="Dependent parents"
              hint="Medical, dental, special needs or carer expenses for parents"
              checked={draft.hasDependentParents}
              onChange={setVal('hasDependentParents')}
            />
            <ToggleRow
              label="EPF / life insurance / PRS"
              hint="Contributions to EPF, life insurance, or private retirement schemes"
              checked={draft.hasEpfLifeInsurance}
              onChange={setVal('hasEpfLifeInsurance')}
            />
            <ToggleRow
              label="Education & medical insurance"
              hint="Premiums paid for education or medical insurance"
              checked={draft.hasEducationMedicalInsurance}
              onChange={setVal('hasEducationMedicalInsurance')}
            />
            <ToggleRow
              label="Lifestyle purchases"
              hint="Books, devices, internet subscription, sports equipment"
              checked={draft.hasLifestylePurchases}
              onChange={setVal('hasLifestylePurchases')}
            />
            <ToggleRow
              label="SSPN, EV charging & other reliefs"
              hint="SSPN net deposit, EV charging facilities, breastfeeding equipment, childcare fees"
              checked={draft.hasSspnEvOther}
              onChange={setVal('hasSspnEvOther')}
            />
          </div>
        </div>

        <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="flex-1 py-2 px-3 text-xs border border-slate-200 rounded-lg font-medium text-[#0F172A] hover:bg-slate-50 transition-colors duration-150">
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="flex-1 py-2 px-3 text-xs bg-[#0D9488] text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 hover:bg-[#0f766e] transition-colors duration-150"
          >
            <CheckIcon />Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

/* =========================================================================
   ENTITY CARD — dense, 3-up
   ========================================================================= */

const EntityCard = ({ entity, active, onSwitch, onOpenPreview }) => {
  const isPartnership = entity.entityType === 'partnership';
  const Icon = isPartnership ? UsersIcon : BuildingIcon;
  const filingNote = isPartnership
    ? (entity.isPrecedentPartner ? 'Files Form P + B' : 'Files Form B only')
    : 'Files Form B';
  const address = formatAddress(entity);
  const netProfit = !isPartnership ? formatMoney(entity.netProfitLoss) : null;

  return (
    <button
      onClick={onOpenPreview}
      className={`h-full w-full bg-white p-3.5 rounded-xl border shadow-sm flex flex-col text-left transition-colors duration-150 hover:border-[#0D9488]/40 ${active ? 'border-[#0D9488]/40' : 'border-slate-100'}`}
    >
      {/* Header row: icon + name + role badge on the left side, Active badge pinned top-right */}
      <div className="flex justify-between items-start mb-2.5 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 bg-[#f0fdf9] rounded-lg border border-slate-100 shrink-0"><Icon /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="text-sm font-bold text-[#0F172A] truncate">{entity.name || 'Untitled Entity'}</h3>
              {isPartnership && <RoleBadge isPrecedentPartner={entity.isPrecedentPartner} />}
            </div>
            <p className="text-[11px] text-[#64748B]">{isPartnership ? 'General Partnership' : 'Sole Proprietorship'}</p>
          </div>
        </div>
        {active && (
          <span className="bg-[#f0fdf9] text-[#0D9488] border border-emerald-100 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0">
            Active
          </span>
        )}
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 text-[11px] mb-2">
        <span className="text-[#64748B]">SSM No:</span><span className="font-semibold text-[#0F172A] truncate">{entity.ssmNo || '—'}</span>
        <span className="text-[#64748B]">TIN:</span><span className="font-semibold text-[#0F172A] truncate">{entity.tin || '—'}</span>
        <span className="text-[#64748B]">Code:</span><span className="font-semibold text-[#0F172A] truncate">{entity.businessCode || '—'}</span>
        {isPartnership ? (
          <>
            <span className="text-[#64748B]">Partners:</span><span className="font-semibold text-[#0F172A]">{entity.partnerCount || '—'}</span>
          </>
        ) : (
          <>
            <span className="text-[#64748B]">Net profit:</span><span className="font-semibold text-[#0F172A] truncate">{netProfit ?? '—'}</span>
          </>
        )}
      </div>

      <p className="text-[11px] text-[#64748B] truncate mb-2">{entity.businessActivity || 'No activity specified'}</p>

      {address && (
        <div className="flex items-start gap-1.5 text-[10px] text-[#94A3B8] mb-2.5">
          <div className="pt-0.5"><MapPinIcon /></div>
          <span className="leading-snug line-clamp-2">{address}</span>
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center justify-between text-[10px] text-[#94A3B8] border-t border-slate-50 pt-2">
        <span>{filingNote}</span>
        <span className="inline-flex items-center gap-1 font-semibold text-[#0D9488]">
          View full profile<ChevronRightIcon />
        </span>
      </div>
    </button>
  );
};

/* =========================================================================
   ENTITY PREVIEW / EDIT SLIDE-OVER — full depth
   ========================================================================= */

const PartnerRow = ({ partner, onChange, onRemove }) => {
  const set = (key) => (e) => onChange({ ...partner, [key]: e.target.value });
  return (
    <div className="rounded-lg border border-slate-100 p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Partner</span>
        <button onClick={onRemove} className="text-[#94A3B8] hover:text-[#D85A30] transition-colors duration-150" aria-label="Remove partner">
          <TrashIcon />
        </button>
      </div>
      <Field label="Name">
        <TextInput value={partner.name} onChange={set('name')} placeholder="Partner's full name" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Identification no.">
          <TextInput value={partner.identificationNo} onChange={set('identificationNo')} placeholder="e.g. 950312-10-5521" />
        </Field>
        <Field label="Income tax no.">
          <TextInput value={partner.incomeTaxNo} onChange={set('incomeTaxNo')} placeholder="e.g. IG 1234567890" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Country">
          <TextInput value={partner.countryOfResidence} onChange={set('countryOfResidence')} placeholder="MYS" />
        </Field>
        <Field label="Profit share %">
          <TextInput value={partner.profitShare} onChange={set('profitShare')} placeholder="e.g. 25" inputMode="decimal" />
        </Field>
        <Field label="Date appointed">
          <input type="date" className={inputClass} value={partner.dateAppointed} onChange={set('dateAppointed')} />
        </Field>
      </div>
    </div>
  );
};

const EntityPreviewPanel = ({ entity, active, isOnlyEntity, onClose, onSave, onSwitch, onDelete }) => {
  const [draft, setDraft] = useState(entity);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isPartnership = draft.entityType === 'partnership';
  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });

  const handleSave = () => onSave(draft);

  const updatePartner = (index, updated) => {
    const next = [...draft.partners];
    next[index] = updated;
    setDraft({ ...draft, partners: next });
  };
  const removePartner = (index) => {
    setDraft({ ...draft, partners: draft.partners.filter((_, i) => i !== index) });
  };
  const addPartner = () => {
    setDraft({ ...draft, partners: [...(draft.partners || []), { ...BLANK_PARTNER }] });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />

      <div className="relative h-full w-full max-w-md bg-white shadow-xl flex flex-col animate-[slideIn_0.2s_ease-out]">
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        <div className="shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-[#f0fdf9] rounded-lg border border-slate-100 shrink-0">
              {isPartnership ? <UsersIcon /> : <BuildingIcon />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <h3 className="text-sm font-bold text-[#0F172A] truncate">{draft.name || 'Untitled Entity'}</h3>
                {isPartnership && <RoleBadge isPrecedentPartner={draft.isPrecedentPartner} />}
              </div>
              <p className="text-[11px] text-[#64748B]">{isPartnership ? 'General Partnership' : 'Sole Proprietorship'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors duration-150 shrink-0" aria-label="Close panel">
            <XIcon />
          </button>
        </div>

        {active && (
          <div className="shrink-0 px-5 pt-3">
            <span className="bg-[#f0fdf9] text-[#0D9488] border border-emerald-100 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
              Active Entity
            </span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-2.5">

          {/* Business particulars */}
          <SectionLabel>{isPartnership ? 'Partnership Particulars' : 'Business Particulars'}</SectionLabel>
          <Field label={isPartnership ? 'Partnership name' : 'Business name'} required>
            <TextInput value={draft.name} onChange={set('name')} placeholder="As registered with SSM" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="SSM registration no." required>
              <TextInput value={draft.ssmNo} onChange={set('ssmNo')} placeholder="e.g. 202103145678" />
            </Field>
            <Field label="Tax Identification No." required hint={isPartnership ? 'Begins with D' : undefined}>
              <TextInput value={draft.tin} onChange={set('tin')} placeholder={isPartnership ? 'D 1234567890' : 'IG 1234567890'} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Business code">
              <TextInput value={draft.businessCode} onChange={set('businessCode')} placeholder="LHDN business code" />
            </Field>
            <Field label="Type of business activity">
              <TextInput value={draft.businessActivity} onChange={set('businessActivity')} placeholder="e.g. F&B retail" />
            </Field>
          </div>
          {isPartnership && (
            <Field label="Employer's no.">
              <TextInput value={draft.employerNo} onChange={set('employerNo')} placeholder="E 1234567890" />
            </Field>
          )}

          {/* Role / partner roster — partnership only */}
          {isPartnership && (
            <>
              <SectionLabel><span className="mt-2 block">Your Role</span></SectionLabel>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Number of partners" required>
                  <TextInput value={draft.partnerCount} onChange={set('partnerCount')} placeholder="e.g. 3" inputMode="numeric" />
                </Field>
                <Field label="Basis of apportionment" hint="How divisible income/loss is allocated among partners">
                  <SelectInput value={draft.basisOfApportionment} onChange={set('basisOfApportionment')}>
                    <option value="" disabled>Select basis</option>
                    <option value="Equal Split">Equal Split</option>
                    <option value="No Salaries or Interest">No Salaries or Interest</option>
                    <option value="Loan Advance Interest">Loan Advance Interest</option>
                  </SelectInput>
                </Field>
              </div>
              <Field label="Your role in this partnership" required>
                <SelectInput
                  value={draft.isPrecedentPartner === null ? '' : String(draft.isPrecedentPartner)}
                  onChange={(e) => setDraft({ ...draft, isPrecedentPartner: e.target.value === 'true' })}
                >
                  <option value="" disabled>Select role</option>
                  <option value="true">I am the precedent partner — I file Form P</option>
                  <option value="false">I am a partner — I only file Form B</option>
                </SelectInput>
              </Field>
              {draft.isPrecedentPartner === false && (
                <Field label="Precedent partner's name" required hint="The partner who submits Form P on behalf of the partnership">
                  <TextInput value={draft.precedentPartnerName} onChange={set('precedentPartnerName')} placeholder="Full name" />
                </Field>
              )}

              <SectionLabel><span className="mt-2 block">Partner Roster</span></SectionLabel>
              <p className="text-[10px] text-[#94A3B8] -mt-1.5 mb-1">Identification, share, and benefits for each partner (Form P Part G).</p>
              <div className="flex flex-col gap-2">
                {(draft.partners || []).map((partner, index) => (
                  <PartnerRow
                    key={index}
                    partner={partner}
                    onChange={(updated) => updatePartner(index, updated)}
                    onRemove={() => removePartner(index)}
                  />
                ))}
              </div>
              <button
                onClick={addPartner}
                className="inline-flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs border border-dashed border-slate-300 rounded-lg font-medium text-[#64748B] hover:border-[#0D9488] hover:text-[#0D9488] transition-colors duration-150"
              >
                <PlusIcon />Add Partner
              </button>
            </>
          )}

          {/* Financial particulars — sole prop only */}
          {!isPartnership && (
            <>
              <SectionLabel><span className="mt-2 block">Financial Particulars (Form N)</span></SectionLabel>
              <p className="text-[10px] text-[#94A3B8] -mt-1.5 mb-1">High-level P&L and balance sheet figures. Detailed line items are entered during filing.</p>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Sales / turnover">
                  <TextInput value={draft.salesTurnover} onChange={set('salesTurnover')} placeholder="0.00" inputMode="decimal" />
                </Field>
                <Field label="Total expenditure">
                  <TextInput value={draft.totalExpenditure} onChange={set('totalExpenditure')} placeholder="0.00" inputMode="decimal" />
                </Field>
              </div>
              <Field label="Net profit / loss">
                <TextInput value={draft.netProfitLoss} onChange={set('netProfitLoss')} placeholder="0.00" inputMode="decimal" />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Total assets">
                  <TextInput value={draft.totalAssets} onChange={set('totalAssets')} placeholder="0.00" inputMode="decimal" />
                </Field>
                <Field label="Total liabilities">
                  <TextInput value={draft.totalLiabilities} onChange={set('totalLiabilities')} placeholder="0.00" inputMode="decimal" />
                </Field>
              </div>
            </>
          )}

          {/* Address */}
          <SectionLabel><span className="mt-2 block">{isPartnership ? 'Main Business Address' : 'Business Premise'}</span></SectionLabel>
          <Field label="Address">
            <TextInput
              value={isPartnership ? draft.mainBusinessAddress : draft.premiseAddress}
              onChange={set(isPartnership ? 'mainBusinessAddress' : 'premiseAddress')}
              placeholder="Street address"
            />
          </Field>
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="Postcode">
              <TextInput
                value={isPartnership ? draft.mainBusinessPostcode : draft.premisePostcode}
                onChange={set(isPartnership ? 'mainBusinessPostcode' : 'premisePostcode')}
                placeholder="40150"
              />
            </Field>
            <Field label="City">
              <TextInput
                value={isPartnership ? draft.mainBusinessCity : draft.premiseCity}
                onChange={set(isPartnership ? 'mainBusinessCity' : 'premiseCity')}
                placeholder="Shah Alam"
              />
            </Field>
            <Field label="State">
              <SelectInput
                value={isPartnership ? draft.mainBusinessState : draft.premiseState}
                onChange={set(isPartnership ? 'mainBusinessState' : 'premiseState')}
              >
                <option value="" disabled>Select</option>
                {MALAYSIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </SelectInput>
            </Field>
          </div>

          {/* Danger zone */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <SectionLabel><span className="text-[#D85A30]">Danger Zone</span></SectionLabel>
            {!confirmingDelete ? (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D85A30] hover:text-[#993C1D] transition-colors duration-150"
              >
                <TrashIcon />Delete this entity
              </button>
            ) : (
              <div className="rounded-lg border border-[#F0997B] bg-[#FAECE7] p-3">
                <div className="flex gap-2.5">
                  <AlertTriangleIcon />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-[#712B13]">
                      {isOnlyEntity ? 'You cannot delete your only entity.' : `Delete "${draft.name || 'this entity'}"?`}
                    </p>
                    <p className="text-[11px] text-[#993C1D] mt-0.5 leading-relaxed">
                      {isOnlyEntity
                        ? 'At least one entity profile must remain on your account.'
                        : 'This permanently removes all saved profile data for this entity. Filing history is not affected.'}
                    </p>
                    {!isOnlyEntity && (
                      <div className="flex gap-2 mt-2.5">
                        <button
                          onClick={() => setConfirmingDelete(false)}
                          className="py-1.5 px-3 text-xs border border-slate-200 bg-white rounded-lg font-medium text-[#0F172A] hover:bg-slate-50 transition-colors duration-150"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={onDelete}
                          className="py-1.5 px-3 text-xs bg-[#D85A30] text-white rounded-lg font-semibold hover:bg-[#993C1D] transition-colors duration-150"
                        >
                          Confirm Delete
                        </button>
                      </div>
                    )}
                    {isOnlyEntity && (
                      <button
                        onClick={() => setConfirmingDelete(false)}
                        className="mt-2.5 py-1.5 px-3 text-xs border border-slate-200 bg-white rounded-lg font-medium text-[#0F172A] hover:bg-slate-50 transition-colors duration-150"
                      >
                        Got it
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-slate-100">
          {!active && (
            <button
              onClick={onSwitch}
              className="flex-1 py-2 px-3 text-xs border border-slate-200 rounded-lg font-medium text-[#0F172A] flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-colors duration-150"
            >
              <SwitchIcon />Switch to Entity
            </button>
          )}
          <button
            onClick={handleSave}
            className="flex-1 py-2 px-3 text-xs bg-[#0D9488] text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 hover:bg-[#0f766e] transition-colors duration-150"
          >
            <CheckIcon />Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

/* =========================================================================
   CREATE ENTITY MODAL
   ========================================================================= */

const TypeChoiceCard = ({ Icon, title, description, onClick }) => (
  <button
    onClick={onClick}
    className="flex-1 text-left p-4 rounded-xl border border-slate-200 hover:border-[#0D9488] hover:bg-[#f0fdf9] transition-colors duration-150 group"
  >
    <div className="p-2 bg-[#f0fdf9] group-hover:bg-white rounded-lg border border-slate-100 w-fit mb-2.5 transition-colors duration-150">
      <Icon />
    </div>
    <h4 className="text-sm font-bold text-[#0F172A] mb-1">{title}</h4>
    <p className="text-[11px] text-[#64748B] leading-relaxed">{description}</p>
  </button>
);

const CreateEntityModal = ({ onClose, onCreate }) => {
  const [step, setStep] = useState('choose-type'); // 'choose-type' | 'sole-prop' | 'partnership'
  const [draft, setDraft] = useState(null);

  const startSoleProp = () => { setDraft({ ...BLANK_SOLE_PROP }); setStep('sole-prop'); };
  const startPartnership = () => { setDraft({ ...BLANK_PARTNERSHIP, partners: [{ ...BLANK_PARTNER }] }); setStep('partnership'); };
  const back = () => { setStep('choose-type'); setDraft(null); };

  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });

  const isPartnership = step === 'partnership';
  const canSubmit = draft && draft.name && draft.ssmNo && draft.tin && (
    !isPartnership || (draft.partnerCount && draft.isPrecedentPartner !== null && (draft.isPrecedentPartner || draft.precedentPartnerName))
  );

  const handleSubmit = () => {
    if (!canSubmit) return;
    onCreate(draft);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
      <div className="w-full max-w-lg max-h-[85vh] bg-white rounded-xl shadow-xl flex flex-col overflow-hidden">

        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {step !== 'choose-type' && (
              <button onClick={back} className="text-[#64748B] hover:text-[#0F172A] transition-colors duration-150 mr-1" aria-label="Back">
                <ChevronLeftIcon />
              </button>
            )}
            <h3 className="text-sm font-bold text-[#0F172A]">
              {step === 'choose-type' ? 'Create New Entity' : isPartnership ? 'New Partnership' : 'New Sole Proprietorship'}
            </h3>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors duration-150" aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {step === 'choose-type' && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-[#64748B] mb-1">Select the type of entity you want to add. This determines which LHDN forms apply.</p>
              <div className="flex gap-3">
                <TypeChoiceCard
                  Icon={BuildingIcon}
                  title="Sole Proprietorship"
                  description="A business you run on your own. Files Form B."
                  onClick={startSoleProp}
                />
                <TypeChoiceCard
                  Icon={UsersIcon}
                  title="Partnership"
                  description="A business with other partners. Files Form P and/or Form B."
                  onClick={startPartnership}
                />
              </div>
            </div>
          )}

          {step === 'sole-prop' && (
            <div className="flex flex-col gap-2.5">
              <SectionLabel>Business Particulars</SectionLabel>
              <Field label="Business name" required>
                <TextInput value={draft.name} onChange={set('name')} placeholder="As registered with SSM" />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="SSM registration no." required>
                  <TextInput value={draft.ssmNo} onChange={set('ssmNo')} placeholder="e.g. 202103145678" />
                </Field>
                <Field label="Tax Identification No." required>
                  <TextInput value={draft.tin} onChange={set('tin')} placeholder="IG 1234567890" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Business code">
                  <TextInput value={draft.businessCode} onChange={set('businessCode')} placeholder="LHDN business code" />
                </Field>
                <Field label="Type of business activity">
                  <TextInput value={draft.businessActivity} onChange={set('businessActivity')} placeholder="e.g. F&B retail" />
                </Field>
              </div>

              <SectionLabel><span className="mt-2 block">Business Premise</span></SectionLabel>
              <Field label="Address">
                <TextInput value={draft.premiseAddress} onChange={set('premiseAddress')} placeholder="Street address" />
              </Field>
              <div className="grid grid-cols-3 gap-2.5">
                <Field label="Postcode">
                  <TextInput value={draft.premisePostcode} onChange={set('premisePostcode')} placeholder="40150" />
                </Field>
                <Field label="City">
                  <TextInput value={draft.premiseCity} onChange={set('premiseCity')} placeholder="Shah Alam" />
                </Field>
                <Field label="State">
                  <SelectInput value={draft.premiseState} onChange={set('premiseState')}>
                    <option value="" disabled>Select</option>
                    {MALAYSIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </SelectInput>
                </Field>
              </div>
            </div>
          )}

          {step === 'partnership' && (
            <div className="flex flex-col gap-2.5">
              <SectionLabel>Partnership Particulars</SectionLabel>
              <Field label="Partnership name" required>
                <TextInput value={draft.name} onChange={set('name')} placeholder="As registered with SSM" />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="SSM registration no." required>
                  <TextInput value={draft.ssmNo} onChange={set('ssmNo')} placeholder="e.g. 202301982734" />
                </Field>
                <Field label="Tax Identification No." required hint="Partnership TIN begins with D">
                  <TextInput value={draft.tin} onChange={set('tin')} placeholder="D 1234567890" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Business code">
                  <TextInput value={draft.businessCode} onChange={set('businessCode')} placeholder="LHDN business code" />
                </Field>
                <Field label="Number of partners" required>
                  <TextInput value={draft.partnerCount} onChange={set('partnerCount')} placeholder="e.g. 3" inputMode="numeric" />
                </Field>
              </div>

              <SectionLabel><span className="mt-2 block">Your Role</span></SectionLabel>
              <Field label="Are you the precedent partner?" required hint="The precedent partner submits Form P on behalf of the partnership">
                <SelectInput
                  value={draft.isPrecedentPartner === null ? '' : String(draft.isPrecedentPartner)}
                  onChange={(e) => setDraft({ ...draft, isPrecedentPartner: e.target.value === 'true' })}
                >
                  <option value="" disabled>Select role</option>
                  <option value="true">Yes — I am the precedent partner (files Form P + Form B)</option>
                  <option value="false">No — I am a partner (files Form B only)</option>
                </SelectInput>
              </Field>
              {draft.isPrecedentPartner === false && (
                <Field label="Precedent partner's name" required>
                  <TextInput value={draft.precedentPartnerName} onChange={set('precedentPartnerName')} placeholder="Full name" />
                </Field>
              )}

              <SectionLabel><span className="mt-2 block">Main Business Address</span></SectionLabel>
              <Field label="Address">
                <TextInput value={draft.mainBusinessAddress} onChange={set('mainBusinessAddress')} placeholder="Street address" />
              </Field>
              <div className="grid grid-cols-3 gap-2.5">
                <Field label="Postcode">
                  <TextInput value={draft.mainBusinessPostcode} onChange={set('mainBusinessPostcode')} placeholder="40150" />
                </Field>
                <Field label="City">
                  <TextInput value={draft.mainBusinessCity} onChange={set('mainBusinessCity')} placeholder="Shah Alam" />
                </Field>
                <Field label="State">
                  <SelectInput value={draft.mainBusinessState} onChange={set('mainBusinessState')}>
                    <option value="" disabled>Select</option>
                    {MALAYSIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </SelectInput>
                </Field>
              </div>
            </div>
          )}
        </div>

        {step !== 'choose-type' && (
          <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-slate-100">
            <button onClick={onClose} className="flex-1 py-2 px-3 text-xs border border-slate-200 rounded-lg font-medium text-[#0F172A] hover:bg-slate-50 transition-colors duration-150">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 py-2 px-3 text-xs bg-[#0D9488] text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 hover:bg-[#0f766e] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#0D9488] transition-colors duration-150"
            >
              <CheckIcon />Confirm & Create Entity
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* =========================================================================
   MAIN COMPONENT
   ========================================================================= */

const SEED_ENTITIES = [
  {
    entityType: 'sole-prop',
    name: 'Hafiz Printing & Design',
    ssmNo: '202103145678 (TR02145)',
    tin: 'IG 8823415601',
    businessCode: '47912',
    businessActivity: 'Retail of printed materials',
    premiseAddress: 'No. 12, Jalan SS15/4',
    premisePostcode: '47500',
    premiseCity: 'Subang Jaya',
    premiseState: 'Selangor',
    salesTurnover: '186400',
    totalExpenditure: '142100',
    netProfitLoss: '44300',
    totalAssets: '98200',
    totalLiabilities: '21500',
  },
  {
    entityType: 'partnership',
    name: 'Urban Brew Partners',
    ssmNo: '202301982734',
    tin: 'D 1109283745',
    businessCode: '56101',
    businessActivity: 'Cafe and restaurant operations',
    partnerCount: '3',
    basisOfApportionment: 'Equal Split',
    employerNo: 'E 2208841',
    isPrecedentPartner: true,
    precedentPartnerName: '',
    mainBusinessAddress: 'Lot 4, Jalan PJU 5/1',
    mainBusinessPostcode: '47810',
    mainBusinessCity: 'Petaling Jaya',
    mainBusinessState: 'Selangor',
    partners: [
      { name: 'Mohd Rais Faiq Nichol', identificationNo: '950312-10-5521', incomeTaxNo: 'IG 4471002938', countryOfResidence: 'MYS', profitShare: '40', dateAppointed: '2023-04-01' },
      { name: 'Aiman Bin Yusof', identificationNo: '930621-08-5142', incomeTaxNo: 'IG 5512239871', countryOfResidence: 'MYS', profitShare: '35', dateAppointed: '2023-04-01' },
      { name: 'Lim Wei Jian', identificationNo: '910114-14-6633', incomeTaxNo: 'IG 6634110982', countryOfResidence: 'MYS', profitShare: '25', dateAppointed: '2023-04-01' },
    ],
  },
  {
    entityType: 'partnership',
    name: 'Northline Logistics Co.',
    ssmNo: '202209876543',
    tin: 'D 2207765432',
    businessCode: '49230',
    businessActivity: 'Freight transport arrangement',
    partnerCount: '4',
    basisOfApportionment: 'No Salaries or Interest',
    employerNo: 'E 1190233',
    isPrecedentPartner: false,
    precedentPartnerName: 'Adam Bin Razak',
    mainBusinessAddress: 'No. 8, Jalan Industri 2/3',
    mainBusinessPostcode: '40200',
    mainBusinessCity: 'Shah Alam',
    mainBusinessState: 'Selangor',
    partners: [
      { name: 'Adam Bin Razak', identificationNo: '880905-10-1123', incomeTaxNo: 'IG 1123456789', countryOfResidence: 'MYS', profitShare: '30', dateAppointed: '2022-09-15' },
      { name: 'Mohd Rais Faiq Nichol', identificationNo: '950312-10-5521', incomeTaxNo: 'IG 4471002938', countryOfResidence: 'MYS', profitShare: '25', dateAppointed: '2022-09-15' },
    ],
  },
];

export default function ManageProfile() {
  const [personalProfile, setPersonalProfile] = useState(BLANK_PERSONAL_PROFILE);
  const [showPersonalPanel, setShowPersonalPanel] = useState(false);

  const [entities, setEntities] = useState(SEED_ENTITIES);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleSwitch = (index) => {
    setActiveIndex(index);
  };

  const handleSaveEdit = (updatedEntity) => {
    const next = [...entities];
    next[previewIndex] = updatedEntity;
    setEntities(next);
    setPreviewIndex(null);
  };

  const handleDelete = () => {
    const next = entities.filter((_, i) => i !== previewIndex);
    setEntities(next);
    if (activeIndex === previewIndex) {
      setActiveIndex(0);
    } else if (activeIndex > previewIndex) {
      setActiveIndex(activeIndex - 1);
    }
    setPreviewIndex(null);
  };

  const handleCreateEntity = (draft) => {
    setEntities([...entities, draft]);
    setActiveIndex(entities.length);
    setShowCreateModal(false);
  };

  const handleSavePersonal = (updated) => {
    setPersonalProfile(updated);
    setShowPersonalPanel(false);
  };

  return (
    <div className="h-full flex flex-col gap-3">

      {/* Personal profile — fixed, account-level */}
      <div className="shrink-0">
        <PersonalProfileSummary profile={personalProfile} onOpen={() => setShowPersonalPanel(true)} />
      </div>

      {/* Entities — flex-1 so this section fills remaining height */}
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">Business & Partnership Profiles</h2>
            <p className="text-[11px] text-[#64748B] mt-0.5">Maintain the registered details LHDN requires for each entity you file on behalf of.</p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0f766e] transition-colors duration-150 shrink-0"
          >
            <PlusIcon />Create New Entity
          </button>
        </div>

        {/* Scrollable card grid — only internal zone that scrolls */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
          <div className="grid grid-cols-3 gap-3 auto-rows-fr pb-1">
            {entities.map((entity, index) => (
              <EntityCard
                key={index}
                entity={entity}
                active={activeIndex === index}
                onSwitch={() => handleSwitch(index)}
                onOpenPreview={() => setPreviewIndex(index)}
              />
            ))}
          </div>
        </div>
      </div>

      {showPersonalPanel && (
        <PersonalProfilePanel
          profile={personalProfile}
          onClose={() => setShowPersonalPanel(false)}
          onSave={handleSavePersonal}
        />
      )}

      {previewIndex !== null && (
        <EntityPreviewPanel
          entity={entities[previewIndex]}
          active={activeIndex === previewIndex}
          isOnlyEntity={entities.length === 1}
          onClose={() => setPreviewIndex(null)}
          onSave={handleSaveEdit}
          onSwitch={() => { handleSwitch(previewIndex); setPreviewIndex(null); }}
          onDelete={handleDelete}
        />
      )}

      {showCreateModal && (
        <CreateEntityModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateEntity}
        />
      )}
    </div>
  );
}