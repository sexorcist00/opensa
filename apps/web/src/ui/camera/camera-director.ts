/**
 * The camera director (plan 080/01): one pure step that turns a frame SNAPSHOT into the `CameraState` the
 * engine renders. The host stops mutating yaw/pitch/eye in its event handlers — it reports raw input, the
 * director owns the rig.
 *
 * Layer order, fixed (each later plan fills its layer):
 *
 *   look → zoom → mode rig (foot | vehicle | fly) → collision (plan 04) → additive motion (plan 06) → resolve
 *
 * Collision runs BEFORE additive motion so a bob can never push the eye through a wall.
 *
 * Everything here is frame-rate independent by construction: the step takes `dt` and any smoothing goes
 * through `@opensa/math`'s damp/spring helpers (plan 02 onward). With every smoothing channel zeroed the rig
 * still reduces to the pre-080 stick camera exactly, which `camera-director.test.ts` pins.
 */
import type { CameraState } from '@opensa/engine';
import type { CameraConfig } from '@opensa/game';

import { angleDelta, clamp, damp, smoothDampAngle, type SmoothDampRef } from '@opensa/math';

import { type AutoCenterState, cancelAutoCenter, createAutoCenter, stepAutoCenter, yawBehind } from './auto-center';
import {
  type CameraProbe,
  type CollisionState,
  createCollisionState,
  type GroundProbe,
  guardFloor,
  resolveCollision,
} from './camera-collision';
import { createLookInput, type LookInputState, releaseLook } from './camera-input';
import { createMotion, type MotionOffset, type MotionState, stepMotion } from './camera-motion';
import { CAMERA_FOV_Y, forwardFrom, resolveCamera, screenBasis } from './engine-camera';
import { dollyStep, FLY_SPEED, flyStep, panStep, TOP_DOWN_PITCH, topDownEye } from './fly-rig';
import { createFollowPoint, type FollowPointState, resetFollowPoint, stepFollowPoint } from './follow-rig';
import { createLookAhead, type LookAheadState, stepLookAhead } from './look-ahead';
import { driftHeading, vehicleDistanceForSpeed, vehicleFovTarget, vehicleTuning } from './vehicle-camera';

/** The rig's live state. A plain mutable record owned by the host and stepped in place — the same shape the
 *  character controller uses, so the frame loop allocates nothing per frame. */
export interface CameraRigState {
  /** Auto-centering: the idle clock and the turn-follow latch (plan 03). */
  autoCenter: AutoCenterState;
  /** Collision layer's damped shown-distance (plan 04). */
  collision: CollisionState;
  /** Follow distance, in world units — damps toward {@link distanceTarget}. */
  distance: number;
  /** Where the zoom is heading (the wheel and, later, the mode/collision layers all write this one target). */
  distanceTarget: number;
  /** The detached free-fly eye, or null when the rig is attached to a focus. */
  flyEye: [number, number, number] | null;
  /** The smoothed point the rig frames (plan 02) — not the focus itself. */
  follow: FollowPointState;
  /** The live vertical field of view (radians) — driving widens it with speed (plan 05), everything else
   *  eases it back to {@link CAMERA_FOV_Y}. Picking unprojects through this same value. */
  fov: number;
  /** The focus this rig framed last frame — the planar velocity every 03 channel reads is derived from it,
   *  so the director needs no velocity plumbing from the host and measures the FRAMED object (ped or car). */
  lastFocus: [number, number, number] | null;
  /** Unapplied pointer travel (plan 02's input damper). */
  look: LookInputState;
  /** The composition offset toward travel (plan 03). */
  lookAhead: LookAheadState;
  /** Bob / landing dip / shake / sprint-kick state (plan 06). */
  motion: MotionState;
  pitch: number;
  /** The smoothed planar focus velocity (units/s) look-ahead and auto-center read — see {@link focusVelocity}. */
  velX: number;
  velZ: number;
  yaw: number;
  /** A yaw something OTHER than the player asked for (vehicle entry today, auto-center in plan 03) — the rig
   *  swings toward it over `yawLagTime`. Null when the player owns the yaw, which any look input restores. */
  yawTarget: null | number;
  yawVelocity: SmoothDampRef;
}

/** Everything the director needs from the host this frame. Plain data, engine Y-up, assembled per frame. */
export interface CameraSnapshot {
  /** The player is off the ground — the bob damps out (a jump arc is already motion). Never true seated. */
  airborne: boolean;
  aspect: number;
  /** A running bench owns the frame outright (the BenchPlugin contract) — the rig still steps, its output is
   *  discarded. That is the invariant keeping camera work out of ritual/soak numbers. */
  bench: null | { eye: [number, number, number]; target: [number, number, number] };
  dt: number;
  /** The point the rig frames: the player, or the car they are seated in (engine space). */
  focus: readonly [number, number, number];
  /** Which way the framed object FACES (GTA heading radians) — `Locomotion.heading`, which is rate-limited
   *  and plant-aware, not an atan2 of the velocity (that jitters at low speed and flips on a strafe). */
  focusHeading: number;
  /** Peak vehicle contact force this frame (N), 0 when nothing was hit — the impact shake's trigger. Read
   *  off the damage system's own collision observation rather than a second listener. */
  impactForce: number;
  /** The vertical impact speed (units/s) of a landing that STARTED this frame, else 0 — plan 088's
   *  `Locomotion.fallSpeed` at the landing edge. */
  landingSpeed: number;
  /** Raw pointer deltas this frame, in pixels (sensitivity is the director's business, not the host's). */
  look: { x: number; y: number };
  mode: CameraMode;
  /** Fly only: left-drag pan delta in NDC since the last frame; null when nothing is being dragged. */
  pan: null | { x: number; y: number };
  /** A scripted enter/exit is mid-sequence: hold auto-center off (the steered swing to the target still
   *  plays) so the camera does not chase the ped's approach-run and climb twitches. */
  settling: boolean;
  /** The driven car's speed and slip this frame, or null on foot — the physics channel (plan 081/01's
   *  `planarMotion`) the speed curves and the drift lean read. Deriving it from the focus delta instead
   *  would measure the RENDER loop, and a slide has no signature there at all. */
  vehicle: null | { slipAngle: number; speed: number };
  /** The follow distance a seated car wants (its length × `vehicleDistanceScale`), or null on foot. The live
   *  distance eases to it, and collision caps it. */
  vehicleDistance: null | number;
  /** Fly only: the movement keys held this frame ({@link FLY_KEYS}). */
  walkKeys: ReadonlySet<string>;
  /** Wheel notches this frame: + away from the user (zoom out / dolly back), − toward it. */
  zoomSteps: number;
}

/** Who the rig is framing this frame. The bench is not a mode — it overrides the whole rig (see below).
 *  Reachable from outside as `CameraSnapshot['mode']`. */
type CameraMode = 'fly' | 'foot' | 'vehicle';

/** How fast the measured focus velocity tracks its instantaneous value (per second). ~0.05 s half-life —
 *  enough to average out the fixed-step saw, short enough that look-ahead still feels responsive. */
const VELOCITY_LAMBDA = 14;

export function createRigState(config: CameraConfig, yaw: number, pitch: number): CameraRigState {
  return {
    autoCenter: createAutoCenter(),
    collision: createCollisionState(config.followDistance),
    distance: config.followDistance,
    distanceTarget: config.followDistance,
    flyEye: null,
    follow: createFollowPoint(),
    fov: CAMERA_FOV_Y,
    lastFocus: null,
    look: createLookInput(),
    lookAhead: createLookAhead(),
    motion: createMotion(),
    pitch,
    velX: 0,
    velZ: 0,
    yaw,
    yawTarget: null,
    yawVelocity: { velocity: 0 },
  };
}

/** Re-seed the zoom from an authored distance the debugger changed (074/22). */
export function reseedDistance(state: CameraRigState, config: CameraConfig, authored: number): void {
  state.distanceTarget = clamp(authored, config.followZoomMin, config.followZoomMax);
  state.distance = state.distanceTarget;
}

/** Detach (or re-attach) the free-fly eye. Entering seeds it from the live camera, so the view never jumps. */
export function setFlyEye(state: CameraRigState, eye: [number, number, number] | null): void {
  state.flyEye = eye;
}

/** Enter the map viewer: straight over the focus, looking down (074/22 — activation must be visible). */
export function snapTopDown(state: CameraRigState, focus: readonly [number, number, number]): void {
  state.flyEye = topDownEye(focus);
  state.pitch = TOP_DOWN_PITCH;
}

/**
 * Aim the camera BEHIND a facing the player did not choose — vehicle entry lines it up behind the car, the
 * exit swings it behind the dismounting player. `facing` is a GTA heading; the rig sits at `yawBehind` of it.
 * The swing is damped, and any look input cancels it.
 */
export function steerYaw(state: CameraRigState, facing: number): void {
  state.yawTarget = yawBehind(facing);
}

/**
 * Step the rig one rendered frame and resolve the camera. `state` is mutated in place; the returned
 * `CameraState` is what the engine draws.
 */
export function stepCamera(
  state: CameraRigState,
  snapshot: CameraSnapshot,
  authored: CameraConfig,
  probe: CameraProbe | null = null,
  groundProbe: GroundProbe | null = null,
): CameraState {
  // ONE rig, two tuning tables (plan 05): driving substitutes its own lag/release numbers and every channel
  // below reads them without knowing which table it got. Nothing branches on the mode except the two writers
  // driving actually adds (the speed curves and the drift lean).
  const config = snapshot.mode === 'vehicle' ? vehicleTuning(authored) : authored;
  // The debugger moves the zoom BOUNDS live (074/22), so the live target is re-clamped every frame.
  state.distanceTarget = clamp(state.distanceTarget, config.followZoomMin, config.followZoomMax);
  applyLook(state, snapshot, config);
  steerYawChannel(state, config, snapshot.dt);
  const forward = forwardFrom(state.yaw, state.pitch);
  applyZoom(state, snapshot, config, forward);
  // In a car the distance follows the car's SIZE, opened up by its SPEED (#5); on foot it follows the wheel
  // zoom. Either way the live distance eases toward it — so a spun wheel, a fresh car and hard braking all
  // glide rather than step.
  const speed = snapshot.vehicle?.speed ?? 0;
  const distanceTarget =
    snapshot.vehicleDistance === null
      ? state.distanceTarget
      : vehicleDistanceForSpeed(snapshot.vehicleDistance, speed, config);
  state.distance = damp(state.distance, distanceTarget, config.zoomLambda, snapshot.dt);
  if (snapshot.mode === 'fly') {
    stepFlyRig(state, snapshot, forward);
    // A detached eye owns its own position; the follow point must not fly across the map when it re-attaches.
    resetFollowPoint(state.follow);
  }
  const [x, y, z] = snapshot.focus;
  const velocity = focusVelocity(state, snapshot, config);
  // Additive motion (plan 06): bob, the landing dip, impact shake and the sprint FOV kick. Stepped here so
  // it reads THIS frame's measured speed; its FOV contribution joins the target below and eases through the
  // same damp, while its OFFSETS are applied last of all — after collision, so a bob can never push the eye
  // through a wall.
  const motion = stepMotion(
    state.motion,
    {
      airborne: snapshot.airborne,
      dt: snapshot.dt,
      impact: snapshot.impactForce,
      landing: snapshot.landingSpeed,
      mode: snapshot.mode,
      speed: Math.hypot(velocity.x, velocity.z),
    },
    config,
  );
  // FOV is the other half of the speed sense (#5), plus 06's sprint kick. On foot the base target is the
  // base lens, so leaving a car eases the widening out through the same channel instead of cutting it.
  const fovTarget = (snapshot.mode === 'vehicle' ? vehicleFovTarget(speed, config) : CAMERA_FOV_Y) + motion.fov;
  state.fov = damp(state.fov, fovTarget, config.vehicleFovLambda, snapshot.dt);
  // Auto-center runs on foot AND in a car — the camera settles behind whatever the player is driving. Only
  // the LOOK-AHEAD lean stays on foot: a car's version is drift framing (it leans toward the SLIDE, not the
  // heading), which is plan 05's, tuned against a car's speeds. A scripted enter/exit suspends it: the
  // steered swing (set at the start of the sequence) glides to the target while the ped's twitches are
  // ignored.
  const centering = !snapshot.settling && (snapshot.mode === 'foot' || snapshot.mode === 'vehicle');
  if (centering) {
    // Drift framing (#10) is expressed as a HEADING, not as a second yaw writer: the camera settles behind
    // where the car is going rather than where its nose points, and every existing rule (the swing, the
    // settle epsilon, the manual override) applies to it unchanged.
    const heading = snapshot.vehicle
      ? driftHeading(snapshot.focusHeading, snapshot.vehicle.slipAngle, snapshot.vehicle.speed, config)
      : snapshot.focusHeading;
    const step = stepAutoCenter(
      state.autoCenter,
      state.yaw,
      heading,
      Math.hypot(velocity.x, velocity.z),
      config,
      snapshot.dt,
    );
    state.yaw = step.yaw;
    if (step.steerTo !== null) {
      state.yawTarget = step.steerTo;
    }
  } else {
    cancelAutoCenter(state.autoCenter);
  }
  const target = stepFollowPoint(
    state.follow,
    [x, y + config.followHeight, z],
    config,
    snapshot.dt,
    snapshot.mode !== 'fly',
  );
  const ahead =
    centering && snapshot.mode === 'foot'
      ? stepLookAhead(state.lookAhead, velocity.x, velocity.z, config, snapshot.dt)
      : stepLookAhead(state.lookAhead, 0, 0, config, snapshot.dt);
  const lookPoint: [number, number, number] = [target[0] + ahead.x, target[1], target[2] + ahead.z];
  // Collision (plan 04): cap the distance so the eye clears geometry between the look point and the eye —
  // on foot AND in a car (the camera slides along walls, never through them). The eye sits at
  // `lookPoint − forward · distance`, so the cast runs from the look point along `−forward`. A detached fly
  // eye flies through geometry by design, the bench is bypassed, and a scripted enter/exit skips the CAP (the
  // pull-in read as a jump — just centre behind); the floor guard below still runs then, so the camera never
  // sinks into the ground while getting in or out.
  const attached = !state.flyEye && !snapshot.bench;
  const collideDistance =
    attached && !snapshot.settling
      ? resolveCollision(
          state.collision,
          lookPoint,
          [-forward[0], -forward[1], -forward[2]],
          state.distance,
          config,
          probe,
          snapshot.dt,
        )
      : state.distance;

  const camera = resolveCamera({
    aspect: snapshot.aspect,
    bench: snapshot.bench,
    distance: collideDistance,
    flyEye: state.flyEye,
    forward,
    fovYRad: state.fov,
    // The offset moves eye AND target together (resolveCamera derives the eye from the target), so the
    // composition leans toward travel while the orbit geometry the collision layer defends is untouched.
    target: lookPoint,
  });

  // Floor guard runs whenever the rig is attached (incl. during a car enter/exit) so a steep down-pitch on a
  // slope/porch, or a low seat, can't bury the eye and show only skybox.
  const guarded = attached ? { ...camera, eye: guardFloor(camera.eye, groundProbe) } : camera;

  // The additive layer goes on LAST — after collision AND the floor guard, which is why it must stay bounded
  // (MOTION_CAP 0.15, inside the guard's 0.3 margin and well inside the collision sphere). A detached fly
  // eye and a running bench are never touched: one is dragged by hand, the other owns the frame outright.
  return attached ? applyMotion(guarded, motion, forward) : guarded;
}

/** Mouse look: raw pixel deltas → damped yaw/pitch, clamped per mode. Manual look always wins (036's rule). */
function applyLook(state: CameraRigState, snapshot: CameraSnapshot, config: CameraConfig): void {
  const look = releaseLook(state.look, snapshot.look.x, snapshot.look.y, config.inputSmoothTime, snapshot.dt);
  if (snapshot.look.x !== 0 || snapshot.look.y !== 0) {
    // The player took the camera back: the steered swing stops and the idle clock restarts.
    state.yawTarget = null;
    cancelAutoCenter(state.autoCenter);
  }
  state.yaw -= look.x * config.sensitivity;
  // The viewer may look straight DOWN (that is its resting view), so it gets the full range the screen basis
  // allows — not the gameplay camera's floor.
  const floor = snapshot.mode === 'fly' ? TOP_DOWN_PITCH : config.pitchMin;
  state.pitch = clamp(state.pitch - look.y * config.sensitivity, floor, config.pitchMax);
}

/**
 * Shift the resolved camera by the motion layer's offset (plan 06).
 *
 * Lateral rides the camera's own right vector (a bob has to sway across the view, not along a world axis);
 * vertical rides world up. Eye and look point take the SAME lateral and (bar the dip) the same vertical, so
 * the frame translates instead of the aim wandering.
 */
function applyMotion(
  camera: CameraState,
  motion: MotionOffset,
  forward: readonly [number, number, number],
): CameraState {
  if (motion.lateral === 0 && motion.vertical === 0 && motion.verticalTarget === 0) {
    return camera;
  }
  const { right } = screenBasis(forward);
  const dx = right[0] * motion.lateral;
  const dz = right[2] * motion.lateral;

  return {
    ...camera,
    eye: [camera.eye[0] + dx, camera.eye[1] + motion.vertical, camera.eye[2] + dz],
    target: [camera.target[0] + dx, camera.target[1] + motion.verticalTarget, camera.target[2] + dz],
  };
}

/** Wheel: dolly the free eye along the view, or move the follow zoom inside its config bounds. */
function applyZoom(
  state: CameraRigState,
  snapshot: CameraSnapshot,
  config: CameraConfig,
  forward: readonly [number, number, number],
): void {
  const notches = Math.trunc(snapshot.zoomSteps);
  if (notches === 0) {
    return;
  }
  const direction = Math.sign(notches);
  for (let step = 0; step < Math.abs(notches); step += 1) {
    if (state.flyEye) {
      state.flyEye = dollyStep(state.flyEye, forward, direction);
    } else if (config.followZoom) {
      // Wheel zoom is a config toggle (debug → Camera), like prod. It writes the TARGET; the live distance
      // damps toward it, so a spun wheel glides instead of stepping.
      state.distanceTarget = clamp(
        state.distanceTarget * (direction > 0 ? 1.08 : 0.93),
        config.followZoomMin,
        config.followZoomMax,
      );
    }
  }
}

/**
 * The framed object's planar velocity, in units/s — SMOOTHED, not the raw per-frame delta.
 *
 * The raw delta is a saw: physics moves the focus on a 1/60 step, but this runs every render frame, so at
 * 120 Hz every other frame sees zero movement. Feeding that saw to look-ahead makes the offset stutter
 * toward 0 and back. A short exponential smoothing recovers the true speed (the saw's average) without adding
 * meaningful lag — this is a MEASUREMENT filter, not a feel channel.
 */
function focusVelocity(
  state: CameraRigState,
  snapshot: CameraSnapshot,
  config: CameraConfig,
): { x: number; z: number } {
  const [x, , z] = snapshot.focus;
  const previous = state.lastFocus;
  state.lastFocus = [x, snapshot.focus[1], z];
  if (previous === null || snapshot.dt <= 0) {
    return { x: state.velX, z: state.velZ };
  }
  // A teleport (respawn, debugger warp, vehicle entry) is not a velocity — the same jump the follow point
  // snaps on must not read as a sprint to the auto-center and look-ahead channels.
  if (Math.hypot(x - previous[0], z - previous[2]) <= config.teleportSnapDistance) {
    const instantX = (x - previous[0]) / snapshot.dt;
    const instantZ = (z - previous[2]) / snapshot.dt;
    state.velX = damp(state.velX, instantX, VELOCITY_LAMBDA, snapshot.dt);
    state.velZ = damp(state.velZ, instantZ, VELOCITY_LAMBDA, snapshot.dt);
  }

  return { x: state.velX, z: state.velZ };
}

/** The steered-yaw channel: swing toward a yaw the player did not ask for, then hand the camera back. */
function steerYawChannel(state: CameraRigState, config: CameraConfig, dt: number): void {
  if (state.yawTarget === null) {
    state.yawVelocity.velocity = 0;

    return;
  }
  if (config.yawLagTime <= 0) {
    state.yaw = state.yawTarget;
    state.yawTarget = null;

    return;
  }
  state.yaw = smoothDampAngle(
    state.yaw,
    state.yawTarget,
    state.yawVelocity,
    config.yawLagTime,
    Number.POSITIVE_INFINITY,
    dt,
  );
  if (Math.abs(angleDelta(state.yaw, state.yawTarget)) < 1e-3) {
    state.yaw = state.yawTarget;
    state.yawTarget = null;
  }
}

/** Free-fly: arrow walk, then the drag pan (both in the eye's own screen plane). */
function stepFlyRig(state: CameraRigState, snapshot: CameraSnapshot, forward: readonly [number, number, number]): void {
  if (!state.flyEye) {
    return;
  }
  state.flyEye = flyStep(state.flyEye, snapshot.walkKeys, forward, state.yaw, FLY_SPEED * snapshot.dt);
  if (snapshot.pan) {
    // Pan by the eye's HEIGHT so the gesture covers the same apparent distance at any altitude.
    state.flyEye = panStep(state.flyEye, forward, [snapshot.pan.x, snapshot.pan.y], Math.max(1, state.flyEye[1]));
  }
}
