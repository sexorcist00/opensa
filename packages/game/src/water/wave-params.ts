/**
 * Sea state per weather (plan 069): the Gerstner wave set the water shader runs. Pure so the weather blend
 * stays continuous (a storm must roll in, not snap on) and the numbers are unit-testable; the shader gets a
 * handful of scalars, no per-wave uniforms.
 */

export interface SeaState {
  /** Wave height scale (world units at the crests). */
  amplitude: number;
  /** Foam coverage on the crests, 0–1. */
  foam: number;
  /** Crest sharpness 0 (rolling swell) → 1 (choppy peaks). */
  steepness: number;
  /** Wind heading (radians) the wave trains align to. */
  windAngle: number;
}

export interface SeaStateInput {
  /** Cloud cover 0 (clear) → 1 (overcast) — our proxy for wind, as SA has no wind channel. */
  overcast: number;
  /** Rain/storm 0–1 — pushes the sea past what mere cloud does. */
  storm: number;
  /** Weather index, only to give each weather its own stable wind heading. */
  weather: number;
}

/** Calm-sea baseline (a clear LS day) and the storm ceiling the curves interpolate to. */
const CALM = { amplitude: 0.12, foam: 0.02, steepness: 0.18 };
const STORM = { amplitude: 1.35, foam: 0.55, steepness: 0.78 };

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function seaState({ overcast, storm, weather }: SeaStateInput): SeaState {
  // Overcast alone raises a swell; rain/storm dominates when present.
  const energy = clamp01(Math.max(clamp01(overcast) * 0.55, clamp01(storm)));

  return {
    amplitude: lerp(CALM.amplitude, STORM.amplitude, energy),
    foam: lerp(CALM.foam, STORM.foam, energy),
    steepness: lerp(CALM.steepness, STORM.steepness, energy),
    // A stable per-weather heading (no time dependence — the sea must not spin as hours pass).
    windAngle: ((weather * 2.399963) % (Math.PI * 2)) - Math.PI,
  };
}
