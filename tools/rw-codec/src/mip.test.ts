import { describe, expect, it } from 'vitest';

import { buildMipChain, downsample } from './mip';

describe('downsample', () => {
  describe('positive cases', () => {
    it('averages a 2×2 RGBA image to 1×1', () => {
      // four pixels: red, blue, green, white → channel averages.
      const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]);
      const out = downsample(rgba, 2, 2);
      expect(out.width).toBe(1);
      expect(out.height).toBe(1);
      expect([...out.data]).toEqual([128, 128, 128, 255]); // round((255+0+0+255)/4)=128 per channel
    });

    it('weights RGB by alpha — transparent texels never bleach the visible colour', () => {
      // One DARK GREEN opaque leaf texel + three fully-transparent WHITE background texels.
      const rgba = new Uint8Array([
        20,
        90,
        20,
        255, // leaf
        255,
        255,
        255,
        0, // background
        255,
        255,
        255,
        0,
        255,
        255,
        255,
        0,
      ]);
      const out = downsample(rgba, 2, 2);
      expect([...out.data.slice(0, 3)]).toEqual([20, 90, 20]); // colour = the leaf's, NOT washed to ~196
      expect(out.data[3]).toBe(64); // alpha still the plain average (255/4)
    });

    it('falls back to the plain average for a fully-transparent quad', () => {
      const rgba = new Uint8Array([10, 20, 30, 0, 30, 40, 50, 0, 50, 60, 70, 0, 70, 80, 90, 0]);
      const out = downsample(rgba, 2, 2);
      expect([...out.data]).toEqual([40, 50, 60, 0]);
    });

    it('halves each dimension (floored at 1)', () => {
      const out = downsample(new Uint8Array(8 * 1 * 4), 8, 1);
      expect([out.width, out.height]).toEqual([4, 1]);
    });
  });
});

describe('buildMipChain', () => {
  describe('positive cases', () => {
    it('produces every level down to 1×1', () => {
      const levels = buildMipChain(new Uint8Array(4 * 4 * 4), 4, 4);
      expect(levels.map((l) => [l.width, l.height])).toEqual([
        [4, 4],
        [2, 2],
        [1, 1],
      ]);
    });

    it('keeps the given buffer as the base level', () => {
      const base = new Uint8Array(2 * 2 * 4).fill(7);
      const levels = buildMipChain(base, 2, 2);
      expect(levels[0].data).toBe(base);
      expect(levels).toHaveLength(2); // 2×2, 1×1
    });
  });
});
