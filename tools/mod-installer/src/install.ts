import { cpSync, readdirSync, rmSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';

import { applyMod } from './apply-mod';
import { bakeMod } from './bake-mod';
import { checkDanglingModels } from './dangling-models';
import { compactStockInstIpls, mergeModInstIpls } from './ipl-slot-merge';

export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
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
 * Build a merged install: wipe `--out`, copy the `--game` base into it, then apply every mod folder under `--in`
 * (alphabetical) on top. A mod carrying a **loader file** (a `loader.txt`-style mod) is **baked** — its loader's
 * defs/placements are registered in `gta.dat`, its scattered assets injected into `gta3.img`, its data files merged
 * ({@link bakeMod}); every other mod is a plain **overlay** (files overwrite, `gta3_img/`/`gta_int_img/`/PNG-folders merge). Later
 * mods win.
 */
export function install(options: InstallOptions): void {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  const outPath = resolve(options.outPath);
  guardOut(outPath, gamePath, inPath);

  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { force: true, recursive: true });

  const mods = sortMods(
    readdirSync(inPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  let merged = 0;
  let baked = 0;
  for (const mod of mods) {
    const bake = bakeMod(join(inPath, mod), outPath);
    if (bake.baked) {
      merged += bake.assets;
      baked += 1;
    } else {
      merged += applyMod(join(inPath, mod), outPath).merged;
    }
  }

  // Slot economy: each gta.dat text IPL with inst rows costs one of SA's ~39 usable (unbounded!)
  // IplEntityIndexArrays slots and the LOD generators downstream need ~9 — fold mod IPLs into a stock host
  // and empty the stream-less stock inst blocks (int_cont/gen_int1) the same way.
  const slots = mergeModInstIpls(gamePath, outPath);
  const compact = compactStockInstIpls(gamePath, outPath);

  // A mod that retires a model the stock map still places leaves a request the streamer can never satisfy —
  // the world then renders as LODs with permanent hitching. Silent until the field; gated here.
  checkDanglingModels(outPath);

  console.log(
    `mod-installer: ${mods.length} mod(s) (${baked} baked) → ${outPath} ` +
      `(${merged} entries merged into gta3.img / loose .txd` +
      (slots.merged > 0 ? `; ${slots.merged} mod IPLs folded into a stock host (${slots.rows} rows)` : '') +
      (compact.compacted > 0 ? `; ${compact.compacted} stock inst blocks compacted (${compact.rows} rows)` : '') +
      ')',
  );
}

/** Mod folder names sorted case-insensitive **numeric-aware** ascending (`1. x`, `2. y`, `10. z`) — the
 *  number prefix IS the apply priority: later mods overwrite earlier ones. */
export function sortMods(names: readonly string[]): string[] {
  return [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en', { numeric: true }));
}
