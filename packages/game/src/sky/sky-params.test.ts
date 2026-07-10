import { describe, expect, it } from 'vitest';

import { pbrSkyParams } from './sky-params';

const CLEAR_NOON = {
  cloudCover: 0,
  cloudDark: 0,
  mood: 0.5,
  skyTop: [60, 120, 230] as const,
  sunElevation: 1,
};

describe('pbrSkyParams', () => {
  describe('negative cases', () => {
    it('kills the sun input at and below the horizon', () => {
      const { sunE } = pbrSkyParams({ ...CLEAR_NOON, sunElevation: 0 });
      expect(sunE).toBeLessThan(pbrSkyParams(CLEAR_NOON).sunE * 0.35);
    });

    it('mood 0 leaves the physical sky untinted (white)', () => {
      const { tint } = pbrSkyParams({ ...CLEAR_NOON, mood: 0 });
      expect(tint).toEqual([1, 1, 1]);
    });

    it('clamps out-of-range covers', () => {
      expect(pbrSkyParams({ ...CLEAR_NOON, cloudCover: 5 })).toEqual(pbrSkyParams({ ...CLEAR_NOON, cloudCover: 1 }));
    });
  });

  describe('positive cases', () => {
    it('foggy/overcast weather is far hazier than a clear day (Mie grows)', () => {
      const clear = pbrSkyParams(CLEAR_NOON);
      const foggy = pbrSkyParams({ ...CLEAR_NOON, cloudCover: 1, cloudDark: 1 });
      expect(foggy.betaM[0]).toBeGreaterThan(clear.betaM[0] * 3);
    });

    it('a horizon sun scatters more Rayleigh (redder dusks)', () => {
      const noon = pbrSkyParams(CLEAR_NOON);
      const dusk = pbrSkyParams({ ...CLEAR_NOON, sunElevation: 0.05 });
      expect(dusk.betaR[0]).toBeGreaterThan(noon.betaR[0]);
    });

    it('the mood tint recolours toward the timecyc hue without darkening the max channel', () => {
      const { tint } = pbrSkyParams({ ...CLEAR_NOON, mood: 1 });
      expect(tint[2]).toBe(1); // blue is skyTop's max channel → untouched
      expect(tint[0]).toBeLessThan(tint[1]); // red pulled down harder than green (SA blue sky)
    });

    it('is continuous in cloud cover (weather blends must not pop)', () => {
      const at = (cloudCover: number): number => pbrSkyParams({ ...CLEAR_NOON, cloudCover }).betaM[0];
      // quadratic in cover (turbidity × mie both grow) — assert no jump, not linearity
      expect(Math.abs(at(0.501) - at(0.5))).toBeLessThan(at(0.5) * 0.01);
    });
  });
});
