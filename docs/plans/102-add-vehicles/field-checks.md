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

## From `add-vehicles` (002 BUILT 2026-08-19; 003–007 to come)

- [ ] **An added car exists and drives.** Deliver the vehicles archive family (`models/vehicles*.img`),
      `data/{vehicles.ide,handling.cfg,carcols.dat,carmods.dat,gta.dat}` and `data/vehicle-adds.txt`.
      Look at: spawn `19001` (the vega) with a trainer — it appears, it is the right model, and it drives
      with its OWN handling rather than the manana's. If it fails: the handling row is the one that was
      silently dropped before this plan (a digit-leading id), so check `handling.cfg` holds `001VEH`.
- [ ] **`vehicles3.img` really loads.** The run added a third family member and registered it in `gta.dat`.
      Look at: the game boots and a car whose model lives in that archive appears. If it fails: FLA's
      archive count, and `data/img-layout.json`.
- [ ] **An added car has a NAME in the HUD.** Deliver `cleo/*.fxt`. Look at: entering the vega shows
      "1971 Chevrolet Vega", not a blank or a key. If it fails: CLEO's FXT loader, and whether the ide row's
      `gameName` is what the fxt keys on.
- [ ] **The stock trains kept THEIR names.** 9 added carriages deliberately get no `.fxt` because their
      gameName is the stock train's key. Look at: the freight train is still called what it always was.
- [ ] **An added car with no `audio.txt` sounds like its base.** 111 of the 115 inherit. Look at: the vega
      starts and revs like a manana rather than being silent.
- [ ] **An added car turns up in traffic on its own.** Deliver
      `modloader/Model_Variations/ModelVariations_Vehicles.ini`. Look at: drive the poor-family
      neighbourhoods (the manana's) and the vega appears without a cheat. If it fails: `EnableVehicles=1`
      in `ModelVariations.ini`, and `EnableLog=1` to see the plugin's own parse.
- [ ] **The one-section-per-model reading is the right one.** We write `[manana] Global=410,19001` where the
      user's older tool wrote the tuning keys in `[voodoo]` and the variations in `[412]` — two sections for
      one model. Look at: an added car spawns AND (once 006 lands) the tuned traffic still works for the same
      base. If only one of the two happens, the plugin keys sections by resolved model and the two writers
      must stay in one section — which is what we already do, so the failure would instead say the plugin
      wants them apart.
- [ ] **`petro` and `towtruck` still tow.** Both are a base AND author trailer keys; their `Global` now reads
      `Trailers1,<baseId>,<addedId>`. Look at: they still pull their trailer sets.
- [ ] **An added car's own tuning parts fit it.** Deliver `data/carmods.dat`, `data/shopping.dat`,
      `data/maps/veh_mods/veh_mods.ide` and the vehicles archives. Look at: take `059veh` (the Charger) to a
      mod shop — its bumpers, exhausts and wings are listed under the base's names, cost the base's prices,
      and sit on THIS body. A wing bought once fits both sides (the link). If it fails: the part is in
      `veh_mods.ide` under `<stock>_<slot>` with the added car's TXD, so check the TXD carries its textures.
- [ ] **The base car did not change.** The stock `remingtn` keeps its own parts — nothing was renamed out
      from under it. Look at: a remington in a mod shop still has its full set.
- [ ] **Traffic is TUNED, at about the configured rate.** 103 models carry a tuned section
      (`TuningChance=75`, `TuningFullBodykit=1`). Look at: roughly three cars in four wear parts or a paint
      job. Too much or too little is one number in `mods-src/original/add-vehicles/add-vehicles.json` and a
      re-run — no rebuild. If police or emergency cars look wrong tuned, that is the `exclude` list.
- [ ] **`Vehicle colors = 256` really applies.** Set 2026-08-19 because the palette (145 rows with the
      added cars) was over the game's own 128 —
      `docs/gta-sa-original/vehicle-colour-table-128.md`. Deliver `fastman92limitAdjuster_GTASA.ini`.
      Look at: FLA's log names the setting, `Number of memory changes made` is still healthy (3712 was the
      figure before), and cars painted with ids above 127 (the added ones use 140–144) show the right
      colour. If FLA refuses the number it says so in its log — that is the first place to read.

## From `asi/perfect-vehicle` (link half BUILT 2026-08-19)

**This is the round's riskiest delivery — it rewrites two functions of the exe.** Deliver
`perfect-vehicle.asi` into the game root beside `perfect-map.asi`, and keep the previous `carmods.dat` to
put back.

- [ ] **It loads and says so.** Look at: `perfect-vehicle-asi.log` beside the others, ending in
      `links APPLIED: 256 pairs`. A `DEFER` line instead means a site's bytes have moved — the log names
      which, and that is the whole diagnosis.
- [ ] **31 link pairs boot.** Deliver the `carmods.dat` the full 115-car run wrote. Look at: the game
      boots and plays. Before the plugin this was the pair that would have written past the array.
- [ ] **Both wings of a re-modelled set swap together.** Take `059veh` (the Charger) to a mod shop and buy
      a wing: the mirror appears on the other side. That is `FindOtherUpgrade` — our replacement — doing its
      job, and it is the single most direct test of the patch.
- [ ] **The stock links still work.** A stock car's mirrored parts (`blade`, `slamvan`) pair as they always
      did: our storage is loaded from the same `carmods.dat`, so the 23 stock pairs must behave unchanged.
- [ ] **Eight world entries.** The perfect-map 011 ladder, as the regression: nothing else moved.
- [ ] **Then take the plugin away.** With the stock `carmods.dat` back and no `perfect-vehicle.asi`, the
      game is what it was. A patch that cannot be removed is one nobody can bisect.
