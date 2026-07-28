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

## Measured

_(to be filled in when the step ships)_
