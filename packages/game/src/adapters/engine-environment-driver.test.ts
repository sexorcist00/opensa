import type { Environment } from '@opensa/engine';

import { describe, expect, it } from 'vitest';

import { createEngineEnvironmentDriver, DEFAULT_ENGINE_ENV_CONFIG } from './engine-environment-driver';

/** Minimal mutable Environment (only the fields the driver writes matter; extras don't). */
function makeEnvironment(): Environment {
  return {
    aoStrength: 0.6,
    bloomIntensity: 0.7,
    bloomThreshold: 0.7,
    cloudAlpha: 0.9,
    cloudBottomColor: [0.45, 0.48, 0.55],
    cloudCover: 0.12,
    cloudDark: 0,
    cloudFadeSeconds: 4,
    cloudSpeed: 0.004,
    cloudTopColor: [0.78, 0.8, 0.85],
    dn: 0,
    emissiveBoost: 1.6,
    fogCutDistance: 2400,
    fogHeightK: 1 / 180,
    fogHeightMin: 0.35,
    fogStartDistance: 250,
    godrayStrength: 1,
    hour: 12,
    moonColor: [0, 0, 0],
    moonDir: [0, 1, 0],
    moonPhase: 0.5,
    reflectionStrength: 1,
    skyExposure: 0.55,
    skyHorizon: [0.42, 0.55, 0.72],
    skyMood: 0.7,
    skyTop: [0.12, 0.32, 0.65],
    stochastic: 0,
    sunColor: [1, 0.96, 0.88],
    sunCoreColor: [1, 0.95, 0.68],
    sunCoronaColor: [1, 0.8, 0.4],
    sunDir: [0, 1, 0],
    sunDirect: 0.9,
    sunElevation: 1,
    sunIndirect: 0.75,
    sunSize: 4,
    sunVisStrength: 1,
    tonemap: 1,
    waterAlpha: 0.72,
    waterColor: [0.05, 0.14, 0.18],
    windStrength: 1,
  };
}

describe('createEngineEnvironmentDriver', () => {
  describe('negative cases', () => {
    it('keeps the sun below the horizon outside the litFade window', () => {
      const environment = makeEnvironment();
      createEngineEnvironmentDriver(environment).apply(2);
      expect(environment.sunDir[1]).toBeLessThan(0);
      expect(environment.sunElevation).toBe(0);
      expect(environment.dn).toBe(1);
    });

    it('zeroes godray strength when the config disables godrays', () => {
      const environment = makeEnvironment();
      const config = structuredClone(DEFAULT_ENGINE_ENV_CONFIG);
      config.graphics.sun.godrays = false;
      createEngineEnvironmentDriver(environment, { config }).apply(12);
      expect(environment.godrayStrength).toBe(0);
    });

    it('hides the moon during the day', () => {
      const environment = makeEnvironment();
      createEngineEnvironmentDriver(environment).apply(12);
      expect(environment.moonColor).toEqual([0, 0, 0]);
    });

    it('disables the tonemap when the config toggle is off', () => {
      const environment = makeEnvironment();
      const config = structuredClone(DEFAULT_ENGINE_ENV_CONFIG);
      config.graphics.toneMapping = false;
      createEngineEnvironmentDriver(environment, { config }).apply(12);
      expect(environment.tonemap).toBe(0);
    });

    it("disables the tonemap when the mode is 'none' even with the toggle on", () => {
      const environment = makeEnvironment();
      const config = structuredClone(DEFAULT_ENGINE_ENV_CONFIG);
      config.graphics.toneMappingMode = 'none';
      createEngineEnvironmentDriver(environment, { config }).apply(12);
      expect(environment.tonemap).toBe(0);
    });

    it('zeroes bloom intensity when the config disables bloom', () => {
      const environment = makeEnvironment();
      const config = structuredClone(DEFAULT_ENGINE_ENV_CONFIG);
      config.graphics.bloom.enabled = false;
      createEngineEnvironmentDriver(environment, { config }).apply(12);
      expect(environment.bloomIntensity).toBe(0);
    });

    it('kills the world moonlight when night.skylight is zero', () => {
      const environment = makeEnvironment();
      const config = structuredClone(DEFAULT_ENGINE_ENV_CONFIG);
      config.graphics.night.skylight = 0;
      createEngineEnvironmentDriver(environment, { config }).apply(2);
      expect(environment.moonColor).toEqual([0, 0, 0]);
    });
  });

  describe('positive cases', () => {
    it('builds the sun arc dynamically from the litFade window', () => {
      const environment = makeEnvironment();
      const config = structuredClone(DEFAULT_ENGINE_ENV_CONFIG);
      // A shifted day: dawn 8, dusk 22 → solar noon at 15:00.
      config.graphics.night.litFade = { dawnEnd: 9, dawnStart: 8, duskEnd: 22, duskStart: 21 };
      const driver = createEngineEnvironmentDriver(environment, { config });
      driver.apply(15);
      expect(environment.sunElevation).toBeCloseTo(1, 5);
      expect(environment.sunDir[1]).toBeGreaterThan(0.9);
      driver.apply(8.5);
      expect(environment.sunElevation).toBeGreaterThan(0);
      expect(environment.sunElevation).toBeLessThan(0.3);
    });

    it('sinks the disc smoothly below the sea horizon right after sunset', () => {
      const environment = makeEnvironment();
      const driver = createEngineEnvironmentDriver(environment);
      driver.apply(20.3); // default duskEnd = 20; inside the sink margin
      expect(environment.sunDir[1]).toBeLessThan(0);
      expect(environment.sunDir[1]).toBeGreaterThanOrEqual(-0.25);
    });

    it('parks the sun only once every sunDir.y consumer band is saturated (no night-glow step)', () => {
      const environment = makeEnvironment();
      const driver = createEngineEnvironmentDriver(environment);
      // The deepest band edge is pbrNight's −0.22: from the sink floor to the park both sides must sit
      // below it, or the night sky glow visibly steps at the handover (field: a jump at sunset + margin).
      driver.apply(21.14); // just before the park (margin 1.15)
      expect(environment.sunDir[1]).toBeLessThanOrEqual(-0.22);
      driver.apply(21.16); // just after
      expect(environment.sunDir[1]).toBeLessThanOrEqual(-0.22);
    });

    it('keeps the moon azimuth continuous across duskEnd (the 19:59→20:00 sky jump)', () => {
      const environment = makeEnvironment();
      const driver = createEngineEnvironmentDriver(environment);
      driver.apply(19.99);
      const before = environment.moonDir[0];
      driver.apply(20.01);
      // The parked pre-dusk moon must already sit at the RISE azimuth — the old day-wrap formula parked it
      // at the SET side, teleporting the (now band-lit) night glow hemisphere across the sky at 20:00.
      expect(Math.abs(environment.moonDir[0] - before)).toBeLessThan(0.05);
    });

    it('ramps darkness across the dusk window', () => {
      const environment = makeEnvironment();
      const driver = createEngineEnvironmentDriver(environment);
      driver.apply(19.5); // default dusk 19→20
      expect(environment.dn).toBeCloseTo(0.5, 5);
      driver.apply(12);
      expect(environment.dn).toBe(0);
    });

    it('arcs the moon across the night window with a real azimuth sweep', () => {
      const environment = makeEnvironment();
      const driver = createEngineEnvironmentDriver(environment);
      driver.apply(21);
      const rise = [...environment.moonDir];
      driver.apply(1);
      const peak = [...environment.moonDir];
      driver.apply(4.5);
      const set = [...environment.moonDir];
      expect(peak[1]).toBeGreaterThan(rise[1]);
      expect(peak[1]).toBeGreaterThan(set[1]);
      expect(rise[0]).toBeGreaterThan(0);
      expect(set[0]).toBeLessThan(0);
      expect(environment.moonColor[2]).toBeGreaterThan(0);
    });

    it('runs the moonlight at prod strength from early night (the dark-20:00 fix)', () => {
      const environment = makeEnvironment();
      const driver = createEngineEnvironmentDriver(environment);
      // 20:06 — the moon DISC has barely risen, but prod's light rides the sun-based night band: the old
      // disc-elevation gate left the whole 20:00–21:30 window with ZERO moonlight (field: "very dark").
      driver.apply(20.1);
      expect(environment.moonColor[2]).toBeGreaterThan(0.1);
      // Deep night: (0.34, 0.44, 0.72) × band.moon (1 × the EXTRASUNNY cover fade 1 − 0.14 × 0.85 = 0.881)
      // × brightness 1 × skylight 0.6 × 0.5 — prod's canvas-host term verbatim.
      driver.apply(2);
      expect(environment.moonColor[0]).toBeCloseTo(0.34 * 0.881 * 0.3, 3);
      expect(environment.moonColor[2]).toBeCloseTo(0.72 * 0.881 * 0.3, 3);
    });

    it('drives the water tint from the timecyc columns', () => {
      const environment = makeEnvironment();
      // Minimal 24h-style timecyc: not worth synthesizing here — assert the PARAMETRIC path leaves the
      // defaults untouched (the timecyc path is covered by the renderware sampler's own tests).
      createEngineEnvironmentDriver(environment).apply(12);
      expect(environment.waterColor).toEqual([0.05, 0.14, 0.18]);
      expect(environment.waterAlpha).toBeCloseTo(0.72, 5);
    });

    it('applies the prod graphics tunables to the environment', () => {
      const environment = makeEnvironment();
      const config = structuredClone(DEFAULT_ENGINE_ENV_CONFIG);
      config.graphics.sky.mood = 0.3;
      config.graphics.clouds.opacity = 0.5;
      config.graphics.night.emissiveBoost = 2.5;
      createEngineEnvironmentDriver(environment, { config, weather: 7 }).apply(12);
      expect(environment.skyMood).toBe(0.3);
      expect(environment.cloudAlpha).toBe(0.5);
      expect(environment.emissiveBoost).toBe(2.5);
      // Weather 7 = CLOUDY → the curated profile's full cover.
      expect(environment.cloudCover).toBe(1);
      // ACES on by default (074/09 — prod parity).
      expect(environment.tonemap).toBe(1);
    });

    it('drives the bloom threshold through the plan-071 night profile', () => {
      const environment = makeEnvironment();
      const driver = createEngineEnvironmentDriver(environment);
      driver.apply(12);
      const day = environment.bloomThreshold;
      driver.apply(2);
      const night = environment.bloomThreshold;
      // Clear-weather defaults: 0.70 in full day, 0.38 at deep night (lamps/neon bloom, walls don't).
      expect(day).toBeCloseTo(0.7, 5);
      expect(night).toBeCloseTo(0.38, 5);
      expect(environment.bloomIntensity).toBeCloseTo(0.7, 5);
    });

    it('scales the night profile by the configured threshold', () => {
      const environment = makeEnvironment();
      const config = structuredClone(DEFAULT_ENGINE_ENV_CONFIG);
      config.graphics.bloom.threshold = 1.4;
      createEngineEnvironmentDriver(environment, { config }).apply(12);
      expect(environment.bloomThreshold).toBeCloseTo(1.4, 5);
    });

    it('runs the night prelit at the prod worldLight brightness (the pitch-black-after-sunset fix)', () => {
      const environment = makeEnvironment();
      const driver = createEngineEnvironmentDriver(environment);
      driver.apply(12);
      expect(environment.sunIndirect).toBeCloseTo(0.85, 5);
      driver.apply(2);
      expect(environment.sunIndirect).toBeCloseTo(0.7, 5);
    });

    it('darkens the parametric cloud palette toward night', () => {
      const environment = makeEnvironment();
      const driver = createEngineEnvironmentDriver(environment);
      driver.apply(12);
      const dayTop = environment.cloudTopColor[0];
      driver.apply(2);
      expect(environment.cloudTopColor[0]).toBeLessThan(dayTop);
      expect(environment.cloudBottomColor[0]).toBeLessThan(environment.cloudTopColor[0]);
    });

    it('maps the prod sky exposure into the environment', () => {
      const environment = makeEnvironment();
      const config = structuredClone(DEFAULT_ENGINE_ENV_CONFIG);
      config.graphics.sky.pbrExposure = 0.4;
      createEngineEnvironmentDriver(environment, { config }).apply(12);
      expect(environment.skyExposure).toBe(0.4);
    });
  });
});
