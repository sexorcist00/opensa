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
5. ~~**MINDIST stays the quality guard.**~~ ~~**UNDER REVIEW 2026-08-08**~~ → **ANSWERED 2026-08-09 by the
   reverse, and it is worse than the review supposed: BOTH columns were read wrong.** The recovered
   mechanism is [`gta-sa-original/procedural-objects.md`](../../../../../gta-sa-original/procedural-objects.md)
   (`ProcObjectMan_c` / `ProcSurfaceInfo_c` — not `CPlantMgr`, which is the grass system and reads none of
   this file):

   - **MINDIST is a distance to the CAMERA**, clamped `max(minDist, 80)`, tested against the triangle
     centroid before anything is created — an anti-pop-in radius, never a distance between two objects. The
     four authored values (50/60/70/80) all collapse to 80 in the stock engine, so the column carries no
     per-species intent to honour. **`cullByMinDistance` is not a quality guard; it is the column applied to
     the wrong pair of points.**
   - **SPACING is a LENGTH in metres**: `m_fSquaredSpacingRadius = 1/(spacing*spacing)` and
     `density = triangleArea × that`, i.e. **`area / spacing²`**. We read `area / spacing`, so we generate
     4–163× too many candidates (`procobj.dat`'s own header comment is what misled us — it says "1 object
     every n square metres" and the code squares the number).
   - **Nothing guards against clumping in the original**, which is what task 3 asked. The look comes from the
     triangle being the group (`area / spacing²` objects on one collision face), a corner-biased sampler, and
     every rule of a surface firing on the same triangle — mixed clumps are the system working. The user's
     field report (2026-08-08/09: groups in the forest, chaotic singles among desert rocks) falls straight
     out of `spacing²` and is now measured per rule: `sand_combush02` puts **59 %** of its objects on a face
     carrying ≥2 of itself while `sand_josh1` on the SAME surface puts **2 %**, desert rock and cacti
     (`sm_scrub_rock3` 1 %, `sjmcacti2` 0 %) are singles, mountain rubble (`p_rubble04col`, spacing 10) is
     **76 %** grouped, and 85–97 % of everything stands on a face that also carries another species. **The
     species' own `spacing` decides the look, not the biome** — which is a warning for
     [03](03-biome-zone-density.md): a biome multiplier changes counts, and it changes GROUPING as a side
     effect, because grouping is what a count per triangle means.
   - **The two errors point in opposite directions**, which is why the output looked plausible: too many
     candidates, then 99.0 % of them deleted by an exclusion radius that does not exist.

   Measured (`scripts/debug/procobj-spacing-census.ts`, 2026-08-09, `game-src/original`) — this closes tasks
   1 and 2 below:

   | | our reading | the game's |
   | --- | --- | --- |
   | expected objects, 95 rules | 1 947 713 | **103 007** |
   | expected objects, the 43 converted species | 1 571 748 | **90 906** |

   Stages at vanilla density: 5 843 322 candidates → **1 948 374 pre-cull** (task 2's number, and it matches
   the expectation to 0.00 % — the census's self-check) → **20 265** after MINDIST. And the signature task 1
   asked for is in our own artifact: post-cull same-species nearest neighbour **min 50.0 m**, p05 50.4, med
   58.2, with **0 of 20 246 pairs below their MINDIST**, while cross-species pairs run min 0.3 / med 10.9.
   What ships is evenly spaced and one-of-each-kind — the authored look inverted.

   **So the restatement:** MINDIST leaves the build entirely, `spacing` gets squared, and the anti-clumping
   job it was believed to do is not a job at all. That is a behaviour change to `procobj-scatter.ts` (shared
   with the RUNTIME cell scatter, whose `procObjLimit = 150` is calibrated against the wrong density) plus
   `convert.ts`, and it needs its own step with a rebuild and a field verdict — **it is not part of the
   per-category work below, it is what the per-category work sits on.**

   The original evidence, kept because it is what pointed the reverse at the right question:
   - **Measured**: raising the cutoff to 3 (all candidates kept, `procObjMax` unable to bind) yields
     **15 840 objects against 15 286 — +3.6 %**. The extra two-thirds of the candidate pool is culled by
     `cullByMinDistance` alone, i.e. the cull is at its packing limit and the cutoff cannot move the count.
   - **The data**: the MINDIST column of `procobj.dat` takes exactly **four values map-wide — 50, 60, 70,
     80 — clustered by SURFACE FAMILY**, not by species (every `P_GRASS*` row is 50, every `P_SAND*` is 60).
     The number that varies per species is `spacing` (10–23 m² per object), and that is where the authored
     density lives.
   - **Our own parser already says so**: `procobj.parser.ts` documents the field as *"Vanilla draw/creation
     distance for this rule (the dat's MINDIST column)"*. Its ONLY consumer in the repo is
     `cullByMinDistance`, which uses it as an inter-object exclusion RADIUS — a 50–80 m one. The runtime
     never reads it.
   - **The field, and it is decisive about the shape** (the user, 2026-08-08): in SA the clutter stands in
     **groups** — "a rock with bushes around it, or different bush types in one spot". Objects metres apart
     are the authored look, so a 50–80 m exclusion radius between two of them is not a rule the game obeys.
     This is independent of the data analysis above and agrees with it.
   So `sjmcacti2`'s 152 → 2 is not MINDIST doing quality control; it is a view distance being applied as a
   spacing, and it is the reason this layer ships 15 286 objects where a shipping mod ships 57 583.

   **And the damage has a signature, because the cull is PER SPECIES** (`minDistByModel`): mixed clumps
   survive it — a rock with bushes around it, or two different bushes together, are exactly the cases it
   never touches. What it deletes is the SECOND instance of the SAME species anywhere within 50–80 m. So the
   defect is invisible as a missing object and visible only as a texture that never repeats nearby: the
   authored look becomes one-of-each, which goes wrong in FEEL rather than in loading — the failure mode
   [`project-goals.md`](../../../../../project-goals.md) names for misread authored data.

   ~~**A falsifiable check that needs no reverse-engineering**~~ — run 2026-08-09, and it says yes: the
   nearest-neighbour numbers above are that check. ~~**Not yet concluded**~~ — all three questions are
   answered above, and **the 3.77× target was indeed mostly the size of this defect**: at the recovered
   density the 43 converted species come to **90 906** objects, so the layer's 15 286 is **16.8 % of
   vanilla** and the aiming point taken from ProperFixes (57 583) is itself **0.63× vanilla**. "More
   procobj" is not a stretch goal above the authored data — it is most of the way back TO it. (`sjmcacti2`'s
   152 vanilla placements → **2** map-wide is the same defect seen per species.)
6. **Build-time only, deterministic.** Same seed → same scatter; the config is a build input, not a runtime slider (the runtime keeps its live preview slider, unchanged).
7. **Honest capping.** With density up, `procObjMax` and the area budgets bite sooner — log how many placements the caps drop, so raising density without raising budgets ([04](04-slot-economy-and-budgets.md)) is visibly a no-op past the cap, not a silent truncation.
8. **A per-category knob is only LOCAL below the global cap.** All categories feed one lowest-lottery cut (`convert.ts:119` sorts every surviving placement together and slices to `procObjMax`), so once that cut binds, boosting bushes **displaces** rocks and cacti rather than adding to them. Today the layer places 15 286 against 20 000, so the cut is NOT binding and the knob is local — but it is 1.31× away, which any interesting profile crosses. State which side of it a test is on — and note that this cut is OURS (`procObjMax`), not a target ceiling, so [04](04-slot-economy-and-budgets.md) moves it rather than the profile working around it.
9. **The species floor is [01](01-species-representation-floor.md)'s, and this plan owns its trigger.** Raised density is what makes the runtime cell cap start dropping whole species: measured at today's density it zeroes species in **19.8 %** of the cells that scatter anything under the full 95-rule `procobj.dat`, and **0 %** of the shipping build's (whose runtime set is 8 underwater rules — "stock" here means the unconverted rule TABLE, not a stock install). Every profile here is re-measured with `scripts/debug/procobj-species-floor.ts --stride 3`; the number to watch is *cells losing ≥1 species*, not the cap's binding rate (already 97.9 %, and meaningless alone).

## Tasks

- [x] **The global half of the cutoff knob** — `lottery < density` (default 1 = vanilla), threaded
      `convert.ts` ← generator (`--density`) ← pmb (`--procobj-density`), with `--procobj-max` and a
      `CAP DROPPED n` line so a capped run cannot pass itself off as a density. **Shipped 2026-08-08, and it
      is what falsified decision 5**: the knob works and moves almost nothing, which is the finding.
- [x] **FIRST, before any per-category work: settle what MINDIST is** (decision 5). **DONE 2026-08-09** —
      all three parts: the nearest-neighbour census confirms the signature in our own output (min 50.0 m
      same-species, 0 of 20 246 pairs below MINDIST), the pre-cull count is **1 948 374**, and the reverse
      says MINDIST is a camera radius while SPACING is a length. Rig:
      [`procobj-spacing-census.ts`](../../../../../../scripts/debug/procobj-spacing-census.ts); mechanism:
      [`gta-sa-original/procedural-objects.md`](../../../../../gta-sa-original/procedural-objects.md).
- [ ] **NEXT, and everything below is priced against it: read the two columns the way the game does.**
      `expected = area / spacing²` in `procobj-scatter.ts` (this also changes the RUNTIME cell scatter and
      what `procObjLimit = 150` means), and `cullByMinDistance` out of `convert.ts` — a step of its own,
      ending in a rebuild and a field verdict on the LOOK, because it moves the layer from 15 286 toward
      ~90 906 objects and crosses `procObjMax`, the int16 gate and the perf budgets all at once
      ([04](04-slot-economy-and-budgets.md)). Open inside it: whether to reproduce the original's
      corner-biased sampler (ours is area-uniform — a different look, and the grouping the user reports is
      partly its doing) — cheap to A/B once the density is right, and not before. The three
      `cullByMinDistance` unit tests in `convert.test.ts` go with the function; they pin what it does, not
      that it should exist.
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

**2026-08-09 — the MINDIST/SPACING reverse** (`scripts/debug/procobj-spacing-census.ts`, corpus
`game-src/original`, 95 rules, 50 935 instances, 7 019 collider groups; the whole-map pass the converter runs):

| Stage, at vanilla density | Objects |
| --- | --- |
| candidates (`area / spacing × 3`) | 5 843 322 |
| `lottery < 1` — the PRE-CULL count | **1 948 374** |
| after `cullByMinDistance` | 20 265 (1.0 % survive) |
| self-check: candidates vs `area/spacing × 3` | drift **0.00 %** |
| **what the game's own formula asks for** (`area / spacing²`) | **103 007** all rules · **90 906** the 43 converted species |

Nearest neighbour, XY metres — pre-cull: same-species min 0.0 / p05 1.6 / med 4.2, any-species 0.0 / 0.9 /
2.6. Post-cull: same-species **min 50.0** / p05 50.4 / med 58.2, any-species 0.3 / 3.9 / 10.9, and **0 of
20 246** same-species pairs below their MINDIST.

Against the shipping layer's 15 286 objects: **16.8 % of the authored density**, i.e. 5.9× short — and the
57 583-object aiming point of [density-target.md](../density-target.md) is 0.63× of it.

Two by-products of the same run, both to be carried into the tasks below:

- **17 of the 95 rules can never fire**: `p_grass_dry` (9 rules), `p_flowerbed` (6) and `p_wasteground` (2)
  have ZERO collision area map-wide, so a profile that boosts a category through one of them buys nothing.
  Controlled against `procobj-stats.ts -450 1500` before it was believed — the surfinfo→COL mapping resolves
  the other 14 surfaces correctly.
- **Grouping is a side effect of any density change.** The per-rule table in
  [`procedural-objects.md`](../../../../../gta-sa-original/procedural-objects.md) shows the same surface
  carrying a 59 %-grouped species and a 2 %-grouped one; a category multiplier moves objects per triangle,
  which is exactly what decides clump vs single. [03](03-biome-zone-density.md) has to state which of the
  two it is aiming at.

_(the rest still to record after implementation)_

- vanilla counts per category (baseline): …
- placements at density 2× bushes / 2× rocks / 2× cacti: …
- per profile: objects, permanent rows, rows/object, slots, and which wall it stops at: …
- per profile: cells losing ≥1 species (`procobj-species-floor.ts --stride 3`): …
