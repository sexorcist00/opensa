# 077 — Unit coverage back to 85–90 % (the device-independent seam)

Fallout from [074/13](074-opensa-engine/13-cleanup.md): deleting the three-WebGL renderer removed a large,
heavily unit-tested body of code, and `packages/engine` — the WebGPU renderer that replaced it — arrived
essentially untested because it needs a GPU device. Coverage fell **88.9 % → 72.3 %** statements and the
enforced floors (85 / 77) have been red since. [13 phase 6.6](074-opensa-engine/13-cleanup.md) left the
fix as an explicit decision rather than lowering the floors silently. **This plan is that decision,
executed.**

**Target: 85 % statements minimum, 90 % preferred, with the floors re-armed at the achieved number.**

## The measured gap (2026-07-18, baseline)

Total **8 847 statements, 6 396 covered = 72.29 %**. To reach 85 % needs **+1 124 covered statements**;
90 % needs **+1 566**.

| Area                      | Uncovered / total | %        | Notes                                                      |
| ------------------------- | ----------------- | -------- | ---------------------------------------------------------- |
| `packages/engine/src`     | **1 480 / 2 002** | **26.1** | the whole problem; `engine.ts` alone is 910 at **0 %**     |
| `packages/game/src`       | 311 / 2 058       | 84.9     | `gta-sa-world.adapter` 108, `physics-world` 96             |
| `packages/renderware`     | 233 / 3 000       | 92.2     | `glyph-quads` 46, `build-ped-model` 30, `prepare-clump` 30 |
| `packages/math/src`       | **203 / 628**     | 67.7     | **pure code, no excuse** — `vector4`/`vector2` at 0 %      |
| `packages/loaders/src`    | 201 / 426         | 52.8     | `asset-fetch-loader` 102 at 0 %, `install-source` 38       |
| `packages/engine-formats` | 18 / 428          | 95.8     | fine                                                       |
| everything else           | ~5                | ~99      | fine                                                       |

**Arithmetic that decides the plan: covering every non-engine gap perfectly yields ~84 %.** The engine is
not optional — it must contribute ~150 statements for 85 % and ~700 for 90 %.

## The approach — USER DECISION 2026-07-18

**A fake `GPUDevice` first, targeted extraction only where the fake cannot reach.** Rejected
alternatives, recorded so they are not re-argued:

- **Extracting the frame logic out of `engine.ts` as the primary move** — it is a refactor of a
  field-validated hot path days after the flip, and a regression there is invisible to unit tests
  (only a field ride or the bench catches it). Extraction stays available, but it is the second tool,
  not the first.
- **Excluding `packages/engine` and re-arming the floors on the narrowed scope** — honest bookkeeping,
  but it declares the renderer permanently untestable and caps real coverage at ~84 %.

The fake device is **test-only code**: `engine.ts` is not touched. It records the calls made against it
(`createBuffer`, `createBindGroup`, `beginRenderPass` → `setPipeline`/`setBindGroup`/`draw`/`drawIndexed`,
`queue.writeBuffer`, `createRenderBundleEncoder`, …) so a test asserts **what the engine decided to
draw**, not that it called an API. That is the seam: WebGPU's own interface.

**What must be asserted through it — behaviour, not call shapes:**

- hour gating (`timedActive`): night-window objects appear at 22:00 and not at 14:00
- cell selection: the LOD ring, the fog cap, the cell-rect visibility test (074/21)
- draw order: opaque → sky → blend, and blend sorted back-to-front by cell distance
- translucent submesh sort (the wheel-through-windscreen fix)
- vehicle-texture LRU: claim-before-evict, the 256 MB trim floor
- residency ledger arithmetic
- uniform/buffer PACKING — byte offsets and strides, where silent corruption lives

**Anti-goal, stated up front:** a test that only proves `createBuffer` was called is coverage theatre.
If a test cannot fail for a reason a user would care about, it does not go in.

## Phases

Each phase ends green with a measured coverage delta in the ledger. Phases 1–2 carry zero risk to
product code; phase 4 is the only one that touches `packages/engine` sources.

### Phase 1 — `@opensa/math` to ~95 % (+~180)

Pure functions, zero dependencies, and **it is our replacement for three** — the one package where thin
coverage is indefensible. `vector2`/`vector4` sit at 0 %, `matrix4` has 46 uncovered. The
[three-parity fixtures](../../packages/math/src/three-fixtures.json) already pin the semantics; this is
extending that suite to the untested surface.

### Phase 2 — loaders + the non-engine remainder (+~600)

- `asset-fetch-loader` (102, 0 %) — fetch + Cache Storage, mockable; the existing `asset-loader.ts`
  exclusion covers the _orchestration_, not this.
- `install-source` (38), `dir-handle-store` (35) — File System Access handles, fakeable.
- `gta-sa-world.adapter` (108) + `physics-world` (96) + `engine-vehicle-handle` (30).
- `glyph-quads` (46) — flagged as untested during the 074/13 docs sweep.
- `build-ped-model` (30), `prepare-clump` (30).

### Phase 3 — the fake device + engine behaviour tests (+~500–700)

The plan's centre. Build `packages/engine/src/test/fake-device.ts` (test-only, excluded from coverage
itself), then cover in this order — highest behavioural value first, not highest line count:
`world/cells.ts` (96) · `engine.ts` `frame()` (the bulk of the 910) · `render/pipelines.ts` (77) ·
`world/textures.ts` (34, the LRU) · `stream/setup.ts` (46) · `render/probe.ts` (73) ·
`debug/gpu-timers.ts` (54).

### Phase 4 — targeted extraction, ONLY where phase 3 proved the fake insufficient

Decided by evidence from phase 3, not up front. Any extraction here is a behaviour-preserving move of
pure logic, and **the phase closes with a bench ritual run + a field ride** — the only instruments that
see a hot-path regression.

### Phase 5 — re-arm the floors + close out

Set `coverage.thresholds` to a small buffer below the achieved numbers (the repo's existing convention),
update [test-coverage.md](../development/test-coverage.md), and record the final disposition.

## Measurement ledger

| Date       | Phase                                   | Statements               | Branches | Functions | Lines   | Note                                                                                                          |
| ---------- | --------------------------------------- | ------------------------ | -------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-07-18 | baseline (post-teardown)                | 72.29 %                  | 67.11 %  | 71.86 %   | 72.13 % | 6 396 / 8 847 statements                                                                                      |
| 2026-07-18 | phase 1 — `@opensa/math`                | **74.40 %**              | 69.09 %  | 77.74 %   | 74.22 % | math 67.7 → ~98 %; suite 295 files / 1 900 tests                                                              |
| 2026-07-18 | phase 3 — the fake device (engine only) | engine **26.1 → 62.9 %** | —        | —         | —       | `engine.ts` 0 → 43.8 %, `pipelines` 4.9 → 98.8 %, `core/math` 59.7 → 100 %, `sky-lut` 98.8 % — the seam works |
