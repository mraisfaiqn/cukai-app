// ─── CukaiBot extension — background service worker ──────────────────────────
// Jobs:
//   1. Toolbar icon opens the side panel (Chrome toggles it natively).
//   2. The injected floating button (floating-button.js) TOGGLES the panel:
//      click to open, click again to close.
//
// Chrome has no direct sidePanel.close(), so "close" is done by momentarily
// disabling the panel for the tab (which dismisses it) and then re-enabling it
// so it can be opened again. Whether the panel is currently open is tracked via
// a live port the panel page holds open while it's alive (see sidepanel.js) —
// this stays accurate even when the user closes the panel with its own X.

function enableActionClickToOpen() {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.warn('[CukaiBot] setPanelBehavior failed:', err));
  }
}

chrome.runtime.onInstalled.addListener(enableActionClickToOpen);
chrome.runtime.onStartup.addListener(enableActionClickToOpen);

// ── Track which WINDOWS have the panel open, via each panel's live port ──────
// Per-window (a Set of windowIds), not a single global boolean: the side panel
// is a per-window surface, so with two browser windows open, tracking one flag
// would let a toggle in window A desync window B. Each panel reports its own
// windowId over the port when it connects (see sidepanel.js).
const openWindows = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cukai-sidepanel') return;
  let winId = null;
  port.onMessage.addListener((m) => {
    if (m && typeof m.windowId === 'number') { winId = m.windowId; openWindows.add(winId); }
  });
  port.onDisconnect.addListener(() => { if (winId != null) openWindows.delete(winId); });
});

// ── Floating-button toggle ──────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  const winId = sender.tab?.windowId;
  if (msg?.type !== 'CUKAI_TOGGLE_PANEL' || tabId == null) return;

  const isOpen = winId != null && openWindows.has(winId);
  if (isOpen) {
    // Close: disabling the panel for this tab dismisses it, then re-enable so
    // it can be opened again on the next click.
    chrome.sidePanel.setOptions({ tabId, enabled: false }, () => {
      openWindows.delete(winId);
      setTimeout(() => {
        chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true });
      }, 200);
    });
  } else {
    // Open — must run in the click's user-gesture context (preserved through
    // the message dispatch).
    chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true });
    chrome.sidePanel
      .open({ tabId })
      .catch((err) => console.warn('[CukaiBot] sidePanel.open failed:', err));
  }
});
