# 001 — RE: the two `carmods.dat` ceilings

**Status: PLANNED 2026-08-19.** Measurement and rule: `docs/gta-sa-original/carmods-upgrade-ceilings.md`,
`docs/restrictions/sa-target.md`. Starting points from gta-reversed (`Models/VehicleModelInfo.{h,cpp}`):

- `CVehicleModelInfo::ms_linkedUpgrades` = `CLinkedUpgradeList` @ **`0xB4E6D8`**: `int16 m_anUpgrade1[30]`,
  `int16 m_anUpgrade2[30]`, `uint32 m_nLinksCount` (124 bytes). Writers: `AddUpgradeLink` (`0x4C74B0`,
  from `LoadVehicleUpgrades`' `link` case). Readers: `FindOtherUpgrade` (the loop from `m_nLinksCount - 1`
  down, both arrays) and whoever else indexes the arrays — the scan says.
- `CVehicleModelInfo::m_anUpgrades` = `int16[18]` at a fixed offset inside `CVehicleModelInfo` (the struct
  is a pool element, so the array cannot grow in place — relocation by INDEX like `IplDef`'s int16 story:
  a sidecar per model id, or a wider array in our own allocation with the readers redirected). Writers:
  `LoadVehicleUpgrades` `mods` case (`m_anUpgrades[upgradeIdx++]`, then `hydralics`, `stereo`). Readers:
  `CVehicleModelInfo::GetNumRemaps`? no — `CVehicle::AddVehicleUpgrade`/`CVehicleModelInfo::GetUpgrade*`,
  the mod shop's listing (`CShopping`), `CVehicleModelInfo::SetupVehicleUpgradeFlags` consumers — the scan
  says; every site is a relocation target.

## Steps

1. **Scan** with `scripts/debug/exe-field-access-scan.ts`: the link list by its absolute address
   (`0xb4e6d8`, `0xb4e714` = `m_anUpgrade2`, `0xb4e750` = `m_nLinksCount`, and the `lea`/index forms), the
   per-car array by its struct offset (`--offset <off> --width 16 --context <CVehicleModelInfo vtable / the
   pool base 0xB74494>`). Classify every survivor; the gta-reversed grep must agree (the 011 method).
2. **Read the live bytes** at every site on the reference install through the SDK's `VerifyAllSites`
   (a verify-only build of this plugin with the catalogue filled): FLA hooks `LoadVehicleUpgrades`? (it
   patches vehicle-side things — its log lists them) — record who owns what.
3. **Catalogue** (`gen/catalogue.ts` + `docs/patch-catalogue.md`), with the exe-fixture test from day one
   (perfect-map `gen/generate.test.ts`'s last test, lifted into the SDK or copied).
4. **Decide the lift shape per array** and write it down: relocate-and-repoint (004's `gpLoadedBuildings`
   pattern — enlarge to N, repoint every site) for the static list; for the per-model array, the sidecar
   keyed by model id (the int16 pattern) or a relocated `CVehicleModelInfo` layout (NO — pool element size is
   everywhere). The numbers: links 30 → 256, parts 18 → 64, both configurable in the ini we ship? perfect-map
   has no ini — decide: compile-time constants with a generous margin, like the rest.

## Measured

*—*
