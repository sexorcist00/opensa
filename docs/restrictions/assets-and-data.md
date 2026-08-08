# Asset & data restrictions

**Every slot in this game is a mod target.** Today a model sits on `comet`, tomorrow on `admiral`; today a
texture is 256², tomorrow a mod ships it at 2048². A rule that names a slot, or a size, or a car, is a rule
that will be wrong in the next build.

## A rule must derive from what the asset CARRIES, never from the slot it sits in

Never hardcode a value for a specific car, model or asset. The rule has to read the asset itself — its
handling row, its geometry, its collision — so it applies to whatever ends up in the slot.

The worked example: when a car stood on its bump stops, the fix was **not** "stiffen that car" but "static
sag may not exceed a share of the travel the car actually has" — a rule that touched only the car violating
it. Pop-up headlights are the same shape: derived from the model (a `misc_*` part holding head-lamp faces,
opening angle from the mean normal), not from a per-car list. 49 stock misc models → 1 hit.

**Caught:** no. A hardcoded name works perfectly until someone swaps the mod.

## A per-asset decision cached by CONTENT may not depend on its caller

`TexturePlanner` dedups textures by content hash and plans each one on FIRST use. Any decision the caller
supplies — plan 092's vegetation `preferCutout` was the live case — is therefore taken by whichever caller
the build happened to reach first, and every later caller silently inherits it. 38 of the map's TXDs are
shared between vegetation and non-vegetation defs, so this was not theoretical.

The rule for a new design: a cached per-asset verdict is either a pure function of the asset's bytes, or the
caller's preference is part of the CACHE KEY. Never a third thing.

**Caught:** no — the output is a plausible class, just the other one, and only on the machines where the
build order differs.

## A geometry's DRAWN topology is its BinMesh index data, not its face array

A DFF stores its triangles twice: the Geometry Struct's face array (authoring input) and the BinMeshPLG
index data (what RenderWare submits). **They are allowed to disagree**, and when they do, only the second
one is what the game shows. Any new code that reads or rewrites geometry — a converter stage, an exporter, a
mesh tool — must treat the index data as the truth and the face array as a hint.

`0. Map Fixes Pack`'s `roads32_law2` has its 65 road triangles up-facing in the index data and down-facing
in the face array. Reading the array turned the beach lane's slab inside-out, single-sided culling deleted
it, and the result read as a flat light-blue hole with working collision — three sessions of probes that all
came back "the data is equivalent", because it is. Scale: 4 models in the merged original map
(`scripts/debug/scan-geometry-parity.ts`, Family C). Details in
[`plans/095-dff-geometry-parity`](../plans/095-dff-geometry-parity/readme.md); the ADC (`0x134`) strips of
stock `bloodrb`/`rccam` are the one exception, since their parity bits are undecoded.

**Caught:** no. The model renders, faces the wrong way, and vanishes only where culling is on — and both
arrays describe the same triangle SET, so every count, bbox and checksum agrees.

## A simple map model's own frame transform is dead data

`CFileLoader::LoadAtomicFile` → `SetRelatedModelInfoCB` ends with `RpAtomicSetFrame(atomic, RwFrameCreate())`:
every atomic of an `objs`/`tobj` model gets a FRESH identity frame, so whatever transform the DFF's frame
carried is discarded before anything renders. Only a CLUMP model (`anim` IDE entries, peds, vehicles —
`LoadClumpFile`) keeps its hierarchy. A new design may not "just apply the frame chain": it has to know
which of the two loaders SA would have used.

We applied it to everything, which rotated a mod's `land_42_sfw` 90° and had been sinking 165 vanilla
`aw_streettree1` 3.1 m into the ground since the welder was written. The oracle when in doubt is the **COL**:
it is authored in the space SA renders, so the version whose bounds match it is the truth (8 models, residual
6.8–43.5 with the frame vs 0.00–0.82 without).

**Caught:** no — and worse than silent: for a near-square asset like a terrain tile the bbox barely moves, so
`model-bbox` and the pak's own bounds check both pass while the geometry is turned.

## A dictionary is not a material list

A model's TXD serves several models. "This dictionary contains a glass texture" says nothing about whether
THIS model draws it — plan 092's first glass field-control was picked that way and turned out to have
painted-on OPAQUE windows (`marinawindow1_256`, no alpha channel at all). Read the DFF's materials
(`scripts/debug/dump-dff-materials.ts`), not the dictionary's contents.

**Caught:** no — you get a real model, a real texture and a wrong conclusion.

## Every model class that builds a PRIVATE dictionary must be handed `forceRgba8`

`--rgba8` is not one switch — each by-name class (`pack-vehicles`, `pack-clutter`, `pack-anim-objects`,
`pack-peds`, `pack-props`) builds its own dictionary through `buildModelOsm`, and `model-ostex` picks **BC**
for any block-aligned dictionary unless the flag reaches it. Map objects are the exception: they plan into
the shared WORLD dictionary and inherit its format. So a new class that forgets the option makes a pak the
world half of which is mobile-clean while its models demand a feature no mobile GPU carries.

This is exactly what happened: `pack-props.ts` was the one class the 2026-08-04 change
(`--rgba8 now converts the MODEL dictionaries too`) missed, and it stayed wrong until a full-models phone
convert hit it — `world [nothing], models [texture-compression-bc]`.

**Caught:** yes, but LATE and only if you ask — `--platforms mobile` fails the pack, and it runs at the very
END of the convert. On a phone that is the whole convert paid for before the error, which is why the rule is
here rather than left to the check. Without `--platforms` the pack only *reports* the demand in one log line
and `report.json`.

## Texture sizes are asset-driven

Never hardcode a size that belongs to a source asset. Texture arrays derive their size from `max(assets)`;
fixed slots resample rather than throw.

**Caught:** partly — a mismatch usually shows as a visibly wrong texture, not an error.

## Dig out the original game's real formula before fitting a constant

The reversed SA source (`docs/links.md` → gta-reversed) carries the actual data→physics mapping, and it is
**greppable offline**: `curl -sS https://raw.githubusercontent.com/gta-reversed/gta-reversed/master/source/game_sa/<path>`
then grep it. WebFetch summarises and LOSES detail; curl+grep settled both `CollapseFramesCB` and the
misc-component question in minutes.

A fitted constant is acceptable only as a MEASURED, documented bridge — state what was fitted, over what
range, and its residual — and **it is a debt, not an answer**: it gets a file in [`hacks/`](../hacks/) in the
same change. The same goes for global tuning constants; each one is a place where the game's own numbers are
not being read yet.

**Caught:** no — this is a review discipline, and the hacks ledger is its only record.

## Judge a mod's 2dfx by `extract2dfxEntries`, never by `geometry.lights`

`lights` holds only type-0 entries. A count taken from it is silently short.

**Caught:** no.

## `.osm` indices are BYTES

Decode by `index16` or every number belongs to somebody else. This mis-read already produced one wrong
verdict (`scripts/debug/dump-vehicle-materials.ts` carries the warning).

**Caught:** no — you get plausible numbers for the wrong submeshes.

## A name that carries behaviour must be in `contracts/`

A file the pipeline looks for, a frame or material the converter reads, a data row a tool writes — a mod
author cannot guess these and a reader cannot grep for them. Misspelling one is **silent by nature**, so the
contract must also say what happens when it is spelled wrong. New conventions extend
[`contracts/vehicles.md`](../contracts/vehicles.md) / [`contracts/mods.md`](../contracts/mods.md) in the same
change.

The live example of the failure: `mod-installer` recognises IMG folders only at the TOP level and only by
exact name — `models/gta3img/` is copied as loose files the game never reads, and **the mod is silently
inert**, with no error and no report line.

**Caught:** no, by construction.

## A feature built on `data/Paths` exists only for `original`

The vehicle path graph (`NODES0..63.DAT`) is stock-SA content: `game-src/original` ships 73 files, and
`anderius`, `gostown` and `carcer` ship **none**. Anything derived from it — road traffic, the 096 video
mode's autopilot, any "drive somewhere" scripting — has no data at all on a total conversion, and the build
faithfully mirrors that absence (`copyGameDir` copies the tree as-is, it does not invent one).

A design that needs the graph must state what it does when the variant has none, and that path must be
reachable — `loadRouteGraph` returns `null`, and the caller decides whether the feature disables itself or
falls back. Measured 2026-07-30 (096/01).

**Caught:** no — the loader simply finds zero areas, and a feature that does not check reads an empty world
as "no roads here" rather than "this game has no road graph".

## The node graph says WHERE roads are, not how they may be driven

Two things a design over `NODES*.DAT` may not assume it can read out of the graph, both measured in 096:

- **Travel direction.** The link table is 100 % mutual — **0 one-way links in 30 587 vehicle nodes** — because
  SA keeps lanes in the navi nodes we do not parse. A route walked from this data can run a one-way street
  backwards, and no check anywhere will object (096/01).
- **Gradient.** A node carries a position, not a grade, and the route builder's constraints are all planar
  (turn angle, corner radius, region). A route may therefore start on, or climb, a slope the chosen car
  cannot take: 096/02's headless run started a scene on an **18° Los Santos hill** where the `admiral` slid
  backwards under full throttle for the whole fragment.

A design that drives these routes must carry its own answer — a progress watchdog, a grade check off the
collision, or a car chosen for the route rather than for the region. 096/02's autopilot ships the first
(`PathFollowSource`'s `stuck` state, on route progress rather than speed).

**Caught:** the gradient one, now — a wedged run reports `ended: stuck` in its capture and logs the route
percentage it reached. The direction one, no: nothing in the data or in a capture can tell you which way the
lane runs, so it needs a human looking at the footage.

## A map's extent or centre may not be a raw min/max bounding box

Mods remove objects by EXILING them — a placement moved thousands of metres out of the world instead of
deleted. One such row is enough to make a min/max box lie about where the map is: a merged `original` build
carried a single lamppost 17 km south, and the box grew from 24 × 24 cells to 24 × 93, putting its midpoint
in open sea (`docs/edge-cases/converter-pipeline.md` has the measurement and the file it came from).

The rule for a new design: anything that answers *where is this map* — a default camera, an auto-fitted
convert rect, a district guess, a streaming bound — derives from an **outlier-robust** statistic over the
occupied cells (a median, a density peak), and if the answer names a cell, it names one that is actually
occupied. `mapCenterGta` (sa-map-viewer) is the worked example: the median occupied cell, snapped to a cell
with content, because the inspector seeds its resident set from that cell and an empty answer welds nothing.

**Caught:** no, twice over. The min/max is correct arithmetic on correct data — nothing throws, nothing
warns, and the tool renders a perfectly good empty frame. `scripts/debug/grid-extent.ts` reports the
stragglers, but only if someone runs it.

## An asset SELECTION built from IDE rows must follow the `txdp` parent chain

A `txdp` parent dictionary is named by no IDE row — it exists only as another dictionary's ancestor. So any
list of "what this map needs" assembled from `objs`/`tobj`/ped/vehicle rows leaves it out, and the texture
resolvers (`asset-cache`, `TexturePlanner`) that DO walk the chain then walk it to a file nobody read.

The two halves are separately correct, which is why it survived: plan 003 restored the runtime walk and the
converter has always resolved the chain at weld time — but `selectInstallEntries` (the in-browser install
partition) still derived its `txds` from IDE rows alone. Measured 2026-08-01: stock SA hides this
completely (37 `txdp` links, and every parent is ALSO a placed model's dictionary — 0 files missing), while
a merged build with generated LODs missed **2 dictionaries, 6.72 MB** — `salodpar` (the shared parent of 995
`salod*` LOD dictionaries) and `neonobj`.

The rule for a new design: a selection derives from the SAME graph the resolver traverses. If a resolver
follows a link at read time, whatever assembles its inputs follows the same link.

**Caught:** no. A missing dictionary is not an error at any layer — the lookup falls off the end of the
chain and the material renders in its flat colour, which on a white LOD material is a white building.

## A world's texture format decides which GPUs can display it

A pak built from SA assets is BC throughout, and **BC is desktop-only** — mobile GPUs ship ETC2/ASTC. So
"which devices can run this world" is not a runtime question or a performance question: it is decided by the
converter, at build time, and cannot be re-taken later.

Design against it rather than around it: a plan that says "and then it also runs on phones" has to name the
build it means. Since 2026-08-07 there are three (`opensa-pack --textures astc|bc|rgba8`) and **none of them
is universal** — `bc` demands `texture-compression-bc`, `astc` demands `texture-compression-astc`, and only
`rgba8` loads on both at 4x an ASTC payload. So the rule did not go away, it acquired a switch: a plan states
which target its pak is built for, and a plan that needs one artifact on both GPU families still has nothing
to build it with (the Basis/KTX2 route was closed by decision —
[postmortem](../postmortem/universal-texture-transcode.md)). Relaxing the device gate does not help — that
was already done (a phone boots the engine now); it moves the failure to the first texture, it does not
remove it.

Detail and the measurement: [edge-cases/browser-runtime.md](../edge-cases/browser-runtime.md).

**What breaks when violated:** the world does not load on the target device — and only on the target device,
never on the desktop it was developed on.

**Caught:** at runtime, yes, and now **before anything streams**. Since 2026-08-04 the demand is derived from
the manifest's own texture formats (`ospakRequiredFeatures`) and checked once against the device in
`setupStreaming` (`requireWorldSupport`), so the failure names the WORLD rather than one texture.
`beginOstexUpload` still throws by name as the backstop for anything reaching the GPU by another route —
model dictionaries do exactly that, since **vehicles and peds are not in the pak**.

**In the build, since 2026-08-04 as well** — `opensa-pack` computes the demand from what it just wrote
(`platformDemand`: the pak's arrays ∪ every model's `TEXS` dictionary), logs it, records it in `report.json`
under `platforms`, and `--platforms desktop|mobile` turns the report into a build failure.

**The half a pak-only check cannot see:** the world is not the whole build — a car is not in the pak, and
model dictionaries are BC whenever their arrays are block-aligned (`model-ostex.ts`), so a portable world can
still be unspawnable on a phone. `--textures` moves both halves together (the models' dictionaries are
re-encoded in `packGameDir` before the check reads their formats), but the check still reads both, because
the halves are separately reachable and a per-class subset (`--vehicles`, `--peds`) leaves models behind in
their ORIGINAL format by design. Naming a platform is worth doing rather than eyeballing the flag.
