# B3 — Budget lift & integration (post-asi)

Part of [05 — LOD generators, extended](readme.md), Part B. Depends on [B1](b1-procobj-density-model.md)/[B2](b2-biome-zone-density.md) (the density model) AND **Task 3** ([03-asi Phase 1](../../../../../asi/perfect-map/docs/plans/readme.md): the int16 limit lift) + [03-asi/006](../../../../../asi/perfect-map/docs/plans/006-pipeline-integration.md) (the stock-vs-opensa-asi target modes). Delivers the actual "MORE objects" — raising the int16-era caps now that the engine no longer corrupts past them.

## Context

Raised density (B1/B2) is capped today by budgets that exist ONLY because of the int16 `IplDef` bug (from the grounding):

- `AREA_MAX_PAIRS = 2000` (4000 rows/area) + `STREAM_MAX_INST = 512` (`streamed-areas.ts`);
- `procObjMax = 20000` (`config.ts` / `convert.ts`);
- `TEXT_ROW_CAP = 30000` global (`pipeline.ts` `checkTextIplSlotBudget`);
- `PROC_OBJ_MAX_DENSITY = 3` candidate ceiling (`procobj-scatter.ts`).

With Task 3's asi these int16/array ceilings are lifted (03-asi/006 already added the target modes + relaxed `checkTextIplSlotBudget`). B3 raises the procobj-side caps for the **opensa-asi target** so B1/B2's density actually SHIPS, and re-establishes the NEW real limiter: **runtime performance** (draw calls, streaming, frame budget), not int16.

## Decisions

1. **Target-gated caps** (mirror 03-asi/006). For the opensa-asi target: `AREA_MAX_PAIRS`, `STREAM_MAX_INST`, `procObjMax`, and `PROC_OBJ_MAX_DENSITY` rise to new values (or become perf-bounded); for the stock target they stay exactly as today (int16-safe). One target flag drives limits, particle policy (Part A), AND procobj caps — consistent across the pipeline.
2. **The `linkedHeight`/binary-stream economy STAYS.** It's still good memory/draw economy independent of the ceiling (shorter species ride binary streams costing zero text rows). We raise the ceiling, not abandon the streaming layout — density fills the newly-available headroom through the same efficient placement.
3. **Perf becomes the budget.** Past int16, the limiter is FPS/streaming. Tie the density caps to a measured budget: use 02-rendering's perf HUD + streaming smoothness (plan 060 machinery) to find how much clutter the engine streams without hitching, and set the opensa-asi caps from THAT, not a guess. Denser areas must still stream in smoothly (the warm-invisibly/atomic-appear invariants must hold under higher counts).
4. **New guard, not no guard.** Replace the int16 `checkTextIplSlotBudget` throw (for the asi target) with a **perf/streaming budget guard**: fail (or warn) the build if a cell/area exceeds the measured streamable object count. Silent over-scatter that hitches in-game is as bad as the old crash — guard it loudly (same spirit as `checkImgIdBudgets`).
5. **Fallback honesty** (from 006): an opensa-asi-target build with raised density REQUIRES the asi; without it, the same int16 corruption returns. The installer's asi-presence check covers this content; loud warning.

## Tasks

- [ ] Target-gate the procobj caps (`AREA_MAX_PAIRS`, `STREAM_MAX_INST`, `procObjMax`, density ceiling): stock = today, opensa-asi = raised; wire to the same target flag 03-asi/006 introduced.
- [ ] Perf/streaming budget calibration: measure (02-rendering HUD + streaming settle-watcher) how many procobj a dense area can stream without hitching; set the opensa-asi caps from the measurement. Record the numbers.
- [ ] New budget guard for the asi target (per-area/per-cell streamable-object ceiling) replacing the int16 row guard; tests both modes (mirrors `checkImgIdBudgets`/`checkTextIplSlotBudget` test style).
- [ ] End-to-end: build a high-density full map (B1/B2 profiles, opensa-asi target), install with the Task-3 asi, in-game (Wine) → denser forests/desert/mountains, no ghost-barrier/int16 corruption, streaming stays smooth. Record counts + fps + hitch stats.
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
