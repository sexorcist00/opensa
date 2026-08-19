/**
 * Install the added cars INTO a built `sa` tree, in place — the part of an added car that is simply a
 * replacement car once it has an id (plan 002).
 *
 * The whole of "install a car" is `vehicle-installer`'s `applyVehicle`, called with the allocated id: the
 * dff/txd into the vehicles archive family, the four data rows merged, `features.txt` declared, `cleo/`
 * carried, and — since plans 012/013 — its ModelVariations section, `.fxt`, audio row and parked spot.
 * Nothing of that is re-implemented here. What IS this tool's is the id: where it comes from, that it never
 * moves, and that the tree still agrees with the ledger afterwards.
 *
 * The tree is edited IN PLACE, like `--rebake --kind sa`, because an added car is added to a build that
 * already exists — there is no source game to copy from and no output to wipe.
 */
import type { BuildTarget } from '@opensa/tool-kit/target';

import { imgFamilyMembers, openImgFamily, writeImgFamily } from '@opensa/tool-kit/archive/img';
import { writeArchiveManifest } from '@opensa/tool-kit/archive/layout';
import { allocateIds, usedModelIds } from '@opensa/tool-kit/free-ids';
import { registerImgArchives } from '@opensa/tool-kit/game-dir';
import { applyVehicle } from '@opensa/vehicle-installer/apply-vehicle';
import { writeAudioRows } from '@opensa/vehicle-installer/audio';
import { vehicleColourWarnings } from '@opensa/vehicle-installer/palette';
import { mergeFeatureTable, requireBuiltGame } from '@opensa/vehicle-installer/rebake-shared';
import { decodeSettings, ID_PLACEHOLDER, parseVehicleSettings } from '@opensa/vehicle-installer/settings';
import { writeModelSpecialFeatures } from '@opensa/vehicle-installer/special-features';
import { assertCarmodsModels, ideModelNames } from '@opensa/vehicle-installer/tuning-parts';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { type LedgerRow, readAddsLedger, writeAddsLedger } from './ledger';
import { resolveAddedCarText } from './name';
import { type AddedVehicle, resolveAddedVehicles } from './sources';

export interface AddVehiclesOptions {
  /** The BUILT `sa` tree the cars are added to; edited in place. */
  readonly gamePath: string;
  /** The added-vehicles source root. */
  readonly inPath: string;
  /** Narrow the run to these slots; the rest keep whatever the tree already holds. */
  readonly only?: readonly string[];
  readonly target?: BuildTarget;
}

export interface AddVehiclesReport {
  /** What was installed, with the id each car took. */
  readonly installed: readonly LedgerRow[];
  /** Cars the source holds and this run did not touch (`--only`). */
  readonly skipped: number;
  readonly warnings: readonly string[];
}

/** Install every added car `--in` resolves to onto the built tree at `--game`. */
export function addVehicles(options: AddVehiclesOptions): AddVehiclesReport {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  requireBuiltGame(gamePath);

  const { sources } = resolveAddedVehicles(inPath, gamePath, options.target ?? 'sa');
  const only = options.only ? new Set(options.only.map((slot) => slot.toLowerCase())) : null;
  const selected = only ? sources.filter((source) => only.has(source.slot)) : sources;
  if (selected.length === 0) {
    return { installed: [], skipped: sources.length, warnings: [] };
  }
  const warnings = selected.flatMap(requireIdPlaceholder);
  if (warnings.length > 0) {
    throw new Error(
      `${warnings.length} added car(s) do not leave their model id to this tool:\n  ${warnings.join('\n  ')}`,
    );
  }
  // Every car of the SOURCE is allocated for, not only the selected ones: an `--only` run must not hand a
  // free id to one car that a full run would give to another. The ledger pins what is already promised.
  const ids = allocateIds({
    ledger: readAddsLedger(gamePath),
    slots: sources.map((source) => source.slot),
    used: usedModelIds(gamePath),
  });

  const basePath = join(
    gamePath,
    'models',
    existsSync(join(gamePath, 'models', 'vehicles.img')) ? 'vehicles.img' : 'gta3.img',
  );
  const img = openImgFamily(basePath);
  const installed: LedgerRow[] = [];
  const declared = new Map<string, readonly string[]>();
  const runWarnings: string[] = [];
  for (const source of selected) {
    const id = ids.get(source.slot)!;
    // The name and the inherited sound are decided BEFORE the car is applied: both read the tree as it is
    // (the base's audio row, the keys `american.gxt` already defines), and the name rides in with the install.
    const text = resolveAddedCarText(source, gamePath, ideLineOf(source.folder, id));
    runWarnings.push(...text.warnings);
    const applied = applyVehicle(source.folder, gamePath, {
      ...(text.name ? { gxt: [text.name] } : {}),
      id,
      img,
      target: 'sa',
    });
    applied.warnings.forEach((warning) => runWarnings.push(`${source.name}: ${warning}`));
    if (text.audio !== null) {
      runWarnings.push(...writeAudioRows(gamePath, [text.audio], `${source.slot} (inherited from ${source.base})`));
    }
    if (applied.features.length > 0 && applied.model) {
      declared.set(applied.model, applied.features);
    }
    installed.push({ bases: source.bases, folder: source.name, id, slot: source.slot });
  }
  if (declared.size > 0) {
    mergeFeatureTable(gamePath, declared);
    runWarnings.push(...writeModelSpecialFeatures(gamePath, declared, new Set(declared.keys())).warnings);
  }
  assertCarmodsModels(gamePath);
  runWarnings.push(...vehicleColourWarnings(gamePath));
  assertIdsLanded(gamePath, installed);

  const archives = writeImgFamily(img, basePath);
  if (archives.length > 1) {
    registerImgArchives(
      gamePath,
      archives.slice(1).map((archive) => basename(archive.path)),
    );
  }
  writeArchiveManifest(gamePath);
  // Last: a ledger written before the tree agreed with it would promise ids the build does not carry.
  writeAddsLedger(gamePath, installed);

  return { installed, skipped: sources.length - selected.length, warnings: runWarnings };
}

/** The archives this tree keeps its cars in — reported so a run says where 115 cars went. */
export function vehicleArchives(gamePath: string): string[] {
  const basePath = join(
    gamePath,
    'models',
    existsSync(join(gamePath, 'models', 'vehicles.img')) ? 'vehicles.img' : 'gta3.img',
  );

  return imgFamilyMembers(basePath).map((path) => basename(path));
}

/**
 * Refuse a tree where an installed car's model does NOT hold the id we allocated. The merges are
 * replace-by-model, so a stock slot sharing the added car's model name would silently take the row instead —
 * and the ledger would then promise an id nothing in the tree defines.
 */
function assertIdsLanded(gamePath: string, installed: readonly LedgerRow[]): void {
  const names = ideModelNames(gamePath);
  const wrong = installed.filter((row) => names.get(row.slot) !== row.id);
  if (wrong.length > 0) {
    throw new Error(
      `${wrong.length} added car(s) did not land on the id they were allocated: ` +
        wrong
          .map((row) => `${row.slot} wanted ${row.id}, the tree says ${names.get(row.slot) ?? 'nothing'}`)
          .join('; '),
    );
  }
}

/** This car's `vehicles.ide` row with the id already in it — what the install is about to merge. */
function ideLineOf(folder: string, id: number): string {
  const file = readdirSync(folder).find((name) => name.toLowerCase().endsWith('.settings.txt'));
  if (file === undefined) {
    return '';
  }
  const text = decodeSettings(readFileSync(join(folder, file)))
    .split(ID_PLACEHOLDER)
    .join(String(id));

  return parseVehicleSettings(text).ideLine ?? '';
}

/** An added car must leave its id to the allocator — a literal one is an author guessing at the window. */
function requireIdPlaceholder(source: AddedVehicle): string[] {
  const file = readdirSync(source.folder).find((name) => name.toLowerCase().endsWith('.settings.txt'));
  if (file === undefined) {
    return [`${source.name}: no *.settings.txt — an added car needs at least its vehicles.ide row`];
  }
  // Decoded, not read as bytes: most of these files are UTF-16, where the ASCII placeholder never matches.
  const text = decodeSettings(readFileSync(join(source.folder, file)));

  return text.includes(ID_PLACEHOLDER)
    ? []
    : [`${source.name}: ${file} has no '${ID_PLACEHOLDER}' — the id is allocated over the built tree, never authored`];
}
