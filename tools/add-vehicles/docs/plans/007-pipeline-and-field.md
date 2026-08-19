# 007 — Pipeline stage, cars-server, the field round

**Status: PLANNED 2026-08-19.**

## Steps

1. **pmb stage `add-vehicles`** — after `vehicles` (and `cutscene`, which reads the installed REPLACEMENT
   fleet and must not see added cars), before `peds`; `sa` target only (refused for `opensa` with the
   standard message); source `mods-src/<game>/add-vehicles` through the resolver; `--until`/`--only` as every
   stage; `resume.json` records it. The stage runs the guards that already exist on the built tree:
   `checkImgIdBudgets` (FLA TXD pool: 115 cars × ≤ 5 TXDs), `assertCarmodsModels`, and the vehicles.img
   spill cap (the writer's), and writes its counts into `report-sa.json`.
2. **Budgets priced BEFORE the first field run** (the project rule): ids (161 of 999), TXD pool (≤ 575 of the
   6 000 − used), `Car generators` (parked rows), `link` pairs (the 8 wing pairs vs 7 free → 005's guard
   WILL refuse one until `perfect-vehicle` 002 ships; decide with the user which car waits).
3. **cars-server** — the added fleet's pictures from `add-vehicles/screenshots/` by slot, in its own
   section, through the same resolver; the car's page shows its id and base.
4. **Field round** — one full `pmb … --until sa`, delivery to the bottle, and the acceptance list of the
   umbrella plan: traffic, a parked car, the HUD name, the engine sound, the shop parts with names, the two
   `vehicles/` gaps closed. Eight world entries (the 011 ladder) to confirm nothing regressed in the pools.
5. **Audit + numbers** — `docs/audit/` entry for the chain, build time delta, archive sizes, pool counts
   into the plan's Measured and `docs/benchmarks/` where a runtime number moved.

## Measured

*—*
