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

| Concern                         | Covered?               | Where                                                                                                                                                                                          |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera                          | ✅ plan 10 (B3)        | The game camera is GAMEPLAY code (renderer-agnostic per the plan-10 audit) — it produces a `CameraState` per frame; the engine consumes it. Follow-cam/collision logic reuses as-is            |
| Vehicles (render)               | ✅ here                | rigid part hierarchy → per-frame flatten into the transform storage buffer                                                                                                                     |
| Vehicle damage                  | ✅ here                | SA's ok/dam GEOMETRY STATES per part — damage = part-visibility swaps in the entity's part list (render side); the deformation physics idea is separate (ideas 0.6.0/01 VehDeform)             |
| Dummy hierarchies               | ✅ here (explicit now) | DFF frame/dummy tree (wheel*\*, door*\*, exhaust, headlight dummies) parses into the part hierarchy; dummies drive part transforms, light/exhaust anchor points, and the 2dfx attachment slots |
| Reflections (vehicle paint/env) | ✅ here                | SA sphere-map env WGSL port + carcols; per-pixel on the vehicle pipeline variant                                                                                                               |
| Reflections (world/planar)      | ❌ out of scope        | SA has no world planar reflections; if ever wanted → post-M4 idea                                                                                                                              |
| Character rigging               | ✅ here                | skinned pipeline variant, bone palette in storage buffer, DFF skin data                                                                                                                        |
| Character animation             | ✅ here                | OWN IFP sampler + thin crossfade re-implementation (three's AnimationMixer not portable) — THE early probe                                                                                     |

## Tasks

- [ ] **Skinning probe (early — gate M1→M2 boundary)**: storage palettes + WGSL skin + IFP sampler + probe note.
- [ ] Transform buffer + dynamic-offset draw path + entity registry (01 dynamics module made real).
- [ ] Character full: sampler crossfades, retarget (port the pure logic, drop the three mixer).
- [ ] Vehicles: DUMMY-tree parse → part hierarchy, part flattening, paint/env WGSL, night fill module, ok/dam damage part-swap hooks (render side only).
- [ ] Dynamics-only near shadow map pass + world/dynamics sampling.
- [ ] Particles/coronas instanced pass; procobj instancing.
- [ ] Ledger: skinning CPU+GPU ms (gate ≤ 1 ms), dynamics draw counts, near-shadow pass ms.

## Measurement ledger

(probe results; per-piece ms rows as they land)
