# 068 — Unified fog & aerial perspective (cut the horizon)

Part of the [rendering overhaul chain](062-rendering-overhaul.md). Depends on [067](067-pbr-sky-clouds.md) (the horizon LUT). Fixes the reported bug-class: **the ocean/far world is visible through the haze at the horizon** — fog must actually terminate the world.

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

- [x] Core shipped (2026-07-10, v1): **`worldFogUniforms` + a `fog_fragment` REPLACEMENT** in `world-material.ts`
      (uniform-gated `uFogMix`; classic keeps three's exact exp² — asserted in tests). Modern: fog colour =
      **067 horizon LUT sampled by view azimuth per fragment** (sun-side warm / anti-sun cool; the dawn glowing
      silhouettes die — the fog now IS the sky behind it) + **the horizon cut** (smoothstep tail → factor 1.0 at
      `fog.distance`; far geometry resolves to pure sky). Covers the whole streamed world incl. vegetation/procobj
      (they use `buildWorldMaterial`).
- [x] Water: private fog upgraded in place — same LUT-azimuth colour + cut on the modern path (`WaterPlugin`
      gains a `getFog` closure); classic path untouched. The sea/sky horizon seam dies by construction.
- [ ] Particles/effects/corona materials: still on scene FogExp2 / far-fade — coherence check pending.

### v1 debug arc (2026-07-10, user A/B — all fixed same day, final state CONFIRMED "выглядит хорошо")

- **White skyscraper silhouettes against the blue sky:** fog sampled the LUT at EYE LEVEL only — tall fogged
  geometry got the bright horizon-haze band instead of the sky at its elevation. FIX: the LUT is now 2D
  (512×32, azimuth × view-elevation to ~44°) and the fog samples by the fragment's own direction — cheap
  aerial perspective.
- **Still white after that:** an AZIMUTH PHASE bug — the shaders sample `atan/2π + 0.5` but the LUT rendered
  без the half-turn → fog took the OPPOSITE side of the horizon (white dawn fog on the teal anti-sun sky).
  One-line fix in the LUT fragment (`phi = (u − 0.5)·2π`). This also explains why the dawn silhouettes had
  survived the first fog fix.
- **Distant objects flickering every second:** the LUT refresh key quantized to the game minute — which is
  ~1 REAL second in SA — so near-fully-fogged objects stepped while the dome moved smoothly. FIX: the LUT
  (16 k px) renders EVERY frame — trivial cost, perfectly continuous. User: "мерцание ушло".
- [ ] timecyc wiring: `fogStart`/`farClip` sampled per weather/hour through the existing blend, × `config.fog`
      multipliers; keep the current `fog.distance` config as an override. _v1 uses `config.fog.distance` as the
      cut (no draw-distance change); timecyc-driven range = the calibration step (SF fog weather showcase)._
- [ ] Height fog (valleys/ocean haze first, Chiliad pokes out) — not in v1.
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
