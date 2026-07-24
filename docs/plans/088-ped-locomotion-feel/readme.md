# 088 — Ped locomotion feel (turning, acceleration tiers, jump, animation states)

**Status: PLANNED 2026-07-24.** No code yet.

**Goal: on-foot movement feels like a modern AAA third-person game** — the character turns through an
arc instead of snapping to a new direction, speed ramps through distinct walk/run/sprint tiers, the
jump has anticipation → airborne → landing (with the matching animations and a recovery beat), clip
changes crossfade instead of popping, and the feet stop sliding because the cycle speed matches the
ground speed. The user's complaints (2026-07-24): direction changes are instant, the jump has no feel
and no animation, there is no sense of acceleration.

## What the engine actually is now (studied 2026-07-24, all facts verified in code)

**Movement is already accelerated — the missing pieces are facing, tiers, and every animation state.**

- **Kinematic capsule + Rapier character controller** (`packages/game/src/physics/physics-world.ts`):
  `RigidBodyDesc.kinematicPositionBased()` Z-up capsule; controller with slide, autostep 0.4/0.1,
  snap-to-ground 0.4, slopes 50°/45° (`createCharacterController` :143, `createKinematicCapsule` :281).
  The controller integrates its own velocity and hands Rapier the per-step delta.
- **Horizontal speed is accelerated, not set** (`character-controller.system.ts:94-111`): `approach()`
  moves planar velocity toward the input target by `accel|deceleration × airControl × step` — ramp-up,
  turn momentum and air momentum already exist. Config (`game-runtime-config.ts:112`):
  `{ accel: 20, airControl: 0.3, deceleration: 25, jumpSpeed: 3.5, runSpeed: 7, walkSpeed: 2 }`
  (`MovementConfig`, `config.interface.ts:236-250` — no turn rate, no sprint, no jump timing fields).
- **Facing is derived, instant, and lives in the host**: `posePlayer` (`engine-canvas-host.tsx:1023-1048`)
  sets `heading = atan2(-vx, vy)` of the CURRENT velocity whenever `speed > 0.3`, else holds. No turn
  rate anywhere; a strafe-reverse flips the model as fast as `approach()` swings the velocity through
  zero (~0.3 s of unreadable spin at accel 20). The renderer receives only a yaw (palette slot 0,
  `engine-player.ts:192-199`).
- **Jump is one line, no states** (`character-controller.system.ts:101`):
  `vz = grounded ? (jump ? movement.jumpSpeed : 0) : vz` then gravity. At `jumpSpeed 3.5` the apex is
  `3.5²/(2·9.81) ≈ 0.62 m`, air time ≈ 0.71 s. No launch anticipation, no landing state, no coyote
  time, no jump buffer; landing just zeroes `vz`. Air control exists (`airControl 0.3`).
- **Animation = 3 clips, hard switches, fixed rate** (`engine-player.ts`): `PLAYER_CLIPS =
  ['idle_stance', 'walk_civi', 'run_civi']`; the inline state machine picks by speed
  (`> 4` run, `> 0.3` walk — the 0.3 duplicated in the host's heading gate) and on change does
  `clipTime = 0` — "v1: hard switch — the crossfade is the plan-08 sampler follow-up". `clipTime += dt`
  with no rate scaling → feet slide at every speed the cycle wasn't authored for. Scripted (vehicle)
  clips override locomotion via `setScripted`; the `buildClipIndex` duration>0 gate keeps absent clips
  from sampling to the flat bind pose.
- **`IfpSampler` samples ONE clip** (`packages/engine/src/anim/ifp-sampler.ts:46-71`): per-bone quat
  slerp within the clip, then compose × parent × inverseBind straight into the palette. The last
  `sample()` arg is `outSlot`, not a weight — there is no two-clip path. A crossfade must blend the
  per-bone LOCAL quats (slerp between the two clips' sampled quats) before compose; blending final
  palette matrices would shear.
- **The clips this plan needs all EXIST in the original `ped.ifp`** (probed 2026-07-24 with `parseIfp`
  over `game-src/original/anim/ped.ifp`, 294 clips): `sprint_civi` (32 bone tracks, like
  walk/run/idle), `JUMP_launch`, `JUMP_launch_R`, `JUMP_glide`, `JUMP_land`, `FALL_fall`, `FALL_glide`,
  `FALL_land`, `FALL_collapse`, `FALL_skyDive` (26 tracks — the untracked fingers/spine extras hold
  bind rotation, which the sampler already does per-bone), plus the polish tier: `WALK_start`,
  `Run_stop`/`Run_stopR`, `Turn_L`/`Turn_R`, `turn_180`.
- **Fly mode fakes `grounded = 1`** specifically so no fall state triggers (`placeFlying`) — every new
  airborne state must stay out of fly mode's way. `setEnabled(false)` (seated in a car) zeroes velocity
  and skips the controller; the scripted-clip path keeps overriding locomotion unconditionally.

## Architecture decisions (made here, not re-litigated per phase)

1. **Stay kinematic.** Everything requested is expressible in the existing controller: heading is a new
   scalar state, jump states are a small FSM around the existing `vz` line, tiers are target-speed
   selection. No dynamic body, no Rapier changes.
2. **Physics states live in the game package; animation follows.** Coyote time, jump buffering, launch
   delay and landing lockout GATE VELOCITY, so they belong to `CharacterControllerSystem` (real-Rapier
   tested, deterministic fixed step). The controller publishes a locomotion state through a new ECS
   component (`Locomotion`: state enum + seconds-in-state + fall speed at impact); the host's
   `posePlayer` forwards it into `EnginePlayer.update`, and the clip choice becomes a pure function of
   that state + speed. The two state machines never diverge because only one of them decides.
3. **Heading becomes owned state with a turn rate, steered by INTENT.** The controller keeps a
   `heading` per player, turned toward the DESIRED move direction (the input target, not the velocity)
   at `turnRateDeg`/s — facing anticipates like modern games, velocity follows through `approach()`,
   and the two together produce the arc. `posePlayer`'s `atan2` remains only as the fallback for
   scripted `runPath` compatibility until the component lands.
4. **Every new clip degrades like the vehicle clips do.** Resolution reuses the `buildClipIndex`
   duration>0 gate: a TC shipping a `ped.ifp` without `JUMP_glide` gets today's v1 behaviour for that
   state (speed-picked locomotion clip, no crossfade), never a bind pose, never a freeze. The FSM runs
   regardless — only the visual falls back.
5. **All tuning lands in `MovementConfig` (+ the anim timing beside the clips)** and stays
   live-patchable for in-session A/B (the 081 rule: feel is field-judged; defaults freeze only on user
   verdict).

## Phases (each individually shippable, numbers recorded per phase)

### 01 — Heading model + turn rate (CLOSED 2026-07-24 — field-verified same day)

- `Locomotion` ECS component (state, stateTime, heading, fallSpeed) + controller-owned heading:
  shortest-arc approach toward the intent direction at `turnRateDeg`/s, **speed-scheduled** — near-idle
  turns fast (snappy repositioning, ~720°/s), sprint turns slow (~240°/s → wide arcs). Two config
  fields (`turnRateIdleDeg`, `turnRateFullDeg`), lerped by `speed/maxTier`.
- Reversal rule: intent >120° away while above walk speed keeps decelerating on the OLD heading until
  speed drops under the walk threshold, then turns — that reads as a plant, not a spin. (The `turn_180`
  clip upgrade is phase 05.)
- Host: `posePlayer` reads `Locomotion.heading` instead of `atan2`; the duplicated `0.3` thresholds
  unify into one shared const.
- Tests: pure heading-approach function (wrap-around, shortest arc, rate clamp — negative cases first);
  controller test: intent reversal decelerates before the heading flips.
- Verify in field: figure-eight run arcs visibly; strafe-reverse plants and turns. Record: chosen
  turn rates, deg/s at walk/run/sprint.

**Field verdict (2026-07-24, user):** looks good as shipped — defaults FROZEN at
`turnRateIdleDeg 720` / `turnRateFullDeg 240` / plant at 120°.

**Ledger (2026-07-24, code-complete):** shipped as `packages/game/src/character/locomotion.ts` (pure
math: `angleDelta` / `approachAngle` / `scheduledTurnRate` / `yawFromPlanar` + the shared
`IDLE_SPEED_THRESHOLD = 0.3` and `REVERSAL_ANGLE = 120°`), the `Locomotion` ECS component
(heading-only for now — state/stateTime/fallSpeed land with their phase-04 writers), and the
controller's `moveOnFoot` step. Defaults (field round pending): `turnRateIdleDeg 720`,
`turnRateFullDeg 240`, lerped by `speed / runSpeed`. Plant semantics as designed: intent >120° away
→ velocity target becomes REST at `deceleration` (25 → a 7 m/s run stops in ~0.28 s), heading holds
until speed ≤ 0.3, then the about-face runs at the near-idle rate (~180° in ~0.25 s + a ~5-step
pivot before re-acceleration). One deliberate behaviour change surfaced by the existing suite: a
scripted `runPath` waypoint 180° behind now pivots ~5 fixed steps before the walk starts (test
updated to walk 15 steps). While riding, `posePlayer` writes the car yaw back into
`Locomotion.heading`, so dismounting turns FROM the car's heading instead of a stale walk yaw; debug
fly mode keeps its instant heading (no plant, no rate). Tests: +17 new (10 pure-math, 7 controller
heading incl. plant/pivot/fly), full game+web suite 528 green; lint (cognitive-complexity forced the
`moveOnFoot` extraction) + tsc clean. The duplicated `0.3` idle threshold in `engine-player.ts` and
the host heading gate now both come from `IDLE_SPEED_THRESHOLD`.

### 02 — Crossfade + phase-synced blending (CODE-COMPLETE 2026-07-24 — awaiting the field round)

- `IfpSampler.sampleBlended(from, fromTime, to, toTime, alpha, out, outSlot)`: per-bone slerp of the
  two clips' LOCAL quats (and lerp of positions where tracks exist) before compose — one extra
  `sampleQuat` per bone, zero allocations, same palette contract.
- `engine-player.ts`: clip switches start a fade (default 0.2 s, per-transition overridable — landing
  wants ~0.12 s) instead of `clipTime = 0`. Walk↔run↔sprint fades carry NORMALIZED PHASE
  (`toTime = phase × toDuration`) so legs stay in step; idle/airborne transitions start at 0.
- Tests: sampler — blend at α=0/1 equals single-clip sample bit-exact, α=0.5 is a valid unit quat path
  (extend `ifp-sampler.test.ts`'s `zAngleDegrees` idiom); state machine — a mid-fade re-switch retargets
  without popping (fade-from becomes the current blended source clip at its current time).
- Verify: idle↔walk↔run pops gone in field. Record: fade times table, sampler cost per frame
  (µs, single vs blended — budget: invisible next to the 2 ms pass floor).

**Ledger (2026-07-24, code-complete):** the promised 074/08 follow-up paid. Sampler
(`ifp-sampler.ts`): shared per-bone `evaluateBone`/`writeBone`, `sampleBlended` (LOCAL quat slerp +
position lerp BEFORE compose; α≤0/α≥1 early-out to the bit-exact single path), plus a hold-pose pair
— every sample records its locals, `holdPose()` freezes them, `sampleFromHold` fades out of the
frozen pose. The hold is how an INTERRUPTED fade retargets pop-free (idle→walk→run inside one 0.2 s
window is the common case: at accel 20 the walk→run threshold arrives ~0.19 s after idle→walk); the
frozen-source fade is the standard cheap inertialization fallback. New pure `LocomotionMixer`
(`apps/web/src/ui/locomotion-mixer.ts`): fade bookkeeping, walk↔run normalized-phase carry
(`toTime = phase × toDuration`, zero-duration gaits never carry), `captureHold` fires exactly once
per interruption, and `restartFromHold` — a scripted-clip handback (car exit) now FADES into
locomotion instead of popping (a small scope add beyond the phase text; the climb-out pose blends
into stance over the same 0.2 s). Numbers: fade default **0.2 s linear** (landing override still
phase 04); sampler cost measured 32-bone/20-key clip × 20k iters: **single 6.0 µs, blended 8.2 µs
(1.37×)** — invisible next to the ~2 ms pass floor. Tests: +16 new (7 sampler blend/hold incl. two
bit-exact equality gates, 9 mixer incl. interruption + handback); engine+web+game suites 767 green;
lint + tsc clean. Alpha curve is linear v1 — smoothstep is a one-line tuning lever if the field
round wants softer ends.

### 03 — Speed tiers + cycle-speed sync (CODE-COMPLETE 2026-07-24 — awaiting the field round)

- New `sprint` action (held; keyboard binding beside `run`) → `sprintSpeed` config; tier targets
  walk 2 / run 7 / sprint ~10 (field-tuned). `sprint_civi` joins `PLAYER_CLIPS`.
- Clip choice by speed with HYSTERESIS (switch up at threshold, down at threshold − ~0.5 m/s) so the
  boundary never flickers; thresholds derive from the tier speeds instead of the hardcoded 4.
- Playback-rate sync: each locomotion clip gets a reference ground speed (measured in the field harness
  by timing strides at fixed velocity — recorded, not guessed); `clipTime += dt × clamp(speed/ref,
  0.7, 1.4)`. Fades blend the RATE too.
- Tests: hysteresis (no oscillation for a speed sequence straddling the boundary), rate clamp.
- Verify in field at walk/run/sprint and mid-fade. Record: reference speeds per clip, hysteresis gap,
  clamp bounds, tier speeds after tuning.

**Ledger (2026-07-24, code-complete):** tiers walk 2 / run 7 / **sprint 10** (`sprintSpeed` in
`MovementConfig`), `sprint_civi` joined `PLAYER_CLIPS` (phase-carried with walk/run). **One design
decision beyond the phase text: RUN is now the DEFAULT gait** — SA jogs when nothing is held; Shift
= sprint, `walk` is an optional modifier binding (unbound in prod) and the analog partial
touch-stick deflection (`TouchInputSource` reports `walk` under the 0.85 run threshold). The old
walk-2-default + Shift-run scheme would have kept the game feeling slow with the tiers in place; the
legacy `run` action stays for the touch harness/e2e. Gait pick: new pure `GaitSelector`
(`apps/web/src/ui/gait-selector.ts`) with up-thresholds at the tier midpoints (idle 0.3 / 4.5 / 8.5
prod) and **hysteresis 0.5** down (idle boundary capped at half its threshold → 0.15). Cycle-speed
sync: `LocomotionMixer` scales each clip clock by `rateOf(clip, speed)`; refs = the tier speeds
(rate = 1 exactly at each tier's target), clamp **[0.7, 1.4]**; the alpha clock stays wall-time.
Degradation gate: `resolveGaitClip` — a TC without `sprint_civi` keeps the RUN cycle at sprint speed
(tested, the rule-3 invariant). `loadEnginePlayer` now takes the tier speeds (`GaitTiers`); the top
turn-rate tier moved runSpeed → sprintSpeed. Tests: +17 new (6 gait selector, 1 mixer rate, 4
resolveGaitClip, 3 touch walk/sprint, 2 keyboard, walk/sprint tier controller pair) and the fast-gait
suite exposed a test-world flaw (the 10 × 10 ground box let 26–39 u/s runs fall off the edge
mid-ramp → widened to 500 × 500). Full engine+web+game: **784 green**; lint + tsc clean. Reference
speeds are the tier speeds v1 — the field round may re-time them per clip (the stride-timing knob is
`referenceSpeeds` in `engine-player.ts`).

### 04 — Jump + fall state machine (the feature the user actually asked for)

Controller FSM (fixed-step, in `CharacterControllerSystem`), states published via `Locomotion`:

- `LAUNCH`: jump pressed while grounded (or within COYOTE after walking off an edge, default 0.12 s).
  Plays `JUMP_launch`; `vz = jumpSpeed` applies after `launchDelay` (default ~0.1 s — the clip's crouch
  frames become real anticipation). Horizontal momentum carries (already true).
- `AIRBORNE`: `JUMP_glide` while rising/short falls. A fall NOT from a jump (airborne > coyote window
  without a press) enters here too, via `FALL_glide` when the clip exists.
- `LAND`: on `grounded`, `JUMP_land` with a control lockout (`landRecoveryMs`, default ~0.15 s at
  reduced accel — a beat, not a stun). Impact `|vz| > hardLandSpeed` → `FALL_collapse` + longer
  recovery (hard-land tier; threshold field-tuned, start ~12 m/s).
- JUMP BUFFER: a press within `bufferMs` (~0.15 s) before touchdown fires the jump on the landing
  frame — with launch delay and land recovery in play, buffering is what keeps chained jumps feeling
  responsive rather than mushy.
- Guards: fly mode never enters the FSM (its faked `grounded` already opts out); `setScripted` (vehicle
  enter/exit) overrides any state visually; absent clips degrade per decision 4 (FSM still runs — jump
  physics works on every TC).
- Tests (real Rapier, negative-first): no double jump mid-air; no jump during land lockout; coyote
  window honoured then expired; buffer fires exactly once; launch delay applies vz on the right step;
  hard-land threshold picks the collapse tier; fall-off-ledge enters AIRBORNE without a press.
- Verify in field: jump reads as crouch→launch→glide→land; ledge walks trigger the fall pose; landing
  from a rooftop staggers. Record: every timing constant after tuning, apex height/air time
  before vs after.

### 05 — Transition polish (QUEUED — only if 01–04 leave visible gaps)

`WALK_start` (idle→walk kick), `Run_stop`/`Run_stopR` (run→idle plant, foot-phase-picked),
`turn_180` (the phase-01 plant upgraded to the authored pivot), `Turn_L`/`Turn_R` (stationary camera
turns). Each is one FSM edge + one clip through the same gate; none blocks the chain. Decide from the
phase-04 field round.

### 06 — Close-out: defaults freeze + docs

Field-judged defaults frozen on user verdict; `docs/features/character.md` rewritten for the FSM (also
fixing the stale `CharacterAnimationSystem` wording — the machine is inline in `engine-player.ts`
today and moves into the pure module this plan extracts); `MovementConfig` fields documented;
measured-numbers ledger completed per phase (standing rule). New limitation rows (e.g. "IFP root
translation still unused — launch height is physics-only") go to `docs/edge-cases/`.

## Ground rules

1. **Determinism**: all FSM timing counts fixed steps, never wall clock; tests drive the real Rapier
   world exactly like `character-controller.system.test.ts` does today.
2. **Renderer untouched**: the only render-side change in the whole chain is `sampleBlended` writing
   the same palette. Position/heading keep flowing through the existing `update()` surface.
3. **Clip-absent degradation is a tested invariant**, not a hope: every phase that adds a clip adds the
   "clip missing → v1 behaviour" test beside it (the `buildClipIndex` pattern).
4. **No blind tuning**: every constant that ships has a field verdict and lands in the ledger with its
   before/after (the 084 method — modloader-overlay field tests transfer directly).
5. **Scripted clips keep absolute priority** (vehicle enter/exit contract from `a16930e` is
   load-bearing); the FSM must be provably inert while `scripted` is set.

## Cross-links

- **Plan 074/08** promised the crossfade ("plan-08 sampler follow-up" comments in `engine-player.ts` /
  `ifp-sampler.ts`) — phase 02 pays that debt.
- **Plan 080 (cinematic camera)** consumes heading + speed; the phase-01 heading model gives it a
  stable, rate-limited signal instead of raw `atan2` jitter.
- **Plan 084** — the field-test method (modloader overlay, symptom→bytes) and the dynamic-lighting
  work this ped path already shares.
- **`docs/features/character.md`** — the current-state doc this plan supersedes in part (phase 06).
- SA reference: the original game's own feel (walk/run/sprint tiers, launch/glide/land jump) is the
  baseline; the AAA upgrades on top are the turn-rate arcs, crossfades, cycle-speed sync, coyote/buffer
  timing and landing recovery.
