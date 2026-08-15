import { cleanLines, sectionedParse } from '@opensa/renderware/parsers/text/text-lines';

/**
 * Which archive an entry belongs in. `map` is both a bucket and the FALLBACK — it keeps `gta3.img`, the
 * archive the game loads unconditionally, so anything we cannot place confidently still loads exactly as it
 * does today.
 */
export type Bucket = 'map' | 'peds' | 'vehicles' | 'weapons';

/** One IDE row's claim on an archive entry: `admiral.dff` / `admiral.txd` → `vehicles`. */
export interface Claim {
  bucket: Bucket;
  /** Lowercased entry name WITH extension, as it appears in the archive directory. */
  name: string;
}

export interface Classification {
  /** Lowercased entry name → the archive it goes to. Every input entry appears exactly once. */
  bucketOf: Map<string, Bucket>;
  /** Entries two different buckets claimed — resolved to `map`, listed so the ambiguity is visible. */
  contested: string[];
  /** Entries no IDE row claimed — resolved to `map`. A growing list is how a classifier goes wrong quietly. */
  unclaimed: string[];
}

/**
 * The IDE sections that declare a MODEL, and the bucket each one implies.
 *
 * **This is the whole rule, and it is authored data rather than a roster in our code**
 * (`docs/restrictions/assets-and-data.md`): a model's bucket is decided by the section its own IDE row sits
 * in, so a mod that adds a car to `cars` gets the vehicle bucket without anything here changing.
 *
 * Sections deliberately absent: `txdp` declares a texture PARENT relationship rather than a model, `2dfx`
 * attaches an effect to a model already declared elsewhere, and `path` places nothing.
 *
 * **`weap` is the source for weapons, not `weapon.dat`** — that file is the stats table and addresses a
 * weapon by numeric `modelId`, so reading it would mean resolving those ids back through this very section.
 */
const SECTION_BUCKET: Readonly<Record<string, Bucket>> = {
  anim: 'map',
  cars: 'vehicles',
  hier: 'map',
  objs: 'map',
  peds: 'peds',
  tobj: 'map',
  weap: 'weapons',
};

/**
 * Read one IDE file's claims. Every model-declaring section shares the same first two columns — `id, model,
 * txd, …` — so one row shape covers all of them, and a row that is missing either name contributes nothing
 * rather than claiming an empty string.
 */
export function claimsFromIde(text: string, vehicleParts: ReadonlySet<string> = new Set()): Claim[] {
  const claims: Claim[] = [];
  const handlers: Record<string, (row: string[]) => void> = {};
  for (const [section, sectionBucket] of Object.entries(SECTION_BUCKET)) {
    handlers[section] = (row): void => {
      const model = row[1]?.toLowerCase();
      const txd = row[2]?.toLowerCase();
      // A mod-shop part is authored as an OBJECT but belongs to the car it bolts onto, and `carmods.dat` is
      // where the game says so. Without this the 12 tunable cars' dictionaries end up shared between the
      // vehicle and the map bucket, and the parts stream out of a different archive from the car wearing them.
      const bucket = model !== undefined && vehicleParts.has(model) ? 'vehicles' : sectionBucket;
      if (model) {
        claims.push({ bucket, name: `${model}.dff` });
      }
      if (txd) {
        claims.push({ bucket, name: `${txd}.txd` });
      }
    };
  }
  sectionedParse(cleanLines(text), handlers);

  return claims;
}

/**
 * Place every entry of an archive into a bucket.
 *
 * Two resolutions, and both are deliberate rather than defensive:
 *
 * - **Contested** (claimed by more than one bucket — a texture dictionary shared between a car and a map
 *   object, say) goes to `map`. It is safe because the game resolves an entry by NAME across every
 *   registered archive, so where a shared dictionary physically sits changes nothing about who can read it;
 *   the split is about file size and ownership, never about visibility.
 * - **Unclaimed** (`.col` / `.ipl` / `.ifp` / `.dat`, and any model no IDE declares) also stays in `map`,
 *   which is where it lives today. Both lists are returned rather than swallowed: the counts are the
 *   classifier's own error bars.
 */
export function classifyEntries(entries: readonly string[], claims: readonly Claim[]): Classification {
  const claimed = new Map<string, 'contested' | Bucket>();
  for (const { bucket, name } of claims) {
    const existing = claimed.get(name);
    claimed.set(name, existing === undefined || existing === bucket ? bucket : 'contested');
  }

  const bucketOf = new Map<string, Bucket>();
  const contested: string[] = [];
  const unclaimed: string[] = [];
  for (const entry of entries) {
    const name = entry.toLowerCase();
    const claim = claimed.get(name);
    if (claim === undefined) {
      unclaimed.push(name);
    } else if (claim === 'contested') {
      contested.push(name);
    }
    bucketOf.set(name, claim === undefined || claim === 'contested' ? 'map' : claim);
  }

  return { bucketOf, contested, unclaimed };
}

/**
 * The model names `carmods.dat` declares as vehicle PARTS — the authored answer to "is this object a car
 * part?", which no IDE section carries (they are all plain `objs` rows in `veh_mods.ide`).
 *
 * Its three sections each hide the parts in a different place: `link` pairs two parts per row, `mods` starts
 * a row with the CAR and lists its parts after it, and `wheel` starts with a numeric group index. So the
 * rule is "every cell except the leading one, plus both cells of a link row".
 */
export function vehiclePartsFromCarmods(text: string): Set<string> {
  const parts = new Set<string>();
  const add = (cells: string[]): void => {
    for (const cell of cells) {
      const name = cell.trim().toLowerCase();
      if (name) {
        parts.add(name);
      }
    }
  };
  sectionedParse(cleanLines(text), {
    link: (row): void => add(row),
    mods: (row): void => add(row.slice(1)),
    wheel: (row): void => add(row.slice(1)),
  });

  return parts;
}
