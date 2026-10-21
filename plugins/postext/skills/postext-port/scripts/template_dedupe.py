#!/usr/bin/env python3
"""Fold the page templates and styles measured page by page into a library
that does not grow with the page count: near-identical styles become one,
pages of one kind share one template, pages that differ by a frame or two
get a template that `extends` the shared one, and pictures that repeat (the
same page ground on every page) become one resource.

  template_dedupe.py DIR [--geom-tol 3] [--style-tol 0.5] [--padding-tol 1.5]
                         [--delta-e 3] [--max-diff 2] [--image-tol 2]
                         [--keep-frame-names] [--dry-run] [--json]
                         [--laid FRAMES] [--no-grids] [--no-modules]
                         [--lattice-tol 1] [--grid-min 3] [--module-tol 0.5]
                         [--member-reach 8] [--no-rows] [--no-looks] [--no-shell-merge]
  template_dedupe.py DIR --compare-boxes BEFORE AFTER [--box-tol 0.5]

DIR is what `pdf_regions.py extract` wrote: library.json (pageTemplates,
calloutStyles, markStyles, chipStyles, labelStyles), resources.json and
chapters/<lang>/*.md. The script rewrites the three in place (with
--dry-run it only reports) and writes dedupe-report.json:

- **Styles.** Two styles are one when they have the same fields, their
  lengths differ by at most --style-tol mm (font sizes by 0.25 pt), their
  padding by at most --padding-tol mm and their colours by at most
  --delta-e (CIEDE2000). The style used by most frames is kept, renamed by
  role and colour (`box-light-blue`, `tab-white`, `text-frutiger-12`); a
  frame whose padding differs from the kept style's by more than 0.3 mm
  keeps its own `padding`. Frame `style`s, anchor `style`s and the
  `{style="…"}` of `:mark`/`:chip` in the Markdown follow the new ids.
- **Grids and modules** (template_fold.py, before the templates are
  merged; it needs regions.json). Frames of one look on a lattice become a
  repeating grid group, with what hangs from each card as its members, and
  the page's pieces one `:::frame{slot}` item per card; every band of
  frames becomes a module in one modules group filling the page, so the
  page template is a shell (the furniture every page of a side paints
  alike, folios, running heads), alike modules across the book one module
  template, and the page
  writes `:::module{template}` blocks holding the bands' pieces. --laid
  reads the boxes off the draft as laid (`render.mjs --frames`) rather
  than as measured; --no-grids / --no-modules skip either. The report's
  `pages` gives every frame's name on the laid page, which
  --compare-boxes BEFORE AFTER uses to list every frame that moved by more
  than --box-tol mm once the result is laid out again. A band whose
  clusters stand side by side is a row of modules (rows in the page's
  equal columns one after another a modules grid) inside the stack
  (`within`, `templates`; --no-rows: one module). Cards whose styles
  differ only in colours are one grid: the set keeps the style most cards
  have, the others a named look (`frameLooks`, `look=` on the piece;
  --no-looks turns it off). A member hangs at most --member-reach mm off
  its card.
- **One shell.** Page templates that differ only by furniture (front
  matter with no folio) are one: what some pages leave out is drawn
  `unless` their fence says `frontmatter` (`backmatter`, `variant-N`),
  what only some draw `when` it does, and those fences carry the word
  (--no-shell-merge keeps a shell each).
- **Templates.** Two templates are one kind of page when every frame of the
  same name has the same style, role and flags and stands within --geom-tol
  mm (position, width, minimum and maximum height); their groups are the
  same; their decoration is the same except elements kept to one side
  (`parity`), which are joined. A template that differs from a shared one
  in at most --max-diff frames becomes a child: `extends` plus a patch with
  only the frames that differ (`remove: true` for a frame it lacks).
  Templates are named by what they hold (`title-text-box2-picture`), never
  by page number; the page fences follow the new ids.
- **Frame names.** `pdf_regions.py` names a frame by kind and order on its
  page (`box-4`, `picture-7`), which says nothing to whoever corrects or
  translates the page and means a different box in the next template. Once
  the templates are merged, a frame named that way is renamed by its role,
  never by what it says: a box after its callout style (`box-light-blue`,
  `box-light-blue-tab-white` when the style carries a tab), a picture or a
  figure `picture` / `figure`, a frame inside another `<role>-in-<parent>`,
  a text or box set under a picture or a figure `caption-of-<picture>`, the
  flowing text `text`, the heading `title`. The same role has the same name
  in every template that has it, so a page can change template without its
  Markdown changing; two of one role in a template are numbered in reading
  order (`picture`, `picture-2`). Children keep the names of the template
  they extend; frames you named yourself are left alone. Anchors, groups and
  the `slot="…"` of every page fence, in every language, follow. The report
  lists each renamed frame; `--keep-frame-names` leaves the names as they
  are.
- **Pictures.** Resources that a template's decoration reads from a page
  attribute (`resourceId: "{attr.fondo}"`) and look alike (mean difference
  of a 512-pixel thumbnail at most --image-tol on 0–255) become one; the
  page fences name the one kept and the other files are deleted.

The report lists every merge with the largest difference it accepted, so a
merge that is wrong can be undone by tightening a tolerance.
"""
from __future__ import annotations

import argparse
import colorsys
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import template_fold as tf  # noqa: E402

# ---------------------------------------------------------------------------
# colours
# ---------------------------------------------------------------------------


def hex_rgb(h: str) -> tuple[float, float, float]:
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def rgb_lab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(c) for c in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def delta_e(a: str, b: str) -> float:
    """CIEDE2000 between two #rrggbb colours."""
    L1, a1, b1 = rgb_lab(hex_rgb(a))
    L2, a2, b2 = rgb_lab(hex_rgb(b))
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cm = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    if C1p * C2p == 0:
        dhp = 0.0
    elif abs(h2p - h1p) <= 180:
        dhp = h2p - h1p
    else:
        dhp = h2p - h1p - 360 if h2p > h1p else h2p - h1p + 360
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp / 2))
    Lm, Cmp = (L1 + L2) / 2, (C1p + C2p) / 2
    if C1p * C2p == 0:
        hm = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hm = (h1p + h2p) / 2
    else:
        hm = (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2
    T = (1 - 0.17 * math.cos(math.radians(hm - 30)) + 0.24 * math.cos(math.radians(2 * hm))
         + 0.32 * math.cos(math.radians(3 * hm + 6)) - 0.20 * math.cos(math.radians(4 * hm - 63)))
    dtheta = 30 * math.exp(-(((hm - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7))
    Sl = 1 + 0.015 * (Lm - 50) ** 2 / math.sqrt(20 + (Lm - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cmp, 1 + 0.015 * Cmp * T
    Rt = -math.sin(math.radians(2 * dtheta)) * Rc
    return math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


_HUES = [(15, "red"), (40, "orange"), (65, "yellow"), (160, "green"), (195, "teal"), (255, "blue"),
         (290, "purple"), (335, "pink"), (360, "red")]


def colour_name(h: str | None) -> str:
    """A plain English name for a colour, for ids: white, light-blue, green…"""
    if not h:
        return "none"
    r, g, b = hex_rgb(h)
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    L = rgb_lab((r, g, b))[0]
    chroma = max(r, g, b) - min(r, g, b)
    if chroma < 0.08:
        return "white" if L > 95 else "light-grey" if L > 75 else "grey" if L > 40 else "dark-grey" if L > 15 else "black"
    deg = hh * 360
    name = next(n for limit, n in _HUES if deg < limit)
    if L > 85:
        return "light-" + name
    if L < 35:
        return "dark-" + name
    return name


# ---------------------------------------------------------------------------
# values
# ---------------------------------------------------------------------------

PT_MM = 25.4 / 72


def is_dim(v: Any) -> bool:
    return isinstance(v, dict) and set(v) == {"value", "unit"} and isinstance(v["value"], (int, float))


def is_colour(v: Any) -> bool:
    return isinstance(v, dict) and isinstance(v.get("hex"), str)


def dim_mm(v: dict) -> float | None:
    u = v["unit"]
    if u == "mm":
        return float(v["value"])
    if u == "pt":
        return float(v["value"]) * PT_MM
    if u == "cm":
        return float(v["value"]) * 10
    if u == "in":
        return float(v["value"]) * 25.4
    return None


def leaves(node: Any, path: str = "") -> dict[str, Any]:
    """path -> leaf; dimensions and colours are leaves."""
    if is_dim(node) or is_colour(node) or not isinstance(node, dict):
        return {path: node}
    out: dict[str, Any] = {}
    for k in sorted(node):
        out.update(leaves(node[k], f"{path}/{k}"))
    return out


def leaf_diff(a: Any, b: Any, path: str, tol: dict) -> float | None:
    """None when the two leaves differ beyond tolerance, else how far apart
    they are (mm for lengths, ΔE for colours, 0 for equal values)."""
    if is_dim(a) and is_dim(b):
        ma, mb = dim_mm(a), dim_mm(b)
        if ma is None or mb is None:
            return 0.0 if a == b else None
        d = abs(ma - mb)
        if path.endswith("fontSize"):
            return d if d <= tol["font"] * PT_MM + 1e-9 else None
        limit = tol["padding"] if "/padding/" in path + "/" else tol["dim"]
        return d if d <= limit + 1e-9 else None
    if is_colour(a) and is_colour(b):
        d = delta_e(a["hex"], b["hex"])
        return d if d <= tol["delta_e"] else None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return 0.0 if abs(a - b) < 1e-6 else (abs(a - b) if path.endswith("lineHeight") and abs(a - b) <= 0.05 else None)
    return 0.0 if a == b else None


#: style blocks that only act when the content has them: a style without
#: one takes the other's
OPTIONAL_BLOCKS = ("lists",)


def style_match(a: dict, b: dict, tol: dict) -> tuple[bool, dict]:
    skip = {k for k in OPTIONAL_BLOCKS if (k in a) != (k in b)}
    la = {k: v for k, v in leaves(a).items() if k not in ("/id", "/name") and k.split("/")[1] not in skip}
    lb = {k: v for k, v in leaves(b).items() if k not in ("/id", "/name") and k.split("/")[1] not in skip}
    if set(la) != set(lb):
        return False, {}
    worst = {"mm": 0.0, "deltaE": 0.0}
    for k in la:
        d = leaf_diff(la[k], lb[k], k, tol)
        if d is None:
            return False, {}
        key = "deltaE" if is_colour(la[k]) else "mm"
        worst[key] = max(worst[key], round(d, 3))
    return True, worst


# ---------------------------------------------------------------------------
# colours a named look can carry (#1089)
# ---------------------------------------------------------------------------

#: style paths (as `leaves` writes them) a frame look (`frameLooks`, the
#: fields of `FrameConfig.look`) can recolour
LOOK_PATHS = ("/background", "/border/color", "/stripe/color", "/icon/color", "/marker/color",
              "/marker/rule/color", "/titleStyle/color", "/body/color", "/body/boldColor", "/body/italicColor",
              "/label/color", "/label/background", "/label/rule/color")


def centred(st: dict) -> dict:
    """The style as a lattice compares it: words set left with even padding
    on both sides (within 1 mm, the way extract reads a pill whose word it
    measured centred) are centred words, and centred words do not depend on
    the side padding, so neither is compared."""
    body = st.get("body") or {}
    pad = st.get("padding") or {}
    left, right = pad.get("left"), pad.get("right")
    align = body.get("textAlign", "left")
    even = is_dim(left) and is_dim(right) and abs((dim_mm(left) or 0) - (dim_mm(right) or 0)) <= 1.0
    if align == "center" or (align in ("left", "start") and even):
        st = {**st, "body": {**body, "textAlign": "center"},
              "padding": {k: v for k, v in pad.items() if k not in ("left", "right")}}
    return st


def style_class(st: dict) -> str:
    """A style with the colours a look can carry left out: styles of one
    class differ only in those colours (and in how they centre their
    words, `centred`)."""
    out = {k: ("*" if k in LOOK_PATHS and is_colour(v) else v) for k, v in leaves(centred(st)).items()
           if k not in ("/id", "/name")}
    return json.dumps(out, sort_keys=True)


def colour_look(a: dict, b: dict, tol: dict) -> dict | None:
    """The look that dresses style `a` as style `b`: the colours of `b` that
    differ from `a`'s (beyond --delta-e), as a `frameLooks` entry's fields;
    {} when the two are alike, None when they differ in anything else (a
    pill read with even side padding and one read centred are alike:
    `centred`)."""
    la = {k: v for k, v in leaves(centred(a)).items() if k not in ("/id", "/name")}
    lb = {k: v for k, v in leaves(centred(b)).items() if k not in ("/id", "/name")}
    if set(la) != set(lb):
        return None
    look: dict[str, Any] = {}
    for k in la:
        if leaf_diff(la[k], lb[k], k, tol) is not None:
            continue
        if k not in LOOK_PATHS or not is_colour(lb[k]):
            return None
        node = look
        parts = k.strip("/").split("/")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = {"hex": lb[k]["hex"], "model": lb[k].get("model", "hex")}
    return look


def look_colour(look: dict) -> str | None:
    """A look's most visible colour (hex)."""
    for path in (("background",), ("label", "background"), ("border", "color"), ("stripe", "color"),
                 ("body", "color"), ("label", "color")):
        node: Any = look
        for part in path:
            node = node.get(part) if isinstance(node, dict) else None
        if is_colour(node):
            return node["hex"]
    return None


def look_name(look: dict, roles: list[tuple[str, str]] | None = None, delta: float = 3.0) -> str:
    """A plain name for a look: the role its colour has where the book
    already says what that colour marks (`look_roles`: a palette entry, a
    style named by role, the page's own colour), else its colour."""
    hx = look_colour(look)
    if hx is None:
        return "colour"
    for rh, role in roles or []:
        if delta_e(hx, rh) <= delta:
            return role
    return colour_name(hx)


def _named_by_role(sid: str, generated: str) -> bool:
    """An id a person gave (`tip`, `key-term`), not one dedupe made from
    the style's kind and colours (`box-light-blue-2`)."""
    base = re.sub(r"-\d+$", "", sid)
    if not base or base.split("-")[0] in ("box", "tab", "text", "title", "frame", "callout"):
        return False      # a kind and what follows it: a name made of the style's looks
    return base != generated and not base.startswith(generated + "-")


def look_roles(library: dict, templates: list[dict] | None = None) -> list[tuple[str, str]]:
    """(hex, role) of the colours whose role the book already names, most
    telling first: a palette entry with an id that is no colour name
    (`brand`, `part-green` is fine, `light-green` is not), the background
    (or tab) of a callout style named by role, and the page's own colour
    (`page-colour`, the ground every page of the book is set on)."""
    out: list[tuple[str, str]] = []
    for e in library.get("colorPalette") or []:
        val = e.get("value") if isinstance(e, dict) else None
        eid = str(e.get("id") or "") if isinstance(e, dict) else ""
        if is_colour(val) and eid and eid != colour_name(val["hex"]):
            out.append((val["hex"], slug(eid)))
    for st in library.get("calloutStyles") or []:
        sid = str(st.get("id") or "")
        if not sid or not _named_by_role(sid, style_role(st, "calloutStyles")):
            continue
        for node in (st.get("background") if st.get("backgroundEnabled", True) else None,
                     (st.get("label") or {}).get("background")):
            if is_colour(node):
                out.append((node["hex"], slug(sid)))
                break
    for t in templates or []:
        for el in (t.get("decoration") or {}).get("elements", []) if isinstance(t.get("decoration"), dict) else []:
            bg = (el.get("style") or {}).get("backgroundColor") if isinstance(el, dict) else None
            if str(el.get("id", "")).startswith("page-colour") and is_colour(bg):
                out.append((bg["hex"], "page-colour"))
                break
    return out


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "look"


def look_book(styles: list[dict], tol: dict, taken: set[str] | None = None,
              roles: list[tuple[str, str]] | None = None) -> "tf.LookBook":
    by = {s["id"]: s for s in styles}
    classes = {s["id"]: style_class(s) for s in styles}

    def between(x: str, y: str) -> dict | None:
        if x not in by or y not in by:
            return None
        return colour_look(by[x], by[y], tol)

    def name(look: dict) -> str:
        return look_name(look, roles, tol.get("delta_e", 3.0))

    return tf.LookBook(classes, between, name, taken)


# ---------------------------------------------------------------------------
# styles
# ---------------------------------------------------------------------------


def style_role(st: dict, kind: str) -> str:
    sid = st.get("id", "")
    if kind == "calloutStyles":
        role = sid.split("-")[0] if sid.split("-")[0] in ("box", "tab", "text", "title") else "box"
        if role == "text":
            fam = re.sub(r"[^a-z0-9]+", "-", str(st.get("body", {}).get("fontFamily", "")).lower()).strip("-")
            size = st.get("body", {}).get("fontSize", {}).get("value")
            fam = "-".join(fam.split("-")[:2]) or "body"
            return f"text-{fam}" + (f"-{_num(size)}" if size else "")
        fill = st.get("background", {}).get("hex") if st.get("backgroundEnabled", True) else None
        stroke = st.get("border", {}).get("color", {}).get("hex") if st.get("border", {}).get("enabled") else None
        name = f"{role}-{colour_name(fill) if fill else ('outline-' + colour_name(stroke) if stroke else 'clear')}"
        if st.get("label"):
            name += "-tab-" + colour_name(st["label"].get("background", {}).get("hex"))
        return name
    if kind in ("markStyles", "chipStyles"):
        return ("mark-" if kind == "markStyles" else "chip-") + colour_name(st.get("background", {}).get("hex"))
    if kind == "labelStyles":
        return re.sub(r"-\d+$", "", sid) if sid else "label"
    return sid or "style"


def _num(v: Any) -> str:
    return str(round(float(v), 2)).rstrip("0").rstrip(".")


def dedupe_styles(styles: list[dict], kind: str, usage: dict[str, int], tol: dict,
                  rename: bool = True) -> tuple[list[dict], dict[str, str], list[dict]]:
    """(kept styles, old id -> new id, merges)."""
    order = sorted(styles, key=lambda s: (-usage.get(s["id"], 0), s["id"]))
    reps: list[dict] = []
    members: dict[str, list[tuple[str, dict]]] = {}
    for st in order:
        hit = None
        for rep in reps:
            ok, worst = style_match(rep, st, tol)
            if ok:
                hit = (rep, worst)
                break
        if hit:
            members[hit[0]["id"]].append((st["id"], hit[1]))
            for k in OPTIONAL_BLOCKS:
                if k in st and k not in hit[0]:
                    hit[0][k] = st[k]
        else:
            reps.append(st)
            members[st["id"]] = []
    mapping: dict[str, str] = {}
    used: set[str] = set()
    kept, merges = [], []
    for rep in reps:
        new = rep["id"]
        if rename:
            base = style_role(rep, kind)
            new, n = base, 2
            while new in used:
                new, n = f"{base}-{n}", n + 1
        used.add(new)
        mapping[rep["id"]] = new
        for old, _ in members[rep["id"]]:
            mapping[old] = new
        kept.append({**rep, "id": new})
        if members[rep["id"]] or new != rep["id"]:
            merges.append({"id": new, "from": [rep["id"]] + [m for m, _ in members[rep["id"]]],
                           "largest": {k: max([w[k] for _, w in members[rep["id"]]] + [0.0]) for k in ("mm", "deltaE")}})
    kept.sort(key=lambda s: s["id"])
    return kept, mapping, merges


# ---------------------------------------------------------------------------
# templates
# ---------------------------------------------------------------------------

GEOM_KEYS = ("width", "height", "minHeight", "maxHeight", "minWidth", "maxWidth")


def frame_geom(f: dict) -> dict:
    """The comparable form of a frame: geometry in mm, the rest as is."""
    out: dict[str, Any] = {}
    for k, v in f.items():
        if k == "placement" and isinstance(v, dict):
            a = v.get("anchor", {})
            out["anchor"] = (a.get("to"), a.get("edge"))
            off = v.get("offset", {})
            out["dx"] = dim_mm(off["x"]) if is_dim(off.get("x")) else 0.0
            out["dy"] = dim_mm(off["y"]) if is_dim(off.get("y")) else 0.0
        elif k in GEOM_KEYS and is_dim(v):
            out[k] = dim_mm(v)
        elif k == "padding" and isinstance(v, dict):
            out["padding"] = {s: dim_mm(d) for s, d in sorted(v.items()) if is_dim(d)}
        else:
            out[k] = v
    return out


def frame_diff(a: dict, b: dict, tol: float) -> float | None:
    """None when two frames differ, else the largest distance in mm."""
    ga, gb = frame_geom(a), frame_geom(b)
    if set(ga) != set(gb):
        return None
    worst = 0.0
    for k in ga:
        va, vb = ga[k], gb[k]
        if k in ("dx", "dy") + GEOM_KEYS:
            if va is None or vb is None:
                if va != vb:
                    return None
                continue
            d = abs(va - vb)
            if d > tol + 1e-9:
                return None
            worst = max(worst, d)
        elif k == "padding":
            if set(va) != set(vb) or any(abs(va[s] - vb[s]) > tol for s in va):
                return None
        elif va != vb:
            return None
    return worst


def joinable(el: dict) -> bool:
    """An element two templates may differ by and still be one: one kept
    to one side (`parity`), or one that reads a page attribute
    (`{attr.ground}`, `{attr.head}`), which draws nothing on a page whose
    fence does not set it."""
    if el.get("parity") not in (None, "all"):
        return True
    return "{attr." in str(el.get("content", "")) or str(el.get("resourceId", "")).startswith("{attr.")


def element_key(el: dict) -> str:
    return str(el.get("id") or json.dumps(el, sort_keys=True))


def element_diff(a: dict, b: dict, tol: float) -> float | None:
    pa, pb = a.get("placement", {}), b.get("placement", {})
    ra = {k: v for k, v in a.items() if k != "placement"}
    rb = {k: v for k, v in b.items() if k != "placement"}
    if ra != rb or pa.get("anchor") != pb.get("anchor"):
        return None
    worst = 0.0
    for sect in ("offset", "size"):
        sa, sb = pa.get(sect, {}), pb.get(sect, {})
        if set(sa) != set(sb):
            return None
        for k in sa:
            if is_dim(sa[k]) and is_dim(sb[k]):
                d = abs((dim_mm(sa[k]) or 0) - (dim_mm(sb[k]) or 0))
                if sect == "size" and k == "width" and text_width_free(a):
                    continue
                if d > tol:
                    return None
                worst = max(worst, d)
            elif sa[k] != sb[k]:
                return None
    return worst


def text_width_free(el: dict) -> bool:
    """A one-line text element (a running head) set flush to the side it is
    anchored by: its box's width only says how long the words were, so two
    such elements are one whatever their widths (the widest is kept)."""
    if el.get("kind") != "text" or "\n" in str(el.get("content", "")):
        return False
    edge = str(((el.get("placement") or {}).get("anchor") or {}).get("edge", ""))
    align = el.get("align", "left")
    return (align == "right" and edge.endswith("right")) or (align == "left" and edge.endswith("left"))


def widen_texts(keep: dict, other: dict) -> None:
    """Give `keep`'s width-free text elements the widest width `other` has
    for the same element."""
    theirs = {element_key(e): e for e in decoration_of(other)}
    for e in decoration_of(keep):
        o = theirs.get(element_key(e))
        if not o or not text_width_free(e):
            continue
        we = ((e.get("placement") or {}).get("size") or {}).get("width")
        wo = ((o.get("placement") or {}).get("size") or {}).get("width")
        if is_dim(we) and is_dim(wo) and (dim_mm(wo) or 0) > (dim_mm(we) or 0):
            e["placement"]["size"]["width"] = dict(wo)


def decoration_of(t: dict) -> list[dict]:
    d = t.get("decoration")
    return list(d.get("elements", [])) if isinstance(d, dict) else []


def compare_templates(a: dict, b: dict, tol: float) -> dict:
    """What differs between two templates: frames only in a / only in b /
    changed, groups that differ, and whether the decoration and the
    template-level fields allow sharing."""
    fa = {f["name"]: f for f in a.get("frames", [])}
    fb = {f["name"]: f for f in b.get("frames", [])}
    changed, worst = [], 0.0
    for n in fa:
        if n in fb:
            d = frame_diff(fa[n], fb[n], tol)
            if d is None:
                changed.append(n)
            else:
                worst = max(worst, d)
    ga = {g["name"]: g for g in a.get("groups", [])}
    gb = {g["name"]: g for g in b.get("groups", [])}
    groups = sorted(n for n in set(ga) | set(gb) if not _group_equal(ga.get(n), gb.get(n), tol))
    top = [k for k in ("area", "header", "footer", "spread", "gutter", "grid", "overflowTemplate")
           if a.get(k) != b.get(k)]
    # decoration: elements without parity must agree; parity ones join
    da = {element_key(e): e for e in decoration_of(a)}
    db = {element_key(e): e for e in decoration_of(b)}
    deco_ok, deco_worst = True, 0.0
    for k in set(da) | set(db):
        ea, eb = da.get(k), db.get(k)
        if ea is not None and eb is not None:
            d = element_diff(ea, eb, tol)
            if d is None:
                deco_ok = False
            else:
                deco_worst = max(deco_worst, d)
        else:
            e = ea or eb
            if not joinable(e):
                deco_ok = False
    return {"onlyA": sorted(set(fa) - set(fb)), "onlyB": sorted(set(fb) - set(fa)), "changed": sorted(changed),
            "groups": groups, "top": top, "decoration": deco_ok, "mm": round(max(worst, deco_worst), 2)}


def _group_equal(a: dict | None, b: dict | None, tol: float) -> bool:
    if a is None or b is None:
        return a is b
    ra = {k: v for k, v in a.items() if k != "gap"}
    rb = {k: v for k, v in b.items() if k != "gap"}
    if ra != rb:
        return False
    if is_dim(a.get("gap")) and is_dim(b.get("gap")):
        return abs((dim_mm(a["gap"]) or 0) - (dim_mm(b["gap"]) or 0)) <= tol
    return a.get("gap") == b.get("gap")


def n_diff(c: dict) -> int:
    return len(c["onlyA"]) + len(c["onlyB"]) + len(c["changed"]) + len(c["groups"])


def template_name(t: dict) -> str:
    """A name by what the template holds: title-text-box2-picture3."""
    kinds: dict[str, int] = {}
    for f in t.get("frames", []):
        kind = re.sub(r"-\d+$", "", f["name"])
        kinds[kind] = kinds.get(kind, 0) + 1
    order = ["title", "text", "box", "tab", "picture", "figure"]
    parts = []
    for k in order + sorted(set(kinds) - set(order)):
        if k in kinds:
            parts.append(k + (str(kinds[k]) if kinds[k] > 1 else ""))
    return "-".join(parts) or "page"


def patch_of(child: dict, base: dict, tol: float) -> dict:
    """The patch that makes `base` into `child`."""
    fb = {f["name"]: f for f in base.get("frames", [])}
    frames = []
    for f in child.get("frames", []):
        b = fb.get(f["name"])
        if b is None:
            frames.append(f)
        elif frame_diff(f, b, tol) is None:
            diff = {"name": f["name"]}
            for k, v in f.items():
                if k != "name" and b.get(k) != v:
                    diff[k] = v
            for k in b:
                if k not in f and k != "name" and _default_of(k) is not None:
                    # a field the child does not set: restate the default
                    diff[k] = _default_of(k)
            frames.append(diff)
    names = {f["name"] for f in child.get("frames", [])}
    frames += [{"name": n, "remove": True} for n in fb if n not in names]
    gb = {g["name"]: g for g in base.get("groups", [])}
    gc = {g["name"]: g for g in child.get("groups", [])}
    groups = [g for n, g in gc.items() if not _group_equal(g, gb.get(n), tol)]
    groups += [{"name": n, "remove": True} for n in gb if n not in gc]
    out: dict[str, Any] = {}
    if frames:
        out["frames"] = frames
    if groups:
        out["groups"] = groups
    db = {element_key(e) for e in decoration_of(base)}
    extra = [e for e in decoration_of(child) if element_key(e) not in db]
    if extra:
        out["decoration"] = {"elements": extra + repaint_over(extra, decoration_of(base))}
    return out


def repaint_over(extra: list[dict], inherited: list[dict], page: tuple[float, float] = (210.0, 297.0)) -> list[dict]:
    """A child's new decoration paints after everything it inherits (the
    engine appends a patch's new elements after the base's), so a band or a
    shape a page adds would cover the base's folio or running head. Each
    inherited text or furniture element (`is_furniture`) that an extra
    element meets is taken out and written again after the extras
    (`{"id": …, "remove": true}`, then the whole element), so it stays on
    top as on the source page. Elements whose box cannot be read (anchored
    to a frame) are left in place."""
    import template_fold as tf

    def box(el: dict):
        return tf._text_box(el, page) if el.get("kind") == "text" else tf._fixed_box(el)

    boxes = [b for b in (box(e) for e in extra) if b is not None]
    out: list[dict] = []
    for el in inherited:
        if not el.get("id") or not (el.get("kind") == "text" or tf.is_furniture(el)):
            continue
        b = box(el)
        if b is None or not any(b[0] < o[2] and o[0] < b[2] and b[1] < o[3] and o[1] < b[3] for o in boxes):
            continue
        out += [{"id": el["id"], "remove": True}, json.loads(json.dumps(el))]
    return out


_DEFAULTS = {"layer": 1, "rotate": 0, "verticalAlign": "top", "exclude": "none", "flow": False, "pin": False,
             "optional": False, "crossGutter": False, "columns": 1, "width": "fill", "height": "auto"}


def _default_of(key: str) -> Any:
    return _DEFAULTS.get(key, None)


def join_decoration(a: dict, b: dict) -> None:
    """Add to `a` the parity-bound decoration elements of `b` it lacks."""
    have = {element_key(e) for e in decoration_of(a)}
    extra = [e for e in decoration_of(b) if element_key(e) not in have]
    if extra:
        a.setdefault("decoration", {}).setdefault("elements", []).extend(extra)


def dedupe_templates(templates: list[dict], usage: dict[str, int], tol: float, max_diff: int,
                     rename: bool = True) -> tuple[list[dict], dict[str, str], list[dict]]:
    """(templates, old id -> new id, report entries). Templates already
    using `extends` are kept as they are (their parents too), and so are
    module templates (`role: "module"`, never a page's)."""
    mods = [t for t in templates if t.get("role") == "module"]
    if mods:
        rest = [t for t in templates if t.get("role") != "module"]
        out, mapping, report = dedupe_templates(rest, usage, tol, max_diff, rename)
        return out + mods, mapping, report
    fixed = [t for t in templates if t.get("extends")]
    parents = {t["extends"] for t in fixed}
    free = [t for t in templates if not t.get("extends") and t["id"] not in parents]
    keep = [t for t in templates if not t.get("extends") and t["id"] in parents]
    order = sorted(free, key=lambda t: (-usage.get(t["id"], 0), t["id"]))
    shared: list[dict] = []           # {template, members: [(id, mm)]}
    for t in order:
        hit = None
        for s in shared:
            c = compare_templates(s["template"], t, tol)
            if n_diff(c) == 0 and not c["top"] and c["decoration"]:
                hit = (s, c)
                break
        if hit:
            hit[0]["members"].append((t["id"], hit[1]["mm"]))
            join_decoration(hit[0]["template"], t)
            widen_texts(hit[0]["template"], t)
        else:
            shared.append({"template": json.loads(json.dumps(t)), "members": []})
    # single templates close to a shared one become children
    bases = [s for s in shared if s["members"]] or shared[:1]
    for s in shared:
        if s in bases or not s["template"].get("frames"):
            continue
        best = None
        for b in bases:
            c = compare_templates(b["template"], s["template"], tol)
            if c["top"] or not _decoration_extends(b["template"], s["template"], tol):
                continue
            n = n_diff(c)
            if n <= max_diff and n < max(1, len(s["template"].get("frames", [])) / 2):
                if best is None or n < best[0]:
                    best = (n, b, c)
        if best:
            s["extends"] = best[1]
            s["diff"] = best[2]
    # names
    used: set[str] = {t["id"] for t in keep + fixed}
    mapping: dict[str, str] = {}
    report = []

    def unique(base: str) -> str:
        nid, n = base, 2
        while nid in used:
            nid, n = f"{base}-{n}", n + 1
        used.add(nid)
        return nid

    for s in shared:
        if "extends" in s:
            continue
        t = s["template"]
        s["id"] = unique(template_name(t)) if rename else t["id"]
    for s in shared:
        if "extends" not in s:
            continue
        c = s["diff"]
        tag = ("with-" + c["onlyB"][0]) if c["onlyB"] else ("without-" + c["onlyA"][0]) if c["onlyA"] else \
            (c["changed"][0] + "-moved") if c["changed"] else "groups"
        s["id"] = unique(f"{s['extends']['id']}-{tag}") if rename else s["template"]["id"]
    out = list(keep) + list(fixed)
    for s in shared:
        t = s["template"]
        old = [t["id"]] + [m for m, _ in s["members"]]
        for o in old:
            mapping[o] = s["id"]
        if "extends" in s:
            base = s["extends"]
            patch = patch_of(t, base["template"], tol)
            child: dict[str, Any] = {"id": s["id"], "extends": base["id"]}
            if t.get("name"):
                child["name"] = t["name"]
            child.update(patch)
            out.append(child)
            report.append({"id": s["id"], "from": old, "extends": base["id"],
                           "differs": {k: s["diff"][k] for k in ("onlyA", "onlyB", "changed", "groups")}})
        else:
            out.append({**t, "id": s["id"]})
            report.append({"id": s["id"], "from": old,
                           "largest": max([m for _, m in s["members"]] + [0.0])})
    out, base_report = common_base(out, tol, max_diff, used)
    if base_report:
        report.insert(0, base_report)
    out.sort(key=lambda t: (1 if t.get("extends") else 0, t["id"]))
    return out, mapping, report


def common_base(templates: list[dict], tol: float, max_diff: int, used: set[str],
                share: float = 0.5) -> tuple[list[dict], dict | None]:
    """What most kinds of page share (the ground, the running heads, a title
    or a text frame standing in the same place) as one base template the
    others extend, so it is written once."""
    roots = [t for t in templates if not t.get("extends")]
    if len(roots) < 3:
        return templates, None
    need = max(2, math.ceil(share * len(roots)))
    frames: list[dict] = []
    names = sorted({f["name"] for t in roots for f in t.get("frames", [])})
    for n in names:
        cands = [f for t in roots for f in t.get("frames", []) if f["name"] == n]
        best = None
        for c in cands:
            k = sum(1 for d in cands if frame_diff(c, d, tol) is not None)
            if best is None or k > best[0]:
                best = (k, c)
        if best and best[0] >= need:
            frames.append(best[1])
    # only frames whose anchors stay inside the base
    changed = True
    while changed:
        changed = False
        names_in = {f["name"] for f in frames}
        for f in list(frames):
            to = (f.get("placement") or {}).get("anchor", {}).get("to", "container")
            if to.startswith("#") and to[1:] not in names_in:
                frames.remove(f)
                changed = True
    elements: list[dict] = []
    # in paint order (the first template that has each element says where it
    # goes): sorted by key, the page's ground came after the folios and the
    # running heads and painted over them
    keys = list(dict.fromkeys(element_key(e) for t in roots for e in decoration_of(t)))
    grounds = [k for k in keys if any(e.get("kind") == "image" and element_key(e) == k
                                      for t in roots for e in decoration_of(t))]
    keys = grounds + [k for k in keys if k not in grounds]
    for k in keys:
        cands = [e for t in roots for e in decoration_of(t) if element_key(e) == k]
        best = None
        for c in cands:
            n = sum(1 for d in cands if element_diff(c, d, tol) is not None)
            if best is None or n > best[0]:
                best = (n, c)
        if best and (best[0] >= need or joinable(best[1])):
            elements.append(best[1])
    # only elements whose frames (and elements) the base has: a connector or a border
    # between frames of some pages stays with those pages
    changed = True
    while changed:
        changed = False
        have = {f["name"] for f in frames} | {str(e.get("id")) for e in elements}
        for e in list(elements):
            if not element_targets(e) <= have:
                elements.remove(e)
                changed = True
    if not frames and not elements:
        return templates, None
    top = {k: roots[0][k] for k in ("area", "header", "footer") if k in roots[0]
           and all(t.get(k) == roots[0][k] for t in roots)}
    base: dict[str, Any] = {"id": "", **top, "frames": frames}
    if elements:
        base["decoration"] = {"elements": elements}
    bid, n = "page-base", 2
    while bid in used:
        bid, n = f"page-base-{n}", n + 1
    used.add(bid)
    base["id"] = bid
    out, children = [base], []
    for t in templates:
        if t.get("extends") or any(t.get(k) != v for k, v in top.items()):
            out.append(t)
            continue
        c = compare_templates(base, t, tol)
        if len(c["onlyA"]) + len(c["changed"]) > max_diff or not _decoration_extends(base, t, tol):
            out.append(t)
            continue
        child: dict[str, Any] = {"id": t["id"], "extends": bid}
        if t.get("name"):
            child["name"] = t["name"]
        child.update(patch_of(t, base, tol))
        if t.get("groups") and "groups" not in child:
            child["groups"] = t["groups"]
        out.append(child)
        children.append(t["id"])
    if not children:
        return templates, None
    return out, {"id": bid, "base": True, "frames": [f["name"] for f in frames],
                 "decoration": [element_key(e) for e in elements], "children": children}


def merge_furniture_shells(templates: list[dict], fences: list[str], tol: float
                           ) -> tuple[list[dict], dict[str, str], dict[str, list[str]], list[dict]]:
    """Page templates that differ only by their furniture (front matter with
    no folio, no page colour) as one, its elements drawn when the page fence
    says so (#1087): `unless: "<attr>"` on what some pages leave out, `when:
    "<attr>"` on what only some pages draw, whichever names fewer pages.
    `fences` is every page fence's template, in book order. The attribute is
    `frontmatter` for the book's first pages, `backmatter` for its last,
    else `variant-N`. Returns (templates, old id -> kept id, kept id's old
    ids -> attributes their fences set, report)."""
    roots = [t for t in templates if not t.get("extends") and t.get("role") != "module"]
    parents = {t.get("extends") for t in templates if t.get("extends")}
    cands = [t for t in roots if t["id"] not in parents]
    usage = {t["id"]: fences.count(t["id"]) for t in cands}
    cands.sort(key=lambda t: (-usage[t["id"]], t["id"]))
    used: set[str] = set()
    mapping: dict[str, str] = {}
    flags: dict[str, list[str]] = {}
    report = []
    names_taken: set[str] = set()
    out_ids: dict[str, dict] = {}
    for base in cands:
        if base["id"] in used:
            continue
        used.add(base["id"])
        group = [base]
        for t in cands:
            if t["id"] in used:
                continue
            c = compare_templates(base, t, tol)
            if n_diff(c) or c["top"] or not _furniture_only(group + [t], tol):
                continue
            group.append(t)
            used.add(t["id"])
        if len(group) < 2:
            continue
        ids = [t["id"] for t in group]
        pages = [i for i, f in enumerate(fences) if f in ids]
        # every element of the group, in paint order
        merged: list[dict] = []
        have: dict[str, set[str]] = {}
        for t in group:
            prev = None
            for e in decoration_of(t):
                k = element_key(e)
                if k not in have:
                    at = 0 if prev is None else next(i for i, m in enumerate(merged) if element_key(m) == prev) + 1
                    merged.insert(at, json.loads(json.dumps(e)))
                    have[k] = set()
                have[k].add(t["id"])
                prev = k
        # an element the extract already draws on an attribute (`when: "head"`: an ornament by a
        # running head that reads `{attr.head}`) keeps it; a second `when` cannot be added to it
        if any(len(have[element_key(e)]) < len(group) and "when" in e and len(
                [i for i in pages if fences[i] in have[element_key(e)]]) * 2 < len(pages) for e in merged):
            for t in group[1:]:
                used.discard(t["id"])
            continue
        attrs: dict[frozenset, tuple[str, str]] = {}
        for e in merged:
            on = frozenset(have[element_key(e)])
            if len(on) == len(group):
                continue
            if on not in attrs:
                with_pages = [i for i, f in enumerate(fences) if f in on]
                without = [i for i in pages if i not in with_pages]
                key, marked = ("unless", without) if len(without) <= len(with_pages) else ("when", with_pages)
                attrs[on] = (key, _fence_attr_name(marked, len(fences), names_taken))
                for tid in {fences[i] for i in marked}:
                    flags.setdefault(tid, []).append(attrs[on][1])
            key, name = attrs[on]
            e[key] = name
        keep = json.loads(json.dumps(base))
        if merged:
            keep["decoration"] = {"elements": merged}
        out_ids[base["id"]] = keep
        for t in group[1:]:
            mapping[t["id"]] = base["id"]
        report.append({"id": base["id"], "from": ids, "conditions": [
            {"element": element_key(e), **{k: e[k] for k in ("when", "unless") if k in e}}
            for e in merged if "when" in e or "unless" in e]})
    out = []
    for t in templates:
        if t["id"] in mapping:
            continue
        out.append(out_ids.get(t["id"], t))
    return out, mapping, flags, report


def _furniture_only(group: list[dict], tol: float) -> bool:
    """The templates' decorations agree on every element they share, and
    none already leaves a page out on an attribute (`unless`); a `when` the
    extract wrote (an ornament drawn with the running head it is anchored
    to) is kept."""
    seen: dict[str, dict] = {}
    for t in group:
        for e in decoration_of(t):
            if "unless" in e:
                return False
            k = element_key(e)
            if k in seen and element_diff(seen[k], e, tol) is None:
                return False
            seen.setdefault(k, e)
    return True


def _fence_attr_name(pages: list[int], total: int, taken: set[str]) -> str:
    """`frontmatter` when `pages` are the book's first pages, `backmatter`
    when its last, else `variant-N`."""
    pages = sorted(pages)
    run = bool(pages) and pages == list(range(pages[0], pages[0] + len(pages)))
    base = "frontmatter" if run and pages[0] == 0 else "backmatter" if run and pages[-1] == total - 1 else "variant"
    name, n = (base, 2) if base != "variant" else ("variant-1", 2)
    while name in taken:
        name, n = f"{base}-{n}", n + 1
    taken.add(name)
    return name


def _decoration_extends(base: dict, child: dict, tol: float) -> bool:
    """A patch can add decoration elements but not take one away."""
    dc = {element_key(e): e for e in decoration_of(child)}
    for e in decoration_of(base):
        k = element_key(e)
        if k not in dc:
            if not joinable(e):
                return False
            continue
        if element_diff(e, dc[k], tol) is None:
            return False
    return True


# ---------------------------------------------------------------------------
# pictures read from page attributes
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# frame names
# ---------------------------------------------------------------------------

POSITIONAL_RE = re.compile(r"^(title|text|box|tab|picture|figure)(?:-(\d+))?$")
POSITIONAL_STYLE_RE = re.compile(r"^(?:box|tab|text|title)-\d+$")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def resolved_frames(t: dict, resolved: dict[str, list[dict]]) -> list[dict]:
    """The frames a template ends up with: those of the template it extends
    (already resolved), minus the ones the patch removes, with the patch's
    changes laid over them, plus the frames it adds."""
    parent = t.get("extends")
    if not parent:
        return [dict(f) for f in t.get("frames", [])]
    frames = [dict(f) for f in resolved.get(parent, [])]
    index = {f["name"]: i for i, f in enumerate(frames)}
    for f in t.get("frames", []):
        n = f["name"]
        if f.get("remove"):
            if n in index:
                frames[index[n]] = {}
            continue
        if n in index and frames[index[n]]:
            frames[index[n]].update(f)
        else:
            index[n] = len(frames)
            frames.append(dict(f))
    return [f for f in frames if f]


def frame_role(f: dict, styles: dict[str, dict], names: dict[str, str], by_old: dict[str, dict],
               naming: set[str]) -> str:
    """The role name of a positionally named frame, before numbering."""
    m = POSITIONAL_RE.match(f["name"])
    kind = m.group(1) if m else "box"
    if kind == "title":
        return "title"
    if kind == "text" and f.get("flow"):
        return "text"
    if kind == "text" and f.get("rotate"):
        return "rotated-text"
    anchor = (f.get("placement") or {}).get("anchor") or {}
    to = anchor.get("to") if isinstance(anchor.get("to"), str) else None
    target = to[1:] if to and to.startswith("#") and to[1:] in by_old and to[1:] not in naming else None
    sid = f.get("style")
    base = kind
    if kind in ("box", "tab") and isinstance(sid, str) and sid and not POSITIONAL_STYLE_RE.match(sid):
        base = _slug(sid) or kind
    if target is not None:
        tn = name_of(target, styles, names, by_old, naming)
        tm = POSITIONAL_RE.match(target)
        tkind = tm.group(1) if tm else tn.split("-")[0]
        edge = anchor.get("edge")
        if edge == "below" and kind in ("text", "box") and tkind in ("picture", "figure"):
            return f"caption-of-{tn}"
        if edge in ("top-left", "bottom-left") and (f.get("layer") or 1) > 1:
            return f"{base}-in-{tn}"
    return base


def name_of(old: str, styles: dict[str, dict], names: dict[str, str], by_old: dict[str, dict],
            naming: set[str]) -> str:
    """The new name of frame `old`, worked out when it has none yet: its
    role, numbered from 2 when the template already has one."""
    if old in names:
        return names[old]
    naming.add(old)
    role = frame_role(by_old[old], styles, names, by_old, naming)
    naming.discard(old)
    taken = set(names.values())
    new, n = role, 2
    while new in taken:
        new, n = f"{role}-{n}", n + 1
    names[old] = new
    return new


def name_frames(templates: list[dict], styles: list[dict]) -> tuple[list[dict], dict[str, dict[str, str]], list[dict]]:
    """(templates, template id -> {old frame name: new name}, report).
    Frames whose name is not the positional `box-4` form keep it."""
    by_style = {s["id"]: s for s in styles}
    by_id = {t["id"]: t for t in templates}
    order: list[dict] = []
    seen: set[str] = set()

    def visit(t: dict) -> None:
        if t["id"] in seen:
            return
        seen.add(t["id"])
        parent = by_id.get(t.get("extends") or "")
        if parent is not None:
            visit(parent)
        order.append(t)

    for t in templates:
        visit(t)
    resolved: dict[str, list[dict]] = {}
    maps: dict[str, dict[str, str]] = {}
    for t in order:
        frames = resolved[t["id"]] = resolved_frames(t, resolved)
        by_old = {f["name"]: f for f in frames}
        parent_map = maps.get(t.get("extends") or "", {})
        names: dict[str, str] = {}
        for f in frames:
            n = f["name"]
            if n in parent_map:
                names[n] = parent_map[n]
            elif not POSITIONAL_RE.match(n):
                names[n] = n
        # a name kept by hand or inherited is taken before any is made up
        for f in frames:
            if f["name"] not in names:
                name_of(f["name"], by_style, names, by_old, set())
        maps[t["id"]] = names
    out, report = [], []
    for t in templates:
        names = maps[t["id"]]
        nt = json.loads(json.dumps(t))
        rename_in_template(nt, names)
        out.append(nt)
        changed = {o: n for o, n in names.items() if o != n and any(f["name"] == o for f in t.get("frames", []))}
        if changed:
            report.append({"id": t["id"], "renamed": changed})
    return out, maps, report


def rename_in_template(t: dict, names: dict[str, str]) -> None:
    """Apply a frame rename to a template's frames, anchors, groups and
    overflow targets."""
    def ref(v: Any) -> Any:
        if isinstance(v, str) and v.startswith("#") and v[1:] in names:
            return "#" + names[v[1:]]
        return v

    for f in t.get("frames", []):
        f["name"] = names.get(f["name"], f["name"])
        anchor = (f.get("placement") or {}).get("anchor")
        if isinstance(anchor, dict) and "to" in anchor:
            anchor["to"] = ref(anchor["to"])
        if isinstance(f.get("next"), str):
            f["next"] = names.get(f["next"], f["next"])
        ov = f.get("overflow")
        if isinstance(ov, dict) and "continueIn" in ov:
            ov["continueIn"] = ref(ov["continueIn"])
    for g in t.get("groups", []):
        if isinstance(g.get("frames"), list):
            g["frames"] = [names.get(n, n) for n in g["frames"]]
        rep = g.get("repeat")
        if isinstance(rep, dict) and isinstance(rep.get("frames"), list):
            rep["frames"] = [names.get(n, n) for n in rep["frames"]]
        anchor = (g.get("placement") or {}).get("anchor")
        if isinstance(anchor, dict) and "to" in anchor:
            anchor["to"] = ref(anchor["to"])
    for el in decoration_of(t):
        for holder in element_refs(el):
            holder["to"] = ref(holder["to"])


def rename_module_refs(templates: list[dict], maps: dict[str, dict[str, str]]) -> None:
    """A page's references into a module instance (`#m[1].box-2`) follow
    the module's frame renames."""
    def ref(v: Any) -> Any:
        if isinstance(v, str) and v.startswith("#") and "]." in v:
            return "#" + _final_name(v[1:], {}, maps)
        return v

    for t in templates:
        if t.get("role") == "module":
            continue
        for f in t.get("frames", []):
            a = (f.get("placement") or {}).get("anchor")
            if isinstance(a, dict) and "to" in a:
                a["to"] = ref(a["to"])
        for g in t.get("groups", []):
            a = (g.get("placement") or {}).get("anchor")
            if isinstance(a, dict) and "to" in a:
                a["to"] = ref(a["to"])
        for el in decoration_of(t):
            for holder in element_refs(el):
                holder["to"] = ref(holder["to"])


def element_refs(el: dict) -> list[dict]:
    """The objects of a decoration element that name a frame or another
    element in their `to`: the anchor, sizes run to an edge (`{to, edge}`),
    a connector's ends."""
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


def element_targets(el: dict) -> set[str]:
    """Frame or element names (without `#` and `[…]`) an element reads."""
    out = set()
    for h in element_refs(el):
        to = h.get("to")
        if isinstance(to, str) and to.startswith("#"):
            out.add(to[1:].split("[", 1)[0])
    return out


SLOT_LINE_RE = re.compile(r"^\s*(?::{2,}[A-Za-z]|#{1,6}\s)")
SLOT_ATTR_RE = re.compile(r'(?<=[\s{])slot="([^"]*)"')


def attr_images(templates: list[dict]) -> set[str]:
    """Page-fence attributes that a decoration image reads (`{attr.fondo}`)."""
    out = set()
    for t in templates:
        for e in decoration_of(t):
            m = re.fullmatch(r"\{attr\.([\w-]+)\}", str(e.get("resourceId", "")))
            if e.get("kind") == "image" and m:
                out.add(m.group(1))
    return out


def thumb(path: Path):
    from PIL import Image  # type: ignore

    im = Image.open(path).convert("RGB")
    im.thumbnail((512, 512))
    return im


def image_distance(a, b) -> float:
    """Mean difference of two thumbnails (0-255), or 255 when they differ
    in place: a page that is mostly white paper (a cover, a contents page)
    has a small mean difference from another such page even when its
    drawings are elsewhere, and a thin rule (a diagram's connectors on the
    ground) changes few pixels, so more than 0.05 % of the pixels of a
    512-pixel thumbnail differing by over 48 on a channel makes two
    pictures different."""
    if a.size != b.size:
        return 255.0
    pa, pb = a.tobytes(), b.tobytes()
    diffs = [abs(x - y) for x, y in zip(pa, pb)]
    n_px = max(1, len(diffs) // 3)
    far = sum(1 for i in range(0, len(diffs) - 2, 3) if max(diffs[i], diffs[i + 1], diffs[i + 2]) > 48)
    if far > 0.0005 * n_px:
        return 255.0
    return sum(diffs) / max(1, len(diffs))


def dedupe_images(resources: list[dict], ids: list[str], root: Path, tol: float) -> tuple[dict[str, str], list[dict]]:
    by_id = {r["id"]: r for r in resources}
    reps: list[tuple[str, Any]] = []
    mapping: dict[str, str] = {}
    report: dict[str, list] = {}
    for rid in sorted(set(ids)):
        r = by_id.get(rid)
        if not r or not r.get("file") or not (root / r["file"]).exists():
            continue
        im = thumb(root / r["file"])
        hit = None
        for rep_id, rep_im in reps:
            d = image_distance(rep_im, im)
            if d <= tol:
                hit = (rep_id, d)
                break
        if hit:
            mapping[rid] = hit[0]
            report.setdefault(hit[0], []).append((rid, round(hit[1], 2)))
        else:
            reps.append((rid, im))
    return mapping, [{"id": k, "from": [k] + [m for m, _ in v], "largest": max(d for _, d in v)}
                     for k, v in sorted(report.items())]


# ---------------------------------------------------------------------------
# Markdown rewriting
# ---------------------------------------------------------------------------

FENCE_RE = re.compile(r"^(\s*:{4,}page)\{([^}]*)\}\s*$")
ATTR_RE = re.compile(r'([\w-]+)="([^"]*)"')


CODE_FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
PAGE_CLOSE_RE = re.compile(r"^\s*:{4,}\s*$")
#: a container opened or closed inside a page fence (three colons)
CONTAINER_OPEN_RE = re.compile(r"^\s*:::([A-Za-z][\w-]*)")
CONTAINER_CLOSE_RE = re.compile(r"^\s*:::\s*$")


def rewrite_markdown(text: str, templates: dict[str, str], attrs_map: dict[str, dict[str, str]],
                     styles: dict[str, str], slots: dict[str, dict[str, str]] | None = None,
                     flags: dict[str, list[str]] | None = None) -> str:
    """The text with the new template ids, page attributes and mark styles
    and, inside a page fence, the new slot names of that page's template
    (`slots`: template id -> {old frame name: new}). `flags` (old template
    id -> attribute names) adds the attributes a merged shell draws its
    furniture on (`frontmatter`) to the fences of those pages."""
    out = []
    current: dict[str, str] | None = None
    page_slots: dict[str, str] | None = None
    # containers open inside the page fence: (kind, module slot map)
    stack: list[tuple[str, dict[str, str] | None]] = []
    code: str | None = None
    for line in text.split("\n"):
        m = FENCE_RE.match(line)
        cm = CODE_FENCE_RE.match(line)
        if cm and m is None:
            mark = cm.group(1)
            if code is None:
                code = mark
            elif mark[0] == code[0] and len(mark) >= len(code):
                code = None
        elif code is not None:
            pass
        elif stack and CONTAINER_CLOSE_RE.match(line):
            stack.pop()
            mods = [s for _, s in stack if s is not None]
            current = mods[-1] if mods else page_slots
        elif page_slots is not None and CONTAINER_OPEN_RE.match(line):
            om = CONTAINER_OPEN_RE.match(line)
            if om.group(1) == "module":  # type: ignore[union-attr]
                tm = re.search(r'(?<=[\s{])template="([^"]*)"', line)
                current = (slots or {}).get(tm.group(1) if tm else "") or {}
                stack.append(("module", current))
            else:
                if current and SLOT_LINE_RE.match(line):
                    line = SLOT_ATTR_RE.sub(lambda a: f'slot="{current.get(a.group(1), a.group(1))}"', line)
                stack.append((om.group(1), None))  # type: ignore[union-attr]
        elif m:
            tid, old_tid = "", ""

            def sub(a: re.Match) -> str:
                nonlocal tid, old_tid
                k, v = a.group(1), a.group(2)
                if k == "template":
                    old_tid = v
                    v = templates.get(v, v)
                    tid = v
                elif k in attrs_map:
                    v = attrs_map[k].get(v, v)
                return f'{k}="{v}"'
            inner = ATTR_RE.sub(sub, m.group(2))
            for flag in (flags or {}).get(old_tid, []):
                if not re.search(r'(?:^|\s)' + re.escape(flag) + r'(?:=|\s|$)', inner):
                    inner = inner.rstrip() + " " + flag
            line = m.group(1) + "{" + inner + "}"
            current = (slots or {}).get(tid) or None
            page_slots = current or {}
            stack = []
        elif PAGE_CLOSE_RE.match(line):
            current = None
            page_slots = None
        else:
            if current and SLOT_LINE_RE.match(line):
                line = SLOT_ATTR_RE.sub(lambda a: f'slot="{current.get(a.group(1), a.group(1))}"', line)
            if styles and "style=" in line:
                line = re.sub(r'(:(?:mark|chip)\[(?:\\.|[^\]\\])*\]\{[^}]*?style=")([^"]*)(")',
                              lambda a: a.group(1) + styles.get(a.group(2), a.group(2)) + a.group(3), line)
        out.append(line)
    return "\n".join(out)


def fence_usage(markdowns: list[str]) -> dict[str, int]:
    usage: dict[str, int] = {}
    for text in markdowns:
        for line in text.split("\n"):
            m = FENCE_RE.match(line)
            if m:
                a = dict(ATTR_RE.findall(m.group(2)))
                if "template" in a:
                    usage[a["template"]] = usage.get(a["template"], 0) + 1
    return usage


def fence_templates(markdowns: list[str]) -> list[str]:
    """The template of every page fence, in book order."""
    out = []
    for text in markdowns:
        for line in text.split("\n"):
            m = FENCE_RE.match(line)
            if m:
                out.append(dict(ATTR_RE.findall(m.group(2))).get("template", ""))
    return out


def fence_attr_values(markdowns: list[str], key: str) -> list[str]:
    out = []
    for text in markdowns:
        for line in text.split("\n"):
            m = FENCE_RE.match(line)
            if m:
                a = dict(ATTR_RE.findall(m.group(2)))
                if key in a:
                    out.append(a[key])
    return out


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def dedupe_dir(root: Path, tol: dict, max_diff: int, image_tol: float, dry_run: bool = False,
               name_frames_by_role: bool = True, fold_grids: bool = True, fold_modules: bool = True,
               laid: Path | None = None, fold_rows: bool = True, fold_looks: bool = True,
               merge_shells: bool = True) -> dict:
    lib_path, res_path = root / "library.json", root / "resources.json"
    library = json.loads(lib_path.read_text(encoding="utf-8"))
    resources = json.loads(res_path.read_text(encoding="utf-8")) if res_path.exists() else []
    md_files = sorted((root / "chapters").rglob("*.md")) if (root / "chapters").exists() else []
    markdowns = [p.read_text(encoding="utf-8") for p in md_files]
    templates = library.get("pageTemplates", [])
    report: dict[str, Any] = {"before": {"pageTemplates": len(templates)}, "after": {}}

    # 1. styles
    style_maps: dict[str, dict[str, str]] = {}
    for kind in ("calloutStyles", "markStyles", "chipStyles", "labelStyles"):
        styles = library.get(kind) or []
        if not styles:
            continue
        usage: dict[str, int] = {}
        if kind == "calloutStyles":
            for t in templates:
                for f in t.get("frames", []):
                    if f.get("style"):
                        usage[f["style"]] = usage.get(f["style"], 0) + 1
        elif kind == "labelStyles":
            for r in resources:
                for a in r.get("anchors", []) or []:
                    if a.get("style"):
                        usage[a["style"]] = usage.get(a["style"], 0) + 1
        else:
            name = "mark" if kind == "markStyles" else "chip"
            for text in markdowns:
                for sid in re.findall(rf':{name}\[(?:\\.|[^\]\\])*\]\{{[^}}]*?style="([^"]*)"', text):
                    usage[sid] = usage.get(sid, 0) + 1
        kept, mapping, merges = dedupe_styles(styles, kind, usage, tol)
        report["before"][kind] = len(styles)
        report["after"][kind] = len(kept)
        report.setdefault("styles", {})[kind] = merges
        library[kind] = kept
        style_maps[kind] = mapping
        if kind == "calloutStyles":
            by_old = {s["id"]: s for s in styles}
            by_new = {s["id"]: s for s in kept}
            for t in templates:
                for f in t.get("frames", []):
                    old = f.get("style")
                    if not old or old not in mapping:
                        continue
                    f["style"] = mapping[old]
                    own = by_old[old].get("padding") or {}
                    rep = by_new[mapping[old]].get("padding") or {}
                    pad = dict(f.get("padding") or {})
                    for side, d in own.items():
                        if side in pad:
                            continue
                        r = rep.get(side)
                        if r is None or abs((dim_mm(d) or 0) - (dim_mm(r) or 0)) > 0.3:
                            pad[side] = d
                    if pad:
                        f["padding"] = {k: pad[k] for k in ("top", "right", "bottom", "left") if k in pad}
        if kind == "labelStyles":
            for r in resources:
                for a in r.get("anchors", []) or []:
                    if a.get("style") in mapping:
                        a["style"] = mapping[a["style"]]

    # 2. pictures read from page attributes
    attrs_map: dict[str, dict[str, str]] = {}
    image_report = []
    for key in sorted(attr_images(templates)):
        ids = fence_attr_values(markdowns, key)
        mapping, merged = dedupe_images(resources, ids, root, image_tol)
        if mapping:
            attrs_map[key] = mapping
            image_report += merged
    dropped = {old for m in attrs_map.values() for old in m}
    report["pictures"] = image_report

    # 3. grids and modules, from the boxes extract measured
    fold_report: dict[str, Any] = {}
    reg_path = root / "regions.json"
    if (fold_grids or fold_modules) and reg_path.exists():
        regions = json.loads(reg_path.read_text(encoding="utf-8"))
        laid_boxes: dict[str, dict] = {}
        if laid is not None:
            for page in json.loads(laid.read_text(encoding="utf-8")).get("pages", []):
                if page.get("template") and page["template"] not in laid_boxes:
                    laid_boxes[page["template"]] = page.get("frames", {})
        looks = None
        if fold_looks:
            taken = {e.get("id") for e in library.get("frameLooks") or []}
            looks = look_book(library.get("calloutStyles") or [], tol, {t for t in taken if t},
                              roles=look_roles(library, templates))
        fold_report = tf.fold_book(templates, regions, markdowns, tol, frame_diff, element_diff, _group_equal,
                                   grids=fold_grids, modules=fold_modules, laid=laid_boxes, rows=fold_rows,
                                   looks=looks)
        report["grids"] = fold_report["grids"]
        report["modules"] = fold_report["modules"]
        report["rows"] = fold_report.get("rows") or []
        if fold_report.get("frameLooks"):
            library["frameLooks"] = (library.get("frameLooks") or []) + fold_report["frameLooks"]
            report["frameLooks"] = [e["id"] for e in fold_report["frameLooks"]]
        if fold_report.get("skipped"):
            report["foldSkipped"] = fold_report["skipped"]
    report["after"]["grids"] = len(report.get("grids") or [])
    report["after"]["modules"] = len(report.get("modules") or [])
    report["after"]["moduleRows"] = len(report.get("rows") or [])
    report["after"]["frameLooks"] = len(report.get("frameLooks") or [])

    # 4. templates
    usage = fence_usage(markdowns)
    new_templates, tmap, treport = dedupe_templates(templates, usage, tol["geom"], max_diff)
    # 4b. shells that differ only by their furniture: one, drawn on the fences' word
    fence_flags: dict[str, list[str]] = {}
    if merge_shells:
        order = [tmap.get(t, t) for t in fence_templates(markdowns)]
        new_templates, smap, sflags, sreport = merge_furniture_shells(new_templates, order, tol["geom"])
        if smap or sflags:
            mapped = set(tmap.values())
            for sid, fl in sflags.items():
                if sid not in mapped:
                    fence_flags[sid] = list(fl)
            for old, new in list(tmap.items()):
                if new in sflags:
                    fence_flags[old] = list(sflags[new])
                tmap[old] = smap.get(new, new)
            report["shells"] = sreport
    library["pageTemplates"] = new_templates
    report["templates"] = treport
    report["after"]["pageTemplates"] = sum(1 for t in new_templates if t.get("role") != "module")
    report["after"]["extends"] = sum(1 for t in new_templates if t.get("extends"))

    # 5. frame names by role, in the templates and in every page fence
    slot_maps: dict[str, dict[str, str]] = {}
    if name_frames_by_role:
        new_templates, slot_maps, frame_report = name_frames(new_templates, library.get("calloutStyles") or [])
        rename_module_refs(new_templates, slot_maps)
        library["pageTemplates"] = new_templates
        report["frames"] = frame_report
    # every frame of every page: its name in extract's template -> the name
    # the laid page gives it (instances, modules, role names)
    for m in report.get("modules") or []:
        m["uses"] = [tmap.get(u, u) for u in m["uses"]]
    for g in report.get("grids") or []:
        g["template"] = tmap.get(g["template"], g["template"])
    if fold_report.get("names"):
        report["pages"] = {}
        for old_id, names in fold_report["names"].items():
            tid = tmap.get(old_id, old_id)
            final = {}
            for orig, cur in names.items():
                final[orig] = _final_name(cur, slot_maps.get(tid, {}), slot_maps)
            report["pages"][old_id] = {"template": tid, "frames": final}

    mark_map = {**style_maps.get("markStyles", {}), **style_maps.get("chipStyles", {})}
    new_md = [rewrite_markdown(t, tmap, attrs_map, mark_map, slot_maps, fence_flags) for t in markdowns]
    if not dry_run:
        lib_path.write_text(json.dumps(library, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        kept_res = [r for r in resources if r["id"] not in dropped]
        res_path.write_text(json.dumps(kept_res, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        for r in resources:
            if r["id"] in dropped and r.get("file"):
                p = root / r["file"]
                if p.exists() and root.resolve() in p.resolve().parents:
                    p.unlink()
        for p, text in zip(md_files, new_md):
            p.write_text(text, encoding="utf-8")
        (root / "dedupe-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n",
                                                 encoding="utf-8")
    return report


def compare_boxes(before: dict, after: dict, names: dict[str, dict], tol: float = 0.5) -> dict:
    """The laid frame boxes of two layouts (`render.mjs --frames`), page by
    page, each frame of `before` looked up in `after` under its new name
    (`names`: the `pages` of dedupe-report.json, by the template the frame
    was laid with before). Returns {pages: [{page, template, frames, over:
    [(name, new name, mm)], missing: [...]}], frames, over, missing,
    largest}."""
    out: dict[str, Any] = {"pages": [], "frames": 0, "over": 0, "missing": 0, "largest": 0.0}
    pa, pb = before.get("pages", []), after.get("pages", [])
    for k, page in enumerate(pa):
        other = pb[k] if k < len(pb) else {"frames": {}}
        rename = (names.get(page.get("template") or "") or {}).get("frames", {})
        row: dict[str, Any] = {"page": k + 1, "template": page.get("template"), "after": other.get("template"),
                               "frames": 0, "over": [], "missing": [], "largest": 0.0}
        for name, box in page.get("frames", {}).items():
            new = rename.get(name, name)
            # a grid's instance on the page before keeps its item number
            if new not in other["frames"] and "[" in name:
                b = name[: name.index("[")]
                if b in rename:
                    new = rename[b] + name[name.index("["):]
            got = other["frames"].get(new)
            row["frames"] += 1
            if got is None:
                row["missing"].append(name)
                continue
            d = max(abs(a - b) for a, b in zip(box, got))
            row["largest"] = max(row["largest"], round(d, 2))
            if d > tol:
                row["over"].append((name, new, round(d, 2)))
        out["pages"].append(row)
        out["frames"] += row["frames"]
        out["over"] += len(row["over"])
        out["missing"] += len(row["missing"])
        out["largest"] = max(out["largest"], row["largest"])
    return out


def print_compare(cmp: dict) -> None:
    for row in cmp["pages"]:
        flag = "" if not row["over"] and not row["missing"] else "  <--"
        print(f"page {row['page']:>3} {row['template']} -> {row['after']}: {row['frames']} frames, "
              f"largest {row['largest']} mm{flag}")
        for name, new, d in row["over"]:
            print(f"      {name} -> {new}: {d} mm")
        for name in row["missing"]:
            print(f"      {name}: not laid after")
    print(f"{cmp['frames']} frames: {cmp['over']} moved past the tolerance, {cmp['missing']} missing, "
          f"largest {cmp['largest']} mm")


INSTANCE_RE = re.compile(r"^(?:([\w-]+)\[(\d+)\]\.)?([\w-]+?)(\[\d+\])?$")


def _final_name(cur: str, page_map: dict[str, str], maps: dict[str, dict[str, str]]) -> str:
    """`box-2` / `grid-tab[3]` / `module-box[1].picture-1` with the frame
    renamed by role in its own template (the page's or the module's)."""
    m = INSTANCE_RE.match(cur)
    if not m:
        return cur
    mod, n, frame, item = m.groups()
    names = maps.get(mod, {}) if mod else page_map
    out = names.get(frame, frame) + (item or "")
    return f"{mod}[{n}].{out}" if mod else out


def print_report(rep: dict) -> None:
    b, a = rep["before"], rep["after"]
    print(f"page templates {b.get('pageTemplates', 0)} -> {a.get('pageTemplates', 0)} "
          f"({a.get('extends', 0)} extend a shared one)")
    for kind in ("calloutStyles", "markStyles", "chipStyles", "labelStyles"):
        if kind in b:
            print(f"{kind} {b[kind]} -> {a[kind]}")
    for g in rep.get("grids") or []:
        print(f"  grid {g['template']}/{g['group']}: {g['items']} items, {g['columns']} column(s) x {g['rows']} row(s), "
              f"repeats {', '.join(g['frames'])}")
    if rep.get("modules"):
        uses = sum(len(m["uses"]) for m in rep["modules"])
        print(f"modules {len(rep['modules'])} ({uses} uses, "
              f"{sum(1 for m in rep['modules'] if len(m['uses']) > 1)} used more than once)")
        for m in rep["modules"]:
            print(f"  {m['id']}: {m['frames']} frame(s), on {', '.join(m['uses'])}")
    for r in rep.get("rows") or []:
        cols = f", {r['columns']} column(s)" if r.get("columns") else ""
        print(f"  modules {r['kind']} {r['group']}{cols}: {', '.join(r['templates'])}; on {', '.join(r['uses'])}")
    if rep.get("frameLooks"):
        print(f"frame looks {len(rep['frameLooks'])}: {', '.join(rep['frameLooks'])}")
    for sh in rep.get("shells") or []:
        conds = ", ".join(f"{c['element']} {'when' if 'when' in c else 'unless'} {c.get('when') or c.get('unless')}"
                          for c in sh["conditions"])
        print(f"  shell {sh['id']} serves {', '.join(sh['from'])}: {conds or 'no condition'}")
    if rep.get("foldSkipped"):
        print(f"grids and modules: skipped, {rep['foldSkipped']}")
    for t in rep.get("templates", []):
        if t.get("base"):
            print(f"  {t['id']}: shared by {len(t['children'])} templates: frames {', '.join(t['frames']) or '-'}; "
                  f"decoration {', '.join(t['decoration']) or '-'}")
        elif t.get("extends"):
            d = t["differs"]
            what = ", ".join(x for x in (["+" + n for n in d["onlyB"]] + ["-" + n for n in d["onlyA"]]
                                         + ["~" + n for n in d["changed"]] + ["groups " + n for n in d["groups"]]))
            print(f"  {t['id']}: extends {t['extends']} ({what}); pages {', '.join(t['from'])}")
        else:
            print(f"  {t['id']}: {len(t['from'])} page(s) {', '.join(t['from'])} (largest difference {t['largest']} mm)")
    renamed = rep.get("frames") or []
    if renamed:
        n = sum(len(t["renamed"]) for t in renamed)
        print(f"frames renamed by role: {n} in {len(renamed)} template(s)")
        for t in renamed:
            print(f"  {t['id']}: " + ", ".join(f"{o} -> {x}" for o, x in t["renamed"].items()))
    if rep.get("pictures"):
        print(f"pictures: {sum(len(p['from']) - 1 for p in rep['pictures'])} merged into {len(rep['pictures'])}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dir", help="the folder pdf_regions.py extract wrote")
    ap.add_argument("--geom-tol", type=float, default=3.0, help="frames within this many mm are one (default 3)")
    ap.add_argument("--style-tol", type=float, default=0.5, help="style lengths within this many mm are one (default 0.5)")
    ap.add_argument("--padding-tol", type=float, default=1.5, help="style paddings within this many mm are one (default 1.5)")
    ap.add_argument("--font-tol", type=float, default=0.25, help="font sizes within this many pt are one (default 0.25)")
    ap.add_argument("--delta-e", type=float, default=3.0, help="colours within this CIEDE2000 distance are one (default 3)")
    ap.add_argument("--max-diff", type=int, default=2, help="a template that differs in at most this many frames extends a shared one (default 2)")
    ap.add_argument("--image-tol", type=float, default=2.0, help="pictures whose thumbnails differ by at most this (0-255) are one (default 2)")
    ap.add_argument("--no-grids", action="store_true", help="leave frames on a lattice as they are")
    ap.add_argument("--no-modules", action="store_true", help="leave the bands of a page on the page")
    ap.add_argument("--lattice-tol", type=float, default=1.0, help="cards whose edges and widths agree within this many mm stand on one lattice (default 1)")
    ap.add_argument("--module-tol", type=float, default=0.5, help="bands whose frames and decoration agree within this many mm are one module (default 0.5)")
    ap.add_argument("--grid-min", type=int, default=3, help="the fewest cards with nothing hanging from them a grid takes (default 3; cards with a tab or caption: 2)")
    ap.add_argument("--no-rows", action="store_true", help="lay the clusters of a band side by side as one module, not a row of modules")
    ap.add_argument("--no-looks", action="store_true", help="cards whose styles differ in colours are no grid (no frameLooks)")
    ap.add_argument("--no-shell-merge", action="store_true", help="keep a shell per furniture (no when/unless, no fence attributes)")
    ap.add_argument("--member-reach", type=float, default=8.0, help="a frame this close (mm) above or below a card can be its member (default 8)")
    ap.add_argument("--laid", metavar="FRAMES", help="the draft's laid frame boxes (render.mjs --frames): grids and modules are measured on them")
    ap.add_argument("--compare-boxes", nargs=2, metavar=("BEFORE", "AFTER"), help="compare the frame boxes of two render.mjs --frames files (DIR's dedupe-report.json gives the new names) and exit")
    ap.add_argument("--box-tol", type=float, default=0.5, help="with --compare-boxes: boxes within this many mm are the same (default 0.5)")
    ap.add_argument("--keep-frame-names", action="store_true", help="leave the frames named by kind and order (box-4)")
    ap.add_argument("--dry-run", action="store_true", help="report only")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    tol = {"geom": args.geom_tol, "dim": args.style_tol, "padding": args.padding_tol, "font": args.font_tol,
           "delta_e": args.delta_e, "lattice": args.lattice_tol, "grid_min": args.grid_min,
           "module": args.module_tol, "reach": args.member_reach}
    if args.compare_boxes:
        rep_path = Path(args.dir) / "dedupe-report.json"
        names = json.loads(rep_path.read_text(encoding="utf-8")).get("pages", {}) if rep_path.exists() else {}
        before, after = (json.loads(Path(p).read_text(encoding="utf-8")) for p in args.compare_boxes)
        cmp = compare_boxes(before, after, names, args.box_tol)
        if args.json:
            print(json.dumps(cmp, ensure_ascii=False, indent=1))
        else:
            print_compare(cmp)
        raise SystemExit(0 if cmp["over"] == 0 and cmp["missing"] == 0 else 1)
    rep = dedupe_dir(Path(args.dir), tol, args.max_diff, args.image_tol, args.dry_run, not args.keep_frame_names,
                     not args.no_grids, not args.no_modules, Path(args.laid) if args.laid else None,
                     not args.no_rows, not args.no_looks, not args.no_shell_merge)
    if args.json:
        print(json.dumps(rep, ensure_ascii=False, indent=1))
    else:
        print_report(rep)


if __name__ == "__main__":
    main()
