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

- [runtime-modloader-overlay.md](./runtime-modloader-overlay.md) — the boot-time `modloader/` overlay
  (`@opensa/modloader`, plan 058) and the runtime DFF fallback it fed, both removed 2026-07-28. Not measured
  away but ARGUED away: what a car carries beyond geometry — its `features.txt` pop-up declaration, its plate
  slots, its baked occlusion — is decided at BUILD time now, so a car served from a runtime `.dff` spawned
  silently WRONG rather than merely slower. Mods install into the game dir instead (`mod-installer` /
  `vehicle-installer --rebake`). Carries the condition for revisiting in-browser modding.
- [090-vehicle-cabin-at-night.md](./090-vehicle-cabin-at-night.md) — the sky-gated reflection (`3e37d10`) and
  the whole 090 cabin chain (night relax + a lit cabin + one dash lamp), built and REVERTED the same day
  (`ae6548e`) on the field's verdict. The measured data was never wrong; it just never answered what the eye
  was asking, because **not one in-engine capture was taken in three rounds of look-work**. Carries the
  flat-varying artefact (a per-vertex flag drawn through `@interpolate(flat)` = hard triangular patches) and
  the noisy-bake-threshold speckle. The symptoms stay open in
  [`open-issues/vehicle-cabin-lighting.md`](../open-issues/vehicle-cabin-lighting.md).
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
- [081-vehicle-physics/sa-faithful-feel.md](./081-vehicle-physics/sa-faithful-feel.md) — three SA-derived
  tyre scales and the full 2g experiment (SA gravity + SA springs, branch `081-08-sa-gravity`, complete and
  measured), all field-rejected in one day. Produced the two findings the next step stands on: the "weak at
  speed" complaint is a SHAPE (μ·g vs v²), not a scale — and this project's feel target is the field's
  verdict, not the original's numbers.
