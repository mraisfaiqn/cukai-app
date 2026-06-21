// PartnershipOverview — the two-scope dashboard.
// Composes the page from presentational pieces and owns the ONE stateful bit:
// which scope is showing (firm vs personal). This mirrors the tax boundary —
//   "Our Firm"  (shared · Form P)   ↔   "My Tax"  (private · Form B)
// A partner sees both tabs; a plain sole prop with no firm only ever sees "My Tax".
import { useState } from 'react';
import { currentUser, firm, allocation, personal, roleLabels } from '../../data/partnershipData';
import ScopeTabs from '../../components/Partnership/ScopeTabs';
import FirmScope from '../../components/Partnership/FirmScope';
import PersonalScope from '../../components/Partnership/PersonalScope';

// Whether the logged-in user belongs to a partnership at all. In a real build
// this is "does a firm_membership row exist for me"; here we infer it from the
// presence of an allocation row for this user.
const hasFirm = allocation.some((p) => p.taxpayerId === currentUser.taxpayerId);

// Only the principal partner may edit firm-level details / the profit split.
// Note this gates FIRM editing only — it never unlocks a co-partner's Form B.
const canEditFirm = currentUser.role === 'principal';

function PartnershipOverview() {
  // Default to the firm view if the user is a partner, else straight to personal.
  const [scope, setScope] = useState(hasFirm ? 'firm' : 'personal');

  return (
    <main className="min-h-screen bg-background font-body">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">

        {/* Header: firm identity + the scope toggle */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-headings text-3xl font-bold tracking-tight text-headings">
              {hasFirm ? firm.name : 'My Tax'}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              {hasFirm && (
                <>
                  <span className="font-medium text-body-text">{firm.type}</span>
                  <span aria-hidden="true">·</span>
                  <span>{firm.msic}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span className="rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-semibold text-primary">
                {firm.assessmentYear}
              </span>
            </div>
          </div>

          <ScopeTabs scope={scope} onScopeChange={setScope} hasFirm={hasFirm} />
        </header>

        {/* Role banner — only meaningful in the firm scope. Makes the permission
            model visible: what you can do here, and the privacy line you can't cross. */}
        {scope === 'firm' && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
            <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-surface">
              {roleLabels[currentUser.role]}
            </span>
            <span className="text-body-text">
              {canEditFirm
                ? 'You can edit firm details and the profit split.'
                : 'You can view the firm and upload shared receipts.'}
            </span>
            <span aria-hidden="true" className="text-muted">·</span>
            <span className="text-muted">Each partner’s personal tax stays private to them.</span>
          </div>
        )}

        {/* The active scope */}
        {scope === 'firm' ? (
          <FirmScope firm={firm} allocation={allocation} currentTaxpayerId={currentUser.taxpayerId} />
        ) : (
          <PersonalScope personal={personal} name={currentUser.name} />
        )}

      </div>
    </main>
  );
}

export default PartnershipOverview;
