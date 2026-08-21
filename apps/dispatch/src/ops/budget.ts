/**
 * The console's declared symbol counts, in one place because three layers have to agree on them: the seed
 * that can produce them, the beacon buffers that must hold them, and the report that states what a capture
 * was drawing.
 *
 * `UNITS_ON_SCREEN` is not a guess — it is the number the user named on 2026-08-06, before any of this was
 * built (`docs/plans/201-dispatch-console/readme.md`, the budget table: *150 units, each drawn as a model
 * with a symbol over it, 60 fps on a phone*). Everything 201/5-02 owes is measured at it.
 *
 * **It is an ALLOCATION, never a ceiling.** A board that exceeds it must still draw every unit it has: the
 * buffers grow and the overflow is counted into the inventory report, because a marker silently dropped at
 * capacity is a unit the dispatcher cannot see and nothing on screen says so. The count that has never been
 * named by anyone is the CALL one, so calls are allocated against the same figure rather than a number
 * invented here.
 */

/** Units the console must carry at once, worst case. */
export const UNITS_ON_SCREEN = 150;

/** How many units the demo board opens with when `?units=` does not say otherwise — a plausible shift. */
export const DEFAULT_SHIFT = 9;

/** How many calls the demo board opens with when `?calls=` does not say otherwise. */
export const DEFAULT_CALLS = 2;

/**
 * The seeded board size, from the query string. `?units=150&calls=40` is how the field run reaches the
 * declared count — without it the board opens with nine units and the number 5/02 owes cannot be taken on
 * any device, which is exactly where this step found the console.
 */
export function seedSize(params: URLSearchParams): { calls: number; units: number } {
  return {
    calls: count(params.get('calls'), DEFAULT_CALLS),
    units: count(params.get('units'), DEFAULT_SHIFT),
  };
}

/** A non-negative integer from a query value, or the fallback when it is absent or not a number. */
function count(raw: null | string, fallback: number): number {
  if (raw === null) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);

  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
