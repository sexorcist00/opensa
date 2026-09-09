import { describe, expect, it } from 'vitest';

import { AUDIO_CACHE_CEILING_BYTES, AudioCache } from './audio-cache';

/** A cache of plain byte counts, so a test can state a size without building a buffer. */
function cache(ceilingBytes: number): AudioCache<number> {
  return new AudioCache<number>({ bytesOf: (value) => value, ceilingBytes });
}

describe('AudioCache', () => {
  describe('negative cases', () => {
    it('REFUSES an entry bigger than the whole ceiling instead of emptying itself for it', () => {
      const store = cache(100);
      store.set(1, 40);

      store.set(2, 200);

      expect(store.has(2)).toBe(false);
      expect(store.has(1)).toBe(true);
      expect(store.report()).toMatchObject({ bytes: 40, entries: 1, evictions: 0, refused: 1 });
    });

    it('counts a miss for a key it does not have, and does not invent one', () => {
      const store = cache(100);

      expect(store.get(7)).toBeUndefined();
      expect(store.report()).toMatchObject({ hits: 0, misses: 1 });
    });

    it('never exceeds its ceiling, whatever order it is filled in', () => {
      const store = cache(100);

      for (let key = 0; key < 50; key += 1) {
        store.set(key, 30);
        expect(store.report().bytes).toBeLessThanOrEqual(100);
      }

      expect(store.report().entries).toBe(3);
    });
  });

  describe('positive cases', () => {
    it('evicts the least recently USED, not the least recently added', () => {
      // The case insertion order gets wrong: an ambience bed fetched once and touched for an hour, against
      // a gunshot touched once.
      const store = cache(100);
      store.set(1, 40);
      store.set(2, 40);
      store.get(1);

      store.set(3, 40);

      expect(store.has(1)).toBe(true);
      expect(store.has(2)).toBe(false);
      expect(store.has(3)).toBe(true);
    });

    it('replaces a key without double-counting its bytes', () => {
      const store = cache(100);
      store.set(1, 40);

      store.set(1, 60);

      expect(store.report()).toMatchObject({ bytes: 60, entries: 1, evictions: 0 });
    });

    it('counts hits and misses, and `has` does neither', () => {
      const store = cache(100);
      store.set(1, 10);

      store.get(1);
      store.get(2);
      store.has(1);

      expect(store.report()).toMatchObject({ hits: 1, misses: 1 });
    });

    it('states the ceiling it was built with, so a report and a budget cannot disagree', () => {
      expect(new AudioCache<number>({ bytesOf: () => 1 }).report().ceilingBytes).toBe(AUDIO_CACHE_CEILING_BYTES);
      expect(AUDIO_CACHE_CEILING_BYTES).toBe(64 * 1024 * 1024);
    });

    it('holds whatever the caller says an entry is — PCM now, float buffers in chain 3', () => {
      const store = new AudioCache<Int16Array>({ bytesOf: (value) => value.byteLength, ceilingBytes: 1_000 });

      store.set(1, new Int16Array(200));
      store.set(2, new Int16Array(200));

      expect(store.report()).toMatchObject({ bytes: 800, entries: 2 });
    });

    it('clears to empty', () => {
      const store = cache(100);
      store.set(1, 40);

      store.clear();

      expect(store.report()).toMatchObject({ bytes: 0, entries: 0 });
    });
  });
});
