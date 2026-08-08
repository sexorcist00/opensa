# 04 — Slot economy, budgets and integration, PER TARGET

**Rewritten PER TARGET 2026-08-08 (the user's call).** The premise banner this file carried — three
corrections stacked on an original that was wrong — is now spent: what it was groping toward is that there is
no single answer, because there is no single target. Its history, kept short because
[density-target.md](../density-target.md) and [00](00-limit-route-review.md) carry it in full: written as an
int16 story; corrected to a slot story when the layer measured 38/40 slots; corrected again when the target
install turned out to set both `EntitiesPerIpl` and `EntityIpl` to `unlimited`; and corrected a third time
when the layer's own baseline fell from 24 552 to **15 286** objects, which put int16 back on the path for
the 3.77× target. Every one of those corrections was true of *a* target.

Part of [07 — LOD generators, extended](../readme.md). Depends on [02](02-density-model.md)/[03](03-biome-zone-density.md) (the
density model) and on [00](00-limit-route-review.md)'s route decision. Delivers the actual "MORE objects":
the caps 02/03's density ships against, per target, and perf as the limiter where a ceiling no longer is.

## The three targets, and what limits each

| Target | Correctness ceiling | Then what limits it | Density it reaches | Needs our asi? |
| --- | --- | --- | --- | --- |
| **`sa/` stock** | IPL slots (39 guard; 38 used ⇒ 9 procobj areas), the ~4 000-row per-file `LoadScene` budget, int16 | never gets there — slots bind at **1.18×** | ~18 000 objects | no |
| **`sa/` reference** | **int16 only** — OLA lifts the slot array and the per-file buffer, and demonstrably does NOT lift int16 | memory + frame time in SA | **2.95×** bare, **3.77×** with the asi | **yes, above 2.95×** |
| **`opensa/`** | none of SA's — no slot array, no per-file budget, no int16 | memory + frame time in OUR engine, and the per-cell `procObjLimit` | unmeasured | no |

Two things fall out of the table and they are the plan:

1. **Stock is not a density target.** 1.18 × is the whole of it. Say that plainly and stop shipping a
   multiplier it cannot take — [02](02-density-model.md)'s stock profile is a redistribution, not growth.
2. **`opensa/` has no ceiling and is currently capped by SA's.** See the guard finding below. This is the
   target where [project-goals directive 3](../../../../../project-goals.md) applies hardest: a 2004 limit is
   not our limit, and matching one is the choice that needs an argument.

## The guard finding — `opensa/` inherits ceilings it does not have

`checkTextIplSlotBudget(game, …)` runs on the **common baked build**, at `perfect-map-builder/src/pipeline.ts:206`,
*before* the split that feeds `sa/` and `opensa/`. So an opensa-only build:

- **throws** past `TEXT_ROW_CAP = 30 000` permanent text-IPL rows — a cap that exists because SA stores
  building-pool indexes as int16 in `IplDef`, which no OpenSA code path reads;
- **warns** at `TEXT_IPL_SLOT_CAP = 39` — SA's `IplEntityIndexArrays`, which our engine does not have.

The escape is a manual `--allow-text-row-overflow` flag, i.e. an operator decision taken build by build,
which is precisely how a ceiling stays enforced by accident. Nothing fails loudly here: the build succeeds
and quietly carries less than it could, which is [lesson 28](../../../../../project-goals.md)'s signature —
a too-conservative build looks exactly like a successful one.

**This plan's first task is therefore not raising a cap; it is putting each cap on the branch that owns it.**

## Decisions

1. **Caps are target-gated, and the gate is a build INPUT, not a flag an operator remembers.** One target
   selector drives limits, particle policy (the 2dfx chain's `--strip-particles` opt-out) AND procobj caps —
   consistent across the pipeline. `sa-stock` keeps today's numbers exactly; `sa-reference` is perf-bounded
   *above* an int16 gate; `opensa` is perf-bounded with no SA ceiling in it at all.
2. **Guards move to the branch they describe.** `checkTextIplSlotBudget` becomes an `sa/`-branch check. The
   `opensa/` branch gets its OWN budget guard (decision 5) rather than none — the answer to a ceiling that
   does not apply is a different ceiling, not the absence of one.
3. **The `linkedHeight`/binary-stream economy STAYS on every target.** It is memory and draw economy
   independent of any ceiling (shorter species ride binary streams costing zero permanent rows). It is worth
   **0.424 rows/object against a text-IPL mod's 1.000** — a 2.36× edge that
   [density-target.md](../density-target.md) warns is thinner than the chain once believed, and that these
   plans may not trade away to buy density.
4. **Perf becomes the budget — and a budget NAMES ITS HOST.** The same density lands in two engines with
   different limiters, so there are two measurements and neither substitutes for the other:
   - `opensa`: the 074-era perf HUD + streaming settle machinery, on the canonical build. This is the
     measurement we can take today, with instruments we own.
   - `sa-reference`: SA's own frame time and streaming on the real install, under Wine. Slower to take,
     smaller sample, and it is the number that decides whether 3.77× is shippable there at all.
   A cap set from the wrong host's number is a guess wearing a measurement's clothes.
5. **New guard, not no guard.** For `opensa`, replace the int16 row throw with a **streamable-object budget
   guard**: fail (or warn) when a cell or area exceeds the measured count the engine streams without
   hitching. Silent over-scatter that hitches in-game is as bad as the old crash — guard it loudly, same
   spirit as `checkImgIdBudgets`.
6. **Fallback honesty.** An `sa-reference` build above 2.95× REQUIRES `perfect-map.asi`; without it the int16
   corruption returns on our own data exactly as it did on ProperFixes'. The installer's asi-presence check
   covers this content; loud warning. (Field-proven both directions in
   [`open-issues/fixed/ghost-barriers.md`](../../../../../open-issues/fixed/ghost-barriers.md).)
7. **A raised cap is not a raised density.** Every cap this plan moves is a ceiling; what fills it is
   [02](02-density-model.md)'s profile, measured, with [01](01-species-representation-floor.md)'s
   species-floor check re-run at the new density. Raising a cap and reporting the headroom is not a result.

## Tasks

**First — put the caps where they belong. None of this needs an ASI, a rebuild, or a density decision:**

- [x] ~~Find out what `AREA_ROW_CAP = 4000` really models~~ — **ANSWERED 2026-08-07 from the target
      install's own configuration, no field run needed.** ProperFixes' 9 627-row IPL files load because OLA
      sets **`EntitiesPerIpl = unlimited`**, which grows exactly the `gpLoadedBuildings` per-file buffer our
      cap guards (0xBCC0E0 @ 0x5B892A — our own OLA source study in `asi/perfect-map` 004). The cap is not
      wrong; it is a **stock-target** cap, and it is **inert on the install we ship to**. The same install
      sets `EntityIpl = unlimited`, so the 40-slot ceiling is gone too, and `Buildings = 100000`. Full
      capture: [`gta-sa-original/reference-install-config.md`](../../../../../gta-sa-original/reference-install-config.md).
- [ ] **Introduce the target selector** and thread it through pmb → lod-procobj-generator → `convert.ts`.
      Three values (`sa-stock`, `sa-reference`, `opensa`), defaulting to today's behaviour so the first
      commit moves nothing.
- [ ] **Move `checkTextIplSlotBudget` onto the `sa/` branch** (from `pipeline.ts:206`) and split its two
      ceilings by target: rows/int16 and the 39-slot array are `sa-stock`; `sa-reference` keeps the int16 row
      check and drops the slot one (OLA lifts it); `opensa` gets neither. Test all three, and assert the
      opensa branch still guards SOMETHING (decision 5) rather than silently everything.
      **`--allow-text-row-overflow` should disappear with it** — an operator flag is what a missing target
      split looks like.
- [ ] **Keep the permanent-row cost per object as a first-class knob.** 0.424 rows/object today
      (6 487 / 15 286), and it is the whole reason our layout beats a text-IPL mod's by 2.36×. Every density
      profile changes it — a profile that favours TALL species buys rows nobody costed.
- [ ] Pack the generated areas tight. They average 3 501 of a 4 000-row budget today; a repack to the budget
      is ~2 slots back at current density and more at raised density. **`sa-stock` is the only target this
      buys anything on** — it is where slots are the wall — which is itself the argument for doing it there
      and not paying its complexity elsewhere. Measure the recovered slots and check no area breaches the
      budget after it; this is 00's hygiene task, executed. **Do not expect much**: the areas are already at
      ~88 % of budget (6 487 permanent rows + ~24 000 stream rows across 8 areas, both counted against the
      same buffer), which is why this is worth ~2 slots and not 6.
- [ ] **Cost the ~30 slots the BASE MAP spends — the only lever that would make `sa-stock` a density
      target.** Our 8 procobj areas plus 1 impostor area are already 9 of the ~9 free slots; everything else
      is stock's own map, which mod-installer only partly compacts (`int_cont` + `gen_int1` → 28). Nothing
      has ever costed merging more of it. Until someone does, 1.18× is the honest stock ceiling and
      [02](02-density-model.md)'s stock profile stays a redistribution. See
      [density-target.md](../density-target.md) for why no layout available to us moves the wall: fewer,
      larger files breach the 4 096-row per-area buffer, more files breach the 39-slot array, and even a
      LOD-less layout like ProperFixes' needs 15 legal slots for the target.
- [ ] Report the slot, row and object cost of a build as a first-class output (like `checkImgIdBudgets`), per
      target, so a density profile's price is visible when it is CHOSEN rather than when the build fails.
      Today the number takes a script to recover, which is why this plan's premise went a fortnight without
      being checked.
- [ ] Raise `linkedHeight` deliberately as a slot lever on `sa-stock`, and measure it: every species pushed
      below it trades a permanent text row for a binary-stream row, the cheapest density available without
      lifting anything. Record what it costs at range (a shorter species with no permanent LOD pops in later).

**Then the numbers, one host at a time:**

- [ ] **`opensa` perf budget.** Measure how much clutter the engine streams without hitching (perf HUD +
      streaming settle-watcher) and set `procObjMax`, the candidate ceiling and the per-cell `procObjLimit`
      from THAT. Record the rows in `docs/benchmarks/` before analysing them. This is the first real ceiling
      the target has ever been given.
- [ ] **`sa-reference` perf budget**, on the real install under Wine, above the asi gate. Separate rows,
      separate conclusion; explicitly not comparable to the opensa numbers.
- [ ] `sa-stock`: caps unchanged, and a regression test that a build past them still fails as today.
- [ ] Target-gate the remaining procobj caps (`AREA_MAX_PAIRS`, `STREAM_MAX_INST`, `procObjMax`, candidate
      ceiling) once the two budgets above exist.
- [ ] End-to-end on `sa-reference`: build a high-density map (02/03 profiles), install with
      `perfect-map.asi`, in-game (Wine) → denser forests/desert/mountains, no ghost barriers, no int16
      corruption, streaming smooth. Record counts + fps + hitch stats.
- [ ] Docs/memory: update the procobj plans (007 binary streams), the ghost-barriers cross-ref (the density
      this unlocks), and `docs/restrictions/` if the target split earns a new rule — it probably does, since
      "a guard must live on the branch whose target it describes" is exactly the kind of thing that is
      SILENT when violated.

## Verification

- **Per target, and never averaged.** `sa-stock`: caps unchanged, build still fails past them, 1.18×
  documented as its ceiling. `sa-reference`: a build above 2.95× ships and runs WITH the asi, and the
  installer warns without it. `opensa`: the SA guards no longer run, a streamable-object guard does, and the
  cap it enforces came from a measurement in that engine.
- No target can be built with another's profile ([02](02-density-model.md) decision 3) — checked at config
  time, in a test per pair.
- Denser biomes visible in-game; streaming smooth (no hitch regression); species floor unchanged or handed to
  [01](01-species-representation-floor.md).

## Measurements / notes

_(record after implementation)_

- `opensa` streamable-object budget per cell/area, and the caps set from it: …
- `sa-reference` frame/stream numbers under Wine, above the asi gate: …
- slots recovered by the area repack on `sa-stock`: …
- rows/object per shipped profile (today: 0.424): …
- dense full-map counts + fps + hitch stats vs vanilla, per host: …
