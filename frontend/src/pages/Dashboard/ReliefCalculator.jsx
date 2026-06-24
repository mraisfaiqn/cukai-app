// ReliefCalculator — a thin vertical slice proving the frontend ↔ FastAPI
// ↔ calculation engine pipe works end to end. It loads the relief catalogue from
// GET /api/v1/tax/reliefs to build the form dynamically, then POSTs the entered
// values to /api/v1/tax/calculate and renders the breakdown the engine returns.
//
// Income side mirrors Form B Part B: one statutory-income figure per business
// (supports multiple businesses), plus employment/rent/other income, current-year
// business losses, and approved donations — the engine derives aggregate income,
// applies losses then the 10%-of-aggregate-income donation cap, and only then
// moves on to personal reliefs → chargeable income → tax payable.
import { useEffect, useState } from 'react';
import { getReliefs, calculateTax } from '../../services/api';
import { dummyTaxInput, sumAmounts } from '../../data/taxInputData';

// Format a number as Malaysian Ringgit, e.g. 96500 -> "RM 96,500".
const rm = (n) =>
  'RM ' + Number(n ?? 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function ReliefCalculator() {
  const [catalogue, setCatalogue] = useState([]); // relief defs from the backend

  // Income sources — Form B Part B style.
  // Each business is entered as gross income, allowable expenses and capital
  // allowances (Form B's own statutory-income formula), not as a single
  // pre-netted figure — so the calculator derives statutory income itself:
  // statutory income = gross income − allowable expenses − capital allowances.
  //
  // All initial values below come from `dummyTaxInput` (src/data/taxInputData.js)
  // — the stand-in for the not-yet-built DB. When the DB lands, swap that
  // import for a resolved API value with the same shape; nothing here changes.
  const [businesses, setBusinesses] = useState(
    dummyTaxInput.businesses.map((b) => ({
      grossIncome: String(b.grossIncome),
      allowableExpenses: String(b.allowableExpenses),
      capitalAllowances: String(b.capitalAllowances),
    }))
  );
  const [employment, setEmployment] = useState(String(dummyTaxInput.incomeSources.employment));
  const [rent, setRent] = useState(String(dummyTaxInput.incomeSources.rent));
  const [otherIncome, setOtherIncome] = useState(String(dummyTaxInput.incomeSources.otherIncome));
  const [businessLosses, setBusinessLosses] = useState(String(sumAmounts(dummyTaxInput.losses)));
  const [donations, setDonations] = useState(String(sumAmounts(dummyTaxInput.donations)));

  const [zakat, setZakat] = useState(String(dummyTaxInput.zakat));
  const [claims, setClaims] = useState({});        // { code: amountString }
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load the relief catalogue once, and seed claims:
  // - auto reliefs are always granted at their cap (engine enforces this anyway)
  // - everything else starts from whatever `dummyTaxInput.reliefs` has for that
  //   code — the same swap-in-a-DB-later layer as the income fields above.
  useEffect(() => {
    getReliefs()
      .then((data) => {
        setCatalogue(data.reliefs);
        const seeded = {};
        data.reliefs.forEach((r) => {
          if (r.auto) seeded[r.code] = String(r.cap);
          else if (dummyTaxInput.reliefs[r.code] != null) seeded[r.code] = String(dummyTaxInput.reliefs[r.code]);
        });
        setClaims(seeded);
      })
      .catch(() => setError('Could not load reliefs — is the backend running on :8000?'));
  }, []);

  const setClaim = (code, value) => setClaims((c) => ({ ...c, [code]: value }));

  const addBusiness = () =>
    setBusinesses((b) => [...b, { grossIncome: '', allowableExpenses: '', capitalAllowances: '' }]);
  const removeBusiness = (i) => setBusinesses((b) => b.filter((_, idx) => idx !== i));
  const setBusinessField = (i, field, value) =>
    setBusinesses((b) => b.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));

  // Statutory income (Form B's own formula): gross income − allowable
  // expenses − capital allowances. Negative isn't clamped here — a
  // loss-making business should show as negative until the engine nets it
  // against aggregate income (it floors each business at 0 itself).
  const statutoryIncome = (row) =>
    (Number(row.grossIncome) || 0) - (Number(row.allowableExpenses) || 0) - (Number(row.capitalAllowances) || 0);

  const handleCalculate = async () => {
    setLoading(true);
    setError(null);
    try {
      // Send only numeric claim amounts the user entered (skip auto reliefs —
      // the engine grants those itself).
      const reliefs = {};
      catalogue.forEach((r) => {
        if (!r.auto && claims[r.code]) reliefs[r.code] = Number(claims[r.code]) || 0;
      });
      const data = await calculateTax({
        businesses: businesses.map((row) => statutoryIncome(row)),
        employment: Number(employment) || 0,
        rent: Number(rent) || 0,
        other_income: Number(otherIncome) || 0,
        business_losses: Number(businessLosses) || 0,
        donations: Number(donations) || 0,
        reliefs,
        zakat: Number(zakat) || 0,
        year_of_assessment: 2025,
      });
      setResult(data);
    } catch (e) {
      setError('Calculation failed — check the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background font-body">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">

        {/* Header */}
        <header>
          <h1 className="font-headings text-3xl font-bold tracking-tight text-headings">
            Tax Relief Calculator
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>Enter your income sources and reliefs to see chargeable income, tax, and savings.</span>
            <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-semibold text-primary">YA 2025</span>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-critical bg-critical-bg px-4 py-3 text-sm text-critical">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

          {/* ── Input form ───────────────────────────────────────────── */}
          <section className="space-y-6">
            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="font-headings text-lg font-semibold text-primary">Business income</h2>
              <p className="mt-1 text-sm text-muted">
                Enter gross income, allowable expenses and capital allowances per business — the calculator
                works out statutory income itself (gross income − allowable expenses − capital allowances).
                Add one row per business — matches Form B item B1a.
              </p>

              <div className="mt-4 space-y-3">
                {businesses.map((row, i) => {
                  const net = statutoryIncome(row);
                  return (
                    <div key={i} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-body-text">Business {i + 1}</span>
                        {businesses.length > 1 && (
                          <button
                            type="button" onClick={() => removeBusiness(i)}
                            className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-muted hover:border-critical hover:text-critical"
                            aria-label={`Remove business ${i + 1}`}
                          >✕</button>
                        )}
                      </div>

                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <label className="block">
                          <span className="text-xs text-muted">Gross income (RM)</span>
                          <input
                            type="number" min="0" value={row.grossIncome}
                            placeholder="0"
                            onChange={(e) => setBusinessField(i, 'grossIncome', e.target.value)}
                            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-headings outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted">Allowable expenses (RM)</span>
                          <input
                            type="number" min="0" value={row.allowableExpenses}
                            placeholder="0"
                            onChange={(e) => setBusinessField(i, 'allowableExpenses', e.target.value)}
                            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-headings outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted">Capital allowances (RM)</span>
                          <input
                            type="number" min="0" value={row.capitalAllowances}
                            placeholder="0"
                            onChange={(e) => setBusinessField(i, 'capitalAllowances', e.target.value)}
                            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-headings outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                          />
                        </label>
                      </div>

                      <p className="mt-2 text-xs text-muted">
                        Statutory income ={' '}
                        <span className={'font-semibold tabular-nums ' + (net < 0 ? 'text-critical' : 'text-headings')}>
                          {rm(net)}
                        </span>
                        {net < 0 && ' (loss — won\'t count as income; record it as a current-year business loss instead)'}
                      </p>
                    </div>
                  );
                })}
              </div>

              <button
                type="button" onClick={addBusiness}
                className="mt-3 text-sm font-medium text-primary hover:text-primary-hover"
              >+ Add another business</button>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-body-text">Employment income (RM)</span>
                  <input
                    type="number" min="0" value={employment}
                    onChange={(e) => setEmployment(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-headings outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-body-text">Rental income (RM)</span>
                  <input
                    type="number" min="0" value={rent}
                    onChange={(e) => setRent(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-headings outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-body-text">Other income (RM)</span>
                  <input
                    type="number" min="0" value={otherIncome}
                    onChange={(e) => setOtherIncome(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-headings outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="font-headings text-lg font-semibold text-primary">Losses &amp; donations</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-body-text">Current-year business losses (RM)</span>
                  <input
                    type="number" min="0" value={businessLosses}
                    onChange={(e) => setBusinessLosses(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-headings outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  />
                  <span className="mt-1 block text-xs text-muted">Offsets aggregate income, capped at the amount available.</span>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-body-text">Approved donations (RM)</span>
                  <input
                    type="number" min="0" value={donations}
                    onChange={(e) => setDonations(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-headings outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  />
                  <span className="mt-1 block text-xs text-muted">Capped at 10% of aggregate income (Form B item G2).</span>
                </label>
              </div>
              <label className="mt-4 block">
                <span className="text-sm font-medium text-body-text">Zakat paid (RM)</span>
                <input
                  type="number" min="0" value={zakat}
                  onChange={(e) => setZakat(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-headings outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
                <span className="mt-1 block text-xs text-muted">A rebate — comes off the tax bill directly, not the income.</span>
              </label>
            </div>

            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="font-headings text-lg font-semibold text-primary">Reliefs claimed</h2>
              <p className="mt-1 text-sm text-muted">Each is capped at its legal maximum automatically.</p>

              <div className="mt-4 space-y-3">
                {catalogue.map((r) => (
                  <label key={r.code} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-body-text">
                      {r.label}
                      <span className="ml-1.5 text-xs text-muted">· cap {rm(r.cap)}</span>
                      {r.auto && (
                        <span className="ml-1.5 rounded-full bg-primary-tint px-1.5 py-0.5 text-[10px] font-semibold text-primary">AUTO</span>
                      )}
                    </span>
                    <input
                      type="number" min="0"
                      value={claims[r.code] ?? ''}
                      disabled={r.auto}
                      placeholder="0"
                      onChange={(e) => setClaim(r.code, e.target.value)}
                      className={
                        'w-32 shrink-0 rounded-lg border px-3 py-1.5 text-right text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 ' +
                        (r.auto ? 'border-border bg-background text-muted' : 'border-border bg-surface text-headings')
                      }
                    />
                  </label>
                ))}
              </div>

              <button
                onClick={handleCalculate}
                disabled={loading || catalogue.length === 0}
                className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-surface transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                {loading ? 'Calculating…' : 'Calculate tax'}
              </button>
            </div>
          </section>

          {/* ── Result ───────────────────────────────────────────────── */}
          <section>
            {result ? (
              <div className="space-y-6">
                {/* Savings headline */}
                <div className="rounded-xl border border-border bg-primary-tint p-6">
                  <p className="text-sm font-medium text-primary">Reliefs saved you</p>
                  <p className="mt-1 font-headings text-4xl font-bold text-primary tabular-nums">{rm(result.relief_savings)}</p>
                  <p className="mt-1 text-sm text-primary/80">
                    vs {rm(result.tax_without_reliefs)} tax with no personal reliefs.
                  </p>
                </div>

                {/* Income waterfall — Form B Part B steps before reliefs */}
                <div className="rounded-xl border border-border bg-surface p-6">
                  <h2 className="font-headings text-lg font-semibold text-primary">Income waterfall</h2>
                  <div className="mt-4 divide-y divide-border">
                    {result.income_breakdown.businesses.map((amt, i) => (
                      <Row key={i} label={`Business ${i + 1} statutory income`} value={rm(amt)} />
                    ))}
                    {result.income_breakdown.employment > 0 && (
                      <Row label="Employment income" value={rm(result.income_breakdown.employment)} />
                    )}
                    {result.income_breakdown.rent > 0 && (
                      <Row label="Rental income" value={rm(result.income_breakdown.rent)} />
                    )}
                    {result.income_breakdown.other_income > 0 && (
                      <Row label="Other income" value={rm(result.income_breakdown.other_income)} />
                    )}
                    <Row label="Aggregate income" value={rm(result.income_breakdown.aggregate_income)} bold />
                    {result.business_losses.applied > 0 && (
                      <Row
                        label="Less: business losses"
                        value={'− ' + rm(result.business_losses.applied)}
                        note={result.business_losses.unabsorbed > 0 ? `${rm(result.business_losses.unabsorbed)} unabsorbed, carries forward` : null}
                      />
                    )}
                    {result.donations.applied > 0 && (
                      <Row
                        label="Less: approved donations"
                        value={'− ' + rm(result.donations.applied)}
                        note={result.donations.capped ? `capped at 10% of aggregate income (${rm(result.donations.cap)})` : null}
                      />
                    )}
                    <Row label="Total income" value={rm(result.total_income)} bold />
                  </div>
                </div>

                {/* Waterfall */}
                <div className="rounded-xl border border-border bg-surface p-6">
                  <h2 className="font-headings text-lg font-semibold text-primary">Breakdown</h2>
                  <div className="mt-4 divide-y divide-border">
                    <Row label="Total income" value={rm(result.total_income)} />
                    <Row label="Total reliefs applied" value={'− ' + rm(result.total_relief)} />
                    <Row label="Chargeable income" value={rm(result.chargeable_income)} bold />
                    <Row
                      label="Tax (before rebate)"
                      value={rm(result.tax_before_rebate)}
                      note={`marginal ${Math.round(result.marginal_bracket.rate * 100)}% bracket`}
                    />
                    {result.individual_rebate > 0 && (
                      <Row label="Individual rebate (RM400)" value={'− ' + rm(result.individual_rebate)} />
                    )}
                    {result.zakat > 0 && <Row label="Zakat rebate" value={'− ' + rm(result.zakat)} />}
                    <Row label="Tax payable" value={rm(result.tax_payable)} bold accent />
                  </div>
                </div>

                {/* Per-relief detail (shows which were capped) */}
                <div className="rounded-xl border border-border bg-surface p-6">
                  <h2 className="font-headings text-lg font-semibold text-primary">Reliefs applied</h2>
                  <div className="mt-3 space-y-2">
                    {result.reliefs.filter((r) => r.applied > 0).map((r) => (
                      <div key={r.code} className="flex items-center justify-between text-sm">
                        <span className="text-body-text">
                          {r.label}
                          {r.capped && (
                            <span className="ml-2 rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning">
                              capped from {rm(r.claimed)}
                            </span>
                          )}
                        </span>
                        <span className="font-medium text-headings tabular-nums">{rm(r.applied)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-64 items-center justify-center rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
                Enter values and hit <span className="mx-1 font-medium text-body-text">Calculate tax</span> to see your breakdown.
              </div>
            )}
          </section>

        </div>
      </div>
    </main>
  );
}

// One line in the breakdown waterfall.
function Row({ label, value, note, bold, accent }) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <span className={'text-sm ' + (bold ? 'font-semibold text-headings' : 'text-body-text')}>
        {label}
        {note && <span className="ml-2 text-xs text-muted">{note}</span>}
      </span>
      <span className={'font-headings text-sm font-semibold tabular-nums ' + (accent ? 'text-lg text-primary' : 'text-headings')}>
        {value}
      </span>
    </div>
  );
}

export default ReliefCalculator;
