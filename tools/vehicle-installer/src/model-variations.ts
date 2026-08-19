/**
 * `model-variations-extra.txt` — a vehicle mod's own section for **ModelVariations 10.7** (mod `11` of the
 * `sa` layer), the plugin that gives a stock slot behaviour the game's own data files cannot express:
 * which trailers it tows, how often, whether their colours match.
 *
 *   [tug]
 *   Trailers1={{bagboxa}},{{bagboxb}},{{tugstair}}
 *   Global=Trailers1
 *   TrailersSpawnChance=95
 *
 * The section is merged into the built `modloader/Model_Variations/ModelVariations_Vehicles.ini` by SECTION
 * NAME — replaced when it is already there, appended when it is not — so a rebake over the same mod changes
 * nothing the install did not. `[Settings]` is the plugin's own and is never written from a mod folder.
 *
 * `{{name}}` is a MODEL, resolved to the id it holds in the built tree's IDEs: the plugin reads ids, not
 * names, in a value (`Error reading key %s in [%s]: invalid model id %s` is its own string). A name no IDE
 * in the tree defines is warned about and the line ships as authored — the ADDED cars eight of these files
 * reference (`{{205veh}}`, plan 102) get their ids from `add-vehicles`, and until that chain lands the
 * plugin logs the unresolved token instead of us dropping data the author wrote.
 *
 * The file was found unread by the 212-folder census (session 28): eight trucks ship trailer behaviour the
 * built ini never carried.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ideModelNames } from './tuning-parts';

export const MODEL_VARIATIONS_EXTRA_FILE = 'model-variations-extra.txt';

/** Where ModelVariations 10.7 reads its vehicle sections from, inside the built game dir. */
export const MODEL_VARIATIONS_INI = join('modloader', 'Model_Variations', 'ModelVariations_Vehicles.ini');

/** The plugin's own settings block — a mod folder may not write it. */
const SETTINGS_SECTION = 'settings';

/** One `[name]` block of an ini file: the header's name and every line under it, verbatim. */
export interface IniSection {
  readonly lines: readonly string[];
  readonly name: string;
}

const SECTION_HEADER = /^\[([^\]]+)\]$/;
const PLACEHOLDER = /\{\{([^}]+)\}\}/g;

/** Apply a mod folder's `model-variations-extra.txt` (if it ships one) to the built game dir. Returns warnings. */
export function applyModelVariations(folderPath: string, entries: readonly string[], outPath: string): string[] {
  const file = entries.find((name) => name.toLowerCase() === MODEL_VARIATIONS_EXTRA_FILE);
  if (!file) {
    return [];
  }
  const sections = parseIniSections(readFileSync(join(folderPath, file), 'latin1'));
  const warnings: string[] = [];
  const writable = sections.filter((section) => {
    if (section.name.toLowerCase() === SETTINGS_SECTION) {
      warnings.push(`${MODEL_VARIATIONS_EXTRA_FILE}: [${section.name}] is the plugin's own block — not written`);

      return false;
    }

    return true;
  });
  if (writable.length === 0) {
    return warnings;
  }
  const path = join(outPath, MODEL_VARIATIONS_INI);
  if (!existsSync(path)) {
    warnings.push(
      `${MODEL_VARIATIONS_EXTRA_FILE}: ${MODEL_VARIATIONS_INI} is not in the tree — ModelVariations 10.7 is ` +
        `not in this build; ${writable.length} section(s) not written`,
    );

    return warnings;
  }
  const names = ideModelNames(outPath);
  let text = readFileSync(path, 'latin1');
  for (const section of writable) {
    const resolved = section.lines.map((line) =>
      resolvePlaceholders(line, names, (missing) =>
        warnings.push(
          `${MODEL_VARIATIONS_EXTRA_FILE}: [${section.name}] '${missing}' is not a model any IDE in the tree ` +
            'defines — the line ships as authored and ModelVariations reports an invalid model id',
        ),
      ),
    );
    text = mergeIniSection(text, { lines: resolved, name: section.name });
  }
  writeFileSync(path, text, 'latin1');

  return warnings;
}

/**
 * Merge single KEYS into a section, keeping every other key it already has — the section-level merge above
 * replaces a block outright, which is right for a mod's authored file and wrong for two writers that own
 * different keys of the same section (`add-vehicles` 004 owns `Global`, 006 owns the tuning keys).
 * Creates the section when the file has none.
 */
export function mergeIniKeys(text: string, section: string, keys: ReadonlyMap<string, string>): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => headerName(line)?.toLowerCase() === section.toLowerCase());
  if (start === -1) {
    return mergeIniSection(text, {
      lines: [...keys].map(([key, value]) => `${key}=${value}`),
      name: section,
    });
  }
  let end = start + 1;
  while (end < lines.length && headerName(lines[end]) === null) {
    end += 1;
  }
  const body = lines.slice(start + 1, end);
  const written = new Set<string>();
  for (const [index, line] of body.entries()) {
    const name = line.split('=')[0].trim().toLowerCase();
    const value = [...keys].find(([key]) => key.toLowerCase() === name);
    if (value) {
      body[index] = `${value[0]}=${value[1]}`;
      written.add(value[0].toLowerCase());
    }
  }
  const fresh = [...keys].filter(([key]) => !written.has(key.toLowerCase())).map(([key, value]) => `${key}=${value}`);
  // Above the trailing blanks, so re-running writes the same bytes.
  let at = body.length;
  while (at > 0 && body[at - 1].trim() === '') {
    at -= 1;
  }
  body.splice(at, 0, ...fresh);
  lines.splice(start + 1, end - start - 1, ...body);

  return lines.join(text.includes('\r\n') ? '\r\n' : '\n');
}

/**
 * Replace the `[section]` block of `text` with this one, or append it when the file has none. Everything
 * outside the block is left byte-for-byte as it was — the plugin's `[Settings]` included.
 */
export function mergeIniSection(text: string, section: IniSection): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const block = [`[${section.name}]`, ...section.lines];
  const start = lines.findIndex((line) => headerName(line)?.toLowerCase() === section.name.toLowerCase());
  if (start !== -1) {
    let end = start + 1;
    while (end < lines.length && headerName(lines[end]) === null) {
      end += 1;
    }
    // Trailing blanks of the replaced block go with it: re-running writes the same bytes either way.
    while (end > start + 1 && lines[end - 1].trim() === '') {
      end -= 1;
    }
    lines.splice(start, end - start, ...block);

    return lines.join(newline);
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  return [...lines, '', ...block, ''].join(newline);
}

/** The `[name]` blocks of an ini file, in order. Lines before the first header are dropped (a mod ships none). */
export function parseIniSections(text: string): IniSection[] {
  const sections: { lines: string[]; name: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    const name = headerName(line);
    if (name !== null) {
      sections.push({ lines: [], name });
    } else {
      sections[sections.length - 1]?.lines.push(line);
    }
  }

  return sections;
}

/** The value of one key inside one section, or undefined when either is absent. */
export function readIniKey(text: string, section: string, key: string): string | undefined {
  const block = parseIniSections(text).find(({ name }) => name.toLowerCase() === section.toLowerCase());
  const line = block?.lines.find((entry) => entry.split('=')[0].trim().toLowerCase() === key.toLowerCase());

  return line === undefined ? undefined : line.slice(line.indexOf('=') + 1).trim();
}

/** Substitute every `{{model}}` with the id that model holds in the tree; an unknown one is reported and kept. */
export function resolvePlaceholders(
  line: string,
  names: ReadonlyMap<string, number>,
  onMissing: (name: string) => void,
): string {
  return line.replace(PLACEHOLDER, (whole, name: string) => {
    const id = names.get(name.trim().toLowerCase());
    if (id === undefined) {
      onMissing(name.trim());

      return whole;
    }

    return String(id);
  });
}

/** `[tug]` → `tug`; anything else → null. */
function headerName(line: string): null | string {
  return SECTION_HEADER.exec(line.trim())?.[1].trim() ?? null;
}
