/**
 * Camera resolution for the own-engine host (074/22): who owns the eye this frame, and how the photo camera
 * moves. Pure math, kept out of `engine-canvas-host` so the frame loop stays readable and both rules are
 * unit-testable (the host itself is browser-only glue).
 */
import type { CameraState } from '@opensa/engine';

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
  const rig = { aspect, far: 10000, fovYRad: Math.PI / 3, near: 0.5, up: [0, 1, 0] as [number, number, number] };
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
