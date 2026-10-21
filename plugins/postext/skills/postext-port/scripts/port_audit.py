#!/usr/bin/env python3
"""Compare the source PDF and the port's PDF attribute by attribute.

    port_audit.py source.pdf port.pdf [--source-pages 23-30] [--port-pages 1-8]
        [--json audit.json] [--md audit.md] [--strict] [--limit 25]

`compare_pages.py` scores pixels; this reads the text of both PDFs with
PyMuPDF, matches the words of the source to the words of the port by their
content (case and line breaks aside), and compares what the words are set
in, pair by pair:

  specialSpace   a fixed or no-break space of the source (en, em, thin,
                 no-break, narrow no-break; or a wide gap inside a line that
                 is not justification) set as a plain word space, a fixed
                 space with a word space added, or two words the source
                 glues (a number and its unit) broken across lines
  italic         slanted in one and upright in the other; a source that
                 shears an upright face (a synthetic italic, shear above
                 0.15) counts as italic
  bold           bold in one and regular in the other
  smallCaps      small capitals in one only: a small-caps face (SC, SmCp),
                 or capitals at 55-85 % of the line's text size (how Postext
                 sets `:smallcaps[…]`)
  bulletSize     a list bullet whose size against its item's text differs
                 by more than 20 %
  bulletWeight   a bold bullet against a regular one
  bulletMissing  a source bullet with no bullet before the same item
  cellAlign      a table cell aligned left, centre or right in one and
                 otherwise in the other (ruled tables PyMuPDF finds on both
                 sides, cells matched by their text)
  cellBold       a table cell bold in one only
  folioColour    the colour of the words in the head and foot margins
                 (folios, running heads, design text there)
  textColour     the colour of every other word

Consecutive words with the same gap count once (a run). The report gives the
count per attribute and per source page, and lists the runs with the page
of each side, the words and both values. Make the port's PDF with `postext
pdf my-book --locale es -o port.pdf` or `node render.mjs my-book --out
port.pdf`, and give the same stretch of the book on both sides (the page
ranges are 1-based PDF pages). Run it before delivery: every count should
be 0, or be a choice the report names.

Horizontal text only; synthetic bold (a stroked fill) and colours of
pictures are not read. Exit code 1 with --strict when any gap remains.
Requires PyMuPDF.
"""
from __future__ import annotations

import argparse
import contextlib
import difflib
import io
import json
import re
import statistics
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.exit("requires PyMuPDF: python3 -m pip install pymupdf")

ATTRIBUTES = ["specialSpace", "italic", "bold", "smallCaps", "bulletSize", "bulletWeight", "bulletMissing",
              "cellAlign", "cellBold", "folioColour", "textColour"]

# Space classes: what a reader sees. Thin and narrow no-break spaces read the
# same (the port sets U+202F for a source's thin space between digits).
SPACE_CLASS = {
    " ": "space", " ": "no-break", " ": "no-break", " ": "en", " ": "em",
    " ": "thick", " ": "mid", " ": "six-per-em", " ": "thin", " ": "thin",
    " ": "hair", " ": "thin", " ": "mid",
}
GLUE = {"no-break", "thin"}  # classes that keep their two words on one line
BULLETS = set("•●◦○▪■□▫►▸‣⁃–—✓✔➢➤◆◇")
SHEAR_ITALIC = 0.15
SMALL_CAPS_RATIO = (0.55, 0.85)
MARGIN_SHARE = 0.1  # the top and bottom tenth of the page: running heads and folios
COLOUR_TOLERANCE = 40  # largest channel difference (0-255) read as the same colour
BOLD_RE = re.compile(r"bold|black|heavy|semibold|demibold|extrabold|ultrabold|[-_](?:sb|bd|bk|hv)\b", re.I)
ITALIC_RE = re.compile(r"italic|oblique|kursiv|cursiva|slanted|[-_]it\b", re.I)
SC_FACE_RE = re.compile(r"(?:smallcaps|small ?caps|smcp|petite|(?<=[a-z])SC(?=$|[-_ ])|[-_ ]SC(?=$|[-_ ]))")
CJK_FACE_RE = re.compile(r"CJK|SourceHan|Han[A-Z]|(?:SC|TC|HK|JP|KR)-")
UNIT_RE = re.compile(r"^(?:%|‰|°[CF]?|º|[kcmµn]?m[²³]?|[kmµ]?g|[mkM]?l|[kM]?Hz|[kMG]?W|h|min|s|ms|€|\$|£|mmHg|mg/dl|kcal|cal)$",
                     re.I)


@dataclass
class Word:
    text: str
    norm: str
    page: int  # 1-based PDF page
    line: int  # running line number in the document
    x0: float
    x1: float
    y0: float
    y1: float
    size: float
    font: str
    bold: bool
    italic: bool
    shear: float
    color: int
    small_caps: bool
    zone: str  # 'margin' (head or foot band) or 'body'
    sep: str | None = None  # the space character after the word on its line
    gap: float | None = None  # the gap to the next word on the line, in ems of the word's size
    line_end: bool = False
    line_gap: float = 0.25  # the line's median word gap (ems)
    first: bool = False
    bullet: bool = False
    next_size: float | None = None  # size of the next word (a bullet's item)


@dataclass
class Gap:
    attribute: str
    source_page: int
    port_page: int
    words: list[str] = field(default_factory=list)
    source: str = ""
    port: str = ""
    last: int = -1  # index of the last source word in the run

    def as_json(self) -> dict:
        return {"attribute": self.attribute, "sourcePage": self.source_page, "portPage": self.port_page,
                "text": " ".join(self.words)[:160], "source": self.source, "port": self.port}


def page_list(spec: str | None, count: int) -> list[int]:
    """0-based page indexes of a 1-based range list (`3`, `3-9`, `1,4-6`)."""
    if not spec:
        return list(range(count))
    out: list[int] = []
    for part in spec.split(","):
        a, _, b = part.strip().partition("-")
        if not a.strip():
            continue
        s, e = int(a), int(b or a)
        out += [p - 1 for p in range(s, e + 1) if 1 <= p <= count]
    return out


def normalise(text: str) -> str:
    t = unicodedata.normalize("NFKC", text).casefold().replace("­", "")
    if t and all(c in BULLETS for c in t):
        return "•"
    core = t.strip(".,;:!?¡¿()[]{}«»\"'“”‘’·…")
    return core or t


def style_of(font: str, flags: int) -> tuple[bool, bool]:
    name = font.split("+", 1)[-1]
    return bool(flags & 16) or bool(BOLD_RE.search(name)), bool(flags & 2) or bool(ITALIC_RE.search(name))


def span_shear(chars: list[dict]) -> float:
    """How far a span's letters lean: the median of (box width - advance) /
    box height. MuPDF's character box of a sheared face is the slanted
    glyph box's bounds, so it grows by the shear times its height."""
    ks = []
    for a, b in zip(chars, chars[1:]):
        if a["c"].isspace():
            continue
        adv = b["origin"][0] - a["origin"][0]
        x0, y0, x1, y1 = a["bbox"]
        if adv <= 0 or y1 <= y0:
            continue
        ks.append(((x1 - x0) - adv) / (y1 - y0))
    return statistics.median(ks) if ks else 0.0


def colour_close(a: int, b: int) -> bool:
    return all(abs(((a >> s) & 255) - ((b >> s) & 255)) <= COLOUR_TOLERANCE for s in (16, 8, 0))


def hex_colour(c: int) -> str:
    return f"#{c:06x}"


def read_words(doc, pages: list[int]) -> list[Word]:
    words: list[Word] = []
    line_no = 0
    for pno in pages:
        page = doc[pno]
        height = page.rect.height
        raw = page.get_text("rawdict", flags=fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES)
        for block in raw.get("blocks", []):
            for line in block.get("lines", []):
                d = line.get("dir", (1, 0))
                if abs(d[0] - 1) > 0.01 or abs(d[1]) > 0.01:
                    continue  # rotated or vertical lines are not compared
                line_no += 1
                chars = []
                for span in line.get("spans", []):
                    shear = span_shear(span.get("chars", []))
                    bold, italic = style_of(span.get("font", ""), span.get("flags", 0))
                    for c in span.get("chars", []):
                        chars.append((c, span, shear, bold, italic))
                words += line_words(chars, pno + 1, line_no, height)
    merge_hyphenated(words)
    return words


def line_words(chars, page: int, line_no: int, height: float) -> list[Word]:
    """Words of one line: split at spaces and at gaps wider than a fifth of
    an em that hold no character."""
    groups: list[list] = []  # [characters, the space after them]
    cur: list = []
    for item in chars:
        c = item[0]
        if c["c"].isspace():
            if cur:
                groups.append([cur, None])
                cur = []
            if groups and groups[-1][1] in (None, " "):
                groups[-1][1] = c["c"]  # a fixed space wins over a word space beside it
            continue
        if cur:
            size = cur[-1][1].get("size", 10) or 10
            if c["origin"][0] - cur[-1][0]["bbox"][2] > 0.2 * size:
                groups.append([cur, " "])
                cur = []
        cur.append(item)
    if cur:
        groups.append([cur, None])
    out: list[Word] = []
    for g, s in groups:
        out.append(make_word(g, s, page, line_no, height))
    lower_sizes = [w.size for w in out if any(ch.islower() for ch in w.text)]
    line_size = statistics.median(lower_sizes) if lower_sizes else None
    for i, w in enumerate(out):
        nxt = out[i + 1] if i + 1 < len(out) else None
        if nxt is None:
            w.line_end, w.sep, w.gap = True, None, None
        else:
            w.gap = max(0.0, (nxt.x0 - w.x1) / (w.size or 10))
            w.next_size = nxt.size
        if line_size and not w.small_caps:
            letters = [ch for ch in w.text if ch.isalpha() and ch.upper() != ch.lower()]
            if len(letters) >= 2 and all(ch.isupper() for ch in letters) and \
                    SMALL_CAPS_RATIO[0] <= w.size / line_size <= SMALL_CAPS_RATIO[1]:
                w.small_caps = True
    gaps = [w.gap for w in out if w.gap is not None]
    med = statistics.median(gaps) if gaps else 0.25
    for i, w in enumerate(out):
        w.line_gap = med
        w.first = i == 0
        w.bullet = w.first and w.norm == "•"
    return out


def make_word(group, sep, page: int, line_no: int, height: float) -> Word:
    text = "".join(it[0]["c"] for it in group)
    letters = [it for it in group if it[0]["c"].isalnum()] or group
    sizes = [it[1].get("size", 0) for it in letters]
    size = statistics.median(sizes) if sizes else 0
    span = max(letters, key=lambda it: sum(1 for x in letters if x[1] is it[1]))[1]
    vote = lambda k: sum(1 for it in letters if it[k]) * 2 > len(letters)  # noqa: E731
    shear = statistics.median([it[2] for it in letters]) if letters else 0.0
    bold, italic = vote(3), vote(4) or shear > SHEAR_ITALIC
    font = span.get("font", "")
    face = font.split("+", 1)[-1]
    small = bool(SC_FACE_RE.search(face)) and not CJK_FACE_RE.search(face)
    caps = [it for it in letters if it[0]["c"].isalpha() and it[0]["c"].isupper()]
    if not small and len(caps) >= 2:
        hi = max(it[1].get("size", 0) for it in caps)
        lo = min(it[1].get("size", 0) for it in caps)
        small = hi > 0 and SMALL_CAPS_RATIO[0] <= lo / hi <= SMALL_CAPS_RATIO[1]
    if small:
        size = max(it[1].get("size", 0) for it in letters)
    x0 = group[0][0]["origin"][0]
    last = group[-1]
    lx0, ly0, lx1, _ = last[0]["bbox"]
    x1 = lx1 - max(0.0, last[2]) * max(0.0, last[0]["origin"][1] - ly0)
    y0 = min(it[0]["bbox"][1] for it in group)
    y1 = max(it[0]["bbox"][3] for it in group)
    mid = (y0 + y1) / 2
    zone = "margin" if mid < height * MARGIN_SHARE or mid > height * (1 - MARGIN_SHARE) else "body"
    colors = [it[1].get("color", 0) for it in letters]
    color = max(set(colors), key=colors.count) if colors else 0
    return Word(text=text, norm=normalise(text), page=page, line=line_no, x0=x0, x1=max(x0, x1), y0=y0, y1=y1,
                size=size, font=face, bold=bold, italic=italic, shear=shear, color=color, small_caps=small,
                zone=zone, sep=sep)


def merge_hyphenated(words: list[Word]) -> None:
    """Join a word broken at a line end with a hyphen to its second half."""
    i = 0
    while i + 1 < len(words):
        w, n = words[i], words[i + 1]
        if w.line_end and len(w.text) > 2 and w.text[-1] in "-­‐" and w.text[-2].isalpha() \
                and n.text[:1].islower() and n.first:
            w.text = w.text[:-1] + n.text
            w.norm = normalise(w.text)
            w.sep, w.gap, w.line_end = n.sep, n.gap, n.line_end
            w.next_size = n.next_size
            del words[i + 1]
            continue
        i += 1


def match(src: list[Word], port: list[Word]) -> list[tuple[int, int]]:
    sm = difflib.SequenceMatcher(None, [w.norm for w in src], [w.norm for w in port], autojunk=False)
    pairs: list[tuple[int, int]] = []
    for a, b, n in sm.get_matching_blocks():
        pairs += [(a + k, b + k) for k in range(n)]
    return pairs


def space_label(w: Word) -> str:
    if w.line_end:
        return "line break"
    cls = SPACE_CLASS.get(w.sep or " ", "space")
    return f"{cls} ({w.gap:.2f} em)" if w.gap is not None else cls


def compare_spaces(s: Word, s2: Word, p: Word, p2: Word) -> str | None:
    """Why the space between two matched words differs, or None."""
    if s.line_end or s.line != s2.line:
        return None
    cls = SPACE_CLASS.get(s.sep or " ", "space")
    pcls = None if p.line_end or p.line != p2.line else SPACE_CLASS.get(p.sep or " ", "space")
    sgap, pgap = s.gap or 0.0, p.gap or 0.0
    numeric_pair = bool(re.search(r"\d$", s.text)) and bool(UNIT_RE.match(s2.text.strip(".,;:)")))
    if pcls is None:
        if cls in GLUE or (numeric_pair and sgap <= 0.2):
            return "glued words broken across lines"
        return None
    if cls != "space":
        if cls != pcls and abs(pgap - sgap) > max(0.08, 0.25 * sgap):
            if pgap - sgap >= 0.15 and pgap > p.line_gap + 0.1:
                return "fixed space plus a word space"
            return "fixed space set as a word space"
        return None
    if sgap >= 0.4 and sgap - s.line_gap >= 0.2 and pgap < 0.7 * sgap and pgap <= p.line_gap + 0.1:
        return "wide fixed gap set as a word space"
    return None


def audit(src: list[Word], port: list[Word], tables: list[Gap] | None = None) -> dict:
    pairs = match(src, port)
    by_src = dict(pairs)
    gaps: list[Gap] = []
    open_runs: dict[tuple, Gap] = {}

    def add(attr: str, i: int, j: int, sv: str, pv: str) -> None:
        key = (attr, sv, pv)
        run = open_runs.get(key)
        if run and run.last == i - 1 and run.source_page == src[i].page:
            run.words.append(src[i].text)
            run.last = i
            return
        g = Gap(attr, src[i].page, port[j].page, [src[i].text], sv, pv, i)
        gaps.append(g)
        open_runs[key] = g

    for i, j in pairs:
        s, p = src[i], port[j]
        letters = any(c.isalnum() for c in s.text)
        if letters:
            if s.italic != p.italic:
                sv = ("italic" if s.shear <= SHEAR_ITALIC else f"sheared upright face ({s.shear:.2f}, a synthetic italic)") \
                    if s.italic else "upright"
                add("italic", i, j, sv, "italic" if p.italic else "upright")
            if s.bold != p.bold and not s.bullet:
                add("bold", i, j, "bold" if s.bold else "regular", "bold" if p.bold else "regular")
            if s.small_caps != p.small_caps:
                add("smallCaps", i, j, "small capitals" if s.small_caps else "no small capitals",
                    "small capitals" if p.small_caps else ("capitals" if p.text.isupper() else "no small capitals"))
            if s.zone == p.zone and not colour_close(s.color, p.color):  # a folio against a folio
                add("folioColour" if s.zone == "margin" else "textColour", i, j, hex_colour(s.color), hex_colour(p.color))
        if s.bullet and p.bullet:
            rs = s.size / s.next_size if s.next_size else None
            rp = p.size / p.next_size if p.next_size else None
            if rs and rp and abs(rs - rp) > 0.2 * rs:
                add("bulletSize", i, j, f"{rs:.2f} of the item's size", f"{rp:.2f}")
            if s.bold != p.bold:
                add("bulletWeight", i, j, "bold" if s.bold else "regular", "bold" if p.bold else "regular")
        if i + 1 in by_src and by_src[i + 1] == j + 1:
            why = compare_spaces(s, src[i + 1], p, port[j + 1])
            if why:
                key_words = f"{s.text} {src[i + 1].text}"
                g = Gap("specialSpace", s.page, p.page, [key_words], f"{space_label(s)}", f"{why}: {space_label(p)}", i)
                gaps.append(g)
    # Source bullets with no bullet before the same item in the port.
    for i, s in enumerate(src):
        if not s.bullet or i in by_src or i + 1 not in by_src:
            continue
        j = by_src[i + 1]
        if not (j > 0 and port[j - 1].norm == "•"):
            gaps.append(Gap("bulletMissing", s.page, port[j].page, [f"{s.text} {src[i + 1].text}"],
                            f"bullet {s.text!r}", "no bullet", i))
    gaps += tables or []
    counts = {a: 0 for a in ATTRIBUTES}
    by_page: dict[str, dict[str, int]] = {a: {} for a in ATTRIBUTES}
    for g in gaps:
        counts[g.attribute] += 1
        by_page[g.attribute][str(g.source_page)] = by_page[g.attribute].get(str(g.source_page), 0) + 1
    gaps.sort(key=lambda g: (ATTRIBUTES.index(g.attribute), g.source_page, g.last))
    src_words = sum(1 for w in src if any(c.isalnum() for c in w.text))
    matched = sum(1 for i, _ in pairs if any(c.isalnum() for c in src[i].text))
    return {
        "matched": {"sourceWords": src_words, "portWords": sum(1 for w in port if any(c.isalnum() for c in w.text)),
                    "matchedWords": matched, "share": round(matched / src_words, 3) if src_words else 0.0},
        "counts": counts,
        "byPage": {a: v for a, v in by_page.items() if v},
        "gaps": [g.as_json() for g in gaps],
    }


# --- tables -------------------------------------------------------------------

def read_cells(doc, pages: list[int], words: list[Word]) -> list[dict]:
    """Cells of the ruled tables PyMuPDF finds: text, alignment and weight."""
    cells: list[dict] = []
    by_page: dict[int, list[Word]] = {}
    for w in words:
        by_page.setdefault(w.page, []).append(w)
    for pno in pages:
        page = doc[pno]
        try:
            with contextlib.redirect_stdout(io.StringIO()):  # PyMuPDF prints advice here
                found = page.find_tables()
        except Exception:  # noqa: BLE001 - a page PyMuPDF cannot read tables on
            continue
        for t in found.tables:
            for c in t.cells:
                if c is None:
                    continue
                x0, y0, x1, y1 = c
                inside = [w for w in by_page.get(pno + 1, [])
                          if x0 - 0.5 <= (w.x0 + w.x1) / 2 <= x1 + 0.5 and y0 - 0.5 <= (w.y0 + w.y1) / 2 <= y1 + 0.5]
                if not inside:
                    continue
                text = " ".join(w.norm for w in inside)
                l, r, width = min(w.x0 for w in inside) - x0, x1 - max(w.x1 for w in inside), x1 - x0
                slack = l + r
                align = None
                if slack >= max(6.0, 0.2 * width):
                    align = "centre" if abs(l - r) <= 0.25 * slack else ("left" if l < r else "right")
                bold = sum(1 for w in inside if w.bold) * 2 > len(inside)
                cells.append({"page": pno + 1, "text": text, "align": align, "bold": bold,
                              "words": " ".join(w.text for w in inside)})
    return cells


def compare_cells(src: list[dict], port: list[dict]) -> list[Gap]:
    def unique(cells):
        seen: dict[str, list[dict]] = {}
        for c in cells:
            seen.setdefault(c["text"], []).append(c)
        return {k: v[0] for k, v in seen.items() if len(v) == 1 and k}

    s, p = unique(src), unique(port)
    gaps: list[Gap] = []
    for k, sc in s.items():
        pc = p.get(k)
        if pc is None:
            continue
        if sc["align"] and pc["align"] and sc["align"] != pc["align"]:
            gaps.append(Gap("cellAlign", sc["page"], pc["page"], [sc["words"]], sc["align"], pc["align"]))
        if sc["bold"] != pc["bold"]:
            gaps.append(Gap("cellBold", sc["page"], pc["page"], [sc["words"]],
                            "bold" if sc["bold"] else "regular", "bold" if pc["bold"] else "regular"))
    return gaps


# --- report -------------------------------------------------------------------

def run(source: str, port: str, source_pages: str | None = None, port_pages: str | None = None) -> dict:
    sdoc, pdoc = fitz.open(source), fitz.open(port)
    sp, pp = page_list(source_pages, len(sdoc)), page_list(port_pages, len(pdoc))
    sw, pw = read_words(sdoc, sp), read_words(pdoc, pp)
    cells = compare_cells(read_cells(sdoc, sp, sw), read_cells(pdoc, pp, pw))
    rep = audit(sw, pw, cells)
    return {"source": str(source), "port": str(port),
            "pages": {"source": [p + 1 for p in sp], "port": [p + 1 for p in pp]}, **rep}


def markdown(rep: dict, limit: int = 25) -> str:
    m = rep["matched"]
    out = ["# Port audit", "",
           f"Source `{Path(rep['source']).name}` pages {page_span(rep['pages']['source'])}, port "
           f"`{Path(rep['port']).name}` pages {page_span(rep['pages']['port'])}.", "",
           f"Words matched: {m['matchedWords']} of {m['sourceWords']} ({m['share'] * 100:.0f} %).", ""]
    if m["share"] < 0.5:
        out += ["Fewer than half of the source's words were found in the port: check that both page ranges "
                "cover the same stretch of the book.", ""]
    out += ["| Attribute | Gaps | Source pages |", "|---|---:|---|"]
    for a in ATTRIBUTES:
        pages = rep["byPage"].get(a, {})
        where = ", ".join(f"{k} ({v})" for k, v in sorted(pages.items(), key=lambda kv: int(kv[0])))
        out.append(f"| {a} | {rep['counts'][a]} | {where} |")
    for a in ATTRIBUTES:
        rows = [g for g in rep["gaps"] if g["attribute"] == a]
        if not rows:
            continue
        out += ["", f"## {a}", "", "| Source page | Port page | Words | Source | Port |", "|---:|---:|---|---|---|"]
        for g in rows[:limit]:
            text = g["text"].replace("|", "\\|")
            out.append(f"| {g['sourcePage']} | {g['portPage']} | {text} | {g['source']} | {g['port']} |")
        if len(rows) > limit:
            out.append(f"| | | … {len(rows) - limit} more in the JSON | | |")
    return "\n".join(out) + "\n"


def page_span(pages: list[int]) -> str:
    if not pages:
        return "none"
    return f"{pages[0]}-{pages[-1]}" if len(pages) > 1 else str(pages[0])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source")
    ap.add_argument("port")
    ap.add_argument("--source-pages", help="1-based PDF pages of the source (3-9 or 1,4-6); default all")
    ap.add_argument("--port-pages", "--render-pages", dest="port_pages", help="1-based PDF pages of the port")
    ap.add_argument("--json", help="write the report as JSON")
    ap.add_argument("--md", help="write the report as Markdown (default: print it)")
    ap.add_argument("--limit", type=int, default=25, help="runs listed per attribute in the Markdown")
    ap.add_argument("--strict", action="store_true", help="exit 1 when any gap remains")
    args = ap.parse_args()
    rep = run(args.source, args.port, args.source_pages, args.port_pages)
    if args.json:
        Path(args.json).write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
    md = markdown(rep, args.limit)
    if args.md:
        Path(args.md).write_text(md, encoding="utf-8")
    else:
        print(md)
    total = sum(rep["counts"].values())
    print(f"{total} gap(s): " + ", ".join(f"{a} {n}" for a, n in rep["counts"].items() if n), file=sys.stderr)
    sys.exit(1 if args.strict and total else 0)


if __name__ == "__main__":
    main()
