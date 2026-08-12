/**
 * vehicle-cutscene CLI. Converts installed GTA-SA vehicle mods into their cutscene counterparts. Usage:
 *   tsx tools/vehicle-cutscene/src/cli.ts --game <path> --in <vehicles-dir> --out <path> [--only <model,…>] [--inspect]
 *     --game     base game tree (data/vehicles.ide + data/txdcut.ide + models/cutscene.img)
 *     --in       folder of vehicle mods (immediate subfolders: <model>.dff/.txd + <model>.settings.txt) —
 *                the same folder vehicle-installer consumes
 *     --out      output game tree (base copied, models/cutscene.img rebuilt, data/txdcut.ide patched)
 *     --only     restrict to specific donor models (comma-separated) while iterating
 *     --inspect  print the census + per-slot readiness, write nothing (no --out needed)
 *   All paths are relative to the current working directory (absolute paths pass through).
 */
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { type Census, loadCensus, matchMods, type SlotReadiness } from './census';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertDirectory(path: string, flag: string): void {
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${flag} must be a directory: ${path}`);
  }
}

function filterOnly(readiness: SlotReadiness[], only: string | undefined): SlotReadiness[] {
  if (!only) {
    return readiness;
  }
  const keep = new Set(only.split(',').map((model) => model.trim().toLowerCase()));

  return readiness.filter((entry) => keep.has(entry.slot.model) || keep.has(entry.slot.csName));
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const gameArg = argValue('--game');
  const inArg = argValue('--in');
  const inspect = process.argv.includes('--inspect');

  if (!gameArg || !inArg) {
    throw new Error(
      'usage: tsx tools/vehicle-cutscene/src/cli.ts --game <path> --in <vehicles-dir> --out <path> [--only <model,…>] [--inspect]',
    );
  }
  const gamePath = fromCwd(gameArg);
  const inPath = fromCwd(inArg);
  assertDirectory(gamePath, '--game');
  assertDirectory(inPath, '--in');

  const census = loadCensus(gamePath);
  const only = argValue('--only');
  const readiness = filterOnly(matchMods(census.slots, inPath), only);

  printCensus(census, readiness);

  if (inspect) {
    return;
  }
  if (!argValue('--out')) {
    throw new Error('--out is required (or pass --inspect for the report alone)');
  }
  throw new Error('conversion is not implemented yet — vehicle-cutscene plan 002 steps 2+; run with --inspect');
}

function printCensus(census: Census, readiness: SlotReadiness[]): void {
  const slotCount = new Set(readiness.map((entry) => entry.slot.model)).size;
  console.log(`vehicle-cutscene census — ${readiness.length} cutscene model(s), ${slotCount} donor slot(s)`);
  for (const { folder, slot, status } of readiness) {
    console.log(
      `  ${slot.csName.padEnd(14)} ${slot.model.padEnd(9)} ${slot.branch.padEnd(5)}` +
        ` ${(slot.hasTxdcutRow ? 'txdcut yes' : 'txdcut MISSING').padEnd(15)}` +
        ` ${status.padEnd(15)}${folder ? ` ${folder}` : ''}`,
    );
  }
  for (const dead of census.deadTxdcutRows) {
    console.log(`  dead txdcut.ide row: ${dead} (no model in cutscene.img)`);
  }
  const notReady = readiness.filter((entry) => entry.status !== 'ready');
  console.log(
    notReady.length === 0
      ? `  all ${readiness.length} model(s) ready`
      : `  NOT ready: ${notReady.map((entry) => `${entry.slot.csName} (${entry.status})`).join(', ')}`,
  );
}

main();
