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

Researched 2026-08-25. External sites could not be captured visually from the build container (headless
Chromium gets `ERR_CONNECTION_RESET`; `curl` and text fetches work), so these are read and cited rather than
screenshotted.

| Source                                                                                                                | What it is                                                                                       | What it changed here                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SnailyCAD](https://github.com/SnailyCAD/snaily-cadv4)                                                                | the closest open-source peer — an MIT CAD/MDT for GTA roleplay communities, Next.js + TypeScript | Confirms the information model we already have (active units, active calls, statuses, searches) and that the dispatch screen is a **list-and-map**, not a dashboard of tiles. Its docs are silent on mobile and on status colour, which is where this console can be better rather than equal |
| [Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)                      | a 12-step scale where every step has one declared UI role                                        | **Adopted as the palette architecture.** Steps 1-2 backgrounds, 3-5 component backgrounds by state, 6-8 borders by strength, 9-10 solid, 11-12 text (Lc 60 / Lc 90 APCA over step 2). The console had seven flat colours and no rule for which to use where                                   |
| [IBM Carbon](https://carbondesignsystem.com/elements/themes/overview/)                                                | an enterprise system with an explicit dark-theme layering model                                  | **Adopted as the depth rule:** in a dark theme each added layer is one step LIGHTER. The console had panels and floating map clusters at the same value, so nothing on screen said what was on top of what                                                                                    |
| Public-safety CAD practice ([DHS TechNote](https://www.dhs.gov/sites/default/files/publications/CAD_TN_0911-508.pdf)) | what a real CAD is for: prioritise, locate, assign, track to closure                             | Keeps the hierarchy honest: **priority and location are the two things a row must answer at a glance**, and everything else is detail. It is why priority is encoded three ways below                                                                                                         |

**Where we deliberately differ from the category.** Real CAD is a desk product with three monitors, and the
roleplay CADs are laptop products. This one is a phone product first, so the density that reads as
professional on a 27-inch panel is exactly what makes it unusable in a hand. The answer is not a smaller
version of the desk: it is **one component that takes a size**, plus folding the controls that are not
pressed every few seconds ([201/3-01](../../docs/plans/201-dispatch-console/3-the-operator-surface-on-a-phone/readme.md)).

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

| Step | Value     | Role                                                       |
| ---- | --------- | ---------------------------------------------------------- |
| 1    | `#070a0f` | the world — app background, and what the map is drawn onto |
| 2    | `#0b111a` | docked surfaces — the side panels, the three bars          |
| 3    | `#111a26` | components — rows, floating clusters, inputs               |
| 4    | `#16202e` | hover                                                      |
| 5    | `#1b2736` | active / selected                                          |
| 6    | `#222f40` | separators inside a surface                                |
| 7    | `#2b3a4d` | borders on interactive components                          |
| 8    | `#3a4d64` | strong border, and the focus ring                          |
| 11   | `#8fa1b6` | secondary text                                             |
| 12   | `#e8eff7` | primary text                                               |

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

| Date       | Decision                                                   | Rationale                                                                                                                                  |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-25 | The neutral ramp is 12 steps with Radix's role-per-step    | Seven flat colours with no rule for which to use where; every new component picked whatever looked close                                   |
| 2026-08-25 | Depth by value + shadow, borders only between equal values | A 1 px border on every surface reads as a wireframe at 360 px, and floating clusters were the same value as docked panels                  |
| 2026-08-25 | State colour comes only from `SET_COLORS`                  | It already fed the beacons, the overlay and the radar; the lists reading the same table is what keeps a chip and a pin from drifting       |
| 2026-08-25 | The accent means "the operator's mark" and nothing else    | It was on primary buttons, fps, tabs, the inventory border and the key sheet, so it marked nothing                                         |
| 2026-08-25 | Priority is position + text + colour                       | Colour alone fails a scanning dispatcher and fails colour-blind operators; the chain already required "readable by more than colour alone" |
| 2026-08-25 | One scoped stylesheet for pseudo-elements                  | Four documented defects were unreachable from inline styles; scoping it under the app's own attribute keeps `?embed=1` safe                |
