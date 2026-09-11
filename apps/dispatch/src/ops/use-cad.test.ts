import { describe, expect, it } from 'vitest';

import { expired, FLOORED_HOLD_MS, HOLD_MS, trim } from './use-cad';

function notice(name: string, atMs = 0): { atMs: number; id: number; name: string } {
  return { atMs, id: 1, name };
}

describe('expired', () => {
  describe('negative cases', () => {
    it('keeps a line that has not been up long enough to read past', () => {
      expect(expired(notice('alpr_hit'), HOLD_MS - 1)).toBe(false);
    });

    it('keeps a panic on screen long after an ordinary line would have gone', () => {
      // A `cad` event is not on the board and nothing else on this console remembers it, so an operator who
      // looked away for four seconds during a panic would have missed the only report of it.
      expect(expired(notice('panic_button'), HOLD_MS + 1)).toBe(false);
      expect(expired(notice('link_lost'), HOLD_MS + 1)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('drops an ordinary line once it has been read', () => {
      expect(expired(notice('alpr_hit'), HOLD_MS)).toBe(true);
    });

    it('drops even a panic eventually, rather than leaving it over the map forever', () => {
      expect(expired(notice('panic_button'), FLOORED_HOLD_MS)).toBe(true);
    });
  });
});

describe('trim', () => {
  describe('negative cases', () => {
    it('leaves a stack that fits alone', () => {
      const stack = [notice('alpr_hit'), notice('bolo_new')];

      expect(trim(stack)).toBe(stack);
    });

    it('never drops a panic to make room for a routine chime', () => {
      // Three routine events pushing a panic off the screen after three seconds defeats the whole reason it
      // is held for fifteen: it is the one an operator may have looked away from.
      const panic = { atMs: 0, id: 1, name: 'panic_button' };
      const stack = [panic, { atMs: 1, id: 2, name: 'alpr_hit' }, { atMs: 2, id: 3, name: 'bolo_new' }];

      const kept = trim([...stack, { atMs: 3, id: 4, name: 'notification' }]);

      expect(kept).toContain(panic);
      expect(kept).toHaveLength(3);
    });
  });

  describe('positive cases', () => {
    it('drops the OLDEST ordinary line', () => {
      const stack = [
        { atMs: 0, id: 1, name: 'alpr_hit' },
        { atMs: 1, id: 2, name: 'bolo_new' },
        { atMs: 2, id: 3, name: 'notification' },
        { atMs: 3, id: 4, name: 'simplex_request' },
      ];

      expect(trim(stack).map((entry) => entry.id)).toEqual([2, 3, 4]);
    });

    it('yields a floored line only to another floored line', () => {
      const stack = [
        { atMs: 0, id: 1, name: 'link_lost' },
        { atMs: 1, id: 2, name: 'panic_button' },
        { atMs: 2, id: 3, name: 'link_lost' },
        { atMs: 3, id: 4, name: 'panic_button' },
      ];

      expect(trim(stack).map((entry) => entry.id)).toEqual([2, 3, 4]);
    });
  });
});
