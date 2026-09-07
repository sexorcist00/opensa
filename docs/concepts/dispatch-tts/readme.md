# Concept — a spoken radio for the dispatch console

**Status: LIVE, opened 2026-09-06** at the user's request: the dispatcher types Russian, the units hear
English, and the voice should sound like a real police radio. Research first, and the two exits are
[`docs/plans/`](../../plans/README.md) and [`docs/postmortem/`](../../postmortem/README.md).

**Recommendation, rewritten 2026-09-07 after the first listening round rejected everything in it: the
free CPU tier is not a candidate for this product, and the axis it failed on is aliveness rather than
quality.** Build the pipeline against a vendor-neutral interface — that part stands — but stop treating
"which stock voice" as the open question. The open question is **whether a voice is conditioned on a real
human recording at all**, because that is the lever the verdict points at. The dictionary is still the part
that pays for itself immediately and carries no model risk.

---

## 1. What exists today, read from the code

None of this is hypothetical. `sexorcist00/pcad` was cloned and read on 2026-09-06, and the feature has
exactly one seam because the radio already has exactly one.

| Piece | Where | What it does |
| --- | --- | --- |
| Operator types | `/r1`…`/r4 <text>` in game (`_cadparserradio.lua`), or the web radio panel | CP1251 in Lua, UTF-8 on the wire |
| Transport | WS `radio` / `phantom_transmit` `{channelId, message}` | `server.js`, token-checked per action |
| Fan-out | `RadioService.preparePhantomBroadcastPayload` → `radio_broadcast {channelId, sender, text, isPhantom}` | sent to every socket subscribed to that channel |
| Heard by the game | `cad_main.lua` → `CAD_EVENT_BUS.trigger('phantom_radio_message')` | prints into the game chat |
| Heard by the browser | `dispatcher.js` → `handleRadioBroadcast` → `appendRadioMessage` | the radio panel |
| **Audio already works in game** | `_cadparserradio.lua` loads ~30 English police-radio WAVs (`Immersive Radio/RTO`, `CPD`, `TAC`) with `loadAudioStream` and plays them with `setAudioStreamState`, at a configured `radioVolume` | this feature is the generalisation of that bank from fixed phrases to arbitrary text |
| **Async download already works** | `cad_autoupdate.lua` uses `downloadUrlToFile` | which matters: `loadAudioStream` on a URL blocks the game thread, so audio is fetched asynchronously and played from disk |

**So the whole feature is one added field on one payload.** Every client that ignores the field keeps working
exactly as it does today, which is what makes this shippable without a flag day.

## 2. What was decided with the user, 2026-09-06

Through the Ask Menu, per `CLAUDE.md`'s standing rule. These are decisions, not proposals.

| # | Decision |
| --- | --- |
| 1 | Both clients hear it — the game and the dispatcher's browser |
| 2 | Only the phantom radio (`r1`–`r4`) is voiced. Not RMS, not CAD events, not chat |
| 3 | It lives in PCAD **and** the map console gets an audio layer — see §9, this reopens 202 §7 |
| 4 | Translation is **literal plus speech normalisation**. The model may not add a fact the operator did not say |
| 5 | Every CAD user picks their own voice — dispatchers and units alike |
| 6 | The screen keeps Russian. English exists only as sound |
| 7 | Synthesis happens once, on the backend; both clients are handed a URL |
| 8 | A dictionary hit is published together with the text; a miss publishes text immediately and audio follows |
| 9 | No vendor is chosen in advance — candidates are compared by ear |
| 10 | The radio effect is baked into the file on the backend |
| 11 | On any failure: silence plus text. Never a substitute phrase |
| 12 | ~~Reference voices come from our own players, with their consent~~ — **reopened 2026-09-07: the references are real dispatch recordings.** See §5c for what that costs |
| 13 | Urgency is decided by the model reading the text, with ALL CAPS as the operator's explicit shout signal |
| 14 | The dictionary is a file base in the repository plus moderated auto-suggestions from live traffic |
| 15 | Spend is capped by one server-wide daily budget |
| 16 | On the map the audio is flat mono — a radio on the desk, not a sound in the world |
| 17 | The dictionary bank is kept forever; one-off clips live hours |

**One consequence the user named explicitly**: decisions 5 and 14 multiply. A pre-baked bank costs
*phrases × voices*, so the bank is filled **lazily** — the first use of a (phrase, voice) pair goes down the
live path and is then kept forever. The dictionary is therefore instant from the *second* use of each voice,
not the first.

## 3. The pipeline

```
RU text ─┬─ exact dictionary hit ──────────────────────────────► pre-baked WAV, 0 ms, 0 cost
         │
         └─ miss ─► translate + classify urgency (one call)
                     └─► TTS with the user's voice and that urgency
                          └─► radio chain (band-limit, compress, PTT click, roger beep)
                               └─► store, hand out a URL
```

Four properties worth naming, because each is a decision above made concrete:

- **The dictionary is checked before any model runs.** It is not a cache in front of the translator; it is a
  different path that never calls a model at all.
- **Translation and urgency are one call, not two.** The classifier needs the same context the translator
  needs, and a second round trip is a second latency.
- **ALL CAPS is an operator channel, not a heuristic.** It costs no interface and it cannot be argued with,
  which is why it overrides whatever the model concluded.
- **The radio chain is not decoration.** The client already plays a canned bank recorded through real radio;
  a clean synthetic voice next to it announces itself as a different system.

## 3b. Prior art — somebody built this for another server

Found by the user 2026-09-07: **[GTAW-Dispatch-Relay](https://github.com/coopik/GTAW-Dispatch-Relay)**, an
AI radio dispatcher for GTA World / FiveM. Read from its README, `config.yaml` and `modules/radiofx.py`;
**not from the rest of its code**, which is the limit on how much weight these conclusions carry.

**It carries no LICENSE file**, so by default all rights are reserved. Nothing of it may be copied into this
project. Reading it is fine, and reproducing its *sound* from its published parameters — which is what was
done for the listening page — is an independent implementation of standard DSP, not a derivative of its
source.

### Where it converged with us independently

Convergence is the strongest signal available that a decision is right, so these are worth more than
agreement usually is:

- **The radio chain**: band-pass 300–3000 Hz, static, mild distortion, PTT key clicks. Against our invented
  300–3400 Hz, `tanh`, noise, click. Two designs, no contact, the same numbers. **Note what that does NOT
  mean**: theirs are invented too. Nobody measured a tape — which is the step `chain_fit.py` takes past both.
- **Text normalisation before synthesis**, and phonetic callsigns (`1-Adam-12` ↔ `1A12`).
- **The LLM as a secondary layer only**, with a deterministic path that always produces something.
- **Caps flattened before synthesis.** Ours does this too, and the contract already said so — but their
  reason is different and better-founded than ours: uppercase makes the model *re-act* the emotion and
  destabilises the voice. We keep the caps as an urgency parameter and strip them from the text, which is
  the same handling arrived at from the other side.

### Three findings we did not have, and are taking

| Their finding | Why it matters here |
| --- | --- |
| `stability 0.85` plus a fixed seed | Keeps delivery flat and repeatable. Their config records that the old 0.5 let the provider re-act every request, so one dispatcher sounded bored on one call and frantic on the next. That drift is a risk §5 named and had no answer for |
| One `output_sample_rate` across every provider | Their note calls this the cure for a "chipmunk" voice — a resampling mismatch nobody thinks to look for |
| **No silent fallback to another provider** | A failed key quietly swapping voices mid-shift is a defect that presents as a personality change. Fail loudly and keep one voice |

Their ~400-model vehicle list is a fourth idea we need for a different reason — the translator may not
translate `Sultan` — but ours must come from **the build's own tables**, not a hand-kept list, per this
repository's rule about deriving from what the asset carries.

### Why it is not the same product

| | GTAW-Dispatch-Relay | This |
| --- | --- | --- |
| Source of text | the game's chat log on disk, screen OCR as fallback | the CAD's own socket — an authenticated event with a channel and a sender |
| What it does with it | **writes the broadcast**: flagger → scoring "brain" → generator | **translates what the operator typed**; adding a fact is forbidden (decision 4) |
| Who is talking | an AI standing in for a dispatcher | a human dispatcher given a voice |
| Where synthesis runs | on each listener's PC | once on the backend, one file to every client (decision 7) |
| Voices | stock (Edge / ElevenLabs / Google) | cloned from real recordings (decision 12, as reopened) |
| Language | English only | Russian in, English out |

**The consequence worth stating for whoever reads this next: half of their codebase is work we do not have
to do.** The flagger, the scoring brain, the de-duplication, the OOC filtering, the OCR, the street
gazetteer — all of it exists to *guess*, from chat text, what happened. Nothing here guesses: a transmission
arrives structured. We begin where they end.

**And on the axis this project failed its first listening round on, they do not answer.** Stock voices, no
cloning, no reference — which is the exact configuration the user rejected as artificial.

### The defect that is in both chains

Their chain band-passes, *then* drives into `tanh`, *then* bit-crushes: every harmonic the distortion creates
lands outside 300–3000 Hz and is never removed. **Ours had the same ordering** until the fitter caught it
(§5d). Their key click is appended after everything and so never crosses the channel the voice crossed —
which our beep detector reports as a 468 Hz tone that does not exist in their design.

### Measured, both channels, one instrument

| | relay | a real radio tape |
| --- | --- | --- |
| Crest factor | **14.8 dB** | 21.0 dB |
| Noise floor | −46.8 dBFS | −54.0 dBFS |
| At 3.2 kHz, relative to own midband | **18 dB louder** | — |

Their radio keeps the top of the voice; a real one throws it away. Neither is a mistake — one buys
intelligibility, the other is what a narrow channel does.

**The listening verdict is not in.** The reproduction is on its own page for the user to judge; this section
records what was measured and read, and nothing about how it sounds.

## 4. The model field, as of 2026-09

Hosted, latency is time-to-first-byte as published by the vendor or by third-party benchmarks — not measured
here:

| Model | TTFB | List price | What it gives this product |
| --- | --- | --- | --- |
| [Cartesia Sonic Turbo](https://cartesia.ai/) | ~40 ms | mid-tier | the lowest latency in the field |
| [ElevenLabs Flash v2.5](https://elevenlabs.io/text-to-speech-api) | ~75 ms | from ~$60 / 1M chars | fast tier of the quality leader |
| ElevenLabs v3 | higher | from ~$120 / 1M chars | **inline audio tags** — `[shouts]`, `[whispers]` — the only mainstream API where a shout is a first-class instruction |
| [OpenAI `gpt-4o-mini-tts`](https://platform.openai.com/docs/guides/text-to-speech) | ~300 ms class | ~$15 / 1M chars | delivery steered by a **natural-language instruction**; the same key also does the translation and the urgency call |
| [Deepgram Aura-2](https://deepgram.com/learn/best-text-to-speech-apis-2026) | ~90 ms | ~$30 / 1M chars | on-prem story |

Open weights, which is where decisions 12 (our own voices) and 15 (a capped bill) point:

| Model | Licence | Runs on | Cloning | Emotion |
| --- | --- | --- | --- | --- |
| **[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)** | Apache 2.0 | **CPU, ~4 GB RAM via ONNX** | no | no — speed only |
| **[Chatterbox](https://www.resemble.ai/learn/models/chatterbox)** | **MIT** | GPU — **measured at ~0.15× realtime on CPU here, so not a CPU option** | **zero-shot from ~5 s** | **exaggeration knob** |
| XTTS-v2 | **CPML — commercial use needs a licence** | GPU | yes | limited |
| F5-TTS | **CC-BY-NC — non-commercial, and that survives fine-tuning** | GPU | yes | limited |
| OpenF5-TTS-Base | Apache 2.0 | GPU | yes | limited |
| Piper | permissive | CPU, tiny | no | no |

**Read the licence column as the shortlist.** Two of the six best-known open models cannot be used by a
product that takes money for a server, and F5's restriction is the dangerous one because it is inherited by
anything trained on top of it. **Chatterbox and Kokoro are the two that are clean**, and they happen to split
the problem: Kokoro is the one that runs on the CPU a Node backend already sits on; Chatterbox is the one that
can carry a player's own voice and shout.

For the translation half, RU→EN is a core European pair, where a dedicated MT engine (DeepL, Google) is
roughly an order of magnitude faster and cheaper than an LLM — but it returns only a translation, and
decision 13 needs an urgency verdict from the same reading. **One LLM call that returns
`{english, level}` is the cheaper design even though it is the more expensive request**, and it is also the
only one that can be handed a glossary and a rule about not inventing facts.

## 5. What was measured here

Kokoro-82M, ONNX, **CPU only**, in this session's container. Six transmissions × five voices, radio chain
applied to each. This is the bench in [`bench/`](bench/bench.py) and the numbers are reproducible with it.

| Quantity | Value |
| --- | --- |
| Clips | 30 |
| Synthesis, median | **1076 ms** |
| Synthesis, min / max | 772 ms / 1707 ms |
| Radio chain | 4.1–9.4 ms |
| Model on disk | 311 MB + 27 MB of voice packs |
| Marginal cost | zero |

**What that number means and does not mean.** It is a container CPU with no GPU, and the transmissions are
one sentence each — which is exactly the shape of the real load. A second run taken while a large download
was competing for the same CPU moved the median to 1802 ms, and that is the honest ceiling to design
against: **on a shared box this path is a ~1–2 s tail, not a sub-second one.** Under decision 8 that is
survivable, because the text is already on screen; it is not survivable as a synchronous publish.

**What Kokoro cannot do, heard rather than argued**: it has no emotion control at all. The urgency levels in
the bench are rendered as speed alone (1.0 / 1.12 / 1.22), and `Shots fired at an officer!` comes out as a
slightly faster newsreader. If the product wants a shout, this model is not the one that gives it.

**Chatterbox, same machine, same phrase, same radio chain.** It *does* shout — one knob, `exaggeration`,
taken from 0.4 to 1.4 with `cfg_weight` dropped 0.5 → 0.3 to keep the pace — and the difference is obvious
by ear. The price is the finding:

| Quantity | Chatterbox on CPU |
| --- | --- |
| Synthesis, one 4.0 s line | **33.7 s** |
| Synthesis, one 4.3 s line | **22.3 s** |
| Realtime factor | **~0.12–0.19×** |
| Weights fetched | ~3.0 GB |

**So the two clean-licence models split the problem exactly the way the product does not want it split.**
Kokoro runs on the CPU the Node backend already occupies and cannot express urgency; Chatterbox expresses
urgency and clones a consenting player, and is 20–30× too slow without a GPU. That is not a tie to be broken
by preference — it is a hosting decision (§6's second rung) that a listening verdict cannot make on its own.

## 5b. The first field verdict, 2026-09-07

**Everything in §5 was played to the user and rejected.** The words were *"nothing appealed to me — the
voices sound artificial rather than alive"*. That is a field verdict, and by this project's own rules it
outranks every number above it.

**What it kills:** stock-voice Kokoro as the product's voice. Not as a fallback, not as the free tier for
weak servers — the whole point of the feature is that the radio sounds like a radio somebody is talking on,
and a voice that reads as synthetic fails that on the first transmission of the first shift. The 1076 ms and
the zero marginal cost are real and now irrelevant, which is exactly what a field verdict is for.

**What it does NOT settle, and this is the honest part.** The one configuration that the concept's own §6
ladder puts first was never played: **Chatterbox conditioned on a real human reference.** What was played
was Chatterbox on its built-in default voice — the model's weakest setting and the one that discards its
whole reason for being on the list. Zero-shot cloning takes timbre *and* delivery from the reference, so
"conditioned on a real dispatcher" and "stock synthetic voice" are not two points on one quality scale; they
are different mechanisms, and only the second one was judged.

So the verdict removes a tier and sharpens the question rather than closing it:

| Was judged | Verdict |
| --- | --- |
| Kokoro, five stock voices | rejected — artificial |
| Chatterbox, built-in default voice | rejected — artificial |
| **Chatterbox on a real human reference** | **not yet heard** |
| Hosted top tier (ElevenLabs v3, `gpt-4o-mini-tts` with an instruction) | not yet heard — no API key in the session |

### Round 2, run the same night: a clone beside the human it came from

The gap above was closed rather than left as a note. Chatterbox was conditioned on **17.7 s and 20.1 s of
real recorded speech in exactly the right register** — a NASA launch commentator on the countdown and a
launch-comm announcer, taken from the Internet Archive's NASA collection. They are **public domain as US
government work**, which is why they could answer the question tonight without anyone's consent being in
doubt; production references remain our own players, per decision 12.

Five transmissions, same radio chain, same CPU: **17–43 s per clip**, unchanged from §5's finding — cloning
costs no more than the default voice, and both are equally unusable without a GPU.

Both rounds are on the bench page for a side-by-side listen, with each cloned row led by the reference it
came from, because a clone can only be judged next to its original.

## 5c. Real dispatch recordings as the reference, decided 2026-09-07

Round 2 was judged **much better**, and the user's next move is to condition on **recordings of actual
dispatch traffic** — which reopens decision 12 and brings a baked-in radio channel with it. Both halves were
put through the Ask Menu and both are the user's call, reaffirmed.

### What the recordings actually contain, and why that is three things

The instinct is to treat the baked-in effect as damage. It is not — it is a **second dataset that we did not
have**, and the mistake would be to keep it welded to the first:

| What the tape carries | Where it belongs | Does it need to be clean |
| --- | --- | --- |
| **Timbre** — who is speaking | the cloning reference | **yes, critically** |
| **The channel** — band edges, compression, noise floor, squelch tail, roger beep | the parameters of our radio chain | **no — the dirtier the better, it is the measurement** |
| **Manner** — pacing, pauses, brevity, how numbers are said | the normaliser's prompt | no audio needed, only a transcript |
| **Phrasing** — what is said every shift | dictionary entries | no audio needed, only a transcript |

The user chose to take **all four**. That turns the recordings from a reference into the project's own
reference corpus, and it retires the part of §5 that was weakest: the radio chain's constants
(300–3400 Hz, `tanh` drive, −46 dBFS noise) are **mine, invented**. They become measured, which is this
repository's standing rule about recovering a real formula instead of fitting a constant.

### Cloning from a band-limited reference is the one thing we do not do

Published work is direct about it: a reference encoder encodes the artefacts along with the speaker, and
their presence **severely degrades** synthesis quality. Three further consequences show up on the second
shift rather than the first: the effect becomes part of the voice's identity and cannot be switched off, it
lands unevenly from utterance to utterance because the model invents its own noise, and our own chain then
puts a second band-limit on top of the first.

So the pipeline restores first: **[VoiceFixer](https://github.com/haoheliu/voicefixer)** (MIT — noise,
reverberation, clipping *and low bandwidth*, up to 44.1 kHz) or
**[Resemble Enhance](https://github.com/resemble-ai/resemble-enhance)** (MIT — denoiser plus a bandwidth-
extending enhancer, from the same lab as Chatterbox). [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet)
(MIT/Apache) is denoise-only and cannot return the missing octaves, so it does not answer this case.

**The honest caveat, stated before anyone hears it**: restoration *invents* the top of the spectrum that the
radio removed. The clone is of "what this person would sound like off the radio" — a well-founded guess, not
a fact.

### What reopening decision 12 costs

Stated once, because it is a real consequence and the choice is the user's:

- **Every hosted vendor is now closed.** ElevenLabs, Cartesia and the rest require the voice owner's consent
  for cloning and suspend accounts over it. The product is therefore **self-hosted only** for voice, which
  also settles §4's hosting question by removing one side of it.
- **The legal exposure sits with whoever runs the server**, not with this repository. Recordings of real
  dispatchers are recordings of identifiable people, and jurisdictions differ on what may be done with them.
- **It does not change the map.** The console still only plays a file it is handed.

### The channel is measured now, and the constants are gone

`bench/chain_fit.py` reads a recording and emits the profile our chain is built from — a third-octave
target curve, the tape's noise floor, its crest factor, and the roger beep if the channel sends one.
`bench.radio_chain_from_profile` builds a linear-phase FIR from it, drives the compressor until the crest
factor matches, and adds noise at the measured floor.

**Measured end to end**: fit a profile from a tape, push a clean clip through it, measure the result and
compare band by band — **mean 1.4 dB, max 7.3 dB over 13 scored bands** (bands below the tape's own noise
floor are excluded, because down there the output is our hiss and the comparison measures nothing). Across
the speech band, 318 Hz to 3.2 kHz, the error is 0.0–1.9 dB. The tool runs that check itself
(`--verify clean.wav`), because a fitting tool that cannot check itself should not be pointed at real tapes.

**It took four attempts, and the three failures are worth more than the result.** Each was caught only
because the fitter was first run against a file whose answer was already known — our own chain output,
built at 300–3400 Hz with a −46 dBFS floor and an 1800 Hz beep:

| Attempt | What it read | What was actually wrong |
| --- | --- | --- |
| −20 dB threshold | **82–12000 Hz** | **A defect in the radio chain, not the fitter**: `bench.py` compressed *after* band-limiting, so `tanh` harmonics landed outside the channel and were never removed. A real radio band-limits last. Fixed — and it was audible as a fizz nobody had named |
| −3 dB corner | 1828 and 3246 Hz for the same chain | A level threshold cannot separate the channel from the speaker: speech rolls off ~9 dB/octave on its own, so the reading mostly measured the voice |
| steepest slope | **5648–8133 Hz** | On a synthetic file the steepest slope is at the *bottom* of the filter skirt, where it falls into the numerical floor — not at the corner |
| third-octave curve | the curve, with no filter claimed | Right question. "Which filter was it" is unanswerable from speech; "what does the channel's response look like, so ours can match it" is both answerable and the thing we actually need |

A fifth failure sat in the *applier* rather than the fitter, and it is the same mistake in mirror image: the
first version applied the tape's curve as a filter, which multiplies the new speaker's own roll-off a second
time — 7.4 dB mean error, 21 dB at 2 kHz. The filter has to carry **target minus source**, so the applier
measures the input's own spectrum first. 7.4 dB → 2.7 dB → 1.4 dB once the noise-floor bands were excluded
from the score.

**Two beep detectors were wrong before one was right**, the same way: a peak alone proves nothing, because
speech has a loudest bin too. What separates a tone from a vowel is *concentration* — most of the window's
energy within a few percent of one frequency — and the threshold has to be relative, since ±120 Hz around a
500 Hz formant is a whole vowel and around 1800 Hz is not.

## 5e. The requirement restated, 2026-09-07 — and one part of it is not achievable

The user restated the target: *give me recordings of dispatch traffic with the radio effect on them, and
give me back a model that speaks exactly like the recording — intonation, stress, all of it, at high
quality; support several voices; and preferably no retraining.*

**"No retraining" is the easy half and it simplifies everything.** Zero-shot cloning means a voice is one
wav file in a folder: no dataset, no GPU training run, no LoRA. `dataset.py` and
[TRAINING.md](TRAINING.md) stay in the tree as the rung to climb if zero-shot is judged not good enough,
but they leave the critical path.

**"Exactly the intonation and stress" is not achievable by any zero-shot system, and the reason is
structural rather than a quality ceiling.** A cloning model is given a reference and a *new* sentence. It
transfers timbre and general speaking style; the prosody of the new sentence it must generate, because the
words are not in the reference. There is nothing to copy the stress of "Idlewood" from if nobody ever said
"Idlewood" on the tape.

Two mechanisms exist and they are different, so the plan states which one it is buying:

| Mechanism | What it copies exactly | What it needs | Fits this product |
| --- | --- | --- | --- |
| **Zero-shot TTS** (text in) | timbre, register, emotional level | a reference clip + the text | **yes** — the dispatcher types, nobody performs |
| **Zero-shot VC** ([seed-vc](https://github.com/Plachtaa/seed-vc), with a prosody-preservation control) | **the prosody exactly**, word for word | somebody actually saying the line | only where a performance exists — held in reserve |

So the honest promise is: **the same voice, the same register, the same urgency level, and controllable
pace** — with word-level stress steered by the normaliser's markup rather than by the model.

### This changes the mainline model

**[IndexTTS2](https://index-tts.github.io/index-tts2.github.io/) (Apache 2.0)** fits the restated
requirement better than Chatterbox, and it is not close:

| | Chatterbox | IndexTTS2 |
| --- | --- | --- |
| Licence | MIT | Apache 2.0 |
| Timbre and emotion | one clip, entangled | **separate references** — timbre from one recording, emotion/prosody from another |
| Urgency control | one `exaggeration` knob | **eight emotion dimensions, 0–1** — and calm/afraid/angry map onto routine/urgent/emergency directly |
| Pace | not controllable | **duration control, published at ±30 ms** |
| Published metrics | a vendor-run preference study | WER 2.1 %, speaker similarity 0.87 on LibriSpeech |

The disentangled reference is the part that matters here: **the dispatch tape can be the emotion reference
while the timbre comes from the same or another speaker**, which is as close to "speaks like the recording"
as a zero-shot system gets.

Nothing else in the design moves. Restoration still comes first (§5c), the channel is still measured and
re-applied (§5d), the dictionary still bypasses the model entirely, and several voices is still a folder of
wav files — which is the "keep it simple" half of the request, satisfied by construction.

**Not yet heard.** IndexTTS2 has not been run in this session: it is autoregressive and this container has
no GPU, and Chatterbox already measured at 0.15× realtime on this CPU. It goes into the listening round the
moment there is a GPU, and until then this section is a reading of published claims rather than a verdict.

## 6. Training our own model

Asked by the user on 2026-09-06: can we train something of our own, to pay less and sound better?

**The honest answer is that "train our own" is three different projects and only the cheapest of them is
worth doing.**

| What | What it costs | What it buys |
| --- | --- | --- |
| **Zero-shot cloning from a reference** — no training at all | ~5–30 s of audio per voice, and one GPU to serve it | our players' own voices, today. Chatterbox is MIT, so this is legally clean with their consent |
| **LoRA fine-tune of Chatterbox on one voice** | ~18 GB VRAM; published figures put a QLoRA run at 8–12 h on one H100, ~$10–16 of rented GPU. Community recipes exist | a voice that is *reliably* that person, including the radio register, rather than a good approximation |
| **Training a base model** | Kokoro's own base cost roughly $400 and ~500 A100-hours on under 100 h of curated audio | nothing this product needs. Do not do this |

**The break-even is not where it looks.** At list prices, a LoRA run pays for itself against hosted synthesis
after a few hundred thousand characters — which a busy server passes in weeks. But the GPU hours were never
the expensive part: **dataset preparation is** — recording consenting players, trimming, transcribing,
checking. Budget that in evenings of somebody's time, not in dollars.

**So the ladder is:** dictionary bank (free, immediate) → zero-shot cloning of consenting players (cheap,
no training) → LoRA on the two or three voices that get used every shift (only if zero-shot is judged not
good enough, by ear). Anything above that rung is a research project wearing a feature's clothes.

## 7. What a shift costs

Arithmetic, not a measurement — flagged as such because this repository does not let an estimate stand as a
number. Assume 300 voiced transmissions an hour across all four channels at ~90 characters each: **27k
chars/hour, ~216k over an eight-hour shift.**

| Path | Per shift | Per month |
| --- | --- | --- |
| ElevenLabs Flash, list | ~$13 | ~$390 |
| OpenAI `gpt-4o-mini-tts`, list | ~$3.20 | ~$97 |
| Self-hosted Kokoro / Chatterbox | $0 marginal | the box |
| Any of the above, with a dictionary carrying 40 % of traffic | −40 % | −40 % |

**The dictionary is the cheapest optimisation available and it is also the one that improves the product**,
because a real dispatch service says the same forty things all shift and says them identically. That is not
a compromise — it is what the thing being imitated actually sounds like.

## 8. What is silent here

In this repository's sense: what breaks without anything reporting it.

- **A translated fact nobody said.** Decision 4 forbids it, but nothing enforces it: the audio is English,
  the screen is Russian, and no operator will ever notice that the voice sent a unit to the wrong street.
  **A test over the glossary and a fixed refusal in the prompt are the only guards, and both are weak.**
  This is the reason the register decision was "literal" rather than "radio-style".
- **A voice that changes mid-shift.** With a lazily-filled bank, the first use of a phrase in a voice comes
  from the live path and every later use comes from the bank. If a model version changes underneath, the two
  differ, and it presents as the radio being inconsistent rather than as a cache being stale. **The bank must
  key on the model and voice version, not just the phrase.**
- **The daily budget running out mid-incident.** Decision 11 says silence, decision 15 says one shared
  budget: together they mean the radio can go quiet exactly during the busiest hour of the week, which is
  when it will be blamed on the feature being broken. **The operator needs to see the budget state before it
  is spent, not after.**
- **CP1251.** The Lua client encodes to CP1251 and the payload is UTF-8. A mis-decoded Russian string does
  not throw — it produces mojibake, which a translator model will cheerfully translate into confident
  nonsense and speak aloud.

## 9. Scope — and the 202 §7 amendment

[Plan 202 §7](../../plans/202-pcad-dispatch/readme.md) said, since 2026-08-06: *"Not the voice/chat layer.
PCAD carries the dispatcher's traffic to units; the console does not become a radio."* **The user reopened
that on 2026-09-06**: the map console gets an audio layer, so it plays what the backend sends on the channels
the operator is subscribed to.

The boundary that survives, and it is the one that mattered: **the console plays a file it is handed; it does
not synthesise, translate, mix by position, or own any part of the radio.** Decision 16 keeps it flat mono
precisely so that no audio graph, no listener pose and no dependency on the camera enters the map component.
The narrow shell↔map interface of 202 §4 gains one message and no coupling.

The wire contract the three codebases build against is written down: [`docs/contracts/dispatch-radio-voice.md`](../../contracts/dispatch-radio-voice.md), which is what [202 phase 2](../../plans/202-pcad-dispatch/readme.md) asks this repository to own.

**Everything else is PCAD's**, in the other repository: the dictionary, the models, the budget, the bank, and
the added field on `radio_broadcast`. Nothing in this concept is actionable in this repository beyond the
console's playback and this document — the same posture as
[go-backend](../go-backend.md).

## 10. What would have to be true to graduate this

To `docs/plans/` — or, since the work lives in the other repository, to a plan there:

1. **A voice is chosen by ear**, from the bench, by the person who will run the shift. Not from §4's table.
   **First round done 2026-09-07 and nothing passed** (§5b) — so this now reads: a voice conditioned on a
   real human reference, or a hosted voice, is chosen by ear. The stock-voice question is closed.
2. **The dictionary's hit rate is measured** on a real evening of `radio_broadcast` traffic. Under ~30 % the
   latency story in decision 8 is weaker than it looks and the cost table in §7 is wrong.
3. **The shout is demonstrated.** Either a model that can shout is in the pipeline, or decision 13 is
   downgraded honestly to "faster and clipped", and the difference is heard before it is written down.
4. **Consent for reference voices is collected in writing** from the players who lend them, because decision
   12 is what keeps every vendor's terms satisfied.

It dies to `docs/postmortem/` if the first evening of live use shows operators turning it off — which is a
field verdict and outranks every number above.
