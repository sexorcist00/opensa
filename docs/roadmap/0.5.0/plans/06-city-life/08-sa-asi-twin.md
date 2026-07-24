# 06·08 — The SA ASI twin (city life inside real SA)

[← chain](readme.md) · prev: [07 far rendering](07-far-rendering.md) · relates: `asi/perfect-map`
(our proven ASI infrastructure: RE catalogue, sidecar hooks, HOODLUM offsets, the exact-exe guard)

The same living city, running inside real San Andreas. The engine work (01–07) is the design lab; the ASI
ports the RESULT — one format, one simulation semantics, two hosts.

## Scope (user, 2026-07-12)

1. **Suppress the vanilla ambient population** — hide/disable SA's own random peds and cars (scripted/
   mission entities stay untouched): the population budget frees up for OUR agents.
2. **Read OUR `.ospath` format** — the full city machinery (routes, lights, barriers, trains, density)
   comes from the same file the engine uses; the editor (02) becomes the modding tool for real SA too.
3. **Far draw for cars and peds** — SA's ~100 m population bubble becomes kilometres: vlo meshes +
   corona light streams + imposters, exactly the 07 tiering.

## How (building on perfect-map.asi experience)

- **Population suppression**: SA's population manager has well-known seams (the community has done
  "no random cars/peds" many times): zero the ambient spawn budgets / early-out the random spawn
  functions via sidecar hooks (our established pattern — no body overwrites, HOODLUM-relocation aware).
  Scripted entities spawn through different paths and are untouched by design.
- **Ring 0 through SA itself**: near the player we SPAWN REAL SA vehicles/peds (the game's own entity
  factories) and drive them along our routes via their AI primitives (autopilot/tasks) — SA remains the
  physics+behaviour host for the near ring, we are the router. Promotion/demotion mirrors 03: a far agent
  materializes as a real CVehicle when close, serializes back to the array when far.
- **Rings 1/2 renderer**: a custom render injection (the perfect-map 2dfx work already draws through SA's
  pipelines): vlo models via SA's own renderer at extended ranges; coronas via SA's corona API (it EXISTS
  in-engine — `CCoronas::RegisterCorona` — the far light streams are almost native); ped imposters as
  sprites through the same path.
- **The sim tick lives in the ASI** (C++ port of the 03 flow/kinematic ticks — they are array math by
  design, portable by construction; this is WHY 03 forbids allocations and object graphs).
- **Format loading**: `.ospath` sections are 4 KiB-aligned flat tables — the C++ reader is a struct cast
  away (the format design anticipates this consumer).

## Risks / order

- Ship AFTER the engine proves the semantics (readme order) — the ASI debugging loop is 10× slower.
- SA entity budgets (pools!) constrain ring-0 size — the FLA-style pool raises we already know apply.
- The exact-exe guard + HOODLUM offset discipline from perfect-map carries over verbatim.

## Tasks

- [ ] Population suppression hooks (ambient budgets → 0; verify scripted/mission spawns intact across a
      story-mission sample).
- [ ] `.ospath` C++ reader + the flow/kinematic tick port (unit-parity tests against the TS sim on
      recorded fixtures — same seeds, same positions).
- [ ] Ring-0 bridge: spawn/drive real CVehicles/CPeds along routes via SA task primitives; demotion.
- [ ] Corona light streams via `CCoronas`; vlo extended-range rendering; ped imposter sprites.
- [ ] Lights/barriers/trains: drive SA's own traffic light models & crossing objects from our controllers
      (or render our own state via the 2dfx hooks — decide by RE effort).
- [ ] Field: side-by-side capture — OpenSA engine vs real SA, same seed, same 14:03 freight at the same
      crossing. The twin proof.
