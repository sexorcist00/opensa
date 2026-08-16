# Restrictions

**The rules a new idea, concept or plan has to satisfy before it is worth writing down.** Not what the
project cannot do today — what it may not be designed against, because the constraint is structural: a layer
boundary, a format ceiling, a split in the engine, a decision that happens at build time and can never be
taken back at runtime.

**Maintenance rule** (also in `CLAUDE.md`): a newly discovered restriction is recorded here in the same
change, and **`docs/ideas/`, `docs/concepts/` and `docs/plans/` are checked against this folder before they
are written**. A plan that violates a restriction is not an ambitious plan — it is a plan that will be
rewritten after the first build.

## Distinct from its neighbours

The rubrics next door answer different questions, and the difference is WHEN you read them:

| Folder | Question it answers | When you read it |
| --- | --- | --- |
| **`restrictions/`** | *May I design it this way?* | **before** writing an idea / concept / plan |
| [`edge-cases/`](../edge-cases/) | *Why does it behave like this?* | while debugging something that looks wrong |
| [`hacks/`](../hacks/) | *Why is this number what it is?* | when touching an expedient we knowingly took |
| [`performance/`](../performance/) | *What could I trade for frame time?* | when the frame budget is blown |
| [`postmortem/`](../postmortem/) | *Has this been tried?* | before reviving a direction |

**The original game gets its own folder.** [`gta-sa-original/`](../gta-sa-original/README.md) carries what
Rockstar's game and the real install we ship into actually are — the reference install's plugins, ini
settings and measured ceilings. This folder carries the RULE; that one carries the measurement. Read the
reference install before costing anything against the numbers in [sa-target.md](sa-target.md): **the `sa`
target always runs OLA + FLA + our own `perfect-map.asi`**, which lifts every text-IPL and pool ceiling in
that table except the FLA ID pools and the model id. Budgeting against a stock number the target does not
have silently under-builds, and so does leaving a guard in place for one.

A fact may appear in two of them, but **only once as detail**: edge-cases carries the measurement, this
folder carries the one-line rule, a link, and the two things edge-cases does not say — **what breaks when you
violate it, and whether anything catches you**. Nothing here is copied; everything here points.

The **workflow** restrictions (English-only, record measured numbers, judge a look change in the engine, a
field run reads `build/<game>/opensa` and nothing else, never fit a constant before digging out the game's
own formula) are not repeated here — they live in `CLAUDE.md`'s Standing Workflow Rules and apply to how the
work is done rather than to what may be built.

## The dangerous half: silent restrictions

Every entry says whether a violation is **caught** (a test, a build guard, a lint rule) or **silent**. That
column is the reason this folder exists. The project's own history is a list of restrictions that were only
discovered by breaking them: a WGSL uniformity error no test can see, a cell bake on the wrong grid that put
an object's HD and LOD in different slots, a per-vertex flag drawn through a flat varying, a mod folder named
`gta3img` that made a whole mod inert without a word. A caught restriction costs a red build; a silent one
costs a session.

## The files

| File | Subject |
| --- | --- |
| [architecture.md](architecture.md) | Layer boundaries, what may import what, the one-build rule, the grid every tool must agree on, what a frame-time span may wrap, the single owner a debug view's subset must have, that scripted control speaks a player's input rather than recomputing a system's numbers, that a diagnostic tripwire is whitelisted per declared event rather than per mode, that a framing decision taken on a threshold gets retaken every frame, that a camera pose is composed in the frame it is drawn in and measured against the pairing that renders, that a camera mounted on a moving subject is damped in that subject's frame rather than the world's, that a camera the streaming does not follow caps its own travel against the anchor that is followed, that a path's per-vertex speeds belong to the subject that travels it, that an input source is wired in TWO places because the camera is host-owned (a half-wired source walks but never looks), that state the chrome must read is state rather than an event (the UI mounts after boot), that the per-frame collision-cast budget is ONE allowance every consumer divides, that a dynamic body may only be CREATED where its static collision already exists (a streamer gating on its own radius spawns cars into a hole), that a stage in the chain both targets SHARE may not produce different content per target in one run (a layered mods folder is built one target at a time), that a source folder has ONE reader — every tool asks `resolveVehicleSources` which cars `mods-src/<game>/vehicles` holds, because a second reading is a different fleet and nothing compares them (SILENT: the installer and the cutscene census both went to zero cars and exited 0), and that a build's SOURCE may not live inside its own output (`<out>/.work-<target>` is wiped before any stage reads `--game`) |
| [build-vs-runtime.md](build-vs-runtime.md) | What is decided while the game is BUILT and cannot be recovered while it runs |
| [engine-lighting.md](engine-lighting.md) | The light pool's two halves and who is allowed to read them |
| [gpu-and-shaders.md](gpu-and-shaders.md) | WGSL and inter-stage rules that no test in this repo can see, plus the resource-lifetime rule a runtime welder must obey (a grown texture array kills the bundles recorded against it), and which bind-group layouts may grow at all — BUNDLED ones cost a re-record of every bundle, pass-encoded ones (the whole rigid path) are free |
| [sa-target.md](sa-target.md) | What the `sa/` target must budget for before a plan adds anything to the map — against the TARGET's numbers, since it always carries OLA + FLA + our asi and a lifted ceiling is neither a budget nor a thing to guard; that a ceiling's guard belongs on the BRANCH whose target has it; and — for anything that PATCHES the real exe — that an address or expected byte is declared once, in the catalogue, never restated in a patch (a trampoline's continuation is derived, not written); and that RANGE comes from a permanent text row rather than a binary stream — a stream's slot is only resident within 190 units of the player, so it cannot carry draw distance, which held our clutter at ~190 m for months while it was declared at 290 |
| [assets-and-data.md](assets-and-data.md) | A rule must derive from what the asset carries — never from the slot it sits in; plus the two halves of RenderWare geometry a reader may not mix up (the DRAWN index data vs the authoring face array, and the frame transform SA discards for a simple map model); the clump ROOT matrix SA replaces with the entity's (anti-rip mods poison exactly it); the VER2 `.img` u16 sector ceiling (~128 MB/entry, wraps silently past it — now guarded); that no archive a tool must READ may pass 2 GiB while the positional writer will happily take it there, so a growing `models/*.img` has to be bounded per FILE and not just per entry (silent on the write, fatal in a later stage); and which stock data a total conversion simply does not ship (the vehicle path graph is `original`-only), and what that graph does NOT say about the roads it maps (travel direction, gradient); and why a map's extent or centre may never be a raw min/max box (mods remove objects by exiling them); and that a 2dfx entry's coordinate SPACE decides both its transform AND which cell owns it (roadsigns are world-space, and 131 of 489 sit outside the cell of the instance carrying them); and that a stock data column means what the CODE does with it rather than what the file's own header says (`procobj.dat` misdocuments both SPACING and MINDIST, and reading them as written cost 83 % of the clutter); and that a model an IDE declares and an IPL PLACES must have a `.dff` in some archive — retiring one leaves a streaming request that can never complete, and the symptom is the whole world rendering as LODs rather than five missing objects (now gated); and that an inst row's POSITION in the file IS a LOD link, so a pass may append rows but may never delete one, and a row index written by anything but the file's own owner has to be re-expressed in OUR space before it is written (a mod pack's stream merges carried the author's, over the installer's correct rebase — 11 links one row off, no error anywhere); the class is caught since 2026-08-16 by a POSITIONAL build guard (a LOD must stand on its owner), whose own limit is that a shift landing within 20 u stays invisible |
