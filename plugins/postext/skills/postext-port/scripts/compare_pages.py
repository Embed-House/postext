#!/usr/bin/env python3
"""Side-by-side page comparison of the source PDF and the Postext render.

    compare_pages.py source.pdf render.pdf --source-pages 23-30 --render-pages 1-8
        --out compare/ [--dpi 45] [--sheet]
    compare_pages.py source.pdf /tmp/pages --source-pages 23-30 --render-pages 1-8 --out compare/
    compare_pages.py source.pdf --watch /tmp/pages --source-pages 23-30 --render-pages 1-8 --out compare/ --score

The render is a PDF, or the folder `render.mjs --jpeg` wrote (page-NNN.jpg,
NNN the page's position in the layout; --render-pages counts the same way),
so a look at the pages never needs a PDF.

Writes compare/pair-NN.png (source left, render right) for each page pair and,
with --sheet, compare/sheet.png (all pairs in a grid) to eyeball a whole
chapter: page breaks, column balance, figure positions, box placement,
openers and running heads.

--score prints how alike each pair is, as round 1 of the composed-pages
port measured it: both pages grey at the pair's resolution (use --dpi 60),
blurred 2 px, the mean absolute difference (0-255, lower is closer) and the
share of pixels that differ by more than 40; `--score FILE` also writes
them as JSON. Run it on the render before and after a reshape
(template_dedupe.py grids and modules) to see that the pages still look
the same.

--check REPORT (with --score) reads the checks of the same render, the
JSON of `composed_check.py check --json` or of `postext check --json`, and
fails the score (exit 1, "passed": false in FILE) while any frame lies
under another or runs past its box (frameCovered, frameOutsideArea,
postext 1.48) that the project has not recorded as meant
(composed-check.json beside preset.json, or --exceptions FILE): a page
that looks like the source but hides a caption under a photo is not a
match. The overlaps are listed by page label.

--watch DIR keeps running beside `postext build … --images DIR --watch`:
each time a page image in DIR changes (its bytes, not only its date), it
writes that page's pair again, and with --score its score and the score
file, and prints one line per refresh; pages whose images did not change
are left alone. The source pages are rasterised once. Stop it with Ctrl-C
(--rounds N stops after N refreshes). --check and --sheet are not read in
this mode.

The page ranges are 1-based PDF page numbers (mind the offset between the
book's folios and the PDF pages). Requires PyMuPDF and Pillow.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import time
from pathlib import Path

try:
    import fitz  # PyMuPDF
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    sys.exit("requires PyMuPDF and Pillow: python3 -m pip install pymupdf pillow")


def pages(spec: str, count: int) -> list[int]:
    a, _, b = spec.partition("-")
    s, e = int(a), int(b or a)
    return [p - 1 for p in range(s, e + 1) if 1 <= p <= count]


def render(doc, pno: int, dpi: int, height: int | None = None) -> Image.Image:
    page = doc[pno]
    rect = page.trimbox if page.trimbox and page.trimbox != page.mediabox else page.rect
    pix = page.get_pixmap(dpi=dpi, clip=rect, alpha=False)
    im = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    if height and im.height != height:
        im = im.resize((round(im.width * height / im.height), height))
    return im


def likeness(a: Image.Image, b: Image.Image) -> tuple[float, float]:
    """(mean absolute difference 0-255, % of pixels off by more than 40)
    of two pages, grey and blurred 2 px, `b` resized to `a`."""
    from PIL import ImageFilter

    ga = a.convert("L").filter(ImageFilter.GaussianBlur(2))
    gb = b.convert("L").resize(a.size).filter(ImageFilter.GaussianBlur(2))
    diffs = [abs(x - y) for x, y in zip(ga.tobytes(), gb.tobytes())]
    n = max(1, len(diffs))
    return sum(diffs) / n, 100.0 * sum(1 for d in diffs if d > 40) / n


class JpegPages:
    """The pages `render.mjs --jpeg DIR` (page-NNN.jpg) or `postext images`
    (page-NNN.png) wrote, read like a document."""

    def __init__(self, folder: Path) -> None:
        found = sorted(folder.glob("page-*.png")) + sorted(folder.glob("page-*.jpg"))
        self.folder = folder
        self.files = {int(f.stem.split("-")[1]): f for f in found if f.stem.split("-")[1].isdigit()}
        self.page_count = max(self.files, default=0)

    def image(self, pno: int, height: int | None) -> Image.Image | None:
        f = self.files.get(pno + 1)
        if not f:
            return None
        im = Image.open(f).convert("RGB")
        if height and im.height != height:
            im = im.resize((round(im.width * height / im.height), height))
        return im


def overlaps_of(report_path: str, exceptions: str | None = None) -> list[dict]:
    """The overlaps a check report says fail: from `composed_check.py check
    --json` (its failures marked `overlap`), or from `postext check --json`
    (frameCovered / frameOutsideArea, less the recorded exceptions)."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import composed_check as cc  # noqa: PLC0415

    data = json.loads(Path(report_path).read_text(encoding="utf-8"))
    out: list[dict] = []
    if isinstance(data.get("editions"), dict):
        for loc, ed in data["editions"].items():
            for run in (ed, ed.get("stress") or {}):
                for f in run.get("fail") or []:
                    if f.get("overlap"):
                        out.append({"locale": loc, "kind": f["kind"], "page": f.get("page"), "message": f["message"]})
        return out
    path = Path(exceptions) if exceptions else Path(report_path).parent / cc.EXCEPTIONS_FILE
    entries, _ = cc.load_exceptions(path)
    v = cc.judge(data, exceptions=entries)
    return [{"locale": None, "kind": f["kind"], "page": f.get("page"), "message": f["message"]}
            for f in v["fail"] if f.get("overlap")]


def make_pair(n: int, src, ren, sp: list[int], rp: list[int], args: argparse.Namespace, out: Path,
              source_image: Image.Image | None = None) -> tuple[Image.Image, dict | None] | None:
    """Pair n: writes out/pair-NN.png; (the pair, its score with --score)."""
    a = source_image if source_image is not None else (render(src, sp[n], args.dpi) if n < len(sp) else None)
    h = a.height if a else None
    if n >= len(rp):
        b = None
    elif isinstance(ren, JpegPages):
        b = ren.image(rp[n], h)
        if b is None:
            print(f"no page-{rp[n] + 1:03d}.jpg/.png in {ren.folder}: render it with --jpeg --pages '#{rp[n] + 1}'")
    else:
        b = render(ren, rp[n], args.dpi, h)
    if a is None and b is None:
        return None
    h = h or b.height
    w = (a.width if a else b.width) + (b.width if b else a.width) + 12
    pair = Image.new("RGB", (w, h + 16), (235, 235, 235))
    d = ImageDraw.Draw(pair)
    x = 0
    for im, label in ((a, f"source p.{sp[n] + 1}" if a else ""), (b, f"postext p.{rp[n] + 1}" if b else "")):
        if im:
            pair.paste(im, (x, 16))
            d.text((x + 4, 2), label, fill=(60, 60, 60))
            x += im.width + 12
        else:
            x += (a or b).width + 12
    pair.save(out / f"pair-{n + 1:02d}.png")
    score = None
    if args.score is not None and a and b:
        m, over = likeness(a, b)
        score = {"source": sp[n] + 1, "render": rp[n] + 1, "mean": round(m, 2), "over40": round(over, 2)}
    return pair, score


def print_score(score: dict) -> None:
    print(f"p{score['source']:02d}  mean {score['mean']:5.1f}  >40: {score['over40']:5.1f}%")


def file_digest(path: Path) -> str | None:
    try:
        return hashlib.sha1(path.read_bytes()).hexdigest()
    except OSError:
        return None


def watch(args: argparse.Namespace, src, sp: list[int], rp: list[int], out: Path) -> None:
    """Pair again each page whose image in the watched folder changes."""
    folder = Path(args.watch)
    sources: dict[int, Image.Image] = {}
    seen: dict[int, str] = {}  # render page index -> digest of the image last paired
    scores: dict[int, dict] = {}
    rounds = 0
    print(f"watching {folder} for pages {', '.join(str(p + 1) for p in rp)} (Ctrl-C stops)", flush=True)
    try:
        while True:
            ren = JpegPages(folder)
            changed = []
            for n, pno in enumerate(rp):
                f = ren.files.get(pno + 1)
                digest = file_digest(f) if f else None
                if digest and seen.get(pno) != digest:
                    changed.append(n)
            if changed:
                time.sleep(args.settle)  # let the writer finish the files
                ren = JpegPages(folder)
                done = []
                for n in changed:
                    pno = rp[n]
                    f = ren.files.get(pno + 1)
                    digest = file_digest(f) if f else None
                    if digest is None:
                        continue
                    if n < len(sp) and n not in sources:
                        sources[n] = render(src, sp[n], args.dpi)
                    try:
                        made = make_pair(n, src, ren, sp, rp, args, out, sources.get(n))
                    except OSError:
                        continue  # a file still being written: the next round reads it
                    seen[pno] = digest
                    if made and made[1]:
                        scores[n] = made[1]
                        done.append(f"p{made[1]['source']} mean {made[1]['mean']:.1f}")
                    elif made:
                        done.append(f"pair {n + 1}")
                if done:
                    rounds += 1
                    line = f"{time.strftime('%H:%M:%S')} refreshed {', '.join(done)}"
                    if scores:
                        mean = sum(r["mean"] for r in scores.values()) / len(scores)
                        over = sum(r["over40"] for r in scores.values()) / len(scores)
                        line += f"; all mean {mean:.1f}"
                        if args.score:
                            result = {"pages": [scores[k] for k in sorted(scores)], "mean": round(mean, 2),
                                      "over40": round(over, 2)}
                            Path(args.score).write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
                    print(line, flush=True)
                    if args.rounds and rounds >= args.rounds:
                        return
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("stopped")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source")
    ap.add_argument("render", nargs="?", help="the render's PDF or page-image folder (not with --watch)")
    ap.add_argument("--source-pages", required=True)
    ap.add_argument("--render-pages", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dpi", type=int, default=45)
    ap.add_argument("--sheet", action="store_true")
    ap.add_argument("--score", nargs="?", const="", default=None, metavar="FILE",
                    help="print how alike each pair is (and write it to FILE as JSON)")
    ap.add_argument("--check", metavar="REPORT",
                    help="with --score: fail while REPORT (composed_check.py or postext check --json) lists overlaps")
    ap.add_argument("--exceptions", metavar="FILE", help="overlaps recorded as meant, for a postext check report")
    ap.add_argument("--watch", metavar="DIR",
                    help="keep running: pair again each page whose image in DIR changes "
                         "(postext build --images DIR --watch)")
    ap.add_argument("--interval", type=float, default=0.5, help="--watch: seconds between looks at DIR (default 0.5)")
    ap.add_argument("--settle", type=float, default=0.3,
                    help="--watch: seconds to wait after a change before reading the images (default 0.3)")
    ap.add_argument("--rounds", type=int, default=0, help="--watch: stop after this many refreshes (default: never)")
    args = ap.parse_args()
    if args.watch and args.render and Path(args.render).resolve() != Path(args.watch).resolve():
        ap.error("give the page folder once: --watch DIR, without a render argument")
    if not args.watch and not args.render:
        ap.error("the render (a PDF or a page-image folder) or --watch DIR is required")
    if args.watch:
        Path(args.watch).mkdir(parents=True, exist_ok=True)
    src = fitz.open(args.source)
    target = args.watch or args.render
    ren = JpegPages(Path(target)) if Path(target).is_dir() else fitz.open(target)
    # a watched folder may not hold every page yet: its range is taken as written
    sp, rp = pages(args.source_pages, src.page_count), pages(args.render_pages, 10**6 if args.watch else ren.page_count)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if args.watch:
        watch(args, src, sp, rp, out)
        return
    pairs = []
    scores: list[dict] = []
    for n in range(max(len(sp), len(rp))):
        made = make_pair(n, src, ren, sp, rp, args, out)
        if made is None:
            continue
        pair, score = made
        pairs.append(pair)
        if score:
            scores.append(score)
            print_score(score)
    print(f"wrote {len(pairs)} pairs to {out}/")
    overlaps = overlaps_of(args.check, args.exceptions) if args.check and args.score is not None else None
    if scores:
        mean = sum(r["mean"] for r in scores) / len(scores)
        over = sum(r["over40"] for r in scores) / len(scores)
        print(f"all   mean {mean:5.1f}  >40: {over:5.1f}%")
        result = {"pages": scores, "mean": round(mean, 2), "over40": round(over, 2)}
        if overlaps is not None:
            result["overlaps"] = overlaps
            result["passed"] = not overlaps
            by_page: dict[str, int] = {}
            for o in overlaps:
                by_page[str(o.get("page") or "?")] = by_page.get(str(o.get("page") or "?"), 0) + 1
            print(f"overlaps {len(overlaps)}" + (": " + ", ".join(f"p. {p} ({n})" for p, n in by_page.items())
                                                 if by_page else ""))
            if overlaps:
                print("score failed: fix the overlaps (composed_check.py check lists their fixes) or record them as meant")
        if args.score:
            Path(args.score).write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    if args.sheet and pairs:
        cols = 2
        pw = max(p.width for p in pairs)
        ph = max(p.height for p in pairs)
        rows = (len(pairs) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * pw + (cols - 1) * 16, rows * ph + (rows - 1) * 16), (255, 255, 255))
        for i, p in enumerate(pairs):
            sheet.paste(p, ((i % cols) * (pw + 16), (i // cols) * (ph + 16)))
        sheet.save(out / "sheet.png")
        print(f"wrote {out / 'sheet.png'}")
    if overlaps:
        sys.exit(1)


if __name__ == "__main__":
    main()
