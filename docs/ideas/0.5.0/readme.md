# Ideas — 0.5.0

Future-work plans for the 0.5.0 cycle. Same convention as [0.4.0](../0.4.0/readme.md): each feature is a chain of
small, individually-implementable plans under [plans/](plans/), ending with verification + measurements.

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
**after-rain PUDDLES** (surface name-list + world-noise mask + `skyColorFor`-reflection, drying from the
edges inward), fog/smog presets, sandstorm (tinted particle wash + wind), lightning/thunder — and the
deferred weather→wind rule executes here. Full plan:
[plans/05-weather-rain/readme.md](plans/05-weather-rain/readme.md).

## City Life (THE flagship chain)

The most important system of the cycle: a living city — traffic and pedestrians with persistent seeded
routes, real scheduled trains, traffic lights and rail barriers, all visible to the horizon — built on the
AAA simulation-LOD-ring pattern (full physics near → kinematic graph-followers → far "rivers of headlights"
as corona streams), with agent identity preserved across rings. Eight plans: the `.ospath` format (single
source for engine AND real SA), a viewer-family path EDITOR app, the data-oriented sim core, light/barrier
controllers, trains, peds with imposter LODs, the far-rendering tiers (vehicle_vlo + coronas), and the SA
ASI twin (suppresses the vanilla population, reads our format, adds kilometre-range car/ped draw).

Full chain: [plans/06-city-life/readme.md](plans/06-city-life/readme.md).
