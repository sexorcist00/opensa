# 074·06 — World effects parity (the WGSL ledger)

[← chain](readme.md) · prev: [05 streaming](05-streaming-runtime.md) · next: [07 baked](07-baked-channels.md)

Every effect of the shipped WebGL "modern" set, landed ONE AT A TIME behind a lab toggle, each with a before/after
row in the ledger (frame + per-pass GPU ms). Order = by risk/dependency, cheapest first. Most math already exists —
073 ported the world material, fog, moon and the light pool to node form; here it becomes owned WGSL.

## Ledger (fill as landed; Δ = GPU ms cost at 2× retina, ls-noon unless noted)

| #   | Effect                                                  | Home                                        | Source of math                                       | Δ GPU | Status                                                                                                                                                                                                               |
| --- | ------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Prelit day↔night blend (uDn)                            | vertex channels + frame UBO                 | shipped bake + 073 TSL                               |       | ✅ 2026-07-12: per-vertex `mix(day, night, dn)`; converter SYNTHESIZES night = day × (0.30, 0.32, 0.40) where no authored set (weather-reactive ambient of the old dual-tint = later refinement)                     |
| 2   | World tints (day arc / night-prelit)                    | frame UBO                                   | canvas-host drive (exists)                           |       | ✅ folded into rows 1+3 params (indirect/direct arcs); parametric `?hour`/`?daycycle=1` in the lab until row 14                                                                                                      |
| 3   | Hybrid sun (indirect prelit + N·L direct, uPipelineMix) | world WGSL                                  | 073 world-material-tsl                               |       | ✅ 2026-07-12: per-VERTEX N·L (GTA low-poly ≈ shipped look), `texel × (prelit·indirect + sunColor·NdL·direct)`; `Engine.environment` API                                                                             |
| 4   | Sky: PBR dome + horizon LUT                             | compute LUT (512×32) + sky pass             | sky.plugin math + pbrSkyParams (pure TS twin exists) | ~+0.2 | 🟡 v1 2026-07-12: fullscreen sky pass (gradient top→horizon + sun glow, depth LE, shared `skyColorFor`); PBR LUT = the remaining half. Visual: noon/dawn/dusk screens ✅                                             |
| 5   | Unified LUT fog + horizon cut + height                  | world WGSL sampling the LUT                 | GLSL FOG_FRAGMENT (ported once already)              | ~+0.2 | 🟡 v1 2026-07-12: radial exp² [start,cut] + height attenuation + hard cut; fog colour = `skyColorFor(viewDir)` — the 068 invariant holds by construction. Combined rows 4-5: +0.39 ms GPU p95 (accepted, series row) |
| 6   | Moon wrapped N·L                                        | world WGSL                                  | 073 port                                             |       |                                                                                                                                                                                                                      |
| 7   | Local light pool (headlights/brake/street)              | data texture + loop (bounded, sphere-gated) | 073-PROVEN mechanism incl. the naga lesson           |       |                                                                                                                                                                                                                      |
| 8   | Night emissives (luma-delta glow)                       | world WGSL (vertex channels)                | 073 port; replaced by 07's baked mask when it lands  |       |                                                                                                                                                                                                                      |
| 9   | Timed window glow overlays                              | ObjectRecord draws + uniform                | applyWorldWindowGlow semantics                       |       |                                                                                                                                                                                                                      |
| 10  | Wind sway                                               | vertex WGSL (sway weight channel)           | wind.mod GLSL                                        |       |                                                                                                                                                                                                                      |
| 11  | Beam floodlights (vertex-alpha cones)                   | `beam` pipelineClass                        | plan 032 semantics (premultiplied now)               |       |                                                                                                                                                                                                                      |
| 12  | Water (waves/shore depth/glint)                         | water pass                                  | water.plugin GLSL port                               |       |                                                                                                                                                                                                                      |
| 13  | Coronas + 2dfx particles                                | particle pass (instanced billboards)        | corona/particles shaders                             |       |                                                                                                                                                                                                                      |
| 14  | Weather/timecyc drive                                   | frame UBO fill (CPU)                        | existing sampling code (pure TS, reused as-is)       |       |                                                                                                                                                                                                                      |

## Notes per risky item

- **(4) LUT**: generated by a small compute pass on time/weather change (not per frame); the CPU twin
  (`pbrHorizonAverage`) stays as the test oracle — unit-compare LUT texels vs the TS twin.
- **(5) fog**: fog term lives IN the world shader (as WebGL does) — no scene-fog abstraction at all.
- **(7) pool**: data-texture mechanism proven in 073; keep the sphere gate AND the guardrail lint (no
  uniform-array indexing in loops) — this exact effect produced the 250 ms lesson.
- **(12) water** is the largest single shader port; schedule last in this plan; shore depth needs the depth
  texture — the frame graph already exposes it (01).
- Visual acceptance: screenshot compare vs WebGL prod on the bench scenes at noon/dusk/night per effect batch —
  "≥ parity" is a human call recorded in the ledger, regressions get a diff image in the plan folder.

## Tasks

- [ ] Frame-UBO layout covering 1–3, 5–8, 14 (one struct, one write/frame) + the canvas-host-equivalent drive
      code moved into the lab (pure TS, reused).
- [ ] Land effects in ledger order, one toggle + one ledger row each; stop and measure at every step.
- [ ] LUT compute pass + oracle test vs the TS twin.
- [ ] Water port (biggest chunk — its own sub-checklist when reached).
- [ ] M2 screenshot-parity sweep (noon/dusk/night × bench scenes) archived next to this doc.

## Measurement ledger

(the table above is the ledger — keep Δ honest; plus end-of-M2 totals: full-set GPU ms vs M0 bare world)
