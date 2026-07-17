# bench-harness

Headless field-check harness for the own-engine game: boots the REAL web app in headless Chromium
(WebGPU over ANGLE/Metal) with a **fake `showDirectoryPicker`** served from a local HTTP file server —
so bench sweeps, soak runs and boot-gate checks run with no human at the screen and no user screenshots.

**The full guide lives in [docs/development/benchmarks.md](../../docs/development/benchmarks.md)** —
scenes, report protocols, the recording ritual, DPR caveats. This README is just the file map:

- `game-server.js` — static file server over a game install (Range support + CORS); `GET /__index`
  returns the flat file tree the fake picker builds handles from. The 1.3 GB gta3.img is never
  buffered — `slice()` maps to HTTP Range reads.
- `drive.js` — boots the app, clicks through the folder flow, waits for `[bench]` (or `TAG='[soak]'`)
  report lines, screenshots on exit. `DPR=2` gives retina-equivalent render targets.
- `gate-check.js` — WebGPU boot-gate verification: `canvas` mode reports which context type the game
  canvas holds (webgpu = own engine, webgl2 = three prod); `sorry` mode launches WITHOUT WebGPU and
  expects the sorry screen.

Deliberately plain dependency-free Node scripts (playwright resolves from the repo root via
`NODE_PATH`) — not a workspace, no lint/test registration: they drive a browser, they don't ship.
