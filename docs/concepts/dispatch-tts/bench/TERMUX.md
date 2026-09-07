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
