# 19 — Procedural clutter (procobj) — B7·d

**Status: OPEN, not started.** A prod-parity gap found in the field on 2026-07-14: the three path scatters and
renders SA's procedural clutter (grass, bushes, rocks, cacti); the own engine draws **none of it**. The
countryside reads as bald.

## The field story that surfaced it (read this before touching clutter)

The engine host stood in the countryside at **12 fps, standing still, on an empty screen** — 1 cell loaded,
8 draw calls, GPU 2 ms. The CPU breakdown said everything:

```
frame 250 · gpu 2.5 · fixed 800 (5 steps: controller 1.4 + physics 798) · anim 0.00 · bodies 9803 colliders 12673
```

- **9 803 static bodies** in Rapier → **~17 ms per step**, and the fixed-step loop then ran its 5 catch-up
  steps, so one slow frame guaranteed the next (a textbook spiral: the recovery was slow and never reached
  120 again).
- They were the procedural clutter's colliders. **The engine host passed NONE of prod's clutter knobs**
  (`procObjLimit: 150`, the per-category density lottery), so the adapter defaulted to _unlimited_ and
  collided every blade of grass — while rendering none of it. We were paying 17 ms a step for **invisible
  walls**.
- Fix shipped: `clutterColliders: false` on the engine host (the adapter's own rule is "no invisible
  obstacles" — a renderer that does not draw clutter must not collide it). 120 fps, 73 bodies.

Two lessons worth keeping:

1. **A catch-up spiral hides its own cause.** The stall looked like it belonged to the animated objects — they
   were simply the thing on screen. `anim` measured **0.00 ms** the whole time. Per-block timers ended a
   three-round guessing game in one reload; they now live in `engine-canvas-host.tsx` behind a slow-frame
   threshold (quiet on a healthy frame) and should stay.
2. **Physics bodies are the expensive part of clutter, not triangles.** Vanilla pools `CProcObjectMan` at
   ~300 for exactly this reason.

## What prod does (the spec to mirror)

- `packages/renderware/src/map/procobj-scatter.ts` + `build-procobj.ts` — the scatter and the **lottery**.
- `apps/web/src/ui/canvas-host.tsx`: `procObjLimit: 150` per cell, `procObjDensityOf` per category from the
  graphics config. **One budget drives render AND collision**: over the cap, the highest-lottery placements
  are not drawn and therefore not collided. Models that ship a COL collide (rocks/cacti); grass has none and
  stays walk-through, like vanilla.

## What the engine needs

1. **Converter or host?** The clutter is _scattered_, not placed — it is generated from `procobj.dat` against
   surface polygons. Baking it into `.oscell` would freeze the density knobs into the pak; generating it in
   the host keeps the lottery live (prod's model) at the cost of per-cell CPU. Decide this first.
2. **Rendering:** it is thousands of tiny instances of a handful of models — the rigid-entity path is the
   wrong shape (one draw per instance). This wants an instanced pass, or the same welded-into-the-cell
   treatment the static world gets, keyed by the density knobs at CONVERT time.
3. **Collision:** re-enable `clutterColliders` on the engine host **together with the rendering**, and take
   prod's cap with it. Never let the two diverge again — that divergence is what cost 17 ms a step.

## Done means

The countryside has grass and rocks in `?engine=opensa`, the density knobs work, and the physics body count
stays in the hundreds, not the thousands.
