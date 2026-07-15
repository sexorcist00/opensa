# 021 — Angle-weighted normal accumulation

**Status: planned.** Implements the weighting half of option 2 of
`docs/ideas/0.4.0/plans/06-normals-smoothing` (plans 020–023 are the normals batch).

## Problem

`tool-kit/mesh/smooth-normals.ts#accumulateGroupNormals` weights each face's contribution by **area only**.
Long thin triangles dominate junction vertices: a road strip 100 m long outvotes every local face at an
intersection corner, skewing the vertex normal along the strip (kin to the road-stripe artifact family —
GTA road meshes are exactly this shape). Under the 074 engine's per-vertex N·L the skew is a visible
brightness tilt at junctions.

## Design

Standard corner-angle × area weighting: for face `f` incident to vertex `v`, weight = `area(f) ×
cornerAngle(f, v)` where `cornerAngle` is the angle at `v`'s corner of the triangle (radians). A sliver's
huge area is cancelled by its tiny corner angle; equilateral fans are unchanged. The corner angle is computed
from the two edges leaving `v` — needs the per-corner context, so the accumulation loop keys the weight per
corner, not per face.

Cost: 3 extra `acos` (or a dot-product clamp) per triangle in an offline tool — negligible against the run's
bake time.

## Determinism

Same inputs → same outputs (pure arithmetic, no RNG, no iteration-order dependence beyond today's).
Golden-fixture normals WILL shift — the LOD harness and any snapshot fixtures must be re-baselined in the
same change, with before/after screenshots in this doc.

## Tasks

- [ ] Corner-angle weight in `accumulateGroupNormals` (tool-kit core; both consumers get it).
- [ ] Unit test: sliver + equilateral sharing a vertex — sliver no longer dominates (compare against the
      analytic expectation, not a snapshot).
- [ ] Re-baseline affected fixtures (map-optimizer + opensa-lod-generator harness — the two always ship in
      tandem).
- [ ] Field A/B on a road junction from the phase-0 fixture set (020); record numbers/screens here.
