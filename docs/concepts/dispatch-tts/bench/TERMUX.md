# Running the measuring half on the phone

No GPU exists on Android. Under Termux (or PRoot) the device presents as a headless
Linux box with no graphics device at all, there is no CUDA, and PyTorch has no official
Termux wheels — so **synthesis does not run here**, and anything that claims otherwise
is going to waste an evening. What runs here is the half that matters first: measuring
your own tapes and putting a measured channel onto audio.

That half was deliberately made dependency-light. `scipy` is a build adventure on
Termux and `soundfile` wants `libsndfile`, so [`dsp.py`](dsp.py) implements what these
tools need in **numpy and the standard library alone**. When scipy and soundfile are
installed they are used and behaviour is unchanged; when they are absent the numpy path
takes over.

**Verified rather than asserted.** The same tape measured both ways gives the same
curve to the printed precision — 0.000 dB difference on the Welch spectrum
(`python dsp.py --selftest <wav>`). The band-pass is an FIR standing in for a
Butterworth and differs by ~0.4 dB in band, which the self-test prints and labels.

## Install

```bash
pkg install python ffmpeg
pkg install python-numpy       # pip-building numpy on Termux fails; the package works
pkg install termux-api         # only for termux-wake-lock on long runs
```

Nothing else. No scipy, no soundfile, no torch.

```bash
git clone <this repo> && cd opensa/docs/concepts/dispatch-tts/bench
python dsp.py --selftest some.wav      # says scipy is absent, which is correct here
```

## Prepare a tape

The numpy reader takes PCM wav only, so convert whatever you have:

```bash
ffmpeg -i tape.m4a -ac 1 -ar 24000 -sample_fmt s16 tape.wav
```

Mono, 24 kHz, 16-bit. Keep the original — every re-encode costs bandwidth the
measurement is trying to read.

## Measure your channel

```bash
python chain_fit.py tape.wav --out chain.json
```

Prints the third-octave response curve, the noise floor, the crest factor and the
roger beep if the channel sends one, and writes them to `chain.json`. Point it at
several tapes at once and it takes the median.

**Read the caveats it prints.** A tape that was already resampled reports the
resampler's edge rather than the radio's, and bands under the noise floor are
measuring hiss.

## Put that channel on other audio

```bash
python - <<'EOF'
import json, bench
from dsp import read_wav, write_wav
profile = json.load(open("chain.json"))["chain"]
audio, rate = read_wav("clean.wav")
write_wav("through-your-radio.wav", bench.radio_chain_from_profile(audio, rate, profile, beep=True), rate)
EOF
```

Or check how closely it lands, which is the same thing the fitter scores itself with:

```bash
python chain_fit.py tape.wav --verify clean.wav
```

## Take the radio off a voice

```bash
python restore.py tape.wav --out clean/ --backend denoise
```

`--backend denoise` is spectral subtraction in numpy: it removes hiss and **cannot
return the bandwidth the radio removed**. The restoration that does that (VoiceFixer)
needs PyTorch and therefore a machine that is not this one. On the phone this is a
tidy-up, not a restoration.

## The console

A dispatch console you drive from the shell and listen to in the phone's own browser.

```bash
python console.py                 # then open http://localhost:8765
python console.py --once "открыт огонь по офицеру"
```

Type what an operator would type. The page shows what the pipeline decided — glossary
hit or miss, the English that would be spoken, the urgency and **why**, the speakable
form, whether capitals fired, and whether the repeat filter suppressed it.

**A glossary miss stays silent.** There is no translator here, and in production a
phrase with no English has no voice either (decision 11). Watching a miss go out as
text with no sound is the point of the tool, not a gap in it.

Type in **Latin letters** and the console treats it as an audition: it speaks the line
as typed, so a voice can be judged without pretending it came off a radio.

### Voices

The selector lists what is installed on **this** machine and says why the rest are not.

| Backend | Gives a file | On a phone |
| --- | --- | --- |
| **Bank** | yes, pre-baked | **the only one that is a product**: instant and free |
| **Phone voice (browser)** | no | Web Speech API over Android's own engine — zero install, offline, real voices, and no file, so the radio channel cannot be applied |
| **espeak-ng** | yes | `pkg install espeak-ng`. Robotic, but a real wav, so the measured channel bakes onto it |
| **Piper** | yes | usually needs `proot-distro`: native builds are glibc, Android is bionic |
| **Kokoro-82M** | yes | same wheel problem via onnxruntime; works inside proot |
| **External service** | yes | `--tts-url http://host:8000/v1/audio/speech` — where a GPU box or a cloud plugs in later |

Bake your measured radio channel onto everything the file backends render:

```bash
python chain_fit.py tape.wav --out chain.json
python console.py --chain chain.json
```

## Long runs

Android suspends processes. Hold anything long with:

```bash
termux-wake-lock
...
termux-wake-unlock
```

## What is NOT here, and where it goes instead

| | Why | Where |
| --- | --- | --- |
| Synthesis (Kokoro, Chatterbox, IndexTTS2) | no GPU on Android; Chatterbox measured 0.15x realtime on a *server* CPU | a machine with a GPU, or a slow offline bake |
| VoiceFixer restoration | needs PyTorch | same |
| Whisper transcription for the dataset | needs PyTorch or a heavy runtime | same |

The product's own architecture already assumes this split: synthesis happens once on
the backend and every client is handed the finished file. The phone is a client there
too.
