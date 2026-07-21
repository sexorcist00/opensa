# bench-harness

Headless field-check harness for the own-engine game: boots the REAL web app in headless Chromium
(WebGPU over ANGLE/Metal) through the **`http-dir` loader** (`?loader=http-dir&src=<served build>`) — the
shipping load path, no fake picker — so bench sweeps, soak runs and boot-gate checks run with no human at
the screen and no user screenshots.

**The full guide lives in [docs/development/benchmarks.md](../../docs/development/benchmarks.md)** —
scenes, report protocols, the recording ritual, DPR caveats. This README is just the file map:

- `drive.js` — boots the app via `?loader=http-dir&src=`, clicks the game, waits for `[bench]` (or
  `TAG='[soak]'`) report lines, screenshots on exit. `DPR=2` gives retina-equivalent render targets.
- `gate-check.js` — WebGPU boot-gate verification: `canvas` mode reports which context type the game
  canvas holds (WebGPU is the only one since 074/13 deleted the three path); `sorry` mode launches WITHOUT
  WebGPU and expects the sorry screen.

The served build is `serve-static`'s `/build` mount (`npm run serve:static`, port 3001) — it exposes the
`/__index` listing + Range files the http-dir loader reads. (Plan 079 phase 3 retired the bespoke
`game-server.js` + the fake `showDirectoryPicker`.)

Deliberately plain dependency-free Node scripts (playwright resolves from the repo root via
`NODE_PATH`) — not a workspace, no lint/test registration: they drive a browser, they don't ship.
