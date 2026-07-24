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
 * through `@opensa/math`'s damp/spring helpers (plan 02 onward). This plan ships the seams only — the rig
 * reproduces the pre-080 stick camera exactly, which `camera-director.test.ts` pins.
 */
import type { CameraState } from '@opensa/engine';
import type { CameraConfig } from '@opensa/game';

import { angleDelta, clamp, damp, smoothDampAngle, type SmoothDampRef } from '@opensa/math';

import { type AutoCenterState, cancelAutoCenter, createAutoCenter, stepAutoCenter, yawBehind } from './auto-center';
import { createLookInput, type LookInputState, releaseLook } from './camera-input';
import { CAMERA_FOV_Y, forwardFrom, resolveCamera } from './engine-camera';
import { dollyStep, FLY_SPEED, flyStep, panStep, TOP_DOWN_PITCH, topDownEye } from './fly-rig';
import { createFollowPoint, type FollowPointState, resetFollowPoint, stepFollowPoint } from './follow-rig';
import { createLookAhead, type LookAheadState, stepLookAhead } from './look-ahead';

/** The rig's live state. A plain mutable record owned by the host and stepped in place — the same shape the
 *  character controller uses, so the frame loop allocates nothing per frame. */
export interface CameraRigState {
  /** Auto-centering: the idle clock and the turn-follow latch (plan 03). */
  autoCenter: AutoCenterState;
  /** Follow distance, in world units — damps toward {@link distanceTarget}. */
  distance: number;
  /** Where the zoom is heading (the wheel and, later, the mode/collision layers all write this one target). */
  distanceTarget: number;
  /** The detached free-fly eye, or null when the rig is attached to a focus. */
  flyEye: [number, number, number] | null;
  /** The smoothed point the rig frames (plan 02) — not the focus itself. */
  follow: FollowPointState;
  /** The focus this rig framed last frame — the planar velocity every 03 channel reads is derived from it,
   *  so the director needs no velocity plumbing from the host and measures the FRAMED object (ped or car). */
  lastFocus: [number, number, number] | null;
  /** `?cam=legacy`: run the pre-080 rigid stick instead of the smoothed rig. The A/B a field round compares
   *  one keypress apart, and the escape hatch if a round is rejected. */
  legacy: boolean;
  /** Unapplied pointer travel (plan 02's input damper). */
  look: LookInputState;
  /** The composition offset toward travel (plan 03). */
  lookAhead: LookAheadState;
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
  /** Raw pointer deltas this frame, in pixels (sensitivity is the director's business, not the host's). */
  look: { x: number; y: number };
  mode: CameraMode;
  /** Fly only: left-drag pan delta in NDC since the last frame; null when nothing is being dragged. */
  pan: null | { x: number; y: number };
  /** A scripted enter/exit is mid-sequence: hold auto-center off (the steered swing to the target still
   *  plays) so the camera does not chase the ped's approach-run and climb twitches. */
  settling: boolean;
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

export function createRigState(config: CameraConfig, yaw: number, pitch: number, legacy = false): CameraRigState {
  return {
    autoCenter: createAutoCenter(),
    distance: config.followDistance,
    distanceTarget: config.followDistance,
    flyEye: null,
    follow: createFollowPoint(),
    lastFocus: null,
    legacy,
    look: createLookInput(),
    lookAhead: createLookAhead(),
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
export function stepCamera(state: CameraRigState, snapshot: CameraSnapshot, config: CameraConfig): CameraState {
  // The debugger moves the zoom BOUNDS live (074/22), so the live target is re-clamped every frame.
  state.distanceTarget = clamp(state.distanceTarget, config.followZoomMin, config.followZoomMax);
  applyLook(state, snapshot, config);
  steerYawChannel(state, config, snapshot.dt);
  const forward = forwardFrom(state.yaw, state.pitch);
  applyZoom(state, snapshot, config, forward);
  state.distance = state.legacy
    ? state.distanceTarget
    : damp(state.distance, state.distanceTarget, config.zoomLambda, snapshot.dt);
  if (snapshot.mode === 'fly') {
    stepFlyRig(state, snapshot, forward);
    // A detached eye owns its own position; the follow point must not fly across the map when it re-attaches.
    resetFollowPoint(state.follow);
  }
  const [x, y, z] = snapshot.focus;
  const velocity = focusVelocity(state, snapshot, config);
  // Auto-center runs on foot AND in a car — the camera settles behind whatever the player is driving. Only
  // the LOOK-AHEAD lean stays on foot: a car's version is drift framing (it leans toward the SLIDE, not the
  // heading), which is plan 05's, tuned against a car's speeds. A scripted enter/exit suspends it: the
  // steered swing (set at the start of the sequence) glides to the target while the ped's twitches are
  // ignored.
  const centering = !state.legacy && !snapshot.settling && (snapshot.mode === 'foot' || snapshot.mode === 'vehicle');
  if (centering) {
    const step = stepAutoCenter(
      state.autoCenter,
      state.yaw,
      snapshot.focusHeading,
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
    !state.legacy && snapshot.mode !== 'fly',
  );
  const ahead =
    centering && snapshot.mode === 'foot'
      ? stepLookAhead(state.lookAhead, velocity.x, velocity.z, config, snapshot.dt)
      : stepLookAhead(state.lookAhead, 0, 0, config, snapshot.dt);

  return resolveCamera({
    aspect: snapshot.aspect,
    bench: snapshot.bench,
    distance: state.distance,
    flyEye: state.flyEye,
    forward,
    fovYRad: CAMERA_FOV_Y,
    // The offset moves eye AND target together (resolveCamera derives the eye from the target), so the
    // composition leans toward travel while the orbit geometry plan 04 defends is untouched.
    target: [target[0] + ahead.x, target[1], target[2] + ahead.z],
  });
}

/** Mouse look: raw pixel deltas → damped yaw/pitch, clamped per mode. Manual look always wins (036's rule). */
function applyLook(state: CameraRigState, snapshot: CameraSnapshot, config: CameraConfig): void {
  const smoothTime = state.legacy ? 0 : config.inputSmoothTime;
  const look = releaseLook(state.look, snapshot.look.x, snapshot.look.y, smoothTime, snapshot.dt);
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
  if (state.legacy || config.yawLagTime <= 0) {
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
