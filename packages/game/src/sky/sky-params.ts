/**
 * timecyc → Preetham-sky parameter mapping (plan 067): the physical sky's inputs (turbidity, rayleigh,
 * mie, sun intensity) are DRIVEN by the game's weather/hour state so every SA mood stays reachable, and a
 * timecyc-derived tint keeps Rockstar as the colourist. Pure module (the GL half lives in sky.plugin) —
 * every curve is unit-testable and continuous in its inputs (weather blends must not pop).
 *
 * Scattering constants ported from the three.js `Sky` addon (Preetham fit).
 */

export interface PbrSkyInput {
  /** Cloud cover 0 (clear) → 1 (overcast) — drives haze (turbidity/mie). */
  cloudCover: number;
  /** Cloud heaviness 0–1 (storm/fog weathers) — deepens the haze further. */
  cloudDark: number;
  /** How strongly the timecyc palette tints the physical sky (0 = pure Preetham, 1 = full SA mood). */
  mood: number;
  /** timecyc `skyTop` 0–255 RGB — the SA palette source for the tint. */
  skyTop: readonly [number, number, number];
  /** Sun elevation factor 0 (horizon/below) → 1 (zenith). */
  sunElevation: number;
}

export interface PbrSkyParams {
  /** Mie scattering coefficient triple (haze). */
  betaM: readonly [number, number, number];
  /** Rayleigh scattering coefficient triple. */
  betaR: readonly [number, number, number];
  /** Sun radiance input to the scattering integral (0 below the horizon). */
  sunE: number;
  /** Linear multiplier applied to the physical sky — the SA mood (white = untinted). */
  tint: readonly [number, number, number];
}

/** Preetham fit constants (three.js Sky): per-channel Rayleigh totals and the Mie K coefficients. */
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5] as const;
const MIE_K = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14] as const;
const SUN_EE = 1000;
const SUN_CUTOFF = Math.PI / 1.95;
const SUN_STEEPNESS = 1.5;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * CPU twin of the shader's horizon colour (plan 067 interim, superseded by the 068 LUT sampling): the
 * Preetham value at eye level averaged over `AZIMUTHS`, with the mood tint and the same Reinhard
 * compression the dome applies. LINEAR 0..1 — FogExp2's single colour needs a view-independent average.
 */
export function pbrHorizonAverage(
  params: PbrSkyParams,
  sunDir: readonly [number, number, number],
  exposure: number,
): [number, number, number] {
  const AZIMUTHS = 8;
  const ELEVATION = 0.035; // the LUT's eye-level ring
  const out: [number, number, number] = [0, 0, 0];
  const g = 0.8;
  const g2 = g * g;
  const sunFresnel = Math.min(1, Math.max(0, (1 - sunDir[1]) ** 5));
  const zenith = Math.acos(Math.min(1, ELEVATION));
  const denom = Math.cos(zenith) + 0.15 * (93.885 - (zenith * 180) / Math.PI) ** -1.253;
  const sR = 8400 / denom;
  const sM = 1250 / denom;
  const base = [0, 0.0003, 0.00075];
  for (let step = 0; step < AZIMUTHS; step += 1) {
    const phi = (step / AZIMUTHS) * Math.PI * 2;
    const len = Math.hypot(Math.cos(phi), ELEVATION, Math.sin(phi));
    const dir = [Math.cos(phi) / len, ELEVATION / len, Math.sin(phi) / len];
    const cosTheta = dir[0] * sunDir[0] + dir[1] * sunDir[1] + dir[2] * sunDir[2];
    const rPhase = 0.0596831 * (1 + cosTheta * cosTheta);
    const mPhase = (0.0795775 * (1 - g2)) / (1 - 2 * g * cosTheta + g2) ** 1.5;
    for (let channel = 0; channel < 3; channel += 1) {
      const betaR = params.betaR[channel];
      const betaM = params.betaM[channel];
      const fex = Math.exp(-(betaR * sR + betaM * sM));
      const scatter = (betaR * rPhase + betaM * mPhase) / (betaR + betaM);
      let lin = Math.max(0, params.sunE * scatter * (1 - fex)) ** 1.5;
      lin *= 1 + (Math.max(0, params.sunE * scatter * fex) ** 0.5 - 1) * sunFresnel;
      const value = ((lin + 0.1 * fex) * 0.04 + base[channel]) * exposure * params.tint[channel];
      out[channel] += value / (1 + value) / AZIMUTHS; // Reinhard, as the dome applies
    }
  }

  return out;
}

export function pbrSkyParams({ cloudCover, cloudDark, mood, skyTop, sunElevation }: PbrSkyInput): PbrSkyParams {
  const cover = clamp01(cloudCover);
  const dark = clamp01(cloudDark);
  const elevation = clamp01(sunElevation);

  // Haze: clear SA day ≈ 2.2; overcast/foggy weathers push toward a milky 10+ sky.
  const turbidity = 2.2 + cover * 6 + dark * 4;
  // More Rayleigh near the horizon sun → redder dawns/dusks (the classic sunset driver).
  const rayleigh = 2 + (1 - elevation) * 1.5;
  const mieCoefficient = 0.005 + cover * 0.006;

  const betaR = TOTAL_RAYLEIGH.map((value) => value * rayleigh) as unknown as [number, number, number];
  const mieC = 0.2 * turbidity * 10e-18;
  const betaM = MIE_K.map((value) => 0.434 * mieC * value * mieCoefficient) as unknown as [number, number, number];

  // three's Sky sun-intensity curve, driven by the zenith angle of the sun.
  const zenithAngle = Math.acos(clamp01(elevation));
  const sunE = SUN_EE * Math.max(0, 1 - Math.exp(-((SUN_CUTOFF - zenithAngle) / SUN_STEEPNESS)));

  // SA mood tint: the timecyc skyTop hue, normalized so it recolours without darkening.
  const maxComponent = Math.max(skyTop[0], skyTop[1], skyTop[2], 1);
  const tint = skyTop.map((value) => 1 + (value / maxComponent - 1) * clamp01(mood)) as unknown as [
    number,
    number,
    number,
  ];

  return { betaM, betaR, sunE, tint };
}
