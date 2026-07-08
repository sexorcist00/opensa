# 003 — Cascaded shadows (buildings, vehicles, peds)

Part of the [rendering overhaul chain](readme.md). Depends on [002](002-hybrid-world-lighting.md) (the world shader that consumes the shadow term). Delivers the headline feature: **buildings cast real, moving sun shadows** — fast.

## Context

Today: one 2048² PCFSoft map, orthographic frustum `SHADOW_SIZE=45` following the view, texel-snapped, **dynamics-only casters** (sky.plugin.ts); the world receives via a manual 4-tap PCF injection (`worldShadowUniforms` in world-material.ts). 038 dropped static casters deliberately (unlit world + acne + perf). With 002's lit world the classic obstacles are addressed: smoothed normals exist (bias by slope works), and prelit-as-indirect means shadowed areas keep GI instead of going black.

Assets give us a unique lever: the LOD pipeline (opensa-lod-generator) already produces simplified per-cell meshes — ideal cheap **shadow proxies** for far cascades.

## Decisions

1. **CSM, 3 cascades** (near ~50 m dynamic-heavy, mid ~250 m, far ~1000 m), based on the three.js CSM addon but adapted to our manual world-shader injection (we don't use three's lighting plumbing for the map — the CSM split/fit/snap logic is reusable, the receive side is our own multi-cascade sampling term). Practical split to be tuned on benches.
2. **Static-caster caching**: far cascades contain almost only static geometry → re-render them only when the sun moves enough (game-time minutes) or the camera crosses a cell boundary, NOT every frame (extends the existing `shadow.autoUpdate` freeze pattern). Near cascade renders every frame (cars/peds).
3. **Shadow proxies for far cascades**: render LOD cell meshes (already in memory for the far world) instead of HD cells into mid/far cascades — big caster-count and vertex-cost win. HD casts only into the near cascade. Requires marking cell meshes with per-cascade layers.
4. **Filtering**: PCF 4–9 tap in the world shader (extend the existing manual term to cascade selection + blend bands). PCSS/contact-soft is an "ultra" tier experiment, not the default. Acne control: slope-scaled bias + normal offset (we control the shader fully).
5. **timecyc integration**: shadow strength follows the 038 fade rules (night → 0, overcast dims); dawn/dusk long shadows clamp the far cascade extent (mega-long shadows are the classic CSM budget killer — cap and fade instead).
6. **Peds/vehicles**: unchanged casters, now into the near cascade; their receive on the world comes free via the same term.
7. **Budget**: target ≤ 2.5 ms GPU total for shadows on the reference machine at 1080p (measured via 001 harness); if the far cascade breaks the budget, its resolution/update rate degrade first (quality-tier knobs from day one).

## Tasks

- [ ] CSM core: cascade split/fit/texel-snap module (port/adapt three CSM addon logic; unit-test split math), N shadow render targets, per-cascade ortho cameras.
- [ ] World-shader receive: multi-cascade selection + PCF term replacing the single-map injection; blend band between cascades; slope bias + normal offset.
- [ ] Caster management: static cells → mid/far cascades via LOD proxies + layers; HD + dynamics → near; static-cascade update scheduler (sun-delta / cell-crossing triggers).
- [ ] Dynamics receive (MeshStandard path) — either keep three's plumbing on the near cascade only, or unify onto the manual term; decide by measured cost.
- [ ] Config: `graphics.shadows` grows `{quality: 'off'|'low'|'medium'|'high'|'ultra', distance}` mapping resolution/cascades/update-rate; debug overlay controls + cascade-frustum debug view (`?shadowdebug` extended).
- [ ] Calibration: strength/bias per hour sweep; verify no acne on smoothed & flat roofs, no peter-panning at bases of buildings.
- [ ] Bench: record GPU ms per cascade, caster draw calls, on all bench scenes (esp. LV night = shadows off ⇒ zero cost, and dusk long-shadows worst case).

## Verification

- Visual: downtown LS at 08/12/17 h — building shadows sweep believably; cars/peds shadowed under buildings look coherent (indirect keeps them readable).
- Static-cache correctness: teleporting across the map and fast-forwarding game time never shows stale shadow directions (038's "yesterday's sunset" bug class — regression-test the trigger conditions).
- Budget: ≤ 2.5 ms @1080p reference, zero cost when off/night.

## Measurements

_(record after implementation)_

- ms per cascade / total; caster draws per cascade: …
- chosen splits, resolutions, update cadences: …
