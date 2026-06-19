import React, { useState } from 'react';

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-[#0D9488]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const selBase = "flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium transition-all duration-150 w-full";
const selActive = "border-[#0D9488] bg-[#f0fdf9]/40 text-[#0F172A] font-semibold";
const selInactive = "border-slate-100 text-slate-600 hover:border-slate-200 bg-white";

const CardHeading = ({ title }) => (
  <p className="text-xs font-bold text-[#0F172A] border-b border-slate-100 pb-2 shrink-0">{title}</p>
);

function LanguageDisplayTab() {
  const [language, setLanguage]   = useState('en');
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const [currency, setCurrency]   = useState('MYR');
  const [theme, setTheme]         = useState('light');
  const [density, setDensity]     = useState('default');
  const [isSaving, setIsSaving]   = useState(false);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => { setIsSaving(false); alert('Preferences saved successfully!'); }, 800);
  };

  return (
    <div className="h-full flex flex-col gap-2">

      {/* 2-column, 2-row grid */}
      <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-3">

        {/* Row 1 Col 1 — Language */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-col gap-2">
          <CardHeading title="Language" />
          <div className="flex-1 flex flex-col gap-2">
            {[
              { id: 'en', label: 'English (Malaysia)' },
              { id: 'ms', label: 'Bahasa Melayu' },
            ].map(({ id, label }) => (
              <button key={id} type="button" onClick={() => setLanguage(id)}
                className={`${selBase} flex-1 ${language === id ? selActive : selInactive}`}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-[#64748B] uppercase bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">MY</span>
                  <span>{label}</span>
                </div>
                {language === id && <CheckIcon />}
              </button>
            ))}
          </div>
        </div>

        {/* Row 1 Col 2 — Date Format */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-col gap-2">
          <CardHeading title="Date Format" />
          <div className="flex-1 flex flex-col gap-2">
            {[
              { id: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2025)' },
              { id: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2025)' },
              { id: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2025-12-31)' },
            ].map(({ id, label }) => (
              <button key={id} type="button" onClick={() => setDateFormat(id)}
                className={`${selBase} flex-1 ${dateFormat === id ? selActive : selInactive}`}>
                <span>{label}</span>
                {dateFormat === id && <CheckIcon />}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2 Col 1 — Currency */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-col gap-2">
          <CardHeading title="Currency" />
          <div className="flex-1 flex flex-col gap-2">
            {[
              { id: 'MYR', label: 'MYR — Malaysian Ringgit (RM)' },
              { id: 'USD', label: 'USD — US Dollar ($)' },
              { id: 'SGD', label: 'SGD — Singapore Dollar (S$)' },
            ].map(({ id, label }) => (
              <button key={id} type="button" onClick={() => setCurrency(id)}
                className={`${selBase} flex-1 ${currency === id ? selActive : selInactive}`}>
                <span>{label}</span>
                {currency === id && <CheckIcon />}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2 Col 2 — Theme + Density side by side */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-col gap-2">
          {/* Split header row — each title sits above its column */}
          <div className="grid grid-cols-2 gap-3 shrink-0">
            <p className="text-xs font-bold text-[#0F172A] border-b border-slate-100 pb-2">Theme</p>
            <p className="text-xs font-bold text-[#0F172A] border-b border-slate-100 pb-2">Display Density</p>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-2 gap-3">

            {/* Theme */}
            <div className="min-h-0 flex flex-col gap-1.5">
              {[
                { id: 'light',  label: 'Light',  preview: <div className="w-7 h-4 rounded border border-slate-200 bg-slate-50 flex items-center px-1"><div className="h-2 w-3.5 bg-white rounded shadow-sm border border-slate-100" /></div> },
                { id: 'dark',   label: 'Dark',   preview: <div className="w-7 h-4 rounded bg-slate-900 flex items-center px-1 border border-slate-800"><div className="h-2 w-3.5 bg-slate-800 rounded border border-slate-700" /></div> },
                { id: 'system', label: 'System', preview: <div className="w-7 h-4 rounded border border-slate-200 bg-slate-50 overflow-hidden flex"><div className="w-1/2 h-full bg-white" /><div className="w-1/2 h-full bg-slate-900" /></div> },
              ].map(({ id, label, preview }) => (
                <button key={id} type="button" onClick={() => setTheme(id)}
                  className={`flex-1 flex items-center gap-2.5 px-3 py-1.5 rounded-lg border text-left transition-all duration-150 ${theme === id ? 'border-[#0D9488] bg-[#f0fdf9]/40 ring-1 ring-[#0D9488]' : 'border-slate-100 hover:border-slate-200 bg-white'}`}>
                  {preview}
                  <span className="text-xs font-semibold text-[#0F172A]">{label}{theme === id ? ' ✓' : ''}</span>
                </button>
              ))}
            </div>

            {/* Density */}
            <div className="min-h-0 flex flex-col gap-1.5">
              {[
                { id: 'compact',     label: 'Compact',     desc: 'More content, less whitespace' },
                { id: 'default',     label: 'Default',     desc: 'Balanced layout' },
                { id: 'comfortable', label: 'Comfortable', desc: 'Spacious, easier to scan' },
              ].map(({ id, label, desc }) => (
                <button key={id} type="button" onClick={() => setDensity(id)}
                  className={`flex-1 px-3 py-1.5 rounded-lg border text-left transition-all duration-150 ${density === id ? 'border-[#0D9488] bg-[#f0fdf9]/40 ring-1 ring-[#0D9488]' : 'border-slate-100 hover:border-slate-200 bg-white'}`}>
                  <h4 className="text-[11px] font-bold text-[#0F172A]">{label}</h4>
                  <p className="text-[10px] text-[#64748B]">{desc}</p>
                </button>
              ))}
            </div>

          </div>
        </div>

      </div>

      {/* Save row */}
      <div className="shrink-0 flex items-center justify-end border-t border-slate-100 pt-2">
        <button type="button" onClick={handleSave} disabled={isSaving}
          className="inline-flex items-center justify-center rounded-lg bg-[#0D9488] text-white px-5 py-2 text-xs font-bold hover:bg-[#0f766e] active:scale-[0.98] transition-all duration-150 disabled:opacity-50 min-w-[120px]">
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

    </div>
  );
}

export default LanguageDisplayTab;