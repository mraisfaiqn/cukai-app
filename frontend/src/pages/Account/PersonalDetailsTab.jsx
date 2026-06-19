import React, { useState } from 'react';

const SaveIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
  </svg>
);

const Field = ({ label, children }) => (
  <div className="space-y-1">
    <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">{label}</label>
    {children}
  </div>
);

const inputCls = "w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-[#0D9488] transition-colors bg-white";
const disabledCls = "w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed";

export default function PersonalDetailsTab() {
  const [formData, setFormData] = useState({
    fullName: 'Hafiz bin Razak',
    email: 'hafiz@printing.com',
    phone: '+60 12-345 6789',
    icNumber: '920115-14-5531',
    maritalStatus: 'Married',
    dependencies: '2 Children (Under 18)',
    incomeSource: 'Employment & Business',
    annualIncome: '125,000',
    epfSavings: '12,400',
    medicalInsurance: '3,200',
    industry: 'Creative & Printing Services',
    businessExpenses: 'Capital equipment, raw paper stocks, logistics',
  });

  const [isSaving, setIsSaving] = useState(false);
  const set = (key) => (e) => setFormData({ ...formData, [key]: e.target.value });

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => { setIsSaving(false); alert('Profile updated successfully!'); }, 800);
  };

  return (
    <div className="h-full flex flex-col gap-2">

      {/* Single unified card */}
      <div className="flex-1 min-h-0 bg-white rounded-xl border border-slate-100 shadow-sm p-4 grid grid-cols-4 gap-x-6 gap-y-3 content-start">

        {/* Col divider labels */}
        <p className="col-span-2 font-headings text-lg font-bold text-headings border-b border-slate-100 pb-1">Identity & Contact</p>
        <p className="col-span-2 font-headings text-lg font-bold text-headings border-b border-slate-100 pb-1">Financial Profile</p>

        {/* Row 1 */}
        <Field label="Full Name (as per IC)">
          <input type="text" value={formData.fullName} onChange={set('fullName')} className={inputCls} />
        </Field>
        <Field label="IC / Passport Number">
          <input type="text" value={formData.icNumber} disabled className={disabledCls} />
        </Field>
        <Field label="Primary Income Source">
          <input type="text" value={formData.incomeSource} onChange={set('incomeSource')} className={inputCls} />
        </Field>
        <Field label="Est. Annual Income (RM)">
          <input type="text" value={formData.annualIncome} onChange={set('annualIncome')} className={inputCls} />
        </Field>

        {/* Row 2 */}
        <Field label="Email Address">
          <input type="email" value={formData.email} onChange={set('email')} className={inputCls} />
        </Field>
        <Field label="Phone Number">
          <input type="text" value={formData.phone} onChange={set('phone')} className={inputCls} />
        </Field>
        <Field label="EPF / PRS Contributions (RM)">
          <input type="text" value={formData.epfSavings} onChange={set('epfSavings')} className={inputCls} />
        </Field>
        <Field label="Life / Medical Insurance (RM)">
          <input type="text" value={formData.medicalInsurance} onChange={set('medicalInsurance')} className={inputCls} />
        </Field>

        {/* Row 3 */}
        <Field label="Marital Status">
          <select value={formData.maritalStatus} onChange={set('maritalStatus')} className={inputCls}>
            <option>Single</option>
            <option>Married</option>
            <option>Divorced / Widowed</option>
          </select>
        </Field>
        <Field label="Family Dependencies">
          <select value={formData.dependencies} onChange={set('dependencies')} className={inputCls}>
            <option>No Dependencies</option>
            <option>1 Child (Under 18)</option>
            <option>2 Children (Under 18)</option>
            <option>3+ Children (Under 18)</option>
            <option>Disabled Child / Dependents</option>
          </select>
        </Field>
        <Field label="Core Industry Sector">
          <input type="text" value={formData.industry} onChange={set('industry')} className={inputCls} />
        </Field>
        <Field label="Primary Operational Expenses">
          <input type="text" value={formData.businessExpenses} onChange={set('businessExpenses')} className={inputCls} />
        </Field>

      </div>

      {/* Save row */}
      <div className="shrink-0 flex items-center justify-end border-t border-slate-100 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0D9488] text-white px-5 py-2 text-xs font-bold hover:bg-[#0f766e] active:scale-[0.98] transition-all duration-150 disabled:opacity-50 min-w-[140px]"
        >
          <SaveIcon />
          {isSaving ? 'Saving...' : 'Save Personal Profile'}
        </button>
      </div>

    </div>
  );
}