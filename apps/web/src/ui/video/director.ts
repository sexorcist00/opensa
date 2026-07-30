/**
 * The shot scheduler (plan 096/03): which shot is on, when it cuts, and the pose it hands the host.
 *
 * The scene's whole shot list is drawn UP FRONT from the seeded stream (D9 — `?seed=` reproduces the shot
 * list, not just the route), so a field round can be replayed frame for frame. What happens per frame is
 * only: pose the current shot, damp toward it, cap the pan, and watch whether the car is still in frame.
 *
 * Two discontinuities exist by design, and both are DECLARED: the cut between shots, and the hand-over
 * between the director and the shipped follow rig (the `chase` shot). Everything else must be continuous by
 * construction, which is what keeps `watchCameraJump` a real tripwire instead of a muted one (constraint 8).
 *
 * The empty-frame guard is the 080 lesson applied ahead of time: a boolean over rays has no continuous
 * middle, so this one is a CLOCK, not a gate — the car has to be out of the safe frame for
 * {@link EMPTY_FRAME_SECONDS} before the cut fires, and a single frame behind a lamppost changes nothing.
 */
import type { Random } from '@opensa/game/paths/rng';

import { pickWeighted } from '@opensa/game/paths/rng';
import { smoothDamp, type SmoothDampRef } from '@opensa/math';

import type { VideoCamera } from '../camera/engine-camera';
import type { ShotName, ShotPreset, Subject } from './shots';

import { aimShot, anchorFor, projectToScreen, shotEye, SHOTS } from './shots';

/** What one stepped frame produced — the pose plus everything the scene's report has to state. */
export interface DirectorFrame {
  /** This frame is a DECLARED discontinuity: a cut between shots, or the frame authority changed hands. */
  cut: boolean;
  /** The pan-rate cap bit this frame — a ledger counter, and the first thing to read if a pan looks lazy. */
  panClipped: boolean;
  /** The frame video mode owns, or null while `chase` leaves it to the shipped rig. */
  pose: null | VideoCamera;
  /** Where the car landed on screen (0..1 from left/top), or null while the rig owns the frame. */
  screen: null | { x: number; y: number };
  shot: ShotName;
}

export interface DirectorState {
  /** Cuts fired so far, the first frame included (it IS a cut — the eye changes owner). */
  cuts: number;
  /** Seconds into the current shot. */
  elapsed: number;
  eye: [number, number, number] | null;
  eyeVelocity: SmoothDampRef[];
  /** Frames the guard judged (placed shots only — `chase` framing is the rig's business, not the ledger's). */
  framesJudged: number;
  /** The pose has not been damped yet: the first frame of a shot SNAPS, which is what makes a cut a cut. */
  fresh: boolean;
  index: number;
  /** Seconds the car has been outside the safe frame — the guard's clock. */
  offFrame: number;
  panClips: number;
  /** Last frame's view direction — the pan-rate cap measures against it. */
  panDirection: [number, number, number] | null;
  readonly plan: readonly ShotPlan[];
  /** Frames the car was inside the safe frame — `safeFrames / framesJudged` is 03's acceptance number. */
  safeFrames: number;
  /** A `static` shot's planted eye, held for the whole shot; null for every other kind. */
  staticEye: [number, number, number] | null;
  target: [number, number, number] | null;
  targetVelocity: SmoothDampRef[];
}

/** One entry of a scene's shot list: which preset, and the seconds it was dealt. */
export interface ShotPlan {
  readonly preset: ShotPreset;
  readonly seconds: number;
}

/** How long the car may sit outside the safe frame before the shot is cut short (s, D4). */
export const EMPTY_FRAME_SECONDS = 1.5;
/** The fastest the view direction may swing (rad/s ≈ 60°/s) — above it a drive-past reads as a whip, not a
 *  pan. The answer to a shot that keeps hitting this is the guard cut, never a higher cap (the plan's note). */
export const PAN_RATE_MAX = Math.PI / 3;
/** How far from centre the car may drift and still count as framed (0.45 = the outer tenth of the frame). */
export const SAFE_FRAME = 0.45;

export function createDirector(plan: readonly ShotPlan[]): DirectorState {
  return {
    cuts: 0,
    elapsed: 0,
    eye: null,
    eyeVelocity: [{ velocity: 0 }, { velocity: 0 }, { velocity: 0 }],
    framesJudged: 0,
    fresh: true,
    index: 0,
    offFrame: 0,
    panClips: 0,
    panDirection: null,
    plan,
    safeFrames: 0,
    staticEye: null,
    target: null,
    targetVelocity: [{ velocity: 0 }, { velocity: 0 }, { velocity: 0 }],
  };
}

/**
 * The scene's shot list, drawn from the seeded stream: weighted picks, never the same preset twice in a row,
 * every duration inside its preset's own bounds (so D4's 5 s floor is a property of the table), and `chase`
 * guaranteed at least once — a scene of nothing but placed shots never shows the game as it is played.
 *
 * Dealt to cover `seconds` with one shot's worth of margin: a scene that outlives its list wraps to the front
 * rather than running out of director, which the fragment length (`?to=`) makes possible on purpose.
 */
export function planShots(random: Random, seconds: number, presets: readonly ShotPreset[] = SHOTS): ShotPlan[] {
  const plan: ShotPlan[] = [];
  let total = 0;
  let previous: null | ShotName = null;
  while (total < seconds) {
    const weights = presets.map((preset) => (preset.name === previous ? 0 : preset.weight));
    const pick = presets[Math.max(0, pickWeighted(random, weights))];
    const length = pick.minSeconds + random() * (pick.maxSeconds - pick.minSeconds);
    plan.push({ preset: pick, seconds: length });
    previous = pick.name;
    total += length;
  }
  if (!plan.some((entry) => entry.preset.kind === 'chase')) {
    const chase = presets.find((preset) => preset.kind === 'chase');
    if (chase) {
      const at = Math.min(plan.length - 1, Math.floor(random() * plan.length));
      plan[at] = { preset: chase, seconds: chase.minSeconds + random() * (chase.maxSeconds - chase.minSeconds) };
    }
  }

  return plan;
}

/**
 * Advance the director by one rendered frame and hand back the pose for it.
 *
 * `subject` is the car as it is DRAWN this frame, already in engine space — the director never touches the
 * physics pose or the GTA axes (the 080 one-space rule).
 */
export function stepDirector(state: DirectorState, subject: Subject, dt: number, aspect: number): DirectorFrame {
  state.elapsed += dt;
  const current = state.plan[state.index];
  const expired = state.elapsed >= current.seconds;
  // The guard outranks the 5 s floor deliberately: D4 asks that the camera not linger on an empty frame, and
  // a shot that lost its subject has already stopped being a shot.
  const emptied = state.offFrame > EMPTY_FRAME_SECONDS;
  if (expired || emptied) {
    advance(state);
  }
  const shot = state.plan[state.index].preset;
  const cut = state.fresh;
  if (shot.kind === 'chase') {
    // Hand the frame back to the rig — and forget the damped pose, so the next placed shot starts from its
    // own geometry instead of easing out of wherever the last one stood.
    state.eye = null;
    state.target = null;
    state.panDirection = null;
    state.fresh = false;

    return { cut, panClipped: false, pose: null, screen: null, shot: shot.name };
  }

  if (shot.kind === 'static' && state.staticEye === null) {
    state.staticEye = shotEye(shot, subject);
  }
  const wantedEye = state.staticEye ?? shotEye(shot, subject);
  const anchor = anchorFor(shot, wantedEye, subject);
  const wantedTarget = aimShot(wantedEye, subject.position, anchor, shot.fovYRad, aspect);
  const eye = state.fresh
    ? wantedEye
    : dampVec(state.eye ?? wantedEye, wantedEye, state.eyeVelocity, shot.eyeSmooth, dt);
  const damped = state.fresh
    ? wantedTarget
    : dampVec(state.target ?? wantedTarget, wantedTarget, state.targetVelocity, shot.targetSmooth, dt);
  const { panClipped, target } = capPan(state, eye, damped, dt);
  state.eye = eye;
  state.target = target;
  state.fresh = false;

  const screen = projectToScreen(eye, target, shot.fovYRad, aspect, subject.position);
  const safe = !screen.behind && Math.abs(screen.x - 0.5) <= SAFE_FRAME && Math.abs(screen.y - 0.5) <= SAFE_FRAME;
  state.framesJudged += 1;
  state.safeFrames += safe ? 1 : 0;
  state.offFrame = safe ? 0 : state.offFrame + dt;
  state.panClips += panClipped ? 1 : 0;

  return {
    cut,
    panClipped,
    pose: { eye, fovYRad: shot.fovYRad, target },
    screen: { x: screen.x, y: screen.y },
    shot: shot.name,
  };
}

/** Move to the next shot, wrapping, and reset everything a shot owns. A cut declares itself through
 *  {@link DirectorState.fresh}, which the next step reports and the host's watchdog reads. */
function advance(state: DirectorState): void {
  state.index = (state.index + 1) % state.plan.length;
  state.elapsed = 0;
  state.fresh = true;
  state.offFrame = 0;
  state.staticEye = null;
  state.panDirection = null;
  state.cuts += 1;
  for (const ref of [...state.eyeVelocity, ...state.targetVelocity]) {
    ref.velocity = 0;
  }
}

/**
 * Hold the view direction's angular rate under {@link PAN_RATE_MAX} by pulling the look point back around the
 * eye — the aim slows, the framing distance does not. A fresh shot has no previous direction and is never
 * capped: a cut IS the discontinuity.
 */
function capPan(
  state: DirectorState,
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
  dt: number,
): { panClipped: boolean; target: [number, number, number] } {
  const wanted = normalize([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const previous = state.panDirection;
  const range = Math.hypot(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
  if (previous === null || dt <= 0) {
    state.panDirection = wanted;

    return { panClipped: false, target: [target[0], target[1], target[2]] };
  }
  const cosine = Math.min(1, Math.max(-1, previous[0] * wanted[0] + previous[1] * wanted[1] + previous[2] * wanted[2]));
  const angle = Math.acos(cosine);
  const allowed = PAN_RATE_MAX * dt;
  if (angle <= allowed) {
    state.panDirection = wanted;

    return { panClipped: false, target: [target[0], target[1], target[2]] };
  }
  // Rotate EXACTLY `allowed` toward the wanted direction, about the axis the two span (Rodrigues). A
  // normalized lerp along the chord was the first cut and it overshoots the cap by a hair on a fast pass —
  // small, but a cap a test cannot pin to its own value is not a cap.
  const axis = cross(previous, wanted);
  // Collinear directions span no axis — a straight reversal, which nothing here can produce and no cap could
  // describe. Take the wanted aim rather than inventing a swing side.
  const limited =
    Math.hypot(axis[0], axis[1], axis[2]) < 1e-9 ? wanted : rotateAbout(previous, normalize(axis), allowed);
  state.panDirection = limited;

  return {
    panClipped: true,
    target: [eye[0] + limited[0] * range, eye[1] + limited[1] * range, eye[2] + limited[2] * range],
  };
}

function cross(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** `smoothDamp` per axis with one velocity ref each — the same caller-owned-state shape the rig uses. */
function dampVec(
  current: readonly [number, number, number],
  wanted: readonly [number, number, number],
  velocity: SmoothDampRef[],
  smoothTime: number,
  dt: number,
): [number, number, number] {
  return [
    smoothDamp(current[0], wanted[0], velocity[0], smoothTime, Number.POSITIVE_INFINITY, dt),
    smoothDamp(current[1], wanted[1], velocity[1], smoothTime, Number.POSITIVE_INFINITY, dt),
    smoothDamp(current[2], wanted[2], velocity[2], smoothTime, Number.POSITIVE_INFINITY, dt),
  ];
}

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Rodrigues: spin a UNIT vector by `angle` about a UNIT axis perpendicular to it. */
function rotateAbout(
  v: readonly [number, number, number],
  axis: readonly [number, number, number],
  angle: number,
): [number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const perpendicular = cross(axis, v);

  return [
    v[0] * cos + perpendicular[0] * sin,
    v[1] * cos + perpendicular[1] * sin,
    v[2] * cos + perpendicular[2] * sin,
  ];
}
