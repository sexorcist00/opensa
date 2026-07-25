import { describe, expect, it } from 'vitest';

import {
  type CameraProbe,
  createCollisionState,
  type GroundProbe,
  gtaFromEngine,
  guardFloor,
  resolveCollision,
} from './camera-collision';
import { TEST_CAMERA_CONFIG as CONFIG } from './camera-test-config';

const LOOK: [number, number, number] = [0, 2, 0]; // engine look point (head height)
const BEHIND: [number, number, number] = [0, 0, -1]; // eye direction: straight back along −Z
const DT = 1 / 60;

/** A probe that always reports the same free distance (null = clear). */
const fixed =
  (dist: null | number): CameraProbe =>
  () =>
    dist;

describe('gtaFromEngine', () => {
  describe('positive cases', () => {
    it('maps engine (x, y, z) to GTA (x, −z, y)', () => {
      expect(gtaFromEngine([1, 2, 3])).toEqual([1, -3, 2]);
    });
  });
});

describe('resolveCollision', () => {
  describe('negative cases', () => {
    it('passes the distance through untouched when there is no probe', () => {
      const state = createCollisionState(7);

      expect(resolveCollision(state, LOOK, BEHIND, 7, CONFIG, null, DT)).toBe(7);
    });

    it('passes through when the radius disables collision', () => {
      const state = createCollisionState(7);

      expect(resolveCollision(state, LOOK, BEHIND, 7, { ...CONFIG, collisionRadius: 0 }, fixed(2), DT)).toBe(7);
    });

    it('never extends the distance past the desired zoom (a far wall is not a pull-out)', () => {
      const state = createCollisionState(7);

      expect(resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(20), DT)).toBe(7);
    });
  });

  describe('positive cases', () => {
    it('snaps IN immediately when a wall is closer than the desired distance', () => {
      const state = createCollisionState(7);
      // No whiskers so the single cast is the whole answer.
      const noWhisker = { ...CONFIG, collisionWhiskerAngle: 0 };

      expect(resolveCollision(state, LOOK, BEHIND, 7, noWhisker, fixed(3), DT)).toBeCloseTo(3, 6);
    });

    it('never pulls closer than the min distance (a wall shoves in, but not INTO the player)', () => {
      const state = createCollisionState(7);
      const noWhisker = { ...CONFIG, collisionMinDistance: 1.6, collisionWhiskerAngle: 0 };

      // A wall 0.5 m behind the head would put the eye in the ped; the min distance holds at 1.6.
      expect(resolveCollision(state, LOOK, BEHIND, 7, noWhisker, fixed(0.5), DT)).toBeCloseTo(1.6, 6);
    });

    it('eases OUT over collisionReleaseTime when the wall clears', () => {
      const state = createCollisionState(3); // was pulled in to 3
      const noWhisker = { ...CONFIG, collisionWhiskerAngle: 0 };

      const first = resolveCollision(state, LOOK, BEHIND, 7, noWhisker, fixed(null), DT);
      expect(first).toBeGreaterThan(3);
      expect(first).toBeLessThan(7); // still gliding out, not popped

      let value = first;
      for (let frame = 0; frame < 300; frame += 1) {
        value = resolveCollision(state, LOOK, BEHIND, 7, noWhisker, fixed(null), DT);
      }
      expect(value).toBeCloseTo(7, 2);
    });

    it('takes the MIN across the primary and the two whiskers', () => {
      const state = createCollisionState(7);
      // The centre cast is clear, but a flanking whisker sees a near wall — the camera eases in early.
      let call = 0;
      const probe: CameraProbe = () => {
        call += 1;

        return call === 1 ? null : 2.5; // primary clear, whiskers hit at 2.5
      };

      expect(resolveCollision(state, LOOK, BEHIND, 7, CONFIG, probe, DT)).toBeCloseTo(2.5, 6);
    });

    it('casts from the look point in GTA space, along −forward', () => {
      const seen: { dir: readonly number[]; from: readonly number[] }[] = [];
      const probe: CameraProbe = (from, dir) => {
        seen.push({ dir: [...dir], from: [...from] });

        return null;
      };
      resolveCollision(createCollisionState(7), LOOK, BEHIND, 7, { ...CONFIG, collisionWhiskerAngle: 0 }, probe, DT);

      expect(seen[0].from).toEqual(gtaFromEngine(LOOK)); // [0, 0, 2]
      expect(seen[0].dir).toEqual(gtaFromEngine(BEHIND)); // [0, 1, 0]
    });
  });
});

describe('guardFloor', () => {
  const ground =
    (z: null | number): GroundProbe =>
    () =>
      z;

  describe('negative cases', () => {
    it('returns the eye unchanged with no probe', () => {
      expect(guardFloor([1, 5, 3], null)).toEqual([1, 5, 3]);
    });

    it('leaves an eye well above the ground alone', () => {
      expect(guardFloor([0, 5, 0], ground(0))).toEqual([0, 5, 0]);
    });

    it('leaves the eye alone when there is no ground below it', () => {
      expect(guardFloor([0, 1, 0], ground(null))).toEqual([0, 1, 0]);
    });
  });

  describe('positive cases', () => {
    it('lifts an eye that sank below the ground to a margin above it', () => {
      // engine Y is GTA Z: ground at 4, eye at 3.9 → lifted to 4 + 0.3 margin.
      expect(guardFloor([2, 3.9, -1], ground(4))[1]).toBeCloseTo(4.3, 6);
    });

    it('keeps x and z while lifting only the height', () => {
      const lifted = guardFloor([2, 0, -1], ground(4));

      expect(lifted[0]).toBe(2);
      expect(lifted[2]).toBe(-1);
    });
  });
});
