# 06·07 — Far rendering (vehicle_vlo, corona streams, imposters)

[← chain](readme.md) · prev: [06 peds](06-peds.md)

The visual payoff: the city alive to the horizon. Everything here rides passes 074 already has — the
corona instanced pass and the dynamics instancing path; this plan is mostly DATA feeding them.

## Vehicles

- **Ring 1 — `vehicle_vlo`**: SA ships very-low LOD vehicle meshes; the converter packs the vlo pool into
  a shared vertex/texture arena (they are tiny), instanced per frame from ring-1 agent transforms. Wheels
  don't rotate at this distance; colour from the agent seed via carcols.
- **Ring 2 — light streams (the GTA-V signature)**: each far agent renders as 1–2 coronas: headlight pair
  (white, forward) + taillight pair (red, backward) at night; by day a single dim micro-quad in the body
  colour (cars read as moving specks). The existing corona pass takes these as extra instances — the only
  addition is a VELOCITY-aware source buffer (positions come from the flow tick each frame instead of the
  static cell tables). Budget: 2–4 k extra corona instances ≈ noise for the instanced pass.
- **Transition discipline**: vlo → corona hand-off at a distance band with dithered fade (no popping);
  promotion ring-1 → ring-0 happens off-screen or behind occluders when possible (frustum bias from 03).

## Pedestrians

- Ring 2 = the imposter atlas pass from plan 06 (instanced quads, yaw-indexed frame pick, day tint /
  night silhouette). Peds get NO coronas (they don't glow) — they simply fade out beyond ~700 m.

## Trains

- Ring 2 train = headlight corona + a lit-window STRIP quad per car at night (one stretched instance per
  car — the postcard effect from plan 05), body micro-quads by day.

## Night is the money shot — and it composes with existing work

The far light streams + the 074/15 baked lamp pools + the corona lamps give the full "living city at
night" frame: static lamps (baked + coronas), moving headlight rivers (this plan), lit windows (timed
objects + emissive mask). Each system is independent and cheap; the sum is the look.

## Tasks

- [ ] Converter: vlo pool arena (+ carcols tint table) — reuses the dynamics instancing path (074/08).
- [ ] Ring-1 vlo instanced draw from agent transforms.
- [ ] Corona-pass extension: dynamic instance source (flow-tick buffer) alongside the static cell tables;
      headlight/taillight orientation logic.
- [ ] Ped imposter pass (consumes 06's atlas).
- [ ] Train far representation (05's strip quads).
- [ ] Dithered LOD transitions + the frustum-biased promotion polish.
- [ ] Bench rows: night city flight with full far population — the whole plan gates on ≤ +1.5 ms GPU at
      2× retina; sim feed ≤ 0.5 ms CPU.
