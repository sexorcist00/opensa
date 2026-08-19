# The added fleet's TUNING crashes at the end of loading

**Open, 2026-08-19** (three runs, `shopping.dat` cleared as the suspect in the third). The cars themselves
load and drive (field-proven: 115 added cars, a parked one appears). Turning their TUNING back on crashes the
game at the very end of loading — three times now, byte-identically.

## What the crash says

```
Unhandled exception at 0x40B30890 in gta_sa.exe: 0xC0000005: reading location 0x40B30890
EDI: 0x000004FD   EBP: 0x009789C4   (stack: 0x83D326, 0x456878, 0x457332, 0x47E63B, 0x47D415, 0x4693D8)
```

`0x40B30890` is outside the image — **execution jumped through a corrupted pointer**, which is the signature
of a fixed-size array being written past. The frame is `CPickups` (`0x9788C4` is `aPickUps`; `EDI = 1277` is
`pickupsave`, the save icon) — pickups are simply the first thing that walks over the corrupted memory at the
end of loading, not the cause.

Reproduced **byte-identically twice**, with ModelVariations present and then stripped — so MV is excluded and
the cause is inside the tuning half.

## What has been excluded

| | |
| --- | --- |
| the cars themselves (ide + handling rows, models, carcols, parked) | **loads and drives** |
| ModelVariations sections + tuned traffic | same crash with and without → excluded |
| **`shopping.dat`** | **EXCLUDED 2026-08-19 (run 3)** — stripped to 174/71/90, same crash byte-identically |
| both `carmods.dat` ceilings | measured on the built tree: per-car max **15** listed parts against the 16 the array allows, link list **31** pairs on `perfect-vehicle`'s 256-entry storage (`links APPLIED: 256 pairs` in its log) |
| model `1277` itself | `pickupsave` in `data/maps/generic/dynamic.ide`, row intact — the pickup is the victim, not the cause |
| a `veh_mods.ide` row with no model | all 48 added rows resolve; the two that looked missing (`1194 spl_b_lr_bl`, `1195 bnt_b_lr_bl`, the blade mod's parts) are in `models/vehicles2.img` |
| `perfect-vehicle.asi` (the `link` array) | loaded and applied; the crash is identical in shape to runs where it was OFF |
| FLA `Vehicle Models` | tried, reverted, unrelated |

### Run 3 — 2026-08-19 18:53, `shopping.dat` stripped

`logs/gta_sa.exe_2026-08-19_18-54-13.log`. Identical to runs 1 and 2 in every register that is not a heap
address: `EIP 0x40B30890`, `EDI 0x000004FD`, `EBP 0x009789C4`, same six stack frames. Only `EAX`/`EDX`/`ESI`
moved (`0x0CF80B64` → `0x0D050B64`).

The frames, disassembled against `fixtures/original/gta_sa.exe`:

| frame | what it is |
| --- | --- |
| `0x457332` | `lea ebp,[esi+0x9788C4]` = `CPickups::aPickUps`, then `call 0x4567E0` with the slot |
| `0x456878` | inside it: `movzx edx,WORD PTR [edi+0x18]` (the model id) → `call 0x5A1F20/0x5A1F60` — the pickup's `CObject` is being built |
| `=> 0x40B30890` | the call target itself, outside the image — a **jump through a pointer that is already garbage** |

So a structure the object constructor walks is corrupt before pickups ever touch it. Pickups are simply the
first pass at the end of loading that walks it.

## The live confounder found while reading this run's log — `Vehicle colors = 256`

FLA's log of run 3 closes with `Number of memory changes made: **3834**`, not the 3712 recorded as this
install's healthy line, and it carries
`Vehicle colours limit is over 255 … Applying colour ID uint32_t patches`.

**The setting is on, in `mods-src`, in `build/original/sa` and in the bottle.** It was set deliberately
earlier the same day (the built palette is 142 `col` rows against FLA's annotated 128) and then written up
in two docs as "tried and reverted", which it never was. Both docs are corrected. It is applied in the boots
that WORK as well as in the ones that crash — so it is not the top suspect, but it has never had a field
verdict of its own and it is not an excluded variable.

## The guard that has gone blind

`npx tsx scripts/debug/carmods-check.ts` now reports **65 failures on a healthy tree** — every added car's own
`[mods]` line, e.g. `'001veh' in "001veh, nto_b_l, …"`. The cars' IDE rows moved to
`modloader/added-vehicles/<slot>.settings.txt`, and the checker only reads `.ide` files under `data/`. Either
it learns to read Mod Loader's readme rows, or the guard is permanently red and stops being read — which is
how the crash class it exists to catch gets shipped. Fix it in the same change as the next add-vehicles step.

## What to do next

1. **The test armed in the bottle now** (2026-08-19, session 30): `shopping.dat` restored to the full
   212/83/116 and the **65 added `[mods]` lines stripped from `data/carmods.dat`** — one variable against the
   full crashing configuration. The `veh_mods.ide` rows, the parts' models and the shop entries all stay.
   Backup of the full file: `data/_bisect-backup/carmods.dat.full`.
   - **boots** → the cause is in the carmods lines themselves, and the remaining split is per-line: the
     `nto_b_*` nitro triple every added car carries, versus the derived parts of the 9 cars that have them.
   - **still crashes** → carmods is out too, and what is left standing is the 46 `veh_mods.ide` rows and the
     colour patch family above. Strip the `veh_mods.ide` rows next, then `Vehicle colors`.
2. Whatever the verdict, it goes into `docs/plans/102-add-vehicles/field-checks.md` with the run's log name.

## Where the state is

The bottle carries the armed test above. The built tree `build/original/sa` is the reference and is
unchanged — it carries the FULL fleet, the full `shopping.dat` and the full `carmods.dat`.
