// Dashboard mock data — values taken from Main Dashboard - Cukai.AI.png
// (Qafiz Printing & Design · MSIC 1811 · YA 2025)

// Account / entity context shown in the DashboardHeader greeting line.
export const account = {
  name: 'Hafiz',
  entity: 'Qafiz Printing & Design',
  msic: 'MSIC 1811',
  assessmentYear: 'YA 2025',
  deadlineNote: '142 days to Form B',
};

// Content for the amber "Action Required" banner.
export const alert = {
  title: 'Action Required',
  message: '3 receipts from October need your input on business-use percentage before they can be included.',
  actionLabel: 'Review',
};

// Score rings in the "Your Tax Health" card. The ring fills by value / max.
// Omit `max` (defaults to 100) for a percentage-style score that shows just the
// number; set `max` for a fraction-style score that shows "value/max" (e.g. 7/9).
// `color` is a Tailwind text-color class (from registered tokens) so the ring
// stays presentational and never holds a raw hex.
export const healthScores = [
  { label: 'Savings Claimed', value: 6, max: 9, color: 'text-primary', track: 'text-primary-tint' },
  { label: 'Form Readiness', value: 75, color: 'text-literacy', track: 'text-literacy-track' },
];

// Top KPI strip — 4 stat cards
export const stats = [
  { label: 'YTD Income', value: 'RM 642,800', change: '+RM 38,400' },
  { label: 'YTD Deductions', value: 'RM 318,600', change: '412 receipts' },
  { label: 'Projected Tax', value: 'RM 47,200', change: '-RM 8,100 vs last year' },
  { label: 'Unclaimed Savings', value: 'RM 23,450', change: '7 opportunities found' },
];

// "Unclaimed Savings Opportunities" list
export const opportunities = [
  { id: 'capital-allowance', title: 'Capital allowance (RM45k cutting machine)', provision: 'Sch. 3 ITA', amount: '+RM 8,160' },
  { id: 'double-deduction', title: 'Double deduction (staff training)', provision: 'S. 34B ITA', amount: '+RM 6,200' },
  { id: 'sme-preferential', title: 'SME preferential rate', provision: 'Sch. 1 ITA', amount: '+RM 5,250' },
];

// "Upcoming Deadlines" list
export const deadlines = [
  { label: 'PCB Nov', sub: 'Due 15 Dec', daysLeft: 4 },
  { label: 'SST Return', sub: 'Bi-monthly cycle', daysLeft: 38 },
  { label: 'Form B filing', sub: 'YA 2025', daysLeft: 142 },
];

// Full detail records for the opportunity detail page, taken from
// "Opportunity Detail - Capital Allowance.png". Keyed by the same opportunity
// `id` used on the dashboard rows, so the detail page can do a direct lookup:
//   opportunityDetails[useParams().id]
// Currency values are stored preformatted (like the rest of this file) since
// the components are presentational and only display them.
export const opportunityDetails = {
  'capital-allowance': {
    id: 'capital-allowance',
    title: 'Capital Allowance: RM45k Cutting Machine',
    subtitle: 'Reviewing asset purchase for accelerated tax depreciation.',
    status: 'Action Required',                   // red "ACTION REQUIRED" chip on the provision card
    provision: 'Capital Allowance (Sch. 3 ITA)', // TAX PROVISION heading
    provisionNote: 'Eligible for initial and annual allowance for the current assessment year.',
    estSavings: 'RM 8,160.00',                   // headline "Est. Savings" on the provision card

    // "Why you qualify" — the AI explanation, one string per paragraph.
    whyYouQualify: [
      'Our AI analyzed your business profile and detected a mismatch between your registered MSIC Code 1811 (Printing) and unclaimed machinery expenses.',
      "Under Schedule 3 of the Income Tax Act 1967, the purchase of heavy machinery for manufacturing/printing qualifies for an accelerated Initial Allowance of 20%. Given the asset's classification as 'Plant & Machinery', you are also entitled to a 14% Annual Allowance.",
    ],

    // Legal reference shown under the explanation and as the compliance source.
    legalReference: {
      act: 'Schedule 3, Income Tax Act 1967',
      ruling: 'Public Ruling No. 12/2014', // the "Reference:" link
      source: 'LHDN Law (ITA 1967)',        // "COMPLIANCE SOURCE" footnote
    },

    // Calculation Breakdown panel — rows top to bottom.
    calculation: {
      assetCost: 'RM 45,000.00',
      initialAllowance: { rate: '20%', note: 'One-time claim for year of purchase', amount: '+RM 9,000.00' },
      annualAllowance: { rate: '14%', note: 'Standard rate for plant & machinery', amount: '+RM 6,300.00' },
      totalClaimable: 'RM 15,300.00',                               // = 9,000 + 6,300
      projectedTaxReduction: { rate: '24%', amount: 'RM 3,672.00' }, // = 15,300 × 24%
    },

    // "Link Supporting Documents" — the invoice Cukai.AI matched from the vault.
    matchingInvoice: {
      matchConfidence: '98%',
      label: 'Invoice #INV-2024-882 (Heidelberg Press)',
    },
  },
};
