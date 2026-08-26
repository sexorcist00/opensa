# Design System — OpenSA dispatch console

The console's visual source of truth. It lives beside the code it governs, for the reason every plan in this
repository lives beside its code: a system kept somewhere else drifts from the thing it describes.

**The tokens are `src/ui/styles.ts`.** This file says what the tokens MEAN and why they have the values they
have; that file is what components import. When the two disagree, the code is right and this file is the bug.

## Product context

- **What this is:** the operator surface of a web CAD/dispatch application for a SA-MP roleplay server. A
  live map with unit and incident symbology, a call queue, a unit roster, a shift timeline, and the
  renderer's own numbers. This repository owns the map component of it ([202](../../docs/plans/202-pcad-dispatch/readme.md)).
- **Who works it:** a dispatcher, for a whole shift, glancing rather than reading.
- **Primary device:** an Android phone at **360 CSS px** with a coarse pointer. A desk at 1280+ is the
  second target, not the first ([the rule](../../docs/restrictions/cross-platform-surface.md)).
- **Project type:** an operations console. Not a dashboard, not a game menu, not a marketing surface.

**The one thing to remember after seeing it:** _this is a dispatch desk that fits in one hand._ Every
decision below serves that. Where a choice would make it prettier and less like a desk, the desk wins.

## The landscape, and what it changed

Researched 2026-08-25, and **re-done with screenshots on 2026-08-26**. The first pass could only read these
products, because headless Chromium answered `ERR_CONNECTION_RESET` on every site. That was never a policy
block: Chromium's TLS 1.3 ClientHello carries a post-quantum key share the session's egress gateway resets
on, and launching with `--ssl-version-max=tls1.2` makes every one of them load. The rows below now rest on
captured screens rather than on prose about them.

| Source                                                                                                                | What it is                                                                                       | What it changed here                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SnailyCAD](https://github.com/SnailyCAD/snaily-cadv4)                                                                | the closest open-source peer — an MIT CAD/MDT for GTA roleplay communities, Next.js + TypeScript | Confirms the information model we already have (active units, active calls, statuses, searches). **Its Live Map page is this console's layout already** — map full-bleed, a collapsible call list floating top-left, actions in a popup at the marker — but it is a VIEWING mode: no roster, no queue, no way to assign. The right layout with the work left out of it                                            |
| [SonoranCAD](https://sonorancad.com/fivem)                                                                            | the commercial leader for FiveM; four operator-selectable themes over one fixed screen           | **Two mechanics adopted, one rejected.** Adopted: the **status tally in the panel header** (`10-6:1 10-8:3 10-51:3`), which makes one line both the colour legend and the shift summary; and the **callsign as a filled pill**, the one field in a row that never truncates. Rejected: its light theme fills the whole ROW with the status colour, and the text contrast fails exactly where the row matters most |
| [Resgrid](https://resgrid.com/apps/dispatch)                                                                          | the largest open-source real-world CAD (Apache-2.0)                                              | A measured warning rather than a pattern: its Dispatch app keeps the call-intake FORM expanded permanently and leaves the map a card — **475×302 of 1665×947, 9.1 % of the screen**. Its BigBoard is the field's only configurable widget grid, and is the reference for a future wall mode                                                                                                                       |
| [CrowdCAD](https://crowdcad.org)                                                                                      | AGPL-3.0, Next.js + Tailwind + shadcn/ui; browser-only "Lite Mode"                               | **Call intake as a MODAL, not a docked form** — the intake screen is needed seconds per minute and the map always, which is the argument this console needed. Its panes resize (`react-resizable-panels`, a 25/75 splitter) but do not move; ours do both, because a splitter still divides the map's space                                                                                                       |
| [Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)                      | a 12-step scale where every step has one declared UI role                                        | **Adopted as the palette architecture.** Steps 1-2 backgrounds, 3-5 component backgrounds by state, 6-8 borders by strength, 9-10 solid, 11-12 text (Lc 60 / Lc 90 APCA over step 2). The console had seven flat colours and no rule for which to use where                                                                                                                                                       |
| [IBM Carbon](https://carbondesignsystem.com/elements/themes/overview/)                                                | an enterprise system with an explicit dark-theme layering model                                  | **Adopted as the depth rule:** in a dark theme each added layer is one step LIGHTER. The console had panels and floating map clusters at the same value, so nothing on screen said what was on top of what                                                                                                                                                                                                        |
| Public-safety CAD practice ([DHS TechNote](https://www.dhs.gov/sites/default/files/publications/CAD_TN_0911-508.pdf)) | what a real CAD is for: prioritise, locate, assign, track to closure                             | Keeps the hierarchy honest: **priority and location are the two things a row must answer at a glance**, and everything else is detail. It is why priority is encoded three ways below                                                                                                                                                                                                                             |

**Where we deliberately differ from the category.** Real CAD is a desk product with three monitors, and the
roleplay CADs are laptop products. This one is a phone product first, so the density that reads as
professional on a 27-inch panel is exactly what makes it unusable in a hand. The answer is not a smaller
version of the desk: it is **one component that takes a size**, plus folding the controls that are not
pressed every few seconds ([201/3-01](../../docs/plans/201-dispatch-console/3-the-operator-surface-on-a-phone/readme.md)).

## The workspace

**The map is the desk, and everything else is on top of it.** Adopted 2026-08-26 with the user, after the
survey above; the step is
[201/7-08](../../docs/plans/201-dispatch-console/7-the-operator-map/readme.md).

The finding that settled it: **no console in this field makes the map its main screen.** SnailyCAD puts it
on another page, SonoranCAD in another window, Resgrid in a 9 %-of-screen card, CrowdCAD not at all. So a
map-first console has nothing to copy and has to state its own rule:

1. **The map holds the whole viewport, at every width.** The desk layout used to spend a 300-px and a
   264-px column on the queue and the roster — 564 px, 44 % of a 1280-px screen, on two lists that are read
   in glances.
2. **The lists are windows over the world**, moved and sized by the operator, and remembered per browser
   (`STORAGE_KEYS.windows`). A window is always FULLY inside the map: a panel hanging half off the edge is
   a bug that looks like a feature, and at 360 px it is simply lost.
3. **A window is movable without a pointer.** The title bar is a real `<button>`, so it is in the tab order
   and carries the focus ring; arrows move it, shift+arrows size it.
4. **The phone keeps the sheet.** A window that covers the map it floats over is not a small version of the
   desk, it is a worse one — so under `COMPACT_MAX_WIDTH` the same two panels are a sheet beneath the map.
   One model, two densities.

**What this deliberately is not.** Not a widget grid (GridStack, Resgrid's BigBoard): tiles that snap to
columns and reflow take space away from the map, which is the thing this rule exists to stop. Not a
splitter (CrowdCAD's `react-resizable-panels`): a divider still divides the map's space rather than
floating over it. And not a library at all — `react-rnd` and friends would be this package's first runtime
dependencies, in something that ships as an embeddable widget with none, and their touch handling is an
afterthought on a console whose primary device is a phone. Pointer Events cover mouse, pen and touch in one
handler; the geometry is `src/ui/window-frame.ts` and the gesture is `src/ui/panel-window.tsx`.

## Skins

**Four themes, and a theme is DATA rather than a fork** (201/7-09, 2026-08-26). `src/ui/theme.ts` holds
them; `src/ui/styles.ts` holds `var(--os-…)` rather than colours, so switching a skin is one attribute on
the app root and **nothing in React re-renders**.

| Skin                | For                                | Character                                                                                                                                               |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Night** (default) | the shift                          | cool slate, hue ~213, the palette everything else is measured against                                                                                   |
| **Day**             | a phone outdoors                   | built in its own direction, not inverted — in the dark each layer is one step LIGHTER, in the light one step DARKER, and inverting breaks Carbon's rule |
| **Contrast**        | bad screen, bright sun, tired eyes | pure black ground, pure white text, mid steps pushed apart                                                                                              |
| **Amber**           | the identity slot                  | warm near-black, monospace chrome, rows two pixels tighter                                                                                              |

**A theme may change** the ramp, the accent, the two semantic surfaces, the shadows, the font stacks and
row padding. **A theme may never change** `SET_COLORS` (the engine's own draw colours — a chip would drift
from its pin), `TOUCH_TARGET`, or the layout and the position of controls. SonoranCAD moves its dock between
skins; that breaks muscle memory on a theme change, and we do not copy it.

**Contrast is measured, not asserted.** `theme.test.ts` runs every preset through APCA and fails the build
under **Lc 90 primary / Lc 60 secondary**, over all five surfaces each colour is set on. This is what makes
four skins cost less risk than SonoranCAD's four, whose `trevor` lands grey text on a mid-blue row fill.

**It found a defect in this document.** The neutral-ramp table below claimed Lc 60 for step 11 from
2026-08-25; the shipped value measured **Lc 47–50**. The target was written down and never checked. Step 11
is `#a8bbd0` now, and three danger readouts moved for the same reason.

**A colour-vision-safe STATUS palette is not a skin and is not shipped.** Red / amber / green is the worst
triple for deuteranopia, and fixing it means rebuilding the engine's debug-line sets rather than writing a
variable — it needs a hook in 201/5.

## Aesthetic direction

**Instrument panel.** The map is the subject and holds all the saturation; the chrome is achromatic and gets
out of the way. Decoration level: none — there is no ornament in this UI that is not carrying information.

The mood is a working instrument that has been used for years: quiet, legible, unsurprising. Not "dark mode
SaaS", which is where a console like this usually lands — glassy cards, a purple gradient, a hero number
nobody needs.

## Colour

**Two palettes, and they never mix.**

1. **Chrome is achromatic** — the neutral ramp below. Panels, bars, buttons, borders, text.
2. **State comes from the map's own table** — `src/map/beacons.ts` → `SET_COLORS`, which the WebGPU beacons,
   the 2D overlay, the radar AND the lists all read. A call's chip in the queue is the same colour as its
   pillar on the map because it is the same number, not because someone matched them by eye. **Never add a
   status colour to `styles.ts`** — it goes in that table or it does not exist.

### The neutral ramp

Cool slate, hue ≈ 213°, built dark-first with Radix's step roles.

| Step | Value     | Role                                                                                            |
| ---- | --------- | ----------------------------------------------------------------------------------------------- |
| 1    | `#070a0f` | the world — app background, and what the map is drawn onto                                      |
| 2    | `#0b111a` | docked surfaces — the side panels, the three bars                                               |
| 3    | `#111a26` | components — rows, floating clusters, inputs                                                    |
| 4    | `#16202e` | hover                                                                                           |
| 5    | `#1b2736` | active / selected                                                                               |
| 6    | `#222f40` | separators inside a surface                                                                     |
| 7    | `#2b3a4d` | borders on interactive components                                                               |
| 8    | `#3a4d64` | strong border, and the focus ring                                                               |
| 11   | `#a8bbd0` | secondary text — **corrected 2026-08-26**: `#8fa1b6` measured Lc 47–50, not the 60 claimed here |
| 12   | `#e8eff7` | primary text                                                                                    |

Steps 9-10 (solid) are the accent's job, not the neutral's — nothing in this console is a solid grey block.

### Accent

One accent, `#38bdf8`, and it means exactly one thing: **the operator's own mark** — selection, focus, the
live state, the primary action. It was previously also used for the inventory panel's border, the fps
readout and every active tab, which is how an accent stops meaning anything.

| Token          | Value     | Role                                                            |
| -------------- | --------- | --------------------------------------------------------------- |
| `accentBg`     | `#0c2634` | the fill behind a primary or selected control                   |
| `accentBorder` | `#1d5b7d` | its edge                                                        |
| `accent`       | `#38bdf8` | solid — the ring, the rail, the dot                             |
| `accentText`   | `#6fd0fb` | text on a dark fill (the solid is too hot for a glyph at 11 px) |

### Depth, not outlines

The old surface treatment was a 1 px border on everything, which at 360 px reads as a wireframe. Depth is
carried by **value plus shadow**, and a border is used only where two surfaces of the same value meet.

- floating over the map: step 3 at 92 % + `0 4px 16px rgba(0,0,0,.45)`
- modal over everything: step 3 at 97 % + `0 12px 40px rgba(0,0,0,.6)`

## Typography

System sans for chrome, monospace for data. No web fonts: this console loads over a phone's connection to a
static server, and a font that arrives late reflows the board.

- **Sans:** `ui-sans-serif, system-ui, sans-serif`
- **Mono:** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` — for anything that is a value: unit
  call-signs, codes, coordinates, timers, the status bar

| Name        | Size | Use                                                                                     |
| ----------- | ---- | --------------------------------------------------------------------------------------- |
| `micro`     | 10   | uppercase labels, badges, the status bar                                                |
| `caption`   | 11   | secondary text, dense rows                                                              |
| `body`      | 12   | the default                                                                             |
| `bodyTouch` | 13   | the same text where the pointer is coarse                                               |
| `input`     | 15   | text a finger types into (16 avoids iOS zoom; 15 + `touch-action` handling is our case) |
| `title`     | 17   | the one title                                                                           |

**Every changing number is tabular.** `fontVariantNumeric: 'tabular-nums'` on the mono token and on live
counters. A call ageing from `9s` to `10s` used to shift the row it sits in; the status bar shimmered on
every frame it drew.

## Spacing and shape

- **Spacing:** 4-based — `2 · 4 · 8 · 12 · 16 · 24`. Nothing else.
- **Radius:** `4` controls · `8` surfaces · `999` pills. Three values; there were eight.
- **Touch target:** `44` CSS px minimum in **both** axes where the pointer is coarse. Not a preference —
  WCAG 2.2 (2.5.5), Apple HIG and Material all agree on it.

## Priority is encoded three ways

A dispatcher scanning a queue must not be relying on hue. Every call row carries its priority as:

1. **position** — a 3 px rail down the left edge of the row, in the priority colour;
2. **text** — the `P1` / `P2` / `P3` chip;
3. **colour** — the same value the map draws that call with.

Any one of the three read alone is enough. This is the rule for any state the console adds later.

## Motion

Minimal-functional. The board moving IS the motion — units drive, calls arrive, the clock runs. Transitions
are limited to state changes a finger makes (`120ms ease-out` on background and border) so a tap is
acknowledged on a phone that may be a frame behind. Nothing loops, nothing pulses, nothing slides in.

## What inline styles cannot reach

The console styles inline, with one exception: `src/ui/global-css.ts`, a small sheet scoped under
`[data-opensa-dispatch]` so it cannot leak into a host page that embeds the console. It exists for the four
things an inline style object structurally cannot express, each of which was a real defect:

- `:focus-visible` — keyboard focus had no visible ring on a dark panel;
- `::-webkit-slider-thumb` / `::-moz-range-thumb` — both sliders had a 16 px thumb;
- `::placeholder` — the search box's placeholder sat at the UA's grey;
- **`font-family` on form controls** — it does not inherit, so every button and field rendered in the
  browser's default face (Arial, measured on the live page) beside panels set in the app's own sans;
- the scrollbars on the dense lists, plus `color-scheme: dark` and `prefers-reduced-motion`.

## Two checklist rules this console deliberately breaks

A design review flags both of these on sight. Both are reasoned, and they are written down here so the next
reviewer does not "fix" them.

**A system font as the primary typeface.** The usual read is _"I gave up on typography"_, and on a marketing
page it is correct. Here the console is served as static files to a phone on whatever connection it has, and
a webfont that arrives late reflows the board an operator is reading. Nothing in this UI is set larger than
17 px, so the display face a webfont would buy is a face nobody sees. Revisit if the console ever grows a
surface that is read rather than scanned.

**A coloured left border on a row.** It is on every AI-slop blacklist because it is usually decoration on a
marketing card. Here it is the priority rail, and it is carrying the one thing the queue is scanned for. The
test is whether removing it loses information: it does.

## Decisions log

| Date       | Decision                                                         | Rationale                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-25 | The neutral ramp is 12 steps with Radix's role-per-step          | Seven flat colours with no rule for which to use where; every new component picked whatever looked close                                                                                            |
| 2026-08-25 | Depth by value + shadow, borders only between equal values       | A 1 px border on every surface reads as a wireframe at 360 px, and floating clusters were the same value as docked panels                                                                           |
| 2026-08-25 | State colour comes only from `SET_COLORS`                        | It already fed the beacons, the overlay and the radar; the lists reading the same table is what keeps a chip and a pin from drifting                                                                |
| 2026-08-25 | The accent means "the operator's mark" and nothing else          | It was on primary buttons, fps, tabs, the inventory border and the key sheet, so it marked nothing                                                                                                  |
| 2026-08-25 | Priority is position + text + colour                             | Colour alone fails a scanning dispatcher and fails colour-blind operators; the chain already required "readable by more than colour alone"                                                          |
| 2026-08-25 | One scoped stylesheet for pseudo-elements                        | Four documented defects were unreachable from inline styles; scoping it under the app's own attribute keeps `?embed=1` safe                                                                         |
| 2026-08-26 | The map is the desk; the queue and roster are windows on it      | Four working consoles measured, and none makes the map its main screen; the old desk layout spent 564 of 1280 px on two lists read in glances                                                       |
| 2026-08-26 | Windows move and size by pointer AND by keyboard, no library     | `react-rnd` would be this widget's first runtime dependency; GridStack is a grid whose tiles reflow, which takes back the space this change won                                                     |
| 2026-08-26 | A status tally sits in each panel's header                       | Taken from SonoranCAD: one line is both the colour legend and the shift summary, and it reads `SET_COLORS` so it cannot disagree with the map                                                       |
| 2026-08-26 | The callsign is a filled pill coloured by status                 | The one field in a row that never truncates; at 360 px it is the only place the status is guaranteed readable                                                                                       |
| 2026-08-26 | Four skins, as data, switched by one attribute on the root       | Colour moved to CSS custom properties so a skin change costs no React work at all; SonoranCAD's four are hand-written forks                                                                         |
| 2026-08-26 | Every skin is measured by APCA in the test suite                 | Contrast failure is silent — it renders, lints and screenshots fine; the guard caught the SHIPPED theme's step 11 at Lc 47                                                                          |
| 2026-08-26 | A skin may not touch `SET_COLORS`, targets or the layout         | Those are the map's own colours, an accessibility criterion, and muscle memory; SonoranCAD moves its dock between skins                                                                             |
| 2026-08-26 | `@snailycad/ui` is not forked; the map half keeps its own system | It peers on `next`, requires Tailwind, and brings ~50 runtime dependencies into a zero-dependency embeddable widget — and its component set is for a list-first page, not a map                     |
| 2026-08-26 | Overlay BEHAVIOUR comes from Radix Primitives, headless          | Five overlays need dialog/popover/tooltip/select/tabs; SnailyCAD reached for React Aria instead, which is the deeper answer for comboboxes and date pickers — the CAD half's problem, not the map's |
