"""Tests of `composed_check.py` on the frames of composed pages: frames that
lay out nothing of their own (the Sandbox's «Write here», #1186), a box's
text under a picture hung from the box (#1187), frames set smaller as
written (#1200) and a missing or old command line (#1199).

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests
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
import composed_check as cc  # noqa: E402


def frame(fid: str, *content: str, own: str = "", facing: bool = False) -> str:
    """A frame as `postext html` writes it: its own block (the box and what
    its design prints), then one block per piece of content."""
    blocks = "".join(f'<div class="pt-block" data-block-id="{fid}-c{k}" style="display:contents;">{c}</div>'
                     for k, c in enumerate(content))
    face = ' data-facing="true" aria-hidden="true"' if facing else ""
    return (f'<div class="pt-frame" data-frame-id="{fid}" data-layer="1"{face} style="position:absolute;">'
            f'<div class="pt-block" data-block-id="{fid}" style="display:contents;">{own}</div>{blocks}</div>')


def page(n: int, *frames: str) -> str:
    return (f'<div class="pt-page" id="pt-p-{n}" data-page="{n}" style="position:relative;">'
            f'<div class="pt-composed" style="position:absolute;">{"".join(frames)}</div></div>')


LINE = '<div class="pt-line" style="position:absolute;"><span style="position:absolute;">Words</span></div>'
BOX = '<div aria-hidden="true" style="position:absolute;background:#619f45;"></div>'
TAB = '<div style="position:absolute;"><span style="position:absolute;">MAPS</span></div>'
RING = '<img src="ring.svg" alt="" style="position:absolute;">'
SVG = '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/><circle cx="5" cy="5" r="2"></circle></svg>'

TEMPLATES = [
    {"id": "page", "frames": [{"name": "text", "flow": True}],
     "groups": [{"name": "stack", "modules": True, "templates": ["card", "photos"]}]},
    {"id": "card", "role": "module", "frames": [
        {"name": "title", "takes": "h2"},
        {"name": "box", "style": "box-tab"},
        {"name": "words", "style": "plain", "placement": {"anchor": {"to": "#box", "edge": "top-left"}}},
        {"name": "picture", "placement": {"anchor": {"to": "#box", "edge": "bottom-left"}}},
        {"name": "helper"},
        {"name": "spare", "optional": True},
        {"name": "col-1", "next": "col-2"},
        {"name": "col-2"},
        {"name": "answer", "rules": {"pitch": {"value": 8, "unit": "mm"}}},
    ]},
    {"id": "photos", "role": "module", "frames": [{"name": "photo"}, {"name": "pill", "style": "pill"}],
     "groups": [{"name": "grid", "kind": "grid", "repeat": {"frames": ["photo", "pill"]}}]},
    {"id": "sided", "frames": [{"name": "text", "flow": True}, {"name": "folio-box", "style": "b"}],
     "variants": {"verso": {"frames": [{"name": "folio-box", "remove": True}]}}},
]

MARKDOWN = """::::page{template="page"}

:::module{template="card"}
## Maps

:::frame{slot="box"}
:::

:::frame{slot="words"}
Words of the box.
:::

::resource{id="map" slot="picture"}

:::frame{slot="col-1"}
A short story.
:::
:::

::::
"""


class HtmlEmpty(unittest.TestCase):
    def test_a_frame_with_only_its_own_box_lays_out_nothing(self):
        html = page(0,
                    frame("cp0:title", LINE),
                    frame("cp0:box", own=BOX + TAB + RING),     # a box with an empty fence: tab, ring, fill
                    frame("cp0:words", LINE, own=BOX),
                    frame("cp0:picture", RING),
                    frame("cp0:map", SVG),
                    frame("cp0:design", own=BOX + SVG + TAB),   # words a design prints (setsContent)
                    frame("cp0:facing", facing=True))
        pages = cc.html_frame_order(html)
        self.assertEqual(pages[0]["empty"], ["cp0:box", "cp0:design"])
        self.assertEqual([f["id"] for f in pages[0]["frames"]],
                         ["cp0:title", "cp0:box", "cp0:words", "cp0:picture", "cp0:map", "cp0:design", "cp0:facing"])

    def test_a_table_or_words_in_a_content_block_count(self):
        html = page(0, frame("cp0:t", "<table><tr><td>1</td></tr></table>"), frame("cp0:w", "bare words"),
                    frame("cp0:blank", "  "))
        self.assertEqual(cc.html_frame_order(html)[0]["empty"], ["cp0:blank"])


def edition(markdown: str = MARKDOWN, templates: list = TEMPLATES) -> list[dict]:
    out = []
    for n, f in enumerate(cc.page_fences(markdown)):
        out.append({"chapter": "01.md", "chapterIndex": 0, "fence": n, "line": f["line"], "template": f["template"],
                    "spread": False, "order": cc.expected_order(f, templates),
                    "frames": cc.fence_frames(f, templates), "pictures": cc.picture_frames(f),
                    "slotLines": cc.slot_lines(f)})
    return out


class EmptyFrames(unittest.TestCase):
    def test_fence_frames_scope_modules_and_leave_grid_members_out(self):
        fences = edition(MARKDOWN.replace(':::\n\n::::\n', ':::\n\n:::module{template="photos"}\n'
                                          '::resource{id="a" slot="photo"}\n:::\n\n::::\n'))
        names = set(fences[0]["frames"])
        self.assertIn("card[1].box", names)
        self.assertIn("text", names)
        self.assertNotIn("photos[1].photo", names)
        self.assertEqual(fences[0]["pictures"], {"card[1].picture", "photos[1].photo"})
        self.assertEqual(fences[0]["slotLines"]["card[1].box"], 6)

    def test_variant_removed_frame_is_not_expected(self):
        fences = edition('::::page{template="sided"}\nText.\n::::\n')
        self.assertEqual(set(fences[0]["frames"]), {"text"})

    def test_empty_box_and_frames_the_html_never_writes(self):
        fences = edition()
        html = page(0,
                    frame("cp0:card[1].title", LINE),
                    frame("cp0:card[1].box", own=BOX + TAB),
                    frame("cp0:card[1].words", LINE),
                    frame("cp0:card[1].picture", RING),
                    frame("cp0:card[1].col-1", LINE))
        got = {e["frame"]: e for e in cc.empty_frames(cc.html_frame_order(html), fences)}
        # the box drawn empty; the page's flow frame, a placement helper and an optional frame that receive
        # nothing; the frame a chain goes on in (a warning); the answer space (rules) is meant empty
        self.assertEqual({k: v["how"] for k, v in got.items()},
                         {"card[1].box": "box", "text": "nothing", "card[1].helper": "nothing",
                          "card[1].spare": "nothing", "card[1].col-2": "chain"})
        box = got["card[1].box"]
        self.assertEqual((box["page"], box["line"], box["template"]), (1, 6, "page"))
        self.assertIn(":::columns", box["hint"])
        self.assertIn("setsContent", box["hint"])
        self.assertEqual(got["card[1].helper"]["line"], 3)  # the module's fence

    def test_pages_added_by_continuation_are_not_checked(self):
        fences = edition('::::page{template="sided"}\nText.\n::::\n')
        html = page(0, frame("cp0:text", LINE), frame("cp0:folio-box", LINE)) + page(1, frame("cp0:text~1"))
        self.assertEqual(cc.empty_frames(cc.html_frame_order(html), fences), [])

    def test_a_frame_written_on_a_later_page_of_its_fence_is_there(self):
        fences = edition('::::page{template="sided"}\nText.\n::::\n')
        html = page(0, frame("cp0:text", LINE)) + page(1, frame("cp0:text~1", LINE), frame("cp0:folio-box~1", LINE))
        self.assertEqual(cc.empty_frames(cc.html_frame_order(html), fences), [])


COVERED = {"kind": "frameCovered", "severity": "warning", "page": "1", "at": "01.md:12",
           "message": 'Frame "card[1].box" of template "page" (en) lies under frame "card[1].picture"',
           "data": {"template": "page", "frame": "card[1].box", "coveredBy": "card[1].picture", "fenceIndex": 0,
                    "text": "Words of the box", "proposals": []}}


class HungPicture(unittest.TestCase):
    def test_anchor_chain(self):
        frames = edition()[0]["frames"]
        self.assertEqual(cc.anchor_chain(frames, "card[1].picture"), ["card[1].box"])
        self.assertEqual(cc.anchor_chain(frames, "card[1].box"), [])

    def test_box_text_under_its_hung_picture(self):
        fences = edition()
        v = cc.judge({"warnings": [COVERED]}, frames_of=cc.fence_lookup(fences))
        self.assertEqual(v["fail"][0]["hungFrom"], "card[1].box")
        self.assertIn("put the picture in the box's fence", v["fail"][0]["hint"])
        self.assertIn("capped frame", v["fail"][0]["hint"])
        # a text frame hung from the same box, under the picture; and the stressed run
        words = {**COVERED, "data": {**COVERED["data"], "frame": "card[1].words"}}
        v = cc.judge({"warnings": [words]}, stressed=True, base={"warnings": []}, frames_of=cc.fence_lookup(fences))
        self.assertEqual(v["fail"][0]["hungFrom"], "card[1].box")

    def test_other_overlaps_keep_the_engine_fixes(self):
        fences = edition()
        other = {**COVERED, "data": {**COVERED["data"], "frame": "card[1].title", "coveredBy": "card[1].words"}}
        v = cc.judge({"warnings": [other, COVERED]})  # no frames_of: the plain hint
        self.assertNotIn("hungFrom", v["fail"][0])
        self.assertIn("overlap: 'allow'", v["fail"][1]["hint"])
        v = cc.judge({"warnings": [other]}, frames_of=cc.fence_lookup(fences))
        self.assertNotIn("hungFrom", v["fail"][0])

    def test_lookup_by_chapter(self):
        fences = edition()
        fences[0]["chapter"] = "chapters/en/01.md"
        self.assertIsNotNone(cc.fence_lookup(fences)({**COVERED, "at": "chapters/en/01.md:12"}))
        self.assertIsNone(cc.fence_lookup(fences)({**COVERED, "at": "chapters/en/02.md:12"}))


class Scaled(unittest.TestCase):
    REPORT = {"warnings": [], "reflow": [
        {"pageLabel": "4", "template": "page-2", "chapter": "01.md", "lines": ["…"], "events": [
            {"frame": "card[1].words", "kind": "textScaled", "scale": 0.975},
            {"frame": "card[1].words", "kind": "imageScaled", "scale": 0.9},
            {"frame": "card[1].box", "kind": "grew", "fromMm": 10, "toMm": 12},
            {"frame": "pill[1]", "kind": "textScaled", "scale": 1}]}]}

    def test_scaled_as_written_is_a_warning(self):
        v = cc.judge(self.REPORT)
        self.assertEqual(v["fail"], [])
        w = [x for x in v["warn"] if x["kind"] == "frameScaled"]
        self.assertEqual(len(w), 1)
        self.assertEqual((w[0]["frame"], w[0]["page"], w[0]["text"], w[0]["pictures"]), ("card[1].words", "4", 0.975, 0.9))
        self.assertIn("text at 97.5 %; pictures at 90 %", w[0]["message"])
        self.assertIn("widen the frame or its padding", w[0]["hint"])

    def test_the_stressed_run_shrinks_without_a_warning(self):
        v = cc.judge(self.REPORT, stressed=True, base={"warnings": []})
        self.assertEqual([x for x in v["warn"] if x["kind"] == "frameScaled"], [])


class CommandLine(unittest.TestCase):
    def test_problem_names_the_fix(self):
        self.assertIn("npm i -g postext-cli@latest", cc.cli_problem(["postext"], None))
        self.assertIn("nvm", cc.cli_problem(["postext"], None))
        old = cc.cli_problem(["postext"], (1, 50, 0))
        self.assertIn("older than the 1.53.0", old)
        self.assertIn("npm i -g postext-cli@latest", old)
        self.assertIsNone(cc.cli_problem(["postext"], cc.CLI_NEEDS))

    def test_check_without_the_command_line_stops_with_the_fix(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "chapters").mkdir()
            (root / "chapters" / "01.md").write_text("# One\n", encoding="utf-8")
            (root / "preset.json").write_text(json.dumps({
                "version": 2, "configVersion": 19, "id": "t", "name": "T", "locale": "en", "config": {},
                "chapters": {"en": [{"title": "One", "file": "chapters/01.md"}]}}), encoding="utf-8")
            r = subprocess.run([sys.executable, str(SCRIPTS / "composed_check.py"), "check", str(root),
                                "--postext", str(root / "no-such-postext")], capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
            self.assertIn("npm i -g postext-cli@latest", r.stderr)


if __name__ == "__main__":
    unittest.main()
