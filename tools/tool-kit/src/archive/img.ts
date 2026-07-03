import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { buildVer2Buffer, openArchive } from '@opensa/renderware/archive/img-archive';
import { closeSync, ftruncateSync, openSync, writeSync } from 'node:fs';

/**
 * An **editable** GTA IMG (VER2) archive: open, read, add-with-replace, delete, then rebuild a fresh `.img`.
 * Wraps the engine's read (`openArchive`) + write (`buildVer2Buffer`) primitives (read-only reuse) with the
 * mutation surface the offline tools need — map-optimizer (swap optimized entries) and opensa-lod-generator (emit
 * cell-LOD DFFs/atlas TXDs, strip old LODs). Edits are tracked lazily: untouched entries are read straight from
 * the source on rebuild, so opening a large archive is cheap. Entry names are case-insensitive (GTA convention).
 */
export interface EditableImg {
  /** Rebuild a VER2 `.img` buffer from the current entries (originals minus deletes, plus adds/replaces). */
  build(): Uint8Array;
  /** Remove an entry; returns false if it wasn't present. */
  delete(name: string): boolean;
  /** Entry bytes, or null if absent / deleted. */
  get(name: string): null | Uint8Array;
  /** Whether an entry is currently present. */
  has(name: string): boolean;
  /** Current entry names, in archive order (deletes removed, adds appended). */
  names(): string[];
  /** Add a new entry or replace an existing one. */
  set(name: string, data: Uint8Array): void;
}

/** A fresh, empty {@link EditableImg} to populate with `set` and `build` (e.g. a new LOD archive). */
export function createImg(): EditableImg {
  return openImg(buildVer2Buffer([]));
}

/** Wrap an already-opened engine archive as an {@link EditableImg} (no re-read of the source bytes). */
export function editArchive(archive: ImgArchive): EditableImg {
  const order = [...archive.names];
  const overrides = new Map<string, Uint8Array>();
  const deleted = new Set<string>();
  const key = (name: string): string => name.toLowerCase();
  const readOriginal = (name: string): null | Uint8Array => {
    const buffer = archive.get(name);

    return buffer ? new Uint8Array(buffer) : null;
  };

  const img: EditableImg = {
    build(): Uint8Array {
      return buildVer2Buffer(img.names().map((name) => ({ data: img.get(name) ?? new Uint8Array(0), name })));
    },
    delete(name: string): boolean {
      if (!img.has(name)) {
        return false;
      }
      deleted.add(key(name));
      overrides.delete(key(name));

      return true;
    },
    get(name: string): null | Uint8Array {
      if (deleted.has(key(name))) {
        return null;
      }

      return overrides.get(key(name)) ?? readOriginal(name);
    },
    has(name: string): boolean {
      return img.get(name) !== null;
    },
    names(): string[] {
      return order.filter((name) => !deleted.has(key(name)));
    },
    set(name: string, data: Uint8Array): void {
      deleted.delete(key(name));
      if (!order.some((existing) => key(existing) === key(name))) {
        order.push(name);
      }
      overrides.set(key(name), data);
    },
  };

  return img;
}

/** Open IMG bytes as an {@link EditableImg}. */
export function openImg(bytes: Uint8Array): EditableImg {
  return editArchive(openArchive(bytes));
}

const SECTOR = 2048;

/**
 * Stream an {@link EditableImg} to a VER2 `.img` **file** — the low-memory sibling of `build()`: entries are
 * pulled and written one at a time (peak extra memory = the largest single entry, not the whole archive), the
 * directory lands in its reserved leading sectors afterwards. Byte-identical to
 * `buildVer2Buffer(img.names().map(…))`. For the ~1 GB game archives `build()` alone doubles the run's peak
 * RSS; this keeps the rebuild flat (map-optimizer plan 011 finalize).
 */
export function writeImgFile(img: EditableImg, path: string): void {
  const names = img.names();
  const dirSectors = Math.ceil((8 + names.length * 32) / SECTOR);
  const directory = new Uint8Array(dirSectors * SECTOR);
  const view = new DataView(directory.buffer);
  directory.set(new TextEncoder().encode('VER2'), 0);
  view.setUint32(4, names.length, true);

  const fd = openSync(path, 'w');
  try {
    let cursor = dirSectors;
    names.forEach((name, i) => {
      const encoded = new TextEncoder().encode(name);
      if (encoded.length > 23) {
        throw new Error(`VER2 name too long (max 23 bytes): ${name}`);
      }
      const data = img.get(name) ?? new Uint8Array(0);
      const sectors = Math.max(1, Math.ceil(data.length / SECTOR));
      const base = 8 + i * 32;
      view.setUint32(base, cursor, true);
      view.setUint16(base + 4, sectors, true); // streamingSize (sectors); sizeInArchive stays 0
      directory.set(encoded, base + 8);
      writeSync(fd, data, 0, data.length, cursor * SECTOR);
      cursor += sectors;
    });
    ftruncateSync(fd, cursor * SECTOR); // zero-fill the last entry's sector padding
    writeSync(fd, directory, 0, directory.length, 0);
  } finally {
    closeSync(fd);
  }
}
