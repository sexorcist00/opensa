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
| **1/01 The format check** | **DONE 2026-09-09 — `LAYOUT AGREES`, and the gate earned its place on the way through** ([the row](../../benchmarks/opensa-engine/2026-09-09-phone-audio-census.json)). Measured on the phone's stock copy: **9 packages, 370 banks, 8 857 sounds, 351 looping, 364.1 MB of PCM**, per bank 1 / 5 / 380. **It caught a 720-byte error before anything was built on it**: `BANK_HEADER_BYTES` was 4 084 and the arithmetic never closed (4 + 400 × 12 = 4 804). The census does not argue with a document — it differences consecutive bank offsets against the PCM size `BankLkup` states, and **361 gaps all read 4 804**. Shipped, every sound would have played from inside the tail of the one before it, silently. **The rates are the second finding**: 103 distinct, 12 000 Hz carrying 59 % of every sound and the rates a reader would have guessed (22 050 / 44 100 / 11 025) together 1.5 %. **And 1/03's half in the same pass**: 155 audio zones, ALL in `audiozon.ipl` — 152 box, 3 sphere, 151 active — so 4/01 is a single load rather than a scan |
| **1/02 The bank reader** | **DONE 2026-09-08.** `packages/renderware/src/audio/sfx-banks.ts` — `readPakFiles` / `readBankLookup` / `readBankHeader` / `soundRange`, 17 tests on synthetic bytes. **Every function refuses a buffer that cannot be what it claims** (a length that is not a whole number of entries, a header that will not fit at its offset, a count past the 400 slots) because the layout is unverified until 1/01: a reader that trusted it would hand back plausible offsets into the wrong bytes. The 400-slot guard was proven load-bearing by removing it — without it the reader dies in `BinaryStream out of bounds`, a message about the wrong thing. **`soundRange` carries the one derivation worth reading twice**: `SoundMeta` stores no LENGTH, so a sound runs to the next buffer and the last runs to the end of the bank — taken as the smallest offset ABOVE this one, so the arithmetic does not assume an ordering the format never promises |
| **1/03 The `AUZO` section** | **DONE 2026-09-08.** `parseIplAudioZones` — a second pass over the same text rather than a second return value, so no caller of `parseIpl` changes. Two row shapes told apart by their WIDTH exactly as `CFileLoader::LoadAudioZone` does (nine fields box, seven sphere), `flags == 1` read as the game's `m_IsActive` starting state, and anything else DROPPED rather than guessed — a zone at `NaN` is a silence nobody could explain. 8 tests. **The zone COUNT on the real map is owed by 1/01's run**, which counts them |
| **3/01 The context and its lifecycle** | **DONE 2026-09-09, and taken OUT OF ORDER on purpose.** It is the one step in the chain that does not stand on the layout numbers 1/01 gates, so it was the work available while the census waits for the `audio/` folder. **`packages/audio` — `@opensa/audio`, `type:engine`, zero runtime dependencies**, the rule that keeps the console embeddable. `AudioHost` is built suspended and woken by **any first touch** (`pointerdown` or `keydown` through `attachGestures`), and **the listeners stay until sound is actually RUNNING**: a gesture the browser did not trust leaves the page silent, and a host that unsubscribed on the first event could never be woken again. **`waiting` and `suspended` are different facts** — nothing has touched the page, against it ran and stopped — and `resumesRefused` separates a refusal from an untouched page inside `waiting`, which is a bug in the wiring rather than in the operator. **Absence is a reported state**: no Web Audio at all is `unsupported`, one line, and a host every caller can go on using. 13 tests on a fake context driven through the real lifecycle; two mutations (collapsing `suspended` into `waiting`, and keeping the listeners after sound is on) were each caught by exactly one of them |
| **2/01 The index format** | **DONE 2026-09-09.** `packages/engine-formats/src/osaudio.ts` — magic, version, four counts, a deduplicating string blob, then packages / banks / sounds / zones as fixed-width records. **The offsets are ABSOLUTE inside the package file**, with the bank header and the buffer offset already folded in: the runtime never learns that a header is 4 804 bytes, so the day that constant is wrong again the mistake lives in one build rather than in every consumer. **Duration is NOT stored** — it is `byteLength / 2 / sampleRate` exactly, and a stored copy is one more thing that can disagree with the range beside it, so the decoder derives it. The bake is `tools/opensa-pack/src/audio-index.ts`, wired where `water.bin` and `districts.json` are written, reading **4 804 bytes a bank rather than the package** (SCRIPT alone is 304.9 MB; the whole bake is 1.8 MB of reads). 18 tests. **The byte size is OWED a measurement**: the arithmetic predicts **~154 kB** for stock SA (28 + strings + 9×4 + 370×16 + 8 857×16 + 155×36), and `scripts/debug/audio-index-bake.ts` takes the real number in seconds — the phone's tunnel went offline before it could run |
| **2/02 The reader** | **DONE 2026-09-09.** `packages/loaders/src/audio-source.ts` — `openAudioSource(gameDir, index)`, one `Range:` request a sound, the same shape `model-source.ts` uses for cars. **It refuses a host that ignored the range**: a static server answering 200 with the whole package hands back 304.9 MB whose first samples sound like a real answer, and the length is the only tell. It returns **Int16 PCM, not an `AudioBuffer`** — this package may not know Web Audio exists. Absent is `null` and a named package, never a throw. 9 tests, one of which caught a real slip on its first run: the odd-byte-count copy asked for twice the bytes it had room for, which throws on any odd-length sound and is invisible on every even one |
| **2/03 The cache and its ceiling** | **DONE 2026-09-09.** `packages/loaders/src/audio-cache.ts` — a byte-ceilinged LRU at the budget's own **64 MB**, stated once so a report and a cache cannot disagree. Least recently USED rather than added, because an ambience bed is fetched once and touched for an hour while a gunshot is touched once. **An entry larger than the whole ceiling is REFUSED and counted** rather than stored — a cache that empties itself for one sound is worse than a miss. Generic over what an entry IS, which is the one generic here and a deliberate one: chain 2 keeps PCM, chain 3 will keep the float buffers the context plays, and two caches would mean two ceilings and a budget nobody can state. The report carries bytes, entries, evictions, hits, misses and refusals. 9 tests |
| **3/02 Voices** | **DONE 2026-09-09.** `packages/audio/src/voices.ts` — a voice is a buffer source, a gain and a stereo pan, built when a sound starts and let go when it ends; a one-shot frees its own slot from `onended` and **nothing polls**. **The gain a voice is played at IS the number the pool ranks by** (`spatial.ts`'s `audibleGain`), which is what makes the stealing rule mean anything: a rule that ranked by one model while the ear heard another would steal the wrong voice and nobody could tell. **Two assumptions taken with the operator away, both stated in the code**: (1) a voice is a gain plus a stereo pan rather than a `PannerNode` — the panner would own a second distance model, it is the heavier node on the phone, and the plan already flags 64 panners as unmeasured; the formula is Web Audio's own `inverse` so a panner can take over unchanged. (2) A newcomer QUIETER than every live voice is refused rather than stealing — the decision names which voice is stolen and is silent on the newcomer, and *keep the 64 loudest things* is the consistent reading. **The falloff constants are a fitted bridge and are filed as a hack** ([audio-distance-defaults](../../hacks/audio-distance-defaults.md)): SA keeps a per-sound `m_fMaxDistance` in the executable, not in any file we parse. 27 tests across the pool and the spatial model |
| **A conformance test, unplanned and immediately useful** | **2026-09-09.** Every Web Audio type in `@opensa/audio` is a hand-written subset and the real context enters through a cast, so a member that drifted from the API would be found by a browser, at runtime, in silence. `web-audio-conformance.test.ts` makes `tsc` check it — and the first run said `AudioContextLike` was wrong: **Apple's platforms have a fifth state, `interrupted`**, entered when a phone call or Siri takes the hardware. The host reads it as `suspended` deliberately now, rather than by luck |
| **3/03 The clock** | **PARTLY DONE 2026-09-09 — the clock is built, the 2 ms is unmeasured.** `packages/audio/src/audio-clock.ts`: audio ticks on its OWN timer at 10 Hz, never on the frame, because the render gate takes drawn frames to zero at rest and a city that goes quiet when you stop panning is not a city (decision 3.2). **It times itself** — mean and worst per tick, beside the RATE, which is what makes it comparable with a per-frame budget at all: a 10 Hz clock at 1 ms a tick is 0.45 ms of a 45 fps frame, and the conversion is arithmetic on numbers it reports rather than a claim it makes. The callback gets the REAL gap, so a throttled background tab is honest rather than smooth. 8 tests. **What is owed is the device**: the budget has never been seen, and the phone's tunnel went offline mid-session |
| **3/04 The absent case** | **DONE 2026-09-09.** `packages/audio/src/absence.ts` — the four absences told apart because they are four different bugs (no index, no game dir, no package, a name nothing carries), each said ONCE however often it is asked, each counted, and the first 32 named in the report so a capture carries WHAT was missing and not only how many. **Silence has to be legible from the report**: the class this is written against cost three days in September, when every unit in the shareable demo was drawn by nothing while the roster still said 150. 6 tests |
| **4/01 The zone lookup** | **DONE 2026-09-09.** `packages/audio/src/zones.ts` — a linear scan over the 155 zones the census found, which is the right answer at this size: 155 point tests at ten a second is nothing, and an index would be a structure to keep in sync with a table that changes once a build. **The smallest containing zone wins**, the same rule the named districts use for `info.zon` — a club sits inside a district and the inner one is what the author meant. Inactive zones are skipped, and a box row whose corners arrive the other way round is normalised rather than read literally: taken at face value it is a zone nobody can be inside, which is silent rather than wrong. 7 tests |
| **4/02 is BLOCKED on a question only the operator can answer** | **2026-09-09, found while sequencing the work.** The chain's own scope puts `audio/streams/` out of v1 (*radio and ped speech are deliberately out*), and decision 4.4 says the FIRST thing anybody hears is the city's ambience — and in San Andreas those two may be the same file. SA's `CAEAmbienceTrackManager` plays ambience as a STREAM, while the SFX banks this chain reads carry **351 looping sounds** ([the census](../../benchmarks/opensa-engine/2026-09-09-phone-audio-census.json)), which is what a bed is made of. **So a zone's ambience is either a pre-mixed track we are not reading, or a bed we assemble from SFX loops**, and those are different products rather than different implementations: one is what the author mixed, the other is ours. Nothing was built past it — this is a question for the Ask Menu, not an assumption |
| **6/01 The console's audio** | **DONE 2026-09-09** (the ear and the wiring; nothing to hear until 4/02). `apps/dispatch/src/world/audio.ts` + `boot.ts`: the context is built suspended and woken by **any first touch anywhere on the page** — no gate screen on either surface — and **the listener is the CAMERA, not the ground focus**, taken from the camera's own eye and target vectors rather than from its yaw so it cannot drift from whatever north-up comes to mean. One coordinate conversion, in `map/coords.ts` beside the existing one (`engineToGta3`, the same conversion with the height kept, because altitude is exactly what makes a city quiet from 900 m). **`?audio=0` is the silent baseline** 4/03 needs, and it REMOVES the path rather than muting it. **The inventory report carries `audio`**: arm, availability, the tick's cost against its budget, the voices, and every absence — because a silent world and a broken one look identical from outside. 7 tests here, 235 across the console still green |
| **6/02 Volume and mute** | **DONE 2026-09-09.** `apps/dispatch/src/ui/audio-key.tsx` — ONE key that steps **full → half → quiet → muted → full**, sitting with the map's own controls rather than in a top bar that already clips at 360 CSS px, and OUTSIDE the compact fold because a control the operator reaches for while listening is not one to hide behind a key. It answers all five cross-platform questions by construction: `TOUCH_TARGET` through the cluster's existing `Touch` token (which `styles.test.ts` already pins at 44), one component that takes a size rather than two layouts, no hover (the meaning is in the ACCESSIBLE NAME, not the `title`), no keyboard, and it fits 360. **It is also 6/01's indicator**: the same key says `waiting`, `suspended` and `unsupported`, and pressing it RESUMES — the operator reaching for the sound control is the clearest gesture a page ever gets. **The steps are an assumption** taken with the operator away and stated in the code: a slider plus a mute button is two targets and ~120 px the bar does not have; what would settle it is wanting a level between two of these. The pool grew a master gain for it — one node every voice passes through, so mute is a value rather than a state, and a muted world goes on playing and counting. 5 tests here, and the console's 235 still green |
| **AND THE SMOKE CHECK CAUGHT A BUG NOTHING ELSE COULD** | **2026-09-09**, refreshing the prebuilt app so the phone would serve a console that can make sound. `scripts/debug/webapp-smoke.ts` came back with **79 `ReferenceError: Cannot access 'O' before initialization` a load** — and the map still drew, React carried on, and the page looked right. The audio tick was armed where the host is BUILT, which is before `boot` awaits the world and therefore before the camera exists, so the first tick read a `const` in its temporal dead zone. **No typecheck, lint or unit test sees an ordering bug inside one async function**; a check that loads the page does. Fixed by starting the clock where the camera is, with the reason written at the call site, and the prebuilt archive rebuilt and re-checked clean |
| **5/01 The event table** | **DONE 2026-09-09.** `packages/renderware/src/parsers/text/audio-events.parser.ts` (the author's rows) + `packages/audio/src/event-table.ts` (resolved against the build's own index) + [the contract](../../contracts/audio.md). **The mapping from an event to a sound is CODE in San Andreas** — `CAEVehicleAudioEntity` and its siblings — so directive 1 splits the subsystem and this is our half, written as a TABLE a mod author can override without a build (decision 2.2). `event, bank, sound, [gain], [loop|once], [maxDistance]`, read the way the game reads its own rows (commas and whitespace are one separator class), `#` comments, later row wins and the shadowed one is NAMED. **A row that points nowhere is dropped at LOAD, not at play** — a table built against a different index would otherwise fail at the moment somebody wanted the sound, which is the worst time to find out. 20 tests |
| **AND THE CONSOLE CAN PLAY ONE** | **2026-09-09.** `DispatchAudio.load()` + `play(name, position)` joins everything chain 2 and 3 built: index → table → range fetch → decode → 64 MB cache → voice. **The cache holds the FLOAT buffers rather than the PCM behind them**, because the conversion would otherwise run on every play and a 64-voice world would pay it 64 times a second. **One stock sound cannot be a buffer at its own rate** — Web Audio's floor is 3 000 Hz and the census found a sound authored at 2 021 — so every buffer is made at `max(rate, 3000)` and played at `rate / bufferRate`: the same pitch and the same duration, by arithmetic rather than by resampling. What is missing is only WHAT to play: that is 4/02's blocked question and 5/02's table |
| **A RE-READ FOUND THE CLICK BEFORE AN EAR DID** | **2026-09-09.** (1) **A stolen voice was stopped by cutting its gain, and a gain that jumps is a click** — a step in the waveform is a broadband transient, and it is what an operator would have reported the first time the pool stole. Fixed rather than filed: `AudioParamLike` grew the three scheduling methods (the conformance test says a real `AudioParam` satisfies them), and a cut voice now ramps to zero over **8 ms** — under a frame at 60 Hz — while its SLOT is freed at once, because the budget is about slots. A handful of fading voices can outlive the count for an instant, which is the price of not clicking, and 4/02's crossfade inherits the same ramp API rather than adding a second. (2) **Two plays of the same cold sound each pay for a range request**, since there is no in-flight map. One wasted request per sound and never more, so the state is not worth it — written at the line a reader would look for it |
| 4/02 · 4/03 · 5/02 · 5/03 | not started |

**THE GATE IS PASSED (2026-09-09) and chain 2 is unblocked.** The concept's §1 may be cited now, with the two
corrections the run made to it: the bank header is **4 804 bytes**, not 4 084, and the sample rates are **not**
the handful of standard values the arithmetic assumed — 103 distinct, dominated by 12 kHz, which changes the
memory sums (a second of 16-bit mono at 12 kHz is 24 kB, not 44).

**What the measurement settles for the budgets.** 364.1 MB of PCM against a 64 MB ceiling is 5.7x, so nothing
loads a package and a sound is fetched by byte range — decided by argument in the concept, decided by
measurement now. And v1 does not need the 364: **SCRIPT alone is 304.9 MB across 218 banks**, the five `SPC_*`
another 32.0 MB, while **FEET + GENRL + PAIN_A come to 28.9 MB**. Which package carries which sound is 5/01's
table to answer, not a census's — but the shape of the answer is visible, and it is tens of megabytes rather
than hundreds.
