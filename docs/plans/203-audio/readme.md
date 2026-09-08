# 203 — Audio: the world's own sound, from the banks the author shipped

**Opened 2026-09-08**, out of [the audio concept](concept.md) — its research record and the four
rounds of questioning that produced every decision below. Read that first; this document is what gets built
and in which order, and it does not re-argue anything the concept settled.

**Nothing about audio existed before this plan**: no `AudioContext`, no sample loading, no bank parser, no
roadmap row. The one `audio` in the repository is a vehicle assignment row the installer writes into the REAL
game, which the real game then plays.

---

## The decisions this chain is built on

Taken with the user on 2026-09-08, in four rounds. The [concept's](concept.md) §5 carries the reasoning; this is the table
every step below inherits.

| Decision | What it rules in | What it rules out |
| --- | --- | --- |
| **v1 is the world's SFX** | engines, feet, weapons, impacts, ambience | radio (`audio/streams`) and ped speech — neither is in this chain |
| **Delivery is SPLIT** | a baked index (kilobytes, seconds to build) beside the pak; samples fetched live by byte range | a re-encode stage inside the ~50-minute pipeline, and a mod's sound needing a rebuild |
| **`@opensa/audio` owns the context** | one `type:engine` package, Node-free, **zero runtime dependencies** | audio inside `packages/game` (the console could not have it) or inside `packages/engine` (the frame is not the mixer) |
| **The console hears the world** | the second consumer gets the city, not just its own alerts — the proof that the engine layer stayed an engine | a game-only subsystem |
| **The listener is the camera, as it is** | honest attenuation on both surfaces | a "virtual microphone" at the ground focus; the console is quiet at altitude ON PURPOSE |
| **Audio runs on its own clock** | a still map still sounds like a city, at rest, where the render gate draws nothing | audio paced by drawn frames |
| **Any first touch wakes it** | no gate screen; an honest indicator in the chrome until the browser allows sound | a "click to enable audio" wall on either surface |
| **The event table is authored DATA** | a text file in the built game a mod author may override, documented in `docs/contracts/` | a table only the code can see |
| **Names and tables come from the reverse; BEHAVIOUR is ours** | `gta-reversed` is read for what the data MEANS (the user's call on the licence, taken knowingly against a public AGPL repository — [concept](concept.md) §5, 3.1) | porting the audio entities' per-frame logic, which [directive 1](../../project-goals.md) forbids whatever a licence permits |
| **The quietest voice at the LISTENER is the one stolen** | a rule derived from what the sound carries — its attenuated gain | a per-category priority table, and "steal the furthest" |
| **No audio is silence and one line** | absence is the normal case: a pak served alone, a total conversion with no `audio/`, a name no bank carries | a substitute bank, and refusing to boot |

## The budgets this chain is held to

Named by the user before the work, per [directive 5](../../project-goals.md#5-performance-is-a-requirement-not-an-outcome).

| Budget | Value | Where it bites |
| --- | --- | --- |
| Concurrent voices, phone | **64** | 3/02, 3/03 |
| Audio CPU per frame | **2 ms** | 3/03, and the 22.2 ms frame 45 fps buys |
| Audio memory | **64 MB**, beside the world's 300–500 | 2/03, 3/01 |
| Time to the first sound after a gesture | **≤ 200 ms** — a touch that does nothing for a second reads as broken | 3/04 |

**These may not all hold at once, and the chain says so up front.** 64 voices each with a `PannerNode` is a
number nobody here has measured on a Mali phone, and the 2 ms lives beside a CPU body already at 3.3.
[Chain 3](#3--the-voice-layer) decides between them with a measurement rather than an argument.

## What this chain does NOT own

Radio and speech (deliberately out of v1), the phone panel's job plumbing, and the pak build itself — the
index is a NEW artifact beside the pak, not a change to it. Where a step needs the device, it says so and
waits rather than inventing a number.

---

## The chains

| # | Chain | Why here |
| --- | --- | --- |
| 1 | [The read layer](#1--the-read-layer) | Every number in the concept is documentation until a parser reads the real files. No browser, no sound, fixtures only |
| 2 | [The index and the wire](#2--the-index-and-the-wire) | One sound has to reach a browser before anything can play it |
| 3 | [The voice layer](#3--the-voice-layer) | The context, the listener, the budget — the part both surfaces share |
| 4 | [Ambience](#4--ambience) | The first thing anybody hears, and the smallest complete consumer |
| 5 | [The world's events](#5--the-worlds-events) | The long half: our table, and the consumers behind it |
| 6 | [The console's own wiring](#6--the-consoles-own-wiring) | The second consumer, its idle clock, and its controls |

### 1 — The read layer

`@opensa/renderware`, `type:engine`. Desk work with fixtures; **every step here is verifiable without a
browser and without sound.**

| Step | What it produces | Verified by |
| --- | --- | --- |
| **1/01** | **The format check, on the real files.** `scripts/debug/audio-census.ts`: read `PakFiles.dat`, `BankLkup.dat` and every bank header on the phone's own game copy, and report package count, bank count, sounds per bank, the rate histogram, the loop-point count and the total PCM bytes | a run on the device (`phone_run debug SCRIPT=audio-census`), filed as a row. **This is the concept's own gate** — 12-byte entries, a 4 084-byte header and 400 `SoundMeta` are documentation until this says so |
| **1/02** | `readBankLookup` / `readBankHeader` — the two structs, plus a `SoundRange` that turns (package, bank, sound) into a byte range and a sample rate | unit tests on a cached fixture (`fixtures-src/`, per the fixture rule: one manifest line, never a file dropped by hand) |
| **1/03** | **The `AUZO` section**, which the IPL parser skips on purpose today (`ipl.parser.ts`) — spheres and boxes, `name id flags` plus geometry, into the map model | unit tests + a census of how many zones the real map carries |

### 2 — The index and the wire

| Step | What it produces | Verified by |
| --- | --- | --- |
| **2/01** | **The index format** — one file beside the pak (`audio.osaudio`, the way `water.bin` and the district table already sit there): the bank table, per-sound offset/rate/loop/duration, and the audio zones from 1/03. Written by a small stage that runs in seconds and never touches the pak | a round trip test, and the byte size stated |
| **2/02** | **The reader**, in `@opensa/loaders` beside the lazy archive reader: `openAudioSource(gameDir, index)` → one sound's PCM by range request, the same shape `model-source.ts` uses for cars | tests against a served fixture; **a missing source is `null`, never a throw** |
| **2/03** | **The cache and its ceiling** — what is kept, what is evicted, and the 64 MB stated as a number the report carries | a test that the cache honours its ceiling; the MB measured on the device in 4/03 |

### 3 — The voice layer

`@opensa/audio`, new package, `type:engine`, **no runtime dependencies** — the rule that keeps the console
embeddable.

| Step | What it produces | Verified by |
| --- | --- | --- |
| **3/01** | The context and its lifecycle: created suspended, resumed on the first trusted gesture, an honest `state` a surface can display | tests with a faked `AudioContext`; the gesture wired in 6/01 and in the game shell |
| **3/02** | **Voices**: play, loop from the authored loop point, stop, position, gain and pitch — and the 64-voice pool with **quietest-at-the-listener stealing** | tests that the pool never exceeds its budget and that the stolen voice is the quietest, not the furthest |
| **3/03** | **The listener and the per-frame update**, on its OWN clock rather than the frame's — and the 2 ms budget measured on the device | a device row: voices, `audio` ms/frame, MB, steals |
| **3/04** | **The absent case**: no index, no game dir, no bank, a name nothing carries — silence, ONE line per name in the log, and a count in the inventory report | tests for each of the four; a report field, so a silent world can be told from a broken one |

### 4 — Ambience

The first thing anybody hears (the user's call).

| Step | What it produces | Verified by |
| --- | --- | --- |
| **4/01** | The zone lookup: which audio zone the listener stands in, from 1/03's spheres and boxes | tests on the real zone table |
| **4/02** | The ambience consumer — a zone's bed, crossfaded when the listener crosses a boundary | the operator's ear on the phone, plus a capture |
| **4/03** | **The numbers**: ms/frame, MB resident, voices, and the BATTERY delta at rest, since audio on its own clock partly spends what render-on-demand bought | a device row against a silent baseline, with `power` and `visibility` stated (both landed 2026-09-08) |

### 5 — The world's events

The long half. **Its shape is settled and its content is not enumerated here**, because a step-by-step list
of several hundred events written before the first one is a list nobody can keep true.

| Step | What it produces | Verified by |
| --- | --- | --- |
| **5/01** | **The event table**: our own vocabulary in an authored text file, its loader, and its contract doc — what a mod author writes, and what a misspelling does | tests; a row in `docs/contracts/` in the same change |
| **5/02** | **Vehicles**, the one consumer with authored data today: `gtasa_vehicleAudioSettings.cfg` read as the author meant it — engine bank, pitch, bass, horn | the ear, on a car whose row the installer wrote |
| **5/03** | **Feet, impacts and weapons**, in that order — each a consumer of 5/01's table, each with its own field verdict | the ear + the voice count |

### 6 — The console's own wiring

| Step | What it produces | Verified by |
| --- | --- | --- |
| **6/01** | The console's audio: camera as the listener, its own idle tick, the first-touch resume, and the honest indicator | the operator, on the device |
| **6/02** | **Volume and mute**, on a phone AND on a desk in the same change — ≥ 44 CSS px where the pointer is coarse, reachable without hover or a keyboard | `styles.test.ts`, and the cross-platform checklist |

---

## Status

| Step | State |
| --- | --- |
| the chain itself | **OPENED 2026-09-08** — declared, ordered, and the decisions above taken with the user in four rounds |
| the questioning round | **CLOSED 2026-09-08** — fourteen decisions, frontier empty ([the concept](concept.md) §5) |
| **1/01 The format check** | **THE INSTRUMENT IS BUILT 2026-09-08; THE RUN IS OWED BY THE DEVICE.** `scripts/debug/audio-census.ts` reads `PakFiles.dat`, `BankLkup.dat` and every bank header in every package, and reports packages, banks, sounds per bank, the rate histogram, the loop count and the total PCM — plus the map's audio zones in the same pass, because reaching the phone is the expensive part. **Its real output is the last line**: `LAYOUT AGREES`, or a list of what contradicts the documented layout. **Verified end to end here against a SYNTHETIC tree whose contents were known** — it read back the 2 packages, 3 banks, 4 sounds, the rate histogram and the 1 box + 1 sphere exactly as written, and a deliberately corrupted bank offset produced the disagreement rather than a silent pass. That proves the instrument, not the format: `phone_run debug SCRIPT=audio-census` is what turns §1 into measurements, and it has not run |
| **1/02 The bank reader** | **DONE 2026-09-08.** `packages/renderware/src/audio/sfx-banks.ts` — `readPakFiles` / `readBankLookup` / `readBankHeader` / `soundRange`, 17 tests on synthetic bytes. **Every function refuses a buffer that cannot be what it claims** (a length that is not a whole number of entries, a header that will not fit at its offset, a count past the 400 slots) because the layout is unverified until 1/01: a reader that trusted it would hand back plausible offsets into the wrong bytes. The 400-slot guard was proven load-bearing by removing it — without it the reader dies in `BinaryStream out of bounds`, a message about the wrong thing. **`soundRange` carries the one derivation worth reading twice**: `SoundMeta` stores no LENGTH, so a sound runs to the next buffer and the last runs to the end of the bank — taken as the smallest offset ABOVE this one, so the arithmetic does not assume an ordering the format never promises |
| **1/03 The `AUZO` section** | **DONE 2026-09-08.** `parseIplAudioZones` — a second pass over the same text rather than a second return value, so no caller of `parseIpl` changes. Two row shapes told apart by their WIDTH exactly as `CFileLoader::LoadAudioZone` does (nine fields box, seven sphere), `flags == 1` read as the game's `m_IsActive` starting state, and anything else DROPPED rather than guessed — a zone at `NaN` is a silence nobody could explain. 8 tests. **The zone COUNT on the real map is owed by 1/01's run**, which counts them |
| 2/01 … 6/02 | not started |

**What this chain owes before it can claim anything**: the 1/01 run on the device — which now costs one job
rather than an evening, since the instrument is written, registered in [the debug index](../../debug/README.md)
and proven in both directions. Nothing about the real files has been measured yet, and no number in the
concept's §1 may be cited until that line says `LAYOUT AGREES`.
