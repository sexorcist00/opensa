# Ideas — 0.5.0

Future-work plans for the 0.5.0 cycle. Same convention as the sibling [0.6.0](../0.6.0/readme.md) cycle: each
feature is a chain of small, individually-implementable plans under [plans/](plans/), ending with
verification + measurements.

## Platform reach — IN PROGRESS as `docs/plans/097-platform-reach/` (2026-08-04)

The lead chain of the cycle, and no longer deferred work, so it no longer lives here. The world on a phone,
and the frame off the main thread: a phone boots the engine and **cannot open the world**, because a pak
built from SA assets is BC throughout and no mobile GPU has BC — content decided at build time, not a
runtime or browser problem.

**Landed:** the whole of chain 1 (device truth) — the world's GPU demand read from its manifest before
anything streams, a build-time `--platforms` gate over both halves (pak arrays ∪ model dictionaries), the
`--rgba8` defect that gate found, a simulated-mobile-adapter test, and the mobile benchmark schema. Plus the
build half of chain 3/01: `.oscol`, the bake, and `--bake-collision`.

**Next:** the runtime read of the baked collision (the half that removes the spike), then chain 2 once its
concept clears. Its phone-side steps are blocked on a device measurement nobody has taken, and the dispatch
console below is the instrument that takes it — the only surface that opens a real world on a mobile GPU
today. Until that row exists, everything on a phone stays unproven.

Full chain: [../../plans/097-platform-reach/readme.md](../../plans/097-platform-reach/readme.md).

## The dispatch console — IN PROGRESS as `docs/plans/098-dispatch-console/` (2026-08-06)

The engine's **second consumer**, declared, and the second lead of the cycle — so it does not live here as
future work either. `apps/dispatch` is a computer-aided-dispatch operator surface over the streamed world
(top-down 3D map, live units, a call queue, click-to-inspect answering with model and TXD names plus GTA
coordinates) that runs with no player, no ECS and no physics. It shipped in a single commit with one
write-up and nothing else: no plan, no roadmap row, no line in the project goals — while being the only
surface in the repo that runs on a phone.

The chain does three things at once: **declares the direction** (a CAD 3D map on the SA world — geo import,
a live feed and multi-operator are ruled out and deferred to [0.6.0](../0.6.0/readme.md)), **trims the engine
to what the map actually draws** — and only that, because cars and peds are drawn, vegetation sways and the
day turns, with one engine serving PC and mobile on a budget rather than a branch — and **takes the phone
measurement** the platform-reach chain above is waiting for.

Full chain: [../../plans/098-dispatch-console/readme.md](../../plans/098-dispatch-console/readme.md).

## Weather-driven wind (own engine)

Vegetation sway shipped in the own-engine chain (074/06 row 10) with a constant `windStrength`; the deferred
half is the weather rule — bad weather ⇒ stronger (and possibly faster) wind, cross-faded on weather change.
All the hooks already exist (baked per-vertex amplitudes, `Environment.windStrength`, timecyc-driven
environment drivers) — this is a drive-rule + field-tuning task.

Full plan: [plans/02-weather-wind/readme.md](plans/02-weather-wind/readme.md).

## Baked directional sun shadows — MOVED to 0.6.0 (2026-07-17)

The second-attempt plan now lives in the 0.6.0 "graphic improvements" draft bundle, together with the
street-lamp lighting v2 idea:
[../0.6.0/plans/04-graphic-improvements/01-baked-directional-shadows.md](../0.6.0/plans/04-graphic-improvements/01-baked-directional-shadows.md).

## All land vehicle types

Motorbikes (two-wheel balance controller + rider), bicycles, trucks with trailers (hitch joints),
buses, utility vehicles (forklift/combine/mower). Air & water explicitly out. Builds on the 0.4.0 physics
overhaul presets and the 074/08 dynamics layer. Full plan:
[plans/04-all-vehicle-types/readme.md](plans/04-all-vehicle-types/readme.md).

## Rain & weather phenomena (timecyc-driven)

The full 23-id SA weather catalogue mapped to effect classes: weather state machine with real FROM→TO
timecyc blends, instanced rain with a top-down occlusion map (dry under roofs), wet-world uniforms,
**WET GRIP** (the tyre half, moved from 081/10 — the surface path is already shipped, what is missing is the
rain to be wet from),
**after-rain PUDDLES** (surface name-list + world-noise mask + `skyColorFor`-reflection, drying from the
edges inward), fog/smog presets, sandstorm (tinted particle wash + wind), lightning/thunder — and the
deferred weather→wind rule executes here. Full plan:
[plans/05-weather-rain/readme.md](plans/05-weather-rain/readme.md).

## City Life (THE flagship chain)

The most important system of the cycle: a living city — traffic and pedestrians with persistent seeded
routes, real scheduled trains, traffic lights and rail barriers, all visible to the fog line — built on the
AAA simulation-LOD-ring pattern (full physics near → kinematic graph-followers → far "rivers of headlights"
as corona streams), with agent identity preserved across rings, **running in BOTH hosts: the OpenSA engine
and real SA through a new `asi/city-life` plugin** (100 % mission/mod compatibility). Reworked 2026-08-02
into five sub-chains: `1-preparation` (the ASI clears the vanilla streets FIRST; full path/population data
import; a sidecar for what the original files can't express; an editor FOR the original `nodes*.dat`),
`2-traffic` (sim core, a driver that is not an idiot, real light controllers, the new instanced far tiers,
the ASI traffic twin), `3-peds` (crowd rendering, generated silhouette LODs, sidewalk sim, ASI twin),
`4-trains`, `5-city` (density scaling + the acceptance program).

Full chain: [plans/06-city-life/readme.md](plans/06-city-life/readme.md).

## Basic CLEO support (moved from 0.4.0, 2026-08-01)

Run compiled GTA:SA CLEO `.cs` scripts in the engine: a Sanny-DB SCM decoder (lifting the 0x014B car-gen
reader already in the tree), an engine-agnostic thread VM, a `CleoHost` on the rigid `.osm` path, a
`packages/cleo` module, tracer + coverage. Planned in full on 2026-07-19 as `docs/plans/083-cleo-basic/` and
moved here **unstarted** — nothing about the plan changed, only its cycle.

Full chain: [plans/08-cleo-basic/readme.md](plans/08-cleo-basic/readme.md).

## LOD generators, extended (moved from 0.4.0, 2026-07-19)

Two independent generator upgrades for the REAL-GAME pipeline, each unlocked by an ASI engine fix from
the [`asi/perfect-map`](../../../asi/perfect-map/docs/plans/readme.md) chain — untouched by the own-engine
flip (they run in pmb/lod-generator land). **Part A** (needs asi Phase 2, the 2dfx emitter-leak fix):
LODs carry the full 2dfx richness — coronas everywhere, roadsigns & escalators into baked cells,
rate-budgeted particle emitters at range. **Part B** (needs asi Phase 1, the int16 limit lift): procobj
scatter gets configurable, biome-aware density (forest bushes, mountain rocks, desert cacti) with the
int16-era caps raised for the asi target. Both keep the stock target byte-identical to today.

Full chain: [plans/07-lod-generators-extended/readme.md](plans/07-lod-generators-extended/readme.md).
