# 089/02 — Tyre smoke

**Status: SHIPPED 2026-07-28** (branch `089-02-tyre-smoke`), awaiting the field verdict — this plan's
acceptance is by eye, and all four fitted numbers are session-dialable for that drive.

## The finding that shaped it: Rapier's wheel rotation is cosmetic

The obvious signal — the telemetry's rotation-derived slip ratio — is DEAD in this stack: Rapier's
`wheelRotation` follows the ground exactly (measured on the brake-strip lap: 0.05 m/s of "slide" during a
sustained −1.1 g full-brake stop), and its brake is an impulse CAP, so a wheel never visibly locks and a
burnout never visibly spins. A rotation-based tyre smoke would smoke never.

The honest longitudinal signal is **demand over cap**, and only `PhysicsWorld.setVehicleControls` knows
both sides: it clamps the brake to `grip × step` and the engine to `grip` (the original's
`CVehicle::ProcessWheel` adhesion limiting). It now records, per wheel per step, how far each demand went
PAST the tyre — `brakeExcess` (the handbrake reads exactly 1) and `spinExcess` — read back through
`readVehicleWheelSlip` (`VehicleWheelSlip`). Note the near-miss the sliding flag would have been:
the friction circle is judged against the BOOSTED lateral grip (081/09), so a full-brake wheel at speed
sits at a third of the circle and never flags.

## Shape

- **`packages/game/src/vehicle/vehicle-tyre-smoke.system.ts`** — per contacting wheel, one equivalent
  slide speed: `max(|speedLateral|, min(1, brakeExcess) × |speed|, min(1, spinExcess) × SPIN_TO_SLIDE)`;
  a linear ramp between `slideStart`/`slideFull` drives a per-wheel spawn accumulator (`rate` × intensity,
  fractional puffs carry across steps, a gripping tyre forfeits its fraction). Spawns at the wheel's
  contact point (`PhysicsWorld.wheelContactPoint`, now public — the controller already computed it).
  Deliberately NOT on `VehicleTelemetry` — that sampler is the F2/capture gate, and smoke must not need
  the debugger open. Driven car only (the readme's budget: the player's car is the target).
- **Host sink** (`engine-vehicles.ts`): one `collisionsmoke` emitter from the dynamic lane, repositioned
  per puff (GTA → engine space like the lamps), `lifeScale = 0.3 + 0.3 × intensity` (a chirp wisps in
  ~1.5 s, a burnout lingers ~3 s of the authored 5), `burst(count)`. `DynamicFxEmitter.lifeScale` is
  089/02's one addition to the lane.
- **Dials** — `?smokeStart=<m/s>` `?smokeFull=<m/s>` `?smokeRate=<n/s>` (the 081/09 session-dial pattern).
  Defaults 3 / 12 / 25. Every fitted number is in `docs/hacks/tyre-smoke-intensity-fit.md` — SA's
  `CFx::AddWheel*` bodies are stubs in gta-reversed, so the mapping is a fit, not a port.

## Verification

- **Tests**: `vehicle-tyre-smoke.system.test.ts` — negative first (on foot, gate off, no slip record,
  fast-but-gripping, sub-threshold drift, standstill lockup does NOT smoke, airborne wheels never smoke),
  then brake-past-cap ∝ speed at the contact point, handbrake at speed, standstill burnout via
  `spinExcess`, pure lateral drift, harder-slides-more-particles.
- **Headless brake-strip lap** (infernus, 126 km/h → 0 in 65.5 m at −1.1 g): two clean smoke trails
  follow the braking path, dense at the wheels, dissipating behind; frame pinned at the 120 Hz cap,
  GPU 1.87 ms during the skid (the smoke's screen coverage here does not register — the lane's cost story
  stays the 089/01 measurement, overdraw-bound).
  Run note: [`2026-07-28-headless-089-02-brake-strip-smoke.json`](../../benchmarks/opensa-engine/2026-07-28-headless-089-02-brake-strip-smoke.json).

## Open / next

- Surface routing (smoke on tarmac vs dust on dirt) is step 5's job — today every surface smokes white.
- Skid marks (089/03) should read the SAME `readVehicleWheelSlip` record — the darker-the-harder rule is
  this step's intensity, applied to a decal ribbon.
- Field drive owed: lock-up stop, handbrake flick, gentle corner (must stay silent), burnout launch.
