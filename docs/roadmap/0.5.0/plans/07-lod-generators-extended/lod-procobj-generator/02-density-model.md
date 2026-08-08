# 02 — Procobj density model (build-time, configurable, PER TARGET)

Part of [07 — LOD generators, extended](../readme.md). The foundation for "more procobj": turn density from a hardcoded vanilla constant into a configurable, per-category/per-surface model.

**Rewritten PER TARGET 2026-08-08 (the user's call), and narrowed to TWO targets the same day.** The plan
previously spoke of one density and one set of caps. **Stock SA is not a target of this project** — the
declared configuration is OLA + FLA plus our own `perfect-map.asi`
([`gta-sa-original/reference-install.md`](../../../../../gta-sa-original/reference-install.md)) — so the
`sa-stock` profile a first draft of this rewrite introduced is struck. The machinery below is
target-independent; every NUMBER is not.

## The two targets, and what each can actually take

| Target | What it is | The wall that binds first | Density it reaches |
| --- | --- | --- | --- |
| **`sa/`** | the real game as we ship to it: OLA (`EntitiesPerIpl` / `EntityIpl` = `unlimited`, `Buildings = 100000`) + FLA (its whole `[IPL]` section disabled) + **`perfect-map.asi`** | **int16** `IplDef` building indexes — the ONE ceiling OLA leaves stock — until our asi applies; then memory and frame time | the full **3.77×** target, and no ceiling has been found above it |
| **`opensa/`** | our own engine, own formats, own streaming | **nothing SA has** — no slot array, no `LoadScene` per-file buffer, no int16. Memory and frame time, plus the per-cell `procObjLimit` | unmeasured; no ceiling has been found |

Sources: [density-target.md](../density-target.md) for the walls and the 3.77× target,
[`gta-sa-original/reference-install.md`](../../../../../gta-sa-original/reference-install.md) for what the
target install lifts and what it does not, [`restrictions/sa-target.md`](../../../../../restrictions/sa-target.md)
for why `opensa/` is a separate representation rather than a mode of `sa/`.

**What "more" means is a number**: [density-target.md](../density-target.md) sets the aiming point at **57 583 placed objects, 3.77× our current 15 286** — measured off ProperFixes 2.2.1, a shipping mod. (Re-derived 2026-08-08: this line read "2.35× our current 24 552" until the census showed 24 552 to be the generated streams' RECORD count, not the object count.) That is the ceiling a profile is allowed to reach, not a quota to fill: reaching it with the wrong species is a failure. The same file records that a hand-authored reference set puts **40 % of its instances in two species** — so a profile that produces an even spread is not more correct than the reference, it is a different look, and the plan must say which one it aims for.

### What dropping stock changes, and what it does not

**Gone as a design constraint:** the 39-slot `IplEntityIndexArrays` array and the 4 096-row per-area
`LoadScene` buffer. Both are `unlimited` on the target, so the "1.18× and therefore a redistribution profile"
conclusion this file carried for a day is void — it was the answer to a question about an install we do not
ship to. The whole slot economy stops being a density lever.

**Still real, and now the only correctness ceiling:** **int16**. OLA does not lift it — measured, `0x404B4A`
is byte-stock on the reference install — and the target's 24 437 procobj rows put the map at **38 096
permanent rows, 5 329 over 32 767**. `perfect-map.asi` is what carries it, so this plan's density is
**gated on our own asi** rather than on an adjuster. That is the one gate a profile must declare.

**And a build that lands on a stock install is now a build nobody guarded.** Not a target is not the same as
not a failure mode: someone will install this over a plain 1.0. The honest form is a build-time REPORT —
"this build needs OLA and perfect-map.asi; on stock it corrupts" — plus the installer's own presence check
([04](04-slot-economy-and-budgets.md) decision 6), not a cap that rations the target we do ship to.

### And `opensa/` is where the plan was silently under-built

Both this plan and [04](04-slot-economy-and-budgets.md) were written entirely in SA-ceiling language, and our own engine has none of those ceilings. Worse, it currently INHERITS them: `checkTextIplSlotBudget` runs on the **common baked build**, before the `sa/`/`opensa/` split (`perfect-map-builder/src/pipeline.ts:206`), so an opensa-only build throws at 30 000 permanent text rows and warns at 39 slots — two 2004 numbers that reach no OpenSA code path, and one of which the SA target does not have either. There is a manual escape (`--allow-text-row-overflow`) and no target split. This is [lesson 28](../../../../../project-goals.md) exactly: designing down to a ceiling the target does not have is silent — the build works, it just carries a fraction of what it could. **Fixing the guard was [04](04-slot-economy-and-budgets.md)'s task and it landed 2026-08-08** — the guard is `checkTextIplBudgets` on the built `sa/` tree, int16 throws, the 39 slots are a report, and `opensa/` runs neither. **This plan's job is unchanged: stop expressing density as one number both targets share.**

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
| `PROC_OBJ_MAX_DENSITY = 3` | `procobj-scatter.ts` | how many CANDIDATES are generated at all; a cutoff above 3 needs this raised too | **yes** — the 3.77× target needs it on both |
| `procObjMax = 20000` | `lod-procobj-generator/config.ts` | global safety cap on placed objects | **yes** ([04](04-slot-economy-and-budgets.md) sets it) |
| `procObjLimit` (150 in `engine-canvas-host`) | the OpenSA runtime adapter, per cell | a runtime render/collide budget, **not** a build knob | `opensa/` only — it does not exist for `sa/` |

The multiplier belongs on the first two. The per-cell budget is the engine's own and is a different lever; it is also the site of the fairness defect in [01](01-species-representation-floor.md), which now runs AFTER this plan precisely because raised density is what makes it bite.

## Decisions

1. **Density cutoff becomes configurable, per category and per surface.** Replace the literal `lottery < 1` with `lottery < densityFor(category, surface)` — a config table (default all-1.0 = today's vanilla). `densityFor > 1` (up to the candidate ceiling) keeps more candidates for that category/surface; `< 1` thins.
2. **The MACHINERY is target-independent; the PROFILE is per target.** One `ProcObjDensityConfig` type, two shipped profiles, and the build picks by target. A profile is not a multiplier the operator types — it is a named, costed set that some plan has priced against a wall.
3. **Every profile declares its target, its cost and its GATE, and the build refuses a mismatch.** A profile carries the object total it produces and whether it needs `perfect-map.asi` (anything past 32 767 map-wide rows does); a mismatch fails at CONFIG time naming the wall, not at a guard three stages later and not in-game. This is the one new invariant the per-target split adds, and it is what keeps [lesson 28](../../../../../project-goals.md)'s silent under/over-build out of the pipeline.
4. **Category is the primary control axis** (forest→bushes, mountain→rocks, desert→cacti maps to categories bushes/rocks/cacti). Surface is the secondary axis. Zone/biome is [03](03-biome-zone-density.md).
5. **MINDIST stays the quality guard.** Denser candidates still pass through `cullByMinDistance` per species — density raises the ceiling, MINDIST prevents visual clumping/z-fighting. So "more" never means "piled on top of each other". (It is also, measured, what makes a species rare in the first place: `sjmcacti2` goes 152 vanilla placements → **2** map-wide through MINDIST alone.)
6. **Build-time only, deterministic.** Same seed → same scatter; the config is a build input, not a runtime slider (the runtime keeps its live preview slider, unchanged).
7. **Honest capping.** With density up, `procObjMax` and the area budgets bite sooner — log how many placements the caps drop, so raising density without raising budgets ([04](04-slot-economy-and-budgets.md)) is visibly a no-op past the cap, not a silent truncation.
8. **A per-category knob is only LOCAL below the global cap.** All categories feed one lowest-lottery cut (`convert.ts:119` sorts every surviving placement together and slices to `procObjMax`), so once that cut binds, boosting bushes **displaces** rocks and cacti rather than adding to them. Today the layer places 15 286 against 20 000, so the cut is NOT binding and the knob is local — but it is 1.31× away, which any interesting profile crosses. State which side of it a test is on — and note that this cut is OURS (`procObjMax`), not a target ceiling, so [04](04-slot-economy-and-budgets.md) moves it rather than the profile working around it.
9. **The species floor is [01](01-species-representation-floor.md)'s, and this plan owns its trigger.** Raised density is what makes the runtime cell cap start dropping whole species: measured at today's density it zeroes species in **19.8 %** of the cells that scatter anything under the full 95-rule `procobj.dat`, and **0 %** of the shipping build's (whose runtime set is 8 underwater rules — "stock" here means the unconverted rule TABLE, not a stock install). Every profile here is re-measured with `scripts/debug/procobj-species-floor.ts --stride 3`; the number to watch is *cells losing ≥1 species*, not the cap's binding rate (already 97.9 %, and meaningless alone).

## Tasks

- [ ] `convert.ts`: replace `lottery < 1` with `lottery < densityFor(category, surface)`; category is already on the placement, thread surface through. Config type `ProcObjDensityConfig` (per-category and per-category×surface overrides), default = all 1.0.
- [ ] Candidate-ceiling knob: allow raising the candidate-generation multiplier (`PROC_OBJ_MAX_DENSITY` equivalent) via config when a category wants density > 3; keep 3 as default. Both targets need it for the 3.77× aiming point — a cutoff above 3 has no candidates to keep.
- [ ] **Two shipped profiles, each priced before it is written**: `sa` (up to 3.77×, declaring its `perfect-map.asi` gate above 32 767 map-wide rows) and `opensa` (perf-bounded — [04](04-slot-economy-and-budgets.md) supplies the number; until it does, this profile does not exist rather than guessing one). The 1.0 vanilla default stays as the regression baseline, not as a shipped profile.
- [ ] **The mismatch guard of decision 3**, with a test per target: a profile that crosses int16 without declaring the asi gate fails at config time naming the number, and an `sa` profile loaded into an opensa build is *allowed* but logged as leaving headroom on the table.
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
