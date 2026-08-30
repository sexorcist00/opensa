/**
 * **A skin cannot ship with unreadable text.**
 *
 * This is the guard that makes four themes cheaper than SonoranCAD's four. Theirs are hand-written and
 * unchecked, and it shows: the `trevor` skin fills a whole row with the status colour and lands grey text
 * on a mid-blue fill, so the row that matters most is the one that stops being readable. Nothing on their
 * side catches that, because contrast failure is silent by nature — it renders, it lints, it screenshots
 * fine on the monitor of whoever wrote it.
 *
 * The measure is **APCA** (Lc), not WCAG 2's ratio, for the reason `DESIGN.md` already gives: WCAG 2.x is
 * symmetric and APCA is not, and a dark console is the polarity WCAG 2 gets wrong — it passes light-on-dark
 * pairs that are genuinely hard to read and fails pairs that are fine. The thresholds are the ones DESIGN.md
 * declares: **Lc 90 for primary text, Lc 60 for secondary**.
 *
 * The implementation below is the published APCA 0.1.9 formula with its constants named, so the numbers can
 * be checked against the reference tool rather than trusted.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { ConsoleTheme } from './theme';

import { styles, TOUCH_TARGET } from './styles';
import { DEFAULT_THEME, loadTheme, resolveDensity, saveTheme, THEMES, themeVariables } from './theme';

/** Lc for primary text (ramp step 12) on any surface it is set on. */
const LC_PRIMARY = 90;
/** Lc for secondary text (ramp step 11), and for the semantic text colours on their own fills. */
const LC_SECONDARY = 60;

// APCA 0.1.9 constants, named as the spec names them.
const TRC = 2.4;
const R_CO = 0.2126729;
const G_CO = 0.7151522;
const B_CO = 0.072175;
const NORM_BG = 0.56;
const NORM_TXT = 0.57;
const REV_TXT = 0.62;
const REV_BG = 0.65;
const BLK_THRS = 0.022;
const BLK_CLMP = 1.414;
const LO_CLIP = 0.1;
const DELTA_Y_MIN = 0.0005;
const SCALE = 1.14;
const LO_OFFSET = 0.027;

/** APCA lightness contrast, signed as the spec signs it; the tests compare its magnitude. */
function apca(text: string, background: string): number {
  const clamp = (y: number): number => (y > BLK_THRS ? y : y + (BLK_THRS - y) ** BLK_CLMP);
  const txtY = clamp(luminance(text));
  const bgY = clamp(luminance(background));
  if (Math.abs(bgY - txtY) < DELTA_Y_MIN) {
    return 0;
  }
  if (bgY > txtY) {
    const sapc = (bgY ** NORM_BG - txtY ** NORM_TXT) * SCALE;

    return (sapc < LO_CLIP ? 0 : sapc - LO_OFFSET) * 100;
  }
  const sapc = (bgY ** REV_BG - txtY ** REV_TXT) * SCALE;

  return (sapc > -LO_CLIP ? 0 : sapc + LO_OFFSET) * 100;
}

/** Every component file beside this test, as `[name, source]` — what the two raw-value guards read. */
function components(): readonly (readonly [string, string])[] {
  const here = dirname(fileURLToPath(import.meta.url));

  return readdirSync(here)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => [name, readFileSync(join(here, name), 'utf8')] as const);
}

/** Screen luminance of a `#rrggbb`. Alpha is not accepted: a translucent colour has no luminance of its own. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (at: number): number => Number.parseInt(value.slice(at, at + 2), 16) / 255;

  return R_CO * channel(0) ** TRC + G_CO * channel(2) ** TRC + B_CO * channel(4) ** TRC;
}

/** Every text-on-surface pair a theme actually renders, named so a failure says which one broke. */
function pairs(
  theme: ConsoleTheme,
): readonly { readonly least: number; readonly on: string; readonly text: string; readonly what: string }[] {
  const { accent, ramp, semantic } = theme;
  const surfaces: readonly (readonly [string, string])[] = [
    ['bg', ramp.bg],
    ['surface', ramp.surface],
    ['surfaceRaised', ramp.surfaceRaised],
    ['surfaceHover', ramp.surfaceHover],
    ['surfaceOn', ramp.surfaceOn],
  ];

  return [
    ...surfaces.map(([name, on]) => ({ least: LC_PRIMARY, on, text: ramp.text, what: `text on ${name}` })),
    ...surfaces.map(([name, on]) => ({ least: LC_SECONDARY, on, text: ramp.textMuted, what: `textMuted on ${name}` })),
    { least: LC_SECONDARY, on: accent.bg, text: accent.text, what: 'accent text on accent bg' },
    { least: LC_SECONDARY, on: ramp.surface, text: accent.solid, what: 'accent solid on surface' },
    { least: LC_SECONDARY, on: semantic.dangerBg, text: semantic.dangerText, what: 'danger text on danger bg' },
    { least: LC_SECONDARY, on: ramp.surface, text: semantic.danger, what: 'danger on surface' },
  ];
}

describe('theme', () => {
  describe('negative cases', () => {
    it.each(THEMES.map((theme) => [theme.name, theme] as const))(
      'lets no text in %s fall under its APCA threshold',
      (_name, theme) => {
        const failures = pairs(theme)
          .map((pair) => ({ ...pair, lc: Math.round(Math.abs(apca(pair.text, pair.on))) }))
          .filter((pair) => pair.lc < pair.least)
          .map((pair) => `${pair.what}: Lc ${pair.lc}, wanted ${pair.least}`);

        expect(failures).toEqual([]);
      },
    );

    it('lets no two skins share an id', () => {
      expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
    });

    it('lets no skin define fewer variables than the others', () => {
      // A theme missing one variable does not fail loudly — it inherits whatever the previous theme left on
      // the root, so a skin looks right until the ONE component that used the missing token is on screen.
      const names = THEMES.map((theme) => themeVariables(theme).match(/--os-[a-z-]+/gu) ?? []);
      for (const set of names) {
        expect(set).toEqual(names[0]);
      }
    });

    it('lets no component paint a colour the theme cannot reach', () => {
      // Twice in one change: `#0e3a52` on the region badge and `#7d8ea1` on a hint line. Both render, both
      // lint, and both stay dark-blue-on-white the moment the Day skin is chosen — a raw hex in a component
      // is a colour that has opted out of the theme. `styles.test.ts` cannot see these because it reads the
      // token table; this reads the components themselves.
      const strays: string[] = [];
      for (const [file, source] of components()) {
        for (const hex of source.match(/'#[0-9a-f]{3,8}'/giu) ?? []) {
          strays.push(`${file}: ${hex}`);
        }
      }

      expect(strays).toEqual([]);
    });

    it('lets no component write its own radius or its own shadow', () => {
      // The same rule as the hex above, for the layer 201/7-10 added to the contract. A radius or a shadow
      // written into a component has opted out of `shape` exactly as a hex opts out of the ramp: it renders,
      // it lints, and it stays rounded-and-lifted under a preset whose whole depth strategy is a hairline.
      // The one deliberate exception is a symbology MARK rather than a surface, and it lives in the token
      // table (`styles.tallyDot`) where this guard can see it.
      const strays: string[] = [];
      for (const [file, source] of components()) {
        for (const written of source.match(/\b(?:borderRadius|boxShadow):\s*[^,\n]+/gu) ?? []) {
          strays.push(`${file}: ${written.trim()}`);
        }
      }

      expect(strays).toEqual([]);
    });

    it('lets no preset carry a desk density onto a phone', () => {
      // The [cross-platform-surface](../../../../docs/restrictions/cross-platform-surface.md) half of
      // 201/7-10, and the reason the clamp lives in `resolveDensity` rather than in a review. A skin is
      // chosen on a desk and travels to the same operator's phone through one `localStorage` key with
      // nothing on that path re-asking the question.
      //
      // BOTH halves are asserted, and the second is the one that can actually fail. The phone's row carries
      // `minHeight: TOUCH_TARGET` and its own padding, so the 44-px criterion is true by construction
      // whatever a preset asks for — the plan's original phrasing would have passed on every possible
      // input. What genuinely travels is the TYPE, inside a row that stays 44 px tall while its text
      // shrinks to 10 px, which is invisible to every other guard here.
      const floor = resolveDensity('compact', true);
      const under = THEMES.filter((theme) => {
        const steps = resolveDensity(theme.density, true);

        return steps.body < floor.body || steps.caption < floor.caption;
      }).map((theme) => theme.name);

      expect(under).toEqual([]);
      expect(styles.rowTouch.minHeight).toBe(TOUCH_TARGET);
    });

    it('falls back to the default for a stored id that is not shipped any more', () => {
      expect(loadTheme({ getItem: () => '"chartreuse"', setItem: () => undefined })).toBe(DEFAULT_THEME);
      expect(loadTheme({ getItem: () => 'not json', setItem: () => undefined })).toBe(DEFAULT_THEME);
      expect(loadTheme(undefined)).toBe(DEFAULT_THEME);
    });
  });

  describe('positive cases', () => {
    it('ships the default first, so an operator who never opens the switcher gets it', () => {
      expect(THEMES[0]?.id).toBe(DEFAULT_THEME);
    });

    it('declares a colour scheme that matches the ground it paints', () => {
      for (const theme of THEMES) {
        // Light ground, light scheme — otherwise the browser paints dark scrollbars and form internals onto it.
        expect(theme.mode).toBe(luminance(theme.ramp.bg) > 0.35 ? 'light' : 'dark');
      }
    });

    it('moves only the row padding and the two row type steps', () => {
      // Density is a bounded lever, not a scale factor over the type table: `input` at 15 px is the floor
      // below which iOS zooms the page on focus, and the title is not a row. A step that reached either
      // would be a phone defect written as a preference.
      const moved = new Set<string>();
      for (const density of ['comfortable', 'compact', 'dense'] as const) {
        for (const [name, value] of Object.entries(resolveDensity(density, false))) {
          moved.add(`${name}:${String(value)}`);
        }
      }

      expect([...new Set([...moved].map((entry) => entry.split(':')[0]))].sort()).toEqual([
        'body',
        'caption',
        'rowPadding',
      ]);
    });

    it('remembers the chosen skin', () => {
      const store = new Map<string, string>();
      const storage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      };
      saveTheme('amber', storage);

      expect(loadTheme(storage)).toBe('amber');
    });
  });
});
