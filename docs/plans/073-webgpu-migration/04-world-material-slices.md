# 073/04 — World-material TSL slices (parity with the GLSL shader)

**Priority: P1.** `world-material-tsl.ts` today = classic path + modern sun N·L. The GLSL original also has:
CSM shadow sampling, classic single-map shadow, unified LUT fog + horizon cut, night emissive glow, moon term,
local light pool, window-glow overlay, beam handling nuances.

## Context

- Source of truth: `packages/renderware/src/three/world-material.ts` (GLSL) — port term by term.
- The bake-vs-pass decision ([06-bake-vs-pass](../../concepts/webgpu-migration/06-bake-vs-pass.md)) says: fog and
  emissive live IN the material; AO may come baked (plan 07).
- Uniform groups: everything shared per-frame goes to `renderGroup` (frozen-bundle rule — already the pattern).

## Tasks (each slice = author in TSL → verify vs WebGL screenshots day/dusk/night)

- [ ] Unified fog: LUT azimuth colour + timecyc exp² + height factor + horizon cut (`worldFogUniforms`).
- [ ] Night emissive glow (`uEmissiveBoost`, luma-delta over night vertex colours) + window-glow overlay material.
- [ ] Moon N·L term (`worldMoonUniforms`).
- [ ] CSM/shadow sampling — after plan 05 provides maps (depth-texture comparison sampling in TSL).
- [ ] Local light pool (worldLocalLightUniforms — uniform arrays in TSL; pool of 12).
- [ ] Beam materials (vertex-alpha floodlights) parity check.
- [ ] Pixel-compare pass across a day sweep vs WebGL (the map-viewer compare workflow).

## Done

`?webgpu=1` world is visually indistinguishable from WebGL classic+modern across a day cycle (fog, night glow,
shadows), verified with side-by-side captures.
