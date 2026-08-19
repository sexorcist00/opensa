# add-vehicles

Installs **ADDED** GTA-SA vehicles — cars on model ids the game never had — from
`mods-src/<game>/add-vehicles` into a BUILT `sa` tree. **Original SA only**: everything that makes an added
car work is a plugin of the real game (ModelVariations for traffic, FLA's vehicle audio loader for sound,
Parked Maker for parking, CLEO's FXT loader for the name), and our own engine has none of them.

An added car is a replacement car **plus an id** plus what a stock slot otherwise gets for free. So this
tool owns only what is specific to a new id; every merge that writes a file the install reads lives once, in
`@opensa/vehicle-installer`, and is called from here. The chain, the shared-layer table and the research are
[central plan 102](../../docs/plans/102-add-vehicles/readme.md); this tool's own steps are
[docs/plans](docs/plans/readme.md).

```bash
# What the root holds and what each car varies (plan 001 — the install itself is plan 002)
npx tsx tools/add-vehicles/src/cli.ts --game build/original/sa
npx tsx tools/add-vehicles/src/cli.ts --game build/original/sa --in mods-src/original/add-vehicles --only 001veh
```

## The source

`mods-src/<game>/add-vehicles` is a second vehicles ROOT with the same grammar as the replacement fleet's —
flat, or `models/` overridden per slot by `new/`, or layered — read through the ONE resolver
(`@opensa/tool-kit/vehicles-dir`), so both fleets are planned by the same rules and the same refusals.
`screenshots/` and `reserved/` are reserved names and never scanned.

The folder name carries one field the replacement fleet's does not: a parenthesised **base**, the stock slot
the car is a variation of (`001veh - 1971 Chevrolet Vega - alfamodding (manana)`). It is what the car
inherits its sound from, whose tuning parts it re-models, and whose place in traffic it appears in. A base
no `vehicles.ide` row defines is refused, naming the folder — a mistyped base is otherwise a car that
silently never enters traffic. Contract: `docs/contracts/vehicles.md` §1b.

## Status

Plan 001 is built: the source root, the resolver, the base validation and the CLI's shape. Ids, rows and the
archive are 002; name/sound/parking 003; traffic 004; derived tuning parts 005; tuned traffic 006; the pmb
stage and the field round 007.
