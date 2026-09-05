import { describe, expect, it } from 'vitest';

import type { RenderBudget } from './budget';

import { DEFAULT_RENDER_BUDGET, resolveRenderBudget, sceneBytesPerPixel, sceneWorkingSetBytes } from './budget';

/**
 * What a device is allowed to change about a budget, and what it is not (201/9-05).
 *
 * The adaptivity this project permits is one number answered by the DEVICE — never a platform test and never
 * a look picked on somebody's behalf. These assertions pin both halves of that.
 */

const ASKED: RenderBudget = {
  ...DEFAULT_RENDER_BUDGET,
  bloomFormat: 'rg11b10ufloat',
  bloomMinLevelPx: 16,
  bloomPrefilterScale: 0.5,
};

describe('resolveRenderBudget', () => {
  describe('negative cases', () => {
    it('falls back to the wide format when the device cannot render the narrow one', () => {
      expect(resolveRenderBudget(ASKED, []).bloomFormat).toBe('rgba16float');
    });

    it('falls the SCENE format back the same way, since it is the same capability', () => {
      const asked = { ...ASKED, sceneFormat: 'rg11b10ufloat' } as const;

      expect(resolveRenderBudget(asked, []).sceneFormat).toBe('rgba16float');
    });

    it('never touches the look — the pyramid keeps the base and the floor it was asked for', () => {
      const resolved = resolveRenderBudget(ASKED, []);

      expect(resolved.bloomPrefilterScale).toBe(0.5);
      expect(resolved.bloomMinLevelPx).toBe(16);
      expect(resolved.sampleCount).toBe(ASKED.sampleCount);
    });
  });

  describe('positive cases', () => {
    it('grants the narrow format where the adapter renders it, phone or desk', () => {
      const resolved = resolveRenderBudget(ASKED, ['rg11b10ufloat-renderable', 'texture-compression-astc']);

      expect(resolved.bloomFormat).toBe('rg11b10ufloat');
    });

    it('leaves a budget that asks for nothing narrow exactly as it was', () => {
      expect(resolveRenderBudget(DEFAULT_RENDER_BUDGET, [])).toEqual(DEFAULT_RENDER_BUDGET);
    });
  });
});

describe('scene byte accounting', () => {
  describe('positive cases', () => {
    it('prices the narrow float format at four bytes, like the other 32-bit one', () => {
      expect(sceneBytesPerPixel('rg11b10ufloat')).toBe(4);
      expect(sceneBytesPerPixel('rgb10a2unorm')).toBe(4);
      expect(sceneBytesPerPixel('rgba16float')).toBe(8);
    });

    it('computes the tile working set from the format and the samples, never a literal', () => {
      expect(sceneWorkingSetBytes(DEFAULT_RENDER_BUDGET)).toBe(48);
      expect(sceneWorkingSetBytes({ ...DEFAULT_RENDER_BUDGET, sceneFormat: 'rg11b10ufloat' })).toBe(32);
      expect(sceneWorkingSetBytes({ ...DEFAULT_RENDER_BUDGET, sampleCount: 1 })).toBe(12);
    });
  });
});
