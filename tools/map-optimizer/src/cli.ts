import { argValue, fromCwd } from '@opensa/tool-kit/cli';
/**
 * Map-optimizer CLI. Takes `--game <path>` (a game-data dir: `gta.dat` + `data/` + `models/`), runs the full
 * pipeline and emits a drop-in build under `--out <path>`. All passes (textures / weld-seams / prelit /
 * add-normals) are **on by default** — opt any out with `--no-textures` / `--no-weld-seams` / `--no-prelit` /
 * `--no-add-normals`. Prelight curation (same JSON entry format, see the README):
 * - `--prelit-force <file.json>` — the statistical pass runs map-wide AND the listed models are additionally
 *   forced past the skip-guards (what perfect-map-builder's `broken-prelight.json` does);
 * - `--prelit-only <file.json>` — ONLY the listed models are corrected, the rest passes byte-identical.
 * Usage: `tsx map-optimizer/src/cli.ts --game <path> --out <path> [--prelit-force|--prelit-only <file.json>]
 * [--no-<pass>…]`. Paths are relative to the current working directory (absolute paths pass through).
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
  // Entries: "name" (forced auto verdict) or {"model": "name", "nightMax": 20, "dayShift": -30} (explicit).
  const onlyArg = argValue('--prelit-only');
  const forceArg = argValue('--prelit-force');
  const only = onlyArg ? parseOnlyList(JSON.parse(readFileSync(fromCwd(onlyArg), 'utf8'))) : undefined;
  const force = forceArg ? parseOnlyList(JSON.parse(readFileSync(fromCwd(forceArg), 'utf8'))) : undefined;
  const report = await runOptimizer({
    gameDir,
    outDir: fromCwd(outArg),
    passes,
    ...(only || force ? { prelitOptions: { ...(only ? { only } : {}), ...(force ? { force } : {}) } } : {}),
  });
  printReport(report);
  writeReport(report);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
