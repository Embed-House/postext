#!/usr/bin/env python3
"""Composed pages: which porting round the installed Postext supports, and
the round-2 checks of a ported book, edition by edition.

  composed_check.py round [--version 1.36.0] [--postext CMD] [--json]
      Reads the engine version (`postext --version`, else the npm package
      render.mjs uses in ~/.cache/postext-tools) and prints the round to port
      fixed pages with: round 2 (page templates, references/composed-pages.md)
      from postext 1.35.0, round 1 (playbooks J) before it, and the composed-
      page features the version lacks with what to do instead. Name the round
      and the version in the port's report.

  composed_check.py check my-book [--locale es]... [--stress 1.3] [--postext CMD]
                        [--offline] [--keep DIR] [--json]
      For every edition (or the --locale ones): runs `postext check --json`
      and `postext html`, then fails on
        - frameOverflow, frameContinuationLimit, continueTargetMissing,
          contentInConfig, tocGroupSplit,
          the composed pages' source warnings (templateUnknown, slotUnknown,
          pageFenceLength, spreadMismatch, unclosedContainer), the page
          templates' config warnings, labelAnchorUnknown, labelOverflow
          (1.39: a label wider than its anchor at the style's minScale) and
          calloutStyleExtendsUnknown / calloutStyleExtendsCycle (1.39),
          figureWordsShared (1.42: a figure's words dropped for the first
          figure's), headingClaimsColumn (1.43: an in-column heading whose
          design reserves the whole column) and a labelOverlap that runs onto a symbol of the picture
          (1.42: the label meets one of its `avoid` zones), repeatOverflow, moduleUnknown,
          moduleAsPage, moduleNested and moduleNameRejected (1.48);
        - frameCovered and frameOutsideArea (1.48: a frame under another frame, or past the
          trim, the bleed or the frame it is anchored inside), each with the fixes the engine
          proposes, unless the project records the pair as meant in composed-check.json
          (or --exceptions FILE) with its reason:
              {"overlaps": [{"kind": "frameCovered", "template": "photos",
                             "frame": "grid-picture[*]", "coveredBy": "pill-*",
                             "reason": "the source sets each pill over its photo"}]}
          (`frame` and `reason` required; `[*]` any instance, `*` any run of characters;
          `kind`, `template`, `coveredBy`, `past`, `target`, `locale`, `page` narrow it).
          Prefer `overlap: "allow"` on the frame for art that always lies over text: the
          engine then skips the pair, and the report lists such frames as a note;
        - a composed page whose frames the HTML writes in another order than
          the Markdown sends content to them (reading order = source order);
      warns when two editions read the frames of one page fence in different
      orders, lists the reflow log (text or pictures the ladder scaled) and
      the notes to read edition by edition (slotEmpty, anchorUnlabelled,
      labelOverlap: two labels that run into each other, 1.39; allow the
      ones the source prints touching with `overlap: "allow"`, 1.42).
      --stress 1.3 lays every edition out again with each paragraph, heading
      and list item 30 % longer (its own words repeated, markup untouched),
      as the Cookbook bench does (C38): a warning the longer text raises
      fails, except a frameOverflow whose proposals carry values (a warning:
      the copy-fitter's next move).
      The report ends with the number of overlaps that fail (0 to pass) and
      lists the exceptions that matched nothing.

The postext command defaults to `postext`; pass another one with --postext
(`--postext "npx postext-cli"`, `--postext "bun ~/src/postext/packages/postext-cli/src/main.ts"`).
Exit code 1 when a check fails, 2 when the command line tool cannot run.
"""
from __future__ import annotations

import argparse
import html.parser
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import preset_kit as kit  # noqa: E402

# --- round: what the installed Postext can do --------------------------------

#: (first release, key, what it brings, what to do without it). Verified
#: against the release tags of drnachio/postext.
FEATURES: list[tuple[tuple[int, int, int], str, str, str]] = [
    ((1, 34, 0), "templates", "pageTemplates, labelStyles and the ::::page / :::frame / :::figure Markdown "
     "read and checked (nothing laid out yet)", "round 1: fixed callouts (playbooks J)"),
    ((1, 34, 0), "contentInConfig", "postext check warns contentInConfig", "preset_kit.py lint counts it"),
    ((1, 34, 1), "layout", "composed pages laid out: frames, placement, decoration, next chains, "
     "exclude: push, layers, rotate", "round 1: fixed callouts (playbooks J)"),
    ((1, 35, 0), "groups", "stack and row groups: boxes that grow with their text push the ones after them, "
     "pins, the reflow log", "round 1"),
    ((1, 35, 0), "spreads", "spread templates over two facing pages", "round 1"),
    ((1, 35, 0), "outputs", "HTML, EPUB and tagged PDF read composed pages in Markdown order", "round 1"),
    ((1, 36, 0), "ladder", "the reflow ladder (fit: pictures, then text set smaller) and frameOverflow "
     "with proposals", "give each frame its room by hand (maxHeight, a chained frame, shorter text); "
     "frameOverflow carries no proposals"),
    ((1, 36, 0), "sourceMap", "sourceAt / elementsForSource / findElement, stable ids",
     "skip the source-map check"),
    ((1, 36, 0), "contour", "frames that push text round a picture's outline (wrap: 'contour')",
     "a frame that pushes with its box, or the box's padding"),
    ((1, 37, 0), "continuation", "overflow.continueIn 'next-page' / 'template:<id>': a box goes on on an "
     "added page", "a taller frame (maxHeight), a chained frame on the same page, or the box set "
     "as a flow page; never the rest typed into a second page fence"),
    ((1, 37, 0), "labels", "::label words drawn at a picture's anchors (maps, diagrams)",
     "round-1 labels: the words in a live-text SVG per language (playbooks J4)"),
    ((1, 37, 0), "migration", "moveTextToMarkdown: a 1.33 port's page designs become page "
     "templates and page fences", "rewrite those pages by hand"),
    ((1, 37, 0), "headingDesigns", "a heading in a frame or a box keeps its level's or style's design "
     "(tab, band, {titleText}); letterSpacing on paragraph styles",
     "a tabbed title as a frame of its own (takes: 'h1', a callout style); a tracked title as a hidden "
     "heading in a frame"),
    ((1, 38, 0), "continueFirst", "a frame that can go on to another page goes on before it shrinks "
     "(fit.preferContinue); a threaded story goes on in the frame its chain starts in; a cut keeps a "
     "heading with its text; the answer space under a box goes on with it",
     "fit: { shrinkText: false, scaleImages: false } on body frames; two templates with distinct frame "
     "names that hand the story to each other"),
    ((1, 38, 0), "jumps", "continueIn 'page:<id>' (a story jumps to a later page fence), {page} in "
     "overflow.mark, overflow.fromMark, continueTargetMissing",
     "say 'continued on page N' as plain words and list it as a gap; set the rest on the page after"),
    ((1, 38, 0), "answerSpaces", "stacks keep their empty frames when a box above grows; rows of "
     "height 'auto' + minHeight share width; frame rules (ruled lines at a pitch)",
     "decoration rules anchored to the frame; fixed height + maxHeight on the cards"),
    ((1, 38, 0), "designSizes", "{ to, edge } sizes of design elements, fit 'cover' + focus on design "
     "images, drop caps in frames, vertical spreads",
     "heights computed in the generator; photos cut to the box's ratio; no drop cap; a horizontal "
     "spread on a vertical book"),
    ((1, 38, 0), "textPanels", "comic ::panel{text} (Markdown in a panel) and box=<callout style>",
     "letter the words as captions"),
    ((1, 38, 0), "partialTypes", "resourceTypes entries that leave fields out take the built-in type's",
     "write every field of the type"),
    ((1, 38, 0), "labelsOnPictures", "moveTextToMarkdown({ labelsOnPictures }) turns words on a picture "
     "into labels", "those words stay frames"),
    ((1, 38, 0), "sandboxFixes", "Sandbox Canvas > Reflow, anchors placed by a click, "
     "sandbox_apply_proposal", "apply the proposals' values to the configuration by hand"),
    ((1, 39, 0), "labelChecks", "labelOverlap / labelOverflow per edition; writingMode 'vertical-rl' on an "
     "anchor or a label style (vertical map names)",
     "look at every edition's map pages for names that collide or overflow; set a CJK map's names "
     "horizontally and name the gap"),
    ((1, 39, 0), "figureWords", "alt, caption and note of a figure in the Markdown "
     "(:::figure{alt} + ::caption[] / ::note[] lines), per edition",
     "alt text, captions and notes of the shared resource in localized.<lang>.resources"),
    ((1, 39, 0), "styleExtends", "calloutStyles[].extends: a thin style per place on one full style per look",
     "one full style per box; merge styles by their look alone only when the boxes take their "
     "place from template frames"),
    ((1, 39, 0), "frameModes", "a frame's own writingMode and direction (a vertical box on a horizontal "
     "page, a horizontal card on a vertical one, an rtl quotation in an ltr book)",
     "keep the card in the page's mode; a right-to-left quotation as a {dir=rtl} block"),
    ((1, 39, 0), "startEnd", "top-start / start / bottom-start / top-end / end / bottom-end and "
     "align-start / align-end edges for design elements",
     "choose top-left or top-right per edition in the generator"),
    ((1, 39, 0), "cuts", "widow and orphan rules in :::columns groups and frame columns; drop caps that "
     "follow the flow's rules across frame cuts; a takes title frame gives the text frame its initial",
     "copy edits against a lone line at a column head or foot; a :::paragraphs{dropcap} group in the "
     "text frame"),
    ((1, 39, 0), "textPanelsMirrored", "comic text panels set in their frames on right-to-left and "
     "vertical pages, slanted lines, ::panel{text shrink}",
     "letter those editions' words as caption: lines"),
    ((1, 39, 0), "coverUpright", "fit 'cover' crops an upright picture of a vertical flow",
     "cut the picture to the box's ratio for vertical editions"),
    ((1, 39, 0), "sourceAtFlow", "sourceAt reads frames in the flow frame on right-to-left and vertical "
     "composed pages (SourceElement.flow, flowRectToPage)",
     "a sheet point on such a frame finds only the template: map the point to the flow by hand"),
    ((1, 39, 0), "editionsKept", "the Sandbox keeps every edition of a bundle imported as a project "
     "(#project=ID&lang=L)", "import each edition to look at it"),
    ((1, 39, 0), "wordTracking", "postext import-docx sets Word styles' character spacing as letterSpacing; "
     "docx export writes it", "set the paragraph styles' tracking by hand"),
    ((1, 40, 0), "labelStyleOff", "a label style that borrows a paragraph style can switch its italics and "
     "capitals off (fontStyle 'normal', textTransform 'none'); vertical labels on right-to-left pages",
     "give the label style its own font and size instead of borrowing the paragraph style; set vertical "
     "names of a right-to-left edition horizontally and name the gap"),
    ((1, 40, 0), "epubLabels", "the reflowable EPUB draws plain figure labels over the picture (an SVG layer)",
     "the reflowable EPUB lists the labels after the picture; say the map reads as a list there"),
    ((1, 40, 0), "textPanelsStrips", "comic text panels set in their frames on :::strip and "
     ":::page{spread}; valign=middle|bottom in a slanted cell follows the slant",
     "letter a strip's or spread's words as caption: lines; keep text in slanted cells at the top"),
    ((1, 40, 0), "framesRtl", "a frame's own writingMode on right-to-left pages, pictures upright in a "
     "vertical frame, reflowable EPUB frames with writing-mode",
     "keep the frame in the page's mode on right-to-left pages; a picture in a vertical frame turns with "
     "it, so keep pictures out of such frames"),
    ((1, 40, 0), "migrationLayer", "moveTextToMarkdown with labelsOnPictures puts the picture's frame under "
     "decoration the design painted over it (layer -1)",
     "read the overPicture difference and move the decoration by hand"),
    ((1, 40, 0), "editionChecks", "sandbox_get_composed_checks (WebMCP): the composed checks of every "
     "edition by language, chapter, page and frame; useTemplate proposals tried exactly",
     "check each edition by switching to it; read `fits` of every useTemplate proposal"),
    ((1, 40, 0), "wordTrackingSandbox", "the Sandbox's Word import takes the character spacing of the "
     "Word styles (sandbox_import_word characterSpacing)", "run postext import-docx or set the tracking by hand"),
    ((1, 41, 0), "jumpsAcrossChapters", "continueIn 'page:<id>' reaches a page fence of a later chapter file "
     "(one chapter file per article)", "keep an article and its jump page in one chapter file"),
    ((1, 42, 0), "boxTracking", "calloutStyles[].body.letterSpacing tracks the paragraphs and list items of a box",
     "wrap the box's paragraphs in a :::paragraphs{style} fence of a tracked paragraph style"),
    ((1, 42, 0), "decorationRemove", "a child template or variant takes a base decoration element out with "
     "{ id, remove: true }", "split the base so the element lives in the templates that have it"),
    ((1, 42, 0), "slotRename", "the Sandbox renames a frame together with the slot of the page fences that "
     "fill it (and in the other editions of a local project)", "rename the slot in every edition's Markdown by hand"),
    ((1, 42, 0), "frameLook", "a frame's own colours (look) and the page palette (palette on a template or the "
     "page fence): one callout style per box shape serves every tint",
     "one thin `extends` style per tint that writes only the colours"),
    ((1, 42, 0), "autoWidth", "width 'auto' on a frame is its longest line plus padding (up to maxWidth): a "
     "title tab or a box as wide as its title in every edition",
     "give every edition the width of its longest title and set the text smaller with fit.minScale"),
    ((1, 42, 0), "labelIconInside", "label.icon.placement 'inside' puts the picture of a tab inside it, "
     "before the words", "the picture stands beside the tab (placement 'beside'): draw the ring in the tab's own "
     "art or accept the beside look and name the gap"),
    ((1, 42, 0), "headingNumber", "{headingNumber} / {headingNumber.<frame>} in a decoration text, and a click "
     "on decoration text over a frame", "the number as a page-fence attribute ({attr.n}) copied by hand"),
    ((1, 42, 0), "tocFrame", "takes 'toc' (or :::toc inside a :::frame): the contents laid in a frame, with its "
     "part rows, leaders and keep, over the page ground of the template",
     "a flow page with a heading design for the contents, its ground in the design"),
    ((1, 42, 0), "labelSymbols", "overlap 'allow' on an anchor or a label style; the picture's avoid zones "
     "count as map symbols (labelOverlap carries withSymbol)",
     "labelOverlap lists every touching name the source prints: read it as a note and name the count"),
    ((1, 42, 0), "figureWordsShared", "figureWordsShared warns when a later figure of a resource says other "
     "words than the first", "read the figures of one resource by eye: only the first figure's words show"),
    ((1, 42, 0), "labelsEpubRtl", "the reflowable EPUB draws plain figure labels of a right-to-left book",
     "those labels go to the hidden list of the reflowable EPUB; say so"),
    ((1, 42, 0), "fontFallback", "fonts[].fallback: an open family stands in for a licensed one the bundle "
     "leaves out", "the plain bundle is set in the generic face, wider than the real one: check the bundle "
     "that carries the faces, not the plain one"),
    ((1, 42, 0), "editionExport", "the Sandbox exports each edition's title and a pagination file "
     "(layouts.<lang>.json) per edition", "set localized.<lang>.name by hand; only the primary edition opens paginated"),
    ((1, 42, 0), "uprightVertical", "pictures upright in the frames of a vertical page's own flow",
     "keep pictures out of the frames of a vertical page's flow"),
    ((1, 42, 0), "carriedOutline", "index marks, anchors and headings in the part of a story that went on in "
     "a later chapter's page are listed where that chapter sets them",
     "put marks and anchors in the part that stays on the first page"),
    ((1, 42, 0), "labelEditorSandbox", "Design > Figures & tables > Label styles, and label dragging on the "
     "Folio's pages", "edit labelStyles through sandbox_set_config or the manifest"),
    ((1, 43, 0), "labelsOffFold", "labels of a figure across the spine slide off the gutter band, on the side "
     "of their anchor; gutter 'cross' on an anchor keeps a name across both pages; renaming a label style in the "
     "Sandbox rewrites its anchors and ::label lines", "look at the spread's labels near the fold in the "
     "rendered pages and rename a label style in every file by hand"),
    ((1, 43, 0), "svgSymbols", "the Sandbox reads an SVG's own dots and icons as avoid zones (Avoid zones mode, "
     "svgSymbols)", "write the avoid rectangles by hand, in fractions of the picture"),
    ((1, 43, 0), "standInExports", "the faces of a family's fallback are embedded in the EPUB, the HTML and the "
     "SVG pictures set in a licensed family", "the reading system picks a face for the licensed family: name the gap"),
    ((1, 43, 0), "labelIconTint", "label.icon.tint paints a tab's picture in label.color",
     "one picture per tab colour"),
    ((1, 43, 0), "tocPartBreak", "toc.parts.breakBefore cuts a contents frame that can go on before every "
     "part but the first", "one contents frame per part, chained by next"),
    ((1, 43, 0), "headingClaimsColumn", "headingClaimsColumn: an in-column heading whose design reserves the "
     "whole column", "look at multi-column pages for text that starts in the next column"),
    ((1, 43, 0), "sandboxEditions", "Sandbox: Add a language... (sandbox_save_book add_language), rename one "
     "language only, group order of the template editor", "copy the chapters of an edition and set "
     "config.locale by hand"),
    ((1, 46, 0), "columnHeadings", "a frame set in columns (or a :::columns group) never ends a column on a "
     "heading: under headings.keepWithNext the heading goes on with its text",
     "look at the column feet of frames set in columns for a stranded heading"),
    ((1, 48, 0), "overlapChecks", "frameCovered and frameOutsideArea: a frame under another frame, or past the "
     "trim, the bleed or the frame it is anchored inside, with fixes; Frame.overlap 'allow'",
     "compare the page images with the source for captions under photos and notes past their cards"),
    ((1, 48, 0), "connectors", "decoration connectors between frames (straight, elbow, tree; '#card[*]'; caps; "
     "ends at a picture's anchor, painted over the frames)",
     "the lines of a diagram in the raster ground (pdf_regions.py extract --raster-ground)"),
    ((1, 48, 0), "leaders", "labelAt sets a label away from its point and leader draws the line back to it; "
     "::label{leader} / leader=\"none\"; LabelStyle.leader",
     "the label at its point, or the leader line drawn in the picture"),
    ((1, 48, 0), "legends", "kind 'legend' label styles, :::label containers of several lines, :icon symbols "
     "(resource, glyph, line sample) in labels, captions and cells", "the key as part of the picture"),
    ((1, 48, 0), "shapes", "per-corner borderRadius and per-side borders on callout styles and decoration "
     "boxes, a tab joined to its box (label.joined, fillet), path elements (kind 'path', SVG path data)",
     "a card drawn in the raster ground; one radius and one border per box"),
    ((1, 48, 0), "glyphTabIcon", "label.icon kind 'glyph': a character as a tab's icon",
     "a picture resource as the tab's icon (label.icon.resourceId)"),
    ((1, 48, 0), "sidePoints", "anchor.at (a point along a side) and size edge 'center' in design slots",
     "offsets worked out in the generator"),
    ((1, 48, 0), "grids", "kind 'grid' groups with repeat: one frame set laid per item of the Markdown "
     "(instances foto[2]), going on by whole rows", "one frame per card (foto-1, foto-2…) in row groups"),
    ((1, 48, 0), "modules", "role 'module' templates stacked by a modules group, filled from :::module blocks "
     "(instances arbol[1].raiz), going on whole", "one page template per page"),
    ((1, 48, 1), "moduleConnectorToPage", "a module's connector may end on a frame of the page that stacks it",
     "keep a module's connectors between its own frames"),
    ((1, 49, 0), "ringBarCaps", "ring and bar caps on connectors and leaders, opacity on connector and leader "
     "lines", "dot caps; an opaque casing under a dashed line"),
]

ROUND2: tuple[int, int, int] = (1, 35, 0)

_VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)")


def parse_version(text: str) -> tuple[int, int, int] | None:
    """The engine version in `postext --version` output (`postext 1.36.0
    (engine 1.36.0, darwin-arm64)`: the engine's), or in a bare `1.36.0`."""
    m = re.search(r"engine\s+v?(\d+)\.(\d+)\.(\d+)", text) or _VERSION.search(text)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def vstr(v: tuple[int, int, int]) -> str:
    return ".".join(map(str, v))


def plan_for(version: tuple[int, int, int]) -> dict:
    """The round for `version`, with the features it has and lacks."""
    have = [f for f in FEATURES if version >= f[0]]
    lack = [f for f in FEATURES if version < f[0]]
    rnd = 2 if version >= ROUND2 else 1
    return {
        "version": vstr(version),
        "round": rnd,
        "reference": "references/composed-pages.md" if rnd == 2 else "references/playbooks.md (J)",
        "has": [{"feature": k, "since": vstr(v), "what": w} for v, k, w, _ in have],
        "lacks": [{"feature": k, "since": vstr(v), "what": w, "instead": i} for v, k, w, i in lack],
    }


def postext_cmd(spec: str | None) -> list[str]:
    return shlex.split(spec) if spec else ["postext"]


def detect_version(cmd: list[str]) -> tuple[tuple[int, int, int] | None, str]:
    """(version, where it was read)."""
    try:
        r = subprocess.run([*cmd, "--version"], capture_output=True, text=True, timeout=60)
        v = parse_version(r.stdout + r.stderr)
        if v:
            return v, " ".join(cmd) + " --version"
    except (OSError, subprocess.TimeoutExpired):
        pass
    pkg = Path.home() / ".cache" / "postext-tools" / "node_modules" / "postext" / "package.json"
    if pkg.is_file():
        try:
            v = parse_version(str(json.loads(pkg.read_text(encoding="utf-8")).get("version", "")))
            if v:
                return v, str(pkg)
        except (OSError, ValueError):
            pass
    return None, "not found"


def cmd_round(args) -> int:
    if args.version:
        v, where = parse_version(args.version), "--version"
    else:
        v, where = detect_version(postext_cmd(args.postext))
    if v is None:
        print("No Postext found: install the command line (SKILL.md, Setup) or pass --version X.Y.Z.",
              file=sys.stderr)
        return 2
    plan = plan_for(v)
    plan["from"] = where
    if args.json:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0
    print(f"postext {plan['version']} ({where}): round {plan['round']}, {plan['reference']}")
    if plan["round"] == 1:
        print("  Composed pages need postext 1.35.0 (groups, spreads, reading order in every output).")
        print("  Update the command line (releases/latest) unless the book must open in this version.")
        return 0
    for f in plan["lacks"]:
        print(f"  missing {f['feature']} (postext {f['since']}): {f['what']}")
        print(f"      instead: {f['instead']}")
    return 0


# --- the Markdown side: which frame each piece of a page fence goes to -------

_PAGE_OPEN = re.compile(r"^(:{4,})page\b\s*(\{.*\})?\s*$")
_CONTAINER = re.compile(r"^:::([a-z][\w-]*)\s*(\{.*\})?\s*$")
_CLOSE = re.compile(r"^:::\s*$")
_LEAF = re.compile(r"^::[a-z]")
_CODE = re.compile(r"^\s*(```+|~~~+)(.*)$")
_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
_ATTRS = re.compile(r"([A-Za-z_][\w-]*)\s*=\s*\"([^\"]*)\"")
_TRAILING_ATTRS = re.compile(r"\{([^{}]*)\}\s*$")
CONTAINERS = {"callout", "paragraphs", "part", "columns", "paper", "frame", "figure", "verse", "references", "label"}


def attrs_of(text: str | None) -> dict[str, str]:
    return dict(_ATTRS.findall(text or ""))


def resolve_frames(templates: list[dict], tid: str) -> list[dict] | None:
    """The frames of template `tid` with its `extends` chain merged by name
    (variants are not applied: the engine shares content out with the
    template as written). None for an unknown id or a cycle."""
    by_id: dict[str, dict] = {}
    for t in templates or []:
        if isinstance(t, dict) and isinstance(t.get("id"), str) and t["id"] not in by_id:
            by_id[t["id"]] = t
    chain: list[dict] = []
    seen: set[str] = set()
    cur: str | None = tid
    while cur is not None:
        if cur in seen or cur not in by_id:
            if cur in seen:
                return None
            if not chain:
                return None
            break
        seen.add(cur)
        chain.append(by_id[cur])
        ext = by_id[cur].get("extends")
        cur = ext if isinstance(ext, str) else None
    frames: dict[str, dict] = {}
    for t in reversed(chain):
        for f in t.get("frames") or []:
            if not isinstance(f, dict) or not isinstance(f.get("name"), str):
                continue
            if f.get("remove"):
                frames.pop(f["name"], None)
            elif f["name"] in frames:
                frames[f["name"]] = {**frames[f["name"]], **f}
            else:
                frames[f["name"]] = dict(f)
    return list(frames.values())


def template_spread(templates: list[dict], tid: str) -> bool:
    """Whether template `tid` is a spread (its own `spread`, or inherited)."""
    by_id = {t["id"]: t for t in reversed(templates or []) if isinstance(t, dict) and isinstance(t.get("id"), str)}
    seen: set[str] = set()
    cur: Any = tid
    while isinstance(cur, str) and cur in by_id and cur not in seen:
        seen.add(cur)
        if "spread" in by_id[cur]:
            return bool(by_id[cur]["spread"])
        cur = by_id[cur].get("extends")
    return False


def chain_next(frame: dict) -> str | None:
    nxt = frame.get("next")
    if isinstance(nxt, str):
        return nxt
    cont = (frame.get("overflow") or {}).get("continueIn") if isinstance(frame.get("overflow"), dict) else None
    return cont[1:] if isinstance(cont, str) and cont.startswith("#") else None


def page_fences(markdown: str) -> list[dict]:
    """The `::::page` fences of a chapter, in order: `template`, `attrs`,
    `line` (1-based) and `items`, the slot each top-level piece of the page
    asks for (`slot` None = no slot) with its kind (`heading` + level,
    `block`, `container`). A slotted container also lists the pieces one
    level inside it (`within`: the members of a repeating grid's item); a
    `:::module{template name}` (postext 1.48) is an item of kind `module`
    whose own `items` are read like the page's."""
    lines = markdown.replace("\r\n", "\n").split("\n")
    out: list[dict] = []
    i = 0
    while i < len(lines):
        m = _PAGE_OPEN.match(lines[i])
        if not m:
            i += 1
            continue
        colons = m.group(1)
        a = attrs_of(m.group(2))
        fence = {"template": a.get("template"), "attrs": a, "line": i + 1, "items": [],
                 "spread": bool(m.group(2) and re.search(r"(^|[\s{])spread([\s}]|$)", m.group(2)))}
        i += 1
        # Open containers: the list their children are recorded in (None: not
        # recorded) and whether it is a level of the page (the page itself or a
        # module) or the `within` of a slotted container (recorded flat).
        stack: list[tuple[list | None, bool]] = []
        code: str | None = None
        para = False
        while i < len(lines):
            line = lines[i]
            if code is not None:
                if line.strip().startswith(code):
                    code = None
                i += 1
                continue
            if not stack and line.strip() == colons:
                i += 1
                break
            if not stack and _PAGE_OPEN.match(line):
                break  # a page left open closes at the next one
            into, level = stack[-1] if stack else (fence["items"], True)
            cm = _CODE.match(line)
            if cm:
                code = cm.group(1)
                if into is not None:
                    into.append({"kind": "block", "slot": attrs_of(cm.group(2)).get("slot"), "line": i + 1})
                para = False
                i += 1
                continue
            ct = _CONTAINER.match(line)
            if ct and (ct.group(1) in CONTAINERS or ct.group(1) == "module"):
                name, ca = ct.group(1), attrs_of(ct.group(2))
                child: tuple[list | None, bool] = (None, False)
                if into is not None and level and name == "module":
                    if into is fence["items"]:
                        item = {"kind": "module", "template": ca.get("template"), "name": ca.get("name"),
                                "slot": None, "line": i + 1, "items": []}
                        into.append(item)
                        child = (item["items"], True)
                    else:
                        child = (into, True)  # a module inside a module: its blocks are the outer one's
                elif into is not None:
                    item = {"kind": "container", "name": name, "slot": ca.get("slot"), "line": i + 1}
                    j = i + 1
                    while j < len(lines) and not lines[j].strip():
                        j += 1
                    if j < len(lines) and _CLOSE.match(lines[j]):
                        item["empty"] = True     # a box whose words all went to frames of their own
                    into.append(item)
                    if level and item["slot"] is not None:
                        item["within"] = []
                        child = (item["within"], False)
                stack.append(child)
                para = False
                i += 1
                continue
            if _CLOSE.match(line):
                if stack:
                    stack.pop()
                i += 1
                para = False
                continue
            if into is None:
                i += 1
                continue
            if not line.strip():
                para = False
                i += 1
                continue
            hm = _HEADING.match(line)
            if hm:
                ta = _TRAILING_ATTRS.search(hm.group(2))
                into.append({"kind": "heading", "level": len(hm.group(1)),
                             "slot": attrs_of(ta.group(1)).get("slot") if ta else None, "line": i + 1})
                para = False
            elif _LEAF.match(line) or line.startswith(":::"):
                into.append({"kind": "block", "slot": attrs_of(line).get("slot") if line.startswith("::resource") else None,
                             "line": i + 1})
                para = False
            elif not para:
                into.append({"kind": "block", "slot": None, "line": i + 1})
                para = True
            i += 1
        out.append(fence)
    return out


def _template(templates: list[dict], tid: str) -> dict | None:
    return next((t for t in templates or [] if isinstance(t, dict) and t.get("id") == tid), None)


def template_groups(templates: list[dict], tid: str) -> list[dict]:
    """The groups of template `tid` with its `extends` chain merged by name."""
    chain: list[dict] = []
    seen: set[str] = set()
    cur: Any = tid
    while isinstance(cur, str) and cur not in seen:
        t = _template(templates, cur)
        if t is None:
            break
        seen.add(cur)
        chain.append(t)
        cur = t.get("extends")
    groups: dict[str, dict] = {}
    for t in reversed(chain):
        for g in t.get("groups") or []:
            if not isinstance(g, dict) or not isinstance(g.get("name"), str):
                continue
            if g.get("remove"):
                groups.pop(g["name"], None)
            else:
                groups[g["name"]] = {**groups.get(g["name"], {}), **g}
    return list(groups.values())


def is_module(templates: list[dict], tid: str) -> bool:
    """Whether `tid` is a module template (`role: 'module'`, its own or inherited)."""
    seen: set[str] = set()
    cur: Any = tid
    while isinstance(cur, str) and cur not in seen:
        t = _template(templates, cur)
        if t is None:
            return False
        seen.add(cur)
        if "role" in t:
            return t.get("role") == "module"
        cur = t.get("extends")
    return False


def repeat_sets(groups: list[dict]) -> dict[str, list[str]]:
    """main frame -> the frame set its repeating grid lays per item (main first)."""
    out: dict[str, list[str]] = {}
    for g in groups:
        rep = g.get("repeat") if g.get("kind") == "grid" else None
        frames = rep.get("frames") if isinstance(rep, dict) else None
        if isinstance(frames, list) and frames and all(isinstance(f, str) for f in frames):
            out.setdefault(frames[0], list(frames))
    return out


_NAME_BAD = re.compile(r"[\s.#\[\]]")


def module_instances(items: list[dict]) -> list[str]:
    """The instance name of each `module` item of a page, as the engine
    names them: the fence's `name` when it is free and has no space, `.`,
    `#`, `[` or `]`, else `<template>[n]` (n its ordinal among the page's
    modules of that template, the next free one on a clash)."""
    mods = [it for it in items if it.get("kind") == "module"]
    taken: set[str] = set()
    given: list[str | None] = []
    for it in mods:
        n = it.get("name")
        ok = isinstance(n, str) and bool(n) and not _NAME_BAD.search(n) and n not in taken
        given.append(n if ok else None)
        if ok:
            taken.add(n)
    count: dict[str, int] = {}
    out: list[str] = []
    for it, n in zip(mods, given):
        t = it.get("template") or ""
        count[t] = count.get(t, 0) + 1
        if n is None:
            k = count[t]
            while f"{t}[{k}]" in taken:
                k += 1
            n = f"{t}[{k}]"
            taken.add(n)
        out.append(n)
    return out


class _Level:
    """One level of a page fence as the engine shares it out: the page with
    its template, or one module with the module's template (its frames named
    `<instance>.<frame>`). Keeps the level's counters across the page."""

    def __init__(self, frames: list[dict], groups: list[dict], prefix: str, outer_flow: str | None,
                 order: list[str]) -> None:
        self.names = {f["name"] for f in frames}
        self.by_name = {f["name"]: f for f in frames}
        self.sets = repeat_sets(groups)
        self.member_of = {m: main for main, fs in self.sets.items() for m in fs}
        self.own_flow = next((f["name"] for f in frames if f.get("flow")), None)
        self.prefix = prefix
        self.flow = prefix + self.own_flow if self.own_flow else outer_flow
        self.takes: dict[int, str] = {}
        for f in frames:
            t = f.get("takes")
            if isinstance(t, str) and re.fullmatch(r"h[1-6]", t) and int(t[1]) not in self.takes:
                self.takes[int(t[1])] = f["name"]
        self.used_levels: set[int] = set()
        self.items: dict[str, int] = {}
        self.order = order

    def put(self, name: str | None) -> None:
        if name and name not in self.order:
            self.order.append(name)

    def frame(self, name: str) -> None:
        seen: set[str] = set()
        cur: str | None = name
        while cur and cur in self.names and cur not in seen:
            seen.add(cur)
            self.put(self.prefix + cur)
            cur = chain_next(self.by_name[cur])

    def to_flow(self) -> None:
        if self.own_flow:
            self.frame(self.own_flow)
        else:
            self.put(self.flow)

    def piece(self, it: dict) -> None:
        slot = it.get("slot")
        if slot is not None and slot in self.member_of:
            # one item of a repeating grid: its main frame and the members written inside it
            main = self.member_of[slot]
            self.items[main] = self.items.get(main, 0) + 1
            k = self.items[main]
            if slot != main:
                self.put(f"{self.prefix}{slot}[{k}]")
                return
            for sub in it.get("within") or [{"slot": None}]:
                s = sub.get("slot")
                self.put(f"{self.prefix}{s if s in self.sets[main] else main}[{k}]")
        elif slot is not None:
            if slot in self.names:
                self.frame(slot)
            else:
                self.to_flow()
        elif it["kind"] == "heading" and it["level"] in self.takes and it["level"] not in self.used_levels:
            self.used_levels.add(it["level"])
            self.frame(self.takes[it["level"]])
        else:
            self.to_flow()


def expected_order(fence: dict, templates: list[dict]) -> list[str] | None:
    """The frames of a page fence in reading order, as the engine reads
    them: each frame where its content first appears in the Markdown, the
    frames its chain continues into right after it. A piece sent to a
    repeating grid's frame is an item whose frames are instances (`foto[2]`,
    `pie[2]`); the frames of a `:::module` are scoped by its instance
    (`arbol[1].raiz`, `ramas.izq`). An empty fence of a frame with a
    `style` (a box whose words all went to frames of their own) reads where
    the fence lies, as the engine reads it (postext#1116: its box and
    tab are drawn there); the frames its chain continues into hold nothing
    and are left out. An empty fence of a frame with no style draws
    nothing, so it is left out too. None when the template is unknown."""
    tid = fence.get("template") or ""
    frames = resolve_frames(templates, tid)
    if frames is None:
        return None
    order: list[str] = []
    page = _Level(frames, template_groups(templates, tid), "", None, order)
    has_modules = any(g.get("modules") is True for g in template_groups(templates, tid))
    instances = iter(module_instances(fence["items"]))
    empty: set[str] = set()

    def read_empty(level: _Level, it: dict, n: int) -> None:
        # what an empty fence added past its styled head holds nothing
        added = order[n:]
        slot = it.get("slot")
        styled = slot in level.names and bool(level.by_name[slot].get("style"))
        empty.update(added[1:] if styled else added)

    for it in fence["items"]:
        if it.get("kind") != "module":
            n = len(order)
            page.piece(it)
            if it.get("empty"):
                read_empty(page, it, n)
            continue
        inst = next(instances)
        mt = it.get("template") or ""
        mframes = resolve_frames(templates, mt) if has_modules and is_module(templates, mt) else None
        if mframes is None:  # moduleUnknown: its content goes to the page's flow frame
            for _ in it.get("items") or []:
                page.to_flow()
            continue
        mod = _Level(mframes, template_groups(templates, mt), inst + ".", page.flow, order)
        for sub in it.get("items") or []:
            n = len(order)
            mod.piece(sub)
            if sub.get("empty"):
                read_empty(mod, sub, n)
    return [x for x in order if x not in empty]


# --- the HTML side: the order the viewer writes the frames in ---------------

class _FrameOrder(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.pages: list[dict] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "div":
            return
        a = {k: v or "" for k, v in attrs}
        classes = a.get("class", "").split()
        if "pt-page" in classes:
            self.pages.append({"page": int(a["data-page"]) if a.get("data-page", "").isdigit() else len(self.pages),
                               "frames": []})
        elif "pt-frame" in classes and a.get("data-frame-id") and self.pages:
            self.pages[-1]["frames"].append({"id": a["data-frame-id"], "facing": a.get("data-facing") == "true"})


def html_frame_order(text: str) -> list[dict]:
    """Per page of a `postext html` file: `page` (0-based) and `frames`, the
    frame ids in the order the markup writes them (reading order)."""
    p = _FrameOrder()
    p.feed(text)
    p.close()
    return p.pages


_FRAME_ID = re.compile(r"^cp(\d+):(.+?)(?:~(\d+))?$")


def split_frame_id(fid: str) -> tuple[int, str, int] | None:
    m = _FRAME_ID.match(fid)
    return (int(m.group(1)), m.group(2), int(m.group(3) or 0)) if m else None


def is_subsequence(seq: list[str], of: list[str]) -> bool:
    it = iter(of)
    return all(any(x == y for y in it) for x in seq)


def compare_order(pages: list[dict], fences: list[dict]) -> list[dict]:
    """Problems between the HTML's frame order and the Markdown's. `fences`
    lists every page fence of the edition in book order, each with `chapter`,
    `fence` (its ordinal in the chapter), `line`, `spread` and `order`. A
    fence owns its page, the recto of a spread and the pages its content
    continues on (frame ids `cp<n>:<name>~<k>`); the frames of each page must
    come in the order of its fence."""
    problems: list[dict] = []
    f = -1
    used = 0
    for page in pages:
        own = [(split_frame_id(x["id"]), x["id"]) for x in page["frames"] if not x["facing"]]
        own = [(s, fid) for s, fid in own if s]
        if not own:
            continue
        n = own[0][0][0]
        cont = any(s[2] > 0 for s, _ in own)
        stay = 0 <= f < len(fences) and fences[f]["fence"] == n and (cont or (fences[f]["spread"] and used < 2))
        if not stay:
            nxt = next((j for j in range(f + 1, len(fences)) if fences[j]["fence"] == n), None)
            if nxt is None:
                problems.append({"kind": "unmatched", "page": page["page"] + 1, "frames": [fid for _, fid in own]})
                continue
            f, used = nxt, 0
        used += 1
        exp = fences[f]["order"]
        if exp is None:
            continue
        got = [s[1] for s, _ in own if s[0] == n]
        known = [x for x in got if x in exp]
        if not is_subsequence(known, exp):
            problems.append({"kind": "order", "page": page["page"] + 1, "chapter": fences[f]["chapter"],
                             "line": fences[f]["line"], "html": got, "markdown": exp})
    return problems


# --- running the command line tool ------------------------------------------

FAIL_KINDS = {
    "frameOverflow", "frameContinuationLimit", "continueTargetMissing", "contentInConfig", "tocGroupSplit",
    "templateUnknown", "slotUnknown", "pageFenceLength", "spreadMismatch", "unclosedContainer",
    "templateDuplicate", "templateExtendsCycle", "templateExtendsUnknown", "frameDuplicate",
    "frameStyleUnknown", "frameAnchorUnknown", "frameMinMax", "groupFrameUnknown", "groupFrameTwice",
    "frameChainLoop", "overflowTargetUnknown", "labelStyleUnknown", "labelAnchorUnknown",
    "labelOverflow", "calloutStyleExtendsUnknown", "calloutStyleExtendsCycle", "figureWordsShared",
    "headingClaimsColumn",
    # postext 1.48: a grid given more items than its `repeat.max`, and modules the page cannot lay
    "repeatOverflow", "moduleUnknown", "moduleAsPage", "moduleNested", "moduleNameRejected",
}
# postext 1.48: a frame under another frame, or past the trim, the bleed or the frame it is anchored
# inside. Both fail unless the project records the pair as meant (composed-check.json, below); a frame
# set `overlap: "allow"` is silenced by the engine itself and listed as a note.
OVERLAP_KINDS = {"frameCovered", "frameOutsideArea"}
EXCEPTIONS_FILE = "composed-check.json"
_OVERLAP_HINT = {
    "frameCovered": "take a fix the message lists (a lower layer, exclude: 'push', a move), or, when the "
                    "source prints the frames over each other, set overlap: 'allow' on the covering frame "
                    f"or record the pair in {EXCEPTIONS_FILE} with the reason",
    "frameOutsideArea": "take a fix the message lists (maxHeight, continueNextPage, the host's minHeight, a "
                        "move), or, when the source hangs the frame off its box on purpose, set overlap: "
                        f"'allow' on it or record it in {EXCEPTIONS_FILE} with the reason",
}
# labelOverlap between two labels is a note: whether two labels that meet are wrong is the reader's
# call. A label that runs onto one of the picture's `avoid` zones (a symbol; 1.42, data.withSymbol) is a
# finding: the symbol is a point the source keeps clear.
NOTE_KINDS = {"slotEmpty", "anchorUnlabelled", "labelOverlap"}


def _with_symbol(w: dict) -> bool:
    """A labelOverlap (1.42) whose label meets a symbol of the picture."""
    data = w.get("data") or {}
    return bool(data.get("withSymbol")) or str(data.get("with", "")).startswith("symbol")


def _name_pattern(pattern: str) -> re.Pattern:
    """A frame name of an exception: `[*]` stands for any instance number
    (`grid-picture[*]`), `*` for any run of characters; the rest is literal."""
    out = []
    i = 0
    while i < len(pattern):
        if pattern.startswith("[*]", i):
            out.append(r"\[\d+\]")
            i += 3
        elif pattern[i] == "*":
            out.append(".*?")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("".join(out) + r"\Z")


_EXCEPTION_KEYS = {"kind", "template", "frame", "coveredBy", "past", "target", "locale", "page", "reason"}


def load_exceptions(path: Path | None) -> tuple[list[dict], list[str]]:
    """(entries, problems) of a project's recorded overlap exceptions:
    `{"overlaps": [{"frame": "pill", "coveredBy": "photo", "reason": "…"}]}`.
    Each entry needs `frame` and a `reason`; `kind` (frameCovered /
    frameOutsideArea, else both), `template`, `coveredBy`, `past`, `target`,
    `locale` and `page` narrow it."""
    if path is None or not path.is_file():
        return [], []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return [], [f"{path}: not JSON ({e})"]
    raw = data.get("overlaps") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return [], [f"{path}: needs an \"overlaps\" list"]
    entries, problems = [], []
    for n, e in enumerate(raw):
        where = f"{path.name} overlaps[{n}]"
        if not isinstance(e, dict):
            problems.append(f"{where}: not an object")
            continue
        extra = sorted(set(e) - _EXCEPTION_KEYS)
        if extra:
            problems.append(f"{where}: unknown key(s) {extra}")
        if not isinstance(e.get("frame"), str) or not e["frame"]:
            problems.append(f"{where}: needs the frame it excuses (\"frame\")")
            continue
        if not isinstance(e.get("reason"), str) or not e["reason"].strip():
            problems.append(f"{where}: needs a \"reason\" (why the source prints it so)")
            continue
        if e.get("kind") is not None and e["kind"] not in OVERLAP_KINDS:
            problems.append(f"{where}: kind {e['kind']!r} is neither frameCovered nor frameOutsideArea")
            continue
        entries.append({**e, "_index": n})
    return entries, problems


def exception_for(w: dict, locale: str | None, entries: list[dict]) -> dict | None:
    """The first recorded exception that matches an overlap warning."""
    data = w.get("data") or {}
    for e in entries:
        if e.get("kind") and e["kind"] != w.get("kind"):
            continue
        if not _name_pattern(e["frame"]).match(str(data.get("frame", ""))):
            continue
        if e.get("coveredBy") is not None and not _name_pattern(e["coveredBy"]).match(str(data.get("coveredBy", ""))):
            continue
        if e.get("target") is not None and not _name_pattern(e["target"]).match(str(data.get("target", ""))):
            continue
        if any(e.get(k) is not None and str(e[k]) != str(v) for k, v in
               (("template", data.get("template")), ("past", data.get("past")),
                ("locale", data.get("locale") or locale), ("page", w.get("page")))):
            continue
        return e
    return None


def exceptions_path(target: str) -> Path:
    """Where a project keeps its overlap exceptions: composed-check.json in
    the project folder, beside its preset.json or beside the bundle."""
    p = Path(target)
    return (p if p.is_dir() else p.parent) / EXCEPTIONS_FILE


def allowed_frames(templates: list[dict]) -> list[str]:
    """`template/frame` of every frame set `overlap: "allow"` (postext 1.48):
    the engine reports neither check for it, so the close report names them."""
    out = []
    for t in templates or []:
        if not isinstance(t, dict):
            continue
        for f in t.get("frames") or []:
            if isinstance(f, dict) and f.get("overlap") == "allow":
                out.append(f"{t.get('id')}/{f.get('name')}")
    return out


def judge(report: dict, stressed: bool = False, base: dict | None = None,
          exceptions: list[dict] | None = None, locale: str | None = None) -> dict:
    """Failures, warnings and notes of one `postext check --json` report.
    In a stressed run (`base` = the report of the text as written) a
    frameOverflow whose proposals carry a value is a warning, and any other
    warning the longer text raises fails: a composed-page kind always, any
    other kind when the text as written did not raise it. frameCovered and
    frameOutsideArea fail unless an entry of `exceptions` records the pair
    (then they are listed under `allowed` with its reason); `overlaps`
    counts the ones that fail."""
    had = {w.get("kind") for w in (base or {}).get("warnings") or []}
    fails, warns, notes, allowed = [], [], [], []
    used: set[int] = set()
    for w in report.get("warnings") or []:
        kind = w.get("kind", "")
        entry = {"kind": kind, "message": w.get("message", ""), "at": w.get("at"), "page": w.get("page")}
        if kind in OVERLAP_KINDS:
            ex = exception_for(w, locale, exceptions or [])
            if ex is not None:
                used.add(ex["_index"])
                allowed.append({**entry, "reason": ex["reason"]})
            else:
                fails.append({**entry, "overlap": True, "hint": _OVERLAP_HINT[kind]})
            continue
        if kind == "labelOverlap" and _with_symbol(w):
            fails.append(entry)
        elif kind in NOTE_KINDS or w.get("severity") == "info":
            notes.append(entry)
        elif kind == "frameOverflow" and stressed:
            props = ((w.get("data") or {}).get("proposals") or [])
            (warns if any(isinstance(p, dict) and "value" in p for p in props) else fails).append(entry)
        elif kind in FAIL_KINDS or w.get("severity") == "error":
            fails.append(entry)
        elif stressed and kind not in had:
            fails.append(entry)
    scaled = []
    for r in report.get("reflow") or []:
        kinds = {e.get("kind") for e in r.get("events") or []}
        if kinds & {"textScaled", "imageScaled"}:
            scaled.append({"page": r.get("pageLabel"), "template": r.get("template"), "lines": r.get("lines")})
    return {"fail": fails, "warn": warns, "notes": notes, "scaled": scaled, "allowed": allowed,
            "overlaps": sum(1 for f in fails if f.get("overlap")), "exceptionsUsed": sorted(used),
            "reflow": [{"page": r.get("pageLabel"), "template": r.get("template"), "lines": r.get("lines")}
                       for r in report.get("reflow") or []]}


def run_cli(cmd: list[str], *args: str) -> subprocess.CompletedProcess:
    # stdout goes to a file: the command line tool run under Bun can exit
    # before a pipe has taken more than 64 KiB, cutting a long JSON report
    try:
        with tempfile.TemporaryFile("w+", encoding="utf-8") as out:
            r = subprocess.run([*cmd, *args], stdout=out, stderr=subprocess.PIPE, text=True, timeout=1800)
            out.seek(0)
            return subprocess.CompletedProcess(r.args, r.returncode, out.read(), r.stderr)
    except OSError as e:
        raise SystemExit(f"cannot run {' '.join(cmd)}: {e}") from e


def cli_report(cmd: list[str], target: str, locale: str | None, extra: list[str]) -> dict:
    r = run_cli(cmd, "check", target, *(["--locale", locale] if locale else []), "--json", *extra)
    try:
        return json.loads(r.stdout)
    except ValueError:
        raise SystemExit(f"postext check gave no JSON ({target}, {locale}): {r.stderr.strip()[-400:]}")


def cli_html(cmd: list[str], target: str, locale: str | None, out_dir: Path, extra: list[str]) -> str | None:
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "index.html"
    run_cli(cmd, "html", target, *(["--locale", locale] if locale else []), "-o", str(out), *extra)
    return out.read_text(encoding="utf-8", errors="replace") if out.is_file() else None


def chapter_files(data: dict, locale: str | None) -> list[str]:
    ch = data.get("chapters")
    lst = ch.get(locale) if isinstance(ch, dict) else ch
    if isinstance(ch, dict) and not lst:
        lst = ch.get(data.get("locale")) or next(iter(ch.values()), [])
    return [c["file"] for c in lst or [] if isinstance(c, dict) and isinstance(c.get("file"), str)]


def edition_fences(data: dict, read: Any, locale: str | None, templates: list[dict]) -> list[dict]:
    out = []
    for ci, rel in enumerate(chapter_files(data, locale)):
        md = read(rel) or ""
        for n, fence in enumerate(page_fences(md)):
            out.append({"chapter": rel, "chapterIndex": ci, "fence": n, "line": fence["line"],
                        "template": fence["template"], "order": expected_order(fence, templates),
                        "spread": template_spread(templates, fence["template"] or "")
                        if any(isinstance(t, dict) and t.get("id") == fence["template"] for t in templates)
                        else fence["spread"]})
    return out


def cross_locale(orders: dict[str, list[dict]]) -> list[dict]:
    """Page fences whose frames two editions read in different orders
    (compared by chapter position and fence ordinal)."""
    langs = list(orders)
    if len(langs) < 2:
        return []
    base = {(f["chapterIndex"], f["fence"]): f for f in orders[langs[0]]}
    out = []
    for lang in langs[1:]:
        for f in orders[lang]:
            b = base.get((f["chapterIndex"], f["fence"]))
            if b and b["order"] is not None and f["order"] is not None and b["order"] != f["order"]:
                out.append({"chapter": f["chapter"], "line": f["line"], "fence": f["fence"],
                            langs[0]: b["order"], lang: f["order"]})
    return out


# --- stress: the text 30 % longer, as the Cookbook bench makes it -------------

_PROTECTED = re.compile("|".join([
    r"\\.", r"`[^`]*`", r"\$[^$\n]+\$", r"<[^>\n]+>", r"https?://\S+",
    r"!?\[[^\]\n]*\]\([^)\n]*\)", r":[a-z][a-z0-9-]*(?:\[[^\]\n]*\])?(?:\{[^}\n]*\})?",
    r"\[[^\]\n]*\]", r"\{[^}\n]*\}",
]))
_FENCE_LINE = re.compile(r"^\s*:{2,}")
_CODE_FENCE = re.compile(r"^\s*(```|~~~)")
_RAW_FENCE = re.compile(r"^\s*:::\s*(page|strip)\b(?!\s*\{[^}]*\btemplate=)")
_CLOSE_FENCE = re.compile(r"^\s*:{3,}\s*$")
_RULE = re.compile(r"^\s*([-*_])(\s*\1){2,}\s*$")
_PREFIX = re.compile(r"^(\s*(?:>\s*)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|\[\^[^\]]+\]:\s*)?)")
_BLOCK_START = re.compile(r"^\s*(?:>\s*)*(?:#{1,6}\s|(?:[-*+]|\d+[.)])\s|\[\^[^\]]+\]:)")
_CJK_PUNCT = re.compile(r"([、。，．！？；：「」『』（）《》〈〉【】…・])")
MAX_COPIES = 4


def _letter(ch: str) -> bool:
    return unicodedata.category(ch)[0] in "LNM"


def _unspaced(text: str) -> bool:
    return any(0x3040 <= ord(c) <= 0x30FF or 0x3400 <= ord(c) <= 0x4DBF or 0x4E00 <= ord(c) <= 0x9FFF
               or 0xF900 <= ord(c) <= 0xFAFF or 0x20000 <= ord(c) <= 0x2FA1F or 0x0E00 <= ord(c) <= 0x0E7F
               for c in text)


def _core(token: str) -> tuple[int, str] | None:
    a, b = 0, len(token)
    while a < b and not _letter(token[a]):
        a += 1
    while b > a and not _letter(token[b - 1]):
        b -= 1
    core = token[a:b]
    if core and all(_letter(c) or c in "'’-" for c in core):
        return a, core
    return None


def _words(text: str) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    free: list[tuple[int, int]] = []
    last = 0
    for m in _PROTECTED.finditer(text):
        if m.start() > last:
            free.append((last, m.start()))
        last = m.end()
    if last < len(text):
        free.append((last, len(text)))
    for a, b in free:
        for m in re.finditer(r"\S+", text[a:b]):
            base = a + m.start()
            parts = _CJK_PUNCT.split(m.group(0)) if _unspaced(m.group(0)) else [m.group(0)]
            off = 0
            for part in parts:
                w = _core(part)
                if w and len(w[1]) >= 2:
                    out.append((base + off + w[0], w[1]))
                off += len(part)
    return out


def _spread(n: int) -> list[int]:
    phi = (5 ** 0.5 - 1) / 2
    return sorted(range(n), key=lambda a: ((a * phi) % 1, a))


def stretch_markdown(markdown: str, factor: float) -> tuple[str, int, int]:
    """(markdown, characters before, after): every paragraph, heading and
    list item about `factor` times as long, its own plain words repeated
    next to themselves (`familia familia`), spread along it; never inside
    fences, attributes, inline directives, links, references, code, maths
    or a comic's raw body. The Cookbook bench's stretchMarkdown."""
    if not factor > 1:
        return markdown, 0, 0
    lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    prefixes = [""] * len(lines)
    paragraphs: list[list[int]] = []
    current: list[int] | None = None
    in_code = False
    raw = 0
    in_front = bool(lines) and lines[0].strip() == "---"
    for i, line in enumerate(lines):
        if in_front:
            if i > 0 and re.match(r"^(---|\.\.\.)\s*$", line):
                in_front = False
            current = None
            continue
        if _CODE_FENCE.match(line):
            in_code = not in_code
            current = None
            continue
        if in_code:
            continue
        if raw > 0:
            if _CLOSE_FENCE.match(line):
                raw -= 1
            elif _RAW_FENCE.match(line):
                raw += 1
            current = None
            continue
        if _RAW_FENCE.match(line):
            raw = 1
            current = None
            continue
        if (not line.strip() or _FENCE_LINE.match(line) or re.match(r"^\s*\|", line)
                or re.match(r"^\s*<", line) or _RULE.match(line)):
            current = None
            continue
        prefixes[i] = _PREFIX.match(line).group(1)
        heading = re.match(r"^\s*(?:>\s*)*#{1,6}\s", line)
        if current is None or _BLOCK_START.match(line):
            current = []
            paragraphs.append(current)
        current.append(i)
        if heading:
            current = None
    before = after = 0
    out = list(lines)
    for para in paragraphs:
        words = [(ln, len(prefixes[ln]) + at, core) for ln in para
                 for at, core in _words(lines[ln][len(prefixes[ln]):])]
        length = sum(len(lines[ln]) - len(prefixes[ln]) for ln in para)
        before += length
        need = (factor - 1) * length
        copies = [0] * len(words)
        added = 0
        order = _spread(len(words))
        for _ in range(MAX_COPIES):
            if added >= need or not words:
                break
            for k in order:
                if added >= need:
                    break
                copies[k] += 1
                added += len(words[k][2]) + (0 if _unspaced(words[k][2]) else 1)
        after += length + added
        for ln in para:
            text = lines[ln]
            mine = [(w, copies[k]) for k, w in enumerate(words) if w[0] == ln and copies[k] > 0]
            for (_, at, core), n in reversed(mine):
                join = "" if _unspaced(core) else " "
                cut = at + len(core)
                text = text[:cut] + (join + core) * n + text[cut:]
            out[ln] = text
    return "\n".join(out), before, after


def stretched_copy(target: str, data: dict, read: Any, factor: float, into: Path) -> tuple[Path, int, int]:
    """A copy of the project (files linked, chapters stretched) in `into`."""
    files = {rel for lang in (list(data["chapters"]) if isinstance(data.get("chapters"), dict) else [None])
             for rel in chapter_files(data, lang)}
    src = Path(target)
    before = after = 0
    if zipfile.is_zipfile(src if src.is_file() else src / "preset.json"):
        with zipfile.ZipFile(src) as z:
            z.extractall(into)
        root = next((p.parent for p in into.rglob("preset.json")), into)
    else:
        base = src if src.is_dir() else src.parent
        root = into
        for dirpath, _, names in os.walk(base):
            rel_dir = Path(dirpath).relative_to(base)
            if rel_dir.parts and rel_dir.parts[0] in ("source", ".git", "node_modules"):
                continue
            (into / rel_dir).mkdir(parents=True, exist_ok=True)
            for name in names:
                rel = (rel_dir / name).as_posix()
                if rel in files:
                    continue
                if name.endswith((".json", ".md")):  # read where they are: copied, not linked
                    shutil.copyfile(Path(dirpath, name), into / rel)
                else:
                    os.symlink(Path(dirpath, name).resolve(), into / rel)
    for rel in files:
        md = read(rel)
        if md is None:
            continue
        text, b, a = stretch_markdown(md, factor)
        before += b
        after += a
        dest = root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.is_symlink() or dest.exists():
            dest.unlink()
        dest.write_text(text, encoding="utf-8")
    return root, before, after


# --- check -------------------------------------------------------------------

def edition_locales(data: dict, wanted: list[str] | None) -> list[str | None]:
    eds = [e["locale"] for e in kit.editions(data)]
    if wanted:
        return list(wanted)
    return eds or [None]


def cmd_check(args) -> int:
    cmd = postext_cmd(args.postext)
    data, where, read = kit.read_target(args.target)
    if not isinstance(data.get("config"), dict):
        raise SystemExit(f"{where}: not a book manifest")
    v, _ = detect_version(cmd)
    if v is not None and v < ROUND2:
        print(f"postext {vstr(v)}: composed pages need 1.35.0 (round 2). Run `composed_check.py round`.",
              file=sys.stderr)
    extra = ["--offline"] if args.offline else []
    editions = {e["locale"]: e for e in kit.editions(data, read)}
    work = Path(args.keep) if args.keep else Path(tempfile.mkdtemp(prefix="composed-check-"))
    result: dict[str, Any] = {"target": where, "version": vstr(v) if v else None, "editions": {}}
    ex_path = Path(args.exceptions) if args.exceptions else exceptions_path(args.target)
    exceptions, ex_problems = load_exceptions(ex_path)
    if args.exceptions and not ex_path.is_file():
        ex_problems.append(f"{ex_path}: no such file")
    result["exceptions"] = {"file": str(ex_path) if ex_path and ex_path.is_file() else None,
                            "entries": len(exceptions), "problems": ex_problems, "unused": []}
    used: set[int] = set()
    failed = bool(ex_problems)
    orders: dict[str, list[dict]] = {}
    try:
        for loc in edition_locales(data, args.locale):
            key = loc or "-"
            ed = editions.get(loc) or next(iter(editions.values()))
            templates = ed["config"].get("pageTemplates") or []
            fences = edition_fences(data, read, loc, templates)
            orders[key] = fences
            report = cli_report(cmd, args.target, loc, extra)
            verdict = judge(report, exceptions=exceptions, locale=loc)
            used.update(verdict["exceptionsUsed"])
            entry: dict[str, Any] = {**verdict, "fences": len(fences), "order": [],
                                     "allowedFrames": allowed_frames(templates)}
            if fences and not args.no_html:
                page_html = cli_html(cmd, args.target, loc, work / f"html-{key}", extra)
                if page_html is None:
                    entry["order"] = [{"kind": "noHtml"}]
                else:
                    entry["order"] = compare_order(html_frame_order(page_html), fences)
            if args.stress:
                sdir = work / f"stress-{key}"
                if sdir.exists():
                    shutil.rmtree(sdir)
                sdir.mkdir(parents=True)
                root, b, a = stretched_copy(args.target, data, read, args.stress, sdir)
                sreport = cli_report(cmd, str(root), loc, extra)
                entry["stress"] = {"factor": args.stress, "before": b, "after": a, **judge(sreport, stressed=True, base=report,
                                                                                          exceptions=exceptions, locale=loc)}
                used.update(entry["stress"]["exceptionsUsed"])
            if verdict["fail"] or any(o["kind"] == "order" for o in entry["order"]) \
                    or (args.stress and entry["stress"]["fail"]):
                failed = True
            result["editions"][key] = entry
        result["crossLocale"] = cross_locale(orders)
        result["exceptions"]["unused"] = [{k: v for k, v in e.items() if k != "_index"}
                                          for e in exceptions if e["_index"] not in used]
        result["overlaps"] = sum(e["overlaps"] for e in result["editions"].values())
    finally:
        if not args.keep:
            shutil.rmtree(work, ignore_errors=True)
    result["passed"] = not failed
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print_check(result)
    return 1 if failed else 0


def print_check(res: dict) -> None:
    print(f"{res['target']} (postext {res['version'] or '?'})")
    ex = res.get("exceptions") or {}
    if ex.get("file"):
        print(f"  overlap exceptions: {ex['entries']} in {ex['file']}")
    for p in ex.get("problems") or []:
        print(f"  FAIL {p}")
    for loc, e in res["editions"].items():
        bad_order = [o for o in e["order"] if o["kind"] == "order"]
        print(f"  [{loc}] {e['fences']} page fence(s): {len(e['fail'])} failing warning(s), "
              f"{e.get('overlaps', 0)} overlap(s), {len(bad_order)} page(s) out of reading order")
        for w in e["fail"]:
            print(f"    FAIL {w['kind']} ({w.get('at') or '?'}, page {w.get('page') or '?'}): {w['message']}")
            if w.get("hint"):
                print(f"         {w['hint']}")
        for w in e.get("allowed") or []:
            print(f"    allowed {w['kind']} (page {w.get('page') or '?'}): {w['message'][:120]} [{w['reason']}]")
        if e.get("allowedFrames"):
            print(f"    note overlap: 'allow' (not checked by the engine): {', '.join(e['allowedFrames'])}")
        for o in bad_order:
            print(f"    FAIL reading order p. {o['page']} ({o['chapter']}:{o['line']}): HTML {' > '.join(o['html'])}; "
                  f"Markdown {' > '.join(o['markdown'])}")
        for o in e["order"]:
            if o["kind"] == "unmatched":
                print(f"    NOTE p. {o['page']}: frames {', '.join(o['frames'])} match no page fence of the Markdown")
            elif o["kind"] == "noHtml":
                print("    NOTE postext html wrote nothing: reading order not checked")
        for s in e["scaled"]:
            print(f"    NOTE p. {s['page']} ({s['template']}): {'; '.join(s['lines'] or [])}")
        for n in e["notes"]:
            print(f"    note {n['kind']} (page {n.get('page') or '?'}): {n['message'][:160]}")
        st = e.get("stress")
        if st:
            grow = (st["after"] / st["before"] - 1) * 100 if st["before"] else 0
            print(f"    stress ×{st['factor']}: text {grow:.1f} % longer ({st['before']} → {st['after']} characters)")
            for r in st["reflow"]:
                print(f"      p. {r['page']} ({r['template']}): {'; '.join(r['lines'] or [])}")
            for w in st["warn"]:
                print(f"      WARN {w['kind']} (page {w.get('page') or '?'}): {w['message']}")
            for w in st["fail"]:
                print(f"      FAIL {w['kind']} (page {w.get('page') or '?'}): {w['message']}")
    for u in ex.get("unused") or []:
        print(f"  note exception never met (remove it?): {json.dumps(u, ensure_ascii=False)}")
    if "overlaps" in res:
        print(f"  overlaps: {res['overlaps']}")
    for c in res.get("crossLocale") or []:
        langs = [k for k in c if k not in ("chapter", "line", "fence")]
        print(f"  WARN editions read page fence {c['fence']} of {c['chapter']} differently: "
              + "; ".join(f"{l} {' > '.join(c[l])}" for l in langs))
    print("passed" if res["passed"] else "failed")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("round", help="the porting round the installed Postext supports")
    p.add_argument("--version", help="judge this version instead of the installed one")
    p.add_argument("--postext", help="the postext command (default: postext)")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("check", help="round-2 checks of a book, every edition")
    p.add_argument("target", help="project folder, preset.json or .postext bundle")
    p.add_argument("--locale", action="append", help="check this edition only; repeat")
    p.add_argument("--stress", type=float, metavar="FACTOR", help="also lay the text out FACTOR times longer (1.3)")
    p.add_argument("--postext", help="the postext command (default: postext)")
    p.add_argument("--offline", action="store_true", help="pass --offline to postext (no font downloads)")
    p.add_argument("--no-html", action="store_true", help="skip the reading-order check")
    p.add_argument("--keep", metavar="DIR", help="keep the HTML and stretched copies in DIR")
    p.add_argument("--exceptions", metavar="FILE",
                   help=f"overlaps recorded as meant (default: {EXCEPTIONS_FILE} next to preset.json or the bundle)")
    p.add_argument("--json", action="store_true")
    args = ap.parse_args()
    sys.exit(cmd_round(args) if args.cmd == "round" else cmd_check(args))


if __name__ == "__main__":
    main()
