"""Tests of the `:::columns` check of `lint_project.py` (#1188): a group is
set in a box, in a composed page's frame, module or slotted piece, and in
the running text from postext 1.25 (`layout.flowColumns`, configVersion
11); only a config read with the flow groups off is warned.

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
import lint_project as lp  # noqa: E402

TEMPLATES = [
    {"id": "page", "frames": [{"name": "text", "flow": True}, {"name": "box", "style": "caja"}],
     "groups": [{"name": "stack", "modules": True, "templates": ["card"]}]},
    {"id": "card", "role": "module", "frames": [{"name": "photos", "style": "caja"}, {"name": "body", "flow": True}]},
]

COLUMNS = ':::columns{count=3 breaks="2,3"}\n::resource{id="a"}\n\nOne\n\nTwo\n:::\n'


def columns_warnings(markdown: str, flow_columns: bool = True, engine: tuple | None = None) -> list[str]:
    rep = lp.Report()
    ids = {"callout": {"caja"}, "paragraphs": set(), "palette": set()}
    ctx = lp.new_comic_ctx({"pageTemplates": TEMPLATES}, [{"id": "a", "kind": "image"}], ids)
    ctx["flow_columns"] = flow_columns
    lp.check_markdown("01.md", markdown, 0, ids, {"a"}, rep, set(), set(), comic_ctx=ctx, engine=engine)
    return [msg for _, _, msg in rep.items if ":::columns" in msg]


class ColumnsLint(unittest.TestCase):
    def test_in_a_composed_frame_module_or_slot(self):
        frame = '::::page{template="page"}\n:::frame{slot="box"}\nIntro.\n\n' + COLUMNS + ':::\n::::\n'
        module = ('::::page{template="page"}\n:::module{template="card"}\n:::frame{slot="photos"}\n' + COLUMNS
                  + ':::\n\n' + COLUMNS + ':::\n::::\n')
        slotted = '::::page{template="page"}\n' + COLUMNS.replace("count=3", 'count=3 slot="box"') + '::::\n'
        for md in (frame, module, slotted):
            self.assertEqual(columns_warnings(md, flow_columns=False), [], md)

    def test_in_a_box_and_in_the_running_text(self):
        self.assertEqual(columns_warnings(':::callout{type="caja"}\n' + COLUMNS + ':::\n', flow_columns=False), [])
        self.assertEqual(columns_warnings("Text.\n\n" + COLUMNS), [])

    def test_running_text_with_flow_groups_off(self):
        self.assertEqual(len(columns_warnings("Text.\n\n" + COLUMNS, flow_columns=False)), 1)
        self.assertEqual(len(columns_warnings("Text.\n\n" + COLUMNS, engine=(1, 24, 0))), 1)

    def test_flow_columns_on(self):
        self.assertTrue(lp.flow_columns_on({}, 19))
        self.assertFalse(lp.flow_columns_on({}, 10))
        self.assertFalse(lp.flow_columns_on({}, None))
        self.assertTrue(lp.flow_columns_on({"layout": {"flowColumns": True}}, None))
        self.assertFalse(lp.flow_columns_on({"layout": {"flowColumns": False}}, 19))

    def test_whole_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "chapters").mkdir()
            (root / "chapters" / "01.md").write_text(
                '::::page{template="page"}\n:::frame{slot="box"}\n' + COLUMNS.replace('::resource{id="a"}\n\n', "")
                + ':::\n::::\n\nText.\n\n' + COLUMNS.replace('::resource{id="a"}\n\n', ""), encoding="utf-8")
            for cv, hits in ((19, 0), (9, 1)):
                (root / "preset.json").write_text(json.dumps({
                    "version": 2, "configVersion": cv, "id": "t", "name": "T", "locale": "en",
                    "config": {"pageTemplates": TEMPLATES, "calloutStyles": [{"id": "caja"}]},
                    "chapters": {"en": [{"title": "One", "file": "chapters/01.md"}]}}), encoding="utf-8")
                r = subprocess.run([sys.executable, str(SCRIPTS / "lint_project.py"), str(root)],
                                   capture_output=True, text=True, timeout=120)
                self.assertEqual(r.stdout.count(":::columns"), hits, r.stdout)


if __name__ == "__main__":
    unittest.main()
