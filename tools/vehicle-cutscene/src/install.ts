import { openArchive } from '@opensa/renderware/archive/img-archive';
/**
 * The emit path: wipe `--out`, copy the `--game` base in (vehicle-installer's pattern), convert every
 * ready car slot and rebuild `models/cutscene.img` with the converted entries, then patch
 * `data/txdcut.ide` (fix R*'s `csopcarla` typo row, add the rows R* left out) so the empty-TXD route
 * (step 6) has a parent for every slot. Vanilla cs TXDs stay in place until step 6.
 *
 * Per-slot conversion failures are collected and reported, never silently skipped; bike/boat slots are
 * reported as pending their branches (plan 002 steps 8/9).
 */
import { parseCarcols, type VehicleColours } from '@opensa/renderware/parsers/text/carcols.parser';
import { openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { guardOut } from '@opensa/vehicle-installer/install';
import { cpSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { type Census, type CutsceneSlot, loadCensus, matchMods, type SlotReadiness } from './census';
import { bakePaintMarkers, paintColoursFor } from './materials';
import { convertCar } from './rig/car';
import { extractCarTemplate } from './template';
import { emptyTxd, textureNames, unresolvedTextures } from './txd';

export interface CutsceneInstallOptions {
  gamePath: string;
  inPath: string;
  /** Restrict conversion to these donor models / cs names (the CLI's `--only`). */
  only?: ReadonlySet<string>;
  outPath: string;
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
  skipped: { csName: string; reason: string }[];
  /** Total bytes of the emitted `cs*.txd` entries (empty dictionaries unless self-contained). */
  txdBytes: number;
}

interface SlotContext {
  carcols: VehicleColours;
  /** Texture names of the resident generic `models/generic/vehicle.txd`. */
  genericNames: readonly string[];
  /** The `--game` tree's gta3.img — the txdp parents (the installed mod TXDs) live here. */
  gta3: ReturnType<typeof openArchive>;
  selfContainedTxd: boolean;
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

  const imgPath = join(outPath, 'models', 'cutscene.img');
  const imgBytesBefore = statSync(imgPath).size;
  const img = openImg(new Uint8Array(readFileSync(imgPath)));
  const context: SlotContext = {
    carcols: parseCarcols(readFileSync(join(gamePath, 'data', 'carcols.dat'), 'utf8')),
    genericNames: textureNames(new Uint8Array(readFileSync(join(gamePath, 'models', 'generic', 'vehicle.txd')))),
    gta3: openArchive(new Uint8Array(readFileSync(join(gamePath, 'models', 'gta3.img')))),
    selfContainedTxd: options.selfContainedTxd === true,
  };

  const summary: CutsceneInstallSummary = {
    converted: [],
    errors: [],
    imgBytesAfter: 0,
    imgBytesBefore,
    painted: [],
    skipped: [],
    txdBytes: 0,
  };
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
  if (slot.branch !== 'car') {
    summary.skipped.push({ csName: slot.csName, reason: `${slot.branch} branch pending (plan 002 step 8/9)` });

    return;
  }
  try {
    const vanilla = img.get(`${slot.csName}.dff`);
    if (!vanilla) {
      throw new Error(`cutscene.img has no ${slot.csName}.dff`);
    }
    const template = extractCarTemplate(vanilla);
    const modDff = new Uint8Array(readFileSync(join(inPath, folder!, `${slot.model}.dff`)));
    const { dff } = convertCar(modDff, template);
    const { baked, bytes } = bakePaintMarkers(dff, paintColoursFor(context.carcols, slot.model));
    const txd = slotTxd(slot, bytes, join(inPath, folder!, `${slot.model}.txd`), context);

    img.set(`${slot.csName}.dff`, bytes);
    img.set(`${slot.csName}.txd`, txd);
    summary.txdBytes += txd.byteLength;
    summary.converted.push(slot.csName);
    if (baked > 0) {
      summary.painted.push({ csName: slot.csName, materials: baked });
    }
  } catch (error) {
    summary.errors.push({ csName: slot.csName, message: (error as Error).message });
  }
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
 * `--self-contained-txd` a closure miss embeds the MOD's own TXD instead (the bottle-gate case, where
 * the runtime parent is stock); the chain cs-TXD → parent → generic must then close, or the slot still
 * errors — an unresolvable texture is never a silently-white cutscene car.
 */
function slotTxd(slot: CutsceneSlot, dff: Uint8Array, modTxdPath: string, context: SlotContext): Uint8Array {
  const parent = context.gta3.get(`${slot.txd}.txd`);
  const parentNames = parent ? textureNames(new Uint8Array(parent)) : [];
  const available = new Set([...context.genericNames, ...parentNames]);
  const missing = unresolvedTextures(dff, available);
  if (missing.length === 0) {
    return emptyTxd();
  }
  if (context.selfContainedTxd) {
    const modTxd = new Uint8Array(readFileSync(modTxdPath));
    const chain = new Set([...available, ...textureNames(modTxd)]);
    const stillMissing = unresolvedTextures(dff, chain);
    if (stillMissing.length > 0) {
      throw new Error(`unresolved textures even self-contained: ${stillMissing.join(', ')}`);
    }

    return modTxd;
  }
  throw new Error(`unresolved textures (txdp parent ${slot.txd}.txd): ${missing.join(', ')}`);
}
