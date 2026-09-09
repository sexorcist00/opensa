# The audio chain, in one session (2026-09-09)

Plan [203](../plans/203-audio/readme.md) went from *a gate nobody had passed* to *a console with an ear, a
sound key and a `play(name)` that reaches a voice* in one day: **29 commits, 3 702 lines of new audio code
across 26 files, 74 tests in `@opensa/audio` alone**, and — the part that matters more — **five defects
caught by instruments rather than by ears**, three of which would have shipped silently.

Nothing here is a runtime measurement. **The device half is owed and says so**: the phone's tunnel went
offline mid-session and the 2 ms / 64 MB / battery figures have never been taken. What exists is one COUNT
row ([the census](../benchmarks/opensa-engine/2026-09-09-phone-audio-census.json)) and this audit.

## What changed

| Layer | What landed |
| --- | --- |
| Read | `renderware/audio/sfx-banks.ts` (the SFX index), `parseIplAudioZones` (the map's `AUZO` rows), `parseAudioEvents` (our own event table) |
| Format | `engine-formats/osaudio.ts` — the baked index, absolute byte ranges, a deduplicating string blob |
| Build | `opensa-pack/audio-index.ts` — the bake, beside `water.bin` and `districts.json`, reading 4 804 bytes a bank rather than 364 MB of packages |
| Wire | `loaders/audio-source.ts` (one Range request a sound), `loaders/audio-cache.ts` (a 64 MB LRU) |
| Voice | `@opensa/audio` — the context and the autoplay gate, the spatial model, the 64-voice pool with quietest-at-the-listener stealing, the 10 Hz clock, the absence recorder, the zone lookup, the event table |
| Surface | `apps/dispatch` — the ear on the camera, the sound key (volume and mute in one control), the `audio` report field, `?audio=0`, and the two loose-file fetches that give it something to hear |
| Instruments | `audio-census.ts` (the gate), `audio-index-bake.ts` (what the index costs), `audio-bank-probe.ts` (what a sound IS, and a WAV to hear it) |

## What it bought

**The gate is passed and the format is measured rather than documented.** 9 packages, 370 banks, **8 857
sounds**, 351 looping, **364.1 MB of PCM**, per bank 1 / 5 / 380, **103 distinct sample rates**, 155 audio
zones all in one file. Every number the concept stood on is now a reading.

**Two of those readings changed the design.** The rates are not the standard handful — 12 kHz carries 59 % of
every sound while 22 050 + 44 100 + 11 025 together are 1.5 % — so a second of 16-bit mono is 24 kB rather
than the 44 the memory arithmetic assumed. And 364.1 MB against a 64 MB ceiling is 5.7x, which settles by
measurement what the concept settled by argument: nothing loads a package.

## What it cost

**One day, and five defects that were nearly free to fix and would have been expensive to find later.**

| Found by | The defect | Why it would have been expensive |
| --- | --- | --- |
| The census (its first real run) | `BANK_HEADER_BYTES` was **4 084**, not 4 804 — the arithmetic never closed (4 + 400 × 12) | Every sound would have played 720 bytes early, from inside the tail of the one before it, and SILENTLY: the shift is constant, so lengths stay positive and nothing overruns |
| The conformance assertion (its first run) | `AudioContextLike` lacked **`interrupted`**, a state only Apple's platforms report | A phone call would have left the console reading *nobody has touched the page yet* and inviting a gesture that was not the problem — on a platform nobody here owns |
| The webapp smoke check | The audio tick was armed **before the camera existed**, and its first firing read a `const` in its temporal dead zone | 79 errors a load with the map still drawing and the page looking right. No typecheck, lint or unit test sees an ordering bug inside one async function |
| A re-read | A **stolen voice was cut**, not faded — a gain that jumps is a broadband transient | The first click an operator hears is the first bug report, and it would have arrived after the ambience did |
| A re-read | `boot` built the context **above its own failure paths**, orphaning it plus two window listeners on every non-WebGPU browser | Once per load, silently, on exactly the browsers that fall back to plan mode |

**And one unit test earned its keep on the spot**: the odd-byte-length case in `audio-source` caught a copy
that asked for twice the bytes it had room for — invisible on every even-length sound, which is most of them.

## What is NOT done, and why

- **4/02, ambience, is blocked on a QUESTION rather than on work.** SA plays ambience as a STREAM
  (`CAEAmbienceTrackManager`), and this chain's v1 excludes `audio/streams`; the SFX banks carry 351 looping
  sounds, which is what a bed is made of. So a zone's bed is either the author's pre-mixed track or one we
  assemble — **different products, not different implementations** — and nothing was built past it.
  `audio-bank-probe --loops` exists to put evidence in front of that decision.
- **Every number in the budget table is unmeasured**: 64 voices, 2 ms a frame, 64 MB, ≤ 200 ms to the first
  sound. The `silent` link (`?audio=0`) is the baseline the battery figure subtracts from, and it has never
  been flown.
- **The index's own byte size is predicted, not measured** (~154 kB by arithmetic). One command takes it.
- **The event table has no rows yet.** Writing them needs the bank probe on a device, and the naming is
  5/02's work.

## The assumptions taken with the operator away

Both are written at the code that acts on them, not only here:

1. **A voice is a gain plus a stereo pan, not a `PannerNode`.** The panner would own a second distance model
   — and the pool's stealing rule ranks by the same gain the ear hears, so two models would steal the wrong
   voice inaudibly. The formula is Web Audio's own `inverse`, so a panner can take over unchanged.
2. **A newcomer quieter than every live voice is refused rather than stealing.** The decision names which
   voice is stolen and is silent on the newcomer; *keep the 64 loudest things* is the consistent reading.

And one fitted constant, filed as the debt it is:
[`docs/hacks/audio-distance-defaults.md`](../hacks/audio-distance-defaults.md) — SA keeps a per-sound
`m_fMaxDistance` in the executable rather than in any file this project parses, so the falloff is a bridge
until 5/01's table carries the real thing.
