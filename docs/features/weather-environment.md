# Weather + environment (sky, water, fog)

`packages/engine/src/render/sky-lut.ts` + `hosek-wilkie.ts` (sky/fog inside the engine's frame),
`packages/game/src/adapters/engine-environment-driver.ts` (timecyc → engine environment),
`packages/game/src/plugins/cloud-profile.ts`, `packages/game/src/weather/`,
`packages/renderware/src/parsers/text/timecyc*` + `water.parser.ts`,
`packages/renderware/src/map/ocean-frame.ts`, plans 014/024/028/029/031 and 074/06+21.

## Implemented

- **timecyc**: vanilla 8-keyframe parsing + 24h conversion, or a shipped `timecyc_24h.dat`
  used as-is; per-weather per-hour colours (sky top/bottom, ambient, sun, fog…), blended
  sampling (`sampleTimecycBlend`). Colours are 0–255 **sRGB** — uniforms decode with
  colour management (managed=true) or the night sky washes grey.
- **Weather manager**: per-city weather sets (`weatherForCity`), region-crossing keeps the
  current weather but follows the new region's set; smooth transitions
  (`weatherTransitionSeconds`); debug Weather screen (rain/storm excluded by design).
- **Sky**: a Hosek-Wilkie radiance LUT built on the CPU and shared by sky AND fog
  (`engine/src/render/sky-lut.ts` + `hosek-wilkie.ts`), sun disc + god-rays source, procedural cumulus
  baked to a 256² field, stars, moon; the night factor feeds every consumer. (Until 074/13 this was a
  three `sky.plugin.ts` gradient dome — the sky v2 arc replaced the model, not just the renderer.)
- **Water**: `water.dat` quads + infinite ocean ring at sea level, classified SEA vs INLAND (plan 075);
  reflection, sun glint and darkness knobs in the engine's water shading; shoreline handled by the quads'
  alpha. Fog is applied in the same shader so the far ocean dissolves into the horizon like terrain.
- **Fog**: distance fog blended into the sky horizon colour from the same LUT, driven by timecyc
  (`engine-environment-driver.ts`). Since plan 074/21 fog is a strict SUBSET of the LOD ring — the cap
  follows `?draw=` so the cull edge can never be exposed — and clouds composite into the fog colour at
  the dissolve band. The WebGL-era Map-screen slider went with that renderer.

## Known gaps / candidates

- Rain/storm/sandstorm weathers intentionally not selectable (no precipitation effects yet).
- Underwater rendering state (timecyc has it; we don't switch).
- Water is visual-only (no swimming physics/buoyancy).

## Test coverage anchors

`timecyc` parser/convert/sample tests, `weather-zones` tests, `build-water` tests.
