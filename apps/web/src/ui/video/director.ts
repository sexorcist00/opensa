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
import type { PosedShot, ShotName, ShotPreset, Subject, Vec3 } from './shots';

import { aimShot, anchorFor, projectToScreen, shotEye, SHOTS } from './shots';

/** What one stepped frame produced — the pose plus everything the scene's report has to state. */
export interface DirectorFrame {
  /** This frame is a DECLARED discontinuity: a cut between shots, or the frame authority changed hands. */
  cut: boolean;
  /** What ended the PREVIOUS shot, on a cut frame; null on every other frame. */
  cutCause: CutCause | null;
  /** The pan-rate cap bit this frame — a ledger counter, and the first thing to read if a pan looks lazy. */
  panClipped: boolean;
  /** The frame video mode owns, or null while `chase` leaves it to the shipped rig. */
  pose: null | VideoCamera;
  /** Where the car landed on screen (0..1 from left/top), or null while the rig owns the frame. */
  screen: null | { x: number; y: number };
  shot: ShotName;
}

export interface DirectorState {
  /** Set on the frame a cut fires, read back out by the step that reports it. */
  cause: CutCause | null;
  /** What ended each shot so far, counted by cause — the ledger's early-cut breakdown. */
  readonly causes: Record<CutCause, number>;
  /** Shot changes so far. The scene's OPENING is not one of them — it is counted in `causes.opening`,
   *  because it changes the frame's owner rather than one shot for another. */
  cuts: number;
  /** Seconds into the current shot. */
  elapsed: number;
  eye: [number, number, number] | null;
  eyeVelocity: SmoothDampRef[];
  /** Station slots the survey could not fill, so the plan's own fallback preset played instead. */
  fallbacks: number;
  /** Frames the guard judged (placed shots only — `chase` framing is the rig's business, not the ledger's). */
  framesJudged: number;
  /** The pose has not been damped yet: the first frame of a shot SNAPS, which is what makes a cut a cut. */
  fresh: boolean;
  index: number;
  /** Consecutive sightline probes that came back blocked — two of them end a tripod shot. */
  misses: number;
  /** Seconds the car has been outside the safe frame — the guard's clock. */
  offFrame: number;
  panClips: number;
  /** Last frame's view direction — the pan-rate cap measures against it. */
  panDirection: [number, number, number] | null;
  readonly plan: readonly ShotPlan[];
  /** Frames the car was inside the safe frame — `safeFrames / framesJudged` is 03's acceptance number. */
  safeFrames: number;
  /** Seconds until the next sightline probe — the live occlusion check runs at {@link SIGHTLINE_SECONDS},
   *  never per frame: it is a discrete verdict, and a per-frame one would be a gate with no middle. */
  sightlineIn: number;
  /** A `static` or `station` shot's planted eye, held for the whole shot; null for every other kind. */
  staticEye: [number, number, number] | null;
  /** The preset actually playing when it is NOT the planned one — a station slot the survey could not fill. */
  substitute: null | ShotPreset;
  target: [number, number, number] | null;
  targetVelocity: SmoothDampRef[];
}

/** One entry of a scene's shot list: which preset, and the seconds it was dealt. */
export interface ShotPlan {
  /** What plays instead when a `station` slot finds no surveyed station. Drawn at PLAN time, from the same
   *  seeded stream, so a scene that falls back is still the scene the seed describes. */
  readonly fallback?: PosedShot;
  readonly preset: ShotPreset;
  readonly seconds: number;
}

/** Where a tripod shot gets its eye, and how it asks whether it can still see the car (096/04). */
export interface StationSource {
  /** Whether the line from `eye` to the car is clear right now. Called at most once per
   *  {@link SIGHTLINE_SECONDS}, and only for a tripod. */
  sightline(eye: Vec3, subject: Vec3): boolean;
  /** The station surveyed for the next tripod shot (engine Y-up), or null when none passed. Taking it
   *  CONSUMES it — the survey starts again for the shot after. */
  take(): null | Vec3;
}

/** Why a shot ended — one word for the ledger, and the priority order the guard resolves in. */
type CutCause = 'empty' | 'occluded' | 'opening' | 'scheduled';

/** How long the car may sit outside the safe frame before the shot is cut short (s, D4). */
export const EMPTY_FRAME_SECONDS = 1.5;
/** The fastest the view direction may swing (rad/s ≈ 60°/s) — above it a drive-past reads as a whip, not a
 *  pan. The answer to a shot that keeps hitting this is the guard cut, never a higher cap (the plan's note). */
export const PAN_RATE_MAX = Math.PI / 3;
/** How far from centre the car may drift and still count as framed (0.45 = the outer tenth of the frame). */
export const SAFE_FRAME = 0.45;
/** How often a tripod asks whether it can still see the car (s), and how many blocked answers in a row end
 *  the shot. Hysteresis lives HERE — in the cadence and the debounce — never in a moving camera. */
export const SIGHTLINE_SECONDS = 1;
export const SIGHTLINE_MISSES = 2;

export function createDirector(plan: readonly ShotPlan[]): DirectorState {
  return {
    cause: 'opening',
    causes: { empty: 0, occluded: 0, opening: 1, scheduled: 0 },
    cuts: 0,
    elapsed: 0,
    eye: null,
    eyeVelocity: [{ velocity: 0 }, { velocity: 0 }, { velocity: 0 }],
    fallbacks: 0,
    framesJudged: 0,
    fresh: true,
    index: 0,
    misses: 0,
    offFrame: 0,
    panClips: 0,
    panDirection: null,
    plan,
    safeFrames: 0,
    sightlineIn: SIGHTLINE_SECONDS,
    staticEye: null,
    substitute: null,
    target: null,
    targetVelocity: [{ velocity: 0 }, { velocity: 0 }, { velocity: 0 }],
  };
}

/**
 * The next TRIPOD slot in the shot list and how far off it is — what the survey needs to know to start
 * probing during the shot before it. Null when the plan holds none.
 *
 * A shot already RUNNING is skipped: a tripod takes its eye when its shot starts, and a survey for it would
 * arrive too late to be anything but a second answer to a settled question. One that has not started yet is
 * not skipped, which is what lets a scene OPENING on a tripod be surveyed behind the black overlay — the
 * first field run played four such slots as fallbacks purely for want of somewhere to do the casts.
 */
export function nextStationSlot(state: DirectorState): null | { index: number; seconds: number; startsIn: number } {
  const current = state.plan[state.index];
  if (state.fresh && current.preset.kind === 'station') {
    return { index: state.index, seconds: current.seconds, startsIn: 0 };
  }
  let startsIn = Math.max(0, current.seconds - state.elapsed);
  // Up to and INCLUDING a full lap: a list whose only tripod is the shot in play still has one coming, on the
  // next time round, and the survey has all of that lap to find it a stand.
  for (let step = 1; step <= state.plan.length; step += 1) {
    const at = (state.index + step) % state.plan.length;
    const entry = state.plan[at];
    if (entry.preset.kind === 'station') {
      return { index: at, seconds: entry.seconds, startsIn };
    }
    startsIn += entry.seconds;
  }

  return null;
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
    // A tripod slot draws its stand-in NOW, from the same stream: a scene whose survey finds nothing still
    // plays the scene the seed describes, and the fallback is never a runtime coin flip.
    plan.push(
      pick.kind === 'station'
        ? { fallback: posedFallback(random, presets), preset: pick, seconds: length }
        : { preset: pick, seconds: length },
    );
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
export function stepDirector(
  state: DirectorState,
  subject: Subject,
  dt: number,
  aspect: number,
  stations?: StationSource,
): DirectorFrame {
  state.elapsed += dt;
  // The early-cut policy, in ONE place and in priority order (096/04 task 4): a blocked tripod outranks an
  // empty frame (it is the more certain verdict), and both outrank the shot's own clock — which in turn
  // outranks D4's 5 s floor, because a shot that lost its subject has stopped being a shot.
  const blocked = state.misses >= SIGHTLINE_MISSES;
  const emptied = state.offFrame > EMPTY_FRAME_SECONDS;
  if (blocked || emptied || state.elapsed >= state.plan[state.index].seconds) {
    advance(state, blocked ? 'occluded' : emptied ? 'empty' : 'scheduled');
  }
  const cut = state.fresh;
  const cause = cut ? state.cause : null;
  const shot = shotPlaying(state, stations);
  if (shot.kind === 'chase') {
    // Hand the frame back to the rig — and forget the damped pose, so the next placed shot starts from its
    // own geometry instead of easing out of wherever the last one stood.
    state.eye = null;
    state.target = null;
    state.panDirection = null;
    state.fresh = false;

    return { cut, cutCause: cause, panClipped: false, pose: null, screen: null, shot: shot.name };
  }

  if (shot.kind === 'static' && state.staticEye === null) {
    state.staticEye = shotEye(shot, subject);
  }
  // A tripod's eye came from the survey when the shot started ({@link shotPlaying}); a slot with no station
  // plays a car-anchored fallback instead, so the defensive default below is unreachable by construction.
  const wantedEye: [number, number, number] =
    shot.kind === 'tracking'
      ? shotEye(shot, subject)
      : (state.staticEye ?? [subject.position[0], subject.position[1], subject.position[2]]);
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
  const range = Math.hypot(subject.position[0] - eye[0], subject.position[1] - eye[1], subject.position[2] - eye[2]);
  // "Readable" is one predicate over three ways of losing the car: behind the eye, out at the frame edge,
  // or simply too far away to be a subject at all.
  const safe =
    !screen.behind &&
    range <= shot.maxDist &&
    Math.abs(screen.x - 0.5) <= SAFE_FRAME &&
    Math.abs(screen.y - 0.5) <= SAFE_FRAME;
  state.framesJudged += 1;
  state.safeFrames += safe ? 1 : 0;
  state.offFrame = safe ? 0 : state.offFrame + dt;
  state.panClips += panClipped ? 1 : 0;
  stepSightline(state, shot.kind === 'station' ? stations : undefined, eye, subject.position, dt);

  return {
    cut,
    cutCause: cause,
    panClipped,
    pose: { eye, fovYRad: shot.fovYRad, target },
    screen: { x: screen.x, y: screen.y },
    shot: shot.name,
  };
}

/** Move to the next shot, wrapping, and reset everything a shot owns. A cut declares itself through
 *  {@link DirectorState.fresh}, which the next step reports and the host's watchdog reads. */
function advance(state: DirectorState, cause: CutCause): void {
  state.index = (state.index + 1) % state.plan.length;
  state.cause = cause;
  state.causes[cause] += 1;
  state.elapsed = 0;
  state.fresh = true;
  state.misses = 0;
  state.offFrame = 0;
  state.sightlineIn = SIGHTLINE_SECONDS;
  state.staticEye = null;
  state.substitute = null;
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

/** A car-anchored stand-in for a tripod slot the survey could not fill, drawn from the seeded stream. */
function posedFallback(random: () => number, presets: readonly ShotPreset[]): PosedShot {
  const posed = presets.filter((preset): preset is PosedShot => preset.kind === 'static' || preset.kind === 'tracking');
  if (posed.length === 0) {
    throw new Error('the shot table has no car-anchored preset to fall back on');
  }

  return posed[Math.min(posed.length - 1, Math.floor(random() * posed.length))];
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

/**
 * The preset actually playing this frame.
 *
 * A tripod takes its surveyed eye on the shot's FIRST frame and never asks again — the eye is fixed for the
 * whole shot by design (the occlusion verdict may cut away from it, it may never move it). A slot the survey
 * could not fill plays the plan's own fallback instead: a missing station costs variety, never a scene.
 */
function shotPlaying(state: DirectorState, stations?: StationSource): ShotPreset {
  if (state.substitute) {
    return state.substitute;
  }
  const planned = state.plan[state.index].preset;
  if (!state.fresh || planned.kind !== 'station') {
    return planned;
  }
  const eye = stations?.take() ?? null;
  if (eye) {
    state.staticEye = [eye[0], eye[1], eye[2]];

    return planned;
  }
  state.fallbacks += 1;
  state.substitute = state.plan[state.index].fallback ?? posedFallback(() => 0, SHOTS);

  return state.substitute;
}

/**
 * The live occlusion check: one probe per {@link SIGHTLINE_SECONDS}, and {@link SIGHTLINE_MISSES} blocked
 * answers in a row end the shot. It is asked ONLY for a tripod, and its only possible effect is a declared
 * cut — the camera never moves in response to it (the 080 multi-ray postmortem's whole lesson).
 */
function stepSightline(
  state: DirectorState,
  stations: StationSource | undefined,
  eye: Vec3,
  subject: Vec3,
  dt: number,
): void {
  if (!stations) {
    state.misses = 0;

    return;
  }
  state.sightlineIn -= dt;
  if (state.sightlineIn > 0) {
    return;
  }
  state.sightlineIn = SIGHTLINE_SECONDS;
  state.misses = stations.sightline(eye, subject) ? 0 : state.misses + 1;
}
