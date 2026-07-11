# 074·09 — Post-FX & anti-aliasing

[← chain](readme.md) · prev: [08 dynamics](08-dynamics.md) · next: [10 integration](10-integration-flip.md)

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
  not a separate godraysSource render (simpler than the WebGL plugin's approach).
- Tiers (the 072 idea, minimal here): render scale (0.75/1.0) + bloom quality + MSAA 2×/4× as the three knobs;
  wired to the same config surface prod uses.

## Tasks

- [ ] Target pool + resolve wiring in the graph (01 infra made real); HDR format A/B.
- [ ] Bloom (dual-filter) + ledger row; threshold matched to prod config values.
- [ ] ACES tonemap (port the exact curve — prod look is calibrated against it; screenshot parity).
- [ ] God-rays; dusk bench-scene parity shots.
- [ ] A2C enablement on cutout pipelines + the coverage-preserved mips (03) verified together at distance
      (the foliage-thinning test).
- [ ] Tier knobs + their ledger rows (scale 0.75 GPU Δ etc.).
- [ ] Ledger: full-chain post ms at 2× retina (budget: ≤ 3 ms).

## Measurement ledger

(per pass ms; full chain; tier deltas)
