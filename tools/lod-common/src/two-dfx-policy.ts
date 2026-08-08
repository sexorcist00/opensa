/**
 * The ONE declared 2dfx carry-policy for LOD representations (plan 005). Before this, the
 * keep-set was spelled three times in three shapes — a corona survived all three paths, a roadsign two, an
 * undecoded type one, by accident rather than by decision.
 *
 * The policy says WHETHER a type rides onto a LOD, never what happens to its payload: `extract2dfxEntries` /
 * `build2dfxSection` keep their byte-verbatim contract and the spatial rewrite is `transform2dfxEntry`'s job.
 *
 * It is keyed by **target**, not by generator, because what decides the verdict is the host the output feeds:
 * `clone` is a per-object far copy for real SA (`sa-lod-generator`), `cell` is a baked cell for the OpenSA
 * engine (`opensa-lod-generator`). The living write-up, with the reasoning per row, is
 * `tools/lod-common/docs/2dfx-policy.md`.
 */

/** One row of the policy: a 2dfx entry type and its verdict per target. */
export interface Lod2dfxRule {
  cell: Lod2dfxVerdict;
  clone: Lod2dfxVerdict;
  /** gtamods' name for the type, for readable diagnostics. */
  name: string;
  type: number;
  /** Why the verdicts are what they are — the half of this table that is worth having. */
  why: string;
}

/** Which host the LOD is being built for — see the module note on why this is not keyed by generator. */
export type Lod2dfxTarget = 'cell' | 'clone';

/**
 * What happens to a type on that target. `carry-rate-scaled` is `carry` until plan 07's `lod-common/03` implements the
 * thinning — it is recorded now so the intent is not lost in a generator's flag.
 */
export type Lod2dfxVerdict = 'carry' | 'carry-rate-scaled' | 'drop';

/**
 * A type with no row is DROPPED on every target. The stock corpus carries only the eight types below
 * (`scripts/debug/two-dfx-census.ts`), so this fallback changes nothing there — it is the rule for a type a
 * mod invents or Rockstar used somewhere we have not looked, and dropping an unknown effect at LOD range is
 * the conservative half of that trade.
 */
export const LOD_2DFX_UNLISTED: Lod2dfxVerdict = 'drop';

/** The policy. Entry counts in the `why` column are stock `original`, from the census script. */
export const LOD_2DFX_POLICY: readonly Lod2dfxRule[] = [
  {
    cell: 'carry',
    clone: 'carry',
    name: 'light',
    type: 0,
    why: 'Distant night city lights are why 2dfx rides a LOD at all (2203 entries / 327 models). The only type a baked cell has ever carried.',
  },
  {
    cell: 'drop',
    clone: 'carry-rate-scaled',
    name: 'particle',
    type: 1,
    why: 'Emitters ship on the clone since 03-asi/010 flipped the strip (64 / 43); `--strip-particles` is the stock-target opt-out. A cell has no emitter budget yet — plan 07, `lod-common/03`, owns both halves.',
  },
  {
    cell: 'drop',
    clone: 'carry',
    name: 'ped attractor',
    type: 3,
    why: 'Carried because the clone paths carry it today (916 / 266); nothing reads a ped attractor at LOD range, so it is a candidate for the first MEASURED drop, not an argued one.',
  },
  {
    cell: 'drop',
    clone: 'carry',
    name: 'enter/exit',
    type: 6,
    why: 'As type 3 (78 / 71) — an interior marker on a far copy does nothing, but dropping it is a behaviour change that has to be measured by the generator plan, not assumed here.',
  },
  {
    cell: 'drop',
    clone: 'carry',
    name: 'roadsign',
    type: 7,
    why: 'The visible win of the whole chain (489 / 207). `cell` is `drop` only until the cell path can re-rotate the plate and something reads it — plan 100 opens it.',
  },
  {
    cell: 'drop',
    clone: 'carry',
    name: 'trigger point',
    type: 8,
    why: 'As type 3, and the rarest of them (33 / 7) — a trigger a far copy has no way to fire.',
  },
  {
    cell: 'drop',
    clone: 'carry',
    name: 'cover point',
    type: 9,
    why: 'As type 3, and the bulk of the corpus by count (15 007 / 1210) — whatever it costs to carry, it costs it 15 000 times.',
  },
  {
    cell: 'drop',
    clone: 'carry',
    name: 'escalator',
    type: 10,
    why: 'Five entries in four models, so it will never move an aggregate — verify it by looking at those four. `cell` stays `drop`: our engine has no escalator code at all, so there is nothing to read one (plan 101 builds it).',
  },
];

const BY_TYPE = new Map(LOD_2DFX_POLICY.map((rule) => [rule.type, rule]));

/**
 * The entry types a target carries — the set `extract2dfxEntries` / `collectClumpEffects` filter by. A
 * `carry-rate-scaled` type is in the set: the scaling is applied to its payload, not to whether it rides.
 */
export function keepTypesFor(target: Lod2dfxTarget): ReadonlySet<number> {
  return new Set(LOD_2DFX_POLICY.filter((rule) => rule[target] !== 'drop').map((rule) => rule.type));
}

/** The verdict for one entry type on one target — {@link LOD_2DFX_UNLISTED} when the type has no row. */
export function verdictFor(type: number, target: Lod2dfxTarget): Lod2dfxVerdict {
  return BY_TYPE.get(type)?.[target] ?? LOD_2DFX_UNLISTED;
}
