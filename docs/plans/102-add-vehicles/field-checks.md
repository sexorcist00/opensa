# The field round of plan 102 — what to look at, once, at the end

The chain's steps each end in something only the real game can answer, and each of them is worth seconds of
play — but a delivery + boot + drive is not. So the verdicts ACCUMULATE here (the user's call, 2026-08-19)
and are collected in ONE round when the chain is built, instead of one round per step.

**How to read a row**: _deliver_ is what has to reach the bottle for that check (a path under
`build/original/sa`), _look at_ is the observation, _if it fails_ names where the cause would be. Tick the
box and write the verdict + date into the owning plan's `## Measured` when the round is run.

**Before the round**: `stat` the bottle against the built tree — a stale bottle has cost a whole session
before (session 19). After any ROOT delivery, read FLA's `Number of memory changes made` (3712 = healthy)
before diagnosing anything.

---

## From `vehicle-installer` 012 — trailers and part names (BUILT 2026-08-19)

- [ ] **A truck tows its trailer.** Deliver `modloader/Model_Variations/ModelVariations_Vehicles.ini`.
      Look at: a `tug` or `baggage` met at the airport pulls `bagboxa`/`bagboxb`/`tugstair`; a `linerun`
      or `towtruck` in traffic pulls one of its own list. If it fails: the section is in the built ini
      (verify first — it is 45 lines longer than the mod's), so the cause is the plugin's own reading of
      it, not the merge. `ModelVariations.ini` → `EnableLog=1` prints its parse errors.
- [ ] **The slamvan's two bonnets have names in the shop.** Deliver `cleo/slamvan.fxt` (55 B).
      Look at: a slamvan in a mod shop → the bonnet items read "Slamin Hood" / "Chromer Hood" instead of
      blank. If it fails: CLEO's FXT loader did not pick the file up — check it is beside
      `cleo/ResprayPrice.fxt`, which proves the channel works.
- [ ] **`petro` and `rdtrain` still behave.** Their sections ship with unresolved `{{205veh}}`-style
      placeholders on purpose (those are ADDED cars; `add-vehicles` allocates the ids). Look at: nothing
      breaks around them — ModelVariations logs an invalid model id and skips. Re-check this row AFTER
      add-vehicles 002 lands: the placeholders must be gone from the built ini.

## From `vehicle-installer` 013 — sound and parking (BUILT 2026-08-19)

**No folder in `vehicles/` ships either file today** — the four `audio.txt` and the one `parked.txt` live in
the ADDED-cars root, so both rows below are really exercised by add-vehicles 003. They can be brought
forward by authoring one file into a replacement car's folder (the user's `mods-src`, so his call).

- [ ] **A car with its own `audio.txt` sounds different.** Deliver `data/gtasa_vehicleAudioSettings.cfg`.
      Look at: the car whose row was authored starts and revs with the borrowed engine, not its stock one.
      If it fails: FLA's `Enable vehicle audio loader = 1` (on in the reference install), and the row's
      column count — the installer refuses a wrong one, so a silent miss means the row never merged.
- [ ] **A `parked.txt` car stands where it says.** Deliver `cleo/Parked Car Maker.ini`. Look at:
      **after a NEW GAME** (parked cars land in the save, and `Accept any ID for car generator = 1` changes
      the save format), the car is at the authored spot. If it fails: mod 47 present, that FLA setting on.
- [ ] **The car-generator array is not starved.** Only worth doing once a real number of parked rows
      ships (add-vehicles 003). Switch FLA's `Car generator limit exceeded = 1` on, drive the busiest area
      (downtown LS at ground level), and read the log — this is the measurement
      `docs/gta-sa-original/car-generators-500-and-the-map-1045.md` says nobody has taken.

## From `add-vehicles` (to be filled as 001–007 are built)

_—_

## From `asi/perfect-vehicle` (to be filled as 001–002 are built)

_—_
