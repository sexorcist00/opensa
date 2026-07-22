# Time of day, night content, light sources

`packages/game/src/time/`, `packages/game/src/adapters/engine-environment-driver.ts` (the one
config→`Engine.environment` mapping), `packages/engine/src/world/cells.ts` + `engine.ts` (corona anchors
and the instanced corona pass), `apps/web/src/ui/engine-canvas-host.tsx` wiring, plans 026/032/034/038.

## Implemented

- **Game clock**: minutes since midnight, `secondsPerGameMinute`, pause freezes time; debug Time
  screen with presets; `clockNightFactor` fade windows (`night.litFade` dawn/dusk).
- **Timed objects (`tobj`)**: the converter (`tools/opensa-pack/src/weld.ts`) lifts a timed bucket out of
  the merged cell bundle into a kind-0 `objectTable` draw carrying its on/off hour window; the engine skips
  the draw outside the window. Night-window detection also drives the glowing lit-window emissives (085:
  the delta is per-CHANNEL, not luma — saturated neon reads darker than day in luma). A NIGHT-ONLY window
  keeps the model's day prelit as its night set (vanilla shows `*_nt` dressing fullbright) and its emissive
  compares against void; a timed bucket that also UV-scrolls becomes ONE kind-5 draw (hour-gated scroll —
  the Fremont facade's stripes). `IdeFlag.ADDITIVE` overlays render on the additive pipeline pair (their
  light ADDS onto the base building — the LV strip's neon dressings).
- **2dfx light coronas**: per-model lights are baked per cell as world-space anchors
  (`packages/engine/src/world/cells.ts`) and drawn by one instanced billboard pass
  (`engine.ts`, `coronastar` from particle.txd) with camera-facing sprites and distance fade. Traffic
  lights render their coronas too (all bulbs at once — signal cycling is a future item).
- **Dynamic objects at night**: the player/vehicles are lit by the engine's sun/moon path (a prod-derived
  moonlight band). The old plan-034 "night fill" shader went with the three renderer and has no replacement.
- **Static lamp lighting**: the 2dfx lamps light nothing but themselves — they were removed from the
  light pool (host dynamics only). Surface lighting from street lamps is **not implemented**; it restarts
  in plan 074/17.
- **Vehicle headlights** (plan 033, ⚠️ **MVP — redo later**): night-gated for SEATED vehicles (generalizes to
  NPC traffic). The lamp glass self-illuminates (emissive: head warm-white, tail red dim/brake) + small coronas
  at the lamp dummies; bloom makes the halo. Lamps are identified by POSITION near the `headlights`/`taillights`
  dummies (the marker colours are per-lamp ids, not front/rear). **No road beam** (the world is unlit) — the
  proper redo projects the beam onto the road polys (SA `CShadows`-style). Tuning in `graphics.headlights`.
- Night sky: stars, moon (`coronamoon` sprite, size/elevation knobs), skylight hemisphere knob.

## Known gaps / candidates

- Traffic-light signal cycling (red/amber/green phases) — currently all bulbs' coronas light at once.
- Headlights: road beam on the asphalt (project onto road polys, SA `CShadows`-style) — the MVP has none.
- Corona occlusion (SA traces line-of-sight; ours draw through geometry at some angles).

## Test coverage anchors

`time/game-clock.test.ts`, `adapters/engine-environment-driver.test.ts` (sun/moon arcs, timecyc colours),
`plugins/sun-position.test.ts`. Headlights: `vehicle/vehicle-lamps.test.ts` (lamp dummies + `lightType` by
dummy position), `vehicle/vehicle-lamp.system.test.ts`, `enter-vehicle` (`isBraking`); the visuals are
browser-verified (no `node` test env).
