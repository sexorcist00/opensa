# Performance reserve

Work we **deliberately did not do**, each of which would buy frame time or memory if we ever need it. This
is the plan-B list: when a build comes back too slow, read this before inventing anything, because the
cheapest wins are usually already written down here with their price attached.

Most entries have the same shape — **the same result, computed earlier**. We keep choosing the runtime side
of that trade for good reasons (one code path across asset classes, no format churn, no re-convert to see a
change), and every one of those choices leaves a precomputation on the table. That is what this rubric
collects.

**Maintenance rule** (also in `CLAUDE.md`): when a change picks the runtime path over a precomputed one — or
takes any deliberate cost for correctness, simplicity or moddability — add the alternative here in the same
change, with what it would save, what it would cost, and what would have to be true to pull it.

An entry is not a plan and not a promise. It is a lever with a measured price, so the decision at 30 fps is
a lookup rather than a redesign.

Distinct from the neighbouring rubrics (a restriction is what a design MAY NOT do — [`../restrictions/`](../restrictions/README.md)):

- `docs/benchmarks/*` — measured runs, the evidence any of this would be judged against.
- `docs/improvements/*` — nice-to-have enhancements, parked; about features, not about cost.
- `docs/edge-cases/*` — limits we live with today, not levers we could pull.
- `docs/ideas/*` — design directions not scheduled yet.

Entries live in [deferred-optimizations/](deferred-optimizations/), one file per lever. A lever that gets
pulled moves to [applied/](applied/) with its outcome recorded in the entry's status line (its row below
stays, pointing at the new home).

| Lever | Axis | Est. win | Status |
| --- | --- | --- | --- |
| [Bake vehicle sky-occlusion in opensa-pack](deferred-optimizations/vehicle-ao-baking.md) | spawn hitch | 8–78 ms per model, once per model, spawn path only | in reserve — not needed |
| [Automatic render-scale / quality-tier ladder](deferred-optimizations/render-scale-tier.md) | GPU pass | 0.4–1.4 ms (measured ceiling), targets 345 → 88 MB | measured and refused |
| [Per-ring texture laziness](deferred-optimizations/per-ring-texture-laziness.md) | memory | under the ~767 MB world-array floor | in reserve |
| [One draw per visible vehicle submesh](deferred-optimizations/vehicle-submesh-draw-batching.md) | draw count | unmeasured; the axis the pass floor lives on | in reserve |
| [One texture array per vehicle, at its largest texture's size](deferred-optimizations/vehicle-texture-array-buckets.md) | build size · VRAM · spawn hitch | 220 → 34 MB by size buckets, → 26 MB with BC1; ~24 → 3.5 MB VRAM per type | in reserve — a shared dictionary was measured and REFUSED (8 %) |
| [Env-probe cadence and resolution](deferred-optimizations/env-probe-cadence.md) | GPU pass | 0.2–1.9 ms observed, ~5.8 ms worst seen | in reserve |
| [Foliage fill](deferred-optimizations/foliage-fill.md) | GPU pass (fill) | the 07-21 case was 13.72 → 7.63 ms | parked by decision |
| [Per-wheel surface probe vs surface-tagged colliders](deferred-optimizations/surface-probe-per-wheel.md) | fixed-step CPU | ~free today (driven car only); ~0.6 ms/step if ever run on all 80 cars | in reserve |
| [Bake video-mode camera stations instead of surveying them live](deferred-optimizations/video-station-survey.md) | per-frame casts | ~free today (≤ 3 casts/frame, one shot in four); the win is HEADROOM for several tripods at once | in reserve |
| [Camera position render interpolation](deferred-optimizations/camera-position-render-interpolation.md) | correctness (camera feel) | unlocked the 080/02 position weight + killed the run "doubling" | **PULLED 2026-07-25** |
| [Budgeted texture-array uploads](applied/texture-upload-budget.md) | frame time (hitch) | one 85 ms stall → ~1.5 ms/frame | **PULLED 2026-07-27** — applied |

## How to use it when the frame budget is blown

1. Find the stage that is actually slow (`docs/benchmarks/readme.md` has the harness and the schema).
2. Scan this list for a lever in that stage — spawn hitches, streaming, GPU pass, memory.
3. Read the entry's **cost** section first. Every lever here was refused for a reason, and the reason does
   not disappear because the frame rate dropped; it just gets weighed against a real number.
4. If you pull one, record the before/after in `docs/benchmarks/` and move the entry to a plan.
