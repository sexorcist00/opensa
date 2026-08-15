import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { parseVehicleSlot, resolveVehicleSources } from '@opensa/tool-kit/vehicles-dir';
import { decodeSettings, parseVehicleSettings } from '@opensa/vehicle-installer/settings';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { vehicleTags } from './tags';

export interface Catalog {
  /** Slot → the screenshot's absolute path (only for slots that have one). */
  readonly screenshots: ReadonlyMap<string, string>;
  readonly sections: readonly CatalogSection[];
  /** Slot → the stock car's `data:` URI. */
  readonly stockImages: ReadonlyMap<string, string>;
  readonly total: number;
  /** Cars whose slot the metadata does not know — shown last, under their own heading. */
  readonly unknownSection: string;
}

export interface CatalogCar {
  /** The mod author — the folder name's third field. */
  readonly author: string;
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

const SHOT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export interface CatalogOptions {
  /** `game-src/<game>` — read for the stock `vehicles.ide` when a mod declares no id of its own. */
  readonly gamePath: string;
  /** The bundled metadata, already parsed. */
  readonly metadata: Metadata;
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

  const screenshots = indexScreenshots(join(options.vehiclesPath, 'screenshots'));
  const stockIds = stockVehicleIds(options.gamePath);
  const bySection = new Map<string, CatalogCar[]>();
  let total = 0;
  for (const source of resolveVehicleSources(options.vehiclesPath).sources) {
    const car = describe(source.folder, source.name, source.slot, stockIds);
    const section = sectionOf.get(source.slot) ?? UNKNOWN_SECTION;
    // A `new/` candidate is shown because the BUILD installs it — dropping it would leave the slot's
    // incumbent on the page under a car the build no longer ships. Its screenshot is withheld: the picture
    // in `screenshots/` is of the car it displaced, and showing that under the candidate is a lie.
    const isCandidate = source.origin === 'new';
    bySection.set(section, [
      ...(bySection.get(section) ?? []),
      {
        ...car,
        hasOriginal: stockImages.has(source.slot),
        hasShot: !isCandidate && screenshots.has(source.slot),
        isCandidate,
      },
    ]);
    total += 1;
  }

  // Section order is the metadata's own (`Sports Cars` first, as authored), with the catch-all last.
  const ordered = [...Object.keys(options.metadata), UNKNOWN_SECTION].filter((name) => bySection.has(name));

  return {
    screenshots,
    sections: ordered.map((name) => ({
      anchor: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      cars: (bySection.get(name) ?? []).sort((a, b) => a.slot.localeCompare(b.slot, 'en')),
      name,
    })),
    stockImages,
    total,
    unknownSection: UNKNOWN_SECTION,
  };
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
