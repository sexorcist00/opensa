# The benchmark record, in chronological order

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
  the in-game rows mostly do not, and that gap is exactly what blocks the 07-20 diagnosis.

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

| #   | Date        | File                                                                                                                     | Harness / scene                                | Conditions                                                                                                                                               | Headline numbers                                                                                                      |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | 07-12 07:13 | [drive-ao](opensa-engine/2026-07-12-drive-ao.json)                                                                       | lab `drive`                                    | `?pak=1&stream=1`, dpr 2, 3456×1846                                                                                                                      | frame 8.333 / p95 9.3 · GPU pass **1.94** (p95 2.75) · draws 255 avg / 334 max · resid 265 MB                         |
| 2   | 07-12 07:31 | [drive-sunvis](opensa-engine/2026-07-12-drive-sunvis.json)                                                               | lab `drive`                                    | same as #1, + sun-vis bake                                                                                                                               | frame 8.333 / p95 9.2 · GPU pass **2.08** · draws 255 / 334 · resid 265 MB                                            |
| 3   | 07-12 07:57 | [drive-wind-hd](opensa-engine/2026-07-12-drive-wind-hd.json)                                                             | lab `drive`                                    | same as #1, + HD wind                                                                                                                                    | frame 8.335 / p95 9.3 · GPU pass **2.79** · draws 296 / 394 · resid 359 MB                                            |
| 4   | 07-12 08:14 | [drive-tobj-night](opensa-engine/2026-07-12-drive-tobj-night.json)                                                       | lab `drive`, **night**                         | `&hour=22`, timed objects                                                                                                                                | frame 8.334 / p95 9.3 · GPU pass **2.86** · draws 302 / 401 · resid 360 MB                                            |
| 5   | 07-12 11:10 | [drive-stoch-coronas-night](opensa-engine/2026-07-12-drive-stoch-coronas-night.json)                                     | lab `drive`, **night**                         | `&hour=22`, stochastic coronas                                                                                                                           | frame 8.334 / p95 9.3 · GPU pass **3.53** (p95 4.85) · draws 303 / 402 · resid 360 MB                                 |
| 6   | 07-12 13:02 | [city-full-ls](opensa-engine/2026-07-12-city-full-ls.json)                                                               | lab `city`, full LS                            | `src=pak-ls`; converter: 345 cells, pak 1151 MB, AO bake 418 s                                                                                           | frame 8.339 / p95 9.3 · GPU pass **2.67** · draws 225 / 582 · resid 409 MB                                            |
| 7   | 07-12 14:54 | [whip-full-ls](opensa-engine/2026-07-12-whip-full-ls.json)                                                               | lab `whip` (fast camera whip), full LS         | `src=pak-ls`; converter: 345 cells, pak 500 MB                                                                                                           | frame 8.333 / p95 9.3 · GPU pass **0.88** · draws 17.7 / 103 · resid 406 MB                                           |
| 8   | 07-12 14:55 | [teleport-full-ls](opensa-engine/2026-07-12-teleport-full-ls.json)                                                       | lab `teleport` (streaming stress), full LS     | `src=pak-ls`; same converter as #7                                                                                                                       | frame 8.334 / p95 **9.4** · GPU pass 1.33 · draws 85 / **481** · resid 407 MB · heap 257 MB                           |
| 9   | 07-13 07:01 | [drive-meshopt](opensa-engine/2026-07-13-drive-meshopt.json)                                                             | lab `drive`                                    | after meshopt; converter: 40 cells, pak 69 MB                                                                                                            | frame 8.333 / p95 9.3 · GPU pass **2.93** · draws 290 / 388 · resid 360 MB                                            |
| 10  | 07-13 08:06 | [map-full-map](opensa-engine/2026-07-13-map-full-map.json)                                                               | lab `map`, **whole map**                       | `src=pak-map`; converter: 1121 cells, pak 770 MB, 176 timed objects                                                                                      | frame 8.332 / p95 9.2 · GPU pass **2.90** · draws 393 / 680 · resid **637 MB**                                        |
| 11  | 07-13 09:34 | [drive-lightpool-night](opensa-engine/2026-07-13-drive-lightpool-night.json)                                             | lab `drive`, **night**, narrower window (2444) | `&hour=22`, light pool; converter: 40 cells, pak 69 MB                                                                                                   | frame 8.334 / p95 9.1 · GPU pass **3.64** (p95 4.92) · draws 267 / 378 · submit 0.43                                  |
| 12  | 07-14 20:36 | [ingame-vehicles](opensa-engine/2026-07-14-ingame-vehicles.json)                                                         | **in-game sweep**, 6 scenes                    | commit `33c74c9` (vehicles B5), pak-map bakeless, Chrome / M3 Pro                                                                                        | 119.9–120 fps · p95 9.2–9.4 · draws **8–462**                                                                         |
| 13  | 07-14 20:36 | [ingame-particles](opensa-engine/2026-07-14-ingame-particles.json)                                                       | **in-game sweep**, 6 scenes                    | commit `3cf13e7` (reflections v1 + 2dfx particles/coronas B5r+B6), same pak                                                                              | 120 fps · p95 ≤ 9.4 · draws **8–463**                                                                                 |
| 14  | 07-18       | [series](opensa-engine/2026-07-18-series.md) + [preflip-baseline](opensa-engine/2026-07-18-ingame-preflip-baseline.json) | **in-game sweep**, 6 scenes, engine vs prod    | M3 Pro @2× retina, **841 road cars**, after the 07-18 fix batch (night-NaN, live-VFS timecyc, fog dissolve, regional weather). **Pak build unrecorded.** | **119.6–120.3 fps** · p95 9.2–9.3 · draws **11–1065** · pass 1.85–4.09 · probe 0.23–0.55 · submit 0.33–0.49           |
| 15  | 07-20       | [ingame-regression](opensa-engine/2026-07-20-ingame-regression.json)                                                     | **in-game sweep**, 6 scenes                    | same machine, same 841 cars, **after a pak rebuild**. Chat paste, not a file capture.                                                                    | **58.3–117.3 fps** · p95 **17.5–56.2** · draws 19–1678 · pass 1.80–**12.56** · probe 0.53–1.94 · submit 0.20–**3.33** |

### The rows that were only tables until now

| #   | Date  | File                                                                                       | Conditions                                                               | Headline numbers                                                         |
| --- | ----- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 0   | 07-11 | [early-milestones](opensa-engine/2026-07-11-early-milestones.json)                         | M0 first light: synthetic 12×12, then ls-bench (40 entries)              | 8.33 ms vsync · GPU **1.44 → 1.84** · draws 528 → 807 · resid 224→294 MB |
| 13  | 07-16 | [ingame-display-c1](opensa-engine/2026-07-16-ingame-display-c1.json)                       | user's display, **841 road cars** — partner of the prod 07-17 row        | **120 fps all six** · p95 ≤ 9.2 · draws 11–1 243 · pass 1.86–3.48        |
| 16  | 07-18 | [headless-regional-weather](opensa-engine/2026-07-18-headless-regional-weather.json)       | after the regional-weather fix (074/21); headless DPR 2                  | 119.8–120 fps · world pass 1.58–2.12 · draws 9–1 044 · late 0            |
| 17  | 07-18 | [headless-postteardown-ritual](opensa-engine/2026-07-18-headless-postteardown-ritual.json) | the 074/13 phase-8 ritual after `three` was deleted; same harness as #16 | 119.9–120 fps · pass 1.94–2.40 · draws within ±5 of #16 — **PASS**       |

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

## The gap this record has

**The pak build was not recorded on the in-game rows**, and it turned out to be the whole answer to
07-18 → 07-20: what the map CONTAINED changed under us while the numbers were read as if it had not. The
lab rows carry a `converter` block; the sweeps did not. Every new in-game run must name its pak in `note`
— that is now in the readme's comparability checklist, and the 07-19/07-20 bisect rows carry it.
