# B1 — Procobj density model (build-time, configurable)

Part of [07 — LOD generators, extended](../readme.md), Part B. The foundation for "more procobj": turn density from a hardcoded vanilla constant into a configurable, per-category/per-surface model. Depends on nothing to BUILD, but shipping raised density needs [B3](b3-budget-lift-integration.md)'s budget lift (Task 3).

## Context

Procobj scatter (`packages/renderware/src/map/procobj-scatter.ts`, reused at build time by `map-placement/src/procobj/convert.ts`):

- candidate count `expected = area / rule.spacing × PROC_OBJ_MAX_DENSITY` (`PROC_OBJ_MAX_DENSITY = 3`); each placement gets `lottery = random × density`.
- **build-time density is hardcoded**: `convert.ts` keeps `placement.lottery < 1` — pure vanilla density — then MINDIST-thins per species and caps to `procObjMax = 20000`.
- Category is already derived per placement: `procObjCategory(model, surface) → bushes/cacti/flowers/grass/rocks/trees` (`procobj-categories.ts`). Surface name is available (`surfinfo.dat`).

So the machinery to place 3× vanilla already exists (candidates are generated at `MAX_DENSITY`); the build just throws most away at `lottery < 1`. Raising density is mostly "raise the cutoff", but doing it uniformly would over-scatter everything — the point is CONTROL (denser bushes, not denser everything).

### Which number is "the 300"

Asked for as "a multiplier, or change 300 to another number" — worth naming precisely, because there are four caps and they are not interchangeable:

| Knob | Where | Meaning |
| ---- | ----- | ------- |
| `lottery < 1` | `map-placement/src/procobj/convert.ts` | the build-time density cutoff — **this is the multiplier this plan makes configurable** |
| `PROC_OBJ_MAX_DENSITY = 3` | `procobj-scatter.ts` | how many CANDIDATES are generated at all; a cutoff above 3 needs this raised too |
| `procObjMax = 20000` | `lod-procobj-generator/config.ts` | global safety cap on placed objects |
| `procObjLimit` (~300, vanilla `CProcObjectMan`) | the OpenSA runtime adapter, per cell | a runtime preview/perf cap, **not** a build knob |

The multiplier belongs on the first two. The per-cell ~300 is the engine's own budget and is a different lever; it is also the site of the fairness defect in [B4](b4-species-representation.md) — raising either cap without B4 changes how many objects survive but not WHICH species do.

## Decisions

1. **Density cutoff becomes configurable, per category and per surface.** Replace the literal `lottery < 1` with `lottery < densityFor(category, surface)` — a config table (default all-1.0 = today's vanilla). `densityFor > 1` (up to `PROC_OBJ_MAX_DENSITY`) keeps more candidates for that category/surface; `< 1` thins. Raising past `PROC_OBJ_MAX_DENSITY` means generating more candidates too (raise the density ceiling) — B1 exposes both knobs.
2. **Category is the primary control axis** (the user's framing: forest→bushes, mountain→rocks, desert→cacti maps to categories bushes/rocks/cacti). Surface is the secondary axis (a category can be denser on some surfaces). Zone/biome is B2.
3. **MINDIST stays the quality guard.** Denser candidates still pass through `cullByMinDistance` per species — density raises the ceiling, MINDIST prevents visual clumping/z-fighting. So "more" never means "piled on top of each other".
4. **Build-time only, deterministic.** Same seed → same scatter (existing determinism preserved); the config is a build input, not a runtime slider (the runtime already has a live density slider for preview — unchanged).
5. **Honest capping.** With density up, `procObjMax` and the area budgets bite sooner — B1 surfaces (logs) how many placements the caps drop, so raising density without raising budgets (B3) is visibly a no-op past the cap, not a silent truncation.

## Tasks

- [ ] `convert.ts`: replace `lottery < 1` with `lottery < densityFor(category, surface)`; category is already on the placement, thread surface through. Config type `ProcObjDensityConfig` (per-category and per-category×surface overrides), default = all 1.0.
- [ ] Density ceiling knob: allow raising the candidate-generation multiplier (`PROC_OBJ_MAX_DENSITY` equivalent) via config when a category wants density > 3; keep 3 as default.
- [ ] Logging: per-category placed vs generated vs dropped-by-cap counts (so B3's budget interplay is visible).
- [ ] Unit tests: density 1.0 reproduces today's counts (regression); density 2.0 for `bushes` ~doubles bush placements and leaves other categories unchanged; MINDIST still enforced.
- [ ] Wire the config through lod-procobj-generator (`config.ts`) and pmb.

## Verification

- Density 1.0 → byte/count-identical to today's scatter (regression fixture).
- Per-category multiplier changes only that category's count; MINDIST spacing preserved (no overlaps).
- Cap-drop counts logged when density exceeds the current budgets (sets up B3).

## Measurements / notes

_(record after implementation)_

- vanilla counts per category (baseline): …
- placements at density 2× bushes / 2× rocks / 2× cacti: …
