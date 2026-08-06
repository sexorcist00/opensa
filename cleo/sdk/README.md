# @opensa/cleo-sdk — CLEO authoring SDK

Write CLEO scripts in TypeScript, compile to standard CLEO 4 `.cs` — one source, two runtimes:
real CLEO on the canonical SA 1.0 US exe, and our VM (`@opensa/cleo`). Every authored script is
thereby a conformance test of the VM against real CLEO.

- Design: [docs/architecture.md](docs/architecture.md)
- Execution chain: [docs/plans/readme.md](docs/plans/readme.md) (001–005)
- Root-level plan (goals check, scope cuts, ledger): `docs/plans/097-cleo-basic/08-authoring-sdk.md`
  at the repo root

Why root `cleo/` and not `tools/`: the `asi/perfect-map` pattern — a self-contained project that
AUTHORS runtime content for the game rather than building the map. Build-time only: the runtime
never imports the SDK, and the SDK's only upstream is `@opensa/cleo` (opcode table, decoder,
disassembler — the format's ground truth).

## Layout

```
cleo/
  scripts/          # authored script SOURCES, one folder per script (see its README)
  sdk/
    src/            # cli.ts + build.ts (001); assembler (002), whitelist (003), DSL (004) land here
    dist/           # compiled artifacts <name>.cs / <name>.opensa-only.cs — git-ignored
    docs/           # architecture + the 001–005 plan chain
```

## Commands

- `npm run build:cleo-scripts` — compile every script under `cleo/scripts/` to `cleo/sdk/dist/`.
  (As of plan 001: discovery + report; assembly arrives with plans 002–004.)
