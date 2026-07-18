# 074·13 — Post-flip cleanup (drop the old graphics stack)

[← chain](readme.md) · prev: [10 integration](10-integration-flip.md) · gate:
[the flip decision](10-flip-decision.md) — **PASSED 2026-07-18**

Once the own engine is the shipping renderer (plan 10's criteria signed off), the old stack becomes dead
weight: two renderers to maintain, a debug-flag zoo, and heavyweight dependencies. This plan deletes them.
**User decision (2026-07-12): after a successful integration the old graphics DROP — including the
three-WebGL fallback**; the shipped app's minimum requirement becomes WebGPU (this supersedes flip
criterion 4's "keep three-WebGL for non-WebGPU browsers" — revisit ONLY if usage data demands it).

**GATE STATUS: OPENED by the user 2026-07-18** ("теперь мы должны полностью выпилить весь старый движок").
The comparison period declared on 2026-07-13 is over; `?engine=three` and everything behind it may now be
deleted. This is the **C2** command the chain has been referring to.

## What drops (the original four, unchanged in intent)

1. **The old graphics path** — the three-WebGL render pipeline in `packages/game`/`packages/renderware`:
   world materials (GLSL + TSL twins), post-processing chain (SMAA et al.), CSM, SSAO, the
   sky/water/grading plugins, `build-region`/`build-cell` three-object producers, InstancedMesh streaming.
   The game logic (systems, physics, zones, time) stays — it is renderer-agnostic (verified in the plan-10
   audit) and rebinds to engine entity handles (plan 08).
2. **Debug parameters** — the whole 073 flag zoo (`?webgpu`, `?bundle`, `?mat04`, `?pool`, …). Full
   disposition table in [phase 2](#phase-2--query-parameter-disposition).
3. **Libraries**: `three`, `three/webgpu`, `postprocessing`, `@babylonjs/core`, `@types/three`, **and our
   three patch** — plus the spike HTML entries.
4. **Docs**: mark the 073 chain's "flags stay in-tree for debug" note as executed; open-issues that were
   WebGL-specific get re-verified against the new engine and closed or re-filed.

---

## Phase 0 — INVENTORY (done 2026-07-18, three parallel sweeps)

The numbers this plan is scoped against. Everything below traces to these.

| Fact                                                       | Number                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Source files importing `three` or a three-adjacent package | **122**                                                                                              |
| — bucket (a) the WebGL render path                         | ~52 files, ~12 000 src lines                                                                         |
| — bucket (b) three used ONLY as a math library             | **20 files, ~4 200 src lines** → the `@opensa/math` job, [phase 1](#phase-1--opensamath-the-enabler) |
| — bucket (c) tests                                         | **50 test files**                                                                                    |
| — bucket (d) tools / tools-debug / node CLIs               | **ZERO** — tools only deep-import the three-free parser layer                                        |
| Declared three-adjacent deps                               | root `package.json` only: `three`, `postprocessing`, `@babylonjs/core`, `@types/three`               |
| Our three patch                                            | `patches/three+0.185.1.patch`, 207 lines, patches ONLY `three.webgpu.js`                             |
| Callers of the old public entry `createRenderContext`      | **exactly one** — `packages/game/src/game.ts:319`                                                    |
| URL query parameters read in code                          | **~60**, no central flags module — every one read inline at its use site                             |
| Documented-but-dead params                                 | **10** (`msaa`, `bloomq`, `ssr`, `carshadow`, `panorama`, `cloudcover`, …)                           |

### The three findings that shape the plan

1. **`packages/renderware/src/three/` (43 files, ~4 360 src + ~3 000 test lines) is kept alive ONLY by
   `apps/viewer`.** Once the game host flips, the four asset viewers are the sole consumers. So the viewer
   question is **on the critical path of the teardown, not a follow-up** — see
   [phase 4](#phase-4--the-viewers-the-critical-path).
2. **Our three patch is WebGPU-only** (`three.webgpu.js` — the 073 bundle/observer/heartbeat hacks). It
   was never load-bearing for the shipping WebGL path; it dies with the dependency, and nothing needs to
   be re-implemented on our side.
3. **Tools are already clean.** No file under `tools/`, `tools-debug/`, `asi/`, `scripts/`, `e2e/` imports
   three — they consume `@opensa/renderware` through deep subpath imports of the parser/archive layer.
   The teardown cannot break the tool chain, which removes the scariest class of risk up front.

---

## Order of operations (and why)

**Delete before you rewrite.** Every phase that removes code comes before the phase that would have had
to port it. Concretely: kill the spikes and the WebGL host first, so the viewer port and the math
extraction are sized against what actually survives — not against 122 files, most of which are about to
stop existing.

| Phase | What                                            | Unblocks                                  |
| ----- | ----------------------------------------------- | ----------------------------------------- |
| 0     | Inventory                                       | (done)                                    |
| 1     | `@opensa/math` — the enabler package            | phases 5, 6, 7                            |
| 2     | Query-parameter disposition + the canonical doc | phase 3 (some params die with their host) |
| 3     | Spike/standalone deletion (cheapest, zero risk) | shrinks phase 5's surface                 |
| 4     | The viewers decision + execution                | phase 5's `renderware/src/three` deletion |
| 5     | WebGL render-path deletion, package by package  | phase 7                                   |
| 6     | Test rework                                     | rides along with 3/4/5                    |
| 7     | Dependency prune + patch removal + size ledger  | the finish line                           |
| 8     | Close-out: bench ritual, docs, arch-graph       | —                                         |

**Every deletion PR runs the full suite + the bench ritual. Numbers must NOT move — by phase 5 this is all
dead code, and a moving number means we deleted something live.**

---

## Phase 1 — `@opensa/math`, the enabler

The blocker for dropping the dependency: 20 files use three purely as a math library. The engine
(`packages/engine`) is already three-free, so this package is what lets `packages/game` and
`packages/renderware` join it.

**Measured surface — the ENTIRE set of three symbols used as math across the repo:**
`Vector2`, `Vector3`, `Vector4`, `Matrix4`, `Quaternion`, `Box3`, `Sphere`, `MathUtils`.
(No `Euler` anywhere — a real simplification. `Matrix3` unused.)

Three harder cases that are NOT math and need their own answer:

- **`Object3D` as an opaque scene-node handle** — 7 files, type-only in all but
  `character/orient-character.ts`. Replacement = the engine's entity handle (plan 08's design), not a
  math type.
- **The animation triple** — `AnimationMixer` / `AnimationClip` / `VectorKeyframeTrack` /
  `QuaternionKeyframeTrack` in `character/animation-controller.ts`, `three/build-anim-clip.ts`,
  `three/animated-objects.ts`. **`packages/engine/src/anim/ifp-sampler.ts` already exists three-free** and
  is the intended replacement — this is a rebind, not a rewrite.
- **`three/addons` `OrbitControls`** in `core/camera-controller.ts` and all four viewers — small, and the
  engine-lab already has its own orbit camera to lift from.

### Tasks

- [x] **1.1 DONE 2026-07-18** — `packages/math` (`@opensa/math`) created: nx tags `type:engine` +
      `scope:osengine` (so engine/game/renderware may all consume it), zero runtime deps, added to the
      root `workspaces`.
- [x] **1.2 DONE 2026-07-18** — the measured surface implemented three-compatibly: `Vector2/3/4`,
      `Quaternion`, `Matrix4`, `Box3`, `Sphere`, `MathUtils`. **Compatible signatures are a deliberate
      choice**: the migration becomes an import-path rewrite in ~20 files instead of a logic rewrite in
      ~4 200 lines. Design note: the modules are acyclic because cross-type arguments are STRUCTURAL
      (`Vector3Like`/`QuaternionLike`/`Matrix4Like` in `types.ts`) rather than class imports — which also
      lets the engine's own math types be passed in without conversion. Column-major `Matrix4.elements`
      with row-major `set()` args, exactly as three, so buffers and fixtures transfer verbatim.
- [x] **1.3 DONE 2026-07-18** — parity suite green **against three itself**: `capture-three-fixtures.ts`
      is a one-shot CLI that recorded what three@0.185.1 actually returns for every subtle operation
      (compose/decompose, invert, extractRotation, lookAt, slerp, setFromUnitVectors incl. the opposite-
      vector branch, applyQuaternion, transformDirection, Box3.applyMatrix4, Sphere.applyMatrix4), and
      `three-parity.test.ts` asserts our implementation against that committed JSON to 8 decimals.
      12 tests, negative cases first. **This is the whole safety net for the teardown: after the
      dependency is gone the fixture is the only remaining witness of what three did.**
      Two capture lessons worth keeping: (a) the first sample vector was collinear with the rotation
      axis, so `applyQuaternion`/`applyAxisAngle` returned it unchanged and would have passed against any
      implementation — the sample is now deliberately off-axis; (b) the fixture pins that three moves a
      mirrored axis onto **X** in `decompose` (input scale `(2, 0.5, -1.5)` comes back `(-2, 0.5, 1.5)`),
      which is exactly the kind of silent disagreement a hand-rolled port produces.
      Suite after the phase: **331 files / 2171 tests green** (from 330/2159), tsc + eslint clean.
- [ ] **1.4** Decide + record: does the engine adopt `@opensa/math` for its internal math, or keep its own?
      (Engine currently has its own; do NOT churn it just for symmetry — record the reason either way.)
- [x] **1.5 PART 1 DONE 2026-07-18 — the pure-math files are off three (122 → 109 importers).**
      Migrated: `physics-world`, `enter-vehicle.system`, `vehicle-damage.system`,
      `vehicle-physics.system`, `build-colliders`, `procobj-colliders`, `procobj-scatter`,
      `collider.interface`, `world-adapter.interface` (its `Matrix4` only) + the matching tests.
      Suite 331/2171 green, tsc + eslint clean.

      **The `placementMatrix` extraction (unplanned, and it unblocked the collider cluster):**
      `procobj-colliders` could not migrate because it imports `placementMatrix` from
      `build-procobj.ts` — a RENDER-PATH file scheduled to die in 5c. The function is pure math and its
      own doc comment says it is shared by the render meshes and the clutter colliders, so it moved into
      the SURVIVING `procobj-scatter.ts` (re-exported through the map barrel). `build-procobj` now
      imports it back and carries a two-line bridge (`matrix.fromArray(...elements)`) into three's
      `InstancedMesh`, commented as temporary and dying with the file. Net effect: phase 5c gets smaller,
      not bigger.

- [ ] **1.5 PART 2 — BLOCKED BY DESIGN, rides phases 4/5.** Seven files were migrated, hit type errors
      at the seam with three OBJECTS, and were deliberately REVERTED rather than bridged:
      `camera-controller` (`OrbitControls`, `Box3.expandByObject`), `setup-character`
      (`Box3.setFromObject`), `hidden-instances` + test (`InstancedMesh.setMatrixAt`),
      `streaming.system` + test (copies a three geometry's `boundingSphere`),
      `character-controller.system` (`camera.getWorldDirection`), `procobj-runtime.test`.
      **These are not math problems — they are scene-graph problems**, and the missing methods
      (`Box3.setFromObject`/`expandByObject`, `Sphere` interop) are ones `@opensa/math` must NOT grow:
      they need an Object3D. They migrate when their three objects go away, which is exactly what
      phases 4 and 5 do. Reverting was the cheaper honest move over scattering bridge code through
      files that are about to be rewritten anyway.
- [ ] **1.6** Rebind the animation triple onto `ifp-sampler`; retire `build-anim-clip.ts` /
      `animated-objects.ts` if nothing else needs them.

**Gate for this phase:** `packages/game` and `packages/renderware` have zero `from 'three'` imports
outside `renderware/src/three/` and the files scheduled for deletion in phase 5.

---

## Phase 2 — Query-parameter disposition

No central flags module exists — ~60 params are read inline via `new URLSearchParams(...)` at their use
sites, and there is **no canonical reference doc**. This phase both cuts and organizes.

**Bucket A — DIE with the old renderer (17):** `webgpu`, `aa`, `dpr`, `bundle`, `bundledebug`, `texfree`,
`mesh1`, `warm`, `appear`, `cellcull`, `fog`, `nocull`, `shadowdebug`, `mat04`, `matcache`, `pool`, and
`engine` itself (the `three` override loses its target). These discharge the standing 073 agreement.

**Bucket B — KEEP (our engine's knobs):** `src`, `scale`, `aces`, `bloom`, `probe`, `probeview`, `draw`,
`spawn`, `weather`, `hour`, `sky`, `clouds`, `fogscale`, `ao`, `sunvis`, `wind`, `stoch`, `daycycle`.

**Bucket C — KEEP, these are HARNESS CONTRACTS:** `bench`, `soak`, `benchcar`, `test=leak`. Note the real
contract is the **console protocol** (`[bench]`/`[soak]` tags, `sweep complete`) which `drive.js` and
`gate-check.js` scrape — but the documented URLs in `docs/development/benchmarks.md` use these params, so
breaking them silently breaks the ritual.

**Bucket D — die with their host** (spike params: `count`, `mode`, `swap`, `dn`, `pipeline`, `snapshot`,
`rot`, `fix`, `precompile`, `ctx`, `variant`) or **survive with the viewers** (`tab` — asserted by
`e2e/viewer-tabs.spec.ts`, so it is an e2e contract).

**Bucket E — KEEP (lab scene setup, renderer-independent):** `pak`, `boxes`, `freeze`, `at`, `orbit`,
`az`, `el`, `ped`, `pedy`, `vehicle`, `vmodel`, `drive`, `cells`, `stream`.

**DEAD — documented but read nowhere (purge from DOCS):** `msaa`, `bloomq`, `ssr`, `carshadow`,
`panorama`, `cloudcover`, `lighting`, `path`, `speed`, plus `engine=opensa` (a no-op alias — the code only
tests `engine === 'three'`) and engine-lab's advertised `?soak=` (only `engine-perf-runs.ts` implements
soak, the lab does not).

### Tasks

- [ ] **2.1** Delete bucket-A reads together with their code in phases 3/5 (they have no independent life).
- [ ] **2.2** Purge the DEAD names from docs; where a doc describes a retired feature, say so rather than
      silently dropping the line (the series/plan history stays honest).
- [ ] **2.3** Write **`docs/development/query-parameters.md`** — the canonical reference that does not
      exist today: name · subsystem · default · values · where read. This is the deliverable that stops
      the zoo from regrowing.
- [ ] **2.4** Decide whether the survivors get a small central `flags.ts` reader in the engine host, or
      stay inline. Recommendation: **one thin typed reader** — inline `URLSearchParams` at 40 sites is
      exactly how the last zoo grew, and a typed reader makes the canonical doc mechanically checkable.
- [ ] **2.5** `?engine=three` removal is the point of no return for the A/B — do it as its own commit so
      the revert is a single click during the phase.

---

## Phase 3 — Spike & standalone deletion (cheapest first, zero risk)

All self-labelled throwaways from the 073 era. Nothing imports them; each has a root HTML entry listed in
`vite.config.ts:86-92`.

### Tasks

- [x] **3.1 DONE 2026-07-18** — `babylon-spike.{ts,html}` deleted, and since it was the **only**
      `@babylonjs/core` importer the dependency went with it immediately rather than waiting for phase 7:
      **`node_modules` 604 → 512 MB (−92 MB)**. Its finding (Babylon's snapshot = 0.12 ms at 15k draws,
      but engine-GLOBAL granularity, so migration was not justified) is preserved in
      [`073/concept/07-babylon-spike.md`](../073-webgpu-migration-threejs/concept/07-babylon-spike.md).
- [x] **3.2 DONE 2026-07-18** — the four three-WebGPU repros deleted after an explicit
      **findings-preservation audit** (the gate this task set): every conclusion each harness produced was
      traced to prose before its code was removed —
      `webgpu-spike` → [`concept/phase-0-spike-checklist.md`](../073-webgpu-migration-threejs/concept/phase-0-spike-checklist.md)
      lines 88–139 (the whole result table, the GO verdict, the cell-size sweep that had only ever existed
      as HUD output);
      `webgpu-bundle-repro`, `webgpu-stream-compile`, `webgpu-tsl-material` →
      [`concept/phase-1-findings.md`](../073-webgpu-migration-threejs/concept/phase-1-findings.md)
      lines 59–79, 154–175, 103–112.
      Two audit notes worth keeping: (a) for `webgpu-stream-compile` the DOC is richer than the deleted
      file — the winning `ctx=holder` configuration is recorded only in the prose, the file's own header
      never mentioned it; (b) `webgpu-tsl-material` is superseded by shipped code
      (`world-material-tsl.ts`), so only its throwaway `pipelineMix` blend construction is gone, which is
      a code artifact and not a finding.
- [x] **3.3 DONE** — the five `viewerInputs` entries removed from `vite.config.ts`; the build's HTML
      entries are now `index` + `viewer` + `controls-harness` only. Production build verified green.
- [x] **3.4 DECIDED — KEEP `opensa-engine.{ts,html}`** for now (it is the cleanest minimal-repro boot for
      engine bugs, and it is dev-served only — it was never in `viewerInputs`, so it costs the production
      build nothing). Revisit at phase 8.
- [x] **3.5** `controls-harness.{tsx,html}` — KEPT untouched (React + `@opensa/game/input`, zero renderer;
      driven by `e2e/touch-controls.spec.ts`).
- [x] **3.6 (found during the audit)** Two 073 docs referenced the harnesses as FORWARD-LOOKING assets,
      not history — `readme.md`'s revive conditions ("re-run `/webgpu-spike.html` first") and
      `01-upstream-contribution.md`'s open tasks ("re-run the harnesses after any three bump", "the
      `webgpu-stream-compile` harness is a good seed" for an upstream example). Both now carry a
      superseded/moot banner pointing at the preserved measurements, so the instructions are not left
      unfollowable.

---

## Phase 4 — The viewers (THE CRITICAL PATH)

`apps/viewer` (four viewers, ~1 635 lines) is the last consumer of `packages/renderware/src/three/`
(43 files). Phase 5 cannot finish until this is resolved. **This needs a user decision** — the options
are genuinely different amounts of work:

| Option                                              | Cost                                                                 | Consequence                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **(1) Port the viewers onto `@opensa/engine`**      | Largest. Needs an engine-side "load one DFF/TXD and orbit it" path   | Viewers keep working; `renderware/src/three` dies; `e2e/viewer-tabs` + `object-viewer` specs survive   |
| **(2) Retire the viewers into `engine-lab` probes** | Medium. `engine-lab/src/{ped,vehicle}.ts` already cover a good slice | Fewer apps to maintain; loses the tab shell and the compare viewer; e2e specs get rewritten or dropped |
| **(3) Freeze the viewers on a pinned three**        | Smallest now                                                         | REJECTED unless the user insists — it keeps `three` in the tree, i.e. defeats the whole plan           |

**USER DECISION 2026-07-18: option (1) — PORT ALL FOUR onto `@opensa/engine`.** The viewers are kept
capability, not legacy: nothing is lost, the `?tab=` + e2e contracts survive unchanged, and
`renderware/src/three/` still dies in full. Cost accepted: the engine needs a "load one DFF/TXD and orbit
it" path (object + compare), and the character viewer needs an IFP player on `ifp-sampler`.

### Tasks

- [x] **4.1** USER DECISION — option (1), port all four (recorded above).
- [ ] **4.1a** Engine-side single-asset path: load one DFF/TXD outside the pak/cell pipeline + orbit
      camera (lift engine-lab's). This is the shared foundation for all four tabs.
- [ ] **4.1b** `object-viewer` port (the e2e-asserted tab — do it first, it validates 4.1a).
- [ ] **4.1c** `vehicle-viewer` port (engine-lab's `?vehicle=1&vmodel=` covers most of it) +
      `build-col-wireframe` equivalent.
- [ ] **4.1d** `character-viewer` port — DFF + IFP + TXD on `ifp-sampler` (the animation rebind from 1.6
      lands here).
- [ ] **4.1e** `compare-viewer` port — two clumps side by side.
- [ ] **4.2** Execute the chosen option; keep `apps/viewer/src/shell.ts` if any tab survives (pure DOM
      routing, renderer-independent, survives a renderer swap unchanged).
- [ ] **4.3** Update / retire `e2e/object-viewer.spec.ts` + `e2e/viewer-tabs.spec.ts` accordingly — and
      keep the `?tab=` contract if the shell lives.
- [ ] **4.4** Check `tools/map-optimizer/src/compare-serve.ts` — it references viewer HTML and must follow.

---

## Phase 5 — WebGL render-path deletion, package by package

Order chosen so the tree compiles after every step.

### 5a — the host (`apps/web`)

- [ ] **5a.1** Delete `apps/web/src/ui/canvas-host.tsx` (1 570 lines) and the `?engine=three` branch in
      `apps/web/src/ui/shell/app.tsx`. The `engine-*.ts` siblings (camera/debris/perf-runs/particles/
      player/vehicles/breakables/clutter/props/anim-objects) all STAY — they are the engine host's wiring.
- [ ] **5a.2** `tools-debug/bench-harness/gate-check.js` — its `webgl2 = three prod` branch becomes dead;
      simplify to assert `webgpu` only.

### 5b — the render path in `packages/game`

- [ ] **5b.1** Delete `core/renderer.ts` (the old public entry — **one caller**, `game.ts:319`) and unwind
      that destructure.
- [ ] **5b.2** Delete `plugins/` render members: `postfx.plugin.ts` (the only `postprocessing` importer),
      `sky.plugin.ts` (864), `water.plugin.ts`, `csm.plugin.ts`, `fog.plugin.ts`, `sky-lite.system.ts`,
      `render-pipeline.ts`, `plugin.ts`, `ambient-light.plugin.ts`, `directional-light.plugin.ts`,
      `vehicle-reflection/`.
- [ ] **5b.3** Delete `mods/wind.mod.ts` (raw `onBeforeCompile` GLSL injection),
      `lights/street-light.system.ts`, `vehicle/vehicle-headlight.system.ts`, `streaming/fade.ts`,
      `perf/perf-monitor.ts` (GL timer queries — the engine has its own timestamp HUD),
      `adapters/gta-sa-world.adapter.ts` (1 049) + `adapters/three-vehicle-handle.ts`.
      **Each of these has an engine-side equivalent already shipped — verify the equivalent exists before
      deleting, and note it in the commit** (that note is what makes this reviewable a year from now).
- [ ] **5b.4** Rework `game.ts` (949 lines) — it is the seam between the two eras. Strip the three
      objects; what remains is the renderer-agnostic loop the plan-10 audit already verified.
- [ ] **5b.5** `core/camera-controller.ts` — drop `OrbitControls`, keep the math on `@opensa/math`.

### 5c — `packages/renderware`

- [ ] **5c.1** Delete `src/three/` (43 files) — **gated on phase 4**.
- [ ] **5c.2** Remove the barrel re-export block `src/index.ts:44–134`.
- [ ] **5c.3** Delete/port the three-object producers in `src/map/`: `build-region.ts` (491),
      `build-cell.ts`, `build-procobj.ts`, and check `procobj-runtime.ts` (type-only `InstancedMesh`).
      **Careful — `procobj-scatter.ts` and `procobj-colliders.ts` are bucket (b)**: they are live logic
      the engine host uses (the memoized scatter drives BOTH render and colliders), so they migrate to
      `@opensa/math`, they do NOT die.
- [ ] **5c.4** `src/collision/build-colliders.ts` — bucket (b), migrates.
- [ ] **5c.5** Update the package description ("RenderWare format parsers + three.js builders…").

---

## Phase 6 — Test rework

50 test files import three. They split cleanly:

- **Die with their subject** — the `renderware/src/three/*.test.ts` set (20), the plugin tests
  (`csm.plugin`, `fog.plugin`, `render-pipeline`, `sky-lite.system`), `wind.mod.test.ts`,
  `perf-monitor.test.ts`, `fade.test.ts`, the adapter tests.
- **Survive, need an import swap only** — the bucket-(b) tests: `physics-world.test.ts`,
  `vehicle-physics.system.test.ts`, `build-colliders.test.ts`, `procobj-*.test.ts`,
  `streaming.system.test.ts`, `timed-object.system.test.ts`, `hidden-instances.test.ts`.
- **Need real thought** — the character tests (`animation-controller`, `character-animation.system`,
  `character-controller.system`, `orient-character`, `render-sync.system`): they test logic we KEEP
  against three types we DROP.

### Tasks

- [ ] **6.1** Classify every one of the 50 into the three groups above, in a table in this plan.
- [ ] **6.2** Delete group 1 WITH its subject in the same commit (never leave a test for deleted code).
- [ ] **6.3** Swap imports for group 2 during phase 1.5.
- [ ] **6.4** Rewrite group 3 against `@opensa/math` + the engine's entity handles.
- [ ] **6.5** Remove the `postfx.plugin.ts` coverage exclusion in `vitest.config.ts:29`.
- [ ] **6.6** **Coverage must not drop** — record before/after. A cleanup that quietly deletes coverage is
      how a "no behaviour change" refactor hides a regression.

---

## Phase 7 — Dependency prune + the patch + the size ledger

- [ ] **7.1** Remove `three`, `postprocessing`, `@babylonjs/core` from root `dependencies`;
      `@types/three` from `devDependencies`.
- [ ] **7.2** Delete `patches/three+0.185.1.patch`; drop the `patch-package` postinstall **if it patches
      nothing else** (check first — it is a shared mechanism).
- [ ] **7.3** Update root `package.json` keywords (`three.js`, `webgl` → the WebGPU reality).
- [ ] **7.4** `scripts/arch-graph.ts` — remove the hardcoded `ext_three` node and the `three(/…)?`
      `TARGET_RE` (L76, L102-103, L160-161).
- [ ] **7.5** **Size ledger**: `node_modules` size, prod bundle size, cold `npm install` time — before and
      after, into the measurement ledger below. This is the phase's headline number.
      **Baseline captured 2026-07-18 (after the babylon drop, three still in):** `node_modules` 512 MB ·
      prod build JS 5.4 MB across all chunks (`canvas-host` 308 kB + `OrbitControls` 20 kB + `build-clump`
      20 kB + `build-texture` 610 kB are the three-side chunks to watch) · HTML entries 3.

---

## Phase 8 — Close-out

- [ ] **8.1** Full suite + typecheck + lint green; **the bench ritual re-run — numbers must not move**.
- [ ] **8.2** Docs sweep: mark the 073 chain's "flags stay in-tree for debug" note EXECUTED; re-verify
      WebGL-specific open-issues against the engine and close or re-file each.
- [ ] **8.3** `docs/development/` — `in-game-tools.md`, `scripts.md`, `benchmarks.md`, `engine-lab.md`
      lose their dead-param references and gain a link to the new `query-parameters.md`.
- [ ] **8.4** Revisit the phase-3.4 decision on `opensa-engine.{ts,html}`.
- [ ] **8.5** Update the chain readme + this plan's status; record the final disposition in
      [10-flip-decision.md](10-flip-decision.md) (criterion 5 discharged).

---

## Measurement ledger

| Date       | What                                                                                  | Numbers                                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-18 | Phase-0 inventory (3 parallel sweeps)                                                 | 122 three-importing source files (52 render-path / 20 math-only / 50 tests / **0 tools**); 43 files in `renderware/src/three`; ~60 URL params, 10 of them dead; patch = 207 lines, `three.webgpu.js` only; `createRenderContext` has exactly 1 caller          |
| 2026-07-18 | Phase 1.1–1.3: `@opensa/math` built + three-parity suite                              | 9 source files, ~1 000 lines, zero deps; 12 parity tests vs captured three@0.185.1 fixtures @ 8 decimals, all green first run; suite 330/2159 → **331/2171**, tsc + eslint clean                                                                               |
| 2026-07-18 | Phase 1.5 part 1: pure-math files migrated                                            | three importers **122 → 109** (13 files freed); `placementMatrix` extracted from the doomed `build-procobj` into the surviving `procobj-scatter`; 7 files deliberately reverted (scene-graph seams, ride phases 4/5); suite 331/2171 green, tsc + eslint clean |
| 2026-07-18 | Phase 3: spikes deleted + babylon dropped                                             | 5 spike TS + 5 HTML entries gone (findings audited into 073 prose FIRST); `@babylonjs/core` removed — **node_modules 604 → 512 MB (−92 MB)**; build HTML entries 8 → 3; prod build green, suite 331/2171                                                       |
|            | _(phase 7 size ledger lands here: node_modules, bundle, install time — before/after)_ |                                                                                                                                                                                                                                                                |
