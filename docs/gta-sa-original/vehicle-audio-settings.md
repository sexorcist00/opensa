# What a car's audio row MEANS

Recovered 2026-09-09 from [gta-reversed-modern](../links.md) — `tVehicleAudioSettings`
(`Audio/Entities/AEVehicleAudioEntity.VehicleAudioSettings.h`) and the six enums its fields are typed by —
while building [203/5-02](../plans/203-audio/readme.md). Written down because the numbers in
`data/gtasa_vehicleAudioSettings.cfg` are meaningless without them, and because a mod author writing
`audio.txt` ([the contract](../contracts/vehicles.md)) is writing exactly these.

## The first fact: in the stock game this is not a file

**San Andreas has no vehicle audio data file.** The settings are a **232-entry array compiled into the
executable** at `0x860AF0`, ordered by model id from 400 (`landstal`) up — `GetVehicleAudioSettings(model)`
is an array index and nothing more.

`data/gtasa_vehicleAudioSettings.cfg` is **fastman92's Limit Adjuster** exposing that array as a table, and
it exists on our target because the reference install runs FLA with
`Enable vehicle audio loader = 1` ([the install](reference-install.md)). **The loader is keyed by model
NAME**, not by id, which is what lets an added vehicle carry a row at all.

That is why this repository can read a car's sound as authored data while the rest of the audio mapping has
to be recovered as meaning and re-expressed
([directive 1](../project-goals.md), [203's decisions](../plans/203-audio/readme.md)).

## The fifteen columns

The file's own legend runs `A`..`O`. Column `A` is the model name; **`B`..`O` are the struct's fourteen
fields in declaration order**, which is checked rather than assumed — the struct has exactly fourteen fields,
and every value of a real row lands in range for the field it falls on.

| Col | Field | Type | Notes |
| --- | --- | --- | --- |
| A | model name | text | the loader's key; case-insensitive |
| B | `VehicleAudioType` | `eAEVehicleSoundType` | how the engine is voiced — see below |
| C | `PlayerBank` | bank id | played when the player IS in it; -1 for none |
| D | `DummyBank` | bank id | played when the player is NOT — **the one a dispatch console ever hears** |
| E | `BassSetting` | `eBassSetting` | 0 normal · 1 boost · 2 cut |
| F | `BassFactor` | float | how much of it, 0..1 as authored |
| G | `EnginePitch` | float | multiplier on the sample's own pitch, 1 = as recorded |
| H | `HornType` | sound id | "actually just the sound ID"; -1 for a vehicle with no horn |
| I | `HornPitch` | float | |
| J | `DoorType` | `eAEVehicleDoorType` | which door sound set |
| K | `EngineUpgrade` | uint8 | the reverse marks it `[UNUSED?]`; every stock row is 0 |
| L | `RadioStation` | `eRadioID` | **13 is `RADIO_OFF`, an id and not an absence** |
| M | `RadioType` | `eAERadioType` | decides whether a station is chosen at all |
| N | `VehicleAudioTypeForName` | `eAEVehicleAudioTypeForName` | 46 ids naming the KIND of vehicle |
| O | `EngineVolumeOffset` | float, dB | trucks author +5 and +6; most rows are 0 |

**A real row**, `landstal`, the array's first entry with every id resolved:

```text
landstal   0  99  98  0  0.78  1.0  7  1.0  2  0  8  0  0  0.0
```

`AE_CAR`(0) · `SND_BANK_GENRL_PATHFINDER_P`(99) · `SND_BANK_GENRL_PATHFINDER_D`(98) · `NORMAL`(0) · 0.78 ·
1.0 · `PICKUP`(7) · 1.0 · `NEW`(2) · 0 · `RADIO_NEW_JACK_SWING`(8) · `AE_RT_CIVILIAN`(0) ·
`AE_VAT_OFFROAD`(0) · 0.0

## The enums

**`eAEVehicleSoundType`** (col B) — 0 `AE_CAR` · 1 `AE_BIKE` · 2 `AE_BMX` · 3 `AE_BOAT` ·
4 `AE_AIRCRAFT_HELICOPTER` · 5 `AE_AIRCRAFT_PLANE` · 6 `AE_AIRCRAFT_SEAPLANE` · 7 `AE_ONE_GEAR` ·
8 `AE_TRAIN` · 9 `AE_SPECIAL` · 10 `AE_NO_VEHICLE`.

**`eBassSetting`** (col E) — 0 `NORMAL` · 1 `BOOST` · 2 `CUT`.

**`eAEVehicleDoorType`** (col J) — **-1 `UNSET`** · 0 `LIGHT` · 1 `OLD` · 2 `NEW` · 3 `TRUCK` · 4 `VAN`.

**`eAERadioType`** (col M) — **-1 `AE_RT_DISABLED`** · 0 `AE_RT_CIVILIAN` · 1 `AE_RT_SPECIAL` ·
2 `AE_RT_UNKNOWN` · 3 `AE_RT_EMERGENCY`.

**`eRadioID`** (col L) — 0 `EMERGENCY_AA` · 1 `CLASSIC_HIP_HOP` · 2 `COUNTRY` · 3 `CLASSIC_ROCK` ·
4 `DISCO_FUNK` · 5 `HOUSE_CLASSICS` · 6 `MODERN_HIP_HOP` · 7 `MODERN_ROCK` · 8 `NEW_JACK_SWING` ·
9 `REGGAE` · 10 `RARE_GROOVE` · 11 `TALK` · 12 `USER_TRACKS` · **13 `OFF`**. -1 is `RADIO_INVALID`.

**`eAEVehicleHornType`** (col H) — -1 `NONE`, otherwise a `GENRL` horn sound id: 1 `ESCORT` (and `BIKE`, the
bike bell, shares it) · 2 `CHEVY56` · 3 `BMW328` · 4 `BUS_A` · 5 `BUS_B` · 6 `JEEP` · 7 `PICKUP` ·
8 `PORSCHE` · 9 `TRUCK`.

**`eAEVehicleAudioTypeForName`** (col N) — -1 `NONE`, then 0..45: `OFFROAD`, `TWO_DOOR`, `SPORTS_CAR`, `RIG`,
`STATION_WAGON`, `SEDAN`, `TRUCK`, `FIRETRUCK`, `GARBAGE_TRUCK`, `STRETCH`, `LOWRIDER`, `VAN`, `AMBULANCE`,
`HELICOPTER`, `TAXI`, `PICK_UP`, `ICE_CREAM_VAN`, `BUGGY`, `POLICE_VAN`, `BOAT`, `COACH`, `TANK`,
`CONVERTIBLE`, `HEARSE`, `MONSTER_TRUCK`, `MOPED`, `TRAM`, `GOLF_CART`, `PLANE`, `BIKE`, `QUADBIKE`, `COUPE`,
`BULLDOZER`, `FORKLIFT`, `TRACTOR`, `COMBINE_HARVESTER`, `KART`, `MOWER`, `POLICE_CAR`, `TRAIN`,
`HOVERCRAFT`, `BICYCLE`, `SEA_PLANE`, `DINGHY`, `CAMPER_VAN`, `FOUR_DOOR`.

## What this does NOT settle

**How the row is USED per frame is code**, not data: `CAEVehicleAudioEntity` crossfades engine banks against
gear and load, applies the bass setting, and decides when a horn or a door plays. That is 2004 logic and
[directive 1](../project-goals.md) keeps it out — what this file records is what the AUTHOR's numbers mean,
which is the half we are required to honour.

**-1 is not one thing.** It is `NONE` for a horn, `UNSET` for a door, `DISABLED` for a radio type and
`INVALID` for a station, and it is a plain *there is no bank* in columns C and D. A reader that treated it as
an id would fetch whatever lies before the bank.
