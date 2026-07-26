/**
 * What a scripted lap REPORTS (plan 081/01) — the `[phys]` capture's numbers, derived from the frames.
 *
 * The summary exists so a ledger row can be read without replaying anything: the peak nose-up angle while the
 * brakes were on, the roll a slalom reached, whether the car ever went over, how long it was in the air. Every
 * later 081 plan is judged by moving these numbers, so they are computed once, here, and the same function
 * runs over a BEFORE capture and an AFTER one.
 *
 * The peaks are taken over EVERY frame while the series a capture prints is thinned — a spike must survive
 * the thinning as a number even when its sample is dropped from the curve.
 */
import type { TelemetryFrame } from './vehicle-telemetry';

const RAD_TO_DEG = 180 / Math.PI;
const MS_TO_KMH = 3.6;
/** Below this speed (m/s) the car counts as stopped — the end of a braking distance. */
const STOPPED_SPEED = 0.4;
/** Past this roll (deg) the car is on its side or its roof; the chain's flip complaint made measurable. */
const FLIP_ROLL_DEG = 90;

/** A signed channel's extremes over the capture. */
export interface PhysRange {
  readonly max: number;
  readonly min: number;
}

export interface PhysSummary {
  /** Seconds with NO wheel in contact — the crest scene's air time. */
  readonly airborneS: number;
  /** Braking: distance and time from the first braked frame to a stop. Null when the lap never braked to
   *  a halt (nothing to measure is not the same as a zero). */
  readonly brake: null | { distanceM: number; fromKmh: number; seconds: number };
  /** Captured length (s) and frame count — a lap that ended early is not comparable to one that did not. */
  readonly durationS: number;
  /** Whether the car ever passed {@link FLIP_ROLL_DEG}, and how fast it was going when it first did. */
  readonly flip: null | { atKmh: number; atS: number };
  readonly frames: number;
  readonly gLat: PhysRange;
  readonly gLong: PhysRange;
  readonly gVert: PhysRange;
  readonly pitchDeg: PhysRange;
  /** Peak nose-up angle (deg) while the brakes were applied — THE number the braking complaint is about.
   *  Null when the lap never braked. */
  readonly pitchUnderBrakeDeg: null | number;
  readonly rollDeg: PhysRange;
  /** Largest body slip angle reached (deg, absolute) — how sideways the lap ever got. */
  readonly slipMaxDeg: number;
  /** Seconds from the first moving frame to 100 km/h; null when the car never got there. */
  readonly timeTo100S: null | number;
  /** Top forward speed (km/h). */
  readonly topSpeedKmh: number;
  /** Net heading change over the lap (deg, signed) — a u-turn should read ~180, a handbrake turn its
   *  rotation. Integrated from yaw rate, so it counts the whole spin rather than the shortest way round. */
  readonly turnedDeg: number;
}

/** Derive the lap's numbers. An empty capture summarises to zeros rather than throwing — a scene that
 *  produced nothing is a result the runner must be able to print and a reader must be able to see. */
export function summarisePhysFrames(frames: readonly TelemetryFrame[]): PhysSummary {
  if (frames.length === 0) {
    return EMPTY;
  }
  const braked = frames.filter((frame) => frame.brake > 0);
  const flip = frames.find((frame) => Math.abs(frame.roll * RAD_TO_DEG) >= FLIP_ROLL_DEG) ?? null;

  return {
    airborneS: round(integrate(frames, (frame) => (frame.wheels.some((wheel) => wheel.contact) ? 0 : 1))),
    brake: brakingRun(frames),
    durationS: round(frames[frames.length - 1].t - frames[0].t),
    flip: flip === null ? null : { atKmh: round(flip.speed * MS_TO_KMH), atS: round(flip.t) },
    frames: frames.length,
    gLat: range(frames.map((frame) => frame.gLat)),
    gLong: range(frames.map((frame) => frame.gLong)),
    gVert: range(frames.map((frame) => frame.gVert)),
    pitchDeg: range(frames.map((frame) => frame.pitch * RAD_TO_DEG)),
    pitchUnderBrakeDeg:
      braked.length === 0 ? null : round(Math.max(...braked.map((frame) => frame.pitch * RAD_TO_DEG))),
    rollDeg: range(frames.map((frame) => frame.roll * RAD_TO_DEG)),
    slipMaxDeg: round(Math.max(...frames.map((frame) => Math.abs(frame.slipAngle * RAD_TO_DEG)))),
    timeTo100S: timeToSpeed(frames, 100),
    topSpeedKmh: round(Math.max(...frames.map((frame) => frame.speed * MS_TO_KMH))),
    turnedDeg: round(integrate(frames, (frame) => frame.yawRate * RAD_TO_DEG)),
  };
}

/** Thin a capture to about `hz` samples per second, keeping the first and last frame. */
export function thinFrames(frames: readonly TelemetryFrame[], hz: number): readonly TelemetryFrame[] {
  if (frames.length <= 2 || hz <= 0) {
    return frames;
  }
  const period = 1 / hz;
  const kept: TelemetryFrame[] = [frames[0]];
  // Against a RUNNING target, not the last kept stamp: chasing the last one lets each rounding-up compound,
  // and a 60 Hz capture thinned "to 20 Hz" quietly comes out at 15. EPSILON covers the step's own float
  // error (3 × 1/60 is 0.049999…, which a bare `>=` reads as short of a 0.05 period).
  const EPSILON = 1e-9;
  let nextAt = frames[0].t + period;
  for (const frame of frames.slice(1, -1)) {
    if (frame.t + EPSILON >= nextAt) {
      kept.push(frame);
      nextAt += period;
    }
  }
  kept.push(frames[frames.length - 1]);

  return kept;
}

/** Integrate a per-frame value over the capture's own timestamps (never an assumed step). */
function integrate(frames: readonly TelemetryFrame[], value: (frame: TelemetryFrame) => number): number {
  let total = 0;
  for (let index = 1; index < frames.length; index += 1) {
    total += value(frames[index]) * (frames[index].t - frames[index - 1].t);
  }

  return total;
}

/** Seconds from the first MOVING frame to `kmh`; null when the lap never got there. Measured from the
 *  moment the car actually starts rolling, so a lap that idles before its launch is not penalised. */
function timeToSpeed(frames: readonly TelemetryFrame[], kmh: number): null | number {
  const start = frames.find((frame) => frame.speed > STOPPED_SPEED);
  const reached = frames.find((frame) => frame.speed * MS_TO_KMH >= kmh);

  return start === undefined || reached === undefined ? null : round(reached.t - start.t);
}

const ZERO_RANGE: PhysRange = { max: 0, min: 0 };

const EMPTY: PhysSummary = {
  airborneS: 0,
  brake: null,
  durationS: 0,
  flip: null,
  frames: 0,
  gLat: ZERO_RANGE,
  gLong: ZERO_RANGE,
  gVert: ZERO_RANGE,
  pitchDeg: ZERO_RANGE,
  pitchUnderBrakeDeg: null,
  rollDeg: ZERO_RANGE,
  slipMaxDeg: 0,
  timeTo100S: null,
  topSpeedKmh: 0,
  turnedDeg: 0,
};

/** The first braking run that actually reaches a stop: its distance, its time, and the speed it started at. */
function brakingRun(frames: readonly TelemetryFrame[]): null | { distanceM: number; fromKmh: number; seconds: number } {
  const start = frames.findIndex((frame) => frame.brake > 0 && frame.speed > STOPPED_SPEED);
  if (start === -1) {
    return null;
  }
  let distance = 0;
  for (let index = start + 1; index < frames.length; index += 1) {
    const dt = frames[index].t - frames[index - 1].t;
    distance += Math.abs(frames[index].speed) * dt;
    if (frames[index].speed <= STOPPED_SPEED) {
      return {
        distanceM: round(distance),
        fromKmh: round(frames[start].speed * MS_TO_KMH),
        seconds: round(frames[index].t - frames[start].t),
      };
    }
  }

  return null; // braked but never stopped inside the capture — not a distance anyone can compare
}

function range(values: readonly number[]): PhysRange {
  return { max: round(Math.max(...values)), min: round(Math.min(...values)) };
}

/** Two decimals: a capture is compared against another capture, not read to float precision. */
function round(value: number): number {
  return Number(value.toFixed(2));
}
