// ─── CukaiBot side panel — iframe shell controller ───────────────────────────
// The panel is a thin frame around two iframes that load the real web app's
// embed routes. Because the iframes are same-origin as the app, they share its
// localStorage session — so the user stays logged in and their documents /
// Form B figures are all available, with zero re-auth. This file only handles:
//   • which app URL to point the iframes at (configurable in Settings)
//   • tab switching (Chat / Form B)
//   • lazy-loading the Form B iframe the first time its tab is opened

const DEFAULT_APP_URL = 'http://localhost:5173';

const el = (id) => document.getElementById(id);
const frames = {
  chat:  el('frame-chat'),
  formb: el('frame-formb'),
};
const ROUTES = {
  chat:  '/embed/cukaibot',
  formb: '/embed/formb',
};

let appUrl = DEFAULT_APP_URL;
let activeTab = 'chat';
const loaded = { chat: false, formb: false };

init();

// Announce "the panel is open" to the background worker via a long-lived port.
// The worker flips its open/closed state on connect/disconnect (see
// background.js), which is what makes the floating button's toggle accurate —
// including when the user closes the panel with its own X. Reconnect if the
// service worker is recycled so the state never gets stuck.
function keepAliveConnection() {
  try {
    const port = chrome.runtime.connect({ name: 'cukai-sidepanel' });
    port.onDisconnect.addListener(() => setTimeout(keepAliveConnection, 500));
  } catch (_) { /* worker momentarily unavailable — retried on next tick */ }
}
keepAliveConnection();

async function init() {
  const { cukaiExtSettings } = await chrome.storage.local.get('cukaiExtSettings');
  appUrl = (cukaiExtSettings?.appUrl || DEFAULT_APP_URL).replace(/\/+$/, '');
  el('appUrl').value = appUrl;

  wireEvents();
  loadFrame('chat'); // eager-load the default tab
}

function wireEvents() {
  el('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) switchTab(btn.dataset.tab);
  });

  el('settingsBtn').addEventListener('click', () =>
    el('settingsPanel').classList.toggle('hidden'));

  el('saveSettings').addEventListener('click', saveSettings);

  // If an iframe fails to load (wrong URL / app down), the onload never marks
  // it loaded; surface a hint after a short grace period on the active tab.
  Object.values(frames).forEach((f) => {
    f.addEventListener('load', () => { el('loadError').classList.add('hidden'); });
  });
}

function switchTab(tab) {
  if (tab === activeTab) return;
  activeTab = tab;

  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.tab === tab));

  Object.entries(frames).forEach(([name, f]) =>
    f.classList.toggle('hidden', name !== tab));

  loadFrame(tab); // lazy-load on first visit
}

function loadFrame(tab) {
  if (loaded[tab]) return;
  frames[tab].src = `${appUrl}${ROUTES[tab]}`;
  loaded[tab] = true;

  // Grace period: if the frame hasn't fired `load` shortly, assume it's
  // unreachable and show the settings hint.
  setTimeout(() => {
    if (activeTab === tab && !frameReachable(frames[tab])) {
      el('loadError').classList.remove('hidden');
    }
  }, 4000);
}

// A cross-origin iframe won't let us read its document, but a successful load
// still leaves `contentWindow` populated. This is a best-effort reachability
// hint, not a hard check.
function frameReachable(frame) {
  try { return !!frame.contentWindow; } catch (_) { return true; }
}

async function saveSettings() {
  const next = (el('appUrl').value.trim() || DEFAULT_APP_URL).replace(/\/+$/, '');
  appUrl = next;
  await chrome.storage.local.set({ cukaiExtSettings: { appUrl: next } });

  // Reset and reload both frames against the new URL.
  loaded.chat = false;
  loaded.formb = false;
  frames.chat.src = 'about:blank';
  frames.formb.src = 'about:blank';
  el('loadError').classList.add('hidden');
  el('settingsPanel').classList.add('hidden');
  loadFrame(activeTab);
}
