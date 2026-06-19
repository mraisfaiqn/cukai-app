import { useState } from 'react';

// ── Icons ─────────────────────────────────────────────────────────────────────
const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CodeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
  </svg>
);

const FileTextIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const LayersIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const ZapIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const HelpCircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ── Documentation Data ─────────────────────────────────────────────────────────

const DOC_SECTIONS = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    icon: <ZapIcon />,
    items: [
      {
        id: 'overview',
        title: 'Platform Overview',
        badge: null,
        content: {
          description: 'Fiscal Clarity AI is a Malaysian SME-focused tax co-pilot that helps you manage tax filings, generate reports, review documents with OCR, and get AI-powered guidance — all in one platform.',
          sections: [
            {
              heading: 'Core Modules',
              type: 'list',
              items: [
                { label: 'CukaiBot', desc: 'AI-powered chat assistant for Malaysian tax regulations, LHDN guidelines, and deduction advice.' },
                { label: 'CukaiVault', desc: 'SME report management hub for generating, storing, reviewing, and exporting tax and business reports.' },
                { label: 'AI Insights Inbox', desc: 'Timestamped feed of AI-generated alerts, deduction opportunities, compliance reminders, and advisories.' },
              ],
            },
            {
              heading: 'Who This Is For',
              type: 'paragraph',
              text: 'Malaysian SMEs, sole proprietors, and finance teams who want a guided, structured approach to annual tax filing under the Income Tax Act 1967 and current LHDN guidelines.',
            },
          ],
        },
      },
      {
        id: 'navigation',
        title: 'Navigating the App',
        badge: null,
        content: {
          description: 'The sidebar provides access to all modules. You can switch between CukaiBot, CukaiVault, AI Insights, and your account settings at any time.',
          sections: [
            {
              heading: 'Sidebar Items',
              type: 'list',
              items: [
                { label: 'Dashboard', desc: 'Overview of your filing progress, pending actions, and recent insights.' },
                { label: 'CukaiBot', desc: 'AI chat interface for tax questions.' },
                { label: 'CukaiVault', desc: 'Reports, receipts, OCR evidence, and source documents.' },
                { label: 'AI Insights Inbox', desc: 'All AI-generated notifications and advisories.' },
                { label: 'User Docs', desc: 'This documentation page.' },
                { label: 'Terms & Conditions', desc: 'Platform usage terms and AI disclaimer.' },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'cukai-vault',
    label: 'CukaiVault',
    icon: <LayersIcon />,
    items: [
      {
        id: 'vault-overview',
        title: 'CukaiVault Overview',
        badge: 'Module',
        content: {
          description: 'CukaiVault is the SME report management centre. It organises all tax and business reports, linked receipts, OCR evidence, and source documents in one place.',
          sections: [
            {
              heading: 'Five Main Tabs',
              type: 'list',
              items: [
                { label: 'Reports', desc: 'View, search, filter, rename, archive, and delete your SME tax reports. Includes a Tax Breakdown chart and key financial figures.' },
                { label: 'Generate Report', desc: 'Create new reports by selecting report type, tax year, and included sections.' },
                { label: 'Linked Supporting Receipts', desc: 'Manage receipts, invoices, and bills that support deductible expense claims.' },
                { label: 'OCR Evidence', desc: 'Review AI-extracted data from scanned documents — confidence scores, missing fields, and verification status.' },
                { label: 'Source Documents', desc: 'Store and manage audit-trail files such as bank statements, e-invoice records, payroll summaries, and agreements.' },
              ],
            },
          ],
        },
      },
      {
        id: 'reports-tab',
        title: 'Reports Tab',
        badge: null,
        content: {
          description: 'The Reports tab is the main report management area. It shows your SME Tax Breakdown chart, key financial values, and a filterable report table.',
          sections: [
            {
              heading: 'Report Table Columns',
              type: 'list',
              items: [
                { label: 'Report Name', desc: 'Editable from the column. Click the edit icon to rename.' },
                { label: 'Total Amount', desc: 'Total reported income or transaction value for the report period.' },
                { label: 'Deductible Amount', desc: 'Portion of expenses that qualify as tax-deductible under ITA 1967.' },
                { label: 'Overall Deductible Tax', desc: 'Estimated deductible tax value — AI-assisted, for review only.' },
                { label: 'Estimated Tax Impact', desc: 'Projected tax saving or liability — not a final tax calculation.' },
                { label: 'Status', desc: 'Ready, Draft, Under Review, or Archived.' },
              ],
            },
            {
              heading: 'Report Actions',
              type: 'list',
              items: [
                { label: 'View', desc: 'Opens a detailed report preview modal.' },
                { label: 'Rename', desc: 'Edit the report name inline from the Report Name column.' },
                { label: 'Archive', desc: 'Changes the report status to Archived without deleting it.' },
                { label: 'Delete', desc: 'Prompts a confirmation modal before permanently removing the report.' },
                { label: 'Download / Export', desc: 'Exports the report. Requires backend connection in production.' },
              ],
            },
          ],
        },
      },
      {
        id: 'generate-report',
        title: 'Generate Report',
        badge: null,
        content: {
          description: 'Use the Generate Report tab to create new SME tax reports. Fill in the report type, tax year, reporting period, and select the sections to include.',
          sections: [
            {
              heading: 'Report Types Available',
              type: 'list',
              items: [
                { label: 'Annual Tax Summary', desc: 'Comprehensive year-end summary for SME tax filing (Form C / Form B).' },
                { label: 'Quarterly Business Review', desc: 'Interim summary for internal review and cash flow planning.' },
                { label: 'Expense Deduction Report', desc: 'Focused report on deductible business expenses and their tax impact.' },
                { label: 'Payroll & PCB Summary', desc: 'Summarises monthly PCB contributions and staff cost deductions.' },
              ],
            },
            {
              heading: 'Note',
              type: 'paragraph',
              text: 'Generated reports are marked as Draft if accountant review is selected, or Ready if skipped. All generated figures are AI-assisted estimates and must be verified with a qualified tax agent before submission to LHDN.',
            },
          ],
        },
      },
      {
        id: 'ocr-evidence',
        title: 'OCR Evidence',
        badge: 'AI Feature',
        content: {
          description: 'The OCR Evidence tab shows AI-extracted data from uploaded documents. Each record includes extracted amount, date, vendor, confidence score, missing fields, and verification status.',
          sections: [
            {
              heading: 'OCR Fields Explained',
              type: 'list',
              items: [
                { label: 'Confidence Score', desc: 'Percentage indicating how reliably the AI extracted the data. Scores below 80% should be manually reviewed.' },
                { label: 'Missing Fields', desc: 'Fields the AI could not extract — e.g., invoice number, business use note. These need manual completion.' },
                { label: 'Status', desc: 'Pending, Verified, or Needs Review.' },
              ],
            },
            {
              heading: 'OCR Actions',
              type: 'list',
              items: [
                { label: 'Mark Verified', desc: 'Confirms the extracted data is correct and clears missing fields.' },
                { label: 'Recheck', desc: 'Re-runs the OCR extraction simulation on the document.' },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'api',
    label: 'API Reference',
    icon: <CodeIcon />,
    items: [
      {
        id: 'api-overview',
        title: 'API Overview',
        badge: 'Developer',
        content: {
          description: 'The Fiscal Clarity AI API allows developers to integrate report generation, OCR extraction, and tax advisory features into their own systems. Full API documentation will be published ahead of the public API launch.',
          sections: [
            {
              heading: 'Planned Endpoints',
              type: 'api',
              endpoints: [
                { method: 'GET', path: '/api/v1/reports', desc: 'List all SME reports for the authenticated user.' },
                { method: 'POST', path: '/api/v1/reports/generate', desc: 'Generate a new tax report with specified parameters.' },
                { method: 'GET', path: '/api/v1/receipts', desc: 'List all linked supporting receipts.' },
                { method: 'POST', path: '/api/v1/receipts/upload', desc: 'Upload a new receipt or invoice for OCR processing.' },
                { method: 'GET', path: '/api/v1/ocr/:id', desc: 'Get OCR evidence details for a specific document.' },
                { method: 'POST', path: '/api/v1/insights', desc: 'Trigger AI analysis and generate new insights for the current period.' },
              ],
            },
            {
              heading: 'Authentication',
              type: 'paragraph',
              text: 'All API requests require a Bearer token in the Authorization header. Tokens are generated from the account settings page. API keys should never be shared or committed to source code.',
            },
          ],
        },
      },
    ],
  },
  {
    id: 'faq',
    label: 'FAQ',
    icon: <HelpCircleIcon />,
    items: [
      {
        id: 'faq-general',
        title: 'General Questions',
        badge: null,
        content: {
          description: 'Frequently asked questions about Fiscal Clarity AI and how it works.',
          sections: [
            {
              heading: '',
              type: 'faq',
              items: [
                {
                  q: 'Is Fiscal Clarity AI a licensed tax agent?',
                  a: 'No. Fiscal Clarity AI is a software tool that provides AI-assisted guidance based on publicly available LHDN regulations. It is not a licensed tax agent. All outputs should be verified with a qualified tax agent before submission.',
                },
                {
                  q: 'Can I use the platform to submit my tax return directly to LHDN?',
                  a: 'Not currently. The platform helps you prepare, organise, and review your tax reports. Actual submission to LHDN must be done via MyTax (mytax.hasil.gov.my) or through a licensed tax agent.',
                },
                {
                  q: 'How accurate are the AI-generated tax estimates?',
                  a: 'AI estimates are based on the information you provide and current LHDN guidelines. Accuracy depends on the completeness and correctness of your input data. Always treat AI figures as estimates for review, not final calculations.',
                },
                {
                  q: 'Is my data stored securely?',
                  a: 'Yes. All data is encrypted in transit and at rest. We do not share your financial data with third parties. See the Terms & Conditions for full details on data handling.',
                },
                {
                  q: 'What tax years are supported?',
                  a: 'The platform currently supports YA 2022, YA 2023, and YA 2024. Support for earlier years and YA 2025 will be added as guidelines are published.',
                },
                {
                  q: 'What is the difference between CukaiBot and CukaiVault?',
                  a: 'CukaiBot is a conversational AI assistant for asking tax questions and getting regulation-based guidance. CukaiVault is the structured document and report management module where you generate, store, and organise your tax reports and supporting evidence.',
                },
              ],
            },
          ],
        },
      },
    ],
  },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

const METHOD_COLOR = {
  GET: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  POST: 'bg-blue-50 text-blue-700 border-blue-200',
  PUT: 'bg-amber-50 text-amber-700 border-amber-200',
  DELETE: 'bg-red-50 text-red-700 border-red-200',
};

function CodeBlock({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-1 rounded-lg border border-slate-200 bg-slate-900 px-4 py-3 font-mono text-xs text-slate-300">
      <span>{text}</span>
      <button
        onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute right-2 top-2 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-semibold text-[#0F172A] hover:text-[#0D9488]"
      >
        {q}
        <span className={`shrink-0 text-[#64748B] transition-transform ${open ? 'rotate-180' : ''}`}><ChevronDownIcon /></span>
      </button>
      {open && <p className="pb-4 text-sm leading-relaxed text-[#334155]">{a}</p>}
    </div>
  );
}

function DocContent({ item }) {
  if (!item) return null;
  const { content } = item;
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-xl font-bold text-[#0F172A]">{item.title}</h2>
          {item.badge && (
            <span className="rounded-full border border-[#0D9488]/20 bg-[#f0fdf9] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#0D9488]">
              {item.badge}
            </span>
          )}
        </div>
        <p className="text-sm leading-relaxed text-[#64748B]">{content.description}</p>
      </div>

      {content.sections.map((sec, i) => (
        <div key={i} className="space-y-3">
          {sec.heading && <h3 className="text-sm font-bold text-[#0F172A]">{sec.heading}</h3>}

          {sec.type === 'paragraph' && (
            <p className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-[#334155]">{sec.text}</p>
          )}

          {sec.type === 'list' && (
            <div className="space-y-2">
              {sec.items.map((it, j) => (
                <div key={j} className="flex gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#0D9488]" />
                  <div>
                    <p className="text-sm font-semibold text-[#0F172A]">{it.label}</p>
                    <p className="text-xs leading-relaxed text-[#64748B]">{it.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {sec.type === 'api' && (
            <div className="space-y-2">
              {sec.endpoints.map((ep, j) => (
                <div key={j} className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${METHOD_COLOR[ep.method] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                      {ep.method}
                    </span>
                    <CodeBlock text={ep.path} />
                  </div>
                  <p className="mt-2 text-xs text-[#64748B]">{ep.desc}</p>
                </div>
              ))}
            </div>
          )}

          {sec.type === 'faq' && (
            <div className="rounded-xl border border-slate-100 bg-white px-5 shadow-sm">
              {sec.items.map((it, j) => <FaqItem key={j} q={it.q} a={it.a} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

function Documentation() {
  const allItems = DOC_SECTIONS.flatMap(s => s.items);
  const [activeId, setActiveId] = useState('overview');
  const [openSections, setOpenSections] = useState({ 'getting-started': true, 'cukai-vault': true, api: true, faq: true });
  const [search, setSearch] = useState('');

  const toggleSection = (id) => setOpenSections(p => ({ ...p, [id]: !p[id] }));

  const activeItem = allItems.find(i => i.id === activeId);

  const filteredSections = search
    ? DOC_SECTIONS.map(sec => ({
        ...sec,
        items: sec.items.filter(it =>
          it.title.toLowerCase().includes(search.toLowerCase()) ||
          it.content.description.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter(sec => sec.items.length > 0)
    : DOC_SECTIONS;

  return (
    // ── FIXED VIEWPORT FRAME (Matches InsightsInbox.jsx) ──
    <main className="h-[calc(100vh-4.1rem)] bg-background font-body flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-7xl flex flex-col gap-4 px-6 py-5 h-full overflow-hidden">

        {/* ── Page Header (shrink-0 prevents it from squishing) ── */}
        <div className="flex flex-col gap-1 shrink-0">
          <h1 className="font-headings text-3xl font-bold tracking-tight text-headings">Documentation</h1>
          <p className="text-sm text-[#64748B]">User manual, module guides, API reference, and frequently asked questions.</p>
        </div>

        {/* ── Master Split Layout ── */}
        <div className="flex flex-1 gap-6 min-h-0 overflow-hidden">

          {/* ── Desktop Sidebar (Now independently scrollable) ── */}
          <aside className="hidden w-60 shrink-0 lg:flex lg:flex-col h-full overflow-y-auto pr-2">
            <div className="space-y-2">
              {/* Search */}
              <div className="relative mb-3 sticky top-0 bg-background pb-1 z-10">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]"><SearchIcon /></span>
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); }}
                  placeholder="Search docs…"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-[#0F172A] placeholder-[#94A3B8] shadow-sm outline-none transition-all focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/10"
                />
              </div>

              {filteredSections.map(sec => (
                <div key={sec.id}>
                  <button
                    onClick={() => toggleSection(sec.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-xs font-bold uppercase tracking-widest text-[#64748B]"
                  >
                    <span className="text-[#0D9488]">{sec.icon}</span>
                    {sec.label}
                    <span className={`ml-auto transition-transform ${openSections[sec.id] ? 'rotate-90' : ''}`}><ChevronRightIcon /></span>
                  </button>
                  {openSections[sec.id] && (
                    <div className="ml-2 mt-1 space-y-0.5 border-l border-slate-200 pl-3">
                      {sec.items.map(item => (
                        <button
                          key={item.id}
                          onClick={() => { setActiveId(item.id); setSearch(''); }}
                          className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${activeId === item.id ? 'bg-[#0F172A] font-semibold text-white' : 'text-[#334155] hover:bg-slate-100 hover:text-[#0F172A]'}`}
                        >
                          {item.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </aside>

          {/* ── Main Content Column ── */}
          <div className="min-w-0 flex-1 flex flex-col h-full overflow-hidden">
            
            {/* Mobile search results view */}
            {search ? (
              <div className="mb-3 max-h-40 overflow-y-auto space-y-2 lg:hidden shrink-0">
                {filteredSections.flatMap(sec => sec.items).map(item => (
                  <button key={item.id} onClick={() => { setActiveId(item.id); setSearch(''); }} className="block w-full rounded-xl border border-slate-100 bg-white px-4 py-3 text-left shadow-sm hover:border-[#0D9488]/30">
                    <p className="text-sm font-semibold text-[#0F172A]">{item.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-[#64748B]">{item.content.description}</p>
                  </button>
                ))}
              </div>
            ) : null}

            {/* Mobile nav horizontal chip tray */}
            <div className="mb-3 flex flex-wrap gap-2 lg:hidden shrink-0 max-h-24 overflow-y-auto pb-1">
              {allItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => setActiveId(item.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${activeId === item.id ? 'border-[#0F172A] bg-[#0F172A] text-white' : 'border-slate-200 bg-white text-[#64748B]'}`}
                >
                  {item.title}
                </button>
              ))}
            </div>

            {/* ── INDEPENDENTLY SCROLLABLE READING CARD ── */}
            <div className="flex-1 overflow-y-auto min-h-0 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <DocContent item={activeItem} />
            </div>

            {/* ── Version Footer Sticky Note ── */}
            <div className="mt-3 flex items-center justify-between shrink-0">
              <p className="text-[10px] text-[#94A3B8]">Fiscal Clarity AI — Documentation v1.0 · More modules will be added as the platform grows.</p>
              <div className="flex items-center gap-1">
                {allItems.map((item, i) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveId(item.id)}
                    title={item.title}
                    className={`h-1.5 rounded-full transition-all ${activeId === item.id ? 'w-4 bg-[#0D9488]' : 'w-1.5 bg-slate-300 hover:bg-slate-400'}`}
                  />
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </main>
  );
}

export default Documentation;