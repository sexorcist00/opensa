# 081/06 — Air control, kerb smoothing, visible suspension

The perceived-quality plan: three smaller systems that turn "correct" into "alive". Runs after the
gate (05) so it tunes against the final tyre behaviour.

## 1. In-air attitude control (SA lets you fly a little)

- Airborne = all four wheels out of contact for > 0.15 s (debounced — kerbs must not trigger it).
- While airborne: pitch torque from throttle/brake input (W noses up, S noses down — SA semantics),
  small roll torque from steering; magnitudes scaled by `turnMass`, clamped so a crest jump is
  correctable but backflips take commitment. Landing: no special-case — plan-02/03 suspension +
  stabiliser absorb it (the crest-jump replay pins the landing pitch envelope).
- The 080/06 camera landing-dip integration point: vehicle landings feed the same impact channel
  as the damage system's contact events (no new plumbing).

## 2. Kerb / step contact smoothing

- Known raycast-vehicle weakness: a vertical kerb face is invisible to a downward ray until the
  wheel centre crosses the edge → snag or launch. v1 mitigation inside DRCVC: a short forward
  low-height probe per front wheel (reuses the plan-04/080 raycast API) that converts a detected
  step ≤ ~0.25 m at low speed into a brief upward impulse ramp (curb-mount assist), and above a
  height/speed threshold lets the collision happen honestly (kerbs at 80 km/h SHOULD punish).
- If plan 05 went own-controller: the honest fix is wheel SHAPECAST instead of ray — do that there
  and this section reduces to tuning.
- The `kerb-strike` replay is the acceptance instrument (mount smoothness at low speed, honest hit
  at high speed, no launch).

## 3. Visible suspension: travel, camber, and the axle the car was authored with

**The field brief (user screenshot, 2026-07-26).** A modded Mercedes 230 mid-corner: the body is rolled over
the outside wheels, the loaded wheels have climbed into their arches, the unloaded rear wheel hangs and
**leans with its axle**, and the contact patches smoke. Three separate mechanisms are visible there, and the
engine currently has exactly one of them.

| What the eye reads          | Mechanism                                        | State today |
| --------------------------- | ------------------------------------------------ | ----------- |
| The body leans              | rigid-body roll about the authored centre of mass | **have it** (081/02) — it only became visible once the COM stopped being emergent |
| Wheels move in their arches | per-corner suspension TRAVEL on the drawn wheel   | missing — the render path has no per-part translation at all |
| Wheels lean                 | CAMBER from the axle type + travel                | missing — and the axle type is authored data we parse and ignore |

### 3.1 The data already exists (all of it)

- **Per-corner travel, every fixed step**: `readVehicleWheels` returns `suspensionLength`, `restLength` and
  `maxTravel` per wheel; `WheelFrame.compression` is already that ratio, 0 hanging … 1 bottomed. The visual
  needs no new physics read — 081/01 built this channel for the telemetry and it is the same number.
- **The authored axle type**: `handling.cfg`'s `modelFlags` hex carries, per the file's own legend, the 5th
  digit for the FRONT axle and the 6th for the REAR — `1 NOTILT · 2 SOLID · 4 MCPHERSON · 8 REVERSE`. Plan
  02 types that column but nothing maps it; this section is its first consumer. (Stock examples: most sedans
  leave it 0 = independent-ish default; trucks and vans set SOLID.)
- **The travel limits**: `suspUpper` / `suspLower`, already typed, already the clamp the physics uses — the
  visual must clamp to the SAME numbers or the wheel leaves its arch.

### 3.2 The one new engine primitive

`RigidEntity` composes a part as `root × (bindRotation ⊗ animQuat, bindTranslation, scale)`. There is an
**animation rotation and no animation translation** — `setPartRotation` exists, nothing else does. So the
whole render-side item reduces to one primitive:

- add an `animTranslation` channel (3 floats per part) and add it to `bindTranslation` inside `flatten()`;
- `setPartTranslation(part, [x, y, z])` alongside the existing rotation setter.

Small, and NOT wheel-specific: any part that needs a per-frame local offset (a bouncing bonnet, a sinking
bumper, later damage sag) rides the same lane. **This is the only change below the vehicle layer.**

### 3.3 The chain, corner by corner

1. `VehiclePhysicsSystem` reads the per-wheel compression it already has and hands it to `VehicleRig` —
   which today knows only speed and steer.
2. `VehicleRig` turns compression into two numbers per wheel and smooths them:
   - **travel** (m): `(restLength − suspensionLength)`, clamped to the authored limits;
   - **camber** (rad): from the axle rule below.
3. `VehicleHandle.setWheel(index, spin, steer)` grows to `setWheel(index, { camber, spin, steer, travel })`
   — a shaped argument, because four positional numbers of which two are angles about different axes is how
   a sign bug ships.
4. The engine handle composes `steer(Z) ⊗ camber(Y) ⊗ spin(X)` — **order matters**: a steered wheel must
   camber about ITS OWN forward axis, not the body's, and the spin has to be innermost or it drags the
   camber round with it. Translation goes to the new `setPartTranslation` along the body's local Z.

### 3.4 The camber rule, per authored axle

- **SOLID** (`AXLE_*_SOLID`): the two wheels of the axle are rigidly parallel — the whole axle tilts by
  `atan((travelLeft − travelRight) / trackWidth)` and BOTH wheels take that same angle. This is what the
  screenshot's rear end shows, and it is the visually loudest of the three rules.
- **Independent / McPherson** (default, or `AXLE_*_MCPHERSON`): each wheel cambers with its own travel about
  a per-axle gain — compression leans the top inward (negative camber), droop leans it out. One authored
  gain constant, documented, tuned once in a field round rather than per car.
- **NOTILT**: camber stays 0. Bikes and anything the artist froze.
- **REVERSE**: the sign flips (SA uses it for models whose wheel dummies were exported mirrored).

Track width comes from the wheel placements the physics already has (`connection.x` per side), so nothing
new is measured.

### 3.5 What will go wrong, and the rule for each

- **Buzz.** A raycast suspension length jitters by millimetres on a trimesh; drawn raw it reads as a
  vibrating wheel. Both channels get a short critically-damped smooth (~25 Hz), and the smoothing lives in
  the RIG (fixed step), not in the renderer — a variable-rate smoother would change with frame rate.
- **Wheels through arches.** Clamp to the authored travel, and clamp again to a per-model ceiling measured
  from the wheel-arch geometry if one turns out to be tighter than the handling row claims. Failing that,
  the visual is wrong in the safe direction: less travel, never more.
- **LOD bands.** `setLodBand` swaps to bodies whose wheels may be merged into the hull; the travel/camber
  writes must be no-ops there rather than moving a part that no longer means what it did.
- **Detached parts.** A wheel torn off by damage takes `setPartWorldMatrix` and must ignore both channels.
- **The rider.** The seated ped is placed from the CHASSIS transform, not the wheels — nothing to do, but
  worth stating so nobody "fixes" the seat when the body starts leaning properly.

### 3.6 Why this is worth its place in a physics chain

It is the only item here that changes nothing about how a car behaves and much about whether the car looks
like it has suspension. 081/01 measured that the body barely pitches (0.07° under a 1.6 g stop) and 081/02
found the cause in the springs — so as 02/03 make the body genuinely move, the wheels staying welded to it
becomes the next thing the eye rejects. The two land together or the improvement reads as half-done.

## Subtasks

- [ ] Airborne detector + attitude torques + clamps + tests (debounce, no-input = no torque,
      crest-jump envelope).
- [ ] Kerb probe + impulse ramp + thresholds + tests; `kerb-strike` A/B captures.
- [x] `animTranslation` + `setPartTranslation` on `RigidEntity` (the one primitive below the vehicle layer).
      **Landed early (2026-07-27)** as the stance fix's dependency — see the audit addendum.
- [ ] Axle-type mapping from `modelFlags` (front/rear digits) into the typed handling row.
- [ ] `setWheel` reshaped to `{ camber, spin, steer, travel }`; rig computes + smooths both channels at the
      FIXED step; engine handle composes `steer(Z) ⊗ camber(Y) ⊗ spin(X)` and the local-Z offset.
      **The travel half landed early** (shaped `{ lift, spin, steer }`, smoothed in the rig at the fixed
      step, `lift = connection raise − live spring length`); camber joins with the axle rules above.
- [ ] Clamps + no-ops: authored travel, LOD bands, detached parts. Fake-handle tests pin every one.
- [ ] **Field round**: jumps (crest at varying speed), kerb mounts, cobbled/uneven streets ("do the
      wheels live?"), plus regression drive of everything since 02.

## Acceptance

- Crest jump: attitude correctable in air, landing absorbed without porpoising or nose-plant
  (replay envelope + field).
- Low-speed kerb mount smooth; high-speed kerb honest (replay).
- Wheels visibly work over uneven ground; no visual buzz (field).
- A solid-axle car leans its axle in a corner the way the reference screenshot does; an independent-axle car
  does not (the two must be distinguishable on screen, or the axle data is not reaching the render).

## Ledger

_(thresholds, torque clamps, capture numbers, field verdict)_

### 2026-07-27 — §2, the instrument: the kerb scene never met a kerb, and the real one stops a car dead

Before any assist: **the capture learned to say WHERE it was.** `TelemetryFrame.position` (copied, never
aliased — the same trap that once made every orientation-derived rate read 0) and `x`/`y`/`z` appended to the
series columns, at the END so `phys-compare` keeps comparing like with like. Everything below came out of
that one channel in an afternoon.

**`kerb-strike` is a prop-collision lap, not a kerb test.** The comet's lap ends against the traffic light at
(2221.8, 1203.3) losing 57 → 20 km/h; the infernus meets something at 100 g at (2170.5, 1225.3), in a plaza
of bollards, palms and ramps. Its own scene comment carried the doubt from the start ("UNCONFIRMED: whether
the angle below actually mounts the kerb") and the answer is no. The scene is KEPT, unchanged — the whole
record and the new regression pack are measured against it — but no kerb conclusion may be drawn from it.
**The flip that motivated this section does not reproduce at head**: comet `kerb-strike` peaks at 14.2° of
roll with no flip on any of the five cars (the 20.6° → 179° in `physics-world.ts` is now annotated as
scene-dependent, so nobody reads it as evidence the mechanism was fixed).

**The new `kerb-mount` scene drives SQUARE at a pavement edge**, off the power at ~25 km/h. Where it points
took three tries and each one is a datum: a drifted approach on the SF street drove into a traffic light; a
square approach there stopped every car dead (comet −62.1 g, admiral −61.3 g, infernus −68.0 g, **firetruk
−47.8 g**) but SF's pavement is FLUSH in collision and the blocker there is a building wall; so the scene now
stands on the LV plaza edge — a real pavement edge, proven by the `kerb-strike` comet climbing it (z +40 cm)
at 57 km/h. Square at that edge: **comet −61.0 g and firetruk −47.1 g, both stopped, ~5-7 cm of climb.**

So the mechanism is confirmed and its shape is worse than "snag or launch": at town speed a car **cannot get
onto a pavement at all**, while the same edge is climbable at 57 km/h and a shallow angle — momentum is the
only thing that gets a car over. A 10-tonne fire truck is stopped as flatly as a comet, which rules out ride
height and mass; what is left is the mechanism §2 named, the downward ray that cannot see a step face.

Baselines: `2026-07-27-headless-kerbmount-baseline-{comet,firetruk}.json` (the kerb) and
`2026-07-27-headless-kerbwall-sf-{comet,admiral,infernus,firetruk}.json` (the four-car wall reproduction).

**Not yet done, and the next step**: the probe + impulse ramp itself. Its shape is unchanged by any of the
above — a forward probe per wheel, a downward probe beyond the hit to measure the step, an assist only when
the step is ≤ the threshold and the speed is low, and an honest collision otherwise — and the same probe is
what will finally report the step HEIGHT this scene could not (a wall and a kerb both read as "stopped").
The high-speed half of the acceptance ("a kerb at 80 km/h SHOULD punish") still has no clean instrument.
