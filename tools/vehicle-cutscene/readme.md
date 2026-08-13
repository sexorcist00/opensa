# vehicle-cutscene

**Status: plans 002 (steps 1–10 + the step-11 wiring) and 003 are DONE — both car gates PASSED
(2026-08-12), the bike branch FIELD-PASSED first round (2026-08-13, scene STRP4B2), the boat branch
structurally verified (no stock scene plays csdinghy — the named gap), the full 23-model fleet
converts with 0 errors in ~3.5 s
([numbers](../../docs/benchmarks/tools/2026-08-13-vehicle-cutscene-fleet.md)), the tool runs as
pmb's `cutscene` stage, and the [plate bake](docs/plans/003-plate-bake.md) FIELD-PASSED first round
(2026-08-13) — cutscene cars now carry readable plates where vanilla shows blanks. Remaining: the
[full scene field review](docs/plans/004-full-scene-field-review.md) (all 35 vehicle scenes → the
user's approval) and the step-11 full-pipeline field acceptance
([002](docs/plans/002-implementation.md)).**

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
- [004 — full scene field review](docs/plans/004-full-scene-field-review.md) (all 35 vehicle scenes swept
  via the override → per-scene verdicts → the user's approval)
