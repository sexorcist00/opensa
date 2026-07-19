# 003 — game-shaped output: `--game` in, a game out

**Status: IN PROGRESS — phases 0-2 SHIPPED 2026-07-18; phase 3 step 1 (IMG delete-and-insert) SHIPPED
2026-07-19. Next: the runtime side — resolution order, local-loader ingest, the `txdp` walk.** Supersedes the output half
of [074/14](../../../../docs/plans/074-opensa-engine/14-pmb-integration.md); the pmb-stage half stays there.

Shipped so far: `--out` is a game-dir copy with products under `<out>/opensa/` (phase 1, commit `189d81b`);
the `.osm` container + baked `COLL` + the vehicle writer + BC1/BC3 per-model `.ostex` (phase 2, commits
`dc10ceb` · `4f9b64f` · `0d88b59` · `bea5554` · `71de581` · `a896334`). Nothing in the RUNTIME reads a
`.osm` yet — that is phase 3, and until then this is converter-side only.

opensa-pack is the odd tool in the chain. Every other tool takes `--game <dir>` and emits `--out <dir>`
that is a complete, bootable game dir (`tools/perfect-map-builder/src/pipeline.ts:138-152` — each stage
hands the next a full game tree). opensa-pack instead emits four loose files —
`world.ospak`, `manifest.json`, `water.bin`, `report.json` (`src/cli.ts:126-135`) — that only the engine
host and the lab know how to read, wired in through a symlink farm in `public/`.

This plan makes it behave like the rest of the chain: **`--out` is a copy of `--game`**, and everything we
convert into our format REPLACES its original inside the IMG archives. The VFS looks for our format first,
falls back to the stock asset, and warns when neither exists.

This is explicitly an **opensa-only build** — the real game cannot boot it, and it does not need to. The
chain already forks at the LOD stage (`pipeline.ts:171-185`): the `sa` target is the real-game build, the
`opensa` target is ours. opensa-pack is the final conversion of the `opensa` target and of nothing else.

## Terminology: optimized vs unoptimized models (user, 2026-07-18)

The chain has exactly two kinds of asset at runtime, and **it is a property of the ASSET, not of the
build** — both kinds coexist in the same session:

- **Optimized** — converted by opensa-pack into our format (`.osm`/`.ostex`), carrying every offline
  optimization we have: prepared buffers, resolved `txdp` chains, baked collision in engine shape,
  precomputed bounds. Loaded by reading a section. No RW parser runs.
- **Unoptimized** — a stock or modded `.dff`/`.txd` reached through the **current** runtime flow: parse,
  build, upload, at the moment it is needed. This is what a `modloader/` asset always is.

opensa-pack converts **everything in the IMG archives** — map objects, vehicles, peds — so a stock build is
100 % optimized. The unoptimized path exists for one reason: a user drops a mod into `modloader/`, and it
must work without a reconvert. That makes the RW parsers permanent runtime code, not legacy — they are the
unoptimized path's engine, and this plan must not weaken them.

It also settles a question this plan had left open: restoring the runtime `txdp` walk (constraint 4) is not
optional polish. It is the unoptimized path's texture resolution, and without it a modded TXD with a parent
silently loses textures.

## Why the output shape has to change

Three concrete costs of the current shape:

1. **The manifest carries data that also exists in the game dir, and the two drift.** The 2026-07-18
   black-night bug and the engine-vs-prod fog mismatch both traced to the host reading the PAK-BAKED
   timecyc copy instead of the live game file (`apps/web/src/ui/engine-canvas-host.tsx:256-271` now prefers
   the game and falls back to `setup.timecyc`). Every field the manifest carries that ALSO exists in the
   game dir is a future instance of that bug. If `--out` is a game dir, `data/timecyc.dat` is simply
   there — `manifest.timecyc` and `setup.timecyc` die with no replacement.
2. **The runtime still parses DFF.** Vehicles are built at SPAWN time from stock DFF bytes
   (`@opensa/renderware/vehicle/build-vehicle-model`, moved to a worker in plan 21 to hide ~170 ms
   new-car-type freezes). The freeze was hidden, not removed. An offline per-model format removes it.
3. **Two hosts, two loaders, one symlink farm.** `packages/engine/src/stream/setup.ts:30-35` and
   `apps/engine-lab/src/pak-loader.ts:20-26` duplicate the manifest fetch/validate; the paks live in
   `apps/engine-lab/public/` with root-level symlinks (`public/pak-ls`, `public/pak-map`, `public/ped`) as
   the sharing mechanism. Plan [078](../../../../docs/plans/078-viewers-lab-on-pmb-output.md) collapses
   that, and it needs this plan's output shape to collapse ONTO.

## The gap this plan has to close first

**There is no per-model native format today.** `.oscell`/`.ostex`/`.oswire`/`.ospak`
(`packages/engine-formats/src/`) are all WORLD-scoped: welded cells and shared texture arrays. Nothing in
the repo writes "one model, our format". The two probe CLIs that look like it —
`src/vehicle-probe.ts`, `src/ped-probe.ts` — bake single throwaway lab fixtures (`vehicle.json`+`.bin`,
`ped.json`+`.bin`) and are documented as such.

So "delete the dff, put our file in its place" is **new format work**, not a repackaging. Its scope is
every model in the archives — map objects, vehicles, peds — per the convert-everything decision above.
Static map geometry is ALSO still welded into cells: welding is the draw-call win and nothing replaces it;
the per-model `.osm` serves the by-name lookups (breakables, clutter, animated objects, script spawns).

## Design

### Output layout

```
<out>/                          ← byte-copy of <game>, then mutated in place
  data/…                        ← untouched: timecyc, water.dat, handling, gta.dat, IPL/IDE
  models/gta3.img               ← REBUILT: converted entries replaced, everything else passed through
  models/gta_int.img            ← same
  opensa/                       ← the world-scoped products (no 1:1 IMG entry exists for these)
    manifest.json               ← indexes OUR products only — see the manifest rule below
    cells/<x>_<y>.hd.oscell
    cells/<x>_<y>.lod.oscell
    textures/<ref>.ostex
    water.osw
```

**That block is the TARGET, not today.** As of phase 1 the products land in `<out>/opensa/` but keep their
current shape — `world.ospak` + `manifest.json` + `water.bin` + `report.json`. The split into named cell
and texture files is phase 4, and it is gated on the container-vs-files measurement.

Inside the IMG, per user decision 2026-07-18: **full replacement, own extension, same basename.**
`landstal.dff` → `landstal.osm`; `landstal.txd` → `landstal.ostex`. The original is DELETED. `EditableImg`
(`tools/tool-kit/src/archive/img.ts:13-26`) already has exactly this API — `delete(name)` + `set(name, data)`
— and `writeImgFile` (`img.ts:97`) streams the rebuild without doubling peak RSS, which is how
map-optimizer survives a ~1 GB archive (`tools/map-optimizer/src/adapters/gta-sa/build.ts:36`).

Extensions are deliberately visible in the archive listing: a file that says `.dff` but is not a DFF lies
to every other tool and to us.

### The manifest rule (user decision, 2026-07-18)

A manifest for OUR OWN auxiliary data is fine and stays — a browser cannot list a directory over HTTP, and
`cellSize`, the district bounds and a format version have to come from somewhere. The rule is about what it
may CARRY:

> **A manifest may index only what opensa-pack itself produced. It may never carry data that can be read
> directly from the game dir.**

So it keeps: format version, `cellSize`, cell bounds, the cell/texture/water entries with their offsets and
encodings. It loses: `timecyc` and `timecyc24` (read `data/timecyc_24h.dat` / `data/timecyc.dat` — the
engine host already prefers exactly that, `engine-canvas-host.tsx:260-261`), and anything else later
tempted in from `data/`. The `water` pointer stays, because the baked mesh is ours; `data/water.dat` stays
the fallback it already is.

Independently of the manifest, cells and textures should still be addressable by COMPUTED name
(`cells/12_-7.hd.oscell`, textures resolved from refs recorded in the cell that needs them). That is what
makes **per-ring texture laziness** — the standing post-flip lever, ~767 MB world-array boot — fall out of
the layout instead of needing its own pass. The manifest then indexes those files rather than being the
only way to find them.

### VFS resolution order

Per user spec, in the layer that resolves an asset by name (not in `Vfs` itself — `packages/vfs/src/vfs.ts`
is a flat name→bytes map by design, and the resolution belongs above it, next to
`packages/renderware/src/archive/asset-cache.ts:41-44`):

1. **modloader wins outright — as an UNOPTIMIZED asset.** If a mod ships the name, it is used and it goes
   through the current parse-at-runtime flow (user decision 2026-07-18). `packages/modloader/src/index.ts:71-73`
   already resolves by bare name before falling through; this makes it a stated rule. It is also the correct
   precedence: our optimized asset is the un-modded original, so a mod replacing it must beat it.
2. `<name>.osm` / `<name>.ostex` → **optimized**, section read, no RW parser touched.
3. `<name>.dff` / `<name>.txd` still in the archives → unoptimized. After a full convert this should be
   empty for models; it stays as the safety net and for anything a future converter skips.
4. neither → **console warning**, once per name, silenced by a game-config flag so it cannot spam.

One honesty note on rule 1: a runtime modloader override of a **welded map model** does not show, because
that geometry is baked into a cell. This is not new — mods enter the build at the mod-installer stage,
long before opensa-pack — but modloader-first makes it a question people will ask, so it belongs here.

The local loader must ingest our extensions too: `packages/loaders/src/asset-local-loader/build-vfs.ts`
selects entries by IDE-derived `.dff`/`.txd` names (`:61-76`) and would otherwise skip every converted
asset — the same class of bug as the procobj miss recorded in the memory
(`procObjModelRefs`, plan 19/20's blocker).

### CLI

`--game <dir>` + `--out <dir>`, resolved through `@opensa/tool-kit/cli` (`argValue`/`fromCwd`) instead of
the private `arg()` helper at `src/cli.ts:31` — opensa-pack is currently the only tool with no cwd-relative
path resolution. `--out` gets a `guardOut` equivalent (refuses root, refuses an `--out` that is or contains
`--game`; today only `mod-installer/src/install.ts:15-25` has one — promote it to tool-kit rather than
writing a fourth private copy).

`--rect` stops being required: absent means the whole map. Bake flags keep their 2026-07-17 defaults
(AO on, `--no-ao` to skip; sun-vis opt-in via `--bakes`).

## Non-goals

- **The real game must still boot `--out`.** It must not and will not. Any tool downstream of opensa-pack
  is out of the chain by construction.
- Re-deriving cells. The welding/baking pipeline (`src/convert.ts:104`) is not touched by this plan except
  where it writes its results.
- Compression format changes. `.oswire` + deflate-raw stay as they are.
- Peds/vehicles gaining new visual features. This is a format and IO plan; the pixels must not move.
- **Removing the RW parsers.** They ARE the unoptimized path. `parseDff`/`parseTxd`/`parseIfp`/`parseCol`
  stay, stay tested, and stay correct — a mod must work without a reconvert.
- `002-fetch-game-paks` (the hosted-pak question) — unblocked by this plan, still its own plan.

## Phase 0 results

### Manifest audit against the manifest rule

Fields are `OspakManifest` (`packages/engine-formats/src/ospak.ts:33-55`), produced at `src/convert.ts:236-240`.

| Field          | Origin                                        | Verdict                                                                                           |
| -------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `version`      | format constant                               | **keep**                                                                                          |
| `byteLength`   | pak size                                      | **keep** while a container exists; dies with it if phase 4 goes to loose files                    |
| `cellSize`     | converter choice (`--cell-size`, default 250) | **keep** — not derivable from the game; the welder picked it                                      |
| `cells`        | welded output                                 | **keep**                                                                                          |
| `textures`     | our texture arrays                            | **keep**                                                                                          |
| `uvAnimations` | extracted from DFF UVAnimDict plugins         | **keep** — the source DFFs are welded away, and cells index this array by slot, so it is ours now |
| `water`        | our baked mesh pointer                        | **keep** — the MESH is ours; `data/water.dat` remains the runtime fallback it already is          |
| `timecyc`      | verbatim `data/timecyc*.dat` text             | **DELETE** — rule violation, and the one that already bit us                                      |
| `timecyc24`    | which of the two files was found              | **DELETE** — same                                                                                 |

Two fields die. Their consumers, in the order they must be cut:

- producer `src/convert.ts:232-239`
- `packages/engine/src/stream/setup.ts:18-20` (the `StreamSetup.timecyc`/`timecyc24` fields) and `:111-112`
- `apps/web/src/ui/engine-canvas-host.tsx:262-266` — only the `setup.timecyc` FALLBACK branch goes; the live
  path (`:260-261`, `data/timecyc_24h.dat` → `data/timecyc.dat`) is already prod's exact preference and
  becomes the only path
- `apps/engine-lab/src/main.ts:535-536` — **ordering dependency**: the lab has no VFS today and reads
  timecyc exclusively from the manifest, so this field cannot be deleted until the lab reads a game dir
  ([078](../../../../docs/plans/078-viewers-lab-on-pmb-output.md) phases 1–2). 078 phase 2 and 003 phase 4
  are the same cut.

### Convert-everything dissolves the exclusion set — and creates a size question

An earlier draft of this plan had to compute an **exclusion set**: which DFFs may be deleted from the
archives, given that welded map geometry lives in cells but breakables, clutter, animated objects and
script spawns are still fetched by name. Getting that set wrong is a silent no-render of exactly the kind
that blocked plans 19/20 (the `procObjModelRefs` miss).

Converting **everything** removes that risk by construction: every by-name lookup finds an `.osm`, so
deletion is uniform and there is no set to get wrong. The by-name inventory below stays useful — it is now
the list of what must be TESTED after conversion, and the map of which classes need which `.osm` sections.

It does duplicate: a map object is welded into its cells AND kept as a per-model `.osm`. That is worth a
line in the ledger and nothing more:

- cells store geometry **per placed instance** (a model placed 50 times contributes 50 times), while the
  per-model catalogue is one copy per model — so the addition is a fraction of the welded world, not a
  doubling of it;
- a per-model `.osm` is fetched **lazily, by name**. One never requested costs no memory and no frame time.

So the cost is delivery size only. **Convert everything; record `--out` size and the per-model share in
phase 1.** If it ever becomes material, skipping per-model output for map objects with no by-name use is an
optimization with a known price — a much better position than guessing an exclusion set up front.

### The mixing rule

Optimization is per FILE, so a mod can produce a half-and-half asset: `modloader/` ships only a car's
`.txd` while the model is still our `.osm`.

**Decision (user, 2026-07-18): take the optimized side only, and warn.** A half-modded asset resolves to
our `.osm` + our `.ostex`; the lone modded file is ignored with a console warning naming it.

**The consequence, accepted 2026-07-18:** a retexture-only car mod — the most common kind of car mod there
is — does nothing but print a warning. The user weighed this and it is fine for now.

Recorded so a future reader does not have to rediscover it: supporting retexture mods later means **`.osm`
binding textures by NAME rather than baking indices into an atlas only its own `.ostex` can satisfy**, so a
runtime-parsed `.txd` can be bound instead. Cheap to design in, near-impossible to retrofit — so if that
day comes, expect a format revision, not a patch.

### By-name asset inventory (the exclusion set)

The cell-streaming worker (`packages/engine/src/stream/pak-worker.ts`) resolves nothing by name — it reads
`.ospak`/`.oscell` ranges only. That confirms the welded-map premise: everything below is what remains.

| Asset class                | Pattern built                                                                     | Call site                                               | Trigger                | Runtime parse                         |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------- | ------------------------------------- |
| Vehicle model              | `${def.model}.dff`                                                                | `gta-sa-world.adapter.ts:612`                           | **spawn**              | `parseDff` (worker)                   |
| Vehicle collision          | _same DFF bytes_                                                                  | `gta-sa-world.adapter.ts:619`                           | spawn                  | `parseDffCollision` (**main thread**) |
| Vehicle textures           | `${def.txd}.txd` → `models/generic/vehicle.txd`                                   | `gta-sa-world.adapter.ts:371-373`                       | spawn                  | `parseTxd` + DXT                      |
| Prop (topple) model + hull | `${modelName}.dff` via `getClump`                                                 | `engine-props.ts:69`, `:187`                            | collision event        | `parseDff`                            |
| Clutter species            | `${modelName}.dff` via `getClump`                                                 | `engine-clutter.ts:34`                                  | cell stream-in         | `parseDff`                            |
| Animated map objects       | `${modelName}.dff` via `getClump`                                                 | `engine-anim-objects.ts:79`                             | first spawn in range   | `parseDff`                            |
| Breakable shatter mesh     | `${modelName}.dff` via `getBreakable`                                             | `renderware/src/breakable/mesh.ts:49`                   | break + collider build | `parseDff`                            |
| IFP clips (anim objects)   | `${ifpName}.ifp`                                                                  | `asset-cache.ts:57`                                     | anim-object build      | `parseIfp`                            |
| Per-class texture dicts    | `${txdName}.txd`                                                                  | props `:70`, clutter `:35`, anim `:83`, debris `:134`   | with the model         | `parseTxd`                            |
| Corona + water sprites     | `models/particle.txd` (literal)                                                   | `engine-particles.ts:47`, `engine-canvas-host.tsx:1127` | **boot**               | `parseTxd` ×3                         |
| FX atlas + library         | `models/effectspc.txd` → `models/effectsPC.txd`, `models/effects.fxp`             | `engine-particles.ts:67-68`                             | boot                   | `parseTxd` / `parseFxp`               |
| Collision libraries        | **suffix sweep**, not by name                                                     | `collision-index.ts:32-38`                              | first collider call    | `parseColLibrary` over EVERY `.col`   |
| World data + text          | `data/*.dat/.ide/.cfg`, IPL streams, `text/american.gxt`, `data/paths/nodes*.dat` | `resolve-map.ts`, adapter, host                         | boot                   | text/binary, no RW                    |

Everything in that table survives in `--out`. Everything else in the archives is welded-only and may go.

### Four design constraints this surfaced

1. **The collision index is an enumeration, not a lookup.** `collision-index.ts:32-38` scans `archive.names`
   for the `.col` suffix and parses **every** library on first use, on the main thread. We are not
   converting COL, so the contract holds — archive deletion must not disturb `.col` entries and any naming
   scheme must leave the suffix sweep intact.

   **Open, measured question (user raised it 2026-07-18):** putting collision INTO the model file does not
   remove this sweep, because cell colliders are needed for welded models that will never have an `.osm`.
   The only thing that removes it is baking colliders into the CELL offline — after which `.col` could be
   dropped from the archives entirely. That is a bigger change than this plan, and its value is unknown
   until we measure what the sweep actually costs (first-collider-call ms, and how much of it is libraries
   nothing in the district references). **Measure first, in phase 1; decide after.**

2. **The modloader hardcodes the extension list.** `packages/modloader/src/scan.ts:63-66` knows
   `.dff`/`.txd`/`.col`/`.ifp`; `index.ts:71-73` resolves by BARE name first, so a mod's `particle.txd`
   shadows `models/particle.txd`. `.osm`/`.ostex` must join that list, or mods silently stop overriding
   converted assets — and a mod DFF must be able to shadow our `.osm`, which is the resolution order doing
   its job.
3. **The vehicle DFF is consumed twice** — transferred to the worker for the model
   (`gta-sa-world.adapter.ts:377-381`) and parsed on the MAIN thread for collision (`:619`).
   **Resolved: `.osm` is SECTIONED** — a small header/offset table, then independent sections (model,
   collision, and whatever later classes need). The main thread reads the collision section without
   touching geometry; the model section is transferred to the worker as today. No round-trip, no double
   parse, and `parseDffCollision` at spawn becomes a struct read. This also answers "should collision live
   in the model file": for vehicles it already does (an embedded COL chunk), and the sectioned layout keeps
   that property while making it cheap to address.
4. **`txdp` parent chains are resolved OFFLINE, and that is the model for `.ostex`.** `asset-cache.ts:36-38`
   and `:74-85` are orphaned doc comments — `getTextures`, `setTxdParents`, `ownTextures` have no
   implementation left, and `MapDefinitions.txdParents` is still built (`resolve-map.ts:60,73,106`) and read
   by **nobody at runtime**. It is not a live bug, because the consumer that matters survived on the
   converter side: `TexturePlanner` walks the chain at weld time (`src/textures.ts:246`, fed at
   `convert.ts:117`), so welded map geometry gets its inherited textures baked in.

   **Decision (user, 2026-07-18): fix it, both sides.**
   - `.ostex` stays **FLAT** — the converter resolves the chain at build time, so nothing we produce needs a
     runtime walk.
   - The **runtime walk is restored** for the fallback path. Offline flattening only covers what we
     converted; a stock or modded `.txd` reached through resolution step 3 still needs its `txdp` parent,
     and today it silently loses those textures. `MapDefinitions.txdParents` is already built and carried
     (`resolve-map.ts:60,73,106`) — it just has no consumer. Re-implement `getTextures`/`setTxdParents`
     (the deleted machinery the `asset-cache.ts:36-38,74-85` comments still describe), wire it into the six
     bare-name TXD call sites (rows 4-8 of the inventory), and cover it with a test built from a real
     `txdp` case — mod-installer's HD-swap mod emits exactly one.

   Live impact today is probably nil (the HD-swap mod targets map models, which weld offline), which is
   why it went unnoticed — but it is a latent hole that opens the moment a mod parents a vehicle or prop
   TXD, and it is cheap to close.

### Two findings that belong to plan 078

- **The player ped never touches the VFS.** `apps/web/src/ui/engine-player.ts:54-56` fetches
  `/ped/ped.json` + `/ped/ped.bin` — the probe fixture — over HTTP, in the PRODUCTION host, not just the
  lab. `buildPedModel` exists and is reachable only from `apps/viewer`. So retiring the ped fixture is a
  production change, not a lab change, and it lands with 078.
- **`particle.txd` is fetched and fully re-parsed three times** at boot (coronas, ripple, foam) with no
  cache. Free win, noted so it is not lost.

## Phases

**Phase 0 — decisions + inventory.** Fix the extension names; enumerate every asset class the runtime
resolves BY NAME (vehicles, peds, clutter, breakables, particle/font TXDs) with the call site for each;
audit the current manifest field-by-field against the manifest rule. Deliverable: two tables in this plan,
no code.

**Phase 1 — IO rework, same products.** `--game`/`--out` via tool-kit, full copy, `guardOut`, IMG rebuild
via `writeImgFile`, world products under `<out>/opensa/`. Manifest still written, still read by both hosts.
Nothing visual changes; the ritual 6-scene sweep must stay flat. This phase is reversible on its own.

**Phase 2 — the `.osm`/`.ostex` per-model format.** Format spec in `packages/engine-formats/` next to
`oscell.ts`, with round-trip tests. Writer reuses `buildVehicleModel` offline (it is already
browser-and-node callable, which is why the probe CLI is thin). Vehicles first — they have the builder, the
fixtures, and the measured spawn cost.

**Phase 3 — IMG replacement + VFS order.** Delete-and-insert in the archives; the 3-step resolution with
the once-per-name warning and its config flag; local-loader ingest. Gate: a converted vehicle spawns with
NO DFF parse (assert the parser is never entered) and the plan-21 spawn measurement improves.

**Phase 4 — the world products move to `<out>/opensa/`.** Cells and textures become named files, textures
load per ring on demand, `world.ospak` dissolves into them, the manifest shrinks to the manifest rule
(`timecyc`/`timecyc24` deleted, `setup.timecyc` with them), and `setup.ts` + `pak-loader.ts` collapse into
one loader. **Measured gate:** boot time and steady-state must not regress against the ospak baseline —
many small files vs one range-read container is a real trade, decided by measurement, not by taste. If the
numbers say container, the container stays and only the manifest rule and the `opensa/` location apply.

**Phase 5 — the rest of the archives**: peds, clutter, breakables, animated objects, map objects. At the
end of this phase a stock build is 100 % optimized and the `.dff`/`.txd` entries are gone from the IMGs.

**The PLAYER ped lands here** (user decision 2026-07-18, not in 078): `apps/web/src/ui/engine-player.ts:54-56`
fetches `/ped/ped.json` + `/ped/ped.bin` — the probe fixture — in the **production** host, so moving it to a
by-name VFS load is a production change and needs its own field check, not just a green suite.
The lab stops having a private ped/vehicle fixture format here — it loads peds and cars by name through the
VFS like the game and the viewers (plan [078](../../../../docs/plans/078-viewers-lab-on-pmb-output.md)), so
`ped-probe.ts` / `vehicle-probe.ts` and `ped.bin` / `vehicle.bin` retire.

**Phase 5b — the unoptimized path proves itself.** Drop a real car mod (`.dff` + `.txd`) into `modloader/`
against a fully converted build and confirm it renders through the runtime flow, including a
**retexture-only** mod (the mixing rule) and a `txdp`-parented one (constraint 4). This is the phase that
says whether "optimized/unoptimized" is a real contract or just a diagram.

**Phase 6 — pmb stage.** `'pack'` joins `STAGE_NAMES` (`pipeline.ts:32`) and the `--until` docs
(`perfect-map-builder/src/cli.ts:8`), running on the `opensa` target AFTER `swapLinearTxds`
(`pipeline.ts:178-185`) and before the `linear-txd` cleanup — the LOD build is the last thing that mutates
the game dir, and `swapLinearTxds` rewrites the texels the pak must carry. Config in pmb, no CLI flags on
the pipeline path.

## Tasks

- [x] Phase 0 — manifest field audit (2 fields die: `timecyc`, `timecyc24`)
- [x] Phase 0 — by-name asset inventory = the archive-deletion exclusion set + 4 design constraints
- [x] Phase 0 — extensions fixed as `.osm` (model, SECTIONED) / `.ostex` (texture dict, FLAT)
- [x] Phase 0 — resolution order settled: modloader → `.osm`/`.ostex` → `.dff`/`.txd` → warn
- [ ] Phase 1 — measure the `.col` sweep (first-collider-call ms, unreferenced-library share) before
      deciding on offline cell colliders
- [ ] Phase 3 — restore the runtime `txdp` walk for the fallback path (`getTextures`/`setTxdParents`,
      six call sites, test from a real `txdp` case)
- [x] Phase 1 — `--game`/`--out` via `@opensa/tool-kit/cli` (+ `requireDir`); `guardOut` + `copyGameDir`
      promoted to `@opensa/tool-kit/game-dir` with tests
- [x] Phase 1 — full game-dir copy; world products under `<out>/opensa/`
      (**IMG rebuild deferred to phase 3** — with nothing yet replacing archive entries, rebuilding would be
      churn; `cpSync` carries the archives through untouched)
- [ ] Phase 1 — measure the `.col` sweep (see ledger)
- [x] Phase 2 — `.osm` container in `packages/engine-formats/src/osm.ts` + round-trip tests (9)
- [x] Phase 2 — **no new texture format**: a model's dictionary is an existing `.ostex` beside it
      (`.ost` would have collided with `.ostex`'s own `'OST1'` magic — the reuse was there all along)
- [x] Phase 2 — `COLL` section codec (`osm-collision.ts`): engine-shape collision, faces already flattened
      into indices, half-extents from the COL bounds — the whole main-thread spawn sequence, baked
- [x] Phase 2 — offline vehicle writer (`tools/opensa-pack/src/vehicle-osm.ts`) reusing `buildVehicleModel`
- [x] Phase 2 — per-model `.ostex` emission (`model-ostex.ts`) + `packOstexPayload` extracted so world and
      per-model layers share one row-packing
- [ ] Phase 2 — decide the texture-compression question (RGBA8 vs BC re-encode vs DXT pass-through)
- [x] Phase 3 step 1 — IMG delete-and-insert (`archive-edit.ts` + `pack-vehicles.ts`, wired in `cli.ts`
      behind a default-on `--no-models` opt-out); vehicles only, phase 5 adds the rest of the classes
- [x] Phase 3 step 2 — the RUNTIME reads `.osm`/`.ostex`: resolution order in `loadOptimizedVehicle`, the
      mixing-rule warning (de-duplicated, surfaced via `onAssetWarning`), `.osm`/`.ostex` in the modloader
      allow-list, `readVehicleOsm` (the missing inverse of `packVehicleFixture`), and a COMPRESSED model
      texture path in the engine (`core/ostex-upload`, `ModelTextureInit` union)
- [x] Phase 3 step 3 — local-loader ingest: `partitionEntries` prefers `<base>.osm` and pulls the
      MODEL-named `<base>.ostex` with it; `looseGroup` routes both. Everything downstream
      (`filesForGroup`, `readEntry`) was already extension-agnostic.
- [ ] Phase 4 — named cell/texture files under `<out>/opensa/`, per-ring texture laziness, one loader
- [ ] Phase 4 — manifest shrunk to the rule; `timecyc`/`timecyc24`/`setup.timecyc` deleted
- [ ] Phase 2 — mixing rule: half-modded asset resolves optimized-only, warning names the ignored file
- [ ] Phase 5 — peds, clutter, breakables, anim objects, map objects; probe CLIs + fixtures retired
- [ ] Phase 5 — map-object textures must PRESERVE map-optimizer's mip chain: plan from the RAW TXD, never
      regenerate (the per-model writer emits one level, which is right for vehicles/peds only)
- [ ] Phase 5b — mod field check: plain, retexture-only, and `txdp`-parented mods on a converted build
- [ ] Phase 6 — pmb `pack` stage + `--until` docs
- [ ] Close-out — 6-scene ritual sweep, `npm run lint`, coverage floors held, docs repointed

## Measurement ledger

**Phase 1 (2026-07-18)** — one-cell smoke convert, `--game game-src/non-modified --rect 9,-7,9,-7 --no-ao`:

| Measure                      | Value                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------- |
| game dir copy (1.4 GB, APFS) | **1.2 s** — clone-on-write; not a cost worth engineering around                   |
| `--out` size vs `--game`     | 1.4 GB vs 1.4 GB + 9.2 MB of products                                             |
| convert wall-clock           | 3.3 s total (1 cell, no bakes)                                                    |
| products written             | `opensa/{world.ospak 6.1 MB, manifest.json 98 KB, water.bin 2.5 MB, report.json}` |
| game files after             | `data/gta.dat`, `models/gta3.img` present and untouched                           |

**Phase 2 (2026-07-18)** — `buildVehicleOsm` over `game-src/non-modified`, offline build cost per model:

| Model      | `.osm` | build | geometry                          | baked collision                              |
| ---------- | ------ | ----- | --------------------------------- | -------------------------------------------- |
| `landstal` | 274 KB | 32 ms | 5 130 v / 3 613 t / 123 submeshes | 18 spheres, 10 tris, half [1.16, 2.56, 0.82] |
| `infernus` | 236 KB | 12 ms | 4 467 v / 3 822 t / 76 submeshes  | 20 spheres, 14 tris, half [1.20, 2.89, 0.69] |
| `bmyri`    | 55 KB  | 4 ms  | 963 v / 1 179 t / 1 submesh       | **fallback box** (no COL in the DFF)         |

**Phase 3 step 1 (2026-07-19)** — the whole vehicle roster converted INTO the copied archives, same
one-cell smoke command (`--game game-src/non-modified --rect 9,-7,9,-7 --no-ao`):

| Measure                     | Value                                                                        |
| --------------------------- | ---------------------------------------------------------------------------- |
| cars converted              | **201 / 201**, 0 failed, 0 TXDs held back                                    |
| `.osm` total                | **41.8 MB** (~213 KB/car)                                                    |
| `.ostex` total              | **153.0 MB** (~779 KB/car — BC1/BC3)                                         |
| archive edit                | `gta3.img` +402 −402 entries; 0 unplaced, 0 missing deletes                  |
| `gta3.img` after            | 897 MB → **1 048 MB** (the `.dff`/`.txd` out, `.osm`/`.ostex` in)            |
| archive rewrite wall-clock  | **18.2 s** (build 201 models + stream a 1 GB rebuild)                        |
| total convert wall-clock    | 3.3 s → **21.2 s** — hence `--no-models` for world-only iteration reconverts |
| peak RSS                    | **2.04 GB** — the streamed rebuild holds one 1 GB source buffer, not two     |
| `.col` entries after        | **216, untouched** (design constraint 1 holds)                               |
| `.dff` remaining            | 12 766 — map objects and peds, i.e. phase 5's work                           |
| `landstal.osm` round-trip   | DESC 5 130 v / 10 839 idx · COLL 14 v / 10 tris / half [1.16, 2.56, 0.82]    |
| `landstal.ostex` round-trip | BC3, 256×256, 14 layers                                                      |

**Found by this step — a latent parser bug, still live for any un-patched install.** The FIRST run
converted only 198/201: stock `vehicles.ide` rows 585/586/593 (`emperor`, `wayfarer`, `dodo`) are missing
the comma between `model` and `txd` — `585,\temperor\t\temperor, \tcar, …`. `parseVehicleDefs` splits on
commas only, so `def.model` became `"emperor\t\temperor"`, which also means those three **cannot spawn in
the engine** on stock data (`gta-sa-world.adapter.ts:608` throws "No vehicle definition"). SA's own parser
is whitespace-tolerant; ours is not.

The user patched the commas into `game-src/non-modified`, and the numbers above are the re-run. **The
parser is still comma-only** — a fresh game dir reproduces this. Widening the row splitter is its own
change (it is shared by every IDE section), so it stays recorded, not fixed.

The failed run also proved the TXD guard: it held back exactly `car`, `bike`, `plane` — the mis-parsed
`type` column of the three broken rows — so nothing was deleted on a bad def's behalf.

**Phase 3 step 2 (2026-07-19)** — the runtime side. No numbers to report yet (the field measurement of the
spawn path is owed); what it settled instead:

- **The engine could not accept a compressed model texture at all.** `createVehicleModel` hardcoded
  `rgba8unorm-srgb` + `bytesPerRow: width * 4`. The world had the right path all along
  (`TextureArrays.load`), so it was extracted to `core/ostex-upload` and both now share it. BC1/BC3 reaches
  video memory untouched — pinned by a test at 128×128: **16 384 B/layer vs 65 536 B for RGBA8**. (First
  version of that test used 4×4 and proved nothing: `bytesPerRow` pads to 256, which swamps the payload.)
- **Resolution order is implemented `.dff`-FIRST**, which reads backwards until you see why: conversion
  DELETES `<model>.dff`, so afterwards only a `modloader/` override can still answer with one. There is no
  API to ask the VFS where a name came from, so this ordering IS the modloader-wins rule.
- `EngineVehicleData.model` is now the engine-ready `RigidModelInit` — both paths converge inside the
  adapter, and `engine-vehicles.ts` lost its inline copy of `toRigidModelInit`. The articulation the handle
  animates moved to a narrow `VehicleRigData` (`Pick` of the 5 fields), which the DFF build and the `.osm`
  fixture both satisfy structurally.
- **`packages/game` prints nothing** (the package has no `console` by design), so the warning leaves via
  `onAssetWarning` and the host prints it. De-duplication stays in the adapter — these fire on a spawn path.
- The phase gate lives in `tools/opensa-pack/src/vehicle-osm.test.ts`, not in the adapter's own integration
  test: it needs the WRITER, and the nx boundary forbids `type:engine` → `type:tool`. Correctly so.
- Gate result: a converted `admiral` spawns with **no `.dff` present at all**, and optimized vs unoptimized
  agree on positions, submeshes, half-extents, handling, seat, wheels and collision vertices. The wheel
  RADIUS initially disagreed — a lie in my fixture (hardcoded `wheelScale`), not a product bug; the test now
  reads the def exactly as `packVehicles` does.

**Phase 3 step 3 (2026-07-19)** — the browser local loader. One decision worth keeping:

> **A converted model's dictionary is named after the MODEL, not after the IDE's `txd` column.**

Several models share one stock `.txd`, but a converted model indexes its OWN baked atlas by layer index, so
`<base>.osm` is only meaningful beside `<base>.ostex`. The selection therefore pulls the `.ostex` from the
MODEL loop, not from the txd loop — and the txd loop still runs, because a shared dictionary must survive
for whatever stayed unoptimized (covered by a test where `house` is converted and `shed` is not).

Nothing else needed changing: `filesForGroup`/`readEntry` never looked at extensions. Only `partitionEntries`
and `looseGroup` did.

### Mips belong to map-optimizer (user, 2026-07-18)

opensa-pack must **never generate** a mip chain: map-optimizer authors them upstream, and a second
generator downstream would silently overwrite its work. Measured on both inputs:

| Input                                       | map textures with a chain | deepest |
| ------------------------------------------- | ------------------------- | ------- |
| `game-src/non-modified` (raw game)          | 23 / 1 177 — **2 %**      | 9       |
| `NO_COMMIT/optimized` (after map-optimizer) | 646 / 1 215 — **53 %**    | 11      |

**opensa-pack's production input is the chain output, after map-optimizer** (confirmed by the user) — so
the raw-game survey that suggested "SA has no mips" was measuring the wrong thing. In game the rule is:
map objects MUST have mips, vehicles must not, peds almost certainly not.

Consequence for the per-model writer: it emits ONE level, which is correct for vehicles and peds and is
**not yet correct for map objects** (phase 5). Those must PRESERVE what map-optimizer put in the TXD, and
this entry point structurally cannot — `VehicleTextures` decodes level 0 and drops the rest before the
writer sees the array. The map-object path has to plan from the RAW TXD, the way the world planner does
(`textures.ts:184-193`). Recorded as a phase-5 task rather than a flag, because a flag we cannot honour is
worse than no flag.

**Per-model `.ostex` (same day)** — and it surfaced a real cost:

| Model      | `.osm` | `.ostex`     | build | texture array                         |
| ---------- | ------ | ------------ | ----- | ------------------------------------- |
| `landstal` | 274 KB | **4 925 KB** | 44 ms | 14 layers @256², 9 mips, 3 with alpha |
| `infernus` | 236 KB | **5 980 KB** | 37 ms | 17 layers @256²                       |
| `cheetah`  | 206 KB | **5 276 KB** | 42 ms | 15 layers @256²                       |

**The textures are ~20× the model.** Cause: `buildVehicleModel` hands back RGBA8 — `VehicleTextures`
decoded the source DXT to feed the runtime — so the `.ostex` stores uncompressed texels plus a full mip
chain, where the source TXD was BC-compressed. At ~5 MB × ~210 vehicles that is ~1 GB against a 940 MB
`gta3.img`: converting cars alone would roughly double the build.

Note what it does NOT cost: VRAM. The runtime already uploads these as RGBA today, so this is a
delivery/disk regression only. Three ways out, none picked yet:

1. **Accept RGBA8** — simplest, and honest about what the runtime consumes; the build roughly doubles.
2. **Re-encode to BC** — an encoder exists (`tools/rw-codec/src/dxt-encode.ts`, used by the LOD tools), but
   decode→re-encode is generation loss on art we did not author.
3. **Pass the original DXT through** — what the WORLD planner already does for opaque, well-formed DXT
   (`textures.ts:184-193`): no loss, smaller on disk AND in VRAM. Costs planning from the raw TXD rather
   than from the built array, because the builder has already decoded by the time we see it.

**Decided (user, 2026-07-18): BC — size wins.** Option (3) did not survive the data: 85 % of vehicle TXDs
mix formats or sizes inside one dictionary, and `.ostex` carries one format for the whole array, so
pass-through would mean SEVERAL arrays per model — a runtime contract change, because a model's vertices
index one array through `meta.x`.

So the per-model writer re-encodes: **BC1 when every layer is opaque, BC3 when any layer needs alpha**
(in practice cars are always BC3 — glass and lamps). Measured after the change:

| Model      | `.osm` | `.ostex` | format | build  |
| ---------- | ------ | -------- | ------ | ------ |
| `landstal` | 274 KB | 896 KB   | BC3    | 170 ms |
| `infernus` | 236 KB | 1 088 KB | BC3    | 127 ms |
| `cheetah`  | 208 KB | 960 KB   | BC3    | 115 ms |
| `bullet`   | 267 KB | 832 KB   | BC3    | 85 ms  |

**4.07 → 1.16 MB per car; ~0.83 → ~0.24 GB across ~210 vehicles.** Build cost rose ~44 → ~120 ms per car
(the DXT encode), i.e. roughly 30 s added to a full-vehicle convert.

The generation loss was measured, not assumed: re-encoding the builder's RGBA through DXT5 costs a **mean
absolute error of ~1/255 (0.4 %)** per channel, worst single layer 2.8/255, max single-texel 90 (a lone
hard alpha edge). That is the expected cost of one BC round trip on already-DXT source art.

`bmyri` is a PED that the vehicle builder accepted without complaint — the writer does not check the asset
class, which is fine while callers pass a `vehicles.ide` roster but must not be relied on in phase 5.

Still owed for phase 1: the `.col` sweep measurement (first-collider-call ms + unreferenced-library share) —
it needs runtime instrumentation, not a converter run.

Later phases record: IMG rebuild peak RSS, per-model `.osm` share of `--out`, the split spawn-path numbers
below, and boot/steady-state for the phase-4 container-vs-files gate.

Spawn-path numbers to capture BEFORE phase 2 changes anything, split by thread — the two are not the same
size and must not be reported as one:

- **main thread**, per new vehicle type: `parseDffCollision` + `toModelColliders` + `halfExtents`
  (`gta-sa-world.adapter.ts:612-632`). Expected small in absolute ms, but it lands on the frame thread.
- **worker**, per new vehicle type: `parseDff` + `parseTxd`/DXT + `buildVehicleModel` — the ~170 ms that
  plan 21 hid rather than removed. This is what `.osm` actually deletes.
- **first-collider call**: the whole-archive `.col` sweep (`collision-index.ts:32-38`), plus what share of
  the parsed libraries the district never references — the input to the offline-cell-collider decision.
