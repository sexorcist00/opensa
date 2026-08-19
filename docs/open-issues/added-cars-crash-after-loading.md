# The added fleet's TUNING crashes at the end of loading — suspect: `shopping.dat`

**Open, 2026-08-19.** The cars themselves load and drive (field-proven: 115 added cars, a parked one
appears). Turning their TUNING back on crashes the game at the very end of loading, twice, identically.

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
| `perfect-vehicle.asi` (the `link` array) | loaded and applied, 31 pairs on OUR 256-entry storage; the crash is identical in shape to runs where it was OFF |
| FLA `Vehicle colors` / `Vehicle Models` | both tried, both reverted, neither related |

## The suspect

**`CShopping`'s fixed arrays.** The added parts clone shop entries, and the sections grew:

| section | stock | with the fleet |
| --- | --- | --- |
| `prices.CarMods` | 170 | **212** |
| `shops.carmod2` | 67 | **83** |
| `shops.carmod3` | 90 | **116** |

FLA has **no setting for any shopping limit**, so whatever the game's arrays are is what runs. The next test
was armed and not yet run: `shopping.dat` stripped back to 174/71/90 (the pre-added-fleet state, which
includes 4 rows the blade and slamvan have always contributed) with the rest of the tuning left in place.

## What to do next

1. Run that test. If it boots, the ceiling is `CShopping`'s — then RE the arrays the way
   `asi/perfect-vehicle` plan 001 did the carmods pair (they are neighbours in the same subsystem), record it
   in `docs/gta-sa-original/`, and decide: lift it in the plugin, or stop cloning shop entries and let an
   added car's parts be bought through its base's menu.
2. If it still crashes, the remaining variables are the 46 `veh_mods.ide` rows and the 65 `carmods` lines —
   split those next. Note the one place where the two roads are mixed: a part's DATA row is baked in
   `veh_mods.ide` while its MODEL is loose in `modloader/added-vehicles/`. A row with no model is exactly the
   kind of thing that leaves a null where a pointer is expected.

## Where the state is

The bottle is left with the test armed (shopping stripped, everything else on). The built tree
`build/original/sa` carries the FULL fleet including the shop entries — it is the reference, not the bottle.
