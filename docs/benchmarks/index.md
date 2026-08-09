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

Rows: [`2026-08-09-headless-bench-aa-after-102.json`](opensa-engine/2026-08-09-headless-bench-aa-after-102.json).
The arm-A run that found the anchor-height defect on the way there:
[`2026-08-09-ingame-102-probe-arm-a.json`](opensa-engine/2026-08-09-ingame-102-probe-arm-a.json) —
**diagnostic, not a baseline.**

## The gap this record has

**The pak build was not recorded on the in-game rows**, and it turned out to be the whole answer to
07-18 → 07-20: what the map CONTAINED changed under us while the numbers were read as if it had not. The
lab rows carry a `converter` block; the sweeps did not. Every new in-game run must name its pak in `note`
— that is now in the readme's comparability checklist, and the 07-19/07-20 bisect rows carry it.
