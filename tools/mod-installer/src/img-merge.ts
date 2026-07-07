import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { applyStreamMerge, isStreamMerge } from './stream-merge';

/**
 * Apply a mod's `<name>.ipl.merge` stream edits from an IMG folder onto the archive's entries (add/remove/
 * replace instances — `stream-merge.ts`). Runs AFTER the mod's data merges. Returns the number applied.
 */
export function applyStreamMergeDir(imgDir: string, imgPath: string): number {
  const merges = readdirSync(imgDir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && isStreamMerge(entry.name),
  );
  if (merges.length === 0) {
    return 0;
  }
  if (!existsSync(imgPath)) {
    throw new Error(`stream merge target archive does not exist: ${imgPath}`);
  }
  const img = openImg(readBytes(imgPath));
  for (const merge of merges) {
    const entryName = merge.name.slice(0, -'.merge'.length);
    const entry = img.get(entryName);
    if (!entry) {
      throw new Error(`stream merge target entry does not exist in ${imgPath}: ${entryName}`);
    }
    const { bytes, warnings } = applyStreamMerge(entry, readFileSync(join(imgDir, merge.name), 'utf8'), entryName);
    for (const warning of warnings) {
      console.warn(`mod-installer: ${warning}`);
    }
    img.set(entryName, bytes);
  }
  writeBytes(imgPath, img.build());

  return merges.length;
}

/** A `Remove original/` subfolder inside an IMG folder — its FILE NAMES are deleted from the target archive. */
const REMOVE_ORIGINAL_DIR = /^remove[ _-]?originals?$/i;

/**
 * Set `name → bytes` entries into the `.img` at `imgPath` (add new / replace existing by name), rebuild + write;
 * seeds a fresh archive if `imgPath` is absent. `removals` (entry names) are DELETED first — the `Remove
 * original/` convention — so a mod can both retire stock entries and ship same-name replacements. Used both by
 * {@link mergeImgDir} (a `gta3_img/`/`gta_int_img/` folder) and by the Modloader baker (scattered
 * `.dff`/`.txd`/`.col`/`.ifp` collected by bare name). Returns the number of operations applied.
 */
export function injectImgEntries(
  entries: ReadonlyMap<string, Uint8Array>,
  imgPath: string,
  removals: readonly string[] = [],
): number {
  if (entries.size === 0 && removals.length === 0) {
    return 0;
  }
  const img = existsSync(imgPath) ? openImg(readBytes(imgPath)) : createImg();
  for (const name of removals) {
    if (!img.delete(name)) {
      console.warn(`mod-installer: Remove original — entry not in ${imgPath}: ${name}`);
    }
  }
  for (const [name, bytes] of entries) {
    img.set(name, bytes);
  }
  writeBytes(imgPath, img.build());

  return entries.size + removals.length;
}

/** Whether this directory name is the remove-original convention (`Remove original`, `remove_originals`, …). */
export function isRemoveOriginalDir(name: string): boolean {
  return REMOVE_ORIGINAL_DIR.test(name.trim());
}

/**
 * Merge a mod's loose IMG-folder files (`gta3_img/` → `gta3.img`, `gta_int_img/` → `gta_int.img`) into the
 * archive at `imgPath`: `set` each file as an entry (adding new ones, replacing existing by name), then rebuild +
 * write. If `imgPath` doesn't exist yet, the loose files seed a fresh archive. (The `*_img/` folder is the
 * generic "loose IMG entries" convention — a binary `.img` can't be patched file-by-file, so a mod ships a
 * folder.) `<name>.ipl.merge` files are NOT entries — they EDIT the named stream entry (plan 008) and are
 * applied by {@link applyStreamMergeDir} in a later pass (after the mod's data merges, whose inst removals
 * rebase the streams first). A `Remove original/` SUBFOLDER's file names are DELETED from the archive (the
 * files' contents are irrelevant — mods ship the retired originals for reference). Returns the number of
 * operations applied.
 */
export function mergeImgDir(imgDir: string, imgPath: string): number {
  const listing = readdirSync(imgDir, { withFileTypes: true });
  const files = listing.filter((entry) => entry.isFile() && !isStreamMerge(entry.name));
  const entries = new Map(files.map((file) => [file.name, readBytes(join(imgDir, file.name))]));
  const removals = listing
    .filter((entry) => entry.isDirectory() && isRemoveOriginalDir(entry.name))
    .flatMap((dir) =>
      readdirSync(join(imgDir, dir.name), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name),
    );

  return injectImgEntries(entries, imgPath, removals);
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function writeBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
