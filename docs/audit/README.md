# Audit

Phase-conclusion audits: when a large arc closes, its outcome is written up here **once**, with the measured
numbers and links to the raw records — so the result survives the session and a later reader sees the verdict
without re-deriving it. Runtime numbers live in [`../benchmarks/`](../benchmarks/); these docs summarise and
interpret them.

- [`vehicle-physics-081.md`](./vehicle-physics-081.md) — the plan-081 driving chain: `handling.cfg` went from
  5 fields consumed to 21, six global constants died, and the five bugs seven field rounds found were all the
  same mistake — a number guessed where the game ships the answer.
- [`vehicle-physics-081-instruments.md`](./vehicle-physics-081-instruments.md) — the 2026-07-27 instruments
  day: the regression pack, the vehicle slice priced at ~8 µs per car per step, surface types shipped — and
  four findings where the new instruments falsified the questions they were built for (the kerb scene never
  met a kerb; the flip that justified the work had stopped reproducing; `collisionDamageMult` scales
  nothing; the gate's own rule was wrong).
- [`vehicle-physics-081-closeout.md`](./vehicle-physics-081-closeout.md) — the same chain's close-out: air
  control ported from the original, wheels leaning the way their axle is authored, and a five-class sweep
  that found the tuning generalises with **no class factor needed** — while three more scenes turned out to
  measure something other than what they are named after. Also the number a tuning round needs: the vehicle
  slice repeats to ±5 %.
- [`ped-locomotion-feel.md`](./ped-locomotion-feel.md) — the plan-088 ped locomotion chain (both
  2026-07-24 rounds): a full modern locomotion + vehicle ingress/egress stack for ~zero runtime cost
  (blended sample 8.2 µs vs 6.0 µs; no render-side change) and +~100 unit tests.
- [`three-to-own-engine.md`](./three-to-own-engine.md) — the three.js → own WebGPU engine migration:
  runtime (~7× fps, same machine/content) and bundle (−12.8 % gzip despite adding a whole engine).
- [`vehicle-effects-089.md`](./vehicle-effects-089.md) — the plan-089 vehicle-effects chain (one day,
  five steps, six field rounds): two new engine capabilities (the dynamic one-shot particle lane and the
  first decal lane), four effects on SA's own assets, one new physics read born of a dead channel
  (Rapier's wheel rotation is cosmetic) — at zero measurable sweep cost, with every look number a
  documented eye-fit.
- [`modloader-removal.md`](./modloader-removal.md) — deleting the runtime `modloader/` overlay and the
  vehicle DFF fallback it fed: one package and a whole second vehicle pipeline gone (−1816 lines, the
  `vehicle-model.worker` chunk with them), coverage up on every metric, and roadmap item 2 closed by deletion
  instead of by measurement. Reasoning: [`postmortem/runtime-modloader-overlay.md`](../postmortem/runtime-modloader-overlay.md).
