/**
 * The drawing buffer a capture is taken at, pinned rather than inherited (201/9-01).
 *
 * **The browser moves the canvas under a running measurement, and that invalidated a whole circuit.** The
 * canvas follows the visible viewport (`overlay.width = clientWidth * dpr`, `world/boot.ts`), and on a phone
 * the browser's chrome collapses and returns while the map is being flown: 2026-08-31 measured **720x1218,
 * 720x864, 720x746 and 720x640 inside one session** — a 1.9x spread in pixels, with the `target` residency
 * category moving 59.87 → 32.35 MB alongside it. Two arms of an A/B taken at two of those sizes cannot be
 * subtracted, and **nothing in the capture complains**: every field is internally consistent, the run looks
 * clean, and only a reader who compares the `surface` blocks afterwards finds out
 * ([the row](../../../../docs/benchmarks/opensa-engine/2026-08-31-mobile-map-circuit-arms.json)).
 *
 * `?surface=WxH` fixes the drawing buffer at exactly that many DEVICE pixels, whatever the viewport does.
 * The CSS box is still laid out by the page, so the picture is scaled into whatever room there is — which is
 * the right trade for a measurement arm, where identical pixel work per arm is the entire point, and wrong
 * for an operator, which is why it is off unless asked for.
 *
 * It is a knob a capture RECORDS, not a tier anything picks — the same footing as `?scale=`
 * ([the refusal](../../../../docs/performance/deferred-optimizations/render-scale-tier.md)).
 */

/** A pinned drawing buffer in device pixels, or `null` when the viewport decides as usual. */
export interface CaptureSurface {
  readonly height: number;
  readonly width: number;
}

/** The largest buffer a phone GPU should be asked for by a typo — 4K either way, well past any viewport. */
const MAX_EDGE = 4096;
/** Below this a pass has no room to be measured, and `resize` already floors the live path at 2. */
const MIN_EDGE = 2;

/**
 * Read `?surface=WxH`.
 *
 * Anything unparseable is `null` — the viewport decides, exactly as if the parameter were absent. A refused
 * value must not fall back to a DIFFERENT pinned size: a capture that silently ran at a size nobody asked
 * for is the failure this module exists to prevent, and an absent pin is visible in the report's own
 * `surface` block.
 */
export function captureSurface(params: URLSearchParams): CaptureSurface | null {
  const asked = params.get('surface');
  if (asked === null) {
    return null;
  }
  const match = /^(\d{1,4})x(\d{1,4})$/i.exec(asked.trim());
  if (match === null) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!inRange(width) || !inRange(height)) {
    return null;
  }

  return { height, width };
}

function inRange(value: number): boolean {
  return value >= MIN_EDGE && value <= MAX_EDGE;
}
