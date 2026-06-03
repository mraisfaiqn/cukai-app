// Dashboard mock data — values taken from Main Dashboard - Cukai.AI.png
// (Qafiz Printing & Design · MSIC 1811 · YA 2025)

// Account / entity context shown in the DashboardHeader greeting line.
export const account = {
  name: 'Hafiz',
  entity: 'Qafiz Printing & Design',
  msic: 'MSIC 1811',
  assessmentYear: 'YA 2025',
  deadlineNote: '142 days to Form C',
};

// Content for the amber "Action Required" banner.
export const alert = {
  title: 'Action Required',
  message: '3 receipts from October need your input on business-use percentage before they can be included.',
  actionLabel: 'Review',
};

// Score rings in the "Your Tax Health" card. value is out of 100; `color`
// is a Tailwind text-color class (from registered tokens) so the ring stays
// presentational and never holds a raw hex.
export const healthScores = [
  { label: 'Health', value: 78, color: 'text-primary', track: 'text-primary-tint' },
  { label: 'Literacy', value: 42, color: 'text-literacy', track: 'text-literacy-track' },
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
  { label: 'Form C filing', sub: 'YA 2025', daysLeft: 142 },
];
