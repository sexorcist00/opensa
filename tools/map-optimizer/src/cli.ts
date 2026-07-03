import { argValue, fromCwd } from '@opensa/tool-kit/cli';
/**
 * Map-optimizer CLI. Takes `--game <path>` (a game-data dir: `gta.dat` + `data/` + `models/`), runs the full
 * pipeline and emits a drop-in build under `--out <path>`. All passes (textures / weld-seams / prelit /
 * add-normals) are **on by default** — opt any out with `--no-textures` / `--no-weld-seams` / `--no-prelit` /
 * `--no-add-normals`. `--prelit-only <file.json>` (a JSON array of model names) switches the prelight pass to
 * **only-mode**: just the listed, human-confirmed models are corrected (skip-guards bypassed) and the rest of
 * the map passes through byte-identical. Usage: `tsx map-optimizer/src/cli.ts --game <path> --out <path>
 * [--prelit-only <file.json>] [--no-<pass>…]`. Paths are relative to the current working directory (absolute
 * paths pass through).
 */
import { readFileSync, statSync } from 'node:fs';

import { parseOnlyList } from './adapters/gta-sa/prelit-context';
import { printReport, writeReport } from './core';
import { type OptimizerPasses, runOptimizer } from './run';

async function main(): Promise<void> {
  const gameArg = argValue('--game');
  const outArg = argValue('--out');
  if (!gameArg || !outArg) {
    throw new Error('usage: tsx map-optimizer/src/cli.ts --game <path> --out <path> [--no-<pass>…]');
  }

  const gameDir = fromCwd(gameArg);
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a game-data directory: ${gameDir}`);
  }

  const passes: Partial<OptimizerPasses> = {
    addNormals: !process.argv.includes('--no-add-normals'), // graphics mods want normals (user decision)
    prelit: !process.argv.includes('--no-prelit'),
    textures: !process.argv.includes('--no-textures'),
    weldSeams: !process.argv.includes('--no-weld-seams'),
  };
  const onlyArg = argValue('--prelit-only');
  // Entries: "name" (forced auto verdict) or {"model": "name", "nightScale": 0.4, "dayShift": -30} (explicit).
  const only = onlyArg ? parseOnlyList(JSON.parse(readFileSync(fromCwd(onlyArg), 'utf8'))) : undefined;
  const report = await runOptimizer({
    gameDir,
    outDir: fromCwd(outArg),
    passes,
    ...(only ? { prelitOptions: { only } } : {}),
  });
  printReport(report);
  writeReport(report);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
