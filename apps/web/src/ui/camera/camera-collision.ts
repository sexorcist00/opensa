/**
 * Camera collision (plan 080/04, behaviour #9): the eye must never sit behind a wall from the look point.
 *
 * The layer runs on the FINAL rig pose (after the follow/mode layers, before additive motion) and only CAPS
 * the distance — the zoom state is preserved, so the chosen distance is restored the moment the occlusion
 * clears, exactly as GTA restores your distance after a tunnel.
 *
 * MULTI-RAY (field verdict, 2026-07-25): a single cast reacted to every thin pole/sign between the subject
 * and the camera, so driving through the city the camera constantly jumped. Instead it casts a small fan —
 * the CENTRE plus 4 CORNERS offset by the subject's silhouette radius — and only reacts when ALL of them hit
 * (the obstacle spans the whole silhouette → a real wall). A pole thinner than the subject leaves the corner
 * rays clear → ignored, the camera drives past it (the pole covers a slice of the frame for a moment, which
 * reads far better than a pull-in). Rays are stateless, so unlike a physical collider they never stick.
 *
 * Response is ASYMMETRIC: pulling IN is instant (a wall is never shown a single frame); easing OUT is damped
 * so leaving a doorway glides. A `CameraProbe` is injected (the 080/01 contract) so this is pure and
 * unit-testable; the host passes the real `PhysicsWorld` sphere cast, the tests script hit distances.
 */
import type { CameraConfig } from '@opensa/game';

import { damp } from '@opensa/math';

/** One sphere cast from `fromGta` toward `dirGta` (both GTA Z-up), returning the free distance or null. */
export type CameraProbe = (
  fromGta: readonly [number, number, number],
  dirGta: readonly [number, number, number],
  radius: number,
  maxDist: number,
) => null | number;

/** The ground Z below a GTA point (or null) — the floor guard lifts the eye off it on a steep down-pitch. */
export type GroundProbe = (atGta: readonly [number, number, number]) => null | number;

/** How far the eye is kept above the ground when the floor guard lifts it (world units). */
const FLOOR_MARGIN = 0.3;

/** The collision layer's live state — the damped, currently-shown distance. */
export interface CollisionState {
  /** The distance actually rendered last frame (eases out; snaps in). */
  shown: number;
}

export function createCollisionState(distance: number): CollisionState {
  return { shown: distance };
}

/** GTA Z-up from engine Y-up: `(x, y, z) → (x, −z, y)` — the inverse the host uses at the render boundary. */
export function gtaFromEngine(v: readonly [number, number, number]): [number, number, number] {
  return [v[0], -v[2], v[1]];
}

/**
 * The eye (engine Y-up) lifted so it never sinks below the ground beneath it — a steep down-pitch on a slope
 * or a raised porch otherwise buries the camera and the near plane shows only skybox. Returns the same eye
 * when no lift is needed (or there is no probe).
 */
export function guardFloor(
  eye: readonly [number, number, number],
  groundProbe: GroundProbe | null,
): [number, number, number] {
  if (groundProbe === null) {
    return [eye[0], eye[1], eye[2]];
  }
  const groundZ = groundProbe(gtaFromEngine(eye));
  const minY = groundZ === null ? -Infinity : groundZ + FLOOR_MARGIN; // engine Y is GTA Z (up)

  return [eye[0], Math.max(eye[1], minY), eye[2]];
}

/**
 * The 5-ray fan, as `[right, up]` multiples of the subject radius: CENTRE first, then the 4 corners. Centre is
 * cast first so the fan early-exits on the most common miss, and a zero-radius subject degrades to the single
 * eye-line ray (the tests' fallback).
 */
const RAY_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Cap `desiredDistance` so the eye clears geometry that occludes the WHOLE subject silhouette between the look
 * point and the eye.
 *
 * `lookPointEngine` is the orbit centre (head height — by definition outside geometry); `dirEngine` is the unit
 * vector from the look point toward the eye (engine space). `rightEngine`/`upEngine` are the camera screen basis
 * and `subjectRadius` the subject's silhouette half-width — the fan's 4 corners sit at `±right·r ±up·r`. Returns
 * the distance to render this frame.
 *
 * Multi-ray rule: the camera pulls in ONLY when every ray in the fan hits something closer than the desired
 * distance (a wall spanning the whole subject). If any ray is clear — a pole or sign thinner than the subject,
 * or open space — nothing pulls in; the camera drives past, the thin object sweeping a slice of the frame. The
 * floor is `collisionMinDistance` (the near-plane radius): a real wall closer than that pulls the eye right up
 * to the surface — it may sit inside the ped for a frame, but never slides BEHIND the wall.
 */
export function resolveCollision(
  state: CollisionState,
  lookPointEngine: readonly [number, number, number],
  dirEngine: readonly [number, number, number],
  desiredDistance: number,
  config: CameraConfig,
  probe: CameraProbe | null,
  dt: number,
  rightEngine: readonly [number, number, number] = [0, 0, 0],
  upEngine: readonly [number, number, number] = [0, 0, 0],
  subjectRadius = 0,
): number {
  if (probe === null || config.collisionRadius <= 0) {
    state.shown = desiredDistance;

    return desiredDistance;
  }
  const dirGta = gtaFromEngine(dirEngine);
  const maxDist = desiredDistance + config.collisionRadius; // cast a touch past the eye so a wall AT it registers
  const offsets = subjectRadius > 0 ? RAY_OFFSETS : RAY_OFFSETS.slice(0, 1);
  let nearest = desiredDistance;
  let occluded = true;
  for (const [rx, uy] of offsets) {
    const ox = rx * subjectRadius;
    const oy = uy * subjectRadius;
    const fromGta = gtaFromEngine([
      lookPointEngine[0] + rightEngine[0] * ox + upEngine[0] * oy,
      lookPointEngine[1] + rightEngine[1] * ox + upEngine[1] * oy,
      lookPointEngine[2] + rightEngine[2] * ox + upEngine[2] * oy,
    ]);
    const hit = probe(fromGta, dirGta, config.collisionRadius, maxDist);
    // A clear ray (nothing, or a hit past where the eye already sits) means the silhouette is NOT fully covered.
    if (hit === null || hit >= desiredDistance) {
      occluded = false;
      break;
    }
    nearest = Math.min(nearest, hit);
  }
  // Never closer than the near-plane radius (below it the near plane renders from inside geometry).
  const allowed = occluded
    ? Math.max(nearest, Math.min(desiredDistance, config.collisionMinDistance))
    : desiredDistance;
  // Snap IN (a wall is never shown a single frame); ease OUT so leaving a doorway glides.
  if (allowed < state.shown) {
    state.shown = allowed;
  } else {
    const lambda = config.collisionReleaseTime > 0 ? 1 / config.collisionReleaseTime : Number.POSITIVE_INFINITY;
    state.shown = damp(state.shown, allowed, lambda, dt);
  }

  return state.shown;
}
