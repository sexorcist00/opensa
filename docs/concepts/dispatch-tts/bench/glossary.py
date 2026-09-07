"""The dictionary: the path to audio that never runs a model.

Under a deployment with no GPU this is not an optimisation, it is the product - a
pre-baked bank plays instantly and free, and anything not in it goes out as text with
no voice at all (decision 11). So the matching rule has to be something a person can
predict by looking, which is why it normalises almost nothing.

Standard library only.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

# The contract's rule, and deliberately no more than this: lowercase, trim, collapse
# whitespace runs, drop trailing punctuation. Anything cleverer makes a hit something
# the operator cannot foresee, and an unpredictable dictionary is worse than a small one.
_TRAILING_PUNCT = ".,!?;:…"


def match_key(text: str) -> str:
    folded = unicodedata.normalize("NFKC", text).strip().lower()
    folded = re.sub(r"\s+", " ", folded)
    return folded.rstrip(_TRAILING_PUNCT).strip()


@dataclass(frozen=True)
class Entry:
    ru: str
    en: str
    level: str = "routine"
    match: str = "exact"

    @property
    def key(self) -> str:
        return match_key(self.ru)


class Glossary:
    """Exact-match lookup, plus the bank key that keeps a voice from going stale."""

    def __init__(self, entries: list[Entry]):
        # An unknown match mode is ignored rather than guessed, so an entry written
        # for a future mode is inert instead of wrong.
        self._by_key = {e.key: e for e in entries if e.match == "exact"}
        self.ignored = [e for e in entries if e.match != "exact"]

    @classmethod
    def load(cls, path: str | Path) -> "Glossary":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls([Entry(**row) for row in raw["entries"]])

    def lookup(self, ru_text: str) -> Entry | None:
        return self._by_key.get(match_key(ru_text))

    def __len__(self) -> int:
        return len(self._by_key)


def bank_key(entry_key: str, voice_id: str, model_version: str) -> str:
    """What a baked clip is filed under.

    The model version is part of it on purpose. Without it the first use of a phrase
    in a voice is synthesised live and kept forever, so when the model changes some
    phrases come from the old bank and some from the new one - and it presents as the
    radio being inconsistent rather than as a cache being stale.
    """
    safe = re.sub(r"[^a-z0-9]+", "-", f"{entry_key}-{voice_id}-{model_version}".lower())
    return safe.strip("-")
