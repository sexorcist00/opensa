# One draw per visible vehicle submesh

**Status:** in reserve — the knob the engine names in its own comment
(`packages/engine/src/engine.ts`, the vehicle draw loop).

**Impact: medium, and INFERRED — the only entry whose win has never been put in milliseconds.** What is
measured is the axis: the scale ladder found the frame's floor is the draw/vertex side (a resolution-
independent **1.9–2.5 ms**), not the pixel side, and the in-game sweeps run 841 road cars at up to 1678
draws. So this attacks the real floor — but **today that floor is owned by world cells, not vehicles**, which
is what holds it at medium rather than high. It becomes high on a street dense with hi-poly mod cars (20–30
submeshes each) and stays near zero everywhere else. Measure `draws` with vehicles isolated before believing
any of it.

**Effort: high.** Per-submesh visibility is a shared invariant, not a local one — damage (`_ok`/`_dam`), the
`_vlo` LOD band and the `extraN` selection all express themselves by gating a draw call. Batching means all
three write GPU state instead, the translucent sort has to survive it, and any bind-group shape change
invalidates the recorded cell bundles. Plan chain, not a commit. **The two cheaper cuts at the bottom of this
entry are low effort** and go first.

## What we do today

Every live instance of every vehicle model issues **one draw per visible submesh**. That is what makes the
rest of the vehicle system simple: per-submesh visibility is the single primitive behind `_ok`/`_dam` damage,
the `_vlo` LOD band, and (since 2026-07-22) which `extraN` a car wears — all per instance, no scene graph.

## The lever

Batch: sort instances by submesh and draw them instanced, or build per-instance index ranges so a car is one
draw. The visibility flags would have to move into a per-instance buffer the shader reads instead of gating
the draw call.

## What it would win

Draw count on a street full of cars. Measured context: the in-game sweeps run **841 road cars** at draws
11–1678 total (index rows #14/#15), and the scale-ladder analysis found the frame's floor is the
draw/vertex side, not the pixel side — so this is the axis that actually moves those scenes. A hi-poly mod
car is ~20–30 submeshes; a dense street is where it would show.

## What it would cost

- The per-submesh visibility primitive is load-bearing in three systems at once (damage, LOD, extras). Moving
  it into a buffer means every one of them writes GPU state instead of flipping a flag, and the translucent
  submesh SORT (074/16 — a raked windscreen sorts by its nearest extent) has to survive the batching.
- Bundles: cell draw bundles are recorded, and anything that changes bind-group shape invalidates them.

## What would have to be true to pull it

- A measured draw-bound frame with cars as the dominant contributor — i.e. `draws` high AND the pass floor
  dominated by vehicles, not by world cells. Today the world's cells own that floor.
- Ideally after a cheaper cut below has been taken and was not enough.

## A cost added on this axis (2026-08-17)

The builder emits a TRANSLUCENT material group per spatial cluster (`renderware/vehicle/translucent-clusters.ts`
— connected pieces within 0.2 m merged, at most 8 per group), so a scattered group sorts honestly against the
glass ([open-issues/fixed/vehicle-glass-see-through.md](../../open-issues/fixed/vehicle-glass-see-through.md),
defect 3). Price on the comet: translucent submeshes 69 → 86, +17 draws per instance, blend phase only; opaque
groups are untouched. It applies to every `.osm` the builder writes (props too — the ferris ring's strip is
two clusters). The knob is the cap of 8: lowering it trades draws for sort exactness on the worst-scattered
groups only.

## Cheaper things to try first

- Cull vehicle submeshes by distance band earlier (the `_vlo` LOD already exists — check it is actually
  swapping at the intended range in the field).
- Skip drawing the interior submeshes of a car nobody is inside past N metres.
