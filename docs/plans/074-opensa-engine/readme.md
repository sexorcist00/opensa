# 074 — OpenSA engine (own WebGPU framework + native formats) — chain umbrella

**Goal: 60 fps on M3-class hardware with the FULL current WebGL effect set, on the same world data.**
Graduated from the [00-concept](00-concept.md) research record after the
[073 three-WebGPU migration](../073-webgpu-migration-threejs/readme.md) FAILED on three's side. Every design
decision below traces to a 073 field measurement — this chain exists because we now know exactly what the
browser can do (Babylon snapshot 0.12 ms CPU @ 15k draws; vanilla SA 100+ fps on this GPU) and exactly what
killed the framework attempt (per-object pipelines, lazy compiles, naga codegen traps, retained-memory
pressure, black-box GPU time).

**WebGPU only.** No WebGL backend, no abstraction tax. The intact three-WebGL prod path IS the fallback for
non-WebGPU browsers during the whole build-out (additive, no flag day — the 066 ground rule).

## The chain

| #   | Plan                                                     | One-liner                                                                                             |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 01  | [Framework architecture](01-framework-architecture.md)   | The renderer design: module map, bind model, frame graph, shader system, extension points.            |
| 02  | [Native formats](02-native-formats.md)                   | `.oscell` / `.ostex` / `.ospak` — GPU-ready, versioned, batching + texture arrays + alpha.            |
| 03  | [Converter tool](03-converter-tool.md)                   | `tools/opensa-pack`: game-ready set → native pak; the ALPHA PIPELINE lives here (early).              |
| 04  | [Engine lab + P0 gate](04-engine-lab-p0.md)              | `apps/engine-lab`: the vertical-slice spike, bench parity, numeric gates, Safari check.               |
| 05  | [Streaming runtime](05-streaming-runtime.md)             | Cell lifecycle, worker IO, range reads, GPU residency/eviction — the memory model.                    |
| 06  | [World effects parity](06-world-effects-parity.md)       | Effect-by-effect WGSL ledger: sun/fog/sky/lights/emissives/wind/water, each measured.                 |
| 07  | [Baked channels](07-baked-channels.md)                   | Static shadows + AO/skyVis + emissive mask — 066/03-04 executed against the new target.               |
| 08  | [Dynamics](08-dynamics.md)                               | Skinning (EARLY probe), character + IFP, vehicles, particles, procobj instancing.                     |
| 09  | [Post-FX & AA](09-postfx-aa.md)                          | MSAA+A2C, bloom, ACES, god-rays; render-scale tiers.                                                  |
| 10  | [Integration & flip](10-integration-flip.md)             | Boundary refactor, game-app integration, flip criteria, 073-flags cleanup decision.                   |
| 11  | [Performance testing](11-performance-testing.md)         | Pinned `game-src` input + bench scenes + committed series — every engine change perf-gated.           |
| 12  | [Stochastic texturing](12-stochastic-texturing.md)       | De-tiling ground/grass/roads (skygfx-researched 3-tap blend); offline name-list selection.            |
| 13  | [Post-flip cleanup](13-cleanup.md)                       | AFTER the flip: drop the three-WebGL path, the 073 debug-flag zoo, three/babylon/postprocessing deps. |
| 14  | [pmb integration + final measure](14-pmb-integration.md) | Embed opensa-pack into perfect-map-builder; full modded-map conversion + the chain's exit-exam bench. |
| 15  | [LOD baked lights](15-lod-baked-lights.md)               | Bake 2dfx lamp light into LOD night prelit — far-field streetlight pools / billboard glow at night.   |

## Roadmap — vertical slices with numeric gates (plans ≠ phases; each milestone cuts across plans)

| Milestone                          | Cuts through                                                                                                                                                            | Gate (numbers, not vibes)                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0 — vertical slice** (~1–2 wks) | 01+02+03+04 minimal: format v0 (batching + texture arrays + alpha pipeline), converter for ONE district, renderer core (opaque + cutout + flat sky), HUD+GPU timestamps | district @2× retina **<5 ms GPU, <1 ms submit**; **alpha fringe visually dead** (vgsebushes/fences); boots in Safari TP                             |
| **M1 — streaming proof**           | 04+05 full: worker IO, range reads, cell lifecycle, stress harness                                                                                                      | ls-noon flythrough (SAME camera path as the WebGL bench): **no frame >20 ms during swaps**, cold start < WebGL prod, **JS heap flat** while driving |
| **M2 — world parity**              | 06+07: all world effects + baked channels                                                                                                                               | bench scenes visually ≥ WebGL prod (screenshot compare); **fps ≥ 2× WebGL prod** on every scene                                                     |
| **M3 — dynamics**                  | 08: character walks/drives in the lab                                                                                                                                   | playable; skinning ≤1 ms CPU+GPU                                                                                                                    |
| **M4 — ship**                      | 09+10: post chain, integration, tiers                                                                                                                                   | **60 fps ls-noon @2× retina M3 Pro**; better than WebGL prod on EVERY bench scene → default flip                                                    |

An M0 failure is a cheap, honest answer — that is the point of gating first.

## Ground rules (carried from 066 + hard 073 lessons)

1. **Additive.** New app (`apps/engine-lab`), new package (`packages/engine`), new tool (`tools/opensa-pack`);
   the prod web app and its tool chain are untouched. `packages/engine` must not import from `packages/game`
   or three — the boundary is enforced by nx tags from day one.
2. **The converter consumes the FINAL game-ready set** (post map-optimizer / lod-generator / installer — the
   exact files the prod web app loads). Existing tools never learn about the new format.
3. **No lazy anything on the hot path.** Every pipeline compiles behind the load veil; every buffer/texture is
   created at cell load; the steady-state frame allocates zero (JS and GPU). Cold-start storms and GC-vs-GPU
   ambiguity are 073 wounds — designed out, not fixed later.
4. **Measure or it didn't happen.** GPU timestamp queries + the frame-segment HUD land in M0 before the first
   effect. Every plan doc keeps a measurement ledger (the standing rule).
5. **Format versioned from day one** (magic + version + optional-channel bitmask); v0 is explicitly throwaway;
   readers reject unknown majors loudly.
6. **Budget guards in the tool** (bytes/draws per cell, determinism with fixed seeds) — pmb spirit.
7. **Effects are uniform-gated where possible, variants where necessary** — the `uPipelineMix` pattern worked;
   variant explosion is the enemy (pipelines stay enumerable, target: dozens).

## What we reuse (nothing starts from zero)

- **Parsers**: `@opensa/renderware` (DFF/TXD/COL/IPL/IDE/IFP) — the converter is mostly composition.
- **Bake stack**: map-optimizer prelight (day+night), opensa-lod-generator cell-LODs (QEM chain, prelit/2dfx
  transplant), lod-trees/procobj atlases — all feed the converter unchanged.
- **Math already ported in 073**: world material (classic+modern), fog, moon, pool-as-texture, sky-lite arcs.
- **Streaming design**: rings/hysteresis/atomic-swap semantics (plan 060) — reimplemented thin, three-free.
- **Instrumentation**: the 073 HUD (frame/fixed/update/unaccounted/heap/longtasks) + bench scenes/paths.
- **The alpha-edge groundwork**: dilation BFS + DXT software decode exist from the
  [open issue](../../open-issues/alpha-edge.md).

## Handoff status (2026-07-13 — resume from here)

**Milestones A + B1–B3 are DONE (2026-07-13, all field-confirmed):** meshopt wire (full-LS 311 MB, gate
closed) · bake pool + chunked welding (532 s / 5.2 GB; bakes now OPT-IN via `--bakes`, quarter-of-cores
pool) · FIRST FULL-MAP pak (71 s bakeless, `?src=pak-map`, whole-map `?bench=map` row committed) · B1
skinning probe (own IFP sampler — the chain's riskiest unknown retired) · B2 rigid entities (vehicle with
wheels/paint/lamp texture twins + the 06 row 7 light pool) · B3 the GAME boots on the engine
(`?engine=opensa`: reused physics/collision/input, ped-probe player, data-driven feet). NEXT: B4 water v1 +
effect tails, then the C flip ladder. The 2026-07-12 snapshot below is kept for history.

## Handoff status (2026-07-12, end of the Fable session — history)

**The execution order lives in [priority.md](priority.md)** — milestones A (map deliverable) → B (player
in the world) → C (flip + endgame), each step with its plan link and a done-definition.

**Shipped & field-confirmed:** M0 (P0 gate) · M1 streaming core · effects ledger 06 = 12/14 (rows 1,2,3,6,
8,9,10,11,14 ✅; 4,5 sky/fog v1; 13 coronas v1 — textured sprites + 2dfx particles remain; 7 light pool
waits for M3 producers; 12 water user-deferred → ideas 0.5.0/01) · plan 07 closed (scalar sun-vis + AO
shipping; directional v2 built-and-reverted → ideas 0.5.0/03, prerequisite = receiver densification) ·
plan 12 built but UNSTABLE/default-off · reversed-Z engine-wide · plan 10 phase 1 (boundary audit, the
`opensa-engine.html` standalone boot in the web app, full-LS pak `?src=pak-ls`, range-read pak IO) ·
plan 11 harness + committed series incl. the three-engine comparison table.

**The integration queue (in order):** ① meshopt wire compression (+brotli; geometry = 82 % of the 1.15 GB
full-LS pak — the measured top lever) → ② bake worker pool + chunked welding (full-map convert; bakes = 91 %
of time, 16 GB heap held ONE city) → ③ capability-gated loader (the phase-1 page is its target) → ④ M3
dynamics (own IFP skinning probe FIRST — plan 08 schedules the risk early) → ⑤ water v1 for the game →
⑥ flip criteria (plan 10) → ⑦ cleanup (13) → ⑧ pmb + final measure (14).

**Parked with prerequisites written down:** directional shadows (ideas 0.5.0/03 — receiver-mesh
densification), weather wind (ideas 0.5.0/02), stochastic default-on (12 — histogram-preserving pass),
streaming create-budget tuning (05 — post-integration section).

**Test/verification state at handoff:** 61 tests green across engine-formats/engine/opensa-pack; golden
WGSL snapshots current; tsc + eslint clean; benches committed through the `city` full-LS run.

## Decision log

- 2026-07-11 — chain created; WebGPU-only; texture ARRAYS over atlases (GTA UVs tile — measured −7 % on atlases);
  two-level LOD system kept as-is (already cell-based; the converter only re-groups its output).
- 2026-07-11 (M0 build-out, session 1) — landed: `packages/engine-formats` (.oscell/.ostex/.ospak codecs,
  20 tests; vertex stride refined 40→36 B — layer+ao+emissive pack into one uint16x2 attribute),
  `packages/engine` (device/features, residency ledger, enumerated pipelines ×4 with compileAll + steady-miss
  assertion, WGSL store with include resolver + naga guardrails as unit tests + golden snapshots, cell store
  with per-cell GPURenderBundle record-at-load, sphere culling, MSAA4+A2C pass, GPU timestamps; 10 tests),
  `apps/engine-lab` (synthetic district fixture through the REAL format path, orbit camera, gate HUD; port
  4300). @webgpu/types added to the workspace.
- 2026-07-11 (M0 build-out, session 2) — synthetic FIRST LIGHT on M3 Pro: **submit 0.1–0.2 ms, GPU pass
  0.85–1.44 ms, 120 fps (vsync-capped), culling live** (04 ledger). Landed `tools/opensa-pack` (game-fs over a
  local dir, texture planner: opaque DXT pass-through incl. BC2 + alpha pipeline
  classify/dilate/premult/α-weighted-mips/coverage → RGBA8-in-M0, eager deterministic array bucketing; cell
  welder: transform-baked GTA→engine axes, groups per (array × class × side), timed/anim skipped+counted;
  convert orchestrator + CLI + report; 13 tests) and the lab's `?pak=1` mode (whole-pak fetch — the M0
  shortcut; worker range-reads are plan 05). Converter ran on the real LS
  district (rect 8,-9..11,-5): **P0 GATE PASSED** — 807 draws (~20× down), submit 0.2 ms, GPU 1.84 ms,
  instant load, **and the alpha-edge halo is DEAD (user-confirmed)** — the years-old open issue fixed by
  construction on first run. M0 ✅ → next milestone M1 (streaming proof, plan 05).
- 2026-07-12 (M1 build-out, session 1) — bench harness landed (074/11: `?bench=orbit|close|drive`, warmup 120 +
  measure 600, p50/p95/max, JSON download + `bench-compare.ts` with the >10 % gate; `bench/series.md` seeded)
  and the M1 streaming core: pak WORKER (bytes worker-side, transferable slices), thin driver (rings 380/1000 +
  hysteresis + atomic swap + ≤1 create/frame + eviction), manifest grew `cellSize`. Modes: `?pak=1&stream=1`,
  stress `&bench=drive`. Field drive bench:
  **M1 CORE GATES PASSED** — frame max 9.80 ms during active streaming (gate <20), worst cell create 1.1 ms,
  main-thread heap **8 MB** (vs GB on 073), 42 cells created invisibly at 120 Hz. Remaining M1: whip/teleport/
  soak scenarios + leak assertion (follow-ups). NEXT: M2 — world effects (plan 06 ledger order) + baked
  channels (07).
- 2026-07-12 (M2 slice 1) — effects rows 1-3 landed: frame UBO grew to 128 B (sunDir/sunColor/dn/split),
  world WGSL consumes normal + nightPrelit (per-vertex N·L + day↔night blend), converter synthesizes a night
  set (day × cool ambient) for geometry without one, `Engine.environment` API, lab `?hour=N`/`?daycycle=1`.
  Golden shader snapshots reviewed+updated (the mechanism works). Ritual run: effects cost ≈ FREE
  (drive GPU p95 1.77→1.84 ms, gate clean; series row added). Field screens exposed the LINEAR→sRGB output
  bug (world gamma-crushed dark): fixed by rendering into the swapchain's sRGB VIEW (viewFormats) + linear
  sky constants — the project's standing linear-space lesson, now encoded in `EngineDevice.colorFormat`.
- 2026-07-12 (M2 slices 2-4) — sky pass + unified fog (rows 4-5 v1, +0.39 ms GPU p95 ACCEPTED, fog-into-sky
  invariant field-confirmed on noon/dawn/dusk screens); REAL timecyc (row 14: converter embeds
  timecyc(\_24h).dat into the manifest, the lab samples with prod's own parser chain, `?weather=N`); night
  emissives (row 8: per-vertex luma-delta glow — lit windows/neon at night, ~free). Reconvert required
  (manifest grew timecyc).
- 2026-07-12 (07 v1) — baked AO/skyVis landed: district triangle BVH + 12-ray cosine hemisphere bake in
  `opensa-pack` (two-phase weld→bake→assemble; HD only, opaque+cutout occluders, unique-vertex dedup),
  stored in the reserved `layerChannels` low byte + `AO_SKY_VIS` bit (no format bump; byte 0 = unbaked →
  open, old paks render unchanged). WGSL modulates the INDIRECT term only via `env.aoStrength` (default 0.6;
  lab `?ao=N` A/B, `--no-ao` skips the bake). LS rect: bake 20.6 s, 12.5 M rays / 1.16 M verts, pak size
  unchanged. Reconvert required to see it; sun-vis + emissive-mask bakes remain (07 continues).
- 2026-07-12 (07 sun-vis v1) — baked static sun shadows landed (066/03 v1 scalar): elevation-weighted arc
  visibility per HD vertex (5 unique elevations of the fixed-azimuth parametric arc, disc-jittered pairs →
  baked penumbra, backface skip halves rays), stored in `normal.w` + `SUN_VIS` bit, gated per cell via
  `cell.origin.w` (no in-data sentinel — the AO byte-0 lesson). WGSL: direct term × sunVis; `?sunvis=N` A/B,
  `--no-sunvis`. Both bakes share ONE district BVH: convert 35.1 s total (AO 20.4 + sun 9.0). Under-bridge /
  canyon direct sun now dies at noon; the moving-sun directional bake is the v2 follow-up.
- 2026-07-12 (06 row 10 wind) — sway landed OFFLINE-first: converter bakes the final amplitude in METRES into
  nightPrelit.a (trigger = IDE IS_TREE/IS_PALM + plan-039 WIND_MODELS; per-vertex weights from wind-ADAPTED
  overlay DFFs via `--wind "mods-src/vegetation,mods-src/mods/21. Wind Project 1.0.2"`, height-above-base
  fallback for unadapted vegetation; the mods' shared `vegetation.txd` became a planner FALLBACK TXD — the
  offline twin of the installed txdp wiring). WGSL: two world-space sines phased by position, wind clock +
  strength in params2.zw, `?wind=N`. The overlay also swaps in the HD vegetation geometry: district verts
  1.16 M → 3.13 M, pak 99.5 → 245.7 MB, convert 92 s (bakes 81 s) — the price of the user's real build.
  894 k sway verts. v1 limitation: one sway speed for all kinds (no per-vertex speed byte).
- 2026-07-12 (06 row 9 objectTable) — timed objects land end-to-end: the welder no longer skips `time` defs —
  they weld into TRAILING `timed` buckets (sort key keeps equal (on,off) windows contiguous) and become
  objectTable entries (kind 0, params = on|off<<8, identity transform — instances are transform-baked like
  everything). The engine excludes object-owned groups from the recorded bundle and draws them after
  `executeBundles`, gated by the new `env.hour` (midnight-wrapping window; lab drivers feed the hour). Timed
  geometry is excluded from the bake occluder set (night windows are coplanar overlays; timed props are
  sometimes-absent). LS rect: 10 timed objects (night windows + scrapyard-style props return). Reconvert done.
- 2026-07-12 (06 row 11 beams + blend) — the last two pipelineClasses got REAL pipelines: `world-blend-*`
  (fsWorld, premultiplied (one, 1−src-α), depth read-only) and `world-beam-*` (new fsBeam: dn-mixed prelit
  tint × cone alpha from dayPrelit.a, no sun/glow, fog FADES the premult pair instead of tinting toward sky).
  fsWorld's fog term made premult-correct (sky × texel.a — opaque unchanged). Registry 5 → 9 pipelines, all
  behind the veil. LS rect exercises the blend pair (242 groups leave the cutout placeholder); beam groups =
  0 there — field verification waits for an SF stadium/airport rect. v1 limitation noted: cross-cell blended
  order arbitrary (class-sorted within a bundle only). No reconvert needed (classes were in the pak).
- 2026-07-12 (06 row 6 moon + doc sweep) — plan docs swept clean of Cyrillic (quoted field verdicts now
  paraphrased in English; user request). Moon landed: per-vertex WRAPPED N·L `clamp((N·moonDir+0.6)/1.6)`
  (the 073 formula), gated by the baked sunVis (static occlusion blocks moonlight too), added into the lit
  sum next to the sun term. Frame UBO 256→288 B (moonDir/moonColor vec4s). Lab drivers grew a moon arc
  (rises ~20:00, sets ~5:00, azimuth opposite the sun) with a dim cool colour gated by dn × elevation —
  black all day, so the day path is untouched. No reconvert needed.
- 2026-07-12 (07 emissive mask + moon disc + 0.5.0 stub) — three closers: (1) the emissive-mask bake landed —
  the night-window luma-delta detection moved OFFLINE into the welder (layerChannels high byte + EMISSIVE
  bit), WGSL glow consumes the mask when the cell carries it (cell.origin.w became FLAG BITS: 1 sunVis,
  2 emissive; heuristic = old-pak fallback); LS rect 77.6 k masked verts, both paks reconverted. (2) The
  moon DISC joined the shared skyColorFor (smoothstep disc + faint halo on moonDir; moonColor black by day
  keeps day frames untouched, and fogged geometry dissolves into the moon behind it — the 068 invariant).
  (3) Weather-driven wind DEFERRED to 0.5.0 by user decision — idea stub at
  docs/ideas/0.5.0/plans/02-weather-wind/.
- 2026-07-12 (plan 12 added) — stochastic texturing researched against the JuniorDjjr skygfx fork (shader =
  Deliot–Heitz 3-tap tiling-and-blending with ddx/ddy, selection = CURATED texdb name list — editorial, not
  inferred). Both blockers that parked improvements/stochastic-texturing die in this architecture: selection
  moves offline into the converter (name list + optional auto-candidate analysis), and the DXT/LUT conflict
  is moot (v1 needs no LUT; the tool already owns full texel processing for the upgrade). Flag rides bit 15
  of the layer u16 — no format bump. Plan doc: 12-stochastic-texturing.md.
- 2026-07-12 (12 v1 shipped + field-accepted) — stochastic de-tiling landed end-to-end: curated
  `data/stochastic.txt` + the skygfx mod's full `texdb.txt` (user-supplied, 307 tagged names) MERGED as
  default sources; planner → layer-u16 bit 15 → WGSL 3-tap `textureSampleGrad` behind a per-vertex flag
  (sample-then-override keeps the common path uniform); `?stoch=0` A/B via the spare moonDir.w. Round-1 field
  miss (LS beach = `sandnew_law`) produced the curation loop: `stochastic-candidates.ts` ranks a rect's
  textures by covered area and prints unlisted ones. LS 172.8 k flagged verts. User accepted v1 as-is;
  the ritual bench row is still owed (more flagged pixels now — watch the +0.5 ms gate).
- 2026-07-12 (06 row 13 v1 coronas) — the format's dormant light table came alive: the welder transforms
  every instance's DFF 2dfx corona anchors into cell-local engine coords (HD cells only — LOD would double
  lamps; LS 2,426 / SF 1,084 anchors), the engine draws ONE instanced additive billboard pass after the sky
  (unit quad + CPU-filled instance buffer capped at 2,048; procedural radial glow — particle.txd sprites
  later; depth-read so geometry occludes coronas; night gate dn×1.5; farClip fade with a 350-unit floor for
  the high lab camera — the game integration restores authored clips). Registry grew to 10 pipelines.
  Remaining in row 13: textured sprites (coronastar/coronamoon) + 2dfx particles (factory smoke/fire).
- 2026-07-12 (07 sun-vis v2 directional) — the moving-sun static shadow landed (066/03 v2): the bake finds a
  per-vertex THRESHOLD elevation (8-sample ascending scan, disc-jittered) + penumbra softness; runtime is one
  smoothstep against the current arc elevation (spare sunDir.w) — shadows recede/grow with the sun, no map,
  no jitter. Threshold lives in normal.w (/1.1 encoding, 1.1 = never lit), softness in layer-u16 bits 8–14.
  Moon now gates on noon visibility (open-sky proxy). v1's scalar average is superseded; both paks
  reconverted (LS bake 38 s / 27.5 M rays).
- 2026-07-12 (07 v2 revert) — directional sun-vis was built, field-tested and REVERTED the same day: on
  SA's metre-sparse receiver meshes, threshold shadows lose narrow occluders entirely (a bridge falls
  between road vertices), punch holes and darken LODs — five noon field screens documented in plan 07.
  The accepted scalar v1 consumer is restored; the round's KEEPERS: wire/sliver occluder filter, LOD-cell
  baking (kills HD/LOD shadow seams), zenith-converging sun arc (noon shadows sit under bridges), and the
  known-limit note that small-object shadows need texel-space baking or the dynamic near cascade. v2
  un-parks when the converter learns receiver subdivision (pmb-grade).
- 2026-07-12 (field cleanup round) — three fixes from the noon/night reports: (1) stochastic texturing
  marked UNSTABLE and default-OFF (`Environment.stochastic = 0`, `?stoch=1` A/B; data stays flagged) —
  grazing-angle ghosting joined the structured-texture scrambles; finish = histogram-preserving pass.
  (2) LOD bake artifacts capped: LOD ray push-off 0.6 → 1.0 + result FLOORS (sunVis ≥ 0.4, AO ≥ 0.5) —
  LOD self-shadow noise bounded while the HD/LOD seam stays soft. (3) REVERSED-Z landed engine-wide
  (depth32float, swapped near/far projection, clear 0, `greater` compares; blended classes get
  `greater-equal` so exactly-coplanar overlays — night windows, wall signs — composite stably): the
  systemic fix for the sign z-fighting and flickering tobj windows.
- 2026-07-12 (10 phase 1 + full-LS numbers) — the integration track opened: boundary table audited against
  code; the FULL-LS scaling measurement landed (pak 1.15 GB = 82 % GEOMETRY / 18 % textures → priority
  inversion: meshopt wire compression + bake worker-pool before any BC work; V8-Map-cap gotcha fixed with
  per-cell bake caches); the streaming driver graduated from the lab into `packages/engine/src/stream/`;
  and the first own-engine boot INSIDE the web app shipped (`opensa-engine.html`, free-fly over full LS,
  `?src=pak-ls`). The lab also streams the whole city now (`?src=pak-ls`). Bench JSON carries converter
  metrics (plan 11 task closed).
- 2026-07-12 (session close: plans 13/14 + handoff) — the chain gained its endgame plans: 13 post-flip
  CLEANUP (user decision: after a successful integration the old graphics DROP entirely — three-WebGL path,
  the 073 debug-flag zoo, three/babylon/postprocessing dependencies; supersedes flip criterion 4's WebGL
  fallback) and 14 PMB INTEGRATION (opensa-pack becomes a perfect-map-builder stage — wind/stochastic/
  subdivision data move into pmb config — plus the exit-exam measurement: full modded map, all profiles,
  60 fps verdict). Fixed open-issues moved to docs/open-issues/fixed/ (alpha-edge, ghost-barriers,
  lod-2dfx-particles — the latter two root-fixed by perfect-map.asi). A "Handoff status" section snapshots
  the resume point.
- 2026-07-12 (sky day, evening close) — the sky became REAL: row 4 ✅ (Preetham dome as a CPU-built 96×48
  LUT shared by sky AND fog — the 068 invariant by construction; env gained cloudCover/cloudDark/skyMood),
  row 16 ✅ (procedural starfield, second audit gap — found by the user's question), structured sun
  (disc + corona + circumsolar + haze; deliberate HDR overshoot that plan 09's bloom/god-rays will consume),
  dn night-blend (Preetham has no night model — the post-sunset horizon glow fix), and the TRUE east→west
  sun arc (runtime + standalone + the sun-vis bake's morning/evening ray pairs with a per-ray facing test).
  Also this evening: wire compression stage 1 (2.3–2.6×, deflate-raw + range-aware entries), the streaming
  revisit-lifecycle fix + whip/teleport/leak stress suite (leak PASS; whip heap 736 → 55 MB after the
  stale-blob backpressure fix), the lab WASD focus pan, and plans 13/14/15/16-rows + priority.md for the
  Opus handoff.
- 2026-07-12 (night field round: transparency + missing-object root causes) — three fixes off the user's
  screenshots, ALL AWAITING THE NEXT RECONVERT (converter-side; the engine sort is live immediately):
  (1) TWO-PHASE frame — every cell's opaque bundle, then sky, then every cell's blend bundle (cells now
  record separate opaque/blend bundles): a later cell's opaque could repaint an earlier cell's canopies
  (the "not quite right" screenshots), and the engine now also sorts blend bundles back-to-front by cell distance.
  (2) MISSING OBJECT solved — the "blue hole" at GTA (804, −1619) was `burger01_LAw`, a 22×35 m diner in the
  IDE **anim** section (its sign spins), and the welder SKIPPED all anim defs; the earlier "skipped-animated
  are all signs" reading was wrong. Anim defs now weld STATICALLY at bind pose with the frame chain applied
  (`frameWorldTransform` — the weld path had ignored RW frames entirely; identity for static DFFs so nothing
  else moves; report stat `animatedStatic`). Runtime IFP animation = a later dynamic-entity feature (row 17).
  (3) FOLIAGE → CUTOUT — trees-through-trees was blend-classed canopies writing no depth: `classifyAlpha`'s
  2 % mid-alpha bound mis-classes scanned foliage skirts; the welder now passes `preferCutout` for
  sway-kind (vegetation) defs, upgrading softBlend → cutout (vanilla SA alpha-tests foliage; our
  A2C + MSAA + coverage-preserved mips are the modern equivalent).
- 2026-07-13 (night-fix reconvert + A1 meshopt wire) — all three paks reconverted with the night fixes
  (`pak` 93.9 MB / `pak-sf` 52.3 MB / `pak-ls` 497.5 MB, full-LS 939 s; `animatedStatic` 0/1/4 — the
  burger01_LAw diner and three siblings weld again; field verdict pending). Then integration-queue item ①
  landed: meshopt wire compression (`.oswire` container + `enc: 'oswire-deflate-raw'`, worker-side meshopt
  decode via `meshoptimizer/decoder`, old paks stay readable) — ls-bench pak 93.9 → 68.9 MB, cell geometry
  4.23× over raw (deflate-only was ~2.4×), worst-cell decode NET FASTER (18.7 vs 24.9 ms, worker-side);
  numbers + the triangle-rotation safety note in the 14 ledger. Brotli consciously skipped (no
  DecompressionStream support; serve-time `Content-Encoding: br` remains available).
- 2026-07-13 (field round: hipoly stipple + bakes opt-in) — trees/diner field-CONFIRMED (night fixes hold);
  new report: `tree_hipoly07`-class trees semi-transparent at range = the preferCutout upgrade meeting
  BROADLY semi-transparent mod-canopy alpha (α≈0.5 everywhere → A2C = uniform screen-door). Fix: offline
  alpha SHARPENING (gain 8 around ref 128, before premultiply so RGB scales by the remapped alpha) applied
  ONLY to upgraded softBlend→cutout textures — natural cutouts untouched. Same round: heavy bakes went
  OPT-IN (`--bakes`, plan 03 note) — bakeless full-LS convert 31.8 s vs 939 s; bench/production converts
  must re-enable. A1 gate CLOSED with the measured full-LS wire: 497.5 → 311.2 MB. Bench row A1·meshopt
  accepted (GPU p95 +6 % vs 06·wind, inside gate; submit untouched — decode worker-side).
