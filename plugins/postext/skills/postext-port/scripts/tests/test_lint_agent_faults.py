"""Tests of the `lint_project.py` checks for faults an agent leaves in a port
(#1112): marks in design text without `inlineMarks`, a plain space beside a
fixed space, `:chip` in a heading on an engine that predates heading chips,
and capitals set by hand at small-capital size.

    python3 -m pytest plugins/postext/skills/postext-port/scripts/tests -q
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))
import lint_project as lp  # noqa: E402

PT = lambda v: {"value": v, "unit": "pt"}  # noqa: E731
EM = lambda v: {"value": v, "unit": "em"}  # noqa: E731


def footer(content: str, **extra) -> dict:
    return {"footer": {"elements": [{"kind": "text", "id": "folio", "content": content, **extra}]}}


def lint(config: dict, chapter: str, *args: str, package: dict | None = None) -> list[str]:
    """Run the lint on a one-chapter project; the WARN/INFO/ERROR lines."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "chapters").mkdir()
        (root / "chapters" / "01.md").write_text(chapter, encoding="utf-8")
        manifest = {"version": 2, "configVersion": 16, "id": "t", "name": "T", "locale": "en",
                    "config": {"bodyText": {"fontSize": PT(10)}, **config},
                    "chapters": {"en": [{"title": "One", "file": "chapters/01.md"}]}}
        (root / "preset.json").write_text(json.dumps(manifest), encoding="utf-8")
        if package is not None:
            (root / "package.json").write_text(json.dumps(package), encoding="utf-8")
        r = subprocess.run([sys.executable, str(SCRIPTS / "lint_project.py"), str(root), *args],
                           capture_output=True, text=True)
        return [ln for ln in r.stdout.splitlines() if ln[:5].strip() in ("WARN", "INFO", "ERROR")]


def having(lines: list[str], code: str) -> list[str]:
    return [ln for ln in lines if code in ln]


class DesignMarks(unittest.TestCase):
    def test_marks_typed_in_design_text_without_inline_marks(self):
        out = lint(footer("**Chapter** {chapterNumber} · *notes*"), "# One\n\nText.\n")
        hits = having(out, "designMarksLiteral")
        self.assertEqual(len(hits), 1, out)
        self.assertIn("**bold**", hits[0])
        self.assertIn("*italic*", hits[0])
        self.assertTrue(hits[0].startswith("WARN"))

    def test_inline_marks_on_is_quiet(self):
        out = lint(footer("**Chapter** {chapterNumber}", inlineMarks=True), "# One\n\nText.\n")
        self.assertEqual(having(out, "designMarksLiteral"), [])

    def test_mark_directive_prints_as_written(self):
        out = lint(footer(":mark[Unit] {chapterNumber}"), "# One\n\nText.\n")
        self.assertEqual(len(having(out, "designMarksLiteral")), 1, out)

    def test_directive_with_inline_marks_is_a_note(self):
        out = lint(footer(":smallcaps[unit] {chapterNumber}", inlineMarks=True), "# One\n\nText.\n")
        self.assertEqual(having(out, "designMarksLiteral"), [])
        self.assertEqual(len(having(out, "sets its words plain")), 1, out)

    def test_attr_value_with_marks_needs_inline_marks(self):
        chapter = '# One {kicker="Unit **3**"}\n\nText.\n'
        out = lint(footer("{attr.kicker}"), chapter)
        hits = having(out, "designMarksLiteral")
        self.assertEqual(len(hits), 1, out)
        self.assertIn("{attr.kicker}", hits[0])
        self.assertEqual(having(lint(footer("{attr.kicker}", inlineMarks=True), chapter), "designMarksLiteral"), [])

    def test_plain_attr_value_is_quiet(self):
        out = lint(footer("{attr.kicker}"), '# One {kicker="Unit 3"}\n\nText.\n')
        self.assertEqual(having(out, "designMarksLiteral"), [])

    def test_placeholders_snake_case_and_escapes_are_not_marks(self):
        for content in ("{attr.part_title} {pageNumber}", r"\*\*not bold\*\*", "{page_number} – * – {totalPages}",
                        "5 * 3 = 15"):
            self.assertEqual(lp.design_marks(content), [], content)


class FixedSpacePlusSpace(unittest.TestCase):
    def test_en_space_then_space_in_a_chapter(self):
        out = lint({}, "# One\n\n1.  First point.\n\nPlain text.\n\n37  °C is hot.\n")
        hits = having(out, "fixedSpacePlusSpace")
        self.assertEqual(len(hits), 1, out)
        self.assertIn("2 plain space(s)", hits[0])
        self.assertIn("01.md:3", hits[0])
        self.assertIn("lines 3, 7", hits[0])

    def test_fixed_space_alone_is_quiet(self):
        out = lint({}, "# One\n\n1. First point, 37 °C and 1 000 people.\n")
        self.assertEqual(having(out, "fixedSpacePlusSpace"), [])

    def test_code_listing_is_left_alone(self):
        out = lint({}, "# One\n\n```\na  b\n```\n\nText.\n")
        self.assertEqual(having(out, "fixedSpacePlusSpace"), [])

    def test_room_after_a_swatch_is_left_alone(self):
        out = lint({"colorPalette": [{"id": "sea", "name": "sea", "value": {"hex": "#0af", "model": "hex"}}]},
                   '# One\n\n:swatch{color="sea"}  sea\n')
        self.assertEqual(having(out, "fixedSpacePlusSpace"), [])

    def test_design_text(self):
        out = lint(footer("{chapterNumber}  {chapterTitle}"), "# One\n\nText.\n")
        hits = having(out, "fixedSpacePlusSpace")
        self.assertEqual(len(hits), 1, out)
        self.assertIn("footer.elements[0]", hits[0])


class HeadingChip(unittest.TestCase):
    CHAPTER = '# One\n\n## :chip[3]{style="num"} Forces\n\nText.\n'
    CONFIG = {"chipStyles": [{"id": "num"}]}

    def test_older_pinned_engine_warns(self):
        out = lint(self.CONFIG, self.CHAPTER, "--engine", "1.51.0")
        hits = having(out, "headingChip")
        self.assertEqual(len(hits), 1, out)
        self.assertTrue(hits[0].startswith("WARN"))
        self.assertIn("1.51.0", hits[0])

    def test_package_json_pin(self):
        out = lint(self.CONFIG, self.CHAPTER, package={"dependencies": {"postext": "^1.46.2"}})
        self.assertTrue(having(out, "headingChip")[0].startswith("WARN"), out)

    def test_engine_with_heading_chips_is_quiet(self):
        out = lint(self.CONFIG, self.CHAPTER, "--engine", "1.52.0")
        self.assertEqual(having(out, "headingChip"), [])

    def test_unpinned_is_a_note(self):
        out = lint(self.CONFIG, self.CHAPTER)
        hits = having(out, "headingChip")
        self.assertEqual(len(hits), 1, out)
        self.assertTrue(hits[0].startswith("INFO"))

    def test_unknown_chip_style_in_a_heading(self):
        out = lint({}, self.CHAPTER, "--engine", "1.52.0")
        self.assertEqual(len(having(out, "chip style 'num' is not in chipStyles")), 1, out)

    def test_version_parsing(self):
        self.assertEqual(lp.parse_version("^1.46.2"), (1, 46, 2))
        self.assertEqual(lp.parse_version(">=1.50"), (1, 50, 0))
        self.assertIsNone(lp.parse_version("latest"))


class SmallCapsByHand(unittest.TestCase):
    CONFIG = {"chipStyles": [{"id": "sc", "fontSize": EM(0.7), "backgroundEnabled": False,
                              "borderWidth": PT(0), "paddingX": EM(0)},
                             {"id": "key", "fontSize": EM(0.7)}]}

    def test_capitals_in_a_bare_small_chip(self):
        out = lint(self.CONFIG, '# One\n\nAs C:chip[ERVANTES]{style="sc"} wrote.\n')
        hits = having(out, "smallCapsByHand")
        self.assertEqual(len(hits), 1, out)
        self.assertIn(":smallcaps", hits[0])

    def test_pt_size_against_the_body(self):
        cfg = {"chipStyles": [{"id": "sc", "fontSize": PT(7.5), "backgroundEnabled": False, "borderWidth": PT(0)}]}
        out = lint(cfg, '# One\n\nIn 1492 :chip[AD]{style="sc"}.\n')
        self.assertEqual(len(having(out, "smallCapsByHand")), 1, out)

    def test_boxed_chip_lowercase_and_full_size_are_quiet(self):
        out = lint(self.CONFIG, '# One\n\nPress :chip[CTRL]{style="key"} and :chip[note]{style="sc"}.\n')
        self.assertEqual(having(out, "smallCapsByHand"), [])
        cfg = {"chipStyles": [{"id": "big", "fontSize": EM(1), "backgroundEnabled": False, "borderWidth": PT(0)}]}
        self.assertEqual(having(lint(cfg, '# One\n\n:chip[NASA]{style="big"}\n'), "smallCapsByHand"), [])


if __name__ == "__main__":
    unittest.main()
