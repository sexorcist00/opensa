import { argValue, fromCwd } from '@opensa/tool-kit/cli';
/**
 * Map-optimizer CLI. Takes `--game <path>` (a game-data dir: `gta.dat` + `data/` + `models/`), runs the full
 * pipeline and emits a drop-in build under `--out <path>`. All passes (textures / weld-seams / prelit /
 * add-normals) are **on by default** — opt any out with `--no-textures` / `--no-weld-seams` / `--no-prelit` /
 * `--no-add-normals`. Prelight curation (same JSON entry format, see the README):
 * - `--prelit-force <file.json>` — the statistical pass runs map-wide AND the listed models are additionally
 *   forced past the skip-guards (what perfect-map-builder's `broken-prelight.json` does);
 * - `--prelit-only <file.json>` — ONLY the listed models are corrected, the rest passes byte-identical.
 * - `--crease <file.json>` — per-model crease-angle overrides in degrees (plan 023A, `{"model": 80}`);
 *   defaults to the curated `data/crease-overrides.json` next to this tool.
 * Usage: `tsx map-optimizer/src/cli.ts --game <path> --out <path> [--prelit-force|--prelit-only <file.json>]
 * [--crease <file.json>] [--no-<pass>…]`. Paths are relative to the current working directory (absolute
 * paths pass through).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOnlyList } from './adapters/gta-sa/prelit-context';
import { printReport, writeReport } from './core';
import { type OptimizerPasses, runOptimizer } from './run';

/** Load the `--crease` JSON (or the curated default): lowercased model name → crease degrees (plan 023A). */
function loadCreaseOverrides(): ReadonlyMap<string, number> | undefined {
  const creaseArg = argValue('--crease');
  const path = creaseArg
    ? fromCwd(creaseArg)
    : join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'crease-overrides.json');
  if (!existsSync(path)) {
    return undefined;
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const overrides = new Map<string, number>();
  for (const [model, degrees] of Object.entries(raw)) {
    if (model.startsWith('_')) {
      continue; // comment keys
    }
    if (typeof degrees !== 'number' || !Number.isFinite(degrees) || degrees <= 0 || degrees >= 180) {
      throw new Error(`crease override '${model}' must be an angle in (0, 180) degrees, got ${String(degrees)}`);
    }
    overrides.set(model.toLowerCase(), degrees);
  }

  return overrides.size > 0 ? overrides : undefined;
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
  const creaseOverrides = loadCreaseOverrides();
  const report = await runOptimizer({
    gameDir,
    outDir: fromCwd(outArg),
    passes,
    ...(creaseOverrides ? { creaseOverrides } : {}),
    ...(only || force ? { prelitOptions: { ...(only ? { only } : {}), ...(force ? { force } : {}) } } : {}),
  });
  printReport(report);
  writeReport(report);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
