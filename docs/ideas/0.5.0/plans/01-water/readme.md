# 01 — Water, done right (the "real waves" rework)

The rendering chain's water (plan [069](../../../../plans/069-water.md)) shipped a v1 that reached the ceiling of
its approach and the user rejected it: **the surface is geometrically flat** (we displace only the _normal_, so a
sun-glint moves but the water never _moves_ — no rolling swell, no wave silhouette, no run-up on the beach), the
half-res depth-based shore **flickers around thin geometry** (pier piles) and cost FPS, and it read as glassy. This
plan replaces that surface with one built around **real vertex displacement**, at minimum resource cost, on our
`WebGLRenderer` and our draw-call-bound budget.

Reference look (user-supplied, not viewable by the author): the two clips the user linked — real SA-style water with
travelling waves and a living shoreline. The target is "the waves actually move and break", not photoreal FFT ocean.

## Why not a ready-made library (evaluated, rejected for our constraints)

| Option                                                           | Verdict for OpenSA                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| three.js **`Water.js`** (examples/jsm/objects)                   | **No.** It is a **flat mirror** (`Reflector` → a full second scene render into a WebGLRenderTarget every frame). We are **draw-call-bound** already (063 baselines: 10 k draws ≈ 50 ms at 16 ms GPU); a planar mirror ~doubles the draws in that window. And the mesh is still flat (normal-map ripple only) — the exact problem we're escaping. |
| three.js **`Water2.js`**                                         | **No.** Same planar reflection + refraction (two extra scene renders) + flow maps irrelevant to open sea.                                                                                                                                                                                                                                        |
| three.js **`WaterMesh.js`** (new TSL)                            | **No.** WebGPU-only (`WebGPURenderer`); we run `WebGLRenderer`. Revisit only if OpenSA ever moves to WebGPU.                                                                                                                                                                                                                                     |
| **FFT ocean** (jbouny/fft-ocean; Tessendorf)                     | **Overkill.** An FFT per frame for coastal water; heavy and it models open-ocean spectra we don't need.                                                                                                                                                                                                                                          |
| **SSR** (pmndrs/postprocessing `SSRPass`, 0beqz/realism-effects) | **Later, ultra tier only.** Screen-space, so no second geometry pass — composes with our composer — but ghosts at edges and only reflects on-screen geometry. A stretch add-on to the plan below, never the base.                                                                                                                                |

**Decision: our own compact Gerstner surface**, no runtime dependency. Reasons: (1) it displaces vertices → the
waves actually travel and break, which is the whole point; (2) it reflects the sky from the **067 horizon LUT we
already bind** — zero extra passes, and it already matches sky+fog by construction; (3) it plugs straight into our
timecyc/`seaState`/fog chunk instead of fighting a library's own colour + fog model; (4) it is ~one shader, far less
than adapting + de-perf-ing a mirror addon. Everything the library would give us that we actually want (wave shape,
foam, reflection) we get cheaper by owning it.

## The core idea — a near-camera displaced grid, flat far plane

1. **Projected / radial grid that follows the camera.** `water.dat`'s giant quads can't be displaced (4 verts over
   hundreds of metres) — THAT is why v1 went flat. Add a **fixed-resolution grid (~128×128) parented to the camera**
   (a radial "disc" or a screen-space _projected grid_), tessellating the near ~300 m densely and decaying to the
   existing flat `water.dat`/ocean-frame plane beyond, where 068's fog cut hides the seam. Fixed vertex count →
   fixed, predictable cost regardless of view. Clip to the actual water zones (don't displace where `water.dat` says
   there is land/tunnel — sample a coarse water mask or keep the flat plane's coverage test).
2. **Gerstner vertex displacement** (3–4 trains, wind-aligned from `seaState`). Real Gerstner moves each vertex in a
   circle (crests pinch, troughs flatten) — travelling waves + silhouette. Normal comes from the analytic Gerstner
   Jacobian (exact, no texture). Amplitude/steepness/wind from the existing pure `seaState()` (kept — it's good).
3. **Foam from the wave itself, not from screen depth.** The Gerstner **Jacobian** goes negative exactly where a
   crest is about to break → that is the whitecap mask, in world space, per vertex, with NO depth buffer. This kills
   both v1 problems at once (flicker + the extra DepthPass): whitecaps ride the real crests, and there is nothing to
   alias.
4. **Shore & run-up without a screen-space DepthPass.** Two candidates, pick by measurement:
   - **(a) Distance-to-shoreline, baked.** pmb/offline can rasterise a coarse **shore-distance field** for the
     water zones (metres to the nearest land edge). The surf band + run-up animate along that field — cheap, stable,
     no per-frame depth pass, no pile flicker. Preferred (it's data, computed once).
   - **(b) A full-res near-only DepthPass**, gated to the tessellated ring only. Keeps v1's idea but drops the
     half-res aliasing and the whole-scene cost. Fallback if the baked field is too much offline work.
5. **Reflection from the sky LUT (free), SSR as ultra.** Base = the 067 sky LUT sampled by the reflected ray (v1
   already does this well). Ultra tier: SSR via pmndrs for on-screen geometry (piers, boats) — screen-space, no
   second geometry render.
6. **Underwater + waterline** kept from v1 (the murk works); add the meniscus strip v1 skipped.

## Resource budget (the "minimal" mandate)

- **No extra full-scene pass** on the base tier (the LUT reflection is free; the DepthPass is removed or replaced by
  a baked field). This directly answers the user's FPS complaint — v1's cost was the whole-scene DepthPass.
- Vertex cost is bounded and constant (fixed grid), not per-water-quad. Gerstner is a handful of sin/cos per vertex.
- Fragment cost ≈ v1 (LUT reflect + glint), minus the broken depth read.
- Tiers (feeds 072): **low** = flat plane + LUT reflection + glint (no grid, no foam — basically v1 minus the
  depth); **medium** = displaced grid + Jacobian foam; **high** = + baked shoreline surf/run-up; **ultra** = + SSR.

## Tasks (sequential)

- [ ] Grid: camera-following radial/projected grid (fixed res) + decay to the flat far plane; seam hidden by the
      068 fog cut; water-zone clipping so it doesn't displace over land/tunnels. Verify no seam, no flooding of
      tunnels (the reason `water.dat` isn't a full plane).
- [ ] Gerstner vertex displacement + analytic Jacobian normal; `seaState` drives amplitude/steepness/wind;
      calm↔storm continuous. Unit-test the Jacobian sign (foam mask) and normal against finite differences.
- [ ] Foam from the Jacobian (whitecaps on breaking crests) — no depth buffer.
- [ ] Shoreline: baked shore-distance field in pmb (preferred) OR a near-only full-res DepthPass (fallback);
      surf band + run-up animate along it. Verify: no pile flicker, a living waterline, stable under camera motion.
- [ ] Reflection: LUT base (port from v1) + optional SSR ultra behind `graphics.water.reflection`.
- [ ] Underwater murk (port v1) + waterline meniscus strip.
- [ ] Config/tiers + debug sliders; bench each tier (the perf complaint is the headline metric — record ms with the
      grid on/off and vs the flat far plane).

## Verification

- The waves **travel and break** (side-by-side against the reference clips), a beach has a moving waterline, and
  there is no flicker around pier piles.
- Base tier adds **no full-scene pass** — measured ms delta over the flat-plane water is small and constant.
- Open-sea horizon still resolves into the 068 fog cut (no sea/sky seam); classic pipeline untouched.

## Migration from 069 v1

069 v1 (normal-only surface + half-res depth shore) stays in tree as the fallback / `low` tier lighting of the water
until this lands; the flicker-prone DepthPath is removed once the baked shoreline (or near-only depth) replaces it.
Keep the good parts verbatim: `seaState()`, the LUT reflection, the GGX glint, the underwater tint, the timecyc
colour wiring, and the fog-chunk integration.
