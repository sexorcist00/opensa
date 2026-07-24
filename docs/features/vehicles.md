# Vehicles

`packages/renderware/src/vehicle/` (`build-vehicle-model.ts` + `textures.ts` — renderer-agnostic model
build, run off the main thread by `packages/game/src/adapters/vehicle-model.worker.ts`),
`packages/game/src/vehicle/` (systems), `packages/engine/src/render/probe.ts` (the reflection probe),
host wiring in `apps/web/src/ui/engine-vehicles.ts`, plans 015–021/025/030/033 + 074/16.

## Implemented

- **Loading**: vehicles.ide defs, DFF with frame hierarchy KEPT (doors/wheels as named parts),
  embedded COL, generic `vehicle.txd` merge, per-model TXD. Both SA wheel conventions are built:
  a single shared `wheel` atomic instanced at the `wheel_*_dummy` frames (scaled per front/rear,
  mirrored on the right), or per-corner `wheel_{l|r}{f|m|b}` atomics placed at their own frames
  (different front/rear wheels). Both handle the middle axle (`m`) of 3-axle trucks, and per-corner
  wheels take precedence over a stray shared `wheel` atomic some exporters leave in. A lone corner
  atomic with no shared `wheel` but real `wheel_*_dummy` frames (a mis-named shared wheel some mods
  ship, e.g. comet with only `wheel_rf`) is treated as the shared wheel and instanced at all dummies,
  so it renders four wheels instead of one. A third, wheel-mod convention is also handled: an
  `f_wheel_<mask>` container frame (e.g. `f_wheel_1111`, cheetah) whose child atomics are the wheel
  sub-model — its geometry is instanced at every dummy instead of rendered once as body.
- **Paint**: carcols.dat palettes (`car` = 2-colour, `car4` = 4-colour sections); SA editable-material
  markers — primary (60,255,0), secondary (255,0,175), tertiary (0,255,255 cyan), quaternary
  (255,255,0 yellow). NB (255,175,0)/(255,60,0) are per-lamp ids on the `vehiclelights` atlas, **not**
  paint markers. Colour spec strings `"p,s[,t,q]"` with omitted 3rd/4th defaulting to palette 0 (SA
  behaviour); RW modulate (texture × material colour) for non-marker textured materials (dark interiors fix).
- **Reflections** (plan 030 → 074/16 → 084): MatFX env coefficient + SA reflection/specular plugin data
  carried per material. A material is reflective when its env map has a coefficient (a coefficient of 0 is
  SA's own "not reflective" marker on tyres and rubber, and it wins over everything else), or — with no env
  map at all — when it is UNTEXTURED and carries the `reflection` plugin, which is how SA authors bare metal
  such as exhausts and trim. The env TEXTURE is not the colour source and is not uploaded at all: the shader reflects the live probe, so
  neither a varying nor an array layer is spent on it (two layers per car; the mod comet's 1024² array went
  96 → 84 MB RGBA). The engine runs a skygfx-style "neo" car pipe — the base colour LERPs toward a live scene
  **cube probe** (`packages/engine/src/render/probe.ts`, 128²×6, refreshed a couple of faces per frame) —
  with a per-material class (matte/paint/chrome/glass) chosen from the material data, never from names.
  The three-era presets (`packages/game/src/plugins/vehicle-reflection/presets.ts`) survive only as
  debugger tuning values.
- **Self-occlusion** (plan 084, 2026-07-22): `sky-occlusion.ts` gives every vertex a sky-visibility value
  from a height field over the car's own shown shell — horizon mapping, 8 azimuths, weighted by the vertex
  normal so a roof darkens the cabin under it and not the door skin beside it. It is computed in the shared
  BUILDER, so a converted car and a modloader car agree by construction, and rides in the night set's alpha
  (no extra buffer). The `_vlo` LOD and `_dam` twins receive it but never cast, which is what keeps a
  convertible's cabin open. The engine's dynamic indirect term is `params.y × DYNAMIC_INDIRECT ×
  skyVisibility(normal) × occlusion` — the map's `prelit × params.y × ao`, with a constant standing in for
  the prelit a car has no data for. `skyVisibility` / `DYNAMIC_INDIRECT` live in the shared `<frame>` shader
  module (next to `localLightStatic`) so the ped path reuses the exact same weight, minus the per-instance
  occlusion a ped has no bake for (plan 087 ped — see character.md).
- **Tyre detection** (plan 084, 2026-07-22): `wheel-tyre.ts` finds the RUBBER of a wheel by geometry, never
  by texture name (the field set says `tire`, `tyre`, `tread`, `wheel`, `vehicletyres128`, `generic_tire_01`
  — it disagrees with itself). A wheel is a disc about its axle and the tyre is its outer band: measured
  across the game, tyre materials sit at a mean radius of 0.87–0.98 of the wheel's own maximum and every rim
  material at 0.18–0.70. A detected tyre is forced MATTE — no reflection, no specular, because rubber does
  not shine — while the rim beside it keeps whatever the DFF authored. 180 of 215 stock vehicles have a
  separable tyre; the other 35 (boats, aircraft, RC, and a few cars with one material over the whole wheel)
  simply have none, which is a supported answer. The submesh keeps a `tyre` flag for the damageable-tyre
  work that will want it.
- **Glass** (plan 025): window materials detected and rendered transparent (double-sided,
  sorted).
- **Extras** (`extraN` components): SA's mutually-exclusive optional parts modelled at the same spot (e.g. the
  Benson's swappable advertising boards, the mod admiral's exhaust-and-mudflap set). All alternatives ship in
  the model, each submesh tagged with its `extraN` frame; **the pick is per SPAWN**, made by
  `EngineVehicleHandle` and applied through the same per-instance submesh visibility that hides `_dam` and
  `_vlo`. So two cars of one model wear different optional parts, which is what SA does. It used to be a
  build-time `Math.random()` in the builder, which froze one alternative into the pak for every car in the
  world and re-rolled it on each convert (2026-07-22). Without a pick, all `extraN` atomics render on top of
  each other (overlapping jumble) — the viewer therefore shows the first and the lab's convoy walks them.
- **Physics** (plans 017/018): Rapier dynamic chassis from the COL convex hull, raycast wheels
  (suspension), handling.cfg parsed (kept for tuning), enter/exit flow with seat alignment
  (plan 016) — the run-to-door is interruptible (movement input or a blocked path hands control back,
  GTA-style), damage system (plan 019) using the full COL. The scripted clips
  (`car_getin_lhs`/`_rhs`, `car_getout_lhs`/`_rhs`, `car_sit`, `car_shuffle_rhs`, `car_crawloutrhs`)
  are requested BY NAME (shared const
  `VEHICLE_SCRIPTED_CLIPS` in `packages/game/src/vehicle/vehicle-clips.ts`) and resolved by the player from
  `ped.ifp` — a scripted clip registers only when it resolves (`duration > 0`), else the driver falls back to
  the standing locomotion pose (see character.md). While seated the ped rides the car's FULL orientation
  (tilts/flips with it), positioned at the `ped_frontseat` dummy.
- **Ingress/egress realism** (plan 088/09, 2026-07-24): the climb-in/out slides replay each clip's
  authored ROOT MOTION (extracted from the IFP by `rootMotion`, warped between the real doorway and
  seat by `warpAlongRootMotion` — a TC without the clip degrades to the old linear slide, and the
  slide runs the CLIP's duration, not a constant). Entry picks the NEAR front door: the passenger
  side opens `rf` (mirrored swing), climbs into the passenger seat and shuffles across on
  `car_shuffle_rhs`; the step-in walks a three-leg route around the OPEN panel (back along the
  1.2 m standoff ring past the swept edge, inboard behind it, forward into the doorway). Exit runs
  an egress chain — driver door → passenger door → windscreen crawl (`car_crawloutrhs` to a
  ground-anchored spot past the bonnet) → appear on the roof — each spot gated by two HORIZONTAL
  `PhysicsWorld.pathClear` rays at 0.35/0.85 m above the REAL ground under the car (a centre-height
  anchor grazed cambered roads and false-blocked the driver side), reaching 0.6 m past the doorway;
  the car, all sensors AND the rider's own collider are excluded. A WRECK (`!isUpright` — roof-down
  or on a flank) probes four planar exits (right → left → nose → tail) and crawls out the first
  clear one; the door that swings is mapped to the crawl-out's WORLD flank through the body's full
  orientation (`doorOnWorldFlank` — roof-down mirrors model x in world, so the yaw-frame name is
  the wrong panel), with appear-on-top when boxed in.
  Door choreography: per-side angle tracking; the exit door stays open while the player stands in
  the doorway and shuts once he steps clear (the same footprint trigger that restores collision).
- **LOD/streaming** (plan 021): HD/LOD/unload distances per vehicle, placements respawn.
- **Headlights** (plan 033, ⚠️ MVP — redo later): glowing lamp glass + coronas at the lamp dummies; lamps
  found by position near the `headlights`/`taillights` dummies; no road beam yet. See night-and-time.md.
- Spawn tooling: debug Vehicles screen lists **every** car from `vehicles.ide` (sorted, with a name filter);
  the list comes from `vehicleModelsFromIde` (apps/web) — no hardcoded car set.
- Parked cars come from the game's **`parked.json`** in the VFS (a `VehiclePlacement[]` shipped per game; read by
  `parseParkedVehicles` in apps/web). Absent → no parked cars. (Replaced the old hardcoded `GAME_CONFIG.vehiclesSpawn`.)
- Mods: a vehicle's model/texture/data can be overridden at runtime by dropping files under `modloader/` — no
  rebuild. The loader reads each model/txd by its **bare** name (from gta3.img, or shadowed by the overlay), so
  there's no loose `vehicles/` folder. See [mods.md](mods.md).

## Known gaps / candidates

- Headlights proper redo (road beam projected onto the asphalt; per-lamp brake/indicator/reverse) — MVP has none.
- No NPC traffic (headlight gating already generalizes via `seated`).
- Damage is collision-driven deformation state, not visual mesh swaps for every panel.
- No vehicle audio.
- **LEFTOVER — extras = "exactly one"**: the current `extraN` handling shows exactly one of the mutually-exclusive
  components, which covers the Benson (ad boards) and similar variant sets. SA's real rule is more nuanced — **two
  independent slots** chosen by the `carcols` component rules, each able to resolve to "nothing". If a vehicle ever
  needs **two simultaneous** extras (or a chance of **none**), that's a follow-up built on top of the same
  `hiddenExtraFrames` helper (it would need the carcols comp rules, which we don't parse yet).
- **LEFTOVER (engine) — carmods / vehicle upgrades**: `carmods.dat` is now **parsed** (`parseCarmods` in
  `@opensa/renderware`, added for the `vehicle-installer` tool's settings merge), but it is **not wired into the
  engine** yet — the in-game vehicle **component/upgrade** system (mod-shop parts, the `link`/`wheel` rules) is a
  future iteration. No adapter/runtime usage.
- **LEFTOVER (engine) — cargrp / population vehicles**: `cargrp.dat` (the per-ped-type vehicle distribution) is now
  **parsed** (`parseCarGroups` in `@opensa/renderware`, added for `vehicle-installer`'s `--strip`), but it is **not
  wired into the engine** — the in-game **population/traffic** car selection is a future iteration. No runtime usage.

## Test coverage anchors

`vehicle/build-vehicle-model.test.ts` (markers, modulate, parts, extras — synthetic + real
petro-6wheels.dff), `vehicle/textures.test.ts`, `adapters/vehicle-model-builder.test.ts`,
vehicle systems tests (physics/lod/damage), adapter vehicle data tests.
