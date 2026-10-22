#!/usr/bin/env python3
"""Words printed on a picture (a map, a diagram) as resource anchors and
`::label` lines: the picture is cut without its lettering, each word (or name
set on two or three lines) gets one anchor on the resource, and every edition
writes its own words at those anchors (references/composed-pages.md §6.4).

  anchors.py SOURCE.pdf --page 4 --box 23,151,202,259 [--id mapa-mundi]
             [--lang es] [--strings en=strings.en.json]... [--no-merge]
             [--font-map map.json] [--fonts DIR] [--check-overlap] [--out DIR] [--json]
      Reads the visible text inside the box (mm from the trim's top-left
      corner of page 4), joins the lines of one name set on several lines,
      merges the same text printed twice at one point (within 0.5 mm: two
      grids of degree figures laid over each other; the larger size stays,
      a `# merged` note in the report), and writes:
        - the resource's `anchors` (id, x and y as fractions of the picture,
          `width` for a name of several lines, `align`, `verticalAlign`,
          `rotate` from the text matrix, `style`);
        - `labelStyles`, one per look of the lettering (face, weight,
          italic, size and colour; colours closer than ΔE 3 are one);
        - `overlap: "allow"` (postext >= 1.42) on the anchors of names the
          source prints touching, so `labelOverlap` does not list them at
          every edition; when a quarter of the map or more touches (a
          continent with a hundred country and capital names) it is written
          once, on the map's label styles. --check-overlap leaves the check on;
        - one `:::figure` block of `::label[TEXT]{at="id"}` lines per edition.
      --strings LANG=FILE gives another edition's words: a JSON object keyed
      by the source text (or by the anchor id) whose values are the
      translations; a word with no translation keeps the source text and is
      listed as untranslated. The keys "@alt", "@caption" and "@note"
      (postext >= 1.39) hold the edition's alt text, caption and note for the
      picture: they are written as `::alt[…]`, `::caption[…]`, `::note[…]`
      lines in the figure block, beside the labels, and are no label.

  anchors.py relabel anchors.json --strings en=strings.en.json [--out DIR]
      Writes the `:::figure` blocks of other editions from an anchors file
      written before (anchors.json by this script, figures.json by
      pdf_regions.py), without the PDF.

Output with --out: anchors.json ({resource, box, anchors, labelStyles,
labels: [{at, text}], markdown: {lang: block}}) and figure.<lang>.md. Without
it the JSON goes to stdout. pdf_regions.py calls the same functions for every
picture it cuts with words on it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import postext_md as pmd  # noqa: E402
import template_dedupe as td  # noqa: E402  (colours: ΔE, names)

PT_MM = 25.4 / 72

# ---------------------------------------------------------------------------
# A label line, as pdf_regions.py measures it (mm from the trim's top-left):
#   {"text": inline Markdown, "plain": str, "x0", "y0", "x1", "y1", "base",
#    "size" (pt), "family", "weight", "italic", "color" ("#rrggbb"),
#    "rotate" (degrees, clockwise), and "halo" ({"color", "width"} pt) when
#    the source prints an outline round it (`legends.find_halos`)}
# ---------------------------------------------------------------------------


def style_key(line: dict) -> tuple:
    key = (line["family"], int(line["weight"]), bool(line["italic"]), round(float(line["size"]) * 2) / 2,
           line["color"].lower())
    halo = line.get("halo")
    return key + ((halo["color"].lower(), float(halo["width"])),) if halo else key


def _light(col: str) -> bool:
    r, g, b = td.hex_rgb(col)
    return min(r, g, b) >= 0.9


def _centre(line: dict) -> float:
    return (line["x0"] + line["x1"]) / 2


SAME_POINT_MM = 0.5


def merge_duplicates(lines: list[dict], tol: float = SAME_POINT_MM, notes: list[str] | None = None) -> list[dict]:
    """Lines of the same text whose points lie within `tol` mm are one label
    printed twice (two grids of degree figures laid one over the other at
    0.3 mm offsets and in two sizes): keep the larger size and write a
    `# merged` note, not a second anchor. The point is the middle of the
    line's baseline. Two copies of one size in two colours are a label and
    its halo: the coloured one stays with the white (or the other) colour
    as its `halo`, never as its colour."""
    kept: list[dict] = []
    # at one size a coloured copy before a white one: the white copy printed under a label is its halo
    for line in sorted(lines, key=lambda l: (-float(l["size"]), _light(l["color"]), round(l["base"], 2),
                                             round(l["x0"], 2))):
        pt = (_centre(line), line["base"])
        twin = next((k for k in kept if k["plain"].strip() == line["plain"].strip()
                     and abs(_centre(k) - pt[0]) <= tol and abs(k["base"] - pt[1]) <= tol), None)
        if twin is None:
            kept.append(line)
        elif abs(float(twin["size"]) - float(line["size"])) < 0.25 and td.delta_e(twin["color"], line["color"]) > 10:
            if not twin.get("halo"):
                twin["halo"] = {"color": line["color"], "width": 0.4}
            if notes is not None:
                notes.append(f"# merged {line['plain'].strip()!r}: the {line['color']} copy under the "
                             f"{twin['color']} one is its halo")
        elif notes is not None:
            notes.append(f"# merged {line['plain'].strip()!r}: a copy at {max(abs(_centre(twin) - pt[0]), abs(twin['base'] - pt[1])):.1f} mm "
                         f"({line['size']} pt) into the {twin['size']} pt one")
    return kept


def single_token(text: str) -> bool:
    """A number or one letter alone (a tick, a degree, a month's initial):
    never one line of a name set on several."""
    t = text.strip()
    if len(t) <= 1:
        return True
    return not any(ch.isalpha() for ch in t) and any(ch.isdigit() for ch in t)


def merge_lines(lines: list[dict], merge: bool = True, notes: list[str] | None = None) -> list[list[dict]]:
    """Group the lines of one name set on several lines (same look, one
    leading under the other, centred on each other within a fifth of the
    wider line or flush left within 1 mm). Turned lines, numbers and single
    letters (`single_token`: a chart's `10` over its `0`, a month's `E`
    over a title) stay alone. The same text twice at one point is one line
    (`merge_duplicates`, a `# merged` note in `notes`). Deterministic: lines
    are taken top to bottom."""
    lines = merge_duplicates(lines, notes=notes)
    order = sorted(lines, key=lambda l: (round(l["base"], 2), round(l["x0"], 2), l["plain"]))
    groups: list[list[dict]] = []
    for line in order:
        host = None
        if merge and abs(line.get("rotate", 0)) < 1 and not single_token(line["plain"]):
            size_mm = float(line["size"]) * PT_MM
            best = None
            for g in groups:
                last = g[-1]
                if abs(last.get("rotate", 0)) >= 1 or style_key(last) != style_key(line) \
                        or single_token(last["plain"]):
                    continue
                step = line["base"] - last["base"]
                if not (0.6 * size_mm < step <= 1.6 * size_mm):
                    continue
                if len(g) > 1 and abs(step - (g[-1]["base"] - g[-2]["base"])) > 0.3 * size_mm:
                    continue
                width = max(last["x1"] - last["x0"], line["x1"] - line["x0"])
                overlap = min(last["x1"], line["x1"]) - max(last["x0"], line["x0"])
                same_mid = abs(_centre(last) - _centre(line)) <= 0.2 * width
                same_left = abs(last["x0"] - line["x0"]) <= 1.0
                if overlap > 0 and (same_mid or same_left):
                    if best is None or step < best[0]:
                        best = (step, g)
            if best:
                host = best[1]
        if host is not None:
            host.append(line)
        else:
            groups.append([line])
    return groups


def label_styles(groups: list[list[dict]], delta_e: float = 3.0, prefix: str = "label") -> tuple[list[dict], dict]:
    """One label style per look. Returns (styles, key -> style id). Looks of
    the same face, weight, italic and size whose colours are closer than
    `delta_e` share a style; ids name the colour and the size."""
    counts: dict[tuple, int] = {}
    for g in groups:
        k = style_key(g[0])
        counts[k] = counts.get(k, 0) + sum(len(l["plain"]) for l in g)
    reps: list[tuple] = []
    key_to_rep: dict[tuple, tuple] = {}
    for k in sorted(counts, key=lambda k: (-counts[k], k)):
        rep = next((r for r in reps if r[:4] == k[:4] and r[5:] == k[5:] and td.delta_e(r[4], k[4]) <= delta_e), None)
        if rep is None:
            reps.append(k)
            rep = k
        key_to_rep[k] = rep
    used: set[str] = set()
    rep_id: dict[tuple, str] = {}
    styles = []
    for rep in reps:
        fam, weight, italic, size, col = rep[:5]
        base = f"{prefix}-{td.colour_name(col)}-{str(size).rstrip('0').rstrip('.')}"
        if weight >= 600:
            base += "-bold"
        if italic:
            base += "-italic"
        if len(rep) > 5:
            base += "-halo"
        sid, n = base, 2
        while sid in used:
            sid, n = f"{base}-{n}", n + 1
        used.add(sid)
        rep_id[rep] = sid
        st: dict[str, Any] = {"id": sid, "fontFamily": fam, "fontSize": {"value": size, "unit": "pt"},
                              "fontWeight": weight, "color": {"hex": col, "model": "hex"}}
        if italic:
            st["fontStyle"] = "italic"
        if len(rep) > 5:
            st["halo"] = {"color": {"hex": rep[5][0], "model": "hex"}, "width": {"value": rep[5][1], "unit": "pt"}}
        styles.append(st)
    return styles, {k: rep_id[r] for k, r in key_to_rep.items()}


def label_text(group: list[dict]) -> tuple[str, str]:
    """(inline Markdown, plain text) of a group: its lines joined by spaces,
    a hyphen at a line end joined without one."""
    md, plain = "", ""
    for i, line in enumerate(group):
        t, p = line["text"].strip(), line["plain"].strip()
        if i == 0:
            md, plain = t, p
            continue
        if plain.endswith("-") and p[:1].islower():
            md, plain = md[:-1] + t, plain[:-1] + p
        else:
            md, plain = md + " " + t, plain + " " + p
    return md, plain


OVERLAP_RATIO = 0.12  # the engine's labelOverlap: more than 12 % of the smaller line height


def group_box(g: list[dict]) -> tuple[float, float, float, float]:
    """(x0, y0, x1, y1) in mm of the lines of one label."""
    return (min(l["x0"] for l in g), min(l.get("y0", l["base"] - 0.75 * float(l["size"]) * PT_MM) for l in g),
            max(l["x1"] for l in g), max(l.get("y1", l["base"] + 0.25 * float(l["size"]) * PT_MM) for l in g))


def touching_groups(groups: list[list[dict]], ratio: float = OVERLAP_RATIO) -> set[int]:
    """Indexes of the groups whose box runs into another label's by more than
    `ratio` of the smaller height (and has any width in common): names the
    source prints touching, which `labelOverlap` would list at every edition."""
    boxes = [group_box(g) for g in groups]
    order = sorted(range(len(groups)), key=lambda i: boxes[i][0])
    out: set[int] = set()
    for a, i in enumerate(order):
        xi0, yi0, xi1, yi1 = boxes[i]
        for j in order[a + 1:]:
            xj0, yj0, xj1, yj1 = boxes[j]
            if xj0 >= xi1:
                break
            h = min(yi1, yj1) - max(yi0, yj0)
            if h > ratio * min(yi1 - yi0, yj1 - yj0) and min(xi1, xj1) - max(xi0, xj0) > 0:
                out.update((i, j))
    return out


def anchors_for(groups: list[list[dict]], box: tuple[float, float, float, float], style_ids: dict,
                width_factor: float = 1.25, allow_touching: bool = True) -> tuple[list[dict], list[dict]]:
    """(anchors, labels) for the groups on a picture standing at `box` (mm,
    x0 y0 x1 y1 on the page). Anchors are fractions of the picture. A label
    the source prints touching another gets `overlap: "allow"` on its anchor
    (postext >= 1.42), so `labelOverlap` stops listing what the source
    itself prints; `allow_touching=False` leaves the check on."""
    bx0, by0, bx1, by1 = box
    bw, bh = max(bx1 - bx0, 1e-6), max(by1 - by0, 1e-6)
    slug = pmd.Slugger()
    anchors, labels = [], []
    touch = {id(groups[i]) for i in touching_groups(groups)} if allow_touching else set()
    for g in sorted(groups, key=lambda g: (round(g[0]["base"], 2), round(g[0]["x0"], 2), g[0]["plain"])):
        md, plain = label_text(g)
        size_mm = float(g[0]["size"]) * PT_MM
        x0, x1 = min(l["x0"] for l in g), max(l["x1"] for l in g)
        rot = float(g[0].get("rotate", 0) or 0)
        a: dict[str, Any] = {"id": slug(plain)}
        if abs(rot) >= 1:
            # a turned label stands centred on its own box
            cx = (x0 + x1) / 2
            cy = (min(l["y0"] for l in g) + max(l["y1"] for l in g)) / 2
            a["rotate"] = round(rot * 2) / 2
        else:
            top = g[0]["base"] - 0.75 * size_mm
            bottom = g[-1]["base"] + 0.25 * size_mm
            cy = (top + bottom) / 2
            mids = [_centre(l) for l in g]
            centred = len(g) == 1 or max(mids) - min(mids) <= max(1.0, 0.1 * (x1 - x0))
            if centred:
                cx = (x0 + x1) / 2
            else:
                cx = x0
                a["align"] = "start"
            if len(g) > 1:
                widest = max(l["x1"] - l["x0"] for l in g)
                a["width"] = round(min(1.0, width_factor * widest / bw), 4)
        a["x"] = round(min(max((cx - bx0) / bw, 0.0), 1.0), 4)
        a["y"] = round(min(max((cy - by0) / bh, 0.0), 1.0), 4)
        sid = style_ids.get(style_key(g[0]))
        if sid:
            a["style"] = sid
        if id(g) in touch:
            a["overlap"] = "allow"
        # keys in a fixed order
        anchors.append({k: a[k] for k in ("id", "x", "y", "width", "align", "verticalAlign", "rotate", "style", "overlap")
                        if k in a})
        labels.append({"at": a["id"], "text": md, "plain": plain, "lines": len(g)})
    return anchors, labels


def hoist_overlap(anchors: list[dict], styles: list[dict], share: float = 0.25, floor: int = 8) -> bool:
    """When many labels of one map touch (a continent with a hundred country
    and capital names), say it once: `overlap: "allow"` on the label styles
    those anchors use, taken off the anchors. Only for a picture of its own
    (styles shared with other pictures would allow their overlaps too).
    Returns whether it did."""
    allowed = [a for a in anchors if a.get("overlap") == "allow"]
    if len(allowed) <= max(floor, share * len(anchors)):
        return False
    used = {a.get("style") for a in anchors}
    for st in styles:
        if st["id"] in used:
            st["overlap"] = "allow"
    for a in anchors:
        a.pop("overlap", None)
    return True


def label_line(text: str, at: str) -> str:
    """`::label[TEXT]{at="id"}`; brackets in the words are escaped."""
    t = text.replace("[", "\\[").replace("]", "\\]")
    return f'::label[{t}]{{at="{pmd.attr_value(at)}"}}'


def translate(labels: list[dict], strings: dict[str, str] | None) -> tuple[list[dict], list[str]]:
    """The labels in another edition: `strings` keyed by source text (plain or
    Markdown) or by anchor id. Returns (labels, untranslated texts)."""
    if strings is None:
        return labels, []
    out, missing = [], []
    for lab in labels:
        t = strings.get(lab["at"])
        if t is None:
            t = strings.get(lab.get("plain", ""))
        if t is None:
            t = strings.get(lab["text"])
        if t is None:
            missing.append(lab.get("plain", lab["text"]))
            t = lab["text"]
        elif "*" not in t:
            t = pmd.escape(t)       # a translation is plain text unless it carries bold or italic
        out.append({**lab, "text": t})
    return out, missing


#: the figure's own words (postext >= 1.39): the key in a strings file and the line it writes
WORD_KEYS = ("alt", "caption", "note")


def words_from(strings: dict[str, str] | None) -> dict[str, str]:
    """The edition's `@alt` / `@caption` / `@note` entries of a strings file."""
    return {k: strings[f"@{k}"] for k in WORD_KEYS if strings and isinstance(strings.get(f"@{k}"), str)}


def word_line(key: str, text: str) -> str:
    """`::caption[TEXT]`; one line, brackets escaped. An empty `alt` marks the picture decorative."""
    t = " ".join(text.split()).replace("[", "\\[").replace("]", "\\]")
    return f"::{key}[{t}]"


def figure_block(resource: str, slot: str | None, labels: list[dict], words: dict[str, str] | None = None) -> str:
    a = f'resource="{pmd.attr_value(resource)}"' + (f' slot="{pmd.attr_value(slot)}"' if slot else "")
    body = [word_line(k, words[k]) for k in WORD_KEYS if words and k in words]
    body += [label_line(l["text"], l["at"]) for l in labels if l["text"].strip()]
    return ":::figure{" + a + "}\n" + "\n".join(body) + ("\n" if body else "") + ":::"


def label_lines_markdown(labels: list[dict]) -> list[str]:
    return [label_line(l["text"], l["at"]) for l in labels]


# ---------------------------------------------------------------------------
# command line
# ---------------------------------------------------------------------------


def _parse_strings(specs: list[str] | None) -> dict[str, dict]:
    out = {}
    for spec in specs or []:
        lang, _, file = spec.partition("=")
        if not file:
            sys.exit(f"--strings wants LANG=FILE, got {spec!r}")
        out[lang] = json.loads(Path(file).read_text(encoding="utf-8"))
    return out


def _write(result: dict, out: str | None, as_json: bool) -> None:
    if out:
        d = Path(out)
        d.mkdir(parents=True, exist_ok=True)
        (d / "anchors.json").write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        for lang, block in result["markdown"].items():
            (d / f"figure.{lang}.md").write_text(block + "\n", encoding="utf-8")
        if not as_json:
            print(f"{len(result['anchors'])} anchors, {len(result['labelStyles'])} label styles -> {d}/anchors.json")
            for note in result.get("notes", []):
                print(f"  {note}")
            for lang, miss in result.get("untranslated", {}).items():
                if miss:
                    print(f"  {lang}: {len(miss)} untranslated: " + ", ".join(miss[:8]))
            return
    print(json.dumps(result, ensure_ascii=False, indent=1))


def cmd_pdf(args) -> None:
    import pdf_regions as pr  # the PDF reader (visible text, faces)

    box = [float(v) for v in args.box.split(",")]
    if len(box) != 4:
        sys.exit("--box wants x0,y0,x1,y1 in mm")
    fonts = pr.Fonts(Path(args.font_map) if args.font_map else None, Path(args.fonts) if args.fonts else None)
    doc = pr.open_pdf(args.source)
    page = doc[args.page - 1]
    origin = pr.trim_origin(page)
    lines, hidden = pr.read_lines(args.source, page, fonts, origin)
    inside = [l for l in lines if pr.inside_mm((l.x0, l.y0, l.x1, l.y1), box, 1.0)]
    items = [l.label_dict() for l in inside]
    notes: list[str] = []
    groups = merge_lines(items, merge=not args.no_merge, notes=notes)
    styles, ids = label_styles(groups, delta_e=args.delta_e)
    anchors, labels = anchors_for(groups, tuple(box), ids, allow_touching=not args.check_overlap)
    if hoist_overlap(anchors, styles):
        notes.append("# many names touch as the source prints them: overlap \"allow\" is on the label styles of this map")
    elif any(a.get("overlap") for a in anchors):
        notes.append(f"# {sum(1 for a in anchors if a.get('overlap'))} names touch as the source prints them: "
                     "overlap \"allow\" on their anchors")
    rid = args.id or f"p{args.page:02d}-figure"
    result = {"resource": rid, "page": args.page, "box": box, "anchors": anchors, "labelStyles": styles,
              "labels": labels, "hidden": hidden, "markdown": {args.lang: figure_block(rid, args.slot, labels)},
              "untranslated": {}, "notes": notes}
    for lang, strings in _parse_strings(args.strings).items():
        tl, miss = translate(labels, strings)
        result["markdown"][lang] = figure_block(rid, args.slot, tl, words_from(strings))
        result["untranslated"][lang] = miss
    _write(result, args.out, args.json)


def cmd_relabel(args) -> None:
    data = json.loads(Path(args.anchors).read_text(encoding="utf-8"))
    figures = data["figures"] if "figures" in data else [data]
    out: dict = {"figures": []}
    for fig in figures:
        md, untranslated = {}, {}
        for lang, strings in _parse_strings(args.strings).items():
            tl, miss = translate(fig["labels"], strings)
            md[lang] = figure_block(fig["resource"], fig.get("slot"), tl, words_from(strings))
            untranslated[lang] = miss
        out["figures"].append({"resource": fig["resource"], "markdown": md, "untranslated": untranslated})
    if args.out:
        d = Path(args.out)
        d.mkdir(parents=True, exist_ok=True)
        langs = sorted({lang for f in out["figures"] for lang in f["markdown"]})
        for lang in langs:
            text = "\n\n".join(f["markdown"][lang] for f in out["figures"] if lang in f["markdown"])
            (d / f"figures.{lang}.md").write_text(text + "\n", encoding="utf-8")
        for f in out["figures"]:
            for lang, miss in f["untranslated"].items():
                if miss:
                    print(f"{f['resource']} {lang}: {len(miss)} untranslated: " + ", ".join(miss[:8]))
        print(f"{len(out['figures'])} figures -> {d}/figures.<lang>.md")
        return
    print(json.dumps(out, ensure_ascii=False, indent=1))


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    if argv[:1] == ["relabel"]:
        ap.add_argument("cmd")
        ap.add_argument("anchors", help="anchors.json written before")
        ap.add_argument("--strings", action="append", metavar="LANG=FILE", required=True)
        ap.add_argument("--out", help="write figures.<lang>.md here")
        cmd_relabel(ap.parse_args(argv))
        return
    ap.add_argument("source", help="the source PDF")
    ap.add_argument("--page", type=int, required=True, help="1-based page number")
    ap.add_argument("--box", required=True, help="the picture's box: x0,y0,x1,y1 in mm from the trim's top-left corner")
    ap.add_argument("--id", help="the resource id (default p<NN>-figure)")
    ap.add_argument("--slot", help="the frame the figure goes to")
    ap.add_argument("--lang", default="es", help="the source edition's language (default es)")
    ap.add_argument("--strings", action="append", metavar="LANG=FILE", help="another edition's words (repeat)")
    ap.add_argument("--no-merge", action="store_true", help="one label per line (names on several lines stay apart)")
    ap.add_argument("--check-overlap", action="store_true",
                    help="leave labelOverlap on for names the source prints touching (default: overlap \"allow\" on them)")
    ap.add_argument("--delta-e", type=float, default=3.0, help="colours closer than this are one label style (default 3)")
    ap.add_argument("--font-map", help="JSON: PDF font name prefix -> family (or {family, weight, italic})")
    ap.add_argument("--fonts", help="folder of the book's fonts (families read from the files)")
    ap.add_argument("--out", help="write anchors.json and figure.<lang>.md here")
    ap.add_argument("--json", action="store_true")
    cmd_pdf(ap.parse_args(argv))


if __name__ == "__main__":
    main()
