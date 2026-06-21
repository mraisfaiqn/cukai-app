// ScopeTabs — the toggle between the two dashboard scopes:
//   "Our Firm" (shared · Form P)   and   "My Tax" (private · Form B)
// Presentational: the active scope + the change handler are owned by the page
// (PartnershipOverview), so this component stays stateless. The firm tab is only
// rendered when `hasFirm` is true — a plain sole prop with no partnership never
// sees it, exactly as described in the model.

function Tab({ id, label, sub, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={active}
      className={
        'flex-1 rounded-lg px-4 py-2.5 text-left transition-colors ' +
        (active
          ? 'bg-surface shadow-sm'
          : 'hover:bg-surface/60')
      }
    >
      <span className={'block text-sm font-semibold ' + (active ? 'text-primary' : 'text-body-text')}>
        {label}
      </span>
      <span className="mt-0.5 block text-xs text-muted">{sub}</span>
    </button>
  );
}

function ScopeTabs({ scope, onScopeChange, hasFirm }) {
  return (
    <div className="inline-flex w-full gap-1 rounded-xl border border-border bg-background p-1 sm:w-auto">
      {hasFirm && (
        <Tab
          id="firm"
          label="Our Firm"
          sub="Shared · Form P"
          active={scope === 'firm'}
          onSelect={onScopeChange}
        />
      )}
      <Tab
        id="personal"
        label="My Tax"
        sub="Private · Form B"
        active={scope === 'personal'}
        onSelect={onScopeChange}
      />
    </div>
  );
}

export default ScopeTabs;
