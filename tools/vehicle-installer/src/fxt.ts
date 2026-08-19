/**
 * `text.txt` — a vehicle mod's GXT entries, the names its own parts show in the shop.
 *
 *   SLASH Slamin Hood
 *   SLACH Chromer Hood
 *
 * The keys are what the mod's `tuning_new_parts.txt` price rows already name (`bnt_lr_slv1  SLASH  respect
 * 0  sexy 0  150`); without them the part is in the shop with no name at all. We do not rebuild
 * `text/american.gxt` for that — the build we ship to carries CLEO's FXT loader (`cleo/ResprayPrice.fxt` is
 * one already), and an `.fxt` is exactly this format: `KEY<whitespace>text`, one per line.
 *
 * So the file becomes `cleo/<model>.fxt`, carried like the mod's own `cleo/` folder. The file was found
 * unread by the 212-folder census (session 28): the slamvan's two bonnets are nameless in the built game.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodeSettings } from './settings';

export const TEXT_FILE = 'text.txt';

/** Reading another mod's `.fxt` for its keys: its own authoring problems are not this car's warnings. */
const noop = (): void => undefined;

/** One GXT entry: the key the game looks up, and the text it shows. */
export interface TextEntry {
  readonly key: string;
  readonly text: string;
}

/**
 * Apply a mod folder's `text.txt` (if it ships one) to the built game dir, plus any entry the CALLER derived
 * — an added car's own display name is one (`tools/add-vehicles` 003), and it comes first so a `text.txt`
 * line under the same key still wins. Returns warnings.
 */
export function applyVehicleText(
  folderPath: string,
  entries: readonly string[],
  outPath: string,
  model: string | undefined,
  derived: readonly TextEntry[] = [],
): string[] {
  const file = entries.find((name) => name.toLowerCase() === TEXT_FILE);
  if (!file && derived.length === 0) {
    return [];
  }
  const warnings: string[] = [];
  // What the warnings are ABOUT: the mod's own file when it ships one, else what the caller derived.
  const source = file ?? 'the derived name';
  if (model === undefined) {
    return [`${source}: the folder ships no model to name the .fxt after — nothing written`];
  }
  const parsed = mergeEntries(
    derived,
    file
      ? parseTextEntries(decodeSettings(readFileSync(join(folderPath, file))), (message) =>
          warnings.push(`${TEXT_FILE}: ${message}`),
        )
      : [],
  );
  if (parsed.length === 0) {
    warnings.push(`${source}: no entries recognised — the parts stay nameless in the shop`);

    return warnings;
  }
  const cleoDir = join(outPath, 'cleo');
  const dest = join(cleoDir, `${model}.fxt`);
  for (const [key, owner] of foreignKeys(cleoDir, dest)) {
    if (parsed.some((entry) => entry.key.toUpperCase() === key)) {
      warnings.push(`${source}: key '${key}' is already defined by cleo/${owner} — whichever CLEO loads last wins`);
    }
  }
  mkdirSync(cleoDir, { recursive: true });
  writeFileSync(dest, formatFxt(parsed), 'latin1');
  console.log(`vehicle-installer: text → cleo/${model}.fxt (${parsed.length} entry/entries)`);

  return warnings;
}

/** The `.fxt` body CLEO reads: `KEY<tab>text`, CRLF, trailing newline. */
export function formatFxt(entries: readonly TextEntry[]): string {
  return `${entries.map(({ key, text }) => `${key}\t${text}`).join('\r\n')}\r\n`;
}

/**
 * `KEY text` per line; `#` and `//` start a comment line. A key repeated in the same file keeps its LAST
 * text (the file reads top-down into one table) and is reported.
 */
export function parseTextEntries(text: string, onWarn: (message: string) => void): TextEntry[] {
  const byKey = new Map<string, TextEntry>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    // Split on the FIRST whitespace run and keep the rest verbatim — `~n~`, tabs and double spaces inside
    // the text are the author's, and a regex that lets the two halves trade characters is a backtracking trap.
    const split = line.search(/\s/);
    const key = split === -1 ? line : line.slice(0, split);
    const body = split === -1 ? '' : line.slice(split).trim();
    if (body === '') {
      onWarn(`line has a key but no text: ${line}`);
      continue;
    }
    if (byKey.has(key.toUpperCase())) {
      onWarn(`key '${key}' appears twice — the last text wins`);
    }
    byKey.set(key.toUpperCase(), { key, text: body });
  }

  return [...byKey.values()];
}

/** Every key (uppercased) the build's OTHER `.fxt` files define, with the file that defines it. */
function foreignKeys(cleoDir: string, ownPath: string): Map<string, string> {
  const owners = new Map<string, string>();
  if (!existsSync(cleoDir)) {
    return owners;
  }
  for (const entry of readdirSync(cleoDir, { recursive: true })) {
    const relative = String(entry);
    const path = join(cleoDir, relative);
    if (!relative.toLowerCase().endsWith('.fxt') || path === ownPath) {
      continue;
    }
    for (const { key } of parseTextEntries(readFileSync(path, 'latin1'), noop)) {
      owners.set(key.toUpperCase(), relative);
    }
  }

  return owners;
}

/** Later entries win by key, order kept — a `text.txt` line overrides the caller's derived one. */
function mergeEntries(first: readonly TextEntry[], second: readonly TextEntry[]): TextEntry[] {
  const byKey = new Map<string, TextEntry>();
  for (const entry of [...first, ...second]) {
    byKey.set(entry.key.toUpperCase(), entry);
  }

  return [...byKey.values()];
}
