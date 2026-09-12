# The listening bench

**What it answers:** which voice a dispatcher would accept for a shift, and what one transmission costs in
milliseconds on a machine with no GPU. It is deliberately a *listening* instrument — this project's rule is
that better must be demonstrated, and a table of vendor latencies has never told anyone whether
`Shots fired at an officer!` sounds like an emergency.

Everything here runs locally and costs nothing, which is also the cheapest half of the concept's own cost
question.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile scipy numpy

# the weights are not committed - 311 MB + 27 MB, fetched once
curl -L -O https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -O https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

.venv/bin/python bench.py --out ./out --models-dir .
```

On Termux the same commands work; `pkg install python` first, and expect the ONNX session to be the slow
part rather than the download.

## What it writes

| File | What it is |
| --- | --- |
| `kokoro-<voice>-<phrase>-clean.wav` | the raw synthesis |
| `kokoro-<voice>-<phrase>-radio.wav` | the same, through the radio chain that the backend would bake |
| `montage-<voice>.wav` | every transmission in one file, so a voice is judged as a shift rather than as a clip |
| `timings.json` | per-clip synthesis and chain milliseconds, and the realtime factor |

**Judge the montages, not the clips.** A voice that is pleasant on one line and wrong on the next is the
failure this format catches, and it only shows up when the transmissions are heard back to back the way an
operator hears them.

## The phrases

Six, in [`phrases.json`](phrases.json), each chosen for a thing that can go wrong: a callsign and address
that must be spoken rather than read, the ALL-CAPS shout, the short constant the dictionary would bake, an
urgent line with no caps that only a classifier can raise, a numeric code that must survive translation, and
a vehicle name the translator must leave alone.

The English lines are written by hand. In production they come from the translator model — writing them here
keeps the bench about the **voice**, which is the thing being chosen.

## Chatterbox, and why it is behind a flag

```bash
.venv/bin/pip install chatterbox-tts          # ~5 GB with torch, weights ~3 GB more
.venv/bin/python bench.py --out ./out --models-dir . --chatterbox [--reference voice.wav]
```

It is the only clean-licence model here that can shout (`exaggeration` 0.4 → 1.4 per urgency level) and the
only one that can carry a consenting player's voice from a few seconds of `--reference`. **On CPU it runs at
roughly 0.15× realtime** — 22–34 s for a four-second transmission — so it is off by default and belongs
behind a GPU rather than on the box the Node backend already occupies.

Installing it downgrades numpy to 1.26, which `kokoro-onnx` declares against but runs on regardless. If that
stops being true, give each backend its own venv rather than pinning around it.

## What it does not do

- **No cloud vendor.** Adding one is a function beside `run_kokoro` and an API key; the concept's §4 table
  says which are worth the key.
- **No translation.** The English lines are fixed, so the bench measures the voice and never the translator.
