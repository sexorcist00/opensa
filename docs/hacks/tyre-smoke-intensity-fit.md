# Tyre-smoke intensity fit

**Live.** Taken 2026-07-28 with plan 089/02 (tyre smoke on the dynamic particle lane).

## What it is

`packages/game/src/vehicle/vehicle-tyre-smoke.system.ts` and the sink in `apps/web/src/ui/engine-vehicles.ts`:

```ts
export const TYRE_SMOKE_DEFAULTS: TyreSmokeDials = { rate: 12, slideFull: 12, slideStart: 3 };
const SPIN_TO_SLIDE = 6; // m/s of "slide" bought by a full wheelspin surplus
const BRAKE_DEADZONE = 0.25; // demand must exceed the cap by this before it reads as a lockup
const SPIN_DEADZONE = 0.75; // and by this before it reads as wheelspin
smokeEmitter.lifeScale = 0.25 + 0.25 * puff.intensity; // 1.25–2.5 s of the authored 5 s collisionsmoke life
{ alpha: 0.45, name: 'prt_collisionsmoke' } // the lane scales the authored alpha envelope (engine-particles.ts)
```

Plus the shape of the signal itself: three channels reduced to one "equivalent slide speed" —
`max(|speedLateral|, ramp(brakeExcess) × |speed|, ramp(spinExcess) × SPIN_TO_SLIDE)` where `ramp` is the
deadzone-to-1 linear map — then a linear ramp between the two dials drives both the spawn rate and the
particle life.

**Field round 1 (2026-07-28)** produced the deadzones, the halved rate, the shorter life and the alpha
scale: keyboard pedals are binary, so a full-throttle pull-away in first and an ordinary full-pedal stop
both demand past the cap — the verdict was "smoke pours constantly while just driving", and the full
authored alpha stacked per-step bursts into solid white ("is there no alpha channel?"). A demand that
merely rides the cap is ABS-shaped gripping; only demand well past it reads as slide. The handbrake's
recorded 1 still maps to full lock through the ramp.

## What it stands in for

SA's `CFx::AddWheel*` parameterisation — how many particles per wheel state per frame, at what life, at what
opacity. Those bodies are STUBS in gta-reversed (they call the original addresses), so there is no formula
to port. The wheel-state DETECTION, by contrast, is not fitted: brake-demand-past-cap and engine-past-cap are
read from the same clamps `setVehicleControls` applies, which mirror `CVehicle::ProcessWheel`'s adhesion
limiting; `speedLateral` is a measured velocity.

`SPIN_TO_SLIDE` exists because Rapier has no tread overspeed at all (wheel rotation is cosmetic — it follows
the ground even under a −1.1 g locked stop, measured 2026-07-28), so a burnout's slide SPEED is
unrecoverable and the surplus RATIO buys speed at a made-up exchange rate.

## What it was judged on

The headless brake-strip lap (infernus, 126 km/h full stop): two clean smoke trails follow the braking
path, dense at the wheels and dissipating behind — reads as the game's own brake skid. Unit tests pin the
signal (burnout smokes, standstill handbrake does not, gentle corners silent). The user's field verdict is
the plan's acceptance and may move all four numbers — they are session-dialable for exactly that
(`?smokeStart/?smokeFull/?smokeRate`).

## What would retire it

Recovered `CFx::AddWheel*` parameters (a deeper gta-reversed pass, or measuring the original's particle
counts per wheel state frame-by-frame from captures). The lifeScale mapping retires if the dynamic lane ever
carries per-particle alpha — rate and life are the only per-spawn look knobs today.

## Blast radius

Tyre smoke only (089/02). Step 4's impact smoke and step 5's surface effects will carry their own fits —
this one's numbers are not shared. The `readVehicleWheelSlip` record itself is honest physics and is NOT
part of the hack; skid marks (089/03) are expected to read the same record.
