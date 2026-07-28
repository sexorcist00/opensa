# Bake sky-occlusion in opensa-pack

**Status:** in reserve — and **the vehicle half of it is now void**. Opened 2026-07-22 alongside the change it
describes ([plan 084](../../plans/084-vehicle-appearance/readme.md), commit `e5004e0`); rewritten 2026-07-28,
when the runtime DFF path was removed
([postmortem](../../postmortem/runtime-modloader-overlay.md)).

## What we do today

`packages/renderware/src/vehicle/sky-occlusion.ts` computes self-occlusion **in the shared builder**, inside
`buildVehicleModel`. Its callers:

- **opensa-pack, offline** — every CAR. There is no other vehicle path any more, so a car's occlusion is
  always already in the `.osm`'s night-set alpha and costs the spawn nothing. Nothing left to bake here.
- **the runtime**, for props, clutter and animated map objects (`apps/web/src/ui/engine-props.ts`,
  `engine-clutter.ts`, `engine-anim-objects.ts`) — these still build from a DFF clump on demand, and they are
  what remains of the lever.

## The lever

Move the computation into the converter for those remaining classes too, i.e. treat occlusion as a baked
product like map AO, so the runtime only consumes what was written.

## What it would win

The whole pass, on the on-demand build path. Measured 2026-07-22 (Apple M-series, `skyOcclusion` alone):

| model                                  | verts     | pass     |
| -------------------------------------- | --------- | -------- |
| stock cars (admiral, infernus, rhino…) | 3.8–4.7 k | 3–4 ms   |
| a 91 746-vertex mod car                | 91 746    | 64–76 ms |

Once per MODEL, not per instance. Props and clutter are far smaller than a car, so the per-model cost sits at
the low end of that table — which is exactly why this stays in reserve rather than becoming work.

## What it would cost

- A new field in the converted-model fixture / a meaning attached to a stream, plus a re-convert before any
  change to the occlusion model is visible.
- Tuning turnaround: today changing a constant in `sky-occlusion.ts` shows up on the next reload; baked, it
  costs a pack run.

## What would have to be true to pull it

- A hitch actually measured on the prop/clutter build path in normal play — not inferred from the car numbers
  above, which no longer apply to anything.

## Cheaper things to try first

- Lower `GRID` / `AZIMUTHS` / `MARCH_CELLS` in `sky-occlusion.ts` — the pass is O(verts × azimuths × cells)
  and the field is coarse by design; halving the azimuths halves the cost.
