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
  });
});
