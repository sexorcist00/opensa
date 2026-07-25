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
- [080-cinematic-camera/multiray-collision.md](./080-cinematic-camera/multiray-collision.md) — the multi-ray
  collision fan (plan 080/04), the WORST variant of the chain. Built (`811bca9`) and field-rejected same day
  (`e1541ec`): the boolean all-hit gate is discontinuous, so the camera JUMPED instead of sliding approaching
  a house. Lesson: collision must stay a continuous function of approach, not a boolean gate. Carries the
  "On Top" revisit note.
- [080-cinematic-camera/collision-collider.md](./080-cinematic-camera/collision-collider.md) — a kinematic
  sphere COLLIDER (move-and-slide) for the same collision (plan 080/04). Rejected by reasoning, never coded:
  character controllers stick in the game's many narrow nooks, the classic reason spring-arm cameras use a
  cast, not a body. Kept the simple single sphere cast + near-plane cap.
