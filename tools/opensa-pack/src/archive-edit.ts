/**
 * Delete-and-insert inside `<out>/models/*.img` (plan opensa-pack/003 phase 3).
 *
 * The rule from the plan: **full replacement, own extension, same basename** — `landstal.dff` becomes
 * `landstal.osm` and the original is DELETED, so no entry lies about what it holds. An insert names the
 * entry it lands `near`, which keeps `models/*.img` meaning what it meant before (gta3 vs gta_int) instead
 * of collapsing every converted asset into the first archive.
 *
 * Rebuilds stream through `writeImgFile` — `build()` on a ~1 GB archive would double the run's peak RSS
 * (the same reason map-optimizer streams, `adapters/gta-sa/build.ts`).
 */
import { openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ArchiveEdit {
  /** Entries to remove from whichever archive holds them. */
  readonly deletes: readonly string[];
  /** Entries to add, each into the archive that holds `near` — normally the original it replaces. */
  readonly inserts: readonly ArchiveInsert[];
}

export interface ArchiveInsert {
  readonly bytes: Uint8Array;
  readonly name: string;
  /** An existing entry whose archive receives this one. */
  readonly near: string;
}

export interface ArchiveRewriteReport {
  /** Per rebuilt archive: entries inserted, entries deleted, and the size it ended at. */
  readonly archives: readonly ArchiveRewriteStat[];
  /** Deletes no archive held — already absent, or a loose file. Harmless, reported for honesty. */
  readonly missingDeletes: readonly string[];
  /** Inserts whose `near` no archive held, so they were NOT written. A silent drop otherwise. */
  readonly unplaced: readonly string[];
}

export interface ArchiveRewriteStat {
  readonly bytes: number;
  readonly deleted: number;
  readonly file: string;
  readonly inserted: number;
}

/**
 * Apply `edit` to every `<outDir>/models/*.img`. Archives with nothing to change are left untouched on
 * disk — no pointless 1 GB rewrite.
 */
export function rewriteModelArchives(outDir: string, edit: ArchiveEdit): ArchiveRewriteReport {
  const modelsDir = join(outDir, 'models');
  const files = readdirSync(modelsDir)
    .filter((file) => file.toLowerCase().endsWith('.img'))
    .sort();

  const inserts = new Map(edit.inserts.map((insert) => [insert.name.toLowerCase(), insert]));
  const deletes = new Set(edit.deletes.map((name) => name.toLowerCase()));
  const archives: ArchiveRewriteStat[] = [];

  for (const file of files) {
    if (inserts.size === 0 && deletes.size === 0) {
      break;
    }
    const path = join(modelsDir, file);
    const bytes = readFileSync(path);
    const img = openImg(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));

    // Inserts first: `near` is resolved while the original it replaces is still present.
    let inserted = 0;
    for (const [key, insert] of inserts) {
      if (!img.has(insert.near)) {
        continue;
      }
      img.set(insert.name, insert.bytes);
      inserts.delete(key);
      inserted += 1;
    }
    let deleted = 0;
    for (const name of deletes) {
      if (img.delete(name)) {
        deletes.delete(name);
        deleted += 1;
      }
    }
    if (inserted === 0 && deleted === 0) {
      continue;
    }
    writeImgFile(img, path);
    archives.push({ bytes: statSync(path).size, deleted, file, inserted });
  }

  return { archives, missingDeletes: [...deletes], unplaced: [...inserts.keys()] };
}
