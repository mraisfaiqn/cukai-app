// Partnership overview mock data — drives the two-scope dashboard
// (PartnershipOverview.jsx). It deliberately mirrors the real Malaysian tax
// boundary the app has to respect:
//
//   FIRM scope  (the partnership)  → Form P  → shared among all partners
//   PERSON scope (one partner)     → Form B  → PRIVATE to that partner
//
// Money values are stored preformatted (e.g. "RM 235,000") like the rest of the
// data layer, since the components are presentational and only display them.
// Raw numbers (rm: …) are kept alongside a few figures only where a component
// needs them for a ring/bar width — never re-parse the display strings.

// ── Who is logged in ─────────────────────────────────────────────
// In a real build this comes from the session + firm_membership row. `role`
// gates what the firm scope lets you edit; it never unlocks another partner's
// personal scope. Try flipping role to 'partner' to see the firm-edit affordance
// disappear.
export const currentUser = {
  taxpayerId: 'tp-aisyah',
  name: 'Aisyah',
  role: 'principal', // 'principal' | 'partner' | 'bookkeeper' | 'viewer'
};

// ── FIRM scope (shared · feeds Form P) ───────────────────────────
// The partnership itself pays no tax; this is the informational layer that
// computes total profit and how it is split.
export const firm = {
  name: 'Meridian Print Studio',
  ssm: 'SSM 202301045678',
  msic: 'MSIC 1811',
  assessmentYear: 'YA 2025',
  type: 'Partnership',

  // Firm P&L → divisible income.
  //   divisibleIncome = revenue − sharedExpenses − capitalAllowances
  //   920,000 − 410,000 − 60,000 = 450,000
  revenue: 'RM 920,000',
  sharedExpenses: 'RM 410,000',
  capitalAllowances: 'RM 60,000',
  divisibleIncome: 'RM 450,000',
};

// ── Allocation (the Form P split) ────────────────────────────────
// How divisible income is shared. The teaching point baked into the numbers:
// partner SALARY is NOT a firm expense — it's an appropriation. So we allocate
// salaries to each partner first, split the remainder by profit-share %, and the
// total always reconciles back to divisible income.
//
//   salaries total            = 60,000 + 40,000 + 0      = 100,000
//   remainder to split        = 450,000 − 100,000        = 350,000
//   split 50 / 30 / 20        = 175,000 / 105,000 / 70,000
//   total per partner         = salary + profit share
//   Σ totals                  = 235,000 + 145,000 + 70,000 = 450,000 ✓
export const allocation = [
  { taxpayerId: 'tp-aisyah', name: 'Aisyah',  sharePct: '50%', salary: 'RM 60,000', profitShare: 'RM 175,000', total: 'RM 235,000' },
  { taxpayerId: 'tp-bopha',  name: 'Bopha',   sharePct: '30%', salary: 'RM 40,000', profitShare: 'RM 105,000', total: 'RM 145,000' },
  { taxpayerId: 'tp-chong',  name: 'Chong',   sharePct: '20%', salary: 'RM 0',      profitShare: 'RM 70,000',  total: 'RM 70,000'  },
];

// ── PERSON scope (PRIVATE · feeds Form B) ────────────────────────
// Only ever the logged-in partner's own picture. Their firm share lands here and
// joins their own businesses, other income, reliefs → chargeable income → tax.
// Another partner can never see this object for someone else.
//
//   aggregate   = shareFromFirm + own business + other income
//                 235,000 + 30,000 + 0 = 265,000
//   chargeable  = aggregate − reliefs = 265,000 − 18,000 = 247,000
export const personal = {
  taxpayerId: 'tp-aisyah',
  shareFromFirm: 'RM 235,000',          // pulled from the allocation row above

  // The partner's OWN income outside the firm — invisible to co-partners.
  ownBusinesses: [
    { name: 'Freelance brand design (sole prop)', amount: 'RM 30,000' },
  ],
  otherIncome: [], // employment / rental / dividends would go here

  aggregateIncome: 'RM 265,000',
  reliefs: 'RM 18,000',
  chargeableIncome: 'RM 247,000',
  taxPayable: 'RM 48,300',

  // CP500 bi-monthly instalments — the sole prop / partner pre-pays during the
  // year. Status drives the chip colour.
  instalments: [
    { period: 'Mar', amount: 'RM 8,050', status: 'paid' },
    { period: 'May', amount: 'RM 8,050', status: 'paid' },
    { period: 'Jul', amount: 'RM 8,050', status: 'paid' },
    { period: 'Sep', amount: 'RM 8,050', status: 'due' },
    { period: 'Nov', amount: 'RM 8,050', status: 'upcoming' },
    { period: 'Jan', amount: 'RM 8,050', status: 'upcoming' },
  ],
};

// Human-readable labels for the role badge in the firm scope.
export const roleLabels = {
  principal: 'Principal Partner',
  partner: 'Partner',
  bookkeeper: 'Bookkeeper',
  viewer: 'Viewer',
};
