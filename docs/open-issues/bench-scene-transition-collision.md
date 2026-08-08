# Collision is missing across a bench scene transition — cars fall through the ground

**Reported 2026-08-08 by the user, on both arms of the 07/04 density A/B** (`?bench=all`, in-game, his
machine). Two symptoms, almost certainly one cause:

- **during the sweep**: at a scene change, vehicles drop through the world — collision is not there yet when
  the physics steps;
- **at the end of the run**: the player falls.

It is filed here rather than in a plan because nothing has been fixed and the diagnosis below is a
hypothesis with evidence, not a root cause someone confirmed.

## Why it matters beyond the symptom

**It contaminates every measurement the bench takes.** In the A/B that found it, three of nine scenes came
back with triangle counts the content change could not explain — `ocean-horizon` **+107 %**, `lv-night`
+15.5 %, `sf-fog-dawn` −4.2 % — while the other six matched to ±0.0 %. `ocean-horizon` is the control scene
that [the layer decomposition](../benchmarks/opensa-engine/2026-07-21-layer-decomposition.md) showed does not
move for any map layer, so a 2× swing there is the harness, not the map. An independent headless run of the
*same* build agrees with the OTHER arm on exactly those three scenes, which is what identifies the drifting
run rather than merely showing the two disagree. Rows and the full table:
[`benchmarks/index.md`](../benchmarks/index.md) → the density sweep entry.

So the drift is not a rounding-level nuisance: on a bad scene it is larger than any content change we are
likely to measure, and it is SILENT — the report looks normal, `lateCreates` stays 0.

## What the logs say (the hypothesis)

The first frame after a scene teleport, from the user's `d1` run:

```
[slow] frame 2144.1 (sim dt 250) · gpu 2.56 · … · collision 73.2 · …
       other 2051.2 (vehicle-model ×23 1982.6 (worst bloodra 1975.8) · cell-collision-bodies 28.5 · …)
       draws 11 · cells 0 · bodies 944 colliders 4008
```

Three things in one line:

1. **`cells 0`** — no map cell is resident, so the ground colliders for the new location do not exist yet.
2. **`sim dt 250`** — the fixed-step clock was handed a 250 ms catch-up after a 2.1-second frame, so the
   solver integrates a quarter-second in one go.
3. **`vehicle-model ×23` = 1 983 ms** — the frame was that long because 23 vehicle models were being built,
   and `cell-collision-bodies` is in the SAME frame, i.e. the collision bodies are still being created while
   the bodies that need them are already being stepped.

A body integrating 250 ms with no ground under it is exactly "cars fall through the world". The end-of-run
fall is the same shape from the other side: the sweep restores the player where nothing is resident yet.

**Not verified**: whether the physics step is genuinely ordered before the cell collision build, or whether
the bodies are simply spawned before their cell is requested. Both fit the line above; the fix differs.

## What to check first, if you pick this up

- Does the bench teleport wait for the streaming ring to SETTLE before it un-pauses the fixed step? The
  scene protocol says it settles the ring, so if the fall still happens, the settle condition does not
  include cell collision bodies.
- Is the fixed-step catch-up clamped? A 250 ms `sim dt` is large enough to tunnel through a collider even
  when one IS present.
- Do the vehicles spawn before their cell is resident? `vehicle spawn deferred: no ground at …` appears in
  the same runs, so the spawner already HAS a no-ground guard — the question is why the ones that did spawn
  did not get it.

## Pointers

- `apps/web/src/…` bench scene protocol (`bench-scenes.ts`) and `engine-canvas-host.tsx` (the `[slow]`
  attribution that produced the line above).
- The rows that show the drift: [`2026-08-08-ingame-07-04-density-ab.json`](../benchmarks/opensa-engine/2026-08-08-ingame-07-04-density-ab.json).
- Measurement rule this earns: **a scene whose triangle count moves between two arms is not a measurement**
  — check `avgTriangles` before reading any `gpuMs.pass` delta.
