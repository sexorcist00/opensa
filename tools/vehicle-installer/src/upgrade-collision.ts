/**
 * Every tuning part must have collision, or the shop kills the game — the check, run over the built tree.
 *
 * A part is previewed as an ordinary `CObject`, and the constructor dereferences `m_pColModel` with no null
 * check (`0x59F8B4`, `reading location 0x00000029`). Collision for the stock parts comes from ONE file,
 * `gta3.img : veh_mods.col`, which holds exactly 194 entries — the whole stock upgrade block, ids 1000–1193.
 * A part any tool adds has no entry there, and by measurement survives only when its IDE flags carry
 * `0x200000`: `docs/gta-sa-original/veh-mods-col-and-the-upgrade-object.md`.
 *
 * So the rule this enforces is: **no collision entry ⇒ the flag**. It is static, needs no field round, and
 * the two rows that made it necessary were ours — `19077 wg_l_lr_t1_072veh` and `19078` inherited `0` from
 * the stock tornado part they were cloned from and are the predicted crash.
 */
import { parseColLibrary } from '@opensa/renderware/parsers/binary/col';
import { openArchiveIndex } from '@opensa/tool-kit/archive/layout';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NO_COL_FLAG, VEH_MODS_IDE } from './tuning-parts';

/** The archive entry the stock game keeps every upgrade part's collision in. */
export const VEH_MODS_COL = 'veh_mods.col';

/**
 * Refuse a tree whose upgrade parts would crash the mod shop. Returns what it could not check rather than
 * guessing: an archive with no `veh_mods.col` (a converted tree, or a split that moved it) means the answer
 * is unknown, and an unknown answer is said out loud, not treated as a pass.
 */
export function assertUpgradeCollision(gameDir: string): string[] {
  const path = join(gameDir, VEH_MODS_IDE);
  if (!existsSync(path)) {
    return [];
  }
  const collision = upgradeCollisionNames(gameDir);
  if (collision === null) {
    return [`${VEH_MODS_COL} is not in the archive — the upgrade parts' collision could not be checked`];
  }
  const missing: string[] = [];
  let section = '';
  for (const raw of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    const cells = line.split(',').map((cell) => cell.trim());
    if (line === '') {
      continue;
    }
    if (!/^\d+$/.test(cells[0])) {
      section = line.toLowerCase();
      continue;
    }
    const flags = Number(cells[cells.length - 1]);
    if (section === 'objs' && !collision.has(cells[1].toLowerCase()) && (flags & NO_COL_FLAG) === 0) {
      missing.push(`${cells[1]} (id ${cells[0]}, flags ${cells[cells.length - 1]})`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} tuning part(s) have no ${VEH_MODS_COL} entry and no 0x${NO_COL_FLAG.toString(16)} ` +
        `flag — the game dies previewing one in the mod shop (CObject's constructor reads a null ` +
        `m_pColModel):\n  ${missing.join('\n  ')}`,
    );
  }

  return [];
}

/**
 * The model names `veh_mods.col` carries collision for, lowercased. Null when no archive of the tree holds
 * it. Read through the archive INDEX, which slices the one entry off a file handle — the archives it looks
 * through are gigabytes and none of that is buffered.
 */
export function upgradeCollisionNames(gameDir: string): null | Set<string> {
  const entry = openArchiveIndex(gameDir).get(VEH_MODS_COL);

  return entry === null ? null : new Set(parseColLibrary(entry).map((model) => model.name.toLowerCase()));
}
