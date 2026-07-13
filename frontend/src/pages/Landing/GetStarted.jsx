import { useState } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import cukaiLogo from '../../assets/cukai-logo.png';
import { registerUser } from "../../services/api";

// ── Malaysia Standard Industrial Classification (MSIC 2008) reference ───────────
// A curated subset covering the solopreneur / SME categories this wizard offers.
// `label` is shown to the user; `code` is the real 5-digit MSIC code stored as
// the entity's businessCode, and `activity` is the official MSIC activity title
// stored as businessActivity (so reports reference the correct LHDN classification).
const MSIC_CODES = [
  { code: "70200", label: "Consulting / Advisory",                      activity: "Management consultancy activities" },
  { code: "74100", label: "Freelance Creative (Design, Writing, Video)", activity: "Specialised design activities" },
  { code: "62010", label: "Tech / Software",                            activity: "Computer programming activities" },
  { code: "47910", label: "E-commerce / Retail",                        activity: "Retail sale via internet" },
  { code: "56101", label: "Food & Beverage",                            activity: "Restaurants and mobile food service activities" },
  { code: "85499", label: "Education / Coaching",                       activity: "Other education n.e.c." },
  { code: "86900", label: "Healthcare / Wellness",                      activity: "Other human health activities" },
  { code: "69200", label: "Finance / Accounting",                       activity: "Accounting, bookkeeping and auditing activities; tax consultancy" },
  { code: "73100", label: "Marketing / Agency",                         activity: "Advertising" },
  { code: "96090", label: "Other",                                      activity: "Other personal service activities n.e.c." },
];

// ── Shared UI primitives ────────────────────────────────────────────────────────

const ProgressBar = ({ current, total, title, description }) => (
  <div className="mb-3">
    <div className="flex items-start justify-between gap-3 mb-3">
      <div>
        <h2 className="text-sm font-bold text-headings mb-0.5">{title}</h2>
        <p className="text-xs text-muted">{description}</p>
      </div>
      <span className="text-sm font-bold text-headings shrink-0">{current + 1}/{total}</span>
    </div>
    <div className="flex gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full transition-all duration-500 ${
            i <= current ? "bg-primary" : "bg-border"
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
  <div className="flex justify-between items-center mt-4 pt-3 border-t border-border">
    {showBack ? (
      <button onClick={onBack} className="text-muted font-semibold text-xs hover:text-headings transition-colors px-2 py-3.5">
        Back
      </button>
    ) : <div />}
    <button
      onClick={onNext}
      disabled={nextDisabled}
      className={`px-5 py-3.5 rounded-xl font-semibold text-xs transition-all duration-200 ${
        nextDisabled
          ? "bg-primary-tint text-[#6EE7B7] cursor-not-allowed"
          : "bg-primary hover:bg-primary-hover text-white shadow-sm hover:shadow-md"
      }`}
    >
      {nextLabel}
    </button>
  </div>
);

const SectionLabel = ({ children }) => (
  <p className="text-xs font-semibold tracking-[0.06em] text-muted mb-2 mt-3 first:mt-0">{children}</p>
);

const CheckItem = ({ label, sublabel, checked, onChange }) => (
  <label
    onClick={(e) => { e.preventDefault(); onChange(); }}
    className="flex items-center gap-3 cursor-pointer py-1.5 group select-none"
  >
    <div
      className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all duration-150 ${
        checked ? "bg-primary border-primary" : "border-[#CBD5E1] group-hover:border-primary"
      }`}
    >
      {checked && (
        <svg width="8" height="7" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
    <div>
      <span className="text-sm font-normal text-headings">{label}</span>
      {sublabel && <p className="text-xs text-muted mt-0.5">{sublabel}</p>}
    </div>
  </label>
);

const Toggle = ({ label, value, onChange }) => (
  <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-[#F8FAFC]">
    <span className="text-sm font-normal text-headings">{label}</span>
    <button
      onClick={() => onChange(!value)}
      className={`relative w-9 h-5 rounded-full transition-all duration-200 ${value ? "bg-primary" : "bg-[#CBD5E1]"}`}
    >
      <span
        className="absolute top-0.5 w-4 h-4 bg-surface rounded-full shadow transition-all duration-200"
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
const strengthColor = ["", "#DC2626", "#F59E0B", "#3B82F6", "#0D9488"];

// ── Step components ─────────────────────────────────────────────────────────────

function Step0_Account({ data, setData, onNext }) {
  const [showPw, setShowPw] = useState(false);
  const strength = getStrength(data.password || "");
  const valid = data.fullName && data.email && (data.password || "").length >= 8;

  return (
    <Card>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold tracking-[0.06em] text-muted mb-2">Full Name</label>
          <input
            type="text"
            placeholder="e.g. Amirul Hakim"
            value={data.fullName || ""}
            onChange={e => setData({ ...data, fullName: e.target.value })}
            className="w-full px-4 py-3 rounded-xl border-[1.5px] border-border text-[13.5px] text-headings placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold tracking-[0.06em] text-muted mb-2">Email Address</label>
          <input
            type="email"
            placeholder="you@example.com"
            value={data.email || ""}
            onChange={e => setData({ ...data, email: e.target.value })}
            className="w-full px-4 py-3 rounded-xl border-[1.5px] border-border text-[13.5px] text-headings placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold tracking-[0.06em] text-muted mb-2">Password</label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              placeholder="Min. 8 characters"
              value={data.password || ""}
              onChange={e => setData({ ...data, password: e.target.value })}
              className="w-full px-4 py-3 pr-10 rounded-xl border-[1.5px] border-border text-[13.5px] text-headings placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-muted text-[10px]"
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
          <label className="block text-xs font-semibold tracking-[0.06em] text-muted mb-2">
            Phone Number <span className="font-normal text-[#94A3B8]">(optional)</span>
          </label>
          <input
            type="tel"
            placeholder="+60 12-345 6789"
            value={data.phone || ""}
            onChange={e => setData({ ...data, phone: e.target.value })}
            className="w-full px-4 py-3 rounded-xl border-[1.5px] border-border text-[13.5px] text-headings placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
          />
        </div>
      </div>

      <NavButtons showBack={false} onNext={onNext} nextDisabled={!valid} />

      {/* Log in link — shown only when showBack is false (first step) */}
      <p className="mt-3 text-center text-[12px] text-[#94A3B8]">
        Already have an account?{" "}
        <NavLink
          to="/login"
          className="text-[#94A3B8] underline underline-offset-2 hover:text-muted transition-colors"
        >
          Log in
        </NavLink>
      </p>
    </Card>
  );
}

function Step2_Income({ data, setData, onBack, onNext }) {
  const [mode, setMode] = useState("monthly");

  return (
    <Card>

      <div className="flex bg-border rounded-xl p-1 mb-3 w-fit">
        {["monthly", "annual"].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1 rounded-lg text-xs font-medium transition-all duration-150 capitalize ${
              mode === m ? "bg-surface text-headings shadow-sm" : "text-muted hover:text-headings"
            }`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <div>
        <label className="block text-xs font-semibold tracking-[0.06em] text-muted mb-1">
          {mode === "monthly" ? "Monthly" : "Annual"} Business Income
        </label>
        <div className="flex items-center border-[1.5px] border-border rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary">
          <span className="px-4 py-3 text-[13.5px] font-semibold text-muted bg-[#F8FAFC] border-r border-border">RM</span>
          <input
            type="number" min="0" step="0.01" placeholder="0.00"
            value={data.businessIncome || ""}
            onChange={e => setData({ ...data, businessIncome: e.target.value })}
            className="flex-1 px-4 py-3 text-[13.5px] text-headings focus:outline-none"
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

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold tracking-[0.06em] text-muted mb-2">Marital Status</label>
          <select
            value={data.marital || ""}
            onChange={e => setData({ ...data, marital: e.target.value })}
            className="w-full px-4 py-3 rounded-xl border-[1.5px] border-border text-[13.5px] text-headings bg-surface focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2364748B' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 16px center" }}
          >
            <option value="">Select status</option>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="divorced">Divorced / Widowed</option>
          </select>
        </div>

        <div className="border-t border-border pt-3">
          <CheckItem
            label="I have a disability"
            sublabel="OKU card holder (up to RM6,000 additional relief)"
            checked={!!data.hasDisability}
            onChange={() => setData({ ...data, hasDisability: !data.hasDisability })}
          />
        </div>

        <div className="border-t border-border pt-3">
          <Toggle
            label="Do you have children?"
            value={!!data.hasChildren}
            onChange={v => setData({ ...data, hasChildren: v })}
          />
          {data.hasChildren && (
            <div className="mt-2">
              <label className="block text-xs font-semibold tracking-[0.06em] text-muted mb-1">Number of Children</label>
              <input
                type="number" min="1" max="20" placeholder="e.g. 2"
                value={data.numChildren || ""}
                onChange={e => setData({ ...data, numChildren: e.target.value })}
                className="w-24 px-4 py-3 rounded-xl border-[1.5px] border-border text-[13.5px] focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <CheckItem
                label="Child(ren) with disability"
                checked={!!data.childDisability}
                onChange={() => setData({ ...data, childDisability: !data.childDisability })}
              />
            </div>
          )}
        </div>

        <div className="border-t border-border pt-3">
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

      <div className="divide-y divide-border">
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
  // Malaysia Standard Industrial Classification (MSIC 2008) 5-digit codes.
  // Each wizard-friendly label maps to the closest real MSIC code so the
  // backend stores a proper business_code instead of the free-text label.
  const industries = MSIC_CODES;

  return (
    <Card>

      <div className="space-y-3">
        <div>
          <div className="flex gap-3">
            {/* Left column */}
            <div className="flex-1 flex flex-col gap-1.5">
              <span className="text-xs font-semibold tracking-[0.06em] text-muted">SSM Reg. No.</span>
              <input
                type="text"
                placeholder="e.g. 202301012345"
                value={data.ssmNumber || ""}
                onChange={e => setData({ ...data, ssmNumber: e.target.value })}
                className="w-full h-[46px] px-4 rounded-xl border-[1.5px] border-border text-[13.5px] text-headings placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
              />
            </div>

            {/* Right column */}
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-xs font-semibold tracking-[0.06em] text-muted">SST / GST</span>
              <button
                onClick={() => setData({ ...data, sst: !data.sst })}
                className={`flex items-center justify-center h-[46px] px-4 rounded-xl border-[1.5px] transition-all duration-150 ${
                  data.sst ? "border-primary bg-primary-tint" : "border-border bg-[#F8FAFC] hover:border-primary"
                }`}
              >
                <div className={`relative w-8 h-4 rounded-full transition-all duration-200 ${data.sst ? "bg-primary" : "bg-[#CBD5E1]"}`}>
                  <span
                    className="absolute top-0.5 w-3 h-3 bg-surface rounded-full shadow transition-all duration-200"
                    style={{ left: data.sst ? "calc(100% - 14px)" : "2px" }}
                  />
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <label className="block text-xs font-semibold tracking-[0.06em] text-muted mb-2">Industry / Business Type</label>
          <select
            value={data.industryCode || ""}
            onChange={e => {
              const selected = industries.find(i => i.code === e.target.value);
              setData({
                ...data,
                industryCode:    selected?.code     || "",
                industryLabel:   selected?.label    || "",
                industryActivity: selected?.activity || "",
              });
            }}
            className="w-full px-4 py-3 rounded-xl border-[1.5px] border-border text-[13.5px] text-headings bg-surface focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2364748B' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 16px center" }}
          >
            <option value="">Select your industry</option>
            {industries.map(i => <option key={i.code} value={i.code}>{i.label} — MSIC {i.code}</option>)}
          </select>
          {data.industryCode && (
            <p className="text-[10px] text-[#94A3B8] mt-1.5">
              MSIC code <span className="font-semibold text-headings">{data.industryCode}</span> will be saved to your business profile.
            </p>
          )}
        </div>

        <div className="border-t border-border pt-3">
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
              <div className="w-9 h-9 rounded-full bg-primary-tint flex items-center justify-center text-primary text-sm">
                {icon}
              </div>
              <span className="text-[11px] text-muted">{label}</span>
            </div>
          ))}
        </div>
        <h2 className="text-sm font-bold text-headings">Upload your first receipt</h2>
        <p className="text-xs text-muted mt-0.5">Try it out — snap a photo or upload any receipt from 2025</p>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); }}
        className={`border-2 border-dashed rounded-2xl p-5 text-center transition-all duration-150 ${
          dragging ? "border-primary bg-primary-tint" : "border-[#CBD5E1] hover:border-primary bg-[#F8FAFC]"
        }`}
      >
        <div className="w-9 h-9 rounded-full border border-border flex items-center justify-center mx-auto mb-2 bg-surface">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <p className="text-xs font-semibold text-headings">Drag and drop your files here</p>
        <p className="text-xs text-muted">or <span className="text-primary font-medium cursor-pointer hover:underline">click to browse</span></p>
        <p className="text-[10px] text-[#94A3B8] mt-1">Supports PDF, JPG, PNG, HEIC up to 50MB</p>
      </div>

      <div className="mt-3">
        <p className="text-xs font-semibold tracking-[0.06em] text-muted mb-1.5">What you can upload</p>
        <div className="flex flex-wrap gap-1.5">
          {categories.map(c => (
            <span key={c} className="text-[10px] px-2.5 py-1 rounded-full bg-border text-muted font-medium">{c}</span>
          ))}
        </div>
      </div>

      <div className="mt-3 flex justify-center">
        <button onClick={onSkip || onNext} className="text-xs text-[#94A3B8] hover:text-muted transition-colors">
          Skip for now
        </button>
      </div>
    </Card>
  );
}

function StepSavings({ onNext }) {
  return (
    <Card>
      <div className="text-center py-4">
        {/* <h2 className="text-sm font-bold text-headings mb-3">Account created!</h2> */}
        <div className="w-12 h-12 rounded-full bg-primary-tint flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="#0D9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="select-none text-base font-bold tracking-tight text-headings">
            You're<span className="text-primary"> all </span><span className="font-light text-muted">set.</span>
          </span>
        </div>
        <p className="text-sm text-muted max-w-xs mx-auto leading-relaxed">
          Let's get your reliefs and receipts sorted so you claim everything you're entitled to.
        </p>
      </div>
      <button
        onClick={onNext}
        className="w-full mt-3 py-3.5 bg-primary hover:bg-primary-hover text-white font-semibold rounded-xl text-xs transition-all duration-200 shadow-sm hover:shadow-md flex items-center justify-center gap-2"
      >
        Start claiming your savings <span>→</span>
      </button>
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

  const handleRegisterUser = async (onSuccess) => {
    setLoading(true);
    setError(null);

    // Map your flat wizard data into the nested structure main.py expects
    const payload = {
      person: {
        email:                        data.email                           || "",
        password:                     data.password                        || "",
        fullName:                     data.fullName                        || "",
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
      entity: {
        entityType:       "sole-prop",
        name:             data.companyName || `${data.fullName || "Solopreneur"}'s Business`,
        businessCode:     data.industryCode     || "",
        businessActivity: data.industryActivity || "",
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
        if (response.entities && response.entities.length > 0) {
          localStorage.setItem("activeEntityId", String(response.entities[0].id));
        }
      }

      await onSuccess(response?.id);
    } catch (err) {
      console.error("Registration failed:", err);
      setError(err.response?.data?.detail || "Network request failed. Is your backend server up?");
    } finally {
      setLoading(false);
    }
  };

  // Single registration flow — every account creates one person with one entity.
  // Additional entities are created later from Account Settings (ManageProfile).
  const WIZARD_STEPS = {};

  WIZARD_STEPS[0] = (
    <>
      <ProgressBar
        current={0} total={5}
        title="Create your account"
        description="Your details are safe with us."
      />
      <Step0_Account data={data} setData={setData} onNext={() => setStep(1)} />
    </>
  );
  WIZARD_STEPS[1] = (
    <>
      <ProgressBar
        current={1} total={5}
        title="What's your business income?"
        description="Enter your gross income before deductions."
      />
      <Step2_Income data={data} setData={setData} onBack={() => setStep(0)} onNext={() => setStep(2)} />
    </>
  );
  WIZARD_STEPS[2] = (
    <>
      <ProgressBar
        current={2} total={5}
        title="Personal & Family"
        description="Marital status, children, and dependents for tax relief."
      />
      <Step3_Personal data={data} setData={setData} onBack={() => setStep(1)} onNext={() => setStep(3)} />
    </>
  );
  WIZARD_STEPS[3] = (
    <>
      <ProgressBar
        current={3} total={5}
        title="Savings & Insurance"
        description="Select the savings and insurance contributions you have."
      />
      <Step4_Savings data={data} setData={setData} onBack={() => setStep(2)} onNext={() => setStep(4)} />
    </>
  );
  WIZARD_STEPS[4] = (
    <>
      <ProgressBar
        current={4} total={5}
        title="Your Business Profile"
        description="Help us tailor tax reliefs specific to your solopreneur situation."
      />
      <Step5_BusinessProfile
        data={data}
        setData={setData}
        onBack={() => setStep(3)}
        // onNext={() => handleRegisterUser(async () => setStep(5))}
        onNext={() => handleRegisterUser(async () => setStep(6))}
      />
    </>
  );
  WIZARD_STEPS[5] = <StepUpload onBack={() => setStep(4)} onNext={() => setStep(6)} />;
  WIZARD_STEPS[6] = <StepSavings onNext={() => { onLogin(); navigate("/overview"); }} />;

  const currentView = WIZARD_STEPS[step];

  return (
    <div className="w-screen h-screen bg-background flex items-center justify-center px-4 overflow-hidden">
      <div className="w-full max-w-[440px] bg-surface rounded-[20px] shadow-[0_4px_32px_rgba(15,23,42,0.10)] px-7 py-6 flex flex-col">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-1">
          <img src={cukaiLogo} alt="Cukai.ai logo" className="h-10 w-10 shrink-0" />
          <span className="select-none text-xl font-bold tracking-tight text-headings">
            cukai<span className="text-primary">.</span><span className="font-light text-muted">ai</span>
          </span>
        </div>

        {/* Error Alert Banner */}
        {error && (
          <div className="mb-3 p-2.5 rounded-xl bg-red-50 text-critical text-[11px] font-medium border border-red-100 animate-fade-in">
            <p>⚠️ {error}</p>
            {error.toLowerCase().includes("email") && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => { setError(null); setStep(0); }}
                  className="px-3 py-1 rounded-lg bg-surface border border-red-200 text-critical text-xs font-semibold hover:bg-red-50 transition-colors"
                >
                  ← Change email
                </button>
                <button
                  onClick={() => navigate("/login")}
                  className="px-3 py-1 rounded-lg bg-critical text-white text-xs font-semibold hover:bg-red-700 transition-colors"
                >
                  Log in instead
                </button>
              </div>
            )}
            {!error.toLowerCase().includes("email") && (
              <button
                onClick={() => setError(null)}
                className="mt-2 px-3 py-1 rounded-lg bg-surface border border-red-200 text-critical text-xs font-semibold hover:bg-red-50 transition-colors"
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
          <div className="text-center text-[10px] font-semibold text-primary mt-2 animate-pulse">
            Processing secure registration...
          </div>
        )}
      </div>
    </div>
  );
}