/**
 * vehicle-optimizer CLI. Works on a loose vehicle DFF given by `--model <path>`. With no operation it prints a
 * structure report; with `--scale` and/or `--prototype <path>` it writes the finished DFF to an `out/` folder
 * BESIDE the model, or to `--out <dir>`. Usage:
 * `tsx tools/vehicle-optimizer/src/cli.ts --model <path-to-dff> [--scale <factor>] [--prototype <path-to-dff>]
 * [--out <dir>]`.
 *
 * Every path is resolved against the INVOCATION cwd (`fromCwd`), like every other tool in the box — it used to
 * resolve against this file's directory, which made `--model ./mods-src/…` from the repo root a missing file
 * and left absolute paths as the only thing that worked.
 */
import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { createGtaSaVehicleAdapter } from './adapters/gta-sa';
import { printReport } from './core';

const USAGE =
  'usage: tsx tools/vehicle-optimizer/src/cli.ts --model <path-to-dff> [--scale <factor>] ' +
  '[--prototype <path-to-dff>] [--out <dir>]';

function main(): void {
  const model = argValue('--model');
  if (!model) {
    throw new Error(USAGE);
  }

  const modelPath = fromCwd(model);
  const dff = new Uint8Array(readFileSync(modelPath));
  const adapter = createGtaSaVehicleAdapter();

  const scale = argValue('--scale');
  const prototype = argValue('--prototype');
  if (!scale && !prototype) {
    printReport(adapter.inspect(dff, basename(modelPath)));

    return;
  }

  const bytes = adapter.process(dff, {
    prototype: prototype ? new Uint8Array(readFileSync(fromCwd(prototype))) : undefined,
    scale: scale ? Number(scale) : undefined,
  });
  // Beside the model by default: a run is about one car in one folder, and writing into the tool's own
  // directory put every car of every mod in one heap, far from the source it came from.
  const out = argValue('--out');
  const outDir = out === undefined ? join(dirname(modelPath), 'out') : fromCwd(out);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, basename(modelPath));
  writeFileSync(outPath, bytes);
  console.log(`→ ${outPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
