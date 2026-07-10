# 070 — Local lights: headlights & street lamps (de-corona)

Part of the [rendering overhaul chain](062-rendering-overhaul.md). Depends on [064](064-hybrid-world-lighting.md) — a world that can RECEIVE light is what makes real local lights possible at all (038's unlit world was why headlights became glow+corona MVP, plan 033). Delivers the requested move away from the corona concept — partially: coronas remain as distant impostors.

## Context

- **Headlights** (`vehicle-headlight.system.ts`): lamp-glass emissive + 4 corona sprites, explicitly "to be redone properly"; no light hits the road.
- **Street lamps / 2dfx lights**: corona `Points` clouds per cell (`corona.ts`, `collectCoronas` in build-region); the pool of light under a lamp is BAKED night prelit, not projected light.
- three's forward renderer pays per-light per-object cost; dozens of real `PointLight`s would recompile programs and kill the frame. A custom light pool inside our world shader avoids all of that — we own the shader (038/002 legacy).

**Ruled out** (from the earlier headlights investigation, `vehicle-headlight.system.ts` notes — do NOT retry as-is): a real three `SpotLight` (can't light the world material meaningfully, barely visible even on dynamics), and a flat ground **decal / light-pool quad** on the road (sliced by uneven geometry, z-fights, ignores slope — reads badly). The pool term below is instead **per-fragment in world space** (using the world shader's existing `vWorldPosition`, already there for shadow sampling), so the beam conforms to road/curbs/walls/slopes automatically — that's precisely why it beats a decal.

## Decisions

1. **Custom clustered-ish light pool in the world material** (not three lights): a uniform array of the **N nearest/strongest lights** (N=16 base, 32 high tier) — position, colour, radius, cone (for spots). World shader iterates the array (cheap: no shadows, smooth radius falloff). Dynamics (MeshStandard) get the same lights mirrored as a few real three `PointLight`/`SpotLight` capped instances, or the same custom term injected — measured decision.
2. **Light sources registry**: 2dfx light entries (already collected per cell for coronas) become `LightDef`s with SA semantics (colour, radius from the 2dfx record, on-hours like tobj). A `LocalLightSystem` maintains the active pool by camera distance + priority (headlights of the player's car always win a slot).
3. **Headlights = 2 spot entries in the pool** + a **projected cookie** (the classic SA headlight texture projected onto the road via the spot cone term) + keep lamp-glass emissive. Beam visible on the road at night — the actual ask. Tail/brake lights: small red radius lights when braking.
4. **Corona demotion, not deletion**: within pool range the real light + bloom carries the look and the corona sprite shrinks/fades; beyond pool range the corona remains THE representation (SA-correct at distance, and free). One smooth handover curve, no popping (verify by driving toward a lamp line at night).
5. **No shadow-casting local lights** in this chain (budget); the pool term is purely additive light. Document as a known limit.
6. **Budget**: ≤ 1.0 ms at night in LV (worst corona/lamp density) for the pool term + projector.
7. **Wall-correct beams need normals; ground-only is the MVP.** Climbing the beam up walls uses N·L, so it wants decent normals — the map-optimizer conditioning (welded smooth normals, shipped) + 002's lit world provide them. A **ground-only** pool (assume an up-normal + cone) is the cheap fallback if per-fragment N·L is too costly or an area's normals are unreliable: ship the road pool first (the visible win), add the wall response after.

## Tasks

- [ ] `LightDef` extraction from 2dfx light records (reuse `collectCoronas` walk — one collection, two consumers: corona points + light defs) incl. on-hours; unit tests on fixture models (streetlight DFFs).
- [ ] `LocalLightSystem`: pool selection (distance/priority/hysteresis to avoid slot thrash), uniform packing, per-frame update in canvas-host.
- [ ] World-shader light-pool term (point + spot cone, smooth falloff, night-gated); program-variant safety (pool size fixed at compile, count as uniform).
- [ ] Dynamics path: mirrored capped three lights vs injected term — spike, measure, pick.
- [ ] Headlights: 2 spot slots per active vehicle (player + nearest AI few), cookie projection texture, brake/reverse states; retire the "no road beam" MVP note in plan 033.
- [ ] Corona handover: distance-based fade curve tied to pool membership; drive-by bench (no popping, no double-brightness at the crossover).
- [ ] Config `graphics.lights` grows `{pool: 16|32, headlightProjection: bool}`; debug overlay: pool occupancy readout.
- [ ] Bench: LV strip at night, downtown LS rain night (wet-look synergy noted for 009).

## Verification

- Night drive: headlight beam pools visibly on the road and walls, follows the car, brake flare works.
- LV lamp rows: pools of light under lamps from the POOL (not only baked prelit), coronas take over seamlessly at distance.
- Budget: ≤ 1.0 ms worst case; zero cost by day (pool empty → early-out).

## Measurements

_(record after implementation)_

- pool term ms at N=16/32 in LV night: …
- headlight projector ms: …
- chosen dynamics path: …
