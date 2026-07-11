# 073/03 — Sky & ambient under WebGPU

**Priority: P0.** All plugins are skipped under `?webgpu=1`: no sky dome, no sun disc, no ambient/hemisphere
lights, no time-of-day drive. The world renders on baked prelit only (dark), dynamics get no light at all
(plan 02 depends on this), and `worldTint`/`dnBalance` uniforms are never driven (syncWorldTsl copies statics).

## Context

- `sky.plugin.ts` (839 lines: dome GLSL, PBR sky + LUT, sun/moon, lights, shadow aiming) — the biggest port.
- Slice it: LIGHTS + uniform drive first (cheap, unblocks 02), dome visuals second.

## Tasks

- [ ] **Slice A (unblocks everything):** a WebGPU-mode "sky-lite" system (not the GLSL plugin): create sun
      DirectionalLight + ambient/hemisphere, drive their intensity/colour + `worldTintUniform`/`dnBalanceUniform`
      /`worldSunUniforms` from the existing timecyc sampling (reuse the plugin's pure math, skip its GLSL).
- [ ] **Slice B:** sky dome in TSL (gradient or LUT-based `backgroundNode`), sun disc + corona sprite, moon.
- [ ] **Slice C:** the 512×32 horizon LUT generation without `ShaderMaterial` (compute the LUT on CPU or via a TSL
      RTT) — feeds plan 04's unified fog.
- [ ] Wire the day/night clock drive (dnBalance ← clockNightFactor) in webgpu mode.

## Done

Under `?webgpu=1`: lit world with correct day/night cycle, visible sky (at least gradient), sun/ambient lighting
dynamics; `uSunDir/uSunColor/uDn/uTint` live.
