#!/usr/bin/env python3
"""Fold the page templates and styles measured page by page into a library
that does not grow with the page count: near-identical styles become one,
pages of one kind share one template, pages that differ by a frame or two
get a template that `extends` the shared one, and pictures that repeat (the
same page ground on every page) become one resource.

  template_dedupe.py DIR [--geom-tol 3] [--style-tol 0.5] [--padding-tol 1.5]
                         [--delta-e 3] [--max-diff 2] [--image-tol 2]
                         [--dry-run] [--json]

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
- **Templates.** Two templates are one kind of page when every frame of the
  same name has the same style, role and flags and stands within --geom-tol
  mm (position, width, minimum and maximum height); their groups are the
  same; their decoration is the same except elements kept to one side
  (`parity`), which are joined. A template that differs from a shared one
  in at most --max-diff frames becomes a child: `extends` plus a patch with
  only the frames that differ (`remove: true` for a frame it lacks).
  Templates are named by what they hold (`title-text-box2-picture`), never
  by page number; the page fences follow the new ids.
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
from pathlib import Path
from typing import Any

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
                if d > tol:
                    return None
                worst = max(worst, d)
            elif sa[k] != sb[k]:
                return None
    return worst


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
            if e.get("parity") in (None, "all"):
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
        out["decoration"] = {"elements": extra}
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
    using `extends` are kept as they are (their parents too)."""
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
        if best and (best[0] >= need or best[1].get("parity") not in (None, "all")):
            elements.append(best[1])
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


def _decoration_extends(base: dict, child: dict, tol: float) -> bool:
    """A patch can add decoration elements but not take one away."""
    dc = {element_key(e): e for e in decoration_of(child)}
    for e in decoration_of(base):
        k = element_key(e)
        if k not in dc:
            if e.get("parity") in (None, "all"):
                return False
            continue
        if element_diff(e, dc[k], tol) is None:
            return False
    return True


# ---------------------------------------------------------------------------
# pictures read from page attributes
# ---------------------------------------------------------------------------


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


def rewrite_markdown(text: str, templates: dict[str, str], attrs_map: dict[str, dict[str, str]],
                     styles: dict[str, str]) -> str:
    out = []
    for line in text.split("\n"):
        m = FENCE_RE.match(line)
        if m:
            def sub(a: re.Match) -> str:
                k, v = a.group(1), a.group(2)
                if k == "template":
                    v = templates.get(v, v)
                elif k in attrs_map:
                    v = attrs_map[k].get(v, v)
                return f'{k}="{v}"'
            line = m.group(1) + "{" + ATTR_RE.sub(sub, m.group(2)) + "}"
        elif styles and "style=" in line:
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


def dedupe_dir(root: Path, tol: dict, max_diff: int, image_tol: float, dry_run: bool = False) -> dict:
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

    # 3. templates
    usage = fence_usage(markdowns)
    new_templates, tmap, treport = dedupe_templates(templates, usage, tol["geom"], max_diff)
    library["pageTemplates"] = new_templates
    report["templates"] = treport
    report["after"]["pageTemplates"] = len(new_templates)
    report["after"]["extends"] = sum(1 for t in new_templates if t.get("extends"))

    mark_map = {**style_maps.get("markStyles", {}), **style_maps.get("chipStyles", {})}
    new_md = [rewrite_markdown(t, tmap, attrs_map, mark_map) for t in markdowns]
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


def print_report(rep: dict) -> None:
    b, a = rep["before"], rep["after"]
    print(f"page templates {b.get('pageTemplates', 0)} -> {a.get('pageTemplates', 0)} "
          f"({a.get('extends', 0)} extend a shared one)")
    for kind in ("calloutStyles", "markStyles", "chipStyles", "labelStyles"):
        if kind in b:
            print(f"{kind} {b[kind]} -> {a[kind]}")
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
    ap.add_argument("--dry-run", action="store_true", help="report only")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    tol = {"geom": args.geom_tol, "dim": args.style_tol, "padding": args.padding_tol, "font": args.font_tol,
           "delta_e": args.delta_e}
    rep = dedupe_dir(Path(args.dir), tol, args.max_diff, args.image_tol, args.dry_run)
    if args.json:
        print(json.dumps(rep, ensure_ascii=False, indent=1))
    else:
        print_report(rep)


if __name__ == "__main__":
    main()
