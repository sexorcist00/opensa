/**
 * Shared locomotion constants + pure heading math (plan 088/01).
 *
 * The controller owns a per-player heading (yaw, rad, GTA Z-up) and turns it toward the INTENT
 * direction at a speed-scheduled rate — facing anticipates the move like modern third-person games,
 * while the velocity follows through the accel/decel integrator. The renderer only reads the result.
 */

/** Planar speed (units/s) below which the ped counts as standing — clip choice and heading share it. */
export const IDLE_SPEED_THRESHOLD = 0.3;

/** Intent further than this from the current heading while moving = a reversal: plant, don't pirouette. */
export const REVERSAL_ANGLE = (2 * Math.PI) / 3; // 120°

const TWO_PI = 2 * Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/** Shortest signed arc from `from` to `to`, in (−π, π]. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) {
    delta -= TWO_PI;
  } else if (delta <= -Math.PI) {
    delta += TWO_PI;
  }

  return delta;
}

/** Turn `current` toward `target` along the shortest arc by at most `maxDelta` (rad), snapping when within. */
export function approachAngle(current: number, target: number, maxDelta: number): number {
  if (maxDelta <= 0) {
    return current;
  }
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxDelta) {
    return normalizeAngle(target);
  }

  return normalizeAngle(current + Math.sign(delta) * maxDelta);
}

/**
 * Turn rate (rad/s) scheduled by speed: snappy repositioning near idle (`idleDeg`/s), wide readable
 * arcs at the top tier speed (`fullDeg`/s), lerped between. `fullSpeed` is the top locomotion tier
 * (runSpeed today; the sprint tier once 088/03 lands).
 */
export function scheduledTurnRate(speed: number, fullSpeed: number, idleDeg: number, fullDeg: number): number {
  const t = fullSpeed > 0 ? Math.min(Math.abs(speed) / fullSpeed, 1) : 1;

  return (idleDeg + (fullDeg - idleDeg) * t) * DEG_TO_RAD;
}

/** Yaw (rad) of a GTA planar vector — the renderer's heading convention (`atan2(-x, y)`). */
export function yawFromPlanar(x: number, y: number): number {
  return Math.atan2(-x, y);
}

/** Wrap into (−π, π] so an accumulating heading never drifts away from the principal range. */
function normalizeAngle(angle: number): number {
  let wrapped = angle % TWO_PI;
  if (wrapped > Math.PI) {
    wrapped -= TWO_PI;
  } else if (wrapped <= -Math.PI) {
    wrapped += TWO_PI;
  }

  return wrapped;
}
