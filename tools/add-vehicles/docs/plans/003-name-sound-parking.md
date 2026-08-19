# 003 — Name, sound, parking

**Status: PLANNED 2026-08-19.** Three things a stock slot has and an added id does not. All three merges
are `vehicle-installer`'s (012 `.fxt`, 013 audio + parked); this plan only decides WHAT to feed them.

## Steps

1. **Name** — the GXT key is the ide line's `gameName` (`001VEH`); the text is the folder's second field
   (`1971 Chevrolet Vega`), overridable by a line in `text.txt` whose key equals the gameName. Written as
   `cleo/<slot>.fxt` with every other `text.txt` line (part names). Refuse a gameName longer than 7 chars
   (the GXT key width) — the ide line already enforces it for the game, we say it earlier.
2. **Sound** — `audio.txt` present → its line, with the first token forced to the slot (an author who
   copied the base's line and forgot to rename it ships a duplicate of the base otherwise); absent → the
   FIRST `(base)`'s line from the built `gtasa_vehicleAudioSettings.cfg`, copied under the slot, and LOGGED
   (`001veh: audio inherited from manana`). No base line either → warning: the car is silent in the game.
3. **Parking** — `parked.txt` lines → Parked Maker `[Cars]` with the car's id (013's merge); the
   `Car generators` budget warning as 013 counts it.
4. **Tests** — name derivation (folder field, `text.txt` override, > 7 refusal), audio inherit/own/forced
   token/silent warning, parked pass-through of the id.
5. **Verification** — the `--only 001veh` tree: `cleo/001veh.fxt` has `001VEH 1971 Chevrolet Vega`;
   `gtasa_vehicleAudioSettings.cfg` has a `001veh` line equal to `manana`'s; `Parked Car Maker.ini` has one
   more `[Cars]` row with id 19 001.

## Measured

*—*
