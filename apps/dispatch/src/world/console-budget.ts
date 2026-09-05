/**
 * What this console ASKS the device for, before any query pins anything (201/9-05).
 *
 * **Today it asks for exactly the engine's default, and that is the point of the file rather than a gap in
 * it.** Every capture in `docs/benchmarks/` taken before this was a measurement of that default, and the
 * baseline arm of 201/9's sweep — `field`, moving mean 23.44 ms — is the number every other arm is
 * subtracted from. Moving the default here would silently make the next `field` a different frame, so this
 * is the ONE named place the verdicts land, and until a verdict exists it names the default out loud.
 *
 * **What is waiting on a verdict**, both from 201/9's sweep
 * ([the row](../../../../docs/benchmarks/opensa-engine/2026-09-05-mobile-map-ablation-sweep.json)), which
 * found the bloom chain to be **7.7 ms of a 23.4 ms frame** while its cheap tail is free:
 *
 * | arm | what it asks for | what it is waiting for |
 * | --- | --- | --- |
 * | `?bloomformat=rg11b10ufloat` | half the bytes of `rgba16float`, float range kept | its own flight, then one look pass — the format is granted only where the adapter renders it |
 * | `?bloomscale=0.5` | the pyramid starting at half size, which quarters the three passes that are 90 % of the chain | a look verdict on the device: the threshold then runs on a 2×2 average, so sub-pixel emitters dim |
 * | `?bloomminpx=16` | no levels below 16 px | nothing measurable — 0.2 ms, six tiny textures — and it narrows the widest halo, so it is NOT adopted for tidiness alone |
 *
 * **The adaptivity is not here and must not be.** A surface asks; the DEVICE answers, in `resolveRenderBudget`
 * — a format the adapter cannot render falls back and the report states which one ran. Nothing in this
 * console reads a user-agent string, a screen size or a vendor name to decide how the world looks
 * ([the PC/mobile restriction](../../../../docs/restrictions/architecture.md): the difference is a budget the
 * frame reads, never a branch it executes; [201's decisions](../../../../docs/plans/201-dispatch-console/readme.md):
 * no silent quality ladder).
 */
import { DEFAULT_RENDER_BUDGET, type RenderBudget } from '@opensa/engine';

export const CONSOLE_RENDER_BUDGET: RenderBudget = { ...DEFAULT_RENDER_BUDGET };
