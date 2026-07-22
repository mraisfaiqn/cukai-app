// StatCard — one KPI tile in the dashboard's top stats strip.
// Presentational apart from one piece of state: whether this card's info
// popover is open. `detail` is optional — when present, an (i) button appears
// beside the label and opens a panel explaining how the number was built.
// `icon`/`iconTint` render a tinted chip beside the label (design mock parity).
// `compact` reduces padding and font sizes for the no-scroll layout.

import { useState, useRef, useEffect } from 'react';

const InfoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);


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
  const [open, setOpen] = useState(false);
  const cardRef = useRef(null);

  // Close on click-outside or Escape. Listeners attach only while open;
  // cleanup removes them so idle cards aren't listening to every click.
  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e) {
      if (cardRef.current && !cardRef.current.contains(e.target)) setOpen(false);
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const changeColor =
    changeTone === 'success' ? 'text-success'
    : changeTone === 'danger' ? 'text-critical'
    : 'text-muted';

  return (
    <div
  ref={cardRef}
  className={
    'relative flex h-full flex-col justify-between rounded-2xl border transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ' +
    (open ? 'z-50 ' : 'z-0 ') +
    (compact ? 'py-3 px-4' : 'py-4 px-6') + ' ' +
    (highlight
      ? 'border-primary/20 bg-primary/5 shadow-md'
      : 'border-slate-200 bg-white shadow-sm')
  }
>
   {/* Label row: title on the left, icon on the right */}
      <div className="flex items-start justify-between">
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

      {/* Value — the headline figure */}
      <p
  className={
    'font-headings font-bold tracking-tight leading-none ' +
    (compact
      ? 'mt-3 text-2xl'
      : 'mt-4 text-[2.2rem]') +
    ' ' +
    (highlight ? 'text-primary' : 'text-headings')
  }
>
        {value}
      </p>

     {/* Change line + info button on the same row */}
      <div className={'flex items-center justify-between ' + (compact ? 'mt-2' : 'mt-3')}>
        {change ? (
          <p
            className={
              'flex items-center gap-1.5 text-[10px] font-medium ' +
              (highlight ? 'text-primary' : changeColor)
            }
          >
            {changeIcon}
            {change}
          </p>
        ) : <span />}
        {detail && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={`How ${label} is calculated`}
            aria-expanded={open}
            className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <InfoIcon />
          </button>
        )}
      </div>

      {/* Popover — anchored to this card */}
      {open && detail && (
        <div className="absolute left-0 top-full z-50 mt-2 max-h-80 w-72 overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="font-headings text-sm font-bold text-headings">{label}</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close"
              className="shrink-0 text-muted hover:text-headings">
              <CloseIcon />
            </button>
          </div>

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