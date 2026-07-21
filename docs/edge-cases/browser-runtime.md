# Browser & platform edge cases

- **The local (folder) loader is Chromium-only** — File System Access API; `fetch` stays the default
  elsewhere. Opt-in per game (`assetLoader: 'local'`).
- **The native folder picker cannot be automated.** Playwright can't drive the FSA dialog — e2e uses an
  in-page fake FSA tree; real folder flows need a human. Headless _field checks_ are still possible: the
  bench harness boots the real game through `?loader=http-dir&src=<served build>` (no picker on that path).
- **Cache Storage needs a secure context.** Over plain `http://` (e.g. a phone on a LAN IP) `caches` is
  undefined and every cache op silently no-ops — assets re-download each visit, nothing breaks.
- **Visual regression renders on Chromium's software backend** (for determinism), not real GPU — it cannot
  judge WebGPU-specific defects.
- **The shell e2e needs built `static/games/original-*` archives** — it only runs where those exist (not on
  GitHub-hosted CI).
- **User activation is fragile.** The folder prompt must be the **first** await in the Play-click handler
  (an IndexedDB read before it loses the gesture); `requestPointerLock` may only be called once per gesture
  (a second call silently breaks selection — the map-viewer dead-select bug).
