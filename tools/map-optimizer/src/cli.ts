/**
 * Map-optimizer CLI. Takes `--game <path>` (a game-data dir: `gta.dat` + `data/` + `models/`), runs the full
 * pipeline and emits a drop-in build under `--out <path>`. Textures + gap-stitch + weld-seams are **on by default**
 * (opt any out with `--no-textures` / `--no-stitch-gaps` / `--no-weld-seams`); the experimental `refine` pass is
 * **off** unless you pass `--refine`. Usage: `tsx map-optimizer/src/cli.ts --game <path> --out <path> [--refine]
 * [--no-<pass>…]`. Paths are relative to the current working directory (absolute paths pass through).
 */
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { printReport, writeReport } from './core';
import { type OptimizerPasses, runOptimizer } from './run';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

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
    refine: process.argv.includes('--refine'), // experimental — opt-in
    stitchGaps: !process.argv.includes('--no-stitch-gaps'),
    textures: !process.argv.includes('--no-textures'),
    weldSeams: !process.argv.includes('--no-weld-seams'),
  };
  const report = await runOptimizer({ gameDir, outDir: fromCwd(outArg), passes });
  printReport(report);
  writeReport(report);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
