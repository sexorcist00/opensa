# Plan 099 — UV animations on script objects (the ferris wheel's blinking lights)

**STATUS: DONE 2026-08-07** — all three steps shipped; the user rebuilt and ran the game and the bulbs
step ("looks perfect"). The `docs/edge-cases/engine-rendering.md` row is removed, the limitation is
lifted. ONE open item, named in 02's and 03's ledgers: the bench guard was never run, so "zero cost for
a model without animations" is proven CPU-side (no allocation, no per-frame write) and unmeasured on
the GPU. The edge-cases text below is kept as the diagnosis record.

**Field report (2026-08-05, the 097/07 bug round):** the Pacific Park ferris wheel spins but its light
bulbs do not BLINK the way the original mod does under SA. Diagnosis is complete and recorded in
`docs/edge-cases/engine-rendering.md`: the blink is a **UV animation**, not a script effect —
`ferriswheel_lights.dff` carries a UVAnimDict entry `f13d`, and its `Frames` material (a film-strip
texture of bulb states) references it via the material's UV-anim effect. The CLEO script only rotates
objects. Our WORLD path plays exactly this mechanism (kind-4/5 objectTable draws, plan 074/18 B7·c);
the RIGID path — every script-spawned object, the osm spike, and incidentally every vehicle — has no
UV-anim lane, so the material renders frame 0 forever.

## Measured recon (2026-08-05, all against the mod's own dff)

- `parseDff` already recovers EVERYTHING: `clump.uvAnimations = [{ name: 'f13d', duration: 29.25 }]`
  and `material('Frames').effects.uvAnim = { channelMask: 1, names: ['f13d'] }`. No parser work.
- `f13d` is a STEP animation: paired keyframes at the same timestamp jump `uv offset.x` by
  `0.07692 ≈ 1/13` every **0.225 s** — a 13-frame film strip, full loop 29.25 s (130 steps). The
  engine's existing keyframe walker (`advanceUvAnimations`, engine.ts) handles paired-keyframe steps
  already — the world's LV skull sign crawls through the same code.
- The world converter's binding logic is `resolveUvAnim` (`packages/cell-weld/src/weld.ts:904`):
  material effect name → clump dict entry → registry slot. The rigid builder
  (`packages/renderware/src/vehicle/build-vehicle-model.ts`) ignores `material.effects.uvAnim` — that
  is the whole gap.

## Restrictions check (docs/restrictions/ + engine invariants, read 2026-08-05)

- **No render-bundle staleness risk**: rigid draws are encoded directly in the pass
  (`drawVehicles`), never recorded into bundles — a new bind-group binding on the VEHICLE material
  layout cannot invalidate cell bundles. The world's `materialLayout` (bundled) is NOT touched.
- **The frame uniform is not grown** (growing it stales every cell bundle — engine.ts:1109 comment).
  The transform rides a NEW per-model uniform with dynamic offsets.
- **`.osm` DESC evolution follows the established optional-field pattern** ("absent on old fixtures"
  — bounds/center did the same): an old `.osm` reads as "no animations", byte-identical behaviour.
- **No original-logic port**: we read the mod's authored DATA (the dict + the material effect — the
  same data SA reads) and play it in our own lane; cadence and offsets come from the keyframes,
  nothing is fitted.

## The chain (each step ships alone)

1. **[01 — bake the animation through](./01-bake-the-animation-through.md)** — builder → fixture →
   `.osm` → `readModelOsm`, ending with the rebaked ferris `.osm` carrying `f13d`.
2. **[02 — the rigid UV-anim lane](./02-engine-rigid-uv-lane.md)** — the per-model transform uniform
   (identity slot 0, dynamic offsets), the shared keyframe stepper, the WGSL term; zero cost and
   bit-exact no-op for every model without animations.
3. **[03 — field close-out](./03-field-close-out.md)** — full rebuild, the blink proven by a
   timed screenshot A/B at the wheel, numbers to the ledger, the edge-cases row REMOVED (limitation
   lifted), docs synced.

Named beneficiaries beyond the wheel: any future scripted/animated mod object with film-strip or
scrolling materials (billboards, signs), and 097/08-authored scripts get it for free.
