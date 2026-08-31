# MSAA sample count — 24 MB of a phone's residency, spent on edges

**Status: REOPENED 2026-08-31 as [201/9-04](../../plans/201-dispatch-console/9-the-mobile-frame/readme.md), and this file priced the wrong half.** Everything below weighs the sample count as MEMORY and closes on *"residency does not press"*. Two things have moved. **The memory grew**: `target` is **59.87 MB of 96.45** on the 08-31 phone row — 62 % of residency and 2.3× every texture in the district. **And the frame-time half was never asked.** The scene pass's per-pixel tile working set is **48 bytes** (`rgba16float` × 4 = 32, `depth32float` × 4 = 16) against the **16 bytes per pixel** Arm budgets for a 16×16 tile on the GPU family this console runs on; past that the driver shrinks the tile and the per-tile fixed costs multiply. The console is at **21 fps against a declared 60**, so this is no longer a memory lever waiting on a residency squeeze — it is a candidate for the largest unexplained number in the frame. The question *"whether Mali's driver elides it is unknown"* below is still open and still the right question; what changed is that it now has a cheap answer, because 9/04 reads it off the **vsync ladder** rather than off a GPU timer this adapter does not have. Read that step before quoting anything under this line.

**Status (as written 2026-08-12):** priced, not taken. The number comes from
[the render-target attribution](../../benchmarks/opensa-engine/2026-08-12-dispatch-render-target-attribution.json),
which reconciles exactly against the phone capture it was computed for
([2026-08-12, the pinned district on ASTC](../../benchmarks/opensa-engine/2026-08-12-mobile-pinned-district-astc.json)).

## What we do today

`MSAA_SAMPLES = 4` (`packages/engine/src/render/pipelines.ts`), one value for every device and every surface.
The scene pass renders into a 4× color attachment and a 4× depth attachment and resolves into `scene-color`;
the env probe does the same at 128².

## The lever

Read the sample count as a **budget number** rather than a constant — 4 on a desk GPU, 1 or 2 on a phone —
exactly as [the PC/mobile restriction](../../restrictions/architecture.md#the-pcmobile-difference-is-a-budget-not-a-branch)
allows: a number the frame reads, never a branch it executes, and never a second pipeline set. It is a
pipeline-creation input, so it is chosen once at init and cannot be moved live without recompiling every
pipeline.

## What it would win

On the measured surface (360×364 CSS at DPR 2 = 720×728 device px):

| Sample count | msaa-color | msaa-depth | Together |
| --- | --- | --- | --- |
| 4 (today) | 12.00 MB | 12.00 MB | **23.99 MB** |
| 1 | — (the scene pass writes `scene-color` directly) | 2.00 MB | **2.00 MB** |

**A saving of ~22 MB — 65.7 % of the `target` category and 29 % of the whole 74.9 MB residency** on a phone
capture where `target` was the largest category of all, larger than every texture in the district after ASTC.
It also removes the resolve, which is bandwidth on a tiler.

## What it would cost

- **Aliasing on exactly the content a city map is made of.** A top-down operator view is almost entirely
  silhouette: railings, wires, poles, roof edges, and building outlines against sky and road. That is the
  worst case for no MSAA, and it is not a detail an operator can be asked to ignore — legibility at city zoom
  is [201/3-03](../../plans/201-dispatch-console/3-the-operator-surface-on-a-phone/readme.md)'s own subject.
- **It is a look change, so the engine judges it** (`CLAUDE.md`), on the phone, at map zoom — not a
  screenshot pair on a desk.
- **The saving may be partly imaginary on a tiler.** The 4× color attachment is `RENDER_ATTACHMENT`-only and
  could in principle live in tile memory, but WebGPU has no transient/memoryless attachment, so the
  allocation is real as far as anything we can measure is concerned. Whether Mali's driver elides it is
  unknown and only a device-side memory reading would say.

## What would have to be true to pull it

- **Residency actually presses.** It does not: 74.9 MB against a 300–500 MB ceiling. The lever is written
  down for the full-map build, where the world grows and this category does not.
- **Or a cheaper anti-aliasing exists in the frame.** A post-pass AA (FXAA/SMAA-class) at 2 MB instead of 24
  is the honest alternative and nothing in the repo has one; that is a feature, not a knob, and it belongs to
  a plan rather than to this file.

## Cheaper things to try first

- **`?scale=`** — already the one knob (`apps/dispatch` gained it 2026-08-12, `apps/web` always had it), and
  it moves 34.66 MB of scale-dependent target memory to 19.50 at 0.75 and 8.66 at 0.5. The AUTOMATIC version
  of it was measured and refused ([render-scale-tier](render-scale-tier.md)); the manual one is offered.
- **The bloom prefilter at half resolution** — 3.0 MB for a threshold pass, priced in the attribution file
  and rejected there for the same reason: it exists at full res so sub-pixel emitters survive, and the lit
  world is a [protected item](../../plans/201-dispatch-console/1-the-map-profile/protected-list.md).
