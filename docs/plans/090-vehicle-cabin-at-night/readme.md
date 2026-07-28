# 090 — A car's cabin at night

**Status: OPENED 2026-07-28** by a field report against `build/gostown/opensa`: from the interior camera of
the previon the cabin is **almost black at dusk** — the seats are silhouettes, the dashboard reads as one
flat dark shape. The user's brief: make the cabin readable at night, and if it can be made pretty, do that
too, at build time rather than as a per-car hack.

## What is actually happening (measured, not guessed)

Night leaves a car with exactly one term, and that term is multiplied three times over:

```
ambient = frame.params.y (night level) × DYNAMIC_INDIRECT × skyVisibility(normal) × in.local.w (occlusion)
```

`in.local.w` is the per-vertex sky occlusion plan 084 bakes in the shared builder. Read out of the BUILT pak
with `scripts/debug/dump-vehicle-materials.ts gostown previon`:

| geometry | sky occlusion |
| --- | --- |
| cabin: dash trim / gauges / seats | **0.32–0.69** (trim 0.63, gauges 0.56, seats 0.49–0.55) |
| outer bodywork | 0.90–1.00 |
| glass | 0.95–1.00 |

By day the sun's N·L drowns that factor. At night there is no sun, the indirect term IS the picture, and the
cabin gets a third to two thirds of an already low number — on top of a night vertex colour synthesized as
`day × [0.30, 0.32, 0.40]`. So the black cabin is not a texture-bake problem: it is **an occlusion term
built for the SKY still dividing the light when the sky is no longer the source.**

Two neighbouring facts worth keeping in view:

- The same day the report came in, the reflection/specular gate landed (`3e37d10`), which scales the mirror
  and the sun/moon highlight by that same occlusion. It takes a little more off a cabin at night — the
  chrome trim highlight from a passing street lamp. Expected, and part of what step 01 is answering.
- 084 introduced the dynamic indirect term precisely BECAUSE a car at night collapsed into one flat colour
  with no readable edges. Whatever we relax here must not undo that: the cabin has to come back without the
  body going flat again.

## The shape of the answer (decided with the user, 2026-07-28)

Four options were weighed; two were taken, in this order, each individually shippable under its own field
verdict:

- **A → step 01. Stop dividing the night by a SKY term at full strength.** At night the light that reaches
  a cabin arrives from the street, sideways, through the glass — which a height-field horizon over the car's
  own roof does not model at all. One runtime factor, no bake, no new channel.
- **C → step 02. A dash glow that comes on with the headlights.** The cabin is detected at build time from
  the model's own geometry (never a per-car list), a warm gradient is baked into the NIGHT vertex colours,
  and a new `cabin` lamp tag lets the shader hold that lift back until the car's lights are switched on.

Rejected, with the reasons kept so they are not re-proposed:

- **B — the same bake, always on at night, no switch.** Strictly less than C at the same build cost; C's
  only extra is the tag and one shader branch. Kept as the **fallback lever** if that branch ever costs
  anything: `docs/performance/deferred-optimizations/vehicle-cabin-glow-switch.md`.
- **D — a real point light inside the cabin.** No shadowing, so it leaks out through the roof and the doors
  and the car glows like a lamp; gating it by `1 − skyVisibility` fixes the leak but the vehicle pool
  diffuse is computed PER VERTEX, and a low-poly cabin would light in blotches.

## Why the cabin can be found without naming a car

Every signal is the model's own (the standing rule: a rule must derive from what the asset carries, because
today the model sits on `previon` and tomorrow on something else):

- **the glass**, whose material class the builder already decides — the union of the glass submeshes is the
  greenhouse, and it gives both the cabin's XY footprint and its ceiling;
- **the wheel hubs**, which the builder already resolves — everything below hub height is underbody, wheel
  well and engine bay, which are just as enclosed as a cabin and must NOT light up;
- **the occlusion** itself, as the "actually enclosed" test.

A model with no glass class (a bike, an open boat, a trailer) has no cabin and gets nothing — a supported
answer, not a failure.

## Steps

| # | File | What it ships |
| --- | --- | --- |
| 01 | [01-night-sky-relax.md](./01-night-sky-relax.md) | the night no longer divides by the sky term at full strength — the cabin stops being black |
| 02 | [02-dash-glow.md](./02-dash-glow.md) | cabin detected at build, warm gradient baked into the night set, lit by the headlight switch |

## Verification

Each step ends with its numbers written back into the step file, per the standing rule:

- **offline** — `scripts/debug/dump-vehicle-materials.ts gostown previon` before/after (the per-submesh sky
  and night values; step 02 extends it with the night RGB it writes);
- **in the engine** — the headless field-check harness at a night hour, interior camera, same spot, before
  and after;
- **field** — the user's own verdict from the interior camera, which is the one that closes each step.
