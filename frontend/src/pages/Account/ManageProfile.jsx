import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import cukaiLogo from '../../assets/cukai-logo.png';
import { currentFilingYear, buildFormData, fmtAmt } from '../../data/formB';

// A4 page geometry used by renderNodeToPdfBlob below.
const PDF_PAGE_WIDTH_MM = 210;
const PDF_PAGE_HEIGHT_MM = 297;
// Standard A4 document margin (~Word's "Normal" preset), reserved on EVERY
// page — not just once around the whole tall document. The old approach
// baked a single margin into the top/bottom of the entire off-screen node
// before slicing it into pages; that only ever produced a margin on page 1's
// top and the last page's bottom, leaving every other page-break completely
// edge-to-edge, which is the actual bug behind "the bottom margin isn't
// applied". Reserving the margin at PDF-placement time, per page, fixes
// that for good.
const PDF_MARGIN_MM = 15;
const PDF_CONTENT_WIDTH_MM = PDF_PAGE_WIDTH_MM - PDF_MARGIN_MM * 2;   // 180mm
const PDF_CONTENT_HEIGHT_MM = PDF_PAGE_HEIGHT_MM - PDF_MARGIN_MM * 2; // 267mm
// Fixed render width (px) for the off-screen Form B node. This now
// represents the PRINTABLE content width (not the full page), at ~96dpi,
// since the page margin is applied separately at PDF-placement time.
const PDF_SOURCE_WIDTH_PX = Math.round(PDF_CONTENT_WIDTH_MM * 96 / 25.4); // ≈ 680px
// Rasterization scale for html2canvas — higher = crisper text in the PDF.
const PDF_RENDER_SCALE = 2;

/**
 * Wait for every <img> inside `node` to finish loading. html2canvas snapshots
 * whatever is in the DOM the instant it's called — if the logo (or any other
 * image) hasn't finished loading yet, it gets captured at whatever partial/
 * fallback size the browser has for it at that moment, which is what was
 * actually behind the header logo rendering short and mis-centered against
 * the text next to it. Doesn't reject on a failed image — we'd rather
 * render without it than hang forever.
 */
function waitForImages(node) {
  const images = Array.from(node.querySelectorAll('img'));
  return Promise.all(images.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  }));
}

/**
 * Freeze every element's resolved border/background/text colors as inline
 * styles, in place, on the live node.
 *
 * This is the fix for the stray "black" hairlines: html2canvas renders from
 * its own clone of the document, matched against Tailwind's generated
 * stylesheet — and arbitrary-value utility classes like `border-[#EDF1F5]`
 * compile to CSS selectors with escaped characters (`.border-\[\#EDF1F5\]`)
 * that html2canvas's stylesheet handling doesn't always resolve reliably.
 * When a border-color class silently fails to apply in the clone, the
 * border falls back to `currentColor` — i.e. the element's own (usually
 * dark) text color — which is exactly the "black border" artifact reported.
 * Reading the ACTUAL computed color from the live, correctly-styled node and
 * writing it back as a plain inline style sidesteps that stylesheet-matching
 * step entirely: inline styles travel with the cloned element unconditionally.
 */
function freezeComputedColors(node) {
  const els = [node, ...node.querySelectorAll('*')];
  for (const el of els) {
    const cs = window.getComputedStyle(el);
    el.style.color = cs.color;
    el.style.backgroundColor = cs.backgroundColor;
    el.style.borderTopColor = cs.borderTopColor;
    el.style.borderRightColor = cs.borderRightColor;
    el.style.borderBottomColor = cs.borderBottomColor;
    el.style.borderLeftColor = cs.borderLeftColor;
    el.style.borderTopWidth = cs.borderTopWidth;
    el.style.borderRightWidth = cs.borderRightWidth;
    el.style.borderBottomWidth = cs.borderBottomWidth;
    el.style.borderLeftWidth = cs.borderLeftWidth;
    el.style.borderTopStyle = cs.borderTopStyle;
    el.style.borderRightStyle = cs.borderRightStyle;
    el.style.borderBottomStyle = cs.borderBottomStyle;
    el.style.borderLeftStyle = cs.borderLeftStyle;
  }
}

// Small safety margin (canvas px) around each row's measured bounds when
// deciding whether a page break would cut through it. Without this, a
// break landing within a pixel or two of a row's true edge — plausible
// given we measure in CSS px via getBoundingClientRect and then scale up
// to canvas px — could still clip a hairline sliver off that row.
const ROW_SPLIT_GUARD_PX = 3;

/**
 * Render a DOM node to a paginated A4 PDF Blob.
 *
 * Three things make this more than a one-shot html2canvas→jsPDF snapshot:
 *
 * 1. Real per-page margins: the tall canvas is sliced into PDF_CONTENT_HEIGHT_MM
 *    chunks and each chunk is placed inset by PDF_MARGIN_MM on every page, so
 *    every page — not just the first/last — gets a proper margin all round.
 *
 * 2. Row-aware page breaks: elements marked with `data-pdf-row` (form line
 *    items, table rows, etc.) are measured before rasterizing, and a page
 *    break is never allowed to land inside one of them (with a small safety
 *    margin either side) — the break is pulled back to just above the row
 *    instead, pushing that row whole onto the next page.
 *
 * 3. Deterministic capture: images and fonts are guaranteed fully loaded,
 *    and every color is frozen as an inline style, before html2canvas ever
 *    runs — so the result doesn't depend on browser cache warmth or
 *    stylesheet-cloning quirks, and Preview vs. Export always produce the
 *    same output for the same data.
 */
/**
 * Replace the ENTIRE header row — logo, brand wordmark, "Form B Draft"
 * title, and the Year of Assessment block — with a single flattened <img>,
 * composited on a canvas with full manual control over every element's
 * vertical position.
 *
 * Trying to vertically align an <img> against several separate text blocks
 * via CSS, through html2canvas's rasterization, kept producing small but
 * visible per-column offsets across several attempts — html2canvas's
 * flexbox/table cross-axis alignment isn't pixel-perfect, so even
 * provably-correct CSS centering could come out of that pipeline slightly
 * wrong. Compositing everything into one image ourselves sidesteps the
 * problem instead of continuing to chase it: canvas drawImage() and
 * fillText(textBaseline: 'middle') both take an explicit y coordinate, so
 * every element is told to share the exact same vertical center directly,
 * with no layout engine in between to disagree.
 */
async function flattenHeaderLockup(node, filingYear) {
  const wrap = node.querySelector('[data-pdf-header-wrap]');
  const headerEl = wrap && wrap.querySelector('[data-pdf-header]');
  if (!wrap || !headerEl) return;

  // Idempotency: undo whatever a PREVIOUS call to this function left behind
  // before reading anything. Without this, a second Preview/Export click in
  // the same session (no page refresh) would find its own earlier flattened
  // <img> sitting where the pristine logo used to be, composite THAT in as
  // if it were the small square logo, and produce a distorted result — the
  // header never had a chance to go back to its original state to rebuild
  // from. Restoring first means every call starts from the same pristine
  // markup regardless of how many times it's run.
  headerEl.style.display = '';
  const prevFlat = wrap.querySelector('[data-pdf-header-flat]');
  if (prevFlat) prevFlat.remove();

  const img = headerEl.querySelector('img');
  if (!img || !img.naturalWidth) return;

  const rect = headerEl.getBoundingClientRect();
  const scale = 3; // extra headroom for crispness at print resolution
  const logoSize = img.getBoundingClientRect().height;
  const gapPx = 10; // matches the original gap-2.5
  const boldFont = "700 20px Inter, sans-serif";
  const lightFont = "300 20px Inter, sans-serif";
  const titleFont = "500 20px Inter, sans-serif";
  const labelFont = "400 10px Inter, sans-serif";
  const yearFont = "900 20px Inter, sans-serif";
  const labelText = 'YEAR OF ASSESSMENT';
  const yearText = String(filingYear);
  const labelTracking = 0.6; // approximates the original tracking-wide

  // Measure everything first, on a scratch canvas, using the exact fonts
  // we're about to draw with — rather than trusting the live DOM's layout,
  // which is a *different* text-layout engine (DOM flow vs. canvas
  // fillText) and can legitimately come out a few px different.
  const measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = boldFont;
  const cukaiWidth = measureCtx.measureText('cukai').width;
  const dotWidth = measureCtx.measureText('.').width;
  measureCtx.font = lightFont;
  const aiWidth = measureCtx.measureText('ai').width;
  measureCtx.font = titleFont;
  const titleWidth = measureCtx.measureText('Form B Draft').width;
  measureCtx.font = labelFont;
  const labelWidth = measureCtx.measureText(labelText).width + labelTracking * (labelText.length - 1);
  measureCtx.font = yearFont;
  const yearWidth = measureCtx.measureText(yearText).width;

  const contentWidth = rect.width;
  const contentHeight = Math.max(rect.height, logoSize);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(contentWidth * scale);
  canvas.height = Math.ceil(contentHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  const centerY = contentHeight / 2;
  ctx.textBaseline = 'middle';

  // Left: logo + brand wordmark.
  ctx.drawImage(img, 0, (contentHeight - logoSize) / 2, logoSize, logoSize);
  let x = logoSize + gapPx;
  ctx.font = boldFont;
  ctx.fillStyle = '#0F172A';
  ctx.fillText('cukai', x, centerY);
  x += cukaiWidth;
  ctx.fillStyle = '#10B981';
  ctx.fillText('.', x, centerY);
  x += dotWidth;
  ctx.font = lightFont;
  ctx.fillStyle = '#64748B';
  ctx.fillText('ai', x, centerY);
  void aiWidth; // (measured for completeness; not needed positionally — nothing sits after "ai")

  // Middle: "Form B Draft", centered across the full row width.
  ctx.font = titleFont;
  ctx.fillStyle = '#0F172A';
  ctx.fillText('Form B Draft', (contentWidth - titleWidth) / 2, centerY);

  // Right: small grey label stacked over the bolded year, right-aligned to
  // the row's right edge, with the two-line block centered as a whole
  // around the same centerY as everything else.
  const labelLineHeight = 12;
  const yearLineHeight = 20;
  const blockTop = centerY - (labelLineHeight + yearLineHeight) / 2;
  ctx.font = labelFont;
  ctx.fillStyle = '#94A3B8';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${labelTracking}px`;
  ctx.fillText(labelText, contentWidth - labelWidth, blockTop + labelLineHeight / 2);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.font = yearFont;
  ctx.fillStyle = '#0F172A';
  ctx.fillText(yearText, contentWidth - yearWidth, blockTop + labelLineHeight + yearLineHeight / 2);

  const flatImg = new Image();
  flatImg.setAttribute('data-pdf-header-flat', 'true');
  flatImg.src = canvas.toDataURL('image/png');
  flatImg.style.width = `${contentWidth}px`;
  flatImg.style.height = `${contentHeight}px`;
  flatImg.style.display = 'block';
  // Hide (not remove) the pristine original and add the flattened image as
  // a sibling — html2canvas will only see whichever is visible, and the
  // original stays intact in the DOM for the next call to rebuild from.
  headerEl.style.display = 'none';
  wrap.appendChild(flatImg);
  if (!flatImg.complete) {
    await new Promise((resolve) => { flatImg.onload = resolve; flatImg.onerror = resolve; });
  }
}

async function renderNodeToPdfBlob(node, filingYear) {
  // Let images finish loading, web fonts finish applying, and the browser
  // paint at least one settled frame before we touch anything else.
  await waitForImages(node);
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* ignore */ }
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  // Fonts are guaranteed loaded now, so it's safe to draw text with them on
  // a canvas — flatten the whole header row into one image.
  await flattenHeaderLockup(node, filingYear);

  // Bake every color in as an inline style now that layout/fonts/images have
  // fully settled, so html2canvas's clone can't lose any of them.
  freezeComputedColors(node);

  // Measure atomic row rects (in unscaled CSS px, relative to the node) before
  // rasterizing — html2canvas gives us pixels, not the DOM, so this is our
  // only chance to know where a "row" begins and ends.
  const containerRect = node.getBoundingClientRect();
  const rowRectsCss = Array.from(node.querySelectorAll('[data-pdf-row]')).map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top - containerRect.top, bottom: r.bottom - containerRect.top };
  });

  const canvas = await html2canvas(node, {
    scale: PDF_RENDER_SCALE,
    useCORS: true,
    backgroundColor: '#ffffff',
    windowWidth: PDF_SOURCE_WIDTH_PX,
  });

  // Actual px-per-CSS-px the canvas ended up at (normally === PDF_RENDER_SCALE,
  // but deriving it from the real output avoids drift if html2canvas rounds
  // internally).
  const scaleFactor = canvas.width / containerRect.width;
  const rowRects = rowRectsCss.map((r) => ({ top: r.top * scaleFactor, bottom: r.bottom * scaleFactor }));

  const pxPerMm = canvas.width / PDF_CONTENT_WIDTH_MM;
  const pageContentHeightPx = PDF_CONTENT_HEIGHT_MM * pxPerMm;

  // Walk down the canvas building page-break offsets. Each candidate break is
  // pulled back to the top of whichever row it would otherwise cut through
  // (with ROW_SPLIT_GUARD_PX of slack on either side of the row's true bounds).
  const breaks = [0];
  let cursor = 0;
  while (cursor < canvas.height - 1) {
    let next = Math.min(cursor + pageContentHeightPx, canvas.height);
    for (const row of rowRects) {
      if (row.top - ROW_SPLIT_GUARD_PX < next && next < row.bottom + ROW_SPLIT_GUARD_PX) {
        // Only pull back if that doesn't stall progress (a single row taller
        // than a full page can't be avoided; let it fall through as-is).
        const pulledBack = Math.max(0, row.top - ROW_SPLIT_GUARD_PX);
        if (pulledBack > cursor + 1) next = pulledBack;
        break;
      }
    }
    breaks.push(next);
    cursor = next;
  }

  const pdf = new jsPDF('p', 'mm', 'a4');
  // The browser's own built-in PDF viewer (the one rendering the <embed> in
  // the Preview panel) reads this /Title metadata for the filename it
  // suggests on ITS OWN download button — that's the actual fix for that
  // button showing a random-looking name: for a blob: URL there's no real
  // path to derive a name from, so the viewer falls back to this instead.
  pdf.setProperties({ title: `Form B Draft - YA${filingYear}` });
  const sliceCanvas = document.createElement('canvas');
  sliceCanvas.width = canvas.width;
  const sliceCtx = sliceCanvas.getContext('2d');

  for (let i = 0; i < breaks.length - 1; i++) {
    const startPx = breaks[i];
    const sliceHeightPx = Math.max(1, Math.round(breaks[i + 1] - startPx));
    sliceCanvas.height = sliceHeightPx;
    sliceCtx.clearRect(0, 0, sliceCanvas.width, sliceHeightPx);
    sliceCtx.drawImage(
      canvas,
      0, Math.round(startPx), canvas.width, sliceHeightPx,
      0, 0, canvas.width, sliceHeightPx,
    );
    const imgData = sliceCanvas.toDataURL('image/png');
    if (i > 0) pdf.addPage();
    // Inset by the margin on every page — this is the actual "top and bottom
    // margin on every page, not just the first/last" fix.
    // Explicit 'MEDIUM' compression here matters a lot: without it, jsPDF
    // embeds the PNG data close to raw/uncompressed, which is what was
    // producing multi-megabyte pages (tens of MB for the whole document).
    // This is lossless PNG compression, not JPEG-style quality loss — it
    // just controls how hard jsPDF's own encoder works, at no cost to
    // visual fidelity.
    pdf.addImage(imgData, 'PNG', PDF_MARGIN_MM, PDF_MARGIN_MM, PDF_CONTENT_WIDTH_MM, sliceHeightPx / pxPerMm, undefined, 'MEDIUM');
  }

  return pdf.output('blob');
}

/* ---------- Icons ---------- */

const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const BuildingIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[16px] w-[16px] text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" /><line x1="9" y1="22" x2="9" y2="16" /><line x1="15" y1="22" x2="15" y2="16" /><line x1="9" y1="16" x2="15" y2="16" />
    <path d="M8 6h2v2H8V6zm4 0h2v2h-2V6zM8 10h2v2H8v-2zm4 0h2v2h-2v-2z" />
  </svg>
);
const SwitchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 3 21 8 16 13" /><line x1="21" y1="8" x2="9" y2="8" /><polyline points="8 21 3 16 8 11" /><line x1="3" y1="16" x2="15" y2="16" />
  </svg>
);
const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const XIcon = ({ className = "h-4 w-4" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const MapPinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 shrink-0 text-[#94A3B8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);
const AlertTriangleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 text-[#D85A30]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const UserIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px] text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);
const ChevronRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

/* ---------- Constants ---------- */

const MALAYSIAN_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang',
  'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor',
  'Terengganu', 'W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya',
];

const BLANK_SOLE_PROP = {
  name: '',
  businessCode: '',
  businessActivity: '',
  ssmNo: '',
  tin: '',
  premiseAddress: '',
  premisePostcode: '',
  premiseCity: '',
  premiseState: '',
  // Financial particulars (Form N)
  salesTurnover: '',
  totalExpenditure: '',
  netProfitLoss: '',
  totalAssets: '',
  totalLiabilities: '',
};

const BLANK_PERSONAL_PROFILE = {
  // Identity & residency
  fullName: '',
  identificationNo: '',
  passportNo: '',
  personalTin: '',
  citizenship: '',
  gender: '',
  dateOfBirth: '',
  // Marital / dependents
  maritalStatus: '',
  maritalEventDate: '',
  spouseName: '',
  spouseIdNo: '',
  spousePassportNo: '',
  spouseDob: '',
  assessmentType: '',
  numberOfChildren: '0',
  hasDisabledDependents: false,
  // Contact
  phone: '',
  email: '',
  correspondenceAddress: '',
  correspondencePostcode: '',
  correspondenceCity: '',
  correspondenceState: '',
  refundMethod: 'bank',
  bankName: '',
  bankAccountNo: '',
  duitnowIdType: 'ic',
  // Other Particulars (Form B Part D)
  employerTin: '',
  taxBorneByEmployer: false,
  carriesOnEcommerce: false,
  ecommerceModel: '',
  // Compliance flags
  recordKeeping: true,
  hasForeignAccounts: false,
  rpgtDisposal: false,
  disposalDeclared: false,
  // Relief category toggles
  hasDependentParents: false,
  hasEpfLifeInsurance: false,
  hasEducationMedicalInsurance: false,
  hasLifestylePurchases: false,
  hasSspnEvOther: false,
};

/* ---------- Small UI primitives ---------- */

const Field = ({ label, required, hint, children, span = 1 }) => (
  <div className={span === 2 ? 'col-span-2' : 'col-span-1'}>
    <label className="block text-xs font-semibold text-headings mb-1">
      {label}{required && <span className="text-[#D85A30]"> *</span>}
    </label>
    {children}
    {hint && <p className="text-[10px] text-[#94A3B8] mt-1">{hint}</p>}
  </div>
);

const inputClass = "w-full text-xs px-3 py-2 rounded-lg border border-slate-200 text-headings placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors duration-150";
const selectClass = inputClass + " bg-white";

const TextInput = (props) => <input type="text" className={inputClass} {...props} />;
const SelectInput = ({ children, ...props }) => <select className={selectClass} {...props}>{children}</select>;

const SectionLabel = ({ children }) => (
  <h4 className="text-[11px] font-bold uppercase tracking-wider text-primary mb-2.5">{children}</h4>
);

const ToggleRow = ({ label, hint, checked, onChange }) => (
  <label className="flex items-start justify-between gap-3 py-2 cursor-pointer">
    <div className="min-w-0">
      <p className="text-xs font-semibold text-headings">{label}</p>
      {hint && <p className="text-[10px] text-[#94A3B8] mt-0.5 leading-relaxed">{hint}</p>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-9 h-5 rounded-full transition-colors duration-150 ${checked ? 'bg-primary' : 'bg-slate-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  </label>
);

const formatMoney = (val) => {
  if (val === '' || val === null || val === undefined) return null;
  const num = Number(val);
  if (Number.isNaN(num)) return val;
  return `RM ${num.toLocaleString()}`;
};

const formatAddress = (entity) => {
  const line = entity.premiseAddress;
  const city = entity.premiseCity;
  const state = entity.premiseState;
  const postcode = entity.premisePostcode;
  const cityLine = [postcode, city].filter(Boolean).join(' ');
  return [line, cityLine, state].filter(Boolean).join(', ');
};

/* =========================================================================
   PERSONAL PROFILE — account-level section
   ========================================================================= */

const PersonalProfileSummary = ({ profile, onOpen }) => {
  const childLabel = profile.numberOfChildren === '0' || !profile.numberOfChildren
    ? 'No dependents'
    : `${profile.numberOfChildren} ${Number(profile.numberOfChildren) === 1 ? 'child' : 'children'} on record`;

  return (
    <button
      onClick={onOpen}
      className="w-full bg-surface p-4 rounded-xl border border-slate-100 shadow-sm flex items-center gap-4 text-left hover:border-primary/40 transition-colors duration-150"
    >
      <div className="h-11 w-11 rounded-full bg-primary-tint border border-slate-100 flex items-center justify-center shrink-0">
        <UserIcon />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold text-headings truncate">{profile.fullName || 'Your name'}</h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted mt-0.5">
          <span>{profile.personalTin || 'No TIN set'}</span>
          <span className="text-slate-300">•</span>
          <span className="capitalize">{(profile.maritalStatus || '').replace('-', ' ') || 'Not set'}</span>
          <span className="text-slate-300">•</span>
          <span>{childLabel}</span>
        </div>
      </div>
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary shrink-0">
        <EditIcon />Edit profile
      </span>
    </button>
  );
};

const PersonalProfilePanel = ({ profile, onClose, onSave }) => {
  const [draft, setDraft] = useState(profile);

  React.useEffect(() => {
    if (profile) {
      setDraft(profile);
    }
  }, [profile]); // Fires automatically the exact millisecond personalProfile updates!

  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });
  const setVal = (key) => (val) => setDraft({ ...draft, [key]: val });

  const isMarried = draft.maritalStatus === 'married';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative h-full w-full max-w-md bg-white shadow-xl flex flex-col animate-[slideIn_0.2s_ease-out]">
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        <div className="shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-full bg-primary-tint border border-slate-100 flex items-center justify-center shrink-0">
              <UserIcon />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-headings truncate">Personal Profile</h3>
              <p className="text-[11px] text-muted">Used across all entities you file for</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-headings transition-colors duration-150 shrink-0" aria-label="Close panel">
            <XIcon />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-2.5">

          <SectionLabel>Identity & Residency</SectionLabel>
          <Field label="Full name (as per IC/passport)" required>
            <TextInput value={draft.fullName} onChange={set('fullName')} placeholder="Full legal name" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="IC no.">
              <TextInput value={draft.identificationNo} onChange={set('identificationNo')} placeholder="YYMMDD-PB-XXXX" />
            </Field>
            <Field label="Passport no.">
              <TextInput value={draft.passportNo} onChange={set('passportNo')} placeholder="A12345678" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Tax Identification No. (TIN)" required>
              <TextInput value={draft.personalTin} onChange={set('personalTin')} placeholder="IG 1234567890" />
            </Field>
            <Field label="Citizenship" hint="Country code, MYS if Malaysian">
              <TextInput value={draft.citizenship} onChange={set('citizenship')} placeholder="MYS" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Gender">
              <SelectInput value={draft.gender} onChange={set('gender')}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </SelectInput>
            </Field>
            <Field label="Date of birth">
              <input type="date" className={inputClass} value={draft.dateOfBirth} onChange={set('dateOfBirth')} />
            </Field>
          </div>

          <SectionLabel><span className="mt-2 block">Marital Status & Dependents</span></SectionLabel>
          <Field label="Marital status as at 31 Dec">
            <SelectInput value={draft.maritalStatus} onChange={set('maritalStatus')}>
              <option value="single">Single</option>
              <option value="married">Married</option>
              <option value="divorced-widowed">Divorcee / Widow / Widower</option>
              <option value="deceased">Deceased</option>
            </SelectInput>
          </Field>
          {(draft.maritalStatus === 'divorced-widowed' || draft.maritalStatus === 'deceased') && (
            <Field label="Date of divorce / demise">
              <input type="date" className={inputClass} value={draft.maritalEventDate} onChange={set('maritalEventDate')} />
            </Field>
          )}
          {isMarried && (
            <>
              <Field label="Date of marriage">
                <input type="date" className={inputClass} value={draft.maritalEventDate} onChange={set('maritalEventDate')} />
              </Field>
              <Field label="Spouse's name">
                <TextInput value={draft.spouseName} onChange={set('spouseName')} placeholder="Full name" />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Spouse's IC no.">
                  <TextInput value={draft.spouseIdNo} onChange={set('spouseIdNo')} placeholder="YYMMDD-PB-XXXX" />
                </Field>
                <Field label="Spouse's passport no.">
                  <TextInput value={draft.spousePassportNo} onChange={set('spousePassportNo')} placeholder="A12345678" />
                </Field>
              </div>
              <Field label="Spouse's date of birth">
                <input type="date" className={inputClass} value={draft.spouseDob} onChange={set('spouseDob')} />
              </Field>
            </>
          )}
          {/* Type of assessment (Form B item A7) always applies to every filer,
              not just married ones — LHDN's own code 5 covers single/divorcee/
              widow/widower/deceased. Election only makes sense when married
              (codes 1-4); otherwise it's automatic, shown read-only. */}
          {isMarried ? (
            <Field label="Type of assessment election">
              <SelectInput value={draft.assessmentType} onChange={set('assessmentType')}>
                <option value="joint-husband">Joint — in the name of husband</option>
                <option value="joint-wife">Joint — in the name of wife</option>
                <option value="separate">Separate</option>
                <option value="self-spouse-no-income">Self whose spouse has no income, no source of income or has tax exempt income</option>
              </SelectInput>
            </Field>
          ) : (
            <Field label="Type of assessment" hint="Automatic — no election needed when not married">
              <div className={inputClass + ' bg-slate-50 text-muted cursor-not-allowed'}>
                Self (Single / divorcee / widow / widower / deceased)
              </div>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Number of children">
              <TextInput value={draft.numberOfChildren} onChange={set('numberOfChildren')} inputMode="numeric" placeholder="0" />
            </Field>
            <div className="flex items-end pb-2">
              <ToggleRow
                label="Disabled dependents"
                checked={draft.hasDisabledDependents}
                onChange={setVal('hasDisabledDependents')}
              />
            </div>
          </div>

          <SectionLabel><span className="mt-2 block">Contact & Correspondence</span></SectionLabel>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Phone / handphone">
              <TextInput value={draft.phone} onChange={set('phone')} placeholder="012-345 6789" />
            </Field>
            <Field label="Email">
              <TextInput value={draft.email} onChange={set('email')} placeholder="name@email.com" />
            </Field>
          </div>
          <Field label="Correspondence address">
            <TextInput value={draft.correspondenceAddress} onChange={set('correspondenceAddress')} placeholder="Street address" />
          </Field>
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="Postcode">
              <TextInput value={draft.correspondencePostcode} onChange={set('correspondencePostcode')} placeholder="47500" />
            </Field>
            <Field label="City">
              <TextInput value={draft.correspondenceCity} onChange={set('correspondenceCity')} placeholder="Subang Jaya" />
            </Field>
            <Field label="State">
              <SelectInput value={draft.correspondenceState} onChange={set('correspondenceState')}>
                <option value="" disabled>Select</option>
                {MALAYSIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </SelectInput>
            </Field>
          </div>

          <SectionLabel><span className="mt-2 block">Other Particulars</span></SectionLabel>
          <Field label="Employer's TIN" hint="From your Form EA, or enter manually">
            <TextInput value={draft.employerTin} onChange={set('employerTin')} placeholder="C 12345678090" />
          </Field>
          {draft.employerTin && (
            <ToggleRow
              label="Tax borne by employer"
              hint="Your employer pays your income tax on your behalf"
              checked={draft.taxBorneByEmployer}
              onChange={setVal('taxBorneByEmployer')}
            />
          )}
          <ToggleRow
            label="Foreign financial accounts"
            hint="You hold account(s) at financial institutions outside Malaysia"
            checked={draft.hasForeignAccounts}
            onChange={setVal('hasForeignAccounts')}
          />
          <ToggleRow
            label="Carries on e-Commerce"
            hint="You run an online / e-commerce business"
            checked={draft.carriesOnEcommerce}
            onChange={setVal('carriesOnEcommerce')}
          />
          {draft.carriesOnEcommerce && (
            <Field label="e-Commerce business model">
              <SelectInput value={draft.ecommerceModel} onChange={set('ecommerceModel')}>
                <option value="" disabled>Select</option>
                <option value="online_sales">Online sales / services</option>
                <option value="online_advertising">Online advertising</option>
                <option value="cloud_computing">Cloud computing</option>
                <option value="payment_services">Payment services</option>
                <option value="digital_currency">Digital currency / Digital token</option>
                <option value="e_hailing">E-Hailing / P-Hailing</option>
                <option value="others">Others</option>
              </SelectInput>
            </Field>
          )}
          <Field label="Method of payment for tax refund">
            <SelectInput value={draft.refundMethod} onChange={set('refundMethod')}>
              <option value="bank">Payment via bank account</option>
              <option value="duitnow">Payment via DuitNow</option>
            </SelectInput>
          </Field>
          {draft.refundMethod === 'bank' && (
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Bank name">
                <TextInput value={draft.bankName} onChange={set('bankName')} placeholder="e.g. Maybank" />
              </Field>
              <Field label="Account no.">
                <TextInput value={draft.bankAccountNo} onChange={set('bankAccountNo')} placeholder="1234567890" />
              </Field>
            </div>
          )}
          {draft.refundMethod === 'duitnow' && (
            <Field label="DuitNow identification type (self)">
              <SelectInput value={draft.duitnowIdType} onChange={set('duitnowIdType')}>
                <option value="ic">Identification card</option>
                <option value="passport">Passport</option>
              </SelectInput>
            </Field>
          )}
          <ToggleRow
            label="Asset disposal under RPGT 1976"
            hint="You disposed of an asset under the Real Property Gains Tax Act this year"
            checked={draft.rpgtDisposal}
            onChange={setVal('rpgtDisposal')}
          />
          {draft.rpgtDisposal && (
            <ToggleRow
              label="Disposal declared to LHDNM"
              hint="You've already declared this disposal to LHDN"
              checked={draft.disposalDeclared}
              onChange={setVal('disposalDeclared')}
            />
          )}

          <SectionLabel><span className="mt-2 block">Record Keeping</span></SectionLabel>
          <div className="divide-y divide-slate-50">
            <ToggleRow
              label="Record-keeping"
              hint="You maintain business records as required by LHDN"
              checked={draft.recordKeeping}
              onChange={setVal('recordKeeping')}
            />
          </div>

          <SectionLabel><span className="mt-2 block">Relief Categories to Prompt For</span></SectionLabel>
          <p className="text-[11px] text-muted -mt-1.5 mb-1 leading-relaxed">
            These toggles determine which Part H relief questions you'll be asked during filing.
          </p>
          <div className="divide-y divide-slate-50">
            <ToggleRow
              label="Dependent parents"
              hint="Medical, dental, special needs or carer expenses for parents"
              checked={draft.hasDependentParents}
              onChange={setVal('hasDependentParents')}
            />
            <ToggleRow
              label="EPF, life insurance &amp; PRS"
              hint="Voluntary EPF contributions, life insurance / takaful premiums, or Private Retirement Scheme (PRS)"
              checked={draft.hasEpfLifeInsurance}
              onChange={setVal('hasEpfLifeInsurance')}
            />
            <ToggleRow
              label="Education & medical insurance"
              hint="Premiums paid for education or medical insurance"
              checked={draft.hasEducationMedicalInsurance}
              onChange={setVal('hasEducationMedicalInsurance')}
            />
            <ToggleRow
              label="Lifestyle purchases"
              hint="Books, devices, internet subscription, sports equipment"
              checked={draft.hasLifestylePurchases}
              onChange={setVal('hasLifestylePurchases')}
            />
            <ToggleRow
              label="SSPN, EV charging & other reliefs"
              hint="SSPN net deposit, EV charging facilities, breastfeeding equipment, childcare fees"
              checked={draft.hasSspnEvOther}
              onChange={setVal('hasSspnEvOther')}
            />
          </div>
        </div>

        <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="flex-1 py-2 px-3 text-xs border border-slate-200 rounded-lg font-medium text-headings hover:bg-slate-50 transition-colors duration-150">
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="flex-1 py-2 px-3 text-xs bg-primary text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 hover:bg-primary-hover transition-colors duration-150"
          >
            <CheckIcon />Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};

/* =========================================================================
   TAB NAVIGATION — Manage Entities / Generate Forms
   ========================================================================= */

const ProfileTabNav = ({ active, onChange }) => {
  const tabs = [
    { id: 'entities', label: 'Manage Entities' },
    { id: 'forms',    label: 'Generate Forms' },
  ];
  return (
    <nav className="flex items-center gap-6 border-b border-slate-100 shrink-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`relative pb-2 pt-0.5 text-sm font-medium transition-all duration-150 select-none ${
            active === t.id ? 'text-primary font-semibold' : 'text-muted hover:text-headings'
          }`}
        >
          {t.label}
          {active === t.id && <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-[#0F6E56]" />}
        </button>
      ))}
    </nav>
  );
};

/* =========================================================================
   ENTITY CARD — dense, 3-up
   ========================================================================= */

const EntityCard = ({ entity, active, onSwitch, onOpenPreview, personalTin }) => {
  const Icon = BuildingIcon;
  const filingNote = 'Files Form B';
  const address = formatAddress(entity);
  const netProfit = formatMoney(entity.netProfitLoss);

  return (
    <button
      onClick={onOpenPreview}
      className={`h-full w-full bg-surface p-3.5 rounded-xl border shadow-sm flex flex-col text-left transition-colors duration-150 hover:border-primary/40 ${active ? 'border-primary/40' : 'border-slate-100'}`}
    >
      {/* Header row: icon + name + role badge on the left side, Active badge pinned top-right */}
      <div className="flex justify-between items-start mb-2.5 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 bg-primary-tint rounded-lg border border-slate-100 shrink-0"><Icon /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="text-sm font-bold text-headings truncate">{entity.name || 'Untitled Entity'}</h3>
            </div>
            <p className="text-[12px] text-muted">Sole Proprietorship</p>
          </div>
        </div>
        {active && (
          <span className="bg-primary-tint text-primary border border-emerald-100 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0">
            Active
          </span>
        )}
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 text-[12px] mb-2">
        <span className="text-muted">SSM No:</span><span className="font-semibold text-headings truncate">{entity.ssmNo || '—'}</span>
        <span className="text-muted">Personal TIN:</span><span className="font-semibold text-headings truncate">{personalTin || '—'}</span>
        <span className="text-muted">Code:</span><span className="font-semibold text-headings truncate">{entity.businessCode || '—'}</span>
        <span className="text-muted">Net profit:</span><span className="font-semibold text-headings truncate">{netProfit ?? '—'}</span>
      </div>

      <p className="text-[12px] text-muted truncate mb-2">{entity.businessActivity || 'No activity specified'}</p>

      {address && (
        <div className="flex items-start gap-1.5 text-[12px] text-[#94A3B8] mb-2.5">
          <div className="pt-0.5"><MapPinIcon /></div>
          <span className="leading-snug line-clamp-2">{address}</span>
        </div>
      )}

      <div className="flex-1" />

      <div className="flex items-center justify-between text-[11px] text-[#94A3B8] border-t border-slate-50 pt-2">
        <span>{filingNote}</span>
        <span className="inline-flex items-center gap-1 font-semibold text-primary">
          View full profile<ChevronRightIcon />
        </span>
      </div>
    </button>
  );
};

/* =========================================================================
   ENTITY PREVIEW / EDIT SLIDE-OVER — full depth
   ========================================================================= */
const EntityPreviewPanel = ({ entity, active, isOnlyEntity, isNew = false, onClose, onSave, onSwitch, onDelete }) => {
  const [draft, setDraft] = useState(entity);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });
  const canSave = isNew ? !!(draft.name && draft.ssmNo) : true;
  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      // On success the parent closes this panel (unmounting it); on failure it
      // stays open, so re-enable the button. Resetting after an unmount is a
      // harmless no-op in React 18.
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />

      <div className="relative h-full w-full max-w-md bg-white shadow-xl flex flex-col animate-[slideIn_0.2s_ease-out]">
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        <div className="shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-primary-tint rounded-lg border border-slate-100 shrink-0">
              <BuildingIcon />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <h3 className="text-sm font-bold text-headings truncate">
                  {isNew ? 'New Sole Proprietorship' : (draft.name || 'Untitled Entity')}
                </h3>
              </div>
              <p className="text-[11px] text-muted">Sole Proprietorship</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-headings transition-colors duration-150 shrink-0" aria-label="Close panel">
            <XIcon />
          </button>
        </div>

        {active && (
          <div className="shrink-0 px-5 pt-3">
            <span className="bg-primary-tint text-primary border border-emerald-100 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
              Active Entity
            </span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-2.5">

          {/* Business particulars */}
          <SectionLabel>Business Particulars</SectionLabel>
          <Field label='Business name' required>
            <TextInput value={draft.name} onChange={set('name')} placeholder="As registered with SSM" />
          </Field>
          <Field label="SSM registration no." required>
            <TextInput value={draft.ssmNo} onChange={set('ssmNo')} placeholder="e.g. 202103145678" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Business code">
              <TextInput value={draft.businessCode} onChange={set('businessCode')} placeholder="LHDN business code" />
            </Field>
            <Field label="Type of business activity">
              <TextInput value={draft.businessActivity} onChange={set('businessActivity')} placeholder="e.g. F&B retail" />
            </Field>
          </div>

          {/* Financial particulars — sole prop only */}
          <SectionLabel><span className="mt-2 block">Financial Particulars (Form N)</span></SectionLabel>
          <p className="text-[10px] text-[#94A3B8] -mt-1.5 mb-1">High-level P&L and balance sheet figures. Detailed line items are entered during filing.</p>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Sales / turnover">
              <TextInput value={draft.salesTurnover} onChange={set('salesTurnover')} placeholder="0.00" inputMode="decimal" />
            </Field>
            <Field label="Total expenditure">
              <TextInput value={draft.totalExpenditure} onChange={set('totalExpenditure')} placeholder="0.00" inputMode="decimal" />
            </Field>
          </div>
          <Field label="Net profit / loss">
            <TextInput value={draft.netProfitLoss} onChange={set('netProfitLoss')} placeholder="0.00" inputMode="decimal" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Total assets">
              <TextInput value={draft.totalAssets} onChange={set('totalAssets')} placeholder="0.00" inputMode="decimal" />
            </Field>
            <Field label="Total liabilities">
              <TextInput value={draft.totalLiabilities} onChange={set('totalLiabilities')} placeholder="0.00" inputMode="decimal" />
            </Field>
          </div>

          {/* Address */}
          <SectionLabel><span className="mt-2 block">Business Premise</span></SectionLabel>
          <Field label="Address">
            <TextInput
              value={draft.premiseAddress}
              onChange={set('premiseAddress')}
              placeholder="Street address"
            />
          </Field>
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="Postcode">
              <TextInput
                value={draft.premisePostcode}
                onChange={set('premisePostcode')}
                placeholder="40150"
              />
            </Field>
            <Field label="City">
              <TextInput
                value={draft.premiseCity}
                onChange={set('premiseCity')}
                placeholder="Shah Alam"
              />
            </Field>
            <Field label="State">
              <SelectInput
                value={draft.premiseState}
                onChange={set('premiseState')}
              >
                <option value="" disabled>Select</option>
                {MALAYSIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </SelectInput>
            </Field>
          </div>

          {/* Danger zone — hidden when creating a new entity */}
          {!isNew && <div className="mt-4 pt-4 border-t border-slate-100">
            <SectionLabel><span className="text-[#D85A30]">Danger Zone</span></SectionLabel>
            {!confirmingDelete ? (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D85A30] hover:text-[#993C1D] transition-colors duration-150"
              >
                <TrashIcon />Delete this entity
              </button>
            ) : (
              <div className="rounded-lg border border-[#F0997B] bg-[#FAECE7] p-3">
                <div className="flex gap-2.5">
                  <AlertTriangleIcon />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-[#712B13]">
                      {isOnlyEntity ? 'You cannot delete your only entity.' : `Delete "${draft.name || 'this entity'}"?`}
                    </p>
                    <p className="text-[11px] text-[#993C1D] mt-0.5 leading-relaxed">
                      {isOnlyEntity
                        ? 'At least one entity profile must remain on your account.'
                        : 'This permanently removes all saved profile data for this entity. Filing history is not affected.'}
                    </p>
                    {!isOnlyEntity && (
                      <div className="flex gap-2 mt-2.5">
                        <button
                          onClick={() => setConfirmingDelete(false)}
                          className="py-1.5 px-3 text-xs border border-slate-200 rounded-lg font-medium text-headings hover:bg-slate-50 transition-colors duration-150"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={onDelete}
                          className="py-1.5 px-3 text-xs bg-[#D85A30] text-white rounded-lg font-semibold hover:bg-[#993C1D] transition-colors duration-150"
                        >
                          Confirm Delete
                        </button>
                      </div>
                    )}
                    {isOnlyEntity && (
                      <button
                        onClick={() => setConfirmingDelete(false)}
                        className="mt-2.5 py-1.5 px-3 text-xs border border-slate-200 rounded-lg font-medium text-headings hover:bg-slate-50 transition-colors duration-150"
                      >
                        Got it
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>}
        </div>

        <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-slate-100">
          {!active && !isNew && (
            <button
              onClick={onSwitch}
              className="flex-1 py-2 px-3 text-xs border border-slate-200 rounded-lg font-medium text-headings flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-colors duration-150"
            >
              <SwitchIcon />Switch to Entity
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className={`flex-1 py-2 px-3 text-xs rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-colors duration-150 ${!canSave ? "bg-slate-100 text-slate-400 cursor-not-allowed" : saving ? "bg-primary/70 text-white cursor-wait" : "bg-primary text-white hover:bg-primary-hover"}`}
          >
            {saving ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-90" />
                </svg>
                Saving…
              </>
            ) : (
              <>
                <CheckIcon />{isNew ? 'Create Entity' : 'Save Changes'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

/* =========================================================================
   GENERATE FORMS — Form B draft for the individual (sole proprietor)
   --------------------------------------------------------------------------
   Built entirely from the user's own data: their personal profile plus every
   business entity they own. Financials are ACCUMULATED across all entities;
   the main business (highest sales turnover, or the sole entity) supplies the
   Part N particulars. Nothing re-fetches on entity switch — it's the person's
   return, not a per-entity view.

   All non-component logic (filing year, formatting, tax + relief computation,
   buildFormData) lives in ./formB.js so this file stays a clean Fast Refresh
   boundary. Only React components live here.
   ========================================================================= */

// ─── Government-form primitives (Form B look) ────────────────────────────────
// Parts are appended directly below one another (no gap) so the document
// reads as one continuous form rather than a stack of separately-floating
// boxes. Only the very first Part draws its own top border — every
// subsequent Part shares the previous Part's bottom border as its top edge,
// so two 1px borders never sit flush against each other (which is its own
// source of stray dark seams once rasterized).
const FPart = ({ code, title, children }) => (
  <div className="border-x border-b border-[#CBD5E1] first:border-t">
    <div data-pdf-row="true" className="flex items-center gap-2 bg-[#E2E8F0] border-b border-[#CBD5E1] px-2 py-1">
      {code && <span className="text-[10px] font-bold text-[#0F172A]">{code}</span>}
      <span className="text-[10px] font-bold uppercase tracking-wide text-[#0F172A]">{title}</span>
    </div>
    <div className="divide-y divide-[#EDF1F5]">{children}</div>
  </div>
);

// `data-pdf-row` marks this as an atomic unit for PDF pagination — see
// renderNodeToPdfBlob — so a page break is never allowed to land inside a
// single form row.
//
// Uses CSS table layout (table/table-cell), not flexbox. html2canvas's
// flexbox support is the weakest part of its rendering engine — cross-axis
// alignment (vertical centering) and consistent column widths across many
// sibling rows would come out subtly wrong in the rasterized PDF even
// though the live CSS was correct. table-cell's `vertical-align: middle` is
// a much older, much more reliably-supported primitive, and table-fixed
// layout guarantees the code/value columns land at the same x-position on
// every single row instead of drifting with each row's own content.
const FRow = ({ code, label, value, sub, strong, highlight, flatLabel }) => (
  <div data-pdf-row="true" className={`table w-full table-fixed text-[10px] ${highlight ? 'bg-[#F0FDF4]' : ''}`}>
    <div className="table-cell w-9 align-middle border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">{code || ''}</div>
    <div className={`table-cell align-middle px-2 py-1 text-left ${flatLabel ? 'text-[#334155]' : `${sub ? 'pl-4 text-[#64748B]' : 'text-[#334155]'} ${strong ? 'font-semibold text-[#0F172A]' : ''}`}`}>{label}</div>
    <div className={`table-cell w-36 align-middle border-l border-[#EDF1F5] px-2 py-1 text-right tabular-nums ${strong ? 'font-bold text-[#0F172A]' : (highlight ? 'text-[#0F6E56] font-semibold' : 'text-[#0F172A]')}`}>{value}</div>
  </div>
);

// ─── The full Form B document (Basic Particulars → Part P) ───────────────────
// Faithful to the LHDN Form B (CP4A) skeleton: every part is present and
// numbered; values are filled from the user's data where available and left
// blank (as on the real form) where the app doesn't hold that figure.
// Part J's two claim blocks (127(3)(b) and 127(3A)) each render as a 4-row
// block: the code (J1/J2) sits in its own narrow column spanning all 4 rows
// (same flex-stretch technique as B21/B27/B30/B33's spanning columns), with
// the title, header row, and two blank data rows stacked to its right.
// Column 1's width (w-9) matches the standard code-column width used
// throughout the rest of the document, not a table-specific size.
function IncentiveClaimTable({ code, title, firstColLabel }) {
  const gridCols = 'grid grid-cols-[28px_repeat(5,minmax(0,1fr))]';
  return (
    <div className="flex items-stretch text-[10px]">
      <div className="w-9 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium flex items-center">{code}</div>
      <div className="flex-1 flex flex-col divide-y divide-[#EDF1F5]">
        <div data-pdf-row="true" className="px-2 py-1 text-[#334155]">{title}</div>
        <div data-pdf-row="true" className={`items-center ${gridCols} text-[9px] font-semibold uppercase tracking-wide text-[#64748B] bg-[#F8FAFC]`}>
          <div className="col-span-2 border-r border-[#EDF1F5] px-2 py-1">{firstColLabel}</div>
          <div className="border-r border-[#EDF1F5] px-2 py-1">Balance Brought Forward</div>
          <div className="border-r border-[#EDF1F5] px-2 py-1">Amount Claimed</div>
          <div className="border-r border-[#EDF1F5] px-2 py-1">Amount Absorbed</div>
          <div className="px-2 py-1">Balance Carried Forward</div>
        </div>
        {['i.', 'ii.'].map((roman) => (
          <div key={roman} data-pdf-row="true" className={`items-center ${gridCols} text-[10px] text-[#334155]`}>
            <div className="border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">{roman}</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">—</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
            <div className="px-2 py-1 text-right tabular-nums">—</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const FormBDocument = ({ fd, filingYear, embedded = false }) => {
  const blank = '';
  // Part H field lookup: real figure where the pipeline mapped one to this
  // H-code, otherwise blank — the correct representation of "we don't have
  // this yet" rather than a misleading 0.
  const hv = (code) =>
    (fd.reliefByCode && fd.reliefByCode[code] != null) ? fmtAmt(fd.reliefByCode[code]) : '—';
  // Always full width of whatever container renders it — both the embedded
  // (Generate Forms tab) and non-embedded (PDF generation) cases. The old
  // fixed 620px width for the non-embedded case is gone: it left the content
  // stranded in a narrow left-aligned column with a large unexplained blank
  // strip on the right once printed to PDF. The true "A4 page" margin is now
  // applied once, as padding around the off-screen render source in
  // GenerateFormsPanel, so the form itself always fills the full printable
  // width between those margins.
  return (
    <div className="bg-white text-[#0F172A] w-full">
      {/* Masthead — cukai.ai branded. No LHDN marks, form-code badge, or
          statutory citation: this is a preparation aid, not an LHDN document.
          Skipped when embedded (Generate Forms tab shows the form body only —
          the Preview modal is the only place branding/disclaimer appear). */}
      {!embedded && (
        <div className="table w-full px-5 py-4 border-b-2 border-[#0F172A]">
          {/* table/table-cell is just the on-screen fallback layout, kept in
              case flattening below doesn't run for some reason (e.g. the
              image failing to load). For the actual PDF, the whole row —
              logo, brand, title, and YA block — gets replaced with ONE
              flattened image before capture; see flattenHeaderLockup. That's
              what actually guarantees every element shares a true vertical
              center: html2canvas's flex/table cross-axis centering kept
              coming out slightly wrong for a row this mixed (an image plus
              several independently-styled text blocks), even when the live
              CSS was correct.

              data-pdf-header-wrap holds both the pristine original row AND
              (once generated) the flattened image as siblings, rather than
              flattenHeaderLockup replacing the original in place — repeated
              Preview/Export clicks in the same session need the ORIGINAL
              logo/text still there to rebuild from each time, otherwise the
              second run reads back its own previous flattened output as if
              it were the raw logo and composites on top of that again
              (the "header gets distorted if I don't refresh" bug). */}
          <div data-pdf-header-wrap="true" className="contents">
            <div data-pdf-header="true" className="table-row">
              {/* Left: cukai logo + brand name — original brand colours. */}
              <div className="table-cell align-middle whitespace-nowrap">
                <img src={cukaiLogo} alt="Cukai.ai logo" className="h-10 w-10 inline-block align-middle" />
                <span className="ml-2.5 inline-block align-middle select-none text-xl font-bold leading-none tracking-tight text-[#0F172A]">
                  cukai
                  <span className="text-[#10B981]">.</span>
                  <span className="font-light text-[#64748B]">ai</span>
                </span>
              </div>

              {/* Middle: form title — lighter weight than the brand wordmark */}
              <div className="table-cell align-middle text-center px-3">
                <p className="text-xl font-medium leading-none text-[#0F172A]">
                  Form B Draft
                </p>
              </div>

              {/* Right: small grey label over the bolded year, like the original layout */}
              <div className="table-cell align-middle text-right whitespace-nowrap">
                <p className="text-[10px] uppercase tracking-wide text-[#94A3B8] leading-tight">Year of Assessment</p>
                <p className="text-xl font-black leading-none text-[#0F172A]">{filingYear}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="px-5 py-3">
        <FPart title="Basic Particulars">
          <FRow code="1" label="Name (as per identification document)" value={fd.name} />
          <FRow code="2" label="Tax Identification No. (TIN)" value={fd.tin} />
          <FRow code="3" label="Identification no." value={fd.idNo} />
          <FRow code="4" label="Current passport no." value={fd.passportNo} />
          <FRow code="5" label="Passport no. registered with LHDNM" value="—" />
        </FPart>

        <FPart code="A" title="Particulars of Individual">
          <FRow code="A1" label="Citizen (country code)" value={fd.citizen} />
          <FRow code="A2" label="Gender" value={fd.gender} />
          <FRow code="A3" label="Date of birth" value={fd.dob} />
          <FRow code="A4" label={`Status as at 31-12-${filingYear}`} value={fd.marital} />
          <FRow code="A5" label="Date of marriage / divorce / demise" value={fd.maritalEventDate} />
          <FRow code="A6" label="Record-keeping" value={fd.recordKeeping} />
          <FRow code="A7" label="Type of assessment" value={fd.assessment} />
        </FPart>

        <FPart code="B" title="Computation of Income Tax">
          <FRow code="B1"  label="Statutory income from sources of businesses in Malaysia" value={fmtAmt(fd.b1)} flatLabel />
          <FRow code="B1a" label="Number of businesses" value="—" flatLabel />
          <FRow code="B2"  label="Statutory income from sources of partnerships in Malaysia" value={fmtAmt(0)} flatLabel />
          <FRow code="B2a" label="Number of partnerships" value="—" flatLabel />
          <FRow code="B3"  label="Aggregate statutory income from sources of business and partnership outside Malaysia received in Malaysia (Amount from E4)" value={fmtAmt(0)} flatLabel />
          <FRow code="B4"  label="Aggregate statutory income from businesses ( B1 + B2 + B3 )" value={fmtAmt(fd.b4)} flatLabel />
          <FRow code="B5"  label="LESS: Business losses brought forward (Restricted to B4)" value={fmtAmt(0)} flatLabel />
          <FRow code="B6"  label="TOTAL ( B4 – B5 )" value={fmtAmt(fd.b6)} flatLabel />
          <FRow code="B7"  label="Statutory income from sources of employment in Malaysia" value={fmtAmt(fd.b7)} flatLabel />
          <FRow code="B7a" label="Number of employment" value="—" flatLabel />
          <FRow code="B8"  label="Statutory income from sources of rents in Malaysia" value={fmtAmt(fd.b8)} flatLabel />
          <FRow code="B9"  label="Statutory income from sources of interest, discounts, royalties, premiums, pensions, annuities, other periodical payments, other gains or profits and additions pursuant to paragraph 43(1)(c) in Malaysia" value={fmtAmt(fd.b9)} flatLabel />
          <FRow code="B10" label="Aggregate of other statutory income from sources outside Malaysia received in Malaysia (Amount from F4)" value={fmtAmt(0)} flatLabel />
          <FRow code="B11" label="AGGREGATE INCOME ( B6 + B7 + B8 + B9 + B10 )" value={fmtAmt(fd.b11)} strong flatLabel />
          <FRow code="B12" label="LESS: Approved investment under angel investor tax incentive (Restricted to B11)" value={fmtAmt(0)} flatLabel />
          <FRow code="B13" label="TOTAL [ B11 – B12 ] (Enter '0' if value is negative)" value={fmtAmt(fd.b13)} flatLabel />
          <FRow code="B14" label="LESS: Current year business losses (Restricted to B13)" value={fmtAmt(0)} flatLabel />
          <FRow code="B15" label="TOTAL [ B13 – B14 ] (Enter '0' if value is negative)" value={fmtAmt(fd.b15)} flatLabel />
          <FRow code="B16" label="LESS: Other expenses [Qualifying prospecting expenditure – Schedule 4] (Restricted to B15)" value={fmtAmt(0)} flatLabel />
          <FRow code="B17" label="LESS: Approved donations / gifts / contributions (Amount from G8)" value={fmtAmt(fd.donationsG8)} flatLabel />
          <FRow code="B18" label="TOTAL [ B15 – B16 – B17 ] (Enter '0' if value is negative)" value={fmtAmt(fd.b18)} flatLabel />
          <FRow code="B19" label="TAXABLE PIONEER INCOME" value={fmtAmt(0)} flatLabel />
          <FRow code="B20" label="TOTAL INCOME [SELF] ( B18 + B19 )" value={fmtAmt(fd.b20)} strong flatLabel />

          {/* B21 — code column merges across both rows: row 1 is the main
              transferred-income total, row 2 is the income-type note. */}
          <div className="flex items-stretch text-[10px]">
            <div className="w-9 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium flex items-center">B21</div>
            <div className="flex-1 flex flex-col divide-y divide-[#EDF1F5]">
              <div className="flex items-stretch">
                <div className="flex-1 px-2 py-1 text-left text-[#334155]">TOTAL INCOME TRANSFERRED FROM HUSBAND / WIFE * FOR JOINT ASSESSMENT</div>
                <div className="w-36 shrink-0 border-l border-[#EDF1F5] px-2 py-1 text-right tabular-nums text-[#0F172A]">{fmtAmt(0)}</div>
              </div>
              <div className="flex items-stretch">
                <div className="flex-1 px-2 py-1 text-left text-[#334155]">* Type of income transferred from HUSBAND / WIFE</div>
                <div className="w-36 shrink-0 border-l border-[#EDF1F5] px-2 py-1 text-right tabular-nums text-[#334155]">—</div>
              </div>
            </div>
          </div>

          <FRow code="B22" label="AGGREGATE OF TOTAL INCOME ( B20 + B21 )" value={fmtAmt(fd.b22)} flatLabel />
          <FRow code="B23" label="Total relief (Amount from H22)" value={fmtAmt(fd.b23)} flatLabel />
          <FRow code="B24" label="CHARGEABLE INCOME [ ( B20 – B23 ) or ( B22 – B23 ) ] (Enter '0' if value is negative)" value={fmtAmt(fd.b24)} highlight flatLabel />

          <FRow code="B25a" label="Tax on the first" value="—" flatLabel />
          <FRow code="B25b" label="Tax on the balance, at rate —%" value="—" flatLabel />
          <FRow code="B26" label="TOTAL INCOME TAX ( B25a + B25b )" value={fmtAmt(fd.b26)} flatLabel />
          <FRow code="B27i"   label="Rebate — Self" value={fmtAmt(fd.lowIncomeRebate)} flatLabel />
          <FRow code="B27ii"  label="Rebate — Husband / Wife" value="—" flatLabel />
          <FRow code="B27iii" label="Rebate — Departure levy for umrah travel / religious travel for other religions (Restricted to 2 trips in a lifetime)" value="—" flatLabel />
          <FRow code="B27iv"  label="Rebate — No. of trips" value="—" flatLabel />
          <FRow code="B27v"   label="Rebate — Zakat and fitrah" value={fmtAmt(fd.zakatRebate)} flatLabel />
          <FRow code="B27"    label="TOTAL REBATE" value={fmtAmt(fd.b27)} flatLabel />
          <FRow code="B28" label="TOTAL TAX CHARGED (B26 − B27) (Enter '0' if value is negative)" value={fmtAmt(fd.b28)} strong flatLabel />
          <FRow code="B29" label="LESS: Section 110 tax deduction (others)" value={fmtAmt(0)} flatLabel />
          <FRow code="B30i"  label="LESS: Section 132 tax relief (Restricted to B28)" value={fmtAmt(0)} flatLabel />
          <FRow code="B30ii" label="LESS: Section 133 tax relief (Restricted to B28)" value={fmtAmt(0)} flatLabel />
          <FRow code="B30"   label="TOTAL Section 132 / 133 tax relief" value={fmtAmt(0)} flatLabel />
          <FRow code="B31" label="TAX PAYABLE [B28 − (B29 + B30)]" value={fmtAmt(fd.b31)} highlight flatLabel />
          <FRow code="B32" label="OR: TAX REPAYABLE [(B29 + B30) − B28]" value="—" flatLabel />
          <FRow code="B33i"   label="Payment made — Monthly Tax Deductions (MTD)" value={fmtAmt(fd.mtdWithheld)} flatLabel />
          <FRow code="B33ii"  label="Payment made — Section 107D" value="—" flatLabel />
          <FRow code="B33iii" label="Payment made — Self installments / CP500" value={fmtAmt(fd.cp500Paid)} flatLabel />
          <FRow code="B33"    label={`Payment made for ${filingYear} income – SELF and HUSBAND / WIFE for joint assessment`} value={fmtAmt(fd.b33)} flatLabel />
          <FRow code="B34" label="Balance of tax payable (B31 − B33) / Tax paid in excess (B33 − B31)" value={fmtAmt(Math.abs(fd.b34))} highlight flatLabel />
        </FPart>

        <FPart code="C" title="Particulars of Husband / Wife">
          <FRow code="C1" label="Name of husband / wife (as per identification document)" value={fd.spouseName} />
          <FRow code="C2" label="Identification no." value={fd.spouseIdNo} />
          <FRow code="C3" label="Date of birth" value={fd.spouseDob} />
          <FRow code="C4" label="Passport no." value={fd.spousePassportNo} />
        </FPart>

        <FPart code="D" title="Other Particulars">
          <FRow code="D1" label="Telephone no. / Handphone no." value={fd.phone} flatLabel />
          <FRow code="D2" label="E-mail" value={fd.email} flatLabel />
          <FRow code="D3" label="Employer's TIN" value={fd.employerTin} flatLabel />
          <FRow code="D4" label="Tax borne by employer" value={fd.taxBorneByEmployer} flatLabel />
          <FRow code="D5" label="Financial account(s) outside Malaysia" value={fd.hasForeignAccounts} flatLabel />
          <FRow code="D6a" label="Carries on e-Commerce" value={fd.carriesOnEcommerce} flatLabel />
          <FRow code="D6b" label="e-Commerce business model" value={fd.ecommerceModel} flatLabel />
          <FRow code="D7" label="Address of business premise" value={fd.businessAddress} flatLabel />
          <FRow code="D8" label="Correspondence address" value={fd.correspondenceAddress} flatLabel />
          <FRow code="D9" label="Method of payment for tax refund" value={fd.refundMethod} flatLabel />
          <FRow code="D10a" label="Name of bank" value={fd.bankName} flatLabel />
          <FRow code="D10b" label="Bank account no." value={fd.bankAccountNo} flatLabel />
          <FRow code="D11a" label="DuitNow — identification type (self)" value={fd.duitnowIdType} flatLabel />
          <FRow code="D11b" label="DuitNow — passport no. (if applicable)" value={fd.duitnowPassportNo} flatLabel />
          <FRow code="D12a" label="Disposal of asset under the Real Property Gains Tax Act 1976" value={fd.rpgtDisposal} flatLabel />
          <FRow code="D12b" label="Disposal declared to LHDNM" value={fd.disposalDeclared} flatLabel />
        </FPart>

        <FPart code="E" title="Statutory Income — Business(es) and Partnership(s) Outside Malaysia Received in Malaysia">
          <div data-pdf-row="true" className="flex items-center text-[9px] font-semibold uppercase tracking-wide text-[#64748B] bg-[#F8FAFC]">
            <div className="w-9 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1">No.</div>
            <div className="flex-[2] border-r border-[#EDF1F5] px-2 py-1">Business and partnership identification</div>
            <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">Business code</div>
            <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">Country (use country code)</div>
            <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1 text-right">Amount of tax charged in the country of origin (RM)</div>
            <div className="flex-1 px-2 py-1 text-right">Statutory income (RM)</div>
          </div>
          {[
            ['E1', 'Business 1'],
            ['E2', 'Partnership 1'],
            ['E3', 'Business 2 + Partnership 2 and so forth'],
          ].map(([code, identification]) => (
            <div key={code} data-pdf-row="true" className="flex items-center text-[10px] text-[#334155]">
              <div className="w-9 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">{code}</div>
              <div className="flex-[2] border-r border-[#EDF1F5] px-2 py-1">{identification}</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="flex-1 px-2 py-1 text-right tabular-nums">—</div>
            </div>
          ))}
          <FRow code="E4" label="TOTAL (Transfer this amount to item B3)" value={fmtAmt(0)} flatLabel />
          <p className="px-2 py-2 text-[9px] italic text-[#94A3B8] leading-relaxed">
            Foreign business/partnership income isn't supported yet — feature coming in a future update.
          </p>
        </FPart>

        <FPart code="F" title="Other Statutory Income From Outside Malaysia Received in Malaysia">
          <div data-pdf-row="true" className="flex items-center text-[9px] font-semibold uppercase tracking-wide text-[#64748B] bg-[#F8FAFC]">
            <div className="w-9 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1">No.</div>
            <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">Country (use country code)</div>
            <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">Business code</div>
            <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">Type of income*</div>
            <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1 text-right">Amount of tax charged in the country of origin (RM)</div>
            <div className="flex-1 px-2 py-1 text-right">Statutory income (RM)</div>
          </div>
          {['F1', 'F2', 'F3'].map((code) => (
            <div key={code} data-pdf-row="true" className="flex items-center text-[10px] text-[#334155]">
              <div className="w-9 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">{code}</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="flex-1 px-2 py-1 text-right tabular-nums">—</div>
            </div>
          ))}
          <FRow code="F4" label="TOTAL (Transfer this amount to item B10)" value={fmtAmt(0)} flatLabel />
          <p className="px-2 py-2 text-[9px] italic text-[#94A3B8] leading-relaxed">
            Other foreign-source income isn't supported yet — feature coming in a future update.
          </p>
        </FPart>

        <FPart code="G" title="Donations / Gifts / Contributions">
          <FRow code="G1"  label="Gift of money to the Government / State Government / local authority" value={fmtAmt(0)} flatLabel />
          <FRow code="G2a" label="Gift of money to approved institutions / organisations / funds" value={fmtAmt(0)} flatLabel />
          <FRow code="G2b" label="Gift of money for any sports activity approved by the Minister of Finance" value={fmtAmt(0)} flatLabel />
          <FRow code="G2c" label="Gift of money or cost of contribution in kind for any project of national interest approved by the Minister of Finance" value={fmtAmt(0)} flatLabel />
          <FRow code="G2d" label="Gift of money in the form of wakaf to religious authority / religious body / public university, or gift of money in the form of endowment to public university" value={fmtAmt(0)} flatLabel />
          <FRow code="G2"  label="Subtotal G2 (restricted to 10% of B11)" value={fmtAmt(0)} flatLabel />
          <FRow code="G3"  label="Gift of artefacts / manuscripts / paintings to the Government or State Government" value={fmtAmt(0)} flatLabel />
          <FRow code="G4"  label="Gift of money for the provision of library facilities or to libraries (restricted to 20,000)" value={fmtAmt(0)} flatLabel />
          <FRow code="G5"  label="Gift of money or contribution in kind for the provision of facilities in public places for the benefit of disabled persons" value={fmtAmt(0)} flatLabel />
          <FRow code="G6"  label="Gift of money / cost / value of gift of medical equipment to any healthcare facility approved by the Ministry of Health (restricted to 20,000)" value={fmtAmt(0)} flatLabel />
          <FRow code="G7"  label="Gift of paintings to the National Art Gallery or any state art gallery" value={fmtAmt(0)} flatLabel />
          <FRow code="G8"  label="Total approved donations / gifts / contributions [G1 to G7] (Transfer this amount to B17)" value={fmtAmt(fd.donationsG8)} highlight flatLabel />
        </FPart>

        <FPart code="H" title="Relief">
          <FRow code="H1" label="Individual and dependent relatives (automatic)" value={fmtAmt(fd.reliefByCode.H1 ?? 0)} flatLabel />
          <FRow code="H2i"  label="Expenses for parents — medical, dental treatment, special needs or carer" value={hv('H2i')} flatLabel />
          <FRow code="H2ii" label="Expenses for parents — complete medical examination (restricted to 1,000)" value={hv('H2ii')} flatLabel />
          <FRow code="H2" label="Subtotal H2 (restricted to 8,000)" value={hv('H2')} flatLabel />
          <FRow code="H3" label="Basic supporting equipment for disabled self, spouse, child or parent (restricted to 6,000)" value={hv('H3')} flatLabel />
          <FRow code="H4" label="Disabled individual (6,000)" value={hv('H4')} flatLabel />
          <FRow code="H5i"   label="Education fees — other than degree at masters/doctorate level" value={hv('H5i')} flatLabel />
          <FRow code="H5ii"  label="Education fees — degree at masters or doctorate level, any course" value={hv('H5ii')} flatLabel />
          <FRow code="H5iii" label="Education fees — upskilling / self-enhancement (restricted to 2,000)" value={hv('H5iii')} flatLabel />
          <FRow code="H5" label="Subtotal H5 (restricted to 7,000)" value={hv('H5')} flatLabel />
          <FRow code="H6i"   label="Medical expenses — serious diseases for self, spouse or child" value={hv('H6i')} flatLabel />
          <FRow code="H6ii"  label="Medical expenses — fertility treatment for self or spouse" value={hv('H6ii')} flatLabel />
          <FRow code="H6iii" label="Medical expenses — vaccination (restricted to 1,000)" value={hv('H6iii')} flatLabel />
          <FRow code="H6iv"  label="Medical expenses — dental examination and treatment" value={hv('H6iv')} flatLabel />
          <FRow code="H6" label="Subtotal H6 (restricted to 10,000)" value={hv('H6')} flatLabel />
          <FRow code="H7i"   label="Complete medical examination for self, spouse or child" value={hv('H7i')} flatLabel />
          <FRow code="H7ii"  label="COVID-19 detection test / self-detection test kit" value={hv('H7ii')} flatLabel />
          <FRow code="H7iii" label="Mental health examination or consultation" value={hv('H7iii')} flatLabel />
          <FRow code="H7" label="Subtotal H7 (restricted to 1,000)" value={hv('H7')} flatLabel />
          <FRow code="H8i"  label="Assessment for diagnosis of learning disability (child ≤18)" value={hv('H8i')} flatLabel />
          <FRow code="H8ii" label="Early intervention / rehabilitation for learning disability" value={hv('H8ii')} flatLabel />
          <FRow code="H8" label="Subtotal H8 (restricted to 4,000)" value={hv('H8')} flatLabel />
          <FRow code="H9" label="Lifestyle — books, PC/smartphone/tablet, internet, upskilling courses (restricted to 2,500)" value={hv('H9')} flatLabel />
          <FRow code="H10" label="Lifestyle — additional relief for sports equipment/facilities/competitions/gym (restricted to 1,000)" value={hv('H10')} flatLabel />
          <FRow code="H11" label="Breastfeeding equipment, child ≤2 years, once per 2 YAs (restricted to 1,000)" value={hv('H11')} flatLabel />
          <FRow code="H12" label="Child care fees — registered centre/kindergarten, child ≤6 (restricted to 3,000)" value={hv('H12')} flatLabel />
          <FRow code="H13" label="Net SSPN deposit (restricted to 8,000)" value={hv('H13')} flatLabel />
          <FRow code="H14" label="Husband / wife / alimony to former wife (restricted to 4,000)" value={hv('H14')} flatLabel />
          <FRow code="H15" label="Disabled husband / wife (5,000)" value={hv('H15')} flatLabel />
          <FRow code="H16a" label="Child — under 18 years (2,000 each)" value={hv('H16a')} flatLabel />
          <FRow code="H16b" label="Child — 18+ and studying (2,000 / 8,000 tiered)" value={hv('H16b')} flatLabel />
          <FRow code="H16c" label="Child — disabled (6,000 / 14,000 tiered)" value={hv('H16c')} flatLabel />
          {fd.reliefByCode.H16 != null && (
            <FRow label="⚠ Child-relief documents on file, not yet split into H16a/b/c (see Data Coverage)" value={hv('H16')} flatLabel />
          )}
          <FRow code="H17i"  label="Life insurance premium / EPF voluntary contribution (restricted to 3,000)" value={hv('H17i')} flatLabel />
          <FRow code="H17ii" label="EPF (voluntary or compulsory) / approved scheme (restricted to 4,000)" value={hv('H17ii')} flatLabel />
          <FRow code="H17" label="Subtotal H17 (restricted to 7,000)" value={fmtAmt((fd.reliefByCode.H17i || 0) + (fd.reliefByCode.H17ii || 0))} flatLabel />
          <FRow code="H18" label="Private retirement scheme and deferred annuity (restricted to 3,000)" value={hv('H18')} flatLabel />
          <FRow code="H19" label="Education and medical insurance (restricted to 3,000)" value={hv('H19')} flatLabel />
          <FRow code="H20" label="SOCSO / EIS contribution (restricted to 350)" value={hv('H20')} flatLabel />
          <FRow code="H21" label="EV charging equipment/installation, not for business use (restricted to 2,500)" value={hv('H21')} flatLabel />
          <FRow code="H22" label="TOTAL RELIEF [H1 to H21] (transfer to B23)" value={fmtAmt(fd.reliefTotal)} highlight flatLabel />
        </FPart>

        <FPart code="J" title="Incentive Claim">
          <IncentiveClaimTable
            code="J1"
            title="Claim Special Deduction(s) / Further Deduction(s) / Double Deduction(s) / Incentive(s) under paragraph 127(3)(b) of Income Tax Act 1967"
            firstColLabel="Claim Code"
          />
          <IncentiveClaimTable
            code="J2"
            title="Claim for incentive(s) under subsection 127(3A) of Income Tax Act 1967"
            firstColLabel="Incentive Approval No."
          />
          <p className="px-2 py-2 text-[9px] italic text-[#94A3B8] leading-relaxed">
            Incentive claims aren't supported yet — feature coming in a future update.
          </p>
        </FPart>

        <FPart code="K" title="Non-Employment Income of Preceding Years Not Declared">
          <div data-pdf-row="true" className="items-center grid grid-cols-[36px_repeat(3,minmax(0,1fr))] text-[9px] font-semibold uppercase tracking-wide text-[#64748B] bg-[#F8FAFC]">
            <div className="col-span-2 border-r border-[#EDF1F5] px-2 py-1">Type of Income</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">Year of Assessment</div>
            <div className="px-2 py-1">Amount (RM)</div>
          </div>
          {['K1', 'K2'].map((code) => (
            <div key={code} data-pdf-row="true" className="items-center grid grid-cols-[36px_repeat(3,minmax(0,1fr))] text-[10px] text-[#334155]">
              <div className="border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">{code}</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="px-2 py-1 text-right tabular-nums">—</div>
            </div>
          ))}
          <p className="px-2 py-2 text-[9px] italic text-[#94A3B8] leading-relaxed">
            Non-employment income declarations aren't supported yet — feature coming in a future update.
          </p>
        </FPart>

        <FPart code="L" title="Tax Exempt Income From Sources Outside Malaysia Received in Malaysia">
          <div data-pdf-row="true" className="items-center grid grid-cols-[36px_repeat(7,minmax(0,1fr))] text-[9px] font-semibold uppercase tracking-wide text-[#64748B] bg-[#F8FAFC]">
            <div className="border-r border-[#EDF1F5] px-1.5 py-1">No.</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">Country (use country code)</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">Type of income*</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">Tax paid in the country of origin</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">Headline tax rate in the country of origin (%)</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">Comply with the economic substance requirements</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right">Amount of tax charged in the country of origin (RM)</div>
            <div className="px-2 py-1 text-right">Amount of income remitted (RM)</div>
          </div>
          {['L1', 'L2', 'L3', 'L4'].map((code) => (
            <div key={code} data-pdf-row="true" className="items-center grid grid-cols-[36px_repeat(7,minmax(0,1fr))] text-[10px] text-[#334155]">
              <div className="border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">{code}</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="px-2 py-1 text-right tabular-nums">—</div>
            </div>
          ))}
          <div data-pdf-row="true" className="items-center grid grid-cols-[36px_repeat(7,minmax(0,1fr))] text-[10px] text-[#334155]">
            <div className="border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">L5</div>
            <div className="col-span-6 border-r border-[#EDF1F5] px-2 py-1">TOTAL</div>
            <div className="px-2 py-1 text-right tabular-nums">{fmtAmt(0)}</div>
          </div>
          <p className="px-2 py-2 text-[9px] italic text-[#94A3B8] leading-relaxed">
            Tax-exempt foreign-source income isn't supported yet — feature coming in a future update.
          </p>
        </FPart>

        <FPart code="M" title="Particulars of Business Income (Losses)">
          <div data-pdf-row="true" className="flex items-center text-[10px] text-[#334155]">
            <div className="w-9 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">M1</div>
            <div className="flex-1 px-2 py-1">
              Summary of business and partnership losses subject to loss restriction
            </div>
          </div>

          <div data-pdf-row="true" className="bg-[#F1F5F9] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#475569]">
            Losses of Current Year of Assessment
          </div>
          <div data-pdf-row="true" className="items-center grid grid-cols-4 text-[9px] font-semibold text-[#64748B] bg-[#F8FAFC]">
            <div className="border-r border-[#EDF1F5] px-2 py-1">(a) Current year of assessment business and partnership losses</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(b) Amount absorbed from tax exempt income of pioneer business</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(c) Amount absorbed in the current year of assessment</div>
            <div className="px-2 py-1">(d) Balance carried forward (d = a − b − c)</div>
          </div>
          <div data-pdf-row="true" className="items-center grid grid-cols-4 text-[10px] text-[#334155]">
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
            <div className="px-2 py-1 text-right tabular-nums">—</div>
          </div>

          <div data-pdf-row="true" className="bg-[#F1F5F9] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#475569]">
            Losses of Prior Years of Assessment
          </div>
          <div data-pdf-row="true" className="items-center grid grid-cols-[minmax(90px,1.2fr)_repeat(8,minmax(0,1fr))] text-[9px] font-semibold text-[#64748B] bg-[#F8FAFC]">
            <div className="border-r border-[#EDF1F5] px-2 py-1">Year of assessment in which losses are incurred</div>
            <div className="col-span-4 border-r border-[#EDF1F5] px-2 py-1 text-center">Unabsorbed losses position at the beginning of the current year of assessment</div>
            <div className="col-span-3 border-r border-[#EDF1F5] px-2 py-1 text-center">Losses absorbed / Disregarded in the current year of assessment</div>
            <div className="px-2 py-1" />
          </div>
          <div data-pdf-row="true" className="items-center grid grid-cols-[minmax(90px,1.2fr)_repeat(8,minmax(0,1fr))] text-[9px] font-semibold text-[#64748B] bg-[#F8FAFC]">
            <div className="border-r border-[#EDF1F5] px-2 py-1" />
            <div className="border-r border-[#EDF1F5] px-2 py-1">(e) Original amount of losses in the YA first incurred</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(f) Amount absorbed from tax exempt income of pioneer business</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(g) Amount absorbed (accumulated)</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(h) Balance unabsorbed (h = e − f − g)</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(j) Amount disregarded under s.44(5F)</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(k) Amount disregarded under s.25(5) PIA 1986</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(m) Amount absorbed</div>
            <div className="px-2 py-1">(n) Balance carried forward (n = h − j − k − m)</div>
          </div>
          {(() => {
            // Always the 5 YAs immediately before the current filing year,
            // plus an "and before" catch-all for the 6th (oldest) row — so
            // this stays correct as filingYear rolls forward each year
            // rather than drifting out of date like a hardcoded list would.
            const oldestCutoff = filingYear - 6;
            const priorYears = [
              `${oldestCutoff} and before`,
              ...Array.from({ length: 5 }, (_, i) => String(oldestCutoff + 1 + i)),
            ];
            return priorYears.map((yr) => (
            <div key={yr} data-pdf-row="true" className="items-center grid grid-cols-[minmax(90px,1.2fr)_repeat(8,minmax(0,1fr))] text-[10px] text-[#334155]">
              <div className="border-r border-[#EDF1F5] px-2 py-1 text-[#94A3B8] font-medium">{yr}</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="px-2 py-1 text-right tabular-nums">—</div>
            </div>
            ));
          })()}

          <FRow code="M2" label="Business capital allowances carried forward" value={fmtAmt(0)} />
          <FRow code="M3" label="Partnership capital allowances carried forward" value={fmtAmt(0)} />
          <p className="px-2 py-2 text-[9px] italic text-[#94A3B8] leading-relaxed">
            Business-loss carry-forward tracking isn't supported yet — feature coming in a future update.
          </p>
        </FPart>

        <FPart code="N" title={`Financial Particulars of Individual (Main Business Only)${fd.entityCount > 1 ? ` — combined across ${fd.entityCount} entities` : ''}`}>
          <FRow code="N1" label="Name of business" value={fd.businessName} flatLabel />
          <FRow code="N1a" label="Registration no." value={fd.businessRegNo} flatLabel />
          <FRow code="N2" label="Business code" value={fd.businessCode} flatLabel />
          <FRow code="N2a" label="Type of business activity" value={fd.businessActivity} flatLabel />

          <div className="bg-[#F1F5F9] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#475569]">Statement of Profit or Loss</div>
          <FRow code="N3"  label="Sales or turnover" value={fmtAmt(fd.n3)} flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Less:</div>
          <FRow code="N4"  label="Opening inventory" value="—" flatLabel />
          <FRow code="N5"  label="Purchases and cost of production" value={fmtAmt(fd.n5)} flatLabel />
          <FRow code="N6"  label="Closing inventory" value="—" flatLabel />
          <FRow code="N7"  label="Cost of sales (N4 + N5 − N6)" value={fmtAmt(fd.n7)} flatLabel />
          <FRow code="N8"  label="GROSS PROFIT / LOSS (N3 − N7)" value={fmtAmt(fd.n8)} strong flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Other income:</div>
          <FRow code="N9"  label="Other business(es)" value="—" flatLabel />
          <FRow code="N10" label="Dividends" value="—" flatLabel />
          <FRow code="N11" label="Interest and discounts" value={fmtAmt(fd.n11)} flatLabel />
          <FRow code="N12" label="Rents, royalties and premiums" value="—" flatLabel />
          <FRow code="N13" label="Other income" value={fmtAmt(fd.n13)} flatLabel />
          <FRow code="N14" label="TOTAL (N9 to N13)" value={fmtAmt(fd.n14)} strong flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Expenses:</div>
          <FRow code="N15" label="Loan interest" value={fmtAmt(fd.n15)} flatLabel />
          <FRow code="N16" label="Salaries and wages" value={fmtAmt(fd.n16)} flatLabel />
          <FRow code="N17" label="Rental / lease" value={fmtAmt(fd.n17)} flatLabel />
          <FRow code="N18" label="Contract and subcontracts" value="—" flatLabel />
          <FRow code="N19" label="Commissions" value={fmtAmt(fd.n19)} flatLabel />
          <FRow code="N20" label="Bad debts" value="—" flatLabel />
          <FRow code="N21" label="Travelling and transport" value={fmtAmt(fd.n21)} flatLabel />
          <FRow code="N22" label="Repairs and maintenance" value={fmtAmt(fd.n22)} flatLabel />
          <FRow code="N23" label="Promotion and advertisement" value={fmtAmt(fd.n23)} flatLabel />
          <FRow code="N24" label="Other expenses" value={fmtAmt(fd.n24)} flatLabel />
          <FRow code="N25" label="TOTAL EXPENDITURE (N15 to N24)" value={fmtAmt(fd.n25)} strong flatLabel />
          <FRow code="N26" label="NET PROFIT / LOSS" value={fmtAmt(fd.n26)} highlight flatLabel />
          <FRow code="N27" label="Non-allowable expenses (apportioned/disallowed portion)" value={fmtAmt(fd.n27)} flatLabel />
          <FRow label="LESS: Capital allowance (Schedule 3, current-year IA+AA)" value={fmtAmt(fd.capitalAllowance)} flatLabel />

          <div className="bg-[#F1F5F9] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#475569]">Statement of Financial Position</div>
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Non-current assets:</div>
          <FRow code="N28" label="Land and buildings" value="—" flatLabel />
          <FRow code="N29" label="Plant and machinery" value="—" flatLabel />
          <FRow code="N30" label="Motor vehicles" value="—" flatLabel />
          <FRow code="N31" label="Other non-current assets" value="—" flatLabel />
          <FRow code="N32" label="TOTAL NON-CURRENT ASSETS (N28 to N31)" value="—" strong flatLabel />
          <FRow code="N33" label="Investments" value="—" flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Current assets:</div>
          <FRow code="N34" label="Inventory" value="—" flatLabel />
          <FRow code="N35" label="Trade debtors" value="—" flatLabel />
          <FRow code="N36" label="Sundry debtors" value="—" flatLabel />
          <FRow code="N37" label="Cash in hand" value="—" flatLabel />
          <FRow code="N38" label="Cash at bank" value="—" flatLabel />
          <FRow code="N39" label="Other current assets" value="—" flatLabel />
          <FRow code="N40" label="TOTAL CURRENT ASSETS (N34 to N39)" value="—" strong flatLabel />
          <FRow code="N41" label="TOTAL ASSETS (N32 + N33 + N40)" value="—" highlight flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Liabilities:</div>
          <FRow code="N42" label="Loans and overdrafts" value="—" flatLabel />
          <FRow code="N43" label="Trade creditors" value="—" flatLabel />
          <FRow code="N44" label="Sundry creditors" value="—" flatLabel />
          <FRow code="N45" label="TOTAL LIABILITIES (N42 to N44)" value="—" strong flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Owner's equity:</div>
          <FRow code="N46" label="Capital account" value="—" flatLabel />
          <FRow code="N47" label="Current account balance brought forward" value="—" flatLabel />
          <FRow code="N48" label="Current year profit / loss" value="—" flatLabel />
          <FRow code="N49" label="Drawings / advance (Net)" value="—" flatLabel />
          <FRow code="N50" label="Current account balance carried forward" value="—" strong flatLabel />
          <p className="px-2 py-2 text-[9px] italic text-[#94A3B8] leading-relaxed">
            Balance sheet not yet populated — pending structured Balance Sheet
            document extraction on the backend.
          </p>
        </FPart>

        <div data-pdf-row="true" className="mt-3 border border-[#CBD5E1]">
          <div className="bg-[#E2E8F0] px-2 py-1 text-[10px] font-bold uppercase tracking-wide">Declaration</div>
          <p className="px-2 py-2 text-[9px] leading-relaxed text-[#475569]">
            I, <span className="font-semibold text-[#0F172A]">{fd.name}</span> (Identification no. {fd.idNo}), hereby declare that the information regarding the income and claim for deductions and reliefs given by me in this return form and in any document attached is true, correct and complete.
          </p>
        </div>

        {!embedded && (
          <p data-pdf-row="true" className="mt-3 text-[8px] text-[#94A3B8] text-center leading-relaxed">
            cukai.ai draft — for your own reference only, not an LHDN submission. Figures are drawn from your uploaded and classified documents, your capital allowance schedule, and your personal profile. Some sections (Parts E, F, J, K, L, M, and the balance sheet) are not yet populated — see the Data Coverage panel in the app for details. Verify every value and file the real return at mytax.hasil.gov.my.
          </p>
        )}
      </div>
    </div>
  );
};

// ─── Preview slide-over ────────────────────────────────────────────────────
// Mirrors CukaiAccount's DocumentPreview slide-over: a real PDF blob shown via
// <embed>, so the browser's own PDF viewer chrome is what the user sees — no
// custom zoom controls, and (since this isn't the browser print dialog) none
// of the print stylesheet's date/title/URL headers either.
function FormBPreview({ pdfUrl, filingYear, onClose }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
  const handleClose = () => { setVisible(false); setTimeout(onClose, 300); };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={handleClose}>
      <div className={`flex-1 bg-black/40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />

      <div
        className={`relative flex h-full w-[720px] max-w-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3 bg-slate-50 shrink-0">
          <div>
            <p className="text-sm font-bold text-headings">Form B Preview — YA {filingYear}</p>
            <p className="text-[10px] text-muted mt-0.5">Pre-filled draft. Verify all values before submitting to LHDN.</p>
          </div>
          {/* No custom Download button — the embedded PDF viewer (the
              <embed> below) has its own built-in download control. Its
              suggested viewer title comes from the PDF's own /Title
              metadata, set via pdf.setProperties() in renderNodeToPdfBlob. */}
          <button onClick={handleClose} className="text-[#94A3B8] hover:text-headings transition-colors p-1.5 rounded-md hover:bg-slate-100 ml-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-[#E8EBEF]">
          {pdfUrl ? (
            <embed src={pdfUrl} type="application/pdf" className="w-full h-full" title={`Form B Draft YA ${filingYear}`} />
          ) : (
            <div className="flex h-full items-center justify-center flex-col gap-3 p-8 text-center">
              <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              <p className="text-xs text-muted">Rendering your draft…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Compact on-screen summary primitives ────────────────────────────────────
// SRow (the old flat-list row primitive) was removed here — the Generate
// Forms tab now renders the full FormBDocument body directly instead of a
// simplified SRow summary, so InlineSummary is only used for the
// non-form supplementary panels below the form (reconciliation, data gaps).
function InlineSummary({ title, children }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">{title}</p>
      <div className="rounded-lg border border-[#F1F5F9] divide-y divide-[#F1F5F9] overflow-hidden">{children}</div>
    </div>
  );
}

// ─── Data Coverage panel — surfaces fd.dataGaps so gaps are visible to
// whoever's reviewing the draft, not just buried in formB.js comments.
const GAP_SEVERITY_STYLE = {
  blocking:       { label: 'Blocking',      color: 'text-critical bg-critical-bg border-critical/30' },
  gap:            { label: 'Gap',           color: 'text-warning bg-warning-bg border-warning/30' },
  warning:        { label: 'Check',         color: 'text-warning bg-warning-bg border-warning/30' },
  info:           { label: 'Info',          color: 'text-muted bg-slate-50 border-border' },
  'out-of-scope-v1': { label: 'Out of scope (v1)', color: 'text-muted bg-slate-50 border-border' },
};
function DataCoveragePanel({ dataGaps }) {
  if (!dataGaps || dataGaps.length === 0) return null;
  return (
    <InlineSummary title={`Data Coverage — ${dataGaps.length} item${dataGaps.length === 1 ? '' : 's'} to review`}>
      <div className="divide-y divide-[#F1F5F9]">
        {dataGaps.map((g, i) => {
          const style = GAP_SEVERITY_STYLE[g.severity] || GAP_SEVERITY_STYLE.info;
          return (
            <div key={i} className="flex items-start gap-2 px-3 py-2">
              <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${style.color}`}>
                {style.label}
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-headings">{g.part}</p>
                <p className="text-[10px] text-muted mt-0.5 leading-relaxed">{g.note}</p>
              </div>
            </div>
          );
        })}
      </div>
    </InlineSummary>
  );
}

// ─── Generate Forms panel (the tab body) ──────────────────────────────────────
// `taxSummary` is the raw response of GET /api/profile/summary for the active
// entity + filing year (fetched by ManageAccount.jsx). `taxSummaryLoading`
// distinguishes "still fetching" from "loaded, but genuinely no documents yet"
// so the panel doesn't flash a misleading all-zero draft while data is in flight.
const GenerateFormsPanel = ({ profile, entities, taxSummary, taxSummaryLoading }) => {
  const [showPreview, setShowPreview] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(null); // which button triggered generation: 'preview' | 'export' | null
  const pdfSourceRef = useRef(null);
  const filingYear = currentFilingYear();
  // "Form B Draft - YA2026.pdf" — used everywhere a filename is needed, so
  // it's never left to default to a random blob id (see generatePdfBlob).
  const pdfFileName = `Form B Draft - YA${filingYear}.pdf`;
  const owned = entities || [];
  const fd = buildFormData(profile || BLANK_PERSONAL_PROFILE, owned, taxSummary);
  const { entityCount, dataGaps } = fd;

  // Revoke the previous blob URL whenever we make a new one / unmount, so we
  // don't leak object URLs across repeated Preview/Export clicks.
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const generatePdfBlob = async () => {
    if (!pdfSourceRef.current) return null;
    const blob = await renderNodeToPdfBlob(pdfSourceRef.current, filingYear);
    if (!blob) return null;
    // Wrap in a named File (File extends Blob) rather than a bare Blob —
    // when this backs an object URL, Chrome/Edge's built-in PDF viewer uses
    // the File's name as the suggested filename for its own download
    // button. A bare Blob has no name, which is why that button (and the
    // Preview embed generally) was suggesting a random-looking string (the
    // blob's own internal id) instead.
    return new File([blob], pdfFileName, { type: 'application/pdf' });
  };

  // Preview opens the slide-over immediately (with a spinner) and streams the
  // rendered PDF into it once ready — it does not download anything.
  const handlePreview = async () => {
    setShowPreview(true);
    setPdfBusy('preview');
    const file = await generatePdfBlob();
    if (file) {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(file));
    }
    setPdfBusy(null);
  };

  // Export downloads straight away — it never opens the preview panel.
  const handleExport = async () => {
    setPdfBusy('export');
    const file = await generatePdfBlob();
    if (file) {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
    setPdfBusy(null);
  };

  if (owned.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="max-w-sm text-center px-6">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-tint border border-slate-100 text-primary">
            <BuildingIcon />
          </div>
          <p className="text-sm font-bold text-headings">No business entities yet</p>
          <p className="text-[11px] text-muted mt-1 leading-relaxed">
            Your Form B draft is built from the entities you own. Add a business under <span className="font-semibold">Manage Entities</span> to generate the return.
          </p>
        </div>
      </div>
    );
  }

  if (taxSummaryLoading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <p className="text-xs text-muted">Loading your tax profile…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      {/* Off-screen full-masthead render source for PDF generation. Kept
          permanently mounted (not conditionally, so its layout is always
          measurable) but shifted off-canvas — html2canvas needs a real,
          laid-out DOM node to capture, not just JSX we could pass around. */}
      <div style={{ position: 'fixed', top: 0, left: -99999, width: PDF_SOURCE_WIDTH_PX, zIndex: -1 }} aria-hidden="true">
        <div ref={pdfSourceRef} style={{ background: '#ffffff' }}>
          <FormBDocument fd={fd} filingYear={filingYear} />
        </div>
      </div>

      {showPreview && (
        <FormBPreview
          pdfUrl={pdfUrl}
          filingYear={filingYear}
          onClose={() => { setShowPreview(false); if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); } }}
        />
      )}

      {/* Full form — identical layout to the Preview modal, minus the
          cukai.ai masthead/draft-banner/footer (embedded=true). This is the
          real Part-by-Part draft, not a simplified summary, so what the user
          reviews here is exactly what they'll see (and download) in Preview.
          Title/description/actions now live inside the card as a section
          title, styled like the Data Coverage / reconciliation sections
          below it, rather than as a separate page header above the card. */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="px-5 pt-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#94A3B8]">
                Form B — Personal Return YA {filingYear}
              </p>
              <p className="text-[10px] text-muted mt-0.5">
                {entityCount > 1
                  ? `Combined across ${entityCount} entities · Main business: ${fd.businessName}`
                  : `Based on ${fd.businessName}`} · Draft only — not an LHDN submission
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handlePreview}
                disabled={pdfBusy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-tint transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
                {pdfBusy === 'preview' ? 'Rendering…' : 'Preview'}
              </button>
              <button
                onClick={handleExport}
                disabled={pdfBusy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                {pdfBusy === 'export' ? 'Preparing…' : 'Export PDF'}
              </button>
            </div>
          </div>

          <div className="px-5 py-4">
            <FormBDocument fd={fd} filingYear={filingYear} embedded />
          </div>

          <div className="px-5 pb-4 space-y-4">
            {fd.reconciliation && fd.reconciliation.length > 0 && (
              <InlineSummary title="Reference document cross-check">
                {fd.reconciliation.map((r, i) => (
                  <div key={i} className="px-3 py-2">
                    <p className={`text-[10px] font-semibold ${r.flagged ? 'text-warning' : 'text-success'}`}>{r.fileName}</p>
                    <p className="text-[10px] text-muted mt-0.5 leading-relaxed">{r.note}</p>
                  </div>
                ))}
              </InlineSummary>
            )}

            <DataCoveragePanel dataGaps={dataGaps} />

            <p className="text-[10px] text-[#94A3B8] leading-relaxed">
              Figures marked "auto" or from Part B/N are computed from your classified documents, capital allowance schedule, and prior filings. Figures marked "estimated" come from your personal profile toggles rather than uploaded documents — confirm before filing. Open <span className="font-semibold">Preview</span> to see and download the full draft.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

/* =========================================================================
   MAIN COMPONENT
   ========================================================================= */

export default function ManageProfile({ initialProfile, initialEntities, activeEntityId, onSavePersonal, onCreateEntity, onSaveEntity, onDeleteEntity, onSwitchEntity, taxSummary, taxSummaryLoading }) {
  // Use initialProfile if available, otherwise fall back to your static BLANK_PERSONAL_PROFILE structure
  const [personalProfile, setPersonalProfile] = useState(initialProfile || BLANK_PERSONAL_PROFILE);
  const [entities, setEntities] = useState(initialEntities || []);

  // Watch for when the data finishes downloading from ManageAccount.jsx
  React.useEffect(() => {
    if (initialProfile) {
      setPersonalProfile(initialProfile);
    }
  }, [initialProfile]);

  React.useEffect(() => {
    if (initialEntities && initialEntities.length > 0) {
      setEntities(initialEntities);
      setActiveIndex(resolveActiveIndex(initialEntities, activeEntityId));
    }
  }, [initialEntities, activeEntityId]);

  // Derive activeIndex from the persisted activeEntityId prop
  const resolveActiveIndex = (entities, id) => {
    if (!id || !entities || entities.length === 0) return 0;
    const idx = entities.findIndex((e) => e.id === id);
    return idx >= 0 ? idx : 0;
  };
  const [activeIndex, setActiveIndex] = useState(() => resolveActiveIndex(initialEntities, activeEntityId));
  const [previewIndex, setPreviewIndex] = useState(null);
  const [showPersonalPanel, setShowPersonalPanel] = useState(false);
  const [newEntityDraft, setNewEntityDraft] = useState(null);
 const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState(requestedTab === 'forms' ? 'forms' : 'entities');
  // Add these two states right below them to track network status:
  const [error, setError] = useState(null);

  // Error toast for entity actions (e.g. duplicate business name/SSM no.).
  // Separate from the page-level `error` above, which replaces the whole
  // view — this is a dismissible strip that layers over the create/edit panel.
  const [entityToast, setEntityToast] = useState(null);
  const showEntityToast = (message) => {
    setEntityToast(message);
    setTimeout(() => setEntityToast(null), 6000);
  };

  // Case-/whitespace-insensitive check against the entities already on this
  // profile, mirroring the backend's own duplicate check — lets us reject an
  // obvious duplicate instantly, before round-tripping to the server.
  // `excludeId` skips the entity being edited when checking edits.
  const findDuplicateEntity = (draft, excludeId) => {
    const name = (draft.name || '').trim().toLowerCase();
    const ssm = (draft.ssmNo || '').trim().toLowerCase();
    if (!name && !ssm) return null;
    return entities.find((e) => {
      if (excludeId && e.id === excludeId) return false;
      const eName = (e.name || '').trim().toLowerCase();
      const eSsm = (e.ssmNo || '').trim().toLowerCase();
      return (!!name && name === eName) || (!!ssm && ssm === eSsm);
    }) || null;
  };

  const handleSwitch = (index) => {
    setActiveIndex(index);
    const entity = entities[index];
    if (entity && entity.id && onSwitchEntity) {
      onSwitchEntity(entity.id);
    }
  };

  const handleSaveEdit = async (updatedEntity) => {
    const dupe = findDuplicateEntity(updatedEntity, updatedEntity.id);
    if (dupe) {
      showEntityToast(`Business already created — "${dupe.name || dupe.ssmNo}" is already on your profile.`);
      return;
    }
    if (onSaveEntity && updatedEntity.id) {
      const ok = await onSaveEntity(updatedEntity);
      if (!ok) {
        alert('Could not save entity changes. Please try again.');
        return;
      }
    }
    const next = [...entities];
    next[previewIndex] = updatedEntity;
    setEntities(next);
    setPreviewIndex(null);
  };

  const handleDelete = async () => {
    const entityToDelete = entities[previewIndex];

    if (onDeleteEntity && entityToDelete?.id) {
      const ok = await onDeleteEntity(entityToDelete.id);
      if (!ok) {
        alert('Could not delete entity. Please try again.');
        return;
      }
    }

    const next = entities.filter((_, i) => i !== previewIndex);
    setEntities(next);
    if (activeIndex === previewIndex) {
      setActiveIndex(0);
    } else if (activeIndex > previewIndex) {
      setActiveIndex(activeIndex - 1);
    }
    setPreviewIndex(null);
  };

  const handleCreateEntity = async (draft) => {
    // Instant local check first — catches the common case without a round trip.
    const dupe = findDuplicateEntity(draft);
    if (dupe) {
      showEntityToast(`Business already created — "${dupe.name || dupe.ssmNo}" is already on your profile.`);
      return false; // keep the create panel open so the user can fix it
    }

    if (onCreateEntity) {
      const created = await onCreateEntity(draft);
      if (!created) {
        alert('Could not create entity. Please try again.');
        return false; // keep the create panel open so the user can retry
      }
      if (created.error) {
        // Backend caught a duplicate our local check missed (e.g. a race with
        // another tab/session) — surface its exact message instead of a
        // generic failure.
        showEntityToast(created.error);
        return false;
      }
      // Use the server-returned entity (with its real id)
      setEntities((prev) => [...prev, created]);
      const newIndex = entities.length; // index before appending
      setActiveIndex(newIndex);
      if (created.id && onSwitchEntity) onSwitchEntity(created.id);
    } else {
      // Fallback: local-only (no backend wired)
      setEntities((prev) => [...prev, draft]);
      setActiveIndex(entities.length);
    }
    // The create panel is closed by its own onSave handler on success.
    return true;
  };

  const handleSavePersonal = async (updatedData) => {
    if (!onSavePersonal) {
      // No save handler wired up — just close the panel optimistically
      setPersonalProfile(updatedData);
      setShowPersonalPanel(false);
      return;
    }
    const success = await onSavePersonal(updatedData);
    if (success) {
      setPersonalProfile(updatedData);
      setShowPersonalPanel(false);
    } else {
      alert('Something went wrong saving your changes. Please try again.');
    }
  };


  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-600 rounded-xl text-xs border border-red-100 m-6">
        ⚠️ {error}
      </div>
    );
  }
  
  return (
    <div className="h-full flex flex-col gap-3">

      {/* Duplicate-entity error toast — sits above the create/edit panel */}
      {entityToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-xl border border-critical/30 bg-critical-bg px-5 py-3 shadow-xl">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-critical shrink-0">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-[11px] font-semibold text-critical">{entityToast}</p>
          <button onClick={() => setEntityToast(null)} className="text-critical/60 hover:text-critical ml-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Personal profile — fixed, account-level */}
      <div className="shrink-0">
        <PersonalProfileSummary profile={personalProfile} onOpen={() => setShowPersonalPanel(true)} />
      </div>

      <ProfileTabNav active={tab} onChange={setTab} />

      {/* Business profiles — tabbed: Manage Entities / Generate Forms */}
      {tab === 'entities' && (
      <div className="flex-1 min-h-0 flex flex-col gap-2">
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-headings">Business Profiles</h2>
            <p className="text-[12px] text-muted mt-0.5">Maintain the registered details LHDN requires for each entity you file on behalf of.</p>
          </div>
          <button
            onClick={() => setNewEntityDraft({ ...BLANK_SOLE_PROP })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover transition-colors duration-150 shrink-0"
          >
            <PlusIcon />Create New Entity
          </button>
        </div>

        {/* Scrollable card grid — only internal zone that scrolls */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
          <div className="grid grid-cols-3 gap-3 auto-rows-fr pb-1">
            {entities.map((entity, index) => (
              <EntityCard
                key={entity.id || index}
                entity={entity}
                active={activeIndex === index}
                onSwitch={() => handleSwitch(index)}
                onOpenPreview={() => setPreviewIndex(index)}
                personalTin={personalProfile.personalTin}
              />
            ))}
          </div>
        </div>
      </div>
      )}

      {tab === 'forms' && (
        <GenerateFormsPanel
          profile={personalProfile}
          entities={entities}
          taxSummary={taxSummary}
          taxSummaryLoading={taxSummaryLoading}
        />
      )}

      {showPersonalPanel && (
        <PersonalProfilePanel
          profile={personalProfile}
          onClose={() => setShowPersonalPanel(false)}
          onSave={handleSavePersonal}
        />
      )}

      {previewIndex !== null && (
        <EntityPreviewPanel
          entity={entities[previewIndex]}
          active={activeIndex === previewIndex}
          isOnlyEntity={entities.length === 1}
          onClose={() => setPreviewIndex(null)}
          onSave={handleSaveEdit}
          onSwitch={() => { handleSwitch(previewIndex); setPreviewIndex(null); }}
          onDelete={handleDelete}
        />
      )}

      {newEntityDraft !== null && (
        <EntityPreviewPanel
          entity={newEntityDraft}
          active={false}
          isOnlyEntity={false}
          isNew={true}
          onClose={() => setNewEntityDraft(null)}
          onSave={async (draft) => { const ok = await handleCreateEntity(draft); if (ok) setNewEntityDraft(null); }}
          onSwitch={() => {}}
          onDelete={() => setNewEntityDraft(null)}
        />
      )}
    </div>
  );
}