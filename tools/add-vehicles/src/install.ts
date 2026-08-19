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
import { ADDED_ID_WINDOW, allocateIds, usedModelIds } from '@opensa/tool-kit/free-ids';
import { registerImgArchives } from '@opensa/tool-kit/game-dir';
import { applyVehicle } from '@opensa/vehicle-installer/apply-vehicle';
import { writeAudioRows } from '@opensa/vehicle-installer/audio';
import { assertCarmodsCeilings, carmodsHeadroom } from '@opensa/vehicle-installer/carmods-guard';
import { mergeCarmodsLink } from '@opensa/vehicle-installer/merge';
import { vehicleColourWarnings } from '@opensa/vehicle-installer/palette';
import { mergeFeatureTable, requireBuiltGame } from '@opensa/vehicle-installer/rebake-shared';
import { decodeSettings, ID_PLACEHOLDER, parseVehicleSettings } from '@opensa/vehicle-installer/settings';
import { writeModelSpecialFeatures } from '@opensa/vehicle-installer/special-features';
import { applyIdeRows, applyInsert, assertCarmodsModels, ideModelNames } from '@opensa/vehicle-installer/tuning-parts';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { type LedgerRow, readAddsLedger, readAddsRows, writeAddsLedger } from './ledger';
import { resolveAddedCarText } from './name';
import { type AddedVehicle, resolveAddedVehicles, stockSlotIds } from './sources';
import { registerTraffic } from './traffic';
import { readTunedTrafficConfig, registerTunedTraffic } from './tuned-traffic';
import { type DerivedTuning, deriveTuning, shippedParts } from './tuning';

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
  // What each car re-models of its base's tuning parts, decided BEFORE any id is handed out: the parts need
  // ids of their own, out of the same window and just as stable (a part id is in the save too).
  const tuning = new Map(
    sources.map((source) => [
      source.slot,
      deriveTuning(gamePath, source.slot, source.base, shippedParts(source.folder, source.slot)),
    ]),
  );
  // Every car of the SOURCE is allocated for, not only the selected ones: an `--only` run must not hand a
  // free id to one car that a full run would give to another. The ledger pins what is already promised.
  const slots = sources.flatMap((source) => [
    source.slot,
    ...(tuning.get(source.slot)?.rows ?? []).map((row) => row.name),
  ]);
  const ids = allocateIds({
    ledger: promisedIds(gamePath, slots),
    slots,
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
    // The parts FIRST: the carmods line the settings merge is about to write names them, and
    // `assertCarmodsModels` refuses a token no IDE row defines.
    const parts = tuning.get(source.slot)!;
    runWarnings.push(...parts.warnings.map((warning) => `${source.name}: ${warning}`));
    installed.push(...installTuning(gamePath, source, parts, ids, runWarnings));
    const applied = applyVehicle(source.folder, gamePath, {
      ...(text.name ? { gxt: [text.name] } : {}),
      id,
      img,
      partRenames: new Map([...parts.renames].map(([file, entry]) => [stem(file), stem(entry)])),
      renames: parts.renames,
      target: 'sa',
    });
    applied.warnings.forEach((warning) => runWarnings.push(`${source.name}: ${warning}`));
    if (text.audio !== null) {
      runWarnings.push(...writeAudioRows(gamePath, [text.audio], `${source.slot} (inherited from ${source.base})`));
    }
    if (applied.features.length > 0 && applied.model) {
      declared.set(applied.model, applied.features);
    }
    installed.push({ bases: source.bases, folder: source.name, id, kind: 'car', slot: source.slot });
  }
  if (declared.size > 0) {
    mergeFeatureTable(gamePath, declared);
    runWarnings.push(...writeModelSpecialFeatures(gamePath, declared, new Set(declared.keys())).warnings);
  }
  assertCarmodsModels(gamePath);
  // The two fixed-size arrays behind carmods.dat. Refuses NAMING `asi/perfect-vehicle`, which is the plugin
  // that lifts them — every added car re-modelling its base's wings costs one of the seven spare link pairs.
  assertCarmodsCeilings(gamePath);
  const headroom = carmodsHeadroom(gamePath);
  console.log(
    `add-vehicles: carmods headroom — ${headroom.links} link pair(s), ${headroom.partsPerCar} part(s) on the fullest car`,
  );
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
  // Traffic speaks for the WHOLE tree, read back off the ledger — an `--only` run must not drop the other
  // cars out of their base's variation list (plan 004).
  runWarnings.push(...registerTraffic(gamePath, readAddsRows(gamePath), stockSlotIds(gamePath)));
  // Tuned traffic is fleet-wide and derived from the tree, so it runs LAST — over the rows this run merged
  // and the sections 004 just wrote, into the same one-section-per-model (plan 006).
  const tuned = registerTunedTraffic(gamePath, readTunedTrafficConfig(inPath), allModelIds(gamePath));
  console.log(`add-vehicles: ${tuned} model(s) given a tuned-traffic section`);

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

/** Every drivable model the built tree defines, added cars included — what tuned traffic is written over. */
function allModelIds(gameDir: string): Map<string, number> {
  return stockSlotIds(gameDir);
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

/**
 * Write one car's derived tuning parts into the built tree: an IDE row per part (with its allocated id), the
 * shop item and price cloned after the stock part's, and a `link` for every stock pair both of whose sides
 * the car re-models. Returns the ledger rows for the parts — their ids are a promise like a car's.
 */
function installTuning(
  gameDir: string,
  source: AddedVehicle,
  parts: DerivedTuning,
  ids: ReadonlyMap<string, number>,
  warnings: string[],
): LedgerRow[] {
  if (parts.rows.length === 0) {
    return [];
  }
  const rows: LedgerRow[] = [];
  const ideRows: string[] = [];
  for (const { name, row } of parts.rows) {
    const id = ids.get(name);
    if (id === undefined) {
      warnings.push(`${source.name}: no id was allocated for '${name}' — the part is not installed`);
      continue;
    }
    ideRows.push(row.split(ID_PLACEHOLDER).join(String(id)));
    rows.push({
      bases: [name.slice(0, name.lastIndexOf(`_${source.slot}`))],
      folder: source.name,
      id,
      kind: 'part',
      slot: name,
    });
  }
  warnings.push(...applyIdeRows(gameDir, ideRows).map((warning) => `${source.name}: ${warning}`));
  for (const entry of parts.shop) {
    warnings.push(
      ...applyInsert(gameDir, {
        after: entry.after,
        lines: [`item ${entry.item}`],
        section: entry.section,
        top: 'shops',
      }),
      ...applyInsert(gameDir, { after: entry.after, lines: [entry.price], section: 'CarMods', top: 'prices' }),
    );
  }
  if (parts.links.length > 0) {
    const path = join(gameDir, 'data', 'carmods.dat');
    let text = readFileSync(path, 'latin1');
    for (const [left, right] of parts.links) {
      text = mergeCarmodsLink(text, left, right);
    }
    writeFileSync(path, text, 'latin1');
  }

  return rows;
}

/**
 * The ids already promised to these slots: the ledger, and — under it — whatever the TREE already defines
 * them as inside the window.
 *
 * The tree half is what makes a FAILED run safe. A run that refuses late (the carmods ceilings are checked
 * after every row is merged) leaves the ide rows in place and no ledger; reading only the ledger, the next
 * run would see those ids as taken by strangers and hand the whole fleet new ones — renumbering it, which is
 * the one thing the ledger exists to prevent.
 */
function promisedIds(gameDir: string, slots: readonly string[]): Map<string, number> {
  const names = ideModelNames(gameDir);
  const promised = new Map<string, number>();
  for (const slot of slots) {
    const id = names.get(slot.toLowerCase());
    if (id !== undefined && id >= ADDED_ID_WINDOW.first && id <= ADDED_ID_WINDOW.last) {
      promised.set(slot, id);
    }
  }
  // The ledger is the record; the tree is only the fallback for what a failed run left behind.
  for (const [slot, id] of readAddsLedger(gameDir)) {
    promised.set(slot, id);
  }

  return promised;
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

/** `wg_l_lr_rem1.dff` → `wg_l_lr_rem1`. */
function stem(file: string): string {
  return file.replace(/\.dff$/i, '');
}
