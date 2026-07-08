# 001 — Reverse-engineering & patch catalogue

Part of the [opensa-asi chain](readme.md). Depends on [000](000-reproduce-bug.md) (the repro + oracle — the RE's behavioural cross-check runs against it). No code — produces THE artifact everything downstream needs: a verified table of `gta_sa.exe` 1.0 addresses, their original bytes, and the exact byte/logic change each needs. Get this wrong and 004 corrupts the process; get it right and 004 is mechanical.

## Context

The ghost-barriers post-mortem already did the hard behavioural work — it named the four unbounded structures and proved the int16 `IplDef` truncation is the root cause (bisected flip at exactly 2^15). What's missing is the **patch-author's view**: the precise instruction addresses, the current encoded bytes, and the minimal edit at each. Two independent sources cross-checked so we never patch on a single guess:

1. **Decompiled engine** (gta-reversed) — the semantic ground truth: which function, which field, what type.
2. **ProperFixes.asi** — behavioural confirmation that a given site is THE one that matters (it's obfuscated with no cleartext addresses, so it's a cross-check and a "does patching only these actually fix it" oracle, never a copy source — license-locked).

## Decisions

1. **Learn, don't lift.** ProperFixes is studied only to (a) confirm which structures must be patched for a complete fix and (b) sanity-check our address list behaviourally (install it, confirm our worst build works → we're patching a superset/equal set). Its bytes/addresses are never reused.
2. **Two-source rule per patch**: every catalogue entry cites the gta-reversed function AND the confirmed original bytes read from a real 1.0 US `gta_sa.exe`. No entry ships on decompiler-only or PF-only evidence.
3. **Static RE tools on macOS**: the exe and the asi are analysable headless — objdump/radare2/Ghidra (radare2 + `r2` scripts are scriptable and free; Ghidra for the deeper `IplDef` struct recovery). PF's injector/plugin-sdk symbols (already dumped: `function_hooker@injector`, `PatchAll`) tell us its patch style (function hooks vs raw byte writes) which informs how many sites each logical fix touches.
4. **Scope = the four structures + coexistence**, nothing more. Anti-aliasing/shader/graphics parts of PF are explicitly out.

## The catalogue to produce (one row each, filled in during the plan)

| Logical fix                             | gta-reversed ref                                                    | exe address(es) | original bytes | change                                                | why                           | FLA/OLA overlap?                 |
| --------------------------------------- | ------------------------------------------------------------------- | --------------- | -------------- | ----------------------------------------------------- | ----------------------------- | -------------------------------- |
| `IplDef` pool indexes int16 → int32     | `IplStore.cpp` `IncludeEntity` 0x404C90 (+ struct def, `RemoveIpl`) | …               | …              | widen the min/max truncation + the struct field reads | THE root cause (2^15 ceiling) | check `[IPL] Entity index array` |
| `gpLoadedBuildings` 4096/scene overflow | `FileLoader.cpp` `LoadScene` (0xBCC0E0 array)                       | …               | …              | relocate/enlarge the static array or bound the write  | trashed statics past ~26k     | FLA `Inst entries per file`      |
| `IplEntityIndexArrays` 40-slot cap      | `IplStore.cpp` `LoadIplBoundingBox` (0x8E3F08)                      | …               | …              | enlarge the slot array / relocate neighbours          | boot crash at 40+ text IPLs   | FLA `[IPL] Entity index array`   |
| `LinkLods` double-patch guard           | `FileLoader.cpp` `LinkLods`                                         | …               | detection only | skip if FLA/OLA own it                                | —                             | the conflict itself              |

Note the `IplDef` field is not just the truncating `min/max` at `IncludeEntity` — it's the struct field WIDTH plus every read in `RemoveIpl`/bounding-box paths. RE must find the full read/write set of `firstBuilding/lastBuilding/firstDummy/lastDummy`, or a partial widen re-introduces the bug at a different site. This completeness check is the plan's hardest task.

## Tasks

- [ ] Set up static RE on macOS: radare2 + Ghidra project over a real 1.0 US `gta_sa.exe`; import gta-reversed symbol/address maps to name functions.
- [ ] Disassemble `ProperFixes.asi`: enumerate its injector hook targets / patched addresses (even obfuscated, the injector call sites reveal WHICH engine addresses it touches) → the "which sites are load-bearing" oracle. Record the set (addresses only, as a checklist to reproduce independently).
- [ ] For each of the four fixes: locate every read/write of the structure, record address + original bytes + the decompiled context; design the minimal correct change (widen-in-place vs relocate-to-heap). Special care: the FULL `IplDef` field read/write set.
- [ ] Determine the `IplDef` struct layout + a widen strategy that doesn't shift neighbouring fields the rest of the engine reads (widening a struct field in a fixed-layout binary usually means **relocating the array to our own allocation** and rewriting accessors, not editing a field in place — decide and document per structure).
- [ ] Behavioural oracle run: using **[000](000-reproduce-bug.md)'s buggy build + detection oracle**, install real ProperFixes.asi, confirm the repro goes clean; then draft-verify that our catalogue's sites are the ones responsible (toggle reasoning documented). Reuse 000's harness — do not re-derive a repro here.
- [ ] Fingerprint spec: exact bytes/size/checksum identifying 1.0 US HOODLUM `gta_sa.exe` (used by 003 to refuse other versions).
- [ ] Output: `patch-catalogue.md` in this folder — the frozen table, each row two-source-cited. This is the input to 004.

## Verification

- Every catalogue address, when read from a clean 1.0 US exe, matches the recorded original bytes exactly (re-checkable script).
- The set of addresses is a **superset-or-equal** of ProperFixes's limit-patch sites (we're not missing a load-bearing site).

## Measurements / notes

_(fill during RE)_

- exe fingerprint (size/CRC/anchor bytes): …
- PF injector patch-site set: …
- per-structure widen strategy (in-place vs relocate): …
