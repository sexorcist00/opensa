import { DEFAULT_RENDER_BUDGET } from '@opensa/engine';
import { describe, expect, it } from 'vitest';

import { captureBudget } from './capture-budget';

describe('captureBudget', () => {
  describe('negative cases', () => {
    it('is the default when neither parameter is present', () => {
      expect(captureBudget(new URLSearchParams(''))).toEqual(DEFAULT_RENDER_BUDGET);
    });

    it('refuses a sample count WebGPU does not have rather than picking a neighbouring one', () => {
      expect(captureBudget(new URLSearchParams('msaa=2')).sampleCount).toBe(4);
      expect(captureBudget(new URLSearchParams('msaa=0')).sampleCount).toBe(4);
      expect(captureBudget(new URLSearchParams('msaa=off')).sampleCount).toBe(4);
      expect(captureBudget(new URLSearchParams('msaa=')).sampleCount).toBe(4);
    });

    it('refuses a scene format the post chain cannot carry', () => {
      expect(captureBudget(new URLSearchParams('scene=bgra8unorm')).sceneFormat).toBe('rgba16float');
      expect(captureBudget(new URLSearchParams('scene=')).sceneFormat).toBe('rgba16float');
    });

    it('keeps the half that parsed when the other half does not', () => {
      expect(captureBudget(new URLSearchParams('msaa=1&scene=nonsense'))).toEqual({
        sampleCount: 1,
        sceneFormat: 'rgba16float',
      });
    });
  });

  describe('positive cases', () => {
    it('reads the sample arm — 12 bytes per pixel and no resolve', () => {
      expect(captureBudget(new URLSearchParams('msaa=1'))).toEqual({ sampleCount: 1, sceneFormat: 'rgba16float' });
    });

    it('reads the format arm — the anti-aliasing kept, the colour halved', () => {
      expect(captureBudget(new URLSearchParams('scene=rgb10a2unorm'))).toEqual({
        sampleCount: 4,
        sceneFormat: 'rgb10a2unorm',
      });
    });

    it('reads both beside the other capture knobs', () => {
      const params = new URLSearchParams('units=0&calls=0&inventory=1&surface=720x1218&msaa=1&scene=rgb10a2unorm');
      expect(captureBudget(params)).toEqual({ sampleCount: 1, sceneFormat: 'rgb10a2unorm' });
    });

    it('accepts the capitals a hand-typed link tends to carry', () => {
      expect(captureBudget(new URLSearchParams('scene=RGB10A2Unorm')).sceneFormat).toBe('rgb10a2unorm');
    });
  });
});
