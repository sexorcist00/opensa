# 010 — Procobj density model (build-time, configurable, PER TARGET)

> **UNBUILT.** Moved here 2026-08-09 from the roadmap chain `07-lod-generators-extended/02`, which was dissolved into the tools it touches — see
> [roadmap 0.5.0](../../../../docs/roadmap/0.5.0/readme.md) for what the chain was and what shipped out of it.


Turn density from one hardcoded constant into a
configurable, per-category/per-surface model.

> **The baseline this plan sits on changed under it, and the change SHIPPED (2026-08-09).** The plan's first
> task turned out to be a bug fix, not a density feature: both numeric columns of `procobj.dat` were being
> read the way the file's header describes them rather than the way the game spends them. That step is done,
> field-accepted, and its record moved to the tool —
> [`lod-procobj-generator/009`](009-procobj-dat-columns-as-the-game-reads-them.md).
> **What it means for everything below:** the layer now places **91 092** objects at *vanilla* density, not
> 15 286, so every multiplier this chain ever quoted against 15 286 was a multiplier against a defect —
> including [density-target.md](../density-target.md)'s 3.77×, whose 57 583-object aiming point is itself
> **0.63× vanilla**. "More procobj" is no longer the goal; **shaping** it is, and that is this plan.

## The two targets, and what each can actually take

| Target | What it is | The wall that binds first | Density it reaches |
| --- | --- | --- | --- |
| **`sa/`** | the real game as we ship to it: OLA (`EntitiesPerIpl` / `EntityIpl` = `unlimited`, `Buildings = 100000`) + FLA (its whole `[IPL]` section disabled) + **`perfect-map.asi`** | **int16** `IplDef` building indexes — the ONE ceiling OLA leaves stock — until our asi applies; then memory and frame time | vanilla density already crosses int16 (see below) |
| **`opensa/`** | our own engine, own formats, own streaming | **nothing SA has** — no slot array, no `LoadScene` per-file buffer, no int16. Memory and frame time, plus the per-cell `procObjLimit` | vanilla ships today; the perf budget is [04](013-density-budgets-per-target.md)'s |

Sources: [density-target.md](../density-target.md) for the row/slot arithmetic (its MULTIPLIERS are stale —
read the banner there), [`gta-sa-original/reference-install.md`](../../../../docs/gta-sa-original/reference-install.md)
for what the target install lifts, [`restrictions/sa-target.md`](../../../../docs/restrictions/sa-target.md)
for why `opensa/` is a separate representation rather than a mode of `sa/`.

**int16 is now crossed by the DATA, not by a profile.** At vanilla density the layer costs 25 560 permanent
text rows; with stock's 12 629 that is **≈ 38 189 map-wide against a 32 767 ceiling**. `checkTextIplBudgets`
is `sa/`-only, so `--exclude sa` builds and every opensa field run are unaffected — but a full build
including `sa/` throws today, correctly, naming the number. **That is decision 3's profile gate arriving by
accident**, and turning it into a declared per-target profile is [04](013-density-budgets-per-target.md)'s.

**And a build that lands on a stock install is a build nobody guarded.** Not a target is not the same as not
a failure mode: someone will install this over a plain 1.0. The honest form is a build-time REPORT — "this
build needs OLA and perfect-map.asi; on stock it corrupts" — plus the installer's presence check
([04](013-density-budgets-per-target.md) decision 6), not a cap that rations the target we do ship to.

## Context

Procobj scatter (`packages/renderware/src/map/procobj-scatter.ts`, reused at build time by
`map-placement/src/procobj/convert.ts`):

- candidate count `expected = area / spacing² × PROC_OBJ_MAX_DENSITY` (`PROC_OBJ_MAX_DENSITY = 3`); each
  placement gets `lottery = random() × PROC_OBJ_MAX_DENSITY` — **uniform, with no per-species term** (a
  species' density is its `spacing`, already spent above).
- build-time density is the `--procobj-density` cutoff, `placement.lottery < density` (**1 = vanilla**), then
  a global lowest-lottery slice to `procObjMax` (100 000 — clearance, not a budget).
- category is already derived per placement: `procObjCategory(model, surface) →
  bushes/cacti/flowers/grass/rocks/trees` (`procobj-categories.ts`). Surface name is available
  (`surfinfo.dat`).

So the machinery to scale density exists; what does not exist is CONTROL — denser bushes, not denser
everything.

### Which number is "the 300"

Four caps, and they are not interchangeable:

| Knob | Where | Meaning | Per target? |
| ---- | ----- | ------- | --- |
| `lottery < density` | `map-placement/src/procobj/convert.ts` | the build-time density cutoff — **this is what this plan makes per-category** | **yes** — it IS the profile |
| `PROC_OBJ_MAX_DENSITY = 3` | `procobj-scatter.ts` | how many CANDIDATES are generated at all; a cutoff above 3 needs this raised too | **yes** |
| `procObjMax = 100000` | `lod-procobj-generator/config.ts` | global safety cap on placed objects | **yes** ([04](013-density-budgets-per-target.md) sets the real one) |
| `procObjLimit` (150 in `engine-canvas-host`) | the OpenSA runtime adapter, per cell | a runtime render/collide budget, **not** a build knob. The 2026-08-09 fix shrank the candidate pool ~19×, so it binds far less often and its value is now unowned rather than tuned | `opensa/` only |

## Decisions

1. **Density cutoff becomes configurable, per category and per surface.** Replace the global
   `lottery < density` with `lottery < densityFor(category, surface)` — a config table (default all-1.0 =
   the authored density). `densityFor > 1` keeps more candidates for that category/surface; `< 1` thins.
2. ~~**The MACHINERY is target-independent; the PROFILE is per target.**~~ **STRUCK 2026-08-09 (the user's
   call): `sa` ships the SAME density as `opensa`.** There is ONE profile, not two, and density stops being a
   per-target axis at all. What survives of the split is per-target CAPS and reporting, not per-target
   content — the two hosts render the same world or they are not the same game.
3. ~~**Every profile declares its target, its cost and its GATE, and the build refuses a mismatch.**~~
   **Collapsed by decision 2.** With one density the `sa` target crosses int16 on EVERY build by
   construction (measured on the built tree: **39 219** permanent rows against 32 767), so "does this profile
   need `perfect-map.asi`" has one answer, always yes. A per-profile gate would be a guard over a constant.
   What replaces it is a real check of the real dependency — the build SHIPS the asi
   ([asi/perfect-map 006](../../../../asi/perfect-map/docs/plans/006-pipeline-integration.md)) and the int16
   throw becomes a warning. **That moves 006 onto the critical path**: it is now what makes an `sa` build
   shippable at all, not an integration nicety.
4. **Category is the primary control axis** (forest→bushes, mountain→rocks, desert→cacti maps to categories
   bushes/rocks/cacti). Surface is the secondary axis. Zone/biome is [03](011-biome-zone-density.md).
5. **A density multiplier changes GROUPING as a side effect, and that is not a bug to design out.** Objects
   are rolled per collision triangle, so a count per triangle IS what decides clump-vs-single; nothing in the
   original prevents clumping. Measured per rule (`procedural-objects.md`): on the SAME surface
   `sand_combush02` puts **59 %** of its objects on a face carrying ≥2 of itself while `sand_josh1` puts
   **2 %**, and 85–97 % of everything stands on a face that also carries another species. **The species' own
   `spacing` decides the look, not the biome** — a warning [03](011-biome-zone-density.md) has to answer.
6. **Build-time only, deterministic.** Same seed → same scatter; the config is a build input, not a runtime
   slider (the runtime keeps its live preview slider, unchanged).
7. **Honest capping.** `procObjMax` and the area budgets bite sooner as density rises — log how many
   placements the caps drop (`CAP DROPPED n`), so raising density without raising budgets is visibly a no-op
   past the cap rather than a silent truncation.
8. **A per-category knob is only LOCAL below the global cap.** All categories feed one lowest-lottery cut
   (`convert.ts` sorts every surviving placement together and slices to `procObjMax`), so once that cut binds,
   boosting bushes **displaces** rocks and cacti rather than adding to them. At 91 092 against 100 000 the
   cut is 1.10× away — any interesting profile crosses it, so state which side of it a test is on.
9. **The species floor is [01](012-species-representation-floor.md)'s, and this plan owns its trigger.** The
   2026-08-09 fix cuts both ways: far fewer candidates per cell (the cap binds less), but the surviving
   placements now CLUMP (the cap, when it binds, drops a clump). **01's 19.8 % measurement predates the fix
   and has to be re-taken** with `scripts/debug/procobj-species-floor.ts --stride 3`; the number to watch is
   *cells losing ≥1 species*, not the cap's binding rate.

## Tasks

- [x] **The global half of the cutoff knob** — `lottery < density` (default 1 = vanilla), threaded
      `convert.ts` ← generator (`--density`) ← pmb (`--procobj-density`), with `--procobj-max` and a
      `CAP DROPPED n` line. **Shipped 2026-08-08, and it is what falsified the old decision 5**: the knob
      worked and moved almost nothing, which is the finding that started the reverse.
- [x] **Read the two columns the way the game does.** **SHIPPED 2026-08-09, field-accepted** — moved to
      [`lod-procobj-generator/009`](009-procobj-dat-columns-as-the-game-reads-them.md)
      with every measurement (census, built layer, on-disk size, the nine-scene sweep).
- [ ] `convert.ts`: replace the global `lottery < density` with `lottery < densityFor(category, surface)`;
      category is already on the placement, thread surface through. Config type `ProcObjDensityConfig`
      (per-category and per-category×surface overrides), default = all 1.0.
- [ ] Candidate-ceiling knob: allow raising `PROC_OBJ_MAX_DENSITY` via config when a category wants density
      > 3; keep 3 as default. A cutoff above 3 has no candidates to keep.
- [ ] **ONE shipped profile, priced before it is written** (decision 2, 2026-08-09): both targets get it.
      It is perf-bounded by [013](013-density-budgets-per-target.md)'s `opensa` measurement; until that
      number exists the profile does not exist rather than being guessed. The 1.0 default stays as the
      regression baseline.
- [~] ~~The mismatch guard of decision 3~~ — **struck with decision 3.** One density means one answer to
      "does this need the asi", so the guard would test a constant. Its job passes to
      [asi/perfect-map 006](../../../../asi/perfect-map/docs/plans/006-pipeline-integration.md): ship the asi
      from the build, then downgrade the int16 throw to a warning that names it.
- [ ] Logging: per-category placed vs generated vs dropped-by-cap counts, plus the permanent-row cost per
      object — which every profile changes, and not in proportion to the object count (measured: 5.96× the
      objects bought 3.94× the rows).
- [ ] Unit tests: density 1.0 reproduces today's counts (regression); density 2.0 for `bushes` ~doubles bush
      placements and leaves other categories unchanged **with the global cap slack** (decision 8 — a fixture
      that crosses `procObjMax` must assert the displacement instead, or it asserts the wrong thing).
- [ ] Wire the config through lod-procobj-generator (`config.ts`) and pmb. **Not keyed by target** — the
      density is one value for both hosts; the target still picks caps and reporting.
- [ ] **A/B the corner-biased sampler.** The original pulls placements toward a triangle's first vertex
      (`offset1 = rand()`, `offset2 = offset1 × rand()`); ours is area-uniform. A difference in the LOOK,
      cheap to test now that the density is right — and it interacts with decision 5's grouping.

## Verification

- Density 1.0 → count-identical to today's scatter (regression fixture), on every target.
- Per-category multiplier changes only that category's count below the global cut.
- A profile that breaches its target's wall fails at config time, naming the wall and the number — never at
  the guard, never in-game.
- Cap-drop counts and rows-per-object logged for every profile (sets up 04).
- `procobj-species-floor.ts` re-run per profile; any rise in *cells losing ≥1 species* hands the plan to
  [01](012-species-representation-floor.md).

## Measurements / notes

The 2026-08-09 reverse and fix, with all their numbers, live in
[`lod-procobj-generator/009`](009-procobj-dat-columns-as-the-game-reads-them.md).
Two by-products of that work belong to the tasks above rather than to the fix, so they are kept here:

- **17 of the 95 rules can never fire**: `p_grass_dry` (9 rules), `p_flowerbed` (6) and `p_wasteground` (2)
  have ZERO collision area map-wide, so a profile that boosts a category through one of them buys nothing.
  Controlled against `procobj-stats.ts -450 1500` before it was believed — the surfinfo→COL mapping resolves
  the other 14 surfaces correctly.
- **The per-rule grouping table** (decision 5) is in
  [`gta-sa-original/procedural-objects.md`](../../../../docs/gta-sa-original/procedural-objects.md) — the input
  [03](011-biome-zone-density.md) needs before it picks a biome multiplier.

_(still to record, per profile)_

- vanilla counts per category (baseline): …
- placements at 2× bushes / 2× rocks / 2× cacti, and which side of `procObjMax` the test sat on: …
- per profile: objects, permanent rows, rows/object, and which wall it stops at: …
- per profile: cells losing ≥1 species (`procobj-species-floor.ts --stride 3`), re-taken after the fix: …
