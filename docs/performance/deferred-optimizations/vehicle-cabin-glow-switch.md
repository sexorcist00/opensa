# Drop the cabin-glow switch and leave the bake

**Status:** in reserve — not needed. Opened 2026-07-28 alongside the change it describes
([plan 090/02](../../plans/090-vehicle-cabin-at-night/02-dash-glow.md)).

## What we do today

A car's cabin glow is BAKED at build time into the night vertex colours (a warm gradient off the dash), and
the runtime holds that lift back until the car's own headlights are switched on: the vertices carry a
`cabin` lamp tag, and the vehicle fragment path falls back to the plain `day × NIGHT_AMBIENT` night colour
while `lamps.x` is 0. Per instance, so a parked car stays dark and the one you drive lights up.

So the DATA is already precomputed; what is paid at runtime is only the switch.

## The lever

Delete the switch and let the baked night set apply as it always does — every cabin simply glows at night,
lights on or off (option **B** in the plan's option list). That removes:

- one nibble value and the per-vertex tag it rides in (the tag itself is free — the byte already exists),
- one compare and one `mix` per fragment on the rigid vehicle path,
- the `NIGHT_AMBIENT` constant mirrored into WGSL, and the risk of it drifting from the builder's copy.

## What it would win

**Unmeasured, and expected to be immaterial** — a compare and a `mix` per vehicle fragment, on a path that
already does a probe sample, a flake normal, a neo reflection LERP and two specular lobes. Recorded because
the maintenance rule asks for the alternative in the same change, not because the cost has been seen.

The honest number to look for before pulling it: the vehicle pass in the bench harness, close-up, night.
If that pass is not the stage that is slow, this lever is not the answer.

## What it would cost

- **A cabin glowing with the lights off.** Every parked car in the street would light its interior at night,
  which is the look the switch exists to avoid — it reads as a fleet of lanterns rather than as traffic.
- The feature loses its per-instance meaning, so a car cannot express "lights on" in its cabin at all — the
  same lamp state that swaps the lamp texture would no longer reach the interior.
- Nothing about the build changes: the bake stays either way. This is purely giving up the switch.

## What would have to be true to pull it

A measured vehicle-pass cost where this branch is a visible share of it, on a scene of many close cars at
night — and a decision that lit parked cabins are acceptable. Both, not one.
