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

| #   | Plan                                                   | One-liner                                                                                   |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 01  | [Framework architecture](01-framework-architecture.md) | The renderer design: module map, bind model, frame graph, shader system, extension points.  |
| 02  | [Native formats](02-native-formats.md)                 | `.oscell` / `.ostex` / `.ospak` — GPU-ready, versioned, batching + texture arrays + alpha.  |
| 03  | [Converter tool](03-converter-tool.md)                 | `tools/opensa-pack`: game-ready set → native pak; the ALPHA PIPELINE lives here (early).    |
| 04  | [Engine lab + P0 gate](04-engine-lab-p0.md)            | `apps/engine-lab`: the vertical-slice spike, bench parity, numeric gates, Safari check.     |
| 05  | [Streaming runtime](05-streaming-runtime.md)           | Cell lifecycle, worker IO, range reads, GPU residency/eviction — the memory model.          |
| 06  | [World effects parity](06-world-effects-parity.md)     | Effect-by-effect WGSL ledger: sun/fog/sky/lights/emissives/wind/water, each measured.       |
| 07  | [Baked channels](07-baked-channels.md)                 | Static shadows + AO/skyVis + emissive mask — 066/03-04 executed against the new target.     |
| 08  | [Dynamics](08-dynamics.md)                             | Skinning (EARLY probe), character + IFP, vehicles, particles, procobj instancing.           |
| 09  | [Post-FX & AA](09-postfx-aa.md)                        | MSAA+A2C, bloom, ACES, god-rays; render-scale tiers.                                        |
| 10  | [Integration & flip](10-integration-flip.md)           | Boundary refactor, game-app integration, flip criteria, 073-flags cleanup decision.         |
| 11  | [Performance testing](11-performance-testing.md)       | Pinned `game-src` input + bench scenes + committed series — every engine change perf-gated. |
| 12  | [Stochastic texturing](12-stochastic-texturing.md)     | De-tiling ground/grass/roads (skygfx-researched 3-tap blend); offline name-list selection.  |

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
