# 001 — Foundations: instrumentation & colour pipeline

Part of the [rendering overhaul chain](readme.md). No visual changes — this plan makes every later stage MEASURABLE and cheap to A/B. Nothing else in the chain starts before the baselines exist.

## Context

- There is currently **no runtime FPS/draw-call instrumentation** anywhere (`renderer.info` unused, no Stats, no GPU timers) — a genuine gap given the chain's "very beautiful AND very fast" constraint.
- Tone mapping is an ACES `EffectPass` in the composer (`postfx.plugin.ts`), renderer keeps three defaults; the engine already runs a linear-space texture pipeline (`swapLinearTxds`, memory: linear-space colour math).
- 038 shipped its rework behind a `worldLighting` mode switch and deleted the old path after sign-off — the same rollout pattern serves the whole chain.

## Decisions

1. **Perf HUD + benchmark harness before anything else.** Every following plan records before/after numbers from the SAME harness; a stage that blows its budget doesn't merge.
2. **Fixed benchmark scenes**: 4–6 deterministic camera paths (downtown LS noon, SF fog dawn, LV night neon, countryside dusk, ocean horizon, rain) selectable via URL (`?bench=ls-noon`), each producing avg/p95 frame ms + draw calls + triangle count as JSON to console/clipboard.
3. **GPU timing**: `EXT_disjoint_timer_query_webgl2` where available (per-pass timings via the postprocessing composer hooks); CPU fallback otherwise. Per-plugin cost visibility (sky / water / shadows / post) is the goal — budget disputes get settled by data.
4. **Colour pipeline decision up front**: pick renderer-level `outputColorSpace`+tone mapping (candidates: keep post-ACES vs renderer AgX/ACES) and freeze it BEFORE lighting calibration starts in 002 — recalibrating twice is the most expensive mistake available. Document the choice + reasoning here.
5. **A/B scaffolding**: a single `graphics.pipeline: 'classic' | 'modern'` master switch plus per-feature toggles (added by each later plan), all live via the debug overlay like existing graphics config.

## Tasks

- [ ] Perf HUD (debug overlay panel): FPS, frame ms (avg/p95 over 2s window), `renderer.info` draws/tris/programs, memory (geometries/textures). Zero cost when hidden.
- [ ] GPU timer wrapper (`EXT_disjoint_timer_query_webgl2`) with per-pass labels; graceful no-op fallback.
- [ ] Benchmark harness: scripted camera paths, `?bench=` runner, JSON report; document the reference machine (user's) and record BASELINE numbers for all scenes into Measurements below.
- [ ] Colour pipeline spike: side-by-side screenshots (current post-ACES vs renderer-level ACES vs AgX) across noon/dusk/night; user picks; freeze the decision here.
- [ ] `graphics.pipeline` master switch + debug toggle (no behaviour change yet — later plans hook it).
- [ ] Lint/tsc; touched tests only.

## Verification

- HUD numbers match an external reference (browser devtools FPS meter) within noise.
- Benchmark reruns are stable (<5% variance run-to-run on an idle machine).

## Measurements

_(record before closing — these are the chain's baseline)_

- Reference machine: …
- Baseline per bench scene (frame ms avg/p95, draws, tris): …
- Per-pass GPU cost snapshot (render / SSAO / god-rays / bloom / SMAA): …
- Colour pipeline decision: …
