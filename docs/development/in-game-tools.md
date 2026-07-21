# In-game tools (debugger + dev viewers)

Developer tooling that ships with the build but stays out of the normal play path.

## In-game debugger

Press **F2** in the game for the debug menu. A small grey line at the top shows the loaded build's
**`buildTime`** (`HH:MM DD-MM-YYYY`, stamped by opensa-pack into the opensa manifest, plan 079) so it is
always clear which build is running. Opening the menu alone changes nothing in the world — it's a
multi-level menu:

- **Player** — **Fly Mode** (first, separated): toggle on and the player floats and flies at **2× speed** —
  **WASD** horizontal (camera-relative), **Space** up, **Ctrl** down (run animation, no gravity/collision).
  Turning it **off** — or closing the debugger — drops the player onto the ground directly beneath them. (This
  moves the **player**, unlike the K+M screenshot camera below, which moves only the camera.) Then Respawn
  (unstick on the spot), To Ganton.
- **Vehicles** — spawn Admiral/Camper in front of you; Flip the car you're in (wheels ↔ roof).
- **Game** — Show / Copy current coords.
- **Map** — Activate **Map Viewer**: the camera lifts overhead and detaches — **right-drag orbits,
  left-drag pans, the wheel dollies**, and a left **click** (under a small travel threshold, so panning
  never selects) picks the object under the **cursor**. Render chosen map sections (HD/LOD); toggle
  **Show Collision / Show Normals**. Fog is forced OFF while the viewer is open, so a
  district reads cleanly from 400 u up. A picked object can be **hidden** (Hide object) to peek behind it — hides
  are debug-only and everything is restored on Restore all / leaving the map viewer / closing the debugger.
  Leaving the screen, closing (×), or pressing F2 exits it cleanly.
- Plus live tuning of atmosphere/graphics/camera/weather/procobj/time (dev builds).

**Screenshot camera** — press **K+M** to toggle a free-fly camera: it detaches from the player/car and
flies with the **arrow keys** + **mouse** look. It only moves the camera (rendering and the rest of the
game are untouched). Opening the debugger (F2) leaves fly mode.

Diagnostics logging is off by default; set `showLogs` in the `canvas-host.tsx` config to
`'debug' | 'log' | 'warn' | 'error'` to stream gated, typed `log` events to the console.

## Development viewers

Standalone debug pages, isolated from the game/streaming layers — each reuses the **real** build path, so
what you see is what the game produces. Each is its own Vite HTML entry (`npm run dev`, then open the URL).

Models are loaded on demand from the **compare server** (`--after` side) via an autocomplete box — run it
alongside the app: `npx tsx tools/map-optimizer/src/compare-serve.ts --before <dir> --after <dir>`.

- **`/viewer.html`** (object) — map models by name; adding an HD also lists its generated `lod<name>`.
  Toggles for prelit vertex colours, MODULATE2X, the lit/unlit material, collision, and **wireframe**.
- **`/viewer.html?tab=vehicle`** — a car by name (autocomplete from `vehicles.ide`). Pick a body part
  (highlighted, clamped to the COL bounds), open/close its door (button or `E`), swap it to its damaged mesh,
  and toggle collision, the low-detail `chassis_vlo` LOD, and **wireframe**.
- **`/viewer.html?tab=character`** — a ped by name (autocomplete from `peds.ide`). Play any `ped.ifp`
  animation (looped), and toggle the skeleton, the collision capsule, and **wireframe**.

The object-viewer's e2e (only) renders static fixtures from `tests/viewer/` (served at `/viewer` by
`serve-static`, gitignored, extracted from `game-src/non-modified` by `npm run test:fixtures`).

See [docs/plans/022-debug-viewers.md](../plans/022-debug-viewers.md) for the original design, and
[scripts.md](./scripts.md) for the offline debug scripts under `scripts/debug/`.
