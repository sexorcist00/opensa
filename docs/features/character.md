# Character

`packages/renderware/src/ped/build-ped-model.ts` (renderer-agnostic skinned model + bones),
`packages/engine/src/anim/` (`IfpSampler` — the clip player), `packages/game/src/character/`,
plans 008/011/012/013/036.

## Implemented

- **Skinned model**: Skin plugin → a plain `PedModelData` struct (vertices + `PedBone[]`, no GPU
  types — the character viewer builds the same thing); bones from the frame hierarchy
  (skin bone i ↔ frame i+1, frame 0 = dummy root); bind pose = raw mesh regardless of mapping;
  named-bone map for animation retargeting. The shipped player is `male01` (`PLAYER_MODEL` in
  `apps/web/src/ui/engine-player.ts`), loaded from `male01.osm` — see "Where the OWN-ENGINE player comes
  from" below.
- **Root anchoring** (`anchorRootBone`): the root bone's rest position is snapped to the skin's authoritative
  bind translation (`inverse(boneInverse)`). The IFP root **translation** track is dropped (locomotion stays
  in-place — physics owns position), so the root bone would otherwise keep its DFF **frame** position. Standard
  peds author that at the origin (matching the skin bind), but some mods offset the root frame (e.g. gostown's
  `BMYPOL1` puts `Root` at +2.16) — which would shove the whole body off the entity pivot (off-centre, with
  rotation orbiting the offset). The snap is a no-op when the frame and skin bind already agree.
- **Animation** (plan 012): ANP3 IFP parsing (quaternions i16/4096, times i16, root translation
  i16/1024) → `PedClip` (quaternion tracks per skin-order bone; translation opt-in), played by the
  engine's `IfpSampler`;
  `ped.ifp` is loaded **directly** (`loadAnimations(ifpUrl)` → `anim/ped.ifp`, no packed archive);
  `CharacterAnimationSystem` (idle/walk/run
  states, speed-matched locomotion — root motion stripped, physics owns position).
- **Physics** (plans 008/013): bitECS entity + Rapier capsule/box controller, gravity, map
  collision, jump, slope handling; respawn/teleport debug actions. The game's `playerSpawn`
  (`GAME_CONFIG`, `apps/web/src/game-config.tsx`) is the single source for where the player starts — it seeds both the
  player capsule and the initial collision zone (`loadGame` centres on it), so there is ground under the drop
  (Ganton on `original`).
- **Night lighting**: the ped is dynamically lit (sun/moon + indirect) by the engine's `ped` pipeline —
  no prelit. The indirect term is the SAME hemispheric weight the vehicles use (`skyVisibility` ×
  `DYNAMIC_INDIRECT`, shared through the `<frame>` shader module, plan 084 → 087 ped): a flat
  `vec3f(params.y)` gave the body no readable edges at night, when the sun term is gone and indirect
  dominates (peds carry no baked AO, so `DYNAMIC_INDIRECT × skyVisibility(normal)` is the whole weight). The
  old plan-034 "night fill" shader was removed with the three renderer and has **no replacement yet**; the
  moonlight band carries the night read (see night-and-time.md).
- **Follow camera** (plan 036): spherical rig in `Config.camera`; auto-trail only on direction
  CHANGE (not continuous), free mouse look wins, pitch manual-only; zoom wheel with min/max;
  debug Camera screen sliders.

## Known gaps / candidates

- Single character model; no CJ/ped variety, no ped NPCs.
- Animation set is locomotion + vehicle enter/exit; no combat/swim/climb.
- IFP translation tracks unused for the player (physics-driven) — used for map objects instead.

## Where the OWN-ENGINE player comes from (opensa-pack 003 phase 5f, 2026-07-19)

`apps/web/src/ui/engine-player.ts` used to `fetch('/ped/ped.json' + '/ped/ped.bin')` — the LAB's probe
fixture, baked by `ped-probe`, served over HTTP **in the production host**. So the shipped player was
whatever a developer last converted, with its animations frozen at bake time, and the game directory the
user picked had no say in it.

It now loads `male01.osm` from the archives through the VFS, and resolves `idle_stance` / `walk_civi` /
`run_civi` — plus the scripted vehicle clips `car_getin_lhs` / `car_getout_lhs` / `car_sit` that
`EnterVehicleSystem` drives by name — from the game's own `ped.ifp` at load, so a modded IFP changes how the
player walks AND sits. A scripted clip is only registered under its name when it actually resolves
(`duration > 0`); an absent one falls through to the standing locomotion stand-in rather than an empty clip
(which would drop the ped to the flat bind pose). Before this the scripted names resolved to nothing, so the
driver rode STANDING with his legs out of the car. Two traps
this path carries, both found in the field and not by tests:

- the IFP is keyed `anim/ped.ifp` in the browser VFS and bare `ped.ifp` in the archives, and **with no clips
  the sampler holds the BIND pose — SA's bind mesh lies along X, so the player lies flat on the ground**;
- `minZ` is the lowest POSED vertex (the feet level the host aligns to the capsule), so the converter has to
  pass `options.poseWith`; measured on the bind pose instead, the player sinks in to the knees.

The lab reads the same way now (plan 079 phase 2): `?ped` decodes `<model>.osm` + `anim/ped.ifp` from the
served build through `readPedOsm` + `parseIfp`. So the `ped-probe` CLI and its `ped.json`/`ped.bin` fixture
were retired (plan 079 phase 5) — nothing bakes a ped fixture any more; the `.osm` IS the format.

## Test coverage anchors

`ped/build-ped-model.test.ts` (real fixtures: `bmypol1`, and `army` for the HAnim ≠ frame-order case),
`engine/src/anim/ifp-sampler.test.ts`,
`ifp` parser tests, `character-controller.system.test.ts`, `ui/engine-camera.test.ts`.
The converted-ped path: `tools/opensa-pack/src/no-data-loss.test.ts` (every skinned buffer byte for byte,
the whole skeleton, `minZ`, and every texture present across arrays).
