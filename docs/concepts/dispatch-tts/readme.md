# Concept — a spoken radio for the dispatch console

**Status: LIVE, opened 2026-09-06** at the user's request: the dispatcher types Russian, the units hear
English, and the voice should sound like a real police radio. Research first, and the two exits are
[`docs/plans/`](../../plans/README.md) and [`docs/postmortem/`](../../postmortem/README.md).

**Recommendation, stated up front so it can be argued with: build the pipeline against a vendor-neutral
interface and pick the voice by ear rather than from a table, because the three things this product needs —
our own community's voices, a shout that is actually a shout, and a per-character bill that does not scale
with how chatty a shift is — are not all strongest in the same model.** The dictionary is the part that pays
for itself immediately and it is the part with no model risk at all.

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
| 12 | Reference voices come from our own players, with their consent |
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
| **[Chatterbox](https://www.resemble.ai/learn/models/chatterbox)** | **MIT** | GPU (CPU is slow) | **zero-shot from ~5 s** | **exaggeration knob** |
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
slightly faster newsreader. If the product wants a shout, this model is not the one that gives it — which is
the single sharpest finding of the bench and the reason Chatterbox is on the list.

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

**Everything else is PCAD's**, in the other repository: the dictionary, the models, the budget, the bank, and
the added field on `radio_broadcast`. Nothing in this concept is actionable in this repository beyond the
console's playback and this document — the same posture as
[go-backend](../go-backend.md).

## 10. What would have to be true to graduate this

To `docs/plans/` — or, since the work lives in the other repository, to a plan there:

1. **A voice is chosen by ear**, from the bench, by the person who will run the shift. Not from §4's table.
2. **The dictionary's hit rate is measured** on a real evening of `radio_broadcast` traffic. Under ~30 % the
   latency story in decision 8 is weaker than it looks and the cost table in §7 is wrong.
3. **The shout is demonstrated.** Either a model that can shout is in the pipeline, or decision 13 is
   downgraded honestly to "faster and clipped", and the difference is heard before it is written down.
4. **Consent for reference voices is collected in writing** from the players who lend them, because decision
   12 is what keeps every vendor's terms satisfied.

It dies to `docs/postmortem/` if the first evening of live use shows operators turning it off — which is a
field verdict and outranks every number above.
