# lod-common/02 — One transform for a 2dfx entry

Part of [07 — LOD generators, extended](../readme.md). Depends on
[rw-codec/01](../rw-codec/01-typed-2dfx-payload-codecs.md) (the typed payloads) and
[01](01-2dfx-keep-policy.md) (the keep-policy). **Gated on nothing else.**

Split out of the old A2: A2 mixed three separable things — a codec, a transform, and the cell path that uses
them. This is the middle one, and it is the piece both generators need.

## Context

Every LOD path already applies SOME transform to a carried 2dfx entry, and each does it differently:

- **decimate** (`collectClumpEffects`) maps entry positions through `clumpFrameTransforms`;
- **cells** (`collectCellLightEffects`, `merge.ts:40`) maps them through `instanceTransform` — instance
  rotation, instance position, cell origin;
- **verbatim** applies nothing, because the LOD inherits the model's own frame.

All three then hand the bytes to `build2dfxSection`, which overwrites the first 12 bytes with the new
position and leaves the rest untouched. So the shared behaviour is already "transform the position, keep the
payload" — it is simply spelled three times and cannot express anything else.

## Decisions

1. **One entry point: `transform2dfxEntry(entry, transform)`.** It replaces the implicit
   position-only rewrite everywhere. For an opaque type it does exactly what happens today (rewrite the
   position, keep the payload byte-verbatim); for a type `rw-codec/01` can decode it also rewrites the
   spatial fields inside the payload — the roadsign's rotation vector, the escalator's three points and
   direction.
2. **The transform is the caller's, not the function's.** `clumpFrameTransforms` and `instanceTransform` stay
   where they are; this function takes a transform, so the decimate path and the cell path get identical
   payload handling with their own, already-correct, spatial context. That is what makes "a corona is in the
   same place on every representation" a property rather than a coincidence.
3. **Rotation is applied to directions, not to points, and the difference is checked.** A roadsign's rotation
   vector and an escalator's direction are DIRECTIONS (rotate, do not translate); the escalator's bottom /
   top / end are POINTS (rotate and translate). Getting this backwards produces a sign that is in the right
   place and facing into the wall — a defect that looks like an art bug. A test per field class, not per
   type.
4. **Non-uniform scale is out of scope, and says so.** LOD instance transforms in both paths are
   rotate+translate. If a caller ever passes a scaling transform the function throws rather than silently
   producing a stretched plate.

## Tasks

- [ ] `transform2dfxEntry(entry, transform)` in lod-common: opaque path (position rewrite, today's behaviour)
      + typed path per decodable type, via the rw-codec/01 codecs.
- [ ] Unit tests over the field classes: a point field moves and rotates; a direction field rotates only; an
      opaque payload is byte-identical after a transform that only moves the entry.
- [ ] Identity test: `transform2dfxEntry(e, identity)` returns `e` byte-for-byte, for every type — the
      cheapest guard that the typed path did not lose a field the codec preserved.
- [ ] Reroute `collectClumpEffects` and `collectCellLightEffects` through it, with their existing transforms,
      keeping their current keep-sets (the widening is [01](01-2dfx-keep-policy.md)'s and the cell path's).
      Output unchanged — this step is behaviour-preserving by construction and the regression fixture proves
      it.
- [ ] Throw on a scaling transform; test it.

## Verification

- Identity transform is byte-identity on every type.
- Both generators produce unchanged output after the reroute (golden compare) — no LOD moved.
- A rotated roadsign fixture's plate normal matches the HD instance's, and an escalator's three points match
  the HD-transformed expectation, to float tolerance.

## Measurements / notes

_(record after implementation)_

- field classification per type (point / direction / opaque): …
- worst position and orientation error vs the HD-transformed expectation: …
