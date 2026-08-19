# 011 — `IplDef`'s dummy range int16 → int32 (the "004b" half of the int16 lift)

Part of the [perfect-map ASI chain](readme.md). This is the work
[004](004-limit-patches.md) deferred as **004b** and the
[patch catalogue](../patch-catalogue.md) recorded as *"dummies don't overflow in practice … 004b if ever
needed"*. **That diagnosis was falsified in the field on 2026-08-19**, and this plan is the consequence.

Depends on [003](003-patch-framework.md) (declarative table, fingerprint, byte verification, coexistence)
and on 004's shipped building fix, whose machinery this extends rather than duplicates.

## Context — what the field proved

Full forensics: [`docs/open-issues/sa-load-game-crash-dummy-pool.md`](../../../../docs/open-issues/sa-load-game-crash-dummy-pool.md).
The short of it:

- The game crashes at `0x00538103` — `CFileLoader::LoadObjectInstance` takes null from the `CPool<CDummy>`
  allocator, jumps past the constructor and dereferences it. `ESI = 0` in the dump; `EDX` carries the
  configured pool size and matched the ini on both captures (`0xC350` = 50 000, `0x7FFF` = 32 767).
- **The pool never empties between world entries.** Measured across two field points: `Dummys = 50000` dies
  on the 3rd LOAD GAME, `100000` on the 6th — a leak of ~17 000 per entry, which is exactly the permanent
  set this build places (17 539 dummies from its text IPLs, against stock SA's **40**).
- **The pool cannot be kept inside int16.** `Dummys = 32767` does not boot — 15 s in, before the menu. So
  there is no configuration in which `RemoveIpl` walks an untruncated dummy range, which is what turns this
  from an option into the only exit.

## What already exists (this is an extension, not a new patch)

`src/patches/int16.hpp` shipped the building half in 004, and every piece of it is shaped to be widened:

| piece | building (shipped) | dummy (this plan) |
| --- | --- | --- |
| observer hook | `IncludeEntity` **0x404C90** → body 0x1563730 | **the same hook** — `IncludeEntity` already has both branches (`ENTITY_TYPE_BUILDING` and `ENTITY_TYPE_DUMMY`), and `PmIncludeObserver` already discriminates on the entity-type byte at `+0x36 & 7` (building = 1, dummy = 5) and already `return`s on 5 |
| pool base | `kBuildingPool = 0xB74498` | `ms_pDummyPool = 0xB744A0` — already hardcoded in the file's `PM_INT16_LOG` diagnostic |
| element size | `kSizeofBuilding = 0x38` | **identical**: `sizeof(CDummy) == sizeof(CDummyObject) == sizeof(CBuilding) == 0x38`, so the index arithmetic is unchanged |
| sidecar | `gFirstBuilding/gLastBuilding[256]` | a second pair, same shape |
| snapshot | `PmRemoveIplSnapshot` at `RemoveIpl` entry (0x404B20) | **the same hook**, snapshotting and resetting a second pair |
| bound-read detours | 3 sites: 0x404B4A, 0x404B5D, 0x404BA8 | 2 sites — see below |

There is even a diagnostic already written for this exact question, under `PM_INT16_LOG`:
*"does the DUMMY pool (type 5) also overflow int16? (dummies aren't fixed yet — 004b.)"* Step 1 is to run
it.

## The patch sites, read off the shipping exe

```
404c0f: 0f bf 7b 26   movswl 0x26(%ebx),%edi    ; firstDummy
404c13: 0f bf 4b 28   movswl 0x28(%ebx),%ecx    ; lastDummy
404c17: 3b f9         cmpl   %ecx,%edi
404c19: 7f 3f         jg     0x404c5a           ; empty range → skip the pass
...
404c4e: 0f bf 43 28   movswl 0x28(%ebx),%eax    ; lastDummy, re-read on the loop back-edge
404c52: 47            incl   %edi
404c53: 83 c5 38      addl   $0x38,%ebp
404c56: 3b f8         cmpl   %eax,%edi
404c58: 7e c6         jle    0x404c20
```

**Two detours, not three** — unlike the building pass, whose reads are 19 bytes apart, the two pre-loop
dummy reads are ADJACENT (8 bytes, `0x404C0F`–`0x404C16`). One 5-byte `jmp` at `0x404C0F` covers both:
load `edi` = snapped first, `ecx` = snapped last, return to **`0x404C17`** (the `cmpl`). The back-edge
detour mirrors 004's `0x404BA8` exactly: at `0x404C4E` set `eax` = snapped last, re-run the clobbered
`incl %edi`, return to **`0x404C53`**.

> **Trap, and it must be verified before anything is written:** the dummy loop's back-edge is `jle` —
> **inclusive** — while gta-reversed renders the pass as `for (i = minId; i < maxId; i++)`, i.e. exclusive.
> A snapshot fed in with the wrong convention deletes one entity too few or walks one past the end. Confirm
> the bound convention against the asm, not the C.

## Decisions

1. **Extend `int16.hpp`, do not fork it.** Same strategy as 004: OBSERVE `IncludeEntity` into an int32
   sidecar, SNAPSHOT at `RemoveIpl` entry, REDIRECT the bound reads. The engine's own `(int16)dummyId`
   writes stay untouched — we never write the struct, so we cannot corrupt it.
2. **A separate snapshot pair for dummies.** `RemoveIpl` runs buildings → objects → dummies in one call, so
   one pair cannot serve both. `RemoveIpl` is non-reentrant, so two static pairs suffice.
3. **Behind its own flag** (`PM_FIX_INT16_DUMMY`), like every other fix, so the field can bisect it against
   the building fix alone.
4. **Ship nothing until the completeness scan is done.** 001 called this "the plan's hardest task" and the
   building work proved why: the compiler emitted a THIRD read on the loop back-edge, and missing it stopped
   deletion after one entity. A partial widen re-introduces the bug at a different site, silently.
5. **No demand reduction here.** Whether 17 311 procobj rows should be `object.dat` models at all is a real
   question and it belongs to the pipeline, not to this patch. This plan makes the engine correct for the
   data we already ship.

## Steps

### Step 1 — measure the overflow instead of inferring it (the oracle)

Build with `PM_INT16_LOG` and the existing type-5 diagnostic, boot the real install at `Dummys = 100000`,
enter the world twice.

**Expect:** `[dbg] incDUMMY slot/id` lines with ids above 32 767, and `RemoveIpl` snapshots whose engine
int16 `firstDummy/lastDummy` are negative or clamped while the true range is not. **Verification:** those
lines exist. If they do NOT, the truncation is not what strands the dummies and steps 4–5 would fix
nothing — stop here and re-open the diagnosis (see Risks).

*Measured: —*

### Step 2 — the completeness scan for `+0x26` / `+0x28`

Prove `RemoveIpl` is the only consumer of the dummy range, the way 004 proved it for the building pair
(exe scan AND a full gta-reversed grep, agreeing).

Technique and starting point, already run once on the shipping exe: 146 word-sized accesses to `+0x26`
/`+0x28` exist across `.text`; filtering to a window containing `IplDef` arithmetic (`imul …,0x34`) or the
IplDef pool (`0x8E3FB0`) leaves **7**, of which two are WRITES (`0x156C498` `movw %cx,0x28(%eax)`,
`0x156C4BA` `movw %dx,0x26(%eax)` — the neighbourhood of the HOODLUM-relocated bodies, so check them
against `IncludeEntity`'s body at `0x1563730` before assuming) and one is another reader worth resolving
(`0x11D9316` `movswl 0x28(%edx),%eax`). **The filter is not yet trustworthy** — it did not retain the two
sites we know are IplDef reads (`0x404C0F`, `0x404C13`), so it is under-inclusive and must be widened
before its output is believed.

**Verification:** every surviving site is classified — IplDef or not — and the IplDef ones are either
covered by a detour or argued harmless in writing.

*Measured: —*

### Step 3 — coexistence probe at the dummy sites

004 found that **OLA**, not FLA, owns `0x404B4A`, and that FLA jmp-hooks all three building read sites with
5-byte `e9`s. Neither is documented for the dummy pass.

Read the live bytes at `0x404C0F`, `0x404C13` and `0x404C4E` on the reference install and record what is
there. **Verification:** the patch table's declared original bytes for the two detour sites match the real
install, or the coexistence rule for them is written down (defer, or overlay as 004 does for FLA).

*Measured: —*

### Step 4 — the sidecar and the observer

Widen `PmIncludeObserver` to record type 5 into `gFirstDummy/gLastDummy`, and `PmRemoveIplSnapshot` to
snapshot and reset that pair alongside the building one.

**Verification:** verify-only build (`make`, no `APPLY`) still reports every site clean; unit-level byte
tests on macOS still pass; the log shows dummy ranges accumulating per slot.

*Measured: —*

### Step 5 — the two detours

Write them into the patch table with declared original bytes, generated the way 004's are (self-contained,
hardcoding the relocated stock instruction, so identical code works over stock and over an adjuster's jmp).

**Verification:** `make APPLY=1` boots the real install; `perfect-map-asi.log` reports
`int16 APPLIED (dummies)`; the game reaches gameplay.

*Measured: —*

### Step 6 — the field ladder, against the deterministic repro

The oracle needs no synthetic build: the failure is already deterministic and quantified. At
`Dummys = 100000` the 6th world entry crashes today.

1. Set `Dummys = 100000`. Enter the world **eight** times (new game plus seven loads). **Pass:** no crash.
2. Set `Dummys = 40000` — under two permanent sets, so it must fail fast without the fix and hold with it.
   **Pass:** repeated entries survive.
3. Regression: the building half still holds (the ghost-barriers repro), and a stock/unmodded boot is
   unaffected.

**Verification:** all three. Then, and only then, drop the `Dummys` stopgap back to something sane and
record the value the install actually needs.

*Measured: —*

### Step 7 — record and retire

- Move the open issue to `docs/open-issues/fixed/` with the field verdict.
- Update the [patch catalogue](../patch-catalogue.md) row: the falsified assumption becomes the shipped fix.
- Update `docs/restrictions/sa-target.md` — the `IplDef.firstDummy/lastDummy` row changes from **NOT
  LIFTED** to lifted, and the `CPool<CDummy>` row gets the value the install ends on.
- Numbers into `docs/benchmarks/tools/` if the fix moves any measurable cost.

## Verification (acceptance for the whole plan)

- Repeated world entries no longer grow the dummy pool: the crash at `0x00538103` does not return at eight
  entries where six used to be fatal.
- The completeness scan is written down and every IplDef reader of `+0x26`/`+0x28` is accounted for.
- Both fixes are independently bisectable by flag; stock and unmodded installs boot unchanged.
- Nothing writes the engine's `IplDef` — the sidecar remains read-only with respect to engine state.

## Risks

- **004b may not be sufficient on its own.** It makes the range correct; it does not prove the entities are
  then freed. Step 1 is the gate: if the diagnostic shows no over-int16 dummy ids, the stranding has another
  cause and this plan is the wrong tool. The best evidence that it IS the cause is that **buildings do not
  leak** across the same world entries — and the building range in this same function is precisely what 004
  fixed.
- **The boot places the permanent set more than once.** `Dummys = 32767` dies during boot, above the 17 539
  the text IPLs hold, and `CIplStore::LoadIplBoundingBox` is a second path into `LoadObjectInstance` that
  frees nothing. Not pinned, not required for this plan, and worth pinning if step 6 comes back short.
- **`CColAccel`'s cache branch of `SetupRelatedIpls` overwrites a whole `IplDef` from disk** (`def =
  CColAccel::getIplDef(slot)`), dummy range included. If the collision cache is live on this install, a
  slot's range can arrive from a cache file rather than from `IncludeEntity` — which the sidecar would not
  have seen. Check before trusting step 6's result.
- Same standing constraints as 004: SA 1.0 US only, fixed image base, byte-verified sites, coexistence with
  OLA and FLA.
