# 078 — one way in: viewers and the lab consume a perfect-map-builder output

**Status: PLANNED 2026-07-18 (user decision). Depends on
[opensa-pack 003](../../tools/opensa-pack/docs/plans/003-game-shaped-output.md) — this plan consumes the
game-shaped output that one produces.**

Today there are four different ways to get game data into something that renders it, and no two agree:

| Surface                                 | How it gets data                                                                                            | Where                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Main app (engine host)                  | user's real game dir via `showDirectoryPicker` → local loader → VFS, **plus** a pak fetched from `/pak-map` | `apps/web/src/ui/shell/use-asset-boot.ts`, `engine-canvas-host.tsx:248`     |
| Engine lab                              | pak only, from `/pak` (or `?src=`), no VFS at all                                                           | `apps/engine-lab/src/main.ts:232`, `pak-loader.ts:19`                       |
| Viewers (object)                        | a dev server on `localhost:3002`, **or** static e2e fixtures under `${VITE_STATIC_URL}/viewer/`             | `apps/viewer/src/object-viewer.ts:40,178,208`                               |
| Viewers (vehicle / character / compare) | that dev server only — `/dff`, `/txd`, `/ifp`, `/models?side=…`                                             | `vehicle-viewer.ts:151`, `character-viewer.ts:122`, `compare-viewer.ts:146` |

The paks themselves live inside one app's `public/` (`apps/engine-lab/public/`, 283 MB `world.ospak` and
friends) and are shared with the root app through three symlinks (`public/pak-ls`, `public/pak-map`,
`public/ped`). `pak-sf` and the vehicle fixtures are not symlinked, so they are reachable only from the lab
on port 4300. There are also orphans: `clouds-*.rgba` in every pak dir, whose only consumer was removed on
2026-07-17.

**The target: one approach for the game and for every tool.** We put a perfect-map-builder output into
`./public`, run the dev server, and the viewers and the lab read it exactly the way the game reads it —
through the VFS, with the opensa-pack 003 resolution order (our format → stock asset → warning). What the
lab renders is then what the game renders, by construction rather than by discipline.

## Why this matters beyond tidiness

- **The viewers currently cannot see our format at all.** They fetch raw `.dff`/`.txd` bytes from a
  side-channel server and parse them in-page. After opensa-pack 003 replaces those entries in the IMG, the
  viewers would be looking at assets that no longer exist. This plan is not optional cleanup — it is the
  other half of that change.
- **The compare tab is covered by nothing.** The 2026-07-18 close-out audit found `apps/viewer` is excluded
  from coverage on the grounds that e2e covers it, while e2e covers 3 of the 4 tabs. Moving the data source
  is the moment to fix the compensating control, not to re-assume it.
- **Two loaders, one job.** `packages/engine/src/stream/setup.ts:30-35` and
  `apps/engine-lab/src/pak-loader.ts:20-26` are the same fetch/validate/`setUvAnimations` sequence, down to
  the error string. opensa-pack 003 phase 4 collapses them; this plan is what makes the lab able to live on
  the collapsed one.

## Design

### The single data contract

A perfect-map-builder output directory — a game dir with our format inside the IMGs and world products
under `opensa/` — served over HTTP with range support. Every surface mounts it the same way:

```
game dir (pmb --out)
        │
        ├── served statically (dev server, range-capable)
        │
        └── VFS  ──►  resolution order: <name>.osm/.ost → <name>.dff/.txd → warn once
                          │
                          ├── engine host (apps/web)
                          ├── engine lab
                          └── viewers (object / vehicle / character / compare)
```

Because the resolution order is shared, every surface sees **optimized** assets (`.osm`/`.ost`, converted)
and **unoptimized** ones (a `modloader/` `.dff`/`.txd` parsed at runtime) through the same call — the
terminology and the contract are opensa-pack 003's. Two consequences for this plan: the viewers become the
natural place to inspect which kind an asset actually resolved to (a mod author's first question), and the
lab's mod field checks (003 phase 5b) run on the same mount as the game's.

The viewers stop being pak-aware and stop being server-protocol-aware. They ask the VFS for a model by
name, like the game does. `/dff`, `/txd`, `/ifp`, `/models?side=` disappear as concepts from the viewer
code — but see the compare tab below.

### `./public` and the dev server

Per user decision: converted output goes into `./public` and the dev server is what we run when working
with a viewer or the lab. That replaces the symlink farm — one location, one server, both apps resolve the
same URLs. Two things to settle in phase 0:

- **Which server.** `scripts/serve-static.ts` (port 3001, `sirv` over `static/`, CORS `*`) already exists
  and already does the cross-port CORS dance the app needs. `tools-debug/bench-harness/game-server.js`
  already does ranged `/f/<path>` reads for the headless harness. Recommendation: extend `serve-static` to
  mount a game dir with range support and retire the ad-hoc paths, rather than adding a fifth server.
- **`public/` is gitignored and huge.** A 283 MB pak in a Vite `public/` is copied on build. The convention
  needs an explicit statement of what is committed (nothing), what dev fetches, and what `build:prod` must
  exclude (`OPENSA_NO_VIEWERS=true` already drops viewer inputs at `vite.config.ts:95-97`).

### The compare tab is the one real exception

Compare renders the SAME model from two different builds side by side (`compare-viewer.ts:146`,
`/dff?side=${side}`) — that is its entire purpose, and it is how map-optimizer and the LOD generators get
reviewed. Under the new contract it becomes **two game dirs, two VFS instances**, selected by the user
(`before`/`after` paths) instead of a `side` query parameter on one server. The tab keeps its editable
source field; what changes is that a "source" is now a game dir, not a bespoke server.

This also gives compare something it never had: with the 003 resolution order it can show our converted
asset against the stock one, because the stock build is just the other side.

### What the lab loses and keeps

The lab keeps its own Vite root and port 4300, its scene/hour/weather controls, its `?vmodel`/`?at`/`?orbit`
vehicle bench, and the bench protocol — those are documented in
[engine-lab.md](../development/engine-lab.md) and [benchmarks.md](../development/benchmarks.md) and must
survive intact (the bench legs are shared with `?soak`, and the `[bench]`/`[soak]` output contracts are
verified).

What it loses is its private data path. **Per user decision 2026-07-18 the lab loads peds and vehicles from
`dff`/`txd` through the VFS, exactly as the game and the viewers do** — there is no lab-only fixture format.
`pak-loader.ts`, the `ped/` and `vehicle*/` fixture dirs, and the two probe CLIs that fill them
(`tools/opensa-pack/src/ped-probe.ts`, `vehicle-probe.ts`) all retire. A ped becomes "ask the VFS for
`male01`" — and once opensa-pack 003 phase 5 converts peds and cars, the lab picks up `.osm`/`.ost` through
the same resolution order without a line of lab code changing. That is the whole point of the contract: the
lab cannot silently diverge from the game, because it is running the game's loader.

`?src=` keeps working as a build selector — it just points at a game dir instead of a pak dir.

## Non-goals

- Changing what any surface RENDERS. This is a data-path plan; the pixels must not move, and the lab's
  bench numbers are the check that they did not.
- Merging the viewers into the main app, or merging the lab into the main app. Separate roots stay.
- Touching the production boot path for real users (`showDirectoryPicker` over the user's own install).
  That path stays exactly as it is — a pmb output is simply another directory it can be pointed at.
- The hosted-pak / fetch-from-CDN question (opensa-pack `002-fetch-game-paks`).

## Phases

**Phase 0 — decide the server + the `public/` convention.** Which server, what it serves, what is
committed, what `build:prod` excludes, how `?src=` addresses a build. Write it into
[query-parameters.md](../development/query-parameters.md) and a short "working with a pmb output" section
in the dev docs.

**Phase 1 — the shared mount.** One module that turns a served game dir into a VFS with the 003 resolution
order, usable from all three roots. This is where `setup.ts`/`pak-loader.ts` deduplication lands.

**Phase 2 — the lab onto it.** `?src=<game dir>`; `pak-loader.ts` deleted; peds and vehicles loaded from
`dff`/`txd` through the VFS (fixtures and probe CLIs retired). Gate: the 6-scene bench sweep reproduces its
reference row (fps AND draws within ±4 — the measurement that proved nothing was lost in the three
teardown), and the vehicle look bench (`?vmodel`/`?at`/`?orbit`) still renders its cars.

**Phase 3 — object + vehicle + character viewers onto it.** Dev-server protocol removed from these three.

**Phase 4 — compare onto two game dirs.** Two VFS instances, user-selected paths.

**The player ped is NOT in this plan** (user decision 2026-07-18). `apps/web/src/ui/engine-player.ts:54-56`
fetches the `/ped/ped.json` + `/ped/ped.bin` probe fixture in the **production** host, and it moves to a
by-name VFS load in
[opensa-pack 003 phase 5](../../tools/opensa-pack/docs/plans/003-game-shaped-output.md) with the rest of
the peds. This plan only stops the LAB from having its own fixture path.

**Phase 5 — retire the old paths.** `localhost:3002` protocol, the `public/` symlinks, the orphaned
`clouds-*.rgba`, and the e2e static-fixture branch in `object-viewer.ts:178` if phase 3 makes it redundant.
E2E is repointed at a small committed game-shaped fixture — and the compare tab gets covered, closing the
audit finding.

## Tasks

- [ ] Phase 0 — server decision + `public/` convention, written into the dev docs and query-parameters.md
- [ ] Phase 1 — shared "served game dir → VFS" mount; `setup.ts`/`pak-loader.ts` duplication removed
- [ ] Phase 2 — lab on the mount; `pak-loader.ts` + fixture dirs deleted; bench sweep reproduces reference
- [ ] Phase 3 — object/vehicle/character viewers on the VFS; dev-server protocol dropped from them
- [ ] Phase 4 — compare on two game dirs
- [ ] Phase 5 — retire :3002, the `public/` symlinks, `clouds-*.rgba`; e2e fixture repointed; compare covered
- [ ] Close-out — `npm run lint`, coverage floors held, `docs/development/` repointed at the new workflow

## Measurement ledger

(Empty until phase 2. Records: lab boot time on a game dir vs on a pak, the 6-scene sweep row, viewer
first-render time, and the e2e suite runtime after the fixture change.)
