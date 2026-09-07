# Training a voice on your own dispatch recordings

The pipeline from a folder of tapes to a model that speaks in your dispatchers' voices, and an honest
account of what each rung costs. Everything here runs on the recordings you already have.

**Read [the concept](readme.md) first** — in particular §5c, which records that decision 12 was reopened
(references are real dispatch recordings) and what that closes: **every hosted vendor**, because their terms
require the voice owner's consent for cloning. Voice becomes self-hosted only, and the legal exposure sits
with whoever runs the server.

## The ladder, cheapest rung first

Climb it in order and stop at the first rung that sounds right. Each one is a different amount of work, not
a different amount of quality along one scale.

| Rung | What it is | Cost | When to climb past it |
| --- | --- | --- | --- |
| **0 · dictionary** | the phrases said every shift, synthesised once and kept forever | free after the first use | never — this rung is always on |
| **1 · zero-shot clone** | Chatterbox conditioned on 5–30 s of one restored recording | a GPU to serve it; no training at all | when the voice is *nearly* right but drifts between transmissions |
| **2 · LoRA fine-tune** | the same model, adapted to one speaker on minutes of their audio | ~18 GB VRAM; published figures put a QLoRA run at 8–12 h on one H100, about $10–16 rented | when one voice is used every shift and has to be exactly that person |
| **3 · base model** | training a TTS model from scratch | Kokoro's own base cost roughly $400 and ~500 A100-hours on under 100 h of curated audio | **never, for this product** |

**The expensive part is never the GPU hours.** It is preparing the data — segmenting, transcribing,
checking the transcripts, and throwing away what is wrong. The scripts below do the mechanical half; the
checking is yours.

## Which model, and the licence trap

**Chatterbox**, MIT. It is the only permissively-licensed model that does both things this product needs —
zero-shot cloning from a few seconds, and an urgency knob (`exaggeration`) that turns a read line into a
shout.

Two models that look like alternatives and are not:

- **F5-TTS** is CC-BY-NC. Non-commercial, **and it is inherited by anything fine-tuned on the base model** —
  training on your own recordings does not launder it. `mrfakename/OpenF5-TTS-Base` is the Apache-2.0
  reimplementation if you want that architecture.
- **XTTS-v2** ships under Coqui's CPML: commercial use needs a licence.

**Kokoro** (Apache 2.0) is fine-tunable — community recipes exist — but it cannot clone and has no emotion
control at all, which is what the first listening round rejected it for.

## The pipeline

All of it lives in [`bench/`](bench/) and needs `numpy scipy soundfile` plus, per stage, `voicefixer`,
`faster-whisper` and `chatterbox-tts`.

### 1 · Take the radio off the voice

```bash
python restore.py tapes/*.wav --out clean/ --backend voicefixer
```

A dispatch tape carries the speaker and the channel welded together, and a reference encoder learns both.
[VoiceFixer](https://github.com/haoheliu/voicefixer) (MIT) undoes the weld: denoise, dereverb, declip, and
extend the bandwidth the radio removed.

**Measured against a known original** — our own clean synthesis, put through a radio chain and then
restored:

| | vs the true clean original |
| --- | --- |
| after the radio chain | mean **5.3 dB**, max **27.9 dB** |
| after restoration | mean **2.4 dB**, max **6.7 dB** |

At 5 kHz the chain had removed 19 dB; restoration returned it to within 4.6 dB. **It really does rebuild the
missing octaves** — and it *invents* them, so the result is what this person would plausibly sound like off
the air. Right input for a cloning model; wrong input for anything forensic.

### 2 · Measure the channel before you throw it away

```bash
python chain_fit.py tapes/*.wav --out chain.json --verify clean/example.wav
```

The tape's radio character is worth keeping — as **parameters**, not as part of the voice. This writes a
third-octave target curve, the noise floor, the crest factor and the roger beep frequency;
`bench.radio_chain_from_profile` puts that channel back on synthesised speech, and `--verify` scores how
closely it lands (**1.4 dB mean, 7.3 dB max** on the reference tape used while building it).

### 3 · Build the dataset

```bash
python dataset.py tapes/*.wav --out dataset/ --speaker dispatch-1
```

Restores, cuts into transmissions, transcribes with faster-whisper, and writes the LJSpeech layout every
open recipe reads (`wavs/`, `metadata.csv`) plus a `manifest.json` saying what was dropped and why.

**The one gate you must not remove.** On degraded radio audio Whisper does not fall silent — it invents
fluent, confident text, and the invention passes every obvious filter: `no_speech_prob` stays low and the
word count is high. A dataset built on invented text is worse than no dataset, because it teaches wrong
alignments and nothing reports it. What separates invention from transcription is **confidence**: measured
over two tapes, correct transcripts scored `avg_logprob` −0.31 to −0.63 and hallucinations −0.85 to −0.91,
so the gate sits at **−0.7**.

That threshold came from ten segments. `dataset.py` prints the confidence distribution of *your* corpus
every run — re-derive it there rather than inheriting this number, and read `manifest.json`'s dropped rows
to check the gate is cutting in the right place.

**How much audio.** Rung 1 needs seconds. Rung 2 wants minutes of clean speech per voice — start around
10–20 minutes of *kept* clips, which is far more raw tape than it sounds once the gate has run.

### 4 · Fine-tune

Chatterbox's community fine-tuning toolkits read the LJSpeech layout that step 3 writes, so the dataset
drops straight in. Train on a rented GPU; **CPU is not an option** — measured here, plain inference runs at
about 0.15× realtime, 22–34 s for a four-second transmission.

After a run, judge it the way the first round was judged: the same six transmissions, through the measured
channel, played back to back as one shift. The bench does that already.

## What to watch for

- **The fine-tune learns the restorer's guess.** Everything above the radio's cutoff was invented in step 1.
  If two voices are restored differently they will sound like different people for that reason alone.
- **A voice trained on one channel carries it.** If the tapes come from more than one radio system, either
  keep the datasets apart or expect a voice that averages both.
- **Recordings of real people are a decision, not a detail.** Consent and jurisdiction sit with whoever runs
  the server; this repository owns only the map that plays the resulting file.
