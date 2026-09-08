# Concept — audio: the game's own sound, from the banks the author shipped

**Status: live, and NOTHING is decided in it.** Opened 2026-09-08 on the user's instruction — *"I want the
game's sounds; it matters that it is done well and reliably"* — after
[201's handoff §5e](../plans/201-dispatch-console/handoff.md) recorded that audio has never been planned and
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
([termux.md](../development/termux.md)). Sources at the end of the section.

### The SFX side — `audio/CONFIG/` + `audio/SFX/`

| Structure | Layout |
| --- | --- |
| `PakFiles.dat` | package names, **52 bytes each**, null-terminated and `0xCD`-padded. Nine stock packages: `FEET`, `GENRL`, `PAIN_A`, `SCRIPT`, `SPC_EA`, `SPC_FA`, `SPC_GA`, `SPC_NA`, `SPC_PA` |
| `BankLkup.dat` | an array of **12-byte** entries: `PackageIndex` u8 · 3 bytes padding · `BankHeaderOffset` u32 · `BankSize` u32 |
| bank header (inside a package) | **4 084 bytes**: `NumSounds` u16 · u16 padding · 400 × `SoundMeta` |
| `SoundMeta` | **12 bytes**: `BufferOffset` u32 (from the end of the header) · `LoopOffset` i32 (in SAMPLES, `-1` = no loop) · `SampleRate` u16 · `Headroom` i16 |
| the samples | **signed 16-bit mono PCM**, no encryption anywhere on this path |
| `BankSlot.dat` | 45 fixed slots × 12 824 bytes — the original's RAM budget for banks, which is a 2004 machine's answer and not ours ([directive 2](../project-goals.md)) |

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

### And the half that is NOT data — where [directive 1](../project-goals.md) cuts

**The mapping from an EVENT to a (bank, sound) is CODE in San Andreas**, not a table: it lives in
`CAEVehicleAudioEntity`, `CAEPedAudioEntity`, `CAEWeaponAudioEntity` and their siblings
([gta-reversed](../links.md)). So the project's first directive splits this subsystem cleanly in two:

- **the banks, the samples, the rates, the loop points, the headroom** are authored DATA — read them as the
  author meant them, or every sound mod ever written stops meaning what it says;
- **the event mapping is 2004 LOGIC**, and *"that is what the original does"* is the beginning of an argument
  rather than the end of one. It has to be recovered as MEANING and re-expressed in a table of ours.

**One lucky exception, and it is the one that unblocks a vertical slice.** Vehicle audio settings ARE a table
on our target: FLA exposes `data/gtasa_vehicleAudioSettings.cfg` (15 columns, the first being the model
name), this repository's installer already merges rows into it, and
[`docs/contracts/vehicles.md`](../contracts/vehicles.md) already documents `audio.txt` as a mod author's
contract for exactly that row. The engine-sound consumer therefore has authored data to read on day one, and
a contract mod authors are already writing against.

**Sources**: [SFX (SA)](https://gtamods.com/wiki/SFX_(SA)) · [Audio stream](https://gtamods.com/wiki/Audio_stream) ·
[gta-reversed-modern](https://github.com/gta-reversed/gta-reversed-modern) · the repo's own
[contracts/vehicles.md](../contracts/vehicles.md). The two wiki pages are in [links.md](../links.md) with
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
- **A frame budget is part of the specification** ([directive 5](../project-goals.md)), and audio has two:
  the per-frame CPU of the update (positions, gains, culling) and the decode/fetch cost that must never land
  inside a frame.

---

## 3. What the restrictions already decide, before anything is designed

Read before writing this document, per the maintenance rule:

- **[build-vs-runtime](../restrictions/build-vs-runtime.md)** — what is decided while the game is BUILT
  cannot be recovered while it runs, and a pack OUTPUT is never re-packed or read as a source. If audio is
  baked, the choice of codec and granularity is permanent for that build.
- **[architecture](../restrictions/architecture.md)** — a `type:engine` package must be Node-free; a
  non-game surface reaches the game layer through the environment driver alone; a production surface may not
  stand on a `debug*` switch.
- **[cross-platform-surface](../restrictions/cross-platform-surface.md)** — one engine on PC and mobile, the
  difference a BUDGET rather than a branch; a control ships on both in the same change (a mute button is a
  control).
- **[assets-and-data](../restrictions/assets-and-data.md)** — a rule derives from what the asset CARRIES,
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
([the fixture rule](../../CLAUDE.md)), so even that waits on a device.

**No implementation plan is written yet, and that is the process working**: the planning skill's own gate is
an approved spec, and this project's standing rule is that nothing is implemented before the user has been
questioned through the Ask Menu. The plan (`docs/plans/203-…`, or a tool's chain if the bake half wins
[Q2](#round-1--the-frontier)) is written when Round 1 and Round 2 are answered.

---

## 5. The rounds

**Prepared 2026-09-08 while the user was away; nothing is acted on until they are answered.** They go through
the Ask Menu (`CLAUDE.md`'s standing rule) one round at a time — a question whose answer depends on another
still-open one belongs to a later round, which is why the tree above has the shape it does.

### Round 1 — the frontier

| # | Question | Options | The recommendation, and why |
| --- | --- | --- | --- |
| **Q1** | **What does "the game's sounds" mean for v1?** | (a) the world's SFX only — engines, feet, gunshots, impacts, ambience; (b) SFX + radio; (c) everything, speech included; (d) a vertical SLICE: one looping positioned engine, one one-shot, end to end | **(d) first, then (a).** The slice is chosen to be the hardest SHAPE rather than the smallest piece — a looping, positioned, pitch-shifted engine driven by authored data exercises every seam this subsystem has. Radio is a separate lane (Ogg, stereo, no spatialisation, no event map) that can land at any time and proves nothing about the architecture |
| **Q2** | **Where do the bytes come from at runtime?** | the three approaches in §4 | **(3) split**, unless the phone measurement kills it. The index is small enough to bake in seconds and the sample fetch is arithmetic we already do for cars — but this is a [build-vs-runtime](../restrictions/build-vs-runtime.md) decision and it is permanent per build, so it is the user's |
| **Q3** | **Which layer owns the `AudioContext`?** | (a) a new `@opensa/audio` package (`type:engine`, Node-free, framework-agnostic); (b) a system inside `@opensa/game`; (c) inside `@opensa/engine` | **(a).** The console imports exactly one thing from `packages/game` (the environment driver) and that boundary is a restriction; audio in `game` is audio the second consumer cannot have. Audio in `engine` is worse — it is not the frame |
| **Q4** | **Does the dispatch console get audio at all?** | (a) no, silent; (b) UI only — an alert when a call comes in; (c) the world's audio too | **(b).** A dispatcher works a shift beside other windows, and a map that plays traffic is a map that gets muted. But (c) is the one that would prove the engine layer stayed an engine, so this is a product call, not a technical one |

### Round 2 — unlocked by Round 1

- **If baked (Q2a/Q2c)**: which codec (Opus is the honest default; AAC where Safari matters), what granularity
  (per sound, per bank, one atlas), and what a rebuild costs on a phone.
- **If live (Q2b/Q2c)**: the cache policy and its share of the 300–500 MB ceiling; what a cold street corner
  costs on first arrival; whether a bank is prefetched by zone.
- **The event map** (the §1 split): do we (i) recover SA's mapping wholesale into our own table, (ii) invent
  our own event vocabulary and map it ourselves, or (iii) seed ours from the recovered one and diverge where
  we can do better? And **where does that table live** — a new authored file a mod author may override, or
  code?
- **The listener**: the camera, the player, or the camera with a player bias (which is what the original
  does, and therefore needs an argument rather than a citation).
- **Vehicle audio**: `gtasa_vehicleAudioSettings.cfg` is authored data we already merge — do we read it in v1,
  and what happens for a car with no row (the same question `audio.txt` already answers for the real game)?
- **The budgets**, named before the work: concurrent voices on a phone, ms/frame for the audio update, MB of
  buffers, and what happens when the voice budget is exhausted (steal the quietest? the oldest? the furthest?).
- **The autoplay gesture**: where each surface gets its first trusted gesture, and what the operator/player
  sees before it happens.

### Round 3 — after the design is agreed

- **How a verdict is taken.** A sound change cannot be judged by a test: it is a field verdict, on the device,
  and this project's rule is that better must be DEMONSTRATED. What is the pass/fail?
- **The mod contract** — what a sound mod ships, how it is found, and what happens when it is misspelled
  (`docs/contracts/` gets a subject file, and the rule that a name carrying behaviour is documented in the
  same change).
- **Where the plan lives**: `docs/plans/203-…` if it is engine work, or a tool's own chain if the bake half
  dominates.

---

## 6. The go/no-go

**This graduates to a plan when** Round 1 and Round 2 are answered, the phone has verified the format numbers
in §1 against the real files, and the budgets in Round 2 are written down. **It dies to a postmortem if** the
measurement says the sample delivery cannot fit beside the world inside the phone's ceiling and no
granularity fixes it — in which case the honest outcome is radio and UI audio only, which is a different and
much smaller product.

**What would make it fail quietly**, and therefore what the plan must guard: a subsystem that sounds right on
the desk of whoever wrote it and drowns a phone; an event map that reproduces SA's logic instead of its
meaning; and a bake that makes a mod author's sound unreachable without a rebuild nobody told them about.
