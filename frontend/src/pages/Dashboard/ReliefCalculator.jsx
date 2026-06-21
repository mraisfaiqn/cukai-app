// ReliefCalculator — a thin vertical slice proving the frontend ↔ FastAPI
// ↔ calculation engine pipe works end to end. It loads the relief catalogue from
// GET /api/v1/tax/reliefs to build the form dynamically, then POSTs the entered
// values to /api/v1/tax/calculate and renders the breakdown the engine returns.
import { useEffect, useState } from 'react';
import { getReliefs, calculateTax } from '../../services/api';

// Format a number as Malaysian Ringgit, e.g. 96500 -> "RM 96,500".
const rm = (n) =>
  'RM ' + Number(n ?? 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function ReliefCalculator() {
  const [catalogue, setCatalogue] = useState([]); // relief defs from the backend
  const [income, setIncome] = useState('120000');
  const [zakat, setZakat] = useState('0');
  const [claims, setClaims] = useState({});        // { code: amountString }
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load the relief catalogue once, and seed auto reliefs at their cap.
  useEffect(() => {
    getReliefs()
      .then((data) => {
        setCatalogue(data.reliefs);
        const seeded = {};
        data.reliefs.forEach((r) => { if (r.auto) seeded[r.code] = String(r.cap); });
        setClaims(seeded);
      })
      .catch(() => setError('Could not load reliefs — is the backend running on :8000?'));
  }, []);

  const setClaim = (code, value) => setClaims((c) => ({ ...c, [code]: value }));

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
        total_income: Number(income) || 0,
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
            <span>Enter your income and reliefs to see chargeable income, tax, and savings.</span>
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
              <h2 className="font-headings text-lg font-semibold text-primary">Your income</h2>
              <label className="mt-4 block">
                <span className="text-sm font-medium text-body-text">Total income (RM)</span>
                <input
                  type="number" min="0" value={income}
                  onChange={(e) => setIncome(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-headings outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
              </label>
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
