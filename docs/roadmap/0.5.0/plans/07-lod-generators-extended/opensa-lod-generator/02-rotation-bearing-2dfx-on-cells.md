# opensa-lod-generator/02 — Roadsigns and escalators ride baked cells

Part of [07 — LOD generators, extended](../readme.md). Depends on
[lod-common/02](../../../../../../tools/lod-common/docs/plans/006-2dfx-entry-transform.md) (the typed transform) and
[01](01-adopt-2dfx-policy.md) (the policy adoption). **Gated on nothing else — this is the visible win of the
whole 2dfx line and it can ship today.**

Was A2, which also owned the codec and the transform; those are now
[rw-codec/01](../../../../../../tools/rw-codec/docs/plans/001-typed-2dfx-payload-codecs.md) and lod-common/02, leaving this plan with exactly
one job: widen the cell keep-set and prove the result is oriented correctly.

## The correction that unblocked this

A2 gated itself on the `asi/perfect-map` chain, describing the widening as "for the asi target". That was
wrong. [`restrictions/sa-target.md`](../../../../../restrictions/sa-target.md):

> **opensa-lod-generator output is for OpenSA only** — uncapped per-cell LODs (hundreds of materials) are not
> loadable by real SA. The two LOD generators are not interchangeable.

Baked cells are consumed by our own engine, which already decodes and renders both of these types
(`packages/renderware/src/parsers/binary/dff.ts`, `roadsign/glyph-quads.ts`). There is no 2004 ceiling in this
path and no plugin to wait for. The plan was parked behind an ASI for a reason that never applied to it.

## Context

The cell bake merges many instances into one cell-centre-relative mesh and repositions each carried 2dfx via
`instanceTransform` — but only the entry's POSITION (`build2dfxSection` overwrites the first 12 bytes).
Roadsign (7) and escalator (10) encode orientation and geometry in their payload, so a position-only
transplant leaves a street-name plate facing the wrong way and an escalator's motion line pointing at
nothing. That is the whole reason `LIGHT_2DFX` is `{0}`. With lod-common/02 the transplant can rewrite those
fields, and the reason expires.

sa-lod's verbatim and decimate paths already carry these types correctly — they inherit the model's own
frame. Only the CELL path has the gap.

## Decisions

1. **Widen the policy to carry 7 and 10 on cells**, and let the widened `collectCellLightEffects` route each
   entry through `transform2dfxEntry` with the transform it already computes. No new spatial code in this
   package.
2. **Scope to types worth having at range.** Roadsigns and escalators are the sensible additions; undecoded
   orientation-bearing types stay dropped by policy. Do not build a codec for a type nobody can see from a
   cell's distance.
3. **The name stops being a lie.** `collectCellLightEffects` will no longer collect only lights — rename it
   with the widening rather than leaving a function whose name documents the constraint it just lost.
4. **Fidelity bar: a baked-cell roadsign faces the same way and sits in the same place as the HD one**, and
   an escalator's implied motion line matches. Fixture math first, viewer second — the viewer catches what
   the math's expected value was also wrong about.

## Tasks

- [ ] Widen the cell keep-set via the policy to `{0, 7, 10}`; route every carried entry through
      `transform2dfxEntry`; rename `collectCellLightEffects`.
- [ ] Fixtures: real models carrying a roadsign and an escalator → bake a cell containing rotated instances
      of them → assert plate position and normal, and the escalator's three points, match the
      HD-instance-transformed expectation.
- [ ] The case that matters and the cheap fixture will not cover: **two instances of the same model at
      different rotations in one cell**. The per-model effect memoization (`cache` in `merge.ts`) stores
      untransformed entries and the transform is applied per instance — assert that, because a caching bug
      here gives every sign in the cell the first instance's heading and looks plausible in a screenshot.
- [ ] Viewer check: a distant baked cell shows correctly-oriented street-name signs; an escalator reads the
      right way.
- [ ] Census: how many stock cells gain roadsign / escalator entries, and how many entries map-wide — the
      number that says whether this is a visible change or a technically-correct one.

## Verification

- Baked-cell roadsign and escalator orientation and position match HD (fixture math + viewer).
- Repeated instances of one model at different rotations each get their own orientation.
- Cells still carry no type outside the policy's set.
- Cell bake time and output size move by an amount the census explains.

## Measurements / notes

_(record after implementation)_

- roadsign orientation error vs HD, worst case: …
- cells gaining entries / entries carried map-wide, per type: …
- cell bake time and pak size delta: …
