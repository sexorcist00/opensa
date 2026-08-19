/**
 * `data/vehicle-adds.txt` — which added car holds which model id, written by every run and read FIRST by
 * the next one.
 *
 * It exists because an id is not a build detail: a parked spot and a ModelVariations entry land in the
 * player's SAVE (`docs/gta-sa-original/fla-id-limits-are-part-of-the-savefile.md`), so an id that moved
 * between two builds is a save that spawns the wrong car — or nothing. Folder order alone cannot promise
 * that: renaming a folder, adding a car ahead of another, or dropping one all reshuffle it. The ledger
 * pins what has already been handed out, and only deleting it renumbers the fleet.
 *
 * One row per car, tab-separated, sorted by slot so a rebuild is byte-identical:
 *
 *   001veh  19001  manana  001veh - 1971 Chevrolet Vega - alfamodding (manana)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Where the ledger lives inside a built game dir. */
export const ADDS_LEDGER = join('data', 'vehicle-adds.txt');

/** One added car, as the ledger records it. */
export interface LedgerRow {
  /** The stock slot(s) it varies, comma-separated in the file. */
  readonly bases: readonly string[];
  /** The folder name it was installed from — for a human reading the file, never matched on. */
  readonly folder: string;
  readonly id: number;
  readonly slot: string;
}

const HEADER = [
  '# OpenSA added vehicles: slot, model id, base slot(s), source folder. Written by tools/add-vehicles.',
  '# The ID IS A PROMISE: parked cars and ModelVariations entries land in the save, so a slot listed here',
  '# keeps its id on every rebuild. Deleting this file renumbers the fleet and invalidates existing saves.',
];

/** The ids a previous run handed out, by slot. Missing file = nothing promised yet. */
export function readAddsLedger(gameDir: string): Map<string, number> {
  const rows = new Map<string, number>();
  const path = join(gameDir, ADDS_LEDGER);
  if (!existsSync(path)) {
    return rows;
  }
  for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const [slot, id] = trimmed.split(/\t+/);
    if (slot && /^\d+$/.test(id ?? '')) {
      rows.set(slot.toLowerCase(), Number(id));
    }
  }

  return rows;
}

/**
 * Write the ledger for the cars this run installed, MERGED over what was there: a run narrowed with
 * `--only` speaks for its own cars and must not tell the next one that every other added car is unplaced.
 */
export function writeAddsLedger(gameDir: string, rows: readonly LedgerRow[]): void {
  const path = join(gameDir, ADDS_LEDGER);
  const kept = new Map<string, string>();
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
      const slot = line.trim().split(/\t+/)[0];
      if (slot !== '' && !line.trim().startsWith('#')) {
        kept.set(slot.toLowerCase(), line.trimEnd());
      }
    }
  }
  for (const row of rows) {
    kept.set(row.slot.toLowerCase(), [row.slot, row.id, row.bases.join(','), row.folder].join('\t'));
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [...HEADER, ...[...kept.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, line]) => line), ''].join(
      '\n',
    ),
    'latin1',
  );
}
