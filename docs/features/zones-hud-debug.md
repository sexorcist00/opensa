# Zones, HUD, debug tooling

`packages/game/src/zones/`, `apps/web/src/ui/hud/`, `apps/web/src/ui/debug/`, plans 022/023/027/035.

## Implemented

**Zones**

- `map.zon` level boxes → city classification (LA/SF/VEGAS/COUNTRYSIDE/DESERT) driving the
  per-city weather sets; desert detection by named `info.zon` zones.
- `info.zon` named zones + GXT lookup (CRC-32 hash WITHOUT the final inversion — not Jenkins)
  → district display names.

**HUD** (DOM overlay, immune to post-processing)

- Clock and zone-name widgets with configurable font/outline (`Config.hud`), SA-style fonts
  loaded via `loadFonts`; zone name fades on change.

**Debugger (F2)** — multi-level menu; opening it never touches the simulation:

- Player (**Fly Mode** — float/fly at 2× speed, Space up / Ctrl down, drops to the ground beneath on
  off/close — then respawn, coords), Vehicles (spawn any car from `vehicles.ide` — sorted, with a name filter),
  Time (presets + speed),
  Atmosphere (night/world-light calibration sliders), Camera (follow rig), Graphics (bloom,
  tonemapping, reflections, water, sun/god-rays, clouds, stars, fog), **ProcObj**
  (per-category clutter knobs), Weather selector, Position (live coords + teleports incl.
  Truth's Farm), Map (map-viewer mode with manual cell selection, collision overlay,
  click-to-describe picking, **Show Normals**).
  **On the own-engine host the overlay is capability-gated** (`ENGINE_DEBUG_CAPABILITIES`, plan
  074/22): rows the engine has no equivalent for are HIDDEN rather than left dead — SSAO (replaced by
  the baked AO channel), the CSM/shadow and pipeline-switch rows, and the whole **Map screen**, which
  needs an engine ray query and is parked. **Every Map-screen bullet below therefore describes the
  WebGL-era overlay** — picking, hiding, Show Normals and the draw-distance sliders alike, and the
  `game.*` calls they name went with that renderer. The engine's live equivalent of the draw-distance
  slider is `?draw=` ([query-parameters.md](../development/query-parameters.md)).
- **Show Normals** (Map screen): scene-wide `MeshNormalMaterial` override (`game.setShowNormals`),
  drawn straight to the screen bypassing post-FX so the normals read clean. Auto-resets when leaving
  the screen / closing the panel (`resetTo`) or entering the map viewer.
- **Draw-distance controls** (Map screen): live sliders for the streaming **Draw Distance** (LOD
  ring) + **HD Distance** + **Fog** (`game.setStreaming` / `setFogDistance`; systems read config live
  so they apply next frame). Fog moved here from Atmosphere and **coupled** to the LOD ring — the
  Draw Distance slider sets `fog ≈ lod × 0.8` (FogExp2 saturates at ~1.25× its distance) so the LOD
  cull edge is always hidden; the Fog slider can only pull fog closer (thicker), never expose the edge.
- Picking (WebGL-era; parked on the engine pending a ray query): instanced map objects, procobj
  clutter and road-sign text meshes each reported their host model.
- **Hide object** (Map screen, on a picked model, WebGL-era — the implementation was deleted with that
  renderer; the engine's equivalent primitive is `CellStore.breakPlacement`, which degenerates a
  placement's triangles in the cell index buffer): collapsed the picked instance so you could peek behind it;
  a hidden counter + **Restore all** appear, and every hide is restored automatically on map-viewer exit /
  debugger close (`setMapViewer(false)` calls `restoreAll` — hides can't leak into gameplay). Transient by
  design: a rebuilt cell brings the instance back.
- Debug URL params: `?nocull=1`, `?shadowdebug=1`.

## Known gaps / candidates

- HUD: no minimap/radar, no money/health (out of scope so far).
- Zone names cover exterior districts only.

## Test coverage anchors

zone tests (`city`, `zone-name`, `city-zone` systems), GXT hash tests, debug overlay is mostly
manual (UI), picking covered via adapter `describe` tests, hide-object via `hidden-instances` tests
(collapse/restore, idempotent re-hide, multiple meshes).
