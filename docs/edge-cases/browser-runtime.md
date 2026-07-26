# Browser & platform edge cases

- **The local (folder) loader is Chromium-only** — File System Access API; `fetch` stays the default
  elsewhere. Opt-in per game (`assetLoader: 'local'`).
- **The native folder picker cannot be automated.** Playwright can't drive the FSA dialog — e2e uses an
  in-page fake FSA tree; real folder flows need a human. Headless _field checks_ are still possible: the
  bench harness boots the real game through `?loader=http-dir&src=<served build>` (no picker on that path).
- **Cache Storage needs a secure context.** Over plain `http://` (e.g. a phone on a LAN IP) `caches` is
  undefined and every cache op silently no-ops — assets re-download each visit, nothing breaks.
- **Visual regression renders on Chromium's software backend** (for determinism), not real GPU — it cannot
  judge WebGPU-specific defects.
- **The shell e2e needs built `static/games/original-*` archives** — it only runs where those exist (not on
  GitHub-hosted CI).
- **User activation is fragile.** The folder prompt must be the **first** await in the Play-click handler
  (an IndexedDB read before it loses the gesture); `requestPointerLock` may only be called once per gesture
  (a second call silently breaks selection — the map-viewer dead-select bug).
- **The install-source loaders ingest a SUBSET of `gta3.img`** (`selectInstallEntries`: IPL-placed models +
  every ped/vehicle + procobj clutter + loose/world). A feature that builds geometry live from a DFF chosen
  by any OTHER data file must add its model+txd refs to `build-vfs.ts` (the `procObjModelRefs` pattern) — or
  the model is silently absent in the browser (`getClump` returns empty, nothing renders) while offline Node
  probes, which read the whole archive, work fine.

## Rapier's raycast vehicle: three asymmetries to design around (2026-07-26, plan 081)

`DynamicRayCastVehicleController` is Bullet-lineage, and three of its properties are load-bearing for anyone
touching driving. All three are worked around in `PhysicsWorld.setVehicleControls`; none is a bug to file.

- **Its friction clamp is skipped in a straight line.** `update_friction` computes the limit
  `μ × suspensionForce × dt` and a `skid_info` factor, then applies it only `if wheel.side_impulse != 0.0`.
  A car accelerating or braking dead ahead therefore has NO longitudinal grip limit and will put any force it
  is handed into the road (measured: 5 g launches). The clamp has to be applied by the caller.
- **Its friction circle weighs the two axes unevenly**: `fwd_factor = 0.5`, `side_factor = 1.0`. A wheel
  braking at its full grip has spent only half of its circle and keeps up to **87 %** of its lateral
  capacity — so locking a wheel's brakes does not unstick it. Cutting `side_friction_stiffness` is the only
  way to express "this tyre is skidding".
- **It exposes no skid state.** `skid_info` is internal; sliding has to be inferred from
  `wheelForwardImpulse` / `wheelSideImpulse` against the wheel's own friction circle.
