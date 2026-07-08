# 002 — Hybrid world lighting (real sun on the prelit world)

Part of the [rendering overhaul chain](readme.md). Depends on [001](001-foundations-instrumentation.md) (frozen colour pipeline + benchmarks). THE foundation plan: solves "how to add real light to the current world while keeping the SA prelit vibe".

## Context

Plan 038 made the static world authentically unlit: `texture × mix(dayPrelit, nightPrelit, dnBalance) × timecycTint` in `world-material.ts` (MeshBasicMaterial + injections), normals present but unused for lighting (they feed SSAO). Sun/ambient/hemisphere only light dynamics. The problem with simply re-lighting the map with `MeshStandardMaterial` was already lived through pre-038: harsh days, double-darkening, garbage-normal sensitivity — because **prelit already contains Rockstar's baked sun + sky + building shadows**.

Assets are better now than pre-038: map-optimizer computes smooth-group normals (`smooth-normals.ts`), plan 037 sanitizes stored ones — normal quality is no longer the blocker it was.

## Decisions

1. **Indirect/direct split, shader-level first.** Extend the 038 world shader (keep `MeshBasicMaterial` + injection — full program control, no three lighting plumbing):

   ```glsl
   vec3 indirect = prelitBlend × uIndirectScale;               // prelit re-read as GI/ambient
   float ndl     = max(dot(normal, uSunDir), 0.0);
   vec3 direct   = uSunColor × ndl × shadow × uDirectScale;    // real sun, real shadow term
   color = texel.rgb × (indirect + direct);
   ```

   `uIndirectScale`/`uDirectScale` are timecyc/hour-driven curves (calibration knobs like 038's `worldLight` config). Intuition: at noon prelit keeps ~60–70% of its role (vibe preserved), the sun term adds directional life; at night `uDirectScale → 0` and the pipeline degrades to exactly 038's look.

2. **De-lighting is NOT in this plan.** A global split double-counts a little by construction (baked sun highlights stay in prelit). Accepted for stage 1; plan [004](004-pmb-modern-asset-step.md) later bakes per-vertex sun-visibility/AO channels in perfect-map-builder so `uDirectScale` can be modulated per-vertex (baked shadow areas get less real sun — kills the double-count where it's most visible).
3. **Normals**: use the geometry normals as-is (post-037/map-optimizer). Faceted or missing normals fall back to `ndl = uSunElevationFactor` (flat response) via a degenerate-normal guard — never black, never NaN.
4. **Dynamics keep their lit path** (MeshStandard + sun/ambient/hemisphere) — but SkyPlugin intensity constants get recalibrated once the map stops being unlit-only (they were tuned dynamics-only after 038).
5. **Behind `graphics.pipeline: 'modern'`** (from 001); `'classic'` renders the exact 038 path. Both compile as program variants of the same material (cache keys like `saWorld|night` today) — no scene rebuild on toggle.
6. **Calibration is the deliverable.** Code is ~days; matching the vibe across 8 weathers × 24 hours is the real work (038 learned this). Screenshot matrix tooling from 001's harness reused: same camera, hour sweep, side-by-side classic/modern.

## Tasks

- [ ] Extend `world-material.ts`: sun uniforms (`uSunDir/uSunColor/uIndirectScale/uDirectScale`), NdotL term with degenerate-normal guard, night-path parity (night prelit + windowGlow unchanged). New program variants behind the pipeline switch.
- [ ] Reuse the existing manual shadow-receive term as the `shadow` factor (full CSM arrives in [003](003-cascaded-shadows.md); until then the dynamics-only 45 m map is what multiplies `direct`).
- [ ] Drive uniforms from canvas-host beside the existing tint/dnBalance updates; timecyc-derived scale curves in one exported function (unit-tested: noon/dusk/night values, weather blend continuity).
- [ ] SkyPlugin recalibration pass for dynamics (ambient/hemisphere constants) so cars/peds match the newly-lit ground.
- [ ] Screenshot matrix: hour × weather sweep for LS/SF/LV benches; user sign-off on the split curves; record final constants here.
- [ ] Perf: measure world-pass cost delta vs baseline (extra ALU only — expect ~0; verify).
- [ ] Tests: shader-injection unit tests (existing world-material test patterns), curve function tests. Lint/tsc.

## Verification

- Bench scenes: classic vs modern A/B at 08/12/17/21/00 h across sunny/overcast/rain/fog.
- The night look at `uDirectScale=0` is pixel-identical to classic (regression screenshot diff).
- No FPS regression beyond noise on all bench scenes.

## Measurements

_(record after implementation)_

- Final indirect/direct curves per weather class: …
- World-pass GPU delta: …
- Sign-off screenshot set: …
