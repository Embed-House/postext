"""Tests of the grid and module folding of `template_dedupe.py`
(`template_fold.py`): invented pages written as `pdf_regions.py extract`
writes them (one template per page, frames named by kind and order, the
measured boxes in regions.json), no PDF.

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests

With POSTEXT_REPO set to a Postext checkout with built dists, the folded
draft is laid out before and after with render.mjs and every frame box is
compared; with POSTEXT_CLI set, `postext check` must find no unknown
anchors, slots or templates in it.
"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import os
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import template_dedupe as td  # noqa: E402
import template_fold as tf  # noqa: E402

TOL = {"geom": 3, "dim": 0.5, "padding": 1.5, "font": 0.25, "delta_e": 3, "lattice": 1.0, "grid_min": 3}


def mm(v: float) -> dict:
    return {"value": v, "unit": "mm"}


def at(x: float, y: float, to: str = "container", edge: str = "top-left") -> dict:
    return {"anchor": {"to": to, "edge": edge}, "offset": {"x": mm(x), "y": mm(y)}}


def style(sid: str, fill: str, tab: bool = False) -> dict:
    st = {"id": sid, "backgroundEnabled": True, "background": {"hex": fill, "model": "hex"},
          "border": {"enabled": False}, "borderRadius": mm(1.0),
          "padding": {"top": mm(2), "right": mm(2), "bottom": mm(2), "left": mm(2)},
          "body": {"fontFamily": "Inter", "fontSize": {"value": 10, "unit": "pt"}, "lineHeight": mm(4.5),
                   "color": {"hex": "#222222", "model": "hex"}, "fontWeight": 400, "textAlign": "left"}}
    if tab:
        st["label"] = {"background": {"hex": "#ffffff", "model": "hex"}}
    return st


def folio() -> dict:
    return {"kind": "text", "id": "folio", "content": "{pageNumber}",
            "placement": {**at(100, 285, "page"), "size": {"width": mm(10)}}, "fontSize": {"value": 9, "unit": "pt"}}


def frame(name, x, y, w, kind="box", **more):
    f = {"name": name, "placement": at(x, y), "width": mm(w)}
    f.update(more)
    return f


# --- the grid page: six photos on a 3 x 2 lattice, a caption pill under each --

def grid_page(tid: str = "p01"):
    frames = [frame("text", 15, 15, 180, flow=True, minHeight=mm(30), style="text-1")]
    regions = [{"name": "text", "kind": "text", "box": [15, 15, 195, 45], "parent": None}]
    md = [f'::::page{{template="{tid}"}}', "", "Some words about the photos below.", ""]
    k = 0
    for row, y in enumerate((55, 110)):
        for col, x in enumerate((15, 77, 139)):
            k += 1
            frames.append(frame(f"picture-{k}", x, y, 56))
            frames.append(frame(f"box-{k}", x + 8, y + 37, 40, minHeight=mm(8), style="box-1"))
            regions.append({"name": f"picture-{k}", "kind": "picture", "box": [x, y, x + 56, y + 35], "parent": None})
            regions.append({"name": f"box-{k}", "kind": "box", "box": [x + 8, y + 37, x + 48, y + 45], "parent": None})
    for k in range(1, 7):
        md += [f'::resource{{id="{tid}-picture-{k}" slot="picture-{k}"}}', "",
               f':::frame{{slot="box-{k}"}}', f"Caption number {k}", ":::", ""]
    md += ["::::", ""]
    t = {"id": tid, "area": "trim", "header": False, "footer": False, "frames": frames,
         "decoration": {"elements": [folio()]}}
    return t, {"page": 1, "frames": regions}, "\n".join(md)


# --- a page with two bands under its text: a box holding a photo and a note,
#     then two boxes side by side joined by a line ---------------------------

def band_page(tid: str, words: str, shift: float = 0.0):
    frames = [
        frame("text", 15, 15, 180, flow=True, minHeight=mm(40), style="text-1"),
        frame("box-1", 15, 70 + shift, 180, minHeight=mm(50), style="box-blue"),
        {"name": "picture-1", "placement": at(5, 10, "#box-1"), "layer": 2, "width": mm(50)},
        {"name": "box-2", "placement": at(65, 10, "#box-1"), "layer": 2, "width": mm(100), "minHeight": mm(20),
         "style": "box-white"},
        frame("box-3", 15, 130 + shift, 80, minHeight=mm(30), style="box-white"),
        frame("box-4", 115, 130 + shift, 80, minHeight=mm(30), style="box-white"),
    ]
    regions = [
        {"name": "text", "kind": "text", "box": [15, 15, 195, 55], "parent": None},
        {"name": "box-1", "kind": "box", "box": [15, 70 + shift, 195, 120 + shift], "parent": None},
        {"name": "picture-1", "kind": "picture", "box": [20, 80 + shift, 70, 111.25 + shift], "parent": "box-1"},
        {"name": "box-2", "kind": "box", "box": [80, 80 + shift, 180, 100 + shift], "parent": "box-1"},
        {"name": "box-3", "kind": "box", "box": [15, 130 + shift, 95, 160 + shift], "parent": None},
        {"name": "box-4", "kind": "box", "box": [115, 130 + shift, 195, 160 + shift], "parent": None},
    ]
    deco = [
        {"kind": "connector", "id": "connector-1", "routing": "straight", "from": {"to": "#box-3", "side": "right"},
         "to": {"to": "#box-4", "side": "left"}, "color": {"hex": "#666666", "model": "hex"}, "width": {"value": 0.5, "unit": "pt"}},
        # a mark painted at a fixed place inside the second band
        {"kind": "path", "id": "shape-1", "placement": {**at(100, 140 + shift, "page"), "size": {"width": mm(10), "height": mm(10)}},
         "d": "M0 0 L10 0 L10 10 Z", "viewBox": [10, 10], "fill": {"hex": "#cc3333", "model": "hex"}},
        folio(),
    ]
    md = "\n".join([
        f'::::page{{template="{tid}"}}', "", f"{words} at the head of the page.", "",
        ':::frame{slot="box-1"}', f"{words} in the blue box.", ":::", "",
        f'::resource{{id="{tid}-picture-1" slot="picture-1"}}', "",
        ':::frame{slot="box-2"}', f"A note on {words}.", ":::", "",
        ':::frame{slot="box-3"}', f"{words}: the cause.", ":::", "",
        ':::frame{slot="box-4"}', f"{words}: the effect.", ":::", "", "::::", ""])
    t = {"id": tid, "area": "trim", "header": False, "footer": False, "frames": frames,
         "decoration": {"elements": deco}}
    return t, {"page": 1, "frames": regions}, md


def fold(pages, **kw):
    templates = [copy.deepcopy(p[0]) for p in pages]
    regions = [p[1] for p in pages]
    mds = ["\n".join(p[2] for p in pages)]
    rep = tf.fold_book(templates, regions, mds, TOL, td.frame_diff, td.element_diff, td._group_equal, **kw)
    return templates, mds[0], rep


class GridTest(unittest.TestCase):
    def test_photos_with_pills_on_a_lattice_are_one_grid(self):
        templates, md, rep = fold([grid_page()], modules=False)
        self.assertEqual(len(rep["grids"]), 1)
        g = rep["grids"][0]
        self.assertEqual((g["columns"], g["rows"], g["items"]), (3, 2, 6))
        t = templates[0]
        grid = next(x for x in t["groups"] if x.get("kind") == "grid")
        self.assertEqual(grid["repeat"]["frames"], ["grid-picture", "grid-box"])
        self.assertAlmostEqual(grid["columnGap"]["value"], 6.0, places=1)
        self.assertAlmostEqual(grid["rowGap"]["value"], 10.0, places=1)
        self.assertEqual(grid["placement"]["offset"]["x"]["value"], 15)
        self.assertEqual(grid["placement"]["offset"]["y"]["value"], 55)
        names = [f["name"] for f in t["frames"]]
        self.assertEqual(names, ["text", "grid-picture", "grid-box"])
        pill = t["frames"][2]
        # the pill hangs under its photo as the source draws it
        self.assertEqual(pill["placement"]["anchor"], {"to": "#grid-picture", "edge": "below"})
        self.assertEqual((pill["placement"]["offset"]["x"]["value"], pill["placement"]["offset"]["y"]["value"]), (8, 2))
        self.assertNotIn("width", t["frames"][1])
        # one item per card in reading order, the pill inside it
        self.assertEqual(md.count(':::frame{slot="grid-picture"}'), 6)
        self.assertEqual(md.count(':::frame{slot="grid-box"}'), 6)
        self.assertNotIn('slot="picture-', md)
        first = md.index(':::frame{slot="grid-picture"}')
        self.assertLess(md.index('::resource{id="p01-picture-1"}'), md.index("Caption number 1"))
        self.assertLess(first, md.index("Caption number 1"))
        self.assertLess(md.index("Caption number 3"), md.index('::resource{id="p01-picture-4"}'))
        self.assertEqual(rep["names"]["p01"]["picture-4"], "grid-picture[4]")
        self.assertEqual(rep["names"]["p01"]["box-6"], "grid-box[6]")

    def test_tabs_of_their_words_width_are_centred_over_their_photo(self):
        t, reg, md = grid_page()
        # the pills above the photos, centred, as wide as their words
        widths = [30, 39, 30, 34, 30, 30]
        for k, w in enumerate(widths, start=1):
            p = next(f for f in reg["frames"] if f["name"] == f"picture-{k}")["box"]
            cx = (p[0] + p[2]) / 2
            b = next(f for f in reg["frames"] if f["name"] == f"box-{k}")
            b["box"] = [cx - w / 2, p[1] - 10, cx + w / 2, p[1] - 2]
            f = next(f for f in t["frames"] if f["name"] == f"box-{k}")
            f["placement"] = at(cx - w / 2, p[1] - 10)
            f["width"] = mm(w)
        templates, _, rep = fold([(t, reg, md)], modules=False)
        pill = next(f for f in templates[0]["frames"] if f["name"] == "grid-box")
        self.assertEqual(pill["placement"]["anchor"], {"to": "#grid-picture", "edge": "top"})
        self.assertEqual(pill["width"], "auto")
        self.assertEqual(pill["minWidth"]["value"], 30)
        self.assertAlmostEqual(pill["placement"]["offset"]["y"]["value"], -10)
        grid = next(x for x in templates[0]["groups"] if x.get("kind") == "grid")
        # the grid's box starts at the pills of the first row
        self.assertEqual(grid["placement"]["offset"]["y"]["value"], 45)

    def test_cards_with_another_frame_among_them_are_no_lattice(self):
        t, reg, md = grid_page()
        # a badge between two photos of the second row, hanging from none
        t["frames"].append(frame("box-9", 68, 120, 14, minHeight=mm(6), style="box-2"))
        reg["frames"].append({"name": "box-9", "kind": "box", "box": [68, 120, 82, 126], "parent": None})
        self.assertEqual(fold([(t, reg, md)], modules=False)[2]["grids"], [])

    def test_off_the_lattice_or_uneven_heights_are_left_alone(self):
        t, reg, md = grid_page()
        b = next(f for f in reg["frames"] if f["name"] == "picture-5")
        b["box"] = [b["box"][0], b["box"][1] + 3, b["box"][2], b["box"][3] + 3]
        got = fold([(t, reg, md)], modules=False)[2]["grids"]
        # the photos are off the lattice; the pills, still on it, are a grid
        # of their own and the photos keep their places
        self.assertEqual([(g["columns"], g["rows"], g["frames"]) for g in got], [(3, 2, ["grid-box"])])

    def test_what_hung_from_a_row_of_cards_hangs_from_the_last_row(self):
        t, reg, md = grid_page()
        t["groups"] = [{"name": "row-1", "kind": "row", "frames": ["picture-1", "picture-2", "picture-3"]}]
        t["frames"].append({"name": "text-2", "placement": at(0, 4, "#row-1", "below"), "width": mm(100),
                            "style": "text-1"})
        reg["frames"].append({"name": "text-2", "kind": "text", "box": [15, 94, 115, 100], "parent": None})
        # (placed under the first row: not among the cards of the lattice's
        # second row; leave the lattice one row)
        templates, _, _ = fold([(t, reg, md)], modules=False)
        t2 = next(f for f in templates[0]["frames"] if f["name"] == "text-2")
        self.assertRegex(t2["placement"]["anchor"]["to"], r"^#grid-picture\[\d\]$")
        self.assertFalse(any(g["name"] == "row-1" for g in templates[0]["groups"]))


class ModuleTest(unittest.TestCase):
    def test_every_band_is_a_module_and_the_page_a_bare_shell(self):
        pages = [band_page("p01", "Rivers"), band_page("p02", "Mountains", shift=4.0)]
        templates, md, rep = fold(pages, grids=False)
        mods = {t["id"]: t for t in templates if t.get("role") == "module"}
        uses = {m["id"]: len(m["uses"]) for m in rep["modules"]}
        # the text and the pair of boxes stand alike on both pages; the box
        # stands 4 mm lower on the second: a module of its own
        self.assertEqual(sorted(uses.values()), [1, 1, 2, 2])
        for page in templates[:2]:
            self.assertEqual(page["frames"], [])
            self.assertEqual(page["groups"], [{"name": "modules", "modules": True, "gap": mm(0),
                                               "placement": {**at(0, 0), "size": {"width": "fill", "height": "fill"}}}])
            # the folio stays on the page
            self.assertEqual([e["id"] for e in page["decoration"]["elements"]], ["folio"])
        text = next(m for m in mods.values() if any(f.get("flow") for f in m["frames"]))
        self.assertEqual(uses[text["id"]], 2)
        self.assertEqual(text["frames"][0]["placement"], at(15, 15))
        boxes = [m for m in mods.values() if any(f["name"] == "picture-1" for f in m["frames"])]
        self.assertEqual(len(boxes), 2)
        box = next(m for m in boxes if m["id"] in rep["names"]["p01"]["box-1"])
        self.assertEqual([f["name"] for f in box["frames"]], ["box-1", "picture-1", "box-2"])
        # its frames stand where the band stood, from the foot of the text
        self.assertEqual(box["frames"][0]["placement"], at(15, 15))
        self.assertEqual(box["frames"][1]["placement"]["anchor"]["to"], "#box-1")
        # a text frame beside a picture keeps the page's ladder (its own pictures only)
        self.assertEqual(box["frames"][0]["fit"], {"scaleImages": False})
        pair = next(m for m in mods.values() if any(e["kind"] == "connector" for e in (m.get("decoration") or {}).get("elements", [])))
        self.assertEqual(uses[pair["id"]], 2)
        conn = next(e for e in pair["decoration"]["elements"] if e["kind"] == "connector")
        self.assertEqual((conn["from"]["to"], conn["to"]["to"]), ("#box-1", "#box-2"))
        # the shape painted inside the band goes with it, placed in the module
        shape = next(e for e in pair["decoration"]["elements"] if e["kind"] == "path")
        self.assertEqual(shape["placement"]["anchor"], {"to": "container", "edge": "top-left"})
        self.assertEqual((shape["placement"]["offset"]["x"]["value"], shape["placement"]["offset"]["y"]["value"]), (100, 20))
        # the Markdown is the modules, the text's module with the words that name no slot
        self.assertEqual(md.count(':::module{template="'), 6)
        self.assertIn(f':::module{{template="{text["id"]}"}}\nRivers at the head of the page.\n:::', md)
        self.assertIn(f':::module{{template="{box["id"]}"}}\n:::frame{{slot="box-1"}}\nRivers in the blue box.', md)
        self.assertIn('::resource{id="p02-picture-1" slot="picture-1"}', md)
        self.assertIn('Mountains: the effect.', md)
        self.assertEqual(rep["names"]["p02"]["box-4"], f"{pair['id']}[1].box-2")

    def test_a_connector_to_a_grid_card_follows_the_renamed_set(self):
        # a page with a second grid: its set `grid-2-picture` is `grid-picture`
        # in the module, and a line that ends on its second card ends on it there
        t = {"id": "p", "frames": [frame("text", 15, 15, 180), {"name": "grid-2-picture", "width": mm(50)}],
             "decoration": {"elements": [
                 {"kind": "connector", "id": "c", "routing": "straight", "from": {"to": "#text", "side": "bottom"},
                  "to": {"to": "#grid-2-picture[2]", "side": "top"}},
                 {"kind": "connector", "id": "d", "routing": "straight", "from": {"to": "#text", "side": "bottom"},
                  "to": {"to": "#grid-2-picture[*]", "side": "top"}}]}}
        tf.retarget(t, {"grid-2-picture": "grid-picture", "text": "text"})
        ends = [e["to"]["to"] for e in t["decoration"]["elements"]]
        self.assertEqual(ends, ["#grid-picture[2]", "#grid-picture[*]"])

    def test_a_box_the_draft_grew_keeps_the_drawn_gap_under_it(self):
        # the draft's measure grew the blue box 6 mm past its drawn foot: the
        # pair under it stands the drawn 10 mm below the box, not 4 mm below
        # the grown foot (a measure that fits the words would lay it higher)
        laid = {"p01": {"box-1": (15, 70, 195, 126), "picture-1": (20, 80, 70, 111.25), "box-2": (80, 80, 180, 100)}}
        templates, md, rep = fold([band_page("p01", "Rivers")], grids=False, laid=laid)
        mods = [t for t in templates if t.get("role") == "module"]
        pair = next(m for m in mods if any(e["kind"] == "connector" for e in (m.get("decoration") or {}).get("elements", [])))
        self.assertEqual(pair["frames"][0]["placement"]["offset"]["y"], mm(10))
        box = next(m for m in mods if any(f["name"] == "picture-1" for f in m["frames"]))
        self.assertEqual(box["frames"][0]["placement"]["offset"]["y"], mm(15))

    def test_a_connector_from_the_text_joins_its_box_to_the_text(self):
        t, reg, md = band_page("p01", "Lakes")
        t["decoration"]["elements"].append({"kind": "connector", "id": "connector-2", "routing": "straight",
                                            "from": {"to": "#text", "side": "bottom"}, "to": {"to": "#box-1", "side": "top"}})
        templates, _, rep = fold([(t, reg, md)], grids=False)
        self.assertEqual([m["frames"] for m in rep["modules"]], [4, 2])
        first = next(m for m in templates if m["id"] == rep["modules"][0]["id"])
        conn = next(e for e in first["decoration"]["elements"] if e["kind"] == "connector")
        self.assertEqual((conn["from"]["to"], conn["to"]["to"]), ("#text-1", "#box-1"))

    def test_furniture_alike_on_every_page_of_a_side_stays_on_the_shell(self):
        def mark(k):
            return {"kind": "path", "id": f"shape-{k}", "placement": {**at(195, 280, "page"), "size": {"width": mm(4), "height": mm(4)}},
                    "d": "M0 0 L4 0 L4 4 Z", "viewBox": [4, 4], "fill": {"hex": "#00aa88", "model": "hex"}}
        pages = []
        for k, tid in enumerate(("p01", "p02", "p03", "p04"), start=1):
            t, reg, md = band_page(tid, "Words")
            folio = next(e for e in t["decoration"]["elements"] if e["id"] == "folio")
            folio["parity"] = "odd" if k % 2 else "even"
            if k % 2:
                t["decoration"]["elements"].insert(0, mark(k))
            pages.append((t, reg, md))
        templates, _, rep = fold(pages, grids=False)
        self.assertGreaterEqual(rep["furniture"], 2)
        odd = templates[0]["decoration"]["elements"]
        self.assertEqual([(e["id"].startswith("furniture-"), e.get("parity")) for e in odd if e["kind"] == "path"],
                         [(True, "odd")])
        self.assertFalse(any(e["kind"] == "path" for e in templates[1]["decoration"]["elements"]))

    def test_markdown_rewrite_renames_slots_inside_a_module(self):
        text = "\n".join(['::::page{template="a"}', ':::module{template="m"}', ':::frame{slot="box-1"}', "x", ":::",
                          ":::", ':::frame{slot="box-1"}', "y", ":::", "::::"])
        out = td.rewrite_markdown(text, {"a": "shell"}, {}, {}, {"shell": {"box-1": "note"}, "m": {"box-1": "card"}})
        self.assertIn('::::page{template="shell"}', out)
        self.assertIn(':::module{template="m"}\n:::frame{slot="card"}', out)
        self.assertIn(':::\n:::frame{slot="note"}\ny', out)

    def test_compare_boxes_reads_the_new_names(self):
        before = {"pages": [{"template": "p01", "frames": {"box-1": [0, 0, 10, 10], "picture-2": [0, 20, 10, 30]}}]}
        after = {"pages": [{"template": "shell", "frames": {"m[1].card": [0, 0.3, 10, 10.3], "grid-picture[2]": [0, 21, 10, 31]}}]}
        names = {"p01": {"frames": {"box-1": "m[1].card", "picture-2": "grid-picture[2]"}}}
        got = td.compare_boxes(before, after, names, 0.5)
        self.assertEqual((got["frames"], got["over"], got["missing"]), (2, 1, 0))
        self.assertEqual(got["pages"][0]["over"][0][:2], ("picture-2", "grid-picture[2]"))


def write_project(root: Path, pages) -> None:
    """A draft as extract writes it: library.json, regions.json,
    resources.json with the photos, chapters/en/01-pages.md."""
    from PIL import Image  # type: ignore

    (root / "resources").mkdir(parents=True)
    (root / "chapters" / "en").mkdir(parents=True)
    res = []
    for t, _, _ in pages:
        for f in t["frames"]:
            if f["name"].startswith("picture"):
                rid = f"{t['id']}-{f['name']}"
                Image.new("RGB", (160, 100), (90, 140, 200)).save(root / "resources" / f"{rid}.png")
                res.append({"id": rid, "typeId": "picture", "kind": "bitmap", "file": f"resources/{rid}.png",
                            "width": 160, "height": 100, "resolution": 72.0, "caption": "", "altText": ""})
    styles = [style("text-1", "#ffffff"), style("box-1", "#f5e6a0"), style("box-blue", "#cfe3f5", tab=True),
              style("box-white", "#ffffff"), style("box-pink", "#f6c4d4"), style("box-sky", "#bfe0f7"),
              style("box-mint", "#c4ecd4")]
    styles[0]["backgroundEnabled"] = False
    lib = {"pageTemplates": [t for t, _, _ in pages], "calloutStyles": styles,
           "suggested": {"page": {"sizePreset": "custom", "width": mm(210), "height": mm(297)}}}
    (root / "library.json").write_text(json.dumps(lib, indent=1), encoding="utf-8")
    (root / "regions.json").write_text(json.dumps([r for _, r, _ in pages], indent=1), encoding="utf-8")
    (root / "resources.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    (root / "chapters" / "en" / "01-pages.md").write_text("\n".join(m for _, _, m in pages), encoding="utf-8")


class FoldDirTest(unittest.TestCase):
    """dedupe_dir end to end on a draft of three pages."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.pages = [grid_page("p01"), band_page("p02", "Rivers"), band_page("p03", "Mountains")]
        cls.before = cls.root / "before"
        write_project(cls.before, cls.pages)
        cls.after = cls.root / "after"
        write_project(cls.after, cls.pages)
        with contextlib.redirect_stdout(io.StringIO()):
            cls.report = td.dedupe_dir(cls.after, TOL, 2, 2.0)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_one_shell_and_the_modules(self):
        lib = json.loads((self.after / "library.json").read_text(encoding="utf-8"))
        mods = [t for t in lib["pageTemplates"] if t.get("role") == "module"]
        shells = [t for t in lib["pageTemplates"] if t.get("role") != "module"]
        self.assertEqual(len(shells), 1)
        self.assertEqual(self.report["after"]["pageTemplates"], 1)
        self.assertEqual(shells[0]["frames"], [])
        # the first page: its text and its grid; the others: text, box and pair, alike
        self.assertEqual(sorted(len(m["uses"]) for m in self.report["modules"]), [1, 1, 2, 2, 2])
        self.assertEqual(self.report["after"]["modules"], len(mods))
        self.assertEqual(self.report["after"]["grids"], 1)
        md = (self.after / "chapters" / "en" / "01-pages.md").read_text(encoding="utf-8")
        fences = [line for line in md.split("\n") if line.startswith("::::page")]
        self.assertEqual(len(set(fences)), 1)
        for m in mods:
            self.assertFalse(m.get("extends"))
        # module frames are named by role in the module, and the Markdown follows
        box = next(m for m in mods if any(f["name"].startswith("picture") for f in m["frames"]))
        names = [f["name"] for f in box["frames"]]
        self.assertNotIn("box-1", names)
        for n in names:
            if not n.startswith("picture"):
                self.assertIn(f'slot="{n}"', md)
        # the names report gives the laid name of every frame
        pages = self.report["pages"]
        self.assertRegex(pages["p02"]["frames"]["box-2"], rf"^{box['id']}\[1\]\.[a-z]")
        self.assertRegex(pages["p01"]["frames"]["picture-2"], r"^module-[\w-]+\[1\]\.grid-picture\[2\]$")

    def test_the_folded_draft_lays_out_as_before(self):
        repo = os.environ.get("POSTEXT_REPO")
        if not repo:
            self.skipTest("POSTEXT_REPO not set")
        import pdf_regions as pr

        frames = {}
        for name, d in (("before", self.before), ("after", self.after)):
            with contextlib.redirect_stdout(io.StringIO()):
                pr.main(["manifest", str(d)])
            out = self.root / f"{name}-frames.json"
            # (exit 1 only says the fixture's face is not bundled)
            run = subprocess.run(["node", str(HERE / "render.mjs"), str(d), "--repo", repo, "--frames", str(out)],
                                 capture_output=True, text=True)
            self.assertTrue(out.exists(), run.stdout[-2000:] + run.stderr[-2000:])
            self.assertNotIn("CONFIG frameAnchorUnknown", run.stdout)
            self.assertNotIn("WARN slot", run.stdout)
            frames[name] = json.loads(out.read_text(encoding="utf-8"))
        got = td.compare_boxes(frames["before"], frames["after"], self.report["pages"], 0.5)
        self.assertEqual(got["missing"], 0, got)
        self.assertEqual(got["over"], 0, [r["over"] for r in got["pages"]])
        self.assertGreater(got["frames"], 15)

    def test_the_folded_draft_checks_clean(self):
        cli = os.environ.get("POSTEXT_CLI")
        if not cli:
            self.skipTest("POSTEXT_CLI not set")
        import pdf_regions as pr

        work = self.root / "checked"
        import shutil

        shutil.copytree(self.after, work)
        with contextlib.redirect_stdout(io.StringIO()):
            pr.main(["manifest", str(work)])
        run = subprocess.run(shlex.split(cli) + ["check", str(work), "--offline", "--json"], capture_output=True, text=True)
        data = json.loads(run.stdout)
        kinds = {w.get("kind") for w in data.get("warnings", [])}
        for bad in ("unknownConfigValue", "unknownConfigKey", "frameAnchorUnknown", "templateUnknown", "slotUnknown",
                    "moduleUnknown", "moduleAsPage", "slotEmpty", "repeatOverflow"):
            self.assertNotIn(bad, kinds, [w for w in data.get("warnings", []) if w.get("kind") == bad][:3])


# --- round 3: a page of modules side by side (#1088), cards in colours of
#     their own (#1089), front matter without the furniture (#1087) ---------

def page_colour() -> dict:
    return {"kind": "box", "id": "page-colour", "style": {"backgroundColor": {"hex": "#eef6f2", "model": "hex"}},
            "placement": {"anchor": {"to": "bleed", "edge": "top-left"}, "size": {"width": "fill", "height": "fill"}}}


def front_page(tid: str, words: str = "A plain page"):
    """A page of front matter: its text, no folio, no page colour."""
    t = {"id": tid, "area": "trim", "header": False, "footer": False,
         "frames": [frame("text", 15, 15, 180, flow=True, minHeight=mm(60), style="text-1")]}
    reg = {"page": 1, "frames": [{"name": "text", "kind": "text", "box": [15, 15, 195, 75], "parent": None}]}
    md = "\n".join([f'::::page{{template="{tid}"}}', "", f"{words}, before the first chapter.", "", "::::", ""])
    return t, reg, md


def row_page(tid: str, words: str):
    """Under the text, a box beside a photo (not in equal halves of the
    page), then two rows of two cards standing in the halves."""
    frames = [frame("text", 15, 15, 180, flow=True, minHeight=mm(40), style="text-1"),
              frame("box-1", 15, 65, 110, minHeight=mm(45), style="box-white"),
              frame("picture-1", 135, 65, 60)]
    regions = [{"name": "text", "kind": "text", "box": [15, 15, 195, 55], "parent": None},
               {"name": "box-1", "kind": "box", "box": [15, 65, 125, 110], "parent": None},
               {"name": "picture-1", "kind": "picture", "box": [135, 65, 195, 102.5], "parent": None}]
    md = [f'::::page{{template="{tid}"}}', "", f"{words} at the head of the page.", "",
          ':::frame{slot="box-1"}', f"{words} in the box beside the photo.", ":::", "",
          f'::resource{{id="{tid}-picture-1" slot="picture-1"}}', ""]
    k = 1
    for y in (120, 160):
        for x, st in ((15, "box-white"), (115, "box-blue")):
            k += 1
            frames.append(frame(f"box-{k}", x, y, 80, minHeight=mm(30), style=st))
            regions.append({"name": f"box-{k}", "kind": "box", "box": [x, y, x + 80, y + 30], "parent": None})
            md += [f':::frame{{slot="box-{k}"}}', f"{words}, card {k - 1}.", ":::", ""]
    md += ["::::", ""]
    t = {"id": tid, "area": "trim", "header": False, "footer": False, "frames": frames,
         "decoration": {"elements": [page_colour(), folio()]}}
    return t, {"page": 1, "frames": regions}, "\n".join(md)


PILLS = ["box-pink", "box-sky", "box-pink", "box-mint", "box-pink", "box-sky"]


def look_grid_page(tid: str = "p01"):
    """The photo wall of `grid_page`, each pill in a colour of its own."""
    t, reg, md = grid_page(tid)
    for k, st in enumerate(PILLS, start=1):
        next(f for f in t["frames"] if f["name"] == f"box-{k}")["style"] = st
    t["decoration"]["elements"].insert(0, page_colour())
    return t, reg, md


def style_lib() -> list[dict]:
    return [style("box-1", "#f5e6a0"), style("box-pink", "#f6c4d4"), style("box-sky", "#bfe0f7"),
            style("box-mint", "#c4ecd4"), style("box-blue", "#cfe3f5", tab=True), style("box-white", "#ffffff")]


class RowTest(unittest.TestCase):
    def test_clusters_side_by_side_are_a_row_and_halves_a_grid(self):
        templates, md, rep = fold([row_page("p01", "Rivers"), row_page("p02", "Hills")])
        self.assertEqual(rep["grids"], [])
        mods = {t["id"]: t for t in templates if t.get("role") == "module"}
        self.assertEqual(sorted(len(m["uses"]) for m in rep["modules"]), [2, 2, 2, 4, 4])
        rows = {r["kind"]: r for r in rep["rows"]}
        self.assertEqual(set(rows), {"row", "grid"})
        # the box and the photo: a row, the box as wide as from the page's start to the photo
        box_mod, pic_mod = (mods[i] for i in rows["row"]["templates"])
        self.assertEqual(box_mod["width"], mm(135))
        self.assertEqual(pic_mod["width"], "fill")
        self.assertEqual(box_mod["frames"][0]["placement"], at(15, 10))
        self.assertEqual(pic_mod["frames"][0]["placement"], at(0, 10))
        # the cards: two rows of the same two modules in the page's halves, one grid
        self.assertEqual(rows["grid"]["columns"], 2)
        white, blue = (mods[i] for i in rows["grid"]["templates"])
        self.assertEqual((white["width"], blue["width"]), (mm(105), mm(105)))
        self.assertEqual(white["frames"][0]["placement"], at(15, 10))
        self.assertEqual(blue["frames"][0]["placement"], at(10, 10))
        for page in templates[:2]:
            self.assertEqual(page["frames"], [])
            stack, row, grid = page["groups"]
            self.assertEqual(stack["name"], "modules")
            self.assertEqual({k: row[k] for k in ("modules", "within", "kind", "templates")},
                             {"modules": True, "within": "modules", "kind": "row",
                              "templates": rows["row"]["templates"]})
            self.assertEqual((grid["kind"], grid["columns"], grid["within"], grid["templates"]),
                             ("grid", 2, "modules", rows["grid"]["templates"]))
        # the Markdown: the modules in order, the cards row by row
        order = [line.split('"')[1] for line in md.split("\n") if line.startswith(":::module{")]
        text = next(i for i in mods if any(f.get("flow") for f in mods[i]["frames"]))
        w, b = rows["grid"]["templates"]
        self.assertEqual(order[:7], [text, *rows["row"]["templates"], w, b, w, b])
        self.assertIn("Hills, card 4.", md)
        self.assertEqual(rep["names"]["p02"]["box-5"], f"{b}[2].box-1")

    def test_rows_that_would_run_together_are_laid_as_one_module(self):
        # the box beside the photo twice, one under the other: the second row
        # of the same modules would join the first in one run, so it stays a band
        t, reg, md = row_page("p01", "Rivers")
        t["frames"] = t["frames"][:3] + [frame("box-6", 15, 120, 110, minHeight=mm(45), style="box-white"),
                                         frame("picture-2", 135, 120, 60)]
        reg["frames"] = reg["frames"][:3] + [
            {"name": "box-6", "kind": "box", "box": [15, 120, 125, 165], "parent": None},
            {"name": "picture-2", "kind": "picture", "box": [135, 120, 195, 157.5], "parent": None}]
        templates, _, rep = fold([(t, reg, md)])
        self.assertEqual([(r["kind"], len(r["templates"])) for r in rep["rows"]], [("row", 2)])
        whole = [m for m in rep["modules"] if m["frames"] == 2]
        self.assertEqual(len(whole), 1)

    def test_no_rows_keeps_one_module_per_band(self):
        _, _, rep = fold([row_page("p01", "Rivers")], rows=False)
        self.assertEqual(rep["rows"], [])
        # the text, the box with its photo, the pair of cards (both rows alike)
        self.assertEqual(sorted((m["frames"], len(m["uses"])) for m in rep["modules"]), [(1, 1), (2, 1), (2, 2)])


class LookTest(unittest.TestCase):
    def test_pills_in_colours_of_their_own_are_one_grid_with_looks(self):
        book = td.look_book(style_lib(), TOL)
        templates, md, rep = fold([look_grid_page()], modules=False, looks=book)
        self.assertEqual(len(rep["grids"]), 1)
        g = rep["grids"][0]
        self.assertEqual((g["columns"], g["rows"], g["items"]), (3, 2, 6))
        pill = next(f for f in templates[0]["frames"] if f["name"] == "grid-box")
        self.assertEqual(pill["style"], "box-pink")
        looks = {e["id"]: e for e in rep["frameLooks"]}
        self.assertEqual(len(looks), 2)
        self.assertEqual(sorted(e["background"]["hex"] for e in looks.values()), ["#bfe0f7", "#c4ecd4"])
        for e in looks.values():
            self.assertEqual(set(e), {"id", "background"})
        sky = next(i for i, e in looks.items() if e["background"]["hex"] == "#bfe0f7")
        mint = next(i for i, e in looks.items() if e["background"]["hex"] == "#c4ecd4")
        items = md.split(':::frame{slot="grid-picture"}')[1:]
        self.assertEqual(len(items), 6)
        want = [None, sky, None, mint, None, sky]
        for k, (item, look) in enumerate(zip(items, want), start=1):
            self.assertIn(f"Caption number {k}", item)
            if look:
                self.assertIn(f':::frame{{slot="grid-box" look="{look}"}}', item)
            else:
                self.assertIn(':::frame{slot="grid-box"}', item)

    def test_a_pill_between_two_rows_hangs_over_its_own_photo(self):
        # pills 6.1 mm over each photo; the second row's pills stand 6.2 mm
        # under the first row's photos, so they hang from both
        t, reg, md = grid_page()
        tops = {1: 55.0, 2: 110.3}
        for k in range(1, 7):
            row = 1 if k <= 3 else 2
            p = next(f for f in reg["frames"] if f["name"] == f"picture-{k}")
            p["box"] = [p["box"][0], tops[row], p["box"][2], tops[row] + 35]
            next(f for f in t["frames"] if f["name"] == f"picture-{k}")["placement"] = at(p["box"][0], tops[row])
            b = next(f for f in reg["frames"] if f["name"] == f"box-{k}")
            b["box"] = [p["box"][0] + 8, tops[row] - 14.1, p["box"][0] + 48, tops[row] - 6.1]
            next(f for f in t["frames"] if f["name"] == f"box-{k}")["placement"] = at(b["box"][0], b["box"][1])
        templates, _, rep = fold([(t, reg, md)], modules=False)
        self.assertEqual([(g["columns"], g["rows"], g["frames"]) for g in rep["grids"]],
                         [(3, 2, ["grid-picture", "grid-box"])])
        pill = next(f for f in templates[0]["frames"] if f["name"] == "grid-box")
        self.assertEqual(pill["placement"]["anchor"], {"to": "#grid-picture", "edge": "top-left"})

    def test_photos_of_their_own_widths_are_no_centred_members(self):
        # tabs on a lattice, a photo under each, centred but of other widths:
        # a picture has no width of its words, so the photos are no members
        t, reg, md = grid_page()
        for k, w in enumerate([56, 40, 56, 48, 56, 36], start=1):
            p = next(f for f in reg["frames"] if f["name"] == f"picture-{k}")
            cx = (p["box"][0] + p["box"][2]) / 2
            p["box"] = [cx - w / 2, p["box"][1], cx + w / 2, p["box"][3]]
        _, _, rep = fold([(t, reg, md)], modules=False)
        self.assertFalse(any("grid-picture" in g["frames"][1:] for g in rep["grids"]))

    def test_without_looks_the_pills_are_no_grid(self):
        _, _, rep = fold([look_grid_page()], modules=False)
        self.assertEqual([g["frames"] for g in rep["grids"]], [["grid-picture"]])

    def test_a_look_carries_colours_only(self):
        a, b = style("box-pink", "#f6c4d4"), style("box-sky", "#bfe0f7")
        b["body"]["color"] = {"hex": "#003366", "model": "hex"}
        self.assertEqual(td.colour_look(a, b, TOL), {"background": {"hex": "#bfe0f7", "model": "hex"},
                                                    "body": {"color": {"hex": "#003366", "model": "hex"}}})
        self.assertEqual(td.colour_look(a, a, TOL), {})
        c = style("box-wide", "#bfe0f7")
        c["padding"]["left"] = mm(6)
        self.assertIsNone(td.colour_look(a, c, TOL))
        self.assertEqual(td.style_class(a), td.style_class(b))
        self.assertNotEqual(td.style_class(a), td.style_class(c))


class ShellTest(unittest.TestCase):
    def shell(self, tid, deco):
        return {"id": tid, "area": "trim", "header": False, "footer": False, "frames": [],
                "groups": [{"name": "modules", "modules": True}], **({"decoration": {"elements": deco}} if deco else {})}

    def test_front_matter_without_the_furniture_is_the_same_shell(self):
        body = self.shell("page-2", [page_colour(), folio()])
        front = self.shell("page", [])
        out, mapping, flags, rep = td.merge_furniture_shells([front, body], ["page"] * 3 + ["page-2"] * 5, 3)
        self.assertEqual([t["id"] for t in out], ["page-2"])
        self.assertEqual(mapping, {"page": "page-2"})
        self.assertEqual(flags, {"page": ["frontmatter"]})
        self.assertEqual([e.get("unless") for e in out[0]["decoration"]["elements"]], ["frontmatter", "frontmatter"])

    def test_a_band_only_some_pages_draw_is_drawn_when_they_say(self):
        band = {"kind": "path", "id": "band", "placement": {**at(0, 0, "page"), "size": {"width": mm(210), "height": mm(20)}},
                "d": "M0 0 L10 0 L10 2 L0 2 Z", "viewBox": [10, 2], "fill": {"hex": "#cc3333", "model": "hex"}}
        plain = self.shell("page", [folio()])
        banded = self.shell("page-2", [band, folio()])
        out, mapping, flags, _ = td.merge_furniture_shells([plain, banded], ["page", "page", "page-2", "page", "page"], 3)
        self.assertEqual(mapping, {"page-2": "page"})
        self.assertEqual(flags, {"page-2": ["variant-1"]})
        els = out[0]["decoration"]["elements"]
        self.assertEqual([(e["id"], e.get("when")) for e in els], [("band", "variant-1"), ("folio", None)])

    def test_shells_that_differ_in_a_shared_element_stay_apart(self):
        moved = folio()
        moved["placement"]["offset"]["x"] = mm(150)
        out, mapping, _, _ = td.merge_furniture_shells([self.shell("a", [folio()]), self.shell("b", [moved])],
                                                       ["a", "b"], 3)
        self.assertEqual((len(out), mapping), (2, {}))

    def test_fences_carry_the_attribute(self):
        text = '::::page{template="p01"}\nWords\n::::\n::::page{template="p02" ground="g"}\nMore\n::::'
        out = td.rewrite_markdown(text, {"p01": "page", "p02": "page"}, {}, {}, None, {"p01": ["frontmatter"]})
        self.assertIn('::::page{template="page" frontmatter}', out)
        self.assertIn('::::page{template="page" ground="g"}', out)
        # run again: written once
        line = '::::page{template="page" frontmatter}'
        self.assertEqual(td.rewrite_markdown(line, {}, {}, {}, None, {"page": ["frontmatter"]}), line)


class Round3DirTest(unittest.TestCase):
    """dedupe_dir end to end: front matter, two pages of rows, a photo wall in colours."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.pages = [front_page("p01"), row_page("p02", "Rivers"), row_page("p03", "Hills"), look_grid_page("p04")]
        cls.before = cls.root / "before"
        write_project(cls.before, cls.pages)
        cls.after = cls.root / "after"
        write_project(cls.after, cls.pages)
        with contextlib.redirect_stdout(io.StringIO()):
            cls.report = td.dedupe_dir(cls.after, TOL, 2, 2.0)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_one_shell_rows_and_looks(self):
        lib = json.loads((self.after / "library.json").read_text(encoding="utf-8"))
        shells = [t for t in lib["pageTemplates"] if t.get("role") != "module"]
        self.assertEqual(len(shells), 1)
        els = shells[0]["decoration"]["elements"]
        self.assertEqual({e.get("unless") for e in els}, {"frontmatter"})
        md = (self.after / "chapters" / "en" / "01-pages.md").read_text(encoding="utf-8")
        fences = [line for line in md.split("\n") if line.startswith("::::page")]
        self.assertEqual(fences[0], f'::::page{{template="{shells[0]["id"]}" frontmatter}}')
        self.assertEqual(set(fences[1:]), {f'::::page{{template="{shells[0]["id"]}"}}'})
        self.assertEqual(sorted(r["kind"] for r in self.report["rows"]), ["grid", "row"])
        self.assertEqual(len(lib["frameLooks"]), 2)
        for look in lib["frameLooks"]:
            self.assertEqual(md.count(f'look="{look["id"]}"'), 2 if "#bfe0f7" in json.dumps(look) else 1)

    def test_the_folded_draft_lays_out_as_before(self):
        repo = os.environ.get("POSTEXT_REPO")
        if not repo:
            self.skipTest("POSTEXT_REPO not set")
        import pdf_regions as pr

        frames = {}
        for name, d in (("before", self.before), ("after", self.after)):
            with contextlib.redirect_stdout(io.StringIO()):
                pr.main(["manifest", str(d)])
            out = self.root / f"{name}-frames.json"
            run = subprocess.run(["node", str(HERE / "render.mjs"), str(d), "--repo", repo, "--frames", str(out)],
                                 capture_output=True, text=True)
            self.assertTrue(out.exists(), run.stdout[-2000:] + run.stderr[-2000:])
            self.assertNotIn("CONFIG", run.stdout)
            self.assertNotIn("WARN slot", run.stdout)
            frames[name] = json.loads(out.read_text(encoding="utf-8"))
        got = td.compare_boxes(frames["before"], frames["after"], self.report["pages"], 0.5)
        self.assertEqual(got["missing"], 0, got)
        self.assertEqual(got["over"], 0, [r["over"] for r in got["pages"]])
        self.assertGreater(got["frames"], 25)

    def test_the_folded_draft_checks_clean(self):
        cli = os.environ.get("POSTEXT_CLI")
        if not cli:
            self.skipTest("POSTEXT_CLI not set")
        import shutil

        import pdf_regions as pr

        work = self.root / "checked"
        shutil.copytree(self.after, work)
        with contextlib.redirect_stdout(io.StringIO()):
            pr.main(["manifest", str(work)])
        run = subprocess.run(shlex.split(cli) + ["check", str(work), "--offline", "--json"], capture_output=True, text=True)
        data = json.loads(run.stdout)
        kinds = {w.get("kind") for w in data.get("warnings", [])}
        for bad in ("unknownConfigValue", "unknownConfigKey", "frameAnchorUnknown", "templateUnknown", "slotUnknown",
                    "moduleUnknown", "moduleAsPage", "slotEmpty", "repeatOverflow", "lookUnknown", "conditionNeverMet"):
            self.assertNotIn(bad, kinds, [w for w in data.get("warnings", []) if w.get("kind") == bad][:3])


# --- #1095: what the round-3 port still curated by hand --------------------

def chained_row_page(tid: str, words: str):
    """Under the text, a box and a photo side by side, each anchored `below`
    the text as extract anchors a frame to the one over it on the card."""
    frames = [frame("text", 15, 15, 180, flow=True, minHeight=mm(40), style="text-1"),
              {"name": "box-1", "placement": at(0, 10, "#text", "below"), "width": mm(110), "minHeight": mm(45),
               "style": "box-white"},
              {"name": "picture-1", "placement": at(120, 10, "#text", "below"), "width": mm(60)}]
    regions = [{"name": "text", "kind": "text", "box": [15, 15, 195, 55], "parent": None},
               {"name": "box-1", "kind": "box", "box": [15, 65, 125, 110], "parent": None},
               {"name": "picture-1", "kind": "picture", "box": [135, 65, 195, 102.5], "parent": None}]
    md = "\n".join([f'::::page{{template="{tid}"}}', "", f"{words} at the head of the page.", "",
                    ':::frame{slot="box-1"}', f"{words} in the box beside the photo.", ":::", "",
                    f'::resource{{id="{tid}-picture-1" slot="picture-1"}}', "", "::::", ""])
    t = {"id": tid, "area": "trim", "header": False, "footer": False, "frames": frames,
         "decoration": {"elements": [folio()]}}
    return t, {"page": 1, "frames": regions}, md


def ornament(eid: str, head: str, dx: float) -> dict:
    return {"kind": "path", "id": eid, "parity": "odd", "when": "head", "d": "M0 0 L3 1.5 L0 3 Z", "viewBox": [3, 3],
            "fill": {"hex": "#00a88e", "model": "hex"},
            "placement": {"anchor": {"to": f"#{head}", "edge": "left-of"}, "offset": {"x": mm(dx), "y": mm(1)},
                          "size": {"width": mm(3), "height": mm(3)}}}


def head_page(tid: str, words: str):
    """A body page whose running head has two chevrons anchored before it,
    as extract writes them (#1095)."""
    t, reg, md = band_page(tid, words)
    head = {"kind": "text", "id": "head-odd", "parity": "odd", "content": "{attr.head}", "align": "right",
            "fontSize": {"value": 9, "unit": "pt"},
            "placement": {"anchor": {"to": "page", "edge": "top-right"}, "offset": {"x": mm(-15), "y": mm(7)}}}
    els = t["decoration"]["elements"]
    els[-1]["parity"] = "odd"
    els += [head, ornament("head-odd-ornament-1", "head-odd", -2.7), ornament("head-odd-ornament-2", "head-odd", -7.8)]
    md = md.replace(f'::::page{{template="{tid}"}}', f'::::page{{template="{tid}" head="{words.upper()}"}}')
    return t, reg, md


class LimitsTest(unittest.TestCase):
    def test_frames_chained_below_the_text_still_stand_side_by_side_as_a_row(self):
        templates, md, rep = fold([chained_row_page("p01", "Rivers"), chained_row_page("p02", "Hills")])
        self.assertEqual([(r["kind"], len(r["templates"])) for r in rep["rows"]], [("row", 2)])
        mods = {t["id"]: t for t in templates if t.get("role") == "module"}
        box_mod, pic_mod = (mods[i] for i in rep["rows"][0]["templates"])
        # the anchor to the text, now in another module, is the frame's laid place
        self.assertEqual(box_mod["frames"][0]["placement"], at(15, 10))
        self.assertEqual(pic_mod["frames"][0]["placement"], at(0, 10))
        order = [line.split('"')[1] for line in md.split("\n") if line.startswith(":::module{")]
        self.assertEqual(len(order), 6)

    def test_a_frame_chained_below_another_with_nothing_beside_it_stays_in_its_module(self):
        t, reg, md = chained_row_page("p01", "Rivers")
        t["frames"] = t["frames"][:2]
        t["frames"][1]["width"] = mm(180)
        reg["frames"] = reg["frames"][:2]
        reg["frames"][1]["box"] = [15, 65, 195, 110]
        templates, _, rep = fold([(t, reg, md)])
        self.assertEqual(rep["rows"], [])
        self.assertEqual([m["frames"] for m in rep["modules"]], [2])
        mod = next(x for x in templates if x.get("role") == "module")
        self.assertEqual(mod["frames"][1]["placement"]["anchor"], {"to": "#text-1", "edge": "below"})

    def test_ornaments_anchored_to_the_running_head_stay_on_the_shell_with_it(self):
        templates, _, rep = fold([head_page("p01", "Rivers"), head_page("p03", "Hills")])
        shell = templates[0]
        els = {e["id"]: e for e in shell["decoration"]["elements"]}
        heads = [e for e in els.values() if e.get("content") == "{attr.head}"]
        self.assertEqual(len(heads), 1)
        orns = [e for e in els.values() if e.get("kind") == "path" and e.get("when") == "head"]
        self.assertEqual(len(orns), 2)
        for e in orns:
            self.assertEqual(e["placement"]["anchor"], {"to": f'#{heads[0]["id"]}', "edge": "left-of"})
        for m in (t for t in templates if t.get("role") == "module"):
            for e in (m.get("decoration") or {}).get("elements", []):
                self.assertNotIn("#head", json.dumps(e.get("placement")))
                self.assertNotIn(heads[0]["id"], json.dumps(e.get("placement")))

    def test_a_shell_merge_keeps_the_ornaments_drawn_with_their_head(self):
        sh = ShellTest().shell
        orn = ornament("head-odd-ornament-1", "head-odd", -2.7)
        head = {"kind": "text", "id": "head-odd", "content": "{attr.head}", "parity": "odd",
                "placement": {**at(-15, 7, "page", "top-right")}}
        body = sh("page-2", [page_colour(), head, orn, folio()])
        front = sh("page", [])
        out, mapping, flags, _ = td.merge_furniture_shells([front, body], ["page"] * 2 + ["page-2"] * 6, 3)
        self.assertEqual(mapping, {"page": "page-2"})
        got = {e["id"]: (e.get("when"), e.get("unless")) for e in out[0]["decoration"]["elements"]}
        self.assertEqual(got["head-odd-ornament-1"], ("head", "frontmatter"))
        self.assertEqual(got["head-odd"], (None, "frontmatter"))
        # an ornament only the minority draws would need a second `when`: no merge
        out, mapping, _, _ = td.merge_furniture_shells([sh("page", [head, orn]), sh("page-2", [])],
                                                       ["page"] * 2 + ["page-2"] * 6, 3)
        self.assertEqual(mapping, {})

    def test_looks_are_named_by_the_role_the_book_gives_their_colour(self):
        lib = {"colorPalette": [{"id": "brand", "value": {"hex": "#c4ecd4", "model": "hex"}},
                                {"id": "light-blue", "value": {"hex": "#bfe0f7", "model": "hex"}}],
               "calloutStyles": style_lib() + [style("tip", "#bfe0f7")]}
        roles = td.look_roles(lib, [{"id": "p01", "decoration": {"elements": [page_colour()]}}])
        self.assertIn(("#c4ecd4", "brand"), roles)
        self.assertIn(("#bfe0f7", "tip"), roles)
        self.assertNotIn("light-blue", [r for _, r in roles])     # a colour name is no role
        self.assertNotIn("box-sky", [r for _, r in roles])         # nor an id dedupe made of one
        self.assertIn(("#eef6f2", "page-colour"), roles)
        self.assertEqual(td.look_name({"background": {"hex": "#c4ecd5", "model": "hex"}}, roles), "brand")
        self.assertEqual(td.look_name({"background": {"hex": "#f6c4d4", "model": "hex"}}, roles), td.colour_name("#f6c4d4"))
        book = td.look_book(style_lib(), TOL, roles=roles)
        _, md, rep = fold([look_grid_page()], modules=False, looks=book)
        self.assertEqual(sorted(e["id"] for e in rep["frameLooks"]), ["look-brand", "look-tip"])
        self.assertEqual(md.count('look="look-tip"'), 2)


if __name__ == "__main__":
    unittest.main()
