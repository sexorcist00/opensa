# 03 — opensa-asi: our own limit-adjuster / engine-patch ASI

Build a tool that generates **our own `.asi` plugin** for real GTA:SA 1.0 — a Windows DLL that patches the engine's hard limits (chiefly the `IplDef` int16 ceiling behind the ghost-barriers bug) so perfect-map builds can add **any** number of objects without the current ≤30k text-row work-around.

This is the "standing goal" recorded across the ghost-barriers post-mortem and memory: _pin the exact patches that remove the ceiling and ship a 100% fix._ [`ProperFixes.asi`](../../../../../mods-src/mods-in-progress/ProperFixes%202.2.1/Proper%20Fixes/ProperFixes.asi) proves the bugs are code-patchable but is obfuscated and license-locked — we learn from it behaviourally and write our OWN patches from the decompiled engine ground truth.

## Why this, why now

- The full perfect-map build currently survives only by staying under stock limits: `checkTextIplSlotBudget` fails the build past **39 text-IPL slots / 30,000 text rows** ([docs/open-issues/ghost-barriers.md](../../../../../docs/open-issues/ghost-barriers.md)). That caps how much map/vegetation/procobj we can ship.
- Four unbounded SA structures were mapped during the ghost-barriers investigation (int16 `IplDef` pool indexes = THE root cause; `gpLoadedBuildings` 4096/scene; `IplEntityIndexArrays` 40 slots; FLA×OLA double-patch conflicts). We know exactly what to patch — we just need our own patcher.
- With `ProperFixes.asi` installed, even our worst 30,566-row monolith worked — behavioural proof the fix is real and sufficient.

## What we know about the target

`ProperFixes.asi`: PE32 (i386) Windows DLL, 185 KB, built with the community modding stack — symbols expose **injector** (`function_hooker@injector`, `PatchAll`) + **plugin-sdk** (`plugin::`, `BaseEventI`, `ArgPick`). Loads via an ASI loader (Ultimate ASI Loader / modloader). Requires Proper Shaders or SkyGfx — that coupling is THEIRS (shader pipeline), NOT relevant to the limit patches we want. Our ASI targets only the limit/pool structures and depends on nothing.

## Core constraints shaping the whole chain

1. **We build on macOS, the artifact runs on Win32.** Need a headless cross-compile toolchain (no Windows machine, no MSVC). The user already runs the game under **Wine** — that's our test/debug harness.
2. **Blind binary patching must be SAFE.** Every patch site is verified against the known original bytes of `gta_sa.exe` 1.0 US before it's written; a mismatch aborts loudly instead of corrupting the process. This mirrors our existing "verify original bytes before patching" discipline in the mod tools.
3. **Coexistence, not conflict.** FLA and OLA already patch some of these zones; our ASI must detect them and skip/aliasing-guard overlapping patches (the FLA×OLA `LinkLods` double-patch crash is a documented failure mode). We patch ONLY what no installed adjuster covers.
4. **Version-locked.** Only SA 1.0 US (HOODLUM). Detect the exe fingerprint; refuse to patch anything else rather than guess.
5. **Reversible & debuggable.** Log every applied/skipped patch to a file; a "dry-run verify" mode that checks all sites without patching.

## The chain

| #   | Plan                                                                      | Delivers                                                                                                                           | Status |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 0   | [000 — Reproduce the ghost-barriers bug](000-reproduce-bug.md)            | **first task** — a fast, deterministic, isolated repro of the int16 crash + a detection oracle; the pass/fail gate for 001/004/006 | idea   |
| 1   | [001 — Reverse-engineering & patch catalogue](001-reverse-engineering.md) | RE of ProperFixes + decompiled engine → the exact list of addresses/patches WE will write                                          | idea   |
| 2   | [002 — Toolchain & project architecture](002-toolchain-architecture.md)   | macOS→Win32 cross-compile, ASI skeleton, hook/patch primitives, repo layout                                                        | idea   |
| 3   | [003 — Patch framework](003-patch-framework.md)                           | declarative patch table, exe fingerprinting, original-byte verification, adjuster coexistence                                      | idea   |
| 4   | [004 — Limit-lift patches](004-limit-patches.md)                          | the actual fixes: IplDef int16 → int32, gpLoadedBuildings, IplEntityIndexArrays, guards                                            | idea   |
| 5   | [005 — Build, debug & test harness](005-build-debug-test.md)              | Wine boot smoke, byte-level unit tests on macOS, logging, symbol maps, CI                                                          | idea   |
| 6   | [006 — Pipeline integration & budget lift](006-pipeline-integration.md)   | ship the asi from pmb output; relax `checkTextIplSlotBudget` when it's present                                                     | idea   |

Dependencies are linear 000 → 001 → … → 006. **000 is the very first task** — a reliable, isolated reproduction of the bug is the pass/fail oracle everything else is measured against (you can't confirm a fix you can't trigger). 004 is the payload; everything between 000 and 004 exists to make 004 correct, safe, and maintainable.

## Phase 2 — 2dfx effect-emitter lifecycle (a second patch on the same framework)

Once the framework (002/003/005) and pipeline integration (006) exist, adding an engine fix is "reproduce it → RE it → catalogue row → patch entry → validate" — exactly the extension procedure 005 documents. Phase 2 does that for the **2dfx particle-emitter leak on LODs** ([lod-2dfx-particles.md](../../../../../docs/open-issues/lod-2dfx-particles.md)): cloned-LOD effect emitters never unload → effect/model pool exhaustion → new-game crash (`0x004AA3A1`, null model-info in `LoadObjectInstance`). We currently strip particle 2dfx from every LOD at build time; ProperFixes reportedly fixes the lifecycle in-engine. This phase **reproduces the crash first** (its own oracle, mirroring Phase 1's 000), reverse-engineers the fix, implements it in OUR asi, and then lets the pipeline **keep** particle effects on LODs (the open issue's "remaining goal") instead of stripping them.

| #   | Plan                                                                             | Delivers                                                                                                                                   | Status |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 7   | [007 — Reproduce the 2dfx emitter-leak crash](007-2dfx-reproduce.md)             | **first Phase-2 task** — deterministic un-stripped-emitter repro of `0x004AA3A1` + a leak/crash oracle; the pass/fail gate for 008/009/010 | idea   |
| 8   | [008 — 2dfx emitter lifecycle: RE & root cause](008-2dfx-emitter-re.md)          | why cloned-LOD emitters leak; PF's patch located; catalogue rows added                                                                     | idea   |
| 9   | [009 — 2dfx emitter-lifecycle patch](009-2dfx-emitter-patch.md)                  | the fix in our asi; new-game crash gone WITH particle 2dfx present on LODs                                                                 | idea   |
| 10  | [010 — Pipeline: keep 2dfx on LODs + far-view budget](010-pipeline-keep-2dfx.md) | stop stripping particles for the opensa-asi target; LOD-range rate/sprite budgets kill overdraw                                            | idea   |

Phase 2 depends on Phase 1's 002/003/005/006 (framework + integration); 007 → 008 → 009 → 010 is linear, and **007 (reproduce) is the first Phase-2 task** — the RE and patch are measured against its oracle.

## References

- **Decompiled ground truth**: gta-reversed (github.com/gta-reversed/gta-reversed-modern) — `IplStore.cpp` (`IncludeEntity` 0x404C90, `LoadIplBoundingBox`), `FileLoader.cpp` (`LoadScene`, `LinkLods`). This is where every patch address comes from.
- **Hook/patch lib**: injector.hpp (github.com/thelink2012/injector, permissive — freely reusable, unlike ProperFixes) — the same lib PF and FLA use; or a ~200-line self-authored subset for full transparency (decided in 002).
- **ASI/plugin scaffolding**: plugin-sdk (github.com/DK22Pac/plugin-sdk) if we want its RW/CLEO glue — likely NOT needed; a bare `DllMain` ASI is enough for pure memory patches.
- **Cross-compile**: MinGW-w64 (`i686-w64-mingw32`) or Zig (`zig cc -target x86-windows-gnu`) — evaluated in 002.
- **Prior art on the exact bug**: Junior_Djjr / MixMods `CrashList.txt` ("Limits on .ipl files that contain objects in the inst section"); FLA's `[IPL] Entity index array` option.
- **In-repo**: `tools/perfect-map-builder/src/pipeline.ts` (`checkTextIplSlotBudget`), `tools/map-placement/*` (binary streams), [ghost-barriers.md](../../../../../docs/open-issues/ghost-barriers.md) (the full post-mortem this chain acts on).
- **Phase 2 (2dfx)**: gta-reversed `CEntity` (`CreateEffects`/`DestroyEffects`/`UpdateRW`), `Fx.cpp`/`FxManager`, `CParticleObject`, `C2dEffect` (2dfx type-1 = particle); [lod-2dfx-particles.md](../../../../../docs/open-issues/lod-2dfx-particles.md) + `tools/sa-lod-generator/docs/plans/005-strip-clone-particle-fx.md` (our current strip fix); `@opensa/rw-codec/dff` `stripParticleEffects`/`build2dfxSection`.
