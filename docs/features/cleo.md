# CLEO scripts

Compiled CLEO `.cs` mods running on our own SCM virtual machine — decoder, VM, engine host and the
native-address atlas. Plan chain: [`docs/plans/097-cleo-basic/`](../plans/097-cleo-basic/readme.md)
(ledgers carry the measured record); the 7-mod corpus decode lives in the plan 01 ledger.

## State — 2026-08-04

| Piece | State |
| --- | --- |
| SCM decoding (`packages/cleo/src/core`) | DONE — two-layer decoder over the vendored Sanny DB (pin in `packages/cleo/vendor/README.md`); the `__SBFTR` trailer is the authoritative code/footer boundary; all 7 corpus scripts decode to the recon census; reference listings committed at `tests/custom/cleo-listings/` |
| Debug tooling | DONE — `scm-disasm.ts`, `cleo-census.ts` (live vm/todo registry join), `cleo-run.ts` (`--cars` drives class-B scripts headless with a symbol-level trace) — rows in `docs/debug/README.md` |
| VM (`packages/cleo/src/vm`) | DONE — cooperative threads on game time, ANDOR, CLEO_CALL frames, whitelist var grid, stdlib (lists/buffers/format/deterministic perlin), 10k instr/tick budget (worst real tick 3 450), per-thread throw isolation |
| Engine host (plan 04) | DONE — object handle table on the rigid-model path, model id↔name resolver, `Config.cleo` + `?cleo=1`, boot discovery of `cleo/*.cs`, toast for PRINT_STRING_NOW. **Field checkpoint 1 passed: the Ferris wheel spins** |
| Native atlas (plan 05) | DONE — opaque tokens surviving plain VM arithmetic, every corpus address named from gta-reversed (`CMatrix::SetRotate` = Rz·Rx·Ry; `0xB6F118` = TheCamera.m_fLODDistMultiplier), pool facade, frame tokens on the vehicle part registry, script fleet with slot-minted handles, atlas misses surfaced as console lines. **Zero misses in the field with the rhino driven** |
| Class-B visuals | BLOCKED on three named rig facts (05 ledger): the optimizer drops empty parent frames (rhino's `misc_e` track chain — twin of `docs/hacks/cleo-frame-sibling-order.md`), rear-door 095F ratios have no animator source, firela's pin is vacuous here |
| Packaging (plan 06) | DONE 2026-08-05 — installers carry `cleo/` (bake buckets + vehicle subfolder), corpus moved into `mods-src/original` (mods 60/61 + 6 vehicle mods; hotring ships car-only, its script skipped), gta.dat IDE lines automated by the bake, `cleo-place-mods.ts` retired. **Field checkpoint 3 PASSED**: census `[cleo] 6 script(s)` from the built dir AND from the fetch pack, nothing hand-placed (ledger in the plan) |
| Tier policy / F2 / CI coverage (plan 07) | NOT STARTED — the census `--json` and the miss console lines are its seams |

## Field knobs

`?cleo=1` (enable for a session) · `?spawncar=model[,x,y,z[,heading]]` · `?autoseat=1` — see
`docs/commands.md`. Scripts are discovered from `cleo/*.cs` in the VFS (contract:
[`docs/contracts/mods.md`](../contracts/mods.md)).
