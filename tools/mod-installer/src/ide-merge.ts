import { readFileSync, writeFileSync } from 'node:fs';

/**
 * The `<target>.merge` convention: a mod ships `multiobj.ide.merge` next to the game path it wants to EDIT
 * (not replace) — directives describe line-level changes applied to the CURRENT `--out` state of the target,
 * so merge-mods stack with each other and with earlier whole-file replacements. Grammar:
 *
 *   remove from "objs":
 *   1682, ap_radar1_01, ap_misc1bit, 100, 2097152
 *
 *   add to "anim":
 *   1682, ap_radar1_01, ap_misc1bit, radar, 600, 0
 *
 * `remove` deletes the named section's entries by ID (the rest of the line is documentation — float
 * formatting differs between tools, so byte-matching would be brittle). `add` appends to the section
 * (created at the end of the file when absent); an entry with the same ID already in that section is
 * replaced, so re-applying or stacking mods stays deterministic. `#`/`//` comments are ignored.
 */

export interface MergeDirective {
  action: 'add' | 'remove';
  /** Raw entry lines under the directive (first cell = the ID key). */
  entries: string[];
  section: string;
}

const DIRECTIVE = /^(remove from|add to)\s+"(\w+)"\s*:?$/i;

/** Apply a parsed merge onto the target file's text; returns the new text + non-fatal warnings. */
export function applyIdeMerge(
  targetText: string,
  directives: readonly MergeDirective[],
): {
  text: string;
  warnings: string[];
} {
  const newline = targetText.includes('\r\n') ? '\r\n' : '\n';
  const lines = targetText.split(/\r?\n/);
  const warnings: string[] = [];

  for (const directive of directives) {
    for (const entry of directive.entries) {
      const id = idOf(entry);
      if (directive.action === 'remove') {
        if (!removeById(lines, directive.section, id)) {
          warnings.push(`remove from "${directive.section}": id ${id} not found — skipped`);
        }
      } else {
        removeById(lines, directive.section, id); // same-id entry in the section is replaced
        addToSection(lines, directive.section, entry);
      }
    }
  }

  return { text: lines.join(newline), warnings };
}

/** Merge `<mergePath>` into `<targetPath>` on disk (the installer entry point). Returns warnings. */
export function mergeIdeFile(mergePath: string, targetPath: string): string[] {
  const directives = parseMergeFile(readFileSync(mergePath, 'utf8'));
  const { text, warnings } = applyIdeMerge(readFileSync(targetPath, 'utf8'), directives);
  writeFileSync(targetPath, text);

  return warnings;
}

/** Parse a `.merge` file into directives. Throws on lines outside a directive or malformed headers. */
export function parseMergeFile(text: string): MergeDirective[] {
  const directives: MergeDirective[] = [];
  let current: MergeDirective | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (line.length === 0) {
      continue;
    }
    const header = DIRECTIVE.exec(line);
    if (header) {
      current = {
        action: header[1].toLowerCase().startsWith('remove') ? 'remove' : 'add',
        entries: [],
        section: header[2].toLowerCase(),
      };
      directives.push(current);
      continue;
    }
    if (/^(?:remove|add)\b/i.test(line)) {
      throw new Error(`malformed merge directive: "${line}" (expected e.g. 'add to "anim":')`);
    }
    if (!current) {
      throw new Error(`merge entry outside any directive: "${line}"`);
    }
    if (idOf(line) === null) {
      throw new Error(`merge entry has no numeric ID: "${line}"`);
    }
    current.entries.push(line);
  }

  return directives;
}

/** Append an entry inside the section (before its `end`), creating the section at the file end if absent. */
function addToSection(lines: string[], section: string, entry: string): void {
  const bounds = sectionBounds(lines, section);
  if (bounds) {
    lines.splice(bounds.end, 0, entry);

    return;
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  lines.push(section, entry, 'end', '');
}

/** The numeric ID in an entry's first cell, or null. */
function idOf(entry: string): null | number {
  const id = Number(entry.split(',')[0].trim());

  return Number.isFinite(id) ? id : null;
}

/** Delete the section's entries whose ID matches; true when something was removed. */
function removeById(lines: string[], section: string, id: null | number): boolean {
  const bounds = sectionBounds(lines, section);
  if (!bounds || id === null) {
    return false;
  }
  let removed = false;
  for (let at = bounds.end - 1; at > bounds.start; at -= 1) {
    if (idOf(stripComment(lines[at])) === id) {
      lines.splice(at, 1);
      removed = true;
    }
  }

  return removed;
}

/** Line indexes of a `section … end` block: `start` = header line, `end` = its `end` line. */
function sectionBounds(lines: string[], section: string): null | { end: number; start: number } {
  for (let at = 0; at < lines.length; at += 1) {
    if (lines[at].trim().toLowerCase() !== section) {
      continue;
    }
    for (let stop = at + 1; stop < lines.length; stop += 1) {
      if (lines[stop].trim().toLowerCase() === 'end') {
        return { end: stop, start: at };
      }
    }
  }

  return null;
}

function stripComment(line: string): string {
  return line.replace(/(?:#|\/\/).*$/, '');
}
