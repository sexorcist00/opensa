# URL query parameters — the canonical reference

Every query parameter the browser apps read, where it is read, and what it does. Written during
[074/13 phase 2](../plans/074-opensa-engine/13-cleanup.md) after the three-WebGL renderer was deleted:
the 073 debug-flag zoo grew to ~60 undocumented inline `URLSearchParams` reads, and **this file exists so
it cannot regrow unnoticed**. Add a parameter, add a row — a knob that is not here is not supported.

Verified against the code 2026-07-18. Only four browser files read parameters at all.

## Game host — `apps/web` (`/`, the shipping app)

Read in `src/ui/engine-canvas-host.tsx` unless noted.

| Param       | Default                | Values                        | What it does                                           |
| ----------- | ---------------------- | ----------------------------- | ------------------------------------------------------ |
| `src`       | `pak-map`              | pak directory name            | Which converted pak the streaming driver loads         |
| `spawn`     | the game's spawn point | `x,y,z` (GTA coords)          | Player spawn override                                  |
| `hour`      | `22` (night)           | `0`–`24`; **`0` is honoured** | Time of day                                            |
| `weather`   | `0`                    | timecyc weather row           | Starting weather (remapped regionally at spawn)        |
| `draw`      | `1200`                 | number, floored at `400`      | LOD ring radius; the fog cap follows it (074/21)       |
| `scale`     | config `renderScale`   | e.g. `0.75`                   | Render scale — **the one perf tier knob**              |
| `aces`      | on                     | `0` = off                     | ACES tonemapping A/B                                   |
| `bloom`     | config                 | `0` = off, `>0` = intensity   | Bloom A/B                                              |
| `probe`     | on                     | `0` = off                     | Env-probe reflections off → analytic fallback          |
| `probeview` | off                    | `1` = on                      | Draw the probe cube as a panorama instead of the frame |
| `sky`       | analytic               | `preetham`                    | Sky model switch                                       |
| `clouds`    | config                 | number                        | Cloud opacity                                          |
| `bench`     | off                    | `all` or one scene key        | Bench sweep; emits the `[bench]` JSON protocol         |
| `soak`      | off                    | minutes                       | Soak stability run; emits `[soak]`                     |
| `benchcar`  | mixed models           | vehicle model name            | Pin every bench road car to one model                  |

`bench` / `soak` / `benchcar` are read in `src/ui/engine-perf-runs.ts`. Scene keys live in
`src/bench-scenes.ts`: `ls-noon` · `sf-fog-dawn` · `lv-night` · `country-dusk` · `ocean-horizon` ·
`ls-rain-night`.

> **These three are HARNESS CONTRACTS.** `tools-debug/bench-harness/drive.js` scrapes the console
> protocol (`[bench]` / `[soak]` / `sweep complete`) and the URLs in
> [benchmarks.md](benchmarks.md) use these names. Renaming one silently breaks the perf ritual.

## Engine lab — `apps/engine-lab`

The proving ground ([engine-lab.md](engine-lab.md)); read in `src/main.ts`. Renderer knobs mirror the
game host (`scale`, `aces`, `bloom`, `probe`, `probeview`, `sky`, `clouds`, `hour`, `weather`, `draw`,
`src`) with the scene-setup additions below.

| Param       | Default          | Values                            | What it does                                          |
| ----------- | ---------------- | --------------------------------- | ----------------------------------------------------- |
| `pak`       | off              | `1`                               | Load geometry from a pak instead of synthetic         |
| `stream`    | off              | `1` (needs `pak=1`)               | Streaming mode                                        |
| `cells`     | `8`              | number                            | Synthetic grid side                                   |
| `boxes`     | `12`             | number                            | Boxes per synthetic grid side                         |
| `at`        | pak centre       | `x,y,z`                           | Orbit focus override                                  |
| `orbit`     | fitted           | number                            | Starting camera distance                              |
| `az` / `el` | `0` / `0.9`      | number                            | Starting orbit azimuth (deg) / height factor          |
| `ped`       | off              | `1`                               | Spawn a ped                                           |
| `pedy`      | focus Y          | number                            | Ped/vehicle Y placement                               |
| `vehicle`   | `0`              | count                             | How many vehicles to spawn                            |
| `vmodel`    | `vehicle`        | model base name                   | Which vehicle model                                   |
| `drive`     | off              | `1`                               | Drivable vehicle mode                                 |
| `freeze`    | off              | `1`                               | Freeze animation                                      |
| `daycycle`  | off              | `1`                               | Animate the day cycle                                 |
| `fogscale`  | `2.5`            | number                            | Fog timecyc scale                                     |
| `ao`        | config           | number                            | Baked AO strength                                     |
| `sunvis`    | config           | number                            | Baked sun-visibility strength                         |
| `wind`      | config           | number                            | Wind strength                                         |
| `stoch`     | config (**off**) | number                            | Stochastic de-tiling — default-OFF, unstable (074/12) |
| `bench`     | off              | `city`\|`close`\|`orbit`\|`drive` | Lab camera bench script (`src/bench.ts`)              |
| `test`      | off              | `leak`                            | Leak test mode (requires streaming)                   |

## Standalone engine page — `apps/web/src/standalone/opensa-engine.ts`

The minimal boot kept as a repro harness (074/13 phase 3.4): `src` (default `pak-ls`), `hour`
(default `12`), `scale`, `aces`, `bloom`.

## Asset viewers — `apps/viewer`

| Param | Default  | Values                                            | What it does         |
| ----- | -------- | ------------------------------------------------- | -------------------- |
| `tab` | `object` | `object` \| `vehicle` \| `character` \| `compare` | Which viewer to show |

> `tab` is an **e2e contract** — `e2e/viewer-tabs.spec.ts` navigates by it.

## Two known inconsistencies

Documented rather than silently fixed; both are load-bearing for existing bookmarks and bench URLs:

- **`src` defaults differ per host** — `pak-map` (game), `pak-ls` (standalone), `pak` (lab).
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
count fell from ~60 to **22 distinct names**, most of them read exactly once, and the two hosts read
overlapping-but-differently-defaulted sets (see the inconsistencies above), so a shared reader would
have to model the difference rather than remove it. The zoo grew because nothing was written down, not
because reads were inline. **This document is the fix; revisit a reader if the count climbs again.**
