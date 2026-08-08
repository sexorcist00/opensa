# 099/03 — Field close-out (the blink on screen, docs synced)

## Subtasks

- [x] Full rebuild through the normal pipeline (the ferris `.osm` in `models/gta3.img` is written by
      the build, not by hand — the 097/06 rule: field runs read `build/original/opensa` and nothing
      else). Done by the user 2026-08-07; the built fixture is read back in 01's ledger.
- [x] Field check — **run by the user, not by the headless harness**: rebuilt, played, verdict
      "looks perfect" (2026-08-07). The reporter's own angle is the one the plan asked to judge from,
      and it is the same person who filed the defect on 2026-08-05.
- [ ] Numbers: blink cadence observed vs the authored 0.225 s, per-frame cost of the animated model's
      advance, boot delta, and a `docs/benchmarks/` record. **NOT captured** — see the ledger.
- [x] Docs, same change: the `docs/edge-cases/engine-rendering.md` "script objects play no UV
      animations" row REMOVED (limitation lifted); `docs/features/cleo.md` blink row flipped to FIXED;
      `docs/features/animated-map-objects.md` carries the rigid lane; `docs/architecture/world-streaming.md`
      carries the DESC fields (no rigid-path architecture doc exists to update — checked);
      `docs/plans/README.md` 099 row flipped to DONE with the open item named.

## Verification

The user's own report closes it: the wheel spins AND blinks. The screenshot A/B was not needed — the
defect was reported by eye and is accepted by eye, which the goals allow ("measured or field-accepted").
What that verdict does NOT cover is the performance guard; it is named as open below rather than assumed.

## Ledger

**What closed it.** The user rebuilt the pak and ran the game on 2026-08-07: the Pacific Park ferris
wheel's bulbs step. The defect filed in the 097/07 field bug round (2026-08-05) is fixed, and the
edge-cases row it produced is gone.

**Read back off the built pak** (01's ledger has the full dump): `f13d`, 261 keyframes, 13 distinct
u-offsets × 0.225 s, loop 29.25 s, on the one `translucent=true` submesh; the second submesh static;
a stock car's `.osm` carries no animation key at all.

**Numbers NOT captured, and why that is stated rather than filled in.** The plan asked for an observed
cadence, the per-frame cost of the advance, a boot delta and a `docs/benchmarks/` record. The field run
was the user's own play session, so none of those were metered, and inventing them would be worse than
their absence. What IS known:

- the authored cadence is 0.225 s and the built fixture carries it verbatim (01's dump) — the engine
  steps from those keyframes with no fitted constant anywhere, so "observed vs authored" has nothing
  to diverge on but the frame clock, which both lanes share;
- the per-frame cost of the advance is 1 × `stepUvAnimation` + 1 × 16-byte `writeBuffer` per animated
  model with a live instance — the ferris ring is one such model in the whole world;
- the cost on models WITHOUT animations is zero allocations and zero writes, proven by the fake-device
  counters in 099/02, and unmeasured on the GPU.

**The one open item in the whole chain:** the bench guard (`docs/plans/README.md`'s 099 row names it).
It needs no rebake — the standard bench scene has no animated models. Until it runs, the "zero cost"
claim is CPU-side only.
