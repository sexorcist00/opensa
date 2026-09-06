"""Listening bench for the dispatch radio voice.

Runs the same six radio transmissions through every backend that is installed and
writes a pair of files for each - the raw synthesis and the same audio through the
radio chain that the backend would bake in production. The point is a verdict by
ear, per this project's rule that better must be demonstrated rather than assumed.

Usage:
    python bench.py --out ./out --models-dir /path/holding/kokoro-v1.0.onnx

Backends are skipped, loudly, when their package is missing. Nothing here talks to
a paid API: every model runs locally, which is also the cheapest half of the
concept's cost question.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

# The radio chain. Values are the ones a real land-mobile radio imposes: the
# channel is band-limited to the telephone band, heavily compressed, and every
# transmission is topped and tailed by the PTT click and the roger beep.
BAND_LOW_HZ = 300.0
BAND_HIGH_HZ = 3400.0
NOISE_FLOOR_DBFS = -46.0
ROGER_BEEP_HZ = 1800.0
ROGER_BEEP_MS = 90.0
CLICK_MS = 18.0

# Kokoro exposes speed and nothing else - no emotion, no shouting. Raising the
# rate is the whole of what this backend can do with an urgency level, and saying
# so is the point of measuring it next to a backend that can do more.
LEVEL_SPEED = {"routine": 1.0, "urgent": 1.12, "emergency": 1.22}

DISPATCH_VOICES = ["af_heart", "af_bella", "am_onyx", "am_michael", "bm_george"]

# Chatterbox does have an urgency lever: exaggeration drives how hard the delivery is
# pushed, and lowering cfg_weight with it keeps the pace from collapsing. These are the
# values the 2026-09-06 bench was judged on.
LEVEL_CHATTERBOX = {
    "routine": (0.4, 0.5),
    "urgent": (0.8, 0.4),
    "emergency": (1.4, 0.3),
}


@dataclass(frozen=True)
class Phrase:
    id: str
    ru: str
    en: str
    level: str


def _db_to_amp(db: float) -> float:
    return float(10.0 ** (db / 20.0))


def _normalise(audio: np.ndarray, peak_dbfs: float = -1.0) -> np.ndarray:
    peak = float(np.max(np.abs(audio))) or 1.0
    return audio * (_db_to_amp(peak_dbfs) / peak)


def radio_chain(audio: np.ndarray, sample_rate: int, *, beep: bool) -> np.ndarray:
    """Band-limit, compress and tag one transmission the way a radio would."""
    nyquist = sample_rate / 2.0
    band = signal.butter(
        4,
        [BAND_LOW_HZ / nyquist, min(BAND_HIGH_HZ, nyquist - 1.0) / nyquist],
        btype="bandpass",
        output="sos",
    )
    voice = signal.sosfilt(band, audio)

    # Soft-knee compression: drive into tanh, which is what a cheap limiter does.
    voice = np.tanh(_normalise(voice, peak_dbfs=-3.0) * 3.2)

    noise = np.random.default_rng(0).normal(0.0, _db_to_amp(NOISE_FLOOR_DBFS), voice.shape)
    voice = voice + signal.sosfilt(band, noise)

    click_len = int(sample_rate * CLICK_MS / 1000.0)
    click = np.random.default_rng(1).normal(0.0, 0.35, click_len)
    click *= np.linspace(1.0, 0.0, click_len) ** 2

    parts = [signal.sosfilt(band, click), voice]
    if beep:
        beep_len = int(sample_rate * ROGER_BEEP_MS / 1000.0)
        t = np.arange(beep_len) / sample_rate
        envelope = np.minimum(1.0, np.minimum(t, (beep_len / sample_rate) - t) * 200.0)
        parts.append(np.sin(2.0 * np.pi * ROGER_BEEP_HZ * t) * 0.25 * envelope)

    return _normalise(np.concatenate(parts))


def load_phrases(path: Path) -> list[Phrase]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [Phrase(p["id"], p["ru"], p["en"], p["level"]) for p in raw["phrases"]]


def run_kokoro(phrases: list[Phrase], out_dir: Path, models_dir: Path) -> list[dict]:
    try:
        from kokoro_onnx import Kokoro
    except ImportError:
        print("[skip] kokoro-onnx is not installed")
        return []

    model = models_dir / "kokoro-v1.0.onnx"
    voices = models_dir / "voices-v1.0.bin"
    if not model.exists() or not voices.exists():
        print(f"[skip] kokoro weights not found in {models_dir}")
        return []

    kokoro = Kokoro(str(model), str(voices))
    rows: list[dict] = []

    for voice in DISPATCH_VOICES:
        for phrase in phrases:
            started = time.perf_counter()
            audio, sample_rate = kokoro.create(
                phrase.en, voice=voice, speed=LEVEL_SPEED[phrase.level], lang="en-us"
            )
            synth_ms = (time.perf_counter() - started) * 1000.0

            stem = f"kokoro-{voice}-{phrase.id}"
            sf.write(out_dir / f"{stem}-clean.wav", audio, sample_rate)

            started = time.perf_counter()
            processed = radio_chain(audio, sample_rate, beep=phrase.level != "emergency")
            chain_ms = (time.perf_counter() - started) * 1000.0
            sf.write(out_dir / f"{stem}-radio.wav", processed, sample_rate)

            rows.append(
                {
                    "backend": "kokoro-82M",
                    "voice": voice,
                    "phrase": phrase.id,
                    "level": phrase.level,
                    "chars": len(phrase.en),
                    "audio_ms": round(len(audio) / sample_rate * 1000.0, 1),
                    "synth_ms": round(synth_ms, 1),
                    "chain_ms": round(chain_ms, 1),
                    "realtime_factor": round((len(audio) / sample_rate * 1000.0) / synth_ms, 2),
                }
            )
            print(f"  {stem}: {synth_ms:6.0f} ms synth, {chain_ms:5.1f} ms chain")

    return rows


def run_chatterbox(
    phrases: list[Phrase], out_dir: Path, reference: Path | None = None
) -> list[dict]:
    """The backend that can shout, and clone a consenting player from a few seconds.

    Measured on CPU it is 22-34 s for a four-second line - a realtime factor near 0.15,
    which is why the concept puts it behind a GPU rather than beside Kokoro on the box
    the Node backend already runs on.
    """
    try:
        from chatterbox.tts import ChatterboxTTS
    except ImportError:
        print("[skip] chatterbox-tts is not installed")
        return []

    model = ChatterboxTTS.from_pretrained(device="cpu")
    rows: list[dict] = []

    for phrase in phrases:
        exaggeration, cfg_weight = LEVEL_CHATTERBOX[phrase.level]
        started = time.perf_counter()
        wav = model.generate(
            phrase.en,
            exaggeration=exaggeration,
            cfg_weight=cfg_weight,
            **({"audio_prompt_path": str(reference)} if reference else {}),
        )
        synth_ms = (time.perf_counter() - started) * 1000.0
        audio = wav.squeeze(0).numpy()

        voice = reference.stem if reference else "default"
        stem = f"chatterbox-{voice}-{phrase.id}"
        sf.write(out_dir / f"{stem}-clean.wav", audio, model.sr)
        sf.write(
            out_dir / f"{stem}-radio.wav",
            radio_chain(audio, model.sr, beep=phrase.level != "emergency"),
            model.sr,
        )

        rows.append(
            {
                "backend": "chatterbox-0.5B",
                "voice": voice,
                "phrase": phrase.id,
                "level": phrase.level,
                "chars": len(phrase.en),
                "audio_ms": round(len(audio) / model.sr * 1000.0, 1),
                "synth_ms": round(synth_ms, 1),
                "exaggeration": exaggeration,
                "realtime_factor": round((len(audio) / model.sr * 1000.0) / synth_ms, 2),
            }
        )
        print(f"  {stem}: {synth_ms / 1000.0:5.1f} s synth for {len(audio) / model.sr:.1f} s of audio")

    return rows


def build_montages(out_dir: Path, rows: list[dict], phrases: list[Phrase]) -> None:
    """One file per voice holding every transmission, so a voice is judged as a shift.

    A voice that is pleasant on one line and wrong on the next is the failure this
    catches, and it only shows up when the clips are heard back to back the way an
    operator would hear them.
    """
    gap_seconds = 0.45
    order = [phrase.id for phrase in phrases]

    for voice in sorted({row["voice"] for row in rows}):
        clips: list[np.ndarray] = []
        sample_rate = 24000
        for phrase_id in order:
            path = out_dir / f"kokoro-{voice}-{phrase_id}-radio.wav"
            if not path.exists():
                continue
            audio, sample_rate = sf.read(path)
            gap = np.random.default_rng(2).normal(
                0.0, _db_to_amp(NOISE_FLOOR_DBFS), int(sample_rate * gap_seconds)
            )
            clips.extend([audio, gap])
        if clips:
            sf.write(out_dir / f"montage-{voice}.wav", np.concatenate(clips), sample_rate)
            print(f"  montage-{voice}.wav")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("out"))
    parser.add_argument("--models-dir", type=Path, default=Path("."))
    parser.add_argument("--phrases", type=Path, default=Path(__file__).parent / "phrases.json")
    parser.add_argument(
        "--chatterbox", action="store_true", help="also run Chatterbox (slow on CPU)"
    )
    parser.add_argument(
        "--reference", type=Path, help="wav of a consenting speaker for Chatterbox to clone"
    )
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    phrases = load_phrases(args.phrases)
    print(f"{len(phrases)} phrases -> {args.out}")

    rows = run_kokoro(phrases, args.out, args.models_dir)
    if args.chatterbox:
        rows += run_chatterbox(phrases, args.out, args.reference)
    if rows:
        build_montages(args.out, rows, phrases)

    (args.out / "timings.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    if rows:
        synth = [r["synth_ms"] for r in rows]
        print(
            f"\n{len(rows)} clips: synth median {sorted(synth)[len(synth) // 2]:.0f} ms, "
            f"min {min(synth):.0f}, max {max(synth):.0f}"
        )


if __name__ == "__main__":
    main()
