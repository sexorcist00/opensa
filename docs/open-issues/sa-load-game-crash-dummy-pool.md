# Crash on LOAD GAME: the dummy pool fills up and `RemoveIpl` cannot empty it

**Field 2026-08-19.** Symptom: the game boots and plays fine; loading a save works; loading a **second**
time crashes. Cause found the same day, and the field's own workaround confirms it. **Not fixed** — the
workaround moves the wall, it does not remove it.

## The crash itself — proven, not inferred

`logs/gta_sa.exe_2026-08-18_21-12-24.log`:

```
Unhandled exception at 0x00538103 in gta_sa.exe (+0x138103): 0xC0000005: Access violation reading location 0x00000000.
    ESI: 0x00000000
```

`0x538090` is `CFileLoader::LoadObjectInstance`. Disassembled out of the install's own `gta_sa.exe`:

```
5380db  cmpw  %bx, 0x10(%ebp)   ; mi->m_nObjectInfoIndex == -1 ?
5380df  je    0x538146          ;   -1 → the CBuilding branch
5380e1  pushl $0x38             ;   else: operator new(56) — sizeof(CDummyObject)
5380e3  calll 0x5326e0          ;   the pool allocator
5380ef  cmpl  %esi, %eax        ;   returned NULL?  (esi = 0)
5380f5  je    0x538100          ;   YES → jump PAST the constructor, esi stays 0
538100  movl  0x1c(%edi), %eax
538103  movl  (%esi), %edx      ;   <-- read through the null it just accepted
```

`CPool<CDummy>` was empty, the allocator returned null, and SA used it without a check. Nothing subtle:
the exhaustion is the whole story, and the register dump matches term for term.

## Why it is OUR crash and not a 2004 one

Every `inst` row of a tree, split by whether the model has an `object.dat` entry (that is exactly the
`m_nObjectInfoIndex == -1` branch above — a dynamic object becomes a `CDummyObject`, everything else a
`CBuilding`):

| | rows | → `CPool<CBuilding>` | → `CPool<CDummy>` |
| --- | ---: | ---: | ---: |
| **stock SA** (`game-src/original`, text IPLs) | 9 268 | 9 228 | **40** |
| **our `sa` build**, text IPLs (permanent) | 127 384 | 109 845 | **17 539** |
| our `sa` build, binary IPLs (streamed) | 40 200 | 35 351 | 4 849 |

**Stock places 40 dummies. We place 17 539 — 438×.** 17 311 of them are the procobj bake in
`plobj0..9`: eleven models, all scattered vegetation and rock.

```
3446 sand_josh2   3357 sand_josh1   2005 elmdead_po   1551 cedar1_po   1509 cedar3_po
1478 cedar2_po    1015 sm_fir_scabg_po   1010 rockbrkq   985 pinebg_po   942 ash_po   13 sjmcacti2
```

So the class is invisible in stock and in any ordinary mod install — stock could re-enter the world sixty
times against its 2 500-entry pool. Ours cannot re-enter it three times.

## The count grows per world entry — and the arithmetic is exact

The field sequence was: new game (fine) → load a save (fine) → load again (**crash**). Three entries into
the world, against `Dummys = 50000`:

| world entry | dummies held, if none are released | pool |
| ---: | ---: | --- |
| 1 (new game) | 17 539 | fits |
| 2 (first load) | 35 078 | fits |
| 3 (second load) | **52 617** | **over 50 000 → crash** |

`CWorld::ClearForRestart` (0x564360) supports this directly: it deletes only `Peds` and `Vehicles` out of
the repeat sectors. Buildings and Dummies are not in its list.

## The reason they cannot be released: `IplDef`'s dummy range is still int16 — by our own decision

`RemoveIpl` (0x404B20) is the function that frees what an IPL placed, and it frees dummies by walking a
pool-index range stored in the IPL's own `IplDef`:

```cpp
ProcessPool(*GetBuildingPool(), def->firstBuilding, def->lastBuilding);
ProcessPool(*GetObjectPool(),   0,                  GetObjectPool()->GetSize());
ProcessPool(*GetDummyPool(),    def->firstDummy,    def->lastDummy);   // <-- int16 @0x26 / @0x28
```

`IplDef` is `0x34` bytes with `firstBuilding`@0x22, `lastBuilding`@0x24, **`firstDummy`@0x26,
`lastDummy`@0x28 — all `int16`**. `perfect-map.asi` lifts the **building** pair into an int32 sidecar and
deliberately leaves the dummy pair. Our own note, `asi/perfect-map/docs/patch-catalogue.md`:

> `dummies` don't overflow in practice (diagnosed live — no over-int16 dummies), so `firstDummy/lastDummy`
> are left alone (**004b if ever needed**).

**That assumption is now false, and this is 004b's trigger arriving.** Any dummy sitting at pool index
above 32 767 has an index that does not fit the field that records it, so `RemoveIpl` walks the wrong range
and never deletes it. The ceiling is on the POOL INDEX, not on our row count — so it bites as soon as the
pool is used past 32 768, whatever `Dummys` is set to.

## What the field workaround actually bought

`Dummys` was raised 50 000 → 100 000 and the symptom went away. It is a **postponement**, and the numbers
said by how much before it was tested: at 17 539 per world entry, 100 000 holds five entries and the
**sixth** must crash (105 234). The int16 ceiling at 32 767 is untouched — the raise simply hands the leak
67 232 more slots to fill.

**FIELD-CONFIRMED 2026-08-19: the sixth LOAD GAME crashed, same address.** So the leak rate is not an
estimate any more — it is 17 539 dummies per world entry, exactly the permanent set, and the pool size buys
`floor(Dummys / 17539)` entries per boot and nothing else.

## What would actually fix it, in order of honesty

1. **004b — extend the existing int32 sidecar to `firstDummy`/`lastDummy`.** The catalogue already says
   they are "the same shape", and the exe agrees exactly: the dummy pass reads its bounds at **three**
   sites, mirroring the building pass site for site —

   | | first | last | last, re-read on the loop back-edge |
   | --- | --- | --- | --- |
   | buildings (patched) | `0x404B4A` `movswl 0x22(%ebx),%edi` | `0x404B5D` `movswl 0x24(%ebx),%edx` | `0x404BA8` `movswl 0x24(%ebx),%edx` |
   | dummies (**not** patched) | `0x404C0F` `movswl 0x26(%ebx),%edi` | `0x404C13` `movswl 0x28(%ebx),%ecx` | `0x404C4E` `movswl 0x28(%ebx),%eax` |

   The third column is the one the building work nearly missed — a detour set that skips the back-edge
   re-read stops deleting after ONE entity. `IncludeEntity` also has to mirror the dummy pool-index range
   into the sidecar as it already does the building one. ASI work: a Windows build and a field bracket.
2. **Find out why a world entry does not release the previous one's dummies at all.** Step 1 makes the
   release possible; it does not prove it happens. `CWorld::ClearForRestart` not touching them is the
   lead.
3. **Reduce the demand.** 17 311 of 17 539 dummies are the procobj bake. Whether that layer has to be
   permanent `inst` rows of `object.dat` models is a design question nobody has asked yet — it is the
   difference between a 438× and a 1× multiple of stock.

## The build guard that would have printed this

`installRequirements` (`tools/perfect-map-builder/src/pipeline.ts`) prices `census.rows` — **every** text-IPL
row — against `CPool<CBuilding>`. Wrong in three ways, all silent:

- it counts the 17 539 dummy rows as buildings;
- it has **no `CPool<CDummy>` row at all** — the pool that blew is absent from the requirements table;
- it ignores binary IPLs, so it reports a 127 384 peak where the real worst case is 145 196 buildings
  (against `Buildings = 150000` — **3.2 % of headroom**, which nobody has looked at either).

Splitting the census by object-info index and adding both a `Dummys` row and the int16 dummy-index ceiling
would have printed the whole of this on every build.

## Delivery hazard

`Dummys = 100000` is set in the bottle **and** in `mods-src/original/mods/sa/5. Open Limit Adjuster 1.6.1/`,
so a rebuild carries it. **The currently built tree (`build/original/sa`, 2026-08-17) still has 50 000** — a
whole-tree-root delivery from it would put the crash straight back, the same way session 26's delivery
reverted the FLA pools
([fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md](fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md)).
Rebuild before the next full delivery.

## Reproduction material

- crash log: `<bottle>/GTA San Andreas/logs/gta_sa.exe_2026-08-18_21-12-24.log`
- the address database that agreed independently: `CrashList.txt`, entry `0x00538103`
- the census reproduces from a built tree alone: `data/object.dat` + `gta.dat`'s IDE/IPL lists + the binary
  IPLs in the IMGs (`instOffset` @0x1C — `packages/renderware/src/parsers/text/ipl-binary.parser.ts`)
- disassembly: `/Library/Developer/CommandLineTools/usr/bin/llvm-objdump -d --start-address=0x538090 --stop-address=0x538150 gta_sa.exe` (it reads PE/COFF)
