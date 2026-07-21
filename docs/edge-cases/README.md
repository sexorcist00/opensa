# Edge cases & current limitations

The standing constraints of the project **as of today** — hard limits, format gotchas, and known boundaries
on the own-WebGPU-engine path. No legacy: anything that only applied to the removed three.js renderer or to
fixed bugs does not belong here (a fixed bug's surviving _constraint_ does).

**Maintenance rule** (also in `CLAUDE.md`): when a new limitation is discovered, add it to the matching
file; when one is lifted, remove it in the same change.

| File                                             | Scope                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| [sa-formats.md](./sa-formats.md)                 | Strict RenderWare/SA asset-format requirements (DFF/TXD/COL/IMG) |
| [sa-runtime-limits.md](./sa-runtime-limits.md)   | Real-SA engine pool ceilings the `sa/` build target must respect |
| [converter-pipeline.md](./converter-pipeline.md) | opensa-pack / pmb / map-optimizer / LOD-generator boundaries     |
| [engine-rendering.md](./engine-rendering.md)     | Own WebGPU engine rendering limits and approximations            |
| [streaming-formats.md](./streaming-formats.md)   | Native-format versioning + streaming memory model invariants     |
| [browser-runtime.md](./browser-runtime.md)       | Browser/platform constraints (FSA, Cache Storage, e2e)           |
