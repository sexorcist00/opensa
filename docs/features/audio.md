# Audio (plan 203)

`packages/audio/` (the context and its lifecycle, voices, the spatial model, the zone lookup and the
ambience bed), `packages/renderware/src/audio/sfx-banks.ts` (the SFX index),
`parsers/text/ipl.parser.ts` → `parseIplAudioZones` (the map's audio zones),
`parsers/text/audio-events.parser.ts` and `parsers/text/vehicle-audio.parser.ts` (the two authored tables),
`scripts/debug/audio-census.ts` (the gate).

**The whole path exists now, and what is missing is AUTHORED DATA.** Index, range fetch, cache, voices,
listener, ambience and the console's controls are all in; nothing is heard until a build's
`data/audio-events.dat` carries rows ([the contract](../contracts/audio.md)), and no ear has judged any of it
yet. [The chain](../plans/203-audio/readme.md) is the order it was built in and
[the concept](../plans/203-audio/concept.md) carries the fourteen decisions it inherits.

## Implemented

- **The SFX index, read from the author's own files** (203/1-02): `PakFiles.dat` (52-byte names),
  `BankLkup.dat` (12-byte entries) and the 4 804-byte bank header of 400 `SoundMeta` (measured, not documented — it was 4 084 in the code until 2026-09-09), plus `soundRange` —
  (package, bank, slot) → a byte range, a rate and a loop point. **A sound's LENGTH is not stored anywhere**:
  a buffer runs until the next one begins and the last runs to the end of the bank, taken as the smallest
  offset ABOVE this one so the arithmetic does not assume ascending slots.
- **Audio zones** (203/1-03): the `AUZO` section our IPL parser skipped on purpose — a box (9 fields) or a
  sphere (7), `flags === 1` meaning active. A second pass over the same text, so no caller of `parseIpl`
  changed.
- **The audio context and the autoplay gate** (203/3-01): built suspended, woken by **any first touch** —
  `pointerdown` or `keydown`, wired through `attachGestures`, and the listeners stay until sound is actually
  RUNNING because a gesture the browser did not trust leaves the page silent. `waiting` and `suspended` are
  different states (nothing has touched the page, against it ran and stopped) and `resumesRefused` separates
  a refusal from an untouched page inside `waiting`.
- **Three mixer buses** (204/1-01): `master → { cad, map, world }`, one gain each, and a voice names which it
  plays on. The stealing rule ranks WITHIN a bus, and a bus below its reserve may take a slot from one above
  its own — which is what makes *a panel alert is never refused* true rather than likely. Before this, a
  positionless alert was ranked by its bare gain against sixty-four car engines and lost.
- **A limiter on the master** (204/1-02): hard knee, ratio 20, -6 dBFS, after the master rather than before
  it so the operator's own volume makes it work less. Clipping is the most recognisable *not-AAA* artefact
  there is and nothing else in the chain prevented it; `limiter.reduction` is reported because how hard the
  mix pushes is a fact about the content.
- **Ducking** (204/1-03): an alert pulls the world and the map down 12 dB and lets them back up, derived from
  the state of the `cad` bus rather than asked for — a duck a caller must remember is one somebody forgets. It
  multiplies the operator's level rather than replacing it.
- **Four mixes on one key, persisted** (204/1-04): `full` → `work` (the city under the work) → `alerts` →
  `muted`. Levels rather than a master volume, because *everything quieter* was never what a dispatcher
  wanted; one control rather than three sliders, because the cross-platform rule forbids the second. Muting
  leaves the panic button and the lost link audible at a floor, and the key's own label says so.
- **A synthesised floor under every panel sound** (204/2-02): eighteen tones, pure and deterministic, no
  bytes and nothing to 404. A deployment that ships the authored set sounds like PCAD; one that cannot still
  alerts, and the report says which layer answered.
- **The panel's event API** (204/2-03, 2-04): eighteen names on the bus their category owns, resident so
  nothing fetches on the path, latency measured from when the EVENT happened rather than from the speaker,
  a 900 ms per-name coalescing window and a 3 % detune so a burst is one tone and a count rather than a
  machine gun.
- **The board's own events** (204/3-01): two `Operations` snapshots diffed into event names — a call appears
  coded by its priority, a unit commits, a unit reaches its scene, a call clears. On the audio clock, because
  the board moves whether or not a frame was drawn for it; the FIRST board raises nothing.
- **The CAD seam, and a stand-in on it** (204/3-02): a message names its sound in `sound_trigger` and never
  in its title; one that names none plays `notification` and is COUNTED. `link_lost` / `link_back` are
  derived rather than sent, and neither is said until a CAD has answered once. `?cad=0` removes the stand-in
  and leaves the seam.
- **Every event is also SEEN** (204/3-03): `map` needed nothing — the board already draws it — and every
  `cad` event now gets a line, 4 s, and 15 s for the two FLOORED names. The feed belongs to the CONSOLE
  rather than to its audio, so a muted console, a browser with no Web Audio and plan mode all still receive.
- **The backgrounded tab** (204/3-04): the alert path touches no timer, and an event arriving at a suspended
  context asks for it back on the way past. What IS throttled is listed in the contract and accepted.
- **PCAD's half** (204/4): [PR #13](https://github.com/sexorcist00/pcad/pull/13) — the title search deleted,
  four events that had no sound at all, and calls coded by priority. Awaiting the user's review.
- **The output peak, measured** (204/5-01): `voices.peakSample` is the loudest sample that actually left the
  graph, tapped after the limiter; `voices.peakByBus` says how many of a full pool were alerts.
- **Absence is a reported state, never a throw**: no Web Audio in the environment is `unsupported`, one line
  in the log, and a host every caller can go on using.

- **The event table** (203/5-01): `data/audio-events.dat` — our own vocabulary, `event, bank, sound,
  [gain], [loop|once], [maxDistance]`, read the way the game reads its own rows and documented in
  [`docs/contracts/audio.md`](../contracts/audio.md). A row that points at a bank this build has not got is
  dropped at LOAD and named, never at the moment somebody wanted the sound.
- **The console can play a named event**: `DispatchAudio.load()` then `play(name, position)` — index →
  table → one Range request → decode → the 64 MB cache → a voice.
- **The ambience bed** (203/4-02): `packages/audio/src/ambience.ts`. A place's bed is `AMB_<ZONE>` rows in
  the same event table, up to four layers, each played as a **twin loop** — two voices of one sound started a
  third to two thirds apart, one audible, their volumes exchanged at a random 1.5–6 s interval so the loop's
  own period never becomes a rhythm. That idiom is San Andreas' `CAETwinLoopSoundEntity`, taken by behaviour;
  what is ours is the ramped exchange (SA's is a step, and a step is a click), the drawn-apart start points,
  the 2 s crossfade between zones, and the height rule that keeps a console quiet at 900 m.
  **SA itself plays no general ambience bed at all** — its street sound is emergent from traffic and peds,
  which a dispatch console has none of ([the recovered design](../gta-sa-original/audio-ambience.md)).

- **The board's cars, heard** (203/5-02): an engine and a siren per unit
  (`apps/dispatch/src/world/unit-audio.ts`). **An engine is TWO sounds** — an idle loop and a rev loop
  crossfaded by speed, never restarted, which is SA's own dummy-engine model with every constant recovered
  rather than fitted (`packages/audio/src/vehicle-engine.ts`). Speed is a field of the dispatch domain
  because the PCAD contract will publish it. The siren is OURS — SA keeps which vehicle wails in code — so
  it is a `VEH_SIREN_<KIND>` row keyed by service, running while a unit is `enRoute`. A unit past the
  falloff's own reach is not given a voice at all: a car is two of them, and the budget is 64.
- **A car's engine sound, as authored data** (203/5-02, the read layer):
  `parsers/text/vehicle-audio.parser.ts` reads FLA's `data/gtasa_vehicleAudioSettings.cfg` — the table that
  exists on our target only because the `sa` build always runs FLA, since in the stock game these settings
  are compiled into the executable. Fifteen columns, `-1` read as absent everywhere the file means it that
  way, a row that is not fifteen columns DROPPED rather than read past its end. The column meanings are
  [a fact about the original](../gta-sa-original/vehicle-audio-settings.md).

## Not implemented

- **Feet, impacts and weapons** (203/5-03) — the half of chain 5 with no authored data at all, so every row
  is a decision and it needs its own questioning round first.
- **The authored rows themselves.** No build ships an `audio-events.dat`, so every surface is silent by
  absence rather than by fault, and the report says which.
- **Radio and ped speech are deliberately out of v1** — `audio/streams` is a different problem with a
  different licence and a browser question the SFX path does not have (Vorbis decoding is absent from Safari
  before 18.4).

## Measured on the real files (2026-09-09)

[The census row](../benchmarks/opensa-engine/2026-09-09-phone-audio-census.json) — `LAYOUT AGREES`, so the
numbers below are measurements rather than documentation:

- **9 packages · 370 banks · 8 857 sounds · 351 looping · 364.1 MB of PCM**, per bank 1 / 5 / 380.
- **103 distinct sample rates**, and not the ones anybody would guess: 12 000 Hz carries 59 % of every sound,
  15 000 another 22 %, 8 000 a further 11 %, while 22 050 + 44 100 + 11 025 together are 1.5 %. One sound is
  authored at 2 021 Hz. At 12 kHz a second of 16-bit mono is **24 kB**, not the 44 the concept assumed.
- **The bank header is 4 804 bytes** — derived, not documented, from 361 consecutive-bank gaps that all read
  the same. It was 4 084 in this code until the census said otherwise.
- **155 audio zones, all in `audiozon.ipl`** — 152 box, 3 sphere, 151 active. No other IPL carries an `AUZO`
  section, so the zone lookup is a single load.
- **Where the bytes are**: SCRIPT 304.9 MB across 218 banks (83.7 %), the five `SPC_*` 32.0 MB, and
  FEET + GENRL + PAIN_A 28.9 MB. Against the chain's 64 MB budget the whole set is 5.7x over, which is why a
  sound is fetched by byte range and nothing loads a package.

## Known gaps

- **No fixture.** 1/02's tests run on synthetic bytes the test itself writes. A cached fixture under
  `fixtures-src/` (per the fixture rule: one manifest line, never a file dropped by hand) is owed once a real
  bank is reachable.
- **The budgets are named and unmeasured**: 64 concurrent voices, 2 ms of CPU a frame, 64 MB, and ≤ 200 ms
  from the gesture to the first sound. 64 voices each with a `PannerNode` is a number nobody here has
  measured on a Mali phone. Since 204/5-01 the capture can ANSWER the panel half of that row — event →
  audible ms, `refusedByBus.cad`, the output peak, voices per bus at peak — but the phone has not been asked.
- **The authored panel sound files are not in the bundle.** The raw set is **2.9 MB against a 1 MB budget**,
  so it needs transcoding before it can ship at all; until then every panel name resolves to its synthesised
  tone and the report says so. That is the budget doing its job rather than an obstacle.
- **The PCAD sound MAPPINGS are placeholders.** PR #13's four new events and its three priority tones were
  assigned only so no two events sound alike; nobody has listened to them in those roles.
- **No ear has heard any of it.** Every number in the ambience bed is arithmetic against the census —
  the swap window, the exchange ramp, the crossfade and the height bounds are all
  [a fitted bridge](../hacks/audio-twin-loop-swap.md) waiting on the operator's own verdict, which is what
  203/4-02 asks for and 4/03 measures.
