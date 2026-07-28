# 090/02 — A dash glow that comes on with the headlights

**Status: OPENED 2026-07-28.** Depends on [01](./01-night-sky-relax.md) having shipped: this step is the
beauty pass, not the fix.

## What it ships

A car's cabin lights from its instrument panel when its lights are switched on — per instance, so a parked
car with its lamps off stays dark and the one you are driving does not.

Three pieces:

1. **Cabin detection, at build, from the model's own geometry.** The greenhouse is the union of the GLASS
   submeshes (a class the builder already decides): its XY footprint and its top Z. The floor is the wheel
   hub height, which the builder already resolves — everything below it is underbody, wheel well and engine
   bay, all just as enclosed as a cabin and none of it allowed to glow. A vertex is cabin when it is inside
   that volume AND its sky occlusion says it really is enclosed. A model with no glass class has no cabin
   and gets nothing.
2. **A warm gradient baked into the NIGHT vertex colours.** Strongest at the front of the cabin volume (the
   dash) and falling off toward the rear, so it reads as instrument spill rather than as a filled box. This
   rides the channel that already exists — the night set — and the engine's existing `night − day` delta
   turns it into emission and bloom for free, exactly as a shop window on the map does. The builder must
   only lift a night set it SYNTHESIZED; a mod that authored its own night colours keeps them.
3. **A `cabin` lamp tag** (the `LampTag` nibble has 2 of 15 values used) so the shader can hold that lift
   back while the car's lights are off: a tagged vertex falls back to the plain `day × NIGHT_AMBIENT` night
   colour until `lamps.x` says the headlights are on. `NIGHT_AMBIENT` is shared with the map path and must
   not drift — mirrored into WGSL with that stated next to it.

Config-scaled and deniable, in the style of 080/10: one knob under `graphics`, zero meaning "no cabin glow",
and the whole thing gated to night by the day/night factor.

## The traps this step has to walk around

- **The tag must not turn the cabin matte.** `materialClass` treats a lamp tag as "not a reflective
  surface"; the cabin tag is per-VERTEX and geometric, so it must be carried separately from the per-MATERIAL
  lamp tag and must not reach that decision.
- **A lamp material inside the cabin wins.** Where the two collide, the real lamp tag stays.
- **Do not double-count with the plate/extra nibbles.** The high nibble is the material class; only the low
  one is being extended.

## Verification

- unit, in the builder: a synthetic car with glass, an interior and an underbody — the interior is tagged
  and lifted, the underbody and the outer body are not; a car with no glass gets no cabin at all; an
  AUTHORED night set survives untouched;
- offline: `dump-vehicle-materials.ts` extended with the night RGB it writes, previon before/after;
- in-engine: headless night capture, interior camera, lights off vs lights on;
- field: the user's verdict.

## What the build actually measured, and what it changed in the design

**The night-colour carrier is unusable, and that is a measured finding, not a preference.** The plan above
assumed the warm gradient could ride the NIGHT vertex colours and turn into emission through the engine's
existing `night − day` delta. Read out of the built previon: its night set EQUALS its day set, and both are
`255,255,255` on most of the cabin. Two consequences — the delta can never be positive (a channel cannot
exceed 255, so the emissive path can never fire for a car authored white), and a "warm tint" could only be
written by taking channels DOWN, i.e. by darkening the very geometry the step is meant to light.

So the gradient was dropped and the glow became one flat warm term on the tagged vertices. What reads as a
dashboard comes from the geometry's own normals, textures and occlusion, which are all still in play. If the
flat fill turns out to look like a filled box in the field, the next lever is a coarse gradient encoded in
the same nibble (values 3…6 as strength buckets) — cheap, and it needs no new vertex channel.

## Measured

**Shipped 2026-07-28.**

Build side — `packages/renderware/src/vehicle/cabin.ts`, called from `buildVehicleModel` after the occlusion
bake; the tag goes into `meta.w`'s low nibble (`LampTag.cabin = 3`) only where no real lamp tag sits.

**Share of a model's vertices tagged as cabin:**

| model | verts | cabin | share |
| --- | --- | --- | --- |
| previon (mod, a fully modelled interior) | 91 837 | 35 152 | **38.3 %** |
| landstal | 5 130 | 292 | 5.7 % |
| zr350 | 3 749 | 206 | 5.5 % |
| comet | 4 241 | 169 | 4.0 % |
| infernus | 4 467 | 161 | 3.6 % |
| bus | 5 275 | 22 | 0.4 % |
| pcj600 (a bike — no glass) | 2 946 | **0** | 0 % |

Per part on the previon: gauges 86 %, seats 75 %, interior 68 %, the `extraN` cabin trim 63–77 %, door cards
41–46 %, the chassis's inner side 11 %, boot lid inner 5 %.

**The one trap the volume test has, found by measuring rather than by reading:** the TOP HALF of a rear
wheel stands above the hub line, inside the greenhouse footprint, and is enclosed by its own arch — every
clause passed, and 17 % of each rear wheel's vertices came out tagged. Wheels (and the `_vlo` LOD) are now
excluded explicitly, which is honest: a wheel is a part the builder placed itself, so it says so rather than
having a geometric rule invented for it.

Runtime — `rigidCabinGlow` in the vehicle fragment path: `CABIN_TINT (1.0, 0.82, 0.55) × CABIN_GLOW (0.35) ×
lamps.z × dn`, added to the diffuse sum (NOT through the lamp early-return, which would have dropped the
moonlight and the street-lamp pool from the cabin). `rigidLampGlow` now falls through for any tag that is not
head or tail — without that guard the cabin tag would have taken the head-lamp branch and burned at 2.4.

Both the level and the tint are LOOK constants, tunable on a reload. The switch's cost is written up as a
performance lever (`deferred-optimizations/vehicle-cabin-glow-switch.md`).

**Still owed** — the tag is BAKED, so it needs a re-pack before it shows on a converted car; the night
captures (lights off vs on) and the field verdict come with the user's rebuild.
