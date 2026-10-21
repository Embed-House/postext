"""Tests of `composed_check.py` (round choice, reading order, stress) and of
the composed-page checks of `lint_project.py`.

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests

With POSTEXT_CLI set to a postext command of 1.35.0 or later (`postext`,
`bun …/packages/postext-cli/src/main.ts`), one test runs the whole check on
a small two-edition book.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))
import composed_check as cc  # noqa: E402

TEMPLATES = [
    {"id": "tema", "frames": [
        {"name": "titulo", "takes": "h1"},
        {"name": "texto", "flow": True},
        {"name": "dinero", "style": "caja"},
        {"name": "dinero-fotos"},
        {"name": "col-1", "next": "col-2"},
        {"name": "col-2", "overflow": {"continueIn": "#col-3"}},
        {"name": "col-3"},
    ]},
    {"id": "tema-sin-fotos", "extends": "tema", "frames": [{"name": "dinero-fotos", "remove": True},
                                                          {"name": "nota", "optional": True}]},
    {"id": "linea", "spread": True, "frames": [{"name": "texto", "flow": True}, {"name": "tira", "crossGutter": True}]},
    {"id": "linea-2", "extends": "linea"},
]

PAGE = """# Before

::::page{template="tema" fondo="banda"}
# La actividad económica

Las personas utilizan :chip[recursos]{style="clave"}.

- Una lista.

:::frame{slot="dinero" label="El dinero"}
Es el instrumento…

:::callout{type="nota"}
Dentro.
:::
:::

::resource{id="dinero-pago" slot="dinero-fotos"}

## Más {slot="col-1"}

```js {slot="nada"}
:::frame{slot="dinero"}
```
::::

::::page{template="linea" spread}
:::figure{resource="tira" slot="tira"}
::label[1900]{at="a"}
:::

Texto.
::::
"""


class Round(unittest.TestCase):
    def test_parse_version(self):
        self.assertEqual(cc.parse_version("postext 1.36.0 (engine 1.36.0, darwin-arm64)"), (1, 36, 0))
        self.assertEqual(cc.parse_version("postext 2.0.0 (engine 1.37.1, linux-x64)"), (1, 37, 1))
        self.assertEqual(cc.parse_version("1.34.1"), (1, 34, 1))
        self.assertEqual(cc.parse_version("v1.35.0-beta.2"), (1, 35, 0))
        self.assertIsNone(cc.parse_version("command not found"))

    def test_rounds(self):
        self.assertEqual(cc.plan_for((1, 33, 11))["round"], 1)
        self.assertEqual(cc.plan_for((1, 34, 1))["round"], 1)
        p = cc.plan_for((1, 35, 0))
        self.assertEqual(p["round"], 2)
        self.assertEqual(p["reference"], "references/composed-pages.md")
        lacks = {f["feature"] for f in p["lacks"]}
        self.assertTrue({"ladder", "contour", "sourceMap", "continuation", "labels"} <= lacks)
        self.assertNotIn("groups", lacks)
        p = cc.plan_for((1, 36, 0))
        lacks = {f["feature"] for f in p["lacks"]}
        self.assertTrue({"continuation", "labels", "migration", "headingDesigns", "jumps"} <= lacks)
        V142 = {"boxTracking", "decorationRemove", "slotRename", "frameLook", "autoWidth", "labelIconInside",
                "headingNumber", "tocFrame", "labelSymbols", "figureWordsShared", "labelsEpubRtl", "fontFallback",
                "editionExport", "uprightVertical", "carriedOutline", "labelEditorSandbox"}
        V143 = {"labelsOffFold", "standInExports", "labelIconTint", "tocPartBreak", "headingClaimsColumn",
                "sandboxEditions", "svgSymbols"}
        V142 |= V143
        V148 = {"columnHeadings", "overlapChecks", "connectors", "leaders", "legends", "shapes", "glyphTabIcon",
                "sidePoints", "grids", "modules", "moduleConnectorToPage", "ringBarCaps"}
        p = cc.plan_for((1, 37, 0))
        v138 = {"continueFirst", "jumps", "answerSpaces", "designSizes", "textPanels",
                "partialTypes", "labelsOnPictures", "sandboxFixes"}
        self.assertTrue(v138 <= {f["feature"] for f in p["lacks"]})
        LATER = ("1.46.0", "1.48.0", "1.48.1", "1.49.0")
        self.assertTrue(all(f["since"] in ("1.38.0", "1.39.0", "1.40.0", "1.41.0", "1.42.0", "1.43.0") + LATER
                            for f in p["lacks"]))
        p = cc.plan_for((1, 38, 0))
        self.assertEqual({f["feature"] for f in p["lacks"]},
                         {"labelChecks", "figureWords", "styleExtends", "frameModes", "startEnd", "cuts",
                          "textPanelsMirrored", "coverUpright", "sourceAtFlow", "editionsKept", "wordTracking"}
                         | {"labelStyleOff", "epubLabels", "textPanelsStrips", "framesRtl", "migrationLayer",
                            "editionChecks", "wordTrackingSandbox", "jumpsAcrossChapters"}
                            | V142 | V148)
        self.assertTrue(all(f["since"] in ("1.39.0", "1.40.0", "1.41.0", "1.42.0", "1.43.0") + LATER
                            for f in p["lacks"]))
        p = cc.plan_for((1, 39, 0))
        self.assertEqual({f["feature"] for f in p["lacks"]},
                         {"labelStyleOff", "epubLabels", "textPanelsStrips", "framesRtl", "migrationLayer",
                          "editionChecks", "wordTrackingSandbox", "jumpsAcrossChapters"} | V142 | V148)
        self.assertTrue(all(f["since"] in ("1.40.0", "1.41.0", "1.42.0", "1.43.0") + LATER for f in p["lacks"]))
        self.assertEqual({f["feature"] for f in cc.plan_for((1, 40, 0))["lacks"]}, {"jumpsAcrossChapters"} | V142 | V148)
        self.assertEqual({f["feature"] for f in cc.plan_for((1, 41, 0))["lacks"]}, V142 | V148)
        self.assertEqual({f["feature"] for f in cc.plan_for((1, 42, 0))["lacks"]}, V143 | V148)
        self.assertEqual({f["feature"] for f in cc.plan_for((1, 43, 0))["lacks"]}, V148)
        self.assertEqual({f["feature"] for f in cc.plan_for((1, 48, 0))["lacks"]}, {"moduleConnectorToPage", "ringBarCaps"})
        self.assertEqual(cc.plan_for((1, 49, 0))["lacks"], [])

    def test_round_command(self):
        r = subprocess.run([sys.executable, str(SCRIPTS / "composed_check.py"), "round", "--version", "1.36.0", "--json"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["round"], 2)
        r = subprocess.run([sys.executable, str(SCRIPTS / "composed_check.py"), "round", "--version", "1.33.0"],
                           capture_output=True, text=True)
        self.assertIn("round 1", r.stdout)


class Markdown(unittest.TestCase):
    def test_extends_and_remove(self):
        names = [f["name"] for f in cc.resolve_frames(TEMPLATES, "tema-sin-fotos")]
        self.assertNotIn("dinero-fotos", names)
        self.assertEqual(names[-1], "nota")
        self.assertIsNone(cc.resolve_frames(TEMPLATES, "nope"))
        self.assertIsNone(cc.resolve_frames([{"id": "a", "extends": "b"}, {"id": "b", "extends": "a"}], "a"))
        self.assertTrue(cc.template_spread(TEMPLATES, "linea-2"))
        self.assertFalse(cc.template_spread(TEMPLATES, "tema"))

    def test_fences(self):
        fences = cc.page_fences(PAGE)
        self.assertEqual([f["template"] for f in fences], ["tema", "linea"])
        self.assertEqual(fences[0]["attrs"]["fondo"], "banda")
        self.assertEqual(fences[0]["line"], 3)
        self.assertTrue(fences[1]["spread"])
        slots = [(it["kind"], it.get("slot")) for it in fences[0]["items"]]
        # The nested callout and the frame fence inside the code listing stay inside.
        self.assertEqual(slots, [("heading", None), ("block", None), ("block", None), ("container", "dinero"),
                                 ("block", "dinero-fotos"), ("heading", "col-1"), ("block", "nada")])

    def test_expected_order(self):
        fences = cc.page_fences(PAGE)
        # h1 to the frame that takes it, text to the flow frame, the chain after its head,
        # an unknown slot to the flow frame.
        self.assertEqual(cc.expected_order(fences[0], TEMPLATES),
                         ["titulo", "texto", "dinero", "dinero-fotos", "col-1", "col-2", "col-3"])
        self.assertEqual(cc.expected_order(fences[1], TEMPLATES), ["tira", "texto"])
        self.assertIsNone(cc.expected_order({"template": "x", "items": []}, TEMPLATES))

    def test_an_empty_styled_fence_reads_where_it_lies(self):
        # a box whose words all went to captions of their own: its box and tab are
        # drawn, and read where the fence lies (postext#1116)
        md = ('::::page{template="tema"}\n# One\n\n:::frame{slot="dinero" label="Tab"}\n\n:::\n\n'
              '::resource{id="foto" slot="dinero-fotos"}\n::::\n')
        fence = cc.page_fences(md)[0]
        self.assertTrue(fence["items"][1]["empty"])
        self.assertEqual(cc.expected_order(fence, TEMPLATES), ["titulo", "dinero", "dinero-fotos"])

    def test_an_empty_styled_fence_between_two_frames(self):
        md = ('::::page{template="tema"}\n:::frame{slot="col-3"}\nFirst.\n:::\n\n'
              ':::frame{slot="dinero" label="Tab"}\n:::\n\nText of the flow.\n::::\n')
        fence = cc.page_fences(md)[0]
        order = cc.expected_order(fence, TEMPLATES)
        self.assertEqual(order, ["col-3", "dinero", "texto"])
        html = [{"page": 0, "frames": [{"id": f"cp0:{x}", "facing": False} for x in ("dinero", "col-3", "texto")]}]
        fences = [{"chapter": "c", "fence": 0, "line": 1, "spread": False, "order": order}]
        self.assertEqual([p["kind"] for p in cc.compare_order(html, fences)], ["order"])
        html[0]["frames"] = [{"id": f"cp0:{x}", "facing": False} for x in order]
        self.assertEqual(cc.compare_order(html, fences), [])

    def test_an_empty_fence_of_a_plain_frame_is_left_out(self):
        # no style: the frame draws nothing, so it has no place to read in
        md = '::::page{template="tema"}\n:::frame{slot="col-1"}\n:::\n\nText.\n::::\n'
        self.assertEqual(cc.expected_order(cc.page_fences(md)[0], TEMPLATES), ["texto"])

    def test_second_heading_goes_to_the_flow(self):
        fence = cc.page_fences('::::page{template="tema"}\n## A\n\n# One\n\n# Two\n::::\n')[0]
        self.assertEqual(cc.expected_order(fence, TEMPLATES), ["texto", "titulo"])

    def test_unclosed_page_closes_at_the_next(self):
        fences = cc.page_fences('::::page{template="tema"}\nText.\n\n::::page{template="linea"}\nMore.\n::::\n')
        self.assertEqual([f["template"] for f in fences], ["tema", "linea"])
        five = cc.page_fences(':::::page{template="tema"}\n::::\ntext\n:::::\n')
        self.assertEqual(len(five), 1)
        self.assertEqual(len(five[0]["items"]), 2)


def page(n: int, *ids: str, facing: tuple[str, ...] = ()) -> str:
    frames = "".join(f'<div class="pt-frame" data-frame-id="{i}" data-layer="1" style="z-index:1;"><p>x</p></div>'
                     for i in ids)
    frames += "".join(f'<div class="pt-frame" data-frame-id="{i}" data-facing="true" aria-hidden="true"></div>'
                      for i in facing)
    return f'<div class="pt-page" id="pt-p-{n}" data-page="{n}"><div class="pt-composed">{frames}</div></div>'


def fence(chapter: str, n: int, order: list[str], spread: bool = False) -> dict:
    return {"chapter": chapter, "chapterIndex": 0, "fence": n, "line": 1, "spread": spread, "order": order}


class Html(unittest.TestCase):
    def test_parse(self):
        pages = cc.html_frame_order(page(0) + page(1, "cp0:a", "cp0:b", facing=("cp0:c",)))
        self.assertEqual(pages[1]["frames"], [{"id": "cp0:a", "facing": False}, {"id": "cp0:b", "facing": False},
                                              {"id": "cp0:c", "facing": True}])
        self.assertEqual(cc.split_frame_id("cp3:dinero~2"), (3, "dinero", 2))
        self.assertEqual(cc.split_frame_id("cp0:a-b"), (0, "a-b", 0))

    def test_in_order(self):
        pages = cc.html_frame_order(page(0, "cp0:t", "cp0:x", "cp0:b") + page(1, "cp1:t"))
        fences = [fence("01.md", 0, ["t", "x", "b"]), fence("01.md", 1, ["t"])]
        self.assertEqual(cc.compare_order(pages, fences), [])

    def test_out_of_order(self):
        pages = cc.html_frame_order(page(0, "cp0:b", "cp0:t"))
        probs = cc.compare_order(pages, [fence("01.md", 0, ["t", "b"])])
        self.assertEqual(probs[0]["kind"], "order")
        self.assertEqual(probs[0]["html"], ["b", "t"])

    def test_spread_continuation_and_chapters(self):
        html = (page(0, "cp0:texto", facing=("cp0:tira",)) + page(1, "cp0:tira")
                + page(2, "cp0:box") + page(3, "cp0:box~1")  # chapter 2: a box continued on an added page
                + page(4, "cp1:a"))
        fences = [fence("01.md", 0, ["tira", "texto"], spread=True),
                  fence("02.md", 0, ["box"]), fence("02.md", 1, ["a"])]
        self.assertEqual(cc.compare_order(cc.html_frame_order(html), fences), [])

    def test_unmatched(self):
        probs = cc.compare_order(cc.html_frame_order(page(0, "cp4:x")), [fence("01.md", 0, ["x"])])
        self.assertEqual(probs[0]["kind"], "unmatched")

    def test_cross_locale(self):
        a = [{**fence("es/01.md", 0, ["t", "x", "b"]), "chapterIndex": 0}]
        b = [{**fence("en/01.md", 0, ["t", "b", "x"]), "chapterIndex": 0}]
        diff = cc.cross_locale({"es": a, "en": b})
        self.assertEqual(diff[0]["es"], ["t", "x", "b"])
        self.assertEqual(diff[0]["en"], ["t", "b", "x"])
        self.assertEqual(cc.cross_locale({"es": a, "ca": a}), [])


class Judge(unittest.TestCase):
    REPORT = {"warnings": [
        {"kind": "frameOverflow", "severity": "warning", "message": "short", "page": "1",
         "data": {"proposals": [{"kind": "raiseMax", "path": "/pageTemplates/0/frames/2/maxHeight", "value": "62mm"}]}},
        {"kind": "slotEmpty", "severity": "info", "message": "empty"},
        {"kind": "contrast.lowContrast", "severity": "warning", "message": "low"},
    ], "reflow": [{"pageLabel": "1", "template": "t", "events": [{"kind": "textScaled"}], "lines": ["a: text at 95 %"]}]}

    def test_plain(self):
        v = cc.judge(self.REPORT)
        self.assertEqual([w["kind"] for w in v["fail"]], ["frameOverflow"])
        self.assertEqual([w["kind"] for w in v["notes"]], ["slotEmpty"])
        self.assertEqual(v["scaled"][0]["lines"], ["a: text at 95 %"])

    def test_jump_target_missing_fails(self):
        v = cc.judge({"warnings": [{"kind": "continueTargetMissing", "severity": "warning", "message": "no page"}]})
        self.assertEqual([w["kind"] for w in v["fail"]], ["continueTargetMissing"])

    def test_label_checks_and_style_extends(self):
        v = cc.judge({"warnings": [
            {"kind": "labelOverflow", "severity": "warning", "message": "too wide", "page": "3"},
            {"kind": "labelOverlap", "severity": "warning", "message": "meets Belgium", "page": "3"},
            {"kind": "calloutStyleExtendsUnknown", "severity": "warning", "message": "no parent"},
            {"kind": "calloutStyleExtendsCycle", "severity": "warning", "message": "a > b > a"}]})
        self.assertEqual([w["kind"] for w in v["fail"]],
                         ["labelOverflow", "calloutStyleExtendsUnknown", "calloutStyleExtendsCycle"])
        self.assertEqual([w["kind"] for w in v["notes"]], ["labelOverlap"])
        # a longer text does not make an overlap fail the stress run
        v = cc.judge({"warnings": [{"kind": "labelOverlap", "severity": "warning", "message": "m"}]},
                     stressed=True, base={"warnings": []})
        self.assertEqual(v["fail"], [])

    def test_label_on_a_symbol_and_shared_words_fail(self):
        v = cc.judge({"warnings": [
            {"kind": "labelOverlap", "severity": "warning", "message": "meets symbol 2",
             "data": {"withSymbol": 2, "with": "symbol 2", "count": 1}},
            {"kind": "labelOverlap", "severity": "warning", "message": "meets Belgium", "data": {"with": "Belgium"}},
            {"kind": "figureWordsShared", "severity": "warning", "message": "dropped",
             "data": {"resourceId": "mapa", "words": "caption"}}]})
        self.assertEqual([w["kind"] for w in v["fail"]], ["labelOverlap", "figureWordsShared"])
        self.assertEqual(v["fail"][0]["message"], "meets symbol 2")
        self.assertEqual([w["message"] for w in v["notes"]], ["meets Belgium"])

    def test_stressed(self):
        v = cc.judge(self.REPORT, stressed=True, base={"warnings": [{"kind": "contrast.lowContrast"}]})
        self.assertEqual(v["fail"], [])
        self.assertEqual([w["kind"] for w in v["warn"]], ["frameOverflow"])
        bare = {"warnings": [{"kind": "frameOverflow", "severity": "warning", "message": "m",
                              "data": {"proposals": [{"kind": "shortenText", "sourceStart": 1}]}},
                             {"kind": "raggedLine", "severity": "warning", "message": "r"}]}
        v = cc.judge(bare, stressed=True, base={"warnings": []})
        self.assertEqual(sorted(w["kind"] for w in v["fail"]), ["frameOverflow", "raggedLine"])


class Stretch(unittest.TestCase):
    def test_longer_and_markup_kept(self):
        md = ('::::page{template="t"}\n# Título\n\nLas personas usan :chip[recursos]{style="clave"} y '
              '[^1] [un enlace](https://x.org) cada día.\n\n```js\ncode stays\n```\n::::\n')
        out, before, after = cc.stretch_markdown(md, 1.3)
        self.assertGreater(after, before * 1.25)
        self.assertIn('::::page{template="t"}', out)
        self.assertIn(':chip[recursos]{style="clave"}', out)
        self.assertIn("[un enlace](https://x.org)", out)
        self.assertIn("```js\ncode stays\n```", out)
        self.assertIn("personas personas", out)
        self.assertTrue(out.startswith('::::page{template="t"}\n# Título Título'))

    def test_cjk_no_spaces(self):
        out, _, _ = cc.stretch_markdown("这是一个例子。\n", 1.3)
        self.assertIn("这是一个例子这是一个例子", out)

    def test_front_matter_and_factor_one(self):
        md = "---\ntitle: Libro largo\n---\n\nUn texto corto aquí.\n"
        out, _, _ = cc.stretch_markdown(md, 1.5)
        self.assertIn("title: Libro largo\n", out)
        self.assertEqual(cc.stretch_markdown(md, 1.0)[0], md)

    def test_copy(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "book"
            (root / "chapters" / "es").mkdir(parents=True)
            (root / "fonts").mkdir()
            (root / "fonts" / "a.ttf").write_bytes(b"x")
            (root / "chapters" / "es" / "01.md").write_text("Un texto con varias palabras.\n", encoding="utf-8")
            (root / "preset.json").write_text(json.dumps({"version": 2, "config": {},
                                                          "chapters": [{"title": "Uno", "file": "chapters/es/01.md"}]}))
            data, _, read = cc.kit.read_target(str(root))
            into = Path(d) / "out"
            into.mkdir()
            out, before, after = cc.stretched_copy(str(root), data, read, 1.3, into)
            self.assertGreater(after, before)
            self.assertTrue((out / "fonts" / "a.ttf").is_symlink())
            self.assertFalse((out / "preset.json").is_symlink())
            self.assertNotEqual((out / "chapters" / "es" / "01.md").read_text(encoding="utf-8"),
                                "Un texto con varias palabras.\n")


def run_lint(project: Path) -> str:
    r = subprocess.run([sys.executable, str(SCRIPTS / "lint_project.py"), str(project)], capture_output=True, text=True)
    return r.stdout


class Lint(unittest.TestCase):
    def project(self, d: str, md: str, templates: list[dict] | None = None) -> Path:
        root = Path(d)
        (root / "chapters").mkdir()
        (root / "chapters" / "01.md").write_text(md, encoding="utf-8")
        cfg = {"header": {"elements": []}, "layout": {"layoutType": "single"},
               "calloutStyles": [{"id": "caja"}, {"id": "nota"}, {"id": "c"}], "chipStyles": [{"id": "clave"}],
               "labelStyles": [{"id": "mar"}], "pageTemplates": templates or TEMPLATES}
        res = [{"id": "dinero-pago", "typeId": "figure", "kind": "svg", "caption": ""},
               {"id": "tira", "typeId": "figure", "kind": "svg", "caption": "", "anchors": [{"id": "a", "x": 0.1, "y": 0.5}]}]
        (root / "preset.json").write_text(json.dumps({"version": 2, "configVersion": 15, "id": "t", "name": "T",
                                                      "locale": "es", "chapters": [{"title": "Uno", "file": "chapters/01.md"}],
                                                      "config": cfg, "resources": res, "fonts": []}))
        return root

    def test_clean_page(self):
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, PAGE.replace('```js {slot="nada"}', '```js {slot="col-2"}')))
            errors = [ln for ln in out.splitlines() if ln.startswith("ERROR")]
            self.assertEqual(errors, [], out)

    def test_composed_errors(self):
        md = ('::::page{template="tema"}\n:::frame{slot="dinerito"}\nx\n:::\n\n:::frame\ny\n:::\n::::\n\n'
              ':::page{template="tema"}\n:::\n\n'
              '::::page{template="linea"}\n:::figure{resource="tira" slot="tira"}\n::label[X]{at="b"}\n'
              '::label[Y]{at="40% 60%" style="rio"}\nnot a label\n:::\n::::\n\n'
              '::::page{template="nope"}\nz\n:::\n')
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, md))
            self.assertIn("slotUnknown: template 'tema' has no frame 'dinerito'", out)
            self.assertIn(':::frame needs slot="…"', out)
            self.assertIn("pageFenceLength", out)
            self.assertIn("spreadMismatch", out)
            self.assertIn("labelAnchorUnknown: resource 'tira' has no anchor 'b'", out)
            self.assertIn("label style 'rio' is not in labelStyles", out)
            self.assertIn("a :::figure ends at its first line that is neither a ::label, ::alt / ::caption / ::note nor blank", out)
            self.assertIn("templateUnknown: no pageTemplates entry 'nope'", out)
            self.assertIn("a ::::page is never closed", out)
            self.assertNotIn("is not a Postext container", out)

    def test_comic_text_panel(self):
        md = (':::page{split="30 / *"}\n::panel{text box=caja valign=middle}\nThe storm lasted three days.\n\n'
              'Maya climbed the **steps**.\n::panel{text box=nada valign=sideways}\nmaya: not a script line here\n'
              '::panel{art=x}\nmaya: Grandpa?\n:::\n\n'
              ':::strip\n::panel{text}\nWords.\n:::\n')
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, md))
            self.assertNotIn("attribute 'text' is ignored", out)
            self.assertNotIn("attribute 'box' is ignored", out)
            self.assertNotIn("attribute 'valign' is ignored", out)
            self.assertIn("box='nada' is not in calloutStyles", out)
            self.assertIn("valign='sideways' is ignored", out)
            self.assertIn("text panel on a strip: set in its frame from postext 1.40", out)
            self.assertNotIn("WARN", "".join(l for l in out.splitlines() if "text panel on a strip" in l))
            self.assertNotIn("comicStrayText", out)

    def test_comic_text_panel_shrink(self):
        md = (':::page{split="30 / *"}\n::panel{text shrink}\nWords.\n::panel{text shrink=70%}\nMore.\n'
              '::panel{text shrink=lots}\nEven more.\n::panel{art=x shrink=0.8}\nmaya: Hi\n:::\n')
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, md))
            self.assertNotIn("attribute 'shrink' is ignored", out)
            self.assertIn("shrink='lots' is not a number or a percent", out)
            self.assertIn("shrink sets a text panel's text smaller until it fits: it does nothing without the text flag", out)
            self.assertNotIn("shrink='70%'", out)

    def test_page_fence_palette(self):
        md = '::::page{template="linea" palette="tint=#f6c3d0; nada=#fff"}\nTexto.\n::::\n'
        with tempfile.TemporaryDirectory() as d:
            root = self.project(d, md)
            data = json.loads((root / "preset.json").read_text())
            data["config"]["colorPalette"] = [{"id": "tint", "name": "Tinte", "value": {"hex": "#e8f1f7", "model": "hex"}}]
            (root / "preset.json").write_text(json.dumps(data))
            out = run_lint(root)
            self.assertIn("page palette id 'nada' is not in colorPalette", out)
            self.assertNotIn("page palette id 'tint'", out)

    def test_font_fallback(self):
        with tempfile.TemporaryDirectory() as d:
            root = self.project(d, "Texto.\n")
            data = json.loads((root / "preset.json").read_text())
            data["fonts"] = [{"name": "Adobe Garamond Pro", "redistributable": False, "variants": [],
                              "fallback": "EB Garamond"},
                             {"name": "Futura", "redistributable": False, "variants": []},
                             {"name": "Minion", "redistributable": False, "variants": [], "fallback": "Minion"},
                             {"name": "Sabon", "variants": [], "fallback": 3}]
            (root / "preset.json").write_text(json.dumps(data))
            out = run_lint(root)
            self.assertNotIn("font 'Adobe Garamond Pro'", out)
            self.assertIn("font 'Futura': no font file and no fallback", out)
            self.assertIn("font 'Minion': fallback names the family itself", out)
            self.assertIn("font 'Sabon': fallback must be the name of a font family", out)

    def test_callout_extends(self):
        with tempfile.TemporaryDirectory() as d:
            root = self.project(d, "Texto.\n")
            data = json.loads((root / "preset.json").read_text())
            data["config"]["calloutStyles"] = [
                {"id": "caja"}, {"id": "caja-p5", "extends": "caja"}, {"id": "huerfana", "extends": "nada"},
                {"id": "a", "extends": "b"}, {"id": "b", "extends": "a"}]
            (root / "preset.json").write_text(json.dumps(data))
            out = run_lint(root)
            self.assertIn("calloutStyleExtendsUnknown: calloutStyles 'huerfana' extends 'nada'", out)
            self.assertEqual(out.count("calloutStyleExtendsCycle"), 1, out)
            self.assertIn("a -> b -> a", out)
            self.assertNotIn("'caja-p5' extends", out)

    def test_figure_words(self):
        md = ('::::page{template="linea"}\n'
              ':::figure{resource="tira" slot="tira" alt="Mapa físico"}\n'
              '::caption[Relieve [de] la península]\n::note[Fuente: IGN]\n\n::label[Pirineos]{at="a"}\n:::\n'
              ':::figure{resource="tira" slot="tira"}\n::alt[Otro texto]\n::label[X]{at="a"}\n:::\n'
              '::::\n')
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, md))
            self.assertNotIn("a :::figure ends at its first line", out)
            self.assertIn("figureWordsShared (postext 1.42): resource 'tira' already has its words from the figure "
                          "at line 2, so this figure's alt are not shown", out)
        # the same words again, or none, lose nothing: the engine is quiet and so is the lint
        md = ('::::page{template="linea"}\n'
              ':::figure{resource="tira" slot="tira" alt="Mapa"}\n::caption[Relieve]\n:::\n'
              ':::figure{resource="tira" slot="tira"}\n::alt[Mapa]\n::caption[Relieve]\n:::\n'
              ':::figure{resource="tira" slot="tira"}\n::label[X]{at="a"}\n:::\n'
              '::::\n')
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, md))
            self.assertNotIn("figureWordsShared", out)
        md = ':::figure{resource="tira"}\n::alt[]\n::note[a]\n::note[b]\n::label[X]{at="a"}\n:::\n'
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, md))
            self.assertIn("::alt[] marks the picture decorative", out)
            self.assertIn("::note given twice in one :::figure", out)
            self.assertNotIn("a :::figure ends at its first line", out)
        md = ':::figure{resource="tira"}\n::label[X]{at="a"}\nsome text\n:::\n'
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, md))
            self.assertIn("neither a ::label, ::alt / ::caption / ::note nor blank", out)

    def test_label_container(self):
        # postext 1.48: a key of several lines, symbols in it, a leader on a label
        md = ('::::page{template="linea"}\n:::figure{resource="tira" slot="tira"}\n'
              ':::label{at="a" style="mar"}\n:icon[Town]{glyph="⊙"} Town\n\n:icon[Road]{line="dashed"} Road\n:::\n'
              '::label[Lake]{at="a" leader}\n:::\n::::\n')
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, md))
            self.assertNotIn("a :::figure ends at its first line", out)
            self.assertNotIn("not a Postext container", out)
            self.assertNotIn("stray :::", out)
        md = ':::figure{resource="tira"}\n:::label{at="nope" style="zz"}\nX\n:::\n:::\n'
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, md))
            self.assertIn("labelAnchorUnknown: resource 'tira' has no anchor 'nope'", out)
            self.assertIn("label style 'zz' is not in labelStyles", out)

    def test_modules_and_grids(self):
        # postext 1.48: slots inside a :::module are the module's; a grid's items name its frames
        md = MODULE_PAGE.replace(':::module{template="nope"}\nLost.\n:::\n', "") + "\n" + GRID_PAGE
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, md, SHELL_TEMPLATES))
            errors = [ln for ln in out.splitlines() if ln.startswith("ERROR") and "unknown resource" not in ln]
            self.assertEqual(errors, [], out)
            self.assertIn("moduleNameRejected: another module of this page is named 'branches'", out)
        md = ('::::page{template="shell"}\n:::module{template="nope"}\nA\n:::\n'
              ':::module{template="cards"}\nB\n:::\n'
              ':::module{template="tree" name="a.b"}\n:::frame{slot="trunk"}\nC\n:::\n'
              ':::module{template="tree"}\nD\n:::\n:::\n'
              ':::frame{slot="root"}\nE\n:::\n::::\n\n'
              '::::page{template="tree"}\nF\n::::\n\n'
              '::::page{template="cards"}\n:::module{template="tree"}\nG\n:::\n::::\n')
        with tempfile.TemporaryDirectory() as d:
            out = run_lint(self.project(d, md, SHELL_TEMPLATES))
            self.assertIn("moduleUnknown: no pageTemplates entry 'nope'", out)
            self.assertIn("moduleUnknown: template 'cards' is not a module", out)
            self.assertIn("moduleNameRejected: 'a.b' has a space", out)
            self.assertIn("slotUnknown: module 'tree' has no frame 'trunk'", out)
            self.assertIn("moduleNested", out)
            # after the module closes, slots are the page template's again
            self.assertIn("slotUnknown: template 'shell' has no frame 'root'", out)
            self.assertIn("moduleAsPage: template 'tree' is a module", out)
            self.assertIn("moduleUnknown: template 'cards' has no modules group", out)


@unittest.skipUnless(os.environ.get("POSTEXT_CLI"), "set POSTEXT_CLI to a postext command (1.35.0 or later)")
class EndToEnd(unittest.TestCase):
    def test_two_editions(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for lang, body in (("en", "# Money\n\nMoney pays.\n\n:::frame{slot=\"caja\" label=\"Saving\"}\nKeep some.\n:::\n"),
                               ("es", ":::frame{slot=\"caja\" label=\"Ahorrar\"}\nGuarda algo.\n:::\n\n# El dinero\n\nPaga.\n")):
                (root / "chapters" / lang).mkdir(parents=True)
                (root / "chapters" / lang / "01.md").write_text(f'::::page{{template="t"}}\n{body}::::\n', encoding="utf-8")
            cfg = {"calloutStyles": [{"id": "c"}], "pageTemplates": [{"id": "t", "frames": [
                {"name": "titulo", "takes": "h1"}, {"name": "texto", "flow": True,
                                                   "placement": {"anchor": {"to": "#titulo", "edge": "below"}}},
                {"name": "caja", "style": "c", "placement": {"anchor": {"to": "#texto", "edge": "below"}}}]}]}
            (root / "preset.json").write_text(json.dumps({
                "version": 2, "configVersion": 15, "id": "t", "name": "T", "locale": "en",
                "chapters": {"en": [{"title": "One", "file": "chapters/en/01.md"}],
                             "es": [{"title": "Uno", "file": "chapters/es/01.md"}]},
                "localized": {"es": {"config": {"locale": "es"}}}, "config": cfg, "resources": [], "fonts": []}))
            r = subprocess.run([sys.executable, str(SCRIPTS / "composed_check.py"), "check", str(root), "--json",
                                "--offline", "--stress", "1.3", "--postext", os.environ["POSTEXT_CLI"]],
                               capture_output=True, text=True, timeout=900)
            res = json.loads(r.stdout)
            self.assertEqual(set(res["editions"]), {"en", "es"})
            self.assertEqual(res["editions"]["es"]["order"], [])
            self.assertEqual(res["crossLocale"][0]["en"], ["titulo", "texto", "caja"])
            self.assertEqual(res["crossLocale"][0]["es"], ["caja", "titulo", "texto"])
            self.assertIn("stress", res["editions"]["en"])


SHELL_TEMPLATES = [
    {"id": "shell", "frames": [{"name": "title", "takes": "h1"}],
     "groups": [{"name": "body", "modules": True}]},
    {"id": "tree", "role": "module", "frames": [{"name": "root"}, {"name": "left"}, {"name": "right"}]},
    {"id": "tree-wide", "extends": "tree"},
    {"id": "photos", "role": "module",
     "frames": [{"name": "head", "takes": "h2"}, {"name": "text", "flow": True}, {"name": "photo"}, {"name": "pill"}],
     "groups": [{"name": "wall", "kind": "grid", "columns": 2, "repeat": {"frames": ["photo", "pill"]}}]},
    {"id": "cards", "frames": [{"name": "title", "takes": "h1"}, {"name": "text", "flow": True},
                               {"name": "card", "style": "c"}, {"name": "tab"}, {"name": "note"}],
     "groups": [{"name": "grid", "kind": "grid", "columns": 3, "repeat": {"frames": ["card", "tab"]}}]},
]

GRID_PAGE = """::::page{template="cards"}
# Animals

Intro.

:::frame{slot="card"}
::resource{id="heron"}

:::frame{slot="tab"}
Heron
:::
:::

:::frame{slot="card"}
:::frame{slot="tab"}
Otter
:::

The otter swims.
:::

::resource{id="fox" slot="tab"}

:::frame{slot="note"}
A note.
:::
::::
"""

MODULE_PAGE = """::::page{template="shell"}
# The river

:::module{template="tree" name="branches"}
:::frame{slot="root"}
River
:::
:::frame{slot="right"}
Banks
:::
:::frame{slot="left"}
Water
:::
:::

:::module{template="photos"}
## Along the banks

Some text.

:::frame{slot="photo"}
::resource{id="heron"}
:::frame{slot="pill"}
Heron
:::
:::
:::

:::module{template="tree"}
:::frame{slot="root"}
Two
:::
:::

:::module{template="tree" name="branches"}
:::frame{slot="root"}
Three
:::
:::

:::module{template="nope"}
Lost.
:::
::::
"""


class Round2Order(unittest.TestCase):
    """Reading order of pages with repeating grids and modules (postext 1.48)."""

    def test_grid_items(self):
        fence = cc.page_fences(GRID_PAGE)[0]
        kinds = [(it["kind"], it.get("slot")) for it in fence["items"]]
        self.assertEqual(kinds, [("heading", None), ("block", None), ("container", "card"), ("container", "card"),
                                 ("block", "tab"), ("container", "note")])
        self.assertEqual([w.get("slot") for w in fence["items"][3]["within"]], ["tab", None])
        # each piece is an item; its members are the same item's instances, in the order written
        self.assertEqual(cc.expected_order(fence, SHELL_TEMPLATES),
                         ["title", "text", "card[1]", "tab[1]", "tab[2]", "card[2]", "tab[3]", "note"])

    def test_modules(self):
        fence = cc.page_fences(MODULE_PAGE)[0]
        mods = [it for it in fence["items"] if it["kind"] == "module"]
        self.assertEqual([m["template"] for m in mods], ["tree", "photos", "tree", "tree", "nope"])
        self.assertEqual(cc.module_instances(fence["items"]),
                         ["branches", "photos[1]", "tree[2]", "tree[3]", "nope[1]"])
        self.assertTrue(cc.is_module(SHELL_TEMPLATES, "tree-wide"))
        self.assertFalse(cc.is_module(SHELL_TEMPLATES, "shell"))
        # slots scoped by the module, a module's heading to its takes frame and its text to its flow
        # frame, a grid inside a module, a taken name numbered, an unknown module to the page's flow
        # frame (the shell has none: nothing)
        self.assertEqual(cc.expected_order(fence, SHELL_TEMPLATES),
                         ["title", "branches.root", "branches.right", "branches.left",
                          "photos[1].head", "photos[1].text", "photos[1].photo[1]", "photos[1].pill[1]",
                          "tree[2].root", "tree[3].root"])

    def test_module_without_a_modules_group(self):
        templates = [{"id": "plain", "frames": [{"name": "text", "flow": True}]}] + SHELL_TEMPLATES[1:]
        fence = cc.page_fences('::::page{template="plain"}\n:::module{template="tree"}\n'
                               ':::frame{slot="root"}\nA\n:::\n:::\n::::\n')[0]
        self.assertEqual(cc.expected_order(fence, templates), ["text"])

    def test_html_ids_of_instances(self):
        self.assertEqual(cc.split_frame_id("cp0:arbol[2].raiz~1"), (0, "arbol[2].raiz", 1))
        pages = cc.html_frame_order(page(0, "cp0:title", "cp0:branches.root", "cp0:branches.left"))
        order = ["title", "branches.root", "branches.right", "branches.left"]
        self.assertEqual(cc.compare_order(pages, [fence("01.md", 0, order)]), [])
        pages = cc.html_frame_order(page(0, "cp0:branches.left", "cp0:branches.root"))
        self.assertEqual(cc.compare_order(pages, [fence("01.md", 0, order)])[0]["kind"], "order")


COVERED = {"kind": "frameCovered", "severity": "warning", "page": "4",
           "message": 'Frame "pill[2]" of template "photos" (en) lies under frame "photo[2]"',
           "data": {"template": "photos", "frame": "pill[2]", "coveredBy": "photo[2]", "locale": "en",
                    "overlapMm2": 12.5, "proposals": [{"kind": "layer", "value": 0}]}}
OUTSIDE = {"kind": "frameOutsideArea", "severity": "warning", "page": "5",
           "message": 'Frame "note" of template "map" (en) runs 4 mm past the frame "card"',
           "data": {"template": "map", "frame": "note", "past": "frame", "target": "card", "excessMm": 4}}


class Overlaps(unittest.TestCase):
    def test_overlaps_fail(self):
        v = cc.judge({"warnings": [COVERED, OUTSIDE, {"kind": "repeatOverflow", "severity": "warning", "message": "m"},
                                   {"kind": "moduleUnknown", "severity": "warning", "message": "m"}]})
        self.assertEqual([w["kind"] for w in v["fail"]],
                         ["frameCovered", "frameOutsideArea", "repeatOverflow", "moduleUnknown"])
        self.assertEqual(v["overlaps"], 2)
        self.assertIn("overlap: 'allow'", v["fail"][0]["hint"])
        self.assertIn(cc.EXCEPTIONS_FILE, v["fail"][1]["hint"])

    def test_exceptions(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / cc.EXCEPTIONS_FILE
            f.write_text(json.dumps({"overlaps": [
                {"kind": "frameCovered", "frame": "pill[*]", "coveredBy": "photo*", "reason": "pills sit on the photos"},
                {"frame": "note", "template": "other", "reason": "another template"},
                {"frame": "x"},
                {"frame": "y", "reason": "r", "kind": "frameOverflow"},
                {"frame": "z", "reason": "r", "colour": "red"},
            ]}), encoding="utf-8")
            entries, problems = cc.load_exceptions(f)
        self.assertEqual(len(entries), 3)
        self.assertEqual(len(problems), 3)
        self.assertTrue(any("reason" in p for p in problems))
        self.assertTrue(any("unknown key" in p for p in problems))
        v = cc.judge({"warnings": [COVERED, OUTSIDE]}, exceptions=entries, locale="en")
        self.assertEqual([w["kind"] for w in v["allowed"]], ["frameCovered"])
        self.assertEqual(v["allowed"][0]["reason"], "pills sit on the photos")
        self.assertEqual([w["kind"] for w in v["fail"]], ["frameOutsideArea"])  # its template differs
        self.assertEqual((v["overlaps"], v["exceptionsUsed"]), (1, [0]))
        # a pattern is literal but for [*] and *
        self.assertFalse(cc._name_pattern("pill[*]").match("pill"))
        self.assertTrue(cc._name_pattern("mod[*].pill[*]").match("mod[2].pill[10]"))
        self.assertFalse(cc._name_pattern("a.b").match("axb"))
        self.assertEqual(cc.load_exceptions(Path(d) / "missing.json"), ([], []))

    def test_allowed_frames(self):
        self.assertEqual(cc.allowed_frames([{"id": "t", "frames": [{"name": "a", "overlap": "allow"},
                                                                    {"name": "b", "overlap": "check"}]}]), ["t/a"])

    def test_score_fails_on_overlaps(self):
        try:
            import fitz  # noqa: F401, PLC0415
        except ImportError:
            self.skipTest("PyMuPDF not installed")
        with tempfile.TemporaryDirectory() as d:
            pdf = Path(d) / "pages.pdf"
            doc = fitz.open()
            doc.new_page(width=200, height=280).insert_text((20, 40), "A page")
            doc.save(pdf)
            raw = Path(d) / "check.json"
            raw.write_text(json.dumps({"warnings": [COVERED, OUTSIDE]}), encoding="utf-8")
            base = [sys.executable, str(SCRIPTS / "compare_pages.py"), str(pdf), str(pdf), "--source-pages", "1",
                    "--render-pages", "1", "--out", str(Path(d) / "cmp"), "--dpi", "20"]
            score = Path(d) / "score.json"
            r = subprocess.run(base + ["--score", str(score), "--check", str(raw)], capture_output=True, text=True,
                               timeout=120)
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            res = json.loads(score.read_text(encoding="utf-8"))
            self.assertFalse(res["passed"])
            self.assertEqual([o["kind"] for o in res["overlaps"]], ["frameCovered", "frameOutsideArea"])
            self.assertIn("overlaps 2: p. 4 (1), p. 5 (1)", r.stdout)
            # the project's recorded exceptions apply to a raw postext report
            (Path(d) / cc.EXCEPTIONS_FILE).write_text(json.dumps({"overlaps": [
                {"frame": "pill[*]", "reason": "on the photo"}, {"frame": "note", "reason": "hangs off"}]}),
                encoding="utf-8")
            r = subprocess.run(base + ["--score", str(score), "--check", str(raw)], capture_output=True, text=True,
                               timeout=120)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertTrue(json.loads(score.read_text(encoding="utf-8"))["passed"])
            # a composed_check report: its failures marked as overlaps
            cc_report = Path(d) / "cc.json"
            cc_report.write_text(json.dumps({"editions": {"en": {"fail": [
                {"kind": "frameCovered", "page": "2", "message": "m", "overlap": True},
                {"kind": "frameOverflow", "page": "2", "message": "m"}]}}}), encoding="utf-8")
            r = subprocess.run(base + ["--score", "--check", str(cc_report)], capture_output=True, text=True, timeout=120)
            self.assertEqual(r.returncode, 1)
            self.assertIn("overlaps 1: p. 2 (1)", r.stdout)

    def test_check_with_a_stand_in_cli(self):
        """The whole check on a stand-in postext command: an overlap fails until it is recorded."""
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "book"
            (root / "chapters").mkdir(parents=True)
            (root / "chapters" / "01.md").write_text('::::page{template="photos"}\n:::frame{slot="photo"}\nA\n:::\n::::\n',
                                                     encoding="utf-8")
            (root / "preset.json").write_text(json.dumps({
                "version": 2, "configVersion": 16, "id": "t", "name": "T", "locale": "en",
                "chapters": [{"title": "One", "file": "chapters/01.md"}],
                "config": {"pageTemplates": [{"id": "photos", "frames": [{"name": "photo"}, {"name": "pill", "overlap": "allow"}]}]},
                "resources": [], "fonts": []}), encoding="utf-8")
            report = Path(d) / "report.json"
            report.write_text(json.dumps({"warnings": [COVERED]}), encoding="utf-8")
            fake = Path(d) / "fake_postext.py"
            fake.write_text(
                "import sys\n"
                "a = sys.argv[1:]\n"
                "if a[0] == '--version': print('postext 1.48.1 (engine 1.48.1, test)')\n"
                f"elif a[0] == 'check': print(open({str(report)!r}).read())\n"
                "elif a[0] == 'html': open(a[a.index('-o') + 1], 'w').write('<div class=\"pt-page\" data-page=\"0\"></div>')\n",
                encoding="utf-8")
            cmd = [sys.executable, str(SCRIPTS / "composed_check.py"), "check", str(root), "--json",
                   "--postext", f"{sys.executable} {fake}"]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            self.assertEqual(r.returncode, 1, r.stderr)
            res = json.loads(r.stdout)
            self.assertEqual(res["overlaps"], 1)
            self.assertEqual(next(iter(res["editions"].values()))["allowedFrames"], ["photos/pill"])
            (root / cc.EXCEPTIONS_FILE).write_text(json.dumps({"overlaps": [
                {"frame": "pill[*]", "coveredBy": "photo[*]", "reason": "the source sets the pill on the photo"},
                {"frame": "never", "reason": "stale"}]}), encoding="utf-8")
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            res = json.loads(r.stdout)
            self.assertEqual((res["overlaps"], res["passed"]), (0, True))
            self.assertEqual([u["frame"] for u in res["exceptions"]["unused"]], ["never"])
            r = subprocess.run(cmd[:-3] + ["--postext", f"{sys.executable} {fake}"], capture_output=True, text=True,
                               timeout=120)
            self.assertIn("overlaps: 0", r.stdout)
            self.assertIn("allowed frameCovered", r.stdout)


if __name__ == "__main__":
    unittest.main()
