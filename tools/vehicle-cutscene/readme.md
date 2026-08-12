# vehicle-cutscene

**Status: step 1 shipped (census + `--inspect`); conversion lands in [plan 002](docs/plans/002-implementation.md) steps 2+.**

Converts installed **vehicle mods** into their **cutscene counterparts** — the `cs*` models in
`models/cutscene.img` — so the real game's cutscenes show the same custom cars the player drives.
23 cutscene vehicle models across 21 `vehicles.ide` slots (cars + one bike + one boat), each rebuilt from
the mod's gameplay DFF by frame surgery: flattened rig, HAnim skeleton with the vanilla model's bone ids,
four instantiated wheels, baked carcols paint, empty `txdp`-resolved TXD.

```bash
# census + readiness report (writes nothing):
npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in mods-src/original/vehicles --inspect

# conversion (steps 2+, not implemented yet):
npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original --in mods-src/original/vehicles --out <dir>
```

- [001 — architecture + research record](docs/plans/001-architecture.md) (the census, the rig contract,
  the decisions)
- [002 — implementation](docs/plans/002-implementation.md) (prioritized steps, field gates)
