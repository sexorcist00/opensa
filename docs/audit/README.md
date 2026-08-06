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
- [`cleo-basic-097.md`](./cleo-basic-097.md) — the plan-097 CLEO chain: six real mod scripts run
  unmodified on our own SCM VM for 465 µs/tick, gaps are declared DATA enforced by CI joins — and the
  close-out benchmark itself caught a ~3 ms/tick field tax (the `findNext` walk that never exhausted)
  plus a reporting lane that bypassed coverage.
- [`vehicle-effects-089.md`](./vehicle-effects-089.md) — the plan-089 vehicle-effects chain (one day,
  five steps, six field rounds): two new engine capabilities (the dynamic one-shot particle lane and the
  first decal lane), four effects on SA's own assets, one new physics read born of a dead channel
  (Rapier's wheel rotation is cosmetic) — at zero measurable sweep cost, with every look number a
  documented eye-fit.
- [`sa-map-viewer-094.md`](./sa-map-viewer-094.md) — the plan-094 chain (eight phases, two days): the
  blue-strip hunt's A/B loop went from a **repack** to a **60 ms** browser weld with pixel-identical
  reruns, the whole map welds in 15.3 s, and the tool's first field use found both a defect in itself
  (`?panel=0` drew an empty world) and the strip itself — one placement, `roads32_law2`, whose every byte
  matches vanilla.
- [`modloader-removal.md`](./modloader-removal.md) — deleting the runtime `modloader/` overlay and the
  vehicle DFF fallback it fed: one package and a whole second vehicle pipeline gone (−1816 lines, the
  `vehicle-model.worker` chunk with them), coverage up on every metric, and roadmap item 2 closed by deletion
  instead of by measurement. Reasoning: [`postmortem/runtime-modloader-overlay.md`](../postmortem/runtime-modloader-overlay.md).
- [`video-mode-096.md`](./video-mode-096.md) — the plan-096 chain (eight phases, two days, three field
  rounds): `?video=1&seed=N` as a bounded, seeded, self-directed showcase, built on a road-route capability
  the game's own `NODES*.DAT` always carried and nothing read. **9 036 lines added, `packages/engine`
  untouched, and the host's whole footprint is 185 lines** — the shipped attach pattern holding for a third
  subsystem. Its per-frame cost is **under the timer's resolution** (mean 0.0172 ms over 22 817 frames). The
  lesson worth carrying: three of the four defects that mattered were found by a HUMAN watching footage after
  headless numbers had accepted the build, and each became a rule about what a metric cannot see.
- [`asi-sdk-extraction.md`](./asi-sdk-extraction.md) — the `asi/sdk` chain (five plans, one day): the ASI
  framework moved out of `asi/perfect-map` into a shared SDK, making `asi/` an sdk-plus-consumers category
  like `cleo/`. **perfect-map 1 499 → 705 lines** (497 of them its own subject matter; 179 the seam a second
  plugin must write), the roadmap's copy-verbatim list for `asi/city-life` is dead, and seven hand-copied byte
  arrays went to zero — the "a hand-edited address is structurally impossible" rule is now true rather than
  claimed. Field-confirmed on the real install (dry run + APPLY, both fixes installed with FLA/OLA present);
  the behavioural oracle is the one verdict still open. The method lesson: **the measurement rig failed more
  often than the thing measured** — two of three surprises were harness bugs, caught only by giving each row a
  verdict from a different channel than the number.
