# 01 — Every species survives the cap (no silently missing type)

Part of [07 — LOD generators, extended](../readme.md). Independent of the ASI question
([00](00-limit-route-review.md)) — this is a FAIRNESS defect in how the caps choose survivors, not a limit
question. ~~And independent of raised density ([02](02-density-model.md)) — worth fixing at today's
density.~~ **Both halves of that were wrong and the 2026-08-08 sizing struck them: at today's density the
shipping build loses no species at all, and [02](02-density-model.md) is what brings the defect back. This
plan now RUNS AFTER 02** (the user's call, same day).

**The ask:** a section allows 300 objects and three species are eligible there. All three must appear. Not
in equal proportion — but none may be dropped to zero.

**"Not in equal proportion" is the load-bearing half, and there is now evidence for it.** The reference set
in [density-target.md](../density-target.md) — 57 583 hand-tuned instances from a shipping mod — puts **40 %
of everything into two of its 46 species**, with a tail running down to a couple of hundred. A skew that
extreme is what a good-looking scatter actually is. So the deliverable here is a FLOOR that outlaws zero,
never a quota that flattens the distribution; an implementation that evens the mix out would be a
regression measured against the only reference we have.

## Context — why a species can vanish today

Both cap sites select survivors the same way: pool every candidate, sort by `lottery`, keep the lowest.

1. **Build-time, global** (`tools/map-placement/src/procobj/convert.ts`):

   ```ts
   const vanilla = batch.placements.filter((p) => p.lottery < 1);   // vanilla cutoff (02 makes it configurable)
   …
   placed.sort((a, b) => a.placement.lottery - b.placement.lottery);
   const final = placed.slice(0, procObjMax);                        // ONE global cut, procObjMax = 20 000
   ```

2. **Per cell, runtime and colliders** (`packages/renderware/src/map/procobj-scatter.ts`,
   `procObjLotteryCap`): pools the lotteries of ALL of the cell's batches, sorts, and returns the
   `limit`-th as the cutoff — "lowest lotteries win — the most-vanilla subset".

### What the mechanism actually is (corrected 2026-08-08, against the code)

This plan was written around a bias that does not exist. It said `lottery = random × density` with `density`
coming from the species' own `procobj.dat` rule, so a low-density species would produce systematically low
lotteries and crowd the others out. The code says otherwise:
`lottery: random() * PROC_OBJ_MAX_DENSITY` (`procobj-scatter.ts:195`) — **uniform in [0, 3) for every
candidate of every species**, with no per-species term. `ProcObjRule` has no density field at all
(`procobj.parser.ts`): `procobj.dat` expresses density as **`spacing`**, one object per N m², and it is spent
at candidate GENERATION (`expected = area / rule.spacing × PROC_OBJ_MAX_DENSITY`).

So the cross-species draw is unbiased and the global cut is **proportional** — each species keeps roughly the
same fraction of its own candidates. Which kills the cheapest of the three candidate fixes below outright:
"per-species lottery NORMALISATION, divide by the rule density" has nothing to divide by and nothing to
correct.

**A species can still reach zero, by two routes that are not the one this plan described:**

1. **Rounding.** A species whose eligible count × the surviving fraction falls below 1 disappears — a rare
   species on a small patch, not a low-density one. The tighter the cap the more species this reaches.
2. **MINDIST before the cut.** `cullByMinDistance` runs per species on the lottery-filtered set
   (`convert.ts:115`) and can thin a tightly-spaced species to almost nothing before the cross-species cut
   ever sees it. It is not the innocent bystander the old text made it.

Both are real; neither has been observed. **That makes the first task below the whole plan for now** — the
defect is structural in a weaker form than claimed, and it may well be latent at shipping density.

Nothing today detects it either way: the caps are silent, and a missing species looks like terrain that
simply has no cacti.

This is still why the fix belongs here and not inside 02: raising density changes which species round to
zero, it does not stop the rounding.

## Decisions (to settle during the plan)

1. **The guarantee is a FLOOR, not a quota.** Every species with at least one eligible placement in the
   section keeps at least `min(N, its eligible count)` placements, with N small (1–3, config). Above the
   floor, the existing lowest-lottery order continues to rule — vanilla character is preserved, only the
   zero case is outlawed.
2. **"Section" must be named.** The two cap sites have different units — a CELL (`procObjLotteryCap`) and
   the WHOLE MAP (`procObjMax`). A floor per cell is what the user is describing and is the useful one; a
   global floor is nearly meaningless at map scale. Decide whether `procObjMax` gets a per-species floor
   too, or whether the global cut is simply applied after per-cell floors are reserved.
3. **Candidate algorithm — largest-remainder apportionment over species.** Give each species a share of
   the section budget proportional to its eligible count, floor each share at N, then fill the remaining
   budget by the existing lottery order. It is deterministic, needs no RNG, degrades to today's behaviour
   when the budget is not binding, and is the standard fix for exactly this "smallest party gets zero
   seats" problem. One cheaper alternative to weigh against it: a stratified draw (round-robin one per
   species until the budget runs out, then lottery order). ~~Per-species lottery normalisation~~ is struck —
   the draw is already unbiased, see the mechanism section.
4. **Determinism is non-negotiable.** Same seed and same inputs → same placement set, as today. Any
   apportionment must be a pure function of the candidate set.
5. **Make the drop visible.** Whatever the algorithm, log per-section which species were floored and which
   were cut to zero before the fix — the diagnostic is what proves the defect is real and, later, gone.

## SIZED 2026-08-08 — the defect is real, and it is not where this plan looked

`scripts/debug/procobj-species-floor.ts` runs both cap sites with the pipeline's own functions. Numbers in
[Measurements](#measurements--notes); the shape of the answer:

- **Neither BUILD-time cap can zero a species.** MINDIST provably cannot — `cullByMinDistance` starts with an
  empty spatial grid, so the first placement of every non-empty batch always survives; it thins savagely
  (`sjmcacti2` 152 → 2 map-wide) and never to zero. The global `procObjMax` cut zeroed nothing either, and on
  the real converted set it **does not fire at all**: the layer places 15 286 against a cap of 20 000. The
  rounding route zeroed nothing. **So the whole Context section above describes the wrong site.**
- **The RUNTIME cell cap does zero species, in one clutter cell in five.** On stock rules, `procObjLimit` 150
  binds in 98 % of cells that scatter anything and drops at least one eligible species to zero in **19.8 %**
  of them — worst case 14 of 25 species placed, with eight desert `dead_tree_*` variants and the tallgrass
  gone at once. That is exactly the "a desert cell shows only one shrub species" the ask describes.
- **And on the SHIPPING build it is latent — because of the generator, not because the cap is safe.**
  `convertProcObj` strips every converted species from `procobj.dat`, so what still scatters at runtime in
  `build/original/opensa` is **8 underwater rules on one surface**. Over the same geometry those lose
  **zero** species: 8 species share a 150 budget comfortably. The tall species are static instances now, and
  a static instance is never capped.

**What that means for the decision.** The defect is genuine and worth fixing, but nothing in the shipped
`original` build shows it today. It returns the moment either of two things happens: a game that does NOT run
`lod-procobj-generator` (its runtime scatter is the full stock set), or [02](02-density-model.md) raising
density — more candidates per cell is more cap pressure, and the cap is what zeroes.

**DECIDED 2026-08-08 (the user's call): this plan runs AFTER [02](02-density-model.md), re-scoped to the
runtime cell cap alone.** The build-time half is closed as a non-defect and its tasks below are struck. The
plan is not closed as latent — it is sequenced, because 02 is what makes the defect bite in the shipping
build, and building the floor before the density that provokes it would mean tuning a fix against a
population nothing produces yet.

**What 02 must therefore carry away from here:** the moment it raises density it owns this defect. The
measurement to repeat at the new density is the first table below — the same script, same `--stride 3`
sample, so the two runs are comparable — and the number to watch is *cells losing ≥1 species*, not the cap's
binding rate, which is already 97.9 % and says nothing on its own.

## Tasks

- [x] **Reproduce and SIZE the defect first, and nothing else until it reports.** Done — see above and
      [Measurements](#measurements--notes). The split by cause it asked for came out one-sided: MINDIST and
      both build-time cuts zero nothing, the runtime cell cap zeroes plenty.
- [x] Decide the section unit (cell vs global) and the floor N; record why. **Unit DECIDED: the runtime
      CELL, and only it** — the global cut has no zeroing to prevent, so ~~a per-species floor on
      `procObjMax`~~ is struck along with decision 2's second half. N is still open and is 02's to pick,
      against the density it lands on.
- [ ] Implement the chosen algorithm behind a config flag, defaulting OFF until the numbers justify it.
- [ ] Unit tests: three species with skewed rule densities and a budget of 300 — all three present, and the
      proportions still follow the lottery order above the floor; with the flag off, the placement set is
      byte-identical to today (regression).
- [ ] Apply the same rule to `procObjLotteryCap` so the RENDER set and the COLLIDER set agree — the two
      share one budget by design ("what isn't rendered is never collided"), and a floor applied to only one
      of them would break that invariant.
- [ ] In-viewer check: a desert cell that previously showed only one shrub species shows its full roster.

## Verification

- A section with a hard cap and skewed species densities places all eligible species; none reaches zero.
- Flag off → identical output to today (the regression fixture is the guard).
- Render and collider sets still agree placement for placement.
- Determinism preserved: two builds of the same input produce identical placements.

## Measurements / notes

**The sizing run, 2026-08-08** — `scripts/debug/procobj-species-floor.ts`, corpus `game-src/original`
(95 scatter rules on 17 surfaces, 562 populated 250 u cells), collision and map defs from the same tree.
Both modes call the shipping functions (`scatterProcObjects`, `procObjLotteryCap`, `cullByMinDistance`), so
these are the pipeline's numbers, not a model's.

### Runtime cell cap — `procObjLimit` 150, density 1

| Rule set | Cells sampled | With clutter | Cap binding | Cells losing ≥1 species |
| --- | --- | --- | --- | --- |
| stock `procobj.dat` (95 rules) | 188 (stride 3) | 96 | **94 (97.9 %)** | **19 (19.8 %)** |
| the SHIPPING set — `build/original/opensa/data/procobj.dat` (8 rules) | 188 | 11 | 11 (100 %) | **0** |

Most-often zeroed on stock, by cells: `dead_tree_3` 7, `dead_tree_6` 7, `dead_tree_2` 6, `dead_tree_5` 6,
`dead_tree_8` 6, `dead_tree_9` 6, `dead_tree_7` 4, `genveg_bush13` 4, `rockbrkq` 4 — 18 species in all.
Worst cells: `-10,-8` (~−2375, −1875) places **14 of 25** eligible species, losing eight `dead_tree_*` plus
two tallgrasses and a bush; `-4,-4` places 13 of 23; `-2,-7` loses nine species worth 268 instances.

The cap binds almost everywhere and costs nothing most of the time — what decides whether a species dies is
how many species compete in the cell, which is why 8 underwater rules are safe and 25 desert ones are not.

Self-check in the script: **binding ⇒ the cell draws exactly `limit`; not binding ⇒ it draws everything
vanilla would.** It failed on one cell first time and the rig was wrong, not the engine — a cell can hold
more than `limit` candidates and still have its 150th lottery above 1, in which case density is the cutoff
and the cap costs nothing.

### Build-time pass — whole-map colliders, `procObjMax` 20 000, all 95 rules

7019 collider groups → 51 batches → **20 265 placed, cut to 20 000** (the cut binds by 1.3 %; on the real
converted set it does not fire at all — the layer places 15 286).

| Zeroed by | Species |
| --- | --- |
| the `lottery < 1` cut (rounding) | **0** |
| MINDIST | **0** — and it *cannot*: `cullByMinDistance` starts with an empty grid, so a non-empty batch always keeps its first placement (asserted by the script) |
| the global `procObjMax` cut | **0** |

MINDIST is nonetheless where the population goes: `sjmcacti2` 485 candidates → 152 vanilla → **2** after
MINDIST; `sm_des_pcklypr1` 336 → 113 → **2**; `veg_pflowers03` 14 431 → 4869 → **70**; the eight
`dead_tree_*` land on 140–149 each. A rare species is rare because of its MINDIST column, not because a cap
took it.

- floor N chosen + why: _(not yet — the fix is deferred, see the verdict above)_
- proportion shift against vanilla (how much character the floor costs): _(not yet)_
