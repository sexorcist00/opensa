import { Scene } from 'three';
import { describe, expect, it } from 'vitest';

import type { NightConfig } from '../interfaces/config.interface';

import { SkyLiteSystem } from './sky-lite.system';
import { SKY_LIGHT_TUNING, type SkySample } from './sky.plugin';

const NIGHT_CONFIG: NightConfig = {
  coronaDrawDistance: 120,
  dynamicObjectsFill: { rim: 0.1, strength: 0.8 },
  emissiveBoost: 1.6,
  litFade: { dawnEnd: 7, dawnStart: 6, duskEnd: 20, duskStart: 19 },
  skyGlow: 1,
  skylight: 0.6,
  windowGlow: 1,
};

const SAMPLE: SkySample = {
  amb: [20, 20, 25],
  ambObj: [180, 160, 140],
  cloudAlpha: 128,
  cloudBottom: [90, 90, 100],
  cloudCover: 0.5,
  cloudDark: 0.3,
  cloudTop: [230, 230, 240],
  dir: [255, 240, 220],
  farClip: 800,
  fogStart: 300,
  skyBot: [140, 170, 200],
  skyTop: [60, 110, 180],
  spriteBright: 1,
  spriteSize: 1,
  sunCore: [255, 250, 240],
  sunCorona: [255, 200, 150],
  sunSize: 1,
};

function makeSystem(hour: number): SkyLiteSystem {
  return new SkyLiteSystem(
    () => SAMPLE,
    () => hour,
    () => NIGHT_CONFIG,
    () => 5,
  );
}

describe('SkyLiteSystem', () => {
  describe('negative cases', () => {
    it('does not cast shadows (r185: a never-rendered castShadow map drops lit receiveShadow draws)', () => {
      const system = makeSystem(12);

      system.update();

      expect(system.sun.castShadow).toBe(false);
    });

    it('turns the sun off below the horizon', () => {
      const system = makeSystem(0);

      system.update();

      expect(system.sun.intensity).toBe(0);
      expect(system.nightFactor()).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('adds the full light rig to the scene', () => {
      const system = makeSystem(12);
      const scene = new Scene();

      system.addTo(scene);

      expect(scene.children).toContain(system.ambient);
      expect(scene.children).toContain(system.skylight);
      expect(scene.children).toContain(system.sun);
    });

    it('drives full daylight at noon', () => {
      const system = makeSystem(13);

      system.update();

      expect(system.nightFactor()).toBe(0);
      expect(system.sun.intensity).toBeCloseTo(SKY_LIGHT_TUNING.sunIntensity, 1);
      expect(system.ambient.intensity).toBeCloseTo(SKY_LIGHT_TUNING.ambientDay, 5);
      expect(system.skylight.intensity).toBeCloseTo(SKY_LIGHT_TUNING.daySkylight, 5);
      const dir = system.sunDirection();
      expect(dir.length()).toBeCloseTo(1, 5);
      expect(dir.y).toBeGreaterThan(0.9);
    });

    it('tracks the moon at the SkyPlugin fixed azimuth and config elevation', () => {
      const system = makeSystem(0);

      system.update();

      const moon = system.moonDirection();
      expect(moon.length()).toBeCloseTo(1, 5);
      expect(moon.y).toBeCloseTo(Math.sin((5 * Math.PI) / 180), 3);
      expect(moon.x).toBeGreaterThan(0); // MOON_AZIMUTH (0.35, 0, 0.4) quadrant
      expect(moon.z).toBeGreaterThan(0);
    });

    it('cross-fades ambient and skylight to the night rig at midnight', () => {
      const system = makeSystem(0);

      system.update();

      expect(system.ambient.intensity).toBeCloseTo(SKY_LIGHT_TUNING.ambientNight, 5);
      expect(system.skylight.intensity).toBeCloseTo(NIGHT_CONFIG.skylight, 5);
      expect(system.skylight.color.getHex()).toBe(SKY_LIGHT_TUNING.nightSkyColor.getHex());
    });
  });
});
