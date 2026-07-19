/**
 * Every ped in `peds.ide` → `.osm` (plan opensa-pack/003 phase 5f).
 *
 * Peds are spawned dynamically, never placed on the map, so `peds.ide` is the whole roster — the same
 * place the local loader's `dynamicModelRefs` gets it, and for the same reason: nothing else enumerates
 * them, and a class nobody enumerates is a class that silently goes missing.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { parsePedDefs } from '@opensa/renderware';

import type { ModelBundles } from './model-bundle';

import { buildPedOsm } from './ped-osm';

export interface PedPackReport {
  readonly bytes: number;
  readonly failed: readonly { readonly error: string; readonly model: string }[];
  readonly models: number;
  /** Peds whose textures did NOT all share one size — each needed more than one `.ostex` array. */
  readonly multiArray: number;
}

export interface PedPackResult {
  /** The stock entries this class makes obsolete. */
  readonly deletes: readonly string[];
  readonly report: PedPackReport;
}

/** Convert every ped. A missing model or an unskinned clump is reported, never fatal. */
export function packPeds(fs: AssetFileSystem, bundles: ModelBundles, log: (message: string) => void): PedPackResult {
  const text = fs.getText('data/peds.ide');
  if (text === null) {
    log('peds: no data/peds.ide — skipped');

    return { deletes: [], report: { bytes: 0, failed: [], models: 0, multiArray: 0 } };
  }

  const deletes: string[] = [];
  const failed: { error: string; model: string }[] = [];
  const converted = new Set<string>();
  let bytes = 0;
  let multiArray = 0;

  for (const def of parsePedDefs(text).values()) {
    const model = def.model.toLowerCase();
    if (converted.has(model)) {
      continue;
    }
    try {
      const built = buildPedOsm(fs, model, def.txd.toLowerCase());
      bundles.add(model, { sections: built.sections });
      deletes.push(`${model}.dff`);
      bytes += built.bytes.byteLength;
      if (built.textureArrays.length > 1) {
        multiArray += 1;
      }
      converted.add(model);
    } catch (error) {
      failed.push({ error: error instanceof Error ? error.message : String(error), model });
    }
  }
  log(
    `peds: ${converted.size} converted, ${failed.length} failed, ${multiArray} needed several texture arrays, ` +
      `${(bytes / 1048576).toFixed(1)} MB`,
  );

  return { deletes, report: { bytes, failed, models: converted.size, multiArray } };
}
