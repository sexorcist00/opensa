# 013 — Density budgets and integration, PER TARGET

> **UNBUILT.** Moved here 2026-08-09 from the roadmap chain `07-lod-generators-extended/04`, which was dissolved into the tools it touches — see
> [roadmap 0.5.0](../../../../docs/roadmap/0.5.0/readme.md) for what the chain was and what shipped out of it.


> The file is still named for the slot economy because its links are; the plan is not. Slots stopped being a
> currency on 2026-08-08 — see the banner below.

**Rewritten PER TARGET 2026-08-08 (the user's call), and narrowed to TWO targets the same day.** The premise
banner this file carried — three corrections stacked on an original that was wrong — is spent: what it was
groping toward is that there is no single answer, because there is no single target. Its history, kept short
because [density-target.md](../density-target.md) and [the closed route review](008-limit-route-review-closed.md) carry it in full:
written as an int16 story; corrected to a slot story when the layer measured 38/40 slots; corrected again
when the target install turned out to set both `EntitiesPerIpl` and `EntityIpl` to `unlimited`; and corrected
a third time when the layer's own baseline fell from 24 552 to **15 286** objects, which put int16 back on the
path for the 3.77× target.

**And then the target itself was declared, which settles it: stock SA is not one.** The configuration we ship
to is OLA + FLA plus our own `perfect-map.asi`
([`gta-sa-original/reference-install.md`](../../../../docs/gta-sa-original/reference-install.md)). So the slot
array and the per-file buffer — the two ceilings this plan is named after — are `unlimited` where it matters,
and **this stops being a slot-economy plan**. What is left is one correctness gate and two perf budgets.

Depends on [02](010-density-model.md)/[03](011-biome-zone-density.md) (the
density model) and on [the closed route review](008-limit-route-review-closed.md)'s route decision. Delivers the actual "MORE objects":
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
   [project-goals directive 3](../../../../docs/project-goals.md) applies hardest: a 2004 limit is not our
   limit, and matching one is the choice that needs an argument.

## The guard split — SHIPPED, and it left this plan

**Done 2026-08-08 and moved to the tool:**
[`perfect-map-builder/003`](../../../perfect-map-builder/docs/plans/003-target-split-and-budget-guards.md)
carries the finding (`checkTextIplSlotBudget` ran on the COMMON build, so an opensa-only build threw at a
30 000-row int16 cap and warned at 39 SA slots — two 2004 numbers no OpenSA code path reads), the target
selector, and `checkTextIplBudgets` on the built `sa/` tree with int16 throwing and the slots reporting.

**What stays this plan's:** the two perf budgets, the `opensa` streaming guard the announcement stands in
for, and the stock report. None of it is a builder change until a measurement exists.

**And the guard now FIRES.** The 2026-08-09 column fix put the layer at 25 560 permanent rows — ≈ 38 189
map-wide with stock's 12 629, against int16's 32 767 — at *vanilla* density, with no profile involved. A full
build including `sa/` throws today. That is decision 3 of [02](010-density-model.md) arriving by accident
instead of by design, and turning it into a declared profile gate is this plan's.

## The scope call that reshaped this plan (2026-08-09)

**`sa` ships the SAME density as `opensa`** (the user's call), and the exe is fixed — the reference build,
the only one our asi accepts, is the one we ship to. Three consequences, and they are the plan now:

1. **Density stops being a per-target lever.** [010](010-density-model.md) ships ONE profile. This plan keeps
   per-target CAPS and REPORTING; it no longer sets per-target content.
2. **int16 is crossed by construction, on every `sa` build.** Measured on the built tree with
   `ipl-row-census.ts`: **39 219 permanent text rows / 32 767**, and **76 IPL slots** (not a wall —
   `EntityIpl = unlimited`). So the throw can never be right: it fails every build to guard a case that
   cannot arise on the target. **SHIPPED 2026-08-09** — see the first task below. It went further than
   decision 5b's warning: the target always carries the asi, so the build reports its COST and quotes no
   ceiling at all. That also demoted
   [asi/perfect-map 006](../../../../asi/perfect-map/docs/plans/006-pipeline-integration.md) back off the
   critical path — shipping the asi from pmb is the honest finish, not a prerequisite.
   **Caveat carried forward:** 39 219 is a LOWER BOUND until a census with no missing files confirms it (the
   old counter read an absent IPL as zero rows). The `CBuilding`-pool task below is the one that depends on it.
3. **The `sa` perf budget stops being a lever and becomes a VERIFICATION.** It can no longer answer "how
   dense may `sa` be" — that is settled. It answers "does the real game cope with the density we ship", and
   **if the answer is no, this plan has no lever left to pull.** That question is open and belongs to whoever
   takes the measurement.

### The ceiling this surfaces — DEFERRED, on his call

**`CPool<CBuilding>`, `Buildings = 100000` on the reference install — OLA's, not ours.** SA instantiates a
building per `inst` row, so 39 219 of that pool is spent before anything streams, and the binary streams hold
157 091 more records of which whatever is resident adds on top.

**Not a design constraint (2026-08-09, the user's call): measure it when the work is done, and solve it if it
bites.** The reasoning is the project's own — we ship OLA + FLA, and where a plugin stops we write the patch
ourselves, so an SA pool is a number to raise rather than a wall to design down to
([project-goals directive 3](../../../../docs/project-goals.md): a 2004 limit is not our limit, and matching
one is the choice that needs an argument). It stays a task, at the bottom, and nothing waits on it.

### And what it costs `linkedHeight`

`linkedHeight`'s remaining purpose was **staying under int16 on `sa/`** — decision 3 called it "the cheapest
way to stay under the one ceiling left". With int16 no longer a constraint to design against, it is back to
being plain memory and draw economy, which is worth having and worth nobody's schedule. **Both of its tasks
drop to the bottom of this plan.**

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
   spirit as `checkImgIdBudgets`. **Still OPEN after the guard move (2026-08-08):** the branch ANNOUNCES that
   it carries no ceiling (`OPENSA_BUDGET_NOTICE`) because the number does not exist yet. It is gated on the
   `opensa` perf budget in the tasks below — that measurement is the whole of what is missing.
5b. **The int16 THROW goes away too — the guard becomes a WARNING that names the ini knob** (the user's
   call, 2026-08-08). Decision 2 kept the row check as a throw "because it is the one ceiling that is still
   real". On the declared target it is not: our asi lifts int16 (patch #1, field-proven at 2.14× on a
   third-party map), OLA lifts the per-file buffer, the slot array and the building pool. Keeping a 30 000-row
   throw there is decision 8's mistake one level up — rationing the install we ship to — and it blocks this
   plan's own 38 096-row target by design. **The shape it takes instead:**
   - **pmb SHIPS the generated `perfect-map.asi` into the `sa/` target** (asi/perfect-map 006 task 1). That is
     what makes "this build needs the asi" true by construction instead of true by the operator remembering.
   - **Every ceiling becomes a console WARNING that says what to change**, naming the actual ini knob —
     OLA `EntitiesPerIpl` / `EntityIpl` / `Buildings`, FLA's `FILE_TYPE_*` pools — and, for int16, naming the
     asi this build already carries. A number the operator can act on, not a build that refuses to exist.
   - **Order: the perf budgets first, this second** (the user's call). Until the asi is shipped by the build,
     the throw stays as the stand-in for a dependency nothing checks — dropping it before then would turn a
     loud build error into silent heap corruption on any install without the plugin, or on another exe (the
     asi accepts exactly one).
   The one unretired assumption to carry into that work: patch #1 covers `firstBuilding/lastBuilding` and
   leaves `firstDummy/lastDummy` int16 ("no over-int16 dummies" — diagnosed live, not proven).
6. **Fallback honesty, and it now covers TWO plugins.** An `sa` build past 32 767 map-wide rows REQUIRES
   `perfect-map.asi`; without it the int16 corruption returns on our own data exactly as it did on
   ProperFixes'. Past the stock slot and per-file ceilings it also requires **OLA**, which our installer has
   never checked for — dropping stock as a target makes an adjuster a dependency rather than a bonus.
   Both go in the installer's presence check, loudly. (Field-proven both directions in
   [`open-issues/fixed/ghost-barriers.md`](../../../../docs/open-issues/fixed/ghost-barriers.md).)
7. **A raised cap is not a raised density.** Every cap this plan moves is a ceiling; what fills it is
   [02](010-density-model.md)'s profile, measured, with [01](012-species-representation-floor.md)'s
   species-floor check re-run at the new density. Raising a cap and reporting the headroom is not a result.
8. **Stock is a REPORT, not a mode.** Not a target is not the same as not a failure mode: someone will drop
   this build on a plain 1.0. The build prints what the artifact needs (OLA, and `perfect-map.asi` past
   int16) and what it would breach on stock — cheap, honest, and it never rations the install we do ship to.
   A guard that fails a supported build to protect an unsupported one is the wrong trade.

## Tasks

**First — the three tasks that needed no ASI, no rebuild and no density decision. All three landed
2026-08-07/08 and their record is [`perfect-map-builder/003`](../../../perfect-map-builder/docs/plans/003-target-split-and-budget-guards.md):**
`AREA_ROW_CAP = 4000` was answered from the target install's own ini (it guards a `gpLoadedBuildings` buffer
OLA sets to `unlimited`, so the cap is inert where we ship); the **target selector** shipped as
`@opensa/tool-kit/target` + pmb `--target`, derived from `--exclude`; and the **guard move** shipped as
`checkTextIplBudgets` on the built `sa/` tree. Two deliberate deviations are recorded there —
`--allow-text-row-overflow` survives for the `sa-int16-repro` consumer, and `opensa/` got an announcement
rather than a guard, because its number does not exist yet.

**What is left here:**

- [ ] **Keep the permanent-row cost per object as a first-class knob.** 0.424 rows/object today
      (6 487 / 15 286), and it is the whole reason our layout beats a text-IPL mod's by 2.36×. Every density
      profile changes it — a profile that favours TALL species buys rows nobody costed.
      **Half done 2026-08-08**: the number is now READ OFF the run (`buildStreamedIpl` returns `rows`; the
      generator prints objects · rows · rows/object per target) instead of taking a script to recover. It is a
      reported number, not yet a knob — `linkedHeight` is still what moves it, and moving it is the task below.
- [ ] **What area size does STREAMING want?** `AREA_MAX_PAIRS = 2000` was picked to fit a 4 096-row buffer
      that no longer binds, so the number is unowned rather than tuned. Measure it against settle time and
      hitching (decision 4's opensa budget) and set it from that. This replaces the two slot-recovery tasks
      struck above: same knob, a unit that still exists.
- [ ] Report the slot, row and object cost of a build as a first-class output (like `checkImgIdBudgets`), per
      target, so a density profile's price is visible when it is CHOSEN rather than when the build fails.
      Today the number takes a script to recover, which is why this plan's premise went a fortnight without
      being checked. **The procobj LAYER's share landed with the target selector** (objects · permanent rows ·
      rows/object, per target); what is still missing is the MAP-wide roll-up — the layer does not know what
      the rest of the build spends, and int16 is a map-wide ceiling.
- [ ] Raise `linkedHeight` deliberately and measure it: every species pushed below it trades a permanent
      text row for a binary-stream row. On `sa/` that is still the cheapest way to stay under int16 — the one
      ceiling left — so it survives the stock cull with its purpose changed from slots to ROWS. Record what
      it costs at range (a shorter species with no permanent LOD pops in later).

**FIRST, and it is the only thing blocking a full build: drop the int16 throw. — DONE 2026-08-09.**

- [x] **The int16 guard is gone, and it did not become a warning.** Decision 5b said "a WARNING that names
      what to change"; the user's call while it was being written took it further, and the plan is corrected
      here rather than in a footnote: **the `sa` target ALWAYS carries OLA + FLA + our `perfect-map.asi`, so
      a lifted ceiling is not something a build reports on every run.** A warning firing on every build is a
      throw one severity down — the condition is constant (39 219 rows at vanilla density), and a constant
      condition is a print statement wearing a guard's clothes.
      **What shipped** (`tools/perfect-map-builder/src/pipeline.ts`):
      - `checkTextIplBudgets` → **`reportTextIplCensus`**: permanent rows, inst-bearing IPLs, and how many of
        the IPLs listed in `gta.dat` it could actually read. No ceiling quoted.
      - **deleted**: the throw, `TEXT_ROW_CAP = 30000`, `TEXT_IPL_SLOT_CAP = 39`, `--allow-text-row-overflow`
        and its `BuildPerfectMapOptions` field. The 30 000 was 2 767 of unmeasured headroom under a lifted
        ceiling and **nothing ever culled to fit it**, so removing it moved no content.
      - **the census now names its scope.** Both halves used to read a missing file as zero rows — an IPL
        listed in `gta.dat` but absent on disk silently subtracted its rows, and an absent `gta.dat` skipped
        the whole check without a line. The error only ever ran DOWNWARD, so 39 219 was a lower bound sold as
        a total. Missing files now WARN and the count is labelled as a lower bound.
      - `checkImgIdBudgets` **keeps its throw** — FLA's pools are what the target is really configured with
        (TXD 6000 / COL 275 / IPL 280, not `unlimited`), and exhausting one corrupts the heap at boot. The
        rule is "delete the museum pieces, keep the gates", now a standing rule in `CLAUDE.md`.
      - tests: 35 pass, and the two that matter were **run against the reverted behaviour** — re-adding the
        throw and the silent zero fails exactly those two and nothing else.
      *Not verified yet:* no full `sa` build has been run since. The throw is what blocked one; whether the
      rest of the `sa` chain completes at 91 092 objects is unmeasured and belongs to the next `sa` run.

**Then the numbers, one host at a time:**

- [ ] **`opensa` perf budget.** Measure how much clutter the engine streams without hitching (perf HUD +
      streaming settle-watcher) and set `procObjMax`, the candidate ceiling and the per-cell `procObjLimit`
      from THAT. Record the rows in `docs/benchmarks/` before analysing them. This is the first real ceiling
      the target has ever been given.
- [ ] **`sa` perf budget — now a VERIFICATION, not a lever** (see the scope call above). On the real install
      under Wine, above the asi gate. Separate rows, separate conclusion, explicitly not comparable to the
      opensa numbers. **If SA does not cope at the shipped density, this plan has no lever left** — say so
      rather than quietly lowering it.
- [ ] **DEFERRED — price the `CBuilding` pool at the shipped density**, when the work above is done and only
      if it bites. `Buildings = 100000` (OLA); 39 219 spent by permanent rows before any streaming. Raising
      it is OLA's ini or, past that, our own patch — a number, not a wall.
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
- No target can be built with another's profile ([02](010-density-model.md) decision 3) — checked at config
  time, in a test per pair.
- Denser biomes visible in-game; streaming smooth (no hitch regression); species floor unchanged or handed to
  [01](012-species-representation-floor.md).

## Measurements / notes

**2026-08-08 — the first budget attempt, and what it actually found.** Two builds from the canonical
build's kept `.work/5-trees` stage, density 1 vs 3 (cap raised so it could not bind), benched by the user
in-game over 9 scenes ([`benchmarks/…/2026-08-08-ingame-07-04-density-ab.json`](../../../../docs/benchmarks/opensa-engine/2026-08-08-ingame-07-04-density-ab.json)):

- **The density cutoff is not the density lever.** 3× the cutoff yields **15 840 objects vs 15 286 — +3.6 %**
  (rows 6 728 vs 6 487, pak +0.30 %, 1139 cells both). `procObjMax` never bound, so MINDIST culled the extra
  candidates: the authored spacing is already saturated at vanilla density. **This falsifies
  [02](010-density-model.md)'s premise** that "raising density is mostly raise the cutoff" — the only lever
  left that moves the count is the authored `procobj.dat` MINDIST, which is a data-honesty decision, not a
  knob, and it is now the gate on this whole plan's density.
- **What the A/B can honestly say**: +3.6 % clutter costs nothing measurable — six scenes identical to ±0.0 %
  triangles with `gpuMs.pass` within ±0.03 ms, and `country-dusk` (the clutter scene) +0.3 % triangles for
  +0.013 ms. It says NOTHING about a streaming budget, because the arms are 3.6 % apart.
- **The harness drifts more than the content does**, and that is a new blocker: three scenes disagreed by
  amounts no 3.6 % change can produce (control scene `ocean-horizon` +107 % triangles). Filed as
  [`open-issues/bench-scene-transition-collision.md`](../../../../docs/open-issues/bench-scene-transition-collision.md)
  — collision is missing across a scene teleport. **The perf budgets below cannot be taken until it is
  fixed**: a sweep whose control scene moves by 107 % cannot resolve a cap.

_(the rows below are still to be recorded)_

- `opensa` streamable-object budget per cell/area, and the caps set from it: …
- `sa` frame/stream numbers under Wine, above the asi gate: …
- area size chosen from the streaming measurement (2 000 pairs was a ceiling artefact): …
- rows/object per shipped profile (today: 0.424): …
- dense full-map counts + fps + hitch stats vs vanilla, per host: …
