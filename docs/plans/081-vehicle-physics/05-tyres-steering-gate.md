# 081/05 — Tyres + steering feel + THE GATE (own controller: go / no-go)

The chain's decision plan. Everything DRCVC's tyre scalars can express lands first; then the gate
measures whether that ceiling blocks the feel bar, and the own-controller call is made on numbers.

## 1. Traction mapping (inside DRCVC)

- `frictionSlip` per wheel from `tractionMult` (today: flat 10.5 for every car), split front/rear
  by `tractionBias`; `sideFrictionStiffness` scaled by the same pair — documented formulas, the
  same values an own controller would consume (controller-agnostic rule).
- `tractionLoss` engages where SA uses it: as the wet/offroad/surface scale hook. v1: a single
  surface factor from the collider the wheel ray hit (road vs grass/sand via collision material —
  IF the streamed colliders carry a usable material tag; if they don't, record that as a plan-07
  note and keep the global factor). No weather coupling yet (0.5.0 weather plan owns rain).
- With drive-type torque (plan 04) + per-axle grip, the classes should now separate: FWD pushes
  wide on power, RWD rotates. The slalom + a new `throttle-in-corner` scene quantify it.

## 2. Steering feel v2

- Keep the shipped rate-limit + speed-sensitive lock (they answered the 2026 complaint half-way);
  re-derive constants from handling `steeringLock` honestly (the 0.6 scale becomes a named factor)
  and make the speed falloff curve live-tunable.
- **Counter-steer assist** (toggleable, default ON — SA is arcade): when the body slip proxy
  exceeds a threshold with steering opposing the slide, widen the effective lock toward the slide
  and add a small self-aligning yaw torque — catches feel natural instead of pendulum spins.
- **Return-to-centre**: recenter rate scaled by speed (parking: lazy; highway: firm) — replaces the
  flat 2.4 rad/s.
- Keyboard reality check: A/D are digital; the rate limiter IS the analogue feel. Tune rates on the
  slalom replay (keyboard metronome input) — not against an imagined analogue stick (no gamepad
  path exists; 080 records the same scope cut).

## 3. THE GATE — measured verdict on DRCVC's tyre ceiling

Run after 1+2 are field-tuned. **Criteria (all from replays + the field round):**

| #   | Test                               | DRCVC passes if                                                           |
| --- | ---------------------------------- | ------------------------------------------------------------------------- |
| G1  | throttle-in-corner, RWD (Infernus) | breakaway is PROGRESSIVE (slip proxy ramps over ≥0.5 s, not a step)       |
| G2  | handbrake-turn                     | slide is holdable ≥1.5 s and recoverable without a spin ≥50 % of attempts |
| G3  | slalom at 80 % top speed           | no snap oversteer on direction change (yaw-rate spikes within band)       |
| G4  | user field verdict                 | "cornering breathes; slides are controllable" — the feel bar, in words    |

- **PASS** → DRCVC stays; the own-controller question closes for 081 (revisit only if 0.5.0
  vehicle types hit it again — bikes probably will).
- **FAIL** → build the own raycast controller as designed below; the chain's 02–04 systems carry
  over UNCHANGED (they are chassis forces + per-wheel parameters by construction).

### The own-controller design (pre-agreed shape, built only on FAIL)

Behind the SAME `PhysicsWorld` surface (`createDynamicVehicle` / `setVehicleControls` /
`updateVehicle` signatures unchanged; a per-car flag chooses the backend during bring-up):
Rapier dynamic body + per-wheel ray (later shapecast for kerbs); suspension = spring/damper from
the plan-02 per-car values; tyres = **3-segment slip curve** (linear grip → peak → sliding falloff)
on slip angle (lateral) + slip ratio (longitudinal), **combined via friction circle**, load-dependent
from suspension force; the plan-04 drivetrain feeds wheel torques directly (wheelspin becomes real).
~500 focused lines + the plan-01 telemetry already speaks its language. Quirks ledger items
seedReverse/phantom-speed die with it; parking brake + spawn lessons stay.

## Subtasks

- [ ] Traction mapping + per-wheel application + tests (bias split, surface factor path).
- [ ] `throttle-in-corner` scene + drive-type A/B captures (F vs R vs 4 on one chassis — synthetic
      handling rows make this a clean experiment).
- [ ] Steering v2 (named factors, counter-steer assist, speed recenter) + slalom retune + tests.
- [ ] Gate run: G1–G3 captured on the tuned build, G4 field round; **verdict + reasoning recorded
      here** (the decision record the 0.4.0 idea asked for, finally with data).
- [ ] If FAIL: own controller bring-up as its own ledger section (scenes re-run, quirk tests
      retired/kept explicitly).

## Acceptance

- Gate verdict recorded with the four criteria's numbers/verdicts; either path leaves the scene
  matrix green within bands and the field round accepted.
- FWD/RWD/4WD visibly distinct in captures and in the field.

## Ledger

_(traction formulas, steering factors, gate captures, THE VERDICT)_

## Ledger

### 2026-07-26 — the tyre gets its authored grip (brought forward: 04's field round demanded it)

This plan was scheduled after the drivetrain. The drivetrain's field round moved it: with a real gearbox
behind them, the cars became undriveable, and the user's three complaints — violent launches, "they fly like
aeroplanes", kerbs launching flips — were one number.

**`WHEEL_FRICTION_SLIP = 10.5`**, Bullet's demo default, is a friction coefficient fifteen times a real
tyre's. `fTractionMultiplier` IS that coefficient (the table gives cars 0.55…0.75) and Rapier's
`frictionSlip` is the same quantity — its friction impulse is capped at `frictionSlip × suspensionForce × dt`.
So the fix is to hand each wheel its authored number, split across the axles by `fTractionBias` in the
original's `2 × bias` / `2 − 2 × bias` form.

**The trap, and it is worth remembering.** Handing over the right coefficient changed nothing at first: the
fleet still launched at 5 g. Rapier computes the friction limit and a `skid_info` factor, then applies it
only `if wheel.side_impulse != 0.0` — so a car accelerating or braking dead ahead has **no longitudinal grip
limit at all**. The original clamps in exactly this place (`CVehicle::ProcessWheel` limits the wheel's force
by its adhesion), so the clamp now happens on our side, per wheel, against `μ × the load that corner carries`.
The lateral half is left to Rapier, whose friction circle does run once a wheel has any side impulse.

Engine force also reaches DRIVEN wheels only now. That is what the drive-type divisor was always for: ÷4
pushed by four wheels and ÷2 pushed by two come to the same total, which is why 04's "4WD cars are weaker"
reading was wrong.

| car      | drive | μ    | launch g        | brake g     |
| -------- | ----- | ---- | --------------- | ----------- |
| infernus | 4     | 0.70 | 1.07 → **0.70** | 1.33 → 1.14 |
| comet    | R     | 0.67 | 1.65 → **0.43** | 2.39 → 0.92 |
| admiral  | R     | 0.70 | 1.00 → **0.37** | 0.71 → 0.58 |
| firetruk | R     | 0.55 | 1.86 → **0.35** | 1.36 → 0.80 |

The 4WD car lands on its coefficient exactly; the rear-drive cars land near half of theirs, because a rear
axle carries about half the car. Cross-checked against the original rather than against taste: SA's own
adhesion formula by hand for the admiral gives ≈ 0.4 g against our measured 0.37.

**Field verdict**: *"significantly better — you feel the weight of the car, you feel the power. The best
result so far. One flaw: hard to turn into a corner at speed, as if the car has been made too heavy."*

**Next, from that verdict**: the steering still carries two constants fitted when grip was infinite —
`STEER_LOCK_SCALE = 0.6` (use only 60 % of the authored lock) and `STEER_SPEED_FALLOFF = 0.6` (shrink it by
another 60 % toward top speed). They now stack on top of a real tyre, which is its own limiter. The original
has a limiter here too (`steerAngle = asin(min(adhesive × traction × 16 / v², 1)) / lock`) — it is grip-based
rather than fitted, and it is MORE restrictive than what the field already called too heavy, so it must be
measured against simply letting the tyres do the limiting before either is adopted.

**Still open in this plan**: `fTractionLoss` (the sliding regime), surface types (`ROAD_ADHESION = 1` stands
in for `g_surfaceInfos`), and the own-controller gate.

### 2026-07-26 — the steering gets the whole authored lock back, and the original's limiter on top

**Field verdict**: *"hard to turn into a corner at speed, as if the car has been made too heavy."*

Two fitted constants were the cause, both tuned when grip was 10.5: `STEER_LOCK_SCALE = 0.6` (use 60 % of the
authored lock, unconditionally) and `STEER_SPEED_FALLOFF = 0.6` (shrink that by up to 60 % more toward top
speed). At 90 km/h an admiral could reach 14.7° of its authored 35°. Under a real tyre they read as weight.

`vehicle/steering.ts` replaces them with the original's law —
`asin(min(adhesive × traction × 16 / v², 1)) / lock` (`CAutomobile::ProcessControl`) — over the FULL authored
lock, with the original's two exemptions: countersteering into a slide and the handbrake both restore full
lock. Where it bites is the point: at 50 km/h it allows 8.3° against the 5.25° an ordinary corner asks for, so
normal driving never meets it, and it tightens with v², refusing only what no tyre could answer.

**A wrong turn worth recording.** The first reading of the field verdict was "saturated front tyre, so LESS
angle would turn better" — true of a real tyre's falling curve, false here: Rapier's tyre is a flat cap at
`μ × load`, so below the cap more angle is more force and above it the extra angle only scrubs. The
measurement said so before any of it shipped.

| scene / car     | fitted 0.6 × lock | full lock + the limiter |
| --------------- | ----------------- | ----------------------- |
| u-turn, comet   | 18.0° → yaw 0.932 | **30.0° → yaw 1.302**   |
| u-turn, admiral | 16.8° → yaw 1.135 | 28.0° → yaw 0.611       |

The admiral turns worse — at FULL LOCK, which is the pathological input, and against a fitted run that was
itself crashing (35 g, 2.33 s airborne). A rear-drive sedan given full lock at 40 km/h scrubs its front tyres
wide in reality too. The complained-about case is the ordinary corner, where the angle is simply no longer
capped below what the corner asks. **Needs the field to judge** — this is the one item in this chain whose
replay evidence is genuinely split.

### 2026-07-26 — the surface adhesion was GUESSED, and the game ships the number

**Field verdict**: *"better, but still hard to turn into a corner at speed."*

The original's steering limiter has three terms — `adhesive × traction × 16 / v²` — and two of them came from
the car's own row. The third, `g_surfaceInfos.GetAdhesiveLimit`, was written here as **1.0 with a comment
saying it stood in for a lookup this engine cannot do yet**. That was the mistake: the lookup is two data
files that ship in the build and both are unambiguous.

- `data/surfinfo.dat`: `WHEELBASE → RUBBER` and `TARMAC → ROAD`. (surface.dat's own header note says
  *"Currently WheelBase is the surface used for the tyres"*.)
- `data/surface.dat`: a 6×6 matrix of adhesion groups. Road × Rubber = **4.5**.

Since the limiter divides by the square of speed, a guess 4.5× low left every car with 4.5× less steering
than the original gives it:

| speed    | usable angle at 1.0 (guessed) | at 4.5 (the game's own table) |
| -------- | ----------------------------- | ----------------------------- |
| 50 km/h  | 8.3° of 35°                   | **35° — the whole lock**      |
| 100 km/h | 2.1°                          | **9.4°**                      |

So town driving is no longer limited at all (full lock to ~53 km/h) and a car at 100 km/h can place itself in
a lane instead of only nudging.

**The scene set could not see this change**, and that is worth recording as an instrument gap: `u-turn` runs
at full lock, where the countersteer exemption already returns 1, and `step-steer` asks for 0.15 of the lock,
which is under the limit even at the old value. Nothing in the nine scenes holds a MODERATE steer at high
speed — the exact case the field is complaining about. A sweeper scene is owed.

**And an honest dead end, recorded so it is not walked again.** Trying to reconcile our grip magnitudes with
the original's led into a chain that does not close: `thrust` per driven wheel and `adhesion` per wheel both
turn into velocity deltas via `ApplyMoveForce`, and following it literally has a stock admiral launching at
~1.8 g, which the real game plainly does not do. Something in that chain is still misread (candidates: the
suspension-compression term's sense, `CTimer::GetTimeStep` at the game's real frame rate, or a division in
`ProcessWheel` not yet traced). Our tyre model — `μ × the load the corner carries` — is calibrated
differently and gives numbers the field has already accepted for launch and braking, so it stays. Closing
that gap needs the original running side by side, not more reading.

**Owed**: read `surface.dat` + `surfinfo.dat` instead of carrying 4.5 as a constant (both are mod targets,
and the full matrix is what wheels need the moment they can tell tarmac from grass), and add the sweeper
scene.
