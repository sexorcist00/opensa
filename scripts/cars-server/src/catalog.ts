import type { BuildTarget } from '@opensa/tool-kit/target';

import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { parseVehicleSlot, resolveVehicleSources, type VehicleSource } from '@opensa/tool-kit/vehicles-dir';
import { decodeSettings, parseVehicleSettings } from '@opensa/vehicle-installer/settings';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { vehicleTags } from './tags';

export interface Catalog {
  /** Installed cars with NO screenshot under their slot (`new/` candidates excluded — theirs is withheld on
   *  purpose), in page order — the warning at the top of the page. */
  readonly missingShots: readonly MissingShot[];
  /** The `screenshots/` folders read, one per applied layer in apply order (`common` first) — for the header. */
  readonly screenshotDirs: readonly string[];
  /** Slot → the screenshot's absolute path (only for slots that have one). */
  readonly screenshots: ReadonlyMap<string, string>;
  readonly sections: readonly CatalogSection[];
  /** Slot → the stock car's `data:` URI. */
  readonly stockImages: ReadonlyMap<string, string>;
  /** How the vehicles folder is shaped — a layered one is what makes the target matter. */
  readonly strategy: 'flat' | 'layered' | 'structured';
  readonly total: number;
  /** Cars whose slot the metadata does not know — shown last, under their own heading. */
  readonly unknownSection: string;
}

export interface CatalogCar {
  /** The mod author — the folder name's third field. */
  readonly author: string;
  /** For an ADDED car: the stock slot(s) it varies, out of the folder name's `(base)` suffix. */
  readonly bases?: readonly string[];
  /** What the mod actually is — the folder name's second field. */
  readonly carName: string;
  /** The folder name, verbatim. */
  readonly folder: string;
  /** `true` when the stock metadata has a picture for this slot. */
  readonly hasOriginal: boolean;
  /** `true` when a field screenshot was found for this slot. */
  readonly hasShot: boolean;
  /** The `vehicles.ide` id — the mod's own row, else the stock one, else `null`. */
  readonly id: null | number;
  /** `true` when the build takes this car out of `new/` rather than out of `models/`. */
  readonly isCandidate: boolean;
  /** The game model slot this car takes over. */
  readonly slot: string;
  readonly tags: readonly string[];
}

export interface CatalogSection {
  /** URL fragment for the section jump list. */
  readonly anchor: string;
  readonly cars: readonly CatalogCar[];
  readonly name: string;
}

/** The bundled `data/original.json`: section name → the stock cars it holds. */
export type Metadata = Record<string, { items: MetadataItem[] }>;

export interface MissingShot {
  /** The screenshot filename to SAVE — the car's folder name + `.png` (any of {@link SHOT_EXTENSIONS} is read;
   *  matched by SLOT, so a name typo still joins). */
  readonly expectedFile: string;
  /** The car folder, with its layer when there is one (`sa/models/admiral - …`). */
  readonly folder: string;
  /** The section anchor + slot, so the warning can jump to the card. */
  readonly sectionAnchor: string;
  readonly slot: string;
}

/** One item of the bundled metadata: the STOCK car, keyed by the slot it occupies. */
interface MetadataItem {
  /** A `data:` URI — the stock car's picture. The bundled `src` (a wiki URL) is deliberately not used. */
  readonly image: string;
  /** The model slot (`admiral`). */
  readonly name: string;
  readonly section: string;
  readonly src?: string;
}

/** Where a car with no metadata section lands, so nothing is silently dropped from the page. */
const UNKNOWN_SECTION = 'Not in the metadata';

/**
 * The ADDED cars' own section. They are not in the stock metadata by definition — they hold ids the game
 * never had — so putting them in the catch-all would read as a fault when it is the whole point of them.
 */
const ADDED_SECTION = 'Added vehicles';

/** What counts as a screenshot; the same slot may be a `.png` in `common/` and a `.jpg` in `sa/`. */
const SHOT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

/** The pictures folder beside the cars — at the tree's root, or inside EACH build layer of a layered tree. */
const SCREENSHOTS_DIR = 'screenshots';

export interface CatalogOptions {
  /** `mods-src/<game>/add-vehicles` — the ADDED fleet, shown in its own section (central plan 102). */
  readonly addedPath?: string;
  /** `game-src/<game>` — read for the stock `vehicles.ide` when a mod declares no id of its own. */
  readonly gamePath: string;
  /** The bundled metadata, already parsed. */
  readonly metadata: Metadata;
  /** Which layer of a LAYERED vehicles folder is shown after `common` — the target the page describes. */
  readonly target?: BuildTarget;
  /** `mods-src/<game>/vehicles`. */
  readonly vehiclesPath: string;
}

/**
 * Join the three sources into what the page renders: the bundled stock metadata, the installed fleet
 * (`resolveVehicleSources`, so this is exactly the fleet the build installs) and the field screenshots.
 *
 * **The join key is the SLOT, never the folder name.** All three sets line up 1:1 by slot on the real tree,
 * but five screenshots do not match their folder's name character for character
 * (`at400 - Boeing 727-100 Liveries- carcer.png` lost a space) — a filename join loses those five and looks
 * like missing screenshots.
 *
 * The fleet is the resolver's, `new/` candidates included, because that is what the build installs — but a
 * candidate is MARKED and gets no screenshot: the picture filed under its slot is of the car it displaced.
 *
 * Screenshots follow the layers the fleet does: a flat/structured tree has ONE `screenshots/` at its root; a
 * layered tree has one per layer, and **a car's picture is read from its OWN layer only** — a `sa/models/x`
 * car looks in `sa/screenshots/`, never in `common/screenshots/` (the picture filed there under its slot is of
 * the `common` car it displaced — the same lie a `new/` candidate's incumbent picture would be). A car
 * without a picture in its layer is reported missing. The other target's folder is never read.
 */
export function buildCatalog(options: CatalogOptions): Catalog {
  const stockImages = new Map<string, string>();
  const sectionOf = new Map<string, string>();
  for (const [section, { items }] of Object.entries(options.metadata)) {
    for (const item of items) {
      const slot = item.name.trim().toLowerCase();
      stockImages.set(slot, item.image);
      sectionOf.set(slot, section);
    }
  }

  const plan = resolveVehicleSources(options.vehiclesPath, options.target);
  // One index per applied layer, keyed by the layer name (`flat` for an unlayered tree); a car reads its own.
  const shotsByLayer = new Map<string, Map<string, string>>();
  const screenshotDirs: string[] = [];
  for (const layer of plan.layers) {
    const directory = join(options.vehiclesPath, layer.subdir ?? '', SCREENSHOTS_DIR);
    screenshotDirs.push(directory);
    shotsByLayer.set(layer.name, indexScreenshots(directory));
  }
  const screenshots = new Map<string, string>();
  const stockIds = stockVehicleIds(options.gamePath);
  const bySection = new Map<string, CatalogCar[]>();
  const missing: (Omit<MissingShot, 'sectionAnchor'> & { section: string })[] = [];
  let total = 0;
  for (const source of plan.sources) {
    const car = describe(source.folder, source.name, source.slot, stockIds);
    const section = sectionOf.get(source.slot) ?? UNKNOWN_SECTION;
    // A `new/` candidate is shown because the BUILD installs it — dropping it would leave the slot's
    // incumbent on the page under a car the build no longer ships. Its screenshot is withheld: the picture
    // in `screenshots/` is of the car it displaced, and showing that under the candidate is a lie.
    const isCandidate = source.origin === 'new';
    const shot = shotsByLayer.get(source.layer ?? 'flat')?.get(source.slot);
    const hasShot = shot !== undefined;
    if (hasShot) {
      screenshots.set(source.slot, shot);
    }
    if (!isCandidate && !hasShot) {
      missing.push({
        expectedFile: `${source.name}${SHOT_EXTENSIONS[0]}`,
        folder: sourceLabel(source),
        section,
        slot: source.slot,
      });
    }
    bySection.set(section, [
      ...(bySection.get(section) ?? []),
      {
        ...car,
        hasOriginal: stockImages.has(source.slot),
        hasShot: !isCandidate && hasShot,
        isCandidate,
      },
    ]);
    total += 1;
  }

  // The ADDED fleet, through the same resolver and the same screenshot rules — its own root, its own
  // section, and its cars keyed by the slot they invented rather than one the metadata could know.
  for (const source of addedSources(options.addedPath, options.target)) {
    const shot = indexScreenshots(join(options.addedPath ?? '', SCREENSHOTS_DIR)).get(source.slot);
    if (shot !== undefined) {
      screenshots.set(source.slot, shot);
    } else {
      missing.push({
        expectedFile: `${source.name}${SHOT_EXTENSIONS[0]}`,
        folder: sourceLabel(source),
        section: ADDED_SECTION,
        slot: source.slot,
      });
    }
    bySection.set(ADDED_SECTION, [
      ...(bySection.get(ADDED_SECTION) ?? []),
      {
        ...describe(source.folder, source.name, source.slot, stockIds),
        bases: source.bases,
        hasOriginal: false,
        hasShot: shot !== undefined,
        isCandidate: source.origin === 'new',
      },
    ]);
    total += 1;
  }
  if (options.addedPath !== undefined && bySection.has(ADDED_SECTION)) {
    screenshotDirs.push(join(options.addedPath, SCREENSHOTS_DIR));
  }

  // Section order is the metadata's own (`Sports Cars` first, as authored), with the catch-all last.
  const ordered = [...Object.keys(options.metadata), ADDED_SECTION, UNKNOWN_SECTION].filter((name) =>
    bySection.has(name),
  );
  const missingShots = ordered.flatMap((section) =>
    missing
      .filter((entry) => entry.section === section)
      .sort((a, b) => a.slot.localeCompare(b.slot, 'en'))
      .map(({ expectedFile, folder, slot }) => ({ expectedFile, folder, sectionAnchor: anchorOf(section), slot })),
  );

  return {
    missingShots,
    screenshotDirs,
    screenshots,
    sections: ordered.map((name) => ({
      anchor: anchorOf(name),
      cars: (bySection.get(name) ?? []).sort((a, b) => a.slot.localeCompare(b.slot, 'en')),
      name,
    })),
    stockImages,
    strategy: plan.strategy,
    total,
    unknownSection: UNKNOWN_SECTION,
  };
}

/** The added fleet, resolved the same way the replacement fleet is; empty when no root was given. */
function addedSources(addedPath: string | undefined, target: BuildTarget | undefined): readonly VehicleSource[] {
  if (addedPath === undefined || !existsSync(addedPath)) {
    return [];
  }

  return resolveVehicleSources(addedPath, target).sources;
}

/** URL fragment for a section heading. */
function anchorOf(section: string): string {
  return section
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Read one car folder: the three name fields, the id it declares, and what it ships. */
function describe(
  folderPath: string,
  folderName: string,
  slot: string,
  stockIds: ReadonlyMap<string, number>,
): Omit<CatalogCar, 'hasOriginal' | 'hasShot' | 'isCandidate'> {
  const [, carName = '', author = ''] = folderName.split(' - ').map((field) => field.trim());
  const dirents = readdirSync(folderPath, { withFileTypes: true });
  const entries = dirents.map((entry) => entry.name);
  const settingsFile = entries.find((name) => name.toLowerCase().endsWith('.settings.txt'));
  const settings = settingsFile
    ? parseVehicleSettings(decodeSettings(readFileSync(join(folderPath, settingsFile))), ignoreWarning)
    : {};
  const declaredId = Number(settings.ideLine?.split(',')[0]?.trim());

  return {
    author,
    carName,
    folder: folderName,
    id: Number.isFinite(declaredId) ? declaredId : (stockIds.get(slot) ?? null),
    slot,
    tags: vehicleTags(
      {
        entries,
        hasCleo: dirents.some((entry) => entry.isDirectory() && entry.name.toLowerCase() === 'cleo'),
        slot,
      },
      settings,
    ),
  };
}

/** The page reports what a mod SHIPS, not what its settings file failed to parse — that is the installer's job. */
function ignoreWarning(): void {
  return undefined;
}

/** Slot → screenshot path. Matched on the slot, so a name typo in the picture still finds its car. */
function indexScreenshots(directory: string): Map<string, string> {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return new Map();
  }
  const shots = new Map<string, string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    if (!entry.isFile() || !SHOT_EXTENSIONS.includes(extension)) {
      continue;
    }
    shots.set(parseVehicleSlot(entry.name.slice(0, entry.name.lastIndexOf('.'))), join(directory, entry.name));
  }

  return shots;
}

/** `sa/models/<name>` for a layered source, `models/<name>` for a structured one, the name for a flat one. */
function sourceLabel(source: VehicleSource): string {
  return [source.layer, source.origin === 'flat' ? undefined : source.origin, source.name]
    .filter((part): part is string => part !== undefined)
    .join('/');
}

/** The stock `vehicles.ide` ids, so a mod that declares no ide row still shows the id it takes over. */
function stockVehicleIds(gamePath: string): Map<string, number> {
  const path = join(gamePath, 'data', 'vehicles.ide');
  if (!existsSync(path)) {
    return new Map();
  }
  const ids = new Map<string, number>();
  for (const def of parseVehicleDefs(readFileSync(path, 'utf8')).values()) {
    ids.set(def.model.toLowerCase(), def.id);
  }

  return ids;
}
