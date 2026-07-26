# 081/03 — Weight transfer and impact response

**Rewritten 2026-07-26, after 081/01-02 measured the things this plan was guessing about.** The original
brief opened with anti-roll bars and treated the flips as a cornering problem. The matrix says otherwise, and
two of its findings move the whole plan:

1. **Not one flip in the record is a cornering flip.** Three of five follow a vertical impact of 24-31 g
   (0.30 s, 0.85 s and 2.03 s later); the other two happen at **−1 and −6 km/h** — a car already
   destabilised, tipping slowly. The step-steer series is plainest: a full second of held lock produces
   **0.05° of roll**, and the car only goes over 1.2 s AFTER a 7.6 g kerb strike.
2. **The braking dive is not suppressed by the chassis damping.** The infernus pitches **0.15° under braking
   at damping 2.0 and at 0.5, identically** — and dropping the damping made impact flips worse while buying
   nothing. So the band-aid stays until this plan ships something real.

So this plan is no longer "four stability forces". It is **two questions, in order**: where does the weight
go when a car brakes, and what happens when a wheel meets an edge. Anti-roll and downforce survive as
smaller, later items, justified by their own numbers rather than by the flip complaint.

## 0. First, ANSWER a question the chain cannot proceed without

**Does the raycast controller transfer load at all under braking?**

Physics says it must: braking force acts at the contact patch, the centre of mass sits ~0.5 m above it, so a
1400 kg car at 1.7 g generates ~12 kN·m of pitch moment and the front springs should compress. The measured
answer is 0.15° of pitch, which is nearly nothing — and 081/02 proved it is not the damping and not the
spring rate (per-car springs changed the number by tenths).

That leaves one candidate: **Rapier's `DynamicRayCastVehicleController` may apply its engine/brake force at
the chassis centre of mass rather than at the contact patch**, in which case the pitch moment never exists
and NO anti-dive multiplier can ever produce a dive. This is cheap to settle and everything below depends on
it:

- An isolated Rapier test: a car at speed, full brake, read `wheelSuspensionForce` front vs rear across the
  stop. Load transfers ⇒ the moment exists and §1 is a tuning job. Load does NOT transfer ⇒ §1 becomes
  "apply the longitudinal tyre force ourselves, at the contact point", which is a different and larger task.
- Extend the `[phys]` capture with per-wheel load while doing it (the instrument rule from 081/02: measure
  what you are about to tune, and let the run say what it saw).

**Nothing else in this plan starts before this is answered in the ledger.**

## 1. Weight transfer under braking and power (the nose fix)

The complaint, quantified after 081/02, on a straight brake strip — positive is NOSE UP:

| Car      | Pitch while braking | Deceleration | Authored `antiDive` |
| -------- | ------------------: | -----------: | ------------------: |
| infernus |          **+0.15°** |      1.72 g  |                 0.4 |
| comet    |          **+0.45°** |      2.22 g  |                0.18 |
| admiral  |              −0.22° |      0.76 g  |             **0.0** |
| firetruk |              +0.06° |      0.53 g  |             **0.0** |

**Read the last column before designing anything.** Two of the four cars author `antiDive = 0.0` and they
brake correctly in the original game — so anti-dive is an ASSIST that shapes an existing transfer, never the
thing that creates it. A design that produces dive only where `antiDive > 0` is wrong on its face.

- If §0 says the moment exists: apply SA's own term — a pitch-compensation torque
  `T = antiDive × brakeForce × h_com` opposing the brake pitch moment, plus the mirrored
  `antiSquat × driveForce` for launch (keep a LITTLE squat; it reads as power). Then the sign comes from
  the physics and the multiplier only tempers it.
- If §0 says it does not: the longitudinal tyre force gets applied by us at the contact point, and the
  authored multiplier rides on top. Larger, and it is what makes the complaint fixable at all.
- `fBrakeBias` (0.51 / 0.55 / 0.63 / 0.45 on the trio + comet) is unread today and belongs here or in plan
  04 — a rear-biased brake is also what spins a car under braking, which the comet did before 081/02.

**Acceptance**: nose-DOWN pitch on every reference car, magnitude in a band recorded from the field round
(~1-3° for a sedan, tighter for a sports car), settling without porpoising. The `brake-strip` capture is the
instrument, and the BEFORE numbers above are what it is measured against.

## 2. Impact response (what the flips actually are)

Every flip in the record traces to a wheel meeting something. The mechanism is not exotic: a raycast wheel
sees the world through a downward ray, a kerb face is invisible to it until the wheel centre crosses the
edge, and then the whole penetration resolves in one step as a vertical impulse the spring cannot absorb —
24 to 31 g — which becomes body rotation because nothing else can take it.

- **The measurement first, again**: from the existing captures, correlate `gVert` spikes with the roll that
  follows (the ledger already has five cases). Then per case: was it a kerb, a landing, or a car-to-car hit?
  The `kerb-strike` and `crest-jump` scenes are the two controlled instruments.
- **Candidate mechanisms, in the order they should be tried** (each measured before the next):
  1. **Let the spring absorb it.** Travel and force cap are now per-car (081/02 §3) but the IMPULSE still
     arrives in one step. A contact-force clamp per wheel, or a sub-stepped suspension on large penetrations,
     may be the whole fix.
  2. **See the edge before hitting it.** A short forward probe per wheel converts a step ≤ ~0.25 m at low
     speed into a ramp instead of a wall (this is plan 06 §2's kerb assist, promoted here because the data
     says it is a STABILITY mechanism, not a polish one).
  3. **Cap what an impact can do to attitude.** A roll-rate limiter that engages only above a threshold —
     the honest, scoped replacement for the global damping (see §4).
- **Acceptance**: the four flips 081/02 fixed stay fixed; the fifth (infernus slalom) stops; a deliberate
  kerb strike at speed still hurts — SA punishes that and so should we.

## 3. Anti-roll bars — demoted, and justified separately

Still worth having, but NOT as the flip fix: the flips are impacts. What anti-roll bars are for is the roll
that cornering DOES produce — the infernus slalom still reaches 106.9° of roll after 081/02, and that is a
real number to reduce.

- Per axle `F = k_arb × (compressionLeft − compressionRight)`, applied down on the extended side and up on
  the other; an airborne wheel contributes 0. `k_arb` from `suspForce` × the axle's mass share (`suspBias`).
- Front-biased by default (understeer is the safe road-car bias); the per-class knob belongs to plan 07.
- **Do not tune this until §1 and §2 land** — a bar fights a symptom of both, and tuning it first would hide
  what they are supposed to fix.

## 4. Retiring the damping band-aid, with the evidence to do it

`CHASSIS_ANGULAR_DAMPING = 2` is still live because 081/02 MEASURED that removing it costs stability and buys
nothing: the dive does not change (0.15° either way) and impact flips get worse (step-steer roll −74° → −95°).

It comes off here, in the same change that ships §1 and §2, and the acceptance is the full scene matrix at
the new value against the 081/02 record — not an opinion. If a scoped roll-rate limiter (§2.3) is needed to
hold the line, that is the honest replacement: it acts on fast roll only and leaves pitch, yaw and slow body
motion alive, which is exactly what the global damping cannot do.

## 5. Downforce — last, and only if the numbers ask for it

A speed² term at the centre of mass, per class, for highway stability and jump attitude. **Deferred until
§1-§3 are measured**: nothing in the record currently blames high-speed instability, and adding a force with
no complaint behind it is how a chain acquires constants nobody can justify later. If the 03 field round
reports float at speed, it comes back with that verdict attached.

## Subtasks

- [ ] **§0** Load-transfer test (isolated Rapier) + per-wheel load in the `[phys]` capture. Answer in the
      ledger BEFORE anything else starts.
- [ ] §1 Weight transfer: whichever path §0 selects, + `brakeBias`, + tests on scripted wheel states.
- [ ] §2 Impact response: correlate the record's spikes, then mechanisms 1→3, each measured before the next.
- [ ] §3 Anti-roll bars, after §1-§2, with the slalom roll number as their justification.
- [ ] §4 Damping to ≤0.5 + full matrix re-run against the 081/02 record.
- [ ] §5 Downforce ONLY if the field round asks for it.
- [ ] F2 Physics tab: live gains + per-system toggles (in-session A/B, the 080 pattern).
- [ ] **Field round**: brake feel ("does the nose dip"), kerbs at low and high speed, flip resistance under
      abuse, plus a regression drive of everything since 02.

## Acceptance

- **Brake-strip: nose-DOWN on every reference car** — the sign flips, with a recorded band and a field
  verdict. This is the complaint the user has raised twice.
- **Zero flips in the matrix**, including the infernus slalom; a deliberate high-speed kerb strike still
  punishes.
- Angular damping at ≤0.5 with the matrix no worse than the 081/02 record.
- Fixed-step cost of everything added ≤ 0.05 ms for the player car (and this time it is measured — 081/01's
  equivalent clause was never isolated).

## Ledger

_(§0's answer first — everything below depends on it)_

### 2026-07-26 — §0 ANSWERED: the load transfers. The spring is 7× too stiff to show it.

An isolated Rapier test (a car at 42 m/s, full brake, per-wheel `suspensionForce` read across the stop):

| State           | Front load | Rear load | Front share |
| --------------- | ---------: | --------: | ----------: |
| at rest         |     6863 N |    6863 N |       50 %  |
| under power     |     4644 N |    9081 N | 34 % (squat — correct) |
| **under brake** | **13480 N** | **765 N** |  **94.6 %** |

**So the controller transfers weight, and hard.** The feared answer — that Rapier applies the brake force at
the centre of mass and no pitch moment exists — is WRONG, and the larger task it implied is not needed. The
transfer is even physically consistent with the deceleration we have (2 g × 0.5 m of COM height over a 2.8 m
wheelbase predicts ~4.9 kN of transfer; the measurement shows more because the deceleration is higher still).

**The dive is invisible for a different reason: the springs are far too stiff to move.**

| | Measured | A real road car |
| --- | ---: | ---: |
| Spring rate per wheel | **229 kN/m** | 20-55 kN/m (1.2-2.0 Hz) |
| Static deflection under its own weight | **1.5 cm** | 6-17 cm |
| Front-spring travel added by the braking transfer | **1.45 cm** | 10.7 cm |
| Resulting pitch over a 2.8 m wheelbase | **0.59°** | **4.36°** |

Doubling the load on a spring that deflects 15 mm under the whole car's weight moves it another 15 mm, and
15 mm across a wheelbase is half a degree. The car IS diving — by a distance no one can see.

**This redirects §1 completely.** Anti-dive REDUCES dive; the car has none to reduce. The lever is the
reference spring rate that everything scales off — `SUSPENSION_STIFFNESS = 120`, tuned in-browser for a car
that must not sink into the road, and about **7× a real one**. `fSuspensionForceLevel` multiplies that
reference, so every car in the game inherits the error.

It also explains three complaints at once, all of which have been treated separately until now:
- **no dive under braking** (this measurement),
- **0.05° of roll under a second of held lock** (081/01's step-steer — same stiffness, same reason),
- **"a kerb flips it, like cardboard"** — a spring that cannot deflect cannot absorb an impulse, so the
  impulse becomes body rotation. §2's first candidate mechanism was "let the spring absorb it"; it now has a
  number attached.

**What §1 becomes**: soften the reference rate toward a real one, and re-verify what it was raised to prevent
— the launch hop and the chassis sinking into the road on soft, under-damped springs (the 074 field lesson
the constant's comment records). Damping scales with the rate, so the two move together; the `rest` scene and
the brake-strip capture are the instruments, and the whole matrix is the regression net.

**Estimated size of the change**: one constant, one damping ratio, and a very careful measured walk down —
because the last time this chain changed a suspension number by 10 % a parked car started shivering.

### 2026-07-26 — §1 SHIPPED: the nose dives, on every car

Two changes, both derived from §0's measurement rather than tuned:

1. **The mass term is gone from the stiffness.** Rapier already multiplies by chassis mass (`force =
   stiffness × compression × mass × 1.43`, probed across 1400 kg and 6500 kg), so 081/02's mass normalisation
   double-counted and the rate grew with mass² — the firetruck was riding a spring that sagged **3.3 mm**
   under its own weight. Without it, static sag is a function of stiffness alone, so every car sits at its
   design height whatever it weighs.
2. **The reference rate went 120 → 34**, targeting ~5 cm of static sag against the old 1.5 cm, and **damping
   is now DERIVED from the rate** (`ratio × 2√stiffness`, Bullet's relation) with the ratios taken from the
   pair tuned in-browser at 112. Softening a spring without rescaling its damping would have left every car
   damped for a seven-times-stiffer spring — and the high compression ratio preserves the 074 launch-hop
   lesson as a RATIO, so it survives the next rate change too.

**The result, measured on the brake strip — negative is NOSE DOWN:**

| Car      | Dive (mean pitch while decelerating) | Deceleration | Stiffness |
| -------- | -----------------------------------: | -----------: | --------: |
| infernus |                          **−0.97°** |       2.04 g |      37.1 |
| comet    |                          **−1.08°** |       2.32 g |      19.8 |
| admiral  |                          **−1.49°** |       0.94 g |      28.7 |
| firetruk |                          **−0.28°** |       0.53 g |      37.1 |

**The sign is right on all four**, and the heavy truck dives least — which is what a heavy truck on soft
springs does. The magnitudes sit at the low end of the plan's 1-3° band; the deceleration being 2 g on the
sports cars (plan 04) is part of why, since a shorter stop spends less time in the transfer.

**A metric had to be fixed to see it.** `pitchUnderBrakeDeg` is the PEAK nose-up while braking, and it fires
at the instant the brake bites — before the nose has come down. The comet reports **+1.65°** there while
actually diving to −2.58°. The whole BEFORE record was measured with it, so it stays for comparability, and a
new `diveDeg` (mean pitch over the frames that are really slowing) answers the question that was being asked.
The old field is not wrong; it was answering a different question, and nobody noticed for two plans.

**Still owed in §1**: `fBrakeBias` is unread, and the deceleration is too high — both plan 04. Anti-dive
(`fSuspensionAntiDiveMultiplier`) is NOT needed to produce dive, exactly as the authored zeros predicted; it
remains available to SHAPE it once 04 makes the braking force honest.
