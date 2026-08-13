# vehicle-cutscene

**Status: plan 002 steps 1–8 shipped, both car field gates PASSED (2026-08-12) — the whole car fleet
converts and the intro cutscenes field-verified against vanilla; the bike branch shipped 2026-08-13
(22/22 converted, field verdict pending via scene STRP4B2). Remaining: the boat branch, the
full-fleet numbers, pipeline integration ([002](docs/plans/002-implementation.md) steps 9–11) and the
[plate bake](docs/plans/003-plate-bake.md).**

Converts installed **vehicle mods** into their **cutscene counterparts** — the `cs*` models in
`models/cutscene.img` — so the real game's cutscenes show the same custom cars the player drives.
23 cutscene vehicle models across 21 `vehicles.ide` slots (cars + one bike + one boat), each rebuilt from
the mod's gameplay DFF by frame surgery: flattened rig, HAnim skeleton with the vanilla model's bone ids,
four instantiated wheels, baked carcols paint, empty `txdp`-resolved TXD.

```bash
# census + readiness report (writes nothing):
npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in mods-src/original/vehicles --inspect

# convert the fleet into an output game (--self-contained-txd embeds mod TXDs for a stock-gameplay target):
npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in mods-src/original/vehicles --out <dir>
```

- [001 — architecture + research record](docs/plans/001-architecture.md) (the census, the rig contract,
  the decisions)
- [002 — implementation](docs/plans/002-implementation.md) (prioritized steps, field gates)
- [003 — plate bake](docs/plans/003-plate-bake.md) (readable cutscene license plates — vanilla shows blanks)
