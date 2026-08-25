/**
 * The console's look, as one style table — the pattern the other OpenSA apps use (`viewer-styles.ts`,
 * `debug-styles.ts`). Dark, flat and dense on purpose: an operations surface is read at a glance for eight
 * hours, so contrast goes to the data and nothing else competes with the map.
 */
import type { CSSProperties } from 'react';

/**
 * The smallest a control may be where a FINGER is the pointer, CSS px. Not ours and not a feel: WCAG 2.2's
 * enhanced target-size criterion (2.5.5) is 44×44 CSS px, Apple's HIG says 44 pt and Material says 48 dp —
 * 44 is the number all three agree is enough. Below it a control is not "small", it is one an operator
 * misses while driving a shift ([restrictions/cross-platform-surface.md](../../../../docs/restrictions/cross-platform-surface.md)).
 */
export const TOUCH_TARGET = 44;

export const COLORS = {
  accent: '#38bdf8',
  border: '#1c2735',
  danger: '#f43f5e',
  muted: '#7b8a9c',
  panel: '#0b1017',
  panelRaised: '#111926',
  text: '#e8eef6',
} as const;

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const styles = {
  /**
   * Desk: three columns.
   *
   * **`minmax(0, …)` on every flexible track, never a bare `1fr`.** A `1fr` track keeps `min-width: auto`,
   * so it refuses to shrink below the widest thing in ANY row of that column — one over-wide row then
   * widens the whole grid, and since the map cell is in that column the map is widened with it. Measured
   * 2026-08-25 at 360 CSS px: the top bar's content came to 403 px, the single column became 403, and every
   * control anchored to the map's RIGHT edge — the whole turn/tilt/zoom cluster's right-hand column — sat
   * 43 px past the screen with no way to scroll to it. Nothing clipped visibly and nothing warned.
   */
  app: {
    background: '#05070a',
    color: COLORS.text,
    display: 'grid',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: 12,
    gridTemplateColumns: '300px minmax(0, 1fr) 264px',
    gridTemplateRows: '44px minmax(0, 1fr) 30px 26px',
    height: '100%',
    width: '100%',
  },
  /** Phone: one column — map fills the screen, the lists live in a sheet under it. */
  appCompact: {
    background: '#05070a',
    color: COLORS.text,
    display: 'grid',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: 12,
    gridTemplateColumns: 'minmax(0, 1fr)',
    // 48 rather than 40: the bar carries 44-px targets now, and a 40-px row makes every one of them
    // overflow its own bar. The sheet is `auto` rather than a fixed 44% because a fixed share left ~200 px
    // of black under two calls while the map — the thing the console is for — was starved to 350.
    gridTemplateRows: '48px minmax(0, 1fr) auto 34px 22px',
    height: '100%',
    width: '100%',
  },
  /** `?embed=1`: the map fills the frame the host gave it, and nothing else is drawn. */
  appEmbedded: { background: COLORS.panel, color: COLORS.text, height: '100%', position: 'relative', width: '100%' },
  badge: {
    borderRadius: 3,
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: 0.4,
    padding: '2px 6px',
  },
  button: {
    background: COLORS.panelRaised,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    color: COLORS.text,
    cursor: 'pointer',
    fontSize: 11,
    padding: '4px 9px',
  },
  buttonPrimary: {
    background: '#0e3a52',
    border: `1px solid ${COLORS.accent}`,
    borderRadius: 4,
    color: COLORS.accent,
    cursor: 'pointer',
    fontSize: 11,
    padding: '4px 9px',
  },
  buttonPrimaryTouch: {
    background: '#0e3a52',
    border: `1px solid ${COLORS.accent}`,
    borderRadius: 5,
    color: COLORS.accent,
    cursor: 'pointer',
    fontSize: 13,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    padding: '4px 12px',
  },
  /** `minWidth` as well as `minHeight`: the criterion is 44 in BOTH axes, and a short label — `Fit`, `×1` —
   *  came out 40 and 33 wide while passing the height every reviewer actually checks. */
  buttonTouch: {
    background: COLORS.panelRaised,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 5,
    color: COLORS.text,
    cursor: 'pointer',
    fontSize: 13,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    padding: '4px 12px',
  },
  // `touchAction: none` is load-bearing on a phone: without it the browser claims the drag for scrolling
  // and page-zoom before a single `pointermove` reaches the gesture layer.
  canvas: { display: 'block', height: '100%', touchAction: 'none', width: '100%' },
  canvasWrap: { minHeight: 0, overflow: 'hidden', position: 'relative' },
  degradedBanner: {
    background: 'rgba(120, 72, 8, 0.92)',
    border: '1px solid #d08b2c',
    borderRadius: 5,
    bottom: 10,
    color: '#ffe8c4',
    fontSize: 11,
    maxWidth: 420,
    padding: '5px 10px',
    position: 'absolute',
    // Bottom-RIGHT since 201/7-03: the top-left corner is the operator's cluster (search, fit, follow,
    // saved views), and a banner across the top covered the search box in exactly the mode — plan mode —
    // where an operator needs it most. It is a standing state notice, not an alert that must interrupt.
    right: 10,
    zIndex: 4,
  },
  detail: {
    background: 'rgba(11, 16, 23, 0.94)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    bottom: 14,
    left: 14,
    maxWidth: 380,
    padding: '10px 12px',
    position: 'absolute',
    zIndex: 3,
  },
  detailCompact: {
    background: 'rgba(11, 16, 23, 0.96)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    bottom: 8,
    left: 8,
    padding: '9px 11px',
    position: 'absolute',
    right: 8,
    zIndex: 3,
  },
  empty: { color: COLORS.muted, fontStyle: 'italic', padding: '10px 12px' },
  fill: { height: '100%', left: 0, position: 'absolute', top: 0, width: '100%' },
  inventoryButton: {
    background: COLORS.accent,
    border: 'none',
    borderRadius: 4,
    color: '#05070a',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    marginTop: 2,
    padding: '5px 8px',
  },
  /** Shown only when the clipboard is unavailable — a LAN dev server is not a secure context. */
  inventoryFallback: {
    background: '#05070a',
    border: `1px solid ${COLORS.border}`,
    color: COLORS.muted,
    fontFamily: MONO,
    fontSize: 9,
    height: 90,
    marginTop: 4,
    width: '100%',
  },
  /** 201/1-01. Bottom-left so it never sits under the selection panel, and narrow enough for 360 CSS px. */
  inventoryPanel: {
    background: 'rgba(11, 16, 23, 0.94)',
    border: `1px solid ${COLORS.accent}`,
    borderRadius: 6,
    bottom: 10,
    color: COLORS.text,
    display: 'grid',
    fontFamily: MONO,
    fontSize: 10,
    gap: 3,
    left: 10,
    maxWidth: 240,
    padding: '6px 8px',
    position: 'absolute',
    zIndex: 5,
  },
  inventoryWarn: {
    color: '#ffb454',
  },
  /** 201/7-06's key sheet. Centred over the map, because it is a modal reference rather than a tool: an
   *  operator reading it is not working the board at that second. */
  keyHelp: {
    background: 'rgba(11, 16, 23, 0.97)',
    border: `1px solid ${COLORS.accent}`,
    borderRadius: 7,
    display: 'grid',
    gap: 7,
    left: '50%',
    maxHeight: '76%',
    maxWidth: 400,
    overflowY: 'auto' as const,
    padding: '10px 12px',
    position: 'absolute',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: '84%',
    zIndex: 6,
  },
  keyHelpHead: { alignItems: 'center', display: 'flex', fontSize: 11, gap: 8, justifyContent: 'space-between' },
  keyHelpRow: {
    background: 'transparent',
    border: `1px solid transparent`,
    borderRadius: 4,
    color: COLORS.text,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 11,
    gap: 10,
    justifyContent: 'space-between',
    padding: '3px 6px',
    textAlign: 'left' as const,
    width: '100%',
  },
  keyHelpRowListening: {
    background: '#0e3a52',
    border: `1px solid ${COLORS.accent}`,
    borderRadius: 4,
    color: COLORS.accent,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 11,
    gap: 10,
    justifyContent: 'space-between',
    padding: '3px 6px',
    textAlign: 'left' as const,
    width: '100%',
  },
  keyHelpRows: { display: 'grid', gap: 1 },
  logLine: {
    borderBottom: `1px solid ${COLORS.border}`,
    color: COLORS.muted,
    fontFamily: MONO,
    fontSize: 10,
    padding: '3px 12px',
  },
  mapNav: {
    display: 'grid',
    gap: 4,
    justifyItems: 'center',
    position: 'absolute',
    right: 10,
    top: 10,
    zIndex: 3,
  },
  /** The cluster COLLAPSED on a phone: one target that says what is behind it. */
  mapNavCompact: {
    display: 'grid',
    gap: 6,
    justifyItems: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    zIndex: 3,
  },
  mapNavCompass: {
    background: 'rgba(11, 16, 23, 0.94)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '50%',
    cursor: 'pointer',
    lineHeight: 0,
    padding: 3,
  },
  /** 42 px with its border, which is under the criterion — the rose needs its own size where a finger
   *  presses it rather than the padding that fits a mouse. */
  mapNavCompassTouch: {
    alignItems: 'center',
    background: 'rgba(11, 16, 23, 0.94)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    height: TOUCH_TARGET,
    justifyContent: 'center',
    lineHeight: 0,
    padding: 0,
    width: TOUCH_TARGET,
  },
  mapNavKey: {
    background: 'rgba(11, 16, 23, 0.94)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    color: COLORS.text,
    cursor: 'pointer',
    fontSize: 12,
    height: 24,
    lineHeight: '12px',
    padding: 0,
    width: 24,
  },
  mapNavKeyTouch: {
    background: 'rgba(11, 16, 23, 0.94)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    color: COLORS.text,
    cursor: 'pointer',
    fontSize: 15,
    height: TOUCH_TARGET,
    lineHeight: '15px',
    padding: 0,
    width: TOUCH_TARGET,
  },
  mapNavLevel: {
    background: 'rgba(11, 16, 23, 0.94)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    color: COLORS.text,
    cursor: 'pointer',
    fontSize: 10,
    letterSpacing: 0.3,
    padding: '3px 5px',
  },
  mapNavLevelTouch: {
    background: 'rgba(11, 16, 23, 0.94)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    color: COLORS.text,
    cursor: 'pointer',
    fontSize: 12,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    padding: '3px 6px',
  },
  mapNavRow: { display: 'flex', gap: 4 },
  /** 201/7-03's operator cluster: search, saved views, fit and follow. Top-left, where every map application
   *  puts them, and clear of the selection panel and the inventory panel (both bottom-left). */
  mapTools: {
    background: 'rgba(11, 16, 23, 0.94)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    display: 'grid',
    gap: 5,
    left: 10,
    maxWidth: 232,
    padding: '7px 8px',
    position: 'absolute',
    top: 10,
    zIndex: 3,
  },
  /** The cluster collapsed to its one handle on a phone (201/7-03 expanded it always, which on a 360-px
   *  screen put nine buttons and a search box over 60% of the map). */
  mapToolsHandle: {
    alignItems: 'center',
    background: 'rgba(11, 16, 23, 0.94)',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    color: COLORS.text,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 12,
    fontWeight: 700,
    gap: 6,
    justifyContent: 'center',
    left: 8,
    letterSpacing: 1,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    padding: '0 12px',
    position: 'absolute',
    top: 8,
    zIndex: 3,
  },
  /** One hit in the place search — a row-wide button, so the whole line is the target on a phone. */
  mapToolsHit: {
    background: 'transparent',
    border: 'none',
    borderRadius: 3,
    color: COLORS.text,
    cursor: 'pointer',
    fontSize: 11,
    padding: '3px 5px',
    textAlign: 'left' as const,
    width: '100%',
  },
  mapToolsHitTouch: {
    background: 'transparent',
    border: 'none',
    borderRadius: 3,
    color: COLORS.text,
    cursor: 'pointer',
    fontSize: 13,
    minHeight: TOUCH_TARGET,
    padding: '3px 5px',
    textAlign: 'left' as const,
    width: '100%',
  },
  mapToolsInput: {
    background: '#05070a',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    color: COLORS.text,
    fontSize: 11,
    padding: '4px 6px',
    width: '100%',
  },
  mapToolsInputTouch: {
    background: '#05070a',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    color: COLORS.text,
    fontSize: 15,
    minHeight: TOUCH_TARGET,
    padding: '4px 8px',
    width: '100%',
  },
  /** The live number. Monospace, so a distance that is growing does not shuffle the row it sits in. */
  measureReadout: {
    color: COLORS.text,
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  measureRow: { display: 'flex', flexWrap: 'wrap', gap: 5 },
  /** 201/7-05's rows inside the operator cluster — they wrap rather than push the cluster past 360 px. */
  measureTools: { display: 'grid', gap: 5 },
  /** 201/7-06's on-screen controls: top-right, opposite the operator cluster and clear of both panels. */
  /**
   * 201/7-04's radar: bottom-right, the one corner nothing else claims (tools top-left, nav top-right,
   * selection and inventory bottom-left). Round, on the user's call — and the element is round too, so the
   * click target is the dial rather than a square with dead corners.
   */
  minimap: {
    borderRadius: '50%',
    bottom: 10,
    cursor: 'pointer',
    height: 132,
    position: 'absolute',
    right: 10,
    width: 132,
    zIndex: 3,
  },
  /** Phone: smaller, and clear of the sheet's grab handle. 108 px still reads at arm's length. */
  minimapCompact: {
    borderRadius: '50%',
    bottom: 8,
    cursor: 'pointer',
    height: 108,
    position: 'absolute',
    right: 8,
    width: 108,
    zIndex: 3,
  },
  mono: { fontFamily: MONO },
  panel: {
    background: COLORS.panel,
    borderRight: `1px solid ${COLORS.border}`,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
  },
  panelRight: {
    background: COLORS.panel,
    borderLeft: `1px solid ${COLORS.border}`,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
  },
  panelTitle: {
    borderBottom: `1px solid ${COLORS.border}`,
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.2,
    padding: '8px 12px',
    textTransform: 'uppercase',
  },
  /** The phone sheet's tab strip. */
  /**
   * A slider a finger can catch.
   *
   * The thumb's own size is the browser's and cannot be reached from an inline style — but a range input
   * takes the press anywhere in its box and drags from there, so the box is the target that counts. Both of
   * this console's sliders measured 16 px tall (the world dial and the shift scrub), which is a third of the
   * criterion on the two controls an operator sweeps rather than taps.
   */
  rangeTouch: {
    cursor: 'pointer',
    height: TOUCH_TARGET,
  },
  row: {
    borderBottom: `1px solid ${COLORS.border}`,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    padding: '7px 12px',
  },
  rowSelected: {
    background: '#0d1d2b',
    borderLeft: `2px solid ${COLORS.accent}`,
    paddingLeft: 10,
  },
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto' },
  /** The phone sheet: as tall as the list needs, and never more than this share of the screen. */
  sheet: { display: 'flex', flexDirection: 'column' as const, maxHeight: '44vh', minHeight: 0 },
  sheetTab: {
    background: 'transparent',
    border: 'none',
    borderBottom: `2px solid transparent`,
    color: COLORS.muted,
    cursor: 'pointer',
    flex: 1,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
    padding: '9px 0',
  },
  sheetTabActive: {
    borderBottom: `2px solid ${COLORS.accent}`,
    color: COLORS.text,
  },
  sheetTabs: {
    background: COLORS.panel,
    borderTop: `1px solid ${COLORS.border}`,
    display: 'flex',
  },
  sheetTabTouch: {
    background: 'transparent',
    border: 'none',
    borderBottom: `2px solid transparent`,
    color: COLORS.muted,
    cursor: 'pointer',
    flex: 1,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 1,
    minHeight: TOUCH_TARGET,
    padding: '9px 0',
  },
  statusBar: {
    alignItems: 'center',
    background: COLORS.panel,
    borderTop: `1px solid ${COLORS.border}`,
    color: COLORS.muted,
    display: 'flex',
    fontFamily: MONO,
    fontSize: 10,
    gap: 16,
    gridColumn: '1 / -1',
    // The row is bounded by the grid now, so anything too long has to be cut here rather than push the
    // column wider — which is how the map ended up wider than the screen.
    minWidth: 0,
    overflow: 'hidden',
    padding: '0 12px',
    whiteSpace: 'nowrap' as const,
  },
  /** One field of the status bar that can be arbitrarily long. */
  statusEllipsis: { minWidth: 0, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const },
  /** The shift timeline strip (201/8-03). Sits above the status bar, full width. */
  timeline: {
    alignItems: 'center',
    background: COLORS.panel,
    borderTop: `1px solid ${COLORS.border}`,
    display: 'flex',
    gap: 10,
    gridColumn: '1 / -1',
    minWidth: 0,
    overflow: 'hidden',
    padding: '0 12px',
  },
  /** The scrub track itself — it takes what the row has left. */
  timelineRange: {
    flex: 1,
    minWidth: 60,
  },
  /** REPLAY, shown while the console is NOT live. Deliberately loud: the whole screen is showing the past,
   *  and an operator who misses that is reading an old picture as the current one. */
  timelineReplay: {
    background: '#4a1220',
    borderRadius: 3,
    color: '#ffb3c0',
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: 0.6,
    padding: '2px 6px',
  },
  /** A two-state control that is a BUTTON, not a checkbox: a native checkbox renders 13x13 and no inline
   *  style reaches it, so on a phone the console's one board-wide switch was a third of a finger. */
  toggle: {
    alignItems: 'center',
    background: COLORS.panelRaised,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    color: COLORS.muted,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 11,
    gap: 6,
    padding: '4px 9px',
  },
  toggleOn: {
    alignItems: 'center',
    background: '#0e3a52',
    border: `1px solid ${COLORS.accent}`,
    borderRadius: 4,
    color: COLORS.accent,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 11,
    gap: 6,
    padding: '4px 9px',
  },
  topBar: {
    alignItems: 'center',
    background: COLORS.panel,
    borderBottom: `1px solid ${COLORS.border}`,
    display: 'flex',
    gap: 14,
    gridColumn: '1 / -1',
    minWidth: 0,
    overflow: 'hidden',
    padding: '0 14px',
  },
  /** Phone: the same bar with the gaps a 360-px screen can pay for. */
  topBarCompact: {
    alignItems: 'center',
    background: COLORS.panel,
    borderBottom: `1px solid ${COLORS.border}`,
    display: 'flex',
    gap: 8,
    gridColumn: '1 / -1',
    minWidth: 0,
    overflow: 'hidden',
    padding: '0 8px',
  },
} satisfies Record<string, CSSProperties>;
