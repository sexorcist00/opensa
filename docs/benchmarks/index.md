# The benchmark record, in chronological order

**This index is the PERFORMANCE family.** The vehicle-physics captures keep their own chronology in
[`vehicle-physics/readme.md`](vehicle-physics/readme.md) — a lap measures behaviour, not frame cost, and the
two must not be read against each other.

Every run in this folder, oldest first, with the conditions it was taken under. **Conditions are the whole
point:** two runs are only comparable when the machine, the scene set, the pak and the flags match, and most
of the confusion in this project's perf history came from comparing rows that did not.

Format and the standing rule: [readme.md](readme.md). How to produce a run:
[`../development/benchmarks.md`](../development/benchmarks.md).

## Read this before comparing any two rows

- **Two different harnesses live here.** The `drive` / `city` / `map` / `teleport` / `whip` runs are
  **headless lab** paths (`tools-debug/bench-harness`, ANGLE, a small `pak-ls`/`pak-map`), reporting
  `frameMs` + `gpuPassMs` + `residencyMb`. The `ingame` runs are the **in-game `?bench=all` sweep** on the
  real display, reporting per-scene `avgMs`/`p95Ms`/`fps`/`avgDrawCalls`. Their numbers are NOT comparable
  to each other — only within a family.
- **Everything through 2026-07-18 was vsync-locked at 120 fps / 8.33 ms.** A frame average of 8.33 does not
  mean "8.33 ms of work"; it means the frame finished early and waited. Use `gpuPassMs`, `p95Ms` and
  `draws` to see the real cost in those rows — the frame average is saturated and will hide a regression
  until it exceeds the budget.
- **The pak is a variable.** Converter output decides what the world contains; a pak missing far LODs
  benchmarks faster than one that has them. Older lab rows carry a `converter` block naming the build;
  the in-game rows mostly do not, and that gap blocked the 07-20 diagnosis until #21 rebuilt the paks layer
  by layer.

## The three-engine (prod) line — the record we migrated away from

Kept because every own-engine claim is expressed against it. Same six bench scenes throughout.

| Date    | File                                                                      | Conditions                                                                    | Headline numbers                                                                              |
| ------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 2026-06 | [classic-baseline](three-engine/2026-06-classic-baseline.json)            | classic pre-overhaul WebGL pipeline, M3 Pro, ANGLE→Metal                      | 18.7–78.2 fps · avg 12.8–53.5 ms · draws **62–10 445** · GPU timer unreliable                 |
| 2026-07 | [modern-default](three-engine/2026-07-modern-default.json)                | full 064–071 chain on, clouds off, same machine/scenes                        | avg **33.5–97.3 ms** · draws 86–15 165 — the modern pipe cost +62…162 % frame                 |
| 07-12   | [webgl-webgpu-babylon](three-engine/2026-07-12-webgl-webgpu-babylon.json) | the shoot-out that justified an own engine, ls-noon                           | three WebGL 65 ms / 14 454 draws · three WebGPU **300–400 ms** · Babylon 0.12 ms submit @15 k |
| 07-17   | [prod-display-c1](three-engine/2026-07-17-prod-display-c1.json)           | user's display, **841 road cars** — partner of own-engine row #13             | 13.5–54.3 fps · avg 18.4–74.0 ms · draws 55–8 956                                             |
| 07-18   | [preflip-prod](three-engine/2026-07-18-preflip-prod.json)                 | user's display, 841 cars, back-to-back with the own engine — **the flip row** | 16.2–59.6 fps · avg 16.8–61.6 ms · draws 60–10 119                                            |

## The opensa-engine line, chronologically

| #   | Date        | File                                                                                                                                                                                                                                                                           | Harness / scene                                | Conditions                                                                                                                                                                                                    | Headline numbers                                                                                                                                                                                                          |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 07-12 07:13 | [drive-ao](opensa-engine/2026-07-12-drive-ao.json)                                                                                                                                                                                                                             | lab `drive`                                    | `?pak=1&stream=1`, dpr 2, 3456×1846                                                                                                                                                                           | frame 8.333 / p95 9.3 · GPU pass **1.94** (p95 2.75) · draws 255 avg / 334 max · resid 265 MB                                                                                                                             |
| 2   | 07-12 07:31 | [drive-sunvis](opensa-engine/2026-07-12-drive-sunvis.json)                                                                                                                                                                                                                     | lab `drive`                                    | same as #1, + sun-vis bake                                                                                                                                                                                    | frame 8.333 / p95 9.2 · GPU pass **2.08** · draws 255 / 334 · resid 265 MB                                                                                                                                                |
| 3   | 07-12 07:57 | [drive-wind-hd](opensa-engine/2026-07-12-drive-wind-hd.json)                                                                                                                                                                                                                   | lab `drive`                                    | same as #1, + HD wind                                                                                                                                                                                         | frame 8.335 / p95 9.3 · GPU pass **2.79** · draws 296 / 394 · resid 359 MB                                                                                                                                                |
| 4   | 07-12 08:14 | [drive-tobj-night](opensa-engine/2026-07-12-drive-tobj-night.json)                                                                                                                                                                                                             | lab `drive`, **night**                         | `&hour=22`, timed objects                                                                                                                                                                                     | frame 8.334 / p95 9.3 · GPU pass **2.86** · draws 302 / 401 · resid 360 MB                                                                                                                                                |
| 5   | 07-12 11:10 | [drive-stoch-coronas-night](opensa-engine/2026-07-12-drive-stoch-coronas-night.json)                                                                                                                                                                                           | lab `drive`, **night**                         | `&hour=22`, stochastic coronas                                                                                                                                                                                | frame 8.334 / p95 9.3 · GPU pass **3.53** (p95 4.85) · draws 303 / 402 · resid 360 MB                                                                                                                                     |
| 6   | 07-12 13:02 | [city-full-ls](opensa-engine/2026-07-12-city-full-ls.json)                                                                                                                                                                                                                     | lab `city`, full LS                            | `src=pak-ls`; converter: 345 cells, pak 1151 MB, AO bake 418 s                                                                                                                                                | frame 8.339 / p95 9.3 · GPU pass **2.67** · draws 225 / 582 · resid 409 MB                                                                                                                                                |
| 7   | 07-12 14:54 | [whip-full-ls](opensa-engine/2026-07-12-whip-full-ls.json)                                                                                                                                                                                                                     | lab `whip` (fast camera whip), full LS         | `src=pak-ls`; converter: 345 cells, pak 500 MB                                                                                                                                                                | frame 8.333 / p95 9.3 · GPU pass **0.88** · draws 17.7 / 103 · resid 406 MB                                                                                                                                               |
| 8   | 07-12 14:55 | [teleport-full-ls](opensa-engine/2026-07-12-teleport-full-ls.json)                                                                                                                                                                                                             | lab `teleport` (streaming stress), full LS     | `src=pak-ls`; same converter as #7                                                                                                                                                                            | frame 8.334 / p95 **9.4** · GPU pass 1.33 · draws 85 / **481** · resid 407 MB · heap 257 MB                                                                                                                               |
| 9   | 07-13 07:01 | [drive-meshopt](opensa-engine/2026-07-13-drive-meshopt.json)                                                                                                                                                                                                                   | lab `drive`                                    | after meshopt; converter: 40 cells, pak 69 MB                                                                                                                                                                 | frame 8.333 / p95 9.3 · GPU pass **2.93** · draws 290 / 388 · resid 360 MB                                                                                                                                                |
| 10  | 07-13 08:06 | [map-full-map](opensa-engine/2026-07-13-map-full-map.json)                                                                                                                                                                                                                     | lab `map`, **whole map**                       | `src=pak-map`; converter: 1121 cells, pak 770 MB, 176 timed objects                                                                                                                                           | frame 8.332 / p95 9.2 · GPU pass **2.90** · draws 393 / 680 · resid **637 MB**                                                                                                                                            |
| 11  | 07-13 09:34 | [drive-lightpool-night](opensa-engine/2026-07-13-drive-lightpool-night.json)                                                                                                                                                                                                   | lab `drive`, **night**, narrower window (2444) | `&hour=22`, light pool; converter: 40 cells, pak 69 MB                                                                                                                                                        | frame 8.334 / p95 9.1 · GPU pass **3.64** (p95 4.92) · draws 267 / 378 · submit 0.43                                                                                                                                      |
| 12  | 07-14 20:36 | [ingame-vehicles](opensa-engine/2026-07-14-ingame-vehicles.json)                                                                                                                                                                                                               | **in-game sweep**, 6 scenes                    | commit `33c74c9` (vehicles B5), pak-map bakeless, Chrome / M3 Pro                                                                                                                                             | 119.9–120 fps · p95 9.2–9.4 · draws **8–462**                                                                                                                                                                             |
| 13  | 07-14 20:36 | [ingame-particles](opensa-engine/2026-07-14-ingame-particles.json)                                                                                                                                                                                                             | **in-game sweep**, 6 scenes                    | commit `3cf13e7` (reflections v1 + 2dfx particles/coronas B5r+B6), same pak                                                                                                                                   | 120 fps · p95 ≤ 9.4 · draws **8–463**                                                                                                                                                                                     |
| 14  | 07-18       | [series](opensa-engine/2026-07-18-series.md) + [preflip-baseline](opensa-engine/2026-07-18-ingame-preflip-baseline.json)                                                                                                                                                       | **in-game sweep**, 6 scenes, engine vs prod    | M3 Pro @2× retina, **841 road cars**, after the 07-18 fix batch (night-NaN, live-VFS timecyc, fog dissolve, regional weather). **Pak build unrecorded.**                                                      | **119.6–120.3 fps** · p95 9.2–9.3 · draws **11–1065** · pass 1.85–4.09 · probe 0.23–0.55 · submit 0.33–0.49                                                                                                               |
| 15  | 07-20       | [ingame-regression](opensa-engine/2026-07-20-ingame-regression.json)                                                                                                                                                                                                           | **in-game sweep**, 6 scenes                    | same machine, same 841 cars, **after a pak rebuild**. Chat paste, not a file capture.                                                                                                                         | **58.3–117.3 fps** · p95 **17.5–56.2** · draws 19–1678 · pass 1.80–**12.56** · probe 0.53–1.94 · submit 0.20–**3.33**                                                                                                     |
| 15b | 07-19/20    | bisect, 4 files: [B `95bd544`](opensa-engine/2026-07-19-ingame-95bd544.json) · [C `52b4ec9`](opensa-engine/2026-07-20-ingame-52b4ec9.json) · [D `03f05b1`](opensa-engine/2026-07-20-ingame-03f05b1.json) · [HEAD `436d2f2`](opensa-engine/2026-07-20-ingame-436d2f2-head.json) | in-game sweep, 6 scenes                        | four-point commit bisect of the 07-18 → 07-20 jump, all on ONE fixed pak, same machine, 841 cars; chat pastes                                                                                                 | no commit in the window caused it — identical draws, noise-level frame times; only D costs ~5 % on the two heaviest scenes. Narrative in [readme.md](readme.md)                                                           |
| 18  | 07-21       | [http-dir-sweep](opensa-engine/2026-07-21-http-dir-sweep.md) + [json](opensa-engine/2026-07-21-httpdir-sweep-8eaa287.json)                                                                                                                                                     | headless sweep, 6 scenes                       | first sweep through the REAL loader (`?loader=http-dir`, plan 079 phase 3), fresh `10:45 21-07` build, DPR 2                                                                                                  | 120 fps all six · late 0 · draws 16–1647 (**+57/+71 % vs 07-18 on lv-night/country** — the fuller build)                                                                                                                  |
| 19  | 07-21       | [scale-ladder](opensa-engine/2026-07-21-scale-ladder.md) + [json](opensa-engine/2026-07-21-scale-ladder.json)                                                                                                                                                                  | headless sweep ×3 (`?scale=1/0.75/0.5`)        | 072 tier-ladder decision data; same build/harness as #18, DPR 2                                                                                                                                               | 120 fps everywhere · pass −4…−32 % at 0.5 (floor ~2 ms is resolution-independent) · targets 345→88 MB · **no ladder needed**                                                                                              |
| 20  | 07-21       | [soak30-headless](opensa-engine/2026-07-21-soak30-headless.json)                                                                                                                                                                                                               | headless `?soak=30`, 102 legs                  | 063 cell-disposal GPU-leak check; same build/harness, DPR 2                                                                                                                                                   | **PASS 8/8** · residency 1805→1804 MB · texture 1277→1276 · heap flat · late 0 · long tasks 0 — **no leak**                                                                                                               |
| 21  | 07-21       | [layer-decomposition](opensa-engine/2026-07-21-layer-decomposition.md) + [json](opensa-engine/2026-07-21-ingame-layer-decomposition.json)                                                                                                                                      | in-game `?bench=all`, 8 scenes, ×6 builds      | THE 6-layer build decomposition (original/mods/opt/trees/procobj/all), each `.work` stage re-converted through opensa-pack; user's display, **1126 road cars**                                            | **trees = ~90 % of the regression** (ganton pass 5.36→13.72 ms, 53 fps) · procobj/lods ≤ +0.4 ms · opt buys nothing · same tris cost 3.3× at street level → **overdraw-bound, not geometry**                              |
| 22  | 07-21       | [trees-no-greenpiece](opensa-engine/2026-07-21-ingame-trees-no-greenpiece.json) (analysis in [layer-decomposition](opensa-engine/2026-07-21-layer-decomposition.md))                                                                                                           | in-game `?bench=all`, 8 scenes                 | A/B on the `trees` layer with mod `39. Green Piece 1.47` stripped (233 placements + 210 linked LODs, index-safe) and re-packed; pack verified 1123 cells / 1.048 GB vs the 1.054 GB reference; 1126 road cars | ganton pass **13.72 → 7.63 ms**, fps **53.0 → 81.8** · tris −18 % but pass −44 % → **cost is per-pixel, not per-triangle** · 6.09 of the trees layer's 8.36 ms from 2.1 % of the map's vegetation · 6 control scenes flat |

### The rows that were only tables until now

| #   | Date  | File                                                                                       | Conditions                                                               | Headline numbers                                                         |
| --- | ----- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 0   | 07-11 | [early-milestones](opensa-engine/2026-07-11-early-milestones.json)                         | M0 first light: synthetic 12×12, then ls-bench (40 entries)              | 8.33 ms vsync · GPU **1.44 → 1.84** · draws 528 → 807 · resid 224→294 MB |
| 13  | 07-16 | [ingame-display-c1](opensa-engine/2026-07-16-ingame-display-c1.json)                       | user's display, **841 road cars** — partner of the prod 07-17 row        | **120 fps all six** · p95 ≤ 9.2 · draws 11–1 243 · pass 1.86–3.48        |
| 16  | 07-18 | [headless-regional-weather](opensa-engine/2026-07-18-headless-regional-weather.json)       | after the regional-weather fix (074/21); headless DPR 2                  | 119.8–120 fps · world pass 1.58–2.12 · draws 9–1 044 · late 0            |
| 17  | 07-18 | [headless-postteardown-ritual](opensa-engine/2026-07-18-headless-postteardown-ritual.json) | the 074/13 phase-8 ritual after `three` was deleted; same harness as #16 | 119.9–120 fps · pass 1.94–2.40 · draws within ±5 of #16 — **PASS**       |

## Ganton, street level — WITHDRAWN (2026-07-20)

The `ganton-noon` / `ganton-night` datasets and the `?scale=0.75` decomposition that stood here were
**deleted as invalid**. Every one of them was taken through the folder picker, and at the time the folder
picker did not select the world: `engine-canvas-host.tsx` always fetched the pak from `public/pak-map`. So
the runs measured whatever sat in `public/`, not the pak they were labelled with, and the pak-to-pak
comparisons they supported measured nothing at all.

The scenes themselves (`bench-scenes.ts`) are kept — the street-level path was the right idea. The pak
source now follows the loading mode (plan 079: folder mode reads `opensa/` from the picked folder, and the
harness boots `?loader=http-dir&src=<served build>`), so re-measured runs are trustworthy again.

## What the chronology shows

**07-12 → 07-13, lab:** the world got heavier feature by feature and the GPU pass tracked it honestly —
1.94 ms (bare drive) → 2.08 (sun-vis) → 2.79 (HD wind) → 2.86 (timed objects at night) → 3.53 (stochastic
coronas) → 3.64 (light pool). Every step stayed vsync-locked; the pass number is the only one that moved,
which is exactly how these rows should be read.

**07-14 → 07-18, in-game:** draws roughly doubled (462 → 1065 at the top end) while fps held at 120. That
jump is content, not regression — the 07-18 batch restored fog/draw distance via the regional weather remap,
so more world became visible. Cost stayed inside the budget.

**07-18 → 07-20: not a break — a fuller map.** A four-point bisect on a fixed pak (B `95bd544`,
C `52b4ec9`, D `03f05b1`, HEAD `436d2f2`) put identical draw counts and noise-level frame times at every
point, so no commit in the window caused it. The pak is the improved map — our LODs, vegetation and
procobj — and the 07-18 baseline predates them. `ocean-horizon`, the only scene without that content, did
not move. Full tables in [readme.md](readme.md).

**07-21: answered.** Rebuilding the map one pmb stage at a time (#21) put **~90 % of the regression on the
`trees` stage alone** — procobj and lods cost ≤ 0.4 ms and are retired as suspects, and the `optimize`
stage turned out to buy nothing measurable. A follow-up A/B (#22) traced **73 % of the trees cost to one
placement-only mod** ("39. Green Piece 1.47", 233 instances): removing it took ganton-noon from 13.72 to
7.63 ms of pass, 53 → 82 fps. Triangles fell 18 % while the pass fell 44 % and draws did not move, so the
cost is **per-pixel foliage fill** — draws and triangle counts mislead on these scenes. The mod was deleted;
all other foliage work is parked. Analysis:
[layer-decomposition](opensa-engine/2026-07-21-layer-decomposition.md).

**07-24: 087 LOD-ring rebuild — perf-neutral, pak 12 % smaller.** The fresh `original` rebuild after the
087 arc (per-game `PACK_RECTS`, per-cell `aabb` rings, bake grid 256→250, water row-C fix) benchmarks
**within noise of the 07-20 `436d2f2` head** on every shared scene (ls-noon 112.2, lv-night 76.2,
country-dusk 60.5, ls-rain-night 117.7, ocean-horizon 120), with `sf-fog-dawn` a touch faster (105.4→113.7,
draws 1019→995) — and it did so with a **34 % fuller car population** (1126 road cars vs 841), so the ring +
250-bake work is free. The pak shrank from **1 453 903 872 B → 1 272 901 632 B (−181 MB, −12.4 %)** at the
same 1137 cells: the 250 bake + aabb rings dropped bytes with no coverage loss. This is the 078 merge-gate
re-baseline (fps re-measured with `admiral`/`comet` converted — road cars ≠ 0 — plus the mapper pak-size
delta). Run: [`2026-07-24-ingame-617556f-087ring.json`](opensa-engine/2026-07-24-ingame-617556f-087ring.json).

**07-24: IfpSampler crossfade microbench (plan 088/02, CPU-only).** The two-clip blended sample costs
**8.24 µs vs 6.01 µs single** (1.37×) on a synthetic 32-bone/20-key clip, 20k iterations — one extra
per-bone evaluate + slerp. Invisible next to the ~2 ms pass floor; crossfades shipped with no perf gate.
Not a scene run (no pak, no GPU). Run:
[`2026-07-24-microbench-ifp-sampler-blend.json`](opensa-engine/2026-07-24-microbench-ifp-sampler-blend.json).

**07-25: camera director wired in (plan 080/01), headless check.** `ls-noon` on the 087-ring pak ran
**120 fps / 8.334 ms avg, p95 9.2, draws 1181** — vsync-capped, so it proves the bench path still runs and
draws the same class of frame, NOT the absence of a small CPU cost. Taken by Claude headless (DPR=2, road
cars 296), so it is not pass-comparable to the user's in-game rows. The director itself was microbenched
instead: **0.078 µs mean / 0.089 µs p95 per `stepCamera` call**, against plan 080's 0.1 ms p95 budget —
**0.185 µs / 0.208 µs once 080/02's smoothing channels went live** (2.4×, still 240× under the stage
budget) and **0.203 µs / 0.214 µs with 080/03's auto-center + look-ahead on top**. Run:
[`2026-07-25-headless-080-camera-director.json`](opensa-engine/2026-07-25-headless-080-camera-director.json).

### 2026-07-25 — the 080 close-out sweep (the bench-bypass proof)

The full ritual 8-scene `?bench=all` leg with the WHOLE camera chain live (rig + composition + collision +
vehicle camera + additive motion), headless, on the dev machine. **`ls-noon` 8.333 ms avg / 1181 draws
against the 080/01 headless row's 8.334 / 1181** — identical, which is the point: a running bench owns the
frame outright (`resolveCamera` priority bench > fly eye > follow rig), so camera work cannot move these
numbers, and now it is measured rather than argued. The other seven scenes had no headless predecessor and
are recorded as the headless baseline (every leg is vsync-capped at 120 fps, so this sweep can prove the
bypass but cannot resolve a small CPU regression — the user's in-game rows remain the pass-comparable
series). The director itself costs **0.568 µs mean / 0.620 p95** per call with every layer live, and the
camera issues **2 casts/frame** (one sphere cast — the whiskers are off since the 04 field round — plus one
ground ray) against a budget of 5. Run:
[`2026-07-25-headless-080-closeout-sweep.json`](opensa-engine/2026-07-25-headless-080-closeout-sweep.json).

### 2026-07-27 — what the CARS cost per fixed step (081/07 §3)

The first sweep to carry the `vehicles` field: the raycast controllers plus the vehicle system's fixed
update, per fixed step, beside the live car count. Same canonical pak (buildTime `08:41 24-07-2026`),
headless, M3 Pro. **The budget was written for 8 live cars; the bench world runs up to 80.** Per step:
`ls-noon` **0.605 ms at 80 cars**, `sf-fog-dawn` 0.555 at 66, `lv-night` 0.484 at 58, `ls-rain-night` 0.547
at 57, `country-dusk` 0.176 at 13, `ocean-horizon` **0.003 at 0** — so the slice is ~**7.6-9.5 µs per car**
and costs nothing when there are no cars. Eight cars is therefore ~**0.07 ms**, about a seventh of the
0.5 ms budget, and even the 80-car scene sits at 0.6 ms — a tenth of the fleet's worth of headroom.
Run: [`2026-07-27-headless-vehicle-step-cost.json`](opensa-engine/2026-07-27-headless-vehicle-step-cost.json).

### 2026-07-27 — the same slice, three times: it repeats to ±5 % (081/07 close-out)

The 081 close-out re-ran the sweep twice more — after plan 06 landed air control and camber, and again after
the camber geometry moved from per-step to per-car. Same pak, same harness, same machine, `vehicles.meanMs`
per fixed step:

| scene         | live | before 06 | after 06 | after the memo |
| ------------- | ---: | --------: | -------: | -------------: |
| ls-noon       |   80 |     0.605 |    0.639 |      **0.663** |
| sf-fog-dawn   |   66 |     0.555 |    0.613 |      **0.554** |
| lv-night      |   58 |     0.484 |    0.515 |          0.535 |
| ls-rain-night |   57 |     0.547 |    0.583 |          0.579 |
| country-dusk  |   13 |     0.176 |    0.186 |      **0.166** |
| ocean-horizon |    0 |     0.003 |    0.004 |          0.006 |

**Read the columns across, not down.** `sf-fog-dawn` and `country-dusk` end BELOW where they started while
`ls-noon` ends above, so the ~5 % spread is the metric's own repeatability, not the change — the per-car
camber arithmetic is under its noise floor, and so was the work removed from it. **A single vehicle-slice
number is worth ±5 %**, which is what the next tuning round needs to know before reading two of them as a
regression. `lateCreates` is **0** on all six scenes in all three runs: the 841 registered road cars stream in
and spawn without a late model build, which is 07 §1's mass spawn-sanity check.
Run: [`2026-07-27-headless-081-closeout-vehicle-step.json`](opensa-engine/2026-07-27-headless-081-closeout-vehicle-step.json).

### 2026-07-27 — the texture-upload hitch, before/after the budgeted drain

The 15–85 ms between-frames stall located earlier the same day (a whole texture array uploaded in the pak
worker's `message` handler) was fixed by making the upload resumable: decode + `createTexture` in the
handler, the (layer, mip) writes drained from `StreamingDriver.update` at ≤1.5 ms/frame. Same `u-turn` lap,
same pak (`08:41 24-07-2026`): the drive's streaming-driven slow frames went from `blob` 84.7/65.8/59.5/15.2
ms to **zero slow frames during the drive**; worst single handler call 84.7 → 0.1 ms; the one boot-adjacent
frame with stream cost reads `blob 0.4 worst 0.1 upload 1.5` — the drain sitting exactly on its budget. The
remaining boot/spawn `other` 19–134 ms frames are the still-unmeasured second door (the vehicle-model build
resolving from a worker `onmessage` continuation).
Run: [`2026-07-27-headless-texture-upload-hitch-fix.md`](opensa-engine/2026-07-27-headless-texture-upload-hitch-fix.md).

### 2026-07-27 — user's in-game re-baseline after the texture-upload fix

The user drove first (field verdict: no lags noticed) and then ran `?bench=all` on the same session — same
pak and host as the 07-24 `617556f` baseline, so the two sweeps compare directly. **Performance-neutral on
every scene**: seven of eight within a tenth of a millisecond; `lv-night` moved 13.121 → 13.784 avgMs
(76.2 → 72.5 fps) with an IDENTICAL gpu pass (8.692 vs 8.668) — a CPU-side wobble at the single-run ±5 %
noise boundary, not a regression. Neutral averages are the fix's expected shape (it buys smoothness, not
throughput); the smoothness itself shows in the same paste's `[slow]` lines — every streaming slow frame
reads `blob ≤0.6 worst ≤0.4 upload ≤2.4` where the pre-fix shape was one 15–85 ms `blob` call, and
`lateCreates` is 0 on all eight scenes, so the pop-in price did not materialize. What remains slow are
scene-teleport/spawn frames (`other` 76–225 ms — the vehicle-model-builder door, still unmeasured) and
`country-dusk`'s known GPU-bound pass.
Run: [`2026-07-27-ingame-after-texture-upload-fix.json`](opensa-engine/2026-07-27-ingame-after-texture-upload-fix.json).

### 2026-07-27 — 080/09 follow-policy microbench: the new writers cost nothing measurable

The camera revision (directional yaw authority, run/idle distance breathing, the vehicle launch stretch)
re-ran the 080-series stepCamera microbench with the new writers live every step: foot 0.51/0.60 µs
mean/p95, vehicle 0.68/0.79 — ~60–100× under plan 080's 0.05 ms budget. A DIFFERENT trace from the
2026-07-25 rows (the foot leg runs away so the authority works every step), so compare against the budget,
not row-to-row.
Run: [`2026-07-27-microbench-080-09-follow-policy.json`](opensa-engine/2026-07-27-microbench-080-09-follow-policy.json).

### 2026-07-28 — plan 091: the spike frames, finally decomposed

A headless `?bench=all` sweep taken FOR the `[slow]` lines rather than for the averages (which are all at
the 120 Hz headless cap: 8.33 avgMs, p95 9.2–9.3, `lateCreates` 0 on every scene, gpu pass at or below the
07-27 row). Three findings, all from the same run:

- **The boot frame is 576.1 ms, not 250.** `dt` is clamped at 250 ms for the simulation and the line used to
  print the clamp, so a third of the worst frame in the record had never been visible.
- **Roughly half of a teleport spike is now named**, and both named costs are **per NEW car type**: the
  `.osm` read + parse (worst single 20.5 ms — `bus`) and the GPU upload (worst single 18.2 ms — `tahoma`);
  typical types are 0.5–2 ms. A bench teleport pays 27–43 of them in one frame, which is a bench shape — in
  play a type arrives alone. Cell collision is the other named cost (COL parse 9.6–78.3 ms, Rapier bodies
  5.6–28.1 ms).
- **`unattributed` still holds 40–55 % of a spike**, and 100 % of the two frames that FOLLOW a teleport
  (68.2 and 38.9 ms with no span open at all) — GC-shaped, and the honest next question.

The two earlier runs of the same day are in the file's `priorRuns`: the pre-091 baseline, where `other` was
one anonymous number (223.6 ms on the boot frame) with nothing under it, and the intermediate three-span run
that still left 163.8 ms unattributed — which is what sent the last two spans into the adapter. **Careful:
the baseline's `250.0` boot frame and this run's `576.1` are the SAME frame**, not a regression; the first
printed the clamp.
Run: [`2026-07-28-headless-091-frame-attribution.json`](opensa-engine/2026-07-28-headless-091-frame-attribution.json).

### 2026-07-28 — plan 089/01: the dynamic one-shot particle lane, priced at its probe worst case

HUD-read numbers from three `gate-check.js` boot screenshots (NOT a sweep — single Grove Street night boot,
player idle, DPR=1). The probe (`?fxprobe=prt_collisionsmoke`, 60 spawns/s × 5 s life ≈ 300 live one-shot
particles) parks a plume beside the player that fills about a third of the 1440×900 viewport — a denser
fill than any single gameplay effect will produce. Cost: **+2.3 ms GPU at that worst-case coverage**
(2.77 → 5.10 ms submit), +1 draw call, frame pinned at the 120 Hz cap throughout; the CPU side (pool
spawn/prune + one ~10.8 KB partial `writeBuffer` per frame) does not register. The delta is overdraw-bound —
it scales with the plume's SCREEN COVERAGE, not with the particle count.
Run: [`2026-07-28-headless-089-dynamic-particle-probe.json`](opensa-engine/2026-07-28-headless-089-dynamic-particle-probe.json).

### 2026-07-28 — plan 089/02: tyre smoke on the brake-strip lap (and the dead rotation channel)

HUD-read from screenshots of the scripted brake-strip lap with tyre smoke live: at gameplay-shaped coverage
(two wheel plumes trailing a braking infernus) the frame stays at the 120 Hz cap, GPU 1.87 ms — the smoke
does not register; 089/01's +2.3 ms worst-case fill stays the lane's cost story. The run also recorded the
SIGNAL finding: Rapier's `wheelRotation` follows the ground exactly (max 0.05 m/s of rotation-derived slide
during the sustained −1.1 g locked stop), so rotation-based slip can never see a lockup or burnout — the
shipped signal is demand-over-cap recorded by `setVehicleControls`.
Run: [`2026-07-28-headless-089-02-brake-strip-smoke.json`](opensa-engine/2026-07-28-headless-089-02-brake-strip-smoke.json).

### 2026-07-28 — plan 089/02 close-out: the "performance dropped" impression, answered with a sweep

A field impression after three smoke-tuning rounds ("perf dropped a little, in general, not during braking")
against a full `?bench=all` sweep on the branch: **no regression** — every scene at the 120 Hz cap, gpu pass
within ±0.04–0.16 ms of the same-day 091 reference in both directions, draw counts equal within units. The
impression's own `[slow]` lines showed a GPU-bound frame at display resolution with the car population
fluctuating 950 → 1623 bodies plus the known cell-collision spikes — none of it branch-attributable (an idle
dynamic lane issues zero draws and zero writes; the user also noted other host processes may have interfered).
Run: [`2026-07-28-headless-089-02-no-regression-sweep.json`](opensa-engine/2026-07-28-headless-089-02-no-regression-sweep.json).

### 2026-07-28 — plan 089/03: the skid-mark decal lane on the brake-strip lap

HUD-read from lap screenshots (not a sweep): ~280 laid segments — two full braking ribbons — with GPU
submit in the same range as the day's lane-less runs; no measurable delta at gameplay-shaped mark counts.
The lane's steady cost is structural: one ~168 B upload per laid segment, ranged draws over LIVE segments
only (expired ones leave the window), one 344 KB buffer + a 32² texture at install.
Run: [`2026-07-28-headless-089-03-skid-marks.json`](opensa-engine/2026-07-28-headless-089-03-skid-marks.json).

### 2026-07-28 — plan 089 close-out: the vehicle-effects chain prices at zero on the sweep

All five steps merged, full `?bench=all` vs the same-day 091 reference: every scene at the 120 Hz cap,
gpu pass within ±0.05–0.25 ms in both directions (bench car populations differ run to run), draws equal
within units. The chain's real prices are per-event, recorded in the step runs: +2.3 ms GPU at the probe's
worst-case ⅓-viewport plume (overdraw-bound), ~10.8 KB/frame particle upload at full smoke, ~168 B per
laid skid segment, one surface ray per contacting wheel per fixed step (driven car only).
Run: [`2026-07-28-headless-089-closeout-sweep.json`](opensa-engine/2026-07-28-headless-089-closeout-sweep.json).
Audit: [`../audit/vehicle-effects-089.md`](../audit/vehicle-effects-089.md).

### 2026-07-29 — plan 092: the alpha-mask rule costs nothing on the sweep (but the pass column is not an A/B)

The first pak carrying the mask classification — 1 602 textures out of the blend pass into the depth-writing
cutout pass (shipped layers: 1 422 cutout / 661 soft-blend / 380 opaque across the pak's 43 RGBA8 arrays).
All eight scenes at the 120 Hz cap, p95 9.2–9.3, `lateCreates` 0, unchanged. **The `gpuMs.pass` deltas are
NOT attributable**: the 07-28 baseline read a different pak (buildTime 08:41 24-07-2026), and the largest
moves land where the rule cannot reach (ocean-horizon 1.961 → 0.915 at 27 draws). Two paks from the same
tree with only the rule flipped is the run nobody has taken.
Run: [`2026-07-29-headless-092-alpha-cutout-sweep.json`](opensa-engine/2026-07-29-headless-092-alpha-cutout-sweep.json).

### 2026-07-29 — plan 093: the world ambient term costs nothing (and this one IS a clean A/B)

The engine gained SA's additive ambient term + the deliberate day floor
(`max(lin(timecyc Amb) × knob, 0.13 × (1 − dn))`) in `worldShade`/clutter; frame uniform 100 → 104
floats. Same pak as the 092 row (buildTime 10:53 29-07-2026 — the change is engine-side only), same
harness: all NINE scenes at the 120 Hz cap, p95 9.2–9.3, `lateCreates` 0, `gpuMs.pass` 1.50–2.69
within the 092 band. One MAD per fragment is noise-level, as expected. The sweep also debuts
**`strip-noon`** (south Strip street level at the Flamingo block, added after the 093 field round):
119.9 fps steady-state — proving the field-reported hitches at that spawn are the COLD-LOAD
transient (first-frame `cell-collision-read` 235 ms, then ~20 frames of 110–170 ms mostly
UNATTRIBUTED while cells stream 0 → 95, plus the known per-type vehicle build), not a regression.
The unattributed transient and a `[slow]`-line double-count (collision counted in both `collision`
and `other` → `unattributed -226.1`) are the queued 091 follow-up inputs.
Run: [`2026-07-29-headless-093-world-ambient-sweep.json`](opensa-engine/2026-07-29-headless-093-world-ambient-sweep.json).

### 2026-08-01 — video mode's own per-frame cost (096/08)

Not a sweep: what the VIDEO MODE module adds to a frame, measured directly rather than by an on/off
comparison (with video off nothing drives, nothing streams and the camera does not move, so the difference
would be the scene, not the module). Its whole per-frame footprint is one call, and over **235 348 frames of
a 32.7-minute unattended run** it averages **0.0096 ms** — under a fiftieth of a millisecond, i.e. under
0.2 % of a 120 Hz frame; drive-only scenes, the expensive kind, average 0.0172 ms. `performance.now()` is
coarsened to 0.1 ms headless, so only the mean is a measurement. The same run carries the soak evidence
(settle flat at 249-250 ms across all 40 scenes, no drift in step cost or safe frame, 0 throws) and the
staging timeline. Run:
[`2026-08-01-headless-video-mode.json`](opensa-engine/2026-08-01-headless-video-mode.json).

### 096/09 — what the planted-shot occlusion check costs (2026-08-01)

A `flyby` now checks the line to the car before it plants, walking three candidate spots. Over two runs
(seed 47 scenes 1-4, seed 911 scenes 1-10; 14 captures, 77 024 directed frames) the worst per-frame cast
count anywhere was **3**, inside 080's ≤ 5 rule with the follow rig's 2, and `stepMs` stayed at
**0.0153-0.0180 ms** against 08's drive-only 0.0172 — the check is free at this resolution. **`blockedPlants`
was 0 in both**: three plants, three clear authored spots, so the ladder has never actually been walked in a
measured run. That bounds how common the problem is; it is not evidence it cannot happen. Run:
[`2026-08-01-headless-planted-occlusion.json`](opensa-engine/2026-08-01-headless-planted-occlusion.json).

### 091 — the field drive that closed the fork (2026-08-02)

The first row in this record taken from a HUMAN DRIVE rather than a harness: one continuous session,
Ganton → Downtown LS → the countryside → the desert → the whole of Las Venturas, in a `comet`, censused from
the game's own `[slow]` lines (every frame over 20 ms). **223 slow frames, p50 21.9 ms, only four above
30 ms** — and **zero of them carried a vehicle span**, so the per-type car cost 091 was written to bound
(worst `bus` 20.5 + `tahoma` 18.2 ms) never landed on a slow frame across four popcycle zones. What the slow
frames actually are: **GPU pass mean 13.73 ms (max 19.79) against a CPU render of 0.1–0.6 ms**, 204 of 223
above 8 ms. `unattributed` on a real drive is the CPU waiting on the GPU, not the GC tail the bench shape
suggested. Run:
[`2026-08-02-drive-091-field-verdict.json`](opensa-engine/2026-08-02-drive-091-field-verdict.json).

**Read the note before comparing it to anything**: it is a DEV build, it carries no pak buildTime (the
console was opened after boot) and no timestamps, and it is a census, not a scripted sweep.

### 091 — the re-drive on a POPULATED map, which closed the fork (2026-08-02)

The same day's second drive, after the map got its cars back (059's 1043 generators wired in, `parked.json`
registered lazily): LS → countryside → SF → Chilliad → LS → Las Venturas at dusk. **1004 slow frames, p50
21.3 ms, p90 24.1** — a *tighter* distribution than the empty-map run (21.9 / 25.0) with five times the cars,
though the raw counts are not comparable (neither run recorded its duration).

**`vehicle-spawn` spans appeared for the first time** — 14 frames over 12 models, at **0.2–0.3 ms each**, free.
**`vehicle-osm` and `vehicle-model` stayed at zero**, and now that is evidence rather than an empty world: the
per-TYPE cost never coincides with a frame the game calls slow when types arrive one at a time. GPU pass mean
rose 13.73 → **15.64 ms** (max 21.89, draws p50 1049 → 1113) — that is what the cars cost, and it is the same
GPU-bound shape the first drive found. Run:
[`2026-08-02-drive-091-populated-map.json`](opensa-engine/2026-08-02-drive-091-populated-map.json).

### 097/07 — the CLEO VM cost close-out (2026-08-06)

The 097 big-rework benchmark, headless-first: the whole shipped corpus costs **465 µs/tick** on the
VM (boot 0.23 ms for 7 scripts, `enabled: false` = one branch, tracer ×1.9 as a debug toggle) — and
the run CAUGHT a field bug: both hosts answered `carInSphere` ignoring `findNext`, so vandoor's
recursive walk never exhausted and burned its full 10 000-instr budget every tick (corpus 3 771 →
465 µs/tick after the walk-cursor fix, vandoor ~100×). Field verify on `build/original/opensa`:
census 6 scripts, F2 CLEO screen live at 1 572 instr/tick, 21 script objects. Same-day frame-level
A/B/A (`?bench=all` ×3, run-order controlled): CPU frame parity (avg 8.33 ms, p95 ~10, 120 fps in
all three variants), GPU pass +0.45 ms mean with CLEO on — the RENDER cost of the wheel/turbines
existing (ocean-horizon 27 → 84 draws, 136 k → 843 k tris), not VM cost. Analysis:
[`2026-08-06-headless-cleo-vm-cost.md`](opensa-engine/2026-08-06-headless-cleo-vm-cost.md); raw
rows [`2026-08-06-ingame-cleo-ab.json`](opensa-engine/2026-08-06-ingame-cleo-ab.json).
## Mobile

Newest first. The 08-09 row is the chain's baseline; everything above it in date order is first-light or off-ground record — see each `note`.

| Date | File | Harness / scene | Conditions | Headline numbers |
| --- | --- | --- | --- | --- |
| 08-04 | [mobile-first-light](opensa-engine/2026-08-04-mobile-first-light.json) | dispatch console status bar, `?demo=1` | **Mali-G51 / Android 10**, Yandex Browser 26.6 (Chromium 148), 360x800 CSS px @ DPR 2. SYNTHETIC world (no pak — this GPU has no BC). Needed `#enable-unsafe-webgpu` + the same day's "BC optional at device creation" change. No `timestamp-query`, so no GPU timings. | **41 fps** · cells 38/144 · draws 162 · resident 37 MB |
| 08-07 | [mobile-district-inventory](opensa-engine/2026-08-07-mobile-district-inventory.json) | dispatch console, `?inventory=1`, streamed district pak (`23:12 07-08-2026`, rect 9,-7,10,-6 Ganton) | **Mali-G51 / Android 10**, 360x364 CSS px @ DPR 2. FIRST real-world mobile row on a streamed SA district — supersedes the synthetic 08-04 row. 2482 frames / 209 s, `warnings` empty. No `timestamp-query`, so GPU time is ABSENT; `spans` empty (static camera, 4 resident cells). Taken on Ganton, **not** on 201/1-01's pinned `los-santos-centre`. | **31 fps** · p50 31.8 ms · p95 51.3 ms · submit 1.78 ms (5.6 % of frame) · cells 4/4 · draws 121 · **resident 239 MB** |
| **08-12** | **[mobile-pinned-district-astc](opensa-engine/2026-08-12-mobile-pinned-district-astc.json)** | dispatch console, `?inventory=1`, ASTC pak of the pinned district, camera at street level (h 29.7) | **Mali-G51**, 685 frames / 24.1 s, `warnings` and `errors` both empty. The format A/B's ASTC side against the 08-09 rgba8 rows, and the run that proved the `requireFormatSupport` fix — the capture 3.5 h earlier on this same pak had all 20 arrays refused as "BC-compressed" and streamed nothing. | **resident 74.9 MB against 148 MB on rgba8** — texture category **25.81 MB**, a quarter of the same texels as RGBA8 · and `target` **36.54 MB** is now the LARGEST category, bigger than every texture · 31 fps · p50 32.0 ms · p95 51.4 ms · cpu share **16.5 %** · cells 4/4 · draws 111 |
| **08-09** | **[mobile-pinned-district-bytes](opensa-engine/2026-08-09-mobile-pinned-district-bytes.json)** | dispatch console, same pak and district, camera WORKED to street level (h 25.7) — the bytes column fills with what the streamer requests | **Mali-G51**, 799 frames / 33.1 s, `warnings` empty. 201/1-01's BYTES table: what the surface reads against what the build contains. | **36.4 MB read in 28 requests** — texture arrays **20 of 20 (99.9 % of the pak's texture payload)**, water 2.66 MB, cells 4 hd + 3 lod of 8 · **collision: ZERO requests** against a 49 870-triangle bake · cpu share **15.9 %** · body max **1068 ms** on one frame |
| **08-09** | **[mobile-pinned-district-inventory](opensa-engine/2026-08-09-mobile-pinned-district-inventory.json)** | dispatch console, `?inventory=1&district=los-santos-centre`, pak `02:47 09-08-2026` (rect 5,-7,6,-6, `--textures rgba8 --max-texture 256`) | **Mali-G51 / Android 10**, 360x364 CSS px @ DPR 2. **THE 201/1-01 BEFORE-TABLE** — clean by the collector's own test (`warnings` empty), 414 frames / 153.9 s, 4/4 cells, on the PINNED ground. Supersedes the 08-07 Ganton row as the chain's baseline. No `timestamp-query`; `spans` empty (all cells resident). | **33 fps** · p50 30.3 ms · p95 48.1 ms · **CPU body 5.83 ms = 21.2 % of the frame** (idle 21.7 ms) · overlay-2d 2.44 > engine-frame 2.10 · draws 110 · tris 265 k · **resident 148 MB** |
| 08-07 | [mobile-inventory-void](opensa-engine/2026-08-07-mobile-inventory-void.json) | dispatch console, `?inventory=1`, first real district pak (`23:12 07-08-2026`, rect 9,-7,10,-6) | **VOID — DO NOT CITE.** Same Mali-G51. The world never streamed: `cellsTotal 0`, and the 113 494 triangles are exactly this pak's water mesh, so the capture is water over nothing. Taken 1.6 s after the collector started (15 frames). Also carries a poisoned `dtMax` — the first delta included page load, fixed the same day. | *none usable* — kept for the trap, not the numbers |

Not comparable with anything above it: different host, different world, no p95, no GPU timers. It closes the
gap `docs/features/mobile-controls.md` names ("no touch-device frame-time row exists"), and it is owed a
successor on a real `--rgba8` district.

### 100/04 — per-system fx cull distance (2026-08-08)

A/B on `build/original/opensa`, headless DPR=2: replacing the flat `DRAW_DISTANCE = 300` with each fx
system's authored `cullDist` (plus two recorded departures) is **below what the bench can measure**. The
verdict rests on a POSITIVE CONTROL, not on the A/B: forcing every emitter quad to collapse gives
`country-dusk` a GPU pass of 3.880 ms against 3.875 (after) and 3.867 (before) — culling every particle in
the map is indistinguishable from drawing them, so the scene has no power to judge this change either way.
The only column that moves is `avgTriangles`: `lv-night` −2890 of 2 049 828 (−0.14 %), which is 26 `fire`
anchors going from 300 u to their authored 35. `avgMs` is pinned at the 120 fps cap in every row. Rows:
[`2026-08-08-ingame-fx-cull-distance.json`](opensa-engine/2026-08-08-ingame-fx-cull-distance.json).

### Post-plan-100 rebuild — the density baseline (2026-08-08)

The first full rebuild after plan 100 shipped, and the "before" plan 07/04 owes: an 8-scene sweep at
TODAY's procobj density, against a pak that now carries 2dfx at **both** levels (particles 943 → **1831**,
roadsigns 481 → **962**, 1137 cells, buildTime `11:42 08-08-2026`). Nothing moved: `country-dusk` 3.868 ms
GPU pass against 3.875 on the pre-100 pak, `lv-night` 3.603 against 3.600, `avgMs` pinned at the 120 fps cap
throughout. **That is a baseline, not a verdict** — the positive control in the row above proves this sweep
cannot price emitter cost at all, and it never enters the 440–1000 u transition band where the doubling
question lives. Rows: [`2026-08-08-ingame-post-100-rebuild.json`](opensa-engine/2026-08-08-ingame-post-100-rebuild.json).

### Minor-8 re-pack — the baseline that still exists (2026-08-08)

The post-100 sweep above named a pak that was then replaced: the canonical build was re-packed onto `.oscell`
minor 8 (the roadsign glyph-quad count), so its rows point at a `buildTime` nothing on disk matches. The same
8 scenes re-taken on the pak that DOES exist (`13:19 08-08-2026`) are
[`2026-08-08-ingame-minor8-repack.json`](opensa-engine/2026-08-08-ingame-minor8-repack.json) — **this is the
density baseline plan 07/04 compares against**. Scene-to-scene `gpuMs.pass` moves between −0.16 and +0.14 ms
in both directions, which is run-to-run spread: minor 8 adds one header word per cell and no geometry, and the
positive control two rows up already showed this sweep cannot resolve differences of that size.

### Procobj density sweep — the arm that was cut, and why the sweep could not answer anything (2026-08-08)

Two builds were made for 07/04's opensa perf budget, both from the canonical build's kept `.work/5-trees`
stage so the ONLY variable is the procobj density: `bench-d1` (`--procobj-density 1`, vanilla) and `bench-d3`
(`--procobj-density 3`, the scatter's candidate ceiling, cap raised to 200 000 so it could not bind).

**The builds already answered the question the bench was meant to ask, and the answer is that the arms are not
arms.** Three times the candidates yields **15 840 objects against 15 286 — +3.6 %, not 3×** (rows 6 728 vs
6 487; pak 1 275 777 024 vs 1 272 020 992 B, +0.30 %; 1139 cells in both). No `CAP DROPPED`, so `procObjMax`
never bound: the extra candidates were culled by **MINDIST**, which is already saturated at vanilla density.
Two builds 3.6 % apart cannot price a streaming budget — the layer's whole GPU cost is 0.07–0.38 ms
([layer decomposition](opensa-engine/2026-07-21-layer-decomposition.md)), so 3.6 % of it is far below what
this instrument resolves.

The headless `d1` sweep was killed externally after 5 of 6 scenes and `d3` never ran headless; those partial
rows are [`2026-08-08-headless-07-04-density-d1-partial.json`](opensa-engine/2026-08-08-headless-07-04-density-d1-partial.json).
**The user then ran both arms in full on his own machine** (9 scenes each, in-game `?bench=all`):
[`2026-08-08-ingame-07-04-density-ab.json`](opensa-engine/2026-08-08-ingame-07-04-density-ab.json).

**Result: +3.6 % clutter costs nothing this instrument can see.** Six scenes come back with triangle counts
identical to ±0.0 % and `gpuMs.pass` within ±0.03 ms; `country-dusk` — the clutter scene — moves **+0.3 %
triangles for +0.013 ms**. That is the whole verdict, and it is a statement about 3.6 %, not about density.

**Three rows are contaminated, and the partial headless run is what identifies which arm is wrong.** The
scenes where the arms disagree do so by amounts no 3.6 % content change can produce — `sf-fog-dawn` −4.2 %
triangles, `lv-night` +15.5 %, `ocean-horizon` **+107.3 %** (the control scene, which
[the layer decomposition](opensa-engine/2026-07-21-layer-decomposition.md) showed does not move for ANY map
layer). In all three the `d3` arm agrees with the independent headless `d1` run (ocean-horizon 848 670 vs
846 535 triangles; lv-night 2 070 601 vs 2 058 684; sf-fog-dawn 1 483 818 vs 1 482 512) while the user's `d1`
arm is the outlier — so the content is the same and the **`d1` run's scene states drifted**, under-streaming
two scenes and over-streaming one.

That matches the defect the user reported on both runs: collision is lost across scene transitions (cars fall
through the ground) and the player falls when the sweep ends —
[`open-issues/bench-scene-transition-collision.md`](../open-issues/bench-scene-transition-collision.md).
**Until that is fixed, no scene-to-scene A/B on this harness can be trusted below its own drift**, which
these rows measure at up to 107 % of a scene's triangles.

What a real density measurement needs is a lever that MOVES the count, and the only one left is the authored
`procobj.dat` MINDIST — a data-honesty decision, not a knob.

### A/A reproducibility — is this harness a measuring instrument? (2026-08-08)

**No, not yet.** Two headless `?bench=all` sweeps of the SAME canonical pak (buildTime `13:19 08-08-2026`,
verified on disk) with **no content and no code change between them**, plus the minor-8 row set as a third
point. `avgTriangles` swings up to **10.19 %** (`lv-night`), 6.00 % (`sf-fog-dawn`), 3.27 %
(`ocean-horizon`) — and the outlier lands on a **different scene in each run**, so this is a lottery, not a
drift. `lateCreates` is **0 on every row**, including the ones 10 % apart.

Two candidate causes are ruled out by the rows themselves: `vehicles.live` is identical scene for scene
(24→24, 43→43, ocean-horizon 0→0) and so is `residency` to the megabyte (`cellVertex 193→193`). The world
loaded is the same; what is SUBMITTED differs, because the settle exits on a signal that answers for the
previous scene — four of nine settle in ONE frame, and `lv-night` begins measuring at 11 cells loaded / 81
queued. Full forensics, exact repro and the eight killed hypotheses:
[`open-issues/bench-scene-transition-collision.md`](../open-issues/bench-scene-transition-collision.md).

Rows: [`2026-08-08-headless-bench-aa-reproducibility.json`](opensa-engine/2026-08-08-headless-bench-aa-reproducibility.json)
— **evidence about the instrument, not a performance baseline; do not compare against them.**

### A/A again, after plan 102 — yes, it is an instrument now (2026-08-09)

Same question, same pak, same harness, one day later, with the settle chain fixed (notice → ring → **ground
under the anchor** → warp onto that ground → wait until he is **at rest** → warmup) and a warp reset derived
inside the character controller. `avgTriangles` spread per scene is **0.00–0.36 %** — `lv-night` went 10.19 %
→ **0.14 %**, `sf-fog-dawn` 6.00 % → **0.36 %** — and `avgMs` agrees to **≤ 0.02 %**. The camera-jump wall is
gone: **1** `[cam]` line per run against a baseline of **89 255**.

Eight of nine scenes now report `legStart.ok` true (`dz −0.08 m`, grounded, worst frame drop 0): the player
stands still where the settle put him for the whole leg. The ninth, `strip-noon`, is RED in both arms, and
the row says so instead of quietly measuring a falling camera — **its anchor was authored inside the
Flamingo**, fixed hours later the same day
([`open-issues/fixed/strip-noon-anchor-inside-a-building.md`](../open-issues/fixed/strip-noon-anchor-inside-a-building.md)):
moved to `[1933, 1127, 18]`, re-run clean (`dz −0.08 m`, grounded, 27 cars live, `avgTriangles` 1 893 061).
**Every `strip-noon` row in this record, including the two arms above, predates that fix and measured a
falling player.**

### The density A/B, re-taken on the repaired harness (2026-08-09)

The 07/04 question, asked again now that the instrument holds still. Three sweeps on the user's display lane
(oldmap · `bench-d1` · `bench-d3`, 1219 road cars and 212 parked on every arm, all nine scenes `legStart.ok`):
**d1 and d3 are indistinguishable** — `avgTriangles` 0.00–0.25 % apart, `avgDrawCalls` 0–3 calls, `avgMs`
≤ 1.6 % with the sign flipping between scenes, all of it under the harness's own 0.36 % A/A floor. The
2026-08-08 audit's finding stands, now on evidence: the selector shipped, the lever does not move anything.

Both d-builds do differ from the oldmap pak (+0.2…+1.5 % triangles, +5–7 % draws, same direction on both
arms) — so they carry something the old map does not; it is not the density value.
Rows: [`2026-08-09-ingame-user-display-density-ab.json`](opensa-engine/2026-08-09-ingame-user-display-density-ab.json)
and [`…-oldmap-baseline.json`](opensa-engine/2026-08-09-ingame-user-display-oldmap-baseline.json).
**`ocean-horizon` sits at the 120 fps cap on every arm — read its content columns, never its milliseconds.**

Rows: [`2026-08-09-headless-bench-aa-after-102.json`](opensa-engine/2026-08-09-headless-bench-aa-after-102.json).
The arm-A run that found the anchor-height defect on the way there:
[`2026-08-09-ingame-102-probe-arm-a.json`](opensa-engine/2026-08-09-ingame-102-probe-arm-a.json) —
**diagnostic, not a baseline.**

### A/A on the CURRENT pak — the content column is solid, the cost column is not (2026-08-09)

Plan 102's floor (worst-of-nine **0.36 %** triangles) was taken on the minor-8 pak of 08-08. lod-procobj
013's `opensa` perf budget will be read on the post-column-fix pak (13:53, **91 092** clutter objects), so
the floor was re-established there: two back-to-back headless `?bench=all` sweeps of the SAME build, Claude's
lane, M3 Pro, DPR=2, 1219 road cars, `legStart.ok` on all nine scenes in both arms, `lateCreates` 0.
Rows: [`2026-08-09-headless-aa-floor-current-pak.json`](opensa-engine/2026-08-09-headless-aa-floor-current-pak.json).

| column | worst-of-nine A/A spread | verdict |
| --- | --- | --- |
| `avgTriangles` | **0.094 %** (lv-night) | trustworthy — better than the 0.36 % of the lighter pak |
| `avgDrawCalls` | 0.52 % | trustworthy |
| `avgMs` | 0.62 % — but **SATURATED at the 120 fps cap** (8.333 ms) on 7 of 9 scenes, both arms | carries no signal on this machine at DPR=2 |
| `gpuMs.pass` | **13.37 %** (sf-fog-dawn) | the real cost floor, and it is large |

**What this bounds.** The harness holds still on CONTENT, so an A/B may be read on triangles and draws. It
does NOT hold still on cost: a single sweep's `gpuMs.pass` cannot resolve anything under ~13 %, and `avgMs`
is a frame cap rather than a measurement. So 013's perf budget has to come from HITCHING — `p95Ms`, `[slow]`
frames, stream stats — plus repeated `gpuMs.pass` samples, and never from one sweep's `avgMs`. The earlier
density A/B read `avgMs` on the user's uncapped display lane, which is why it could see 12.6 % there.

### The procobj density recovery — one scene moved, and it is the rural one (2026-08-09)

The first sweep on a pak built with `procobj.dat` read the way the game reads it (`area / spacing²`, no
MINDIST cull): the clutter layer went **15 286 → 91 092 objects**. User display lane, his run, same nine
scenes, 1219 road cars / 212 parked on both arms, all nine `legStart.ok`. Baseline is the same-day
[oldmap row](opensa-engine/2026-08-09-ingame-user-display-oldmap-baseline.json).
Rows: [`2026-08-09-ingame-user-display-procobj-recovered.json`](opensa-engine/2026-08-09-ingame-user-display-procobj-recovered.json).

| scene | avgMs | Δ | gpu.pass Δ | triangles Δ |
| --- | --- | --- | --- | --- |
| **country-dusk** | 16.366 → **18.434** | **+12.6 %** (61.1 → 54.2 fps) | **+16.3 %** | **+16.4 %** |
| strip-noon | 10.166 → 10.464 | +2.9 % | +2.3 % | +2.4 % |
| ls-noon | 9.452 → 9.564 | +1.2 % | +0.3 % | +0.9 % |
| ganton-noon / -night | 13.55 / 13.655 → 13.644 / 13.73 | +0.7 / +0.6 % | +1.5 / +0.6 % | +0.6 / +0.8 % |
| ls-rain-night · sf-fog-dawn · ocean-horizon | — | +0.4 / −0.1 / −0.0 % | +1.5 / +1.5 / +1.5 % | +0.9 / −0.1 / +6.7 % |
| lv-night | 14.321 → 13.898 | **−3.0 %** | +1.8 % | +1.7 % |

**Read it as one scene, not a regression.** Eight of nine sit inside ±3 %, and `lv-night` moved the wrong
way while its triangles rose — a car-heavy scene's run-to-run spread (`vehicles.maxMs` 1.1 → 0.7), not a
saving. The one real move is `country-dusk`, the only RURAL scene in the set, which is exactly where a
ground-clutter layer lives.

**The cost is GPU geometry, and the columns say so without inference**: `country-dusk`'s frame grew
**+2.07 ms** while its `gpu.pass` grew **+2.03 ms** — the whole delta is raster of the added triangles, with
CPU flat (`avgDrawCalls` +1.7 %, so it is not batching either). Across all nine scenes the ms delta tracks
the triangle delta; that is the relationship to watch when 07/04 sets a budget.

**What this run cannot say**, and it bounds any decision taken on it: the two paks differ in more than
procobj — their `report.json` says particles 943 → 1 831 and roadsigns 481 → 962 (`a48ffa2f`, `493fe926`
landed between the builds). Every rise above is an UPPER BOUND on the density's cost. `ocean-horizon` is at
the 120 fps cap as always — its +6.7 % triangles are the only readable column.

### The runtime clutter layer draws nothing on a built map — a NULL result (2026-08-10)

The pak bakes the procobj layer into its cells AND `updateClutter` feeds `adapter.cellClutter` into an
instanced render every frame, which reads like the clutter is drawn twice. It is not. Five single-scene
`country-dusk` sweeps, Claude's headless lane: `?procobj=0` and a per-cell cap swept **1 → 3000** both leave
`avgTriangles` unchanged to **0.007 %**, against this pair's own same-config A/A drift of **0.41 %**.
**Cause, by construction:** `convertProcObj` strips every species it bakes, so a built `data/procobj.dat`
carries **9 rules of 96**, all `P_UNDERWATERBARREN` — the runtime layer is alive with nothing to scatter on
dry land. The positive control failed on the SITE, not on the instrument.
Rows: [`2026-08-10-headless-runtime-clutter-null-result.json`](opensa-engine/2026-08-10-headless-runtime-clutter-null-result.json).

**What this settles for lod-procobj 013:** clutter load on `opensa` is a **BUILD-time** quantity. Neither
`?procobj` nor `?procobjLimit` is a lever for the streaming budget, so that measurement needs two BUILDS —
and one already exists on disk (`NO_COMMIT/old_map`, 15 286 objects, against today's 91 092).

**Also from these runs:** the new `hitch` block carries signal where the averages do not — `maxMs` spans
9.4–21 ms across five arms whose `avgMs` is 8.329–8.334 and whose `p95Ms` is 9–9.1. Its three streaming
columns (`blobMaxMs`, `uploadMaxMs`, `pendingMax`) printed 0 on every arm; a settled leg streams nothing, so
they still owe a positive control before a zero from them counts as evidence.

## 2026-08-10 — the pak, before and after the clutter moved to the runtime scatter

[`opensa-engine/2026-08-10-pak-clutter-runtime-vs-baked.json`](opensa-engine/2026-08-10-pak-clutter-runtime-vs-baked.json)
— a BUILD measurement, not a frame one, and it does not mix with the rows above. Plan 014 took the procobj
clutter off the bake for `opensa`: **pak 1 551 → 1 168 MB (−24.7 %)**, **AO bake 21 m 14 s → 14 m 25 s
(−32 %)**, **welded HD vertices 105.8 M → 60.4 M (−42.9 %)**. The cause is that welding duplicates vertices per
instance, so 91 092 baked objects were ~45.4 M vertices of copies; the runtime path uploads ~48 geometries.

**No frame number attaches to this yet.** Whether per-cell scatter at stream-in costs more than a baked cell is
a hitch question, and it is the user's `?bench=all` run to make. The pair is also 30 h apart with one mods-stage
change in it, so the deltas are attributed rather than isolated — the file lists the confounds, including a
`breakables` −991 that turned out to be the 6 breakable clutter species leaving the pak for a runtime path that
already handles them (074/20).

## 2026-08-10 — the clutter on the runtime path, measured on the user display

[`opensa-engine/2026-08-10-ingame-user-display-clutter-runtime.json`](opensa-engine/2026-08-10-ingame-user-display-clutter-runtime.json),
directly against the two 2026-08-09 arms of the same lane (`-oldmap-baseline` = 15 286 clutter objects baked,
`-procobj-recovered` = 91 092 baked). All three run by him, same machine, same nine scenes.

| scene | 15 286 baked | 91 092 baked | 91 092 RUNTIME | Δ vs 91 092 baked |
| --- | --- | --- | --- | --- |
| ls-noon | 9.452 / 105.8 | 9.564 / 104.6 | 9.651 / 103.6 | +0.9 % |
| sf-fog-dawn | 9.025 / 110.8 | 9.019 / 110.9 | 9.052 / 110.5 | +0.4 % |
| lv-night | 14.321 / 69.8 | 13.898 / 72.0 | 14.545 / 68.8 | **+4.7 %** |
| **country-dusk** | 16.366 / 61.1 | **18.434 / 54.2** | **16.091 / 62.1** | **−12.7 %** |
| ocean-horizon | 8.334 / 120 | 8.333 / 120 | 8.333 / 120 | 0.0 % |
| ls-rain-night | 8.652 / 115.6 | 8.684 / 115.1 | 8.664 / 115.4 | −0.2 % |
| ganton-noon | 13.550 / 73.8 | 13.644 / 73.3 | 13.668 / 73.2 | +0.2 % |
| strip-noon | 10.166 / 98.4 | 10.464 / 95.6 | 10.358 / 96.5 | −1.0 % |
| ganton-night | 13.655 / 73.2 | 13.730 / 72.8 | 13.735 / 72.8 | 0.0 % |

**The verdict: moving the clutter to the runtime path costs no frame time anywhere, and gives back the one scene
the baked layer had taken.** `country-dusk` — the only scene clutter has ever moved — goes 18.434 → 16.091 ms and
is now faster than even the 15 286-object baseline. Seven of the other eight are inside ±1 %.

**The honest caveat, and it is a content one.** country-dusk's triangles fell 1 442 102 → **1 218 261 (−15.5 %)**
and its draws 907 → 851, so the runtime path is drawing **less clutter than the bake did** — its per-cell
`procObjLimit` binds where the bake had none. The −12.7 % is therefore "less drawn AND faster", not "same content,
cheaper mechanism". What is measured is that the change costs nothing; what is NOT measured is whether it is
cheaper at equal content. That question is now askable at all, which it was not: the bake stripped `procobj.dat`
to 9 rules, so density and `procObjLimit` were dead knobs on this target and plan 013 had to invent a two-pak A/B.

**lv-night +4.7 % is the one number not to over-read.** That scene's own arm-to-arm spread across the two 08-09
runs is 3.0 % (14.321 vs 13.898) in a scene with almost no clutter, so +4.7 % sits just outside its noise with
−2.3 % fewer triangles. One sweep cannot separate that from run-to-run variance.

**First hitch numbers on this lane** (the block shipped 2026-08-10, so the 08-09 arms have none — these are a
reading, not a delta): only the two heaviest scenes show slow frames at all, `country-dusk` **5** (maxMs 34.6) and
`ganton-night` **1** (maxMs 26.1); every other scene is 0. And `country-dusk` carries the highest
`gpuMs.pass` of all nine (**12.03**) on the FEWEST draws and second-fewest triangles — high pass cost on little
geometry is where to look when the runtime scatter is tuned.

## 2026-08-10 — the runtime clutter knobs, swept on the unbaked pak: BOTH saturate before the engine notices

[`opensa-engine/2026-08-10-headless-procobj-runtime-knob-ladder.json`](opensa-engine/2026-08-10-headless-procobj-runtime-knob-ladder.json)
— 15 single-scene `country-dusk` sweeps in Claude's headless lane, on the pak rebuilt 2026-08-10 17:47 **without**
the procobj bake (`data/procobj.dat` back to all 95 source rules). This is the P1 measurement plan 013 owns.

**The null result above is now closed as a SITE failure, exactly as it was diagnosed.** Same code, same scene,
same harness, different pak: `?procobj=0` moves triangles **1 206 029 → 1 173 177 (−2.72 %)** and draws 830 → 815,
against this session's own A/A drift of **0.007 %** (a vs a2). On the baked pak the identical arm moved 0.007 %.

**Both knobs saturate, neither saturates on the engine — and they stop for two DIFFERENT reasons.**

| knob | ladder | triangles | verdict |
| --- | --- | --- | --- |
| `procObjLimit` (per-cell cap) | 150 → 300 | 1 206 029 → 1 210 952 (+0.41 %) | +0.41 % of the SCENE is **13.0 % of the LAYER** |
| | 300 → 600 → 1200 → 3000 | 1 210 952 / 1 210 827 / 1 211 008 / 1 210 965 | flat to 0.015 %, 20× the cap for nothing |
| `?procobj` (density ×) | 1 → 2 → 4 | 1 210 965 → 1 251 866 → 1 291 582 (+6.66 %) | linear in the cutoff |
| | 4 → 8 → 16 | 1 291 582 / 1 291 753 / 1 291 717 | flat — the ceiling is ×3, and it is OURS |

**The cap's ceiling is the data.** The candidate pool per face is `area / spacing²`
([009](../../tools/sa-procobj-placement/docs/plans/009-procobj-dat-columns-as-the-game-reads-them.md)), so at
cutoff 1 a cell does not hold 300 placements and no cap above 300 can bind. What it *does* trim at the shipped
150 is 4 923 triangles of a 37 775-triangle layer — read that +0.41 % with its scope.

**The multiplier's ceiling is ours.** `scatterProcObjects` generates `area / spacing² × PROC_OBJ_MAX_DENSITY`
candidates with a lottery uniform in `[0, PROC_OBJ_MAX_DENSITY)`, the renderer keeps `lottery < density`, and
the runtime adapter takes the default **3** (`gta-sa-world.adapter.ts:632`, no argument). So a cutoff of 3 or
more keeps every candidate. The arms measure exactly that: clutter triangles over the clutter-off baseline run
**37 788 : 78 689 : 118 405 : 118 576 : 118 540 = 1 : 2.08 : 3.13 : 3.14 : 3.14** — linear, then flat at 3.
(The ~4 % over an exact 1:2:3 is species mix; models do not carry equal triangle counts.) **So "+10.11 % of the
scene" is what the layer costs at 3× vanilla, not a ceiling** — raising `PROC_OBJ_MAX_DENSITY` buys more at a
linear cost in candidates. Draws move only at the on/off boundary: the clutter is instanced, so its cost is
per-pixel, not per-draw.

**And there is no hitch to find.** Across the 11 capped arms `hitch.maxMs` reads 9.7–36.0 ms and `slowFrames` 0–4
with **no relation to load** — the two worst arms are `lim600` (35.4 / 4) and `d8` (36.0 / 1), while `d16`, the
heaviest world of the ladder, reads 12.3 / 0 and the A/A pair alone spans 21.9 vs 9.7. `blobMaxMs`, `uploadMaxMs`
and `pendingMax` are 0 on every arm. The hitch columns' own noise on this lane is larger than anything the layer
can produce.

**`UNCAPPED=1` works, and it costs the other half of the report.** `avgMs` unpins 8.33 → **5.42–5.64** and `p95Ms`
9.1–9.2 → **6.7–7.2**, at 177–185 fps — so the "this needs the user's display" half of P1 is retired. But every
uncapped arm, clutter-off included, reads `maxMs` 148–196 ms and `slowFrames` 16–19: the loop runs flat out and
scheduling stalls swamp the hitch block. **Capped for hitching, uncapped for cost, and the two lanes are never
comparable.** Even uncapped the layer stays below the noise: `gpuMs.pass` A/A is 6.5 % apart (4.164 vs 3.910),
*wider* than off → max (3.952 → 4.201), and on `avgMs` the two default arms bracket the maximum arm outright.

**What this settles for plan 013:** at 3× vanilla density the whole layer still costs less than one sweep's A/A
drift, so there is no perf number to set `procObjMax`, the candidate ceiling or `procObjLimit` from — the budget
cannot be read off a hitch measurement because the layer cannot be pushed into one. Keep `procObjLimit` at 150
unless the look wants back the 13 % of the layer it trims (300 is the only value above it worth choosing), and
treat the density ceiling as **available headroom, not a measured maximum**. The certified room goes to the P2
draw distances, which is a look decision.
**Not covered:** one scene, camera flights rather than a drive, n=1 per arm — a streaming-shaped hitch under
continuous movement is sampled by no arm here, and the three streaming columns reading 0 everywhere means that
pressure never arose rather than that it was survived. **Nor what raising `PROC_OBJ_MAX_DENSITY` would cost:**
every arm above ×3 measured the same world.

## 2026-08-10 — the per-category clutter ranges, which had never been connected to anything

[`opensa-engine/2026-08-10-headless-procobj-per-category-ranges.json`](opensa-engine/2026-08-10-headless-procobj-per-category-ranges.json)
— five `country-dusk` sweeps, same lane and pak as the knob ladder above. **The seven per-category draw
distances were dead config**: written by the debug slider, read by nothing, so every category really drew at
whatever its 256-unit cell reached and the cell ring was `streaming.collisionDrawDistance` = 150. They are now
applied per INSTANCE in the clutter vertex shader, with the streaming ring widened to the widest enabled
category.

| range | draws | triangles | layer on screen¹ | `gpuMs.pass` |
| --- | --- | --- | --- | --- |
| 100 — SA's flat `PLANTS_MAX_DISTANCE` | 818 | 1 182 287 | 9 110 | 3.636 |
| 150 — the collision ring | 819 | 1 186 367 | 13 190 | 3.633 |
| **per-category (shipped)** | **821** | **1 191 188** | **18 011** | **3.694** |
| 300 — every category at the widest | 830 | 1 209 368 | 36 191 | 3.678 |

¹ against the same pak's clutter-off baseline of 1 173 177 triangles.

Four points, one direction, against an A/A control of **0.020 %** on triangles and **zero** on draws. **In
layer terms the range is a 4× lever** (9 110 → 36 191) while reading as +2.3 % of the scene — the scope matters
or it sounds like nothing. And it is **free in frame terms**: `gpuMs.pass` spans 1.7 % across the whole ladder,
inside this column's own 6.5 % A/A drift, with every hitch column flat. **Choosing a range is a look decision
with a free budget**, which is what the P1 measurement above predicted for this layer.

**Two things to carry forward.** The old behaviour was never "150" — it was "every instance of whatever cell you
are in", so the effective reach depended on where in the cell the camera stood (~360 units at a corner); the win
is determinism as much as reach. And **`avgTriangles` under-reports this feature**: it counts SUBMITTED
instances, so a group the camera stands inside is counted whole and culled per instance in the shader. The
column is accurate about vertex load and blind to the fill saving.

## 2026-08-11 — the species floor, and what "the budget is conserved" is worth in frame terms

[`opensa-engine/2026-08-11-headless-procobj-species-floor.json`](opensa-engine/2026-08-11-headless-procobj-species-floor.json)
— four `country-dusk` legs, same lane and pak as the two 08-10 rows above: **two `?procobjFloor=0` arms and
two `?procobjFloor=1` arms**, so each side carries its own A/A drift. The floor guarantees every eligible
clutter MODEL at least one placement in a cell where `procObjLimit` binds, paying for it with the
highest-lottery survivor ([plan 012](../../tools/sa-procobj-placement/docs/plans/012-species-representation-floor.md)).

| arm | draws | triangles | `gpuMs.pass` | `hitch.maxMs` |
| --- | --- | --- | --- | --- |
| floor 0 (A) | 821 | 1 191 107 | 3.661 | 16.7 |
| floor 0 (A′) | 821 | 1 191 235 | 3.672 | 9.5 |
| floor 1 (B) | 821 | 1 191 176 | 3.688 | 31.8 |
| floor 1 (B′) | 821 | 1 191 206 | 3.683 | 15.2 |

**No resolvable cost.** Triangles move **+0.002 %** on the pair means against a floor-0 pair spread of
0.011 %, and `avgDrawCalls` is **821 in every arm** — which is what the design predicts rather than a lucky
result: the floor never adds a placement, it swaps one. `gpuMs.pass` +0.52 % is the only column that moves
and it sits between the two pairs' own drifts (0.30 % and 0.14 %).

**Read the saturation before the columns.** This is the capped lane, so `avgMs` sits on 8.33 and `p95Ms` on
9.0–9.2 in all four arms; neither could have answered a cost question here (the same trap as the 08-10
ladder). `hitch.maxMs` spans 9.5–31.8 with no relation to the arm — one slow frame in B, none in B′.

**The honest gap, and it is the one the 08-10 null taught:** no positive control was run in THIS lane, so
nothing here establishes that the floor changes anything in `country-dusk` specifically. The proof that the
knob does something is a picture taken elsewhere — cell `-5,7` in the desert, 1.00 % of the frame against a
9.81 % clutter-off control, recorded in plan 012. **This run supports "no cost", not "an effect was present
and still cost nothing".**

## The gap this record has

**The pak build was not recorded on the in-game rows**, and it turned out to be the whole answer to
07-18 → 07-20: what the map CONTAINED changed under us while the numbers were read as if it had not. The
lab rows carry a `converter` block; the sweeps did not. Every new in-game run must name its pak in `note`
— that is now in the readme's comparability checklist, and the 07-19/07-20 bisect rows carry it.

## Tool trials (not engine runs, never comparable to one)

| Date | File | What | Headline numbers |
| --- | --- | --- | --- |
| 08-06 | [district-texture-budget](opensa-engine/2026-08-06-headless-district-texture-budget.json) | The first REAL texture price of a mobile district, read off the user's own `--rgba8 --max-texture 256` pak on the phone (manifest computation, no GPU). 8 cell entries, 18 arrays, 663 layers, 21.4 M texels. | **115.4 MB** resident as built · **13.6 MB** if BC1 · **27.2 MB** if ASTC 4x4 → RGBA8 is **8.5x** BC1 and **4.2x** ASTC on real SA content |
| 08-06 | [astc-encoder-trial](opensa-engine/2026-08-06-headless-astc-encoder-trial.json) | The ASTC encoder chain 2 turned to (`astc-encoder.js` 1.0.0, wasm bindings of ARM astc-encoder), on a 128x128 synthetic with a HARD alpha edge — the shape SA's cutout foliage is made of. x64 container, one thread, no GPU. | **1.00 B/texel** (a quarter of RGBA8) · **PSNR 49.3 dB** (RGB 48.0, alpha 58.7) · 115 ms at MEDIUM |
| 08-09 | [dispatch-bundle-inventory](opensa-engine/2026-08-09-dispatch-bundle-inventory.json) | 201/1-01's BUNDLE column: what `dispatch.html` ships, per chunk and per source module (vite build + a sourcemap walk). Desk measurement, no device. Also the change that made the dead-code lane see this app at all — `apps/dispatch` was absent from `knip.json`. | **501.5 kB raw · 166.5 kB gzipped** over 6 chunks · **react-dom 44.1 %** (173.9 kB) > engine 35.5 % (139.8) > the console's own code 11.0 % (43.2) · biggest engine file after `engine.ts`: `hosek-wilkie-data.ts` at 33.4 kB · dead code: one unused export |
| 08-09 | [district-texture-budget-los-santos-centre](opensa-engine/2026-08-09-district-texture-budget-los-santos-centre.json) | The texture price of the district 201/1-01 PINNED (`los-santos-centre`, rect 5,-7,6,-6), off the user's own `--textures rgba8 --max-texture 256` pak on the phone (manifest computation, no GPU). 8 cell entries, 20 arrays, 597 layers, 18.4 M texels. Same tool and phone as the 08-06 row, different (denser) ground — comparable in kind, not in content. | **99.7 MB** resident as built · **11.7 MB** if BC1 · **23.4 MB** if ASTC 4x4 → ASTC is worth **76 MB** on this district, and textures alone are a fifth to a third of the 300–500 MB ceiling |
| 08-07 | [astc-preset-knee](opensa-engine/2026-08-07-headless-astc-preset-knee.json) | The two settings `createAstcEncoder` defaults to, measured rather than assumed: quality preset and thread count, on a 256x256 synthetic whose every block boundary meets a binary-alpha edge. x64 container, 4 cores, no GPU. | **MEDIUM is the knee** — +3.07 dB over FAST for 1.35x the time; THOROUGH adds 0.30 dB for 1.41x again · astcenc's own pool is **2.38x** one thread, bit-identical |
| 08-10 | [district-texture-budget-los-santos-centre-astc](opensa-engine/2026-08-10-district-texture-budget-los-santos-centre-astc.json) | The same pinned district on the ASTC build, and the FIRST pak built from a restored game copy — the earlier ones were converted off a source the pipeline had eaten (`--out` and `--game` were two symlinks into one folder; `gta3.img` carried 1073 `.osm` bundles, `gta_int.img` 155, both re-extracted from `Download/GTA CORP.rar` and verified `clean`). 8 cell entries, 20 arrays, 619 layers, 18.8 M texels, 281 map objects converted where the damaged source gave 0. **Not a format A/B against the 08-09 row** — the source integrity moved too. | **25.4 MB** resident as built (ASTC 4x4) · **15.7 MB** on disk · **95.9 MB** if RGBA8 → 3.8x, taken rather than priced · the estimator's own ASTC column reads 24.0 MB, i.e. 6 % optimistic on this content |
| 08-12 | [dispatch-render-target-attribution](opensa-engine/2026-08-12-dispatch-render-target-attribution.json) | Where the `target` category of the 08-12 phone capture goes, per texture. Desk arithmetic over every `createTexture('target', …)` in the engine at that capture's own surface (720x728 device px, MSAA 4x, renderScale 1), using the same byte estimates the ledger charges. No GPU, no timing — it answers the capture's second open question, which named this the first place 201/1-03 should look. | **36.54 MB over 23 textures, summing to the measured 36.54** · **MSAA 4x is 23.99 MB of it (65.7 %)** — more than the whole district's textures after ASTC (25.81) · bloom chain 6.67 (the ONE full-res prefilter is 4.00 of it) · env probe 1.88 · **and the category is FIXED**: a function of resolution and sample count, identical on a full-map build where everything else grows |
| 08-12 | [dispatch-bundle-inventory](opensa-engine/2026-08-12-dispatch-bundle-inventory.json) | 201/1-06's table, taken with a COMMITTED instrument (`scripts/debug/bundle-inventory.ts`) because the 08-09 row's one-off script left nothing behind. Same method, same entry, and the first bundle reading after merging 161 upstream commits. | **506.5 kB raw · 167.6 kB gzip** over 6 chunks (+5.0 / +1.1 against 08-09 — four days of upstream cost this surface 1 kB of gzip) · **the 08-09 table had a 107.3 kB HOLE**: `shaders.ts` went unattributed (394.2 + 107.3 = 501.5 exactly), so `packages/engine` is **48.8 %** and react+react-dom+scheduler **36.5 %** — the engine is the LARGER half, not the smaller · dead code: none that costs a byte · the one lever: WGSL comments/indentation, **22.1 kB gzip (13.2 %)**, priced and not taken |
