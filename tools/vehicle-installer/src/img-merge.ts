import type { EditableImg } from '@opensa/tool-kit/archive/img';

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

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
export function stageVehicleImg(folderPath: string, img: EditableImg): string[] {
  const files = readdirSync(folderPath, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && /\.(?:dff|txd)$/i.test(entry.name),
  );
  for (const file of files) {
    img.setFile(file.name, join(folderPath, file.name));
  }

  return files.map((file) => file.name.toLowerCase());
}
