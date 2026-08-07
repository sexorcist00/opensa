# 04 — Each fx system's own cull distance, and how far smoke is drawn

Part of [100 — 2dfx survives to LOD range](readme.md). Lands in `apps/web` + `packages/renderware`.
**Gated on nothing** — and it is the step that decides how far an emitter is drawn at all, so nothing else in
this chain is visible for particles until it lands.

## Context

`apps/web/src/ui/engine-particles.ts`:

```ts
/** Config draw distance for emitters (world units) — beyond this the vertex shader collapses the quad. */
const DRAW_DISTANCE = 300;
```

One constant, written into every baked system record, for every effect on the map. `effects.fxp` authors a
`cullDist` PER SYSTEM and our parser already reads it — we simply do not use it:

| System | Authored | Ours today |
| --- | --- | --- |
| `ws_factorysmoke` | **150** | 300 |
| `smoke30m`, `smoke30lit` | 155 | 300 |
| `smoke50lit` | 255 | 300 |
| `carwashspray` | 70 | 300 |
| `fire`, `flame` | 35 | 300 |
| `water_fountain` | 30 | 300 |
| `vent`, `vent2`, `waterfall_end` | 25 | 300 |
| `insects`, `cigarette_smoke` | 15 | 300 |

So a cigarette plume renders 20× farther than authored, and a factory plume — the thing this chain is
for — stops at 300 no matter what the streamer keeps resident. This is exactly the case `CLAUDE.md` names: a
global tuning constant standing where the game's own numbers should be read.

## Decisions

1. **Read `cullDist` per system.** The value already reaches `bakeFxSystem`'s caller; it stops being dropped.
2. **Smoke systems are raised above their authored value, deliberately.** A plume that dies at 150 while its
   factory draws to 1000 is the defect. The multiplier/target is chosen against the field check in
   [03](03-lod-bundle-reads-2dfx.md), not guessed here — and it is a **departure from authored data**, so it
   gets a `docs/hacks/` file naming what it overrides and what would retire it.
3. **`insects` and `cigarette_smoke` get a floor of 100 u** (the user's call), not their authored 15. Also a
   hack file, in the same change: it is a second, opposite departure and the two must be recorded together or
   the next reader sees one and assumes a rule.
4. **Everything else takes its authored number verbatim.** No global scale, no clamp — the point of the step
   is that the table wins.

## Tasks

- [ ] Thread each system's `cullDist` into `writeFxSystemRecord` instead of `DRAW_DISTANCE`.
- [ ] Apply the two departures (smoke raise, 100 floor for the two tiny systems) as DATA, in one table, not
      as scattered conditionals.
- [ ] `docs/hacks/`: one file for the smoke raise, one for the floor.
- [ ] Tests: a system's record carries its own distance; the two floored systems carry 100; a system absent
      from the departures table carries exactly what the fxp says.
- [ ] Measure: draw calls / frame ms with the authored distances vs the flat 300, in a dense area — most
      systems get SHORTER, so this should pay for the smoke raise on its own.

## Verification

- Every baked system's draw distance equals its authored `cullDist`, except the two documented departures.
- Smoke is visible at the distance the field check asks for; insects stop at 100 rather than 300.
- Frame cost in a dense area does not regress; the expected direction is a small win.

## Measurements / notes

_(record after implementation)_

- per-system distances shipped (authored vs applied): …
- frame ms before/after in a dense area: …
