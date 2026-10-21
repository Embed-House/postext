#!/usr/bin/env python3
"""Detect tables in a PDF page range and print each one as a Postext
`TableModel` JSON object, with the look of the source's cells:

    { "rows": [ [ { "content": "Name", "isHeader": true }, ... ],
                [ { "content": "**Total**" },
                  { "content": "12", "align": "right",
                    "background": { "hex": "#fde9c4", "model": "hex" } } ] ],
      "headerRowCount": 1 }

Per cell it writes what a TableCell holds: `align` (`center` or `right`,
from where the text stands in its cell; left is the default and is left
out), `verticalAlign` (`middle` or `bottom`, only in a cell clearly taller
than its text), `**...**` round a body cell set wholly in bold, and
`background` from the fill painted under the cell. Rules are never per
cell in Postext (a TableCell has no border): the rules drawn round the
cells are matched to the nearest `rules` preset (`grid`, `horizontal`,
`outer`, `none`, `booktabs`) and printed, with the border colour and
width, the header's bold and the fills a whole header or body shares, as a
style hint for the table's style (`tableStyles` + `table.styleId`).

Paste the model into a `preset.json` resource of kind "table":
    { "id": "...", "typeId": "table", "kind": "table", "caption": "...",
      "table": { "model": <output> } }

`--json-only` prints the models alone, `--full` every table with its page,
box, model, style hint and notes, `--plain` the text only.

Requires PyMuPDF >= 1.23 (`python3 -m pip install pymupdf`).
"""
from __future__ import annotations

import argparse
import contextlib
import json
import re
import sys

BOLD_NAME = re.compile(r"bold|black|heavy|semibold|demi", re.IGNORECASE)
RULE_MAX = 72 / 25.4      # pt: a filled rectangle thinner than 1 mm is a rule, not a fill
EDGE = 3.0                # pt: a rule this close to a row or column edge draws it


def parse_pages(spec: str | None, page_count: int) -> list[int]:
    if not spec:
        return list(range(page_count))
    pages: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            start_i = int(start) if start else 1
            end_i = int(end) if end else page_count
        else:
            start_i = end_i = int(part)
        for page_no in range(start_i, end_i + 1):
            if 1 <= page_no <= page_count and (page_no - 1) not in pages:
                pages.append(page_no - 1)
    return pages


def clean(text) -> str:
    if text is None:
        return ""
    # Collapse breaking whitespace; no-break spaces glue their neighbours in
    # table cells too (postext 1.5), so they stay.
    return re.sub(r"[^\S   ]+", " ", str(text).replace("\n", " ")).strip()


# ---------------------------------------------------------------------------
# the page's paint


def hexc(c) -> str | None:
    """A PyMuPDF colour (RGB triple, grey, CMYK or an sRGB int) as #rrggbb."""
    if c is None:
        return None
    if isinstance(c, int):
        return "#%06x" % c
    c = tuple(c)
    if len(c) == 1:
        c = (c[0], c[0], c[0])
    elif len(c) == 4:
        k = c[3]
        c = ((1 - c[0]) * (1 - k), (1 - c[1]) * (1 - k), (1 - c[2]) * (1 - k))
    elif len(c) != 3:
        return None
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v * 255))) for v in c)


def whiteish(h: str | None) -> bool:
    return h is not None and all(int(h[i:i + 2], 16) >= 245 for i in (1, 3, 5))


def colour(h: str) -> dict:
    return {"hex": h, "model": "hex"}


def pt(v: float) -> dict:
    return {"value": v, "unit": "pt"}


def page_lines(page) -> list[dict]:
    """Every line of the page's text with ink: its box and its spans."""
    out = []
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            spans = [s for s in line.get("spans", []) if s.get("text", "").strip()]
            if spans:
                out.append({"bbox": tuple(line["bbox"]), "spans": spans})
    return out


def span_bold(span: dict) -> bool:
    return bool(span.get("flags", 0) & 16) or bool(BOLD_NAME.search(span.get("font", "")))


def page_paint(page) -> tuple[list[dict], list[tuple]]:
    """The page's fills (rect, colour, paint order) and its rules: axis-
    aligned stroked lines, the sides of stroked rectangles and filled
    rectangles under 1 mm thick, each as (axis, fixed coordinate, lo, hi,
    width, colour) in points."""
    fills, rules = [], []
    for d in page.get_drawings():
        fill = hexc(d.get("fill")) if (d.get("fill_opacity") or 1) > 0.2 else None
        stroke = hexc(d.get("color")) if (d.get("stroke_opacity") or 1) > 0.2 else None
        width = float(d.get("width") or 0)
        items = d.get("items", [])
        if fill and items and not any(it[0] == "re" for it in items):
            # a fill drawn as a closed path (lines, quads, rounded corners): its box
            r = d["rect"]
            if min(r.width, r.height) < RULE_MAX:
                rules.append(("h", (r.y0 + r.y1) / 2, r.x0, r.x1, r.height, fill) if r.width >= r.height
                             else ("v", (r.x0 + r.x1) / 2, r.y0, r.y1, r.width, fill))
            else:
                fills.append({"rect": (r.x0, r.y0, r.x1, r.y1), "color": fill, "seq": d.get("seqno", 0)})
            fill = None       # read; its stroke, if any, is read below
        for it in items:
            if it[0] == "re":
                r = it[1]
                if fill:
                    if min(r.width, r.height) < RULE_MAX:
                        if r.width >= r.height:
                            rules.append(("h", (r.y0 + r.y1) / 2, r.x0, r.x1, r.height, fill))
                        else:
                            rules.append(("v", (r.x0 + r.x1) / 2, r.y0, r.y1, r.width, fill))
                    else:
                        fills.append({"rect": (r.x0, r.y0, r.x1, r.y1), "color": fill, "seq": d.get("seqno", 0)})
                if stroke and width > 0:
                    rules += [("h", r.y0, r.x0, r.x1, width, stroke), ("h", r.y1, r.x0, r.x1, width, stroke),
                              ("v", r.x0, r.y0, r.y1, width, stroke), ("v", r.x1, r.y0, r.y1, width, stroke)]
            elif it[0] == "l" and stroke and width > 0:
                (x0, y0), (x1, y1) = (it[1].x, it[1].y), (it[2].x, it[2].y)
                if abs(y1 - y0) < 0.5:
                    rules.append(("h", (y0 + y1) / 2, min(x0, x1), max(x0, x1), width, stroke))
                elif abs(x1 - x0) < 0.5:
                    rules.append(("v", (x0 + x1) / 2, min(y0, y1), max(y0, y1), width, stroke))
    return fills, rules


# ---------------------------------------------------------------------------
# a cell's look


def cell_align(extents: list[tuple], box: tuple) -> str | None:
    """`center` or `right` when every line of the cell stands so; None (left,
    the default) otherwise, and when the text fills the cell."""
    x0, _, x1, _ = box
    kinds = set()
    for lx0, lx1 in extents:
        lgap, rgap = lx0 - x0, x1 - lx1
        if lgap + rgap < 8:
            continue                # a line that fills the cell tells nothing
        if abs(lgap - rgap) <= max(1.5, 0.12 * (lgap + rgap)):
            kinds.add("center")
        elif lgap > 2 * rgap + 4:
            kinds.add("right")
        else:
            kinds.add("left")
    return next(iter(kinds)) if len(kinds) == 1 and kinds != {"left"} else None


def cell_valign(top: float, bottom: float, box: tuple, line_h: float) -> str | None:
    """`middle` or `bottom` when the cell is clearly taller than its text."""
    tg, bg = top - box[1], box[3] - bottom
    slack = tg + bg
    if slack < max(6.0, 0.8 * line_h):
        return None
    if abs(tg - bg) <= max(1.5, 0.2 * slack):
        return "middle"
    if bg < tg / 3:
        return "bottom"
    return None


def cell_fill(box: tuple, fills: list[dict]) -> str | None:
    """The colour painted last under the whole cell, unless white."""
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    area = max((box[2] - box[0]) * (box[3] - box[1]), 1e-6)
    best = None
    for f in fills:
        r = f["rect"]
        if not (r[0] <= cx <= r[2] and r[1] <= cy <= r[3]):
            continue
        ix = max(0.0, min(r[2], box[2]) - max(r[0], box[0])) * max(0.0, min(r[3], box[3]) - max(r[1], box[1]))
        if ix >= 0.8 * area and (best is None or f["seq"] > best["seq"]):
            best = f
    if best is None or whiteish(best["color"]):
        return None
    return best["color"]


# ---------------------------------------------------------------------------
# rules


def edges(values: list[float], tol: float = EDGE) -> list[float]:
    out: list[float] = []
    for v in sorted(values):
        if out and v - out[-1] <= tol:
            continue
        out.append(v)
    return out


def nearest_rules(rules: list[tuple], ys: list[float], xs: list[float], header_rows: int) -> dict:
    """The `rules` preset nearest to the rules drawn round the cells: the one
    whose rules differ from the drawn ones at the fewest row and column
    edges (`distance`), with the look of the drawn rules."""
    span_x, span_y = (xs[0], xs[-1]), (ys[0], ys[-1])

    def found(axis: str, at: list[float], span: tuple) -> dict[int, list[tuple]]:
        hit: dict[int, list[tuple]] = {}
        for i, c in enumerate(at):
            mine = [r for r in rules if r[0] == axis and abs(r[1] - c) <= EDGE
                    and r[3] > span[0] - EDGE and r[2] < span[1] + EDGE]
            covered = sum(min(r[3], span[1]) - max(r[2], span[0]) for r in mine)
            if mine and covered >= 0.5 * (span[1] - span[0]):
                hit[i] = mine
        return hit

    H = found("h", ys, span_x)
    V = found("v", xs, span_y)
    R, C = len(ys) - 1, len(xs) - 1
    head = {0, header_rows, R} if 0 < header_rows < R else {0, R}
    expected = {"grid": (set(range(R + 1)), set(range(C + 1))), "horizontal": (set(range(R + 1)), set()),
                "outer": ({0, R}, {0, C}), "none": (set(), set()), "booktabs": (head, set())}

    def thick(i: int) -> float:
        return max(r[4] for r in H[i]) if i in H else 0.0

    heavy = 0 < header_rows < R and header_rows in H and min(thick(0), thick(R)) > 1.2 * thick(header_rows)
    order = ("booktabs", "horizontal", "grid", "outer", "none") if heavy else \
        ("horizontal", "grid", "outer", "booktabs", "none")
    got_h, got_v = set(H), set(V)

    def dist(p: str) -> int:
        return len(got_h ^ expected[p][0]) + len(got_v ^ expected[p][1])

    best = min(order, key=lambda p: (dist(p), order.index(p)))
    out: dict = {"rules": best, "distance": dist(best)}
    drawn = [r for rs in list(H.values()) + list(V.values()) for r in rs]
    if drawn and best != "none":
        cols: dict[str, int] = {}
        for r in drawn:
            cols[r[5]] = cols.get(r[5], 0) + 1
        out["borderColor"] = max(cols, key=cols.get)
        ws = sorted(r[4] for r in drawn)
        out["borderWidth"] = round(ws[len(ws) // 2], 2)
        if best == "booktabs":
            out["heavyRuleWidth"] = round(max(thick(0), thick(R)), 2)
            if 0 < header_rows < R and header_rows in H:
                out["lightRuleWidth"] = round(thick(header_rows), 2)
    return out


# ---------------------------------------------------------------------------
# the model


def table_model(table, header_rows: int, page=None, cache: dict | None = None) -> dict:
    """The TableModel of a table PyMuPDF found. With `page`, the cells carry
    the source's look (`dress_cells`) and the model the keys `_style` (a
    table style hint) and `_notes`, for the caller to pop."""
    grid = table.extract()
    rows = []
    for row_index, row in enumerate(grid):
        cells = []
        for value in row:
            cell: dict = {"content": clean(value)}
            if row_index < header_rows:
                cell["isHeader"] = True
            cells.append(cell)
        rows.append(cells)
    style: dict = {}
    notes: list[str] = []
    if page is not None:
        cache = cache if cache is not None else {}
        if "lines" not in cache:
            cache["lines"] = page_lines(page)
            cache["fills"], cache["rules"] = page_paint(page)
        style, notes = dress_cells(table, rows, header_rows, cache)
    # drop fully empty trailing rows that some detectors produce
    while rows and all(not c["content"] for c in rows[-1]):
        rows.pop()
    model: dict = {"rows": rows, "headerRowCount": header_rows}
    if page is not None:
        model["_style"], model["_notes"] = style, notes
    return model


def dress_cells(table, rows: list[list[dict]], header_rows: int, cache: dict) -> tuple[dict, list[str]]:
    """Write each cell's align, verticalAlign, bold and background; return
    the style hint (header bold, shared fills, nearest rules) and notes."""
    lines, fills, rules = cache["lines"], cache["fills"], cache["rules"]
    boxes = [[tuple(c) if c is not None else None for c in r.cells] for r in table.rows]

    def box_of(i: int, j: int) -> tuple | None:
        return boxes[i][j] if i < len(boxes) and j < len(boxes[i]) else None

    fill_of: dict[tuple[int, int], str] = {}
    header_bold: list[bool] = []
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            box = box_of(i, j)
            if box is None:
                continue
            col = cell_fill(box, fills)
            if col:
                fill_of[(i, j)] = col
            mine = [l for l in lines if box[0] - 0.5 <= (l["bbox"][0] + l["bbox"][2]) / 2 <= box[2] + 0.5
                    and box[1] - 0.5 <= (l["bbox"][1] + l["bbox"][3]) / 2 <= box[3] + 0.5]
            if not mine or not cell["content"]:
                continue
            extents = [(min(s["bbox"][0] for s in l["spans"]), max(s["bbox"][2] for s in l["spans"])) for l in mine]
            a = cell_align(extents, box)
            if a:
                cell["align"] = a
            v = cell_valign(min(l["bbox"][1] for l in mine), max(l["bbox"][3] for l in mine), box,
                            max(l["bbox"][3] - l["bbox"][1] for l in mine))
            if v:
                cell["verticalAlign"] = v
            bold = all(span_bold(s) for l in mine for s in l["spans"])
            if i < header_rows:
                header_bold.append(bold)     # the header's weight is the style's (headerBold)
            elif bold and "**" not in cell["content"]:
                cell["content"] = f"**{cell['content']}**"
    style: dict = {}
    notes: list[str] = []
    # a fill the whole header, or every body row, shares is the style's; the rest is the cells'
    head = [(i, j) for i in range(min(header_rows, len(rows))) for j in range(len(rows[i])) if box_of(i, j)]
    if head and len({fill_of.get(k) for k in head}) == 1 and fill_of.get(head[0]):
        style["headerBackgroundEnabled"] = True
        style["headerBackground"] = colour(fill_of[head[0]])
        for k in head:
            fill_of.pop(k, None)
    body = [i for i in range(header_rows, len(rows)) if any(c["content"] for c in rows[i])]

    def row_fill(i: int) -> str | None:
        cols = {fill_of.get((i, j)) for j in range(len(rows[i])) if box_of(i, j)}
        return next(iter(cols)) if len(cols) == 1 else "mixed"

    per_row = [row_fill(i) for i in body]
    shared = False
    if body and "mixed" not in per_row:
        if len(set(per_row)) == 1 and per_row[0]:
            style["bodyBackgroundEnabled"] = True
            style["bodyBackground"] = colour(per_row[0])
            shared = True
        elif len(body) >= 4 and len(set(per_row[0::2])) == 1 and len(set(per_row[1::2])) == 1 \
                and per_row[0] != per_row[1] and per_row[0] is None:
            style["bodyAlternateBackgroundEnabled"] = True
            style["bodyAlternateBackground"] = colour(per_row[1])
            shared = True
    if shared:
        for k in [k for k in fill_of if k[0] in body]:
            fill_of.pop(k)
    for (i, j), col in sorted(fill_of.items()):
        rows[i][j]["background"] = colour(col)
    if header_rows and header_bold:
        style["headerBold"] = all(header_bold)
    # rules: the cells' row and column edges, matched to a preset
    flat = [b for r in boxes for b in r if b]
    ys = edges([b[1] for b in flat] + [b[3] for b in flat])
    xs = edges([b[0] for b in flat] + [b[2] for b in flat])
    if len(ys) >= 2 and len(xs) >= 2:
        near = nearest_rules(rules, ys, xs, header_rows)
        style["rules"] = near["rules"]
        style["borders"] = near["rules"] != "none"
        if "borderColor" in near:
            style["borderColor"] = colour(near["borderColor"])
        for k in ("borderWidth", "heavyRuleWidth", "lightRuleWidth"):
            if k in near:
                style[k] = pt(near[k])
        if near["distance"]:
            notes.append(f"the rules drawn differ from `{near['rules']}` at {near['distance']} row or column "
                         "edge(s); Postext draws rules per table, never per cell")
    return style, notes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("pdf", help="reference PDF")
    parser.add_argument("--pages", metavar="SPEC", help="1-based page selection, e.g. 12 or 3-5 (default: all)")
    parser.add_argument("--header-rows", type=int, default=1, help="rows to mark as header (default: 1)")
    parser.add_argument(
        "--strategy", default="lines_strict", choices=["lines", "lines_strict", "text"],
        help="PyMuPDF find_tables strategy (default: lines_strict; use `text` for ruleless tables)",
    )
    parser.add_argument("--json-only", action="store_true", help="print one JSON array with all tables, nothing else")
    parser.add_argument("--full", action="store_true",
                        help="print one JSON array of {page, index, bbox, model, style, notes}")
    parser.add_argument("--plain", action="store_true", help="the cells' text only: no align, bold, fills or style")
    args = parser.parse_args(argv)

    try:
        import fitz  # PyMuPDF
    except ImportError:
        print("PyMuPDF is required:  python3 -m pip install pymupdf", file=sys.stderr)
        return 2

    doc = fitz.open(args.pdf)
    found: list[dict] = []
    try:
        for index in parse_pages(args.pages, doc.page_count):
            page = doc[index]
            if not hasattr(page, "find_tables"):
                print("this PyMuPDF build has no page.find_tables(); upgrade to >= 1.23", file=sys.stderr)
                return 2
            # PyMuPDF prints a package tip on stdout once: keep the JSON clean
            with contextlib.redirect_stdout(sys.stderr):
                tables = page.find_tables(strategy=args.strategy)
            cache: dict = {}
            for table_index, table in enumerate(tables.tables):
                model = table_model(table, args.header_rows, None if args.plain else page, cache)
                style, notes = model.pop("_style", {}), model.pop("_notes", [])
                if not model["rows"]:
                    continue
                found.append({
                    "page": index + 1,
                    "index": table_index,
                    "bbox": [round(v, 1) for v in table.bbox],
                    "model": model,
                    "style": style,
                    "notes": notes,
                })
    finally:
        doc.close()

    if args.json_only:
        print(json.dumps([f["model"] for f in found], indent=2, ensure_ascii=False))
        return 0
    if args.full:
        print(json.dumps(found, indent=2, ensure_ascii=False))
        return 0
    if not found:
        print("no tables found (try --strategy text)", file=sys.stderr)
        return 1
    for entry in found:
        rows = entry["model"]["rows"]
        cols = max((len(r) for r in rows), default=0)
        print(f"# page {entry['page']} table {entry['index']}: {len(rows)} rows x {cols} cols, bbox(pt)={entry['bbox']}")
        print(json.dumps(entry["model"], indent=2, ensure_ascii=False))
        if entry["style"]:
            print("# style hint, for the table's entry in tableStyles:")
            print(json.dumps(entry["style"], indent=2, ensure_ascii=False))
        for note in entry["notes"]:
            print(f"# note: {note}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
