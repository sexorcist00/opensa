"""Turn a pile of dispatch recordings into a dataset a TTS model can be trained on.

    python dataset.py tapes/*.wav --out dataset/ [--speaker dispatch-1] [--model base.en]

Each tape is restored, cut into transmissions, transcribed, and written out in the
LJSpeech layout that every open fine-tuning recipe reads:

    dataset/wavs/<id>.wav
    dataset/metadata.csv        id|text|text
    dataset/manifest.json       what was kept, what was dropped and why

The dropped rows matter as much as the kept ones. A dataset that silently discards half
its input is how a fine-tune ends up trained on ninety seconds of audio while everyone
believes it saw an hour.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

from bench import third_octave_levels  # noqa: F401  (shared primitive lives there)
from chain_fit import measure, segment, split_voiced, to_mono
from restore import normalise, restore_denoise, restore_voicefixer

# A clip shorter than this teaches a model nothing; longer than this and most
# recipes truncate it anyway.
MIN_CLIP_S = 1.0
MAX_CLIP_S = 15.0
MIN_WORDS = 3
# Whisper's own estimate that a segment is not speech at all.
MAX_NO_SPEECH_PROB = 0.5
# Whisper does not go quiet on degraded radio - it INVENTS fluent text, and the invention
# passes every other filter here: no_speech_prob stays low and the word count is high.
# What separates it is confidence. Measured on two tapes, ten segments: correct
# transcripts scored -0.31 to -0.63, hallucinated ones -0.85 to -0.91. This threshold
# comes from that gap and should be re-derived on a new corpus - the tool prints the
# distribution so it can be.
MIN_AVG_LOGPROB = -0.7
CLIPPED_SAMPLE_LIMIT = 0.001


def cut(audio: np.ndarray, sample_rate: int) -> list[tuple[float, float]]:
    """Transmission spans in seconds, using the same segmenter the fitter uses."""
    voiced, _, n = split_voiced(audio, sample_rate)
    frame_s = n / sample_rate
    return [(a * frame_s, b * frame_s) for a, b in segment(voiced, n, sample_rate)]


def transcribe(model, path: Path) -> tuple[str, float, float]:
    """Returns the text, the worst no-speech probability, and the worst confidence."""
    segments, _ = model.transcribe(str(path), language="en", vad_filter=False)
    parts, worst_no_speech, worst_logprob = [], 0.0, 0.0
    for s in segments:
        parts.append(s.text.strip())
        worst_no_speech = max(worst_no_speech, float(getattr(s, "no_speech_prob", 0.0)))
        worst_logprob = min(worst_logprob, float(getattr(s, "avg_logprob", 0.0)))
    return " ".join(parts).strip(), worst_no_speech, worst_logprob


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", type=Path, nargs="+")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--speaker", default="dispatch")
    parser.add_argument("--model", default="base.en", help="faster-whisper model size")
    parser.add_argument("--backend", choices=["voicefixer", "denoise", "none"], default="voicefixer")
    parser.add_argument("--no-transcribe", action="store_true")
    parser.add_argument("--min-logprob", type=float, default=MIN_AVG_LOGPROB,
                        help="drop transcripts below this confidence; re-derive it "
                             "from the distribution this prints")
    args = parser.parse_args()

    wavs = args.out / "wavs"
    wavs.mkdir(parents=True, exist_ok=True)

    model = None
    if not args.no_transcribe:
        from faster_whisper import WhisperModel

        model = WhisperModel(args.model, device="cpu", compute_type="int8")

    rows, dropped, scores = [], [], []
    for tape in args.files:
        audio, sample_rate = sf.read(tape, dtype="float32")
        audio = to_mono(audio)

        if args.backend == "voicefixer":
            audio, sample_rate = restore_voicefixer(audio, sample_rate)
        elif args.backend == "denoise":
            audio, sample_rate = restore_denoise(audio, sample_rate)

        spans = cut(audio, sample_rate)
        print(f"{tape.name}: {len(spans)} transmissions")

        for i, (start, end) in enumerate(spans):
            duration = end - start
            clip_id = f"{args.speaker}-{tape.stem}-{i:04d}"
            if not (MIN_CLIP_S <= duration <= MAX_CLIP_S):
                dropped.append({"id": clip_id, "why": f"duration {duration:.1f}s"})
                continue

            clip = normalise(audio[int(start * sample_rate) : int(end * sample_rate)])
            if float(np.mean(np.abs(clip) > 0.995)) > CLIPPED_SAMPLE_LIMIT:
                dropped.append({"id": clip_id, "why": "clipped"})
                continue

            path = wavs / f"{clip_id}.wav"
            sf.write(path, clip, sample_rate)

            text, no_speech, logprob = "", 0.0, 0.0
            if model is not None:
                text, no_speech, logprob = transcribe(model, path)
                scores.append(logprob)
                if no_speech > MAX_NO_SPEECH_PROB or len(text.split()) < MIN_WORDS:
                    path.unlink(missing_ok=True)
                    dropped.append({"id": clip_id, "why": f"no_speech={no_speech:.2f}", "text": text})
                    continue
                if logprob < args.min_logprob:
                    path.unlink(missing_ok=True)
                    dropped.append({
                        "id": clip_id,
                        "why": f"low confidence {logprob:.2f} - probably invented",
                        "text": text,
                    })
                    continue

            rows.append({
                "id": clip_id,
                "file": str(path.relative_to(args.out)),
                "seconds": round(duration, 2),
                "text": text,
                "avg_logprob": round(logprob, 3),
                "source": tape.name,
            })

    (args.out / "metadata.csv").write_text(
        "\n".join(f"{r['id']}|{r['text']}|{r['text']}" for r in rows) + "\n", encoding="utf-8"
    )
    total = sum(r["seconds"] for r in rows)
    manifest = {
        "speaker": args.speaker,
        "clips": len(rows),
        "minutes": round(total / 60.0, 2),
        "median_seconds": round(float(np.median([r["seconds"] for r in rows])), 2) if rows else None,
        "min_logprob_gate": args.min_logprob,
        "confidence_percentiles": (
            [round(float(v), 3) for v in np.percentile(scores, [10, 25, 50, 75, 90])] if scores else None
        ),
        "dropped": dropped,
        "rows": rows,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"\nkept {len(rows)} clips, {manifest['minutes']} minutes; dropped {len(dropped)}")
    if scores:
        q = np.percentile(scores, [10, 25, 50, 75, 90])
        print("  transcript confidence (avg_logprob) p10/p25/p50/p75/p90: "
              + " ".join(f"{v:.2f}" for v in q))
        print(f"  gate at {args.min_logprob}: re-derive it here if this corpus separates elsewhere")
    if dropped:
        reasons: dict[str, int] = {}
        for d in dropped:
            key = d["why"].split("=")[0].split(" ")[0]
            reasons[key] = reasons.get(key, 0) + 1
        print("  dropped for:", reasons)


if __name__ == "__main__":
    main()
