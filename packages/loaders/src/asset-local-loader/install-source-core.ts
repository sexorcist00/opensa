/**
 * Shared {@link InstallSource} assembly (plan 079 phase 1). Both backings — a File System Access folder
 * (`install-source.ts`) and a served game dir over HTTP (`fetch-install-source.ts`) — differ ONLY in how they
 * turn a path into bytes; the archive split (gta3 + merged override archives) and the loose-file selection are
 * identical, so they live here once. See `install-source.ts` for the gta3/gta_int/mod-archive rationale.
 */
import type { InstallSource } from './build-vfs';
import type { ByteRangeSource, LazyImgArchive } from './img-reader';

import { openLazyVer2 } from './img-reader';

const GTA3 = 'models/gta3.img';
const GTA_INT = 'models/gta_int.img';
const MODEL_IMG = /^models\/[^/]+\.img$/;

/** The per-backing IO an {@link InstallSource} is assembled over. Paths are lowercased, `/`-joined, relative. */
export interface InstallIo {
  /** A random-access source for an archive path (a File handle or an HTTP Range URL). */
  archiveSource(path: string): Promise<ByteRangeSource>;
  /** A loose file as a Blob (disk-backed / fetched), or null when absent. */
  openLoose(path: string): Promise<Blob | null>;
  /** Every file path present. */
  readonly paths: readonly string[];
  /** Raw bytes of a loose file. */
  readLoose(path: string): Promise<Uint8Array>;
}

/** Assemble an {@link InstallSource}: open gta3.img, merge every other `models/*.img` as an override, list loose. */
export async function assembleInstallSource(io: InstallIo): Promise<InstallSource> {
  if (!io.paths.includes(GTA3)) {
    throw new Error('models/gta3.img not found — pick the GTA San Andreas install folder (or a served game dir)');
  }
  const gta3 = await openLazyVer2(await io.archiveSource(GTA3));

  // Every other `models/*.img` is an override (gta_int.img first for precedence, then mod archives like
  // `lods.img`). Merge them so a mod's models resolve — not only gta_int.img's.
  const overridePaths = io.paths
    .filter((path) => MODEL_IMG.test(path) && path !== GTA3)
    .sort((a, b) => (a === GTA_INT ? -1 : b === GTA_INT ? 1 : a.localeCompare(b)));
  const overrides: LazyImgArchive[] = [];
  for (const path of overridePaths) {
    overrides.push(await openLazyVer2(await io.archiveSource(path)));
  }
  const gtaInt = overrides.length > 0 ? mergeLazy(overrides) : null;

  // Archives served lazily or unused (anim) are kept out of the loose-file set.
  const excluded = new Set(['anim/anim.img', ...overridePaths, GTA3]);
  const loose = io.paths.filter((path) => !excluded.has(path) && !path.endsWith('.ds_store'));

  return {
    gta3,
    gtaInt,
    looseFiles: () => Promise.resolve(loose),
    openLoose: (path) => io.openLoose(path),
    readLoose: (path) => io.readLoose(path),
    readLooseText: async (path) => new TextDecoder().decode(await io.readLoose(path)),
  };
}

/** Merge lazy archives into one override archive (first archive owning a name wins, like `mergeArchives`). */
function mergeLazy(archives: readonly LazyImgArchive[]): LazyImgArchive {
  const owner = new Map<string, LazyImgArchive>();
  for (const archive of archives) {
    for (const name of archive.names) {
      if (!owner.has(name)) {
        owner.set(name, archive);
      }
    }
  }

  return {
    has: (name) => owner.has(name.toLowerCase()),
    names: [...owner.keys()],
    read: (name) => owner.get(name.toLowerCase())?.read(name) ?? Promise.resolve(null),
  };
}
