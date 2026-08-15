import type { BuildTarget } from '@opensa/tool-kit/target';

import { cpSync, rmSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';

import { applyMod } from './apply-mod';
import { bakeMod } from './bake-mod';
import { checkDanglingModels } from './dangling-models';
import { compactStockInstIpls, mergeModInstIpls } from './ipl-slot-merge';
import { planModLayers, subdirectories } from './layers';

export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
  /**
   * The host this install is being built FOR — which layer of a LAYERED `--in` applies after `common`
   * (plan 011). A flat `--in` has no layer to pick and ignores it; a layered one without it is refused.
   */
  target?: BuildTarget;
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
 * Build a merged install: wipe `--out`, copy the `--game` base into it, then apply the mod folders under `--in`
 * (alphabetical) on top — every one of them for a flat `--in`, or `common` then the target's own layer for a
 * layered one (plan 011). A mod carrying a **loader file** (a `loader.txt`-style mod) is **baked** — its loader's
 * defs/placements are registered in `gta.dat`, its scattered assets injected into `gta3.img`, its data files merged
 * ({@link bakeMod}); every other mod is a plain **overlay** (files overwrite, `gta3_img/`/`gta_int_img/`/PNG-folders merge). Later
 * mods win.
 */
export function install(options: InstallOptions): void {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  const outPath = resolve(options.outPath);
  guardOut(outPath, gamePath, inPath);

  // WHICH mods, and in what order: a flat `--in` is every subfolder (today's shape), a layered one is
  // `common` then the target's own layer (plan 011). Planned and LOGGED before anything is applied — a
  // layer that quietly contributed nothing is the failure this shape has to make impossible.
  const plan = planModLayers(subdirectories(inPath), options.target);
  const roots = plan.layers.map((layer) => ({
    mods: sortMods(subdirectories(layer.subdir === undefined ? inPath : join(inPath, layer.subdir))),
    name: layer.name,
    path: layer.subdir === undefined ? inPath : join(inPath, layer.subdir),
  }));
  logLayerPlan(plan.strategy, roots, plan.skipped, options.target);

  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { force: true, recursive: true });

  const mods = roots.flatMap((layer) => layer.mods);
  let merged = 0;
  let baked = 0;
  for (const layer of roots) {
    for (const mod of layer.mods) {
      const bake = bakeMod(join(layer.path, mod), outPath);
      if (bake.baked) {
        merged += bake.assets;
        baked += 1;
      } else {
        merged += applyMod(join(layer.path, mod), outPath).merged;
      }
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

/**
 * State which mods this run will apply, BEFORE it applies them — the strategy, each layer with its count,
 * and every layer folder that exists and is not being used. A layer that contributed nothing is the one
 * outcome of plan 011 that no later stage can distinguish from a mod set someone trimmed on purpose.
 */
function logLayerPlan(
  strategy: 'flat' | 'layered',
  roots: readonly { mods: readonly string[]; name: string }[],
  skipped: readonly string[],
  target: BuildTarget | undefined,
): void {
  if (strategy === 'flat') {
    console.log(`mod-installer: flat mods — ${roots[0].mods.length} mod(s)`);

    return;
  }
  const applied =
    roots.length > 0 ? roots.map((layer) => `${layer.name} ${layer.mods.length} mod(s)`).join(' → ') : 'no layer';
  const absent = roots.some((layer) => layer.name === target) ? '' : `; ${target} absent`;
  const unused = skipped.length > 0 ? `; ${skipped.join(', ')} not for this target` : '';
  console.log(`mod-installer: layered mods for target ${target} — ${applied}${absent}${unused}`);
}
