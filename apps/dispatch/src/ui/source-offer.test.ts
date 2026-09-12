/**
 * The AGPL §13 offer, as a test.
 *
 * The failure this guards against is silent in the worst way: the link still renders, still resolves, and
 * still looks like compliance — while pointing at a DIFFERENT project's source. This console is a modified
 * fork, so upstream's repository is not its Corresponding Source, and a copy-paste from upstream's own
 * surface would be wrong in a way nobody reviewing the UI would see.
 */
import { describe, expect, it } from 'vitest';

import { SOURCE_URL } from './source-offer';
import { styles, TOUCH_TARGET } from './styles';

describe('the source offer', () => {
  describe('negative cases', () => {
    it('does not point at the upstream project, whose source is not this console', () => {
      expect(SOURCE_URL).not.toMatch(/AlexSergey/iu);
    });

    it('is not a target under the criterion where the pointer is coarse', () => {
      expect(styles.sourceLinkTouch.minHeight).toBeGreaterThanOrEqual(TOUCH_TARGET);
      expect(styles.sourceLinkTouch.minWidth).toBeGreaterThanOrEqual(TOUCH_TARGET);
    });
  });

  describe('positive cases', () => {
    it('points at this fork, over https', () => {
      expect(SOURCE_URL).toBe('https://github.com/sexorcist00/opensa');
    });
  });
});
