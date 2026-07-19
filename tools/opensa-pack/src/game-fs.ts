/**
 * Node `AssetFileSystem` over a game directory (plan 074/03): loose files (data/**, models/** …) by relative
 * path + every `models/*.img` archive's members by basename — the same resolution order the web app's VFS
 * gives the engine, so `resolveMap`/`asset-cache` behave identically here.
 *
 * `overlayDirs` (074/06 row 10): directories of replacement assets checked FIRST — the offline equivalent of
 * modloader overlays (e.g. wind-adapted vegetation DFFs whose prelit alpha encodes sway weights).
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { openArchive } from '@opensa/renderware';
import { parseVer2Directory, ver2DirectoryLength, ver2EntryCount } from '@opensa/renderware/archive';
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

/** What both archive readers below expose — enough for {@link openGameDir} and nothing more. */
interface ArchiveReader {
  get(name: string): ArrayBuffer | null;
  readonly names: string[];
}

export function openGameDir(root: string, overlayDirs: readonly string[] = []): AssetFileSystem {
  // Overlay assets indexed by lowercased basename ('ash1_hi.dff') — they shadow img/loose entries.
  const overlay = new Map<string, string>();
  const walkOverlay = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walkOverlay(full);
      } else {
        overlay.set(basename(entry).toLowerCase(), full);
      }
    }
  };
  for (const dir of overlayDirs) {
    walkOverlay(dir);
  }
  // Loose files indexed by lowercased relative path with forward slashes ('data/gta.dat'), PLUS by bare
  // basename — img members resolve by basename, and a loose model TXD (e.g. `models/particle.txd`, which the
  // roadsign-font planner asks for as `particle.txd`) must resolve the same way. Path wins; basename is a
  // last-resort fallback (first walk order wins on a collision).
  const loose = new Map<string, string>();
  const looseByBase = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
      } else if (!entry.toLowerCase().endsWith('.img')) {
        loose.set(relative(root, full).split(sep).join('/').toLowerCase(), full);
        const base = basename(full).toLowerCase();
        if (!looseByBase.has(base)) {
          looseByBase.set(base, full);
        }
      }
    }
  };
  walk(root);

  const archives: ArchiveReader[] = readdirSync(join(root, 'models'))
    .filter((file) => file.toLowerCase().endsWith('.img'))
    .sort()
    .map((file) => {
      const path = join(root, 'models', file);

      return openLazyVer2(path) ?? openArchive(new Uint8Array(readFileSync(path)));
    });

  const get = (name: string): ArrayBuffer | null => {
    const overlayPath = overlay.get(name.toLowerCase());
    if (overlayPath) {
      const buffer = readFileSync(overlayPath);

      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    for (const archive of archives) {
      const bytes = archive.get(name);
      if (bytes) {
        return bytes;
      }
    }
    const loosePath = loose.get(name.toLowerCase()) ?? looseByBase.get(name.toLowerCase());
    if (loosePath) {
      const buffer = readFileSync(loosePath);

      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }

    return null;
  };

  return {
    get,
    getText(name: string): null | string {
      const loosePath = loose.get(name.toLowerCase());
      if (loosePath) {
        return readFileSync(loosePath, 'utf8');
      }
      const bytes = get(name);

      return bytes ? new TextDecoder().decode(bytes) : null;
    },
    has(name: string): boolean {
      return (
        overlay.has(name.toLowerCase()) ||
        loose.has(name.toLowerCase()) ||
        looseByBase.has(name.toLowerCase()) ||
        archives.some((archive) => archive.get(name) !== null)
      );
    },
    get names(): string[] {
      return [...overlay.keys(), ...archives.flatMap((archive) => archive.names), ...loose.keys()];
    },
  };
}

/**
 * A VER2 archive read through a FILE HANDLE: the directory up front, each entry sliced on demand.
 *
 * Buffering the whole `.img` is what the browser VFS already refuses to do, and Node cannot do it at all
 * past 2 GB — `readFileSync` throws `ERR_FS_FILE_TOO_LARGE`, which is how the converter came to be unable
 * to read its OWN output once the per-model files went in (the deletions brought it back under, but one
 * big mod would have hit the wall again). It also keeps ~1.3 GB per archive out of the convert's RSS.
 *
 * Returns null for anything that is not VER2 — our own WIMG archives stay on the buffered path.
 */
function openLazyVer2(path: string): ArchiveReader | null {
  const fd = openSync(path, 'r');
  const header = Buffer.alloc(8);
  readSync(fd, header, 0, 8, 0);
  if (header.toString('latin1', 0, 4) !== 'VER2') {
    closeSync(fd);

    return null;
  }
  const directory = Buffer.alloc(ver2DirectoryLength(ver2EntryCount(new Uint8Array(header))));
  readSync(fd, directory, 0, directory.length, 0);
  const files = parseVer2Directory(new Uint8Array(directory));

  return {
    get(name: string): ArrayBuffer | null {
      const entry = files.get(name.toLowerCase());
      if (!entry) {
        return null;
      }
      const [offset, size] = entry;
      const bytes = Buffer.alloc(size);
      readSync(fd, bytes, 0, size, offset);

      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    names: [...files.keys()],
  };
}
