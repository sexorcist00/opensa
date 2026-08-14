# perfect-cutscene ASI

Our own `.asi` engine-patch for real **GTA:SA 1.0 US** that gives CUTSCENE vehicles the deferred,
depth-sorted alpha pass the engine grants only gameplay `CVehicle` entities — so window glass on
converted cutscene cars renders OVER scene actors at any entity draw order, instead of z-erasing
every actor drawn after the car (plan 004 rounds 15–17: RIOT_4B's invisible passengers; the full
recovered mechanism lives in `docs/gta-sa-original/cutscenes.md` and
`docs/hacks/cutscene-window-pane-suppression.md`).

R\*'s own answer was authored data: vanilla cutscene cars carry no rendering window glass at all.
This ASI retires that ceiling — `vehicle-cutscene` conversions keep the mod's real tint on every
slot, and the per-slot window-pane suppression hack retires with it.

> **A CONSUMER of [`asi/sdk`](../sdk/README.md)** — the shared framework (exe fingerprint gate,
> byte-verify, adjuster coexistence, hooks, logging, codegen, build rules), exactly like
> [`asi/perfect-map`](../perfect-map/README.md). This project holds only its own catalogue,
> payloads and a thin Makefile. Same single accepted exe (the HOODLUM body-relocation trap is the
> SDK's problem, already solved once).

## Layout

- **[docs/plans/readme.md](./docs/plans/readme.md)** — the execution chain (001: reproduce → hook →
  field-gate → retire the hack → re-sweep → pmb packaging).
- `src/`, `gen/`, `Makefile` — created by plan 001 step 2 (mirroring perfect-map's shape).

## Status

Plan 001 written, not started — the repro protocol (step 0) is the entry point.
