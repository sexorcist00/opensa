/**
 * Where an added car's MODELS go: `modloader/added-vehicles/`, loose — not into an IMG archive.
 *
 * The archives were the first road and they ran into a wall the game does not warn about. SA registers
 * **8 IMG archives** (`CStreaming::ms_files`, 3 hardcoded + 5 in `gta.dat`) and the built tree already spends
 * six of them on stock content; the added fleet's +1.37 GB pushed the vehicles family to a third file and the
 * build stopped at `assertArchiveSlots` with 9 of 8
 * (`docs/in-reserve/img-archive-limit-lift.md`, the trigger that fired 2026-08-19).
 *
 * Modloader has no such ceiling: it imports a loose `.dff`/`.txd` by NAME at load, which is how the user's
 * earlier build shipped these same cars (`NO_COMMIT/1/build/modloader/Vehicles Added/` — 161 dffs and 161
 * txds, the tuning parts among them and none of them with a dictionary of its own). So the cars ride the road
 * the install already runs `modloader.asi` for, and the archive ceiling stops being this feature's problem.
 *
 * **What this costs, stated rather than discovered**: a loose TXD still takes a streaming id at runtime, and
 * `checkImgIdBudgets` counts ARCHIVE entries — so the FLA TXD pool is under-counted by whatever lands here.
 * The pool has 662 slots of headroom against the 161 files this fleet adds; a fleet that could actually
 * exhaust it would need its own count, and this comment is the trail to it.
 */
import { repairFrameOrder } from '@opensa/vehicle-installer/img-merge';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The folder modloader imports the added fleet from, inside the built game dir. */
export const ADDED_VEHICLES_DIR = join('modloader', 'added-vehicles');

/** What one car's files cost the tree, and what had to be repaired on the way. */
export interface LooseInstall {
  /** File names written (lowercased), under their FINAL names — a re-modelled part's is the derived one. */
  readonly names: readonly string[];
  /** `.dff` names whose frame list was reordered before writing. */
  readonly repaired: readonly string[];
}

/**
 * Empty the folder before a FULL run writes it. A car deleted from the source must not survive in the tree —
 * the persistent-`--out` lesson (`docs/restrictions/architecture.md`), and here it would be a model the game
 * still imports under an id nothing defines any more. A narrowed run (`--only`) never wipes: it speaks for
 * its own cars, exactly as the ledger does.
 */
export function clearLooseFiles(gameDir: string): void {
  rmSync(join(gameDir, ADDED_VEHICLES_DIR), { force: true, recursive: true });
}

/**
 * Copy one car folder's `.dff`/`.txd` into `modloader/added-vehicles/`, applying `renames` (a re-modelled
 * tuning part ships under the name the install gave it, never the stock one) and the same frame-list repair
 * the archive road does — the defect is in the file, not in the transport.
 */
export function installLooseFiles(
  gameDir: string,
  folderPath: string,
  renames: ReadonlyMap<string, string> = new Map(),
): LooseInstall {
  const dest = join(gameDir, ADDED_VEHICLES_DIR);
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  const repaired: string[] = [];
  for (const entry of readdirSync(folderPath, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:dff|txd)$/i.test(entry.name)) {
      continue;
    }
    const source = join(folderPath, entry.name);
    const name = renames.get(entry.name.toLowerCase()) ?? entry.name;
    const fixed = /\.dff$/i.test(entry.name) ? repairFrameOrder(source) : null;
    if (fixed) {
      writeFileSync(join(dest, name), fixed);
      repaired.push(name.toLowerCase());
    } else {
      copyFileSync(source, join(dest, name));
    }
    names.push(name.toLowerCase());
  }

  return { names, repaired };
}
