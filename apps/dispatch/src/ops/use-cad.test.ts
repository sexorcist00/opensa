import { describe, expect, it } from 'vitest';

import { expired, FLOORED_HOLD_MS, HOLD_MS } from './use-cad';

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
