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
- One scene = a seeded route inside ONE region, a debugger hour slot (00/06/12/18/21), a weather from that
  region's own timecyc set, a spawn, an instant seating, and a fragment.
- The staging recipe is the phys laps' verbatim: `TELEPORT_NOTICE_SECONDS` before `pendingCells` means
  anything, then the ring drains, then a collision warmup, then the suspension settles — and last an fps
  stability gate (30 consecutive frames under 25 ms) so the cold-teleport spike is over before the overlay
  lifts. Measured cost: 248-252 ms.
- All UI hides through the existing `'fly-camera'` event; the only progress protocol is the `[video]` console
  tag, one JSON line per scene (the `[phys]` protocol's twin, plus cross-track error and the shot ledger).
- `&diag=1` adds a second line per scene, `[diag]`, holding ONE ROW PER RENDERED FRAME (drawn car, both
  headings, eye, aim, screen position, cut flag). The `[video]` series is 10 Hz and judges a driven line; a
  camera complaint is a per-frame thing and is invisible at that rate. Read it with
  `scripts/debug/video-shiver.ts`, which reports each channel's high-frequency energy — that is how round 1's
  shiver was pinned on the damper rather than on the physics. Off by default.

**The sequencer** (096/05) — `apps/web/src/ui/video/presets.ts`, a table the runner reads:

- **The cycle** (D2): a drive scene in Los Santos → Las Venturas → San Fierro → Countryside → Desert, then
  two flythroughs and a walk (D3). The kinds 07 owns are SKIPPED with a `[video]` notice — no placeholder ever
  reaches the footage, and a silently shortened cycle would read as a lost region. Endless: the program is
  rebuilt each lap from that lap's seed, so a long run is not the same eight scenes over and over.
- **The region token is the game's own**: `City` is what the zone data classifies a point into AND the suffix
  the timecyc weather rows carry, so one token drives the route filter and the weather pool. The pool is
  FILTERED out of the shipped names (`weatherPool`), never listed — a modded timecyc is followed.
- **Per-scene seeds** derived from the master seed and the scene index, so scene 7 is the same scene however
  the run reached it. Each staged scene prints one self-describing line:
  `[video] scene 7 seed=… region=VEGAS kind=drive car=infernus(mod) hour=21 weather=SUNNY_VEGAS route=412m …`.
- **The car** (D10): the roster is `vehicles.ide`'s `car`-type rows whose `.osm` the build actually carries
  (`roadCarModels` — a slot with no model throws at spawn). A mod car is preferred 4 times in 5 when 096/06's
  ledger offers any; the two branches draw from disjoint pools, so the realised mod share IS the configured
  preference and stock classics keep appearing whatever a game has modded. Paint comes from the car's own
  `carcols` combos, seeded, so the same model twice in a run is not the same colour twice.
- **D15's tripwire**: a route is built inside one region precisely so `CityZoneSystem` never fires its 6 s
  weather rewrite on camera. A scene whose weather target moved anyway logs which scene and which region —
  the leak names itself instead of becoming a mystery fade in the footage.

**The director** (096/03) — `apps/web/src/ui/video/`:

- **Authority**: `resolveCamera`'s chain is `bench > video > flyEye > follow`. The director writes a
  `{eye, target, fovYRad?}` pose (engine Y-up) through `setVideoCamera(pose, cut)`, or `null` to give the
  frame back to the shipped follow rig.
- **The director is stepped BY THE HOST LOOP** (`setVideoStep`), between the car's render pose and the camera
  snapshot, so a car-mounted shot is composed from the frame it is drawn in. Stepped from the module's own
  rAF pass instead, the pose reached the screen a frame late and the pairing carried the car's whole travel
  for that frame — 0.33° of shiver at a cruise, the field bug of round 1b. The module keeps its own clock for
  everything that is not per-frame: staging, the fragment's seconds, the survey.
- **Shots are a table**, never a code path (`shots.ts`): `chase` (yields the frame to the rig — the shipped
  camera IS that shot), `nose`, `high`, `wing-l`, `wing-r` (tracking: the eye rides the car's heading frame)
  and `flyby` (static: the eye is planted once and the car drives past it). Every offset is a multiple of the
  car's OWN half-extents, so the table fits whatever model is in the slot.
- **Framing**: the look point is solved so the car lands on the shot's screen anchor, with **lead room** — the
  car sits on the side opposite its screen-space travel, so it drives into open frame. The table's `anchor.x`
  says how MUCH room the shot wants; the motion decides which side it goes on, by a share proportional to the
  crossing speed (full at 2 m/s, centred when the car is not crossing at all). It was a threshold once, and a
  threshold on a signal that hovers near it snaps the frame — see the restriction below. The aim and the eye
  are `smoothDamp`ed on per-shot time constants and the view direction's swing is capped at 60°/s (a whip pan
  reads as an error).
- **A tracking shot damps its MOUNT, not its world position**: the damper is re-based against the car each
  frame, so the car's own travel passes straight through and the smoothing eases only the heading the mount
  hangs off and the framing. Damped in world space it carried a ~1.1 m lag whose per-frame catch-up scaled
  with `dt`, and an uneven frame clock shook it — the field bug of round 1, now a restriction
  (`docs/restrictions/architecture.md`) and a director test. A PLANTED eye (`flyby`, `station`) is damped in
  the world, because it is not mounted on anything.
- **Cuts**: the scene's shot list is dealt up front from the seeded stream — weighted picks, no preset twice
  in a row, every shot ≥ 5 s, `chase` guaranteed at least once. Every cut is DECLARED for exactly one frame,
  which is the only thing the `[cam] jump` watchdog whitelists.
- **Empty-frame guard**: a clock, not a gate — the car has to be outside the safe frame (|s − 0.5| > 0.45),
  beyond the shot's distance ceiling, or behind the eye for 1.5 s before the shot is cut short, so one frame
  behind a lamppost changes nothing.

**Tripod stations** (096/04) — `station` is the sixth shot, and the only one whose eye comes from the world:

- **Candidates are derived from the road**: 8/11/14/18 m off the driven line, both sides, at a low kerb
  height, eye level or up on a roof — each ground-snapped by one cast. Order and heights come from the
  scene's seeded stream, so `?seed=` reproduces the survey too.
- **The survey is amortised**, ≤ 3 casts per frame during the shot BEFORE the tripod's: one ground snap plus
  a line-of-sight probe against each of five predicted car positions across the shot's window. A candidate
  passes on a soft COVERAGE score (4 of 5 clear — a lamppost may not veto a usable stand) plus a dwell test
  (the car must be within reading distance for the window), never an all-rays gate — that shape was built,
  field-rejected and rolled back in 080 (`docs/postmortem/080-cinematic-camera/multiray-collision.md`).
- **A slot the survey cannot fill plays a car-anchored stand-in** drawn at plan time from the same seed. A
  missing station costs variety, never a scene.
- **The live check is one probe per second, and two blocked answers in a row cut away.** Occlusion never
  MOVES the camera — it only picks a stand before the shot and ends the shot after it. Hysteresis lives in
  the cadence, the debounce and D4's 5 s floor.
- **Prediction is scaled by the speed the car is actually keeping**, and a survey waits until the car is up
  to speed before predicting from it (a launching car's speed describes the launch, not the road ahead).
- `?at=x,y` pins every scene's route to the node nearest a point, so a hard street can be looked at
  deliberately — `scripts/debug/video-routes.ts --worst` prints the coordinates to paste in. A pin the route
  builder cannot walk out of is LOGGED and the scene takes a seeded route instead
  (`docs/edge-cases/route-graph.md` — a city grid is one such place).

Measured over 25 headless scenes / 5 seeds (plus 4 scenes pinned to the hardest LA start): the car is inside
the safe frame on **99.2 %** of directed frames, **0** undeclared `[cam] jump` lines, 56 cuts, shortest dealt shot
5.2 s; **12 of 12 tripod slots played from a surveyed station**, ≤ 3 casts in every frame, survey verdict
within 14 frames, station prediction error median 1 m.

## Not implemented yet

- The region cycle and preset table (05), the build-time mod-car ledger (06), walk and flythrough scenes (07).
- **Only the tripod is surveyed.** A `flyby` eye is derived from the car and gets no occlusion check at all,
  so it can still be planted inside a wall; the same machinery would cover it, but nothing asks it to yet.
- Interior/cabin camera, in-page recording, traffic and drift driving are out of scope for v1 (D14).
- Routes stay inside one region (D15) and the clock drifts ~16 game minutes over a fragment (D13).

## Known gaps

- The autopilot's gains are a fitted set — [`docs/hacks/autopilot-gains.md`](../hacks/autopilot-gains.md).
- **The `flyby` pass is the one shot that costs frames**: in a scene where it is the only placed shot its own
  safe-frame share measured 76 % (the car sweeps out of frame over the last stretch of the pass). Averaged
  over a run it is under 1 %. Standoff and lead are the levers, and the next round on it is a FIELD look at
  footage, not another number.
- **The station prediction is only as good as the car's obedience to its own target speeds.** Median 1 m,
  worst 6.6 m over 12 takes — every large one is a window that still covers part of the car's acceleration.
  A resample at cut time is the plan's own lever if it ever matters.
- The road graph is `original`-only: a total conversion without `data/paths/nodes*.dat` gets a logged refusal,
  not a drive scene.
