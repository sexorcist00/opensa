/**
 * The sequencer's tables (plan 096/05): what a cycle plays, where, in what light, and in which car.
 *
 * Everything here is DATA and pure functions over it — no engine, no host, no clock. That is what lets the
 * whole of D2/D3/D6/D7/D10 be pinned by unit tests, and what keeps `engine-video-runs.ts` about staging.
 *
 * The one rule these tables obey: a pool is DERIVED from what the game ships, never hand-listed. The weather
 * sets are filtered out of the parsed timecyc names by their region suffix, so a modded timecyc that renames
 * or adds a row is followed rather than contradicted (the derive-from-the-asset rule in CLAUDE.md).
 */

import type { Random } from '@opensa/game/paths/rng';
import type { City } from '@opensa/game/zones/city';

/** One entry of the program: what kind of scene, and the region it plays in. */
export interface ProgramEntry {
  readonly kind: SceneKind;
  readonly region: City;
}

/** The scene kinds D3 names. Only `drive` exists until 07 lands; the sequencer skips the rest with a notice. */
type SceneKind = 'drive' | 'fly' | 'walk';

/**
 * The region cycle (D2), in the user's order: Los Santos → Las Venturas → San Fierro → Country → Desert.
 *
 * The tokens are the game's own — `City` is what the zone data classifies a point into, and the timecyc
 * weather names carry the same suffix — so one token indexes the route filter AND the weather pool.
 */
export const REGION_CYCLE: readonly City[] = ['LA', 'VEGAS', 'SF', 'COUNTRYSIDE', 'DESERT'];

/** The debugger's own preset hours (D6) — a showcase run stands in the light the game was authored for. */
export const HOUR_SLOTS: readonly number[] = [0, 6, 12, 18, 21];

/** Scenes of each kind per cycle (D3): a drive in every region, then two flythroughs, then one walk. */
const FLY_SCENES = 2;
const WALK_SCENES = 1;

/** How often the pick prefers a mod car when the ledger offers any (D10: mod cars FIRST, not ONLY). */
export const MOD_CAR_PREFERENCE = 0.8;

/**
 * The scenes of one cycle: a drive in every region in {@link REGION_CYCLE} order, then the flythroughs and
 * the walk, each in a seeded region.
 *
 * The drives are the spine and their order is fixed, because "did it visit every region, in order" is an
 * acceptance question a log can answer. Where the other kinds play is variety, so it comes from the seeded
 * stream — a cycle is still reproducible, it is just not the same cycle every time.
 */
export function buildProgram(random: Random): ProgramEntry[] {
  const program: ProgramEntry[] = REGION_CYCLE.map((region) => ({ kind: 'drive', region }));
  for (let scene = 0; scene < FLY_SCENES + WALK_SCENES; scene += 1) {
    program.push({
      kind: scene < FLY_SCENES ? 'fly' : 'walk',
      region: REGION_CYCLE[Math.min(REGION_CYCLE.length - 1, Math.floor(random() * REGION_CYCLE.length))],
    });
  }

  return program;
}

/**
 * The car a scene drives: a mod car when the ledger offers one and the seeded roll says so, else any road car
 * the game ships. Null when there is nothing to drive at all.
 *
 * `candidates` is already the filtered roster (road cars whose model is actually present — a slot with no
 * `.osm` throws at spawn). `modCars` is 096/06's ledger; an absent ledger is an empty set and every scene
 * simply takes a stock car, which is the shipped behaviour until that phase lands.
 */
export function pickCar(random: Random, candidates: readonly string[], modCars: ReadonlySet<string>): null | string {
  if (candidates.length === 0) {
    return null;
  }
  const mods = candidates.filter((model) => modCars.has(model));
  const stock = candidates.filter((model) => !modCars.has(model));
  // The roll is taken FIRST and unconditionally, so the stream advances the same way whether or not this
  // game has a ledger — a seed's scene list must not depend on which mods are installed.
  const preferMod = random() < MOD_CAR_PREFERENCE;
  // The two branches draw from DISJOINT pools, so the realised mod share IS {@link MOD_CAR_PREFERENCE} —
  // which is what the phase's acceptance compares against. Letting the stock branch fall back on the whole
  // roster would make the share drift with how many slots a game has modded, and a heavily modded install
  // would stop showing stock classics altogether, which is the half of D10 that is easy to lose.
  const pool = (preferMod ? mods : stock).length > 0 ? (preferMod ? mods : stock) : candidates;

  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/**
 * The seed for scene `index` of a run, from the run's master seed.
 *
 * Per-scene rather than one stream through the whole run, so scene 7 is the same scene whether the run
 * reached it after six others or was resumed at it — which is what makes a field report about ONE scene
 * something the next run can reproduce. The mix is the golden-ratio odd constant, the usual choice for
 * spreading consecutive integers across the 32-bit space.
 */
export function sceneSeed(master: number, index: number): number {
  return (Math.imul(index + 1, 0x9e3779b9) ^ (master >>> 0)) >>> 0;
}

/**
 * The weather rows a region authors, as indices into `weatherNames` (D7 — an LS scene gets LA weathers).
 *
 * SA authors every type per region (`CLOUDY_LA`, `RAINY_SF`, …) and the suffix IS the region token, so this
 * is a filter rather than a table. Empty when the game authors none for that region: the caller then leaves
 * the weather alone rather than inventing one.
 */
export function weatherPool(weatherNames: readonly string[], region: City): number[] {
  const suffix = `_${region}`;
  const pool: number[] = [];
  weatherNames.forEach((name, index) => {
    if (name.endsWith(suffix)) {
      pool.push(index);
    }
  });

  return pool;
}
