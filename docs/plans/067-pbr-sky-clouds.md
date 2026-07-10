# 067 — PBR sky, horizon LUT, clouds

Part of the [rendering overhaul chain](062-rendering-overhaul.md). Independent of 002–004 (can run in parallel after [063](063-render-foundations-instrumentation.md)). Feeds [068 — fog](068-unified-fog.md) via the horizon LUT.

## Context

Today's sky (`sky.plugin.ts`): a gradient dome (`uBottom→uTop` from timecyc skyBot/skyTop) + fbm procedural clouds + hash stars + sprite moon + additive sun disc/corona + god-rays source. It reads decently but is a 1997-style colour ramp: sunsets lack scattering physics, the horizon band is a lerp, weather moods come entirely from timecyc colour keys and a curated cloud-profile table.

## Decisions

1. **Physically-based sky with timecyc as the art director.** Replace the gradient with an atmospheric-scattering model whose inputs (turbidity, rayleigh/mie, sun intensity) are DRIVEN by timecyc + weather so every SA mood remains reachable. Evaluation order (cheapest first):
   - three.js `Sky` addon (Preetham) — one screen-quad shader, zero dependencies; likely sufficient for stage 1;
   - Hosek-Wilkie fit — better sunset spectra, still analytic;
   - **@takram/three-atmosphere** (Bruneton precomputed scattering, MIT) — best quality incl. aerial perspective LUTs; heavier integration. Decide by side-by-side on the dusk bench.
2. **The 512×1 horizon LUT** (user's idea, adopted verbatim): after each sky-state change (time/weather step, not per frame), render the sky's horizon ring into a **512×1 RT** (azimuth → horizon colour at eye level). This LUT becomes THE fog colour source (view-direction-dependent!) for scene fog, water, and any future volumetrics — PBR colour math runs once over 512 pixels, everything else samples a texture. Seam-free sky↔fog blending by construction, replacing the current single-colour `skyBot` tracking.
3. **Sun/moon/stars**: keep the existing disc/god-rays/moon/star machinery, recolour from the PBR sky (sun disc colour = transmittance-attenuated), stars gated by the same night factor.
4. **Clouds, two stages**:
   - **Stage A (this plan)**: better non-volumetric clouds — layered scrolling cloud textures on the dome (SA-style but higher quality) OR per-weather panorama sets; keep the curated per-weather profile table as the driver. Deliverable: every timecyc weather has a distinct, good-looking cloud state, blendable during weather transitions.
   - **Stage B (stretch, separate toggle)**: volumetric raymarched clouds — evaluate **@takram/three-clouds**; technique reference: Schneider's Horizon Zero Dawn "Nubis" talk. Only if Stage A + budget allow; ultra tier only at first.
5. **Weather blending**: sky params, LUT, and cloud state all interpolate through the existing weather-blend (`sampleTimecycBlend`) so transitions stay smooth.
6. **Budget**: sky ≤ 0.8 ms (it's a dome/quad + rare LUT refresh); volumetric clouds get their own ultra-tier budget (≤ 2 ms half-res) if Stage B lands.

## Tasks

- [ ] Spike: Preetham vs Hosek-Wilkie vs takram on the dusk/dawn benches, timecyc-driven; screenshot matrix; user picks the model. Record decision + params mapping here.
- [ ] Implement the chosen sky as the dome/quad replacement behind `graphics.sky.model: 'classic'|'pbr'`; map timecyc keys → model params (calibration table, unit-tested interpolation).
- [ ] Horizon LUT: 512×1 RT capture on sky-state change; expose as a shared uniform/texture handle (`skyHorizonLut`) via the plugin context for fog/water consumers; debug view strip in the overlay.
- [ ] Sun disc/corona/god-rays/moon/stars recolour integration; overcast behaviour parity.
- [ ] Clouds Stage A: layered texture clouds per weather + transition blending; retire/repurpose the fbm dome noise; cloud-profile table update.
- [ ] (Stretch) Clouds Stage B spike: takram/three-clouds integration behind `graphics.clouds.volumetric`.
- [ ] Bench + calibration sweep across all weathers × key hours; sign-off screenshots.

## Verification

- Sunset/sunrise on the dawn bench visibly superior to classic (side-by-side), all weathers distinct, transitions smooth.
- LUT: fog-coloured test quad matches the sky at every azimuth (no seam where geometry meets sky).
- Budget: sky pass ms within target on reference machine.

## Measurements

_(record after implementation)_

- chosen sky model + param table: …
- sky pass ms / LUT refresh ms: …
- Stage B verdict: …
