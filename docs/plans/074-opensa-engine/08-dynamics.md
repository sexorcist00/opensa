# 074·08 — Dynamics (character, vehicles, particles, procobj)

[← chain](readme.md) · prev: [07 baked](07-baked-channels.md) · next: [09 post-FX](09-postfx-aa.md)

The grind — scheduled with an EARLY architecture probe so skinning can't invalidate the renderer late (the
concept's explicit risk). Dynamics render through the direct-encoder path (01): flat entity list, transforms in
one storage buffer with dynamic offsets, NEVER inside static bundles (the 073 barberpole lesson).

## The early skinning probe (runs right after M1, not in M3)

One skinned mesh (CJ, one idle clip) through the whole intended path: bone palette in a storage buffer,
vertex WGSL skinning, an OWN IFP clip sampler (the prod `AnimationController` rides three's `AnimationMixer` —
NOT portable; the sampler is small: keyframe lerp/slerp over the parsed IFP data we already have).
**Purpose: freeze the bind-group/vertex-layout consequences of skinning while the architecture is still soft.**
Deliverable = a lab toggle + a one-page "what it forced us to change" note in this doc.

## Full scope (M3)

| Piece                                   | Design                                                                                                                      | Reuse                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Character                               | skinned pipeline variant; palette/frame in storage; A-pose→clip via own sampler                                             | IFP parser, bones/retarget logic (pure parts), setup-character data |
| IFP animation set                       | sampler + crossfade (the controller's blend semantics re-implemented thin)                                                  | clip tables, existing anim names/config                             |
| Vehicles                                | rigid part hierarchy flattened per frame into the transform buffer; damage = part swaps; paint/env: SA sphere-map WGSL port | build-vehicle part logic (data side), carcols, reflection math      |
| Night fill (plan 034)                   | WGSL module on the dynamics shader                                                                                          | 073 night-fill port (emissive hemisphere + rim)                     |
| Near shadow (dynamics-only)             | one small map rendered from casters; world+dynamics sample it near-field                                                    | 07 decision; sky-lite sun arc drives it                             |
| Particles / coronas / headlight sprites | instanced billboard pass (06·13 shares it)                                                                                  | shader math                                                         |
| Procobj clutter                         | TRUE instancing (one draw per batch × placements) — the natural instancing case                                             | procobj placement/wind data                                         |
| Physics/gameplay                        | NOT here — the lab drives entities from recorded paths; real gameplay arrives in 10                                         |                                                                     |

## Coverage matrix (user checklist, 2026-07-12 — where each concern lives)

| Concern                         | Covered?               | Where                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera                          | ✅ plan 10 (B3)        | The game camera is GAMEPLAY code (renderer-agnostic per the plan-10 audit) — it produces a `CameraState` per frame; the engine consumes it. Follow-cam/collision logic reuses as-is                                                                                                                                                                                                           |
| Vehicles (render)               | ✅ here                | rigid part hierarchy → per-frame flatten into the transform storage buffer                                                                                                                                                                                                                                                                                                                    |
| Vehicle damage                  | ✅ here                | SA's ok/dam GEOMETRY STATES per part — damage = part-visibility swaps in the entity's part list (render side); the deformation physics idea is separate (ideas 0.6.0/01 VehDeform)                                                                                                                                                                                                            |
| Dummy hierarchies               | ✅ here (explicit now) | DFF frame/dummy tree (wheel*\*, door*\*, exhaust, headlight dummies) parses into the part hierarchy; dummies drive part transforms, light/exhaust anchor points, and the 2dfx attachment slots                                                                                                                                                                                                |
| Reflections (vehicle paint/env) | ✅ here                | SA sphere-map env WGSL port + carcols; per-pixel on the vehicle pipeline variant                                                                                                                                                                                                                                                                                                              |
| Reflections (world/planar)      | ❌ out of scope        | SA has no world planar reflections; if ever wanted → post-M4 idea                                                                                                                                                                                                                                                                                                                             |
| Character rigging               | ✅ here                | skinned pipeline variant, bone palette in storage buffer, DFF skin data                                                                                                                                                                                                                                                                                                                       |
| Character animation             | ✅ here                | OWN IFP sampler + thin crossfade re-implementation (three's AnimationMixer not portable) — THE early probe                                                                                                                                                                                                                                                                                    |
| IDE anim objects (world)        | 🟡 static now → here   | Welded STATIC at bind pose since the 2026-07-12 field fix (06 row 17 — skipping them deleted whole buildings). Runtime IFP playback = promote the instance to a dynamic entity (same IFP sampler as characters, frame-tree transforms per clip frame); the welder then needs an `--anim-dynamic` exclusion so promoted defs stop being baked into bundles                                     |
| Breakable props (plan 045)      | ✅ here (explicit now) | Old path registers smashables per HD cell (`collectBreakables`). Own engine: breakables are welded into the static bundle until HIT — on break, carve = per-instance groups stay addressable via the objectTable mechanism (06 row 9's kind byte has room for a `breakable` kind: hide the intact run, spawn debris as dynamic entities). Same promote-on-interaction pattern as anim objects |

## Probe note (B1, 2026-07-13 — what the probe built and what it forced)

**Built (one ped through the whole intended path):** `tools/opensa-pack/src/ped-probe.ts` extracts a
throwaway fixture (`public/ped/ped.json+bin`) — male01 + IDLE_stance/WALK_civi (1166 verts, 32 bones);
`packages/engine/src/anim/ifp-sampler.ts` (own keyframe slerp → palette, zero steady-state allocation);
pipeline #11 `ped` (storage-buffer matrices: slot 0 = model, bones follow; 4-bone vertex blend; textured
sun/indirect + shared fog); lab `?ped=1` (+`?pedy=` height), HUD `ped sampler` ms line, clips alternate 6 s.

**What it forced / froze (the probe's purpose):**

1. **A second vertex layout family.** Dynamics do NOT ride the `.oscell` interleaved stride-36 layout —
   the ped uses five tight attribute buffers (pos/normal/uv/joints u8x4/weights unorm8x4). Consequence:
   pipelines are keyed by layout FAMILY, not just effect — accepted, the registry stays enumerable (11).
2. **Bind model holds.** Group 0 (frame UBO + sky LUT) is shared untouched; dynamics live in their own
   group 1 (storage matrices + texture). No bind-group-layout churn was needed — the 01 frequency model
   survives skinning.
3. **Palette convention:** [model, bone 0 …] in ONE storage buffer, model matrix owns the GTA→engine axis
   change (geometry stays native RW bind space — parity with the prod skinned path, and the transform
   buffer generalizes to vehicles' part hierarchies).
4. **The prod bone lore ports cleanly:** HAnim skin-order mapping, skin-plugin inverse binds (pad-row
   fix), root anchoring, in-place locomotion (no root translation) — all re-encoded in the extractor,
   sampler parity pinned by unit tests (bind-pose identity, child-carry, slerp/wrap).
5. **Textures:** probe uses a plain `texture_2d` (rgba8unorm-srgb). M3 will need the real ped TXD set
   through `.ostex` (1-layer arrays or a dedicated dynamics texture path) — open, deliberately not decided
   by the probe.

## Tasks

- [x] **Skinning probe (early — gate M1→M2 boundary)**: storage palettes + WGSL skin + IFP sampler + probe
      note — 2026-07-13, see above. FIELD ✅ same day: the ped renders and both clips animate through the
      own sampler (`?ped=1` on the full-LS pak; two boot fixes on the way — writeBuffer %4 padding on the
      odd u16 index payload, and a zoomed camera start: a 1.8-unit ped is subpixel at a city orbit radius,
      and the default probe height sat below the terrain — `?pedy=` overrides). The ≤1 ms sampler ledger
      row: HUD reads the cost per frame; record it with the B2 entity-count measurements.
- [x] **(B5 step 1) Engine capability for real vehicles — 2026-07-14.** The B2 probe was a SINGLE slot
      (`private vehicle` + `setVehicleProbe` evicting the previous car) drawing every submesh
      unconditionally: nothing the gameplay needs (many parked cars, `_ok`/`_dam` swaps, `_vlo` bands,
      detached debris, door hinges, wheel scale) was expressible. Now:
      **MODEL ↔ INSTANCE split** — `createVehicleModel` uploads geometry + the texture array once;
      `createVehicle` spawns instances that SHARE them, each owning its own `RigidEntity`. All instances of a
      model live in ONE matrix storage buffer and draw with `firstInstance = slot × partCount + part`, so the
      **WGSL is unchanged** from the single-probe days (it already read `matrices[instance_index]`). Capacity
      starts at 8 and DOUBLES on demand (buffer + bind group rebuilt — safe precisely because vehicles are
      never recorded into a cell bundle; the row-15 immutability lesson applies to bundles only). Growth
      re-uploads live instances immediately, else a frame drawn before the next `updateVehicles()` reads an
      uninitialized buffer and flings the existing cars across the map for one frame.
      **Per-submesh visibility** per instance (`setSubmeshVisible`) — the one primitive behind damage swaps,
      LOD bands and detach, because prod expresses all three as three's `.visible`.
      **`RigidPartInit` gained `pivot` and `scale`; `RigidEntity` gained `setPartWorldMatrix`** — doors swing
      about the `door_*_dummy` hinge rather than the part origin (prod pivots a parent Group there), wheels
      take `vehicles.ide` wheelScale, and a detached part carries its own WORLD matrix, bypassing root and
      locals: the own engine has no scene graph to `parent.attach()` debris into, and this is its stand-in.
      Lab: `?vehicle=N` drives an N-car convoy off ONE model (the multi-instance check). 3 new unit tests
      (hinge swings about the pivot, uniform scale pins the origin, detach ignores the root and re-attaches).
      KNOWN COST KNOB: one draw per visible submesh per car (the landstal fixture has 73) — fine for a
      handful of cars, to be measured when a street's worth of parked cars lands in B5 step 4.
- [x] **(B5 step 2) Shared vehicle BUILDER — 2026-07-14.** `@opensa/renderware/vehicle/build-vehicle-model`
      (+ `vehicle/textures`, `vehicle/types`): renderer-agnostic, browser-callable, so the game builds a car
      at SPAWN time instead of loading a pre-extracted fixture. Signature mirrors prod's
      `buildVehicle(clump, textures, options)`, so tests pass synthetic clumps exactly like the three one.
      Carries the lore the B2 probe SKIPPED: all four wheel conventions (shared `wheel`, per-corner
      `wheel_lf|rf|lm|rm|lb|rb`, the `f_wheel_*` container, and the lone-corner = MIS-NAMED-shared fallback
      that saves comet-style mods), `_ok`/`_dam` damage twins, `_vlo` LOD meshes, `extraN` mutually-exclusive
      alternatives, door hinges, `vehicles.ide` wheelScale, lamp head/tail tags, the night lamp twin.
      **PAINT IS A SLOT, NOT A BAKE** (the design decision of this step): the probe baked carcols into vertex
      colours, which with shared-per-model geometry would mean ONE colour per model — a street of identical
      parked cars, or a geometry copy per colour. Now the vertex carries a paint SLOT (`meta.z`: 0 = the
      material's own colour, 1-4 = primary/secondary/tertiary/quaternary) and the engine resolves it PER
      INSTANCE from a new paint storage buffer (rigid bind group binding 3), indexed by the same
      `instance_index` as the matrices — 4 colours replicated per part row, which costs a few hundred bytes
      per car and avoids both a partCount uniform and an integer divide in the vertex shader.
      `VehicleInstance.setPaint()`; written on spawn/change, never per frame (so a capacity grow must restore
      it — it does). Marker colours (lamp IDs and paint markers) now render WHITE: leaving the marker in the
      vertex colour would paint the car marker-green the moment a slot lookup missed. A test caught exactly
      that.
      `frameWorldTransform` + `rotationToQuat` MOVED opensa-pack → `renderware/mesh/frame-transform` (one
      implementation, two consumers — the welder and the builder). `vehicle-probe.ts` is now a THIN CLI over
      the builder (500 → 120 lines): it only bakes the fixture the lab reads, so the lab needs no DFF parser
      and no game VFS. Fixture type `VehicleFixture` lives with the model, shared by CLI and lab.
      REAL-DATA CHECK (landstal): 18 parts, **4 doors, 44 `dam` submeshes, 6 `lod` submeshes** — all three
      were ZERO before; 123 submeshes total of which 73 visible, so the draw count is unchanged.
      9 builder unit tests. Golden WGSL snapshot updated (the paint lookup).
- [x] **(B5 step 3) `VehicleHandle` — three is OUT of vehicle gameplay — 2026-07-14.** The plan-10 audit's
      Tier 0. `packages/game/src/vehicle/vehicle-handle.ts` is the renderer-agnostic contract gameplay drives
      a car through: `setTransform` · `setWheel(i, spin, steer)` · `setDoorAngle(side, angle)` ·
      `setPartDamaged` · `detachPart`/`setDetachedPose`/`removeDetached` · `setLodBand` · `doorHinge` ·
      `parts`/`wheels`/`hasLod`. Everything crossing it is plain data.
      Ported: `VehicleRig` (now PURE arithmetic — it emits ANGLES, the renderer makes rotations),
      `VehiclePhysicsSystem`, `VehicleDamageSystem`, `VehicleLodSystem`, `EnterVehicleSystem` (its
      `followTarget` takes the VEHICLE now; the host resolves it to something three can track).
      DELETED `vehicle-door.ts` / `vehicle-part.ts` (three types that only the renderer needs).
      **Detached debris was the awkward one** (the audit flagged it): prod re-parented the panel into the
      scene graph with `attach()` and let three carry it. The own engine has no graph, so the fall is now
      PLAIN DATA in the damage system (position/velocity/spin/rotation), pushed out as a world pose per
      frame; the three adapter still does the `attach()` internally so its behaviour is bit-identical.
      `ThreeVehicleHandle` (`game/adapters/`) holds every scene-graph mutation the logic used to do inline —
      a MOVE, not a rewrite; `disposeVehicle` moved out of canvas-host into it (materials included: my first
      draft dropped them and would have leaked).
      RESULT: `grep 'from three'` over `game/src/vehicle/` returns only `Vector3`/`Quaternion` MATH — no
      `Object3D`, no `.visible`, no `.attach`, no `.traverse`. The one exception is
      `VehicleHeadlightSystem`, ~80% renderer-specific (sprites/materials/uniform arrays) and explicitly
      deferred to step 5; until then it reaches the render object through the three handle.
      Tests now assert the CONTRACT, not three internals: new `FakeVehicleHandle` recording double; rig,
      damage, LOD, physics and enter-vehicle suites rewritten against it (52 vehicle tests green, full suite
      1920). Prod behaviour is unchanged by construction — field check owed on the WebGL path.
- [x] **(B5 step 4) Cars in the GAME on the own engine — 2026-07-14 (awaiting field check).**
      `EngineVehicleHandle` (game/adapters) = the twin of the three handle: chassis pose → the entity ROOT
      (the GTA Z-up → engine Y-up change rides in that one matrix), wheels/doors → per-part animation
      rotations, `_ok`/`_dam` + `_vlo` → submesh visibility, a detached panel → its own WORLD matrix. Damage
      and LOD compose through ONE visibility decision (`setLodBand` is the only writer), else a damaged panel
      would reappear intact on an LOD swap. A detaching panel inherits the BODY's rotation — handing back
      identity would snap it flat the instant it came off a moving car.
      `GtaSaWorldAdapter.loadVehicleData()` = the renderer-agnostic sibling of `loadVehicle` (both now share
      one `vehicleCommon` — def/DFF/COL/half-extents/handling/paint), plus `vehiclePaint()` so a spawn can
      resolve carcols WITHOUT re-parsing the DFF. `engine-vehicles.ts` wires the REUSED systems (physics →
      damage → enter/exit → LOD, the three host's exact order) and holds the **model cache: one uploaded
      model per car TYPE, one instance per car** — the whole point of the B5 engine work. The model is
      colour-AGNOSTIC by construction (paint is a per-instance slot), so a street of Landstalkers shares one
      geometry+texture upload and differs only by part matrices and four colours.
      NEW SEAM the plan-10 audit missed: `EnterVehicleSystem` depended on the three
      `CharacterAnimationSystem` for the climb-in/sit/climb-out clips. Narrowed to a `VehicleAnimator`
      interface (`faceTo` + `setScripted`) that BOTH renderers satisfy structurally; `engine-player` grew
      scripted-clip playback (one-shot clips HOLD their last pose — the seated driver stays seated) and the
      ped fixture was re-extracted with `car_getin_lhs, car_sit, car_getout_lhs` (they were already in
      ped.ifp; the probe's `--clips` list just never asked for them).
      Field: `?engine=opensa` — walk to a parked car, enter, drive. Camera trails the CAR while seated (the
      rider is teleported into the seat every frame; following the ped would judder).
      KNOWN GAPS (step 5): headlights/lamp state (the three-only `VehicleHeadlightSystem` is not wired into
      this host) and map car generators (parked.json only for now — generators need the city-box resolver
      the three host builds).
- [x] **(B5 step 5) Vehicle LAMPS ported — 2026-07-14 (awaiting field check).** The plan-10 audit called the
      headlight system ~80% renderer-specific and recommended splitting it into a pure producer + renderer
      sinks. Done exactly that.
      PURE (`vehicle-lamps.ts`, shared by BOTH renderers): `lampStateFor()` — which car is lit and whether it
      is braking (occupant-agnostic, so NPC traffic drops in unchanged) — and `lampsOf()` / `lampAnchorsOf()`
      — the four lamps in world space (SA authors ONE dummy per end and mirrors it to ±X; half-extents
      fallback for models with none).
      HANDLE: `setLamps(state)` + `lampAnchor(kind)`. The three material poking (texture twin swap +
      `emissiveMap` glow) MOVED out of the system into `ThreeVehicleHandle` — where it belongs; the system
      kept only its sprites and uniform arrays and now calls the shared decision.
      ENGINE: **per-instance lamp state** (storage buffer #4, one vec4 per matrix row: headlights, brakes,
      config intensity), replacing the GLOBAL day/night gate in the shader — which lit every parked car in
      the city at once. The per-vertex lamp TAG rides `meta.w` (`LampTag`), so the fragment shader can glow a
      lamp texel: lit lamps SELF-ILLUMINATE (shading them like painted metal left a dull grey patch at
      night), tails run dim and jump to full on the brakes. Head/tail coronas + the beam pool lights feed the
      **existing** corona pass and light pool through `Engine.dynamicCoronas` / `dynamicLights` — no second
      corona renderer. Host coronas fill BEFORE the world's dn early-out: they carry their own night gate.
      `VehicleLampSystem` (renderer-agnostic, sink-driven) wires it in the engine host.
      Field: `?engine=opensa` at night — drive, brake, get out (the lamps must go dark when the driver
      leaves: lamp state lives on the VEHICLE, not on the system).
      REMAINING in 08 (unchanged): headlight cone v2 (the pool entry is still a forward-offset POINT light),
      vehicle reflections (deferred out of B5 by the user), map car generators on the engine host.
- [ ] Transform buffer + dynamic-offset draw path + entity registry (01 dynamics module made real).
- [ ] **Vehicle lamp STATE** (user spec 2026-07-13): lamp submeshes carry `head`/`tail` tags from the SA
      marker colours (extractor done); runtime needs per-vehicle state — headlights on/off (texture twin
      swap is currently dn-gated globally), BRAKE lights (tail lamps glow bright on braking, like a real
      car), reverse later. Lands with the B3 game wiring (the entity gains gameplay inputs there).
- [ ] **Headlight beams v2**: today's pool entry is a forward-offset POINT light; upgrade to a directional
      cone (the prod modern-pipeline 070 headlight look) — spot term in the pool struct (direction + angle
      in the spare w slots).
- [ ] **Vehicle LOD** (user spec): swap to the `chassis_vlo` mesh at range (extractor currently SKIPS
      `_vlo` atomics — carry them as a fixture LOD part set) and drop lamp submeshes to CORONA-only
      rendering (the 2dfx corona pass already exists; lamp dummies are in the fixture).
- [ ] Character full: sampler crossfades, retarget (port the pure logic, drop the three mixer).
- [ ] Vehicles: DUMMY-tree parse → part hierarchy, part flattening, paint/env WGSL, night fill module, ok/dam damage part-swap hooks (render side only).
- [ ] Dynamics-only near shadow map pass + world/dynamics sampling.
- [ ] **(B7·b)** IDE anim objects: dynamic-entity promotion + IFP playback on the frame tree (replaces the
      static-weld freeze of 06 row 17 — the converter welds anim defs at BIND POSE and only counts them,
      `weld.ts:153` `animatedStatic` = 64 instances map-wide; converter grows the exclusion/objectTable flag
      for promoted defs). Inventory prod's UV-scroll animation (`renderware/src/three/uv-anim.ts`) here too.
- [ ] **(B7·a)** Breakables: objectTable `breakable` kind (hide intact run on hit) + debris entities
      (plan-045 parity; prod side = `renderware/src/three/breakable.ts` + `build-debris.ts` + the
      `object.dat` parser). NB a recorded cell bundle is IMMUTABLE — breakables must live outside it.
- [ ] **(B6)** Particles/coronas instanced pass; procobj instancing.
- [ ] Ledger: skinning CPU+GPU ms (gate ≤ 1 ms), dynamics draw counts, near-shadow pass ms.

## Measurement ledger

| Date       | Piece                                     | Number                                                                                                                                        | Gate                       |
| ---------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 2026-07-13 | B1 IFP sampler + palette upload (in-game) | **0.00 ms/frame** (below the 0.005 ms display resolution; male01, 32 bones, idle — HUD field reading on the B3 host, Grove Street live scene) | ≤ 1 ms ✅ (~200× headroom) |
| 2026-07-13 | B3 whole-frame context of that reading    | frame 8.33 ms vsync · submit 0.10 ms · GPU 1.70–2.10 ms · draws ~450 · residency ~540–590 MB                                                  | vs three-WebGL ~31 ms GPU  |

(vehicle-entity flatten/update ms + per-piece rows join as M3 pieces land)
