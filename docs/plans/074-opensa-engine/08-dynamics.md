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
- [ ] IDE anim objects: dynamic-entity promotion + IFP playback on the frame tree (replaces the static-weld
      freeze of 06 row 17; converter grows the exclusion/objectTable flag for promoted defs).
- [ ] Breakables: objectTable `breakable` kind (hide intact run on hit) + debris entities (plan-045 parity).
- [ ] Particles/coronas instanced pass; procobj instancing.
- [ ] Ledger: skinning CPU+GPU ms (gate ≤ 1 ms), dynamics draw counts, near-shadow pass ms.

## Measurement ledger

(probe results; per-piece ms rows as they land)
