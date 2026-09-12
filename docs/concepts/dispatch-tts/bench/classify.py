"""Urgency from the text alone, with no model - the prior the LLM has to beat.

Under a deployment with no GPU and no API key there may be no model at all, and this
still has to produce a level, because the level is what a voice is spoken at. So the
rules come first and a model, when there is one, is allowed to raise or lower what
they decided.

**Where this came from, and where it did not.** GTAW-Dispatch-Relay scores incidents
on signal groups - weapon, violence, medical, in-progress and so on - and that shape
is worth having. Its other half is not: it exists to reject out-of-character chatter,
greetings, pranks and hang-ups from a raw chat log, and nothing here needs that. A
transmission arrives as an authenticated event on a radio channel; an operator pressed
the key and typed. There is nothing to guess about whether it happened. The signal
words below are this project's own, in Russian, because that is what an operator types.

Standard library only.
"""

from __future__ import annotations

import re
import time
import unicodedata
from dataclasses import dataclass, field

from normalise import is_shout

Level = str  # "routine" | "urgent" | "emergency"

LEVELS: tuple[Level, ...] = ("routine", "urgent", "emergency")


def _group(*words: str) -> re.Pattern:
    """Match any of these stems at a word boundary, case- and ё-insensitively."""
    return re.compile(r"(?<![а-яa-z])(?:" + "|".join(words) + r")", re.IGNORECASE)


# What a transmission is ABOUT. Each group carries the level it argues for; the
# highest one that fires wins, because a call is as urgent as its worst element.
SIGNALS: tuple[tuple[str, re.Pattern, Level], ...] = (
    # A weapon PRESENT is urgent; a weapon USED is an emergency. Collapsing the two
    # makes every mention of a gun the top level, and a level that fires constantly
    # is one an operator stops hearing.
    ("weapon", _group("оруж", "пистолет", "ствол", "нож", "автомат", "вооруж"), "urgent"),
    ("shooting", _group("стрельб", "стреля", "огонь по", "открыт огонь", "выстрел"), "emergency"),
    ("officer", _group("офицер ранен", "ранен офицер", "код 0", "нужна помощь"), "emergency"),
    ("medical", _group("скорую", "скорая", "ранен", "без сознан", "не дышит", "кровотеч"), "urgent"),
    ("violence", _group("драк", "избие", "нападени", "напал", "угроз", "захват"), "urgent"),
    ("pursuit", _group("преследован", "погон", "скрылся", "уходит от"), "urgent"),
    ("backup", _group("подкреплен", "нужен экипаж", "срочно на"), "urgent"),
    ("fire", _group("пожар", "гори", "дым", "взрыв"), "urgent"),
    ("in_progress", _group("в процессе", "прямо сейчас", "на месте происш"), "urgent"),
    ("traffic", _group("дтп", "авари", "остановка транспорт", "остановку транспорт", "нарушен"), "routine"),
    ("property", _group("кража", "угон", "взлом", "ограблен"), "routine"),
    ("disturbance", _group("шум", "беспоряд", "конфликт", "пьян"), "routine"),
)

# Words that argue the call is OVER. They cannot lower an emergency - a "code 4" in
# the same breath as shots fired is a correction someone will send separately, not a
# reason to read the shooting calmly.
STAND_DOWN = _group("код 4", "отбой", "под контролем", "отмен", "ложный вызов", "код четыре")


@dataclass
class Verdict:
    level: Level
    signals: list[str] = field(default_factory=list)
    shouted: bool = False
    stood_down: bool = False

    @property
    def reason(self) -> str:
        """Why this level - so an operator can be shown it rather than trusting it."""
        if self.shouted:
            return "capitals: the operator's own signal"
        if not self.signals:
            return "stood down" if self.stood_down else "nothing matched; routine by default"
        parts = ", ".join(self.signals)
        return f"stood down after {parts}" if self.stood_down else parts


def classify(text: str) -> Verdict:
    """The rule-based level. Capitals outrank everything, including a stand-down."""
    folded = unicodedata.normalize("NFKC", text).replace("ё", "е")

    fired = [(name, level) for name, pattern, level in SIGNALS if pattern.search(folded)]
    stood_down = bool(STAND_DOWN.search(folded))

    if is_shout(text):
        return Verdict("emergency", [n for n, _ in fired], shouted=True, stood_down=stood_down)

    if not fired:
        return Verdict("routine", [], stood_down=stood_down)

    level = max((lvl for _, lvl in fired), key=LEVELS.index)
    # A stand-down softens an urgent call to routine, and never touches an emergency.
    if stood_down and level == "urgent":
        level = "routine"
    return Verdict(level, [n for n, _ in fired], stood_down=stood_down)


def reconcile(rules: Verdict, model_level: Level | None) -> Level:
    """Put the rules and the model together.

    The operator's capitals are final. Otherwise the model may move the level in
    either direction - it reads meaning the rules cannot - except that it may not
    talk an EMERGENCY down: a rule fired on a weapon or a shooting, and a model
    quietly deciding otherwise is the one failure with a body attached.
    """
    if rules.shouted:
        return "emergency"
    if model_level not in LEVELS:
        return rules.level
    if rules.level == "emergency":
        return "emergency"
    return model_level


class RepeatFilter:
    """Suppress the same transmission repeated on the same channel within a window.

    A radio repeats itself constantly and that is normal; what is not normal is the
    same words twice inside a few seconds, which is a double key-press or a retry.
    Suppressing the AUDIO only - the text still goes out, because the operator did
    send it twice and the log is the log.
    """

    def __init__(self, window_seconds: float = 20.0):
        self.window = window_seconds
        self._seen: dict[tuple[str, str], float] = {}

    def should_speak(self, channel: str, text: str, now: float | None = None) -> bool:
        stamp = time.monotonic() if now is None else now
        key = (channel, re.sub(r"\s+", " ", text.strip().lower()))
        last = self._seen.get(key)
        self._seen[key] = stamp
        if last is not None and stamp - last < self.window:
            return False
        # Keep the table from growing across a shift.
        for k, t in list(self._seen.items()):
            if stamp - t > self.window * 10:
                del self._seen[k]
        return True
