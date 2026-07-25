// ─── CukaiBot extension — fixed launcher tab ─────────────────────────────────
// A CukaiBot "bookmark" tab pinned to the BOTTOM-RIGHT, flush against the right
// screen edge: rounded on the left, flat on the right (a D-shaped tab tucked
// into the edge). Click it to toggle the side panel open/closed. Fixed — not
// draggable.
//
// The logo is an INLINE data URI (see logo-data.js) so it can never be blocked
// by a page's security policy, with an inline-SVG fallback if unavailable.

(function () {
  // Only the top-level page shows the launcher — never inside iframes.
  if (window.top !== window.self) return;
  // Guard against double-injection (SPA navigations, re-runs).
  if (document.getElementById('cukaibot-fab')) return;

  const WIDTH = 32;   // thin vertical edge tab
  const HEIGHT = 40;  // thinner

  const btn = document.createElement('button');
  btn.id = 'cukaibot-fab';
  // Explicit type="button" — without it a <button> defaults to type="submit",
  // which on a form-heavy page (e.g. the LHDN e-Filing portal) can submit the
  // form and navigate/close the tab when clicked.
  btn.type = 'button';
  btn.title = 'Ask CukaiBot';
  btn.setAttribute('aria-label', 'Open CukaiBot');
  btn.style.cssText = [
    'position:fixed',
    'right:0',                   // flush against the right screen edge
    'bottom:24px',               // sits near the bottom-right
    `width:${WIDTH}px`,
    `height:${HEIGHT}px`,
    'z-index:2147483647',        // above basically everything
    'border-radius:14px 0 0 14px', // rounded LEFT, flat right (edge tab)
    'border:1px solid #E2E8F0',
    'border-right:none',         // no seam against the screen edge
    'padding:0',
    'margin:0',
    'cursor:pointer',
    'box-shadow:-4px 3px 16px rgba(13,148,136,0.28), 0 2px 6px rgba(0,0,0,0.12)',
    'background:#ffffff',        // white button so the logo reads cleanly
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'overflow:hidden',
    'transform-origin:right center', // hover grows LEFT only — right stays flush
    'transition:transform 0.14s ease, box-shadow 0.14s ease',
  ].join(';');

  // The real CukaiBot logo, inlined as a data URI (see logo-data.js). Falls
  // back to an inline teal chat-bubble SVG if the data URI is unavailable.
  const logoSrc = (typeof window !== 'undefined' && window.__CUKAIBOT_LOGO__) || '';
  if (logoSrc) {
    const img = document.createElement('img');
    img.src = logoSrc;
    img.alt = '';
    img.style.cssText = 'width:24px;height:24px;object-fit:contain;pointer-events:none;';
    img.onerror = () => { img.remove(); btn.innerHTML = fallbackSvg(); };
    btn.appendChild(img);
  } else {
    btn.innerHTML = fallbackSvg();
  }

  function fallbackSvg() {
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="pointer-events:none">' +
      '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 4 11.5 8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" fill="#0D9488"/>' +
      '<path d="M12.5 7.2l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" fill="#ffffff"/>' +
      '</svg>';
  }

  // ── Hover feedback: grow slightly, anchored to the right edge (transform-
  //    origin above), so the tab stays FLUSH against the edge/scrollbar with
  //    no gap — it just gets a little wider/taller toward the page. ──
  btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.08)'; });
  btn.addEventListener('mouseleave', () => { btn.style.transform = 'none'; });

  // ── Click → toggle the side panel open/closed ──
  // Prevent default + stop propagation so the click can never reach the page
  // (form submit, navigation, the page's own click handlers, etc.).
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'CUKAI_TOGGLE_PANEL' });
  });

  document.body.appendChild(btn);
})();
