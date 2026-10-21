"""Tests of the white cut-out of illustrations (`pdf_regions.py extract`,
`images.py cutout`) and of `images.py crop` (#1130), on pictures drawn in
the test.

    python3 -m unittest discover -s plugins/postext/skills/postext-port/scripts/tests
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

try:
    import fitz
    import numpy as np
    from PIL import Image, ImageDraw
    HAVE_DEPS = True
except Exception:  # pragma: no cover
    HAVE_DEPS = False

if HAVE_DEPS:
    import images
    import pdf_regions as pr

MM = 72 / 25.4


def drawing(w: int = 300, h: int = 200) -> Image.Image:
    """An illustration on white: a ring closing a white plate, and a stem."""
    im = Image.new("RGB", (w, h), (255, 255, 255))
    d = ImageDraw.Draw(im)
    d.ellipse((60, 30, 240, 170), fill=(255, 255, 255), outline=(30, 80, 160), width=8)
    d.rectangle((145, 150, 155, 199), fill=(120, 70, 30))
    return im


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class CutoutTest(unittest.TestCase):
    def test_outer_white_goes_and_the_closed_plate_stays(self):
        cut = images.cutout_white(drawing())
        self.assertIsNotNone(cut)
        a = np.asarray(cut.getchannel("A"))
        self.assertEqual(a[5, 5], 0)            # the paper round it
        self.assertEqual(a[100, 150], 255)      # the white inside the ring
        self.assertEqual(a[100, 64], 255)       # the ring
        self.assertEqual(a[198, 150], 255)      # the stem reaches the edge and stays

    def test_a_photo_is_left_alone(self):
        im = Image.new("RGB", (200, 100), (90, 140, 60))
        ImageDraw.Draw(im).rectangle((0, 0, 199, 10), fill=(255, 255, 255))    # a white sky strip
        self.assertIsNone(images.cutout_white(im))
        self.assertIsNone(images.cutout_white(Image.new("RGB", (50, 50), (255, 255, 255))))   # nothing but paper

    def test_an_illustration_on_white_is_cut_transparent_with_a_contour(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            doc = fitz.open()
            page = doc.new_page(width=210 * MM, height=297 * MM)
            page.insert_text((20 * MM, 20 * MM), "The tree on the right grows by the river near the old mill.",
                             fontsize=11, fontname="helv")
            buf = io.BytesIO()
            drawing(600, 400).save(buf, format="PNG")
            page.insert_image(fitz.Rect(110 * MM, 40 * MM, 190 * MM, 93.3 * MM), stream=buf.getvalue())
            page.insert_text((20 * MM, 60 * MM), "Words beside the drawing run down the left of the page.",
                             fontsize=11, fontname="helv")
            pdf = root / "tree.pdf"
            doc.save(str(pdf))
            out = root / "out"
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                pr.main(["extract", str(pdf), "--out", str(out), "--lang", "en", "--name-frames", "never"])
            res = [r for r in json.loads((out / "resources.json").read_text(encoding="utf-8")) if r["typeId"] == "picture"]
            self.assertEqual(len(res), 1, res)
            self.assertTrue(res[0]["file"].endswith(".png"), res[0])
            self.assertIn("contour", res[0])
            with Image.open(out / res[0]["file"]) as im:
                self.assertEqual(im.mode, "RGBA")
                a = np.asarray(im.getchannel("A"))
                h, w = a.shape
                self.assertEqual(a[2, 2], 0)
                self.assertEqual(a[h // 2, w // 2], 255)


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF, numpy and Pillow")
class CropTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "resources").mkdir()
        drawing(300, 200).save(self.root / "resources" / "tree.png")
        self.res = [{"id": "tree", "typeId": "picture", "kind": "bitmap", "file": "resources/tree.png",
                     "width": 300, "height": 200, "resolution": 254.0,
                     "anchors": [{"id": "trunk", "x": 0.5, "y": 0.9}, {"id": "corner", "x": 0.02, "y": 0.02}],
                     "avoid": [{"x": 0.2, "y": 0.15, "width": 0.6, "height": 0.7}],
                     "contour": {"points": [{"x": 0.2, "y": 0.15}, {"x": 0.8, "y": 0.15}, {"x": 0.5, "y": 1.0}]}}]
        (self.root / "resources.json").write_text(json.dumps(self.res), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def run_images(self, *argv) -> dict:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            images.main(list(argv) + ["--resources", str(self.root / "resources.json")])
        return json.loads(buf.getvalue())

    def test_crop_keeps_anchors_on_their_point(self):
        # 254 px per inch: 1 mm is 10 px
        got = self.run_images("crop", "tree", "--left", "3mm", "--top", "20", "--right", "30px")
        self.assertEqual((got["width"], got["height"]), (240, 180))
        self.assertTrue(any("corner" in w for w in got["warnings"]))
        r = json.loads((self.root / "resources.json").read_text(encoding="utf-8"))[0]
        self.assertEqual((r["width"], r["height"]), (240, 180))
        with Image.open(self.root / r["file"]) as im:
            self.assertEqual(im.size, (240, 180))
        trunk = next(a for a in r["anchors"] if a["id"] == "trunk")
        self.assertAlmostEqual(trunk["x"] * 240 + 30, 150, delta=0.1)     # the same pixel of the old file
        self.assertAlmostEqual(trunk["y"] * 180 + 20, 180, delta=0.1)
        av = r["avoid"][0]
        self.assertAlmostEqual(av["x"] * 240 + 30, 60, delta=0.1)
        self.assertAlmostEqual(av["width"] * 240, 180, delta=0.1)
        p = r["contour"]["points"][2]
        self.assertAlmostEqual(p["y"] * 180 + 20, 200, delta=0.1)

    def test_cutout_writes_a_png_with_a_contour(self):
        got = self.run_images("cutout", "tree")
        self.assertTrue(got["file"].endswith("tree.png"))
        r = json.loads((self.root / "resources.json").read_text(encoding="utf-8"))[0]
        self.assertEqual(r["contour"]["points"][0], {"x": 0.2, "y": 0.15})   # an existing contour is kept
        with Image.open(self.root / r["file"]) as im:
            self.assertEqual(im.mode, "RGBA")


if __name__ == "__main__":
    unittest.main()
