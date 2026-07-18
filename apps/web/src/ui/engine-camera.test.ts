import { describe, expect, it } from 'vitest';

import { createChordWatcher, flyStep, resolveCamera } from './engine-camera';

const FORWARD = [0, 0, -1] as const; // looking down −Z
const TARGET = [10, 2, 30] as const;

describe('flyStep', () => {
  describe('negative cases', () => {
    it('does not move the eye when no movement key is held', () => {
      expect(flyStep([1, 2, 3], new Set(), FORWARD, 0, 24)).toEqual([1, 2, 3]);
    });

    it('ignores keys that are not photo-camera controls', () => {
      expect(flyStep([1, 2, 3], new Set(['KeyW', 'Space']), FORWARD, 0, 24)).toEqual([1, 2, 3]);
    });

    it('cancels opposite keys held together', () => {
      const keys = new Set(['ArrowDown', 'ArrowUp']);
      expect(flyStep([0, 0, 0], keys, FORWARD, 0, 10)).toEqual([0, 0, 0]);
    });
  });

  describe('positive cases', () => {
    it('walks the eye along the view forward', () => {
      expect(flyStep([0, 0, 0], new Set(['ArrowUp']), FORWARD, 0, 10)).toEqual([0, 0, -10]);
    });

    it('strafes along the camera right (prod axes: right = forward × up) and lifts on PageUp', () => {
      const strafed = flyStep([0, 0, 0], new Set(['ArrowRight']), FORWARD, 0, 5);
      expect(strafed[0]).toBe(-5); // yaw 0 looks down −Z, so camera-right is −X
      expect(strafed[2]).toBeCloseTo(0);
      expect(flyStep([0, 0, 0], new Set(['PageUp']), FORWARD, 0, 5)).toEqual([0, 5, 0]);
    });

    it('scales the step by the frame time (speed × dt comes in as one number)', () => {
      const slow = flyStep([0, 0, 0], new Set(['ArrowUp']), FORWARD, 0, 1);
      const fast = flyStep([0, 0, 0], new Set(['ArrowUp']), FORWARD, 0, 4);
      expect(fast[2]).toBeCloseTo(slow[2] * 4);
    });
  });
});

describe('resolveCamera', () => {
  const base = { aspect: 1.5, bench: null, distance: 7, flyEye: null, forward: FORWARD, target: TARGET };

  describe('negative cases', () => {
    it('ignores the photo camera while a bench owns the frame', () => {
      const bench = { eye: [1, 1, 1] as [number, number, number], target: [2, 2, 2] as [number, number, number] };
      const camera = resolveCamera({ ...base, bench, flyEye: [9, 9, 9] });

      expect(camera.eye).toEqual([1, 1, 1]);
      expect(camera.target).toEqual([2, 2, 2]);
    });
  });

  describe('positive cases', () => {
    it('trails the follow target by the zoom distance', () => {
      const camera = resolveCamera(base);

      expect(camera.eye).toEqual([10, 2, 37]); // pulled back along −forward
      expect(camera.target).toEqual([10, 2, 30]);
      expect(camera.aspect).toBe(1.5);
    });

    it('sits at the photo eye and looks one unit ahead of it', () => {
      const camera = resolveCamera({ ...base, flyEye: [4, 5, 6] });

      expect(camera.eye).toEqual([4, 5, 6]);
      expect(camera.target).toEqual([4, 5, 5]);
    });
  });
});

describe('createChordWatcher', () => {
  describe('negative cases', () => {
    it('does not fire on one key alone', () => {
      const chord = createChordWatcher('KeyK', 'KeyM');

      expect(chord.down('KeyK')).toBe(false);
      expect(chord.down('KeyA')).toBe(false);
    });

    it('does not re-fire while both keys stay held (key repeat)', () => {
      const chord = createChordWatcher('KeyK', 'KeyM');
      chord.down('KeyK');

      expect(chord.down('KeyM')).toBe(true);
      expect(chord.down('KeyM')).toBe(false);
      expect(chord.down('KeyK')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('fires once per press, in either key order', () => {
      const chord = createChordWatcher('KeyK', 'KeyM');
      chord.down('KeyM');
      expect(chord.down('KeyK')).toBe(true);

      chord.up('KeyK');
      chord.up('KeyM');
      chord.down('KeyK');
      expect(chord.down('KeyM')).toBe(true);
    });

    it('re-arms after only one of the two keys is released', () => {
      const chord = createChordWatcher('KeyK', 'KeyM');
      chord.down('KeyK');
      chord.down('KeyM');

      chord.up('KeyM'); // K still held
      expect(chord.down('KeyM')).toBe(true);
    });
  });
});
