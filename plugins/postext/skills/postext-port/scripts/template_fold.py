#!/usr/bin/env python3
"""Fold one-off frames of the page templates `pdf_regions.py extract` wrote
into grids and modules (round 2, references/composed-pages.md), so a port
is a page shell plus a library rather than one template per page.
`template_dedupe.py` runs it after the styles are merged; nothing here
reads a PDF: the measured boxes come from `regions.json` (millimetres on
the trim, the coordinates the templates' placements use).

- **Grids** (`fold_grids`). Frames of one look (kind, style, layer, the
  same width within --lattice-tol) standing on a lattice (tops make rows,
  starts make columns, one column gap, one row gap measured as the engine
  measures rows: the reach above the card plus the reach below its top,
  full rows but the last) become one `kind: "grid"` group that repeats the
  first card's set. Each card takes the frames that hang from it (a tab
  over a photo, a caption pill under it, a frame inside it) when every
  card has one of that kind hanging the same way: placed off the card's
  top-left (`top-left`, or `below` the card for one under it), or off its
  middle (`top`, `bottom`, width `auto` with the narrowest as `minWidth`)
  when the source centres members of different widths. The Sandbox's «Turn
  into a grid» (`templates/framesToGrid.ts`) is the model. Each page's
  pieces of those frames become one `:::frame{slot="<main>"}` item per
  card, in reading order, with the members' pieces inside it; every other
  reference (anchors, groups, connector ends, decoration) to a card or a
  member points at its instance (`#grid-picture[3]`).
- **Modules** (`plan_page_modules`). Every frame of a page goes into a
  module, so the page template is a shell: no frames, one modules group
  filling the page, the furniture (`mark_furniture`, `is_furniture`). The
  frames are joined into units (a box and what it holds, frames anchored to
  one another, a group's members, what a connector or a border reads, a
  chain, the flowing text with the frames taking its headings); units side
  by side are one band, and each band, top to bottom, is a module whose
  frames stand where the band stood, offset by its distance from the foot
  of the band before. The decoration that reads only a band's frames and
  what the page paints inside it go with it, the rest of the page's own
  decoration with the first module. Modules alike across the book (within
  --module-tol) are one module template; the page writes
  `:::module{template="…"}` blocks with the bands' pieces inside (the
  flowing text's module with the pieces that name no slot), so the content
  stays in the Markdown. «Extract a module» (`templates/moduleEdits.ts`) is
  the model. A band whose clusters stand side by side (`row_columns`) is a
  row of modules instead, laid by a modules group inside the stack
  (`nested_groups`: `within`, `templates`; a grid when rows in equal
  columns follow each other).
- **Looks** (`LookBook`). With style classes, cards whose styles differ
  only in colours stand on one lattice; each card that differs from the
  set's style names a look (`frameLooks`, `look=` on its piece).

Both keep a map of every frame's old name to the name the engine gives it
(`grid-picture[3]`, `box-picture[1].picture-2`), per page fence, for the
before/after comparison of the laid frame boxes.
"""
from __future__ import annotations

import copy
import re
from typing import Any

Box = tuple[float, float, float, float]  # x0, y0, x1, y1 (mm)


def mm(v: float) -> dict:
    return {"value": round(float(v), 2), "unit": "mm"}


def _mm_of(d: Any) -> float | None:
    if isinstance(d, dict) and isinstance(d.get("value"), (int, float)):
        u = d.get("unit")
        k = {"mm": 1.0, "cm": 10.0, "in": 25.4, "pt": 25.4 / 72, "px": 25.4 / 96}.get(u)
        return float(d["value"]) * k if k else None
    return None


def _target(placement: Any) -> str | None:
    a = (placement or {}).get("anchor") if isinstance(placement, dict) else None
    to = a.get("to") if isinstance(a, dict) else None
    return to[1:] if isinstance(to, str) and to.startswith("#") and len(to) > 1 else None


def _base(name: str) -> str:
    """`picture[3]` -> `picture`; `m[1].box` -> `m[1].box`."""
    return name[: name.index("[")] if name.endswith("]") and "[" in name else name


def _decoration(t: dict) -> list[dict]:
    d = t.get("decoration")
    return d.get("elements", []) if isinstance(d, dict) else []


def element_refs(el: dict) -> list[dict]:
    """The objects of a decoration element that name a frame or an element
    in their `to` (the anchor, sizes run to an edge, a connector's ends)."""
    out: list[dict] = []
    pl = el.get("placement") or {}
    if isinstance(pl.get("anchor"), dict) and "to" in pl["anchor"]:
        out.append(pl["anchor"])
    for v in (pl.get("size") or {}).values():
        if isinstance(v, dict) and "to" in v and "edge" in v:
            out.append(v)
    if el.get("kind") == "connector":
        ends = [el.get("from")] + (el["to"] if isinstance(el.get("to"), list) else [el.get("to")])
        out += [e for e in ends if isinstance(e, dict) and isinstance(e.get("to"), str)]
    return out


def _el_targets(el: dict) -> set[str]:
    out = set()
    for h in element_refs(el):
        to = h.get("to")
        if isinstance(to, str) and to.startswith("#"):
            out.add(_base(to[1:]))
    return out


def retarget(t: dict, rename: dict[str, str]) -> None:
    """Point every `#name` / `next` of template `t` at `rename[name]`. An
    instance of a grid's card (`#grid-picture[2]`, `[*]`) follows its set's
    name: a connector that ends on the second photo of a grid renamed in its
    module still ends on it."""
    def ref(v: Any) -> Any:
        if not isinstance(v, str) or not v.startswith("#"):
            return v
        if v[1:] in rename:
            return "#" + rename[v[1:]]
        base, bracket, rest = v[1:].partition("[")
        if bracket and rest.endswith("]") and base in rename:
            return "#" + rename[base] + "[" + rest
        return v

    for f in t.get("frames", []):
        a = (f.get("placement") or {}).get("anchor")
        if isinstance(a, dict) and "to" in a:
            a["to"] = ref(a["to"])
        for v in ((f.get("placement") or {}).get("size") or {}).values():
            if isinstance(v, dict) and "to" in v:
                v["to"] = ref(v["to"])
        if isinstance(f.get("next"), str) and f["next"] in rename:
            f["next"] = rename[f["next"]]
        ov = f.get("overflow")
        if isinstance(ov, dict) and isinstance(ov.get("continueIn"), str):
            ov["continueIn"] = ref(ov["continueIn"])
    for g in t.get("groups", []):
        a = (g.get("placement") or {}).get("anchor")
        if isinstance(a, dict) and "to" in a:
            a["to"] = ref(a["to"])
    for el in _decoration(t):
        for h in element_refs(el):
            h["to"] = ref(h["to"])


def _unique(base: str, taken: set[str]) -> str:
    n, k = base, 2
    while n in taken:
        n, k = f"{base}-{k}", k + 1
    taken.add(n)
    return n


def _group_members(g: dict) -> list[str]:
    if g.get("kind") == "grid" and isinstance(g.get("repeat"), dict):
        return list(g["repeat"].get("frames") or [])
    return list(g.get("frames") or [])


# ---------------------------------------------------------------------------
# Markdown pieces of a page fence
# ---------------------------------------------------------------------------

OPEN_RE = re.compile(r"^\s*(:{3,})([A-Za-z][\w-]*)(\{.*\})?\s*$")
CLOSE_RE = re.compile(r"^\s*(:{3,})\s*$")
LEAF_RE = re.compile(r"^\s*::[A-Za-z][\w-]*\{")
HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s")
SLOT_RE = re.compile(r'(?<=[\s{])slot="([^"]*)"')
TEMPLATE_RE = re.compile(r'(?<=[\s{])template="([^"]*)"')
CODE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")


class Piece:
    """One top-level block of a page fence's body: a container (`:::frame`,
    `:::figure`, `:::module`) from its opener to its closer, or one line."""

    def __init__(self, start: int, end: int, lines: list[str]):
        self.start, self.end = start, end  # line indices, end exclusive
        self.lines = lines

    @property
    def head(self) -> str:
        return self.lines[0]

    @property
    def slot(self) -> str | None:
        m = SLOT_RE.search(self.head) if _slotted(self.head) else None
        return m.group(1) if m else None

    @property
    def container(self) -> bool:
        return bool(OPEN_RE.match(self.head)) and len(self.lines) > 1

    @property
    def kind(self) -> str | None:
        m = OPEN_RE.match(self.head)
        return m.group(2) if m else None


def _slotted(line: str) -> bool:
    """A line whose `slot="…"` sends a piece to a frame: a container or leaf
    directive, or a heading with attributes."""
    return bool(OPEN_RE.match(line) or LEAF_RE.match(line) or HEADING_RE.match(line))


def page_fences(lines: list[str]) -> list[dict]:
    """Every `::::page{template}` fence: its line range and template."""
    out = []
    i, code = 0, None
    while i < len(lines):
        line = lines[i]
        cm = CODE_RE.match(line)
        if cm:
            code = None if code and cm.group(1)[0] == code[0] else (code or cm.group(1))
            i += 1
            continue
        m = OPEN_RE.match(line)
        if code is None and m and m.group(2) == "page" and len(m.group(1)) >= 4:
            colons = len(m.group(1))
            tm = TEMPLATE_RE.search(m.group(3) or "")
            depth, j = [colons], i + 1
            while j < len(lines) and depth:
                om, cl = OPEN_RE.match(lines[j]), CLOSE_RE.match(lines[j])
                if om:
                    depth.append(len(om.group(1)))
                elif cl:
                    n = len(cl.group(1))
                    while depth and depth[-1] > n:
                        depth.pop()
                    if depth:
                        depth.pop()
                j += 1
            out.append({"start": i, "end": j, "template": tm.group(1) if tm else None})
            i = j
            continue
        i += 1
    return out


def pieces_of(lines: list[str], fence: dict) -> list[Piece]:
    """The top-level pieces of a fence's body (blank lines are not pieces)."""
    out: list[Piece] = []
    i, end = fence["start"] + 1, fence["end"] - 1
    while i < end:
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        om = OPEN_RE.match(line)
        if om:
            depth, j = [len(om.group(1))], i + 1
            while j < end and depth:
                o2, cl = OPEN_RE.match(lines[j]), CLOSE_RE.match(lines[j])
                if o2:
                    depth.append(len(o2.group(1)))
                elif cl:
                    n = len(cl.group(1))
                    while depth and depth[-1] > n:
                        depth.pop()
                    if depth:
                        depth.pop()
                j += 1
            out.append(Piece(i, j, lines[i:j]))
            i = j
            continue
        # a paragraph or a list: up to the next blank line or block opener
        j = i + 1
        while (j < end and lines[j].strip() and not OPEN_RE.match(lines[j]) and not LEAF_RE.match(lines[j])
               and not HEADING_RE.match(lines[j]) and not HEADING_RE.match(lines[i])):
            j += 1
        out.append(Piece(i, j, lines[i:j]))
        i = j
    return out


def _set_slot(line: str, name: str | None) -> str:
    """The line with its `slot="…"` set to `name` (removed when None)."""
    if name is None:
        return re.sub(r'\s+slot="[^"]*"', "", line).replace("{ ", "{")
    return SLOT_RE.sub(f'slot="{name}"', line, count=1)


def set_attr(line: str, key: str, value: str) -> str:
    """The directive line with `key="value"` in its first `{…}` (replaced
    when it is there already)."""
    pat = re.compile(r'(?<=[\s{])' + re.escape(key) + r'="[^"]*"')
    if pat.search(line):
        return pat.sub(f'{key}="{value}"', line, count=1)
    i = line.find("}")
    if i < 0:
        return line
    sep = "" if line[i - 1] == "{" else " "
    return line[:i] + f'{sep}{key}="{value}"' + line[i:]


def _rename_slots(lines: list[str], names: dict[str, str]) -> list[str]:
    out = []
    for line in lines:
        if _slotted(line) and "slot=" in line:
            line = SLOT_RE.sub(lambda m: f'slot="{names.get(m.group(1), m.group(1))}"', line)
        out.append(line)
    return out


def _replace(lines: list[str], fence: dict, drop: list[Piece], insert_at: int, text: list[str]) -> list[str]:
    """Lines of the document with `drop` pieces removed and `text` put
    where line `insert_at` stood (blank lines around kept single)."""
    gone = set()
    for p in drop:
        gone.update(range(p.start, p.end))
    out: list[str] = []
    for i, line in enumerate(lines):
        if i == insert_at:
            if out and out[-1].strip():
                out.append("")
            out.extend(text)
            out.append("")
        if i in gone:
            continue
        if not line.strip() and out and not out[-1].strip() and fence["start"] < i < fence["end"]:
            continue
        out.append(line)
    return out


# ---------------------------------------------------------------------------
# grids
# ---------------------------------------------------------------------------

def _w(b: Box) -> float:
    return b[2] - b[0]


def _cx(b: Box) -> float:
    return (b[0] + b[2]) / 2


def _hangs(g: Box, m: Box, tol: float, reach: float) -> str | None:
    """How box `g` hangs from box `m`: 'inside', 'above', 'below' or None."""
    if g[0] >= m[0] - tol and g[2] <= m[2] + tol and g[1] >= m[1] - tol and g[3] <= m[3] + tol:
        return "inside"
    if not (m[0] - tol <= _cx(g) <= m[2] + tol):
        return None
    if g[3] <= m[1] + tol and m[1] - g[3] <= reach:
        return "above"
    if g[1] >= m[3] - tol and g[1] - m[3] <= reach:
        return "below"
    return None


def _look(f: dict, kind: str, classes: dict[str, str] | None = None) -> tuple:
    """What makes two frames the same card: kind, style (or the style's
    class, colours left out, when `classes` maps it: #1089), layer, turn."""
    st = f.get("style")
    if classes and isinstance(st, str):
        st = classes.get(st, st)
    return (kind, st, f.get("layer", 1), f.get("rotate", 0), bool(f.get("optional")))


def find_lattices(t: dict, rects: dict[str, Box], kinds: dict[str, str], tol: float = 1.0,
                  reach: float = 8.0, min_cells: int = 3, classes: dict[str, str] | None = None) -> list[dict]:
    """The lattices of template `t`: [{cells: [(main, {member kind: name})],
    columns, rows, colGap, rowGap, memberRule: {kind: rule}}], largest
    first, no frame in two. `min_cells` is the least number of cards
    without members (cards with members: 2). `reach` is how far (mm) a
    member may stand off its card. With `classes` (style id -> class),
    frames whose styles differ only in colours are of one look; the grid
    then gives each card that differs a named look (#1089)."""
    frames = [f for f in t.get("frames", []) if f["name"] in rects and not f.get("flow") and not f.get("takes")
              and not f.get("grid") and not f.get("remove")]
    in_grid = {n for g in t.get("groups", []) if g.get("kind") == "grid" for n in _group_members(g)}
    frames = [f for f in frames if f["name"] not in in_grid]
    by = {f["name"]: f for f in frames}
    looks: dict[tuple, list[str]] = {}
    for f in frames:
        looks.setdefault(_look(f, kinds.get(f["name"], "box"), classes), []).append(f["name"])
    found: list[dict] = []
    for names in sorted(looks.values(), key=len, reverse=True):
        if len(names) < 2:
            continue
        # cards of one width
        names = sorted(names, key=lambda n: _w(rects[n]))
        runs, run = [], [names[0]]
        for n in names[1:]:
            if _w(rects[n]) - _w(rects[run[0]]) <= tol:
                run.append(n)
            else:
                runs.append(run)
                run = [n]
        runs.append(run)
        for mains in runs:
            got = _lattice(mains, by, rects, kinds, tol, reach, classes)
            if got and (len(got["cells"]) >= min_cells or (got["memberRule"] and len(got["cells"]) >= 2)):
                found.append(got)
    found.sort(key=lambda g: -len(g["cells"]) * (1 + len(g["memberRule"])))
    used: set[str] = set()
    out = []
    for g in found:
        names = {g_ for c in g["cells"] for g_ in [c[0], *c[1].values()]}
        if names & used:
            continue
        used |= names
        out.append(g)
    return out


def _lattice(mains: list[str], by: dict[str, dict], rects: dict[str, Box], kinds: dict[str, str],
             tol: float, reach: float, classes: dict[str, str] | None = None) -> dict | None:
    mset = set(mains)
    # rows by tops, columns by starts
    order = sorted(mains, key=lambda n: (rects[n][1], rects[n][0]))
    rows: list[list[str]] = []
    for n in order:
        if rows and abs(rects[rows[-1][0]][1] - rects[n][1]) <= tol:
            rows[-1].append(n)
        else:
            rows.append([n])
    for r in rows:
        r.sort(key=lambda n: rects[n][0])
    cols = len(rows[0])
    if len(rows) == 1 and cols < 2:
        return None
    if any(len(r) != cols for r in rows[:-1]) or len(rows[-1]) > cols:
        return None
    xs = [rects[n][0] for n in rows[0]]
    if any(abs(rects[n][0] - xs[k]) > tol for r in rows for k, n in enumerate(r)):
        return None
    width = sum(_w(rects[n]) for n in mains) / len(mains)
    gaps = [xs[k + 1] - xs[k] - width for k in range(cols - 1)]
    col_gap = sum(gaps) / len(gaps) if gaps else 0.0
    if any(abs(g - col_gap) > tol for g in gaps) or col_gap < -tol:
        return None
    cells = [n for r in rows for n in r]
    # members: frames hanging from a card, one per kind in every card
    hang: dict[str, dict[tuple, str]] = {n: {} for n in cells}
    hanging: set[str] = set()
    # a frame between two rows of cards hangs under one and over the next:
    # it takes the way most frames of its look hang (a pill over every photo)
    cands: dict[str, list[tuple[float, str, str]]] = {}
    ways: dict[tuple, int] = {}
    for name, f in by.items():
        if name in mset:
            continue
        for m in cells:
            how = _hangs(rects[name], rects[m], tol, reach)
            if how:
                cands.setdefault(name, []).append((abs(_cx(rects[name]) - _cx(rects[m])), m, how))
        for how in {c[2] for c in cands.get(name, [])}:
            k = (how,) + _look(f, kinds.get(name, "box"), classes)
            ways[k] = ways.get(k, 0) + 1
    for name, f in by.items():
        if name not in cands:
            continue
        look = _look(f, kinds.get(name, "box"), classes)
        best = min(cands[name], key=lambda c: (-ways.get((c[2],) + look, 0), c[0]))
        if best:
            hanging.add(name)
            key = (best[2],) + _look(f, kinds.get(name, "box"), classes)
            if key in hang[best[1]]:
                hang[best[1]][key] = ""          # two of a kind: not a member
            else:
                hang[best[1]][key] = name
    common = set.intersection(*(set(k for k, v in hang[c].items() if v) for c in cells))
    rules: dict[tuple, dict] = {}
    for key in sorted(common, key=str):
        how = key[0]
        mem = [hang[c][key] for c in cells]
        dx = [rects[g][0] - rects[c][0] for g, c in zip(mem, cells)]
        dcx = [_cx(rects[g]) - _cx(rects[c]) for g, c in zip(mem, cells)]
        if how == "below":
            dy = [rects[g][1] - rects[c][3] for g, c in zip(mem, cells)]
        else:
            dy = [rects[g][1] - rects[c][1] for g, c in zip(mem, cells)]
        ws = [_w(rects[g]) for g in mem]
        if max(dy) - min(dy) > tol:
            continue
        if max(ws) - min(ws) <= tol and max(dx) - min(dx) <= tol:
            rules[key] = {"how": how, "centred": False, "dx": dx[0], "dy": dy[0], "minWidth": None}
        elif max(dcx) - min(dcx) <= tol and kinds.get(mem[0], "box") not in ("picture", "figure"):
            # (words as wide as they are: a picture has no such width)
            rules[key] = {"how": how, "centred": True, "dx": sum(dcx) / len(dcx), "dy": dy[0],
                          "minWidth": min(ws), "maxWidth": max(ws)}
    # row extents as the engine measures a row: reach above the card, below its top
    def extent(c: str) -> tuple[float, float]:
        rs = [rects[c]] + [rects[hang[c][k]] for k in rules]
        return rects[c][1] - min(r[1] for r in rs), max(r[3] for r in rs) - rects[c][1]

    boxes = []
    for r in rows:
        top = rects[r[0]][1]
        above = max(extent(c)[0] for c in r)
        below = max(extent(c)[1] for c in r)
        boxes.append((top - above, above + below, above))
    rgaps = [boxes[k + 1][0] - (boxes[k][0] + boxes[k][1]) for k in range(len(boxes) - 1)]
    row_gap = sum(rgaps) / len(rgaps) if rgaps else max(col_gap, 0.0)
    if any(abs(g - row_gap) > tol for g in rgaps):
        return None
    # one height rule for every card: cards the source holds to heights of
    # their own (minHeight) that differ are no lattice
    laid_h = [rects[c][3] - rects[c][1] for c in cells]
    for key in ("minHeight", "maxHeight", "height"):
        vals = [by[c].get(key) for c in cells]
        if all(v is None for v in vals):
            continue
        hs = [_mm_of(v) for v in vals]
        if None in hs:
            if any(v != vals[0] for v in vals):
                return None
            continue
        if max(hs) - min(hs) > tol and max(laid_h) - min(laid_h) > tol:  # type: ignore[type-var,operator]
            return None
    # nothing else stands among the cards (two boxes far apart with others
    # between them are no lattice)
    taken_names = set(cells) | {hang[c][k] for c in cells for k in rules}
    x0 = min(rects[n][0] for n in taken_names)
    y0 = min(rects[n][1] for n in taken_names)
    x1 = max(rects[n][2] for n in taken_names)
    y1 = max(rects[n][3] for n in taken_names)
    layer = by[cells[0]].get("layer", 1)
    for name, f in by.items():
        if name in taken_names or name in hanging or f.get("layer", 1) < layer:
            continue
        b = rects[name]
        if x0 < _cx(b) < x1 and y0 < (b[1] + b[3]) / 2 < y1:
            return None
    return {"cells": [(c, {k: hang[c][k] for k in rules}) for c in cells], "columns": cols, "rows": len(rows),
            "width": width, "colGap": max(0.0, col_gap), "rowGap": max(0.0, row_gap), "memberRule": rules,
            "box": (rects[cells[0]][0], boxes[0][0], rects[cells[0]][0] + cols * width + (cols - 1) * max(0.0, col_gap))}


TOP_LEFT_EDGES = {"below", "right-of", "align-top", "align-left", "top-left"}


def placement_like(f: dict, at: tuple[float, float], frame_box: Box, own: set[str]) -> dict:
    """Where a box whose top-left is `at` goes: `f`'s own anchor with the
    offset shifted, when `f` hangs from a frame outside `own` (or the
    area's top-left) by its top-left; else the area's top-left at `at`."""
    p = f.get("placement") or {}
    a = p.get("anchor") or {}
    to = a.get("to")
    off = p.get("offset") or {}
    ox, oy = (_mm_of(off.get("x")) if off.get("x") else 0.0), (_mm_of(off.get("y")) if off.get("y") else 0.0)
    ok = (isinstance(to, str) and a.get("edge") in TOP_LEFT_EDGES and ox is not None and oy is not None
          and (to[1:] not in own if to.startswith("#") else (to == "container" and a.get("edge") == "top-left")))
    if ok:
        return {"anchor": dict(a), "offset": {"x": mm(ox + at[0] - frame_box[0]), "y": mm(oy + at[1] - frame_box[1])}}
    return {"anchor": {"to": "container", "edge": "top-left"}, "offset": {"x": mm(at[0]), "y": mm(at[1])}}


def _set_name(kind: str, taken: set[str], prefix: str) -> str:
    return _unique(f"{prefix}-{kind}", taken)


def apply_grid(t: dict, lat: dict, rects: dict[str, Box], kinds: dict[str, str], taken: set[str],
               looks: "LookBook | None" = None) -> dict:
    """Turn lattice `lat` of template `t` into a grid (in place). Returns
    {group, main, members: {key: name}, instances: {old: instance}, order,
    looks: [{set frame: look id}] per card}. With `looks`, a set frame
    takes the style most cards have, and each card whose style differs from
    it in colours only names a look (`looks.id_for`)."""
    cells = lat["cells"]
    by = {f["name"]: f for f in t["frames"]}
    first, first_members = cells[0]
    group = _unique("grid", taken)
    main = _set_name(kinds.get(first, "box"), taken, group)
    members: dict[tuple, str] = {}
    for key, rule in lat["memberRule"].items():
        members[key] = _set_name(kinds.get(first_members[key], "box"), taken, group)
    # one style per set frame, a named look for each card that differs
    card_looks: list[dict[str, str]] = [{} for _ in cells]
    shared: dict[str, Any] = {}
    slots = [(main, [c for c, _ in cells])] + [(members[k], [ms[k] for _, ms in cells]) for k in members]
    for set_name, names in slots:
        styles = [by[n].get("style") for n in names]
        counts: dict[Any, int] = {}
        for st in styles:
            counts[st] = counts.get(st, 0) + 1
        common = max(counts, key=lambda st: (counts[st], -styles.index(st)))
        shared[set_name] = common
        if looks is None or len(counts) == 1:
            continue
        for k, st in enumerate(styles):
            if st == common:
                continue
            look = looks.look_between(common, st)
            if look:
                card_looks[k][set_name] = looks.id_for(look)
    # the set's frames
    mf = copy.deepcopy(by[first])
    mf["name"] = main
    if shared.get(main):
        mf["style"] = shared[main]
    for k in ("placement", "width", "grid"):
        mf.pop(k, None)
    mins = [_mm_of(by[c].get("minHeight")) for c, _ in cells]
    if all(v is not None for v in mins) and mins:
        laid_h = [rects[c][3] - rects[c][1] for c, _ in cells]
        # cards laid alike are held to the height they were laid at
        mf["minHeight"] = mm(min(laid_h) if max(mins) - min(mins) > 0.05 else min(mins))  # type: ignore[type-var]
    maxs = [_mm_of(by[c].get("maxHeight")) for c, _ in cells]
    if all(v is not None for v in maxs) and maxs:
        mf["maxHeight"] = mm(max(maxs))  # type: ignore[arg-type]
    set_frames = [mf]
    for key, name in members.items():
        rule = lat["memberRule"][key]
        g = copy.deepcopy(by[first_members[key]])
        g["name"] = name
        g.pop("grid", None)
        if shared.get(name):
            g["style"] = shared[name]
        if rule["centred"]:
            edge = "bottom" if rule["how"] == "below" else "top"
            dy = rule["dy"]
            if rule["how"] == "below":
                # the member's foot from the card's foot (pinned by its end)
                h = rects[first_members[key]][3] - rects[first_members[key]][1]
                dy = rule["dy"] + h
            g["placement"] = {"anchor": {"to": f"#{main}", "edge": edge}, "offset": {"x": mm(rule["dx"]), "y": mm(dy)}}
            g["width"] = "auto"
            g["minWidth"] = mm(rule["minWidth"])
            if rule.get("maxWidth"):
                g["maxWidth"] = mm(rule["maxWidth"] + 0.5)
        else:
            edge = "below" if rule["how"] == "below" else "top-left"
            g["placement"] = {"anchor": {"to": f"#{main}", "edge": edge}, "offset": {"x": mm(rule["dx"]), "y": mm(rule["dy"])}}
        set_frames.append(g)
    old_set = {n for c, ms in cells for n in [c, *ms.values()]}
    # the grid's box: the first row's reach, from the first card's start
    x0, y0, x1 = lat["box"]
    top_frame = min([first, *first_members.values()], key=lambda n: (rects[n][1], rects[n][0]))
    dropped = {g["name"] for g in t.get("groups", []) if g.get("kind") != "grid" and g.get("frames")
               and set(g["frames"]) <= old_set}
    placement = placement_like(by[top_frame], (x0, y0), rects[top_frame], old_set | dropped)
    placement["size"] = {"width": mm(x1 - x0), "height": "fill"}
    grid = {"name": group, "kind": "grid", "columns": lat["columns"], "columnGap": mm(lat["colGap"]),
            "rowGap": mm(lat["rowGap"]), "rowAlign": "start",
            "repeat": {"frames": [main, *members.values()]}, "placement": placement}
    # instances
    instances: dict[str, str] = {}
    for k, (c, ms) in enumerate(cells, start=1):
        instances[c] = f"{main}[{k}]"
        for key, n in ms.items():
            instances[n] = f"{members[key]}[{k}]"
    last_row = [c for c, _ in cells[(lat["rows"] - 1) * lat["columns"]:]]
    low = max(last_row, key=lambda c: max([rects[c][3]] + [rects[n][3] for n in dict(cells)[c].values()]))
    first_index = min(i for i, f in enumerate(t["frames"]) if f["name"] in old_set)
    frames = []
    for i, f in enumerate(t["frames"]):
        if i == first_index:
            frames.extend(set_frames)
        if f["name"] not in old_set:
            frames.append(f)
    t["frames"] = frames
    groups = []
    gone: dict[str, str] = {}
    for g in t.get("groups", []):
        if g.get("kind") != "grid" and any(n in old_set for n in g.get("frames") or []):
            g = {**g, "frames": [n for n in g["frames"] if n not in old_set]}
            if not g["frames"]:
                # what hung from it (`below` a row of cards) hangs from the
                # lowest card of the grid's last row
                gone[g["name"]] = instances[low]
                continue
        groups.append(g)
    t["groups"] = groups + [grid]
    retarget(t, {**gone, **instances})
    # a stack or row of one frame lays it as it was: drop empty ones only
    return {"group": group, "main": main, "members": list(members.values()),
            "memberOf": {key: members[key] for key in members}, "instances": instances,
            "cells": [(c, dict(ms)) for c, ms in cells], "columns": lat["columns"], "rows": lat["rows"],
            "columnGap": round(lat["colGap"], 2), "rowGap": round(lat["rowGap"], 2), "looks": card_looks}


def grid_items_markdown(lines: list[str], fence: dict, plan: dict) -> list[str]:
    """The document with the fence's pieces of the grid's frames turned into
    items, one per card, where the first of them stood."""
    pieces = pieces_of(lines, fence)
    by_slot: dict[str, Piece] = {}
    for p in pieces:
        if p.slot and p.slot not in by_slot:
            by_slot[p.slot] = p
    used: list[Piece] = []
    items: list[str] = []
    last = -1
    card_looks = plan.get("looks") or [{} for _ in plan["cells"]]
    for k, (card, ms) in enumerate(plan["cells"]):
        own = by_slot.get(card)
        looked = card_looks[k] if k < len(card_looks) else {}
        main_look = looked.get(plan["main"])
        inner: list[str] = []
        for key, name in ms.items():
            p = by_slot.get(name)
            if p:
                used.append(p)
                member = plan["memberOf"][key]
                look = looked.get(member)
                if look and not (p.kind == "frame" and p.container):
                    # a block that names the member: wrapped, so the look has a piece to sit on
                    inner += ([f':::frame{{slot="{member}" look="{look}"}}', _set_slot(p.head, None)]
                              + p.lines[1:] + [":::", ""])
                    continue
                head = _rename_slots(p.lines[:1], {name: member})
                if look:
                    head = [set_attr(head[0], "look", look)]
                inner += head + p.lines[1:] + [""]
        if own:
            used.append(own)
        if own or inner:
            last = k
        if own and own.kind == "frame" and own.container:
            head = _set_slot(own.head, plan["main"])
            body = [set_attr(head, "look", main_look) if main_look else head] + own.lines[1:-1]
            if inner:
                if body[-1].strip():
                    body.append("")
                body += inner[:-1]
            items.append("\n".join(body + [own.lines[-1]]))
        elif own and not inner and not main_look and own.kind is None and LEAF_RE.match(own.head):
            items.append("\n".join([_set_slot(own.head, plan["main"])] + own.lines[1:]))
        else:
            look_attr = f' look="{main_look}"' if main_look else ""
            body = [f':::frame{{slot="{plan["main"]}"{look_attr}}}']
            if own:
                body += [_set_slot(own.head, None)] + own.lines[1:] + [""]
            body += inner
            if body[-1] == "":
                body.pop()
            items.append("\n".join(body + [":::"]))
    if not used:
        return lines
    text = "\n\n".join(items[: last + 1]).split("\n")
    at = min(p.start for p in used)
    return _replace(lines, fence, used, at, text)


class LookBook:
    """The named looks (`frameLooks`, #1089) a fold gives the cards of a
    grid whose styles differ from the set's only in colours. `classes` maps
    a style id to its class (its colour-free form): frames of one class are
    one look for the lattice. `between(a, b)` is the look that dresses style
    `a` as style `b` ({} when alike, None when they differ in more than
    colours); `name(look)` a readable base for its id."""

    def __init__(self, classes: dict[str, str], between, name, taken: set[str] | None = None):
        self.classes = classes
        self.between = between
        self.name = name
        self.entries: list[dict] = []
        self.taken = set(taken or ())

    def look_between(self, a: Any, b: Any) -> dict | None:
        if not isinstance(a, str) or not isinstance(b, str):
            return None
        return self.between(a, b) or None

    def id_for(self, look: dict) -> str:
        for e in self.entries:
            if {k: v for k, v in e.items() if k != "id"} == look:
                return e["id"]
        lid = _unique(f"look-{self.name(look)}", self.taken)
        self.entries.append({"id": lid, **look})
        return lid


def fold_grids(t: dict, rects: dict[str, Box], kinds: dict[str, str], tol: float, min_cells: int = 3,
               looks: LookBook | None = None, reach: float = 8.0) -> list[dict]:
    taken = {f["name"] for f in t.get("frames", [])} | {g["name"] for g in t.get("groups", [])}
    plans = []
    for lat in find_lattices(t, rects, kinds, tol, reach=reach, min_cells=min_cells,
                             classes=looks.classes if looks else None):
        plan = apply_grid(t, lat, rects, kinds, taken, looks)
        # the set's boxes, by instance, for the module pass after this
        for old, inst in plan["instances"].items():
            rects[inst] = rects[old]
            kinds[inst] = kinds.get(old, "box")
        plans.append(plan)
    return plans


# ---------------------------------------------------------------------------
# modules
# ---------------------------------------------------------------------------

class _Union:
    def __init__(self, names):
        self.p = {n: n for n in names}

    def find(self, n):
        while self.p[n] != n:
            self.p[n] = self.p[self.p[n]]
            n = self.p[n]
        return n

    def join(self, a, b):
        if a in self.p and b in self.p:
            self.p[self.find(a)] = self.find(b)


def _frame_box(t: dict, rects: dict[str, Box], name: str) -> Box | None:
    if name in rects:
        return rects[name]
    insts = [r for n, r in rects.items() if _base(n) == name and n != name]
    if not insts:
        return None
    return (min(r[0] for r in insts), min(r[1] for r in insts), max(r[2] for r in insts), max(r[3] for r in insts))


def bands_of(t: dict, rects: dict[str, Box], parents: dict[str, str | None]) -> list[dict] | None:
    """Every frame of template `t` in bands, top to bottom: [{frames,
    groups, box}]. Frames are joined into units (containment, anchors to a
    frame or a group, a group's members, a connector's ends, a `next` or
    `continueIn: '#x'` chain); units whose boxes overlap down the page are
    one band. None when a frame has no box."""
    frames = [f for f in t.get("frames", []) if not f.get("remove")]
    names = [f["name"] for f in frames]
    u = _Union(names)
    groups = t.get("groups", [])
    gnames = {g["name"]: _group_members(g) for g in groups}

    def first_of(n: str | None) -> str | None:
        if n in gnames:
            ms = [m for m in gnames[n] if m in u.p]
            return ms[0] if ms else None
        return n if n in u.p else None

    for g in groups:
        ms = [m for m in _group_members(g) if m in u.p]
        for m in ms[1:]:
            u.join(ms[0], m)
        tgt = first_of(_target(g.get("placement")))
        if ms and tgt:
            u.join(ms[0], tgt)
    for f in frames:
        tgt = first_of(_target(f.get("placement")))
        if tgt:
            u.join(f["name"], tgt)
        par = parents.get(f["name"])
        if par in u.p:
            u.join(f["name"], par)
        if isinstance(f.get("next"), str) and f["next"] in u.p:
            u.join(f["name"], f["next"])
        ov = f.get("overflow") or {}
        ci = ov.get("continueIn") if isinstance(ov, dict) else None
        if isinstance(ci, str) and ci.startswith("#") and ci[1:] in u.p:
            u.join(f["name"], ci[1:])
    # what an element reads (through the elements it reads: a border sized
    # to a helper anchored to another frame) is one unit
    els = {str(e.get("id")): e for e in _decoration(t)}

    def frames_read(el: dict, seen: set[str]) -> set[str]:
        out = set()
        for n in _el_targets(el):
            if n in els and n not in seen:
                seen.add(n)
                out |= frames_read(els[n], seen)
            elif first_of(n):
                out.add(first_of(n))  # type: ignore[arg-type]
        return out

    for el in els.values():
        ends = sorted(frames_read(el, {str(el.get("id"))}))
        for e in ends[1:]:
            u.join(ends[0], e)
    # the flowing text and the frames that take its headings: one module
    # takes the page's pieces that name no slot
    opener = [f["name"] for f in frames if f.get("flow") or f.get("takes")]
    for n in opener[1:]:
        u.join(opener[0], n)
    units: dict[str, list[str]] = {}
    for n in names:
        units.setdefault(u.find(n), []).append(n)
    boxed = []
    for ms in units.values():
        bs = [b for b in (_frame_box(t, rects, m) for m in ms) if b]
        if len(bs) != len(ms):
            return None
        boxed.append((ms, (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))))
    if not boxed:
        return None
    # side by side: one band
    boxed.sort(key=lambda x: x[1][1])
    bands: list[dict] = []
    for ms, b in boxed:
        if bands and b[1] < bands[-1]["box"][3] - 0.5:
            last = bands[-1]
            last["frames"] += ms
            last["units"].append((list(ms), b))
            lb = last["box"]
            last["box"] = (min(lb[0], b[0]), min(lb[1], b[1]), max(lb[2], b[2]), max(lb[3], b[3]))
        else:
            bands.append({"frames": list(ms), "box": b, "units": [(list(ms), b)]})
    order = {n: i for i, n in enumerate(names)}
    by = {f["name"]: f for f in frames}
    for band in bands:
        band["frames"].sort(key=lambda n: order[n])
        fs = set(band["frames"])
        band["groups"] = [g["name"] for g in groups if _group_members(g) and set(_group_members(g)) <= fs]
        band["flow"] = any(by[n].get("flow") or by[n].get("takes") for n in band["frames"])
    return bands


def module_of_band(t: dict, band: dict, rects: dict[str, Box], kinds: dict[str, str], gx: float, top: float,
                   lead: float, taken: frozenset[str] = frozenset(),
                   extra: frozenset[str] = frozenset()) -> tuple[dict, dict[str, str], dict[str, str]]:
    """(module template without id, frame name on the page -> name in the
    module, element id -> id in the module). Frames are named by kind and
    order in the module (`box-1`, `picture-2`); a grid's set and groups by
    order (`grid`, `stack-1`)."""
    by = {f["name"]: f for f in t["frames"]}
    fs = set(band["frames"])
    gs = set(band["groups"])
    inside = fs | gs
    # names in the module
    names: dict[str, str] = {}
    count: dict[str, int] = {}
    grids = [g for g in t.get("groups", []) if g["name"] in gs and g.get("kind") == "grid"]
    set_of = {m: g for g in grids for m in _group_members(g)}
    for n in band["frames"]:
        if n in set_of:
            continue
        k = kinds.get(n, "box")
        count[k] = count.get(k, 0) + 1
        names[n] = f"{k}-{count[k]}"
    for gi, g in enumerate(grids, start=1):
        gname = "grid" if gi == 1 else f"grid-{gi}"
        names[g["name"]] = gname
        for m in _group_members(g):
            names[m] = f"{gname}-{kinds.get(m + '[1]', kinds.get(m, 'box'))}"
            while list(names.values()).count(names[m]) > 1:
                names[m] += "-2"
    gcount: dict[str, int] = {}
    for g in t.get("groups", []):
        if g["name"] in gs and g.get("kind") != "grid":
            k = g.get("kind") or "stack"
            gcount[k] = gcount.get(k, 0) + 1
            names[g["name"]] = f"{k}-{gcount[k]}"
    in_groups = {m for g in t.get("groups", []) for m in _group_members(g)}
    has_pictures = sum(1 for n in band["frames"]) > 1 and any(
        kinds.get(n, kinds.get(n + "[1]", "box")) in ("picture", "figure") for n in band["frames"])
    frames = []
    for n in band["frames"]:
        f = copy.deepcopy(by[n])
        tgt = _target(f.get("placement"))
        if (tgt is None or tgt not in inside) and n not in set_of:
            b = rects[n]
            size = (f.get("placement") or {}).get("size")
            f["placement"] = {"anchor": {"to": "container", "edge": "top-left"},
                              "offset": {"x": mm(b[0] - gx), "y": mm(b[1] - top + lead)}}
            if size:
                f["placement"]["size"] = size
        f.pop("grid", None)
        b = _frame_box(t, rects, n)
        if isinstance(f.get("width"), dict) and "percent" in f["width"] and b:
            f["width"] = mm(b[2] - b[0])
        h = f.get("height")
        if (h == "fill" or (isinstance(h, dict) and "percent" in h)) and b:
            f["height"] = mm(b[3] - b[1])
        # The ladder of a module frame outside a group of its own scales the
        # pictures of the whole module (they are its peers); on the page it
        # scaled only its own. A text frame that stood in no group keeps that.
        if (n not in in_groups and n not in set_of and kinds.get(n, "box") in ("box", "text", "tab", "title")
                and has_pictures and "scaleImages" not in (f.get("fit") or {})):
            f["fit"] = {**(f.get("fit") or {}), "scaleImages": False}
        frames.append(f)
    groups = []
    for g in t.get("groups", []):
        if g["name"] not in gs:
            continue
        g = copy.deepcopy(g)
        tgt = _target(g.get("placement"))
        if g.get("placement") and (tgt is None or tgt not in inside):
            b = _frame_box(t, rects, _group_members(g)[0]) if g.get("kind") != "grid" else None
            off = g["placement"].get("offset") or {}
            if g.get("kind") == "grid":
                # the grid's own top-left: its placement read off the page
                ox, oy = _grid_origin(t, g, rects)
            else:
                ox, oy = (b[0], b[1]) if b else (_mm_of(off.get("x")) or 0, _mm_of(off.get("y")) or 0)
            g["placement"] = {**g["placement"], "anchor": {"to": "container", "edge": "top-left"},
                              "offset": {"x": mm(ox - gx), "y": mm(oy - top + lead)}}
        g.pop("grid", None)
        groups.append(g)
    # decoration that reads only the band's frames (and elements that do)
    els = _decoration(t)
    # `taken`: elements an earlier band took; `extra`: the page's own
    # decoration this module takes as it is (anchored to the page)
    moved_ids: set[str] = set(extra)
    changed = True
    while changed:
        changed = False
        for el in els:
            eid = str(el.get("id"))
            if eid in moved_ids or eid in taken or el.get("remove"):
                continue
            tg = _el_targets(el)
            anchor_to = ((el.get("placement") or {}).get("anchor") or {}).get("to")
            free_anchor = el.get("kind") == "connector" or (isinstance(anchor_to, str) and anchor_to.startswith("#"))
            if tg and free_anchor and tg <= inside | moved_ids:
                moved_ids.add(eid)
                changed = True
    # what the page paints at a fixed place inside the band (a shape, a
    # line under its frames) goes with it, so it keeps its place among the
    # band's own decoration in paint order
    bx = band.get("capture") or band["box"]
    fixed: dict[str, tuple[float, float]] = {}
    for el in els:
        eid = str(el.get("id"))
        if eid in moved_ids or eid in taken or el.get("remove"):
            continue
        box = _fixed_box(el)
        if box and box[0] >= bx[0] - 0.5 and box[1] >= bx[1] - 0.5 and box[2] <= bx[2] + 0.5 and box[3] <= bx[3] + 0.5:
            moved_ids.add(eid)
            fixed[eid] = (box[0], box[1])
    deco, ids = [], {}
    ecount: dict[str, int] = {}
    for el in els:
        if str(el.get("id")) in moved_ids:
            # `deco-…`: never a frame's name (`box-1`), which the role names
            # given later would take for a frame
            k = el.get("kind", "element")
            ecount[k] = ecount.get(k, 0) + 1
            ids[str(el.get("id"))] = f"deco-{k}-{ecount[k]}"
    for el in els:
        if str(el.get("id")) in moved_ids:
            e = copy.deepcopy(el)
            e["id"] = ids[str(el.get("id"))]
            at = fixed.get(str(el.get("id")))
            if at:
                e["placement"] = {**e["placement"], "anchor": {"to": "container", "edge": "top-left"},
                                  "offset": {"x": mm(at[0] - gx), "y": mm(at[1] - top + lead)}}
            deco.append(e)
    module: dict[str, Any] = {"role": "module", "frames": frames}
    if groups:
        module["groups"] = groups
    if deco:
        module["decoration"] = {"elements": deco}
    retarget(module, {**names, **ids})
    for f in module["frames"]:
        f["name"] = names.get(f["name"], f["name"])
    for g in module.get("groups", []):
        g["name"] = names.get(g["name"], g["name"])
        if g.get("frames"):
            g["frames"] = [names.get(n, n) for n in g["frames"]]
        if isinstance(g.get("repeat"), dict):
            g["repeat"]["frames"] = [names.get(n, n) for n in g["repeat"]["frames"]]
    return module, names, ids


def _fixed_box(el: dict) -> Box | None:
    """The page box (mm) of an element placed at the page's top-left with an
    absolute offset and size, else None."""
    p = el.get("placement") or {}
    a = p.get("anchor") or {}
    if a.get("to") not in ("page", "container") or a.get("edge") != "top-left":
        return None
    off, size = p.get("offset") or {}, p.get("size") or {}
    x, y = _mm_of(off.get("x")) or 0.0, _mm_of(off.get("y")) or 0.0
    w, h = _mm_of(size.get("width")), _mm_of(size.get("height"))
    if w is None or h is None:
        return None
    return (x, y, x + w, y + h)


def _grid_origin(t: dict, g: dict, rects: dict[str, Box]) -> tuple[float, float]:
    """The top-left of a grid's box on the page (mm)."""
    p = g.get("placement") or {}
    a = p.get("anchor") or {}
    off = p.get("offset") or {}
    ox, oy = _mm_of(off.get("x")) or 0.0, _mm_of(off.get("y")) or 0.0
    if a.get("to") == "container":
        return ox, oy
    insts = [r for n, r in rects.items() if _base(n) in _group_members(g)]
    return (min(r[0] for r in insts), min(r[1] for r in insts)) if insts else (ox, oy)


def modules_alike(a: dict, b: dict, tol: float, frame_diff, element_diff, group_equal) -> bool:
    # a module of a row (it has a width) is never one with a module of the stack
    wa, wb = a.get("width"), b.get("width")
    if (wa is None) != (wb is None) or (isinstance(wa, str) or isinstance(wb, str)) and wa != wb:
        return False
    if isinstance(wa, dict) and isinstance(wb, dict) and abs((_mm_of(wa) or 0) - (_mm_of(wb) or 0)) > tol:
        return False
    fa, fb = a.get("frames", []), b.get("frames", [])
    if len(fa) != len(fb) or any(x["name"] != y["name"] for x, y in zip(fa, fb)):
        return False
    if any(frame_diff(x, y, tol) is None for x, y in zip(fa, fb)):
        return False
    ga, gb = a.get("groups", []), b.get("groups", [])
    if len(ga) != len(gb) or any(not group_equal(x, y, tol) for x, y in zip(ga, gb)):
        return False
    ea, eb = _decoration(a), _decoration(b)
    if len(ea) != len(eb) or any(element_diff(x, y, tol) is None for x, y in zip(ea, eb)):
        return False
    return True


def module_name(m: dict) -> str:
    kinds: dict[str, int] = {}
    for f in m.get("frames", []):
        k = re.sub(r"-\d+$", "", f["name"])
        if k.startswith("grid"):
            k = "grid"
            if k in kinds:
                continue
        kinds[k] = kinds.get(k, 0) + 1
    order = ["box", "tab", "text", "picture", "figure"]
    parts = []
    for k in order + sorted(set(kinds) - set(order)):
        if k in kinds:
            parts.append(k + (str(kinds[k]) if kinds[k] > 1 else ""))
    return "module-" + ("-".join(parts) or "empty")


FURNITURE = "furniture-"


def page_parity(t: dict) -> str | None:
    """'odd' / 'even': the side the page's folio is kept to, if any."""
    for el in _decoration(t):
        if el.get("kind") == "text" and "{pageNumber}" in str(el.get("content", "")) \
                and el.get("parity") in ("odd", "even"):
            return el["parity"]
    return None


def mark_furniture(templates: list[dict], element_diff, tol: float = 0.5) -> int:
    """Elements the page paints alike (within `tol` mm) on every page of a
    side (every odd page, every even page, or every page with a folio):
    marks by a margin, a rule by the folio. They are renamed `furniture-N`
    on every page that has them and kept to the side they are on
    (`parity`), so the pages' shells are one. Returns the classes found."""
    sides = [page_parity(t) for t in templates]
    known = [k for k, sd in enumerate(sides) if sd]
    classes: list[dict] = []
    for k in known:
        for el in _decoration(templates[k]):
            if el.get("remove") or el.get("kind") == "connector" or _target(el.get("placement")):
                continue
            if el.get("kind") == "text" and "{" not in str(el.get("content", "")):
                continue
            plain = {kk: v for kk, v in el.items() if kk not in ("id", "parity")}
            hit = None
            for c in classes:
                ref = c["el"]
                if k not in c["pages"] and element_diff({**ref, "id": ""}, {**plain, "id": ""}, tol) is not None:
                    hit = c
                    break
            if hit:
                hit["pages"][k] = el
            else:
                classes.append({"el": plain, "pages": {k: el}})
    n = 0
    for c in classes:
        pages = set(c["pages"])
        on = {sides[k] for k in pages}
        need = {k for k in known if sides[k] in on}
        if len(pages) < 2 or not need <= pages:
            continue
        n += 1
        for k, el in c["pages"].items():
            old = str(el.get("id"))
            el["id"] = f"{FURNITURE}{n}"
            if len(on) == 1:
                el["parity"] = next(iter(on))
            else:
                el.pop("parity", None)   # alike on both sides: every page
            retarget(templates[k], {old: el["id"]})
    return n


def is_furniture(el: dict) -> bool:
    """What a page shell keeps: what every page of a side paints alike
    (`mark_furniture`), the page colour, running heads and folios
    (`{pageNumber}`, `{attr.x}`) and a ground read from a fence attribute."""
    if str(el.get("id", "")).startswith(FURNITURE):
        return True
    if el.get("kind") == "text":
        c = str(el.get("content", ""))
        return "{pageNumber}" in c or "{attr." in c
    if el.get("kind") == "image":
        return str(el.get("resourceId", "")).startswith("{attr.")
    a = ((el.get("placement") or {}).get("anchor") or {}).get("to")
    return el.get("kind") == "box" and a == "bleed" and str(el.get("id")) == "page-colour"


def _text_box(el: dict, page: tuple[float, float]) -> Box | None:
    """The page box (mm) a one-line text element anchored to a page corner
    takes, from its offset, width and font size; None when unknown."""
    p = el.get("placement") or {}
    a = p.get("anchor") or {}
    if a.get("to") != "page" or a.get("edge") not in ("top-left", "top-right", "bottom-left", "bottom-right"):
        return None
    off = p.get("offset") or {}
    ox, oy = _mm_of(off.get("x")) or 0.0, _mm_of(off.get("y")) or 0.0
    w = _mm_of((p.get("size") or {}).get("width"))
    fs = _mm_of(el.get("fontSize"))
    if w is None or fs is None:
        return None
    h = fs * float(el.get("lineHeight") or 1.2)
    edge = a["edge"]
    x0 = page[0] + ox - w if edge.endswith("right") else ox
    y0 = page[1] + oy - h if edge.startswith("bottom") else oy
    return (x0, y0, x0 + w, y0 + h)


def _clear_of(box: Box | None, others: list[Box | None]) -> bool:
    """`box` meets none of `others` (an unknown box meets everything; a mark
    under 25 mm², an arrow by a running head, covers nothing that matters)."""
    if box is None:
        return False
    for o in others:
        if o is None:
            return False
        if (o[2] - o[0]) * (o[3] - o[1]) < 25:
            continue
        if box[0] < o[2] and o[0] < box[2] and box[1] < o[3] and o[1] < box[3]:
            return False
    return True


def plan_page_modules(t: dict, rects: dict[str, Box], kinds: dict[str, str],
                      parents: dict[str, str | None], page: tuple[float, float] = (210.0, 297.0),
                      measured: dict[str, Box] | None = None, rows: bool = True,
                      no_rows: set[int] | None = None) -> dict | None:
    """Every band of one page template as a module, or, when its clusters
    stand side by side (`row_columns`, not for the band indices in
    `no_rows`), as a row of modules (nothing changed yet).
    The modules group fills the page from its top-left, with no gap: each
    module's frames stand where the band stood, offset by how far the band
    stands from the foot of the one before it (the first from the page's
    top), so the page lays as it did and text that grows pushes what
    follows. The page keeps its furniture (`is_furniture`) while nothing
    the page paints earlier moved; every other element goes with the band
    whose frames it reads or inside which it is painted, else with the first
    module, as it is.

    The distance between two bands is read off the `measured` boxes (the
    source's, regions.json) when every frame of both has one, not off the
    laid ones: a box the draft's measure grew past its drawn height would
    otherwise bake its growth into the gap under it, and a measure that fits
    the text in the drawn height (another renderer, a shorter translation)
    would lay the next band that much higher than the source."""
    bands = bands_of(t, rects, parents)
    if not bands:
        return None

    def drawn(band: dict) -> Box | None:
        bs = [measured[n] for n in band["frames"] if measured and n in measured]
        if not bs or len(bs) != len(band["frames"]):
            return None
        return (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))

    def lead(i: int) -> float:
        above, here = drawn(bands[i - 1]), drawn(bands[i])
        if above and here:
            return here[1] - above[3]
        return bands[i]["box"][1] - bands[i - 1]["box"][3]

    leads = [bands[0]["box"][1]] + [lead(i) for i in range(1, len(bands))]
    # every module of the page, top to bottom and, in a row, start to end
    slots: list[dict] = []
    for i, (band, ld) in enumerate(zip(bands, leads)):
        cols = None
        if rows and (i not in (no_rows or ())) and t.get("area") == "trim":
            cols = row_columns(t, band, page[0])
        if not cols:
            slots.append({"band": band, "lead": ld, "gx": 0.0, "row": None, "box": band["box"]})
            continue
        for k, col in enumerate(cols):
            slots.append({"band": col, "lead": ld, "gx": col["gx"], "row": i, "col": k, "n": len(cols),
                          "equal": col["equal"], "width": col["width"], "box": col["box"]})
    first = [module_of_band(t, s["band"], rects, kinds, s["gx"], band_top(s), s["lead"]) for s in slots]
    owner: dict[str, int] = {}
    for k, (_, _, ids) in enumerate(first):
        for e in ids:
            owner.setdefault(e, k)
    # The page shell's decoration paints under every module's: what the page
    # painted after something that moves stays only when it covers none of it
    keep, extra, clean = [], set(), True
    painted: list[Box | None] = []
    for el in _decoration(t):
        eid = str(el.get("id"))
        if eid in owner:
            clean = False
            painted.append(_fixed_box(el) or slots[owner[eid]]["box"])
            continue
        box = _text_box(el, page) if el.get("kind") == "text" else _fixed_box(el)
        if is_furniture(el) and (clean or _clear_of(box, painted)):
            keep.append(eid)
            continue
        extra.add(eid)
        painted.append(_fixed_box(el))
        clean = False
    mods = []
    for k, s in enumerate(slots):
        others = frozenset(e for e, o in owner.items() if o != k)
        m, names, ids = module_of_band(t, s["band"], rects, kinds, s["gx"], band_top(s), s["lead"], taken=others,
                                       extra=frozenset(extra) if k == 0 else frozenset())
        if s["row"] is not None:
            m["width"] = mm(s["width"]) if s["width"] is not None else "fill"
        mods.append({"module": m, "names": names, "ids": ids, "band": s["band"], "row": s["row"],
                     "col": s.get("col"), "n": s.get("n"), "equal": s.get("equal")})
    return {"bands": bands, "modules": mods, "keep": keep}


def band_top(slot: dict) -> float:
    """The top of the band a module's frames are measured from: the row's
    for a module of a row (its modules share the lead), else its own."""
    return slot["band"].get("top", slot["band"]["box"][1])


def row_columns(t: dict, band: dict, page_w: float, tol: float = 0.5) -> list[dict] | None:
    """The clusters of a band that stand side by side (#1088), start to end,
    each a sub-band laid as one module of a modules row, or None when the
    band is one block. Units whose spans across the page overlap are one
    cluster, and so are the clusters a shape painted inside the band spans.
    Each: {frames, groups, flow, box, capture, top, gx, width, equal}: the
    module's box starts at `gx` (mm from the area's start) and is `width`
    wide (None: what the others leave, `fill`). When every cluster stands
    inside its share of `page_w` cut in equal columns, the columns are those
    (`equal`, so rows of them can be a modules grid), else each module
    starts where its cluster starts."""
    units = sorted(band.get("units") or [], key=lambda u: u[1][0])
    if len(units) < 2:
        return None
    clusters: list[dict] = []
    for ms, b in units:
        if clusters and b[0] < clusters[-1]["box"][2] - tol:
            c = clusters[-1]
            c["frames"] += ms
            cb = c["box"]
            c["box"] = (min(cb[0], b[0]), min(cb[1], b[1]), max(cb[2], b[2]), max(cb[3], b[3]))
        else:
            clusters.append({"frames": list(ms), "box": b})
    by = band["box"]
    shapes = []
    for el in _decoration(t):
        fb = _fixed_box(el)
        if fb and fb[1] >= by[1] - tol and fb[3] <= by[3] + tol:
            shapes.append(fb)
    changed = True
    while changed and len(clusters) > 1:
        changed = False
        for fb in shapes:
            hit = [k for k, c in enumerate(clusters) if fb[0] < c["box"][2] - tol and c["box"][0] < fb[2] - tol]
            if len(hit) > 1:
                a, z = hit[0], hit[-1]
                merged = {"frames": [n for c in clusters[a:z + 1] for n in c["frames"]],
                          "box": (min(c["box"][0] for c in clusters[a:z + 1]), min(c["box"][1] for c in clusters[a:z + 1]),
                                  max(c["box"][2] for c in clusters[a:z + 1]), max(c["box"][3] for c in clusters[a:z + 1]))}
                clusters[a:z + 1] = [merged]
                changed = True
                break
    n = len(clusters)
    if n < 2:
        return None
    share = page_w / n
    equal = all(c["box"][0] >= k * share - tol and c["box"][2] <= (k + 1) * share + tol for k, c in enumerate(clusters))
    starts = [k * share for k in range(n)] if equal else [0.0] + [round(c["box"][0], 2) for c in clusters[1:]]
    order = {nm: i for i, nm in enumerate(band["frames"])}
    out = []
    for k, c in enumerate(clusters):
        fs = sorted(c["frames"], key=lambda nm: order.get(nm, 0))
        sub = {k2: v for k2, v in band.items() if k2 not in ("frames", "groups", "units", "box", "flow")}
        end = starts[k + 1] if k + 1 < n else page_w
        sub.update({"frames": fs, "groups": [g for g in band.get("groups", []) if g in _groups_within(t, set(fs))],
                    "flow": any(_flowing(t, nm) for nm in fs), "box": c["box"], "top": by[1],
                    "capture": (starts[k], by[1], end, by[3]), "gx": starts[k],
                    "width": round(share, 2) if equal else (round(end - starts[k], 2) if k + 1 < n else None),
                    "equal": equal})
        out.append(sub)
    return out


def _groups_within(t: dict, frames: set[str]) -> set[str]:
    return {g["name"] for g in t.get("groups", []) if _group_members(g) and set(_group_members(g)) <= frames}


def _flowing(t: dict, name: str) -> bool:
    f = next((f for f in t.get("frames", []) if f["name"] == name), {})
    return bool(f.get("flow") or f.get("takes"))


def apply_page_modules(t: dict, plan: dict, ids: list[str], rects: dict[str, Box],
                       nested: list[dict] | None = None) -> dict[str, str]:
    """Replace every frame of page template `t` by one modules group that
    fills the page (and the `nested` row and grid groups inside it, the
    same on every shell); `ids` the module template of each band. Returns
    {page name: instance name} for every frame, group and element moved."""
    seen: dict[str, int] = {}
    rename: dict[str, str] = {}
    for m, mid in zip(plan["modules"], ids):
        seen[mid] = seen.get(mid, 0) + 1
        inst = f"{mid}[{seen[mid]}]"
        m["instance"] = inst
        for old, new in {**m["names"], **m["ids"]}.items():
            rename[old] = f"{inst}.{new}"
    group: dict[str, Any] = {"name": "modules", "modules": True, "gap": mm(0),
                             "placement": {"anchor": {"to": "container", "edge": "top-left"},
                                           "offset": {"x": mm(0), "y": mm(0)},
                                           "size": {"width": "fill", "height": "fill"}}}
    t["frames"] = []
    t["groups"] = [group] + copy.deepcopy(nested or [])
    keep = set(plan["keep"])
    if t.get("decoration"):
        t["decoration"]["elements"] = [e for e in _decoration(t) if str(e.get("id")) in keep]
        if not t["decoration"]["elements"]:
            del t["decoration"]
    retarget(t, rename)
    return rename


def nested_groups(pages: list[dict | None], stack: str = "modules") -> tuple[list[dict], list[tuple[int, int]]]:
    """The modules groups inside the stack (`within`, #1088) that lay the
    book's rows of modules, and the rows that cannot be laid by them.

    The engine gives a module to the first nested group whose `templates`
    hold its template and lays each run of them as one row (or grid): rows
    that share a module template are one group, and two rows of one group
    one after the other on a page would run together. Those become a grid
    when every row of the group has the same number of modules in equal
    columns (each row one grid row); else the second of the two is returned
    (page index, band index) to be laid as one module instead. Every shell
    gets every group, so the shells stay alike."""
    rows: list[dict] = []
    for pg in pages:
        if not pg or "plan" not in pg:
            continue
        by_row: dict[int, list[int]] = {}
        for k, m in enumerate(pg["plan"]["modules"]):
            if m.get("row") is not None:
                by_row.setdefault(m["row"], []).append(k)
        for r, ks in sorted(by_row.items()):
            rows.append({"pg": pg, "band": r, "ids": [pg["ids"][k] for k in ks], "first": ks[0], "last": ks[-1],
                         "equal": bool(pg["plan"]["modules"][ks[0]].get("equal")), "n": len(ks)})
    if not rows:
        return [], []
    u = _Union({i for r in rows for i in r["ids"]})
    for r in rows:
        for i in r["ids"][1:]:
            u.join(r["ids"][0], i)
    comps: dict[str, list[dict]] = {}
    for r in rows:
        comps.setdefault(u.find(r["ids"][0]), []).append(r)
    groups: list[dict] = []
    clash: list[tuple[int, int]] = []
    count = {"row": 0, "grid": 0}
    for comp in comps.values():
        consec = [(a, b) for a in comp for b in comp if a["pg"] is b["pg"] and b["first"] == a["last"] + 1]
        kind = "row"
        if consec:
            if all(r["equal"] for r in comp) and len({r["n"] for r in comp}) == 1:
                kind = "grid"
            else:
                clash += [(b["pg"]["index"], b["band"]) for _, b in consec]
                continue
        count[kind] += 1
        templates = list(dict.fromkeys(i for r in comp for i in r["ids"]))
        g: dict[str, Any] = {"name": f"{kind}-{count[kind]}", "modules": True, "within": stack, "kind": kind,
                             "templates": templates}
        if kind == "grid":
            g.update({"columns": comp[0]["n"], "columnGap": mm(0), "rowGap": mm(0)})
        else:
            g["gap"] = mm(0)
        g["rowAlign"] = "start"
        g["_uses"] = list(dict.fromkeys(r["pg"]["t"]["id"] for r in comp))
        groups.append(g)
    return groups, clash


def modules_markdown(lines: list[str], fence: dict, plan: dict, ids: list[str]) -> list[str]:
    """The fence as `:::module` blocks, one per band in order, each with the
    band's pieces; the band that holds the flowing text (or the frame that
    takes the headings) also takes every piece that names no slot."""
    pieces = pieces_of(lines, fence)
    blocks: list[str] = []
    used: list[Piece] = []
    flow_band = next((k for k, m in enumerate(plan["modules"]) if m["band"].get("flow")), None)
    for k, (m, mid) in enumerate(zip(plan["modules"], ids)):
        slots = set(m["band"]["frames"])
        mine = [p for p in pieces if (p.slot is not None and p.slot in slots) or (p.slot is None and k == flow_band)]
        used += mine
        body = [f':::module{{template="{mid}"}}']
        for p in mine:
            body += _rename_slots(p.lines, m["names"]) + [""]
        if body[-1] == "":
            body.pop()
        blocks.append("\n".join(body + [":::"]))
    at = min((p.start for p in used), default=fence["end"] - 1)
    return _replace(lines, fence, used, at, "\n\n".join(blocks).split("\n"))


def fold_book(templates: list[dict], regions: list[dict], markdowns: list[str], tol: dict,
              frame_diff, element_diff, group_equal, grids: bool = True, modules: bool = True,
              laid: dict[str, dict[str, Box]] | None = None, rows: bool = True,
              looks: LookBook | None = None) -> dict:
    """Grids then modules over every page template `extract` wrote (one per
    page, in `regions` order). Rewrites `templates` (and appends the module
    templates) and `markdowns` in place. Returns the report: grids,
    modules, and per template {old frame name: name on the laid page}.
    `laid` (template id -> frame boxes, from `render.mjs --frames` of the
    draft) gives the boxes the engine lays, which groups may have moved off
    the measured ones: the folded page then lays as the draft did. `rows`
    lays the clusters of a band that stand side by side as a row (or grid)
    of modules (#1088); `looks` lets the cards of a grid differ in colours,
    each card that differs naming a look (#1089, `looks.entries`)."""
    report: dict[str, Any] = {"grids": [], "modules": [], "names": {}}
    if len(templates) != len(regions) or any(t.get("extends") or t.get("role") == "module" for t in templates):
        report["skipped"] = "the templates are not one per measured page (run the fold on the output of extract)"
        return report
    docs = [m.split("\n") for m in markdowns]
    lt = tol.get("lattice", 1.0)
    pages: list[dict | None] = []
    for t, reg in zip(templates, regions):
        rects = {f["name"]: tuple(f["box"]) for f in reg.get("frames", []) if f.get("box")}
        measured = dict(rects)
        for n, b in ((laid or {}).get(t["id"]) or {}).items():
            if n in rects and b[2] - b[0] > 0.01:
                rects[n] = tuple(b)
        if not all(f["name"] in rects for f in t.get("frames", [])):
            pages.append(None)
            continue
        kinds = {f["name"]: f.get("kind") or "box" for f in reg.get("frames", [])}
        parents = {f["name"]: f.get("parent") for f in reg.get("frames", [])}
        names = {f["name"]: f["name"] for f in t.get("frames", [])}
        if grids:
            for plan in fold_grids(t, rects, kinds, lt, int(tol.get("grid_min", 3)), looks,
                                   float(tol.get("reach", 8.0))):
                for o, cur in names.items():
                    if cur in plan["instances"]:
                        names[o] = plan["instances"][cur]
                for d in docs:
                    for fence in reversed([f for f in page_fences(d) if f["template"] == t["id"]]):
                        d[:] = grid_items_markdown(d, fence, plan)
                report["grids"].append({"template": t["id"], "group": plan["group"],
                                        "frames": [plan["main"], *plan["members"]],
                                        "columns": plan["columns"], "rows": plan["rows"],
                                        "columnGap": plan["columnGap"], "rowGap": plan["rowGap"],
                                        "items": len(plan["cells"]),
                                        "looks": sorted({v for c in plan["looks"] for v in c.values()})})
        trim = reg.get("trim") or [210.0, 297.0]
        pages.append({"t": t, "rects": rects, "kinds": kinds, "parents": parents, "names": names,
                      "page": (float(trim[0]), float(trim[1])), "measured": measured})
    if modules:
        report["furniture"] = mark_furniture([pg["t"] for pg in pages if pg is not None], element_diff)
        no_rows: dict[int, set[int]] = {}
        taken0 = {t["id"] for t in templates}
        for _attempt in range(64):
            cands = []
            for p_i, pg in enumerate(pages):
                if pg is None:
                    continue
                pg.pop("ids", None)
                plan = plan_page_modules(pg["t"], pg["rects"], pg["kinds"], pg["parents"], pg["page"], pg["measured"],
                                         rows=rows, no_rows=no_rows.get(p_i))
                pg.pop("plan", None)
                if plan:
                    pg["plan"] = plan
                    pg["index"] = p_i
                    cands += [(pg, k) for k in range(len(plan["modules"]))]
            lib: list[dict] = []
            for pg, k in cands:
                m = pg["plan"]["modules"][k]["module"]
                hit = next((e for e in lib if modules_alike(e["module"], m, tol.get("module", 0.5), frame_diff,
                                                            element_diff, group_equal)), None)
                if hit:
                    hit["uses"].append((pg, k))
                else:
                    lib.append({"module": m, "uses": [(pg, k)]})
            taken = set(taken0)
            for e in lib:
                e["id"] = _unique(module_name(e["module"]), taken)
                for pg, k in e["uses"]:
                    pg.setdefault("ids", {})[k] = e["id"]
            nested, clash = nested_groups(pages)
            if not clash:
                break
            for p_i, band in clash:
                no_rows.setdefault(p_i, set()).add(band)
        report["rows"] = [{"group": g["name"], "kind": g["kind"], "templates": list(g["templates"]),
                           **({"columns": g["columns"]} if g["kind"] == "grid" else {}), "uses": g.pop("_uses")}
                          for g in nested]
        for pg in pages:
            if pg is None or "plan" not in pg:
                continue
            ids = [pg["ids"][k] for k in range(len(pg["plan"]["modules"]))]
            rename = apply_page_modules(pg["t"], pg["plan"], ids, pg["rects"], nested)
            for o, cur in pg["names"].items():
                b = _base(cur)
                if cur in rename:
                    pg["names"][o] = rename[cur]
                elif b in rename and cur != b:
                    pg["names"][o] = rename[b] + cur[len(b):]
            for d in docs:
                for fence in reversed([f for f in page_fences(d) if f["template"] == pg["t"]["id"]]):
                    d[:] = modules_markdown(d, fence, pg["plan"], ids)
        for e in lib:
            templates.append({"id": e["id"], **e["module"]})
            report["modules"].append({"id": e["id"], "frames": len(e["module"]["frames"]),
                                      "uses": [pg["t"]["id"] for pg, _ in e["uses"]]})
    for pg in pages:
        if pg is not None:
            report["names"][pg["t"]["id"]] = pg["names"]
    if looks is not None:
        report["frameLooks"] = looks.entries
    markdowns[:] = ["\n".join(d) for d in docs]
    return report
