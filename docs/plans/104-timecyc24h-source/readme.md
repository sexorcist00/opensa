# 104 — `timecyc24h.dat` as a third timecyc source

**Status: PLANNED 2026-08-21**, not started. Single-file plan; the steps are small enough to ship in one
change each.

**The built tree carries a timecyc the engine never reads.** `build/original/opensa/data/` holds THREE
timecycs: the stock `timecyc.dat` (8 keyframes per weather), our own generated `timecyc_24h.dat`, and — since
the opensa-layer mod `1. [24H] Refixed Original Timecycle` landed — `timecyc24h.dat`, the file format of the
`timecyc24h.asi` plugin (Dante) that the reference install runs through modloader
(`docs/gta-sa-original/reference-install-config.md`, the `timecyc24h` row). Every loader we have knows two
names, `timecyc_24h.dat` then `timecyc.dat`; the third is mirrored into the tree and ignored.

The user's call (2026-08-21): extend the loading order to

1. `data/timecyc_24h.dat` — as authored (24h already);
2. else `data/timecyc24h.dat` — as authored (24h already);
3. else `data/timecyc.dat` — the mandatory stock table, expanded through `convertTo24h`.

## What the recon measured (2026-08-21, against the built tree)

Read the three files with the parser we ship (`packages/renderware/src/parsers/text/timecyc.parser.ts`):

| File | Lines | Data rows | Tokens per row | Weather headers | Parse failures | Negative `FogSt` rows (min) |
| --- | --- | --- | --- | --- | --- | --- |
| `timecyc.dat` (stock) | 437 | 184 = 23 × 8 | 51 (one row 49 — the known RAINY_COUNTRYSIDE 8PM corruption) | 23 | the 2 stock quirks | 37 (−200) |
| `timecyc_24h.dat` (ours) | 1 092 | 504 = 21 × 24 | 52 | 21 | 2 (carried from stock) | 96 (−200) |
| `timecyc24h.dat` (Dante) | 1 196 | 552 = 23 × 24 | 52 | 23 | **0** | **243 (−1 700)** |

Three consequences, and they decide the shape of the plan:

1. **The parser needs no extension.** The Dante file is the same 27-field schema in the same order — its
   header only renames two groups (`PostFx1ARGB` / `PostFx2ARGB` for our `Alpha1 RGB1` / `Alpha2 RGB2`) and
   marks hours `00AM…23PM` instead of `0h…23h`; comments are skipped, so neither matters. It carries all 23
   weathers × 24 hours, which `ensure24h` already accepts (`WEATHER_NAMES.length * HOURS`) and `buildTimecyc`
   already trims to the 21 time weathers. **The whole gap is in the loaders**: `GtaSaWorldAdapter.loadTimecyc`
   (`packages/game/src/adapters/gta-sa-world.adapter.ts:382`), the canvas host
   (`apps/web/src/ui/engine-canvas-host.tsx:502`) and the lab (`apps/engine-lab/src/pak-source.ts:27`) each
   spell the two names by hand, and the environment driver takes an `is24h` boolean
   (`engine-environment-driver.ts:124`) instead of letting `ensure24h` decide by row count.
2. **`timecyc_24h.dat` is OUR OWN OUTPUT, not a stock file, and it shadows the mod.** `npm run timecyc`
   (`tools/timecyc-builder/src/index.ts`) writes stock + a RealVision night merge straight into
   `game-src/original/data/timecyc_24h.dat` (2026-07-16 in the tree, byte-identical to the built copy), and
   the build mirrors it. Under the order above, the mod's `timecyc24h.dat` is therefore SILENTLY shadowed in
   exactly the tree we have today — the file is installed, the build exits 0, and the night is RealVision's.
   The order stays as the user set it (an explicit hand-authored 24h table outranks a mod's); what the plan
   adds is that the choice is **visible** (step 02) and that the generated file's home is decided (step 03).
   Note the builder doc (`docs/development/timecyc-builder.md`) already says the output goes to
   `timecyc-builder/merged/` — the code and the doc disagree today.
3. **The Dante table leans on negative `FogSt` six times harder than stock, and we floor it.**
   `engine-environment-driver.ts:192` clamps `fogStartDistance` to `≥ 0`. Stock authors a negative start on
   37 rows (min −200); Dante on 243 rows down to −1 700 (smog, desert, underwater nights). Loading the file
   "as authored" and then flooring a quarter of its fog rows is not honouring the data
   (`docs/project-goals.md` §1). Step 04 recovers what a negative start means in SA before anything is fitted.

Both copies of the mod's file are identical (`sa/24. [24H] Refixed Original Timecycle 1.6/modloader/
timecyc24h/timecyc24h.dat` and `opensa/1. [24H] Refixed Original Timecycle/data/timecyc24h.dat`, `cmp` clean),
so on the `sa` target the original consumes it through Dante's asi and nothing in this plan touches that
target.

## Steps

| # | Step | Lands in |
| --- | --- | --- |
| 01 | ONE resolver, three call sites, `ensure24h` instead of `is24h` | `packages/renderware` (resolver), `packages/game`, `apps/web`, `apps/engine-lab` |
| 02 | the choice is visible: a boot log line naming the winner; fixture + tests | `packages/game` tests, `scripts/test-fixtures.ts` |
| 03 | docs + the generated file's home | `docs/contracts/mods.md`, `docs/gta-sa-original/`, `docs/features/`, `tools/timecyc-builder` |
| 04 | negative `FogSt`: recover SA's meaning, then a field A/B of the three sources | `packages/game` driver, `docs/benchmarks/` |

### 01 — one resolver, three call sites

- Add `resolveTimecycSource(getText: (path: string) => string | null): TimecycSource | null` beside the parser,
  where `TimecycSource = { kind: 'authored-24h' | 'dante-24h' | 'stock', path: string, text: string }` and
  the candidate list `TIMECYC_SOURCES` is ONE readonly array in file order — the three loaders call it, none
  of them spells a file name again. The lab's reader is async (`fetch`); give the resolver a sync signature
  over a `getText` callback and let the lab pre-fetch the three candidates, or add a tiny async twin — pick
  whichever keeps `pak-source.ts` free of a second copy of the order.
- The driver's `timecyc?: { is24h: boolean; text: string }` becomes `timecyc?: { text: string }` and parses
  through `ensure24h(parseTimecyc(text))` — row count decides, as it already does for the builder. This is
  what makes Dante's 552 rows load without a special case: `buildTimecyc` keeps the first 504.
- `loadTimecyc()` in the adapter does the same through the resolver; no file present stays a thrown error
  (`requireText`'s message names all three candidates).

**Done when** the adapter, the host and the lab have no string literal `timecyc_24h.dat` left except inside
`TIMECYC_SOURCES`, and the existing suite is green (the 24h fixture path and the stock path are unchanged in
behaviour).

### 02 — the choice is visible; fixture + tests

- The boot log gets one line: `[timecyc] data/timecyc24h.dat (dante-24h, 552 rows)` — the same place the
  sampled entry is logged on the `'time'` event today. A shadowed mod file is then one `grep` away instead of
  a session.
- Fixture: `data/timecyc24h.dat` by the manifest rule — ONE line,
  `modFile('[24H] Refixed Original Timecycle/data/timecyc24h.dat', 'data/timecyc24h.dat')` (found by NAME
  across layers; the opensa-layer folder is the exact-name match), regenerated with `npm run test:fixtures`,
  never dropped in by hand.
- Tests (negative first, positive after, per the project's test structure):
  - `timecyc.parser.test.ts`: the Dante fixture parses to 23 × 24 rows of 52 numbers with no sentinel
    defaults; `ensure24h` passes it through; `buildTimecyc` keeps 21 weathers.
  - `gta-sa-world.adapter.integration.test.ts`: none of the three → throws naming all three; only stock →
    converted; Dante + stock → Dante wins; all three → `timecyc_24h.dat` wins (the order, as a table).
  - the resolver's own unit test for `kind`/`path`.

**Done when** the order is asserted by a test, not by a comment.

### 03 — docs, and the generated file's home

Same change as 01/02 where possible:

- `docs/contracts/mods.md` §2 gains the rule: the three data-file names, the order, and **what happens when
  one is misspelled — nothing; the loader falls through to the next name with no error** (the boot log line
  from 02 is the only tell). A mod shipping `data/timecyc24h.dat` in the `opensa` layer is the supported way
  to ship a 24h table.
- `docs/gta-sa-original/timecyc24h.md` + README row: the `timecyc24h.asi` format as measured (23 × 24, the
  renamed header groups, the hour labels, the negative-`FogSt` census above, and that the asi reads the
  name `timecyc24h.dat` — the only string in the binary).
- `docs/features/weather-environment.md`: "or a shipped `timecyc_24h.dat`" becomes the three-name order.
- **The generated file's home** — the user's decision, recorded here when taken: either `npm run timecyc`
  writes to `tools/timecyc-builder/merged/` as its doc already claims and copying it into `game-src` is a
  deliberate act, or it keeps writing into `game-src/original/data/` and the contract says so in one line.
  Until it is taken, the shadowing in finding 2 is the state of every build.

### 04 — negative `FogSt`: SA's meaning first, then the field

- Recover from the reversed source (`docs/links.md` → gta-reversed, `CTimeCycle::Update` /
  `CRenderer::RenderFadingInEntities` / `RwCameraSetFogDistance` callers) what a negative fog start does in
  the original — fog that has already reached some density AT the camera, or a clamp of its own. Write the
  formula down before touching the driver; if the honest path is not reachable this plan, the current
  `max(0, …)` floor gets its card in `docs/hacks/` (it is a hack today and has none).
- Field A/B through the one-build instruments, no rebuild: boot the opensa build with each source winning in
  turn (move the higher-priority file aside in `build/original/opensa/data/`, restore after — ledger the
  moves), headless screenshots at 00:00 / 06:00 / 12:00 / 21:00 in EXTRASUNNY_LA and EXTRASUNNY_SMOG_LA
  (the weather Dante authors −100 fog starts on), `docs/development/benchmarks.md` harness. Record the boot
  parse time of the 552-row table next to the 504-row one (expected: unmeasurable; say so with the number).
- Numbers into `docs/benchmarks/` before they are read; the user's field verdict closes the step.

**Done when** the three sources have been seen side by side, the verdict is recorded, and the floor is either
replaced by the recovered rule or carded.

## Out of scope, deliberately

- **A `?timecyc=` URL override** to pick a source by hand. The field A/B above moves files aside instead; a
  knob is cheap to add later and would widen this plan past its one sentence.
- **Teaching `timecyc-builder` the name.** It already reads either shape through `ensure24h`; only the path
  in its config names a file.
- **The `sa` target.** Dante's asi consumes the same file there already; the reference install is the
  control, not the subject.
- **The 2 extracolour weathers** Dante carries at full 24 rows. `buildTimecyc` drops them as it drops the
  padding rows of our own table; whether anything should read `EXTRACOLOURS_*` is a different plan.
