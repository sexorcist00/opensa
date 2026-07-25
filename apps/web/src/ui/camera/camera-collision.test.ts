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
const RIGHT: [number, number, number] = [-1, 0, 0]; // screen basis for a −Z eye direction (from screenBasis)
const UP: [number, number, number] = [0, 1, 0];
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

      expect(resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(3), DT)).toBeCloseTo(3, 6);
    });

    it('never comes closer than the near-plane floor (a very close wall clips the ped, not skybox)', () => {
      const state = createCollisionState(7);

      // A wall 0.2 m behind would put the near plane inside geometry; it holds at the 0.5 near-plane floor.
      expect(resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(0.2), DT)).toBeCloseTo(0.5, 6);
    });

    it('eases back out when the wall clears', () => {
      const state = createCollisionState(3); // pulled in to 3
      const first = resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(null), DT);
      expect(first).toBeGreaterThan(3);
      expect(first).toBeLessThan(7); // still gliding out

      let value = first;
      for (let frame = 0; frame < 300; frame += 1) {
        value = resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(null), DT);
      }
      expect(value).toBeCloseTo(7, 2);
    });

    it('pulls IN when the whole fan is occluded (a wall spans the subject silhouette)', () => {
      const state = createCollisionState(7);
      // right/up for a −Z eye direction; a wall hits every ray at 3.
      expect(resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(3), DT, RIGHT, UP, 0.5)).toBeCloseTo(3, 6);
    });

    it('IGNORES a pole thinner than the subject (a corner ray stays clear)', () => {
      const state = createCollisionState(7);
      // Occludes only the eye line (from.x === 0); the offset corner rays miss → not a full occlusion.
      const pole: CameraProbe = (from) => (from[0] === 0 ? 3 : null);

      expect(resolveCollision(state, LOOK, BEHIND, 7, CONFIG, pole, DT, RIGHT, UP, 0.5)).toBeCloseTo(7, 6);
    });

    it('offsets the corner rays by the subject radius along right/up', () => {
      const seen: number[][] = [];
      const probe: CameraProbe = (from) => {
        seen.push([...from]);

        return 3; // every ray hits, so the whole fan is cast
      };
      resolveCollision(createCollisionState(7), LOOK, BEHIND, 7, CONFIG, probe, DT, RIGHT, UP, 0.5);

      // Centre first, then 4 corners at ±right·0.5 ±up·0.5 (GTA: x from right, z from up).
      expect(seen).toHaveLength(5);
      expect(seen[0][0]).toBe(0); // centre = gtaFromEngine(LOOK): no right/up offset
      expect(seen[0][2]).toBe(2);
      const corners = seen.slice(1).map((f) => [f[0], f[2]]); // (x, GTA-z = engine y)
      expect(corners).toContainEqual([-0.5, 2.5]);
      expect(corners).toContainEqual([0.5, 1.5]);
    });

    it('casts from the look point in GTA space, along −forward', () => {
      const seen: { dir: readonly number[]; from: readonly number[] }[] = [];
      const probe: CameraProbe = (from, dir) => {
        seen.push({ dir: [...dir], from: [...from] });

        return null;
      };
      resolveCollision(createCollisionState(7), LOOK, BEHIND, 7, CONFIG, probe, DT);

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
