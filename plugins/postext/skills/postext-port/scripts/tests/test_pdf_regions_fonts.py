"""Faces of `pdf_regions.py`: bold and italic read from every form of PDF
font name, the fonts table and the bold flag, and the warning when every
face comes out at one weight; a font map naming a family the fonts folder
lacks, a manifest pointed at the project's own fonts, and measures taken
from the lines set solid in the book's faces instead of shrinking text."""
from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from test_pdf_regions_text import HAVE_DEPS, MM, extract  # noqa: E402

if HAVE_DEPS:
    import fitz
    import pdf_regions as pr


def named_page(names: dict[str, str]):
    """A page whose base-14 fonts are renamed (`/BaseFont`) to the forms
    producers write."""
    doc = fitz.open()
    page = doc.new_page(width=210 * MM, height=297 * MM)
    x, y = 25 * MM, 40 * MM
    for k in range(6):
        page.insert_text((x, y + k * 14), "Texto corrido de la página para medir el cuerpo.", fontname="helv",
                         fontsize=11)
    xx = x
    for word, font in (("Una ", "helv"), ("palabra", "hebo"), (" y otra ", "helv"), ("inclinada", "heit"),
                       (" y otra ", "helv"), ("negrita.", "cobo")):
        page.insert_text((xx, y + 100), word, fontname=font, fontsize=11)
        xx += fitz.get_text_length(word, fontname=font, fontsize=11)
    for xref, _ext, _typ, _base, ref, _enc in page.get_fonts():
        if ref in names:
            doc.xref_set_key(xref, "BaseFont", "/" + names[ref].replace(" ", "#20"))
    out = fitz.open()
    out.insert_pdf(fitz.open("pdf", doc.tobytes()))
    return out


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class FaceNames(unittest.TestCase):
    def test_split_face_name(self):
        self.assertEqual(pr.split_face_name("ABCDEF+Arial,Bold"), ("Arial", "Bold"))
        self.assertEqual(pr.split_face_name("Arial-BoldItalicMT"), ("Arial", "BoldItalicMT"))
        self.assertEqual(pr.split_face_name("Helvetica Bold"), ("Helvetica", "Bold"))
        self.assertEqual(pr.split_face_name("Minion Pro Semibold Italic"), ("Minion Pro", "SemiboldItalic"))
        self.assertEqual(pr.split_face_name("ArialBold"), ("Arial", "Bold"))
        self.assertEqual(pr.split_face_name("Gill Sans"), ("Gill Sans", ""))

    def test_face_from_the_name_alone(self):
        f = pr.Fonts()
        self.assertEqual(f.face("Arial,Bold"), ("Arial", 700, False))
        self.assertEqual(f.face("ABCDEF+Arial,Italic"), ("Arial", 400, True))
        self.assertEqual(f.face("Helvetica Bold"), ("Helvetica", 700, False))

    def test_table_weight_never_lowers_the_name(self):
        f = pr.Fonts()
        f.table = {"Arial": ("Arial", 400, "normal", "arial.ttf"),
                   "Arial-Italic": ("Arial", 400, "italic", "ariali.ttf")}
        # a prefix candidate whose style disagrees (regular for a bold name) is not taken
        fam, w, it = f.face("Arial,Bold")
        self.assertEqual((fam, w, it), ("Arial", 700, False))
        # the bold flag counts too, over a table hit
        self.assertEqual(f.face("Arial", 16)[1], 700)
        self.assertEqual(f.face("Arial")[1], 400)
        self.assertEqual(f.face("Arial-Italic"), ("Arial", 400, True))

    def test_bold_at_150_over_the_base_and_500(self):
        def md(base, w):
            c = [pr.Char(ch, i, 0, i + 1, 3, 3, "F", cw, False, 11, "#000000")
                 for i, (ch, cw) in enumerate(zip("ab cd", (base, base, base, w, w)))]
            return pr.runs_markdown(c, base, False, {}, "mark")
        self.assertEqual(md(300, 500), "ab **cd**")      # Medium over Light
        self.assertEqual(md(350, 500), "ab **cd**")      # Medium over a Book of 350
        self.assertEqual(md(400, 500), "ab cd")          # +100 is not bold
        self.assertEqual(md(300, 400), "ab cd")          # under 500 is not bold

    def test_bold_at_100_over_the_base_in_another_font(self):
        def md(base, base_font, w, font):
            c = [pr.Char(ch, i, 0, i + 1, 3, 3, "F", cw, False, 11, "#000000", font=f)
                 for i, (ch, cw, f) in enumerate(zip("ab cd", (base,) * 3 + (w,) * 2, (base_font,) * 3 + (font,) * 2))]
            return pr.runs_markdown(c, base, False, {}, "mark")
        self.assertEqual(md(400, "Face-Book", 500, "Face-Medium"), "ab **cd**")        # Medium over Book
        self.assertEqual(md(500, "Face-Medium", 600, "Face-Semibold"), "ab **cd**")    # Semibold over Medium
        self.assertEqual(md(400, "Face-Roman", 400, "Face-Book"), "ab cd")             # Book over Roman
        self.assertEqual(md(400, "Face-Book", 500, "Face-Book"), "ab cd")              # one font: +150

    def test_draft_marks_bold_and_italic(self):
        doc = named_page({"helv": "Arial", "hebo": "Arial,Bold", "heit": "Arial,Italic", "cobo": "Helvetica Bold"})
        tmp, md, lib, report = extract(doc)
        try:
            self.assertIn("Una **palabra** y otra *inclinada* y otra **negrita.**", md)
            self.assertEqual(report["fonts"]["Arial,Bold"][:2], ["Arial", 700])
            self.assertEqual(report["warnings"], [])
        finally:
            tmp.cleanup()

    def test_one_weight_warning(self):
        f = pr.Fonts()
        f.seen = {"Arial": ("Arial", 400, False), "Arial-Bold": ("Arial", 400, False)}
        self.assertTrue(pr.font_warnings(f))
        f.seen = {"Arial": ("Arial", 400, False), "Arial-Bold": ("Arial", 700, False)}
        self.assertEqual(pr.font_warnings(f), [])



def write_face(path: Path, family: str, ps: str, advance: int = 500, weight: int = 400) -> None:
    """A font of the letters, digits and space, every glyph `advance` units
    wide on a 1000 em, whose names say `family` and `ps`."""
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,"
    names = {c: f"g{ord(c)}" for c in chars}
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder([".notdef"] + list(names.values()))
    fb.setupCharacterMap({ord(c): n for c, n in names.items()})
    fb.setupGlyf({n: TTGlyphPen(None).glyph() for n in [".notdef"] + list(names.values())})
    fb.setupHorizontalMetrics({n: (advance, 0) for n in [".notdef"] + list(names.values())})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": family, "styleName": "Regular", "psName": ps})
    fb.setupOS2(usWeightClass=weight)
    fb.setupPost()
    fb.save(str(path))


def pill_and_box_page():
    """A box whose longest line runs to 2 mm from its right edge, and a
    pill: a tab with one word centred in it, 1.5 mm from either side."""
    doc = fitz.open()
    page = doc.new_page(width=210 * MM, height=297 * MM)
    for k in range(6):
        page.insert_text((25 * MM, (30 + k * 5) * MM), "Texto corrido de la pagina para medir el cuerpo.",
                         fontname="helv", fontsize=11)
    page.draw_rect(fitz.Rect(25 * MM, 70 * MM, 125 * MM, 95 * MM), color=(0.1, 0.4, 0.8), fill=None, width=0.8)
    words = ["Una caja con su texto", "que llega casi al borde", "de la caja dibujada"]
    widest = max(fitz.get_text_length(w, fontname="helv", fontsize=10) for w in words)
    x = 125 * MM - 2 * MM - widest
    for k, w in enumerate(words):
        page.insert_text((x, (77 + k * 5) * MM), w, fontname="helv", fontsize=10)
    tw = fitz.get_text_length("Bosque", fontname="helv", fontsize=9)
    page.draw_rect(fitz.Rect(140 * MM, 120 * MM, 140 * MM + tw + 3 * MM, 127 * MM), color=None, fill=(0.2, 0.6, 0.3))
    page.insert_text((141.5 * MM, 124.6 * MM), "Bosque", fontname="helv", fontsize=9, color=(1, 1, 1))
    return doc


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class FontMapTargets(unittest.TestCase):
    def test_a_target_not_among_the_fonts_fails_with_the_near_family(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "fonts").mkdir()
            write_face(root / "fonts" / "Woodstamp.ttf", "Wood Stamp", "WoodStamp")
            (root / "map.json").write_text(json.dumps({"Helvetica": {"family": "Woodstamp"}}), encoding="utf-8")
            f = pr.Fonts(root / "map.json", root / "fonts")
            bad = pr.font_map_problems(f)
            self.assertEqual(len(bad), 1)
            self.assertIn("'Woodstamp'", bad[0])
            self.assertIn("did you mean 'Wood Stamp'", bad[0])
            doc = fitz.open()
            doc.new_page().insert_text((50, 50), "Texto", fontname="helv")
            doc.save(str(root / "src.pdf"))
            with self.assertRaises(SystemExit) as ctx:
                pr.main(["extract", str(root / "src.pdf"), "--out", str(root / "out"), "--fonts", str(root / "fonts"),
                         "--font-map", str(root / "map.json")])
            self.assertIn("Wood Stamp", str(ctx.exception.code))
            self.assertFalse((root / "out").exists())
            # the family as the file names it passes; without --fonts nothing is checked
            (root / "map.json").write_text(json.dumps({"Helvetica": "Wood Stamp"}), encoding="utf-8")
            self.assertEqual(pr.font_map_problems(pr.Fonts(root / "map.json", root / "fonts")), [])
            self.assertEqual(pr.font_map_problems(pr.Fonts(root / "map.json", None)), [])


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class ManifestFonts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        doc = fitz.open()
        doc.new_page(width=210 * MM, height=297 * MM).insert_text((60, 80), "Texto de la pagina.", fontname="helv")
        doc.save(str(self.root / "src.pdf"))
        self.out = self.root / "out"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            pr.main(["extract", str(self.root / "src.pdf"), "--out", str(self.out)])

    def tearDown(self):
        self.tmp.cleanup()

    def manifest(self, fonts: Path) -> str:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            pr.main(["manifest", str(self.out), "--fonts", str(fonts)])
        return buf.getvalue()

    def test_the_projects_own_fonts_folder_is_kept(self):
        (self.out / "fonts").mkdir()
        write_face(self.out / "fonts" / "Serif.ttf", "Book Serif", "BookSerif-Regular")
        said = self.manifest(self.out / "fonts")
        self.assertIn("nothing is copied", said)
        self.assertTrue((self.out / "fonts" / "Serif.ttf").is_file())
        preset = json.loads((self.out / "preset.json").read_text(encoding="utf-8"))
        self.assertEqual([f["name"] for f in preset["fonts"]], ["Book Serif"])

    def test_a_link_to_the_fonts_named_is_kept(self):
        shared = self.root / "shared"
        shared.mkdir()
        write_face(shared / "Serif.ttf", "Book Serif", "BookSerif-Regular")
        (self.out / "fonts").symlink_to(shared)
        self.assertIn("nothing is copied", self.manifest(shared))
        self.assertTrue((self.out / "fonts").is_symlink())
        self.assertTrue((shared / "Serif.ttf").is_file())

    def test_a_folder_inside_the_fonts_folder_is_copied_before_it_is_cleared(self):
        (self.out / "fonts" / "new").mkdir(parents=True)
        write_face(self.out / "fonts" / "new" / "Serif.ttf", "Book Serif", "BookSerif-Regular")
        self.manifest(self.out / "fonts" / "new")
        self.assertTrue((self.out / "fonts" / "Serif.ttf").is_file())


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class MeasureNotShrink(unittest.TestCase):
    """The draft widens measures to what the lines need set solid in the
    book's faces and writes no fit.minScale unless asked (`--fit`)."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        (root / "fonts").mkdir()
        # a face a fifth wider than Helvetica's average letter
        write_face(root / "fonts" / "Wide.ttf", "Wide Sans", "WideSans-Regular", advance=640)
        (root / "map.json").write_text(json.dumps({"Helvetica": "Wide Sans"}), encoding="utf-8")
        cls.args = ["--fonts", str(root / "fonts"), "--font-map", str(root / "map.json"), "--name-frames", "never"]
        cls.plain = extract(pill_and_box_page(), *cls.args)
        cls.fit = extract(pill_and_box_page(), *cls.args, "--fit", "0.9")
        cls.solid = pr.FaceWidths(pr.Fonts(root / "map.json", root / "fonts"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()
        cls.plain[0].cleanup()
        cls.fit[0].cleanup()

    def frames(self, lib: dict) -> list[dict]:
        return [f for t in lib["pageTemplates"] for f in t["frames"]]

    def test_face_widths_of_a_line(self):
        line = pr.Line([pr.Char(c, 10 + i, 0, 11 + i, 3, 3, "Wide Sans", 400, False, 10, "#000000")
                        for i, c in enumerate("ab c")])
        self.assertAlmostEqual(self.solid.width(line), 4 * 0.64 * 10 * pr.PT_MM, places=3)
        line.chars[1].family = "Unknown"     # a face not in --fonts: its printed width
        self.assertAlmostEqual(self.solid.width(line), 3 * 0.64 * 10 * pr.PT_MM + 1.0, places=3)

    def test_no_frame_shrinks_its_text_by_default(self):
        _, md, lib, report = self.plain
        self.assertFalse([f for f in self.frames(lib) if "fit" in f])
        self.assertTrue([f for f in self.frames(self.fit[2]) if f.get("fit", {}).get("minScale") == 0.9])

    def test_the_box_gives_its_right_padding_to_the_wider_face(self):
        _, md, lib, report = self.plain
        box = next(s for s in lib["calloutStyles"] if s["id"].startswith("box") and s.get("border", {}).get("enabled"))
        self.assertEqual(box["padding"]["right"]["value"], 0)
        notes = [n for ns in report["notes"].values() for n in ns]
        self.assertTrue(any("the right padding is all given" in n for n in notes), notes)

    def test_the_pill_widens_to_its_word_set_solid(self):
        _, md, lib, report = self.plain
        tab = next(f for f in self.frames(lib) if f["name"].startswith("tab"))
        drawn = fitz.get_text_length("Bosque", fontname="helv", fontsize=9) / MM + 3
        solid = 6 * 0.64 * 9 * pr.PT_MM
        self.assertGreater(tab["width"]["value"], drawn)
        self.assertAlmostEqual(tab["width"]["value"], solid * 1.03 + 3, delta=0.2)
        notes = [n for ns in report["notes"].values() for n in ns]
        self.assertTrue(any("pill" in n for n in notes), notes)


if __name__ == "__main__":
    unittest.main()
