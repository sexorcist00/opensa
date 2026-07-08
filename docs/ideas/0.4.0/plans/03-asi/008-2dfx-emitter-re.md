# 008 — 2dfx emitter lifecycle: reverse-engineering & root cause

Part of the [opensa-asi chain](readme.md), Phase 2. Depends on [007](007-2dfx-reproduce.md) (the repro + detection oracle the RE cross-checks against) and Phase 1's [001](001-reverse-engineering.md) (RE setup + patch-catalogue format) / [003](003-patch-framework.md) (where the new rows will plug in). No code — produces the verified catalogue rows for the 2dfx emitter fix, the way 001 did for the limit bugs.

## Context

The open issue ([lod-2dfx-particles.md](../../../../../docs/open-issues/lod-2dfx-particles.md)) already has the data-side story: `sa-lod-generator` clones the HD DFF verbatim into the LOD slot, carrying its **2dfx section**; type-1 (particle) entries make the far LOD an `effects.fxp` emitter too. Unlike geometry, **the cloned LODs' effect emitters do not unload from memory** — stacked on the pipeline payload they exhaust the streaming/model pool → null model-info on first instantiation → new-game crash at `0x004AA3A1` (AV `[null+0x1B]` in `CFileLoader::LoadObjectInstance`). Scale: 38 models carry particles, sa-lod cloned 11 of them. We currently STRIP the emitters at build time; ProperFixes reportedly fixes the lifecycle in-engine, so the emitters can exist without leaking.

What's unknown and this plan resolves: **why exactly they leak** (which engine lifecycle call is missing/failing for LOD-cloned emitters) and **which patch ProperFixes uses** — then two-source-cited catalogue rows for our own implementation.

## The hypothesis to confirm or replace

SA attaches 2dfx particle systems to an entity via `CEntity::CreateEffects` (registers `FxSystem`s with the global fx manager) and is supposed to tear them down via `CEntity::DestroyEffects` on unload. Candidate leak mechanisms to test during RE (RE decides which is real — do NOT assume):

1. **DestroyEffects never called for LOD entities** — LOD entities take a create/stream path that registers effects but a matching destroy is skipped on stream-out, so `FxSystem`s accumulate.
2. **A fixed effect pool overflows** — `FxSystem`/`FxSystemBP`/`C2dEffect` or the `effects.fxp` system-instance array is a bounded structure; too many concurrent emitters (every distant LOD emitting at once — the far-view overdraw is the same root) overrun it, corrupting the pool that model-info also lives near → the null on next load.
3. **Effects created for entities that never fully init** — the LOD instantiation reads a model-info that isn't ready (the null at `[null+0x1B]`), i.e. the effect-create path runs against an entity whose model-info slot was reclaimed under pool pressure.

"couldn't unload effect data from memory" (the user's framing) points at #1/#2 — a destroy/unload path that doesn't cover LOD-cloned emitters, or an unbounded accumulation. The far-view overdraw (all LOD emitters active simultaneously) is the _pressure_ that turns the leak into a crash, and is addressed data-side in [010](010-pipeline-keep-2dfx.md).

## Decisions

1. **Learn from PF behaviourally, write our own** — identical rule to Phase 1. PF is obfuscated + license-locked; we use it as the oracle that "this class is code-fixable and here are the sites it touches", never a byte source.
2. **Two-source rule** per catalogue row: gta-reversed function/field + confirmed original bytes from real 1.0 US `gta_sa.exe`.
3. **Behavioural oracle is decisive here** because the leak is subtle: install real ProperFixes.asi, take our UN-stripped LOD build (particles left in — reproduces the crash on stock), confirm PF makes it boot AND that distant emitters unload (watch the effect count / memory over a new-game load). That proves the fix is real and tells us which engine path PF touched.
4. **Distinguish "the fix" from "the mask".** If PF merely raises a pool (mask) vs actually restoring the destroy path (fix), we want the real fix — verify emitters actually UNLOAD (count returns to baseline when the LOD leaves range), not just "bigger pool delays the crash".

## Tasks

- [ ] Use **[007](007-2dfx-reproduce.md)'s crashing repro build + detection oracle** as the RE fixture (particle-2dfx un-stripped → `0x004AA3A1` on new game). Reuse it — do not re-derive a repro here.
- [ ] Decompiled RE: map `CEntity::CreateEffects`/`DestroyEffects`, the fx manager (`Fx.cpp`/`FxManager`/`g_fxMan`), `CParticleObject`, and the entity stream-in/stream-out paths that should pair create/destroy for buildings/LODs. Identify where the LOD path diverges (missing destroy, or an unbounded/overrun pool).
- [ ] Instrument under Wine: log effect-system count / relevant pool occupancy across a new-game load with the un-stripped build — confirm accumulation and pin the exact leaking structure/call. (winedbg recipe + logging from Phase 1's 005.)
- [ ] Behavioural oracle: same build + real ProperFixes.asi → boots AND emitter count returns to baseline as LODs unload; capture which path/pool PF's presence changes (bytes-diff the relevant zones vs stock if feasible).
- [ ] Produce the catalogue rows (append to `patch-catalogue.md`): each site = gta-reversed ref + address + original bytes + intended change + FLA/OLA overlap check. Distinguish "restore destroy path" vs "bound/relocate pool" per the confirmed mechanism.
- [ ] Decide the fix shape for [009](009-2dfx-emitter-patch.md): pure lifecycle fix (preferred — emitters unload correctly) vs pool-relocation (fallback) vs both.

## Verification

- The leaking structure/call is named with decompiled + behavioural evidence agreeing (not a single guess).
- Every proposed catalogue address matches recorded original bytes on a clean 1.0 US exe (re-checkable, per Phase-1 discipline).
- The repro fixture reliably crashes at `0x004AA3A1` without the fix and boots with real PF (bounding the search).

## Measurements / notes

_(fill during RE)_

- confirmed leak mechanism (which of #1/#2/#3, or other): …
- leaking structure/call address(es): …
- PF-touched zone(s) (oracle): …
- fix shape chosen for 009: …
