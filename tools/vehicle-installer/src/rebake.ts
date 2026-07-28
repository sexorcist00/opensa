/**
 * REBAKE — re-run the vehicle half of the pipeline against a game that is already BUILT (plan 006).
 *
 * The install path builds a whole game dir from a stock tree; the converter then bakes every asset class in
 * it. That is minutes of work, and a vehicle round changes a handling row, a model, or one shader-visible
 * detail of one car. This does the vehicle part alone, IN PLACE:
 *
 *   1. each mod's `*.settings.txt` merges into the BUILT `data/*` — the same replace-by-model merge the
 *      install uses, so running it twice changes nothing the first run did not already do;
 *   2. its `features.txt` declaration is merged into `data/vehicle-features.txt`, per model, so rebaking ONE
 *      car cannot drop what the others declared;
 *   3. its `.dff` + `.txd` are converted to the model's `.osm` — the same `buildVehicleOsm` opensa-pack
 *      calls — and that entry is REPLACED in whichever `models/*.img` already holds it.
 *
 * Nothing else in the tree is touched: no map, no peds, no wipe, no copy. What it cannot do is add a car the
 * built game never had — a new model needs its `vehicles.ide` id in the pak's own tables, which is a full
 * build. Such a car is reported, not silently half-installed.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { encodeOsm } from '@opensa/engine-formats';
import { rewriteModelArchives } from '@opensa/opensa-pack/archive-edit';
import { openGameDir } from '@opensa/opensa-pack/game-fs';
import { buildVehicleOsm } from '@opensa/opensa-pack/vehicle-osm';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { parseVehicleFeatures, UP_DOWN_LIGHTS } from '@opensa/renderware/parsers/text/vehicle-features.parser';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { applyVehicle } from './apply-vehicle';
import { formatFeatureTable } from './features';
import { FEATURES_TABLE } from './install';

export interface RebakeOptions {
  /** Folder of vehicle mod folders — normally `mods-src/<game>/vehicles`. */
  inPath: string;
  /** Rebake only these models (lowercased basenames). Absent = every folder under `inPath`. */
  only?: readonly string[];
  /** The BUILT game dir to edit in place — normally `build/<game>/opensa`. */
  targetPath: string;
}

export interface RebakeReport {
  /** Cars whose conversion threw — the built tree keeps whatever it had for them. */
  readonly failed: readonly { readonly error: string; readonly model: string }[];
  /** Per rebaked car: the `.osm` size that replaced its entry. */
  readonly rebaked: readonly { readonly bytes: number; readonly model: string }[];
  /** Folders that carry no `.dff`, or that `--only` filtered out. */
  readonly skipped: readonly string[];
  /** Converted, but no archive held the entry to replace — a car the built game does not have. */
  readonly unplaced: readonly string[];
  /** Everything the settings merge complained about, prefixed with the folder. */
  readonly warnings: readonly string[];
}

/** Rebake the vehicles of a built game in place. Returns what happened; throws only on a broken target. */
export function rebakeVehicles(options: RebakeOptions): RebakeReport {
  const targetPath = resolve(options.targetPath);
  const inPath = resolve(options.inPath);
  requireBuiltGame(targetPath);

  const only = options.only ? new Set(options.only.map((name) => name.toLowerCase())) : null;
  const folders = readdirSync(inPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'));

  const failed: { error: string; model: string }[] = [];
  const rebaked: { bytes: number; model: string }[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const declared = new Map<string, readonly string[]>();
  const selected: { folder: string; model: string }[] = [];

  // Pass 1 — the DATA. Every car's rows land before any car is converted, because the conversion reads the
  // merged `vehicles.ide` (txd name, wheel scale) and `vehicle-features.txt` back out of the target.
  for (const folder of folders) {
    const folderPath = join(inPath, folder);
    const applied = applyVehicle(folderPath, targetPath, { img: false });
    if (!applied.model || (only && !only.has(applied.model))) {
      skipped.push(folder);
      continue;
    }
    applied.warnings.forEach((warning) => warnings.push(`${folder}: ${warning}`));
    if (applied.features.length > 0) {
      declared.set(applied.model, applied.features);
    }
    selected.push({ folder: folderPath, model: applied.model });
  }
  mergeFeatureTable(targetPath, declared);

  // Pass 2 — the MODELS. One composite filesystem per car: the mod folder shadows the built tree, so the
  // converter reads the mod's own `.dff`/`.txd` and everything else (the shared `vehicle.txd`, the plate
  // rasters) from the game it is being baked into.
  const defs = parseVehicleDefs(readFileSync(join(targetPath, 'data', 'vehicles.ide'), 'utf8'));
  const features = parseVehicleFeatures(readText(join(targetPath, FEATURES_TABLE)) ?? '');
  const inserts: { bytes: Uint8Array; name: string; near: string }[] = [];
  for (const { folder, model } of selected) {
    try {
      inserts.push({
        bytes: convert(openGameDir(targetPath, [folder]), model, defs, features.get(model) ?? []),
        name: `${model}.osm`,
        // The built tree holds the converted `.osm`; an UNCONVERTED one still holds the `.dff` this replaces.
        near: `${model}.osm`,
      });
    } catch (error) {
      failed.push({ error: error instanceof Error ? error.message : String(error), model });
    }
  }

  const written = rewriteModelArchives(targetPath, { deletes: [], inserts });
  const unplaced = new Set(written.unplaced);
  for (const insert of inserts) {
    if (!unplaced.has(insert.name.toLowerCase())) {
      rebaked.push({ bytes: insert.bytes.byteLength, model: insert.name.replace(/\.osm$/, '') });
    }
  }

  return { failed, rebaked, skipped, unplaced: [...unplaced], warnings };
}

/** One car → its `.osm` bytes, exactly as `opensa-pack` bundles them (`DESC`/`GEOM`/`COLL`/`TEXS`). */
function convert(
  fs: AssetFileSystem,
  model: string,
  defs: ReturnType<typeof parseVehicleDefs>,
  declared: readonly string[],
): Uint8Array {
  const def = [...defs.values()].find((entry) => entry.model.toLowerCase() === model);

  return encodeOsm(
    buildVehicleOsm(fs, model, {
      ...(declared.includes(UP_DOWN_LIGHTS) ? { popUpLights: true } : {}),
      ...(def ? { txd: def.txd.toLowerCase(), wheelScale: def.wheelScale } : {}),
    }).sections,
  );
}

/** Merge the rebaked cars' declarations into the target's table, keeping every other model's line. */
function mergeFeatureTable(targetPath: string, declared: ReadonlyMap<string, readonly string[]>): void {
  if (declared.size === 0) {
    return;
  }
  const path = join(targetPath, FEATURES_TABLE);
  const merged = new Map<string, readonly string[]>(parseVehicleFeatures(readText(path) ?? ''));
  for (const [model, features] of declared) {
    merged.set(model, features);
  }
  writeFileSync(path, formatFeatureTable(merged));
}

function readText(path: string): null | string {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** A rebake edits a game in place — say so loudly when the path is not one, instead of writing into a hole. */
function requireBuiltGame(targetPath: string): void {
  for (const required of [join('data', 'vehicles.ide'), 'models']) {
    if (!existsSync(join(targetPath, required))) {
      throw new Error(`--target is not a built game dir (no ${required}): ${targetPath}`);
    }
  }
}
