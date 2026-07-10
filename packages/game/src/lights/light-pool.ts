/**
 * Local-light pool selection (plan 070): which street lamps get one of the world shader's scarce light
 * slots this frame. Pure + deterministic so the policy is unit-testable; the system does the three.js
 * bookkeeping. Selection is by distance with **hysteresis**: a lamp already in the pool keeps its slot
 * until a rival is clearly nearer, so slots don't thrash while driving along a lamp row.
 */

/** One lamp the pool can light with (GTA Z-up world position, as `collectCoronas` produces). */
export interface LampLight {
  /** RGB 0–255 (the 2dfx light colour). */
  color: readonly [number, number, number];
  /** Stable identity across frames — used by the hysteresis. */
  key: string;
  /** World position (GTA Z-up, under the streaming root). */
  position: readonly [number, number, number];
  /** Light radius (world units), derived from the corona's authored size. */
  radius: number;
}

/** Incumbents keep their slot until a rival is this much nearer (squared-distance ratio). */
const HYSTERESIS = 0.8;

const distance2 = (a: readonly number[], b: readonly number[]): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Stable key for a lamp at a world position (positions are baked per cell — exact and unique enough). */
export function lampKey(position: readonly [number, number, number]): string {
  return `${position[0].toFixed(2)},${position[1].toFixed(2)},${position[2].toFixed(2)}`;
}

/**
 * The `slots` nearest lamps to `viewer` within `maxDistance`, biased toward the `previous` selection
 * (hysteresis). Returns fewer than `slots` when not enough lamps are in range.
 */
export function selectLamps(
  lamps: readonly LampLight[],
  viewer: readonly [number, number, number],
  slots: number,
  maxDistance: number,
  previous: ReadonlySet<string> = new Set(),
): LampLight[] {
  if (slots <= 0) {
    return [];
  }
  const maxD2 = maxDistance * maxDistance;

  return lamps
    .map((lamp) => {
      const d2 = distance2(lamp.position, viewer);

      // an incumbent's distance is discounted, so a newcomer must be clearly nearer to steal the slot
      return { d2, lamp, rank: previous.has(lamp.key) ? d2 * HYSTERESIS : d2 };
    })
    .filter((entry) => entry.d2 <= maxD2)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, slots)
    .map((entry) => entry.lamp);
}
