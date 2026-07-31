import { cpSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';

import { applyVehicle } from './apply-vehicle';
import { formatFeatureTable } from './features';
import { formatModTable, MODS_TABLE } from './mods-table';
import { stripOutput } from './strip';

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
 * Build the install: wipe `--out`, copy the `--game` base in, then install every vehicle folder under `--in`
 * (alphabetical — order only matters when two vehicles touch the same stock model; last wins). Each vehicle's
 * dff/txd land in `gta3.img` and its settings merge into the four data files.
 */
export function install(options: InstallOptions): void {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  const outPath = resolve(options.outPath);
  guardOut(outPath, gamePath, inPath);

  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { force: true, recursive: true });

  const vehicles = readdirSync(inPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'));
  const imgNames = new Set<string>();
  const models = new Set<string>();
  const handlingIds = new Set<string>();
  const features = new Map<string, readonly string[]>();
  for (const vehicle of vehicles) {
    const applied = applyVehicle(join(inPath, vehicle), outPath);
    applied.warnings.forEach((warning) => console.warn(`vehicle-installer: ${vehicle}: ${warning}`));
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
}
