import type { IfpAnimation } from '../parsers/binary/ifp';
import type { RWClump } from '../parsers/binary/types';
import type { ImgArchive } from './img-archive';

import { parseDff } from '../parsers/binary/dff';
import { parseIfp } from '../parsers/binary/ifp';

/**
 * Parse models/textures out of the in-memory WIMG archive, cached by name.
 *
 * Synchronous (the archive is already downloaded), so there's no per-model
 * fetch/Suspense. A name absent from the archive (or unparseable) yields an
 * empty clump / empty texture map — it renders nothing instead of crashing.
 */
const EMPTY_CLUMP: RWClump = { atomics: [], frames: [], geometries: [] };

const clumpCache = new Map<string, RWClump>();
/** Parse caches are BOUNDED (plan 073/08 memory): unbounded, every model ever driven past stayed in the JS
 *  heap forever (multi-GB — unified-memory pressure collapses the GPU on Apple Silicon). LRU by insertion
 *  order: a hit re-inserts, overflow evicts the oldest — an evicted model simply re-parses on revisit. */
const CLUMP_CACHE_MAX = 512;

/** LRU touch: refresh `key`'s recency (Maps iterate in insertion order) and evict past `max`. */
function lruSet<K, V>(cache: Map<K, V>, key: K, value: V, max: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > max) {
    const oldest = cache.keys().next().value as K;
    cache.delete(oldest);
  }
}

/** Parsed IFP animation packages (zone object clips like `counxref.ifp`), by lowercased name. */
const ifpCache = new Map<string, IfpAnimation[]>();

/** A TXD's own (raw) parsed textures, by lowercased name (no extension). */
/** A TXD's *resolved* textures — its own overlaid on its `txdp` parent chain — by lowercased name. */
/** `txdp` parent links (lowercased child → parent). Empty until {@link setTxdParents}; then chains resolve. */

export function getClump(archive: ImgArchive, modelName: string): RWClump {
  const key = `${modelName.toLowerCase()}.dff`;
  let clump = clumpCache.get(key);
  if (!clump) {
    clump = parseOrEmpty(archive.get(key), parseDff, EMPTY_CLUMP);
  }
  lruSet(clumpCache, key, clump, CLUMP_CACHE_MAX);

  return clump;
}

/** An IFP package's animations (e.g. the zone object clips a map model's IDE `anim` row names),
 *  cached by name. Absent/unparseable yields an empty list — the object renders static. */
export function getIfp(archive: ImgArchive, ifpName: string): IfpAnimation[] {
  const key = ifpName.toLowerCase();
  let animations = ifpCache.get(key);
  if (!animations) {
    animations = parseOrEmpty(archive.get(`${key}.ifp`), parseIfp, []);
    ifpCache.set(key, animations);
  }

  return animations;
}

/** Whether a model's clump is already cached (the streaming parse worker skips re-parsing it). */
export function hasClump(modelName: string): boolean {
  return clumpCache.has(`${modelName.toLowerCase()}.dff`);
}

/** Seed the clump cache with a worker-parsed model (plan 060 Phase 5). */
export function primeClump(modelName: string, clump: RWClump): void {
  lruSet(clumpCache, `${modelName.toLowerCase()}.dff`, clump, CLUMP_CACHE_MAX);
}

/**
 * Walk a TXD's `txdp` parent chain, overlaying each child's own textures on its parent's so the **child
 * wins** (the inheritance the optimized map relies on). Pure — `ownOf` supplies each TXD's own map — and
 * cycle-guarded; the caller ({@link getTextures}) memoizes the final per-name result. An empty/absent parent
 * map (or missing parent TXD) collapses to just the child, so it's a no-op on self-contained archives.
 */

/**
 * Install the `txdp` parent map (from {@link MapDefinitions}). A child TXD then inherits any texture it
 * lacks from its parent (recursively). Clears the resolved cache so existing maps pick up the new chains.
 * No-op effect when empty (stock archives are self-contained), so it's always safe to call.
 */

function parseOrEmpty<T>(buffer: ArrayBuffer | null, parse: (buffer: ArrayBuffer) => T, empty: T): T {
  if (!buffer) {
    return empty;
  }
  try {
    return parse(buffer);
  } catch {
    return empty;
  }
}
