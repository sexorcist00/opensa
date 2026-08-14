import { openArchive } from '@opensa/renderware/archive/img-archive';
/**
 * The emit path: wipe `--out`, copy the `--game` base in (vehicle-installer's pattern), convert every
 * ready car slot and rebuild `models/cutscene.img` with the converted entries, then patch
 * `data/txdcut.ide` (fix R*'s `csopcarla` typo row, add the rows R* left out) so the empty-TXD route
 * (step 6) has a parent for every slot. Vanilla cs TXDs stay in place until step 6.
 *
 * Per-slot conversion failures are collected and reported, never silently skipped. All three branches
 * (car / bike / boat) convert; the branch comes from the slot's `vehicles.ide` type.
 */
import { parseCarcols, type VehicleColours } from '@opensa/renderware/parsers/text/carcols.parser';
import { openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { guardOut } from '@opensa/vehicle-installer/install';
import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { wheelAnimPoses } from './anim-poses';
import { type Census, type CutsceneSlot, loadCensus, matchMods, type SlotReadiness } from './census';
import { bakePaintMarkers, paintColoursFor } from './materials';
import { appendTextures, composePlatePair, PLATE_TOWNS, plateTextFor } from './plate';
import { convertBike } from './rig/bike';
import { convertBoat } from './rig/boat';
import { convertCar } from './rig/car';
import { extractBikeTemplate, extractBoatTemplate, extractCarTemplate } from './template';
import { emptyTxd, referencesPlates, textureNames, unresolvedTextures } from './txd';

export interface CutsceneInstallOptions {
  gamePath: string;
  inPath: string;
  /** Restrict conversion to these donor models / cs names (the CLI's `--only`). */
  only?: ReadonlySet<string>;
  outPath: string;
  /** Plate-text override for ALL slots (default: per-slot deterministic text; plan 003). */
  plate?: string;
  /** Which town's plate background the bake wears (`ls` default — the intro's scenes; plan 003). */
  plateTown?: string;
  /** Escape hatch: on a closure miss, copy the parent TXD into the cs TXD instead of erroring. */
  selfContainedTxd?: boolean;
}

export interface CutsceneInstallSummary {
  converted: string[];
  errors: { csName: string; message: string }[];
  imgBytesAfter: number;
  imgBytesBefore: number;
  /** Per-model count of paint-marker materials baked with the carcols colours (plan 002 step 5). */
  painted: { csName: string; materials: number }[];
  /** Slots whose cs TXD carries a baked readable plate pair, with the composed text (plan 003). */
  plates: { csName: string; text: string }[];
  skipped: { csName: string; reason: string }[];
  /** Total bytes of the emitted `cs*.txd` entries (empty dictionaries unless self-contained). */
  txdBytes: number;
  /** Non-fatal findings, e.g. a mod's PRE-EXISTING texture holes (missing in gameplay too). */
  warnings: { csName: string; message: string }[];
}

interface SlotContext {
  carcols: VehicleColours;
  /** Texture names of the resident generic `models/generic/vehicle.txd`. */
  genericNames: readonly string[];
  /** The resident generic `models/generic/vehicle.txd` bytes — plate-source art lives here. */
  genericTxd: Uint8Array;
  /** The `--game` tree's gta3.img — the txdp parents (the installed mod TXDs) live here. */
  gta3: ReturnType<typeof openArchive>;
  /** Plate-text override (`--plate`), already cut to eight cells; undefined = per-slot text. */
  plateOverride?: string;
  plateTown: (typeof PLATE_TOWNS)[string];
  selfContainedTxd: boolean;
  /** Per cs model: wheel-bone frame-0 anim translations from `anim/cuts.img` (round 16 — the anims'
   *  pose overrides a lying bind; csglendale92 binds its left wheels crossed). */
  wheelPoses: ReadonlyMap<string, ReadonlyMap<string, readonly [number, number, number]>>;
}

/** Build the output game: base copy + converted cutscene.img + patched txdcut.ide. */
export function installCutscene(options: CutsceneInstallOptions): CutsceneInstallSummary {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  const outPath = resolve(options.outPath);
  guardOut(outPath, gamePath, inPath);

  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { force: true, recursive: true });

  const census = loadCensus(gamePath);
  const readiness = matchMods(census.slots, inPath).filter(
    (entry) => !options.only || options.only.has(entry.slot.model) || options.only.has(entry.slot.csName),
  );

  const town = options.plateTown ?? 'ls';
  if (!(town in PLATE_TOWNS)) {
    throw new Error(`--plate-town must be one of ${Object.keys(PLATE_TOWNS).join(' | ')} (got '${town}')`);
  }
  const imgPath = join(outPath, 'models', 'cutscene.img');
  const imgBytesBefore = statSync(imgPath).size;
  const img = openImg(new Uint8Array(readFileSync(imgPath)));
  const genericTxd = new Uint8Array(readFileSync(join(gamePath, 'models', 'generic', 'vehicle.txd')));
  const plateOverride = options.plate === undefined ? undefined : plateTextFor('', options.plate);
  const context: SlotContext = {
    carcols: parseCarcols(readFileSync(join(gamePath, 'data', 'carcols.dat'), 'utf8')),
    genericNames: textureNames(genericTxd),
    genericTxd,
    gta3: openArchive(new Uint8Array(readFileSync(join(gamePath, 'models', 'gta3.img')))),
    ...(plateOverride !== undefined ? { plateOverride } : {}),
    plateTown: PLATE_TOWNS[town],
    selfContainedTxd: options.selfContainedTxd === true,
    wheelPoses: loadWheelPoses(gamePath),
  };

  const summary: CutsceneInstallSummary = {
    converted: [],
    errors: [],
    imgBytesAfter: 0,
    imgBytesBefore,
    painted: [],
    plates: [],
    skipped: [],
    txdBytes: 0,
    warnings: [],
  };
  if (options.plate !== undefined && plateOverride !== undefined && options.plate.length > plateOverride.length) {
    summary.warnings.push({
      csName: '--plate',
      message: `text '${options.plate}' is longer than a plate's 8 cells — truncated to '${plateOverride}'`,
    });
  }
  for (const entry of readiness) {
    convertSlot(entry, img, inPath, context, summary);
  }

  writeImgFile(img, imgPath);
  summary.imgBytesAfter = statSync(imgPath).size;
  patchTxdcut(outPath, census);

  return summary;
}

function convertSlot(
  entry: SlotReadiness,
  img: ReturnType<typeof openImg>,
  inPath: string,
  context: SlotContext,
  summary: CutsceneInstallSummary,
): void {
  const { folder, slot, status } = entry;
  if (status !== 'ready') {
    summary.skipped.push({ csName: slot.csName, reason: status });

    return;
  }
  try {
    const vanilla = img.get(`${slot.csName}.dff`);
    if (!vanilla) {
      throw new Error(`cutscene.img has no ${slot.csName}.dff`);
    }
    const modDff = new Uint8Array(readFileSync(join(inPath, folder!, `${slot.model}.dff`)));
    const { dff } = convertSlotDff(slot.branch, modDff, vanilla, context.wheelPoses.get(slot.csName.toLowerCase()));
    const { baked, bytes } = bakePaintMarkers(dff, paintColoursFor(context.carcols, slot.model));
    const txd = slotTxd(slot, bytes, join(inPath, folder!, `${slot.model}.txd`), context);

    // The plate bake (plan 003): a slot whose model wears the placeholder quads gets a READABLE pair in
    // its own TXD — own-TXD-first resolution overrides the runtime placeholders, zero DFF changes.
    let txdBytes = txd.bytes;
    if (referencesPlates(bytes)) {
      const text = plateTextFor(slot.csName, context.plateOverride);
      const pair = composePlatePair(context.genericTxd, text, context.plateTown);
      txdBytes = appendTextures(txdBytes, [
        { name: 'carplate', raster: pair.carplate },
        { name: 'carpback', raster: pair.carpback },
      ]);
      summary.plates.push({ csName: slot.csName, text });
    }

    img.set(`${slot.csName}.dff`, bytes);
    img.set(`${slot.csName}.txd`, txdBytes);
    summary.txdBytes += txdBytes.byteLength;
    summary.converted.push(slot.csName);
    if (txd.preExisting.length > 0) {
      summary.warnings.push({
        csName: slot.csName,
        message: `pre-existing texture holes (missing in gameplay too): ${txd.preExisting.join(', ')}`,
      });
    }
    if (baked > 0) {
      summary.painted.push({ csName: slot.csName, materials: baked });
    }
  } catch (error) {
    summary.errors.push({ csName: slot.csName, message: (error as Error).message });
  }
}

function convertSlotDff(
  branch: CutsceneSlot['branch'],
  modDff: Uint8Array,
  vanilla: Uint8Array,
  wheelPoses?: ReadonlyMap<string, readonly [number, number, number]>,
): { dff: Uint8Array } {
  if (branch === 'bike') {
    return convertBike(modDff, extractBikeTemplate(vanilla));
  }
  if (branch === 'boat') {
    return convertBoat(modDff, extractBoatTemplate(vanilla));
  }

  return convertCar(modDff, extractCarTemplate(vanilla, wheelPoses));
}

/** The scene wheel poses, or an empty map when the game tree ships no `anim/cuts.img` (test trees). */
function loadWheelPoses(gamePath: string): ReadonlyMap<string, ReadonlyMap<string, readonly [number, number, number]>> {
  const cutsPath = join(gamePath, 'anim', 'cuts.img');
  if (!existsSync(cutsPath)) {
    return new Map();
  }

  return wheelAnimPoses(new Uint8Array(readFileSync(cutsPath)));
}

/**
 * Fix the one known R* typo (`csopcarla, copcarla` names a TXD that does not exist — the model is
 * `cscopcarla`; 001's research record) and append a `txdp` row for every census slot that has none
 * (`cscopcarsf`, `csdinghy`), so each slot's empty TXD can resolve through its parent.
 */
function patchTxdcut(outPath: string, census: Census): void {
  const path = join(outPath, 'data', 'txdcut.ide');
  let text = readFileSync(path, 'utf8');
  text = text.replace(/^csopcarla\s*,\s*copcarla\s*$/m, 'cscopcarla, copcarla');

  const additions = census.slots
    .filter((slot) => rowIsMissing(text, slot))
    .map((slot) => `${slot.csName}, ${slot.txd}`);
  if (additions.length > 0) {
    text = text.replace(/^end\s*$/m, `${additions.join('\n')}\nend`);
  }
  writeFileSync(path, text);
}

function rowIsMissing(text: string, slot: CutsceneSlot): boolean {
  return !new RegExp(`^${slot.csName}\\s*,`, 'm').test(text);
}

/**
 * The slot's `cs*.txd`: EMPTY when the closure resolves through the txdp parent + generic vehicle.txd
 * (the normal case — the pipeline's gta3.img carries the installed mod TXD as the parent). Under
 * `--self-contained-txd` a parent miss embeds the MOD's own TXD instead (the bottle-gate case, where
 * the runtime parent is stock).
 *
 * A name missing even from the MOD's OWN dictionary is a PRE-EXISTING hole (gameplay shows the same
 * white face — three of the real mods ship them: `lights_f`, `t_chrome2`,
 * `vehicle_generic_doorshut2`): reported as a warning, never a failure. A name the mod's TXD HAS but
 * the parent chain lacks is actionable (the base is not installed / no self-contained flag) — that one
 * still fails the slot.
 */
function slotTxd(
  slot: CutsceneSlot,
  dff: Uint8Array,
  modTxdPath: string,
  context: SlotContext,
): { bytes: Uint8Array; preExisting: string[] } {
  const parent = context.gta3.get(`${slot.txd}.txd`);
  const parentNames = parent ? textureNames(new Uint8Array(parent)) : [];
  const parentChain = new Set([...context.genericNames, ...parentNames]);
  const modTxd = new Uint8Array(readFileSync(modTxdPath));
  const fullChain = new Set([...parentChain, ...textureNames(modTxd)]);

  const preExisting = unresolvedTextures(dff, fullChain);
  const fixable = unresolvedTextures(dff, parentChain).filter((name) => !preExisting.includes(name));
  if (fixable.length === 0) {
    return { bytes: emptyTxd(), preExisting };
  }
  if (context.selfContainedTxd) {
    return { bytes: modTxd, preExisting };
  }
  throw new Error(`unresolved textures (txdp parent ${slot.txd}.txd): ${fixable.join(', ')}`);
}
