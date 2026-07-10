# 069 — Water

Part of the [rendering overhaul chain](062-rendering-overhaul.md). Depends on [068](068-unified-fog.md) (shared fog chunk + horizon LUT). Replaces the current water shader with a modern one.

## Context

Today (`water.plugin.ts` over the `water.dat` mesh): animated ripple normals + slow swell, fresnel blend deep-tint→horizon, Blinn sun glint, timecyc colours/alpha, hand-rolled fog. Honest 2010-era water. Missing: real wave shapes, shore interaction (depth-based transparency/foam), reflections of the world (only sky fresnel today), refraction, and an underwater state.

## References to evaluate (user asked for concrete options)

| Option                                                            | What it gives                                          | Cost/notes                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| three.js `Water` addon (`webgl_shaders_ocean`)                    | planar mirror reflection + normal-map ripple           | one extra scene render for the mirror — expensive with our draw counts; reflection could render LOD cells only |
| three.js `Water2` addon                                           | reflection + refraction + flow maps                    | same planar cost ×2; flow maps irrelevant for sea                                                              |
| Gerstner waves (shader-only, e.g. GPU Gems ch. 1 formulation)     | real displaced wave shapes, choppiness, cheap          | vertex-shader only — needs a tessellated water grid near camera (projected grid or radial mesh)                |
| FFT ocean (jbouny/fft-ocean; Tessendorf "Simulating Ocean Water") | best open-ocean spectrum                               | heavy (FFT per frame); likely overkill for SA's coastal water                                                  |
| SSR via 0beqz/realism-effects                                     | screen-space world reflections, no second scene render | ghosting/edge artefacts; composes with our pmndrs composer; ultra tier                                         |

Recommended composition: **Gerstner (3–4 octaves) + depth-based shore + planar reflection at half-res rendering LOD-cells-only, SSR as ultra alternative** — believable SA coastal water without FFT machinery.

## Decisions

1. **Keep the `water.dat` zoning** (sea level, pools) as the source of truth; add a **near-camera tessellated ring** (projected/radial grid) for Gerstner displacement, decaying to the flat far plane that 006's fog cuts at the horizon.
2. **Depth-based shore**: needs a scene depth texture (the composer's depth already exists for SSAO) — water transparency ramps by water-floor depth (clear shallows → deep tint), plus a foam band at intersection. This single feature is the biggest realism jump per ms.
3. **Reflections staged**: stage 1 = sky-only reflection via the PBR sky + horizon LUT (free, already better than today since the sky is better); stage 2 = half-res planar mirror rendering far LOD cells + sky only (measured decision); SSR experiment last.
4. **Underwater**: camera-below-surface state — tinted fog (006 chunk with underwater params), waterline meniscus strip, muffled sky. Scope-boxed to "looks intentional", not a diving feature.
5. **timecyc stays the colourist**: water RGBA per hour/weather keeps driving tint/alpha so lakes at dusk keep their SA mood.
6. **Budget**: ≤ 1.5 ms base tier; planar reflection only if it fits in +1.5 ms half-res on reference.

## Tasks

- [ ] Water grid: near-camera tessellated ring following the camera + far flat plane; seams verified (skirt/blend zone).
- [ ] Gerstner vertex displacement (3–4 octaves, wind-aligned by weather) + normal reconstruction; storm/calm sets per weather class.
- [ ] Shore depth: depth-texture sampling, transparency ramp + foam band (noise-scrolled); verify against beaches, Verona/Santa Maria bench.
- [ ] Reflection stage 1 (sky+LUT), stage 2 planar (half-res, LOD-only scene list, mirror camera) behind `graphics.water.reflection: 'sky'|'planar'|'ssr'`.
- [ ] Sun glint upgrade (GGX-ish spec against the real sun dir) + glint on wave crests only.
- [ ] Underwater state (fog params swap + waterline strip).
- [ ] Fog: consume the 006 chunk (delete remaining private fog); horizon cut verified over open sea.
- [ ] Config/debug sliders (`graphics.water` grows), bench numbers per stage.

## Verification

- Beaches: shore transparency + foam read naturally at noon and dusk.
- Open sea horizon: pure fog cut (006 regression re-run over Gerstner geometry).
- Reflection A/B: sky-only vs planar screenshots; measured ms decides the default tier.

## Measurements

_(record after implementation)_

- base water ms / planar ms / SSR ms: …
- final wave/foam parameter sets per weather: …
