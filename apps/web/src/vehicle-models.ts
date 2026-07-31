import type { AssetFileSystem } from '@opensa/renderware';

import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';

/**
 * The slots a mod installed a car into, from the build-time ledger `data/vehicle-mods.txt` — video mode's
 * "mod cars first" pick (096 D10).
 *
 * An ABSENT ledger is an empty set, never an error: a game built before 096/06's tool existed, or one with no
 * vehicle mods at all, simply has every scene take a stock car. One lowercased slot name per line, `#` starts
 * a comment — the tolerant reading, because the file is written by a tool and read by a showcase run, and a
 * malformed line must cost that line rather than the run. 096/06 owns the format and records it in
 * `docs/contracts/vehicles.md`.
 */
export function modCarSlots(fs: Pick<AssetFileSystem, 'getText'>): Set<string> {
  const text = fs.getText('data/vehicle-mods.txt');
  if (!text) {
    return new Set();
  }

  return new Set(
    text
      .split('\n')
      .map((line) => line.split('#')[0].trim().toLowerCase())
      .filter((line) => line.length > 0),
  );
}

/**
 * The models a scene may actually put a driver in: the `car` type only (no boats, planes, bikes or trains),
 * and only those whose model is PRESENT — the roster is what `vehicles.ide` declares, and a slot whose `.osm`
 * a build does not carry throws at spawn rather than being skipped.
 *
 * The type comes from the IDE row rather than a name list, so a total conversion that re-slots its vehicles is
 * read rather than contradicted. Used by video mode's car pick (096/05).
 */
export function roadCarModels(fs: Pick<AssetFileSystem, 'getText' | 'has'>): string[] {
  const text = fs.getText('data/vehicles.ide');
  if (!text) {
    return [];
  }

  return [...parseVehicleDefs(text).values()]
    .filter((def) => def.type === 'car')
    .map((def) => def.model.toLowerCase())
    .filter((model) => fs.has(`${model}.osm`))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Every spawnable vehicle model name, from `vehicles.ide`'s `cars` section (lowercased + sorted) — the canonical
 * list, independent of the loader (a raw install keeps the DFFs in `gta3.img`, not a loose `vehicles/` folder).
 * Drives the debug spawn list, so no hardcoded per-car set is needed. Lives in the app layer (the generic `game`
 * engine may not parse renderware directly — that goes through its adapter).
 */
export function vehicleModelsFromIde(fs: Pick<AssetFileSystem, 'getText'>): string[] {
  const text = fs.getText('data/vehicles.ide');
  if (!text) {
    return [];
  }

  return [...parseVehicleDefs(text).keys()].sort((a, b) => a.localeCompare(b));
}
