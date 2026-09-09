# Audio contracts

What a name has to be for the engine to make a sound, and what happens when it is spelled otherwise. Two
files carry behaviour here — the table a mod author writes, and the index the build bakes — and neither one
errors on a mistake: **the sound is simply silent**, which is why every rule below also says how the mistake
is REPORTED.

Plan: [203 — audio](../plans/203-audio/readme.md).

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

## 2. `audio.osaudio` — the baked index

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
