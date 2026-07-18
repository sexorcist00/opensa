# 074·22 — Debug tools port: F2 debugger + photo mode + pointer capture

[← chain](readme.md) · the LAST pre-flip blocker ([10](10-integration-flip.md))

**Status: BLOCKER (user, 2026-07-17) — "the debugger is core workflow; its point is live config
mutation." Scope raised from an audit to the full port. THE FLIP SEQUENCE: this plan ships →
remind the user to run `?bench=all` on the display AND the parity screenshots → flip.**

## The headline finding (audit, 2026-07-17)

**The engine host mounts NONE of the three debug tools today:**

1. **F2 debugger** — `DebugOverlay` + `DebugActions` live only in `canvas-host.tsx` (three);
   `engine-canvas-host.tsx` has a read-only `<pre>` HUD and URL params.
2. **Photo mode** — prod's **K+M chord** toggles a detached free-fly camera
   (`game.setFlyCamera` → camera mode `'fly'`: ARROWS move, mouse looks, gameplay untouched;
   F2 drops fly mode; `fly-camera` event). Nothing similar on the engine host.
3. **Pointer capture button** — prod shows the `sa-capture` **"Click to play"** button whenever the
   pointer is not locked (lock via `canvas.requestPointerLock()`, look = movementX/Y while locked,
   pause/F2 exit the lock, `pointerlockchange` drives the button visibility). The engine host locks on
   canvas click but has NO button — no affordance telling the player to click.

Mechanics that make the port cheap: every debugger control mutates the shared runtime `Config` in
place (`game-runtime-config.ts` — ONE source of truth, both hosts already consume it), and the engine
host re-reads config every frame through the environment driver. Bucket-B controls work the moment the
overlay mounts; bucket A needs `DebugActions` implementations; bucket C needs per-host gating.

---

## Task breakdown (detailed — nothing gets lost)

### Phase 1 — decouple the overlay from the three `Game` object

- [x] 1.1 Inventory every `game.*` touch inside `debug-overlay.tsx` / `perf-panel.tsx` /
      `map-inspector.tsx`. **RESULT — the surface is far narrower than feared:** `debug-overlay.tsx`
      touches the game object exactly ONCE (`game.events.on('city')`); `perf-panel.tsx` touches it
      NEVER (it already goes through `DebugActions.setPerfEnabled/perfStats/gpuTimings`); the whole
      rest — `getConfig`, `getViewCell`, `listCells`, `setMapViewer`, `setManualCells`,
      `setShowCollision`, `hideSelectedObject`, `restoreHiddenObjects`, `events.on('select')` — is
      confined to `map-inspector.tsx`, i.e. to the PARKED Map screen.
- [x] 1.2 `DebugGame` = `{ events: Pick<EventBus<GameEvents>, 'on'> }` (the whole overlay view of
      the game). The inspector's `Game`-shaped surface moved to a separate OPTIONAL `mapGame` prop
      instead of widening `DebugGame` — the engine host simply omits it. Prod passes
      `game={game} mapGame={game}`: zero behaviour change.
- [x] 1.3 `debug-capabilities.ts`: `DebugCapabilities` (per-control/per-screen flags; 20 after phase 2 added `cameraRig`) +
      `ALL_DEBUG_CAPABILITIES` (three host, the default when the prop is omitted) +
      `ENGINE_DEBUG_CAPABILITIES` (bucket-C rows off). Screen filtering (`menuFor`) and the split sky
      slider list (`skyControlsFor`) moved OUT of the .tsx into this pure module so they are unit
      testable (the vitest lane is node-only, `.tsx` is e2e territory); `__DEBUGGER_HIDE__` became a
      `menuFor` parameter instead of a global read.
- [x] 1.4 Unit tests — `debug-capabilities.test.ts`, 7 cases (map screen drops for the engine, dev-only
      screens drop in the deploy build, both full menus, god-ray sliders drop / shared sky keys stay).

### Phase 2 — engine-host `DebugActions` (bucket A: gameplay actions) — SHIPPED 2026-07-18

Landed as `apps/web/src/ui/engine-debug-actions.ts` (`createEngineDebugActions(deps)`, thin host accessors
like `setupPerfRuns`) + the wiring in `engine-canvas-host.tsx`; the overlay mounts with
`ENGINE_DEBUG_CAPABILITIES`. Every graphics row is a plain mutation of the shared `Config` — no per-host copy.

- [x] 2.1 `teleport` / `teleportToGanton` / `respawnPlayer` — over the host's `placePlayer` (physics.teleport +
      Transform writes), the same path the bench teleport uses.
- [x] 2.2 `playerCoords()` — the host `viewOf()` (native Z-up).
- [x] 2.3 `setGameTime(minutes)` — host `hour` (the env driver applies it the next frame).
- [x] 2.4 `setWeather` + `weatherList()` — `WeatherTransition.begin` at `config.weatherTransitionSeconds`,
      sharing the live `[`/`]` weather id; list = the renderware `WEATHER_NAMES` (26 entries).
- [x] 2.5 `vehicleModels()` / `spawnVehicle()` / `flipVehicle()` — `vehicleModelsFromIde` + `vehicles.spawn`
      (awaits the worker model build, carcols colour cycle, `groundSnap`). **Direction gotcha found in the
      field:** the first spawn landed BEHIND the camera — the host's `yaw` is a camera azimuth whose native
      forward is `(sin yaw, −cos yaw)`, while a heading `h` points along `(−sin h, cos h)`, so the car spawns
      at `+forward × 5` with heading `yaw + π`. Flip = prod's algorithm with the quaternion written out
      (the host stays three-free).
- [x] 2.6 `breakNearest()` — new `CollisionStreamingSystem.nearestBreakable(position, radius)` (shared, unit
      tested) + `EngineBreakables.breakNearest`; `smash(impact)` was refactored to `smashKey(key, force, …)`
      so the debugger's forced smash (`force = Infinity`) and a real contact share one path. Tuned-
      indestructible props still survive, as in prod.
- [x] 2.7 `setFlyMode(on)` — the PHOTO CAMERA (one implementation, phase 5 adds the chord): a detached eye
      seeded from the live camera, ARROWS move / PageUp-Down lift, the player entity is untouched. The pure
      halves live in `engine-camera.ts` (`flyStep`, `resolveCamera` — bench > photo > follow rig), unit tested.
- [x] 2.8 Camera screen — **split by counterpart**: distance + zoom bounds now re-read live (a debugger change
      re-seeds the wheel zoom; `followZoom` gates the wheel, as in prod). The five follow-RIG sliders
      (height/angle/response/angle limits) have NO engine counterpart — its orbit is mouse yaw+pitch with a
      fixed eye height — so they are gated off by the new `cameraRig` capability (`cameraControlsFor`).
- [x] 2.9 ProcObj screen — the adapter now gets `procObjDensityOf` (0 when a category is disabled, prod's
      wiring) and `setProcObj` re-scatters: `invalidateColliderCache` + `collision.reload()` + clutter cells
      dropped, so render and colliders re-run from ONE scatter. Field: all 7 categories off →
      draws 206 → 186 (repeatably ~10 %), no errors. Owed: a pixel A/B at a clutter-only spot (Truth's Farm
      keeps its AUTHORED bushes, which reads as "nothing happened" on a screenshot).
- [x] 2.10 Browser click-through with the headless harness (fake picker, real LS install), all clean:
      panel opens on F2 · **Map screen absent from the menu** (capability gating) · Position shows
      `CITY: Los Santos` (the shared `CityZoneSystem` is now wired on this host, emitting `'city'` on the
      shared bus) + live coords + the teleport list · Time 12:00 preset → HUD clock 12:01 · Graphics shows
      god-rays/mood/pbrExposure/bloom/tonemap/reflect-intensity and HIDES SSAO, CSM, water, rays-size,
      density/exposure/weight · Vehicles filter + spawn (draws 567 → 618) · fly mode detaches the camera
      while the player coords stay at `2495.0, −1675.0, 13.3` (that is phase 5.5's criterion, met early) ·
      Weather list 26 · 120 fps throughout, no page errors.

### Phase 3 — engine-host graphics wiring + the Perf screen — SHIPPED 2026-07-18

- [x] 3.1 Per-control smoke, metered headless (screenshot → ImageMagick crop means, so "it changed" is a
      NUMBER). Noon, right-third crop vs base `134.9/132.4/128.5`: bloom intensity+threshold → `189.6`
      (huge) · `sky.pbrExposure` 0.05 → `132.2/127.6/118.0` · `sky.mood` 1.0 → `132.9/130.6/128.4` ·
      tone map off → `128.8/125.4/121.4` · `worldLight.dayBrightness` 0.3 → `117.6`. Sky-band crop:
      `sun.godrays` off → blue −3.7 · cloud cover/opacity max → blue −3.2. Night (22:00), same crop vs
      `40.1/31.1/22.6`: `night.emissiveBoost` 4 → `41.6` · `night.skylight` 2 → `54.4` ·
      `moon.brightness` 3 → `52.5` · `worldLight.nightPrelitBrightness` 1.5 → `63.8` ·
      `vehicleReflection.intensity` 3 → the car crop moves `71.9/34.4/33.6` → `28.7/27.0/29.3`.
      **BUG FOUND AND FIXED — the whole point of the pass:** `night.litFade` did nothing (`40.0` before and
      after). `createEngineEnvironmentDriver` destructured `litFade` (and computed `fogScale`) ONCE at build
      time, while the debugger REPLACES nested config objects (`setNight({ litFade: {...} })`) — so both
      froze at their boot values. Both now read inside `apply()`; regression test added
      (`engine-environment-driver.test.ts`). Re-metered: dusk window → 23:00 at hour 22 now flips the world
      to day lighting, `40.1` → `91.8`.
- [x] 3.2 Streaming screen — **user decision (2026-07-18): no slider, a line of text.** The Draw Distance /
      HD / Fog sliders live on the Map screen, which is capability-gated off here anyway; the engine Perf
      screen instead states `draw distance <N> m — boot-only, set with ?draw=N`. No live ring setter is
      built (plan 21 showed re-ringing is its own project); it stays a post-flip option.
- [x] 3.3 Perf screen — REPLACED with the engine ledger (`EnginePerfPanel`, chosen by the presence of
      `engineStats`): FPS · frame avg/p95 · draws · gpu world/post/probe · submit · cells loaded/pending ·
      late creates · residency MB + the by-category breakdown · the draw-distance note. Rows are built by
      the pure `engineStatRows(snapshot)` (unit tested); three's `renderer.info` counters (triangles,
      programs, geometries, textures) have no engine twin and are gone.
- [x] 3.4 **The Perf screen now OWNS the two developer readouts** (user request, 2026-07-18): the
      on-screen HUD and the `[slow]` console breakdown are toggles there, defaulting to
      `process.env.NODE_ENV !== 'production'` (`apps/web/src/dev-mode.ts`) — ON while developing, OFF in a
      deploy build. The hidden HUD also stops being composed (the string build is the frame's last work);
      a running soak forces it back on, since its verdict is read OFF the HUD. Field: toggling flips
      `#engine-hud` to `display: none`, and a cross-city teleport after switching logs off produced no new
      `[slow]` lines.
- [x] 3.5 **The F2 tip does not show in development** (user request, same round): `GameHint` returns null
      under `IS_DEV` — it is a notification aimed at players, and it covered the corner of the screen for
      the person who wrote the debugger.

### Phase 4 — bucket C gating on the engine host — SHIPPED 2026-07-18 (NOTHING deleted from prod)

- [x] 4.1 Hidden by capability. **The pass found MORE dead rows than the audit listed** — the phase-3 metering
      had proved a knob "works" while its neighbour in the same block did nothing, so every remaining row was
      traced to a consumer in `engine-environment-driver` / the host. Three additions to the gate:
      **CLOUD COVER** (`cloudCover` — the engine takes cover/scale/tint from the per-weather cloud profile
      since sky v2; only `clouds.opacity` reaches the frame), **MOON SIZE + ELEVATION** (`moonRig` — the
      engine builds its own moon arc and draws the disc in the sky model; `moon.brightness` is the one live
      knob) and **five of the seven WORLD LIGHT scalars** (`worldLightExtras` — the driver applies
      `dayBrightness` and `nightPrelitBrightness` only). Row lists follow the phase-2 pattern
      (`worldLightControlsFor`, unit tested), so the split is data, not JSX conditionals.
- [x] 4.2 Per-row disposition — the table below. Nothing is deleted: C2 (plan 13) removes the three path and
      with it the rows marked _retire_; the rest name the plan that would bring them back.
- [x] 4.3 Verified in the browser — the full engine-host row dump, screen by screen:
      **Atmosphere** = dusk/dawn ×4 · cloud opacity · moon brightness · night emissive · night skylight ·
      world day · world night prelit. **Camera** = distance · min/max zoom · wheel zoom.
      **Graphics** = god rays · mood · pbrExposure · bloom + intensity + threshold · tone map ·
      reflect intensity. **ProcObj / Player / Time / Weather / Position / Perf** unchanged.
      Every surviving row was measured moving the frame in phase 3.1 — the engine debugger now has NO row
      that does nothing.

### Phase 5 — photo mode (prod parity: K+M) — SHIPPED 2026-07-18

- [x] 5.1 Free-fly camera state — landed with phase 2.7 (`flyEye`, seeded from the live camera on entry,
      follow rig resumed on exit; the player entity is never touched).
- [x] 5.2 Prod semantics and prod CONSTANTS: `FLY_SPEED` 24 → **18**, the value in
      `camera-controller.ts`, so both hosts fly at the same speed. The strafe axis was also wrong and is
      now prod's: `right = forward × up` = `(−cos yaw, 0, sin yaw)` — ArrowRight used to strafe the wrong
      way. ARROWS move, the mouse look is the shared yaw/pitch; PgUp/PgDn lift (an engine addition — prod's
      fly camera has no vertical key, and a photo camera wants one).
- [x] 5.3 K+M chord — prod's state machine extracted as `createChordWatcher` (fires ONCE while both keys
      are held, re-arms only after a release; key repeat cannot re-fire it), unit tested. F2 drops the photo
      camera; **pausing drops it too** (with the pointer-lock release that was already there).
- [x] 5.4 HUD gained the chord line: `F2 = debugger · K+M = photo camera (ARROWS move, PgUp/PgDn lift,
mouse looks)`.
- [x] 5.5 Verified headless: chord ON → the frame changes completely (RMSE 0.26 vs the follow shot) while
      the player HUD coords stay at `2495.0, −1675.0, 13.3`; chord OFF → the follow rig returns
      (RMSE 0.036 vs the original — clock text only); flying high then F2 → back on the follow rig, and the
      debugger's Player screen agrees (`Fly Mode On` = it is off). **Bonus parity that fell out of reusing
      prod's `'fly-camera'` event: the game HUD (clock/zone) hides itself in photo mode**, because the
      shared `<Hud>` already listens for it — one emit, zero new code.

### Phase 6 — pointer capture button — SHIPPED 2026-07-18

- [x] 6.1 Prod's `sa-capture` "Click to play" button ported into `EngineCanvasHost` verbatim — same class
      (so the shell CSS already styles it), `locked` state from `pointerlockchange` compared against THIS
      canvas, hidden while locked, while paused, or before the world is up.
- [x] 6.2 The existing canvas-click lock stays (the button is the affordance, not the only path); Esc /
      pause still release the lock, and pause now also drops the photo camera (phase 5).
- [x] 6.3 Verified headless: visible at boot (screenshot shows CLICK TO PLAY centred over Ganton) ·
      hidden while the pointer is locked · back when the lock is released · hidden while paused (Esc opens
      the pause menu, HUD reads `PAUSED`). **Harness note:** headless Chromium refuses a real pointer lock,
      so the locked/unlocked branch was driven by stubbing `document.pointerLockElement` and dispatching
      `pointerlockchange` — that exercises OUR rule; the request path is prod's code unchanged.

### Phase 7 — close-out

- [x] 7.1 The ritual display sweep — **user-run `?bench=all` on both renderers, 2026-07-18**, recorded in
      [bench/series.md § 22·debug-tools](bench/series.md). Engine: all six scenes vsync-locked, avg
      8.33–8.41 ms / p95 ≤ 9.4 (118.9–120.1 fps), draws 11–1 069, `lateCreates` 0. Prod (`?engine=three`,
      same 841-car population): 16.7–38.8 fps on land, 4 252–10 078 draws. Frame ratio 3.1–7.2×.
      **The overlay costs nothing while closed** — the engine rows match the pre-port C1 rows (8.32–8.33
      then, 8.33–8.41 now, inside noise).
- [x] 7.2 Series row written (with the honest tail: the residual 20–54 ms hitches are Rapier step time at
      ~1 000 bodies / 5 378 colliders, not the renderer; one 22.8 ms collision-cell spike; residency
      ≈1.6–1.7 GB at 2× with 841 cars). Bucket D stays a POST-FLIP batch for the user to pick from.
- [ ] 7.3 **Remind the user: parity screenshots → THE FLIP.**

---

## Audit reference (2026-07-17) — the four buckets

### Bucket A — carries AS-IS (renderer-agnostic; Phase-2 wiring)

| Screen   | Controls                                         | Engine-host reality today                                               |
| -------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Player   | fly mode, respawn, to-Ganton, break nearest prop | breakables EXIST (B7); fly/respawn/teleport need `DebugActions` impls   |
| Vehicles | filter + spawn any vehicles.ide model, flip      | vehicle system EXISTS (B5, worker builds); spawn/flip need action impls |
| Time     | presets + 0–1439 slider                          | engine host has `hour` — trivial                                        |
| Weather  | timecyc weather list                             | `WeatherTransition` already wired (6 s blend, `[`/`]` keys) — trivial   |
| Position | city label, coords, copy, teleports              | teleport = the bench `teleportPlayer` path — trivial                    |
| Camera   | 8 follow sliders + wheel-zoom toggle             | same `camera.*` config — verify live re-read                            |
| ProcObj  | per-category enabled/drawDistance/density        | engine clutter uses the SAME scatter — verify config reaches it live    |

### Bucket B — already flows through the env driver (works once the overlay mounts)

`graphics.bloom.{enabled,intensity,threshold}` · `graphics.sun.godrays` · `graphics.sky.mood` ·
`graphics.sky.pbrExposure` · `graphics.clouds.opacity` · `graphics.night.emissiveBoost` ·
`graphics.night.litFade.*` (4 sliders) · `graphics.night.skylight` · `graphics.moon.brightness` ·
`graphics.worldLight.{dayBrightness,nightPrelitBrightness}` · `graphics.toneMapping` (on/off) ·
`graphics.vehicleReflection.{preset='off',intensity}` · `fog.timecycScale`. **All verified with metered
screenshots in phase 3.1** — and that pass is what caught the driver reading `night.litFade` / `fog.timecycScale`
only once at boot.

### Bucket C — hidden on the engine host, with their DISPOSITION (phase 4.2 — user reviews before C2)

`retire` = dies with the three path at C2 (plan 13) · `plan 17` = comes back with the map-lighting round ·
`needs feature` = the engine would have to grow something first · `0.6.0` = an idea-cycle plan owns it.

| Control (prod)                                                                                         | Why it has no engine counterpart                                              | Disposition                  |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------- |
| Tone-mapping CURVE selector (aces/agx/neutral/none)                                                    | engine ships ONE prod-exact ACES + on/off                                     | retire                       |
| Pipeline switch classic/modern                                                                         | one pipeline; the switch IS what C2 deletes                                   | retire                       |
| PBR sky toggle classic/pbr                                                                             | engine sky is always physical (`?sky=preetham` = dev A/B)                     | retire                       |
| Car reflect presets enhanced/PC/PS2                                                                    | engine = skygfx-neo live probe; off/on + intensity remain                     | retire                       |
| SSAO enabled/intensity/radius                                                                          | replaced by the BAKED AO channel                                              | bucket D (`aoStrength`)      |
| Sun shadows + CSM distance                                                                             | no CSM; baked sun-vis (`sunVisStrength`)                                      | 0.6.0/04 shadows             |
| Volumetric clouds toggle                                                                               | no raymarcher; decks are the baked 256² field                                 | retire                       |
| God-rays shader sliders density/exposure/weight                                                        | engine godrays = one pass, one strength                                       | retire (strength → bucket D) |
| Night dynamicObjectsFill strength/rim                                                                  | plan-034 three shader; engine lights peds/vehicles itself                     | retire                       |
| Night skyGlow                                                                                          | built into the engine sky model (city glow + moon scatter)                    | retire                       |
| Night windowGlow                                                                                       | superseded by the baked emissive mask (`emissiveBoost` kept)                  | retire                       |
| Corona distance slider                                                                                 | engine restores the AUTHORED 2dfx farClip; a cap fights the data              | plan 17                      |
| Headlight pool sliders (beam/brake/glow/corona)                                                        | engine `dynamicLights` intensities are host constants                         | bucket D                     |
| Water sliders (6)                                                                                      | engine water = own shader (sea/inland, baked shore); no 1:1 mapping           | 0.6.0/02 water               |
| Sun size / rays size                                                                                   | `sunSize` comes from timecyc through the driver                               | retire                       |
| Show Normals / Show Faces                                                                              | three material overrides; engine needs a debug shader variant                 | needs feature                |
| Map inspector (manual cells, pick, hide/restore)                                                       | needs the plan-10 engine ray query                                            | needs feature                |
| Draw distance / HD / fog sliders (Map screen)                                                          | boot-time ring on the engine; the Perf screen states `?draw=N` instead        | needs feature (live re-ring) |
| Night stars toggle                                                                                     | the starfield is part of the sky model, no flag                               | retire                       |
| Night lights (lamps) toggle                                                                            | static lamp pool REMOVED 2026-07-17                                           | plan 17                      |
| Effects distance (2dfx particles)                                                                      | knob not wired                                                                | plan 17                      |
| **Cloud COVER** (found in phase 4)                                                                     | cover/scale/tint come from the per-weather profile (sky v2)                   | retire                       |
| **Moon SIZE + ELEVATION** (found in phase 4)                                                           | the engine builds its own moon arc + draws the disc in the sky model          | retire                       |
| **World light: dusk / LOD-night-amb / shadow strength / sun direct / sun indirect** (found in phase 4) | the driver applies day + night-prelit brightness only                         | retire                       |
| Camera follow-RIG sliders (height/angle/response/limits)                                               | engine orbit = mouse yaw+pitch, fixed eye height; distance + zoom bounds stay | needs feature                |
| Perf panel content                                                                                     | REPLACED with the engine ledger + HUD / slow-log toggles (phase 3.3–3.4)      | done                         |

### Bucket D — NEW engine-only knobs (POST-FLIP batch, user picks)

`renderScale` (THE tier knob — config exists, prod never had UI) · draw distance (`?draw`) ·
`aoStrength` · `sunVisStrength` · `windStrength` · `stochastic` (unstable v1) · `skyModel` A/B ·
`godrayStrength` · `fogHeightK`/`fogHeightMin` · probe on/off + `probeView` · `reflectionStrength`
raw · `moonPhase` · `bloomThreshold` night profile · dynamic light/corona intensities · bench/soak
launchers · wishlist: normals/wireframe debug pipeline, engine map inspector (needs ray query).

## Ledger

| Date       | What                                                                                                                                                                                                    | Notes                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-17 | Audit (3 explore passes: prod overlay · engine host+Environment · lab)                                                                                                                                  | Headline: no debug tools mounted on the engine host at all. Buckets frozen above.                                                       |
| 2026-07-17 | Scope raised to BLOCKER + photo mode (K+M) + capture button; plan renamed `22-debug-tools`                                                                                                              | User: after this ships → display `?bench=all` + screenshots → FLIP.                                                                     |
| 2026-07-18 | **Phase 7 (7.1–7.2)** — display `?bench=all` on both renderers recorded in series § 22·debug-tools                                                                                                      | Engine 118.9–120.1 fps all six vs prod 16.7–38.8; overlay-closed cost = none. Residual hitches identified as PHYSICS, not the renderer. |
| 2026-07-18 | **Phase 6 SHIPPED** — `sa-capture` "Click to play" ported to the engine host (locked/paused gating, shell CSS reused)                                                                                   | Field-verified all four states; real pointer lock is unavailable headless, so that branch was driven through `pointerlockchange`.       |
| 2026-07-18 | **Phase 5 SHIPPED** — K+M chord (prod's watcher, extracted + tested), prod fly speed/axes, F2 + pause drop it, HUD hint; the game HUD hides itself via the shared `'fly-camera'` event                  | Field: RMSE 0.26 photo vs follow, 0.036 back vs original; player never moves.                                                           |
| 2026-07-18 | **Phase 4 SHIPPED** — bucket-C gate closed; tracing every surviving row to its consumer found 8 MORE dead knobs (cloud cover, moon size/elevation, 5 world-light scalars)                               | Per-row disposition table written for the C2 review. Engine debugger now has no row that does nothing.                                  |
| 2026-07-18 | **Phase 3 SHIPPED** — bucket-B metered smoke (found + fixed the frozen `litFade`/`fogScale` driver reads), engine Perf ledger, HUD + slow-log toggles defaulting to dev, F2 tip hidden in dev           | 3.2 closed by user decision: text, not a slider. Suite 2150 green.                                                                      |
| 2026-07-18 | **Phase 2 SHIPPED** — `engine-debug-actions.ts` + host wiring (city system, procobj density, photo camera, spawn/flip/break), `engine-camera.ts`, `nearestBreakable`                                    | Browser-verified click-through (see phase 2.10). 18 new unit tests; suite 515 green.                                                    |
| 2026-07-18 | **Phase 1 SHIPPED** — `DebugGame` + optional `mapGame` + `debug-capabilities.ts` (19 flags, `menuFor`/`skyControlsFor` extracted as pure logic), bucket-C rows gated in the Atmosphere/Graphics screens | Prod unchanged (default = all capabilities; `mapGame={game}`). 7 new unit tests; tsc + eslint clean; apps/web suite 45/45.              |
