/**
 * The four things an inline style object cannot express, and every one of them was a real defect.
 *
 * This console styles inline (`styles.ts`) and that stays the rule — one table, no cascade to reason about.
 * But an inline style reaches no pseudo-class and no pseudo-element, so four things were simply unreachable:
 *
 * - **`:focus-visible`** — keyboard focus fell back to the user agent's ring, which on these dark panels is
 *   somewhere between faint and invisible. A console that can be driven entirely from the keyboard
 *   (201/7-06) has to show where the keyboard IS.
 * - **the range thumb** — both sliders drew a ~16 px thumb. Making the input 44 px tall fixed the TARGET
 *   (a range drags from anywhere in its box), but the thumb still looked like something to aim at rather
 *   than grab. Only `::-webkit-slider-thumb` / `::-moz-range-thumb` reach it.
 * - **`::placeholder`** — the search box's hint sat at the browser's grey, darker than our own muted step.
 * - **the scrollbars** on the queue and the roster, which on a dark surface arrive as a bright band.
 *
 * **Everything is scoped under `[data-opensa-dispatch]`.** The console is embeddable (`?embed=1`,
 * `embed.ts`), and a widget that ships bare element selectors restyles its host's inputs. The attribute goes
 * on the app root, so these rules cannot reach past it.
 */
import { ACCENT, RAMP } from './styles';

/** The attribute every rule below is scoped under, and the app root carries. */
export const DISPATCH_SCOPE = 'data-opensa-dispatch';

const ID = 'opensa-dispatch-css';

const CSS = `
[${DISPATCH_SCOPE}] *:focus-visible {
  outline: 2px solid ${ACCENT.solid};
  outline-offset: 1px;
}
[${DISPATCH_SCOPE}] input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}
[${DISPATCH_SCOPE}] input[type='range']::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: ${RAMP.lineStrong};
}
[${DISPATCH_SCOPE}] input[type='range']::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: ${RAMP.lineStrong};
}
[${DISPATCH_SCOPE}] input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border-radius: 50%;
  border: 2px solid ${RAMP.surface};
  background: ${ACCENT.solid};
  cursor: pointer;
}
[${DISPATCH_SCOPE}] input[type='range']::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid ${RAMP.surface};
  background: ${ACCENT.solid};
  cursor: pointer;
}
[${DISPATCH_SCOPE}] input[type='range']:disabled::-webkit-slider-thumb {
  background: ${RAMP.ring};
}
[${DISPATCH_SCOPE}] input[type='range']:disabled::-moz-range-thumb {
  background: ${RAMP.ring};
}
[${DISPATCH_SCOPE}] ::placeholder {
  color: ${RAMP.textMuted};
  opacity: 0.75;
}
[${DISPATCH_SCOPE}] * {
  scrollbar-width: thin;
  scrollbar-color: ${RAMP.lineStrong} transparent;
}
[${DISPATCH_SCOPE}] ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
[${DISPATCH_SCOPE}] ::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: ${RAMP.lineStrong};
}
[${DISPATCH_SCOPE}] ::-webkit-scrollbar-track {
  background: transparent;
}
`;

/** Put the sheet in the document once. Idempotent — a second console on one page reuses the first's. */
export function installDispatchCss(): void {
  if (typeof document === 'undefined' || document.getElementById(ID) !== null) {
    return;
  }
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = CSS;
  document.head.append(style);
}
