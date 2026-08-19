/**
 * add-vehicles CLI. Installs ADDED vehicles — new model ids — into a BUILT `sa` tree. Usage:
 *   tsx tools/add-vehicles/src/cli.ts --game <built sa tree> --in <add-vehicles root> [--only <slot,slot>]
 *     --game  the BUILT `sa` tree the cars are added to (its `data/vehicles.ide` defines the base slots)
 *     --in    the added-vehicles root (default `mods-src/original/add-vehicles`)
 *     --only  narrow the run to these slots
 *
 * Today (plan 001) it RESOLVES and REPORTS: which cars the root holds, what each one varies, and every
 * refusal — a stray folder, a non-`sa` layer, a `(base)` the built game does not define. The install
 * itself (ids, rows, archive) is plan 002; the CLI's shape is fixed here so the pipeline stage has
 * something to call.
 */
import { statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { ADD_VEHICLES_DIR, resolveAddedVehicles } from './sources';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const gameArg = argValue('--game');
  if (!gameArg) {
    throw new Error(
      `usage: tsx tools/add-vehicles/src/cli.ts --game <built sa tree> [--in <root>] [--only <slot,slot>]`,
    );
  }
  const gamePath = fromCwd(gameArg);
  const inPath = fromCwd(argValue('--in') ?? join('mods-src', 'original', ADD_VEHICLES_DIR));
  for (const [flag, path] of [
    ['--game', gamePath],
    ['--in', inPath],
  ]) {
    if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`${flag} must be a directory: ${path}`);
    }
  }
  const only = argValue('--only')
    ?.split(',')
    .map((slot) => slot.trim().toLowerCase())
    .filter((slot) => slot !== '');

  const { plan, sources } = resolveAddedVehicles(inPath, gamePath);
  for (const skipped of plan.layersSkipped) {
    console.log(`add-vehicles: layer ${skipped} present but not applied (target sa)`);
  }
  for (const { by, replaced, slot } of plan.overrides) {
    console.log(`add-vehicles: ${by} replaces ${replaced} for slot '${slot}'`);
  }
  const selected = only ? sources.filter((source) => only.includes(source.slot)) : sources;
  for (const source of selected) {
    console.log(`add-vehicles: ${source.slot} (base ${source.bases.join(', ')}) — ${source.name}`);
  }
  console.log(
    `add-vehicles: ${selected.length} of ${sources.length} added car(s) resolved from ${inPath}; ` +
      `installing them is plan 002`,
  );
}

main();
