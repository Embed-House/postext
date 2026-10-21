#!/usr/bin/env python3
"""Prepare bitmaps for a Postext project (requires Pillow).

  images.py prep IN... --out resources/ [--max 2400] [--quality 84] [--gray]
        [--autocontrast] [--trim-white 225] [--crop 0,0,1,0.9] [--format jpg|png|keep]
      - converts CMYK / Adobe-CMYK JPEGs and palette/alpha images to sRGB (alpha
        flattened on white): CMYK renders wrongly in browsers and in the PDF
      - --autocontrast lifts scanned paper to white; --gray for engravings
      - --trim-white cuts the near-white margin around a plate/scan (pixels
        brighter than the threshold count as paper)
      - --crop keeps a fraction box (x0,y0,x1,y1 in 0..1), e.g. to drop a
        caption printed under a scanned plate
      - downscales to --max px on the long side (300 dpi at the printed size is
        plenty: a 90 mm wide figure needs ~1060 px)
      Prints `width`/`height` for the manifest (always declare them).

  images.py join A B [C…] --out resources/fig-3-2.jpg [--gap 0.02]
      Side-by-side composite of the parts of a multi-panel figure, scaled to
      the smallest height with white gaps.

  images.py size FILE...
      Pixel sizes (for bitmaps) and SVG sizes, as manifest fields.

  images.py crop RESOURCE-ID [--resources resources.json] [--top 12] [--left 3mm] ...
      Crops a resource's file by px (12, 12px) or mm (3mm, through its
      `resolution`) per side and keeps its fields in place: width/height,
      anchors (and their heads and faces), avoid, faces, safeArea and the
      contour's points, all fractions of the picture, are moved to the crop.
      Points left outside are reported.

  images.py cutout RESOURCE-ID [--resources resources.json] [--tol 24] [--force]
      Makes the white ground round an illustration transparent: the near-white
      pixels joined to the picture's edge (a white plate closed by the art
      stays), written as a PNG with a `contour` for the text to run round.
      Refused when under 80 % of the border is white (--force cuts anyway).
      pdf_regions.py extract does the same to a cut whose border is white.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: python3 -m pip install pillow")

Image.MAX_IMAGE_PIXELS = None


def to_rgb(im: Image.Image) -> Image.Image:
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        return bg
    if im.mode == "CMYK":
        # Pillow already undoes the inverted Adobe (APP14) CMYK encoding; the
        # conversion is naive (no ICC), so compare the colours with the print.
        return im.convert("RGB")
    if im.mode not in ("RGB", "L"):
        return im.convert("RGB")
    return im


def trim_white(im: Image.Image, threshold: int, pad: int = 6) -> Image.Image:
    gray = im.convert("L")
    mask = gray.point(lambda v: 0 if v > threshold else 255)
    box = mask.getbbox()
    if not box:
        return im
    x0, y0, x1, y1 = box
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


# ---------------------------------------------------------------------------
# the white round an illustration


WHITE_TOL = 24           # a channel this close to 255 is the paper's white
EDGE_SHARE = 0.8         # share of the border that must be white to cut the ground out
MIN_SHARE, MAX_SHARE = 0.03, 0.95   # share of the picture the outer white may take


def outer_white(rgb, tol: int = WHITE_TOL):
    """A boolean mask of the near-white pixels joined to the picture's edge
    (4-connected). A white plate inside the art, closed by the art's lines,
    is not reached. `rgb`: an (h, w, 3) uint8 array."""
    import numpy as np

    white = (np.asarray(rgb)[:, :, :3] >= 255 - tol).all(axis=2)
    h, w = white.shape
    starts, ends, rows = [], [], []
    for y in range(h):
        d = np.diff(np.concatenate(([0], white[y].astype(np.int8), [0])))
        s, e = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
        starts.append(s)
        ends.append(e)
        rows.append(len(s))
    n = sum(rows)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    base = [0] * (h + 1)
    for y in range(h):
        base[y + 1] = base[y] + rows[y]
    edge = set()
    for y in range(h):
        s, e = starts[y], ends[y]
        for k in range(len(s)):
            i = base[y] + k
            if y == 0 or y == h - 1 or s[k] == 0 or e[k] == w:
                edge.add(i)
        if y == 0:
            continue
        ps, pe = starts[y - 1], ends[y - 1]
        j = 0
        for k in range(len(s)):
            while j < len(ps) and pe[j] <= s[k]:
                j += 1
            m = j
            while m < len(ps) and ps[m] < e[k]:
                a, b = find(base[y] + k), find(base[y - 1] + m)
                if a != b:
                    parent[max(a, b)] = min(a, b)
                m += 1
    roots = {find(i) for i in edge}
    out = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for k in range(rows[y]):
            if find(base[y] + k) in roots:
                out[y, starts[y][k]:ends[y][k]] = True
    return out


def cutout_white(im: Image.Image, tol: int = WHITE_TOL, edge_share: float = EDGE_SHARE) -> Image.Image | None:
    """The picture with the white ground round it made transparent (an
    RGBA image), or None when it is not an illustration on white: less than
    `edge_share` of its border is white, or the outer white takes under 3 %
    or over 95 % of it. One pixel of light edge round the art is half
    transparent, so the cut-out blends into a ground that is not white."""
    import numpy as np

    rgb = np.asarray(to_rgb(im).convert("RGB"))
    h, w = rgb.shape[:2]
    if h < 3 or w < 3:
        return None
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    if (border >= 255 - tol).all(axis=1).mean() < edge_share:
        return None
    mask = outer_white(rgb, tol)
    share = float(mask.mean())
    if share < MIN_SHARE or share > MAX_SHARE:
        return None
    alpha = np.where(mask, 0, 255).astype(np.uint8)
    near = np.zeros_like(mask)
    near[1:, :] |= mask[:-1, :]
    near[:-1, :] |= mask[1:, :]
    near[:, 1:] |= mask[:, :-1]
    near[:, :-1] |= mask[:, 1:]
    soft = near & ~mask & (rgb.min(axis=2) >= 200)
    alpha[soft] = 128
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


# ---------------------------------------------------------------------------
# a resource's file, cut or cropped, with its fields kept in place


def load_resources(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["resources"] if isinstance(data, dict) and "resources" in data else data


def save_resources(path: Path, resources: list[dict]) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "resources" in data:
        data["resources"] = resources
    else:
        data = resources
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def resource_file(res: dict, root: Path) -> Path:
    f = res.get("file") or (res.get("bitmap") or {}).get("file")
    if not f:
        raise SystemExit(f"{res.get('id')}: no file")
    return root / f


def set_size(res: dict, w: int, h: int) -> None:
    for holder in (res, res.get("bitmap")):
        if isinstance(holder, dict) and "width" in holder:
            holder["width"], holder["height"] = w, h


def amount_px(value: str | None, res: dict) -> int:
    """`12`, `12px` or `3mm` (through the resource's `resolution`, px per inch)."""
    if not value:
        return 0
    v = value.strip().lower()
    if v.endswith("mm"):
        dpi = float(res.get("resolution") or (res.get("bitmap") or {}).get("resolution") or 0)
        if dpi <= 0:
            raise SystemExit(f"{res.get('id')}: no resolution to read mm by; give pixels")
        return round(float(v[:-2]) / 25.4 * dpi)
    return round(float(v[:-2] if v.endswith("px") else v))


def remap_fields(res: dict, left: int, top: int, w0: int, h0: int, w1: int, h1: int) -> list[str]:
    """Move the fractional fields of a resource (anchors and their heads and
    faces, avoid, faces, safeArea, contour points) from the old picture
    (w0 × h0) to its crop (w1 × h1 from left/top). Returns warnings for the
    points that fall outside the crop."""
    warn: list[str] = []

    def pt(x: float, y: float) -> tuple[float, float]:
        return (round((x * w0 - left) / w1, 4), round((y * h0 - top) / h1, 4))

    def area(a: dict) -> dict:
        x, y = pt(a["x"], a["y"])
        return {**a, "x": x, "y": y, "width": round(a["width"] * w0 / w1, 4), "height": round(a["height"] * h0 / h1, 4)}

    for a in res.get("anchors", []) or []:
        a["x"], a["y"] = pt(a["x"], a["y"])
        if not (0 <= a["x"] <= 1 and 0 <= a["y"] <= 1):
            warn.append(f"anchor {a.get('id')} now lies outside the picture ({a['x']}, {a['y']})")
        if isinstance(a.get("head"), dict):
            a["head"]["x"], a["head"]["y"] = pt(a["head"]["x"], a["head"]["y"])
        if isinstance(a.get("face"), dict):
            a["face"] = area(a["face"])
    for key in ("avoid", "faces"):
        if isinstance(res.get(key), list):
            res[key] = [area(a) for a in res[key]]
    if isinstance(res.get("safeArea"), dict):
        res["safeArea"] = area(res["safeArea"])
    pts = (res.get("contour") or {}).get("points") if isinstance(res.get("contour"), dict) else None
    if pts:
        res["contour"]["points"] = [dict(zip(("x", "y"), pt(p["x"], p["y"]))) for p in pts]
    return warn


def find_resource(resources: list[dict], rid: str) -> dict:
    res = next((r for r in resources if r.get("id") == rid), None)
    if res is None:
        raise SystemExit(f"no resource {rid!r}")
    return res


def cmd_crop(args) -> None:
    path = Path(args.resources)
    resources = load_resources(path)
    res = find_resource(resources, args.id)
    file = resource_file(res, path.parent)
    with Image.open(file) as im:
        im.load()
        w0, h0 = im.size
        l, t = amount_px(args.left, res), amount_px(args.top, res)
        r, b = amount_px(args.right, res), amount_px(args.bottom, res)
        if l < 0 or t < 0 or r < 0 or b < 0 or l + r >= w0 or t + b >= h0:
            raise SystemExit(f"{args.id}: the crop leaves nothing of {w0}x{h0}")
        out = im.crop((l, t, w0 - r, h0 - b))
    w1, h1 = out.size
    if file.suffix.lower() in (".jpg", ".jpeg"):
        out.convert("RGB").save(file, quality=args.quality)
    else:
        out.save(file)
    warn = remap_fields(res, l, t, w0, h0, w1, h1)
    set_size(res, w1, h1)
    save_resources(path, resources)
    print(json.dumps({"id": args.id, "file": str(file), "width": w1, "height": h1, "warnings": warn}, ensure_ascii=False))


def cmd_cutout(args) -> None:
    path = Path(args.resources)
    resources = load_resources(path)
    res = find_resource(resources, args.id)
    file = resource_file(res, path.parent)
    with Image.open(file) as im:
        im.load()
        cut = cutout_white(im, args.tol, 0.0 if args.force else EDGE_SHARE)
    if cut is None:
        raise SystemExit(f"{args.id}: no white ground joined to the edge to cut out")
    png = file.with_suffix(".png")
    cut.save(png, optimize=True)
    if png != file:
        file.unlink()
    rel = png.relative_to(path.parent).as_posix()
    if "file" in res:
        res["file"] = rel
    elif isinstance(res.get("bitmap"), dict):
        res["bitmap"]["file"] = rel
    res.setdefault("contour", {"threshold": 0.5, "margin": {"value": 1.5, "unit": "mm"}})
    save_resources(path, resources)
    print(json.dumps({"id": args.id, "file": str(png), "contour": res["contour"]}, ensure_ascii=False))


def cmd_prep(args) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = []
    for f in args.inputs:
        src = Path(f)
        im = Image.open(src)
        im.load()
        icc = im.info.get("icc_profile")
        im = to_rgb(im)
        if args.crop:
            x0, y0, x1, y1 = (float(v) for v in args.crop.split(","))
            im = im.crop((round(x0 * im.width), round(y0 * im.height), round(x1 * im.width), round(y1 * im.height)))
        if args.gray:
            im = im.convert("L")
        if args.autocontrast:
            im = ImageOps.autocontrast(im, cutoff=(0.5, 0.2))
        if args.trim_white:
            im = trim_white(im, args.trim_white)
        if args.max and max(im.size) > args.max:
            im.thumbnail((args.max, args.max), Image.LANCZOS)
        fmt = args.format
        if fmt == "keep":
            fmt = "png" if src.suffix.lower() == ".png" else "jpg"
        dest = out / (re.sub(r"[^a-z0-9-]+", "-", src.stem.lower()).strip("-") + "." + fmt)
        if fmt == "jpg":
            im.convert("RGB" if im.mode != "L" else "L").save(dest, "JPEG", quality=args.quality, progressive=True, optimize=True)
        else:
            im.save(dest, "PNG", optimize=True)
        entry = {"file": str(dest), "width": im.width, "height": im.height}
        if icc and b"CMYK" in icc[:40]:
            entry["note"] = "converted from CMYK: check the colours against the print"
        report.append(entry)
    print(json.dumps(report, indent=2))


def cmd_join(args) -> None:
    ims = [to_rgb(Image.open(f)) for f in args.inputs]
    h = min(i.height for i in ims)
    ims = [i.resize((round(i.width * h / i.height), h), Image.LANCZOS) for i in ims]
    gap = round(h * args.gap)
    w = sum(i.width for i in ims) + gap * (len(ims) - 1)
    canvas = Image.new("RGB", (w, h), (255, 255, 255))
    x = 0
    for i in ims:
        canvas.paste(i.convert("RGB"), (x, 0))
        x += i.width + gap
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, quality=88)
    print(json.dumps({"file": str(out), "width": w, "height": h}))


def cmd_size(args) -> None:
    for f in args.files:
        p = Path(f)
        if p.suffix.lower() == ".svg":
            head = p.read_text(encoding="utf-8", errors="ignore")[:4000]
            w = re.search(r'\swidth="([\d.]+)', head)
            h = re.search(r'\sheight="([\d.]+)', head)
            vb = re.search(r'viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)', head)
            size = (float(w.group(1)), float(h.group(1))) if w and h else ((float(vb.group(1)), float(vb.group(2))) if vb else None)
            print(json.dumps({"file": f, "width": size[0], "height": size[1]} if size else {"file": f, "error": "no size"}))
        else:
            with Image.open(p) as im:
                print(json.dumps({"file": f, "width": im.width, "height": im.height, "mode": im.mode}))


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prep")
    p.add_argument("inputs", nargs="+")
    p.add_argument("--out", required=True)
    p.add_argument("--max", type=int, default=2400)
    p.add_argument("--quality", type=int, default=84)
    p.add_argument("--gray", action="store_true")
    p.add_argument("--autocontrast", action="store_true")
    p.add_argument("--trim-white", type=int)
    p.add_argument("--crop")
    p.add_argument("--format", choices=["jpg", "png", "keep"], default="keep")
    p = sub.add_parser("join")
    p.add_argument("inputs", nargs="+")
    p.add_argument("--out", required=True)
    p.add_argument("--gap", type=float, default=0.02)
    p = sub.add_parser("size")
    p.add_argument("files", nargs="+")
    p = sub.add_parser("crop")
    p.add_argument("id")
    p.add_argument("--resources", default="resources.json")
    for side in ("top", "left", "right", "bottom"):
        p.add_argument(f"--{side}", help="px (12, 12px) or mm (3mm) to take off this side")
    p.add_argument("--quality", type=int, default=92)
    p = sub.add_parser("cutout")
    p.add_argument("id")
    p.add_argument("--resources", default="resources.json")
    p.add_argument("--tol", type=int, default=WHITE_TOL)
    p.add_argument("--force", action="store_true", help="cut the white out even when the border is not mostly white")
    args = ap.parse_args(argv)
    {"prep": cmd_prep, "join": cmd_join, "size": cmd_size, "crop": cmd_crop, "cutout": cmd_cutout}[args.cmd](args)


if __name__ == "__main__":
    main()
