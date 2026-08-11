# 025 — Texel smear on big flat surfaces: minification without anisotropy, and UV-degenerate faces

**Status: PLANNED 2026-08-11.** Field report (user): large and/or flat map objects render with "broken
textures" — long directional smears and blurred wedges — and **the class is absent before the map-optimizer
stage runs**. Four named spots below. This plan is a DIAGNOSIS-FIRST chain: the leading explanation says the
optimizer corrupts nothing, and the whole point of Phase 0 is to try to kill that explanation cheaply before
anyone writes a fix.

The report also came with two observations that are evidence, not colour: **the same class is visible in real
GTA:SA** (user screenshot of vanilla, road surface, same smear), and one case (`sbseabed3_las20`) the user
himself flagged as "maybe it is like that in the original too".

## Field cases

| model | txd | position | what it looks like |
|---|---|---|---|
| `road_lawn34` | `roads_lawn` | 1124.6, -951.4, 40.9 | long smears running along the road |
| `road_lawn08` | `roads_lawn` | 1163.1, -1046.4, 32.4 | same |
| `road_lawn32` | `roads_lawn` | 1268.4, -932.8, 37.7 | same |
| `sbseabed3_las20` | `seabed` | 2901.3, -2058.4, -51.4 | vertical striping along the sand/water edge |
| `lae2_roads03` | `lae2roadshub` | 2316.0, -1741.3, 12.4 | blurred wedges on the roundabout fan, hard triangle-edge boundaries |

`lae2_roads03` is filed here as a SEPARATE symptom on purpose (see H2) — it is the sibling of a case this
repo has already diagnosed and parked.

## What is already known, and what is only supposed

Everything in this section headed **READ** is a fact checked against the tree on 2026-08-11. Everything under
**SUPPOSED** is a hypothesis with a named way to kill it. Plan 024's three-plans-were-wrong lesson applies
directly: a premise about what is BROKEN is as untrusted as a premise about code.

### READ

1. **The mip pass runs on every build.** `DEFAULT_PASSES.textures = true` (`src/run.ts`), and
   `perfect-map-builder` passes only `{ addNormals: true }` (`tools/perfect-map-builder/src/config.ts`), so
   nothing turns it off. Plan [010](./010-texture-mipmaps.md): a TXD texture that ships **one level** and is
   power-of-two gets a **full generated mip chain** written back into the native TXD; already-mipped, NPOT and
   unknown-format textures are skipped and reported.
2. **The chain survives into the engine.** `opensa-pack` carries the TXD's levels into the world texture
   arrays — `model-textures.ts` says in as many words that dropping them is "fatal for a map object", because
   95 % of the modded map's textures ship one.
3. **The engine's world sampler is trilinear with anisotropy 1.** `packages/engine/src/world/textures.ts`
   creates it with `repeat` / `magFilter` / `minFilter` / `mipmapFilter: 'linear'` and **no `maxAnisotropy`**.
   A grep for `maxAnisotropy` over `packages/engine/src` returns **nothing at all** — no sampler in the engine
   sets it, so every one of them runs at 1.
4. **No pass in this tool looks at UV area.** `remove-degenerate-triangles` judges a face by its POSITION
   cross-product (`≥ 1e-6`). A face with healthy positions and a collapsed UV triangle passes every stage
   untouched, and nothing counts it.
5. **This repo has already met a UV-degenerate texel smear, on this exact asset family.** Plan
   [024](./024-broken-authored-vertex-data.md), Non-goals: *"The 8 degenerate-UV texel-smear faces on
   roads17's fan (authored SA data, byte-identical in vanilla, PARKED by the user 2026-07-15)."*
   `lae2_roads03` (txd `lae2roadshub`, 2316.0, -1741.3) and `lae2_roads17` (txd `lae2roads`, 2342.7, -1682.7)
   are different models — but they are the same road set, ~65 u apart, and the parked note describes a
   curb-corner FAN, which is what the new screenshot shows. Same suspected class, not the same asset.

### SUPPOSED

**H1 — minification became possible, and the engine does it isotropically.** Before the `--textures` pass a
vanilla TXD carries ONE level, so `mipmapFilter: 'linear'` has nothing to blend and every fragment samples
level 0: sharp, and aliased. After the pass there is a chain, minification finally happens, and with
anisotropy 1 a large flat surface at a grazing angle drops several levels at once and turns into a directional
blur. On this reading the optimizer did not break the textures — it switched on filtering the engine then
performs badly, and the artefact is a MISSING ENGINE FEATURE surfaced by a correct tool.

It explains every part of the report without strain: why it is the big and the flat objects (they are the ones
seen at grazing angles across many texels), why it appears strictly at this stage (nothing else in the
pipeline changes what mip selection can do), and why **the same class is visible in vanilla SA** — the
original mips too, and its own filtering is no better.

*Predictions, i.e. how to kill it:* the smear must weaken sharply when the camera looks straight DOWN at the
same surface, must be untouched by every geometry pass, and must vanish when the sampler is given anisotropy.

**H2 — UV-degenerate faces, authored.** A face whose UV triangle has ~zero area while its positions are
healthy gives the GPU an exploding UV derivative; it clamps to the smallest mip and smears one texel across
the face. That produces exactly a wedge with a hard straight boundary, because the boundary IS a triangle
edge. READ 5 says this class is present, authored, and byte-identical in vanilla on this very fan.

*Predictions:* the affected faces are findable OFFLINE in the source DFF, their count is **identical before
and after** the optimizer chain, and the wedge boundaries in the screenshot line up with triangle edges.

**H3 — per-vertex AO on flat models.** `bake-vertex-ao` runs only on models whose prelit verdict is `flat`,
which is close to the population in the report, and it bakes occlusion PER VERTEX. On a road slab with a
handful of vertices spanning tens of metres, one vertex's occlusion Gouraud-smears across the whole surface,
and the median normalization means a model gets both darker and brighter regions. This is a plausible source
of broad soft banding on exactly these assets.

*Prediction, and it is a one-toggle discriminator:* if the smear survives with prelit switched OFF, H3 is
dead — no vertex-colour mechanism can paint anything then.

H1 and H2 are not exclusive, and H1 makes H2 far worse: a degenerate-UV face had nowhere to fall before the
chain existed.

## Phase 0 — split the hypothesis space before touching anything

Three cheap discriminators, none of which needs a pak rebuild. Run all three on `road_lawn34` and
`lae2_roads03`, record the answers here.

1. **Prelit off** — `apps/viewer`'s object/compare tab already exposes `debugPrelitScale = 0` and
   `debugUnlit`. If the smear survives, H3 is dead and the cause is texture-space.
2. **Before vs after, same model, same camera** — the compare server already serves both trees:
   `npx tsx tools/map-optimizer/src/compare-serve.ts --before ./game-src/original --after ./build/original/opensa`.
   This is the only arm that shows what the stage actually did to THAT model.
3. **Anisotropy** — set `maxAnisotropy: 16` on the world sampler in a scratch build and look at the same
   three road spots. This is an engine one-liner and needs no content rebuild at all, which makes it the
   cheapest decisive test in the plan.

Two rig rules this chain has paid for before: the arms must share a viewpoint (a spawned player SLIDES on a
slope, and three arms once returned the same diff because the diff was measuring the camera), and each capture
must state what it was configured with.

**Expected split:** if (3) restores the roads, H1 carries the bulk and the fix is not in this tool.

## Phase 1 — offline UV-degeneracy scan, with the before/after control that decides ownership

Extend `scripts/debug/scan-model-defects.ts` (plan 024 Phase 1, criteria are its documented extension point)
with criterion **(e) UV-degenerate faces**: UV-triangle area below eps while position area is healthy.
Area-weighted and top-N with instance positions, exactly as the 024 criteria were rewritten to be — the
un-weighted version of a metric has already been falsified once in this chain (686 grass cards ≠ 22 slabs).

**The control is the point of the phase**: run it on each model BOTH from the resolved source DFF and from the
output of the geometry chain.

- **Counts identical** ⇒ the optimizer is exonerated on this axis; the UVs are authored, and what changed is
  only that a mip chain now exists for them to fall through. The fix is H1's, and any data repair is a
  separate decision the user has already taken once (parked, 2026-07-15).
- **Counts differ** ⇒ we made them, this is a real bug in this tool, and the diff names the pass.

Record the top-N table here, and say explicitly which of the two answers came back.

## Phase 2 — negative control on the pass itself

`--no-textures` exists on the pmb CLI precisely to bisect this. But a full rebuild is the expensive way: plan
024's `scripts/debug/model-repack.ts` swaps one model's cells into the built game in ~10 s, so run
`road_lawn34` through it with the mip chain suppressed and look at the same spot.

If the smear disappears with the geometry untouched, the mip chain is the trigger and H1 is confirmed on the
content side. If it does not, H1 is dead and Phase 1's answer owns the case.

A count of zero here is only evidence if the instrument could have printed non-zero — so the same lab loop
must first be shown to REPRODUCE the smear with the pass on.

## Phase 3 — decide where the fix lives, once the phases above have named it

- **If H1.** The fix is `maxAnisotropy` on the world sampler, and it is ENGINE scope, not this tool's — it
  gets its own small plan under `docs/plans/`, because anisotropic filtering has a real per-sample cost and
  the standing rule is that performance is part of a feature's specification. Bench ritual before/after, the
  numbers into `docs/benchmarks/`. If the cost turns out not to be affordable, the lever and its price go to
  `docs/performance/deferred-optimizations/` rather than being silently dropped.
  Whatever is decided, `--textures` is NOT the thing to turn off: it exists because single-level DXT shimmers
  at distance and WebGL cannot generate those mips at runtime (plan 010).
- **If H2 and the UVs are authored.** The user has parked this exact class once already, so re-opening it is
  his call and not a default. If it is re-opened, the shape is a repair pass that touches ONLY faces whose UV
  area is ~0 while their positions are healthy — derived from the asset, no per-model list — and it is a
  change to a mod author's data, so it needs the `docs/contracts/` and `docs/hacks/` treatment on the way in.
- **If H2 and the UVs are ours.** A bug, fixed in the pass Phase 1's diff names, with the real-asset fixture
  pattern 024 established (one manifest line in `scripts/test-fixtures.ts`).
- **If H3.** `bake-vertex-ao` needs a resolution gate: per-vertex occlusion is meaningless on a face whose
  vertices are tens of metres apart, and the honest rule derives from the asset — vertex spacing against the
  AO `maxDistance` (25 u) — not from a model name.

## Phase 4 — field AFTER round and the record

Re-shoot the five spots in the table, before/after per spot, into this plan. Anything perf-visible into
`docs/benchmarks/` per its schema, naming the pak build the run read. If the outcome is "this is what the
original does and we now do it better/worse", that sentence belongs in `docs/edge-cases/` with the
measurement and a one-line rule in `docs/restrictions/`.

## Non-goals

- Re-opening plan 024's families A (authored normals shading dark) and B (prelit black holes) — both are
  diagnosed, and B's fix is already an engine plan (`docs/plans/093-world-ambient-term/`). If a Phase 0 arm
  shows one of them is what the user is actually looking at, this plan closes and points there instead.
- Turning the mip pass off as a "fix". It would trade a blur for the shimmer it was built to remove.
- Reshaping authored UVs by default. A mod author's data has to keep working; a repair pass, if it ever
  lands, is opt-in and recorded.
