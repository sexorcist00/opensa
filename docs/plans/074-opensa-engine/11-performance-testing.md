# 074·11 — Performance testing (the regression harness)

[← chain](readme.md) · prev: [10 integration](10-integration-flip.md)

Engine changes must be perf-CONTROLLED, not perf-hoped. This plan pins a canonical measurement input and a
repeatable ritual so every number is comparable across engine versions — the M0 first-light rows (04 ledger)
become the first entries of a permanent series.

## The canonical input: `./game-src`

- `game-src/<profile>/` (gitignored — Rockstar assets; the existing fixtures convention) holds the PINNED game
  builds measurements run against. Baseline profile: **`non-modified`** (stock, no mods — the most stable
  input); the modded profiles (`anderius`, `carcer`, `gostown`) join later as stress inputs.
- One command produces the bench pak, always the same way:
  `npx tsx tools/opensa-pack/src/cli.ts --game game-src/non-modified --out apps/engine-lab/public/pak --rect <scene>`
- The converter's `report.json` IS part of the measurement (pak size, groups histogram, convert wall-time) —
  tool regressions get caught the same run.

## Bench scenes (pinned rects + camera paths; mirror the WebGL bench names where they overlap)

| Scene                           | Rect (cells) | Path                                                               | What it stresses                      |
| ------------------------------- | ------------ | ------------------------------------------------------------------ | ------------------------------------- |
| `ls-bench`                      | 8,-9 → 11,-5 | orbit @ fixed radius, 20 s                                         | the M0 baseline — general draw/fill   |
| `ls-close`                      | same         | scripted zoom-in to foliage/fences                                 | fill rate, A2C, alpha quality eyeball |
| `ls-sweep`                      | same         | the ls-noon flythrough path (bench parity with WebGL prod numbers) | streaming (from M1), worst frames     |
| (later) `lv-night`, countryside | —            | added with plans 05/06 as those systems land                       | night effects, vegetation density     |

## The harness (`?bench=<scene>` in engine-lab)

- Deterministic scripted camera per scene, `WARMUP=120` frames discarded, `MEASURE=600` frames collected.
- Collected per run: frame avg / p50 / p95 / **max**, submit CPU, GPU per-pass ms, draws, cells visible/total,
  residency bytes, JS heap, plus environment (adapter string, dpr, canvas size, engine git hash).
- Output: a JSON blob auto-downloaded as `bench-<scene>-<date>.json` + the same summary printed on the HUD —
  zero DevTools required (the 073 process lesson).

## The record (committed, append-only)

- `docs/plans/074-opensa-engine/bench/` — one JSON per accepted run + `series.md` (a hand-curated table: date,
  commit, scene, the headline numbers, note). The M0 rows seed it:

| Date       | Commit | Scene                 | frame           | submit  | GPU     | draws | residency | Note                           |
| ---------- | ------ | --------------------- | --------------- | ------- | ------- | ----- | --------- | ------------------------------ |
| 2026-07-11 | (M0)   | synthetic 12×12       | 8.33 ms (vsync) | 0.10 ms | 1.44 ms | 528   | 224 MB    | first light                    |
| 2026-07-11 | (M0)   | ls-bench (40 entries) | 8.34 ms (vsync) | 0.20 ms | 1.84 ms | 807   | 294 MB    | real district; alpha halo dead |

## The ritual (manual, cheap, non-negotiable)

1. Before merging an engine/converter change that could move perf: run `ls-bench` (+ the scene the change
   touches) on the pinned profile.
2. Compare against the last accepted run: **frame p95 or GPU pass regressing > 10 % blocks the change** until
   explained (a written note in `series.md` can accept a justified cost — e.g. a new effect's ledger row).
3. Accepted run → JSON committed + `series.md` row. The plan-doc measurement ledgers (04/06/09) reference
   series rows instead of duplicating numbers.
4. WebGPU-in-CI is not assumed (headless WebGPU is fragile) — this stays a documented manual ritual until it
   proves worth automating; the harness output being a committed JSON keeps us honest meanwhile.

## Tasks

- [ ] `?bench=<scene>` mode in engine-lab: scene registry (rect + camera script), warmup/measure loop,
      percentile math, JSON download + HUD summary, engine/adapter/env stamping.
- [ ] `bench/` folder + `series.md` seeded with the two M0 rows above.
- [ ] Scene `ls-sweep` camera path recorded to match the WebGL `ls-noon` bench path (direct comparability —
      the 65 ms/31 ms prod row becomes a permanent compare line in `series.md`).
- [ ] Converter metrics folded into the run record (pak bytes, groups histogram, convert time from report.json).
- [ ] A tiny compare script (`npx tsx tools/opensa-pack/src/bench-compare.ts a.json b.json`) printing deltas
      with the >10 % gate colored — the ritual's step 2 in one command.
- [ ] Document the ritual in CONTRIBUTING-style form inside this doc once the harness lands (checklist form).
- [ ] Series CHART (user request 2026-07-13 — a trend chart at the end of the chain): a small generator that reads
      the committed bench JSONs and renders the trend lines (frame/GPU/draws/residency per scene over time)
      — the series is the data source of record, the chart is the exit-report artifact.

## Measurement ledger

(the series lives in `bench/series.md`; this doc keeps only decisions about the harness itself)
