# 071 — Night & emissive atmosphere (dawn, dusk, night)

Part of the [rendering overhaul chain](062-rendering-overhaul.md). Depends on [067](067-pbr-sky-clouds.md) (sky/moon) and [070](070-local-lights.md) (local lights). The "make night actually beautiful" plan: keep prelit + night vertex colours AND make them glow.

## Context

- Night vertex colours (the `0x253F2F9` set) drive the night prelit blend (038); lit windows/neon are tobj-swapped models + additive `windowGlow` (build-region tagging, `timed-object.system.ts` hour gating).
- Bloom exists (composer-wide, pmndrs) but is threshold-based over the whole frame — night sources glow only as much as their LDR brightness allows; nothing is truly emissive-bright.
- 004 (if landed) provides a baked per-vertex `emissiveMask`; without it a runtime heuristic (night≫day prelit delta) approximates it.

## Decisions

1. **True emissive channel for night sources.** World shader outputs `emissive = nightPrelit × emissiveMask × uEmissiveBoost` ADDED after the lighting model (unaffected by fog dimming until the fog term, immune to tone-map crush via boost >1). Sources: night-vertex hot spots (windows baked bright by Rockstar), tobj lit-window variants, neon 2dfx materials. This is the user ask verbatim: "чтобы tobj, night vertex светились".
2. **Selective bloom over a real HDR threshold**: emissive boost pushes sources above 1.0 so the EXISTING bloom picks them up naturally (no second render pass, no layer juggling — threshold does the selection). Bloom params get a night profile (larger radius, lower threshold) cross-faded by the night factor.
3. **Dawn/dusk are first-class**: a grading calibration pass per time band (dawn/day/dusk/night) — exposure/saturation curves on top of the 001-frozen tone mapping, driven by sun elevation (NOT wall clock — sunset must look right whenever it happens). Golden-hour warmth on the sun term (002 curves), long-shadow mood (003) verified together here.
4. **Moon as a light**: tiny cool `DirectionalLight` at night (dynamics) + a `uMoonTerm` in the world shader indirect (barely-visible blue grounding); full moon nights slightly brighter (moon phase already exists in config).
5. **Wet night stretch** (rain): screen-space wet-look (darker albedo + boosted spec/reflection on roads) — only if trivially composable with 007/008 results; otherwise noted for a future chain.
6. **Nothing here replaces prelit** — every term is additive/multiplicative around the prelit core; classic pipeline unaffected.

## Tasks

- [ ] Emissive term in world material: mask source selection (004 attribute if present, else night/day delta heuristic — unit-test the heuristic on night-window fixtures like `newvic1_sfw`), `uEmissiveBoost` config.
- [ ] tobj/neon material tagging → emissive path (extend build-region `WINDOW_EMISSIVE` tagging; neon 2dfx materials join).
- [ ] Bloom night profile + crossfade; verify LV strip: neon blooms, dark buildings don't.
- [ ] Moon light (directional + shader term), phase-scaled; stars/moon/sky coherence pass with 005.
- [ ] Time-band grading: sun-elevation-driven exposure/saturation curves; calibration sweep dawn→night with sign-off screenshots per band (the 038-style calibration discipline: constants recorded here).
- [ ] Street-level night composition pass: prelit pools + 008 lamp light + emissive windows + coronas — tune relative levels so no layer dominates (the "balance" the user called out).
- [ ] (Stretch) rain wet-look spike; measured, separate toggle.
- [ ] Bench: LV night, LS rain night; before/after screenshot pairs into this doc.

## Verification

- Night city reads like a modern game: glowing windows/neon with real bloom, lamp pools, readable but moody darkness — while a daylight A/B against classic still reads unmistakably as San Andreas.
- Dawn/dusk sweep (accelerated clock) shows no banding/jumps across band boundaries.
- Perf: emissive term ≈ free; bloom profile change ≈ free (same pass).

## Measurements

_(record after implementation)_

- final boost/threshold/grading constants per band: …
- LV-night frame ms before/after: …
