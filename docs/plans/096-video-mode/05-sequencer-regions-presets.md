# 096/05 — Sequencer: region cycle, weather/time presets, car pick

**Priority P1. Ships alone: the full brief minus walk/fly — a bounded LS → LV → SF → Country → Desert
cycle, region-native weather, time slots, mod-cars-first. Depends on 02 (04 for the full look; runs fine
on 03's shots if 04 lags).**

## What exists

- The 23 timecyc weather names are region-tagged (`timecyc.parser.ts:73-97`): `*_LA`, `*_SF`, `*_VEGAS`,
  `*_COUNTRYSIDE`, `*_DESERT` (+ `UNDERWATER`, `EXTRACOLOURS_*` — never picked). Weather indices are
  their positions in that list.
- Time slots: `TIME_PRESETS` 00:00 / 06:00 / 12:00 / 18:00 / 21:00 (`debug-overlay.tsx:50`) — D6 says
  snap to these.
- Zone data is live in the game: `ZoneNameSystem` and `CityZoneSystem` (the one that rewrites weather on
  crossings) already classify positions — the region predicate for the route builder derives from THAT
  data, not from hand-drawn rectangles (the derive-from-data rule; also keeps mod maps honest).
- Vehicle roster: `vehicleModelsFromIde` (unfiltered — a model with no `.osm` throws at spawn), so the
  pick pre-filters with `fs.has(`${model}.osm`)`.
- The ledger (06): `data/vehicle-mods.txt` — mod-installed slot names, read at boot; absent file ⇒
  empty set (graceful).

## Tasks

1. **Region presets** (`apps/web/src/video-presets.ts`) — one table, config-shaped:
   `{ key, zonePredicate source, weatherPool (indices filtered from the parsed timecyc list by region
   suffix — derived, not hand-listed), timeSlots (the five), anchorHint }`. `anchorHint` v1 = a seeded
   pick among route-builder start nodes that satisfy the region predicate; the cycle order is D2's.
   The weather pool derivation gets a unit test against the real timecyc fixture (LS pool must not
   contain `RAINY_SF`).
2. **Program table** (D3): `[drive×5 regions] → [fly×2] → [walk×1]` — data, not code; 07's scene kinds
   plug into the same table. Until 07 lands, the sequencer skips non-drive entries with a `[video]`
   notice (no dead modes, no placeholders on screen).
3. **Sequencer** (`engine-video-runs.ts` grows): per scene — advance the program, derive the scene seed
   from the master seed + scene index (reproducible mid-cycle), pick region → hour slot → weather from
   pool → car → route (01, region predicate) → run the 02 pipeline with 03/04 shots. Log one line per
   scene: `[video] scene 7 seed=1234 region=lv kind=drive car=infernus(mod) hour=21 weather=SUNNY_VEGAS
   route=412m` — the self-describing-capture rule applied to scenes.
4. **Car pick** (D10): candidates = roster ∩ `.osm`-present ∩ `type === 'car'` (the `road-cars.ts`
   filter — no boats/planes in v1); if ledger ∩ candidates is non-empty, pick from it first with
   probability ~0.8 (mod cars FIRST, not ONLY — stock classics still appear); seeded. Per-scene
   `colourCycle` reuse for paint variety on stock cars.
5. **Weather/time application**: instantly (`begin(index, 0)`) during the settle window; hour set via
   `setHour(slot)`. D13 accepts the in-scene drift. D15 keeps routes inside one region so
   `CityZoneSystem` never fires its rewrite — add a debug assertion that logs if the weather target
   changes mid-scene anyway (the tripwire for a route that leaked across a boundary).
6. **Cycle continuation**: on scene end (duration reached, `arrived`, or `stuck`) — overlay down,
   teardown (autopilot stop, leave car, despawn, restore nothing else: hour/weather roll into the next
   scene's staging), next program entry. Bounded by D2's revision: the run stops after scene 100 (or
   `&scenes=N`) on an end card. `stuck` scenes are
   logged with their seed — they are the route-builder's regression feed.
7. Tests: program advancement, seed derivation stability, car-pick preference math, weather-pool
   filtering. Negative cases first (empty ledger, region with no accepted route → scene skipped with
   notice, never a throw).

## Acceptance / verification

- A full cycle (8 scenes) runs headless unattended: 8 staged-scene lines, 0 throws, 0 mid-scene weather
  target changes, every region visited in order.
- Same master seed → identical 8-scene manifest (the logged lines diff-equal).
- Mod-car share over 40 scenes ≈ the configured preference (recorded).
- Field look: one full cycle watched end to end — variety reads (different cars, hours, weathers), no
  two consecutive scenes feel identical.
- Ledger: scene staging times (teleport→overlay-up), stuck rate per region, route length distribution.

## Risks / notes

- Desert/Country node sparsity (01's note): the sequencer accepts the builder's achieved length and
  shortens the fragment; record how often.
- 00:00 scenes depend on 093's night control pass being honest — if night looks broken here, that is
  093's owed verification surfacing, not a video-mode bug; route the report there.
- The region predicate from zone data must be cheap (route builder calls it per node) — precompute the
  region per NODES area once at graph load if the per-node lookup shows up in the staging time.
