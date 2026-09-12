"""Speech normalisation and the urgency signal - the half of the translator that is
a rule rather than a model.

The contract (docs/contracts/dispatch-radio-voice.md) says the register is literal
translation plus speech normalisation, and that ALL CAPS is the operator's own shout
signal. Both of those are decidable without a model, so they are decided here: the
model translates, this makes the result speakable, and neither is allowed to invent.

Standard library only - no numpy, no model, no network. It runs on the phone.
"""

from __future__ import annotations

import re
import unicodedata

Level = str  # "routine" | "urgent" | "emergency"

DIGIT_WORDS = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
}

# A callsign is digits and words joined by hyphens - 1-Adam-12, 4-L-20. The digits
# in it are spoken one at a time, which is the whole reason this function exists.
CALLSIGN_RE = re.compile(r"\b(\d{1,3})-([A-Za-z]+)-(\d{1,3})\b")

# "code 4", "code 3" - the number stays a number and becomes a word, never an ordinal.
CODE_RE = re.compile(r"\b(code)\s+(\d{1,2})\b", re.IGNORECASE)

# A bare run of digits, once the shapes above have had their turn.
DIGITS_RE = re.compile(r"\b\d{2,}\b")

# Caps must be a deliberate shout, not an acronym. A message needs this many letters
# and this share of them uppercase before it counts - otherwise "BOLO on a red Sultan"
# would arrive as an emergency, which is the silent failure this guard exists for.
CAPS_MIN_LETTERS = 12
CAPS_MIN_SHARE = 0.75


def speak_digits(number: str) -> str:
    """Digit by digit: 12 -> 'one two'. A callsign is read, not counted."""
    return " ".join(DIGIT_WORDS[d] for d in number if d in DIGIT_WORDS)


def _number_word(number: str) -> str:
    """A small number as one word, for codes. Falls back to digits when out of range."""
    ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
            "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
            "seventeen", "eighteen", "nineteen"]
    value = int(number)
    if value < len(ones):
        return ones[value]
    tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
    if value < 100:
        head, rest = divmod(value, 10)
        return tens[head] + (f" {ones[rest]}" if rest else "")
    return speak_digits(number)


def normalise_for_speech(text: str) -> str:
    """Make an English line speakable without changing what it says."""
    def callsign(match: re.Match) -> str:
        # The lead is read digit by digit and the tail as a number: 1-Adam-12 is
        # "one Adam twelve", never "one Adam one two". Getting this backwards is
        # audible on the first transmission of any shift.
        first, word, second = match.groups()
        return f"{speak_digits(first)} {word} {_number_word(second)}"

    out = CALLSIGN_RE.sub(callsign, text)
    out = CODE_RE.sub(lambda m: f"{m.group(1)} {_number_word(m.group(2))}", out)
    out = DIGITS_RE.sub(lambda m: speak_digits(m.group(0)), out)
    out = re.sub(r"\s+", " ", out).strip()
    # A transmission is a sentence, so it starts with a capital. Guarding on the
    # INPUT's first character was wrong: a line beginning with a callsign begins with
    # a digit, which is neither upper nor lower case, so the guard never fired on the
    # one case it existed for.
    if out and out[0].islower():
        out = out[0].upper() + out[1:]
    return out


def is_shout(text: str) -> bool:
    """True when the operator typed in capitals deliberately."""
    letters = [c for c in text if c.isalpha()]
    if len(letters) < CAPS_MIN_LETTERS:
        return False
    upper = sum(1 for c in letters if c.isupper())
    return upper / len(letters) >= CAPS_MIN_SHARE


def strip_shout(text: str) -> str:
    """Take the capitals off before the text reaches a model; urgency goes as a parameter.

    Uppercase handed to a model makes it re-act the emotion and destabilises the
    voice - a finding GTAW-Dispatch-Relay's config records from its own production.

    Sentence starts are restored, and **proper nouns are not**: an operator who typed
    the whole line in capitals did not tell us which words were names, and inventing
    that is exactly the kind of guess this project does not make. The translator sees
    a lower-case place name and handles it; nothing downstream depends on the casing.
    """
    if not is_shout(text):
        return text
    lowered = text.lower()
    return re.sub(r"(^|(?<=[.!?])\s+)([^\s])",
                  lambda m: m.group(1) + m.group(2).upper(), lowered)


def level_for(text: str, model_level: Level | None = None) -> Level:
    """The urgency the transmission is spoken at.

    The operator's capitals OUTRANK the classifier: an explicit signal is not a
    hypothesis to be weighed against a model's opinion.
    """
    if is_shout(text):
        return "emergency"
    return model_level or "routine"
