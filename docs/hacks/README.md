# Hacks

Every expedient this project knowingly took: a constant fitted by eye instead of read from the game, a
heuristic standing in for a formula nobody has recovered yet, a trick that buys a look the honest path would
have cost too much to get.

They are written down for one reason: **a hack that nobody recorded is indistinguishable from a decision.**
Six months on, the fitted 0.6 in a shader reads as if someone knew it was 0.6. This rubric keeps the
difference visible — what it stands in for, what it was judged on, and what would replace it.

Recording one is not permission to take it. The standing rule in `CLAUDE.md` still holds: dig the original
game's real formula out of the reversed source first, and a fitted constant is a debt, not an answer. This
folder is the debt ledger.

## What belongs here

- A **fitted constant** — a number chosen because it looked right, not because the game or the physics says
  it (`NIGHT_SKY_RELAX`, `POPUP_SPEED`).
- A **stand-in rule** — a heuristic that answers a question the real system would answer differently (finding
  a car's cabin from its glass bounds because there is no interior-lighting model).
- A **deliberate cheat for the look** — an effect faked because the real one is not there (a dashboard glow
  with no light source behind it).
- An **exclusion or special case** carried for a reason the general rule cannot express.

## What does NOT belong here

- `docs/edge-cases/` — a LIMIT we live with (a format ceiling, a missing feature). A hack is something we
  actively DO; an edge case is something we cannot do.
- `docs/restrictions/` — a rule a new plan must not violate. A restriction constrains what may be BUILT; a
  hack is something already built, in place of the honest thing.
- `docs/performance/` — a lever we chose not to pull, with its price. A hack has already been pulled.
- `docs/postmortem/` — a direction that DIED. A hack is alive and shipping.
- Anything measured out of the game's own data. A number read from `handling.cfg`, a rule taken from the
  reversed source, an angle derived from the model — those are answers, and they belong in `docs/features/`
  or `docs/contracts/`.

## The file shape

One file per hack, named for what it does (`night-sky-relax.md`, not `090-01.md`), carrying:

1. **What it is** — the constant or rule, verbatim, with where it lives in the code.
2. **What it stands in for** — the honest thing it replaces, and why that thing is not there.
3. **What it was judged on** — the measurement or the field verdict that made it acceptable. "It looked
   right" is a legitimate answer, as long as it says so.
4. **What would retire it** — the condition under which this stops being needed.
5. **Blast radius** — what else moves if the number changes.

## Lifecycle

A hack that gets replaced by a proper approach **moves to [`retired/`](retired/)** — it is not deleted. Its
entry gains a closing note: what replaced it, in which commit or plan, and what the honest version turned out
to be. The row in the table below stays and points at the new location, so the history of a number survives
the number.

## Live hacks

| Hack | Where | Stands in for |
| --- | --- | --- |
| [Pop-up headlight travel time](popup-travel-time.md) | `game/vehicle/vehicle-rig.ts` | SA's own pop-up animation, which does not exist |
| [Independent-axle camber gain](independent-camber-gain.md) | `game/vehicle/vehicle-rig.ts` | the original's rule for the `AXLE_*` model flags, absent from the reversed source |
| [Car-paint reflection](car-paint-reflection.md) | `engine/render/shaders.ts` | an HDR environment, a real ground, and curved normal-mapped panels |
| [Dynamic-indirect weight](dynamic-indirect-weight.md) | `engine/render/shaders.ts` | the baked prelit + per-instance AO a dynamic model has no data for |
| [Night-emissive heuristic](night-emissive-heuristic.md) | `engine/render/shaders.ts` | an authored "this is a light source" flag SA never shipped (half-retired by the baked mask) |
| [Suspension sag bridge](suspension-sag-bridge.md) | `game/physics/physics-world.ts` | solving Rapier's controller equilibrium instead of probing it |
| [Sky-occlusion despeckle](sky-occlusion-despeckle.md) | `renderware/vehicle/sky-occlusion.ts` | marching against the mesh rather than a height field that reads a wiper as a wall |
| [Sun-disc angular size](sun-disc-angular-size.md) | `engine/engine.ts` | the original's own sun billboard sizing, never dug out |
| [World ambient floor](world-ambient-floor.md) | `game/adapters/engine-environment-driver.ts` | nothing — a deliberate deviation: vanilla day `Amb` ≈ 0 and real SA shows black-prelit walls black; the floor (max(), day-only, fitted 0.13) is the look the field chose over parity |
| [Tyre-smoke intensity fit](tyre-smoke-intensity-fit.md) | `game/vehicle/vehicle-tyre-smoke.system.ts` | `CFx::AddWheel*` parameters — stubs in gta-reversed, nothing to port |
| [Skid-mark look fit](skid-mark-look-fit.md) | `game/vehicle/vehicle-skid-marks.system.ts` | SA's `CSkidmarks` width/opacity constants, same unrecoverable code paths |
| [Impact-smoke fit](impact-smoke-fit.md) | `web/ui/engine-vehicles.ts` | SA's `CFx` collision-effect counts/lifetimes; the trigger itself is the calibrated damage gate |
| [Surface-FX fit](surface-fx-fit.md) | `game/vehicle/vehicle-surface-fx.system.ts` | `CFx::AddWheel*` per-surface counts/colours; the dispatch itself is surfinfo's own `W_*` flags |
| [Alpha-mask thresholds](alpha-mask-thresholds.md) | `opensa-pack/alpha.ts` | SA's ONE alpha pass with a per-entity reference (140/100/0, recovered) — we bake a two-class split instead, and two side floors are fitted |
| [Autopilot gains](autopilot-gains.md) | `game/vehicle/path-follow.ts` | SA's own `CCarAI`/`CCarCtrl` traffic steering, not ported (and tuned for cars the player is not in) |
| [Pedestrian route on a vehicle graph](pedestrian-route-on-a-vehicle-graph.md) | `web/ui/video/walk.ts` | SA's own PED nodes in `NODES*.DAT` — the game ships a pavement network with crossings and we parse only the vehicle half, so a walk is a driving route pushed 6.5 m sideways |
| [ADC-strip fallback](adc-strip-fallback.md) | `renderware/parsers/binary/dff.ts` | ADC (`0x134`) itself — a PS2 strip's parity/restart bits, undecoded; for its two STOCK carriers (`bloodrb`, `rccam`) we read the face array we otherwise call the wrong one, because unwinding them invents triangles (1050 → 1487) |
| [CLEO frame-sibling order](cleo-frame-sibling-order.md) | `web/ui/engine-cleo-setup.ts` | the DFF frame tree's parent links — the rig drops them at conversion, so rhino's `RwFrame+0x9C` sibling walk is served by NEXT-PART-IN-RIG-ORDER adjacency; retired by the optimizer carrying a `parent` index per part |
| [Smoke drawn to the world edge](smoke-drawn-to-world-edge.md) | `web/ui/engine-particles.ts` | nothing — a deliberate deviation: four smoke systems ignore their authored `cullDist` (150–255) and take the host's draw distance, because our world keeps drawing the chimney long after SA's stopped. 42 of 878 anchors |
| [Tiny-fx distance floor](tiny-fx-distance-floor.md) | `web/ui/engine-particles.ts` | a distance falloff we do not have — `insects`/`cigarette_smoke` author 15 u, which pops in at arm's length, so they are floored at 100 (still 3× tighter than the flat 300 they had) |
| [CLEO track-link hide](cleo-track-link-hide.md) | `cleo/scripts/rhino-tracks/script.ts` | a per-part "hide" native neither runtime has — the eleven off-screen tread links are teleported to `z = -1000` (the author's original used -1e35, a NaN factory); retired by a `setPartVisible` atlas row on an opensa-only build |

**Back-filled 2026-07-28**, sweeping the engine, shaders, physics, converter and tools. What the sweep
deliberately did NOT open a file for, so the next reader does not go looking: numbers that are **read** from
the game's data (`handling.cfg` fields, wheel diameters, timecyc columns), numbers with a **stated derivation**
(the godray decay from measured HDR ranges, the pod angle from a mean normal), and the two 090 entries that
went out with the code they described — the reflection gate and the dash lamp — which are neither live nor
retired but withdrawn, and live on in
[the postmortem](../postmortem/090-vehicle-cabin-at-night.md).

Two entries opened with this folder — the night relax of the sky term, and a car's dash light — went out with
the code they described when [plan 090 was reverted](../postmortem/090-vehicle-cabin-at-night.md) the same
day. They are NOT in `retired/`: that is for a hack the honest version replaced, and these were simply
withdrawn. Their content lives on in the postmortem.
