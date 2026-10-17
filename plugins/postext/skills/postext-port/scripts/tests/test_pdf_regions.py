"""Tests of `pdf_regions.py`, `anchors.py` and `template_dedupe.py` on small
PDFs drawn in the test (no book in the repository).

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests

With POSTEXT_CLI set to a postext command (`postext`, `bun …/packages/
postext-cli/src/main.ts`), one test lays the draft project out and checks
that it builds without warnings about templates, slots or overflow.
"""
from __future__ import annotations

import io
import json
import os
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

try:
    import fitz  # noqa: F401
    import numpy  # noqa: F401
    from PIL import Image
    HAVE_DEPS = True
except Exception:  # pragma: no cover
    HAVE_DEPS = False

if HAVE_DEPS:
    import anchors as anc
    import pdf_regions as pr
    import preset_kit as kit
    import template_dedupe as td

MM = 72 / 25.4


def R(x0, y0, x1, y1):
    return fitz.Rect(x0 * MM, y0 * MM, x1 * MM, y1 * MM)


def text(page, x, y, s, size=11, font="helv", color=(0.1, 0.1, 0.1)):
    page.insert_text((x * MM, y * MM), s, fontsize=size, fontname=font, color=color)


def png(w, h, rgba=False) -> bytes:
    im = Image.new("RGBA" if rgba else "RGB", (w, h), (0, 0, 0, 0) if rgba else (200, 80, 40))
    px = im.load()
    for y in range(h):
        for x in range(w):
            if rgba:
                if (x - w / 2) ** 2 + (y - h / 2) ** 2 < (w / 3) ** 2:
                    px[x, y] = (30, 120, 200, 255)
            else:
                px[x, y] = ((x * 7) % 255, (y * 5) % 255, 90)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def draw_page(doc, folio: int, title: str, box_words: str):
    """A textbook page: a title tab, two lines of text with a highlighted
    word, a box with a tab, a photo, a cut-out drawing over the box, a
    lettered map, a running head, a folio and a hidden copy of a word."""
    page = doc.new_page(width=210 * MM, height=297 * MM)
    text(page, 150, 9, "RUNNING HEAD WORDS", size=9)
    text(page, 190, 290, str(folio), size=9)
    # title tab
    page.draw_rect(R(15, 14, 110, 25), color=None, fill=(0.1, 0.3, 0.6), radius=0.15)
    text(page, 20, 22.5, title, size=24, font="hebo", color=(1, 1, 1))
    # running text with a highlighter stroke under one word
    before = fitz.get_text_length("The planet we live on has a ", fontname="helv", fontsize=11) / MM
    word = fitz.get_text_length("key", fontname="helv", fontsize=11) / MM
    page.draw_line(fitz.Point((20 + before - 0.3) * MM, 38.9 * MM), fitz.Point((20 + before + word + 0.3) * MM, 38.9 * MM),
                   color=(1, 0.9, 0), width=12)
    text(page, 20, 40, "The planet we live on has a key shape that looks like a ball seen from space.")
    text(page, 20, 45.6, "Pictures taken from far away show seas, land and clouds over the whole sphere.")
    # a box with a tab on its top edge
    page.draw_rect(R(20, 60, 190, 100), color=None, fill=(0.83, 0.91, 0.97), radius=0.05)
    page.draw_rect(R(20, 56, 48, 63), color=None, fill=(1, 1, 1))
    text(page, 23, 61.2, box_words, size=10, font="hebo")
    text(page, 24, 72, "Globes show the real shape of the land and the seas of the planet, all of it at once.")
    text(page, 24, 77.6, "They are small models of the Earth that turn round an axis.")
    # a photo and a drawing with transparency standing on the box
    page.insert_image(R(20, 110, 90, 160), stream=png(70, 50))
    page.insert_image(R(140, 64, 176, 96), stream=png(40, 36, rgba=True))
    # hidden text: drawn, then covered by an opaque fill
    text(page, 120, 130, "HIDDEN COPY", size=11)
    page.draw_rect(R(110, 120, 200, 140), color=None, fill=(1, 1, 1))
    # a lettered map: many drawn shapes and two names on them
    for i in range(16):
        x, y = 25 + (i % 4) * 30, 180 + (i // 4) * 13
        pts = [fitz.Point((x + dx) * MM, (y + dy) * MM) for dx, dy in ((0, 0), (30, 2), (34, 12), (8, 15), (-2, 7))]
        page.draw_polyline(pts + [pts[0]], color=(0.2, 0.5, 0.2), fill=(0.6, 0.8, 0.5), closePath=True)
    text(page, 30, 188, "NORTH LAND", size=8, font="hebo")
    text(page, 110, 224, "Blue Bay", size=8, font="helv")
    return page


def make_pdf(path: Path, pages: int = 1) -> None:
    doc = fitz.open()
    for n in range(pages):
        draw_page(doc, n + 1, "THE EARTH" if n == 0 else "MAPS AND GLOBES", "GLOBES" if n == 0 else "GLOBES TOO")
    doc.save(str(path))


def extract(pdf: Path, out: Path, *more: str) -> int:
    return pr.main(["extract", str(pdf), "--out", str(out), "--lang", "en", *more])


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class ExtractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.pdf = cls.root / "src.pdf"
        make_pdf(cls.pdf, pages=2)
        cls.out = cls.root / "out"
        import contextlib

        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            extract(cls.pdf, cls.out)
        cls.md = (cls.out / "chapters" / "en" / "01-pages.md").read_text(encoding="utf-8")
        cls.lib = json.loads((cls.out / "library.json").read_text(encoding="utf-8"))
        cls.res = json.loads((cls.out / "resources.json").read_text(encoding="utf-8"))
        cls.report = json.loads((cls.out / "report.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_page_fences_and_title(self):
        self.assertEqual(self.md.count("::::page{template="), 2)
        self.assertEqual(self.md.count("\n::::\n"), 2)
        self.assertIn("# THE EARTH", self.md)
        tpl = self.lib["pageTemplates"][0]
        self.assertEqual(tpl["area"], "trim")
        self.assertTrue(any(f.get("takes") == "h1" for f in tpl["frames"]))

    def test_flow_text_and_mark(self):
        self.assertIn("The planet we live on has a :mark[key]", self.md)
        # the two source lines are one paragraph
        self.assertIn("from space. Pictures taken", self.md)
        self.assertTrue(self.lib.get("markStyles"))
        tpl = self.lib["pageTemplates"][0]
        self.assertTrue(any(f["name"] == "text" and f.get("flow") for f in tpl["frames"]))

    def test_box_with_tab(self):
        self.assertIn(':::frame{slot="box-1" label="GLOBES"}', self.md)
        box_style = next(s for s in self.lib["calloutStyles"] if s.get("label"))
        self.assertEqual(box_style["label"]["position"], "top-left")
        self.assertAlmostEqual(box_style["label"]["offset"]["value"], 4.0, delta=0.3)
        self.assertEqual(box_style["background"]["hex"], "#d4e8f7")
        self.assertAlmostEqual(box_style["label"]["height"]["value"], 7.0, delta=0.2)

    def test_hidden_text_is_dropped(self):
        self.assertNotIn("HIDDEN", self.md)
        self.assertIn("HIDDEN COPY", " ".join(t for v in self.report["hiddenTexts"].values() for t in v))

    def test_figure_labels_and_anchors(self):
        self.assertIn(":::figure{resource=", self.md)
        self.assertIn('::label[NORTH LAND]{at="north-land"}', self.md)
        self.assertIn('::label[Blue Bay]{at="blue-bay"}', self.md)
        fig = next(r for r in self.res if r.get("anchors"))
        ids = [a["id"] for a in fig["anchors"]]
        self.assertEqual(ids, ["north-land", "blue-bay"])
        for a in fig["anchors"]:
            self.assertTrue(0 <= a["x"] <= 1 and 0 <= a["y"] <= 1)
            self.assertIn(a["style"], [s["id"] for s in self.lib["labelStyles"]])
        # the cut is free of lettering: no label text in the resource files
        self.assertTrue((self.out / fig["file"]).exists())

    def test_relabel_from_figures(self):
        import contextlib

        strings = self.root / "de.json"
        strings.write_text(json.dumps({"Blue Bay": "Blaue Bucht"}))
        with contextlib.redirect_stdout(io.StringIO()):
            anc.main(["relabel", str(self.out / "figures.json"), "--strings", f"de={strings}", "--out", str(self.root / "rl")])
        de = (self.root / "rl" / "figures.de.md").read_text()
        self.assertIn('::label[Blaue Bucht]{at="blue-bay"}', de)
        self.assertIn('::label[NORTH LAND]{at="north-land"}', de)

    def test_pictures_cut(self):
        pics = [r for r in self.res if r["typeId"] == "picture"]
        self.assertGreaterEqual(len(pics), 3)
        alpha = [r for r in pics if r["file"].endswith(".png")]
        self.assertTrue(alpha, "the drawing with transparency keeps its alpha")
        self.assertIn("contour", alpha[0])
        tpl = self.lib["pageTemplates"][0]
        drawn = next(f for f in tpl["frames"] if f.get("wrap") == "contour")
        self.assertEqual(drawn["exclude"], "push")
        self.assertEqual(drawn["placement"]["anchor"]["to"], "#box-1")

    def test_furniture_is_text_free(self):
        tpl = self.lib["pageTemplates"][0]
        els = tpl["decoration"]["elements"]
        contents = {e.get("content") for e in els if e["kind"] == "text"}
        self.assertIn("{pageNumber}", contents)
        self.assertIn("{attr.head}", contents)
        self.assertIn('head="RUNNING HEAD WORDS"', self.md)
        self.assertEqual(next(e for e in els if e["kind"] == "image")["resourceId"], "{attr.ground}")
        self.assertNotIn("RUNNING", json.dumps(self.lib))

    def test_frames_anchor_and_measure(self):
        tpl = self.lib["pageTemplates"][0]
        by = {f["name"]: f for f in tpl["frames"]}
        self.assertAlmostEqual(by["box-1"]["minHeight"]["value"], 44.0, delta=0.5)
        self.assertEqual(by["box-1"]["placement"]["anchor"]["to"], "#text")

    def test_deterministic(self):
        import contextlib

        out2 = self.root / "out2"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            extract(self.pdf, out2)
        self.assertEqual((out2 / "library.json").read_text(), (self.out / "library.json").read_text())
        self.assertEqual((out2 / "chapters/en/01-pages.md").read_text(), self.md)

    def test_dedupe_and_manifest(self):
        import contextlib
        import shutil

        work = self.root / "dd"
        shutil.copytree(self.out, work)
        rep = td.dedupe_dir(work, {"geom": 3, "dim": 0.5, "padding": 1.5, "font": 0.25, "delta_e": 3}, 2, 2.0)
        lib = json.loads((work / "library.json").read_text())
        # the two pages are one kind: one shared template, page-number free names
        self.assertEqual(rep["after"]["pageTemplates"], 1)
        tid = lib["pageTemplates"][0]["id"]
        self.assertNotRegex(tid, r"^p\d")
        md = (work / "chapters/en/01-pages.md").read_text()
        self.assertEqual(md.count(f'template="{tid}"'), 2)
        # the two grounds are alike: one kept, its file the only one left
        grounds = [r for r in json.loads((work / "resources.json").read_text()) if r["typeId"] == "ground"]
        self.assertEqual(len(grounds), 1)
        self.assertEqual(md.count(f'ground="{grounds[0]["id"]}"'), 2)
        # parity-bound decoration of both pages joined
        ids = {e["id"] for e in lib["pageTemplates"][0]["decoration"]["elements"]}
        self.assertTrue({"folio-odd", "folio-even"} <= ids)
        with contextlib.redirect_stdout(io.StringIO()):
            pr.main(["manifest", str(work)])
        manifest = json.loads((work / "preset.json").read_text())
        issues, _ = kit.content_in_config(manifest["config"])
        self.assertEqual(issues, [])
        cli = os.environ.get("POSTEXT_CLI")
        if cli:
            run = subprocess.run(shlex.split(cli) + ["check", str(work), "--offline", "--json"],
                                 capture_output=True, text=True)
            data = json.loads(run.stdout)
            kinds = {w.get("kind") for w in data.get("warnings", [])}
            for bad in ("templateUnknown", "slotUnknown", "frameOverflow", "frameStyleUnknown", "frameAnchorUnknown",
                        "labelAnchorUnknown", "contentInConfig", "unclosedContainer"):
                self.assertNotIn(bad, kinds)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class CardClipTest(unittest.TestCase):
    def test_picture_is_cut_no_further_than_its_card(self):
        import contextlib

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            doc = fitz.open()
            page = doc.new_page(width=210 * MM, height=297 * MM)
            page.draw_rect(R(0, 0, 210, 297), color=None, fill=(0.05, 0.7, 0.6))
            page.draw_rect(R(10, 20, 200, 250), color=None, fill=(1, 1, 1), radius=0.02)   # the card
            for i in range(24):   # a map on it
                x, y = 20 + (i % 4) * 40, 120 + (i // 4) * 20
                pts = [fitz.Point((x + dx) * MM, (y + dy) * MM) for dx, dy in ((0, 0), (36, 2), (40, 20), (8, 22), (-2, 10))]
                page.draw_polyline(pts + [pts[0]], color=(0.2, 0.5, 0.2), fill=(0.6, 0.8, 0.5), closePath=True)
            # white masks that hide the map's overflow past the card, and the folio's icons close under them
            page.draw_rect(R(20, 240, 190, 253.5), color=None, fill=(1, 1, 1))
            for i in range(3):
                page.draw_rect(R(20 + i * 2, 254.2, 21.2 + i * 2, 255.4), color=None, fill=(0.0, 0.68, 0.55))
            text(page, 100, 270, "BOOK 1", size=10)
            pdf = root / "card.pdf"
            doc.save(str(pdf))
            out = root / "out"
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                pr.main(["extract", str(pdf), "--out", str(out), "--lang", "en"])
            regions = json.loads((out / "regions.json").read_text(encoding="utf-8"))
            card = regions[0]["cards"][0]
            pics = [f for f in regions[0]["frames"] if f["kind"] in ("picture", "figure")]
            self.assertTrue(pics)
            for f in pics:
                self.assertLessEqual(f["box"][3], card[3] + 0.05, f)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class HelpersTest(unittest.TestCase):
    def test_parse_pages(self):
        self.assertEqual(pr.parse_pages("2-4,7", 10), [2, 3, 4, 7])
        self.assertEqual(pr.parse_pages("9-", 10), [9, 10])
        self.assertEqual(pr.parse_pages("0,11,3", 10), [3])

    def test_weights(self):
        self.assertEqual(pr.weight_italic_of("BoldCn"), (700, False, ["cn"]))
        self.assertEqual(pr.weight_italic_of("LightItalic")[:2], (300, True))
        self.assertEqual(pr.weight_italic_of("It")[:2], (400, True))
        self.assertEqual(pr.weight_italic_of("Regular")[:2], (400, False))

    def test_fonts(self):
        f = pr.Fonts()
        self.assertEqual(f.face("ABCDEF+FrutigerLTStd-Light"), ("Frutiger LT Std", 300, False))
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"Humanist777": "Frutiger LT Std", "Odd": {"family": "Other", "weight": 500}}, fh)
        try:
            f = pr.Fonts(Path(fh.name))
            self.assertEqual(f.face("Humanist777BT-BoldB"), ("Frutiger LT Std", 700, False))
            self.assertEqual(f.face("OddFace"), ("Other", 500, False))
        finally:
            os.unlink(fh.name)

    def test_wrap_slack(self):
        # the right padding of a box gives up per cent of the measure (at most 2.5 mm), never below 0.5 mm
        self.assertAlmostEqual(pr.give_slack(3.0, 80.0, {"wrap_slack": 2.5}), 1.0)
        self.assertAlmostEqual(pr.give_slack(3.0, 200.0, {"wrap_slack": 2.5}), 0.5)
        self.assertAlmostEqual(pr.give_slack(3.0, 80.0, {"wrap_slack": 0.0}), 3.0)
        self.assertAlmostEqual(pr.give_slack(0.2, 80.0, {"wrap_slack": 2.5}), 0.2)

    def test_xy_order(self):
        F = pr.Frame
        a, b, c, d = F("text", (10, 10, 200, 20)), F("box", (10, 30, 100, 60)), F("box", (110, 30, 200, 60)), F("text", (10, 70, 200, 80))
        self.assertEqual(pr.xy_order([d, c, b, a]), [a, b, c, d])


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class AnchorsTest(unittest.TestCase):
    def line(self, text, x0, base, size=8.0, color="#1d4f91", weight=400, rotate=0.0, width=None):
        w = width if width is not None else len(text) * size * 0.18
        s = size * 25.4 / 72
        return {"text": text, "plain": text, "x0": x0, "x1": x0 + w, "y0": base - 0.75 * s, "y1": base + 0.25 * s,
                "base": base, "size": size, "family": "Sans", "weight": weight, "italic": False, "color": color,
                "rotate": rotate}

    def test_merge_two_line_name(self):
        a = self.line("OCÉANO", 50, 100)
        b = self.line("ATLÁNTICO", 48.2, 103.2)
        c = self.line("Madrid", 20, 101, color="#000000", weight=700)
        groups = anc.merge_lines([b, c, a])
        self.assertEqual([len(g) for g in groups], [1, 2] if groups[0][0]["plain"] == "Madrid" else [2, 1])
        self.assertEqual(len(anc.merge_lines([a, b], merge=False)), 2)

    def test_anchor_geometry(self):
        a, b = self.line("OCÉANO", 50, 100, width=12), self.line("ATLÁNTICO", 48, 103.2, width=16)
        groups = anc.merge_lines([a, b])
        styles, ids = anc.label_styles(groups)
        anchors, labels = anc.anchors_for(groups, (40, 90, 140, 140), ids)
        self.assertEqual(labels[0]["text"], "OCÉANO ATLÁNTICO")
        an = anchors[0]
        self.assertEqual(an["id"], "oceano-atlantico")
        self.assertAlmostEqual(an["x"], (56 - 40) / 100, places=3)
        self.assertAlmostEqual(an["width"], round(1.25 * 16 / 100, 4))
        self.assertEqual(an["style"], styles[0]["id"])

    def test_rotated_label(self):
        g = anc.merge_lines([self.line("Meridian", 60, 120, rotate=-90.0)])
        anchors, _ = anc.anchors_for(g, (0, 0, 100, 200), {})
        self.assertEqual(anchors[0]["rotate"], -90.0)

    def test_label_styles_delta_e(self):
        g1 = [[self.line("A", 0, 10, color="#1d4f91")]]
        g2 = [[self.line("B", 0, 20, color="#1e5092")]]
        g3 = [[self.line("C", 0, 30, color="#c00000")]]
        styles, ids = anc.label_styles(g1 + g2 + g3)
        self.assertEqual(len(styles), 2)
        self.assertTrue(styles[0]["id"].startswith("label-"))

    def test_translate_and_block(self):
        labels = [{"at": "madrid", "text": "Madrid", "plain": "Madrid"},
                  {"at": "mar", "text": "Mar Negro", "plain": "Mar Negro"}]
        tl, missing = anc.translate(labels, {"Mar Negro": "Black [Sea]"})
        self.assertEqual(missing, ["Madrid"])
        block = anc.figure_block("mapa", "map", tl)
        self.assertIn('::label[Black \\[Sea\\]]{at="mar"}', block)
        self.assertTrue(block.startswith(':::figure{resource="mapa" slot="map"}'))

    def test_figure_words_in_the_block(self):
        labels = [{"at": "mar", "text": "Black Sea", "plain": "Black Sea"}]
        strings = {"@alt": "Map of [Europe]", "@caption": "Relief\nof Spain", "@note": "Source: IGN", "Mar": "x"}
        self.assertEqual(anc.words_from(strings), {"alt": "Map of [Europe]", "caption": "Relief\nof Spain",
                                                   "note": "Source: IGN"})
        self.assertEqual(anc.words_from(None), {})
        block = anc.figure_block("mapa", None, labels, anc.words_from(strings))
        self.assertEqual(block.splitlines(), [
            ":::figure{resource=\"mapa\"}", "::alt[Map of \\[Europe\\]]", "::caption[Relief of Spain]",
            "::note[Source: IGN]", '::label[Black Sea]{at="mar"}', ":::"])
        # no words: the block is what it was
        self.assertEqual(anc.figure_block("mapa", None, labels).splitlines()[1], '::label[Black Sea]{at="mar"}')
        # an empty alt marks the picture decorative
        self.assertIn("::alt[]", anc.figure_block("mapa", None, labels, {"alt": ""}))

    def test_cli_on_pdf(self):
        import contextlib

        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "m.pdf"
            make_pdf(pdf)
            strings = Path(tmp) / "fr.json"
            strings.write_text(json.dumps({"NORTH LAND": "TERRE DU NORD"}))
            with contextlib.redirect_stdout(io.StringIO()):
                anc.main([str(pdf), "--page", "1", "--box", "20,175,200,265", "--id", "carte", "--lang", "en",
                          "--strings", f"fr={strings}", "--out", tmp])
            data = json.loads((Path(tmp) / "anchors.json").read_text())
            self.assertEqual([a["id"] for a in data["anchors"]], ["north-land", "blue-bay"])
            fr = (Path(tmp) / "figure.fr.md").read_text()
            self.assertIn('::label[TERRE DU NORD]{at="north-land"}', fr)
            self.assertEqual(data["untranslated"]["fr"], ["Blue Bay"])


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class DedupeTest(unittest.TestCase):
    TOL = {"geom": 3, "dim": 0.5, "padding": 1.5, "font": 0.25, "delta_e": 3}

    def test_delta_e_and_names(self):
        self.assertAlmostEqual(td.delta_e("#808080", "#808080"), 0.0)
        self.assertGreater(td.delta_e("#000000", "#ffffff"), 99)
        self.assertLess(td.delta_e("#d4e8f7", "#d5e8f8"), 1.0)
        self.assertEqual(td.colour_name("#ffffff"), "white")
        self.assertEqual(td.colour_name("#d4e8f7"), "light-blue")
        self.assertEqual(td.colour_name("#619f45"), "green")

    def style(self, sid, bg, pad=3.0):
        return {"id": sid, "backgroundEnabled": True, "background": {"hex": bg, "model": "hex"},
                "border": {"enabled": False}, "padding": {"top": {"value": pad, "unit": "mm"}},
                "body": {"fontFamily": "Sans", "fontSize": {"value": 11, "unit": "pt"}}}

    def test_styles_merge_and_rename(self):
        styles = [self.style("box-1", "#d4e8f7"), self.style("box-2", "#d5e9f7", pad=4.0), self.style("box-3", "#f0c000")]
        kept, mapping, merges = td.dedupe_styles(styles, "calloutStyles", {"box-1": 3, "box-2": 1}, self.TOL)
        self.assertEqual(len(kept), 2)
        self.assertEqual(mapping["box-1"], mapping["box-2"])
        self.assertEqual(mapping["box-1"], "box-light-blue")
        self.assertEqual(merges[0]["from"], ["box-1", "box-2"])

    def frame(self, name, x, y, w=100, h=None, style=None):
        f = {"name": name, "placement": {"anchor": {"to": "container", "edge": "top-left"},
                                         "offset": {"x": {"value": x, "unit": "mm"}, "y": {"value": y, "unit": "mm"}}},
             "width": {"value": w, "unit": "mm"}}
        if h:
            f["minHeight"] = {"value": h, "unit": "mm"}
        if style:
            f["style"] = style
        return f

    def test_templates_share_extend_and_join(self):
        deco = lambda par: {"elements": [{"kind": "text", "id": f"folio-{par}", "parity": par, "content": "{pageNumber}",  # noqa: E731
                                          "placement": {"anchor": {"to": "page", "edge": "top-left"}}}]}
        t1 = {"id": "p01", "frames": [self.frame("title", 10, 10), self.frame("box-1", 10, 40, h=30, style="b")],
              "decoration": deco("odd")}
        t2 = {"id": "p02", "frames": [self.frame("title", 11.5, 10), self.frame("box-1", 10, 41, h=31, style="b")],
              "decoration": deco("even")}
        t3 = {"id": "p03", "frames": [self.frame("title", 10, 10), self.frame("box-1", 10, 40, h=30, style="b"),
                                      self.frame("picture-1", 120, 40, w=60)], "decoration": deco("odd")}
        out, mapping, report = td.dedupe_templates([t1, t2, t3], {}, 3.0, 2)
        shared = [t for t in out if not t.get("extends")]
        self.assertEqual(mapping["p01"], mapping["p02"])
        base = next(t for t in shared if t["id"] == mapping["p01"])
        self.assertEqual({e["id"] for e in base["decoration"]["elements"]}, {"folio-odd", "folio-even"})
        child = next(t for t in out if t["id"] == mapping["p03"])
        self.assertEqual(child["extends"], base["id"])
        self.assertEqual([f["name"] for f in child["frames"]], ["picture-1"])
        self.assertEqual(base["id"], "title-box")

    def test_patch_removes_missing_frame(self):
        base = {"id": "a", "frames": [self.frame("title", 10, 10), self.frame("box-1", 10, 40), self.frame("box-2", 10, 80)]}
        child = {"id": "b", "frames": [self.frame("title", 10, 10), self.frame("box-1", 10, 60)]}
        patch = td.patch_of(child, base, 3.0)
        self.assertIn({"name": "box-2", "remove": True}, patch["frames"])
        moved = next(f for f in patch["frames"] if f["name"] == "box-1")
        self.assertEqual(moved["placement"]["offset"]["y"]["value"], 60)
        self.assertNotIn("width", moved)

    def test_image_distance_sees_a_thin_difference(self):
        # two pages mostly white paper: a thin drawing elsewhere is a difference, noise is not
        a = Image.new("RGB", (512, 512), "white")
        b = a.copy()
        for x in range(60, 400):
            b.putpixel((x, 300), (0, 0, 0))
            b.putpixel((x, 301), (0, 0, 0))
        self.assertEqual(td.image_distance(a, b), 255.0)
        c = a.copy()
        for x in range(0, 512, 7):
            c.putpixel((x, 5), (230, 230, 230))
        self.assertLess(td.image_distance(a, c), 1.0)
        self.assertEqual(td.image_distance(a, a.resize((256, 256))), 255.0)

    def test_rewrite_markdown(self):
        md = '::::page{template="p01" ground="g2"}\nA :mark[word]{style="mark-1"} here.\n::::\n'
        out = td.rewrite_markdown(md, {"p01": "kind-a"}, {"ground": {"g2": "g1"}}, {"mark-1": "mark-yellow"})
        self.assertIn('template="kind-a" ground="g1"', out)
        self.assertIn(':mark[word]{style="mark-yellow"}', out)


if __name__ == "__main__":
    unittest.main()
