/**
 * What this console ASKS the device for, before any query pins anything (201/9-05).
 *
 * **The bloom pyramid starts at HALF the render size here, and that is an operator's verdict rather than a
 * measurement.** 201/9's sweep found the bloom chain to be 7.7 ms of a 23.4 ms frame; the two levers that
 * reach it were flown on 2026-09-05
 * ([the row](../../../../docs/benchmarks/opensa-engine/2026-09-05-mobile-bloom-levers.json)) against a
 * baseline re-flown between them at 21.52 ms:
 *
 * | arm | mean | rung 1 |
 * | --- | --- | --- |
 * | `field` (full-res prefilter) | 21.52 ms | 67 % |
 * | `bloomrg11` (the chain's own storage halved) | 19.16 ms | 80 % |
 * | **`bloomhalf` (this)** | **17.16 ms** | **91 %** |
 * | `bloomboth` | 17.38 ms | 90 % |
 *
 * **It buys no frame time with resolution, sampling or anti-aliasing** — the world is still drawn at full
 * size into a 4× MSAA `rgba16float` scene and the post pass still writes every pixel. What is halved is the
 * resolution the GLOW is computed at, and the two levers do NOT stack: once the pyramid starts at half size,
 * halving its bytes as well buys nothing measurable, so `rg11b10ufloat` stays an arm and a fallback rather
 * than riding along.
 *
 * **This OVERTURNS a refusal, and the overturn is the load-bearing part.** The
 * [2026-08-12 attribution](../../../../docs/benchmarks/opensa-engine/2026-08-12-dispatch-render-target-attribution.json)
 * kept the prefilter at full resolution *"on purpose (074/09) so sub-pixel emitters survive thresholding; at
 * night that is every street lamp and every headlight, and dimmer emissives are a protected-list item"*.
 * That reasoning is sound and it is exactly what half resolution costs: the bright-pass threshold then runs
 * on a 2×2 average, so a lamp one pixel across can be diluted below it. So the refusal was not argued away —
 * it was **looked at**: the panel's `night` / `nighthalf` pair (hour 22, differing by this one field, which
 * `links.test.mjs` pins) was shot on the device and the operator chose this arm. A protected-list item is
 * released by a field verdict and by nothing else.
 *
 * **Scoped to this console on purpose.** The verdict was taken at map zoom, 180–220 m, looking down; the
 * refusal it overturns was written for a street camera, and the game still reads `DEFAULT_RENDER_BUDGET`
 * untouched. `?bloomscale=1` re-flies the old baseline (panel link `bloomfull`), because a default that
 * moved without leaving its predecessor reachable would make every earlier row unrepeatable.
 *
 * **The adaptivity is not here and must not be.** A surface asks; the DEVICE answers, in
 * `resolveRenderBudget` — a format the adapter cannot render falls back and the report states which one ran.
 * Nothing in this console reads a user-agent string, a screen size or a vendor name to decide how the world
 * looks ([the PC/mobile restriction](../../../../docs/restrictions/architecture.md): the difference is a
 * budget the frame reads, never a branch it executes;
 * [201's decisions](../../../../docs/plans/201-dispatch-console/readme.md): no silent quality ladder).
 */
import { DEFAULT_RENDER_BUDGET, type RenderBudget } from '@opensa/engine';

export const CONSOLE_RENDER_BUDGET: RenderBudget = { ...DEFAULT_RENDER_BUDGET, bloomPrefilterScale: 0.5 };
