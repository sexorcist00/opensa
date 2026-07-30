# URL query parameters — the canonical reference

Every query parameter the browser apps read, where it is read, and what it does. Written during
[074/13 phase 2](../plans/074-opensa-engine/13-cleanup.md) after the three-WebGL renderer was deleted:
the 073 debug-flag zoo grew to ~60 undocumented inline `URLSearchParams` reads, and **this file exists so
it cannot regrow unnoticed**. Add a parameter, add a row — a knob that is not here is not supported.

Verified against the code 2026-07-18; `loader`/`src` updated 2026-07-21 (plan 079). The browser apps read
parameters in `engine-canvas-host.tsx`, the engine-lab `main.ts`, the viewers, and `use-asset-boot.ts`/the
boot machine (`loader`).

## Game host — `apps/web` (`/`, the shipping app)

Read in `src/ui/engine-canvas-host.tsx` unless noted.

| Param       | Default                | Values                         | What it does                                                                                                                                                    |
| ----------- | ---------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loader`    | per-game               | `http-dir`                     | Dev override (079): run the full game against a served build (with `src`); read in `use-asset-boot.ts`                                                          |
| `src`       | `pak-map`              | pak base URL / served game dir | The world pak base — the loading MODE selects it (079): folder mode reads `opensa/` from the picked folder; `?loader=http-dir&src=<url>` reads the served build |
| `spawn`     | the game's spawn point | `x,y,z` (GTA coords)           | Player spawn override                                                                                                                                           |
| `hour`      | `22` (night)           | `0`–`24`; **`0` is honoured**  | Time of day                                                                                                                                                     |
| `weather`   | `0`                    | timecyc weather row            | Starting weather (remapped regionally at spawn)                                                                                                                 |
| `draw`      | `1200`                 | number, floored at `400`       | LOD ring radius; the fog cap follows it (074/21)                                                                                                                |
| `scale`     | config `renderScale`   | e.g. `0.75`                    | Render scale — **the one perf tier knob**                                                                                                                       |
| `aces`      | on                     | `0` = off                      | ACES tonemapping A/B                                                                                                                                            |
| `bloom`     | config                 | `0` = off, `>0` = intensity    | Bloom A/B                                                                                                                                                       |
| `probe`     | on                     | `0` = off                      | Env-probe reflections off → analytic fallback                                                                                                                   |
| `probeview` | off                    | `1` = on                       | Draw the probe cube as a panorama instead of the frame                                                                                                          |
| `sky`       | analytic               | `preetham`                     | Sky model switch                                                                                                                                                |
| `clouds`    | config                 | number                         | Cloud opacity                                                                                                                                                   |
| `bench`     | off                    | `all` or one scene key         | Bench sweep; emits the `[bench]` JSON protocol                                                                                                                  |
| `soak`      | off                    | minutes                        | Soak stability run; emits `[soak]`                                                                                                                              |
| `benchcar`  | mixed models           | vehicle model name             | Pin every bench road car to one model                                                                                                                           |
| `phys`      | off                    | `all` or one scene key         | Scripted physics lap (081/01); emits the `[phys]` JSON protocol                                                                                                 |
| `car`       | `infernus` / `admiral` | vehicle model name             | Which car the `phys` laps drive — and which car a `video` scene spawns (default `admiral` there)                                                                |
| `video`     | off                    | `1` = on, `0` = off            | Video mode (096/02): endless seeded showcase drives; emits the `[video]` JSON protocol                                                                          |
| `from`      | `10`                   | real seconds                   | Shortest fragment a `video` scene plays for                                                                                                                     |
| `to`        | `25`                   | real seconds                   | Longest fragment; each scene draws its length from `[from, to]` (clamped up to `from`)                                                                          |
| `seed`      | derived from the clock | integer                        | Determinises a `video` run's routes, car, hour and weather (D9). The ACTIVE seed is always printed as `[video] seed=…`, so a derived one is still replayable    |
| `gripVd`    | `12`                   | m/s                            | 081/09 lateral speed-grip assist: boost reference speed (`boost = min(1 + (v/gripVd)², gripCap)`)                                                               |
| `gripCap`   | `3`                    | ×                              | 081/09 assist ceiling; both dials are session overrides, shown in F2 and recorded by every `[phys]` capture                                                     |
| `airCtl`    | `1`                    | ×                              | 081/06 §1 in-air attitude control at the original's strength (`0.0007 × min(1, 3000/turnMass)` per frame = 1.75 rad/s² per unit of stick). `0` turns it off — the A/B for a jump; every `[phys]` capture records the active value |
| `surfGrip`  | on                     | `0` = off                      | 081/10: grip (and the steering limiter) read the SURFACE under each wheel — `surface.dat`'s rubber row: tarmac 4.5, grass 3.2, sand 3.0, wet 2.8. `0` puts every wheel back on tarmac; every `[phys]` capture records which it ran |

`bench` / `soak` / `benchcar` are read in `src/ui/engine-perf-runs.ts`. Scene keys live in
`src/bench-scenes.ts`: `ls-noon` · `sf-fog-dawn` · `lv-night` · `country-dusk` · `ocean-horizon` ·
`ls-rain-night`.

`phys` / `car` are read in `src/ui/engine-phys-runs.ts` (full guide: [physics-laps.md](physics-laps.md));
the scenes live in `src/phys-scenes.ts`:
`brake-strip` · `step-steer` · `slalom` · `u-turn` · `kerb-strike` · `crest-jump` · `handbrake-turn` ·
`pull-away-reverse`. A lap teleports next to a real road spot, spawns the car, seats the player, then plays
a keyframe timeline through the SAME `InputState` the player uses.

`video` / `from` / `to` / `seed` are read in `src/ui/engine-video-runs.ts`. A scene picks a route out of the
game's own `NODES*.DAT` graph, stages a car on it behind a black overlay the module owns, and hands the wheel
to the autopilot (`packages/game/src/vehicle/path-follow.ts`) — the chase camera and the UI hide are the
shipped ones. A game with no `data/paths/nodes*.dat` (the total conversions) says so and does nothing.

> **These are HARNESS CONTRACTS.** `tools-debug/bench-harness/drive.js` scrapes the console
> protocol (`[bench]` / `[soak]` / `[phys]` / `[video]` with `TAG=`, plus `sweep complete`) and the URLs in
> [benchmarks.md](benchmarks.md) use these names. Renaming one silently breaks the perf ritual.

## Engine lab — `apps/engine-lab`

The proving ground ([engine-lab.md](engine-lab.md)); read in `src/main.ts`. Renderer knobs mirror the
game host (`scale`, `aces`, `bloom`, `probe`, `probeview`, `sky`, `clouds`, `hour`, `weather`, `draw`,
`src`) with the scene-setup additions below.

| Param       | Default          | Values                            | What it does                                                                                         |
| ----------- | ---------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pak`       | off              | `1`                               | Stream the converted district (worker pak + LOD rings) instead of synthetic — the one pak path (079) |
| `cells`     | `8`              | number                            | Synthetic grid side                                                                                  |
| `boxes`     | `12`             | number                            | Boxes per synthetic grid side                                                                        |
| `at`        | pak centre       | `x,y,z`                           | Orbit focus override                                                                                 |
| `orbit`     | fitted           | number                            | Starting camera distance                                                                             |
| `az` / `el` | `0` / `0.9`      | number                            | Starting orbit azimuth (deg) / height factor                                                         |
| `ped`       | off              | `1`                               | Spawn a ped                                                                                          |
| `pedy`      | focus Y          | number                            | Ped/vehicle Y placement                                                                              |
| `vehicle`   | `0`              | count                             | How many vehicles to spawn                                                                           |
| `vmodel`    | `vehicle`        | model base name                   | Which vehicle model                                                                                  |
| `drive`     | off              | `1`                               | Drivable vehicle mode                                                                                |
| `freeze`    | off              | `1`                               | Freeze animation                                                                                     |
| `daycycle`  | off              | `1`                               | Animate the day cycle                                                                                |
| `fogscale`  | `2.5`            | number                            | Fog timecyc scale                                                                                    |
| `ao`        | config           | number                            | Baked AO strength                                                                                    |
| `sunvis`    | config           | number                            | Baked sun-visibility strength                                                                        |
| `wind`      | config           | number                            | Wind strength                                                                                        |
| `stoch`     | config (**off**) | number                            | Stochastic de-tiling — default-OFF, unstable (074/12)                                                |
| `bench`     | off              | `city`\|`close`\|`orbit`\|`drive` | Lab camera bench script (`src/bench.ts`)                                                             |
| `test`      | off              | `leak`                            | Leak test mode (requires streaming)                                                                  |

## Standalone engine page — `apps/web/src/standalone/opensa-engine.ts`

The minimal boot kept as a repro harness (074/13 phase 3.4): `src` (default `pak-ls`), `hour`
(default `12`), `scale`, `aces`, `bloom`.

## Asset viewers — `apps/viewer`

| Param | Default  | Values                                            | What it does         |
| ----- | -------- | ------------------------------------------------- | -------------------- |
| `tab` | `object` | `object` \| `vehicle` \| `character` \| `compare` | Which viewer to show |

> `tab` is an **e2e contract** — `e2e/viewer-tabs.spec.ts` navigates by it.

## Map viewer — `apps/sa-map-viewer` (`/sa-map-viewer.html`, plan 094)

| Param   | Default             | Values                | What it does                                                     |
| ------- | ------------------- | --------------------- | ---------------------------------------------------------------- |
| `src`   | —                   | served game-dir URL   | Load that dir (no picker). Absent ⇒ the folder picker screen      |
| `at`    | the map's centre    | GTA `x,y`             | Ground point under the view; names the cell that renders          |
| `h`     | `400`               | engine units          | Eye height above that point                                      |
| `pitch` | `-89.4`             | degrees, negative     | Down-tilt; clamped to `[-89.4, -3.4]`                            |
| `yaw`   | `180`               | degrees               | `180` is the map's usual orientation (north up); `0` flips it     |
| `panel` | shown               | `0`                   | Capture mode: hide the panel, keep the source caption            |
| `cells` | `1` (capture mode)  | `1` \| `all`          | What `panel=0` pins: the cell under `at`, or the whole map        |
| `lod`   | HD                  | `1`                   | Capture mode: pin the LOD layer instead of HD                     |
| `wind`  | `0` (frozen)        | number                | Vegetation sway. OFF by default — it is the only thing that moves |
| `fog`   | off (far plane)     | `1`                   | Restore the game's noon fog (its cut CULLS distant cells)         |
| `water` | on (`0` in capture) | `0` \| `1`            | Draw the sea. `map-viewer-shot.ts` sets `0` — the waves animate   |

> `at`/`h`/`pitch`/`yaw` fully specify the pose and **the camera never moves on its own**: the same URL is
> the same pixels (verified byte-identical across runs). `wind` defaults to 0 for exactly that reason, and
> `map-viewer-shot.ts` adds `water=0` for the same one — interactively the sea is ON, a scripted shot leaves
> it out unless you pass `water=1`.
>
> `cells`/`lod` exist because the panel's inspector OWNS the cell set: with `panel=0` there is no inspector,
> so the host seeds the set itself.

## Two known inconsistencies

Documented rather than silently fixed; both are load-bearing for existing bookmarks and bench URLs:

- **`src` defaults differ per host** — `pak-map` (game), `pak-ls` (standalone), `pak` (lab); since 079 the lab
  points `src` at a served game dir (e.g. `http://localhost:3001/build/original/opensa`), and `?loader=http-dir`
  makes the game do the same.
- **`hour=0` means midnight only in the game host.** The standalone page and the lab read it as
  `Number(...) || 12`, so `0` falls back to noon.

## Retired parameters

Deleted with the three-WebGL renderer in [074/13](../plans/074-opensa-engine/13-cleanup.md) and read
**nowhere** as of 2026-07-18. Listed so an old bookmark or plan doc can be recognised, not revived:

- **The 073 debug zoo** (phase 5, with the render path): `webgpu`, `engine`, `aa`, `dpr`, `bundle`,
  `bundledebug`, `texfree`, `mesh1`, `warm`, `appear`, `cellcull`, `fog`, `nocull`, `shadowdebug`,
  `mat04`, `matcache`, `pool`. This is the disposition the
  [073 chain](../plans/073-webgpu-migration-threejs/readme.md) deferred to "when the own-framework work
  starts" — the answer was **delete**.
- **Spike params** (phase 3, with the spike pages): `count`, `mode`, `swap`, `dn`, `pipeline`,
  `snapshot`, `rot`, `fix`, `precompile`, `ctx`, `variant`.
- **Never implemented or field-removed** — these were documented but never read: `msaa` and `bloomq`
  (field-tested and removed: WebGPU allows `sampleCount` 1 or 4 only, and A2C needs 4), `ssr` and
  `carshadow` (the plan-16 features were built and rolled back), `panorama` and `cloudcover` (the
  painted panorama was retired by the sky v2 arc), `lighting`, `path`, `speed`.

## Why there is still no `flags.ts`

Phase 2.4 asked whether the survivors should move behind one typed reader. They should not — yet. The
count fell from ~60 to **26 distinct names** (096/02 added four at once — `video`, `from`, `to`, `seed`), most of them read exactly once, and the two hosts read
overlapping-but-differently-defaulted sets (see the inconsistencies above), so a shared reader would
have to model the difference rather than remove it. The zoo grew because nothing was written down, not
because reads were inline. **This document is the fix; revisit a reader if the count climbs again.**
