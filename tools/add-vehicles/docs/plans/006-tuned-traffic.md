# 006 — Tuned traffic for every stock car

**Status: PLANNED 2026-08-19 — the user's YES.** The other half of what the old tool wrote into
`ModelVariations_Vehicles.ini`: for every stock car that has paintjobs or tuning parts, a section that lets
ModelVariations spawn it tuned:

```
[blade]
Global=536,paintjob1,paintjob2,paintjob3,paintjob4,bnt_b_lr_bl,exh_lr_bl1,…,wg_r_lr_bl1
TuningFullBodykit=1
TuningChance=75
ChangeOnlyParked=0
```

Derived, not authored: `Global` = the car's own id, `paintjobN` for each `<slot>N.txd` the built archive
holds for the slot, then every part on the car's `carmods.dat` line (stock or replacement — read off the
BUILT file, so a replacement car with a different bodykit gets ITS parts); the three keys are the tool's
defaults, overridable from a small config (`TuningChance`, `TuningFullBodykit`, `ChangeOnlyParked`) so the
user tunes the feel without touching code. A base section that 004 also writes gets BOTH: `Global` carries
the added ids AND the paintjobs/parts (the old build's sections show exactly this union).

## Steps

1. A pure builder: (slot, id, paintjob count, carmods line) → section; the merge is 012's.
2. Config: `add-vehicles.json` in the source root (optional) with the three defaults and an `exclude` list
   (the mod's own `ExcludeModelsFromInheritance` exists for the same reason — police, emergency, trains).
3. Composition test with 004 (one section, both sets of keys); idempotence.
4. Field: traffic shows tuned stock cars at roughly the configured rate; the config change is visible on the
   next run without a rebuild of anything else (it is an ini merge).

## Measured

*—*
