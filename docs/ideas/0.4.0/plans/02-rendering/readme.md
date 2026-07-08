# 02 — Rendering overhaul (the "modern lighting" fork)

Full rework of OpenSA's rendering toward modern-game visuals while **preserving the San Andreas prelit vibe**. This is the "modern-lighting fork (T3)" that plan [038 — SA prelit world lighting](../../../../../docs/plans/038-sa-prelit-lighting.md) explicitly left out of scope. 038's sa-prelit look stays as the shipping baseline and the A/B reference throughout — every stage lands behind a toggle and is judged against it.

## Where we start (038 aftermath — already shipped)

Not a greenfield: sun `DirectionalLight` + PCFSoft shadow map (dynamics-only casters, world receives via manual injection in `world-material.ts`), procedural gradient sky dome with fbm clouds/stars/moon (`sky.plugin.ts`), `FogExp2` tracking the sky horizon colour (`fog.plugin.ts`), animated fresnel water shader (`water.plugin.ts`), corona sprites for 2dfx lights (`corona.ts`), MVP headlights (glow + corona flares, flagged for redo in plan 033), timed objects/lit windows (`timed-object.system.ts`, `windowGlow`), and a pmndrs `postprocessing` composer (SSAO → god-rays → bloom → ACES → SMAA, `postfx.plugin.ts`). Per-frame wiring hub: `apps/web/src/ui/canvas-host.tsx`.

## The central design problem

SA's prelit vertex colours already CONTAIN Rockstar's baked sun, sky and building shadows. A modern renderer adds real direct sun + moving shadows — naively stacked on prelit, light is counted twice (washed-out days) and baked shadows fight real ones. The chain's core idea:

> **Re-interpret prelit as the INDIRECT (GI/ambient) term** and add a calibrated real direct-sun term × real shadow on top: `colour = albedo × (prelit × indirectScale + sunColour × NdotL × shadow × directScale)`. Start with a global timecyc-driven split (shader-only, no new data); upgrade later with per-vertex baked channels (sun visibility / AO) from a new perfect-map-builder step — we own the map build (normals + smoothed groups already computed) and are free to leave DFF/TXD behind for opensa-native assets.

## Principles

1. **Vibe first**: SA's palette, timecyc moods, dawn/dusk/night atmosphere must survive; night keeps prelit + night vertex colours, and they should GLOW (bloom-fed emissives), not be replaced.
2. **Fast AND beautiful**: every stage has a frame-time budget measured on the reference machine before/after (standing rule: numbers into the plan doc). No stage ships without its measurement.
3. **Staged, toggleable, reversible**: each plan lands behind `Config.graphics` toggles with the 038 look as fallback; the default flips only in the final plan.
4. **One source of truth per phenomenon**: e.g. ONE fog function shared by world/water/sky shaders (today water re-implements fog by hand), the sky horizon LUT feeding both fog and water.

## The chain

| #   | Plan                                                                                       | Delivers                                                                                 | Status |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------ |
| 1   | [001 — Foundations: instrumentation & colour pipeline](001-foundations-instrumentation.md) | perf HUD + benchmark harness + baselines; linear/tonemap decision; A/B scaffolding       | idea   |
| 2   | [002 — Hybrid world lighting](002-hybrid-world-lighting.md)                                | real sun light on the prelit world without double-counting (indirect/direct split)       | idea   |
| 3   | [003 — Cascaded shadows](003-cascaded-shadows.md)                                          | buildings/cars/peds cast real shadows: CSM, static-caster caching, LOD shadow proxies    | idea   |
| 4   | [004 — Modern asset step in perfect-map-builder](004-pmb-modern-asset-step.md)             | opensa-native format (meshopt/KTX2) + baked channels: AO, sun visibility, emissive masks | idea   |
| 5   | [005 — PBR sky & clouds](005-pbr-sky-clouds.md)                                            | physically-based sky, 512×1 horizon LUT, weather clouds (skybox → volumetric)            | idea   |
| 6   | [006 — Unified fog & aerial perspective](006-unified-fog.md)                               | fog that cuts the horizon (no more ocean-through-haze), height fog, one shared fog chunk | idea   |
| 7   | [007 — Water](007-water.md)                                                                | realistic water: waves, depth-based shores, reflections (planar/SSR), underwater         | idea   |
| 8   | [008 — Local lights: headlights & street lamps](008-local-lights.md)                       | real projected headlights + clustered lamp pool; coronas demoted to distant impostors    | idea   |
| 9   | [009 — Night & emissive atmosphere](009-night-emissive-atmosphere.md)                      | glowing night vertex/tobj/neon, moon light, dawn/dusk grading calibration                | idea   |
| 10  | [010 — Quality tiers & default flip](010-quality-tiers-default-flip.md)                    | low/med/high/ultra presets, budgets enforced, new pipeline becomes default, cleanup      | idea   |

Dependencies: 001 → 002 → 003; 004 feeds 003 (shadow proxies) and upgrades 002/009 (baked channels) but starts after 003 proves what data is needed; 005 → 006 → 007 (LUT → fog → water); 008 needs 002 (a lit world to receive light); 009 needs 005 + 008; 010 closes.

## External references (evaluate, don't adopt blindly)

- **Sky/atmosphere**: three.js `Sky` addon (Preetham — cheapest); Hosek-Wilkie model (better sunsets); Bruneton precomputed atmospheric scattering (github.com/ebruneton/precomputed_atmospheric_scattering) and its three.js production port **@takram/three-atmosphere** (github.com/takram-design-engineering/three-geospatial, MIT).
- **Volumetric clouds**: **@takram/three-clouds** (same monorepo, raymarched, weather-controllable); canonical technique: Schneider, "Real-Time Volumetric Cloudscapes of Horizon: Zero Dawn" (Nubis). Cheap alternative: per-weather panorama/skybox sets (Poly Haven CC0 skies) or SA-style billboard layers.
- **Water**: three.js `Water` addon (webgl_shaders_ocean — planar mirror + normal ripple, proven), `Water2` (reflection+refraction), FFT ocean (jbouny/fft-ocean; Tessendorf, "Simulating Ocean Water"), Gerstner waves for shader-only swell; SSR via **0beqz/realism-effects** (MIT).
- **Shadows**: three.js CSM addon (`three/addons/csm/CSM.js`), PCSS example (`webgl_shadowmap_pcss`) for contact-soft look.
- **Post/AO**: pmndrs/postprocessing (already in), `SelectiveBloomEffect` for emissives; **N8python/n8ao** as a faster SSAO candidate.
- **Asset format**: zeux/meshoptimizer (+ three `MeshoptDecoder`), KTX2/Basis Universal (three `KTX2Loader`), glTF as the container or a lean custom binary.
