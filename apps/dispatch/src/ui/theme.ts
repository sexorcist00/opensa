/**
 * The console's skins, and the rule about what a skin is allowed to be.
 *
 * Asked for 2026-08-26 ("разные стили как у SonoranCAD"). SonoranCAD ships four operator-selectable themes
 * over one fixed screen, and it is the right idea executed in the expensive way: four hand-written skins,
 * one of which (`trevor`) fills a whole row with the status colour and drops its text contrast through the
 * floor. Four skins is four times the surface on which that can happen, and nothing there checks it.
 *
 * So a theme here is **data, not a fork**, and three things follow.
 *
 * **1. A theme is the INPUT to `styles.ts`, never a copy of it.** It carries the neutral ramp, the accent,
 * the two semantic surfaces, the shadows and a font stack — nothing else. Every one of them is emitted as a
 * CSS custom property, so switching a skin is one attribute on the app root: **no re-render, no restyle
 * pass through React**, which is the whole reason the colours left the TypeScript objects.
 *
 * **2. What a theme may NOT touch.** Target sizes (`TOUCH_TARGET` is not a taste), the layout, the dock,
 * and — the important one — **`map/beacons.ts` → `SET_COLORS`**. Those are the colours the engine draws
 * pillars with, and the lists, the radar, the labels and the header tallies all read the same table so a
 * chip cannot drift from the pin. A theme that repainted statuses would break exactly the agreement that
 * table exists to keep. (A colour-vision-safe status palette is a real and wanted thing, and it is NOT a
 * theme for this reason — see the note at the bottom of this file.)
 *
 * **3. A theme cannot ship with broken contrast.** `theme.test.ts` runs every preset through APCA and fails
 * the build below the thresholds `DESIGN.md` already declares — Lc 90 for primary text, Lc 60 for
 * secondary. That is what makes five skins cost less risk than SonoranCAD's four.
 */
import type { JsonStorage } from '../map/storage';

import { readJson, STORAGE_KEYS, writeJson } from '../map/storage';

export interface ConsoleTheme {
  readonly accent: ThemeAccent;
  /** The font stacks. A skin that changes the typeface changes its character more than any colour does. */
  readonly font: { readonly mono: string; readonly sans: string };
  readonly id: ThemeId;
  /**
   * Tells the browser which way round to render the parts we do not draw — scrollbar gutters, form control
   * internals, the range track. Getting this wrong paints light chrome onto a dark surface.
   */
  readonly mode: 'dark' | 'light';
  readonly name: string;
  readonly ramp: ThemeRamp;
  /** Row padding. The one density lever a theme gets; target sizes are not negotiable and stay in `styles.ts`. */
  readonly rowPadding: string;
  readonly semantic: ThemeSemantic;
  readonly shadow: { readonly float: string; readonly modal: string };
  /** What floats over the map: step 3 at 92 %, and the modal at 97 %. */
  readonly translucent: { readonly float: string; readonly modal: string };
}

/** The accent, which means one thing: the operator's own mark — selection, focus, live, the primary action. */
export interface ThemeAccent {
  readonly bg: string;
  readonly border: string;
  readonly solid: string;
  readonly text: string;
}

export type ThemeId = 'amber' | 'contrast' | 'day' | 'night';

/**
 * The neutral ramp, by Radix's step roles — the same ten values `styles.ts` documents, now per theme.
 * Names are the roles, not the numbers, because a theme author needs to know what a step is FOR.
 */
export interface ThemeRamp {
  /** 1 — the world, and what the map draws onto. */
  readonly bg: string;
  /** 6 — separators inside one surface. */
  readonly line: string;
  /** 7 — the edge of an interactive component. */
  readonly lineStrong: string;
  /** 8 — strong border, and the focus ring. */
  readonly ring: string;
  /** 2 — docked surfaces: the panels and the three bars. */
  readonly surface: string;
  /** 4 — hover. */
  readonly surfaceHover: string;
  /** 5 — active or selected. */
  readonly surfaceOn: string;
  /** 3 — components: rows, inputs, and everything floating over the map. */
  readonly surfaceRaised: string;
  /** 12 — primary text. */
  readonly text: string;
  /** 11 — secondary text. */
  readonly textMuted: string;
}

/** The two surfaces that are neither neutral nor accent: a warning we are standing in, and a danger. */
export interface ThemeSemantic {
  readonly danger: string;
  readonly dangerBg: string;
  readonly dangerText: string;
  readonly warnBg: string;
  readonly warnBorder: string;
  readonly warnSolid: string;
  readonly warnText: string;
}

const SANS = 'ui-sans-serif, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * **Night** — the shift theme, and the default. Cool slate at hue ~213, built dark-first.
 *
 * This is the palette the console shipped with and the one every other preset is measured against; it is
 * first in the list because a dispatcher who never opens the switcher must get the best one.
 */
const NIGHT: ConsoleTheme = {
  accent: { bg: '#0c2634', border: '#1d5b7d', solid: '#38bdf8', text: '#6fd0fb' },
  font: { mono: MONO, sans: SANS },
  id: 'night',
  mode: 'dark',
  name: 'Night',
  ramp: {
    bg: '#070a0f',
    line: '#222f40',
    lineStrong: '#2b3a4d',
    ring: '#3a4d64',
    surface: '#0b111a',
    surfaceHover: '#16202e',
    surfaceOn: '#1b2736',
    surfaceRaised: '#111a26',
    text: '#e8eff7',
    textMuted: '#a8bbd0',
  },
  rowPadding: '8px 12px',
  semantic: {
    danger: '#ff92a6',
    dangerBg: '#4a1220',
    dangerText: '#ffb3c0',
    warnBg: 'rgba(92, 56, 6, 0.94)',
    warnBorder: '#a9701f',
    warnSolid: '#ffb454',
    warnText: '#ffe8c4',
  },
  shadow: { float: '0 4px 16px rgba(0, 0, 0, 0.45)', modal: '0 12px 40px rgba(0, 0, 0, 0.6)' },
  translucent: { float: 'rgba(17, 26, 38, 0.92)', modal: 'rgba(17, 26, 38, 0.97)' },
};

/**
 * **Day** — a phone outdoors, which is the one condition a dark console genuinely cannot serve.
 *
 * Not an inversion of Night. Inverting a dark ramp breaks the depth rule this console took from IBM Carbon
 * — in the dark each added layer is one step LIGHTER, and in the light it is one step DARKER — so the light
 * ramp is built in its own direction and the layering still reads.
 */
const DAY: ConsoleTheme = {
  accent: { bg: '#dbedf6', border: '#7fb6cf', solid: '#0b6f95', text: '#07536f' },
  font: { mono: MONO, sans: SANS },
  id: 'day',
  mode: 'light',
  name: 'Day',
  ramp: {
    bg: '#f2f5f9',
    line: '#ccd7e3',
    lineStrong: '#b4c2d2',
    ring: '#7f95ad',
    surface: '#ffffff',
    surfaceHover: '#e6ecf4',
    surfaceOn: '#dee7f1',
    surfaceRaised: '#f7f9fc',
    text: '#0d1620',
    textMuted: '#46586b',
  },
  rowPadding: '8px 12px',
  semantic: {
    danger: '#c31d38',
    dangerBg: '#ffe1e5',
    dangerText: '#7e0f22',
    warnBg: 'rgba(255, 243, 212, 0.96)',
    warnBorder: '#c2942c',
    warnSolid: '#8a5900',
    warnText: '#523500',
  },
  shadow: { float: '0 4px 16px rgba(15, 23, 32, 0.16)', modal: '0 12px 40px rgba(15, 23, 32, 0.26)' },
  translucent: { float: 'rgba(255, 255, 255, 0.94)', modal: 'rgba(255, 255, 255, 0.98)' },
};

/**
 * **Contrast** — a bad screen, bright sun, or eyes that have worked a long shift.
 *
 * Pure black ground and pure white text, and the mid steps pushed apart so a border is visible rather than
 * implied. This is the preset that exists because a console is used for eight hours, not looked at.
 */
const CONTRAST: ConsoleTheme = {
  accent: { bg: '#06304a', border: '#4aa8d4', solid: '#6cd6ff', text: '#b3eaff' },
  font: { mono: MONO, sans: SANS },
  id: 'contrast',
  mode: 'dark',
  name: 'Contrast',
  ramp: {
    bg: '#000000',
    line: '#3d4a5a',
    lineStrong: '#59697c',
    ring: '#96abc2',
    surface: '#0a0d12',
    surfaceHover: '#1c232d',
    surfaceOn: '#28323f',
    surfaceRaised: '#12171f',
    text: '#ffffff',
    textMuted: '#c8d6e4',
  },
  rowPadding: '8px 12px',
  semantic: {
    danger: '#ff9dac',
    dangerBg: '#5e0f1e',
    dangerText: '#ffd6dd',
    warnBg: 'rgba(122, 76, 8, 0.97)',
    warnBorder: '#dda23a',
    warnSolid: '#ffcb72',
    warnText: '#fff2da',
  },
  shadow: { float: '0 4px 16px rgba(0, 0, 0, 0.7)', modal: '0 12px 40px rgba(0, 0, 0, 0.85)' },
  translucent: { float: 'rgba(10, 13, 18, 0.96)', modal: 'rgba(10, 13, 18, 0.99)' },
};

/**
 * **Amber** — the identity slot, and the tightest of the four.
 *
 * SonoranCAD's four skins exist because its customer is a server owner who wants the console to be *theirs*;
 * that is a real want and this is where it is served. Warm near-black with a monospace chrome and a row
 * padding two pixels tighter — the same lever SonoranCAD's `mike19` pulls, and the reason that one reads as
 * a working instrument rather than a product.
 */
const AMBER: ConsoleTheme = {
  accent: { bg: '#3a2708', border: '#9a7526', solid: '#ffc247', text: '#ffd98a' },
  font: { mono: MONO, sans: MONO },
  id: 'amber',
  mode: 'dark',
  name: 'Amber',
  ramp: {
    bg: '#0a0806',
    line: '#3a2e1d',
    lineStrong: '#4d3d26',
    ring: '#6d5836',
    surface: '#130f0a',
    surfaceHover: '#241c12',
    surfaceOn: '#2f2517',
    surfaceRaised: '#1b150d',
    text: '#f8eed6',
    textMuted: '#cbb894',
  },
  rowPadding: '6px 10px',
  semantic: {
    danger: '#ffa19c',
    dangerBg: '#4d1414',
    dangerText: '#ffc7c2',
    warnBg: 'rgba(104, 45, 6, 0.95)',
    warnBorder: '#c96a22',
    warnSolid: '#ff8a3c',
    warnText: '#ffdfc6',
  },
  shadow: { float: '0 4px 16px rgba(0, 0, 0, 0.55)', modal: '0 12px 40px rgba(0, 0, 0, 0.7)' },
  translucent: { float: 'rgba(27, 21, 13, 0.93)', modal: 'rgba(27, 21, 13, 0.97)' },
};

/** Every skin, in the order the switcher offers them. Night first: the default must be the first choice. */
export const THEMES: readonly ConsoleTheme[] = [NIGHT, DAY, CONTRAST, AMBER];

export const DEFAULT_THEME: ThemeId = 'night';

/** The skin the operator last chose, or the default for anything unreadable or no longer shipped. */
export function loadTheme(storage?: JsonStorage): ThemeId {
  const stored = readJson(STORAGE_KEYS.theme, storage);

  return THEMES.some((theme) => theme.id === stored) ? (stored as ThemeId) : DEFAULT_THEME;
}

export function saveTheme(id: ThemeId, storage?: JsonStorage): void {
  writeJson(STORAGE_KEYS.theme, id, storage);
}

/**
 * The CSS custom properties one theme defines, as a declaration block.
 *
 * Emitted once per theme into the console's single stylesheet (`global-css.ts`), each block scoped to
 * `[data-theme="…"]`. Switching is then an attribute write — the browser repaints and React is not involved
 * at all, which is the point of putting colour here instead of in the style objects.
 */
export function themeVariables(theme: ConsoleTheme): string {
  const entries: readonly (readonly [string, string])[] = [
    ['color-scheme', theme.mode],
    ['--os-bg', theme.ramp.bg],
    ['--os-line', theme.ramp.line],
    ['--os-line-strong', theme.ramp.lineStrong],
    ['--os-ring', theme.ramp.ring],
    ['--os-surface', theme.ramp.surface],
    ['--os-surface-hover', theme.ramp.surfaceHover],
    ['--os-surface-on', theme.ramp.surfaceOn],
    ['--os-surface-raised', theme.ramp.surfaceRaised],
    ['--os-text', theme.ramp.text],
    ['--os-text-muted', theme.ramp.textMuted],
    ['--os-accent-bg', theme.accent.bg],
    ['--os-accent-border', theme.accent.border],
    ['--os-accent-solid', theme.accent.solid],
    ['--os-accent-text', theme.accent.text],
    ['--os-danger', theme.semantic.danger],
    ['--os-danger-bg', theme.semantic.dangerBg],
    ['--os-danger-text', theme.semantic.dangerText],
    ['--os-warn-bg', theme.semantic.warnBg],
    ['--os-warn-border', theme.semantic.warnBorder],
    ['--os-warn-solid', theme.semantic.warnSolid],
    ['--os-warn-text', theme.semantic.warnText],
    ['--os-float-bg', theme.translucent.float],
    ['--os-modal-bg', theme.translucent.modal],
    ['--os-shadow-float', theme.shadow.float],
    ['--os-shadow-modal', theme.shadow.modal],
    ['--os-font-sans', theme.font.sans],
    ['--os-font-mono', theme.font.mono],
    ['--os-row-padding', theme.rowPadding],
  ];

  return entries.map(([name, value]) => `  ${name}: ${value};`).join('\n');
}

/*
 * NOT A THEME, and deliberately: a colour-vision-safe STATUS palette.
 *
 * Unit and call colours are red / amber / green, the worst possible triple for deuteranopia (~8 % of men).
 * A safe palette is wanted and it cannot live here, because those colours are `map/beacons.ts` →
 * `SET_COLORS`: the engine builds a debug-line set per key at boot and draws the pillars from it, so
 * repainting a status means rebuilding those sets rather than writing a CSS variable. It needs an engine
 * hook, it belongs with the symbology (201/5), and it has to swap the whole table at once so the map and
 * the lists move together. Filed rather than half-done.
 */
