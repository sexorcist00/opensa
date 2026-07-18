# Character

`packages/renderware/src/ped/build-ped-model.ts` (renderer-agnostic skinned model + bones),
`packages/engine/src/anim/` (`IfpSampler` — the clip player), `packages/game/src/character/`,
plans 008/011/012/013/036.

## Implemented

- **Skinned model**: Skin plugin → a plain `PedModelData` struct (vertices + `PedBone[]`, no GPU
  types — the offline `ped-probe` CLI and the character viewer build the same thing); bones from the frame hierarchy
  (skin bone i ↔ frame i+1, frame 0 = dummy root); bind pose = raw mesh regardless of mapping;
  named-bone map for animation retargeting. Current model: the selected game's `mainCharacter` (a `peds.ide`
  ped, e.g. `BMYPOL1`; `apps/web/src/game-config.tsx`), loaded via `adapter.loadCharacterByModel`.
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
  no prelit. The old plan-034 "night fill" shader was removed with the three renderer and has **no
  replacement yet**; the moonlight band carries the night read (see night-and-time.md).
- **Follow camera** (plan 036): spherical rig in `Config.camera`; auto-trail only on direction
  CHANGE (not continuous), free mouse look wins, pitch manual-only; zoom wheel with min/max;
  debug Camera screen sliders.

## Known gaps / candidates

- Single character model; no CJ/ped variety, no ped NPCs.
- Animation set is locomotion + vehicle enter/exit; no combat/swim/climb.
- IFP translation tracks unused for the player (physics-driven) — used for map objects instead.

## Test coverage anchors

`ped/build-ped-model.test.ts` (real fixtures: `bmypol1`, and `army` for the HAnim ≠ frame-order case),
`engine/src/anim/ifp-sampler.test.ts`,
`ifp` parser tests, `character-controller.system.test.ts`, `ui/engine-camera.test.ts`.
