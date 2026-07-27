# 080/10 — AAA polish: five small writers that make it feel expensive

**Planned 2026-07-27, per the user's open brief** ("improve at your discretion, AAA-like"). Five candidates,
each an ADDITIVE, config-scaled writer on channels that already exist — no new layers, no new code paths,
`reducedMotion` zeroes every one (the 06 contract). Ordered by expected feel-per-line; each ships
individually behind its own field verdict, and any of them dies cheaply if the round says so.

Ships AFTER 09 — the follow-policy revision changes what "neutral" feels like, and judging garnish on a
moving baseline is how tuning rounds get burned (the 081/08 multi-variable lesson).

## 1. Corner peek (vehicles) — look INTO the turn

The drift lean (05) is REACTIVE — it follows slip that has already happened. The AAA ingredient is the
ANTICIPATORY one: the look point yaws into the corner from the STEER input itself, before the car rotates.

- `peekYaw = vehiclePeekScale × steerSmoothed × smoothstep(peekMinSpeed, peekFullSpeed, |speed|)`
- First guesses: `vehiclePeekScale` 0.10 rad (~6°), speeds 5 → 20 u/s. Low-passed steer (the input squares
  through SA's own curve already) so a slalom does not whip the frame.
- Composes with the drift lean: peek is where you are GOING to go, lean is where you ARE sliding — in a
  held drift both point the same way and the sum is capped by the shared look-offset clamp.

## 2. Speed pose (vehicles) — the camera gets low and long

At speed GTA V drops the camera toward the roofline and lifts the look point, flattening the composition.
One curve on channels the rig already owns:

- polar target −`vehicleSpeedPitchDrop` (first guess 0.06 rad) and look-point height +`vehicleSpeedLookRise`
  (first guess 0.25 m), both × the SAME smoothstep the FOV kick uses (6 → 28 u/s) — one speed authority,
  three outputs, so they cannot disagree about what "fast" means.
- Reads as: standing still you look DOWN at the car; at speed you look ALONG the road. Pairs with the 09
  acceleration pull.

## 3. Fall stretch (on foot) — long falls read as long

Airborne with fall speed past `fallStretchMinSpeed` (first guess 8 u/s): FOV target +`fallFovStretch`
(~0.05 rad) and distance +`fallDistanceStretch` (~0.5 m), both easing in over ~0.5 s of falling and
recovering through the existing damps on landing — which then hands off to the HARD_LAND shake (06) that
already fires. A rooftop drop stops feeling like an elevator. The landing dip stays off (its defeat was
the viewpoint, 06 round 4); this is the effect that DOES read at a third-person orbit because it changes
the lens, not a 20 cm eye offset.

## 4. Directional impact kick (the shake gets a direction)

The 06 shake is isotropic noise — a right-side hit shakes the same as a head-on. Seed the shake's FIRST
offset opposite the impact direction (the damage system's contact already knows it), then decay into the
existing noise. One line of feel: the camera recoils AWAY from the hit, which is what sells causality.
No new config — it rides `shakeScale`.

## 5. High-speed wind shake (vehicles) — the top end hums

Above ~0.75 × the FOV curve's full speed, a very small continuous noise (amplitude ramping to
`windShakeScale`, first guess 0.02 m — an order under the impact shake) on the existing noise generator.
The register that tells you "this is fast" with the eyes only. The first candidate to DIE in the field
round if it reads as jitter — it is last for a reason.

## Subtasks

- [ ] §1 corner peek: smoothed-steer writer + clamp share with drift lean + config/tab. Tests: slalom
      does not whip; peek+lean sum capped; zero-scale reduces to today.
- [ ] §2 speed pose: one speed authority feeding pitch/look-rise/FOV; config/tab. Tests: authorities agree;
      standing framing unchanged.
- [ ] §3 fall stretch: airborne writer + recovery handoff to HARD_LAND; config/tab. Tests: short hops do
      not trigger; recovery is monotonic; reducedMotion zeroes.
- [ ] §4 directional kick: seed from impact direction; test pins first-sample direction and unchanged decay.
- [ ] §5 wind shake: speed-ramped amplitude; test pins the ramp and the cap.
- [ ] Field round per feature (they are individually deniable on the tab); freeze or kill each in this
      ledger. Comfort verdict asked explicitly (the 06 rule).

## Acceptance

- Each feature is invisible at scale 0 and individually deniable; the sum of all additive offsets stays
  inside the 06 cap (0.25 m) and the collision margin.
- No feature moves a bench number (the bench camera bypass is the standing invariant).
- The field round keeps what reads as weight/anticipation and kills what reads as noise — a dead feature
  is recorded here with its verdict, not deleted silently.
