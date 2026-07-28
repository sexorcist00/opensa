# Vehicles

`packages/renderware/src/vehicle/` (`build-vehicle-model.ts` + `textures.ts` — renderer-agnostic model
build, run off the main thread by `packages/game/src/adapters/vehicle-model.worker.ts`),
`packages/game/src/vehicle/` (systems), `packages/engine/src/render/probe.ts` (the reflection probe),
host wiring in `apps/web/src/ui/engine-vehicles.ts`, plans 015–021/025/030/033 + 074/16.

Names that carry behaviour — the mod folder's files, the DFF frames, the lamp/plate materials, the data rows
— are collected in [contracts/vehicles.md](../contracts/vehicles.md).

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
- **Damage components sit on their `*_dummy` frame, not on their own.** A `<part>_ok` / `<part>_dam`
  atomic is placed at the nearest matching `<part>_dummy` ancestor and the transform of its own frame is
  DISCARDED — the original's rule: `CVehicleModelInfo::PreprocessHierarchy` runs `CollapseFramesCB` over
  every damageable component, which reparents the child atomics onto the component frame and then destroys
  the child frame. Stock SA hides the difference (of 756 `_ok`/`_dam` frames across 160 stock models, only
  62 carry a non-identity transform and the largest is 6 mm), but a mod can put anything there. Because the
  frame the swing uses is the DUMMY, **scissor / lambo doors work with no special case**: a mod that turns
  a hinge frame ABOVE the dummy so its local Z lies along the car's X gets a vertical opening for free
  (the 1995 Diablo does exactly this — and parks 1.518 m on the `_ok` frame, which used to throw its doors
  clear of the car, field 2026-07-28).
- **Retractable ("pop-up") headlights**, read off the model — there is no per-car list anywhere. A pop-up pod
  is a `misc_*` component (SA's generic moving-component slot) holding HEAD-LAMP faces, and it is authored
  PARKED: those faces look forward and DOWN into the nose. That pitch IS the feature, so the open angle is
  `atan2(-n.z, n.y)` of the pod's mean lamp normal — measured: stock **ZR-350 = 40.4°**, the 1986 Starion mod
  (`previon`) **= 52.6°**. Swept over the whole stock archive, 49 models carry a `misc_*` component and
  exactly ONE is detected (the zr350) — the dozer blade, forklift mast, tow crane and lowrider hydraulics hold
  no lamp face, and a lamp that already looks where it lights is a light BAR, which the 5°…100° band rejects.
  The pod rides the same signal that lights the lamps and travels over 0.7 s (`VehicleRig`, fixed step), and
  the LAMPS wait for it: a pod car's beam, glow and coronas only come on once the pods stand fully open, and
  die the moment they start folding back (field 2026-07-28 — a lamp still parked in the nose lit the bodywork).
  Cars without a pod are not gated at all. A mod whose pod uses its own texture instead of `vehiclelights`
  (so it carries no marker) can DECLARE itself: a
  `features.txt` in the mod folder holding `UP/DOWN_LIGHTS` — the Modloader/IVF convention. `vehicle-installer`
  copies each mod's declaration into `data/vehicle-features.txt`, and opensa-pack reads it while baking that
  car. That path is BUILD-time only, and there is no runtime path that could pick a declaration up later —
  which is why an unconverted car is refused at spawn rather than parsed from its DFF.
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
  BUILDER, so every caller of `buildVehicleModel` agrees by construction, and rides in the night set's alpha
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
- **Drivetrain** (plan 081/04, `vehicle/drivetrain.ts`): the original's own transmission, translated —
  `cTransmission::InitGearRatios` + `CalculateDriveAcceleration`. Gears split the speed range into bands with
  hysteresis, thrust falls with the gear (first pulls 4× top), `engineInertia` costs a beat of push on every
  shift, and `drive` (F/R/4) divides the engine by 2 or 4. **Air drag is what limits top speed** — `dragMult ×
  v² / 2000` against the whole velocity vector, so `fMaxVelocity` acts as the upper bound of the search for
  the point where drag balances the engine, not as a cap someone clamps to. Before this the whole longitudinal
  model was one constant force and a hard speed limit: every car pulled as hard at 140 km/h as at walking
  pace. Only the DRIVEN car gets drag today — nothing else in the world drives itself. The chassis linear
  damping (0.1) is a guessed constant the original does not have — it adds `0.1 × v` of phantom drag (~3× a
  sports car's authored figure at speed) — kept on a field verdict for now; retiring it is owed as its own
  single-variable step with a coast-down capture.
- **Standing pose + visible travel** (2026-07-27 audit; plan 081/06 §3's travel half): a car RESTS near full
  droop, by the original's own `SetupSuspensionLines` law — the wheel hangs `|suspLower| −
  weightShare/(forceLevel × axleBias) × span` below its dummy, so the body rides correspondingly high (the
  wheel-at-hub rule before it sat every car low in proportion to |lower|; the turismo's −0.20 made it the
  loudest). The DRAWN wheel follows the physics spring length through `VehicleRig` → `setWheel({ lift, spin,
  steer })` → `RigidEntity.setPartTranslation`, smoothed at the fixed step so raycast jitter does not read as
  a vibrating wheel.
- **Wheels lean the way the car was authored** (plan 081/06 §3): `handling.cfg`'s `modelFlags` names each
  axle — `NOTILT · SOLID · MCPHERSON · REVERSE`, the 5th hex digit for the front and the 6th for the rear —
  and the drawn wheels follow it. A **SOLID** axle is one beam, so both its wheels take `atan(Δlift / track)`
  and stay upright while the body leans over them (a pickup's rear end in a corner); an **independent** or
  McPherson axle leans a fraction of that with the compressed wheel taking its top inward; **NOTILT** stays
  square. The engine handle composes `steer(Z) ⊗ camber(Y) ⊗ spin(X)`, in that order, so a steered wheel
  cambers about ITS OWN forward axis and a rolling one does not drag its lean round with it. 27 rows of the
  built `handling.cfg` author an axle, 19 of them a solid rear one (savanna, tornado, picador, sadler,
  blade, towtruck, tractor…).
- **Wheels in the air** (plan 081/06, field report): a DRIVEN wheel with nothing under it spins with the
  ENGINE, not with the car — the original's own rule (`CAutomobile::ProcessCarWheelPair`: 250 rad/s² forward,
  125 backward, and its `±1.0` test is a refusal to fight a wheel already spinning the other way rather than
  a speed cap). Every other airborne wheel runs down at 0.95 per 1/50 s. On the ground the wheel turns with
  the car's real displacement, as before, so a parked car keeps its wheels still.
- **Air control** (plan 081/06 §1): with every wheel off the ground for 0.15 s, W/S pitch the car, A/D roll
  it and A/D with the handbrake yaws it — the original's own block (`CAutomobile::ProcessControl`), which
  works out as `1.75 rad/s²` per unit of stick for any car up to 3000 `fTurnMass` and proportionally less
  above it, with the original's 1 rad/s "do not fight a tumble" gate. The debounce is ours: four suspension
  rays blink off over a kerb where SA's contact-wheel count does not. `?airCtl=<×>` scales it (0 = off) and
  every `[phys]` capture records the value, because gravity here is 9.81 against SA's 20 — the same jump lasts
  about twice as long, so the same law buys about twice the rotation.
- **Driving controls** (plan 081/04): Space and back-while-rolling are the FOOT brake — it ramps in over 0.2 s
  and splits across the axles by `fBrakeBias`; **H is the handbrake**, and it is a REAR-AXLE LOCK, not a
  bigger brake (`CAutomobile::ProcessCarWheelPair` gives the rear wheels 20 000 and leaves the front alone).
  A locked wheel brakes with everything its tyre has and keeps only 3 % of its lateral stiffness, so the back
  steps out and the car rotates about a front axle that still grips — the SA handbrake turn. Off the throttle
  a car coasts on the original's own wheel friction (`fWheelFriction / mass`, a mass-independent retarding
  force), not on a share of its own brakes.
- **Steering** (plan 081/05): the full authored `fSteeringLock` is available, limited only by what the tyres
  can answer — the original's own limiter, `asin(min(adhesive × traction × 16 / v², 1)) / lock`, where
  `adhesive` is the rubber-on-road cell of `data/surface.dat` (4.5). It does not touch town driving (full lock
  to ~53 km/h) and tightens with the square of speed. Countersteering into a slide and the handbrake both
  restore full lock, as they do in the original.
- **Tyres** (plan 081/05 baseline + the 081/09 speed assist): grip per wheel is `fTractionMultiplier` read
  as a friction coefficient, split across the axles by `fTractionBias` — the field-liked baseline after
  every SA-derived scale (and the whole 2 g world, 081/08) was field-rejected; the postmortem
  (`docs/postmortem/081-vehicle-physics/sa-faithful-feel.md`) carries that story. On top of it, **the
  grip is scaled by WHAT THE WHEEL STANDS ON** (081/10): `surface.dat`'s rubber row through the surface under
  each wheel — tarmac 4.5 (unchanged), grass and gravel 3.2, sand 3.0, wet 2.8, rock 3.6 — read per wheel
  from the collision material, with the steering limiter given the SAME number so it never grants lock the
  tyre cannot answer. Note SA's own classification: `dirt` and `dirttrack` are group ROAD, so a dirt road
  grips like tarmac; what actually changes is grass, sand and rock. `?surfGrip=0` puts every wheel back on
  tarmac, and every capture records which world it drove in. On top of that, **the
  LATERAL grip grows with speed** (081/09): `frictionSlip × min(1 + (v/12 m/s)², 3)` — a deliberate,
  documented assist with the inverse shape of the "helpless at 130 km/h" complaint. Virtual only: the
  engine clamp and the brake cap stay on the unboosted grip, so launches, acceleration, braking, weight and
  town-speed feel are the baseline's, byte for byte. Dials are session-tunable (`?gripVd`, `?gripCap`) and
  every capture records the active values. The longitudinal clamp is applied on OUR side in
  `setVehicleControls`, because Rapier applies its own friction limit only when a wheel already has a side
  impulse — a car accelerating or braking dead ahead is otherwise unlimited. Engine force reaches driven
  wheels only (`nDriveType`). A wheel that has **broken loose grips less** (`fTractionLoss`, 0.72…0.85): past
  the limit a tyre does not merely stop giving more, it gives less, which is what makes a slide continue
  instead of self-correcting. Sliding is detected from the wheel's own impulses against its friction circle,
  because Rapier does not expose its `skid_info`.
- **Physics telemetry** (plan 081/01): `vehicle/vehicle-telemetry.ts` derives one frame per fixed step for
  the DRIVEN car — signed speed, lateral speed, body slip angle, per-wheel longitudinal slip ratio, pitch
  (**positive nose UP**, the sign the braking complaint is measured by), roll (positive right-side down),
  yaw rate, body-frame g (net Δv/dt, gravity excluded), and per wheel: contact, suspension compression as a
  fraction of travel, normal load, and the tyre impulses Rapier actually delivered. The math is pure — raw
  readings come in as plain data from `PhysicsWorld.readVehicleWheels` + the body, so the same sample
  sequence replays identically in a test. `EnterVehicleSystem.appliedControls()` supplies what `drive()`
  really applied (ramped engine force, slewed steer), not the raw input. **Off by default and inert then**
  (`vehicles.telemetry.enabled`); only the seated car is sampled, and its history resets when the player
  changes cars. This is the slip/speed channel plan 080/05 will read for drift framing.
- **LOD/streaming** (plan 021): HD/LOD/unload distances per vehicle, placements respawn.
- **Headlights** (plan 033, ⚠️ MVP — redo later): glowing lamp glass + coronas at the lamp dummies; lamps
  found by position near the `headlights`/`taillights` dummies; no road beam yet. See night-and-time.md.
- Spawn tooling: debug Vehicles screen lists **every** car from `vehicles.ide` (sorted, with a name filter);
  the list comes from `vehicleModelsFromIde` (apps/web) — no hardcoded car set.
- Parked cars come from the game's **`parked.json`** in the VFS (a `VehiclePlacement[]` shipped per game; read by
  `parseParkedVehicles` in apps/web). Absent → no parked cars. (Replaced the old hardcoded `GAME_CONFIG.vehiclesSpawn`.)
- Mods: a vehicle's model/texture/data is installed by `vehicle-installer` at BUILD time (`--rebake <game>
  [--only <model>]` re-does one car in ~3.6 s against an already-built game). There is no runtime overlay —
  see [postmortem/runtime-modloader-overlay.md](../postmortem/runtime-modloader-overlay.md). Assets resolve by
  their **bare** name, so there is no loose `vehicles/` folder. See [mods.md](mods.md).

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
vehicle systems tests (physics/lod/damage), adapter vehicle data tests,
`vehicle/vehicle-telemetry.test.ts` (channel signs and conventions, the rate channels reading 0 on the
first step, slip floors, the ring's order and capacity) and `physics/physics-world.test.ts`
(`readVehicleWheels` against real Rapier: airborne = no contact, resting = compressed springs whose loads
sum to the car's weight).
