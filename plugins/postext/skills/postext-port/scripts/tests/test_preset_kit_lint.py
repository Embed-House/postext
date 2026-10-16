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
        # Only a placeholder name is taken out; other brace pairs stay as typed.
        self.assertEqual(kit.design_literal("{not a placeholder} {attr.x-y}"), "{not a placeholder}")
        self.assertEqual(kit.design_literal("open { brace"), "open { brace")

    def test_words_and_characters(self):
        self.assertEqual(kit.literal_is_content("Chapter"), "")
        self.assertEqual(kit.literal_is_content("Notes on"), "")
        self.assertEqual(kit.literal_is_content("FINDING YOUR POSITION"), "finding your position")
        long_word = "Pneumonoultramicroscopic"  # 24 letters: allowed; 25 are not
        self.assertEqual(kit.literal_is_content(long_word), "")
        self.assertEqual(kit.literal_is_content(long_word + "s"), (long_word + "s").lower())
        # Letters and digits count, not punctuation: 24 letters with hyphens pass.
        self.assertEqual(kit.literal_is_content("Pneumono-ultra-microscopic"), "")
        # A lone separator is no word; punctuation alone is never content.
        self.assertEqual(kit.literal_is_content("Postext · postext.dev"), "")
        self.assertEqual(kit.literal_is_content("." * 160), "")
        self.assertEqual(kit.literal_is_content("❧ ❧ ❧ ❧"), "")

    def test_allow(self):
        self.assertEqual(kit.literal_is_content("Social Sciences 3 · Core", ["Social Sciences 3"]), "")
        self.assertEqual(kit.literal_is_content("THE DREAM OF THE RED CHAMBER", ["The Dream of the Red Chamber"]), "")
        # Whole words only: an allowed name inside a web address stays.
        self.assertNotEqual(kit.literal_is_content("postext.dev · github.com/drnachio/postext", ["Postext"]), "")


class Engine(unittest.TestCase):
    """The rule of the engine's contentInConfig warning (configWarnings.ts)."""

    def test_unspaced_scripts_weigh_three(self):
        # Eight Han characters pass (weight 24), nine do not; no words are counted.
        self.assertIsNone(kit.literal_content("第一章夏目漱石の本"[:8]))
        r = kit.literal_content("これは長い日本語の文")
        self.assertEqual((r["chars"], r["weight"], r["words"]), (10, 30, 0))
        self.assertIsNone(kit.literal_content("第一章 夏目漱石"))
        # Mixed: Latin words count as words, the Han run only weighs.
        r = kit.literal_content("Unit 3 第三单元")
        self.assertIsNone(r)

    def test_chars_after_allowed_phrases(self):
        cfg = {"checks": {"contentInConfig": {"allow": ["Kirkwick Harbour Trust"]}},
               "footer": {"elements": [text("f", "Kirkwick Harbour Trust · Annual report of the year {pageNumber}")]}}
        (w,), _ = kit.content_in_config(cfg)
        # "annual report of the year": 21 letters, the allowed name left out.
        self.assertEqual((w["path"], w["count"], w["chars"]), ("footer", 1, 21))
        self.assertEqual(w["elements"], ["footer.elements[0]"])

    def test_allowed_phrase_inside_unspaced_text(self):
        cfg = {"header": {"elements": [text("h", "红楼梦第一回甄士隐梦幻识通灵")]}}
        self.assertEqual(len(kit.content_in_config(cfg)[0]), 1)
        self.assertEqual(kit.content_in_config(cfg, ["红楼梦", "甄士隐梦幻识通灵"])[0], [])

    def test_limits_and_enabled(self):
        el = {"header": {"elements": [text("h", "Three short words")]}}
        self.assertEqual(len(kit.content_in_config(el)[0]), 1)
        self.assertEqual(kit.content_in_config({**el, "checks": {"contentInConfig": {"maxWords": 3}}})[0], [])
        self.assertEqual(kit.content_in_config({**el, "checks": {"contentInConfig": {"enabled": False}}})[0], [])
        # A bad limit falls back to the default, as in the engine.
        self.assertEqual(len(kit.content_in_config({**el, "checks": {"contentInConfig": {"maxWords": -1}}})[0]), 1)

    def test_only_the_engine_slots_count(self):
        cfg = {"pageTemplates": [{"id": "t", "decoration": {"elements": [text("d", "A sentence typed into a template")]}}]}
        res = kit.lint_manifest(cfg)
        self.assertEqual(res["findings"], [])
        self.assertEqual([o["path"] for o in res["other"]], ["config.pageTemplates[0].decoration.elements[0]"])


class Walk(unittest.TestCase):
    def test_clean_config(self):
        res = kit.lint_manifest(CLEAN)
        self.assertEqual(res["findings"], [])
        self.assertEqual(res["textElements"], 5)

    def test_owner_slot_path(self):
        res = kit.lint_manifest(manifest(DIRTY))
        got = [(f["owner"], f["ownerId"], f["slot"], f["path"], f["chars"]) for f in res["findings"]]
        self.assertEqual(got, [
            ("config.headingStyles[0]", "page-05", "header", "config.headingStyles[0].header.elements[1]", 19),
            ("config.headingStyles[0]", "page-05", "header", "config.headingStyles[0].header.elements[2]", 21),
        ])
        (w,) = res["editions"][0]["warnings"]
        self.assertEqual(w, {"path": "headingStyles[0]", "ownerId": "page-05", "count": 2, "chars": 40,
                             "elements": ["headingStyles[0].header.elements[1]", "headingStyles[0].header.elements[2]"],
                             "value": "FINDING YOUR POSITION"})

    def test_heading_level_owner(self):
        cfg = {"headings": {"levels": [{"level": 1, "advancedDesign": {"slot": {"elements": [text("a", "A whole standfirst typed in the config")]}}}]}}
        (f,) = kit.lint_manifest(cfg)["findings"]
        self.assertEqual((f["owner"], f["slot"]), ("config.headings.levels[0]", "advancedDesign.slot"))

    def test_localized_configs_and_config_allow(self):
        cfg = {"checks": {"contentInConfig": {"allow": ["Kirkwick Harbour Trust"]}},
               "footer": {"elements": [text("f", "Kirkwick Harbour Trust · {pageNumber}")]}}
        loc = {"es": {"config": {"header": {"elements": [text("h", "Typed running head words")]}}}}
        res = kit.lint_manifest(manifest(cfg, localized=loc))
        self.assertEqual([e["locale"] for e in res["editions"]], ["en", "es"])
        self.assertEqual([(f["path"], f["editions"]) for f in res["findings"]],
                         [("localized.es.config.header.elements[0]", ["es"])])
        self.assertEqual(kit.lint_manifest(manifest(cfg, localized=loc), ["Typed running head words"])["findings"], [])

    def test_shared_text_reported_once(self):
        cfg = {"header": {"elements": [text("h", "Typed running head words")]}}
        res = kit.lint_manifest(manifest(cfg, localized={"es": {"config": {"locale": "es"}}}))
        self.assertEqual([(f["path"], f["editions"]) for f in res["findings"]], [("config.header.elements[0]", ["en", "es"])])
        self.assertEqual(res["offendingChars"], 21)

    def test_book_metadata_allowed(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "chapters/en").mkdir(parents=True)
            (root / "chapters/en/01.md").write_text('---\ntitle: "The Solan Isles"\nauthor:\n  - Ann Reid\npublisher: Kirkwick Press\n---\n\n# One\n')
            cfg = {"header": {"elements": [text("h", "THE SOLAN ISLES · Ann Reid · Kirkwick Press")]}}
            (root / "preset.json").write_text(json.dumps(manifest(cfg)))
            data, _, read = kit.read_target(str(root))
            self.assertEqual(kit.lint_manifest(data, read=read)["findings"], [])
            self.assertEqual(len(kit.lint_manifest(data, read=read, metadata=False)["findings"]), 1)

    def test_manifest_name_is_not_allowed(self):
        # The engine reads the front matter, not the manifest name.
        cfg = {"header": {"elements": [text("h", "Ciencias Sociales 3 · Saberes básicos")]}}
        m = manifest(cfg)
        m["name"] = "Ciencias Sociales 3 · Saberes básicos"
        self.assertEqual(len(kit.lint_manifest(m)["findings"]), 1)


class Pack(unittest.TestCase):
    def test_manifest_only_and_exclude(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for rel in ("chapters/en/01.md", "resources/map.svg", "fonts/A.woff2", "work/notes.txt",
                        "labels/strings.en.json", "thumbnail.jpg"):
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text("x")
            m = manifest({}, resources=[{"id": "map", "file": "resources/map.svg"}], thumbnail="thumbnail.jpg",
                         fonts=[{"name": "A", "variants": [{"weight": 400, "style": "normal", "file": "fonts/A.woff2"}]}])
            (root / "preset.json").write_text(json.dumps(m))
            self.assertEqual(kit.pack_files(root, m, manifest_only=True),
                             ["chapters/en/01.md", "fonts/A.woff2", "preset.json", "resources/map.svg", "thumbnail.jpg"])
            everything = kit.pack_files(root, m)
            self.assertIn("work/notes.txt", everything)
            self.assertNotIn("work/notes.txt", kit.pack_files(root, m, exclude=["work", "labels/*"]))
            self.assertNotIn("labels/strings.en.json", kit.pack_files(root, m, exclude=["work", "labels/*"]))


class Command(unittest.TestCase):
    def test_exit_codes_and_report(self):
        with tempfile.TemporaryDirectory() as d:
            dirty = Path(d) / "dirty.json"
            dirty.write_text(json.dumps(manifest(DIRTY)))
            clean = Path(d) / "clean.json"
            clean.write_text(json.dumps(CLEAN))
            r = run(str(dirty))
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("ERROR contentInConfig config.headingStyles[0] (page-05): 2 design text(s), 40 letters and digits [header]", r.stdout)
            self.assertIn("config.headingStyles[0].header.elements[1]", r.stdout)
            self.assertEqual(run(str(dirty), "--max-chars", "40").returncode, 0)
            self.assertEqual(run(str(clean)).returncode, 0)
            self.assertEqual(run(str(clean), "--max-size", "0.000001").returncode, 1)
            out = json.loads(run(str(dirty), "--json").stdout)
            self.assertEqual(out["offendingChars"], 40)
            self.assertEqual(out["editions"][0]["warnings"][0]["chars"], 40)
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
