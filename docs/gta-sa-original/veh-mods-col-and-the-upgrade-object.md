# A tuning part is created as an OBJECT, and an object needs collision — `veh_mods.col`

**Measured 2026-08-19** from the shipping `gta_sa.exe` (1.0 US), two field crashes and the archives of a real
install. A fact about the original game, not about OpenSA.

## The crash

Previewing a NEW tuning part (one the stock game does not ship) kills the game:

```
Unhandled exception at 0x0059F8B4: 0xC0000005: reading location 0x00000029
ECX = the part's model id      EDI = 0x00000000
```

The code says the whole thing:

```
59f8a6:  movsx ecx, WORD PTR [esi+0x22]        ; the object's model index
59f8aa:  mov   edx, DWORD PTR [ecx*4+0xa9b0c8] ; CModelInfo::ms_modelInfoPtrs[id]
59f8b1:  mov   edi, DWORD PTR [edx+0x14]       ; CBaseModelInfo::m_pColModel  <-- NULL
59f8b4:  mov   al,  BYTE PTR [edi+0x29]        ; faults at 0x29
```

`edx` is valid (the model info exists — the caller has already written `m_nAlpha` at `+0xC`), `edi` is not:
**the model has no collision model.** The caller is the part-preview path, which reaches the ordinary
`CObject` constructor (`0x5A1F60`) through `0x4697A0`:

```
469778:  mov eax, ds:0xa43c78     ; the selected item: >= 0 IS a model id, < 0 indexes a 0x1c-byte table
46977f:  jge 0x46978d             ; taken for a model id -- NO range check of any kind
469797:  mov BYTE PTR [ebx+0xc],0xff
46979b:  call 0x5a1f60            ; new CObject(modelId, false)
```

## Where a stock part's collision comes from

**`gta3.img` carries `veh_mods.col`** — and it holds **exactly one entry per stock tuning part: 194 entries,
model ids 1000–1193**, which is the whole stock upgrade block of `data/maps/veh_mods/veh_mods.ide`. Nothing
else has one:

| | |
| --- | --- |
| any tuning part `.dff` (stock or mod) | **no embedded collision** — checked across the stock parts, a mod's parts and our derived ones: not one carries a `Collision Model PLG` chunk |
| `models/coll/vehicles.col` | 1 096 bytes, ONE entry (`airtrain`) — not this |
| `gta3.img : veh_mods.col` | 24 576 bytes, **194 entries, ids 1000–1193** — this |

So a part the stock game ships has collision; a part anybody ADDS does not, and the preview path does not
check.

## The flag that appears to excuse it

Our added fleet derives ~46 tuning parts of its own, none of which has a `veh_mods.col` entry either, and
they do NOT crash. The only thing that separates them is the IDE flags column:

| part | flags | in `veh_mods.col` | crashes |
| --- | --- | --- | --- |
| a mod's new part written by hand (`spl_b_lr_bl`, `bnt_b_lr_bl`) | **0** | no | **yes** |
| our derived parts (`exh_lr_rem1_059veh`, …) | **2097152** (`0x200000`), some `2101248` | no | no |
| every stock part | 0 / 4096 / 2097152 / 2101248 | **yes** | no |

`0x200000` is inherited by a derived part from the stock part it is derived from, which is why the fleet
survived by accident. **The reading — a part with no collision entry must carry `0x200000`** — is consistent
with every row measured but is NOT yet confirmed against the exe's own use of the flag.

**The full census, 2026-08-20** (`assertUpgradeCollision`, a static read of the built tree against the col's
194 entry names): stock `game-src/original` is **clean**, and `build/original/sa` had **seven** rows with
neither an entry nor the flag — not the two this file predicted:

| part | id | flags | where it came from |
| --- | ---: | ---: | --- |
| `spl_b_lr_bl`, `bnt_b_lr_bl` | 1194, 1195 | `0` | the blade mod's hand-written `tuning_new_parts.txt` |
| `fbmp_lr_t1_072veh`, `fbmp_lr_t2_072veh`, `rbmp_lr_t1_072veh` | 19074–19076 | `4096` | derived from the tornado's parts |
| `wg_l_lr_t1_072veh`, `wg_r_lr_t1_072veh` | 19077, 19078 | `0` | derived from the tornado's parts |

Every one of the five derived rows inherited the gap from a stock tornado part, which carries `4096` or `0`
— so the outstanding control is five parts wider than "two rows written by hand".

## What it means for a tool

A tool that writes a NEW tuning part row cannot leave this to the mod author. The check is static and needs
no field round: read every `objs` row of the built `veh_mods.ide`, read the entry names of `veh_mods.col`
inside `gta3.img`, and for every row with no entry require the flag. The id does not matter — this was
tested in the field by moving both parts to 19701/19702, and the crash moved with them (`ECX = 0x4CF5`).

**Built 2026-08-20** (`vehicle-installer` 014 step 5): `withNoColFlag` forces the flag into every row either
writer emits outside the stock block — an author cannot be expected to know it, and a derived row inherits
whatever the part it was cloned from carried — and `assertUpgradeCollision` runs the check above at the end
of both `install` and `add-vehicles`, refusing the build and naming every offending row. It reads the col
entry through the archive index, so it slices one entry off a file handle rather than buffering gigabytes.
Setting the flag rather than knowing what it means is recorded as
[`docs/hacks/upgrade-part-no-collision-flag.md`](../hacks/upgrade-part-no-collision-flag.md).

Neighbours: [`carmods-upgrade-ceilings.md`](carmods-upgrade-ceilings.md) (what a part NAME must look like and
how many a car may have), [`carmods-unknown-part-crash.md`](carmods-unknown-part-crash.md) (a `carmods.dat`
token with no IDE row at all), [`rw-frame-list-parent-order.md`](rw-frame-list-parent-order.md) (the OTHER
crash the blade's parts caused, and the reason this one was masked for a session).
