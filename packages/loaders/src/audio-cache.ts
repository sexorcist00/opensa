/**
 * What audio is allowed to keep in memory, and what goes when it is full (203/2-03).
 *
 * **The ceiling is 64 MB and it is not a guess** — it is the budget named before the work
 * ([the plan](../../../docs/plans/203-audio/readme.md)), and the census says why one is needed at all: the
 * stock SFX set is **364.1 MB of PCM**, 5.7x the budget, so "load the bank" was never on the table and what
 * is resident is always a WORKING SET rather than a library.
 *
 * **It is generic over what it holds, and that is deliberate rather than speculative.** Chain 2 caches the
 * fetched PCM; chain 3 will want the float buffers the context plays, which are the same entries at twice
 * the size. Two caches would mean two ceilings and a budget nobody can state, so the structure takes a
 * `bytesOf` and the caller decides what an entry IS. That is the one generic this file has.
 *
 * **Least-recently-USED, not least-recently-added.** A city's ambience bed is fetched once and touched for
 * an hour; a gunshot is touched once. Insertion order would evict the bed for the gunshot.
 */

/** What a capture states about audio memory — the fields 3/03 and 4/03 file. */
export interface AudioCacheReport {
  /** Live bytes, by the caller's own `bytesOf`. */
  readonly bytes: number;
  readonly ceilingBytes: number;
  readonly entries: number;
  /** How many entries were dropped to stay under the ceiling — a rising count is a working set too big. */
  readonly evictions: number;
  readonly hits: number;
  readonly misses: number;
  /** Entries REFUSED because one of them alone was over the ceiling. Never zero silently: see `set`. */
  readonly refused: number;
}

/** The audio memory budget (203), stated once so a report and a cache cannot disagree about it. */
export const AUDIO_CACHE_CEILING_BYTES = 64 * 1024 * 1024;

/** A byte-ceilinged LRU. Keys are sound indices into the `.osaudio` table. */
export class AudioCache<T> {
  private bytes = 0;
  private readonly bytesOf: (value: T) => number;
  private readonly ceilingBytes: number;
  /** Insertion order IS recency: a `get` deletes and re-sets, which moves the key to the end. */
  private readonly entries = new Map<number, { bytes: number; value: T }>();
  private evictions = 0;
  private hits = 0;
  private misses = 0;
  private refused = 0;

  constructor(options: { bytesOf: (value: T) => number; ceilingBytes?: number }) {
    this.bytesOf = options.bytesOf;
    this.ceilingBytes = options.ceilingBytes ?? AUDIO_CACHE_CEILING_BYTES;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  /** The value, and a touch that makes it the most recent. Counts a hit or a miss either way. */
  get(key: number): T | undefined {
    const found = this.entries.get(key);
    if (!found) {
      this.misses += 1;

      return undefined;
    }
    this.hits += 1;
    this.entries.delete(key);
    this.entries.set(key, found);

    return found.value;
  }

  /** Whether the key is resident. Does NOT count as a hit and does NOT touch recency. */
  has(key: number): boolean {
    return this.entries.has(key);
  }

  report(): AudioCacheReport {
    return {
      bytes: this.bytes,
      ceilingBytes: this.ceilingBytes,
      entries: this.entries.size,
      evictions: this.evictions,
      hits: this.hits,
      misses: this.misses,
      refused: this.refused,
    };
  }

  /**
   * Keep a value, evicting the least recently used until it fits.
   *
   * **An entry larger than the whole ceiling is REFUSED and counted**, not stored: keeping it would empty
   * the cache for one sound, and a cache that evicts everything to hold a single entry is worse than a
   * cache miss. The caller still has the value it just fetched — refusing to keep it is not refusing to
   * play it.
   */
  set(key: number, value: T): void {
    const bytes = this.bytesOf(value);
    if (bytes > this.ceilingBytes) {
      this.refused += 1;

      return;
    }
    const existing = this.entries.get(key);
    if (existing) {
      this.bytes -= existing.bytes;
      this.entries.delete(key);
    }
    while (this.bytes + bytes > this.ceilingBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      const dropped = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      this.bytes -= dropped?.bytes ?? 0;
      this.evictions += 1;
    }
    this.entries.set(key, { bytes, value });
    this.bytes += bytes;
  }
}
