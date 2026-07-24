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

import { createLookInput, type LookInputState, releaseLook } from './camera-input';
import { CAMERA_FOV_Y, forwardFrom, resolveCamera } from './engine-camera';
import { dollyStep, FLY_SPEED, flyStep, panStep, TOP_DOWN_PITCH, topDownEye } from './fly-rig';
import { createFollowPoint, type FollowPointState, resetFollowPoint, stepFollowPoint } from './follow-rig';

/** The rig's live state. A plain mutable record owned by the host and stepped in place — the same shape the
 *  character controller uses, so the frame loop allocates nothing per frame. */
export interface CameraRigState {
  /** Follow distance, in world units — damps toward {@link distanceTarget}. */
  distance: number;
  /** Where the zoom is heading (the wheel and, later, the mode/collision layers all write this one target). */
  distanceTarget: number;
  /** The detached free-fly eye, or null when the rig is attached to a focus. */
  flyEye: [number, number, number] | null;
  /** The smoothed point the rig frames (plan 02) — not the focus itself. */
  follow: FollowPointState;
  /** `?cam=legacy`: run the pre-080 rigid stick instead of the smoothed rig. The A/B a field round compares
   *  one keypress apart, and the escape hatch if a round is rejected. */
  legacy: boolean;
  /** Unapplied pointer travel (plan 02's input damper). */
  look: LookInputState;
  pitch: number;
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
  /** Raw pointer deltas this frame, in pixels (sensitivity is the director's business, not the host's). */
  look: { x: number; y: number };
  mode: CameraMode;
  /** Fly only: left-drag pan delta in NDC since the last frame; null when nothing is being dragged. */
  pan: null | { x: number; y: number };
  /** Fly only: the movement keys held this frame ({@link FLY_KEYS}). */
  walkKeys: ReadonlySet<string>;
  /** Wheel notches this frame: + away from the user (zoom out / dolly back), − toward it. */
  zoomSteps: number;
}

/** Who the rig is framing this frame. The bench is not a mode — it overrides the whole rig (see below).
 *  Reachable from outside as `CameraSnapshot['mode']`. */
type CameraMode = 'fly' | 'foot' | 'vehicle';

export function createRigState(config: CameraConfig, yaw: number, pitch: number, legacy = false): CameraRigState {
  return {
    distance: config.followDistance,
    distanceTarget: config.followDistance,
    flyEye: null,
    follow: createFollowPoint(),
    legacy,
    look: createLookInput(),
    pitch,
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
 * Aim the rig at a yaw the PLAYER did not ask for — vehicle entry lines the camera up behind the car today,
 * plan 03's auto-center will use the same channel. The swing is damped, and any look input cancels it.
 */
export function steerYaw(state: CameraRigState, yaw: number): void {
  state.yawTarget = yaw;
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
  const target = stepFollowPoint(
    state.follow,
    [x, y + config.followHeight, z],
    config,
    snapshot.dt,
    !state.legacy && snapshot.mode !== 'fly',
  );

  return resolveCamera({
    aspect: snapshot.aspect,
    bench: snapshot.bench,
    distance: state.distance,
    flyEye: state.flyEye,
    forward,
    fovYRad: CAMERA_FOV_Y,
    target,
  });
}

/** Mouse look: raw pixel deltas → damped yaw/pitch, clamped per mode. Manual look always wins (036's rule). */
function applyLook(state: CameraRigState, snapshot: CameraSnapshot, config: CameraConfig): void {
  const smoothTime = state.legacy ? 0 : config.inputSmoothTime;
  const look = releaseLook(state.look, snapshot.look.x, snapshot.look.y, smoothTime, snapshot.dt);
  if (snapshot.look.x !== 0 || snapshot.look.y !== 0) {
    state.yawTarget = null; // the player took the camera back
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
