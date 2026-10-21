#!/usr/bin/env python3
"""Fixed pages of a PDF as composed pages: page templates (frames in mm,
groups), frame styles, vector decoration (connectors, cards, shapes) and a
raster ground only where it is needed, the pictures cut without their text,
and Markdown with one `::::page` per page and a `:::frame{slot}` per box, in
reading order (references/composed-pages.md, round 2).

  pdf_regions.py extract SOURCE.pdf --pages 4-28 --out DIR [--lang es]
        [--fonts DIR] [--font-map map.json] [--dpi 300] [--ground-dpi 150]
        [--highlights mark|chip] [--fit 0.9] [--wrap-slack 3] [--chapter pages]
        [--name-frames auto|always|never] [--raster-ground] [--vector-ground] [--line-width 2]
        [--json]
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
- **Shapes**, each cut to the clip it is painted in: the page ground
  (fills over most of the page), white cards (large white fills: the
  page's paper, kept in the ground), boxes (filled
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
  round its outline (`wrap: "contour"`). Thin lines inside a cluster of art
  are its own (a chart's axes and grid); a chart (regular ticks with an
  axis or a turned title) keeps all its words in its cut and lifts no labels.
- **Lines and furniture as vectors** (round 2; `--raster-ground` keeps the
  round-1 JPEG ground): thin straight strokes are lines (line_art.py): a
  tree's bar, trunk and drops become a `tree` connector, two or three
  segments between two frames an `elbow`, a line through frames a
  `straight` connector per run between two of them, a line painted over a
  picture into its art a connector to a new anchor `pointer-N` of that
  picture (one slanted stroke from a frame into a picture too, `straight`);
  what joins nothing is a `path`. Each end's `at` is measured on the box the
  template lays (the picture as cut, the text frame at its measure). The page's colour, the cards (a
  card with a title tab grown out of it is one path), borders with no words
  (decoration boxes round the frames they hold, never empty frames) and
  loose shapes are decoration too (evenly spaced parallel strokes are one
  hatch path). The raster ground keeps only what none of these paints (a
  transparent PNG); a page with nothing left has none. A page with too many
  loose shapes, clipped art off its pictures, mostly line fragments or a
  full-page image keeps its loose art in the ground (--vector-ground: not).
- **Running heads and folios**: text outside the cards (or in the top and
  bottom bands of a page without cards). A folio becomes `{pageNumber}`,
  other words a page attribute printed by the decoration (`{attr.head}`):
  the template stays text-free.

What it writes in DIR:

- `library.json`: `pageTemplates` (one per page, area `trim`; run
  template_dedupe.py next), `calloutStyles` (box, tab and text looks),
  `markStyles` or `chipStyles`, `labelStyles`, `paragraphStyles`, and
  `suggested` (bodyText, headings, resourceTypes for the generator);
- `resources.json` and `resources/`: page grounds (where art is left),
  pictures and figures (a pointer's end is an anchor `pointer-N`);
- `chapters/<lang>/01-<chapter>.md`: the page fences in page order;
- `figures.json`: every figure's labels, for `anchors.py relabel` to
  write other editions' `::label` lines from a strings file;
- Frame names: by kind and order on the page (`box-4`, `picture-7`), which
  `template_dedupe.py` compares across pages and then renames by role. A run
  of one page has nothing to merge, so `--name-frames auto` names it by role
  here (`picture-in-box`, `caption-of-picture`; a box is `box`, `box-2` until
  the callout styles are merged); `always` does it for several pages,
  `never` keeps the positions.
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
kind and order (`title`, `text`, `box-1`, `picture-2`, `figure-1`, `tab-1`),
so pages of one kind name their frames alike; `template_dedupe.py` renames
them by role (`box-light-blue`, `caption-of-picture`) once the templates are
merged.

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
import extract_tables as et  # noqa: E402
import images as imgs  # noqa: E402
import legends as lgd  # noqa: E402
import line_art as la  # noqa: E402
import pdf_extract as pex  # noqa: E402
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


WHITE_SNAP = 0.985        # a colour this close to white on every channel is white


def rgb_of(c: Any) -> tuple[float, float, float] | None:
    """A PDF colour as RGB 0-1, converted the way MuPDF converts it for its
    render: PyMuPDF hands paths in RGB already (Separation, DeviceN, ICC and
    Lab colours through their alternate space and profile); grey and CMYK
    tuples, which other readers give, go through MuPDF's own conversion, not
    a naive formula. None for what it cannot read."""
    if c is None:
        return None
    if isinstance(c, int):
        return ((c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255)
    c = tuple(float(v) for v in c)
    if len(c) == 3:
        return c
    if len(c) == 1:
        return (c[0], c[0], c[0])
    if len(c) == 4:
        try:
            pm = fitz.Pixmap(fitz.csCMYK, fitz.IRect(0, 0, 1, 1), False)
            pm.set_pixel(0, 0, tuple(max(0, min(255, round(v * 255))) for v in c))
            rgb = fitz.Pixmap(fitz.csRGB, pm).pixel(0, 0)
            return tuple(v / 255 for v in rgb[:3])
        except Exception:
            k = c[3]
            return ((1 - c[0]) * (1 - k), (1 - c[1]) * (1 - k), (1 - c[2]) * (1 - k))
    return None


def hexc(c: Any) -> str | None:
    """`rgb_of` as #rrggbb. White that a colour-managed conversion left a
    shade off (a Lab or ICC white comes back as #fdfefe) is written white,
    so a white rule or stroke stays white beside the page's white."""
    rgb = rgb_of(c)
    if rgb is None:
        return None
    if min(rgb) >= WHITE_SNAP:
        return "#ffffff"
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v * 255))) for v in rgb)


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


_STYLE_WORDS = set(WEIGHTS) | set(WIDTH_TOKENS) | {"italic", "oblique", "it", "ita", "kursiv", "slanted"}


def split_face_name(name: str) -> tuple[str, str]:
    """(family part, style part) of a PDF font name in any of the forms
    producers write: `Arial-BoldMT`, `Arial,Bold`, `Helvetica Bold`,
    `ArialBold`. The subset prefix (`ABCDEF+`) is dropped first."""
    base = name.split("+")[-1]
    m = re.match(r"^([^-,]+)[-,](.*)$", base)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    words = base.split(" ")
    k = len(words)
    while k > 1 and all(t in _STYLE_WORDS for t in style_tokens(words[k - 1])) and style_tokens(words[k - 1]):
        k -= 1
    if k < len(words):
        return " ".join(words[:k]), "".join(words[k:])
    # glued: the family's last capitalised words that are style words (`ArialBold`)
    parts = re.findall(r"[A-Z][a-z]+|[A-Z]+(?![a-z])|[a-z]+|\d+", base)
    k = len(parts)
    while k > 1 and parts[k - 1].lower() in _STYLE_WORDS:
        k -= 1
    if 0 < k < len(parts):
        return "".join(parts[:k]), "".join(parts[k:])
    return base, ""


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
        sub = split_face_name(ps)[1]
        w2, it2, widths = weight_italic_of(sub)
        if it2:
            style = "italic"
        if int(weight) == 400 and w2 != 400:
            weight = w2      # a file without OS/2 weight: its name says it
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
        #: PDF font name -> spans of an upright face the source slanted (read as italic)
        self.slanted: dict[str, int] = {}

    def face(self, pdf_name: str, flags: int = 0) -> tuple[str, int, bool]:
        key = (pdf_name, flags)
        if key in self.cache:
            return self.cache[key]
        base = pdf_name.split("+")[-1]
        fam_part, style = split_face_name(base)
        weight, italic, _ = weight_italic_of(style)
        name_w, name_it = weight, italic
        toks = style_tokens(style)
        said = any(t in WEIGHTS for t in toks) or any("".join(toks[i:i + 2]) in WEIGHTS for i in range(len(toks)))
        if flags & 16 and weight < 600:
            weight = 700
            said = True
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
                cands = [p for p in self.table if p.lower() == base.lower()]
                if not cands:
                    # a prefix match only between faces whose names say the same weight and slant:
                    # `Font-Bold` never maps to the regular `Font`
                    cands = [p for p in self.table if (p.startswith(base) or base.startswith(p))
                             and weight_italic_of(split_face_name(p)[1])[:2] == (name_w, name_it)]
                if cands:
                    ps = sorted(cands, key=lambda p: (-len(p), p))[0]
            if ps:
                fam, w, st, _ = self.table[ps]
                # the heavier of the file's weight and the name's (or the bold flag), either slant
                out = (fam, max(int(w), weight) if said else int(w), st == "italic" or italic)
        if out is None:
            out = (_split_camel(fam_part) or base, weight, italic)
        self.cache[key] = out
        self.seen[base] = out
        return out


def font_warnings(fonts: Fonts) -> list[str]:
    """A loud note when every face came out at one weight although the PDF's
    font names say several: the draft then has no bold, and the fonts
    folder or the font map needs a look."""
    if len(fonts.seen) < 2:
        return []
    out_w = {v[1] for v in fonts.seen.values()}
    named = {weight_italic_of(split_face_name(k)[1])[0] for k in fonts.seen}
    if len(out_w) == 1 and len(named) > 1:
        return [f"every face reads as weight {next(iter(out_w))} but the PDF names "
                f"{len(fonts.seen)} faces of weights {sorted(named)}: no bold will be marked; "
                "check --fonts and --font-map"]
    return []


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
        self._docs = (doc, doc2, doc3)          # kept open for `span_shows` (renders of one clip)
        self._pages = (page, p2, p3)

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

    def span_shows(self, span: dict, dpi: int = 600) -> bool | None:
        """Do one span's own glyphs show, read on renders of its box alone at
        `dpi`: its characters drawn by themselves at their origins and size
        (a stand-in face, grown by a pixel) mark its glyphs in the page's
        text ink, and those pixels must differ between the page and the page
        without text. None when too few pixels are its own to tell."""
        np = self.np
        chars = [c for c in span.get("chars", []) if c["c"].strip()]
        if not chars:
            return None
        b = span["bbox"]
        clip = fitz.Rect(b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1)

        def grab(page: fitz.Page, rgb: bool):
            pm = page.get_pixmap(dpi=dpi, clip=clip, colorspace=fitz.csRGB if rgb else fitz.csGRAY, alpha=False)
            a = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.stride)[:, :pm.width * pm.n]
            return a.reshape(pm.height, pm.width, pm.n).astype(int) if rgb else a.astype(int)

        page, bare, ink = self._pages
        alone = fitz.open()
        ap = alone.new_page(width=self.rect.width, height=self.rect.height)
        if self.rect.x0 or self.rect.y0:
            ap.set_mediabox(self.rect)
        tw = fitz.TextWriter(ap.rect)
        font = fitz.Font("helv")
        for c in chars:
            tw.append(fitz.Point(c["origin"]), c["c"], font=font, fontsize=span["size"])
        tw.write_text(ap)
        m = grab(ap, False) < 128
        grown = m.copy()
        grown[1:, :] |= m[:-1, :]
        grown[:-1, :] |= m[1:, :]
        grown[:, 1:] |= m[:, :-1]
        grown[:, :-1] |= m[:, 1:]
        a, z, k = grab(page, True), grab(bare, True), grab(ink, False)
        h = min(a.shape[0], z.shape[0], k.shape[0], grown.shape[0])
        w = min(a.shape[1], z.shape[1], k.shape[1], grown.shape[1])
        own = grown[:h, :w] & (k[:h, :w] < 128)
        if own.sum() < 12:
            return None
        d = np.abs(a[:h, :w] - z[:h, :w]).sum(axis=2)
        return float((d[own] > 45).mean()) > 0.5

    def text_visible(self, bbox_pt: tuple, span: dict | None = None) -> bool:
        """Do the span's glyphs show on the printed page? With `span` (a
        rawdict span another one's box covers in part), only its own glyphs
        are read (`span_shows`): a hidden copy of a label set just off a
        visible one saw the visible one's ink as its own (#1135)."""
        x0, y0, x1, y1 = self._win(bbox_pt)
        if x1 <= x0 or y1 <= y0:
            return False
        if span is not None:
            got = self.span_shows(span)
            if got is not None:
                return got
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

    def paints(self, bbox_pt: tuple, colour: str) -> bool:
        """Does any pixel of the text-free render inside the box come near
        `colour`? A shape no pixel of its colour shows is unseen: clipped
        away, off the trim or under an opaque fill painted after it. Thin
        strokes are blended with the paper: a pixel counts when it lies on the
        way from white to the colour (at least 30 % of it), close to that
        line, so another colour's grey edge does not."""
        np = self.np
        x0, y0, x1, y1 = self._win(bbox_pt)
        if x1 - x0 < 2 or y1 - y0 < 2:
            return True
        want = np.array([round(v * 255) for v in td.hex_rgb(colour)], dtype=float)
        win = self.bare[y0:y1, x0:x1].reshape(-1, 3).astype(float)
        if (np.abs(win - want).sum(axis=1) < 45).any():
            return True
        axis = want - 255.0
        n2 = float((axis * axis).sum())
        if n2 < 1.0:
            return True
        rel = win - 255.0
        t = rel @ axis / n2
        off = rel - np.outer(t, axis)
        return int(((t >= 0.3) & (np.sqrt((off * off).sum(axis=1)) < 8.0)).sum()) >= 2

    def share_of(self, bbox_pt: tuple, colour: str) -> float | None:
        """Share of the text-free render's pixels inside the box close to
        `colour`; None for a box too small to tell."""
        x0, y0, x1, y1 = self._win(bbox_pt)
        if x1 - x0 < 2 or y1 - y0 < 2:
            return None
        want = self.np.array([round(v * 255) for v in td.hex_rgb(colour)])
        d = self.np.abs(self.bare[y0:y1, x0:x1] - want).sum(axis=2)
        return float((d < 40).mean())

    def own_ink(self, bbox_pt: tuple, background: str | None, holes: list[tuple] = ()) -> tuple | None:
        """The box (pt) of what the text-free render paints inside `bbox_pt`
        that is neither `background` nor a neighbour's paint (`ink_box`).
        None: nothing of its own."""
        x0, y0, x1, y1 = self._win(bbox_pt)
        if x1 - x0 < 1 or y1 - y0 < 1:
            return None
        win_holes = []
        for rect, cols in holes:
            hx0, hy0, hx1, hy1 = self._win(rect)
            win_holes.append(((hx0 - x0, hy0 - y0, hx1 - x0, hy1 - y0), cols))
        got = ink_box(self.bare[y0:y1, x0:x1], background, win_holes)
        if got is None:
            return None
        k = self.k
        return (self.rect.x0 + (x0 + got[0]) / k, self.rect.y0 + (y0 + got[1]) / k,
                self.rect.x0 + (x0 + got[2]) / k, self.rect.y0 + (y0 + got[3]) / k)

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


def outside_round_rect(h: int, w: int, rect: tuple, radii: list[float]) -> Any:
    """A boolean mask (h × w) of the pixels outside a rounded rectangle
    (`rect` in pixels of the mask, `radii` per corner: top-left, top-right,
    bottom-right, bottom-left)."""
    import numpy as np

    ys, xs = np.mgrid[0:h, 0:w]
    xs, ys = xs + 0.5, ys + 0.5
    x0, y0, x1, y1 = rect
    out = (xs < x0) | (xs > x1) | (ys < y0) | (ys > y1)
    for (cx, cy, sx, sy), r in zip(((x0, y0, 1, 1), (x1, y0, -1, 1), (x1, y1, -1, -1), (x0, y1, 1, -1)), radii):
        if r <= 0:
            continue
        ox, oy = cx + sx * r, cy + sy * r
        corner = ((xs - ox) * sx < 0) & ((ys - oy) * sy < 0)
        out |= corner & ((xs - ox) ** 2 + (ys - oy) ** 2 > r * r)
    return out


def ink_box(win: Any, background: str | None, holes: list[tuple] = (), outside: Any = None) -> tuple | None:
    """The box (pixels of `win`, an RGB array) of what is neither the
    `background` colour nor a neighbour's paint: `holes` are (pixel rect in
    `win`, [colours]) of the shapes round a picture (a box, a tab, a
    highlight), and a pixel inside one close to one of its colours is that
    shape's, not the picture's. None: nothing of its own."""
    import numpy as np

    win = np.asarray(win, dtype=int)
    bg = np.array([round(v * 255) for v in td.hex_rgb(background or "#ffffff")])
    ink = np.abs(win - bg).sum(axis=2) > 60
    if outside is not None:
        ink &= ~outside     # past the card's rounded corner: the page's colour, not the picture
    h, w = ink.shape
    for (hx0, hy0, hx1, hy1), cols in holes:
        hx0, hy0, hx1, hy1 = max(0, int(hx0)), max(0, int(hy0)), min(w, int(hx1)), min(h, int(hy1))
        if hx1 <= hx0 or hy1 <= hy0:
            continue
        sub = win[hy0:hy1, hx0:hx1]
        near = np.zeros(sub.shape[:2], dtype=bool)
        for c in cols:
            want = np.array([round(v * 255) for v in td.hex_rgb(c)])
            near |= np.abs(sub - want).sum(axis=2) < 60
        ink[hy0:hy1, hx0:hx1] &= ~near
    rows = np.nonzero(ink.sum(axis=1) >= 2)[0]
    cols_ = np.nonzero(ink.sum(axis=0) >= 2)[0]
    if not len(rows) or not len(cols_):
        return None
    return (int(cols_[0]), int(rows[0]), int(cols_[-1]) + 1, int(rows[-1]) + 1)


class Char:
    __slots__ = ("c", "x0", "y0", "x1", "y1", "oy", "family", "weight", "italic", "size", "color", "mark", "font")

    def __init__(self, c, x0, y0, x1, y1, oy, family, weight, italic, size, color, mark=None, font=None):
        self.c, self.x0, self.y0, self.x1, self.y1, self.oy = c, x0, y0, x1, y1, oy
        self.family, self.weight, self.italic, self.size, self.color, self.mark = family, weight, italic, size, color, mark
        #: the PDF font the character is set in (None for spaces made up by the reader)
        self.font = font


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
        # highlighted words (a chip's white letters on its band) are not the line's look:
        # a mark ending mid-paragraph must not part the lines on either side of it
        plain_ink = [c for c in ink if not c.mark] or ink
        for c in plain_ink:
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
    inked = [tuple(s["bbox"]) for b in raw["blocks"] if b.get("type", 0) == 0 for l in b["lines"] for s in l["spans"]
             if any(ch["c"].strip() for ch in s["chars"])]

    def near(bb: tuple) -> bool:
        """Another span's box covers a fifth of this one's, or more (a copy
        set just off it; spans side by side on a line barely meet)."""
        own = max((bb[2] - bb[0]) * (bb[3] - bb[1]), 1e-6)
        return any(o != tuple(bb) and inter(o, bb) >= 0.2 * min(own, max((o[2] - o[0]) * (o[3] - o[1]), 1e-6))
                   for o in inked)

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
                if not centre_in(sb, trim) or not renders.text_visible(
                        span["bbox"], span if abs(rot) < 1 and near(span["bbox"]) else None):
                    hidden.append(text.strip())
                    continue
                fam, weight, italic = fonts.face(span["font"], span["flags"])
                # an upright face obliqued by the text matrix is the source's italic
                slant = pex.slant_mask(span["chars"], italic) if abs(rot) < 1 else [False] * len(span["chars"])
                runs = sum(1 for k, m in enumerate(slant) if m and (k == 0 or not slant[k - 1]))
                if runs:
                    base = span["font"].split("+")[-1]
                    fonts.slanted[base] = fonts.slanted.get(base, 0) + runs
                col = hexc(span["color"]) or "#000000"
                for ch, sl in zip(span["chars"], slant):
                    b = to_mm(ch["bbox"], origin)
                    chars.append(Char(ch["c"], b[0], b[1], b[2], b[3], (ch["origin"][1] - oy) * PT_MM, fam, weight,
                                      italic or sl, span["size"], col, font=span["font"].split("+")[-1]))
            if any(c.c.strip() for c in chars):
                for c in chars:
                    if not c.family:   # spaces take the face of the text before them
                        c.family = next((d.family for d in chars if d.family), "")
                pieces.append(Line(chars, rot if abs(rot) >= 1 else 0.0))
    merged = merge_pieces(pieces)
    for l in merged:
        l.chars = thin_gaps(l.chars)
    return merged, hidden


#: what may follow a number across a thin space: digits, signs and unit letters
_NUMBER_TAIL = set("0123456789%‰‱°º℃℉′″€$£¥")


def thin_gaps(chars: list[Char]) -> list[Char]:
    """Thin spaces set by position: a number's groups (`1 000`) or a number
    and its sign or unit (`21 %`, `5 mm`) printed with a narrow gap and no
    space character (MuPDF writes none under about a quarter em), or with a
    space clearly narrower than the run's word spaces. The gap less the
    letter spacing is measured, so spaced capitals and figures (`2 0 2 6`)
    stay as they are. The gap becomes U+2009, which `postext_md.clean_text`
    turns into a narrow no-break space."""
    out: list[Char] = []
    track = tracking(chars)
    word_gaps = [b.x0 - a.x1 for a, s, b in zip(chars, chars[1:], chars[2:])
                 if a.c.strip() and s.c == " " and b.c.strip()]
    word = statistics.median(word_gaps) if word_gaps else None
    i = 0
    n = len(chars)
    while i < n:
        c = chars[i]
        out.append(c)
        if not c.c.isdigit():
            i += 1
            continue
        j = i + 1
        while j < n and not chars[j].c.strip():
            j += 1
        if j >= n:
            i += 1
            continue
        nxt = chars[j]
        tail = nxt.c in _NUMBER_TAIL or nxt.c.isalpha()
        em = max(c.size, nxt.size) * PT_MM
        gap = nxt.x0 - c.x1 - track
        own = chars[i + 1:j]
        if tail and em > 0 and ((not own and 0.1 * em <= gap < 0.3 * em)
                                or (own and all(o.c == " " for o in own) and gap < 0.2 * em
                                    and (word is None or nxt.x0 - c.x1 < 0.6 * word))):
            out.append(Char(" ", c.x1, c.y0, nxt.x0, c.y1, c.oy, c.family, c.weight, c.italic, c.size,
                            c.color, c.mark if c.mark == nxt.mark else None))
            i = j
            continue
        i += 1
    return out


def _edge_char(line: Line, last: bool) -> Char:
    ink = [c for c in line.chars if c.c.strip()] or line.chars
    return ink[-1] if last else ink[0]


def same_run(a: Char, b: Char) -> bool:
    """Two characters of one run of type: the same face, size (within
    0.25 pt) and colour."""
    return a.family == b.family and abs(a.size - b.size) <= 0.25 and a.color == b.color


def merge_pieces(pieces: list[Line]) -> list[Line]:
    """Join the pieces MuPDF splits one printed line into, on one baseline
    and upright. Two numbers or single letters (`tick_text`) join only in
    one face, size (within 0.25 pt) and colour, less than 0.3 em apart: a
    chart's ticks stay apart, a number set in pieces (`1` `000`) is one.
    Words join less than an em apart (a heading's en and em gaps, a chip's
    number before its words) when their sizes match where they meet. Two
    digits are never joined by a space (`5 0` was the 5 and the 0 of two
    ticks)."""
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
                if abs(p.base - q.base) >= 0.3 * tol or gap <= -0.3 * tol:
                    continue
                a, b = _edge_char(q, True), _edge_char(p, False)
                if tick_text(q.plain) and tick_text(p.plain):
                    joins = same_run(a, b) and gap < 0.3 * tol      # two ticks of a chart stay apart
                else:      # words: an en or em gap set by position, a chip's number before its words
                    joins = gap < 1.0 * tol and (abs(a.size - b.size) <= 0.25 or gap < 0.12 * tol)
                if joins:
                    host = q
                    break
        if host is None:
            out.append(p)
            continue
        digits = _edge_char(host, True).c.isdigit() and _edge_char(p, False).c.isdigit()
        if not digits and p.x0 - host.x1 > 0.12 * host.size_mm and host.chars[-1].c != " " and p.chars[0].c != " ":
            last = host.chars[-1]
            host.chars.append(Char(" ", last.x1, last.y0, p.x0, last.y1, last.oy, last.family, last.weight,
                                   last.italic, last.size, last.color))
        host.chars.extend(p.chars)
        host.refresh()
    return sorted(out, key=lambda l: (round(l.base, 1), l.x0))


def runs_markdown(chars: list[Char], base_weight: int, base_italic: bool, mark_ids: dict, mode: str) -> str:
    """Inline Markdown of a run of characters: bold, italic, highlight marks."""
    segs: list[tuple[Any, list[pmd.Run]]] = []
    # the base face: the font most of the base-weight letters are set in. A run in another
    # font (a Medium file beside the Book) is bold at 100 over the base; within one font,
    # whose reported weight alone varies, at 150
    fonts: dict[Any, int] = {}
    for c in chars:
        if c.c.strip() and c.weight <= base_weight and c.font:
            fonts[c.font] = fonts.get(c.font, 0) + 1
    base_font = max(fonts, key=lambda k: (fonts[k], k)) if fonts else None
    for c in chars:
        other = base_font is not None and c.font is not None and c.font != base_font
        bold = c.weight >= max(500, base_weight + (100 if other else 150)) if c.c.strip() else False
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


def _rect_path(items: Any) -> bool:
    """Is a clip path a plain rectangle (one `re`, or four lines straight
    across and down)?"""
    items = list(items or [])
    if len(items) == 1 and items[0][0] in ("re", "qu"):
        if items[0][0] == "re":
            return True
        q = items[0][1]
        return abs(q.ul.y - q.ur.y) < 0.01 and abs(q.ul.x - q.ll.x) < 0.01
    if items and len(items) <= 4 and all(it[0] == "l" for it in items):
        return all(abs(it[1][0] - it[2][0]) < 0.01 or abs(it[1][1] - it[2][1]) < 0.01 for it in items)
    return False


def drawings_with_clips(page: fitz.Page) -> list[tuple[dict, Any, bool]]:
    """The page's paths (`get_drawings(extended=True)`), each with the clip
    it is painted in: (path, the clip's box in pt or None, whether that clip
    is a plain rectangle). Clips nest by level; a path at level L is inside
    every clip above it at a lower level, and their boxes are intersected."""
    out: list[tuple[dict, Any, bool]] = []
    stack: list[tuple[int, Any, bool]] = []
    for d in page.get_drawings(extended=True):
        kind = d.get("type")
        level = int(d.get("level") or 0)
        while stack and stack[-1][0] >= level:
            stack.pop()
        if kind == "clip":
            r = fitz.Rect(d.get("scissor") or d.get("rect") or page.rect)
            exact = _rect_path(d.get("items"))
            if stack:
                r = r & stack[-1][1]
                exact = exact and stack[-1][2]
            stack.append((level, r, exact))
            continue
        if kind == "group" or not d.get("items"):
            continue
        out.append((d, stack[-1][1] if stack else None, stack[-1][2] if stack else True))
    return out


def clip_segment(p: tuple, q: tuple, box: tuple) -> tuple | None:
    """The part of the segment p-q inside `box` (Liang-Barsky), or None."""
    t0, t1 = 0.0, 1.0
    dx, dy = q[0] - p[0], q[1] - p[1]
    for num, den in ((p[0] - box[0], -dx), (box[2] - p[0], dx), (p[1] - box[1], -dy), (box[3] - p[1], dy)):
        if abs(den) < 1e-12:
            if num < 0:
                return None
            continue
        t = num / den
        if den < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return ((p[0] + t0 * dx, p[1] + t0 * dy), (p[0] + t1 * dx, p[1] + t1 * dy))


class Shape:
    def __init__(self, d: dict, origin: tuple, clip: Any = None, clip_exact: bool = True):
        self.rect_pt = tuple(d["rect"])
        self.box = to_mm(d["rect"], origin)
        self.raw_box = self.box
        #: the clip the path is painted in (mm), when it cuts the path: `box` is then what shows of it
        self.clip: tuple | None = None
        self.clip_exact = clip_exact
        self.clipped = False
        if clip is not None:
            c = to_mm(clip, origin)
            half = float(d.get("width") or 0) * PT_MM / 2 if d.get("color") is not None else 0.0
            if not inside_mm(self.box, c, 0.1 + half):
                self.clip, self.clipped = c, True
                b = self.box
                self.box = (max(b[0], c[0]), max(b[1], c[1]), min(b[2], c[2]), min(b[3], c[3]))
                if self.box[2] < self.box[0] or self.box[3] < self.box[1]:      # clipped away whole
                    self.box = (c[0], c[1], c[0], c[1])
        self.fill = hexc(d.get("fill")) if d.get("fill") is not None and (d.get("fill_opacity") or 1) > 0.2 else None
        self.stroke = hexc(d.get("color")) if d.get("color") is not None and (d.get("stroke_opacity") or 1) > 0.2 else None
        self.width = float(d.get("width") or 0)
        self.items = d.get("items", [])
        self.seq = d.get("seqno", 0)
        self.kind = "art"
        self.origin = origin
        self.raw = d
        self.dash = dash_mm(d.get("dashes"))
        self.segs: list = []

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

    def mm_lines(self) -> list[tuple] | None:
        """The path's pieces in mm when it is made of straight lines only,
        cut to the clip the path is painted in (what lies outside it does
        not print)."""
        out = []
        for it in self.items:
            if it[0] != "l":
                return None
            piece = (((it[1][0] - self.origin[0]) * PT_MM, (it[1][1] - self.origin[1]) * PT_MM),
                     ((it[2][0] - self.origin[0]) * PT_MM, (it[2][1] - self.origin[1]) * PT_MM))
            if self.clip is not None:
                piece = clip_segment(piece[0], piece[1], self.clip)
                if piece is None:
                    continue
            out.append(piece)
        return out

    def mm_items(self) -> list[tuple]:
        """The path's items in mm (line_art.items_path)."""
        ox, oy = self.origin[0], self.origin[1]

        def q(p: Any) -> tuple[float, float]:
            return ((p[0] - ox) * PT_MM, (p[1] - oy) * PT_MM)

        out: list[tuple] = []
        for it in self.items:
            if it[0] == "l":
                out.append(("l", q(it[1]), q(it[2])))
            elif it[0] == "c":
                out.append(("c", q(it[1]), q(it[2]), q(it[3]), q(it[4])))
            elif it[0] == "re":
                r = it[1]
                a, b = q((r.x0, r.y0)), q((r.x1, r.y1))
                out.append(("re", a[0], a[1], b[0], b[1]))
            elif it[0] == "qu":
                k = it[1]
                out.append(("qu", q(k.ul), q(k.ur), q(k.ll), q(k.lr)))
        return out

    def corner_radii(self) -> list[float]:
        """Radius of each corner (top-left, top-right, bottom-right,
        bottom-left): the curve that turns it, 0 for a square one."""
        x0, y0, x1, y1 = self.box
        corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        radii = [0.0, 0.0, 0.0, 0.0]
        ox, oy = self.origin[0], self.origin[1]
        for it in self.items:
            if it[0] != "c":
                continue
            a = ((it[1][0] - ox) * PT_MM, (it[1][1] - oy) * PT_MM)
            b = ((it[4][0] - ox) * PT_MM, (it[4][1] - oy) * PT_MM)
            r = max(abs(b[0] - a[0]), abs(b[1] - a[1]))
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            k = min(range(4), key=lambda i: math.hypot(mid[0] - corners[i][0], mid[1] - corners[i][1]))
            radii[k] = max(radii[k], round(r, 2))
        return radii

    def rect_like(self) -> bool:
        """A rectangle (corners rounded or not): a filled one a clip cuts is
        one too, its box what shows inside the clip's box (exact for a plain
        rectangular clip); a clipped outline is not (what shows of it is no
        rectangle's outline)."""
        if not self.items or len(self.items) > 16 or (self.clipped and self.stroke):
            return False
        if all(it[0] == "re" for it in self.items):
            return True
        x0, y0, x1, y1 = self.raw_box
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


RULE_FILL_MM = 1.0        # a filled rectangle thinner than this is a rule
HIDDEN_SHOWS = 0.03       # share of its box a hidden fill must show to be drawn (its ring)


def box_dist(p: tuple, b: tuple) -> float:
    """How far a point (mm) lies outside a box (0 inside it)."""
    dx = max(b[0] - p[0], 0.0, p[0] - b[2])
    dy = max(b[1] - p[1], 0.0, p[1] - b[3])
    return math.hypot(dx, dy)


def fill_rule(s: Shape) -> la.Seg | None:
    """A filled rectangle under 1 mm thick read as a line: one segment along
    its length, as thick as the rectangle (pt), in its fill colour. None for
    anything else (a stroked, curved or square shape)."""
    if not s.fill or s.stroke or not s.items or len(s.items) > 5 or any(it[0] == "c" for it in s.items):
        return None
    if not s.rect_like():
        return None
    thick, long = min(s.w, s.h), max(s.w, s.h)
    if not 0 < thick < RULE_FILL_MM or long < 1.5 or long < 3 * thick:
        return None
    key = (s.fill, round(thick * MM, 2), ())
    x0, y0, x1, y1 = s.box
    if s.w >= s.h:
        return la.Seg("h", (y0 + y1) / 2, x0, x1, key, {s.seq})
    return la.Seg("v", (x0 + x1) / 2, y0, y1, key, {s.seq})


def dash_mm(dashes: Any) -> list[float]:
    """A PDF dash array (`[ 3 2 ] 0`) in mm; [] for a solid line."""
    if not dashes or not isinstance(dashes, str) or "[" not in dashes:
        return []
    inner = dashes[dashes.index("[") + 1:dashes.index("]")] if "]" in dashes else ""
    out = []
    for tok in inner.split():
        try:
            out.append(round(float(tok) * PT_MM, 2))
        except ValueError:
            return []
    return out if any(v > 0 for v in out) else []


GRID_TEXT = 0.6           # share of a ruled grid's cells that must hold text for it to be a table


def crosses_cells(l: Any, table: Any, origin: tuple, tol: float = 1.0) -> bool:
    """Does a text line run across the edge between two cells of its row
    (more than `tol` mm on both sides)? Words of a table stay in their cells."""
    for row in table.rows:
        cells = [to_mm(c, origin) for c in row.cells if c is not None]
        if not cells:
            continue
        rb = to_mm(row.bbox, origin)
        if not rb[1] <= (l.y0 + l.y1) / 2 <= rb[3]:
            continue
        edges = sorted({c[2] for c in cells} - {max(c[2] for c in cells)})
        return any(l.x0 + tol < x < l.x1 - tol for x in edges)
    return False


def grid_tables(page: fitz.Page, origin: tuple, lines: list, opts: argparse.Namespace) -> list[dict]:
    """The page's ruled grids that are tables (PyMuPDF `find_tables`,
    `lines_strict`: at least 2 × 2 cells, text in most of them), each as
    {box (mm), model, style, notes} through `extract_tables` (the cells'
    align, bold and fills, the nearest rules preset). The header row is the
    first when it is filled or bold. `lines`: the page's text lines, for the
    table's face."""
    if getattr(opts, "no_tables", False) or not hasattr(page, "find_tables"):
        return []
    import contextlib

    try:
        with contextlib.redirect_stdout(sys.stderr):
            found = page.find_tables(strategy="lines_strict")
    except Exception:
        return []
    page_area = origin[2] * origin[3]
    out: list[dict] = []
    cache: dict = {}
    for t in found.tables:
        if t.row_count < 2 or t.col_count < 2:
            continue
        cells = [c for r in t.extract() for c in r if c is not None]
        if not cells or sum(1 for c in cells if et.clean(c)) < GRID_TEXT * len(cells):
            continue
        box = to_mm(t.bbox, origin)
        if area(box) > 0.8 * page_area:
            continue
        mine = [l for l in lines if centre_in(l.box, box)]
        if any(crosses_cells(l, t, origin) for l in mine):
            continue        # words run across its rules: a drawing on a grid, not a table
        model = et.table_model(t, 1, page, cache)
        style, notes = model.pop("_style"), model.pop("_notes")
        if not (style.get("headerBackgroundEnabled") or style.get("headerBold")):
            model = et.table_model(t, 0, page, cache)
            style, notes = model.pop("_style"), model.pop("_notes")
        rows = [r for r in model["rows"] if any(c["content"] for c in r)]
        if len(rows) < 2 or max(len(r) for r in rows) < 2:
            continue
        if mine:
            look = dominant(mine)
            face = {"bodyFontFamily": look["family"], "bodyFontSize": ptv(look["size"]),
                    "bodyColor": colour(look["color"]), "headerFontFamily": look["family"],
                    "headerFontSize": ptv(look["size"])}
            if model["headerRowCount"] and t.rows:
                y1 = to_mm(t.rows[0].bbox, origin)[3]
                head = [l for l in mine if (l.box[1] + l.box[3]) / 2 < y1]
                if head:
                    face["headerColor"] = colour(dominant(head)["color"])
            # the padding: half what a row has over its line, the tightest row's
            slack = [(to_mm(r.bbox, origin)[3] - to_mm(r.bbox, origin)[1]) * MM - look["size"] * 1.2 for r in t.rows]
            if slack and min(slack) > 0:
                face["cellPadding"] = ptv(min(slack) / 2)
            style = {**face, **style}
        out.append({"box": box, "model": model, "style": style, "notes": notes})
    return out


def cuts_word(l: Line, box: tuple) -> bool:
    """A band edge falls inside a word of the line: the band's padding takes
    in the edge letters of the words beside its own, by less than half a
    word. A band hugging part of a long word (a syllable) covers most of it
    or a run of letters away from the band's edge."""
    word: list[Char] = []
    for c in l.chars + [None]:
        if c is not None and c.c.strip():
            word.append(c)
            continue
        if word:
            ins = [centre_in((w.x0, w.y0, w.x1, w.y1), box) for w in word]
            if any(ins) and not all(ins) and sum(ins) <= 2 and sum(ins) < len(word) / 2:
                return True
        word = []
    return False


def is_mask(s: Any, shapes: list, lines: list[Line]) -> bool:
    """A borderless fill of the colour behind it (the filled shape painted
    before it that holds it, else the white paper) under one or two lines:
    a mask that blanks out a picture or a rule under the words. It is no
    box: a frame of its own would split the paragraph it sits under."""
    if not s.fill or s.stroke:
        return False
    held = [l for l in lines if not l.rotate and centre_in(l.box, s.box)]
    if not 1 <= len(held) <= 2:
        return False
    # every fill painted before it that it overlaps must be its colour (a white tab half
    # over a blue box shows as a tab), and so must the paper where nothing holds it
    over = [o for o in shapes if o is not s and o.fill and o.seq < s.seq and inter(o.box, s.box) > 0.02 * area(s.box)]
    if any(td.delta_e(s.fill, o.fill) > 3 for o in over):
        return False
    held_by = [o for o in over if inside_mm(s.box, o.box, 0.5)]
    return bool(held_by) or td.delta_e(s.fill, "#ffffff") <= 3


def classify(page: fitz.Page, lines: list[Line], origin: tuple, renders: Renders, opts: argparse.Namespace,
             claims: list = ()) -> dict:
    """Sort the page's shapes and images into ground, cards, highlight bands,
    tabs, boxes and pictures. `claims`: boxes (mm) of the page's tables
    (`grid_tables`): the shapes inside one are the table's (kind `table`)."""
    w_mm, h_mm = origin[2], origin[3]
    page_area = w_mm * h_mm
    shapes = [Shape(d, origin, clip, exact) for d, clip, exact in drawings_with_clips(page)]
    tabled = [s for s in shapes if any(inside_mm(s.box, b, 0.6) for b in claims)]
    for s in tabled:
        s.kind = "table"
    if tabled:     # read apart from the rest; back in `shapes` at the end
        shapes = [s for s in shapes if s.kind != "table"]
    out: dict[str, list] = {"ground": [], "cards": [], "bands": [], "tabs": [], "boxes": [], "art": []}
    # highlight bands: wide strokes or fills hugging words on a line
    for s in shapes:
        b = s.band()
        col = s.stroke
        if b is None and s.fill and s.rect_like() and s.h < 13:
            b, col = s.box, s.fill
        if b is None or whiteish(col):
            continue
        over_lines = [(l, [c for c in l.chars if c.c.strip() and centre_in((c.x0, c.y0, c.x1, c.y1), b)])
                      for l in lines]
        over_lines = [(l, cs) for l, cs in over_lines if cs]
        over = [c for _, cs in over_lines for c in cs]
        if not over:
            continue
        size = statistics.median(c.size for c in over) * PT_MM
        bh = b[3] - b[1]
        if not (0.6 * size <= bh <= 2.4 * size):
            continue
        if s.band() is None:
            # a filled band hugs its words, or covers words of one line that runs on past it
            # (a highlight with room round it): never a box that would cut the line in two
            x0, x1 = min(c.x0 for c in over), max(c.x1 for c in over)
            hugs = x0 - b[0] <= 1.5 and b[2] - x1 <= 1.5 and s.h < 9 and not any(
                cuts_word(l, b) for l, _ in over_lines)
            in_line = len(over_lines) == 1 and len(over) < sum(1 for c in over_lines[0][0].chars if c.c.strip())
            if not (hugs or in_line):
                continue
        else:
            hugs = True
        s.kind = "band"
        # a loose band (room round its words) marks whole words only: its padding covers
        # the edge letters of the words beside it
        out["bands"].append({"box": b, "color": col, "shape": s, "loose": not hugs})
    # thin straight lines across and down (a diagram's connectors, a pointer, a rule): read as
    # lines, never as boxes or as a picture's art (round-1 grounds kept them in a raster)
    out["lines"] = []
    if not getattr(opts, "raster_ground", False):
        for s in shapes:
            if s.kind != "art" or s.fill is not None or s.stroke is None or not 0 < s.width <= opts.line_width:
                continue
            pieces = s.mm_lines()
            segs = la.line_segments(pieces, (s.stroke, round(s.width, 2), tuple(s.dash)), s.seq) if pieces else None
            if not segs or len(segs) > 16:
                continue
            s.kind = "line"
            s.segs = segs
            out["lines"].append(s)
        # one slanted stroke with an end at a box, a tab or a line of text: a leader (a note's
        # line to what it names), read against the frames as a connector to a picture's point
        out["leaders"] = []
        stops = [l.box for l in lines] + [s.box for s in shapes if s.kind == "art" and s.rect_like()
                                          and (s.fill or s.stroke) and s.w >= 6 and s.h >= 4
                                          and area(s.box) < opts.card_area * page_area]
        for s in shapes:
            if s.kind != "art" or s.fill is not None or s.stroke is None or not 0 < s.width <= opts.line_width:
                continue
            pieces = s.mm_lines()
            if not pieces or len(pieces) != 1:
                continue
            (x0, y0), (x1, y1) = pieces[0]
            if min(abs(x1 - x0), abs(y1 - y0)) <= la.SLANT or math.hypot(x1 - x0, y1 - y0) < 3.0:
                continue
            if not any(box_dist(e, b) <= la.REACH for e in ((x0, y0), (x1, y1)) for b in stops):
                continue
            s.kind = "leader"
            s.leader = ((x0, y0), (x1, y1))
            out["leaders"].append(s)
        # a rule drawn as a filled rectangle under 1 mm thick (guides, table and
        # margin rules from layout programs) is a line of that thickness too
        for s in shapes:
            seg = s.kind == "art" and fill_rule(s)
            if not seg:
                continue
            s.kind = "line"
            s.stroke, s.fill, s.width = s.fill, None, seg.key[1]
            s.segs = [seg]
            out["lines"].append(s)
    for s in shapes:
        if s.kind in ("band", "line", "leader"):
            continue
        a = area(s.box)
        if s.fill and not s.stroke and whiteish(s.fill) and opts.card_area * page_area <= a < 0.97 * page_area \
                and s.rect_like():
            s.kind = "card"
        elif s.fill and a >= 0.6 * page_area:
            s.kind = "ground"
        elif s.rect_like() and (s.fill or s.stroke) and s.w >= 6 and s.h >= 4 and a < 0.6 * page_area:
            if is_mask(s, shapes, lines):
                s.kind = "mask"     # owns no lines and is not drawn
                continue
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
            if not twin.fill and s.fill:
                twin.fill_seq = s.seq     # the fill is painted with the later path
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
    # art no pixel of its colour shows (lettering clipped away, a drawing in the bleed, a shape
    # under a white panel painted after it) is unseen: no picture, no box's art, no decoration.
    # Clustered with what shows, it made pictures of blank paper and a plate read as a map
    for s in shapes:
        if s.kind not in ("art", "hidden"):    # (a fill the box check calls hidden may show a ring)
            continue
        if s.box[2] <= 0 or s.box[0] >= w_mm or s.box[3] <= 0 or s.box[1] >= h_mm \
                or (s.clipped and s.w <= 0 and s.h <= 0):
            s.kind = "unseen"       # wholly off the trim, or clipped away
            continue
        if s.w < 0.6 or s.h < 0.6:
            continue
        cols = [c for c in (s.fill, s.stroke) if c and not whiteish(c)]
        if cols and not any(renders.paints(s.rect_pt, c) for c in cols):
            s.kind = "unseen"
        elif s.kind == "hidden" and s.fill and not s.stroke:
            # a fill the box check calls hidden is drawn for the ring it shows round what covers it;
            # one that shows next to nothing (a few pixels at an edge) is debris
            share = renders.share_of(s.rect_pt, s.fill)
            if share is not None and share < HIDDEN_SHOWS:
                s.debris = True     # no decoration; still redrawn when the ground is compared
    # a speck too small to tell (the dot of an i) goes with the unseen shapes of its colour
    # painted next to it
    by_seq = {s.seq: s for s in shapes}
    for s in shapes:
        if s.kind == "art" and (s.w < 0.6 or s.h < 0.6) and any(
                (o := by_seq.get(s.seq + d)) is not None and o.kind == "unseen" and (o.fill, o.stroke) == (s.fill, s.stroke)
                for d in (-3, -2, -1, 1, 2, 3)):
            s.kind = "unseen"
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
    clusters = join_lines(cluster_boxes(items, opts.art_gap),
                          [s for s in out["lines"] if not in_tab(s.box)], opts.art_gap,
                          [s.box for s in out["boxes"]] + [t.box for t in tabs], opts.min_picture)
    # evenly spaced parallel strokes that join nothing (a cover's hatching): one shape, never lines
    loose = [s for s in out["lines"] + out.get("leaders", []) if not getattr(s, "in_cluster", False)]
    out["hatches"] = find_hatches(loose, [l.box for l in lines])
    for grp in out["hatches"]:
        for s in grp:
            s.kind = "hatch"
    out["lines"] = [s for s in out["lines"] if s.kind == "line"]
    if "leaders" in out:
        out["leaders"] = [s for s in out["leaders"] if s.kind == "leader"]
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
    out["pictures"] = [p for p in pictures if area(p["box"]) < 0.6 * page_area]
    # a box with no words that lies wholly under a picture is the picture's art (a map's
    # frame, a panel of a drawing): it goes with the cut, not as a frame or a decoration fill
    for s in list(out["boxes"]):
        if any(inside_mm(s.box, p["box"], 0.3) for p in out["pictures"]) \
                and not any(centre_in(l.box, s.box) for l in lines):
            s.kind = "art"
            out["boxes"].remove(s)
    out["art"] = art
    out["shapes"] = sorted(shapes + tabled, key=lambda s: s.seq) if tabled else shapes
    return out


def neighbours_of(box: tuple, sh: dict, origin: tuple) -> list[tuple]:
    """The shapes round a picture's box that are not its own: boxes, tabs,
    highlights and lines that reach into the box without holding it, as
    (shape, rect_pt, [colours]). A box that holds the whole picture is its
    ground, not a neighbour."""
    out = []
    cands = [(s, fitz.Rect(s.rect_pt)) for s in list(sh.get("boxes", [])) + list(sh.get("tabs", []))
             + list(sh.get("lines", []))]
    cands += [(b["shape"], to_pt(b["box"], origin)) for b in sh.get("bands", [])]
    for s, r in cands:
        if getattr(s, "picture_art", False):
            continue
        sb = s.box if s.kind != "band" else to_mm(r, origin)
        if inter(sb, box) <= 0 or inside_mm(box, sb, 0.5):
            continue
        # MuPDF takes a stroked path out only when the rectangle covers its miters too
        w = 6 * (s.width or 0) if s.stroke else 0
        rect = (r.x0 - w - 0.6, r.y0 - w - 0.6, r.x1 + w + 0.6, r.y1 + w + 0.6)
        cols = [c for c in (s.fill, s.stroke) if c]
        if s.kind == "band":
            cols = [s.stroke or s.fill]
        out.append((s, rect, [c for c in cols if c]))
    return out


def paint_log(page: fitz.Page, shapes: list) -> tuple[list, dict[int, int]]:
    """The page's paint order (`get_bboxlog`) and each path's place in it:
    the log lists more than the paths (images, text, shadings), so each
    path is matched to its own entry, in order."""
    log = page.get_bboxlog()
    at_log: dict[int, int] = {}
    j = 0
    for s in sorted(shapes, key=lambda s: s.seq):
        r = s.rect_pt
        # a stroke's entry reaches past its path by up to its miters (ten half widths a side)
        reach = 0.6 + (10 * s.width if s.stroke else 0.0)
        for k in range(j, len(log)):
            kind, q = log[k]
            if not kind.endswith("-path"):
                continue
            if all(abs(a - b) < 0.6 for a, b in zip(q, r)) or (
                    kind == "stroke-path" and s.stroke and q[0] <= r[0] + 0.6 and q[1] <= r[1] + 0.6
                    and q[2] >= r[2] - 0.6 and q[3] >= r[3] - 0.6
                    and all(abs(a - b) < reach for a, b in zip(q, r))):
                at_log[s.seq] = k
                j = k + 1
                break
    return log, at_log


def lies_over(log: list, at: int | None, own: tuple, pic: tuple, origin: tuple) -> bool:
    """Is a shape painted at `at` in the paint log (a plate, a note's box)
    over the picture whose box is `pic` where the two meet? What the page
    paints inside the picture's box across the shape's box (`own`, mm) is
    weighed by the area it covers there, before the shape and after it:
    a plate painted before its photo lies under it."""
    if at is None:
        return False
    meet = (max(own[0], pic[0]), max(own[1], pic[1]), min(own[2], pic[2]), min(own[3], pic[3]))
    if meet[2] <= meet[0] or meet[3] <= meet[1]:
        return False
    before = after = 0.0
    for i, (kind, r) in enumerate(log):
        if i == at or kind not in ("fill-image", "fill-path", "fill-shade", "stroke-path"):
            continue
        b = to_mm(r, origin)
        if not inside_mm(b, pic, 0.5) or inside_mm(b, own, 0.3):
            continue
        a = inter(b, meet)
        if a <= 0:
            continue
        if i < at:
            before += a
        else:
            after += a
    return before > 0 and before >= after


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


def join_lines(clusters: list[dict], lines: list, gap: float, stops: list | None = None,
               alone: float = 8.0) -> list[dict]:
    """Clusters of art with the thin lines that belong to them (a chart's
    axes, grid and ticks, a map's scale bar): a line joins the clusters it
    touches (within `gap` mm) when it lies inside their joint box grown by
    a tenth of its own length (2.5 mm at least), or when half of it lies in
    that box and the rest reaches none of the `stops` (the boxes and tabs
    of the page, as mm boxes) outside it. Lines read as lines since round 2
    held a chart together no more, so its bars came out as pictures of
    their own. A line that runs on out of the art to a box (a pointer to a
    note) or far past it (a rule past an icon) joins nothing. Each line
    joined counts as a shape of the cluster; lines alone make no cluster.
    A line never joins two clusters that are pictures on their own (at least
    `alone` mm both ways, three shapes or an image): a row of drawings
    standing on one rule stays a row of pictures."""
    stops = list(stops or [])

    def picture_alone(c: dict) -> bool:
        b = c["box"]
        return min(b[2] - b[0], b[3] - b[1]) >= alone and (c["n"] >= 3 or bool(c["images"]))

    clusters = [dict(c, lines=c.get("lines", 0)) for c in clusters]
    pending = sorted(lines, key=lambda s: s.seq)
    changed = True
    while changed and pending:
        changed = False
        for s in list(pending):
            b = s.box
            near = (b[0] - gap, b[1] - gap, b[2] + gap, b[3] + gap)
            touched = [c for c in clusters if near[0] <= c["box"][2] and c["box"][0] <= near[2]
                       and near[1] <= c["box"][3] and c["box"][1] <= near[3]]
            if not touched:
                continue
            if sum(1 for c in touched if picture_alone(c)) > 1:
                continue
            joint = union([c["box"] for c in touched])
            r = max(2.5, 0.1 * max(s.w, s.h))
            if not inside_mm(b, joint, r):
                thick = (b[0] - 0.1, b[1] - 0.1, b[2] + 0.1, b[3] + 0.1)
                if inter(thick, grow(joint, gap)) < 0.5 * area(thick):
                    continue
                reach = grow(b, 2.5)
                if any(inter(reach, t) > 0 and not inside_mm(t, joint, gap) for t in stops):
                    continue
            merged = {"box": union([joint, b]), "n": sum(c["n"] for c in touched) + 1,
                      "images": [im for c in touched for im in c["images"]],
                      "lines": sum(c["lines"] for c in touched) + 1}
            clusters = [c for c in clusters if not any(c is t for t in touched)] + [merged]
            pending.remove(s)
            s.in_cluster = True
            changed = True
    return sorted(clusters, key=lambda c: (round(c["box"][1], 2), round(c["box"][0], 2)))


def _touch(a: tuple, b: tuple, tol: float) -> bool:
    return a[0] - tol <= b[2] and b[0] - tol <= a[2] and a[1] - tol <= b[3] and b[1] - tol <= a[3]


def find_hatches(shapes: list, text_boxes: list, step_max: float = 4.0, least: int = 3) -> list[list]:
    """Hatching: `least` or more strokes of one look, each a single straight
    piece, parallel (within a degree), side by side along their length and
    at an even spacing (each step within a quarter of the first, 0.2 to
    `step_max` mm), touching no other stroke (a tree's drops meet its bar)
    and with no line of text set between two of them (a table's rules). Read
    as lines they came out as connectors and stubs; as one shape they are
    one path. Returns the groups of shapes, in paint order."""
    import collections

    rows = []
    for s in shapes:
        pcs = s.mm_lines()
        if not pcs or len(pcs) != 1:
            continue
        (x0, y0), (x1, y1) = pcs[0]
        length = math.hypot(x1 - x0, y1 - y0)
        if length < 2.0:
            continue
        ang = math.atan2(y1 - y0, x1 - x0) % math.pi
        rows.append((s, ang, pcs[0], length))
    buckets: dict[tuple, list] = collections.defaultdict(list)
    for r in rows:
        s = r[0]
        buckets[(s.stroke, round(s.width, 2), tuple(s.dash), round(math.degrees(r[1])) % 180)].append(r)
    out: list[list] = []
    for key, rs in sorted(buckets.items(), key=lambda kv: str(kv[0])):
        if len(rs) < least:
            continue
        a = statistics.median(r[1] for r in rs)
        u, n = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))

        def off(r: tuple) -> float:
            (x0, y0), (x1, y1) = r[2]
            return n[0] * (x0 + x1) / 2 + n[1] * (y0 + y1) / 2

        def span(r: tuple) -> tuple[float, float]:
            ts = sorted(u[0] * p[0] + u[1] * p[1] for p in r[2])
            return ts[0], ts[1]

        runs: list[list] = []
        run: list = []
        step = None
        for r in sorted(rs, key=off):
            if run:
                d = off(r) - off(run[-1])
                (a0, a1), (b0, b1) = span(run[-1]), span(r)
                side = min(a1, b1) - max(a0, b0) > 0.5 * min(a1 - a0, b1 - b0)
                if side and 0.2 < d <= step_max and (step is None or abs(d - step) <= 0.25 * step):
                    step = d if step is None else step
                    run.append(r)
                    continue
                runs.append(run)
            run, step = [r], None
        runs.append(run)
        for run in runs:
            if len(run) < least:
                continue
            members = {id(r[0]) for r in run}
            others = [o for o in shapes if id(o) not in members]
            if any(_touch(r[0].box, o.box, 0.6) for r in run for o in others):
                continue
            offs = [off(r) for r in run]
            between = False
            for b in text_boxes:
                if not inside_mm(b, union([r[0].box for r in run]), 0.0):
                    continue
                corners = [n[0] * x + n[1] * y for x in (b[0], b[2]) for y in (b[1], b[3])]
                lo, hi = min(corners), max(corners)
                if any(o1 < lo and hi < o2 for o1, o2 in zip(offs, offs[1:])):
                    between = True
                    break
            if not between:
                out.append(sorted((r[0] for r in run), key=lambda s: s.seq))
    return sorted(out, key=lambda g: g[0].seq)


def hatch_element(eid: str, grp: list) -> dict:
    """A hatch as one path element: its strokes as one line each."""
    s0 = grp[0]
    pieces = [s.mm_lines()[0] for s in grp]
    pad = max(0.3, s0.width * PT_MM / 2 + 0.1)
    xs = [p[0] for pc in pieces for p in pc]
    ys = [p[1] for pc in pieces for p in pc]
    box = (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)
    d = " ".join(f"M{la._n(a[0] - box[0])} {la._n(a[1] - box[1])} L{la._n(b[0] - box[0])} {la._n(b[1] - box[1])}"
                 for a, b in pieces)
    return path_element(eid, box, d, None, s0.stroke, s0.width, s0.dash)


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


def list_levels(lines: list[Line], tol: float = 1.5) -> list[float]:
    """The x0 (mm) of each list level in a run of lines: the bullets' left
    edges clustered within `tol` mm, left to right."""
    xs = sorted(b.x0 for b in (bullet_of(l) for l in lines) if b is not None)
    levels: list[float] = []
    for x in xs:
        if not levels or x - levels[-1] > tol:
            levels.append(x)
    return levels


def level_of_bullet(b: Char, levels: list[float]) -> int:
    """The depth (0 = top) of a bullet among `list_levels`, at most 4."""
    if not levels:
        return 0
    return min(4, min(range(len(levels)), key=lambda i: abs(levels[i] - b.x0)))


def item_size(line: Line) -> float:
    """The text size (pt) of a list item's line, its bullet left out."""
    b = bullet_of(line)
    sizes = [c.size for c in line.chars if c.c.strip() and c is not b]
    return statistics.median(sizes) if sizes else line.size


def bullet_look(items: list[Line]) -> dict:
    """bulletChar, size (em of the item text) and weight of the bullets of
    one list level: the most common of each."""
    bs = [(bullet_of(l), item_size(l)) for l in items]
    chars: dict[str, int] = {}
    weights: dict[int, int] = {}
    colours: dict[str, int] = {}
    for b, _ in bs:
        chars[b.c] = chars.get(b.c, 0) + 1
        weights[b.weight] = weights.get(b.weight, 0) + 1
        colours[b.color] = colours.get(b.color, 0) + 1
    ratio = statistics.median(b.size / s for b, s in bs if s > 0) if bs else 1.0
    return {"bulletChar": max(chars, key=lambda k: (chars[k], k)),
            "bulletFontSize": {"value": round(ratio * 20) / 20, "unit": "em"},
            "bulletFontWeight": max(weights, key=lambda k: (weights[k], -k)),
            "color": max(colours, key=lambda k: (colours[k], k))}


def item_spacing(lines: list[Line]) -> float | None:
    """The room (mm) between two list items over the leading of their
    lines: the median of what each item's first baseline stands below the
    last baseline of the item before, less the leading. None without two
    items one under the other."""
    paras = [p for p in paragraphs(lines) if bullet_of(p[0])]
    leads = [s for p in paragraphs(lines) for s in [para_lead(p)] if s]
    if len(paras) < 2:
        return None
    size = statistics.median(l.size_mm for p in paras for l in p)
    lead = statistics.median(leads) if leads else LEADS.get((paras[0][0].family, round(paras[0][0].size * 4) / 4),
                                                           size * 1.25)
    steps = []
    for a, b in zip(paras, paras[1:]):
        step = b[0].base - a[-1].base
        if 0 < step < 3 * lead:
            steps.append(step - lead)
    if not steps:
        return None
    return max(0.0, statistics.median(steps))


def list_style(lines: list[Line], left_edge: float) -> dict | None:
    """A frame's `lists` style from its top-level bullets: the character,
    its colour, size and weight measured against the item text, the indent
    from the frame's text edge and the gap from the bullet to the text."""
    bl = [l for l in lines if bullet_of(l)]
    if not bl:
        return None
    levels = list_levels(bl)
    top = [l for l in bl if level_of_bullet(bullet_of(l), levels) == 0]
    b = bullet_of(top[0])
    look = bullet_look(top)
    st = {"bulletChar": look["bulletChar"], "color": colour(look["color"]),
          "indent": mmv(max(0.0, b.x0 - left_edge)), "gap": mmv(max(0.5, text_x0(top[0]) - b.x1)),
          "bulletFontSize": look["bulletFontSize"], "bulletFontWeight": look["bulletFontWeight"]}
    sp = item_spacing(lines)
    if sp is not None:
        st["itemSpacing"] = mmv(sp)
    return st


def unordered_lists(found: dict[int, list[dict]]) -> dict | None:
    """`unorderedLists` for the suggested config from every list level read
    (`describe_frame` fills `found`, depth -> bullet looks): level 1 sets the
    list's own bullet, each level its `levels[]` entry, so a box style that
    keeps the level-1 bullet leaves the nested ones alone."""
    if not found:
        return None

    def most(depth: int) -> dict:
        looks = found[depth]
        keys = [json.dumps(x, sort_keys=True) for x in looks]
        best = max(set(keys), key=lambda k: (keys.count(k), k))
        return json.loads(best)

    first = most(min(found))
    out: dict[str, Any] = {"bulletChar": first["bulletChar"], "bulletFontSize": first["bulletFontSize"],
                           "fontWeight": first["bulletFontWeight"], "levels": []}
    if first.get("color"):
        out["color"] = colour(first["color"])
    for depth in sorted(found):
        lk = most(depth)
        out["levels"].append({"level": depth + 1, "bulletChar": lk["bulletChar"], "fontSize": lk["bulletFontSize"],
                              "fontWeight": lk["bulletFontWeight"]})
    return out


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


def is_folio(line: Line) -> bool:
    return bool(re.fullmatch(r"\d{1,4}", line.plain))


def look_key(line: Line) -> tuple:
    """Where and how a line is set, for telling running heads: its top to
    the mm, its face and size."""
    return (round(line.y0), line.family, round(line.size * 2) / 2)


def repeated_looks(caches: dict, pages: list[int]) -> dict[tuple, set[int]]:
    """look_key -> the pages a line of that place and look is printed on."""
    out: dict[tuple, set[int]] = {}
    for p in pages:
        for l in caches[p]["lines"]:
            out.setdefault(look_key(l), set()).add(p)
    return out


def furniture_line(l: Line, lines: list[Line], ctx: dict) -> bool:
    """A line outside the cards is a running head or a folio when it stands
    at the same place in the same look on two pages or more of the run, or,
    set below heading size, when the page prints a folio (a running head at
    the top of a page numbered at the foot counts). A heading-size line
    seen on one page only (a section heading near the foot) stays in the
    text; a running head set large comes back on the other pages."""
    rep = ctx.get("repeated") or {}
    y, fam, size = look_key(l)
    seen: set[int] = set()
    for dy in (-1, 0, 1):
        seen |= rep.get((y + dy, fam, size), set())
    if len(seen) >= 2:
        return True
    if l.size >= ctx["heading_min"]:
        return False
    return is_folio(l) or any(o is not l and is_folio(o) for o in lines)


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


def _space_char(c: Char, s: str) -> Char:
    return Char(s, c.x0, c.y0, c.x1, c.y1, c.oy, c.family, c.weight, c.italic, c.size, c.color, None)


def tracking(chars: list[Char]) -> float:
    """The letter spacing (mm) of a run of characters: the median gap
    between two touching letters (MuPDF's boxes are the advances, so 0 for
    text set solid). Spaced capitals in a running head have a few tenths
    of an em between every two letters, which no gap rule should read as a
    space."""
    gaps = [b.x0 - a.x1 for a, b in zip(chars, chars[1:]) if a.c.strip() and b.c.strip()]
    return max(0.0, statistics.median(gaps)) if gaps else 0.0


def spaced_chars(chars: list[Char], em: float, only_lead: bool = False) -> list[Char]:
    """The characters with each run of spaces between two words replaced by
    the space its measured width stands for (`postext_md.fixed_space`): a
    plain space, an en space or an em space; a fixed or no-break space the
    source set itself is kept. `em` in mm. A gap is fixed only when, less
    the letter spacing, it is over half an em and at least 1.6 times the
    narrowest other word space of the run: spaced capitals and justified lines stay
    plain. With `only_lead`, only the gap after a highlighted run (a chip, a
    number on a band) that opens the text is measured."""
    # the runs of spaces between two words: (first space index, next ink index, gap)
    gaps: list[tuple[int, int, float]] = []
    prev_ink = None
    i = 0
    n = len(chars)
    while i < n:
        if chars[i].c.strip():
            prev_ink = i
            i += 1
            continue
        j = i
        while j < n and not chars[j].c.strip():
            j += 1
        if prev_ink is not None and j < n:
            gaps.append((i, j, chars[j].x0 - chars[prev_ink].x1))
        i = j
    track = tracking(chars)
    first_ink = next((c for c in chars if c.c.strip()), None)
    lead_mark = first_ink.mark if first_ink is not None else None
    # with only_lead, the one gap measured ends at the first word past the opening highlight
    lead_end = next((x for x, c in enumerate(chars) if c.c.strip() and c.mark != lead_mark), None) \
        if lead_mark is not None else None
    replace: dict[int, tuple[int, str]] = {}
    for k, (i, j, gap) in enumerate(gaps):
        run = chars[i:j]
        own = next((g.c for g in run if g.c in pmd.FIXED_SPACES + pmd.NO_BREAK_SPACES), None)
        if own is not None:
            replace[i] = (j, own)
            continue
        if only_lead and (lead_end is None or j != lead_end):
            continue
        others = [g - track for kk, (_, _, g) in enumerate(gaps) if kk != k]
        g = gap - track
        sp = pmd.fixed_space(g, em)
        if sp != " " and others and g < 1.6 * min(others):
            sp = " "
        if sp != " ":
            replace[i] = (j, sp)
    out: list[Char] = []
    i = 0
    while i < n:
        if i in replace:
            j, sp = replace[i]
            out.append(_space_char(chars[i], sp))
            i = j
            continue
        out.append(chars[i])
        i += 1
    return out


def text_em(chars: list[Char]) -> float:
    """The em (mm) of a run of characters: its most common size."""
    sizes = [round(c.size * 4) / 4 for c in chars if c.c.strip() and not c.mark] or \
        [round(c.size * 4) / 4 for c in chars if c.c.strip()]
    return (statistics.mode(sizes) if sizes else 10.0) * PT_MM


def spaced_text(line: Line) -> str:
    """A heading, running head or tab line's text with its measured spaces:
    the room between a chip or a number and the title (an en or em space)
    survives as a fixed space."""
    return "".join(c.c for c in spaced_chars(line.chars, text_em(line.chars))).strip()


def lead_chip_gaps(lines: list[Line], bands: list[dict], out: dict[str, list[float]]) -> None:
    """For each highlight colour, the room (em of the text after it) between
    a band that opens a line and the next word's ink: what a chip style's
    `gap` keeps (`--highlights chip`)."""
    for l in lines:
        ink = [c for c in l.chars if c.c.strip()]
        if len(ink) < 2 or ink[0].mark is None:
            continue
        col = ink[0].mark
        k = next((i for i, c in enumerate(ink) if c.mark != col), None)
        if k is None:
            continue
        last, nxt = ink[k - 1], ink[k]
        band = next((b["box"] for b in bands if b["color"] == col and centre_in((last.x0, last.y0, last.x1, last.y1), b["box"])), None)
        edge = band[2] if band else last.x1
        em = nxt.size * PT_MM
        if em > 0 and nxt.x0 > edge:
            out.setdefault(col, []).append((nxt.x0 - edge) / em)


def chip_gap(gaps: list[float]) -> dict | None:
    """The chip style's `gap` from the measured rooms after opening chips,
    when it is wider than a word space (the engine's default is 0.25 em)."""
    if not gaps:
        return None
    g = statistics.median(gaps)
    return {"value": round(g, 2), "unit": "em"} if g >= 0.4 else None


def para_markdown(p: list[Line], mark_ids: dict, mode: str, base: tuple[int, bool] | None = None) -> str:
    """A paragraph's inline Markdown. `base` is the (weight, italic) of the
    frame's body: a paragraph set wholly in bold in a regular frame keeps its
    `**`. Without it the paragraph's own lightest weight is the base."""
    chars = para_chars(p)
    ink = [c for c in chars if c.c.strip()]
    if not ink:
        return ""
    if mode == "mark":
        # a chip set as a mark (a number on a band) before the words keeps its measured room
        chars = spaced_chars(chars, text_em(chars), only_lead=True)
    if base is not None:
        base_w, base_it = base
    else:
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
    italic = all(c.italic for l in lines for c in l.chars if c.c.strip() and c.family == fam)
    leads = [s for p in paragraphs(lines) for s in [para_lead(p)] if s]
    lead = statistics.median(leads) if leads else LEADS.get((fam, size), size * PT_MM * 1.25)
    return {"family": fam, "size": size, "color": col, "weight": min(weights) if weights else 400,
            "lead": round(lead, 3), "italic": italic}


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
            inside = [c.c.strip() != "" and centre_in((c.x0, c.y0, c.x1, c.y1), b["box"]) for c in l.chars]
            if b.get("loose"):
                k = 0
                while k < len(l.chars):     # a word is marked when all of it is inside
                    if not l.chars[k].c.strip():
                        k += 1
                        continue
                    e = k
                    while e < len(l.chars) and l.chars[e].c.strip():
                        e += 1
                    whole = all(inside[k:e])
                    for q in range(k, e):
                        inside[q] = whole
                    k = e
            for c, ins in zip(l.chars, inside):
                if ins:
                    c.mark = b["color"]
    for l in lines:   # a space between two marked words is marked too
        ink = [i for i, c in enumerate(l.chars) if c.c.strip()]
        for i, c in enumerate(l.chars):
            if c.c.strip():
                continue
            before = [j for j in ink if j < i]
            after = [j for j in ink if j > i]
            c.mark = l.chars[before[-1]].mark if before and after and l.chars[before[-1]].mark == l.chars[after[0]].mark else None
    for l in lines:
        if any(c.mark for c in l.chars):
            l.refresh()
    lead_chip_gaps(lines, sh["bands"], ctx.setdefault("chip_gaps", {}))
    cards =sorted(sh["cards"], key=lambda s: (round(s.box[1], 1), s.box[0]))
    boxes = sh["boxes"]
    tabs = sh["tabs"]
    pictures = sh["pictures"]
    # a tab of the card's own colour standing on its top edge is grown out of the card: the card's
    # outline draws it (vector_decoration), the frame keeps only its words
    if not opts.raster_ground:
        for t in tabs:
            for k, c in enumerate(cards):
                if t.fill and c.fill and td.delta_e(t.fill, c.fill) <= 3 \
                        and la.card_tab_path(c.box, 0.0, t.box, 0.0) is not None:
                    t.card_tab = k
                    break
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

    def ground_round(box: tuple) -> str:
        """The colour a picture stands on: its holder's, else the paper's
        just round its box (the picture's own median is no ground)."""
        if any(inside_mm(box, b.box, 0.5) and b.fill for b in boxes) or any(inside_mm(box, c.box, 0.5) for c in cards):
            return container_bg(box)
        on = [c for c in cards if inter(box, c.box) >= 0.5 * area(box)]
        if on:      # mostly on a card (reaching past its edge): the card's
            return on[0].fill or "#ffffff"
        ring = [(box[0] - 2.0, box[1] - 2.0, box[2] + 2.0, box[1] - 0.5), (box[0] - 2.0, box[3] + 0.5, box[2] + 2.0, box[3] + 2.0),
                (box[0] - 2.0, box[1], box[0] - 0.5, box[3]), (box[2] + 0.5, box[1], box[2] + 2.0, box[3])]
        cols = [renders.colour_at(to_pt(r, origin)) for r in ring
                if r[0] >= 0 and r[1] >= 0 and r[2] <= W and r[3] <= H]
        return max(set(cols), key=cols.count) if cols else container_bg(box)

    # a cluster of drawn shapes that paints nothing of its own (white shapes on white paper, a
    # corner of a plate, what a neighbour's fill leaves) is no picture
    kept = []
    for p in pictures:
        if not p["images"]:
            holes = [(r, c) for _, r, c in neighbours_of(p["box"], sh, origin)]
            if renders.own_ink(to_pt(p["box"], origin), container_bg(p["box"]), holes) is None:
                report["notes"].append(f"a drawing at {r2(p['box'])} paints nothing of its own: no picture")
                continue
        kept.append(p)
    pictures = sh["pictures"] = kept
    # a key of symbol rows (legends.py, #1144): a line printed twice is one, the key's rows leave the flow
    key_text = lambda l: l.label_dict(ctx["mark_ids"], opts.highlights)["text"]  # noqa: E731
    lines = lgd.take_legends(lines, page, origin, pictures, cache, report, key_text)

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
    # a chart keeps its lettering: ticks, month letters and axis titles stay in its cut
    for p in pictures:
        if chart_guard(p, lines, sh.get("lines", []), opts.label_reach, tabs):
            report["notes"].append(f"a chart at {r2(p['box'])}: its lettering stays in the cut, no labels")
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
                # a word on the art, or a short one set on the picture's margin (a map's degrees);
                # every word of a chart
                if p.get("chart") or few_words(l.plain) or renders.ink_fraction(to_pt(l.box, origin), bg) >= opts.label_ink:
                    cands.append((area(p["box"]), "picture", p))
        if cands:
            owners[id(l)] = min(cands, key=lambda c: c[0])[1:]
        elif cards and any(centre_in(l.box, c.box) for c in cards):
            owners[id(l)] = ("free", None)
        elif not cards and opts.margin_band < l.y0 and l.y1 < H - opts.margin_band:
            owners[id(l)] = ("free", None)
        elif len(l.plain.split()) > 8 or not furniture_line(l, lines, ctx):
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
        if p.get("chart"):
            f.chart_lines, f.lines = f.lines, []     # in the cut, not labels
        if f.lines:
            f.kind = "figure"
        frames.append(f)
    # tables (`grid_tables`): a frame each, filled with the table resource (laid like a picture)
    for tb in cache.get("tables", []):
        f = Frame("picture", tb["box"], picture={"box": tb["box"], "images": [], "vector": 0})
        f.table = tb
        f.lines = []
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
    frames = merge_text_frames(frames)
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
    plates_over_pictures(page, frames, sh, origin, renders)

    # a border with no words of its own is no frame (an empty `:::frame`): it is drawn by the
    # decoration round the frames it holds, or by the picture it lies in
    borders: list[dict] = []
    if not opts.raster_ground:
        for f in [f for f in frames if f.kind == "box"]:
            if any(l.plain.strip() for l in f.lines):
                continue
            if f.tab is not None and getattr(f.tab, "line", None) is not None:
                if f.parent is not None and f.parent.kind in ("picture", "figure"):
                    continue     # a tabbed box on a picture (an inset): its words stay a frame
                # the tab's words are a frame of their own; the box is a border round what it holds
                t = Frame("tab", f.tab.box, shape=f.tab, lines=[f.tab.line])
                t.zone = f.zone
                frames.append(t)
                f.tab = None
            frames.remove(f)
            held = [g for g in frames if g.parent is f or (g.parent is None and inside_mm(g.box, f.box, 0.5))]
            for g in frames:
                if g.parent is f:
                    g.parent = f.parent if f.parent is not None and f.parent in frames else None
                    g.overlay = False
            if f.parent is not None and f.parent.kind in ("picture", "figure"):
                f.shape.picture_art = True
                continue        # part of the picture's art: the cut has it
            borders.append({"shape": f.shape, "tab": f.tab, "box": f.box, "held": held})

    frames += split_captions(frames)
    beside_captions(frames)
    # a box's measure is its box unless something stands in it beside the words
    for f in frames:
        if f.kind != "box" or not f.lines or f.shape is None:
            continue
        x1 = max(l.x1 for l in f.lines)
        side = (x1 + 0.5, min(l.y0 for l in f.lines), f.shape.box[2], max(l.y1 for l in f.lines))
        anc_ = set()
        q = f.parent
        while q is not None:
            anc_.add(id(q))
            q = q.parent
        f.right_free = side[2] - side[0] > 1.0 and not any(
            g is not f and id(g) not in anc_ and inter(g.box, side) > 1.0 for g in frames)

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
    # a caption frame comes right after its picture in reading order
    for f in [g for g in ordered if getattr(g, "caption_of", None) is not None]:
        p = f.caption_of
        if p not in ordered:
            continue
        ordered.remove(f)
        k = ordered.index(p) + 1
        while k < len(ordered) and getattr(ordered[k], "caption_of", None) is p:
            k += 1
        ordered.insert(k, f)

    # names
    counters: dict[str, int] = {}
    for f in ordered:
        role = "table" if getattr(f, "table", None) else {
            "title": "title", "text": "text", "box": "box", "tab": "tab", "picture": "picture", "figure": "figure"}[f.kind]
        counters[role] = counters.get(role, 0) + 1
        n = counters[role]
        if role in ("title", "text"):
            f.name = role if n == 1 else f"{role}-{n}"
            if f.name == "text" and getattr(f, "caption_of", None) is not None:
                f.name = "text-1"   # a caption is never the page's flow (`text` is written bare)
        else:
            f.name = f"{role}-{n}"
    free_text = [f for f in ordered if f.kind == "text" and not f.rotate and getattr(f, "caption_of", None) is None]
    flow = next((f for f in free_text if sum(len(l.plain.split()) for l in f.lines) >= 8),
                next(iter(free_text), None))
    if flow is not None and flow.name != "text":
        other = next((f for f in ordered if f.name == "text"), None)
        if other is not None:
            other.name = flow.name
        flow.name = "text"

    # styles, content, resources
    rid_base = f"{opts.prefix}{pno + 1:02d}"
    res: list[dict] = []
    if not opts.raster_ground:
        mark_art_over_fills(ordered, sh)
    for f in ordered:
        describe_frame(f, ctx, opts, report)
    # the page's line art, read against the frames: connectors, pointers, what is left
    art = None if opts.raster_ground else read_line_art(sh, ordered, line_shows(page, origin, sh.get("shapes", [])))
    pic_n = 0
    for f in ordered:
        if getattr(f, "table", None):
            rid = f"{rid_base}-{f.name}"
            f.alpha = False
            f.resource = {"id": rid, "typeId": "table", "kind": "table", "caption": "",
                          "table": {"model": f.table["model"], "styleId": rid}, "_style": f.table["style"]}
            report["notes"] += [f"{f.name}: {n}" for n in f.table["notes"]]
            res.append(f.resource)
            p = f.parent
            if p is not None and p.kind == "box" and p.lines:
                # set in a box's text: the table goes in that text where it stood, not in a frame
                # over it (the box's text, set anew, would run under it)
                k = sum(1 for para in paragraphs(p.lines) if para[0].y0 < f.box[1])
                p.blocks.insert(min(k, len(p.blocks)), ("raw", 0, f'::resource{{id="{rid}"}}'))
                f.inline = True
            continue
        if f.kind in ("picture", "figure"):
            pic_n += 1
            rid = f"{rid_base}-{f.name}"
            f.resource = cut_picture(pdf_path, doc, pno, f, origin, rid, opts, renders, cards,
                                     remove=lines_over(art, sh, f.box, origin) if art else None,
                                     neighbours=None if opts.raster_ground else neighbours_of(f.box, sh, origin),
                                     art=[s for s in sh.get("shapes", []) if s.kind == "art"],
                                     background=ground_round(f.box), over=drawn_over(f, ordered),
                                     rounds=sh["boxes"] + cards, holders=sh["boxes"])
            cap = getattr(f, "resource_caption", None)
            if cap:
                f.resource["caption"] = para_markdown(cap, ctx["mark_ids"], opts.highlights)
                side = getattr(f, "caption_side", None)
                if side:
                    # beside the picture, inside the frame (the cut is made, the frame now holds both)
                    pl, f.box = beside_placement(f.box, f.caption_box, side)
                    f.resource["placement"] = {**(f.resource.get("placement") or {}), **pl}
            res.append(f.resource)
            frame_of = {id(g.shape): g.name for g in ordered if g.shape is not None}
            laid_over = drawn_over(f, ordered)
            # a box laid over the picture or held in it is drawn over the cut; a cut-out with alpha
            # may stand over its box's edge on purpose
            ruled = [s for s in sh["boxes"] + sh["tabs"] if id(s) not in laid_over and not inside_mm(s.box, f.box, 0.5)]
            for s in ([] if f.alpha else crossed_rules(f.box, ruled)):
                report["notes"].append(f"{f.name}: the cut crosses the rule of {frame_of.get(id(s), 'a box')} "
                                       f"at {r2(s.box)} mm; check the cut")
            if f.kind == "figure":
                twin = label_series(f.lines)
                if twin:
                    report["notes"].append(f"{f.name}: labels of {twin[0]} pt and {twin[1]} pt form two evenly "
                                           "spaced series over each other; one may be a hidden copy, check the source")
                items = [l.label_dict(ctx["mark_ids"], opts.highlights) for l in f.lines]
                notes: list[str] = []
                groups = anc.merge_lines(items, merge=not opts.no_merge_labels, notes=notes)
                if notes:
                    report["notes"].extend(notes)
                ctx["label_groups"].append(groups)
                f.labels = groups
    res += lgd.place_legends(ordered, cache, Path(opts.out), ctx, key_text)

    ordered = [f for f in ordered if not getattr(f, "inline", False)]     # tables set in a box's text
    # geometry and the template
    template = make_template(rid_base, ordered, cards, origin, opts, report)
    heads: dict = {}
    deco, attrs = furniture_decoration(furniture, pno, origin, ctx, report, heads)
    ground_id = f"{rid_base}-ground"
    if opts.raster_ground:
        gfile = cut_ground(pdf_path, pno, origin, sh, ordered, opts, ground_id)
        res.insert(0, {"id": ground_id, "typeId": "ground", "kind": "bitmap", "file": gfile["file"],
                       "width": gfile["width"], "height": gfile["height"], "resolution": opts.ground_dpi,
                       "caption": "", "altText": ""})
        template["decoration"] = {"elements": [
            {"kind": "image", "id": "ground", "resourceId": "{attr.ground}", "decorative": True,
             "placement": {"anchor": {"to": "page", "edge": "top-left"},
                           "size": {"width": mmv(W), "height": mmv(H)}}}] + deco}
        attrs = {"ground": ground_id, **attrs}
    else:
        vdeco, vground = vector_decoration(pdf_path, pno, origin, sh, ordered, cards, borders, art, opts,
                                           ground_id, report, template=template)
        template["decoration"] = {"elements": vdeco + deco}
        anchor_ornaments(template["decoration"]["elements"], heads)
        if vground:
            res.insert(0, {"id": ground_id, "typeId": "ground", "kind": "bitmap", "file": vground["file"],
                           "width": vground["width"], "height": vground["height"], "resolution": opts.ground_dpi,
                           "caption": "", "altText": ""})
            attrs = {"ground": ground_id, **attrs}
        for f in ordered:
            if f.kind in ("picture", "figure") and not f.labels and getattr(f, "pointer_anchors", None):
                f.resource["anchors"] = list(f.pointer_anchors)
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
    if not opts.raster_ground:
        regions["decoration"] = report.get("decoration", {})
    return {"template": template, "frames": ordered, "resources": res, "attrs": attrs, "report": report,
            "regions": regions}


def single_caption(box: Any, pic: Any, col: list) -> bool:
    """One column of lines under one picture is its caption when it is set
    unlike the box's other text (size, slant or colour) or centred on the
    picture; otherwise it is the box's last paragraph."""
    rest = [l for l in box.lines if l not in col]
    if not rest:
        return False
    body = dominant(rest)
    look = dominant(col)
    differs = abs(look["size"] - body["size"]) > 0.25 or look["color"] != body["color"] or \
        all(c.italic for l in col for c in l.chars if c.c.strip()) != bool(body.get("italic"))
    mid = (min(l.x0 for l in col) + max(l.x1 for l in col)) / 2
    width = max(l.x1 for l in col) - min(l.x0 for l in col)
    centred = abs(mid - (pic.box[0] + pic.box[2]) / 2) <= 2.0 and width < (pic.box[2] - pic.box[0]) - 4.0
    return differs or centred


def attached_caption(pic: Any, col: list, body: dict) -> bool:
    """A caption set smaller than the box's text, at most 3 mm under its
    picture and no wider than it: the picture's resource caption (#1114)."""
    look = dominant(col)
    gap = min(l.y0 for l in col) - pic.box[3]
    width = max(l.x1 for l in col) - min(l.x0 for l in col)
    return look["size"] <= 0.92 * body["size"] and gap <= 3.0 and width <= (pic.box[2] - pic.box[0]) + 2.0


def beside_caption(pic: Any, lines: list, body: dict, gap: float = 3.0) -> tuple[str, list] | None:
    """A small caption set beside its picture (#1114): lines of the box to
    its left or right, no more than `gap` mm from its side, the column's top
    level with the picture's top or its foot level with the picture's foot
    (within `gap`), no taller than the picture and a line, and set smaller
    than the box's text. Returns the side the caption stands on and its
    lines, else None."""
    px0, py0, px1, py1 = pic.box
    for side in ("right", "left"):
        col = [l for l in lines if py0 - gap <= l.y0 and l.y1 <= py1 + gap and
               ((side == "right" and 0 <= l.x0 - px1 <= gap) or (side == "left" and 0 <= px0 - l.x1 <= gap))]
        if not col:
            continue
        col.sort(key=lambda l: l.base)
        top, foot = min(l.y0 for l in col), max(l.y1 for l in col)
        line = max(l.size_mm for l in col) * 1.25
        if not (abs(top - py0) <= gap or abs(foot - py1) <= gap) or foot - top > (py1 - py0) + line:
            continue
        if dominant(col)["size"] > 0.92 * body["size"]:
            continue
        return side, col
    return None


def beside_captions(frames: list) -> None:
    """Small captions beside the pictures of a box become the pictures'
    resource captions (`resource_caption`), with the side they stand on
    (`caption_side`): the picture's resource is set `captionSide: "inside"`
    and its frame takes the caption's room. The box keeps its other lines."""
    for c in [f for f in frames if f.kind == "box" and f.lines]:
        pics = [g for g in frames if g.parent is c and g.kind == "picture" and getattr(g, "resource_caption", None) is None]
        for p in pics:
            rest = c.lines
            found = beside_caption(p, rest, dominant(rest))
            if found is None:
                continue
            side, col = found
            others = [l for l in rest if l not in col]
            if not others or dominant(others)["size"] < dominant(col)["size"] + 0.25:
                continue      # the box has no text of its own set larger: no caption to tell apart
            p.resource_caption, p.caption_side = col, side
            p.caption_box = set_box(col, None)
            c.lines = others


def beside_placement(pic_box: tuple, cap_box: tuple, side: str) -> tuple[dict, tuple]:
    """The resource placement of a picture with its caption beside it inside
    its own slot (`captionSide: "inside"`, postext 1.52), and the frame's box,
    which now holds both: the picture takes its share of the width at its
    side, the caption the rest after the book's gutter."""
    box = (min(pic_box[0], cap_box[0]), min(pic_box[1], cap_box[1]), max(pic_box[2], cap_box[2]), max(pic_box[3], cap_box[3]))
    share = round((pic_box[2] - pic_box[0]) / max(0.1, box[2] - box[0]), 3)
    return {"captionSide": "inside", "width": share, "align": "left" if side == "right" else "right"}, box


def split_captions(frames: list, reach: float = 8.0) -> list:
    """Captions set in columns under the pictures of a box: the box's lines
    read row by row ran across the columns as one text (a sentence of the
    first caption, then of the second…). Each column of lines that starts
    just under a picture (within `reach` mm below its foot or 3 mm above
    it, its middle over the picture)
    and goes on line by line under itself becomes a text frame of its own,
    a child of the box hung under its picture (`caption_of`). A box with
    two such columns or more always; a single one only when its look differs
    from the box's text (size, slant or colour) or it is centred on the
    picture, else it is the box's own last paragraph. A caption set smaller
    than the box's text and attached to the picture (at most 3 mm under it)
    becomes the picture's resource caption instead (`resource_caption`, no
    frame). A box that gets caption frames grows with them (`grow_with`:
    `growWith: "children"` in its template). Returns the new frames; the
    box keeps the rest of its lines."""
    out = []
    for c in [f for f in frames if f.kind == "box" and f.lines]:
        pics = [g for g in frames if g.parent is c and g.kind in ("picture", "figure")]
        if not pics:
            continue
        seeds: dict[int, list] = {}
        for l in c.lines:
            mid = (l.x0 + l.x1) / 2
            # (a photo's box may reach a little past its paint, over the caption's first line)
            under = [p for p in pics if p.box[0] - 1.0 <= mid <= p.box[2] + 1.0 and p.box[3] <= l.y0 + 3.0
                     and l.y0 - p.box[3] <= reach and l.x1 - l.x0 <= (p.box[2] - p.box[0]) + 6.0]
            if under:
                p = min(under, key=lambda p: abs(l.y0 - p.box[3]))
                seeds.setdefault(id(p), []).append(l)
        # a picture of the row whose box reaches over its caption's first line (a drawing's
        # white margin): the line on the baseline the other captions of the row start on
        bases = [min(ls, key=lambda l: l.base).base for ls in seeds.values()]
        seeded = {id(l) for ls in seeds.values() for l in ls}
        for p in pics:
            got = [l for l in c.lines if id(l) not in seeded and p.box[0] - 1.0 <= (l.x0 + l.x1) / 2 <= p.box[2] + 1.0
                   and any(abs(l.base - b) < 0.5 for b in bases) and l.y0 >= (p.box[1] + p.box[3]) / 2
                   and l.x1 - l.x0 <= (p.box[2] - p.box[0]) + 6.0]
            if got:
                seeds[id(p)] = seeds.get(id(p), []) + got
                seeded |= {id(l) for l in got}
        groups: list[tuple[Any, list]] = []
        for p in pics:
            first = sorted(seeds.get(id(p), []), key=lambda l: l.x0)
            top = min((l.y0 for l in first), default=0.0)
            first = [l for l in first if l.y0 - top < 1.5]     # the first line of each column
            cols: list[list] = []
            for l in first:
                if cols and l.x0 < max(m.x1 for m in cols[-1]) + 1.0:
                    cols[-1].append(l)
                else:
                    cols.append([l])
            groups += [(p, col) for col in cols]
        if not groups or (len(groups) < 2 and not single_caption(c, *groups[0])):
            continue
        taken = {id(l) for _, col in groups for l in col}
        # each column goes on down, line under line
        for _, col in groups:
            while True:
                last = max(col, key=lambda l: l.base)
                lead = last.size_mm * 1.6
                mid = (last.x0 + last.x1) / 2
                nxt = [l for l in c.lines if id(l) not in taken and 0 < l.base - last.base <= lead
                       and (abs((l.x0 + l.x1) / 2 - mid) < 3.0 or abs(l.x0 - last.x0) < 1.5)
                       and not any(o is not l and abs(l.base - o.base) < 0.5 and hoverlap(l.box, o.box) > 0
                                   for o in c.lines)]
                if not nxt:
                    break
                n = min(nxt, key=lambda l: l.base)
                col.append(n)
                taken.add(id(n))
        rest = [l for l in c.lines if id(l) not in taken]
        body = dominant(rest) if rest else None
        for p, col in groups:
            col.sort(key=lambda l: (l.base, l.x0))
            if body is not None and attached_caption(p, col, body) and getattr(p, "resource_caption", None) is None:
                p.resource_caption = col     # the picture's own caption (cmd: resource `caption`)
                continue
            f = Frame("text", set_box(col, None), lines=col)
            f.parent, f.zone, f.caption_of = c, c.zone, p
            f.over = list(pics)       # a longer caption in another edition runs over, not under, a picture
            mid = (min(l.x0 for l in col) + max(l.x1 for l in col)) / 2
            f.caption_centred = len(col) > 1 and is_centred(col) or abs(mid - (p.box[0] + p.box[2]) / 2) <= 2.0
            out.append(f)
            c.grow_with = True       # the box grows with the captions hung in it (postext 1.52)
        c.lines = [l for l in c.lines if id(l) not in taken]
    return out


def meet_box(a: tuple, b: tuple, inset: float = 0.0) -> tuple:
    """Where two boxes meet, `inset` mm in from each side."""
    return (max(a[0], b[0]) + inset, max(a[1], b[1]) + inset, min(a[2], b[2]) - inset, min(a[3], b[3]) - inset)


def drawn_over(p: Frame, frames: list) -> set[int]:
    """Ids of the shapes of the boxes and tabs the draft lays over picture
    `p`: frames set on it, frames the page paints over it
    (`plates_over_pictures`), and a free tab over a free picture (it gets
    a layer above it in `make_template`)."""
    out = set()
    for g in frames:
        if g.kind not in ("box", "tab") or g.shape is None or inter(g.box, p.box) <= 0:
            continue
        if g.parent is p or p in (getattr(g, "over", None) or []) or (
                g.kind == "tab" and g.parent is None and p.parent is None):
            out.add(id(g.shape))
            if g.tab is not None:
                out.add(id(g.tab))
    return out


def plates_over_pictures(page: fitz.Page, frames: list, sh: dict, origin: tuple, renders: Any = None) -> None:
    """A box or a tab with words that the page paints over a picture (a
    plate naming a photo, a note on a drawing, the date boxes on an
    illustrated band) stays over it in the draft. The source's paint order
    decides (`lies_over`): such a frame is never the picture's holder (the
    picture is not laid inside it as an overlay; the frame hangs from the
    picture when it lies mostly on it) and `make_template` gives it a layer
    above the picture's (`f.over`). A plate painted before its photo lies
    under it, as before. With `renders`, a frame with a fill is over the
    picture when its fill is what shows where the two meet."""
    log, at_log = paint_log(page, sh.get("shapes", []))
    for b in frames:
        b.over = []
    pics = [f for f in frames if f.kind in ("picture", "figure")]
    for b in [f for f in frames if f.kind in ("box", "tab") and f.shape is not None and f.lines]:
        for p in pics:
            if inter(b.box, p.box) <= 0.05 * area(b.box):
                continue
            q, holder = p, False
            while q is not None:       # a picture laid inside the box (not over it) is its content
                if q.parent is b and not q.overlay:
                    holder = True
                q = q.parent
            q = b.parent
            while q is not None and not holder:   # the box is already set on the picture
                holder = q is p
                q = q.parent
            if holder:
                continue
            if b.shape.fill and renders is not None:
                # what shows where the two meet decides: the frame's own fill (a plate over its
                # photo), or the picture. The paint order alone misleads where the picture paints
                # nothing over the frame (a band's art that starts below the date boxes on it)
                seen = renders.share_of(to_pt(meet_box(b.shape.box, p.box, 0.5), origin), b.shape.fill)
                if seen is not None:
                    if seen < 0.5:
                        continue
                elif not lies_over(log, at_log.get(b.shape.seq), b.shape.box, p.box, origin):
                    continue
            elif not lies_over(log, at_log.get(b.shape.seq), b.shape.box, p.box, origin):
                continue
            if p.parent is b and p.overlay:
                p.parent, p.overlay = b.parent, False
                if inter(b.box, p.box) >= 0.5 * area(b.box) and b.parent is p.parent:
                    b.parent = p
                    continue
            b.over.append(p)


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


_TICK_NUMBER = re.compile(r"[-+−–]?\d[\d.,   ]*%?")


def tick_text(text: str) -> bool:
    """A chart's tick: a number (`10`, `-2,5`, `40 %`) or one letter (a
    month's initial). Degrees (`20°N`) are a map's, not a tick."""
    t = text.strip()
    if len(t) == 1:
        return t.isalpha() or t.isdigit()
    return bool(t) and len(t) <= 12 and _TICK_NUMBER.fullmatch(t) is not None


def regular_ticks(lines: list[Line], least: int = 3) -> int:
    """How many tick lines (`tick_text`) stand in regular rows or columns: a
    row of `least` or more on one baseline, or a column on one right edge or
    centre, at an even step (each within 30 % of the median)."""
    ticks = [l for l in lines if not l.rotate and tick_text(l.plain)]
    taken: set[int] = set()
    keys = ((lambda l: l.base, lambda l: (l.x0 + l.x1) / 2),       # a row: one baseline, along x
            (lambda l: l.x1, lambda l: l.base),                    # a column set flush right
            (lambda l: (l.x0 + l.x1) / 2, lambda l: l.base))        # a column centred
    for key, along in keys:
        run: list[Line] = []
        for l in sorted(ticks, key=key) + [None]:
            if l is not None and run and abs(key(l) - key(run[-1])) <= 0.6:
                run.append(l)
                continue
            if len(run) >= least:
                pos = sorted(along(m) for m in run)
                steps = [b - a for a, b in zip(pos, pos[1:])]
                med = statistics.median(steps)
                if med > 0.5 and all(abs(s - med) <= 0.3 * med for s in steps):
                    taken |= {id(m) for m in run}
            run = [l] if l is not None else []
    return len(taken)


def chart_guard(p: dict, lines: list[Line], line_shapes: list, reach: float, tabs: list) -> bool:
    """Is picture `p` a chart? Six tick lines or more in regular rows or
    columns (`regular_ticks`), with an axis (a line across half its width
    or down half its height) or a turned axis title. A chart keeps its
    lettering in its cut (`p["chart"]`): its box takes in the ticks, the
    turned titles within 8 mm of its edge and the short words within 6 mm
    (`reach` when larger), and it lifts no
    labels. A map's degrees (`20°N`) are no ticks."""
    box = p["box"]
    held = [l for l in lines if inside_mm(l.box, box, 1.0)]
    if regular_ticks(held) < 6:
        return False
    w, h = box[2] - box[0], box[3] - box[1]
    axis = False
    for s in line_shapes:
        if not inside_mm(s.box, box, 1.0):
            continue
        for g in s.segs:
            if (g.axis == "h" and g.length >= 0.5 * w) or (g.axis == "v" and g.length >= 0.5 * h):
                axis = True
    near = (box[0] - reach, box[1] - reach, box[2] + reach, box[3] + reach)
    turned = any(l.rotate and inter(l.box, near) > 0 for l in lines)
    if not (axis or turned):
        return False
    for _ in range(8):
        wide = grow(p["box"], max(reach, 6.0))      # an axis title stands off the figures
        wider = grow(p["box"], max(reach, 8.0))     # a turned one off the figures up the side
        extra = [l.box for l in lines if not inside_mm(l.box, p["box"], 1.0)
                 and ((l.rotate and inter(l.box, wider) > 0)
                      or (inter(l.box, wide) > 0 and (tick_text(l.plain) or few_words(l.plain))))
                 and not any(inside_mm(l.box, t.box, 1.0) for t in tabs)]
        if not extra:
            break
        p["box"] = union([p["box"]] + extra)
    p["chart"] = True
    return True


def own_lines(f: Any) -> list:
    """The lines a picture's cut must hold whole: its labels, and the
    lettering a chart keeps in its cut."""
    return list(f.lines) + list(getattr(f, "chart_lines", None) or [])


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
            if not same_left and bullet_of(p[0]):
                # an item of a nested list: its bullet within 12 mm right of the list's first bullet
                outer = min((r[0].x0 for r in blk if bullet_of(r[0])), default=None)
                same_left = outer is not None and outer - 1.5 <= p[0].x0 <= outer + 12.0
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


def merge_text_frames(frames: list[Frame]) -> list[Frame]:
    """The last pass over free text: two text frames one under the other,
    flush left, in the same face, size, colour and leading, with nothing
    between them and at most a paragraph's gap apart, are one frame (what a
    mask, a highlight or a stray shape left in two)."""
    def key(f: Frame) -> tuple:
        look = dominant(f.lines)
        return (look["family"], look["size"], look["color"]), look["lead"]

    out = list(frames)
    changed = True
    while changed:
        changed = False
        texts = [f for f in out if f.kind == "text" and f.lines and not getattr(f, "rotate", 0)]
        for a in texts:
            for b in texts:
                if a is b:
                    continue
                last = max(a.lines, key=lambda l: l.base)
                first = min(b.lines, key=lambda l: l.base)
                step = first.base - last.base
                if step <= 0:
                    continue
                (ka, lead_a), (kb, lead_b) = key(a), key(b)
                if ka != kb or (len(a.lines) > 1 and len(b.lines) > 1 and abs(lead_a - lead_b) > 0.3):
                    continue
                if step > 2.2 * lead_a or abs(a.box[0] - b.box[0]) > 3.5 or hoverlap(a.box, b.box) <= 0:
                    continue
                between = (min(a.box[0], b.box[0]), last.y1, max(a.box[2], b.box[2]), first.y0)
                if any(f is not a and f is not b and inter(between, f.box) > 1.0 for f in out):
                    continue
                a.lines = sorted(a.lines + b.lines, key=lambda l: (round(l.base, 1), l.x0))
                a.box = set_box(a.lines, None)
                out.remove(b)
                changed = True
                break
            if changed:
                break
    return out


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


def frame_lead_title(f: Frame, paras: list[list[Line]]) -> list[Line] | None:
    """A frame's first paragraph when it is the frame's title: at most two
    lines and fifteen words, not a list item, with text after it, and set
    apart from that text by being wholly bold (150 over its weight and at
    least 500), 1.12 times its size or more, or in another colour. Panel
    titles set at body size in bold are titles too, in text frames as in
    boxes. A caption frame has none."""
    if len(paras) < 2 or getattr(f, "caption_of", None) is not None:
        return None
    p = paras[0]
    if len(p) > 2 or bullet_of(p[0]) or len(" ".join(l.plain for l in p).split()) > 15:
        return None
    if any(l.base > q.base for l in p for q in paras[1][:1]):
        return None     # the first paragraph must stand above the rest
    rest = [l for q in paras[1:] for l in q]
    ink = [c for l in p for c in l.chars if c.c.strip()]
    rest_ink = [c for l in rest for c in l.chars if c.c.strip()]
    if not ink or not rest_ink or any(c.mark for c in ink):
        return None     # (a highlighted lead keeps its mark: headings set none)
    if sum(1 for c in ink if c.c.isalpha()) < 2:
        return None     # a single letter or a number (a box's "I", "2") is no title
    body = dominant(rest)
    bold = all(c.weight >= max(500, body["weight"] + 150) for c in ink)
    big = statistics.median(c.size for c in ink) >= 1.12 * statistics.median(c.size for c in rest_ink)
    colour_ = dominant(p)["color"] != body["color"]
    return p if (bold or big or colour_) else None


def title_level(p: list[Line], ctx: dict) -> int:
    """The level of a title paragraph: by size among the book's heading
    sizes; one set below heading size goes under the smallest of them, a
    level further down when it is not bold either."""
    size = statistics.median(c.size for l in p for c in l.chars if c.c.strip())
    if size >= ctx["heading_min"]:
        return ctx["level_of"](size)
    deepest = ctx["level_of"](0.0)
    bold = min(c.weight for l in p for c in l.chars if c.c.strip()) >= 500
    return min(6, deepest + (1 if bold else 2))


def describe_frame(f: Frame, ctx: dict, opts: argparse.Namespace, report: dict) -> None:
    """Style and Markdown of one frame."""
    mark_ids = ctx["mark_ids"]
    mode = opts.highlights
    if f.kind in ("picture", "figure"):
        return
    paras = paragraphs(f.lines)
    levels = list_levels(f.lines)
    blocks = []
    centred = f.kind == "text" and (len(f.lines) > 1 and is_centred(f.lines) or getattr(f, "caption_centred", False))
    # the frame body's weight and slant are the base of every paragraph's marks
    body_lines = [l for l in f.lines if l.size < ctx["heading_min"]] or f.lines
    look = dominant(body_lines) if body_lines else None
    base = (int(look["weight"]), bool(look["italic"])) if look else None
    lead_title = frame_lead_title(f, paras) if f.kind in ("box", "text") else None
    for p in paras:
        size = p[0].size
        if (size >= ctx["heading_min"] and f.kind in ("box", "tab", "title")) or p is lead_title:
            level = title_level(p, ctx)
            text = " ".join(spaced_text(l) for l in p)
            blocks.append(("h", level, text))
            continue
        md = para_markdown(p, mark_ids, mode, base)
        if not md:
            continue
        b = bullet_of(p[0])
        if b:
            depth = level_of_bullet(b, levels)
            blocks.append(("li", depth, md))
            ctx.setdefault("list_levels", {}).setdefault(depth, []).append(bullet_look([p[0]]))
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
        if centred and getattr(f, "caption_of", None) is not None:
            # a caption centres its lines in its own style: a paragraph style would set them
            # in the running text's face, not the box's
            f.style["body"]["textAlign"] = "center"
    f.centred = centred


def is_centred(lines: list[Line]) -> bool:
    x0s = [l.x0 for l in lines]
    if max(x0s) - min(x0s) < 1.0:
        return False
    mids = [(l.x0 + l.x1) / 2 for l in lines]
    return max(mids) - min(mids) < 1.5


def body_of(look: dict) -> dict:
    body = {"fontFamily": look["family"], "fontSize": ptv(look["size"]), "lineHeight": mmv(look["lead"]),
            "color": colour(look["color"]), "fontWeight": int(look["weight"]), "boldFontWeight": 700,
            "textAlign": "left", "hyphenation": False, "firstLineIndent": mmv(0)}
    if look.get("italic"):
        # a frame set wholly in italic: its paragraphs carry no `*` (para_markdown's base)
        body["italic"] = True
    return body


def text_style(lines: list[Line], centred: bool) -> dict:
    look = dominant(lines)
    st = {"id": "text", "backgroundEnabled": False, "border": {"enabled": False},
          "padding": {"top": mmv(0), "right": mmv(0), "bottom": mmv(0), "left": mmv(0)}, "body": body_of(look)}
    ls = list_style(lines, min(min(l.x0, text_x0(l)) for l in lines)) if lines else None
    if ls:
        st["lists"] = ls
    return st


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
    if getattr(s, "card_tab", None) is not None:
        # grown out of the card: the card's outline paints it
        st["backgroundEnabled"] = False
        del st["background"]
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
    st: dict[str, Any] = {"id": "box", "backgroundEnabled": bool(s.fill) and not art_over(f)}
    if s.fill and not art_over(f):
        st["background"] = colour(s.fill)
    elif s.fill:
        report["notes"].append(f"{f.name}: art is painted over its fill; the fill is decoration "
                               f"({f.name}-fill), the box style has none")
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
        # a box whose right side holds nothing (`right_free`, build_page) is measured to its
        # box: a longer line in another edition then runs to the box's edge, as the source's
        # designer set the box, not to where the source's longest line stopped
        wide = gap > left + 10.0 and not getattr(f, "right_free", False)
        right = max(0.0, gap if wide else min(left, gap))
        right = give_slack(right, max(0.0, bx1 - bx0 - left - right), ctx)
        lead = look["lead"]
        first = min(f.lines, key=lambda l: l.base)
        last = max(f.lines, key=lambda l: l.base)
        top = max(0.0, first.base - 0.8 * lead - by0)
        bottom = max(0.0, min(by1 - (last.base + 0.2 * lead), 8.0))
        st["padding"] = {"top": mmv(top), "right": mmv(right), "bottom": mmv(bottom), "left": mmv(left)}
        st["body"] = body_of(look)
        ls = list_style(f.lines, bx0 + left)
        if ls:
            st["lists"] = ls
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
                opts: argparse.Namespace, renders: Renders, cards: list | None = None, remove: list | None = None,
                neighbours: list | None = None, art: list | None = None, background: str | None = None,
                over: set | None = None, rounds: list | None = None, holders: list | None = None) -> dict:
    """The picture's file. A picture cut from the page keeps only the picture: its text, the
    lines drawn as decoration, the highlights round it and the boxes and tabs the draft lays
    over it (`over`: ids of their shapes; each is drawn by its own frame or mark) leave the
    cut, unless art of the picture is painted over one, or are painted over in the picture's
    `background` where they show (`paint_out`); a box laid under the picture stays (the cut
    is opaque and would hide it where it lies over it). The cut
    is then no wider than the paint it has of its own (`trim_to_ink`: white margins, a
    neighbour's strip). `art`: the page's art shapes, `background`: the colour the picture
    stands on, `rounds`: the rounded boxes and cards of the page, whose corners clip a
    picture set in them (`round_clip`), `holders`: the page's boxes; a cut without alpha
    stays inside the one that holds it (`holder_of`) and its rule is painted out."""
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
                f.from_image = xref       # the image alone: what the page paints round or over it is not in the cut
    if file is None:
        # A picture cut from the page (no transparency to cut out) lies on its card and is cut no
        # further than the card. A map whose overflow is masked by white rectangles at the card's
        # edge, and the folio's icons a millimetre from them, made a cluster that reached past the
        # card; the cut carried a strip of the page's own colour, which covered the ground when
        # another edition's shorter text moved the picture up. A cut-out with an alpha channel
        # (a photo standing over the card's edge) keeps its overhang.
        if cards and f.zone >= 0:
            cb = cards[f.zone].box
            clipped = (max(f.box[0], cb[0]), max(f.box[1], cb[1]), min(f.box[2], cb[2]), min(f.box[3], cb[3]))
            clipped = keep_lines(clipped, f)
            if clipped != tuple(f.box) and clipped[2] - clipped[0] > 8 and clipped[3] - clipped[1] > 8:
                f.box = clipped
        # likewise no further than the inside of the box that holds it (its rule is the frame's),
        # and no further than a filled rectangle the art is drawn on (its own ground)
        # (the box the shapes took stays the picture's claim: what lies there is its, `claim_of`)
        holder = holder_of(f.box, holders or [], over)
        for edge in ([inner_round(holder)[0]] if holder is not None else []) + [art_ground(f.box, art or [])]:
            if edge is None:
                continue
            clipped = keep_lines(meet_box(f.box, edge), f)
            if clipped != tuple(f.box) and clipped[2] - clipped[0] > 8 and clipped[3] - clipped[1] > 8:
                f.claim = claim_of(f)
                f.box = clipped
        one = fitz.open(str(pdf_path))
        page = one[pno]
        # all the text leaves the cut; a chart keeps the lettering inside its box
        for r in (outside_rects(page.rect, to_pt(grow(f.box, 0.3), origin)) if getattr(f, "chart_lines", None) else [page.rect]):
            page.add_redact_annot(r, fill=False)
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                              text=fitz.PDF_REDACT_TEXT_REMOVE)
        remove = list(remove or []) + lgd.key_rects(p)     # a key the label draws (#1144)
        holes = []
        under = []
        for s, rect, cols in neighbours or []:
            if s.kind == "line" and inside_mm(s.box, f.box, 0.3):
                continue        # a line inside the picture is its art (a scale bar, a key's sample)
            if s.kind not in ("band", "line") and id(s) not in (over or set()):
                # a box the draft lays under the picture (its holder, a note beside it): the
                # cut, opaque, would hide it there; it stays, and only the trim reads past it
                under.append((rect, cols))
                continue
            r = fitz.Rect(rect)
            rb = to_mm(r, origin)
            # art of the picture painted over the neighbour would go with it
            if any(a.seq > s.seq and inside_mm(a.box, rb, 0.0) and inter(a.box, f.box) > 0 for a in art or []):
                holes.append((rect, cols, s))
                continue
            remove.append(r)
        if remove:
            # the connectors and pointers drawn over the picture are decoration now, and so
            # are the boxes, tabs and highlights round it. One rectangle at a time: with
            # several applied at once MuPDF kept paths that one of them covers whole
            for r in remove:
                touched = isinstance(r, tuple)      # ("touched", speck): a slanted leader
                page.add_redact_annot(r[1] if touched else r, fill=False)
                page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
                                      graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED if touched
                                      else fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
                                      text=fitz.PDF_REDACT_TEXT_NONE)
        if holder is not None and holder.stroke:
            # the holder's rule is drawn by its frame: painted out where the cut still meets it
            # (`paint_out`), never redacted (that would take the box's fill, the picture's ground)
            w = 6 * (holder.width or 0) + 0.6
            r = fitz.Rect(holder.rect_pt)
            holes.append(((r.x0 - w, r.y0 - w, r.x1 + w, r.y1 + w), [holder.stroke], rule_of(holder)))
        if neighbours is not None:
            trim_to_ink(page, f, origin, background, [(r, c) for r, c, _ in holes] + under,
                        card=cards[f.zone] if cards and 0 <= f.zone < len(cards) else None)
        pm = page.get_pixmap(dpi=opts.dpi, clip=to_pt(f.box, origin), alpha=False)
        file = out_dir / f"{rid}.jpg"
        if holes:
            paint_out(pm, to_pt(f.box, origin), opts.dpi, holes, background).save(str(file), quality=90)
        else:
            pm.save(str(file), jpg_quality=90)
    from PIL import Image

    if not alpha and (background is None or whiteish(background)):
        # an illustration on white: its outer white is cut out, so it covers no text round it
        with Image.open(file) as im:
            cut = imgs.cutout_white(im)
        if cut is not None:
            png = file.with_suffix(".png")
            cut.save(png, optimize=True)
            if png != file:
                file.unlink(missing_ok=True)
            file, alpha = png, True
    if not alpha:
        clipped = round_clip(file, f, rounds or [])
        if clipped is not None:
            file = clipped
    with Image.open(file) as im:
        w, h = im.size
    res = {"id": rid, "typeId": "picture", "kind": "bitmap", "file": f"resources/{file.name}", "width": w,
           "height": h, "resolution": round(w / ((f.box[2] - f.box[0]) / 25.4), 1), "caption": "", "altText": ""}
    f.alpha = alpha
    if alpha:
        res["contour"] = {"threshold": 0.5, "margin": mmv(1.5)}
    return res


def keep_lines(clipped: tuple, f: Frame) -> tuple:
    """A cut's box clipped to its card, holder or art ground, grown back over
    the picture's own lines (`own_lines`) inside its first box: a clip never
    cuts a label off (the anchors would then be pinned to the edge)."""
    ls = [l.box for l in own_lines(f) if inter(l.box, f.box) > 0]
    if not ls:
        return clipped
    return meet_box(union([clipped] + ls), f.box)


def grow(b: tuple, d: float) -> tuple:
    return (b[0] - d, b[1] - d, b[2] + d, b[3] + d)


def outside_rects(page_rect: Any, box: Any) -> list:
    """The page round `box` (pt) as up to four rectangles: above, below,
    left and right of it."""
    P = fitz.Rect(page_rect)
    out = [fitz.Rect(P.x0, P.y0, P.x1, box.y0), fitz.Rect(P.x0, box.y1, P.x1, P.y1),
           fitz.Rect(P.x0, box.y0, box.x0, box.y1), fitz.Rect(box.x1, box.y0, P.x1, box.y1)]
    return [r for r in out if r.width > 0 and r.height > 0]


def even_rows(lines: list, min_n: int = 4, cv: float = 0.2) -> list[tuple]:
    """Rows (one baseline, within 1 mm) of `min_n` or more labels evenly
    spaced across (the gaps between their centres vary by under `cv` of
    their mean), as (baseline, x0, x1)."""
    rows: list[list] = []
    for l in sorted(lines, key=lambda l: l.base):
        if rows and abs(rows[-1][-1].base - l.base) <= 1.0:
            rows[-1].append(l)
        else:
            rows.append([l])
    out = []
    for row in rows:
        if len(row) < min_n:
            continue
        xs = sorted((l.x0 + l.x1) / 2 for l in row)
        gaps = [b - a for a, b in zip(xs, xs[1:])]
        mean = sum(gaps) / len(gaps)
        if mean > 0 and statistics.pstdev(gaps) <= cv * mean:
            out.append((row[0].base, xs[0], xs[-1]))
    return out


def label_series(lines: list, reach: float = 5.0) -> tuple[float, float] | None:
    """Two label sizes of a figure that each set an evenly spaced row, the
    rows within `reach` mm of each other and across the same stretch: a
    hidden second set of a map's degrees under the visible one (#1135).
    Returns the two sizes (pt), or None."""
    by_size: dict[float, list] = {}
    for l in lines:
        if not l.rotate and l.plain.strip():
            by_size.setdefault(round(l.size, 1), []).append(l)
    sizes = sorted(by_size)
    rows = {s: even_rows(by_size[s]) for s in sizes}
    for i, a in enumerate(sizes):
        for b in sizes[i + 1:]:
            for ra in rows[a]:
                for rb in rows[b]:
                    if abs(ra[0] - rb[0]) <= reach and min(ra[2], rb[2]) - max(ra[1], rb[1]) > 0:
                        return (a, b)
    return None


def holder_of(box: tuple, boxes: list, over: set | None = None) -> Shape | None:
    """The smallest box that holds most of a picture (a box laid over the
    picture, `over`, holds nothing)."""
    cands = [s for s in boxes if id(s) not in (over or set()) and inter(box, s.box) >= 0.6 * area(box)
             and area(s.box) > area(box) * 0.9]
    return min(cands, key=lambda s: area(s.box)) if cands else None


def art_ground(box: tuple, art: list) -> tuple | None:
    """A filled rectangle the picture's art is drawn on (a map's sea, a
    diagram's panel): the first one painted inside the picture's box that
    covers half of it and holds all the art painted after it but white
    masks. The cut goes no further (a mask or the page's colour past it is
    not the picture's). None when there is none, or when any coloured art
    of the picture lies past it (cut there, it would be lost)."""
    inside = [s for s in art if inter(s.box, box) > 0]
    cands = sorted((s for s in inside if s.fill and s.rect_like() and inside_mm(s.box, box, 0.5)
                    and area(s.box) >= 0.5 * area(box)), key=lambda s: s.seq)
    for g in cands:
        rest = [s for s in inside if s is not g and s.seq > g.seq
                and not (s.fill and not s.stroke and whiteish(s.fill))]
        if rest and all(inside_mm(s.box, g.box, 0.3) for s in rest) \
                and not any(s.seq < g.seq and not inside_mm(s.box, g.box, 0.3) and not whiteish(s.fill or s.stroke)
                            for s in inside if s is not g):
            return g.box
    return None


def rule_of(s: Shape) -> Any:
    """A box's stroke alone, as `paint_out` reads a hole's shape."""
    import types
    return types.SimpleNamespace(fill=None, stroke=s.stroke, width=s.width, kind="box", radius=s.radius)


def crossed_rules(box: tuple, shapes: list, inset: float = 0.5) -> list:
    """The boxes whose rule runs through a cut's box (more than `inset` mm
    inside it, over a millimetre of it)."""
    x0, y0, x1, y1 = box[0] + inset, box[1] + inset, box[2] - inset, box[3] - inset
    out = []
    for s in shapes:
        if not s.stroke:
            continue
        sx0, sy0, sx1, sy1 = s.box
        across = min(sx1, x1) - max(sx0, x0) > 1.0
        down = min(sy1, y1) - max(sy0, y0) > 1.0
        if (across and any(y0 < y < y1 for y in (sy0, sy1))) or (down and any(x0 < x < x1 for x in (sx0, sx1))):
            out.append(s)
    return out


def inner_round(s: Shape) -> tuple[tuple, list[float]]:
    """The inside of a box's outline (mm): its rectangle less half the
    stroke, and each corner's radius less the same."""
    half = (s.width * PT_MM / 2) if s.stroke else 0.0
    x0, y0, x1, y1 = s.box
    return (x0 + half, y0 + half, x1 - half, y1 - half), [max(0.0, r - half) for r in s.corner_radii()]


def round_clip(file: Path, f: Frame, rounds: list, scale: int = 2) -> Path | None:
    """A picture set in a rounded box or card and running into one of its
    corners, clipped to the box's inner rectangle and radii: a PNG whose
    corners are transparent (the source clips the picture so; cut square,
    it showed the ground past the curve). None when no rounded box holds the
    picture's corners."""
    import numpy as np
    from PIL import Image

    best = None
    for s in rounds:
        rect, radii = inner_round(s)
        if max(radii) < 0.3 or not inside_mm(f.box, s.box, 0.5):
            continue
        x0, y0, x1, y1 = rect
        b = f.box
        reach = [b[0] < x0 + radii[0] and b[1] < y0 + radii[0], b[2] > x1 - radii[1] and b[1] < y0 + radii[1],
                 b[2] > x1 - radii[2] and b[3] > y1 - radii[2], b[0] < x0 + radii[3] and b[3] > y1 - radii[3]]
        if any(r > 0.3 and hit for r, hit in zip(radii, reach)) and (best is None or area(s.box) < area(best[0].box)):
            best = (s, rect, radii)
    if best is None:
        return None
    _, rect, radii = best
    with Image.open(file) as im:
        rgb = im.convert("RGB")
    w, h = rgb.size
    kx, ky = w / max(f.box[2] - f.box[0], 1e-6), h / max(f.box[3] - f.box[1], 1e-6)
    k = (kx + ky) / 2
    px = ((rect[0] - f.box[0]) * kx * scale, (rect[1] - f.box[1]) * ky * scale,
          (rect[2] - f.box[0]) * kx * scale, (rect[3] - f.box[1]) * ky * scale)
    out = outside_round_rect(h * scale, w * scale, px, [r * k * scale for r in radii])
    cover = 1.0 - out.reshape(h, scale, w, scale).mean(axis=(1, 3))
    rgba = np.dstack([np.asarray(rgb), np.round(cover * 255).astype(np.uint8)])
    png = file.with_suffix(".png")
    Image.fromarray(rgba, "RGBA").save(png, optimize=True)
    if png != file:
        file.unlink(missing_ok=True)
    return png


def paint_out(pm: fitz.Pixmap, clip: fitz.Rect, dpi: int, holes: list, background: str | None):
    """The cut (a PIL image) with what a neighbour left in it painted in the
    picture's `background`: a neighbour the cut could not lose (art of the
    picture is painted over it) shows its outline along its edges and its
    fill where the picture does not cover it. Only pixels of the
    neighbour's own colours are touched."""
    import numpy as np
    from PIL import Image

    a = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.stride)[:, :pm.width * 3]
    a = a.reshape(pm.height, pm.width, 3).copy()
    k = dpi / 72
    bg = np.array([round(v * 255) for v in td.hex_rgb(background or "#ffffff")], dtype=np.uint8)
    ai = a.astype(int)
    h, w = a.shape[:2]
    for rect, _cols, s in holes:
        x0, y0 = int((rect[0] - clip.x0) * k), int((rect[1] - clip.y0) * k)
        x1, y1 = int((rect[2] - clip.x0) * k) + 1, int((rect[3] - clip.y0) * k) + 1
        cx0, cy0, cx1, cy1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
        if cx1 <= cx0 or cy1 <= cy0:
            continue
        sub = ai[cy0:cy1, cx0:cx1]
        hit = np.zeros(sub.shape[:2], dtype=bool)
        if s.fill and not whiteish(s.fill) and s.kind != "line":
            want = np.array([round(v * 255) for v in td.hex_rgb(s.fill)])
            hit |= np.abs(sub - want).sum(axis=2) < 60
        if s.stroke:
            want = np.array([round(v * 255) for v in td.hex_rgb(s.stroke)])
            # the rectangle reaches 6 widths past the path (`neighbours_of`); the stroke runs on it
            band = int((7 * (s.width or 1) + 2.6) * k + 2)
            ys, xs = np.mgrid[cy0:cy1, cx0:cx1]
            edge = (xs - x0 < band) | (x1 - xs < band) | (ys - y0 < band) | (y1 - ys < band)
            r = s.radius() * MM * k if hasattr(s, "radius") else 0.0
            if r > band:      # a rounded corner runs inside the edges' band
                edge |= ((np.minimum(xs - x0, x1 - xs) < r) & (np.minimum(ys - y0, y1 - ys) < r))
            hit |= edge & (np.abs(sub - want).sum(axis=2) < 60)
        a[cy0:cy1, cx0:cx1][hit] = bg
    return Image.fromarray(a)


def claim_of(f: Frame) -> tuple:
    """The box a picture's shapes took on the page before its cut was
    trimmed (`trim_to_ink`): what lies there (a map's white masks) is the
    picture's, neither a loose shape nor a ground."""
    return getattr(f, "claim", None) or f.box


def trim_to_ink(page: fitz.Page, f: Frame, origin: tuple, background: str | None, holes: list,
                dpi: int = 100, margin: float = 0.3, least: float = 1.0, card: Any = None) -> None:
    """Cut a picture's box down to the paint it has of its own on the page
    as it will be cut (`page`: text and neighbours gone). A cluster of
    shapes reaches as far as its widest shape, white masks and all (a map's
    cut began 7 mm over its art, with the highlight of the line above in
    it), and a drawing on white paper as far as its paper.
    A side moves in only by `least` mm or more, keeps `margin` mm, and
    never past a label of the picture."""
    import numpy as np

    clip = to_pt(f.box, origin)
    pm = page.get_pixmap(dpi=dpi, clip=clip, alpha=False)
    a = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.stride)[:, :pm.width * 3]
    a = a.reshape(pm.height, pm.width, 3)
    k = dpi / 72
    win_holes = [(((r[0] - clip.x0) * k, (r[1] - clip.y0) * k, (r[2] - clip.x0) * k, (r[3] - clip.y0) * k), cols)
                 for r, cols in holes]
    outside = None
    if card is not None:
        cr = to_pt(card.box, origin)
        e = 1.5   # the card's own edge, blended with the page's colour, is not the picture's either
        outside = outside_round_rect(pm.height, pm.width, ((cr.x0 - clip.x0) * k + e, (cr.y0 - clip.y0) * k + e,
                                                           (cr.x1 - clip.x0) * k - e, (cr.y1 - clip.y0) * k - e),
                                     [r * MM * k for r in card.corner_radii()])
    got = ink_box(a, background, win_holes, outside)
    if got is None:
        return
    px = PT_MM / k
    ink = (f.box[0] + got[0] * px - margin, f.box[1] + got[1] * px - margin,
           f.box[0] + got[2] * px + margin, f.box[1] + got[3] * px + margin)
    if own_lines(f):
        ink = union([ink] + [l.box for l in own_lines(f)])
    box = list(f.box)
    for i in (0, 1):
        if ink[i] - box[i] >= least:
            box[i] = ink[i]
    for i in (2, 3):
        if box[i] - ink[i] >= least:
            box[i] = ink[i]
    if box[2] - box[0] > 4 and box[3] - box[1] > 4 and tuple(box) != tuple(f.box):
        f.claim = getattr(f, "claim", None) or tuple(f.box)
        f.box = tuple(box)


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
# vector decoration (round 2): the page band, cards, borders, shapes, connectors
# ---------------------------------------------------------------------------


def line_shows(page: fitz.Page, origin: tuple, shapes: list):
    """Does a line show over a picture just back from its end, or does the
    picture, painted after it (the page's paint order), cover it there? A
    line over a map points into it; one under a photo ends at its side. What
    is painted after the line in a small part of the picture's box (the dot
    and the halo at a pointer's end, a label's plate) does not count."""
    log, at_log = paint_log(page, shapes)

    def shows(p: tuple, d_back: tuple, ids: set, box: tuple) -> bool:
        if not any(isinstance(i, int) for i in ids):
            return True
        # a path not found in the paint log is not known to show over the picture: no pointer
        seqs = [at_log[i] for i in ids if isinstance(i, int) and i in at_log]
        if not seqs:
            return False
        last = max(seqs)
        q = ((p[0] + d_back[0] * 0.5) * MM + origin[0], (p[1] + d_back[1] * 0.5) * MM + origin[1])
        big = 0.4 * area(box) * MM * MM
        for i in range(last + 1, len(log)):
            kind, r = log[i]
            if kind in ("fill-image", "fill-path", "fill-shade") and r[0] <= q[0] <= r[2] and r[1] <= q[1] <= r[3] \
                    and (r[2] - r[0]) * (r[3] - r[1]) >= big:
                return False
        return True
    return shows


def mostly_in(a: tuple, b: tuple) -> bool:
    """Is box `a` 80 % inside `b`, or (a speck or a hairline with no area)
    inside it?"""
    return inter(a, b) >= 0.8 * max(area(a), 1e-6) or inside_mm(a, b, 0.3)


def fill_seq(s: Shape) -> int:
    """Where a box's fill comes in the page's paint order."""
    return getattr(s, "fill_seq", s.seq)


def mark_art_over_fills(frames: list[Frame], sh: dict) -> None:
    """Boxes with art painted over their fill (an icon, guides, a rule, a
    connector inside the box): the frame paints over the decoration, so
    the fill goes to the decoration (`fill_element`), under that art, and
    the frame's style is left without it (`box_style`). Art inside a
    picture or a box nested in this one is theirs. Sets `f.art_over` (the
    shapes) on each such frame."""
    pics = [g for g in frames if g.kind in ("picture", "figure")]
    for f in frames:
        s = f.shape
        if f.kind != "box" or s is None or not s.fill or getattr(s, "card_tab", None) is not None:
            continue
        nested = [g.box for g in frames if g is not f and g.kind in ("box", "tab") and inside_mm(g.box, f.box, 0.5)]
        over = [a for a in sh.get("shapes", []) if a.kind in ("art", "line") and a.seq > fill_seq(s)
                and inside_mm(a.box, f.box, 0.3)
                and not any(inter(a.box, g.box) > 0 or inside_mm(a.box, g.box, 0.3) for g in pics)   # touching a picture: its art
                and not any(inside_mm(a.box, b, 0.3) for b in nested)]
        if over:
            f.art_over = over


def art_over(f: Frame) -> bool:
    return bool(getattr(f, "art_over", None))


def drawn_before_fill(s: Any, frames: list[Frame]) -> bool:
    """A shape inside a box whose fill went to the decoration, painted
    before that fill: the source's fill hides it."""
    if isinstance(s, la.Seg):
        seqs, box = [i for i in s.ids if isinstance(i, int)], s.box()
    else:
        seqs, box = [s.seq], s.box
    if not seqs:
        return False
    return any(art_over(f) and inside_mm(box, f.box, 0.3) and max(seqs) < fill_seq(f.shape) for f in frames)


def ground_under(s: Shape, sh: dict, cards: list) -> str:
    """The colour painted under a shape: the last fill painted before it
    that holds its centre (a box, a card, the page's colour), else the
    paper. A mask the source clips at a card's edge stands mostly on the
    card."""
    cx, cy = (s.box[0] + s.box[2]) / 2, (s.box[1] + s.box[3]) / 2
    under = [g for g in list(sh.get("ground", [])) + list(cards) + list(sh.get("boxes", [])) + list(sh.get("tabs", []))
             if isinstance(g, Shape) and g is not s and g.fill and g.seq < s.seq
             and g.box[0] <= cx <= g.box[2] and g.box[1] <= cy <= g.box[3]]
    return max(under, key=lambda g: g.seq).fill if under else "#ffffff"


def paints_its_ground(s: Shape, sh: dict, cards: list, claims: list = ()) -> bool:
    """A fill of the colour already under it (a white mask on white paper or
    on a white card) that hides no decoration painted before it: it paints
    nothing, and as decoration it is debris. Art a picture's cut takes
    (`claims`, the pictures' boxes) is the cut's: a mask over it goes too.
    A mask over loose art stays (dropped, what it hides would show)."""
    if not s.fill or s.stroke or td.delta_e(s.fill, ground_under(s, sh, cards)) > 2.0:
        return False
    return not any(o is not s and o.kind in ("art", "hidden", "line") and o.seq < s.seq and inter(o.box, s.box) > 0
                   and not any(mostly_in(o.box, c) for c in claims)
                   for o in sh.get("shapes", []))


def fill_element(f: Frame) -> dict:
    """The fill of a box with art over it, as decoration laid on the box's
    frame (it follows the frame), painted before that art."""
    st: dict[str, Any] = {"backgroundColor": colour(f.shape.fill)}
    r = radius_value(f.shape.corner_radii())
    if r:
        st["borderRadius"] = r
    to = f"#{f.name}"
    return {"kind": "box", "id": f"{f.name}-fill", "style": st,
            "placement": {"anchor": {"to": to, "edge": "top-left"},
                          "size": {"width": {"to": to, "edge": "right"}, "height": {"to": to, "edge": "bottom"}}}}


def la_frames(frames: list[Frame], shows: Any = None) -> list:
    """The frames as line_art sees them: pictures (ends can point into them),
    boxes and tabs that paint a ground (they cover what runs under them), the
    rest."""
    out = []
    for f in frames:
        if f.kind in ("picture", "figure"):
            kind = f.kind
        elif f.kind in ("box", "tab") and f.shape is not None and f.shape.fill \
                and getattr(f.shape, "card_tab", None) is None and not art_over(f):
            kind = "opaque"
        else:
            kind = "text"
        out.append(la.Frame(f.name, tuple(f.box), kind, shows if kind in ("picture", "figure") else None))
    return out


def read_line_art(sh: dict, frames: list[Frame], shows: Any = None) -> dict:
    """The page's thin straight lines read against its frames: the
    connectors they draw and the segments no rule explains."""
    lfs = la_frames(frames, shows)
    segs = la.merge_collinear([g for s in sh.get("lines", []) for g in s.segs])
    conns, left = [], []
    pics = [f for f in lfs if f.kind in ("picture", "figure")]

    def picture_art(net: list) -> bool:
        """Lines inside a picture that touch only the picture and frames set
        on it (a map's scale bar, its key's samples) are the picture's art."""
        for pf in pics:
            if not all(la.inside(g.point(g.lo), pf.box, 0.3) and la.inside(g.point(g.hi), pf.box, 0.3) for g in net):
                continue
            ok = True
            for g in net:
                for p, d in ((g.point(g.lo), la._dir(g.axis, -1)), (g.point(g.hi), la._dir(g.axis, 1))):
                    f = la.attach(p, d, lfs)
                    if f is not None and f is not pf and not inside_mm(f.box, pf.box, 0.5):
                        ok = False
            if ok:
                return True
        return False

    for net in la.nets(segs):
        if picture_art(net):
            continue
        c, rest = la.read_net(net, lfs)
        conns += c
        left += rest
    # a slanted leader from a frame into a picture: a straight connector to a point of it; any
    # other is a loose shape (a path)
    for s in sh.get("leaders", []):
        c = la.read_leader(s.leader[0], s.leader[1], (s.stroke, round(s.width, 2), tuple(s.dash)), lfs, {s.seq})
        if c is None:
            s.kind = "art"
        else:
            conns.append(c)
    # what an opaque frame or a picture covers whole is not drawn (the picture's cut keeps its own)
    covered = [g for g in left if any(f.kind in la.OPAQUE and la.inside(g.point(g.lo), f.box, 0.3)
                                      and la.inside(g.point(g.hi), f.box, 0.3) for f in lfs)]
    # what a box's fill hid in the source stays hidden when the fill goes to the decoration
    covered += [g for g in left if g not in covered and drawn_before_fill(g, frames)]
    left = [g for g in left if g not in covered]
    used = set()
    for c in conns:
        used |= c.ids
    for g in left:
        used |= g.ids
    # a dot drawn at a line's end is the connector's cap (and leaves the picture's cut with the line)
    caps: dict[int, dict] = {}
    cap_shapes: dict[int, Any] = {}
    dots = [s for s in sh.get("shapes", []) if s.kind == "art" and s.fill and not s.stroke and s.w <= 3.0
            and s.h <= 3.0 and abs(s.w - s.h) < 0.4 and any(it[0] == "c" for it in s.items)]
    for c in conns:
        for k, e in [("startCap", c.start)] + [("endCap", e) for e in c.ends]:
            if e.xy is None:
                continue
            hit = next((dt for dt in dots if math.hypot((dt.box[0] + dt.box[2]) / 2 - e.xy[0],
                                                        (dt.box[1] + dt.box[3]) / 2 - e.xy[1]) < 0.8), None)
            if hit is None:
                continue
            caps.setdefault(id(c), {})[k] = "dot"
            caps[id(c)]["capSize"] = mmv((hit.w + hit.h) / 2)
            cap_shapes[id(hit)] = hit
    return {"connectors": conns, "left": left, "used": used, "frames": lfs, "caps": caps, "cap_shapes": cap_shapes}


def lines_over(art: dict, sh: dict, box: tuple, origin: tuple) -> list:
    """Rectangles (pt) that cover each line drawn as decoration crossing a
    picture's box, to take it out of the picture's cut."""
    out = []
    for s in sh.get("lines", []):
        if s.seq not in art["used"]:
            continue
        if s.box[0] > box[2] or s.box[2] < box[0] or s.box[1] > box[3] or s.box[3] < box[1]:
            continue
        w = max(s.width, 0.5)
        r = fitz.Rect(s.rect_pt)
        out.append(fitz.Rect(r.x0 - w, r.y0 - w, r.x1 + w, r.y1 + w))
    for s in art.get("cap_shapes", {}).values():
        r = fitz.Rect(s.rect_pt)
        out.append(fitz.Rect(r.x0 - 0.5, r.y0 - 0.5, r.x1 + 0.5, r.y1 + 0.5))
    # a slanted leader's box would cover the picture's art under it: it is taken out by a speck
    # on the stroke that no other path's box holds (removed where touched)
    others = [fitz.Rect(o.rect_pt) for o in sh.get("shapes", []) if o.kind not in ("leader", "unseen")]
    for s in sh.get("leaders", []):
        if s.kind != "leader" or s.seq not in art["used"] or inter(s.box, box) <= 0:
            continue
        (x0, y0), (x1, y1) = s.leader
        for t in (0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95):
            q = fitz.Point((x0 + (x1 - x0) * t) * MM + origin[0], (y0 + (y1 - y0) * t) * MM + origin[1])
            speck = fitz.Rect(q.x - 0.2, q.y - 0.2, q.x + 0.2, q.y + 0.2)
            if not any(o.intersects(speck) for o in others):
                out.append(("touched", speck))
                break
    return out


def radius_value(radii: list[float]) -> dict | None:
    """A CornerRadius: one length, or one per corner (C8)."""
    if not any(r > 0.05 for r in radii):
        return None
    if max(radii) - min(radii) < 0.1:
        return mmv(radii[0])
    return {k: mmv(r) for k, r in zip(("topLeft", "topRight", "bottomRight", "bottomLeft"), radii)}


def abs_placement(box: tuple) -> dict:
    return {"anchor": {"to": "page", "edge": "top-left"}, "offset": {"x": mmv(box[0]), "y": mmv(box[1])},
            "size": {"width": mmv(max(box[2] - box[0], 0.01)), "height": mmv(max(box[3] - box[1], 0.01))}}


def box_element(eid: str, s: Shape, placement: dict) -> dict:
    st: dict[str, Any] = {}
    if s.fill:
        st["backgroundColor"] = colour(s.fill)
    if s.stroke:
        st["borderColor"] = colour(s.stroke)
        st["borderWidth"] = ptv(s.width or 0.5)
    r = radius_value(s.corner_radii())
    if r:
        st["borderRadius"] = r
    return {"kind": "box", "id": eid, "placement": placement, "style": st}


def path_element(eid: str, box: tuple, d: str, fill: str | None, stroke: str | None, width: float,
                 dash: list[float]) -> dict:
    """A C9 path element: `d` in mm from the box's corner, the box laid on
    the page."""
    w, h = max(box[2] - box[0], 0.01), max(box[3] - box[1], 0.01)
    el: dict[str, Any] = {"kind": "path", "id": eid, "placement": abs_placement(box), "d": d,
                          "viewBox": [round(w, 2), round(h, 2)]}
    if fill:
        el["fill"] = colour(fill)
    if stroke:
        el["stroke"] = colour(stroke)
        el["width"] = ptv(width)
        if dash:
            el["dash"] = [mmv(v) for v in dash]
    return el


def shape_path(eid: str, s: Shape) -> dict | None:
    """A PDF path as a path element, or None when it cannot be one (a
    translucent or even-odd shape with holes stays in the ground)."""
    raw = s.raw
    if (raw.get("fill_opacity") or 1) < 0.98 or (raw.get("stroke_opacity") or 1) < 0.98:
        return None
    if s.clipped:
        # a path element has no clip: a rectangle cut by a rectangle is the part that shows, any
        # other clipped shape stays in the raster ground
        if not (s.clip_exact and s.rect_like() and all(it[0] in ("re", "l") for it in s.items)):
            return None
        return path_element(eid, s.box, la.items_path([("re", 0.0, 0.0, s.w, s.h)], (0.0, 0.0), close=True),
                            s.fill, s.stroke, s.width, s.dash)
    items = s.mm_items()
    if not items or len(items) > 400:
        return None
    pad = (s.width * PT_MM / 2 + 0.1) if s.stroke else 0.0
    box = (s.box[0] - pad, s.box[1] - pad, s.box[2] + pad, s.box[3] + pad)
    d = la.items_path(items, (box[0], box[1]), close=bool(raw.get("closePath")) or bool(s.fill))
    if s.fill and raw.get("even_odd") and d.count("M") > 1:
        return None
    if not s.fill and not s.stroke:
        return None
    return path_element(eid, box, d, s.fill, s.stroke, s.width, s.dash)


def end_config(e: Any, by_name: dict, always_at: bool = False) -> dict:
    """A connector end; an end at a point inside a picture adds an anchor
    to that picture (`pointer-N`)."""
    if e.point is None:
        return e.config(always_at)
    f = by_name[e.frame]
    lst = f.__dict__.setdefault("pointer_points", [])
    lst.append(e.point)
    return {"to": f"#{e.frame}", "anchor": f"pointer-{len(lst)}", "side": e.side}


def connector_element(n: int, c: Any, by_name: dict, laid: dict | None = None) -> dict:
    """A connector element. With `laid` (frame name -> the box the template
    lays it in, `laid_boxes`), each end's `at` and `gap` are worked out on
    that box, not on the one the line was read against; straight and elbow
    lines always say their `at`."""
    col, width, dash = c.key
    line = c.routing in ("straight", "elbow")

    def fit(e: Any) -> Any:
        box = (laid or {}).get(e.frame)
        return la.refit(e, box, gap=line) if box is not None else e

    el: dict[str, Any] = {"kind": "connector", "id": f"connector-{n}", "routing": c.routing,
                          "from": end_config(fit(c.start), by_name, line)}
    ends = [end_config(fit(e), by_name, line) for e in c.ends]
    el["to"] = ends[0] if len(ends) == 1 else ends
    if c.trunk is not None:
        el["trunk"] = c.trunk
    el["color"] = colour(col)
    el["width"] = ptv(width)
    if dash:
        el["dash"] = [mmv(v) for v in dash]
    if c.over and not any(isinstance(e, dict) and e.get("anchor") for e in [el["from"]] + ends):
        el["over"] = True        # drawn over a picture it crosses (one that ends in it is over by default)
    return el


def laid_boxes(frames: list, template: dict | None) -> dict:
    """Frame name -> the box (mm) the template lays it in: a picture's box
    as cut (`cut_picture`, `trim_to_ink`), a text frame as wide as the
    measure `make_template` gave it (a centred one about its middle, a
    caption from its offset under its picture)."""
    cfg = {c["name"]: c for c in (template or {}).get("frames", [])}
    out = {}
    for f in frames:
        x0, y0, x1, y1 = f.box
        c = cfg.get(f.name) or {}
        w = (c.get("width") or {}).get("value")
        if w is not None and f.kind in ("text", "title") and not f.rotate:
            cap = getattr(f, "caption_of", None)
            off = ((c.get("placement") or {}).get("offset") or {}).get("x", {}).get("value")
            if cap is not None and off is not None:
                x0 = cap.box[0] + off
            elif getattr(f, "centred", False) and f.kind == "text":
                x0 = x0 - (w - (x1 - x0)) / 2
            x1 = x0 + w
        out[f.name] = (x0, y0, x1, y1)
    return out


def border_elements(n: int, b: dict) -> list[dict]:
    """A border with no words round frames: a decoration box from the first
    frame's corner to a point off the last one's foot (a box of no size, so
    the border grows with the frames it holds)."""
    s: Shape = b["shape"]
    box = b["box"]
    eid = f"border-{n}"
    held = [g for g in b["held"] if g.name]
    if not held:
        return [box_element(eid, s, abs_placement(box))]
    first = min(held, key=lambda g: (round(g.box[1], 1), g.box[0]))
    foot = max(held, key=lambda g: (g.box[3], g.box[2]))
    corner = {"kind": "box", "id": f"{eid}-end", "style": {},
              "placement": {"anchor": {"to": f"#{foot.name}", "edge": "bottom-left"},
                            "offset": {"x": mmv(box[2] - foot.box[0]), "y": mmv(box[3] - foot.box[3])},
                            "size": {"width": mmv(0), "height": mmv(0)}}}
    main = box_element(eid, s, {"anchor": {"to": f"#{first.name}", "edge": "top-left"},
                                "offset": {"x": mmv(box[0] - first.box[0]), "y": mmv(box[1] - first.box[1])},
                                "size": {"width": {"to": f"#{eid}-end", "edge": "left"},
                                         "height": {"to": f"#{eid}-end", "edge": "top"}}})
    return [corner, main]


def redraw(page: fitz.Page, drawings: list[dict]) -> None:
    """Paint PDF paths (get_drawings) on `page` as they were (one shape,
    committed once: each commit reads the page's whole content again)."""
    shape = page.new_shape()
    for d in drawings:
        if not d.get("items"):
            continue
        for it in d["items"]:
            if it[0] == "l":
                shape.draw_line(it[1], it[2])
            elif it[0] == "re":
                shape.draw_rect(it[1])
            elif it[0] == "qu":
                shape.draw_quad(it[1])
            elif it[0] == "c":
                shape.draw_bezier(it[1], it[2], it[3], it[4])
        cap = d.get("lineCap") or (0,)
        shape.finish(fill=d.get("fill"), color=d.get("color"), width=d.get("width") or 0,
                     dashes=d.get("dashes") or None, even_odd=bool(d.get("even_odd")),
                     closePath=bool(d.get("closePath")), lineJoin=int(d.get("lineJoin") or 0),
                     lineCap=int(max(cap) if isinstance(cap, (tuple, list)) else cap),
                     fill_opacity=d.get("fill_opacity") if d.get("fill_opacity") is not None else 1,
                     stroke_opacity=d.get("stroke_opacity") if d.get("stroke_opacity") is not None else 1)
    shape.commit()


def residual_ground(pdf_path: str, pno: int, origin: tuple, painted: list[dict], masks: list[tuple],
                    opts: argparse.Namespace, rid: str, drop_images: list[int] | None = None) -> dict | None:
    """What of the page no decoration element and no frame paints: the page
    without its text, against the paths the decoration and the frames draw.
    None when nothing is left (the page needs no ground); else a PNG that is
    transparent wherever the decoration paints."""
    import numpy as np
    from PIL import Image

    src = fitz.open(str(pdf_path))
    page = src[pno]
    page.add_redact_annot(page.rect, fill=False)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                          text=fitz.PDF_REDACT_TEXT_REMOVE)
    for xref in drop_images or []:      # a picture cut from its image: its frame shows it, not the ground
        try:
            page.delete_image(xref)
        except Exception:
            pass
    clip = to_pt((0, 0, origin[2], origin[3]), origin)
    full = page.get_pixmap(dpi=opts.ground_dpi, clip=clip, alpha=False)
    blank = fitz.open()
    bp = blank.new_page(width=page.rect.width, height=page.rect.height)
    if page.rect.x0 or page.rect.y0:
        bp.set_mediabox(page.rect)
    redraw(bp, painted)
    want = bp.get_pixmap(dpi=opts.ground_dpi, clip=clip, alpha=False)
    a = np.frombuffer(full.samples, dtype=np.uint8).reshape(full.height, full.width, full.n)[:, :, :3].astype(int)
    b = np.frombuffer(want.samples, dtype=np.uint8).reshape(want.height, want.width, want.n)[:, :, :3].astype(int)
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    a, b = a[:h, :w], b[:h, :w]
    diff = np.abs(a - b).sum(axis=2) > 60
    px = opts.ground_dpi / 25.4
    for m in masks:
        x0, y0 = max(int(m[0] * px), 0), max(int(m[1] * px), 0)
        x1, y1 = min(int(math.ceil(m[2] * px)), w), min(int(math.ceil(m[3] * px)), h)
        if x1 > x0 and y1 > y0:
            diff[y0:y1, x0:x1] = False
    # specks of anti-aliasing are no art: an opening by one pixel
    core = diff.copy()
    core[1:, :] &= diff[:-1, :]
    core[:-1, :] &= diff[1:, :]
    core[:, 1:] &= diff[:, :-1]
    core[:, :-1] &= diff[:, 1:]
    if int(core.sum()) < opts.ground_min_px:
        return None
    keep = core.copy()
    for _ in range(3):
        grown = keep.copy()
        grown[1:, :] |= keep[:-1, :]
        grown[:-1, :] |= keep[1:, :]
        grown[:, 1:] |= keep[:, :-1]
        grown[:, :-1] |= keep[:, 1:]
        keep = grown & (diff | grown)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, :3] = a.astype(np.uint8)
    rgba[:, :, 3] = np.where(keep, 255, 0).astype(np.uint8)
    out_dir = Path(opts.out) / "resources"
    out_dir.mkdir(parents=True, exist_ok=True)
    file = out_dir / f"{rid}.png"
    Image.fromarray(rgba, "RGBA").save(file, optimize=True)
    return {"file": f"resources/{file.name}", "width": w, "height": h, "pixels": int(core.sum())}


def drawn_raw(s: Shape) -> dict:
    """The path as the decoration paints it, for `residual_ground` to redraw:
    a clipped line by the pieces that show, a clipped rectangle by its part
    that shows; any other path as the PDF has it."""
    if not s.clipped:
        return s.raw
    ox, oy = s.origin[0], s.origin[1]

    def pt(p: tuple) -> fitz.Point:
        return fitz.Point(p[0] * MM + ox, p[1] * MM + oy)

    pieces = s.mm_lines() if s.kind in ("line", "leader", "hatch") else None
    if pieces is not None:
        return dict(s.raw, items=[("l", pt(a), pt(b)) for a, b in pieces])
    if s.clip_exact and s.rect_like():
        return dict(s.raw, items=[("re", fitz.Rect(pt(s.box[:2]), pt(s.box[2:])), 1)])
    return s.raw


def vector_decoration(pdf_path: str, pno: int, origin: tuple, sh: dict, frames: list[Frame], cards: list[Shape],
                      borders: list[dict], art: dict, opts: argparse.Namespace, ground_id: str,
                      report: dict, template: dict | None = None) -> tuple[list[dict], dict | None]:
    """The template's decoration in vector form, in paint order: the page's
    colour (to the bleed), the cards (a card with a tab grown out of it is
    one outline), borders round frames, the shapes left on the page, the
    lines no connector draws, the connectors; a raster ground only for
    what none of these paints (photos, gradients), with the paint that
    these draw transparent. Returns the elements and the ground file."""
    W, H = origin[2], origin[3]
    els: list[dict] = []
    stats = {"connectors": 0, "pointers": 0, "trees": 0, "elbows": 0, "straight": 0, "paths": 0, "lines": 0,
             "borders": 0, "cards": 0, "ground": False}
    pics = [f for f in frames if f.kind in ("picture", "figure")]
    covering = [f for f in frames if f.kind in ("box", "tab") and f.shape is not None and f.shape.fill
                and getattr(f.shape, "card_tab", None) is None and not art_over(f)]
    raster_left: list[Shape] = []
    # pictures cut from their image alone: what the page paints over them is not in their cut
    pics_cut = [f for f in pics if not getattr(f, "from_image", None)]
    loose = [s for s in sh["shapes"] if s.kind in ("art", "hidden")]
    # the page's colour; a fill over most of the page painted after a loose shape it covers keeps
    # its place in the paint order (with the shapes), a translucent one stays in the raster ground
    n_fill = 0
    late: list[tuple[int, Any]] = []
    for g in sh["ground"]:
        if not isinstance(g, Shape):
            continue
        n_fill += 1
        eid = "page-colour" if n_fill == 1 else f"page-colour-{n_fill}"
        b = g.box
        if (g.raw.get("fill_opacity") if g.raw.get("fill_opacity") is not None else 1) < 0.98:
            raster_left.append(g)
            continue
        if g.rect_like() and b[0] <= 0.5 and b[1] <= 0.5 and b[2] >= W - 0.5 and b[3] >= H - 0.5:
            el = {"kind": "box", "id": eid, "style": {"backgroundColor": colour(g.fill)},
                  "placement": {"anchor": {"to": "bleed", "edge": "top-left"},
                                "size": {"width": "fill", "height": "fill"}}}
        elif g.rect_like():
            el = box_element(eid, g, abs_placement(b))
        else:
            el = shape_path(eid, g)
            if el is None:
                raster_left.append(g)
                continue
        if any(o.seq < g.seq and inter(o.box, g.box) > 0 for o in loose):
            late.append((g.seq, el))
        else:
            els.append(el)
    big_image = any(isinstance(g, dict) and "image" in g for g in sh["ground"])
    ground_at = len(els)
    # the cards, a tab grown out of one with it
    tabs_of = {}
    for t in sh["tabs"]:
        k = getattr(t, "card_tab", None)
        if k is not None:
            tabs_of.setdefault(k, []).append(t)
    for k, c in enumerate(cards):
        eid = "card" if k == 0 else f"card-{k + 1}"
        stats["cards"] += 1
        tl = tabs_of.get(k, [])
        d = None
        if len(tl) == 1:
            t = tl[0]
            radii = c.corner_radii()
            d = la.card_tab_path(c.box, max(radii), t.box, t.radius())
        if d is not None:
            t = tl[0]
            box = (min(c.box[0], t.box[0]), t.box[1], max(c.box[2], t.box[2]), c.box[3])
            els.append(path_element(eid, box, d, c.fill, None, 0, []))
        else:
            els.append(box_element(eid, c, abs_placement(c.box)))
            for j, t in enumerate(tl):     # more than one: each tab its own box over the card
                els.append(box_element(f"{eid}-tab-{j + 1}", t, abs_placement(t.box)))
    if not big_image:
        ground_at = len(els)
    # borders with no words, round the frames they hold
    for n, b in enumerate(borders, 1):
        els += border_elements(n, b)
        stats["borders"] += 1
        if b.get("tab") is not None:
            els.append(box_element(f"border-{n}-tab", b["tab"], abs_placement(b["tab"].box)))
    # the fills of boxes with art over them, under that art (the frame keeps the rest of its look)
    for f in frames:
        if art_over(f):
            els.append(fill_element(f))
            stats["fills"] = stats.get("fills", 0) + 1
    # shapes left on the page (icons, chevrons, ornaments): paths, unless there are too many
    residual = [s for s in loose
                if not any(mostly_in(s.box, claim_of(f)) for f in pics_cut)
                and not any(inside_mm(s.box, f.box, 0.3) for f in covering)
                and not drawn_before_fill(s, frames) and not getattr(s, "debris", False)
                and not paints_its_ground(s, sh, cards, [claim_of(f) for f in pics])]
    caps = art["caps"]
    residual = [s for s in residual if id(s) not in art["cap_shapes"]]
    hatches = sh.get("hatches", [])
    # the raster fallback: loose art the vectors would draw badly goes to the raster ground
    conn_ids = set().union(*(c.ids for c in art["connectors"])) if art["connectors"] else set()
    conn_segs = sum(len(c.ends) + (1 if c.routing == "tree" else 0) for c in art["connectors"])
    stray = [g for g in art["left"] if not (g.ids & conn_ids)]
    reasons = []
    if not getattr(opts, "vector_ground", False):
        if len(residual) + len(hatches) > opts.max_paths:
            reasons.append(f"{len(residual) + len(hatches)} loose shapes (over --max-paths {opts.max_paths})")
        if any(s.clipped and not (s.clip_exact and s.rect_like()) for s in residual):
            reasons.append("clipped art outside the pictures")
        bits = [g for g in stray if g.length < 5.0]      # fragments, not a page's rules
        if len(bits) >= 6 and len(bits) > conn_segs:
            reasons.append(f"{len(bits)} stray line pieces under 5 mm, {conn_segs} connector pieces")
        if big_image:
            reasons.append("a full-page image")
    if reasons:
        raster_left += residual + [s for grp in hatches for s in grp]
        residual, hatches = [], []
        stray_seqs = {i for g in stray for i in g.ids}
        raster_left += [s for s in sh.get("lines", []) if s.seq in stray_seqs and s.seq not in conn_ids]
        art = dict(art, left=[g for g in art["left"] if g.ids & conn_ids])
        stats["rasterFallback"] = reasons
        report["notes"].append("the loose art of this page is in its raster ground: " + "; ".join(reasons)
                               + " (--vector-ground keeps it as vectors)")
    pn = 0
    run: list[Shape] = []

    def flush() -> None:
        nonlocal pn
        if not run:
            return
        if len(run) == 1:
            pn += 1
            el = shape_path(f"shape-{pn}", run[0])
            if el is None:
                raster_left.append(run[0])
                pn -= 1
            else:
                els.append(el)
        else:
            parts = [shape_path("x", s) for s in run]
            if any(p is None for p in parts):
                for s, p in zip(run, parts):
                    if p is None:
                        raster_left.append(s)
                    else:
                        pn += 1
                        p["id"] = f"shape-{pn}"
                        els.append(p)
            else:
                pn += 1
                box = union([s.box for s in run])
                pad = max((s.width * PT_MM / 2 + 0.1) if s.stroke else 0.0 for s in run)
                box = (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)
                d = " ".join(la.items_path(s.mm_items(), (box[0], box[1]),
                                           close=bool(s.raw.get("closePath")) or bool(s.fill)) for s in run)
                s0 = run[0]
                els.append(path_element(f"shape-{pn}", box, d, s0.fill, s0.stroke, s0.width, s0.dash))
        run.clear()

    # one path per run of shapes of one look that do not overlap: shapes that cross (the bars of
    # an X wound opposite ways) as one non-zero path open holes where they meet
    seq_items: list[tuple[int, str, Any]] = [(s.seq, "shape", s) for s in residual]
    seq_items += [(grp[0].seq, "hatch", grp) for grp in hatches]
    seq_items += [(q, "ground", el) for q, el in late]
    hn = 0
    for _, what, it in sorted(seq_items, key=lambda x: (x[0], x[1])):
        if what != "shape":
            flush()
            if what == "hatch":
                hn += 1
                els.append(hatch_element(f"hatch-{hn}", it))
            else:
                els.append(it)
            continue
        s = it
        if run and ((s.fill, s.stroke, round(s.width, 2), tuple(s.dash)) !=
                    (run[0].fill, run[0].stroke, round(run[0].width, 2), tuple(run[0].dash))
                    or any(inter(s.box, o.box) > 0 for o in run)):
            flush()
        run.append(s)
    flush()
    stats["paths"] = pn
    if hn:
        stats["hatches"] = hn
    # lines that join no two frames: paths, one per look
    by_key: dict[tuple, list] = {}
    for g in art["left"]:
        by_key.setdefault(g.key, []).append(g)
    for k, (key, segs) in enumerate(sorted(by_key.items(), key=lambda kv: str(kv[0])), 1):
        col, width, dash = key
        pad = max(0.3, width * PT_MM / 2 + 0.1)
        bx = union([g.box() for g in segs])
        bx = (bx[0] - pad, bx[1] - pad, bx[2] + pad, bx[3] + pad)
        els.append(path_element(f"lines-{k}", bx, la.segs_path(segs, (bx[0], bx[1])), None, col, width, list(dash)))
        stats["lines"] += len(segs)
    # connectors
    by_name = {f.name: f for f in frames}
    laid = laid_boxes(frames, template)
    for n, c in enumerate(art["connectors"], 1):
        el = connector_element(n, c, by_name, laid)
        el.update(caps.get(id(c), {}))
        els.append(el)
        stats["connectors"] += 1
        stats[{"tree": "trees", "elbow": "elbows", "straight": "straight"}[c.routing]] += 1
        if any(e.point is not None for e in [c.start] + c.ends):
            stats["pointers"] += 1
    for f in pics:
        pts = getattr(f, "pointer_points", None)
        if pts:
            bw, bh = max(f.box[2] - f.box[0], 1e-6), max(f.box[3] - f.box[1], 1e-6)
            f.pointer_anchors = [{"id": f"pointer-{i}", "x": round((p[0] - f.box[0]) / bw, 4),
                                  "y": round((p[1] - f.box[1]) / bh, 4)} for i, p in enumerate(pts, 1)]
    # the raster ground: what nothing above paints
    left_ids = {id(s) for s in raster_left}
    masks = [(b[0] - 0.6, b[1] - 0.6, b[2] + 0.6, b[3] + 0.6) for b in (claim_of(f) for f in pics_cut)]
    masks += [f.box for f in covering]
    # what lies under a mask is not compared: a map's thousands of paths are not redrawn, nor a
    # picture's art that the source clips at the card's edge (redrawn unclipped, it would paint
    # past the card and make a ground of nothing)
    painted = [drawn_raw(s) for s in sh["shapes"] if id(s) not in left_ids and s.kind != "unseen"
               and not any(inside_mm(s.box, m, 0.0) for m in masks)
               and not (s.kind == "art" and any(inter(s.box, m) >= 0.5 * max(area(s.box), 1e-6) for m in masks))]
    g = residual_ground(pdf_path, pno, origin, painted, masks, opts, ground_id,
                        drop_images=[f.from_image for f in pics if getattr(f, "from_image", None)])
    if g is not None:
        stats["ground"] = True
        stats["groundPixels"] = g["pixels"]
        els.insert(ground_at, {"kind": "image", "id": "ground", "resourceId": "{attr.ground}", "decorative": True,
                               "placement": {"anchor": {"to": "page", "edge": "top-left"},
                                             "size": {"width": mmv(W), "height": mmv(H)}}})
    report["decoration"] = stats
    return els, g


# ---------------------------------------------------------------------------
# template geometry
# ---------------------------------------------------------------------------


def placement_abs(box: tuple) -> dict:
    return {"anchor": {"to": "container", "edge": "top-left"}, "offset": {"x": mmv(box[0]), "y": mmv(box[1])}}


def placement_rel(target: str, edge: str, dx: float, dy: float) -> dict:
    return {"anchor": {"to": f"#{target}", "edge": edge}, "offset": {"x": mmv(dx), "y": mmv(dy)}}


def f_style(f: Frame) -> dict | None:
    return getattr(f, "style", None)


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
            elif getattr(f, "table", None) is not None:
                c["exclude"] = "push"       # a table set in a box's text keeps that text off it
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
        if getattr(f, "grow_with", False):
            c["growWith"] = "children"   # a longer caption makes the box taller (#1117)
        elif f.kind == "text" and f.lines:
            c["minHeight"] = mmv(max(0.0, h - 0.5))
        if f.kind == "tab":
            c["verticalAlign"] = "middle"
        if getattr(f, "centred", False) and f.kind == "text":
            # centred lines keep their centre: widen the frame round it
            off = c["placement"]["offset"]["x"]["value"] - (width - (f.box[2] - f.box[0])) / 2
            c["placement"]["offset"]["x"] = mmv(off)
        cap = getattr(f, "caption_of", None)
        if cap is not None:
            # a caption hangs under its picture (it follows the picture when the box grows)
            width, x = caption_measure(f, frames)
            c["width"] = mmv(width)
            c["placement"] = placement_rel(cap.name, "below", x - cap.box[0], f.box[1] - cap.box[3])
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
    # what the source paints over a picture lies over it (`plates_over_pictures`)
    for _ in range(2):
        for f in frames:
            for p in getattr(f, "over", None) or []:
                lp = configs[p.name].get("layer", 1)
                if configs[f.name].get("layer", 1) <= lp:
                    configs[f.name]["layer"] = lp + 1
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
        # the frame of a box with a tab is as tall as the box plus the tab's rise: the room the pictures
        # take is what is left under that, a hair less (a box that needs more than its drawn height grows)
        rise = ((f_style(p) or {}).get("label") or {}).get("offset", {}).get("value", 0.0)
        pad["bottom"] = mmv(round(max(0.0, room - rise - 1.0), 2))
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


def caption_measure(f: Frame, frames: list[Frame]) -> tuple[float, float]:
    """(width, left) of a caption split out of a box (`split_captions`): the
    measure of its longest line with the slack of a free text (3 %, 1 mm), no
    further than halfway to the next caption of the row (or the box's edge);
    a centred caption keeps its middle, one set left its start."""
    p = f.parent
    lo = (p.shape.box[0] if p is not None and p.shape is not None else f.box[0] - 4.0) + 1.0
    hi = (p.shape.box[2] if p is not None and p.shape is not None else f.box[2] + 4.0) - 1.0
    for g in frames:
        if g is f or getattr(g, "caption_of", None) is None or g.parent is not p:
            continue
        if g.box[1] >= f.box[3] or f.box[1] >= g.box[3]:
            continue
        if g.box[2] <= f.box[0]:
            lo = max(lo, (g.box[2] + f.box[0]) / 2)
        elif g.box[0] >= f.box[2]:
            hi = min(hi, (f.box[2] + g.box[0]) / 2)
    longest = f.box[2] - f.box[0]
    if getattr(f, "centred", False):
        mid = (f.box[0] + f.box[2]) / 2
        half = max(longest / 2, min(longest * 0.515 + 0.5, mid - lo, hi - mid))
        return round(2 * half, 2), round(mid - half, 2)
    return round(max(longest, min(longest * 1.03 + 1.0, hi - f.box[0])), 2), round(f.box[0], 2)


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


def furniture_decoration(lines: list[Line], pno: int, origin: tuple, ctx: dict, report: dict,
                         heads: dict | None = None) -> tuple[list, dict]:
    """Running heads and folios as decoration elements of the template (a
    placeholder each) and the page attributes they print. `heads` gets each
    running head's id with its first line and the element's top (mm)."""
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
            text = " ".join(spaced_text(l) for l in words)
            key = band
            attrs[key] = text
            els.append(text_element(f"{key}-{parity}", "{attr.%s}" % key, words[0], W, parity))
            if heads is not None:
                heads[els[-1]["id"]] = (words[0], els[-1]["placement"]["offset"]["y"]["value"])
    return els, attrs


def anchor_ornaments(els: list[dict], heads: dict, reach: float = 8.0) -> int:
    """Ornaments beside a running head (chevrons before it, a mark after it)
    drawn at fixed points of the page stood where the source's head ended;
    another edition's longer head ran over them. Path elements on the head's
    line, one after another within `reach` mm of its words, are anchored to
    the head (`left-of` before it, `right-of` after it) and the head is as
    wide as its words (no `size`), so they keep their distance from its
    first or last letter. They are moved after their head in the list (they
    read its box). Returns how many were anchored."""
    n = 0
    for eid, (l, top) in heads.items():
        head = next((e for e in els if e.get("id") == eid), None)
        if head is None:
            continue
        cands = []
        for e in els:
            p = e.get("placement") or {}
            if e.get("kind") != "path" or (p.get("anchor") or {}).get("to") != "page" \
                    or (p.get("anchor") or {}).get("edge") != "top-left" or "size" not in p:
                continue
            x, y = p["offset"]["x"]["value"], p["offset"]["y"]["value"]
            b = (x, y, x + p["size"]["width"]["value"], y + p["size"]["height"]["value"])
            cy = (b[1] + b[3]) / 2
            if l.y0 - 1.0 <= cy <= l.y1 + 1.0 and b[3] - b[1] <= 2.5 * max(l.y1 - l.y0, 1.0):
                cands.append((e, b))
        chain = []
        edge = l.x0
        for e, b in sorted([c for c in cands if c[1][2] <= l.x0 + 0.5], key=lambda c: -c[1][2]):
            if edge - b[2] > reach:
                break
            chain.append((e, b, "left-of"))
            edge = min(edge, b[0])
        edge = l.x1
        for e, b in sorted([c for c in cands if c[1][0] >= l.x1 - 0.5], key=lambda c: c[1][0]):
            if b[0] - edge > reach:
                break
            chain.append((e, b, "right-of"))
            edge = max(edge, b[2])
        if not chain:
            continue
        for k, (e, b, side) in enumerate(chain, 1):
            # named after the head, so the same ornament has one id on every page
            e["id"] = f"{eid}-ornament-{k}"
            dx = b[2] - l.x0 if side == "left-of" else b[0] - l.x1
            e["placement"] = {"anchor": {"to": f"#{eid}", "edge": side},
                              "offset": {"x": mmv(round(dx, 2)), "y": mmv(round(b[1] - top, 2))},
                              "size": e["placement"]["size"]}
            if head.get("parity"):
                e["parity"] = head["parity"]
            m = re.fullmatch(r"\{attr\.([A-Za-z][\w-]*)\}", str(head.get("content", "")))
            if m:
                # drawn with its head: on a page whose fence sets no such attribute the
                # head prints nothing, and the ornament would stand by an empty box
                e["when"] = m.group(1)
            els.remove(e)
        head["placement"].pop("size", None)
        at = els.index(head) + 1
        els[at:at] = [e for e, _, _ in chain]
        n += len(chain)
    return n


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
            # a nested item indents to the text of the item above (two spaces under `- `)
            item = "  " * level + "- " + text
            if prev == "li" and out:
                out[-1] += "\n" + item
                prev = "li"
                continue
            out.append(item)
        elif kind == "raw":       # a directive written as is (a table's ::resource)
            out.append(text)
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
            text = " ".join(spaced_text(l) for l in f.lines)
            add(pmd.heading(f.level or 1, text, slot=None if getattr(f, "takes", False) else f.name))
            continue
        if f.kind in ("picture", "figure"):
            rid = f.resource["id"]
            block = anc.figure_block(rid, f.name, f.figure_labels) if f.kind == "figure" and f.labels else None
            block = lgd.figure_markdown(block, f, rid, f.name)     # a key on it (#1144)
            add(block if block is not None else f'::resource{{id="{rid}" slot="{f.name}"}}')
            continue
        body = blocks_markdown(f.blocks)
        if getattr(f, "centred", False) and getattr(f, "caption_of", None) is None:
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
            attrs_f["label"] = spaced_text(f.tab.line)
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


def name_frames_by_role(args: argparse.Namespace, doc: fitz.Document, built: list[dict], library: dict,
                        figures: list[dict]) -> list[dict]:
    """Rename every frame of the draft from its position on its page
    (`box-4`) to its role (#998), with `template_dedupe.name_frames`: in the
    templates, the page Markdown, the figure list, the regions and the
    overlays. The callout styles are still the positional `box-1` here, so a
    box says only `box` and its order; dedupe, which merges them, names it
    after its style. Returns the rename report."""
    new_templates, maps, report = td.name_frames(library["pageTemplates"], library.get("calloutStyles") or [])
    library["pageTemplates"] = new_templates
    slots: dict[str, str] = {}
    for page in built:
        names = maps.get(page["template"]["id"], {})
        for f in page["frames"]:
            if f.kind == "figure" and f.resource:
                slots[f.resource["id"]] = names.get(f.name, f.name)
            f.name = names.get(f.name, f.name)
        page["md"] = td.rewrite_markdown(page["md"], {}, {}, {}, {page["template"]["id"]: names})
        for fr in page["regions"]["frames"]:
            fr["name"] = names.get(fr["name"], fr["name"])
            if fr["parent"]:
                fr["parent"] = names.get(fr["parent"], fr["parent"])
        if args.overlay:
            pno = page["regions"]["page"] - 1
            write_overlay(args.source, pno, trim_origin(doc[pno]), page["frames"],
                          Path(args.out) / "overlay" / f"p{pno + 1:02d}.png")
    for fig in figures:
        fig["slot"] = slots.get(fig["resource"], fig["slot"])
    return report


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
        # ruled grids with text are tables: their words, rules and fills are the table's
        tables = grid_tables(page, origin, lines, args)
        if tables:
            lines = [l for l in lines if not any(centre_in(l.box, t["box"]) for t in tables)]
        sh = classify(page, lines, origin, renders, args, claims=[t["box"] for t in tables])
        caches[p] = {"renders": renders, "lines": lines, "hidden": hidden, "shapes": sh, "tables": tables}
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
                           "wrap_slack": args.wrap_slack, "repeated": repeated_looks(caches, pages)}
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
    library["labelStyles"] = lstyles + lgd.label_styles(ctx)
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
                anchors_, labels = anc.anchors_for(f.labels, box, lids, allow_touching=not args.check_overlap)
                f.resource["anchors"] = anchors_ + list(getattr(f, "pointer_anchors", None) or [])
                f.figure_labels = labels
                figures.append({"resource": f.resource["id"], "slot": f.name, "labels": labels})
        # a heading the template takes must be the first of its level
        resources += page["resources"]
        for r in page["resources"]:
            if "_style" in r:     # a table's style: one tableStyles entry per table, named by its resource
                library.setdefault("tableStyles", []).append({**r.pop("_style"), "id": r["table"]["styleId"],
                                                              "name": r["id"]})
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
                gaps = [g for col, gs in ctx.get("chip_gaps", {}).items() if ctx["mark_ids"].get(col) == m["id"]
                        for g in gs]
                gap = chip_gap(gaps)
                if gap:
                    st["gap"] = gap
            ms.append(st)
        library["markStyles" if args.highlights == "mark" else "chipStyles"] = ms
    library["suggested"] = suggested_config(caches, pages, body, head_sizes, level_of, doc)
    ul = unordered_lists(ctx.get("list_levels", {}))
    if ul:
        library["suggested"]["unorderedLists"] = ul
    library = {k: v for k, v in library.items() if v}
    # frame names by role: by request, and for a run of one page, which dedupe has nothing to merge in
    frame_names: list[dict] = []
    if args.name_frames == "always" or (args.name_frames == "auto" and len(built) == 1):
        frame_names = name_frames_by_role(args, doc, built, library, figures)

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
        "syntheticItalic": dict(sorted(fonts.slanted.items())),
        "warnings": font_warnings(fonts),
        "bodySize": body, "headingSizes": head_sizes,
        "frameNames": frame_names,
    }
    (out / "report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    import preset_kit  # noqa: PLC0415
    preset_kit.write_empty_curation(out)  # the hand fixes `manifest` applies (#1136)
    for w in summary["warnings"]:
        print("WARNING: " + w, file=sys.stderr)
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
        if fonts.slanted:
            print("slanted upright faces read as italic: " + "; ".join(f"{k} ({v} spans)" for k, v in sorted(fonts.slanted.items())))
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
             "defaultPlacement": {"position": "here", "span": "column"}},
            {"id": "table", "name": "Table", "namePlural": "Tables", "shortLabel": "", "captionPrefix": "",
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
    if sug.get("unorderedLists"):
        config["unorderedLists"] = sug["unorderedLists"]
    for k in ("calloutStyles", "markStyles", "chipStyles", "labelStyles", "paragraphStyles", "frameLooks",
              "tableStyles", "pageTemplates"):
        if library.get(k):
            config[k] = library[k]
    chapters = {lang: kit.chapters_from_dir(root, lang) for lang in langs}
    manifest = {"id": args.id or root.name, "name": args.name or root.name, "locale": config["locale"],
                "chapters": chapters if len(langs) > 1 else chapters.get(langs[0], []) if langs else [],
                "config": config, "resources": resources, "fonts": fonts}
    if len(langs) > 1:
        manifest["locales"] = langs
    patch = Path(args.patch) if args.patch else root / kit.CURATION_FILE
    if args.patch and not patch.is_file():
        raise SystemExit(f"--patch {args.patch}: no such file")
    applied = kit.apply_curation(manifest, json.loads(patch.read_text(encoding="utf-8"))) if patch.is_file() else []
    path = kit.write_manifest(root, manifest)
    print(f"{path}: {sum(len(v) for v in chapters.values())} chapter file(s), {len(manifest['resources'])} resources, "
          f"{len(config.get('pageTemplates', []))} page templates, {len(fonts)} font families"
          + (f", {len(applied)} curation(s) from {patch.name}" if applied else ""))
    for line in applied:
        print(f"  {line}")
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
    p.add_argument("--name-frames", choices=("auto", "always", "never"), default="auto",
                   help="name the frames by role (`picture-in-box`) instead of by position (`picture-1`): auto does it "
                        "for a run of one page, which template_dedupe.py has nothing to merge in; several pages keep "
                        "the positions that dedupe compares and names them itself")
    p.add_argument("--no-merge-labels", action="store_true", help="one label per line on pictures")
    p.add_argument("--check-overlap", action="store_true",
                   help="leave labelOverlap on for names the source prints touching (default: overlap \"allow\" on their anchors)")
    p.add_argument("--raster-ground", action="store_true",
                   help="round 1: keep the page band, the cards, the lines and the shapes in a JPEG ground per page "
                        "(no connectors, no path elements, empty boxes stay frames)")
    p.add_argument("--no-tables", action="store_true",
                   help="leave ruled grids as frames and decoration (default: a grid with text in most cells is a "
                        "table resource)")
    p.add_argument("--line-width", type=float, default=2.0,
                   help="strokes this thin (pt) or thinner, straight across or down, are read as lines: connectors "
                        "between frames, pointers into pictures, paths (default 2)")
    p.add_argument("--max-paths", type=int, default=150,
                   help="a page with more loose shapes than this keeps them in its raster ground (default 150)")
    p.add_argument("--vector-ground", action="store_true",
                   help="keep a page's loose art as vectors even when it would go to the raster ground (more "
                        "loose shapes than --max-paths, clipped art outside the pictures, more short stray line "
                        "pieces than connector pieces, a full-page image)")
    p.add_argument("--ground-min-px", type=int, default=60,
                   help="a page whose raster ground would hold fewer pixels than this (at --ground-dpi) gets none "
                        "(default 60)")
    p.add_argument("--json", action="store_true")
    m = sub.add_parser("manifest", help="a draft preset.json from an extract folder")
    m.add_argument("dir")
    m.add_argument("--fonts", help="copy these font files into DIR/fonts and list them")
    m.add_argument("--id")
    m.add_argument("--name")
    m.add_argument("--patch", metavar="FILE",
                   help="the curation tables applied after the build (default: DIR/curation.json when it exists; "
                        "composed-pages.md §3.7)")
    args = ap.parse_args(argv)
    if args.cmd == "extract":
        return cmd_extract(args)
    return cmd_manifest(args)


if __name__ == "__main__":
    sys.exit(main())
