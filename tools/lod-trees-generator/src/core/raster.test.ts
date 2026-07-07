import { describe, expect, it } from 'vitest';

import type { DecodedTexture, Rgba } from './types';

import { createRaster, rasterizeTriangle, type RasterTri } from './raster';

/** A triangle covering the whole 4×4 raster, uniform vertex colour. */
function fullTri(color: null | Rgba): RasterTri {
  return {
    colors: color ? [color, color, color] : null,
    pixels: [
      [-4, -4, 0],
      [12, -4, 0],
      [0, 12, 0],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  };
}

/** A 1×1 texture of the given colour. */
function texture(rgba: Rgba): DecodedTexture {
  return { hasAlpha: rgba[3] < 255, height: 1, rgba: new Uint8Array(rgba), width: 1 };
}

describe('rasterizeTriangle normalized dual-convention blending (plan 012)', () => {
  describe('negative cases', () => {
    it('drops fragments below the alpha test', () => {
      const raster = createRaster(4, 4);
      rasterizeTriangle(raster, fullTri(null), texture([200, 200, 200, 60]), 0.5);

      expect(raster.color[3]).toBe(0); // nothing written
      expect(raster.colorLinear[3]).toBe(0);
    });

    it('keeps alpha a plain product in BOTH buffers (coverage is not gamma-encoded)', () => {
      const raster = createRaster(4, 4);
      rasterizeTriangle(raster, fullTri([255, 255, 255, 128]), texture([255, 255, 255, 255]), 0.1);

      expect(raster.color[3]).toBe(128);
      expect(raster.colorLinear[3]).toBe(128);
    });
  });

  describe('positive cases', () => {
    it('normalization identity: prelit equal to the day average leaves the texture untouched in BOTH conventions', () => {
      // THE plan-012 invariant: the mean lighting level rides the card VERTICES, so a vertex at exactly the
      // average contributes factor 1 — the atlas texel equals the source texel under any renderer pipeline.
      const raster = createRaster(4, 4);
      rasterizeTriangle(raster, fullTri([86, 86, 86, 255]), texture([97, 134, 51, 255]), 0.5, [86, 86, 86, 255]);

      expect([raster.color[0], raster.color[1], raster.color[2]]).toEqual([97, 134, 51]);
      expect([raster.colorLinear[0], raster.colorLinear[1], raster.colorLinear[2]]).toEqual([97, 134, 51]);
    });

    it('encodes the variation per convention: gamma = byte product, linear = linear-light product', () => {
      // Prelit at HALF the normalization average (factor 0.5) on a white texture:
      // real SA (gamma pipeline) shows byte products → 128; OpenSA (linear pipeline) needs lin2srgb(0.5) = 188.
      const raster = createRaster(4, 4);
      rasterizeTriangle(raster, fullTri([64, 64, 64, 255]), texture([255, 255, 255, 255]), 0.5, [128, 128, 128, 255]);

      expect(raster.color[0]).toBe(128);
      expect(raster.colorLinear[0]).toBe(188);
    });

    it('clamps above-average prelit instead of wrapping (gamma bytes cap at 255)', () => {
      const raster = createRaster(4, 4);
      rasterizeTriangle(
        raster,
        fullTri([255, 255, 255, 255]),
        texture([200, 200, 200, 255]),
        0.5,
        [128, 128, 128, 255],
      );

      expect(raster.color[0]).toBe(255); // 200 × 2 clamped
      expect(raster.colorLinear[0]).toBe(255);
    });

    it('defaults to the un-normalized product when no average is given (source without prelit)', () => {
      // The field case that exposed the bug: tex 97 × prelit 86 → 33 in gamma bytes, 57 in linear light.
      const raster = createRaster(4, 4);
      rasterizeTriangle(raster, fullTri([86, 86, 86, 255]), texture([97, 97, 97, 255]), 0.5);

      expect(raster.color[0]).toBe(33);
      expect(raster.colorLinear[0]).toBeGreaterThanOrEqual(56);
      expect(raster.colorLinear[0]).toBeLessThanOrEqual(58);
    });
  });
});
