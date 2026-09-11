# Audio contracts

What a name has to be for the engine to make a sound, and what happens when it is spelled otherwise. Two
files carry behaviour here — the table a mod author writes, and the index the build bakes — plus one set of
names inside the first that the engine derives from the MAP rather than being asked for. None of them errors
on a mistake: **the sound is simply silent**, which is why every rule below also says how the mistake is
REPORTED.

Plan: [203 — audio](../plans/203-audio/readme.md).

**This file is the GAME's sounds** — San Andreas' authored data, read as the author meant it. The dispatch
panel's own vocabulary, which two applications share and neither game owns, is
[panel-audio.md](./panel-audio.md).

---

## 1. `data/audio-events.dat` — the event table

**Where it lives:** in the built game's `data/`, beside `handling.cfg` and the rest. A mod overrides it the
way it overrides any other data file, and the last layer to write it wins
([mods.md](./mods.md)). A build with no such file has no named sounds at all — that is not an error, and
the report says `absence.noIndex` or an empty table rather than a stack trace.

**Why it is a table and not code:** the mapping from an event to a sound is CODE in San Andreas — it lives
in `CAEVehicleAudioEntity`, `CAEPedAudioEntity` and their siblings — and
[directive 1](../project-goals.md) forbids porting that logic. So the banks, the rates and the loop points
are read as the author meant them, while the mapping is ours, written where a mod author can see and change
it without a build.

### The row

```text
# event, bank, sound, [gain], [loop|once], [maxDistance]
VEH_HORN_1,    12,  3
FOOT_GRAVEL,    1,  0, 0.8
AMB_CITY_DAY,  40,  2, 0.6, loop, 400
```

| Column | Required | What it is | Spelled wrong |
| --- | --- | --- | --- |
| `event` | yes | The name a consumer asks for. **Upper-cased on read**, so the file is case-insensitive to write and exact to look up | A name nothing asks for is simply never played — nothing reports an unused row |
| `bank` | yes | Index into `BankLkup.dat`, 0-based — the bank the sound lives in | Not a whole non-negative number → the ROW is dropped with its line number. Past the end of this build → dropped at LOAD, with the count it does have |
| `sound` | yes | Slot within that bank, 0-based | Past the bank's own count → dropped at load, naming how many the bank has |
| `gain` | no (1) | Authored loudness before distance, 0..1 | Not a number → row dropped. Above 1 → **clamped**, so one row cannot shout over every other |
| `loop`/`once` | no (`once`) | Whether it loops, from the sound's own authored loop point | Any other word → row dropped, naming what it saw |
| `maxDistance` | no | How far it carries, world units. Absent means the engine's default falloff ([the hack](../hacks/audio-distance-defaults.md)) | Not a positive number → row dropped |

**Commas and whitespace are one separator class**, exactly as in every other GTA data file
(`CFileLoader::LoadLine` turns commas and tabs into spaces before reading a row), so a missing comma is
harmless and a mod author's habits carry over.

**`#` starts a comment** anywhere on a line of its own; blank lines are ignored.

**A name defined twice takes the LAST row**, the way a later mod layer wins — and the earlier one is
reported by line, because a sound nobody can predict is worse than a refusal.

### What a misspelling does, precisely

| The mistake | What happens | What says so |
| --- | --- | --- |
| A malformed row | Dropped; the rest of the file loads | The parser returns `problems`, each with the LINE and the text |
| A row naming a bank or slot this build lacks | Dropped at LOAD, never at play | `absence.reasons` — *"'X' is in the event table but bank 99 is not in this build"* |
| Asking for a name the table has not got | Silence, and `null` from `find` | ONE log line per distinct name, and `absence.names` counts them |
| A build with no audio index | Every name resolves to nothing | ONE line, `absence.noIndex`, and the console's report carries it |

**None of these throws, and that is the contract**: absence is the normal case for a pak served without its
game dir, a total conversion, or a console opened on a browser with no Web Audio.

---

## 2. `AMB_*` — the ambience beds

**These are rows of the same `data/audio-events.dat`**, not a second file. What makes them a contract is that
the engine looks them up **by NAME derived from the map**, so a name spelled otherwise is a place that has no
sound and nothing that says which place.

### How a zone's bed is named

The name is the audio zone's own name — the `AUZO` row's first field — upper-cased, with every run of
characters that is not `A-Z` or `0-9` folded to a single `_`, behind the prefix `AMB_`:

| The zone's `AUZO` name | The row the engine looks for |
| --- | --- |
| `LS_BEACH` | `AMB_LS_BEACH` |
| `ls beach` | `AMB_LS_BEACH` |
| `VEGAS.CLUB1` | `AMB_VEGAS_CLUB1` |

**`AMB_DEFAULT` is the open world**, and it is also the fallback for any zone that does not name a bed of its
own — because a dispatch console has no traffic and no pedestrians to make an emergent ambience out of
([the recovered design](../gta-sa-original/audio-ambience.md)), so a place with nothing authored inherits the
outdoors rather than going silent.

**A zone made deliberately SILENT is expressible**: author `AMB_<ZONE>` with a gain of `0`. It wins the
lookup and is inaudible, which is how an interior says *not the outdoors, and not anything*.

**The row's gain is a BALANCE and the bed is an envelope over it.** A three-layer bed authored 0.5 / 0.3 /
0.2 keeps that ratio at every point of a crossfade and at every camera height — the bed multiplies, it never
replaces. (It did replace it for one commit, which made a silent zone play at full volume one tick after
starting; the regression test is `keeps the ROW's authored gain under the envelope`.)

### Layers

A bed may stack up to **four** rows, and they all play at once:

```text
AMB_LS_BEACH,        40, 2, 0.6, loop
AMB_LS_BEACH_2,      40, 7, 0.3, loop
AMB_LS_BEACH_4,      41, 1, 0.2, loop
```

The suffix is `_2`, `_3`, `_4` — the first layer has none. **Every slot is probed and a gap is skipped**, so
the example above plays three layers: a typo that writes `_4` where `_3` was meant loses nothing, which is
the opposite of stopping at the first gap.

### What each row has to be

**`loop`, always.** A bed is built out of the game's own looping sounds — the census found
[351 of them, 172 at least a second](../benchmarks/opensa-engine/2026-09-09-phone-audio-census.json) — and a
row marked `once` plays exactly once and then leaves that layer silent for as long as the listener stands
there. Nothing rejects it; there is no way for the engine to know it was not meant.

**`maxDistance` is ignored** for a bed. A bed has no position: it is where you are, and it is scaled by the
listener's HEIGHT instead (full at 60 m and below, silent at 400 m and above — the numbers are
[a fitted bridge](../hacks/audio-twin-loop-swap.md)).

### What a misspelling does, precisely

| The mistake | What happens | What says so |
| --- | --- | --- |
| A zone's row named for something other than the zone | That zone plays `AMB_DEFAULT` | Nothing — it is indistinguishable from a zone that meant to inherit |
| No `AMB_` row anywhere | Every place is silent, and the console is silent at rest | ONE line per bed name, `absence.names`, and `ambience.layers` is 0 with `ambience.bed` naming what was wanted |
| `once` where `loop` was meant | The layer plays through once and stops | Nothing. `ambience.starts` still counts it, and the pool's voice ends normally |
| A second layer at `_5` or beyond | Ignored | Nothing — four is the ceiling |

**Each bed is played as a TWIN**: two voices of the same sound, started a third to two thirds of the loop
apart, one audible, their volumes exchanged at a random interval. That is San Andreas' own
`CAETwinLoopSoundEntity` idiom and it means **a bed row costs two voices**, not one, against the 64-voice
budget.

---

## 3. `audio.osaudio` — the baked index

**Where it lives:** loose beside the pak, next to `manifest.json`, `water.bin` and `districts.json`. The pak
build writes it; a game shipping no `audio/CONFIG/` produces no file and no manifest field, and a consumer
must have an answer for that.

**What it means for a mod author:** the index is built FROM `audio/CONFIG/` and `audio/SFX/`, so a mod that
replaces a bank changes what every event pointing into it plays — no rebuild of the event table needed. What
it does NOT carry is the samples: `audio.osaudio` addresses them by byte range inside the game's own
packages, which stay where they are and are fetched one range at a time.

**The one number nobody may hardcode**: the bank header is **4 804 bytes**, and it is measured rather than
documented — [the census](../benchmarks/opensa-engine/2026-09-09-phone-audio-census.json) derived it from
361 consecutive-bank gaps after the code had carried 4 084 for a day. The index stores ABSOLUTE offsets so
no consumer ever needs the constant again.

---

## 4. `data/gtasa_vehicleAudioSettings.cfg` — a car's engine sound

**Where it lives:** in the built game's `data/`. On an install with the adjuster it is fastman92's Limit
Adjuster's own vehicle audio loader file; a mod author does not usually edit it directly — they ship
`audio.txt` in the car's folder and `vehicle-installer` merges the row ([vehicles.md](./vehicles.md)).

**And where it comes from when there is no adjuster** (204, 2026-09-11). A plain copy of the game has no such
file and never will — the settings are an array compiled into the executable — so until this was noticed
`VehicleVoiceTable` resolved **zero** cars on any install without FLA, and every vehicle was unvoiced. The
first panel-audio flight measured a 150-unit board that sounded empty for exactly that reason, with
`vehicles: 0` as the only trace. So the pak build now **writes the recovered stock table** into `<out>/data/`
when the game dir carries none:

| | |
| --- | --- |
| The file | [`tools/opensa-pack/data/vehicle-audio-settings.cfg`](../../tools/opensa-pack/data/vehicle-audio-settings.cfg) — 212 rows, the whole stock fleet |
| Where it came from | `scripts/debug/bake-vehicle-audio.ts`, out of the reversed game's own array and enums. Re-runnable, and the output is byte-identical run to run |
| What wins | **The game dir's own file, always.** The check is on the OUTPUT after the mirror, so an adjuster's table — or one a mod's `audio.txt` has been merged into — is left alone |
| What says which | the build log names it either way, and a build serving the baked one still voices its cars |

**Its comment marker is `;`**, this format's own — `#` is `audio-events.dat`'s. A header written with the
wrong one parses as broken rows rather than as legend, which is how the first bake was caught.

**What the columns MEAN is a fact about the original game**, not a rule of ours, so it is recorded where the
other such facts are: [gta-sa-original/vehicle-audio-settings.md](../gta-sa-original/vehicle-audio-settings.md)
carries the fifteen columns, every enum, and the finding that in the stock game this is not a file at all —
the settings are compiled into the executable and FLA exposes them.

**What the ENGINE promises about reading it**, which is the contract half:

| The mistake | What happens | What says so |
| --- | --- | --- |
| A row without exactly 15 columns | Dropped — the loader would read it past its end into the next line's fields | `problems`, with the LINE, the text and both counts |
| A column that is not a number | The whole row is dropped | `problems`, naming the COLUMN and what it said |
| A sound type the game has no name for | The row is **kept**, its `soundType` reads `unknown`, and the banks and pitches are still usable | `problems`, naming the number |
| A model set twice | The LAST row wins, the way an appended row wins in the file itself | `problems`, naming the model |
| `-1` in a bank, horn or station column | Read as ABSENT, never as an id | nothing — it is the file's own spelling for *there is none* |

**`-1` is the trap and it is why this is written down.** It is `NONE` for a horn, `UNSET` for a door,
`DISABLED` for a radio type, `INVALID` for a station and a plain *no bank* in columns C and D — while a radio
switched **off** is the id **13**. A reader that took -1 as a number would fetch the bytes before the bank.

---

## 5. `VEH_SIREN_*` — the units' sirens

**These are rows of `data/audio-events.dat`**, like the beds, and they are named by the KIND of unit rather
than by the car:

| Unit kind | The row the engine looks for |
| --- | --- |
| `patrol` | `VEH_SIREN_PATROL` |
| `ambulance` | `VEH_SIREN_AMBULANCE` |
| `fire` | `VEH_SIREN_FIRE` |

**Why a kind and not a model**: San Andreas keeps which vehicle wails, and with what, in CODE — so
[directive 1](../project-goals.md) makes the mapping ours, and a dispatch board's own vocabulary is the
service rather than the car. A borrowed unmarked car in the patrol fleet should still sound like a patrol
unit, and it does.

**A siren runs while the unit's status is `enRoute`, and at no other time.** Not while it is on scene, not
while it is available. Nothing configures that: it is what the status means.

**`maxDistance` on a siren row is honoured, including by the cull.** A unit too far away is given no voices
at all — a car is two of them and the budget is 64 — and the distance that counts is the LARGER of the
engine's default reach and the siren row's own. So `VEH_SIREN_PATROL, 40, 2, 0.9, loop, 900` really is heard
from 900 m rather than being cut at 300 with nothing reported.

| The mistake | What happens | What says so |
| --- | --- | --- |
| No `VEH_SIREN_<KIND>` row | That service's units respond in silence | ONE line per name, `absence.names`; `audio.units.sirens` stays 0 while units are en route |
| The row marked `once` | The siren plays through once and the unit is silent for the rest of the run | Nothing — `once` is a legal row |
| A row for a kind the board never uses | Never played | Nothing |

---

## 6. The engine's two bank slots

Not a name, but a NUMBER that carries behaviour, which is the same problem. A car's engine is read from the
**dummy bank** its `gtasa_vehicleAudioSettings.cfg` row names (column D), and the two loops inside it are at
fixed slots — the game's own `eDummyEngineSoundType`:

| Slot | What it is |
| --- | --- |
| **0** | `AE_DUMMY_CRZ` — the REV loop |
| **1** | `AE_DUMMY_ID` — the IDLE loop |

**Nothing in any data file says so**; it is code, which is exactly why it is written down. A mod that
replaces a bank must keep that order, and one that swaps them produces a car which idles when it accelerates
— audible immediately, and impossible to find from the file.

**A bank with fewer than two sounds cannot voice an engine**, and such a car is dropped at LOAD with its
model named (`absence.reasons`) rather than falling silent the moment somebody drives past.
