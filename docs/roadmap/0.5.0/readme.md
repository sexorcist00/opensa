# Ideas — 0.5.0

Future-work plans for the 0.5.0 cycle. Same convention as the sibling [0.6.0](../0.6.0/readme.md) cycle: each
feature is a chain of small, individually-implementable plans under [plans/](plans/), ending with
verification + measurements.

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
tool boundaries, so no plan mapped to a shippable diff. **2dfx on LODs** (`rw-codec` → `lod-common` → the two
LOD generators): coronas correct and consistent everywhere, roadsigns & escalators into baked cells,
rate-budgeted particle emitters at range. **Procobj density** (`lod-procobj-generator`): configurable,
biome-aware scatter — forest bushes, mountain rocks, desert cacti.

**The "both are ASI-gated" framing was wrong and has been corrected.** Baked-cell work is not gated at all —
`opensa-lod-generator` output is OpenSA-only ([restrictions/sa-target.md](../../restrictions/sa-target.md)),
so real SA never loads it and no plugin is involved; the roadsign/escalator carry is shippable today. The
particle half is not waiting either: [`asi/perfect-map`](../../../asi/perfect-map/docs/plans/readme.md)
Phase 2 shipped (009's patch, 010's pipeline flip), and only its far-view overdraw budget was deferred. On
the procobj side the binding ceiling is **IPL slots** (measured 2026-08-07: 20 146/32 767 rows but
**38/40 slots**), which our ASI does not lift — not the int16 row ceiling it does.

How much "more" means is now a number rather than a feeling:
[plans/07-lod-generators-extended/density-target.md](plans/07-lod-generators-extended/density-target.md)
costs a shipping mod's density (ProperFixes 2.2.1, **57 583 placed objects**, 2.35× ours) against our own
build — and finds our layout already **8.3× more row-efficient per object**.

Full chain: [plans/07-lod-generators-extended/readme.md](plans/07-lod-generators-extended/readme.md).
