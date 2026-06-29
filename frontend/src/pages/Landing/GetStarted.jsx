import { useState } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import cukaiLogo from '../../assets/cukai-logo.png';
import { registerUser, getEntityBySsm, linkPersonToEntity } from "../../services/api";

// ── Shared UI primitives ────────────────────────────────────────────────────────

const ProgressBar = ({ current, total, steps }) => (
  <div className="mb-3">
    <div className="flex justify-between items-center mb-1.5">
      <span className="text-xs text-[#64748B] font-medium">Step {current + 1} of {total}</span>
      <span className="text-xs font-semibold text-[#0F172A]">{steps[current]?.label}</span>
    </div>
    <div className="flex gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full transition-all duration-500 ${
            i <= current ? "bg-[#10B981]" : "bg-[#E2E8F0]"
          }`}
        />
      ))}
    </div>
  </div>
);

const Card = ({ children }) => (
  <div>
    {children}
  </div>
);

const NavButtons = ({ onBack, onNext, nextLabel = "Next", nextDisabled = false, showBack = true }) => (
  <div className="flex justify-between items-center mt-4 pt-3 border-t border-[#F1F5F9]">
    {showBack ? (
      <button onClick={onBack} className="text-[#64748B] font-medium text-xs hover:text-[#0F172A] transition-colors px-2 py-1">
        Back
      </button>
    ) : <div />}
    <button
      onClick={onNext}
      disabled={nextDisabled}
      className={`px-5 py-2 rounded-xl font-semibold text-xs transition-all duration-200 ${
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
  <p className="text-[9px] font-bold tracking-widest text-[#94A3B8] uppercase mb-2 mt-3 first:mt-0">{children}</p>
);

const CheckItem = ({ label, sublabel, checked, onChange }) => (
  <label
    onClick={(e) => { e.preventDefault(); onChange(); }}
    className="flex items-start gap-3 cursor-pointer py-1.5 group select-none"
  >
    <div
      className={`mt-0.5 w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all duration-150 ${
        checked ? "bg-[#10B981] border-[#10B981]" : "border-[#CBD5E1] group-hover:border-[#10B981]"
      }`}
    >
      {checked && (
        <svg width="8" height="7" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
    <div>
      <span className="text-xs font-medium text-[#0F172A]">{label}</span>
      {sublabel && <p className="text-[10px] text-[#94A3B8] mt-0.5">{sublabel}</p>}
    </div>
  </label>
);

const Toggle = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between p-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]">
    <span className="text-xs font-medium text-[#0F172A]">{label}</span>
    <button
      onClick={() => onChange(!value)}
      className={`relative w-9 h-5 rounded-full transition-all duration-200 ${value ? "bg-[#10B981]" : "bg-[#CBD5E1]"}`}
    >
      <span
        className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
        style={{ left: value ? "calc(100% - 18px)" : "2px" }}
      />
    </button>
  </div>
);

const InfoIcon = () => (
  <span title="More info" className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-[#CBD5E1] text-[#94A3B8] text-[9px] font-bold ml-1 cursor-help">i</span>
);

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

// ── Step components ─────────────────────────────────────────────────────────────

function Step0_Account({ data, setData, onNext }) {
  const [showPw, setShowPw] = useState(false);
  const strength = getStrength(data.password || "");
  const valid = data.fullName && data.email && (data.password || "").length >= 8;

  return (
    <Card>
      <h2 className="text-base font-bold text-[#0F172A] mb-0.5">Create your account</h2>
      <p className="text-xs text-[#64748B] mb-3">Your details are safe with us — 256-bit encrypted.</p>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-semibold text-[#64748B] uppercase tracking-wide mb-1">Full Name</label>
          <input
            type="text"
            placeholder="e.g. Amirul Hakim"
            value={data.fullName || ""}
            onChange={e => setData({ ...data, fullName: e.target.value })}
            className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#10B981] focus:border-transparent transition"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-[#64748B] uppercase tracking-wide mb-1">Email Address</label>
          <input
            type="email"
            placeholder="you@example.com"
            value={data.email || ""}
            onChange={e => setData({ ...data, email: e.target.value })}
            className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#10B981] focus:border-transparent transition"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-[#64748B] uppercase tracking-wide mb-1">Password</label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              placeholder="Min. 8 characters"
              value={data.password || ""}
              onChange={e => setData({ ...data, password: e.target.value })}
              className="w-full px-3 py-2 pr-10 rounded-xl border border-[#E2E8F0] text-xs text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#10B981] focus:border-transparent transition"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] text-[10px]"
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>
          {(data.password || "").length > 0 && (
            <div className="mt-1.5">
              <div className="flex gap-1 mb-1">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-1 flex-1 rounded-full transition-all duration-300"
                    style={{ backgroundColor: i <= strength ? strengthColor[strength] : "#E2E8F0" }} />
                ))}
              </div>
              <p className="text-[10px]" style={{ color: strengthColor[strength] }}>
                {strengthLabel[strength]} password
                {strength < 3 && " — try adding uppercase letters, numbers, or symbols."}
              </p>
            </div>
          )}
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-[#64748B] uppercase tracking-wide mb-1">
            Phone Number <span className="normal-case font-normal text-[#94A3B8]">(optional)</span>
          </label>
          <input
            type="tel"
            placeholder="+60 12-345 6789"
            value={data.phone || ""}
            onChange={e => setData({ ...data, phone: e.target.value })}
            className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#10B981] focus:border-transparent transition"
          />
        </div>
      </div>

      <NavButtons showBack={false} onNext={onNext} nextDisabled={!valid} />

      {/* Log in link — shown only when showBack is false (first step) */}
      <p className="mt-3 text-center text-[11px] text-[#94A3B8]">
        Already have an account?{" "}
        <NavLink
          to="/login"
          className="text-[#94A3B8] underline underline-offset-2 hover:text-[#64748B] transition-colors"
        >
          Log in
        </NavLink>
      </p>
    </Card>
  );
}

function Step1_Employment({ data, setData, onBack, onNext }) {
  const options = [
    {
      id: "new",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
          <line x1="9" y1="12" x2="9" y2="12.5"/><line x1="9" y1="15" x2="9" y2="15.5"/>
          <line x1="13" y1="15" x2="13" y2="15.5"/><line x1="13" y1="18" x2="13" y2="18.5"/>
        </svg>
      ),
      label: "New Company Cukai Account",
      desc: "Register your company with Cukai for the first time. We'll help you set up your tax profile from scratch.",
    },
    {
      id: "existing",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="7" width="20" height="14" rx="2"/>
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
          <path d="M9 12l2 2 4-4"/>
        </svg>
      ),
      label: "Existing Company Cukai Account",
      desc: "Your company is already registered with SSM. Link your existing company to access and manage its tax records.",
    },
  ];

  return (
    <Card>
      <h2 className="text-base font-bold text-[#0F172A] mb-0.5">Set up your company account</h2>
      <p className="text-xs text-[#64748B] mb-3">Choose how you'd like to get started with Cukai.ai.</p>

      <div className="grid grid-cols-1 gap-2">
        {options.map(opt => (
          <button
            key={opt.id}
            onClick={() => setData({ ...data, accountType: opt.id })}
            className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all duration-150 ${
              data.accountType === opt.id
                ? "border-[#10B981] bg-[#F0FDF9]"
                : "border-[#E2E8F0] hover:border-[#10B981] hover:bg-[#F8FAFC]"
            }`}
          >
            <div className={`p-2 rounded-xl flex-shrink-0 mt-0.5 ${data.accountType === opt.id ? "bg-[#D1FAE5] text-[#10B981]" : "bg-[#F1F5F9] text-[#64748B]"}`}>
              {opt.icon}
            </div>
            <div>
              <p className="font-semibold text-[#0F172A] text-xs">{opt.label}</p>
              <p className="text-[10px] text-[#64748B] mt-0.5 leading-relaxed">{opt.desc}</p>
            </div>
          </button>
        ))}
      </div>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!data.accountType} />
    </Card>
  );
}

function Step2_Income({ data, setData, onBack, onNext }) {
  const [mode, setMode] = useState("monthly");

  return (
    <Card>
      <h2 className="text-base font-bold text-[#0F172A] mb-0.5">What's your business income?</h2>
      <p className="text-xs text-[#64748B] mb-3">Enter your gross income before deductions.</p>

      <div className="flex bg-[#F1F5F9] rounded-xl p-1 mb-3 w-fit">
        {["monthly", "annual"].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1 rounded-lg text-xs font-medium transition-all duration-150 capitalize ${
              mode === m ? "bg-white text-[#0F172A] shadow-sm" : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <div>
        <label className="block text-[9px] font-bold tracking-widest text-[#94A3B8] uppercase mb-1">
          {mode === "monthly" ? "Monthly" : "Annual"} Business Income
        </label>
        <div className="flex items-center border border-[#E2E8F0] rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-[#10B981]">
          <span className="px-3 py-2 text-xs font-semibold text-[#64748B] bg-[#F8FAFC] border-r border-[#E2E8F0]">RM</span>
          <input
            type="number" min="0" step="0.01" placeholder="0.00"
            value={data.businessIncome || ""}
            onChange={e => setData({ ...data, businessIncome: e.target.value })}
            className="flex-1 px-3 py-2 text-xs text-[#0F172A] focus:outline-none"
          />
        </div>
      </div>

      <NavButtons onBack={onBack} onNext={onNext} />
    </Card>
  );
}

function Step3_Personal({ data, setData, onBack, onNext }) {
  return (
    <Card>
      <h2 className="text-base font-bold text-[#0F172A] mb-0.5">Personal & Family</h2>
      <p className="text-xs text-[#64748B] mb-3">Marital status, children, and dependents for tax relief.</p>

      <div className="space-y-3">
        <div>
          <SectionLabel>Marital Status</SectionLabel>
          <select
            value={data.marital || ""}
            onChange={e => setData({ ...data, marital: e.target.value })}
            className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs text-[#0F172A] bg-white focus:outline-none focus:ring-2 focus:ring-[#10B981] appearance-none"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2364748B' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 16px center" }}
          >
            <option value="">Select status</option>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="divorced">Divorced / Widowed</option>
          </select>
        </div>

        <div className="border-t border-[#F1F5F9] pt-3">
          <CheckItem
            label="I have a disability"
            sublabel="OKU card holder (up to RM6,000 additional relief)"
            checked={!!data.hasDisability}
            onChange={() => setData({ ...data, hasDisability: !data.hasDisability })}
          />
        </div>

        <div className="border-t border-[#F1F5F9] pt-3">
          <Toggle
            label="Do you have children?"
            value={!!data.hasChildren}
            onChange={v => setData({ ...data, hasChildren: v })}
          />
          {data.hasChildren && (
            <div className="mt-2">
              <label className="block text-[9px] font-bold tracking-widest text-[#94A3B8] uppercase mb-1">Number of Children</label>
              <input
                type="number" min="1" max="20" placeholder="e.g. 2"
                value={data.numChildren || ""}
                onChange={e => setData({ ...data, numChildren: e.target.value })}
                className="w-24 px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs focus:outline-none focus:ring-2 focus:ring-[#10B981]"
              />
              <CheckItem
                label="Child(ren) with disability"
                checked={!!data.childDisability}
                onChange={() => setData({ ...data, childDisability: !data.childDisability })}
              />
            </div>
          )}
        </div>

        <div className="border-t border-[#F1F5F9] pt-3">
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
      <h2 className="text-base font-bold text-[#0F172A] mb-0.5">Savings & Insurance</h2>
      <p className="text-xs text-[#64748B] mb-3">Select the savings and insurance contributions you have.</p>

      <div className="divide-y divide-[#F1F5F9]">
        <div className="pb-2">
          <SectionLabel>EPF, Retirement &amp; Life Insurance</SectionLabel>
          {/* Each item has its own key — all three feed into one DB flag (hasEpfLifeInsurance) */}
          <CheckItem label={<span>Voluntary EPF contributions <InfoIcon /></span>} checked={!!data.epf} onChange={() => toggle("epf")} />
          <CheckItem label="Life insurance or takaful premiums" checked={!!data.lifeInsurance} onChange={() => toggle("lifeInsurance")} />
          <CheckItem label="Private Retirement Scheme (PRS)" checked={!!data.prs} onChange={() => toggle("prs")} />
        </div>
        <div className="py-2">
          <SectionLabel>Insurance</SectionLabel>
          <CheckItem label="Education &amp; medical insurance" checked={!!data.medInsurance} onChange={() => toggle("medInsurance")} />
        </div>
        <div className="py-2">
          <SectionLabel>Lifestyle &amp; Purchases</SectionLabel>
          <CheckItem
            label="Books, internet, gym, personal devices"
            sublabel="Lifestyle relief — books, home internet, gym, sports equipment, devices"
            checked={!!data.lifestylePurchases}
            onChange={() => toggle("lifestylePurchases")}
          />
        </div>
        <div className="pt-2">
          <SectionLabel>Education Savings &amp; Other</SectionLabel>
          <CheckItem label="SSPN education savings" sublabel="National Education Savings Scheme" checked={!!data.sspn} onChange={() => toggle("sspn")} />
        </div>
      </div>

      <NavButtons onBack={onBack} onNext={onNext} />
    </Card>
  );
}

function Step5_BusinessProfile({ data, setData, onBack, onNext }) {
  const industries = [
    "Consulting / Advisory", "Freelance Creative (Design, Writing, Video)",
    "Tech / Software", "E-commerce / Retail", "Food & Beverage",
    "Education / Coaching", "Healthcare / Wellness", "Finance / Accounting",
    "Marketing / Agency", "Other",
  ];

  return (
    <Card>
      <h2 className="text-base font-bold text-[#0F172A] mb-0.5">Your Business Profile</h2>
      <p className="text-xs text-[#64748B] mb-3">Help us tailor tax reliefs specific to your solopreneur situation.</p>

      <div className="space-y-3">
        <div>
          <div className="flex gap-3">
            {/* Left column */}
            <div className="flex-1 flex flex-col gap-1.5">
              <span className="text-[9px] font-bold tracking-widest text-[#94A3B8] uppercase">SSM Reg. No.</span>
              <input
                type="text"
                placeholder="e.g. 202301012345"
                value={data.ssmNumber || ""}
                onChange={e => setData({ ...data, ssmNumber: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#10B981] focus:border-transparent transition"
              />
            </div>

            {/* Right column */}
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-[9px] font-bold tracking-widest text-[#94A3B8] uppercase">SST / GST</span>
              <button
                onClick={() => setData({ ...data, sst: !data.sst })}
                className={`flex items-center justify-center px-4 py-2 rounded-xl border-2 transition-all duration-150 h-[34px] ${
                  data.sst ? "border-[#10B981] bg-[#F0FDF9]" : "border-[#E2E8F0] bg-[#F8FAFC] hover:border-[#10B981]"
                }`}
              >
                <div className={`relative w-8 h-4 rounded-full transition-all duration-200 ${data.sst ? "bg-[#10B981]" : "bg-[#CBD5E1]"}`}>
                  <span
                    className="absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all duration-200"
                    style={{ left: data.sst ? "calc(100% - 14px)" : "2px" }}
                  />
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-[#F1F5F9] pt-3">
          <SectionLabel>Industry / Business Type</SectionLabel>
          <select
            value={data.industry || ""}
            onChange={e => setData({ ...data, industry: e.target.value })}
            className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs text-[#0F172A] bg-white focus:outline-none focus:ring-2 focus:ring-[#10B981] appearance-none"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2364748B' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 16px center" }}
          >
            <option value="">Select your industry</option>
            {industries.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>

        <div className="border-t border-[#F1F5F9] pt-3">
          <SectionLabel>Business Expenses You Track</SectionLabel>
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
      </div>

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Complete" />
    </Card>
  );
}

function StepUpload({ onBack, onNext, onSkip }) {
  const [dragging, setDragging] = useState(false);
  const categories = [
    "Medical bills", "Education fees", "Internet & phone",
    "Insurance premiums", "Sports equipment",
  ];

  return (
    <Card>
      <div className="text-center mb-3">
        <div className="flex justify-center gap-4 mb-3">
          {[
            { icon: "⚡", label: "Auto-scanned" },
            { icon: "✦", label: "AI categorized" },
            { icon: "🛡", label: "Relief matched" },
          ].map(({ icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <div className="w-9 h-9 rounded-full bg-[#D1FAE5] flex items-center justify-center text-[#10B981] text-sm">
                {icon}
              </div>
              <span className="text-[10px] text-[#64748B]">{label}</span>
            </div>
          ))}
        </div>
        <h2 className="text-base font-bold text-[#0F172A]">Upload your first receipt</h2>
        <p className="text-xs text-[#64748B] mt-0.5">Try it out — snap a photo or upload any receipt from 2025</p>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); }}
        className={`border-2 border-dashed rounded-2xl p-5 text-center transition-all duration-150 ${
          dragging ? "border-[#10B981] bg-[#F0FDF9]" : "border-[#CBD5E1] hover:border-[#10B981] bg-[#F8FAFC]"
        }`}
      >
        <div className="w-9 h-9 rounded-full border border-[#E2E8F0] flex items-center justify-center mx-auto mb-2 bg-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <p className="text-xs font-semibold text-[#0F172A]">Drag and drop your files here</p>
        <p className="text-xs text-[#64748B]">or <span className="text-[#10B981] font-medium cursor-pointer hover:underline">click to browse</span></p>
        <p className="text-[10px] text-[#94A3B8] mt-1">Supports PDF, JPG, PNG, HEIC up to 50MB</p>
      </div>

      <div className="mt-3">
        <p className="text-[9px] font-bold tracking-widest text-[#94A3B8] uppercase mb-1.5">What you can upload</p>
        <div className="flex flex-wrap gap-1.5">
          {categories.map(c => (
            <span key={c} className="text-[10px] px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#475569] font-medium">{c}</span>
          ))}
        </div>
      </div>

      <div className="mt-3 flex justify-center">
        <button onClick={onSkip || onNext} className="text-xs text-[#94A3B8] hover:text-[#64748B] transition-colors">
          Skip for now
        </button>
      </div>
    </Card>
  );
}

function StepSavings({ data, onNext }) {
  const base = 660;
  const extra =
    (data.epf            ? 150 : 0) +
    (data.lifeInsurance  ?  80 : 0) +
    (data.prs            ? 100 : 0) +
    (data.medInsurance   ?  60 : 0) +
    (data.sspn           ?  40 : 0) +
    (data.hasChildren    ? 120 : 0) +
    (data.lifestylePurchases ? 80 : 0);
  const total = base + extra;

  return (
    <Card>
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-full bg-[#D1FAE5] flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="text-sm font-bold text-[#0F172A] mb-1">Account created!</p>
        <p className="text-xs font-semibold text-[#10B981] mb-1.5">Your estimated tax savings</p>
        <p className="text-4xl font-extrabold text-[#0F172A] mb-3 tracking-tight">RM {total.toLocaleString()}</p>
        <p className="text-xs text-[#64748B] max-w-xs mx-auto leading-relaxed">
          Based on your profile, you could save up to this amount in tax reliefs. Upload receipts to get a more accurate figure.
        </p>
        <p className="text-[10px] text-[#94A3B8] mt-3">This is an estimate. Actual amounts may vary.</p>
      </div>
      <button
        onClick={onNext}
        className="w-full mt-3 py-3 bg-[#10B981] hover:bg-[#0D9488] text-white font-semibold rounded-xl text-xs transition-all duration-200 shadow-sm hover:shadow-md flex items-center justify-center gap-2"
      >
        Let's start claiming your savings <span>→</span>
      </button>
    </Card>
  );
}

// ── Existing-account path: link by SSM number ───────────────────────────────────
function StepExistingSSM({ data, setData, onBack, onNext, onNotFound }) {
  const [searching, setSearching]       = useState(false);
  const [foundEntity, setFoundEntity]   = useState(null);   // entity returned by the lookup
  const [lookupError, setLookupError]   = useState(null);
  const hasInput = (data.existingSsmNumber || "").trim().length > 0;

  const handleFind = async () => {
    setSearching(true);
    setLookupError(null);
    setFoundEntity(null);
    try {
      const entity = await getEntityBySsm(data.existingSsmNumber);
      // SSM found — store the entity id so the parent can link after registration
      setFoundEntity(entity);
      setData({ ...data, linkedEntityId: entity.id, linkedEntityName: entity.name });
    } catch (err) {
      if (err.response?.status === 404) {
        // Entity not in the system — send user back to register as new company
        setLookupError("No company found with that SSM number. It may not be registered in cukai.ai yet.");
      } else {
        setLookupError("Something went wrong. Please check your connection and try again.");
      }
    } finally {
      setSearching(false);
    }
  };

  return (
    <Card>
      <h2 className="text-base font-bold text-[#0F172A] mb-0.5">Find your company</h2>
      <p className="text-xs text-[#64748B] mb-3">Enter your SSM number to link your account to an existing company.</p>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-semibold text-[#64748B] uppercase tracking-wide mb-1">SSM Registration Number</label>
          <div className="flex items-center border border-[#E2E8F0] rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-[#10B981]">
            <span className="px-3 py-2 text-[10px] font-semibold text-[#64748B] bg-[#F8FAFC] border-r border-[#E2E8F0] whitespace-nowrap">SSM No.</span>
            <input
              type="text"
              placeholder="e.g. 202301012345"
              value={data.existingSsmNumber || ""}
              onChange={e => {
                setData({ ...data, existingSsmNumber: e.target.value });
                setFoundEntity(null);
                setLookupError(null);
              }}
              className="flex-1 px-3 py-2 text-xs text-[#0F172A] placeholder-[#CBD5E1] focus:outline-none"
            />
          </div>
          <p className="text-[10px] text-[#94A3B8] mt-1.5">Found on your SSM certificate or mycoid.ssm.com.my.</p>
        </div>

        {/* SSM found — show entity card */}
        {foundEntity && (
          <div className="p-3 rounded-xl bg-[#F0FDF9] border border-[#D1FAE5]">
            <p className="text-[10px] font-bold text-[#0D9488] uppercase tracking-wide mb-1">Company found</p>
            <p className="text-xs font-semibold text-[#0F172A]">{foundEntity.name}</p>
            <p className="text-[10px] text-[#64748B] mt-0.5">{foundEntity.entityType} · {foundEntity.city}{foundEntity.state ? `, ${foundEntity.state}` : ""}</p>
          </div>
        )}

        {/* Lookup error — with option to go back and register as new */}
        {lookupError && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-100">
            <p className="text-[11px] text-red-600 font-medium mb-2">⚠️ {lookupError}</p>
            <button
              onClick={onNotFound}
              className="text-[10px] font-semibold text-red-600 underline underline-offset-2 hover:text-red-700"
            >
              ← Register as a new company instead
            </button>
          </div>
        )}

        {!foundEntity && !lookupError && (
          <div className="p-3 rounded-xl bg-[#F0FDF9] border border-[#D1FAE5]">
            <p className="text-[10px] text-[#0D9488] leading-relaxed">
              <span className="font-semibold">Where to find it?</span> Your SSM number appears on your business registration certificate, or log in to <span className="font-medium">mycoid.ssm.com.my</span>.
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center mt-4 pt-3 border-t border-[#F1F5F9]">
        <button onClick={onBack} className="text-[#64748B] font-medium text-xs hover:text-[#0F172A] transition-colors px-2 py-1">
          Back
        </button>
        {!foundEntity ? (
          <button
            onClick={handleFind}
            disabled={!hasInput || searching}
            className={`px-5 py-2 rounded-xl font-semibold text-xs transition-all duration-200 ${
              !hasInput || searching
                ? "bg-[#D1FAE5] text-[#6EE7B7] cursor-not-allowed"
                : "bg-[#10B981] hover:bg-[#0D9488] text-white shadow-sm hover:shadow-md"
            }`}
          >
            {searching ? "Searching…" : "Find Company"}
          </button>
        ) : (
          <button
            onClick={onNext}
            className="px-5 py-2 rounded-xl font-semibold text-xs bg-[#10B981] hover:bg-[#0D9488] text-white shadow-sm hover:shadow-md transition-all duration-200"
          >
            Link & Continue →
          </button>
        )}
      </div>
    </Card>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

export default function GetStarted({ onLogin }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const isExisting = data.accountType === "existing";

  const handleRegisterUser = async (onSuccess) => {
    setLoading(true);
    setError(null);

    // Map your flat wizard data into the nested structure main.py expects
    const payload = {
      person: {
        email:                        data.email                           || "",
        password:                     data.password                        || "",
        fullName:                     data.fullName                        || "",
        idType:                       "ic",
        identificationNo:             data.identificationNo                || "",
        personalTin:                  data.personalTin                     || "",
        citizenship:                  "MYS",
        gender:                       data.gender                          || "",
        dateOfBirth:                  data.dob                             || null,
        maritalStatus:                data.marital                         || "single",
        maritalEventDate:             null,
        spouseName:                   data.spouseName                      || "",
        spouseIdNo:                   data.spouseIdNo                      || "",
        spouseDob:                    null,
        assessmentType:               "single",
        numberOfChildren:             data.hasChildren ? parseInt(data.numChildren || 0) : 0,
        hasDisabledDependents:        data.childDisability                 || false,
        phone:                        data.phone                           || "",
        correspondenceAddress:        data.address                         || "",
        correspondencePostcode:       data.postcode                        || "",
        correspondenceCity:           data.city                            || "",
        correspondenceState:          data.state                           || "",
        refundMethod:                 "bank",
        bankName:                     data.bankName                        || "",
        bankAccountNo:                data.bankAccountNo                   || "",
        recordKeeping:                true,
        hasForeignAccounts:           false,
        rpgtDisposal:                 false,
        hasDependentParents:          data.supportParents                  || false,
        hasEpfLifeInsurance:          !!(data.epf || data.lifeInsurance || data.prs),
        hasEducationMedicalInsurance: data.medInsurance                    || false,
        hasLifestylePurchases:        data.lifestylePurchases              || false,
        hasSspnEvOther:               data.sspn                            || false,
      },
      // skipEntity tells the backend not to create a new entity for this person.
      // Used by the existing-account path — they're joining an existing company via SSM.
      skipEntity: isExisting,

      entity: isExisting ? {} : {
        entityType:       "sole-prop",
        name:             data.companyName || `${data.fullName || "Solopreneur"}'s Business`,
        businessCode:     data.industry || "",
        businessActivity: data.industry || "",
        ssmNo:            data.ssmNumber || "",
        tin:              "",
        address:          "",
        postcode:         "",
        city:             "",
        state:            "",
        salesTurnover:    parseFloat(data.businessIncome || 0),
        totalExpenditure: 0,
        netProfitLoss:    0,
        totalAssets:      0,
        totalLiabilities: 0,
        monthlyIncome:    parseFloat(data.businessIncome || 0),
        annualIncome:     0,
      }
    };

    try {
      // Direct call to your FastAPI backend endpoint
      const response = await registerUser(payload);
      
      // Cache database identity locally for subsequent dashboard loads
      if (response && response.id) {
        localStorage.setItem("userId",       String(response.id));
        localStorage.setItem("userFullName", response.fullName || data.fullName || "");
        localStorage.setItem("userEmail",    data.email || "");
        // For new-company path: default to the entity just created.
        // For existing-company path: activeEntityId is set after linkPersonToEntity succeeds.
        if (!isExisting && response.entities && response.entities.length > 0) {
          localStorage.setItem("activeEntityId", String(response.entities[0].id));
        }
      }

      await onSuccess(response?.id);
    } catch (err) {
      console.error("Registration failed:", err);
      const detail = err.response?.data?.detail || "Network request failed. Is your backend server up?";
      // For existing-account path, "Email already registered" means the user already has an account
      if (isExisting && detail.toLowerCase().includes("email already")) {
        setError("This email is already registered. Please log in to link your account to this company.");
      } else {
        setError(detail);
      }
    } finally {
      setLoading(false);
    }
  };

  const newAccountStepsConfig = [
    { label: "Account" },
    { label: "Account Type" },
    { label: "Income" },
    { label: "Personal & Family" },
    { label: "Savings & Insurance" },
    { label: "Business Profile" },
  ];

  const existingAccountStepsConfig = [
    { label: "Account" },
    { label: "Account Type" },
    { label: "Link Company" },
  ];

  const WIZARD_STEPS = {};

  // Shared steps (both paths begin here)
  WIZARD_STEPS[0] = (
    <>
      <ProgressBar current={0} total={isExisting ? 3 : 6} steps={isExisting ? existingAccountStepsConfig : newAccountStepsConfig} />
      <Step0_Account data={data} setData={setData} onNext={() => setStep(1)} />
    </>
  );
  WIZARD_STEPS[1] = (
    <>
      <ProgressBar current={1} total={isExisting ? 3 : 6} steps={isExisting ? existingAccountStepsConfig : newAccountStepsConfig} />
      <Step1_Employment data={data} setData={setData} onBack={() => setStep(0)} onNext={() => {
        if (data.accountType === "existing") {
          setStep(2);
        } else {
          setStep(10);
        }
      }} />
    </>
  );

  // Existing-account path diverges here
  WIZARD_STEPS[2] = (
    <>
      <ProgressBar current={2} total={3} steps={existingAccountStepsConfig} />
      <StepExistingSSM
        data={data}
        setData={setData}
        onBack={() => setStep(1)}
        onNotFound={() => setStep(1)}
        onNext={() => handleRegisterUser(async (personId) => {
          // After registration, link the new user to the found entity
          if (data.linkedEntityId && personId) {
            try {
              await linkPersonToEntity(data.linkedEntityId, personId);
              // Now that we're linked to the found entity, scope the active context to it
              localStorage.setItem("activeEntityId", String(data.linkedEntityId));
            } catch (linkErr) {
              if (linkErr.response?.status === 409) {
                // User is already a member of this entity — don't silently fail
                setError("Your account is already linked to this company. Please log in instead.");
              } else {
                console.warn("Could not auto-link to entity:", linkErr);
              }
            }
          }
          setStep(50);
        })}
      />
    </>
  );
  WIZARD_STEPS[50] = <StepUpload onBack={() => setStep(2)} onNext={() => setStep(51)} onSkip={() => setStep(51)} />;
  WIZARD_STEPS[51] = <StepSavings data={data} onNext={() => { onLogin(); navigate("/overview"); }} />;

  // New-account path
  WIZARD_STEPS[10] = (
    <>
      <ProgressBar current={2} total={6} steps={newAccountStepsConfig} />
      <Step2_Income data={data} setData={setData} onBack={() => setStep(1)} onNext={() => setStep(11)} />
    </>
  );
  WIZARD_STEPS[11] = (
    <>
      <ProgressBar current={3} total={6} steps={newAccountStepsConfig} />
      <Step3_Personal data={data} setData={setData} onBack={() => setStep(10)} onNext={() => setStep(12)} />
    </>
  );
  WIZARD_STEPS[12] = (
    <>
      <ProgressBar current={4} total={6} steps={newAccountStepsConfig} />
      <Step4_Savings data={data} setData={setData} onBack={() => setStep(11)} onNext={() => setStep(13)} />
    </>
  );
  WIZARD_STEPS[13] = (
    <>
      <ProgressBar current={5} total={6} steps={newAccountStepsConfig} />
      <Step5_BusinessProfile
        data={data}
        setData={setData}
        onBack={() => setStep(12)}
        onNext={() => handleRegisterUser(async () => setStep(14))}
      />
    </>
  );
  WIZARD_STEPS[14] = <StepUpload onBack={() => setStep(13)} onNext={() => setStep(15)} />;
  WIZARD_STEPS[15] = <StepSavings data={data} onNext={() => { onLogin(); navigate("/overview"); }} />;

  const currentView = WIZARD_STEPS[step];

  return (
    <div className="w-screen h-screen bg-[#E8ECF4] flex items-center justify-center px-4 overflow-hidden">
      <div className="w-full max-w-[440px] bg-white rounded-[20px] shadow-[0_4px_32px_rgba(15,23,42,0.10)] px-7 py-6 flex flex-col">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-1">
          <img src={cukaiLogo} alt="Cukai.ai logo" className="h-8 w-8 shrink-0" />
          <span className="select-none text-lg font-bold tracking-tight text-[#0F172A]">
            cukai<span className="text-[#10B981]">.</span><span className="font-light text-[#64748B]">ai</span>
          </span>
        </div>

        {/* Error Alert Banner */}
        {error && (
          <div className="mb-3 p-2.5 rounded-xl bg-red-50 text-red-600 text-[11px] font-medium border border-red-100 animate-fade-in">
            <p>⚠️ {error}</p>
            {error.toLowerCase().includes("email") && (
              <div className="flex gap-2 mt-2">
                {!isExisting && (
                  <button
                    onClick={() => { setError(null); setStep(0); }}
                    className="px-3 py-1 rounded-lg bg-white border border-red-200 text-red-600 text-[10px] font-semibold hover:bg-red-50 transition-colors"
                  >
                    ← Change email
                  </button>
                )}
                <button
                  onClick={() => navigate("/login")}
                  className="px-3 py-1 rounded-lg bg-red-600 text-white text-[10px] font-semibold hover:bg-red-700 transition-colors"
                >
                  {isExisting ? "Log in to link your account" : "Log in instead"}
                </button>
              </div>
            )}
            {!error.toLowerCase().includes("email") && (
              <button
                onClick={() => setError(null)}
                className="mt-2 px-3 py-1 rounded-lg bg-white border border-red-200 text-red-600 text-[10px] font-semibold hover:bg-red-50 transition-colors"
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        {/* Form contents with dynamic loading styles */}
        <div className={`transition-all duration-300 ${loading ? "opacity-40 pointer-events-none select-none" : ""}`}>
          {currentView}
        </div>
        
        {loading && (
          <div className="text-center text-[10px] font-semibold text-[#10B981] mt-2 animate-pulse">
            Processing secure registration...
          </div>
        )}
      </div>
    </div>
  );
}