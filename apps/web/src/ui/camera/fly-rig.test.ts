import { describe, expect, it } from 'vitest';

import { dollyStep, flyStep, panStep, TOP_DOWN_HEIGHT, topDownEye } from './fly-rig';

const FORWARD = [0, 0, -1] as const; // looking down −Z

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

describe('dollyStep', () => {
  describe('negative cases', () => {
    it('never dollies the eye below the ground clearance', () => {
      // Looking straight down from 2.1 u: one notch in would drive the eye through the terrain.
      const moved = dollyStep([0, 2.1, 0], [0, -1, 0], -1);

      expect(moved[1]).toBe(2);
    });
  });

  describe('positive cases', () => {
    it('moves along the view, backwards for a push away and forwards for a pull in', () => {
      const back = dollyStep([0, 100, 0], [0, 0, 1], 1);
      const forth = dollyStep([0, 100, 0], [0, 0, 1], -1);

      expect(back[2]).toBeLessThan(0);
      expect(forth[2]).toBeGreaterThan(0);
    });

    it('scales the step with altitude, so the gesture works at 5 u and at 500 u', () => {
      const low = dollyStep([0, 5, 0], [0, 0, 1], -1);
      const high = dollyStep([0, 500, 0], [0, 0, 1], -1);

      expect(high[2]).toBeGreaterThan(low[2] * 10);
    });
  });
});

describe('topDownEye', () => {
  describe('positive cases', () => {
    it('lifts the eye straight over the focus', () => {
      expect(topDownEye([10, 4, -6])).toEqual([10, 4 + TOP_DOWN_HEIGHT, -6]);
    });
  });
});
