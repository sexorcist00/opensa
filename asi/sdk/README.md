# asi/sdk — the ASI authoring SDK

The common base for authoring `.asi` plugins against GTA:SA 1.0 US, extracted from
`asi/perfect-map`'s framework half. A plugin written on it supplies only: its typed catalogue
(addresses + expected bytes + provenance), its payload headers, its config knobs, and a thin
Makefile. Everything else — the exe fingerprint gate, byte-verify, adjuster coexistence (FLA/OLA),
hook shapes, logging, dry-run, the cross-compile toolchain — is this project.

`asi/` is a root category (outside `packages/` and `tools/`) because its projects AUTHOR runtime
content rather than building the map — the same rule that placed `cleo/`, whose `sdk` + consumers
split this project mirrors.

## Layout

- `gen/` — the TypeScript codegen library: catalogue interfaces, `renderHeader`/`validate`, the
  shared `SA_FINGERPRINT`. Consumed by each plugin's thin `gen/generate.ts`.
- `src/` — the C++ framework headers (namespace `asi::`) + `freestanding.cpp` for `-nostdlib`.
- `mk/` — the includable Makefile fragment (MinGW-w64 cross-compile, KERNEL32-only link line).
- `docs/` — [architecture](docs/architecture.md) (the standing design + Decided) and the
  [plan chain](docs/plans/readme.md) (001–005).

## Consumers

- [`asi/perfect-map`](../perfect-map/README.md) — the first; its migration is the SDK's
  conformance proof.
- `asi/city-life` — the named second (roadmap 0.5.0), which will bring the per-frame tick and
  runtime `.ini` extension points when it arrives.

## Build

The SDK builds nothing by itself — a consumer's Makefile includes `mk/asi-plugin.mk` and runs
`make` (verify-only / dry-run), `make APPLY=1` (shipping), `make DEBUG=1` (verbose). Prereq:
`brew install mingw-w64`. The TS half is exercised by the repo-wide vitest run
(`asi/**/*.test.ts`).
