import { describe, expect, it } from 'vitest';

import type { SamplerBone, SamplerClip } from './ifp-sampler';

import { IfpSampler } from './ifp-sampler';

/** Two-bone chain: root at origin (identity), child at +1 x. Inverse binds = exact inverses of the bind
 *  worlds, so sampling the BIND pose must produce identity palettes. */
function chainBones(): SamplerBone[] {
  return [
    {
      bindPosition: [0, 0, 0],
      bindRotation: [0, 0, 0, 1],
      inverseBind: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      parent: -1,
    },
    {
      bindPosition: [1, 0, 0],
      bindRotation: [0, 0, 0, 1],
      inverseBind: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1],
      parent: 0,
    },
  ];
}

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** A lone root bone at the origin with an identity inverse bind — its palette IS its sampled local. */
function rootBone(bindPosition: readonly [number, number, number] = [0, 0, 0]): SamplerBone {
  return { bindPosition, bindRotation: [0, 0, 0, 1], inverseBind: identity, parent: -1 };
}

/** Rotation angle about Z encoded in a palette slot, in degrees. */
function zAngleDegrees(palette: Float32Array, slot: number): number {
  return (Math.atan2(palette[slot * 16 + 1], palette[slot * 16]) * 180) / Math.PI;
}

const stillQuats = (count: number): number[] => Array.from({ length: count }, () => [0, 0, 0, 1]).flat();

describe('IfpSampler', () => {
  describe('negative cases', () => {
    it('holds the bind pose (identity palette) when tracks are empty', () => {
      const sampler = new IfpSampler(chainBones());
      const clip: SamplerClip = {
        duration: 1,
        tracks: [
          { quats: [], times: [] },
          { quats: [], times: [] },
        ],
      };
      const palette = new Float32Array(3 * 16);

      sampler.sample(clip, 0.5, palette, 1);

      for (let bone = 0; bone < 2; bone += 1) {
        for (let component = 0; component < 16; component += 1) {
          expect(palette[(1 + bone) * 16 + component]).toBeCloseTo(identity[component], 5);
        }
      }
    });

    it('freezes a zero-duration clip on its first keyframe instead of running off the end', () => {
      const sampler = new IfpSampler([rootBone()]);
      const halfSqrt = Math.SQRT1_2;
      const clip: SamplerClip = {
        duration: 0,
        tracks: [{ quats: [0, 0, 0, 1, 0, 0, halfSqrt, halfSqrt], times: [0, 1] }],
      };
      const palette = new Float32Array(2 * 16);

      sampler.sample(clip, 7.25, palette, 1);

      expect(zAngleDegrees(palette, 1)).toBeCloseTo(0, 5);
    });

    it('keeps the bind position when a translation track carries no keyframes', () => {
      const sampler = new IfpSampler([rootBone([3, -4, 5])]);
      const clip: SamplerClip = { duration: 1, tracks: [{ positions: [0, 0, 0], quats: [], times: [] }] };
      const palette = new Float32Array(2 * 16);

      sampler.sample(clip, 0.5, palette, 1);

      expect([palette[28], palette[29], palette[30]]).toEqual([3, -4, 5]);
    });

    it('clamps to the FIRST keyframe when sampled before the track starts', () => {
      const sampler = new IfpSampler([rootBone()]);
      const halfSqrt = Math.SQRT1_2;
      const clip: SamplerClip = {
        duration: 8,
        tracks: [
          {
            positions: [5, 0, 0, 9, 0, 0],
            quats: [0, 0, 0, 1, 0, 0, halfSqrt, halfSqrt],
            times: [2, 4],
          },
        ],
      };
      const palette = new Float32Array(2 * 16);

      sampler.sample(clip, 0.5, palette, 1);

      expect(palette[28]).toBeCloseTo(5, 5);
      expect(zAngleDegrees(palette, 1)).toBeCloseTo(0, 5);
    });

    it('clamps to the LAST keyframe when sampled past the track end', () => {
      const sampler = new IfpSampler([rootBone()]);
      const halfSqrt = Math.SQRT1_2;
      const clip: SamplerClip = {
        duration: 8,
        tracks: [
          {
            positions: [5, 0, 0, 9, 0, 0],
            quats: [0, 0, 0, 1, 0, 0, halfSqrt, halfSqrt],
            times: [2, 4],
          },
        ],
      };
      const palette = new Float32Array(2 * 16);

      sampler.sample(clip, 6, palette, 1);

      expect(palette[28]).toBeCloseTo(9, 5);
      expect(zAngleDegrees(palette, 1)).toBeCloseTo(90, 3);
    });
  });

  describe('positive cases', () => {
    it('rotating the root 90° about Z carries the child bone with it', () => {
      const sampler = new IfpSampler(chainBones());
      const halfSqrt = Math.SQRT1_2;
      const clip: SamplerClip = {
        duration: 1,
        tracks: [
          { quats: [0, 0, halfSqrt, halfSqrt], times: [0] },
          { quats: [], times: [] },
        ],
      };
      const palette = new Float32Array(3 * 16);

      sampler.sample(clip, 0, palette, 1);

      // The child's palette maps its bind-space point (1,0,0) to the rotated world (0,1,0):
      // palette = childWorld × inverseBind; apply to (1,0,0,1).
      const m = palette.subarray(2 * 16, 3 * 16);
      const x = m[0] * 1 + m[4] * 0 + m[8] * 0 + m[12];
      const y = m[1] * 1 + m[5] * 0 + m[9] * 0 + m[13];
      expect(x).toBeCloseTo(0, 5);
      expect(y).toBeCloseTo(1, 5);
    });

    it('slerps between keyframes and wraps by the clip duration', () => {
      const sampler = new IfpSampler([chainBones()[0]]);
      const halfSqrt = Math.SQRT1_2;
      // 0° at t=0, 90° about Z at t=1 → at t=0.5 expect 45°.
      const clip: SamplerClip = {
        duration: 2,
        tracks: [{ quats: [0, 0, 0, 1, 0, 0, halfSqrt, halfSqrt], times: [0, 1] }],
      };
      const palette = new Float32Array(2 * 16);

      sampler.sample(clip, 2.5, palette, 1); // 2.5 wraps to 0.5

      const angle = Math.atan2(palette[16 + 1], palette[16]); // column 0 of the rotation
      expect((angle * 180) / Math.PI).toBeCloseTo(45, 3);
    });

    it('slides a translated bone linearly between the bracketing keyframes (a garage door)', () => {
      const sampler = new IfpSampler([rootBone()]);
      const clip: SamplerClip = {
        duration: 6,
        tracks: [
          {
            positions: [0, 0, 0, 2, 0, 0, 4, 0, 0, 6, 0, 0],
            quats: stillQuats(4),
            times: [0, 1, 2, 3],
          },
        ],
      };
      const palette = new Float32Array(2 * 16);

      sampler.sample(clip, 0.5, palette, 1); // brackets the FIRST pair
      expect(palette[28]).toBeCloseTo(1, 5);

      sampler.sample(clip, 2.5, palette, 1); // brackets the LAST pair — the search must walk right
      expect(palette[28]).toBeCloseTo(5, 5);
    });

    it('takes the SHORT way round when neighbouring keyframe quats have opposite signs', () => {
      const sampler = new IfpSampler([rootBone()]);
      const halfSqrt = Math.SQRT1_2;
      // Second key is the negation of a +90° rotation — the same orientation, the opposite hemisphere.
      const clip: SamplerClip = {
        duration: 2,
        tracks: [{ quats: [0, 0, 0, 1, 0, 0, -halfSqrt, -halfSqrt], times: [0, 1] }],
      };
      const palette = new Float32Array(2 * 16);

      sampler.sample(clip, 0.5, palette, 1);

      expect(zAngleDegrees(palette, 1)).toBeCloseTo(45, 3); // −135° would be the long way round
    });

    it('holds a steady pose across two identical keyframes instead of dividing by a zero sine', () => {
      const sampler = new IfpSampler([rootBone()]);
      const halfSqrt = Math.SQRT1_2;
      const clip: SamplerClip = {
        duration: 2,
        tracks: [{ quats: [0, 0, halfSqrt, halfSqrt, 0, 0, halfSqrt, halfSqrt], times: [0, 1] }],
      };
      const palette = new Float32Array(2 * 16);

      sampler.sample(clip, 0.5, palette, 1);

      expect(zAngleDegrees(palette, 1)).toBeCloseTo(90, 3);
    });
  });
});
