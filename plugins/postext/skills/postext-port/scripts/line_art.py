#!/usr/bin/env python3
"""The line art of a fixed page read as vector decoration of a composed page
(references/composed-pages.md): the geometry `pdf_regions.py extract` uses
to turn a diagram's lines into connectors, a pointer into a picture into a
connector that ends at a new anchor of that picture, and whatever line art is
left into path elements. Pure functions over millimetres, no PDF access, so
the tests drive them with invented boxes.

- `line_segments(lines)`: the axis-aligned segments of one stroked path
  (corner pieces under half a millimetre dropped), or None when a piece runs
  at a slant or the path closes a rectangle (a box's border is not a line).
- `merge_collinear(segs)`: segments of one look on one line that touch or
  overlap become one (a line drawn in pieces).
- `nets(segs)`: segments that meet (an end on another, or crossing) group
  into nets, one look each.
- `read_net(net, frames)`: the connectors a net draws between frames:
  trees (a bar, one trunk to a parent, two or more drops to children, each
  found by walking the line from the bar to the first frame it reaches),
  then chains of two or three segments between two frames (`elbow`), then
  each single segment cut into the runs between the frames it passes
  (`straight`), and an end deep inside a picture as an anchor end. What no
  rule explains is returned as left-over segments, for a path element.
- `path_data(...)`: SVG path data for segments or a PDF path's items, in
  millimetres from a box's corner.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

TINY = 0.5        # mm: corner pieces shorter than this are dropped
SLANT = 0.3       # mm: a piece whose ends differ less than this across is axis-aligned
JOIN = 0.6        # mm: ends this close meet
REACH = 2.5       # mm: an end this short of a frame's edge touches it
DEEP = 2.0        # mm: an end this far inside a picture points at it
RUN = 0.8         # mm: a run between two frames shorter than this is not drawn
OPAQUE = ("picture", "figure", "opaque")   # frames that cover what lies under them


@dataclass
class Seg:
    axis: str                 # 'h' (along x) or 'v' (along y)
    c: float                  # the fixed coordinate (y of a 'h', x of a 'v')
    lo: float                 # start along the axis
    hi: float                 # end along the axis
    key: tuple = ()           # the look: colour, width, dash
    ids: set = field(default_factory=set)   # source paths it came from

    @property
    def length(self) -> float:
        return self.hi - self.lo

    def point(self, t: float) -> tuple[float, float]:
        return (t, self.c) if self.axis == "h" else (self.c, t)

    def box(self) -> tuple[float, float, float, float]:
        if self.axis == "h":
            return (self.lo, self.c, self.hi, self.c)
        return (self.c, self.lo, self.c, self.hi)


@dataclass
class Frame:
    name: str
    box: tuple                # x0, y0, x1, y1 in mm
    kind: str = "text"        # picture / figure ends can be anchors
    # (point, direction back along the line, the line's source paths, the frame's box) -> does the
    # line show there, over the picture? A line drawn under a photo ends at its side, one drawn over
    # it points into it.
    shows: Any = None

    @property
    def area(self) -> float:
        return max(0.0, self.box[2] - self.box[0]) * max(0.0, self.box[3] - self.box[1])


@dataclass
class End:
    frame: str
    side: str
    at: float = 0.5
    gap: float = 0.0
    point: tuple | None = None    # an anchor end: the point inside the picture (mm)
    span: float = 0.0             # the side's length (mm): `at` is written when off its middle by 0.3 mm
    xy: tuple | None = None       # where the source's line ends (mm), to find a cap drawn there

    def config(self) -> dict:
        out: dict[str, Any] = {"to": f"#{self.frame}", "side": self.side}
        if self.point is None:
            if abs(self.at - 0.5) * (self.span or 100.0) > 0.3:
                out["at"] = round(self.at, 3)
        if self.gap > 0.2:
            out["gap"] = {"value": round(self.gap, 2), "unit": "mm"}
        return out


@dataclass
class Connector:
    routing: str
    start: End
    ends: list
    key: tuple
    trunk: float | None = None
    ids: set = field(default_factory=set)
    over: bool = False            # the line runs over a picture it does not end in (painted after it)


# ---------------------------------------------------------------------------
# segments
# ---------------------------------------------------------------------------


def line_segments(lines: Iterable[tuple], key: tuple = (), sid: Any = None) -> list[Seg] | None:
    """`lines`: ((x0, y0), (x1, y1)) pieces of one path, in mm."""
    segs: list[Seg] = []
    for (x0, y0), (x1, y1) in lines:
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        if max(dx, dy) < TINY:
            continue
        if dy <= SLANT:
            segs.append(Seg("h", (y0 + y1) / 2, min(x0, x1), max(x0, x1), key, {sid}))
        elif dx <= SLANT:
            segs.append(Seg("v", (x0 + x1) / 2, min(y0, y1), max(y0, y1), key, {sid}))
        else:
            return None
    if not segs or closes_rectangle(segs):
        return None
    return segs


def closes_rectangle(segs: list[Seg]) -> bool:
    """Do the segments run along all four sides of their box? A box's border,
    not a line."""
    x0 = min(s.box()[0] for s in segs)
    y0 = min(s.box()[1] for s in segs)
    x1 = max(s.box()[2] for s in segs)
    y1 = max(s.box()[3] for s in segs)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return False

    def covered(axis: str, c: float, lo: float, hi: float) -> bool:
        run = sum(s.length for s in segs if s.axis == axis and abs(s.c - c) <= JOIN)
        return run >= 0.5 * (hi - lo)

    return covered("h", y0, x0, x1) and covered("h", y1, x0, x1) and covered("v", x0, y0, y1) and covered("v", x1, y0, y1)


def merge_collinear(segs: list[Seg]) -> list[Seg]:
    out: list[Seg] = []
    for s in sorted(segs, key=lambda s: (s.key, s.axis, round(s.c, 1), s.lo)):
        last = next((o for o in reversed(out) if o.key == s.key and o.axis == s.axis and abs(o.c - s.c) <= SLANT), None)
        if last is not None and s.lo <= last.hi + JOIN:
            last.hi = max(last.hi, s.hi)
            last.ids |= s.ids
            continue
        out.append(Seg(s.axis, s.c, s.lo, s.hi, s.key, set(s.ids)))
    return out


def meets(a: Seg, b: Seg, tol: float = JOIN) -> bool:
    """Do two segments touch or cross?"""
    if a.axis == b.axis:
        return abs(a.c - b.c) <= SLANT and a.lo <= b.hi + tol and b.lo <= a.hi + tol
    h, v = (a, b) if a.axis == "h" else (b, a)
    return h.lo - tol <= v.c <= h.hi + tol and v.lo - tol <= h.c <= v.hi + tol


def nets(segs: list[Seg]) -> list[list[Seg]]:
    parent = list(range(len(segs)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(segs)):
        for j in range(i + 1, len(segs)):
            if segs[i].key == segs[j].key and meets(segs[i], segs[j]):
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[max(ri, rj)] = min(ri, rj)
    groups: dict[int, list[Seg]] = {}
    for i, s in enumerate(segs):
        groups.setdefault(find(i), []).append(s)
    return [groups[k] for k in sorted(groups)]


# ---------------------------------------------------------------------------
# frames along a line
# ---------------------------------------------------------------------------

SIDE_OF = {(0, -1): "top", (0, 1): "bottom", (-1, 0): "left", (1, 0): "right"}


def side_facing(d: tuple) -> str:
    """The side of a box the line stands on when it leaves it going `d`."""
    return SIDE_OF[d]


def inside(p: tuple, box: tuple, tol: float = 0.0) -> bool:
    return box[0] - tol <= p[0] <= box[2] + tol and box[1] - tol <= p[1] <= box[3] + tol


def depth(p: tuple, box: tuple) -> float:
    return min(p[0] - box[0], box[2] - p[0], p[1] - box[1], box[3] - p[1])


def side_point(box: tuple, side: str, p: tuple) -> tuple[float, float]:
    """`at` (fraction along the side, from its start: the left or the top)
    and `gap` (how far `p` stands off the side) of a line's end at `p`."""
    x0, y0, x1, y1 = box
    if side in ("top", "bottom"):
        at = (p[0] - x0) / max(x1 - x0, 1e-6)
        gap = (y0 - p[1]) if side == "top" else (p[1] - y1)
    else:
        at = (p[1] - y0) / max(y1 - y0, 1e-6)
        gap = (x0 - p[0]) if side == "left" else (p[0] - x1)
    return min(1.0, max(0.0, at)), max(0.0, gap)


def end_at(frame: Frame, p: tuple, d_back: tuple, ids: set | None = None) -> End:
    """The end of a line at `p` on `frame`, the line lying towards `d_back`
    from it: a point of the picture when it ends deep inside one, over it."""
    if frame.kind in ("picture", "figure") and inside(p, frame.box) and depth(p, frame.box) > TINY \
            and (depth(p, frame.box) > DEEP or frame.shows is not None) and over(frame, p, d_back, ids):
        return End(frame.name, side_facing(d_back), point=p, xy=p)
    side = side_facing(d_back)
    at, gap = side_point(frame.box, side, p)
    return End(frame.name, side, at, gap, span=side_length(frame.box, side), xy=p)


def over(frame: Frame, p: tuple, d_back: tuple, ids: set | None) -> bool:
    """Does a line show over `frame` (a picture) at `p`? Without a way to
    tell, a picture painted under its lines."""
    if frame.kind not in ("picture", "figure"):
        return False
    return frame.shows is None or bool(frame.shows(p, d_back, ids or set(), frame.box))


def crosses_over(segs: list, frames: list[Frame], ends: set) -> bool:
    """Does one of the segments run over a picture (not one of its ends)
    that it shows on? The connector then paints over the frames."""
    for g in segs:
        for f in frames:
            if f.kind not in ("picture", "figure") or f.name in ends:
                continue
            x0, y0, x1, y1 = f.box
            if g.axis == "h":
                lo, hi = max(g.lo, x0), min(g.hi, x1)
                if not (y0 < g.c < y1) or hi - lo < 1.0:
                    continue
            else:
                lo, hi = max(g.lo, y0), min(g.hi, y1)
                if not (x0 < g.c < x1) or hi - lo < 1.0:
                    continue
            if over(f, g.point((lo + hi) / 2), _dir(g.axis, -1), g.ids):
                return True
    return False


def side_length(box: tuple, side: str) -> float:
    return (box[2] - box[0]) if side in ("top", "bottom") else (box[3] - box[1])


def attach(p: tuple, d_out: tuple, frames: list[Frame], skip: set | None = None) -> Frame | None:
    """The frame a line's end at `p` touches: one that holds the point (the
    smallest), else one the line would reach within REACH going on along
    `d_out`."""
    skip = skip or set()
    holding = [f for f in frames if f.name not in skip and inside(p, f.box, 0.2)]
    if holding:
        return min(holding, key=lambda f: f.area)
    best = None
    for f in frames:
        if f.name in skip:
            continue
        for t in (0.5, 1.0, 1.5, 2.0, REACH):
            q = (p[0] + d_out[0] * t, p[1] + d_out[1] * t)
            if inside(q, f.box):
                if best is None or (t, f.area) < (best[0], best[1].area):
                    best = (t, f)
                break
    return best[1] if best else None


def hits(axis: str, c: float, lo: float, hi: float, frames: list[Frame]) -> list[tuple[float, float, Frame]]:
    """Frames a segment's line crosses between `lo` and `hi`: (enter, exit,
    frame) along the axis."""
    out = []
    for f in frames:
        x0, y0, x1, y1 = f.box
        a0, a1, b0, b1 = (x0, x1, y0, y1) if axis == "h" else (y0, y1, x0, x1)
        if not (b0 - 0.2 <= c <= b1 + 0.2):
            continue
        if a1 < lo - REACH or a0 > hi + REACH:
            continue
        out.append((a0, a1, f))
    return sorted(out, key=lambda h: (h[0], -h[1]))


def walk(start: tuple, d: tuple, limit: float, frames: list[Frame], skip_holding: bool) -> tuple[Frame, float] | None:
    """The first frame a line from `start` going `d` reaches within
    `limit` mm (and REACH more), with the distance to its edge."""
    best = None
    for f in frames:
        x0, y0, x1, y1 = f.box
        if d[0] == 0:
            if not (x0 <= start[0] <= x1):
                continue
            enter = (y0 - start[1]) if d[1] > 0 else (start[1] - y1)
            leave = (y1 - start[1]) if d[1] > 0 else (start[1] - y0)
        else:
            if not (y0 <= start[1] <= y1):
                continue
            enter = (x0 - start[0]) if d[0] > 0 else (start[0] - x1)
            leave = (x1 - start[0]) if d[0] > 0 else (start[0] - x0)
        if leave <= 0:
            continue
        if enter < 0:
            if skip_holding:
                continue
            enter = 0.0
        if enter > limit + REACH:
            continue
        if best is None or (enter, f.area) < (best[1], best[0].area):
            best = (f, enter)
    return best


# ---------------------------------------------------------------------------
# reading a net
# ---------------------------------------------------------------------------


class Pieces:
    """What of each segment the connectors draw, to return the rest."""

    def __init__(self, segs: list[Seg]):
        self.used: dict[int, list[tuple[float, float]]] = {id(s): [] for s in segs}

    def take(self, s: Seg, a: float, b: float) -> None:
        self.used[id(s)].append((min(a, b), max(a, b)))

    def left(self, s: Seg) -> list[Seg]:
        spans = sorted(self.used[id(s)])
        out, cur = [], s.lo
        for a, b in spans:
            if a > cur + RUN:
                out.append(Seg(s.axis, s.c, cur, a, s.key, set(s.ids)))
            cur = max(cur, b)
        if s.hi > cur + RUN:
            out.append(Seg(s.axis, s.c, cur, s.hi, s.key, set(s.ids)))
        return out

    def free(self, s: Seg) -> bool:
        return not self.used[id(s)]


def read_net(net: list[Seg], frames: list[Frame]) -> tuple[list[Connector], list[Seg]]:
    pieces = Pieces(net)
    conns: list[Connector] = []
    conns += read_trees(net, frames, pieces)
    rest = [p for s in net for p in pieces.left(s)]
    whole = [s for s in rest]
    left: list[Seg] = []
    for chain in chains(whole):
        got = read_chain(chain, frames)
        if got is not None:
            conns.append(got)
            continue
        if len(chain) == 1:
            c2, stubs = read_segment(chain[0], frames)
            conns += c2
            left += stubs
        else:
            left += chain
    return conns, left


def _dir(axis: str, sign: int) -> tuple[int, int]:
    return (sign, 0) if axis == "h" else (0, sign)


def read_trees(net: list[Seg], frames: list[Frame], pieces: Pieces) -> list[Connector]:
    out: list[Connector] = []
    for bar in sorted(net, key=lambda s: -s.length):
        if bar.length < 4:
            continue
        perp = [s for s in net if s.axis != bar.axis and bar.lo - JOIN <= s.c <= bar.hi + JOIN
                and s.lo - JOIN <= bar.c <= s.hi + JOIN]
        neg = [s for s in perp if bar.c - s.lo > 1.0]
        pos = [s for s in perp if s.hi - bar.c > 1.0]
        if len(pos) >= 2 and len(neg) == 1:
            sign, trunk = 1, neg[0]
        elif len(neg) >= 2 and len(pos) == 1:
            sign, trunk = -1, pos[0]
        else:
            continue
        drops = pos if sign > 0 else neg
        # parent: up the trunk, through other bars, to the first frame
        start = (trunk.c, bar.c) if bar.axis == "h" else (bar.c, trunk.c)
        d_par = _dir(trunk.axis, -sign)
        reach = (bar.c - trunk.lo) if sign > 0 else (trunk.hi - bar.c)
        par = walk(start, d_par, reach, frames, skip_holding=True)
        if par is None:
            continue
        pframe, pdist = par
        # children: down each drop to the first frame, stopping at another bar
        others = [s for s in net if s is not bar and s.axis == bar.axis]
        kids: list[tuple[Seg, Frame, float]] = []
        for dr in drops:
            st = (dr.c, bar.c) if bar.axis == "h" else (bar.c, dr.c)
            ext = (dr.hi - bar.c) if sign > 0 else (bar.c - dr.lo)
            stops = [abs(o.c - bar.c) for o in others if meets(o, dr) and (o.c - bar.c) * sign > JOIN]
            limit = min([ext] + stops)
            hit = walk(st, _dir(dr.axis, sign), limit, frames, skip_holding=False)
            if hit is None or hit[0].name == pframe.name or (stops and hit[1] > min(stops)):
                continue
            if any(k[1].name == hit[0].name for k in kids):
                continue
            kids.append((dr, hit[0], min(limit, ext)))
        if len(kids) < 2:
            continue
        # the ends: a point stands off its frame's edge by the room the line leaves
        ppt = (start[0] + d_par[0] * pdist, start[1] + d_par[1] * pdist)
        pend = end_at(pframe, ppt, _dir(trunk.axis, sign), trunk.ids)
        pend.gap = max(0.0, pdist - reach)
        ends: list[End] = []
        nearest = None
        for dr, fr, ext in kids:
            st = (dr.c, bar.c) if bar.axis == "h" else (bar.c, dr.c)
            dd = _dir(dr.axis, sign)
            hit = walk(st, dd, ext, frames, skip_holding=False)
            enter = hit[1] if hit else 0.0
            e = end_at(fr, (st[0] + dd[0] * enter, st[1] + dd[1] * enter), _dir(dr.axis, -sign), dr.ids)
            e.gap = max(0.0, enter - ext)
            ends.append(e)
            reach_k = min(enter, ext)
            nearest = reach_k if nearest is None else min(nearest, reach_k)
        p_reach = pdist - pend.gap
        span = p_reach + (nearest or 0.0)
        trunk_at = p_reach / span if span > 0 else 0.5
        conn = Connector("tree", pend, ends, bar.key, None if abs(trunk_at - 0.5) < 0.02 else round(trunk_at, 3),
                         set(bar.ids) | set(trunk.ids))
        out.append(conn)
        # what the tree draws
        pts = [k[0].c for k in kids] + [trunk.c]
        pieces.take(bar, min(pts), max(pts))
        tstart = bar.c - sign * min(pdist, reach)
        pieces.take(trunk, tstart, bar.c)
        for dr, fr, ext in kids:
            pieces.take(dr, bar.c, bar.c + sign * ext)
            conn.ids |= dr.ids
    return out


def _ends(s: Seg) -> tuple[tuple, tuple]:
    return s.point(s.lo), s.point(s.hi)


def _close(p: tuple, q: tuple) -> bool:
    return abs(p[0] - q[0]) <= JOIN and abs(p[1] - q[1]) <= JOIN


def chains(segs: list[Seg]) -> list[list[Seg]]:
    """Polylines of segments joined end to end (corners); a segment that
    meets another anywhere but at both ends' corners stands alone."""
    n = len(segs)
    links: dict[int, list[int]] = {i: [] for i in range(n)}
    branch = set()
    for i in range(n):
        for j in range(i + 1, n):
            if not meets(segs[i], segs[j]):
                continue
            corner = any(_close(p, q) for p in _ends(segs[i]) for q in _ends(segs[j]))
            if corner and segs[i].axis != segs[j].axis:
                links[i].append(j)
                links[j].append(i)
            else:
                branch |= {i, j}
    for i in range(n):
        if len(links[i]) > 2:
            branch.add(i)
    seen: set[int] = set()
    out: list[list[Seg]] = []
    for i in range(n):
        if i in seen:
            continue
        if i in branch:
            seen.add(i)
            out.append([segs[i]])
            continue
        # walk to one end of the chain, then along it
        comp, stack = [], [i]
        while stack:
            k = stack.pop()
            if k in seen or k in branch:
                continue
            seen.add(k)
            comp.append(k)
            stack += [m for m in links[k] if m not in seen and m not in branch]
        ends = [k for k in comp if len([m for m in links[k] if m in comp]) < 2]
        if not ends:      # a closed loop
            out.append([segs[k] for k in comp])
            continue
        order, prev, cur = [], None, ends[0]
        while cur is not None:
            order.append(cur)
            nxt = [m for m in links[cur] if m in comp and m != prev and m not in order]
            prev, cur = cur, (nxt[0] if nxt else None)
        out.append([segs[k] for k in order])
    return out


def polyline(chain: list[Seg]) -> list[tuple]:
    """The points of a chain from one end to the other."""
    if len(chain) == 1:
        return list(_ends(chain[0]))
    a, b = _ends(chain[0])
    nxt = _ends(chain[1])
    pts = [b, a] if any(_close(a, q) for q in nxt) else [a, b]
    for s in chain[1:]:
        p, q = _ends(s)
        pts.append(q if _close(p, pts[-1]) else p)
    return pts


def _unit(p: tuple, q: tuple) -> tuple[int, int]:
    """Axis direction from p to q."""
    dx, dy = q[0] - p[0], q[1] - p[1]
    if abs(dx) >= abs(dy):
        return (1 if dx > 0 else -1, 0)
    return (0, 1 if dy > 0 else -1)


def read_chain(chain: list[Seg], frames: list[Frame]) -> Connector | None:
    """Two or three segments end to end between two frames: an elbow."""
    if not 2 <= len(chain) <= 3:
        return None
    pts = polyline(chain)
    a, b = pts[0], pts[-1]
    da = _unit(pts[1], a)          # going out past a
    db = _unit(pts[-2], b)
    fa = attach(a, da, frames)
    fb = attach(b, db, frames, skip={fa.name} if fa else None)
    if fa is None or fb is None or fa.name == fb.name:
        return None
    ea = end_at(fa, a, (-da[0], -da[1]), chain[0].ids)
    eb = end_at(fb, b, (-db[0], -db[1]), chain[-1].ids)
    if ea.point is not None and eb.point is None:
        ea, eb = eb, ea
        pts = pts[::-1]
    if ea.point is not None:
        return None        # a line between two points of pictures
    trunk = None
    if len(chain) == 3:
        mid = pts[1:3]
        first_axis = "h" if abs(pts[1][0] - pts[0][0]) > abs(pts[1][1] - pts[0][1]) else "v"
        k = 0 if first_axis == "h" else 1
        span = pts[3][k] - pts[0][k]
        if abs(span) > 1e-6:
            trunk = round((mid[0][k] - pts[0][k]) / span, 3)
            if abs(trunk - 0.5) < 0.02:
                trunk = None
    ids = set().union(*(s.ids for s in chain))
    return Connector("elbow", ea, [eb], chain[0].key, trunk, ids, over=crosses_over(chain, frames, {ea.frame, eb.frame}))


def read_segment(s: Seg, frames: list[Frame]) -> tuple[list[Connector], list[Seg]]:
    """One straight line: a connector over each run between two frames it
    passes, an end deep in a picture as an anchor; the runs that reach no
    frame are returned."""
    lo_p, hi_p = s.point(s.lo), s.point(s.hi)
    fwd, back = _dir(s.axis, 1), _dir(s.axis, -1)
    start = attach(lo_p, back, frames)
    end = attach(hi_p, fwd, frames, skip={start.name} if start else None)
    hs = [h for h in hits(s.axis, s.c, s.lo, s.hi, frames)]
    # an anchor end: the picture the line ends in is a point, not a box it passes
    a_lo = end_at(start, lo_p, fwd, s.ids) if start else None
    a_hi = end_at(end, hi_p, back, s.ids) if end else None
    stations: list[tuple[float, float, Any]] = []     # (enter, exit, frame or anchor End)
    shown_over: set = set()
    for a0, a1, f in hs:
        if a_lo is not None and a_lo.point is not None and f.name == start.name:
            continue
        if a_hi is not None and a_hi.point is not None and f.name == end.name:
            continue
        if f.kind in ("picture", "figure") and f.shows is not None:
            lo, hi = max(a0, s.lo), min(a1, s.hi)
            if hi > lo and over(f, s.point((lo + hi) / 2), back, s.ids):
                shown_over.add(f.name)     # drawn over the picture: it does not cut the line
                continue
        stations.append((a0, a1, f))
    if a_lo is not None and a_lo.point is not None:
        stations.append((s.lo, s.lo, a_lo))
    if a_hi is not None and a_hi.point is not None:
        stations.append((s.hi, s.hi, a_hi))
    stations.sort(key=lambda h: (h[0], -h[1]))
    # merge overlapping frames (one inside another): the run starts where the last leaves
    merged: list[list] = []
    for a0, a1, f in stations:
        if merged and a0 <= merged[-1][1] + 0.3 and not isinstance(f, End) and not isinstance(merged[-1][2], End):
            if a1 > merged[-1][1]:
                merged[-1][1] = a1
                merged[-1][3] = f
            continue
        merged.append([a0, a1, f, f])
    conns: list[Connector] = []
    stubs: list[Seg] = []
    prev = None
    for a0, a1, first, last in merged:
        if prev is not None:
            p_exit, p_frame = prev
            if a0 - p_exit > RUN:
                e1 = p_frame if isinstance(p_frame, End) else _side_end(p_frame, s, p_exit, fwd, back, leaving=True)
                e2 = first if isinstance(first, End) else _side_end(first, s, a0, fwd, back, leaving=False)
                if isinstance(e1, End) and e1.point is not None:
                    e1, e2 = e2, e1
                lo_t, hi_t = min(p_exit, a0), max(p_exit, a0)
                run = Seg(s.axis, s.c, lo_t, hi_t, s.key, s.ids)
                conns.append(Connector("straight", e1, [e2], s.key, None, set(s.ids),
                                       over=crosses_over([run], frames, {e1.frame, e2.frame})))
        elif a0 - s.lo > RUN:
            stubs.append(Seg(s.axis, s.c, s.lo, min(a0, s.hi), s.key, set(s.ids)))
        prev = (a1, last)
    if prev is None:
        return [], [s]
    if not conns and len(merged) == 1 and isinstance(merged[0][2], Frame) and merged[0][2].kind not in OPAQUE \
            and merged[0][0] <= s.lo + RUN and merged[0][1] >= s.hi - RUN:
        return [], [s]     # a rule inside a text frame (its frame paints no ground): it shows
    if s.hi - prev[0] > RUN:
        stubs.append(Seg(s.axis, s.c, max(prev[0], s.lo), s.hi, s.key, set(s.ids)))
    # the gap of an end that stops short of its frame
    for cn in conns:
        for e in [cn.start] + cn.ends:
            if e.point is None:
                f = next(x for x in frames if x.name == e.frame)
                p = lo_p if f is start else hi_p if f is end else None
                if p is not None and not inside(p, f.box):
                    e.at, e.gap = side_point(f.box, e.side, p)
    return conns, stubs


def _side_end(f: Frame, s: Seg, t: float, fwd: tuple, back: tuple, leaving: bool) -> End:
    """A run's end on the side of `f` it leaves (going forward) or meets."""
    side = side_facing(fwd if leaving else back)
    at, _ = side_point(f.box, side, s.point(t))
    return End(f.name, side, at, 0.0, span=side_length(f.box, side), xy=s.point(t))


# ---------------------------------------------------------------------------
# path data
# ---------------------------------------------------------------------------


def _n(v: float) -> str:
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def segs_path(segs: list[Seg], origin: tuple) -> str:
    """SVG path data of segments, in mm from `origin`, polylines joined."""
    parts = []
    for ch in chains(segs):
        pts = polyline(ch)
        if (pts[0][1], pts[0][0]) > (pts[-1][1], pts[-1][0]):
            pts = pts[::-1]
        parts.append("M" + " L".join(f"{_n(x - origin[0])} {_n(y - origin[1])}" for x, y in pts))
    return " ".join(parts)


def items_path(items: list[tuple], origin: tuple, close: bool) -> str:
    """SVG path data of a PDF path's items (mm points: ('l', p, q), ('c', p1,
    p2, p3, p4), ('re', x0, y0, x1, y1), ('qu', p1, p2, p3, p4)), from
    `origin`. A new subpath starts where an item does not begin at the last
    point."""
    out: list[str] = []
    last = None

    def pt(p: tuple) -> str:
        return f"{_n(p[0] - origin[0])} {_n(p[1] - origin[1])}"

    def move(p: tuple) -> None:
        nonlocal last
        if last is None or abs(p[0] - last[0]) > 0.01 or abs(p[1] - last[1]) > 0.01:
            if out and close:
                out.append("Z")
            out.append("M" + pt(p))

    for it in items:
        k = it[0]
        if k == "l":
            move(it[1])
            out.append("L" + pt(it[2]))
            last = it[2]
        elif k == "c":
            move(it[1])
            out.append("C" + " ".join(pt(p) for p in it[2:5]))
            last = it[4]
        elif k == "re":
            x0, y0, x1, y1 = it[1:5]
            if out and close and last is not None:
                out.append("Z")
            out.append(f"M{pt((x0, y0))} L{pt((x1, y0))} L{pt((x1, y1))} L{pt((x0, y1))} Z")
            last = None
        elif k == "qu":
            q = it[1:5]
            if out and close and last is not None:
                out.append("Z")
            out.append(f"M{pt(q[0])} L{pt(q[1])} L{pt(q[3])} L{pt(q[2])} Z")
            last = None
    if close and out and not out[-1].endswith("Z"):
        out.append("Z")
    return " ".join(out)


def card_tab_path(card: tuple, card_r: float, tab: tuple, tab_r: float) -> str | None:
    """The outline of a card and a tab grown out of its top edge, as one
    shape (mm from the card's box corner, the tab's rise above it included:
    the path's box is the union of the two). None when the tab does not
    stand on the card's top edge inside its width."""
    x0, y0, x1, y1 = card
    tx0, ty0, tx1, ty1 = tab
    if not (ty0 < y0 - 0.5 and ty1 > y0 + 0.2 and tx0 >= x0 - 0.5 and tx1 <= x1 + 0.5):
        return None
    ox, oy = min(x0, tx0), ty0
    R, r = card_r, tab_r

    def p(x: float, y: float) -> str:
        return f"{_n(x - ox)} {_n(y - oy)}"

    def arc(rad: float, x: float, y: float) -> str:
        return f"A{_n(rad)} {_n(rad)} 0 0 1 {p(x, y)}" if rad > 0.05 else f"L{p(x, y)}"

    flush_l = tx0 - x0 < 0.6
    flush_r = x1 - tx1 < 0.6
    d = []
    if flush_l:
        d.append(f"M{p(x0, ty0 + r)}")
        d.append(arc(r, x0 + r, ty0))
    else:
        d.append(f"M{p(x0, y0 + R)}")
        d.append(arc(R, x0 + R, y0))
        d.append(f"L{p(tx0, y0)}")
        d.append(f"L{p(tx0, ty0 + r)}")
        d.append(arc(r, tx0 + r, ty0))
    if flush_r:
        d.append(f"L{p(x1 - r, ty0)}")
        d.append(arc(r, x1, ty0 + r))
    else:
        d.append(f"L{p(tx1 - r, ty0)}")
        d.append(arc(r, tx1, ty0 + r))
        d.append(f"L{p(tx1, y0)}")
        d.append(f"L{p(x1 - R, y0)}")
        d.append(arc(R, x1, y0 + R))
    d.append(f"L{p(x1, y1 - R)}")
    d.append(arc(R, x1 - R, y1))
    d.append(f"L{p(x0 + R, y1)}")
    d.append(arc(R, x0, y1 - R))
    d.append("Z")
    return " ".join(d)
