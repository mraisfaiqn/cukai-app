import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import cukaiLogo from '../../assets/cukai-logo.png';
import { currentFilingYear, buildFormData, fmtAmt } from '../../data/formB';
import { getOpeningBalanceSuggestion, runInsightEngine } from '../../services/api';

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

  // Hide every in-app editing aid (provenance dots, review dots, the
  // legend, and the clickable Review badges) for the duration of the
  // capture — these help the person get the numbers right while editing,
  // but aren't part of the actual filed document, so they must not appear
  // in the downloaded PDF. Measuring row rects and calling html2canvas both
  // happen AFTER this so the measured positions reflect what's actually
  // rasterized (hiding the legend, in particular, shifts row positions —
  // measuring before hiding would produce stale offsets). Restored in a
  // finally block so a failed capture never leaves these permanently
  // hidden in the live, on-screen editing view.
  const annotationEls = Array.from(node.querySelectorAll('[data-form-annotation]'));
  const prevAnnotationDisplays = annotationEls.map((el) => el.style.display);
  annotationEls.forEach((el) => { el.style.display = 'none'; });

  let containerRect, rowRectsCss, canvas;
  try {
    // Measure atomic row rects (in unscaled CSS px, relative to the node) before
    // rasterizing — html2canvas gives us pixels, not the DOM, so this is our
    // only chance to know where a "row" begins and ends.
    containerRect = node.getBoundingClientRect();
    rowRectsCss = Array.from(node.querySelectorAll('[data-pdf-row]')).map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top - containerRect.top, bottom: r.bottom - containerRect.top };
    });

    canvas = await html2canvas(node, {
      scale: PDF_RENDER_SCALE,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: PDF_SOURCE_WIDTH_PX,
    });
  } finally {
    annotationEls.forEach((el, i) => { el.style.display = prevAnnotationDisplays[i]; });
  }

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
  // Opening carry-forward balances (Phase 3) — seed for the multi-year
  // business-loss (B5/M1) and capital-allowance (M2) engine.
  openingUnabsorbedBusinessLossMyr: '',
  openingUnabsorbedCapitalAllowanceMyr: '',
  openingBalanceYear: '',
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
  isDisabledSelf: false,
  spouseIsDisabled: false,
  alimonyPaidMyr: '',
  spouseTotalIncomeMyr: '',
  spouseForeignIncomeMyr: '',
  passportNoLhdnm: '',
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

/* =========================================================================
   PERSONAL INFORMATION COMPLETENESS
   Mirrors backend/profile_completeness.py — KEEP THE TWO IN SYNC. The backend
   copy drives the `profile_incomplete` AI insight; this copy drives the Edit
   Profile modal's gaps-only mode, so the modal can filter itself without
   depending on the insight feed being loaded.

   buildFormData() reads these fields for Form B's header/refund lines and
   renders "—" for each blank one, which is why an incomplete profile silently
   produces an unfilable form. Several are only required in context — see the
   conditionals below.
   ========================================================================= */

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

const ALWAYS_REQUIRED_KEYS = [
  'fullName', 'personalTin', 'citizenship', 'gender', 'dateOfBirth',
  'maritalStatus', 'phone', 'correspondenceAddress', 'correspondencePostcode',
  'correspondenceCity', 'correspondenceState', 'refundMethod',
];

/** Required-but-blank profile field keys. Empty ⇒ Form B has everything it
 *  needs from the personal profile. */
function missingProfileFields(p) {
  const profile = p || {};
  const missing = [];
  const need = (key) => { if (isBlank(profile[key])) missing.push(key); };

  ALWAYS_REQUIRED_KEYS.forEach(need);
  // Identity — either ID satisfies it (there is no id_type field any more).
  if (isBlank(profile.identificationNo) && isBlank(profile.passportNo)) missing.push('identificationNo');
  // Bank details only matter for a bank refund; DuitNow needs none.
  if (profile.refundMethod === 'bank') { need('bankName'); need('bankAccountNo'); }
  // Spouse block only when married.
  if (profile.maritalStatus === 'married') {
    need('spouseName');
    if (isBlank(profile.spouseIdNo) && isBlank(profile.spousePassportNo)) missing.push('spouseIdNo');
    need('spouseDob');
    need('assessmentType');
  }
  // E-commerce model only once the user says they trade online.
  if (profile.carriesOnEcommerce && isBlank(profile.ecommerceModel)) missing.push('ecommerceModel');

  return missing;
}

// Which fields sit under each section heading of the Edit Profile modal, so
// gaps-only mode can hide a heading whose fields are all filled.
const SECTION_FIELD_KEYS = {
  identity: ['fullName', 'identificationNo', 'passportNo', 'personalTin', 'citizenship', 'gender', 'dateOfBirth'],
  marital:  ['maritalStatus', 'spouseName', 'spouseIdNo', 'spousePassportNo', 'spouseDob', 'assessmentType'],
  contact:  ['phone', 'correspondenceAddress', 'correspondencePostcode', 'correspondenceCity', 'correspondenceState'],
  other:    ['ecommerceModel'],
  refund:   ['refundMethod', 'bankName', 'bankAccountNo'],
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

// ── ChildrenEditor ────────────────────────────────────────────────────────────
// Per-child records feeding real H16a/b/c tiering (Phase 3, 14 Jul 2026) —
// replaces the old flat "Number of children" count. One child can be
// edited (or a new one added) at a time via an inline form; the rest render
// as compact summary rows.
function childSummaryLine(child) {
  if (child.isDisabled) return 'Disabled child (H16c)';
  const dob = child.dateOfBirth ? new Date(child.dateOfBirth) : null;
  if (!dob) return 'Age unknown — add date of birth';
  const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
  if (age < 18) return `Age ${age} — under 18 (H16a)`;
  if (child.isFullTimeStudent) return `Age ${age} — studying (H16b)`;
  return `Age ${age} — not studying or disabled, not eligible`;
}

const BLANK_CHILD = {
  name: '', identificationNo: '', dateOfBirth: '',
  isDisabled: false, isFullTimeStudent: false, isHigherEducation: false,
  ownIncomeMyr: '', ownIncomeIsExemptType: false,
  eligibilityPct: 100,
};

function ChildrenEditor({ children, onAdd, onUpdate, onDelete }) {
  const [editingId, setEditingId] = useState(null); // null = none; 'new' = adding; else child.id
  const [form, setForm] = useState(BLANK_CHILD);
  const list = children || [];

  const startAdd = () => { setForm(BLANK_CHILD); setEditingId('new'); };
  const startEdit = (child) => {
    setForm({
      name: child.name || '', identificationNo: child.identificationNo || '',
      dateOfBirth: child.dateOfBirth || '', isDisabled: !!child.isDisabled,
      isFullTimeStudent: !!child.isFullTimeStudent, isHigherEducation: !!child.isHigherEducation,
      ownIncomeMyr: child.ownIncomeMyr != null ? String(child.ownIncomeMyr) : '',
      ownIncomeIsExemptType: !!child.ownIncomeIsExemptType,
      eligibilityPct: child.eligibilityPct || 100,
    });
    setEditingId(child.id);
  };
  const cancel = () => { setEditingId(null); setForm(BLANK_CHILD); };

  const save = async () => {
    if (!form.name.trim() || !form.dateOfBirth) {
      alert('Name and date of birth are required.');
      return;
    }
    const ok = editingId === 'new' ? await onAdd(form) : await onUpdate(editingId, form);
    if (ok) cancel();
    else alert('Could not save this child record. Please try again.');
  };

  const remove = async (child) => {
    if (!window.confirm(`Remove ${child.name} from your child relief records?`)) return;
    await onDelete(child.id);
  };

  const isAdultAge = (() => {
    if (!form.dateOfBirth) return false;
    const age = Math.floor((Date.now() - new Date(form.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000));
    return age >= 18;
  })();

  return (
    <div className="mb-1">
      {list.length === 0 && editingId === null && (
        <p className="text-[10px] text-muted mb-2">No child records yet — add one below for accurate H16 tiering.</p>
      )}
      <div className="flex flex-col gap-1.5 mb-2">
        {list.map((child) => (
          editingId === child.id ? null : (
            <div key={child.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-headings truncate">{child.name}</p>
                <p className="text-[10px] text-muted">{childSummaryLine(child)}{child.eligibilityPct !== 100 ? ` · ${child.eligibilityPct}% eligibility` : ''}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => startEdit(child)} className="text-[10px] font-semibold text-primary hover:text-primary-hover">Edit</button>
                <button type="button" onClick={() => remove(child)} className="text-[10px] font-semibold text-critical hover:opacity-80">Remove</button>
              </div>
            </div>
          )
        ))}
      </div>

      {editingId !== null ? (
        <div className="rounded-lg border border-primary/30 bg-primary-tint/30 p-3 flex flex-col gap-2.5">
          <Field label="Child's name" required>
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="IC / passport no.">
              <TextInput value={form.identificationNo} onChange={(e) => setForm({ ...form, identificationNo: e.target.value })} />
            </Field>
            <Field label="Date of birth" required>
              <input type="date" className={inputClass} value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
            </Field>
          </div>
          <ToggleRow label="Disabled child (H16c)" checked={form.isDisabled} onChange={(v) => setForm({ ...form, isDisabled: v })} />
          {isAdultAge && (
            <>
              <ToggleRow
                label="Full-time student"
                hint="18 or above — required for any H16b/H16c relief"
                checked={form.isFullTimeStudent}
                onChange={(v) => setForm({ ...form, isFullTimeStudent: v })}
              />
              {form.isFullTimeStudent && (
                <ToggleRow
                  label="Qualifying higher-education programme"
                  hint="Local university/college (excl. matriculation/pre-degree/A-Level), trade articles, or a full degree outside Malaysia — RM8,000 tier instead of RM2,000"
                  checked={form.isHigherEducation}
                  onChange={(v) => setForm({ ...form, isHigherEducation: v })}
                />
              )}
            </>
          )}
          <Field
            label="Child's own income this year (RM)"
            hint="Subsection 48(5): if this exceeds the relief otherwise due, the relief is disallowed entirely — unless it's scholarship/grant income or articled-service pay"
          >
            <TextInput
              value={form.ownIncomeMyr}
              onChange={(e) => setForm({ ...form, ownIncomeMyr: e.target.value })}
              inputMode="decimal"
              placeholder="0.00 — leave blank if none"
            />
          </Field>
          {form.ownIncomeMyr && parseFloat(form.ownIncomeMyr) > 0 && (
            <ToggleRow
              label="This income is scholarship/grant or articled-service pay"
              hint="Excluded from the subsection 48(5) test per LHDN's own wording — tick this if it applies so the relief isn't wrongly disallowed"
              checked={form.ownIncomeIsExemptType}
              onChange={(v) => setForm({ ...form, ownIncomeIsExemptType: v })}
            />
          )}
          <Field label="Eligibility" hint="50% only applies when co-parenting the same relief with another filer">
            <SelectInput value={form.eligibilityPct} onChange={(e) => setForm({ ...form, eligibilityPct: parseInt(e.target.value, 10) })}>
              <option value={100}>100%</option>
              <option value={50}>50%</option>
            </SelectInput>
          </Field>
          <div className="flex items-center gap-2 mt-1">
            <button type="button" onClick={save} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover">
              Save child
            </button>
            <button type="button" onClick={cancel} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-muted hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startAdd}
          className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-primary hover:bg-primary-tint/30"
        >
          + Add a child
        </button>
      )}
    </div>
  );
}

const PersonalProfilePanel = ({ profile, onClose, onSave, children, onAddChild, onUpdateChild, onDeleteChild, taxSummary, gapsOnly = false, onDeleteAccount }) => {
  const [draft, setDraft] = useState(profile);
  // Danger Zone — Delete Account. Mirrors EntityPreviewPanel's own
  // confirmingDelete pattern exactly, plus a `deletingAccount` loading flag
  // since this one is a real async call the user should get feedback on
  // (deleting an entire account's data can take a moment).
  const [confirmingDeleteAccount, setConfirmingDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState('');

  const handleDeleteAccountClick = async () => {
    console.log('[DeleteAccount] Confirm Delete clicked. onDeleteAccount is', typeof onDeleteAccount);
    setDeletingAccount(true);
    setDeleteAccountError('');
    const ok = await onDeleteAccount();
    console.log('[DeleteAccount] onDeleteAccount() resolved with:', ok);
    if (!ok) {
      setDeletingAccount(false);
      setDeleteAccountError("Something went wrong deleting your account. Please try again.");
    }
    // On success, onDeleteAccount itself navigates away (to the home page) —
    // no further state update needed here, and this component will unmount.
  };
  const childrenList = children || [];
  const legacyChildCount = parseInt(draft.numberOfChildren || '0', 10) || 0;

  React.useEffect(() => {
    if (profile) {
      setDraft(profile);
    }
  }, [profile]); // Fires automatically the exact millisecond personalProfile updates!

  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });
  const setVal = (key) => (val) => setDraft({ ...draft, [key]: val });

  // Phase 7 follow-up (14 Jul 2026): surfaces the same Form EA employer TIN
  // suggestion that already auto-fills D3 on the generated Form B, but here
  // as an explicit "Use this" button in the editable profile — the person
  // sees WHERE the number came from and opts in, rather than it only
  // silently appearing downstream on the generated document. Never
  // overwrites anything already typed; only offered while the field is
  // still blank. d3EmployerTinSuggestion lives at the top level of the
  // currentYear summary (a sibling of `totals`), not inside totals.
  const d3Suggestion = taxSummary?.currentYear?.d3EmployerTinSuggestion || null;
  const showTinSuggestion = !draft.employerTin && d3Suggestion?.value;

  const isMarried = draft.maritalStatus === 'married';

  // ── Gaps-only mode ────────────────────────────────────────────────────────
  // Opened from the `profile_incomplete` AI insight, this renders only the
  // required fields that are still empty, so the user completes them without
  // scrolling the whole form. The full form (the "Edit profile" button's
  // behaviour) is completely unchanged — every field below is the same JSX,
  // just gated, so the two modes can never render a field differently.
  const [showAll, setShowAll] = useState(false);
  // Union of the saved profile's gaps and the current draft's: the saved side
  // keeps a field on screen while you type into it (computing purely from the
  // draft would make it vanish mid-keystroke); the draft side reveals newly
  // required conditionals (e.g. choosing "Married" shows the spouse block).
  const savedMissing = missingProfileFields(profile);
  const draftMissing = missingProfileFields(draft);
  const visibleSet = new Set([...savedMissing, ...draftMissing]);
  // Either/or identity pairs: surface BOTH so the requirement can be satisfied
  // with whichever ID the filer actually holds.
  if (visibleSet.has('identificationNo')) visibleSet.add('passportNo');
  if (visibleSet.has('spouseIdNo')) visibleSet.add('spousePassportNo');
  // Fall back to the full form when nothing is missing (stale deep-link, or the
  // gaps were filled elsewhere) — an empty filtered modal would be a dead end.
  const filtering = gapsOnly && !showAll && visibleSet.size > 0;
  const show = (key) => !filtering || visibleSet.has(key);
  const showSection = (id) => !filtering || SECTION_FIELD_KEYS[id].some((k) => visibleSet.has(k));
  const gapCount = draftMissing.length;

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
              {filtering ? (
                <p className="text-[11px] font-semibold text-[#D85A30]">
                  {gapCount} field{gapCount === 1 ? '' : 's'} needed for Form B
                </p>
              ) : (
                <p className="text-[11px] text-muted">Used across all entities you file for</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-headings transition-colors duration-150 shrink-0" aria-label="Close panel">
            <XIcon />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-2.5">

          {showSection('identity') && <SectionLabel>Identity & Residency</SectionLabel>}
          {show('fullName') && (
            <Field label="Full name (as per IC/passport)" required>
              <TextInput value={draft.fullName} onChange={set('fullName')} placeholder="Full legal name" />
            </Field>
          )}
          {(show('identificationNo') || show('passportNo')) && (
            <div className="grid grid-cols-2 gap-2.5">
              {show('identificationNo') && (
                <Field label="IC no." hint={filtering ? 'Fill either this or the passport no.' : undefined}>
                  <TextInput value={draft.identificationNo} onChange={set('identificationNo')} placeholder="YYMMDD-PB-XXXX" />
                </Field>
              )}
              {show('passportNo') && (
                <Field label="Passport no.">
                  <TextInput value={draft.passportNo} onChange={set('passportNo')} placeholder="A12345678" />
                </Field>
              )}
            </div>
          )}
          {(show('personalTin') || show('citizenship')) && (
            <div className="grid grid-cols-2 gap-2.5">
              {show('personalTin') && (
                <Field label="Tax Identification No. (TIN)" required>
                  <TextInput value={draft.personalTin} onChange={set('personalTin')} placeholder="IG 1234567890" />
                </Field>
              )}
              {show('citizenship') && (
                <Field label="Citizenship" hint="Country code, MYS if Malaysian">
                  <TextInput value={draft.citizenship} onChange={set('citizenship')} placeholder="MYS" />
                </Field>
              )}
            </div>
          )}
          {(show('gender') || show('dateOfBirth')) && (
            <div className="grid grid-cols-2 gap-2.5">
              {show('gender') && (
                <Field label="Gender">
                  <SelectInput value={draft.gender} onChange={set('gender')}>
                    <option value="" disabled>Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </SelectInput>
                </Field>
              )}
              {show('dateOfBirth') && (
                <Field label="Date of birth">
                  <input type="date" className={inputClass} value={draft.dateOfBirth} onChange={set('dateOfBirth')} />
                </Field>
              )}
            </div>
          )}

          {showSection('marital') && <SectionLabel><span className="mt-2 block">Marital Status & Dependents</span></SectionLabel>}
          {show('maritalStatus') && (
            <Field label="Marital status as at 31 Dec">
              <SelectInput
                value={draft.maritalStatus}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  // Root-cause fix (Phase 4 review, 14 Jul 2026): the joint-
                  // assessment dropdown only renders while married — moving
                  // away from married hides it, but without this reset its
                  // last-selected value ('joint-husband'/'joint-wife') would
                  // otherwise persist invisibly and could resurface if the
                  // person remarries later. The backend independently guards
                  // against this too (assessment_type is only honoured while
                  // marital_status === 'married'), but resetting it here means
                  // the UI's own state stays honest rather than relying on
                  // that downstream defense alone.
                  if (newStatus !== 'married' && (draft.assessmentType === 'joint-husband' || draft.assessmentType === 'joint-wife')) {
                    setDraft({ ...draft, maritalStatus: newStatus, assessmentType: '', spouseTotalIncomeMyr: '', spouseForeignIncomeMyr: '' });
                  } else {
                    setDraft({ ...draft, maritalStatus: newStatus });
                  }
                }}
              >
                <option value="" disabled>Select</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
                <option value="divorced-widowed">Divorcee / Widow / Widower</option>
                <option value="deceased">Deceased</option>
              </SelectInput>
              {!draft.gender && (isMarried && (draft.assessmentType === 'joint-husband' || draft.assessmentType === 'joint-wife')) && (
                <p className="mt-1 text-[10px] text-warning">
                  Required to determine whether this return aggregates the household's income under joint assessment (B21/B22).
                </p>
              )}
            </Field>
          )}
          {!filtering && (draft.maritalStatus === 'divorced-widowed' || draft.maritalStatus === 'deceased') && (
            <Field label="Date of divorce / demise">
              <input type="date" className={inputClass} value={draft.maritalEventDate} onChange={set('maritalEventDate')} />
            </Field>
          )}
          {isMarried && (
            <>
              {!filtering && (
                <Field label="Date of marriage">
                  <input type="date" className={inputClass} value={draft.maritalEventDate} onChange={set('maritalEventDate')} />
                </Field>
              )}
              {show('spouseName') && (
                <Field label="Spouse's name">
                  <TextInput value={draft.spouseName} onChange={set('spouseName')} placeholder="Full name" />
                </Field>
              )}
              {(show('spouseIdNo') || show('spousePassportNo')) && (
                <div className="grid grid-cols-2 gap-2.5">
                  {show('spouseIdNo') && (
                    <Field label="Spouse's IC no." hint={filtering ? 'Fill either this or the passport no.' : undefined}>
                      <TextInput value={draft.spouseIdNo} onChange={set('spouseIdNo')} placeholder="YYMMDD-PB-XXXX" />
                    </Field>
                  )}
                  {show('spousePassportNo') && (
                    <Field label="Spouse's passport no.">
                      <TextInput value={draft.spousePassportNo} onChange={set('spousePassportNo')} placeholder="A12345678" />
                    </Field>
                  )}
                </div>
              )}
              {show('spouseDob') && (
                <Field label="Spouse's date of birth">
                  <input type="date" className={inputClass} value={draft.spouseDob} onChange={set('spouseDob')} />
                </Field>
              )}
            </>
          )}
          {/* Type of assessment (Form B item A7) always applies to every filer,
              not just married ones — LHDN's own code 5 covers single/divorcee/
              widow/widower/deceased. Election only makes sense when married
              (codes 1-4); otherwise it's automatic, shown read-only. */}
          {isMarried ? (
            show('assessmentType') && (
              <Field label="Type of assessment election">
                <SelectInput value={draft.assessmentType} onChange={set('assessmentType')}>
                  <option value="" disabled>Select</option>
                  <option value="joint-husband">Joint — in the name of husband</option>
                  <option value="joint-wife">Joint — in the name of wife</option>
                  <option value="separate">Separate</option>
                  <option value="self-spouse-no-income">Self whose spouse has no income, no source of income or has tax exempt income</option>
                </SelectInput>
                {/* Joint assessment aggregates the spouse's income into B21/B22
                    (Phase 4, 14 Jul 2026) — but only on the return in whose
                    name the assessment is actually raised, per LHDN's own
                    rule. Which return that is depends on THIS filer's own
                    gender matching the election direction (joint-husband +
                    male, or joint-wife + female) — if gender doesn't match,
                    this return correctly does NOT aggregate (the spouse's own
                    return does instead); if gender isn't set at all, the
                    generated draft will flag it as needing review rather than
                    guessing. See totals.jointAssessment on the generated
                    draft for the resolved outcome for this specific filer. */}
                {(draft.assessmentType === 'joint-husband' || draft.assessmentType === 'joint-wife') && (
                  <>
                    <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-primary-tint px-2.5 py-2 text-[10px] leading-relaxed text-primary">
                      <span aria-hidden="true">ℹ</span>
                      <span>
                        Whether this specific return aggregates the household's income depends on
                        your own gender matching the election above — set gender in Basic
                        Particulars if you haven't already. The generated Form B draft will show
                        exactly which way it resolved.
                      </span>
                    </p>
                    <div className="mt-2">
                      <Field label="Spouse's total income (RM)" hint="Aggregated into B21/B22 automatically when this return is the one raising the joint assessment">
                        <TextInput value={draft.spouseTotalIncomeMyr} onChange={set('spouseTotalIncomeMyr')} inputMode="decimal" placeholder="0.00" />
                      </Field>
                    </div>
                  </>
                )}
              </Field>
            )
          ) : (
            !filtering && (
              <Field label="Type of assessment" hint="Automatic — no election needed when not married">
                <div className={inputClass + ' bg-slate-50 text-muted cursor-not-allowed'}>
                  Self (Single / divorcee / widow / widower / deceased)
                </div>
              </Field>
            )
          )}
          {!filtering && (
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
          )}
          {!filtering && (
            <>
              {isMarried && (draft.assessmentType === 'joint-husband' || draft.assessmentType === 'joint-wife' || draft.assessmentType === 'self-spouse-no-income') && (
                <Field
                  label="Spouse's foreign-sourced income (RM)"
                  hint="H14's RM4,000 spouse relief is disallowed if your spouse (unless disabled) has more than RM4,000 in income from sources OUTSIDE Malaysia — leave blank or 0 if none"
                >
                  <TextInput value={draft.spouseForeignIncomeMyr} onChange={set('spouseForeignIncomeMyr')} inputMode="decimal" placeholder="0.00" />
                </Field>
              )}
              {draft.maritalStatus === 'divorced-widowed' && (
                <Field label="Alimony paid to former wife (RM)" hint="H14 — combined with any spouse relief under the same RM4,000 cap">
                  <TextInput value={draft.alimonyPaidMyr} onChange={set('alimonyPaidMyr')} inputMode="decimal" placeholder="0.00" />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex items-end pb-2">
                  <ToggleRow
                    label="I am a disabled person (H4)"
                    checked={draft.isDisabledSelf}
                    onChange={setVal('isDisabledSelf')}
                  />
                </div>
                {isMarried && (
                  <div className="flex items-end pb-2">
                    <ToggleRow
                      label="My spouse is a disabled person (H15)"
                      checked={draft.spouseIsDisabled}
                      onChange={setVal('spouseIsDisabled')}
                    />
                  </div>
                )}
              </div>

              <SectionLabel><span className="mt-2 block">Children (H16 relief)</span></SectionLabel>
              <ChildrenEditor
                children={childrenList}
                onAdd={onAddChild}
                onUpdate={onUpdateChild}
                onDelete={onDeleteChild}
              />
              {legacyChildCount > 0 && childrenList.length === 0 && (
                <p className="text-[10px] text-muted -mt-1.5">
                  This profile still has a legacy child count ({legacyChildCount}) with no per-child records —
                  a flat RM2,000/child estimate is used until you add real records above.
                </p>
              )}
            </>
          )}

          {showSection('contact') && <SectionLabel><span className="mt-2 block">Contact & Correspondence</span></SectionLabel>}
          {(show('phone') || !filtering) && (
            <div className="grid grid-cols-2 gap-2.5">
              {show('phone') && (
                <Field label="Phone / handphone">
                  <TextInput value={draft.phone} onChange={set('phone')} placeholder="012-345 6789" />
                </Field>
              )}
              {!filtering && (
                <Field label="Email">
                  <TextInput value={draft.email} onChange={set('email')} placeholder="name@email.com" />
                </Field>
              )}
            </div>
          )}
          {show('correspondenceAddress') && (
            <Field label="Correspondence address">
              <TextInput value={draft.correspondenceAddress} onChange={set('correspondenceAddress')} placeholder="Street address" />
            </Field>
          )}
          {(show('correspondencePostcode') || show('correspondenceCity') || show('correspondenceState')) && (
            <div className="grid grid-cols-3 gap-2.5">
              {show('correspondencePostcode') && (
                <Field label="Postcode">
                  <TextInput value={draft.correspondencePostcode} onChange={set('correspondencePostcode')} placeholder="47500" />
                </Field>
              )}
              {show('correspondenceCity') && (
                <Field label="City">
                  <TextInput value={draft.correspondenceCity} onChange={set('correspondenceCity')} placeholder="Subang Jaya" />
                </Field>
              )}
              {show('correspondenceState') && (
                <Field label="State">
                  <SelectInput value={draft.correspondenceState} onChange={set('correspondenceState')}>
                    <option value="" disabled>Select</option>
                    {MALAYSIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </SelectInput>
                </Field>
              )}
            </div>
          )}

          {(showSection('other') || !filtering) && (
            <SectionLabel><span className="mt-2 block">Other Particulars</span></SectionLabel>
          )}
          {!filtering && (
            <>
              <Field label="Employer's TIN" hint="Auto-filled on your generated Form B from a Form EA upload if left blank here — enter manually to override">
                <TextInput value={draft.employerTin} onChange={set('employerTin')} placeholder="E 12345678090" />
              </Field>
              {showTinSuggestion && (
                <div className="-mt-2 flex items-center justify-between gap-2 rounded-lg bg-primary-tint/50 px-3 py-2 text-xs text-body-text">
                  <span>
                    Found <span className="font-semibold text-headings">{d3Suggestion.value}</span> on your uploaded Form EA
                    {d3Suggestion.hasMultipleEmployers && ' (you had more than one employer this year — verify this is the right one)'}.
                  </span>
                  <button
                    type="button"
                    onClick={() => setVal('employerTin')(d3Suggestion.value)}
                    className="shrink-0 rounded-md bg-primary px-2.5 py-1 font-semibold text-white hover:bg-primary-hover"
                  >
                    Use this
                  </button>
                </div>
              )}
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
            </>
          )}
          {draft.carriesOnEcommerce && show('ecommerceModel') && (
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
          {filtering && showSection('refund') && (
            <SectionLabel><span className="mt-2 block">Refund Details</span></SectionLabel>
          )}
          {show('refundMethod') && (
            <Field label="Method of payment for tax refund">
              <SelectInput value={draft.refundMethod} onChange={set('refundMethod')}>
                <option value="" disabled>Select</option>
                <option value="bank">Payment via bank account</option>
                <option value="duitnow">Payment via DuitNow</option>
              </SelectInput>
            </Field>
          )}
          {draft.refundMethod === 'bank' && (show('bankName') || show('bankAccountNo')) && (
            <div className="grid grid-cols-2 gap-2.5">
              {show('bankName') && (
                <Field label="Bank name">
                  <TextInput value={draft.bankName} onChange={set('bankName')} placeholder="e.g. Maybank" />
                </Field>
              )}
              {show('bankAccountNo') && (
                <Field label="Account no.">
                  <TextInput value={draft.bankAccountNo} onChange={set('bankAccountNo')} placeholder="1234567890" />
                </Field>
              )}
            </div>
          )}
          {!filtering && draft.refundMethod === 'duitnow' && (
            <Field label="DuitNow identification type (self)">
              <SelectInput value={draft.duitnowIdType} onChange={set('duitnowIdType')}>
                <option value="ic">Identification card</option>
                <option value="passport">Passport</option>
              </SelectInput>
            </Field>
          )}
          {!filtering && (
            <ToggleRow
              label="Asset disposal under RPGT 1976"
              hint="You disposed of an asset under the Real Property Gains Tax Act this year"
              checked={draft.rpgtDisposal}
              onChange={setVal('rpgtDisposal')}
            />
          )}
          {!filtering && draft.rpgtDisposal && (
            <ToggleRow
              label="Disposal declared to LHDNM"
              hint="You've already declared this disposal to LHDN"
              checked={draft.disposalDeclared}
              onChange={setVal('disposalDeclared')}
            />
          )}

          {/* Gaps-only mode stops here: everything below is optional context,
              not something Form B blocks on. An escape hatch drops the filter
              so the user can still reach the full form without leaving. */}
          {filtering && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-1 self-start text-[11px] font-semibold text-primary hover:underline"
            >
              Show all profile fields
            </button>
          )}

          {!filtering && (
          <>
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
          </>
          )}

          {/* Danger zone — hidden while filtering to just the Form B gaps, same
              as EntityPreviewPanel's own Danger Zone, styled identically. */}
          {!filtering && onDeleteAccount && <div className="mt-4 pt-4 border-t border-slate-100">
            <SectionLabel><span className="text-[#D85A30]">Danger Zone</span></SectionLabel>
            {!confirmingDeleteAccount ? (
              <button
                onClick={() => setConfirmingDeleteAccount(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D85A30] hover:text-[#993C1D] transition-colors duration-150"
              >
                <TrashIcon />Delete my account
              </button>
            ) : (
              <div className="rounded-lg border border-[#F0997B] bg-[#FAECE7] p-3">
                <div className="flex gap-2.5">
                  <AlertTriangleIcon />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-[#712B13]">
                      Delete your account?
                    </p>
                    <p className="text-[11px] text-[#993C1D] mt-0.5 leading-relaxed">
                      This permanently removes your profile, every business entity, all uploaded
                      documents, chat history, and saved insights. This cannot be undone.
                    </p>
                    {deleteAccountError && (
                      <p className="text-[11px] font-semibold text-[#993C1D] mt-1.5">{deleteAccountError}</p>
                    )}
                    <div className="flex gap-2 mt-2.5">
                      <button
                        onClick={() => { setConfirmingDeleteAccount(false); setDeleteAccountError(''); }}
                        disabled={deletingAccount}
                        className="py-1.5 px-3 text-xs border border-slate-200 rounded-lg font-medium text-headings hover:bg-slate-50 transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDeleteAccountClick}
                        disabled={deletingAccount}
                        className="py-1.5 px-3 text-xs bg-[#D85A30] text-white rounded-lg font-semibold hover:bg-[#993C1D] transition-colors duration-150 disabled:opacity-70 disabled:cursor-wait flex items-center gap-1.5"
                      >
                        {deletingAccount ? (
                          <>
                            <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-90" />
                            </svg>
                            Deleting…
                          </>
                        ) : (
                          'Confirm Delete'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>}
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

  // Opening-balance suggestion (15 Jul 2026) — if this entity has NO
  // opening balance year set yet, check whether a prior filed Form B
  // (already uploaded and extracted) can suggest one, rather than leaving
  // this as pure manual entry when the exact figures are sitting in an
  // already-processed document. Read-only: never writes anything here —
  // applying the suggestion just pre-fills the existing form fields below,
  // so the user still reviews and clicks the normal Save button.
  const [openingSuggestion, setOpeningSuggestion] = useState(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  useEffect(() => {
    if (isNew || !entity.id || draft.openingBalanceYear) return;
    const userId = localStorage.getItem('userId');
    let cancelled = false;
    getOpeningBalanceSuggestion(entity.id, currentFilingYear(), userId)
      .then((res) => { if (!cancelled && res?.available) setOpeningSuggestion(res); })
      .catch(() => { /* suggestion is best-effort — silently skip on failure */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.id, isNew]);

  const applyOpeningSuggestion = () => {
    if (!openingSuggestion) return;
    setDraft({
      ...draft,
      openingBalanceYear: String(openingSuggestion.suggestedOpeningBalanceYear),
      openingUnabsorbedBusinessLossMyr: String(openingSuggestion.suggestedOpeningUnabsorbedBusinessLossMyr ?? '0'),
      openingUnabsorbedCapitalAllowanceMyr: String(openingSuggestion.suggestedOpeningUnabsorbedCapitalAllowanceMyr ?? '0'),
    });
    setSuggestionDismissed(true);
  };

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

          {/* Opening carry-forward balances (Phase 3) — one-time seed values
              for the auto-tracked B5/M1 (business loss) and M2 (capital
              allowance) multi-year schedule. Only needed once, to cover
              history from BEFORE this business started using cukai.ai —
              everything after opening_balance_year is computed automatically
              from actual documents, never re-entered manually. */}
          <SectionLabel><span className="mt-2 block">Opening Carry-Forward Balances (Part M)</span></SectionLabel>
          <p className="text-[10px] text-[#94A3B8] -mt-1.5 mb-1">
            Optional — only needed if this business had unabsorbed losses or capital allowance
            BEFORE using cukai.ai. Enter the balance as of the end of a specific year; everything
            after that is tracked automatically from your documents.
          </p>
          <Field label="As of end of year of assessment" hint="Anchor year for both balances below">
            <TextInput value={draft.openingBalanceYear} onChange={set('openingBalanceYear')} inputMode="numeric" placeholder="e.g. 2023" />
          </Field>

          {/* Suggested from a prior filed Form B — same visual pattern as
              SupportingDocumentsCard's "Suggested Match", so a suggestion
              always reads as "confirm before use", never as an already-
              applied fact. Only shown once, and only until dismissed or
              applied. */}
          {openingSuggestion && !suggestionDismissed && !draft.openingBalanceYear && (
            <div className="flex items-center mb-1 rounded-lg border border-dashed border-primary bg-primary-tint/50 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium text-primary">
                  Suggested from your YA{openingSuggestion.sourceYear} Form B
                </p>
                <p className="mt-0.5 text-xs text-headings">
                  Unabsorbed losses: RM{fmtAmt(openingSuggestion.suggestedOpeningUnabsorbedBusinessLossMyr)} ·
                  Unabsorbed CA: RM{fmtAmt(openingSuggestion.suggestedOpeningUnabsorbedCapitalAllowanceMyr)}
                </p>
                <p className="mt-1 text-[10px] text-muted">{openingSuggestion.note}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-1.5 pl-3">
                <button
                  type="button"
                  onClick={applyOpeningSuggestion}
                  className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-white transition-colors duration-150 hover:bg-primary-hover"
                >
                  Use these figures
                </button>
                <button
                  type="button"
                  onClick={() => setSuggestionDismissed(true)}
                  className="text-[10px] font-medium text-muted hover:text-headings"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Unabsorbed business losses (RM)">
              <TextInput value={draft.openingUnabsorbedBusinessLossMyr} onChange={set('openingUnabsorbedBusinessLossMyr')} inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="Unabsorbed capital allowance (RM)">
              <TextInput value={draft.openingUnabsorbedCapitalAllowanceMyr} onChange={set('openingUnabsorbedCapitalAllowanceMyr')} inputMode="decimal" placeholder="0.00" />
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
// Shared by FPart's own Review badge and the review guide panel below, so
// clicking either one does the exact same thing: scroll to the row, flash
// its background briefly so the eye lands in the right place.
function scrollToRowAndFlash(rowEl) {
  if (!rowEl) return;
  rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const prevBg = rowEl.style.backgroundColor;
  const prevTransition = rowEl.style.transition;
  rowEl.style.transition = 'background-color 0.3s ease';
  rowEl.style.backgroundColor = '#FEF3C7';
  setTimeout(() => {
    rowEl.style.backgroundColor = prevBg;
    setTimeout(() => { rowEl.style.transition = prevTransition; }, 350);
  }, 1200);
}

const FPart = ({ code, title, children }) => {
  const bodyRef = React.useRef(null);
  // Detected via a DOM scan of this Part's own rendered children rather than
  // requiring every FPart call site to separately declare which codes it
  // contains — there are only ~14 FPart sections vs ~190 FRow rows, but
  // this still avoids adding a prop to any of them. Re-checked on every
  // render since which rows carry a review dot can change as fd updates.
  const [hasReview, setHasReview] = React.useState(false);
  React.useEffect(() => {
    setHasReview(!!bodyRef.current?.querySelector('[data-review-dot="true"]'));
  });

  const handleReviewClick = () => {
    const dot = bodyRef.current?.querySelector('[data-review-dot="true"]');
    const targetRow = dot?.closest('[id^="row-"]');
    scrollToRowAndFlash(targetRow);
  };

  return (
    <div className="border-x border-b border-[#CBD5E1] first:border-t" data-part-code={code || ''} data-part-title={title}>
      <div data-pdf-row="true" className="flex items-center justify-between gap-2 bg-[#E2E8F0] border-b border-[#CBD5E1] px-2 py-1">
        <div className="flex items-center gap-2">
          {code && <span className="text-[10px] font-bold text-[#0F172A]">{code}</span>}
          <span className="text-[10px] font-bold uppercase tracking-wide text-[#0F172A]">{title}</span>
        </div>
        {hasReview && (
          <button
            type="button"
            onClick={handleReviewClick}
            data-form-annotation="true"
            className="shrink-0 rounded-full px-2 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide transition-colors hover:opacity-80"
            style={{ backgroundColor: REVIEW_BADGE_BG, color: REVIEW_BADGE_TEXT }}
          >
            Review
          </button>
        )}
      </div>
      <div ref={bodyRef} className="divide-y divide-[#EDF1F5]">{children}</div>
    </div>
  );
};

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
// Phase 7 follow-up (14 Jul 2026): two INDEPENDENT signals, not one.
// Provenance (below) answers "where did this figure come from" — Document /
// Profile / Estimate / Automatic. Review (further below) answers a
// completely different question — "does this specific figure need the
// person's active attention before filing."
//
// Review is driven by TWO things now, not just one:
//   1. An explicit backend 'warning' (fd.reviewCodes) — e.g. a disposal's
//      balancing charge, an ambiguous multi-employer TIN pick, a low-
//      confidence extraction. These need review even though they already
//      HAVE a value.
//   2. Any in-scope row that's simply BLANK — no value at all yet. Most
//      fields on a brand-new account are blank and genuinely do need
//      attention (upload a document, fill in a profile field, etc.) — this
//      is the expected, correct initial state, not noise to suppress. A
//      row is exempted from this only when its provenance is explicitly
//      'out_of_scope' (a feature that will never be available, e.g.
//      partnership income) — there's nothing to review there because
//      there's nothing to do.
// Both funnel into the SAME review dot/badge, so a row's status changes
// automatically as the person fills things in or clears them — no separate
// "confirmed" flag to maintain.
//
// Simplified (14 Jul 2026) — provenance dots (Document/Profile/Automatic/
// No data) removed entirely per product decision; only the review signal
// remains. 'out_of_scope' is still tracked (as a plain string check, not a
// rendered category) since review logic needs to know which codes should
// NEVER be flagged — a genuinely unavailable feature (partnerships, foreign
// business income, the H2i/H2ii/H5i-iii/H6i-iv/H7*/H8* sub-lines, etc.)
// has nothing to review, which is different from a blank in-scope field.
//
// ReviewContext avoids re-touching every one of the ~190 FRow call sites a
// second time — FRow looks up its own review status internally via
// useContext, keyed by the `code` prop it already receives.
const ReviewContext = React.createContext(new Set());

// Matches the pastel yellow already used for review/action buttons
// elsewhere in the app (ActionBanner's warning tokens: bg #FAEEDA / text
// #BA7517) — used for the Review badge in FPart's title bar, the only
// visible review signal left (legend and per-row dot both removed per
// product decision, 14 Jul 2026).
const REVIEW_BADGE_BG = '#FAEEDA';
const REVIEW_BADGE_TEXT = '#BA7517';

// No longer renders a visible dot (legend + per-row dot removed, badge-only
// now) — but still renders an INVISIBLE marker carrying the same
// data-review-dot attribute, because FPart's "does this section have
// anything needing review" check and its click-to-scroll-to-the-first-
// flagged-row behavior both work by querying the DOM for
// `[data-review-dot="true"]`. Removing the marker entirely would silently
// break the Review badge too, not just the dot — this keeps that
// mechanism intact while showing nothing on screen.
const ReviewDot = ({ needsReview }) => {
  if (!needsReview) return null;
  return <span data-form-annotation="true" data-review-dot="true" style={{ display: 'none' }} />;
};

// A row is considered "blank" for auto-review purposes using the same
// dash/empty conventions already used throughout this document (dash() /
// hv() / fmtAmt's own '—' fallback) — checked directly against whatever
// was actually passed as `value`, so this stays correct automatically as
// new fields get wired up rather than needing a second parallel "is this
// field empty" data source.
const isBlankValue = (value) => value === '—' || value === '' || value === null || value === undefined;

const FRow = ({ code, label, value, sub, strong, highlight, flatLabel, provenance }) => {
  const reviewCodes = React.useContext(ReviewContext);
  const isOutOfScope = provenance === 'out_of_scope';
  const explicitlyFlagged = !!code && reviewCodes.has(code);
  // Out-of-scope rows never need review — there's nothing to do, the
  // feature just isn't available. Everything else needing review is either
  // explicitly flagged by the backend OR simply blank and in scope.
  const needsReview = !isOutOfScope && !!code && (explicitlyFlagged || isBlankValue(value));

  return (
    <div id={code ? `row-${code}` : undefined} data-pdf-row="true" className={`table w-full table-fixed text-[10px] ${highlight ? 'bg-[#F0FDF4]' : ''}`}>
      <div className="table-cell w-14 align-middle border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">
        <ReviewDot needsReview={needsReview} />
        {code || ''}
      </div>
      <div data-row-label={typeof label === 'string' ? label : undefined} className={`table-cell align-middle px-2 py-1 text-left ${flatLabel ? 'text-[#334155]' : `${sub ? 'pl-4 text-[#64748B]' : 'text-[#334155]'} ${strong ? 'font-semibold text-[#0F172A]' : ''}`}`}>
        {label}
      </div>
      <div className={`table-cell w-36 align-middle border-l border-[#EDF1F5] px-2 py-1 text-right tabular-nums ${strong ? 'font-bold text-[#0F172A]' : (highlight ? 'text-[#0F6E56] font-semibold' : 'text-[#0F172A]')}`}>{value}</div>
    </div>
  );
};

// One-off for B21, whose code column spans two sub-rows (the transferred-
// income total and the income-type note) — can't reuse plain FRow, but
// follows the exact same context-lookup pattern for its review dot. B21 is
// always a real number (0 for most filers, who aren't on joint assessment
// at all) — never blank — so only the explicit backend flag (gender-
// ambiguity on joint assessment) can trigger review here.
const B21Row = ({ fd }) => {
  const reviewCodes = React.useContext(ReviewContext);
  const needsReview = reviewCodes.has('B21');
  return (
    <div id="row-B21" data-pdf-row="true" className="flex items-stretch text-[10px]">
      <div className="w-14 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium flex items-center">
        <ReviewDot needsReview={needsReview} />
        B21
      </div>
      <div className="flex-1 flex flex-col divide-y divide-[#EDF1F5]">
        <div className="flex items-stretch">
          <div data-row-label="Total income transferred from husband / wife for joint assessment" className="flex-1 px-2 py-1 text-left text-[#334155]">
            TOTAL INCOME TRANSFERRED FROM HUSBAND / WIFE * FOR JOINT ASSESSMENT
          </div>
          <div className="w-36 shrink-0 border-l border-[#EDF1F5] px-2 py-1 text-right tabular-nums text-[#0F172A]">{fmtAmt(fd.b21)}</div>
        </div>
        <div className="flex items-stretch">
          <div className="flex-1 px-2 py-1 text-left text-[#334155]">* Type of income transferred from HUSBAND / WIFE</div>
          <div className="w-36 shrink-0 border-l border-[#EDF1F5] px-2 py-1 text-right tabular-nums text-[#334155]">{fd.b21 > 0 ? 'Not tracked' : '—'}</div>
        </div>
      </div>
    </div>
  );
};

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
// Both J1 and J2 are out of scope (14 Jul 2026 — see form-b-roadmap.md), so
// `rows` is never passed anymore and this always falls back to the blank
// i./ii. placeholder lines below, same as J2 always has.
function PartJClaimTable({ code, title, firstColLabel, rows }) {
  const gridCols = 'grid grid-cols-[28px_repeat(5,minmax(0,1fr))]';
  const displayRows = rows && rows.length
    ? rows.map((r, i) => ({
        roman: ['i.', 'ii.', 'iii.', 'iv.', 'v.'][i] || `${i + 1}.`,
        firstCol: `${r.claimCode} — ${r.label}${r.needsReview ? ' ⚠' : ''}`,
        balanceBroughtForward: fmtAmt(r.balanceBroughtForward),
        amountClaimed: fmtAmt(r.amountClaimed),
        amountAbsorbed: fmtAmt(r.amountAbsorbed),
        balanceCarriedForward: fmtAmt(r.balanceCarriedForward),
        note: r.note,
      }))
    : ['i.', 'ii.'].map((roman) => ({
        roman, firstCol: '—', balanceBroughtForward: '—', amountClaimed: '—',
        amountAbsorbed: '—', balanceCarriedForward: '—', note: null,
      }));

  return (
    <div className="flex items-stretch text-[10px]">
      <div className="w-14 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium flex items-center">{code}</div>
      <div className="flex-1 flex flex-col divide-y divide-[#EDF1F5]">
        <div data-pdf-row="true" className="px-2 py-1 text-[#334155]">{title}</div>
        <div data-pdf-row="true" className={`items-center ${gridCols} text-[9px] font-semibold uppercase tracking-wide text-[#64748B] bg-[#F8FAFC]`}>
          <div className="col-span-2 border-r border-[#EDF1F5] px-2 py-1">{firstColLabel}</div>
          <div className="border-r border-[#EDF1F5] px-2 py-1">Balance Brought Forward</div>
          <div className="border-r border-[#EDF1F5] px-2 py-1">Amount Claimed</div>
          <div className="border-r border-[#EDF1F5] px-2 py-1">Amount Absorbed</div>
          <div className="px-2 py-1">Balance Carried Forward</div>
        </div>
        {displayRows.map((row) => (
          <div key={row.roman} data-pdf-row="true" className={`items-center ${gridCols} text-[10px] text-[#334155]`}>
            <div className="border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">{row.roman}</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">{row.firstCol}</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{row.balanceBroughtForward}</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{row.amountClaimed}</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{row.amountAbsorbed}</div>
            <div className="px-2 py-1 text-right tabular-nums">{row.balanceCarriedForward}</div>
          </div>
        ))}
        {rows && rows.some((r) => r.note) && (
          <div className="px-2 py-1 text-[9px] italic text-[#94A3B8]">
            {rows.filter((r) => r.note).map((r) => `${r.claimCode}: ${r.note}`).join(' ')}
          </div>
        )}
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

  // Phase 7 (14 Jul 2026): per-row provenance lookup for H-codes and
  // N-codes. H2/H5/H6/H7/H8 have all now been split into their real,
  // individually-tracked LHDN sub-line categories (see main.py's
  // RELIEF_CAP_GROUPS) — this set is empty. H9/H10 still fold their own
  // sub-items into one combined category each, but since neither has an
  // internal sub-cap needing separate enforcement, they're a lower-priority
  // display-only gap, not wired through this "never tracked" mechanism.
  const NEVER_TRACKED_H_SUBLINES = new Set([]);
  const gp = (code) => {
    if (NEVER_TRACKED_H_SUBLINES.has(code)) return 'out_of_scope';
    return (fd.reliefProvenanceByCode && fd.reliefProvenanceByCode[code])
      || (fd.nProvenance && fd.nProvenance[code])
      || (fd.otherLineProvenance && fd.otherLineProvenance[code])
      || null;
  };
  // Always full width of whatever container renders it — both the embedded
  // (Generate Forms tab) and non-embedded (PDF generation) cases. The old
  // fixed 620px width for the non-embedded case is gone: it left the content
  // stranded in a narrow left-aligned column with a large unexplained blank
  // strip on the right once printed to PDF. The true "A4 page" margin is now
  // applied once, as padding around the off-screen render source in
  // GenerateFormsPanel, so the form itself always fills the full printable
  // width between those margins.
  return (
    <ReviewContext.Provider value={new Set(fd.reviewCodes || [])}>
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
          <FRow code="1" provenance={gp('1')} label="Name (as per identification document)" value={fd.name} />
          <FRow code="2" provenance={gp('2')} label="Tax Identification No. (TIN)" value={fd.tin} />
          <FRow code="3" provenance={gp('3')} label="Identification no." value={fd.idNo} />
          <FRow code="4" provenance={gp('4')} label="Current passport no." value={fd.passportNo} />
          <FRow code="5" provenance={gp('5')} label="Passport no. registered with LHDNM" value={fd.passportNoLhdnm} />
        </FPart>

        <FPart code="A" title="Particulars of Individual">
          <FRow code="A1" provenance={gp('A1')} label="Citizen (country code)" value={fd.citizen} />
          <FRow code="A2" provenance={gp('A2')} label="Gender" value={fd.gender} />
          <FRow code="A3" provenance={gp('A3')} label="Date of birth" value={fd.dob} />
          <FRow code="A4" provenance={gp('A4')} label={`Status as at 31-12-${filingYear}`} value={fd.marital} />
          <FRow code="A5" provenance={gp('A5')} label="Date of marriage / divorce / demise" value={fd.maritalEventDate} />
          <FRow code="A6" provenance={gp('A6')} label="Record-keeping" value={fd.recordKeeping} />
          <FRow code="A7" provenance={gp('A7')} label="Type of assessment" value={fd.assessment} />
        </FPart>

        <FPart code="B" title="Computation of Income Tax">
          <FRow code="B1" provenance={gp('B1')}  label="Statutory income from sources of businesses in Malaysia" value={fmtAmt(fd.b1)} flatLabel />
          <FRow code="B1a" provenance={gp('B1a')} label="Number of businesses" value={String(fd.entityCount)} flatLabel />
          <FRow code="B2" provenance={gp('B2')}  label="Statutory income from sources of partnerships in Malaysia" value={fmtAmt(0)} flatLabel />
          <FRow code="B2a" provenance={gp('B2a')} label="Number of partnerships" value="—" flatLabel />
          <FRow code="B3" provenance={gp('B3')}  label="Aggregate statutory income from sources of business and partnership outside Malaysia received in Malaysia (Amount from E4)" value={fmtAmt(0)} flatLabel />
          <FRow code="B4" provenance={gp('B4')}  label="Aggregate statutory income from businesses ( B1 + B2 + B3 )" value={fmtAmt(fd.b4)} flatLabel />
          <FRow code="B5" provenance={gp('B5')}  label="LESS: Business losses brought forward (Restricted to B4)" value={fmtAmt(fd.b5)} flatLabel />
          <FRow code="B6" provenance={gp('B6')}  label="TOTAL ( B4 – B5 )" value={fmtAmt(fd.b6)} flatLabel />
          <FRow code="B7" provenance={gp('B7')}  label="Statutory income from sources of employment in Malaysia" value={fmtAmt(fd.b7)} flatLabel />
          <FRow code="B7a" provenance={gp('B7a')} label="Number of employment" value={fmtAmt(fd.b7aSuggestedCount ?? 0)} flatLabel />
          <FRow code="B8" provenance={gp('B8')}  label="Statutory income from sources of rents in Malaysia" value={fmtAmt(fd.b8)} flatLabel />
          <FRow code="B9" provenance={gp('B9')}  label="Statutory income from sources of interest, discounts, royalties, premiums, pensions, annuities, other periodical payments, other gains or profits and additions pursuant to paragraph 43(1)(c) in Malaysia" value={fmtAmt(fd.b9)} flatLabel />
          <FRow code="B10" provenance={gp('B10')} label="Aggregate of other statutory income from sources outside Malaysia received in Malaysia (Amount from F4)" value={fmtAmt(0)} flatLabel />
          <FRow code="B11" provenance={gp('B11')} label="AGGREGATE INCOME ( B6 + B7 + B8 + B9 + B10 )" value={fmtAmt(fd.b11)} strong highlight flatLabel />
          <FRow code="B12" provenance={gp('B12')} label="LESS: Approved investment under angel investor tax incentive (Restricted to B11)" value={fmtAmt(0)} flatLabel />
          <FRow code="B13" provenance={gp('B13')} label="TOTAL [ B11 – B12 ] (Enter '0' if value is negative)" value={fmtAmt(fd.b13)} flatLabel />
          <FRow code="B14" provenance={gp('B14')} label="LESS: Current year business losses (Restricted to B13)" value={fmtAmt(fd.b14)} flatLabel />
          <FRow code="B15" provenance={gp('B15')} label="TOTAL [ B13 – B14 ] (Enter '0' if value is negative)" value={fmtAmt(fd.b15)} flatLabel />
          <FRow code="B16" provenance={gp('B16')} label="LESS: Other expenses [Qualifying prospecting expenditure – Schedule 4] (Restricted to B15)" value={fmtAmt(0)} flatLabel />
          <FRow code="B17" provenance={gp('B17')} label="LESS: Approved donations / gifts / contributions (Amount from G8)" value={fmtAmt(fd.donationsG8)} flatLabel />
          <FRow code="B18" provenance={gp('B18')} label="TOTAL [ B15 – B16 – B17 ] (Enter '0' if value is negative)" value={fmtAmt(fd.b18)} flatLabel />
          <FRow code="B19" provenance={gp('B19')} label="TAXABLE PIONEER INCOME" value={fmtAmt(0)} flatLabel />
          <FRow code="B20" provenance={gp('B20')} label="TOTAL INCOME [SELF] ( B18 + B19 )" value={fmtAmt(fd.b20)} strong highlight flatLabel />

          {/* B21 — code column merges across both rows: row 1 is the main
              transferred-income total, row 2 is the income-type note.
              Custom layout (not FRow) since the code column spans two
              sub-rows, so its dots are wired in manually here instead of
              through FRow's own rendering. B21 is always a real number
              (0 for most filers, who aren't on joint assessment at all) —
              never a blank dash — so only the explicit backend flag
              (gender-ambiguity on joint assessment) can trigger review
              here, not the generic blank-value check FRow uses. */}
          <B21Row fd={fd} />
          <FRow code="B22" provenance={gp('B22')} label="AGGREGATE OF TOTAL INCOME ( B20 + B21 )" value={fmtAmt(fd.b22)} strong highlight flatLabel />
          <FRow code="B23" provenance={gp('B23')} label="Total relief (Amount from H22)" value={fmtAmt(fd.b23)} flatLabel />
          <FRow code="B24" provenance={gp('B24')} label="CHARGEABLE INCOME [ ( B20 – B23 ) or ( B22 – B23 ) ] (Enter '0' if value is negative)" value={fmtAmt(fd.b24)} highlight flatLabel />

          <FRow code="B25a" provenance={gp('B25a')} label={`Tax on the first RM${fmtAmt(fd.b25aLowerBoundMyr)}`} value={fmtAmt(fd.b25aTaxMyr)} flatLabel />
          <FRow code="B25b" provenance={gp('B25b')} label={`Tax on the balance RM${fmtAmt(fd.b25bAmountMyr)}, at rate ${fd.b25bRatePct}%`} value={fmtAmt(fd.b25bTaxMyr)} flatLabel />
          <FRow code="B26" provenance={gp('B26')} label="TOTAL INCOME TAX ( B25a + B25b )" value={fmtAmt(fd.b26)} strong highlight flatLabel />
          <FRow code="B27i" provenance={gp('B27i')}   label="Rebate — Self" value={fmtAmt(fd.lowIncomeRebate)} flatLabel />
          <FRow code="B27ii" provenance={gp('B27ii')}  label="Rebate — Husband / Wife" value={fmtAmt(fd.spouseRebate)} flatLabel />
          <FRow code="B27iii" provenance={gp('B27iii')} label="Rebate — Departure levy for umrah travel / religious travel for other religions (Restricted to 2 trips in a lifetime)" value={fmtAmt(fd.departureLevyRebate)} flatLabel />
          <FRow code="B27iv" provenance={gp('B27iv')}  label="Rebate — No. of trips" value={fd.departureLevyTripsThisYear != null ? String(fd.departureLevyTripsThisYear) : '—'} flatLabel />
          <FRow code="B27v" provenance={gp('B27v')}   label="Rebate — Zakat and fitrah" value={fmtAmt(fd.zakatRebate)} flatLabel />
          <FRow code="B27" provenance={gp('B27')}    label="TOTAL REBATE" value={fmtAmt(fd.b27)} flatLabel />
          <FRow code="B28" provenance={gp('B28')} label="TOTAL TAX CHARGED (B26 − B27) (Enter '0' if value is negative)" value={fmtAmt(fd.b28)} strong highlight flatLabel />
          <FRow code="B29" provenance={gp('B29')} label="LESS: Section 110 tax deduction (others)" value={fmtAmt(fd.b29)} flatLabel />
          <FRow code="B30i" provenance={gp('B30i')}  label="LESS: Section 132 tax relief (Restricted to B28)" value={fmtAmt(0)} flatLabel />
          <FRow code="B30ii" provenance={gp('B30ii')} label="LESS: Section 133 tax relief (Restricted to B28)" value={fmtAmt(0)} flatLabel />
          <FRow code="B30" provenance={gp('B30')}   label="TOTAL Section 132 / 133 tax relief" value={fmtAmt(0)} flatLabel />
          <FRow code="B31" provenance={gp('B31')} label="TAX PAYABLE [B28 − (B29 + B30)]" value={fmtAmt(fd.b31)} highlight flatLabel />
          <FRow code="B32" provenance={gp('B32')} label="OR: TAX REPAYABLE [(B29 + B30) − B28]" value={fmtAmt(fd.b32)} flatLabel />
          <FRow code="B33i" provenance={gp('B33i')}   label="Payment made — Monthly Tax Deductions (MTD)" value={fmtAmt(fd.mtdWithheld)} flatLabel />
          <FRow code="B33ii" provenance={gp('B33ii')}  label="Payment made — Section 107D" value={fmtAmt(fd.section107d)} flatLabel />
          <FRow code="B33iii" provenance={gp('B33iii')} label="Payment made — Self installments / CP500" value={fmtAmt(fd.cp500Paid)} flatLabel />
          <FRow code="B33" provenance={gp('B33')}    label={`Payment made for ${filingYear} income – SELF and HUSBAND / WIFE for joint assessment`} value={fmtAmt(fd.b33)} flatLabel />
          <FRow code="B34" provenance={gp('B34')} label="Balance of tax payable (B31 − B33) / Tax paid in excess (B33 − B31)" value={fmtAmt(Math.abs(fd.b34))} highlight flatLabel />
        </FPart>

        <FPart code="C" title="Particulars of Husband / Wife">
          <FRow code="C1" provenance={gp('C1')} label="Name of husband / wife (as per identification document)" value={fd.spouseName} />
          <FRow code="C2" provenance={gp('C2')} label="Identification no." value={fd.spouseIdNo} />
          <FRow code="C3" provenance={gp('C3')} label="Date of birth" value={fd.spouseDob} />
          <FRow code="C4" provenance={gp('C4')} label="Passport no." value={fd.spousePassportNo} />
        </FPart>

        <FPart code="D" title="Other Particulars">
          <FRow code="D1" provenance={gp('D1')} label="Telephone no. / Handphone no." value={fd.phone} flatLabel />
          <FRow code="D2" provenance={gp('D2')} label="E-mail" value={fd.email} flatLabel />
          <FRow code="D3" label="Employer's TIN" value={fd.employerTin} provenance={fd.employerTinProvenance} flatLabel />
          <FRow code="D4" provenance={gp('D4')} label="Tax borne by employer" value={fd.taxBorneByEmployer} flatLabel />
          <FRow code="D5" provenance={gp('D5')} label="Financial account(s) outside Malaysia" value={fd.hasForeignAccounts} flatLabel />
          <FRow code="D6a" provenance={gp('D6a')} label="Carries on e-Commerce" value={fd.carriesOnEcommerce} flatLabel />
          <FRow code="D6b" provenance={gp('D6b')} label="e-Commerce business model" value={fd.ecommerceModel} flatLabel />
          <FRow code="D7" provenance={gp('D7')} label="Address of business premise" value={fd.businessAddress} flatLabel />
          <FRow code="D8" provenance={gp('D8')} label="Correspondence address" value={fd.correspondenceAddress} flatLabel />
          <FRow code="D9" provenance={gp('D9')} label="Method of payment for tax refund" value={fd.refundMethod} flatLabel />
          <FRow code="D10a" provenance={gp('D10a')} label="Name of bank" value={fd.bankName} flatLabel />
          <FRow code="D10b" provenance={gp('D10b')} label="Bank account no." value={fd.bankAccountNo} flatLabel />
          <FRow code="D11a" provenance={gp('D11a')} label="DuitNow — identification type (self)" value={fd.duitnowIdType} flatLabel />
          <FRow code="D11b" provenance={gp('D11b')} label="DuitNow — passport no. (if applicable)" value={fd.duitnowPassportNo} flatLabel />
          <FRow code="D12a" provenance={gp('D12a')} label="Disposal of asset under the Real Property Gains Tax Act 1976" value={fd.rpgtDisposal} flatLabel />
          <FRow code="D12b" provenance={gp('D12b')} label="Disposal declared to LHDNM" value={fd.disposalDeclared} flatLabel />
        </FPart>

        <FPart code="E" title="Statutory Income — Business(es) and Partnership(s) Outside Malaysia Received in Malaysia">
          <div data-pdf-row="true" className="flex items-center text-[9px] font-semibold uppercase tracking-wide text-[#64748B] bg-[#F8FAFC]">
            <div className="w-14 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1">No.</div>
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
              <div className="w-14 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">{code}</div>
              <div className="flex-[2] border-r border-[#EDF1F5] px-2 py-1">{identification}</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="flex-1 px-2 py-1 text-right tabular-nums">—</div>
            </div>
          ))}
          <FRow code="E4" provenance={gp('E4')} label="TOTAL (Transfer this amount to item B3)" value={fmtAmt(0)} flatLabel />
        </FPart>

        <FPart code="F" title="Other Statutory Income From Outside Malaysia Received in Malaysia">
          <div data-pdf-row="true" className="flex items-center text-[9px] font-semibold uppercase tracking-wide text-[#64748B] bg-[#F8FAFC]">
            <div className="w-14 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1">No.</div>
            <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">Country (use country code)</div>
            <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">Business code</div>
            <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">Type of income*</div>
            <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1 text-right">Amount of tax charged in the country of origin (RM)</div>
            <div className="flex-1 px-2 py-1 text-right">Statutory income (RM)</div>
          </div>
          {['F1', 'F2', 'F3'].map((code) => (
            <div key={code} data-pdf-row="true" className="flex items-center text-[10px] text-[#334155]">
              <div className="w-14 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">{code}</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1">—</div>
              <div className="flex-1 border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">—</div>
              <div className="flex-1 px-2 py-1 text-right tabular-nums">—</div>
            </div>
          ))}
          <FRow code="F4" provenance={gp('F4')} label="TOTAL (Transfer this amount to item B10)" value={fmtAmt(0)} flatLabel />
        </FPart>

        <FPart code="G" title="Donations / Gifts / Contributions">
          <FRow code="G1" provenance={gp('G1')}  label="Gift of money to the Government / State Government / local authority" value={fmtAmt(fd.g1)} flatLabel />
          <FRow code="G2a" provenance={gp('G2a')} label="Gift of money to approved institutions / organisations / funds" value={fmtAmt(fd.g2a)} flatLabel />
          <FRow code="G2b" provenance={gp('G2b')} label="Gift of money for any sports activity approved by the Minister of Finance" value={fmtAmt(fd.g2b)} flatLabel />
          <FRow code="G2c" provenance={gp('G2c')} label="Gift of money or cost of contribution in kind for any project of national interest approved by the Minister of Finance" value={fmtAmt(fd.g2c)} flatLabel />
          <FRow code="G2d" provenance={gp('G2d')} label="Gift of money in the form of wakaf to religious authority / religious body / public university, or gift of money in the form of endowment to public university" value={fmtAmt(fd.g2d)} flatLabel />
          <FRow code="G2" provenance={gp('G2')}  label="Subtotal G2 (restricted to 10% of B11)" value={fmtAmt(fd.g2)} flatLabel />
          <FRow code="G3" provenance={gp('G3')}  label="Gift of artefacts / manuscripts / paintings to the Government or State Government" value={fmtAmt(fd.g3)} flatLabel />
          <FRow code="G4" provenance={gp('G4')}  label="Gift of money for the provision of library facilities or to libraries (restricted to 20,000)" value={fmtAmt(fd.g4)} flatLabel />
          <FRow code="G5" provenance={gp('G5')}  label="Gift of money or contribution in kind for the provision of facilities in public places for the benefit of disabled persons" value={fmtAmt(fd.g5)} flatLabel />
          <FRow code="G6" provenance={gp('G6')}  label="Gift of money / cost / value of gift of medical equipment to any healthcare facility approved by the Ministry of Health (restricted to 20,000)" value={fmtAmt(fd.g6)} flatLabel />
          <FRow code="G7" provenance={gp('G7')}  label="Gift of paintings to the National Art Gallery or any state art gallery" value={fmtAmt(fd.g7)} flatLabel />
          <FRow code="G8" provenance={gp('G8')}  label="Total approved donations / gifts / contributions [G1 to G7] (Transfer this amount to B17)" value={fmtAmt(fd.donationsG8)} highlight flatLabel />
        </FPart>

        <FPart code="H" title="Relief">
          <FRow code="H1" provenance={gp('H1')} label="Individual and dependent relatives (automatic)" value={fmtAmt(fd.reliefByCode.H1 ?? 0)} flatLabel />
          <FRow code="H2i" provenance={gp('H2i')}  label="Expenses for parents — medical, dental treatment, special needs or carer" value={hv('H2i')} flatLabel />
          <FRow code="H2ii" provenance={gp('H2ii')} label="Expenses for parents — complete medical examination (restricted to 1,000)" value={hv('H2ii')} flatLabel />
          <FRow code="H2" provenance={gp('H2')} label="Subtotal H2 (restricted to 8,000)" value={fmtAmt((fd.reliefByCode.H2i || 0) + (fd.reliefByCode.H2ii || 0))} flatLabel />
          <FRow code="H3" provenance={gp('H3')} label="Basic supporting equipment for disabled self, spouse, child or parent (restricted to 6,000)" value={hv('H3')} flatLabel />
          <FRow code="H4" provenance={gp('H4')} label="Disabled individual (6,000)" value={hv('H4')} flatLabel />
          <FRow code="H5i" provenance={gp('H5i')}   label="Education fees — other than degree at masters/doctorate level" value={hv('H5i')} flatLabel />
          <FRow code="H5ii" provenance={gp('H5ii')}  label="Education fees — degree at masters or doctorate level, any course" value={hv('H5ii')} flatLabel />
          <FRow code="H5iii" provenance={gp('H5iii')} label="Education fees — upskilling / self-enhancement (restricted to 2,000)" value={hv('H5iii')} flatLabel />
          <FRow code="H5" provenance={gp('H5')} label="Subtotal H5 (restricted to 7,000)" value={fmtAmt((fd.reliefByCode.H5i || 0) + (fd.reliefByCode.H5ii || 0) + (fd.reliefByCode.H5iii || 0))} flatLabel />
          <FRow code="H6i" provenance={gp('H6i')}   label="Medical expenses — serious diseases for self, spouse or child" value={hv('H6i')} flatLabel />
          <FRow code="H6ii" provenance={gp('H6ii')}  label="Medical expenses — fertility treatment for self or spouse" value={hv('H6ii')} flatLabel />
          <FRow code="H6iii" provenance={gp('H6iii')} label="Medical expenses — vaccination (restricted to 1,000)" value={hv('H6iii')} flatLabel />
          <FRow code="H6iv" provenance={gp('H6iv')}  label="Medical expenses — dental examination and treatment" value={hv('H6iv')} flatLabel />
          <FRow code="H6" provenance={gp('H6')} label="Subtotal H6 (restricted to 10,000 combined with H7 and H8)" value={fmtAmt((fd.reliefByCode.H6i || 0) + (fd.reliefByCode.H6ii || 0) + (fd.reliefByCode.H6iii || 0) + (fd.reliefByCode.H6iv || 0))} flatLabel />
          <FRow code="H7i" provenance={gp('H7i')}   label="Complete medical examination for self, spouse or child" value={hv('H7i')} flatLabel />
          <FRow code="H7ii" provenance={gp('H7ii')}  label="COVID-19 detection test / self-detection test kit" value={hv('H7ii')} flatLabel />
          <FRow code="H7iii" provenance={gp('H7iii')} label="Mental health examination or consultation" value={hv('H7iii')} flatLabel />
          <FRow code="H7" provenance={gp('H7')} label="Subtotal H7 (restricted to 1,000, combined with H6 and H8)" value={fmtAmt((fd.reliefByCode.H7i || 0) + (fd.reliefByCode.H7ii || 0) + (fd.reliefByCode.H7iii || 0))} flatLabel />
          <FRow code="H8i" provenance={gp('H8i')}  label="Assessment for diagnosis of learning disability (child ≤18)" value={hv('H8i')} flatLabel />
          <FRow code="H8ii" provenance={gp('H8ii')} label="Early intervention / rehabilitation for learning disability" value={hv('H8ii')} flatLabel />
          <FRow code="H8" provenance={gp('H8')} label="Subtotal H8 (restricted to 4,000, combined with H6 and H7)" value={fmtAmt((fd.reliefByCode.H8i || 0) + (fd.reliefByCode.H8ii || 0))} flatLabel />
          <FRow code="H9i" provenance={gp('H9i')} label="Lifestyle — books, journals, magazines, newspapers" value={hv('H9i')} flatLabel />
          <FRow code="H9ii" provenance={gp('H9ii')} label="Lifestyle — personal computer, smartphone or tablet" value={hv('H9ii')} flatLabel />
          <FRow code="H9iii" provenance={gp('H9iii')} label="Lifestyle — internet subscription" value={hv('H9iii')} flatLabel />
          <FRow code="H9iv" provenance={gp('H9iv')} label="Lifestyle — personal enrichment / hobby course (other than H5(iii))" value={hv('H9iv')} flatLabel />
          <FRow code="H9" provenance={gp('H9')} label="Subtotal H9 (restricted to 2,500)" value={fmtAmt((fd.reliefByCode.H9i || 0) + (fd.reliefByCode.H9ii || 0) + (fd.reliefByCode.H9iii || 0) + (fd.reliefByCode.H9iv || 0))} flatLabel />
          <FRow code="H10i" provenance={gp('H10i')} label="Sports — equipment purchase" value={hv('H10i')} flatLabel />
          <FRow code="H10ii" provenance={gp('H10ii')} label="Sports — facility rental / entrance fee" value={hv('H10ii')} flatLabel />
          <FRow code="H10iii" provenance={gp('H10iii')} label="Sports — competition registration fee" value={hv('H10iii')} flatLabel />
          <FRow code="H10iv" provenance={gp('H10iv')} label="Sports — gym membership / sports training fee" value={hv('H10iv')} flatLabel />
          <FRow code="H10" provenance={gp('H10')} label="Subtotal H10 (restricted to 1,000)" value={fmtAmt((fd.reliefByCode.H10i || 0) + (fd.reliefByCode.H10ii || 0) + (fd.reliefByCode.H10iii || 0) + (fd.reliefByCode.H10iv || 0))} flatLabel />
          <FRow code="H11" provenance={gp('H11')} label="Breastfeeding equipment, child ≤2 years, once per 2 YAs (restricted to 1,000)" value={hv('H11')} flatLabel />
          <FRow code="H12" provenance={gp('H12')} label="Child care fees — registered centre/kindergarten, child ≤6 (restricted to 3,000)" value={hv('H12')} flatLabel />
          <FRow code="H13" provenance={gp('H13')} label="Net SSPN deposit (restricted to 8,000)" value={hv('H13')} flatLabel />
          <FRow code="H14" provenance={gp('H14')} label="Husband / wife / alimony to former wife (restricted to 4,000)" value={hv('H14')} flatLabel />
          <FRow code="H15" provenance={gp('H15')} label="Disabled husband / wife (5,000)" value={hv('H15')} flatLabel />
          <FRow code="H16a" provenance={gp('H16a')} label="Child — under 18 years (2,000 each)" value={hv('H16a')} flatLabel />
          <FRow code="H16b" provenance={gp('H16b')} label="Child — 18+ and studying (2,000 / 8,000 tiered)" value={hv('H16b')} flatLabel />
          <FRow code="H16c" provenance={gp('H16c')} label="Child — disabled (6,000 / 14,000 tiered)" value={hv('H16c')} flatLabel />
          {fd.reliefByCode.H16 != null && (
            <FRow label="⚠ Child-relief documents on file, not yet split into H16a/b/c (see Data Coverage)" value={hv('H16')} flatLabel />
          )}
          <FRow code="H17i" provenance={gp('H17i')}  label="Life insurance premium / EPF voluntary contribution (restricted to 3,000)" value={hv('H17i')} flatLabel />
          <FRow code="H17ii" provenance={gp('H17ii')} label="EPF (voluntary or compulsory) / approved scheme (restricted to 4,000)" value={hv('H17ii')} flatLabel />
          <FRow code="H17" provenance={gp('H17')} label="Subtotal H17 (restricted to 7,000)" value={fmtAmt((fd.reliefByCode.H17i || 0) + (fd.reliefByCode.H17ii || 0))} flatLabel />
          <FRow code="H18" provenance={gp('H18')} label="Private retirement scheme and deferred annuity (restricted to 3,000)" value={hv('H18')} flatLabel />
          <FRow code="H19" provenance={gp('H19')} label="Education and medical insurance (restricted to 3,000)" value={hv('H19')} flatLabel />
          <FRow code="H20" provenance={gp('H20')} label="SOCSO / EIS contribution (restricted to 350)" value={hv('H20')} flatLabel />
          <FRow code="H21" provenance={gp('H21')} label="EV charging equipment/installation, not for business use (restricted to 2,500)" value={hv('H21')} flatLabel />
          <FRow code="H22" provenance={gp('H22')} label="TOTAL RELIEF [H1 to H21] (transfer to B23)" value={fmtAmt(fd.reliefTotal)} highlight flatLabel />
        </FPart>

        <FPart code="J" title="Incentive Claim">
          <PartJClaimTable
            code="J1"
            title="Claim Special Deduction(s) / Further Deduction(s) / Double Deduction(s) / Incentive(s) under paragraph 127(3)(b) of Income Tax Act 1967"
            firstColLabel="Claim Code"
          />
          <PartJClaimTable
            code="J2"
            title="Claim for incentive(s) under subsection 127(3A) of Income Tax Act 1967"
            firstColLabel="Incentive Approval No."
          />
        </FPart>

        <FPart code="K" title="Non-Employment Income of Preceding Years Not Declared">
          <div data-pdf-row="true" className="items-center grid grid-cols-[56px_repeat(3,minmax(0,1fr))] text-[9px] font-semibold uppercase tracking-wide text-[#64748B] bg-[#F8FAFC]">
            <div className="col-span-2 border-r border-[#EDF1F5] px-2 py-1">Type of Income</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">Year of Assessment</div>
            <div className="px-2 py-1">Amount (RM)</div>
          </div>
          {(fd.kDisclosures && fd.kDisclosures.length ? fd.kDisclosures : [null, null]).slice(0, 2).map((disclosure, i) => (
            <div key={disclosure?.documentId ?? `K${i + 1}`} data-pdf-row="true" className="items-center grid grid-cols-[56px_repeat(3,minmax(0,1fr))] text-[10px] text-[#334155]">
              <div className="border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">{`K${i + 1}`}</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1">{disclosure?.incomeType || '—'}</div>
              <div className="border-r border-[#EDF1F5] px-2 py-1">{disclosure?.disclosedYa || '—'}</div>
              <div className="px-2 py-1 text-right tabular-nums">{disclosure ? fmtAmt(disclosure.amountNumeric) : '—'}</div>
            </div>
          ))}
        </FPart>

        <FPart code="L" title="Tax Exempt Income From Sources Outside Malaysia Received in Malaysia">
          <div data-pdf-row="true" className="items-center grid grid-cols-[56px_repeat(7,minmax(0,1fr))] text-[9px] font-semibold uppercase tracking-wide text-[#64748B] bg-[#F8FAFC]">
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
            <div key={code} data-pdf-row="true" className="items-center grid grid-cols-[56px_repeat(7,minmax(0,1fr))] text-[10px] text-[#334155]">
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
          <div data-pdf-row="true" className="items-center grid grid-cols-[56px_repeat(7,minmax(0,1fr))] text-[10px] text-[#334155]">
            <div className="border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">L5</div>
            <div className="col-span-6 border-r border-[#EDF1F5] px-2 py-1">TOTAL</div>
            <div className="px-2 py-1 text-right tabular-nums">{fmtAmt(0)}</div>
          </div>
        </FPart>

        <FPart code="M" title="Particulars of Business Income (Losses)">
          <div data-pdf-row="true" className="flex items-center text-[10px] text-[#334155]">
            <div className="w-14 shrink-0 border-r border-[#EDF1F5] px-1.5 py-1 text-[#94A3B8] font-medium">M1</div>
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
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{fmtAmt(fd.currentYearBusinessLossRawMyr)}</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{fmtAmt(0)}</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{fmtAmt(fd.b14)}</div>
            <div className="px-2 py-1 text-right tabular-nums">{fmtAmt(Math.max(0, fd.currentYearBusinessLossRawMyr - fd.b14))}</div>
          </div>

          <div data-pdf-row="true" className="bg-[#F1F5F9] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#475569]">
            Losses of Prior Years of Assessment
          </div>
          <div data-pdf-row="true" className="grid grid-rows-2 grid-cols-[minmax(90px,1.2fr)_repeat(8,minmax(0,1fr))] text-[9px] font-semibold text-[#64748B] bg-[#F8FAFC]">
            <div className="row-span-2 flex items-center border-r border-b border-[#EDF1F5] px-2 py-1">Year of assessment in which losses are incurred</div>
            <div className="row-span-2 flex items-center border-r border-b border-[#EDF1F5] px-2 py-1">(e) Original amount of losses in the YA first incurred</div>
            <div className="col-span-3 border-r border-b border-[#EDF1F5] px-2 py-1 text-center">Unabsorbed losses position at the beginning of the current year of assessment</div>
            <div className="col-span-3 border-r border-b border-[#EDF1F5] px-2 py-1 text-center">Losses absorbed / Disregarded in the current year of assessment</div>
            <div className="row-span-2 flex items-center border-b border-[#EDF1F5] px-2 py-1">(n) Balance carried forward (n = h − j − k − m)</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(f) Amount absorbed from tax exempt income of pioneer business</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(g) Amount absorbed (accumulated)</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(h) Balance unabsorbed (h = e − f − g)</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(j) Amount disregarded under s.44(5F)</div>
            <div className="border-r border-[#EDF1F5] px-2 py-1">(k) Amount disregarded under s.25(5) PIA 1986</div>
            <div className="px-2 py-1">(m) Amount absorbed</div>
          </div>
          {(() => {
            // Always the 5 YAs immediately before the current filing year,
            // plus an "and before" catch-all for the 6th (oldest) row — so
            // this stays correct as filingYear rolls forward each year
            // rather than drifting out of date like a hardcoded list would.
            const oldestCutoff = filingYear - 6;
            const vintages = fd.businessLossVintages || [];
            const rowFor = (yr, isOldestBucket) => {
              const matches = isOldestBucket
                ? vintages.filter((v) => v.yearArose <= oldestCutoff)
                : vintages.filter((v) => v.yearArose === Number(yr));
              if (matches.length === 0) return null;
              const sum = (key) => matches.reduce((s, v) => s + (Number(v[key]) || 0), 0);
              return { original: sum('originalMyr'), absorbed: sum('absorbedMyr'), remaining: sum('remainingMyr') };
            };
            const priorYears = [
              `${oldestCutoff} and before`,
              ...Array.from({ length: 5 }, (_, i) => String(oldestCutoff + 1 + i)),
            ];
            return priorYears.map((yr, i) => {
              const row = rowFor(i === 0 ? oldestCutoff : yr, i === 0);
              return (
              <div key={yr} data-pdf-row="true" className="items-center grid grid-cols-[minmax(90px,1.2fr)_repeat(8,minmax(0,1fr))] text-[10px] text-[#334155]">
                <div className="border-r border-[#EDF1F5] px-2 py-1 text-[#94A3B8] font-medium">{yr}</div>
                <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{row ? fmtAmt(row.original) : '—'}</div>
                <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{row ? fmtAmt(0) : '—'}</div>
                <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{row ? fmtAmt(row.absorbed) : '—'}</div>
                <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{row ? fmtAmt(row.remaining) : '—'}</div>
                <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{row ? fmtAmt(0) : '—'}</div>
                <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{row ? fmtAmt(0) : '—'}</div>
                <div className="border-r border-[#EDF1F5] px-2 py-1 text-right tabular-nums">{row ? fmtAmt(0) : '—'}</div>
                <div className="px-2 py-1 text-right tabular-nums">{row ? fmtAmt(row.remaining) : '—'}</div>
              </div>
              );
            });
          })()}

          <FRow code="M2" provenance={gp('M2')} label="Business capital allowances carried forward" value={fmtAmt(fd.m2UnabsorbedCapitalAllowanceMyr)} />
          <FRow code="M3" provenance={gp('M3')} label="Partnership capital allowances carried forward" value={fmtAmt(0)} />
        </FPart>

        <FPart code="N" title={`Financial Particulars of Individual (Main Business Only)${fd.entityCount > 1 ? ` — ${fd.businessName}, main of ${fd.entityCount} businesses (see B1 for the combined total)` : ''}`}>
          <FRow code="N1" provenance={gp('N1')} label="Name of business" value={fd.businessName} flatLabel />
          <FRow code="N1a" provenance={gp('N1a')} label="Registration no." value={fd.businessRegNo} flatLabel />
          <FRow code="N2" provenance={gp('N2')} label="Business code" value={fd.businessCode} flatLabel />
          <FRow code="N2a" provenance={gp('N2a')} label="Type of business activity" value={fd.businessActivity} flatLabel />

          <div className="bg-[#F1F5F9] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#475569]">Statement of Profit or Loss</div>
          <FRow code="N3" provenance={gp('N3')}  label="Sales or turnover" value={fmtAmt(fd.n3)} flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Less:</div>
          <FRow code="N4" provenance={gp('N4')}  label="Opening inventory" value={fmtAmt(fd.n4)} flatLabel />
          <FRow code="N5" provenance={gp('N5')}  label="Purchases and cost of production" value={fmtAmt(fd.n5)} flatLabel />
          <FRow code="N6" provenance={gp('N6')}  label="Closing inventory" value={fmtAmt(fd.n6)} flatLabel />
          <FRow code="N7" provenance={gp('N7')}  label="Cost of sales (N4 + N5 − N6)" value={fmtAmt(fd.n7)} flatLabel />
          <FRow code="N8" provenance={gp('N8')}  label="GROSS PROFIT / LOSS (N3 − N7)" value={fmtAmt(fd.n8)} strong flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Other income:</div>
          <FRow code="N9" provenance={gp('N9')}  label="Other business(es)" value={fmtAmt(fd.n9)} flatLabel />
          <FRow code="N10" provenance={gp('N10')} label="Dividends" value={fmtAmt(fd.n10)} flatLabel />
          <FRow code="N11" provenance={gp('N11')} label="Interest and discounts" value={fmtAmt(fd.n11)} flatLabel />
          <FRow code="N12" provenance={gp('N12')} label="Rents, royalties and premiums" value={fmtAmt(fd.n12)} flatLabel />
          <FRow code="N13" provenance={gp('N13')} label="Other income" value={fmtAmt(fd.n13)} flatLabel />
          <FRow code="N14" provenance={gp('N14')} label="TOTAL (N9 to N13)" value={fmtAmt(fd.n14)} strong flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Expenses:</div>
          <FRow code="N15" provenance={gp('N15')} label="Loan interest" value={fmtAmt(fd.n15)} flatLabel />
          <FRow code="N16" provenance={gp('N16')} label="Salaries and wages" value={fmtAmt(fd.n16)} flatLabel />
          <FRow code="N17" provenance={gp('N17')} label="Rental / lease" value={fmtAmt(fd.n17)} flatLabel />
          <FRow code="N18" provenance={gp('N18')} label="Contract and subcontracts" value={fmtAmt(fd.n18)} flatLabel />
          <FRow code="N19" provenance={gp('N19')} label="Commissions" value={fmtAmt(fd.n19)} flatLabel />
          <FRow code="N20" provenance={gp('N20')} label="Bad debts" value={fmtAmt(fd.n20)} flatLabel />
          <FRow code="N21" provenance={gp('N21')} label="Travelling and transport" value={fmtAmt(fd.n21)} flatLabel />
          <FRow code="N22" provenance={gp('N22')} label="Repairs and maintenance" value={fmtAmt(fd.n22)} flatLabel />
          <FRow code="N23" provenance={gp('N23')} label="Promotion and advertisement" value={fmtAmt(fd.n23)} flatLabel />
          <FRow code="N24" provenance={gp('N24')} label="Other expenses" value={fmtAmt(fd.n24)} flatLabel />
          <FRow code="N25" provenance={gp('N25')} label="TOTAL EXPENDITURE (N15 to N24)" value={fmtAmt(fd.n25)} strong flatLabel />
          <FRow code="N26" provenance={gp('N26')} label="NET PROFIT / LOSS" value={fmtAmt(fd.n26)} highlight flatLabel />
          <FRow code="N27" provenance={gp('N27')} label="Non-allowable expenses (apportioned/disallowed portion)" value={fmtAmt(fd.n27)} flatLabel />
          <FRow label="LESS: Capital allowance (Schedule 3, current-year IA+AA)" value={fmtAmt(fd.capitalAllowance)} flatLabel />

          <div className="bg-[#F1F5F9] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#475569]">Statement of Financial Position</div>
          {/* Phase 6 (14 Jul 2026): populated from an uploaded Balance Sheet's
              structured extraction (FinancialStatementProfile) when present.
              Genuinely blank (not just 0) until a Balance Sheet is uploaded —
              see fd.hasBalanceSheet and the dataGap this drives. */}
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Non-current assets:</div>
          <FRow code="N28" provenance={gp('N28')} label="Land and buildings" value={fd.hasBalanceSheet ? fmtAmt(fd.n28) : '—'} flatLabel />
          <FRow code="N29" provenance={gp('N29')} label="Plant and machinery" value={fd.hasBalanceSheet ? fmtAmt(fd.n29) : '—'} flatLabel />
          <FRow code="N30" provenance={gp('N30')} label="Motor vehicles" value={fd.hasBalanceSheet ? fmtAmt(fd.n30) : '—'} flatLabel />
          <FRow code="N31" provenance={gp('N31')} label="Other non-current assets" value={fd.hasBalanceSheet ? fmtAmt(fd.n31) : '—'} flatLabel />
          <FRow code="N32" provenance={gp('N32')} label="TOTAL NON-CURRENT ASSETS (N28 to N31)" value={fd.hasBalanceSheet ? fmtAmt(fd.n32) : '—'} strong flatLabel />
          <FRow code="N33" provenance={gp('N33')} label="Investments" value={fd.hasBalanceSheet ? fmtAmt(fd.n33) : '—'} flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Current assets:</div>
          <FRow code="N34" provenance={gp('N34')} label="Inventory" value={fd.hasBalanceSheet ? fmtAmt(fd.n34) : '—'} flatLabel />
          <FRow code="N35" provenance={gp('N35')} label="Trade debtors" value={fd.hasBalanceSheet ? fmtAmt(fd.n35) : '—'} flatLabel />
          <FRow code="N36" provenance={gp('N36')} label="Sundry debtors" value={fd.hasBalanceSheet ? fmtAmt(fd.n36) : '—'} flatLabel />
          <FRow code="N37" provenance={gp('N37')} label="Cash in hand" value={fd.hasBalanceSheet ? fmtAmt(fd.n37) : '—'} flatLabel />
          <FRow code="N38" provenance={gp('N38')} label="Cash at bank" value={fd.hasBalanceSheet ? fmtAmt(fd.n38) : '—'} flatLabel />
          <FRow code="N39" provenance={gp('N39')} label="Other current assets" value={fd.hasBalanceSheet ? fmtAmt(fd.n39) : '—'} flatLabel />
          <FRow code="N40" provenance={gp('N40')} label="TOTAL CURRENT ASSETS (N34 to N39)" value={fd.hasBalanceSheet ? fmtAmt(fd.n40) : '—'} strong flatLabel />
          <FRow code="N41" provenance={gp('N41')} label="TOTAL ASSETS (N32 + N33 + N40)" value={fd.hasBalanceSheet ? fmtAmt(fd.n41) : '—'} highlight flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Liabilities:</div>
          <FRow code="N42" provenance={gp('N42')} label="Loans and overdrafts" value={fd.hasBalanceSheet ? fmtAmt(fd.n42) : '—'} flatLabel />
          <FRow code="N43" provenance={gp('N43')} label="Trade creditors" value={fd.hasBalanceSheet ? fmtAmt(fd.n43) : '—'} flatLabel />
          <FRow code="N44" provenance={gp('N44')} label="Sundry creditors" value={fd.hasBalanceSheet ? fmtAmt(fd.n44) : '—'} flatLabel />
          <FRow code="N45" provenance={gp('N45')} label="TOTAL LIABILITIES (N42 to N44)" value={fd.hasBalanceSheet ? fmtAmt(fd.n45) : '—'} strong flatLabel />
          <div className="bg-[#FAFBFC] px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-[#94A3B8]">Owner's equity:</div>
          <FRow code="N46" provenance={gp('N46')} label="Capital account" value={fd.hasBalanceSheet ? fmtAmt(fd.n46) : '—'} flatLabel />
          <FRow code="N47" provenance={gp('N47')} label="Current account balance brought forward" value={fd.hasBalanceSheet ? fmtAmt(fd.n47) : '—'} flatLabel />
          <FRow code="N48" provenance={gp('N48')} label="Current year profit / loss" value={fd.hasBalanceSheet ? fmtAmt(fd.n48) : '—'} flatLabel />
          <FRow code="N49" provenance={gp('N49')} label="Drawings / advance (Net)" value={fd.hasBalanceSheet ? fmtAmt(fd.n49) : '—'} flatLabel />
          <FRow code="N50" provenance={gp('N50')} label="Current account balance carried forward" value={fd.hasBalanceSheet ? fmtAmt(fd.n50) : '—'} strong flatLabel />
        </FPart>

        <div data-pdf-row="true" className="mt-3 border-2 border-[#0F172A] shadow-sm">
          <div className="bg-[#0F172A] px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-primary-hover">Declaration</div>
          <p className="px-2 py-2.5 text-[10px] leading-relaxed text-[#000000] bg-[#EFF6FF]">
            I, <span className="font-semibold">{fd.name}</span> (Identification no. {fd.idNo}), hereby declare that the information regarding the income and claim for deductions and reliefs given by me in this return form and in any document attached is true, correct and complete.
          </p>
        </div>

        {!embedded && (
          <p data-pdf-row="true" className="mt-3 text-[8px] text-[#94A3B8] text-center leading-relaxed">
            cukai.ai draft — for your own reference only, not an LHDN submission. Figures are drawn from your uploaded and classified documents, your capital allowance schedule, and your personal profile. Some sections (Parts E, F, J, K, L, M, and the balance sheet) are not yet populated — see the Data Coverage panel in the app for details. Verify every value and file the real return at mytax.hasil.gov.my.
          </p>
        )}
      </div>
    </div>
    </ReviewContext.Provider>
  );
};

// ─── Preview slide-over ────────────────────────────────────────────────────
// Mirrors CukaiAccount's DocumentPreview slide-over: a real PDF blob shown via
// <embed>, so the browser's own PDF viewer chrome is what the user sees — no
// custom zoom controls, and (since this isn't the browser print dialog) none
// of the print stylesheet's date/title/URL headers either.
function FormBPreview({ pdfUrl, pdfError, filingYear, onRetry, onClose }) {
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
          ) : pdfError ? (
            <div className="flex h-full items-center justify-center flex-col gap-3 p-8 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-critical-bg text-critical">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <p className="text-xs text-critical max-w-xs">{pdfError}</p>
              <button
                onClick={onRetry}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover transition-colors duration-150"
              >
                Try again
              </button>
            </div>
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

// ─── Review guide (formerly "Data Coverage") ──────────────────────────────────
// Full rewrite (16 Jul 2026): the old version showed formB.js's internal
// dataGaps list, translated through a hand-written copy table. That worked,
// but it was a SEPARATE signal from the "Review" badges actually shown on
// the form itself (FPart's own hasReview state) — so a person could see a
// Review badge on the form with no obvious explanation of what it meant, or
// see a Data Coverage item that didn't visibly correspond to anything.
//
// This version reads the EXACT SAME signal the badges use: after the
// embedded form renders, it scans for every `[data-review-dot="true"]`
// marker (the same one FPart itself queries for), and for each one found,
// walks up to the row's own id/label and its containing Part's code/title
// (via the `data-part-code`/`data-part-title` FPart now carries, and the
// `data-row-label` FRow now carries). The two can never drift apart, because
// there's only one signal now, read in two places.
//
// For WHY a row needs review, two cases:
//   - It's blank (no document/profile data yet) — by far the common case on
//     a fresh account. Framed as "add this" rather than "wrong".
//   - It's explicitly flagged by the backend (a genuine fact that can't be
//     confirmed automatically, e.g. a disposal's balancing figure, an
//     ambiguous multi-employer pick) — framed with the specific reason,
//     reusing the same hand-written copy from REVIEW_REASON_COPY below.
const REVIEW_REASON_COPY = {
  'D3 (employer\'s TIN)': 'We found an employer\u2019s TIN from your Form EA upload(s) — confirm it\u2019s the right one, or add one manually if you have outside employment.',
  'B21/B22 (joint assessment)': 'Confirm the income transferred from your spouse for joint assessment — gender and election details affect which return this appears on.',
  'G3, G5, G7 (donation valuations)': 'This donation type needs an official third-party valuation a receipt can\u2019t confirm on its own — check you have one on file.',
  'B7a (number of employments)': 'We estimated this from your Form EA uploads — worth a quick check if you changed jobs mid-year.',
  'H11 (breastfeeding equipment)': 'Confirm you\u2019re a breastfeeding mother claiming for your own child aged 2 or below — this can\u2019t be confirmed from the receipt alone.',
  'B27iii (departure levy)': 'This relief is capped at 2 trips in a lifetime, and we can only count trips we\u2019ve seen a document for — confirm this is genuinely within your allowance.',
  'Capital asset disposal(s)': 'An asset was disposed of this year — the figures shown are a standard-case estimate. Confirm with a tax agent if this was a related-party transfer.',
  'N ↔ B1 reconciliation': 'Your business figures in Part N don\u2019t quite add up to the total used elsewhere on the form — worth a look before filing.',
};

// Per-code guidance for BLANK rows — replaces the old single repeated
// sentence with something that actually explains (a) what this specific
// line is asking for, in plain language drawn from LHDN's own Explanatory
// Notes, and (b) exactly how to complete it: upload a document, or fill in
// a specific field in your profile. Covers every code realistically likely
// to ever show up blank in this panel; anything not listed falls back to
// PART_FALLBACK_GUIDANCE below rather than a blank/generic message.
const CODE_GUIDANCE = {
  // Basic Particulars (items 1-5, before Part A — this section has no
  // letter code of its own, which is exactly why these fell through to
  // the fully generic fallback before this fix).
  1: { text: 'Your full name, exactly as it appears on your identification document.', source: 'profile', howTo: 'Add this in Identity & Residency.' },
  2: { text: 'Your Tax Identification Number (TIN), issued by LHDN.', source: 'profile', howTo: 'Add this in Identity & Residency.' },
  3: { text: 'Your MyKad, army, or police identification number.', source: 'profile', howTo: 'Add this in Identity & Residency.' },
  4: { text: 'Your current passport number, if you have one.', source: 'profile', howTo: 'Add this in Identity & Residency.' },
  5: { text: 'Your PREVIOUS passport number, last filed with LHDN before your current one — not your current passport (that\u2019s item 4).', source: 'profile', howTo: 'Add this in Identity & Residency.' },
  // Part A — Basic Particulars (all profile fields)
  A1: { text: 'Your citizenship.', source: 'profile', howTo: 'Add this in Identity & Residency (enter "MYS" if Malaysian).' },
  A2: { text: 'Your gender — needed to correctly apply gender-specific rules like joint-assessment direction and spouse relief.', source: 'profile', howTo: 'Add this in Identity & Residency.' },
  A3: { text: 'Your date of birth — used for age-based reliefs.', source: 'profile', howTo: 'Add this in Identity & Residency.' },
  A4: { text: 'Your marital status as at 31 December.', source: 'profile', howTo: 'Add this in Marital Status & Dependents.' },
  A5: { text: 'The date of marriage, divorce, or demise — only needed if your status changed this year.', source: 'profile', howTo: 'Add this in Marital Status & Dependents if it applies to you.' },
  A6: { text: 'Whether you keep sufficient business records as required under the Income Tax Act 1967.', source: 'profile', howTo: 'Add this in Record Keeping.' },
  A7: { text: 'Your assessment election — joint, separate, or self.', source: 'profile', howTo: 'Add this in Marital Status & Dependents.' },
  // Part C — Particulars of Husband / Wife (profile, only relevant if married)
  C1: { text: 'Your spouse\u2019s name, as it appears on their identification document.', source: 'profile', howTo: 'Add this in Marital Status & Dependents.' },
  C2: { text: 'Your spouse\u2019s identification number.', source: 'profile', howTo: 'Add this in Marital Status & Dependents.' },
  C3: { text: 'Your spouse\u2019s date of birth.', source: 'profile', howTo: 'Add this in Marital Status & Dependents.' },
  C4: { text: 'Your spouse\u2019s passport number, if relevant.', source: 'profile', howTo: 'Add this in Marital Status & Dependents.' },
  // Part D — Other Particulars (mostly profile)
  D1: { text: 'A telephone number LHDN can reach you on.', source: 'profile', howTo: 'Add this in Contact & Correspondence.' },
  D2: { text: 'An email address — compulsory if you\u2019re filing through e-Filing.', source: 'profile', howTo: 'Add this in Contact & Correspondence.' },
  D4: { text: 'Whether your income tax is borne by your employer (a taxable perquisite under paragraph 13(1)(a)).', source: 'profile', howTo: 'Add this in Other Particulars.' },
  D6a: { text: 'Whether you carry on e-commerce business.', source: 'profile', howTo: 'Add this in Other Particulars.' },
  D6b: { text: 'Which e-commerce business model applies to you, if any.', source: 'profile', howTo: 'Add this in Other Particulars.' },
  D7: { text: 'The address of your main business premises.', source: 'profile', howTo: 'Add this in Business Premise.' },
  D8: { text: 'The address LHDN should correspond with you at.', source: 'profile', howTo: 'Add this in Contact & Correspondence.' },
  D9: { text: 'How you\u2019d like any tax refund paid — bank account or DuitNow.', source: 'profile', howTo: 'Add this in Other Particulars.' },
  D10a: { text: 'The bank your tax refund should be paid to.', source: 'profile', howTo: 'Add this in Other Particulars, under bank account details.' },
  D10b: { text: 'Your bank account number for tax refunds.', source: 'profile', howTo: 'Add this in Other Particulars, under bank account details.' },
  D11a: { text: 'Whether your DuitNow ID is registered with an IC or passport number.', source: 'profile', howTo: 'Add this in Other Particulars, under DuitNow details.' },
  D11b: { text: 'Your passport number, if your DuitNow ID uses one.', source: 'profile', howTo: 'Add this in Other Particulars, under DuitNow details.' },
  // Part G — Donations (all document/receipt-sourced)
  G1: { text: 'Donations to the Government, a State Government, or a local authority.', source: 'document', howTo: 'Upload the donation receipt.' },
  G2a: { text: 'Donations to an institution, organisation, or fund approved by the Director General.', source: 'document', howTo: 'Upload the donation receipt.' },
  G2b: { text: 'Donations for a sports activity approved by the Minister of Finance.', source: 'document', howTo: 'Upload the donation receipt.' },
  G2c: { text: 'Donations for a national-interest project approved by the Minister of Finance.', source: 'document', howTo: 'Upload the donation receipt.' },
  G2d: { text: 'Wakaf or endowment donations to a religious authority or public university.', source: 'document', howTo: 'Upload the donation receipt.' },
  G3: { text: 'Donated artefacts, manuscripts, or paintings to the Government — needs an official valuation from the Museums Department or National Archives.', source: 'document', howTo: 'Upload the donation receipt along with the official valuation.' },
  G4: { text: 'Donations for library facilities, up to RM20,000.', source: 'document', howTo: 'Upload the donation receipt.' },
  G5: { text: 'Money or goods donated for disabled-persons\u2019 facilities, valued by the local authority.', source: 'document', howTo: 'Upload the donation receipt or the local authority\u2019s valuation.' },
  G6: { text: 'Donated medical equipment to an approved healthcare facility, up to RM20,000.', source: 'document', howTo: 'Upload the donation receipt or the Ministry of Health\u2019s valuation.' },
  G7: { text: 'Donated paintings to the National Art Gallery or a state art gallery — needs an official valuation.', source: 'document', howTo: 'Upload the donation receipt along with the gallery\u2019s valuation.' },
  // Part H — Relief (mostly document; a few are profile toggles)
  H2: { text: 'Medical, dental, or carer expenses for your parents, up to RM8,000.', source: 'document', howTo: 'Upload the medical/dental/carer receipt.' },
  H3: { text: 'Basic supporting equipment for a disabled self, spouse, child, or parent registered with the Department of Social Welfare.', source: 'document', howTo: 'Upload the equipment purchase receipt.' },
  H4: { text: 'An additional relief if you are a disabled individual, certified by the Department of Social Welfare.', source: 'profile', howTo: 'Add this in Marital Status & Dependents.' },
  H5: { text: 'Your own education fees for an approved course.', source: 'document', howTo: 'Upload the tuition fee receipt.' },
  H6: { text: 'Medical expenses for serious disease, fertility treatment, vaccination, or dental care.', source: 'document', howTo: 'Upload the medical receipt.' },
  H7: { text: 'A complete medical examination, COVID-19 test, or mental health consultation.', source: 'document', howTo: 'Upload the medical receipt.' },
  H8: { text: 'Diagnosis, early intervention, or rehabilitation for a child\u2019s learning disability.', source: 'document', howTo: 'Upload the assessment or treatment receipt.' },
  H9: { text: 'Lifestyle expenses — books, a personal computer/phone/tablet, internet, or a self-enhancement course.', source: 'document', howTo: 'Upload the purchase receipt.' },
  H10: { text: 'Sports equipment, facility fees, or competition/gym fees under the Sports Development Act 1997.', source: 'document', howTo: 'Upload the receipt.' },
  H11: { text: 'Breastfeeding equipment for your own child aged 2 or below — allowed once every 2 years of assessment.', source: 'document', howTo: 'Upload the equipment purchase receipt.' },
  H12: { text: 'Registered childcare centre or kindergarten fees for a child aged 6 or below (or 7\u201312 from YA2026).', source: 'document', howTo: 'Upload the fee receipt.' },
  H13: { text: 'Net SSPN deposits (total deposited minus withdrawn) for your children\u2019s education.', source: 'document', howTo: 'Upload your SSPN statement.' },
  H14: { text: 'Relief for a spouse with no income, or alimony paid to a former wife.', source: 'profile', howTo: 'Add this in Marital Status & Dependents.' },
  H15: { text: 'An additional relief if your spouse is disabled, certified by the Department of Social Welfare.', source: 'profile', howTo: 'Add this in Marital Status & Dependents.' },
  H16a: { text: 'Relief for a child under 18.', source: 'profile', howTo: 'Add this child in Children (H16 relief).' },
  H16b: { text: 'Relief for a child 18 or above who is still studying full-time.', source: 'profile', howTo: 'Add this child in Children (H16 relief), and mark them as a full-time student.' },
  H16c: { text: 'Relief for a disabled child.', source: 'profile', howTo: 'Add this child in Children (H16 relief), and mark them as disabled.' },
  H17: { text: 'Life insurance premiums, takaful contributions, or voluntary EPF contributions.', source: 'document', howTo: 'Upload your insurance/EPF statement.' },
  H18: { text: 'Private Retirement Scheme contributions or deferred annuity premiums.', source: 'document', howTo: 'Upload your PRS/annuity statement.' },
  H19: { text: 'Education or medical insurance premiums.', source: 'document', howTo: 'Upload your insurance statement.' },
  H20: { text: 'SOCSO or Employment Insurance System contributions.', source: 'document', howTo: 'Upload your SOCSO/EIS statement.' },
  H21: { text: 'EV charging equipment, or (from YA2026) a food waste machine or home CCTV.', source: 'document', howTo: 'Upload the purchase/installation receipt.' },
  // Part K
  K: { text: 'Non-employment income from a PRIOR year of assessment that you\u2019re only now declaring.', source: 'document', howTo: 'Upload the relevant document.' },
  // Part N — Financial Particulars (business name/code is profile; the rest is document)
  N1: { text: 'The name of your main business.', source: 'profile', howTo: 'Add this in Business Particulars.' },
  N1a: { text: 'Your business registration number.', source: 'profile', howTo: 'Add this in Business Particulars.' },
  N2: { text: 'Your business code, from LHDN\u2019s list of business classifications.', source: 'profile', howTo: 'Add this in Business Particulars.' },
  N2a: { text: 'A short description of what your business actually does.', source: 'profile', howTo: 'Add this in Business Particulars.' },
};

// Codes not in CODE_GUIDANCE above still get a targeted-as-possible message,
// based on which Part they're in — better than one generic sentence, even
// without a hand-written entry for the exact code.
const PART_FALLBACK_GUIDANCE = {
  // Bug fix (16 Jul 2026): the "Basic Particulars" section (items 1-5) has
  // no letter code of its own — its rows' partCode resolves to the '—'
  // fallback used when no data-part-code is found at all, which had no
  // entry here either, so it fell all the way through to the fully
  // generic message. Covered individually in CODE_GUIDANCE above now, but
  // this stays as a safety net for anything not explicitly listed there.
  '—': { text: 'A basic identification detail.', source: 'profile', howTo: 'Add this in Identity & Residency.' },
  A: { text: 'A basic particular about you.', source: 'profile', howTo: 'Add this in Identity & Residency.' },
  B: { text: 'A figure in your income tax computation.', source: 'document', howTo: 'This is usually derived automatically from your documents — check the relevant category has been uploaded.' },
  C: { text: 'A particular about your spouse.', source: 'profile', howTo: 'Add this in Marital Status & Dependents.' },
  D: { text: 'A contact or administrative detail.', source: 'profile', howTo: 'Add this in Other Particulars or Contact & Correspondence.' },
  G: { text: 'A donation or contribution.', source: 'document', howTo: 'Upload the donation receipt.' },
  H: { text: 'A relief or deduction.', source: 'document', howTo: 'Upload the relevant receipt, or check your profile if it\u2019s based on a personal circumstance rather than a purchase.' },
  K: { text: 'Prior-year income you\u2019re disclosing now.', source: 'document', howTo: 'Upload the relevant document.' },
  M: { text: 'A carried-forward business loss or capital allowance balance.', source: 'profile', howTo: 'Check your entity\u2019s Opening Carry-Forward Balances.' },
  N: { text: 'A business financial figure.', source: 'document', howTo: 'Upload your Profit & Loss statement or Balance Sheet.' },
};

const GENERIC_FALLBACK_GUIDANCE = { text: 'A figure or detail on your return.', source: 'document', howTo: 'Upload the relevant document, or check your profile.' };

// Composes the full blank-row message: what this line needs, then exactly
// how to complete it (document upload vs a specific profile screen), then
// the one constant closing line every blank row shares regardless of code.
function buildBlankReason(code, partCode) {
  const g = CODE_GUIDANCE[code] || PART_FALLBACK_GUIDANCE[partCode] || GENERIC_FALLBACK_GUIDANCE;
  return `${g.text} ${g.howTo} If it doesn\u2019t apply to you, it\u2019s fine to leave blank.`;
}

function DataCoveragePanel({ formRef, dataGaps }) {
  const [flaggedByPart, setFlaggedByPart] = React.useState([]);

  // Re-scans on every render of the parent (mirrors FPart's own
  // no-dependency-array effect) so this stays in sync as `fd` changes —
  // e.g. a document finishes processing and a row that was blank now has a
  // value, or a new backend warning appears.
  React.useEffect(() => {
    const root = formRef?.current;
    // Bug fix (16 Jul 2026): this effect has no dependency array by design
    // (mirrors FPart's own re-check-every-render pattern), but FPart's
    // version sets a BOOLEAN — React bails out via Object.is when the value
    // is unchanged, so it naturally stabilises after one extra render. This
    // effect was building a brand-new array every single run and calling
    // setState with it unconditionally — a new array is always a new
    // reference, so React never bailed out, the effect re-ran immediately
    // after its own state update, and the whole thing looped forever,
    // pegging the tab. Fixed by comparing against the PREVIOUS result
    // (via the functional setState form, so flaggedByPart doesn't need to
    // be a dependency either) and only actually updating state when the
    // set of flagged items has genuinely changed.
    const snapshot = (list) => list.map((p) => `${p.partCode}:${p.items.map((i) => i.code).join(',')}`).join('|');

    if (!root) {
      setFlaggedByPart((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const dots = Array.from(root.querySelectorAll('[data-review-dot="true"]'));
    const byPart = new Map();

    for (const dot of dots) {
      const rowEl = dot.closest('[id^="row-"]');
      const partEl = dot.closest('[data-part-code]');
      if (!rowEl) continue;
      const code = rowEl.id.replace(/^row-/, '');
      const labelEl = rowEl.querySelector('[data-row-label]');
      const label = labelEl?.getAttribute('data-row-label') || code;
      const partCode = partEl?.getAttribute('data-part-code') || '—';
      const partTitle = partEl?.getAttribute('data-part-title') || 'General';

      // Was this row explicitly flagged by the backend (a real dataGap with
      // this code in its affectedCodes), or is it just blank? Explicit
      // flags get their own specific reason; blanks get a targeted one
      // built from CODE_GUIDANCE — what this line needs and exactly how
      // to complete it, rather than one repeated generic sentence.
      const explicitGap = (dataGaps || []).find((g) => (g.affectedCodes || []).includes(code));
      const reason = explicitGap
        ? (REVIEW_REASON_COPY[explicitGap.part] || explicitGap.note || buildBlankReason(code, partCode))
        : buildBlankReason(code, partCode);

      const key = partCode;
      if (!byPart.has(key)) byPart.set(key, { partCode, partTitle, items: [] });
      byPart.get(key).items.push({ code, label, reason, isExplicit: !!explicitGap });
    }

    // Stable order: by Part code, matching the form's own top-to-bottom
    // sequence rather than the arbitrary order dots were found in.
    const grouped = Array.from(byPart.values()).sort((a, b) => a.partCode.localeCompare(b.partCode, undefined, { numeric: true }));
    setFlaggedByPart((prev) => (snapshot(prev) === snapshot(grouped) ? prev : grouped));
  });

  const totalItems = flaggedByPart.reduce((s, p) => s + p.items.length, 0);
  const jumpTo = (code) => {
    const rowEl = formRef?.current?.querySelector(`#row-${CSS.escape(code)}`);
    scrollToRowAndFlash(rowEl);
  };

  return (
    <InlineSummary title="Form B Readiness">
      {/* Always-visible explanation of what the Review badge actually means
          — this is the piece that was previously missing entirely: a person
          seeing the amber "Review" badge on the form above had no
          explanation of what it was asking them to do. */}
      <div className="flex items-start gap-2 bg-warning-bg/40 px-3 py-2">
        <span
          className="shrink-0 mt-0.5 rounded-full px-2 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: REVIEW_BADGE_BG, color: REVIEW_BADGE_TEXT }}
        >
          Review
        </span>
        <p className="text-[10px] text-muted leading-relaxed">
          {totalItems > 0
            ? <>An amber <span className="font-semibold text-headings">Review</span> badge marks any section below that still needs attention. Click a badge, or an item below, to go straight to it.</>
            : <>Nothing needs your attention right now — every section is either filled in or genuinely doesn\u2019t apply to you.</>}
        </p>
      </div>

      {totalItems === 0 ? (
        <div className="flex items-center gap-2 px-3 py-3">
          <span className="shrink-0 rounded-full border border-success/30 bg-success-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-success">
            Ready
          </span>
          <p className="text-[10px] text-muted leading-relaxed">Your Form B draft is fully populated — give it a final read in Preview before filing.</p>
        </div>
      ) : (
        flaggedByPart.map((part) => (
          <div key={part.partCode}>
            <div className="bg-[#F8FAFC] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wide text-[#64748B]">
              {part.partCode && part.partCode !== '—' ? `Part ${part.partCode} — ${part.partTitle}` : part.partTitle} · {part.items.length} to check
            </div>
            <div className="divide-y divide-[#F1F5F9]">
              {part.items.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => jumpTo(item.code)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors duration-150"
                >
                  <span className="shrink-0 mt-0.5 rounded-full border border-warning/30 bg-warning-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warning">
                    {item.code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold text-headings">{item.label}</p>
                    <p className="text-[10px] text-muted mt-0.5 leading-relaxed">{item.reason}</p>
                  </div>
                  <span className="shrink-0 text-[9px] font-medium text-primary self-center">Jump to it →</span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
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
  // Bug fix (15 Jul 2026, production-readiness review): neither handler below
  // had a try/catch — if renderNodeToPdfBlob (html2canvas, font loading, the
  // header-flattening canvas step, etc.) threw for ANY reason, pdfBusy never
  // got reset, permanently disabling both buttons, and — if the failure
  // happened during Preview — the slide-over was left showing its "Rendering
  // your draft…" spinner forever, with no error message and no way to
  // recover short of a full page reload. html2canvas failures are common
  // enough in practice (memory limits on long documents, browser quirks,
  // tainted-canvas edge cases) that this needed real handling, not an
  // assumption it always succeeds.
  const [pdfError, setPdfError] = useState(null);
  const pdfSourceRef = useRef(null);
  // Used by the redesigned Data Coverage / review guide below to scan the
  // ACTUAL rendered embedded form for review-flagged rows, rather than
  // maintaining a second, separate list that could drift out of sync with
  // what the Review badges on the form itself are actually showing.
  const embeddedFormRef = useRef(null);
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
    setPdfError(null);
    try {
      const file = await generatePdfBlob();
      if (file) {
        if (pdfUrl) URL.revokeObjectURL(pdfUrl);
        setPdfUrl(URL.createObjectURL(file));
      } else {
        setPdfError('Could not render the draft. Please try again.');
      }
    } catch (e) {
      console.error('[Generate Forms] Preview render failed:', e);
      setPdfError('Something went wrong while rendering the draft. Please try again — if this keeps happening, use the thumbs-down button to let us know.');
    } finally {
      setPdfBusy(null);
    }
  };

  // Export downloads straight away — it never opens the preview panel.
  const handleExport = async () => {
    setPdfBusy('export');
    setPdfError(null);
    try {
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
      } else {
        setPdfError('Could not prepare the PDF for download. Please try again.');
      }
    } catch (e) {
      console.error('[Generate Forms] Export render failed:', e);
      setPdfError('Something went wrong while preparing the PDF. Please try again — if this keeps happening, use the thumbs-down button to let us know.');
    } finally {
      setPdfBusy(null);
    }
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
          pdfError={pdfError}
          filingYear={filingYear}
          onRetry={handlePreview}
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
                  ? `Income combined across ${entityCount} businesses · Part N shows main business: ${fd.businessName}`
                  : `Based on ${fd.businessName}`} · LHDN Submission Draft
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

          {/* Export failures have no modal to surface an error in (Export
              downloads directly, it never opens Preview) — show it here
              instead of leaving the person wondering why nothing happened. */}
          {pdfError && !showPreview && (
            <div className="mx-5 mt-3 flex items-center justify-between gap-3 rounded-lg border border-critical/30 bg-critical-bg px-3 py-2">
              <p className="text-[11px] text-critical">{pdfError}</p>
              <button
                onClick={handleExport}
                className="shrink-0 rounded-md bg-critical px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90 transition-opacity duration-150"
              >
                Try again
              </button>
            </div>
          )}

          <div className="px-5 py-4" ref={embeddedFormRef}>
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

            <DataCoveragePanel formRef={embeddedFormRef} dataGaps={dataGaps} />

            <p className="text-[10px] text-[#94A3B8] leading-relaxed">
              This draft was prepared with the help of AI from your uploaded documents and profile details. It can make mistakes, so please review it carefully and check with a tax professional before relying on it. Open <span className="font-semibold">Preview</span> to see and download the full draft.
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

export default function ManageProfile({ initialProfile, initialEntities, activeEntityId, onSavePersonal, onCreateEntity, onSaveEntity, onDeleteEntity, onSwitchEntity, taxSummary, taxSummaryLoading, initialChildren, onCreateChild, onSaveChild, onDeleteChild, onDeleteAccount }) {
  // Use initialProfile if available, otherwise fall back to your static BLANK_PERSONAL_PROFILE structure
  const [personalProfile, setPersonalProfile] = useState(initialProfile || BLANK_PERSONAL_PROFILE);
  const [entities, setEntities] = useState(initialEntities || []);
  const [children, setChildren] = useState(initialChildren || []);

  React.useEffect(() => {
    if (initialChildren) setChildren(initialChildren);
  }, [initialChildren]);

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
  // /manageaccount?editProfile=gaps deep-links here from the `profile_incomplete`
  // AI insight ("Edit your profile"). It opens the SAME Edit Profile panel the
  // summary card's "Edit profile" button opens — no special-cased UI — but in
  // gaps-only mode, so the user sees just the fields Form B is missing.
  // ?editProfile=1 opens the same panel with the full form.
  const editProfileParam = new URLSearchParams(window.location.search).get('editProfile');
  const [showPersonalPanel, setShowPersonalPanel] = useState(
    () => editProfileParam === '1' || editProfileParam === 'gaps'
  );
  // Latched at mount so dismissing and reopening the panel from the summary
  // card gives the normal full form, not the filtered one.
  const [personalPanelGapsOnly, setPersonalPanelGapsOnly] = useState(
    () => editProfileParam === 'gaps'
  );
  const [newEntityDraft, setNewEntityDraft] = useState(null);
  // Tabs sit below the always-visible personal summary and govern only the
  // business-profiles area: entity management vs the generated Form B draft.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState('entities');

  useEffect(() => {
    if (searchParams.get('tab') === 'forms') setTab('forms');
  }, [searchParams]);

  // When the user opens the Generate Forms tab, kick a fresh insight-engine
  // run for the active entity so any "Form B incomplete" card reflects the
  // current document state at exactly the moment they're generating the form.
  // Fire-and-forget (202); the refreshed feed lands on the next inbox fetch.
  const activeEntityForForms = entities[activeIndex]?.id ?? activeEntityId ?? null;

  React.useEffect(() => {
    if (tab !== 'forms') return;
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    runInsightEngine(userId, activeEntityForForms).catch(() => {
      // Non-fatal: generating the form must never depend on insight refresh.
    });
  }, [tab, activeEntityForForms]);
  
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

  // Children (H16 relief records) — thin wrappers around the onCreateChild/
  // onSaveChild/onDeleteChild props from ManageAccount.jsx, keeping local
  // `children` state in sync so the ChildrenEditor reflects changes
  // immediately without waiting for a full profile re-fetch.
  const handleAddChild = async (draft) => {
    if (!onCreateChild) return false;
    const created = await onCreateChild(draft);
    if (created) {
      setChildren((prev) => [...prev, created]);
      return created;
    }
    return false;
  };
  const handleUpdateChild = async (childId, draft) => {
    if (!onSaveChild) return false;
    const ok = await onSaveChild(childId, draft);
    if (ok) {
      setChildren((prev) => prev.map((c) => (c.id === childId ? { ...c, ...draft } : c)));
    }
    return ok;
  };
  const handleDeleteChildRecord = async (childId) => {
    if (!onDeleteChild) return false;
    const ok = await onDeleteChild(childId);
    if (ok) setChildren((prev) => prev.filter((c) => c.id !== childId));
    return ok;
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
      // Personal Information feeds Form B's identity/contact/refund lines, so
      // completing it is what resolves the `profile_incomplete` insight. Kick a
      // fresh engine run (fire-and-forget) so the card clears now instead of
      // lingering until the next document upload.
      const userId = localStorage.getItem('userId');
      if (userId) {
        runInsightEngine(userId, activeEntityForForms).catch(() => {
          // Non-fatal: saving the profile must never depend on insight refresh.
        });
      }
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
          gapsOnly={personalPanelGapsOnly}
          onClose={() => { setShowPersonalPanel(false); setPersonalPanelGapsOnly(false); }}
          onSave={handleSavePersonal}
          children={children}
          onAddChild={handleAddChild}
          onUpdateChild={handleUpdateChild}
          onDeleteChild={handleDeleteChildRecord}
          taxSummary={taxSummary}
          onDeleteAccount={onDeleteAccount}
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