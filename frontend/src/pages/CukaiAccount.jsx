import { useRef, useState, useCallback, useEffect } from 'react';

// ─── Design tokens (matches ManageAccount + UserNavigation) ───────────────────
// Primary teal: #0F6E56  Active: #0D9488  Text: #0F172A  Muted: #64748B  Border: #E2E8F0

// ─── User scenarios ───────────────────────────────────────────────────────────
const USER_SCENARIOS = {
  A: {
    label: 'Sole Proprietor', description: 'You operate as a sole proprietor.',
    canViewFormP: false, canFileFormP: false, canFileFormB: true, firm: null,
  },
  B: {
    label: 'Principal Partner', description: 'You are the principal partner of Meridian Print Studio.',
    canViewFormP: true, canFileFormP: true, canFileFormB: true,
    firm: { name: 'Meridian Print Studio', msic: '1811', type: 'Partnership', share: '50%' },
  },
  C: {
    label: 'Partner (Non-Principal)', description: 'You are a partner of Meridian Print Studio, but not the principal partner.',
    canViewFormP: true, canFileFormP: false, canFileFormB: true,
    firm: { name: 'Meridian Print Studio', msic: '1811', type: 'Partnership', share: '30%' },
  },
};

// ─── OCR status meta ──────────────────────────────────────────────────────────
const STATUS_META = {
  deductible:     { label: 'Company Expense', color: '#0F6E56', bg: '#ECFDF5', dot: '#0F6E56' },
  non_deductible: { label: 'Personal Expense', color: '#DC2626', bg: '#FEF2F2', dot: '#DC2626' },
  mixed:          { label: 'Needs Review',     color: '#B45309', bg: '#FFFBEB', dot: '#F59E0B' },
};

// ─── Category colours ─────────────────────────────────────────────────────────
const CATEGORY_COLORS = {
  'Service Income': '#0F6E56', 'Product Sales': '#1D9E75',
  'Supplier Purchases': '#0D9488', 'Utilities & Rental': '#10B981',
  'Payroll & Staff Cost': '#64748B', 'Marketing & Admin': '#BA7517',
  'Transport & Maintenance': '#7C839B', 'Personal Expense': '#DC2626',
  'Mixed / Review': '#F59E0B',
};

// ─── Initial mock documents ───────────────────────────────────────────────────
const INITIAL_DOCS = [
  { id: 1, name: 'Invoice_May2026_001.pdf', type: 'Invoice', date: '12 May 2026', amount: 'RM 8,400', status: 'deductible', category: 'Service Income', note: 'Client invoice for design retainer.' },
  { id: 2, name: 'Receipt_Utilities_Apr2026.pdf', type: 'Utility Bill', date: '30 Apr 2026', amount: 'RM 1,240', status: 'deductible', category: 'Utilities & Rental', note: 'TNB electricity bill — office premise.' },
  { id: 3, name: 'Staff_Salary_Voucher_May.pdf', type: 'Payroll', date: '31 May 2026', amount: 'RM 14,500', status: 'deductible', category: 'Payroll & Staff Cost', note: 'Monthly salary disbursement.' },
  { id: 4, name: 'Directors_Dinner_Receipt.jpg', type: 'Receipt', date: '18 May 2026', amount: 'RM 980', status: 'mixed', category: 'Mixed / Review', note: 'Entertainment — AI uncertain if business-related.' },
  { id: 5, name: 'Printer_Ink_Supplies.pdf', type: 'Purchase Order', date: '5 Jun 2026', amount: 'RM 430', status: 'deductible', category: 'Supplier Purchases', note: 'Office consumables for print studio.' },
  { id: 6, name: 'Personal_Gym_Membership.pdf', type: 'Receipt', date: '1 Jun 2026', amount: 'RM 200', status: 'non_deductible', category: 'Personal Expense', note: 'Personal gym membership — not business related.' },
  { id: 7, name: 'Marketing_Campaign_May.pdf', type: 'Invoice', date: '20 May 2026', amount: 'RM 3,200', status: 'deductible', category: 'Marketing & Admin', note: 'Social media advertising spend.' },
  { id: 8, name: 'Grab_Business_Trips.pdf', type: 'Receipt', date: '28 May 2026', amount: 'RM 340', status: 'deductible', category: 'Transport & Maintenance', note: 'Client meeting transport.' },
  { id: 9, name: 'Personal_Holiday_Flight.pdf', type: 'Receipt', date: '15 Jun 2026', amount: 'RM 1,800', status: 'non_deductible', category: 'Personal Expense', note: 'Family holiday flights — personal.' },
  { id: 10, name: 'Team_Lunch_Receipt.jpg', type: 'Receipt', date: '10 Jun 2026', amount: 'RM 560', status: 'mixed', category: 'Mixed / Review', note: 'Team lunch — may be partially deductible.' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseAmt = (s) => parseFloat((s || '').replace(/[^\d.]/g, '')) || 0;
const fmtRM = (v) => 'RM ' + Number(v).toLocaleString('en-MY', { maximumFractionDigits: 0 });
const pct = (v, total) => total ? ((v / total) * 100).toFixed(1) + '%' : '0%';

function buildBusinessSegments(docs) {
  const totals = {};
  docs.filter(d => d.status === 'deductible').forEach(d => {
    totals[d.category] = (totals[d.category] || 0) + parseAmt(d.amount);
  });
  return Object.entries(totals).map(([label, value]) => ({ label, value, color: CATEGORY_COLORS[label] || '#94A3B8' }));
}

function buildPersonalSegments(docs) {
  // Personal = non_deductible + mixed grouped simply
  const personal = docs.filter(d => d.status === 'non_deductible').reduce((s, d) => s + parseAmt(d.amount), 0);
  const review   = docs.filter(d => d.status === 'mixed').reduce((s, d) => s + parseAmt(d.amount), 0);
  const segs = [];
  if (personal > 0) segs.push({ label: 'Personal Expenses', value: personal, color: '#DC2626' });
  if (review > 0)   segs.push({ label: 'Pending Review', value: review, color: '#F59E0B' });
  return segs;
}

// ─── Donut Pie Chart ──────────────────────────────────────────────────────────
function DonutChart({ segments, title, subtitle, size = 140 }) {
  const [hovered, setHovered] = useState(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });
  const svgRef = useRef(null);

  const total = segments.reduce((s, sg) => s + sg.value, 0);
  const CX = size / 2, CY = size / 2, R = size * 0.39, INNER = size * 0.22;

  let cum = -Math.PI / 2;
  const slices = segments.map(sg => {
    const angle = total > 0 ? (sg.value / total) * 2 * Math.PI : 0;
    const start = cum; cum += angle; const end = cum;
    const large = angle > Math.PI ? 1 : 0;
    const x1 = CX + R * Math.cos(start), y1 = CY + R * Math.sin(start);
    const x2 = CX + R * Math.cos(end),   y2 = CY + R * Math.sin(end);
    const ix1 = CX + INNER * Math.cos(start), iy1 = CY + INNER * Math.sin(start);
    const ix2 = CX + INNER * Math.cos(end),   iy2 = CY + INNER * Math.sin(end);
    const d = [`M ${x1} ${y1}`, `A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`,
      `L ${ix2} ${iy2}`, `A ${INNER} ${INNER} 0 ${large} 0 ${ix1} ${iy1}`, 'Z'].join(' ');
    return { ...sg, d };
  });

  const handleMove = (e, sg) => {
    const rect = svgRef.current.getBoundingClientRect();
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setHovered(sg);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      {title && (
        <div className="text-center">
          <p className="text-xs font-semibold text-[#0F172A]">{title}</p>
          {subtitle && <p className="text-[10px] text-[#94A3B8] mt-0.5">{subtitle}</p>}
        </div>
      )}
      {total === 0 ? (
        <div style={{ width: size, height: size }} className="flex items-center justify-center rounded-full border-2 border-dashed border-[#E2E8F0]">
          <p className="text-[9px] text-[#94A3B8] text-center px-2">No data yet</p>
        </div>
      ) : (
        <div className="relative" style={{ width: size, height: size }}>
          <svg ref={svgRef} width={size} height={size} viewBox={`0 0 ${size} ${size}`}
            onMouseLeave={() => setHovered(null)} style={{ overflow: 'visible' }}>
            <defs>
              <filter id={`shadow-${title}`} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1" stdDeviation="3" floodOpacity="0.12" />
              </filter>
            </defs>
            {slices.map((sl) => (
              <path key={sl.label} d={sl.d} fill={sl.color}
                opacity={hovered && hovered.label !== sl.label ? 0.4 : 1}
                style={{ cursor: 'pointer', transition: 'opacity 0.15s, transform 0.1s', transformOrigin: `${CX}px ${CY}px`,
                  transform: hovered?.label === sl.label ? 'scale(1.04)' : 'scale(1)' }}
                onMouseEnter={(e) => handleMove(e, sl)}
                onMouseMove={(e) => handleMove(e, sl)} />
            ))}
            <text x={CX} y={CY - 5} textAnchor="middle" fontSize={size * 0.07} fill="#94A3B8" fontFamily="sans-serif">total</text>
            <text x={CX} y={CY + 8} textAnchor="middle" fontSize={size * 0.075} fill="#0F172A" fontWeight="700" fontFamily="sans-serif">
              {fmtRM(total)}
            </text>
            {/* Tooltip */}
            {hovered && (() => {
              const tw = 148, th = 56;
              let tx = tip.x + 12, ty = tip.y - 30;
              if (tx + tw > size + 60) tx = tip.x - tw - 8;
              if (ty < 0) ty = 4;
              return (
                <g transform={`translate(${tx},${ty})`}>
                  <rect width={tw} height={th} rx={7} fill="white" stroke="#E2E8F0" strokeWidth={1} filter={`url(#shadow-${title})`} />
                  <circle cx={10} cy={13} r={4} fill={hovered.color} />
                  <text x={18} y={17} fontSize="8.5" fill="#0F172A" fontWeight="600" fontFamily="sans-serif">{hovered.label}</text>
                  <text x={9} y={32} fontSize="8" fill="#64748B" fontFamily="sans-serif">{fmtRM(hovered.value)}</text>
                  <text x={9} y={47} fontSize="8" fill="#94A3B8" fontFamily="sans-serif">{pct(hovered.value, total)} of total</text>
                </g>
              );
            })()}
          </svg>
        </div>
      )}
      {/* Legend */}
      <div className="w-full space-y-1.5">
        {slices.map(sl => (
          <div key={sl.label} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: sl.color }} />
              <span className="truncate text-[10px] text-[#64748B]">{sl.label}</span>
            </div>
            <span className="text-[10px] font-semibold text-[#0F172A] shrink-0">{pct(sl.value, total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Persistent dual-chart sidebar (shown on all tabs) ────────────────────────
function ChartSidebar({ docs }) {
  const bizSegs  = buildBusinessSegments(docs);
  const persSegs = buildPersonalSegments(docs);
  const totalBiz  = bizSegs.reduce((s, sg) => s + sg.value, 0);
  const totalPers = persSegs.reduce((s, sg) => s + sg.value, 0);
  const pending   = docs.filter(d => d.status === 'mixed').length;

  return (
    <div className="w-56 shrink-0 flex flex-col gap-3 overflow-y-auto">
      {/* Business chart card */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
        <DonutChart segments={bizSegs} title="Business Expenses" subtitle="Company-classified items" size={130} />
        <div className="mt-3 border-t border-[#F1F5F9] pt-2.5 flex justify-between items-center">
          <span className="text-[10px] text-[#64748B]">Deductible total</span>
          <span className="text-[10px] font-bold text-[#0F6E56]">{fmtRM(totalBiz)}</span>
        </div>
      </div>
      {/* Personal chart card */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
        <DonutChart segments={persSegs} title="Personal Expenses" subtitle="Non-deductible items" size={130} />
        <div className="mt-3 border-t border-[#F1F5F9] pt-2.5 flex justify-between items-center">
          <span className="text-[10px] text-[#64748B]">Non-deductible</span>
          <span className="text-[10px] font-bold text-[#DC2626]">{fmtRM(totalPers)}</span>
        </div>
      </div>
      {/* Quick stats */}
      {pending > 0 && (
        <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-center">
          <span className="text-[10px] font-semibold text-[#B45309]">{pending} item{pending > 1 ? 's' : ''} need review</span>
          <p className="text-[9px] text-[#92400E] mt-0.5">Classify in OCR Evidence tab</p>
        </div>
      )}
    </div>
  );
}

// ─── Tab navigation ───────────────────────────────────────────────────────────
function CukaiTabNav({ active, onChange, mixedCount }) {
  const tabs = [
    { id: 'upload', label: 'Upload Documents' },
    { id: 'ocr',    label: mixedCount > 0 ? `OCR Evidence (${mixedCount})` : 'OCR Evidence' },
    { id: 'generate', label: 'Generate Report' },
  ];
  return (
    <nav className="flex items-center gap-2 border-b border-slate-100 pb-px shrink-0">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`relative px-4 py-2.5 text-sm font-medium transition-all duration-150 select-none ${
            active === t.id ? 'text-[#0D9488] font-semibold' : 'text-[#64748B] hover:text-[#0F172A]'
          }`}>
          {t.label}
          {active === t.id && <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-[#0F6E56]" />}
        </button>
      ))}
    </nav>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.mixed;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium"
      style={{ background: m.bg, color: m.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

// ─── Upload Tab ───────────────────────────────────────────────────────────────
function UploadTab({ docs, onAdd, onRemove }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback((files) => {
    const statuses = ['deductible', 'deductible', 'mixed', 'non_deductible'];
    const bizCats  = ['Service Income', 'Supplier Purchases', 'Marketing & Admin', 'Transport & Maintenance'];
    Array.from(files).forEach(file => {
      const status   = statuses[Math.floor(Math.random() * statuses.length)];
      const category = status === 'non_deductible' ? 'Personal Expense'
        : status === 'mixed' ? 'Mixed / Review'
        : bizCats[Math.floor(Math.random() * bizCats.length)];
      const amount = Math.floor(Math.random() * 5000 + 100);
      onAdd({ id: Date.now() + Math.random(), name: file.name, type: 'Uploaded',
        date: new Date().toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }),
        amount: `RM ${amount.toLocaleString()}`, status, category, note: 'AI classification — please review.' });
    });
  }, [onAdd]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Drop zone */}
      <div
        className={`shrink-0 rounded-xl border-2 border-dashed p-5 text-center transition-colors cursor-pointer ${
          dragging ? 'border-[#0D9488] bg-[#ECFDF5]' : 'border-[#CBD5E1] bg-[#F8FAFC] hover:border-[#0D9488]'
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
        <div className="mx-auto mb-2 h-9 w-9 rounded-full bg-[#ECFDF5] flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <p className="text-sm font-medium text-[#0F172A]">Drop files here or <span className="text-[#0D9488]">browse</span></p>
        <p className="mt-0.5 text-[10px] text-[#64748B]">PDF, JPG, PNG — receipts, invoices, bank statements, salary vouchers</p>
      </div>

      {/* Document list */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white">
        {docs.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="text-xs text-[#94A3B8]">No documents yet. Drop files above to begin.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#F8FAFC]">
              <tr className="border-b border-[#E2E8F0]">
                {['File', 'Amount', 'Category', 'Classification', 'Date', ''].map(h => (
                  <th key={h} className="py-2.5 px-3 first:pl-4 last:pr-4 text-left text-[10px] font-semibold text-[#64748B] last:text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((doc, i) => (
                <tr key={doc.id} className={`border-b border-[#F1F5F9] last:border-0 ${i % 2 === 0 ? '' : 'bg-[#FAFBFC]'}`}>
                  <td className="py-2.5 pl-4 pr-3">
                    <p className="font-medium text-[#0F172A] text-xs leading-tight truncate max-w-[150px]">{doc.name}</p>
                    <p className="text-[9px] text-[#94A3B8] mt-0.5">{doc.type}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs font-semibold text-[#0F172A] whitespace-nowrap">{doc.amount}</td>
                  <td className="px-3 py-2.5 text-[10px] text-[#334155] max-w-[100px] truncate">{doc.category}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={doc.status} /></td>
                  <td className="px-3 py-2.5 text-[10px] text-[#64748B] whitespace-nowrap">{doc.date}</td>
                  <td className="py-2.5 pr-4 text-right">
                    <button onClick={() => onRemove(doc.id)} className="text-[#CBD5E1] hover:text-[#DC2626] transition-colors" title="Remove">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Reclassify modal ─────────────────────────────────────────────────────────
function ReclassifyModal({ doc, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#E2E8F0] w-[420px] p-6 mx-4" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-bold text-[#0F172A]">Classify this expense</p>
          <button onClick={onCancel} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-[#64748B] mb-4 truncate">{doc.name} · {doc.amount}</p>
        <p className="text-xs text-[#334155] mb-1 font-medium">AI note:</p>
        <p className="text-[10px] text-[#64748B] italic mb-5 leading-relaxed bg-[#F8FAFC] rounded-lg px-3 py-2 border border-[#F1F5F9]">{doc.note}</p>
        <p className="text-xs font-semibold text-[#0F172A] mb-3">Was this a company or personal expense?</p>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => onConfirm('deductible')}
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-[#0F6E56] bg-[#ECFDF5] p-4 hover:bg-[#D1FAE5] transition-colors">
            <div className="h-10 w-10 rounded-full bg-[#0F6E56] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
              </svg>
            </div>
            <p className="text-xs font-bold text-[#0F6E56]">Company Expense</p>
            <p className="text-[9px] text-[#047857] text-center leading-tight">Business-related, can be claimed as a deductible expense</p>
          </button>
          <button onClick={() => onConfirm('non_deductible')}
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-[#DC2626] bg-[#FEF2F2] p-4 hover:bg-[#FEE2E2] transition-colors">
            <div className="h-10 w-10 rounded-full bg-[#DC2626] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <p className="text-xs font-bold text-[#DC2626]">Personal Expense</p>
            <p className="text-[9px] text-[#991B1B] text-center leading-tight">Not business-related, cannot be claimed as deductible</p>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── OCR Evidence Tab ─────────────────────────────────────────────────────────
function OcrTab({ docs, onUpdateStatus }) {
  const [filter, setFilter]     = useState('all');
  const [reclassDoc, setReclassDoc] = useState(null);
  const mixed    = docs.filter(d => d.status === 'mixed');
  const filtered = filter === 'all' ? docs : docs.filter(d => d.status === filter);

  const handleConfirm = (status) => {
    onUpdateStatus(reclassDoc.id, status);
    setReclassDoc(null);
  };

  return (
    <>
      {reclassDoc && <ReclassifyModal doc={reclassDoc} onConfirm={handleConfirm} onCancel={() => setReclassDoc(null)} />}
      <div className="flex h-full min-h-0 flex-col gap-3">
        {/* Filter chips */}
        <div className="shrink-0 flex items-center gap-2 flex-wrap">
          {[
            { id: 'all', label: 'All' },
            { id: 'mixed', label: `Needs Review${mixed.length ? ` (${mixed.length})` : ''}` },
            { id: 'deductible', label: 'Company Expense' },
            { id: 'non_deductible', label: 'Personal Expense' },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1 text-[10px] font-medium transition-colors ${
                filter === f.id ? 'bg-[#0F6E56] text-white' : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'
              }`}>{f.label}</button>
          ))}
        </div>

        {/* Review banner */}
        {mixed.length > 0 && (
          <div className="shrink-0 flex items-start gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3">
            <svg className="mt-0.5 shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div>
              <p className="text-xs font-semibold text-[#B45309]">{mixed.length} item{mixed.length > 1 ? 's' : ''} need your review</p>
              <p className="text-[10px] text-[#92400E] mt-0.5">Classify each as a company or personal expense to complete your tax picture.</p>
            </div>
          </div>
        )}

        {/* Cards */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          {filtered.length === 0 && (
            <div className="flex h-24 items-center justify-center">
              <p className="text-xs text-[#94A3B8]">No documents in this category.</p>
            </div>
          )}
          {filtered.map(doc => (
            <div key={doc.id}
              className={`rounded-xl border p-4 transition-colors ${doc.status === 'mixed' ? 'border-[#FDE68A] bg-[#FFFBEB]' : 'border-[#E2E8F0] bg-white'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-xs font-semibold text-[#0F172A] truncate">{doc.name}</p>
                    <StatusBadge status={doc.status} />
                  </div>
                  <p className="text-[10px] text-[#64748B] italic mb-1.5 leading-relaxed">{doc.note}</p>
                  <div className="flex items-center gap-2.5 text-[9px] text-[#94A3B8] flex-wrap">
                    <span>{doc.type}</span><span>·</span>
                    <span className="font-semibold text-[#0F172A]">{doc.amount}</span><span>·</span>
                    <span>{doc.date}</span><span>·</span>
                    <span className="font-medium text-[#64748B]">{doc.category}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5 items-end">
                  {doc.status === 'mixed' ? (
                    <>
                      <button onClick={() => onUpdateStatus(doc.id, 'deductible')}
                        className="rounded-lg border border-[#0F6E56] bg-white px-3 py-1 text-[10px] font-semibold text-[#0F6E56] hover:bg-[#ECFDF5] transition-colors whitespace-nowrap">
                        ✓ Company
                      </button>
                      <button onClick={() => onUpdateStatus(doc.id, 'non_deductible')}
                        className="rounded-lg border border-[#DC2626] bg-white px-3 py-1 text-[10px] font-semibold text-[#DC2626] hover:bg-[#FEF2F2] transition-colors whitespace-nowrap">
                        ✗ Personal
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setReclassDoc(doc)}
                      className="text-[9px] text-[#94A3B8] hover:text-[#0D9488] underline transition-colors whitespace-nowrap">
                      Re-classify
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── PDF Preview slide-over ───────────────────────────────────────────────────
function PdfPreview({ formId, formData, sc, onClose }) {
  const [zoom, setZoom] = useState(100);
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 300); };

  const { deductibleTotal, nonDeductibleTotal, reviewTotal, totalIncome, chargeableIncome,
    taxCharged, lessInstalment, taxPayable } = formData;

  return (
    <div className="fixed inset-0 z-50 flex" onClick={handleClose}>
      {/* Backdrop */}
      <div className={`flex-1 bg-black/40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />
      {/* Slide-over panel */}
      <div
        className={`relative flex h-full w-[680px] max-w-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={e => e.stopPropagation()}>
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3 bg-[#F8FAFC] shrink-0">
          <div>
            <p className="text-sm font-bold text-[#0F172A]">
              Form {formId} Preview — {formId === 'B' ? 'YA 2025 Personal Return' : `${sc.firm?.name || 'Partnership'} Return`}
            </p>
            <p className="text-[10px] text-[#64748B] mt-0.5">This is a pre-filled draft for your reference. Verify all values before submitting to LHDN.</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Zoom controls */}
            <div className="flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2 py-1">
              <button onClick={() => setZoom(z => Math.max(60, z - 10))}
                className="text-[#64748B] hover:text-[#0F172A] px-1 text-sm font-bold">−</button>
              <span className="text-[10px] text-[#64748B] w-8 text-center">{zoom}%</span>
              <button onClick={() => setZoom(z => Math.min(150, z + 10))}
                className="text-[#64748B] hover:text-[#0F172A] px-1 text-sm font-bold">+</button>
            </div>
            <button
              className="flex items-center gap-1.5 rounded-lg bg-[#0F6E56] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0A5140] transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export PDF
            </button>
            <button onClick={handleClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors ml-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable preview area */}
        <div className="flex-1 overflow-y-auto bg-[#E8EBEF] p-6">
          <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', transition: 'transform 0.2s' }}>
            {/* A4-ish mock form sheet */}
            <div className="bg-white mx-auto shadow-xl rounded-lg overflow-hidden" style={{ width: 580 }}>
              {/* LHDN Header */}
              <div className="bg-[#0F6E56] px-6 py-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center text-white font-black text-lg">L</div>
                <div>
                  <p className="text-white font-bold text-sm">LEMBAGA HASIL DALAM NEGERI MALAYSIA</p>
                  <p className="text-white/80 text-[10px]">
                    {formId === 'B' ? 'RETURN FORM OF AN INDIVIDUAL (RESIDENT WHO CARRIES ON BUSINESS)' : 'RETURN FORM OF PARTNERSHIP'}
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-white/60 text-[9px]">FORM</p>
                  <p className="text-white font-black text-2xl leading-none">{formId}</p>
                  <p className="text-white/80 text-[9px] mt-0.5">YA 2025</p>
                </div>
              </div>

              <div className="px-6 py-5 space-y-5 text-[11px]">
                {formId === 'B' ? (
                  <>
                    {/* Basic Particulars */}
                    <PreviewSection title="BASIC PARTICULARS">
                      <PreviewField label="1  Name" value="Aisyah binti Ahmad" />
                      <PreviewField label="2  Tax Identification No. (TIN)" value="SG 12345678901" />
                      <PreviewField label="3  Identification No." value="900101-14-5678" />
                      <PreviewField label="4  Correspondence address" value="No. 12, Jalan Damai 3, 50450 Kuala Lumpur" />
                    </PreviewSection>

                    {/* Part A */}
                    <PreviewSection title="PART A — PARTICULARS OF INDIVIDUAL">
                      <PreviewField label="A1  Citizen" value="MYS" /><PreviewField label="A2  Gender" value="Female" />
                      <PreviewField label="A3  Date of birth" value="01/01/1990" /><PreviewField label="A4  Status" value="Married" />
                      <PreviewField label="A6  Record-keeping" value="Yes" /><PreviewField label="A7  Type of assessment" value="3 – Separate" />
                    </PreviewSection>

                    {/* Part B */}
                    <PreviewSection title="PART B — COMPUTATION OF INCOME TAX">
                      <PreviewField label="B1   Statutory income from businesses in Malaysia" value={fmtRM(deductibleTotal)} highlight />
                      <PreviewField label="B2   Statutory income from partnerships in Malaysia" value="RM 235,000" highlight />
                      <PreviewField label="B4   Aggregate statutory income from businesses" value={fmtRM(deductibleTotal + 235000)} />
                      <PreviewField label="B7   Statutory income from employment" value="—" />
                      <PreviewField label="B8   Statutory income from rents" value="—" />
                      <PreviewField label="B11  AGGREGATE INCOME" value={fmtRM(totalIncome)} bold />
                      <PreviewField label="B17  Less: Approved donations / gifts" value="—" />
                      <PreviewField label="B20  TOTAL INCOME [SELF]" value={fmtRM(totalIncome)} bold />
                      <PreviewField label="B23  Total Relief" value="RM 18,000" />
                      <PreviewField label="B24  CHARGEABLE INCOME" value={fmtRM(chargeableIncome)} highlight bold />
                      <PreviewField label="B26  Total Income Tax" value={fmtRM(taxCharged)} />
                      <PreviewField label="B27  Less: Rebates (self)" value="RM 400" />
                      <PreviewField label="B28  TOTAL TAX CHARGED" value={fmtRM(Math.max(0, taxCharged - 400))} bold />
                      <PreviewField label="B33  Less: CP500 instalments paid" value={fmtRM(lessInstalment)} />
                      <PreviewField label="B34  BALANCE TAX PAYABLE" value={fmtRM(taxPayable)} highlight bold />
                    </PreviewSection>

                    {/* Part H */}
                    <PreviewSection title="PART H — RELIEF">
                      <PreviewField label="H1   Individual and dependent relatives" value="RM 9,000" />
                      <PreviewField label="H2   Expenses for parents" value="—" />
                      <PreviewField label="H5   Education fees (Self)" value="—" />
                      <PreviewField label="H6   Medical expenses (serious diseases)" value="—" />
                      <PreviewField label="H9   Lifestyle (books, internet, devices)" value="—" />
                      <PreviewField label="H13  SSPN net deposit" value="—" />
                      <PreviewField label="H14  Husband / wife" value="—" />
                      <PreviewField label="H16  Child relief" value="—" />
                      <PreviewField label="H17  Life insurance and EPF" value="RM 7,000" />
                      <PreviewField label="H18  Private retirement scheme" value="—" />
                      <PreviewField label="H19  Education and medical insurance" value="RM 2,000" />
                      <PreviewField label="H20  SOCSO contribution" value="—" />
                      <PreviewField label="H22  TOTAL RELIEF" value="RM 18,000" bold highlight />
                    </PreviewSection>

                    {/* Part N — Financial Particulars */}
                    <PreviewSection title="PART N — FINANCIAL PARTICULARS (MAIN BUSINESS)">
                      <PreviewField label="N1   Name of business" value="Meridian Print Studio (Sole Prop)" />
                      <PreviewField label="N2   Business code (MSIC)" value="1811" />
                      <PreviewField label="N3   Sales or turnover" value={fmtRM(deductibleTotal + 12000)} />
                      <PreviewField label="N7   Cost of sales" value="—" />
                      <PreviewField label="N8   Gross Profit / Loss" value={fmtRM(deductibleTotal + 12000)} />
                      <PreviewField label="N14  Total other income" value="—" />
                      <PreviewField label="N15  Loan interest" value="—" />
                      <PreviewField label="N16  Salaries and wages" value={fmtRM(14500)} />
                      <PreviewField label="N17  Rental / lease" value={fmtRM(1240)} />
                      <PreviewField label="N22  Repairs and maintenance" value="—" />
                      <PreviewField label="N23  Promotion and advertisement" value={fmtRM(3200)} />
                      <PreviewField label="N25  TOTAL EXPENDITURE" value={fmtRM(deductibleTotal)} bold />
                      <PreviewField label="N26  NET PROFIT / LOSS" value={fmtRM(deductibleTotal + 12000 - deductibleTotal)} bold highlight />
                      <PreviewField label="N27  Non-allowable expenses" value={fmtRM(nonDeductibleTotal)} />
                    </PreviewSection>

                    {reviewTotal > 0 && (
                      <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3">
                        <p className="text-[10px] font-semibold text-[#B45309]">⚠ {fmtRM(reviewTotal)} in expenses are still under review</p>
                        <p className="text-[9px] text-[#92400E] mt-0.5">Classify all mixed items in the OCR Evidence tab before final submission to LHDN.</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Form P */}
                    <PreviewSection title="PARTNERSHIP DETAILS">
                      <PreviewField label="1   Name of partnership" value="Meridian Print Studio" />
                      <PreviewField label="2   Income tax no." value="D 1234567890" />
                      <PreviewField label="3   Reference no. (Reg no.)" value="ROB/2020/001234" />
                      <PreviewField label="4   Number of partners" value="3" />
                      <PreviewField label="5   Basis of apportionment" value="Profit-sharing ratio" />
                      <PreviewField label="6   Record-keeping" value="Yes" />
                    </PreviewSection>

                    <PreviewSection title="PART A — BUSINESS INCOME">
                      <PreviewField label="A1  Business code (MSIC)" value="1811 — Printing of newspapers" />
                      <PreviewField label="A2  Divisible income / loss" value="RM 450,000" highlight bold />
                      <PreviewField label="A3  Partners' benefits (salaries + interest)" value="RM 160,000" />
                      <PreviewField label="A4  Balancing charge" value="—" />
                      <PreviewField label="A5  Balancing allowance and capital allowance" value="RM 60,000" />
                    </PreviewSection>

                    <PreviewSection title="PART F — PARTICULARS OF PARTNERSHIP">
                      <PreviewField label="F1  Registered address" value="No. 12, Jalan Damai 3, 50450 Kuala Lumpur" />
                      <PreviewField label="F2  Main business address" value="Lot 5, Jalan Industri 2, Shah Alam" />
                      <PreviewField label="F5  Employer's no." value="E 1234567890" />
                      <PreviewField label="F6  Precedent partner's name" value="Aisyah binti Ahmad" />
                      <PreviewField label="F7  Telephone no." value="03-1234 5678" />
                    </PreviewSection>

                    <PreviewSection title="PART G — PARTICULARS OF PARTNERS">
                      <div className="bg-[#F8FAFC] rounded-lg overflow-hidden border border-[#F1F5F9]">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="bg-[#F1F5F9]">
                              {['Partner', 'ID No.', 'Share', 'Salary', 'Profit Share', 'Total Allocated'].map(h => (
                                <th key={h} className="px-2 py-1.5 text-left text-[9px] font-semibold text-[#64748B]">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { name: 'Aisyah', id: '900101-14-5678', share: '50%', salary: 'RM 60,000', profit: 'RM 175,000', total: 'RM 235,000' },
                              { name: 'Bopha', id: '880212-10-3456', share: '30%', salary: 'RM 40,000', profit: 'RM 105,000', total: 'RM 145,000' },
                              { name: 'Chong', id: '910330-08-7890', share: '20%', salary: '—', profit: 'RM 70,000', total: 'RM 70,000' },
                            ].map((p, i) => (
                              <tr key={p.name} className={i % 2 === 0 ? '' : 'bg-[#FAFBFC]'}>
                                <td className="px-2 py-1.5 font-semibold text-[#0F172A]">{p.name}</td>
                                <td className="px-2 py-1.5 text-[#64748B]">{p.id}</td>
                                <td className="px-2 py-1.5">{p.share}</td>
                                <td className="px-2 py-1.5">{p.salary}</td>
                                <td className="px-2 py-1.5">{p.profit}</td>
                                <td className="px-2 py-1.5 font-semibold text-[#0F6E56]">{p.total}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </PreviewSection>

                    <PreviewSection title="PART H — FINANCIAL PARTICULARS">
                      <PreviewField label="H2   Sales or turnover" value="RM 920,000" bold />
                      <PreviewField label="H3   Opening stock" value="—" />
                      <PreviewField label="H4   Purchases and cost of production" value="RM 310,000" />
                      <PreviewField label="H6   Cost of sales" value="RM 310,000" />
                      <PreviewField label="H7   GROSS PROFIT" value="RM 610,000" bold />
                      <PreviewField label="H14  Loan interest" value="—" />
                      <PreviewField label="H15  Salaries and wages" value="RM 100,000" />
                      <PreviewField label="H16  Rental / lease" value="RM 24,000" />
                      <PreviewField label="H22  Other expenses" value="RM 36,000" />
                      <PreviewField label="H24  TOTAL EXPENDITURE" value="RM 160,000" bold />
                      <PreviewField label="H25  NET PROFIT" value="RM 450,000" bold highlight />
                    </PreviewSection>

                    {!sc.canFileFormP && (
                      <div className="rounded-lg border border-[#E0E7FF] bg-[#EEF2FF] px-4 py-3">
                        <p className="text-[10px] font-semibold text-[#4338CA]">View only — submission by Aisyah (Principal Partner)</p>
                        <p className="text-[9px] text-[#4338CA]/80 mt-0.5">You can review this form but only the principal partner can submit Form P to LHDN.</p>
                      </div>
                    )}
                  </>
                )}

                {/* Footer */}
                <div className="border-t border-[#E2E8F0] pt-4 text-[9px] text-[#94A3B8] text-center">
                  <p>This is a cukai.ai pre-filled draft — for reference only. File via mytax.hasil.gov.my · Due: 30 Jun 2025</p>
                  <p className="mt-0.5">Contact Hasil Care Line: 03-8911 1000 (Local) / 603-8911 1000 (Overseas)</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewSection({ title, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="h-px flex-1 bg-[#E2E8F0]" />
        <p className="text-[9px] font-bold uppercase tracking-widest text-[#64748B] shrink-0">{title}</p>
        <div className="h-px flex-1 bg-[#E2E8F0]" />
      </div>
      <div className="rounded-lg overflow-hidden border border-[#F1F5F9] divide-y divide-[#F1F5F9]">
        {children}
      </div>
    </div>
  );
}

function PreviewField({ label, value, highlight, bold }) {
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 ${highlight ? 'bg-[#F0FDF4]' : ''}`}>
      <span className={`text-[10px] ${bold ? 'font-semibold text-[#0F172A]' : 'text-[#64748B]'}`}>{label}</span>
      <span className={`text-[10px] ml-4 text-right ${bold ? 'font-bold' : 'font-medium'} ${highlight ? 'text-[#0F6E56]' : 'text-[#0F172A]'}`}>{value}</span>
    </div>
  );
}

// ─── Generate Report Tab ──────────────────────────────────────────────────────
function GenerateTab({ docs, scenario }) {
  const [selectedForm, setSelectedForm] = useState(null);
  const [activeScenario, setActiveScenario] = useState(scenario);
  const [showPreview, setShowPreview] = useState(false);
  const sc = USER_SCENARIOS[activeScenario];

  const deductibleTotal    = docs.filter(d => d.status === 'deductible').reduce((s, d) => s + parseAmt(d.amount), 0);
  const nonDeductibleTotal = docs.filter(d => d.status === 'non_deductible').reduce((s, d) => s + parseAmt(d.amount), 0);
  const reviewTotal        = docs.filter(d => d.status === 'mixed').reduce((s, d) => s + parseAmt(d.amount), 0);
  const partnerShare       = sc.firm ? 235000 : 0;
  const totalIncome        = deductibleTotal + partnerShare;
  const chargeableIncome   = Math.max(0, totalIncome - 18000);

  // Simple progressive tax calc (Malaysia 2024 rates)
  const calcTax = (ci) => {
    const bands = [
      [5000, 0], [15000, 0.01], [15000, 0.03], [15000, 0.06],
      [20000, 0.11], [30000, 0.19], [150000, 0.25], [Infinity, 0.26],
    ];
    let tax = 0, rem = ci;
    for (const [band, rate] of bands) {
      if (rem <= 0) break;
      const taxable = Math.min(rem, band);
      tax += taxable * rate;
      rem -= taxable;
    }
    return Math.round(tax);
  };
  const taxCharged     = calcTax(chargeableIncome);
  const lessInstalment = Math.round(taxCharged * 0.7);
  const taxPayable     = Math.max(0, taxCharged - 400 - lessInstalment);

  const formData = { deductibleTotal, nonDeductibleTotal, reviewTotal, totalIncome,
    chargeableIncome, taxCharged, lessInstalment, taxPayable };

  const forms = [
    sc.canFileFormB && { id: 'B', title: 'Form B', subtitle: 'Personal income tax — resident who carries on business', tag: 'YA 2025', canGenerate: true, readOnly: false },
    (sc.canViewFormP || sc.canFileFormP) && { id: 'P', title: 'Form P', subtitle: sc.firm ? `${sc.firm.name} · Partnership Return` : 'Partnership Return', tag: sc.firm ? `MSIC ${sc.firm.msic}` : 'Partnership', canGenerate: sc.canFileFormP, readOnly: !sc.canFileFormP },
  ].filter(Boolean);

  return (
    <>
      {showPreview && selectedForm && (
        <PdfPreview formId={selectedForm} formData={formData} sc={sc} onClose={() => setShowPreview(false)} />
      )}
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        {/* Scenario switcher */}
        <div className="shrink-0 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-[#0F172A]">{sc.label}</p>
              <p className="text-[10px] text-[#64748B] mt-0.5">{sc.description}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(USER_SCENARIOS).map(([k, v]) => (
                <button key={k} onClick={() => { setActiveScenario(k); setSelectedForm(null); }}
                  className={`rounded-full px-3 py-1 text-[10px] font-medium transition-colors ${
                    activeScenario === k ? 'bg-[#0F6E56] text-white' : 'bg-white border border-[#E2E8F0] text-[#64748B] hover:border-[#0D9488]'
                  }`}>{v.label}</button>
              ))}
            </div>
          </div>
          {sc.firm && (
            <div className="mt-3 flex items-center gap-3 flex-wrap border-t border-[#E2E8F0] pt-3">
              <span className="text-[10px] text-[#64748B]">Firm: <span className="font-semibold text-[#0F172A]">{sc.firm.name}</span></span>
              <span className="text-[10px] text-[#64748B]">Share: <span className="font-semibold text-[#0F172A]">{sc.firm.share}</span></span>
              {sc.canFileFormP
                ? <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-semibold text-[#0F6E56]">Principal Partner</span>
                : <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#64748B]">Partner</span>}
            </div>
          )}
        </div>

        {/* Filing summary stats */}
        <div className="shrink-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total Income', value: fmtRM(totalIncome), color: '#0F6E56' },
            { label: 'Deductible Expenses', value: fmtRM(deductibleTotal), color: '#0D9488' },
            { label: 'Chargeable Income', value: fmtRM(chargeableIncome), color: '#0F172A' },
            { label: 'Est. Tax Payable', value: fmtRM(taxPayable), color: '#B45309' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-[#E2E8F0] bg-white p-3">
              <p className="text-[10px] text-[#64748B]">{label}</p>
              <p className="text-sm font-bold mt-1" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Form cards */}
        <div className="shrink-0 grid gap-3 sm:grid-cols-2">
          {forms.map(form => (
            <button key={form.id} onClick={() => setSelectedForm(form.id)}
              className={`text-left rounded-xl border-2 p-4 transition-all ${
                selectedForm === form.id ? 'border-[#0D9488] bg-[#ECFDF5] shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-[#0D9488]'
              } ${form.readOnly ? 'opacity-75' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="h-10 w-10 rounded-xl bg-[#0F6E56] flex items-center justify-center">
                  <span className="text-base font-black text-white">{form.id}</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[9px] font-medium text-[#64748B]">{form.tag}</span>
                  {form.readOnly && <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[9px] font-medium text-[#B45309]">View Only</span>}
                </div>
              </div>
              <p className="text-xs font-bold text-[#0F172A]">{form.title}</p>
              <p className="text-[10px] text-[#64748B] mt-0.5 leading-tight">{form.subtitle}</p>
              {!form.readOnly
                ? <p className="mt-2 text-[10px] text-[#0D9488] font-medium">Click to prepare →</p>
                : <p className="mt-2 text-[10px] text-[#B45309]">Principal partner files this form.</p>}
            </button>
          ))}
        </div>

        {/* Form summary + actions */}
        {selectedForm && (() => {
          const form = forms.find(f => f.id === selectedForm);
          return (
            <div className="shrink-0 rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <div>
                  <p className="text-xs font-semibold text-[#0F172A]">
                    Form {selectedForm} — {selectedForm === 'B' ? 'Personal Return YA 2025' : `${sc.firm?.name || 'Partnership'} Return YA 2025`}
                  </p>
                  <p className="text-[10px] text-[#64748B] mt-0.5">Auto-populated from uploaded documents · Verify before submitting to LHDN</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowPreview(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-[#0F6E56] bg-white px-3 py-2 text-xs font-semibold text-[#0F6E56] hover:bg-[#ECFDF5] transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                    Preview
                  </button>
                  {!form?.readOnly && (
                    <button onClick={() => setShowPreview(true)}
                      className="flex items-center gap-1.5 rounded-lg bg-[#0F6E56] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0A5140] transition-colors">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      Export PDF
                    </button>
                  )}
                </div>
              </div>

              {/* Compact inline summary of key values */}
              <div className="px-5 py-4 space-y-4">
                {selectedForm === 'B' ? (
                  <>
                    <InlineSummary title="Part B — Income Computation">
                      <SRow label="B1  Business income (sole prop / expense deductions)" value={fmtRM(deductibleTotal)} />
                      <SRow label="B2  Partnership income (Meridian Print Studio)" value={sc.firm ? 'RM 235,000' : '—'} />
                      <SRow label="B4  Aggregate business income" value={fmtRM(deductibleTotal + (sc.firm ? 235000 : 0))} />
                      <SRow label="B11 Aggregate income" value={fmtRM(totalIncome)} bold />
                      <SRow label="B17 Less: Donations / gifts" value="—" />
                      <SRow label="B23 Total relief" value="RM 18,000" />
                      <SRow label="B24 Chargeable income" value={fmtRM(chargeableIncome)} bold highlight />
                      <SRow label="B26 Total income tax" value={fmtRM(taxCharged)} />
                      <SRow label="B28 Tax charged (after rebate RM 400)" value={fmtRM(Math.max(0, taxCharged - 400))} bold />
                      <SRow label="B33 Less: CP500 instalments" value={fmtRM(lessInstalment)} />
                      <SRow label="B34 Balance tax payable" value={fmtRM(taxPayable)} bold highlight />
                    </InlineSummary>
                    <InlineSummary title="Part H — Relief Breakdown">
                      <SRow label="H1  Individual & dependent relatives" value="RM 9,000" />
                      <SRow label="H17 Life insurance & EPF" value="RM 7,000" />
                      <SRow label="H19 Education & medical insurance" value="RM 2,000" />
                      <SRow label="H22 TOTAL RELIEF" value="RM 18,000" bold highlight />
                    </InlineSummary>
                    <InlineSummary title="Part N — Business Financial Particulars">
                      <SRow label="N3  Sales / turnover (estimated)" value={fmtRM(deductibleTotal + 12000)} />
                      <SRow label="N16 Salaries and wages" value="RM 14,500" />
                      <SRow label="N17 Rental / lease" value="RM 1,240" />
                      <SRow label="N23 Marketing and promotion" value="RM 3,200" />
                      <SRow label="N25 Total expenditure" value={fmtRM(deductibleTotal)} bold />
                      <SRow label="N27 Non-allowable (personal) expenses" value={fmtRM(nonDeductibleTotal)} />
                    </InlineSummary>
                    {reviewTotal > 0 && (
                      <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3">
                        <p className="text-[10px] font-semibold text-[#B45309]">⚠ {fmtRM(reviewTotal)} still under review</p>
                        <p className="text-[9px] text-[#92400E] mt-0.5">Classify remaining items in the OCR Evidence tab before filing.</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <InlineSummary title="Part A — Business Income (Partnership)">
                      <SRow label="A1  Business code (MSIC)" value="1811" />
                      <SRow label="A2  Divisible income" value="RM 450,000" bold highlight />
                      <SRow label="A3  Partners' benefits (salaries + interest)" value="RM 160,000" />
                      <SRow label="A5  Capital allowances" value="RM 60,000" />
                    </InlineSummary>
                    <InlineSummary title="Part G — Partner Profit Allocation">
                      <SRow label="Aisyah (YOU) · 50% · Salary RM 60,000" value="Total RM 235,000" bold highlight />
                      <SRow label="Bopha · 30% · Salary RM 40,000" value="Total RM 145,000" />
                      <SRow label="Chong · 20% · No salary" value="Total RM 70,000" />
                    </InlineSummary>
                    <InlineSummary title="Part H — Financial Particulars">
                      <SRow label="H2  Revenue" value="RM 920,000" />
                      <SRow label="H6  Cost of sales" value="RM 310,000" />
                      <SRow label="H7  Gross profit" value="RM 610,000" bold />
                      <SRow label="H15 Salaries and wages" value="RM 100,000" />
                      <SRow label="H16 Rental" value="RM 24,000" />
                      <SRow label="H24 Total expenditure" value="RM 160,000" bold />
                      <SRow label="H25 NET PROFIT (divisible income)" value="RM 450,000" bold highlight />
                    </InlineSummary>
                    {!sc.canFileFormP && (
                      <div className="rounded-lg border border-[#E0E7FF] bg-[#EEF2FF] p-3">
                        <p className="text-[10px] text-[#4338CA] font-semibold">You can view but cannot submit Form P.</p>
                        <p className="text-[9px] text-[#4338CA]/80 mt-0.5">Only Aisyah (principal partner) can file this form with LHDN.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}

function InlineSummary({ title, children }) {
  return (
    <div>
      <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#94A3B8]">{title}</p>
      <div className="rounded-lg border border-[#F1F5F9] divide-y divide-[#F1F5F9] overflow-hidden">
        {children}
      </div>
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

// ─── Root ─────────────────────────────────────────────────────────────────────
function CukaiAccount() {
  const [tab, setTab]   = useState('upload');
  const [docs, setDocs] = useState(INITIAL_DOCS);
  const [userScenario]  = useState('B');

  const addDoc = useCallback((doc) => setDocs(prev => [doc, ...prev]), []);
  const removeDoc = useCallback((id) => setDocs(prev => prev.filter(d => d.id !== id)), []);
  const updateDocStatus = useCallback((id, status) => {
    setDocs(prev => prev.map(d =>
      d.id !== id ? d : {
        ...d, status,
        category: status === 'non_deductible' ? 'Personal Expense'
          : status === 'mixed' ? 'Mixed / Review'
          : (d.category === 'Personal Expense' || d.category === 'Mixed / Review') ? 'Supplier Purchases'
          : d.category,
      }
    ));
  }, []);

  const mixedCount = docs.filter(d => d.status === 'mixed').length;

  return (
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body flex flex-col">
      <div className="mx-auto w-full max-w-7xl px-6 py-4 flex flex-col flex-1 min-h-0 gap-3">

        {/* Header */}
        <div className="shrink-0 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Tax Documents</h1>
            <p className="text-xs text-[#64748B] mt-1">Upload receipts, classify expenses, and generate your tax return draft.</p>
          </div>
          {mixedCount > 0 && (
            <button onClick={() => setTab('ocr')}
              className="shrink-0 flex items-center gap-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs font-semibold text-[#B45309] hover:bg-[#FEF3C7] transition-colors">
              <span className="h-2 w-2 rounded-full bg-[#F59E0B] animate-pulse" />
              {mixedCount} item{mixedCount > 1 ? 's' : ''} need review
            </button>
          )}
        </div>

        {/* Tab nav */}
        <CukaiTabNav active={tab} onChange={setTab} mixedCount={mixedCount} />

        {/* Body: tab content + persistent chart sidebar */}
        <div className="flex flex-1 min-h-0 gap-5">
          {/* Main content */}
          <div className="flex-1 min-w-0 min-h-0">
            {tab === 'upload'   && <UploadTab docs={docs} onAdd={addDoc} onRemove={removeDoc} />}
            {tab === 'ocr'      && <OcrTab docs={docs} onUpdateStatus={updateDocStatus} />}
            {tab === 'generate' && <GenerateTab docs={docs} scenario={userScenario} />}
          </div>
          {/* Persistent dual-chart sidebar */}
          <ChartSidebar docs={docs} />
        </div>

      </div>
    </main>
  );
}

export default CukaiAccount;