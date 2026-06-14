import React, { useState } from 'react';

// ── Icons ──────────────────────────────────────────────────────────────────
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#0D9488]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function LanguageDisplayTab() {
  // ── States for User Preference Selections ────────────────────────────────
  const [language, setLanguage] = useState('en');
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY');
  const [currency, setCurrency] = useState('MYR');
  const [theme, setTheme] = useState('light');
  const [density, setDensity] = useState('default');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    setIsSaving(true);
    // Simulate API storage roundtrip delay
    setTimeout(() => {
      setIsSaving(false);
      alert('Preferences saved successfully!');
    }, 800);
  };

  return (
    <div className="w-full space-y-6 text-left pb-12">
      
      {/* 1. Language Preference Section */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A]">Language</h2>
          <p className="text-xs text-[#64748B] mt-0.5">Select your preferred display language</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* English Option Card */}
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={`flex items-center justify-between p-4 rounded-xl border text-left transition-all duration-150 ${
              language === 'en'
                ? 'border-[#0D9488] bg-[#f0fdf9]/40 ring-1 ring-[#0D9488]'
                : 'border-slate-100 hover:border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center gap-3 text-sm">
              <span className="text-xs font-semibold text-[#64748B] tracking-wider uppercase bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">MY</span>
              <span className={`font-medium ${language === 'en' ? 'text-[#0F172A]' : 'text-slate-700'}`}>English (Malaysia)</span>
            </div>
            {language === 'en' && <CheckIcon />}
          </button>

          {/* Bahasa Melayu Option Card */}
          <button
            type="button"
            onClick={() => setLanguage('ms')}
            className={`flex items-center justify-between p-4 rounded-xl border text-left transition-all duration-150 ${
              language === 'ms'
                ? 'border-[#0D9488] bg-[#f0fdf9]/40 ring-1 ring-[#0D9488]'
                : 'border-slate-100 hover:border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center gap-3 text-sm">
              <span className="text-xs font-semibold text-[#64748B] tracking-wider uppercase bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">MY</span>
              <span className={`font-medium ${language === 'ms' ? 'text-[#0F172A]' : 'text-slate-700'}`}>Bahasa Melayu</span>
            </div>
            {language === 'ms' && <CheckIcon />}
          </button>
        </div>
      </div>

      {/* 2. Regional Formats Section */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A]">Regional Formats</h2>
          <p className="text-xs text-[#64748B] mt-0.5">Date and currency display preferences</p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          {/* Left Column: Date Formats */}
          <div className="space-y-2.5">
            <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-wider">Date format</label>
            <div className="space-y-2">
              {[
                { id: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2025)' },
                { id: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2025)' },
                { id: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2025-12-31)' }
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => setDateFormat(fmt.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-xs font-medium transition-all duration-150 ${
                    dateFormat === fmt.id
                      ? 'border-[#0D9488] bg-[#f0fdf9]/40 text-[#0F172A] font-semibold'
                      : 'border-slate-100 text-slate-600 hover:border-slate-200 bg-white'
                  }`}
                >
                  <span>{fmt.label}</span>
                  {dateFormat === fmt.id && <CheckIcon />}
                </button>
              ))}
            </div>
          </div>

          {/* Right Column: Currency Formats */}
          <div className="space-y-2.5">
            <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-wider">Currency display</label>
            <div className="space-y-2">
              {[
                { id: 'MYR', label: 'MYR — Malaysian Ringgit (RM)' },
                { id: 'USD', label: 'USD — US Dollar ($)' },
                { id: 'SGD', label: 'SGD — Singapore Dollar (S$)' }
              ].map((cur) => (
                <button
                  key={cur.id}
                  type="button"
                  onClick={() => setCurrency(cur.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-xs font-medium transition-all duration-150 ${
                    currency === cur.id
                      ? 'border-[#0D9488] bg-[#f0fdf9]/40 text-[#0F172A] font-semibold'
                      : 'border-slate-100 text-slate-600 hover:border-slate-200 bg-white'
                  }`}
                >
                  <span>{cur.label}</span>
                  {currency === cur.id && <CheckIcon />}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Theme Display Section */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A]">Theme</h2>
          <p className="text-xs text-[#64748B] mt-0.5">Choose your interface appearance</p>
        </div>

        <div className="grid gap-3 grid-cols-3">
          {/* Light Theme Option */}
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`flex flex-col items-center justify-center p-5 rounded-xl border transition-all duration-150 ${
              theme === 'light' ? 'border-[#0D9488] bg-[#f0fdf9]/40 ring-1 ring-[#0D9488]' : 'border-slate-100 hover:border-slate-200 bg-white'
            }`}
          >
            <div className="w-9 h-6 rounded border border-slate-200 bg-slate-50 flex items-center px-1 mb-2">
              <div className="h-3 w-5 bg-white rounded shadow-sm border border-slate-100" />
            </div>
            <span className="text-xs font-semibold text-[#0F172A] flex items-center gap-1">
              Light {theme === 'light' && '✓'}
            </span>
          </button>

          {/* Dark Theme Option */}
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`flex flex-col items-center justify-center p-5 rounded-xl border transition-all duration-150 ${
              theme === 'dark' ? 'border-[#0D9488] bg-[#f0fdf9]/40 ring-1 ring-[#0D9488]' : 'border-slate-100 hover:border-slate-200 bg-white'
            }`}
          >
            <div className="w-9 h-6 rounded bg-slate-900 flex items-center px-1 mb-2 border border-slate-800">
              <div className="h-3 w-5 bg-slate-800 rounded border border-slate-700" />
            </div>
            <span className="text-xs font-semibold text-[#0F172A]">Dark</span>
          </button>

          {/* System Default Option */}
          <button
            type="button"
            onClick={() => setTheme('system')}
            className={`flex flex-col items-center justify-center p-5 rounded-xl border transition-all duration-150 ${
              theme === 'system' ? 'border-[#0D9488] bg-[#f0fdf9]/40 ring-1 ring-[#0D9488]' : 'border-slate-100 hover:border-slate-200 bg-white'
            }`}
          >
            <div className="w-9 h-6 rounded border border-slate-200 bg-slate-50 overflow-hidden flex mb-2">
              <div className="w-1/2 h-full bg-white" />
              <div className="w-1/2 h-full bg-slate-900" />
            </div>
            <span className="text-xs font-semibold text-[#0F172A]">System</span>
          </button>
        </div>
      </div>

      {/* 4. Layout Density Preferences */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A]">Display Density</h2>
          <p className="text-xs text-[#64748B] mt-0.5">Adjust how compact the interface feels</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {/* Compact Setting */}
          <button
            type="button"
            onClick={() => setDensity('compact')}
            className={`p-4 rounded-xl border text-left transition-all duration-150 block ${
              density === 'compact' ? 'border-[#0D9488] bg-[#f0fdf9]/40 ring-1 ring-[#0D9488]' : 'border-slate-100 hover:border-slate-200 bg-white'
            }`}
          >
            <h4 className="text-xs font-bold text-[#0F172A]">Compact</h4>
            <p className="text-[11px] text-[#64748B] mt-0.5">More content, less whitespace</p>
          </button>

          {/* Default Setting */}
          <button
            type="button"
            onClick={() => setDensity('default')}
            className={`p-4 rounded-xl border text-left transition-all duration-150 block ${
              density === 'default' ? 'border-[#0D9488] bg-[#f0fdf9]/40 ring-1 ring-[#0D9488]' : 'border-slate-100 hover:border-slate-200 bg-white'
            }`}
          >
            <h4 className="text-xs font-bold text-[#0F172A]">Default</h4>
            <p className="text-[11px] text-[#64748B] mt-0.5">Balanced layout</p>
          </button>

          {/* Comfortable Setting */}
          <button
            type="button"
            onClick={() => setDensity('comfortable')}
            className={`p-4 rounded-xl border text-left transition-all duration-150 block ${
              density === 'comfortable' ? 'border-[#0D9488] bg-[#f0fdf9]/40 ring-1 ring-[#0D9488]' : 'border-slate-100 hover:border-slate-200 bg-white'
            }`}
          >
            <h4 className="text-xs font-bold text-[#0F172A]">Comfortable</h4>
            <p className="text-[11px] text-[#64748B] mt-0.5">Spacious, easier to scan</p>
          </button>
        </div>
      </div>

      {/* 5. Custom Bottom Action Bar Banner */}
      <div className="flex items-center justify-end pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center justify-center rounded-xl bg-[#0D9488] text-white px-6 py-2.5 text-xs font-bold hover:bg-[#0f766e] active:scale-[0.98] transition-all duration-150 disabled:opacity-50 min-w-[120px]"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

    </div>
  );
}

export default LanguageDisplayTab