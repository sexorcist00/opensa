# Benchmarks — the performance record

**Standing rule: every performance number the user reports gets committed here, immediately, in this
format.** Not summarised into a plan doc, not left in chat. A number that exists only in a conversation is
gone the moment the session ends, and a regression cannot be diagnosed without the run it regressed from.

**Everything lives here** — the whole measurement history was consolidated into this folder on 2026-07-20,
split by renderer:

- [`opensa-engine/`](opensa-engine/) — the own WebGPU engine: the run JSONs plus four written analyses —
  [`2026-07-18-series.md`](opensa-engine/2026-07-18-series.md) (the annotated engine-vs-prod narrative,
  tables also extracted as JSON alongside), [`2026-07-21-http-dir-sweep.md`](opensa-engine/2026-07-21-http-dir-sweep.md),
  [`2026-07-21-scale-ladder.md`](opensa-engine/2026-07-21-scale-ladder.md) and
  [`2026-07-21-layer-decomposition.md`](opensa-engine/2026-07-21-layer-decomposition.md).
- [`three-engine/`](three-engine/) — the three.js/WebGL prod line, kept for the before/after record.

Chronology, with the conditions each run was taken under: [index.md](index.md). **Read that before
comparing any two numbers** — the runs come from two different harnesses and several different paks.

How to produce a run: [`../development/benchmarks.md`](../development/benchmarks.md) (`?bench=all`, the
`[bench]` console protocol, the headless harness at `tools-debug/bench-harness/`).

## File naming

`<engine>/YYYY-MM-DD-<surface>-<what>.json` — e.g. `opensa-engine/2026-07-20-ingame-regression.json`.
`surface` is `ingame` (the in-game `?bench=all` sweep), `drive`/`city`/`map`/`teleport`/`whip` (headless lab
paths) or `headless`; `what` is why the run was taken.

## Format

```jsonc
{
  "note": "Why this run exists, WHO ran it, on what machine, and anything that makes it non-comparable.",
  "runs": [
    {
      "key": "ls-noon", // bench scene id
      "avgMs": 9.66,
      "p95Ms": 24.0, // the number that catches stutter — never drop it
      "fps": 103.5,
      "frames": 1554,
      "avgDrawCalls": 1202,
      "gpuMs": { "pass": 4.841, "post": 1.087, "probe": 1.154, "submit": 1.417 },
      "residency": "cellIndex 41 · cellVertex 172 · target 424 · texture 1181 · uniform 1",
      "lateCreates": 0,
    },
  ],
}
```

Copy the `[bench]` JSON lines verbatim; add `note` by hand. If a run came from a chat paste rather than a
file, **say so in `note`** — pastes lose fields, and a later reader must not mistake one for a full capture.

## What makes two runs comparable

A perf comparison is worthless without these held equal, so record them in `note` when they are not obvious:

- **machine and DPR** (the series is M3 Pro @2× retina)
- **the road-car population** (`[bench] road cars registered: N` — the series ran 841)
- **the pak** the run read. Converter output changes what the world contains; a pak that is missing far
  LODs benchmarks faster than one that has them, and the numbers look like a code regression when nothing
  in the code moved. **Name the pak build.**
- renderer flags (`?scale=`, `?draw=`, `?engine=`)

## Runs

See [index.md](index.md) — the full chronological table with conditions.

## RESOLVED: the 2026-07-20 "regression" is the cost of a complete map

**It was never a code regression.** A four-point bisect on a fixed pak settled it in one sitting, and the
user's own account of the map confirmed the cause.

Against the 07-18 baseline ([JSON](opensa-engine/2026-07-18-ingame-preflip-baseline.json)):

| scene         | fps 07-18 → 07-20 | draws       | GPU pass         |
| ------------- | ----------------- | ----------- | ---------------- |
| ocean-horizon | 120.0 → **120.0** | 11 → 19     | 1.85 → **1.78**  |
| ls-rain-night | 120.2 → 117.5     | 1046 → 960  | 2.59 → 4.29      |
| ls-noon       | 120.1 → 112.1     | 1036 → 1202 | 2.48 → 4.97      |
| lv-night      | 120.0 → 75.6      | 1065 → 1680 | 3.14 → 8.77      |
| sf-fog-dawn   | 120.3 → 105.4     | 842 → 1019  | 2.85 → 4.21      |
| country-dusk  | 119.6 → 60.6      | 526 → 917   | 4.09 → **12.45** |

### The bisect (all four points on the same pak)

| point | commit    | ls-noon                                                  | sf-fog | lv-night | country-dusk | ocean | rain-night |
| ----- | --------- | -------------------------------------------------------- | ------ | -------- | ------------ | ----- | ---------- |
| A     | `3f354b0` | — could not load this pak at all (the map never came up) |
| B     | `95bd544` | 113.6                                                    | 107.6  | 78.0     | **64.6**     | 120   | 118.8      |
| C     | `52b4ec9` | 110.1                                                    | 107.4  | 75.9     | **64.7**     | 120   | 118.2      |
| D     | `03f05b1` | 109.6                                                    | 105.3  | 74.9     | **60.4**     | 120   | 117.5      |
| HEAD  | `436d2f2` | 112.1                                                    | 105.4  | 75.6     | **60.6**     | 120   | 117.5      |

Draw counts are identical to the unit across all four (1202 / 1019 / 1680 / 917 / 19 / 959), and the frame
times sit inside run-to-run noise. **The slowdown is already fully present at the earliest code that can
read this pak** — so nothing in the 07-19…07-20 window caused it.

### The cause

The pak is the **improved map**: it carries our generated LODs, vegetation and procobj. The 07-18 baseline
was measured before those existed in the output (user-confirmed). **2026-07-21 then localised it to ONE of
the three — the `trees` stage; procobj (≤ +0.38 ms) and lods (+0.22 ms) are retired as suspects**
([layer-decomposition](opensa-engine/2026-07-21-layer-decomposition.md), rows #21/#22). The evidence lines
up exactly:

- **`ocean-horizon` did not move at all** (pass 1.85 → 1.78). It is the one scene with no LODs, no
  vegetation and no procobj — the control, and it is flat.
- **`country-dusk` moved most** — draws +74 %, pass ×3. Countryside is where vegetation and procobj are
  densest.
- Cost per draw rose too, not just draw count, which is what added geometry and alpha-tested foliage do.
  (Superseded 2026-07-21: the controlled A/B put the cost **per-pixel**, not per-draw — draw calls did not
  move at all, 1255 → 1258, while the pass fell 44 %. See row #22.)

**So the old 120 fps was not an engine achievement — it was the cost of an incomplete world.** This is an
optimisation problem against real content, not a hunt for a broken commit — and 2026-07-21 named the
content: mod vegetation swapped in by the `trees` stage.

### What the bisect did find

- **Point D (`03f05b1`) costs ~5 %** on the two heaviest scenes (country-dusk 64.7 → 60.4 fps, pass
  11.43 → 12.52). Small, real, and worth a look — that commit carries the map-viewer work and plan-078
  rows 7/8/10.
- **HEAD is neutral against D**: removing the Show Faces STORAGE flags and adding the hemispheric ambient
  both cost nothing measurable. Both are closed out as suspects.

### CLOSED 2026-07-21 — it is the trees stage

Ganton in free play read ~40 fps by day, worse than any bench scene reported. The first attempt to chase it
was invalid and the runs were deleted (the folder picker did not select the world —
`engine-canvas-host.tsx:264` always fetched the pak from `public/pak-map`, so no run measured the pak it
named). After that was fixed, a six-layer rebuild of the map answered it:

**`trees` is ~90 % of the regression** (ganton-noon pass 5.36 → 13.72 ms), and **one placement-only mod,
"39. Green Piece 1.47", was 73 % of that** — removing it took the pass to 7.63 ms and 53 → 82 fps, with six
control scenes flat. The cost is per-pixel foliage fill, not triangles and not draws. The mod was deleted
on 2026-07-21 and all other foliage work is parked. Full analysis and asset audit:
[2026-07-21-layer-decomposition.md](opensa-engine/2026-07-21-layer-decomposition.md) (rows #21/#22).
