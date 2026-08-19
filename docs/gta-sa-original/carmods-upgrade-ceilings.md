# `carmods.dat` has two fixed-size ceilings, and neither is checked

**Read out of gta-reversed 2026-08-19** (`Models/VehicleModelInfo.{h,cpp}` — `CVehicleModelInfo::LoadVehicleUpgrades`,
`CLinkedUpgradeList`), measured on stock `data/carmods.dat`, on our built tree and on the user's earlier
added-vehicles build. A fact about the original game; the rule it imposes on a design is in
[`docs/restrictions/sa-target.md`](../restrictions/sa-target.md).

| structure | size | what fills it | stock | `build/original/sa` | the old added-cars build |
| --- | --- | --- | --- | --- | --- |
| `CVehicleModelInfo::ms_linkedUpgrades` (`CLinkedUpgradeList` @ `0xB4E6D8`): `int16 m_anUpgrade1[30]`, `int16 m_anUpgrade2[30]`, `uint32 m_nLinksCount` | **30 pairs, game-wide** | every line of the `link` section (`wg_l_lr_rem1, wg_r_lr_rem1`) — `AddUpgradeLink` writes `[m_nLinksCount++]` with no bound | **23** | 23 | **30 — exactly full** (23 + 7 added wing pairs) |
| `CVehicleModelInfo::m_anUpgrades` — `int16[18]` per vehicle | **18 per car** | the car's `mods` line, THEN `hydralics` and `stereo` appended unconditionally → **≤ 16 listed parts** | `jester` 16 (full) | 15 max | 16 |

Past either, the write goes into whatever follows the array — `m_nLinksCount` itself for the link list,
the next fields of the model info for the per-car array. Nothing reports it; the symptom arrives later,
wherever the clobbered memory is read. Neither FLA nor OLA has a setting for them (FLA's `Collision links`
is unrelated).

Two more facts the same loader imposes on a part NAME: `CAtomicModelInfo::SetupVehicleUpgradeFlags(name)`
derives the component's flags FROM THE NAME PREFIX (`exh_`, `wg_l_`, `wg_r_`, `spl_`, `rf_`, `fbmp_`,
`rbmp_`, `bnt_`, `bbb_`, `fbb_`, `lgt_`, `misc_`, …), so a renamed part keeps its prefix or loses its
behaviour; and the IDE loader reads a model name with `sscanf %s` into `char[24]` while an IMG entry name is
24 bytes including `.dff` — a part name is safe at **≤ 19 characters**. Stock part names are ≤ 14
(`misc_c_lr_rem1`).

Why it matters: every ADDED car that re-models its base car's wings costs one `link` pair, and the stock
game leaves exactly 7. `tools/add-vehicles` guards both numbers until `asi/perfect-vehicle` lifts them
(its plan 001 is the RE of every access site).
