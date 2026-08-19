/**
 * The two fixed-size arrays behind `carmods.dat`, counted on the built tree — the ceilings nothing else
 * catches (`docs/gta-sa-original/carmods-upgrade-ceilings.md`).
 *
 * 1. **`link` pairs, game-wide: 30.** `CLinkedUpgradeList` (`0xB4E6D8`) holds `m_anUpgrade1/2[30]`; the
 *    31st pair writes past both arrays into whatever follows — static corruption with no message, showing up
 *    somewhere else entirely. Stock uses 23, so a mod set has SEVEN spare, and every added car that
 *    re-models its base's wings costs one.
 * 2. **Parts on ONE car's line: 16.** `CVehicleModelInfo::m_anUpgrades[18]`, with `hydralics` and `stereo`
 *    appended unconditionally, so 16 is what a line may list. Stock `jester` is full at 16.
 *
 * Neither is a number any adjuster has a setting for. `asi/perfect-vehicle` plan 002 lifts both by
 * relocating the arrays; until it ships in the tree these are hard refusals that name it — the in-reserve
 * rule, where the guard that fires is the thing that points at the deferred work.
 *
 * **This runs on every install path, not only the added-car one**: a REPLACEMENT car's line over 16 is
 * silent today, and that is the same overrun.
 */
import { parseCarmods } from '@opensa/renderware/parsers/text/carmods.parser';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `CLinkedUpgradeList::m_anUpgrade1/2[30]` — the whole game's mirrored-part pairs. */
export const STOCK_LINK_PAIRS = 30;

/** `m_anUpgrades[18]` minus the two the game appends itself. */
export const STOCK_PARTS_PER_CAR = 16;

/** The plugin that lifts both; present in the tree means the numbers below are no longer the ceiling. */
const PERFECT_VEHICLE_ASI = 'perfect-vehicle.asi';

/**
 * Refuse a built tree whose `carmods.dat` is over either array. Does nothing when the tree carries
 * `perfect-vehicle.asi` — that plugin relocates them, and the guard must not ration a target that has been
 * lifted (`docs/restrictions/sa-target.md`).
 */
export function assertCarmodsCeilings(gameDir: string): void {
  const path = join(gameDir, 'data', 'carmods.dat');
  if (!existsSync(path) || existsSync(join(gameDir, PERFECT_VEHICLE_ASI))) {
    return;
  }
  const carmods = parseCarmods(readFileSync(path, 'latin1'));
  if (carmods.links.length > STOCK_LINK_PAIRS) {
    throw new Error(
      `carmods.dat holds ${carmods.links.length} 'link' pairs and the game's array is ${STOCK_LINK_PAIRS} ` +
        `(CLinkedUpgradeList, stock uses 23). The 31st pair writes past it — static corruption, no message. ` +
        `Ship ${PERFECT_VEHICLE_ASI} (asi/perfect-vehicle plan 002) to lift it, or drop ` +
        `${carmods.links.length - STOCK_LINK_PAIRS} pair(s): ` +
        carmods.links
          .slice(STOCK_LINK_PAIRS)
          .map(([left, right]) => `${left}/${right}`)
          .join(', '),
    );
  }
  const over = [...carmods.mods].filter(([, parts]) => parts.length > STOCK_PARTS_PER_CAR);
  if (over.length > 0) {
    throw new Error(
      `${over.length} car(s) list more than ${STOCK_PARTS_PER_CAR} upgrade parts, which is what ` +
        `m_anUpgrades[18] holds once the game appends hydralics and stereo — the extra parts overrun the ` +
        `model info. Ship ${PERFECT_VEHICLE_ASI} to lift it, or shorten: ` +
        over.map(([model, parts]) => `${model} (${parts.length})`).join(', '),
    );
  }
}

/** How much room is left in each array — for a run that wants to say so before it fills one. */
export function carmodsHeadroom(gameDir: string): { links: number; partsPerCar: number } {
  const path = join(gameDir, 'data', 'carmods.dat');
  if (!existsSync(path)) {
    return { links: STOCK_LINK_PAIRS, partsPerCar: STOCK_PARTS_PER_CAR };
  }
  const carmods = parseCarmods(readFileSync(path, 'latin1'));
  const worst = Math.max(0, ...[...carmods.mods.values()].map((parts) => parts.length));

  return { links: STOCK_LINK_PAIRS - carmods.links.length, partsPerCar: STOCK_PARTS_PER_CAR - worst };
}
