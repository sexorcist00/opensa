/**
 * The two geometry rules of this style table, as a test.
 *
 * [cross-platform-surface.md](../../../../docs/restrictions/cross-platform-surface.md) closes by saying
 * nothing here is caught by a test, a lint rule or a build guard — and that *a lint rule over inline style
 * objects would catch the target size, since the sizes are literals in `styles.ts`, and nothing prevents
 * writing one when this bites a second time*. It bit a second time on 2026-08-25: the compass came out
 * 42x42 and every short label — `Fit`, `×1` — came out under 44 WIDE while passing the height, because a
 * `Touch` token carried `minHeight` and no `minWidth`.
 *
 * The grid half is the same class of silent failure and cost more: a bare `1fr` track keeps
 * `min-width: auto`, so the widest row in a column widens the whole grid. At 360 CSS px that made the map
 * 403 px wide inside a 360-px screen and put the entire right-hand column of the turn/tilt/zoom cluster off
 * the edge, unreachable, with nothing clipped visibly and nothing to scroll.
 */
import type { CSSProperties } from 'react';

import { describe, expect, it } from 'vitest';

import { ACCENT, COLORS, RADIUS, RAMP, SEMANTIC, SPACE, styles, TEXT, TOUCH_TARGET } from './styles';

/** Every token whose name says it is the finger-sized variant of another. */
const TOUCH_TOKENS = Object.entries(styles).filter(([name]) => name.endsWith('Touch'));

/** The tokens that place a control over the map with its own touch size baked in. */
const TOUCH_SIZED = ['mapNavCompassTouch', 'mapToolsHandle'] as const;

function size(style: CSSProperties, axis: 'height' | 'width'): number | undefined {
  const fixed = style[axis];
  const min = style[axis === 'height' ? 'minHeight' : 'minWidth'];

  return typeof fixed === 'number' ? fixed : typeof min === 'number' ? min : undefined;
}

describe('dispatch styles', () => {
  describe('negative cases', () => {
    it('has no flexible grid track that can be widened by its own content', () => {
      // A bare `1fr` is the bug: it cannot shrink below the max-content of the widest row in that column.
      // The same `fr` inside a `minmax(0, …)` is the fix, so the bounded ones are taken out before looking.
      for (const layout of ['app', 'appCompact'] as const) {
        for (const axis of ['gridTemplateColumns', 'gridTemplateRows'] as const) {
          const bare = String(styles[layout][axis]).replace(/minmax\([^)]*\)/gu, 'bounded');

          expect(bare).not.toMatch(/fr\b/u);
        }
      }
    });

    it('lets no touch token be under the criterion in EITHER axis', () => {
      const under = TOUCH_TOKENS.filter(([, style]) => {
        const width = size(style, 'width');
        const height = size(style, 'height');

        return (width !== undefined && width < TOUCH_TARGET) || (height !== undefined && height < TOUCH_TARGET);
      }).map(([name]) => name);

      expect(under).toEqual([]);
    });

    it('lets no style in the table carry a colour the token groups do not name', () => {
      // The table used to hold ad-hoc hex — `#0e3a52` for four different "selected" fills, `#4a1220` for
      // one badge — so a component reached for whatever looked close and the surfaces drifted apart. Every
      // colour now comes from RAMP, ACCENT or SEMANTIC, and a unit's or a call's colour comes from the map's
      // own table (`SET_COLORS`) rather than from here at all.
      const named = new Set<string>([
        ...Object.values(RAMP),
        ...Object.values(ACCENT),
        ...Object.values(SEMANTIC),
        ...Object.values(COLORS),
      ]);
      const strays = new Set<string>();
      for (const style of Object.values(styles)) {
        for (const value of Object.values(style)) {
          for (const hex of String(value).match(/#[0-9a-f]{3,8}/giu) ?? []) {
            if (!named.has(hex)) {
              strays.add(hex);
            }
          }
        }
      }

      expect([...strays]).toEqual([]);
    });

    it('lets no bar that spans the grid push its column wider than the screen', () => {
      // These three are full-width flex rows. Bounded tracks only help if the row itself gives way.
      for (const bar of ['statusBar', 'timeline', 'topBar', 'topBarCompact'] as const) {
        expect(styles[bar].minWidth).toBe(0);
        expect(styles[bar].overflow).toBe('hidden');
      }
    });
  });

  describe('positive cases', () => {
    it('gives every touch variant of a button a target in both axes', () => {
      for (const name of ['buttonPrimaryTouch', 'buttonTouch'] as const) {
        expect(styles[name].minHeight).toBe(TOUCH_TARGET);
        expect(styles[name].minWidth).toBe(TOUCH_TARGET);
      }
    });

    it('sizes the map controls that carry their own touch size', () => {
      for (const name of TOUCH_SIZED) {
        expect(size(styles[name], 'width')).toBe(TOUCH_TARGET);
        expect(size(styles[name], 'height')).toBe(TOUCH_TARGET);
      }
    });

    it('makes both sliders a target that can be caught rather than aimed at', () => {
      // The thumb's own size belongs to the browser, but a range input drags from anywhere in its box —
      // so the box is the target, and both of this console's sliders measured 16 px tall.
      expect(styles.rangeTouch.height).toBe(TOUCH_TARGET);
    });

    it('keeps the three scales to their declared steps', () => {
      // A scale with a value between its steps is not a scale. Radius was eight values, spacing thirteen.
      expect(Object.values(RADIUS)).toEqual([2, 2, 0]);
      expect([...Object.values(SPACE)].sort((a, b) => a - b)).toEqual([2, 4, 8, 12, 16, 24]);
      expect([...Object.values(TEXT)].sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 15, 17]);
    });

    it('caps the phone sheet rather than reserving a share of the screen for it', () => {
      // A fixed 44% left ~200 px of black under two calls while the map was starved to 350.
      expect(styles.sheet.maxHeight).toBe('44vh');
      expect(String(styles.appCompact.gridTemplateRows)).toContain('auto');
    });
  });
});
