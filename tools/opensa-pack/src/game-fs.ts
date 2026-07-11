/**
 * Node `AssetFileSystem` over a game directory (plan 074/03): loose files (data/**, models/** …) by relative
 * path + every `models/*.img` archive's members by basename — the same resolution order the web app's VFS
 * gives the engine, so `resolveMap`/`asset-cache` behave identically here.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { openArchive } from '@opensa/renderware';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function openGameDir(root: string): AssetFileSystem {
  // Loose files indexed by lowercased relative path with forward slashes ('data/gta.dat').
  const loose = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
      } else if (!entry.toLowerCase().endsWith('.img')) {
        loose.set(relative(root, full).split(sep).join('/').toLowerCase(), full);
      }
    }
  };
  walk(root);

  const archives = readdirSync(join(root, 'models'))
    .filter((file) => file.toLowerCase().endsWith('.img'))
    .sort()
    .map((file) => openArchive(new Uint8Array(readFileSync(join(root, 'models', file)))));

  const get = (name: string): ArrayBuffer | null => {
    for (const archive of archives) {
      const bytes = archive.get(name);
      if (bytes) {
        return bytes;
      }
    }
    const loosePath = loose.get(name.toLowerCase());
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
      return loose.has(name.toLowerCase()) || archives.some((archive) => archive.get(name) !== null);
    },
    get names(): string[] {
      return [...archives.flatMap((archive) => archive.names), ...loose.keys()];
    },
  };
}
