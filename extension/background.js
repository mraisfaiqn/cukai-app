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

// ── Track open/closed state via the panel's live port ──────────────────────
let panelOpen = false;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cukai-sidepanel') return;
  panelOpen = true;
  port.onDisconnect.addListener(() => { panelOpen = false; });
});

// ── Floating-button toggle ──────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (msg?.type !== 'CUKAI_TOGGLE_PANEL' || tabId == null) return;

  if (panelOpen) {
    // Close: disabling the panel for this tab dismisses it, then re-enable so
    // it can be opened again on the next click.
    chrome.sidePanel.setOptions({ tabId, enabled: false }, () => {
      panelOpen = false;
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
