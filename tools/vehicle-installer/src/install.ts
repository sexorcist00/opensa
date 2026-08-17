import type { ArchiveFamilyMember } from '@opensa/tool-kit/archive/img';

import { createImg, openImg, writeImgFamily } from '@opensa/tool-kit/archive/img';
import { registerImgArchives } from '@opensa/tool-kit/game-dir';
import { resolveVehicleSources } from '@opensa/tool-kit/vehicles-dir';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';

import { applyVehicle } from './apply-vehicle';
import { formatFeatureTable } from './features';
import { sharedVehicleFiles } from './img-merge';
import { formatModTable, MODS_TABLE } from './mods-table';
import { stripOutput } from './strip';
import { assertCarmodsModels } from './tuning-parts';

/** Where the per-model feature declarations land in the built game dir (read by opensa-pack). */
export const FEATURES_TABLE = join('data', 'vehicle-features.txt');

export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
  /** Reduce the output to ONLY the installed vehicles (gta3.img + the four data files). Default off. */
  strip?: boolean;
}

/** Refuse to wipe a dangerous `--out` — the filesystem root, or a path that is (or contains) `--game` / `--in`. */
export function guardOut(outPath: string, gamePath: string, inPath: string): void {
  if (outPath === parse(outPath).root) {
    throw new Error(`refusing to wipe the filesystem root as --out: ${outPath}`);
  }
  if (outPath === gamePath || outPath === inPath) {
    throw new Error(`--out must differ from --game and --in: ${outPath}`);
  }
  if (gamePath.startsWith(outPath + sep) || inPath.startsWith(outPath + sep)) {
    throw new Error(`--out must not contain --game or --in (would wipe them): ${outPath}`);
  }
}

/**
 * Build the install: wipe `--out`, copy the `--game` base in, then install every vehicle folder `--in`
 * resolves to (alphabetical — order only matters when two vehicles touch the same stock model; last wins).
 * Each vehicle's dff/txd land in `gta3.img` and its settings merge into the four data files.
 *
 * WHICH folders, from a flat `--in` or a structured one (`models/` overridden per slot by `new/`), is
 * `resolveVehicleSources`' call — the same one `vehicle-cutscene` makes, so the cutscene fleet and the
 * driving fleet cannot disagree about what is in the build (plan 007).
 */
export function install(options: InstallOptions): ArchiveFamilyMember[] {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  const outPath = resolve(options.outPath);
  guardOut(outPath, gamePath, inPath);

  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { force: true, recursive: true });

  const { overrides, sources: vehicles } = resolveVehicleSources(inPath);
  overrides.forEach(({ by, replaced }) => console.log(`vehicle-installer: new/${by} replaces models/${replaced}`));
  const imgNames = new Set<string>();
  const models = new Set<string>();
  const handlingIds = new Set<string>();
  const features = new Map<string, readonly string[]>();
  // ONE archive for the whole run: opened here, staged by each vehicle, written once at the end. Per-car
  // rebuilds cost O(n) passes over a growing multi-GB file and the last of them crossed `writeFileSync`'s
  // 2 GiB ceiling outright (2026-08-15) — this is both the speed fix and the ceiling fix.
  // WHICH archive, read off the tree rather than configured: a split tree owns `models/vehicles.img` and
  // that is where a car belongs; an unsplit one has only `gta3.img`. Getting this from the output means one
  // installer serves both shapes, and a car never lands in an archive the split has moved its stock twin out of.
  const imgPath = join(
    outPath,
    'models',
    existsSync(join(outPath, 'models', 'vehicles.img')) ? 'vehicles.img' : 'gta3.img',
  );
  const img = existsSync(imgPath) ? openImg(new Uint8Array(readFileSync(imgPath))) : createImg();
  for (const [name, owners] of sharedVehicleFiles(vehicles)) {
    console.warn(
      `vehicle-installer: ${name} is shipped by ${owners.length} folders (${owners.join(' / ')}) — ` +
        `the archive holds one entry per name, so ${owners[owners.length - 1]} wins and the others wear its version`,
    );
  }
  for (const vehicle of vehicles) {
    const applied = applyVehicle(vehicle.folder, outPath, { img });
    applied.warnings.forEach((warning) => console.warn(`vehicle-installer: ${vehicle.name}: ${warning}`));
    applied.imgNames.forEach((name) => imgNames.add(name));
    if (applied.model) {
      models.add(applied.model);
    }
    if (applied.handlingId) {
      handlingIds.add(applied.handlingId);
    }
    if (applied.model && applied.features.length > 0) {
      features.set(applied.model, applied.features);
    }
  }
  // Every carmods token must resolve to an IDE row — the real game crashes on one that does not, at boot,
  // at an address; here it fails naming the line (plan 009).
  assertCarmodsModels(outPath);
  // Written as a FAMILY, not one file: the buffered path caps at 2 GiB and so does every reader, and this
  // archive is past it on the original's mod set (1.24 GB of map + 3.08 GB of cars). The cap is now enforced
  // by construction rather than discovered mid-build.
  mkdirSync(dirname(imgPath), { recursive: true });
  const archives = writeImgFamily(img, imgPath);
  // Whoever writes an archive registers it. A spill sibling the game never registers is invisible content —
  // the build succeeds, the file is on disk, and its entries simply never load. The base member is skipped:
  // `gta3.img` is hardcoded in the game and `vehicles.img` was declared by the split that created it.
  if (archives.length > 1) {
    registerImgArchives(
      outPath,
      archives.slice(1).map((archive) => basename(archive.path)),
    );
    console.log(`vehicle-installer: ${archives.length} archives — ${archives.map((a) => basename(a.path)).join(', ')}`);
  }
  // The declarations travel as DATA in the built game dir, because the converter runs later and in another
  // process; `opensa-pack` reads this file when it bakes each car. Written only when a mod declared
  // something, so a plain install leaves no stray file.
  if (features.size > 0) {
    writeFileSync(join(outPath, FEATURES_TABLE), formatFeatureTable(features));
  }
  // The mod-car ledger (096/06), written on EVERY run including one that installed nothing: after this point
  // the build cannot tell a mod car from a stock one, and an empty ledger says "looked, found none" where an
  // absent one says "this build predates the ledger". Only one of those is a fact worth having.
  writeFileSync(join(outPath, MODS_TABLE), formatModTable(models));

  if (options.strip) {
    stripOutput(outPath, { handlingIds, imgNames, models });
  }

  console.log(
    `vehicle-installer: ${vehicles.length} vehicle(s) → ${outPath} (${imgNames.size} img entries` +
      (features.size > 0 ? `, ${features.size} with declared features` : '') +
      `, ${models.size} slot(s) in the mod ledger)` +
      (options.strip ? ' [stripped to installed]' : ''),
  );

  return archives;
}
