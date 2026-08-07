# 01 — Every species survives the cap (no silently missing type)

Part of [07 — LOD generators, extended](../readme.md), Part B. Independent of the ASI question
([00](00-limit-route-review.md)) and of raised density ([02](02-density-model.md)) — this is a
FAIRNESS defect in how the caps choose survivors, and it is worth fixing at today's density.

**The ask:** a section allows 300 objects and three species are eligible there. All three must appear. Not
in equal proportion — but none may be dropped to zero.

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

The hole is in what `lottery` means. Scatter assigns `lottery = random × density`, where `density` comes
from the species' own `procobj.dat` rule. So **a species with a low rule density produces systematically
low lotteries and crowds out one with a high density** — the ordering is not a fair draw across species,
it is a draw biased by a per-species constant. Under a tight cap the tail species can reach zero
placements, in a section where its rule was perfectly valid.

Nothing today detects this: the caps are silent, and a missing species looks like terrain that simply has
no cacti. `cullByMinDistance` runs per species and cannot help — it thins within a species, before the
cross-species cut.

This is also why the fix belongs here and not inside 02: raising density does not remove the bias, it just
moves which species falls off the end.

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
   seats" problem. Two cheaper alternatives to weigh against it: a stratified draw (round-robin one per
   species until the budget runs out, then lottery order), and per-species lottery NORMALISATION (divide
   by the rule density so the draw is unbiased) — the last one is the smallest diff and may be enough on
   its own; measure before choosing.
4. **Determinism is non-negotiable.** Same seed and same inputs → same placement set, as today. Any
   apportionment must be a pure function of the candidate set.
5. **Make the drop visible.** Whatever the algorithm, log per-section which species were floored and which
   were cut to zero before the fix — the diagnostic is what proves the defect is real and, later, gone.

## Tasks

- [ ] Reproduce and SIZE the defect first: instrument the current build to report, per cell, species
      eligible vs species placed. Find real sections where a species reaches zero. If the answer is "this
      never actually happens at shipping density", say so and close the plan — the defect is structural but
      may be latent.
- [ ] Decide the section unit (cell vs global) and the floor N; record why.
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

_(record after implementation)_

- sections where a species reached zero, before the fix: …
- floor N chosen + why: …
- proportion shift against vanilla (how much character the floor costs): …
