/**
 * Append a mod loader file's `IDE`/`IPL` references to the game's `gta.dat`, so the built game loads the mod's
 * object defs, `txdp` parents and placements. Paths are kept verbatim — `resolveMap` normalizes them on read —
 * only the dedup key is normalized.
 */

import { normalizeDatPath } from '@opensa/renderware/archive';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';

/**
 * Append `refs` to the stock `gta.dat`, skipping any path already listed (so a mod re-stating a stock IPL doesn't
 * double-place). Returns `base` unchanged when every ref is already there.
 */
export function mergeGtaDat(base: string, refs: { ide: readonly string[]; ipl: readonly string[] }): string {
  const dat = parseGtaDat(base);
  const present = new Set([...dat.ide, ...dat.ipl].map(normalizeDatPath));
  const eol = base.includes('\r\n') ? '\r\n' : '\n';
  const added: string[] = [];
  const add = (directive: 'IDE' | 'IPL', path: string): void => {
    const key = normalizeDatPath(path);
    if (!present.has(key)) {
      present.add(key);
      added.push(`${directive} ${path}`);
    }
  };
  for (const path of refs.ide) {
    add('IDE', path);
  }
  for (const path of refs.ipl) {
    add('IPL', path);
  }
  if (added.length === 0) {
    return base;
  }
  const head = base.replace(/\s*$/, '');

  return `${head === '' ? '' : `${head}${eol}`}${added.join(eol)}${eol}`;
}
