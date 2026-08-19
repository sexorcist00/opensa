# 004 — Traffic: the car as a ModelVariations variation of its base

**Status: PLANNED 2026-08-19.** Why an added car is ever seen without a cheat: ModelVariations 10.7 (mod 11,
`sa` layer) swaps a spawning stock car for one of the ids listed in its section. The merge is 012's
(`model-variations.ts`); this plan decides what to write and reads the user's old output for the shape.

## The shape (from the old build, `modloader/Model_Variations/ModelVariations_Vehicles.ini`)

```
### manana
[<mananaId>]
Global=<mananaId>,<001vehId>[,<otherAddedId>…]
```

One section per BASE slot, keyed by the base's ID (the mod accepts ids and names; the old build used ids),
`Global` = the base itself first (so stock still spawns) then every added car naming it. A car with several
`(base1, base2)` appears in each. `model-variations-extra.txt` blocks (trailers, siblings — with `{{name}}`
resolved to the ADDED slot's freshly allocated id when the name is an added slot, or the stock id otherwise)
merge as their own sections; 006 (tuned traffic) adds the `TuningFullBodykit`/`TuningChance` keys to the same
base sections — the section merge is by name, so the two plans compose without order.

## Steps

1. Build the per-base `Global` lists from the ledger (slot → id, bases) and merge each `[<baseId>]` section
   through 012's merge: `Global` is REPLACED with `<baseId>` + the sorted added ids; any other key in the
   section is kept (006's, the author's `Trailers*`). Idempotent.
2. `model-variations-extra.txt` per car → 012's merge with the `{{name}}` resolver fed the ledger first and
   the built IDEs second; an unresolved name is logged and left as authored.
3. Refuse — naming the mod — when `modloader/Model_Variations/ModelVariations_Vehicles.ini` is not in the
   built tree: an added car that nothing spawns is a car nobody will ever see, and that should not be
   silent.
4. Tests — the section composition with 006's keys present, multiple bases, `{{name}}` to an added id, the
   refusal.
5. Field — drive the base's neighbourhood (manana spawns in the poor-family groups): the Vega appears;
   `rdtrain` pulls its authored trailer set.

## Measured

*—*
