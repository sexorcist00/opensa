# Phase 1 — real-engine integration findings (in progress)

Branch `webgpu-migration`. What the real-engine WebGPU integration (behind `?webgpu=1`) established, and the one
bug that blocks a clean bundle measurement. Stopped here deliberately rather than iterating blind.

## ✅ Milestones reached

1. **The engine runs under WebGPU.** `?webgpu=1` boots a `WebGPURenderer` (async), skips the GLSL/`postprocessing`
   plugins + the WebGL GPU timer, and **renders the streamed world — the player walks, streaming works.** three's
   auto-conversion of standard materials (`MeshBasicMaterial` → node) carries the world without porting shaders.
2. **WebGPU (no bundle) is already ~3× faster here than WebGL:** full world at **19.43 ms / 4597 draws** vs the
   WebGL **~65 ms** `ls-noon` baseline. **Caveat:** not apples-to-apples — WebGL runs our heavy custom shaders,
   WebGPU runs simple auto-converted materials. Porting the real materials to TSL will raise the WebGPU cost, so
   19.43 ms is optimistic. But it shows WebGPU's per-draw + submission overhead is genuinely lower.
3. **Per-cell BundleGroups are wired** into streaming (`cellContainer` factory → one `BundleGroup` per cell,
   dropped on unload; `?bundle=0` for the A/B, `?bundle=root` for one shared bundle).

## ⛔ The blocker — static bundle transform baking

A static `BundleGroup` renders the world, but **incorrectly**:

- `?bundle=root` (one shared bundle): the **far LOD ring renders correctly** (distant skyline, hills, palms), but
  the near ring shows **stretched/distorted geometry** — triangles smeared toward a point. That is the classic
  signature of **wrong model matrices**: a static bundle bakes each object's transform at record time, and some
  objects are recorded with a stale/identity matrix (not yet updated by the −90°X streaming-root chain), so their
  vertices render at the wrong place.
- `?bundle=…` per-cell: renders even less (~106–150 draws, mostly empty) — the same baking issue, worse because
  each cell's bundle records at a different (often bad) moment as it streams in.

Two things three's static bundles fight with in this engine:
- **Transforms:** cells live under a rotated (−90°X) streaming root; the bundle must record after `matrixWorld` is
  finalized for every child, or it bakes garbage.
- **Dynamic streaming:** bundles added to an already-live scene, one per frame, aren't picked up cleanly (needsUpdate
  helped little).

Also: `renderer.info.render.drawCalls` does **not** see inside `executeBundles`, so the on-screen `draws` / `render
CPU` under bundles are **unreliable** — a proper bundle measurement needs GPU-timer or a bundle-aware counter.

## Fix attempts (didn't crack it via browser rounds)

`frustumCulled = false` on bundled objects · skip the cell fade under bundles (static bundle bakes opacity) ·
`needsUpdate = true` after populating · single shared root bundle. Each improved *something* but none produced a
correct full-world bundle render.

## Assessment

The **thesis stands** (synthetic Phase 0 + 1a proved bundles collapse submission and invalidate granularly). The
real-engine integration hit a genuine three.js `WebGPURenderer` + static-`BundleGroup` interaction around
**transform baking + dynamic scene updates**. This is solvable but needs **focused investigation, not blind
browser rounds**:

- a minimal three.js WebGPU repro (BundleGroup + a transformed/instanced mesh streamed in over time) to find the
  exact record-timing/matrix rule;
- read three's bundle recording path (`RenderBundles` / `_renderBundle`) re: when/how model matrices are captured;
- check three examples/issues for streaming-scene bundle patterns and the correct invalidation API.

## Recommendation

**Bank the progress; take the bundle bug as focused follow-up.** We have: the engine running under WebGPU (big),
the thesis proven, and a promising (if not apples-to-apples) no-bundle number. The remaining work — the TSL material
port (Phase 1) and the bundle transform fix — is execution, best done deliberately with a minimal repro, not by
one-fix-per-reload. The `webgpu` spike branch + this findings doc capture exactly where to resume.
