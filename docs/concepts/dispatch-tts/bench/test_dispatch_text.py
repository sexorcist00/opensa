"""Tests for the two parts of the translator that are rules rather than a model.

Layout follows the project's convention: negative cases in their own block first,
positive cases after. Standard library only, so it runs anywhere the tools do:

    python -m unittest test_dispatch_text -v
"""

import unittest

from glossary import Entry, Glossary, bank_key, match_key
from classify import RepeatFilter, classify, reconcile
from normalise import is_shout, level_for, normalise_for_speech, strip_shout


class NormaliseNegativeCases(unittest.TestCase):
    def test_leaves_a_vehicle_name_alone(self):
        line = "In pursuit, gray Sultan, northbound on Mulholland."
        self.assertEqual(normalise_for_speech(line), line)

    def test_does_not_touch_a_line_with_nothing_to_normalise(self):
        line = "Dispatch, requesting backup, suspect is armed."
        self.assertEqual(normalise_for_speech(line), line)

    def test_does_not_lower_case_the_start_of_a_line(self):
        self.assertTrue(normalise_for_speech("1-Adam-12, respond.")[0].isupper())


class ShoutNegativeCases(unittest.TestCase):
    def test_an_acronym_is_not_a_shout(self):
        self.assertFalse(is_shout("BOLO on a red Sultan, last seen on Grove."))

    def test_a_short_capitalised_word_is_not_a_shout(self):
        self.assertFalse(is_shout("CODE 4"))

    def test_ordinary_text_is_not_a_shout(self):
        self.assertFalse(is_shout("Всем постам, код 4, обстановка под контролем."))

    def test_a_non_shout_is_returned_untouched(self):
        line = "Принял, буду через две минуты."
        self.assertEqual(strip_shout(line), line)


class GlossaryNegativeCases(unittest.TestCase):
    def test_a_phrase_that_is_not_in_the_bank_misses(self):
        g = Glossary([Entry(ru="принял", en="Ten four.")])
        self.assertIsNone(g.lookup("преследование, серый Sultan"))

    def test_an_unknown_match_mode_is_inert_rather_than_wrong(self):
        g = Glossary([Entry(ru="принял", en="Ten four.", match="fuzzy")])
        self.assertEqual(len(g), 0)
        self.assertIsNone(g.lookup("принял"))
        self.assertEqual(len(g.ignored), 1)

    def test_an_inner_word_change_is_not_a_hit(self):
        g = Glossary([Entry(ru="принял, буду через две минуты", en="Ten four.")])
        self.assertIsNone(g.lookup("принял, буду через три минуты"))


class NormalisePositiveCases(unittest.TestCase):
    def test_a_callsign_reads_its_lead_as_digits_and_its_tail_as_a_number(self):
        self.assertEqual(
            normalise_for_speech("1-Adam-12, respond to Grove Street and Main."),
            "One Adam twelve, respond to Grove Street and Main.",
        )

    def test_a_callsign_keeps_the_letter_group_as_written(self):
        self.assertIn("Adam twelve", normalise_for_speech("1-Adam-12 responding."))

    def test_a_code_keeps_its_number_as_a_word(self):
        self.assertEqual(
            normalise_for_speech("All units, code 4, situation under control."),
            "All units, code four, situation under control.",
        )

    def test_a_bare_number_is_spoken_digit_by_digit(self):
        self.assertIn("nine one one", normalise_for_speech("Caller dialled 911."))


class ShoutPositiveCases(unittest.TestCase):
    def test_capitals_are_read_as_a_shout(self):
        self.assertTrue(is_shout("ОТКРЫТ ОГОНЬ ПО ОФИЦЕРУ, ВСЕ СВОБОДНЫЕ НА ИДЛВУД!"))

    def test_a_shout_outranks_the_classifier(self):
        self.assertEqual(
            level_for("ОТКРЫТ ОГОНЬ ПО ОФИЦЕРУ, ВСЕ СВОБОДНЫЕ НА ИДЛВУД!", "routine"),
            "emergency",
        )

    def test_the_classifier_decides_when_there_are_no_capitals(self):
        self.assertEqual(level_for("Диспетчер, запросите подкрепление.", "urgent"), "urgent")

    def test_a_missing_classifier_verdict_means_routine(self):
        self.assertEqual(level_for("Принял."), "routine")

    def test_capitals_come_off_before_the_text_reaches_a_model(self):
        stripped = strip_shout("ОТКРЫТ ОГОНЬ ПО ОФИЦЕРУ, ВСЕ СВОБОДНЫЕ НА ИДЛВУД!")
        self.assertNotIn("ОГОНЬ", stripped)
        self.assertTrue(stripped.startswith("О"))


class GlossaryPositiveCases(unittest.TestCase):
    def test_case_spacing_and_trailing_punctuation_do_not_decide_a_match(self):
        g = Glossary([Entry(ru="Принял, буду через две минуты.", en="Ten four.")])
        self.assertIsNotNone(g.lookup("  принял,   буду через две минуты!!  "))

    def test_an_entry_carries_its_level(self):
        g = Glossary([Entry(ru="открыт огонь", en="Shots fired!", level="emergency")])
        self.assertEqual(g.lookup("Открыт огонь").level, "emergency")

    def test_the_key_keeps_inner_punctuation(self):
        self.assertEqual(match_key("Принял, буду."), "принял, буду")

    def test_the_bank_key_separates_voices_and_model_versions(self):
        first = bank_key("принял", "dispatch-1", "chatterbox-0.5b")
        self.assertNotEqual(first, bank_key("принял", "dispatch-2", "chatterbox-0.5b"))
        self.assertNotEqual(first, bank_key("принял", "dispatch-1", "indextts2"))


if __name__ == "__main__":
    unittest.main()


class ClassifyNegativeCases(unittest.TestCase):
    def test_a_plain_acknowledgement_is_routine(self):
        self.assertEqual(classify("Принял, буду через две минуты.").level, "routine")

    def test_a_weapon_present_is_not_an_emergency(self):
        # Urgent, not emergency: a level that fires on every mention of a gun is one
        # an operator stops hearing.
        self.assertEqual(classify("Подозреваемый вооружён.").level, "urgent")

    def test_a_stand_down_cannot_cool_an_emergency(self):
        self.assertEqual(classify("Открыт огонь, отбой").level, "emergency")

    def test_a_model_may_not_talk_an_emergency_down(self):
        rules = classify("Стрельба на Гроув-стрит.")
        self.assertEqual(reconcile(rules, "routine"), "emergency")

    def test_a_missing_model_verdict_leaves_the_rules_standing(self):
        rules = classify("Преследование, серый Sultan.")
        self.assertEqual(reconcile(rules, None), "urgent")

    def test_a_repeat_inside_the_window_is_not_spoken_twice(self):
        f = RepeatFilter(window_seconds=20.0)
        self.assertTrue(f.should_speak("r1", "Принял", now=100.0))
        self.assertFalse(f.should_speak("r1", "  принял  ", now=105.0))


class ClassifyPositiveCases(unittest.TestCase):
    def test_the_six_bench_lines_get_the_levels_the_spec_documents(self):
        expected = {
            "1-Адам-12, ответьте на угол Гроув-стрит и Мэйн, драка.": "urgent",
            "ОТКРЫТ ОГОНЬ ПО ОФИЦЕРУ, ВСЕ СВОБОДНЫЕ НА ИДЛВУД!": "emergency",
            "Принял, буду через две минуты.": "routine",
            "Диспетчер, запросите подкрепление, подозреваемый вооружён.": "urgent",
            "Всем постам, код 4, обстановка под контролем.": "routine",
            "Преследование, серый Sultan, движется на север по Мулхолланд.": "urgent",
        }
        for line, level in expected.items():
            self.assertEqual(classify(line).level, level, msg=line)

    def test_shooting_is_an_emergency(self):
        self.assertEqual(classify("Стрельба у банка на Мэйн.").level, "emergency")

    def test_the_verdict_says_why(self):
        self.assertIn("pursuit", classify("Начинаю преследование.").reason)

    def test_a_stand_down_cools_an_urgent_call(self):
        self.assertEqual(classify("Драка на Гроув-стрит, отбой, под контролем.").level, "routine")

    def test_the_same_words_on_another_channel_are_spoken(self):
        f = RepeatFilter(window_seconds=20.0)
        self.assertTrue(f.should_speak("r1", "Принял", now=100.0))
        self.assertTrue(f.should_speak("r3", "Принял", now=101.0))

    def test_a_repeat_after_the_window_is_spoken_again(self):
        f = RepeatFilter(window_seconds=20.0)
        self.assertTrue(f.should_speak("r1", "Принял", now=100.0))
        self.assertTrue(f.should_speak("r1", "Принял", now=140.0))
