"""Special spaces in the port draft (`postext_md.clean_text`,
`collapse_spaces`, `fixed_space`): en and em spaces stay, thin spaces that
hold a number together become narrow no-break spaces."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import postext_md as pmd  # noqa: E402

THIN, HAIR, EN, EM, NNBSP, NBSP = " ", " ", " ", " ", " ", " "


class CleanTextSpaces(unittest.TestCase):
    def test_en_and_em_spaces_are_kept(self):
        self.assertEqual(pmd.clean_text(f"1{EN}Los seres vivos"), f"1{EN}Los seres vivos")
        self.assertEqual(pmd.clean_text(f"Tema 3{EM}Las plantas"), f"Tema 3{EM}Las plantas")

    def test_thin_space_between_digits_glues(self):
        self.assertEqual(pmd.clean_text(f"1{THIN}000 personas"), f"1{NNBSP}000 personas")
        self.assertEqual(pmd.clean_text(f"3{HAIR}000{HAIR}000"), f"3{NNBSP}000{NNBSP}000")

    def test_thin_space_before_percent_degree_and_units_glues(self):
        self.assertEqual(pmd.clean_text(f"21{THIN}%"), f"21{NNBSP}%")
        self.assertEqual(pmd.clean_text(f"37{THIN}°C"), f"37{NNBSP}°C")
        self.assertEqual(pmd.clean_text(f"5{THIN}mm de lado"), f"5{NNBSP}mm de lado")
        self.assertEqual(pmd.clean_text(f"120{THIN}mmHg"), f"120{NNBSP}mmHg")
        self.assertEqual(pmd.clean_text(f"5{THIN}€"), f"5{NNBSP}€")

    def test_thin_space_before_a_word_is_plain(self):
        # `m` is a unit, `mesas` is not
        self.assertEqual(pmd.clean_text(f"5{THIN}mesas"), "5 mesas")
        self.assertEqual(pmd.clean_text(f"a{THIN}b"), "a b")

    def test_french_punctuation(self):
        self.assertEqual(pmd.clean_text(f"Bonjour{THIN}!"), f"Bonjour{NNBSP}!")
        self.assertEqual(pmd.clean_text(f"«{THIN}oui{THIN}»"), f"«{NNBSP}oui{NNBSP}»")

    def test_fixed_space_and_space_collapse(self):
        self.assertEqual(pmd.clean_text(f"2 {EN} Los seres"), f"2{EN}Los seres")
        self.assertEqual(pmd.clean_text(f"x {NBSP} y"), f"x{NBSP}y")
        self.assertEqual(pmd.collapse_spaces(f"  Tema 3 {EM}  Las plantas "), f"Tema 3{EM}Las plantas")

    def test_headings_and_attributes_keep_the_fixed_space(self):
        self.assertEqual(pmd.heading(2, f"1{EN}Los seres vivos"), f"## 1{EN}Los seres vivos")
        self.assertEqual(pmd.attr_value(f"Tema 3{EM}Las plantas"), f"Tema 3{EM}Las plantas")

    def test_other_odd_spaces_are_plain(self):
        self.assertEqual(pmd.clean_text("a b c　d"), "a b c d")


class FixedSpace(unittest.TestCase):
    def test_word_space_en_em(self):
        self.assertEqual(pmd.fixed_space(0.3, 1.0), " ")
        self.assertEqual(pmd.fixed_space(0.6, 1.0), EN)
        self.assertEqual(pmd.fixed_space(1.2, 1.0), EM)
        self.assertEqual(pmd.fixed_space(1.0, 0.0), " ")


if __name__ == "__main__":
    unittest.main()
