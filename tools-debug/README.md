# tools-debug

Debug / reproduction harnesses — tools that exist to **investigate and reproduce engine bugs**, not to ship in
a build. Kept out of `tools/` (the map-build pipeline) so the production toolchain stays clean. Each is a normal
workspace (`tsx`-run CLI + unit tests), registered in the root `package.json`, `vitest.config.ts`, and
`eslint.config.ts`.

## Tools

- **[`bench-harness`](./bench-harness)** — headless field-check harness for the own-engine game: fake
  `showDirectoryPicker` over a local HTTP file server + Playwright WebGPU boot — runs the in-game bench
  sweeps, soak runs and boot-gate checks without a human at the screen. Guide:
  [docs/development/benchmarks.md](../docs/development/benchmarks.md). (Plain node scripts, not a
  workspace — they drive a browser, they don't ship.)
- **[`sa-int16-repro`](./sa-int16-repro)** — the row-count dial that reproduces SA's int16 building-pool
  truncation (the "ghost barriers" bug) on demand. The pass/fail **oracle** for the
  [perfect-map ASI project](../asi/perfect-map/docs/plans/readme.md). Full plan:
  [`sa-int16-repro/docs/reproducing-the-int16-bug.md`](./sa-int16-repro/docs/reproducing-the-int16-bug.md).
