import { describe, expect, it } from 'vitest';

import {
  classifyAlpha,
  coverage,
  dilateEdges,
  downsample,
  effectiveAlphaClass,
  premultiply,
  preserveCoverage,
  processAlphaTexture,
  resampleToPow2,
} from './alpha';

/** 4×4 RGBA8: three columns opaque green, one transparent BLACK — the boundary straddles a mip texel
 *  (the alpha-edge disease in miniature). */
function leafPatch(): Uint8Array {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const at = (y * 4 + x) * 4;
      if (x < 3) {
        rgba.set([40, 200, 40, 255], at);
      } else {
        rgba.set([0, 0, 0, 0], at); // black transparent texels — the fringe source
      }
    }
  }

  return rgba;
}

describe('alpha pipeline', () => {
  describe('negative cases', () => {
    it('does not classify an opaque texture as cutout even when the flag lies', () => {
      const rgba = new Uint8Array(16 * 4).fill(255);

      expect(classifyAlpha(rgba, true)).toBe('opaque');
    });

    it('classifies soft gradients as softBlend, not cutout', () => {
      const rgba = new Uint8Array(64 * 4);
      for (let texel = 0; texel < 64; texel += 1) {
        rgba.set([100, 100, 100, texel * 4], texel * 4); // smooth alpha ramp
      }

      expect(classifyAlpha(rgba, true)).toBe('softBlend');
    });

    it('preserveCoverage is a no-op for a zero target', () => {
      const rgba = leafPatch();
      const before = [...rgba];
      preserveCoverage(rgba, 128, 0);

      expect([...rgba]).toEqual(before);
    });

    it('effectiveAlphaClass never upgrades opaque/cutout or an unrequested softBlend', () => {
      expect(effectiveAlphaClass('opaque', true)).toBe('opaque');
      expect(effectiveAlphaClass('cutout', true)).toBe('cutout');
      expect(effectiveAlphaClass('softBlend', false)).toBe('softBlend');
    });
  });

  describe('positive cases', () => {
    it('effectiveAlphaClass upgrades softBlend to cutout for vegetation callers (trees-through-trees fix)', () => {
      expect(effectiveAlphaClass('softBlend', true)).toBe('cutout');
    });

    it('classifies a hard-edged leaf texture as cutout', () => {
      expect(classifyAlpha(leafPatch(), true)).toBe('cutout');
    });

    it('dilation floods transparent texels with the nearest opaque RGB (no black left)', () => {
      const rgba = leafPatch();
      dilateEdges(rgba, 4, 4);

      // Every texel now carries leaf RGB; alpha untouched.
      for (let texel = 0; texel < 16; texel += 1) {
        expect(rgba[texel * 4 + 1]).toBe(200);
      }
      expect(rgba[3 * 4 + 3]).toBe(0); // transparency preserved
    });

    it('premultiplied downsample keeps edges un-darkened (THE fringe fix)', () => {
      const rgba = leafPatch();
      dilateEdges(rgba, 4, 4);
      premultiply(rgba);
      const mip = downsample(rgba, 4, 4);

      // The edge texel averages opaque(green×1) with transparent(0 premult): rgb stays proportional to
      // alpha — un-premultiplying yields the ORIGINAL green, not a darkened one.
      const edgeAlpha = mip[(0 * 2 + 1) * 4 + 3];
      const edgeGreen = mip[(0 * 2 + 1) * 4 + 1];
      expect(edgeAlpha).toBeGreaterThan(0);
      expect(edgeAlpha).toBeLessThan(255);
      expect(Math.round((edgeGreen / edgeAlpha) * 255)).toBeGreaterThanOrEqual(199);
    });

    it('coverage preservation keeps the cutout ratio across mips', () => {
      const rgba = leafPatch();
      dilateEdges(rgba, 4, 4);
      premultiply(rgba);
      const target = coverage(rgba, 128);
      const mip = downsample(rgba, 4, 4);
      preserveCoverage(mip, 128, target);

      expect(coverage(mip, 128)).toBeGreaterThanOrEqual(target - 0.26);
    });

    it('processAlphaTexture emits the full requested chain', () => {
      const mips = processAlphaTexture(leafPatch(), 4, 4, 'cutout', 128, 3);

      expect(mips).toHaveLength(3);
      expect(mips[1]).toHaveLength(2 * 2 * 4);
      expect(mips[2]).toHaveLength(1 * 1 * 4);
    });

    it('resampleToPow2 fixes 62×62-style sizes (the WebGPU BC alignment killer)', () => {
      const rgba = new Uint8Array(62 * 62 * 4).fill(128);
      const sized = resampleToPow2(rgba, 62, 62);

      expect(sized.width).toBe(64);
      expect(sized.height).toBe(64);
      expect(sized.rgba[0]).toBe(128);
    });
  });
});
