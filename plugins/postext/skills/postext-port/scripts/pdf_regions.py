#!/usr/bin/env python3
"""Fixed pages of a PDF as composed pages: page templates (frames in mm,
groups), frame styles, a page ground, the pictures cut without their text,
and Markdown with one `::::page` per page and a `:::frame{slot}` per box, in
reading order (references/composed-pages.md, round 2).

  pdf_regions.py extract SOURCE.pdf --pages 4-28 --out DIR [--lang es]
        [--fonts DIR] [--font-map map.json] [--dpi 300] [--ground-dpi 150]
        [--highlights mark|chip] [--fit 0.9] [--wrap-slack 3] [--chapter pages] [--json]
  pdf_regions.py manifest DIR [--fonts DIR] [--id ID] [--name NAME]
        Writes DIR/preset.json, a draft project that opens and builds as it
        is (page size from the PDF, the library, the chapters, the
        resources, the fonts), to lay the pages out and compare them with
        the source before the generator takes the pieces over.

What `extract` reads on every page:

- **Text**, through MuPDF with ActualText ignored (marked-content
  replacements otherwise drop words), and only the text that prints: each
  span is compared with a render of the page without text, so text drawn
  under a picture or a fill, clipped away or outside the page is dropped
  (and listed as hidden).
- **Shapes**: the page ground (fills over most of the page), white cards
  (large white fills: the page's paper, kept in the ground), boxes (filled
  or stroked rectangles and rounded rectangles holding text or pictures),
  tabs (a shape 4–13 mm high holding one line: on a box's top edge it is
  the box's tab, alone it is a frame of its own, with a heading in it a
  title), highlight bands (a wide coloured stroke or a fill hugging words):
  the words on them become `:mark[…]{style}` (or `:chip` with
  --highlights chip). A shape covered by later paint (a render shows
  something else) is not read.
- **Pictures**: images and clusters of line art. Text over a picture's
  ink (a render without text differs from the background under it) is the
  picture's lettering: the picture is cut at --dpi with all text removed
  and its words become anchors and `::label` lines (anchors.py). A picture
  with transparency is taken from the PDF with its alpha, so text can run
  round its outline (`wrap: "contour"`).
- **Running heads and folios**: text outside the cards (or in the top and
  bottom bands of a page without cards). A folio becomes `{pageNumber}`,
  other words a page attribute printed by the decoration (`{attr.head}`):
  the template stays text-free.

What it writes in DIR:

- `library.json`: `pageTemplates` (one per page, area `trim`; run
  template_dedupe.py next), `calloutStyles` (box, tab and text looks),
  `markStyles` or `chipStyles`, `labelStyles`, `paragraphStyles`, and
  `suggested` (bodyText, headings, resourceTypes for the generator);
- `resources.json` and `resources/`: page grounds, pictures and figures;
- `chapters/<lang>/01-<chapter>.md`: the page fences in page order;
- `figures.json`: every figure's labels, for `anchors.py relabel` to
  write other editions' `::label` lines from a strings file;
- `regions.json`: what was measured on every page (frames, boxes, tabs,
  pictures, labels, hidden text) and `report.json`.

Geometry: frames anchor below the frame above them on the same card
(`below`, with the measured gap), runs of frames one under another with
equal gaps form `stack` groups, boxes of the same height side by side form
`row` groups; frames inside a box, and pictures laid over a frame, anchor
to its corner and keep its text off (`exclude: "push"`). A box's drawn
height is its `minHeight`; the last frame of a card gets the room to the
card's foot as `maxHeight`, so text that does not fit is reported
(`frameOverflow`) instead of running off the card. Frame names are slots by
role and order (`title`, `text`, `box-1`, `picture-2`, `figure-1`, `tab-1`),
so pages of one kind name their frames alike.

Requires PyMuPDF, numpy and Pillow (`pip install pymupdf numpy pillow`);
fontTools when --fonts is given.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import statistics
import sys
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

sys.path.insert(0, str(Path(__file__).resolve().parent))
import anchors as anc  # noqa: E402
import postext_md as pmd  # noqa: E402
import template_dedupe as td  # noqa: E402

MM = 72 / 25.4            # points per mm
PT_MM = 25.4 / 72         # mm per point
FLAGS = (fitz.TEXTFLAGS_RAWDICT | fitz.TEXT_IGNORE_ACTUALTEXT) & ~fitz.TEXT_PRESERVE_IMAGES
CHECK_DPI = 100           # renders used to tell visible from hidden paint
BULLETS = "•·▪■●◦‣►▸◆"
WIDTH_TOKENS = ("cn", "cond", "condensed", "narrow", "compressed", "comp", "extended", "ext", "wide",
                "semicondensed", "extracondensed", "xcn")
WEIGHTS = {"thin": 100, "hairline": 100, "extralight": 200, "ultralight": 200, "light": 300, "lt": 300,
           "book": 400, "regular": 400, "roman": 400, "normal": 400, "rg": 400, "medium": 500, "md": 500,
           "semibold": 600, "demibold": 600, "demi": 600, "sb": 600, "bold": 700, "bd": 700,
           "extrabold": 800, "ultrabold": 800, "heavy": 900, "black": 900, "blk": 900}


def mmv(v: float) -> dict:
    return {"value": round(float(v), 2), "unit": "mm"}


def ptv(v: float) -> dict:
    return {"value": round(float(v), 2), "unit": "pt"}


def colour(h: str) -> dict:
    return {"hex": h.lower(), "model": "hex"}


def hexc(c: Any) -> str | None:
    if c is None:
        return None
    if isinstance(c, int):
        return "#%06x" % c
    if len(c) == 1:
        c = (c[0], c[0], c[0])
    if len(c) == 4:  # CMYK
        k = c[3]
        c = ((1 - c[0]) * (1 - k), (1 - c[1]) * (1 - k), (1 - c[2]) * (1 - k))
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v * 255))) for v in c[:3])


def whiteish(h: str | None) -> bool:
    return h is not None and all(v >= 0.96 for v in td.hex_rgb(h))


def rgb_dist(a: tuple, b: tuple) -> float:
    return sum(abs(x - y) for x, y in zip(a, b))


# ---------------------------------------------------------------------------
# fonts
# ---------------------------------------------------------------------------


def _split_camel(s: str) -> str:
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", s)
    return s.strip()


def style_tokens(style: str) -> list[str]:
    return [t.lower() for t in re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", style)]


def weight_italic_of(style: str) -> tuple[int, bool, list[str]]:
    """Weight, italic and the width words of a PostScript style part
    ('BoldCn' -> 700, False, ['cn'])."""
    low = style.lower()
    italic = any(w in low for w in ("italic", "oblique")) or bool(re.search(r"(^|[a-z])it$", low)) or low.endswith("ita")
    tokens = style_tokens(style)
    weight = 400
    for i in range(len(tokens)):
        for j in (2, 1):
            w = "".join(tokens[i:i + j])
            if w in WEIGHTS:
                weight = WEIGHTS[w]
    widths = [t for t in tokens if t in WIDTH_TOKENS]
    return weight, italic, widths


def font_table(fonts_dir: Path) -> dict[str, tuple[str, int, str, str]]:
    """PostScript name -> (family, weight, style, file) for the faces in
    fonts_dir. A width the family name does not say (`-BoldCn`) is added to
    the family ('Humanist Sans Cn'), so two faces never share a family,
    weight and style."""
    import preset_kit as kit

    out: dict[str, tuple[str, int, str, str]] = {}
    for f in sorted(fonts_dir.glob("*")):
        if f.suffix.lower() not in (".ttf", ".otf", ".woff2"):
            continue
        fam, weight, style = kit._font_meta(f)
        ps = f.stem
        try:
            from fontTools.ttLib import TTFont  # type: ignore

            ps = TTFont(str(f), lazy=True, fontNumber=0)["name"].getDebugName(6) or f.stem
        except Exception:
            pass
        sub = ps.partition("-")[2]
        w2, it2, widths = weight_italic_of(sub)
        if it2:
            style = "italic"
        for wd in widths:
            if wd not in fam.lower().replace(" ", ""):
                fam = f"{fam} {wd.capitalize()}"
        out[ps] = (fam, int(weight), style, f.name)
    seen: dict[tuple, str] = {}
    for ps in sorted(out):
        fam, weight, style, file = out[ps]
        key = (fam, weight, style)
        if key in seen:      # still a clash: the PostScript name tells them apart
            out[ps] = (_split_camel(ps.replace("-", " ")), weight, style, file)
        seen[key] = ps
    return out


class Fonts:
    """PDF font name -> (family, weight, italic): an explicit map first
    (prefix of the name -> family or {family, weight, italic}), then the
    book's font files (their PostScript names), then the name itself."""

    def __init__(self, font_map: Path | None = None, fonts_dir: Path | None = None):
        self.map = json.loads(font_map.read_text(encoding="utf-8")) if font_map else {}
        self.table = font_table(fonts_dir) if fonts_dir and fonts_dir.exists() else {}
        self.cache: dict[tuple[str, int], tuple[str, int, bool]] = {}
        self.seen: dict[str, tuple[str, int, bool]] = {}

    def face(self, pdf_name: str, flags: int = 0) -> tuple[str, int, bool]:
        key = (pdf_name, flags)
        if key in self.cache:
            return self.cache[key]
        base = pdf_name.split("+")[-1]
        fam_part, _, style = base.partition("-")
        weight, italic, _ = weight_italic_of(style)
        if flags & 16 and weight < 600:
            weight = 700
        if flags & 2:
            italic = True
        out = None
        for prefix in sorted(self.map, key=lambda k: (-len(k), k)):
            if base.startswith(prefix):
                v = self.map[prefix]
                if isinstance(v, str):
                    out = (v, weight, italic)
                else:
                    out = (v["family"], int(v.get("weight", weight)), bool(v.get("italic", italic)))
                break
        if out is None and self.table:
            ps = base if base in self.table else None
            if ps is None:
                cands = [p for p in self.table if p.startswith(base) or base.startswith(p)]
                cands += [p for p in self.table if p.lower() == base.lower()]
                if cands:
                    ps = sorted(cands, key=lambda p: (-len(p), p))[0]
            if ps:
                fam, w, st, _ = self.table[ps]
                out = (fam, w, st == "italic")
        if out is None:
            out = (_split_camel(fam_part) or base, weight, italic)
        self.cache[key] = out
        self.seen[base] = out
        return out


# ---------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------


def open_pdf(path: str | Path) -> fitz.Document:
    return fitz.open(str(path))


def trim_origin(page: fitz.Page) -> tuple[float, float, float, float]:
    """(x0, y0) of the trim box in page points, and its width and height in mm."""
    r = page.rect
    try:
        tb = page.trimbox
        if tb.width > 10 and tb.height > 10 and r.contains(tb):
            r = tb
    except Exception:
        pass
    return r.x0, r.y0, r.width * PT_MM, r.height * PT_MM


def to_mm(rect: Any, origin: tuple) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = rect
    return ((x0 - origin[0]) * PT_MM, (y0 - origin[1]) * PT_MM, (x1 - origin[0]) * PT_MM, (y1 - origin[1]) * PT_MM)


def to_pt(box: tuple, origin: tuple) -> fitz.Rect:
    return fitz.Rect(box[0] * MM + origin[0], box[1] * MM + origin[1], box[2] * MM + origin[0], box[3] * MM + origin[1])


def area(b: tuple) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def inter(a: tuple, b: tuple) -> float:
    return area((max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])))


def inside_mm(inner: tuple, outer: tuple, tol: float = 0.5) -> bool:
    return inner[0] >= outer[0] - tol and inner[1] >= outer[1] - tol and inner[2] <= outer[2] + tol and inner[3] <= outer[3] + tol


def centre_in(inner: tuple, outer: tuple, tol: float = 0.0) -> bool:
    cx, cy = (inner[0] + inner[2]) / 2, (inner[1] + inner[3]) / 2
    return outer[0] - tol <= cx <= outer[2] + tol and outer[1] - tol <= cy <= outer[3] + tol


def hoverlap(a: tuple, b: tuple) -> float:
    return min(a[2], b[2]) - max(a[0], b[0])


def union(boxes: list[tuple]) -> tuple:
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def r2(b: tuple) -> list[float]:
    return [round(v, 2) for v in b]


# ---------------------------------------------------------------------------
# renders: what prints
# ---------------------------------------------------------------------------


class Renders:
    """Three renders of a page at CHECK_DPI: as printed (rgb), without its
    text (bare), and the text alone (ink)."""

    def __init__(self, pdf_path: str | Path, pno: int):
        import numpy as np

        self.np = np
        self.k = CHECK_DPI / 72
        doc = fitz.open(str(pdf_path))
        page = doc[pno]
        self.rect = page.rect
        self.rgb = self._pix(page, rgb=True)
        doc2 = fitz.open(str(pdf_path))
        p2 = doc2[pno]
        p2.add_redact_annot(p2.rect, fill=False)
        p2.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                            text=fitz.PDF_REDACT_TEXT_REMOVE)
        self.bare = self._pix(p2, rgb=True)
        doc3 = fitz.open(str(pdf_path))
        p3 = doc3[pno]
        p3.add_redact_annot(p3.rect, fill=False)
        p3.apply_redactions(images=fitz.PDF_REDACT_IMAGE_REMOVE, graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
                            text=fitz.PDF_REDACT_TEXT_NONE)
        self.ink = self._pix(p3, rgb=False)

    def _pix(self, page: fitz.Page, rgb: bool):
        np = self.np
        pm = page.get_pixmap(dpi=CHECK_DPI, colorspace=fitz.csRGB if rgb else fitz.csGRAY, alpha=False)
        a = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.stride)
        if rgb:
            return a[:, :pm.width * 3].reshape(pm.height, pm.width, 3).astype(int)
        return a[:, :pm.width].astype(int)

    def _win(self, bbox_pt: tuple) -> tuple[int, int, int, int]:
        x0 = int((bbox_pt[0] - self.rect.x0) * self.k)
        y0 = int((bbox_pt[1] - self.rect.y0) * self.k)
        x1 = int((bbox_pt[2] - self.rect.x0) * self.k) + 1
        y1 = int((bbox_pt[3] - self.rect.y0) * self.k) + 1
        h, w = self.ink.shape
        return max(0, x0), max(0, y0), min(w, x1), min(h, y1)

    def text_visible(self, bbox_pt: tuple) -> bool:
        x0, y0, x1, y1 = self._win(bbox_pt)
        if x1 <= x0 or y1 <= y0:
            return False
        d = abs(self.rgb[y0:y1, x0:x1] - self.bare[y0:y1, x0:x1]).sum(axis=2)
        glyphs = self.ink[y0:y1, x0:x1] < 128
        if glyphs.sum() >= 6:
            return float((d[glyphs] > 45).mean()) > 0.5
        return int(d.max()) > 60 if d.size else False

    def shape_visible(self, bbox_pt: tuple, fill: str | None, stroke: str | None) -> bool:
        """Does the shape's paint show on the printed page?"""
        x0, y0, x1, y1 = self._win(bbox_pt)
        if x1 - x0 < 2 or y1 - y0 < 2:
            return True
        img = self.bare
        if fill and not stroke:
            want = tuple(round(v * 255) for v in td.hex_rgb(fill))
            pts = []
            for i in range(1, 8):
                for j in range(1, 8):
                    pts.append((x0 + (x1 - x0) * i // 8, y0 + (y1 - y0) * j // 8))
            ok = sum(1 for x, y in pts if rgb_dist(img[y, x], want) < 60)
            return ok >= 0.3 * len(pts)
        if stroke and not fill:
            want = tuple(round(v * 255) for v in td.hex_rgb(stroke))
            pts = []
            for i in range(1, 6):
                xs, ys = x0 + (x1 - x0) * i // 6, y0 + (y1 - y0) * i // 6
                pts += [(xs, y0), (xs, y1 - 1), (x0, ys), (x1 - 1, ys)]
            ok = 0
            for x, y in pts:
                win = img[max(0, y - 2):y + 3, max(0, x - 2):x + 3].reshape(-1, 3)
                if any(rgb_dist(p, want) < 80 for p in win):
                    ok += 1
            return ok >= 0.25 * len(pts)
        return True

    def ink_fraction(self, bbox_pt: tuple, background: str | None) -> float:
        """Share of the box's pixels in the text-free render that differ from
        `background`: art under a word."""
        x0, y0, x1, y1 = self._win(bbox_pt)
        if x1 <= x0 or y1 <= y0:
            return 0.0
        want = self.np.array([round(v * 255) for v in td.hex_rgb(background or "#ffffff")])
        d = abs(self.bare[y0:y1, x0:x1] - want).sum(axis=2)
        return float((d > 45).mean())

    def colour_at(self, bbox_pt: tuple) -> str:
        x0, y0, x1, y1 = self._win(bbox_pt)
        win = self.bare[y0:y1, x0:x1].reshape(-1, 3)
        if not len(win):
            return "#ffffff"
        med = self.np.median(win, axis=0)
        return "#%02x%02x%02x" % tuple(int(v) for v in med)


# ---------------------------------------------------------------------------
# text
# ---------------------------------------------------------------------------


class Char:
    __slots__ = ("c", "x0", "y0", "x1", "y1", "oy", "family", "weight", "italic", "size", "color", "mark")

    def __init__(self, c, x0, y0, x1, y1, oy, family, weight, italic, size, color, mark=None):
        self.c, self.x0, self.y0, self.x1, self.y1, self.oy = c, x0, y0, x1, y1, oy
        self.family, self.weight, self.italic, self.size, self.color, self.mark = family, weight, italic, size, color, mark


class Line:
    """One printed line (pieces of it joined), coordinates in mm."""

    def __init__(self, chars: list[Char], rotate: float = 0.0):
        self.chars = chars
        self.rotate = rotate
        self.refresh()

    def refresh(self) -> None:
        ink = [c for c in self.chars if c.c.strip()] or self.chars
        self.x0 = min(c.x0 for c in ink)
        self.x1 = max(c.x1 for c in ink)
        self.y0 = min(c.y0 for c in ink)
        self.y1 = max(c.y1 for c in ink)
        self.base = statistics.median(c.oy for c in ink)
        counts: dict[tuple, int] = {}
        for c in ink:
            k = (c.family, round(c.size * 2) / 2, c.color)
            counts[k] = counts.get(k, 0) + 1
        self.family, self.size, self.color = max(counts, key=lambda k: (counts[k], k))
        self.weight = min(c.weight for c in ink)
        self.italic = all(c.italic for c in ink)
        self.allbold = min(c.weight for c in ink) >= 600

    @property
    def plain(self) -> str:
        return "".join(c.c for c in self.chars).strip()

    @property
    def box(self) -> tuple:
        return (self.x0, self.y0, self.x1, self.y1)

    @property
    def size_mm(self) -> float:
        return self.size * PT_MM

    def label_dict(self, mark_ids: dict | None = None, mode: str = "mark") -> dict:
        return {"text": runs_markdown(self.chars, self.weight, self.italic, mark_ids or {}, mode), "plain": self.plain,
                "x0": self.x0, "y0": self.y0, "x1": self.x1, "y1": self.y1, "base": self.base,
                "size": self.size, "family": self.family, "weight": self.weight, "italic": self.italic,
                "color": self.color, "rotate": self.rotate}


def read_lines(pdf_path: str | Path, page: fitz.Page, fonts: Fonts, origin: tuple,
               renders: Renders | None = None) -> tuple[list[Line], list[str]]:
    """The printed lines of a page and the texts left out as hidden."""
    renders = renders or Renders(pdf_path, page.number)
    ox, oy, w_mm, h_mm = origin
    trim = (0.0, 0.0, w_mm, h_mm)
    pieces: list[Line] = []
    hidden: list[str] = []
    raw = page.get_text("rawdict", flags=FLAGS)
    for block in raw["blocks"]:
        if block.get("type", 0) != 0:
            continue
        for line in block["lines"]:
            dx, dy = line.get("dir", (1, 0))
            rot = math.degrees(math.atan2(dy, dx))
            chars: list[Char] = []
            for span in line["spans"]:
                text = "".join(ch["c"] for ch in span["chars"])
                if not text.strip():
                    for ch in span["chars"]:
                        b = to_mm(ch["bbox"], origin)
                        chars.append(Char(" ", b[0], b[1], b[2], b[3], (ch["origin"][1] - oy) * PT_MM, "", 400,
                                          False, span["size"], "#000000"))
                    continue
                sb = to_mm(span["bbox"], origin)
                if not centre_in(sb, trim) or not renders.text_visible(span["bbox"]):
                    hidden.append(text.strip())
                    continue
                fam, weight, italic = fonts.face(span["font"], span["flags"])
                col = hexc(span["color"]) or "#000000"
                for ch in span["chars"]:
                    b = to_mm(ch["bbox"], origin)
                    chars.append(Char(ch["c"], b[0], b[1], b[2], b[3], (ch["origin"][1] - oy) * PT_MM, fam, weight,
                                      italic, span["size"], col))
            if any(c.c.strip() for c in chars):
                for c in chars:
                    if not c.family:   # spaces take the face of the text before them
                        c.family = next((d.family for d in chars if d.family), "")
                pieces.append(Line(chars, rot if abs(rot) >= 1 else 0.0))
    return merge_pieces(pieces), hidden


def merge_pieces(pieces: list[Line]) -> list[Line]:
    """Join the pieces MuPDF splits one printed line into."""
    pieces = sorted(pieces, key=lambda l: (round(l.base, 1), l.x0))
    out: list[Line] = []
    for p in pieces:
        host = None
        if not p.rotate:
            for q in out:
                if q.rotate:
                    continue
                gap = p.x0 - q.x1
                tol = max(p.size_mm, q.size_mm)
                if abs(p.base - q.base) < 0.3 * tol and -0.3 * tol < gap < 1.0 * tol:
                    host = q
                    break
        if host is None:
            out.append(p)
            continue
        if p.x0 - host.x1 > 0.12 * host.size_mm and host.chars[-1].c != " " and p.chars[0].c != " ":
            last = host.chars[-1]
            host.chars.append(Char(" ", last.x1, last.y0, p.x0, last.y1, last.oy, last.family, last.weight,
                                   last.italic, last.size, last.color))
        host.chars.extend(p.chars)
        host.refresh()
    return sorted(out, key=lambda l: (round(l.base, 1), l.x0))


def runs_markdown(chars: list[Char], base_weight: int, base_italic: bool, mark_ids: dict, mode: str) -> str:
    """Inline Markdown of a run of characters: bold, italic, highlight marks."""
    segs: list[tuple[Any, list[pmd.Run]]] = []
    for c in chars:
        bold = c.weight >= max(600, base_weight + 200) if c.c.strip() else False
        italic = c.italic and not base_italic if c.c.strip() else False
        mk = mark_ids.get(c.mark) if c.mark else None
        if not segs or segs[-1][0] != mk:
            segs.append((mk, []))
        runs = segs[-1][1]
        if runs and runs[-1].bold == bold and runs[-1].italic == italic:
            runs[-1].text += c.c
        else:
            runs.append(pmd.Run(c.c, bold=bold, italic=italic))
    out = []
    for mk, runs in segs:
        text = "".join(r.text for r in runs)
        if mk and text.strip() and "[" not in text and "]" not in text:
            lead = text[: len(text) - len(text.lstrip())]
            trail = text[len(text.rstrip()):]
            inner = pmd.render_runs(runs)
            out.append(f'{lead}:{mode}[{inner}]{{style="{mk}"}}{trail}')
        elif text.strip():
            lead = text[: len(text) - len(text.lstrip())]
            trail = text[len(text.rstrip()):]
            out.append(lead + pmd.render_runs(runs) + trail)
        else:
            out.append(text)
    s = "".join(out)
    return re.sub(r"[ ]{2,}", " ", s).strip()


# ---------------------------------------------------------------------------
# shapes
# ---------------------------------------------------------------------------


class Shape:
    def __init__(self, d: dict, origin: tuple):
        self.rect_pt = tuple(d["rect"])
        self.box = to_mm(d["rect"], origin)
        self.fill = hexc(d.get("fill")) if d.get("fill") is not None and (d.get("fill_opacity") or 1) > 0.2 else None
        self.stroke = hexc(d.get("color")) if d.get("color") is not None and (d.get("stroke_opacity") or 1) > 0.2 else None
        self.width = float(d.get("width") or 0)
        self.items = d.get("items", [])
        self.seq = d.get("seqno", 0)
        self.kind = "art"
        self.origin = origin

    @property
    def w(self) -> float:
        return self.box[2] - self.box[0]

    @property
    def h(self) -> float:
        return self.box[3] - self.box[1]

    def points(self) -> list[tuple[float, float]]:
        pts = []
        for it in self.items:
            if it[0] == "l":
                pts += [it[1], it[2]]
            elif it[0] == "c":
                pts += [it[1], it[4]]
            elif it[0] == "re":
                r = it[1]
                pts += [(r.x0, r.y0), (r.x1, r.y1)]
            elif it[0] == "qu":
                q = it[1]
                pts += [q.ul, q.ur, q.ll, q.lr]
        return [((p[0] - self.origin[0]) * PT_MM, (p[1] - self.origin[1]) * PT_MM) for p in pts]

    def rect_like(self) -> bool:
        if not self.items or len(self.items) > 16:
            return False
        if all(it[0] == "re" for it in self.items):
            return True
        x0, y0, x1, y1 = self.box
        for x, y in self.points():
            if min(abs(x - x0), abs(x - x1), abs(y - y0), abs(y - y1)) > 1.0:
                return False
        return True

    def radius(self) -> float:
        rs = []
        for it in self.items:
            if it[0] == "c":
                p1, p4 = it[1], it[4]
                rs.append(max(abs(p4[0] - p1[0]), abs(p4[1] - p1[1])) * PT_MM)
        return round(statistics.median(rs), 2) if rs else 0.0

    def band(self) -> tuple | None:
        """A highlighter stroke: a wide horizontal line. Its painted box."""
        if self.fill is not None or self.stroke is None or self.width < 4:
            return None
        if not self.items or any(it[0] != "l" or abs(it[1][1] - it[2][1]) > 0.2 for it in self.items):
            return None
        half = self.width / 2 * PT_MM
        return (self.box[0], self.box[1] - half, self.box[2], self.box[3] + half)


def classify(page: fitz.Page, lines: list[Line], origin: tuple, renders: Renders, opts: argparse.Namespace) -> dict:
    """Sort the page's shapes and images into ground, cards, highlight bands,
    tabs, boxes and pictures."""
    w_mm, h_mm = origin[2], origin[3]
    page_area = w_mm * h_mm
    shapes = [Shape(d, origin) for d in page.get_drawings()]
    out: dict[str, list] = {"ground": [], "cards": [], "bands": [], "tabs": [], "boxes": [], "art": []}
    # highlight bands: wide strokes or fills hugging words on a line
    for s in shapes:
        b = s.band()
        col = s.stroke
        if b is None and s.fill and s.rect_like() and s.h < 9:
            b, col = s.box, s.fill
        if b is None or whiteish(col):
            continue
        over = [c for l in lines for c in l.chars if c.c.strip() and centre_in((c.x0, c.y0, c.x1, c.y1), b)]
        if not over:
            continue
        size = statistics.median(c.size for c in over) * PT_MM
        bh = b[3] - b[1]
        if not (0.6 * size <= bh <= 2.4 * size):
            continue
        if s.band() is None:   # a filled band must hug its words
            x0, x1 = min(c.x0 for c in over), max(c.x1 for c in over)
            if x0 - b[0] > 1.5 or b[2] - x1 > 1.5:
                continue
        s.kind = "band"
        out["bands"].append({"box": b, "color": col, "shape": s})
    for s in shapes:
        if s.kind == "band":
            continue
        a = area(s.box)
        if s.fill and not s.stroke and whiteish(s.fill) and opts.card_area * page_area <= a < 0.97 * page_area \
                and s.rect_like():
            s.kind = "card"
        elif s.fill and a >= 0.6 * page_area:
            s.kind = "ground"
        elif s.rect_like() and (s.fill or s.stroke) and s.w >= 6 and s.h >= 4 and a < 0.6 * page_area:
            if not renders.shape_visible(s.rect_pt, s.fill, None) and not (s.stroke and renders.shape_visible(s.rect_pt, None, s.stroke)):
                s.kind = "hidden"
                continue
            held = [l for l in lines if not l.rotate and inside_mm(l.box, s.box, 1.0)]
            part = [l for l in lines if not l.rotate and inter(l.box, s.box) > 0.3 * area(l.box) and l not in held]
            if 4 <= s.h <= 13 and s.w >= 6 and s.fill and len(held) == 1 and not part \
                    and len(held[0].plain.split()) <= 10 \
                    and (held[0].x1 - held[0].x0 >= 0.4 * s.w or s.w < 40):
                s.kind = "tab"
                s.line = held[0]
            else:
                s.kind = "box-candidate"
        if s.kind in ("ground", "card"):
            out["ground" if s.kind == "ground" else "cards"].append(s)
    # a stroke and a fill of the same rectangle are one box
    cands = [s for s in shapes if s.kind == "box-candidate"]
    merged: list[Shape] = []
    for s in sorted(cands, key=lambda s: s.seq):
        twin = next((m for m in merged if all(abs(a - b) < 1.0 for a, b in zip(m.box, s.box))), None)
        if twin:
            twin.fill = twin.fill or s.fill
            twin.stroke = twin.stroke or s.stroke
            twin.width = twin.width or s.width
            s.kind = "twin"
        else:
            merged.append(s)
    tabs = [s for s in shapes if s.kind == "tab"]
    # a tab with another tab on its top edge is a one-line box
    for t in list(tabs):
        if any(o is not t and o.box[1] < t.box[1] - 0.5 and o.box[3] >= t.box[1] - 1.0 and o.box[3] <= t.box[1] + 3.0
               and hoverlap(o.box, t.box) > 0.5 * min(o.w, t.w) for o in tabs):
            t.kind = "box-candidate"
            merged.append(t)
            tabs.remove(t)
    for t in tabs:
        out["tabs"].append(t)
    # images
    images = []
    for info in page.get_image_info(xrefs=True):
        b = to_mm(info["bbox"], origin)
        b = (max(b[0], 0), max(b[1], 0), min(b[2], w_mm), min(b[3], h_mm))
        if area(b) <= 0:
            continue
        if area(b) >= 0.6 * page_area:
            out["ground"].append({"image": info})
            continue
        images.append({"box": b, "info": info})
    # boxes hold text or pictures; empty rectangles are art
    curvy = [s for s in shapes if s.kind == "art" and not s.rect_like()]
    for s in merged:
        drawn = [o.box for o in curvy if inside_mm(o.box, s.box, 0.5)]
        sentences = any(centre_in(l.box, s.box) and len(l.plain.split()) > 5 for l in lines)
        if len(drawn) >= opts.art_shapes and not sentences and area(union(drawn)) >= 0.45 * area(s.box):
            s.kind = "art"      # the ground of a map or a drawing, not a box
            continue
        holds_text = any(centre_in(l.box, s.box) for l in lines)
        holds_pic = any(inside_mm(i["box"], s.box, 1.0) for i in images)
        holds_box = any(o is not s and inside_mm(o.box, s.box, 0.5) for o in merged + tabs)
        if (holds_text or holds_pic or holds_box) and s.w >= 10 and s.h >= 6:
            s.kind = "box"
            out["boxes"].append(s)
        else:
            s.kind = "art"
    # line art: everything else that paints, clustered with the small images
    in_tab = lambda b: any(inside_mm(b, t.box, 0.3) for t in tabs)  # noqa: E731
    art = [s for s in shapes if s.kind == "art" and area(s.box) < 0.5 * page_area and not in_tab(s.box)
           and (s.w > 0.2 or s.h > 0.2)]
    items = [{"box": s.box, "n": 1, "images": []} for s in art]
    big = []
    for im in images:
        if min(im["box"][2] - im["box"][0], im["box"][3] - im["box"][1]) < opts.min_picture:
            items.append({"box": im["box"], "n": 1, "images": [im]})
        else:
            big.append(im)
    clusters = cluster_boxes(items, opts.art_gap)
    pictures = []
    for im in big:
        pictures.append({"box": im["box"], "images": [im], "vector": 0})
    for c in clusters:
        b = c["box"]
        if min(b[2] - b[0], b[3] - b[1]) < opts.min_picture or (c["n"] < 3 and not c["images"]):
            continue
        pictures.append({"box": b, "images": c["images"], "vector": c["n"] - len(c["images"])})
    # pictures that overlap become one (a photo on a drawn map)
    pictures = merge_pictures(pictures)
    # A picture that lies on a card is cut no further than the card: a map whose
    # overflow is masked by white rectangles at the card's edge, and the folio's
    # icons a millimetre from them, would otherwise carry a strip of the page's
    # own colour past the card, which then covers the ground when another
    # edition's shorter text moves the picture up.
    for pic in pictures:
        b = pic["box"]
        card = max((c for c in out["cards"] if inter(b, c.box) > 0.6 * area(b)), key=lambda c: inter(b, c.box), default=None)
        if card is None:
            continue
        cb = card.box
        clipped = (max(b[0], cb[0]), max(b[1], cb[1]), min(b[2], cb[2]), min(b[3], cb[3]))
        if clipped != tuple(b) and clipped[2] - clipped[0] > 8 and clipped[3] - clipped[1] > 8:
            pic["box"] = clipped
    out["pictures"] = [p for p in pictures if area(p["box"]) < 0.6 * page_area]
    out["art"] = art
    return out


def cluster_boxes(items: list[dict], gap: float) -> list[dict]:
    """Union of boxes closer than `gap` mm (deterministic)."""
    items = sorted(items, key=lambda i: (round(i["box"][1], 2), round(i["box"][0], 2)))
    parent = list(range(len(items)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    order = sorted(range(len(items)), key=lambda i: items[i]["box"][0])
    for a_i, i in enumerate(order):
        bi = items[i]["box"]
        for j in order[a_i + 1:]:
            bj = items[j]["box"]
            if bj[0] > bi[2] + gap:
                break
            if bj[1] <= bi[3] + gap and bj[3] >= bi[1] - gap:
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[max(ri, rj)] = min(ri, rj)
    groups: dict[int, list[dict]] = {}
    for i in range(len(items)):
        groups.setdefault(find(i), []).append(items[i])
    out = []
    for k in sorted(groups):
        g = groups[k]
        out.append({"box": union([x["box"] for x in g]), "n": sum(x["n"] for x in g),
                    "images": [im for x in g for im in x["images"]]})
    return out


def merge_pictures(pics: list[dict]) -> list[dict]:
    changed = True
    pics = list(pics)
    while changed:
        changed = False
        for i in range(len(pics)):
            for j in range(i + 1, len(pics)):
                a, b = pics[i], pics[j]
                ov = inter(a["box"], b["box"])
                if ov > 0.3 * min(area(a["box"]), area(b["box"])):
                    pics[i] = {"box": union([a["box"], b["box"]]), "images": a["images"] + b["images"],
                               "vector": a["vector"] + b["vector"]}
                    del pics[j]
                    changed = True
                    break
            if changed:
                break
    return sorted(pics, key=lambda p: (round(p["box"][1], 1), round(p["box"][0], 1)))


# ---------------------------------------------------------------------------
# paragraphs
# ---------------------------------------------------------------------------


def bullet_of(line: Line) -> Char | None:
    first = next((c for c in line.chars if c.c.strip()), None)
    if first is not None and first.c in BULLETS:
        return first
    return None


def paragraphs(lines: list[Line]) -> list[list[Line]]:
    """Chain lines into paragraphs: same look, one leading apart, flush left
    or centred on each other; a bullet or a bold head line starts a new one."""
    order = sorted(lines, key=lambda l: (round(l.base, 1), l.x0))
    paras: list[list[Line]] = []
    for line in order:
        best = None
        if not bullet_of(line):
            for p in paras:
                last = p[-1]
                if (last.family, last.size, last.color) != (line.family, line.size, line.color):
                    continue
                step = line.base - last.base
                size = line.size_mm
                if not (0.8 * size < step < 2.0 * size):
                    continue
                if len(p) > 1 and abs(step - (p[-1].base - p[-2].base)) > 0.25 * size:
                    continue
                if last.allbold and not line.allbold:
                    continue
                left = p[0].x0 if not bullet_of(p[0]) else text_x0(p[0])
                same_left = abs(line.x0 - left) < 3.0 or abs(line.x0 - last.x0) < 1.5
                same_mid = abs((line.x0 + line.x1) / 2 - (last.x0 + last.x1) / 2) < 3.0
                if hoverlap(line.box, last.box) > 0 and (same_left or same_mid):
                    if best is None or step < best[0]:
                        best = (step, p)
        if best:
            best[1].append(line)
        else:
            paras.append([line])
    return sorted(paras, key=lambda p: (round(p[0].base, 1), p[0].x0))


def text_x0(line: Line) -> float:
    b = bullet_of(line)
    if b is None:
        return line.x0
    rest = [c for c in line.chars if c.c.strip() and c is not b]
    return min(c.x0 for c in rest) if rest else line.x0


def para_chars(p: list[Line]) -> list[Char]:
    """The paragraph's characters, lines joined by a space; a hyphen at a
    line end before a lower-case letter joins the word."""
    out: list[Char] = []
    for i, line in enumerate(p):
        chars = list(line.chars)
        b = bullet_of(line) if i == 0 else None
        if b is not None:
            k = chars.index(b)
            chars = chars[k + 1:]
            while chars and not chars[0].c.strip():
                chars = chars[1:]
        while chars and not chars[-1].c.strip():
            chars.pop()
        while chars and not chars[0].c.strip():
            chars = chars[1:]
        if out and chars:
            prev = out[-1]
            if prev.c in "-­" and len(out) > 1 and out[-2].c.isalpha() and chars[0].c.islower():
                out.pop()
            elif prev.c == "­":
                out.pop()
            else:
                out.append(Char(" ", prev.x1, prev.y0, prev.x1, prev.y1, prev.oy, prev.family, prev.weight,
                                prev.italic, prev.size, prev.color, prev.mark if chars[0].mark == prev.mark else None))
        out.extend(chars)
    return out


def para_markdown(p: list[Line], mark_ids: dict, mode: str) -> str:
    chars = para_chars(p)
    ink = [c for c in chars if c.c.strip()]
    if not ink:
        return ""
    base_w = min(c.weight for c in ink)
    base_it = all(c.italic for c in ink)
    return runs_markdown(chars, base_w, base_it, mark_ids, mode)


def para_lead(p: list[Line]) -> float | None:
    steps = [b.base - a.base for a, b in zip(p, p[1:])]
    return statistics.median(steps) if steps else None


#: (family, size) -> the leading measured for that look over all the pages read,
#: for a box whose paragraphs are all one line long
LEADS: dict[tuple, float] = {}


def measure_leads(all_lines: list[list[Line]]) -> None:
    found: dict[tuple, list[float]] = {}
    for lines in all_lines:
        for p in paragraphs(lines):
            s = para_lead(p)
            if s:
                found.setdefault((p[0].family, round(p[0].size * 4) / 4), []).append(s)
    LEADS.clear()
    for k, v in found.items():
        LEADS[k] = round(statistics.median(v), 3)


def dominant(lines: list[Line]) -> dict:
    """The look most of the characters have, and the leading."""
    counts: dict[tuple, int] = {}
    for l in lines:
        for c in l.chars:
            if c.c.strip():
                k = (c.family, round(c.size * 4) / 4, c.color)
                counts[k] = counts.get(k, 0) + 1
    fam, size, col = max(counts, key=lambda k: (counts[k], k))
    weights = [c.weight for l in lines for c in l.chars if c.c.strip() and c.family == fam]
    leads = [s for p in paragraphs(lines) for s in [para_lead(p)] if s]
    lead = statistics.median(leads) if leads else LEADS.get((fam, size), size * PT_MM * 1.25)
    return {"family": fam, "size": size, "color": col, "weight": min(weights) if weights else 400,
            "lead": round(lead, 3)}


# ---------------------------------------------------------------------------
# frames of a page
# ---------------------------------------------------------------------------


class Frame:
    def __init__(self, kind: str, box: tuple, **kw):
        self.kind = kind          # title | text | box | tab | picture | figure
        self.box = box
        self.name = ""
        self.lines: list[Line] = kw.get("lines", [])
        self.shape = kw.get("shape")
        self.tab = kw.get("tab")
        self.picture = kw.get("picture")
        self.parent: Frame | None = None
        self.overlay = False
        self.zone = -1
        self.style: dict | None = None
        self.style_id: str | None = None
        self.md = ""
        self.level = 0
        self.rotate = kw.get("rotate", 0.0)
        self.config: dict = {}
        self.resource: dict | None = None
        self.labels: list[dict] = []
        self.text_box = None


def build_page(pdf_path: str, doc: fitz.Document, pno: int, fonts: Fonts, opts: argparse.Namespace,
               ctx: dict, cache: dict) -> dict:
    page = doc[pno]
    origin = trim_origin(page)
    W, H = origin[2], origin[3]
    renders = cache["renders"]
    lines, hidden = cache["lines"], cache["hidden"]
    sh = cache["shapes"]
    report: dict[str, Any] = {"page": pno + 1, "hidden": hidden, "notes": []}
    for b in sh["bands"]:
        for l in lines:
            for c in l.chars:
                if c.c.strip() and centre_in((c.x0, c.y0, c.x1, c.y1), b["box"]):
                    c.mark = b["color"]
    for l in lines:   # a space between two marked words is marked too
        ink = [i for i, c in enumerate(l.chars) if c.c.strip()]
        for i, c in enumerate(l.chars):
            if c.c.strip():
                continue
            before = [j for j in ink if j < i]
            after = [j for j in ink if j > i]
            c.mark = l.chars[before[-1]].mark if before and after and l.chars[before[-1]].mark == l.chars[after[0]].mark else None
    cards = sorted(sh["cards"], key=lambda s: (round(s.box[1], 1), s.box[0]))
    boxes = sh["boxes"]
    tabs = sh["tabs"]
    pictures = sh["pictures"]

    # tabs on a box's top edge belong to the box
    attached: dict[int, Shape] = {}
    free_tabs = []
    for t in sorted(tabs, key=lambda t: (t.box[1], t.box[0])):
        best = None
        for b in boxes:
            if hoverlap(t.box, b.box) <= 0.5 * min(t.w, b.w):
                continue
            straddles = t.box[3] >= b.box[1] - 1.0 and t.box[1] <= b.box[1] + 1.5
            if straddles and t.box[0] >= b.box[0] - 1.0 and t.box[2] <= b.box[2] + 1.0 and id(b) not in attached:
                d = abs(t.box[3] - b.box[1])
                if best is None or d < best[0]:
                    best = (d, b)
        if best:
            attached[id(best[1])] = t
        else:
            free_tabs.append(t)

    def container_bg(box: tuple) -> str:
        cands = [b for b in boxes if inside_mm(box, b.box, 0.5) and b.fill]
        if cands:
            return min(cands, key=lambda b: area(b.box)).fill
        cands = [c for c in cards if inside_mm(box, c.box, 0.5)]
        if cands:
            return cands[0].fill or "#ffffff"
        return renders.colour_at(to_pt(box, origin))

    # small words just off a picture's edge (a globe's degrees) are its lettering:
    # the picture's box takes them in
    body_size = ctx["heading_min"] / 1.35
    for p in pictures:
        for _ in range(8):      # a row of degrees round a globe: one word after another
            near = (p["box"][0] - opts.label_reach, p["box"][1] - opts.label_reach,
                    p["box"][2] + opts.label_reach, p["box"][3] + opts.label_reach)
            extra = [l.box for l in lines if inside_mm(l.box, near, 0.0) and not inside_mm(l.box, p["box"], 1.0)
                     and few_words(l.plain) and l.size <= 0.8 * body_size
                     and not any(inside_mm(l.box, t.box, 1.0) for t in tabs)]
            if not extra:
                break
            p["box"] = union([p["box"]] + extra)
    # every line to its owner
    owners: dict[int, Any] = {}
    for l in lines:
        cands: list[tuple[float, str, Any]] = []
        for t in tabs:
            if inside_mm(l.box, t.box, 1.0):
                cands.append((area(t.box), "tab", t))
        for b in boxes:
            if centre_in(l.box, b.box):
                cands.append((area(b.box), "box", b))
        for p in pictures:
            if inside_mm(l.box, p["box"], 1.0):
                bg = container_bg(p["box"])
                # a word on the art, or a short one set on the picture's margin (a map's degrees)
                if few_words(l.plain) or renders.ink_fraction(to_pt(l.box, origin), bg) >= opts.label_ink:
                    cands.append((area(p["box"]), "picture", p))
        if cands:
            owners[id(l)] = min(cands, key=lambda c: c[0])[1:]
        elif cards and any(centre_in(l.box, c.box) for c in cards):
            owners[id(l)] = ("free", None)
        elif not cards and opts.margin_band < l.y0 and l.y1 < H - opts.margin_band:
            owners[id(l)] = ("free", None)
        elif len(l.plain.split()) > 8:
            owners[id(l)] = ("free", None)
        else:
            owners[id(l)] = ("furniture", None)

    frames: list[Frame] = []
    # boxes
    box_frames: dict[int, Frame] = {}
    for b in boxes:
        t = attached.get(id(b))
        fb = union([b.box, t.box]) if t else b.box
        f = Frame("box", fb, shape=b, tab=t)
        f.lines = [l for l in lines if owners[id(l)] == ("box", b)]
        box_frames[id(b)] = f
        frames.append(f)
    for t in free_tabs:
        f = Frame("tab", t.box, shape=t)
        f.lines = [l for l in lines if owners[id(l)] == ("tab", t)]
        frames.append(f)
    for p in pictures:
        f = Frame("picture", p["box"], picture=p)
        f.lines = [l for l in lines if owners[id(l)] == ("picture", p)]
        if f.lines:
            f.kind = "figure"
        frames.append(f)
    # free text: headings alone, rotated lines alone, the rest in blocks
    free = [l for l in lines if owners[id(l)][0] == "free"]
    heads = [l for l in free if l.size >= ctx["heading_min"] and not l.rotate]
    for l in [l for l in free if l.rotate]:
        frames.append(Frame("text", l.box, lines=[l], rotate=l.rotate))
    body = [l for l in free if l not in heads and not l.rotate]
    for hp in paragraphs(heads):
        frames.append(Frame("title", set_box(hp, 1.0), lines=hp))
    for blk in text_blocks(body, frames):
        frames.append(Frame("text", set_box(blk, None), lines=blk))
    furniture = [l for l in lines if owners[id(l)][0] == "furniture"]

    # zones (cards) and containment
    for f in frames:
        best = None
        for k, c in enumerate(cards):
            ov = inter(f.box, c.box)
            if ov >= 0.3 * max(area(f.box), 1e-6) and (best is None or ov > best[0]):
                best = (ov, k)
        f.zone = best[1] if best else -1
    for f in frames:
        cands = [g for g in frames if g is not f and g.kind in ("box", "text", "figure", "picture")
                 and area(g.box) > area(f.box) and inter(f.box, g.box) >= 0.8 * area(f.box)]
        if f.kind in ("text", "title"):
            cands = [g for g in cands if g.kind == "box"]
        if f.kind == "box":
            cands = [g for g in cands if g.kind in ("box", "figure", "picture")]
        if cands:
            f.parent = min(cands, key=lambda g: area(g.box))
        elif f.kind in ("picture", "figure"):
            # a picture laid over a text frame or a box: it pushes that text
            over = [g for g in frames if g is not f and g.kind in ("text", "box") and inter(f.box, g.box) >= 0.2 * area(f.box)]
            if over:
                f.parent = max(over, key=lambda g: inter(f.box, g.box))
                f.overlay = True

    # reading order: top-level frames by XY cut, children after their parent
    top = [f for f in frames if f.parent is None]
    ordered: list[Frame] = []

    def emit(f: Frame) -> None:
        ordered.append(f)
        kids = [g for g in frames if g.parent is f]
        for g in xy_order(kids):
            emit(g)

    for f in xy_order(top):
        emit(f)

    # names
    counters: dict[str, int] = {}
    for f in ordered:
        role = {"title": "title", "text": "text", "box": "box", "tab": "tab", "picture": "picture",
                "figure": "figure"}[f.kind]
        counters[role] = counters.get(role, 0) + 1
        n = counters[role]
        if role in ("title", "text"):
            f.name = role if n == 1 else f"{role}-{n}"
        else:
            f.name = f"{role}-{n}"
    flow = next((f for f in ordered if f.kind == "text" and not f.rotate and sum(len(l.plain.split()) for l in f.lines) >= 8),
                next((f for f in ordered if f.kind == "text" and not f.rotate), None))
    if flow is not None and flow.name != "text":
        other = next((f for f in ordered if f.name == "text"), None)
        if other is not None:
            other.name = flow.name
        flow.name = "text"

    # styles, content, resources
    rid_base = f"{opts.prefix}{pno + 1:02d}"
    res: list[dict] = []
    for f in ordered:
        describe_frame(f, ctx, opts, report)
    pic_n = 0
    for f in ordered:
        if f.kind in ("picture", "figure"):
            pic_n += 1
            rid = f"{rid_base}-{f.name}"
            f.resource = cut_picture(pdf_path, doc, pno, f, origin, rid, opts, renders)
            res.append(f.resource)
            if f.kind == "figure":
                items = [l.label_dict(ctx["mark_ids"], opts.highlights) for l in f.lines]
                groups = anc.merge_lines(items, merge=not opts.no_merge_labels)
                ctx["label_groups"].append(groups)
                f.labels = groups

    # geometry and the template
    template = make_template(rid_base, ordered, cards, origin, opts, report)
    deco, attrs = furniture_decoration(furniture, pno, origin, ctx, report)
    ground_id = f"{rid_base}-ground"
    gfile = cut_ground(pdf_path, pno, origin, sh, ordered, opts, ground_id)
    res.insert(0, {"id": ground_id, "typeId": "ground", "kind": "bitmap", "file": gfile["file"],
                   "width": gfile["width"], "height": gfile["height"], "resolution": opts.ground_dpi,
                   "caption": "", "altText": ""})
    template["decoration"] = {"elements": [
        {"kind": "image", "id": "ground", "resourceId": "{attr.ground}", "decorative": True,
         "placement": {"anchor": {"to": "page", "edge": "top-left"},
                       "size": {"width": mmv(W), "height": mmv(H)}}}] + deco}
    attrs = {"ground": ground_id, **attrs}
    if opts.overlay:
        write_overlay(pdf_path, pno, origin, ordered, Path(opts.out) / "overlay" / f"p{pno + 1:02d}.png")
    report["frames"] = {k: sum(1 for f in ordered if f.kind == k) for k in ("title", "text", "box", "tab", "picture", "figure")}
    report["furniture"] = [l.plain for l in furniture]
    regions = {"page": pno + 1, "trim": [round(W, 2), round(H, 2)],
               "cards": [r2(c.box) for c in cards],
               "frames": [{"name": f.name, "kind": f.kind, "box": r2(f.box), "parent": f.parent.name if f.parent else None,
                           "overlay": f.overlay, "zone": f.zone, "style": f.style_id,
                           "text": " / ".join(l.plain for l in f.lines)[:300]} for f in ordered],
               "bands": [{"box": r2(b["box"]), "color": b["color"]} for b in sh["bands"]],
               "hidden": hidden, "furniture": [l.plain for l in furniture]}
    return {"template": template, "frames": ordered, "resources": res, "attrs": attrs, "report": report,
            "regions": regions}


def set_box(lines: list[Line], lead_em: float | None) -> tuple:
    """The box the engine gives these lines: the first baseline 0.8 of a
    line below the top, the last line's foot 0.2 of a line below its
    baseline. `lead_em`: the leading in ems (headings), else measured."""
    look = dominant(lines)
    lead = lines[0].size_mm * lead_em if lead_em else look["lead"]
    first = min(l.base for l in lines)
    last = max(l.base for l in lines)
    return (min(l.x0 for l in lines), first - 0.8 * lead, max(l.x1 for l in lines), last + 0.2 * lead)


OVERLAY = {"title": (0.85, 0.1, 0.1), "text": (0.1, 0.4, 0.9), "box": (0.0, 0.6, 0.2), "tab": (0.9, 0.5, 0.0),
           "picture": (0.6, 0.1, 0.7), "figure": (0.8, 0.0, 0.6)}


def write_overlay(pdf_path: str, pno: int, origin: tuple, frames: list, out: Path, dpi: int = 60) -> None:
    """The source page with every frame outlined and named."""
    doc = fitz.open(str(pdf_path))
    page = doc[pno]
    for f in frames:
        r = to_pt(f.box, origin)
        col = OVERLAY.get(f.kind, (0, 0, 0))
        page.draw_rect(r, color=col, width=1.2, dashes="[3 2] 0" if f.parent is not None else None)
        page.insert_text((r.x0 + 1, r.y0 + 7), f.name, fontsize=7, color=col)
    out.parent.mkdir(parents=True, exist_ok=True)
    page.get_pixmap(dpi=dpi).save(str(out))


def few_words(text: str) -> bool:
    """Up to three words, or figures and signs with few letters (`20 °N 10 °N`)."""
    return len(text.split()) <= 3 or sum(ch.isalpha() for ch in text) <= 6


def text_blocks(lines: list[Line], frames: list[Frame]) -> list[list[Line]]:
    """Paragraphs of free text grouped into blocks: one under another, the
    same left edge (or centre), no frame between them."""
    paras = paragraphs(lines)
    blocks: list[list[list[Line]]] = []
    for p in paras:
        host = None
        for blk in blocks:
            q = blk[-1]
            last = q[-1]
            lead = para_lead(q) or para_lead(p) or last.size_mm * 1.3
            gap = p[0].base - last.base
            same_left = abs(text_x0(p[0]) - text_x0(q[0])) < 3.5 or abs(p[0].x0 - q[0].x0) < 3.5 \
                or (bullet_of(q[0]) and abs(p[0].x0 - text_x0(q[0])) < 1.5)
            same_mid = abs((p[0].x0 + p[0].x1) / 2 - (q[0].x0 + q[0].x1) / 2) < 3.0
            if not (same_left or same_mid) or not (0 < gap < 2.6 * max(lead, 4.0)):
                continue
            if abs(p[0].size - last.size) > 1.5 or p[0].family != last.family:
                continue
            between = (min(q[0].x0, p[0].x0), last.y1, max(q[0].x1, p[0].x1), p[0].y0)
            if any(inter(between, f.box) > 1.0 for f in frames):
                continue
            host = blk
        if host is not None:
            host.append(p)
        else:
            blocks.append([p])
    return [[l for p in blk for l in p] for blk in blocks]


def xy_order(frames: list[Frame]) -> list[Frame]:
    """Reading order by recursive XY cut: bands top to bottom, columns left
    to right inside a band."""
    if len(frames) <= 1:
        return list(frames)

    def cut(items: list[Frame], axis: int) -> list[list[Frame]] | None:
        lo, hi = (1, 3) if axis == 1 else (0, 2)
        spans = sorted((f.box[lo], f.box[hi]) for f in items)
        groups: list[list[Frame]] = []
        edges = []
        end = spans[0][1]
        for a, b in spans[1:]:
            if a >= end - 0.5:
                edges.append((end + a) / 2)
            end = max(end, b)
        if not edges:
            return None
        bounds = [-1e9] + edges + [1e9]
        for i in range(len(bounds) - 1):
            g = [f for f in items if bounds[i] <= (f.box[lo] + f.box[hi]) / 2 < bounds[i + 1]]
            if g:
                groups.append(g)
        return groups if len(groups) > 1 else None

    parts = cut(frames, 1)
    if parts is None:
        parts = cut(frames, 0)
    if parts is None:
        return sorted(frames, key=lambda f: (round(f.box[1], 1), f.box[0]))
    out = []
    for p in parts:
        out += xy_order(p)
    return out


def describe_frame(f: Frame, ctx: dict, opts: argparse.Namespace, report: dict) -> None:
    """Style and Markdown of one frame."""
    mark_ids = ctx["mark_ids"]
    mode = opts.highlights
    if f.kind in ("picture", "figure"):
        return
    paras = paragraphs(f.lines)
    blocks = []
    in_list = False
    centred = f.kind == "text" and len(f.lines) > 1 and is_centred(f.lines)
    for p in paras:
        size = p[0].size
        if size >= ctx["heading_min"] and f.kind in ("box", "tab", "title"):
            level = ctx["level_of"](size)
            text = " ".join(l.plain for l in p)
            blocks.append(("h", level, text))
            continue
        md = para_markdown(p, mark_ids, mode)
        if not md:
            continue
        if bullet_of(p[0]):
            blocks.append(("li", 0, md))
        else:
            blocks.append(("p", 0, md))
    f.blocks = blocks
    if f.kind == "title":
        f.level = ctx["level_of"](f.lines[0].size) if f.lines else 1
    if f.kind == "tab" and any(b[0] == "h" for b in blocks):
        f.level = next(b[1] for b in blocks if b[0] == "h")
    # style
    if f.kind == "box":
        f.style = box_style(f, ctx, report)
    elif f.kind == "tab":
        f.style = tab_style(f.shape, f.lines, ctx)
    elif f.kind == "text":
        f.style = text_style(f.lines, centred)
    f.centred = centred


def is_centred(lines: list[Line]) -> bool:
    x0s = [l.x0 for l in lines]
    if max(x0s) - min(x0s) < 1.0:
        return False
    mids = [(l.x0 + l.x1) / 2 for l in lines]
    return max(mids) - min(mids) < 1.5


def body_of(look: dict) -> dict:
    return {"fontFamily": look["family"], "fontSize": ptv(look["size"]), "lineHeight": mmv(look["lead"]),
            "color": colour(look["color"]), "fontWeight": int(look["weight"]), "boldFontWeight": 700,
            "textAlign": "left", "hyphenation": False, "firstLineIndent": mmv(0)}


def text_style(lines: list[Line], centred: bool) -> dict:
    look = dominant(lines)
    return {"id": "text", "backgroundEnabled": False, "border": {"enabled": False},
            "padding": {"top": mmv(0), "right": mmv(0), "bottom": mmv(0), "left": mmv(0)}, "body": body_of(look)}


def give_slack(right: float, inner: float, ctx: dict) -> float:
    """The right padding of a box or tab with the measure's slack taken off
    (down to nothing): per cent of the text's width, at most 4 mm
    (`--wrap-slack`)."""
    take = min(4.0, ctx.get("wrap_slack", 0.0) / 100.0 * inner)
    return max(min(right, 0.0), right - take)


def tab_style(s: Shape, lines: list[Line], ctx: dict) -> dict:
    st: dict[str, Any] = {"id": "tab", "backgroundEnabled": True, "background": colour(s.fill),
                          "border": {"enabled": False}, "borderRadius": mmv(s.radius())}
    if s.stroke:
        st["border"] = {"enabled": True, "color": colour(s.stroke), "width": ptv(s.width)}
    pad = max(0.0, min(lines[0].x0 - s.box[0], 8.0)) if lines else 2.0
    # the left inset holds the tab's icon (a ring before the words): the
    # right one is the room after the words, else the words wrap in the frame
    right = max(0.5, min(s.box[2] - max(l.x1 for l in lines), pad)) if lines else pad
    left = pad
    if lines:
        inner = s.box[2] - s.box[0] - pad - right
        before = right
        right = give_slack(right, inner, ctx)
        if abs(pad - before) < 1.5 and pad < 6.0:
            # a tab whose words sit between equal insets (centred over its
            # picture): the slack comes off both sides, the words stay centred
            take = before - right
            left = max(0.5, pad - take)
            right = max(0.5, before - take) if take else right
    centred = bool(lines) and len(lines) == 1 and lines[0].size < ctx["heading_min"] and \
        abs((lines[0].x0 + lines[0].x1) / 2 - (s.box[0] + s.box[2]) / 2) <= 1.0 and pad < (s.box[2] - s.box[0]) / 4
    if centred:
        # a pill whose word sits in the middle (the names over a diagram's pictures): the word is
        # centred in the pill and the insets are a margin, so another edition's longer word stays
        # in the middle and gets the whole width (measured insets would be half the room it leaves)
        left = right = min(1.5, pad)
    st["padding"] = {"top": mmv(0), "right": mmv(right), "bottom": mmv(0), "left": mmv(left)}
    if lines:
        look = dominant(lines)
        look["lead"] = round(lines[0].size_mm * 1.15, 3)
        st["body"] = body_of(look)
        if centred:
            st["body"]["textAlign"] = "center"
    return st


def box_style(f: Frame, ctx: dict, report: dict) -> dict:
    s: Shape = f.shape
    st: dict[str, Any] = {"id": "box", "backgroundEnabled": bool(s.fill)}
    if s.fill:
        st["background"] = colour(s.fill)
    st["border"] = {"enabled": True, "color": colour(s.stroke), "width": ptv(s.width or 0.5)} if s.stroke else {"enabled": False}
    st["borderRadius"] = mmv(s.radius())
    text = [l for l in f.lines if l.size < ctx["heading_min"]]
    look = dominant(text or f.lines) if f.lines else None
    bx0, by0, bx1, by1 = s.box
    if f.lines:
        lefts = [min(l.x0, text_x0(l)) for l in f.lines]
        left = max(0.0, min(lefts) - bx0)
        gap = bx1 - max(l.x1 for l in f.lines)
        # ragged lines stop short of the edge by chance: the padding is the left
        # one; a gap over 10 mm wider than that is the room of a picture laid
        # over the box. The longest line ends exactly where it ends on the
        # source, and the source's own tracking (InDesign squeezes a line by
        # a few per cent to fit it) is not in the new face's widths: a line
        # that just fits breaks one word earlier and the box grows a line.
        # The measure gets `wrap_slack` per cent more than the source's (at
        # most 4 mm), taken from the right padding
        right = max(0.0, gap if gap > left + 10.0 else min(left, gap))
        right = give_slack(right, max(0.0, bx1 - bx0 - left - right), ctx)
        lead = look["lead"]
        first = min(f.lines, key=lambda l: l.base)
        last = max(f.lines, key=lambda l: l.base)
        top = max(0.0, first.base - 0.8 * lead - by0)
        bottom = max(0.0, min(by1 - (last.base + 0.2 * lead), 8.0))
        st["padding"] = {"top": mmv(top), "right": mmv(right), "bottom": mmv(bottom), "left": mmv(left)}
        st["body"] = body_of(look)
        bl = [l for l in f.lines if bullet_of(l)]
        if bl:
            b = bullet_of(bl[0])
            st["lists"] = {"bulletChar": b.c, "color": colour(b.color),
                           "indent": mmv(max(0.0, b.x0 - (bx0 + left))), "gap": mmv(max(0.5, text_x0(bl[0]) - b.x0))}
    else:
        st["padding"] = {"top": mmv(0), "right": mmv(0), "bottom": mmv(0), "left": mmv(0)}
    t: Shape | None = f.tab
    if t is not None:
        tl = getattr(t, "line", None)
        lab: dict[str, Any] = {"background": colour(t.fill), "height": mmv(t.h),
                               "offset": mmv(max(0.0, by0 - t.box[1]))}
        left_gap = t.box[0] - bx0
        right_gap = bx1 - t.box[2]
        if right_gap + 0.5 < left_gap and right_gap < 3:
            lab["position"], lab["inset"] = "top-right", mmv(max(0.0, right_gap))
        else:
            lab["position"], lab["inset"] = "top-left", mmv(max(0.0, left_gap))
            if abs(left_gap - right_gap) < 2 and left_gap > 5:
                report["notes"].append(f"{f.name}: a centred tab is set at top-left with an inset")
        if tl is not None:
            tlook = dominant([tl])
            lab.update({"fontFamily": tlook["family"], "fontSize": ptv(tlook["size"]),
                        "fontWeight": int(max(c.weight for c in tl.chars if c.c.strip())), "color": colour(tlook["color"]),
                        "paddingX": mmv(max(0.5, min(tl.x0 - t.box[0], t.box[2] - tl.x1) if tl.x0 - t.box[0] > 6 else tl.x0 - t.box[0]))})
            if tl.x0 - t.box[0] > 6:
                report["notes"].append(f"{f.name}: the tab's icon before its words is not drawn")
        st["label"] = lab
    return st


# ---------------------------------------------------------------------------
# pictures
# ---------------------------------------------------------------------------


def cut_picture(pdf_path: str, doc: fitz.Document, pno: int, f: Frame, origin: tuple, rid: str,
                opts: argparse.Namespace, renders: Renders) -> dict:
    p = f.picture
    out_dir = Path(opts.out) / "resources"
    out_dir.mkdir(parents=True, exist_ok=True)
    alpha = False
    file = None
    if len(p["images"]) == 1 and p["vector"] == 0:
        info = p["images"][0]["info"]
        xref = info.get("xref") or 0
        t = info.get("transform") or (1, 0, 0, 1, 0, 0)
        if xref > 0 and abs(t[1]) < 1e-3 and abs(t[2]) < 1e-3:
            try:
                meta = doc.extract_image(xref)
                smask = meta.get("smask") or 0
            except Exception:
                smask = 0
            if smask:
                pix = fitz.Pixmap(doc, xref)
                if pix.n - pix.alpha > 3:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                pix = fitz.Pixmap(pix, fitz.Pixmap(doc, smask))
                from PIL import Image, ImageOps

                im = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
                if t[0] < 0:
                    im = ImageOps.mirror(im)
                if t[3] < 0:
                    im = ImageOps.flip(im)
                file = out_dir / f"{rid}.png"
                im.save(file, optimize=True)
                alpha = True
    if file is None:
        one = fitz.open(str(pdf_path))
        page = one[pno]
        page.add_redact_annot(page.rect, fill=False)
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                              text=fitz.PDF_REDACT_TEXT_REMOVE)
        pm = page.get_pixmap(dpi=opts.dpi, clip=to_pt(f.box, origin), alpha=False)
        file = out_dir / f"{rid}.jpg"
        pm.save(str(file), jpg_quality=90)
    from PIL import Image

    with Image.open(file) as im:
        w, h = im.size
    res = {"id": rid, "typeId": "picture", "kind": "bitmap", "file": f"resources/{file.name}", "width": w,
           "height": h, "resolution": round(w / ((f.box[2] - f.box[0]) / 25.4), 1), "caption": "", "altText": ""}
    f.alpha = alpha
    if alpha:
        res["contour"] = {"threshold": 0.5, "margin": mmv(1.5)}
    return res


def cut_ground(pdf_path: str, pno: int, origin: tuple, sh: dict, frames: list[Frame], opts: argparse.Namespace,
               rid: str) -> dict:
    """The page without its text, boxes, tabs, highlight bands and pictures:
    what the template's decoration paints under the frames."""
    doc = fitz.open(str(pdf_path))
    page = doc[pno]
    page.add_redact_annot(page.rect, fill=False)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                          text=fitz.PDF_REDACT_TEXT_REMOVE)
    pad = 0.6
    shapes = [b["shape"] for b in sh["bands"]] + sh["boxes"] + sh["tabs"]
    for s in shapes:
        r = fitz.Rect(s.rect_pt)
        if s.kind == "band":
            r = to_pt(next(b["box"] for b in sh["bands"] if b["shape"] is s), origin)
        w = s.width if s.stroke else 0     # a stroke's caps and edges reach past its path
        page.add_redact_annot(fitz.Rect(r.x0 - pad - w, r.y0 - pad - w, r.x1 + pad + w, r.y1 + pad + w), fill=False)
    if shapes:
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
                              text=fitz.PDF_REDACT_TEXT_NONE)
    pics = [f for f in frames if f.kind in ("picture", "figure")]
    for f in pics:
        r = to_pt(f.box, origin)
        page.add_redact_annot(fitz.Rect(r.x0 - pad, r.y0 - pad, r.x1 + pad, r.y1 + pad), fill=False)
    if pics:
        keep_ground_image = any("image" in g for g in sh["ground"] if isinstance(g, dict))
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_PIXELS if keep_ground_image else fitz.PDF_REDACT_IMAGE_REMOVE,
                              graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED, text=fitz.PDF_REDACT_TEXT_NONE)
    out_dir = Path(opts.out) / "resources"
    out_dir.mkdir(parents=True, exist_ok=True)
    pm = page.get_pixmap(dpi=opts.ground_dpi, clip=to_pt((0, 0, origin[2], origin[3]), origin), alpha=False)
    file = out_dir / f"{rid}.jpg"
    img = erase_survivors(pm, sh, opts.ground_dpi)
    img.save(str(file), quality=85)
    return {"file": f"resources/{file.name}", "width": pm.width, "height": pm.height}


def erase_survivors(pm: fitz.Pixmap, sh: dict, dpi: int):
    """Paint out the bands, tabs and box fills that the redaction left.

    MuPDF removes line art only when one redaction rectangle covers the
    whole path, and it misses some of them (on a real textbook, the yellow
    highlight strokes of a line, `14 w` strokes under a `cm`, stayed in the
    ground and were printed twice, once by the ground and once by the
    `:mark`). So the render is checked: inside each shape's box, the pixels
    of the shape's own colour are painted with the colour round the box,
    largest shape first (a band on a tinted box ends on the card's colour).
    Pixels of other colours (an icon in a box) stay."""
    import numpy as np
    from PIL import Image
    a = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.width, pm.n)[:, :, :3].copy()
    px = dpi / 25.4
    items = []
    for b in sh["bands"]:
        items.append((b["box"], b["color"], 0.0))
    for s in sh["boxes"] + sh["tabs"]:
        if s.fill:
            items.append((s.box, s.fill, 0.0))
        if s.stroke:
            items.append((s.box, s.stroke, max(s.width * 0.3528, 0.3)))
    items.sort(key=lambda it: -area(it[0]))
    h, w = a.shape[:2]
    for box, col, ring in items:
        if whiteish(col):
            # a white box lies on the white card (or masks part of a picture,
            # another page): painting it with the colour round it paints the picture's
            # lines over the card
            continue
        want = np.array([round(v * 255) for v in td.hex_rgb(col)], dtype=int)
        pad = 0.6 + ring
        x0, y0 = max(int((box[0] - pad) * px), 0), max(int((box[1] - pad) * px), 0)
        x1, y1 = min(int(math.ceil((box[2] + pad) * px)), w), min(int(math.ceil((box[3] + pad) * px)), h)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        win = a[y0:y1, x0:x1].astype(int)
        mask = np.abs(win - want).sum(axis=2) <= 45
        if ring:   # a stroked outline: only its edges
            inner = np.zeros_like(mask)
            r = int(math.ceil((2 * pad) * px))
            inner[r:-r or None, r:-r or None] = True
            mask &= ~inner
        if mask.sum() < 4:
            continue
        o = 3
        ox0, oy0, ox1, oy1 = max(x0 - o, 0), max(y0 - o, 0), min(x1 + o, w), min(y1 + o, h)
        outer = a[oy0:oy1, ox0:ox1].reshape(-1, 3).astype(int)
        ring_px = np.concatenate([a[oy0:y0, ox0:ox1].reshape(-1, 3), a[y1:oy1, ox0:ox1].reshape(-1, 3),
                                  a[y0:y1, ox0:x0].reshape(-1, 3), a[y0:y1, x1:ox1].reshape(-1, 3)]).astype(int)
        ring_px = ring_px[np.abs(ring_px - want).sum(axis=1) > 45] if len(ring_px) else ring_px
        if not len(ring_px):
            ring_px = outer[np.abs(outer - want).sum(axis=1) > 45]
        if not len(ring_px):
            continue
        under = np.median(ring_px, axis=0).astype(np.uint8)
        # the anti-aliased edge of the shape goes too: one pixel round the mask
        grown = mask.copy()
        grown[1:, :] |= mask[:-1, :]
        grown[:-1, :] |= mask[1:, :]
        grown[:, 1:] |= mask[:, :-1]
        grown[:, :-1] |= mask[:, 1:]
        edge = grown & ~mask & (np.abs(win - under.astype(int)).sum(axis=2) > 24) \
            & (np.abs(win - want).sum(axis=2) < np.abs(win - under.astype(int)).sum(axis=2) + 90)
        sel = mask | edge
        a[y0:y1, x0:x1][sel] = under
    return Image.fromarray(a)


# ---------------------------------------------------------------------------
# template geometry
# ---------------------------------------------------------------------------


def placement_abs(box: tuple) -> dict:
    return {"anchor": {"to": "container", "edge": "top-left"}, "offset": {"x": mmv(box[0]), "y": mmv(box[1])}}


def placement_rel(target: str, edge: str, dx: float, dy: float) -> dict:
    return {"anchor": {"to": f"#{target}", "edge": edge}, "offset": {"x": mmv(dx), "y": mmv(dy)}}


def make_template(tid: str, frames: list[Frame], cards: list[Shape], origin: tuple, opts: argparse.Namespace,
                  report: dict) -> dict:
    W, H = origin[2], origin[3]
    configs: dict[str, dict] = {}
    top = [f for f in frames if f.parent is None]
    # vertical neighbours on one card
    above: dict[str, Frame | None] = {}
    for f in top:
        best = None
        for g in top:
            if g is f or g.zone != f.zone or g.box[3] > f.box[1] + 1.0:
                continue
            if hoverlap(g.box, f.box) < 0.3 * min(g.box[2] - g.box[0], f.box[2] - f.box[0]):
                continue
            if f.box[1] - g.box[3] > opts.link_gap:
                continue
            if best is None or g.box[3] > best.box[3]:
                best = g
        above[f.name] = best
    below: dict[str, list[Frame]] = {}
    for f in top:
        if above[f.name] is not None:
            below.setdefault(above[f.name].name, []).append(f)
    groups: list[dict] = []
    member: dict[str, str] = {}
    # rows: two or more boxes of one height side by side under the same frame
    seen_rows: set[str] = set()
    for f in top:
        if f.name in seen_rows or f.kind not in ("box", "tab", "picture", "figure"):
            continue
        sib = [g for g in top if g.zone == f.zone and above[g.name] is above[f.name] and g.kind == f.kind
               and abs(g.box[1] - f.box[1]) <= 1.0 and abs((g.box[3] - g.box[1]) - (f.box[3] - f.box[1])) <= 2.0]
        sib = sorted(sib, key=lambda g: g.box[0])
        if len(sib) < 2 or any(hoverlap(a.box, b.box) > 0 for a, b in zip(sib, sib[1:])):
            continue
        gaps = [b.box[0] - a.box[2] for a, b in zip(sib, sib[1:])]
        if max(gaps) - min(gaps) > 1.0:
            continue
        name = f"row-{len([g for g in groups if g['kind'] == 'row']) + 1}"
        groups.append({"name": name, "kind": "row", "frames": [g.name for g in sib], "gap": mmv(statistics.median(gaps))})
        for g in sib:
            member[g.name] = name
            seen_rows.add(g.name)
    # stacks: runs of frames one under another with equal gaps
    def gap_of(g: Frame, f: Frame) -> float:
        return f.box[1] - g.box[3]

    used: set[str] = set(member)
    for f in sorted(top, key=lambda f: (f.box[1], f.box[0])):
        if f.name in used:
            continue
        run = [f]
        while True:
            cur = run[-1]
            nxt = below.get(cur.name, [])
            if len(nxt) != 1 or nxt[0].name in used or nxt[0].name in member:
                break
            n = nxt[0]
            if len(run) >= 2 and abs(gap_of(cur, n) - gap_of(run[0], run[1])) > 1.0:
                break
            run.append(n)
        if len(run) >= 2:
            name = f"stack-{len([g for g in groups if g['kind'] == 'stack']) + 1}"
            groups.append({"name": name, "kind": "stack", "frames": [g.name for g in run],
                           "gap": mmv(max(0.0, gap_of(run[0], run[1])))})
            for g in run:
                member[g.name] = name
                used.add(g.name)
    group_first = {g["frames"][0] for g in groups}
    by_name = {f.name: f for f in frames}

    def anchor_of(f: Frame) -> dict:
        g = above.get(f.name)
        if g is None:
            return placement_abs(f.box)
        target = g.name
        tbox = g.box
        if g.name in member and next(x for x in groups if x["name"] == member[g.name])["kind"] == "row":
            row = next(x for x in groups if x["name"] == member[g.name])
            target = row["name"]
            tbox = union([by_name[n].box for n in row["frames"]])
        return placement_rel(target, "below", f.box[0] - tbox[0], max(0.0, f.box[1] - tbox[3]))

    out_frames = []
    for f in frames:
        c: dict[str, Any] = {"name": f.name}
        if f.parent is not None:
            p = f.parent
            c["placement"] = placement_rel(p.name, "top-left", f.box[0] - p.box[0], f.box[1] - p.box[1])
            depth, q = 1, p
            while q is not None:
                depth, q = depth + 1, q.parent
            c["layer"] = depth
            # the parent's lines run into this picture's box on the source: the
            # art has a shape. With its outline (alpha) the text runs round it;
            # a rectangle would push the text further than the source does, so
            # without one the picture lies over the text as it was drawn.
            hits = any(inter(l.box, f.box) > 0.05 * area(l.box) for l in p.lines)
            if hits and getattr(f, "alpha", False):
                c["exclude"] = "push"
                c["wrap"] = "contour"
        elif f.name in member and f.name not in group_first:
            c["placement"] = placement_abs(f.box)   # a group member: its x counts, the group sets y
        else:
            c["placement"] = anchor_of(f)
        if f.kind == "text" and f.name == "text":
            c["flow"] = True
        width = f.box[2] - f.box[0]
        if f.kind in ("text", "title") and not f.rotate:
            width = text_measure(f, frames, cards)
        c["width"] = mmv(width)
        if f.rotate:
            c["rotate"] = round(f.rotate, 1)
        h = f.box[3] - f.box[1]
        if f.kind in ("box", "tab"):
            c["minHeight"] = mmv(h)
        elif f.kind == "text" and f.lines:
            c["minHeight"] = mmv(max(0.0, h - 0.5))
        if f.kind == "tab":
            c["verticalAlign"] = "middle"
        if getattr(f, "centred", False) and f.kind == "text":
            # centred lines keep their centre: widen the frame round it
            off = c["placement"]["offset"]["x"]["value"] - (width - (f.box[2] - f.box[0])) / 2
            c["placement"]["offset"]["x"] = mmv(off)
        if opts.fit and f.kind in ("text", "box"):
            c["fit"] = {"minScale": opts.fit}
        configs[f.name] = c
        out_frames.append(c)
    # a tab (a pill, a title) lies over the picture it touches (a diagram's connectors are one
    # picture under the pills): layer 2, else a picture listed after it paints over it
    for f in frames:
        if f.kind != "tab" or "layer" in configs[f.name]:
            continue
        if any(g.kind in ("picture", "figure") and g.parent is not f and inter(f.box, g.box) > 0.05 * area(f.box)
               for g in frames):
            configs[f.name]["layer"] = 2
    # Pictures laid on the foot of a box, under all its text (a row of photos under
    # the paragraph): anchored to the box's bottom edge, with the room they take as the
    # box's bottom padding. A longer text then makes the box taller and the photos
    # follow it; anchored to the top, the photos stay and the longer text runs under them.
    for p in frames:
        kids = [f for f in frames if f.parent is p and f.kind in ("picture", "figure")]
        if p.kind != "box" or not kids or not p.lines or p.rotate:
            continue
        inner = [f for f in frames if f.parent is p]
        own = [l for l in p.lines if not any(inside_mm(l.box, g.box, 1.0) for g in inner)]
        if not own:
            continue
        text_foot = max(l.box[3] for l in own)
        low = [k for k in kids if k.box[1] >= text_foot - 0.5]
        if not low or len(low) != len(kids):
            continue
        for k in low:
            c = configs[k.name]
            c["placement"] = placement_rel(p.name, "bottom-left", k.box[0] - p.box[0], k.box[3] - p.box[3])
        # what lies on such a picture (a label, a tab on a drawing) moves with the picture
        for g in inner:
            host = next((k for k in low if g not in low and inside_mm(g.box, k.box, 0.5)), None)
            if host is not None and "placement" in configs[g.name]:
                configs[g.name]["placement"] = placement_rel(host.name, "top-left", g.box[0] - host.box[0], g.box[1] - host.box[1])
        room = p.box[3] - min(k.box[1] for k in low)
        pad = dict(configs[p.name].get("padding") or {})
        pad["bottom"] = mmv(round(room + 1.0, 2))
        configs[p.name]["padding"] = pad
    # the last frame on a card may grow to the card's foot, no further
    for f in top:
        if below.get(f.name) or f.zone < 0 or f.kind not in ("box", "text"):
            continue
        room = cards[f.zone].box[3] - f.box[1] - 1.0
        if room > (f.box[3] - f.box[1]) + 0.5:
            configs[f.name]["maxHeight"] = mmv(room)
    t = {"id": tid, "area": "trim", "header": False, "footer": False, "frames": out_frames}
    if groups:
        t["groups"] = groups
    return t


def text_measure(f: Frame, frames: list[Frame], cards: list[Shape]) -> float:
    """The measure a free text was set to: up to the card's inner edge (or
    the next frame on its right) when its longest line comes close to it."""
    x0 = min(text_x0(l) for l in f.lines) if f.lines else f.box[0]
    longest = f.box[2] - f.box[0]
    if f.zone >= 0:
        card = cards[f.zone].box
        edge = card[2] - max(2.0, f.box[0] - card[0])
    else:
        edge = f.box[2] + 2
    for g in frames:
        if g is f or g.parent is not None:
            continue
        if g.box[0] >= f.box[2] - 1 and g.box[1] < f.box[3] and g.box[3] > f.box[1]:
            edge = min(edge, g.box[0] - 2.0)
    room = edge - f.box[0]
    if f.kind == "title" and room > longest:
        return round(room, 2)
    if getattr(f, "centred", False):
        return max(longest, min(room, longest * 1.25 + 4))
    if room > longest and longest >= 0.82 * room:
        return round(room, 2)
    return round(longest * 1.03 + 1.0, 2)


def furniture_decoration(lines: list[Line], pno: int, origin: tuple, ctx: dict, report: dict) -> tuple[list, dict]:
    """Running heads and folios as decoration elements of the template (a
    placeholder each) and the page attributes they print."""
    W = origin[2]
    parity = "odd" if (pno + 1) % 2 else "even"
    els, attrs = [], {}
    by_band: dict[str, list[Line]] = {}
    for l in sorted(lines, key=lambda l: (l.base, l.x0)):
        band = "head" if l.y1 < origin[3] / 2 else "foot"
        by_band.setdefault(band, []).append(l)
    for band, ls in by_band.items():
        words = [l for l in ls if not re.fullmatch(r"\d{1,4}", l.plain)]
        folios = [l for l in ls if re.fullmatch(r"\d{1,4}", l.plain)]
        for l in folios[:1]:
            els.append(text_element(f"folio-{parity}", "{pageNumber}", l, W, parity))
        if words:
            text = " ".join(l.plain for l in words)
            key = band
            attrs[key] = text
            els.append(text_element(f"{key}-{parity}", "{attr.%s}" % key, words[0], W, parity))
    return els, attrs


def text_element(eid: str, content: str, l: Line, W: float, parity: str) -> dict:
    look = dominant([l])
    size = look["size"]
    top = l.base - 0.8 * size * PT_MM
    right = l.x0 > W / 2
    el: dict[str, Any] = {"kind": "text", "id": eid, "parity": parity, "content": content,
                          "fontFamily": look["family"], "fontSize": ptv(size), "fontWeight": int(look["weight"]),
                          "italic": bool(l.italic), "color": colour(look["color"]), "lineHeight": 1,
                          "verticalAlign": "top", "align": "right" if right else "left"}
    width = max(40.0, (l.x1 - l.x0) * 2)
    if right:
        el["placement"] = {"anchor": {"to": "page", "edge": "top-right"},
                           "offset": {"x": mmv(-(W - l.x1)), "y": mmv(top)}, "size": {"width": mmv(width)}}
    else:
        el["placement"] = {"anchor": {"to": "page", "edge": "top-left"},
                           "offset": {"x": mmv(l.x0), "y": mmv(top)}, "size": {"width": mmv(width)}}
    return el


# ---------------------------------------------------------------------------
# Markdown
# ---------------------------------------------------------------------------


def blocks_markdown(blocks: list[tuple]) -> list[str]:
    out: list[str] = []
    prev = None
    for kind, level, text in blocks:
        if kind == "h":
            out.append(pmd.heading(level, text))
        elif kind == "li":
            if prev == "li" and out:
                out[-1] += "\n- " + text
                prev = "li"
                continue
            out.append("- " + text)
        else:
            out.append(pmd.guard_line_start(text))
        prev = kind
    return out


def page_markdown(page: dict, ctx: dict) -> str:
    frames: list[Frame] = page["frames"]
    attrs = " ".join(f'{k}="{pmd.attr_value(v)}"' for k, v in page["attrs"].items())
    lines = [f'::::page{{template="{page["template"]["id"]}" {attrs}}}'.replace(" }", "}")]

    def add(block: str) -> None:
        if lines[-1] != "":
            lines.append("")
        lines.append(block)

    for f in frames:
        if f.kind == "title":
            text = " ".join(l.plain for l in f.lines)
            add(pmd.heading(f.level or 1, text, slot=None if getattr(f, "takes", False) else f.name))
            continue
        if f.kind in ("picture", "figure"):
            rid = f.resource["id"]
            if f.kind == "figure" and f.labels:
                labels = f.figure_labels
                add(anc.figure_block(rid, f.name, labels))
            else:
                add(f'::resource{{id="{rid}" slot="{f.name}"}}')
            continue
        body = blocks_markdown(f.blocks)
        if getattr(f, "centred", False):
            body = [":::paragraphs{style=\"centred\"}\n" + "\n\n".join(body) + "\n:::"] if body else body
        if f.kind == "text" and f.name == "text":
            for b in body:
                add(b)
            continue
        if f.kind == "tab" and f.level:
            heads = [b for b in f.blocks if b[0] == "h"]
            text = heads[0][2]
            add(pmd.heading(f.level, text, slot=None if getattr(f, "takes", False) else f.name))
            continue
        attrs_f: dict[str, str] = {"slot": f.name}
        if f.kind == "box" and f.tab is not None and getattr(f.tab, "line", None) is not None:
            attrs_f["label"] = f.tab.line.plain
        head = ":::frame" + pmd.attrs(**attrs_f)
        add(head + "\n" + "\n\n".join(body) + ("\n" if body else "") + ":::")
    lines.append("")
    lines.append("::::")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# extract
# ---------------------------------------------------------------------------


def parse_pages(spec: str, n: int) -> list[int]:
    out: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            out += list(range(int(a), (int(b) if b else n) + 1))
        else:
            out.append(int(part))
    return [p for p in out if 1 <= p <= n]


def cmd_extract(args: argparse.Namespace) -> int:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    doc = open_pdf(args.source)
    pages = parse_pages(args.pages or f"1-{doc.page_count}", doc.page_count)
    fonts = Fonts(Path(args.font_map) if args.font_map else None, Path(args.fonts) if args.fonts else None)
    # pass 1: the printed text of every page, the body size and the heading sizes
    caches = {}
    sizes: dict[float, int] = {}
    for p in pages:
        page = doc[p - 1]
        origin = trim_origin(page)
        renders = Renders(args.source, p - 1)
        lines, hidden = read_lines(args.source, page, fonts, origin, renders)
        sh = classify(page, lines, origin, renders, args)
        caches[p] = {"renders": renders, "lines": lines, "hidden": hidden, "shapes": sh}
        holders = [s.box for s in sh["cards"] + sh["boxes"] + sh["tabs"]]
        for l in lines:
            if holders and not any(centre_in(l.box, b) for b in holders):
                continue      # running heads and folios do not set the heading sizes
            for c in l.chars:
                if c.c.strip():
                    k = round(c.size * 2) / 2
                    sizes[k] = sizes.get(k, 0) + 1
    measure_leads([caches[p]["lines"] for p in pages])
    body = max(sizes, key=lambda k: (sizes[k], -k)) if sizes else 10.0
    heading_min = args.heading_size or round(body * 1.35, 2)
    head_sizes = sorted({k for k in sizes if k >= heading_min}, reverse=True)

    def level_of(size: float) -> int:
        k = round(size * 2) / 2
        for i, s in enumerate(head_sizes[:3]):
            if k >= s - 0.25:
                return i + 1
        return min(3, len(head_sizes)) or 1

    ctx: dict[str, Any] = {"heading_min": heading_min, "level_of": level_of, "mark_ids": {}, "label_groups": [],
                           "wrap_slack": args.wrap_slack}
    # highlight colours -> mark (or chip) styles
    band_cols: dict[str, list] = {}
    built = []
    for p in pages:
        for b in caches[p]["shapes"]["bands"]:
            band_cols.setdefault(b["color"], []).append(b["box"])
    mark_styles = []
    for col in sorted(band_cols, key=lambda c: (-len(band_cols[c]), c)):
        rep = next((m for m in mark_styles if td.delta_e(m["_hex"], col) <= 3), None)
        if rep:
            ctx["mark_ids"][col] = rep["id"]
            continue
        sid = f"{'mark' if args.highlights == 'mark' else 'chip'}-{td.colour_name(col)}"
        while any(m["id"] == sid for m in mark_styles):
            sid += "-2"
        ctx["mark_ids"][col] = sid
        mark_styles.append({"id": sid, "_hex": col})
    for p in pages:
        built.append(build_page(args.source, doc, p - 1, fonts, args, ctx, caches[p]))
        print(f"p. {p}: " + ", ".join(f"{v} {k}" for k, v in built[-1]["report"]["frames"].items() if v), file=sys.stderr)

    # the library: styles deduplicated exactly, ids by role
    library: dict[str, Any] = {"pageTemplates": [], "calloutStyles": [], "labelStyles": [], "paragraphStyles": []}
    style_ids: dict[str, str] = {}
    centred_used = False

    def style_id(st: dict, role: str) -> str:
        key = json.dumps({k: v for k, v in st.items() if k != "id"}, sort_keys=True)
        if key in style_ids:
            return style_ids[key]
        n = sum(1 for v in style_ids.values() if v.startswith(role + "-")) + 1
        sid = f"{role}-{n}"
        style_ids[key] = sid
        library["calloutStyles"].append({**st, "id": sid})
        return sid

    resources: list[dict] = []
    figures: list[dict] = []
    all_groups = [g for gs in ctx["label_groups"] for g in gs]
    lstyles, lids = anc.label_styles(all_groups)
    library["labelStyles"] = lstyles
    for page in built:
        tpl = page["template"]
        frames: list[Frame] = page["frames"]
        by = {c["name"]: c for c in tpl["frames"]}
        for f in frames:
            if f.style is not None:
                sid = style_id(f.style, f.kind if f.kind in ("box", "tab", "text") else "box")
                by[f.name]["style"] = sid
                f.style_id = sid
            if f.kind == "title" or (f.kind == "tab" and f.level):
                lvl = f.level or 1
                if not any(x.get("takes") == f"h{lvl}" for x in tpl["frames"]):
                    by[f.name]["takes"] = f"h{lvl}"
                    f.takes = True
            centred_used |= bool(getattr(f, "centred", False))
            if f.kind == "figure" and f.labels:
                box = f.box
                anchors_, labels = anc.anchors_for(f.labels, box, lids)
                f.resource["anchors"] = anchors_
                f.figure_labels = labels
                figures.append({"resource": f.resource["id"], "slot": f.name, "labels": labels})
        # a heading the template takes must be the first of its level
        resources += page["resources"]
        library["pageTemplates"].append(tpl)
        page["md"] = page_markdown({"frames": frames, "attrs": page["attrs"], "template": tpl}, ctx)
    if centred_used:
        library["paragraphStyles"].append({"id": "centred", "textAlign": "center"})
    if mark_styles:
        ms = []
        for m in mark_styles:
            st = {"id": m["id"], "background": colour(m["_hex"])}
            if args.highlights == "chip":
                st.update({"borderWidth": ptv(0), "paddingX": mmv(0.3)})
            ms.append(st)
        library["markStyles" if args.highlights == "mark" else "chipStyles"] = ms
    library["suggested"] = suggested_config(caches, pages, body, head_sizes, level_of, doc)
    library = {k: v for k, v in library.items() if v}

    (out / "library.json").write_text(json.dumps(library, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (out / "resources.json").write_text(json.dumps(resources, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (out / "figures.json").write_text(json.dumps({"figures": figures}, ensure_ascii=False, indent=1) + "\n",
                                      encoding="utf-8")
    cdir = out / "chapters" / args.lang
    cdir.mkdir(parents=True, exist_ok=True)
    (cdir / f"01-{args.chapter}.md").write_text("\n".join(p["md"] for p in built), encoding="utf-8")
    (out / "regions.json").write_text(json.dumps([p["regions"] for p in built], ensure_ascii=False, indent=1) + "\n",
                                      encoding="utf-8")
    summary = {
        "pages": len(built),
        "frames": sum(len(p["frames"]) for p in built),
        "byKind": {k: sum(p["report"]["frames"][k] for p in built) for k in ("title", "text", "box", "tab", "picture", "figure")},
        "pageTemplates": len(library.get("pageTemplates", [])),
        "calloutStyles": len(library.get("calloutStyles", [])),
        "labelStyles": len(library.get("labelStyles", [])),
        "labels": sum(len(r.get("anchors", [])) for r in resources),
        "hiddenTexts": {p["report"]["page"]: p["report"]["hidden"] for p in built if p["report"]["hidden"]},
        "notes": {p["report"]["page"]: p["report"]["notes"] for p in built if p["report"]["notes"]},
        "fonts": {k: list(v) for k, v in sorted(fonts.seen.items())},
        "bodySize": body, "headingSizes": head_sizes,
    }
    (out / "report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=1))
    else:
        print(f"{summary['pages']} pages, {summary['frames']} frames "
              f"({', '.join(f'{v} {k}' for k, v in summary['byKind'].items())}), "
              f"{summary['calloutStyles']} callout styles, {summary['labelStyles']} label styles, "
              f"{summary['labels']} labels -> {out}")
        hid = sum(len(v) for v in summary["hiddenTexts"].values())
        if hid:
            print(f"hidden text left out: {hid} spans on pages {', '.join(str(k) for k in summary['hiddenTexts'])}")
        print("fonts: " + "; ".join(f"{k} -> {v[0]} {v[1]}{' italic' if v[2] else ''}" for k, v in summary["fonts"].items()))
        print("next: template_dedupe.py " + str(out) + ", then pdf_regions.py manifest " + str(out))
    return 0


def suggested_config(caches: dict, pages: list[int], body: float, head_sizes: list[float], level_of, doc) -> dict:
    """bodyText and headings measured from the pages, a resource type for
    the pictures: for the generator to take or leave."""
    looks: dict[tuple, int] = {}
    heads: dict[int, dict[tuple, int]] = {}
    for p in pages:
        for l in caches[p]["lines"]:
            for c in l.chars:
                if not c.c.strip():
                    continue
                k = (c.family, round(c.size * 2) / 2, c.color, c.weight)
                if abs(round(c.size * 2) / 2 - body) < 0.01:
                    looks[k] = looks.get(k, 0) + 1
                elif head_sizes and round(c.size * 2) / 2 >= head_sizes[-1]:
                    heads.setdefault(level_of(c.size), {}).setdefault(k, 0)
                    heads[level_of(c.size)][k] += 1
    fam, size, col, weight = max(looks, key=lambda k: (looks[k], k)) if looks else ("serif", body, "#000000", 400)
    out: dict[str, Any] = {
        "bodyText": {"fontFamily": fam, "fontSize": ptv(size), "lineHeight": ptv(round(size * 1.35, 1)),
                     "color": colour(col), "fontWeight": weight, "textAlign": "left"},
        "headings": {"levels": []},
        "resourceTypes": [
            {"id": "picture", "name": "Picture", "namePlural": "Pictures", "shortLabel": "", "captionPrefix": "",
             "numberingTemplate": "", "resetOn": "never", "counterFormat": "decimal",
             "defaultPlacement": {"position": "here", "span": "column"}},
            {"id": "ground", "name": "Ground", "namePlural": "Grounds", "shortLabel": "", "captionPrefix": "",
             "numberingTemplate": "", "resetOn": "never", "counterFormat": "decimal",
             "defaultPlacement": {"position": "here", "span": "column"}}],
    }
    for lvl in sorted(heads):
        hf, hs, hc, hw = max(heads[lvl], key=lambda k: (heads[lvl][k], k))
        out["headings"]["levels"].append({"level": lvl, "fontFamily": hf, "fontSize": ptv(hs), "fontWeight": hw,
                                          "color": colour(hc), "lineHeight": {"value": 1.0, "unit": "em"},
                                          "marginTop": ptv(0), "marginBottom": ptv(0)})
    page = doc[pages[0] - 1]
    o = trim_origin(page)
    out["page"] = {"sizePreset": "custom", "width": mmv(o[2]), "height": mmv(o[3])}
    return out


# ---------------------------------------------------------------------------
# manifest: a draft project
# ---------------------------------------------------------------------------


def cmd_manifest(args: argparse.Namespace) -> int:
    import preset_kit as kit

    root = Path(args.dir)
    library = json.loads((root / "library.json").read_text(encoding="utf-8"))
    resources = json.loads((root / "resources.json").read_text(encoding="utf-8"))
    sug = library.get("suggested", {})
    langs = sorted(p.name for p in (root / "chapters").iterdir() if p.is_dir())
    fonts = []
    if args.fonts:
        src = Path(args.fonts).resolve()
        dst = root / "fonts"
        if dst.is_symlink() or dst.exists():
            if dst.is_symlink():
                dst.unlink()
            elif dst.is_dir():
                shutil.rmtree(dst)
        dst.mkdir()
        for f in sorted(src.glob("*")):
            if f.suffix.lower() in (".ttf", ".otf", ".woff2"):
                shutil.copy2(f, dst / f.name)
        table = font_table(dst)
        fams: dict[str, list] = {}
        for ps, (fam, weight, style, file) in sorted(table.items()):
            fams.setdefault(fam, []).append({"weight": weight, "style": style, "file": f"fonts/{file}"})
        fonts = [{"name": k, "variants": sorted(v, key=lambda x: (x["style"] != "normal", x["weight"]))}
                 for k, v in sorted(fams.items())]
    page = dict(sug.get("page") or {"sizePreset": "custom", "width": mmv(210), "height": mmv(297)})
    page["margins"] = {"top": mmv(15), "bottom": mmv(15), "left": mmv(15), "right": mmv(15)}
    config: dict[str, Any] = {
        "locale": langs[0] if langs else "es",
        "page": page,
        "bodyText": sug.get("bodyText", {}),
        "headings": {"levels": sug.get("headings", {}).get("levels", [])},
        "header": {"elements": []},
        "footer": {"elements": []},
        "resourceTypes": sug.get("resourceTypes", []),
    }
    for k in ("calloutStyles", "markStyles", "chipStyles", "labelStyles", "paragraphStyles", "pageTemplates"):
        if library.get(k):
            config[k] = library[k]
    chapters = {lang: kit.chapters_from_dir(root, lang) for lang in langs}
    manifest = {"id": args.id or root.name, "name": args.name or root.name, "locale": config["locale"],
                "chapters": chapters if len(langs) > 1 else chapters.get(langs[0], []) if langs else [],
                "config": config, "resources": resources, "fonts": fonts}
    if len(langs) > 1:
        manifest["locales"] = langs
    path = kit.write_manifest(root, manifest)
    print(f"{path}: {sum(len(v) for v in chapters.values())} chapter file(s), {len(resources)} resources, "
          f"{len(config.get('pageTemplates', []))} page templates, {len(fonts)} font families")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("extract", help="templates, styles, pictures and Markdown from PDF pages")
    p.add_argument("source", help="the source PDF")
    p.add_argument("--pages", help="pages to read, 1-based: 4-28 or 5,7,9-12 (default all)")
    p.add_argument("--out", required=True, help="output folder")
    p.add_argument("--lang", default="es", help="the edition's language: chapters/<lang>/ (default es)")
    p.add_argument("--chapter", default="pages", help="chapter file name: chapters/<lang>/01-<chapter>.md")
    p.add_argument("--prefix", default="p", help="resource and template id prefix (default p: p05-box-1)")
    p.add_argument("--fonts", help="the book's font files: families, weights and styles read from them")
    p.add_argument("--font-map", help="JSON: PDF font name prefix -> family or {family, weight, italic}")
    p.add_argument("--dpi", type=int, default=300, help="resolution of the pictures cut from the page (default 300)")
    p.add_argument("--ground-dpi", type=int, default=150, help="resolution of the page ground (default 150)")
    p.add_argument("--highlights", choices=("mark", "chip"), default="mark",
                   help="highlight bands as :mark (breaks like text, default) or :chip (unbreakable)")
    p.add_argument("--heading-size", type=float, help="text this size (pt) or larger is a heading (default 1.35 x body)")
    p.add_argument("--card-area", type=float, default=0.15, help="white fills at least this share of the page are cards (default 0.15)")
    p.add_argument("--min-picture", type=float, default=8.0, help="pictures smaller than this (mm) stay in the ground (default 8)")
    p.add_argument("--art-gap", type=float, default=1.0, help="line art closer than this (mm) is one picture (default 1)")
    p.add_argument("--art-shapes", type=int, default=12,
                   help="a rectangle holding this many drawn shapes is the ground of a picture, not a box (default 12)")
    p.add_argument("--overlay", action="store_true", help="also write overlay/pNN.png: the page with its frames drawn")
    p.add_argument("--label-ink", type=float, default=0.3, help="a word over a picture is a label when this share of its box is art (default 0.3)")
    p.add_argument("--label-reach", type=float, default=4.0,
                   help="small words this close to a picture's edge (mm) are its lettering (default 4)")
    p.add_argument("--link-gap", type=float, default=25.0, help="a frame anchors below the frame above when they are this close (mm, default 25)")
    p.add_argument("--margin-band", type=float, default=15.0, help="on a page without cards, text this close to the top or foot is a running head (mm)")
    p.add_argument("--fit", type=float, help="give text frames and boxes fit.minScale (0.9: the ladder may set the text down to 90 %%)")
    p.add_argument("--wrap-slack", type=float, default=3.0,
                   help="per cent a box's text measure gets beyond its longest source line, at most 4 mm, so that a "
                        "face a little wider than the source's tracked text does not break the lines one word "
                        "earlier (default 3; 0 keeps the source's measure)")
    p.add_argument("--no-merge-labels", action="store_true", help="one label per line on pictures")
    p.add_argument("--json", action="store_true")
    m = sub.add_parser("manifest", help="a draft preset.json from an extract folder")
    m.add_argument("dir")
    m.add_argument("--fonts", help="copy these font files into DIR/fonts and list them")
    m.add_argument("--id")
    m.add_argument("--name")
    args = ap.parse_args(argv)
    if args.cmd == "extract":
        return cmd_extract(args)
    return cmd_manifest(args)


if __name__ == "__main__":
    sys.exit(main())
