# 074·05 — Streaming runtime & the memory model

[← chain](readme.md) · prev: [04 lab+P0](04-engine-lab-p0.md) · next: [06 effects](06-world-effects-parity.md)

The plan-060 semantics (rings, hysteresis, keep-old-until-replacement, atomic swap) re-implemented THIN and
three-free, plus the memory model that designs out the 073 heap catastrophe. The prod `StreamingSystem` is NOT
ported (it's three-`Object3D`-shaped); its BEHAVIOUR is — against the same tests where possible.

## Cell lifecycle

```
desired (rings around view, hysteresis dead-band)
→ fetch: worker reads pak RANGE (Cache API/HTTP Range) → transferable ArrayBuffer to main
→ create: buffers + bind groups + record bundle (all synchronous, bounded: ONE cell per frame max)
→ live: replayed when frustum-visible (cell-sphere test)
→ evict: leaves rings → destroy buffers/bundle → residency ledger drops (assertion on leak)
```

- **No parsing on main** — the format IS the GPU layout; "create" is `writeBuffer` + bundle record.
- Record cost is bounded (≤ 8 groups/cell) — measure it in M1; if a record frame exceeds budget, split
  record across 2 frames (bundle-per-group makes this trivial) — decide on numbers, not preemptively.
- HD↔LOD swap = load new level, then unload old on the SAME frame (atomic — no hole, no double-draw).

## Memory model (the 3.5 GB lesson as architecture)

| Store          | Policy                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Pak bytes      | NEVER whole in JS; worker range-reads only                                                                                     |
| Cell blobs     | transferred, uploaded, **released** — JS holds handles + metadata                                                              |
| GPU residency  | ledger by category (world VB/IB, textures, targets); budget with headroom alarm in HUD                                         |
| Texture arrays | district-shared, refcounted by live cells; evicted when count hits zero (hysteresis delay to avoid thrash at district borders) |

Target steady numbers (M1 ledger): JS heap **< 500 MB and flat** while driving; GPU residency bounded by rings.

## Stress matrix (M1 gate — the exact scenarios that killed 073)

| Scenario                                     | Pass                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| ls-noon flythrough (bench path, drive speed) | no frame > 20 ms; heap flat                                             |
| Camera whip 360° (repeat 10×)                | no frame > 20 ms (culling churn only — bundles replay, never re-record) |
| Cold start                                   | < WebGL prod today; zero steady-state pipeline compiles after veil      |
| Teleport (worst case: full ring turnover)    | recovers < 2 s, no leak, no device pressure                             |
| 30-min soak drive (scripted loop)            | heap/residency flat lines; zero long tasks                              |

## Tasks

- [ ] Worker IO: range reader + prefetch queue (ring-ordered, velocity lookahead as today) + transfer path.
- [ ] Thin streaming driver in the lab: rings/hysteresis/atomic-swap (port plan-060 unit tests' semantics).
- [ ] Residency ledger + HUD panel + leak assertions (unload-all test).
- [ ] Texture-array refcounting + border-thrash hysteresis.
- [ ] Record-cost measurement; split-record fallback only if the number demands it.
- [ ] Script the stress matrix; run in Chrome + Safari; fill the ledger; M1 verdict in the umbrella.

## Measurement ledger

(per scenario: worst frame, heap curve, residency curve, record ms/cell, fetch→live latency)
