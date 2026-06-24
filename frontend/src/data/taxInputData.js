// Manual-entry input layer for the tax calculator — a stand-in for the
// taxpayer-data DB tables your teammate hasn't built yet.
//
// This file is the SINGLE structured shape that ReliefCalculator.jsx (and,
// later, the Generate Report tab once it's wired up) reads from. It mirrors
// the future DB tables one-for-one:
//
//   businesses[]    → a `businesses` table (one row per business, Form B B1a)
//   incomeSources   → columns on the taxpayer/return record (employment, rent, other)
//   losses[]        → a `business_losses` table (Form B Part M, current-year losses)
//   donations[]      → a `donations` table (Form B Part G, G1–G7 gift types)
//   reliefs{}       → a `relief_claims` table, keyed by relief code (Form B Part H)
//   partnerships[]  → a `partnerships` table (Form P side — not wired up yet)
//
// SWAP PLAN: when the DB is ready, replace the `export const dummyTaxInput =
// {...}` below with a fetch (e.g. `await api.getTaxInput(taxpayerId)`) that
// resolves to this exact same shape. ReliefCalculator.jsx never has to change
// — it just stops reading a literal and starts reading a resolved API value.
// Same pattern tax_config.py already uses on the backend.

export const dummyTaxInput = {
  yearOfAssessment: 2025,

  // One entry per business — gross income, allowable expenses and capital
  // allowances, exactly as entered on the form. Statutory income is derived
  // (gross − allowable expenses − capital allowances), never stored directly.
  businesses: [
    {
      id: 'biz-1',
      name: 'Business 1',
      grossIncome: 180000,
      allowableExpenses: 50000,
      capitalAllowances: 10000,
    },
  ],

  // Statutory income from non-business sources (Form B B7–B9).
  incomeSources: {
    employment: 0,
    rent: 0,
    otherIncome: 0,
  },

  // Current-year business losses (Form B B14 / Part M). Kept as a list (one
  // entry per business or per loss event) so it maps cleanly onto a future
  // `business_losses` table — the calculator currently just sums these into
  // one figure, since the engine accepts a single aggregated amount.
  losses: [
    // { id: 'loss-1', label: 'Business 1 — current year loss', amount: 0 },
  ],

  // Approved donations / gifts (Form B Part G, items G1–G7). Kept as a list
  // for the same reason as losses — the calculator sums these for now; a
  // later UI pass could break this into one row per donation like the
  // businesses section already does.
  donations: [
    // { id: 'don-1', label: 'Gift of money to approved institution', amount: 0 },
  ],

  // Relief claims, keyed by the same `code` the backend relief catalogue
  // uses (GET /api/v1/tax/reliefs). Only non-auto reliefs need a value here —
  // auto reliefs (e.g. "individual") are always granted at their cap by the
  // engine regardless of what's in this object.
  reliefs: {
    epf_life: 7000,
    lifestyle: 2500,
  },

  zakat: 0,

  // Form P side — not consumed anywhere yet. Left here so the shape already
  // has a slot for it once the partnership module reads from this same layer.
  partnerships: [],
};

// Sum helper — both losses and donations are stored as itemised lists but
// the calculation engine (and today's form UI) only need one total each.
export const sumAmounts = (items) => items.reduce((total, item) => total + (Number(item.amount) || 0), 0);
