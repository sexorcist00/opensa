import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseFeatures } from './features';
import { mergeVehicleImg } from './img-merge';
import { mergeCarcols, mergeCarmods, mergeHandling, mergeIde } from './merge';
import { addPaletteColors, resolveColorRefs } from './palette';
import { decodeSettings, parseVehicleSettings } from './settings';

/** The mod's own feature declaration, by the Modloader/IVF name. */
const FEATURES_FILE = 'features.txt';

/** What one vehicle contributed — its gta3.img entries + the keys `--strip` keeps (model name, handling id). */
export interface AppliedVehicle {
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

/**
 * Install one vehicle over `--out`: put its `dff`/`txd` (+ extra txds) into `models/gta3.img` (replace by name),
 * then merge its `*.settings.txt` lines into `data/{vehicles.ide,handling.cfg,carcols.dat,carmods.dat}`. Returns
 * the archive entries written + the model name / handling id (so a `--strip` run knows what to keep).
 */
export function applyVehicle(folderPath: string, outPath: string): AppliedVehicle {
  const imgNames = mergeVehicleImg(folderPath, join(outPath, 'models', 'gta3.img'));
  const model = imgNames.find((name) => name.endsWith('.dff'))?.replace(/\.dff$/, '');

  const entries = readdirSync(folderPath);
  // `features.txt` sits in the same folder and also ends in `.txt` — taking the FIRST `.txt` picked it over
  // `previon.settings.txt` (alphabetical order) and the car lost its whole settings file.
  const featuresFile = entries.find((name) => name.toLowerCase() === FEATURES_FILE);
  const features = featuresFile ? parseFeatures(readFileSync(join(folderPath, featuresFile), 'utf8')) : [];
  const settingsFile =
    entries.find((name) => name.toLowerCase().endsWith('.settings.txt')) ??
    entries.find((name) => name.toLowerCase().endsWith('.txt') && name.toLowerCase() !== FEATURES_FILE);
  if (!settingsFile) {
    return { features, imgNames, model, warnings: [] };
  }
  const warnings: string[] = [];
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

  return { features, handlingId: handlingId(settings, model), imgNames, model, warnings };
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
