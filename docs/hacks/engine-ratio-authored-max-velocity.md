# The engine's ratio uses the AUTHORED top speed, not the transmission's

One denominator in [`packages/audio/src/vehicle-table.ts`](../../packages/audio/src/vehicle-table.ts),
taken 2026-09-09 while building [203/5-02](../plans/203-audio/readme.md).

## 1. What it is

```ts
export const MAX_VELOCITY_FIELD = 11;
maxSpeedMs = handling.fields[MAX_VELOCITY_FIELD] * (1 / 3.6);
```

A car's engine is voiced by `ratio = speed / maxSpeed`
([the model](../../packages/audio/src/vehicle-engine.ts)), and `maxSpeed` here is `fMaxVelocity` from
`handling.cfg` — the number the author wrote — converted from km/h.

## 2. What it stands in for

**`CAEVehicleAudioEntity` divides by `vp.Transmission->m_MaxVelocity`, which is not that number.** The
original walks DOWN from `fMaxVelocity` until air drag has eaten a sixth of the engine's pull, calls what it
lands on the flat top, and the gear ceiling sits 1.2x above it — the whole derivation is already implemented
in this repository, in [`packages/game/src/vehicle/drivetrain.ts`](../../packages/game/src/vehicle/drivetrain.ts)'s
`buildGearbox`.

It is not used here because **the dispatch console may not import `@opensa/game`**: the console is a
`type:app` that deliberately carries no physics layer, and pulling the drivetrain in to voice an engine
would drag the gearbox, the handling model and their dependencies into a surface whose whole point is that
it has none of them.

## 3. What it was judged on

**Arithmetic, and no ear yet.** The two denominators differ by the drag walk-down times 1.2, so:

- a slippery car (little drag) barely walks down: the two numbers land within a few per cent, and the 1.2
  makes ours the LARGER ratio by about a fifth;
- a draggy one (a rig, a bus) walks down a long way, so its transmission ceiling is well under its authored
  number and ours is smaller still.

The practical effect in both directions is **the same car crossing the idle/cruise threshold at a slightly
different speed than the game would**, and reaching the top of the rev curve at a slightly different one.
Nothing else in the model reads the ratio.

## 4. What would retire it

- **Moving the engine voicing into the game layer**, where `buildGearbox` already sits — the game surface
  will want the same sound and has the gearbox in hand. That is the honest home for it, and this bridge
  exists only because the console got there first.
- Or exporting the walk-down alone as a dependency-free function from `@opensa/game`, which is a smaller
  change than moving the consumer and would let both surfaces divide by the same number.

## 5. Blast radius

- Only the engine's ratio. Nothing else in the audio chain reads a top speed.
- A car with no `handling.cfg` row at all already falls back to the game's own default of 160 km/h — that
  path is unchanged and is not this hack; it is what the world adapter does too.
- If the field says cars rev too early, this is the first number to look at, and the fix above is the answer
  rather than a scale factor on top.
