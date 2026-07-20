/**
 * Camera resolution for the own-engine host (074/22): who owns the eye this frame, and how the photo camera
 * moves. Pure math, kept out of `engine-canvas-host` so the frame loop stays readable and both rules are
 * unit-testable (the host itself is browser-only glue).
 */
import type { CameraState } from '@opensa/engine';

/** Vertical field of view of every camera this host resolves — cursor picking must unproject through it. */
export const CAMERA_FOV_Y = Math.PI / 3;

/** The steepest the map viewer may look down. A perfectly vertical forward has no defined screen basis, so
 *  this stops just short of it — the same margin {@link screenBasis} depends on. */
export const TOP_DOWN_PITCH = -Math.PI / 2 + 0.01;

/**
 * Prod's K+M chord (`canvas-host`, verbatim semantics): the toggle fires ONCE while both keys are held —
 * key repeat cannot re-fire it — and re-arms only after one of them is released.
 */
export function createChordWatcher(
  first: string,
  second: string,
): { down(code: string): boolean; up(code: string): void } {
  let firstDown = false;
  let secondDown = false;
  let fired = false;

  return {
    down(code: string): boolean {
      firstDown ||= code === first;
      secondDown ||= code === second;
      if (firstDown && secondDown && !fired) {
        fired = true;

        return true;
      }

      return false;
    },
    up(code: string): void {
      if (code === first || code === second) {
        firstDown = firstDown && code !== first;
        secondDown = secondDown && code !== second;
        fired = false;
      }
    },
  };
}

/**
 * The world-space ray direction through a CURSOR position (NDC, y up) — what the map viewer picks along.
 *
 * The gameplay camera picks along its own forward because the pointer is locked and the crosshair IS the aim.
 * The map viewer has no pointer lock, so the cursor is the aim and a forward-vector pick would select whatever
 * happens to sit at screen centre instead of what the user clicked.
 */
export function cursorRay(
  forward: readonly [number, number, number],
  ndc: readonly [number, number],
  aspect: number,
  fovYRad: number,
): [number, number, number] {
  const { right, up } = screenBasis(forward);
  const tanHalf = Math.tan(fovYRad / 2);
  const sx = ndc[0] * tanHalf * aspect;
  const sy = ndc[1] * tanHalf;
  const dir: [number, number, number] = [
    forward[0] + right[0] * sx + up[0] * sy,
    forward[1] + right[1] * sx + up[1] * sy,
    forward[2] + right[2] * sx + up[2] * sy,
  ];
  const length = Math.hypot(dir[0], dir[1], dir[2]) || 1;

  return [dir[0] / length, dir[1] / length, dir[2] / length];
}

/**
 * One photo-camera movement step (074/22): ARROWS walk the eye along the view forward / camera right
 * (prod's `flyUpdate`, same axes — right = forward × up), PageUp/PageDown lift it (an engine addition;
 * prod's fly camera has no vertical key). Pure — the eye in, the moved eye out.
 */
export function flyStep(
  eye: readonly [number, number, number],
  keys: ReadonlySet<string>,
  forward: readonly [number, number, number],
  yaw: number,
  step: number,
): [number, number, number] {
  const [fx, fy, fz] = forward;
  // right = normalize(forward × up) — for a yaw-based forward that is (−cos yaw, 0, sin yaw).
  const right: [number, number, number] = [-Math.cos(yaw), 0, Math.sin(yaw)];
  const axes: [string, [number, number, number]][] = [
    ['ArrowUp', [fx, fy, fz]],
    ['ArrowDown', [-fx, -fy, -fz]],
    ['ArrowRight', right],
    ['ArrowLeft', [-right[0], 0, -right[2]]],
    ['PageUp', [0, 1, 0]],
    ['PageDown', [0, -1, 0]],
  ];
  const moved: [number, number, number] = [eye[0], eye[1], eye[2]];
  for (const [code, [dx, dy, dz]] of axes) {
    if (keys.has(code)) {
      moved[0] += dx * step;
      moved[1] += dy * step;
      moved[2] += dz * step;
    }
  }

  return moved;
}

/**
 * Drag-to-pan for the map viewer (the LEFT button, as prod's OrbitControls mapped it): the eye slides in the
 * camera's own screen plane, OPPOSITE the drag, so the map follows the cursor like a grabbed sheet.
 *
 * `scale` is world units per NDC unit — pass the eye's height above the ground so panning covers the same
 * apparent distance whether you are 50 m or 500 m up, which is what made the three controls feel right.
 */
export function panStep(
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
  ndcDelta: readonly [number, number],
  scale: number,
): [number, number, number] {
  const { right, up } = screenBasis(forward);
  const dx = -ndcDelta[0] * scale;
  const dy = -ndcDelta[1] * scale;

  return [
    eye[0] + right[0] * dx + up[0] * dy,
    eye[1] + right[1] * dx + up[1] * dy,
    eye[2] + right[2] * dx + up[2] * dy,
  ];
}

/**
 * Whose camera this frame is, in priority order: a running BENCH owns it outright (the prod BenchPlugin
 * contract — deterministic path, player parked), then the photo camera (074/22), else the follow rig.
 */
export function resolveCamera(state: {
  aspect: number;
  bench: null | { eye: [number, number, number]; target: [number, number, number] };
  distance: number;
  flyEye: [number, number, number] | null;
  forward: readonly [number, number, number];
  target: readonly [number, number, number];
}): CameraState {
  const { aspect, bench, distance, flyEye, forward, target } = state;
  const rig = { aspect, far: 10000, fovYRad: CAMERA_FOV_Y, near: 0.5, up: [0, 1, 0] as [number, number, number] };
  if (bench) {
    return { ...rig, eye: bench.eye, target: bench.target };
  }
  if (flyEye) {
    return { ...rig, eye: flyEye, target: [flyEye[0] + forward[0], flyEye[1] + forward[1], flyEye[2] + forward[2]] };
  }

  return {
    ...rig,
    eye: [target[0] - forward[0] * distance, target[1] - forward[1] * distance, target[2] - forward[2] * distance],
    target: [target[0], target[1], target[2]],
  };
}

/** The camera's screen basis for a forward vector, matching `mat4LookAt`'s (right, up) rows exactly. */
function screenBasis(forward: readonly [number, number, number]): {
  right: [number, number, number];
  up: [number, number, number];
} {
  const [fx, fy, fz] = forward;
  // `mat4LookAt` builds x = normalize(up × z) with z = eye − target = −forward, and up × (−f) = f × up.
  // With up = (0, 1, 0) that is (−fz, 0, fx) — which is why the top-down pitch stops just short of −π/2:
  // at a perfectly vertical forward both components are zero and the basis has no defined roll.
  const length = Math.hypot(fz, fx) || 1;
  const right: [number, number, number] = [-fz / length, 0, fx / length];

  // y = z × x, with z = −forward.
  return {
    right,
    up: [-fy * right[2], fx * right[2] - fz * right[0], fy * right[0]],
  };
}
