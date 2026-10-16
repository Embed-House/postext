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

Contents: 1 choosing the round · 2 the model · 3 the phases in round 2 ·
4 the component library · 5 templates · 6 recipes (a box with a tab, a
category tree, a double-page timeline, a labelled map, photos with captions,
text round an illustration, a box that continues, a magazine thread) ·
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
<tr><td>1.37.0</td><td>continuation on added pages (<code>overflow.continueIn: "next-page" | "template:&lt;id&gt;"</code>, <code>overflowTemplate</code>, <code>frameContinuationLimit</code>); <code>::label</code> words drawn at a picture's anchors (<code>labelAnchorUnknown</code>, <code>anchorUnlabelled</code>); <code>moveTextToMarkdown</code> (#874, check the release notes)</td><td>2</td></tr>
</table>

- **Which version counts.** The one the book will be opened in: the
  Sandbox at postext.dev runs the latest release; a user's program runs
  the `postext` npm version it pins. Update the command line before you
  start (`releases/latest`, SKILL.md "Setup"); an old executable on the
  PATH makes a port choose round 1 for no reason.
- **Round 2 with gaps.** On 1.35 or 1.36 the script lists what is missing
  and what to do instead: without the ladder, give each frame its room by
  hand (`maxHeight`, a chained frame, shorter text); without continuation,
  a taller frame, a chained frame on the same page, or a flow page (never
  the rest of the text typed into a second page fence); without labels, the
  round-1 live-text SVG (playbooks J4) for maps and diagrams only.
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
- Frame names are slot names: by role (`titulo`, `texto`, `dinero`,
  `dinero-fotos`, `mapa`, `pie-1`), the same in every template that has
  that box, so a page can change template without its Markdown changing.
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
  `::label[TEXT]{at="anchor"}` line per word (recipe 6.4).
- Per-page values that only the design prints (the ground picture, the
  topic's name in a corner): page fence attributes (`fondo="banda-retos"
  tema="Living together"`) read as `{attr.fondo}` / `{attr.tema}`.
- Highlighted phrases: `:mark[…]{style}` (they break like text); key words
  in a box of their own: `:chip[…]{style}` (unbreakable). Never split a
  chip by hand at the source's line ends.
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
- **No per-page duplicates.** Before adding a component, compare it with
  the ones you have (fill, border, radius, type, tab colour, within a
  rounding step); reuse the existing one. Names say the role
  (`caja-azul`, `pie-foto`, `mar`, `ciudad`), never a page.
- When the Sandbox has the frame-style library (Design › Boxes › Frame
  styles, `sandbox_frame_styles` / `sandbox_merge_styles`), run it after a
  port with `lookOnly: true` and take the merges it proposes.
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
  another moves with it.
- **Sizes.** `width` defaults to `fill`; `height` to `auto` (the content's
  height, between `minHeight` and `maxHeight`, never past the area's foot).
  Give a box its drawn height as `minHeight`, so the template draws the
  source page and only a longer text changes it; without `minHeight` an
  `auto` frame declares no height and the reflow log stays silent.
- **Groups.** Boxes one under another are a `stack` group, not a chain of
  `below` anchors: the first frame's own placement says where the stack
  starts; the others need no `y`. A box that grows pushes the ones after it
  and the pictures and decoration anchored to them. A group with its own
  `placement`/`grid` box shares that box (`shrink` with `priority`, `grow`,
  `align`). Side by side: a `row` group (left to right, whole-millimetre
  width negotiation).
- **Pictures beside a box** are frames of their own, `layer: 2`, anchored
  to a corner of the box and not members of its group; keep the box's text
  clear with the box frame's `padding` on that side, or mark the picture
  frame `exclude: "push"` (rectangle) or `wrap: "contour"` (outline).
- **`pin: true`** on a frame or a decoration element keeps it where the
  template draws it, for a box that must stay on the artwork.
- **Fit** (1.36): `fit: { minScale: 0.9 }` (body text no lower than 0.9;
  0.925 for boxes whose type size matters), `fit.imageMinScale` (0.8)
  for pictures; `fit: { shrinkText: false }` keeps a box's type size. Do
  not shrink fonts per edition by hand: let the ladder do it and read the
  log.
- **Decoration** is laid after the frames and anchors to `#frame`; it never
  pushes text and is dropped from reflowable output, so no word of the book
  goes there.
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
  corner. A tab with rounded ends or a ring inside it: a `top-right` tab
  whose icon picture draws that end. A tab centred over a card has no
  setting: put it at `top-left` with `inset` and say so in the report.
- A box with a second topic title inside it: an `##` in the frame is
  listed by `:::toc` and the bookmarks, but its heading-style design (a
  tab, a band) is not drawn inside a frame until heading designs in frames
  land (#906): make the tabbed title its own frame with a callout style
  (`takes: "h2"` or `## Title {slot="titulo-2"}`), or use the box's tab.
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
  a callout style), and draw the connectors as decoration `rule` elements
  anchored to the frames (`#raiz`, `#primario`), which follow them when a
  box grows.
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
- Not on vertical (`vertical-rl`) pages.

### 6.4 A labelled map

The source: a map with seas, countries and towns lettered on it, a legend.

1. Cut the map without its lettering. With PyMuPDF: redact the text spans
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
  off the page.
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
  source (1.5–3 mm is usual).
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
- Continuing is the ladder's last step: the frame first grows to
  `maxHeight`, its pictures and text are set smaller as `fit` allows; then
  it is cut at its foot with the mark, its text goes back to full size and
  the rest goes on in the frame of the same name on a page added right
  after (else the flow frame).
- `overflow.mark`: a string («sigue»), `false`, or unset (the style's
  `continuesMarker`, in the document's language). A "continued from" mark:
  `repeatTitle: true` on the style (title + `continuedSuffix`).
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
templates.append({"id": "articulo", "frames": [
    {"name": "titular", "takes": "h1", "style": "titular", "grid": {"col": 1, "row": 1, "cols": 3}},
    {"name": "col-1", "flow": True, "next": "col-2", "grid": {"col": 1, "row": 2, "rows": 8}},
    {"name": "col-2", "next": "col-3", "grid": {"col": 2, "row": 2, "rows": 8}},
    {"name": "col-3", "grid": {"col": 3, "row": 2, "rows": 8}, "overflow": {"continueIn": "template:salto"}},
    {"name": "cita", "style": "cita", "exclude": "push", "layer": 2, "grid": {"col": 2, "row": 4, "cols": 2, "rows": 2}},
    {"name": "foto", "exclude": "push", "layer": 2, "grid": {"col": 1, "row": 7, "rows": 3}},
], "grid": {"columns": 3, "rows": 9, "columnGap": mm(5), "rowGap": mm(2)}})
templates.append({"id": "salto", "frames": [{"name": "col-3", "flow": True, "columns": 3}]})
```

```md
::::page{template="articulo"}
# El río que cambió de curso

El texto entero del artículo…

:::frame{slot="cita"}
«Nadie recordaba el agua tan alta.»
:::

::resource{id="crecida" slot="foto"}
::::
```

- `next` threads the story through frames of the same page, re-broken at
  each frame's width, with nothing lost or repeated; the frames of a chain
  carry no continuation mark. A pull quote and a photo with
  `exclude: "push"` make the columns' lines short where they stand.
- The pull quote repeats words of the article: it is content, written in
  the Markdown, never in a template.
- The rest of the article goes on on a page added right after
  (`template:salto`). A jump to a page further on («continúa en la página
  47», after other articles) has no expression: continuation pages follow
  their page, and the mark takes no page number. Say so as a gap; set the
  rest of the article on the page right after, or in the flow.
- A chain inside a group measures its later frames empty when the group is
  solved: keep chained columns out of stack groups.

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
- `frameContinuationLimit` = 0.
- `contentInConfig` = 0 (and `preset_kit.py lint` clean: it counts page
  templates' decoration and running heads too).
- No `templateUnknown`, `slotUnknown`, `pageFenceLength`, `spreadMismatch`,
  `unclosedContainer`, no template config warning (`frameStyleUnknown`,
  `frameAnchorUnknown`, `frameMinMax`, `frameChainLoop`,
  `overflowTargetUnknown`…), no `labelAnchorUnknown`, no `tocGroupSplit`.
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
  `maxHeight`, `next`, `overflow`), never the factor.

Then:

- **The reflow log** (`postext check`, one `reflow p. N (template): …`
  line per page; `--json` `reflow[]`): on the source's own text it should be
  empty or small. A box that grew on the original text means its drawn
  `minHeight` is too small for the book's fonts: take the logged `toMm` if
  the source box was that tall. Report `text at 92.5 %` lines per edition.
- **Page images** of every edition against the source (`postext build …
  --watch`, `compare_pages.py`); for a spread, render both pages and join
  them.
- **Source map** (1.36): every frame's text maps back to the Markdown
  (`sourceAt`, `elementsForSource`; the Sandbox's `sandbox_inspect_point`
  answers with `elements` and their `source`). Nothing on a composed page
  should answer with a `config` source except decoration and running heads.
- In the Sandbox: Content mode (Alt+Shift+M switches) to correct text on
  the page, Design mode for templates and styles; a red outline «N mm
  short» is a frame that does not fit, an amber «text at 85 %» a frame the
  ladder shrank.

## 8. One bundle for every edition

- `chapters.<lang>` per edition in one `preset.json`; the same page fences
  in the same order, the same slot names and the same anchors in every
  edition, so frame ids (`cp<n>:<frame>`) and label ids line up.
- `localized.<lang>.config` only for what the language changes (locale,
  labels, hyphenation, faces); templates and the library are shared. A
  template that must differ in one language (a box made wider for German)
  is a sign the template is too tight: raise `maxHeight` or the ladder's
  limits for all.
- `localized.<lang>.name` (and `description`) for each edition's title.
- Labels' words are in each edition's Markdown; anchors on the shared
  resource. Pictures with lettering per language (avoid them) go through
  `localized.<lang>.resources`.
- `preset_kit.py pack my-book --manifest-only`, then `postext check
  my-book.postext --locale <lang>` and `composed_check.py check
  my-book.postext` on the packed file.

## 9. Ports made with round 1 or with postext 1.33

- **A 1.33 port** that drew whole pages as text elements of heading styles
  (one hidden style per page): from the release that ships #874,
  `moveTextToMarkdown` rewrites it. In the Sandbox: Checks › «Move the text
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
  Fix by hand what it leaves: letter spacing of a text, a text's own box or
  stroke, heading designs inside a frame, texts anchored to the running
  head's container or to another element, texts mixing words and
  placeholders.
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

- Heading designs (tabbed or banded titles) are not drawn inside frames
  until #906 lands: a tabbed title is its own styled frame.
- Tabs are square and stand at a top corner, start or end; no centred tab.
- Rows run left to right in every writing direction; spreads not on
  vertical pages; a frame's `writingMode`/`direction` and a template's
  `bodyStyle`/`palette` are read but not applied yet.
- `'auto'` width reads as `'fill'`.
- A continuation goes on right after its page, and its mark takes no page
  number.
- Text on both sides of a contour in the middle of a measure is not set.
