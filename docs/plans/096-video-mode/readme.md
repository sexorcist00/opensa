# 096 — Video mode (self-directed showcase runs for trailer footage)

**Status: PLANNED 2026-07-30.** Graduated from `docs/ideas/video-mode/` the same day it was researched —
the four-way repo sweep (paths/driving, camera, streaming/host, player/vehicles) and every user decision
moved into this doc, per the lifecycle rule that a validated idea's research record MOVES into the plan.

**Goal: `?video=1` boots the game into a bounded, seeded, self-directed showcase** — scenes 1…100 of the
seed, then an end card (D2 as revised). A random car — mod cars first — spawns on a road, the player gets in and cruises a route generated from the game's own
`NODES*.DAT` graph while cameras cut between occlusion-checked tripod stations and chase/front/rear/wing
views; other scenes walk the player or fly the camera. Every fragment runs 10–25 real seconds on a fully
streamed world, UI hidden, black overlay between scenes. The user screen-records with OS tools and edits
the cuts out by hand.

**NOT named "cinematic"** — that word belongs to the shipped 080 follow-camera chain in every doc, test
and ledger. This feature is a *director* over that camera, plus an autopilot under the car.

## Decisions (user, 2026-07-30 — frozen for v1, D2 revised 2026-07-31)

A revision is written INTO the row it changes, with its date and what it replaced, rather than the row being
rewritten: a phase doc that quietly matches today's code cannot be read against the code it was built from.

| # | Decision |
| --- | --- |
| D1 | Entry `?video=1`; fragment length `&from=10&to=25` (REAL seconds; defaults 10/25); `&seed=N` |
| D2 | Region cycle LS → LV → SF → Country → Desert. **Revised 2026-07-31: a run is a BOUNDED SEQUENCE — scenes 1…100 of the seed, then it stops on an end card.** `&scenes=N` takes a shorter one; 100 is the ceiling, not just the default. (Was: endless until the tab closes) |
| D3 | Program per cycle: drive scenes in ALL 5 regions → camera flythrough in 2 → on-foot walk in 1 |
| D4 | Shot ≥ 5 s; length adapts to car distance/speed; a drive-past is fine but the camera must not linger on an empty frame after the subject passes |
| D5 | Routes favour long straights with gentle curves; length ≈ fragment duration × cruise speed; random from the node graph (curated routes maybe later) |
| D6 | Time of day snaps to the debugger's preset slots: 00:00 / 06:00 / 12:00 / 18:00 / 21:00 (`debug-overlay.tsx:50`) |
| D7 | Weather random WITHIN the current region's own timecyc set (LS scene → LA weathers only) |
| D8 | Driving style: calm cruise, speed capped by route curvature; no drift/stunts |
| D9 | `?seed=` determinises car, weather, hour, route and shot list; active seed printed `[video] seed=…` |
| D10 | Custom cars first via a build-time ledger (vehicle-installer) — approved |
| D11 | Between scenes: plain black DOM overlay owned by the module (user cuts it in the editor) |
| D12 | UI hidden via the existing `'fly-camera'` event; no on-screen status during a scene (console `[video]` tag only) |
| D13 | Clock drift accepted (~16 game minutes over a 25 s fragment); no time freeze |
| D14 | Out of scope v1: interior/cabin camera, in-page recording, traffic, drift driving |
| D15 | Routes stay INSIDE one region (sidesteps `CityZoneSystem`'s 6 s weather rewrite on crossing, `engine-canvas-host.tsx:913`) |
| D16 | `vehicle-enter-null-body` recheck 2026-08-30: video mode IS the stress test; if the crash returns, the defensive `readBody` guard ships in the same change |

## What the engine study established (constraints — every phase obeys these)

1. **The attach pattern is fixed.** A module in its own file with a narrow host interface of thin
   accessors, self-gating on the URL (absent → immediate return), called once at the end of `boot()`
   (`engine-canvas-host.tsx:1633-1697`). `setupPerfRuns` / `setupPhysRuns` are the two shipped examples;
   the host-side footprint of an entire subsystem is one ~20-line block. Video mode adds a third block and
   NOTHING else to the host beyond the accessors it composes (most already exist for bench/phys).
2. **`packages/engine` is untouched.** The camera lives in `apps/web` (app layer); autopilot and route
   logic go in `packages/game` (engine-tagged, no renderware imports outside `adapters/`). Layer tags:
   `app → engine`, never the reverse (`eslint.config.ts:284`).
3. **Camera authority is a priority chain** in `resolveCamera` (`apps/web/src/ui/camera/engine-camera.ts:87-110`),
   currently `bench > flyEye > follow`, pinned by `engine-camera.test.ts`. Video inserts DIRECTLY BELOW
   bench: `bench > video > flyEye > follow` — bench numbers stay untouchable by construction (080 ground
   rule), and video, being a scripted run like bench, outranks the interactive modes while active. The
   precedent is `benchCamera` itself: an external module owning the frame via a plain `{eye, target}`
   (`engine-canvas-host.tsx:1182`, honoured at `camera-director.ts:99-101`).
4. **Scene start gate — copy the phys recipe, never invent a third** (`engine-phys-runs.ts:64-70`):
   `pendingCells === 0` LIES for ~1 s after a teleport (still reads the old ring) → wait
   `TELEPORT_NOTICE_SECONDS = 1`, then drain `pendingCells`, then ~2 s warmup for collision/clutter (no
   pending counter of their own). The unfixed cold-teleport spike (plan 091: ~20 frames of 110–170 ms)
   is waited out behind the black overlay. All timing on the frame clock (`until()`/`waitSeconds()`
   pattern), never `setTimeout`.
5. **Synthetic driving input is a solved path.** `ScriptedDriveSource implements InputState` is
   permanently installed in `CombinedInput` (`engine-canvas-host.tsx:487-488`) and reaches the Rapier
   raycast controller through the exact player path (`enter-vehicle.system.ts:774-856`). The autopilot is
   a closed-loop SIBLING, not a change to that path. Caveats: `CombinedInput` SUMS move vectors
   (`combine-input.ts:45-55`) — keyboard input during a scene adds to the autopilot's (accepted v1
   limitation: hands off the controls while recording); steering slews at `STEER_RATE = 1.2 rad/s`
   (`enter-vehicle.system.ts:185`) through a speed-dependent limit (`steering.ts`), so the controller
   must anticipate, never react.
6. **Driving state is a singleton** on `EnterVehicleSystem` — exactly ONE car can drive. Enough for v1;
   traffic is roadmap 0.5.0 material.
7. **Occlusion queries exist and are cheap**: `pathClear` (line-of-sight boolean,
   `physics-world.ts:901`), `sphereCast` (`:1293`), `raycast` (`:962`), all GTA Z-up. Budget ≤ 5
   casts/frame total (080 ground rule; today's rig spends 2).
8. **The discrete-gate trap is documented**: a hard boolean over rays "has no continuous middle, so it
   cannot ease" (`docs/postmortem/080-cinematic-camera/multiray-collision.md`). Station choice is exactly
   that shape → hysteresis + minimum dwell (D4's 5 s floor helps) + amortised surveys, and every cut
   DECLARED to the `[cam] jump` watchdog (`engine-canvas-host.tsx:1961`) and to
   `camera-transitions.test.ts`'s 1 u/frame continuity exam.
9. **Weather is instant when asked**: `WeatherTransition.begin(index, 0)` (how the bench sets it,
   `engine-canvas-host.tsx:1653`); the 6 s default fade (`game-runtime-config.ts:238`) is for in-scene
   artistic changes only (none in v1).
10. **Mod provenance does not survive the build** (verified against a built `carcols.dat`) — but
    `vehicle-installer`'s `install.ts:52` already collects the `Set<string>` of mod-installed slots and
    never writes it. The ledger phase emits it the way `vehicle-features.txt` is emitted.
11. **Two coordinate spaces**: gameplay/physics GTA Z-up, camera output engine Y-up,
    `toEngine(gta) = (x, z, −y)`. Director math runs in ONE space and converts at the physics boundary
    (the 080 rule).
12. **The ownerless mode must be impossible** (`docs/restrictions/architecture.md`, the 094 lesson): the
    module is the single owner of the overlay and the camera in every mode INCLUDING headless, and it
    logs what it staged (`[video] scene 3/5 lv drive seed=…`).

## Architecture

```
apps/web/src/ui/engine-video-runs.ts     setupVideoRuns(host: VideoRunsHost) — gate, sequencer loop,
                                         overlay, UI hide, settle, spawn/seat, scene teardown
apps/web/src/ui/video/                   director.ts (shot scheduler + cuts), shots.ts (shot presets +
                                         framing math), stations.ts (tripod survey/occlusion), fly.ts
                                         (flythrough path), rng.ts (seeded PRNG)
apps/web/src/video-presets.ts            region presets (weather pools, time slots, cycle order),
                                         program table (D3), tuning constants in one config object
packages/game/src/paths/route-graph.ts   pure graph ops over nodes+links (no renderware import) — DONE 01
packages/game/src/paths/route-builder.ts seeded walk + the drivable line (offset, smoothing, speeds) — 01
packages/game/src/paths/rng.ts           mulberry32 + weighted pick, the one random source — DONE 01
packages/game/src/adapters/path-graph.ts loads NODES*.DAT → RouteGraph (renderware allowed: adapters/) — 01
packages/game/src/vehicle/path-follow.ts PathFollowSource implements InputState (pure-pursuit autopilot)
packages/renderware/src/parsers/binary/paths.ts   + links adjacency (was discarded at parse) — DONE 01
tools/vehicle-installer/…                emits data/vehicle-mods.txt (the ledger)
scripts/debug/video-routes.ts            offline route-builder validation (kept, debug README row)
```

Host additions (one block at `engine-canvas-host.tsx:~1697` + accessors): `setVideoCamera` (mirrors
`setBenchCamera`), `runPath`/`arrived` threading from `controllerSystem` (phase 07), everything else
composed from accessors already wired for bench/phys (teleport, hour, weather, stream, vehicles, samples,
`toEngine`, `params`, `events`).

Doc obligations (same-change rule): rows in `docs/development/query-parameters.md` (`video`, `from`,
`to`, `seed` — and this param family is the doc's stated trigger to consider the typed reader),
`docs/contracts/vehicles.md` (ledger name + misspelling behaviour), `docs/features/video-mode.md` (+ README
row), `docs/debug/README.md` (new script), `docs/commands.md` if a CLI knob is added. Close-out owes the
audit + benchmark per the big-rework rule.

## Phases and priority

Priority meaning: **P0** — the feature exists and is field-checkable (a car drives a route on camera);
**P1** — the trailer look (director, variety, mod cars); **P2** — breadth and close-out. Order is the
dependency order; 06 is independent and can run any time before 05.

| Phase | Title | Priority | Depends on |
| --- | --- | --- | --- |
| [01](01-path-graph-and-routes.md) | Path graph + seeded route builder (offline-first) — **SHIPPED** | **P0** | — |
| [02](02-module-skeleton-and-autopilot.md) | Module skeleton + autopilot drive scene v0 (chase cam) — **SHIPPED** | **P0** | 01 |
| [03](03-camera-authority-and-shots.md) | Video camera authority + shot presets + framing — **SHIPPED** | **P1** | 02 |
| [04](04-stations-and-occlusion.md) | Tripod stations: survey, occlusion, cuts without flicker — **SHIPPED** | **P1** | 03 |
| [05](05-sequencer-regions-presets.md) | Sequencer: region cycle, weather/time presets, car pick — **SHIPPED** | **P1** | 02 (04 for full look) |
| [06](06-mod-car-ledger.md) | Build-time mod-car ledger (tool + pack + runtime read) — **SHIPPED** | **P1** | — (feeds 05) |
| [07](07-walk-and-fly-scenes.md) | Walk + flythrough scenes | **P2** | 03, 05 |
| [08](08-polish-and-closeout.md) | Polish, empty-frame guard, docs, benchmark, audit | **P2** | all |

After 02 the feature is REAL (one region, chase camera, seeded route — recordable footage, ugly cuts).
After 05 it matches the user's brief minus walk/fly. After 08 it is done by the workflow rules.

## The two field risks (validated the 081 way — short rounds against a HARD case)

1. **Autopilot cornering** (02): validated on telemetry first (cross-track error, lateral-g band), then a
   field look at a route with a real corner — never a gentle one.
2. **Cut flicker** (04): the discrete station gate against facade recesses/columns; hysteresis + dwell +
   amortised survey, judged in the field on a colonnade street, with the `[cam] jump` watchdog as the
   objective tripwire.

## Measured-numbers ledger

Per the standing rule, every phase records its numbers here (and perf figures go to `docs/benchmarks/`
before analysis). Empty until phases run:

- 01: **DONE 2026-07-30.** Graph: 30 587 vehicle nodes over 73 area files, **0 unresolved links, 0 links
  without a reverse edge** (the table is fully mutual — travel direction is NOT expressible from it, see the
  phase doc's note for 02). Routes, 5 seeds × 40 tries per region, target 390 m (25 s × 12 m/s × 1.3),
  measured against `game-src/original` (no `build/original` on the machine; re-check on the built tree in 02):
  accepted **LA 52 · VEGAS 62 · SF 65 · COUNTRYSIDE 45 · DESERT 69** (plan floor: ≥ 20) — mean length
  397–403 m against the 390 m target, **max turn 20.1–32.1° (ceiling 35)**, tightest smoothed corner
  9.8–19.2 m, **0 driven points outside the region in every region**, straightness 71–88 % of junction turns
  under 5° and ≤ 2 % over 25°. Rejects are almost entirely `too-tight` (112–136 per region) against 2–6
  `dead-end` and 6–17 `region` — the accumulated-turn budget is the binding constraint, and it is the knob
  05 loosens if variety suffers. Two constraint bugs the offline run caught before any frame: curvature read
  off unevenly spaced points reported 2.0 m "hairpins" on a road whose sharpest junction was 32°, and the
  per-junction ceiling let five legal turns bend 125° inside ten metres. Both fixed (uniform 2 m resample +
  8 m curvature baseline; a 45°-per-25 m turn budget), which is what moved the tightest corner from 2.0 m to
  ~19 m and the slowest target speed from 2.2 m/s to 6.9 m/s.
- 02: **DONE 2026-07-30.** Routes re-validated on the BUILT tree (`build/original/opensa`,
  `scripts/debug/video-routes.ts`): identical to 01's `game-src/original` numbers to the digit — 30 587 nodes,
  0 unresolved links, 0 one-way links, LA 52 · VEGAS 62 · SF 65 · COUNTRYSIDE 45 · DESERT 69 accepted, LA's
  tightest accepted corner 19.2 m. So the built `data/paths` is the source tree's.
  **Headless field run** (`TAG='[video]' tools-debug/bench-harness/drive.js … '&video=1&seed=N'`, DPR 1,
  4 seeds, 29 LS drive scenes, 10-25 s each): corners driven **20.8-568 m** (tightest 20.8 m at a 20.6°
  junction — near the builder's 19.2 m LA floor); **cross-track error p95 ≤ 0.331 m, max ≤ 0.503 m** against
  the plan's 1.5 m / 3 m floors; **|gLat| p95 ≤ 0.293 g** against the 0.35 g calm band (single-frame maxima
  reach 1.32 g — kerbs and drain lips, not cornering); mean speed **10.2 m/s** against a 12 m/s cruise
  (−15 %, inside ±20 %, and the standing start is inside every window). **fps stability gate 242-251 ms** —
  i.e. the 30-frame minimum every time: the cold-teleport spike (plan 091) was always over before the gate
  started, so the overlay costs a quarter second, not the ~2 s the spike would have. **1 stuck flag in 29**
  (3.4 %): a scene that started on an 18° Los Santos hill the `admiral` could not climb — the guard, not the
  controller. Determinism: seed 47 re-run after the stuck rule changed reproduced all 8 routes, hours,
  weathers and cross-track percentiles **to 3 decimal places**. Autopilot unit tests: 10, on a kinematic
  bicycle carrying the real 1.2 rad/s slew.
- 03: **DONE 2026-07-30.** Authority `bench > video > flyEye > follow`; six presets (`chase` yields the frame,
  `nose`/`high`/`wing-l`/`wing-r` track, `flyby` plants). **Headless 5 seeds × 5 scenes (47 · 3 · 11 · 202 ·
  88), `build/original/opensa`, DPR 1: 36 951 directed frames, car inside the safe frame 99.09 %** (per-seed
  97.24-100 %) against the plan's 95 % floor; **0 `[cam] jump` lines in all five runs**; 59 cuts; pan-rate cap
  bit on 2.7 % of directed frames; shortest dealt shot 5.2 s against the 5 s floor; every scene ended
  `ran-out` (no stuck, no early guard cut of a shot that was still framing its car). Autopilot unchanged and
  still inside its band (cross-track p95 0.11-0.31 m); settle gate 248-252 ms, i.e. 02's number. **The one
  outlier is the `flyby`**: in seed 11 scene 3, where it is the only placed shot, its own safe share is
  75.8 %, because the pass sweeps the car out of frame over the last stretch. The first geometry (a 2.7 m
  standoff, taken from this doc's own example multiplier) was worse — 88.7 % and 266 clipped frames in one
  scene — and moving it to 5.4 m aside / 23 m ahead cut the peak angular rate roughly in half: the plan's
  "the guard cut, never a higher cap" held, the fix was the STANDOFF. Two measurement notes: the first run's
  11 `[cam] jump` lines were all paired with `[slow] frame 120-224` and each equalled the car's own travel
  over that frame — the watchdog does not normalise by `dt`, now in `docs/edge-cases/camera-rig.md`; and a
  cut is a discontinuity, so a pan-rate assertion that measures across one is measuring the cut.
- 04: **DONE 2026-07-30.** The `station` shot, an amortised survey behind it, and `?at=x,y` to pin a scene.
  **Headless 5 seeds × 5 scenes, `build/original/opensa`, DPR 1: 35 710 directed frames, safe frame
  99.18 %** (worst scene 93.5 %), **0 `[cam] jump` lines in every run**. **12 of 12 tripod slots played from a surveyed station (100 % against the plan's
  ≥ 60 % floor), 0 fallbacks**; 14 surveys, all filled, rejecting 10 candidates on sightline and 2 for having
  no ground — a real street does reject, which is what makes the fill rate mean something. **≤ 3 casts in
  EVERY frame** (205 total, the whole budget the module was given), verdict within 14 frames (0.23 s). Cut
  causes over the run: 55 scheduled, **1 occluded** (the live tripod check firing in the field, once), 0
  empty. Pan cap bit on 6.2 % of directed frames (03: 2.7 %) — tripods pan, and none of it cost a frame.
  **The prediction was the phase's real work, in three measured rounds**: predicting off the route's target
  speeds alone put a station **19.5 m** from the car (the autopilot cruises ~15 % under target, 096/02);
  scaling by the car's live speed took it to **13.5 m**; waiting for the car to be UP TO SPEED before
  predicting from it took it to **6.6 m max, median 1 m** (pinned run: 0.7 m). Every remaining large one is a
  window that still covers part of the launch. The other thing the field found: a scene OPENING on a tripod
  had nowhere to amortise its casts and played a fallback four times out of twelve — the survey now runs
  behind the black overlay, and fallbacks went to zero.
  **The pin, and what it found**: `&at=847,-1772` (the hardest accepted LA start `video-routes.ts --worst`
  prints, a 19.2 m corner) drove that street in all 4 scenes — safe frame 100 %, 3 stations filled, 0 jumps,
  ≤ 3 casts/frame, prediction error ≤ 6.3 m. The FIRST pin tried was downtown LS (`&at=1450,-1500`) and it
  produced **no route at all** — 40 rejected walks per scene, five scenes running: the builder's 45°-per-25 m
  turn budget cannot cross a right-angle grid whose blocks are shorter than the window. The runner logged the
  fallback each time, which is the only reason the run was not read as a downtown capture. Written up in
  `docs/edge-cases/route-graph.md`; loosening the budget is 05's variety knob.
- **Field round 1 (2026-07-31) — the first human look at the footage, and the one thing every headless number
  had been blind to.** The report was "the camera shivers at these angles", with a side-on `wing` frame and a
  `nose` frame. The instrument built for it: `?video=1&diag=1` writes one `[diag]` line per SCENE holding one
  row per rendered frame (drawn car, both headings, eye, aim, screen position, cut flag), and
  `scripts/debug/video-shiver.ts` reports each channel's high-frequency energy — the RMS second difference,
  which is small for smooth motion however fast, and large for a buzz. Seed 47, `build/original/opensa`,
  DPR 1, 120 fps headless, measured per shot BETWEEN cuts.
  **Where the energy was** (scene 1, per frame²): `wing-l` screen x **6.0 px** against `nose` 0.5 px and a
  planted `station` 0.6 px — while the DRAWN car moved smoothly in all three (0.006-0.009 m) and a planted
  eye did not move at all (0.0000 m). So neither the physics nor the frame interpolation was the noisy party:
  the eye was (0.023 m), and its jitter was **along the travel axis** (`fwd 0.034` against `lat 0.0016`).
  **The mechanism**: a `tracking` shot damped its eye in WORLD space against a car at a cruise, so the damper
  carried a permanent lag — the mount sat **1.1 m behind its authored offset** — and closed it by a step
  proportional to `dt`. Frame-clock jitter (3.1 ms RMS, 16-19 ms spread) modulated that step directly. It only
  reached the screen on the wing shots because there the lag axis is perpendicular to the view; on `nose` the
  eye rides 10 m ahead and the same jitter only changes the distance. That is why four headless rounds and two
  phase acceptances never saw it, and why the two field frames were the two they were.
  **The fix** (`director.ts`): a car-mounted shot damps its MOUNT — the damper is re-based against the
  subject, reading its state relative to where the car stood last frame and writing it back relative to where
  it stands now. A planted eye re-bases against the world and is untouched. **After, same seed, same scenes:**
  `wing-l` **6.0 → 0.61 px**, `wing-r` 4.8 → **0.0020 px**, `nose` 0.54 → **0.0011 px**; the eye's jitter now
  equals the car's to the third decimal (0.0127 vs 0.0137 m — a rigid mount, by definition), and the mount
  holds its authored offset (−0.21 m → +1.30 m, i.e. `0.4 × hy` exactly) instead of trailing it. A scene that
  took a **5.3 s stall** mid-shot went from 17.3 px to 0.0019 px: a hitch no longer throws the framing at all.
  Planted shots unchanged (`station` 0.57 → 0.44 px, eye jitter still 0.0000).
  **Also measured, and left alone:** the mount is built on the fixed-step gameplay heading while the car is
  DRAWN with the interpolated one — the disagreement is **mean 0.01-0.04°, max 0.16°**, an order below the
  fixed residual, so the pairing 096/02 chose stands and now has a number behind it.
  **Round 1b — the same report came back: "the shiver has not gone, maybe it got worse."** It had not gone,
  and the measurement above is why: it judged the pose against the car it was COMPUTED from, which measures
  the director's intent and is blind to WHICH FRAME the pose lands in. The director was stepped from the
  module's own rAF pass, so the host consumed it a frame later and the screen paired this frame's car with
  last frame's camera — the pairing carries the car's whole travel for that frame, and frame-clock jitter
  modulates it. Re-read off the SAME captures, both pairings, `wing-l` horizontal off-axis jitter:

  | build | pairing rendered | as rendered | intent |
  | --- | --- | --- | --- |
  | as shipped by 096/04 | frame-late | **0.332°** (≈ 7 px) | 0.311° |
  | + the mount fix | frame-late | **0.305°** | 0.032° |
  | + the director stepped IN the host loop | same-frame | **0.0050°** (≈ 0.1 px) | 0.0050° |

  So the mount fix was real and necessary — it is what takes the same-frame number from 0.311° to 0.032° —
  but on its own it moved what the viewer sees by 8 %. The fix that mattered to the eye is the wiring:
  `setVideoStep` installs the director's step and the host calls it inside its loop, between the car's render
  pose and the camera snapshot, so the shot is composed from the frame it is drawn in. Both together are
  **66× less shiver than the code the user first watched**. A side effect worth recording: with the module's
  extra rAF pass gone the frame clock itself steadied, dt jitter 3.1 → 2.2 ms RMS and its spread 16 → 5 ms.
  `video-shiver.ts` now prints both pairings side by side and the `frame-late` column is a regression
  tripwire. The lesson — a metric taken against the input rather than against what renders — is in
  `docs/restrictions/architecture.md` next to the rule itself, because it is what let a reported bug survive
  a measurement that called it fixed.
  **The second defect the same measurement found**, fixed in the same change: `anchorFor` mirrored the
  lead-room anchor on a hard threshold (`|screenMotion| < 2 m/s`), so the anchor stepped **0.24 of the frame's
  width** in one frame when the signal drifted over the line — and `nose` is the shot that sits on it, because
  its eye rides a few degrees off the car's axis and puts the crossing signal at ~0.11 × speed. Lead room is
  now PROPORTIONAL to the crossing speed (smoothstepped to ±1 at 2 m/s, which every wing and tripod shot
  saturates anyway), so the table's `anchor.x` states how MUCH room the shot wants and the motion decides
  which side it goes on. Two consequences worth knowing: a car that is not crossing the frame is now framed
  centred rather than on the authored side (there is no lead to give), and `nose` at a cruise gets ~66 % of
  its room instead of an arbitrary full-or-nothing. Swept over ±8 m/s the anchor now moves at most **0.0036
  per 0.04 m/s** against the old 0.24 step; both the mount and the anchor tripwires are `negative cases` in
  `shots.test.ts` / `director.test.ts` and both were confirmed to FAIL against the code they replaced.
  **Acceptance for the whole round**, the 03/04 exam re-run on the same 5 seeds × 5 scenes:
  **35 733 directed frames, safe frame 99.18 %** (per-seed 97.86-100 %), **0 `[cam] jump` lines**, 56 cuts,
  **0 empty-frame cuts**, 1 occluded, all 25 scenes ended `ran-out`. That is 04's number to the digit, with
  the pan cap bitting slightly less often (5.9 % against 6.2 %) — three framing changes and the exam did not
  move, which is exactly the point: these numbers were never able to see the defect and still cannot. They
  are here to prove nothing ELSE broke. **The verdict that closed the round was the user's own second look:
  "the camera has stopped shivering at every angle I saw."**
- 05: **DONE 2026-07-31.** The cycle, the presets and the car pick — `apps/web/src/ui/video/presets.ts` is the
  table, `engine-video-runs.ts` stays about staging. **Headless, seed 47, `build/original/opensa`, DPR 1, two
  full cycles (17 scenes, 10 of them drives):** every region visited **in D2's order, twice** (LA → VEGAS →
  SF → COUNTRYSIDE → DESERT), **12 680 directed frames at 100.00 % safe frame**, **0 `[cam] jump` lines**,
  20 cuts, pan cap on 1.56 % of frames, every scene ended `ran-out` — 0 stuck, 0 empty-frame cuts, 0 throws.
  **0 mid-scene weather changes** (D15's tripwire never fired: no route left its region). Ten drives, **ten
  different cars** off a 144-model road-car roster (`broadway`, `fbiranch`, `packer`, `patriot`, `copcarla`,
  `previon`, `benson`, `mule`, `tampa`, `picador`), each in one of its region's own weathers and one of the
  five hour slots. The `fly`/`walk` entries logged their skip and their regions DIFFERED between the two laps,
  which is the program being rebuilt per lap rather than one fixed eight.
  **Two things the phase doc did not say, decided here.** The sequencer's pure half lives in
  `ui/video/presets.ts` beside the director rather than at `apps/web/src/video-presets.ts` — the module layout
  03/04 settled on. And the mod-car preference draws its two branches from DISJOINT pools: the first cut let
  the stock branch fall back on the whole roster, which a unit test caught as a realised share of 0.90 against
  a configured 0.80. That is not a rounding difference — the share would drift with how many slots a game has
  modded, and a heavily modded install would stop showing stock classics at all, which is the half of D10 that
  is easy to lose. Disjoint pools make the realised share BE the configured one, which is also the only way
  the phase's own acceptance ("mod-car share ≈ the configured preference") means anything.
  **Not measurable yet:** the mod-car share itself (0 % — `data/vehicle-mods.txt` is 06's to write; the
  runtime reader ships here, tolerant, and an absent ledger is an empty set). The ledger's FORMAT stays 06's
  to confirm and to record in `docs/contracts/vehicles.md`.
  New tool: `scripts/debug/video-accept.ts` rolls the exam up off a harness log, so the next phase re-sits it
  against the same question rather than re-reading JSON by hand.
- **05a: D2 revised (user, 2026-07-31) — a run is a bounded SEQUENCE.** `?seed=47` now means scenes 1…100 of
  seed 47 and then a stop, on a black end card reading `sequence complete · seed 47 · N scenes`; `&scenes=N`
  takes a shorter one and 100 is the CEILING, so a longer sequence stays a decision. The chrome is not handed
  back — it would put the HUD into the last frame recorded.
  **The one judgement call inside the change: a skipped `fly`/`walk` entry still consumes a scene index.** A
  scene's identity is `(seed, index)`, and it has to survive 07: if skips were free, the day the walk and
  flythrough scenes land every later scene would re-seed, and every field note naming "scene 57 of seed 47"
  would point at a different scene. The cost is that a 100-scene run plays ~62 drives until 07 fills the rest.
  **What a seed does NOT fix, stated because the request was "strictly reproducible":** time, weather, route,
  car, paint and the SHOT LIST all derive from `sceneSeed(master, index)` and reproduce exactly — a re-run of
  seed 47 matched its manifest byte for byte. Frame-by-frame camera MOTION does not, and cannot: the director
  integrates real `dt`, so an early guard cut (empty frame, blocked tripod) depends on how the frames fell.
  Two runs of one seed are the same scenes, shot for shot, and may differ in where a shot was cut short.
- 06: **DONE 2026-07-31.** The mod-car ledger: `vehicle-installer` writes `data/vehicle-mods.txt`, the
  renderware text parsers read it back (`vehicle-mods.parser`, beside `vehicle-features.parser`), and the app
  layer feeds it to 05's car pick. **`--in mods-src/original/vehicles` → 12 slots**, exactly the corpus the
  research counted (`admiral alpha banshee comet elegy hermes petro previon stallion stratum supergt
  yosemite`); gostown, carcer and anderius carry 2 mod cars each. The `data/` route needed no change — the
  built tree copies the whole directory, which `vehicle-features.txt` already proves.
  **Field check on the BUILT game** (`--rebake original`, 12 cars, 295.1 MB of `.osm`, the sanctioned in-place
  route rather than hand-copying a file into a build): `build/original/opensa/data/vehicle-mods.txt` carries
  the 12, video mode logs `144 road cars, 12 mod slots` and marks its picks `(mod)` —
  `alpha → comet → petro → previon → banshee` over the first five scenes of seed 47.
  **The invariant, confirmed in the field rather than only in a test:** those five scenes kept the SAME scene
  seeds, hours, weathers and routes as the pre-ledger run (scene 1 is still `hour=0 SUNNY_LA route=392m
  corner=48.5m`) and changed only the car. That is 05's "the ledger must not change how far the seeded stream
  advances" holding on real data — a seed names the same scenes whatever mods are installed.
  **Realised mod share**, computed off the real roster and ledger through the same pure `pickCar` (100 scenes
  × 5 seeds — the pick is deterministic in `(seed, index)`, so this needs no boot): **0.77-0.84 against the
  configured 0.80** (σ ≈ 0.04 at n = 100), 27-32 distinct cars per 100 scenes.
  **The risk the phase named is pinned by a test**: `--rebake --only zr350` MERGES into the ledger. A rebake
  rewriting it from its own selection would tell video mode that every other mod car in the build is stock,
  and nothing else in the game would notice.
- 07: —
- 08: —
