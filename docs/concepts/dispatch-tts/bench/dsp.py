"""The DSP the phone path needs, in numpy alone.

Termux ships numpy as a package but scipy is a build adventure and soundfile wants
libsndfile, so the measuring half of this bench would be unusable on the one machine
this project is developed on. Everything here is therefore written against numpy and
the standard library, and `bench.py` and `chain_fit.py` prefer scipy when it exists
and fall back to this when it does not.

Equivalence is not asserted, it is measured: `python dsp.py --selftest <wav>` compares
both paths band by band and prints the difference.
"""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

try:  # the fast path, used on any desktop
    from scipy import signal as _scipy_signal
except ImportError:  # pragma: no cover - the phone
    _scipy_signal = None

HAVE_SCIPY = _scipy_signal is not None


# --- audio i/o without libsndfile ------------------------------------------------

def read_wav(path: str | Path) -> tuple[np.ndarray, int]:
    """Mono float32 in [-1, 1] from a PCM wav. Convert other formats with ffmpeg."""
    with wave.open(str(path), "rb") as w:
        channels, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(frames)

    if width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    elif width == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError(f"{path}: {width * 8}-bit wav is not supported - convert to 16-bit")

    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, rate


def write_wav(path: str | Path, audio: np.ndarray, rate: int) -> None:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(rate))
        w.writeframes(pcm.tobytes())


# --- spectrum --------------------------------------------------------------------

def welch(x: np.ndarray, fs: int, nperseg: int = 2048) -> tuple[np.ndarray, np.ndarray]:
    """Welch PSD: Hann windows, 50 % overlap, averaged - scipy's defaults."""
    nperseg = int(min(nperseg, len(x)))
    if nperseg < 8:
        return np.array([0.0]), np.array([0.0])
    step = nperseg // 2
    window = np.hanning(nperseg + 1)[:-1]
    scale = 1.0 / (fs * np.sum(window ** 2))

    segments = [x[i : i + nperseg] for i in range(0, len(x) - nperseg + 1, step)]
    if not segments:
        segments = [np.pad(x, (0, nperseg - len(x)))]

    acc = np.zeros(nperseg // 2 + 1)
    for seg in segments:
        spec = np.fft.rfft(seg * window)
        power = (np.abs(spec) ** 2) * scale
        power[1:-1] *= 2.0  # one-sided
        acc += power
    return np.fft.rfftfreq(nperseg, 1.0 / fs), acc / len(segments)


# --- filtering -------------------------------------------------------------------

def fir_from_response(freqs_hz: np.ndarray, gains: np.ndarray, taps: int, fs: int) -> np.ndarray:
    """A linear-phase FIR whose magnitude follows the given points - firwin2's job.

    The response is interpolated onto the rfft grid, taken back to the time domain,
    rolled to make it causal and windowed. Odd tap counts only, so the delay is a
    whole number of samples.
    """
    taps = int(taps) | 1
    grid = np.fft.rfftfreq(taps, 1.0 / fs)
    magnitude = np.interp(grid, freqs_hz, gains, left=gains[0], right=gains[-1])
    kernel = np.fft.irfft(magnitude, n=taps)
    kernel = np.roll(kernel, taps // 2)
    return kernel * np.hamming(taps)


def apply_fir(x: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """Convolve and keep the input length, compensating the linear-phase delay."""
    delay = len(kernel) // 2
    return np.convolve(x, kernel, mode="full")[delay : delay + len(x)]


def bandpass(x: np.ndarray, fs: int, low: float, high: float, taps: int = 511) -> np.ndarray:
    """A band-pass with soft edges, standing in for a 4th-order Butterworth."""
    nyquist = fs / 2.0
    high = min(high, nyquist * 0.98)
    edge_low, edge_high = low * 0.75, min(high * 1.25, nyquist * 0.99)
    points = np.array([0.0, edge_low, low, high, edge_high, nyquist])
    gains = np.array([0.0, 0.0, 1.0, 1.0, 0.0, 0.0])
    return apply_fir(x, fir_from_response(points, gains, taps, fs))


def resample(x: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    """Fourier resampling - adequate for speech and free of a filter design step."""
    if source_rate == target_rate:
        return x
    n_out = int(round(len(x) * target_rate / source_rate))
    spec = np.fft.rfft(x)
    keep = min(len(spec), n_out // 2 + 1)
    out_spec = np.zeros(n_out // 2 + 1, dtype=complex)
    out_spec[:keep] = spec[:keep]
    return np.fft.irfft(out_spec, n=n_out) * (n_out / len(x))


def stft(x: np.ndarray, nperseg: int = 1024) -> np.ndarray:
    """Hann-windowed STFT with 50 % overlap, frames as columns."""
    step = nperseg // 2
    window = np.hanning(nperseg + 1)[:-1]
    padded = np.pad(x, (0, max(0, nperseg - len(x))))
    frames = [padded[i : i + nperseg] * window
              for i in range(0, max(1, len(padded) - nperseg + 1), step)]
    return np.stack([np.fft.rfft(f) for f in frames], axis=1)


def istft(spec: np.ndarray, nperseg: int = 1024) -> np.ndarray:
    """Overlap-add inverse of `stft`, normalised by the summed window."""
    step = nperseg // 2
    window = np.hanning(nperseg + 1)[:-1]
    length = step * (spec.shape[1] - 1) + nperseg
    out = np.zeros(length)
    norm = np.zeros(length)
    for i in range(spec.shape[1]):
        start = i * step
        out[start : start + nperseg] += np.fft.irfft(spec[:, i], n=nperseg) * window
        norm[start : start + nperseg] += window ** 2
    return out / np.maximum(norm, 1e-8)


# --- self-test -------------------------------------------------------------------

def _selftest(path: str) -> int:
    """Compare the numpy path with scipy's on a real file, band by band."""
    if not HAVE_SCIPY:
        print("scipy is not installed here, so there is nothing to compare against.")
        print("That is the expected state on the phone - run this on a desktop to verify.")
        return 0

    audio, rate = read_wav(path)

    f_np, p_np = welch(audio, rate)
    f_sp, p_sp = _scipy_signal.welch(audio, fs=rate, nperseg=min(2048, len(audio)))
    band = (f_np > 100) & (f_np < rate / 2 * 0.9)
    psd_delta = np.abs(10 * np.log10(p_np[band] + 1e-20) - 10 * np.log10(p_sp[band] + 1e-20))

    filtered_np = bandpass(audio, rate, 300.0, 3400.0)
    sos = _scipy_signal.butter(
        4, [300 / (rate / 2), 3400 / (rate / 2)], btype="bandpass", output="sos"
    )
    filtered_sp = _scipy_signal.sosfilt(sos, audio)

    def curve(x: np.ndarray) -> np.ndarray:
        f, p = welch(x, rate)
        sel = (f >= 300) & (f <= 3400)
        return 10 * np.log10(p[sel] + 1e-20)

    filt_delta = np.abs(curve(filtered_np) - curve(filtered_sp))

    print(f"welch    mean |delta| {psd_delta.mean():.3f} dB   max {psd_delta.max():.3f} dB")
    print(f"bandpass mean |delta| {filt_delta.mean():.2f} dB   max {filt_delta.max():.2f} dB   "
          f"(in-band 300-3400 Hz; the two filters are different designs, so this is a "
          f"similarity check rather than an equality one)")
    return 0


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selftest", metavar="WAV", required=True)
    raise SystemExit(_selftest(parser.parse_args().selftest))
