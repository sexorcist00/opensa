# 080/09 — Follow-policy revision: movement never turns the camera

**Planned 2026-07-27 from the user's field brief** (after the 081 physics rounds, in the user's own words):
on foot, MOVING the character must not change the camera — left/right strafe leaves it static, walking away
is followed, walking at the camera dollies it back until it meets geometry; running opens the distance a
little, idling closes it a little. Everything smooth — the deliberate cuts (seat entry) stay, but one
unexplained camera JUMP was seen once and must be found, not guessed at. In cars the behaviour stays,
with a stronger pull-back under acceleration; the lagged turn-follow is liked as is.

This revises decided behaviour from 02/03/04/05, so it is a sub-plan, not a tuning note. The 2026-07-27
slip survey (`docs/benchmarks/vehicle-physics/readme.md` § camera slip survey) is the measured ground under
it — the drift channel is alive again, wiring verified, no code owed there.

## 1. Directional yaw authority (the core rule)

Today two writers rotate the on-foot yaw from MOVEMENT: turn-follow (arms on heading rate — a sharp turn
swings the camera behind the new direction) and idle recenter (look idle + moving → eases behind heading).
Both fire on lateral movement, which is exactly what the brief bans. The backing-up fix (auto-center
suspended while travelling toward the camera, `dot < 0`) already handles one quadrant of the problem.

**Replace the boolean suspension with a continuous directional authority** multiplying BOTH writers:

```
authority = smoothstep(authStart, authFull, dot(headingDir, cameraForwardPlanar))
```

- walking AWAY (dot ≈ 1) → full authority: idle recenter still eases behind a forward run (the GTA V feel);
- strafing (dot ≈ 0) → no authority: the camera holds, the character runs across the frame;
- walking AT the camera (dot < 0) → no authority: subsumes the backing-up fix, one rule instead of two.

First guesses `authStart 0.2`, `authFull 0.9` (config + Camera tab). Consequences, intended:

- **Turn-follow on foot effectively retires.** Its trigger (a fast heading change) is precisely the case
  the brief bans — after the turn the player is moving laterally, authority ≈ 0, no swing. The latch code
  stays (the authority just multiplies its output), which also retires the last arm/disarm hitch class on
  foot — the vehicle path already went continuous for that reason.
- The mouse stays the only instant yaw writer on foot. Vehicle mode is UNTOUCHED (continuous chase is the
  liked behaviour).
- Walking at the camera already dollies it back today (the orbit maintains distance translationally) and
  the 04 layer compresses against a wall behind — §4 verifies that path end-to-end instead of assuming it.

**Look-ahead stays as is** (the accepted 03 behaviour): it pans the LOOK POINT toward travel without
orbiting the eye. On a strafe that reads as "frames where you are going", not as rotation; if the field
round disagrees, `lookAheadScale` is already a live slider — judged there, not pre-decided here.

## 2. On-foot distance: run opens, idle closes

One new writer on the existing zoom channel (the damp is already there — no new smoothing):

- `footRunDistanceGain` (+0.6 m first guess) × smoothstep(`walkSpeed` 2, `runSpeed` 7, speed) — a run
  visibly gives the character room; full at run, so a sprint adds nothing further (the sprint FOV kick
  already owns that register).
- After `footIdleDelaySec` (5 s first guess) of NO movement AND no look input, the distance target eases in
  by `footIdleDistanceEase` (−0.4 m first guess) through a deliberately slow lambda (~0.5/s) — a resting
  camera settles closer, any input returns it through the normal zoom damp, never a snap. Needs its own
  stillness clock: `AutoCenterState.idleFor` counts HANDS only (movement does not reset it, by design), so
  the idle-distance timer is a separate accumulator over movement + look.

## 3. Vehicle: acceleration opens the distance

The liked speed→distance curve stays. On top: `vehicleAccelDistanceGain` (+1.0 m at 0.6 g first guess) ×
the LOW-PASSED longitudinal acceleration, positive only (braking already glides the camera in through the
speed curve; a two-sided kick would pump on gear noise — the same disease the FOV dead-band exists for).
The smoothed accel signal derives from the speed channel the snapshot already carries; no new physics tap.
Turn lag: untouched (explicitly liked "с небольшим запаздыванием" — it is `vehicleYawLagTime` 0.35 s).

## 4. The seen-once jump: instrument first, then fix what it names

The brief reports ONE unexplained camera jump. The rule this project keeps re-learning (blobMs, `other`):
a stall you cannot name is found by an instrument, not by staring at code. Two steps, in order:

1. **Watchdog**: a dev-only continuity check in the director — per-frame eye delta > ~1.5 m or yaw delta
   > ~20° while NOT in a legitimate discontinuity (teleport seed, mode switch, scripted seat sequence,
   `settling`) logs one `[cam] jump` line with the full step state (mode, collision shown/allowed, focus
   delta, dt, authority). Zero cost when quiet; the user reproduces at leisure.
2. **The prime suspect, fixable regardless**: the 04 pull-in is INSTANT by design and the probe casts
   against the whole Rapier world — including MOVING bodies. A traffic car or ped crossing the
   focus→eye line yanks the camera in for a frame and releases it: reads exactly as "a jump under strange
   circumstances". Design: the instant snap stays for STATIC geometry (a wall must never be shown), but a
   hit on a DYNAMIC body takes the eased path (`resolveCollision(..., eased)` — the machinery exists, the
   probe must also report WHAT it hit). GTA does not cut its camera for a passing car either.

If the watchdog names something else instead, that finding wins over this guess — the suspect fix ships
only when the watchdog (or the user's repro) confirms the class.

## Subtasks

- [ ] Directional authority in `auto-center.ts` (§1) + config (`authStart`/`authFull`) + Camera-tab rows;
      the dot<0 suspension folds into it. Tests: strafe holds yaw; forward run still recenters; the
      toward-camera loop regression stays green; N-steps-vs-one frame-rate independence.
- [ ] On-foot distance writers (§2: run gain + idle ease) + the stillness clock + config + tab rows.
      Tests: walk↔run continuity through the zoom damp; idle ease-in and instant-input return; caps.
- [ ] Vehicle accel pull (§3): low-passed positive gLong × gain onto the distance target + config + tab.
      Tests: gear-noise robustness (a throttle blip must not pump), brake path unchanged.
- [ ] The `[cam] jump` watchdog (§4.1) behind the existing perf-logs flag; every legitimate discontinuity
      flagged at its source so the log is quiet on a healthy session.
- [ ] Dynamic-vs-static collision response (§4.2): probe reports body type; dynamic hits ease, static
      snap. Tests: scripted dynamic crosser eases; wall still snaps same-frame.
- [ ] Field round: strafe/run/idle on foot, walk-at-camera into a wall, launches in a car, and a repro
      attempt on the jump with the watchdog live. Freeze the new numbers in this ledger.

## Acceptance

- On foot: no camera yaw from any movement direction except easing behind a walk AWAY; run/idle distance
  reads as breathing, not as zoom; walking at the camera backs it to the wall and compresses, smoothly.
- In a car: launches stretch the framing, gear noise does not; the liked turn lag is untouched.
- The watchdog is silent through a normal session; the seen-once jump either reproduces and is named, or
  the dynamic-body ease removes the only credible cause.
- Every new number lives in `CameraConfig` + the Camera tab (plan 08's preset rule).
