import { describe, expect, it } from 'vitest';

import { createChordWatcher, cursorRay, flyStep, panStep, resolveCamera, TOP_DOWN_PITCH } from './engine-camera';

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

describe('cursorRay', () => {
  const close = (a: readonly number[], b: readonly number[]): void => {
    a.forEach((value, at) => expect(value).toBeCloseTo(b[at], 6));
  };

  describe('negative cases', () => {
    it('returns the forward vector unchanged at screen centre', () => {
      close(cursorRay([0, 0, 1], [0, 0], 16 / 9, Math.PI / 3), [0, 0, 1]);
    });

    it('stays unit length off-centre, so the pick ray has no implicit scale', () => {
      const dir = cursorRay([0, 0, 1], [0.8, -0.6], 16 / 9, Math.PI / 3);

      expect(Math.hypot(...dir)).toBeCloseTo(1, 6);
    });

    it('survives the near-vertical top-down forward the viewer rests at', () => {
      // A perfectly vertical forward has no screen basis; the viewer's pitch stops just short of it.
      const forward: [number, number, number] = [Math.cos(TOP_DOWN_PITCH), Math.sin(TOP_DOWN_PITCH), 0];
      const dir = cursorRay(forward, [0.5, 0.5], 1, Math.PI / 3);

      expect(Number.isFinite(dir[0]) && Number.isFinite(dir[1]) && Number.isFinite(dir[2])).toBe(true);
      expect(Math.hypot(...dir)).toBeCloseTo(1, 6);
    });
  });

  describe('positive cases', () => {
    it('aims along the camera RIGHT for a cursor on the right edge', () => {
      // Looking down +Z, `mat4LookAt`'s screen right is −X; a right-edge cursor must lean that way.
      const dir = cursorRay([0, 0, 1], [1, 0], 1, Math.PI / 3);

      expect(dir[0]).toBeLessThan(0);
      expect(dir[1]).toBeCloseTo(0, 6);
      expect(dir[2]).toBeGreaterThan(0);
    });

    it('aims UP for a cursor above centre', () => {
      const dir = cursorRay([0, 0, 1], [0, 1], 1, Math.PI / 3);

      expect(dir[1]).toBeGreaterThan(0);
    });

    it('widens with the aspect ratio — the same NDC x reaches further on a wide canvas', () => {
      const narrow = cursorRay([0, 0, 1], [1, 0], 1, Math.PI / 3);
      const wide = cursorRay([0, 0, 1], [1, 0], 2, Math.PI / 3);

      expect(Math.abs(wide[0])).toBeGreaterThan(Math.abs(narrow[0]));
    });
  });
});

describe('panStep', () => {
  describe('negative cases', () => {
    it('does not move the eye without a drag', () => {
      expect(panStep([5, 100, 5], [0, 0, 1], [0, 0], 100)).toEqual([5, 100, 5]);
    });
  });

  describe('positive cases', () => {
    it('moves the eye OPPOSITE the drag, so the map follows the cursor', () => {
      // Looking down +Z, screen right is −X. Dragging right (+ndc x) must push the eye toward +X.
      const moved = panStep([0, 100, 0], [0, 0, 1], [0.1, 0], 100);

      expect(moved[0]).toBeGreaterThan(0);
    });

    it('scales with the height passed in — the same drag covers more ground from higher up', () => {
      const low = panStep([0, 0, 0], [0, 0, 1], [0.1, 0], 50);
      const high = panStep([0, 0, 0], [0, 0, 1], [0.1, 0], 500);

      expect(Math.abs(high[0])).toBeGreaterThan(Math.abs(low[0]));
    });
  });
});
