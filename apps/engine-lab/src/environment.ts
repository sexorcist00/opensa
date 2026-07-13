/**
 * Environment drive (plan 074/06 row 14): REAL timecyc sampling — the same renderware parser/blend prod uses —
 * mapped onto `Engine.environment`. The sun ELEVATION stays a parametric arc (SA stores no sun position in
 * timecyc; the game computes it — same approach here). Colours convert sRGB(0-255) → linear.
 */
import type { Engine } from '@opensa/engine';

import { buildTimecyc, sampleTimecycBlend } from '@opensa/renderware/parsers/text/timecyc';
import { convertTo24h, parseTimecyc } from '@opensa/renderware/parsers/text/timecyc.parser';

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
      engine.environment.sunDir = [azX, Math.max(0.05, elevation), 0.25 * azScale];
      engine.environment.sunElevation = Math.max(0, Math.min(1, elevation));
      const warm = Math.min(1, Math.max(0, 1 - elevation));
      const dayGate = Math.min(1, Math.max(0, elevation * 4));
      engine.environment.sunColor = [dayGate, (0.96 - warm * 0.15) * dayGate, (0.88 - warm * 0.3) * dayGate];
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

  return {
    apply(hour: number): void {
      const sample = sampleTimecycBlend(timecyc, weather, weather, hour, 0);
      const { dn, elevation } = sunArc(hour);
      engine.environment.hour = hour;
      engine.environment.dn = dn;
      // TRUE east→west arc (field fix: the sun used to rise and set at the same azimuth): x sweeps
      // −1 (sunrise) → 0 (noon, near-zenith) → +1 (sunset); the small z tilt shrinks toward noon.
      // MIRRORS the sun-vis bake arc (074/07) — change one, change both.
      const azScale = 1 - 0.75 * Math.max(0, Math.min(1, elevation));
      const azX = -Math.cos(((Math.max(6, Math.min(18, hour)) - 6) / 12) * Math.PI);
      engine.environment.sunDir = [azX, Math.max(0.05, elevation), 0.25 * azScale];
      engine.environment.sunElevation = Math.max(0, Math.min(1, elevation));
      const dayGate = Math.min(1, Math.max(0, elevation * 4)); // sun glow/colour die below the horizon
      engine.environment.sunColor = lin3(sample.dir).map((v) => v * dayGate) as [number, number, number];
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

/** Moon arc (074/06 row 6): rises ~20:00, sets ~5:00, opposite azimuth to the sun; colour is a dim cool
 *  wash gated by BOTH darkness (dn) and moon elevation — black all day, so the shader term is a no-op. */
function applyMoon(engine: Engine, hour: number, dn: number): void {
  const elevation = Math.sin((((hour - 20 + 24) % 24) / 9) * Math.PI);
  // Keep the disc JUST over the horizon (~13–18°): the lab orbit camera looks down at the district and its
  // sky is a band near the horizon — anything higher never enters the frame. The real look is the ROW-13
  // coronamoon sprite anyway.
  engine.environment.moonDir = [-0.5, 0.16 + Math.max(0, elevation) * 0.08, -0.45];
  const gate = dn * Math.min(1, Math.max(0, elevation * 3));
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
