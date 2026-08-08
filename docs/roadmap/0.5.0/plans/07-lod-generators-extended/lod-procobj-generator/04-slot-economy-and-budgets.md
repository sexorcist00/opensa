# 04 — Slot economy, budgets and integration

> **PREMISE WRONG TWICE — rewrite this plan before starting it.**
>
> It was written as an int16 story ("gated on our own ASI, Task 3"). It is not one: measured 2026-08-07 on
> `build/original/opensa`, we sit at 20 146/32 767 text rows but **38/40 IPL slots**, so what binds on STOCK
> is the slot array and the per-area `LoadScene` budget, neither of which our ASI lifts.
>
> Then the target install itself was captured, and **on the install we actually ship to neither of those
> ceilings exists**: OLA sets `EntitiesPerIpl = unlimited` (the 4 096 per-file buffer) and
> `EntityIpl = unlimited` (the 40 slots), with `Buildings = 100000`. It runs 72 914 permanent rows in files
> of up to 9 627 — see [`gta-sa-original/reference-install.md`](../../../../../gta-sa-original/reference-install.md).
> **So there is no ceiling left to lift here, and no correctness number left to find.** The one ceiling no
> adjuster touches is int16, and `perfect-map.asi` already handles it at 2.23× the limit on that install.
>
> What this plan becomes: **a per-target cap decision plus a perf budget.** Stock keeps today's guards;
> the reference target is bounded by memory and frame time, measured. Decisions 2 (the binary-stream economy
> stays) and 3 (perf becomes the budget) survive intact — they were never about int16. Decision 1's
> "opensa-asi target" needs renaming: the target is defined by the ADJUSTERS plus our asi, not by our asi
> alone.

Part of [07 — LOD generators, extended](../readme.md). Depends on [02](02-density-model.md)/[03](03-biome-zone-density.md) (the density model), on [00](00-limit-route-review.md)'s route decision, and — if that decision keeps our own ASI on the path — on [03-asi/006](../../../../../../asi/perfect-map/docs/plans/006-pipeline-integration.md) (the stock-vs-opensa-asi target modes). Delivers the actual "MORE objects": raising the caps so 02/03's density can ship, and re-establishing perf as the limiter.

## Context

Raised density (02/03) is capped today by budgets that were sized for the int16 bug (from the grounding):

- `AREA_MAX_PAIRS = 2000` (4000 rows/area) + `STREAM_MAX_INST = 512` (`streamed-areas.ts`);
- `procObjMax = 20000` (`config.ts` / `convert.ts`);
- `TEXT_ROW_CAP = 30000` global (`pipeline.ts` `checkTextIplSlotBudget`);
- `PROC_OBJ_MAX_DENSITY = 3` candidate ceiling (`procobj-scatter.ts`).

Only one of those four is an int16 cap. `TEXT_ROW_CAP` is, and it is **not** in the way — the density target fits under it. `AREA_MAX_PAIRS` mirrors SA's per-file `gpLoadedBuildings` budget, which is a real 2004 ceiling **on a stock install and is set to `unlimited` on the reference one**. `procObjMax` and `PROC_OBJ_MAX_DENSITY` are our own safety numbers and cost nothing to raise once something downstream can absorb the objects.

**So the plan's job is not to lift anything.** It is to (1) split the caps by target, (2) find where memory and frame time actually stop us on the reference install, and (3) keep the stock target exactly as safe as it is today. Perf was always going to be the real limiter; on this install it already is.

## Decisions

1. **Target-gated caps** (mirror 03-asi/006). For the opensa-asi target: `AREA_MAX_PAIRS`, `STREAM_MAX_INST`, `procObjMax`, and `PROC_OBJ_MAX_DENSITY` rise to new values (or become perf-bounded); for the stock target they stay exactly as today (int16-safe). One target flag drives limits, particle policy (the 2dfx chain), AND procobj caps — consistent across the pipeline.
2. **The `linkedHeight`/binary-stream economy STAYS.** It's still good memory/draw economy independent of the ceiling (shorter species ride binary streams costing zero text rows). We raise the ceiling, not abandon the streaming layout — density fills the newly-available headroom through the same efficient placement.
3. **Perf becomes the budget.** Past int16, the limiter is FPS/streaming. Tie the density caps to a measured budget: use the rendering perf HUD (plan 063) + streaming smoothness (plan 060 machinery) to find how much clutter the engine streams without hitching, and set the opensa-asi caps from THAT, not a guess. Denser areas must still stream in smoothly (the warm-invisibly/atomic-appear invariants must hold under higher counts).
4. **New guard, not no guard.** Replace the int16 `checkTextIplSlotBudget` throw (for the asi target) with a **perf/streaming budget guard**: fail (or warn) the build if a cell/area exceeds the measured streamable object count. Silent over-scatter that hitches in-game is as bad as the old crash — guard it loudly (same spirit as `checkImgIdBudgets`).
5. **Fallback honesty** (from 006): an opensa-asi-target build with raised density REQUIRES the asi; without it, the same int16 corruption returns. The installer's asi-presence check covers this content; loud warning.

## Tasks

**Slot economy first — these are the ones the target actually needs, and none of them needs an ASI:**

- [x] ~~Find out what `AREA_ROW_CAP = 4000` really models~~ — **ANSWERED 2026-08-07 from the target
      install's own configuration, no field run needed.** ProperFixes' 9 627-row IPL files load because OLA
      sets **`EntitiesPerIpl = unlimited`**, which grows exactly the `gpLoadedBuildings` per-file buffer our
      cap guards (0xBCC0E0 @ 0x5B892A — our own OLA source study in `asi/perfect-map` 004). The cap is not
      wrong; it is a **stock-target** cap, and it is **inert on the install we ship to**. The same install
      sets `EntityIpl = unlimited`, so the 40-slot ceiling is gone too, and `Buildings = 100000`. Full
      capture: [`gta-sa-original/reference-install-config.md`](../../../../../gta-sa-original/reference-install-config.md).
- [ ] **Decide the reference-target caps, and measure what actually limits them.** With both ceilings
      `unlimited` there is no correctness number left to find here — the limiter is memory and frame time,
      which is what the perf tasks below are for. Set `AREA_MAX_PAIRS` and the slot guard per target (stock
      = today, reference = perf-bounded) rather than hunting a ceiling that the target does not have.
- [ ] Pack the generated areas tight. They average 3 501 of a 4 000-row budget today; a repack to the budget
      is ~2 slots back at current density and more at raised density. Measure the recovered slots and check
      that no area breaches the budget after it — this is 00's hygiene task, executed.
- [ ] Report the slot and row cost of a build as a first-class output (like `checkImgIdBudgets`), so a
      density profile's price is visible when it is chosen rather than when the build fails. Today the number
      takes a script to recover, which is why 04's premise went a fortnight without being checked.
- [ ] Raise `linkedHeight` deliberately as a slot lever, and measure it: every species pushed below it trades
      a permanent text row for a binary-stream row, which is the cheapest density we can buy without lifting
      anything. Record what it costs at range (a shorter species with no permanent LOD pops in later).

**Then the caps, shaped by [00](00-limit-route-review.md)'s decision:**

- [ ] Target-gate the procobj caps (`AREA_MAX_PAIRS`, `STREAM_MAX_INST`, `procObjMax`, density ceiling): stock = today, opensa-asi = raised; wire to the same target flag 03-asi/006 introduced.
- [ ] Perf/streaming budget calibration: measure (plan-063 perf HUD + streaming settle-watcher) how many procobj a dense area can stream without hitching; set the opensa-asi caps from the measurement. Record the numbers.
- [ ] New budget guard for the asi target (per-area/per-cell streamable-object ceiling) replacing the int16 row guard; tests both modes (mirrors `checkImgIdBudgets`/`checkTextIplSlotBudget` test style).
- [ ] End-to-end: build a high-density full map (02/03 profiles, opensa-asi target), install with the Task-3 asi, in-game (Wine) → denser forests/desert/mountains, no ghost-barrier/int16 corruption, streaming stays smooth. Record counts + fps + hitch stats.
- [ ] Stock-target regression: caps unchanged, build still int16-safe (fails past 30k as today).
- [ ] Docs/memory: update the procobj plans (007 binary streams), ghost-barriers cross-ref (the density this unlocks), and the opensa-procobj-decimation memory (density knobs + new asi-target ceilings).

## Verification

- opensa-asi target: a build exceeding the old 20k/30k caps ships and runs; denser biomes visible; streaming smooth (no hitch regression); no int16 corruption.
- stock target: unchanged, still guarded at the old caps.
- Without the asi on a dense build: installer warns; corruption returns (fallback honesty).

## Measurements / notes

_(record after implementation)_

- new opensa-asi caps (area pairs / stream inst / procObjMax / density ceiling): …
- streamable-object budget per area from measurement: …
- dense full-map counts + fps + hitch stats vs vanilla: …
