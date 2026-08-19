# perfect-vehicle ASI — plan chain

| # | plan | what | status |
| --- | --- | --- | --- |
| 1 | [001 — RE: the two carmods ceilings](001-re-carmods-ceilings.md) | every access site of `CLinkedUpgradeList` (30) and `CVehicleModelInfo::m_anUpgrades` (18), original bytes, coexistence bytes under FLA + OLA, the catalogue | planned |
| 2 | [002 — Lift: relocate + enlarge](002-lift-patches.md) | 004-style relocation of both arrays behind two flags, the exe-fixture byte test, the field ladder (31 links, 17 parts) | planned |

Part of [central plan 102](../../../../docs/plans/102-add-vehicles/readme.md). 001 can start any time; 002
ships before `tools/add-vehicles` 005 may exceed the guards. Toolchain, framework and method are perfect-map
002/003/004's — nothing here re-derives them.
