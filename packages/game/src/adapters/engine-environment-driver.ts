/**
 * The ONE config→`Engine.environment` mapping for the own-engine hosts (plan 074/10 config-API parity):
 * the sun/moon arcs build DYNAMICALLY from the prod config's `night.litFade` window (exactly how the old
 * engine works — `sunElevationAt` is prod's own unit-tested arc), timecyc drives the colours when the pak
 * carries it (parametric fallback otherwise), and the prod graphics tunables (sky mood, cloud opacity,
 * moon brightness, godrays toggle, fog timecycScale, emissive boost) keep working after the flip.
 *
 * Renderer-agnostic: mutates the `Environment` object the engine exposes; no engine/three imports beyond
 * the Environment TYPE. Both hosts (the game's EngineCanvasHost and the engine lab) share this module.
 */
import type { Environment } from '@opensa/engine';

import { buildTimecyc, sampleTimecycBlend } from '@opensa/renderware/parsers/text/timecyc';
import { convertTo24h, parseTimecyc, WEATHER_NAMES } from '@opensa/renderware/parsers/text/timecyc.parser';

import { cloudProfile } from '../plugins/cloud-profile';
import { sunElevationAt } from '../plugins/sun-position';

/** The slice of the runtime Config this driver consumes (matches `game-runtime-config.ts` shapes). */
export interface EngineEnvConfig {
  fog: { timecycScale: number };
  graphics: {
    clouds: { opacity: number };
    moon: { brightness: number };
    night: {
      emissiveBoost: number;
      litFade: { dawnEnd: number; dawnStart: number; duskEnd: number; duskStart: number };
    };
    sky: { mood: number };
    sun: { godrays: boolean };
  };
}

/** Standalone defaults (the lab has no game config; values mirror `game-runtime-config.ts`). */
export const DEFAULT_ENGINE_ENV_CONFIG: EngineEnvConfig = {
  fog: { timecycScale: 1 },
  graphics: {
    clouds: { opacity: 0.85 },
    moon: { brightness: 1 },
    night: { emissiveBoost: 1.6, litFade: { dawnEnd: 7, dawnStart: 6, duskEnd: 20, duskStart: 19 } },
    sky: { mood: 0.7 },
    sun: { godrays: true },
  },
};

export interface EngineEnvironmentDriver {
  apply(hour: number): void;
}

export interface EngineEnvironmentOptions {
  config?: EngineEnvConfig;
  /** Extra multiplier on the timecyc fog distances (the lab's high camera needs `?fogscale=`). */
  fogScale?: number;
  /** Raw timecyc text from the pak manifest; colours go parametric when absent. */
  timecyc?: { is24h: boolean; text: string };
  /** SA weather id 0..19 (cloud profile + timecyc column). */
  weather?: number;
}

const lin = (value: number): number => (value / 255) ** 2.2;
const lin3 = (rgb: readonly number[]): [number, number, number] => [lin(rgb[0]), lin(rgb[1]), lin(rgb[2])];
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const scale3 = (rgb: readonly [number, number, number], k: number): [number, number, number] => [
  rgb[0] * k,
  rgb[1] * k,
  rgb[2] * k,
];

/** Build the driver; re-create it on weather change (the profile and timecyc column are per-weather). */
export function createEngineEnvironmentDriver(
  environment: Environment,
  options: EngineEnvironmentOptions = {},
): EngineEnvironmentDriver {
  const config = options.config ?? DEFAULT_ENGINE_ENV_CONFIG;
  const weather = options.weather ?? 0;
  const fogScale = (options.fogScale ?? 1) * config.fog.timecycScale;
  const timecyc = options.timecyc
    ? buildTimecyc(
        options.timecyc.is24h ? parseTimecyc(options.timecyc.text) : convertTo24h(parseTimecyc(options.timecyc.text)),
      )
    : null;
  const clouds = cloudProfile(WEATHER_NAMES[weather] ?? '');
  const { litFade } = config.graphics.night;

  return {
    apply(hour: number): void {
      const sun = sunArc(hour, litFade.dawnStart, litFade.duskEnd);
      const dn = darkness(hour, litFade);
      environment.hour = hour;
      environment.dn = dn;
      environment.sunDir = sun.dir;
      environment.sunElevation = clamp01(sun.elevationRatio);
      // The disc keeps its colour while sinking below the sea horizon (074/06 round 4), dies fully sunk.
      const dayGate = clamp01((sun.dir[1] + 0.05) * 5);
      environment.sunDirect = clamp01(sun.elevationRatio) * 0.9;
      environment.sunIndirect = 0.85 * (1 - dn) + 0.4 * dn;
      environment.skyMood = config.graphics.sky.mood;
      environment.emissiveBoost = config.graphics.night.emissiveBoost;
      environment.cloudCover = clouds.coverage;
      environment.cloudDark = clouds.darkness;
      environment.cloudAlpha = config.graphics.clouds.opacity;
      environment.godrayStrength = config.graphics.sun.godrays ? 1 : 0;
      if (timecyc) {
        const sample = sampleTimecycBlend(timecyc, weather, weather, hour, 0);
        environment.sunColor = scale3(lin3(sample.dir), dayGate);
        environment.sunCoreColor = scale3(lin3(sample.sunCore), dayGate);
        environment.sunCoronaColor = scale3(lin3(sample.sunCorona), dayGate);
        environment.sunSize = sample.sunSize;
        environment.skyTop = lin3(sample.skyTop);
        environment.skyHorizon = lin3(sample.skyBot);
        environment.fogStartDistance = Math.max(0, sample.fogStart * fogScale);
        environment.fogCutDistance = Math.max(sample.farClip * fogScale, 1200);
        // Water v1 (074/06 row 12): timecyc WaterRGBA — deep tint + opacity per hour/weather.
        environment.waterColor = lin3(sample.water);
        environment.waterAlpha = sample.water[3] / 255;
      } else {
        // Parametric fallback (old paks without timecyc): warm-shifting disc, fixed day/night gradients.
        const warm = clamp01(1 - sun.elevationRatio);
        environment.sunColor = [dayGate, (0.96 - warm * 0.15) * dayGate, (0.88 - warm * 0.3) * dayGate];
        environment.sunCoreColor = [dayGate, (0.95 - warm * 0.25) * dayGate, (0.68 - warm * 0.4) * dayGate];
        environment.sunCoronaColor = [dayGate, (0.8 - warm * 0.25) * dayGate, (0.4 - warm * 0.3) * dayGate];
        environment.skyTop = mix3([0.12, 0.32, 0.65], [0.002, 0.004, 0.012], dn);
        environment.skyHorizon = mix3([0.42, 0.55, 0.72], [0.01, 0.012, 0.03], dn);
      }
      applyMoon(environment, hour, dn, litFade, config.graphics.moon.brightness);
    },
  };
}

/** Moon arc over the dynamic night window (duskEnd → dawnStart): rises in the east, peaks mid-window,
 *  sets in the west; starts below the sea horizon so the shader's horizon clip shows a real moonrise. */
function applyMoon(
  environment: Environment,
  hour: number,
  dn: number,
  litFade: EngineEnvConfig['graphics']['night']['litFade'],
  brightness: number,
): void {
  const windowHours = 24 - litFade.duskEnd + litFade.dawnStart;
  const t = ((hour - litFade.duskEnd + 24) % 24) / windowHours;
  const arc = t <= 1 ? Math.sin(t * Math.PI) : 0;
  const elevation = -0.08 + arc * 0.7;
  environment.moonDir = [Math.cos(Math.min(1, Math.max(0, t)) * Math.PI) * 0.85, elevation, -0.4];
  const gate = dn * clamp01(elevation * 5) * brightness;
  environment.moonColor = [0.045 * gate, 0.06 * gate, 0.105 * gate];
}

/** litFade darkness: 0 by day, ramps duskStart→duskEnd, 1 at night, ramps back dawnStart→dawnEnd. */
function darkness(hour: number, litFade: EngineEnvConfig['graphics']['night']['litFade']): number {
  if (hour >= litFade.duskEnd || hour < litFade.dawnStart) {
    return 1;
  }
  if (hour >= litFade.duskStart) {
    return (hour - litFade.duskStart) / Math.max(0.01, litFade.duskEnd - litFade.duskStart);
  }
  if (hour < litFade.dawnEnd) {
    return 1 - (hour - litFade.dawnStart) / Math.max(0.01, litFade.dawnEnd - litFade.dawnStart);
  }

  return 0;
}

function mix3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Prod's `sunElevationAt` arc over the litFade window, EXTENDED past the edges so the disc sinks
 *  smoothly below the sea horizon (074/06 round 4) instead of vanishing at the window boundary. */
function sunArc(
  hour: number,
  sunrise: number,
  sunset: number,
): { dir: [number, number, number]; elevationRatio: number } {
  const margin = 0.75; // hours past the window during which the disc is still sinking/climbing
  if (hour <= sunrise - margin || hour >= sunset + margin) {
    return { dir: [0, -1, 0], elevationRatio: -1 };
  }
  const inside = sunElevationAt(Math.min(Math.max(hour, sunrise + 0.001), sunset - 0.001), sunrise, sunset);
  const t = (hour - sunrise) / (sunset - sunrise);
  // Outside the window the sine goes negative: keep the azimuth clamped, let the height sink to −0.25.
  const sinkY = Math.max(-0.25, Math.sin(t * Math.PI) * Math.sin((80 * Math.PI) / 180));
  const dir: [number, number, number] =
    t > 0 && t < 1 ? [inside.dir[0], inside.dir[1], inside.dir[2]] : [inside.dir[0], sinkY, inside.dir[2]];

  return { dir, elevationRatio: Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) };
}
