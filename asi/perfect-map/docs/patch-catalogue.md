# perfect-map ASI — patch catalogue

The frozen list of `gta_sa.exe` **1.0 US (HOODLUM, 14 MB)** sites the ASI patches, and the exact change each
needs. Produced by plan [001](./plans/001-reverse-engineering.md); consumed by [004](./plans/004-limit-patches.md)
(the patches) via the TS generator (→ `generated/patches.hpp`). The reproduction oracle every row is validated
against is [`tools-debug/sa-int16-repro`](../../../tools-debug/sa-int16-repro).

**Two-source rule** — every row needs BOTH: (a) the gta-reversed decompiled semantics AND (b) the original bytes
read from the real 1.0 US exe. **Both DONE** for #1–#4 (verified 2026-07-09 against the exe below, capstone
disasm); #5 is detection-only.

> **Machine mirror:** the addresses + original bytes here are also the typed
> [`gen/catalogue.ts`](../gen/catalogue.ts) — the single source of truth the generator turns into
> `src/generated/patches.hpp` (the C++ framework's fingerprint + byte-verify tables). This prose and that file
> MUST agree; the framework verifies these bytes against the exe at load (plan 003).

**Address provenance.** Addresses are annotated in
[gta-reversed-modern](https://github.com/gta-reversed/gta-reversed-modern) `source/game_sa/` (1.0 US only) AND
confirmed against the exe. **Caveat — HOODLUM relocation:** on the real 1.0 US HOODLUM exe the protector has
STOLEN/relocated some function bodies. `IncludeEntity`'s callable entry 0x404C90 is a trampoline
(`e9 9b ea 15 01` = `jmp 0x1563730`); its real body — including the int16 truncation — lives at **0x1563730**
(in the `.HOODLUM`/`_TEXT_HA` overlay). `RemoveIpl`, `LoadScene`, `LoadIplBoundingBox` are clean in place. This
is why the recommended strategy hooks the **callable entries** (stable) rather than surgically patching relocated
bodies.

## Exe fingerprint (verified — the 003 version gate)

The gate reads these **from the exe on DISK** (file size + anchor bytes at file offsets), NOT from memory — so a
loaded FLA/OLA that has patched the IPL code at runtime cannot make us mis-identify the version (learned the hard
way: Wine test 1 failed a memory anchor because the user's FLA patches `RemoveIpl`).

- size **14,383,616** bytes; SHA1 **`8c23ceffafa9fd88ea567be7926a33413b8e3c00`**;
  SHA256 `f01a00ce950fa40ca1ed59df0e789848c6edcf6405456274965885d0929343ac`.
- image base **0x400000**; sections include `.HOODLUM` (the protector overlay).
- anchor bytes (clean, in-place): 0x404B4A = `0f bf 7b 22`; 0x405C23 = `66 8b 43 2a`; 0x5B8938 = `89 04 8d e0 c0 bc 00`.
- **Reject** the 14,405,632-byte SHA1 `0df50d56…` build (a different/extra-protected variant — see plan 001 notes).

## Summary table

| #   | Logical fix                                                           | gta-reversed ref                                                  | address(es) — real exe                                                                                                       | original bytes                                                | change                                                                                                                 | FLA/OLA overlap                                   |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | `IplDef` building range int16 → int32 — **✅ SHIPPED, works in-game** | `IplStore.cpp` `IncludeEntity` + `RemoveIpl`                      | IncludeEntity **0x404C90**; RemoveIpl entry **0x404B20** + reads **0x404B4A** / **0x404B5D** / **0x404BA8** (loop back-edge) | see #1 detail                                                 | observe IncludeEntity → int32 sidecar; snapshot at RemoveIpl entry; redirect its 3 building-bound reads to the sidecar | FLA jmp-hooks the 3 reads → we overlay; OLA stock |
| 2   | `RemoveIpl` reads the widened range                                   | `IplStore.cpp` `RemoveIpl`                                        | **0x404B20** (body clean)                                                                                                    | `0f bf 7b 22` / `0f bf 53 24` (`movsx …,word[ebx+0x22/0x24]`) | hook the entry; read the int32 range from the sidecar                                                                  | (same as #1)                                      |
| 3   | `gpLoadedBuildings` 4096/scene overflow                               | `FileLoader.cpp` `LoadScene` INST case                            | store **0x5B8938**, count **0x5B8940** (array **0xBCC0E0**, count **0xBCC0D8**)                                              | `89 04 8d e0 c0 bc 00` (`mov [ecx*4+0xBCC0E0],eax`)           | relocate+enlarge the `CEntity*[4096]`; add the missing bound                                                           | FLA `Inst entries per file`                       |
| 4   | `IplEntityIndexArrays` 40-slot cap                                    | `IplStore.cpp` `LoadIplBoundingBox` / `GetNewIplEntityIndexArray` | **0x405C00** (array **0x8E3F08**, count **0x8E3F00**, cursor **0x8E3EFC**)                                                   | `66 8b 43 2a` (`mov ax,word[ebx+0x2a]` = staticIdx)           | relocate+enlarge the `CEntity**[40]`; raise the ceiling                                                                | FLA `[IPL] Entity index array`                    |
| 5   | `LinkLods` double-patch coexistence                                   | `FileLoader.cpp` `LinkLods`                                       | **0x5B51E0**                                                                                                                 | detection only                                                | skip if FLA/OLA own the same zone                                                                                      | the conflict itself                               |

## Structure details

### #1/#2 — `IplDef` int16 pool-index range (THE root cause)

`IplDef` (`IplDef.h`, `VALIDATE_SIZE = 0x34`) stores each IPL's owned pool range as **int16**:

```
offset  field           type
0x00    bb (CRect)      16 bytes
0x10    name[18]
0x22    firstBuilding   int16   { SHRT_MAX }
0x24    lastBuilding    int16   { SHRT_MIN }
0x26    firstDummy      int16   { SHRT_MAX }
0x28    lastDummy       int16   { SHRT_MIN }
0x2A    staticIdx       int16   { -1 }        ← also the 0..39 index into IplEntityIndexArrays (#4)
0x2C    isInterior bool … flags
```

`CIplStore::IncludeEntity` (0x404C90) truncates the building-pool index into those fields:

```cpp
const auto buildingId = GetBuildingPool()->GetIndex(entity->AsBuilding());
ipldef->firstBuilding = std::min(ipldef->firstBuilding, (int16)buildingId);   // (int16) TRUNCATION
ipldef->lastBuilding  = std::max(ipldef->firstBuilding, (int16)buildingId);   // (+ the stock max-vs-firstBuilding bug)
// dummy branch: same for firstDummy/lastDummy
```

`CIplStore::RemoveIpl` (0x404B20) then deletes by that stored range:

```cpp
ProcessPool(*GetBuildingPool(), def->firstBuilding, def->lastBuilding);   // [min,max) delete where GetIplIndex()==slot
ProcessPool(*GetDummyPool(),    def->firstDummy,    def->lastDummy);
```

Once the building pool exceeds **32,767** entries the `(int16)` cast wraps negative, the stored range is garbage,
and RemoveIpl scans a wild/empty range → undeleted or wrongly-deleted entities (the ghost `barriers2`). Bisected
flip at exactly 2^15 — see [ghost-barriers.md](../../../docs/open-issues/ghost-barriers.md).

**Verified on the exe (2026-07-09).** `IncludeEntity`'s body (relocated by HOODLUM to 0x1563730) does the
truncation as `mov word ptr [ecx+0x22], dx` (`66 89 51 22`) — writing only the low 16 bits of the index — after
`movsx eax, word ptr [ecx+0x22]` (`0f bf 41 22`) for the min/max compare; identically for `+0x24` (lastBuilding),
`+0x26` (firstDummy), `+0x28` (lastDummy). `RemoveIpl` (clean, 0x404B20) reads them back with
`movsx …, word ptr [ebx+0x22]` (`0f bf 7b 22`) / `[ebx+0x24]` (`0f bf 53 24`); `imul …,0x34` confirms the
0x34 `IplDef` stride. The machine code matches the decompiled `(int16)` cast exactly.

**Fix strategy — two options; the binary reality is NOT "just widen the field":**

- **(A) Widen in place (source-level).** Change the five fields to `int32` and drop the casts. In a fixed-layout
  compiled binary this shifts every field past 0x22 and grows the pooled struct stride from 0x34 — so it requires
  relocating the `IplDef` pool AND repatching every hardcoded offset access across the engine. High blast radius;
  rejected unless #4's `staticIdx` forces it.
- **(B) Sidecar range table (recommended, pure hooks).** Leave `IplDef` at 0x34 untouched. Hook `IncludeEntity`
  and `RemoveIpl` (injector `function_hooker`) to store/read the building/dummy range in our own
  `int32[NUM_IPL_SLOTS]` sidecar keyed by `iplSlotIndex`, bypassing the int16 fields entirely. No struct growth,
  no offset repatching — matches the architecture's "prefer data over instruction-layout surgery." `staticIdx`
  (the 40-slot index, #4) stays int16 but is bounded by #4's relocation, not by 2^15.
  **Sidesteps the HOODLUM relocation:** both hooks target the stable **callable entries** (0x404C90, 0x404B20 —
  0x404C90 is already a `jmp`, trivial for a function-hook to redirect), so the relocated/scattered body at
  0x1563730 is never touched. This is the decisive advantage over strategy A's surgical body patching.

> **Completeness check (the plan's hardest task):** confirm the sidecar covers EVERY read of
> `firstBuilding/lastBuilding`. Done — an exe scan (word reads of `[reg+0x22]`/`[reg+0x24]` near `imul …,0x34`) AND
> a full gta-reversed grep both prove **`RemoveIpl` is the sole reader**. But the exe scan found the compiler
> emits **THREE** reads there: `firstBuilding` @0x404B4A, `lastBuilding` @0x404B5D (the pre-loop cmp), and
> `lastBuilding` **re-read every loop iteration @0x404BA8** (the `for(i=first; i<last; i++)` back-edge). Missing
> the loop re-read stopped deletion after one building — that was the last bug.

**✅ Shipped implementation (`src/patches/int16.hpp`) — strategy B, works in-game with FLA and OLA:**

- **Observe `IncludeEntity`** (hook 0x404C90 → body 0x1563730): accumulate the building pool-index range in an
  `int32[256]` sidecar keyed by IPL slot, **pure min/max**.
- **Hook `RemoveIpl` entry** (0x404B20): snapshot the slot's range into `gSnapFirst/gSnapLast` for the detours,
  then RESET the slot to empty. This is the lifecycle reset — the naive `firstBuilding==SHRT_MAX` fresh-detect was
  WRONG: the engine's unsigned min keeps `firstBuilding` at SHRT_MAX for slots whose buildings are ALL > 32767, so
  it fired every call and collapsed the range to one element.
- **Three detours** feed `gSnapFirst`/`gSnapLast` into RemoveIpl's building loop at 0x404B4A / 0x404B5D /
  **0x404BA8** (the loop re-read). `dummies` don't overflow in practice (diagnosed live — no over-int16 dummies),
  so `firstDummy/lastDummy` are left alone (004b if ever needed).
- **Coexistence:** OLA leaves the read sites stock (detours apply cleanly). **FLA jmp-hooks all three read sites**
  (5-byte `e9` jmps → its own ~0x22C49xx handlers) but NOT the entries — so we verify the entries + the detour
  continuations (0x404B54/63/BAD) and FORCE the detours over FLA's jmps, overlaying FLA's incomplete int16 patch
  with our complete one. The detours are self-contained (hardcode the relocated stock instruction), so identical
  code works over stock (OLA/vanilla) and over FLA's jmp. **Confirmed in-game: ghost barriers gone in both.**

### #3 — `gpLoadedBuildings` (4096, unchecked) in `LoadScene`

```cpp
// IplStore.h
gNumLoadedBuildings = StaticRef<uint32>(0xBCC0D8);
gpLoadedBuildings   = StaticRef<std::array<CEntity*, 4096>>(0xBCC0E0);
// FileLoader.cpp  CFileLoader::LoadScene  0x5B8700, INST case:
gpLoadedBuildings[gNumLoadedBuildings++] = LoadObjectInstance(line);   // NO bound
```

`CEntity*[4096]` at 0xBCC0E0, `uint32` count at 0xBCC0D8. No check before the write; overflowing 4096 buildings
in one `LoadScene` pass smashes adjacent `.data`. **Fix:** relocate+enlarge the array to our own buffer and add
the missing bound. `SetupRelatedIpls` (0x404DE0) is handed `&gpLoadedBuildings[gNumLoadedBuildings]` as the
append cursor, and `LinkLods` reads the same base — so the base+cursor must stay consistent across #3/#5 (patch
as a set). This is genuinely an **array-relocation** fix, not a hook.

**Verified on the exe (2026-07-09).** The store is `mov [ecx*4 + 0xBCC0E0], eax` (`89 04 8d e0 c0 bc 00`) at
**0x5B8938**, count write-back `mov [0xBCC0D8], ecx` (`89 0d d8 c0 bc 00`) at **0x5B8940** — the `0xBCC0E0`
base is a raw 32-bit displacement in these instructions, so relocation = rewriting that displacement at every
`0xBCC0E0`/`0xBCC0D8` reference in LoadScene/LinkLods/SetupRelatedIpls (multiple sites confirmed). No bound
instruction precedes 0x5B8938 — the fix must inject one.

### #4 — `IplEntityIndexArrays` (40 slots)

```cpp
// IplStore.h
ppCurrIplInstance       = StaticRef<CEntity**>(0x8E3EFC);
NumIplEntityIndexArrays = StaticRef<int32>(0x8E3F00);
IplEntityIndexArrays    = StaticRef<std::array<CEntity**, 40>>(0x8E3F08);
// LoadIplBoundingBox 0x405C00 indexes it by def.staticIdx (guarded only by !=-1):
const auto pIPLLODEntities = def.staticIdx != -1 ? IplEntityIndexArrays[def.staticIdx] : nullptr;
```

`CEntity**[40]` at 0x8E3F08; count `int32` at 0x8E3F00; cursor at 0x8E3EFC. The 40 ceiling is enforced in
`GetNewIplEntityIndexArray`. **Fix:** relocate+enlarge the 40-slot array and raise the ceiling. Because the
subscript is `def.staticIdx` (int16 @0x2A), a very large slot count would also need `staticIdx` widened — but 40
→ a few hundred stays well within int16, so relocation alone suffices; no struct-widen required here.

> **Local cross-check (RE session 1):** ProperFixes.asi references the `0x8E3EE8–0x8E3F08` global cluster
> (0x8E3EE8 seen in its bytes, 0x14 below `ppCurrIplInstance`), consistent with PF relocating this exact array.

### #5 — `LinkLods` coexistence (detection only)

`LinkLods` (0x5B51E0) reads `gpLoadedBuildings` up to `gNumLoadedBuildings + numRelatedIPLs` and calls
`CColAccel::addIPLEntity/cacheIPLSection` with the array base+count. It is NOT patched by us — but if FLA/OLA has
already relocated `gpLoadedBuildings`/the IPL arrays, our #3/#4 relocation would double-patch the same zone (the
documented FLA×OLA `LinkLods` crash). So #3/#4 carry `conflictsWith` guards: detect the adjuster (module enumerate

- byte probe, per [003](./plans/003-patch-framework.md)) and defer if it owns the zone.

## Exe fingerprint (⏳ TODO — needs the exe)

1.0 US HOODLUM `gta_sa.exe` identity for the version gate (003): image size, a checksum over `.text`, and anchor
bytes at 2–3 of the addresses above. To be filled from the user's exe.

## Open (rule b — needs the 1.0 US exe + radare2/Ghidra)

- Original bytes at each address above (the byte-verify baseline for 003).
- Fingerprint constants.
- Full PF patch-site set via disassembly (not byte-scan) — confirm our set is a superset-or-equal of PF's
  limit patches (the behavioural completeness oracle).
