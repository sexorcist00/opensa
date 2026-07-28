# Night relax of the sky-occlusion term

**Live.** Taken 2026-07-28, [plan 090/01](../plans/090-vehicle-cabin-at-night/01-night-sky-relax.md),
commit `ce6cd1a`.

## What it is

`packages/engine/src/render/shaders.ts`:

```wgsl
const NIGHT_SKY_RELAX = 0.6;
fn skyShareNow(baked: f32) -> f32 { return mix(baked, mix(baked, 1.0, NIGHT_SKY_RELAX), frame.params.x); }
```

The car's baked per-vertex sky occlusion is pulled 60 % of the way toward "open sky" as the day/night factor
goes to 1. Read by the indirect term and by the reflection/specular gate.

## What it stands in for

A night lighting model that knows where light actually comes from after dark. The bake
(`renderware/vehicle/sky-occlusion.ts`) marches a height field over the car's own shell in 8 azimuths,
horizontal-and-up — it measures SKY. At night the light reaching a cabin is street lamps, shop fronts and
other cars' headlights: ground level, arriving sideways through the glass, a direction the height field never
samples. The honest fix is a light model that separates a sky term from a street term (or real shadowing);
this is one multiply instead.

The relax is partial rather than total because the same term is what stops a car collapsing into one flat
colour at night (plan 084's whole reason for existing).

## What it was judged on

The 0.6 itself is **taste** — SA models no interiors at all, so there is no original behaviour to reproduce
and nothing to fit against. What was measured is where the lift LANDS: per part on the built previon at
midnight, cabin geometry gains ×1.38–1.47, doors ×1.20–1.22, the chassis ×1.12, bonnet and boot ×1.04–1.06,
glass ×1.00. That gradient — the enclosed geometry gaining several times what the skins gain — is the
property that made it acceptable. Nothing moves by day.

Field verdict: owed (the report that opened it was an almost black interior at dusk).

## What would retire it

Any of:

- a real per-source occlusion for dynamic models (even a coarse one), so street-level light is not gated by
  a sky term at all;
- a directional version of the occlusion bake (the map's parked "sun-vis v2" idea, applied to cars), which
  would let the term answer per direction rather than as one scalar;
- the original's own night lighting for vehicles, if it ever turns out `CVisibilityPlugins` /
  the timecycle does something we are not reading.

## Blast radius

Every car, every night, on three terms at once: the hemispheric indirect, the environment reflection amount
and the sun/moon specular (the last two share `skyShareNow`). Raising it flattens a car's night shading
toward the pre-084 look; lowering it takes cabins back toward black. Costs a reload to change, not a pack
rebuild — the value is a shader constant, not baked data.
