import type { OptimizerPasses } from '@opensa/map-optimizer/run';

import { argValue, fromCwd } from '@opensa/tool-kit/cli';
/**
 * perfect-map-builder CLI. Chains every map tool into one build and splits it into the `sa` (real game) and
 * `opensa` LOD targets. Usage:
 *   tsx tools/perfect-map-builder/src/cli.ts --game <path> --in <mods-src> --out <path>
 *     --until <stage>  stop after a stage (mods|vehicles|peds|optimize|trees|procobj|sa|opensa|pack) and KEEP
 *                      every intermediate build under `<out>/.work` — for step-by-step in-game debugging.
 *                      `--until lod` runs the WHOLE pipeline (both sa + opensa) while keeping every step.
 *                      `--until opensa` stops at the LOD build, leaving `opensa/` in GAME format; a full run
 *                      (or `--until pack`) converts it, and `opensa/` is then our own format — bootable by
 *                      the own engine, not by the real game.
 *     --keep-work      keep the intermediate `.work` builds even on a full run.
 *     --no-<pass>      disable a map-optimizer pass to bisect it: --no-weld-seams | --no-textures.
 *     --allow-text-row-overflow  build past the int16 30k text-row budget (the 03-asi ghost-barriers repro —
 *                      an intentionally over-2^15 full build); the 39-slot guard stays hard. Never for shipping.
 * A `broken-prelight.json` at the mods-src root (or inside its `mods/` subfolder) is the map-optimizer
 * prelight FORCE list: the statistical pass runs map-wide and the listed models are additionally forced past
 * the skip-guards (same entry format as `--prelit-force` — see the map-optimizer README).
 * A `lod-exclude.json` (same locations; a JSON array of model names) keeps the listed models out of BOTH LOD
 * targets — the tool for high-poly street-furniture replacement mods that would explode the cell bake.
 * A FULL build needs a bigger heap: the opensa cell bake holds the (mod-grown, ~1.3 GB) gta3.img + merged cells
 * in memory — run with `NODE_OPTIONS=--max-old-space-size=12288` or the opensa stage dies mid-resolve with no
 * output (the classic "hung with no progress bar" OOM).
 * Paths are relative to the current working directory (absolute paths pass through). See `docs/plans/001`.
 */
import { statSync } from 'node:fs';

import { buildPerfectMap, STAGE_NAMES, type StageName } from './pipeline';

async function main(): Promise<void> {
  const gameArg = argValue('--game');
  const inArg = argValue('--in');
  const outArg = argValue('--out');
  if (!gameArg || !inArg || !outArg) {
    throw new Error(
      'usage: tsx tools/perfect-map-builder/src/cli.ts --game <path> --in <mods-src> --out <path> [--until <stage>] [--keep-work] [--no-<pass>]',
    );
  }

  const gamePath = fromCwd(gameArg);
  const inPath = fromCwd(inArg);
  for (const [flag, path] of [
    ['--game', gamePath],
    ['--in', inPath],
  ]) {
    if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`${flag} must be a directory: ${path}`);
    }
  }

  const until = argValue('--until');
  if (until !== undefined && !STAGE_NAMES.includes(until as StageName)) {
    throw new Error(`--until must be one of: ${STAGE_NAMES.join(' | ')}`);
  }

  const optimizerPasses: Partial<OptimizerPasses> = {
    ...(process.argv.includes('--no-textures') ? { textures: false } : {}),
    ...(process.argv.includes('--no-weld-seams') ? { weldSeams: false } : {}),
  };

  const { produced, stoppedEarly } = await buildPerfectMap({
    allowTextRowOverflow: process.argv.includes('--allow-text-row-overflow'),
    config: { optimizerPasses },
    gamePath,
    inPath,
    keepWork: process.argv.includes('--keep-work'),
    outPath: fromCwd(outArg),
    until: until as StageName | undefined,
  });

  console.log(stoppedEarly ? '\nstage builds (test each in-game):' : '\ndone:');
  for (const stage of produced) {
    console.log(`  ${stage.name.padEnd(9)} → ${stage.dir}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
