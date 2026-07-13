# 074·13 — Post-flip cleanup (drop the old graphics stack)

[← chain](readme.md) · prev: [10 integration](10-integration-flip.md) · runs AFTER the flip criteria pass

Once the own engine is the shipping renderer (plan 10's criteria signed off), the old stack becomes dead
weight: two renderers to maintain, a debug-flag zoo, and heavyweight dependencies. This plan deletes them.
**User decision (2026-07-12): after a successful integration the old graphics DROP — including the
three-WebGL fallback**; the shipped app's minimum requirement becomes WebGPU (this supersedes flip
criterion 4's "keep three-WebGL for non-WebGPU browsers" — revisit ONLY if usage data demands it).

**GATE (user directive 2026-07-13): the flip does NOT trigger this plan.** After the default switches to
the own engine, the three-WebGL path STAYS IN THE TREE for a comparison period — the user wants to A/B
settings and the picture side-by-side and catch anything forgotten (the old path remains reachable behind
a flag for exactly that). Deletion starts ONLY on a separate explicit user command; nothing in this plan
is "automatically next" after C1 passes.

## What drops

1. **The old graphics path** — the three-WebGL render pipeline in `packages/game`/`packages/renderware`:
   world materials (GLSL + TSL twins), post-processing chain (SMAA et al.), CSM, SSAO, the
   sky/water/grading plugins, `build-region`/`build-cell` three-object producers, InstancedMesh streaming.
   The game logic (systems, physics, zones, time) stays — it is renderer-agnostic (verified in the plan-10
   audit) and rebinds to engine entity handles (plan 08).
2. **Debug parameters** — the whole 073 flag zoo kept "for debugging until the own framework decides"
   (the standing agreement from the 073 park, readme note): `?webgpu`, `?bundle`, `?bundledebug`, `?mat04`,
   `?pool`, `?fog`, `?mesh1`, `?cellcull`, `?texfree`, `?aa`, `?dpr` + the physics-spiral HUD toggles that
   only exist to bisect three problems. Keep: the lab's engine A/B knobs (`?ao`, `?sunvis`, `?wind`,
   `?stoch`, `?hour`, …) — those debug OUR engine.
3. **Libraries**: `three` (after plan 08 replaces the last math/type usages — the "three as math lib"
   concession dies here too), `three/webgpu`, `postprocessing`, **`babylon` (the 073 spike dep)** +
   `babylon-spike.html`/`babylon-spike.ts`, the `webgpu-*` spike HTML entries and
   `apps/web/src/standalone/webgpu-*.ts`, and any three-only type shims. Measure `node_modules` and bundle
   size before/after — record the delta.
4. **Docs**: mark the 073 chain's "flags stay in-tree for debug" note as executed; open-issues that were
   WebGL-specific get re-verified against the new engine and closed or re-filed.

## Order of operations

1. Flip ships behind the capability loader; soak in the field ≥ one release cycle.
2. Delete debug flags + spike entries (small PRs, mechanical).
3. Extract the residual three math types (plan 08 supplies the replacements) → drop `three` from
   `packages/game`, then from the workspace root.
4. Delete the WebGL render path package-by-package; every deletion PR runs the full test suite + the bench
   ritual (numbers must NOT move — deletions are dead code by then).
5. Final: dependency prune (`babylon`, `postprocessing`, loaders only the old path used), bundle-size ledger.

## Tasks

- [ ] Flag-zoo deletion PR (073 disposition — the standing user agreement is discharged here).
- [ ] Spike entries deletion (babylon + webgpu-\* HTML/TS).
- [ ] three math-type extraction (blocked by plan 08's entity handles).
- [ ] WebGL render-path deletion PRs (per package, bench-gated).
- [ ] Dependency prune + before/after size ledger (node_modules, prod bundle, install time).

## Measurement ledger

_(record: bundle size before/after, node_modules before/after, removed-LOC count, test-suite time delta)_
