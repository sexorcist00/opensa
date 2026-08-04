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
 * Nothing else in the tree is touched: no map, no peds, no wipe, no copy.
 *
 * It can also ADD a car the built game never had, because nothing about a car is baked into the pak: the
 * roster is the TEXT `data/vehicles.ide` the runtime parses at boot, and a spawn resolves `<model>.osm` out
 * of the archive BY NAME (`gta-sa-world.adapter.ts`; the pak manifest carries cells, textures and water, and
 * no vehicle table at all). What an addition needs is therefore only what a mod already ships — an ide row
 * with an id — and what it must not do is take an id another model owns, which is checked before anything is
 * written. A car added this way has no traffic or parked presence until a full build writes the placements,
 * and the report says so rather than letting it read as a failure.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { encodeOsm } from '@opensa/engine-formats';
import { rewriteModelArchives } from '@opensa/opensa-pack/archive-edit';
import { openGameDir } from '@opensa/opensa-pack/game-fs';
import { buildVehicleOsm } from '@opensa/opensa-pack/vehicle-osm';
import { assertVer2EntrySize } from '@opensa/renderware/archive/img-archive';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { parseVehicleFeatures, UP_DOWN_LIGHTS } from '@opensa/renderware/parsers/text/vehicle-features.parser';
import { parseVehicleMods } from '@opensa/renderware/parsers/text/vehicle-mods.parser';
import { openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { applyVehicle } from './apply-vehicle';
import { formatFeatureTable } from './features';
import { FEATURES_TABLE } from './install';
import { formatModTable, MODS_TABLE } from './mods-table';
import { decodeSettings, parseVehicleSettings } from './settings';

export interface RebakeOptions {
  /** Folder of vehicle mod folders — normally `mods-src/<game>/vehicles`. */
  inPath: string;
  /** Rebake only these models (lowercased basenames). Absent = every folder under `inPath`. */
  only?: readonly string[];
  /** The BUILT game dir to edit in place — normally `build/<game>/opensa`. */
  targetPath: string;
}

export interface RebakeReport {
  /** Models the built game did NOT have and that were added on the mod's own `vehicles.ide` row. */
  readonly added: readonly string[];
  /** Cars whose conversion threw — the built tree keeps whatever it had for them. */
  readonly failed: readonly { readonly error: string; readonly model: string }[];
  /** Per rebaked car: the `.osm` size that replaced its entry. */
  readonly rebaked: readonly { readonly bytes: number; readonly model: string }[];
  /** Cars this run would not touch at all, and why — nothing of theirs was written. */
  readonly refused: readonly { readonly model: string; readonly reason: string }[];
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
  const warnings: string[] = [];
  const declared = new Map<string, readonly string[]>();

  // Pass 0 — WHO. Decided against the roster the built game has BEFORE anything is merged into it, so a car
  // that must not be touched is refused with its files still untouched rather than half-written.
  const { added, refused, selected, skipped } = selectCars(inPath, folders, targetPath, only);

  // Pass 1 — the DATA. Every accepted car's rows land before any car is converted, because the conversion
  // reads the merged `vehicles.ide` (txd name, wheel scale) and `vehicle-features.txt` back out of the target.
  for (const { folder, model } of selected) {
    const applied = applyVehicle(folder, targetPath, { img: false });
    applied.warnings.forEach((warning) => warnings.push(`${basename(folder)}: ${warning}`));
    if (applied.features.length > 0) {
      declared.set(model, applied.features);
    }
  }
  mergeFeatureTable(targetPath, declared);
  // The ledger is MERGED, never rewritten from this run's selection: `--only previon` rebakes one car, and a
  // ledger truncated to it would tell video mode that every other mod car in the build is stock. What a
  // rebake knows is "these slots are also mod slots", which is an addition.
  mergeModTable(
    targetPath,
    selected.map(({ model }) => model),
  );

  // Pass 2 — the MODELS. One composite filesystem per car: the mod folder shadows the built tree, so the
  // converter reads the mod's own `.dff`/`.txd` and everything else (the shared `vehicle.txd`, the plate
  // rasters) from the game it is being baked into.
  const defs = parseVehicleDefs(readFileSync(join(targetPath, 'data', 'vehicles.ide'), 'utf8'));
  const features = parseVehicleFeatures(readText(join(targetPath, FEATURES_TABLE)) ?? '');
  const newcomer = added.length > 0 ? anchorEntry(targetPath) : null;
  const inserts: { bytes: Uint8Array; name: string; near: string }[] = [];
  for (const { folder, model } of selected) {
    // A car the built game already has replaces its own entry; a NEW one has none to sit near, so it goes
    // into `models/gta3.img` beside whatever that archive already holds.
    const near = added.includes(model) ? newcomer : `${model}.osm`;
    if (near === null) {
      refused.push({ model, reason: 'nothing to insert beside — models/gta3.img is missing or empty' });
      continue;
    }
    try {
      inserts.push({
        bytes: convert(openGameDir(targetPath, [folder]), model, defs, features.get(model) ?? [], warnings),
        name: `${model}.osm`,
        near,
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
  for (const model of added) {
    // Saying it once, here, is the difference between "it did not work" and "it is not placed yet".
    warnings.push(
      `${model}: added to the built game — it will NOT appear in traffic or as a parked car until it is in ` +
        'cargrp.dat and the placements a full build writes; spawn it by name to look at it',
    );
  }

  return { added, failed, rebaked, refused, skipped, unplaced: [...unplaced], warnings };
}

/** Any entry `models/gta3.img` already holds — the address a brand-new model is inserted at. */
function anchorEntry(targetPath: string): null | string {
  const path = join(targetPath, 'models', 'gta3.img');
  if (!existsSync(path)) {
    return null;
  }
  const bytes = readFileSync(path);

  return openImg(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).names()[0] ?? null;
}

/** One car → its `.osm` bytes, exactly as `opensa-pack` bundles them (`DESC`/`GEOM`/`COLL`/`TEXS`). */
function convert(
  fs: AssetFileSystem,
  model: string,
  defs: ReturnType<typeof parseVehicleDefs>,
  declared: readonly string[],
  warnings: string[],
): Uint8Array {
  const def = [...defs.values()].find((entry) => entry.model.toLowerCase() === model);

  const osm = buildVehicleOsm(fs, model, {
    ...(declared.includes(UP_DOWN_LIGHTS) ? { popUpLights: true } : {}),
    ...(def ? { txd: def.txd.toLowerCase(), wheelScale: def.wheelScale } : {}),
  });
  warnings.push(...osm.warnings);

  const bytes = encodeOsm(osm.sections);
  // Checked per car so an oversized model lands in `failed` instead of aborting the whole run when the
  // archive rewrite refuses it.
  assertVer2EntrySize(`${model}.osm`, bytes.byteLength);

  return bytes;
}

/** The `vehicles.ide` id this mod declares for itself (column 0 of its ide line), or null if it declares none. */
function declaredIdOf(folderPath: string): null | number {
  const file = readdirSync(folderPath).find(
    (name) => name.toLowerCase().endsWith('.settings.txt') || name.toLowerCase().endsWith('.txt'),
  );
  if (!file || file.toLowerCase() === 'features.txt') {
    return null;
  }
  const line = parseVehicleSettings(decodeSettings(readFileSync(join(folderPath, file)))).ideLine;
  const id = Number(line?.split(',')[0]?.trim());

  return Number.isFinite(id) ? id : null;
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

/** Add the rebaked slots to the target's mod ledger, keeping every slot already in it (096/06). */
function mergeModTable(targetPath: string, models: readonly string[]): void {
  if (models.length === 0) {
    return;
  }
  const path = join(targetPath, MODS_TABLE);
  const merged = parseVehicleMods(readText(path) ?? '');
  models.forEach((model) => merged.add(model.toLowerCase()));
  writeFileSync(path, formatModTable(merged));
}

/** The model a folder is for: its `.dff` basename, the same rule the install uses. */
function modelOf(folderPath: string): null | string {
  const dff = readdirSync(folderPath).find((name) => name.toLowerCase().endsWith('.dff'));

  return dff ? dff.replace(/\.dff$/i, '').toLowerCase() : null;
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

/** Which cars this run will touch, and why it will not touch the others — see {@link rebakeVehicles}. */
function selectCars(
  inPath: string,
  folders: readonly string[],
  targetPath: string,
  only: null | ReadonlySet<string>,
): {
  added: string[];
  refused: { model: string; reason: string }[];
  selected: { folder: string; model: string }[];
  skipped: string[];
} {
  const roster = parseVehicleDefs(readFileSync(join(targetPath, 'data', 'vehicles.ide'), 'utf8'));
  const owners = new Map<number, string>();
  for (const def of roster.values()) {
    owners.set(def.id, def.model.toLowerCase());
  }

  const added: string[] = [];
  const refused: { model: string; reason: string }[] = [];
  const selected: { folder: string; model: string }[] = [];
  const skipped: string[] = [];
  for (const folder of folders) {
    const folderPath = join(inPath, folder);
    const model = modelOf(folderPath);
    if (!model || (only && !only.has(model))) {
      skipped.push(folder);
      continue;
    }
    const declaredId = declaredIdOf(folderPath);
    const owner = declaredId === null ? undefined : owners.get(declaredId);
    if (owner !== undefined && owner !== model) {
      // Two models on one id: `modelById` keeps whichever came last, and a car generator then spawns the
      // wrong car — silently, and only where that generator stands.
      refused.push({ model, reason: `vehicles.ide id ${declaredId} already belongs to '${owner}'` });
      continue;
    }
    if (!roster.has(model)) {
      if (declaredId === null) {
        refused.push({
          model,
          reason:
            "not in the built game's vehicles.ide and the mod declares no ide row — a car needs an id, a txd " +
            'and a type before it can be added',
        });
        continue;
      }
      added.push(model);
    }
    selected.push({ folder: folderPath, model });
  }

  return { added, refused, selected, skipped };
}
