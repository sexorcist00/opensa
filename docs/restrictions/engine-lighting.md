# Lighting restrictions

The local light pool has two halves, and **who may read which half is a structural split, not a tuning
knob**. Any plan about lighting a car, a ped or a cabin runs into this before it runs into anything else.

## The pool is ordered dynamic-first, and vehicles read only the static half

```
pool:  [ ─── dynamic ─── | ─── static ─── ]
        0            params4.x        params3.x
```

- `localLightDynamic(0 … params4.x)` — read by the **world**, per PIXEL (`worldShade`).
- `localLightStatic(params4.x … params3.x)` — read by **vehicles and peds**, per VERTEX (`vsRigid`).

`packages/engine/src/render/shaders.ts` — the split is stated at the `params4` declaration: *"vehicles and
peds take the STATIC half only, so a car is never lit by its own lamps."*

**A car's own headlights are pushed as DYNAMIC** (`apps/web/src/ui/engine-vehicles.ts`). So "light the cabin
from the headlight source we already have" is not a small addition — the vehicle shader never reads that
half. Changing it means changing the split, and the split is what stops a car flooding itself with its own
beams.

**Caught:** no. Adding a light to `dynamicLights` and expecting a car to react produces silence, not an error.

## The static half is EMPTY today

`fillLightPool` (`packages/engine/src/engine.ts`) pushes `this.dynamicLights` and nothing else — static 2dfx
street lamps were removed from the pool 2026-07-17 (binary pool admission read as "lamps igniting ahead of
the car"; a smooth-admission restore was tried and reverted, 085 row E).

So `params3.x === params4.x`, `localLightStatic`'s range is empty every frame, and **a vehicle currently
takes nothing at all from the light pool**. Any plan that reasons about "the street lamp on the dashboard" is
reasoning about a term that is identically zero.

**Caught:** no.

## Readmitting static lamps re-arms a known bug

`out.poolDiffuse = localLightStatic(...)` carries no `in.local.w`, where the indirect term beside it does —
the static pool is the one light term a car's own sky occlusion does not gate. A street lamp would light a
dashboard as if the roof were not there. Latent while the half is empty; live the moment 085 row E ships.

Whoever restores static lamps owns this gate. Detail:
[`open-issues/vehicle-cabin-and-glass.md`](../open-issues/vehicle-cabin-and-glass.md).

**Caught:** no.

## Pool capacity is 64, and it is not the binding constraint

`LIGHT_POOL_CAP = 64` (`packages/engine/src/engine.ts`), mirrored by the WGSL loop bound; stride 12 floats.
Since only the driven car contributes, real occupancy is a handful of lamps. **Do not design around the
count** — design around the two restrictions above.

**Caught:** yes — `push` silently drops past the cap, but the cap is nowhere near.

## Only the driven car lights up

Headlights, tail lamps, their pool lights and coronas are per-vehicle state and the lamp system drives
exactly one car. Parked and traffic cars stay dark at midnight, and retractable headlights follow the same
signal, so their pods stay parked too. A plan about night traffic has to start here.

**Caught:** n/a — recorded in [`edge-cases/engine-rendering.md`](../edge-cases/engine-rendering.md), which
carries the measured detail.

## A per-vertex classification cannot be drawn through a flat varying

`lampTag` — and every `@interpolate(flat)` varying — switches **whole triangles**. Plan 090's "hard polygonal
patches across the seats" was exactly this: a per-vertex cabin flag read through `lampTag`. If a
classification must reach the fragment stage it needs a smooth varying **and** a value whose interpolation is
meaningful at the boundary.

Related, and independent of the varying: **thresholding a noisy bake IS the speckle.** 23 % of that car's
seat vertices sit at sky 0.8–1.0 while the rest are at 0.2–0.5, scattered rather than banded.

**Caught:** no — it renders, it just renders wrong.
