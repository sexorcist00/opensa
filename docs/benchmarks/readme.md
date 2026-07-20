# Benchmarks — the performance record

**Standing rule: every performance number the user reports gets committed here, immediately, in this
format.** Not summarised into a plan doc, not left in chat. A number that exists only in a conversation is
gone the moment the session ends, and a regression cannot be diagnosed without the run it regressed from.

**Everything lives here** — the whole measurement history was consolidated into this folder on 2026-07-20,
split by renderer:

- [`opensa-engine/`](opensa-engine/) — the own WebGPU engine. 19 runs plus
  [`2026-07-18-series.md`](opensa-engine/2026-07-18-series.md), the annotated engine-vs-prod narrative
  (the tables in it are also extracted as JSON alongside).
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

## Open: the 2026-07-20 regression

Against the 07-18 baseline ([JSON](opensa-engine/2026-07-18-ingame-preflip-baseline.json)) (same machine, same 841-car population, also run by the user):

| scene         | fps 07-18 → 07-20 | draws       | GPU pass        | probe       | submit      |
| ------------- | ----------------- | ----------- | --------------- | ----------- | ----------- |
| ocean-horizon | 120.0 → 117.3     | 11 → 19     | 1.85 → **1.80** | 0.23 → 0.53 | 0.36 → 0.20 |
| ls-rain-night | 120.2 → 111.7     | 1046 → 959  | 2.59 → 4.18     | 0.38 → 1.26 | 0.49 → 0.97 |
| ls-noon       | 120.1 → 103.5     | 1036 → 1202 | 2.48 → 4.84     | 0.37 → 1.15 | 0.36 → 1.42 |
| lv-night      | 120.0 → 69.7      | 1065 → 1678 | 3.14 → 9.10     | 0.35 → 1.64 | 0.45 → 3.33 |
| sf-fog-dawn   | 120.3 → 64.8      | 842 → 1023  | 2.85 → 4.43     | 0.55 → 1.94 | 0.38 → 0.54 |
| country-dusk  | 119.6 → 58.3      | 526 → 932   | 4.09 → 12.56    | 0.38 → 1.89 | 0.33 → 2.60 |

Every scene used to sit vsync-locked at 120 with p95 ≤ 9.4 — real cost was under the 8.33 ms budget with
room to spare. Only the ocean still is.

Two readings the data forces:

1. **`ocean-horizon` is the control and it did not move** (pass 1.85 → 1.80). No fixed per-frame cost was
   added; whatever changed scales with how much WORLD is on screen.
2. **`ls-rain-night` drew 8 % FEWER calls and cost 61 % MORE GPU.** So this is not draw count — each draw
   carries more work. `country-dusk` says the same louder: draws +77 %, pass +207 %.

`probe` tripled everywhere except the ocean, but the probe re-renders the world into a cubemap face, so it
inherits a heavier world. Symptom, not cause.

Candidates, untested: the **pak rebuild** between the two dates (plan 078 row 5 restored far LODs across
the LS/SF core — meaning the 07-18 baseline may have been measured on a pak that was MISSING geometry, and
the "regression" is a vanished handicap); or a code change in the 07-18…07-20 window making each draw
heavier. Residency also rose (~975 MB at the Ganton spawn in July rows → 1 644 MB in the 07-20 HUD).

**The decisive test needs no code: re-run `?bench=all` against the OLD pak.** 120 fps returns ⇒ data;
it does not ⇒ code, and bisect the window.

Ruled out already: the `cell-wire` STORAGE flags (removed, no effect — and the ocean is flat), and the
hemispheric ambient (vehicle pixels only; Ganton drops to 40 fps with two cars, by day).
