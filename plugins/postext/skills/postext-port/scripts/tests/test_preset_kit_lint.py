"""Tests of `preset_kit.py lint` (content text in the configuration).

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))
import preset_kit as kit  # noqa: E402


def text(id_: str, content: str) -> dict:
    return {"kind": "text", "id": id_, "content": content,
            "placement": {"anchor": {"to": "page", "edge": "top-left"}}, "fontSize": {"value": 9, "unit": "pt"}}


CLEAN = {
    "header": {"elements": [text("rh", "{chapterTitle}"), text("folio", "{pageNumber}"),
                            {"kind": "rule", "id": "r", "placement": {}}]},
    "headings": {"levels": [{"level": 1, "advancedDesign": {"enabled": True, "slot": {"elements": [
        text("num", "Chapter {chapterNumber}"), text("title", "{titleText}"), text("by", "{attr.author}")]}}}]},
    "headingStyles": [{"id": "plate", "header": {"elements": [
        {"kind": "image", "id": "bg", "resourceId": "{attr.fondo}", "placement": {}}]}}],
}

DIRTY = {
    "headingStyles": [
        {"id": "page-05", "hidden": True, "header": {"elements": [
            {"kind": "image", "id": "bg", "resourceId": "full-p05", "placement": {}},
            text("t0", "FINDING YOUR POSITION"),
            text("t1", "The **compass** points north. {attr.x}"),
            text("t2", "N"),
        ]}},
    ],
    "toc": {"parts": {"design": {"elements": [text("lead", "." * 80), text("n", "{titleText}")]}}},
}


def manifest(config: dict, **more) -> dict:
    return {"version": 2, "configVersion": 14, "id": "t", "name": "T", "locale": "en",
            "chapters": [{"title": "One", "file": "chapters/en/01.md"}], "config": config,
            "resources": [], "fonts": [], **more}


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPTS / "preset_kit.py"), "lint", *args],
                          capture_output=True, text=True)


class Literal(unittest.TestCase):
    def test_placeholders_removed(self):
        self.assertEqual(kit.design_literal("Chapter {chapterNumber}"), "Chapter")
        self.assertEqual(kit.design_literal("{titleText}"), "")
        self.assertEqual(kit.design_literal("{{braces}} kept"), "{braces} kept")
        self.assertEqual(kit.design_literal("two\\nlines  and\tspaces"), "two lines and spaces")

    def test_words_and_characters(self):
        self.assertEqual(kit.literal_is_content("Chapter"), "")
        self.assertEqual(kit.literal_is_content("Notes on"), "")
        self.assertEqual(kit.literal_is_content("FINDING YOUR POSITION"), "FINDING YOUR POSITION")
        long_word = "Pneumonoultramicroscopic"  # 24 characters: allowed; 25 are not
        self.assertEqual(kit.literal_is_content(long_word), "")
        self.assertEqual(kit.literal_is_content(long_word + "s"), long_word + "s")
        # A lone separator is no word; punctuation alone is never content.
        self.assertEqual(kit.literal_is_content("Postext · postext.dev"), "")
        self.assertEqual(kit.literal_is_content("." * 160), "")
        self.assertEqual(kit.literal_is_content("❧ ❧ ❧ ❧"), "")

    def test_allow(self):
        self.assertEqual(kit.literal_is_content("Social Sciences 3 · Core", ["Social Sciences 3"]), "")
        self.assertEqual(kit.literal_is_content("THE DREAM OF THE RED CHAMBER", ["The Dream of the Red Chamber"]), "")
        # Whole words only: an allowed name inside a web address stays.
        self.assertNotEqual(kit.literal_is_content("postext.dev · github.com/drnachio/postext", ["Postext"]), "")


class Walk(unittest.TestCase):
    def test_clean_config(self):
        res = kit.lint_manifest(CLEAN)
        self.assertEqual(res["findings"], [])
        self.assertEqual(res["textElements"], 5)

    def test_owner_slot_path(self):
        res = kit.lint_manifest(manifest(DIRTY))
        got = [(f["owner"], f["slot"], f["path"], f["chars"]) for f in res["findings"]]
        self.assertEqual(got, [
            ("config.headingStyles[page-05]", "header", "config.headingStyles[0].header.elements[1]", 21),
            ("config.headingStyles[page-05]", "header", "config.headingStyles[0].header.elements[2]", 29),
        ])

    def test_heading_level_owner(self):
        cfg = {"headings": {"levels": [{"level": 1, "advancedDesign": {"slot": {"elements": [text("a", "A whole standfirst typed in the config")]}}}]}}
        (f,) = kit.lint_manifest(cfg)["findings"]
        self.assertEqual((f["owner"], f["slot"]), ("config.headings.levels[h1].advancedDesign", "slot"))

    def test_localized_configs_and_config_allow(self):
        cfg = {"checks": {"contentInConfig": {"allow": ["Kirkwick Harbour Trust"]}},
               "footer": {"elements": [text("f", "Kirkwick Harbour Trust · {pageNumber}")]}}
        loc = {"en": {"config": {"header": {"elements": [text("h", "Typed running head words")]}}}}
        res = kit.lint_manifest(manifest(cfg, localized=loc))
        self.assertEqual([f["path"] for f in res["findings"]], ["localized.en.config.header.elements[0]"])
        self.assertEqual(kit.lint_manifest(manifest(cfg, localized=loc), ["Typed running head words"])["findings"], [])

    def test_book_metadata_allowed(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "chapters/en").mkdir(parents=True)
            (root / "chapters/en/01.md").write_text('---\ntitle: "The Solan Isles"\nauthor: Ann Reid\n---\n\n# One\n')
            cfg = {"header": {"elements": [text("h", "THE SOLAN ISLES · Ann Reid")]}}
            (root / "preset.json").write_text(json.dumps(manifest(cfg)))
            data, _, read = kit.read_target(str(root))
            self.assertEqual(kit.lint_manifest(data, read=read)["findings"], [])
            self.assertEqual(len(kit.lint_manifest(data, read=read, metadata=False)["findings"]), 1)


class Command(unittest.TestCase):
    def test_exit_codes_and_report(self):
        with tempfile.TemporaryDirectory() as d:
            dirty = Path(d) / "dirty.json"
            dirty.write_text(json.dumps(manifest(DIRTY)))
            clean = Path(d) / "clean.json"
            clean.write_text(json.dumps(CLEAN))
            r = run(str(dirty))
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("ERROR contentInConfig config.headingStyles[page-05] (header): 2 element(s), 50 characters", r.stdout)
            self.assertIn("config.headingStyles[0].header.elements[1]", r.stdout)
            self.assertEqual(run(str(dirty), "--max-chars", "50").returncode, 0)
            self.assertEqual(run(str(clean)).returncode, 0)
            self.assertEqual(run(str(clean), "--max-size", "0.000001").returncode, 1)
            out = json.loads(run(str(dirty), "--json").stdout)
            self.assertEqual(out["offendingChars"], 50)
            self.assertTrue(out["failed"])

    def test_bundle(self):
        with tempfile.TemporaryDirectory() as d:
            bundle = Path(d) / "book.postext"
            with zipfile.ZipFile(bundle, "w") as z:
                z.writestr("preset.json", json.dumps(manifest(DIRTY)))
                z.writestr("chapters/en/01.md", "# One\n")
            r = run(str(bundle), "--quiet")
            self.assertEqual(r.returncode, 1)
            self.assertIn("book.postext!preset.json", r.stdout)

    @unittest.skipUnless((Path.home() / "dev/tmp/detectives-3pri/preset.json").exists(), "the 1.33 textbook port is not on this machine")
    def test_textbook_port_fails(self):
        r = run(str(Path.home() / "dev/tmp/detectives-3pri/preset.json"), "--quiet")
        self.assertEqual(r.returncode, 1)


if __name__ == "__main__":
    unittest.main()
