import type { OptimizerPasses } from '@opensa/map-optimizer/run';

/**
 * perfect-map-builder CLI. Chains every map tool into one build and splits it into the `sa` (real game) and
 * `opensa` LOD targets. Usage:
 *   tsx tools/perfect-map-builder/src/cli.ts --game <path> --in <mods-src> --out <path>
 *     --until <stage>  stop after a stage (mods|vehicles|peds|optimize|trees|procobj|sa|opensa) and KEEP every
 *                      intermediate build under `<out>/.work` — for step-by-step in-game debugging. `--until lod`
 *                      runs the WHOLE pipeline (both sa + opensa) while keeping every step.
 *     --keep-work      keep the intermediate `.work` builds even on a full run.
 *     --refine         enable the experimental map-optimizer refine pass (off by default).
 *     --no-<pass>      disable a map-optimizer pass to bisect it: --no-stitch-gaps | --no-weld-seams | --no-textures.
 * Paths are relative to the current working directory (absolute paths pass through). See `docs/plans/001`.
 */
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { buildPerfectMap, STAGE_NAMES, type StageName } from './pipeline';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

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
    ...(process.argv.includes('--refine') ? { refine: true } : {}),
    ...(process.argv.includes('--no-stitch-gaps') ? { stitchGaps: false } : {}),
    ...(process.argv.includes('--no-textures') ? { textures: false } : {}),
    ...(process.argv.includes('--no-weld-seams') ? { weldSeams: false } : {}),
  };

  const { produced, stoppedEarly } = await buildPerfectMap({
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
