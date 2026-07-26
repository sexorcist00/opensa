# Audit

Phase-conclusion audits: when a large arc closes, its outcome is written up here **once**, with the measured
numbers and links to the raw records — so the result survives the session and a later reader sees the verdict
without re-deriving it. Runtime numbers live in [`../benchmarks/`](../benchmarks/); these docs summarise and
interpret them.

- [`vehicle-physics-081.md`](./vehicle-physics-081.md) — the plan-081 driving chain: `handling.cfg` went from
  5 fields consumed to 21, six global constants died, and the five bugs seven field rounds found were all the
  same mistake — a number guessed where the game ships the answer.
- [`ped-locomotion-feel.md`](./ped-locomotion-feel.md) — the plan-088 ped locomotion chain (both
  2026-07-24 rounds): a full modern locomotion + vehicle ingress/egress stack for ~zero runtime cost
  (blended sample 8.2 µs vs 6.0 µs; no render-side change) and +~100 unit tests.
- [`three-to-own-engine.md`](./three-to-own-engine.md) — the three.js → own WebGPU engine migration:
  runtime (~7× fps, same machine/content) and bundle (−12.8 % gzip despite adding a whole engine).
