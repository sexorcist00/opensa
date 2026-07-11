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

## Isolated repro — what it ruled out (2026-07-11)

`apps/web/src/standalone/webgpu-bundle-repro.ts` (`/webgpu-bundle-repro.html`) renders an InstancedMesh (400
instances) in a static `BundleGroup`. Every isolated case rendered a **clean grid** — so these are NOT the cause:

- InstancedMesh inside a static BundleGroup ✅
- under a −90°X rotated parent ✅
- added to an **already-live** scene after 60 frames (`?stream=60`) ✅ (dynamic add works)
- `?fix=world` / `?fix=late` made no difference (already clean)

So the bundle mechanism is fundamentally sound in this three version. The engine bug is **emergent from the full
integration**, and the isolated repro doesn't contain it. By the "stretched triangles" symptom (some vertices
collapse to origin), the leading remaining suspects are:

1. **Animated / skinned meshes in a static bundle** — their bone/animation matrices aren't captured, collapsing
   vertices (cf. the `barberpole2.quaternion` PropertyBinding warning). Static bundles must contain **static
   geometry only**; animated props must stay out.
2. **Re-record churn** — routing all cells through one shared bundle (or per-cell bundles) with `needsUpdate` on
   every stream add/remove keeps the bundle perpetually re-recording mid-stream.
3. **Auto-converted material quirks** — the world runs `MeshBasicMaterial` + dangling `onBeforeCompile` GLSL that
   WebGPU ignores; those materials in a bundle may behave differently than a clean node material.

## Recommendation (updated) — sequence bundles AFTER the TSL port

Chasing the bundle bug on the **current auto-converted-material stopgap** is fighting a hack: the materials aren't
real node materials, animated vs static geometry isn't separated, and the streaming churns the bundle. The clean
path is the plan's original order:

1. **Port materials to TSL** (Phase 1 proper) — real node materials, correct day/night/fog/shadow.
2. **Separate static world geometry from dynamic/animated objects** — only the static world goes into bundles.
3. **Then** wrap the static world in per-cell bundles — on a solid base, with the repro-proven mechanism.

Trying to bundle before (1) and (2) is premature. The spike branch + repro have de-risked the **mechanism**
thoroughly; the engine integration should resume in that order, not by bolting bundles onto the stopgap.

## Recommendation

**Bank the progress; take the bundle bug as focused follow-up.** We have: the engine running under WebGPU (big),
the thesis proven, and a promising (if not apples-to-apples) no-bundle number. The remaining work — the TSL material
port (Phase 1) and the bundle transform fix — is execution, best done deliberately with a minimal repro, not by
one-fix-per-reload. The `webgpu` spike branch + this findings doc capture exactly where to resume.

## TSL material integration (2026-07-11) — renders correctly, but a perf stall

Slices verified in isolation (`/webgpu-tsl-material.html`): the SA world material's **classic path** (texel × mix(day,
night, dnBalance) × tint) and the **modern sun N·L** term author cleanly in TSL and look right. **Integrated into the
engine** (`world-material-tsl.ts` + `setWorldMaterialTslBuilder`; canvas-host registers it + a per-frame `syncWorldTsl`
system under `?webgpu=1`): the world **renders beautifully** — prelit/night shading, detailed buildings, vegetation
(screenshot captured). **Major milestone: the world material port works and looks right.**

BUT the per-draw cost is bad. Measured in-engine at Ganton: **render CPU 125 ms for 4367 draws** — the world
renders correctly, just at ~8 fps. That's **~28 µs/draw** vs the auto-converted path's **~4 µs/draw** (19 ms / 4597)
— **the custom-`colorNode` TSL material is ~7× more expensive to submit per draw.** (Not compilation — the world
does fully render; it's a steady per-frame CPU cost.) three's WebGPURenderer submits its optimized built-in
materials far cheaper than a material with a custom `colorNode`; a shared-uniform node graph re-bound per draw is
the likely culprit. This makes the TSL world material, as written, impractical until the per-draw cost is profiled
and cut.

Also parked here: **bundles are OFF by default** (`?bundle=1`/`root` to opt in) — the frustum-culling-off workaround
for the bundle transform bug caused a no-cull perf spiral of its own.

### Resume points (deliberate, not blind rounds)
1. **Profile the ~28 µs/draw TSL submit cost — the make-or-break gate.** Compare a custom-`colorNode`
   `MeshBasicNodeMaterial` vs a plain built-in one at N draws in an isolated bench; find what three re-binds per
   draw for custom node materials (the shared uniform group? a per-material bind group?). Options: one shared
   material driven by instancing/attributes; a batched path; or `NodeMaterialObserver` to mark the graph static.
   If custom node materials can't approach the built-in per-draw cost, the whole TSL port is in question.
2. Then the material slices (CSM shadows → fog → emissive) + dynamic-object materials (player/cars are black
   silhouettes — lit/skinned materials, not the world material).
3. Bundles (transform bug) after static/dynamic separation, as before.

## Precise root cause (2026-07-11) — WebGPU pipeline compilation on the streaming frame

Corrected by testing: standing still fully loaded, render CPU is **30 ms** (~33 fps) — the TSL material is fine.
The earlier 125 ms was the **compilation tail** during load. The real problem: **moving the camera near-freezes**
the tab. Standing still = no new cells = smooth; moving = new cells stream = freeze. So the stall is
**WebGPU compiling pipelines synchronously on the cell-appearance frame** — material-agnostic (would hit the
auto-converted path too), NOT the TSL material and NOT bundles.

`game.precompile` DOES call `renderer.compileAsync(holder, camera, scene)` and `WebGPURenderer` supports it, yet the
stall persists → the pre-compiled pipeline (compiled in a plain `holder` group) **doesn't match the real render
pipeline key** (real objects render under the −90°X `streamingRoot`, as `InstancedMesh`, in a different bind-group /
render-pass state) → cache miss → resync-compile on appearance → freeze.

### THE gate (resume point #1, corrected)
Make WebGPU pre-compile the pipeline that the REAL render will use, off the appearance frame. Investigate:
- does `compileAsync` need the objects compiled in their real parent (rotated root) / as InstancedMesh, not a bare
  holder? Compile against a matching context.
- what does three key the WebGPU pipeline by — confirm the holder-compile and the real-render produce the same key.
- fallback: pre-warm each world-material variant at boot with representative geometry/instancing so streaming never
  compiles live.

This is material-agnostic and the single make-or-break issue for WebGPU streaming. Everything else (TSL slices,
dynamic materials, bundles) is downstream of it.
