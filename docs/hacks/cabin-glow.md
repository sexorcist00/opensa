# The cabin glow, and how a cabin is found

**Live.** Taken 2026-07-28, [plan 090/02](../plans/090-vehicle-cabin-at-night/02-dash-glow.md),
commit `a577a69`.

## What it is

Three expedients that ship together.

**1. A cabin is found by a volume test** (`packages/renderware/src/vehicle/cabin.ts`): a vertex is "inside
the car" when it sits within the bounds of the model's own GLASS materials, above the wheel hubs, and its
sky occlusion says it is enclosed —

```ts
const CABIN_SKY_MAX = 0.78; // cabin 0.32-0.69 vs shell 0.90-1.00, measured on the built previon
```

**2. Wheels and the `_vlo` LOD are excluded by fiat**, because the volume test cannot see them for what they
are: the top half of a rear wheel stands above the hub line, inside the greenhouse footprint, enclosed by its
own arch — every clause passes, and 17 % of each rear wheel came out tagged before the exclusion.

**3. The glow is a flat warm add** (`packages/engine/src/render/shaders.ts`), on tagged vertices, while that
car's headlights are on:

```wgsl
const CABIN_GLOW = 0.35;
const CABIN_TINT = vec3f(1.0, 0.82, 0.55);
```

## What it stands in for

- **An authored interior.** SA has no notion of "this geometry is the cabin" — no frame convention, no
  material flag, nothing in the reversed source. Mods do not agree on names either (`starion88_interior` on
  one car is anything at all on the next), and the standing rule forbids matching names. So the geometry is
  inferred.
- **Interior lighting with a source.** There is no dashboard light, no dome lamp and no light that respects
  the car's own shell. A real point light inside the cabin was tried on paper and refused: with no shadowing
  it leaks out through the roof and doors, and the vehicle pool diffuse is per-vertex, so a low-poly cabin
  lights in blotches ([plan 090](../plans/090-vehicle-cabin-at-night/readme.md), option D). The flat add is
  that light, faked, with the tag standing in for its falloff.
- **A gradient off the dash**, which the plan wanted and the data refused: measured on the built previon, its
  night vertex set EQUALS its day set at 255 white, so the engine's `night − day` emissive channel can never
  fire for it and a warm tint could only be written by darkening. There is no free per-vertex scalar left in
  the vertex format to carry a strength.

## What it was judged on

The DETECTION is measured: tagged share of a model's vertices comes to previon 38 %, landstal 5.7 %,
zr350 5.5 %, comet 4.0 %, infernus 3.6 %, bus 0.4 %, pcj600 (a bike, no glass) 0 % — i.e. it finds a lot of a
modelled interior, a little of a stock car's dash-and-seats shell, and nothing where there is no cabin. Per
part on the previon: gauges 86 %, seats 75 %, interior 68 %, door cards 41–46 %, chassis inner side 11 %.

The LEVEL and the TINT are pure taste — 0.35 and a warm amber, picked to read as instrument spill rather than
as a filled box. Field verdict: owed.

## What would retire it

- A real interior light with even coarse self-shadowing (a shell test would be enough), which would replace
  both the flat add and the reason the tag exists;
- an authored signal — a `features.txt` declaration, or a material/frame convention a mod can opt into —
  which would replace the volume test for cars that use it (the geometry test stays the fallback);
- a per-vertex strength channel, which would replace the flat add with the dash gradient the plan wanted.
  The cheap version of that is already identified: strength buckets in the same `meta.w` nibble (values 3…6).

## Blast radius

- The tag is **baked** into `meta.w`'s low nibble, so changing the detection needs a re-pack; the glow level
  and tint are shader constants and change on a reload.
- The nibble is shared with the lamp tags. A real lamp inside the cabin keeps its own tag, and
  `rigidLampGlow` must keep falling through for any tag that is not head or tail — without that guard the
  cabin burns at the head-lamp level (2.4).
- The glow rides the per-instance lamp state, so it also scales with `graphics.headlights.intensity`: turning
  the lamps down turns cabins down with them, and there is no separate dial.
