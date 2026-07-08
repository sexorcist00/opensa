# 003 — Patch framework (safety, fingerprinting, coexistence)

Part of the [opensa-asi chain](readme.md). Depends on [002](002-toolchain-architecture.md) (a loading ASI). Delivers the SAFE, declarative machinery that 004's actual patches plug into — the difference between "a maintainable patcher" and "a pile of magic `WriteMemory` calls".

## Context

Blind binary patching of a running game is unforgiving: a wrong address silently corrupts the process, a version mismatch patches garbage, and FLA/OLA patching the same zone crashes (`LinkLods` double-patch, documented in ghost-barriers.md). This plan builds the guardrails ONCE so every patch in 004 is declared, verified, logged, and coexistence-checked by construction.

## Decisions

1. **Declarative patch table, generated from `001`'s catalogue.** Each patch is a record: `{ name, address, expectedOriginalBytes, apply(fn), requires?, conflictsWith? }`. A TS generator (the tool's non-C++ half, decided in 002) reads `patch-catalogue.md` → emits a C++ header of constants (addresses + original-byte arrays + fingerprint). ONE source of truth; a hand-edit to an address in C++ is impossible because C++ addresses are generated. Unit-testable on macOS (the TS side) independent of the game.
2. **Original-byte verification is mandatory, per patch.** Before applying, read `sizeof(expectedOriginalBytes)` at `address` and `memcmp`. Mismatch → SKIP that patch, log LOUD (`[opensa-asi] ABORT patch 'ipldef-widen': bytes at 0x404C90 != expected`), never write. A single mismatch does not abort the others (partial safety), but the log makes it un-missable. This is the same discipline our TS mod tools use ("verify original bytes before patching").
3. **Exe fingerprint gate.** On attach, identify the module: base image size + a checksum + anchor bytes at known offsets (from `001`). Not 1.0 US HOODLUM → apply NOTHING, log the detected fingerprint, return cleanly. We refuse to guess across versions.
4. **Adjuster coexistence.** Detect loaded FLA (`fastman92limitAdjuster*`) and OLA (`$fastman92limitAdjuster`/`III.VC.SA.LimitAdjuster`) modules (enumerate loaded modules) AND probe whether a conflicting zone is already patched (its bytes differ from stock in the expected way). For each patch with `conflictsWith`, if the other adjuster owns it → SKIP + log "deferring IPL-slot patch to FLA". Our ASI patches only what nothing else covers → the FLA×OLA×us triple-patch crash is impossible by construction.
5. **Idempotent + observable.** Re-applying is a no-op (byte check fails after first apply → treated as already-ours via a second "post-patch bytes" signature). Every decision (applied / skipped-mismatch / skipped-conflict / skipped-version) is logged with address and reason. A `dry-run` build flag verifies all sites and logs the plan WITHOUT writing — the primary debugging aid.
6. **No hooks where a data-relocation suffices.** Prefer relocating a too-small static array to our own `VirtualAlloc`'d block + repointing accessors (from 001's strategy) over instruction detours when possible — fewer moving parts, easier to reason about. Function hooks (injector) reserved for logic changes (the int16 min/max widen).

## Tasks

- [ ] TS generator: parse `patch-catalogue.md` → emit `generated/patches.hpp` (addresses, original-byte arrays, post-patch signatures, fingerprint constants). Vitest tests on the parser (well-formed table → expected constants; malformed → hard error).
- [ ] C++ `PatchTable` runner: iterate records, fingerprint-gate, per-patch byte-verify, conflict-check, apply, log. `VirtualProtect` RAII wrapper.
- [ ] Fingerprint module: read PE headers of the host `gta_sa.exe` at runtime, compute the signature, compare to the generated constant.
- [ ] Adjuster detection: enumerate loaded modules (`EnumProcessModules`/`CreateToolhelp32Snapshot`); per-zone "already patched?" byte probe.
- [ ] Logger: timestamped file next to the exe (`opensa-asi.log`), levels, flush-on-write (survives a crash so we see the last attempted patch — critical for debugging blind patches).
- [ ] `dry-run` build flag: full verify + plan log, zero writes.
- [ ] Wine test: boot with a stock exe → all patches "would apply"; boot with FLA installed → conflicting patches "deferred"; boot with a wrong-version exe → "unsupported, nothing patched".

## Verification

- On a clean 1.0 US exe: every patch's byte-verify passes (proves 001's catalogue is byte-accurate end to end).
- With FLA present: overlapping patches log "deferred", non-overlapping ones still apply, game boots.
- Wrong version: zero writes, clean boot, clear log.

## Measurements / notes

- fingerprint constant + detection method: …
- adjuster detection reliability (FLA/OLA module names seen): …
