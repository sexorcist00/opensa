"""RU -> EN and the urgency level, from a local model through Ollama.

This is the stage whose absence makes a glossary miss silent. With it, a free phrase
gets English and any file backend can speak it; without it the console behaves exactly
as production does when the model is down - text, no voice.

**The register is a rule, not a preference** (docs/contracts/dispatch-radio-voice.md,
decision 4): literal translation plus speech normalisation, and the model may not add
a fact the operator did not say. That rule has no automatic guard - the audio is
English and the screen is Russian, so nobody will notice a voice naming a street that
was never mentioned. It is therefore stated three times in the prompt and the output is
checked for the shapes that indicate invention.

Standard library only; Ollama is reached over plain HTTP.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass

DEFAULT_URL = "http://localhost:11434"
TIMEOUT = 120

# Russian is NOT among the languages Meta lists as officially supported for Llama 3.1,
# while Gemma and Qwen both carry it. A model outside this hint still runs - the note
# exists so a poor result is read as a model choice rather than a broken pipeline.
GOOD_FOR_RUSSIAN = ("gemma", "qwen", "mistral", "aya", "command-r")

SYSTEM = """You translate police radio traffic from Russian to English.

Rules, in order of importance:
1. NEVER add a fact. No address, no code, no unit, no reason, no detail that is not in
   the Russian. If the operator did not say it, it does not appear.
2. Translate literally. Do not make it sound more like radio than the original does.
3. Leave names alone: people, streets, districts, and vehicle models stay as written
   (Sultan stays Sultan).
4. Write numbers as words the way they are spoken on a radio: a callsign digit by
   digit, a code as a word - "code four", not "code 4".
5. If the Russian is empty, garbled or unintelligible, return an empty english field.
   An empty answer is correct; an invented one is not.

Also judge how urgent the transmission is:
  routine   - ordinary traffic, acknowledgements, status
  urgent    - a weapon present, an injury, a pursuit, a request for backup
  emergency - a weapon used, shots fired, an officer down

Answer with JSON only: {"english": "...", "level": "routine|urgent|emergency"}"""


@dataclass(frozen=True)
class Translation:
    english: str
    level: str
    model: str
    raw: str = ""
    error: str | None = None


def _get(url: str, timeout: int = 5) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return json.loads(response.read())
    except (urllib.error.URLError, OSError, ValueError, TimeoutError):
        return None


def available(base_url: str = DEFAULT_URL) -> list[str]:
    """Model names Ollama is actually serving, or an empty list when it is not up."""
    tags = _get(f"{base_url.rstrip('/')}/api/tags")
    if not tags:
        return []
    return [m.get("name", "") for m in tags.get("models", []) if m.get("name")]


def suits_russian(model: str) -> bool:
    return any(hint in model.lower() for hint in GOOD_FOR_RUSSIAN)


def _extract_json(text: str) -> dict | None:
    """Models wrap JSON in prose and fences; take the first object that parses."""
    for candidate in re.findall(r"\{[^{}]*\}", text, re.DOTALL):
        try:
            return json.loads(candidate)
        except ValueError:
            continue
    return None


def translate(text: str, model: str, base_url: str = DEFAULT_URL,
              timeout: int = TIMEOUT) -> Translation:
    """One call that returns both the English and the level."""
    body = json.dumps({
        "model": model,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": text},
        ],
    }).encode()

    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/chat", data=body,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read())
    except (urllib.error.URLError, OSError, ValueError, TimeoutError) as exc:
        return Translation("", "routine", model, error=f"ollama: {exc}")

    raw = (payload.get("message") or {}).get("content", "")
    parsed = _extract_json(raw) or {}
    english = str(parsed.get("english", "")).strip()
    level = str(parsed.get("level", "")).strip().lower()
    if level not in ("routine", "urgent", "emergency"):
        level = "routine"

    return Translation(english, level, model, raw=raw)


def looks_invented(russian: str, english: str) -> list[str]:
    """Cheap signals that the model added something. Not a guard - a tripwire.

    It cannot catch a wrong street name, which is the failure that matters; what it
    catches is the coarse shape of invention: an answer far longer than its source, or
    digits appearing in English that were nowhere in the Russian.
    """
    flags = []
    if english and len(english.split()) > max(6, len(russian.split()) * 2 + 3):
        flags.append("much longer than the source")
    source_digits = set(re.findall(r"\d", russian))
    for digit in set(re.findall(r"\d", english)):
        if digit not in source_digits:
            flags.append(f"digit {digit} is not in the Russian")
            break
    return flags
