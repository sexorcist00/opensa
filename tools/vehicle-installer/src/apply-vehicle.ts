import type { EditableImg } from '@opensa/tool-kit/archive/img';

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { parseFeatures } from './features';
import { stageVehicleImg } from './img-merge';
import { mergeCarcols, mergeCarmods, mergeHandling, mergeIde } from './merge';
import { resolveVehicleModel } from './model';
import { addPaletteColors, resolveColorRefs } from './palette';
import { decodeSettings, parseVehicleSettings } from './settings';
import { applyTuningParts, TUNING_PARTS_FILE } from './tuning-parts';

/** The mod's own feature declaration, by the Modloader/IVF name. */
const FEATURES_FILE = 'features.txt';

/** What one vehicle contributed — its gta3.img entries + the keys `--strip` keeps (model name, handling id). */
export interface AppliedVehicle {
  /** Files carried from the mod's `cleo/` subfolder into `<out>/cleo/` (dest paths relative to it). */
  cleo: string[];
  /** What the mod's `features.txt` declares (uppercased tokens) — empty when it ships none. */
  features: string[];
  /** Handling id (uppercase) from the ide line's col 4 / the handling line / the model — for handling.cfg strip. */
  handlingId?: string;
  /** gta3.img entry names written (lowercased dff/txd). */
  imgNames: string[];
  /** Model name (lowercased, the dff basename) — for vehicles.ide / carcols.dat / carmods.dat strip. */
  model?: string;
  /** What the settings file lost on the way in — every one of these is data the car will run STOCK without. */
  warnings: string[];
}

export interface ApplyVehicleOptions {
  /**
   * The open `models/gta3.img` to stage the folder's `dff`/`txd` into. **The caller owns it and writes it
   * once**, after every vehicle has been staged — one archive rebuild per RUN instead of one per car.
   *
   * Omitted means the archive is not touched at all, which is what a REBAKE wants: its target is a CONVERTED
   * tree, where a car is one `.osm` and the pack has already deleted the `.dff`/`.txd` it was built from.
   * Writing the raw pair back would add entries the game does not read and cannot be told apart from a
   * half-converted archive.
   */
  img?: EditableImg;
}

/**
 * Install one vehicle over `--out`: stage its `dff`/`txd` (+ extra txds) into `models/gta3.img` (replace by name),
 * carry its `cleo/` subfolder (scripts + `.ini` sidecars) into `<out>/cleo/`, then merge its `*.settings.txt`
 * lines into `data/{vehicles.ide,handling.cfg,carcols.dat,carmods.dat}`. Returns the archive entries written +
 * the model name / handling id (so a `--strip` run knows what to keep). A rebake re-runs the same path, so
 * changed scripts re-copy with the mod (plan 097/06 decision 3).
 */
export function applyVehicle(folderPath: string, outPath: string, options: ApplyVehicleOptions = {}): AppliedVehicle {
  const entries = readdirSync(folderPath);
  const imgNames = options.img === undefined ? [] : stageVehicleImg(folderPath, options.img);
  const cleo = carryCleoFolder(folderPath, entries, outPath);
  // The slot the folder NAME states, confirmed against the `.dff`s it ships — a bodykit folder ships several
  // and the first of them is not the car (see `resolveVehicleModel`). Without the archive step the file list
  // comes from the folder itself, which is what a rebake wants.
  const { model, warning: modelWarning } = resolveVehicleModel(
    basename(folderPath),
    options.img === undefined ? entries : imgNames,
  );

  // `features.txt` sits in the same folder and also ends in `.txt` — taking the FIRST `.txt` picked it over
  // `previon.settings.txt` (alphabetical order) and the car lost its whole settings file.
  const featuresFile = entries.find((name) => name.toLowerCase() === FEATURES_FILE);
  // Same decode as the settings file: a features file saved as UTF-16 must not read as a wall of NULs.
  const features = featuresFile ? parseFeatures(decodeSettings(readFileSync(join(folderPath, featuresFile)))) : [];
  const settingsFile =
    entries.find((name) => name.toLowerCase().endsWith('.settings.txt')) ??
    entries.find(
      (name) => name.toLowerCase().endsWith('.txt') && ![FEATURES_FILE, TUNING_PARTS_FILE].includes(name.toLowerCase()),
    );
  const warnings: string[] = modelWarning ? [modelWarning] : [];
  // New tuning parts (IDE rows + shop entries) — independent of the settings file, and applied FIRST so
  // the carmods line merged below never names a part the tree does not define.
  warnings.push(...applyTuningParts(folderPath, entries, outPath));
  if (!settingsFile) {
    return { cleo, features, imgNames, model, warnings };
  }
  const settings = parseVehicleSettings(decodeSettings(readFileSync(join(folderPath, settingsFile))), (message) =>
    warnings.push(`${settingsFile}: ${message}`),
  );
  // Nothing at all recognised is the loud case: the file exists, the mod meant something by it, and the car is
  // about to run stock data under a mod model.
  if (Object.keys(settings).length === 0) {
    warnings.push(`${settingsFile}: nothing recognised — the car keeps STOCK handling/ide/carcols`);
  }
  const data = (name: string): string => join(outPath, 'data', name);

  if (settings.ideLine !== undefined) {
    editFile(data('vehicles.ide'), (text) => mergeIde(text, settings.ideLine!));
  }
  if (settings.handlingLine !== undefined) {
    editFile(data('handling.cfg'), (text) => mergeHandling(text, settings.handlingLine!));
  }
  // Palette + carcols both edit carcols.dat: append any custom colours (assigning ids), then merge the carcols
  // line with its `newN` refs resolved to those ids.
  if (settings.palette?.length || settings.carcolsLine !== undefined) {
    editFile(data('carcols.dat'), (text) => {
      const { idByName, text: withColors } = addPaletteColors(text, settings.palette ?? []);

      return settings.carcolsLine === undefined
        ? withColors
        : mergeCarcols(withColors, resolveColorRefs(settings.carcolsLine, idByName));
    });
  }
  if (settings.carmodsLine !== undefined) {
    editFile(data('carmods.dat'), (text) => mergeCarmods(text, settings.carmodsLine!));
  }

  return { cleo, features, handlingId: handlingId(settings, model), imgNames, model, warnings };
}

/**
 * Copy the mod's `cleo`/`CLEO` subfolder into `<out>/cleo/` (canonical lowercase, author-relative structure
 * preserved — `.ini` sidecars ride along). Returns the dest paths relative to `<out>/cleo/`.
 */
function carryCleoFolder(folderPath: string, entries: string[], outPath: string): string[] {
  const cleoDir = entries.find(
    (name) => name.toLowerCase() === 'cleo' && statSync(join(folderPath, name)).isDirectory(),
  );
  if (cleoDir === undefined) {
    return [];
  }
  const carried: string[] = [];
  const copyTree = (srcDir: string, rel: string): void => {
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      const src = join(srcDir, entry.name);
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        copyTree(src, relPath);
      } else {
        const dest = join(outPath, 'cleo', relPath);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(src));
        carried.push(relPath);
        console.log(`vehicle-installer: cleo → cleo/${relPath}`);
      }
    }
  };
  copyTree(join(folderPath, cleoDir), '');

  return carried;
}

function editFile(path: string, edit: (text: string) => string): void {
  if (existsSync(path)) {
    writeFileSync(path, edit(readFileSync(path, 'utf8')));
  }
}

/** The handling id this vehicle keys into handling.cfg: the ide line's col 4, else the handling line's id, else
 *  the model uppercased. */
function handlingId(settings: ReturnType<typeof parseVehicleSettings>, model: string | undefined): string | undefined {
  const fromIde = settings.ideLine?.split(',')[4]?.trim();
  const fromHandling = settings.handlingLine?.trim().split(/\s+/)[0];

  return (fromIde || fromHandling || model)?.toUpperCase();
}
