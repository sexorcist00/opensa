/**
 * `audio.txt` — a vehicle mod's own line of FLA's `data/gtasa_vehicleAudioSettings.cfg`, the file the
 * reference install reads because `Enable vehicle audio loader = 1` is ON.
 *
 *   106veh   9   -1  -1  0   0.7   1.0   -1   1.0   -1   0   13   1   -1   0.0
 *
 * Fifteen columns, the first of which is the MODEL NAME (`; A … O` in the file's own legend): vehicle type,
 * the engine-on/off sound ids, horn, door, radio, and so on. The loader is keyed by name, so a replacement
 * car keeps its stock line unless it ships this file — nothing is inherited here (a `(base)` slot's line is
 * add-vehicles 003's business, where the car has no stock line to keep).
 *
 * Merge: replace the row whose first token is the model, append when there is none. An added row lands in
 * the block the file itself sets aside (`; ----- added vehicles -----`, right before `;the end`), which is
 * where fastman92 says to put it. Idempotent — the same file merged twice writes the same bytes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const AUDIO_FILE = 'audio.txt';

/** FLA's vehicle audio loader table, inside the built game dir. */
export const AUDIO_CFG = join('data', 'gtasa_vehicleAudioSettings.cfg');

/** The comment the stock file ends with; a new row goes above it, inside the "added vehicles" block. */
const END_MARKER = ';the end';

/** Apply a mod folder's `audio.txt` (if it ships one) to the built game dir. Returns warnings. */
export function applyVehicleAudio(folderPath: string, entries: readonly string[], outPath: string): string[] {
  const file = entries.find((name) => name.toLowerCase() === AUDIO_FILE);
  if (!file) {
    return [];
  }
  const rows = readFileSync(join(folderPath, file), 'latin1')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith(';'));
  if (rows.length === 0) {
    return [`${AUDIO_FILE}: no rows — the car keeps its stock engine sound`];
  }
  const path = join(outPath, AUDIO_CFG);
  if (!existsSync(path)) {
    return [
      `${AUDIO_FILE}: ${AUDIO_CFG} is not in the tree — fastman92's vehicle audio loader is not in this ` +
        `build; ${rows.length} row(s) not written`,
    ];
  }
  const warnings: string[] = [];
  const text = readFileSync(path, 'latin1');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  // The shape the file itself states: the column count of its first data row. A row with a different one is
  // a row fastman92's loader would read past the end of, into the next line's fields.
  const columns = fieldCount(lines.find((line) => isDataRow(line)) ?? '');
  for (const row of rows) {
    if (columns > 0 && fieldCount(row) !== columns) {
      warnings.push(
        `${AUDIO_FILE}: '${row.split(/\s+/)[0]}' has ${fieldCount(row)} columns, the table has ${columns} — row dropped`,
      );
      continue;
    }
    mergeAudioRow(lines, row);
  }
  writeFileSync(path, lines.join(newline), 'latin1');

  return warnings;
}

/** Replace the row of this model in place, or insert it into the file's "added vehicles" block. */
export function mergeAudioRow(lines: string[], row: string): void {
  const model = row.split(/\s+/)[0].toLowerCase();
  const at = lines.findIndex((line) => isDataRow(line) && line.trim().split(/\s+/)[0].toLowerCase() === model);
  if (at !== -1) {
    lines[at] = row;

    return;
  }
  const end = lines.findIndex((line) => line.trim().toLowerCase() === END_MARKER);
  lines.splice(end === -1 ? lines.length : end, 0, row);
}

/** Whitespace-separated field count of a row. */
function fieldCount(line: string): number {
  const trimmed = line.trim();

  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** A line the loader reads: not blank, not a `;` comment. */
function isDataRow(line: string): boolean {
  const trimmed = line.trim();

  return trimmed !== '' && !trimmed.startsWith(';');
}
