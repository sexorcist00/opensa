# Postmortem

**Where dead directions are laid to rest — with the reason.** When a [concept](../concepts/README.md)
(or an in-flight plan) fails its go/no-go, it does NOT just get deleted: we write down *what we tried, what we
measured, and why it did not work*, so the same dead-end is never re-run from scratch. See the full lifecycle
in [docs/README.md](../README.md):

```
concept  →  docs/plans/       (validated — we build it)
         ↘  docs/postmortem/  (died — recorded here)
```

Each postmortem should carry: the goal, where the code lives (branch/commit, if any), the measurements or
observations that killed it, and the conditions under which it might be worth revisiting.

## Postmortems

- [modern-cell-tooling.md](./modern-cell-tooling.md) — custom `.cell` format + baked channels + static
  batching/atlasing (plans 066 + opensa-lod-generator 005–010). No measurable perf/quality gain; code parked
  on `backup/tooling-experiment`. Produced the CPU-bound-on-draw-calls diagnosis that led to the own engine
  (074).
- [camera-collision-approaches.md](./camera-collision-approaches.md) — two rejected camera-collision models
  (plan 080/04). (1) A kinematic sphere COLLIDER (move-and-slide) — rejected by reasoning, never coded:
  character controllers stick in the game's many narrow nooks. (2) A multi-ray fan (react only to full
  occlusion) — built (`811bca9`) and field-rejected same day (`e1541ec`): the boolean all-hit gate is
  discontinuous, so the camera JUMPED instead of sliding when approaching a house. Kept the simple single
  sphere cast + near-plane cap.
