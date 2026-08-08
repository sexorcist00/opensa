# 02 — Procobj density model (build-time, configurable, PER TARGET)

Part of [07 — LOD generators, extended](../readme.md). The foundation for "more procobj": turn density from a hardcoded vanilla constant into a configurable, per-category/per-surface model.

**Rewritten PER TARGET 2026-08-08 (the user's call).** The plan previously spoke of one density and one set of caps. There are **three targets**, they have different ceilings, and the widest is 3.2× the narrowest — so a single profile is either unsafe on one or a fraction of what another could carry. The machinery below is target-independent; every NUMBER is not.

## The three targets, and what each can actually take

| Target | What it is | The wall that binds first | Density it reaches |
| --- | --- | --- | --- |
| **`sa/` stock** | a plain 1.0 install, no adjusters | **IPL slots** — 38 of 40 used, build guard 39, so ONE free slot ⇒ 9 procobj areas | **1.18×** (~18 000 objects) |
| **`sa/` reference** | the install we ship to: OLA `EntitiesPerIpl`/`EntityIpl` = `unlimited`, `Buildings = 100000`, **plus `perfect-map.asi`** | **int16** (32 767 building-pool indexes) until our asi is loaded; then memory and frame time | **2.95×** without the asi (~45 000), the full **3.77×** target with it |
| **`opensa/`** | our own engine, own formats, own streaming | **nothing SA has** — no slot array, no `LoadScene` per-file budget, no int16. Memory and frame time, full stop | unmeasured; no ceiling has been found |

Sources: [density-target.md](../density-target.md) for the walls and the 3.77× target, [`gta-sa-original/reference-install.md`](../../../../../gta-sa-original/reference-install.md) for what the reference install lifts, [`restrictions/sa-target.md`](../../../../../restrictions/sa-target.md) for why `opensa/` is a separate representation rather than a mode of `sa/`.

**What "more" means is a number**: [density-target.md](../density-target.md) sets the aiming point at **57 583 placed objects, 3.77× our current 15 286** — measured off ProperFixes 2.2.1, a shipping mod. (Re-derived 2026-08-08: this line read "2.35× our current 24 552" until the census showed 24 552 to be the generated streams' RECORD count, not the object count.) That is the ceiling a profile is allowed to reach, not a quota to fill: reaching it with the wrong species is a failure. The same file records that a hand-authored reference set puts **40 % of its instances in two species** — so a profile that produces an even spread is not more correct than the reference, it is a different look, and the plan must say which one it aims for.

### The consequence the old plan hid: on stock this is not a density plan at all

1.18× is **less than the rounding error of a per-category profile**. "Denser bushes in forest" on a stock target cannot mean more bushes; it can only mean bushes instead of something else, because the slot wall is 18 % away and a category knob past it displaces rather than adds (decision 8). **So the stock target gets a REDISTRIBUTION profile and says so**, and the plan stops describing it as growth. Anything that reads as "more objects" belongs to the reference and `opensa/` targets.

### And `opensa/` is where the plan was silently under-built

Both this plan and [04](04-slot-economy-and-budgets.md) were written entirely in SA-ceiling language, and our own engine has none of those ceilings. Worse, it currently INHERITS them: `checkTextIplSlotBudget` runs on the **common baked build**, before the `sa/`/`opensa/` split (`perfect-map-builder/src/pipeline.ts:206`), so an opensa-only build throws at 30 000 permanent text rows and warns at 39 slots — two 2004 numbers that reach no OpenSA code path. There is a manual escape (`--allow-text-row-overflow`) and no target split. This is [lesson 28](../../../../../project-goals.md) exactly: designing down to a ceiling the target does not have is silent — the build works, it just carries a fraction of what it could. **Fixing the guard is [04](04-slot-economy-and-budgets.md)'s task; this plan's job is to stop expressing density as one number that all three targets share.**

## Context

Procobj scatter (`packages/renderware/src/map/procobj-scatter.ts`, reused at build time by `map-placement/src/procobj/convert.ts`):

- candidate count `expected = area / rule.spacing × PROC_OBJ_MAX_DENSITY` (`PROC_OBJ_MAX_DENSITY = 3`); each placement gets `lottery = random() × PROC_OBJ_MAX_DENSITY` — **uniform, with no per-species term** (a species' density is its `spacing`, already spent above).
- **build-time density is hardcoded**: `convert.ts` keeps `placement.lottery < 1` — pure vanilla density — then MINDIST-thins per species and caps to `procObjMax = 20000`.
- Category is already derived per placement: `procObjCategory(model, surface) → bushes/cacti/flowers/grass/rocks/trees` (`procobj-categories.ts`). Surface name is available (`surfinfo.dat`).

So the machinery to place 3× vanilla already exists (candidates are generated at `MAX_DENSITY`); the build just throws most away at `lottery < 1`. Raising density is mostly "raise the cutoff", but doing it uniformly would over-scatter everything — the point is CONTROL (denser bushes, not denser everything).

### Which number is "the 300"

Asked for as "a multiplier, or change 300 to another number" — worth naming precisely, because there are four caps and they are not interchangeable:

| Knob | Where | Meaning | Per target? |
| ---- | ----- | ------- | --- |
| `lottery < 1` | `map-placement/src/procobj/convert.ts` | the build-time density cutoff — **this is the multiplier this plan makes configurable** | **yes** — it IS the profile |
| `PROC_OBJ_MAX_DENSITY = 3` | `procobj-scatter.ts` | how many CANDIDATES are generated at all; a cutoff above 3 needs this raised too | **yes**, and only `opensa/`+reference will need it |
| `procObjMax = 20000` | `lod-procobj-generator/config.ts` | global safety cap on placed objects | **yes** ([04](04-slot-economy-and-budgets.md) sets it) |
| `procObjLimit` (150 in `engine-canvas-host`) | the OpenSA runtime adapter, per cell | a runtime render/collide budget, **not** a build knob | `opensa/` only — it does not exist for `sa/` |

The multiplier belongs on the first two. The per-cell budget is the engine's own and is a different lever; it is also the site of the fairness defect in [01](01-species-representation-floor.md), which now runs AFTER this plan precisely because raised density is what makes it bite.

## Decisions

1. **Density cutoff becomes configurable, per category and per surface.** Replace the literal `lottery < 1` with `lottery < densityFor(category, surface)` — a config table (default all-1.0 = today's vanilla). `densityFor > 1` (up to the candidate ceiling) keeps more candidates for that category/surface; `< 1` thins.
2. **The MACHINERY is target-independent; the PROFILE is per target.** One `ProcObjDensityConfig` type, three shipped profiles, and the build picks by target. A profile is not a multiplier the operator types — it is a named, costed set that some plan has priced against a wall.
3. **Every profile declares its target and its cost, and the build refuses a mismatch.** A profile carries the object total it produces; loading a reference-target profile into a stock build must fail at CONFIG time with the wall it breaches, not at the guard three stages later and not in-game. This is the one new invariant the per-target split adds, and it is what keeps [lesson 28](../../../../../project-goals.md)'s silent under/over-build out of the pipeline.
4. **Category is the primary control axis** (forest→bushes, mountain→rocks, desert→cacti maps to categories bushes/rocks/cacti). Surface is the secondary axis. Zone/biome is [03](03-biome-zone-density.md).
5. **MINDIST stays the quality guard.** Denser candidates still pass through `cullByMinDistance` per species — density raises the ceiling, MINDIST prevents visual clumping/z-fighting. So "more" never means "piled on top of each other". (It is also, measured, what makes a species rare in the first place: `sjmcacti2` goes 152 vanilla placements → **2** map-wide through MINDIST alone.)
6. **Build-time only, deterministic.** Same seed → same scatter; the config is a build input, not a runtime slider (the runtime keeps its live preview slider, unchanged).
7. **Honest capping.** With density up, `procObjMax` and the area budgets bite sooner — log how many placements the caps drop, so raising density without raising budgets ([04](04-slot-economy-and-budgets.md)) is visibly a no-op past the cap, not a silent truncation.
8. **A per-category knob is only LOCAL below the global cap.** All categories feed one lowest-lottery cut (`convert.ts:119` sorts every surviving placement together and slices to `procObjMax`), so once that cut binds, boosting bushes **displaces** rocks and cacti rather than adding to them. Today the layer places 15 286 against 20 000, so the cut is NOT binding and the knob is local — but it is 1.31× away, which any interesting profile crosses. **On stock the slot wall arrives even earlier (1.18×), so the stock profile is displacement-only by construction.** State which side of it a test is on.
9. **The species floor is [01](01-species-representation-floor.md)'s, and this plan owns its trigger.** Raised density is what makes the runtime cell cap start dropping whole species: measured at today's density it zeroes species in **19.8 % of stock clutter cells** and **0 %** of the shipping build's. Every profile here is re-measured with `scripts/debug/procobj-species-floor.ts --stride 3`; the number to watch is *cells losing ≥1 species*, not the cap's binding rate (already 97.9 %, and meaningless alone).

## Tasks

- [ ] `convert.ts`: replace `lottery < 1` with `lottery < densityFor(category, surface)`; category is already on the placement, thread surface through. Config type `ProcObjDensityConfig` (per-category and per-category×surface overrides), default = all 1.0.
- [ ] Candidate-ceiling knob: allow raising the candidate-generation multiplier (`PROC_OBJ_MAX_DENSITY` equivalent) via config when a category wants density > 3; keep 3 as default. **Reference/`opensa` only** — a stock profile cannot reach it.
- [ ] **Three shipped profiles, each priced before it is written**: `stock` (1.0 baseline plus a redistribution variant that stays under 1.18×), `reference` (up to 3.77×, asi-gated), `opensa` (perf-bounded — [04](04-slot-economy-and-budgets.md) supplies the number; until it does, this profile does not exist rather than guessing one).
- [ ] **The mismatch guard of decision 3**, with a test per target: a reference profile in a stock build fails at config time naming the wall (slots, 1.18×), and a stock profile in an opensa build is *allowed* but logged as leaving headroom on the table.
- [ ] Logging: per-category placed vs generated vs dropped-by-cap counts (so 04's budget interplay is visible), plus the permanent-row cost per object, which every profile changes.
- [ ] Unit tests: density 1.0 reproduces today's counts (regression); density 2.0 for `bushes` ~doubles bush placements and leaves other categories unchanged **with the global cap slack** (decision 8 — a fixture that crosses `procObjMax` must assert the displacement instead, or it asserts the wrong thing); MINDIST still enforced.
- [ ] Wire the config through lod-procobj-generator (`config.ts`) and pmb, keyed by the same target flag [04](04-slot-economy-and-budgets.md) introduces.

## Verification

- Density 1.0 → byte/count-identical to today's scatter (regression fixture), on every target.
- Per-category multiplier changes only that category's count below the global cut; MINDIST spacing preserved (no overlaps).
- A profile that breaches its target's wall fails at config time, naming the wall and the number — never at the guard, never in-game.
- Cap-drop counts and rows-per-object logged for every profile (sets up 04).
- `procobj-species-floor.ts` re-run per profile; any rise in *cells losing ≥1 species* hands the plan to [01](01-species-representation-floor.md).

## Measurements / notes

_(record after implementation)_

- vanilla counts per category (baseline): …
- placements at density 2× bushes / 2× rocks / 2× cacti: …
- per profile: objects, permanent rows, rows/object, slots, and which wall it stops at: …
- per profile: cells losing ≥1 species (`procobj-species-floor.ts --stride 3`): …
