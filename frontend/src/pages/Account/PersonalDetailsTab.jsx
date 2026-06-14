import React, { useState } from 'react';

// Icons
const SaveIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
  </svg>
);

export default function PersonalDetailsTab() {
  // Form State Management for Live Demo
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

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      alert('Personal and Tax Profiles updated successfully!');
    }, 800);
  };

  return (
    <div className="w-full space-y-6 text-left pb-12">
      
      {/* SECTION 1: Identity & Contact Details */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A]">Personal Identity</h2>
          <p className="text-xs text-[#64748B] mt-0.5">Your official legal and contact information for filing purposes.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Full Name (as per IC)</label>
            <input 
              type="text" 
              value={formData.fullName}
              onChange={(e) => setFormData({...formData, fullName: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-[#0D9488] transition-colors"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">IC / Passport Number</label>
            <input 
              type="text" 
              value={formData.icNumber}
              disabled
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-100 bg-slate-50 text-slate-500 cursor-not-allowed"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Email Address</label>
            <input 
              type="email" 
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-[#0D9488] transition-colors"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Phone Number</label>
            <input 
              type="text" 
              value={formData.phone}
              onChange={(e) => setFormData({...formData, phone: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-[#0D9488] transition-colors"
            />
          </div>
        </div>
      </div>

      {/* SECTION 2: Marital Status & Family Dependencies (Crucial for Tax Reliefs) */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A]">Family & Dependencies</h2>
          <p className="text-xs text-[#64748B] mt-0.5">Used to dynamically calculate your LHDN marital and child relief thresholds.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Marital Status</label>
            <select 
              value={formData.maritalStatus}
              onChange={(e) => setFormData({...formData, maritalStatus: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-[#0D9488] bg-white transition-colors"
            >
              <option>Single</option>
              <option>Married</option>
              <option>Divorced / Widowed</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Family Dependencies</label>
            <select 
              value={formData.dependencies}
              onChange={(e) => setFormData({...formData, dependencies: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-[#0D9488] bg-white transition-colors"
            >
              <option>No Dependencies</option>
              <option>1 Child (Under 18)</option>
              <option>2 Children (Under 18)</option>
              <option>3+ Children (Under 18)</option>
              <option>Disabled Child / Dependents</option>
            </select>
          </div>
        </div>
      </div>

      {/* SECTION 3: Income, Savings & Financial Protections */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A]">Financial Profile</h2>
          <p className="text-xs text-[#64748B] mt-0.5">Your income baselines and deductibles for insurance/savings declarations.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Primary Income Source</label>
            <input 
              type="text" 
              value={formData.incomeSource}
              onChange={(e) => setFormData({...formData, incomeSource: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-[#0D9488] transition-colors"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Est. Annual Value (RM)</label>
            <input 
              type="text" 
              value={formData.annualIncome}
              onChange={(e) => setFormData({...formData, annualIncome: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-[#0D9488] transition-colors"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Annual EPF/PRS Voluntary Contributions (RM)</label>
            <input 
              type="text" 
              value={formData.epfSavings}
              onChange={(e) => setFormData({...formData, epfSavings: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-[#0D9488] transition-colors"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Life/Medical Insurance Premium (RM)</label>
            <input 
              type="text" 
              value={formData.medicalInsurance}
              onChange={(e) => setFormData({...formData, medicalInsurance: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-[#0D9488] transition-colors"
            />
          </div>
        </div>
      </div>

      {/* SECTION 4: Corporate & Business Operational Profile */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A]">Business Operations Profile</h2>
          <p className="text-xs text-[#64748B] mt-0.5">Operational classifications to map standard corporate tax deductions.</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Core Industry Sector</label>
            <input 
              type="text" 
              value={formData.industry}
              onChange={(e) => setFormData({...formData, industry: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-[#0D9488] transition-colors"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Primary Operational Expense Categories</label>
            <textarea 
              rows="2"
              value={formData.businessExpenses}
              onChange={(e) => setFormData({...formData, businessExpenses: e.target.value})}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-[#0D9488] transition-colors resize-none"
            />
          </div>
        </div>
      </div>

      {/* Action Submit Row */}
      <div className="flex items-center justify-end pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0D9488] text-white px-6 py-2.5 text-xs font-bold hover:bg-[#0f766e] active:scale-[0.98] transition-all duration-150 disabled:opacity-50 min-w-[140px]"
        >
          <SaveIcon />
          {isSaving ? 'Saving Profile...' : 'Save Personal Profile'}
        </button>
      </div>

    </div>
  );
}