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
| [architecture.md](architecture.md) | Layer boundaries, what may import what, the one-build rule, the grid every tool must agree on, what a frame-time span may wrap, the single owner a debug view's subset must have, and that scripted control speaks a player's input rather than recomputing a system's numbers |
| [build-vs-runtime.md](build-vs-runtime.md) | What is decided while the game is BUILT and cannot be recovered while it runs |
| [engine-lighting.md](engine-lighting.md) | The light pool's two halves and who is allowed to read them |
| [gpu-and-shaders.md](gpu-and-shaders.md) | WGSL and inter-stage rules that no test in this repo can see, plus the resource-lifetime rule a runtime welder must obey (a grown texture array kills the bundles recorded against it) |
| [sa-target.md](sa-target.md) | What the `sa/` target must budget for before a plan adds anything to the map |
| [assets-and-data.md](assets-and-data.md) | A rule must derive from what the asset carries — never from the slot it sits in; plus the two halves of RenderWare geometry a reader may not mix up (the DRAWN index data vs the authoring face array, and the frame transform SA discards for a simple map model); and which stock data a total conversion simply does not ship (the vehicle path graph is `original`-only), and what that graph does NOT say about the roads it maps (travel direction, gradient) |
