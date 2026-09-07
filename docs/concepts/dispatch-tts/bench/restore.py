"""Take the radio off a recording, so what is cloned is the voice and not the channel.

A dispatch tape carries the speaker and the channel welded together. Cloning from it
teaches the model both, which is measurably worse synthesis and an effect that can never
be turned off again. This undoes the weld: restore the voice here, and put the channel
back afterwards with chain_fit.py's measured profile.

    python restore.py tapes/*.wav --out clean/ [--backend voicefixer|denoise]

What it does NOT do is promise the result is the truth. Restoration INVENTS the top of
the spectrum the radio removed; the output is what this person would plausibly sound like
off the air, which is the right input for a cloning model and the wrong input for anything
forensic.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

TARGET_RATE = 24000
TARGET_LUFS_ISH_DBFS = -23.0
TRIM_SILENCE_DB = 35.0


def to_mono(audio: np.ndarray) -> np.ndarray:
    return audio.mean(axis=1) if audio.ndim > 1 else audio


def trim_silence(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Drop leading and trailing silence, which a reference encoder would otherwise learn."""
    frame = max(1, sample_rate // 100)
    count = len(audio) // frame
    if count < 2:
        return audio
    rms = np.sqrt(np.mean(audio[: count * frame].reshape(count, frame) ** 2, axis=1))
    peak = float(rms.max()) or 1.0
    loud = np.flatnonzero(rms > peak * 10 ** (-TRIM_SILENCE_DB / 20.0))
    if loud.size == 0:
        return audio
    return audio[loud[0] * frame : min(len(audio), (loud[-1] + 1) * frame)]


def normalise(audio: np.ndarray) -> np.ndarray:
    """Level to a consistent RMS, so one loud tape does not dominate a dataset."""
    rms = float(np.sqrt(np.mean(audio ** 2))) or 1e-9
    scaled = audio * (10 ** (TARGET_LUFS_ISH_DBFS / 20.0) / rms)
    peak = float(np.max(np.abs(scaled)))
    return scaled / peak * 0.98 if peak > 0.98 else scaled


def restore_voicefixer(audio: np.ndarray, sample_rate: int) -> tuple[np.ndarray, int]:
    """VoiceFixer (MIT): denoise, dereverb, declip and extend bandwidth to 44.1 kHz."""
    from voicefixer import VoiceFixer

    global _VF
    try:
        _VF
    except NameError:
        _VF = VoiceFixer()

    tmp_in = Path(".restore-in.wav")
    tmp_out = Path(".restore-out.wav")
    sf.write(tmp_in, audio, sample_rate)
    # mode 0 is the general restoration path; the others target specific damage.
    _VF.restore(input=str(tmp_in), output=str(tmp_out), cuda=False, mode=0)
    out, rate = sf.read(tmp_out, dtype="float32")
    tmp_in.unlink(missing_ok=True)
    tmp_out.unlink(missing_ok=True)
    return to_mono(out), rate


def restore_denoise(audio: np.ndarray, sample_rate: int) -> tuple[np.ndarray, int]:
    """Spectral-subtraction fallback: removes hiss, cannot return missing bandwidth.

    Here so the pipeline runs with nothing installed. It is not a substitute for a
    restoration model - a band-limited tape stays band-limited, and cloning from it
    still teaches the model the channel.
    """
    f, t, spec = signal.stft(audio, fs=sample_rate, nperseg=1024)
    magnitude = np.abs(spec)
    # The noise floor per frequency: the quiet tenth of frames.
    floor = np.percentile(magnitude, 10, axis=1, keepdims=True)
    cleaned = np.maximum(magnitude - 1.5 * floor, 0.05 * magnitude)
    _, out = signal.istft(cleaned * np.exp(1j * np.angle(spec)), fs=sample_rate, nperseg=1024)
    return out.astype("float32"), sample_rate


def process(path: Path, out_dir: Path, backend: str) -> dict:
    audio, sample_rate = sf.read(path, dtype="float32")
    audio = to_mono(audio)
    before = len(audio) / sample_rate

    if backend == "voicefixer":
        audio, sample_rate = restore_voicefixer(audio, sample_rate)
    else:
        audio, sample_rate = restore_denoise(audio, sample_rate)

    if sample_rate != TARGET_RATE:
        audio = signal.resample_poly(audio, TARGET_RATE, sample_rate)
        sample_rate = TARGET_RATE

    audio = normalise(trim_silence(audio, sample_rate))
    out_path = out_dir / f"{path.stem}.wav"
    sf.write(out_path, audio, sample_rate)

    return {
        "file": path.name,
        "backend": backend,
        "seconds_in": round(before, 2),
        "seconds_out": round(len(audio) / sample_rate, 2),
        "written": str(out_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", type=Path, nargs="+")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--backend", choices=["voicefixer", "denoise"], default="voicefixer")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    for path in args.files:
        row = process(path, args.out, args.backend)
        print(f"{row['file']}: {row['seconds_in']}s -> {row['seconds_out']}s  {row['written']}")


if __name__ == "__main__":
    main()
