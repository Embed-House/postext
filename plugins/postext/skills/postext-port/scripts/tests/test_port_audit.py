"""Tests of `port_audit.py` (#1113): a synthetic source PDF, a clean port of
it laid out otherwise (other margins, other line breaks, a real italic for
the source's sheared face) and a port with known gaps.

    python3 -m pytest plugins/postext/skills/postext-port/scripts/tests -q
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

try:
    import fitz  # PyMuPDF
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    HAVE_DEPS = True
except Exception:  # pragma: no cover
    HAVE_DEPS = False

if HAVE_DEPS:
    import port_audit as pa  # noqa: E402

SPACES = {0x20: 250, 0xA0: 250, 0x2002: 500, 0x2003: 1000, 0x2009: 167, 0x202F: 167}


def synth_font(ps_name: str) -> bytes:
    """A TrueType font whose letters are boxes, with real advance widths for
    the plain, no-break, en, em, thin and narrow no-break spaces."""
    fb = FontBuilder(1000, isTTF=True)
    cps = list(range(0x21, 0x7F)) + [0x2022, 0xB0]
    names = [".notdef"] + [f"u{cp:04X}" for cp in cps] + [f"u{cp:04X}" for cp in SPACES]
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({cp: f"u{cp:04X}" for cp in cps + list(SPACES)})
    glyphs, metrics = {}, {}
    for n in names:
        pen = TTGlyphPen(None)
        cp = int(n[1:], 16) if n != ".notdef" else 0
        if cp not in SPACES:
            pen.moveTo((50, 0)); pen.lineTo((50, 700)); pen.lineTo((450, 700)); pen.lineTo((450, 0)); pen.closePath()
        glyphs[n] = pen.glyph()
        metrics[n] = (SPACES.get(cp, 500), 0 if cp in SPACES else 50)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": "Synth", "styleName": ps_name.split("-")[-1], "psName": ps_name})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    buf = io.BytesIO()
    fb.save(buf)
    return buf.getvalue()


FACES = {"reg": "Synth-Regular", "bold": "Synth-Bold", "it": "Synth-Italic"}
GREY, RED, BLACK = (0.5, 0.5, 0.5), (0.8, 0, 0), (0, 0, 0)


class Page:
    """Writes runs of text on lines: (text, face, size, colour, shear)."""

    def __init__(self, doc, width=595, height=842, left=72):
        self.page = doc.new_page(width=width, height=height)
        self.fonts = {k: fitz.Font(fontbuffer=FONT_BYTES[v]) for k, v in FACES.items()}
        for k, v in FACES.items():
            self.page.insert_font(fontname=k, fontbuffer=FONT_BYTES[v])
        self.left = left

    def line(self, y, runs, x=None):
        x = self.left if x is None else x
        for text, face, size, colour, shear in runs:
            pt = fitz.Point(x, y)
            morph = (pt, fitz.Matrix(1, 0, shear, 1, 0, 0)) if shear else None
            self.page.insert_text(pt, text, fontname=face, fontsize=size, color=colour, morph=morph)
            x += self.fonts[face].text_length(text, fontsize=size)
        return x

    def cell(self, rect, text, align, face="reg", size=10):
        r = fitz.Rect(*rect)
        self.page.draw_rect(r, color=BLACK, width=0.5)
        w = self.fonts[face].text_length(text, fontsize=size)
        x = {"left": r.x0 + 4, "right": r.x1 - 4 - w, "centre": (r.x0 + r.x1 - w) / 2}[align]
        self.page.insert_text((x, r.y1 - 6), text, fontname=face, fontsize=size, color=BLACK)


def R(text, face="reg", size=10, colour=BLACK, shear=0.0):
    return (text, face, size, colour, shear)


def build(path: Path, kind: str) -> None:
    """kind: 'source', 'clean' or 'gaps'."""
    doc = fitz.open()
    port = kind != "source"
    gaps = kind == "gaps"
    p = Page(doc, width=560 if port else 595, left=90 if port else 72)
    head = BLACK if gaps else GREY
    p.line(40, [R("Running head", colour=head)])
    p.line(100, [R("Plain words set upright here.")] if not port else [R("Plain words set")])
    if port:
        p.line(114, [R("upright here.")])
    # the source shears an upright face; the clean port sets a real italic
    if port:
        p.line(130, [R("Sheared words lean here.", "reg" if gaps else "it")])
    else:
        p.line(130, [R("Sheared words lean here.", shear=0.25)])
    p.line(150, [R("Bold words stand out.", "reg" if gaps else "bold")])
    if gaps:
        p.line(170, [R("As CERVANTES wrote.")])
    else:
        p.line(170, [R("As "), R("C"), R("ERVANTES", size=7), R(" wrote.")])
    p.line(190, [R("1." + (" " if gaps else " ") + "Title after an en space")])
    if gaps:
        p.line(210, [R("It weighs 37")])
        p.line(224, [R("kg on the scale.")])
    else:
        p.line(210, [R("It weighs 37 kg on the scale.")])
    # bullets: 14 pt against 10 pt items; the port with gaps sets 10 pt and drops the second
    p.line(250, [R("•", size=10 if gaps else 14), R(" First item here")])
    p.line(268, ([R("Second item here")] if gaps else [R("•", size=14), R(" Second item here")]),
           x=p.left + (12 if gaps else 0))
    p.line(282, [R("•", "bold" if gaps else "reg", size=14), R(" Third item here")])
    p.line(300, [R("Red words in the text.", colour=BLACK if gaps else RED)])
    # a ruled table
    y = 320
    p.cell((p.left, y, p.left + 120, y + 20), "Name", "left", "bold")
    p.cell((p.left + 120, y, p.left + 240, y + 20), "Value", "left" if gaps else "centre", "bold")
    p.cell((p.left, y + 20, p.left + 120, y + 40), "alpha", "left")
    p.cell((p.left + 120, y + 20, p.left + 240, y + 40), "12", "right", "bold" if gaps else "reg")
    p.line(820, [R("7", colour=head)], x=280)
    doc.save(str(path))


if HAVE_DEPS:
    FONT_BYTES = {v: synth_font(v) for v in FACES.values()}


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF and fontTools")
class PortAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        cls.paths = {k: root / f"{k}.pdf" for k in ("source", "clean", "gaps")}
        for k, p in cls.paths.items():
            build(p, k)
        cls.clean = pa.run(str(cls.paths["source"]), str(cls.paths["clean"]))
        cls.gaps = pa.run(str(cls.paths["source"]), str(cls.paths["gaps"]))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_clean_port_reports_nothing(self):
        self.assertEqual(self.clean["counts"], {a: 0 for a in pa.ATTRIBUTES}, json.dumps(self.clean["gaps"], indent=1))
        self.assertGreater(self.clean["matched"]["share"], 0.95)

    def test_each_planted_gap_is_reported(self):
        c = self.gaps["counts"]
        detail = json.dumps(self.gaps["gaps"], indent=1)
        self.assertEqual(c["italic"], 1, detail)
        self.assertEqual(c["bold"], 2, detail)  # the bold line, and the table's "12"
        self.assertEqual(c["smallCaps"], 1, detail)
        self.assertEqual(c["specialSpace"], 2, detail)
        self.assertEqual(c["bulletSize"], 1, detail)
        self.assertEqual(c["bulletMissing"], 1, detail)
        self.assertEqual(c["bulletWeight"], 1, detail)
        self.assertEqual(c["cellAlign"], 1, detail)
        self.assertEqual(c["cellBold"], 1, detail)
        self.assertEqual(c["folioColour"], 2, detail)  # the running head and the folio
        self.assertEqual(c["textColour"], 1, detail)

    def test_gap_details(self):
        by = {}
        for g in self.gaps["gaps"]:
            by.setdefault(g["attribute"], []).append(g)
        self.assertIn("sheared upright face", by["italic"][0]["source"])
        self.assertEqual(by["italic"][0]["text"], "Sheared words lean here.")
        spaces = sorted(g["port"] for g in by["specialSpace"])
        self.assertTrue(any(s.startswith("fixed space set as a word space") for s in spaces), spaces)
        self.assertTrue(any(s.startswith("glued words broken across lines") for s in spaces), spaces)
        self.assertEqual(by["smallCaps"][0]["port"], "capitals")
        self.assertEqual(by["cellAlign"][0]["source"], "centre")
        self.assertEqual(by["textColour"][0]["source"], "#cc0000")
        self.assertEqual(self.gaps["byPage"]["italic"], {"1": 1})

    def test_command_line_writes_json_and_markdown(self):
        root = Path(self.tmp.name)
        r = subprocess.run([sys.executable, str(SCRIPTS / "port_audit.py"), str(self.paths["source"]),
                            str(self.paths["gaps"]), "--json", str(root / "a.json"), "--md", str(root / "a.md"),
                            "--strict"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1, r.stderr)
        rep = json.loads((root / "a.json").read_text(encoding="utf-8"))
        self.assertEqual(rep["counts"]["smallCaps"], 1)
        md = (root / "a.md").read_text(encoding="utf-8")
        self.assertIn("| smallCaps | 1 | 1 (1) |", md)
        self.assertIn("## cellAlign", md)
        ok = subprocess.run([sys.executable, str(SCRIPTS / "port_audit.py"), str(self.paths["source"]),
                             str(self.paths["clean"]), "--strict"], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)

    def test_page_ranges(self):
        self.assertEqual(pa.page_list("2-3,5", 6), [1, 2, 4])
        self.assertEqual(pa.page_list(None, 2), [0, 1])
        self.assertEqual(pa.page_list("9", 3), [])


if __name__ == "__main__":
    unittest.main()
