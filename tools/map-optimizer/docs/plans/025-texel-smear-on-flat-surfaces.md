# 025 — Texel smear on big flat surfaces: a UV broken at the model's edges

**Status: PLANNED 2026-08-11.** Field report (user): large and/or flat map objects render with "broken
textures" — long directional smears — and **the class is absent before the map-optimizer stage runs**. Four
named spots below. This plan is DIAGNOSIS-FIRST: the decisive measurement is offline and costs no rebuild and
no field round, so it comes before anyone writes a fix.

**The user's reading, and this plan follows it: it looks like a broken UV coordinate on the model's EDGES.**

## Field cases

| model | txd | position | what it looks like |
|---|---|---|---|
| `road_lawn34` | `roads_lawn` | 1124.6, -951.4, 40.9 | long smears running along the road |
| `road_lawn08` | `roads_lawn` | 1163.1, -1046.4, 32.4 | same |
| `road_lawn32` | `roads_lawn` | 1268.4, -932.8, 37.7 | same |
| `sbseabed3_las20` | `seabed` | 2901.3, -2058.4, -51.4 | vertical striping along the sand/water edge |

`lae2_roads03` was reported alongside these and is NOT part of this plan — the user withdrew it the same day
after it was matched to plan [024](./024-broken-authored-vertex-data.md)'s parked non-goal (degenerate-UV
texel smear on the `lae2_roads*` curb fan, authored SA data, byte-identical in vanilla, parked 2026-07-15).

## The constraint that shapes everything below

**The class appears on the `sa` target as well as `opensa`.** `sa` is rendered by the real game's renderer, so
no sampler, shader or filtering decision of ours is in that picture at all. Whatever is wrong is carried in
the DATA both targets share, or in a texture the tool rewrote.

The corollary matters for how the phases are ordered: any explanation that lives in
`packages/engine` is disqualified as a single cause before it is tested. That is why the mip/filtering theory
is demoted to a secondary below rather than being Phase 0 — and the user's own "at the edges" observation is
the second reason, because an isotropic minification blur is a function of viewing angle across the whole
surface and would not localize into a band along one edge.

## What was READ on 2026-08-11, and what it killed

The obvious UV-corruption mechanisms were checked against the tree the same day. **Three are falsified**, and
recording that here is the point — each one is an axis nobody has to spend a round on again.

1. **`smooth-normals` cannot destroy a UV seam. FALSIFIED.** The worry was that its position-weld
   (`weldEpsilon` 0.001) collapses two coincident vertices carrying different UVs — which is precisely what a
   UV seam IS. It does not: `emitSplitVertices`'s `resolve` is keyed on the **original vertex index**, not on
   the welded `canonId`, so two coincident originals keep separate slots and separate UVs. `canonId` is used
   only to look up the group NORMAL. The vertex count only ever grows (024 measured `lae2_roads17`
   165 → 209), and split copies take their UV from `splitSources` via `appendSplitsF32`.
2. **`weld-vertices` cannot merge vertices with different UVs. FALSIFIED.** Its key is ALL attributes —
   position, normal, `uvs`, every `extraUvs` layer, prelit and night. Two vertices differing in a UV get
   different keys by construction.
3. **`dedupe-faces` cannot drop the mirror face of a two-sided sheet. FALSIFIED.** `canonicalKey` rotates the
   corner order but preserves winding, so `(a,b,c)` and `(a,c,b)` are different keys and both survive. This
   mattered because 024 measured 22 reversed-winding twin faces on a road sheet of this family.
4. **`remapVertices` (shared by weld and prune) carries `uvs` and every `extraUvs` layer through.** Read, no
   defect found.

### What that leaves, and one thing worth naming

**A missing guard, exactly where its absence is silent.** `geometry-rebuild.ts`'s `uvLayersOf` keeps an EXTRA
UV layer only when `layer.length === vertexCount * 2` — its comment says a topology plugin that forgot to
remap a layer "drops it here rather than corrupting the Struct". **Layer 0 (`mesh.uvs`) is pushed with no such
check.** So the protection the codec advertises covers every layer except the one every model uses. This is
not evidence of a bug — no plugin read today skips the remap — but it is the shape of hazard this repo files
under "silent by nature", and if the Phase 0 diff comes back non-empty it is the first place to look.

## Hypotheses, ordered

**H-A — the UVs really do change, and the diff will say where.** The user's reading, taken at face value. The
falsifications above narrow it: whatever changes them is NOT the weld, the dedupe or the normal split. That
leaves `prune-vertices`, `degenerate-triangles`, the re-encode path, or a pass interaction none of the four
covers alone. Phase 0 settles it in one run and, if positive, names the pass in the second.

**H-B — the UVs are untouched and something else changed what the same UVs LOOK like.** The candidates, all
data-side so both targets see them: the mip chain the `--textures` pass writes into single-level TXDs (plan
[010](./010-texture-mipmaps.md)), which is what lets minification happen at all; the rebuilt normals, which
change shading rather than texturing; and the `flat`-model per-vertex AO (`bake-vertex-ao`), which bakes
occlusion onto models with a handful of vertices spanning tens of metres and Gouraud-smears one vertex's value
across the whole slab. On this branch the smear is not a texture defect at all and the word "texture" in the
report is the symptom's costume.

**H-C — engine-side filtering, secondary and cannot be the whole story.** The world sampler is trilinear with
**no `maxAnisotropy`** — a grep for it over `packages/engine/src` returns nothing, so every sampler in the
engine runs at 1. That is a real defect worth its own fix, but it is disqualified as THE cause by the `sa`
constraint above. It stays on the list only because it may be making the real defect look worse in `opensa`
than it is in `sa`, and the user's screenshots are from `opensa`.

## Phase 0 — diff the UVs offline. No rebuild, no field round

For each model in the table: resolve its source DFF exactly as the build does (the resolver in
`scripts/debug/model-repack.ts`, plan 024 Phase 0 — last mod shipping it in numeric folder order, else
vanilla), run the geometry chain in memory, and compare UVs **before vs after**, per vertex and per face.

Report per model: vertex count before/after; count of vertices whose UV changed at all and the max delta;
count of faces whose UV-triangle area changed sign or collapsed; and the same restricted to vertices on the
model's boundary edges, because that is where the user says it lives.

- **Byte-identical UVs** ⇒ H-A is dead, the tool is exonerated on this axis outright, and Phase 2 takes over.
  This is the answer plan 024's parked non-goal predicts, so it must not be treated as a surprise.
- **Any change** ⇒ H-A is alive; re-run per pass (the chain is five plugins) and the first one that moves a UV
  is the answer. Record the table here either way.

A control belongs in the same run: a model NOT in the report (any nearby building) through the same
instrument, so a non-empty diff is known to mean "this model" and not "every model".

### RAN 2026-08-11 — the chain never moves a UV, and the degenerate ones are AUTHORED

Throwaway instrument (deleted; its metric is what Phase 1 folds into the scanner): resolve the source DFF the
build way, run the five geometry plugins one at a time, and after each one compare the `position → {uv}`
associations carried by the FACE CORNERS. Positions are never moved by any pass, so a position identifies a
vertex across re-indexing.

| model | source | authored normals | verts → | uv moved | uv lost | uv-degenerate faces before → after |
|---|---|---|---|---|---|---|
| `road_lawn34` | vanilla | **NO** | 359 → 368 | **0** | 0 | **30 → 30** |
| `road_lawn08` | vanilla | **NO** | 223 → 223 | **0** | 0 | **0 → 0** |
| `road_lawn32` | vanilla | **NO** | 330 → 328 | **0** | 0 | **26 → 26** |
| `sbseabed3_las20` | vanilla | **NO** | 71 → 71 | **0** | 0 | **16 → 16** |
| `lae2_roads17` (control) | `0. Map Fixes Pack` | yes | 168 → 211 | **0** | 2 | **8 → 8** |

- **H-A is dead.** Not one UV moved, at any pass, on any model. The tool is exonerated on this axis.
- **Positive control on the instrument**: `lae2_roads17` reads **8** UV-degenerate faces — the exact number
  plan 024 recorded by hand for its parked non-goal. The metric reproduces an independently-measured value,
  which is what makes the zeros above worth believing.
- The control's `uv lost 2` is not a defect: it appears at `remove-degenerate-triangles` and is a
  zero-position-area face taking its own corner association out with it.
- **The degenerate UVs are authored and untouched** — same count in, same count out, on vanilla data.
- **And they do not explain the report**: `road_lawn08` has **zero** of them and was reported anyway. So
  degenerate UVs are a real property of this asset family but cannot be the whole cause.

### The thing the run actually turned up: all four ship NO normals, and we give them some

Every reported model carries **no authored normals** in vanilla — and `smooth-normals` runs with
`addWhereAbsent: true`, so the chain CREATES them (`road_lawn34` even splits 359 → 368 verts doing it).

Two lines in this repo already say that is dangerous, written before the report existed:

- `createWhereAbsent`'s own skip branch is commented **`// real SA must not gain normals`**.
- `run.ts` documents the flag as: *"`--no-add-normals` **if vanilla-renderer vertex lighting looks off**."*

And it reaches the real game, because `perfect-map-builder` sets `optimizerPasses: { addNormals: true }`
globally (`config.ts:75`, justified as "normals created for OpenSA's SSAO") while the `optimize` stage runs on
the COMMON build (`pipeline.ts:182`) — the `sa`/`opensa` split happens later. **One optimize run feeds both
targets, so the real game's own renderer receives world models carrying normals it never shipped.**

That fits every constraint the report puts on a cause: present on BOTH targets (it is in the shared build),
absent before this stage (nothing else creates normals), and worst on big flat objects (a road that was
prelit-only now takes a directional term across a slab with a handful of vertices). It is now **H-B1**, the
leading hypothesis, and Phase 2 tests it directly.

Owed before it is treated as fact (standing rule — recover the original's formula, do not fit one): confirm
against gta-reversed / SkyGfx **which SA building pipeline a geometry with normals selects**, and whether that
is what changes the shading of a previously prelit-only road.

## Phase 1 — if the UVs moved: find every other model it happened to

Extend `scripts/debug/scan-model-defects.ts` with the Phase 0 metric as criterion **(e)**, area-weighted and
top-N with instance positions, the shape 024's criteria were rewritten into after an un-weighted metric was
field-falsified once already. Fix the pass, add the real-asset fixture (one manifest line in
`scripts/test-fixtures.ts`), re-run the tool-kit + LOD-generator consumer sweep — `tool-kit/mesh` is shared.

## Phase 2 — NEXT: test H-B1 (created normals) on the model the field named

Phase 0 settled that the UVs did not move, so this phase now owns the case. One variable at a time on
`road_lawn34`, each arm sharing a viewpoint (a spawned player SLIDES on a slope, and three arms once returned
the same diff because the diff was measuring the camera):

1. **normals not created** — `model-repack.ts` already runs the chain per model with per-pass options; the arm
   is `addWhereAbsent: false` on the target model only. If the smear goes, H-B1 is confirmed on the data side
   without touching the rest of the map. **This is the cheapest arm and the one the evidence points at.**
2. **prelit off** (`debugPrelitScale = 0`, already in `apps/viewer`) — if the smear survives, every
   vertex-colour mechanism including `bake-vertex-ao` is dead.
3. **`--no-textures`** — the mip chain suppressed, geometry untouched. Data-side, so it is testable on BOTH
   targets, which is what makes it worth more than any engine toggle here.

A zero from any arm counts only if the loop is first shown to REPRODUCE the smear with everything on.

**The `sa` arm matters more than the `opensa` one here**, because the report's whole weight is that the class
survives into the real game's renderer — and that is the half no engine change of ours can reach.

## Phase 3 — decide where the fix lives, once a phase has named it

- **Tool bug** ⇒ fixed here, with the fixture and the sweep.
- **Authored data** ⇒ the user has parked this class once already, so re-opening it is his call, and any
  repair pass touches only faces the asset's own numbers condemn (no per-model lists), with the
  `docs/contracts/` + `docs/hacks/` treatment on the way in.
- **Engine filtering** ⇒ `maxAnisotropy` is its own small plan under `docs/plans/`, with the bench ritual,
  because anisotropic sampling has a real per-sample cost and performance is part of a feature's spec. Not a
  substitute for whatever Phase 0/2 finds — at most a second, separate improvement.
- Whichever way it goes, `--textures` is NOT the thing to switch off: it exists because single-level DXT
  shimmers at distance and WebGL cannot generate those mips at runtime.

## Phase 4 — field AFTER round and the record

Re-shoot the four spots, before/after per spot, into this plan, on BOTH targets since both show the class.
Anything perf-visible into `docs/benchmarks/` naming the pak build the run read. If the outcome is "the
original does this too", that goes to `docs/edge-cases/` with the measurement and a one-line rule in
`docs/restrictions/`.

## Non-goals

- Re-opening plan 024's families A (authored normals shading dark) and B (prelit black holes) — diagnosed,
  and B's fix is already an engine plan (`docs/plans/093-world-ambient-term/`).
- `lae2_roads03` / the `lae2_roads*` curb fan — withdrawn by the user, see above.
- Turning the mip pass off as a "fix". It would trade a blur for the shimmer it was built to remove.
- Reshaping authored UVs by default. A mod author's data has to keep working.
