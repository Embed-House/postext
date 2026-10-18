"""Tests of the font families `preset_kit.font_families` reads from a folder.

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import tempfile
import zipfile
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


@unittest.skipUnless(HAVE_FONTTOOLS, "needs fontTools")
class FontFallbackTest(unittest.TestCase):
    def project(self, root: Path, fallback: dict | None = None) -> dict:
        (root / "fonts").mkdir()
        write_font(root / "fonts" / "G-Regular.ttf", "Adobe Garamond Pro", "Regular", "AGP-Regular", 400)
        write_font(root / "fonts" / "O-Regular.ttf", "Open Serif", "Regular", "OS-Regular", 400)
        (root / "chapters" / "es").mkdir(parents=True)
        (root / "chapters" / "es" / "01.md").write_text("# Uno\n\nTexto.\n", encoding="utf-8")
        manifest = {"id": "t", "name": "T", "fonts": kit.font_families(
            root, {"Adobe Garamond Pro": False}, fallback), "chapters": {"es": [{"title": "Uno", "file": "chapters/es/01.md"}]},
            "config": {}, "resources": []}
        (root / "preset.json").write_text(json.dumps(manifest), encoding="utf-8")
        return manifest

    def pack(self, root: Path, *extra: str) -> tuple[dict, str, list[str]]:
        out = root / "t.postext"
        with contextlib.redirect_stdout(io.StringIO()) as buf:
            kit.cmd_pack(argparse.Namespace(project=str(root), out=str(out), manifest_only=False, exclude=[],
                                            fallback=list(extra)))
        with zipfile.ZipFile(out) as z:
            return json.loads(z.read("preset.json")), buf.getvalue(), sorted(z.namelist())

    def test_the_pack_keeps_a_licensed_family_with_its_fallback_and_no_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.project(root)
            packed, out, names = self.pack(root, "Adobe Garamond Pro=Open Serif")
            fams = {f["name"]: f for f in packed["fonts"]}
            self.assertEqual(fams["Adobe Garamond Pro"], {"name": "Adobe Garamond Pro", "redistributable": False,
                                                          "variants": [], "fallback": "Open Serif"})
            self.assertEqual(len(fams["Open Serif"]["variants"]), 1)
            self.assertNotIn("fonts/G-Regular.ttf", names)
            self.assertIn("fonts/O-Regular.ttf", names)
            self.assertIn("set in Open Serif", out)

    def test_the_manifest_in_the_project_is_untouched_and_a_bare_family_is_told(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.project(root)
            before = (root / "preset.json").read_text(encoding="utf-8")
            packed, out, _ = self.pack(root)
            self.assertEqual((root / "preset.json").read_text(encoding="utf-8"), before)
            self.assertNotIn("fallback", packed["fonts"][0])
            self.assertIn("Adobe Garamond Pro: no fallback", out)
            self.assertIn("fonts.py width", out)

    def test_a_fallback_in_the_manifest_is_enough(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.project(root, {"Adobe Garamond Pro": "Open Serif"})
            packed, out, _ = self.pack(root)
            self.assertEqual(packed["fonts"][0]["variants"], [])
            self.assertEqual(packed["fonts"][0]["fallback"], "Open Serif")
            self.assertNotIn("no fallback", out)

    def test_bad_fallback_arguments(self):
        with self.assertRaises(SystemExit):
            kit.parse_fallbacks(["no equals sign"])
        with self.assertRaises(SystemExit):
            kit.parse_fallbacks(["A=A"])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.project(root)
            with self.assertRaises(SystemExit):
                self.pack(root, "Nothing=Open Serif")


def write_wide_font(path: Path, advance: int) -> None:
    """A font whose letters a-z and the space all advance `advance` of 1000."""
    fb = FontBuilder(1000, isTTF=True)
    letters = {ord(c): c for c in "abcdefghijklmnopqrstuvwxyz "}
    names = [".notdef"] + [("space" if c == " " else c) for c in letters.values()]
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({cp: ("space" if ch == " " else ch) for cp, ch in letters.items()})
    fb.setupGlyf({n: TTGlyphPen(None).glyph() for n in names})
    fb.setupHorizontalMetrics({n: (advance, 0) for n in names})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "W", "styleName": "Regular", "psName": f"W{advance}"})
    fb.setupOS2(usWeightClass=400)
    fb.setupPost()
    fb.save(str(path))


@unittest.skipUnless(HAVE_FONTTOOLS, "needs fontTools")
class WidthTest(unittest.TestCase):
    def test_a_stand_in_is_picked_by_the_width_of_the_book_text(self):
        import fonts
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ch").mkdir()
            (root / "ch" / "01.md").write_text(
                "# Title\n\n:::callout\n:::\n\nthe quick brown fox jumps over the lazy dog\n\n"
                "```\ncode stays out\n```\n", encoding="utf-8")
            text = fonts.sample_text(root / "ch")
            self.assertEqual(text, "the quick brown fox jumps over the lazy dog")
            for name, adv in (("lic", 500), ("near", 505), ("close", 495), ("far", 600)):
                write_wide_font(root / f"{name}.ttf", adv)
            w = {n: fonts.text_width_mm(fonts.TTFont(str(root / f"{n}.ttf")), text, 10) for n in ("lic", "near", "close", "far")}
            self.assertAlmostEqual(w["lic"], len(text) * 0.5 * 10 * 25.4 / 72, places=6)
            self.assertEqual(fonts.width_verdict(w["near"] / w["lic"]), "stand-in (within 2 %)")
            self.assertEqual(fonts.width_verdict(w["close"] / w["lic"]), "stand-in (within 2 %)")
            self.assertEqual(fonts.width_verdict(1.04), "near (within 5 %)")
            self.assertEqual(fonts.width_verdict(w["far"] / w["lic"]), "too far")

class FallbackTravelsInExports(unittest.TestCase):
    """#993 (postext 1.43): the fallback's faces are embedded in the EPUB, the
    HTML and the SVG pictures of an export, so it must be an open family."""

    def check(self, fonts: list[dict]) -> list[tuple[str, str, str]]:
        import lint_project as lp

        rep = lp.Report()
        licensed = {f["name"] for f in fonts if f.get("redistributable") is False}
        for f in fonts:
            lp.check_font_fallback(f, rep, licensed)
        return rep.items

    def test_a_licensed_family_as_the_fallback_of_another_is_an_error(self):
        items = self.check([
            {"name": "Adobe Garamond Pro", "redistributable": False, "variants": [], "fallback": "Minion Pro"},
            {"name": "Minion Pro", "redistributable": False, "variants": []}])
        errors = [m for lvl, _, m in items if lvl == "ERROR"]
        self.assertEqual(len(errors), 1)
        self.assertIn("redistributable: false", errors[0])

    def test_an_open_fallback_is_fine(self):
        items = self.check([{"name": "Adobe Garamond Pro", "redistributable": False, "variants": [], "fallback": "EB Garamond"}])
        self.assertEqual([lvl for lvl, _, _ in items if lvl == "ERROR"], [])


if __name__ == "__main__":
    unittest.main()
