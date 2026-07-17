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

- [ ] 1.1 Inventory every `game.*` touch inside `debug-overlay.tsx` / `perf-panel.tsx` /
      `map-inspector.tsx` (known: `game.events.on('city'|'select'|'map-viewer')`, `game.perf` /
      `setPerfEnabled`, `gpuTimings()`, `game.setMapViewer/setManualCells/setShowCollision/
    hideSelectedObject/restoreHiddenObjects/getConfig`). Produce the exact list.
- [ ] 1.2 Cut a narrow `DebugGame` interface covering ONLY that list; `DebugOverlay` accepts it
      instead of `Game`. The three host passes `game` unchanged (it satisfies the interface) — zero
      behaviour change on prod.
- [ ] 1.3 Add a **capabilities object** to `DebugActions` (or a sibling prop): per-screen and
      per-control flags (`mapInspector: false`, `toneMappingModes: false`, `ssao: false`, …). The
      overlay hides unsupported rows the same way `DEV_ONLY_SCREENS` already hides deploy screens.
      Three host = everything on (until C2); engine host = the bucket-C rows off.
- [ ] 1.4 Unit tests for the capability filtering (screens/rows disappear; no dead buttons).

### Phase 2 — engine-host `DebugActions` (bucket A: gameplay actions)

- [ ] 2.1 `teleport(coords)` / `teleportToGanton` / `respawnPlayer` — reuse the bench
      `teleportPlayer` path (physics.teleport + Transform writes + streaming settle veil semantics).
- [ ] 2.2 `playerCoords()` — Transform read (native Z-up, same as prod).
- [ ] 2.3 `setGameTime(minutes)` — the host `hour` variable (drives env driver next frame).
- [ ] 2.4 `setWeather(index)` + `weatherList()` — `WeatherTransition.begin` (6 s blend) + shared
      timecyc weather names; mark active index.
- [ ] 2.5 `vehicleModels()` / `spawnVehicle(model)` / `flipVehicle()` — over `engine-vehicles`
      (worker model builds land async — spawn must await the type build like road cars do).
- [ ] 2.6 `breakNearest()` — over `engine-breakables` (B7·a shatter path; nearest search around the
      player).
- [ ] 2.7 `setFlyMode(on)` — binds to the Phase-5 photo camera (one implementation, two entries).
- [ ] 2.8 Camera screen: verify the 8 `camera.*` sliders reach the engine host's follow camera LIVE
      (it builds from the same config — confirm per-frame re-read, else wire).
- [ ] 2.9 ProcObj screen: verify `graphics.procobj[cat]` changes re-drive the memoized clutter
      scatter (render + colliders from ONE scatter — invalidate on config change or document
      reload-required).
- [ ] 2.10 Time/Weather/Position screens end-to-end sanity in the browser (headless DOM click-through
      where possible).

### Phase 3 — engine-host graphics wiring (bucket B verification)

- [ ] 3.1 Per-control smoke: `bloom.{enabled,intensity,threshold}` · `sun.godrays` · `sky.mood` ·
      `sky.pbrExposure` · `clouds.opacity` · `night.emissiveBoost` · `night.litFade.*` ·
      `night.skylight` · `moon.brightness` · `worldLight.{dayBrightness,nightPrelitBrightness}` ·
      `toneMapping` on/off · `vehicleReflection.{preset off,intensity}` · `fog.timecycScale` — each
      moved from the overlay must visibly change the frame (they already flow through the env driver).
- [ ] 3.2 Streaming screen decision: `streaming.lodDrawDistance` is boot-time on the engine
      (`?draw=`) — either add a LIVE ring-radius setter to `StreamingDriver` (re-ring + fog cap
      update) or gate the slider off with a "boot-only, use ?draw=" note. Decide with the user.
- [ ] 3.3 Perf screen: REPLACE the three `renderer.info` panel content with engine stats — frame
      avg/p95, draws, `gpuMs` pass/post/probe/submit, residency ledger by category, `lateCreates`,
      cells loaded/pending. Reuse the HUD's numbers (one source).

### Phase 4 — bucket C gating on the engine host (NOTHING deleted from prod)

- [ ] 4.1 Hide via capabilities: tone-mapping curve selector · pipeline switch · PBR-sky toggle ·
      Car-reflect presets (keep off/intensity) · SSAO · shadows/CSM · volumetric clouds · god-rays
      shader sliders · dynamicObjectsFill · skyGlow · windowGlow · corona distance · headlight
      sliders · water sliders · sun/rays size · stars/lamps toggles · effects distance · Show
      Normals/Faces · Map screen (inspector needs the plan-10 engine ray query — parked).
- [ ] 4.2 Each hidden row gets a one-line disposition note in this plan (retire at C2 / rethink in
      plan 17 / needs engine feature) — the user reviews the list before C2 deletes anything.

### Phase 5 — photo mode (prod parity: K+M)

- [ ] 5.1 Free-fly camera state in the engine host (position + yaw/pitch), seeded from the current
      follow camera on entry; exit resumes follow. Camera-only — the player entity is untouched.
- [ ] 5.2 Controls = prod semantics: ARROW keys move (the WASD player keeps walking independently —
      that is prod behaviour), mouse look (locked or drag); copy the prod fly-mode speed constants
      from `camera-controller.ts`.
- [ ] 5.3 K+M chord handler (copy prod's chord logic verbatim: `kDown`/`mDown`/`chordFired`
      debounce); F2 drops fly mode; pause drops fly mode.
- [ ] 5.4 HUD hint line gains the chord (`K+M = photo camera`).
- [ ] 5.5 Verify with the headless harness: chord on → camera detaches (screenshot moves, player
      HUD coords do not).

### Phase 6 — pointer capture button

- [ ] 6.1 Port the `sa-capture` "Click to play" button into `EngineCanvasHost` JSX: `locked` state
      from `pointerlockchange` (=== the host canvas), hidden while locked or paused; same
      `.sa-capture` styles.
- [ ] 6.2 Keep the existing canvas-click lock request (the button is the affordance, not the only
      path); Esc/pause exit-lock behaviour stays (already prod-parity).
- [ ] 6.3 Verify: headless DOM — button visible at boot, disappears on lock, returns on Esc.

### Phase 7 — close-out

- [ ] 7.1 The ritual in-game sweep (`?bench=all`) — the overlay must cost NOTHING while closed
      (prod rule: perf sampling only while the Perf screen is open).
- [ ] 7.2 Series row + this plan's ledger updated; bucket D (new engine knobs) stays a POST-FLIP
      batch the user picks from.
- [ ] 7.3 **Remind the user: display `?bench=all` + parity screenshots → THE FLIP.**

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
`graphics.vehicleReflection.{preset='off',intensity}` · `fog.timecycScale`.

### Bucket C — three-only concepts, HIDDEN on the engine host (deletion only at C2, per-row user review)

| Control (prod)                                      | Why it has no engine counterpart                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| Tone-mapping CURVE selector (aces/agx/neutral/none) | engine ships ONE prod-exact ACES + on/off                                  |
| Pipeline switch classic/modern                      | one pipeline; the switch IS what C2 deletes                                |
| PBR sky toggle classic/pbr                          | engine sky is always physical (`?sky=preetham` = dev A/B)                  |
| Car reflect presets enhanced/PC/PS2 ("chrome auto") | engine = skygfx-neo live probe; off/on + intensity remain                  |
| SSAO enabled/intensity/radius                       | replaced by the BAKED AO channel (runtime knob = `aoStrength`, bucket D)   |
| Sun shadows + CSM distance                          | no CSM; baked sun-vis (`sunVisStrength`); shadows redesign = 0.6.0/04      |
| Volumetric clouds toggle                            | no raymarcher; decks are the baked 256² field                              |
| God-rays shader sliders density/exposure/weight     | engine godrays = one pass, one strength                                    |
| Night dynamicObjectsFill strength/rim               | plan-034 three shader; engine lights peds/vehicles itself                  |
| Night skyGlow                                       | built into the engine sky model (city glow + moon scatter)                 |
| Night windowGlow                                    | superseded by the baked emissive mask + `emissiveBoost` (kept)             |
| Corona distance slider                              | engine restores AUTHORED 2dfx farClip (plan-17 tail); a cap fights data    |
| Headlight pool sliders                              | engine `dynamicLights` intensities are host constants (bucket-D candidate) |
| Water sliders (6)                                   | engine water = own shader (sea/inland, baked shore); no 1:1 mapping        |
| Sun size / rays size                                | `sunSize` comes from timecyc through the driver                            |
| Show Normals / Show Faces                           | three material overrides; engine needs a debug shader variant (wishlist)   |
| Perf panel content                                  | REPLACED with engine stats (Phase 3.3)                                     |
| Map inspector (manual cells, pick, hide/restore)    | needs the plan-10 engine ray query — PARKED                                |
| Night stars toggle                                  | starfield is part of the sky model, no flag                                |
| Night lights (lamps) toggle                         | static lamp pool REMOVED 2026-07-17; restarts in plan 17                   |
| Effects distance (2dfx particles)                   | knob not wired; decide with the plan-17 round                              |

### Bucket D — NEW engine-only knobs (POST-FLIP batch, user picks)

`renderScale` (THE tier knob — config exists, prod never had UI) · draw distance (`?draw`) ·
`aoStrength` · `sunVisStrength` · `windStrength` · `stochastic` (unstable v1) · `skyModel` A/B ·
`godrayStrength` · `fogHeightK`/`fogHeightMin` · probe on/off + `probeView` · `reflectionStrength`
raw · `moonPhase` · `bloomThreshold` night profile · dynamic light/corona intensities · bench/soak
launchers · wishlist: normals/wireframe debug pipeline, engine map inspector (needs ray query).

## Ledger

| Date       | What                                                                                       | Notes                                                                             |
| ---------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 2026-07-17 | Audit (3 explore passes: prod overlay · engine host+Environment · lab)                     | Headline: no debug tools mounted on the engine host at all. Buckets frozen above. |
| 2026-07-17 | Scope raised to BLOCKER + photo mode (K+M) + capture button; plan renamed `22-debug-tools` | User: after this ships → display `?bench=all` + screenshots → FLIP.               |
