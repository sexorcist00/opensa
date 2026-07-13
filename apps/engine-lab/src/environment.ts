/**
 * Environment drive (plan 074/06 row 14): REAL timecyc sampling — the same renderware parser/blend prod uses —
 * mapped onto `Engine.environment`. The sun ELEVATION stays a parametric arc (SA stores no sun position in
 * timecyc; the game computes it — same approach here). Colours convert sRGB(0-255) → linear.
 */
import type { Engine } from '@opensa/engine';

import { cloudProfile } from '@opensa/game/plugins/cloud-profile';
import { buildTimecyc, sampleTimecycBlend } from '@opensa/renderware/parsers/text/timecyc';
import { convertTo24h, parseTimecyc, WEATHER_NAMES } from '@opensa/renderware/parsers/text/timecyc.parser';

export interface EnvironmentDriver {
  apply(hour: number): void;
}

const lin = (value: number): number => (value / 255) ** 2.2;
const lin3 = (rgb: readonly number[]): [number, number, number] => [lin(rgb[0]), lin(rgb[1]), lin(rgb[2])];

/** Fallback parametric arc (no timecyc in the manifest — old paks). */
export function parametricDriver(engine: Engine): EnvironmentDriver {
  return {
    apply(hour: number): void {
      const { dn, elevation } = sunArc(hour);
      engine.environment.hour = hour;
      engine.environment.dn = dn;
      // TRUE east→west arc (field fix: the sun used to rise and set at the same azimuth): x sweeps
      // −1 (sunrise) → 0 (noon, near-zenith) → +1 (sunset); the small z tilt shrinks toward noon.
      // MIRRORS the sun-vis bake arc (074/07) — change one, change both.
      const azScale = 1 - 0.75 * Math.max(0, Math.min(1, elevation));
      const azX = -Math.cos(((Math.max(6, Math.min(18, hour)) - 6) / 12) * Math.PI);
      engine.environment.sunDir = [azX, Math.max(-0.25, elevation), 0.25 * azScale];
      engine.environment.sunElevation = Math.max(0, Math.min(1, elevation));
      const warm = Math.min(1, Math.max(0, 1 - elevation));
      const dayGate = Math.min(1, Math.max(0, (elevation + 0.05) * 5)); // disc glows until it fully sinks
      engine.environment.sunColor = [dayGate, (0.96 - warm * 0.15) * dayGate, (0.88 - warm * 0.3) * dayGate];
      // Parametric disc: yellow core warming to orange at low sun (timecyc drives this in stream mode).
      engine.environment.sunCoreColor = [dayGate, (0.95 - warm * 0.25) * dayGate, (0.68 - warm * 0.4) * dayGate];
      engine.environment.sunCoronaColor = [dayGate, (0.8 - warm * 0.25) * dayGate, (0.4 - warm * 0.3) * dayGate];
      engine.environment.sunDirect = Math.max(0, elevation) * 0.9;
      engine.environment.sunIndirect = 0.75 * (1 - dn) + 0.35 * dn;
      engine.environment.skyTop = mix3([0.12, 0.32, 0.65], [0.002, 0.004, 0.012], dn);
      engine.environment.skyHorizon = mix3([0.42, 0.55, 0.72], [0.01, 0.012, 0.03], dn);
      applyMoon(engine, hour, dn);
    },
  };
}

/** The real thing: timecyc colours + fog ranges per hour/weather. */
export function timecycDriver(
  engine: Engine,
  timecycText: string,
  is24h: boolean,
  weather: number,
  fogScale = 2.5,
): EnvironmentDriver {
  const rows = parseTimecyc(timecycText);
  const timecyc = buildTimecyc(is24h ? rows : convertTo24h(rows));
  // Per-weather cloud look (row 15): prod's curated profiles keyed by weather NAME — raw timecyc
  // cloudAlpha is noisy (EXTRASUNNY still reads cloudy). Drives the LUT haze + storm darkening; the dome
  // textures themselves already differ per weather.
  const clouds = cloudProfile(WEATHER_NAMES[weather] ?? '');

  return {
    apply(hour: number): void {
      const sample = sampleTimecycBlend(timecyc, weather, weather, hour, 0);
      engine.environment.cloudCover = clouds.coverage;
      engine.environment.cloudDark = clouds.darkness;
      const { dn, elevation } = sunArc(hour);
      engine.environment.hour = hour;
      engine.environment.dn = dn;
      // TRUE east→west arc (field fix: the sun used to rise and set at the same azimuth): x sweeps
      // −1 (sunrise) → 0 (noon, near-zenith) → +1 (sunset); the small z tilt shrinks toward noon.
      // MIRRORS the sun-vis bake arc (074/07) — change one, change both.
      const azScale = 1 - 0.75 * Math.max(0, Math.min(1, elevation));
      const azX = -Math.cos(((Math.max(6, Math.min(18, hour)) - 6) / 12) * Math.PI);
      engine.environment.sunDir = [azX, Math.max(-0.25, elevation), 0.25 * azScale];
      engine.environment.sunElevation = Math.max(0, Math.min(1, elevation));
      const dayGate = Math.min(1, Math.max(0, (elevation + 0.05) * 5)); // disc glows until it fully sinks
      engine.environment.sunColor = lin3(sample.dir).map((v) => v * dayGate) as [number, number, number];
      // The visible disc rides the timecyc SUN columns (prod parity — yellow core, warm corona, sunSize).
      engine.environment.sunCoreColor = lin3(sample.sunCore).map((v) => v * dayGate) as [number, number, number];
      engine.environment.sunCoronaColor = lin3(sample.sunCorona).map((v) => v * dayGate) as [number, number, number];
      engine.environment.sunSize = sample.sunSize;
      engine.environment.sunDirect = Math.max(0, elevation) * 0.9;
      engine.environment.sunIndirect = 0.85 * (1 - dn) + 0.4 * dn;
      engine.environment.skyTop = lin3(sample.skyTop);
      engine.environment.skyHorizon = lin3(sample.skyBot);
      // timecyc fog distances are a per-hour/weather MOOD (the 068 thesis); scale a touch for the higher
      // lab camera, keep the horizon cut absolute.
      // The lab camera flies hundreds of units up — radial ground distances dwarf street-level ones, so the
      // timecyc mood needs a scale (`?fogscale=N`); the game integration (street camera) drops it toward 1.
      engine.environment.fogStartDistance = Math.max(0, sample.fogStart * fogScale);
      engine.environment.fogCutDistance = Math.max(sample.farClip * fogScale, 1200);
      applyMoon(engine, hour, dn);
    },
  };
}

/** Moon arc (074/06 row 6, field round 4 — a REAL arc): rises ~20:00 in the east, peaks ~0:30, sets ~5:00
 *  in the west; elevation starts below the sea horizon so the disc visibly climbs out of / sinks into the
 *  water (the sky shader's horizon clip). Colour gated by darkness (dn) AND elevation — black all day. */
function applyMoon(engine: Engine, hour: number, dn: number): void {
  const t = ((hour - 20 + 24) % 24) / 9;
  const arc = t <= 1 ? Math.sin(t * Math.PI) : 0;
  const elevation = -0.08 + arc * 0.7;
  const azX = Math.cos(Math.min(1, Math.max(0, t)) * Math.PI) * 0.85;
  engine.environment.moonDir = [azX, elevation, -0.4];
  const gate = dn * Math.min(1, Math.max(0, elevation * 5));
  engine.environment.moonColor = [0.045 * gate, 0.06 * gate, 0.105 * gate];
}

function mix3(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Shared parametric sun arc: elevation over 6:00→18:00, dn = the dusk/dawn window. */
function sunArc(hour: number): { dn: number; elevation: number } {
  const elevation = Math.sin(((hour - 6) / 12) * Math.PI);
  const dn = 1 - Math.min(1, Math.max(0, (elevation + 0.15) / 0.3));

  return { dn, elevation };
}
