# Physics runtime (Rapier vehicle controller) — edge cases

What Rapier's `DynamicRayCastVehicleController` does NOT model, discovered the hard way. The engine's
vehicle feel is built on top of these boundaries (plan 081's clamps, plan 089's signals); anyone reading a
wheel channel should check this list before trusting it.

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
