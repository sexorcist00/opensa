# Engine rendering edge cases

Limits and deliberate approximations of the own WebGPU engine.

- **WebGPU `sampleCount` is 1 or 4 only**; alpha-to-coverage needs 4. No arbitrary MSAA ladder (the old
  `msaa`/`bloomq` params were removed for this).
- **World shadowing is baked, the sun doesn't track.** Per-pixel shading of the ~1,038 static 2dfx lamps
  cost 120 → 25 fps; instead the world carries a baked arc-averaged sun-visibility scalar. Street lamps
  light nothing but themselves — surface lighting from lamps is unimplemented (plan 074/17, deferred).
- **No runtime SSAO.** A vehicle carries its own AO instead: `vehicle/sky-occlusion.ts` computes per-vertex
  sky visibility from a height field over the car's shown shell (LOD/`_dam` excluded, so a convertible is
  not roofed by its own LOD blob) and it rides in the night set's alpha. It darkens what is UNDER something
  — cabin, underbody, exhaust — and nothing else: a panel gap and the contact with the ground still can't
  darken, and PEDS get no AO at all. Reflection strength stays an open row of plan 084.
- **A TEXTURED material with SA's `reflection` plugin but no env map still renders matte.** Reflectivity
  without an env map is granted to UNTEXTURED materials only (bare metal and plastic — exhausts, trim,
  bumper irons). The mods' exporter stamps `reflection` on every material it writes, so honouring it
  everywhere turned 100 % of both field mods reflective, carpet and tyres included. Plan 084 row 2.
- **Shader-stage limits are invisible to tests.** The fake GPUDevice doesn't validate the 16-varying
  fragment-input cap or binding visibility — two shader defects shipped through 2,325 green tests. Check
  WGSL by eye (a static check is a noted follow-up in plan 084).
- **Two-sided world rendering.** SA's static world renders without backface culling (mirrored coplanar
  pairs, `0x200000 DISABLE_BACKFACE_CULLING` honoured); glass is double-sided gated by
  `@builtin(front_facing)`. Roadsign glyphs render twice at ±0.05 m; sign text does not dim at night.
- **Particles are approximate.** No heat-haze refraction (prims skipped), tracks baked at 3 sample points
  (no rotation / texture-frame animation), emission approximated by a fixed `rate × life` budget, point
  emission only. Particle 2dfx on generated LODs is kept alive by a null-`m_SystemBP` guard.
- **No corona occlusion** — coronas draw through geometry at some angles (SA traces line-of-sight; the
  engine doesn't). Traffic-light bulb cycling isn't modelled. Vehicle headlights are an MVP — no projected
  road beam.
- **Escalators don't move** — the step renderer died with the three renderer; no replacement, no step
  colliders.
- **Stochastic de-tiling (`?stoch=`) is UNSTABLE v1, default off** (plan 074/12).
- **Frustum culling only** — SA's `occlu` occlusion volumes are unused; interiors are filtered out
  entirely.
- **Streaming shows seams at speed** (deferred to the plan-21 tuning round): ≤1 cell-create/frame can spike
  ~22 ms on fast traversal; free-fly can show late cells and magenta-before-texture; the HD↔LOD swap
  visibly steps at speed.
- **No moving colliders.** IFP-animated map objects don't collide with their moving parts; breakable shards
  land analytically (one ground probe, freeze); on-foot players can't smash props (contact events fire for
  chassis colliders only — matches vanilla); `_dam` damage-model swaps are unhandled (shatter only).
- **The one perf knob is `?scale=`** (render scale, try 0.75 first on perf problems); there is no quality
  tier ladder on the engine.
- **Street-level foliage is fill-bound, and the cost is per-PIXEL, not per-triangle or per-draw.** Measured
  2026-07-21 (benchmarks #21/#22): the same ~1.46 M triangles cost 4.15 ms on a 90–120 m flyover and
  13.72 ms at 20–30 m over Ganton; removing 18 % of the triangles cut the pass 44 %, while draw calls did
  not move at all (1255 → 1258). Foliage also lands in the probe pass (2.45 → 1.57 ms on the same change).
  When a scene is slow, measure `gpuMs.pass` against leaf/canopy screen coverage — draws and triangle counts
  will mislead you.
