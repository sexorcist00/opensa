# Bake vehicle sky-occlusion in opensa-pack

**Status:** in reserve — not needed. Opened 2026-07-22 alongside the change it describes
([plan 084](../plans/084-vehicle-appearance/readme.md), commit `e5004e0`).

## What we do today

`packages/renderware/src/vehicle/sky-occlusion.ts` computes a car's self-occlusion **in the shared builder**,
so it runs inside `buildVehicleModel` — the function opensa-pack calls offline AND the spawn-time worker
calls for a car that arrives through modloader. Converted cars therefore pay nothing at runtime (the values
are already in the `.osm`'s night-set alpha), and a modloader car pays the pass once, when its model is
built.

## The lever

Move the computation into opensa-pack and read it back as data, i.e. treat occlusion as a baked product like
map AO. The builder would then only consume what the converter wrote.

## What it would win

The whole pass, on the spawn path only. Measured 2026-07-22 (Apple M-series, `skyOcclusion` alone):

| model                    | verts  | pass    |
| ------------------------ | ------ | ------- |
| stock cars (admiral, infernus, cheetah…) | 3.8–4.8 k | 8–20 ms |
| mod admiral              | 90 887 | 78 ms   |

Once per MODEL, not per instance, and only for models that are not already converted. So the realistic win
is a single hitch of tens of milliseconds the first time an unconverted car spawns.

## What it would cost

- **The two paths would disagree.** This is the reason it was refused (user decision, 2026-07-22): a
  modloader car has no baked data, so it would either get no occlusion (visibly brighter cabin and underbody
  than the same car converted) or a second implementation to fall back on, which is the same code twice.
- A new field in the `.osm` fixture / a meaning attached to a stream, plus a re-convert before any change to
  the occlusion model is visible.
- Tuning turnaround: today changing a constant in `sky-occlusion.ts` shows up on the next reload; baked, it
  costs a pack run.

## What would have to be true to pull it

- Spawn hitches actually measured on the unconverted path — i.e. modloader cars in normal play, not the
  converted build, where this pass costs nothing already.
- Either modloader cars accepted as second-class (no occlusion), or a cheap runtime fallback whose output is
  close enough to the baked one that the two don't read differently side by side.

## Cheaper things to try first

- Lower `GRID` / `AZIMUTHS` / `MARCH_CELLS` in `sky-occlusion.ts` — the pass is O(verts × azimuths × cells)
  and the field is coarse by design; halving the azimuths halves the cost.
- Compute it in the model worker rather than on the main thread if the hitch is a stall rather than a cost
  (the unoptimized path already builds vehicle models off-thread).
