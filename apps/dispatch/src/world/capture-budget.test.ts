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

    it('refuses a bloom scale that is not a halving of the pyramid', () => {
      expect(captureBudget(new URLSearchParams('bloomscale=0.75')).bloomPrefilterScale).toBe(1);
      expect(captureBudget(new URLSearchParams('bloomscale=0')).bloomPrefilterScale).toBe(1);
      expect(captureBudget(new URLSearchParams('bloomscale=half')).bloomPrefilterScale).toBe(1);
      // The vendor arms refuse an unreadable value the same way: an arm that silently ran as the default is
      // a measurement of the default filed under another name.
      expect(captureBudget(new URLSearchParams('bloomdown=dual')).bloomDownsample).toBe('box13');
      expect(captureBudget(new URLSearchParams('bloomdown=kawase')).bloomDownsample).toBe('box13');
      expect(captureBudget(new URLSearchParams('postprec=half')).postPrecision).toBe('f32');
      expect(captureBudget(new URLSearchParams('postprec=16')).postPrecision).toBe('f32');
    });

    it('refuses a level floor the chain cannot respect', () => {
      expect(captureBudget(new URLSearchParams('bloomminpx=0')).bloomMinLevelPx).toBe(1);
      expect(captureBudget(new URLSearchParams('bloomminpx=1024')).bloomMinLevelPx).toBe(1);
      expect(captureBudget(new URLSearchParams('bloomminpx=8.5')).bloomMinLevelPx).toBe(1);
    });

    it('keeps the half that parsed when the other half does not', () => {
      expect(captureBudget(new URLSearchParams('msaa=1&scene=nonsense'))).toEqual({
        ...DEFAULT_RENDER_BUDGET,
        sampleCount: 1,
        sceneFormat: 'rgba16float',
      });
    });
  });

  describe('positive cases', () => {
    it('reads the sample arm — 12 bytes per pixel and no resolve', () => {
      expect(captureBudget(new URLSearchParams('msaa=1'))).toEqual({
        ...DEFAULT_RENDER_BUDGET,
        sampleCount: 1,
        sceneFormat: 'rgba16float',
      });
    });

    it('reads the format arm — the anti-aliasing kept, the colour halved', () => {
      expect(captureBudget(new URLSearchParams('scene=rgb10a2unorm'))).toEqual({
        ...DEFAULT_RENDER_BUDGET,
        sampleCount: 4,
        sceneFormat: 'rgb10a2unorm',
      });
    });

    it('reads both beside the other capture knobs', () => {
      const params = new URLSearchParams('units=0&calls=0&inventory=1&surface=720x1218&msaa=1&scene=rgb10a2unorm');
      expect(captureBudget(params)).toEqual({
        ...DEFAULT_RENDER_BUDGET,
        sampleCount: 1,
        sceneFormat: 'rgb10a2unorm',
      });
    });

    it('accepts the capitals a hand-typed link tends to carry', () => {
      expect(captureBudget(new URLSearchParams('scene=RGB10A2Unorm')).sceneFormat).toBe('rgb10a2unorm');
    });

    it('reads the post chain arms — the format, the base of the pyramid, its floor and the vendor levers', () => {
      const params = new URLSearchParams(
        'bloomformat=rg11b10ufloat&bloomscale=0.5&bloomminpx=16&bloomdown=dual5&postprec=f16',
      );
      expect(captureBudget(params)).toEqual({
        ...DEFAULT_RENDER_BUDGET,
        bloomDownsample: 'dual5',
        bloomFormat: 'rg11b10ufloat',
        bloomMinLevelPx: 16,
        bloomPrefilterScale: 0.5,
        postPrecision: 'f16',
      });
    });

    it('reads each vendor lever on its own, so an arm can carry exactly one of them', () => {
      expect(captureBudget(new URLSearchParams('bloomdown=dual5'))).toEqual({
        ...DEFAULT_RENDER_BUDGET,
        bloomDownsample: 'dual5',
      });
      expect(captureBudget(new URLSearchParams('postprec=f16'))).toEqual({
        ...DEFAULT_RENDER_BUDGET,
        postPrecision: 'f16',
      });
    });

    it('overrides only what it names, keeping the rest of the base a surface asked for', () => {
      const base = { ...DEFAULT_RENDER_BUDGET, bloomFormat: 'rg11b10ufloat', bloomMinLevelPx: 16 } as const;

      expect(captureBudget(new URLSearchParams('bloomscale=0.5'), base)).toEqual({ ...base, bloomPrefilterScale: 0.5 });
    });
  });
});
