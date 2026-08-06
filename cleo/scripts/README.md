# cleo/scripts — authored CLEO script sources

One folder per script: `<name>/script.ts` (the DSL source, plan cleo-sdk/004) plus
`<name>/story.test.ts` (the headless behaviour + budget test). SOURCES only — compiled `.cs`
artifacts are build outputs in `cleo/sdk/dist/`, never committed here.

Build: `npm run build:cleo-scripts`. The SDK: [`../sdk/README.md`](../sdk/README.md).

Plans for the authored scripts live in [`docs/plans/`](docs/plans/readme.md) (001 rhino tracks ·
002 no_lights — the corpus-replacement chain, user's call 2026-08-06).
