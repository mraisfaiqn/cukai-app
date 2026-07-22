// StatCard — one KPI tile in the dashboard's top stats strip.
// Presentational apart from one piece of state: whether this card's info
// popover is showing. `detail` is optional — when present, hovering the
// whole card reveals a panel explaining how the number was built (no
// separate (i) button needed to discover it).
// `icon`/`iconTint` render a tinted chip beside the label (design mock parity).
// `compact` reduces padding and font sizes for the no-scroll layout.

import { useState } from 'react';

function StatCard({
  label,
  value,
  change,
  changeIcon,
  changeTone = 'muted',
  highlight = false,
  compact = false,
  detail = null,        // { formula, equation, components: [{label, amount, count}], note }
  icon = null,          // React node shown in the tinted chip beside the label
  iconTint = 'bg-primary-tint text-primary',
}) {
  const [hovered, setHovered] = useState(false);

  const changeColor =
    changeTone === 'success' ? 'text-success'
    : changeTone === 'danger' ? 'text-critical'
    : 'text-muted';

  const showPopover = hovered && !!detail;

  return (
    <div
      onMouseEnter={() => detail && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={
        'relative flex h-full flex-col rounded-2xl border transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ' +
        (showPopover ? 'z-50 ' : 'z-0 ') +
        (compact ? 'py-3 px-4' : 'py-4 px-6') + ' ' +
        (highlight
          ? 'border-primary/20 bg-primary/5 shadow-md'
          : 'border-slate-200 bg-white shadow-sm')
      }
    >
      {/* Label row: title on the left, icon on the right */}
      <div className="flex items-start justify-between shrink-0">
        <p
          className={
            'font-headings text-sm font-semibold text-slate-700 leading-5 ' +
            (highlight ? 'text-primary' : '')
          }
        >
          {label}
        </p>
        {icon && (
          <span
            className={
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ' +
              iconTint
            }
          >
            {icon}
          </span>
        )}
      </div>

      {/* Value — the headline figure, vertically centered in the space
          between the label and the change line so this card's height can
          flex to match whatever height its row neighbor needs, without
          leaving an awkward gap under a top-anchored figure. */}
      <div className="flex flex-1 pt-4 pb-4 items-center justify-start min-h-0">
        <p
          className={
            'font-headings font-bold tracking-tight leading-none ' +
            (compact ? 'text-2xl' : 'text-[2.2rem]') +
            ' ' +
            (highlight ? 'text-primary' : 'text-headings')
          }
        >
          {value}
        </p>
      </div>

      {/* Change line */}
      <div className={'flex items-center justify-start shrink-0 ' + (compact ? 'mt-2' : 'mt-3')}>
        {change && (
          <p
            className={
              'flex items-center gap-1.5 text-xs font-medium ' +
              (highlight ? 'text-primary' : changeColor)
            }
          >
            {changeIcon}
            {change}
          </p>
        )}
      </div>

      {/* Popover — anchored to this card, shown on hover instead of click */}
      {showPopover && (
        <div className="absolute left-0 top-full z-50 mt-2 max-h-80 w-72 overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-lg">
          <p className="font-headings text-sm font-bold text-headings">{label}</p>

          {detail.formula && (
            <p className="mt-2 rounded-lg bg-primary-tint px-2.5 py-1.5 text-[11px] leading-relaxed text-muted">
              {detail.formula}
            </p>
          )}

          {detail.formula2 && (
            <p className="mt-2 rounded-lg border border-border px-2.5 py-1.5 text-center font-mono text-[11px] text-headings">
              {detail.formula2}
            </p>
          )}

          {detail.equation && (
            <p className="mt-2 rounded-lg border border-border px-2.5 py-1.5 text-center font-mono text-[11px] text-headings">
              {detail.equation}
            </p>
          )}

          {detail.components?.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted">Made up of</p>
              {detail.components.map((c) => (
                <div key={c.label} className="flex items-start justify-between gap-3 border-t border-border py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-headings">{c.label}</p>
                    {c.count && <p className="mt-0.5 text-[10px] text-muted">{c.count}</p>}
                  </div>
                  <p className="shrink-0 text-xs font-semibold text-headings">{c.amount}</p>
                </div>
              ))}
            </div>
          )}

          {detail.note && (
            <p className="mt-3 border-t border-border pt-2 text-[10px] leading-relaxed text-muted">
              {detail.note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default StatCard;