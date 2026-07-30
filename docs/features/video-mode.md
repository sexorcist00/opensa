# Video mode (self-directed showcase runs)

`apps/web/src/ui/engine-video-runs.ts`, `apps/web/src/ui/video/`, `packages/game/src/paths/`,
`packages/game/src/vehicle/path-follow.ts`. Plan [096](../plans/096-video-mode/readme.md).

`?video=1` boots the game into an endless, seeded, self-directed showcase: a car is staged on a route out of
the game's own road graph behind a black overlay, an autopilot drives it for 10-25 real seconds while a
director cuts between shots, then the overlay comes back down and the next scene stages behind it. **The user
screen-records with OS tools and cuts the black gaps out by hand — nothing here captures anything**, by
design (D11/D14).

## Implemented

**Scenes and staging** (096/02):

- `?video=1&seed=N&from=10&to=25&car=<model>` — `seed` determinises the car, weather, hour, route AND the
  shot list; it is printed as `[video] seed=…` so a run that was not asked for one can still be replayed.
- One scene = a seeded route inside Los Santos (region cycle is 05), a debugger hour slot (00/06/12/18/21),
  a weather from that region's own timecyc set, a spawn, an instant seating, and a fragment.
- The staging recipe is the phys laps' verbatim: `TELEPORT_NOTICE_SECONDS` before `pendingCells` means
  anything, then the ring drains, then a collision warmup, then the suspension settles — and last an fps
  stability gate (30 consecutive frames under 25 ms) so the cold-teleport spike is over before the overlay
  lifts. Measured cost: 248-252 ms.
- All UI hides through the existing `'fly-camera'` event; the only progress protocol is the `[video]` console
  tag, one JSON line per scene (the `[phys]` protocol's twin, plus cross-track error and the shot ledger).

**The director** (096/03) — `apps/web/src/ui/video/`:

- **Authority**: `resolveCamera`'s chain is `bench > video > flyEye > follow`. The director writes a
  `{eye, target, fovYRad?}` pose (engine Y-up) through `setVideoCamera(pose, cut)`, or `null` to give the
  frame back to the shipped follow rig.
- **Shots are a table**, never a code path (`shots.ts`): `chase` (yields the frame to the rig — the shipped
  camera IS that shot), `nose`, `high`, `wing-l`, `wing-r` (tracking: the eye rides the car's heading frame)
  and `flyby` (static: the eye is planted once and the car drives past it). Every offset is a multiple of the
  car's OWN half-extents, so the table fits whatever model is in the slot.
- **Framing**: the look point is solved so the car lands on the shot's screen anchor, with **lead room** — the
  anchor mirrors to the side opposite the car's screen-space travel, so it drives into open frame. The aim
  and the eye are `smoothDamp`ed on per-shot time constants and the view direction's swing is capped at
  60°/s (a whip pan reads as an error).
- **Cuts**: the scene's shot list is dealt up front from the seeded stream — weighted picks, no preset twice
  in a row, every shot ≥ 5 s, `chase` guaranteed at least once. Every cut is DECLARED for exactly one frame,
  which is the only thing the `[cam] jump` watchdog whitelists.
- **Empty-frame guard**: a clock, not a gate — the car has to be outside the safe frame (|s − 0.5| > 0.45)
  for 1.5 s before the shot is cut short, so one frame behind a lamppost changes nothing.

Measured over 25 headless scenes / 5 seeds: the car is inside the safe frame on **99.1 %** of directed
frames, **0** undeclared `[cam] jump` lines, 59 cuts, shortest dealt shot 5.2 s.

## Not implemented yet

- Tripod stations with occlusion surveys (04), the region cycle and preset table (05), the build-time mod-car
  ledger (06), walk and flythrough scenes (07).
- **A placed shot does no occlusion check** — a `flyby` eye stands 5.4 m off the road and can be planted
  inside a wall. 04's `pathClear` survey is the fix; until then it is the shot most likely to look wrong.
- Interior/cabin camera, in-page recording, traffic and drift driving are out of scope for v1 (D14).
- Routes stay inside one region (D15) and the clock drifts ~16 game minutes over a fragment (D13).

## Known gaps

- The autopilot's gains are a fitted set — [`docs/hacks/autopilot-gains.md`](../hacks/autopilot-gains.md).
- **The `flyby` pass is the one shot that costs frames**: in a scene where it is the only placed shot its own
  safe-frame share measured 76 % (the car sweeps out of frame over the last stretch of the pass). Averaged
  over a run it is under 1 %. Standoff and lead are the levers, and the next round on it is a FIELD look at
  footage, not another number.
- The road graph is `original`-only: a total conversion without `data/paths/nodes*.dat` gets a logged refusal,
  not a drive scene.
