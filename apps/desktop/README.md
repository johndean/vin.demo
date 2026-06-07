# VIN Demo — Desktop (Control Room)

Electron implementation of the **live demo control room** design (`VIN Demo - Desktop.html`
+ `desktop/*.jsx` + `control-room.css`), ported pixel-faithfully. The stage is the demoed
product (demo.vin); a collapsible right panel carries **Conversation** (default) / **Brief**
/ **Reasoning**; an AI-consultant control bar (Run / Step / Pace) drives the
approval-delegation loop with self-heal, confidence gate, blocked-mutation, and live cost.

## Run

```bash
cd apps/desktop
npm install
npm run app        # builds the renderer (esbuild) + launches Electron
```

`npm run build` bundles the renderer to `dist/` (esbuild → `bundle.js` + html + css + fonts +
assets, all relative paths so it loads under `file://`); `npm start` launches Electron against
`dist/`. The traffic-light dots in the (frameless) titlebar are wired to real window controls
via `electron/preload.cjs`.

> Note: the `start`/`app` scripts run `env -u ELECTRON_RUN_AS_NODE` — if that env var is set
> (some agent/CI shells set it), Electron would otherwise run as plain Node and fail with
> "Cannot read properties of undefined (reading 'whenReady')".

## Package (installers)

```bash
npm run dist       # electron-builder → release/ (.dmg / .exe / AppImage)
```

This produces a **fat client** (the renderer is bundled in). Per the build/distribution notes:
fat-client installers are appropriate for **trusted/internal operators**. Shipping to outside
machines (prospects) should use a **thin client** against the hosted engine, and requires
**code signing + notarization** (Apple) / Authenticode (Windows) or installs get blocked.

## Structure

- `electron/main.cjs` — frameless `BrowserWindow`, window-control IPC, opens external links
  (e.g. "back to console" → demofor.vin) in the default browser.
- `electron/preload.cjs` — exposes `window.win` (minimize/maximize/close).
- `index.html` — window chrome (the design's deskwin card + titlebar) + `#root`.
- `src/` — `runtime.tsx` (orchestrator), `demo-app.tsx` (demoed product), `beats.ts` (the
  demo-loop state machine — the clean seam to swap for a live LangGraph trace), `shell.tsx`
  (icons), `data.ts` (shared dataset).
- `styles/` — `tokens.css` + `vin-demo.css` + `control-room.css` (the VIN design system, 1:1).
