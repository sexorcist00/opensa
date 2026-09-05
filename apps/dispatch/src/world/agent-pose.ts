/**
 * The pose an agent asked for, completed against the one the map is holding (phone-console plan 002).
 *
 * **Why this file exists, and it cost a measurement session.** `map_goto` takes `at` and makes every other
 * field optional — which is right, because "fly to [1500, -1500] at 200 m" is a complete instruction from a
 * tool that is not holding the camera. What arrived at the console was the argument object itself, cast to
 * a {@link MapPose} and handed straight to `flyToPose`, so an omitted field arrived as `undefined` inside a
 * type that says it cannot be:
 *
 * - `yaw: undefined` → `forwardFrom` returns `[NaN, NaN, NaN]` → the eye is NaN → **the map draws black**
 *   and the readout says `NaN, NaN` while `cellsVisible`, `draws` and every millisecond keep reporting a
 *   frame that is a picture of nothing;
 * - `projection: undefined` → `state()` reads `projection === 'perspective'` as false, so the frame is
 *   composed **orthographically** with `near = 2·distance − far`, which is a different lens than the one the
 *   operator is looking through.
 *
 * **SILENT in every way this repo can be**: it typechecks (the cast is the bug), it lints, no test sees it
 * (the camera's own tests pass complete poses, which is what a caller in this repo has), nothing is logged,
 * and the console goes on answering `map_snapshot` with numbers that look ordinary. It was found by the
 * operator's eye — *"you moved the camera to a black screen"* — two flights into an ablation sweep.
 *
 * So the completion happens HERE, at the seam where untrusted JSON becomes a pose, in the same shape
 * `poseFromQuery` completes a shared link and `capture-*.ts` completes a query parameter: a field that is
 * absent or unreadable falls back to what the map already has, and the answer STATES the pose that was
 * flown so a tool cannot claim a heading it never asked for.
 */
import type { MapPose, MapProjection } from '../map/map-camera';

/** The ground point is the one field with no sensible fallback: without it there is no instruction at all. */
export function agentPose(raw: unknown, current: MapPose): MapPose {
  const asked = (raw ?? {}) as Partial<Record<keyof MapPose, unknown>>;
  const at = asked.at;
  if (
    !Array.isArray(at) ||
    at.length !== 2 ||
    !at.every((value) => typeof value === 'number' && Number.isFinite(value))
  ) {
    throw new Error('pose: `at` must be two finite numbers — [x, y] in GTA coords');
  }

  return {
    at: [at[0] as number, at[1] as number],
    height: finite(asked.height) ?? current.height,
    pitch: finite(asked.pitch) ?? current.pitch,
    projection: projection(asked.projection) ?? current.projection,
    yaw: finite(asked.yaw) ?? current.yaw,
  };
}

/** A number that can be flown, or nothing. `NaN` and `Infinity` are what a JSON round trip turns nulls into. */
function finite(value: unknown): null | number {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One of the two lenses, or nothing — never a string the camera would silently read as `ortho`. */
function projection(value: unknown): MapProjection | null {
  return value === 'ortho' || value === 'perspective' ? value : null;
}
