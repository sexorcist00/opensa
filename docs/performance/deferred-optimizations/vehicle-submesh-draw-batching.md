# One draw per visible vehicle submesh

**Status:** in reserve — the knob the engine names in its own comment
(`packages/engine/src/engine.ts`, the vehicle draw loop).

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

## Cheaper things to try first

- Cull vehicle submeshes by distance band earlier (the `_vlo` LOD already exists — check it is actually
  swapping at the intended range in the field).
- Skip drawing the interior submeshes of a car nobody is inside past N metres.
