import type { EditableImg } from '@opensa/tool-kit/archive/img';

import { reorderFrameList } from '@opensa/renderware/parsers/binary/frame-order';
import { closeSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How much of a `.dff` is read to ask whether its frame list is ordered. The list sits at the head of the
 * clump — a 61-frame car spends about 5 KB on it — so this answers for every real model without pulling the
 * file, which is the whole reason {@link stageVehicleImg} stages by PATH.
 */
const FRAME_LIST_PROBE_BYTES = 64 * 1024;

/** What a folder put into the archive, and what had to be repaired on the way in. */
export interface StagedVehicleImg {
  /** Lowercased entry names staged (used by `--strip`). */
  names: string[];
  /** Lowercased `.dff` names whose frame list was reordered before staging. */
  repaired: string[];
}

/**
 * Repaired bytes for a `.dff` whose frame list declares a parent AFTER the child it belongs to, or `null`
 * when the file is already ordered — which is the answer for every stock model and all but one of the 212
 * vehicle folders measured on 2026-08-19.
 *
 * The real game cannot read such a file: RenderWare parents each frame in the pass that creates it, so a
 * forward reference reads an unwritten array slot and either faults in `RwFrameAddChild` (`0x007F0BF7`) or
 * corrupts memory quietly, decided by whatever was there. **Nothing else catches it** — byte-faithful
 * staging ships a mod's file as authored, and OpenSA's own reader resolves parents by index, so a model
 * that renders perfectly here still kills the target. Measurement:
 * `docs/gta-sa-original/rw-frame-list-parent-order.md`.
 *
 * The repair is a permutation and the file keeps its length; a mod's geometry is not re-encoded.
 *
 * Exported because a vehicle's files do not always go into an archive: `tools/add-vehicles` writes its cars
 * LOOSE into `modloader/`, and a file that reaches the game by that road needs the same repair — the defect
 * is in the file, not in the transport.
 */
export function repairFrameOrder(path: string): null | Uint8Array {
  const handle = openSync(path, 'r');
  const probe = Buffer.alloc(FRAME_LIST_PROBE_BYTES);
  let read = 0;
  try {
    read = readSync(handle, probe, 0, FRAME_LIST_PROBE_BYTES, 0);
  } finally {
    closeSync(handle);
  }
  const head = probe.buffer.slice(probe.byteOffset, probe.byteOffset + read);
  try {
    if (reorderFrameList(head) === null) {
      return null;
    }
  } catch {
    // The frame list ran past the probe, or the head is not something we can reason about — fall through
    // and let the whole file answer rather than guessing from a fragment.
  }
  const whole = readFileSync(path);

  return reorderFrameList(whole.buffer.slice(whole.byteOffset, whole.byteOffset + whole.byteLength));
}

/**
 * Archive entry names (lowercased `.dff`/`.txd` file names) that MORE THAN ONE vehicle folder ships, with the
 * folders in install order. Two cars sharing a paint job name is a typo; two cars sharing a tuning PART is
 * the real case (the voodoo re-uses the blade's `rbmp_lr_bl1` slot with its own geometry, 2026-08-17): the
 * archive holds one entry per name, so the LAST folder wins and the other car wears the wrong part —
 * silently, unless whoever stages them says so.
 */
export function sharedVehicleFiles(
  sources: readonly { readonly folder: string; readonly name: string }[],
): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const source of sources) {
    for (const entry of readdirSync(source.folder, { withFileTypes: true })) {
      if (entry.isFile() && /\.(?:dff|txd)$/i.test(entry.name)) {
        const key = entry.name.toLowerCase();
        owners.set(key, [...(owners.get(key) ?? []), source.name]);
      }
    }
  }

  return new Map([...owners].filter(([, names]) => names.length > 1));
}

/**
 * Stage a vehicle folder's `.dff` + `.txd` files into `gta3.img`, **replacing by name** (adding if new). This
 * includes any extra numbered txds (`<model>1.txd`, …) — they ship in the archive, though using them in-game is
 * out of scope (plan 002). Returns the lowercased entry names staged (used by `--strip`).
 *
 * **Staged, not written.** The caller owns the archive and writes it ONCE, because this used to open, rebuild
 * and write the whole `gta3.img` per car: 212 cars over a growing multi-GB file, and the last write crossed
 * `writeFileSync`'s 2 GiB ceiling mid-stage (`ERR_OUT_OF_RANGE`, 2 168 825 856 B, 2026-08-15). Files stay on
 * disk until the write pulls them, so staging a 3 GB mod set costs paths rather than buffers.
 */
export function stageVehicleImg(
  folderPath: string,
  img: EditableImg,
  /**
   * File name (lowercased, with extension) → the entry name to stage it UNDER. An added car ships its base's
   * tuning parts under the STOCK names, and staging those would overwrite the stock part for every car that
   * uses it — so `tools/add-vehicles` renames them here, at the one point where a file becomes an entry.
   */
  renames: ReadonlyMap<string, string> = new Map(),
): StagedVehicleImg {
  const files = readdirSync(folderPath, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && /\.(?:dff|txd)$/i.test(entry.name),
  );
  const repaired: string[] = [];
  const names: string[] = [];
  for (const file of files) {
    const path = join(folderPath, file.name);
    const entry = renames.get(file.name.toLowerCase()) ?? file.name;
    names.push(entry.toLowerCase());
    // Only a `.dff` carries a frame list, and only a broken one is ever read whole — everything else keeps
    // the staged-by-path route this function exists for.
    const fixed = /\.dff$/i.test(file.name) ? repairFrameOrder(path) : null;
    if (fixed) {
      img.set(entry, fixed);
      repaired.push(entry.toLowerCase());
    } else {
      img.setFile(entry, path);
    }
  }

  return { names, repaired };
}
