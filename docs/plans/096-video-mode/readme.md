# 096 — Video mode (self-directed showcase runs for trailer footage)

**Status: PLANNED 2026-07-30.** Graduated from `docs/ideas/video-mode/` the same day it was researched —
the four-way repo sweep (paths/driving, camera, streaming/host, player/vehicles) and every user decision
moved into this doc, per the lifecycle rule that a validated idea's research record MOVES into the plan.

**Goal: `?video=1` boots the game into an endless, seeded, self-directed showcase.** A random car — mod
cars first — spawns on a road, the player gets in and cruises a route generated from the game's own
`NODES*.DAT` graph while cameras cut between occlusion-checked tripod stations and chase/front/rear/wing
views; other scenes walk the player or fly the camera. Every fragment runs 10–25 real seconds on a fully
streamed world, UI hidden, black overlay between scenes. The user screen-records with OS tools and edits
the cuts out by hand.

**NOT named "cinematic"** — that word belongs to the shipped 080 follow-camera chain in every doc, test
and ledger. This feature is a *director* over that camera, plus an autopilot under the car.

## Decisions (user, 2026-07-30 — frozen for v1)

| # | Decision |
| --- | --- |
| D1 | Entry `?video=1`; fragment length `&from=10&to=25` (REAL seconds; defaults 10/25); `&seed=N` |
| D2 | Region cycle LS → LV → SF → Country → Desert, endless until the tab closes |
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
| [04](04-stations-and-occlusion.md) | Tripod stations: survey, occlusion, cuts without flicker | **P1** | 03 |
| [05](05-sequencer-regions-presets.md) | Sequencer: region cycle, weather/time presets, car pick | **P1** | 02 (04 for full look) |
| [06](06-mod-car-ledger.md) | Build-time mod-car ledger (tool + pack + runtime read) | **P1** | — (feeds 05) |
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
- 04: —
- 05: —
- 06: —
- 07: —
- 08: —
