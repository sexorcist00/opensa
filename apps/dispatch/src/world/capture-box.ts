/**
 * The CSS box a capture was taken in — recorded across the window, and pinnable for an arm (201/9, §6).
 *
 * **`?surface=` holds the SCENE's buffer still and deliberately does not touch the overlay's**
 * ([capture-surface.ts](capture-surface.ts), the operator's report of 2026-09-05). That is the right rule
 * and it leaves this debt behind it: the 2D layer is sized from the box the page gives it, and on a phone
 * the browser's chrome collapses and returns while a route is being flown — 360x320, 360x570 and 360x609
 * were all measured inside one session. So two arms taken at two of those boxes have different overlay
 * pixel counts, and `overlay-2d` is the largest CPU line in this frame.
 *
 * **The report could not say so until 2026-09-08.** `surface.cssWidth/cssHeight` are read at REPORT time —
 * one sample, at the end — so a window whose box moved and came back is indistinguishable from one that
 * held still, and every field in it is internally consistent. Two halves close it:
 *
 * - **{@link CssBoxRange}** — the extremes actually observed, noted from the `ResizeObserver` that already
 *   runs, so it costs the frame nothing and cannot miss a change the way a per-frame poll of `clientWidth`
 *   could. A window whose min and max differ carries a warning saying which two boxes it mixed.
 * - **`?box=WxH`** — the box itself pinned in CSS pixels, for an arm that must be comparable by
 *   construction rather than after the fact. The canvases keep sizing their buffers from the box exactly as
 *   they do without it, so the overlay is still drawn in the coordinates it is displayed in and the pin
 *   costs the symbology nothing. That is what makes this the honest lock and `?surface=` the wrong one.
 *
 * Like `?surface=`, this is a knob a capture RECORDS and never a tier anything picks: an operator's window
 * is whatever their phone gives them.
 */

/** A pinned CSS box in CSS pixels, or `null` when the page's own layout decides as usual. */
export interface CaptureBox {
  readonly height: number;
  readonly width: number;
}

/** The extremes of the CSS box over a window. Equal min and max mean the box never moved. */
export interface CssBoxExtremes {
  readonly heightMax: number;
  readonly heightMin: number;
  readonly widthMax: number;
  readonly widthMin: number;
}

/** Nothing observed yet — a report taken before layout carries this rather than a fabricated size. */
const NO_BOX: CssBoxExtremes = { heightMax: 0, heightMin: 0, widthMax: 0, widthMin: 0 };

/** The largest box a phone should be asked to lay out by a typo — well past any viewport either way. */
const MAX_EDGE = 4096;
/** Below this there is no surface to measure, and the console's own floor for a drawing buffer is 2. */
const MIN_EDGE = 2;

/**
 * The CSS box as it moved over a capture window.
 *
 * Fed from the `ResizeObserver` the boot already installs, so every change is seen exactly once and a frame
 * pays nothing. A box of 0 is ignored: the observer fires before layout and a zero would drag every minimum
 * to it, which would turn "the box never moved" into "the box collapsed" on every capture ever taken.
 */
export class CssBoxRange {
  private heightMax = 0;
  private heightMin = 0;
  private widthMax = 0;
  private widthMin = 0;

  extremes(): CssBoxExtremes {
    return this.widthMin === 0
      ? NO_BOX
      : { heightMax: this.heightMax, heightMin: this.heightMin, widthMax: this.widthMax, widthMin: this.widthMin };
  }

  note(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      return;
    }
    if (this.widthMin === 0) {
      this.widthMin = width;
      this.widthMax = width;
      this.heightMin = height;
      this.heightMax = height;

      return;
    }
    this.widthMin = Math.min(this.widthMin, width);
    this.widthMax = Math.max(this.widthMax, width);
    this.heightMin = Math.min(this.heightMin, height);
    this.heightMax = Math.max(this.heightMax, height);
  }
}

/** Whether a window mixed two different boxes — what the report warns about, computed in one place. */
export function boxMoved(extremes: CssBoxExtremes): boolean {
  return extremes.widthMin !== extremes.widthMax || extremes.heightMin !== extremes.heightMax;
}

/**
 * Read `?box=WxH`, in CSS pixels.
 *
 * Anything unparseable is `null` — the page's layout decides, exactly as if the parameter were absent. A
 * refused value must not fall back to a DIFFERENT pinned box, for the reason `capture-surface.ts` states:
 * a capture that silently ran at a size nobody asked for is the failure this module exists to prevent.
 */
export function captureBox(params: URLSearchParams): CaptureBox | null {
  const asked = params.get('box');
  if (asked === null) {
    return null;
  }
  const match = /^(\d{1,4})x(\d{1,4})$/i.exec(asked.trim());
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);

  return width >= MIN_EDGE && width <= MAX_EDGE && height >= MIN_EDGE && height <= MAX_EDGE ? { height, width } : null;
}
