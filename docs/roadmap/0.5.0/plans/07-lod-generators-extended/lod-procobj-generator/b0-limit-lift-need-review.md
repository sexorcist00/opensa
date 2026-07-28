# B0 — Do we need our own limit lift at all? (FLA/OLA vs perfect-map ASI)

Part of [07 — LOD generators, extended](../readme.md), Part B. **A go/no-go review, not an implementation
plan.** It runs BEFORE [B3](b3-budget-lift-integration.md), because B3 assumes the answer — it is written as
"gated on Task 3, our own ASI" — and that assumption has never been argued against the alternative the user
raises: **a real SA install will definitely have FLA and OLA anyway.**

Nothing here should be built until this review closes. Its output is a decision, and B3's premise is what
changes if the decision goes the other way.

## The question

Three ways to place more procobj than vanilla limits allow:

| # | Route | Cost |
| - | ----- | ---- |
| 1 | Keep the current work-around (binary streams + budgets + `checkTextIplSlotBudget`) | already built and shipping; caps our density |
| 2 | Depend on **FLA + OLA** (user-installed limit adjusters, present on any modded install) | zero engineering for us; a hard external dependency |
| 3 | Our own **`asi/perfect-map`** | we own it; fix #1 done, #2/#3 (`004b`) not |

B3 currently assumes 3. The user's point is that 2 is free. So: what does each route actually buy?

## Measured starting state (2026-07-28, `build/original/sa`)

Before arguing, the numbers — because the whole discussion turns on how close we really are:

| Limit | Now | Ceiling | Build guard | Headroom |
| ----- | --- | ------- | ----------- | -------- |
| int16 `IplDef` — permanent TEXT rows map-wide | **25 461** | 32 767 | 30 000 | 22 % |
| `IplEntityIndexArrays` — gta.dat IPL slots with `inst` | **37** | 40 | 39 | **3 slots** |
| `gpLoadedBuildings` — per generated area at boot | worst **3 822** | 4 096 | ≤2000 pairs | 7 % |

Generated procobj today: **6 954** text rows (the LOD layer, 9 files `plobj0..7` + `plotr0`) + **24 552**
instances inside 51 binary stream tiles, over 49 `plo*` models and no TXDs of its own (the no-`--in` mode
reuses the game's own models and textures). Per-area boot totals sit at a near-uniform 3 820–3 822, i.e.
the areas are packed to just under the 4 096 ceiling and the overflow is what created eight of them.

**The finding that reframes everything: the binding constraint is SLOTS, not the int16 row ceiling.** We
have 7 300 rows of headroom (22 %) and **three IPL slots**. Any meaningful density increase needs more
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
| `gpLoadedBuildings` (4096/area) | YES (pool/array relocation) | `004b`, NOT built |
| int16 `IplDef` row ceiling | **NO — structurally impossible** | **YES — fix #1, DONE and confirmed in-game** |

Read together with the measurement, that is close to an answer:

- The limit we are actually about to hit (**slots**) is the one FLA already lifts and our ASI does not.
- The limit our ASI uniquely lifts (**int16 rows**) is the one we have 22 % headroom on.

## What to decide

1. **Does raising density need the int16 lift at all, or only the slot lift?** Estimate the row and slot
   cost of the B1/B2 density profiles first. If more density mostly adds BINARY instances (which cost no
   text rows) and a handful of areas, the answer is "slots only" — and our ASI is not on the critical path
   for 0.5.0 density at all.
2. **Is an external dependency acceptable for the shipped product?** FLA is free but it is the user's to
   install, it can be absent or the wrong build, and the same doc records that **FLA×OLA double-patching
   the same LoadScene/IPL zones boot-crashes in `LinkLods`** — "exactly ONE adjuster may own IPL limits".
   Depending on a specific adjuster configuration is a support surface we currently do not have.
3. **Is there a cheaper route than either?** Slots are consumed per gta.dat IPL file. `mod-installer`
   already folds mod IPLs and stock inst-blocks into host IPLs (`ipl-slot-merge.ts`) to save slots. Could
   the generated areas be folded the same way — fewer, larger `plobj` files — trading against the 4 096
   per-area boot ceiling? **This may buy the needed headroom with no ASI and no FLA at all**, and it is
   the option neither B3 nor the ASI chain currently considers.
4. **What does the stock target promise?** Today it is "runs on unmodded SA 1.0". If density ships gated
   on FLA, that promise needs restating.

## Tasks

- [ ] Cost the B1/B2 density profiles in ROWS and SLOTS (not just object counts) — the number that decides
      whether the int16 lift is on the critical path.
- [ ] Test option 3 (fold generated areas into fewer files): how many slots does it free, and does any area
      then breach `gpLoadedBuildings` 4 096 at boot? Measure, do not reason.
- [ ] Verify the FLA claim on a real install: does `[IPL] Entity index array` actually lift the 40-slot
      ceiling, and does it coexist with whatever else the target install runs? The repro dial
      (`tools-debug/sa-int16-repro`) is the harness; extend it with a SLOT dial if it only counts rows.
- [ ] Write the decision into this file, then amend [B3](b3-budget-lift-integration.md) to match — B3's
      "gated on Task 3" framing is only correct if the answer to question 1 is "we need the int16 lift".
- [ ] If the answer is "FLA is enough", state plainly what that costs the stock-target promise, and whether
      `asi/perfect-map` `004b` still deserves the effort.

## Verification

The review is closed when the plan can name, with measurements: which limit the target density hits FIRST,
which route lifts it, and what that route costs the user's install.

## Measurements / notes

- 2026-07-28 baseline: see the table above. Slots 37/40 is the number to watch.
- _(density cost in rows/slots — pending)_
- _(area-folding experiment — pending)_
- _(FLA slot-lift verification — pending)_
