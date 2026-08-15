import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two shapes a `mods-src/<game>/vehicles` folder may have (vehicle-installer plan 007).
 *
 * **Flat** — every immediate subfolder is a car, and all of them install. What most games ship.
 *
 * **Structured** — the immediate subfolders are `models/` (the installed fleet), `new/` (candidates) and
 * `screenshots/` (pictures, never installed); all optional. A car in `new/` **replaces** the `models/` car
 * that holds the same SLOT, so trying a replacement costs no rename, move or deletion of the incumbent.
 */
export const VEHICLE_MODELS_DIR = 'models';

/** The higher-priority layer: a car here wins the slot over the same slot in `models/`. */
export const VEHICLE_NEW_DIR = 'new';

/** Reserved siblings that hold no cars — present in the tree, never scanned for a mod. */
export const VEHICLE_ASSET_DIRS: readonly string[] = ['screenshots'];

/** A layer that holds cars. */
export type VehicleLayer = typeof VEHICLE_MODELS_DIR | typeof VEHICLE_NEW_DIR;

/** The layers that hold cars, in apply order (later wins the slot). */
const VEHICLE_LAYERS: readonly VehicleLayer[] = [VEHICLE_MODELS_DIR, VEHICLE_NEW_DIR];

/** Every reserved top-level folder name of a structured tree. */
const RESERVED_DIRS: readonly string[] = [...VEHICLE_LAYERS, ...VEHICLE_ASSET_DIRS];

export interface VehicleSource {
  /** Absolute-or-caller-relative path of the car folder — what `applyVehicle` is handed. */
  readonly folder: string;
  /** The folder's own name (`admiral - 1976 Mercedes-Benz 230 - k1real24`). */
  readonly name: string;
  /** Which layer it came from; `flat` for an unlayered tree. */
  readonly origin: 'flat' | VehicleLayer;
  /** The game model slot this car takes over, case-folded — see {@link parseVehicleSlot}. */
  readonly slot: string;
}

export interface VehicleSourcePlan {
  /** What a `new/` car displaced — logged by the caller, because a fleet that changed silently is the bug. */
  readonly overrides: readonly { readonly by: string; readonly replaced: string; readonly slot: string }[];
  /** The cars to install, ordered by folder name (case-insensitive); one entry per slot. */
  readonly sources: readonly VehicleSource[];
  readonly strategy: 'flat' | 'structured';
}

/**
 * The model slot a vehicle mod folder claims: everything before the first ` - `, trimmed and lowercased
 * (`admiral - 1976 Mercedes-Benz 230 - k1real24` → `admiral`). A name without the separator IS the slot.
 *
 * **Read from the folder, not from the `.dff` inside**, and that is the whole point: 13 of the original's
 * 212 car folders ship several `.dff`s (a bodykit — `exh_a_l.dff`, `spl_c_l_b.dff` …), and in 10 of them the
 * first one alphabetically is a bodykit part rather than the car. The folder name is the one place the
 * author states the slot once. Contract: `docs/contracts/vehicles.md` §1.
 */
export function parseVehicleSlot(folderName: string): string {
  const [slot] = folderName.split(' - ');

  return (slot ?? folderName).trim().toLowerCase();
}

/**
 * Classify the immediate subfolders of a `vehicles` tree: flat, or the reserved folders of a structured one
 * (`models`/`new` → the folder as it is actually spelled on disk).
 *
 * Two things are refused rather than guessed, because either would install a fleet nobody asked for and say
 * nothing about it:
 *
 * - **a stray folder beside the reserved ones** — that is what a misspelled `New/` or `model/` looks like,
 *   and it is also a car folder left at the top level of a structured tree;
 * - **two reserved folders differing only in case** (`new/` + `New/`) — ONE folder on macOS and Windows, so
 *   a case variant must not become a second layer, and must not silently lose to the other either.
 */
export function planVehicleLayers(entries: readonly string[]): Map<string, string> | undefined {
  const reserved = new Map<string, string[]>();
  const strays: string[] = [];
  for (const entry of entries) {
    const folded = entry.toLowerCase();
    if (RESERVED_DIRS.includes(folded)) {
      reserved.set(folded, [...(reserved.get(folded) ?? []), entry]);
    } else {
      strays.push(entry);
    }
  }

  if (reserved.size === 0) {
    return undefined;
  }
  if (strays.length > 0) {
    throw new Error(
      `--in mixes the reserved vehicle folders (${[...reserved.keys()].join(', ')}) with plain car ` +
        `folder(s): ${strays.join(', ')}. A structured vehicles folder holds ONLY ` +
        `${RESERVED_DIRS.join(', ')}; move those into a layer (a misspelled folder name lands here too)`,
    );
  }
  const duplicated = [...reserved.values()].filter((folders) => folders.length > 1);
  if (duplicated.length > 0) {
    throw new Error(
      `--in carries the same reserved vehicle folder twice, differing only in case: ` +
        duplicated.map((folders) => folders.join(' / ')).join('; '),
    );
  }

  return new Map([...reserved].map(([name, folders]) => [name, folders[0]]));
}

/**
 * Decide which car folders install, and in what order, from a `vehicles` source tree: every subfolder of a
 * flat tree, or `models/` overridden per SLOT by `new/` in a structured one.
 *
 * On top of what {@link planVehicleLayers} refuses, **two folders in one layer claiming the same slot** is
 * refused as well — the loser would be installed and then overwritten by whichever came last alphabetically,
 * which is a coin toss nobody can see in a folder listing.
 */
export function resolveVehicleSources(inPath: string): VehicleSourcePlan {
  const entries = subdirectories(inPath);
  const reserved = planVehicleLayers(entries);
  if (reserved === undefined) {
    return { overrides: [], sources: layerSources(inPath, undefined, entries), strategy: 'flat' };
  }

  const bySlot = new Map<string, VehicleSource>();
  const overrides: { by: string; replaced: string; slot: string }[] = [];
  for (const layer of VEHICLE_LAYERS) {
    const subdir = reserved.get(layer);
    if (subdir === undefined) {
      continue;
    }
    const layerPath = join(inPath, subdir);
    for (const source of layerSources(layerPath, layer, subdirectories(layerPath))) {
      const incumbent = bySlot.get(source.slot);
      if (incumbent?.origin === source.origin) {
        throw new Error(
          `${subdir}/ carries two cars for the slot '${source.slot}': ` +
            `${incumbent.name} and ${source.name}. One folder per slot per layer`,
        );
      }
      if (incumbent) {
        overrides.push({ by: source.name, replaced: incumbent.name, slot: source.slot });
      }
      bySlot.set(source.slot, source);
    }
  }

  return { overrides, sources: byName([...bySlot.values()]), strategy: 'structured' };
}

function byName(sources: readonly VehicleSource[]): VehicleSource[] {
  return [...sources].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en'));
}

/** The car folders of one layer (or of a flat tree, `origin: 'flat'`), ordered by name. */
function layerSources(path: string, layer: undefined | VehicleLayer, entries: readonly string[]): VehicleSource[] {
  return byName(
    entries.map((name) => ({
      folder: join(path, name),
      name,
      origin: layer ?? 'flat',
      slot: parseVehicleSlot(name),
    })),
  );
}

/** The immediate subfolder names of a directory. */
function subdirectories(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
