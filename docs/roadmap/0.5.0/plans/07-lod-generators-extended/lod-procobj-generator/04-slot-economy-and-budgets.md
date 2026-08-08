# 04 — Budgets and integration, PER TARGET

> The file is still named for the slot economy because its links are; the plan is not. Slots stopped being a
> currency on 2026-08-08 — see the banner below.

**Rewritten PER TARGET 2026-08-08 (the user's call), and narrowed to TWO targets the same day.** The premise
banner this file carried — three corrections stacked on an original that was wrong — is spent: what it was
groping toward is that there is no single answer, because there is no single target. Its history, kept short
because [density-target.md](../density-target.md) and [00](00-limit-route-review.md) carry it in full:
written as an int16 story; corrected to a slot story when the layer measured 38/40 slots; corrected again
when the target install turned out to set both `EntitiesPerIpl` and `EntityIpl` to `unlimited`; and corrected
a third time when the layer's own baseline fell from 24 552 to **15 286** objects, which put int16 back on the
path for the 3.77× target.

**And then the target itself was declared, which settles it: stock SA is not one.** The configuration we ship
to is OLA + FLA plus our own `perfect-map.asi`
([`gta-sa-original/reference-install.md`](../../../../../gta-sa-original/reference-install.md)). So the slot
array and the per-file buffer — the two ceilings this plan is named after — are `unlimited` where it matters,
and **this stops being a slot-economy plan**. What is left is one correctness gate and two perf budgets.

Part of [07 — LOD generators, extended](../readme.md). Depends on [02](02-density-model.md)/[03](03-biome-zone-density.md) (the
density model) and on [00](00-limit-route-review.md)'s route decision. Delivers the actual "MORE objects":
the caps 02/03's density ships against, per target, and perf as the limiter now that no ceiling is.

## The two targets, and what limits each

| Target | Correctness ceiling | Then what limits it | Density it reaches | Needs our asi? |
| --- | --- | --- | --- | --- |
| **`sa/`** | **int16 only** — OLA lifts the slot array, the per-file buffer and the building pool, and demonstrably does NOT lift int16 (`0x404B4A` byte-stock on the reference install) | memory + frame time in SA | the full **3.77×** target | **yes, above 32 767 map-wide rows** — the target is 38 096 |
| **`opensa/`** | none of SA's — no slot array, no per-file buffer, no int16 | memory + frame time in OUR engine, and the per-cell `procObjLimit` | unmeasured | no |

Three things fall out and they are the plan:

1. **The slot economy is dead as a density lever.** `EntityIpl = unlimited` and `EntitiesPerIpl = unlimited`
   on the target, so packing areas, folding files and recovering slots buy nothing they were meant to buy.
   What survives of the area split is STREAMING GRANULARITY — a reason to keep areas bounded, not a ceiling.
2. **int16 is the whole correctness story, and it is OURS.** No adjuster lifts it; `perfect-map.asi` does,
   and is already carrying a 72 914-row map on that install. A density profile past 32 767 map-wide rows
   declares that dependency or it is not shippable.
3. **`opensa/` has no ceiling and is currently capped by SA's.** See the guard finding below. This is where
   [project-goals directive 3](../../../../../project-goals.md) applies hardest: a 2004 limit is not our
   limit, and matching one is the choice that needs an argument.

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
   consistent across the pipeline. `sa` is perf-bounded *above* an int16 gate; `opensa` is perf-bounded with
   no SA ceiling in it at all. **There is no stock mode** — see decision 8 for what replaces it.
2. **Guards move to the branch they describe, and shed the ceilings the target lifted.** On `sa/` the
   39-slot check and the 4 096-row per-area budget become REPORTS, not throws — they describe an install we
   do not target — while the int16 row check stays a throw, because it is the one ceiling that is still real
   and it is the asi's gate. The `opensa/` branch gets its OWN budget guard (decision 5) rather than none:
   the answer to a ceiling that does not apply is a different ceiling, not the absence of one.
3. **The `linkedHeight`/binary-stream economy STAYS on every target.** It is memory and draw economy
   independent of any ceiling (shorter species ride binary streams costing zero permanent rows). It is worth
   **0.424 rows/object against a text-IPL mod's 1.000** — a 2.36× edge that
   [density-target.md](../density-target.md) warns is thinner than the chain once believed, and that these
   plans may not trade away to buy density.
4. **Perf becomes the budget — and a budget NAMES ITS HOST.** With no ceiling left on either target this is
   now the ONLY thing that sets a cap. The same density lands in two engines with different limiters, so
   there are two measurements and neither substitutes for the other:
   - `opensa`: the 074-era perf HUD + streaming settle machinery, on the canonical build. This is the
     measurement we can take today, with instruments we own.
   - `sa`: SA's own frame time and streaming on the real install, under Wine, above the asi gate. Slower to
     take, smaller sample, and it is the number that decides whether 3.77× is shippable there at all.
   A cap set from the wrong host's number is a guess wearing a measurement's clothes.
5. **New guard, not no guard.** For `opensa`, replace the int16 row throw with a **streamable-object budget
   guard**: fail (or warn) when a cell or area exceeds the measured count the engine streams without
   hitching. Silent over-scatter that hitches in-game is as bad as the old crash — guard it loudly, same
   spirit as `checkImgIdBudgets`.
6. **Fallback honesty, and it now covers TWO plugins.** An `sa` build past 32 767 map-wide rows REQUIRES
   `perfect-map.asi`; without it the int16 corruption returns on our own data exactly as it did on
   ProperFixes'. Past the stock slot and per-file ceilings it also requires **OLA**, which our installer has
   never checked for — dropping stock as a target makes an adjuster a dependency rather than a bonus.
   Both go in the installer's presence check, loudly. (Field-proven both directions in
   [`open-issues/fixed/ghost-barriers.md`](../../../../../open-issues/fixed/ghost-barriers.md).)
7. **A raised cap is not a raised density.** Every cap this plan moves is a ceiling; what fills it is
   [02](02-density-model.md)'s profile, measured, with [01](01-species-representation-floor.md)'s
   species-floor check re-run at the new density. Raising a cap and reporting the headroom is not a result.
8. **Stock is a REPORT, not a mode.** Not a target is not the same as not a failure mode: someone will drop
   this build on a plain 1.0. The build prints what the artifact needs (OLA, and `perfect-map.asi` past
   int16) and what it would breach on stock — cheap, honest, and it never rations the install we do ship to.
   A guard that fails a supported build to protect an unsupported one is the wrong trade.

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
      Two values (`sa`, `opensa`), defaulting to today's behaviour so the first commit moves nothing.
- [ ] **Move `checkTextIplSlotBudget` onto the `sa/` branch** (from `pipeline.ts:206`) and split its two
      ceilings: the int16 row check stays a THROW on `sa/` (it is the asi's gate and the only ceiling the
      target still has); the 39-slot check becomes a report, since OLA lifts it; `opensa/` gets neither and
      gains its own budget guard instead (decision 5). Test both branches, and assert the opensa branch still
      guards SOMETHING rather than silently everything.
      **`--allow-text-row-overflow` should disappear with it** — an operator flag is what a missing target
      split looks like.
- [ ] **Keep the permanent-row cost per object as a first-class knob.** 0.424 rows/object today
      (6 487 / 15 286), and it is the whole reason our layout beats a text-IPL mod's by 2.36×. Every density
      profile changes it — a profile that favours TALL species buys rows nobody costed.
- [ ] Pack the generated areas tight. They average 3 501 of a 4 000-row budget today; a repack to the budget
      is ~2 slots back. **Struck 2026-08-08 with the stock target** — it buys SLOTS, and `EntityIpl =
      unlimited` means slots are not a currency on the install we ship to.
- [ ] **What area size does STREAMING want?** `AREA_MAX_PAIRS = 2000` was picked to fit a 4 096-row buffer
      that no longer binds, so the number is unowned rather than tuned. Measure it against settle time and
      hitching (decision 4's opensa budget) and set it from that. This replaces the two slot-recovery tasks
      struck above: same knob, a unit that still exists.
- [ ] Report the slot, row and object cost of a build as a first-class output (like `checkImgIdBudgets`), per
      target, so a density profile's price is visible when it is CHOSEN rather than when the build fails.
      Today the number takes a script to recover, which is why this plan's premise went a fortnight without
      being checked.
- [ ] Raise `linkedHeight` deliberately and measure it: every species pushed below it trades a permanent
      text row for a binary-stream row. On `sa/` that is still the cheapest way to stay under int16 — the one
      ceiling left — so it survives the stock cull with its purpose changed from slots to ROWS. Record what
      it costs at range (a shorter species with no permanent LOD pops in later).

**Then the numbers, one host at a time:**

- [ ] **`opensa` perf budget.** Measure how much clutter the engine streams without hitching (perf HUD +
      streaming settle-watcher) and set `procObjMax`, the candidate ceiling and the per-cell `procObjLimit`
      from THAT. Record the rows in `docs/benchmarks/` before analysing them. This is the first real ceiling
      the target has ever been given.
- [ ] **`sa` perf budget**, on the real install under Wine, above the asi gate. Separate rows, separate
      conclusion; explicitly not comparable to the opensa numbers.
- [ ] **The stock REPORT** (decision 8): print what the artifact requires — OLA, and `perfect-map.asi` past
      32 767 rows — and what it would breach on a plain 1.0. A line in the build output, not a throw.
- [ ] Target-gate the remaining procobj caps (`AREA_MAX_PAIRS`, `STREAM_MAX_INST`, `procObjMax`, candidate
      ceiling) once the two budgets above exist.
- [ ] End-to-end on `sa`: build a high-density map (02/03 profiles), install with
      `perfect-map.asi`, in-game (Wine) → denser forests/desert/mountains, no ghost barriers, no int16
      corruption, streaming smooth. Record counts + fps + hitch stats.
- [ ] Docs/memory: update the procobj plans (007 binary streams), the ghost-barriers cross-ref (the density
      this unlocks), and `docs/restrictions/` if the target split earns a new rule — it probably does, since
      "a guard must live on the branch whose target it describes" is exactly the kind of thing that is
      SILENT when violated.

## Verification

- **Per target, and never averaged.** `sa`: a build past 32 767 map-wide rows ships and runs WITH the asi,
  the installer warns without it (and without OLA), and the slot/per-file checks are reports rather than
  throws. `opensa`: the SA guards no longer run, a streamable-object guard does, and the cap it enforces came
  from a measurement in that engine.
- No target can be built with another's profile ([02](02-density-model.md) decision 3) — checked at config
  time, in a test per pair.
- Denser biomes visible in-game; streaming smooth (no hitch regression); species floor unchanged or handed to
  [01](01-species-representation-floor.md).

## Measurements / notes

_(record after implementation)_

- `opensa` streamable-object budget per cell/area, and the caps set from it: …
- `sa` frame/stream numbers under Wine, above the asi gate: …
- area size chosen from the streaming measurement (2 000 pairs was a ceiling artefact): …
- rows/object per shipped profile (today: 0.424): …
- dense full-map counts + fps + hitch stats vs vanilla, per host: …
