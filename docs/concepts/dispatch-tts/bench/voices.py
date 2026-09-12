"""Every synthesis backend that can plausibly run beside this console, and an honest
answer about which of them actually can, here, now.

The console lists what is INSTALLED rather than what exists. A backend that is not
available says why, so "no sound" is never a mystery.

Two kinds of backend, and the difference matters:

  * **file** backends return a wav, so the measured radio channel can be baked onto it
    and the result can go into the bank. These are the ones that build a product.
  * **speak** backends make sound and hand back nothing. The phone's own engine is one.
    Good for auditioning a line, useless for baking - and the console says so.

Standard library only, except where a backend brings its own.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Backend:
    key: str
    label: str
    kind: str          # "file" | "speak"
    available: bool
    note: str
    install: str = ""


def _kokoro_paths(models_dir: Path) -> tuple[Path, Path]:
    return models_dir / "kokoro-v1.0.onnx", models_dir / "voices-v1.0.bin"


def detect(models_dir: Path = Path("."), tts_url: str | None = None) -> list[Backend]:
    """What can speak on this machine right now."""
    out: list[Backend] = [
        Backend("bank", "Банк (испечённые файлы)", "file", True,
                "Мгновенно и бесплатно. Единственный путь, который работает на телефоне "
                "в бою — остальное здесь для прослушки."),
        Backend("browser", "Голос телефона (браузер)", "speak", True,
                "Web Speech API поверх штатного движка Android. Ноль установки, оффлайн, "
                "живые голоса. Файла не даёт, поэтому радио-тракт к нему не применить."),
    ]

    espeak = shutil.which("espeak-ng") or shutil.which("espeak")
    out.append(Backend("espeak", "espeak-ng", "file", bool(espeak),
                       "Формантный синтез: роботично, но это НАСТОЯЩИЙ файл, "
                       "к которому применяется измеренный канал." if espeak else
                       "Не установлен.", "pkg install espeak-ng"))

    piper = shutil.which("piper")
    out.append(Backend("piper", "Piper", "file", bool(piper),
                       "Лёгкий нейросетевой синтез, отдаёт wav." if piper else
                       "Не установлен. В Termux обычно ставится внутри proot-distro: "
                       "нативные сборки собраны под glibc, а Android — bionic.",
                       "proot-distro install ubuntu, затем piper внутри"))

    model, voices = _kokoro_paths(models_dir)
    try:
        import kokoro_onnx  # noqa: F401
        has_pkg = True
    except ImportError:
        has_pkg = False
    ready = has_pkg and model.exists() and voices.exists()
    out.append(Backend("kokoro", "Kokoro-82M (ONNX)", "file", ready,
                       "82M на CPU, ~1 c на фразу здесь." if ready else
                       ("Пакет есть, весов нет — скачайте kokoro-v1.0.onnx и voices-v1.0.bin"
                        if has_pkg else
                        "onnxruntime под Termux ставится не всегда: колёса с PyPI собраны "
                        "под glibc, а Android — bionic. Работает внутри proot-distro."),
                       "pip install kokoro-onnx"))

    out.append(Backend("http", "Внешний сервис (OpenAI-совместимый)", "file", bool(tts_url),
                       f"POST {tts_url}" if tts_url else
                       "Не задан. Сюда подключается GPU-машина или облако, когда появятся.",
                       "--tts-url http://host:8000/v1/audio/speech"))
    return out


def synthesise(backend: str, text: str, out_path: Path, *,
               models_dir: Path = Path("."), voice: str = "am_onyx",
               tts_url: str | None = None) -> Path:
    """Render `text` to `out_path` as a wav. Raises when the backend cannot."""
    if backend == "espeak":
        exe = shutil.which("espeak-ng") or shutil.which("espeak")
        if not exe:
            raise RuntimeError("espeak-ng is not installed")
        subprocess.run([exe, "-v", "en-us", "-s", "150", "-w", str(out_path), text],
                       check=True, capture_output=True)
        return out_path

    if backend == "piper":
        exe = shutil.which("piper")
        if not exe:
            raise RuntimeError("piper is not installed")
        subprocess.run([exe, "--output_file", str(out_path)], input=text.encode(),
                       check=True, capture_output=True)
        return out_path

    if backend == "kokoro":
        from kokoro_onnx import Kokoro  # imported here so the console starts without it

        model, voices = _kokoro_paths(models_dir)
        kokoro = Kokoro(str(model), str(voices))
        audio, rate = kokoro.create(text, voice=voice, speed=1.0, lang="en-us")
        import dsp
        dsp.write_wav(out_path, audio, rate)
        return out_path

    if backend == "http":
        if not tts_url:
            raise RuntimeError("no --tts-url was given")
        import json
        import urllib.request

        body = json.dumps({"input": text, "voice": voice, "model": "tts-1",
                           "response_format": "wav"}).encode()
        request = urllib.request.Request(
            tts_url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=60) as response:
            out_path.write_bytes(response.read())
        return out_path

    raise RuntimeError(f"{backend} cannot produce a file")


def apply_chain(wav_path: Path, profile: dict | None) -> Path:
    """Bake a measured radio channel onto a rendered clip, when one was measured."""
    if not profile:
        return wav_path
    import bench
    import dsp

    audio, rate = dsp.read_wav(wav_path)
    processed = bench.radio_chain_from_profile(audio, rate, profile, beep=True)
    dsp.write_wav(wav_path, processed, rate)
    return wav_path
