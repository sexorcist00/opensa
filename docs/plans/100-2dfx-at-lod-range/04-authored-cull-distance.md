# 04 — Each fx system's own cull distance, and how far smoke is drawn

**SHIPPED 2026-08-08.** Part of [100 — 2dfx survives to LOD range](readme.md). Landed in `apps/web`
(`ui/engine-particles.ts`) — `packages/renderware` needed no change, `writeFxSystemRecord` already took the
distance as an argument. It stays here rather than moving into a tool: `apps/web` keeps no numbered plan
chain, and the standing move-on-ship rule is about `tools/<tool>/docs/plans/`.

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

## What shipped

- `fxDrawDistance(system, worldDrawDistance)` reads each system's authored `cullDist` and applies the two
  departures from one `DRAW_DISTANCE_DEPARTURES` table — data, not scattered conditionals. Both bake paths
  (the placed lane and the dynamic `prt_*` lane) go through it; `DRAW_DISTANCE = 300` is gone, surviving only
  as the fallback for a modded system that authors no `cullDist` at all.
- **The smoke departure is derived, not fitted.** `rule: 'world'` takes the host's LOD radius — the same
  number `setupStreaming` is given — so the plume is drawn as far as the world that carries the chimney.
  `setupEngineParticles` gained that argument. A profile that draws further smokes further.
- `docs/hacks/smoke-drawn-to-world-edge.md` and `docs/hacks/tiny-fx-distance-floor.md`, both rowed in the
  hacks README. They are opposite departures and are recorded together on purpose.
- Tests against the REAL `effects.fxp`: four untabled systems keep their authored 25/25/35/70; the four smoke
  systems all take the world distance; `insects`/`cigarette_smoke` come out at 100 from an authored 15; a
  system with no `cullDist` falls back to 300; and the dynamic lane's records read back 50 — SA's own
  `prt_*` value — where they used to read 300.

## Verification

- Every baked system's draw distance equals its authored `cullDist`, except the two documented departures.
- **A consequence the step did not anticipate, worth a field look**: all four `prt_*` systems (wheel dust,
  collision smoke, sand) author **50**, so the vehicle-effect lane's reach fell from 300 u to 50 u. That is
  the authored number and the step's own rule, but it means another car's tyre smoke now stops at 50 m.
- **The smoke half of the look is VERIFIED (2026-08-08, first post-chain pak).** LV plant stacks shot from
  open desert at 300/400/440/600 u: the plume rides the chimney head at every distance, and the white
  cooling-tower puffs seen at 300 u are gone by 600 — two systems, two authored distances, both live in the
  field. Details in [03](03-lod-bundle-reads-2dfx.md) and the
  [hack file](../../hacks/smoke-drawn-to-world-edge.md).
- **The `insects`/`cigarette_smoke` floor is still unverified** — the run framed no anchor of either, and at
  15 u authored vs 100 u applied the difference is only visible standing next to one.

## Measurements / notes

**Placed anchors by system** (stock map, the denominator the departures are priced against): `insects` 402,
`vent` 206, `vent2` 162, `fire` 45, `smoke30m` 19, `smoke30lit` 16, `waterfall_end` 9, `water_fountain` 7,
`smoke50lit` 6, `flame` 3, `water_fnt_tme` 1, `ws_factorysmoke` 1, `carwashspray` 1 — **878 anchors across 13
systems**. The smoke departure touches 42 of them (4.8 %); the rest get between 4× and 12× tighter.

**Frame cost: unmeasurable, and the honest answer is a NULL result, not a win.**
[`docs/benchmarks/opensa-engine/2026-08-08-ingame-fx-cull-distance.json`](../../benchmarks/opensa-engine/2026-08-08-ingame-fx-cull-distance.json).
Headless DPR=2 against `build/original/opensa`, on the two scenes that actually carry emitters
(`country-dusk`: 50 anchors within 300 u including both departures; `lv-night`: 26 `fire`):

| Scene | Arm | `gpuMs.pass` | `avgTriangles` |
| --- | --- | --- | --- |
| country-dusk | before (flat 300) | 3.867 | 1 229 094 |
| country-dusk | after | 3.875 | 1 229 041 |
| country-dusk | **control — every emitter culled** | **3.880** | 1 229 026 |
| lv-night | before (flat 300) | 3.629 | 2 049 828 |
| lv-night | after | 3.600 | 2 046 938 |

The step predicted "a small win". It is not there, and the **positive control is why that claim cannot be
made either way**: forcing every emitter quad in the map to collapse gives 3.880 ms against the A/B's 3.867
and 3.875 — the whole particle system is below this scene's noise floor, so "no regression" would have been a
measurement of nothing. `avgMs` is pinned at 8.333 (the 120 fps cap) in every row, leaving `gpuMs.pass` as the
only responsive column. The one column that does move is triangle count: `lv-night` **−2890 of 2 049 828
(−0.14 %)**, which is the 26 `fire` anchors going from 300 u to 35 — proof the change is live in the field,
and simultaneously the measure of how little it costs.

**Per-system distances shipped** (authored → applied): `insects` 15 → **100**, `cigarette_smoke` 15 → **100**,
`ws_factorysmoke` 150 → **1500**, `smoke30m`/`smoke30lit` 155 → **1500**, `smoke50lit` 255 → **1500**,
`carwashspray` 70, `fire`/`flame` 35, `water_fountain`/`water_fnt_tme` 30, `vent`/`vent2`/`waterfall_end` 25,
`prt_*` (the dynamic lane) 50. Everything not in bold is the authored number, verbatim.
