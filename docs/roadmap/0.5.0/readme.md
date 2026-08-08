# Ideas — 0.5.0

Future-work plans for the 0.5.0 cycle. Same convention as the sibling [0.6.0](../0.6.0/readme.md) cycle: each
feature is a chain of small, individually-implementable plans under [plans/](plans/), ending with
verification + measurements.

## Platform reach — IN PROGRESS as `docs/plans/200-platform-reach/` (2026-08-04)

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

Full chain: [../../plans/200-platform-reach/readme.md](../../plans/200-platform-reach/readme.md).

## The dispatch console — IN PROGRESS as `docs/plans/201-dispatch-console/` (2026-08-06)

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

Full chain: [../../plans/201-dispatch-console/readme.md](../../plans/201-dispatch-console/readme.md).

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

## All land vehicle types — PULLED BACK into active work (2026-08-04)

Rewritten against a fresh four-way recon (data pipeline, physics, animation, docs) plus the
`NO_COMMIT/all-veh` corpus (the VSA Editor ability catalogue + a control mod car) and moved to
[`docs/plans/098-all-land-vehicles/`](../../plans/098-all-land-vehicles/readme.md); the single-file chain
that lived here (`plans/04-all-vehicle-types/`) is superseded and deleted. Air & water stay out — the
recon's findings on them are recorded in
[../0.6.0/plans/05-air-water-rail/readme.md](../0.6.0/plans/05-air-water-rail/readme.md).

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

## Basic CLEO support — PULLED BACK into active work (2026-08-04)

Rewritten against a full recon of the 7-mod target corpus and moved to
[`docs/plans/097-cleo-basic/`](../../plans/097-cleo-basic/readme.md); the chain that lived here
(`plans/08-cleo-basic/`, the unstarted 083 rethink) is superseded and deleted.

## LOD generators, extended (moved from 0.4.0, 2026-07-19; restructured 2026-08-07)

Two generator upgrades, **reorganised into one folder per TOOL** — the old A1–A3 / B0–B4 split cut across
tool boundaries, so no plan mapped to a shippable diff. **Procobj density** (`lod-procobj-generator`):
configurable, biome-aware scatter — forest bushes, mountain rocks, desert cacti. That half is what remains
here.

**The 2dfx half LEFT this plan on 2026-08-07.** Its foundation shipped (`rw-codec/001` typed payload codecs,
`lod-common/005` the carry-policy + `006` `transform2dfxEntry`, `opensa-lod-generator/005` the adoption, all
moved into their tools) and the rest became [plan 100](../../plans/100-2dfx-at-lod-range/readme.md) after two
measurements changed its shape: a roadsign's coordinates are WORLD, not model-local, and **nothing reads a
cell LOD's 2dfx section** — both map consumers gather 2dfx from HD models only. So "roadsigns & escalators
into baked cells, shippable today" was wrong on both counts, and escalators turned out to have no engine code
at all ([plan 101](../../plans/101-escalators/readme.md)). What stays filed here from that half is the
far-view emitter RATE BUDGET (`lod-common/03` + `sa-lod-generator/02`), and it should follow plan 100/04.

**The "both are ASI-gated" framing was wrong and has been corrected.** Baked-cell work is not gated at all —
`opensa-lod-generator` output is OpenSA-only ([restrictions/sa-target.md](../../restrictions/sa-target.md)),
so real SA never loads it and no plugin is involved. The
particle half is not waiting either: [`asi/perfect-map`](../../../asi/perfect-map/docs/plans/readme.md)
Phase 2 shipped (009's patch, 010's pipeline flip), and only its far-view overdraw budget was deferred. On
the procobj side the binding ceiling is **IPL slots** (measured 2026-08-07: 20 146/32 767 rows but
**38/40 slots**), which our ASI does not lift — not the int16 row ceiling it does.

How much "more" means is now a number rather than a feeling:
[plans/07-lod-generators-extended/density-target.md](plans/07-lod-generators-extended/density-target.md)
costs a shipping mod's density (ProperFixes 2.2.1, **57 583 placed objects**, 2.35× ours) against our own
build — and finds our layout already **8.3× more row-efficient per object**.

Full chain: [plans/07-lod-generators-extended/readme.md](plans/07-lod-generators-extended/readme.md).
