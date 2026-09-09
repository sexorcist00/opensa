# Audio (plan 203)

`packages/audio/src/audio-host.ts` (the context and its lifecycle), `packages/renderware/src/audio/sfx-banks.ts`
(the SFX index), `parsers/text/ipl.parser.ts` → `parseIplAudioZones` (the map's audio zones),
`scripts/debug/audio-census.ts` (the gate).

**Nothing is audible yet, and that is the accurate state.** What exists is the read layer and the object that
decides whether a page may make a sound at all. There is no sample fetch, no voice, no mixer and no
consumer — [the chain](../plans/203-audio/readme.md) builds them in that order, and
[the concept](../plans/203-audio/concept.md) carries the fourteen decisions they inherit.

## Implemented

- **The SFX index, read from the author's own files** (203/1-02): `PakFiles.dat` (52-byte names),
  `BankLkup.dat` (12-byte entries) and the 4 084-byte bank header of 400 `SoundMeta`, plus `soundRange` —
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
- **Absence is a reported state, never a throw**: no Web Audio in the environment is `unsupported`, one line
  in the log, and a host every caller can go on using.

## Not implemented

- Everything audible: the baked index beside the pak, the range fetch, the cache, voices, the listener,
  ambience, and every consumer (vehicles, feet, impacts, weapons).
- **Radio and ped speech are deliberately out of v1** — `audio/streams` is a different problem with a
  different licence and a browser question the SFX path does not have (Vorbis decoding is absent from Safari
  before 18.4).

## Known gaps

- **The format numbers are still DOCUMENTATION.** Every constant above comes from format documentation
  rather than from a file: the census that turns them into measurements has run and reported a named skip,
  because the phone's game copy carries no `audio/` folder. Until it says `LAYOUT AGREES`, nothing
  downstream may be built on those numbers.
- **No fixture.** 1/02's tests run on synthetic bytes the test itself writes. A cached fixture under
  `fixtures-src/` (per the fixture rule: one manifest line, never a file dropped by hand) is owed once a real
  bank is reachable.
- **The budgets are named and unmeasured**: 64 concurrent voices, 2 ms of CPU a frame, 64 MB, and ≤ 200 ms
  from the gesture to the first sound. 64 voices each with a `PannerNode` is a number nobody here has
  measured on a Mali phone.
