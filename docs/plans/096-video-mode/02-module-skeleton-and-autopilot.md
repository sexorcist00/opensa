# 096/02 — Module skeleton + autopilot drive scene v0

**Priority P0. Ships alone: `?video=1&seed=N` plays ONE seeded drive scene in one region on the EXISTING
chase camera, in a loop — recordable footage with ugly cuts. This is the phase after which the feature
exists.**

## What exists (reuse, do not rebuild)

- The whole scene skeleton is the `?phys=` runner (`apps/web/src/ui/engine-phys-runs.ts:229-279`):
  leave car → teleport beside spot → 3-stage streaming settle (`:64-70`, `:246-253`) → `spawnWithRetry`
  → `seatInstantly()` → 2 s spring settle → play input timeline → capture. Copy its shape and its
  frame-clock helpers `until()`/`waitSeconds()` (`:315-330`).
- Host accessors already wired for bench/phys (`engine-canvas-host.tsx:1633-1697`): `teleportPlayer`
  (phys-style resets render interpolation), `getStream`, `setHour`, `setWeather` (instant), `getVehicles`,
  `spawnCar(model, position, heading)` (`:1683`), `beginSamples`/`takeSamples`, `toEngine`, `params`.
- `ScriptedDriveSource` (`packages/game/src/vehicle/scripted-drive.ts`) — the shape of an inert-when-idle
  `InputState` living permanently in `CombinedInput`, advanced from the fixed loop (`:1261`).
- Vehicle pose readers: `EnterVehicleSystem.getActive()`, car `position/heading`,
  `physics.vehicleSpeed`; per-fixed-step telemetry (`vehicle-telemetry.ts` / `phys-capture.ts`) with
  `t,speed,slipAngle,…,x,y,z` series — the autopilot's acceptance instrument.
- UI hide: `events.emit('fly-camera', { enabled, photo })` (`engine-canvas-host.tsx:628`).

## Tasks

### A. `PathFollowSource` — the autopilot (`packages/game/src/vehicle/path-follow.ts`)

1. `implements InputState`, neutral when idle, installed permanently in `CombinedInput` next to
   `scriptedDrive` and advanced from the same fixed-step site — the exact `ScriptedDriveSource` pattern.
   API: `follow(route: Route, opts)`, `stop()`, `state(): 'idle' | 'following' | 'arrived' | 'stuck'`.
2. Each fixed step it reads the car pose (position, heading, signed speed — injected as thin accessors at
   construction, no direct system coupling) and emits:
   - **Steer (`move.x`)** — pure pursuit on the smoothed route: lookahead point at
     `L = clamp(kL · v, Lmin, Lmax)` (start `kL = 0.9 s`, `Lmin = 6`, `Lmax = 25` m); curvature
     `κ = 2 · sin(α) / L` (α = bearing error to the lookahead point); map κ → `move.x` through the
     KNOWN steering model — `STEER_RATE = 1.2 rad/s` slew + speed-dependent `steerLimit()` — i.e. the
     controller compensates the slew by leading the target, never by gain (the anticipate-don't-react
     rule). Clamp; deadband ~0.02 to avoid dither on straights.
   - **Throttle/brake (`move.y`)** — PI toward the route's per-vertex target speed sampled at a
     braking-distance horizon (`v²/2a` with `a ≈ 3 m/s²`), so the car slows BEFORE the curve. Calm-cruise
     cap `vCruise = 12 m/s` v1 (D8). Negative `move.y` brakes (the shipped semantics).
   - **Cross-track correction** — small proportional term of lateral offset from the route added to the
     pursuit bearing (gain low; pursuit does the real work).
3. Guards: `arrived` when within `ARRIVE_M = 8` of the final vertex; **stuck** when `speed < 1 m/s` for
   3 s while throttle > 0.5 (curb snag, wall) → report; the scene ends early behind the overlay rather
   than grinding a wheel on camera. No handbrake/jump actions in v1.
4. Unit tests with a kinematic bicycle-model stub (pure math, deterministic): converges to a straight
   within 1 lane from a 5 m offset; slows for a 90° corner; flags stuck. Negative cases first.

### B. `setupVideoRuns` — the module skeleton (`apps/web/src/ui/engine-video-runs.ts`)

5. `VideoRunsHost` interface (narrow accessors, mirrors `PhysRunsHost`): params, events, stream, hour,
   weather, teleport, spawnCar, vehicles (`seatInstantly`/`leaveCar`/`despawn`), autopilot
   (`follow`/`stop`/`state`), samples, toEngine, settleTimeoutMs. Host wires it in ONE block after
   `setupPhysRuns` (`engine-canvas-host.tsx:~1697`).
6. Gate: `params.get('video')` absent → return. Parse `from`/`to` (default 10/25, real seconds) and
   `seed` (default: derive one, but ALWAYS print `[video] seed=…` — D9). Rows added to
   `docs/development/query-parameters.md` in this change.
7. **Black overlay** — a module-created DOM element over the canvas (opacity 1 ⇄ 0, ~300 ms fade; plain
   element, no React coupling). The module is its single owner in every mode including headless (the 094
   rule); it exists from the first frame of video mode, so the ownerless state cannot occur. Scene
   staging happens entirely behind it.
8. **UI hide**: emit `'fly-camera' { enabled: true }` on mode start, `false` on tab-visible teardown.
   Never call `setSoakStatus` — all progress is console `[video]` lines (D12).
9. **Scene v0 loop** (one region hardcoded to LS for this phase only — the sequencer replaces it in 05):
   pick a route (01's builder, seeded) → set hour/weather instantly → teleport player near route start →
   phys-recipe settle (1 s notice + drain + 2 s warmup) → spawn a car at route start, heading along the
   first segment, `spawnWithRetry` → `seatInstantly()` → 2 s spring settle → **fps stability gate**:
   `beginSamples()`, lift the overlay only after 30 consecutive frames < 25 ms (or settle timeout) →
   `follow(route)` → run `durationS = from + rng() · (to − from)` real seconds on the frame clock →
   overlay down → `stop()`, `leaveCar()`, despawn, next seed → repeat. Camera: the SHIPPED vehicle
   follow rig — zero camera work in this phase.
10. Telemetry capture per scene (the phys instrument): emit one `[video] {json}` line with the series;
    `scripts/debug` gets nothing new — `tools-debug/bench-harness/drive.js` with `TAG='[video]'` is the
    headless driver as-is.

## Acceptance / verification (the 081 method — telemetry first, then a field look at a HARD route)

- Headless run of 5 seeds on an LS route set chosen with `video-routes.ts` to include one real corner:
  - cross-track error p95 ≤ 1.5 m, max ≤ 3 m (one lane);
  - `|gLat|` p95 within the calm band (≤ 0.35 g — numbers recorded, band frozen after the first run);
  - 0 stuck flags on accepted routes; speed within ±20 % of target off-corner.
- Same seed twice → identical route, car, hour, weather, and telemetry within physics determinism noise
  (record the residual — it is the reproducibility floor `?seed=` can honestly promise).
- A field look: does it READ as calm competent driving? (The number bands are necessary, not sufficient.)
- Ledger numbers: error percentiles per seed, the stability-gate wait time, cold-teleport spike duration
  behind the overlay.

## Risks / notes

- Keyboard sums with the autopilot (`combine-input.ts:45-55`) — accepted v1 limitation, documented in the
  feature doc: hands off the controls while recording.
- Teleport → spawn → enter is the `vehicle-enter-null-body` recipe (D16): if it fires, ship fix option 1
  (defensive `readBody` guard + registry prune + test) in the same change.
- `seatVehicleOnGround` throws when the collision cell has not streamed — `spawnWithRetry` exists for
  exactly this; keep the retry, do not "fix" the throw.
- The approach state machine self-cancels on stray input (`APPROACH_*` consts) — irrelevant while
  `seatInstantly` is used; do NOT switch to the walk-up entry in this phase (that is an 08 nicety if
  ever).
