# 00 — Which limit do we lift, and who lifts it?

Part of [07 — LOD generators, extended](../readme.md). **A go/no-go review, not an implementation plan — and
the P0 of the whole density chain.** It runs BEFORE [04](04-slot-economy-and-budgets.md), because 04 assumes
the answer — it is written as "gated on Task 3, our own ASI" — and that assumption has never been argued
against the alternative the user raises: **a real SA install will definitely have FLA and OLA anyway.**

Nothing here should be built until this review closes. Its output is a decision, and 04's premise is what
changes if the decision goes the other way.

**Since 2026-08-07 the review has a TARGET to cost and a real corpus to test against.**
[density-target.md](../density-target.md) fixes the aiming point at **57 583 placed objects** (ProperFixes
2.2.1's vegetation set — a shipping mod, not a number we invented) and prices it: it fits in rows and misses
by ~10 IPL slots. Read it before answering anything below.

## Field run, 2026-08-07 — a clean A/B on someone else's 70k-row map

The user ran the test this review asked for, on the real game, and the install has since been captured in
full ([`gta-sa-original/reference-install-config.md`](../../../../../gta-sa-original/reference-install-config.md))
— so the configuration is no longer a report, it is a record. **FLA and OLA were BOTH loaded throughout**
(our own `perfect-map-asi.log` names both), with OLA owning the IPL zones and FLA's entire `[IPL]` section
disabled. A pool-raiser being present is required rather than incidental: [004's pivotal correction](../../../../../../asi/perfect-map/docs/plans/004-limit-patches.md)
records that the int16 bug **cannot manifest at all** without a pool-raiser, because stock `CBuilding` is
13 000 and a no-adjuster boot dies first at `0x5381A5`. So OLA is the floor the experiment stands on, and
holding it constant while toggling only the int16 patch is what makes this a single-variable A/B rather than
an observation:

| Configuration | Result |
| --- | --- |
| ProperFixes 2.2.1 **with** the vegetation optional, FLA+OLA, `ProperFixes.asi` REMOVED | **ghost barriers reproduced** |
| the same, FLA+OLA unchanged, **`perfect-map.asi`** in place of it | **barriers gone, and the new-game 2dfx crash gone** |

That is **70 212 permanent text rows — 2.14× the int16 ceiling — on a third-party corpus with real
positions**. Everything fix #1 had been proven on before was ours: the 33k synthetic repro dial and our own
30 566-row monolith. And the 2dfx half is 009's `FxSystem_c` guard confirmed on data nobody here authored
(the reported symptom was the new-game crash, i.e. `0x004AA3A1`).

**What it decides.**

- **Route 3 is no longer a bet** — for the int16 ceiling our patch is demonstrated at more than twice the
  limit on a foreign map, with the pool-raiser held constant across both arms.
- **OLA does not lift the int16 ceiling.** It was present in the failing arm too. This review's central
  premise stands, and 004's source study of OLA already predicted it (`0x404B4A` is byte-stock in OLA).
- **Neither route is sufficient alone, and that is the real answer to question 2 below.** The shipping
  configuration for a dense map is **OLA (or FLA) for the pools and slots, PLUS our ASI for int16** — until
  `004b` builds our own pool/array relocations. An external dependency is not a preference here; it is
  currently load-bearing, and the stock-target promise has to say so.
- **004's open item is closed, with a log line rather than an inference** — "our APPLY build still DEFERRED
  with OLA present". `perfect-map-asi.log` reads `int16 APPLIED` **and** names both adjusters as present, so
  the per-site diagnostic 004 asks for is unnecessary.

**What it does NOT decide.** **Slots were never stressed.** ProperFixes occupies 6 IPL slots and the install
runs 36 of 40, so `IplEntityIndexArrays` was not exercised. That turns out not to matter — see below.

## And then the install answered the rest of the review

Capturing the reference install closed the remaining questions from its ini files, without another field run:

- **`EntitiesPerIpl = unlimited`** — OLA grows `gpLoadedBuildings`, the 4 096 per-file buffer our
  `AREA_MAX_PAIRS = 2000` guards. **That is why ProperFixes' 9 627-row IPL files load**, and it means our cap
  is a stock-target cap that is simply inert here. Nothing was wrong with our model of the ceiling; the
  target does not have the ceiling.
- **`EntityIpl = unlimited`** — the 40-slot array, gone too.
- **`Buildings = 100000`** (stock 13 000) — which is what lets 72 914 rows exist at all.

**So the binding ceiling this review spent its length identifying does not exist on the install we ship to.**
Both remaining routes collapse into one answer: **the reference target needs the adjusters AND our ASI**, and
past that the limiter is memory and frame time. `004b` (our own pool/array relocations) stops being a
prerequisite for density and becomes what would free us from depending on someone else's plugin.

## The question

Three ways to place more procobj than vanilla limits allow:

| # | Route | Cost |
| - | ----- | ---- |
| 1 | Keep the current work-around (binary streams + budgets + `checkTextIplSlotBudget`) | already built and shipping; caps our density |
| 2 | Depend on **FLA + OLA** (user-installed limit adjusters, present on any modded install) | zero engineering for us; a hard external dependency |
| 3 | Our own **`asi/perfect-map`** | we own it; fix #1 done, #2/#3 (`004b`) not |

04 currently assumes 3. The user's point is that 2 is free. So: what does each route actually buy?

## Measured starting state

Before arguing, the numbers — because the whole discussion turns on how close we really are. Two runs, and
the second supersedes the first (they measured different trees: `build/original/sa` then, the canonical
`build/original/opensa` now):

| Limit | 2026-07-28 | **2026-08-07** | Ceiling | Build guard | Headroom now |
| ----- | ---------- | -------------- | ------- | ----------- | ------------ |
| int16 `IplDef` — permanent TEXT rows map-wide | 25 461 | **20 146** | 32 767 | 30 000 | 9 854 to the guard |
| `IplEntityIndexArrays` — gta.dat IPL slots with `inst` | 37 | **38** | 40 | 39 | **ONE slot** |
| per-area `LoadScene` rows (text + binary) | worst 3 822 | — | ~4 096 | `AREA_ROW_CAP` 4 000 | 4 % |

Generated procobj today (2026-08-07): **6 954** text rows (the LOD layer, 9 files `plobj0..7` + `plotr0`) +
**24 552** instances inside 51 binary stream tiles, over 63 `plo*` models in the text layer and no TXDs of
its own (the no-`--in` mode reuses the game's own models and textures). Alongside them the tree LOD layer
holds another 563 rows in `lods.ipl`, so **7 517 of the 20 146 rows and 10 of the 38 slots are ours**; stock
accounts for 12 629 rows in 28 slots. Per-area totals sit just under the 4 000-row budget — that is what
created eight areas beyond the first.

**The finding that reframes everything: the binding constraint is SLOTS, not the int16 row ceiling.** We have
9 854 rows of headroom to the guard and **one IPL slot**. Any meaningful density increase needs more
generated areas, and we run out of slots long before we run out of rows.

This also explains why installing this build without any ASI shows no ghost barriers, and never could:
the bug needs >32 767 permanent text rows and the build guard fails at 30 000. The work-around is doing
exactly its job.

## What each route actually covers

The decisive fact is already recorded in [ghost-barriers.md](../../../../../open-issues/fixed/ghost-barriers.md)
and must not be re-litigated:

> Raising pools (FLA/OLA) **cannot** help: the int16 lives in the `IplDef` struct itself and **no limit
> adjuster exposes it**.

So the two limits fall on opposite sides:

| Limit | FLA/OLA | our ASI |
| ----- | ------- | ------- |
| `IplEntityIndexArrays` (40 slots) — **the binding one** | **YES** — FLA's `[IPL] Entity index array` | fix #2/#3, plan `004b`, NOT built |
| per-area `LoadScene` budget (~4 096 rows) | YES (pool/array relocation) | `004b`, NOT built |
| int16 `IplDef` row ceiling | **NO — structurally impossible** | **YES — fix #1, DONE; confirmed in-game, and on a foreign 70k-row map (2026-08-07)** |

Read together with the measurement, that is close to an answer:

- The limit we are actually about to hit (**slots**) is the one FLA already lifts and our ASI does not.
- The limit our ASI uniquely lifts (**int16 rows**) is the one we have 9 854 rows of headroom on — and,
  since the 2026-08-07 field run, the one it is demonstrably good for well past the ceiling.

## What to decide

1. **Does raising density need the int16 lift at all, or only the slot lift?** Estimate the row and slot
   cost of the 02/03 density profiles first. If more density mostly adds BINARY instances (which cost no
   text rows) and a handful of areas, the answer is "slots only" — and our ASI is not on the critical path
   for 0.5.0 density at all.
2. **Is an external dependency acceptable for the shipped product?** FLA is free but it is the user's to
   install, it can be absent or the wrong build, and the same doc records that **FLA×OLA double-patching
   the same LoadScene/IPL zones boot-crashes in `LinkLods`** — "exactly ONE adjuster may own IPL limits".
   Depending on a specific adjuster configuration is a support surface we currently do not have.
3. ~~**Is there a cheaper route than either?**~~ **CLOSED 2026-08-07 — folding cannot buy the target.** The
   idea was to fold the generated areas into fewer, larger `plobj` files the way `mod-installer` folds mod
   IPLs (`ipl-slot-merge.ts`), and buy the headroom with no ASI and no FLA. It does not work, and the reason
   is arithmetic rather than judgement: **area count is set by the ~4 000-row per-area `LoadScene` budget,
   not by how the files are grouped.** The target's 57 583 HD rows + ~16 312 LOD rows is ≥ 19 areas against
   the 9 we ship; fewer files simply means areas that breach the budget. Folding remains worth doing as
   HYGIENE (our 9 areas average 3 501 rows, so a repack could recover one or two slots) — it is not a route
   to density. See [density-target.md](../density-target.md).
4. **What does the stock target promise?** Today it is "runs on unmodded SA 1.0". If density ships gated
   on FLA, that promise needs restating.
5. ~~**What is ProperFixes actually getting away with?**~~ **ANSWERED 2026-08-07 in the field.** Its
   vegetation set is 57 583 permanent text rows on top of stock's 12 629 — **70 212 map-wide, 2.14× the
   int16 ceiling** — and the question was whether (a) OLA lifts the truncation, or (b) its users carry
   latent ghost barriers. **It is (b) plus its own `.asi`:** strip `ProperFixes.asi` and the barriers appear
   on its data. **OLA does not lift the int16 ceiling** — this review's central premise stands, and 004's
   source study of OLA already said so (`0x404B4A` is byte-stock in OLA). What lifts it is a dedicated
   patch: theirs, or ours. **Route 2 is therefore NOT free for int16.** It stays free for slots and pools,
   which is all it ever covered.
6. **Is our per-area row budget too tight by 2.4×, and does that dissolve the slot problem?** Their IPL files
   carry ~9 597 rows each against our `AREA_ROW_CAP` of 4 000, and they ran clean. If a file that size is
   genuinely safe, the density target is ~6 slots rather than ≥ 19 areas and the binding ceiling this review
   found simply goes away. **Do not conclude it from this run** — their rows are pure text with no LODs and
   no binary streams, ours are mixed, and `AREA_ROW_CAP` models a `LoadScene` budget that may not be
   per-file at all. It is now the highest-value measurement in the chain, and
   [04](04-slot-economy-and-budgets.md) is where it belongs.

## Tasks

- [x] Cost the density profiles in ROWS and SLOTS (not just object counts) — the number that decides whether
      the int16 lift is on the critical path. **Done 2026-08-07**: rows fit (29 504 / 30 000 guard), slots
      miss by ~10. The int16 lift is **not** on the critical path;
      [density-target.md](../density-target.md) carries the arithmetic.
- [x] Test option 3 (fold generated areas into fewer files). **Closed** — see decision 3 above.
- [x] **Install ProperFixes 2.2.1 + its vegetation optional on the real game and look for ghost barriers.**
      **Done 2026-08-07, and it answers decision 5 in our favour** — the bug reproduces on its data without
      `ProperFixes.asi`, and `perfect-map.asi` fixes it (plus the 2dfx new-game crash). See the field-run
      section above, including the one thing that still has to be checked about the configuration.
- [x] **Name what was loaded during that run. Answered: OLA, alongside `perfect-map.asi`** — which is the
      only configuration in which the bug is reproducible at all, and which makes the run a single-variable
      A/B. It also **closes 004's deferred-with-OLA open item**: #1 applied and worked with OLA present.
- [ ] Verify the FLA claim on a real install: does `[IPL] Entity index array` actually lift the 40-slot
      ceiling, and does it coexist with whatever else the target install runs? Extend the repro dial with a
      SLOT dial if it only counts rows.
- [ ] Measure the folding hygiene win separately: our 9 areas average 3 501 of a 4 000-row budget. How many
      slots does a tight repack recover, and does any area then breach the budget? Measure, do not reason.
- [ ] Write the decision into this file, then amend [04](04-slot-economy-and-budgets.md) to match — its
      "gated on Task 3" framing is now known to be wrong, so the amendment is not conditional.
- [ ] If the answer is "FLA/OLA is enough", state plainly what that costs the stock-target promise, and
      whether `asi/perfect-map` `004b` still deserves the effort.

## Verification

The review is closed when the plan can name, with measurements: which limit the target density hits FIRST,
which route lifts it, and what that route costs the user's install.

## Measurements / notes

- 2026-07-28 baseline (`build/original/sa`): 25 461 rows / 37 slots.
- **2026-08-07 baseline (`build/original/opensa`, the canonical tree): 20 146 rows / 38 slots.** Slots are
  the number to watch — headroom is ONE against the build guard.
- **2026-08-07, target costed:** 57 583 objects needs ~16 312 text rows (map-wide 29 504, fits) and ≥ 19
  areas (slots 48 vs a 40 ceiling, does not fit). Area folding closed as a route.
- **2026-08-07, reference measured:** ProperFixes 2.2.1 places 57 583 rows in 6 slots, 46 models, every row
  `lod = -1`, and requires OLA. 8.3× our row cost per object.
- **2026-08-07, FIELD:** ProperFixes 2.2.1 + vegetation optional (70 212 map-wide rows, 2.14× the int16
  ceiling) on the real game, **OLA loaded in both arms**. `ProperFixes.asi` removed → ghost barriers
  reproduced. `perfect-map.asi` in its place → **barriers gone AND the new-game 2dfx crash gone.** One
  variable, so: OLA does not lift int16; our patch does, on a foreign map. Slots untouched (6 in use).
- _(FLA slot-lift verification — pending)_
- _(folding hygiene win — pending)_
