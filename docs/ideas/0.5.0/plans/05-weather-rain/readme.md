# 05 — Rain & weather phenomena (timecyc-driven)

Full weather visuals driven by the timecyc/weather system the engine already samples (074/06 row 14):
rain is the headliner; the rest of the SA weather set rides the same drive.

**Migration note:** targets the 074 engine (WebGPU) — the particle/billboard pass from 06 row 13 is the
substrate for rain; the fog/sky/wind knobs already live in `Engine.environment`. The deferred
weather→wind rule ([02-weather-wind](../02-weather-wind/readme.md)) lands as part of this plan.

## The SA timecyc weather catalogue (what "everything" means)

SA ships 23 weather ids; grouped by the EFFECT they need beyond the timecyc colour/fog values the engine
already samples (074/06 row 14):

| Weather ids                                                                   | Effect class | Extra work beyond timecyc colours                                                           |
| ----------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| EXTRASUNNY/SUNNY × LA/SF/Vegas/countryside/desert (0,1,5,6,10,11,13,14,17,18) | clear        | none — colours/fog already drive it                                                         |
| SUNNY_SMOG / EXTRASUNNY_SMOG LA (2,3)                                         | smog         | haze tint rides the fog knobs; optional horizon dirt band                                   |
| CLOUDY × regions (4,7,12,15)                                                  | overcast     | sun gating (timecyc `dir` already darkens); softer shadows via `sunVisStrength`/`sunDirect` |
| RAINY_SF / RAINY_COUNTRYSIDE (8,16)                                           | rain         | particles + occlusion + WETNESS + PUDDLES (below) + thunder                                 |
| FOGGY_SF (9)                                                                  | fog          | dense fog values exist; add ground-hug boost (fogHeightK) + reduced far coronas             |
| SANDSTORM_DESERT (19)                                                         | sandstorm    | tinted particle wash + strong wind (weather→wind rule) + visibility crush                   |
| UNDERWATER (20)                                                               | special      | not a sky weather — handled by the water/interior system, out of this plan                  |
| EXTRACOLOURS 1/2 (21,22)                                                      | scripted     | colour-only (interiors/missions) — timecyc sampling covers it                               |

## Pieces

1. **Weather state machine**: SA weather ids per zone/time (timecyc rows already parsed), transitions with
   cross-blends (`sampleTimecycBlend` supports the blend — wire real FROM→TO instead of same-id).
2. **Rain particles**: instanced streak billboards in a camera-follow volume (cylindrical shell), count/
   length/tilt from weather intensity + camera speed; splash sprites at ground hits (cheap: probability ×
   ground plane estimate near camera). GPU budget gate like every effect row.
3. **Rain occlusion (dry under roofs)**: v1 = a small top-down depth render around the camera ("rain map",
   one 256² pass refreshed on cell change) sampled by the particle shader — reuses the engine's depth
   infrastructure; measured before accepting.
4. **Wet world**: weather-driven uniforms — darkened + slightly specular ground (a wetness factor on the
   world shader's indirect/direct mix), reflective streak on roads at night (cheap fresnel-ish term),
   drying transition after rain ends (a "wetness memory" scalar that charges during rain and decays after).
5. **Puddles (after-rain)**: standing water patches on near-horizontal asphalt/pavement. 074-friendly
   design reusing existing infrastructure: gate by surface class via the texture NAME-LIST mechanism
   (the stochastic list proved the offline curation loop — a `puddle-surfaces.txt` marks roads/pavements;
   bit in the spare layer-u16 space or a material table), mask by a world-space noise texture (stable
   puddle SHAPES, not shimmer) × up-facing normal × wetness memory; puddle pixels flip to a reflective
   response: `skyColorFor(reflect(view, up))` — the shared sky function gives sky-reflection puddles for
   ~free, fresnel-blended over the darkened wet diffuse. Drying shrinks the mask threshold so puddles
   recede from the edges inward — the classic look. (True mirror reflections of buildings = out of scope;
   sky + sun glint reads right and costs almost nothing.)
6. **Storm extras**: lightning (sky flash = a frame-long skyTop boost + delayed thunder), fog/sandstorm
   densities (fog knobs exist), overcast sun gating (timecyc already darkens `dir`).
7. **Weather→wind** (the deferred 02 idea executes here): windStrength/clock from weather id with
   cross-faded transitions.
8. **Interior/tunnel suppression**: reuse the rain-map occlusion; zones marked interior kill weather.

## Tasks

- [ ] Weather state machine + real FROM→TO timecyc blending (+ debug `?weather=a,b,t`).
- [ ] Rain particle pass (instanced streaks + splashes) with intensity from weather; bench row (gate ≤ 1 ms
      GPU at storm intensity, 2× retina).
- [ ] Rain map (top-down occlusion) v1 + particle sampling; measure; accept/iterate.
- [ ] Wetness uniforms on the world shader (darken/spec/dry-out curve + the wetness-memory scalar).
- [ ] Puddles: surface name-list + world-noise mask + sky-reflect response + edge-inward drying; bench row
      (target ≈ free — it is a per-pixel branch on wet frames only).
- [ ] Lightning + thunder timing; smog/fog/sandstorm presets per the weather catalogue above.
- [ ] Weather→wind rule (closes ideas 02).
- [ ] Field matrix: each SA weather id screenshotted at 3 times of day; series bench rows for rain on/off.
