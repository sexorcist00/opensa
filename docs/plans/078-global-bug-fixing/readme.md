# 078 — Global bug fixing (post-full-pmb-run: engine + tools)

**Status: OPEN — round 1 fixed (2026-07-19).** It runs BEFORE [079 — viewers/lab on pmb output](../079-viewers-lab-on-pmb-output.md);
the agreed order after it closes: 079 → full migration audit → merge `webgpu-migration` into `main`.

## Context

The first FULL end-to-end perfect-map-builder run (the one thing opensa-pack plan 003 left to the
user) happened 2026-07-19: the whole modded map converted in **over an hour**, and the result has
**bugs** — both engine-side and tool-side. This plan is the single ledger where they are triaged
and fixed, instead of scattering fixes across the finished chains' docs.

Command that produced the run (for reproduction):

```
NODE_OPTIONS=--max-old-space-size=12288 npx tsx tools/perfect-map-builder/src/cli.ts \
  --game ./game-src/non-modified --in ./mods-src --out ./build/perfect
```

## Bug ledger

| #   | Symptom                                                                                                                    | Surface                            | Repro                                                                                                                                         | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                      | Status                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | The `sa` target is never built — no `sa/` in the output, no log line, no error                                             | pmb                                | `--until pack` (or `--until opensa`)                                                                                                          | `pipeline.ts` gated the sa split on an explicit name LIST (`undefined \| 'sa' \| 'lod'`) while `STAGE_NAMES` is the pipeline ORDER and `sa` precedes `pack` — so an inclusive-sounding flag silently dropped a whole target                                                                                                                                                                                                     | **FIXED**                                               |
| 2   | `linear-txd/` in the output looks like debug junk                                                                          | —                                  | —                                                                                                                                             | NOT a bug: the gamma/linear TXD sidecar (lod-trees plan 012) that `swapLinearTxds` vets into the opensa `gta3.img` before the pack. Already self-deleting; visible only under `.work/` because `--until` keeps intermediates                                                                                                                                                                                                    | **NOT A BUG**                                           |
| 3   | `[engine-host] boot failed SyntaxError: Unexpected token '<', "<!doctype "...` when booting from a local folder            | engine                             | boot the engine host with no pak served at `/pak-map`                                                                                         | `setup.ts` trusted `response.ok`, but a dev server answers an unknown path with its SPA `index.html` at **HTTP 200** — so the friendly "no pak" guard was skipped and `.json()` choked on markup. The pak is fetched over HTTP independently of the local-folder VFS, and root `public/` had no `pak-map`                                                                                                                       | **FIXED** (message); the two-sources split is 079's job |
| 4   | No progress inside the long pack stages; failure COUNTS with no names                                                      | opensa-pack                        | any full run                                                                                                                                  | Each stage logged once after its loop; the per-model failure dump used `console.warn`, was uncapped, and omitted `breakables`                                                                                                                                                                                                                                                                                                   | **FIXED**                                               |
| 5   | 41 cell LODs (`lod_8_-7`, `lod_7_-7`, … the LS/SF core) fail: "past the uint16 index ceiling"                              | opensa-lod-generator / opensa-pack | full run, see `report.json`                                                                                                                   | Baked cell LODs exceed 65 535 verts; the converter cannot index them → those far LODs are MISSING in the engine                                                                                                                                                                                                                                                                                                                 | **OPEN** — surfaced by fix 4                            |
| 6   | `admiral`, `comet` fail the uint16 ceiling — **AND no vehicle spawns at all, from the debugger or the road-car registrar** | opensa-pack + renderware + engine  | boot the packed dir; HUD shows `FIXED-STEP ERROR: model has 90609 vertices, past the uint16 index ceiling`, `[bench] road cars registered: 0` | ONE cause, two symptoms. The user's two custom cars (`mods-src/vehicles/`) are hi-poly (86 511 / 82 991 raw verts, ~90 609 after the builder's per-material split). `buildVehicleModel` hardcodes `Uint16Array` and THROWS; the pack therefore leaves their `.dff` in the archive; the runtime then builds that same `.dff`, hits the same throw — **inside the fixed step**, which takes the whole vehicle system down with it | **OPEN** — root-caused 2026-07-19                       |
| 7   | 30 props + 11 peds + 1 anim object: "`<model>.dff` not found"                                                              | opensa-pack                        | full run                                                                                                                                      | Unverified: ped `special01…10` are stock placeholder slots (benign), but `dyn_*`/`kmb_*` props look like real map content                                                                                                                                                                                                                                                                                                       | **OPEN** — needs triage                                 |

## Working rules

1. **Triage first, fix second**: every reported symptom gets a ledger row + a minimal repro before
   any code changes; root causes recorded even for one-line fixes (the fixed/ open-issues discipline).
2. A bug whose fix changes converter OUTPUT batches into ONE reconvert at the end — no per-fix
   full-map runs (a full run costs > 1 h).
3. Regressions get a pinned test in the owning package; the suite + the 6-scene ritual sweep close
   the plan.
4. Convert-time itself (> 1 h) is a candidate ledger row: measure where the time goes before
   deciding whether it is a bug or the honest cost (bakes were 124 s + 124 s on the map; the rest
   needs a breakdown).

## Ledger

### Round 1 (2026-07-19) — bugs 1, 3, 4 fixed; no reconvert needed

**Bug 1 — the missing `sa` target.** `pipeline.ts` gained `runsStage(stage, until)`: `STAGE_NAMES` is the
order, so the stop point is INCLUSIVE and `--until pack` builds `sa` again. The old name-list is what made
this silent — there was not even a "skipped" line, unlike the conditional chain stages. Five unit tests
pinned the gating (`pipeline.test.ts` had ZERO `until` coverage before); the CLI help, which already
implied linear semantics, now states it.

**Bug 3 — the HTML-instead-of-JSON boot failure.** `setup.ts` now sniffs the body (`<` after trim) instead
of trusting `ok`, so the actionable "no pak at …" message survives the dev server's 200-OK SPA fallback.
`apps/engine-lab/src/pak-loader.ts:19-24` is a copy of this fetch with the same gap — 079 folds it into the
shared path rather than duplicating the fix. Unblocked locally with a `public/pak-map` symlink into
`build/perfect/opensa/opensa` (the pak dir: `manifest.json` + `world.ospak` + `water.bin` + `report.json`).

**Bug 4 — logging.** New `progress.ts` (`createProgress(label, total, log)`, same ETA shape as the
cell-convert line in `convert.ts`, one line per 5 s) wired into the loops a full run actually waits on:
map objects, vehicles, peds, props, breakables. Map objects count UNIQUE model names as the denominator —
the loop dedups IDE rows, so row count would misreport the wait. The failure dump became `reportFailures`:
routed through the injected `log`, `breakables` added (it was missing), and grouped by failure CLASS —
the per-model name and numbers are normalised out of the message, so one cause is one line, capped at 20
names with `+N more`. `report.json` keeps every failure in full; the console is the index into it.

Measured on the user's existing run — **85 failures collapse to 5 classes**, and two of them are new bugs
(rows 5 and 6) that the old count-only output had hidden in plain sight:

```
⚠ 85 models did not convert, in 5 failure class(es) — full list in report.json:
  ⚠ vehicle — model has N vertices, past the uintN index ceiling (2): admiral, comet
  ⚠ ped — <model>.dff not found (11): null, special01, … special10
  ⚠ anim object — <model>.dff not found (1): oilplodbitbase
  ⚠ prop — <model>.dff not found (30): doublestreetlght, gardenbencha, … +10 more
  ⚠ map object — model has N vertices, past the uintN index ceiling (41): lod_8_-7, lod_7_-7, … +21 more
```

Suite green: 180 tests / 24 files across opensa-pack + perfect-map-builder + engine streaming; `tsc` and
`eslint` clean. None of these fixes changes converter OUTPUT, so round 1 costs no reconvert.

### Not a bug

`.work/` surviving a run is `--until`/`--keep-work` doing its job (`keepWork = options.keepWork || until !== undefined`).

### Round 2 investigation (2026-07-19) — bugs 1 and 6 of the user's report are ONE bug

The user reported two things: cars do not spawn from the debugger although the pack says they converted,
and the pack lost two cars they suspect are their custom merges. Both are the same defect.

**Verified the pack is NOT at fault** (Node, against the user's own `build/perfect/opensa/models/gta3.img`):
`alpha.dff` is gone and `alpha.osm` is present (4.4 MB); `readVehicleOsm('alpha')` decodes fully — 77
submeshes, 14 936 verts, 4 wheels, colliders, seat, half-extents; the baked 4.2 MB atlas is there and every
submesh references array 0. A first hypothesis that the runtime only asks for `.dff` was **wrong** and was
discarded: `loadOptimizedVehicle` resolves `.dff` first, `.osm` second, exactly so a surviving `.dff` means
"modloader override or unconverted".

**The real chain**, caught by booting the packed dir headlessly:

1. The two custom cars in `mods-src/vehicles/` are hi-poly — `admiral` 86 511 and `comet` 82 991 raw verts,
   ~90 609 after the builder's per-material vertex split.
2. `build-vehicle-model.ts:373` hardcodes `Uint16Array` and throws past 65 536 — deliberately, so indices
   never wrap silently.
3. The pack therefore fails those two and, correctly, leaves their `.dff` in the archive for the legacy path.
4. The runtime then builds that same `.dff` and hits the same throw — **inside the fixed step**. The HUD
   shows `FIXED-STEP ERROR: Error: model has 90609 vertices, past the uint16 index ceiling`, and
   `[bench] road cars SKIPPED: no vehicle system` with `road cars registered: 0` (from 841).

So two unconvertible cars take down vehicle spawning **for all 201 models**. The blast radius is the worse
half of this bug.

**The fix has two independent parts** (both owed; the first rides the pending rebuild):

- **uint32 indices on the rigid path.** `buildVehicleModel` emits `Uint32Array` past the ceiling, the `.osm`
  fixture records the index width, and `engine.ts:2004` / `:2242` stop hardcoding `'uint16'` in
  `setIndexBuffer` — the CELL path already does exactly this (`cell.index16 ? 'uint16' : 'uint32'`), so the
  pattern is established. This fixes the pack failure and the runtime throw at once.
- **Blast radius.** One bad model must not kill the vehicle system: the fixed-step vehicle work needs
  per-model isolation, so a model that cannot build is skipped and NAMED, not fatal. Worth doing even after
  uint32 — the next unbuildable model should cost one car, not all of them.

**Also fixed this round:** the debugger's spawn button did `void actions.spawnVehicle(model)`, so every
spawn failure became an unhandled rejection and the button silently did nothing — which is why this looked
like "nothing happens" rather than an error. The vehicles screen is now its own `VehicleScreen` component
(the panel had crossed its complexity limit) and prints the failure.

**Harness note:** `tools-debug/bench-harness/game-server.js` needs an ABSOLUTE game path. With a relative
`./build/...`, `path.join` normalises the `./` away, the `file.startsWith(ROOT)` guard is then always false,
and every file 404s — the boot just times out waiting for a canvas.

### Round 3 (2026-07-19) — bug 6 FIXED, both halves

**Part A — uint32 indices on the rigid path.** `buildVehicleModel` no longer throws past 65 536 vertices; it
narrows the array to the model (`indicesFor`), and the width travels with it instead of being assumed:
`VehicleModelData.indices` is `Uint16Array | Uint32Array`, `RigidModelInit`/`VehicleModelInit` gained
`index16?` (absent = the historical uint16, so nothing pre-existing changes), the `.osm` fixture records it,
`vehicle-osm.ts` reads it AND uses it for the payload stride, and `drawVehicleModel` binds
`model.index16 ? 'uint16' : 'uint32'` — the same pattern the cell path already used.

Deliberately NOT changed: the clutter path still binds uint16 and derives its count as `byteLength / 2`.
A clutter species is one scattered plant; the assumption is the format there, and a comment now says so.

Measured on the user's own archive after the fix — both cars build, and the indices address correctly rather
than wrapping:

| model     | vertices | index width | max index |
| --------- | -------- | ----------- | --------- |
| `admiral` | 90 887   | 4 B         | 90 886    |
| `comet`   | 83 008   | 4 B         | 83 007    |

**Part B — blast radius.** The parked-car loop in `engine-vehicles.ts` let a build failure escape into
`setupEngineVehicles`' caller, which catches it and leaves `vehicles` **null** — so two bad cars killed
spawning for all 201 models, from the debugger AND the road-car registrar. Each placement is now isolated:
a model that cannot be built is skipped and NAMED once (not once per placement), and the rest of the street
still parks. Worth keeping after part A — the next unbuildable model should cost one car, not all of them.

The `assertIndexable` test that asserted the old throw was replaced by two: uint32 past the ceiling with the
max index verified above 65 535, and uint16 for an ordinary model. (Use `reduce`, not `Math.max(...indices)`
— spreading tens of thousands of indices blows the call stack; it cost a probe run.)

Suite 2282/321 green, `tsc` + `eslint` clean. **Part A changes converter OUTPUT**, so the two cars only
convert to `.osm` after the user's pending rebuild; part B and the runtime uint32 read work immediately on
the existing pak, which still carries their `.dff`.

**FIELD-CONFIRMED same day** (headless, the user's own `build/perfect/opensa`, `?bench=ls-noon`): road cars
went **0 → 296**, the `FIXED-STEP ERROR` line is gone from the HUD, and cars render in the street. The fix
works on the EXISTING pak — no rebuild needed for the runtime half.

One honest number came out of it. Two runs, same scene, same 296 cars:

| run                                        | fps  | avg ms | p95  | draws | GPU pass |
| ------------------------------------------ | ---- | ------ | ---- | ----- | -------- |
| all models (includes `admiral`/`comet`)    | 51.5 | 19.40  | 33.3 | 1100  | 3.27     |
| `?benchcar=infernus` (one converted model) | 120  | 8.33   | 10.2 | 1129  | 2.60     |

Same car count and MORE draws in the fast run, and the GPU differs by 0.67 ms — so this is CPU and it is
model-specific. The two hi-poly cars are the only difference, and they are the only cars still built from
`.dff` at runtime: the other 199 load pre-baked `.osm`, which is the whole point of the pack. Expected to
go away when the rebuild converts them (now that part A lets it) — **verify it after the rebuild rather
than assuming it**, and do not read the 51.5 fps row as a renderer regression.
