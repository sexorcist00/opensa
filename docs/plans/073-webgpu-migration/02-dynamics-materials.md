# 073/02 — Dynamics materials (player, vehicles, peds)

**Priority: P0.** Under `?webgpu=1` dynamics render as BLACK silhouettes: their lit materials
(`MeshStandardMaterial`/`MeshPhysicalMaterial` from `buildMaterial`) auto-convert, but every light lives in the
skipped plugins (sky's sun/ambient/hemisphere) → lit path × no lights = black.

## Context

- `build-clump.ts buildMaterial` (standard/physical + vehicle userData), `build-skinned-clump` (player),
  `night-fill.ts` (GLSL `onBeforeCompile` — dead under WebGPU), vehicle-reflection plugin (skipped).
- Dynamics are NOT bundled (they move) — no freeze interplay.

## Tasks

- [ ] Decide the lighting model for dynamics under WebGPU: simplest correct = keep auto-converted standard
      materials and provide REAL lights (needs plan 03's sun/ambient at minimum) — verify that alone un-blacks them.
- [ ] Port night-fill to TSL (emissive hemisphere + rim on `emissiveNode`) — composes with the standard material
      via `MeshStandardNodeMaterial` swap in `buildMaterial` under a TSL flag (mirror the world-material builder
      registration pattern).
- [ ] Vehicle reflection: defer the cube-probe (plugin) — set a neutral `envMapIntensity`; log a follow-up.
- [ ] Player skinning sanity under WebGPU (SkinnedMesh + bones — three supports it; verify animations).
- [ ] Headlights/brake glow (worldLocalLightUniforms consumers) — verify or stub without the GLSL pool.

## Done

Player and vehicles visibly lit day and night under `?webgpu=1`, animations intact.
