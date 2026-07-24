# 06·06 — Pedestrians (sidewalk life)

[← chain](readme.md) · prev: [05 trains](05-trains.md)

Same agent machinery as traffic (03), different graph and different LOD chain — peds are the harder
RENDERING problem (skinned) and the easier SIM problem (slow, forgiving).

## Design

- **Sidewalk graph**: the ped node set from `nodes*.dat` (SA ships it — importer in 01); crossings link to
  the road graph at light-controlled nodes (peds get their own phase from the 04 controller: walk/don't-walk).
- **Population**: density fields per zone × hour (popcycle import) pick how many seeds live; `seed` →
  ped model from the zone's type mix + walk-speed personality. Scripted/mission peds are OUT of scope
  (they stay gameplay objects) — this plan is ambient life.
- **Behaviour v1 (deliberately shallow)**: follow sidewalk links, stop at crossings, cross on walk phase,
  seeded idles (stand/phone/look — a small state machine, one idle set from the SA anim pool). No combat,
  no reactions v1 — ambience first, systems later.
- **Ped LOD chain (the user's far-ped-draw ask)**:
  - Ring 0: full skinned ped (074/08 pipeline), full anim set;
  - Ring 1: skinned with the CHEAP path — one shared walk/idle clip per model class, lower bone count
    (SA's own ped meshes are light; the saving is in anim sampling and variety, not verts);
  - Ring 2: **imposter quads** — pre-rendered directional sprite sheets (8 yaw angles × 2-3 poses per model
    class, baked offline by the converter from the actual models — the AC Unity/Cyberpunk crowd trick),
    instanced like coronas; at night just a subtle dark silhouette (peds don't glow).
- **Imposter bake**: a converter stage renders each ped model class to a small atlas (offline, headless
  WebGPU or the lab in a bake mode) — plan 07 consumes the atlas.

## Tasks

- [ ] Sidewalk graph import + crossing↔controller linkage (01/04 hooks).
- [ ] Ped agents on the shared SoA machinery (03) with walk-phase compliance.
- [ ] Ring-1 cheap skinned path (shared clip, sampler reuse from 074/08).
- [ ] Imposter atlas bake stage + ring-2 instanced imposter pass (07).
- [ ] Density/type-mix population control; seeded idle state machine.
- [ ] Field acceptance: a busy Market street at noon and a sparse desert road at 4 am read correctly;
      crossings obey lights; no pop-in when rings promote.
