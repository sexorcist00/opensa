# 066 — Modern asset step in perfect-map-builder

Part of the [rendering overhaul chain](062-rendering-overhaul.md). Starts after [065](065-cascaded-shadows.md) proves the runtime (so we bake what's actually needed, not what's imagined). Upgrades [064](064-hybrid-world-lighting.md)'s quality and feeds [071](071-night-emissive-atmosphere.md). We are no longer bound to DFF/TXD for the opensa target — this plan uses that freedom.

## Context

- pmb's `opensa` target still emits **DFF/TXD/IMG** (one baked DFF per grid cell into `models/lods.img`, `opensa-lod-generator/finalize.ts`) — parsed at runtime by our own parser (worker-offloaded, plan 060). map-optimizer already computes welded vertices, smooth-group normals, seam-welded prelit, compacted buffers.
- 002 ships with a GLOBAL indirect/direct split — its known flaw is double-counting baked sun in prelit. Per-vertex baked data fixes that, and only the map build can produce it.

## Decisions

1. **Additive pipeline stage, additive format.** A new optional pmb step for the opensa target emitting an **opensa-native cell format** beside (not instead of) DFF/TXD; the runtime loads native cells when present, falls back to DFF/TXD otherwise. No flag-day migration.
2. **Format**: lean custom binary per cell (we already own writers/readers and a VFS; glTF adds container overhead we don't need). Contents per cell:
   - meshopt-compressed vertex/index buffers (positions, UV, normals, prelit day+night, new channels) → three `MeshoptDecoder` path, decode in the existing worker;
   - texture atlas/dictionary as **KTX2 (Basis UASTC/ETC1S)** — GPU-compressed at last (TXD DXT is re-encoded today; KTX2 halves VRAM vs RGBA uploads and kills decode cost), loaded via `KTX2Loader`;
   - a small JSON-ish header (bounds, material table, flags).
3. **New baked per-vertex channels** (the actual point of the plan):
   - **sunVis** (1 byte): sky-occlusion-aware sun visibility averaged over the sun arc — modulates 002's `uDirectScale` per vertex; kills double-counted sun in Rockstar-baked shadow areas;
   - **skyVis / AO** (1 byte): hemispheric visibility — grounds SSAO, darkens under-bridge/alley indirect properly;
   - **emissiveMask** (1 byte): derived from night-vertex delta (night ≫ day = lit window/neon) — feeds 009's glow instead of runtime heuristics.
     Baking uses the existing offline raytrace-ish machinery (occluder/visibility code exists in the LOD generator harness) over the welded cell geometry.
4. **Scope guard**: NO new material system, no normal maps, no PBR texture authoring — channels + compression only. Anything more is a later chain.
5. **Determinism + budget guard**: the step is deterministic (fixed seeds) and reports per-cell byte sizes; pmb fails loudly if the native output exceeds a configured total (same spirit as `checkImgIdBudgets`).

## Tasks

- [ ] Format spec (versioned header) + writer in a new pmb step + reader in the game adapter (worker path, transferables like the DFF worker). Round-trip unit tests.
- [ ] meshopt encode/decode integration; measure decode time vs current DFF parse on the same cells.
- [ ] KTX2 encode step (basisu at build time) + `KTX2Loader` runtime path; linear-space audit (our linear pipeline memory applies — encode targets linear, no double-conversion).
- [ ] sunVis/skyVis baker over welded cell geometry (sun arc sampling; reuse LOD-generator occlusion helpers); emissiveMask derivation from night/day prelit delta.
- [ ] Runtime: world material consumes sunVis (`uDirectScale × sunVis`) and skyVis (indirect modulation) when attributes exist — graceful without them.
- [ ] pmb wiring: new stage flag (`--until` compatible), size budget guard, docs in pmb readme.
- [ ] A/B screenshots: 002-global-split vs 004-per-vertex split in baked-shadow-heavy areas (under bridges, alleys, building north faces).

## Verification

- Bench: cell load time (parse+upload) native vs DFF; VRAM before/after KTX2.
- Visual: baked-shadow areas no longer double-lit at noon; no seams at cell borders in sunVis (bake over WELDED geometry, verify on seam-weld fixtures).

## Measurements

_(record after implementation)_

- bytes/cell before vs after; decode ms; VRAM delta: …
- bake time for the full map: …
