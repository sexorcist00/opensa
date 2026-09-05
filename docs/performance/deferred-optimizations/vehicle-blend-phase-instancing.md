# The glass is still one draw per car per submesh

**Status:** priced, not taken. Left deliberately by
[201/9-08](../../plans/201-dispatch-console/9-the-mobile-frame/readme.md) on 2026-09-05, and the numbers it
comes out of are
[2026-09-05-mobile-vehicle-instancing](../../benchmarks/opensa-engine/2026-09-05-mobile-vehicle-instancing.json)
and [the board decomposition](../../benchmarks/opensa-engine/2026-09-05-mobile-board-decomposition.json).

## What we do today

A vehicle is drawn in two phases. **The opaque phase is instanced**: a run of consecutive slots drawing the
same set of submeshes is one `drawIndexed` per submesh, however many cars are in the run, because depth
decides opaque order and the shader gets each car's row from its slot.

**The blend phase is not.** Its submesh order is a function of the EYE and therefore differs per car — the
rule 074/16 round 6 established, after an unsorted frame drew a steering wheel over its own windscreen. One
draw cannot serve two cars whose glass sorts differently, so the blend phase stays one draw per car per
submesh.

At the console's declared board that is most of what is left. Instancing took the frame from **11 810 draws
to 3 571** with triangles identical; 112 of the remainder is the world, so ~3 459 is cars — and the opaque
half of that is now roughly *submeshes × 5 models* rather than *× 150 cars*.

**How much of it is glass is now a reading rather than an inference.** `EngineStats.vehicleDrawsBlend` and
`vehicleDrawsOpaque` were added when this card was written, and the console's report carries both under
`world`. Read them before acting on anything here — the arithmetic above says ~21 translucent submeshes a
car, and that was an inference from a total.

## The lever

Three shapes, cheapest first:

- **Group by sort key rather than by car.** The order only has to be correct *between* submeshes whose
  geometry overlaps. Submeshes that cannot overlap each other (different parts, disjoint bounds) can be
  drawn in any relative order, so they could be instanced across cars even though the phase as a whole
  cannot. This needs per-submesh bounds the model does not currently carry.
- **Sort the RUN, not the car.** For a run of cars at similar depth the per-car orders are usually
  identical; group consecutive slots whose computed order matches, exactly as the opaque phase groups on its
  submesh set. Costs a per-car sort that the phase already pays, plus an interning step.
- **Depth-prepass the glass.** Removes the ordering requirement entirely and makes the phase instanceable
  like the opaque one. It is a different picture (it discards the blend), so it is not a candidate here.

## Why it is not taken

- **The size of the prize is not established.** The board is 23.8 ms against an empty map of 20.2, so
  everything the 150 units cost — cars, symbology, labels — is +3.6 ms, and the *whole fleet* was measured at
  **+0.9 ms** of that. The glass is a share of a share. A lever worth tenths cannot be seen on this device,
  where ~90 % of frames already sit on one display interval — the finding the
  [vendor levers](../../benchmarks/opensa-engine/2026-09-05-mobile-vendor-levers.json) paid for.
- **The frame's largest term is elsewhere.** The 20.2 ms empty map is the remaining budget and the post
  chain is the biggest thing in it. Attacking glass before that is optimising the small half.
- **The first two shapes carry a correctness risk the opaque one does not.** Getting an opaque run wrong
  draws cars at another car's matrix and a test can see it; getting a blend group wrong changes what sorts
  over what, which renders, looks plausible, and is exactly the failure 074/16 round 6 exists to prevent.

## What would make it worth taking

`vehicleDrawsBlend` climbing past the low thousands on a board that is otherwise in budget — a bigger fleet,
or vehicles with more translucent submeshes than the five types measured here — **together with** a frame in
which the post chain is no longer the largest term. Both, not either.
