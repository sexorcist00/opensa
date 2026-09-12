"""Measure a real radio recording and emit the parameters our chain should use.

The radio chain in bench.py carries invented constants - 300-3400 Hz, a tanh drive,
a -46 dBFS noise floor. A recording of the real channel makes them measurable, which
is this project's rule about recovering a formula instead of fitting a constant.

Usage:
    python chain_fit.py tape.wav [more.wav ...] --out chain.json

Every figure it prints is measured from the file. It reports a confidence note where
a measurement can be wrong for a reason a reader would not guess.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from bench import psd, read_audio, third_octave_levels, write_audio

FRAME_MS = 25.0
# A frame counts as speech when it stands this far above the file's own quiet floor.
VOICED_OVER_FLOOR_DB = 12.0
# Below this the "edge" is just the voice rolling off, not a channel filter.
MIN_CLIFF_DB_PER_OCT = 14.0
# The tone is short, so a long window dilutes it: scan the tail in hops.
BEEP_WINDOW_MS = 90.0
BEEP_TAIL_MS = 350.0
BEEP_HOP_MS = 30.0
# A tone concentrates its energy; a vowel spreads it across formants.
# Relative, because +/-120 Hz around 500 Hz is a whole formant and around 1800 Hz is not.
BEEP_CONCENTRATION_FRACTION = 0.05
BEEP_MIN_CONCENTRATION = 0.5
# Two runs closer than this are one transmission with a breath in it.
MERGE_GAP_S = 0.25
MIN_TRANSMISSION_S = 0.4
# A band this close to the floor is measuring hiss, not the channel.
NOISE_HEADROOM_DB = 6.0


def to_mono(audio: np.ndarray) -> np.ndarray:
    return audio.mean(axis=1) if audio.ndim > 1 else audio


def db(x: float) -> float:
    return float(20.0 * np.log10(max(x, 1e-12)))


def frame_rms(audio: np.ndarray, sample_rate: int) -> tuple[np.ndarray, int]:
    n = max(1, int(sample_rate * FRAME_MS / 1000.0))
    count = len(audio) // n
    if count == 0:
        return np.array([]), n
    frames = audio[: count * n].reshape(count, n)
    return np.sqrt(np.mean(frames ** 2, axis=1)), n


def split_voiced(audio: np.ndarray, sample_rate: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (voiced mask per frame, frame RMS, frame length)."""
    rms, n = frame_rms(audio, sample_rate)
    if rms.size == 0:
        return np.array([], dtype=bool), rms, n
    floor = float(np.percentile(rms, 10))
    threshold = floor * (10 ** (VOICED_OVER_FLOOR_DB / 20.0))
    return rms > threshold, rms, n


def spectral_profile(audio: np.ndarray, sample_rate: int, voiced: np.ndarray, n: int) -> dict:
    """The tape's average voiced spectrum in third-octave bands - the EQ curve to match.

    This replaces an earlier attempt to identify "the filter" (its corner, its order).
    That question cannot be answered from speech alone: the level threshold measures the
    speaker's own roll-off, and the steepest slope of a synthetic file sits at the bottom
    of the skirt rather than at the corner - the two readings of one 300-3400 Hz chain
    came back as 1828 Hz and 8133 Hz.

    The question that CAN be answered, and is the one worth asking, is what the channel's
    average response looks like, so our own chain can be built to match it. Levels are
    normalised to the 500-1000 Hz octave, so a quiet tape and a loud one give the same
    curve.
    """
    if not voiced.any():
        return {"note": "no voiced frames found"}

    idx = np.flatnonzero(voiced)
    voiced_audio = np.concatenate([audio[i * n : (i + 1) * n] for i in idx])
    centres, curve = third_octave_levels(voiced_audio, sample_rate)
    # Where the curve has fallen 10 dB below the anchor, read from the outside in - a
    # descriptive summary of the same curve, never the thing the chain is built from.
    inside = np.flatnonzero(curve >= -10.0)
    return {
        "bands_hz": [round(float(c), 1) for c in centres],
        "levels_db": [round(float(v), 1) for v in curve],
        "anchor": "500-1000 Hz octave = 0 dB",
        "minus10_low_hz": round(float(centres[inside[0]]), 1) if inside.size else None,
        "minus10_high_hz": round(float(centres[inside[-1]]), 1) if inside.size else None,
        "note": "the curve is the product of the channel AND the speaker; matching it makes our "
                "output sound like this tape, which is the goal, rather than identifying the filter",
    }


def dynamics(audio: np.ndarray, voiced: np.ndarray, rms: np.ndarray) -> dict:
    """Crest factor and spread say how hard the channel was compressed."""
    if not voiced.any():
        return {}
    voiced_rms = rms[voiced]
    peak = float(np.max(np.abs(audio)))
    return {
        "peak_dbfs": round(db(peak), 1),
        "voiced_rms_dbfs": round(db(float(np.median(voiced_rms))), 1),
        "crest_factor_db": round(db(peak) - db(float(np.median(voiced_rms))), 1),
        "rms_spread_db": round(db(float(np.percentile(voiced_rms, 95)))
                               - db(float(np.percentile(voiced_rms, 10))), 1),
        "clipped_sample_ratio": round(float(np.mean(np.abs(audio) > 0.995)), 5),
    }


def segment(voiced: np.ndarray, n: int, sample_rate: int) -> list[tuple[int, int]]:
    """Frame spans that are one transmission each - the file's only such definition.

    A pause inside a sentence is not the end of a transmission, so runs separated by
    less than MERGE_GAP_S are joined before anything is measured. Two functions with
    two different ideas of "a transmission" is how one of these reported 2 and the
    other 11 for the same file.
    """
    frame_s = n / sample_rate
    spans: list[list[int]] = []
    start = None
    for i, v in enumerate(voiced):
        if v and start is None:
            start = i
        elif not v and start is not None:
            spans.append([start, i])
            start = None
    if start is not None:
        spans.append([start, len(voiced)])

    merged: list[list[int]] = []
    for span in spans:
        if merged and (span[0] - merged[-1][1]) * frame_s < MERGE_GAP_S:
            merged[-1][1] = span[1]
        else:
            merged.append(span)

    return [(a, b) for a, b in merged if (b - a) * frame_s >= MIN_TRANSMISSION_S]


def transmissions(voiced: np.ndarray, n: int, sample_rate: int) -> dict:
    """Transmission lengths and the gaps between them."""
    if voiced.size == 0:
        return {}
    frame_s = n / sample_rate
    spans = segment(voiced, n, sample_rate)
    lengths = [(b - a) * frame_s for a, b in spans]
    gaps = [(spans[i + 1][0] - spans[i][1]) * frame_s for i in range(len(spans) - 1)]
    return {
        "count": len(spans),
        "median_s": round(float(np.median(lengths)), 2) if lengths else None,
        "p90_s": round(float(np.percentile(lengths, 90)), 2) if lengths else None,
        "median_gap_s": round(float(np.median(gaps)), 2) if gaps else None,
        "voiced_share": round(float(np.mean(voiced)), 3),
    }


def noise_floor(audio: np.ndarray, voiced: np.ndarray, rms: np.ndarray) -> dict:
    """The level of the channel when nobody is talking - the open-channel hiss."""
    if voiced.size == 0 or voiced.all():
        return {"dbfs": None, "note": "no silent frames to measure"}
    quiet = rms[~voiced]
    return {
        "dbfs": round(db(float(np.median(quiet))), 1),
        "note": "measured between transmissions, so it is the channel's own floor rather than the room's",
    }


def roger_beep(audio: np.ndarray, sample_rate: int, voiced: np.ndarray, n: int) -> dict:
    """A narrowband tone closing a transmission, if this channel sends one.

    Speech has a loudest bin too, so a peak alone proves nothing - the test that
    separates a tone from a vowel is CONCENTRATION: a beep puts most of the window's
    energy within a hundred hertz of one frequency, and a vowel never does. Without
    that test this reported a 516 Hz "beep" on every clip, reading formants.
    """
    spans = segment(voiced, n, sample_rate)
    if not spans:
        return {"found": False, "note": "no transmissions to examine"}

    tail = int(sample_rate * BEEP_TAIL_MS / 1000.0)
    hop = int(sample_rate * BEEP_HOP_MS / 1000.0)
    window = int(sample_rate * BEEP_WINDOW_MS / 1000.0)
    hits = []
    for _, end in spans:
        stop = min(len(audio), end * n)
        best = (0.0, 0.0)
        for offset in range(0, max(1, tail - window + 1), max(1, hop)):
            b = stop - offset
            seg = audio[max(0, b - window):b]
            if len(seg) < 256:
                continue
            freqs, psd_values = psd(seg, sample_rate, 256)
            band = freqs > 400
            if not band.any():
                continue
            f, p = freqs[band], psd_values[band]
            peak_f = float(f[int(np.argmax(p))])
            near = np.abs(f - peak_f) <= peak_f * BEEP_CONCENTRATION_FRACTION
            concentration = float(p[near].sum() / (p.sum() + 1e-20))
            if concentration > best[1]:
                best = (peak_f, concentration)
        if best[1] >= BEEP_MIN_CONCENTRATION:
            hits.append(best)

    if len(hits) < 2:
        return {
            "found": False,
            "checked": len(spans),
            "note": "no repeated narrowband tone closing a transmission",
        }

    freqs_hit = [h[0] for h in hits]
    spread = float(np.max(freqs_hit) - np.min(freqs_hit))
    return {
        "found": True,
        "hz": round(float(np.median(freqs_hit)), 1),
        "spread_hz": round(spread, 1),
        "concentration": round(float(np.median([h[1] for h in hits])), 2),
        "seen_in": len(hits),
        "of_transmissions": len(spans),
        "note": "a wide spread_hz means these were different tones, so treat the median with suspicion",
    }


def measure(path: Path) -> dict:
    audio, sample_rate = read_audio(path)
    voiced, rms, n = split_voiced(audio, sample_rate)

    return {
        "file": path.name,
        "sample_rate": sample_rate,
        "duration_s": round(len(audio) / sample_rate, 2),
        "profile": spectral_profile(audio, sample_rate, voiced, n),
        "dynamics": dynamics(audio, voiced, rms),
        "noise_floor": noise_floor(audio, voiced, rms),
        "transmissions": transmissions(voiced, n, sample_rate),
        "roger_beep": roger_beep(audio, sample_rate, voiced, n),
    }


def chain_from(measurements: list[dict]) -> dict:
    """Average the per-file curves into one profile the chain can be built from."""
    profiles = [m["profile"] for m in measurements if m["profile"].get("levels_db")]
    floors = [m["noise_floor"]["dbfs"] for m in measurements if m["noise_floor"].get("dbfs") is not None]
    crests = [m["dynamics"].get("crest_factor_db") for m in measurements if m["dynamics"].get("crest_factor_db")]
    beeps = [m["roger_beep"]["hz"] for m in measurements if m["roger_beep"].get("found")]

    curve = None
    bands = None
    if profiles:
        widths = {len(p["levels_db"]) for p in profiles}
        if len(widths) == 1:
            bands = profiles[0]["bands_hz"]
            curve = np.median(np.array([p["levels_db"] for p in profiles]), axis=0).round(1).tolist()
        else:
            bands = profiles[0]["bands_hz"]
            curve = profiles[0]["levels_db"]

    return {
        "bands_hz": bands,
        "levels_db": curve,
        "NOISE_FLOOR_DBFS": round(float(np.median(floors)), 1) if floors else None,
        "target_crest_factor_db": round(float(np.median(crests)), 1) if crests else None,
        "ROGER_BEEP_HZ": round(float(np.median(beeps)), 1) if beeps else None,
        "from_files": len(profiles),
        "caveat": "files at different sample rates give curves of different length; when that happens only "
                  "the first file's curve is kept, so resample the tapes to one rate before fitting",
    }


def verify(profile: dict, clean_path: Path, out_path: Path) -> dict:
    """Apply the fitted profile to a clean clip and measure how close the result lands.

    A fitting tool that cannot check itself is a tool nobody should point at real tapes.
    Bands where the target sits below the noise floor are excluded from the score: down
    there the output is our own added hiss, and comparing it to the tape measures nothing.
    """
    from bench import radio_chain_from_profile

    audio, sample_rate = read_audio(clean_path)
    out = radio_chain_from_profile(audio, sample_rate, profile, beep=True)
    write_audio(out_path, out, sample_rate)

    got = measure(out_path)["profile"]
    target = np.array(profile["levels_db"], dtype=float)
    achieved = np.array(got["levels_db"], dtype=float)
    bands = np.array(profile["bands_hz"], dtype=float)

    width = min(len(target), len(achieved))
    floor = float(profile.get("NOISE_FLOOR_DBFS") or -60.0)
    scored = (target[:width] > floor + NOISE_HEADROOM_DB) & (bands[:width] >= 200)
    delta = np.abs(target[:width][scored] - achieved[:width][scored])

    return {
        "written": str(out_path),
        "bands_scored": int(scored.sum()),
        "mean_abs_db": round(float(delta.mean()), 1) if delta.size else None,
        "max_abs_db": round(float(delta.max()), 1) if delta.size else None,
        "rows": [
            {"hz": round(float(f), 1), "target": round(float(t), 1), "got": round(float(g), 1)}
            for f, t, g, keep in zip(bands[:width], target[:width], achieved[:width], scored) if keep
        ],
        "note": "bands under the tape's own noise floor are excluded - there the output is our hiss",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", type=Path, nargs="+")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--verify", type=Path,
                        help="a clean wav to push through the fitted chain and score")
    args = parser.parse_args()

    measurements = [measure(p) for p in args.files]
    for m in measurements:
        b, d, t = m["profile"], m["dynamics"], m["transmissions"]
        print(f"\n{m['file']}  {m['duration_s']}s @ {m['sample_rate']} Hz")
        print(f"  -10 dB span   {b.get('minus10_low_hz')} - {b.get('minus10_high_hz')} Hz")
        print(f"  noise floor   {m['noise_floor'].get('dbfs')} dBFS")
        print(f"  crest factor  {d.get('crest_factor_db')} dB   spread {d.get('rms_spread_db')} dB")
        print(f"  transmissions {t.get('count')}, median {t.get('median_s')}s, gap {t.get('median_gap_s')}s")
        print(f"  roger beep    {m['roger_beep']}")

    result = {"files": measurements, "chain": chain_from(measurements)}
    chain = dict(result["chain"])
    curve, bands = chain.pop("levels_db", None), chain.pop("bands_hz", None)
    print("\nchain parameters:", json.dumps(chain, indent=2))
    if curve:
        print("  eq curve (dB, third-octave):")
        for c, v in zip(bands, curve):
            print(f"    {c:8.0f} Hz  {v:+6.1f}")
    if args.verify:
        check = verify(result["chain"], args.verify, args.verify.with_name("matched.wav"))
        result["verify"] = check
        print(f"\nverify: {check['bands_scored']} bands scored, "
              f"mean |delta| {check['mean_abs_db']} dB, max {check['max_abs_db']} dB "
              f"-> {check['written']}")

    if args.out:
        args.out.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print("written to", args.out)


if __name__ == "__main__":
    main()
