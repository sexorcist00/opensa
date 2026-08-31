/**
 * Which of the overlay's three arms a run is on (201/9-01).
 *
 * **The two-arm A/B could not answer the question it was built for, and this module is why.** The field
 * round of 2026-08-30 turned the symbology off and the frame halved — moving p50 **48 → 24 ms** — while the
 * CPU it removed was **3.09 ms**. The other ~21 ms belongs to no span this repo records, and `?overlay=0`
 * cannot say what it is, because it skips the `clearRect` as well: the layer is never dirtied, so the
 * browser's compositor is free to skip the whole canvas. **That conflates two different costs with two
 * different fixes** —
 *
 * - **the layer**: a full-surface RGBA canvas cleared and re-composited over the WebGPU canvas every frame;
 * - **the content**: ~167 symbol paths and 32–153 chips rasterized every frame.
 *
 * `clear` is the missing arm. It dirties the canvas exactly as the full arm does and draws nothing into it,
 * so the difference between `clear` and `off` is the LAYER and the difference between `on` and `clear` is
 * the CONTENT. Two subtractions instead of one, off the same circuit.
 *
 * **The gate stops watching the board on any arm but `on`**, for the reason `?overlay=0` already carried: a
 * window meant to price the surface may not be paced by a roster nobody can see.
 */

/** How much of the overlay a run draws. `off` is `?overlay=0`, kept spelled that way for every filed row. */
export type OverlayArm = 'clear' | 'off' | 'on';

/** Whether this arm draws anything into the overlay — the symbols, the chips, the sketches and the radar. */
export function armDrawsContent(arm: OverlayArm): boolean {
  return arm === 'on';
}

/** Whether this arm touches the overlay canvas at all, which is what makes the compositor pay for it. */
export function armTouchesSurface(arm: OverlayArm): boolean {
  return arm !== 'off';
}

/**
 * Read the arm out of `?overlay=`.
 *
 * Absent is `on`, because a console an operator opens draws its units. Anything unrecognised is `on` too:
 * a typo that silently measured the engine alone is the expensive failure here, and the capture states the
 * arm it ran, so a mistyped one shows up as `on` in the file rather than as a number nobody can place.
 */
export function overlayArm(params: URLSearchParams): OverlayArm {
  const asked = params.get('overlay');

  if (asked === '0') {
    return 'off';
  }

  return asked === 'clear' ? 'clear' : 'on';
}
