# Concept — audio: the game's own sound, from the banks the author shipped

**Status: GRADUATED 2026-09-08 into [plan 203](readme.md), which is what gets built.** This is the research
record that produced it, moved here whole per the documentation lifecycle — a resolved concept never stays in
`docs/concepts/`. It was written before any decision existed and it is kept in that voice on purpose: §1–§4
are the facts, §5 is what the four rounds settled, and reading it in that order is how the next agent sees
why each answer was the answer.

**Its original status line, for the record:**
**Status: live, and NOTHING is decided in it.** Opened 2026-09-08 on the user's instruction — *"I want the
game's sounds; it matters that it is done well and reliably"* — after
[201's handoff §5e](../201-dispatch-console/handoff.md) recorded that audio has never been planned and
that nothing exists. This document is the **research half**, which is the agent's job; every DECISION it
turns up is a question in [§5](#5-the-rounds), and none of them is answered here.

Classified **architectural** by [`brainstorming`](https://github.com/obra/superpowers) (a new subsystem, no
existing flow to change), so the path is: context → questions → approaches → design → this document → the
user's review → a plan. The skill's default spec location (`docs/superpowers/plans|specs/`) does not apply —
`CLAUDE.md` sends a not-yet-committed direction here, and a validated one to `docs/plans/` with its research
record moving into it.

---

## 0. What exists today, checked rather than remembered

| | |
| --- | --- |
| `AudioContext`, sample loading, any playback | **nothing, anywhere** in `apps/`, `packages/` or `tools/` |
| A plan, roadmap row, idea or postmortem about audio | **none** |
| SA's audio formats in `@opensa/renderware` | **not parsed**: no `SFXPak`, no `BankLkup`, no stream reader |
| The only `audio` in the repository | `audio.txt` — a vehicle audio ASSIGNMENT row the installer merges into the REAL game's FLA table, which the real game then plays. Not us |

So this is a greenfield subsystem, and the last thing it should be is a player bolted onto a frame loop. The
work is in three parts and only one of them is Web Audio.

---

## 1. What the DATA actually is

Read out of the format documentation rather than out of the files — **the game files live on the phone and
this container has none**, so every number below is owed a verification pass on the device
([termux.md](../../development/termux.md)). Sources at the end of the section.

### The SFX side — `audio/CONFIG/` + `audio/SFX/`

| Structure | Layout |
| --- | --- |
| `PakFiles.dat` | package names, **52 bytes each**, null-terminated and `0xCD`-padded. Nine stock packages: `FEET`, `GENRL`, `PAIN_A`, `SCRIPT`, `SPC_EA`, `SPC_FA`, `SPC_GA`, `SPC_NA`, `SPC_PA` |
| `BankLkup.dat` | an array of **12-byte** entries: `PackageIndex` u8 · 3 bytes padding · `BankHeaderOffset` u32 · `BankSize` u32 |
| bank header (inside a package) | **4 804 bytes**: `NumSounds` u16 · u16 padding · 400 × `SoundMeta`. **This table said 4 084 until the census measured it on 2026-09-09** — the arithmetic never closed, and 361 gaps between consecutive banks all read 4 804 |
| `SoundMeta` | **12 bytes**: `BufferOffset` u32 (from the end of the header) · `LoopOffset` i32 (in SAMPLES, `-1` = no loop) · `SampleRate` u16 · `Headroom` i16 |
| the samples | **signed 16-bit mono PCM**, no encryption anywhere on this path |
| `BankSlot.dat` | 45 fixed slots × 12 824 bytes — the original's RAM budget for banks, which is a 2004 machine's answer and not ours ([directive 2](../../project-goals.md)) |

**The consequence is the most important fact in this document: every sound in the game is addressable by
arithmetic.** Package → header offset → `SoundMeta[i]` → a byte range. Nothing has to be unpacked, decoded or
re-indexed to fetch exactly one sample, which is the same shape `apps/dispatch/src/world/model-source.ts`
already uses to pull one car out of a gigabyte archive over HTTP Range. That makes a **no-build-step** delivery
path genuinely possible rather than merely appealing — see [Q2](#round-1--the-frontier).

### The stream side — `audio/streams/`

Ogg Vorbis, obfuscated rather than encrypted: the whole file is XOR'd with a repeating **16-byte key**
`EA 3A C4 A1 9A A8 14 F3 48 B0 D7 23 9D E8 FF F1`. Each track carries an **8 068-byte** header — 1 000 beat
entries of 8 bytes (`timing` ms or `-1`, `control` code), 8 length pairs of two DWORDs, and a 4-byte
`01 00 CD CD` footer — followed by the Ogg payload.

**The beat track is authored data nobody else exposes**, and it is worth naming now because a design that
throws it away cannot get it back: 1 000 timed beats per track is what the original drives its radio-synced
behaviour from.

### And the half that is NOT data — where [directive 1](../../project-goals.md) cuts

**The mapping from an EVENT to a (bank, sound) is CODE in San Andreas**, not a table: it lives in
`CAEVehicleAudioEntity`, `CAEPedAudioEntity`, `CAEWeaponAudioEntity` and their siblings
([gta-reversed](../../links.md)). So the project's first directive splits this subsystem cleanly in two:

- **the banks, the samples, the rates, the loop points, the headroom** are authored DATA — read them as the
  author meant them, or every sound mod ever written stops meaning what it says;
- **the event mapping is 2004 LOGIC**, and *"that is what the original does"* is the beginning of an argument
  rather than the end of one. It has to be recovered as MEANING and re-expressed in a table of ours.

**One lucky exception, and it is the one that unblocks a vertical slice.** Vehicle audio settings ARE a table
on our target: FLA exposes `data/gtasa_vehicleAudioSettings.cfg` (15 columns, the first being the model
name), this repository's installer already merges rows into it, and
[`docs/contracts/vehicles.md`](../../contracts/vehicles.md) already documents `audio.txt` as a mod author's
contract for exactly that row. The engine-sound consumer therefore has authored data to read on day one, and
a contract mod authors are already writing against.

**Sources**: [SFX (SA)](https://gtamods.com/wiki/SFX_(SA)) · [Audio stream](https://gtamods.com/wiki/Audio_stream) ·
[gta-reversed-modern](https://github.com/gta-reversed/gta-reversed-modern) · the repo's own
[contracts/vehicles.md](../../contracts/vehicles.md). The two wiki pages are in [links.md](../../links.md) with
what each one settled.

---

## 2. What the PLATFORM gives us, and what it takes

- **Web Audio is the answer and it is not the work.** Spatial panning, mixing, looping and a mute button with
  no dependency at all. **FMOD was assessed and refused** (handoff §5e): a proprietary licence with revenue
  terms, a wasm payload inside an app that boots in seconds on a phone whose milliseconds this project has
  spent two days defending, and a console that ships as an embeddable widget with **zero runtime
  dependencies** — a rule strong enough that `panel-window.tsx` refused `react-rnd` over it.
- **The autoplay gate is real and it is a design constraint, not a detail.** An `AudioContext` created before
  the document has had a user gesture starts **suspended**, and `resume()` must follow a trusted gesture —
  on Android too. Whether our surfaces already have such a gesture is a fact to check on each of them, and
  the console's own answer may differ from the game's.
- **Ogg Vorbis decoding is not universal.** `decodeAudioData` takes Vorbis in Chrome, Firefox and Edge, but
  Safari only since **18.4** (partial 14.1–18.3) and iOS Safari since **18.5**. Radio therefore carries a
  browser question that the SFX path does not.
- **Memory is already spoken for.** 201's budget is a hard **300–500 MB** ceiling on a phone, for the WORLD.
  Audio competes with it: 16-bit mono PCM at 22 050 Hz is ~44 kB per second of sound, so a naive "load the
  bank" costs megabytes per bank and a naive "load the package" costs hundreds.
- **A frame budget is part of the specification** ([directive 5](../../project-goals.md)), and audio has two:
  the per-frame CPU of the update (positions, gains, culling) and the decode/fetch cost that must never land
  inside a frame.

---

## 3. What the restrictions already decide, before anything is designed

Read before writing this document, per the maintenance rule:

- **[build-vs-runtime](../../restrictions/build-vs-runtime.md)** — what is decided while the game is BUILT
  cannot be recovered while it runs, and a pack OUTPUT is never re-packed or read as a source. If audio is
  baked, the choice of codec and granularity is permanent for that build.
- **[architecture](../../restrictions/architecture.md)** — a `type:engine` package must be Node-free; a
  non-game surface reaches the game layer through the environment driver alone; a production surface may not
  stand on a `debug*` switch.
- **[cross-platform-surface](../../restrictions/cross-platform-surface.md)** — one engine on PC and mobile, the
  difference a BUDGET rather than a branch; a control ships on both in the same change (a mute button is a
  control).
- **[assets-and-data](../../restrictions/assets-and-data.md)** — a rule derives from what the asset CARRIES,
  never from the slot it sits in. A sound rule keyed on "the comet's engine" is the exact shape this project
  has already banned.

---

## 4. The design tree

Each node is a decision; an edge means the child cannot be sensibly answered before the parent.

```
Scope of v1 ─┬─ where the bytes come from ─┬─ codec + granularity (if baked)
             │                             ├─ cache + residency policy (if runtime)
             │                             └─ what a sound MOD ships  ──── the contract doc
             ├─ which layer owns the context ─┬─ how the game drives it (events? polling?)
             │                                └─ does the console get audio at all
             ├─ the event → sound mapping ─┬─ our table's shape and where it lives
             │                             └─ how much of SA's logic we recover first
             └─ the budgets (voices, ms/frame, MB) ──── how a verdict is taken (field? A/B?)
```

Three approaches were considered for the SHAPE of the whole thing, and they are what
[Q2](#round-1--the-frontier) and [Q3](#round-1--the-frontier) put to the user rather than settle:

1. **Baked** — a build stage turns the banks into our own format (re-encoded, indexed), the pak carries it.
   Smallest bytes, fastest start, one more stage in a ~50-minute pipeline, and a mod author's replaced sound
   needs a rebuild.
2. **Read live** — the served game dir is the source, exactly as vehicle models already are: Range requests
   against the original packages using the arithmetic in §1. No build step, mods work by dropping a file,
   the original's format stays an import path — and the wire carries raw PCM.
3. **Split** — the INDEX is baked (tiny: the lookup tables, our event map, the durations) and the SAMPLES
   are fetched live. The build stage is seconds rather than minutes, and the two halves fail independently.

### The scope check, which is the planning skill's first question and it has an answer already

[`writing-plans`](https://github.com/obra/superpowers) refuses a spec that covers several independent
subsystems and asks for one plan per subsystem, each producing working software on its own. **This is such a
spec**, and the split is not arbitrary — it falls out of §1's own seams:

| Sub-project | What it delivers alone | Depends on |
| --- | --- | --- |
| **A. The bank reader** | `@opensa/renderware` parses `PakFiles`/`BankLkup`/a bank header and hands back one sample's bytes, rate and loop point. Testable on fixtures, no browser, no sound | nothing |
| **B. Delivery** | those bytes reach a browser — baked, live, or split ([Q2](#round-1--the-frontier)) | A |
| **C. The voice layer** | an `AudioContext`, a listener, positioned voices, a mixer, a mute, and a budget that steals a voice rather than dropping a frame | B |
| **D. The event map** | *this thing, in this state, makes that sound* — our own table, re-expressed from recovered meaning | C |
| **E. Radio** | the streams: XOR, Ogg, a station, the beat track. Shares nothing with A–D but the context | C |
| **F. The console's own layer** | whatever [Q4](#round-1--the-frontier) says the dispatcher hears | C |

**A is worth starting whatever the rest turn out to be**, because it is the one piece no decision changes: a
reader that can name every sound in a package is what makes the other five answerable with numbers instead of
opinions. It is also the piece this container could build today — except that the fixtures come from the game
files, which live on the phone
([the fixture rule](../../../CLAUDE.md)), so even that waits on a device.

**No implementation plan is written yet, and that is the process working**: the planning skill's own gate is
an approved spec, and this project's standing rule is that nothing is implemented before the user has been
questioned through the Ask Menu. The plan (`docs/plans/203-…`, or a tool's chain if the bake half wins
[Q2](#round-1--the-frontier)) is written when Round 1 and Round 2 are answered.

---

## 5. The rounds, and what they settled

**Asked and answered 2026-09-08** through the Ask Menu, in four rounds worked as a design tree — each round
the whole settled frontier, then recompute. Recorded here as the record of record; the reasoning that
produced each recommendation is above.

| # | Decision | The answer |
| --- | --- | --- |
| 1.1 | Scope of v1 | **All of the world's SFX** — engines, feet, weapons, impacts, ambience. Radio and speech are OUT of v1 (neither was chosen) |
| 1.2 | Where the bytes come from | **Split**: the index is baked, the samples are fetched live by byte range |
| 1.3 | Which layer owns the context | **A new `@opensa/audio`** package, `type:engine`, Node-free, no runtime dependencies |
| 1.4 | Does the console get audio | **Yes, the world too** — the second consumer hears the city, not just its own alerts |
| 2.1 | How our event table is built | **Take the reverse.** The user's call: names and tables come from `gta-reversed`; see 3.1 for the licence question it raised and how it was closed |
| 2.2 | Where the table lives | **An authored data file**, overridable by a mod, documented in `docs/contracts/` in the same change |
| 2.3 | The console's listener | **The camera, as it is.** Honest attenuation: at 900 m there is nearly nothing to hear, and the world arrives as the operator zooms in |
| 2.4 | The budgets, named before the work | **64 voices · 2 ms/frame · 64 MB** on a phone |
| 3.1 | The licence, re-asked against the fact that this repository is PUBLIC and AGPL-3.0 | **The decision stands**, taken knowingly. Recorded here with its date and its basis so nobody re-opens it — and note the half it does not settle: [directive 1](../../project-goals.md) forbids porting the LOGIC whatever the licence says, so tables and names are taken and behaviour is written here |
| 3.2 | Audio when the console idles | **Its own clock.** The render gate takes drawn frames to zero at rest (201/4-01, a shipped battery figure); audio runs on a slow tick of its own, so a still map still sounds like a city. The battery cost is owed a measurement |
| 3.3 | The autoplay gesture | **Any first touch** wakes it, with an honest indicator in the chrome until then — no gate screen on either surface |
| 3.4 | How a verdict is taken | **The operator's ear on the phone**, plus the numbers that do not need one (voices, ms, MB, steals, load misses) |
| 4.1 | Where the baked index lives | **A file beside the pak**, the way `water.bin` and the district table already are — so a sound fix costs seconds and never a world rebuild |
| 4.2 | Voice stealing at the budget | **The quietest at the listener** — computed from attenuation, so the rule derives from what the sound carries rather than from a category ([assets-and-data](../../restrictions/assets-and-data.md)) |
| 4.3 | A build with no audio at all | **Silence, one line per name in the log, counted in the report** — the same shape the unit-model fallback already has, and the exact class of defect that cost 2026-09-05 three days of invisible units |
| 4.4 | What must sound FIRST | **The city's ambience** |

## 6. What the answers make true, before a plan is written

**The first deliverable begins in a parser, not in a browser — and the ordering choice landed on authored
data.** SA picks its ambience by AUDIO ZONE (`CAEAmbienceTrackManager` reads `CAudioZones`), and those zones
are an **`AUZO` section of the IPLs** — `name id flags x y z radius` for a sphere, eight numbers for a box
(`CFileLoader::LoadAudioZone`). That is exactly the class of authored data this project already reads, and
**our IPL parser skips it on purpose today**: *"`pick`, `jump`, `tcyc`, `auzo`, `mult` are out of scope and
ignored"* (`packages/renderware/src/parsers/text/ipl.parser.ts`). So step one is a section we already have a
parser shaped for, testable on fixtures, no sound involved.

**The six sub-projects from §4 keep their order, with A and D re-pointed by 4.4:**

| | | |
| --- | --- | --- |
| **A** | the bank reader + the `AUZO` section | `@opensa/renderware`, fixtures, no browser |
| **B** | the baked index beside the pak, and the live range fetch | a build step of seconds, plus a reader |
| **C** | the voice layer: context, listener, panning, the 64/2/64 budget, quietest-first stealing | `@opensa/audio` |
| **D** | the ambience consumer, driven by the zone the listener stands in | the first thing anybody hears |
| **E** | the rest of the world's SFX behind our event table | the long half |
| **F** | the console's own wiring — camera listener, its own idle clock | shares C entirely |

**Three consequences worth stating rather than discovering**, each following from two answers that were taken
separately:

- **The console will be nearly silent at its working zoom.** 2.3 keeps the camera as the listener and 4.4
  makes ambience the first sound; a map at 900 m therefore hears almost nothing until the operator zooms in.
  That is the honest physics they chose, and it is a thing to LOOK at on the device before deciding it is
  wrong.
- **Audio on its own clock (3.2) partly spends what render-on-demand bought.** 4/01 shipped with a battery
  figure; audio at rest is new work at rest. The `power` block landed in the report today, so the delta is
  measurable rather than arguable — and it must be measured on the first console build that has sound.
- **`AUZO` is map data, so a total conversion that ships none gets no ambience** — which 4.3 already answers
  (silence and a line), and which the contract doc has to state in a mod author's words.

## 7. The go/no-go

**This graduates to a plan when** the format numbers in §1 are verified against the real files on the phone
(the container has none), because everything B does is arithmetic over them. **It dies to a postmortem if**
the sample delivery cannot fit beside the world inside the phone's ceiling and no granularity fixes it.

**What would make it fail quietly**, and therefore what the plan must guard: a subsystem that sounds right on
the desk of whoever wrote it and drowns a phone; an event map that reproduces SA's logic instead of its
meaning; a bake that makes a mod author's sound unreachable without a rebuild nobody told them about; and a
console whose audio quietly holds the device awake.
