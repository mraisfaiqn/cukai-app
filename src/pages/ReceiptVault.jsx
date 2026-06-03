
import { useMemo, useRef, useState } from 'react';

const reportCategories = [
  'SME Tax Summary',
  'Business Income Report',
  'Business Expense Report',
  'Profit & Loss Summary',
  'OCR Extraction Report',
  'E-Invoice Readiness Report',
  'Accountant Review Pack',
  'Tax Readiness Checklist',
  'Monthly Business Summary',
];

const statusOptions = ['Ready', 'Needs Review', 'Draft', 'Archived', 'Failed'];
const taxYearOptions = ['YA 2026', 'YA 2025', 'YA 2024'];
const periodOptions = ['May 2026', 'Q2 2026', 'Q1 2026', 'Full Year 2026'];

const reportSectionExplanations = [
  {
    title: 'SME Tax Summary',
    explanation: 'Summarizes SME income, deductible expenses, estimated tax impact, and tax readiness for the selected tax year.',
  },
  {
    title: 'Business Income Report',
    explanation: 'Shows business income records such as service income, product sales, customer invoices, and payment records.',
  },
  {
    title: 'Business Expense Report',
    explanation: 'Groups business expenses such as supplier purchases, utilities, rental, transport, maintenance, payroll, marketing, and office costs.',
  },
  {
    title: 'Profit & Loss Summary',
    explanation: 'Compares income and expenses to estimate business profit before final accountant review.',
  },
  {
    title: 'OCR Extraction Report',
    explanation: 'Lists documents processed by OCR, extracted amounts, confidence score, missing fields, and items requiring manual review.',
  },
  {
    title: 'E-Invoice Readiness Report',
    explanation: 'Tracks e-Invoice related document readiness, missing invoice fields, supplier/customer details, and review status.',
  },
  {
    title: 'Accountant Review Pack',
    explanation: 'Packages key business reports and supporting documents for accountant or tax agent review.',
  },
  {
    title: 'Tax Readiness Checklist',
    explanation: 'Highlights missing documents, review items, incomplete fields, and records that are not yet tax ready.',
  },
  {
    title: 'Overall Deductible Tax',
    explanation: 'Shows an AI-assisted estimate of deductible tax value based on categorized SME expenses. It is not a final tax calculation and must be verified by a qualified accountant or tax agent.',
  },
];

const initialReports = [
  {
    id: 1,
    name: 'YA 2026 SME Tax Summary',
    category: 'SME Tax Summary',
    taxYear: 'YA 2026',
    totalAmount: 'RM128,500',
    deductibleAmount: 'RM68,900',
    overallDeductibleTax: 'RM6,890',
    estimatedTaxImpact: 'RM4,860',
    reviewAmount: 'RM59,600',
    relatedRecordsCount: 148,
    ocrDocumentsIncluded: 42,
    accountantReviewRequired: false,
    createdDate: '01 Jun 2026',
    lastUpdated: '02 Jun 2026',
    status: 'Ready',
    owner: 'ELECTRICAL Sales & Services',
    notes: 'Prepared from verified business income and expense summaries.',
    includedSections: ['Business income', 'Business expenses', 'Tax readiness status', 'AI notes'],
  },
  {
    id: 2,
    name: 'May 2026 Expense Breakdown',
    category: 'Business Expense Report',
    taxYear: 'YA 2026',
    totalAmount: 'RM18,420',
    deductibleAmount: 'RM15,900',
    overallDeductibleTax: 'RM1,590',
    estimatedTaxImpact: 'RM1,120',
    reviewAmount: 'RM2,520',
    relatedRecordsCount: 64,
    ocrDocumentsIncluded: 38,
    accountantReviewRequired: true,
    createdDate: '30 May 2026',
    lastUpdated: '01 Jun 2026',
    status: 'Needs Review',
    owner: 'Finance Admin',
    notes: 'Several OCR extracted receipts require manual confirmation.',
    includedSections: ['Expense records', 'OCR documents', 'Deductibility notes'],
  },
  {
    id: 3,
    name: 'Business Income Summary',
    category: 'Business Income Report',
    taxYear: 'YA 2026',
    totalAmount: 'RM52,800',
    deductibleAmount: 'RM0',
    overallDeductibleTax: 'RM0',
    estimatedTaxImpact: 'RM2,980',
    reviewAmount: 'RM0',
    relatedRecordsCount: 35,
    ocrDocumentsIncluded: 6,
    accountantReviewRequired: false,
    createdDate: '28 May 2026',
    lastUpdated: '29 May 2026',
    status: 'Ready',
    owner: 'ELECTRICAL Sales & Services',
    notes: 'Monthly income summary is reconciled against uploaded invoices.',
    includedSections: ['Income records', 'E-invoice items', 'AI notes'],
  },
  {
    id: 4,
    name: 'OCR Extraction Audit',
    category: 'OCR Extraction Report',
    taxYear: 'YA 2026',
    totalAmount: 'RM24,760',
    deductibleAmount: 'RM21,300',
    overallDeductibleTax: 'RM2,130',
    estimatedTaxImpact: 'RM860',
    reviewAmount: 'RM3,460',
    relatedRecordsCount: 77,
    ocrDocumentsIncluded: 77,
    accountantReviewRequired: true,
    createdDate: '26 May 2026',
    lastUpdated: '30 May 2026',
    status: 'Draft',
    owner: 'Cukai.AI',
    notes: 'Draft audit of receipt extraction confidence and missing fields.',
    includedSections: ['OCR documents', 'Confidence scores', 'Review notes'],
  },
  {
    id: 5,
    name: 'E-Invoice Readiness Checklist',
    category: 'E-Invoice Readiness Report',
    taxYear: 'YA 2026',
    totalAmount: 'RM0',
    deductibleAmount: 'RM0',
    overallDeductibleTax: 'RM0',
    estimatedTaxImpact: 'RM0',
    reviewAmount: 'RM0',
    relatedRecordsCount: 12,
    ocrDocumentsIncluded: 0,
    accountantReviewRequired: false,
    createdDate: '22 May 2026',
    lastUpdated: '31 May 2026',
    status: 'Ready',
    owner: 'Tax Manager',
    notes: 'Checklist covers current readiness items for SME e-invoice preparation.',
    includedSections: ['Readiness items', 'Account setup', 'Supporting documents'],
  },
  {
    id: 6,
    name: 'Accountant Review Pack',
    category: 'Accountant Review Pack',
    taxYear: 'YA 2026',
    totalAmount: 'RM128,500',
    deductibleAmount: 'RM68,900',
    overallDeductibleTax: 'RM6,890',
    estimatedTaxImpact: 'RM4,860',
    reviewAmount: 'RM59,600',
    relatedRecordsCount: 148,
    ocrDocumentsIncluded: 42,
    accountantReviewRequired: true,
    createdDate: '01 May 2026',
    lastUpdated: '01 May 2026',
    status: 'Archived',
    owner: 'Accountant',
    notes: 'Archived pack shared for accountant review on 1 May 2026.',
    includedSections: ['Tax summary', 'Income records', 'Expense records', 'OCR summaries'],
  },
  {
    id: 7,
    name: 'Profit & Loss Summary',
    category: 'Profit & Loss Summary',
    taxYear: 'YA 2026',
    totalAmount: 'RM128,500',
    deductibleAmount: 'RM74,260',
    overallDeductibleTax: 'RM7,426',
    estimatedTaxImpact: 'RM5,240',
    reviewAmount: 'RM54,240',
    relatedRecordsCount: 151,
    ocrDocumentsIncluded: 42,
    accountantReviewRequired: false,
    createdDate: '18 May 2026',
    lastUpdated: '25 May 2026',
    status: 'Ready',
    owner: 'Finance Admin',
    notes: 'P&L summary for service revenue, materials, subcontractors, and operating costs.',
    includedSections: ['Income records', 'Expense records', 'Profit summary'],
  },
  {
    id: 8,
    name: 'Tax Readiness Checklist',
    category: 'Tax Readiness Checklist',
    taxYear: 'YA 2026',
    totalAmount: 'RM0',
    deductibleAmount: 'RM0',
    overallDeductibleTax: 'RM0',
    estimatedTaxImpact: 'RM0',
    reviewAmount: 'Needs Accountant Review',
    relatedRecordsCount: 18,
    ocrDocumentsIncluded: 0,
    accountantReviewRequired: true,
    createdDate: '15 May 2026',
    lastUpdated: '28 May 2026',
    status: 'Needs Review',
    owner: 'Tax Manager',
    notes: 'Review outstanding supporting documents before accountant export.',
    includedSections: ['Tax readiness status', 'Supporting documents', 'Accountant review'],
  },
];

const summaryCards = [
  { label: 'Total Reports', value: '24', tone: 'neutral' },
  { label: 'Total Reported Income', value: 'RM128,500', tone: 'teal' },
  { label: 'Total Deductible Expenses', value: 'RM68,900', tone: 'teal' },
  { label: 'Overall Deductible Tax', value: 'RM6,890', tone: 'teal' },
  { label: 'Estimated Tax Impact', value: 'RM4,860', tone: 'amber' },
  { label: 'Needs Review', value: '5', tone: 'amber' },
  { label: 'Ready to Export', value: '12', tone: 'teal' },
];

function StatusBadge({ status }) {
  const styles = {
    Ready: 'border-[#8DE7C6] bg-[#E1F5EE] text-[#0F6E56]',
    'Needs Review': 'border-[#F8D891] bg-[#FFF7E5] text-[#BA7517]',
    Draft: 'border-slate-200 bg-slate-100 text-slate-600',
    Archived: 'border-[#D9D7D0] bg-[#F2F1EC] text-[#5F5E5A]',
    Failed: 'border-[#F7B8B8] bg-[#FFF0F0] text-[#E24B4A]',
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[status] || styles.Draft}`}>
      {status}
    </span>
  );
}

function MoneyValue({ value }) {
  return (
    <span className="block text-right font-mono tabular-nums text-[#0F172A]">
      {value || 'RM0'}
    </span>
  );
}

function normalizeMoney(value) {
  const cleaned = String(value || '').replace(/[^\d.]/g, '');
  if (!cleaned) return 'RM0';

  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return 'RM0';

  return `RM${amount.toLocaleString('en-MY', {
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  })}`;
}

function Icon({ name }) {
  const common = 'h-4 w-4 shrink-0';
  if (name === 'download') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5" />
        <path d="M12 15V3" />
      </svg>
    );
  }
  if (name === 'plus') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }
  if (name === 'upload') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M17 8l-5-5-5 5" />
        <path d="M12 3v12" />
      </svg>
    );
  }
  if (name === 'search') {
    return (
      <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    );
  }
  return null;
}

function primaryButtonClass(extra = '') {
  return `inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F6E56] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0D5F4B] ${extra}`;
}

function secondaryButtonClass(extra = '') {
  return `inline-flex items-center justify-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm font-semibold text-[#0F172A] transition hover:border-[#0D9488] hover:bg-[#f0fdf9] hover:text-[#0D9488] ${extra}`;
}

function dangerButtonClass(extra = '') {
  return `inline-flex items-center justify-center gap-2 rounded-lg border border-[#F7B8B8] bg-white px-4 py-2.5 text-sm font-semibold text-[#E24B4A] transition hover:bg-[#FFF0F0] ${extra}`;
}

function ModalShell({ title, subtitle, children, onClose, size = 'max-w-xl' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0F172A]/40 px-4 py-6 backdrop-blur-sm sm:items-center">
      <div className={`max-h-[92vh] w-full overflow-hidden rounded-xl bg-white shadow-2xl ${size}`}>
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-[#0F172A]">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-[#64748B]">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#64748B] transition hover:bg-[#F8FAFC] hover:text-[#0F172A]"
            aria-label="Close modal"
          >
            x
          </button>
        </div>
        <div className="max-h-[calc(92vh-73px)] overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function ReportVault() {
  const [reports, setReports] = useState(initialReports);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All Categories');
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [taxYearFilter, setTaxYearFilter] = useState('All Tax Years');
  const [selectedReport, setSelectedReport] = useState(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renameReport, setRenameReport] = useState(null);
  const [deleteReport, setDeleteReport] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimeoutRef = useRef(null);
  const nextReportIdRef = useRef(9);

  const filteredReports = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return reports.filter((report) => {
      const matchesSearch = !normalizedSearch || [report.name, report.category, report.status, report.owner]
        .some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesCategory = categoryFilter === 'All Categories' || report.category === categoryFilter;
      const matchesStatus = statusFilter === 'All Statuses' || report.status === statusFilter;
      const matchesYear = taxYearFilter === 'All Tax Years' || report.taxYear === taxYearFilter;

      return matchesSearch && matchesCategory && matchesStatus && matchesYear;
    });
  }, [reports, search, categoryFilter, statusFilter, taxYearFilter]);

  function showToast(message) {
    setToast(message);
    window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToast(''), 2600);
  }

  function clearFilters() {
    setSearch('');
    setCategoryFilter('All Categories');
    setStatusFilter('All Statuses');
    setTaxYearFilter('All Tax Years');
    showToast('Filters cleared');
  }

  function updateReportStatus(id, status) {
    setReports((current) => current.map((report) => (
      report.id === id ? { ...report, status, lastUpdated: '02 Jun 2026' } : report
    )));
    setSelectedReport((current) => (
      current && current.id === id ? { ...current, status, lastUpdated: '02 Jun 2026' } : current
    ));
  }

  function archiveReport(report) {
    updateReportStatus(report.id, 'Archived');
    showToast('Report archived');
  }

  function downloadReport() {
    showToast('Download started');
  }

  function exportAll() {
    showToast('Export started');
  }

  function addGeneratedReport(form) {
    const newReport = {
      id: nextReportIdRef.current++,
      name: `${form.period} ${form.reportType}`,
      category: form.reportType,
      taxYear: form.taxYear,
      totalAmount: form.includeIncomeSummary ? 'RM36,800' : 'RM0',
      deductibleAmount: form.includeDeductibleEstimate ? 'RM18,950' : 'RM0',
      overallDeductibleTax: form.includeOverallDeductibleTax ? 'RM1,895' : 'RM0',
      estimatedTaxImpact: form.includeDeductibleEstimate ? 'RM1,340' : 'Needs Accountant Review',
      reviewAmount: form.includeAccountantReviewNotes ? 'Needs Accountant Review' : 'RM17,850',
      relatedRecordsCount: 32,
      ocrDocumentsIncluded: form.includeOcrEvidence ? 14 : 0,
      accountantReviewRequired: form.includeAccountantReviewNotes,
      createdDate: '03 Jun 2026',
      lastUpdated: '03 Jun 2026',
      status: form.includeAccountantReviewNotes ? 'Draft' : 'Ready',
      owner: 'Cukai.AI',
      notes: 'Generated using selected SME report sections and mock business data.',
      includedSections: [
        form.includeIncomeSummary && 'Income summary',
        form.includeExpenseSummary && 'Expense summary',
        form.includeDeductibleEstimate && 'Deductible amount estimate',
        form.includeOverallDeductibleTax && 'Overall deductible tax',
        form.includeOcrEvidence && 'OCR document evidence',
        form.includeAccountantReviewNotes && 'Accountant review notes',
      ].filter(Boolean),
    };

    setReports((current) => [newReport, ...current]);
    setGenerateOpen(false);
    showToast('Report generated');
  }

  function addUploadedReport(form) {
    const newReport = {
      id: nextReportIdRef.current++,
      name: form.title,
      category: form.category,
      taxYear: form.taxYear,
      totalAmount: normalizeMoney(form.totalAmount),
      deductibleAmount: normalizeMoney(form.deductibleAmount),
      overallDeductibleTax: normalizeMoney(form.overallDeductibleTax),
      estimatedTaxImpact: normalizeMoney(form.estimatedTaxImpact),
      reviewAmount: 'Needs Accountant Review',
      relatedRecordsCount: 1,
      ocrDocumentsIncluded: form.fileName ? 1 : 0,
      accountantReviewRequired: true,
      createdDate: '03 Jun 2026',
      lastUpdated: '03 Jun 2026',
      status: 'Draft',
      owner: 'Finance Admin',
      notes: form.notes || `Uploaded file: ${form.fileName || 'Mock document'}`,
      includedSections: ['Uploaded document', 'Manual notes'],
    };

    setReports((current) => [newReport, ...current]);
    setUploadOpen(false);
    showToast('Report saved');
  }

  function renameSelectedReport(id, name) {
    setReports((current) => current.map((report) => (
      report.id === id ? { ...report, name, lastUpdated: '02 Jun 2026' } : report
    )));
    setRenameReport(null);
    showToast('Report renamed');
  }

  function deleteSelectedReport(id) {
    setReports((current) => current.filter((report) => report.id !== id));
    if (selectedReport?.id === id) setSelectedReport(null);
    setDeleteReport(null);
    showToast('Report deleted');
  }

  return (
    <main className="min-h-screen bg-[#F7F6F2] text-[#2C2C2A]">
      <div className="mx-auto max-w-[1536px] px-4 py-6 sm:px-6 lg:px-8">
        <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#0D9488]">SME Workspace</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#0F172A]">Report Vault</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5F5E5A]">
              Store, review, generate, and export SME tax and business reports.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <button type="button" onClick={() => setGenerateOpen(true)} className={primaryButtonClass()}>
              <Icon name="plus" />
              Generate Report
            </button>
            <button type="button" onClick={() => setUploadOpen(true)} className={secondaryButtonClass()}>
              <Icon name="upload" />
              Upload Report
            </button>
            <button type="button" onClick={exportAll} className={secondaryButtonClass()}>
              <Icon name="download" />
              Export All
            </button>
            <button type="button" onClick={clearFilters} className={secondaryButtonClass()}>
              Clear Filters
            </button>
          </div>
        </section>

        <section className="mb-6 grid gap-4 rounded-xl border border-[#E2E8F0] bg-white p-4 lg:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#64748B]">Business Name</p>
            <p className="mt-1 font-semibold text-[#0F172A]">ELECTRICAL Sales & Services</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#64748B]">Business Type</p>
            <p className="mt-1 font-semibold text-[#0F172A]">Electrical & Aircond Services</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#64748B]">Tax Year</p>
            <p className="mt-1 font-semibold text-[#0F172A]">YA 2026</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#64748B]">Currency</p>
            <p className="mt-1 font-semibold text-[#0F172A]">RM</p>
          </div>
        </section>

        <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-[#E2E8F0] bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#64748B]">{card.label}</p>
              <p className={`mt-2 text-2xl font-bold tracking-tight ${card.tone === 'teal' ? 'text-[#0D9488]' : card.tone === 'amber' ? 'text-[#BA7517]' : 'text-[#0F172A]'}`}>
                {card.value}
              </p>
            </div>
          ))}
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0 space-y-4">
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_170px_150px]">
                <label className="relative block">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]">
                    <Icon name="search" />
                  </span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search by report name, category, status, or owner..."
                    className="h-11 w-full rounded-lg border border-[#E2E8F0] bg-white pl-10 pr-3 text-sm text-[#0F172A] outline-none transition focus:border-[#0D9488] focus:ring-4 focus:ring-[#0D9488]/10"
                  />
                </label>
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-11 rounded-lg border border-[#E2E8F0] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-[#0D9488] focus:ring-4 focus:ring-[#0D9488]/10">
                  <option>All Categories</option>
                  {reportCategories.map((category) => <option key={category}>{category}</option>)}
                </select>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 rounded-lg border border-[#E2E8F0] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-[#0D9488] focus:ring-4 focus:ring-[#0D9488]/10">
                  <option>All Statuses</option>
                  {statusOptions.map((status) => <option key={status}>{status}</option>)}
                </select>
                <select value={taxYearFilter} onChange={(event) => setTaxYearFilter(event.target.value)} className="h-11 rounded-lg border border-[#E2E8F0] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-[#0D9488] focus:ring-4 focus:ring-[#0D9488]/10">
                  <option>All Tax Years</option>
                  {taxYearOptions.map((year) => <option key={year}>{year}</option>)}
                </select>
              </div>
            </div>

            {filteredReports.length === 0 ? (
              <EmptyState onClear={clearFilters} />
            ) : (
              <>
                <div className="hidden rounded-xl border border-[#E2E8F0] bg-white lg:block">
                  <div className="overflow-x-auto">
                    <table className="min-w-[1720px] table-fixed text-left text-sm">
                    <thead className="bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#64748B]">
                      <tr>
                        <th className="w-[210px] px-4 py-3">Report Name</th>
                        <th className="w-[190px] px-4 py-3">Category</th>
                        <th className="w-[90px] px-4 py-3">Tax Year</th>
                        <th className="w-[130px] px-4 py-3 text-right">Total Amount</th>
                        <th className="w-[150px] px-4 py-3 text-right">Deductible Amount</th>
                        <th className="w-[155px] px-4 py-3 text-right">Overall Deductible Tax</th>
                        <th className="w-[155px] px-4 py-3 text-right">Estimated Tax Impact</th>
                        <th className="w-[120px] px-4 py-3">Created Date</th>
                        <th className="w-[115px] px-4 py-3">Status</th>
                        <th className="w-[155px] px-4 py-3">Owner</th>
                        <th className="sticky right-0 z-10 w-[220px] bg-[#F8FAFC] px-4 py-3 text-right shadow-[-10px_0_16px_-16px_rgba(15,23,42,0.45)]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {filteredReports.map((report) => (
                        <tr key={report.id} className="group transition hover:bg-[#F8FAFC]">
                          <td className="px-4 py-4 font-semibold text-[#0F172A]">{report.name}</td>
                          <td className="px-4 py-4 text-[#5F5E5A]">{report.category}</td>
                          <td className="px-4 py-4 text-[#5F5E5A]">{report.taxYear}</td>
                          <td className="px-4 py-4"><MoneyValue value={report.totalAmount} /></td>
                          <td className="px-4 py-4"><MoneyValue value={report.deductibleAmount} /></td>
                          <td className="px-4 py-4"><MoneyValue value={report.overallDeductibleTax} /></td>
                          <td className="px-4 py-4"><MoneyValue value={report.estimatedTaxImpact} /></td>
                          <td className="px-4 py-4 text-[#5F5E5A]">{report.createdDate}</td>
                          <td className="px-4 py-4"><StatusBadge status={report.status} /></td>
                          <td className="px-4 py-4 text-[#5F5E5A]">{report.owner}</td>
                          <td className="sticky right-0 z-10 bg-white px-3 py-3 shadow-[-10px_0_16px_-16px_rgba(15,23,42,0.45)] group-hover:bg-[#F8FAFC]">
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              <RowAction label="View" onClick={() => setSelectedReport(report)} />
                              <RowAction label="Download" onClick={downloadReport} />
                              <RowAction label="Rename" onClick={() => setRenameReport(report)} />
                              <RowAction label="Archive" onClick={() => archiveReport(report)} />
                              <RowAction label="Delete" danger onClick={() => setDeleteReport(report)} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-3 lg:hidden">
                  {filteredReports.map((report) => (
                    <ReportMobileCard
                      key={report.id}
                      report={report}
                      onView={() => setSelectedReport(report)}
                      onDownload={downloadReport}
                      onRename={() => setRenameReport(report)}
                      onArchive={() => archiveReport(report)}
                      onDelete={() => setDeleteReport(report)}
                    />
                  ))}
                </div>
              </>
            )}
          </section>

          <aside className="space-y-4">
            <section className="rounded-xl border border-[#BFE9DE] bg-[#F0FDFA] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#0D9488]">SME Report Insights</p>
              <h2 className="mt-2 text-lg font-bold text-[#0F172A]">Business report health</h2>
              <ul className="mt-4 space-y-3 text-sm leading-5 text-[#334155]">
                <li>5 reports need review</li>
                <li>3 reports ready for accountant export</li>
                <li>2 reports include OCR extraction summaries</li>
                <li>E-Invoice readiness checklist available</li>
                <li>Keep business supporting documents for 7 years</li>
                <li>Accountant review pack last generated on 1 May 2026</li>
              </ul>
            </section>
            <section className="rounded-xl border border-[#F8D891] bg-[#FFF9EB] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#BA7517]">Compliance Disclaimer</p>
              <p className="mt-2 text-sm leading-6 text-[#5F5E5A]">
                Cukai.AI provides AI-assisted report organization only. Please verify final tax treatment with official LHDN guidance or a qualified accountant / tax agent.
              </p>
            </section>
          </aside>
        </div>

        <section className="mt-6 rounded-xl border border-[#E2E8F0] bg-white p-5">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#0D9488]">SME Reference</p>
            <h2 className="mt-2 text-lg font-bold text-[#0F172A]">Report Code & Section Explanation</h2>
            <p className="mt-2 text-sm leading-6 text-[#5F5E5A]">
              These explanations describe how Cukai.AI organizes SME report sections. Tax treatment remains AI-assisted and should be verified with official LHDN guidance or a qualified accountant / tax agent.
            </p>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {reportSectionExplanations.map((item) => (
              <article key={item.title} className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <h3 className="text-sm font-bold text-[#0F172A]">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#5F5E5A]">{item.explanation}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] rounded-lg border border-[#BFE9DE] bg-white px-4 py-3 text-sm font-semibold text-[#0F6E56] shadow-xl">
          {toast}
        </div>
      )}

      {selectedReport && (
        <ReportPreviewModal
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
          onDownload={downloadReport}
          onArchive={() => archiveReport(selectedReport)}
        />
      )}
      {generateOpen && <GenerateReportModal onClose={() => setGenerateOpen(false)} onGenerate={addGeneratedReport} />}
      {uploadOpen && <UploadReportModal onClose={() => setUploadOpen(false)} onSave={addUploadedReport} />}
      {renameReport && <RenameReportModal report={renameReport} onClose={() => setRenameReport(null)} onRename={renameSelectedReport} />}
      {deleteReport && <ConfirmDeleteModal report={deleteReport} onClose={() => setDeleteReport(null)} onDelete={deleteSelectedReport} />}
    </main>
  );
}

function RowAction({ label, onClick, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold transition ${danger ? 'text-[#E24B4A] hover:bg-[#FFF0F0]' : 'text-[#0F172A] hover:bg-[#f0fdf9] hover:text-[#0D9488]'}`}
    >
      {label}
    </button>
  );
}

function ReportMobileCard({ report, onView, onDownload, onRename, onArchive, onDelete }) {
  return (
    <article className="rounded-xl border border-[#E2E8F0] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[#0F172A]">{report.name}</h3>
          <p className="mt-1 text-sm text-[#5F5E5A]">{report.category}</p>
        </div>
        <StatusBadge status={report.status} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Meta label="Tax Year" value={report.taxYear} />
        <MoneyMeta label="Total Amount" value={report.totalAmount} />
        <MoneyMeta label="Deductible Amount" value={report.deductibleAmount} />
        <MoneyMeta label="Overall Deductible Tax" value={report.overallDeductibleTax} />
        <MoneyMeta label="Estimated Tax Impact" value={report.estimatedTaxImpact} />
        <Meta label="Created" value={report.createdDate} />
        <Meta label="Owner" value={report.owner} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={onView} className={secondaryButtonClass('px-3 py-2 text-xs')}>View</button>
        <button type="button" onClick={onDownload} className={secondaryButtonClass('px-3 py-2 text-xs')}>Download</button>
        <button type="button" onClick={onRename} className={secondaryButtonClass('px-3 py-2 text-xs')}>Rename</button>
        <button type="button" onClick={onArchive} className={secondaryButtonClass('px-3 py-2 text-xs')}>Archive</button>
        <button type="button" onClick={onDelete} className={dangerButtonClass('col-span-2 px-3 py-2 text-xs')}>Delete</button>
      </div>
    </article>
  );
}

function Meta({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#64748B]">{label}</p>
      <p className="mt-1 text-[#0F172A]">{value}</p>
    </div>
  );
}

function MoneyMeta({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#64748B]">{label}</p>
      <p className="mt-1 font-mono tabular-nums text-[#0F172A]">{value || 'RM0'}</p>
    </div>
  );
}

function EmptyState({ onClear }) {
  return (
    <section className="rounded-xl border border-dashed border-[#C6C6CD] bg-white px-6 py-12 text-center">
      <p className="text-lg font-bold text-[#0F172A]">No reports found</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#5F5E5A]">
        Try changing your search terms or clearing category, status, and tax year filters.
      </p>
      <button type="button" onClick={onClear} className={secondaryButtonClass('mt-5')}>Clear Filters</button>
    </section>
  );
}

function ReportPreviewModal({ report, onClose, onDownload, onArchive }) {
  const reportExplanation = reportSectionExplanations.find((item) => item.title === report.category);

  return (
    <ModalShell title={report.name} subtitle="SME report preview" onClose={onClose} size="max-w-4xl">
      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <section className="space-y-5">
          <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[#0F172A]">{report.category}</span>
              <StatusBadge status={report.status} />
            </div>
            <p className="mt-4 text-sm leading-6 text-[#5F5E5A]">
              This SME report summarizes business income, business expenses, OCR-extracted receipts, e-Invoice readiness items, and tax readiness status for YA 2026. Please verify final tax treatment with official LHDN guidance or a qualified accountant / tax agent.
            </p>
          </div>

          <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
            <h3 className="text-sm font-bold uppercase tracking-[0.05em] text-[#64748B]">Financial Details</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MoneyMeta label="Total Amount" value={report.totalAmount} />
              <MoneyMeta label="Deductible Amount" value={report.deductibleAmount} />
              <MoneyMeta label="Overall Deductible Tax" value={report.overallDeductibleTax} />
              <MoneyMeta label="Non-Deductible / Review Amount" value={report.reviewAmount} />
              <MoneyMeta label="Estimated Tax Impact" value={report.estimatedTaxImpact} />
              <Meta label="Related Records Count" value={report.relatedRecordsCount} />
              <Meta label="OCR Documents Included" value={report.ocrDocumentsIncluded} />
              <Meta label="Accountant Review Required" value={report.accountantReviewRequired ? 'Yes - Needs Accountant Review' : 'No'} />
            </div>
            <p className="mt-4 rounded-lg border border-[#BFE9DE] bg-[#F0FDFA] p-3 text-sm leading-6 text-[#0F6E56]">
              Deductible Amount is an AI-assisted estimate based on categorized SME business records. Final tax treatment should be verified with official LHDN guidance or a qualified accountant / tax agent.
            </p>
          </div>

          <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
            <h3 className="text-sm font-bold uppercase tracking-[0.05em] text-[#64748B]">Report Section Explanation</h3>
            <p className="mt-2 text-sm font-semibold text-[#0F172A]">{reportExplanation?.title || report.category}</p>
            <p className="mt-2 text-sm leading-6 text-[#5F5E5A]">
              {reportExplanation?.explanation || 'This report section contains AI-assisted SME records and should be reviewed before final tax use.'}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-bold uppercase tracking-[0.05em] text-[#64748B]">Included Sections</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {report.includedSections.map((section) => (
                <span key={section} className="rounded-full border border-[#BFE9DE] bg-[#E1F5EE] px-3 py-1 text-xs font-semibold text-[#0F6E56]">
                  {section}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold uppercase tracking-[0.05em] text-[#64748B]">Notes</h3>
            <p className="mt-2 rounded-lg border border-[#E2E8F0] bg-white p-4 text-sm leading-6 text-[#5F5E5A]">{report.notes}</p>
          </div>

          <div className="rounded-lg border border-[#F8D891] bg-[#FFF9EB] p-4 text-sm leading-6 text-[#5F5E5A]">
            Cukai.AI provides AI-assisted SME report organization only. Deductible amounts and tax impact are estimates. Please verify final tax treatment with official LHDN guidance or a qualified accountant / tax agent.
          </div>
        </section>

        <aside className="rounded-xl border border-[#E2E8F0] bg-white p-4">
          <div className="space-y-4">
            <Meta label="Tax Year" value={report.taxYear} />
            <Meta label="Created Date" value={report.createdDate} />
            <Meta label="Last Updated" value={report.lastUpdated} />
            <Meta label="Owner" value={report.owner} />
          </div>
          <div className="mt-6 grid gap-2">
            <button type="button" onClick={onDownload} className={primaryButtonClass()}>
              <Icon name="download" />
              Download
            </button>
            <button type="button" onClick={onArchive} className={secondaryButtonClass()}>Archive</button>
            <button type="button" onClick={onClose} className={secondaryButtonClass()}>Close</button>
          </div>
        </aside>
      </div>
    </ModalShell>
  );
}

function GenerateReportModal({ onClose, onGenerate }) {
  const [form, setForm] = useState({
    reportType: 'SME Tax Summary',
    taxYear: 'YA 2026',
    period: 'May 2026',
    includeIncomeSummary: true,
    includeExpenseSummary: true,
    includeDeductibleEstimate: true,
    includeOverallDeductibleTax: true,
    includeOcrEvidence: true,
    includeAccountantReviewNotes: false,
  });

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <ModalShell title="Generate Report" subtitle="Create a mock SME report from selected sections." onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onGenerate(form);
        }}
      >
        <FormSelect label="Report Type" value={form.reportType} options={reportCategories} onChange={(value) => updateField('reportType', value)} />
        <FormSelect label="Tax Year" value={form.taxYear} options={taxYearOptions} onChange={(value) => updateField('taxYear', value)} />
        <FormSelect label="Report Period" value={form.period} options={periodOptions} onChange={(value) => updateField('period', value)} />
        <div className="rounded-lg border border-[#E2E8F0] p-4">
          <p className="text-sm font-semibold text-[#0F172A]">Included sections</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Checkbox label="Include Income Summary" checked={form.includeIncomeSummary} onChange={(value) => updateField('includeIncomeSummary', value)} />
            <Checkbox label="Include Expense Summary" checked={form.includeExpenseSummary} onChange={(value) => updateField('includeExpenseSummary', value)} />
            <Checkbox label="Include Deductible Amount Estimate" checked={form.includeDeductibleEstimate} onChange={(value) => updateField('includeDeductibleEstimate', value)} />
            <Checkbox label="Include Overall Deductible Tax" checked={form.includeOverallDeductibleTax} onChange={(value) => updateField('includeOverallDeductibleTax', value)} />
            <Checkbox label="Include OCR Evidence" checked={form.includeOcrEvidence} onChange={(value) => updateField('includeOcrEvidence', value)} />
            <Checkbox label="Include Accountant Review Notes" checked={form.includeAccountantReviewNotes} onChange={(value) => updateField('includeAccountantReviewNotes', value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass()}>Cancel</button>
          <button type="submit" className={primaryButtonClass()}>Generate Report</button>
        </div>
      </form>
    </ModalShell>
  );
}

function UploadReportModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    title: '',
    category: 'SME Tax Summary',
    taxYear: 'YA 2026',
    totalAmount: '',
    deductibleAmount: '',
    overallDeductibleTax: '',
    estimatedTaxImpact: '',
    fileName: '',
    notes: '',
  });

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <ModalShell title="Upload Report" subtitle="Add an uploaded SME business report to the mock vault." onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...form, title: form.title.trim() || 'Uploaded SME Business Report' });
        }}
      >
        <FormInput label="Report title" value={form.title} placeholder="e.g. June 2026 Expense Pack" onChange={(value) => updateField('title', value)} />
        <FormSelect label="Category" value={form.category} options={reportCategories} onChange={(value) => updateField('category', value)} />
        <FormSelect label="Tax Year" value={form.taxYear} options={taxYearOptions} onChange={(value) => updateField('taxYear', value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormInput label="Total Amount" value={form.totalAmount} placeholder="e.g. RM18,420" onChange={(value) => updateField('totalAmount', value)} />
          <FormInput label="Deductible Amount" value={form.deductibleAmount} placeholder="e.g. RM15,900" onChange={(value) => updateField('deductibleAmount', value)} />
          <FormInput label="Overall Deductible Tax" value={form.overallDeductibleTax} placeholder="e.g. RM1,590" onChange={(value) => updateField('overallDeductibleTax', value)} />
          <FormInput label="Estimated Tax Impact" value={form.estimatedTaxImpact} placeholder="e.g. RM1,120" onChange={(value) => updateField('estimatedTaxImpact', value)} />
        </div>
        <label className="block">
          <span className="text-sm font-semibold text-[#0F172A]">File upload area</span>
          <div className="mt-2 rounded-xl border border-dashed border-[#C6C6CD] bg-[#F8FAFC] p-5 text-center">
            <input
              type="file"
              onChange={(event) => updateField('fileName', event.target.files?.[0]?.name || '')}
              className="w-full text-sm text-[#64748B] file:mr-4 file:rounded-lg file:border-0 file:bg-[#0F6E56] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
            />
            <p className="mt-2 text-xs text-[#64748B]">{form.fileName || 'Select a PDF, spreadsheet, or document for mock upload.'}</p>
          </div>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#0F172A]">Notes</span>
          <textarea
            value={form.notes}
            onChange={(event) => updateField('notes', event.target.value)}
            placeholder="Add accountant notes, source details, or internal reminders..."
            rows={4}
            className="mt-2 w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] outline-none transition focus:border-[#0D9488] focus:ring-4 focus:ring-[#0D9488]/10"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass()}>Cancel</button>
          <button type="submit" className={primaryButtonClass()}>Save Report</button>
        </div>
      </form>
    </ModalShell>
  );
}

function RenameReportModal({ report, onClose, onRename }) {
  const [name, setName] = useState(report.name);

  return (
    <ModalShell title="Rename Report" subtitle={report.category} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onRename(report.id, name.trim() || report.name);
        }}
      >
        <FormInput label="Report name" value={name} onChange={setName} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass()}>Cancel</button>
          <button type="submit" className={primaryButtonClass()}>Save Name</button>
        </div>
      </form>
    </ModalShell>
  );
}

function ConfirmDeleteModal({ report, onClose, onDelete }) {
  return (
    <ModalShell title="Delete report?" subtitle="This only removes the mock report from the frontend list." onClose={onClose}>
      <p className="text-sm leading-6 text-[#5F5E5A]">
        Delete <span className="font-semibold text-[#0F172A]">{report.name}</span> from the Report Vault?
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryButtonClass()}>Cancel</button>
        <button type="button" onClick={() => onDelete(report.id)} className={dangerButtonClass()}>Delete Report</button>
      </div>
    </ModalShell>
  );
}

function FormInput({ label, value, onChange, placeholder = '' }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-[#0F172A]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 h-11 w-full rounded-lg border border-[#E2E8F0] px-3 text-sm text-[#0F172A] outline-none transition focus:border-[#0D9488] focus:ring-4 focus:ring-[#0D9488]/10"
      />
    </label>
  );
}

function FormSelect({ label, value, options, onChange }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-[#0F172A]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-lg border border-[#E2E8F0] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-[#0D9488] focus:ring-4 focus:ring-[#0D9488]/10"
      >
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-[#334155]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-[#E2E8F0] accent-[#0F6E56]"
      />
      {label}
    </label>
  );
}

export default ReportVault;
