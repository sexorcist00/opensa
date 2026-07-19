# 078 — Global bug fixing (post-full-pmb-run: engine + tools)

**Status: OPEN — SKELETON (2026-07-19). Awaiting the detailed bug report from the user; this plan is
deliberately empty until then.** It runs BEFORE [079 — viewers/lab on pmb output](../079-viewers-lab-on-pmb-output.md);
the agreed order after it closes: 079 → full migration audit → merge `webgpu-migration` into `main`.

## Context

The first FULL end-to-end perfect-map-builder run (the one thing opensa-pack plan 003 left to the
user) happened 2026-07-19: the whole modded map converted in **over an hour**, and the result has
**bugs** — both engine-side and tool-side. This plan is the single ledger where they are triaged
and fixed, instead of scattering fixes across the finished chains' docs.

Command that produced the run (for reproduction):

```
NODE_OPTIONS=--max-old-space-size=12288 npx tsx tools/perfect-map-builder/src/cli.ts \
  --game ./game-src/non-modified --in ./mods-src --out ./build/perfect
```

## Bug ledger

_(to be filled from the user's report — one row per bug, then a section per fix)_

| #   | Symptom | Surface (engine / opensa-pack / pmb / other tool) | Repro | Root cause | Status |
| --- | ------- | ------------------------------------------------- | ----- | ---------- | ------ |
|     |         |                                                   |       |            |        |

## Working rules

1. **Triage first, fix second**: every reported symptom gets a ledger row + a minimal repro before
   any code changes; root causes recorded even for one-line fixes (the fixed/ open-issues discipline).
2. A bug whose fix changes converter OUTPUT batches into ONE reconvert at the end — no per-fix
   full-map runs (a full run costs > 1 h).
3. Regressions get a pinned test in the owning package; the suite + the 6-scene ritual sweep close
   the plan.
4. Convert-time itself (> 1 h) is a candidate ledger row: measure where the time goes before
   deciding whether it is a bug or the honest cost (bakes were 124 s + 124 s on the map; the rest
   needs a breakdown).

## Ledger

_(fix log + measurements as work proceeds)_
