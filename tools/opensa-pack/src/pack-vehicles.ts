/**
 * Every car in `vehicles.ide` → `.osm` + `.ostex` archive edits (plan opensa-pack/003 phase 3).
 *
 * This is the first asset class to leave the RW parsers behind at runtime: afterwards the archives hold no
 * `<model>.dff` for a converted car, so a spawn is a section read. Phase 5 does the same for peds, clutter,
 * breakables, animated objects and map objects.
 *
 * The one judgement call is the TXD deletion. A car's `.ostex` bakes its whole dictionary chain, so its own
 * `.txd` is dead weight — but only if EVERY def naming that TXD converted, and only if it is not one of the
 * shared dictionaries other classes still parse by name. A TXD failing either test is KEPT and named in the
 * report, because a silently deleted dictionary is a silent no-texture.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { parseVehicleFeatures, UP_DOWN_LIGHTS } from '@opensa/renderware/parsers/text/vehicle-features.parser';

import type { ModelBundles } from './model-bundle';

import { createProgress } from './progress';
import { buildVehicleOsm } from './vehicle-osm';

/** Dictionaries the runtime still reaches for by name, whoever else references them. Never deleted.
 *  `vehicle` also carries the license-plate rasters the runtime parses at boot (plan 082/01) — dropping it
 *  would leave every car wearing the stock placeholder plate. */
const SHARED_TXDS = new Set(['generic', 'particle', 'vehicle']);

export interface VehiclePackReport {
  readonly failed: readonly { readonly error: string; readonly model: string }[];
  readonly models: number;
  /** Total `.osm` bytes — the dictionary is a section INSIDE it, so this already includes `ostexBytes`. */
  readonly osmBytes: number;
  /** The `TEXS` share of `osmBytes`. */
  readonly ostexBytes: number;
  /** TXDs left in the archives although their car converted — shared, or another def still needs them. */
  readonly txdsKept: readonly string[];
}

export interface VehiclePackResult {
  /** Archive entries this class makes obsolete — the `.osm`/`.ostex` inserts come from the bundles. */
  readonly deletes: readonly string[];
  readonly report: VehiclePackReport;
}

/** Build the optimized form of every car. A missing or unparsable model is reported, never fatal. */
export function packVehicles(
  fs: AssetFileSystem,
  bundles: ModelBundles,
  log: (message: string) => void,
): VehiclePackResult {
  const text = fs.getText('data/vehicles.ide');
  if (text === null) {
    throw new Error('data/vehicles.ide not found — cannot enumerate vehicles');
  }
  const defs = [...parseVehicleDefs(text).values()];
  // What the mods declared about their own models (vehicle-installer wrote it) — absent on a stock game dir,
  // and then every car is judged by its geometry alone.
  const features = parseVehicleFeatures(fs.getText('data/vehicle-features.txt') ?? '');

  const deletes: string[] = [];
  const failed: { error: string; model: string }[] = [];
  const converted = new Set<string>();
  let osmBytes = 0;
  let ostexBytes = 0;

  const progress = createProgress('vehicles', defs.length, log);
  for (const def of defs) {
    progress.tick();
    const model = def.model.toLowerCase();
    const dff = `${model}.dff`;
    try {
      const declared = features.get(model) ?? [];
      const built = buildVehicleOsm(fs, model, {
        ...(declared.includes(UP_DOWN_LIGHTS) ? { popUpLights: true } : {}),
        txd: def.txd.toLowerCase(),
        wheelScale: def.wheelScale,
      });
      // The `.ostex` is the MODEL's baked dictionary (its own TXD plus the shared vehicle sets, merged by
      // the builder), so it belongs to the model, not to the TXD it came from.
      bundles.add(model, { sections: built.sections });
      deletes.push(dff);
      osmBytes += built.bytes.byteLength;
      ostexBytes += built.ostex.byteLength;
      converted.add(model);
    } catch (error) {
      failed.push({ error: error instanceof Error ? error.message : String(error), model });
    }
  }

  const txdsKept = planTxdDeletions(defs, converted, deletes);
  log(
    `vehicles: ${converted.size}/${defs.length} converted, ${failed.length} failed, ` +
      `osm ${mb(osmBytes)} (dictionaries ${mb(ostexBytes)} of it), ${txdsKept.length} txds kept`,
  );

  return { deletes, report: { failed, models: converted.size, osmBytes, ostexBytes, txdsKept } };
}

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Queue `<txd>.txd` deletes for the dictionaries no unconverted car still needs; return the ones held back. */
function planTxdDeletions(
  defs: readonly { model: string; txd: string }[],
  converted: ReadonlySet<string>,
  deletes: string[],
): string[] {
  const users = new Map<string, string[]>();
  for (const def of defs) {
    const txd = def.txd.toLowerCase();
    users.set(txd, [...(users.get(txd) ?? []), def.model.toLowerCase()]);
  }

  const kept: string[] = [];
  for (const [txd, models] of users) {
    if (SHARED_TXDS.has(txd) || models.some((model) => !converted.has(model))) {
      kept.push(txd);
      continue;
    }
    deletes.push(`${txd}.txd`);
  }

  return kept;
}
