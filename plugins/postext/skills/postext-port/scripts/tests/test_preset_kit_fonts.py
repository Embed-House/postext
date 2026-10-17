"""Tests of the font families `preset_kit.font_families` reads from a folder.

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

try:
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    HAVE_FONTTOOLS = True
except Exception:  # pragma: no cover
    HAVE_FONTTOOLS = False

import preset_kit as kit  # noqa: E402


def write_font(path: Path, family: str, subfamily: str, ps: str, weight: int = 400) -> None:
    """A one-glyph font whose name tables say `family` / `subfamily` (the way
    a foundry's names do: a width in the PostScript name only)."""
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder([".notdef"])
    fb.setupCharacterMap({})
    fb.setupGlyf({".notdef": TTGlyphPen(None).glyph()})
    fb.setupHorizontalMetrics({".notdef": (500, 0)})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": family, "styleName": subfamily, "psName": ps})
    fb.setupOS2(usWeightClass=weight)
    fb.setupPost()
    fb.save(str(path))


@unittest.skipUnless(HAVE_FONTTOOLS, "needs fontTools")
class FontFamiliesTest(unittest.TestCase):
    def test_width_in_the_postscript_name_is_its_own_family(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "fonts").mkdir()
            write_font(root / "fonts" / "A-Bold.ttf", "Humanist Sans", "Bold", "HumanistSans-Bold", 700)
            write_font(root / "fonts" / "A-BoldCn.ttf", "Humanist Sans", "Bold", "HumanistSans-BoldCn", 700)
            write_font(root / "fonts" / "A-Cn.ttf", "Humanist Sans", "Regular", "HumanistSans-Cn", 400)
            fams = {f["name"]: f for f in kit.font_families(root)}
            self.assertEqual(set(fams), {"Humanist Sans", "Humanist Sans Cn"})
            self.assertEqual(sorted(v["weight"] for v in fams["Humanist Sans Cn"]["variants"]), [400, 700])
            self.assertEqual(len(fams["Humanist Sans"]["variants"]), 1)

    def test_it_suffix_is_italic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "fonts").mkdir()
            write_font(root / "fonts" / "S-Regular.ttf", "Serif Pro", "Regular", "SerifPro-Regular", 400)
            write_font(root / "fonts" / "S-It.ttf", "Serif Pro", "Regular", "SerifPro-It", 400)
            write_font(root / "fonts" / "S-BoldIt.ttf", "Serif Pro", "Bold", "SerifPro-BoldIt", 700)
            variants = kit.font_families(root)[0]["variants"]
            self.assertEqual([(v["style"], v["weight"]) for v in variants],
                             [("normal", 400), ("italic", 400), ("italic", 700)])


if __name__ == "__main__":
    unittest.main()
