# Ideas — 0.5.0

Future-work plans for the 0.5.0 cycle. Same convention as [0.4.0](../0.4.0/readme.md): each feature is a chain of
small, individually-implementable plans under [plans/](plans/), ending with verification + measurements.

## Water, done right (the "real waves" rework)

The 0.4.0 rendering chain's water ([plan 069](../../plans/069-water.md)) shipped a v1 that reached the ceiling of its
"displace only the normal" approach — a flat surface with a moving glint but no travelling waves, a half-res
depth-shore that flickered around pier piles and cost FPS, and a glassy look. 0.5.0 replaces the surface with a
**camera-following displaced Gerstner grid** (real vertex motion → waves that travel and break), foam from the wave
Jacobian (no depth buffer, no flicker), sky-LUT reflection (free), and an optional baked shoreline for surf run-up.
No ready-made library fits our `WebGLRenderer` + draw-call-bound budget (three `Water` is a full-scene planar mirror;
`WaterMesh` is WebGPU-only) — the plan builds a compact own shader and reuses everything good from v1.

Full plan: [plans/01-water/readme.md](plans/01-water/readme.md).
