# Procedural ground clutter (procobj, plan 042)

`packages/renderware/src/parsers/text/procobj.parser.ts`, `surfinfo.parser.ts`,
`packages/renderware/src/map/procobj-*.ts`, `build-procobj.ts`, adapter integration, debug ProcObj
screen.

## Implemented

- `procobj.dat` parsing (~95 rules, 18 `P_*` surfaces, 14 columns) and `surfinfo.dat` surface
  table (**row order = COL material id**, 179 rows; the `P_*` rows ARE the procobj surface
  names — no extra mapping).
- Deterministic per-cell scatter over collision faces: mulberry32 seeded by cell coords; world
  triangles from COL verts × placement matrices; area-weighted counts; sqrt-warped barycentric
  points; rule ranges for rotation/scaleXY/scaleZ/z-offset; face normal kept (align), flipped
  up when winding points down (upside-down-bushes fix).
- **`procobj.dat`'s columns are spent the way the game spends them** (corrected 2026-08-09, and it was worth
  5.9× the clutter): SPACING is a LENGTH, so the count per face is `area / spacing²`, and MINDIST is a
  distance to the CAMERA, never between two objects. Nothing culls by inter-object distance — the triangle IS
  the group, which is why authored clutter reads as clumps in some places and singles in others
  ([`gta-sa-original/procedural-objects.md`](../gta-sa-original/procedural-objects.md)).
- **Lottery mechanism**: 3× vanilla candidates with `lottery ∈ [0,3)`, sorted → live density
  slider = instance-count cutoff, no cell rebuild. The headroom is a PARAMETER since 2026-08-09
  (`scatterProcObjects(…, maxDensity)`, default 3), so a build-time cutoff above 3 is reachable — at the price
  of re-rolling the scatter from the second collision face on (each face consumes draws in proportion to its
  candidate count).
- **A scatter batch is one model on ONE SURFACE** (2026-08-09). `procobj.dat` keys its rules by surface+model
  and 19 of its 56 models appear on several surfaces, so a batch keyed by model alone took the category of
  whichever surface the collision walk reached first — six `p_rubble*` were mis-categorised, which mattered
  because category drives draw distance. See
  [`gta-sa-original/procedural-objects.md`](../gta-sa-original/procedural-objects.md).
- **Build-time density is a PROFILE, not one number** (2026-08-09, lod-procobj plan 010):
  `lottery < densityFor(category, surface)` — category-on-a-surface beats category beats base beats the
  authored density, default 1.0 everywhere so the scatter is unchanged. `tools/map-placement/src/procobj/
  density.ts`; the converter reports per-category `generated / objects / dropped-by-cap`. A bad entry throws
  naming its key. **No shipped profile yet** — it waits on the `opensa` perf budget (plan 013).
- Semantic categories (grass/flowers/bushes/cacti/trees/rocks/underwater; sea floor overrides
  to underwater) with per-category `{enabled, drawDistance, density}` in `graphics.procobj` +
  debug **ProcObj** screen.
- **One `procObjLimit` (default 150/cell)** caps BOTH rendering and collision via the cell-wide
  lottery threshold; vanilla pools at ~300 for the same physics-cost reason. **Its value is unowned since
  the 2026-08-09 column fix** — the candidate pool it rations shrank ~19×, so it binds far less often and the
  number was calibrated against a density that no longer exists.
- Collision = rendered set ∩ models that ship a COL (rocks/cacti/trees collide; grass/flowers
  walk-through); knob changes re-stream physics (debounced invalidate + reload).
- Wind mod's `decoratePart` runs on clutter parts (procedural bushes sway when listed).
- Clutter is pickable through the engine Map screen (`CellStore.pick` over the placement mapper, plan
  074/22). Offline sanity tool: `scripts/debug/procobj-stats.ts`.

## Known gaps / candidates

- `useGrid` column unimplemented (no vanilla rule uses it).
- Vanilla's create-around-camera MINDIST behaviour intentionally replaced by per-category
  drawDistance + per-cell budget.
- Density defaults left at 1 (authored). Since the column fix that IS the authored density: the build-time
  layer places 91 092 objects against 15 286 before. Shaping it per category/surface/biome is
  [`lod-procobj-generator/010`–`012`](../../tools/lod-procobj-generator/docs/plans/010-density-model.md);
  the perf budget that should own `procObjLimit` and `procObjMax` is
  [`013`](../../tools/lod-procobj-generator/docs/plans/013-density-budgets-per-target.md).

## Test coverage anchors

`procobj.parser.test.ts` (incl. shipped-file invariants), `procobj-scatter.test.ts`
(determinism, counts, normal flip, lottery cap), `procobj-runtime.test.ts`,
`procobj-colliders.test.ts`, `build-procobj.test.ts`.
