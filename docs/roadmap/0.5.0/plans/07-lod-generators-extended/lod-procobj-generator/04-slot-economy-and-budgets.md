# 04 — Slot economy, budgets and integration

> **PREMISE WRONG — do not start this plan before [00](00-limit-route-review.md) closes.**
> Everything below is written as "gated on our own ASI (Task 3)", i.e. as an int16 story. It is not one.
> Measured 2026-08-07 on `build/original/opensa`: **20 146/32 767 text rows but 38/40 IPL slots**, and the
> [density target](../density-target.md) costs ~16 312 rows (fits, 29 504 against a 30 000 guard) and ≥ 19
> areas (**does not fit — 48 slots against a ceiling of 40**). The constraint that binds is the slot array
> plus the per-area `LoadScene` budget, **neither of which our ASI lifts** (fixes #2/#3 are unbuilt) and
> both of which FLA/OLA do. So this plan's target-gating, its guard and its "requires the asi" fallback all
> change shape, and area folding — the cheap escape — is already closed as a route (00, decision 3).
>
> Rewrite this plan against 00's decision. What survives unchanged is decision 2 (the binary-stream economy
> stays) and decision 3 (perf becomes the budget); those are the parts that were never about int16.

Part of [07 — LOD generators, extended](../readme.md). Depends on [02](02-density-model.md)/[03](03-biome-zone-density.md) (the density model), on [00](00-limit-route-review.md)'s route decision, and — if that decision keeps our own ASI on the path — on [03-asi/006](../../../../../../asi/perfect-map/docs/plans/006-pipeline-integration.md) (the stock-vs-opensa-asi target modes). Delivers the actual "MORE objects": raising the caps so 02/03's density can ship, and re-establishing perf as the limiter.

## Context

Raised density (02/03) is capped today by budgets that were sized for the int16 bug (from the grounding):

- `AREA_MAX_PAIRS = 2000` (4000 rows/area) + `STREAM_MAX_INST = 512` (`streamed-areas.ts`);
- `procObjMax = 20000` (`config.ts` / `convert.ts`);
- `TEXT_ROW_CAP = 30000` global (`pipeline.ts` `checkTextIplSlotBudget`);
- `PROC_OBJ_MAX_DENSITY = 3` candidate ceiling (`procobj-scatter.ts`).

Only one of those four is an int16 cap. `TEXT_ROW_CAP` is, and it is **not** the one in the way — the target fits under it. `AREA_MAX_PAIRS` mirrors SA's per-area `LoadScene` budget, which is a real 2004 ceiling that stands whatever happens to int16, and it is what forces the area count that exhausts the slot array. `procObjMax` and `PROC_OBJ_MAX_DENSITY` are our own safety numbers and cost nothing to raise once something downstream can absorb the objects. **The plan's job is therefore the SLOT economy first and the row ceiling second** — get more objects per area and per slot, then raise what remains, then let perf (draw calls, streaming, frame budget) become the limiter it should have been all along.

## Decisions

1. **Target-gated caps** (mirror 03-asi/006). For the opensa-asi target: `AREA_MAX_PAIRS`, `STREAM_MAX_INST`, `procObjMax`, and `PROC_OBJ_MAX_DENSITY` rise to new values (or become perf-bounded); for the stock target they stay exactly as today (int16-safe). One target flag drives limits, particle policy (the 2dfx chain), AND procobj caps — consistent across the pipeline.
2. **The `linkedHeight`/binary-stream economy STAYS.** It's still good memory/draw economy independent of the ceiling (shorter species ride binary streams costing zero text rows). We raise the ceiling, not abandon the streaming layout — density fills the newly-available headroom through the same efficient placement.
3. **Perf becomes the budget.** Past int16, the limiter is FPS/streaming. Tie the density caps to a measured budget: use the rendering perf HUD (plan 063) + streaming smoothness (plan 060 machinery) to find how much clutter the engine streams without hitching, and set the opensa-asi caps from THAT, not a guess. Denser areas must still stream in smoothly (the warm-invisibly/atomic-appear invariants must hold under higher counts).
4. **New guard, not no guard.** Replace the int16 `checkTextIplSlotBudget` throw (for the asi target) with a **perf/streaming budget guard**: fail (or warn) the build if a cell/area exceeds the measured streamable object count. Silent over-scatter that hitches in-game is as bad as the old crash — guard it loudly (same spirit as `checkImgIdBudgets`).
5. **Fallback honesty** (from 006): an opensa-asi-target build with raised density REQUIRES the asi; without it, the same int16 corruption returns. The installer's asi-presence check covers this content; loud warning.

## Tasks

**Slot economy first — these are the ones the target actually needs, and none of them needs an ASI:**

- [ ] **Find out what `AREA_ROW_CAP = 4000` really models, because a shipping mod beats it by 2.4×.**
      ProperFixes' `procobj1..6.ipl` carry ~9 597 rows each and ran clean in the field on 2026-08-07 (see
      [00](00-limit-route-review.md)). Either SA's `LoadScene` budget is not per-IPL-file, or our cap is far
      more conservative than the ceiling it stands for, or their pure-text layout escapes something our
      mixed text+binary areas do not. **This is the highest-value measurement in the chain**: if a
      9 597-row area is safe, the density target costs about six slots instead of nineteen areas and the
      binding ceiling disappears. Measure it against the real game — do not settle it by reading our own
      constant.
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
