# 006 — Unified fog & aerial perspective (cut the horizon)

Part of the [rendering overhaul chain](readme.md). Depends on [005](005-pbr-sky-clouds.md) (the horizon LUT). Fixes the reported bug-class: **the ocean/far world is visible through the haze at the horizon** — fog must actually terminate the world.

## Context

Today: scene `FogExp2` with density `2/config.fog.distance`, colour tracking a single `skyBot` sample (`fog.plugin.ts`); `scene.background` follows the same colour. The water shader CANNOT see scene fog (custom ShaderMaterial) so it re-implements the same exponential by hand and fades to `uHorizonColor` (`water.plugin.ts`) — two fog implementations already disagree at the seam, and a single fog colour for all view directions guarantees a visible mismatch against a sky whose horizon varies with azimuth (sun side vs opposite). timecyc `farClip`/`fogStart` are parsed but unused.

## Decisions

1. **One fog, as a shared shader chunk.** `applyOpensaFog(color, viewDir, dist, height)` — a single GLSL include injected into the world material, water, procobj/vegetation, particles, and any custom ShaderMaterial. Scene-level `FogExp2` is retired on the modern pipeline (three's per-material `fog:true` plumbing can't express what we need).
2. **View-direction fog colour from the horizon LUT** (005): `fogColor = texture(skyHorizonLut, azimuth(viewDir))` — fog ALWAYS matches the sky it fades into, sun-side warm / anti-sun cool, for the cost of one 1D texture fetch.
3. **Two-term analytic model** (no volumetrics yet):
   - **distance fog**: exp² term with `fogStart`/`farClip` finally driven by timecyc (per weather/hour) × a config multiplier — fog distance becomes a MOOD, as SA intended (SF fog weather actually rolls in);
   - **height fog**: exp falloff with world height — valleys/ocean surface haze first, Mount Chiliad pokes out; cheap, huge atmosphere win.
4. **The horizon CUT**: at `farClip` the fog term reaches 1.0 EXACTLY (clamped smoothstep tail, not an asymptote) — geometry at the far plane resolves to pure LUT colour, indistinguishable from sky. The ocean-through-haze artefact dies by construction: water at horizon distance = fog colour = sky colour. Far-plane/streaming distance and `farClip` are linked in config so nothing renders past full fog.
5. **Aerial perspective tint** (stretch, if 005 picked takram/Bruneton): distant geometry additionally shifts hue via the scattering LUTs — defer unless free.
6. **Volumetric/froxel fog is OUT of scope** — the LUT design deliberately leaves the door open (user note: "including volumetric fog in the future").

## Tasks

- [ ] `fog.chunk.glsl` (shared include + uniform block: LUT, fogStart, farClip, heightParams) + TS helper managing the uniforms; unit-test the curve math (start/cut boundary values).
- [ ] Inject into world material (both program variants), water shader (DELETE its private fog), procobj/instanced vegetation, particles/effects materials; corona far-fade coherence check.
- [ ] timecyc wiring: `fogStart`/`farClip` sampled per weather/hour through the existing blend, × `config.fog` multipliers; keep the current `fog.distance` config as an override for the classic pipeline.
- [ ] Sky/background: `scene.background` no longer needed on the modern path (dome covers all); verify god-rays/moon fade against fogged horizon.
- [ ] The cut: clamped tail + far-plane link; verify the LS→ocean bench at multiple hours — the water horizon line must be GONE (screenshot the old artefact first for the doc).
- [ ] SF fog weather + rain showcase calibration; height-fog params per weather class.
- [ ] Bench cost (expected ≈ free: one tex fetch + few ALU per fragment).

## Verification

- Ocean bench: no visible sea/sky seam at any hour/weather (the reported artefact — before/after shots in this doc).
- 360° pan at dusk: fog colour tracks the sky around the full circle (sun-side vs anti-sun).
- Water/world/vegetation fade identically at equal distance (the two-fog mismatch is gone).

## Measurements

_(record after implementation)_

- fragment cost delta: …
- final fogStart/farClip/height tables per weather: …
