# 094 — sa-map-viewer: a standalone map viewer over ORIGINAL SA files + model search in the debugger

**Status: PLANNED 2026-07-29. No code yet.**

Born from the beach blue-strip investigation
([`docs/open-issues/beach-blue-strip.md`](../../open-issues/beach-blue-strip.md)): the lab loop there
A/Bs *pak builds*, which means every probe costs a repack and every camera was an orbit whose phase
drifted per run (one whole bisect was invalidated by that). What the investigation actually needs is
a viewer that renders the map **straight from a folder of original GTA SA files** — point it at
`game-src/original` (vanilla), at the merged build tree, or at any experiment folder, and see the
same area with a **deterministic camera**, no repack in the loop.

## What is being built (the spec)

1. **`apps/sa-map-viewer`** — a standalone browser app:
   - at startup the user picks the game folder to load (or passes a served dir via query param);
   - the camera hovers top-down over the map; by default only the cell under the camera renders;
     default position is the map centre, overridable by coordinates in query params;
   - a **permanent left panel** — the debugger's map-viewer UI as ONE always-open section (no
     close/toggle): the cell checkbox grid, the whole-map toggle, LOD mode, object selection;
   - **model search**: a text field with autocomplete over model names; picking a result centres
     the camera on the model and activates its cell if it is not active.
2. **The same search lands in the opensa debugger** (`apps/web`, F2 → Map): when the map viewer is
   active, a search field with autocomplete centres on the named object and activates its cell.

## Restrictions check (`docs/restrictions/`, read 2026-07-29)

- **Layer tags** (`architecture.md`): the app is `type:app`; `type:app` may depend on `type:app` and
  `type:engine` (`eslint.config.ts:289`) — so it may import `@opensa/renderware` / `loaders` / `vfs` /
  `engine` / `engine-formats` (all `type:engine`) and reuse `apps/web` debugger UI directly. Caught
  by ESLint. **It may NOT import a `tool:`** — `type:app → type:tool` is not in the allow list, so
  the browser weld (below) must not reach into `tools/opensa-pack`; the Node-free weld pieces it
  needs must be used via an allowed home (see Phase 1's boundary note).
- **One cell size = 250** (`architecture.md`): the viewer buckets instances itself
  (`buildWorldGrid`) — it must use the same 250 as the four agreeing places, or its cell grid stops
  matching the debugger's and every cross-tool cell coordinate conversation breaks. SILENT — pin it
  with a constant imported from the same source the web host uses.
- **Mods are installed, never overlaid** (`build-vs-runtime.md`): not violated — this is a debug
  viewer over whatever folder it is given, not a game-runtime overlay; nothing it does feeds the
  game. It is, deliberately, the "run the converter where the files are" shape the modloader
  postmortem names as the honest one — for diagnosis, not for play.
- **Vehicles exist only as `.osm`** (`build-vs-runtime.md`): irrelevant — map objects only, no
  vehicles/peds in scope.
- **A field run reads the built dir and nothing else** (CLAUDE.md): this tool's whole point is
  reading arbitrary folders, so every capture/screenshot from it must be SELF-DESCRIBING — the app
  overlays (and logs) which folder/URL it loaded, so an A/B can never silently compare two sources.

## What already exists (verified in-repo; do not rebuild)

- **Folder → filesystem**: `browserInstallSource(dir)` (File System Access picker,
  `packages/loaders/src/asset-local-loader/install-source.ts:16`) and the served-dir twin
  (`fetch-install-source.ts` + `scripts/serve-static.ts`, `?loader=http-dir&src=` pattern in
  `apps/web/src/ui/shell/use-asset-boot.ts:62`); lazy VER2 IMG reading (`img-reader.ts:37`) so a
  ~1 GB `gta3.img` costs only its directory.
- **Parsers**: every SA format parser in `packages/renderware` is env-agnostic
  (ArrayBuffer/text in, zero `node:*`) — IMG, DFF, TXD, COL, IPL text+binary, IDE, gta.dat,
  timecyc, water.
- **Map resolve at runtime, already browser-proven**: `resolveMap(fs)`
  (`packages/renderware/src/map/resolve-map.ts:51`; authoritative LOD marking via IPL lod-index
  targets, `markLodTargets:141`), `buildWorldGrid(defs, 250)` (`map/world-grid.ts:38`),
  `cellGroups` (`map/cell-groups.ts:32`) — all called today by `GtaSaWorldAdapter.prepare()`.
- **Originals → engine cell bytes, no pak**: the weld core is Node-free (`weldCellParts` /
  `assembleCell` in `tools/opensa-pack/src/weld.ts`, `TexturePlanner` in `textures.ts`), and
  `apps/engine-lab/src/synthetic.ts` proves the in-memory feed: `encodeOscell`/`encodeOstex`
  (`packages/engine-formats`) → `engine.cells.load` / `engine.textures.load` directly.
- **The debugger map-viewer UI is already a reusable component**: `MapInspector`
  (`apps/web/src/ui/debug/map-inspector.tsx`) renders the cell grid / whole-map / LOD mode /
  selection panel against a small renderer-agnostic `MapGame` interface (`map-inspector.tsx:15`) —
  implement that interface and the whole panel comes for free, styled by `debug-styles.ts`.
- **Picking**: `.oscell` minor 6 carries the per-cell placement name table
  (`weld.ts` `buildPlacementTable`); `engine.cells.debugPicking` + `cells.pick()` + the `select`
  event drive the existing selection panel.
- **The autocomplete pattern**: the Vehicles screen's filter box + list
  (`apps/web/src/ui/debug/debug-overlay.tsx`, `VehicleScreen`).
- **The full name index for the in-game search**: `GtaSaWorldAdapter` holds `MapDefinitions`
  (`catalog` by id, `defByName`, every `IplInstance` with position) — already constructed in the
  same `engine-canvas-host.tsx` closure where `mapGame` is built; nothing surfaces it yet.

## Design decisions

1. **Render path = weld in the browser**, not per-instance rigid uploads. Per-instance
   `createVehicleModel` works today but is one draw per instance — the draw-call wall
   (~4.4 µs/draw) is the very reason the pak/weld design exists, and the whole-map toggle would die
   on it. Welding also buys picking (the placement name table) and makes the viewer render through
   the SAME cell path as the game — what it shows is what the game would show for these files.
   Skips: AO/sun-vis bakes off (`ConvertOptions`), no `.oswire`/zlib (raw bytes straight to
   `cells.load`), no water pass at first.
2. **Own tiny manual-cells driver** implementing `MapGame` (weld-on-demand + cache + unload):
   `listCells()` from the world grid, `setManualCells()` welds/loads missing cells and unloads
   deselected ones. No `StreamingDriver`, no rings, no pak.
3. **UI is imported from `apps/web`, not copied**: `MapInspector` + `debug-styles` (app→app is
   legal). The shell renders it as a fixed, non-closable left panel — one section, no F2, no menu.
4. **The debugger map-viewer camera, interactively; deterministic when scripted.** The hand
   camera is EXACTLY the in-game map viewer's: open with `snapTopDown` over the focus
   (`TOP_DOWN_HEIGHT` 400, `TOP_DOWN_PITCH`), then left-drag pans, right-drag orbits/tilts, wheel
   dollies (`fly-rig.ts` — reused, not copied) — a pure vertical view makes objects impossible to
   tell apart, the tilt is what makes selection workable (user requirement). Determinism is about
   SCRIPTED shots, not about forbidding tilt: `?at=x,y` (GTA coords; default map centre `0,0`),
   `?h=` height, optional `?pitch=`/`?yaw=` fully specify the pose, and the camera NEVER moves on
   its own (no animated orbit — the blue-strip bisect was invalidated by orbit phase drift). Same
   params in → same pixels out; `?src=<url>` (served dir) makes it drivable by the headless
   harness.
5. **Search index from `MapDefinitions`**: catalog names + instances (name → placements).
   Autocomplete = case-insensitive substring over the catalog (tens of thousands of names — plain
   in-memory filter, no index structure). Centring picks the instance nearest the current camera
   (a name can be placed many times); repeated Enter cycles through the placements.
6. **Debugger half via the existing contract**: extend `MapGame` with optional
   `searchModels(query): { name, count }[]` and `focusModel(name): CellCoord | null` (centres the
   fly camera on the nearest placement, returns its cell so `MapInspector` adds it to the manual
   set). Host implementation over the adapter's `MapDefinitions`; both apps then share the same
   search UI component.

Not merged into `apps/viewer`: that app is plain-DOM, fed by the Node compare server, per-asset.
This one is React (debugger UI reuse), folder-fed, world-scale. User decision: a separate app.

## Phases (each lands with its measured numbers written back here)

- **Phase 0 — scaffold + resolve.** App skeleton (root-vite input `sa-map-viewer.html`, excluded
  from `build:prod` like `viewer.html`; `nx.tags: ['type:app']`); source screen: FSA folder picker
  + `?src=` served-dir; assemble the `AssetFileSystem`; run `resolveMap` + `buildWorldGrid(250)`.
  On screen: source name, instance/cell counts. *Verify:* counts for `game-src/original` logged
  here; boundary lint green.
- **Phase 1 — first cell renders.** Browser weld of one cell (planner → `encodeOstex`, weld →
  `encodeOscell`) → `engine.cells.load`; the map-viewer camera (decision 4: `snapTopDown` opening
  pose, pan/orbit/dolly by hand, `?at`/`?h`/`?pitch`/`?yaw` for scripted poses; the source-folder
  caption baked into the canvas overlay). **Boundary note:** the weld core sits in
  `tools/opensa-pack` (`type:tool`) which an app may not import — moving the Node-free weld/planner
  modules into an engine-tagged package (or an `engine-formats` sibling) is part of THIS phase, as
  a move-only refactor with opensa-pack re-importing from the new home. *Verify:* screenshot of a
  known cell vs the same cell in-game; weld time + texture bytes for one cell recorded here.
- **Phase 2 — the permanent panel.** `MapGame` driver (manual cells, weld cache, unload);
  `MapInspector` mounted as the fixed left panel; whole-map toggle and LOD mode working. Whole-map
  HD is allowed to be slow/heavy — it logs progress and its cost gets measured, not hidden.
  *Verify:* toggling cells loads/unloads; numbers: per-cell weld ms (median/worst), whole-map
  LOD-mode total time + memory.
- **Phase 3 — picking.** Weld writes the placement table; `debugPicking` on; click → `select` →
  the existing info panel (model/txd/pos); hide/restore via `CellStore.hidePlacement` if free.
  *Verify:* clicking a named blue-strip neighbour (`bealantr02_law2`) reports the right name.
- **Phase 4 — model search in sa-map-viewer.** Search field + autocomplete + centre&activate
  (decision 5); the search UI built as a shared component ready for the debugger half.
  *Verify:* searching `bealantr02` centres on (136,-1715) and activates its cell.
- **Phase 5 — model search in the opensa debugger.** `MapGame.searchModels`/`focusModel` host
  implementation over `GtaSaWorldAdapter`'s defs; the shared search field rendered in the Map
  screen when the viewer is active. *Verify:* in-game F2 → Map → search a model → camera centres,
  cell activates. Docs: `docs/development/in-game-tools.md` updated in the same change.
- **Phase 6 — field use + close-out.** Apply to the blue strip: load vanilla `game-src` vs the
  merged tree at `?at=150,-1700` and pixel-A/B the strip area — the first real bisect this tool
  exists for. Docs in the same change: `docs/commands.md` (launch), `docs/architecture` module map
  (new app), this plan's numbers complete.

## Scope cuts (deliberate)

- No water, no vehicles/peds, no collision overlay, no timed/night variants at first — static noon
  lighting, deterministic. Each is a later phase if the tool earns it.
- Interiors dropped (world-grid drops them already).
- No streaming rings — manual cells only; this is an inspector, not a game.
