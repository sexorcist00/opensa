# 013 — `audio.txt` and `parked.txt` for a replacement car

**Status: PLANNED 2026-08-19.** Part of [central plan 102](../../../../docs/plans/102-add-vehicles/readme.md).
Neither file exists in `mods-src/original/vehicles` today; both exist in `add-vehicles` (4 `audio.txt`,
1 `parked.txt`) and the merges they need are the same for a replacement car that wants its own engine sound
or a parked spot. Built here so the new tool imports them — and so a replacement car can use them.

## The two files

- **`audio.txt`** — one line of FLA's `data/gtasa_vehicleAudioSettings.cfg` (`Enable vehicle audio loader = 1`
  is ON in the reference install): `<model> <engine-on> <engine-off> … <horn> <door> <radio> …` — the columns
  of the stock file; the first token is the model NAME. Merge: replace the line whose first token is the
  slot, append if absent; CRLF and the header block preserved. FLA's loader is keyed by name, so a
  replacement car keeps its stock line unless it ships this file — nothing is inherited here (the
  `(base)` inheritance is add-vehicles 003's business).
- **`parked.txt`** — one or more Parked Maker lines WITHOUT the id: `<x> <y> <z> <angle> [colour1 colour2
  …]` as the mod writes them (`35 35 2495.98 -1673.15 13.25 0.00` in the only instance: the two leading
  numbers are the mod's own colour/flag columns — read its readme before fixing the column list). Merge
  into `cleo/Parked Car Maker.ini` `[Cars]`: `N=<id> <line>`, N continuing from the highest present,
  idempotent by (id, line). Requires mod 47 and FLA `Accept any ID for car generator = 1` (on) — absent →
  warning, nothing written. The FLA `Car generators` budget (`#Car generators = 500`, commented = default
  500) is COUNTED: the built ini's `[Cars]` rows + stock car generators must stay under it, or the run
  warns with the number to raise.

## Steps

1. **`audio.ts`** — parse/replace/append by first token; a malformed column count (against the stock file's
   own header) → warning, line dropped. Called from `applyVehicle`.
2. **`parked.ts`** — `[Cars]` merge as above + the budget count. Called from `applyVehicle` with the car's id
   (a replacement car's id is its stock row's).
3. **Contract** — `docs/contracts/vehicles.md` §1: both names, the id-less line shape, the two mods they
   need, what a misspelling does.
4. **Fixtures + tests** — the `audio.txt` of `106veh` and the `parked.txt` of `001veh` from `add-vehicles`
   (manifest lines by name); tests: replace vs append, header preserved, malformed line warned, `[Cars]`
   numbering continues, idempotence, the budget warning.
5. **Field** — a replacement car with an `audio.txt` (author one from its stock line for the test) sounds
   different; a `parked.txt` car stands where it says after a NEW GAME.

## Measured

*—*
