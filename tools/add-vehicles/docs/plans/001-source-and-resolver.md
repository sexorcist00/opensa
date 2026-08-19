# 001 — Source root and resolver

**Status: PLANNED 2026-08-19.** Where added cars live, how every tool finds them, and the one new name in the
folder convention.

## The source (already authored by the user)

`mods-src/original/add-vehicles/` — `models/` (115 folders) + `screenshots/` (115 pictures); a `reserved/`
folder is temporary and is NOT read (it is a stray by the resolver's rules — see below). Each car folder is
`vehicle-installer`'s shape plus up to six optional files:

```
001veh - 1971 Chevrolet Vega - alfamodding (manana)
  001veh.dff  001veh.txd  [001veh1..4.txd]
  001veh.settings.txt            ← ide line with `<:id>`, handling, carcols, carmods blocks
  [features.txt] [audio.txt] [parked.txt] [text.txt] [model-variations-extra.txt] [tuning_new_parts.txt]
  [<stock part name>.dff …]      ← the BASE slot's tuning parts, re-modelled (005)
```

The folder name is `<slot> - <what it is> - <author> (<base>[, <base2>…])`: the FIRST field is the new
slot (`001veh`, ≤ 7 chars so it can also be the GXT key `001VEH`), the LAST field ends in a parenthesised
list of STOCK slots — the base the car is a variation of. Every `(base)` in the 115 is a stock slot; the
first is "the" base (audio inheritance, tuning parts), the rest are additional traffic parents (004).

## Steps

1. **`resolveVehicleSources` takes a ROOT, not a folder name.** Today it reads `mods-src/<game>/vehicles`;
   it gains an `add-vehicles` root with the SAME grammar (flat / `models/`+`new/` / layered `common|sa|opensa`,
   the same refusals for stray and mis-cased folders, `screenshots/` per layer). One rule differs and is
   stated in code: a layered `add-vehicles` tree refuses `common/` and `opensa/` (SA-only feature) — the
   target is `sa` or nothing. `reserved/` is refused as a stray until the user removes it; the refusal
   message says which folder.
2. **`parseVehicleSlot` learns the `(base)` suffix** — returns `{ slot, bases }`; absent = `bases: []`,
   which is today's behaviour for `vehicles/` (harmless there). A `(base)` naming a slot the built tree's
   `vehicles.ide` does not have → refused, naming both (a mistyped base is a car that never enters traffic,
   silently, otherwise).
3. **`tools/add-vehicles` skeleton** — package, `cli.ts` (`add-vehicles --game <built sa tree> --in
   <root> --out <tree> [--only <slot>…] [--target sa]`), `install.ts` Node API the pipeline calls, the
   ledger name `data/vehicle-adds.txt`; depends on `@opensa/vehicle-installer` + `@opensa/tool-kit`; no
   merge code of its own.
4. **Contract** — `docs/contracts/vehicles.md`: a new §1b "an ADDED vehicle folder": the root, the slot
   rules, the `(base)` suffix, the optional files (each pointing at the plan that reads it), and for each
   name what a misspelling does. `docs/restrictions/architecture.md` "one source folder, one reader" gains
   the second root in its sentence.
5. **Tests** — resolver: the new root, the SA-only layer refusal, `(base)` parse + unknown-base refusal,
   `reserved/` as a stray; all negative first.

## Measured

*—*
