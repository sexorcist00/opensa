import { describe, expect, it } from 'vitest';

import { VisibilityWatch } from './capture-visibility';

/** A document whose visibility moves on command, and a clock that only moves when a test says so. */
function fakeDocument(initial: DocumentVisibilityState): EventTarget & { visibilityState: DocumentVisibilityState } {
  const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
  target.visibilityState = initial;

  return target;
}

/** Move the page to `state` and fire the event the watch listens for. */
function go(
  document: { dispatchEvent: (event: Event) => boolean; visibilityState: DocumentVisibilityState },
  state: DocumentVisibilityState,
): void {
  document.visibilityState = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('VisibilityWatch', () => {
  describe('negative cases', () => {
    it('counts a window that opened on a page already in the background', () => {
      // A capture link raised behind another app: starting from `visible` would credit that time to a page
      // nobody was looking at.
      const document = fakeDocument('hidden');
      let now = 0;
      const watch = new VisibilityWatch(document, () => now);
      now = 5_000;

      expect(watch.report()).toEqual({ hiddenMs: 5_000, hiddenSpells: 1, visibleAtReport: false });
    });

    it('counts the spell that is still running when the report is taken', () => {
      const document = fakeDocument('visible');
      let now = 0;
      const watch = new VisibilityWatch(document, () => now);
      now = 1_000;
      go(document, 'hidden');
      now = 9_000;

      expect(watch.report()).toEqual({ hiddenMs: 8_000, hiddenSpells: 1, visibleAtReport: false });
    });

    it('tells one long suspend from six quick switches — different accidents, same total', () => {
      const document = fakeDocument('visible');
      let now = 0;
      const watch = new VisibilityWatch(document, () => now);
      for (const at of [1_000, 3_000, 5_000]) {
        now = at;
        go(document, 'hidden');
        now = at + 500;
        go(document, 'visible');
      }

      expect(watch.report()).toEqual({ hiddenMs: 1_500, hiddenSpells: 3, visibleAtReport: true });
    });

    it('does not count a repeated hidden event twice', () => {
      const document = fakeDocument('visible');
      let now = 0;
      const watch = new VisibilityWatch(document, () => now);
      now = 1_000;
      go(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      now = 3_000;
      go(document, 'visible');

      expect(watch.report()).toEqual({ hiddenMs: 2_000, hiddenSpells: 1, visibleAtReport: true });
    });
  });

  describe('positive cases', () => {
    it('reports a clean window as one nobody backgrounded', () => {
      const document = fakeDocument('visible');
      let now = 0;
      const watch = new VisibilityWatch(document, () => now);
      now = 60_000;

      expect(watch.report()).toEqual({ hiddenMs: 0, hiddenSpells: 0, visibleAtReport: true });
    });
  });
});
