# Composed pages: design (P1, drnachio/postext#847)

Status: approved (P1); §5.8–§5.12 record what P4, P14, P7, P5 and P15 built. Programme tracker: drnachio/postext#846.
Draft types: [`types.ts`](./types.ts) (no runtime effect).

A composed page is a page whose form is a **template** (named frames, groups, decoration) held in
the configuration, and whose content is the Markdown between a `::::page` fence, poured into the
frames by **slot** name. Geometry never appears in the Markdown; content text never appears in the
configuration.

## 1. Vocabulary

<table>
<tr><th>Term</th><th>Lives in</th><th>What it is</th></tr>
<tr><td>template</td><td>config <code>pageTemplates[]</code></td><td>A named page (or spread) layout: frames, groups, decoration, header/footer, variants.</td></tr>
<tr><td>frame</td><td>template <code>frames[]</code></td><td>A named rectangle that receives typeset content. Has position, size rules, style, layer, fitting and continuation.</td></tr>
<tr><td>group</td><td>template <code>groups[]</code></td><td>A <code>stack</code> or <code>row</code> of frames that share space and move together.</td></tr>
<tr><td>decoration</td><td>template <code>decoration</code></td><td>A design slot of images, rules and boxes (no content text) painted with the page.</td></tr>
<tr><td>slot</td><td>Markdown</td><td>The name a piece of content asks for. Matches a frame name.</td></tr>
<tr><td>flow frame</td><td>template</td><td>The frame that receives content with no slot.</td></tr>
<tr><td>label</td><td>Markdown <code>::label</code></td><td>A short text set at a named anchor of a picture (maps, diagrams).</td></tr>
<tr><td>anchor</td><td>resource <code>anchors[]</code></td><td>A point (and optional box) on a picture, in fractions, shared by every locale.</td></tr>
</table>

## 2. Configuration

### 2.1 Templates (`pageTemplates`)

```ts
pageTemplates: PageTemplate[]
```

- `id` (required, unique), `name` (UI only).
- `extends`: id of a template whose fields this one inherits. Merge is by key: scalar fields
  replace (`header`/`footer` whole); `grid` merges key by key; `frames` and `groups` merge **by
  name** (a frame with the same name overrides the fields it writes, `fit`/`overflow`/`padding`
  key by key and `placement` whole; `remove: true` drops it; new names are appended);
  `decoration.elements` merge by element `id` (new ids appended). `spread`, `gutter` and `role` are
  inherited; `id`, `name`, `extends` are not. Cycles are an error (`templateExtendsCycle`) and the
  template is dropped, with every template that extends into the loop. The first template with an
  id is the one it means (`templateDuplicate` for the others).
- `area`: the rectangle frame coordinates refer to: `'content'` (default, the page's content area,
  mirrored per parity like the flow), `'trim'` or `'bleed'`.
- `grid` (optional): `{ columns, rows, columnGap, rowGap }` dividing `area`; frames may then be
  placed by cell (`grid: { col, row, cols, rows }`, 1-based) instead of `placement`.
- `frames`, `groups`, `decoration`.
- `header` / `footer`: a design slot, `false` to hide, unset to inherit the running section's.
- `variants`: `{ recto?: TemplatePatch, verso?: TemplatePatch }`. The patch merges like `extends`
  on the page of that parity, after the whole `extends` chain, the root's variant first; a spread
  takes no variant. (Parity is the physical side, so left-to-right and right-to-left books
  both work.)
- `spread: true`: the template describes a sheet of two facing pages. `area` spans both pages;
  `gutter` gives the spine band frames must respect or may cross (`crossGutter: true` on a frame).
  A spread template always starts on a verso (left page in LTR, right page in RTL books), adding a
  parity blank like `breakToEvenPage` does for comic spreads.
- `overflowTemplate`: id of the template used for pages added by continuation (§5.6). Default: the
  same template with only the frames named in `overflow.continueIn` filled.
- `bodyStyle`, `palette`: as heading styles have them, applied to the page.
- `role`: page role reported to design slots (`pages` filters); default `'composed'`.

### 2.2 Frames

```ts
interface FrameConfig {
  name: string                  // slot name; unique per template
  placement?: ElementPlacement  // anchor/offset/size language of design slots
  grid?: { col, row, cols?, rows? }
  width?:  FrameSize            // Dimension | '%' of area | 'auto' | 'fill'
  height?: FrameSize
  minWidth?, maxWidth?, minHeight?, maxHeight?: Dimension
  style?: string                // a calloutStyles id (see 2.4); unset = frameless
  layer?: number                // paint order; default 1; decoration is 0; negative = below
  rotate?: number               // degrees, content and frame rotate together (P4)
  verticalAlign?: 'top' | 'middle' | 'bottom' | 'justify'
  columns?: number, columnGap?: Dimension
  padding?: CalloutPaddingConfig   // overrides the style's
  exclude?: 'none' | 'push'     // 'push': other frames' text wraps around this frame
  flow?: boolean                // receives content with no slot
  next?: string                 // chain: overflow continues in this frame
  takes?: 'h1'|'h2'|…|'h6'|'toc' // receives the first heading of that level with no slot, or the page's :::toc (#983)
  pin?: boolean                 // never moves or resizes (aligned with artwork)
  grow?: number, shrink?: number, priority?: number   // group negotiation (§5)
  fit?: { shrinkText?: boolean, minScale?: number, scaleImages?: boolean, imageMinScale?: number,
          preferContinue?: boolean }   // continue before 3 and 5 of the ladder (§5.4), default true
  overflow?: { continueIn?: string, mark?: string | false }
  writingMode?, direction?      // as the page; for a vertical box on a horizontal page (#944, §5.15)
  optional?: boolean            // no slotEmpty warning
  crossGutter?: boolean         // on a spread: may cross the spine band
  remove?: boolean              // in a patch: drop the inherited frame
}
```

Position, in order of precedence: `grid` cell, then `placement`. `placement.anchor.to` may be
`'#otherFrame'` with the element-to-element edges design slots already know (`right-of`, `below`,
`align-top`…), so a frame can hang off another and move with it. Without either, a frame takes the
whole `area`.

Size: a `Dimension` is fixed. `'auto'` height (the default) is the content's height, clamped to
`minHeight`/`maxHeight`; `'auto'` width (#982, §5.18) is the width of the content's longest line plus
the padding, up to the room the anchor leaves and `maxWidth`. `'fill'` takes what is left up to the anchor's edge (as in design slots).

`takes` exists so the page title of a textbook topic is just `# Title` at the top of the page
fence: no slot attribute needed.

### 2.3 Groups

```ts
interface FrameGroupConfig {
  name: string
  kind?: 'stack' | 'row'     // default 'stack'
  frames?: string[]          // order = order on the page (top→bottom, start→end)
  gap?: Dimension
  placement?, grid?          // the group's own box; default: union of its frames' declared boxes
  align?: 'start' | 'center' | 'end' | 'space-between'   // where spare space goes
}
```

A frame belongs to at most one group. A group's name is distinct from every frame name (anchors
name both as `'#name'`). Inside a group the frames' own `placement` y (stack) or x
(row) is ignored: the group lays them out in order with `gap`. A group is itself a box that other
frames may anchor to (`'#group'`).

### 2.4 Frame styles

Decision: **frames reuse callout styles** (`calloutStyles[]`). A callout style already draws
everything the textbook boxes need: background, border, radius, padding, stripe, icon, the label
tab (`label`, with position and icon), title style, marker column, column gap. A new style family
would duplicate all of it and the Sandbox editors. The Sandbox's "frame-style library" (U5) is the
callout-style library filtered to styles used by templates, with usage counts.

Per-instance text such as a tab's words comes from the Markdown: `:::frame{slot="dinero"
label="El dinero"}` (or `title=`), exactly as for `:::callout`. A style's `title` default is a
whitelisted literal for `contentInConfig` only when it is one or two words.

Properties a callout style has that do not apply to frames (`placement`, `span`, `columns`,
`sideAtColumnEnd`, `floatBarrier`, `fixed`, `width`) are ignored when the style dresses a frame.

### 2.5 Decoration

`decoration: DesignSlot` with image, rule and box elements, and text elements whose content is only
placeholders (`{pageNumber}`, `{chapterTitle}`, `{attr.x}`) or whitelisted literals. Elements may
anchor to `'#frameName'` and then move with the frame (P14). Decoration is laid out **after** the
frames, with the frames' final boxes known; it never pushes text. `pin` on a decoration element
keeps it where the template says even if its anchor frame moves.

### 2.6 Resource anchors

`Resource.anchors` (comics, #557) gains label fields; existing comic anchors keep working:

```ts
interface ResourceAnchor {
  id: string; x: number; y: number          // fractions of the picture, top-left origin
  head?, face?                              // comics, unchanged
  width?: number                            // label measure, fraction of the picture width
  align?: 'start' | 'center' | 'end'        // label position relative to (x, y)
  verticalAlign?: 'top' | 'middle' | 'bottom'
  rotate?: number                           // degrees
  style?: string                            // a labelStyles id
}
```

`labelStyles[]` (new, small): `{ id, paragraphStyle?, fontFamily?, fontSize?, fontWeight?,
fontStyle?, color?, textTransform?, letterSpacing?, halo?: { color, width }, background?,
padding?, minScale? }`. Anchors survive crops (`safeArea`) and splitter-free figure scaling because
they are fractions of the picture, mapped through the crop as `comicArtPointToPage` does.

### 2.7 Contents groups

Specified in #850: `toc.groups = { keepTogether, head: 'part' | 1…6, minEntriesAfterHead,
continuation: { enabled, mark } }`, `:::toc{keep="part" levels="1-2"}`. Independent of templates.

### 2.8 Checks (#849, not part of P2)

`checks.contentInConfig = { enabled?, allow?: string[], maxWords?: 2, maxChars?: 24 }` (#849).
Literals allowed without warning: per element at most `maxWords` words and `maxChars` characters
after removing placeholders (scripts without spaces: characters only); anything in `allow`; and,
when the check has the content, literals equal to the document's title, author or publisher
metadata. So: book title, publisher name and one- or two-word running heads ("Índice",
"Capítulo {chapterNumber}") pass; sentences fail.

### 2.9 Validation

The engine ignores unknown keys elsewhere; for `pageTemplates` it validates and warns (config
warnings, shown by `postext check` and the Sandbox): `templateDuplicate`, `templateExtendsCycle`,
`templateExtendsUnknown`, `frameDuplicate`, `frameStyleUnknown`, `frameAnchorUnknown` (anchor to a
frame or group that does not exist, or a cycle of anchors), `frameMinMax` (min > max, fixed size
outside min/max), `groupFrameUnknown`, `groupFrameTwice`, `frameChainLoop` (`next` cycle),
`overflowTargetUnknown`, `labelStyleUnknown`. Every warning carries the config path as a JSON
pointer: the entry for a duplicate (`/pageTemplates/3/frames/2`), the field at fault otherwise
(`/pageTemplates/3/frames/2/style`, `/pageTemplates/3/variants/recto/frames/0/next`), in the
template that wrote the field when it was inherited; `labelStyleUnknown` points into the resources
(`/resources/4/anchors/0/style`, with `resourceId`). `frameAnchorUnknown` also covers decoration
elements anchored to nothing the template has. Unknown keys and words of templates, frames, groups,
grids, `fit`, `overflow`, variants and label styles give `unknownConfigKey`/`unknownConfigValue`.
`resolvePageTemplate` applies the same fixes the warnings describe (anchor → `'container'`, broken
`next`/`continueIn` dropped, unknown group members skipped, unknown style → frameless), so the
layout never meets a dangling reference; min/max contradictions are left to the layout (min wins,
a fixed size is clamped).

`configVersion` goes from 14 to 15. Nothing older changes meaning, so the migration is a no-op;
the bump marks bundles that may hold templates so an older reader can warn.

## 3. Markdown

### 3.1 The page fence

```md
::::page{template="tema-cajas"}
…content…
::::
```

- **Four colons.** The parser learns fence lengths for this one directive: a line `::::page{…}`
  (four or more colons) opens a composed page container; the closing line is a bare fence of the
  **same** number of colons. Inside, three-colon containers (`:::frame`, `:::callout`,
  `:::figure`, `:::columns`…) open and close as today. A bare `:::` can never close the page.
- `:::page{split}` (three colons) stays the comics page with its raw body, byte for byte as today.
  A three-colon `:::page` carrying `template=` gets the warning `pageFenceLength` ("a composed page
  needs four colons") and is parsed as before (comics), so nothing silently changes meaning.
- Attributes: `template` (required), `spread` (flag; must match the template's `spread`), `id`
  (for `:ref`), and any other attribute, readable as `{attr.x}` by the template's decoration and
  header/footer (a page background chosen per page: `resourceId: "{attr.fondo}"`).
- A composed page always starts a new page (or spread). Content after `::::` resumes the normal
  flow on a new page.

### 3.2 Slots

```md
:::frame{slot="dinero" label="El dinero"}
Es el instrumento utilizado como medio de pago…
:::
```

- `:::frame{slot}` is a container holding full Markdown: paragraphs, lists, headings, chips,
  `::resource`, `:ref`, footnotes, `:::columns`, nested callouts.
- `slot="…"` on any single block (`## Heading {slot="title"}`, `::resource{id="x" slot="foto"}`,
  a fence's attributes) sends that block alone.
- Several pieces with the same slot concatenate in Markdown order.
- Content with no slot goes to the flow frame; a heading of level N with no slot goes to the frame
  that `takes` it, if any, before falling to the flow frame.
- A slot that the template does not have: `slotUnknown`, and the content goes to the flow frame
  (or, with no flow frame, is laid after the page in the normal flow so it is never lost).
- A frame of the template that receives nothing: `slotEmpty` (info level; a frame may be optional:
  `optional: true` on the frame silences it).

### 3.3 Figures with labels

```md
:::figure{resource="mapa-europa" slot="mapa"}
::label[OCÉANO ATLÁNTICO]{at="atlantico" style="mar"}
::label[Madrid]{at="madrid"}
::label[Mar Negro]{at="62% 48%"}
:::
```

- `:::figure` places one resource (its caption and numbering as `::resource` today) and sets each
  `::label` at its anchor; `at="x% y%"` is the fallback when no anchor exists.
- `style` overrides the anchor's label style. Text is ordinary inline Markdown (bold, chips).
- Outside composed pages `:::figure` works in the flow too, as a resource with labels.
- Warnings: `labelAnchorUnknown` (label names an anchor the resource lacks), `anchorUnlabelled`
  (info: an anchor with a style but no label in this locale).

### 3.4 Example: textbook p. 8

```md
::::page{template="tema-cajas" fondo="banda-retos"}
# La actividad económica y el dinero

## La actividad económica

Las personas utilizan :chip[recursos]{style="clave"} que se obtienen de la naturaleza…

- Las :chip[empresas.]{style="clave"} Ofrecen bienes y servicios a cambio de un beneficio.
- Las :chip[personas y familias.]{style="clave"} Adquieren lo que ofrecen las empresas…

:::frame{slot="dinero" label="El dinero"}
Es el instrumento utilizado como medio de pago, ya que su valor es conocido…

Hasta hace pocos años, lo más normal, era pagar con dinero en **efectivo**…
:::

::resource{id="dinero-pago" slot="dinero-fotos"}

:::frame{slot="gasto" label="El gasto"}
El dinero que utilizan las personas para satisfacer sus necesidades…

- **Fijo:** es el que se produce todos los meses…
- **Variable:** puede cambiar según las necesidades…
- **Inesperado:** se producen por situaciones imprevistas…
:::

::resource{id="gasto-compras" slot="gasto-fotos"}

:::frame{slot="ahorro" label="Préstamos y ahorro"}
Si necesitas o quieres comprar algo muy caro…
:::

::resource{id="ahorro-balanza" slot="ahorro-fotos"}
::::
```

Template (config, no text):

```jsonc
{ "id": "tema-cajas", "area": "content",
  "decoration": { "elements": [ { "kind": "image", "id": "fondo", "resourceId": "{attr.fondo}",
      "decorative": true, "placement": { "anchor": { "to": "bleed", "edge": "top-left" },
      "size": { "width": "fill", "height": "fill" } } } ] },
  "frames": [
    { "name": "titulo", "takes": "h1", "style": "tab-titulo", "height": "auto" },
    { "name": "texto", "flow": true },
    { "name": "dinero", "style": "caja-azul", "padding": { "right": { "value": 62, "unit": "mm" } } },
    { "name": "dinero-fotos", "layer": 2, "width": { "value": 60, "unit": "mm" },
      "placement": { "anchor": { "to": "#dinero", "edge": "top-right" },
                     "offset": { "y": { "value": -4, "unit": "mm" } } } },
    { "name": "gasto", "style": "caja-verde", "padding": { "left": { "value": 80, "unit": "mm" } } },
    { "name": "gasto-fotos", "layer": 2, "width": { "value": 76, "unit": "mm" },
      "placement": { "anchor": { "to": "#gasto", "edge": "top-left" } } },
    { "name": "ahorro", "style": "caja-amarilla", "padding": { "right": { "value": 48, "unit": "mm" } } },
    { "name": "ahorro-fotos", "layer": 2, "width": { "value": 46, "unit": "mm" },
      "placement": { "anchor": { "to": "#ahorro", "edge": "right" } } } ],
  "groups": [ { "name": "pagina", "kind": "stack", "gap": { "value": 6, "unit": "mm" },
                "frames": ["titulo", "texto", "dinero", "gasto", "ahorro"],
                "align": "start" } ] }
```

When the Catalan text of `dinero` is two lines longer, `dinero` grows, `gasto` and `ahorro` move
down, their photos follow their anchors, and the reflow log says so. If the stack no longer fits
the page, the ladder of §5.4 runs.

### 3.5 What P6 built (#860)

- **Layout** (`composed/labels.ts`): `layOutFigureLabels(labels, parsed, rb, ctx)` runs where the
  figure's block is measured (`runMeasurement`, and `buildFloatBlock` for a floated figure), on
  bitmaps and SVGs. Each label gets `VDTFigureLabel.layout`: its point `(x, y)` in px from the body's
  top-left (the anchor's fractions of the whole picture through `bodySource`, `pictureToBody`), its
  `rotate`, its lines set as a caption is (`layoutLabelLines` in `resourceLayout.ts`: chips, marks,
  refs, maths; no hyphenation; `\\` breaks) in the label's own frame, its box, fonts, colour, halo,
  plate and fit scale. Kept relative to the body, so placement, frames, spreads and the memo move it
  for free; painters apply `figureLabelMatrix(layout, bodyX, bodyY)`.
- **Look** (`resolveLabelLook`): body text ← borrowed paragraph style ← label style; the label's
  `style` beats the anchor's. `fontStyle`/`textTransform` resolve to defaults in P2, so a borrowed
  paragraph style's italics and capitals hold unless the label style turns them on (it cannot turn
  them off). Line pitch 1.15 em, or the paragraph style's.
- **Fit**: wrap at `anchor.width × picture width`; the widest word sets a first scale, then 0.97
  steps while a word is still divided (`hyphenated && !hardHyphen`), down to `minScale`; `overflow`
  when it still does not fit. Without `width`, one line.
- **Alignment**: `start`/`end` in the label's direction (first strong letter); default centre /
  middle. Anchors shared by LTR and RTL editions read best centred above or below the point.
- **After the pages**: `stampFigureLabelRects(doc)` (after `orientLinesToFrames`) fills `rect` in
  the block's frame (quarter-turned blocks included); `orientResourceBlock` mirrors label layouts on
  RTL pages (`mirrorLabelLayout`); `labelGlyphAt` maps a point to the glyph for `sourceAt`;
  `figureLabelWarnings` gives `labelAnchorUnknown` / `anchorUnlabelled` with page and locale.
- **Outputs**: canvas and PDF paint labels in `renderResourceBlock` after the picture (halo: the
  same line painter through a stroking context on canvas, `ctx.textOutline` hollow strokes in PDF);
  HTML writes `<div class="pt-figure-label">` with a CSS matrix and `-webkit-text-stroke`. The
  `alt`/`Alt` keeps only undrawn labels (`undrawnLabels`); tagged PDF reads a `Div` with one `P`
  per drawn label after the `Figure` (`StructureFlow.figureLabelsElem`), halo and plate artifacts.
  Reflowable EPUB unchanged (hidden list). Folio uses the canvas.

## 4. Document nodes

The parser emits (as built in P3, #854):

- The page fence stays in the block stream as a `containerStart` / `containerEnd` pair of
  `containerName: 'composedPage'` (not in `KNOWN_CONTAINERS`, so `:::page` stays a comic page); the
  start marker carries `composedPage: ComposedPageFence { template, spread, attrs, attrSources,
  fenceIndex, colons }`, where `fenceIndex` is the page fence's ordinal in its chapter (stable across
  locales).
- Frame containers become `containerStart/End` of name `frame`. Every block that names a slot carries
  `ContentBlock.slot: { name, sourceStart, sourceEnd }` (a heading's `{slot}`, a `::resource{id slot}`,
  a code fence's or any `:::` container's, a `:::frame`'s).
- `composedPages(blocks)` (`composed/document.ts`, pure) gathers one `ParsedComposedPage` per fence —
  the `ComposedPageNode` of `types.ts` (`slots: Record<slot, blockIndex[]>` in Markdown order,
  `unassigned`) plus `slotSources`, `firstHeadings` (for `takes`), `fence` and `unclosed`. A frame's own
  markers are left out of its slot; a nested container goes whole (markers included) to the slot it
  names, else to `unassigned`. It reads any block array, so P4 calls it on its transformed
  `contentBlocks`.
- `:::figure` is not a container in the stream: it is read whole into one `resourceBlock`
  (`resourceId` = `resource`) with `figure: FigureInfo { attrs, attrSources, labels }`, so the flow
  sets it as `::resource` until P6. Each `FigureLabel` extends `FigureLabelNode` with `spans`,
  `sourceMap`, `textStart/End` and `attrSources`; `at` is `{ anchor }` or `{ x, y }` in fractions of
  the picture (from `at="62% 48%"`).
- Recovery: a page left open closes at the end of the text; a `::::page` met while one is open closes
  it there; the closing fence closes any container still open inside the page; each is reported as
  `unclosedContainer`. A closing fence of another colon count stays text. A `:::figure` whose `:::` is
  missing ends at its first line that is neither a label nor blank (`unclosedContainer`, name
  `figure`).
- Since P4 (#855) the layout sets a composed page on a page of its own from its template (§5.8). A
  page whose template is unknown is still set in the flow, in Markdown order, on pages of its own.

The layout emits (VDT):

- `VDTPage.composed: VDTComposedPage { template, variant, spread?, frames: VDTFrame[], decoration:
  VDTDesignSlot, log: ReflowEvent[], fenceIndex, sourceStart, sourceEnd }`.
- `VDTFrame { id, name, rect, rotate, layer, styleId, scale, overflowPx, continuedFrom?,
  continuesTo?, blockIds, configPath, sourceStart?, sourceEnd?, push? }`. The frame's box and its
  children are ordinary callout blocks in `page.floats` and `doc.blocks` (their `containerId` is the
  story's synthetic container, shared by the pieces of a chain; `blockIds` ties them to the frame), so canvas, PDF
  (tagging), HTML, EPUB and Sandbox caret mapping handle them without new painters; `VDTFrame`
  adds what only templates know (name, config path, scale, log).
- `VDTLabel` items on the figure block (text blocks with source maps, positioned on the page).

## 5. Layout

### 5.1 Where it runs

A new branch in the main block loop, next to the comic page branch: close the flow segment, take a
fresh page (a verso pair for a spread), set `page.role = 'composed'`, keep a single empty column so
column-wide machinery sees an empty page, lay the template, push frames and children to
`page.floats` / `doc.blocks`, then force a page break. Frames are **not** page columns: banding,
balancing, footnote areas and trailing caps keep assuming a page's columns are one chain.

The callout layouter (`makeCalloutLayouter`, `splitCalloutFragment`, `CalloutCut`) is the frame
typesetter: each frame's slot content is laid as a callout of the frame's style (or a frameless
synthetic style, as `:::columns` does) at the frame's inner width and cut at its height. P4 factors
these closures out of `placeDocumentPass` into `pipeline/frameLayout.ts` with an explicit pass
context, so composed pages do not grow `build.ts` further.

### 5.2 Order of work per page

1. Resolve the template (`extends`, variant for this parity, spread sheet).
2. Gather slot content; report `slotUnknown`, `slotEmpty`.
3. Resolve fixed geometry: grid cells, fixed placements, pinned frames, group boxes.
4. Measure each text frame's natural height at its width (`auto`), in **template order**.
5. Solve groups (§5.3), then frames anchored to other frames, in dependency order (anchors form a
   DAG; cycles were rejected by validation).
6. Run the reflow ladder for any frame whose content still does not fit (§5.4).
7. Typeset every frame for real (the measure of step 4 is reused when nothing changed), commit
   blocks, lay decoration with the final frame boxes, lay labels.
8. Record the reflow log and warnings.

### 5.3 Groups

Stack: members get their natural heights clamped to min/max, laid top to bottom with `gap`. If the
sum exceeds the group's height, frames with `shrink > 0` give back space in ascending `priority`
(ties: later frame first) down to their minimum — a frame given less than its content needs then
enters the ladder. Spare space goes to frames with `grow > 0` in proportion, else follows `align`.

Row: members get their declared widths. A member that overflows its height takes width from
`shrink > 0` siblings (ascending `priority`) whose own content still fits at the reduced width,
found by bisection on whole millimetres; `grow` distributes spare width. Row heights are the row
box's height (`auto`: the tallest member).

`pin: true` frames never move or resize; they act as obstacles the group flows around (a stack
skips the pinned frame's band).

### 5.4 The reflow ladder

For a frame whose content does not fit, stop at the first step that makes it fit:

1. **Free space** in the frame and its group (grow to `maxHeight`, take the group's spare space).
2. **Push siblings**: in a stack, frames below move down; `shrink` frames yield.
3. **Scale flexible images** in the frame and its group between 100 % and `fit.imageMinScale`
   (default 0.8), re-placing floats inside the frame.
4. **Redistribute within min/max**: lower other frames of the group towards their minimum; in a
   row, take width (§5.3).
5. **Shrink the frame's text** uniformly in steps of 2.5 % down to `fit.minScale` (default 0.9;
   `fit.shrinkText: false` disables). Font size, leading and spacing scale together; the frame
   records `scale`.
6. **Continue** (§5.6, §5.12) when `overflow.continueIn` sends content to another page.
7. **Warn** `frameOverflow`. The content that does not fit is clipped at the frame's edge on paged
   output (it is never dropped from reflowable output, the source map, or the warning).

A frame whose `overflow.continueIn` sends content to another page (`'next-page'`,
`'template:<id>'`, `'page:<id>'`) takes step 6 right after step 4, before 3 and 5 (#920,
`fit.preferContinue`, default true): free space, push, redistribute, continue, and only when it
cannot go on (the last page continuation may add, a receiver that takes none of it) smaller
pictures, then smaller text. A story set across pages keeps one size; a magazine's last page of an
article is not set smaller than the pages before it. `fit.preferContinue: false` keeps the order
above (shrink a few lines' worth, go on only when that is not enough).

The ladder is deterministic: same input, same output; steps are tried in this order with fixed
step sizes; ties break by template order. A change is confined to its page (or spread), except for
continuation, which also touches the pages it adds.

### 5.5 Reflow log

Each composed page records `ReflowEvent { frame, kind: 'grew' | 'moved' | 'resized' |
'imageScaled' | 'textScaled' | 'continued' | 'overflow', fromMm, toMm, scale?, cause?: frame }`,
exposed on `VDTComposedPage.log`, in `postext check --json`, and rendered by the Sandbox reflow
panel (U8): «dinero grew 8 mm; gasto moved down 8 mm; the photo is at 92 %».

### 5.6 Continuation

`overflow.continueIn`: `'#frame'` (another frame of the same page; equivalent to `next`),
`'next-page'` (the same frame on a following page built from `overflowTemplate`, or from the same
template with only that frame filled), `'template:<id>'`, or `'page:<id>'` (a jump, #917: a frame
of the later page fence `::::page{id="<id>"}`, past the pages between; `'page:<id>#<frame>'` names
the frame, and `<id>` may be `{attr.name}`, read from the sending fence, so one article template
serves every article: `continueIn: 'page:{attr.sigue}'` with `::::page{template="articulo"
sigue="p47"}`). The remaining content resumes from
the `CalloutCut` cursor, re-broken at the new width. A frame is cut as the running text is (#913,
`frameCutRules`, for `next` chains and continuation alike, and since #942 for a
`keepTogether: false` box of the running text too): a heading never ends a piece
(`headings.keepWithNext`), a cut between the items of a list leaves two items on each side
(`bodyText.avoidOrphansInLists` / `avoidWidowsInLists`; one when off), and a list of up to
`bodyText.shortListMaxItems` items under `shortListSplit: 'avoid'` is not cut between items. When
no cut allows it the piece ends before the heading or the list, or inside one of its items. Marks: `overflow.mark` text (string, or the
localized default from the engine's continuation words, as tables' `continuesLines` uses: es
«sigue», en «continued», …; `false` for none), set at the end of the cut piece. Added pages keep
page numbering, running heads and parity rules (they are ordinary pages with `role:
'composed'`). Reflowable HTML/EPUB keep the content in one piece.

### 5.7 Warnings

<table>
<tr><th>Kind</th><th>Data</th><th>Fix proposals</th></tr>
<tr><td><code>frameOverflow</code></td><td>page, template, frame, locale, overflow mm, steps tried, final scale</td><td>allow more shrink (<code>fit.minScale</code>), raise <code>maxHeight</code>, lower a sibling's <code>minHeight</code>, continue on the next page, use another template, shorten the text</td></tr>
<tr><td><code>slotUnknown</code></td><td>page, template, slot, source range</td><td>rename the slot, add a frame</td></tr>
<tr><td><code>slotEmpty</code></td><td>page, template, frame</td><td>write content, mark the frame <code>optional</code></td></tr>
<tr><td><code>templateUnknown</code></td><td>page, template id, source range</td><td>pick an existing template</td></tr>
<tr><td><code>pageFenceLength</code></td><td>source range</td><td>use four colons</td></tr>
<tr><td><code>labelAnchorUnknown</code> / <code>anchorUnlabelled</code></td><td>resource, anchor, page, locale</td><td>add the anchor / the label</td></tr>
<tr><td><code>contentInConfig</code></td><td>owner path, element paths, chars, sample</td><td>move the text to the Markdown</td></tr>
<tr><td><code>tocGroupSplit</code></td><td>group head, page</td><td>shorten the group, change levels</td></tr>
</table>

Each proposal is data (`{ kind, path, value }`) so the Sandbox can offer it as a one-click,
confirmed config change (U8). What P5 built is in §5.11.

### 5.8 What P4 built (#855)

Recorded where the implementation settles a point the sections above leave open, or departs from them.

- **Stories.** Before layout, `composed/wrap.ts` regroups a page's content into one frameless box
  (`:::callout` of the synthetic style `__postext-frame`) per *story*: the content of a frame and of
  the frames its chain continues into (`next`, or `overflow.continueIn: '#frame'`, read the same),
  in chain order, each frame's pieces in Markdown order. The box typesetter (`pipeline/frameLayout.ts`,
  factored out of `placeDocumentPass` with no change for callouts) sets a story at each frame's width
  and cuts it at its height (`CalloutCut`); a later frame of the chain re-breaks the cut paragraph at
  its own width. The regrouping reads the template without a side's variant (takes, flow frame,
  chains, `columns`); a frame only a variant has keeps a story of its own, and on a side whose
  variant lacks it that story is set in the flow after the page.
- **Reading order.** Stories follow each other in the order of their first block, which is the
  `contentIndex` order: a frame is read whole, in the order its content first appears in the
  Markdown (flow text written after a box is read with the flow frame, before the box). Tagged PDF
  keeps this order whatever the layers paint (`readFloat` takes a read index).
- **Geometry** (`composed/geometry.ts`). A frame with no grid cell and no placement starts at the
  area's top-left, as wide as the area; its height follows its rule (`'auto'`, the default: the
  content's height; `'fill'`: the area's). An `'auto'` height never runs past the edge of the area
  (or trim, bleed) the frame grows towards; what does not fit there overflows the frame. A nine-point
  edge on another frame (`top-right` of `#dinero`) reads that point of its box. `'auto'` width reads
  as `'fill'` (the picture-width rule is left to P14). A group with no box of its own is the union of
  its frames' boxes; its frames keep their own placement until P14 negotiates them.
- **Order of work.** Frames are placed and filled in dependency order (anchors, then the frame a
  chain comes from), frames that push text as early as their anchors allow. When any frame pushes,
  the page is composed twice: the second run starts with every pushing frame's box from the first,
  so a box runs round a photo anchored to it.
- **Content no frame takes** (no flow frame) and stories whose frame is missing are set in the flow
  on the page after the composed page, never dropped. A `::resource` a story holds is set in its
  frame and does not float; a `:ref` in a frame to a picture set elsewhere floats from the page's end.
- **Decoration and running heads** are laid in `buildHeadersAndFooters`, on the sheet, after the
  frames: decoration elements may anchor to `'#frame'` (`DesignFrames.named`), text placeholders use
  the `'composed'` context kind, and `{attr.x}` reads the page fence's attributes before the chapter
  heading's (also in the running heads of that page). The decoration is `VDTComposedPage.decoration`,
  painted at layer 0.
- **VDT.** `VDTComposedPage` also carries `role`, `attrs`, `attrSources` (absolute) and `configPath`.
  A chained frame's box is the head's id plus `-cont-<n>` so tagged PDF and reflowable EPUB join the
  pieces; `VDTFrame.id` stays `cp<fence>:<name>`.
- **Overflow.** A frame that cannot hold its content and has no next frame lays it whole, draws its
  box at the frame's height, and records `overflowPx`; backends clip it to the frame. `frameOverflow`
  carries template, frame, fence index, overflow mm and the frame's config path (P5 adds the steps
  tried and the proposals); the page log gets an `overflow` event.
- **Not applied yet:** the template's `bodyStyle` and `palette`, a frame's `writingMode` and
  `direction`, `fit`, group negotiation with `grow`/`shrink`/`priority`/`pin` (P14, §5.9), `spread` (P7, §5.10),
  continuation to other pages (P15), labels (P6). A `exclude: 'push'` frame turned by `rotate` pushes
  with its turned box's bounds.

### 5.9 What P14 built (#856)

- **Declared and final boxes.** Each frame is placed twice in the same pass: as the template
  declares it (fixed sizes; an `'auto'` height at its `minHeight` when it has one, else at its
  content's height; anchors read declared boxes) and as its content needs. `VDTFrame.declaredRect`
  keeps the first when it differs. The reflow log is the difference between the two, so a page whose
  text fits the template's drawing logs nothing, and the same text gives the same log in any book.
  A frame with an `'auto'` height and no `minHeight` declares no height of its own: it never "grows",
  and the frames that follow it do not "move", whatever it holds. Templates drawn from a page give
  their boxes the drawn height as `minHeight`.
- **Order of work** (`composed/groups.ts`, `composedOrder`). A group is one step: after everything
  its frames and its own box anchor to, before anything anchored to the group or to one of its
  frames; its frames are filled in group order (a chain inside a group is measured with what its
  frame holds when the group is solved, so a later link of the chain measures empty).
- **A group with no box of its own** is elastic: a stack starts where its first frame's own
  placement puts it (members' own `y` is ignored, their `x` and width kept) and runs down as far as
  its frames need, to the foot of the template's area; only there do `shrink` frames yield. A row
  starts at its first frame, keeps its frames' widths and grows as tall as the tallest needs.
  Spare space, `grow` and `align` apply only to a group with its own box (`placement` or `grid`);
  a frame of such a group with no placement of its own takes the group's box as its area.
- **Stack.** Heights: fixed, or the content's (`'auto'`), clamped to min/max; `'fill'` asks for its
  `minHeight` and grows (weight `max(grow, 1)`). Too tall: frames with `shrink > 0` give space back,
  lowest `priority` first; frames of one priority yield **in proportion to `shrink`** (the number
  is a weight, not only a flag; §5.3's "later frame first" is not used), down to `minHeight`. When
  nothing more yields, no frame runs past the group's foot: its content overflows (`frameOverflow`,
  the ladder of P5). Spare space goes to `grow` frames in proportion, up to `maxHeight`, else to
  `align`.
- **Row.** Frames take their declared widths and the row's height (a fixed height keeps its own).
  A frame whose content runs past the row's height takes width from the spare space first, then
  from `shrink` siblings, lowest priority first, each down to the narrowest whole-millimetre width
  at which its own content still fits; the width a frame takes is the fewest whole millimetres that
  make it fit, found by bisection; when even all the room would not make it fit it takes none. Rows
  run left to right in every writing direction (right-to-left rows: later).
- **Pins.** A pinned frame takes its declared box (anchored to declared boxes) whatever its anchor
  or its group does. In a group, pinned frames and pinned frames outside the group whose box meets
  a frame across are obstacles: a stack sets the next frame past the pinned frame's band, a row past
  its column, `gap` kept on both sides; spare space then stays at the foot (no `align`).
- **Decoration.** Elements anchored to `'#frame'` move with the frame's final box (P4 already laid
  decoration after the frames); `pin: true` on a decoration element (new on design elements, read
  only by composed pages) anchors it to the frame's declared box (`DesignFrames.declared`).
- **Log.** `ReflowEvent` gains `axis: 'x'` for widths and moves across; `grew` / `resized` carry
  heights (or widths) in mm, `moved` the top (or left) edge in mm from the sheet's edge; the change
  is rounded once to 0.1 mm and events under 0.5 mm are not logged. `cause` is the nearest frame
  whose size changed among what the frame anchors to and the frames before it in its group, through
  frames that only moved. Events follow template order, each frame's size before its moves, its
  `overflow` last. Decoration moves are not logged (they follow their frame).
- **Surfaces.** `composedReflowLog(doc)` (per composed page: page index and label, template, fence,
  events, and `lines` in English from `describeReflowEvent`) is the data API for the Sandbox reflow
  panel (U8, #868); `postext check` prints one `reflow` line per page that has events and writes
  the entries under `reflow` in `--json`.
- **Confinement and determinism.** Nothing of a composed page's negotiation reads another page:
  boxes, logs and pages after it are unchanged by an edit on it as long as its content stays on it.
  Fixed iteration order, whole-millimetre widths and memoised measures give the same VDT for the same
  input.

### 5.10 Spreads (#861)

- **Where.** `placeComposedPage` (build.ts) resolves the template once as a sheet
  (`resolvePageTemplate(…, { spread: true })`); a `spread` template takes `breakToEvenPage`, the
  verso and the recto after it (one empty column each), as `placeComicSpread` does, and
  `layoutComposedSpread` (`composed/spread.ts`) lays it. The template decides; the fence's flag
  only feeds `spreadMismatch` (source check in `slotChecks.ts`, `spread` read through `extends`).
- **Sheet.** One `layoutComposedPage` run on spread coordinates: the first page's frame, the
  second's set `shift` (= the trim's width) along so the trims meet at the spine. The first page is
  the flow's left: the left page, or the right one on a mirrored (right-to-left) flow, whose frames
  are in flow coordinates; a right-bound left-to-right book starts the sheet on its left page, the
  recto. `content` is the union of both content areas (inner margins inside); `trim`/`bleed` run
  outer edge to outer edge, no bleed at the spine.
- **Gutter.** `ComposedPageInput.fitBox` (one hook in composedLayout.ts, `placeFitted`) gives
  `keepOffGutter`. It fits a frame's declared box and its final box alike (the band is the
  template's, not a reflow, so P14's log does not report it as one), and a group member's own box
  before the group negotiates (§5.9), so a stack on a spread lays its frames off the band;
  a frame without `crossGutter` that meets the band is cut at the band's edge (it reached across) or
  moved out whole (its inner edge was inside), on its centre's side (ties: the first page); an
  `'auto'` height is re-measured at the new width; the log gets `resized`/`moved` with cause
  `'gutter'`. A 0 gutter still keeps frames off the spine line.
- **Cut.** A frame goes to the page holding its bounds; a crossing frame is read on the page of its
  centre (ties: first page). The facing page gets a frame record with the same id, empty
  `blockIds` and `facingBlocks`: deep copies moved by `-shift`/`0`, ids `<id>-facing`, in no
  `page.floats` and no `doc.blocks`, so reflowable output, search, selection and source maps meet
  the text once. Blocks of frames on the second page are cloned before they are moved.
- **Paint.** `VDTComposedPage.sheetClip` (the page's bleed box) clips all of a spread page's frames
  and decoration (canvas, HTML `pt-sheet-clip`, PDF `re W n`); `composedPaintOrder` yields
  `facing: true` items, which the PDF tags as Layout artifacts and the HTML (written in reading order,
  §8) marks `aria-hidden`/`data-facing` and leaves out of the patchable blocks. Fixed EPUB adds `rendition:spread-both` to both pages; the
  page-spread side follows parity as before.
- **Decoration** is laid once (headerFooter.ts, on the first page of the pair met) over the
  physical sheet (left page at 0), `#frame` anchors read the frames' physical boxes
  (`flowRectToPage`, which also fixes `#frame` decoration on single right-to-left pages), then
  `splitSpreadDecoration` keeps the blocks that reach each page's bleed box, moved onto its sheet.
- **Vertical pages (#926):** the sheet is laid in the pages' flow frame, as single vertical
  composed pages are; the second page follows the first along the flow's y (`SpreadAxis` `'y'`:
  `spreadSheet`, `keepOffGutter` and `layoutComposedSpread` transpose), the physically right page
  first; trim and bleed are the flow frame's (`designFramesOn`). The decoration stays physical; its
  clip is the page's `sheetClip` mapped to the sheet (`composedSheetClipOnSheet`).
- **Not done:** frames with their own `writingMode` (a horizontal card on a vertical spread);
  per-side `mirrored` for frames' outer-corner icons (the first page's is used); running-head
  placeholders in a spread's decoration read the first page met.

### 5.11 What P5 built (#858)

- **Where the ladder runs.** In `layoutComposedPage` (`pipeline/composedLayout.ts`), around one
  laying out of the whole page (`composePage`, P4's and P14's work unchanged): a step is a *fit
  state* (frame patches, text scale per story, picture scale per story, groups that redistribute)
  and the page is composed again with it; compositions are memoised by state. Frames that overflow
  climb the ladder one by one in template order, each step adopted on top of the ones before it
  (a step that does not make the frame fit stays at its limit: less is cut), stopping at the first
  that makes it fit. A budget of 96 compositions per page bounds the work. Same input, same VDT;
  nothing reads another page.
- **Steps as built.** `free`: P14 already lets an `'auto'` height take the room its area and group
  leave, so the step adds only that a frame with a fixed `height` and a higher `maxHeight` grows up
  to it (patched to `'auto'` with its height as `minHeight`). `push`: part of every composition
  (groups move and yield, anchored frames follow); reported when the frame is in a group with
  others or something anchors to it. `scaleImages`: bitmaps, SVGs and video posters of the stories
  of the frame and of its group's frames are set at a share of their width
  (`CalloutLayoutInput.pictureScale` → `figureMaxBodyWidth`), largest 2.5 % step that fits down to
  `fit.imageMinScale`, found by checking the minimum and then bisecting; floats do not exist
  inside frames (P4 sets a frame's pictures inline), so "re-place floats" is the text after a
  picture moving up. `redistribute`: in the frame's group every unpinned frame yields (`shrink`
  read as 1 when 0) down to `max(minHeight, its content's need)`, never above its height; in a
  row they give width as in P14 (each down to the narrowest width its own text fits). `shrinkText`:
  only for a frame whose story sets text; the whole story (all frames of a chain) at one scale.
  `continue`: reported for `overflow.continueIn: 'next-page' | 'template:…'`; #859 lays it out.
- **Text scale is geometric.** A scaled frame's story is laid out at `width / scale` and
  `height / scale` and painted scaled by `scale` about the top-left of `rect`: `frameMatrix` now
  composes the scale before the turn, `frameContentRect` is the box in the blocks' own coordinates
  (backends clip to it). Font size, leading and every spacing shrink by exactly the same factor,
  whatever the content (tables, formulas, nested boxes). The frame's chrome keeps its drawn size
  (`keepChromeAt`: padding, border width, radius, stripe and tab dimensions laid out at
  `1 / scale`), so padding that keeps room for photos set over a box stays that room. Blocks of a
  scaled frame are in its laid-out coordinates: anything that reads block boxes directly instead of
  painting through `frameMatrix` (the Sandbox's caret and selection overlay, tagged PDF bounding
  boxes) sees them unscaled, as it sees a rotated frame's upright (follow-up). The source map
  (`sourceAt`, `elementsForSource`, `findElement`) reads them where they are painted: a point goes
  through the inverse of `frameMatrix` and is tested against `frameContentRect`, and the boxes it
  returns inside the frame are scaled back upright (the turn stays in `rotate`).
- **Spreads and the memo.** On a spread the ladder runs on the sheet: the gutter cut (`fitBox`)
  narrows a frame first and the ladder works from that box; a frame of the second page keeps its
  `scale` when it is moved onto its sheet. The gutter events come from the composition the ladder
  settles on (`ComposedPageLayout.fitted`), not from the ones it tried. The page memo keys the
  inputs the ladder reads (the resolved configuration holds the other templates and the locale), so
  a reused page equals a fresh one, scales and proposals' source ranges included.
- **Warning.** `frameOverflow` gains `locale`, `stepsTried`, `scale`, `imageScale`, `proposals`.
  Proposals are data with set-the-pointer semantics (`path` → `value`); a Markdown change carries a
  source range instead (`useTemplate`: the fence's `template` value; `shortenText`: the frame's
  content). Values are tried on the page where the page can tell: `allowShrink` (largest 2.5 % step
  down to 50 %, `also` turns `shrinkText` on), `raiseMax` (height + shortfall, whole mm; offered only
  when it fits), `lowerMin` (a group sibling at its minimum with less content, lowered by the
  shortfall, not below its content; offered when it fits), `useTemplate` (first other template, in
  `pageTemplates` order, with a frame of that name where the content fits as it is; the stories
  keep the page's own regrouping). `continueNextPage` and `shortenText` (lines over × characters of
  a full line) are not tried. `slotUnknown` names the flow frame that takes the content; slot
  warnings already carried page and source range after layout.
- **Log.** `imageScaled` (with `cause` when another frame's ladder set it) and `textScaled`
  events, per frame after its size and moves, before its `overflow`; words to the tenth of a
  percent.
### 5.12 What P11 built (#883)

- **Config.** `ResourcePlacement.wrap: 'contour'` (the picture at the side its `align` names) and
  `FrameConfig.wrap: 'box' | 'contour'` (with `exclude: 'push'`; `ResolvedFrame.wrap` is set only for
  `'contour'`). The shape is `Resource.contour`: `points` (polygon in picture fractions, wins),
  `alpha` (default on for bitmaps), `threshold` (0.5), `margin` (default: the wrap gap / push gap).
- **No pixels at layout time.** The layout knows pictures by size only, so the alpha channel comes
  with the resource as `contour.traced` (`ContourTrace`: up to 256 rows, leftmost/rightmost opaque
  edge per row, the file id and threshold it was traced at; a stale trace is ignored). Hosts trace:
  `traceResourceContour` (synchronous PNG decoding on fflate in every host, the browser decoder for
  other formats), `readBundle` (`traceBundleContours`, every bitmap when a frame wraps by contour),
  the Sandbox (`useContourTraces`, from the blob store). Bundles never store the trace.
- **Engine.** `contour/index.ts`: rows from polygon or trace (`contourRowsOf`), mapped to page px
  through `bodySource` (safe-area crop) and `bodyRect` (scale), turned on mirrored pages
  (`contourOnPage` → `VDTExclusionContour {spans, margin, quantum?}`), and per-line insets
  (`contourInsetSteps`: the extent of the spans within the margin of each line's band; a line clear
  of the shape gets none; CJK grid rounds to whole characters). The flow keeps its rectangular
  `VDTExclusion` (band, settling, epub) and adds `contour`; `wrapInsetSteps` reads it. Frames: the
  pushing frame's shape is `composed/contour.ts` `frameContour` over its laid children (pictures by
  shape, everything else by box); `exclusionsFor` passes it to `calloutLayout.exclusionInsets`,
  which keeps its side choice (the wider side free) and sets each line by the shape. With the
  reflow ladder (§5.11) the shape is the pictures as scaled (`fit.imageMinScale`), and a frame laid
  out at a text scale maps its shape to the page by that scale (`scaleContourAbout`, as
  `frameMatrix`), and the exclusions it receives back into its laid-out coordinates. The page memo
  (§6, #857) keys the pictures' resources whole, so `contour` and its trace are in the key. Two shapes on
  either side inset both sides; text on both sides of a shape in the middle of a measure (split
  lines) is not done.
- **Fallback.** A contour wrap with no known shape runs round the box with a `textWrap` warning,
  reason `noContour` (once per resource per pass). Without contours the VDT is unchanged (preset
  parity harness, 583 chapters, 0 diffs).

### 5.12 What P15 built (#859)

- **Where.** The ladder's step 6 (`layoutComposedPage`): a frame whose `overflow.continueIn` is
  `'next-page'` or `'template:<id>'` (`continuesOffPage`) and that still overflows after
  `shrinkText` is composed again with the frame in `FitState.goOn`: it is cut at its foot with
  `splitCalloutFragment` (as a `next` chain is), its story's text scale and the picture scale its
  own ladder set are dropped (the rest goes on, so shrinking gains nothing), and the cut
  (`CalloutCut`, the pieces laid and the head's block id) is handed back as
  `ComposedPageLayout.continuations`. No `frameOverflow` for it. `build.ts` (`placeComposedPage`)
  adds the pages: generation after generation, one page per target template (`continuationTarget`:
  `template:<id>`, else the page's `overflowTemplate`, else the same template *collapsed*), each a
  fresh page after the last one laid (a spread target opens on the next verso, `breakToEvenPage`),
  laid with `layoutComposedPage` and `ComposedPageInput.continuing` (no memo).
- **Receivers** (`composed/continuation.ts`, `assignReceivers`): the frame of the same name, else
  the flow frame, else the first frame free; a story threaded through a chain (the sending frame
  has a frame before it, `ComposedContinuation.head`) goes on where its chain starts: the frame of
  the chain head's name, else the flow frame, else the sending frame's name (#919), so a body
  template of three threaded columns that goes on into itself fills all three on every added page; a continuation that finds none waits for another page
  of the same target. A receiver starts its chain on the added page (`chainPrev` ignores links into
  it) and its story starts at the cut. `continuationTemplate` patches the added page's template:
  the last frame of each receiver's chain goes on with the rule that brought the content unless it
  sends content off the page itself; with `collapse` (the template laid again), every other frame is
  `'auto'` with no min/max and leaves its groups, so it takes no room; on the last generation
  (`MAX_CONTINUATION_PAGES`, 16) nothing goes on and a remaining overflow is reported as
  `frameContinuationLimit` instead of `frameOverflow`. A receiver that takes none of its content
  (the cut does not move) does not go on: the step is reverted and `frameOverflow` lists `continue`.
- **What the pages keep (#912).** A frame cut for another page gives its group's room first
  (it yields down to its minimum before any other frame), so the frames after it keep their size.
  Empty frames right after it in its stack (no story, not pinned: an answer space under an
  activity box, `trailingFrames`) go with the rest when it lands on the same template laid again:
  on the sending page they take no room, and on the added page they keep their size after the
  frame that takes the content (`ComposedContinuation.trailing`). A frame that takes no room is
  `VDTFrame.collapsed`, and decoration anchored to it (directly or through other elements) is not
  drawn. On a template laid again, a group whose first frame collapses starts its remaining frames
  where that frame was placed (`collapseFrames`), so the rest of a box does not land on the
  page's kicker. A frame none of whose content fits draws nothing and takes no room (it is laid with
  no height): the whole box goes on (its tab with it), never a tab and a mark over an empty piece.
  The empty frames go with the rest only when there is a rest: a frame that holds all its content
  once they leave keeps them after it, unless they then cannot keep their size under it, in which
  case the whole box goes on with them. A frame that can go on and squeezes the frames after it in
  its stack below their declared size (the stack reached the foot and its last frames were cut) is
  treated by the ladder as content that does not fit (`squeezes`).
- **Marks.** The frame cut for another page is laid in its style with `continuesMarkerEnabled` (the
  callout layouter's marker under a fragment that goes on): `overflow.mark` string, `false` (none),
  unset = the style's `continuesMarker`, resolved from `defaultTableContinuationStrings(locale)`
  (10 site locales and more). Same-page `next` chains carry none. The start of a continuation has
  no mark of its own: it is a `continuation` fragment (no tab, no title), and a style with
  `repeatTitle` repeats its title with `continuedSuffix`, which is the "continued from" mark.
- **VDT and ids.** Added pages are ordinary pages (`role: 'composed'`, numbered, running heads and
  decoration of their template and side, `{attr.x}` of the fence) with
  `VDTComposedPage.continuationOf` = the fence's own page. Frames there are `cp<n>:<name>~<k>` (k =
  generation); a receiver is named by the slot that first sent the content (`cp0:dinero~2`). Blocks
  go on as `<headBlockId>-cont-<pieces>` with the story's container id. The sending frame gets
  `continuesTo`, the receiver `continuedFrom`, and the sending page's log a `continued` event with
  `toPage` and `toFrame` (`composedReflowLog` words it with the page's printed number).
- **Memo.** A page with continuations is never kept (`layoutComposedPageMemo`), so it and its
  added pages are always laid together, fresh.
- **Reflowable / tagged.** The EPUB walk opens no section for a page with `continuationOf`: its
  blocks go on in the open stories (by container id), so the box is one frame and a cut paragraph
  one paragraph with the page break inside. Tagged PDF already joins by container id (one `Div`).

### 5.13 What the findings round E1 built (#912, #913, #917, #919, #920)

- **Ladder order (#920).** `fit.preferContinue` (default true): for a frame that can go on to
  another page the ladder runs free, push, redistribute, continue, then scaleImages and shrinkText
  (§5.4). The Sandbox template editor has the toggle.
- **Receivers (#919).** `ComposedContinuation.head`: a threaded story goes on where its chain
  starts (§5.12).
- **Cuts (#913).** `frameCutRules` in `splitCalloutFragment` for frames (§5.6).
- **What the pages keep (#912).** Yield-first, `trailingFrames`, `collapseFrames`,
  `VDTFrame.collapsed`, whole-box moves (§5.12).
- **Jumps (#917).** `continueInPage` / `resolveContinueIn` (`templates.ts`) read the target;
  `continuesOffPage` counts it, so it is the ladder's continue step. `build.ts`
  (`placeComposedPage`): `fenceById` maps the chapter's planned fences by their `id`; `route` keeps
  a jumping continuation in `jumps` until that fence is placed, or, when no fence of that id comes
  after the sending page, raises `continueTargetMissing` (WARNING_SINCE 1.37.0; `before` when the
  fence is earlier) and sends it on as `'next-page'`. The receiving fence is laid with its own
  stories plus the jumping ones (`assignJumpReceivers`: the frame `#<frame>` names, else the frame
  of the sending chain head's name, else the first frame its own content leaves empty) and
  `ComposedContinuationInput.jump`: its frames keep the fence's ids (`cp<n>:<name>`, no `~k`), the
  receiving chain's end goes on as `'next-page'` (pages added after it, numbered from it), and a
  story that finds no free frame goes on there too. Such a page is never memoised. The sending
  frame gets `continuesTo`, its page's log a `continued` event with the jump page; the EPUB walk
  and tagged PDF already join the pieces by container id.
- **Page numbers in marks (#917, #925, #915).** `overflow.mark` may hold `{page}` (the page the
  rest goes on on), and `overflow.fromMark` (new; the receiving frame's, else the sending frame's)
  sets words at the head of the first piece a frame lays of a story that came from another page,
  `{page}` being the page it comes from (`CalloutLayoutInput.continuedMark`, laid as the
  continuation marker is, pagination furniture). Both are laid out with a guessed number of the
  right width and tagged `VDTDesignTextBlock.pageMark`; once the pages are numbered `fillPageMarks`
  (`build.ts`) writes the printed label of the page `continuesTo` / `continuedFrom` points to and
  measures the lines again, keeping their alignment.

### 5.14 Findings round E2 (#882)
- **Empty frames in stacks (#911).** When the tiers have nothing more to give, a stack cuts its
  frames from the foot up, each down to `GroupItem.floor` (its `minHeight`; a fixed height without
  one keeps it), before any frame is clamped at the foot. A frame left below that least height
  overflows by the cut (`boxShort` → `VDTFrame.overflowPx`), content or none, and climbs the ladder
  and warns. Proposals skip empty frames for `lowerMin`, and give an empty frame its own `lowerMin`
  instead of `raiseMax`/`continueNextPage`.
- **Elastic rows (#927).** `rowH` is the tallest height the cards write (fixed, else `minHeight`);
  the content's only when none writes one. Widths are negotiated there, then the row grows.
- **Ruled frames (#914).** `composed/rules.ts`: rules on the box's `designOverlay` (laid-out
  coordinates, lengths over the text scale); an empty frame keeps them on `VDTFrame.rules` and the
  decoration step adds them (mapped through the flow, turned on vertical pages).
- **Drop caps in frames (#922).** A story box (`FRAME_ATTR`) is not a box for `placesOf`; the box
  typesetter stamps `VDTBlock.dropCap` and `offsetBlock` moves it.

### 5.15 Findings round G (#882)
- **Drop caps in frame chains (#947).** `splitCalloutFragment` ranks a cut before a drop cap's
  sink line (`VDTBlock.dropCap.sink` on the piece that holds the initial) last, after the soft cuts
  of wrapped code: the paragraph moves on whole as in the flow, and is cut there only when no other
  cut fits. `dropCapWarnings` reports such a piece (`split`) from the laid-out document, since a
  box's trial cuts leave no notes. `wrapComposedPages` stamps the flow story's box with
  `__capHeading` (the heading's `sourceStart`) when its first block is a paragraph that followed,
  in the Markdown, a heading a `takes` frame took; `headingBefore` (`dropCap.ts`) reads it, so that
  paragraph takes the level's drop cap.
- **`useTemplate` regroups (#937).** `fitsWithTemplate` lays the page with the other template as
  the build would: `regroupStories` keeps a story whose head names a frame of it, sends one a
  `takes` frame took to its frame that takes the same level, and the rest to its flow frame after
  its own content (merged boxes appended past the pass's content blocks, a derived
  `FrameLayoutPass` whose `measureCtxFor` reads the first story's index), then runs
  `layoutComposedPage` with its ladder. Proposed only when no frame overflows, every story is laid
  and nothing continues; never on a page continuation added.
- **Trial passes and the measurement memo (#953).** `trialPass` (`composedLayout.ts`) builds the
  pass a trial lays: appended story blocks copy the page's (`originOf`), and everything keyed by
  content index follows the copy: `paragraphContainers.byBlock` (`:::paragraphs` groups), heading
  prefixes and numbers, list metrics, the `contentBlocks` the drop cap and indent rules read, comic
  strips and heading designs; each story's box takes the measure context of the story it replaces
  and the trial keeps its own `dropCapNotes` / `joiningLetterSpacing`. `layoutComposedPage` gives
  every run a `MeasureMemo` (`pipeline/measureMemo.ts`) on its pass: `layoutCallout` asks it before
  `measureContentBlock` for a child at a width (key: context, style `body`/`lists`, block, width,
  paragraph-group style, writing mode and language state), replays the drop cap note and the
  joining-script mark of the first measure, and never keeps a figure or table. Dropped with the
  run, since `leftFlow` and the numbers are fixed only for it.
- **Box styles based on another (#905).** `CalloutStyleConfig.extends` (`defaults/calloutStyles.ts`:
  `inheritCalloutStyles` before resolving, objects merged key by key, colours and lengths whole,
  `id`/`name` never; `calloutStyleChain`; warnings `calloutStyleExtendsUnknown` /
  `calloutStyleExtendsCycle`, WARNING_SINCE 1.39.0). The frame-style library (§2.4) merging on the
  look keeps a style whose `:::callout` boxes stand elsewhere as a thin style (`extends` + its
  position fields, `placesToKeep`), so a book ends with one style per kind of box and no box moves.
- **Jump targets in the editor (#943).** The Sandbox template editor lists the book's page fences
  with an `id` as `page:<id>` targets and takes a typed `page:` value. Jumps across chapter files
  are not laid out (SP followup 943-rest: forward ids, carried story Markdown, chapter-qualified
  source map, numbering, book-level marks).

- **Sheet points on flow pages (#929).** A composed page's frames are laid in the page's flow
  frame (mirrored on a right-to-left page, turned on a vertical one); its decoration stands on the
  sheet. `sourceAt` takes sheet points and maps them with `pageToFlow` for the frames (the spread
  clip `sheetClip` read in the flow, the decoration's with `composedSheetClipOnSheet`). Every
  element whose `rect` is in the flow frame carries `flow: true` (`sourceAt`, `elementsForSource`,
  `findElement`; flow text of a vertical or right-to-left page too); `flowRectToPage` puts it on
  the sheet. Sandbox: `frameHit.ts` `sheetToFlow` / `flowBoxOnSheet`; the frame tools, the Design
  mode marks, the picked mark (flow matrix after the frame's turn), the selection's relocation
  and the template editor (pointer read in the flow, marks drawn through the flow's matrix) use
  them. The Cookbook's C40 probe clicks flagged boxes on the sheet.
- **Start and end edges (#936).** `AnchorEdge` gains `top-start`, `start`, `bottom-start`,
  `top-end`, `end`, `bottom-end`, `align-start`, `align-end` (`design/logicalEdges.ts`:
  `physicalEdge`, `physicalPlacement`). `LayoutContext.startRight` (set for slots laid on the
  sheet of a right-to-left or vertical page: running heads and a template's decoration, through
  `sheetExtras`) reads the start on the right and reverses the offset's `x`; frames (`anchorOn`),
  fixed boxes (`anchorBox`) and heading designs are laid in the flow, where the start is the left.
  So one decoration element follows the frames to the right of an Arabic page. Sandbox: the slot
  editor's Alignment list has Start / End and its edge lists the start and end sides.
- **Cover in vertical flows (#946).** `layoutImageElement` crops an upright picture (`DesignFrames.upright`)
  in its own upright frame (the box `boxH` × `boxW`) and maps the visible part back into the flow; the
  primitive keeps `upright` and `crop`. Canvas (`drawUprightInBox` + clip), HTML (the turned `<img>` at its
  uncropped size in an `overflow:hidden` box) and PDF (clip inside the quarter turn) paint it; preflight
  reads an upright picture's printed width as its box's height. Sandbox: the image editor's Focus point
  (`focusPoint.ts`: a click or the arrow keys; the window the crop keeps outlined, `comicArtCrop`).
- **Frames in their own writing mode and direction (#944).** `direction`: `wrapComposedPages` stamps the
  chain head's direction on the story box and on every block of the story that no `{dir}` of its own (or of a
  box round it) sets, so the box typesetter sets it against the page as a `{dir}` box. `writingMode` other
  than the page's flow (`composedLayout.ts` `ownMode`): the frame's box as placed is
  turned a quarter turn about its centre (`quarterTurnedRect`) and the story laid out in it under
  `withMeasureWritingMode`; `VDTFrame.writingMode`, `rotate` ± 90 on top of the frame's own
  (`frameModeTurn`), `rect` the turned box (`framePageRect` turns it back: decoration anchors, the template
  editor). An `'auto'` height is the least whose lines fit the box's width across (`turnedNaturalOf`,
  bisection to a px). Pushing frames do not wrap its text; empty frames' rules turn with it.
  `stampCentralBaselines` stamps `centralBaselines` / `dashAdvances` on a vertical frame. Canvas
  (`setVerticalPaint` per frame), PDF (`ctx.vertical` per frame, fonts collected with the frame's mode) and
  HTML (`vertical` paint options per frame) paint its text as a page of that mode does; the source map and
  the Sandbox's clicks read it through `frameMatrix`. (Round H, #960: see below.)
- **Comic text panels (#909).** On a vertical or right-to-left page a text panel is set in its frame
  (`comicTextPanelsSupported` is true for every document): `layoutComicTextFrames` maps the text area
  into the page's flow frame (`pageRectToFlow`), where the story is laid (set vertically on a vertical
  page); the comic's frame record stays on the sheet, and `comicFramePaintOrder` hands the backends the
  frame mapped into the flow (rect, polygon), painted inside the flow transform (canvas, PDF; the HTML
  writes it in a `pt-flow` box over its panel). `sourceAt` and the Sandbox's comic tools read its words
  through `pageToFlow`. A frameless text set from the top in a slanted cell takes the whole cell, each
  line set short by `slantExclusions` (contour exclusions per 2 px band, `edge` off the outline,
  `ComposedPageInput.frameExclusions`); with a box or `valign` middle/bottom it keeps `innerBox`.
  `::panel{text shrink}` lowers the frame's `fit.minScale` (`shrinkScale`: 0.5, or the value given,
  0.25–1). Tagged PDF: `comicStructure` makes a `Div` in the comic's `Div` at the text panel's place
  (`ComicTags.texts`); `StructureFlow.readInto` moves the frame's elements into it.
### 5.16 Findings round H (#882)

- **Comic text panels on strips and spreads, valign in slanted cells (#959).** Strips: the stories are done
  for the main loop from the start (`composedLaid`), and `placeStripTexts` lays them at the end of the pass
  (after `centrePageText`), where each strip block stands: `layoutStripTextFrames` moves the block's comic
  onto the sheet (`flowRectToPage` + `translateComicPage`, the panel sources copied with
  `copyComicPanelSources`), runs `layoutComicTextFrames` there, and writes the frames' results (`blockIds`,
  `overflowPx`, `scale`, warnings) back on the block's comic, whose `frames` array is replaced
  (`comicBlockOnSheet`'s memo checks it). A page-wide strip set where it stands is boxed by
  `wrapPageSpanEmbeds`, so `planComicTextPanels` hops the box's closing marker. Spreads: each half lays
  the text panels that have most of their width on it (`only`), off the 8 mm about the spine
  (`comicSpreadGutter` → `avoid`, a rectangular exclusion). Painting: `comicFramePaintOrder(page, comic)`
  and `composedFrameBlockIds` read the strips too; canvas and PDF paint a strip's panels, the flow
  frame's text frames, then its lettering in the strip loop after the flow (`comicHoldsText`); the HTML
  keys the over-panel markup by comic. `comicTextAncestors` and `sourceAt` answer for a strip's words
  before the strip block. Slanted cells: text set to the middle or the foot is laid with the slant moved
  by the room the alignment leaves above it (bisection on that shift, at most ten layouts, a layout kept
  only when every line lies inside the outline and none is empty); not settled → `innerBox`. Frames
  of a half are found by the panel's `index` (`comicPanelOfFrame`), not its place in `panels`.
- **Vertical frame on a right-to-left page (#960).** `ownMode` no longer excludes a mirrored page. The frame is
  laid out as on a left-to-right page (`mirroredIn(frame)` is false for its lines) and `VDTFrame.unmirrorX`
  holds the flow's mirror origin: `frameMatrix` then returns `mirror · matrix-of-the-box-mirrored-to-the-sheet ·
  move`, which, inside the page's mirrored flow, is a plain placement of the frame at the box the page shows
  (its first line at that box's right edge, running down). The backends paint such a frame without the flow's
  counter-flip (canvas `withoutMirroredPaint`, PDF `ctx.mirror` off for the frame, HTML class `pt-unmirrored` whose
  rules cancel `.pt-flow-mirrored`'s `scaleX(-1)` on runs and pictures); `orientLinesToFrames` leaves its blocks
  alone. Hit tests and the source map go through `frameMatrix` and need no change.
- **Pictures in a vertical frame of a horizontal page (#960).** The callout layouter takes `uprightMaxLength` (the
  frame's extent across its lines less padding, `uprightIn` in `composedLayout.ts`) and lays each resource child
  out upright (`ResourceLayoutInput.upright`, as a vertical page's flow does): counter-rotated against the frame's
  quarter turn, at most what is left of the box along the stacking axis (`uprightMaxLength` less the cursor and the
  gaps); `offsetResourceBlock` moves a rotated block's frame origin. A horizontal card on a vertical page already
  stands upright (the frame's −90° cancels the flow's turn); a frame in the page's own mode is unchanged. Pictures
  in the frames of a vertical page's own mode still turn with the flow (not touched).
- **Reflowable EPUB.** A frame with its own writing mode is a `div.pt-frame-vertical` / `pt-frame-horizontal` with
  `writing-mode` in the stylesheet and the length its lines run along (the page box's height or width) in em of
  the body text as `height` / `width` (`CalloutNode.frameMode`).
- **Chains of frames of different modes** work as they are: each piece is cut and laid out in its frame's mode
  (`frameModesChain.test.ts`). `framePageRect` is exported; the Cookbook probe reports the page's box of such a
  frame.

### 5.17 A story that jumps into a page of a later chapter file (#943)

A magazine kept as one chapter file per article jumps with `overflow.continueIn: 'page:<id>'` into the page
fence of a later file. One `buildDocument` call is one chapter, so the rest of the story crosses the call.

- **Forward ids.** `PostextContent.laterPageIds` (`id → chapter position`) comes from the host (`pageFenceIds`,
  `laterPageIdsOf`: the ids of the page fences whose template exists, of the chapters after each chapter). `route`
  (`build.ts`) sends a `page:<id>` that no fence of the chapter answers but `laterPageIds` has to
  `VDTDocument.pendingJumps` instead of `continueTargetMissing` and adds no `'next-page'` pages; the sending
  frame gets `continuesToChapter` and a `continued` event with `toChapter`. A host that passes nothing keeps
  every `page:<id>` inside the chapter, as before.
- **Carrying.** A `StoryJump` (`composed/carry.ts`) holds the story's box and children as the sender had them ready
  to lay (post-transform `ContentBlock`s, offsets of the sender's body), the `CalloutCut`, the continuation's
  fields, the heading numbers by position, the sender's ordered-list indents, the notes the story cites with their
  numbers and definitions, and `outline` when it refers to anchors. The host sets `chapter` (whose file the text is
  in; kept when a chapter hands a story on again) and `fromChapter` (who sent it) and gives it to the chapter with
  the page as `LayoutContinuation.jumps` (`buildBundle`: `incoming`; the Sandbox: the chapter layout record
  `ChapterLayout.jumps`, the planner, the chain and the canvas build from the documents).
- **Receiving.** `importJumps` copies the blocks past the chapter's own (`contentBlocks`), moves every source offset
  so that `offset + bodyOffset` is the offset in the sender's file, gives the containers ids of their own
  (`1_900_000_000+`), renames the notes (`~k~id`) and registers them in the chapter's note maps. `carriedPass`
  answers the lookups the box typesetter keys by content index for them: heading prefixes and numbers from the
  sender, ordered-list metrics and paragraph groups worked out again from the carried blocks alone, the
  context of the text (never a styled section's or a part's). The pre-passes of the chapter (numbering, floats,
  warnings, the main loop) never see them. The continuations wait in `jumps` for their fence exactly as an
  in-chapter jump's do (`assignJumpReceivers`, the page never memoised); the receiving chain goes on as `'next-page'`.
  A story whose page the chapter does not have raises `continueTargetMissing` with `fromChapter` and is not set.
- **Marks.** `resolveJumpMarks(docs)` (after the book is numbered) gives the sending frame `continuesTo`, fills the
  `continued` event's `toPage` / `toFrame` and writes the printed label of the page in the other chapter into the
  `{page}` marks (`pageMark`) of both frames, measuring the lines again as `fillPageMarks` does; idempotent. A
  chapter laid out on its own keeps the guessed number. `buildBundle` runs it; so do the Sandbox's chains.
- **Source.** `VDTBlock.sourceChapter` (and `VDTFrame.sourceChapter`) says whose file the offsets are in; the source
  map's `SourceRef.chapter` / `SourceElement.chapter` and the `chapterFile` / `chapter` / `ownChapter` options
  follow it. `VDTFrame.readIndex` makes a tagged PDF read a carried frame at its page. The reflowable EPUB and the
  HTML reading order read it in the chapter that has the page (its container ids are that chapter's own).
- **Book layout.** `buildBundle` keys a chapter on its `laterPageIds` (only for a chapter with a composed page,
  in a book whose templates name a `page:` target) and on the jumps it receives (they are in its continuation);
  `ChapterRecord.jumps` keeps what a chapter sent past a dropped document. The Sandbox planner adds `|j<hash>` /
  `|l<hash>` to the continuation key under the same conditions, so keys of other books are what they were.
- **Left out.** The sender's styled section or part typography does not reach the rest. (Index marks, anchors
  and headings written in the rest, and the editor selection over it, were left out here and are built in
  §5.18.)

### 5.18 Findings round I (#882)

- **Frame names by role (#979).** A drafted page names its frames by kind and order, a different box in the next
  template. `template_dedupe.py` renames them after the merge (`name_frames`): the callout style id for a box or a
  tab (the tab a style draws is already in the id, `box-light-blue-tab-white`), `picture`, `figure`,
  `caption-of-<picture>` for a text or box set `below` one, `<role>-in-<parent>` for a frame laid inside another,
  `rotated-text`, the flow `text` and the heading `title`. Content (a tab's `label` words) never enters a name. Names
  are the same in every template that has the role, a second one is numbered from 2, a child keeps the names of
  the template it extends, and a name that is not the positional `kind-N` form is left alone, so the pass is
  idempotent. The anchors, groups and the `slot="…"` of every page fence under `chapters/` follow. The Sandbox
  frame rename (`renameFrame`) now reaches the same family (`frameFamily`: the template that defines the frame and
  everything that extends it, siblings included) and rewrites the fences of every chapter on screen
  (`renameSlotChanges`) and of the other editions of a local project (`renameFrameInEdition`,
  `ProjectActions.renameFrameInEditions`, one `updateProject` transaction). A sample's bundle keeps its other
  editions read-only: only the edition open is renamed.
- **Image budget of a painted book (#985).** C20 stays at 0.9 MB for nine pages (+0.1 MB a page), failing at 1.4 MB.
  A recipe whose pages are paintings states the weight it means to publish in `capture.expect.imageMb` (above 0.9,
  at most 2): silent up to it, a failure past it, an info when it is not needed or 15 % too high; the card files take
  `capture.expect.cardKb` the same way. A budget that counted the painted area was rejected: the bytes of the
  rendered page, not the area, say what it weighs.
- **The contents in a frame (#983, #987).** `FrameConfig.takes` accepts `'toc'` besides `h1`…`h6`: the frame receives the
  rows of the page's `:::toc` that name no slot (`ParsedComposedPage.tocRows`, the directive before the contents are
  expanded, every row and the breaks between parts after; `takenBlocks` answers for both kinds of `takes` in `wrap.ts` and
  `slotChecks.ts`). A `:::toc` inside a `:::frame` needs no `takes`. The rows are children of the frame's story box, so the
  box typesetter lays them with `measureTocBlock` and stamps what the flow stamps (`tocBlockStamps`: `tocEntry` with the
  page it links to, `tocPart`), which was the whole of the defect: `buildHeadersAndFooters` drew the part rows of
  `page.columns` only, so a frame's part rows were empty lines, and the repeats of a block's head row (`toc.groups.continuation`),
  which the flow sets only at the head of a column that a cut block goes on in, were all set, one before every entry. Now
  (a) `placeChild` skips a continuation row unless it is the first row of the fragment, (b) `overlayTocPart` runs for the
  part rows of `page.floats` and of a spread's `facingBlocks` with the frame's page frames, (c) a cut between the rows of one
  block of the contents (`:::toc{keep}`) is offered only after its head (or the repeat of it) and `minEntriesAfterHead`
  entries, and ranks `soft` (taken when no other cut fits) when the whole block is no taller than the room, so a block that a
  frame holds goes whole to the added page, as the flow moves it to the next column; an entry is never cut inside its lines.
  The title of the contents is not listed because its heading style says `toc: false`, as in the flow. A page break between
  parts (`toc.parts.breakBefore`) goes with the rows and is ignored in a box, as every directive is. Memoisation: a page with
  contents rows is never memoised (`pageMemo` already says so for any `toc` block).
- **A ground under the contents (#987).** The ground is the template's decoration, which paints under the frames of the
  page and on every page the frame adds; no heading design is asked to paint across the sheet. A design element anchored to
  the bleed that runs down to the trim claims the column (the reserved height of a heading design counts every element
  without `reserve: false`); a document with such a design says so only in the docs: a warning would also fire on every
  cover whose design claims its page on purpose (`headingDesignCuts.ts` makes the same call), so the answer is the note in
  the reserved-height section and the `reserve` rows of the design tables.
- **Frames held at the foot of a card (#980).** No new key. A stack group with a box of the card's height, `grow: 1` (and
  `shrink`) on the frames above the held ones and a `minHeight` on the held ones is the held foot: spare space goes to the
  frames that grow, so a shorter text moves nothing below it; a longer one is squeezed by the ladder (`redistribute`, then
  `shrinkText`) with the held frames at their `minHeight`, and `frameOverflow` and the reflow log (`textScaled`,
  `overflow`) say what did not fit. A frame anchored to the container's foot instead cannot do this: nothing relates it to
  the frames above it, so the ladder never squeezes them for it and an overlap is not reported. `footHold.test.ts` pins both
  directions.

- **Label styles in the Sandbox (#969).** A Design section, `labelStyles` in the Figures & tables group
  (`LabelStylesSection`, registry id `labelStyles`, counted by `sectionHasOverrides` when the list is not
  empty), modelled on Mark styles: id (renamed on blur, never to a colliding one), name, then three
  sub-sections: type (borrowed paragraph style, face, size, weight, slant, colour, letter case, tracking), halo
  and plate, fit and layout (`minScale`, `writingMode`, `overlap`). No label style is built in, so the list
  starts empty and `Add label style` writes `{ id, name }`. A field left unset shows what it inherits (the
  borrowed paragraph style, else the body text); `fontStyle` and `textTransform` are three-way selects whose
  *Inherited* is "not written", which keeps `resolveLabelLook`'s rule (#955: `'normal'` / `'none'` written turn
  a borrowed style's slant or capitals off). Renaming an id does not rewrite the anchors and labels that name
  it, as for chip and mark styles: the Checks panel flags them (`labelStyleUnknown`) until corrected. The
  config tools needed no change: `labelStyles` was already a section of `sandbox_get_config` /
  `sandbox_set_config`, items named by `[id=…]`, and the "every setting" tests walk it.
- **`overlap: 'allow'` (#977).** `ResourceAnchor.overlap` and `LabelStyle.overlap` (`'check' | 'allow'`,
  default `'check'`). `figureLabelWarnings` passes `overlappingLabels` a flag per label (anchor's value over
  its style's, where the style is the label's own `style` else its anchor's); a pair is skipped when either of
  its labels is allowed, since the overlap is as much the other's as that label's. The label style's value is
  checked (`unknownConfigValue`) and `stripLabelStylesDefaults` drops `'check'`. The anchor editor has a
  Check / Allow control (one anchor and the ticked ones), and the WebMCP marks schema takes the field. What the
  issue asks of the extraction scripts (merge labels of the same text within 0.5 mm into one anchor) is the
  porting skill's: its notes say so.
- **Words per figure (#986): a warning, not a second model.** A resource is the unit of numbering, of `:ref`
  and of the list of figures, so two figures cannot carry different words for one resource without becoming
  two figures. The deliberate answer is the existing one (a second resource for the same file) plus
  `figureWordsShared`, raised by `collectContentWarnings` from `figureWordConflicts` (figureWords.ts): for a
  resource already worded by a figure of the chapter, a later figure whose `alt`, `caption` or `note` differs
  from the first's, or that the first left unsaid (and so is not shown either). A figure that repeats the
  first's words, or gives none, is quiet. The range is the first of the dropped words; the Sandbox files it
  under Figures.
- **Pictures in the frames of a vertical page (#971).** `uprightIn` (`composedLayout.ts`) hands the box
  typesetter `uprightMaxLength` for every frame whose effective mode is vertical: its own `writingMode`, else
  the page's. A frame in the page's own mode on a vertical page lies in the flow frame, which is turned the
  same quarter turn as a vertical frame on a horizontal page, so the same counter-rotation applies with the
  frame's extent across its lines (`laidH`) less padding. `naturalOf` (the height a frame needs, for placement
  and proposals) passes the flow's whole height as the room, since the frame's height is what it settles. A
  horizontal frame on a vertical page is turned against the flow and already stood upright; horizontal pages
  are unchanged. The VDT of a vertical composed page that holds a figure in a frame changes (the picture and
  caption no longer turn with the flow); no public preset or bundle chapter does, parity 0 diffs.
- **The reflow ladder reuses a frame's whole layout (#972).** Each step of the ladder composes the page again,
  and most frames come out of it as they went in. `pass.layoutMemo` (`pipeline/layoutMemo.ts`, made with the
  measurement memo in `layoutComposedPage` and dropped with it) answers `makeCalloutLayouter`'s `layoutRange`
  for a range laid out before: key = pass, measure context, story and its end, the box style by content (the
  ladder resolves the style again every composition: two equal styles are one key), the cut, width, frame id,
  continuation, mirroring, the frame's options (`boxHeight`, exclusions, picture scale, marks, upright length)
  and the measuring state (`measureStateKey`, shared with the measurement memo). A caller that moves the
  result (`fill`: `commitFrame` shifts it to the page) gets a private deep copy; the memo keeps a copy made
  before the first caller moved it. A caller that only reads (`peekRange`: the split probes, the natural height
  of a frame) gets the stored layout, which nobody changes. The copy preserves shared structure (units and
  children point at the same blocks) and what the layout keeps by identity, a block's end indent and a
  designed heading (`copyBlockEndIndent`, `copyDesignedBoxHeading`; a new layout-time registry keyed by VDT
  object must add a copier); a layout holding a comic page or an object that is not plain data is never kept.
  The writes a layout makes to the measure context (drop cap notes, joining-script marks) are recorded with the
  entry and replayed on a hit. `layoutMemoSwitch` turns it off for the test that lays a page both ways. Parity
  0 diffs; the heaviest composed chapter of the Cookbook (a magazine of threaded frames) lays out about 45 %
  faster.
- **Marks, anchors and headings written in the rest of a story that went to another chapter (#988).** The
  receiving chapter locates them (`locateCarriedOutline`, called from `withIndexMarks` once the pages are
  final): per carried story, the lines it laid for that story (offsets in the sender's file) answer, an index
  mark, an inline anchor or a heading is its own when a line holds the character or it lies inside the span the
  lines cover (what lies before is the sender's, laid by it). They go on `VDTDocument.carriedOutline`
  (`chapter`, `kind`, `sourceStart` in the sender's body, page), the anchors also as destinations on
  `doc.anchors` (`VDTAnchor.chapter`). The sending chapter's own location leaves out the lines of carried
  blocks (`sourceChapter`, they are another file's offsets), its anchors skip the marks of a sent story that
  none of its lines hold, and `outlineFromDoc` takes the heading blocks of a carried story out of the
  order its entries are matched with (the sent headings are matched by their source). `mergeCarriedOutline`
  puts the pages into the sender's entries by `(chapter, kind, sourceStart)`: `buildBundle` keeps
  `ChapterRecord.carried` (`carriedPlaces`) and merges before it assembles the book outline; the Sandbox
  planner keeps `ChapterLayout.carriedOutline` (and writes it in `layouts.json`) and merges in its
  `bookOutline`. Index, contents and references then read the page of the words. The Sandbox canvas paints the
  selection and the caret of the chapter being edited over the carried words on the later chapter's page
  (`drawOverlay` with `CarriedSelection`).

### 5.18 Findings round I (#882)

- **Tracking in a box's body (#974).** `CalloutBodyStyleConfig.letterSpacing` (em of the body size, negative
  tightens; absent when zero) rides on the derived `bodyText` of a box (`deriveCalloutResolvedConfig`), so
  `resolveBodyStyle` gives the body style a `letterSpacingPx` and paragraphs and list items are measured, stamped
  (`VDTBlock.letterSpacing`) and painted as a paragraph style's tracking is (#907). A paragraph in a
  `:::paragraphs` fence keeps its own style's tracking, code listings none. A frame takes it through its callout
  style; a frame's own override of it is the `look` of #976.
- **Removing an inherited decoration element (#975).** `decoration.elements` of a patch may hold
  `{ id, remove: true }` (`DecorationRemoval`): `mergePatch` drops the element of that `id` merged so far, parents
  first and a variant after the chain, as `remove: true` does for frames and groups. A removal naming nothing is
  silent (no warning kind); a new element of the same `id` may follow it. The Sandbox lists the inherited elements
  with a switch each and writes the removal in the scope being edited.
- **`width: 'auto'` on a frame (#982).** `placeBox` takes a `naturalWidth(room)` next to `natural(width)`; an `'auto'`
  width asks it (the grid cell's width, the area's, or the room from the anchor to the area's edge, less
  `maxWidth`) and clamps to `minWidth`/`maxWidth`. `naturalWidthOf` (`composedLayout.ts`) lays the frame's story
  out flush left at eight times the room, so that nothing wraps, and takes the right edge of the longest line
  (a picture by its box) plus what the box keeps to its right (`callout.innerRect`: padding, a right stripe), a
  quarter pixel over, capped at the room: text that does not fit wraps at the cap. The box starts at the edge its
  anchor names (`pinX`), so frames anchored to it follow, and a group member is placed the same way. Not for a
  frame in its own writing mode, nor for a frame with nothing to lay (width 0 up to `minWidth`). The Sandbox
  already offered *Its content* for width.

## 6. Source map contract

Every painted thing knows its origin:

- Body text laid into frames: the usual `sourceStart`/`sourceEnd`/`sourceMap` per block and line
  (absolute offsets in the chapter file).
- Frames: `configPath` of the template frame and `sourceStart/End` of the slot's content.
- Labels: source range of the `::label` text and `resourceId#anchorId`.
- Decoration and header/footer elements: their config path (`/pageTemplates/3/decoration/elements/1`).
- Text produced by `{attr.x}`: the attribute's source range in the page fence (`attrSources`).
- Contents entries: the heading they come from.

Stable ids: a frame is `cp<fenceIndex>:<slot>` (plus `~<n>` on the n-th page added by continuation, §5.12); a
label is `cp<fenceIndex>:<slot>:label:<anchor>`; same id in every locale and across relayouts.

Relayout scope: the composed page's layout is memoised by (resolved template, slot content,
fonts, locale, page parity); an edit inside one page re-sets that page (and its continuations).
Budget (P16): < 100 ms for a property change on one page, < 300 ms with reflow.

### 6.1 What P16 built (#857)

- **Query API** (`composed/sourceMap.ts`): `sourceAt(doc, page, x, y, { file })` returns the
  elements at a point innermost first (`text` → `line` → `block` → `box` → `frame` → `group` →
  `template`; `design` → `slot` → `template` for decoration and running heads), each with a
  stable `id`, a `source` (`markdown` | `config` | `attr` | `resource`), `content` (the Markdown a
  frame or page holds) and `rect`. Hit order follows paint order: running heads, then frames and
  decoration from the top layer down; a turned frame is hit in its upright box. Reverse:
  `elementsForSource(doc, start, end)`; `findElement(doc, id)`. Nothing is laid out: the API reads
  stamps.
- **Stamps added.** `VDTChip.sourceOffsets` (relative to the chip's `:`, so the rich cache stays
  valid), `containerAttrSources` on container fences carried to the story box so a frame's tab and
  title map to `label` / `title`; every design block gets `elementId`, and `configPath` where the
  slot's pointer is known (decoration through `decorationPaths`, template header/footer through
  the new `headerPath` / `footerPath`, `/headingStyles/<i>/header`, `/header`); `attr` on a text or
  image block that shows `{attr.x}`; `{attr.x}` in a composed page's running heads maps to the page
  fence; `OutlineEntry.headingSource` → `TocBlockInfo` → `tocEntry.headingSource` (body offsets,
  kept out of `outlineKey`); `FigureLabel.anchorRef` (`resourceId#anchorId`) and `FigureLabel.id`
  (`cp<n>:<slot>:label:<anchor>`, `@<k>` for a percent label) for P6.
- **Ids** (`composed/ids.ts`): `cp<n>`, `cp<n>:<frame>` (`~<k>` reserved for continuation pieces
  on later pages, #859), blocks `cp<n>:<frame>-c<k>`, `cp<n>:group:<name>`,
  `cp<n>:decoration|header|footer:<elementId>`. A chained piece on the same page keeps P4's
  `-cont-<k>` block id.
- **Memo** (`composed/pageMemo.ts`): `layoutComposedPageMemo` keys a page by a 64-bit digest of the
  resolved config (once per pass), the measurement generation, the resolved template, the fence
  index, the page's Markdown slice and blocks (offsets relative, container ids by order), the
  geometry rounded to 1e-6 px, the side's `mirrored`, and a pass context from `build.ts` (heading
  numbers, part, section, paragraph containers, boxes out of flow, the pictures' resources, types,
  numbers and floats). Pages with footnotes, refs, citations, contents, index or strips are not
  kept, nor pages whose layout left drop-cap or joining-script notes. A hit parses the stored JSON
  and moves source offsets, `contentIndex`, container ids (`calloutPath` too) and `pageIndex`. The
  digest is `VDTComposedPage.layoutKey`; `composedPagePaintKey(page)` adds what is laid round the
  frames, and the Sandbox canvas keeps the bitmap of a page whose paint key is unchanged.
- **After P7, P9, P14.** `VDTFigureLabel` carries `id`, `anchorRef` and an absolute `sourceMap`
  (and its `sourceStart`/`sourceEnd` are now absolute: `figureLabels(block, bodyOffset)`); a
  label with a `rect` (P6) answers `sourceAt` at level `label`. The half of a spread frame on the
  facing page (`facingBlocks`) answers with the read blocks' ids and `facing: true`; points outside
  `sheetClip` miss frames and decoration. Spreads are laid out afresh every time (no memo, no
  `layoutKey`): the sheet's two pages depend on each other. Groups come from the resolved
  template; the negotiation reads only the template and the page's content, both in the key.
- **Cost.** A warm composed page sets in about 1 ms (stub measure), so the memo saves about half
  of the composed-page work on a rebuild; the whole chapter build is dominated by the rest of the
  pipeline. Bench: `__bench__/composedPage.bench.test.ts`.

## 7. Comics

`:::page{split}`, `::panel` and lettering keep their parser and layout unchanged in this
programme. P12 (later) re-implements them on templates: each split cell becomes a generated frame
holding the panel art, lettering stays positioned by the comics code. Every comics fixture and
Cookbook comics recipe must render unchanged before and after.

### 7.1 What P12 built (#885)

- **The split generates frames** (`comics/frames.ts`, `comicFrameSpecs`). The cells of the split
  tree (`comicGeometry`, unchanged) in reading order, each with its panel's `pad` taken off, and
  each `inset` panel over the frame laid before it (layer 2; cells are layer 1), are the page's
  frames; `layoutComicFrame` builds each panel from its frame. Names: the panel's `id` when no
  frame before took it, else `p<k>` (k = place in panel order, from 1). Ids follow §6:
  `cm<n>` for the comic (`n` = the comic fence's ordinal in its chapter, `:::page` and `:::strip`
  counted together, stamped by the block parser as `ComicPageSource.fenceIndex`),
  `cm<n>:<name>` for a frame (also `VDTComicPanel.frameId`), `cm<n>:<name>:b<order>` for a balloon
  (`VDTComicBalloon.elementId`; `id` keeps its layout-order value for the Sandbox).
- **Decision: polygon on the frame.** `VDTFrame` gains `polygon?` (set only when the outline is
  not the box: a cell cut by a slanted line) and `panel?` (the index in `VDTComicPage.panels`,
  which marks a generated frame; its `configPath` is `''`). Content is clipped to the polygon in
  canvas, PDF and HTML; hit-testing reads it. The comic keeps `VDTComicPanel.polygon` for its own
  painters, so frames are a record beside the panels, not a second painter: `VDTComicPage.frames`
  (pages, spread halves and strips; `translateComicPage` moves them, a spread half rebuilds them
  from its cut panels with `comicFramesFor`). The comics VDT and the HTML of every existing comic
  are unchanged (harness: 125 comic chapters of the public presets and the Cookbook bundles, all
  locales, full page JSON with only the new keys ignored, 0 diffs; preset parity 583 chapters, 0
  diffs).
- **Text panels** (`comics/textPanels.ts`). `::panel{text}` makes the body Markdown
  (`ComicPanelSource.text`, no script items). The block parser reads each body with the same
  parser on a copy of the text blanked before the body (offsets stay absolute; `:::` lines in the
  body are blanked, since a comic's body ends at its first bare `:::`) and emits its blocks right
  after the comic directive, so outline, index marks, warnings and the flow fallback see ordinary
  blocks. `wrapComicTextPanels` (beside `wrapComposedPages`) puts each body in a story box of
  `FRAME_STYLE_ID` keyed `comic:<panel>`; the comic page branch of `build.ts` sets each story
  with `layoutComposedPage` over a one-frame template whose area is the panel's text area (the
  panel's box inside its border plus `comics.lettering.inset`, or the box itself with `box`; in a
  slanted cell the widest straight-sided box inside the polygon, `innerBox`),
  `valign` → `verticalAlign`; ids are renamed `cp<n>:` → `cm<n>:`; the blocks go to `page.floats`
  and `doc.blocks`, the frame record gets `blockIds`, `overflowPx`, `scale`. A `::resource` in a
  story does not float (the float plan treats the text plans as composed pages). Not wrapped, so
  set in the flow after the comic: comics inside a container (strips and spreads since #959, vertical and
  mirrored documents since #909; `comicTextPanelsSupported` is true for every document).
- **Paint order** (`comicPaintsUnderText`, `comicFramePaintOrder` in `composed/paint.ts`): on a
  comic page holding text frames the panels are painted before the flow, the text frames after
  the floats (their ids are in `composedFrameBlockIds`), the lettering after the flow; elsewhere
  the comic paints whole as before. The HTML writes each text frame inside the comic's markup
  after its panel's figure (`ComicHtmlPaint.overPanel`), `z-index:auto`. Tagged PDF reads a text
  frame as one float after the comic's `Div`; the reflowable EPUB reads it after the panels.
- **Box styles.** `::panel{box=<calloutStyle>}` maps the style's background, border colour and
  width and radius onto the panel (its own `border`/`bg` win); on a text panel the frame draws the
  box (frame style = that callout style) and the panel draws none. `VDTFrame.styleId` names it.
- **Warning** `comicPanelFrame` (`reason`: `unknownBox`, `textOverflow` (layout); `strip`, `spread` and
  `flow` were raised up to 1.39 and stay in the type for old reports; `panel` = source index).
- **Source map** (`comics/sourceMap.ts`, called from `sourceAt`, `elementsForSource`,
  `findElement`): balloon glyph (`text`) → balloon (`box`) → frame → comic (`template`); picture
  (`resource`) → frame → comic; a text panel's words answer through the flow path with the frame
  and the comic appended. Sandbox: `comicTextFrameAt` (frameHit.ts), text frames in
  `frameTools` (Content mode: click off words → caret at the text, double click → in-place
  edit), `panelArtAt` ignores a text panel's words. The template editor never sees comic frames
  (they are not in `page.composed`).
- **Not done:** the comic frames in the template editor's views. (Vertical and right-to-left pages, lines
  following a slanted edge, `shrink` and the tagged PDF's reading order: round G, §5.15; strips, spreads and
  text set to the middle or the foot of a slanted cell: #959.)

## 8. HTML and EPUB

- Reflowable HTML/EPUB: reading order is Markdown order. A composed page becomes a `<section>` in
  which each frame is a block with its callout style, in source order (not template order).
  Decoration is dropped (or kept as decorative images). A figure's labels become accessible text:
  a visually hidden list after the image, in label order.
- Fixed-layout EPUB and the HTML viewer: the template is applied (they render the paged VDT).
- Tagged PDF: structure order follows the Markdown (`contentIndex`), not paint order.

What P9 (#862) built:

- **Reading order** is `composedReadingOrder(composedPaintOrder(page))`: the decoration first, then the
  frames by the lowest content index of their blocks (a frame a chain continues into after the frame
  before it). The HTML viewer (and so the fixed-layout EPUB) writes frames in that order inside one
  stacking context (`pt-composed`, `z-index: 0`) and paints them by `z-index` = place in the paint
  order; tagged PDF reads each frame in one `readFloat` call (a list stays one `L`).
- **Reflowable EPUB**: `ComposedNode` (`<section class="pt-composed pt-composed-<template>">`, the page
  break first), each story a `CalloutNode` with `frame` (`<div class="pt-frame pt-frame-<name>">`, plus
  `pt-callout pt-callout-<style>` when the frame has a style); frame CSS only in books that have
  composed pages. Decoration dropped.
- **Labels** ride on the VDT as `ResolvedResourceBlock.labels` (`VDTFigureLabel`: text, at, style,
  source range). Reflowable EPUB: a visually hidden `<ul class="pt-figure-labels pt-hidden">` after the
  picture, no `aria-describedby` (read once). HTML `alt` and PDF `Alt`: `altWithLabels` (`Alt (A, B)`,
  `（A、B）` for CJK, `،` for Arabic).

## 9. Literals allowed in the config

The `contentInConfig` whitelist (§2.8): book title, author and publisher (from metadata or
`checks.contentInConfig.allow`), and per element at most two words / 24 characters after removing
placeholders. Decoration text elements follow the same rule.

## 10. Answers to the open questions of #847

<table>
<tr><th>Question</th><th>Answer</th></tr>
<tr><td>Frame style: callout styles or new?</td><td>Callout styles (§2.4).</td></tr>
<tr><td>Position units</td><td>mm (any <code>Dimension</code>), grid cells, or anchored to a frame/group (§2.2).</td></tr>
<tr><td>Variants</td><td><code>variants.recto/verso</code> patches; <code>spread</code> templates (§2.1).</td></tr>
<tr><td>Header/footer</td><td>Per template, inherit by default, <code>false</code> hides.</td></tr>
<tr><td>Decoration with text?</td><td>Only placeholders and whitelisted literals.</td></tr>
<tr><td>Pushes other frames' text</td><td><code>exclude: 'push'</code>, rectangular, as <code>wrap</code> today; by the pictures' contour with <code>wrap: 'contour'</code> (P11, §5.12).</td></tr>
<tr><td>Flow frame and chaining</td><td><code>flow</code>, <code>next</code>, <code>overflow.continueIn</code>.</td></tr>
<tr><td>Fence syntax vs comics</td><td>Four-colon <code>::::page{template}</code>; <code>:::page{split}</code> unchanged (§3.1).</td></tr>
<tr><td>Geometry in Markdown?</td><td>Never; only <code>at="x% y%"</code> as a label fallback.</td></tr>
<tr><td>Determinism</td><td>Fixed ladder order and step sizes, template-order ties (§5.4).</td></tr>
<tr><td>Scope of a change</td><td>Its page or spread, plus continuation pages (§5.4, §6).</td></tr>
<tr><td>Rotation</td><td>Any angle per frame (content and box), drawn with a matrix in every backend as comic balloons are.</td></tr>
<tr><td>Comics</td><td>The split generates frames; text panels and box styles (P12, §7.1).</td></tr>
</table>

## 11. Issue map

P2 #853 config types/validation (§2) · P3 #854 parser (§3) · P4 #855 layout (§5.1–5.2, frames,
decoration, backends) · P14 #856 groups (§5.3, log) · P16 #857 source map and page-scoped relayout
(§6) · P5 #858 ladder and warnings (§5.4, §5.7) · P15 #859 continuation (§5.6) · P6 #860 anchors
and labels (§2.6, §3.3) · P7 #861 spreads (§2.1) · P9 #862 HTML/EPUB (§8) · P11 #883 contours (§5.12) ·
P12 #885 comics on frames (§7, §7.1).
