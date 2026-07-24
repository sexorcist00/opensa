import type { CameraConfig } from '@opensa/game';

import { describe, expect, it } from 'vitest';

import {
  type CameraSnapshot,
  createRigState,
  reseedDistance,
  setFlyEye,
  snapTopDown,
  stepCamera,
} from './camera-director';
import { FLY_SPEED, TOP_DOWN_HEIGHT, TOP_DOWN_PITCH } from './fly-rig';

const CONFIG: CameraConfig = {
  followDistance: 7,
  followHeight: 0.9,
  followLerp: 3,
  followMaxPolar: Math.PI / 2 - 0.05,
  followMinPolar: 0.25,
  followPolar: 1.15,
  followZoom: true,
  followZoomMax: 10,
  followZoomMin: 4,
  pitchMax: 0.9,
  pitchMin: -1.2,
  sensitivity: 0.004,
};

const snapshot = (over: Partial<CameraSnapshot> = {}): CameraSnapshot => ({
  aspect: 16 / 9,
  bench: null,
  dt: 1 / 60,
  focus: [10, 2, 30],
  look: { x: 0, y: 0 },
  mode: 'foot',
  pan: null,
  walkKeys: new Set(),
  zoomSteps: 0,
  ...over,
});

/** The pre-080 inline host math, verbatim: what the director must still produce (the plan-01 parity gate). */
function legacyCamera(steps: readonly { look: [number, number]; wheel: number }[]): {
  eye: [number, number, number];
  target: [number, number, number];
} {
  let yaw = Math.PI;
  let pitch = -0.25;
  let distance = 7;
  for (const step of steps) {
    yaw -= step.look[0] * 0.004;
    pitch = Math.max(-1.2, Math.min(0.9, pitch - step.look[1] * 0.004));
    if (step.wheel !== 0) {
      distance = Math.max(4, Math.min(10, distance * (step.wheel > 0 ? 1.08 : 0.93)));
    }
  }
  const forward: [number, number, number] = [
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(yaw),
  ];
  const target: [number, number, number] = [10, 2 + 0.9, 30];

  return {
    eye: [target[0] - forward[0] * distance, target[1] - forward[1] * distance, target[2] - forward[2] * distance],
    target,
  };
}

describe('stepCamera', () => {
  describe('negative cases', () => {
    it('hands the frame to a running bench whatever the rig is doing', () => {
      const state = createRigState(CONFIG, Math.PI, -0.25);
      setFlyEye(state, [9, 9, 9]);
      const bench = { eye: [1, 1, 1] as [number, number, number], target: [2, 2, 2] as [number, number, number] };

      const camera = stepCamera(state, snapshot({ bench, mode: 'fly' }), CONFIG);

      expect(camera.eye).toEqual([1, 1, 1]);
      expect(camera.target).toEqual([2, 2, 2]);
    });

    it('does not zoom while the wheel toggle is off', () => {
      const state = createRigState(CONFIG, Math.PI, -0.25);

      stepCamera(state, snapshot({ zoomSteps: 3 }), { ...CONFIG, followZoom: false });

      expect(state.distance).toBe(7);
    });

    it('keeps the gameplay pitch inside the config clamps', () => {
      const state = createRigState(CONFIG, Math.PI, -0.25);

      stepCamera(state, snapshot({ look: { x: 0, y: 5000 } }), CONFIG);
      expect(state.pitch).toBe(CONFIG.pitchMin);

      stepCamera(state, snapshot({ look: { x: 0, y: -5000 } }), CONFIG);
      expect(state.pitch).toBe(CONFIG.pitchMax);
    });

    it('leaves the follow rig alone in fly mode — the eye is detached, not trailing the focus', () => {
      const state = createRigState(CONFIG, Math.PI, -0.25);
      setFlyEye(state, [4, 5, 6]);

      const camera = stepCamera(state, snapshot({ mode: 'fly' }), CONFIG);

      expect(camera.eye).toEqual([4, 5, 6]);
    });
  });

  describe('positive cases', () => {
    it('reproduces the pre-080 stick camera over a scripted look + zoom sequence', () => {
      const steps = [
        { look: [12, -4] as [number, number], wheel: 0 },
        { look: [-30, 9] as [number, number], wheel: 1 },
        { look: [0, 0] as [number, number], wheel: -1 },
        { look: [140, 260] as [number, number], wheel: 0 },
      ];
      const state = createRigState(CONFIG, Math.PI, -0.25);
      let camera = stepCamera(state, snapshot(), CONFIG);
      for (const step of steps) {
        camera = stepCamera(
          state,
          snapshot({ look: { x: step.look[0], y: step.look[1] }, zoomSteps: step.wheel }),
          CONFIG,
        );
      }
      const legacy = legacyCamera(steps);

      camera.eye.forEach((value, axis) => expect(value).toBeCloseTo(legacy.eye[axis], 12));
      camera.target.forEach((value, axis) => expect(value).toBeCloseTo(legacy.target[axis], 12));
    });

    it('frames the focus at the config eye height', () => {
      const camera = stepCamera(createRigState(CONFIG, Math.PI, -0.25), snapshot(), { ...CONFIG, followHeight: 2 });

      expect(camera.target).toEqual([10, 4, 30]);
    });

    it('applies every wheel notch of a frame, clamped to the zoom bounds', () => {
      const state = createRigState(CONFIG, Math.PI, -0.25);

      stepCamera(state, snapshot({ zoomSteps: 2 }), CONFIG);
      expect(state.distance).toBeCloseTo(7 * 1.08 * 1.08, 12);

      stepCamera(state, snapshot({ zoomSteps: 20 }), CONFIG);
      expect(state.distance).toBe(CONFIG.followZoomMax);
    });

    it('lets the map viewer look further down than gameplay may', () => {
      const state = createRigState(CONFIG, Math.PI, -0.25);
      setFlyEye(state, [0, 100, 0]);

      stepCamera(state, snapshot({ look: { x: 0, y: 5000 }, mode: 'fly' }), CONFIG);

      expect(state.pitch).toBe(TOP_DOWN_PITCH);
      expect(state.pitch).toBeLessThan(CONFIG.pitchMin);
    });

    it('walks, pans and dollies the detached eye in fly mode', () => {
      const state = createRigState(CONFIG, 0, 0); // looking down +Z
      setFlyEye(state, [0, 100, 0]);

      stepCamera(state, snapshot({ mode: 'fly', walkKeys: new Set(['ArrowUp']) }), CONFIG);
      expect(state.flyEye?.[2]).toBeCloseTo(FLY_SPEED / 60, 12);

      const walked = state.flyEye?.[0] ?? 0;
      stepCamera(state, snapshot({ mode: 'fly', pan: { x: 0.1, y: 0 } }), CONFIG);
      expect(state.flyEye?.[0]).toBeGreaterThan(walked);

      const height = state.flyEye?.[1] ?? 0;
      stepCamera(state, snapshot({ mode: 'fly', zoomSteps: -1 }), CONFIG);
      expect(state.flyEye?.[1]).toBe(height); // level view: the dolly runs flat, not down
      expect(state.flyEye?.[2]).toBeGreaterThan(FLY_SPEED / 60);
    });

    it('snaps overhead when the map viewer opens, and re-attaches on exit', () => {
      const state = createRigState(CONFIG, Math.PI, -0.25);
      snapTopDown(state, [10, 2, 30]);

      expect(state.flyEye).toEqual([10, 2 + TOP_DOWN_HEIGHT, 30]);
      expect(state.pitch).toBe(TOP_DOWN_PITCH);

      setFlyEye(state, null);
      const camera = stepCamera(state, snapshot(), CONFIG);

      expect(camera.eye[1]).toBeLessThan(TOP_DOWN_HEIGHT);
    });

    it('re-seeds the zoom from an authored distance the debugger changed', () => {
      const state = createRigState(CONFIG, Math.PI, -0.25);

      reseedDistance(state, CONFIG, 9);
      expect(state.distance).toBe(9);

      reseedDistance(state, CONFIG, 40); // past the bound — the slider may not escape the zoom range
      expect(state.distance).toBe(CONFIG.followZoomMax);
    });
  });
});
