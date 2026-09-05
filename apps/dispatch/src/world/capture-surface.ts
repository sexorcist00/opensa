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

/**
 * The aspect the camera must frame for: the canvas as it is DISPLAYED, never the buffer it draws into.
 *
 * **The pin used to distort the world, and nothing in the report said so** (the operator's report,
 * 2026-09-04, which is how it was found — by eye, on the phone, after a whole evening of measurement).
 * The camera took `canvas.width / canvas.height`; with `?surface=720x640` inside a 360x550 CSS box that is
 * a world framed for **1.125** and then stretched by the browser into a box of **0.655** — the map ~1.7x
 * too tall, circles as ellipses. Every number was still honest (the GPU did the same work either way and
 * all arms carried the same pin), and every LOOK verdict taken through a measurement link was worthless.
 *
 * Reading the box instead renders anamorphically — non-square pixels in the buffer — and the stretch undoes
 * exactly that, so geometry is correct and the pin costs vertical RESOLUTION alone, which the report's
 * `surface` block already states. **A look verdict still belongs on an unpinned page**: soft is soft.
 *
 * Picking rides the same number (`rayAt`, `groundFootprint`), so a thumb under a pin used to land where the
 * operator did not aim it.
 *
 * SILENT in the way this repo's restrictions keep naming: it typechecks, it lints, every test passes — this
 * is geometry, not behaviour — and it is invisible on any surface that does not pin, which is every
 * shipping one.
 */
export function canvasAspect(canvas: {
  clientHeight: number;
  clientWidth: number;
  height: number;
  width: number;
}): number {
  const { clientHeight, clientWidth } = canvas;

  // Before layout the box is 0x0 and the buffer's own ratio is a better guess than 1: the first frame can
  // run before the element has been measured.
  return clientWidth > 0 && clientHeight > 0 ? clientWidth / clientHeight : canvas.width / Math.max(1, canvas.height);
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
