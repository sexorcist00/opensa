# 002 — Lift: relocate + enlarge, behind two flags

**Status: PLANNED 2026-08-19.** Depends on 001's catalogue being complete (every site classified, the
coexistence bytes recorded).

## Steps

1. **`PV_FIX_LINKS`** — the link list relocated to our allocation (N pairs), every catalogued site
   repointed (index arithmetic unchanged, base changed — the `gpLoadedBuildings` shape), the count's
   bound-less write now bounded by N (we add the check the game never had, logging the overflow instead of
   corrupting).
2. **`PV_FIX_UPGRADES`** — the per-car upgrades: sidecar or relocation per 001's decision, every reader
   redirected, `hydralics`/`stereo` still appended after the listed parts.
3. **Verify-only build** reports every site clean on the reference install; **APPLY build** logs
   `links APPLIED (N)` / `upgrades APPLIED (N)`.
4. **Field ladder** — a `carmods.dat` with 31 `link` pairs and a car with 17 listed parts (made with
   `tools/add-vehicles` and the guards told the plugin is present): boots, the mod shop lists and installs
   the parts, both wings swap together, eight world entries; then the stock file again (no regression).
5. **Retire the guards' refusal**: `tools/add-vehicles` 005 detects `perfect-vehicle.asi` in the built tree
   and reads the lifted numbers; the `docs/restrictions/sa-target.md` rows move to "lifted"; pmb ships the
   plugin beside `perfect-map.asi` (the same "pre-built artifact, not a build step" rule).

## Measured

*—*
