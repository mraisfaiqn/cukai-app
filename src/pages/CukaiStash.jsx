import { useMemo, useRef, useState } from 'react';

// Shared report category options used by filters, upload form, and generation form.
// Keeping the labels in one place avoids small spelling differences across the page.
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

// Cukai Stash uses tabs to keep related SME report workflows on one page.
// No route changes are needed when users move between reports, receipts, OCR, and documents.
const stashTabs = [
  { id: 'reports', label: 'Reports' },
  { id: 'generate', label: 'Generate Report' },
  { id: 'receipts', label: 'Linked Supporting Receipts' },
  { id: 'ocr', label: 'OCR Evidence' },
  { id: 'sources', label: 'Source Documents' },
];

const receiptCategoryOptions = [
  'All',
  'Supplier Purchases',
  'Utilities',
  'Rental',
  'Transport',
  'Maintenance',
  'Marketing',
  'Payroll',
  'Office Expenses',
];

// Mock SME financial breakdown used for the donut chart.
// These categories represent income and expense classifications, not final tax results.
const chartSegments = [
  { label: 'Service Income', value: 52800, color: '#0F6E56' },
  { label: 'Product Sales', value: 44300, color: '#1D9E75' },
  { label: 'Supplier Purchases', value: 21500, color: '#0D9488' },
  { label: 'Utilities & Rental', value: 14200, color: '#10B981' },
  { label: 'Payroll & Staff Cost', value: 18900, color: '#64748B' },
  { label: 'Marketing & Admin', value: 8600, color: '#BA7517' },
  { label: 'Transport & Maintenance', value: 6760, color: '#7C839B' },
  { label: 'Review / Non-Deductible', value: 2500, color: '#E24B4A' },
];

// Key SME tax values shown beside the chart so users can read the main numbers quickly.
// Values are AI-assisted estimates in this frontend prototype.
const chartCallouts = [
  { label: 'Total Reported Income', value: 'RM128,500' },
  { label: 'Total Deductible Expenses', value: 'RM68,900' },
  { label: 'Overall Deductible Tax', value: 'RM6,890' },
  { label: 'Estimated Tax Impact', value: 'RM4,860' },
];

// Short explanations used both by the page and report preview modal.
// They help teammates understand what each report type means for SME users.
const reportSectionExplanations = [
  {
    title: 'SME Tax Summary',
    explanation: 'Summarizes SME income, deductible expenses, estimated tax impact, and tax readiness.',
  },
  {
    title: 'Business Income Report',
    explanation: 'Shows service income, product sales, customer invoices, and payment records.',
  },
  {
    title: 'Business Expense Report',
    explanation: 'Groups supplier purchases, utilities, rental, transport, maintenance, payroll, marketing, and office costs.',
  },
  {
    title: 'Profit & Loss Summary',
    explanation: 'Compares income and expenses to estimate business profit before accountant review.',
  },
  {
    title: 'OCR Extraction Report',
    explanation: 'Lists OCR-processed source documents, extracted values, confidence scores, missing fields, and manual review items.',
  },
  {
    title: 'E-Invoice Readiness Report',
    explanation: 'Tracks invoice field completeness, supplier/customer details, and e-Invoice readiness.',
  },
  {
    title: 'Accountant Review Pack',
    explanation: 'Packages key reports and supporting documents for accountant or tax agent review.',
  },
  {
    title: 'Tax Readiness Checklist',
    explanation: 'Highlights missing documents, incomplete records, and items not yet tax-ready.',
  },
  {
    title: 'Overall Deductible Tax',
    explanation: 'Explains AI-assisted estimated deductible tax value from categorized SME expenses. It is not a final tax calculation.',
  },
];

// Mock SME report data used for frontend showcase only.
// In the final system, this list can be replaced with API data from the backend.
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
    linkedSupportingReceipts: 38,
    sourceDocuments: 8,
    ocrEvidenceIncluded: 38,
    accountantReviewRequired: false,
    createdDate: '01 Jun 2026',
    lastUpdated: '02 Jun 2026',
    status: 'Ready',
    notes: 'Prepared from SME business income, deductible business expenses, and linked supporting receipts.',
    includedSections: ['Income summary', 'Expense summary', 'Estimated deductible amount', 'Overall deductible tax'],
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
    linkedSupportingReceipts: 16,
    sourceDocuments: 4,
    ocrEvidenceIncluded: 16,
    accountantReviewRequired: true,
    createdDate: '30 May 2026',
    lastUpdated: '01 Jun 2026',
    status: 'Needs Review',
    notes: 'Several linked source documents require accountant review before deductible business expense treatment is finalized.',
    includedSections: ['Expense summary', 'Supporting receipts', 'OCR evidence', 'Needs accountant review'],
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
    linkedSupportingReceipts: 12,
    sourceDocuments: 5,
    ocrEvidenceIncluded: 6,
    accountantReviewRequired: false,
    createdDate: '28 May 2026',
    lastUpdated: '29 May 2026',
    status: 'Ready',
    notes: 'Monthly income summary is reconciled against uploaded invoices.',
    includedSections: ['Income summary', 'Linked source documents', 'E-invoice items'],
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
    linkedSupportingReceipts: 24,
    sourceDocuments: 6,
    ocrEvidenceIncluded: 24,
    accountantReviewRequired: true,
    createdDate: '26 May 2026',
    lastUpdated: '30 May 2026',
    status: 'Draft',
    notes: 'Draft audit of OCR evidence, extraction confidence, missing fields, and linked supporting receipts.',
    includedSections: ['OCR evidence', 'Linked source documents', 'Confidence scores', 'Manual review items'],
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
    linkedSupportingReceipts: 0,
    sourceDocuments: 3,
    ocrEvidenceIncluded: 0,
    accountantReviewRequired: false,
    createdDate: '22 May 2026',
    lastUpdated: '31 May 2026',
    status: 'Ready',
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
    linkedSupportingReceipts: 38,
    sourceDocuments: 8,
    ocrEvidenceIncluded: 38,
    accountantReviewRequired: true,
    createdDate: '01 May 2026',
    lastUpdated: '01 May 2026',
    status: 'Archived',
    notes: 'Archived pack shared for accountant review on 1 May 2026.',
    includedSections: ['Tax summary', 'Income summary', 'Expense summary', 'Supporting receipts', 'OCR evidence'],
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
    linkedSupportingReceipts: 31,
    sourceDocuments: 7,
    ocrEvidenceIncluded: 31,
    accountantReviewRequired: false,
    createdDate: '18 May 2026',
    lastUpdated: '25 May 2026',
    status: 'Ready',
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
    linkedSupportingReceipts: 0,
    sourceDocuments: 2,
    ocrEvidenceIncluded: 0,
    accountantReviewRequired: true,
    createdDate: '15 May 2026',
    lastUpdated: '28 May 2026',
    status: 'Needs Review',
    notes: 'Review missing linked supporting documents before accountant export.',
    includedSections: ['Tax readiness status', 'Supporting documents', 'Accountant review'],
  },
];

// Small top-level counts shown above the tab content.
// These are mock dashboard values for the Cukai Stash prototype.
const summaryCards = [
  { label: 'Total Reports', value: '24', tone: 'neutral' },
  { label: 'Needs Review', value: '5', tone: 'amber' },
  { label: 'Ready to Export', value: '12', tone: 'teal' },
];

// Mock linked supporting receipts used as evidence behind SME reports.
// Receipts support audit trail review, but they are not treated as guaranteed tax claims.
const initialReceipts = [
  {
    id: 1,
    name: 'Midea Supplier Invoice',
    vendor: 'Midea Malaysia Sdn Bhd',
    category: 'Supplier Purchases',
    amount: 'RM2,480.00',
    linkedReport: 'May 2026 Expense Breakdown',
    ocrConfidence: 92,
    status: 'Needs Review',
    extractedFields: ['Vendor name', 'Invoice date', 'Total amount', 'SST amount'],
    notes: 'Supplier invoice linked as deductible business expense evidence.',
  },
  {
    id: 2,
    name: 'TNB Utility Bill',
    vendor: 'Tenaga Nasional Berhad',
    category: 'Utilities',
    amount: 'RM420.60',
    linkedReport: 'Profit & Loss Summary',
    ocrConfidence: 94,
    status: 'Linked',
    extractedFields: ['Account number', 'Billing period', 'Total amount'],
    notes: 'Utility bill linked to operating expense records.',
  },
  {
    id: 3,
    name: 'Shop Rental Receipt',
    vendor: 'Property Owner',
    category: 'Rental',
    amount: 'RM2,000.00',
    linkedReport: 'SME Tax Summary',
    ocrConfidence: 96,
    status: 'Linked',
    extractedFields: ['Receipt date', 'Rental period', 'Amount paid'],
    notes: 'Rental evidence for business premise operating cost.',
  },
  {
    id: 4,
    name: 'Petrol Receipt',
    vendor: 'Petronas',
    category: 'Transport',
    amount: 'RM120.00',
    linkedReport: 'May 2026 Expense Breakdown',
    ocrConfidence: 81,
    status: 'Needs Business Use Review',
    extractedFields: ['Vendor', 'Amount', 'Transaction date'],
    notes: 'Needs business-use note before accountant review.',
  },
  {
    id: 5,
    name: 'Facebook Ads Receipt',
    vendor: 'Meta Platforms',
    category: 'Marketing',
    amount: 'RM350.00',
    linkedReport: 'Business Expense Report',
    ocrConfidence: 89,
    status: 'Linked',
    extractedFields: ['Campaign billing date', 'Amount', 'Vendor'],
    notes: 'Marketing expense evidence linked to expense report.',
  },
  {
    id: 6,
    name: 'Aircond Spare Parts Invoice',
    vendor: 'Local Supplier',
    category: 'Maintenance',
    amount: 'RM760.00',
    linkedReport: 'Expense Breakdown',
    ocrConfidence: 78,
    status: 'Low Confidence',
    extractedFields: ['Vendor', 'Amount'],
    notes: 'Invoice number requires manual verification.',
  },
];

// Mock OCR evidence data used to show extraction confidence and missing fields.
// This supports the review workflow before a report is treated as accountant-ready.
const initialOcrEvidence = [
  {
    id: 1,
    document: 'Midea Supplier Invoice',
    extractedAmount: 'RM2,480.00',
    extractedDate: '12 May 2026',
    extractedVendor: 'Midea Malaysia Sdn Bhd',
    confidence: 92,
    missingFields: 'None',
    linkedReport: 'May Expense Breakdown',
    status: 'Verified',
  },
  {
    id: 2,
    document: 'Petrol Receipt',
    extractedAmount: 'RM120.00',
    extractedDate: '10 May 2026',
    extractedVendor: 'Petronas',
    confidence: 81,
    missingFields: 'Business Use Note',
    linkedReport: 'May Expense Breakdown',
    status: 'Needs Review',
  },
  {
    id: 3,
    document: 'Spare Parts Invoice',
    extractedAmount: 'RM760.00',
    extractedDate: '8 May 2026',
    extractedVendor: 'Local Supplier',
    confidence: 78,
    missingFields: 'Invoice Number',
    linkedReport: 'OCR Extraction Audit',
    status: 'Low Confidence',
  },
  {
    id: 4,
    document: 'Rental Receipt',
    extractedAmount: 'RM2,000.00',
    extractedDate: '1 May 2026',
    extractedVendor: 'Property Owner',
    confidence: 96,
    missingFields: 'None',
    linkedReport: 'SME Tax Summary',
    status: 'Verified',
  },
];

// Source document types used by the Source Documents filter chips.
// These are broader audit-trail files such as bank statements, agreements, and payroll summaries.
const sourceDocumentTypes = [
  'Bank Statement',
  'E-Invoice Record',
  'Agreement / Contract',
  'Payroll Summary',
  'Payment Gateway Statement',
  'Supplier Statement',
  'Accountant Note',
  'Business Registration Document',
];

// Mock source documents used for frontend-only filtering and linking.
// In production, these would usually come from uploaded documents or backend storage.
const initialSourceDocuments = [
  {
    id: 1,
    name: 'Bank Statement May 2026',
    type: 'Bank Statement',
    period: 'May 2026',
    linkedReport: 'SME Tax Summary',
    uploadedDate: '02 Jun 2026',
    status: 'Linked',
  },
  {
    id: 2,
    name: 'E-Invoice Batch May 2026',
    type: 'E-Invoice Record',
    period: 'May 2026',
    linkedReport: 'E-Invoice Readiness Checklist',
    uploadedDate: '31 May 2026',
    status: 'Linked',
  },
  {
    id: 3,
    name: 'Shop Rental Agreement',
    type: 'Agreement / Contract',
    period: 'YA 2026',
    linkedReport: 'Accountant Review Pack',
    uploadedDate: '01 May 2026',
    status: 'Linked',
  },
  {
    id: 4,
    name: 'Payroll Summary May 2026',
    type: 'Payroll Summary',
    period: 'May 2026',
    linkedReport: 'Profit & Loss Summary',
    uploadedDate: '30 May 2026',
    status: 'Needs Review',
  },
  {
    id: 5,
    name: 'Payment Gateway Statement',
    type: 'Payment Gateway Statement',
    period: 'May 2026',
    linkedReport: 'Business Income Report',
    uploadedDate: '29 May 2026',
    status: 'Linked',
  },
  {
    id: 6,
    name: 'Supplier Statement May 2026',
    type: 'Supplier Statement',
    period: 'May 2026',
    linkedReport: 'Business Expense Report',
    uploadedDate: '28 May 2026',
    status: 'Needs Review',
  },
  {
    id: 7,
    name: 'Accountant Review Note',
    type: 'Accountant Note',
    period: 'YA 2026',
    linkedReport: 'Accountant Review Pack',
    uploadedDate: '25 May 2026',
    status: 'Linked',
  },
  {
    id: 8,
    name: 'Business Registration Document',
    type: 'Business Registration Document',
    period: 'YA 2026',
    linkedReport: 'SME Tax Summary',
    uploadedDate: '20 May 2026',
    status: 'Linked',
  },
];

// Converts a status value into a compact badge style.
// Color helps users quickly separate Ready, Needs Review, Archived, and error states in dense tables.
function StatusBadge({ status }) {
  const styles = {
    Ready: 'border-[#8DE7C6] bg-[#E1F5EE] text-[#0F6E56]',
    'Needs Review': 'border-[#F8D891] bg-[#FFF7E5] text-[#BA7517]',
    Draft: 'border-slate-200 bg-slate-100 text-slate-600',
    Archived: 'border-[#D9D7D0] bg-[#F2F1EC] text-[#5F5E5A]',
    Failed: 'border-[#F7B8B8] bg-[#FFF0F0] text-[#E24B4A]',
    Linked: 'border-[#8DE7C6] bg-[#E1F5EE] text-[#0F6E56]',
    Reviewed: 'border-[#8DE7C6] bg-[#E1F5EE] text-[#0F6E56]',
    Verified: 'border-[#8DE7C6] bg-[#E1F5EE] text-[#0F6E56]',
    'Low Confidence': 'border-[#F7B8B8] bg-[#FFF0F0] text-[#E24B4A]',
    'Needs Business Use Review': 'border-[#F8D891] bg-[#FFF7E5] text-[#BA7517]',
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[status] || styles.Draft}`}>
      {status}
    </span>
  );
}

// Displays RM values in table cells with right alignment and tabular numbers.
// This keeps financial columns easy to scan and compare.
function MoneyValue({ value }) {
  return (
    <span className="block text-right font-mono tabular-nums text-[#0F172A]">
      {value || 'RM0'}
    </span>
  );
}

// Normalizes optional money inputs from upload forms into a consistent RM format.
// Centralizing this avoids different table rows showing different currency styles.
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

// Formats numeric chart values as Malaysian Ringgit labels.
function formatRm(value) {
  return `RM${value.toLocaleString('en-MY')}`;
}

// Converts a numeric OCR confidence score into the label used by badges and filters.
function getConfidenceLevel(value) {
  if (value >= 90) return 'High';
  if (value >= 70) return 'Medium';
  return 'Low';
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

// Button class helpers keep repeated button styles consistent across tables, cards, and modals.
function primaryButtonClass(extra = '') {
  return `inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F6E56] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0D5F4B] ${extra}`;
}

function secondaryButtonClass(extra = '') {
  return `inline-flex items-center justify-center gap-2 rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm font-semibold text-[#0F172A] transition hover:border-[#0D9488] hover:bg-[#f0fdf9] hover:text-[#0D9488] ${extra}`;
}

function dangerButtonClass(extra = '') {
  return `inline-flex items-center justify-center gap-2 rounded-lg border border-[#F7B8B8] bg-white px-4 py-2.5 text-sm font-semibold text-[#E24B4A] transition hover:bg-[#FFF0F0] ${extra}`;
}

// Reusable modal shell used by preview, upload, rename, delete, and link flows.
// Each modal receives content through children but keeps the same overlay and spacing.
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

function CukaiStash() {
  // Controls which Cukai Stash tab is displayed.
  // This keeps Reports, Generate Report, Linked Receipts, OCR Evidence, and Source Documents inside one route.
  const [activeTab, setActiveTab] = useState('reports');

  // Main mock datasets stored in React state so table actions can update the UI immediately.
  // A backend can later replace these local arrays with API-loaded data.
  const [reports, setReports] = useState(initialReports);
  const [receipts, setReceipts] = useState(initialReceipts);
  const [ocrEvidence, setOcrEvidence] = useState(initialOcrEvidence);
  const [sourceDocuments, setSourceDocuments] = useState(initialSourceDocuments);

  // Filters for the Reports tab.
  // These values control search, category, status, and tax year filtering in the report table.
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All Categories');
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [taxYearFilter, setTaxYearFilter] = useState('All Tax Years');

  // Filters for the Linked Supporting Receipts tab.
  // The category filter is connected to clickable chips, while status and report filters use dropdowns.
  const [receiptSearch, setReceiptSearch] = useState('');
  const [receiptCategoryFilter, setReceiptCategoryFilter] = useState('All');
  const [receiptStatusFilter, setReceiptStatusFilter] = useState('All Statuses');
  const [receiptReportFilter, setReceiptReportFilter] = useState('All Reports');

  // Filters for the OCR Evidence tab.
  // Users can narrow OCR records by document name, confidence level, missing fields, and status.
  const [ocrSearch, setOcrSearch] = useState('');
  const [ocrConfidenceFilter, setOcrConfidenceFilter] = useState('All Confidence');
  const [ocrMissingFilter, setOcrMissingFilter] = useState('All Missing Fields');
  const [ocrStatusFilter, setOcrStatusFilter] = useState('All Statuses');

  // Filters for the Source Documents tab.
  // The source category filter is driven by document-type chips such as Bank Statement or Payroll Summary.
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceCategoryFilter, setSourceCategoryFilter] = useState('All');
  const [sourceStatusFilter, setSourceStatusFilter] = useState('All Statuses');

  // Selected item states decide which preview/detail modal is open.
  // Storing the selected object keeps modal content simple and avoids separate "show modal" booleans.
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [selectedOcr, setSelectedOcr] = useState(null);
  const [selectedSource, setSelectedSource] = useState(null);

  // Modal control state for linking evidence, uploading reports, renaming, and delete confirmation.
  const [linkTarget, setLinkTarget] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renameReport, setRenameReport] = useState(null);
  const [deleteReport, setDeleteReport] = useState(null);

  // Toast state gives mock success feedback for frontend-only actions such as download and export.
  const [toast, setToast] = useState('');
  const toastTimeoutRef = useRef(null);

  // Provides unique IDs for reports created during this local frontend session.
  const nextReportIdRef = useRef(9);

  // Filters the report list based on search text, category, status, and tax year.
  // This helps SME users find the right generated report without scrolling through every record.
  const filteredReports = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return reports.filter((report) => {
      const matchesSearch = !normalizedSearch || [report.name, report.category, report.status, report.taxYear]
        .some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesCategory = categoryFilter === 'All Categories' || report.category === categoryFilter;
      const matchesStatus = statusFilter === 'All Statuses' || report.status === statusFilter;
      const matchesYear = taxYearFilter === 'All Tax Years' || report.taxYear === taxYearFilter;

      return matchesSearch && matchesCategory && matchesStatus && matchesYear;
    });
  }, [reports, search, categoryFilter, statusFilter, taxYearFilter]);

  // Used by link modals so receipts and source documents can be connected to existing reports.
  const reportNames = useMemo(() => reports.map((report) => report.name), [reports]);

  // Filters linked receipts by search text, category chip, status, and linked report.
  // The category chip filter makes supporting evidence easier to review by expense type.
  const filteredReceipts = useMemo(() => {
    const normalizedSearch = receiptSearch.trim().toLowerCase();

    return receipts.filter((receipt) => {
      const matchesSearch = !normalizedSearch || [receipt.name, receipt.vendor, receipt.category, receipt.linkedReport]
        .some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesCategory = receiptCategoryFilter === 'All' || receipt.category === receiptCategoryFilter;
      const matchesStatus = receiptStatusFilter === 'All Statuses' || receipt.status === receiptStatusFilter;
      const matchesReport = receiptReportFilter === 'All Reports' || receipt.linkedReport === receiptReportFilter;

      return matchesSearch && matchesCategory && matchesStatus && matchesReport;
    });
  }, [receipts, receiptSearch, receiptCategoryFilter, receiptStatusFilter, receiptReportFilter]);

  // Filters source documents by search text, selected document-type chip, and status.
  // This turns the Source Document Filters chips into real working filters.
  const filteredSourceDocuments = useMemo(() => {
    const normalizedSearch = sourceSearch.trim().toLowerCase();

    return sourceDocuments.filter((document) => {
      const matchesSearch = !normalizedSearch || [document.name, document.type, document.period, document.linkedReport]
        .some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesCategory = sourceCategoryFilter === 'All' || document.type === sourceCategoryFilter;
      const matchesStatus = sourceStatusFilter === 'All Statuses' || document.status === sourceStatusFilter;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [sourceDocuments, sourceSearch, sourceCategoryFilter, sourceStatusFilter]);

  // Filters OCR evidence by document name, confidence band, missing-field status, and review status.
  // This helps users quickly find low-confidence or incomplete OCR records.
  const filteredOcrEvidence = useMemo(() => {
    const normalizedSearch = ocrSearch.trim().toLowerCase();

    return ocrEvidence.filter((item) => {
      const confidenceLevel = getConfidenceLevel(item.confidence);
      const matchesSearch = !normalizedSearch || item.document.toLowerCase().includes(normalizedSearch);
      const matchesConfidence = ocrConfidenceFilter === 'All Confidence' || confidenceLevel === ocrConfidenceFilter;
      const matchesMissing = ocrMissingFilter === 'All Missing Fields' || (ocrMissingFilter === 'Has Missing Fields' ? item.missingFields !== 'None' : item.missingFields === 'None');
      const matchesStatus = ocrStatusFilter === 'All Statuses' || item.status === ocrStatusFilter;

      return matchesSearch && matchesConfidence && matchesMissing && matchesStatus;
    });
  }, [ocrEvidence, ocrSearch, ocrConfidenceFilter, ocrMissingFilter, ocrStatusFilter]);

  // Shows short frontend-only feedback messages after actions.
  // The timeout ref clears the previous timer so repeated actions do not leave stale toasts.
  function showToast(message) {
    setToast(message);
    window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToast(''), 2600);
  }

  // Resets every search and filter across all Cukai Stash tabs.
  // This gives users one simple way to recover from a filter combination that returns no results.
  function clearFilters() {
    setSearch('');
    setCategoryFilter('All Categories');
    setStatusFilter('All Statuses');
    setTaxYearFilter('All Tax Years');
    setReceiptSearch('');
    setReceiptCategoryFilter('All');
    setReceiptStatusFilter('All Statuses');
    setReceiptReportFilter('All Reports');
    setOcrSearch('');
    setOcrConfidenceFilter('All Confidence');
    setOcrMissingFilter('All Missing Fields');
    setOcrStatusFilter('All Statuses');
    setSourceSearch('');
    setSourceCategoryFilter('All');
    setSourceStatusFilter('All Statuses');
    showToast('Filters cleared');
  }

  // Updates report status in both the table list and the open preview modal if that report is selected.
  // This keeps the modal and table synchronized after Archive is clicked.
  function updateReportStatus(id, status) {
    setReports((current) => current.map((report) => (
      report.id === id ? { ...report, status, lastUpdated: '02 Jun 2026' } : report
    )));
    setSelectedReport((current) => (
      current && current.id === id ? { ...current, status, lastUpdated: '02 Jun 2026' } : current
    ));
  }

  // Archives a report by changing its status instead of deleting it.
  // Archived reports remain visible as historical SME records and accountant review evidence.
  function archiveReport(report) {
    updateReportStatus(report.id, 'Archived');
    showToast('Report archived');
  }

  // Mock download action for the frontend prototype.
  // No real file is created because the page is not connected to backend storage yet.
  function downloadReport() {
    showToast('Download started');
  }

  // Mock export action for all reports.
  // In a backend version, this would trigger a batch export or accountant pack download.
  function exportAll() {
    showToast('Export started');
  }

  // Marks a linked supporting receipt as reviewed.
  // This helps show which receipt evidence has already been checked for SME tax preparation.
  function markReceiptReviewed(id) {
    setReceipts((current) => current.map((receipt) => (
      receipt.id === id ? { ...receipt, status: 'Reviewed' } : receipt
    )));
    showToast('Receipt marked reviewed');
  }

  // Links a receipt or source document to a selected report.
  // This supports the audit trail by showing which evidence belongs to each generated SME report.
  function updateLinkedReport(target, linkedReport) {
    if (target.type === 'receipt') {
      setReceipts((current) => current.map((receipt) => (
        receipt.id === target.item.id ? { ...receipt, linkedReport, status: 'Linked' } : receipt
      )));
    }

    if (target.type === 'source') {
      setSourceDocuments((current) => current.map((document) => (
        document.id === target.item.id ? { ...document, linkedReport, status: 'Linked' } : document
      )));
    }

    setLinkTarget(null);
    showToast('Linked report updated');
  }

  // Mock OCR recheck action.
  // It slightly increases confidence and returns the item to Needs Review to represent a new extraction pass.
  function recheckOcr(id) {
    setOcrEvidence((current) => current.map((item) => (
      item.id === id ? { ...item, confidence: Math.min(item.confidence + 5, 99), status: 'Needs Review' } : item
    )));
    showToast('OCR recheck started');
  }

  // Marks OCR evidence as verified and clears missing fields.
  // This is useful before creating an accountant-ready report pack.
  function markOcrVerified(id) {
    setOcrEvidence((current) => current.map((item) => (
      item.id === id ? { ...item, status: 'Verified', missingFields: 'None' } : item
    )));
    showToast('OCR evidence marked verified');
  }

  // Archives a source document without removing it from state.
  // This preserves historical documents while keeping their current status clear.
  function archiveSourceDocument(id) {
    setSourceDocuments((current) => current.map((document) => (
      document.id === id ? { ...document, status: 'Archived' } : document
    )));
    showToast('Source document archived');
  }

  // Switches to the Generate Report tab from the page CTA.
  // It keeps navigation inside Cukai Stash without creating another route.
  function focusGeneratePanel() {
    setActiveTab('generate');
  }

  // Creates a new SME report from the Generate Report tab options.
  // For this frontend showcase, the report is added to local React state instead of a real database.
  function addGeneratedReport(form) {
    const newReport = {
      id: nextReportIdRef.current++,
      name: form.reportName.trim() || `${form.period} ${form.reportType}`,
      category: form.reportType,
      taxYear: form.taxYear,
      totalAmount: form.includeIncomeSummary ? 'RM36,800' : 'RM0',
      deductibleAmount: form.includeDeductibleEstimate ? 'RM18,950' : 'RM0',
      overallDeductibleTax: form.includeOverallDeductibleTax ? 'RM1,895' : 'RM0',
      estimatedTaxImpact: form.includeDeductibleEstimate ? 'RM1,340' : 'Needs Accountant Review',
      reviewAmount: form.includeAccountantReviewNotes ? 'Needs Accountant Review' : 'RM17,850',
      linkedSupportingReceipts: form.includeExpenseSummary ? 14 : 0,
      sourceDocuments: 3,
      ocrEvidenceIncluded: form.includeOcrEvidence ? 14 : 0,
      accountantReviewRequired: form.includeAccountantReviewNotes,
      createdDate: '03 Jun 2026',
      lastUpdated: '03 Jun 2026',
      // Draft is used when accountant review notes are included because the report still needs checking.
      status: form.includeAccountantReviewNotes ? 'Draft' : 'Ready',
      notes: `Generated as ${form.reportFormat} from selected SME report sections, linked supporting receipts, and mock business data.`,
      includedSections: [
        form.includeIncomeSummary && 'Income summary',
        form.includeExpenseSummary && 'Expense summary',
        form.includeProfitLossSummary && 'Profit & loss summary',
        form.includeDeductibleEstimate && 'Deductible amount estimate',
        form.includeEstimatedTaxImpact && 'Estimated tax impact',
        form.includeOverallDeductibleTax && 'Overall deductible tax',
        form.includeLinkedReceipts && 'Linked supporting receipts',
        form.includeOcrEvidence && 'OCR document evidence',
        form.includeSourceDocuments && 'Source documents',
        form.includeAccountantReviewNotes && 'Accountant review notes',
      ].filter(Boolean),
    };

    setReports((current) => [newReport, ...current]);
    showToast('Report generated');
    setActiveTab('reports');
  }

  // Adds an uploaded report into the same mock report table.
  // File upload is simulated here; only the selected filename and entered values are stored in state.
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
      linkedSupportingReceipts: Number.isFinite(Number(form.linkedSupportingReceipts)) ? Number(form.linkedSupportingReceipts) : 0,
      sourceDocuments: form.fileName ? 1 : 0,
      ocrEvidenceIncluded: form.fileName ? 1 : 0,
      accountantReviewRequired: true,
      createdDate: '03 Jun 2026',
      lastUpdated: '03 Jun 2026',
      status: 'Draft',
      notes: form.notes || `Uploaded file: ${form.fileName || 'Mock document'}`,
      includedSections: ['Uploaded document', 'Manual notes'],
    };

    setReports((current) => [newReport, ...current]);
    setUploadOpen(false);
    showToast('Report saved');
  }

  // Renames a report from the Report Name column edit action.
  // Only the matching report is updated, and lastUpdated changes to show a local edit happened.
  function renameSelectedReport(id, name) {
    setReports((current) => current.map((report) => (
      report.id === id ? { ...report, name, lastUpdated: '02 Jun 2026' } : report
    )));
    setRenameReport(null);
    showToast('Report renamed');
  }

  // Removes a report after the delete confirmation modal is accepted.
  // The confirmation modal prevents accidental deletion from the frontend list.
  function deleteSelectedReport(id) {
    setReports((current) => current.filter((report) => report.id !== id));
    if (selectedReport?.id === id) setSelectedReport(null);
    setDeleteReport(null);
    showToast('Report deleted');
  }

  return (
    <main className="min-h-screen bg-background font-body">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-headings text-3xl font-bold tracking-tight text-headings">Cukai Stash</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5F5E5A]">
              Generate, store, review, and export SME tax reports with linked supporting evidence.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <button type="button" onClick={focusGeneratePanel} className={primaryButtonClass()}>
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

        <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-[#E2E8F0] bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#64748B]">{card.label}</p>
              <p className={`mt-2 text-2xl font-bold tracking-tight ${card.tone === 'teal' ? 'text-[#0D9488]' : card.tone === 'amber' ? 'text-[#BA7517]' : 'text-[#0F172A]'}`}>
                {card.value}
              </p>
            </div>
          ))}
        </section>

        <StashTabs activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === 'reports' && (
          <>
        <section className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <TaxBreakdownChart />
          <section className="rounded-xl border border-[#E2E8F0] bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#0D9488]">Report Generation</p>
            <h2 className="mt-2 text-lg font-bold text-[#0F172A]">Need a new SME report?</h2>
            <p className="mt-2 text-sm leading-6 text-[#5F5E5A]">
              Generate a report from income records, deductible business expenses, OCR evidence, and source documents.
            </p>
            <button type="button" onClick={() => setActiveTab('generate')} className={primaryButtonClass('mt-5 w-full')}>
              Go to Generate Report
            </button>
          </section>
        </section>

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
                    placeholder="Search by report name, category, status, or tax year..."
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
                    <table className="min-w-[1480px] table-fixed text-left text-sm">
                    <thead className="bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#64748B]">
                      <tr>
                        <th className="w-[250px] px-4 py-3">Report Name</th>
                        <th className="w-[190px] px-4 py-3">Category</th>
                        <th className="w-[90px] px-4 py-3">Tax Year</th>
                        <th className="w-[130px] px-4 py-3 text-right">Total Amount</th>
                        <th className="w-[150px] px-4 py-3 text-right">Deductible Amount</th>
                        <th className="w-[155px] px-4 py-3 text-right">Overall Deductible Tax</th>
                        <th className="w-[155px] px-4 py-3 text-right">Estimated Tax Impact</th>
                        <th className="w-[120px] px-4 py-3">Created Date</th>
                        <th className="w-[115px] px-4 py-3">Status</th>
                        <th className="sticky right-0 z-10 w-[190px] bg-[#F8FAFC] px-4 py-3 text-right shadow-[-10px_0_16px_-16px_rgba(15,23,42,0.45)]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {filteredReports.map((report) => (
                        <tr key={report.id} className="group transition hover:bg-[#F8FAFC]">
                          <td className="px-4 py-4">
                            <div className="flex items-start gap-2">
                              <span className="font-semibold text-[#0F172A]">{report.name}</span>
                              <button
                                type="button"
                                onClick={() => setRenameReport(report)}
                                className="mt-0.5 shrink-0 rounded-full border border-[#BFE9DE] px-2 py-0.5 text-[11px] font-semibold text-[#0D9488] transition hover:bg-[#F0FDFA]"
                              >
                                Edit
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-[#5F5E5A]">{report.category}</td>
                          <td className="px-4 py-4 text-[#5F5E5A]">{report.taxYear}</td>
                          <td className="px-4 py-4"><MoneyValue value={report.totalAmount} /></td>
                          <td className="px-4 py-4"><MoneyValue value={report.deductibleAmount} /></td>
                          <td className="px-4 py-4"><MoneyValue value={report.overallDeductibleTax} /></td>
                          <td className="px-4 py-4"><MoneyValue value={report.estimatedTaxImpact} /></td>
                          <td className="px-4 py-4 text-[#5F5E5A]">{report.createdDate}</td>
                          <td className="px-4 py-4"><StatusBadge status={report.status} /></td>
                          <td className="sticky right-0 z-10 bg-white px-3 py-3 shadow-[-10px_0_16px_-16px_rgba(15,23,42,0.45)] group-hover:bg-[#F8FAFC]">
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              <RowAction label="View" onClick={() => setSelectedReport(report)} />
                              <RowAction label="Download" onClick={downloadReport} />
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
          </>
        )}

        {activeTab === 'generate' && (
          <GenerateReportPanel onGenerate={addGeneratedReport} />
        )}

        {activeTab === 'receipts' && (
          <LinkedReceiptsTab
            receipts={filteredReceipts}
            allReceipts={receipts}
            reportNames={reportNames}
            search={receiptSearch}
            categoryFilter={receiptCategoryFilter}
            statusFilter={receiptStatusFilter}
            reportFilter={receiptReportFilter}
            onSearchChange={setReceiptSearch}
            onCategoryChange={setReceiptCategoryFilter}
            onStatusChange={setReceiptStatusFilter}
            onReportChange={setReceiptReportFilter}
            onView={setSelectedReceipt}
            onLink={(receipt) => setLinkTarget({ type: 'receipt', item: receipt })}
            onDownload={downloadReport}
            onReviewed={markReceiptReviewed}
            onClear={clearFilters}
          />
        )}

        {activeTab === 'ocr' && (
          <OcrEvidenceTab
            evidence={filteredOcrEvidence}
            search={ocrSearch}
            confidenceFilter={ocrConfidenceFilter}
            missingFilter={ocrMissingFilter}
            statusFilter={ocrStatusFilter}
            onSearchChange={setOcrSearch}
            onConfidenceChange={setOcrConfidenceFilter}
            onMissingChange={setOcrMissingFilter}
            onStatusChange={setOcrStatusFilter}
            onView={setSelectedOcr}
            onRecheck={recheckOcr}
            onVerified={markOcrVerified}
            onClear={clearFilters}
          />
        )}

        {activeTab === 'sources' && (
          <SourceDocumentsTab
            documents={filteredSourceDocuments}
            search={sourceSearch}
            categoryFilter={sourceCategoryFilter}
            statusFilter={sourceStatusFilter}
            onSearchChange={setSourceSearch}
            onCategoryChange={setSourceCategoryFilter}
            onStatusChange={setSourceStatusFilter}
            onClear={clearFilters}
            onView={setSelectedSource}
            onDownload={downloadReport}
            onLink={(document) => setLinkTarget({ type: 'source', item: document })}
            onArchive={archiveSourceDocument}
          />
        )}
      </div>

      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] rounded-lg border border-[#BFE9DE] bg-white px-4 py-3 text-sm font-semibold text-[#0F6E56] shadow-xl">
          {toast}
        </div>
      )}

      {/* View buttons set one of these selected item states. When a selected item exists, its modal opens. */}
      {selectedReport && (
        <ReportPreviewModal
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
          onDownload={downloadReport}
          onArchive={() => archiveReport(selectedReport)}
        />
      )}
      {uploadOpen && <UploadReportModal onClose={() => setUploadOpen(false)} onSave={addUploadedReport} />}
      {renameReport && <RenameReportModal report={renameReport} onClose={() => setRenameReport(null)} onRename={renameSelectedReport} />}
      {deleteReport && <ConfirmDeleteModal report={deleteReport} onClose={() => setDeleteReport(null)} onDelete={deleteSelectedReport} />}
      {selectedReceipt && <ReceiptDetailModal receipt={selectedReceipt} onClose={() => setSelectedReceipt(null)} />}
      {selectedOcr && <OcrDetailModal item={selectedOcr} onClose={() => setSelectedOcr(null)} />}
      {selectedSource && <SourceDocumentModal document={selectedSource} onClose={() => setSelectedSource(null)} />}
      {linkTarget && (
        <LinkReportModal
          target={linkTarget}
          reportNames={reportNames}
          onClose={() => setLinkTarget(null)}
          onSave={updateLinkedReport}
        />
      )}
    </main>
  );
}

// Compact action button used inside wide tables.
// Keeping actions small helps View, Download, Archive, and Delete stay visible in the sticky Actions column.
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

// Renders the horizontal Cukai Stash tabs.
// The active tab is controlled by React state, so switching tabs does not reload the page.
function StashTabs({ activeTab, onChange }) {
  return (
    <div className="mb-6 overflow-x-auto border-b border-[#E2E8F0] bg-white/60">
      <div className="flex min-w-max gap-6 px-1">
        {stashTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`border-b-2 px-1 py-4 text-sm font-semibold transition ${activeTab === tab.id ? 'border-[#0D9488] text-[#0D9488]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Reusable summary cards for evidence tabs.
// These keep receipt, OCR, and source document counts visually consistent.
function EvidenceSummaryCards({ cards }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border border-[#E2E8F0] bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#64748B]">{card.label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-[#0F172A]">{card.value}</p>
        </div>
      ))}
    </section>
  );
}

function TabHeader({ title, subtitle }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#0D9488]">Cukai Stash</p>
      <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#0F172A]">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[#5F5E5A]">{subtitle}</p>
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }) {
  return (
    <label className="relative block">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]">
        <Icon name="search" />
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-lg border border-[#E2E8F0] bg-white pl-10 pr-3 text-sm text-[#0F172A] outline-none transition focus:border-[#0D9488] focus:ring-4 focus:ring-[#0D9488]/10"
      />
    </label>
  );
}

function FilterSelect({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 rounded-lg border border-[#E2E8F0] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-[#0D9488] focus:ring-4 focus:ring-[#0D9488]/10"
    >
      {options.map((option) => <option key={option}>{option}</option>)}
    </select>
  );
}

// Reusable clickable chip group for category filters.
// It is used for receipt categories and source document types so those chips behave like real filters.
function FilterChips({ label, options, value, onChange }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#64748B]">{label}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option === value;

          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? 'border-[#0D9488] bg-[#E1F5EE] text-[#0F6E56]' : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#5F5E5A] hover:border-[#BFE9DE] hover:text-[#0D9488]'}`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Linked Supporting Receipts tab.
// Receipts are shown as business evidence linked to reports, not as personal tax claim items.
function LinkedReceiptsTab({
  receipts,
  allReceipts,
  reportNames,
  search,
  categoryFilter,
  statusFilter,
  reportFilter,
  onSearchChange,
  onCategoryChange,
  onStatusChange,
  onReportChange,
  onView,
  onLink,
  onDownload,
  onReviewed,
  onClear,
}) {
  // Status and linked-report dropdowns are built from mock data so new local changes appear in filters.
  const statusOptionsForReceipts = ['All Statuses', ...Array.from(new Set(allReceipts.map((receipt) => receipt.status)))];
  const linkedReportOptions = ['All Reports', ...Array.from(new Set([...reportNames, ...allReceipts.map((receipt) => receipt.linkedReport)]))];

  return (
    <section className="space-y-5">
      <TabHeader
        title="Linked Supporting Receipts"
        subtitle="Receipts and invoices used as evidence for SME deductible business expenses and report generation."
      />
      <EvidenceSummaryCards cards={[
        { label: 'Total Receipts', value: '38' },
        { label: 'Linked to Reports', value: '31' },
        { label: 'Needs Review', value: '6' },
        { label: 'Low OCR Confidence', value: '3' },
      ]} />
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
        <FilterChips label="Category filter" options={receiptCategoryOptions} value={categoryFilter} onChange={onCategoryChange} />
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px_240px_auto]">
          <SearchInput value={search} onChange={onSearchChange} placeholder="Search by receipt name, vendor, category, or linked report..." />
          <FilterSelect value={statusFilter} onChange={onStatusChange} options={statusOptionsForReceipts} />
          <FilterSelect value={reportFilter} onChange={onReportChange} options={linkedReportOptions} />
          <button type="button" onClick={onClear} className={secondaryButtonClass('h-11 px-3')}>Clear</button>
        </div>
      </div>
      {receipts.length === 0 ? (
        <EmptyState onClear={onClear} />
      ) : (
        <>
          <div className="hidden rounded-xl border border-[#E2E8F0] bg-white lg:block">
            <div className="overflow-x-auto">
              <table className="min-w-[1120px] table-fixed text-left text-sm">
                <thead className="bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#64748B]">
                  <tr>
                    <th className="w-[190px] px-4 py-3">Receipt / Invoice</th>
                    <th className="w-[180px] px-4 py-3">Vendor / Supplier</th>
                    <th className="w-[145px] px-4 py-3">Category</th>
                    <th className="w-[120px] px-4 py-3 text-right">Amount</th>
                    <th className="w-[210px] px-4 py-3">Linked Report</th>
                    <th className="w-[120px] px-4 py-3">OCR Confidence</th>
                    <th className="w-[150px] px-4 py-3">Status</th>
                    <th className="w-[180px] px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {receipts.map((receipt) => (
                    <tr key={receipt.id} className="transition hover:bg-[#F8FAFC]">
                      <td className="px-4 py-4 font-semibold text-[#0F172A]">{receipt.name}</td>
                      <td className="px-4 py-4 text-[#5F5E5A]">{receipt.vendor}</td>
                      <td className="px-4 py-4 text-[#5F5E5A]">{receipt.category}</td>
                      <td className="px-4 py-4"><MoneyValue value={receipt.amount} /></td>
                      <td className="px-4 py-4 text-[#5F5E5A]">{receipt.linkedReport}</td>
                      <td className="px-4 py-4"><ConfidenceBadge value={receipt.ocrConfidence} /></td>
                      <td className="px-4 py-4"><StatusBadge status={receipt.status} /></td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap justify-end gap-1">
                          <RowAction label="View" onClick={() => onView(receipt)} />
                          <RowAction label="Link Report" onClick={() => onLink(receipt)} />
                          <RowAction label="Download" onClick={onDownload} />
                          <RowAction label="Mark Reviewed" onClick={() => onReviewed(receipt.id)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-3 lg:hidden">
            {receipts.map((receipt) => (
              <EvidenceCard
                key={receipt.id}
                title={receipt.name}
                subtitle={receipt.vendor}
                details={[
                  ['Category', receipt.category],
                  ['Amount', receipt.amount],
                  ['Linked Report', receipt.linkedReport],
                  ['OCR Confidence', `${receipt.ocrConfidence}%`],
                ]}
                status={receipt.status}
                actions={[
                  ['View', () => onView(receipt)],
                  ['Link Report', () => onLink(receipt)],
                  ['Download', onDownload],
                  ['Mark Reviewed', () => onReviewed(receipt.id)],
                ]}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// OCR Evidence tab.
// It focuses on confidence scores, missing fields, and verification status for extracted documents.
function OcrEvidenceTab({
  evidence,
  search,
  confidenceFilter,
  missingFilter,
  statusFilter,
  onSearchChange,
  onConfidenceChange,
  onMissingChange,
  onStatusChange,
  onView,
  onRecheck,
  onVerified,
  onClear,
}) {
  return (
    <section className="space-y-5">
      <TabHeader
        title="OCR Evidence"
        subtitle="Review OCR extraction results, confidence scores, missing fields, and documents requiring manual verification."
      />
      <EvidenceSummaryCards cards={[
        { label: 'OCR Processed', value: '42' },
        { label: 'High Confidence', value: '29' },
        { label: 'Medium Confidence', value: '10' },
        { label: 'Low Confidence', value: '3' },
      ]} />
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_190px_180px_auto]">
          <SearchInput value={search} onChange={onSearchChange} placeholder="Search by document name..." />
          <FilterSelect value={confidenceFilter} onChange={onConfidenceChange} options={['All Confidence', 'High', 'Medium', 'Low']} />
          <FilterSelect value={missingFilter} onChange={onMissingChange} options={['All Missing Fields', 'Has Missing Fields', 'No Missing Fields']} />
          <FilterSelect value={statusFilter} onChange={onStatusChange} options={['All Statuses', 'Verified', 'Needs Review', 'Low Confidence']} />
          <button type="button" onClick={onClear} className={secondaryButtonClass('h-11 px-3')}>Clear</button>
        </div>
      </div>
      {evidence.length === 0 ? (
        <EmptyState onClear={onClear} />
      ) : (
        <>
          <div className="hidden rounded-xl border border-[#E2E8F0] bg-white lg:block">
            <div className="overflow-x-auto">
              <table className="min-w-[1180px] table-fixed text-left text-sm">
                <thead className="bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#64748B]">
                  <tr>
                    <th className="w-[190px] px-4 py-3">Document</th>
                    <th className="w-[130px] px-4 py-3 text-right">Extracted Amount</th>
                    <th className="w-[135px] px-4 py-3">Extracted Date</th>
                    <th className="w-[180px] px-4 py-3">Extracted Vendor</th>
                    <th className="w-[120px] px-4 py-3">Confidence</th>
                    <th className="w-[150px] px-4 py-3">Missing Fields</th>
                    <th className="w-[190px] px-4 py-3">Linked Report</th>
                    <th className="w-[130px] px-4 py-3">Status</th>
                    <th className="w-[150px] px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {evidence.map((item) => (
                    <tr key={item.id} className="transition hover:bg-[#F8FAFC]">
                      <td className="px-4 py-4 font-semibold text-[#0F172A]">{item.document}</td>
                      <td className="px-4 py-4"><MoneyValue value={item.extractedAmount} /></td>
                      <td className="px-4 py-4 text-[#5F5E5A]">{item.extractedDate}</td>
                      <td className="px-4 py-4 text-[#5F5E5A]">{item.extractedVendor}</td>
                      <td className="px-4 py-4"><ConfidenceBadge value={item.confidence} /></td>
                      <td className="px-4 py-4 text-[#5F5E5A]">{item.missingFields}</td>
                      <td className="px-4 py-4 text-[#5F5E5A]">{item.linkedReport}</td>
                      <td className="px-4 py-4"><StatusBadge status={item.status} /></td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap justify-end gap-1">
                          <RowAction label="View" onClick={() => onView(item)} />
                          <RowAction label="Recheck" onClick={() => onRecheck(item.id)} />
                          <RowAction label="Mark Verified" onClick={() => onVerified(item.id)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-3 lg:hidden">
            {evidence.map((item) => (
              <EvidenceCard
                key={item.id}
                title={item.document}
                subtitle={item.extractedVendor}
                details={[
                  ['Amount', item.extractedAmount],
                  ['Date', item.extractedDate],
                  ['Confidence', `${item.confidence}% ${getConfidenceLevel(item.confidence)}`],
                  ['Missing Fields', item.missingFields],
                  ['Linked Report', item.linkedReport],
                ]}
                status={item.status}
                actions={[
                  ['View', () => onView(item)],
                  ['Recheck', () => onRecheck(item.id)],
                  ['Mark Verified', () => onVerified(item.id)],
                ]}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// Source Documents tab.
// Category chips filter original files such as bank statements, e-invoice records, and agreements.
function SourceDocumentsTab({
  documents,
  search,
  categoryFilter,
  statusFilter,
  onSearchChange,
  onCategoryChange,
  onStatusChange,
  onClear,
  onView,
  onDownload,
  onLink,
  onArchive,
}) {
  return (
    <section className="space-y-5">
      <TabHeader
        title="Source Documents"
        subtitle="Bank statements, e-invoice records, agreements, payroll summaries, and other SME source files used for audit trail and accountant review."
      />
      <EvidenceSummaryCards cards={[
        { label: 'Source Documents', value: '18' },
        { label: 'Bank Statements', value: '4' },
        { label: 'E-Invoice Records', value: '6' },
        { label: 'Accountant Pack Items', value: '8' },
      ]} />
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
        <FilterChips label="Source Document Filters" options={['All', ...sourceDocumentTypes]} value={categoryFilter} onChange={onCategoryChange} />
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
          <SearchInput value={search} onChange={onSearchChange} placeholder="Search by document name, type, period, or linked report..." />
          <FilterSelect value={statusFilter} onChange={onStatusChange} options={['All Statuses', 'Linked', 'Needs Review', 'Archived']} />
          <button type="button" onClick={onClear} className={secondaryButtonClass('h-11 px-3')}>Clear</button>
        </div>
        <p className="mt-3 text-sm text-[#64748B]">{documents.length} source document{documents.length === 1 ? '' : 's'} shown</p>
      </div>

      {documents.length === 0 ? (
        <EmptyState onClear={onClear} />
      ) : (
        <>
          <div className="hidden rounded-xl border border-[#E2E8F0] bg-white lg:block">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] table-fixed text-left text-sm">
                <thead className="bg-[#F8FAFC] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#64748B]">
                  <tr>
                    <th className="w-[220px] px-4 py-3">Document Name</th>
                    <th className="w-[170px] px-4 py-3">Type</th>
                    <th className="w-[120px] px-4 py-3">Period</th>
                    <th className="w-[220px] px-4 py-3">Linked Report</th>
                    <th className="w-[130px] px-4 py-3">Uploaded Date</th>
                    <th className="w-[130px] px-4 py-3">Status</th>
                    <th className="w-[170px] px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {documents.map((document) => (
                    <tr key={document.id} className="transition hover:bg-[#F8FAFC]">
                      <td className="px-4 py-4 font-semibold text-[#0F172A]">{document.name}</td>
                      <td className="px-4 py-4 text-[#5F5E5A]">{document.type}</td>
                      <td className="px-4 py-4 text-[#5F5E5A]">{document.period}</td>
                      <td className="px-4 py-4 text-[#5F5E5A]">{document.linkedReport}</td>
                      <td className="px-4 py-4 text-[#5F5E5A]">{document.uploadedDate}</td>
                      <td className="px-4 py-4"><StatusBadge status={document.status} /></td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap justify-end gap-1">
                          <RowAction label="View" onClick={() => onView(document)} />
                          <RowAction label="Download" onClick={onDownload} />
                          <RowAction label="Link Report" onClick={() => onLink(document)} />
                          <RowAction label="Archive" onClick={() => onArchive(document.id)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="space-y-3 lg:hidden">
            {documents.map((document) => (
              <EvidenceCard
                key={document.id}
                title={document.name}
                subtitle={document.type}
                details={[
                  ['Period', document.period],
                  ['Linked Report', document.linkedReport],
                  ['Uploaded Date', document.uploadedDate],
                ]}
                status={document.status}
                actions={[
                  ['View', () => onView(document)],
                  ['Download', onDownload],
                  ['Link Report', () => onLink(document)],
                  ['Archive', () => onArchive(document.id)],
                ]}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function EvidenceCard({ title, subtitle, details, status, actions }) {
  return (
    <article className="rounded-xl border border-[#E2E8F0] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[#0F172A]">{title}</h3>
          <p className="mt-1 text-sm text-[#5F5E5A]">{subtitle}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {details.map(([label, value]) => (
          <Meta key={label} label={label} value={value} />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {actions.map(([label, handler]) => (
          <button key={label} type="button" onClick={handler} className={secondaryButtonClass('px-3 py-2 text-xs')}>
            {label}
          </button>
        ))}
      </div>
    </article>
  );
}

function ConfidenceBadge({ value }) {
  const level = getConfidenceLevel(value);
  const styles = {
    High: 'border-[#8DE7C6] bg-[#E1F5EE] text-[#0F6E56]',
    Medium: 'border-[#F8D891] bg-[#FFF7E5] text-[#BA7517]',
    Low: 'border-[#F7B8B8] bg-[#FFF0F0] text-[#E24B4A]',
  };

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[level]}`}>
      {value}% {level}
    </span>
  );
}

// Converts SME financial breakdown data into SVG donut segments.
// The chart is a visual summary of income and expense classifications, not a final tax calculation.
function TaxBreakdownChart() {
  // The total is used to calculate each segment's percentage and arc length.
  const total = chartSegments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 72;
  const circumference = 2 * Math.PI * radius;

  // Each donut segment needs a length and offset so the SVG circles appear as one complete donut.
  const donutSegments = chartSegments.map((segment, index) => {
    const dashOffset = chartSegments.slice(0, index).reduce((sum, item) => (
      sum + (item.value / total) * circumference
    ), 0);

    return {
      ...segment,
      dashOffset,
      length: (segment.value / total) * circumference,
    };
  });

  return (
    <section className="rounded-xl border border-[#E2E8F0] bg-white p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="mx-auto flex w-full max-w-[260px] shrink-0 items-center justify-center">
          <svg viewBox="0 0 220 220" className="h-56 w-56">
            <circle cx="110" cy="110" r={radius} fill="none" stroke="#E8E6E0" strokeWidth="24" />
            {donutSegments.map((segment) => {
              return (
                <circle
                  key={segment.label}
                  cx="110"
                  cy="110"
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth="24"
                  strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                  strokeDashoffset={-segment.dashOffset}
                  strokeLinecap="butt"
                  transform="rotate(-90 110 110)"
                />
              );
            })}
            <circle cx="110" cy="110" r="48" fill="#FFFFFF" />
            <text x="110" y="104" textAnchor="middle" className="fill-[#64748B] text-[11px] font-semibold uppercase tracking-[0.05em]">Total</text>
            <text x="110" y="126" textAnchor="middle" className="fill-[#0F172A] text-lg font-bold">{formatRm(total)}</text>
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#0D9488]">Tax Visualization</p>
          <h2 className="mt-2 text-lg font-bold text-[#0F172A]">SME Tax Breakdown</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {chartCallouts.map((callout) => (
              <div key={callout.label} className="rounded-lg border border-[#BFE9DE] bg-[#F0FDFA] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#0D9488]">{callout.label}</p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums text-[#0F172A]">{callout.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {chartSegments.map((segment) => {
              const percentage = Math.round((segment.value / total) * 100);

              return (
                <div key={segment.label} className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#0F172A]">{segment.label}</p>
                    <p className="font-mono text-xs tabular-nums text-[#64748B]">{formatRm(segment.value)} - {percentage}%</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 rounded-lg border border-[#F8D891] bg-[#FFF9EB] p-3 text-sm leading-6 text-[#5F5E5A]">
            Breakdown is based on SME report data and linked supporting receipts. Deductible values and tax impact are AI-assisted estimates and require accountant verification.
          </p>
        </div>
      </div>
    </section>
  );
}

function ReportMobileCard({ report, onView, onDownload, onRename, onArchive, onDelete }) {
  return (
    <article className="rounded-xl border border-[#E2E8F0] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-start gap-2">
            <h3 className="font-semibold text-[#0F172A]">{report.name}</h3>
            <button
              type="button"
              onClick={onRename}
              className="mt-0.5 shrink-0 rounded-full border border-[#BFE9DE] px-2 py-0.5 text-[11px] font-semibold text-[#0D9488]"
            >
              Edit
            </button>
          </div>
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
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={onView} className={secondaryButtonClass('px-3 py-2 text-xs')}>View</button>
        <button type="button" onClick={onDownload} className={secondaryButtonClass('px-3 py-2 text-xs')}>Download</button>
        <button type="button" onClick={onArchive} className={secondaryButtonClass('px-3 py-2 text-xs')}>Archive</button>
        <button type="button" onClick={onDelete} className={dangerButtonClass('px-3 py-2 text-xs')}>Delete</button>
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

// Report preview modal shows the financial summary, linked evidence counts, included sections, and disclaimer.
// It receives the selected report from state when a user clicks View in the report table or mobile card.
function ReportPreviewModal({ report, onClose, onDownload, onArchive }) {
  // Finds the plain-English explanation for the selected report category.
  const reportExplanation = reportSectionExplanations.find((item) => item.title === report.category);

  return (
    <ModalShell title={report.name} subtitle="SME report preview" onClose={onClose} size="max-w-4xl">
      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <section className="space-y-5">
          <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
            <h3 className="text-sm font-bold uppercase tracking-[0.05em] text-[#64748B]">Report Summary</h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[#0F172A]">{report.category}</span>
              <StatusBadge status={report.status} />
            </div>
            <p className="mt-4 text-sm leading-6 text-[#5F5E5A]">
              This report is generated from SME records, linked supporting receipts, OCR evidence, and categorized business income/expense data. Supporting receipts are used as evidence for deductible business expenses, not as guaranteed tax claims.
            </p>
          </div>

          <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
            <h3 className="text-sm font-bold uppercase tracking-[0.05em] text-[#64748B]">Linked Supporting Receipts</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MoneyMeta label="Total Amount" value={report.totalAmount} />
              <MoneyMeta label="Deductible Amount" value={report.deductibleAmount} />
              <MoneyMeta label="Overall Deductible Tax" value={report.overallDeductibleTax} />
              <MoneyMeta label="Non-Deductible / Review Amount" value={report.reviewAmount} />
              <MoneyMeta label="Estimated Tax Impact" value={report.estimatedTaxImpact} />
              <Meta label="Linked Supporting Receipts" value={report.linkedSupportingReceipts} />
              <Meta label="Accountant Review Required" value={report.accountantReviewRequired ? 'Yes - Needs Accountant Review' : 'No'} />
            </div>
            <p className="mt-4 rounded-lg border border-[#BFE9DE] bg-[#F0FDFA] p-3 text-sm leading-6 text-[#0F6E56]">
              Estimated Deductible Amount is based on categorized SME records and linked source documents. Final treatment must be verified with LHDN guidance or a qualified accountant / tax agent.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
              <h3 className="text-sm font-bold uppercase tracking-[0.05em] text-[#64748B]">OCR Evidence</h3>
              <Meta label="OCR Evidence Items" value={report.ocrEvidenceIncluded} />
              <p className="mt-3 text-sm leading-6 text-[#5F5E5A]">OCR evidence supports report generation by showing extracted values, confidence, and fields that may need manual verification.</p>
            </div>
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
              <h3 className="text-sm font-bold uppercase tracking-[0.05em] text-[#64748B]">Source Documents</h3>
              <Meta label="Source Documents" value={report.sourceDocuments} />
              <p className="mt-3 text-sm leading-6 text-[#5F5E5A]">Source documents provide the audit trail behind generated SME reports and accountant review packs.</p>
            </div>
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
            <h3 className="text-sm font-bold uppercase tracking-[0.05em] text-[#64748B]">Notes & Disclaimer</h3>
            <p className="mt-2 rounded-lg border border-[#E2E8F0] bg-white p-4 text-sm leading-6 text-[#5F5E5A]">{report.notes}</p>
          </div>

          <div className="rounded-lg border border-[#F8D891] bg-[#FFF9EB] p-4 text-sm leading-6 text-[#5F5E5A]">
            Cukai.AI provides AI-assisted SME report organization only. Deductible amounts and tax impact values are estimates. Please verify final tax treatment with official LHDN guidance or a qualified accountant / tax agent.
          </div>
        </section>

        <aside className="rounded-xl border border-[#E2E8F0] bg-white p-4">
          <div className="space-y-4">
            <Meta label="Tax Year" value={report.taxYear} />
            <Meta label="Created Date" value={report.createdDate} />
            <Meta label="Last Updated" value={report.lastUpdated} />
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

// Receipt detail modal explains that receipts are supporting evidence only.
// They help SME report generation but do not confirm final tax deductibility.
function ReceiptDetailModal({ receipt, onClose }) {
  return (
    <ModalShell title={receipt.name} subtitle="Linked supporting receipt" onClose={onClose} size="max-w-2xl">
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Meta label="Vendor" value={receipt.vendor} />
          <MoneyMeta label="Amount" value={receipt.amount} />
          <Meta label="Category" value={receipt.category} />
          <Meta label="Linked Report" value={receipt.linkedReport} />
          <Meta label="OCR Confidence" value={`${receipt.ocrConfidence}%`} />
          <Meta label="Status" value={receipt.status} />
        </div>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.05em] text-[#64748B]">Extracted Fields</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {receipt.extractedFields.map((field) => (
              <span key={field} className="rounded-full border border-[#BFE9DE] bg-[#E1F5EE] px-3 py-1 text-xs font-semibold text-[#0F6E56]">{field}</span>
            ))}
          </div>
        </div>
        <p className="rounded-lg border border-[#E2E8F0] bg-white p-4 text-sm leading-6 text-[#5F5E5A]">{receipt.notes}</p>
        <p className="rounded-lg border border-[#F8D891] bg-[#FFF9EB] p-4 text-sm leading-6 text-[#5F5E5A]">
          This receipt is stored as supporting evidence for SME report generation. It does not confirm final tax deductibility until reviewed against LHDN guidance or by an accountant.
        </p>
      </div>
    </ModalShell>
  );
}

// OCR detail modal shows extracted values, confidence, and missing fields for manual review.
function OcrDetailModal({ item, onClose }) {
  return (
    <ModalShell title={item.document} subtitle="OCR evidence details" onClose={onClose} size="max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyMeta label="Extracted Amount" value={item.extractedAmount} />
        <Meta label="Extracted Date" value={item.extractedDate} />
        <Meta label="Extracted Vendor" value={item.extractedVendor} />
        <Meta label="Confidence" value={`${item.confidence}% ${getConfidenceLevel(item.confidence)}`} />
        <Meta label="Missing Fields" value={item.missingFields} />
        <Meta label="Linked Report" value={item.linkedReport} />
        <Meta label="Status" value={item.status} />
      </div>
    </ModalShell>
  );
}

// Source document modal shows audit-trail files such as statements, agreements, and payroll summaries.
function SourceDocumentModal({ document, onClose }) {
  return (
    <ModalShell title={document.name} subtitle="Source document details" onClose={onClose} size="max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <Meta label="Type" value={document.type} />
        <Meta label="Period" value={document.period} />
        <Meta label="Linked Report" value={document.linkedReport} />
        <Meta label="Uploaded Date" value={document.uploadedDate} />
        <Meta label="Status" value={document.status} />
      </div>
      <p className="mt-5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-sm leading-6 text-[#5F5E5A]">
        This source document supports the Cukai Stash audit trail and can be included in accountant review packs.
      </p>
    </ModalShell>
  );
}

// Link modal connects a receipt or source document to one report.
// This relationship is important for accountant review and audit trail clarity.
function LinkReportModal({ target, reportNames, onClose, onSave }) {
  // Default to the current linked report when one already exists.
  const [linkedReport, setLinkedReport] = useState(target.item.linkedReport || reportNames[0]);

  // Remove duplicate report names so the dropdown stays clean.
  const linkOptions = Array.from(new Set([target.item.linkedReport, ...reportNames].filter(Boolean)));

  return (
    <ModalShell title="Link Report" subtitle={target.item.name || target.item.document} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(target, linkedReport);
        }}
      >
        <FormSelect label="Linked Report" value={linkedReport} options={linkOptions} onChange={setLinkedReport} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass()}>Cancel</button>
          <button type="submit" className={primaryButtonClass()}>Save Link</button>
        </div>
      </form>
    </ModalShell>
  );
}

// Generate Report tab form.
// It stores form choices locally, then asks the parent page to add a mock report into state.
function GenerateReportPanel({ onGenerate }) {
  // Local form state controls the selected report type, tax year, period, and included sections.
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

  // Updates one field at a time while preserving the rest of the generate form.
  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="rounded-xl border border-[#E2E8F0] bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#0D9488]">Report Generation</p>
      <h2 className="mt-2 text-lg font-bold text-[#0F172A]">Generate SME Report</h2>
      <p className="mt-2 text-sm leading-6 text-[#5F5E5A]">
        Create a new mock SME report in this stash using selected report sections.
      </p>
      <form
        className="mt-4 space-y-4"
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
        <div className="flex justify-end pt-2">
          <button type="submit" className={primaryButtonClass()}>Generate Report</button>
        </div>
      </form>
    </section>
  );
}

// Upload modal stores manually entered report details in local form state.
// Saving sends the form back to the parent so it can add a mock uploaded report.
function UploadReportModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    title: '',
    category: 'SME Tax Summary',
    taxYear: 'YA 2026',
    totalAmount: '',
    deductibleAmount: '',
    overallDeductibleTax: '',
    estimatedTaxImpact: '',
    linkedSupportingReceipts: '',
    fileName: '',
    notes: '',
  });

  // Updates one upload form field while keeping other typed values intact.
  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <ModalShell title="Upload Report" subtitle="Add an uploaded SME business report to the mock stash." onClose={onClose}>
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
          <FormInput label="Linked Supporting Receipts Count" value={form.linkedSupportingReceipts} placeholder="e.g. 16" onChange={(value) => updateField('linkedSupportingReceipts', value)} />
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

// Rename modal is opened from the Report Name column edit control.
// This keeps Rename out of the Actions column while still allowing report names to be edited.
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

// Delete confirmation modal prevents accidental removal from the local report list.
function ConfirmDeleteModal({ report, onClose, onDelete }) {
  return (
    <ModalShell title="Delete report?" subtitle="This only removes the mock report from the frontend list." onClose={onClose}>
      <p className="text-sm leading-6 text-[#5F5E5A]">
        Delete <span className="font-semibold text-[#0F172A]">{report.name}</span> from Cukai Stash?
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryButtonClass()}>Cancel</button>
        <button type="button" onClick={() => onDelete(report.id)} className={dangerButtonClass()}>Delete Report</button>
      </div>
    </ModalShell>
  );
}

// Small controlled input helper used by forms and modals.
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

// Checkbox helper used by report generation options.
// It keeps include/exclude choices readable for non-technical SME users.
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

export default CukaiStash;
