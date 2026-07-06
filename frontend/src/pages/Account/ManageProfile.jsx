import React, { useState, useEffect } from 'react';
import cukaiLogo from '../../assets/cukai-logo.png';
import { currentFilingYear, buildFormData, fmtRM, fmtAmt } from '../../data/formB';

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
  fullName: '',
  idType: 'ic',
  identificationNo: '',
  personalTin: '',
  citizenship: '',
  gender: '',
  dateOfBirth: '',
  // Marital / dependents
  maritalStatus: '',
  maritalEventDate: '',
  spouseName: '',
  spouseIdNo: '',
  spouseDob: '',
  assessmentType: '',
  numberOfChildren: '0',
  hasDisabledDependents: false,
  // Contact
  phone: '',
  email: '',
  correspondenceAddress: '',
  correspondencePostcode: '',
  correspondenceCity: '',
  correspondenceState: '',
  refundMethod: 'bank',
  bankName: '',
  bankAccountNo: '',
  // Compliance flags
  recordKeeping: true,
  hasForeignAccounts: false,
  rpgtDisposal: false,
  // Relief category toggles
  hasDependentParents: false,
  hasEpfLifeInsurance: false,
  hasEducationMedicalInsurance: false,
  hasLifestylePurchases: false,
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
          <span className="capitalize">{(profile.maritalStatus || '').replace('-', ' ') || 'Not set'}</span>
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

  React.useEffect(() => {
    if (profile) {
      setDraft(profile);
    }
  }, [profile]); // Fires automatically the exact millisecond personalProfile updates!

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
              label="EPF, life insurance &amp; PRS"
              hint="Voluntary EPF contributions, life insurance / takaful premiums, or Private Retirement Scheme (PRS)"
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
   TAB NAVIGATION — Manage Entities / Generate Forms
   ========================================================================= */

const ProfileTabNav = ({ active, onChange }) => {
  const tabs = [
    { id: 'entities', label: 'Manage Entities' },
    { id: 'forms',    label: 'Generate Forms' },
  ];
  return (
    <nav className="flex items-center gap-6 border-b border-slate-100 shrink-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`relative pb-2 pt-0.5 text-sm font-medium transition-all duration-150 select-none ${
            active === t.id ? 'text-[#0D9488] font-semibold' : 'text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          {t.label}
          {active === t.id && <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-[#0F6E56]" />}
        </button>
      ))}
    </nav>
  );
};

/* =========================================================================
   ENTITY CARD — dense, 3-up
   ========================================================================= */

const EntityCard = ({ entity, active, onSwitch, onOpenPreview, personalTin }) => {
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
        <span className="text-[#64748B]">Personal TIN:</span><span className="font-semibold text-[#0F172A] truncate">{personalTin || '—'}</span>
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

const EntityPreviewPanel = ({ entity, active, isOnlyEntity, isNew = false, onClose, onSave, onSwitch, onDelete }) => {
  const [draft, setDraft] = useState(entity);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isPartnership = draft.entityType === 'partnership';
  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });

  const canSave = isNew ? !!(draft.name && draft.ssmNo) : true;
  const handleSave = () => { if (canSave) onSave(draft); };

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
                <h3 className="text-sm font-bold text-[#0F172A] truncate">
                  {isNew ? 'New Sole Proprietorship' : (draft.name || 'Untitled Entity')}
                </h3>
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
          <Field label="SSM registration no." required>
            <TextInput value={draft.ssmNo} onChange={set('ssmNo')} placeholder="e.g. 202103145678" />
          </Field>
          {isPartnership && (
            <Field label="Partnership Tax Identification No." required hint="Begins with D — unique to this partnership">
              <TextInput value={draft.tin} onChange={set('tin')} placeholder="D 1234567890" />
            </Field>
          )}
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

          {/* Danger zone — hidden when creating a new entity */}
          {!isNew && <div className="mt-4 pt-4 border-t border-slate-100">
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
          </div>}
        </div>

        <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-slate-100">
          {!active && !isNew && (
            <button
              onClick={onSwitch}
              className="flex-1 py-2 px-3 text-xs border border-slate-200 rounded-lg font-medium text-[#0F172A] flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-colors duration-150"
            >
              <SwitchIcon />Switch to Entity
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`flex-1 py-2 px-3 text-xs rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors duration-150 ${canSave ? "bg-[#0D9488] text-white hover:bg-[#0f766e]" : "bg-slate-100 text-slate-400 cursor-not-allowed"}`}
          >
            <CheckIcon />{isNew ? 'Create Entity' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* =========================================================================
   GENERATE FORMS — Form B draft for the individual (sole proprietor)
   --------------------------------------------------------------------------
   Built entirely from the user's own data: their personal profile plus every
   business entity they own. Financials are ACCUMULATED across all entities;
   the main business (highest sales turnover, or the sole entity) supplies the
   Part N particulars. Nothing re-fetches on entity switch — it's the person's
   return, not a per-entity view.

   All non-component logic (filing year, formatting, tax + relief computation,
   buildFormData) lives in ./formB.js so this file stays a clean Fast Refresh
   boundary. Only React components live here.
   ========================================================================= */

// ─── Government-form primitives (Form B look) ────────────────────────────────
const FPart = ({ code, title, children }) => (
  <div className="mt-3 first:mt-0">
    <div className="flex items-center gap-2 bg-[#E2E8F0] border border-[#CBD5E1] px-2 py-1">
      {code && <span className="text-[10px] font-bold text-[#0F172A]">{code}</span>}
      <span className="text-[10px] font-bold uppercase tracking-wide text-[#0F172A]">{title}</span>
    </div>
    <div className="border border-t-0 border-[#CBD5E1] divide-y divide-[#EDF1F5]">{children}</div>
  </div>
);

const FRow = ({ code, label, value, sub, strong, highlight }) => (
  <div className={`flex items-stretch text-[10px] ${highlight ? 'bg-[#F0FDF4]' : ''}`}>
    <div className="w-9 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">{code || ''}</div>
    <div className={`flex-1 px-2 py-1 ${sub ? 'pl-4 text-[#64748B]' : 'text-[#334155]'} ${strong ? 'font-semibold text-[#0F172A]' : ''}`}>{label}</div>
    <div className={`w-36 shrink-0 border-l border-[#EDF1F5] px-2 py-1 text-right tabular-nums ${strong ? 'font-bold text-[#0F172A]' : (highlight ? 'text-[#0F6E56] font-semibold' : 'text-[#0F172A]')}`}>{value}</div>
  </div>
);

// A pair of "code | label | value" columns side by side (used by Part N's
// profit-and-loss / balance-sheet two-column layout).
const FCol = ({ children }) => <div className="flex-1 border border-[#CBD5E1] divide-y divide-[#EDF1F5]">{children}</div>;

// ─── The full Form B document (Basic Particulars → Part P) ───────────────────
// Faithful to the LHDN Form B (CP4A) skeleton: every part is present and
// numbered; values are filled from the user's data where available and left
// blank (as on the real form) where the app doesn't hold that figure.
const FormBDocument = ({ fd, filingYear }) => {
  const t = fd.totals;
  const netProfit = t.netProfit !== 0 ? t.netProfit : t.turnover - t.expenditure;
  const blank = '';
  return (
    <div className="bg-white text-[#0F172A]" style={{ width: 620 }}>
      {/* Masthead */}
      <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b-2 border-[#0F172A]">
        <img src={cukaiLogo} alt="" className="h-9 w-9 shrink-0" />
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[11px] font-bold leading-tight">LEMBAGA HASIL DALAM NEGERI MALAYSIA</p>
          <p className="text-[10px] font-bold leading-tight">RETURN FORM OF AN INDIVIDUAL (RESIDENT WHO CARRIES ON BUSINESS)</p>
          <p className="text-[8px] leading-tight text-[#475569]">UNDER SECTION 77 OF THE INCOME TAX ACT 1967</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[8px] uppercase tracking-wide text-[#94A3B8]">Form</p>
          <p className="text-2xl font-black leading-none text-[#0F172A]">B</p>
          <p className="text-[9px] font-bold text-[#0F6E56]">YA {filingYear}</p>
        </div>
      </div>

      <div className="px-5 py-3">
        <FPart title="Basic Particulars">
          <FRow code="1" label="Name (as per identification document)" value={fd.name} />
          <FRow code="2" label="Tax Identification No. (TIN)" value={fd.tin} />
          <FRow code="3" label="Identification no." value={fd.idNo} />
          <FRow code="4" label="Current passport no." value={blank} />
          <FRow code="5" label="Passport no. registered with LHDNM" value={blank} />
        </FPart>

        <FPart code="A" title="Particulars of Individual">
          <FRow code="A1" label="Citizen (country code)" value={fd.citizen} />
          <FRow code="A2" label="Gender" value={fd.gender} />
          <FRow code="A3" label="Date of birth" value={fd.dob} />
          <FRow code="A4" label={`Status as at 31-12-${filingYear}`} value={fd.marital} />
          <FRow code="A5" label="Date of marriage / divorce / demise" value={fd.maritalEventDate} />
          <FRow code="A6" label="Record-keeping" value={fd.recordKeeping} />
          <FRow code="A7" label="Type of assessment" value={fd.assessment} />
        </FPart>

        <FPart code="B" title="Computation of Income Tax" >
          <FRow code="B1" label="Statutory income from businesses in Malaysia" value={fmtAmt(fd.totalIncome)} />
          <FRow code="B2" label="Statutory income from partnerships in Malaysia" value={fmtAmt(0)} />
          <FRow code="B4" label="Aggregate statutory income from businesses (B1+B2+B3)" value={fmtAmt(fd.totalIncome)} />
          <FRow code="B6" label="TOTAL (B4 − B5)" value={fmtAmt(fd.totalIncome)} />
          <FRow code="B7" label="Statutory income from employment" value={fmtAmt(0)} />
          <FRow code="B8" label="Statutory income from rents" value={fmtAmt(0)} />
          <FRow code="B11" label="AGGREGATE INCOME (B6+B7+B8+B9+B10)" value={fmtAmt(fd.totalIncome)} strong />
          <FRow code="B17" label="LESS: Approved donations / gifts (from G8)" value={fmtAmt(0)} />
          <FRow code="B20" label="TOTAL INCOME [SELF] (B18 + B19)" value={fmtAmt(fd.totalIncome)} strong />
          <FRow code="B22" label="AGGREGATE OF TOTAL INCOME (B20 + B21)" value={fmtAmt(fd.totalIncome)} />
          <FRow code="B23" label="Total relief (from H22)" value={fmtAmt(fd.reliefTotal)} />
          <FRow code="B24" label="CHARGEABLE INCOME (B20 − B23) or (B22 − B23)" value={fmtAmt(fd.chargeableIncome)} strong highlight />
          <FRow code="B26" label="TOTAL INCOME TAX (B25a + B25b)" value={fmtAmt(fd.taxCharged)} />
          <FRow code="B27" label="LESS: Total rebate — self" value={fmtAmt(fd.rebate)} />
          <FRow code="B28" label="TOTAL TAX CHARGED (B26 − B27)" value={fmtAmt(fd.taxCharged280)} strong />
          <FRow code="B33" label="Payment made — MTD / CP500 instalments" value={fmtAmt(fd.lessInstalment)} />
          <FRow code="B34" label="Balance of tax payable (B31 − B33)" value={fmtAmt(fd.taxPayable)} strong highlight />
        </FPart>

        <FPart code="C" title="Particulars of Husband / Wife">
          <FRow code="C1" label="Name of husband / wife" value={fd.spouseName} />
          <FRow code="C2" label="Identification no." value={fd.spouseIdNo} />
          <FRow code="C3" label="Date of birth" value={fd.spouseDob} />
          <FRow code="C4" label="Passport no." value={blank} />
        </FPart>

        <FPart code="D" title="Other Particulars">
          <FRow code="D1" label="Telephone no." value={fd.phone} />
          <FRow code="D2" label="E-mail" value={fd.email} />
          <FRow code="D5" label="Financial account(s) outside Malaysia" value={fd.hasForeignAccounts} />
          <FRow code="D7" label="Address of business premise" value={fd.businessAddress} />
          <FRow code="D8" label="Correspondence address" value={fd.correspondenceAddress} />
          <FRow code="D9" label="Method of payment for tax refund" value={fd.refundMethod} />
          <FRow code="D10a" label="Name of bank" value={fd.bankName} />
          <FRow code="D10b" label="Bank account no." value={fd.bankAccountNo} />
          <FRow code="D12a" label="Disposal of asset under RPGT Act 1976" value={fd.rpgtDisposal} />
        </FPart>

        <FPart code="E" title="Statutory Income — Business / Partnership Outside Malaysia">
          <FRow code="E1" label="Business 1" value={blank} />
          <FRow code="E2" label="Partnership 1" value={blank} />
          <FRow code="E4" label="TOTAL (transfer to B3)" value={fmtAmt(0)} />
        </FPart>

        <FPart code="F" title="Other Statutory Income From Outside Malaysia">
          <FRow code="F1" label="Income received in Malaysia" value={blank} />
          <FRow code="F4" label="TOTAL (transfer to B10)" value={fmtAmt(0)} />
        </FPart>

        <FPart code="G" title="Donations / Gifts / Contributions">
          <FRow code="G1" label="Gift of money to Government / local authority" value={fmtAmt(0)} />
          <FRow code="G2" label="Gift of money to approved institutions / funds" value={fmtAmt(0)} />
          <FRow code="G8" label="Total approved donations (transfer to B17)" value={fmtAmt(0)} strong />
        </FPart>

        <FPart code="H" title="Relief">
          {fd.reliefItems.map(([code, label, amount]) => (
            <FRow key={code} code={code} label={label} value={fmtAmt(amount)} />
          ))}
          <FRow code="H22" label="TOTAL RELIEF [H1 to H21] (transfer to B23)" value={fmtAmt(fd.reliefTotal)} strong highlight />
        </FPart>

        <FPart code="J" title="Incentive Claim">
          <FRow code="J1" label="Special / further / double deductions under s.127(3)(b)" value={blank} />
          <FRow code="J2" label="Incentive(s) under subsection 127(3A)" value={blank} />
        </FPart>

        <FPart code="K" title="Non-Employment Income of Preceding Years Not Declared">
          <FRow code="K1" label="Type of income / year of assessment" value={blank} />
        </FPart>

        <FPart code="L" title="Tax Exempt Income From Outside Malaysia Received in Malaysia">
          <FRow code="L5" label="TOTAL" value={fmtAmt(0)} />
        </FPart>

        <FPart code="M" title="Particulars of Business Income (Losses)">
          <FRow code="M2" label="Business capital allowances carried forward" value={fmtAmt(0)} />
          <FRow code="M3" label="Partnership capital allowances carried forward" value={fmtAmt(0)} />
        </FPart>

        {/* Part N — two-column P&L / balance sheet */}
        <div className="mt-3">
          <div className="flex items-center gap-2 bg-[#E2E8F0] border border-[#CBD5E1] px-2 py-1">
            <span className="text-[10px] font-bold">N</span>
            <span className="text-[10px] font-bold uppercase tracking-wide">
              Financial Particulars of Individual (Main Business Only){fd.entityCount > 1 ? ` — combined across ${fd.entityCount} entities` : ''}
            </span>
          </div>
          <div className="border border-t-0 border-[#CBD5E1] divide-y divide-[#EDF1F5]">
            <FRow code="N1" label="Name of business" value={fd.businessName} />
            <FRow code="N1a" label="Registration no." value={fd.businessRegNo} />
            <FRow code="N2" label="Business code" value={fd.businessCode} />
            <FRow code="N2a" label="Type of business activity" value={fd.businessActivity} />
          </div>
          <div className="flex mt-1 gap-1">
            <FCol>
              <div className="bg-[#F1F5F9] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#475569]">Statement of Profit or Loss</div>
              <FRow code="N3" label="Sales / turnover" value={fmtAmt(t.turnover)} />
              <FRow code="N8" label="Gross profit / loss (N3 − N7)" value={fmtAmt(t.turnover - t.expenditure)} />
              <FRow code="N25" label="TOTAL EXPENDITURE (N15 to N24)" value={fmtAmt(t.expenditure)} strong />
              <FRow code="N26" label="NET PROFIT / LOSS" value={fmtAmt(netProfit)} strong highlight />
            </FCol>
            <FCol>
              <div className="bg-[#F1F5F9] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#475569]">Statement of Financial Position</div>
              <FRow code="N41" label="TOTAL ASSETS (N32 + N33 + N40)" value={fmtAmt(t.assets)} />
              <FRow code="N45" label="TOTAL LIABILITIES (N42 to N44)" value={fmtAmt(t.liabilities)} strong />
              <FRow code="N46" label="Capital account" value={fmtAmt(t.assets - t.liabilities)} />
              <FRow code="N50" label="Current account balance carried forward" value={blank} />
            </FCol>
          </div>
        </div>

        <FPart code="P" title="Particulars of Tax Agent Who Completes This Return Form">
          <FRow code="P1" label="Name of tax agent" value={blank} />
          <FRow code="P2" label="Tax agent's approval no." value={blank} />
          <FRow code="P3" label="Name of firm" value={blank} />
          <FRow code="P9" label="Date of signature" value={blank} />
        </FPart>

        <div className="mt-3 border border-[#CBD5E1]">
          <div className="bg-[#E2E8F0] px-2 py-1 text-[10px] font-bold uppercase tracking-wide">Declaration</div>
          <p className="px-2 py-2 text-[9px] leading-relaxed text-[#475569]">
            I, <span className="font-semibold text-[#0F172A]">{fd.name}</span> (Identification no. {fd.idNo}), hereby declare that the information regarding the income and claim for deductions and reliefs given by me in this return form and in any document attached is true, correct and complete.
          </p>
        </div>

        <p className="mt-3 text-[8px] text-[#94A3B8] text-center leading-relaxed">
          cukai.ai pre-filled draft — for reference only. Figures are accumulated from your entities and profile; reliefs are estimated at statutory caps. Verify every value and file at mytax.hasil.gov.my. Prescribed under s.152 ITA 1967 (CP4A — Pin. {filingYear}).
        </p>
      </div>
    </div>
  );
};

// ─── Preview slide-over (with functional "Download PDF") ─────────────────────
function FormBPreview({ fd, filingYear, onClose }) {
  const [zoom, setZoom] = useState(100);
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
  const handleClose = () => { setVisible(false); setTimeout(onClose, 300); };

  // Functional download: the print stylesheet below isolates #formb-printable
  // and resets the zoom transform, so the browser's print dialog produces a
  // clean PDF that matches the on-screen form exactly. Setting document.title
  // makes the browser suggest "Form_B_YA<year>.pdf" as the filename.
  const handleDownload = () => {
    const prev = document.title;
    document.title = `Form_B_YA${filingYear}`;
    window.print();
    setTimeout(() => { document.title = prev; }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={handleClose}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #formb-printable, #formb-printable * { visibility: visible !important; }
          #formb-zoomwrap { transform: none !important; }
          #formb-printable {
            position: absolute !important; left: 0 !important; top: 0 !important;
            width: 100% !important; box-shadow: none !important; border-radius: 0 !important;
          }
          @page { size: A4 portrait; margin: 12mm; }
        }
      `}</style>

      <div className={`no-print flex-1 bg-black/40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />

      <div
        className={`relative flex h-full w-[720px] max-w-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={(e) => e.stopPropagation()}>
        <div className="no-print flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3 bg-[#F8FAFC] shrink-0">
          <div>
            <p className="text-sm font-bold text-[#0F172A]">Form B Preview — YA {filingYear}</p>
            <p className="text-[10px] text-[#64748B] mt-0.5">Pre-filled draft. Verify all values before submitting to LHDN.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2 py-1">
              <button onClick={() => setZoom((z) => Math.max(60, z - 10))} className="text-[#64748B] hover:text-[#0F172A] px-1 text-sm font-bold">−</button>
              <span className="text-[10px] text-[#64748B] w-8 text-center">{zoom}%</span>
              <button onClick={() => setZoom((z) => Math.min(150, z + 10))} className="text-[#64748B] hover:text-[#0F172A] px-1 text-sm font-bold">+</button>
            </div>
            <button onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0f766e] transition-colors duration-150">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download
            </button>
            <button onClick={handleClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors ml-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#E8EBEF] p-6">
          <div id="formb-zoomwrap" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', transition: 'transform 0.2s' }}>
            <div id="formb-printable" className="mx-auto shadow-xl rounded-lg overflow-hidden">
              <FormBDocument fd={fd} filingYear={filingYear} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Compact on-screen summary primitives ────────────────────────────────────
function InlineSummary({ title, children }) {
  return (
    <div>
      <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#94A3B8]">{title}</p>
      <div className="rounded-lg border border-[#F1F5F9] divide-y divide-[#F1F5F9] overflow-hidden">{children}</div>
    </div>
  );
}
function SRow({ label, value, bold, highlight }) {
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 ${highlight ? 'bg-[#F0FDF4]' : ''}`}>
      <span className={`text-[10px] ${bold ? 'font-semibold text-[#0F172A]' : 'text-[#64748B]'}`}>{label}</span>
      <span className={`text-[10px] ml-6 text-right ${bold ? 'font-bold' : 'font-medium'} ${highlight ? 'text-[#0F6E56]' : 'text-[#0F172A]'}`}>{value}</span>
    </div>
  );
}

// ─── Generate Forms panel (the tab body) ──────────────────────────────────────
const GenerateFormsPanel = ({ profile, entities }) => {
  const [showPreview, setShowPreview] = useState(false);
  const filingYear = currentFilingYear();
  const owned = entities || [];
  const fd = buildFormData(profile || BLANK_PERSONAL_PROFILE, owned);
  const { totals, totalIncome, reliefItems, reliefTotal, chargeableIncome, taxCharged, rebate, taxPayable, entityCount } = fd;
  const netProfit = totals.netProfit !== 0 ? totals.netProfit : totals.turnover - totals.expenditure;

  if (owned.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="max-w-sm text-center px-6">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#f0fdf9] border border-slate-100 text-[#0D9488]">
            <BuildingIcon />
          </div>
          <p className="text-sm font-bold text-[#0F172A]">No business entities yet</p>
          <p className="text-[11px] text-[#64748B] mt-1 leading-relaxed">
            Your Form B draft is built from the entities you own. Add a business under <span className="font-semibold">Manage Entities</span> to generate the return.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      {showPreview && (
        <FormBPreview fd={fd} filingYear={filingYear} onClose={() => setShowPreview(false)} />
      )}

      {/* Header — title / description / actions (mirrors the Manage Entities tab) */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-sm font-bold text-[#0F172A]">Form B — Personal Return YA {filingYear}</h2>
          <p className="text-[11px] text-[#64748B] mt-0.5">
            {entityCount > 1
              ? `Combined across ${entityCount} entities · Main business: ${fd.businessName}`
              : `Based on ${fd.businessName}`} · Verify before submitting to LHDN
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowPreview(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#0D9488] bg-white px-3 py-1.5 text-xs font-semibold text-[#0D9488] hover:bg-[#f0fdf9] transition-colors duration-150"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            Preview
          </button>
          <button
            onClick={() => setShowPreview(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0f766e] transition-colors duration-150"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export PDF
          </button>
        </div>
      </div>

      {/* At-a-glance summary — full form lives in the Preview */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
        <div className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
          <div className="px-5 py-4 space-y-4">
            <InlineSummary title="Part B — Income Computation">
              <SRow label="B1  Statutory business income (all entities)" value={fmtRM(totalIncome)} />
              <SRow label="B11 Aggregate income" value={fmtRM(totalIncome)} bold />
              <SRow label="B23 Total relief" value={fmtRM(reliefTotal)} />
              <SRow label="B24 Chargeable income" value={fmtRM(chargeableIncome)} bold highlight />
              <SRow label="B26 Total income tax" value={fmtRM(taxCharged)} />
              <SRow label={`B28 Tax charged (after rebate ${fmtRM(rebate)})`} value={fmtRM(Math.max(0, taxCharged - rebate))} bold />
              <SRow label="B34 Balance tax payable" value={fmtRM(taxPayable)} bold highlight />
            </InlineSummary>

            <InlineSummary title="Part H — Relief Breakdown (estimated at statutory caps)">
              {reliefItems.map(([code, label, amount]) => (
                <SRow key={code} label={`${code}  ${label}`} value={fmtRM(amount)} />
              ))}
              <SRow label="H22 TOTAL RELIEF" value={fmtRM(reliefTotal)} bold highlight />
            </InlineSummary>

            <InlineSummary title={entityCount > 1 ? `Part N — Business Particulars (combined, ${entityCount} entities)` : 'Part N — Business Financial Particulars'}>
              <SRow label="N1  Main business" value={fd.businessName} />
              <SRow label="N2  Business code (MSIC)" value={fd.businessCode} />
              <SRow label="N3  Sales / turnover" value={fmtRM(totals.turnover)} />
              <SRow label="N25 Total expenditure" value={fmtRM(totals.expenditure)} bold />
              <SRow label="N26 Net profit / loss" value={fmtRM(netProfit)} bold highlight />
              <SRow label="N41 Total assets" value={fmtRM(totals.assets)} />
              <SRow label="N45 Total liabilities" value={fmtRM(totals.liabilities)} />
            </InlineSummary>

            <p className="text-[9px] text-[#94A3B8] leading-relaxed">
              Reliefs are estimated at their statutory maximums from the toggles on your personal profile — confirm the actual amounts before filing. Employment, rental and other non-business income are not included in this draft. Open <span className="font-semibold">Preview</span> to see and download the full Form B.
            </p>
          </div>
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

export default function ManageProfile({ initialProfile, initialEntities, activeEntityId, onSavePersonal, onCreateEntity, onSaveEntity, onDeleteEntity, onSwitchEntity }) {
  // Use initialProfile if available, otherwise fall back to your static BLANK_PERSONAL_PROFILE structure
  const [personalProfile, setPersonalProfile] = useState(initialProfile || BLANK_PERSONAL_PROFILE);
  const [entities, setEntities] = useState(initialEntities || []);

  // Watch for when the data finishes downloading from ManageAccount.jsx
  React.useEffect(() => {
    if (initialProfile) {
      setPersonalProfile(initialProfile);
    }
  }, [initialProfile]);

  React.useEffect(() => {
    if (initialEntities && initialEntities.length > 0) {
      setEntities(initialEntities);
      setActiveIndex(resolveActiveIndex(initialEntities, activeEntityId));
    }
  }, [initialEntities, activeEntityId]);

  // Derive activeIndex from the persisted activeEntityId prop
  const resolveActiveIndex = (entities, id) => {
    if (!id || !entities || entities.length === 0) return 0;
    const idx = entities.findIndex((e) => e.id === id);
    return idx >= 0 ? idx : 0;
  };
  const [activeIndex, setActiveIndex] = useState(() => resolveActiveIndex(initialEntities, activeEntityId));
  const [previewIndex, setPreviewIndex] = useState(null);
  const [showPersonalPanel, setShowPersonalPanel] = useState(false);
  const [newEntityDraft, setNewEntityDraft] = useState(null);
  // Tabs sit below the always-visible personal summary and govern only the
  // business-profiles area: entity management vs the generated Form B draft.
  const [tab, setTab] = useState('entities');
  
  // Add these two states right below them to track network status:
  const [error, setError] = useState(null);

  const handleSwitch = (index) => {
    setActiveIndex(index);
    const entity = entities[index];
    if (entity && entity.id && onSwitchEntity) {
      onSwitchEntity(entity.id);
    }
  };

  const handleSaveEdit = async (updatedEntity) => {
    if (onSaveEntity && updatedEntity.id) {
      const ok = await onSaveEntity(updatedEntity);
      if (!ok) {
        alert('Could not save entity changes. Please try again.');
        return;
      }
    }
    const next = [...entities];
    next[previewIndex] = updatedEntity;
    setEntities(next);
    setPreviewIndex(null);
  };

  const handleDelete = async () => {
    const entityToDelete = entities[previewIndex];

    if (onDeleteEntity && entityToDelete?.id) {
      const ok = await onDeleteEntity(entityToDelete.id);
      if (!ok) {
        alert('Could not delete entity. Please try again.');
        return;
      }
    }

    const next = entities.filter((_, i) => i !== previewIndex);
    setEntities(next);
    if (activeIndex === previewIndex) {
      setActiveIndex(0);
    } else if (activeIndex > previewIndex) {
      setActiveIndex(activeIndex - 1);
    }
    setPreviewIndex(null);
  };

  const handleCreateEntity = async (draft) => {
    if (onCreateEntity) {
      const created = await onCreateEntity(draft);
      if (!created) {
        alert('Could not create entity. Please try again.');
        return;
      }
      // Use the server-returned entity (with its real id)
      setEntities((prev) => [...prev, created]);
      const newIndex = entities.length; // index before appending
      setActiveIndex(newIndex);
      if (created.id && onSwitchEntity) onSwitchEntity(created.id);
    } else {
      // Fallback: local-only (no backend wired)
      setEntities((prev) => [...prev, draft]);
      setActiveIndex(entities.length);
    }
    setShowCreateModal(false);
  };

  const handleSavePersonal = async (updatedData) => {
    if (!onSavePersonal) {
      // No save handler wired up — just close the panel optimistically
      setPersonalProfile(updatedData);
      setShowPersonalPanel(false);
      return;
    }
    const success = await onSavePersonal(updatedData);
    if (success) {
      setPersonalProfile(updatedData);
      setShowPersonalPanel(false);
    } else {
      alert('Something went wrong saving your changes. Please try again.');
    }
  };


  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-600 rounded-xl text-xs border border-red-100 m-6">
        ⚠️ {error}
      </div>
    );
  }
  
  return (
    <div className="h-full flex flex-col gap-3">

      {/* Personal profile — fixed, account-level */}
      <div className="shrink-0">
        <PersonalProfileSummary profile={personalProfile} onOpen={() => setShowPersonalPanel(true)} />
      </div>

      <ProfileTabNav active={tab} onChange={setTab} />

      {/* Business profiles — tabbed: Manage Entities / Generate Forms */}
      {tab === 'entities' && (
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">Business Profiles</h2>
            <p className="text-[11px] text-[#64748B] mt-0.5">Maintain the registered details LHDN requires for each entity you file on behalf of.</p>
          </div>
          <button
            onClick={() => setNewEntityDraft({ ...BLANK_SOLE_PROP })}
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
                key={entity.id || index}
                entity={entity}
                active={activeIndex === index}
                onSwitch={() => handleSwitch(index)}
                onOpenPreview={() => setPreviewIndex(index)}
                personalTin={personalProfile.personalTin}
              />
            ))}
          </div>
        </div>
      </div>
      )}

      {tab === 'forms' && (
        <GenerateFormsPanel profile={personalProfile} entities={entities} />
      )}

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

      {newEntityDraft !== null && (
        <EntityPreviewPanel
          entity={newEntityDraft}
          active={false}
          isOnlyEntity={false}
          isNew={true}
          onClose={() => setNewEntityDraft(null)}
          onSave={(draft) => { handleCreateEntity(draft); setNewEntityDraft(null); }}
          onSwitch={() => {}}
          onDelete={() => setNewEntityDraft(null)}
        />
      )}
    </div>
  );
}