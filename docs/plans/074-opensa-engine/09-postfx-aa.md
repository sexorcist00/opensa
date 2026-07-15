# 074·09 — Post-FX & anti-aliasing

[← chain](readme.md) · prev: [08 dynamics](08-dynamics.md) · next: [10 integration](10-integration-flip.md)

> **PRIORITIZED 2026-07-15 (user): completing this plan is the next engineering block after the
> map-optimizer normals batch.** The "graphics transfer" audit (prod ACES + SSAO + tonemapping + modern
> pipeline vs 074) found the remaining real gap is HERE: ACES + bloom. **Look-verdict gate: no field
> judgments on plan 16 (vehicle paint), plan 17 (map lighting) or the concept/hd-realtime-lod-baked
> decision until ACES+bloom ship** — the prod look is calibrated against ACES, so every constant tuned
> against today's linear→sRGB output is suspect (the B5r "check the structure exists first" lesson).
> Expected one-time cost after landing: an env-constant re-judging round (sky/fog/moon tuned pre-tonemap).
> SSAO stays out (baked AO/skyVis answers) unless the HD-realtime concept is adopted — its doc owns that
> question.

The post chain re-imagined for a renderer that OWNS its targets. Headline change vs WebGL prod: **MSAA 4× replaces
SMAA** — simpler, better, and it's what unlocks alpha-to-coverage for the cutout world (the alpha fix's third leg).
SSAO is expected to be REPLACED by the baked skyVis channel (07) — it only returns if screenshots demand it.

## The chain (frame-graph passes, each timestamped)

```
scene (MSAA4, HDR RGBA16F) → resolve → bloom: threshold+downsample chain+upsample (dual filter)
→ god-rays: occlusion from resolved depth + radial blur toward sun screen-pos → composite
→ tonemap ACES + output-format conversion (the LAST pass writes the canvas)
```

- HDR target format decision (rgba16float vs bgra8+dither) — measure both; night bloom quality is the judge.
- God-rays: current look is the target (screenshot parity); the source is the sun disc occlusion from depth,
  not a separate godraysSource render (simpler than the WebGL plugin's approach). NOTE 2026-07-12: the sky
  already emits a STRUCTURED sun (hot disc ~0.5° + corona + circumsolar + haze, deliberately overshooting
  1.0) — today the sRGB output clips the core; this chain's HDR target turns that same overshoot into the
  bloom/god-rays energy source, no sky-side change needed.
- Tiers (the 072 idea, minimal here): render scale (0.75/1.0) + bloom quality + MSAA 2×/4× as the three knobs;
  wired to the same config surface prod uses.

## Tasks

- [x] **STAGE 1 PULLED FORWARD (2026-07-13, field round 3 of 074/06):** the scene renders into a LINEAR
      rgba16float offscreen (`SCENE_FORMAT`: MSAA + resolve; every scene pipeline + cell bundle retargeted)
      and a fullscreen `post` pipeline composites into the sRGB swapchain with brightness-threshold
      godrays (20-tap radial blur toward the sun's screen UV, decay 0.93, threshold 1.25, sunCorona tint;
      CPU gates: sun in front + above horizon + soft screen-edge fade). Occlusion is inherent — geometry
      leaves no bright pixels. Bloom/ACES/tier knobs still open below; the HDR A/B is settled (16f shipped).
- [ ] Target pool + resolve wiring in the graph (01 infra made real). ~~HDR format A/B~~ → 16f shipped.
- [ ] Bloom (dual-filter) + ledger row; threshold matched to prod config values.
- [ ] ACES tonemap (port the exact curve — prod look is calibrated against it; screenshot parity).
- [ ] God-rays; dusk bench-scene parity shots.
- [ ] A2C enablement on cutout pipelines + the coverage-preserved mips (03) verified together at distance
      (the foliage-thinning test).
- [ ] Tier knobs + their ledger rows (scale 0.75 GPU Δ etc.).
- [ ] Ledger: full-chain post ms at 2× retina (budget: ≤ 3 ms).

## Measurement ledger

(per pass ms; full chain; tier deltas)
