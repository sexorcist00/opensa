# perfect-vehicle ASI

**Planned 2026-08-19, no code yet.** Our own engine-patch for real GTA:SA 1.0 US that lifts the VEHICLE-side
ceilings no adjuster has a setting for — first the two `carmods.dat` arrays that `tools/add-vehicles` runs
into (30 `link` pairs game-wide, 16 tuning parts per car); later whatever the added-car work meets next
(car generators, train carriages). A consumer of [`asi/sdk`](../sdk/README.md) like
[perfect-map](../perfect-map/README.md) and perfect-cutscene: the same fingerprint gate, catalogue, byte
verify, live-byte coexistence probe, and the exe-fixture test that reads every declared site back off
`gta_sa.exe`.

Plans: [docs/plans/](docs/plans/readme.md). The measurement that opened it:
[`docs/gta-sa-original/carmods-upgrade-ceilings.md`](../../docs/gta-sa-original/carmods-upgrade-ceilings.md);
the rule: [`docs/restrictions/sa-target.md`](../../docs/restrictions/sa-target.md); the consumer:
[`tools/add-vehicles`](../../tools/add-vehicles/docs/plans/readme.md) plan 005, whose guards name this plugin.
