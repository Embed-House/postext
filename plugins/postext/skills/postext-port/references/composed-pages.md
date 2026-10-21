# Composed pages: porting fixed pages with page templates (round 2)

A **composed page** is a page whose form is a **page template** in the
configuration (named frames, groups, decoration) and whose content is the
Markdown between a `::::page{template="…"}` fence, poured into the frames by
**slot** name. Geometry never appears in the Markdown and the book's text
never appears in the configuration, so a translation is the same template
with other words, and a longer text makes its box grow, its picture smaller
or its page go on.

This file is round 2 of the fixed-page method: textbooks, workbooks,
infographic pages, magazines. Round 1 (fixed callouts, page grounds in an
opener design, live-text SVG labels: playbooks.md J) stays the method for
an engine that cannot lay composed pages out. The Postext docs pages
[Composed pages](https://postext.dev/en/docs/composed-pages) and
[Configuration › Composed pages](https://postext.dev/en/docs/configuration-composed-pages)
have every key; configuration.md §19g and document-format.md §12.2 sum them up.

For someone new to composed pages, and for the report that goes with a
port, point to two docs pages instead of repeating them:
[Composed-page books](https://postext.dev/en/docs/composed-page-books) (a
walk through the Sandbox: build a page template, fill it from the Markdown,
label a map, translate the page, review what does not fit) and [Moving a book
to composed pages](https://postext.dev/en/docs/migrating-to-composed-pages)
(a book that keeps its text in heading styles: the Sandbox's *Move the text
to the Markdown*, or by hand, and what to check after). Both are in the ten
site languages, and every page has a `.md` rendition under the same path with
`.md` appended.

Contents: 1 choosing the round · 2 the model · 3 the phases in round 2 ·
4 the component library · 5 templates · 6 recipes (a box with a tab, a
category tree, a double-page timeline, a labelled map, photos with captions,
text round an illustration, a box that continues, a magazine thread with
jumps, an activity sheet with answer lines, a photo and its ground, a
contents page) ·
7 verification · 8 one bundle for every edition · 9 ports made with round 1
or postext 1.33 · 10 limits.

## 1. Choose the round by the installed version

```bash
python3 scripts/composed_check.py round            # postext --version, else ~/.cache/postext-tools
python3 scripts/composed_check.py round --version 1.35.0   # the engine the book must open in
```

<table>
<tr><th>Postext</th><th>What composed pages can do</th><th>Round</th></tr>
<tr><td>≤ 1.33</td><td>nothing: <code>pageTemplates</code> and <code>::::page</code> are unknown</td><td>1</td></tr>
<tr><td>1.34.0</td><td>templates, label styles and the composed-page Markdown are read and checked, not laid out; <code>contentInConfig</code> in <code>postext check</code>; <code>toc.groups</code></td><td>1</td></tr>
<tr><td>1.34.1</td><td>composed pages laid out: frames placed (grid, anchors to the area or to <code>#frame</code>), filled from their slots, dressed by callout styles; decoration with <code>{attr.x}</code>; <code>next</code> chains; <code>exclude: "push"</code>; layers and <code>rotate</code>. Also <code>:mark</code>, <code>{leader}</code>, <code>localized.&lt;lang&gt;.name</code></td><td>1 (frames do not move with their text yet)</td></tr>
<tr><td>1.35.0</td><td>stack and row groups (a box that grows pushes the ones after it), <code>pin</code>, the reflow log; spread templates; HTML, EPUB and tagged PDF read composed pages in Markdown order; Sandbox Content and Design modes</td><td><b>2</b></td></tr>
<tr><td>1.36.0</td><td>the reflow ladder (<code>fit</code>: pictures then text set smaller) and <code>frameOverflow</code> with proposals; the source map (<code>sourceAt</code>, stable ids); contour wrap (<code>wrap: "contour"</code>); the Sandbox template editor</td><td>2</td></tr>
<tr><td>1.37.0</td><td>continuation on added pages (<code>overflow.continueIn: "next-page" | "template:&lt;id&gt;"</code>, <code>overflowTemplate</code>, <code>frameContinuationLimit</code>); <code>::label</code> words drawn at a picture's anchors (<code>labelAnchorUnknown</code>, <code>anchorUnlabelled</code>); <code>moveTextToMarkdown</code>; headings keep their design in frames and boxes; <code>paragraphStyles[].letterSpacing</code>; the contrast check reads frame text on its box or the decoration under it; <code>pictureBelowPrintSize</code>; Sandbox: frame-style library, one undo history, a click on the page selects the Markdown or the setting behind it (<code>sandbox_inspect_point</code> answers with <code>elements</code>)</td><td>2</td></tr>
<tr><td>1.38.0</td><td>a frame that can go on to another page does so before it shrinks (<code>fit.preferContinue</code>); a threaded story goes on in the frame its chain starts in; cuts keep a heading with its text and two list items on each side; the answer space under a box goes on with it; <code>continueIn: "page:&lt;id&gt;"</code> jumps to a later page, <code>{page}</code> in <code>overflow.mark</code>, <code>overflow.fromMark</code>, <code>continueTargetMissing</code>; stacks keep their empty frames, rows of <code>auto</code> cards share width without a box; ruled frames (<code>rules</code>); <code>{ to, edge }</code> sizes and <code>fit: "cover"</code> + <code>focus</code> for design images; drop caps in frames; spreads on vertical books; comic <code>::panel{text}</code> and <code>box</code>; <code>moveTextToMarkdown</code> with <code>labelsOnPictures</code>; resource types written in part take the defaults; Sandbox: Canvas &rsaquo; Reflow, anchors placed by a click, <code>sandbox_apply_proposal</code></td><td>2</td></tr>
<tr><td>1.39.0</td><td>checks that read the labels of every edition (<code>labelOverlap</code>, <code>labelOverflow</code>) and vertical labels (<code>writingMode</code> on an anchor or a label style); a figure's own <code>alt</code>, <code>caption</code> and <code>note</code> in the Markdown, per edition; callout styles based on another (<code>extends</code>); a frame's own <code>writingMode</code> and <code>direction</code>; <code>start</code>/<code>end</code> placement edges; widow and orphan rules in <code>:::columns</code> groups and frame columns; drop caps that follow the flow's rules across frame cuts, and the initial a <code>takes</code> title frame gives; comic text panels on vertical and right-to-left pages (<code>shrink</code>); <code>fit: "cover"</code> on upright pictures; <code>sourceAt</code> on mirrored and vertical composed pages (<code>flow</code>); the Sandbox keeps every edition of an imported bundle, lists <code>page:&lt;id&gt;</code> jump targets and edits <code>{ to, edge }</code> sizes, cover focus and dense anchors</td><td>2</td></tr>
<tr><td>1.40.0</td><td>a label style can switch off the italics and capitals of the paragraph style it borrows (<code>fontStyle: "normal"</code>, <code>textTransform: "none"</code>); vertical labels on right-to-left pages; the reflowable EPUB draws plain figure labels over the picture; <code>moveTextToMarkdown</code> puts a picture's frame under decoration the design painted over it; comic text panels on <code>:::strip</code> and <code>:::page{spread}</code> (<code>comicPanelFrame</code> no longer raises <code>strip</code> / <code>spread</code>) and <code>valign</code> that follows a slanted cell; a frame's own <code>writingMode</code> on right-to-left pages, pictures upright in a vertical frame, reflowable EPUB frames with their own <code>writing-mode</code>; <code>useTemplate</code> proposals tried as the build lays the page; Sandbox: <code>sandbox_get_composed_checks</code> (every edition), <em>Check every edition</em> on big books, zoom and pan in the anchors dialog, label anchors dragged in the HTML viewer, the template editor's spreads on right-to-left and vertical books, the Word import's character spacing</td><td>2</td></tr>
<tr><td>1.41.0</td><td>a story jumps into a page fence of a later chapter file (<code>continueIn: "page:&lt;id&gt;"</code>, one chapter file per article); Sandbox: the template editor's spread sheet on right-to-left and vertical books, box styles that extend another drawn with the look they inherit</td><td>2</td></tr>
<tr><td>1.42.0</td><td><code>calloutStyles[].body.letterSpacing</code>; <code>{ "id": …, "remove": true }</code> takes a decoration element of the base template out in a child or variant; a frame's own colours (<code>look</code>) and <code>palette</code> on a template or a page fence, so one box style serves every tint; <code>width: "auto"</code> on a frame is its longest line plus padding; <code>label.icon.placement: "inside"</code>; <code>{headingNumber}</code> in decoration text and a click on decoration text over a frame; <code>takes: "toc"</code> (or <code>:::toc</code> in a frame) lays the contents on a composed page; <code>overlap: "allow"</code> on anchors and label styles, the picture's <code>avoid</code> zones as map symbols (<code>labelOverlap</code> with <code>withSymbol</code>); <code>figureWordsShared</code>; labels of right-to-left books in the reflowable EPUB; <code>fonts[].fallback</code> (an open family for a licensed one the bundle leaves out); pictures upright in the frames of a vertical page's own flow; index marks, anchors and headings of a story that went on in a later chapter listed where that chapter sets them; layout memo (a page whose boxes overflow lays faster); Sandbox: renaming a frame renames the <code>slot</code> of the page fences that fill it (every chapter, the other editions of a local project), Design &rsaquo; Figures &amp; tables &rsaquo; Label styles, label dragging on the Folio's pages, each edition's title and pagination (<code>layouts.&lt;lang&gt;.json</code>) on export</td><td>2</td></tr>
<tr><td>1.43.0</td><td>labels of a figure across the spine slide off the gutter band (<code>gutter: "cross"</code> on an anchor keeps a name across both pages); renaming a label style in the Sandbox rewrites its users; the picture's <code>avoid</code> zones read from an SVG's own symbols; <code>label.icon.tint</code>; the faces of a licensed family's <code>fallback</code> are embedded in EPUB, HTML and SVG exports; <code>toc.parts.breakBefore</code> in a contents frame; <code>headingClaimsColumn</code>; Sandbox: Add a language, rename one language only, group order in the template editor</td><td>2</td></tr>
<tr><td>1.44.0–1.46.0</td><td>1.46.0: a frame set in <code>columns</code> (and a <code>:::columns</code> group) never ends a column on a heading: under <code>headings.keepWithNext</code> the heading goes on with its text. 1.44 and 1.45 change nothing in composed pages (1.45 box-style designs are configuration.md §12)</td><td>2</td></tr>
</table>

- **Which version counts.** The one the book will be opened in: the
  Sandbox at postext.dev runs the latest release; a user's program runs
  the `postext` npm version it pins. Update the command line before you
  start (`releases/latest`, SKILL.md "Setup"); an old executable on the
  PATH makes a port choose round 1 for no reason.
- **Round 2 with gaps.** On 1.35 to 1.37 the script lists what is missing
  and what to do instead: without the ladder, give each frame its room by
  hand (`maxHeight`, a chained frame, shorter text); without continuation,
  a taller frame, a chained frame on the same page, or a flow page (never
  the rest of the text typed into a second page fence); without labels, the
  round-1 live-text SVG (playbooks J4) for maps and diagrams only. The
  recipes in section 6 say what each gap costs in a sentence that starts
  with "Before 1.37", "Before 1.38", "Before 1.39" or "Before 1.40".
- **Say which.** The port's report names the round, the engine version and
  every feature it worked around.
- **The layout question.** Round 1 made the user choose between an
  identical layout and editable, translatable text (SKILL.md). Round 2 gives
  both: ask only when the brief wants the composed pages reflowed as
  running text on purpose.

## 2. The model

<table>
<tr><th>Where</th><th>What</th></tr>
<tr><td>config <code>pageTemplates[]</code></td><td>one template per kind of page: <code>frames</code> (named rectangles), <code>groups</code> (stacks and rows of frames that share space), <code>decoration</code> (pictures, rules, boxes, placeholder texts), <code>header</code>/<code>footer</code>, <code>variants</code> per side, <code>extends</code></td></tr>
<tr><td>config <code>calloutStyles[]</code></td><td>the dress of a frame (fill, border, radius, padding, tab, title, body type): a frame names one with <code>style</code></td></tr>
<tr><td>config <code>paragraphStyles</code>, <code>chipStyles</code>, <code>markStyles</code>, <code>labelStyles</code></td><td>the type inside frames and on pictures</td></tr>
<tr><td>resource <code>anchors[]</code>, <code>contour</code></td><td>points on a picture where labels stand (fractions, shared by every edition); the outline text runs round</td></tr>
<tr><td>Markdown <code>::::page{template=… attr=…}</code></td><td>one page (or spread) and its content in reading order</td></tr>
<tr><td>Markdown <code>:::frame{slot label title}</code>, <code>slot=</code> on a block</td><td>which frame a piece goes to; the words of its tab and title</td></tr>
<tr><td>Markdown <code>:::figure{resource slot}</code> + <code>::label[…]{at style}</code></td><td>a picture and the words set on it</td></tr>
</table>

How content is shared out: a `:::frame{slot}` sends its body (any Markdown:
paragraphs, lists, headings, chips, `::resource`, `:ref`, footnotes,
`:::columns`, nested callouts) to the frame of that name; `slot=` on one
heading, `::resource{id slot}`, code fence or container sends that block;
content with no slot goes to the frame marked `flow`; the first heading of
a level with no slot goes to the frame that `takes` it (`takes: "h1"`). The
frames are read in the order their content first appears in the Markdown
(frames a chain continues into right after it), and every output (HTML,
EPUB, tagged PDF, screen readers) reads them so. Write the Markdown in the
order a reader reads the source page.

## 3. The phases in round 2

The workflow of SKILL.md holds; these are the changes.

### 3.1 Inventory: group the composed pages by layout

Classify every page as flow or composed (SKILL.md), then sort the composed
pages into **kinds of page**: pages whose boxes stand in the same places
with the same sizes (within about 3 mm), the same number of boxes and
pictures, the same ground. Record, per page: its kind, its side (recto or
verso), what differs from the kind (a box missing, a fourth box, a picture on
the other side), and whether it continues a box from the page before or
spans two pages.

- One kind → one template. A kind whose pages differ by one or two frames
  → one shared template plus templates that `extends` it with the
  difference. A kind that differs only by side → `variants.recto` /
  `variants.verso`. A page like no other → a single-use template, still
  named by role (`linea-tiempo`, `mapa-provincias`), never by page number.
- A two-page design (a timeline, a map across the spine) is one spread
  template, not two pages.
- Write the table into the spec sheet: kind, pages, frames, base template.
  The 28-page social-science textbook ported with round 1 needed 117
  callout styles for 121 boxes; its pages fall into about six kinds.

### 3.2 Measuring: build a component library, not per-page styles

Measure every **distinct look** once and store it in the generator as a
named component (section 4). Measure each page's **geometry** (frame boxes,
gaps, picture boxes) in mm from the PDF, per kind of page, as the template
constants. Every number has its source page, as always; a box that differs
by 0.5 mm between pages is the same box.

- Positions from the PDF: PyMuPDF `page.get_drawings()` (box fills and
  rules: `rect`, `fill`), `page.get_text("dict")` (text blocks), image
  boxes (`page.get_image_info()`), converted to mm (× 25.4 / 72) from the
  area the template uses (`content`, `trim` or `bleed`).
- A box's drawn height on the page is its `minHeight` (the text grows it);
  how far the page around it lets it grow is its `maxHeight`.
- First baseline: 0.8 × the line height under the content top (inside
  padding), as in design-analysis.md.

### 3.3 Scaffolding: templates hold no text

In `build_preset.py`, write the library, then the templates from the
geometry constants, with helpers of your own (`frame(name, …)`,
`group(…)`), and generate `preset.json` as always.

- Templates are text-free: decoration text elements hold placeholders only
  (`{pageNumber}`, `{chapterTitle}`, `{attr.tema}`); per-page words come
  from the page fence's attributes or from the Markdown.
- Shared templates first, then `extends` + small patches, then variants.
  Restating a default in a child is meaningful (it overrides the parent).
  From 1.42 a child or a variant takes an element of its base's decoration
  out with `{ "id": "head-even", "remove": true }` in `decoration.elements`:
  use it for the page kinds that lack an element of the base template (a
  running head on the even page, say) instead of redefining the element with
  an empty text.
- Frame names are slot names: by role (`titulo`, `texto`, `dinero`,
  `dinero-fotos`, `mapa`, `pie-1`), the same in every template that has
  that box, so a page can change template without its Markdown changing.
  A draft names its frames by kind and order (`box-4`, `picture-7`), which
  is a different box in the next template; `template_dedupe.py` renames them
  by role (§3.7), and `pdf_regions.py extract` does it itself for a run of
  one page (§3.7). Rename a frame later in the Sandbox's Design › Page
  templates (the name field of the frame): the `slot="…"` of its page fences
  follows, in the chapters on screen and in the other editions a local
  project keeps.
- `lint_project.py` checks templates, slots, spreads, anchors and label
  styles; `postext check` gives the template warnings with JSON pointers.

### 3.4 Extraction: Markdown with `::::page` and slots in reading order

- One `::::page{template="…"}` … `::::` per source page (per sheet for a
  spread), at the place in the chapter where the page falls. Text after
  the closing fence starts on a new page.
- Inside, the content **in the source's reading order**: the title, the
  running text, each box followed by its pictures, captions after their
  picture, the activities at the end. Not template order, not paint order.
- A box: `:::frame{slot="…" label="Tab words" title="…"}` with its whole
  text. A picture: `::resource{id="…" slot="…"}`, or a `:::frame` holding
  it with its caption. A heading the template takes needs no slot.
- Words drawn on a picture (a map, a diagram, labels among photos): cut the
  picture **without** its lettering, store one anchor per word on the
  resource, and write `:::figure{resource="…" slot="…"}` with one
  `::label[TEXT]{at="anchor"}` line per word (recipe 6.4). The edition's
  own `alt`, `caption` and `note` for that picture go in the same fence
  (1.39): `:::figure{resource="relieve" alt="…"}` with `::caption[…]` and
  `::note[…]` lines beside the labels. Never an alt table in the generator
  or a resource edited per language.
- Per-page values that only the design prints (the ground picture, the
  topic's name in a corner): page fence attributes (`fondo="banda-retos"
  tema="Living together"`) read as `{attr.fondo}` / `{attr.tema}`.
- Highlighted phrases: `:mark[…]{style}` (they break like text); key words
  in a box of their own: `:chip[…]{style}` (unbreakable). Never split a
  chip by hand at the source's line ends.
- A story that the source continues "on page 47": the whole article in one
  page fence, the jump in the template (6.8); never the second half typed
  at the later page.
- Answer lines and drawing room: an empty frame with `rules`, or an `auto`
  frame that receives `:::space{lines=N}` (6.9).
- Slot names, fence order and labels' anchors are the same in every
  edition: the stable ids (`cp<n>:<frame>`) then line up across languages.
- The Sandbox's Insert › Composed page (Content mode) writes a fence with
  one empty `:::frame{slot}` per frame of a template, a quick start for a
  page by hand.

### 3.5 Verification

Section 7: per edition, `frameOverflow` = 0, `contentInConfig` = 0, every
template and slot warning fixed, HTML reading order = Markdown order, the
stress test at 1.3, and the page images against the source.

### 3.6 Packing

Section 8: one bundle for every edition.

### 3.7 Drafting it from the PDF

Three scripts do the measuring and the extraction of a PDF's composed
pages in one pass; the result builds as it is and is then curated like any
draft.

```bash
python3 scripts/pdf_regions.py extract source.pdf --pages 4-28 --out work/regions \
    --lang es --fonts my-book/fonts [--font-map map.json] --overlay
python3 scripts/pdf_regions.py manifest work/regions --fonts my-book/fonts   # the draft as extracted
node scripts/render.mjs work/regions --frames work/laid.json                   # its frames as laid
python3 scripts/template_dedupe.py work/regions --laid work/laid.json          # kinds of page, styles, grounds, grids, modules
python3 scripts/pdf_regions.py manifest work/regions --fonts my-book/fonts
postext check work/regions; python3 scripts/composed_check.py check work/regions
node scripts/render.mjs work/regions --frames work/folded.json
python3 scripts/template_dedupe.py work/regions --compare-boxes work/laid.json work/folded.json
```

<table>
<tr><th>Script</th><th>Run it</th><th>It writes</th></tr>
<tr><td><code>pdf_regions.py extract</code></td><td>once per range of composed pages, after the inventory</td><td><code>library.json</code> (one template per page, callout, mark, label and paragraph styles, <code>suggested</code> bodyText, headings and resource types), <code>resources.json</code> + <code>resources/</code> (grounds, pictures, figures with anchors), <code>chapters/&lt;lang&gt;/01-pages.md</code>, <code>regions.json</code>, <code>report.json</code>, with <code>--overlay</code> the source pages with every frame drawn</td></tr>
<tr><td><code>template_dedupe.py</code></td><td>right after <code>extract</code>, and again after merging the output of several runs</td><td>the same files in place: shared templates named by what they hold, <code>extends</code> children, a <code>page-base</code> with the decoration most pages share, styles merged by look, alike grounds merged, frames on a lattice as grid groups, every band of a page as a module and the page template as a shell (below), frames named by role (below); <code>dedupe-report.json</code> with every merge and its largest difference, every grid and module, every frame renamed and (<code>pages</code>) every frame's name on the laid page</td></tr>
<tr><td><code>pdf_regions.py manifest</code></td><td>to look at the draft</td><td>a <code>preset.json</code> in the folder (page size, the library, the chapter, the resources, the fonts) that builds without edits</td></tr>
<tr><td><code>anchors.py</code></td><td>for one map or diagram, or for another edition's labels</td><td><code>anchors.json</code> (the resource's <code>anchors</code>, <code>labelStyles</code>, the labels) and <code>figure.&lt;lang&gt;.md</code>; <code>anchors.py relabel work/regions/figures.json --strings en=en.json</code> writes other editions from a strings file keyed by the source text or the anchor id</td></tr>
</table>

Frame names. `extract` names a frame by kind and order on its page, and a
person correcting or translating the page cannot tell what `box-4` is.
`template_dedupe.py` renames them once the templates are merged, by role and
never by the words they hold: `title`, `text` (the flowing text),
`rotated-text`, a box after its callout style (`box-light-blue`, and
`box-light-blue-tab-white` when the style draws a tab, which is where the
tab shows in the name), `picture`, `figure`, `caption-of-picture` for a text
or box set under a picture or figure, `tab-white-in-box-light-blue` for a
frame laid inside another. The same role has the same name in every template
that has it, a second one of a role is numbered in reading order
(`picture`, `picture-2`), a child keeps the names of the template it extends,
and a frame you named yourself is left alone. The anchors, the groups and the
`slot="…"` of every page fence, in every language under `chapters/`, follow;
`dedupe-report.json` (key `frames`) and the printed report list each rename,
and `--keep-frame-names` turns it off. A draft that dedupe never sees (one
page read, so nothing to merge) is named by `extract` itself with the same
`name_frames`: the templates, the page Markdown, `figures.json`,
`regions.json` and the overlay images carry the role names, and `report.json`
lists them (`frameNames`). The callout styles are still `box-1` there, so a
box says `box`, `box-2` in reading order and dedupe, run later, gives it its
style's name. `--name-frames always` does it for several pages too (dedupe
compares frames by name, and the positions line up from page to page: leave
the default when the pages will be merged), `never` keeps the positions of a
one-page run. The names come from the callout
styles, so merge the styles first (the script does) and give those a real
name (`box-light-blue` to `tip`) before the pages are translated: rename a
style and the frames named after it keep their names, rename the frames in
the Sandbox when a role word is better. A label word on a tab
(`label="Tip"`) is content and never goes into a name.

Grids and modules. `extract` writes one template per page with one frame per
box, which repeats what a designer drew once: a wall of photos with a pill
each, a box with its tab and pictures. `template_dedupe.py` folds them, after
it merges the styles and before it merges the templates:

- **Grids.** Frames of one look (kind, style, layer, the same width within
  `--lattice-tol`, 1 mm) whose tops make rows and starts make columns, with
  one column gap and one row gap (measured as the engine lays a row: the
  reach above the card, a tab, plus the reach below its top, a caption) and
  nothing else among them, become a `kind: "grid"` group repeating the first
  card's set (`grid-picture`, `grid-box`). A frame that hangs from every card
  the same way (above, below or inside it, one per card) is a member:
  anchored off the card's top-left, `below` it, or, when the source centres
  members as wide as their words, off its middle (`top` / `bottom`, width
  `auto`, the narrowest as `minWidth`). Cards held to heights of their own
  that differ are no grid. Cards with nothing hanging from them need
  `--grid-min` (3) of them. Each page's pieces become one
  `:::frame{slot="grid-picture"}` item per card in reading order with the
  members' pieces inside; anchors, groups, connector ends and decoration
  that named a card name its instance (`#grid-picture[3]`), and what hung
  from a row group of the cards hangs from the lowest card of the last row.
- **Modules: the page becomes a shell.** Every frame of the page goes into a
  module, so a page template is a shell (no frames, one modules group filling
  the page from its top-left with no gap, the page's furniture) and pages
  differ only by their Markdown and their `:::module` blocks. The frames are
  joined into units (a box and what it holds, frames anchored to one
  another, a group's members, the frames a connector or a border reads, a
  `next` chain, the flowing text with the frames that `takes` its headings);
  units side by side are one band, and each band, top to bottom, is a module
  whose frames stand where the band stood, offset by its distance from the
  foot of the band before it (the first from the page's top), so the page
  lays as it did and a text that grows pushes what follows. The module with
  the flowing text takes the pieces that name no slot (headings, paragraphs).
  The decoration that reads only a band's frames (a connector, a border) and
  what the page paints inside a band go with it; anything else the page paints
  (its card with the title tab grown out of it, a band of colour) goes with the
  first module as it is, anchored to the page. The shell keeps the furniture:
  what every page of a side paints alike (renamed `furniture-N`, kept to that
  side), the page colour, running heads and folios (`{pageNumber}`,
  `{attr.head}`, widest box kept) and a ground read from a fence attribute,
  unless it would now paint under something the page painted before it. Bands
  alike across the book (frames, styles, groups, decoration within
  `--module-tol`, 0.5 mm) are one module template (`module-box-picture2`); a
  module used once is fine. A text frame that stood in no group gets
  `fit.scaleImages: false` in its module: a module frame's ladder scales the
  pictures of the whole module, the page's scaled only its own. Pages whose
  furniture differs (front matter without a folio) get a shell of their own.
- **Looking the same.** The boxes are read off the draft as the engine lays it
  (`--laid`, from `render.mjs --frames`: groups move frames off the measured
  boxes), else off `regions.json`. Lay the result out again and compare:
  `--compare-boxes BEFORE AFTER` lists every frame that moved by more than
  `--box-tol` (0.5 mm) under its new name, and `compare_pages.py --score`
  gives the pages' likeness to the source before and after (round 1's
  measure: grey, 60 dpi, blurred 2 px, mean difference and share over 40).
  `--no-grids` and `--no-modules` leave the pages as they were.

What the extraction decides, so you know what to check:

- **Text that prints.** MuPDF reads the text with ActualText ignored (it
  otherwise drops words a marked-content replacement covers), and each
  span is compared with a render of the page without text: a copy drawn
  under a picture or a fill, clipped away or off the page is left out and
  listed under `hiddenTexts` in the report.
- **Shapes.** Large white fills are cards; filled or
  stroked rectangles and rounded rectangles that hold text or pictures are
  boxes; a shape 4–13 mm high holding one line of up to ten words is a tab
  (on a box's top edge: the box's `label`; alone: a frame of its own; with
  a heading in it: the title frame that `takes` the level); a rectangle
  under many drawn shapes is a map's ground, not a box; wide coloured
  strokes or fills hugging words are highlights (`:mark`, or `:chip` with
  `--highlights chip`). A shape a render does not show is not read.
- **Vector decoration** (round 2; `--raster-ground` keeps round 1's JPEG
  per page). The template's decoration draws, in paint order: the page's
  colour (a `box` to the bleed), each card (a `box` with its corner radii;
  a card with a title tab of its own colour grown out of its top edge is one
  `path` outline, and the tab frame keeps only its words), borders with no
  words of their own (a `box` from the first frame it holds to a box of no
  size off the last one's foot, so it grows with them: never an empty
  `:::frame`), loose shapes (icons, chevrons: `path` elements), lines that
  join nothing (`path`), and `connector`s. Thin strokes (`--line-width`,
  2 pt) straight across or down are lines, never boxes or a picture's art:
  a bar with one trunk to a frame and drops to two or more is a `tree`
  (each end found by walking the line to the first frame it reaches, the
  bar's place as `trunk`, a drop's place as `at`); two or three segments
  end to end between two frames an `elbow`; a single segment a `straight`
  connector for each run between two frames it passes (under a pill and a
  photo alike, as the source draws it). A line that ends deep inside a
  picture and was painted after it (the page's paint order) points into it:
  the end is a new anchor `pointer-N` of that picture's resource and the
  line leaves the picture's cut; one painted under a photo ends at the
  photo's side. Whatever the vectors and the frames do not paint (a photo
  behind the page, art clipped by a card) is the only raster ground left:
  a transparent PNG, and a page with nothing left gets no ground and no
  `ground=` attribute (`regions.json` `decoration` counts each kind).
  `template_dedupe.py` renames connector ends and size targets with the
  frames and keeps a connector or border in a shared base only when the
  base has its frames.
- **Pictures and labels.** Images and clusters of line art are pictures,
  cut at `--dpi` with all text removed. Words on a picture's ink, short
  words on it or just off its edge (a globe's degrees) are its labels:
  names set on several lines become one label with a `width`, a turned line
  keeps its `rotate`. Raster images with transparency keep their alpha;
  when a box's text runs into one on the source, the frame gets
  `exclude: "push"` and `wrap: "contour"`. Any other picture lies over the
  text as drawn.
- **Label hygiene** (`anchors.py`, `pdf_regions.py`). The same text printed
  twice at one point (within 0.5 mm: two grids of degree figures laid one
  over the other, in two sizes) is one label, the larger size kept, with a
  `# merged` note in the report (`report.json` `notes`, the `anchors.py`
  output), not a second anchor. Names the source prints touching (a
  continent with a hundred country and capital names) get `overlap:
  "allow"` on their anchors (from 1.42), so `labelOverlap` stops listing what
  the source itself prints; `anchors.py` writes it once on the map's label
  styles when a quarter of the map or more touches. `--check-overlap` keeps
  the check on everywhere. The dots and icons of a map are the picture's
  `avoid` zones: `pdf_figures.py symbols book.pdf --page 6 --box x0,y0,x1,y1`
  prints them as fractions of the box, to paste into the resource, and the
  label of a city is then checked against its own dot (a label meant to
  touch its dot gets `overlap: "allow"`).
- **Geometry.** Area `trim`; frames anchor `below` the frame above them on
  the same card; runs with equal gaps form `stack` groups, boxes of one
  height side by side `row` groups; frames inside a box anchor to its
  corner. Boxes get their drawn height as `minHeight`, the last frame on a
  card the room to its foot as `maxHeight`.
- **Furniture.** Text outside the cards (or in the top and foot bands of a
  page without cards) is a running head (`{attr.head}`, the words on the
  page fence) or a folio (`{pageNumber}`), decoration kept to its page's
  side (`parity`).
- **Faces.** The PDF's font names are matched to the PostScript names of
  the files in `--fonts`; `--font-map` maps the rest (a map's lettering
  face the book does not ship, to the nearest face it does). The report
  lists every match.

Also decided by the drafting, checked on a real textbook in three languages:

- **Measure slack** (`--wrap-slack`, default 3 %, at most 4 mm). A box's
  text measure is the width of its longest source line, and the source's own
  tracking (InDesign squeezes a line by a few per cent to fit it) is not in
  another face's widths: a line that just fits breaks one word earlier and
  the box grows a line. The right padding gives up that much, down to nothing.
  A source line squeezed by more than that (measure the source's tracked
  width against the face's advance widths) is a size, not a padding: give
  that box `fit: { minScale: 0.9 }` and its drawn height as `maxHeight`.
- **Pills** (a name over a picture: one line, its word in the middle of the
  tinted tab) are centred in the frame with 1.5 mm insets, so a longer word in
  another edition keeps the middle and has the whole width; the frame keeps
  the pill's height and the ladder sets the word smaller (`fit.minScale`
  0.8) rather than wrapping inside it. A tab that touches a picture lies
  over it (`layer: 2`).
- **Pictures at the foot of a box** (photos under its paragraph) hang from the
  box's bottom edge (`bottom-left`, a negative offset) with their room as the
  box's bottom padding (less the tab's rise: the frame of a box with a tab is
  as tall as the box plus the tab's `offset`, so a box that needs more than
  its drawn height grows, and everything under it moves), and what lies on them (a label, a tab on a drawing)
  hangs from the picture; a longer text makes the box taller and the
  pictures follow. Anchored to the top they stay put and the text runs under
  them.
- **Pictures cut from the page are cut no further than their card.** A map
  whose overflow is masked by white rectangles at the card's edge, next to
  the folio's icons, made a cluster that reached past the card; the cut
  carried a strip of the page's colour, which covered the ground when a
  shorter translation moved the picture up. A cut-out with an alpha channel
  (a photo standing over the card's edge) keeps its overhang.
- **The ground is checked against the render** (`--raster-ground`): a band or box fill the
  redaction left (MuPDF removes line art only when a rectangle covers the
  whole path, and misses wide strokes under a transform) is painted out with
  the colour round it, so highlights are not printed twice.
- **Faces.** `preset_kit.font_families` reads the width and the slant a
  foundry writes only in the PostScript name (`-BoldCn`, `-It`): a condensed
  face is its own family, an `-It` file is italic.
- **Merging alike grounds** compares 512-pixel thumbnails and refuses two
  pages that differ in place by a thin rule (a diagram's connectors), not
  only by mean difference (a page of mostly white paper has a small one).

What the draft still gets wrong on such a book, and the curation that fixes
it (each is a template change plus Markdown frames, never text in the
config): captions set in columns under the pictures of one box are read as
one text running across the pictures (one `:::frame{slot="pie-N"}` under each
`::resource`, centred paragraphs); a box that holds only a tab and a picture
draws no tab when empty (the tab is a frame of its own); two sentences side
by side with a connector between them are one frame each; arrows typed in a
worked example need a face that has the glyph (a `chipStyles` entry in the
face that does, not a picture); a tab's ring icon is not drawn (cut the
ring as a picture resource and set it with `label.icon` and `placement:
"inside"`, 1.42; 6.1); the draft's `box-N` stacks anchor to the frame above,
so a translation that shortens a text moves everything under it up (frames the
source fixes at the card's foot are held there with the foot-hold stack of
section 5, not by anchoring them to the card's foot).

Curate after it: name the templates by role (`tema-cajas`), give pictures
their `altText`, read the notes in `report.json` (a centred tab set at
`top-left`, a tab's icon not drawn, paragraph spacing inside boxes), and
compare the overlay with the source where a page reads wrongly. The 28-page
social-science textbook drafted this way: 25 pages, 335 frames, 26
templates after the merge, 70 callout styles, 258 labels, no
`contentInConfig`, no `frameOverflow`.

## 4. The component library

The library is the set of looks the book uses, each written once:

<table>
<tr><th>Component</th><th>Config</th><th>One per</th></tr>
<tr><td>frame style</td><td><code>calloutStyles[]</code> named by a frame's <code>style</code></td><td>kind of box: fill, border, radius, padding, tab look, title look, body type. Never a position or a measure.</td></tr>
<tr><td>paragraph style</td><td><code>paragraphStyles[]</code></td><td>kind of text block: body, caption under a photo, activity statement, a box's lead</td></tr>
<tr><td>chip style, mark style</td><td><code>chipStyles[]</code>, <code>markStyles[]</code></td><td>highlight colour of the source</td></tr>
<tr><td>label style</td><td><code>labelStyles[]</code></td><td>look of a word on a picture: sea, river, town, country, a diagram's node</td></tr>
<tr><td>heading style</td><td><code>headingStyles[]</code> / <code>headings.levels</code></td><td>level of title</td></tr>
<tr><td>palette entry</td><td><code>colorPalette</code></td><td>colour; the per-unit colours of a book through <code>:::part{palette}</code> or a template's <code>palette</code></td></tr>
</table>

- **Callout styles are frame styles.** A frame's `style` names a callout
  style; the callout settings that place a box in the running text
  (`placement`, `fixed`, `span`, `columns`, `width`, margins) are ignored on
  a frame. So a round-2 style holds the dress only, and one style serves
  every box of its kind on every page: the round-1 port's 117 styles
  compare down to about 16 by look. Put position and measure in the frame
  (`placement`, `width`, `padding` per frame for the room a picture over
  the box needs), and keep the tab's `label.inset` small: the frame's width
  places the tab.
- **A style can be based on another** (1.39): `calloutStyles[].extends:
  "<id>"` takes every field the style leaves unset from that style
  (objects such as `padding`, `fixed` or `titleStyle` key by key; colours
  and lengths whole; never `id` or `name`), and chains are allowed. Write
  one full style per look and, where a box needs its own place or margin,
  a thin style `{ "id": "caja-p5", "extends": "caja", "placement":
  "fixed", "fixed": { … }, "marginBottom": … }`. A parent that does not
  exist is `calloutStyleExtendsUnknown`, a loop `calloutStyleExtendsCycle`
  (the style then stands alone). It carries no text, so `contentInConfig`
  and `preset_kit.py lint` are unaffected.
- **Tracking belongs to the paragraph style** (1.37): a page title tracked
  +15/1000 em is `letterSpacing: { value: 0.015, unit: "em" }` on the style
  its `:::paragraphs{style}` uses, in a frame or in the flow (InDesign
  tracking / 1000 = the em value). It is measured into the lines. Do not
  set such a title as a hidden heading in a `takes: "h1"` frame just to
  keep the tracking. Arabic-script words stay untracked. A box set tighter
  than its face's widths (InDesign tracking in a callout) takes it from 1.42
  as `calloutStyles[].body.letterSpacing` (em of the body size, negative
  tightens), on the paragraphs and list items of the box and of the frames
  that use the style: set it there instead of wrapping every paragraph in a
  `:::paragraphs{style}` fence or shrinking the text with `fit.minScale`.
- **One style per box shape, whatever its tint** (1.42). The topic colours of
  a book (the same box in yellow, pink, blue, green, grey) are not a style
  each. Keep one full style per shape of box (fill or not, border or not,
  tab or not, face, pill or box) and give the tint where the box is used,
  by whichever lever is narrowest:
  (a) the frame's own colours in the template, `look: { "background": …,
  "border": { "color": … }, "label": { "background": …, "color": … } }`
  (fill, border, stripe, icon, marker, title, body, bold and italic colours,
  tab colour and tab text; setting `look.background` turns the fill on);
  (b) a fill linked to a palette entry (`paletteId` on the style's
  background, tab and border colours) and the tint written on the page, as
  `palette="tint=#f6c3d0"` on the page fence or `palette` on the template
  (before 1.42 the template's and the fence's `palette` were read and
  ignored on composed pages); one style then serves every tint and each
  page names its own; (c) both. A `look` colour is the frame's explicit one,
  so a page palette does not recolour it. `look.body.letterSpacing` tracks
  one frame's text. A book whose boxes differ in shape and in tint still has
  one style per shape (seven tints of two shapes: two styles). Group the
  draft's styles by shape first, then by tint: the 28-page textbook's 86
  draft styles came to 17 full styles and 44 thin tint styles on 1.41; on
  1.42 the tint styles go away. Before 1.42, or to hold a tint in the
  library rather than in the template, a thin `extends` style per tint that
  writes only the colours does the same (`{ "id": "caja-rosa", "extends":
  "caja", "background": … }`; for a box with a tab also `label.background`
  and the border colour). A tab's `offset`, `inset` and `paddingX` are
  style fields too (a frame overrides none of them), so boxes whose tabs
  stand at different heights are thin styles as well; never merge them away:
  the box would draw lower and its text with it. The Sandbox's Frame styles
  library (Design › Boxes) lists the *Kinds of box* (a style with those that
  extend it or differ from it only in colours, under the most used) and no
  longer proposes to merge colour-only variants; it still proposes the
  merges of styles that differ in a length, a switch or a word.
- **No per-page duplicates.** Before adding a component, compare it with
  the ones you have (fill, border, radius, type, tab colour, within a
  rounding step); reuse the existing one. Names say the role
  (`caja-azul`, `pie-foto`, `mar`, `ciudad`), never a page.
- The Sandbox's frame-style library (1.37; Design › Boxes › Frame styles,
  `sandbox_frame_styles` / `sandbox_merge_styles` with `groups: [{ keep,
  merge }]`) proposes the merges after a port. A style that `:::callout`
  fences also use carries the box's place (`placement`, `fixed`, margins),
  and merging styles that place boxes differently moves the boxes. Before
  1.39, take `lookOnly: true` (compare the look, not the position) only
  once the boxes take their place from template frames. From 1.39 take it
  at any time: with *Keep each box where it stands* (on by default;
  `keepPlaces`, answer `keptForTheirPlace`) a merged style whose boxes
  stand elsewhere stays as a thin style that `extends` the kept one with
  its position fields, and no fence is rewritten. Measured on the round-1
  textbook: position-safe merges leave 115 of 117 styles, the look alone 16
  full styles (the other 101 become thin ones).
- **Words of a tab** come from the Markdown (`:::frame{label="El dinero"}`):
  give the style a `label` block (font, colours, height, `paddingX`,
  `offset`, `position`) or no tab prints. A style's own `title` default is
  allowed only for a word or two that is form.

## 5. Templates

```jsonc
{ "id": "tema-cajas", "header": false,
  "decoration": { "elements": [
    { "kind": "image", "id": "fondo", "resourceId": "{attr.fondo}", "decorative": true,
      "placement": { "anchor": { "to": "bleed", "edge": "top-left" }, "size": { "width": "fill", "height": "fill" } } },
    { "kind": "text", "id": "tema", "content": "{attr.tema}", "fontSize": { "value": 9, "unit": "pt" },
      "placement": { "anchor": { "to": "page", "edge": "top-right" }, "offset": { "x": { "value": -10, "unit": "mm" }, "y": { "value": 6, "unit": "mm" } } } } ] },
  "frames": [
    { "name": "titulo", "takes": "h1", "style": "tab-titulo", "width": { "value": 170, "unit": "mm" } },
    { "name": "texto", "flow": true, "width": { "value": 182, "unit": "mm" },
      "placement": { "anchor": { "to": "#titulo", "edge": "below" }, "offset": { "y": { "value": 2, "unit": "mm" } } } },
    { "name": "dinero", "style": "caja-azul", "width": { "value": 186, "unit": "mm" },
      "minHeight": { "value": 36, "unit": "mm" }, "maxHeight": { "value": 52, "unit": "mm" },
      "padding": { "right": { "value": 62, "unit": "mm" } },
      "placement": { "anchor": { "to": "#texto", "edge": "below" }, "offset": { "y": { "value": 9, "unit": "mm" } } } },
    { "name": "dinero-fotos", "layer": 2, "width": { "value": 58, "unit": "mm" },
      "placement": { "anchor": { "to": "#dinero", "edge": "top-right" }, "offset": { "x": { "value": -2, "unit": "mm" }, "y": { "value": 2, "unit": "mm" } } } },
    { "name": "gasto", "style": "caja-verde", "width": { "value": 186, "unit": "mm" }, "minHeight": { "value": 62, "unit": "mm" },
      "padding": { "left": { "value": 82, "unit": "mm" } } },
    { "name": "gasto-fotos", "layer": 2, "width": { "value": 76, "unit": "mm" },
      "placement": { "anchor": { "to": "#gasto", "edge": "top-left" }, "offset": { "x": { "value": 3, "unit": "mm" }, "y": { "value": 9, "unit": "mm" } } } } ],
  "groups": [ { "name": "cajas", "kind": "stack", "frames": ["dinero", "gasto"], "gap": { "value": 12, "unit": "mm" } } ] }
```

- **Placement.** A `grid` cell, else `placement` (anchor `container` = the
  template's `area`, `page` = trim, `bleed`, or `#frame` / `#group` with
  `below`, `right-of`, `left-of`, `above`, `align-*` or a corner such as
  `top-right`), else the area's top-left at full width. A frame anchored to
  another moves with it. A `row` group with no box of its own starts at
  the `grid` cell of its first frame (1.39 documents it; it worked
  before): give the first card `grid: { col, row }` rather than an offset
  computed in the generator.
- **Writing mode and direction of a frame** (1.39): a frame may set its
  own `writingMode` and `direction`. A vertical box on a horizontal page:
  `writingMode: "vertical-rl"` (on a right-to-left page too from 1.40: the
  first line stands at the box's right edge, glyphs upright). A horizontal card on a vertical page (a timeline
  card in a vertical book's spread): `writingMode: "horizontal-tb"`.
  `direction: "rtl" | "ltr"` sets the frame's story in that direction
  (a block with its own `{dir}` keeps it), so a right-to-left quotation in
  a left-to-right book is a frame, not a hack. The frame's box is placed as
  written and its content is laid in that box turned a quarter turn (lines
  along its height); an `auto` height is the least that holds the lines in
  its width, so give a frame of long text a fixed height. Up to 1.38 both
  keys were read and checked, not applied; in 1.39 a frame on a
  right-to-left page kept the page's mode. A picture in a frame of the
  other mode (1.40) stands upright with its caption, inside the box, counter-turned against the
  frame's quarter turn (before, it turned with the frame: keep pictures
  out of such frames for 1.39). From 1.42 so does a picture in a frame of a
  vertical page's own mode (a plate and its caption in the frames of a
  `vertical-rl` book no longer turn with the flow); nothing to write. A `next` chain across frames of different
  modes works: each piece is cut for its frame's mode and goes on in the
  next frame's. The reflowable EPUB (1.40) writes such a frame as a box of
  its own `writing-mode` (`pt-frame-vertical` / `pt-frame-horizontal`, its line
  length in em of the body text, fixed at layout time).
- **Sizes.** `width` defaults to `fill`; `height` to `auto` (the content's
  height, between `minHeight` and `maxHeight`, never past the area's foot).
  `width: "auto"` (1.42) is the frame's longest line plus its padding, up to
  `maxWidth` and the room its anchor leaves (text longer than that wraps at
  the cap; a centred or justified title is measured flush left, so it is as
  wide as its words). Use it for a title tab or a box whose width in the
  source follows its text: every edition then matches its own title, and no
  edition gets the width of the longest one with a smaller type
  (`fit.minScale`) to squeeze the others in. The box starts at the edge its
  anchor names, so frames and decoration anchored to it follow its width.
  Not applied to a frame in its own writing mode; a frame with nothing to
  lay is as wide as its `minWidth`. Before 1.42 `auto` read as `fill`.
  Give a box its drawn height as `minHeight`, so the template draws the
  source page and only a longer text changes it; without `minHeight` an
  `auto` frame declares no height and the reflow log stays silent.
- **Groups.** Boxes one under another are a `stack` group, not a chain of
  `below` anchors: the first frame's own placement says where the stack
  starts; the others need no `y`. A box that grows pushes the ones after it
  and the pictures and decoration anchored to them. A group with its own
  `placement`/`grid` box shares that box (`shrink` with `priority`, `grow`,
  `align`). Side by side: a `row` group (left to right, whole-millimetre
  width negotiation). A group takes its members in the order of the
  template's frame list, whatever order they were ticked in in the Sandbox:
  the title frame has to be the first frame of the template.
- **Frames held at the foot of a card** (1.42). A frame anchored below the
  text above it follows that text, so in an edition where the text is a
  line shorter the frames under it move up while the card the template
  draws stays put. To keep frames at the foot of the card whatever the
  translation, make the card's frames one `stack` group with a box of the
  card's height, `grow: 1` + `shrink: 1` on the frames above and `minHeight`
  on the held ones:

  ```jsonc
  "frames": [ { "name": "texto", "grow": 1, "shrink": 1 },
              { "name": "mapa", "minHeight": { "value": 60, "unit": "mm" } } ],
  "groups": [ { "name": "tarjeta", "frames": ["texto", "mapa"], "gap": { "value": 4, "unit": "mm" },
      "placement": { "anchor": { "to": "container", "edge": "top-left" },
                     "size": { "width": "fill", "height": { "value": 140, "unit": "mm" } } } } ]
  ```

  A shorter text moves nothing under it (the growing frame is as tall as the
  room and its text stays at its top); a longer one is squeezed above the
  held frames, which keep their `minHeight`, then the ladder sets the text
  smaller, and `frameOverflow` plus the reflow log (`textScaled`, `overflow`)
  say what did not fit. Do not anchor a frame to the container's foot
  (`bottom-left`) for this: it holds its place, but nothing relates it to
  the frames above, so nothing is squeezed for it and the overlap is not
  reported. The growing frame is as tall as the room whatever it holds, so
  give it no style with a visible background: paint the card in the
  template's decoration. A heading design with a box anchored to the bleed
  down to the trim claims the whole column: write `reserve: false` on that
  box.
- **Pictures beside a box** are frames of their own, `layer: 2`, anchored
  to a corner of the box and not members of its group; keep the box's text
  clear with the box frame's `padding` on that side, or mark the picture
  frame `exclude: "push"` (rectangle) or `wrap: "contour"` (outline).
- **A frame's own colours and a page's palette** (1.42): `look` on a frame
  and `palette` on a template or a page fence tint a box without another
  style (§4, "One style per box shape").
- **The contents on a composed page** (1.42): a frame with `takes: "toc"`
  (or a `:::toc` inside a `:::frame`) lays the contents with its part rows,
  leaders and `keep` groups, over the page ground the template draws as its
  decoration:

  ```md
  ::::page{template="contenido"}
  # Contenido {toc="false"}

  :::toc
  ::::
  ```

  Do not set a contents page as a flow page with a heading design any more
  (the ground then lives in the design and the rows in the flow): a
  `takes: "toc"` frame needs no other trick. The heading that titles the
  contents needs `toc: false` in its heading style, or `{toc="false"}`, as
  in the flow, or it lists itself. A page break between parts is ignored
  in a frame, but from 1.43 `toc.parts.breakBefore` works there: the frame is cut
  before every part but the first even when all of it fits, so each part opens
  the added page (or the next frame of the chain). The frame must be able to go
  on (`overflow.continueIn: "next-page"` or `template:<id>`, or a `next`
  chain), or the setting is ignored, silently; the continuation mark at each cut
  is the frame's own (`overflow.mark`, `false` turns it off). For a book whose
  contents run one part per page, set it in the contents template, not with a
  `:::pagebreak` between rows (rows of a contents are not authored); a block of the contents that a frame cannot hold goes whole to
  the added page (its head row repeated once if it must be cut, entries are
  never cut inside their lines). `slotEmpty` is raised for a `takes: "toc"`
  frame on a page with no `:::toc`. Before 1.42 the rows of a `:::toc` in a
  frame were laid without part rows, links or the rules of the flow's
  contents.
- **`pin: true`** on a frame or a decoration element keeps it where the
  template draws it, for a box that must stay on the artwork.
- **Fit** (1.36): `fit: { minScale: 0.9 }` (body text no lower than 0.9;
  0.925 for boxes whose type size matters), `fit.imageMinScale` (0.8)
  for pictures; `fit: { shrinkText: false }` keeps a box's type size. Do
  not shrink fonts per edition by hand: let the ladder do it and read the
  log. From 1.38 a frame that can go on to another page (`continueIn`
  `next-page`, `template:`, `page:`) goes on before it shrinks
  (`fit.preferContinue`, default true), so a body frame needs no
  `shrinkText: false` or `scaleImages: false` to keep one size over its
  pages; write `preferContinue: false` only on a box that should lose a
  few points rather than add a page.
- **Decoration** is laid after the frames and anchors to `#frame`; it never
  pushes text and is dropped from reflowable output, so no word of the book
  goes there. A decoration text may print `{headingNumber}` (1.42: the
  counter of the first numbered heading the page's frames hold, in the
  document's digits) or `{headingNumber.<frame>}` for the heading a named
  frame holds, empty when there is none: a number badge over a title tab is
  `{headingNumber}`, never a number copied into a page-fence attribute. A
  decoration text over a frame is found by a click where the frame has no
  text of its own, so the badge need not be placed outside the frame to be
  editable; decoration still paints under the frames (a frame with a
  negative `layer` goes under it). Its edges can be `top-start`, `start`, `bottom-start`,
  `top-end`, `end`, `bottom-end` and `align-start` / `align-end` (1.39):
  the start is the left of a left-to-right page and the right of a
  right-to-left or vertical one on the sheet, and `offset.x` runs from
  start to end. A kicker or folio of a template shared by an Arabic and a
  Latin edition is `top-start`, once; do not choose `top-left` or
  `top-right` per edition. Frames are laid in the flow, where `start` is
  `left` already. A ground or a band that runs to another box's edge takes its
  size from it (1.38): `size.height: { "to": "bleed", "edge": "bottom" }`
  anchored `below` a band, or `{ "to": "#band", "edge": "top" }`; it
  follows the band when the band moves. Do not work heights out from the
  page geometry in the generator (6.10).
- **Headings in frames** (1.37): a heading in a frame, as in a callout,
  keeps the `advancedDesign` of its level or heading style (tab, band,
  rules, `{titleText}`), laid out at the frame's width, so a mid-page topic
  title with a tab is `## Title {style="tab-tema"}` in the frame's
  Markdown, the tab in the heading style's design anchored to `container`
  (a negative offset reaches over the frame's padding). The frame keeps the
  room the design takes (the tallest of the text, the design and
  `minHeight`; no grid): use `minHeight` to say where the text under a tab
  starts. The design scales with the frame's text and turns with the frame.
  A heading in a frame opens no styled section: running heads, the page's
  role and the chapter's `{attr.x}` come from headings of the flow, so do
  not rely on that style's `header`/`footer`. Before 1.37 the title was its
  own frame with a callout style (`takes: "h1"` or `## T {slot="titulo-2"}`).
- **Running heads** per template: `header`/`footer` replace the section's,
  `false` hides them, unset inherits.
- **Variants.** `variants: { recto: { frames: [ { "name": "margen", "placement": { … } } ] } }`
  mirrors a margin column on right pages; spreads take no variant.
- **Single-use pages** extend the nearest base with a patch. The Sandbox's
  «Only this page» writes `<id>-page` templates the same way; when a project
  has them, fold the ones that repeat into a named template.

## 6. Recipes

Every recipe gives the template part and the Markdown part. Dimensions are
`{ "value": n, "unit": "mm" }`, shortened here to `mm(n)` as preset_kit
writes them; colours `color("#hex")`.

### 6.1 A box with a tab

The source: a tinted box with a white tab on its top edge holding two or
three words, its text, a photo standing over its right side.

```python
callout_styles.append({
    "id": "caja-azul", "backgroundEnabled": True, "background": color("#d8ecf9"),
    "border": {"enabled": False}, "borderRadius": mm(1.5),
    "padding": {"top": mm(3), "right": mm(4), "bottom": mm(3.5), "left": mm(4)},
    "label": {"position": "top-left", "background": color("#ffffff"), "color": color("#231f20"),
              "fontFamily": SANS, "fontSize": pt(11), "fontWeight": 700,
              "height": mm(6.4), "paddingX": mm(2.5), "offset": mm(6.4), "inset": mm(0)},
    "body": {"fontFamily": SANS, "fontSize": pt(10.5), "lineHeight": pt(15)},
})
frames += [
    {"name": "dinero", "style": "caja-azul", "width": mm(186), "minHeight": mm(36),
     "padding": {"right": mm(62)}},
    {"name": "dinero-fotos", "layer": 2, "width": mm(58),
     "placement": {"anchor": {"to": "#dinero", "edge": "top-right"}, "offset": {"x": mm(-2), "y": mm(2)}}},
]
```

```md
:::frame{slot="dinero" label="El dinero"}
Es el instrumento utilizado como medio de pago…
:::

::resource{id="dinero-pago" slot="dinero-fotos"}
```

- The tab is the style's `label`; its words are the fence's `label`. With
  an `offset` the box starts that far below the frame's top: measure the
  frame's anchor to the tab's top.
- The tab sits at `top-left`, `top-right`, `top-start` or `top-end` and is
  square; an icon (`label.icon`) stands beside it on the side away from the
  corner. A tab with rounded ends: a `top-right` tab whose icon picture
  draws that end. A ring or dot before the words, inside the tab (1.42):
  `label.icon.placement: "inside"` fits the picture into `icon.width` × the
  tab's height (aspect kept), widens the tab by the picture and
  `label.icon.gap`, stands it at the start of the tab (its right end in a
  box set against the document's direction) and begins the words after it;
  `"beside"` (the default) keeps the old look, the picture past the tab's
  edge. Before 1.43 the picture keeps its own colours, so a white ring and
  a coloured one are two resources and a style per tab colour. From 1.43
  `label.icon.tint: true` paints the picture in `label.color` (the colour of
  the words) whatever its own colours: its silhouette, opaque and translucent
  parts as stored. One transparent black or white ring then serves every tint
  of a book: when a source prints the same icon in different colours per box
  kind, take one picture and set `tint`. It works with `"inside"` and
  `"beside"`. A picture with no transparency (a JPEG, a filled square) becomes
  a plain rectangle, so draw rings and marks on transparency. In the PDF an SVG
  keeps its edges and a bitmap is cut where it is half transparent (1 bit); the
  `pdfFileId` print master of a tinted SVG is ignored (a PDF page cannot be
  recoloured). `tint` wins over `diagramStyle.singleInk`, and a reading system
  without CSS filters shows the picture in its own colours in the fixed-layout
  EPUB. With no picture to draw (the resource is
  missing or has none) the tab is the plain one. A tab centred over a card
  has no setting: put it at `top-left` with `inset` and say so in the report.
  A title tab as wide as its title in every edition is `width: "auto"` with
  a `maxWidth` on the frame (section 5, "Sizes").
- A box with a second topic title inside it: an `##` in the frame draws
  its heading style's design from 1.37 (section 5, "Headings in frames"),
  and is listed by `:::toc` and the bookmarks. Before 1.37, make the
  tabbed title its own frame with a callout style (`takes: "h2"` or
  `## Title {slot="titulo-2"}`), or use the box's tab.
- A list as the box's first block drops its top margin; a list after a
  paragraph takes the document's `unorderedLists.marginTop` (set it with
  boxes in mind).

### 6.2 A category tree (a diagram)

The source: a root box, a row of category boxes under it, a few words in
each, connectors between them.

Short words in the nodes (up to about a dozen words each): the connectors
and the node boxes are a text-free picture, the words are labels.

```python
labelStyles.append({"id": "nodo", "fontFamily": SANS, "fontSize": pt(10), "fontWeight": 700,
                    "color": color("#231f20"), "minScale": 0.85})
resources.append(svg(PROJECT, "arbol-sectores", "resources/arbol-sectores.svg",
    anchors=[{"id": "raiz", "x": 0.5, "y": 0.09, "width": 0.3, "style": "nodo"},
             {"id": "primario", "x": 0.17, "y": 0.62, "width": 0.28, "style": "nodo"},
             {"id": "secundario", "x": 0.5, "y": 0.62, "width": 0.28, "style": "nodo"},
             {"id": "terciario", "x": 0.83, "y": 0.62, "width": 0.28, "style": "nodo"}]))
```

```md
:::figure{resource="arbol-sectores" slot="arbol"}
::label[Sectores económicos]{at="raiz"}
::label[**Primario:** obtiene recursos de la naturaleza]{at="primario"}
::label[**Secundario:** los transforma]{at="secundario"}
::label[**Terciario:** ofrece servicios]{at="terciario"}
:::
```

- `width` (a fraction of the picture's width) is the measure each label
  breaks in; centred by default. A label too wide for its measure is set
  smaller down to its style's `minScale`.
- A node whose plate the art does not draw: give the label style
  `background` + `padding`.
- Sentences in the nodes (a paragraph each): make each node a frame (a
  `row` group of category frames anchored `below` the root frame, each with
  a callout style), and draw the connectors as one decoration `connector`
  (`routing: "tree"`, `from: { to: "#raiz" }`, `to: [{ to: "#primario" }, …]`),
  which follows the frames when a box grows (`pdf_regions.py` writes it from
  the source's lines).
- Before labels are drawn (postext < 1.37): the round-1 live-text SVG
  (playbooks J4) and say in the report where the words are.

### 6.3 A double-page timeline

The source: a title and text on the left page, a band of eras across both
pages, a picture strip from one outer edge to the other, a box on the right.

```python
templates.append({
    "id": "linea-tiempo", "spread": True, "gutter": mm(10),
    "grid": {"columns": 6, "rows": 12, "columnGap": mm(12), "rowGap": mm(3)},
    "frames": [
        {"name": "titulo", "takes": "h1", "style": "tab-titulo"},
        {"name": "texto", "flow": True, "width": mm(196),
         "placement": {"anchor": {"to": "#titulo", "edge": "below"}}},
        {"name": "recuadro", "style": "recuadro", "grid": {"col": 4, "row": 1, "cols": 3, "rows": 4}},
        {"name": "banda-1", "style": "banda", "grid": {"col": 1, "row": 5, "cols": 3}, "height": mm(8)},
        {"name": "banda-2", "style": "banda", "crossGutter": True, "width": "fill", "height": mm(8),
         "placement": {"anchor": {"to": "#banda-1", "edge": "right-of"}, "offset": {"x": mm(2)}}},
        {"name": "era-1", "style": "era", "grid": {"col": 1, "row": 6, "rows": 2}},
        # … era-2 to era-6, one grid column each
        {"name": "tira", "crossGutter": True, "grid": {"col": 1, "row": 8, "cols": 6, "rows": 3}},
    ],
})
```

```md
::::page{template="linea-tiempo" spread}
# Cómo medimos el tiempo

Para saber cuándo comer, trabajar o descansar…

:::frame{slot="banda-1"}
Sin relojes mecánicos
:::

:::frame{slot="banda-2"}
Con relojes mecánicos
:::

:::frame{slot="era-1" label="Prehistoria"}
…
:::

::resource{id="tira-tiempo" slot="tira"}

:::frame{slot="recuadro" label="Recuerda"}
…
:::
::::
```

- Coordinates run over the sheet: `trim` is twice the page width (spine at
  the page width), `content` runs from one outer margin to the other with
  both inner margins inside, `bleed` has none at the spine. Measure on the
  joined source spread (left page 0 to W, right page W to 2W).
- A spread opens on a verso and may add a blank page before it: if the
  port must keep the source's folios, check that the page before it ends on
  a recto. The fence's `spread` flag must agree with the template
  (`spreadMismatch`).
- `gutter` keeps frames off the spine band; `crossGutter: true` on the
  bands, strips and grounds that run across. A crossing frame is read on
  the page holding its centre and painted on both. Join the two halves of
  the source art into one picture.
- A column gap wider than the gutter keeps a symmetric grid's cards off the
  band, so none is moved (the log would say `resized` / `moved` with cause
  `gutter`).
- Era names on tabs are the frames' `label`s: every word stays in the
  Markdown.
- A bundle that holds only the spread's excerpt starts at it: `start:
  { "pageIndexOffset": 1 }` in the manifest (project-format.md §2; the
  `continuation` of the first chapter), or the engine adds a blank page 1
  before the verso.
- A band across the spine: the second band `crossGutter: true`, anchored
  `right-of` the first, `width: "fill"`, with a left `padding` wider than
  the spine gap so its words start on the recto, where they are read.
- Dots and ticks on a timeline are decoration elements anchored to the
  card (`#era-3`, `top`, a negative y offset): they follow it when a row
  moves or widens it. Declare `bitmap.resolution` on pictures inside cards
  so the natural width is the narrowest card's measure; a picture is never
  enlarged, so a wider card gives its room to the text.
- A map across the fold: ONE resource in a `crossGutter` frame. From 1.43 a
  label whose box would reach into the spine band is slid along the sheet to
  the band's edge, on the side of its anchor: place the anchors where the
  names stand in the source and let the engine keep them off the fold, never
  shift anchors by hand. A name meant to run across both pages (a title over
  the map) takes `gutter: "cross"` on its anchor (`"keep"` is the default and
  is not written). Read the spread's labels near the spine in the rendered
  pages: a label that moved is still on its anchor's side, so a name that
  straddled the fold in the source ends up beside it. Before 1.43, keep the
  labels a few mm off the spine yourself.
- On a vertical (`vertical-rl`) book (1.38) the spread is laid in the
  pages' flow frame: the template's `x` runs down the sheet and its `y`
  from the sheet's right edge leftwards, the right page first; `gutter`,
  `crossGutter` and the cut at the spine read that axis; decoration stays
  on the physical sheet. Write the template for the flow's frame. A card
  of a horizontal timeline would come out turned with the page's mode: give
  it `writingMode: "horizontal-tb"` (1.39) and its text is laid across, in
  a box placed as written (a fixed `height` for a long card). Before 1.39
  the card came out vertical; before 1.38 a vertical book's spread had the
  wrong frame and no warning: keep the timeline horizontal and say so in
  the report.

### 6.4 A labelled map

The source: a map with seas, countries and towns lettered on it, a legend.

1. Cut the map without its lettering (`anchors.py` and `pdf_regions.py`
   do steps 1–3; §3.7). With PyMuPDF: redact the text spans
   inside the map's box (`page.add_redact_annot(span_rect, fill=False)`),
   `page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
   graphics=fitz.PDF_REDACT_LINE_ART_NONE, text=fitz.PDF_REDACT_TEXT_REMOVE)`,
   then render the box at 200 dpi. Check by rendering that no hidden copy
   of the lettering is left in the art.
2. One anchor per word on the resource, in fractions of the whole picture:
   the span's centre (or its baseline) over the picture's box.
3. One label style per look of the source.

```python
label_styles += [
    {"id": "mar", "fontStyle": "italic", "textTransform": "uppercase", "letterSpacing": 0.12,
     "color": color("#2b6ca3")},
    {"id": "ciudad", "fontWeight": 600, "halo": {"color": color("#ffffff"), "width": pt(0.6)}},
    {"id": "rio", "fontStyle": "italic", "color": color("#2b6ca3")},
]
resources.append(bitmap(PROJECT, "mapa-europa", "resources/mapa-europa.png", alt="Mapa de Europa",
    anchors=[{"id": "atlantico", "x": 0.12, "y": 0.55, "width": 0.16, "style": "mar"},
             {"id": "madrid", "x": 0.21, "y": 0.78, "verticalAlign": "bottom", "style": "ciudad"},
             {"id": "danubio", "x": 0.62, "y": 0.6, "rotate": -18, "style": "rio"}]))
```

```md
:::figure{resource="mapa-europa" slot="mapa"}
::label[OCÉANO ATLÁNTICO]{at="atlantico"}
::label[Madrid]{at="madrid"}
::label[Danubio]{at="danubio"}
:::
```

- A name set on two or three lines is one label: join the lines, give the
  anchor a `width` about 1.25 × the widest line, centred. Its words may
  change order in another language (`ATLANTIC OCEAN`).
- Matching a source baseline with `verticalAlign: "top"`: the anchor about
  0.78 × the font size (in mm) above the baseline; or `"middle"` at the
  x-height.
- Editions in left-to-right and right-to-left scripts share the anchors:
  centre town names above (`verticalAlign: "bottom"`) or below the dot
  rather than beside it.
- Do not redraw a plate the art already draws (coloured country tabs stay
  in the picture). Legend entries stay separate labels.
- Put on the anchor what belongs to the place (`style`, `rotate` along a
  river or a range, `width` for a two-line name); keep `style=` on a
  `::label` for exceptions. A translation is then new label lines and
  nothing else; `anchorUnlabelled` lists the anchors an edition forgot.
- A label style that borrows a paragraph style (`paragraphStyle`) takes its
  italics and capitals. From 1.40 write `fontStyle: "normal"` and
  `textTransform: "none"` on the label style to turn them off; left out,
  the paragraph style's hold (before 1.40 a borrowed italic or capital
  could not be switched off, so a map name needed a paragraph style of its
  own).
- Label styles per script: Arabic gets no italic and `letterSpacing: 0`
  (letter-spaced Arabic is a `joiningScriptLetterSpacing` failure) and
  usually about 15 % more size. On right-to-left composed pages the frames
  follow the mirrored content area and the decoration does not: place a
  template's kickers and folios with `top-start` / `top-end` (1.39), which
  stand on the same side of the reading direction in every edition. Before
  1.39 a template shared by both directions placed them by edition
  (`top-left` or `top-right`).
- **The figure's own words** (1.39). The edition's alt text, caption and
  note go in the Markdown, beside the labels:

  ```md
  :::figure{resource="relieve" slot="mapa" alt="Mapa físico de la península"}
  ::caption[Relieve de la península ibérica]
  ::note[Fuente: IGN]
  ::label[Pirineos]{at="pirineos"}
  :::
  ```

  `alt`, `caption` and `note` may be attributes or `::alt[…]`,
  `::caption[…]`, `::note[…]` lines (a line wins); `alt=""` marks the
  picture decorative. Every output reads them (layout, HTML alt, tagged PDF,
  EPUB), the stored resource is untouched, and a resource that two figures
  of one file place takes the first figure's words (1.42: a later figure
  that says other words is not shown them and raises `figureWordsShared`;
  see "A picture twice" below). A translation of a map
  that shares one resource across editions needs no ALT table in the
  script and no resource edited per language. A caption set this way is not
  source-mapped per character, and `:ref` does not print it. Before 1.39
  these were per edition in the resource, with no Markdown hook.
- **Checks on the labels** (1.39), per edition, because a translation with
  longer words is where they fail: `labelOverlap` (a label runs into
  another by more than 12 % of the smaller line height; the later label
  carries the warning, with the one it meets and a count) and
  `labelOverflow` (still wider than the anchor's `width` at the style's
  `minScale`). Run `postext check --json` for every language. For an
  overlap move an anchor, narrow the anchor's `width` so the name wraps, or
  shorten the words of that edition's Markdown; for an overflow widen
  `width`, shorten the word or lower the style's `minScale`. From 1.42 a
  label the source prints touching another carries `overlap: "allow"` on
  its anchor (or one `overlap: "allow"` on the label style, for a whole map
  such as a continent with a hundred country and capital names), and the
  check leaves it, and every pair it is in, alone; a label placed by `at="x%
  y%"` has no anchor and takes its style's value. The check stays on for
  every label that does not say so.
- **Symbols on the picture** (1.42). A picture's `avoid` zones (rectangles
  in fractions of the picture, the same field comics use for faces; drawn in
  the marks dialog's Avoid zones mode, or listed by `pdf_figures.py symbols`
  from the dots and icons of the source) count as the map's symbols: a
  label that runs onto one raises `labelOverlap` with `withSymbol` (1-based)
  and `with: "symbol N"`, and the label of a city is checked against its
  own dot. `composed_check.py` treats the label-label pairs as a note and
  the symbol case as a failure: the symbol is a point the source keeps
  clear; a label meant to touch its dot gets `overlap: "allow"`. The shapes
  of an SVG are not read as symbols, only the zones. The contrast
  check, the print preflight and part palettes read label colours: a label
  bare on the picture is skipped by the contrast check, so give a label on
  a busy ground a halo or a plate.
- **Vertical labels** (1.39): `writingMode: "vertical-rl"` on the anchor or
  the label style, for a map in a CJK edition. `width` is then a fraction of
  the picture's height; `align` runs down the column (`start` = top) and
  `verticalAlign` across the columns (`top` = the first, right-hand one).
  Do not use `rotate: 90` for it: the glyphs would lie on their side.
  On the mirrored page of a right-to-left book (1.40) a vertical label
  reads as on the left-to-right page: same cells, forms and offsets from
  the anchor. Before 1.40 those cells ran bottom to top; give such an
  edition's names horizontally and name the gap.
- **A picture twice, with other words** (1.42). A resource has one set of
  words (`alt`, `caption`, `note`) per chapter: the first `:::figure` of it.
  A small copy of a map with a caption of its own (the map on a contents
  page) is a second resource that points at the same `fileId` (a new id, its
  own anchors if it has labels), and the second figure names that one. It
  takes its own number in the type's sequence. `figureWordsShared` (cause:
  a later figure's words differ from the first's or the first left them
  unsaid; fix: the second resource) is in `composed_check.py`'s failures
  and `lint_project.py` raises it before the build.
- **Label styles in the Sandbox** (1.42): Design › Figures & tables › Label
  styles lists `labelStyles` (id, type, halo and plate, fit and layout,
  slant and letter case as three-way choices: unset, `normal`/`none`,
  `italic`/`uppercase`; overlap `check` or `allow`). Renaming an id in the Sandbox (1.43) rewrites
  `Resource.anchors[].style` and the `style` of the `::label` lines of every
  chapter (one history step per chapter and picture, one for the design);
  before 1.43, and when editing the bundle's JSON by hand, rename the same id
  in the anchors and in the `::label{style=…}` lines too, or the Checks panel
  raises `labelStyleUnknown`. In the Folio's pages a label's point is dragged in select
  mode (the drop writes the anchor, or the `at` percentages in the
  Markdown, in one history step; a double click opens the anchors).
- Right-to-left books: the reflowable EPUB draws plain figure labels over
  the picture from 1.42 too (words of Latin or Arabic script, in sheet
  order, each right-to-left word anchored at its right edge); a label with a
  formula, a chip, a mark or a script the SVG cannot set (vertical columns)
  still goes to the hidden list.
- A full-page map goes in a frame of the page's width; in the running text
  a figure may be capped smaller.
- Give the picture `altText` too: the labels are added to it in HTML and
  PDF (`Alt (Madrid, Danubio)`), they do not replace it.

### 6.5 Photos with captions

The source: three photos in a row, each with a two-line caption under it.

```python
frames += [
    {"name": "foto-1", "width": mm(56),
     "placement": {"anchor": {"to": "#texto", "edge": "below"}, "offset": {"y": mm(6)}}},
    {"name": "foto-2", "width": mm(56)},
    {"name": "foto-3", "width": mm(56)},
]
groups.append({"name": "fotos", "kind": "row", "frames": ["foto-1", "foto-2", "foto-3"], "gap": mm(6)})
paragraph_styles.append({"id": "pie-foto", "fontSize": pt(9), "lineHeight": pt(11.5), "textAlign": "left"})
resource_types.append({"id": "foto", "name": "Foto", "numberingTemplate": "", "captionPrefix": "",
                       "defaultPlacement": {"position": "here"}})
```

```md
:::frame{slot="foto-1"}
::resource{id="mercado"}

:::paragraphs{style="pie-foto"}
Un mercado de barrio.
:::
:::
```

- The caption is Markdown in the photo's frame, so correcting or
  translating it is a Markdown edit. Use the resource's own `caption` (and
  `localized.<lang>.resources`) only when the book numbers its figures
  ("Figura 3").
- An unnumbered resource type (`numberingTemplate: ""`) keeps "Photo 1"
  off the page. From 1.38 the type may leave the other fields out (the
  built-in type of the same id, else the id and `{h1}.{n}`, fill them):
  `{"id": "foto", "numberingTemplate": ""}` is enough; write every field
  only for 1.37 and older.
- A row keeps its frames' widths and grows as tall as the tallest caption
  needs. Photos of different widths: different frame widths.
- Labels on a photo (a chip naming what is shown, an arrow's word): a
  `:::figure` on that photo with anchors (6.4), label style with
  `background` + `padding` for a chip-like plate.
- A photo laid over a box: 6.1.

### 6.6 Text running round an illustration (contour)

The source: lines that step in and out round a cut-out drawing.

```python
resources.append(bitmap(PROJECT, "patinadora", "resources/patinadora.png", alt="Una niña patina",
                        contour={"threshold": 0.5, "margin": mm(2)}))
frames += [
    {"name": "texto", "flow": True, "width": mm(120)},
    {"name": "dibujo", "layer": 2, "exclude": "push", "wrap": "contour", "width": mm(60),
     "placement": {"anchor": {"to": "#texto", "edge": "top-right"}, "offset": {"x": mm(-30), "y": mm(8)}}},
]
```

```md
::resource{id="patinadora" slot="dibujo"}
```

- The picture is a PNG with its transparency (from the PDF:
  `pdfimages -png`, then merge the soft mask as alpha). A JPEG or an SVG has
  no alpha shape: give `contour.points` (a polygon in fractions of the
  picture, at least three points), or convert the art to PNG.
- `margin` is the gap between the drawing and the nearest line ends on the
  source (1.5–3 mm is usual). The outline is traced from the file by
  `readBundle`, the Sandbox and the command line: never write
  `contour.traced` by hand or keep it in `preset.json` (bundles strip it).
  A palette PNG (PNG8 with a `tRNS` chunk) traces fine and keeps the asset
  small.
- Never copy the source's line breaks or per-line indents.
- `textWrap` with reason `noContour`: the shape is unknown and the text ran
  round the box. Check the alpha channel, or add `points`.
- In the running text (not a composed page): `placement: {"position":
  "here", "wrap": "contour", "align": "right", "width": 0.4}` on the
  resource.
- Text on both sides of a shape in the middle of a measure is not done:
  the text takes the wider side. Before 1.36: the frame pushes with its
  box, or the text frame's `padding` keeps the drawing's column.

### 6.7 A box that continues on the next page

The source: a box whose text runs over to the page after, with «sigue» at
the cut.

```python
templates += [
    {"id": "tema-cajas", "overflowTemplate": "tema-sigue", "frames": [
        {"name": "dinero", "style": "caja-azul", "minHeight": mm(36), "maxHeight": mm(80),
         "overflow": {"continueIn": "next-page"}}]},
    {"id": "tema-sigue", "extends": "tema-base", "frames": [
        {"name": "dinero", "style": "caja-azul", "padding": {"right": mm(62)}}]},
]
```

```md
:::frame{slot="dinero" label="El dinero"}
…the whole text of the box, as in the source…
:::
```

- The whole text stays in one `:::frame`. Never move the part that runs
  over into a second page fence: the engine cuts where the frame is full,
  in every edition, and the cut moves when the text changes.
- Continuing is a step of the reflow ladder: the frame first grows to
  `maxHeight` and makes room in its group; then, from 1.38, it is cut at
  its foot with the mark, before its pictures or text are set smaller
  (`fit.preferContinue`, default true), so the story keeps one size over
  its pages and its last page is not set smaller than the ones before.
  Do not add `fit: { shrinkText: false }` for that; write
  `preferContinue: false` only for a box that should lose a few points
  rather than add a page. Before 1.38 the order was growing, pictures,
  text down to `fit.minScale`, then continuing: a body frame needed
  `fit: { shrinkText: false, scaleImages: false }`.
- The rest goes on, at full size, in the frame of the same name on a page
  added right after (else the flow frame). The piece is cut as the running
  text is (1.38): a heading goes with its first lines, a list keeps two
  items on each side, and when none of the box fits the whole box goes on,
  tab and all. No `:::space` or reordering to strand-proof a cut.
- `overflow.mark`: a string («sigue»), `false`, or unset (the style's
  `continuesMarker`, in the document's language). `{page}` in a string is
  the printed number of the page the rest goes on on (1.38): `"Continúa en
  la página {page}"`. `overflow.fromMark` sets words at the head of the
  piece on the added page (`"Viene de la página {page}"`; the receiving
  frame's own wins); or `repeatTitle: true` on the style (title +
  `continuedSuffix`). Before 1.38 the mark took no page number.
- Without `overflowTemplate` the same template is laid again with only
  that frame filled. Added pages are pages of the book (folio, running
  heads, parity), so a longer translation moves every later folio: check
  every edition.
- Up to 16 added pages (`frameContinuationLimit` after that); a frame on
  the added page too small for any of it gives `frameOverflow` with
  `continue` among the steps tried.
- Before 1.37: a `maxHeight` the page can absorb, a `next` frame on the same
  page, or the box set as a flow page.

### 6.8 A magazine thread

The source: an article running through three columns round a pull quote
and a photo, jumping to a later page.

```python
def columns(last):
    return [
        {"name": "col-1", "flow": True, "next": "col-2", "grid": {"col": 1, "row": 2, "rows": 8}},
        {"name": "col-2", "next": "col-3", "grid": {"col": 2, "row": 2, "rows": 8}},
        {"name": "col-3", "grid": {"col": 3, "row": 2, "rows": 8}, "overflow": last},
    ]

templates.append({"id": "articulo", "grid": {"columns": 3, "rows": 9, "columnGap": mm(5), "rowGap": mm(2)}, "frames": [
    {"name": "titular", "takes": "h1", "style": "titular", "grid": {"col": 1, "row": 1, "cols": 3}},
    *columns({"continueIn": "page:{attr.sigue}",
              "mark": "Continúa en la página {page}", "fromMark": "Viene de la página {page}"}),
    {"name": "cita", "style": "cita", "exclude": "push", "layer": 2, "grid": {"col": 2, "row": 4, "cols": 2, "rows": 2}},
    {"name": "foto", "exclude": "push", "layer": 2, "grid": {"col": 1, "row": 7, "rows": 3}},
]})
# the jump page: its own story in "otra", an empty frame for the rest
templates.append({"id": "saltos", "frames": [
    {"name": "otra", "flow": True, "grid": {"col": 1, "row": 1, "cols": 2, "rows": 9}},
    {"name": "resto", "grid": {"col": 3, "row": 1, "rows": 9}},
]})
# an article that goes on over added pages instead of jumping: give its last
# column {"continueIn": "template:cuerpo"}; "cuerpo" continues into itself, so
# every column refills on each added page
templates.append({"id": "cuerpo", "frames": columns({"continueIn": "template:cuerpo"})})
```

```md
::::page{template="articulo" sigue="p47"}
# El río que cambió de curso

El texto entero del artículo…

:::frame{slot="cita"}
«Nadie recordaba el agua tan alta.»
:::

::resource{id="crecida" slot="foto"}
::::

::::page{template="saltos" id="p47"}
Otra historia, entera…
::::
```

- `next` threads the story through frames of the same page, re-broken at
  each frame's width, with nothing lost or repeated; the frames of a chain
  carry no continuation mark. A pull quote and a photo with
  `exclude: "push"` make the columns' lines short where they stand.
- The pull quote repeats words of the article: it is content, written in
  the Markdown, never in a template.
- **A jump to a later page** («continúa en la página 47», after other
  articles), 1.38: `overflow.continueIn: "page:<id>"` sends the rest to the
  page fence with that `id`; `<id>` may be `{attr.sigue}`, read from the
  fence the story is on, so one article template serves every article and
  the Markdown says where each jumps. The rest lands in `page:<id>#<frame>`
  if named, else in the frame of the sending chain head's name, else the
  first frame the jump page's own content leaves empty (not reported
  `slotEmpty`); what that frame cannot hold goes on on pages added after
  the jump page. The jump page keeps its own content in its other frames
  and its own frame ids (`cp2:resto`). An id no later fence has is
  `continueTargetMissing` (the rest goes on on the next page); check that
  `postext check` has none. Before 1.41 the jump went forward within one
  chapter file only: keep an article and its jump page in one chapter
  file. From 1.41 a magazine kept as one chapter file per article jumps
  into a page fence of a later file (`::::page{template="saltos" id="p47"}`
  in `chapters/09-back.md`, the article's fence `next="p47"` with
  `continueIn: "page:{attr.next}"`): no text is copied, the chapter that has
  the page lays the rest, `{page}` in `overflow.mark` / `fromMark` prints
  the book's page numbers across the files, and the nearest later chapter
  with that `id` wins (keep the ids unique in the book). The id must be on a
  fence of a later chapter whose template exists, or it is
  `continueTargetMissing` (the porter's check lists the `target`). The rest
  is set in the book's body typography, not in a styled section of the
  receiving chapter. Index marks, anchors and headings written in that rest
  are listed where the chapter that has the page sets the words (1.42; in
  1.41 the story's start took them): the back-of-book index, the contents, a
  `:ref` and an anchor's destination in the PDF name the jump page, and the
  Sandbox paints the sending chapter's selection over the carried words.
  Before 1.42 put marks and anchors in the part that stays on the first page
  when they matter. `postext check` and `postext build` handle it
  (`buildBundle`); a chapter checked alone with `--chapters` knows only the
  chapters selected. In a tagged PDF the story reads in its chapter and the
  rest after the jump page's own frames; in the reflowable EPUB the rest
  comes in the chapter that has the page. The Sandbox's template editor
  lists every page fence that carries an `id` as `page:<id>` under
  «Content that does not fit goes to» (1.39), and a «Page id» field writes
  any value, such as `{attr.sigue}`.
  In `check --json` a jump is a `continued` event whose `toPage` is the
  jump page, and the receiving frame's `continuedFrom` is the sending
  frame. Before 1.38 a jump had no expression: set the rest on the page
  right after, or in the flow, and name the gap.
- **A story over added pages.** From 1.38 the rest of a threaded story goes
  on where its chain starts: a body template whose last column continues
  into `template:<itself>` (or `next-page`) fills every column of every
  added page. Before 1.38 the rest landed in the frame of the same name
  as the cutting frame, so the last column alone refilled on every added
  page with no warning; the way round was two templates handing the story
  to each other with distinct frame names (`page-a-3` into `template:page-b`
  and back), and body frames with `fit: { shrinkText: false }` so the
  last page was not set at 92.5 %.
- A chain inside a group measures its later frames empty when the group is
  solved: keep chained columns out of stack groups. A push frame anchored
  to a text frame of the chain is placed after it: anchor push frames
  (quote, photo) to a frame that is not pushed (the standfirst) or to the
  container, so they are known when the columns are set.
- **Full-bleed photos** of a template are decoration images anchored to
  `bleed` with `resourceId: "{attr.foto}"`, the photo chosen on the fence
  (6.10); they need postext-pdf 1.37 or later to print (older releases
  printed them grey).
- **Drop caps** (1.38, 1.39): a frame is running text, not a box, so its
  first paragraph takes one: a heading level's `dropCap` for the paragraph
  after a heading in the same frame, a paragraph style with `dropCap`, or
  `:::paragraphs{style="entradilla" dropcap}` inside the `:::frame`. From
  1.39 a heading a `takes` frame took (a title frame of `takes: "h1"`) also
  gives the text frame's first paragraph that level's initial (`{dropcap=off}`
  on the heading turns it off, a paragraph of another slot gets none), so
  no `dropcap` group is needed for it; keep one only for a style-specific
  initial. A drop-cap paragraph is not cut above the initial's last line
  across a `next` chain or a continuation: it moves on whole, as in the
  flow. A `dropCap` warning `split` means a frame too short for the
  initial's lines (raise it or lengthen the frame); `inBox` means a
  `:::callout`, where the drop cap is not set. Before 1.39 a title frame
  left the text frame's first paragraph without its initial and a cut could
  strand the initial's lines. Before 1.38 frames set none.
- **Columns cut by the widow and orphan rules** (1.39): a `:::columns`
  group set whole, and a frame with `columns`, keeps `bodyText.widowMinLines`
  and `orphanMinLines` lines on each side of a cut and takes the cut whose
  tallest column is shortest, so two paragraphs of 6 and 5 lines set 6 | 5,
  never 5 | 1+5; a group of one-line items balances fullest first (2 | 2 | 1).
  Do not rewrite paragraphs to dodge a lone line at a column head or foot.
  Before 1.39 the cut fell at the nearest line to an equal share.
- Narrow columns (60 mm at 9.8 pt) set justified text loosely and rag the
  first line after an indent: `bodyText.maxJustifyTracking: 12` halves the
  loose lines; the rest needs copy edits or a smaller indent.

### 6.9 An activity sheet with answer lines

The source: an exercise box, an empty ruled space under it, a second
exercise; the box can run over to the next page, and the answer space goes
with it.

```python
templates.append({"id": "actividad", "frames": [
    {"name": "texto", "flow": True, "width": mm(180)},
    {"name": "pregunta", "style": "ejercicio", "minHeight": mm(30), "maxHeight": mm(110),
     "overflow": {"continueIn": "next-page"}},
    {"name": "respuesta", "optional": True, "height": mm(40), "minHeight": mm(40),
     "rules": {"color": color("#93bcd8"), "width": pt(0.75)}},
    {"name": "libre", "optional": True, "style": "ejercicio", "minHeight": mm(10),
     "rules": {"color": color("#93bcd8")}},
], "groups": [{"name": "cajas", "kind": "stack", "gap": mm(4), "frames": ["pregunta", "respuesta", "libre"]}]})
```

```md
:::frame{slot="pregunta" label="Actividad 1"}
Copia la oración y subraya el verbo…
:::

:::frame{slot="libre" label="Actividad 2"}
Escribe tu respuesta:

:::space{lines=4}

:::
```

- **Ruled frames** (1.38): `rules: { every, color, width, inset }` draws
  lines across the frame's content box, one at the foot of each line slot,
  as many as its height holds, over its background and under its text.
  `every` is `"line"` (the leading of the frame's text, the default) or a
  length; `color` a mid grey, `width` 0.5 pt, `inset` the room at both ends.
  An empty frame with a fixed height gets the lines that fit; an `auto`
  frame that receives `:::space{lines=N}` gets N (the Markdown decides the
  count); a frame that grows with its text gets more. No decoration `rule`
  per line anchored to the frame, no `:::space` guesswork. The Sandbox's
  frame inspector turns them on under Look.
- **Keep answer frames at their size**: `minHeight` = `height` (the ladder's
  redistribute step yields down to `minHeight`; without it the empty frame
  can be squeezed to nothing). In a stack, empty frames keep their fixed
  height when a box above grows (1.38): the box's text gives way, or the
  box goes on. A frame cut below its `minHeight` or fixed height is
  `frameOverflow` even when it holds nothing.
- **A box that goes on** (`continueIn: "next-page"`) may end a stack that
  has an answer frame under it: the answer frame goes with the rest to the
  added page at its size, with its decoration. This holds when the rest goes
  on on the same template laid again (the template has no `overflowTemplate`);
  keep the answer frame's `minHeight` = `height` and do not leave slack
  under the box instead.
- **Rows of cards**: `height: "auto"` + `minHeight` on each card of a `row`
  group negotiates width at the `minHeight`, with no box of the row's own;
  the row grows taller only when no card can give width. Before 1.38 a row
  needed a fixed `height` and a `maxHeight` per card, and with `auto`
  heights it never negotiated.
- A drawing area inside a box is `:::space{lines=N}` in that frame's
  Markdown.

### 6.10 A photo, a ground and a band to the foot

The source: a full-bleed photograph, a coloured band across the page, a
ground below the band down to the trim.

```python
decoration = [
    {"kind": "image", "id": "foto", "resourceId": "{attr.foto}", "decorative": True,
     "fit": "cover", "focus": {"x": 0.5, "y": 0.3},
     "placement": {"anchor": {"to": "bleed", "edge": "top-left"},
                   "size": {"width": "fill", "height": mm(120)}}},
    {"kind": "box", "id": "banda", "placement": {"anchor": {"to": "#foto", "edge": "below"},
                                                 "size": {"width": "fill", "height": mm(14)}},
     "style": {"backgroundColor": color("#1d3557")}},
    {"kind": "box", "id": "suelo", "placement": {"anchor": {"to": "#banda", "edge": "below"},
                                                 "size": {"width": "fill", "height": {"to": "bleed", "edge": "bottom"}}},
     "style": {"backgroundColor": color("#f6efe0")}},
]
```

```md
::::page{template="portada-foto" foto="foto-portada"}
…
::::
```

- **`fit: "cover"`** (1.38) on an image with both sides set fills the box
  and crops what runs past it; the resource's `safeArea` stays in view and
  `focus` says which point to centre. Do not cut the photograph to the
  box's ratio in the generator. `fit: "contain"` (default) shows it whole.
  Before 1.38 the photograph was pre-cut to the ratio of its box. From 1.39
  `cover` also crops an upright picture of a vertical page's flow (a
  heading design's image in a vertical book); before, it was fitted whole
  there, so a vertical edition needed the picture cut to the box by hand.
  The Sandbox's image editor has a *Focus point* picker (the window the crop
  keeps outlined; a click sets `focus`, arrows move it 1 %, Shift 10 %).
- **`size: { to, edge }`** (1.38): a height runs from the element's anchor
  point to the `top`/`bottom` edge of another box, a width to its
  `left`/`right` edge; `to` is `container`, `page`, `bleed`, `outer` or
  `#id` (on a composed page's decoration, a frame or a group). The ground
  follows the band when the band moves. Before 1.38 the generator computed
  the heights from the page geometry. The Sandbox's slot editor has the
  controls (1.39): «Width runs to» / «Height runs to» with an edge, and
  *To an edge* as a mode of a text's width and height.
- The photograph is chosen on the page fence (`foto="…"`), never written in
  the template; an id that resolves to nothing draws nothing, so name the
  attribute in every fence of the template.

### 6.11 A contents page

The source: a contents page on a tinted ground, a map thumbnail, part rows
with their entries and page numbers.

```json
{ "id": "contenido", "decoration": { "elements": [ { "kind": "image", "id": "fondo", "resourceId": "{attr.fondo}",
    "decorative": true, "placement": { "anchor": { "to": "bleed", "edge": "top-left" },
    "size": { "width": "fill", "height": "fill" } } } ] },
  "frames": [ { "name": "titulo", "takes": "h1", "style": "tab-titulo" },
              { "name": "indice", "takes": "toc", "width": { "value": 120, "unit": "mm" },
                "placement": { "anchor": { "to": "#titulo", "edge": "below" } } },
              { "name": "mapa", "width": { "value": 52, "unit": "mm" },
                "placement": { "anchor": { "to": "page", "edge": "top-right" } } } ] }
```

```md
::::page{template="contenido" fondo="fondo-contenido"}
# Contenido {toc="false"}

:::toc
:::

::resource{id="mapa-contenido" slot="mapa"}
::::
```

- The contents are `:::toc` in the page's Markdown (never retyped) and the
  frame is `takes: "toc"`; the rows, the part rows, the leaders, the links
  and `toc.groups` / `:::toc{keep}` are the flow's own (1.42). The ground,
  a band or a picture are the template's decoration. Before 1.42 this was a
  flow page whose heading design carried the ground: leave such ports
  alone only when the installed Postext is older.
- The title heading is not an entry of itself: `toc: false` in its heading
  style, or `{toc="false"}`.
- A small copy of a picture on the page (the map) is a second resource on the
  same file when its words differ from the first figure's (6.4).
- A heading design with a box anchored to the bleed down to the trim would
  claim the whole column; `reserve: false` on that box.
- A part that is too long for the frame goes whole to the added page
  (`continueIn`); set a contents page that must stay on one page with
  `fit.minScale` and read `frameOverflow`.

## 7. Verification

Run per edition, at every milestone and before delivery:

```bash
python3 scripts/lint_project.py my-book --quiet          # templates, slots, anchors, label styles, contentInConfig
python3 scripts/preset_kit.py lint my-book               # no book text in the config, config size
python3 scripts/composed_check.py check my-book --stress 1.3   # every edition: postext check + postext html
```

`composed_check.py check` fails on any of these, edition by edition:

- `frameOverflow` = 0. Read its `proposals` (`postext check --json`,
  `warnings[].data`): `raiseMax` / `lowerMin` when the page has room,
  `allowShrink` only down to the house minimum, `useTemplate` when another
  template fits, `continueNextPage` for a box the source continues,
  `shortenText` last (it is an estimate). A translation that overflows is
  fixed in the template's limits, not by hand-shrinking that edition.
- `frameContinuationLimit` = 0, and `continueTargetMissing` = 0 (1.38: a
  `page:<id>` jump whose later page fence is missing).
- `contentInConfig` = 0 (and `preset_kit.py lint` clean: it counts page
  templates' decoration and running heads too).
- No `templateUnknown`, `slotUnknown`, `pageFenceLength`, `spreadMismatch`,
  `unclosedContainer`, no `figureWordsShared`, no `labelOverlap` onto a
  symbol, no template config warning (`frameStyleUnknown`,
  `frameAnchorUnknown`, `frameMinMax`, `frameChainLoop`,
  `overflowTargetUnknown`…), no `labelAnchorUnknown`, no `tocGroupSplit`,
  no `calloutStyleExtendsUnknown` / `calloutStyleExtendsCycle`.
  `labelOverlap` and `labelOverflow` (1.39, per edition; 6.4) are
  warnings to read in every language: `composed_check.py` fails on
  `labelOverflow` and lists `labelOverlap` between two labels as a note,
  because only the reader can say whether two labels that meet are wrong;
  a `labelOverlap` that carries `withSymbol` (the label runs onto an
  `avoid` zone of the picture, 1.42) fails, as does `figureWordsShared`.
  `headingClaimsColumn` (1.43, `level`, `element?`) is a finding too: an
  in-column heading of a multi-column page whose design reserves the whole
  column, so the body text starts in the next column or page. `element` is the
  id of the design element that reaches lowest; absent means `minHeight` is
  what fills it. Fix in this order: `reserve: false` on an element that is
  decoration (a seal, a side band, a ground), a lower `minHeight`, or
  `span: 'page'` when the heading is meant to own the page. A page-span
  opener, a heading on a one-column page and a heading followed by an explicit
  break are not reported.
  `slotEmpty` (a frame given nothing) and `anchorUnlabelled` (an anchor this
  edition gives no word) are notes: read each, mark deliberate empties
  `optional: true`.
- **Reading order = source order**: the HTML viewer (`postext html`) writes
  each page's frames in reading order; the script checks they come in the
  order the Markdown sends content to them, and warns when two editions
  read a page fence's frames in different orders (a box moved before the
  text in one translation). Then check by eye that the Markdown follows
  the source page's reading order.
- **The stress test** (`--stress 1.3`, the Cookbook bench's C38): every
  paragraph, heading and list item 30 % longer, its own words repeated.
  Each page must rearrange (the reflow log) or go on; a `frameOverflow`
  whose proposals carry values is a warning (the next move of whoever fits
  the copy), any other new warning fails. Fix the template (`fit`,
  `maxHeight`, `next`, `overflow`), never the factor. The script works from
  the command line's JSON and does not read frame boxes; the Cookbook bench's
  C38 does, and since 1.39 it also fails a frame pushed past any edge of the
  type area (foot, head, left, right) or of the bleed, and on a spread
  measures the sheet of both pages (a band across the spine is judged
  against the sheet's outer edges). From 1.40 it measures a vertical frame
  by its box on the page (`framePageRect`), not the turned box it is laid
  out in. Run it on the book's recipe when the Cookbook is at hand.

Then:

- **The reflow log** (`postext check`, one `reflow p. N (template): …`
  line per page; `--json` `reflow[]`): on the source's own text it should be
  empty or small. A box that grew on the original text means its drawn
  `minHeight` is too small for the book's fonts: take the logged `toMm` if
  the source box was that tall. Report `text at 92.5 %` lines per edition.
- **Page images** of every edition against the source (`postext build …
  --watch`, `compare_pages.py`); for a spread, render both pages and join
  them.
- **Other outputs.** The Markdown order is the reading order everywhere:
  the reflowable EPUB writes a composed page as `<section class="pt-composed
  pt-composed-<template>">` with a `<div class="pt-frame pt-frame-<name>">`
  per frame in its callout style, the frame's `label` as the box title, and
  drops the decoration (backgrounds, cards, design text), so no word of the
  book may live there; the fixed-layout EPUB and the HTML viewer list the
  frames in reading order and paint them by `z-index`; the tagged PDF reads
  them as `Div`s in the same order. Figure labels are accessible text (a
  hidden list after the picture in the reflowable EPUB; `Alt (Label, Label)`
  appended to the alt text in HTML, fixed EPUB and tagged PDF): give the
  picture its own `altText` too. From 1.40 the reflowable EPUB also draws
  plain labels over the picture (one inline SVG layer: bold, italic, own
  font, halo and plate as in print). Formulas, chips, marks, vertical
  labels and every label of a right-to-left book stay in the hidden list
  only, so a map of those reads as a list in a reflowable EPUB. A fixed-layout EPUB that lacks a face the
  decoration uses warns `missingFont`.
- **Source map** (1.36): every frame's text maps back to the Markdown
  (`sourceAt`, `elementsForSource`; the Sandbox's `sandbox_inspect_point`
  answers with `elements` and their `source`). Nothing on a composed page
  should answer with a `config` source except decoration and running heads.
  `sourceAt(doc, page, x, y)` takes sheet points. On a right-to-left or
  vertical page the frames and the flow text are read in the flow frame,
  and every element whose `rect` is there carries `flow: true` (also from
  `elementsForSource` and `findElement`); a script that clicks an element
  "at its rect" maps a flagged rect with `flowRectToPage(page, rect)` first.
  Up to 1.38 a sheet point on a frame of such a page found only the
  template.
- In the Sandbox: Content mode (Alt+Shift+M switches) to correct text on
  the page, Design mode for templates and styles (Design › Page & columns ›
  Page templates; frames dragged and resized on the page write
  `placement.offset` and `width`/`height` in mm; «Only this page» adds a
  `<id>-page` template that extends the first); a red outline «N mm short»
  is a frame that does not fit, an amber «text at 85 %» a frame the ladder
  shrank. A bundle in several languages imported into the Sandbox keeps
  every edition in one project (1.39; Books row tags, the edition bar, the
  permalink `#project=ID&lang=L`; before, the import asked for one language
  and kept only that): the Checks panel's Composed pages section lists every
  composed-page warning per edition with its locale, page and frame, and
  «Side by side» shows two editions aligned. A bundle that names font files
  it does not carry (licensed faces left out of the pack) imports with the
  family reported as unknown, so `pack.py` need not drop them from `fonts`.
- **Why a page differs from its template** (1.38): Canvas › Reflow lists, per
  page, each frame that changed and why, with the declared box dashed and
  an arrow to the laid one; the same log is `sandbox_inspect_pages`
  (`pages[].composed.reflow`) and `postext check`. A `frameOverflow` carries
  numbered fixes (`sandbox_get_warnings` → `warnings[].proposals`);
  `sandbox_apply_proposal { frame, proposal }` applies one, lays out again
  and answers `fits`; `sandbox_undo` takes it back (one history for text
  and design; `sandbox_get_state` → `history`). A design fix changes every
  page set with that template: prefer `raiseMax` / `continueNextPage` on a
  template used once, and check the other pages after `allowShrink`.
  `useTemplate` can be wrong when the other template lacks some of the
  page's slots: read `fits` in the answer. From 1.40 the trial sets the
  merged stories as the build does (`:::paragraphs` groups and their styles, heading
  levels' drop caps, `indentAfterHeading`), so a proposal that `fits` does
  fit once applied; before, a trial with those could answer wrongly or
  throw. `shortenText` only selects the
  text.
- **Frame styles**: run the merges of section 4 after the port.
- **Anchors**: for a map whose geometry is unknown, write the `::label`
  lines and leave the anchors out: Resources › the picture › Anchors lists
  the names the text uses that the picture lacks, and one click on the
  picture places each, in text order. With the geometry known, write
  `resource.anchors` (or `sandbox_save_resource` `marks.anchors`). In Design
  mode the canvas shows each label's box (red = overflowing at the style's
  `minScale`) and its anchor, which can be dragged; `at="` in a `::label`
  completes the picture's anchors. A label placed with `at="x% y%"` is
  dragged on the Canvas too and rewrites the `at` value of the edition on
  screen (1.39). Anchors mode on a dense map (24 or more points) shows a
  point's name only when picked, hovered or ticked; tick anchors (checkbox,
  Shift-click, *Select shown* after a filter) to set style, alignment and
  writing of many at once. In the anchors dialog (1.40) the picture zooms
  100 to 800 % (buttons, `+` `-` `0`, Ctrl/Meta-scroll or a pinch about the
  point under the pointer) and pans by scrolling, the hand tool, Space or the middle
  button; a dense map names every point from 300 %. In the HTML viewer's
  Design mode (1.40) a drag of a label's point writes the anchor (or the
  `at` percentages) as one history step, a click opens the picture and a
  double click the anchor editor.
- **Every edition at once** (1.40): `sandbox_get_composed_checks`
  (WebMCP, `language` keeps one edition) lists the composed checks of every
  edition of the open book by language, chapter, page and frame, so the
  template that fits in Spanish and overflows in Catalan shows after
  `composed_check.py` of the first edition. `sandbox_get_warnings` still
  checks one chapter of the language on screen. A book with more than 48
  chapter layouts (chapters times editions) shows the chapter on screen
  and a **Check every edition** button in the Checks panel instead of
  laying the other languages out unasked.
- **Template editor, 1.43** (Design › Page & columns › Page templates): a frame
  added to a template that has a group is sized like the group's last member;
  `groups[].frames` is an ordered list and its order is the order on the page
  (the engine honours it), with arrows in the editor; New picks the first
  frame. Nothing in the file formats changed.
- **Spreads in the template editor**: on right-to-left and vertical books
  the editor draws the sheet and the spine band as the engine laid them
  (1.40; before, as if left to right).

## 8. One bundle for every edition

- `chapters.<lang>` per edition in one `preset.json`; the same page fences
  in the same order, the same slot names and the same anchors in every
  edition, so frame ids (`cp<n>:<frame>`) and label ids line up.
- `localized.<lang>.config` only for what the language changes (locale,
  labels, hyphenation, faces); templates and the library are shared. A
  template that must differ in one language (a box made wider for German)
  is a sign the template is too tight: raise `maxHeight` or the ladder's
  limits for all.
- `localized.<lang>.name` (and `description`) for each edition's title. From
  1.42 the Sandbox keeps what the bundle calls each edition: the Books row
  and the window title follow the edition on screen until the reader renames
  the project (that name then stands in every language), and an export writes
  each edition's title back as `localized.<lang>.name` unless it was renamed.
  A port that wants the editions titled differently writes both names.
- A project of several editions exports `layouts.<lang>.json` for every
  edition that has a current pagination (read before `layouts.json`, which is
  the primary edition's); these are engine-written caches, never written by
  hand, and a stale one is ignored. Do not pack them with `pack` (it leaves
  `layouts*.json` out); the Sandbox's export writes them.
- Adding an edition in the Sandbox (1.43): Books › ⋯ › Add a language… (WebMCP
  `sandbox_save_book` `{ action: "add_language", id?, language }`). The new
  edition starts as a copy of the open one with `config.locale` set to the new
  language (an Arabic, Chinese or Japanese edition also gets that language's
  defaults, keeping the settings the book chose itself); its Markdown still
  has to be translated. A bundle made with `localized` (one `chapters` and
  `config` per language) is the same thing on disk: to port a book to several
  languages, build one edition first and add the others the same way (copy the
  chapters, set the document language, translate). `sandbox_save_book` `rename`
  takes `thisLanguageOnly: true` to title one language of a book in several
  (otherwise a rename is the book's in every language); copying a sample names
  the copy "<name> copy" (localized).
- Labels' words are in each edition's Markdown; anchors on the shared
  resource. Pictures with lettering per language (avoid them) go through
  `localized.<lang>.resources`.
- `preset_kit.py pack my-book --manifest-only`, then `postext check
  my-book.postext --locale <lang>` and `composed_check.py check
  my-book.postext` on the packed file.

## 9. Ports made with round 1 or with postext 1.33

- **A 1.33 port** that drew whole pages as text elements of heading styles
  (one hidden style per page): from 1.37 `moveTextToMarkdown` rewrites it.
  In the Sandbox: Checks › «Move the text
  to the Markdown» (before and after pages, undoable). From code:

  ```ts
  import { moveTextToMarkdown } from 'postext';
  const { config, chapters, report } = moveTextToMarkdown(
    { config, chapters: [{ id, markdown }, …], metadata },
    { shareTemplates: true, highlightsToChips: true, unusedStyles: 'remove' },
  );
  ```

  Write `config` back to the generator (or preset.json) and each chapter's
  Markdown back to its file, re-render and compare. `report` lists the pages
  written (template, side, frames, `differences`), the templates proposed,
  what was left (`left[]`, with a reason) and `contentInConfigBefore/After`.
  The `differences` codes name the pages that may look different: `box`,
  `stroke`, `dropCap`, `paragraphIndent`, `height` (a text's own box,
  outline, drop cap, indent, height), `side`, `flow`, `repeated`. Fix by
  hand what it leaves (`left[]`): texts anchored to the running head's
  container or to another element, texts mixing words and placeholders, the
  text of a heading design. Letter spacing is no longer left: it goes into
  the paragraph style the text becomes (em of its size, 1.37).
  With `labelsOnPictures: true` (1.38; the Sandbox's dialog offers it from
  1.39 as *Words on pictures become their labels (N)*, off by default; pass
  the book's `resources` as
  `input.resources` and write back `result.resources`; or `{ maxFontSize }`)
  the short words a design placed on a picture (one line, at most four
  words, no larger than three quarters of the body size) become the
  picture's labels instead of frames: the picture moves to a frame at its
  box with a `:::figure` and one `::label` line per text, each text an
  anchor of the resource (first baseline, alignment side, box width) with a
  `labelStyles` entry, a bitmap smaller than its box gets the `resolution`
  that sets it at that width. Longer or bigger texts on the picture stay
  frames; the report's `labels` counts them. After turning it on, look at
  the pages the dialog marks «Looks different»: decoration that was painted
  over a picture (`overPicture`) lay under the picture's frame. From 1.40
  the picture's frame goes under the decoration (`layer: -1`) when the design
  painted decoration over the picture and none under it (and over none of its
  labels or another labelled picture); otherwise the frame stays on layer 0
  and the page is still reported, because a template's decoration is one
  slot and cannot keep both orders.
- **A round-1 port** (#848: fixed callouts, grounds in a page-span opener
  design, live-text SVG labels) has no text in the config, so nothing
  migrates it by itself. Move it page kind by page kind: each page's
  fixed callouts become a `::::page{template}` with one `:::frame{slot}`
  per box (the `:::callout{type}` fence's text moves as it is), the
  fixed styles' `fixed` anchors and offsets become frame placements, their
  dress collapses into the library (section 4), the ground picture moves
  from the opener design to the template's decoration (`{attr.fondo}` on
  the page fence), the H1 kept on one grid line to carry the ground becomes
  a plain `# Title` the template `takes`, and the SVG label layers' strings
  files become `::label` lines (6.4). Keep round 1's page images as the
  reference and compare.

## 10. Limits to name in the report

- Tabs are square and stand at a top corner, start or end; no centred tab.
- Rows run left to right in every writing direction; a template's
  `bodyStyle` is read but not applied yet (its `palette` is, from 1.42).
  A frame's own `writingMode` and `direction` on frames work on every page
  from 1.40; the reflowable EPUB's frame box has its length at layout time,
  not re-flowed.
- A continuation goes on right after its page, or, with `page:<id>`, on a
  later page fence of the same chapter file or (1.41) of a later chapter
  file; a jump never goes back. Before 1.38 a mark took no page number.
- A resource has one set of words (`alt`, `caption`, `note`) per chapter; a
  second figure of it with other words needs a second resource (6.4).
- A `look` colour is the frame's explicit one and is not recoloured by a
  page palette. A box whose shape differs as well as its tint is a style per
  shape. The Sandbox draws an `auto`-width frame at full width in the
  template thumbnails until a page is laid.
- Picture shapes of an SVG are map symbols only once they are `avoid` zones:
  from 1.43 the Sandbox reads them from the drawing (Avoid zones mode ›
  Symbols of the drawing: an id prefix or a class, `sandbox_save_resource`
  `marks: { svgSymbols: { idPrefix, className } }`; give the SVG's symbols a
  shared prefix such as `sym-` or a class when drawing or converting it, read
  them once, and read again when the SVG changes: the zones are stored with
  the picture); without a browser, or before 1.43, write the rectangles in
  fractions of the picture (`pdf_figures.py symbols` lists them from a PDF); a
  label with a formula, chip, mark or a script the SVG cannot set stays in
  the reflowable EPUB's hidden list. Before 1.43 the tab's picture kept its own colours; from 1.43
  `label.icon.tint: true` paints it in the tab's `label.color` (its silhouette), so one picture serves every tint.
- Text on both sides of a contour in the middle of a measure is not set.
- Before 1.47 the Sandbox's HTML viewer laid a composed page on its own
  screen page (a frame at the foot a scroll away in the vertical view, the
  page cut at the screen's foot in the columns view); from 1.47 it lays it on
  the print leaf and scales it to the screen (`composedViewerLeaf`, host
  only: never write it in preset.json). Judge screen editions from 1.47.
- Text panels of comics are set in their frames on single comic pages of
  any writing mode (1.39; horizontal left-to-right only before), and on
  strips and spreads from 1.40 (a panel across the spine keeps its text on
  one page, 8 mm clear of the spine; comics.md).
- A caption set in a `:::figure` is not source-mapped per character (a
  click answers the figure), and `:ref` does not print it.
- Before 1.37 headings in frames were plain; before 1.38 spreads were not
  laid on vertical books and frames set no drop caps; before 1.39 frames
  ignored their `writingMode` and `direction`, column cuts could strand one
  line, and labels were unchecked; before 1.40 a vertical frame on a
  right-to-left page kept the page's mode, pictures turned with a vertical
  frame, a borrowed italic stayed on and strips took no text panels; before
  1.41 a jump stayed in one chapter file; before 1.42 `auto` width read as
  `fill`, a template's and a fence's `palette` were ignored, the contents in
  a frame had no part rows or links, the frames of a vertical page's own
  flow turned their pictures, a decoration text over a frame was not found by
  a click, the label tab's picture stood past its edge and `labelOverlap`
  knew no symbols; before 1.43 a label could stand on the fold of a spread, a
  tab's picture could not be tinted, a contents frame had no part breaks and the
  stand-in faces of a licensed family stayed out of EPUB and HTML exports: name
  the gap when the installed version is older.
