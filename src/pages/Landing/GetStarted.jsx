import { useState } from "react";
import cukaiLogo from '../../assets/cukai-logo.png';

const BrandLogo = () => (
  <span className="flex items-center gap-2.5">
    <img src={cukaiLogo} alt="Cukai.ai logo" className="h-10 w-10 shrink-0" />
    <span className="select-none text-xl font-bold tracking-tight text-[#0F172A]">
      cukai
      <span className="text-[#10B981]">.</span>
      <span className="font-light text-[#64748B]">ai</span>
    </span>
  </span>
);

const STEPS = [
  { id: 0, label: "Account" },
  { id: 1, label: "Employment" },
  { id: 2, label: "Income" },
  { id: 3, label: "Personal & Family" },
  { id: 4, label: "Savings & Insurance" },
  { id: 5, label: "Business Profile" },
];

const ProgressBar = ({ current, total }) => (
  <div className="mb-6">
    <div className="flex justify-between items-center mb-2">
      <span className="text-sm text-[#64748B] font-medium">Step {current} of {total}</span>
      <span className="text-sm font-semibold text-[#0F172A]">{STEPS[current - 1]?.label}</span>
    </div>
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
            i < current ? "bg-[#10B981]" : "bg-[#E2E8F0]"
          }`}
        />
      ))}
    </div>
  </div>
);

const Card = ({ children }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-[#F1F5F9] p-6 md:p-8">
    {children}
  </div>
);

const NavButtons = ({ onBack, onNext, nextLabel = "Next", nextDisabled = false, showBack = true }) => (
  <div className="flex justify-between items-center mt-8 pt-4 border-t border-[#F1F5F9]">
    {showBack ? (
      <button
        onClick={onBack}
        className="text-[#64748B] font-medium text-sm hover:text-[#0F172A] transition-colors px-2 py-1"
      >
        Back
      </button>
    ) : <div />}
    <button
      onClick={onNext}
      disabled={nextDisabled}
      className={`px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
        nextDisabled
          ? "bg-[#D1FAE5] text-[#6EE7B7] cursor-not-allowed"
          : "bg-[#10B981] hover:bg-[#0D9488] text-white shadow-sm hover:shadow-md"
      }`}
    >
      {nextLabel}
    </button>
  </div>
);

const SectionLabel = ({ children }) => (
  <p className="text-[10px] font-bold tracking-widest text-[#94A3B8] uppercase mb-3 mt-5 first:mt-0">{children}</p>
);

const CheckItem = ({ label, sublabel, checked, onChange }) => (
  <label className="flex items-start gap-3 cursor-pointer py-3 group">
    <div
      onClick={onChange}
      className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all duration-150 cursor-pointer ${
        checked ? "bg-[#10B981] border-[#10B981]" : "border-[#CBD5E1] group-hover:border-[#10B981]"
      }`}
    >
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
    <div>
      <span className="text-sm font-medium text-[#0F172A]">{label}</span>
      {sublabel && <p className="text-xs text-[#94A3B8] mt-0.5">{sublabel}</p>}
    </div>
  </label>
);

const Toggle = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between p-4 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]">
    <span className="text-sm font-medium text-[#0F172A]">{label}</span>
    <button
      onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-all duration-200 ${value ? "bg-[#10B981]" : "bg-[#CBD5E1]"}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200 ${
          value ? "left-5.5 translate-x-0.5" : "left-0.5"
        }`}
        style={{ left: value ? "calc(100% - 22px)" : "2px" }}
      />
    </button>
  </div>
);

const InfoIcon = () => (
  <span title="More info" className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-[#CBD5E1] text-[#94A3B8] text-[9px] font-bold ml-1 cursor-help">i</span>
);

// Password strength
const getStrength = (pw) => {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
};
const strengthLabel = ["", "Weak", "Fair", "Good", "Strong"];
const strengthColor = ["", "#EF4444", "#F59E0B", "#3B82F6", "#10B981"];

// ─── STEP COMPONENTS ────────────────────────────────────────────────────────

function Step0_Account({ data, setData, onNext }) {
  const [showPw, setShowPw] = useState(false);
  const strength = getStrength(data.password || "");
  const valid = data.fullName && data.email && (data.password || "").length >= 8;

  return (
    <Card>
      <h2 className="text-xl font-bold text-[#0F172A] mb-1">Create your account</h2>
      <p className="text-sm text-[#64748B] mb-6">Your details are safe with us — 256-bit encrypted.</p>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-wide mb-1.5">Full Name</label>
          <input
            type="text"
            placeholder="e.g. Amirul Hakim"
            value={data.fullName || ""}
            onChange={e => setData({ ...data, fullName: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl border border-[#E2E8F0] text-sm text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#10B981] focus:border-transparent transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-wide mb-1.5">Email Address</label>
          <input
            type="email"
            placeholder="you@example.com"
            value={data.email || ""}
            onChange={e => setData({ ...data, email: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl border border-[#E2E8F0] text-sm text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#10B981] focus:border-transparent transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-wide mb-1.5">Password</label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              placeholder="Min. 8 characters"
              value={data.password || ""}
              onChange={e => setData({ ...data, password: e.target.value })}
              className="w-full px-4 py-2.5 pr-10 rounded-xl border border-[#E2E8F0] text-sm text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#10B981] focus:border-transparent transition"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] text-xs"
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>
          {(data.password || "").length > 0 && (
            <div className="mt-2">
              <div className="flex gap-1 mb-1">
                {[1,2,3,4].map(i => (
                  <div
                    key={i}
                    className="h-1 flex-1 rounded-full transition-all duration-300"
                    style={{ backgroundColor: i <= strength ? strengthColor[strength] : "#E2E8F0" }}
                  />
                ))}
              </div>
              <p className="text-xs" style={{ color: strengthColor[strength] }}>
                {strengthLabel[strength]} password
                {strength < 3 && " — try adding uppercase letters, numbers, or symbols."}
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#64748B] uppercase tracking-wide mb-1.5">Phone Number <span className="normal-case font-normal text-[#94A3B8]">(optional)</span></label>
          <input
            type="tel"
            placeholder="+60 12-345 6789"
            value={data.phone || ""}
            onChange={e => setData({ ...data, phone: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl border border-[#E2E8F0] text-sm text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#10B981] focus:border-transparent transition"
          />
        </div>
      </div>

      <NavButtons showBack={false} onNext={onNext} nextDisabled={!valid} />
    </Card>
  );
}

function Step1_Employment({ data, setData, onBack, onNext }) {
  const options = [
    {
      id: "salaried",
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
          <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
        </svg>
      ),
      label: "Salaried Employee",
      desc: "I receive a salary from an employer",
    },
    {
      id: "self-employed",
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="7" width="20" height="14" rx="2"/>
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          <circle cx="12" cy="14" r="2"/>
        </svg>
      ),
      label: "Self-Employed",
      desc: "I run my own business or freelance",
    },
    {
      id: "both",
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      ),
      label: "Both",
      desc: "I have employment income and a side business",
    },
  ];

  return (
    <Card>
      <h2 className="text-xl font-bold text-[#0F172A] mb-1">How do you earn your income?</h2>
      <p className="text-sm text-[#64748B] mb-6">This helps us calculate the right tax reliefs for you.</p>

      <div className="grid grid-cols-1 gap-3">
        {options.map(opt => (
          <button
            key={opt.id}
            onClick={() => setData({ ...data, employment: opt.id })}
            className={`flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all duration-150 ${
              data.employment === opt.id
                ? "border-[#10B981] bg-[#F0FDF9]"
                : "border-[#E2E8F0] hover:border-[#10B981] hover:bg-[#F8FAFC]"
            }`}
          >
            <div className={`p-2.5 rounded-xl ${data.employment === opt.id ? "bg-[#D1FAE5] text-[#10B981]" : "bg-[#F1F5F9] text-[#64748B]"}`}>
              {opt.icon}
            </div>
            <div>
              <p className="font-semibold text-[#0F172A] text-sm">{opt.label}</p>
              <p className="text-xs text-[#64748B] mt-0.5">{opt.desc}</p>
            </div>
          </button>
        ))}
      </div>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!data.employment} />
    </Card>
  );
}

function Step2_Income({ data, setData, onBack, onNext }) {
  const [mode, setMode] = useState("monthly");
  const isSelf = data.employment === "self-employed" || data.employment === "both";
  const isSalaried = data.employment === "salaried" || data.employment === "both";

  const fmt = (val) => {
    const n = parseFloat(val);
    return isNaN(n) ? "" : n.toFixed(2);
  };

  return (
    <Card>
      <h2 className="text-xl font-bold text-[#0F172A] mb-1">
        {isSelf && !isSalaried ? "What's your business income?" : "What's your income?"}
      </h2>
      <p className="text-sm text-[#64748B] mb-5">Enter your gross income before deductions.</p>

      <div className="flex bg-[#F1F5F9] rounded-xl p-1 mb-5 w-fit">
        {["monthly", "annual"].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 capitalize ${
              mode === m ? "bg-white text-[#0F172A] shadow-sm" : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {isSalaried && (
          <div>
            <label className="block text-xs font-bold tracking-widest text-[#94A3B8] uppercase mb-1.5">
              {mode === "monthly" ? "Monthly" : "Annual"} Employment Income
            </label>
            <div className="flex items-center border border-[#E2E8F0] rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-[#10B981]">
              <span className="px-4 py-2.5 text-sm font-semibold text-[#64748B] bg-[#F8FAFC] border-r border-[#E2E8F0]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={data.employmentIncome || ""}
                onChange={e => setData({ ...data, employmentIncome: e.target.value })}
                className="flex-1 px-4 py-2.5 text-sm text-[#0F172A] focus:outline-none"
              />
            </div>
          </div>
        )}
        {isSelf && (
          <div>
            <label className="block text-xs font-bold tracking-widest text-[#94A3B8] uppercase mb-1.5">
              {mode === "monthly" ? "Monthly" : "Annual"} Business / Freelance Income
            </label>
            <div className="flex items-center border border-[#E2E8F0] rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-[#10B981]">
              <span className="px-4 py-2.5 text-sm font-semibold text-[#64748B] bg-[#F8FAFC] border-r border-[#E2E8F0]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={data.businessIncome || ""}
                onChange={e => setData({ ...data, businessIncome: e.target.value })}
                className="flex-1 px-4 py-2.5 text-sm text-[#0F172A] focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      <NavButtons onBack={onBack} onNext={onNext} />
    </Card>
  );
}

function Step3_Personal({ data, setData, onBack, onNext }) {
  return (
    <Card>
      <h2 className="text-xl font-bold text-[#0F172A] mb-1">Personal & Family</h2>
      <p className="text-sm text-[#64748B] mb-6">Marital status, children, and dependents for tax relief.</p>

      <div className="space-y-5">
        <div>
          <SectionLabel>Marital Status</SectionLabel>
          <select
            value={data.marital || ""}
            onChange={e => setData({ ...data, marital: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl border border-[#E2E8F0] text-sm text-[#0F172A] bg-white focus:outline-none focus:ring-2 focus:ring-[#10B981] appearance-none"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2364748B' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 16px center" }}
          >
            <option value="">Select status</option>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="divorced">Divorced / Widowed</option>
          </select>
        </div>

        <div className="border-t border-[#F1F5F9] pt-4">
          <CheckItem
            label="I have a disability"
            sublabel="OKU card holder (up to RM6,000 additional relief)"
            checked={!!data.hasDisability}
            onChange={() => setData({ ...data, hasDisability: !data.hasDisability })}
          />
        </div>

        <div className="border-t border-[#F1F5F9] pt-4">
          <Toggle
            label="Do you have children?"
            value={!!data.hasChildren}
            onChange={v => setData({ ...data, hasChildren: v })}
          />
          {data.hasChildren && (
            <div className="mt-3">
              <label className="block text-xs font-bold tracking-widest text-[#94A3B8] uppercase mb-1.5">Number of Children</label>
              <input
                type="number"
                min="1"
                max="20"
                placeholder="e.g. 2"
                value={data.numChildren || ""}
                onChange={e => setData({ ...data, numChildren: e.target.value })}
                className="w-32 px-4 py-2.5 rounded-xl border border-[#E2E8F0] text-sm focus:outline-none focus:ring-2 focus:ring-[#10B981]"
              />
              <CheckItem
                label="Child(ren) with disability"
                checked={!!data.childDisability}
                onChange={() => setData({ ...data, childDisability: !data.childDisability })}
              />
            </div>
          )}
        </div>

        <div className="border-t border-[#F1F5F9] pt-4">
          <CheckItem
            label="Supporting parents or grandparents"
            sublabel="Medical expenses, special needs, or examination costs"
            checked={!!data.supportParents}
            onChange={() => setData({ ...data, supportParents: !data.supportParents })}
          />
        </div>
      </div>

      <NavButtons onBack={onBack} onNext={onNext} />
    </Card>
  );
}

function Step4_Savings({ data, setData, onBack, onNext }) {
  const toggle = (key) => setData({ ...data, [key]: !data[key] });

  return (
    <Card>
      <h2 className="text-xl font-bold text-[#0F172A] mb-1">Savings & Insurance</h2>
      <p className="text-sm text-[#64748B] mb-5">Select the savings and insurance contributions you have.</p>

      <div className="divide-y divide-[#F1F5F9]">
        <div className="pb-4">
          <SectionLabel>Retirement Savings</SectionLabel>
          <CheckItem label={<span>Voluntary EPF contributions <InfoIcon /></span>} checked={!!data.epf} onChange={() => toggle("epf")} />
          <CheckItem label="Private Retirement Scheme (PRS)" checked={!!data.prs} onChange={() => toggle("prs")} />
          <CheckItem label="Deferred annuity premiums" checked={!!data.annuity} onChange={() => toggle("annuity")} />
        </div>
        <div className="py-4">
          <SectionLabel>Insurance</SectionLabel>
          <CheckItem label="Life insurance & takaful premiums" checked={!!data.lifeInsurance} onChange={() => toggle("lifeInsurance")} />
          <CheckItem label="Education & medical insurance" checked={!!data.medInsurance} onChange={() => toggle("medInsurance")} />
        </div>
        <div className="pt-4">
          <SectionLabel>Education Savings</SectionLabel>
          <CheckItem label="SSPN education savings" sublabel="National Education Savings Scheme" checked={!!data.sspn} onChange={() => toggle("sspn")} />
        </div>
      </div>

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Complete" />
    </Card>
  );
}

function Step5_BusinessProfile({ data, setData, onBack, onNext }) {
  // Extra step specifically valuable for solopreneurs
  const industries = [
    "Consulting / Advisory", "Freelance Creative (Design, Writing, Video)",
    "Tech / Software", "E-commerce / Retail", "Food & Beverage",
    "Education / Coaching", "Healthcare / Wellness", "Finance / Accounting",
    "Marketing / Agency", "Other",
  ];

  return (
    <Card>
      <h2 className="text-xl font-bold text-[#0F172A] mb-1">Your Business Profile</h2>
      <p className="text-sm text-[#64748B] mb-5">Help us tailor tax reliefs specific to your solopreneur situation.</p>

      <div className="space-y-5">
        <div>
          <SectionLabel>Industry / Business Type</SectionLabel>
          <select
            value={data.industry || ""}
            onChange={e => setData({ ...data, industry: e.target.value })}
            className="w-full px-4 py-2.5 rounded-xl border border-[#E2E8F0] text-sm text-[#0F172A] bg-white focus:outline-none focus:ring-2 focus:ring-[#10B981] appearance-none"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2364748B' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 16px center" }}
          >
            <option value="">Select your industry</option>
            {industries.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>

        <div className="border-t border-[#F1F5F9] pt-4">
          <SectionLabel>Business Registration</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            {["Sole Proprietor (SSM)", "Freelancer (unregistered)", "Sdn. Bhd.", "Not sure yet"].map(opt => (
              <button
                key={opt}
                onClick={() => setData({ ...data, bizReg: opt })}
                className={`px-3 py-2.5 rounded-xl border-2 text-xs font-medium text-left transition-all duration-150 ${
                  data.bizReg === opt
                    ? "border-[#10B981] bg-[#F0FDF9] text-[#0D9488]"
                    : "border-[#E2E8F0] text-[#64748B] hover:border-[#10B981]"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-[#F1F5F9] pt-4">
          <SectionLabel>Business Expenses You Track</SectionLabel>
          <p className="text-xs text-[#94A3B8] mb-2">We'll suggest matching reliefs for these.</p>
          {[
            ["homeOffice", "Home office / co-working space"],
            ["equipment", "Laptop, phone & equipment"],
            ["software", "Software & subscriptions"],
            ["marketing", "Marketing & advertising"],
            ["training", "Courses & professional development"],
          ].map(([key, label]) => (
            <CheckItem
              key={key}
              label={label}
              checked={!!data[key]}
              onChange={() => setData({ ...data, [key]: !data[key] })}
            />
          ))}
        </div>

        <div className="border-t border-[#F1F5F9] pt-4">
          <Toggle
            label="Registered for SST / GST?"
            value={!!data.sst}
            onChange={v => setData({ ...data, sst: v })}
          />
        </div>
      </div>

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="See My Savings →" />
    </Card>
  );
}

function StepUpload({ onBack, onNext }) {
  const [dragging, setDragging] = useState(false);
  const categories = [
    "Medical bills & prescriptions",
    "Books, courses & education fees",
    "Internet & phone bills",
    "Insurance premiums (life, medical)",
    "Gym memberships & sports equipment",
  ];

  return (
    <Card>
      <div className="text-center mb-6">
        <div className="flex justify-center gap-6 mb-5">
          {[
            { icon: "⚡", label: "Auto-scanned" },
            { icon: "✦", label: "AI categorized" },
            { icon: "🛡", label: "Tax relief matched" },
          ].map(({ icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-2">
              <div className="w-11 h-11 rounded-full bg-[#D1FAE5] flex items-center justify-center text-[#10B981] text-lg">
                {icon}
              </div>
              <span className="text-xs text-[#64748B]">{label}</span>
            </div>
          ))}
        </div>
        <h2 className="text-lg font-bold text-[#0F172A]">Upload your first receipt</h2>
        <p className="text-sm text-[#64748B] mt-1">Try it out — snap a photo or upload any receipt from 2025</p>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); }}
        className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-150 cursor-pointer ${
          dragging ? "border-[#10B981] bg-[#F0FDF9]" : "border-[#CBD5E1] hover:border-[#10B981] bg-[#F8FAFC]"
        }`}
      >
        <div className="w-12 h-12 rounded-full border border-[#E2E8F0] flex items-center justify-center mx-auto mb-3 bg-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <p className="text-sm font-semibold text-[#0F172A]">Drag and drop your files here</p>
        <p className="text-sm text-[#64748B]">or <span className="text-[#10B981] font-medium cursor-pointer hover:underline">click to browse</span></p>
        <p className="text-xs text-[#94A3B8] mt-2">Supports PDF, JPG, PNG, HEIC up to 50MB</p>
      </div>

      <div className="mt-5">
        <p className="text-[10px] font-bold tracking-widest text-[#94A3B8] uppercase mb-2">What you can upload</p>
        <div className="flex flex-wrap gap-2">
          {categories.map(c => (
            <span key={c} className="text-xs px-3 py-1.5 rounded-full bg-[#F1F5F9] text-[#475569] font-medium">{c}</span>
          ))}
        </div>
      </div>

      <div className="mt-6 flex justify-center">
        <button onClick={onNext} className="text-sm text-[#94A3B8] hover:text-[#64748B] transition-colors">
          Skip for now
        </button>
      </div>
    </Card>
  );
}

function StepSavings({ data, onNext }) {
  // Rough estimate from profile
  const base = 660;
  const extra = (data.epf ? 150 : 0) + (data.prs ? 100 : 0) + (data.lifeInsurance ? 80 : 0)
    + (data.medInsurance ? 60 : 0) + (data.sspn ? 40 : 0) + (data.hasChildren ? 120 : 0)
    + (data.homeOffice ? 50 : 0) + (data.equipment ? 70 : 0) + (data.training ? 90 : 0);
  const total = base + extra;

  return (
    <Card>
      <div className="text-center py-6">
        <p className="text-sm font-semibold text-[#10B981] mb-2">Your estimated tax savings</p>
        <p className="text-5xl font-extrabold text-[#0F172A] mb-4 tracking-tight">RM {total.toLocaleString()}</p>
        <p className="text-sm text-[#64748B] max-w-xs mx-auto leading-relaxed">
          Based on your profile, you could save up to this amount in tax reliefs. Upload receipts to get a more accurate figure.
        </p>
        <p className="text-xs text-[#94A3B8] mt-4">This is an estimate based on your profile. Actual amounts may vary.</p>
      </div>
      <button
        onClick={onNext}
        className="w-full mt-4 py-4 bg-[#10B981] hover:bg-[#0D9488] text-white font-semibold rounded-xl text-sm transition-all duration-200 shadow-sm hover:shadow-md flex items-center justify-center gap-2"
      >
        Let's start claiming your savings <span>→</span>
      </button>
    </Card>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function GetStarted() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({});

  // Step indices:
  // 0 = Account, 1 = Employment, 2 = Income, 3 = Personal, 4 = Savings/Insurance
  // 5 = Business Profile (only if self-employed), 6 = Upload Receipt, 7 = Summary

  const showBizProfile = data.employment === "self-employed" || data.employment === "both";

  const getMaxSteps = () => showBizProfile ? 6 : 5;
  const progressStep = step + 1;
  const totalProgressSteps = getMaxSteps();

  const WIZARD_STEPS = [
    // step 0 — Account (no progress bar)
    (
      <Step0_Account
        data={data}
        setData={setData}
        onNext={() => setStep(1)}
      />
    ),
    // step 1 — Employment
    (
      <>
        <ProgressBar current={1} total={totalProgressSteps} />
        <Step1_Employment data={data} setData={setData} onBack={() => setStep(0)} onNext={() => setStep(2)} />
      </>
    ),
    // step 2 — Income
    (
      <>
        <ProgressBar current={2} total={totalProgressSteps} />
        <Step2_Income data={data} setData={setData} onBack={() => setStep(1)} onNext={() => setStep(3)} />
      </>
    ),
    // step 3 — Personal & Family
    (
      <>
        <ProgressBar current={3} total={totalProgressSteps} />
        <Step3_Personal data={data} setData={setData} onBack={() => setStep(2)} onNext={() => setStep(4)} />
      </>
    ),
    // step 4 — Savings & Insurance
    (
      <>
        <ProgressBar current={4} total={totalProgressSteps} />
        <Step4_Savings
          data={data}
          setData={setData}
          onBack={() => setStep(3)}
          onNext={() => showBizProfile ? setStep(5) : setStep(6)}
        />
      </>
    ),
  ];

  if (showBizProfile) {
    WIZARD_STEPS.push(
      // step 5 — Business Profile
      (
        <>
          <ProgressBar current={5} total={totalProgressSteps} />
          <Step5_BusinessProfile data={data} setData={setData} onBack={() => setStep(4)} onNext={() => setStep(6)} />
        </>
      )
    );
  }

  WIZARD_STEPS.push(
    // step 6 — Upload Receipt
    <StepUpload onBack={() => setStep(showBizProfile ? 5 : 4)} onNext={() => setStep(WIZARD_STEPS.length)} />,
    // step 7 — Savings Summary
    <StepSavings data={data} onNext={() => alert("Navigating to dashboard...")} />
  );

  const currentView = WIZARD_STEPS[step];

  return (
    <div className="min-h-screen bg-[#F1F5F9] px-4 py-8 font-sans">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <BrandLogo />
        </div>

        {/* Page title (shown for steps 1+) */}
        {step > 0 && step < WIZARD_STEPS.length - 1 && (
          <div className="mb-5">
            <h1 className="text-2xl font-bold text-[#0F172A]">Let's get you set up</h1>
            <p className="text-sm text-[#64748B]">We'll help you maximise your tax savings for 2025</p>
          </div>
        )}

        {/* Wizard step content */}
        <div className="transition-all duration-300">
          {currentView}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-[#94A3B8] mt-6">
          🔒 Your data is encrypted and never shared with third parties.
        </p>
      </div>
    </div>
  );
}