# cleo/scripts — authored CLEO script sources

One folder per script: `<name>/script.ts` (the DSL source, plan cleo-sdk/004) plus
`<name>/story.test.ts` (the headless behaviour + budget test). SOURCES only — compiled `.cs`
artifacts are build outputs in `cleo/sdk/dist/`, never committed here.

Build: `npm run build:cleo-scripts`. The SDK: [`../sdk/README.md`](../sdk/README.md).

| Script              | Replaces                                           | Artifact |
| ------------------- | -------------------------------------------------- | -------- |
| `hello-conformance` | — (the SDK's own conformance sample)               | 88 B     |
| `rhino-tracks`      | the GTA 5 Rhino mod's `rhino tracks.cs` (34 114 B) | 2 628 B  |
| `no-lights`         | the hotring mod's `no_lights.cs` (19 513 B)        | 237 B    |

Plans for the authored scripts live in [`docs/plans/`](docs/plans/readme.md) (001 rhino tracks ·
002 no_lights — the corpus-replacement chain, user's call 2026-08-06).
