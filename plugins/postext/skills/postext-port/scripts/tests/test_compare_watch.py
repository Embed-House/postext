"""Tests of `compare_pages.py --watch DIR` (#1137): a page image that
changes in DIR gets its pair and score written again, and only that page.

    python3 -m pytest plugins/postext/skills/postext-port/scripts/tests -q
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent

try:
    import fitz  # PyMuPDF
    from PIL import Image
    HAVE_DEPS = True
except Exception:  # pragma: no cover
    HAVE_DEPS = False


def source_pdf(path: Path) -> None:
    doc = fitz.open()
    for n in range(2):
        page = doc.new_page(width=200, height=280)
        page.insert_text((30, 60 + 40 * n), f"Page {n + 1}", fontsize=20)
    doc.save(str(path))


def page_image(path: Path, shade: int) -> None:
    Image.new("RGB", (200, 280), (shade, shade, shade)).save(path)


def read_line(proc: subprocess.Popen, timeout: float = 30.0) -> str:
    end = time.time() + timeout
    while time.time() < end:
        line = proc.stdout.readline()
        if line:
            return line.strip()
        time.sleep(0.05)
    raise AssertionError("no output from compare_pages.py --watch")


@unittest.skipUnless(HAVE_DEPS, "needs PyMuPDF and Pillow")
class Watch(unittest.TestCase):
    def test_a_changed_page_alone_is_paired_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_pdf(root / "source.pdf")
            pages, out = root / "pages", root / "cmp"
            pages.mkdir()
            page_image(pages / "page-001.png", 250)
            page_image(pages / "page-002.png", 250)
            proc = subprocess.Popen(
                [sys.executable, str(SCRIPTS / "compare_pages.py"), str(root / "source.pdf"), "--watch", str(pages),
                 "--source-pages", "1-2", "--render-pages", "1-2", "--out", str(out), "--score",
                 str(root / "score.json"), "--rounds", "2", "--interval", "0.1", "--settle", "0.1"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertTrue(read_line(proc).startswith("watching"))
                first = read_line(proc)
                self.assertIn("refreshed p1", first)
                self.assertIn("p2", first)
                before = json.loads((root / "score.json").read_text(encoding="utf-8"))
                pair1 = (out / "pair-01.png").stat().st_mtime_ns
                page_image(pages / "page-002.png", 20)  # the second page changes
                second = read_line(proc)
                self.assertIn("refreshed p2", second)
                self.assertNotIn("p1 ", second)
                self.assertEqual(proc.wait(timeout=30), 0)
            finally:
                if proc.poll() is None:
                    proc.kill()
            after = json.loads((root / "score.json").read_text(encoding="utf-8"))
            self.assertEqual(len(after["pages"]), 2)
            self.assertEqual(after["pages"][0], before["pages"][0])
            self.assertGreater(after["pages"][1]["mean"], before["pages"][1]["mean"])
            self.assertEqual((out / "pair-01.png").stat().st_mtime_ns, pair1)

    def test_watch_and_a_render_argument_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_pdf(root / "source.pdf")
            r = subprocess.run([sys.executable, str(SCRIPTS / "compare_pages.py"), str(root / "source.pdf"),
                                str(root / "other"), "--watch", str(root / "pages"), "--source-pages", "1",
                                "--render-pages", "1", "--out", str(root / "cmp")], capture_output=True, text=True)
            self.assertEqual(r.returncode, 2)
            self.assertIn("--watch DIR", r.stderr)


if __name__ == "__main__":
    unittest.main()
