/**
 * The indirect/direct split curves for the hybrid world lighting (plan 064): how much of the frame's light
 * stays PRELIT (SA's baked GI, re-read as the indirect term) vs how much real sun is added on top.
 * `colour = albedo × (prelit × indirectScale + sunColour × NdotL × shadow × directScale)`.
 *
 * Pure and linear in its inputs, so weather blends (`sampleTimecycBlend`'s `t`) and the sun arc stay
 * continuous — no pops at hour or weather boundaries. Night parity: `sunElevation = 0` → `{0, 1}`, which
 * degrades the world shader to exactly the classic 038 look.
 */

export interface SunSplit {
  /** Multiplier on the real-sun NdotL term (0 = no direct sun — the classic look). */
  directScale: number;
  /** Multiplier on the prelit term (1 = untouched prelit — the classic look). */
  indirectScale: number;
}

export interface SunSplitInput {
  /** Cloud cover 0 (clear) → 1 (fully overcast) — overcast kills the direct term, prelit takes back over. */
  overcast: number;
  /** Master direct-sun strength (calibration knob, `worldLight.sunDirect`; 0 disables the sun term). */
  sunDirect: number;
  /** Sun elevation factor 0 (below horizon) → 1 (zenith). */
  sunElevation: number;
  /** Prelit retention at full sun (calibration knob, `worldLight.sunIndirect`): 1 = classic, ~0.7 = the
   *  plan-064 intuition (prelit keeps 70 % of its role at noon, the sun adds the directional life). */
  sunIndirect: number;
}

/** How strongly full overcast suppresses the direct term (a sliver survives — soft directionality). */
const OVERCAST_DIRECT_KILL = 0.85;

export function sunSplit({ overcast, sunDirect, sunElevation, sunIndirect }: SunSplitInput): SunSplit {
  const elevation = Math.min(1, Math.max(0, sunElevation));
  const cover = Math.min(1, Math.max(0, overcast));
  // 0 at night → 1 at clear noon: the single driver both scales ride (keeps them complementary).
  const sunAmount = elevation * (1 - cover * OVERCAST_DIRECT_KILL);

  return {
    directScale: sunDirect * sunAmount,
    indirectScale: 1 - (1 - sunIndirect) * sunAmount,
  };
}
