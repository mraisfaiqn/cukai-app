# CukaiBot Browser Extension

A Chrome side-panel extension that puts **CukaiBot** — the real tax assistant
from the web app — alongside any page, including the **LHDN e-Filing (MyTax)**
portal. Ask tax questions and copy your Form B figures to paste into the form.

This folder is **self-contained** and does not affect the `frontend/` build or
the `backend/`. It's plain HTML/CSS/JS with no build step.

## How it works (v0.2 — iframe architecture)

The panel is a thin shell around **iframes of the real web app**:

| Tab | Loads | Gives you |
|-----|-------|-----------|
| **Chat** | `<app>/embed/cukaibot` | The actual CukaiBot page — identical UI, your chat history, citations, and it can see your uploaded documents |
| **Form B** | `<app>/embed/formb` | Your Form B figures (B1, B7, B11, B23, B24, B26, B31…) each with a **Copy** button |

Because the iframes are **same-origin** as the web app, they share its
logged-in session (`localStorage`). So:

- ✅ **Auto-login** — log into the Cukai app once in a tab, the panel is logged in too.
- ✅ **Finds your documents** — the chat is scoped to your real `user_id`/`entity_id`, so "I uploaded a receipt" actually works.
- ✅ **Always matches the app** — it *is* the app, so nothing drifts out of sync.

Plus a **draggable floating button** (`floating-button.js`) injected on every
page: drag it anywhere along the edge, click it to open the panel.

## Load it in Chrome

1. Make sure the **web app is running** (dev: `http://localhost:5173`) and the **backend** too.
2. Go to `chrome://extensions` → enable **Developer mode** (top-right).
3. Click **Load unpacked** → select this `extension/` folder.
4. Log into the Cukai app in a normal tab.
5. Click the floating CukaiBot bubble (or the toolbar icon) — the panel opens, already logged in.

## Configure the app URL

Click the ⚙️ Settings icon in the panel and set **Cukai app URL** to wherever
you log in:

- Local dev: `http://localhost:5173`
- Deployed: `https://cukai-my.web.app`

It must match the origin where you're logged in — that's what shares the session.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest — side panel, floating-button content script, permissions |
| `background.js` | Opens the panel from the toolbar icon and from the floating button |
| `floating-button.js` | Injects the draggable CukaiBot bubble on every page |
| `sidepanel.html/.css/.js` | The tabbed iframe shell (Chat / Form B) |
| `icons/icon.png` | Toolbar, panel, and floating-button logo |

## Web-app side (in `frontend/`)

Two small **additive** changes support the embed — they don't affect normal app usage:

- `src/App.jsx` — new `/embed/cukaibot` and `/embed/formb` routes under a chrome-free `EmbedLayout`.
- `src/pages/CukaiBot.jsx` — an optional `embed` prop that hides the page title and fills the panel height.
- `src/pages/Embed/FormBValues.jsx` — the compact copy-list (reuses `buildFormData`).

## Known limitations / next steps

- **Framing:** if the deployed app ever sets `X-Frame-Options: DENY` or a strict
  `frame-ancestors` CSP, the iframe won't load. Firebase Hosting doesn't by
  default, so it works as-is; verify if you add custom headers.
- **Floating button → open panel** relies on `chrome.sidePanel.open()` honoring
  the click gesture (Chrome 116+). If it ever doesn't fire, the toolbar icon
  always works.
- **Form B tab** shows a curated set of headline figures. Add more rows in
  `frontend/src/pages/Embed/FormBValues.jsx` (`SECTIONS`) as needed.
