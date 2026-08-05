# 099/02 — The rigid UV-anim lane (per-model uniform, identity slot 0, dynamic offsets)

The engine half: play the animations 01 delivered, at ZERO cost and bit-exact identical output for
every model that has none — which is every car, every ped and every current script object except the
wheel's lights.

## Decisions

1. **One uniform buffer per animated model, dynamic offsets select the transform per submesh.**
   Layout: slot 0 = IDENTITY `(0, 0, 1, 1)` **always**; slots 1..N = the model's animations. Slot
   stride = 256 B (`minUniformBufferOffsetAlignment` — WebGPU's floor). Models WITHOUT animations
   share one engine-global identity buffer, so they allocate nothing.
2. **The binding rides the existing VEHICLE material bind group** (`createVehicleBindGroup` /
   `rigidBindGroup`): a new `{ buffer, hasDynamicOffset: true }` entry on the vehicle material layout.
   `drawVehicles` already rebinds group 1 per texture array; it now passes
   `[UV_ANIM_STRIDE * (submesh.uvAnim === undefined ? 0 : submesh.uvAnim + 1)]` as the dynamic
   offset. Rigid draws are UNBUNDLED (pass-encoded every frame), so the layout change cannot stale
   any recorded bundle — the world's bundled `materialLayout` is untouched (restriction noted in the
   plan readme). The ped path shares the rigid shader family: it binds the identity buffer at offset
   0 and is behaviourally unchanged.
3. **One keyframe stepper, shared with the world.** Extract the manifest-path walker
   (engine.ts `advanceUvAnimations`, the lerp at 1997–2017 with its paired-keyframe step handling)
   into a helper both lanes call. Per frame, ONLY models that (a) carry animations and (b) have a
   live instance step their transforms and `writeBuffer` — a scene without animated script objects
   pays nothing (the counter proves it in tests).
4. **WGSL: the world's exact term** — `uv * uvAnim.zw + uvAnim.xy` — applied in the rigid (and ped,
   via the shared include) vertex path. Identity makes it algebraically a no-op, and the A/B in
   verification makes "no-op" a MEASURED claim, not an assumed one (the goals rule).

## Subtasks

- [ ] `VehicleModelInit`/`VehicleModel`: carry `uvAnimations` + per-submesh index;
      `createVehicleModel` mints the per-model uniform (animated models only) and destroys it in
      `destroyVehicleModel`.
- [ ] Vehicle material layout + `createVehicleBindGroup` + `rigidBindGroup` (cache key unchanged —
      the buffer is per-model, the offset per-draw) + `drawVehicles` dynamic offset.
- [ ] Shared stepper helper + the per-frame advance for live animated models (frame clock `seconds`,
      the same one the world lane reads — the two lanes must not drift).
- [ ] WGSL: rigid/ped shader include; identity default.
- [ ] Tests (fake GPU, decisions not API calls): a no-anim model performs ZERO uvAnim buffer writes
      and still draws; an animated model's uniform WRITES advance between two frames stepped 0.3 s
      apart (f13d's cadence is 0.225 s); a flagged submesh draws with a non-zero dynamic offset,
      unflagged with 0; destroy frees the uniform (leak ledger).
- [ ] Bench guard: the standard bench scene (no animated models) before/after — frame cost delta
      within noise, numbers into the ledger AND `docs/benchmarks/` per the reporting rule; screenshot
      A/B on a stock-car scene proves bit-identical output (wind 0, water off — the edge-cases
      pixel-A/B recipe).

## Verification

Headless: spawn the (01-rebaked) lights model as a script object, two HUD-stamped screenshots 0.3 s
apart differ in the bulb texels; a stock car scene is pixel-identical to pre-change; bench numbers
recorded. All engine + web suites green.

## Ledger

_(numbers on completion)_
