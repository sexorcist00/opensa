# perfect-vegetation ASI

Our own `.asi` engine-patch for real **GTA:SA 1.0 US** that gives `lod-trees-generator`'s tree impostors a
VIEW-WEIGHTED draw: each of the crossed cards fades by how squarely it faces the camera, so the LOD shows
ONE projection of the canopy from every angle instead of four stacked ones (the solid dark blob of
[lod-trees plan 013](../../tools/lod-trees-generator/docs/plans/013-impostor-parity.md), cause 1). OpenSA gets
the same from a material class in its own engine; RenderWare has no such thing, and this plugin is how the
`sa` target gets it anyway.

The mechanism is deliberately shader-free: an impostor's cards are N materials of ONE atomic, the plugin wraps
that atomic's RENDER CALLBACK, and before each draw it writes the card's view weight into the material's
colour alpha — which the fixed function and the install's SkyGfx fork (`matCol` in `ps2BuildingVS`,
`docs/gta-sa-original/skygfx-fork-building-pipe.md`) both multiply in. The building PIPELINE stays whoever's
it was; a render callback is not a pipeline.

> **A CONSUMER of [`asi/sdk`](../sdk/README.md)** — the shared framework (exe fingerprint gate,
> byte-verify, adjuster coexistence, hooks, logging, codegen, build rules), exactly like
> [`asi/perfect-map`](../perfect-map/README.md), [`perfect-cutscene`](../perfect-cutscene/README.md) and
> [`perfect-vehicle`](../perfect-vehicle/README.md). This project holds only its own catalogue, payloads and a
> thin Makefile. Same single accepted exe.

## Layout

- **[docs/plans/readme.md](./docs/plans/readme.md)** — the execution chain (001: scaffold → RE → census →
  the weights payload → field ladder → pmb packaging).
- `gen/` — the catalogue (`catalogue.ts`, EMPTY until the RE step) + the thin generator.
- `src/` — `dllmain.cpp` and the seam headers (`identity` / `config` / `plugin` / `apply` / `game`);
  `src/patches/weights.hpp` is the pure per-card weight (no hooks); the hooking payloads land in
  `src/patches/` from step 2.
- `Makefile` — identity + payload flags, then `include ../sdk/mk/asi-plugin.mk`.

## Status

**Step 0 — scaffold (2026-08-21).** Builds verify-only and APPLY; the catalogue carries no sites, so an APPLY
build logs "patching nothing" and exits. Nothing ships yet: `perfect-map-builder` does not look for it until
plan 001 step 5.

## Building

```bash
npm run build:verify -w @opensa/perfect-vegetation-asi   # dry run: verifies every site, patches nothing
npm run build:asi    -w @opensa/perfect-vegetation-asi   # the shipping build → dist/perfect-vegetation.asi
npm run build:debug  -w @opensa/perfect-vegetation-asi   # APPLY + per-atomic trace (PVEG_TRACE)
```

`dist/` and `src/generated/` are gitignored. Prereq: `brew install mingw-w64`.
