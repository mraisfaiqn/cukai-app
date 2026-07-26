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

  const WIDTH = 33;   // thin vertical edge tab
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
    // 0.05cm off the top + 0.05cm off the bottom = 0.1cm off the total
    // height. Since the button is anchored via bottom:24px (a fixed
    // distance from the viewport's bottom edge), shrinking the total
    // height this way moves only the TOP edge down — the bottom edge's
    // distance from the viewport bottom never changes — which is exactly
    // an equal trim off both sides.
    `height:calc(${HEIGHT}px - 0.1cm)`,
    'z-index:2147483647',        // above basically everything
    'border-radius:14px 0 0 14px', // rounded LEFT, flat right (edge tab)
    'border:1px solid #E2E8F0',
    'border-right:none',         // no seam against the screen edge
    'box-sizing:border-box',     // border above is INCLUDED in width/height,
                                  // not added on top — keeps the box exactly
                                  // 32x40 so centering math below is exact
    'padding:0',
    'margin:0',
    'appearance:none',           // strip native button chrome (platform
    '-webkit-appearance:none',   // padding/insets) that can otherwise offset
                                  // the flex-centered content by a few px
    'cursor:pointer',
    'box-shadow:-4px 3px 16px rgba(13,148,136,0.28), 0 2px 6px rgba(0,0,0,0.12)',
    'background:#ffffff',        // white button so the logo reads cleanly
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'overflow:hidden',
    'transform-origin:right center', // hover grows LEFT only — right stays flush
    'transition:transform 0.14s ease, box-shadow 0.14s ease, width 0.14s ease',
  ].join(';');

  // The real cukai logo, loaded from icons/cukai-logo.png — chrome.runtime.getURL()
  // resolves it to a chrome-extension:// URL the host page is allowed to load
  // because it's declared under web_accessible_resources in manifest.json.
  // Falls back to an inline teal chat-bubble SVG if that ever fails to load
  // (e.g. the extension was reloaded mid-navigation and the URL went stale).
  const logoSrc = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
    ? chrome.runtime.getURL('icons/cukai-logo.png')
    : '';
  if (logoSrc) {
    const img = document.createElement('img');
    img.src = logoSrc;
    img.alt = '';
    img.style.cssText = 'width:26px;height:26px;object-fit:contain;pointer-events:none;margin-top:2px;';
    img.onerror = () => { img.remove(); btn.innerHTML = fallbackSvg(); };
    btn.appendChild(img);
  } else {
    btn.innerHTML = fallbackSvg();
  }

  function fallbackSvg() {
    return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="pointer-events:none;margin-top:2px;">' +
      '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 4 11.5 8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" fill="#0D9488"/>' +
      '<path d="M12.5 7.2l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z" fill="#ffffff"/>' +
      '</svg>';
  }

  // ── Hover feedback: two distinct, stackable effects, both anchored to the
  //    right edge so the button always reads as fixed to the wall:
  //      1. transform: scale(1.08) — the existing uniform "grow slightly"
  //         effect (transform-origin: right center keeps the right edge in
  //         place while the box grows evenly in all directions).
  //      2. width: grows by 0.15cm — an actual layout change, not a
  //         transform. Because the button is `position:fixed; right:0`,
  //         increasing its width extends the LEFT edge further left while
  //         the right edge's distance from the screen edge never changes —
  //         exactly like a drawer sliding out of a fixed wall panel, rather
  //         than the whole shape detaching and sliding away from the wall
  //         (which is what the previous translateX approach did). ──
  btn.addEventListener('mouseenter', () => {
    btn.style.width = `calc(${WIDTH}px + 0.15cm)`;
    btn.style.transform = 'scale(1.08)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.width = `${WIDTH}px`;
    btn.style.transform = 'none';
  });

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