#!/usr/bin/env python3
"""A key of symbols in a PDF page (a map's colours, a weather map's fronts)
read as a `kind: "legend"` label or, standing alone, as a key table
(references/composed-pages.md §6.14). `pdf_regions.py extract` calls it; the
functions take its lines (mm from the trim's top-left) and the page's
drawings.

- `drop_duplicate_lines`: the same text printed twice at one spot (a fake
  bold drawn as two offset copies, a fill and a stroke drawn apart) is one
  line; an offset copy makes the kept line bold. Two copies in two colours
  are a label and its halo (the white one under it).
- `find_halos`: a label's outline drawn as paths, a twin of its letters in
  another colour under them, is the label's `halo`, out of the picture's cut.
- `find_legends`: two rows or more of a small symbol followed by a few words,
  the symbols aligned (±1 mm, left edges or centres) at a steady pitch, of
  at least two different looks (one bullet repeated is a list, not a key);
  the words of one look, starting on one edge, each symbol no taller than a
  line and a half and as far from its words as the others (or centred on
  one column). A sample of the map's lettering before the words (a
  country's name in small capitals) is a symbol too: `:icon{glyph}`.
- `find_scale_bars`: a bar with its numbers from `0` up and its ratio stays
  art (of the picture it stands on, or a picture of its own) and its words
  become that picture's labels.
- Symbols: a filled rectangle is `:icon{glyph="■" color}`, a stroked
  straight segment `:icon{line=solid|dashed|dotted color}`, any other drawing
  a small SVG resource (one per shape and colour, shared by every key that
  draws it) named by `:icon{resource}`.
- On a picture the key is a `:::label{at style}` block inside the picture's
  `:::figure` (a label style with `kind: "legend"`, the key's plate as its
  background and border); alone it is a two-column table (symbol, words)
  in a frame of its own, with no rules.
"""
from __future__ import annotations

import hashlib
import re
import statistics
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))
import postext_md as pmd  # noqa: E402
import template_dedupe as td  # noqa: E402  (colours: ΔE, names)

PT_MM = 25.4 / 72
MM = 72 / 25.4

#: two copies of a line closer than this on every edge (mm) are one line
DUPLICATE_MM = 0.3
#: a halo's width (pt) when the source does not say it: a copy printed under the label
HALO_PT = 0.4
#: symbols of one key start within this of each other (mm)
ALIGN_MM = 1.0
#: the widest and the tallest a symbol may be (mm), and the farthest its words start after it
SYMBOL_MAX_W, SYMBOL_MAX_H, GAP_MAX = 15.0, 8.0, 6.0
#: a row's words: at most this many
ROW_MAX_WORDS, ROW_MAX_CHARS = 6, 48
#: the pitch of a key's rows may vary by this share of its median (or 1 mm)
PITCH_TOL = 0.25


def _hex(c: Any) -> str | None:
    if c is None:
        return None
    if isinstance(c, (tuple, list)) and len(c) >= 3:
        return "#" + "".join(f"{max(0, min(255, round(float(v) * 255))):02x}" for v in c[:3])
    if isinstance(c, (int, float)):
        g = max(0, min(255, round(float(c) * 255)))
        return f"#{g:02x}{g:02x}{g:02x}"
    return None


def _box_mm(rect: Any, origin: tuple) -> tuple:
    x0, y0, x1, y1 = rect
    return ((x0 - origin[0]) * PT_MM, (y0 - origin[1]) * PT_MM, (x1 - origin[0]) * PT_MM, (y1 - origin[1]) * PT_MM)


def _union(boxes: list[tuple]) -> tuple:
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def _inside(inner: tuple, outer: tuple, tol: float) -> bool:
    return inner[0] >= outer[0] - tol and inner[1] >= outer[1] - tol and inner[2] <= outer[2] + tol and inner[3] <= outer[3] + tol


def _area(b: tuple) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _meet(a: tuple, b: tuple) -> tuple:
    return (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))


# ---------------------------------------------------------------------------
# duplicate lines
# ---------------------------------------------------------------------------


def _light(col: str | None) -> bool:
    """A paper colour: white or nearly (a halo printed under a label)."""
    if not col:
        return False
    r, g, b = td.hex_rgb(col)
    return min(r, g, b) >= 0.9


def drop_duplicate_lines(lines: list, tol: float = DUPLICATE_MM, notes: list[str] | None = None) -> list:
    """The lines without the second copy of a line printed twice: the same
    text with its box within `tol` mm on every edge. A copy set off the
    first (a fake bold, drawn as two offset prints) makes the kept line
    bold; a copy at the very spot (a fill and a stroke drawn apart) is
    dropped as it is. Two copies in two colours are a label and its halo:
    the coloured one (or, both coloured, the one printed last, on top) is
    the line and its colour, the other its `halo` (`{"color", "width"}`,
    width in pt), never the line's colour. Order kept."""
    kept: list = []
    for l in lines:
        twin = next((k for k in kept if abs(k.rotate - l.rotate) < 1 and k.plain == l.plain
                     and all(abs(a - b) <= tol for a, b in zip(k.box, l.box))), None)
        if twin is None:
            kept.append(l)
            continue
        if td.delta_e(twin.color, l.color) > 10:
            # the first print lies under the second: a white copy under a coloured one is its halo
            top, under = (twin, l) if _light(l.color) and not _light(twin.color) else (l, twin)
            top.halo = {"color": under.color, "width": HALO_PT}
            kept[kept.index(twin)] = top
            if notes is not None:
                notes.append(f"# {top.plain[:40]!r} printed twice, in {top.color} over {under.color}: "
                             f"the {under.color} copy is its halo")
            continue
        offset = max(abs(a - b) for a, b in zip(twin.box, l.box))
        if offset > 0.03 and twin.weight < 600:
            for c in twin.chars:
                c.weight = max(c.weight, 700)
            twin.refresh()
        if notes is not None:
            notes.append(f"# dropped a second copy of {l.plain[:40]!r} at {offset:.2f} mm"
                         + (" (set bold: a fake bold of two prints)" if offset > 0.03 else ""))
    return kept


def find_halos(lines: list, drawings: list, origin: tuple, notes: list[str] | None = None) -> None:
    """A label's outline drawn as paths (a white twin of its glyphs under a
    globe's red degrees): paths of one colour other than the line's, none of
    them a rectangle, each inside one of the line's letters (grown by
    0.4 mm), with the outline pieces of a glyph (five or more on average),
    and between them over seven letters in ten. The line gets `halo`
    (`{"color", "width"}`: the paint, and half the stroke round the fill or
    0.4 pt) and `halo_rects` (page points: each path's extent, for the
    picture's cut to leave out: the label style draws the halo)."""
    cands = []
    for d in drawings:
        r = d["rect"]
        if r.width * PT_MM > 20 or r.height * PT_MM > 20 or _rect_like(d):
            continue
        fill, stroke = _hex(d.get("fill")), _hex(d.get("color"))
        if fill and stroke and td.delta_e(fill, stroke) > 3:
            continue
        col = fill or stroke
        if col:
            cands.append((_box_mm(r, origin), d, col))
    if not cands:
        return
    for l in lines:
        if getattr(l, "halo", None) or l.size > 14:
            continue
        ink = [c for c in l.chars if c.c.strip()]
        if not ink:
            continue
        zone = (l.x0 - 0.8, l.y0 - 0.8, l.x1 + 0.8, l.y1 + 0.8)
        near = [(b, d, col) for b, d, col in cands if _inside(b, zone, 0.0) and td.delta_e(col, l.color) > 10]
        best = None
        for col in sorted({col for _, _, col in near}):
            # the paths of this colour that each stand in one letter, and the letters they stand in
            mine, hit = [], set()
            for b, d, c in near:
                if c != col:
                    continue
                own = [k for k, ch in enumerate(ink) if _inside(b, (ch.x0, ch.y0, ch.x1, ch.y1), 0.4)]
                if not own:
                    continue
                # the letter it covers most, and a fair share of it (a speck of coast is no twin)
                k = max(own, key=lambda k: _area(_meet(b, (ink[k].x0, ink[k].y0, ink[k].x1, ink[k].y1))))
                if _area(b) >= 0.1 * _area((ink[k].x0, ink[k].y0, ink[k].x1, ink[k].y1)):
                    mine.append((b, d))
                    hit.add(k)
            if not mine or len(hit) < 0.7 * len(ink) or len(mine) > 2 * len(ink) + 1:
                continue
            if sum(len(d.get("items", [])) for _, d in mine) < 5 * len(mine):
                continue
            if best is None or len(hit) > best[0]:
                best = (len(hit), col, mine)
        if best is None:
            continue
        _, col, mine = best
        widths = [float(d.get("width") or 0) for _, d in mine if d.get("color") is not None]
        width = round(max(0.2, max(widths) / 2), 2) if widths else HALO_PT
        l.halo = {"color": col, "width": width}
        # MuPDF takes a stroked path out only when the rectangle covers it with its miters at
        # their limit (ten widths) and more: 0.4 pt strokes needed 6 pt
        pad = 15 * max(widths or [0.0]) + 0.6
        rects = [(d["rect"].x0 - pad, d["rect"].y0 - pad, d["rect"].x1 + pad, d["rect"].y1 + pad) for _, d in mine]
        whole = _union(rects)
        ids = {id(d) for _, d in mine}
        # one rectangle round the twin (each redaction of a map page is slow), unless other
        # art lies wholly in it: then one per path
        if any(id(d) not in ids and _inside(tuple(d["rect"]), whole, 0.0) for d in drawings):
            l.halo_rects = rects
        else:
            l.halo_rects = [whole]
        if notes is not None:
            notes.append(f"# {l.plain[:40]!r}: a drawn twin in {col} under the {l.color} text is its halo "
                         f"({width} pt), out of the picture's cut")


def halo_rects(lines: list) -> list:
    """The rectangles (page points, `fitz.Rect`) of the drawn halos of a
    picture's labels (`find_halos`), for its cut to leave out."""
    import fitz

    return [fitz.Rect(r) for l in lines for r in getattr(l, "halo_rects", None) or []]


# ---------------------------------------------------------------------------
# symbols and keys
# ---------------------------------------------------------------------------


@dataclass
class Symbol:
    box: tuple                      # mm
    drawings: list                  # PyMuPDF drawing dicts
    kind: str = "path"              # "square" | "line" | "path" | "text"
    color: str | None = None
    line: str = "solid"
    sample: Any = None              # kind "text": the sample line (a country's name set as on the map)

    def signature(self) -> str:
        """The symbol's shape and paint, the same for two copies at other places."""
        if self.kind == "text":
            l = self.sample
            return hashlib.sha1(f"{l.plain}|{l.color}|{l.size:.1f}|{l.weight}".encode()).hexdigest()[:10]
        x0, y0 = self.drawings[0]["rect"][0], self.drawings[0]["rect"][1]
        bits = []
        for d in self.drawings:
            bits.append(f"{_hex(d.get('fill'))}|{_hex(d.get('color'))}|{round(float(d.get('width') or 0), 1)}|{d.get('dashes')}")
            for it in d.get("items", []):
                pts = []
                for p in it[1:]:
                    if hasattr(p, "x0"):
                        pts += [p.x0 - x0, p.y0 - y0, p.x1 - x0, p.y1 - y0]
                    elif hasattr(p, "ul"):
                        pts += [q - o for pt in (p.ul, p.ur, p.ll, p.lr) for q, o in zip(pt, (x0, y0))]
                    elif hasattr(p, "x"):
                        pts += [p.x - x0, p.y - y0]
                bits.append(it[0] + ",".join(f"{v:.1f}" for v in pts))
        return hashlib.sha1(";".join(bits).encode()).hexdigest()[:10]

    def look(self) -> tuple:
        return (self.kind, self.color, self.line, self.signature() if self.kind in ("path", "text") else "")


@dataclass
class Row:
    symbol: Symbol
    line: Any


@dataclass
class Legend:
    rows: list[Row]
    box: tuple                      # mm: symbols and words
    plate: dict | None = None       # {"box", "fill", "stroke", "width"} of a rectangle drawn round the key
    host: Any = None                # the picture dict it stands on, if any
    rect_pt: tuple | None = None    # the key and its plate, in page points (a little wider)
    icons: dict = field(default_factory=dict)   # signature -> resource id

    @property
    def outer(self) -> tuple:
        return self.plate["box"] if self.plate else self.box


def _rect_like(d: dict) -> bool:
    items = d.get("items", [])
    if len(items) == 1 and items[0][0] in ("re", "qu"):
        return True
    if items and all(it[0] == "l" for it in items) and len(items) in (3, 4):
        r = d["rect"]
        for it in items:
            p, q = it[1], it[2]
            if abs(p.x - q.x) > 0.3 and abs(p.y - q.y) > 0.3:
                return False        # a slanted side: no rectangle
            for c in (p, q):
                if min(abs(c.x - r[0]), abs(c.x - r[2])) > 0.3 or min(abs(c.y - r[1]), abs(c.y - r[3])) > 0.3:
                    return False    # a point off the corners
        return True
    return False


def classify_symbol(drawings: list, origin: tuple) -> Symbol:
    """What a symbol made of `drawings` is drawn as."""
    box = _union([_box_mm(d["rect"], origin) for d in drawings])
    if len(drawings) == 1:
        d = drawings[0]
        fill, stroke = _hex(d.get("fill")), _hex(d.get("color"))
        items = d.get("items", [])
        if fill and _rect_like(d):
            return Symbol(box, drawings, "square", fill)
        if not fill and stroke and items and all(it[0] == "l" for it in items):
            pts = [p for it in items for p in it[1:]]
            flat = max(p.y for p in pts) - min(p.y for p in pts) <= max(1.0, 0.15 * (max(p.x for p in pts) - min(p.x for p in pts)))
            if flat:
                return Symbol(box, drawings, "line", stroke, _dash_style(d))
    col = next((_hex(d.get("fill")) or _hex(d.get("color")) for d in drawings if d.get("fill") or d.get("color")), None)
    return Symbol(box, drawings, "path", col)


def _dash_style(d: dict) -> str:
    dashes = str(d.get("dashes") or "")
    inner = dashes[dashes.find("[") + 1:dashes.find("]")] if "[" in dashes and "]" in dashes else ""
    try:
        vals = [float(v) for v in inner.split()]
    except ValueError:
        vals = []
    if not vals or not any(v > 0 for v in vals):
        return "solid"
    width = float(d.get("width") or 1)
    return "dotted" if vals[0] <= 1.5 * width else "dashed"


def _short(l: Any) -> bool:
    words = l.plain.split()
    return 0 < len(words) <= ROW_MAX_WORDS and len(l.plain) <= ROW_MAX_CHARS and not l.rotate


def find_legends(lines: list, drawings: list, origin: tuple) -> list[Legend]:
    """The keys on a page: two rows or more of a symbol and a few words."""
    small = []
    for d in drawings:
        b = _box_mm(d["rect"], origin)
        w, h = b[2] - b[0], b[3] - b[1]
        if w <= SYMBOL_MAX_W and h <= SYMBOL_MAX_H and (w > 0.4 or h > 0.4) and (d.get("fill") is not None or d.get("color") is not None):
            small.append((b, d))
    taken: set[int] = set()
    rows: list[Row] = []
    for l in sorted((l for l in lines if _short(l)), key=lambda l: (l.y0, l.x0)):
        mid, lh = (l.y0 + l.y1) / 2, l.y1 - l.y0
        band = (l.y0 - 1.0, l.y1 + 1.0)
        near = [(b, d) for b, d in small if id(d) not in taken and b[2] <= l.x0 + 0.3 and l.x0 - b[2] <= GAP_MAX
                and abs((b[1] + b[3]) / 2 - mid) <= max(1.0, 0.5 * lh) and b[1] >= band[0] - 2 and b[3] <= band[1] + 2]
        if not near:
            continue
        # the drawing next to the words, and those it touches (a front's line and its triangles)
        first = max(near, key=lambda bd: bd[0][2])
        group = [first]
        grown = True
        while grown:
            grown = False
            u = _union([b for b, _ in group])
            for bd in near:
                if bd in group:
                    continue
                b = bd[0]
                if b[0] <= u[2] + 1.0 and b[2] >= u[0] - 1.0:
                    group.append(bd)
                    grown = True
        if _union([b for b, _ in group])[2] - _union([b for b, _ in group])[0] > SYMBOL_MAX_W:
            continue
        for _, d in group:
            taken.add(id(d))
        group.sort(key=lambda bd: bd[1].get("seqno", 0))
        rows.append(Row(classify_symbol([d for _, d in group], origin), l))
    # a row whose symbol is a sample of the map's own lettering (a country's name
    # in small capitals before "Country"): a short line in another look just before
    # the words, on their line
    used = {id(r.line) for r in rows}
    for l in sorted((l for l in lines if _short(l) and id(l) not in used), key=lambda l: (l.y0, l.x0)):
        sample = _text_sample(l, lines, used)
        if sample is not None:
            used |= {id(l), id(sample)}
            rows.append(Row(Symbol(sample.box, [], "text", sample.color, sample=sample), l))
    # keys: rows whose symbols start together (or stand centred on one column), one
    # under another at a steady pitch
    legends: list[Legend] = []
    left = sorted(rows, key=lambda r: (r.line.base, r.symbol.box[0]))
    while left:
        seed = left.pop(0)
        col = [seed] + [r for r in left if _aligned(r.symbol.box, seed.symbol.box)]
        for r in col[1:]:
            left.remove(r)
        col.sort(key=lambda r: r.line.base)
        for run in _steady_runs(col):
            if len(run) >= 2 and len({r.symbol.look() for r in run}) >= 2 and _one_key(run):
                box = _union([r.symbol.box for r in run] + [r.line.box for r in run])
                legends.append(Legend(run, box))
    return legends


def _aligned(a: tuple, b: tuple) -> bool:
    """Two symbols in one column of a key: their left edges, or their
    centres (a ring and a border line centred on one column), within
    `ALIGN_MM`."""
    return abs(a[0] - b[0]) <= ALIGN_MM or abs((a[0] + a[2]) / 2 - (b[0] + b[2]) / 2) <= ALIGN_MM


def _text_sample(l: Any, lines: list, used: set) -> Any:
    """The line set just before `l`'s words as a key's sample of the map's
    lettering (a country's name before "Country"): one or two words, no
    larger than the words and in another look (size, weight or colour),
    ending at most `GAP_MAX` before them on their line. None when there is
    none."""
    mid, lh = (l.y0 + l.y1) / 2, l.y1 - l.y0
    best = None
    for s in lines:
        if s is l or id(s) in used or s.rotate or not s.plain.strip():
            continue
        if len(s.plain.split()) > 2 or len(s.plain) > 20 or s.x1 - s.x0 > SYMBOL_MAX_W:
            continue
        if not (s.x1 <= l.x0 + 0.3 and l.x0 - s.x1 <= GAP_MAX):
            continue
        if abs((s.y0 + s.y1) / 2 - mid) > max(1.0, 0.5 * lh) or s.size > l.size + 0.25:
            continue
        if abs(s.size - l.size) <= 0.5 and s.weight == l.weight and td.delta_e(s.color, l.color) <= 3:
            continue        # the same look: words of one line, not a sample
        if best is None or s.x1 > best.x1:
            best = s
    return best


def _one_key(run: list[Row]) -> bool:
    """The rows read as one key: their words set in one look and starting on
    one edge, each symbol no taller than its row's line and a half, at about
    the same distance from its words (or the symbols centred on one column,
    each at most `GAP_MAX` from its words). Names on a map beside a coast or
    a capital's dot fail it: their looks, edges and gaps differ."""
    first = run[0].line
    for r in run:
        l = r.line
        if l.family != first.family or abs(l.size - first.size) > 0.5 or td.delta_e(l.color, first.color) > 3:
            return False
        if abs(l.x0 - first.x0) > ALIGN_MM:
            return False
        if r.symbol.box[3] - r.symbol.box[1] > 1.6 * max(l.y1 - l.y0, 0.5):
            return False
    gaps = [r.line.x0 - r.symbol.box[2] for r in run]
    if max(gaps) - min(gaps) <= 1.5:
        return True
    mids = [(r.symbol.box[0] + r.symbol.box[2]) / 2 for r in run]
    return max(mids) - min(mids) <= ALIGN_MM and max(gaps) <= GAP_MAX


def _steady_runs(col: list[Row]) -> list[list[Row]]:
    """Runs of rows one under another at a steady pitch, no wider than three lines."""
    runs: list[list[Row]] = []
    cur: list[Row] = []
    for r in col:
        if not cur:
            cur = [r]
            continue
        step = r.line.base - cur[-1].line.base
        lh = max(r.line.y1 - r.line.y0, 0.5)
        steps = [b.line.base - a.line.base for a, b in zip(cur, cur[1:])]
        pitch = statistics.median(steps) if steps else step
        if 0 < step <= 3.0 * lh + 2.0 and abs(step - pitch) <= max(1.0, PITCH_TOL * pitch):
            cur.append(r)
        else:
            runs.append(cur)
            cur = [r]
    if cur:
        runs.append(cur)
    return runs


def find_plate(legend: Legend, drawings: list, origin: tuple) -> dict | None:
    """A rectangle drawn round the key (its plate): filled or ruled, its
    corner no more than 8 mm from the key's, at most four times its area."""
    return _plate_round(legend.box, drawings, origin)


def _plate_round(box: tuple, drawings: list, origin: tuple) -> dict | None:
    best = None
    for d in drawings:
        if not _rect_like(d):
            continue
        b = _box_mm(d["rect"], origin)
        if not _inside(box, b, 0.2) or b == box:
            continue
        # the key starts near the plate's corner; the plate may run on past its words
        lead = max(box[0] - b[0], box[1] - b[1])
        if lead > 8.0 or _area(b) > 4 * max(_area(box), 1e-6):
            continue
        if best is None or _area(b) < _area(best["box"]):
            best = {"box": b, "fill": _hex(d.get("fill")), "stroke": _hex(d.get("color")) if d.get("color") is not None else None,
                    "width": float(d.get("width") or 0)}
    return best


# ---------------------------------------------------------------------------
# scale bars
# ---------------------------------------------------------------------------

#: a scale bar's number: `0`, `400`, `800 km`, `1,000 mi`
_SCALE_NUMBER = re.compile(r"^\d[\d\s.,\u00a0\u2009\u202f]*(?:\s*[^\W\d_]{1,5})?$")
#: a scale's ratio (`1:48 000 000`)
_SCALE_RATIO = re.compile(r"\b1\s?:\s?\d")


@dataclass
class ScaleBar:
    bar: tuple                      # mm: the bar and its ticks
    lines: list                     # its numbers and title
    plate: dict | None = None       # a rectangle drawn round it (as `find_plate`)
    host: Any = None                # the picture dict it stands on, if any

    @property
    def box(self) -> tuple:
        return _union([self.bar] + [l.box for l in self.lines])

    @property
    def outer(self) -> tuple:
        return self.plate["box"] if self.plate else self.box


def _number(text: str) -> float | None:
    t = text.strip()
    if not _SCALE_NUMBER.match(t):
        return None
    digits = re.sub(r"[^\d]", "", re.match(r"[\d\s.,\u00a0\u2009\u202f]*", t).group(0))
    return float(digits) if digits else None


def find_scale_bars(lines: list, drawings: list, origin: tuple) -> list[ScaleBar]:
    """The scale bars on a page: a straight bar 8 to 120 mm long and at most
    3 mm high (a stroked rule with its ticks, or filled segments one after
    another), with two numbers or more set just under or over it, left to
    right from `0` upwards (`0`, `400`, `800 km`), and the line that gives
    the ratio (`Scale 1:48 000 000`) next to them."""
    segs = []
    for d in drawings:
        b = _box_mm(d["rect"], origin)
        w, h = b[2] - b[0], b[3] - b[1]
        items = d.get("items", [])
        stroked = d.get("color") is not None and items and all(it[0] == "l" for it in items)
        filled = d.get("fill") is not None and _rect_like(d)
        if h <= 3.0 and (stroked or filled) and (w >= 2.0 or (stroked and h >= 0.4 and w <= 0.8)):
            segs.append(b)
    # the pieces of one bar: on one row, touching
    bars: list[tuple] = []
    for b in sorted(segs, key=lambda b: (b[0], b[1])):
        for k, u in enumerate(bars):
            if b[0] <= u[2] + 0.5 and b[2] >= u[0] - 0.5 and b[1] <= u[3] + 0.3 and b[3] >= u[1] - 0.3:
                bars[k] = _union([u, b])
                break
        else:
            bars.append(b)
    out: list[ScaleBar] = []
    taken: set[int] = set()
    for bar in bars:
        if not (8.0 <= bar[2] - bar[0] <= 120.0):
            continue
        nums = []
        for l in lines:
            if l.rotate or id(l) in taken:
                continue
            v = _number(l.plain)
            if v is None:
                continue
            below = -0.5 <= l.y0 - bar[3] <= 4.0
            above = -0.5 <= bar[1] - l.y1 <= 4.0
            if (below or above) and bar[0] - 4.0 <= (l.x0 + l.x1) / 2 <= bar[2] + 6.0:
                nums.append((l, v))
        if len(nums) < 2:
            continue
        nums.sort(key=lambda lv: lv[0].x0)
        values = [v for _, v in nums]
        if values[0] != 0 or any(b <= a for a, b in zip(values, values[1:])):
            continue
        core = _union([bar] + [l.box for l, _ in nums])
        title = [l for l in lines if id(l) not in taken and not l.rotate and all(l is not n for n, _ in nums)
                 and _SCALE_RATIO.search(l.plain) and l.x0 <= core[2] and l.x1 >= core[0]
                 and (0 <= core[1] - l.y1 <= 6.0 or 0 <= l.y0 - core[3] <= 6.0)]
        sb = ScaleBar(bar, [l for l, _ in nums] + title)
        sb.plate = _plate_round(sb.box, drawings, origin)
        if sb.plate is not None:
            # every word on the plate is the bar's (a unit set apart, a title without a ratio)
            sb.lines += [l for l in lines if id(l) not in taken and all(l is not k for k in sb.lines)
                         and not l.rotate and _inside(l.box, sb.plate["box"], 0.2)]
        taken |= {id(l) for l in sb.lines}
        out.append(sb)
    return out


def take_scale_bars(lines: list, drawings: list, origin: tuple, pictures: list, cache: dict,
                    notes: list[str]) -> list[ScaleBar]:
    """A scale bar stays art (§6.14): on a picture it is the picture's (its
    plate no box of the page), alone it is a picture of its own; either way
    its numbers and ratio are the picture's labels at their places along the
    bar. Stores the bars in `cache["scale_bars"]`."""
    found = find_scale_bars(lines, drawings, origin)
    boxes = (cache.get("shapes") or {}).get("boxes", [])
    for sb in found:
        outer = sb.outer
        if sb.plate is not None:
            for s in [s for s in boxes if all(abs(a - b) <= 0.6 for a, b in zip(s.box, sb.plate["box"]))]:
                boxes.remove(s)         # the plate is the bar's art, not a box with text
                s.picture_art = True
        host = next((p for p in sorted(pictures, key=lambda p: _area(p["box"])) if _inside(outer, p["box"], 1.0)), None)
        sb.host = host
        words = " / ".join(l.plain for l in sb.lines)
        if host is not None:
            notes.append(f"a scale bar at {[round(v, 1) for v in outer]} ({words}): art of the picture at "
                         f"{[round(v, 1) for v in host['box']]}, its numbers labels")
        else:
            for p in [p for p in pictures if _inside(p["box"], outer, 1.0)]:
                pictures.remove(p)      # its own pieces, clustered: one picture
            pictures.append({"box": outer, "images": [], "vector": 1, "scale_bar": True})
            notes.append(f"a scale bar at {[round(v, 1) for v in outer]} ({words}): a picture of its own, "
                         "its numbers labels")
    cache["scale_bars"] = found
    return found


# ---------------------------------------------------------------------------
# Markdown, styles, resources
# ---------------------------------------------------------------------------


def icon_id(sym: Symbol) -> str:
    return f"icon-{sym.signature()}"


def icon_markdown(sym: Symbol, alt: str, line_size_mm: float, row_size_pt: float | None = None) -> str:
    """`:icon[alt]{…}` for a symbol. A sample of lettering is a glyph icon
    of its own words (their alt text too: each edition writes its own), its
    `size` the sample's capitals over the row's (`row_size_pt`)."""
    if sym.kind == "text":
        alt = sym.sample.plain
    a = alt.replace("[", "\\[").replace("]", "\\]")
    if sym.kind == "text":
        attrs = {"glyph": sym.sample.plain, "color": sym.color}
        if row_size_pt:
            size = round(min(1.5, max(0.3, 0.75 * sym.sample.size / row_size_pt)) * 20) / 20
            if abs(size - 0.75) > 0.04:
                attrs["size"] = f"{size:g}"
    elif sym.kind == "square":
        attrs = {"glyph": "■", "color": sym.color}
    elif sym.kind == "line":
        attrs = {"line": sym.line, "color": sym.color}
    else:
        attrs = {"resource": icon_id(sym)}
        h = sym.box[3] - sym.box[1]
        size = round(min(1.5, max(0.4, h / max(line_size_mm, 0.1))) * 20) / 20
        if abs(size - 0.75) > 0.1:
            attrs["size"] = f"{size:g}"
    return f":icon[{a}]" + pmd.attrs(**{k: v for k, v in attrs.items() if v})


def symbol_svg(sym: Symbol) -> tuple[str, float, float]:
    """(SVG text, width, height) of a symbol, in points, from its drawings."""
    pad = max(float(d.get("width") or 0) for d in sym.drawings) / 2 + 0.25
    x0 = min(d["rect"][0] for d in sym.drawings) - pad
    y0 = min(d["rect"][1] for d in sym.drawings) - pad
    x1 = max(d["rect"][2] for d in sym.drawings) + pad
    y1 = max(d["rect"][3] for d in sym.drawings) + pad
    w, h = x1 - x0, y1 - y0
    f = lambda v: f"{v:.2f}".rstrip("0").rstrip(".")  # noqa: E731
    paths = []
    for d in sym.drawings:
        parts: list[str] = []
        at = None
        for it in d.get("items", []):
            op = it[0]
            if op == "l":
                p, q = it[1], it[2]
                if at is None or abs(at[0] - p.x) > 0.01 or abs(at[1] - p.y) > 0.01:
                    parts.append(f"M{f(p.x - x0)} {f(p.y - y0)}")
                parts.append(f"L{f(q.x - x0)} {f(q.y - y0)}")
                at = (q.x, q.y)
            elif op == "c":
                p, c1, c2, q = it[1], it[2], it[3], it[4]
                if at is None or abs(at[0] - p.x) > 0.01 or abs(at[1] - p.y) > 0.01:
                    parts.append(f"M{f(p.x - x0)} {f(p.y - y0)}")
                parts.append(f"C{f(c1.x - x0)} {f(c1.y - y0)} {f(c2.x - x0)} {f(c2.y - y0)} {f(q.x - x0)} {f(q.y - y0)}")
                at = (q.x, q.y)
            elif op == "re":
                r = it[1]
                parts.append(f"M{f(r.x0 - x0)} {f(r.y0 - y0)}H{f(r.x1 - x0)}V{f(r.y1 - y0)}H{f(r.x0 - x0)}Z")
                at = None
            elif op == "qu":
                qd = it[1]
                pts = [qd.ul, qd.ur, qd.lr, qd.ll]
                parts.append("M" + "L".join(f"{f(p.x - x0)} {f(p.y - y0)}" for p in pts) + "Z")
                at = None
        if d.get("closePath") and parts and not parts[-1].endswith("Z"):
            parts.append("Z")
        fill, stroke = _hex(d.get("fill")), _hex(d.get("color"))
        attrs = f' fill="{fill}"' if fill else ' fill="none"'
        if stroke:
            attrs += f' stroke="{stroke}" stroke-width="{f(float(d.get("width") or 1))}"'
            dash = str(d.get("dashes") or "")
            inner = dash[dash.find("[") + 1:dash.find("]")] if "[" in dash and "]" in dash else ""
            if inner.strip():
                attrs += f' stroke-dasharray="{inner.strip()}"'
        if d.get("even_odd"):
            attrs += ' fill-rule="evenodd"'
        paths.append(f'<path d="{"".join(parts)}"{attrs}/>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{f(w)}pt" height="{f(h)}pt" '
           f'viewBox="0 0 {f(w)} {f(h)}">' + "".join(paths) + "</svg>\n")
    return svg, round(w, 2), round(h, 2)


def row_look(legend: Legend) -> dict:
    """The face, size and colour most of the key's words are set in."""
    ls = [r.line for r in legend.rows]
    fam = statistics.mode([l.family for l in ls])
    size = statistics.median([l.size for l in ls])
    col = statistics.mode([l.color for l in ls])
    weight = min(l.weight for l in ls)
    italic = all(l.italic for l in ls)
    return {"family": fam, "size": round(size * 2) / 2, "color": col, "weight": weight, "italic": italic}


def legend_style(legend: Legend) -> dict:
    """The key's `kind: "legend"` label style: the words' look, and the
    plate drawn round the key as background, padding and border."""
    look = row_look(legend)
    sid = f"legend-{td.colour_name(look['color'])}-{str(look['size']).rstrip('0').rstrip('.')}"
    st: dict = {"id": sid, "kind": "legend", "align": "start", "fontFamily": look["family"],
                "fontSize": {"value": look["size"], "unit": "pt"}, "fontWeight": look["weight"],
                "color": {"hex": look["color"], "model": "hex"}}
    if look["italic"]:
        st["fontStyle"] = "italic"
    plate = legend.plate
    st["background"] = {"hex": (plate or {}).get("fill") or "#ffffff", "model": "hex"}
    pad = min(legend.box[0] - plate["box"][0], legend.box[1] - plate["box"][1]) if plate else 1.0
    st["padding"] = {"value": round(min(4.0, max(0.5, pad)), 1), "unit": "mm"}
    if plate and plate.get("stroke") and plate.get("width", 0) > 0:
        st["border"] = {"color": {"hex": plate["stroke"], "model": "hex"}, "width": {"value": round(plate["width"], 2), "unit": "pt"}}
    return st


def row_markdown(row: Row, text_of: Callable[[Any], str]) -> str:
    return icon_markdown(row.symbol, row.line.plain, row.line.y1 - row.line.y0, row.line.size) + " " + text_of(row.line)


def label_block(legend: Legend, at: str, style_id: str, text_of: Callable[[Any], str]) -> str:
    """`:::label{at style}` … `:::`, a row of the key a line."""
    body = "\n".join(row_markdown(r, text_of) for r in legend.rows)
    return f":::label{pmd.attrs(at=at, style=style_id)}\n{body}\n:::"


def legend_table(legend: Legend, text_of: Callable[[Any], str]) -> dict:
    """A key standing alone as a table the composed page lays in a frame:
    {box, model, style, notes} as `grid_tables` gives them."""
    look = row_look(legend)
    rows = [[{"content": icon_markdown(r.symbol, r.line.plain, r.line.y1 - r.line.y0, r.line.size)}, {"content": text_of(r.line)}]
            for r in legend.rows]
    style = {"rules": "none", "borders": False, "bodyFontFamily": look["family"],
             "bodyFontSize": {"value": look["size"], "unit": "pt"}, "bodyColor": {"hex": look["color"], "model": "hex"},
             "cellPadding": {"value": 1, "unit": "pt"}}
    if legend.plate and legend.plate.get("fill"):
        style["bodyBackground"] = {"hex": legend.plate["fill"], "model": "hex"}
    # the columns as the source sets them: the symbols and their gap, the words
    words_x0 = min(r.line.x0 for r in legend.rows)
    sym_w = max(0.5, words_x0 - legend.box[0])
    text_w = max(1.0, legend.box[2] - words_x0)
    # a little room past the longest row, so another face or edition does not wrap it
    x0, y0, x1, y1 = legend.outer
    box = (x0, y0, max(x1, legend.box[2] + 0.25 * text_w + 2.0), y1)
    model = {"rows": rows, "headerRowCount": 0,
             "columnWidths": [round(sym_w, 2), round(box[2] - words_x0, 2)]}
    return {"box": box, "model": model, "style": style,
            "notes": [f"a key of {len(rows)} rows set as a table of symbols and words (legends.py)"]}


# ---------------------------------------------------------------------------
# the hooks pdf_regions.py calls
# ---------------------------------------------------------------------------


def take_legends(lines: list, page: Any, origin: tuple, pictures: list, cache: dict, report: dict,
                 text_of: Callable[[Any], str]) -> list:
    """Before the page's lines go to their owners: drop the second copies of
    lines printed twice, find the page's keys, and take their rows out of
    the flow. A key on a picture goes to `picture["legends"]`; a key alone
    to the page's tables (`cache["tables"]`). Pictures that are only the
    key's own symbols leave `pictures`. Returns the lines left."""
    notes = report.setdefault("notes", [])
    lines = drop_duplicate_lines(lines, notes=notes)
    if "legends" not in cache:
        drawings = page.get_drawings()
        find_halos(lines, drawings, origin, notes)
        found = find_legends(lines, drawings, origin)
        for lg in found:
            lg.plate = find_plate(lg, drawings, origin)
        cache["legends"] = found
        for lg in found:
            outer = lg.outer
            for p in [p for p in pictures if _inside(p["box"], outer, 1.0)]:
                pictures.remove(p)      # the key's own symbols, clustered: no picture
            host = next((p for p in sorted(pictures, key=lambda p: _area(p["box"])) if _inside(outer, p["box"], 1.0)), None)
            lg.host = host
            if host is not None:
                host.setdefault("legends", []).append(lg)
                pad = 0.5
                lg.rect_pt = ((outer[0] - pad) * MM + origin[0], (outer[1] - pad) * MM + origin[1],
                              (outer[2] + pad) * MM + origin[0], (outer[3] + pad) * MM + origin[1])
                notes.append(f"a key of {len(lg.rows)} rows on the picture at {[round(v, 1) for v in host['box']]}: "
                             "a kind legend label; the key leaves the picture's cut")
            else:
                cache.setdefault("tables", []).append(legend_table(lg, text_of))
                notes.append(f"a key of {len(lg.rows)} rows at {[round(v, 1) for v in outer]}: a table of symbols and words")
        keyed = {id(r.line) for lg in found for r in lg.rows} | \
            {id(r.symbol.sample) for lg in found for r in lg.rows if r.symbol.kind == "text"}
        take_scale_bars([l for l in lines if id(l) not in keyed], drawings, origin, pictures, cache, notes)
    row_of = [r.line for lg in cache["legends"] for r in lg.rows] + \
        [r.symbol.sample for lg in cache["legends"] for r in lg.rows if r.symbol.kind == "text"]
    row_lines = {id(l) for l in row_of}
    row_text = {(l.plain, round(l.x0, 1), round(l.y0, 1)) for l in row_of}
    return [l for l in lines if id(l) not in row_lines and (l.plain, round(l.x0, 1), round(l.y0, 1)) not in row_text]


def key_rects(picture: dict) -> list:
    """The rectangles (page points, `fitz.Rect`) of the keys on a picture,
    for its cut to leave out: the label draws the key."""
    import fitz

    return [fitz.Rect(lg.rect_pt) for lg in picture.get("legends", []) if lg.rect_pt]


def place_legends(frames: list, cache: dict, out_dir: Path, ctx: dict, text_of: Callable[[Any], str]) -> list[dict]:
    """After the page's pictures are cut: each key on a picture becomes an
    anchor on the picture's resource and a label block (`f.legend_blocks`);
    the label styles go to `ctx["legend_styles"]`. Returns the SVG icon
    resources this page brings (each shape and colour once per book)."""
    out: list[dict] = []
    written = ctx.setdefault("legend_icons", set())
    styles = ctx.setdefault("legend_styles", {})
    for lg in cache.get("legends", []):
        for r in lg.rows:
            if r.symbol.kind != "path":
                continue
            rid = icon_id(r.symbol)
            if rid in written:
                continue
            svg, w, h = symbol_svg(r.symbol)
            (out_dir / "resources").mkdir(parents=True, exist_ok=True)
            (out_dir / "resources" / f"{rid}.svg").write_text(svg, encoding="utf-8")
            written.add(rid)
            out.append({"id": rid, "typeId": "picture", "kind": "svg", "file": f"resources/{rid}.svg",
                        "width": w, "height": h, "caption": "", "altText": ""})
    for f in frames:
        pic = getattr(f, "picture", None)
        res = getattr(f, "resource", None)
        if not isinstance(pic, dict) or not pic.get("legends") or not res:
            continue
        bx0, by0, bx1, by1 = f.box
        bw, bh = max(bx1 - bx0, 1e-6), max(by1 - by0, 1e-6)
        blocks, anchors = [], []
        for k, lg in enumerate(pic["legends"], 1):
            st = legend_style(lg)
            styles.setdefault(st["id"], st)
            at = "legend" if len(pic["legends"]) == 1 else f"legend-{k}"
            ox, oy = lg.box[0], lg.box[1]       # the label's plate reaches out round it by its padding
            anchors.append({"id": at, "x": round(min(max((ox - bx0) / bw, 0.0), 1.0), 4),
                            "y": round(min(max((oy - by0) / bh, 0.0), 1.0), 4), "align": "start", "verticalAlign": "top",
                            "style": st["id"]})
            blocks.append(label_block(lg, at, st["id"], text_of))
        f.legend_blocks = blocks
        if getattr(f, "labels", None):
            f.pointer_anchors = list(getattr(f, "pointer_anchors", None) or []) + anchors
        else:
            res["anchors"] = list(res.get("anchors") or []) + anchors
    return out


def figure_markdown(block: str | None, f: Any, rid: str, slot: str) -> str | None:
    """The picture's `:::figure` block with its keys' label blocks in it;
    `block` is the block written without them (None when the picture had
    no labels, only a key). None when it has no key."""
    keys = getattr(f, "legend_blocks", None)
    if not keys:
        return block
    if block is None:
        block = ":::figure" + pmd.attrs(resource=rid, slot=slot) + "\n:::"
    head, _, _ = block.rpartition(":::")
    return head.rstrip("\n") + "\n" + "\n".join(keys) + "\n:::"


def label_styles(ctx: dict) -> list[dict]:
    """The label styles of the book's keys."""
    return list(ctx.get("legend_styles", {}).values())
