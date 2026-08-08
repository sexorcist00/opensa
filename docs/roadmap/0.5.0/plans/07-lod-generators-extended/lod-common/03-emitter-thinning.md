# lod-common/03 — Emitter thinning (the far-view rate budget)

Part of [07 — LOD generators, extended](../readme.md). Depends on [01](../../../../../../tools/lod-common/docs/plans/005-2dfx-keep-policy.md) /
[02](../../../../../../tools/lod-common/docs/plans/006-2dfx-entry-transform.md) and on the budget model defined by
[03-asi/010](../../../../../../asi/perfect-map/docs/plans/010-pipeline-keep-2dfx.md). Split out of the old A3
so the shared mechanism is not welded to the real-SA consumer that waits on an ASI fix.

**This is 010's deferred half, not a blocked plan.** 009's engine fix shipped and 010 already keeps particles
on the sa-lod verbatim path by default, so emitters ARE at range in real SA today — what was deferred, on the
user's call, is the overdraw budget over them. That makes this measurable now: take the cost of the shipped
carry first, and let the number say whether thinning is needed and how hard.

## Context

A particle 2dfx names an `effects.fxp` system and emits at its authored rate. That rate is authored for
walking past a refinery, not for looking at forty refineries from a hillside — carrying every emitter onto
every LOD is a smoke-storm and an overdraw bill. Something has to reduce emission at LOD range, and the
generator is the only place that can do it without new engine state.

## Decisions

1. **Thin emitters before scaling parameters.** Two mechanisms, and the cheap one goes first:
   - **thinning** — carry a configured fraction or cap of a model's type-1 entries onto the LOD (one plume
     per smokestack instead of six). No payload edit, purely which entries survive, so it composes with the
     keep-policy and needs no FX authoring.
   - **parameter scaling** — if the particle payload exposes a rate field
     ([rw-codec/01](../../../../../../tools/rw-codec/docs/plans/001-typed-2dfx-payload-codecs.md) decodes it), scale it down for the LOD copy.
     Only if thinning proves insufficient, and it is a payload edit with all the risk that carries.
2. **Deterministic thinning, and the choice is not "the first N".** Which plume survives must be a pure
   function of the entry set (a stable hash of the entry's position, say) — same input, same LOD, always. A
   positional rule also keeps the surviving emitters spread across the model instead of clustered at one
   end.
3. **Per-species config with defaults, not a global factor.** Refinery smoke, Vegas plant effects, fountains
   and fires read differently at range; a fountain is arguably worth dropping entirely there while a
   smokestack is the whole point of the silhouette. The deliverable is the table, and its defaults are
   conservative.
4. **One budget model, two consumers.** The factors live in one config consumed by both the pipeline flip
   (03-asi/010) and the encoders here. A second copy of the numbers is a second answer to the same question.
5. **This plan ships no behaviour on its own.** Thinning is dormant until a generator's policy carries type-1
   at all, which is [sa-lod-generator/02](../sa-lod-generator/02-particle-emitters.md). That is deliberate:
   the mechanism can be unit-tested and reviewed while its consumer is still blocked.

## Tasks

- [ ] Thinning in lod-common: keep a configured fraction / cap of a clump's type-1 entries; deterministic
      positional selection; per-species and per-category config with defaults.
- [ ] Unit tests: N entries with cap K keeps exactly `min(N, K)`; the same input always keeps the same ones;
      the survivors are spread rather than clustered (assert against the positions, not the order).
- [ ] Share the budget config with 03-asi/010 — one definition, imported by both.
- [ ] (Only if thinning is not enough) payload rate-scaling through rw-codec/01's particle codec, with the
      same round-trip guard.
- [ ] Record the per-species table and what each factor was judged on. "It looked right at range" is a
      legitimate answer as long as it says so — and if a factor is a fitted constant rather than a recovered
      one, it needs a file in [`docs/hacks/`](../../../../../hacks/) in the same change.

## Verification

- Thinning is deterministic and correctly bounded (unit).
- No generator output changes: with no path carrying type-1 yet, this is dead code by design — the guard is
  the existing golden compare on both generators.
- The budget config has exactly one definition, shared with 010 (grep).

## Measurements / notes

_(record after implementation)_

- per-species thinning factors + what each was judged on: …
- entries carried vs entries authored, per category: …
