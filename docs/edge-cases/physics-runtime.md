# Physics runtime (Rapier vehicle controller) — edge cases

What Rapier's `DynamicRayCastVehicleController` does NOT model, discovered the hard way, plus where a vehicle
body may exist at all. The engine's vehicle feel is built on top of these boundaries (plan 081's clamps, plan
089's signals); anyone reading a wheel channel should check this list before trusting it.

## No parked car exists between 150 m and 250 m

A dynamic body needs static collision under it, and collision streams to a **shorter** radius than the vehicle
LOD ring: `streaming.collisionDrawDistance` is **150**, `vehicle.lodDistance` is **250**. So the LOD system
creates a car only within `min(150, 250)`, and the 100 m band between the two radii is empty of cars by
construction. Approaching a lot, its cars appear at 150 m rather than at the LOD distance.

This is the price of the alternative, which was measured in the field on 2026-08-02: cars spawned in that band
free-fell through the world, and because the unload distance was measured from the fallen body's own position,
the spot never repopulated — one lot in LS emptied for the rest of the session, silently
([the fix](../open-issues/fixed/parked-cars-do-not-respawn.md), and the rule in
[`restrictions/architecture.md`](../restrictions/architecture.md)).

**If the pop-in ever reads badly, the lever is the collision radius, not the spawn radius.** Raising
`lodDistance` alone puts the cars back over the hole.

## Wheel rotation is COSMETIC — it follows the ground exactly

`controller.wheelRotation(i)` integrates the CONTACT velocity, not a simulated wheel: under a sustained
−1.1 g full-brake stop the rotation-derived "slide" measured **0.05 m/s** (2026-07-28, brake-strip lap,
per-step log). There is no lockup and no wheelspin in that channel, ever — a slip ratio derived from it
(`WheelFrame.slipRatio`) reads ~0 through the hardest stop the car can produce.

**The honest longitudinal signal is demand-over-cap**, recorded where `setVehicleControls` clamps the
demands: `PhysicsWorld.readVehicleWheelSlip` → per-wheel `brakeExcess` (handbrake = exactly 1) and
`spinExcess`. The tyre smoke, skid marks and surface effects (089) all read it; the telemetry's
rotation-derived ratio stays for what it can see (a rolling wheel's speed match).

## The friction-circle `sliding` flag misses under straight-line braking at speed

`setVehicleControls` judges "sliding" against the 081/09 speed-BOOSTED lateral circle (the one Rapier
actually enforces), while the brake impulse caps on the UNBOOSTED grip — so a full-brake wheel at speed
sits at ~a third of the judged circle and never flags. Detecting a braking skid via that flag silently
fails above ~4 m/s; use `brakeExcess` instead.

## Rapier applies its longitudinal grip limit only when a side impulse exists

Its friction-circle scaling runs `if wheel.side_impulse != 0.0` — a car accelerating or braking DEAD
AHEAD has no longitudinal grip limit at all inside Rapier. The engine clamps engine force and brake
impulse to `μ × load` itself (`setVehicleControls`, the 081/04 five-g-launch fix); any new force channel
must apply the same clamp or it will push arbitrary force into the road.
