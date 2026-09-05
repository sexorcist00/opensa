import { describe, expect, it } from 'vitest';

import type { MapPose } from '../map/map-camera';

import { MAP_YAW } from '../map/map-camera';
import { agentPose } from './agent-pose';

const CURRENT: MapPose = { at: [1700, -1500], height: 900, pitch: -1.15, projection: 'perspective', yaw: MAP_YAW };

describe('agentPose', () => {
  describe('negative cases', () => {
    it('refuses a command with no ground point, because there is no instruction without one', () => {
      expect(() => agentPose({}, CURRENT)).toThrow(/`at`/);
      expect(() => agentPose(undefined, CURRENT)).toThrow(/`at`/);
    });

    it('refuses a ground point that is not two finite numbers', () => {
      expect(() => agentPose({ at: [1500] }, CURRENT)).toThrow(/`at`/);
      expect(() => agentPose({ at: [1500, Number.NaN] }, CURRENT)).toThrow(/`at`/);
      expect(() => agentPose({ at: ['1500', '-1500'] }, CURRENT)).toThrow(/`at`/);
    });

    it('never lets an omitted heading through as undefined — that is the NaN eye that painted a black map', () => {
      const pose = agentPose({ at: [1500, -1500], height: 200, pitch: -1.3 }, CURRENT);

      expect(pose.yaw).toBe(CURRENT.yaw);
      expect(Number.isFinite(pose.yaw)).toBe(true);
    });

    it('never lets an omitted projection through, which the camera reads as orthographic', () => {
      expect(agentPose({ at: [1500, -1500] }, CURRENT).projection).toBe('perspective');
      expect(agentPose({ at: [1500, -1500], projection: 'plan' }, CURRENT).projection).toBe('perspective');
      expect(agentPose({ at: [1500, -1500] }, { ...CURRENT, projection: 'ortho' }).projection).toBe('ortho');
    });

    it('falls back to the held pose for a height or tilt that cannot be flown', () => {
      const pose = agentPose({ at: [1500, -1500], height: Number.POSITIVE_INFINITY, pitch: null }, CURRENT);

      expect(pose.height).toBe(CURRENT.height);
      expect(pose.pitch).toBe(CURRENT.pitch);
    });
  });

  describe('positive cases', () => {
    it('takes every field a full pose states', () => {
      const asked = { at: [1500, -1500], height: 200, pitch: -1.3, projection: 'ortho', yaw: 1.5 };

      expect(agentPose(asked, CURRENT)).toEqual({
        at: [1500, -1500],
        height: 200,
        pitch: -1.3,
        projection: 'ortho',
        yaw: 1.5,
      });
    });

    it('keeps the rig and moves the ground when only `at` is given, which is what a locate means', () => {
      expect(agentPose({ at: [1380, -1620] }, CURRENT)).toEqual({ ...CURRENT, at: [1380, -1620] });
    });
  });
});
