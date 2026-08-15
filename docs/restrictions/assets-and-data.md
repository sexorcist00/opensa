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

## A clump ROOT frame's matrix is entity-owned — its authored values never render

When SA attaches a clump to an entity, the root frame's matrix is REPLACED by the entity's world matrix
(`CEntity::UpdateRW`), so whatever rotation/translation the DFF authored on the root is dead data — and
anti-rip exporters poison exactly that slot, because it is the one matrix the real game never reads. The
comet lock (2026-08-04) shipped `rotation[0][0] = −3.9e14` on the root: SA rendered the car whole, our
composition flung every off-centre part (doors, wings, wheels, `f_steer`) to ±10¹⁴ — an invisible car with
live collision, blocking the player mid-street. A new design that walks a frame chain must stop BELOW the
root (`frameWorldTransform` does; the rule holds for vehicles, peds and anim clumps alike — stock roots are
identity, so honouring it costs well-formed models nothing).

**Caught:** partly — `weld.test.ts` pins the poisoned-root case and `build-vehicle-model.test.ts` rebuilds a
poisoned admiral byte-identical, but only for code that goes through `frameWorldTransform`. A NEW hand-rolled
chain walk that composes the root is silent: physics stays sound, so nothing crashes — the model just never
appears.

## No archive a tool must READ may pass 2 GiB — and the writer will happily take it there

`readFileSync` throws `ERR_FS_FILE_TOO_LARGE` past 2 GiB, while the positional write path (`writeImgFile`)
has no such ceiling, so a stage CAN emit an archive that every later stage fails to open. A design that grows
`models/*.img` therefore has to bound each FILE, not just each entry: buckets with a size cap and spill into
a numbered sibling, never one archive that content is allowed to grow into. Measurement, the numbers and the
run that hit it: [`edge-cases/converter-pipeline.md`](../edge-cases/converter-pipeline.md).

The corollary is the reason it belongs here: **71 call sites across 53 files open archives whole**
(`openArchive(bytes)` / `openImg(bytes)`), so "just stream it" is not a local change. The one fd-backed
reader is `openLazyVer2` in `tools/opensa-pack`.

**Caught:** partly, and in the worst order. The WRITE is silent — nothing warns that an archive has grown past
what a reader can take. The failure surfaces later, in an unrelated stage, as a Node error naming a byte count
and no file (`The value of "length" is out of range … Received 2168825856`), which is how it cost a build here.

## A VER2 `.img` entry cannot exceed 65 535 sectors (~128 MB)

The stock directory stores an entry's size as a u16 of 2048-byte sectors, so 134 215 680 bytes is a FORMAT
ceiling. Writing past it does not fail — the sector count WRAPS (a 136.6 MB `comet.osm` read back as
8.9 MB), and the reader then dies far from the cause (`.osm section TEXS overruns the file` at spawn). Any
design that puts a payload into `models/*.img` has to fit it under the ceiling or choose another container
— which is also why a model's texture dictionary buckets by native size instead of upscaling every layer to
the largest (the single-array shape hit 128 MB on a 32-texture mod dictionary whose sources sum to ~10 MB).

**Caught:** yes — `assertVer2EntrySize` throws in `EditableImg.set`, `buildVer2Buffer` and `writeImgFile`
(the rebake reports it per car instead of aborting the run).

## A dictionary is not a material list

A model's TXD serves several models. "This dictionary contains a glass texture" says nothing about whether
THIS model draws it — plan 092's first glass field-control was picked that way and turned out to have
painted-on OPAQUE windows (`marinawindow1_256`, no alpha channel at all). Read the DFF's materials
(`scripts/debug/dump-dff-materials.ts`), not the dictionary's contents.

**Caught:** no — you get a real model, a real texture and a wrong conclusion.

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

## A 2dfx entry's coordinate SPACE decides both its transform and its OWNER

Read the type's `space` off `@opensa/lod-common`'s carry policy (`spaceOf`, measured by
`scripts/debug/two-dfx-space.ts`) before writing any code that moves or files an entry. Type 7 roadsign is
**world**, unanimously (489/489); every other type is model-local. Two rules follow, and a design that
breaks either produces content that looks placed and is not:

1. **Transform by the space, not by the type.** A world-space entry is re-based by the cell origin alone —
   never by the instance transform, never by the geometry frame. The dead first attempt at plan 100 would
   have routed plates through the instance transform and thrown every one about a kilometre.
2. **A world-space entry belongs to the cell its POSITION falls in, not to the cell of the instance
   carrying it.** These differ for **131 of the map's 489 plates**. File it by the owning instance in one
   consumer and by world position in another and the same plate lands on two cell keys — which defeats the
   streamer's one-level-per-slot rule and draws it twice. This is why `cell-weld` takes LOD roadsigns from
   `opensa-pack`'s world-keyed pre-pass while it takes lights and emitters off the LOD model itself.

**Caught:** no, in both directions. A misplaced plate renders perfectly a kilometre away, and a doubled one
is two correct plates in the same spot — z-fighting at best, invisible at worst. Nothing asserts either.

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

## A stock data column means what the CODE does with it, not what the file's header says

`procobj.dat` documents SPACING as *"1 object every n square metres"* and MINDIST as *"no objects created
closer than this"*. Both readings are wrong at the point that matters: the game squares SPACING
(`density = triangleArea / spacing²`, so the column is a LENGTH) and measures MINDIST **from the camera** to
the triangle, clamped up to 80 — never between two objects. We read both the way the header reads, and the
result was a clutter layer at 16.8 % of the authored density with an even, one-of-each-species look nothing
in the game produces. The mechanism and the numbers:
[`gta-sa-original/procedural-objects.md`](../gta-sa-original/procedural-objects.md). Fixed in the code
2026-08-09 (`area / spacing²`, no inter-object cull), which is why the example is safe to state — the rule
below is what the fix cost, not a live defect.

The rule for a new design: before a plan spends an authored column, the column's meaning comes from the
reversed source (`docs/links.md` → gta-reversed) — Rockstar's own comments, our parser's doc comments and a
modding wiki are leads, not the spec. This is the same directive that says to recover the original's formula
before fitting a constant (`CLAUDE.md`); the addition here is that a data file's own header is one of the
sources it applies to.

**Caught:** no, and it is the worst kind of silent: two misread columns whose errors ran in opposite
directions (4–163× too many candidates, then 99.0 % of them culled), so every count looked reasonable, the
build was green, and the world looked populated. What catches it now is
`scripts/debug/procobj-spacing-census.ts`, which prices both readings side by side and reports the
nearest-neighbour signature — but only if someone runs it.

## A model an IDE declares and an IPL places must have a `.dff` in some archive

Discovered 2026-08-10, in the field, after a day of bisection. One mod's `gta3_img/Remove original/` folder was
read as a delete list, so five stock models left `gta3.img` while their `.ide` rows and 23 inst rows stayed —
the mod ships no IDE/IPL edit, and cannot: those are stock files.

**What breaks is not the five objects.** The streaming request for an entry that does not exist can never
complete, and the symptom is global: the whole world renders as LODs, permanently, with hitching. It reads as a
performance regression or a map-layer bug, which is exactly where the day went — four wrong axes (ID pools,
stream file count, entity count, a mod corrupting the map) before the user's own repro narrowed it.

The rule for a new design: any step that RETIRES an asset — a delete list, a rename, a slot compaction, a
container replaced wholesale — has to answer what still declares and places it. A model may be declared and
unplaced (stock does it once, `carupg_int_rays`); it may never be placed and unloadable.

**Caught:** yes, since the same day — `install()` ends with `checkDanglingModels` (`dangling-models.ts`) and
THROWS, naming each model, its id, its placement count and the declaring IDE. Placements are counted from text
IPLs and from binary streams inside the archives. It errs downward: only `objs`/`tobj`/`anim` are read, so a
clean result means "none in those sections". Detail and the measurements:
[`tools/mod-installer/docs/plans/010-remove-original-is-a-replacement.md`](../../tools/mod-installer/docs/plans/010-remove-original-is-a-replacement.md).

## An inst row's POSITION in the file is a LOD link — no pass may delete one

Discovered 2026-08-11, from a field report that three buildings had no LOD. A text IPL's `lod` column is a
**row index into the `inst` section**, not a name — and the binary stream IPLs inside `gta3.img` index the
same text file of their area. So deleting one row repoints every link at or after it, in that file AND for
objects that are not in it at all.

**The removal path a MOD takes is handled, and that is exactly what makes the rest dangerous.** A
`remove from "inst"` merge goes through `removeInstWithRebase` (which decrements every surviving link) and
`patchAreaStreams` (which rewrites the `lod` field in the area's binary streams) — measured working:
`5. SA Xbox Map Features` drops a row from `LAe.ipl` at index 93 and `laehospital1`'s stream link comes out
133 → 132, still on its own LOD. **Every other way a row can leave a file has neither half.** `LAw.ipl` is one
row short of stock with no mod involved: its id/name column took the deletion, its transform column did not,
so `LODgaz9_law` sits 398.7 u off its object wearing a re-derived neighbouring rotation — and `law_stream2.ipl`
was never patched, so the link lands on a tree the build had exiled to z = −300.

The rule for a new design: a pass may APPEND inst rows freely (every index it could disturb is below it), and
may not REMOVE one. Retire a placement by exiling the row — the trees layer's z = −300/−1000 is the
established shape — rather than deleting it: no renumbering, no stream patch to keep alive, and nothing
downstream can undo it. "The merge handles removals" is not cover: that is one path, and the guarantee is a
property of the whole build rather than of one function.

**Caught: NO, and by construction.** A shifted index lands on a VALID row of the same file, and a transform
column off by one against its own name column is a perfectly legal file — row counts, well-formedness and
every budget guard pass. `removeInstWithRebase`'s unit tests prove the FUNCTION rebases, which is not the
claim that matters. The damage is only visible by resolving each link back to a MODEL NAME and comparing
against the source tree, which nothing does today. Detail, measurements and the paste-able diagnosis:
[`docs/open-issues/ipl-row-removal-breaks-lod-links.md`](../open-issues/ipl-row-removal-breaks-lod-links.md).

## A curated list may GATE a derived rule; it may never CARRY the correction

Plan 025 needed to repair authored UVs on 127 models, and the obvious shape — "a list of models with the fix
for each" — is the one rule this repo has held longest against: **every slot in this game is a mod target.**
Store "model X, face 72 → uv (a, b)" and the day a mod ships a different `road_lawn34` with different
topology, face 72 is a different face and we write a stranger's UV into it. The build succeeds, the model
draws, the mess is somewhere else. Nothing catches it.

The shape that is allowed: the list says only **where the rule may run**, and the correction is derived from
what the asset itself carries at build time. A mod replacing a listed model is then judged on its own
geometry and, at worst, nothing happens. `data/crease-overrides.json` is this — it stores a THRESHOLD, not a
normal. Plan 025's `uv-stretch-models.json` was the same shape (retired with its pass, 2026-08-11 — see
`docs/postmortem/uv-stretch-repair.md`; the retirement was about the repair, not about this rule).

**A generated list must also say it is generated**, and how to regenerate it — hand-editing one is how it
silently stops matching the data it was derived from.

**Caught:** no. Nothing distinguishes a gate list from a patch list at build time — this is a review rule.

## Repairing authored data is allowed, and it still has to be demonstrated — to the EYE

"That is what the original does" is the beginning of an argument (`docs/project-goals.md`), so a 2004
authoring slip may be corrected — and plan 025's UV repair is the measured warning about what "demonstrated"
means. It corrected mappings that drew a texel up to 284× longer than wide, passed every one of its own
guards (no shared UV moved — corrections went onto split vertices; a correction that could not verify itself
refused), and the first field before/after retired it the same day: every split vertex is a hard UV seam, so
a partial repair of a CONTINUOUS defect converts a soft smear into sharp patchwork, and the "corrected"
mapping satisfies the metric while lying where no author put it
(`docs/postmortem/uv-stretch-repair.md`).

The rule a new repair of authored data must satisfy: **its acceptance test has to measure what the eye
judges, not a per-face metric** — a low-frequency defect and a high-frequency one are not ordered by any
per-face number, and the eye forgives the smooth error. If the only honest test is a field round, the field
round comes before the pass ships in a build the user will judge.

**Caught:** no. Nothing at build time distinguishes "helps the metric" from "looks better" — this failure
mode is exactly the one the pass's own checks cannot see, which is why it is a restriction now.
