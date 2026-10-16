# Composed pages: design (P1, drnachio/postext#847)

Status: proposal for approval. Programme tracker: drnachio/postext#846.
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
  takes?: 'h1'|'h2'|…|'h6'      // receives the first heading of that level with no slot
  pin?: boolean                 // never moves or resizes (aligned with artwork)
  grow?: number, shrink?: number, priority?: number   // group negotiation (§5)
  fit?: { shrinkText?: boolean, minScale?: number, scaleImages?: boolean, imageMinScale?: number }
  overflow?: { continueIn?: string, mark?: string | false }
  writingMode?, direction?      // as the page; for a vertical box on a horizontal page
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
`minHeight`/`maxHeight`; `'auto'` width is not allowed for text frames (a text frame needs a
measure) and means "the picture's width at the frame's height" for a frame holding a single
resource. `'fill'` takes what is left up to the anchor's edge (as in design slots).

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
- Until P4, the layout sets a composed page's content in the flow, in Markdown order, on pages of its
  own (the page fence breaks the page as `:::paper` does; `build.ts`, `pendingComposedBreak`).

The layout emits (VDT):

- `VDTPage.composed: VDTComposedPage { template, variant, spread?, frames: VDTFrame[], decoration:
  VDTDesignSlot, log: ReflowEvent[], fenceIndex, sourceStart, sourceEnd }`.
- `VDTFrame { id, name, rect, rotate, layer, styleId, scale, overflowPx, continuedFrom?,
  continuesTo?, blockIds, configPath }`. The frame's box and its children are ordinary callout
  blocks in `page.floats` and `doc.blocks` (with `containerId = frame id`), so canvas, PDF
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
6. **Continue** (§5.6) when `overflow.continueIn` is set.
7. **Warn** `frameOverflow`. The content that does not fit is clipped at the frame's edge on paged
   output (it is never dropped from reflowable output, the source map, or the warning).

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
template with only that frame filled), or `'template:<id>'`. The remaining content resumes from
the `CalloutCut` cursor, re-broken at the new width. Marks: `overflow.mark` text (string, or the
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
confirmed config change (U8).

## 6. Source map contract

Every painted thing knows its origin:

- Body text laid into frames: the usual `sourceStart`/`sourceEnd`/`sourceMap` per block and line
  (absolute offsets in the chapter file).
- Frames: `configPath` of the template frame and `sourceStart/End` of the slot's content.
- Labels: source range of the `::label` text and `resourceId#anchorId`.
- Decoration and header/footer elements: their config path (`/pageTemplates/3/decoration/elements/1`).
- Text produced by `{attr.x}`: the attribute's source range in the page fence (`attrSources`).
- Contents entries: the heading they come from.

Stable ids: a frame is `cp<fenceIndex>:<slot>` (plus `~<n>` for the n-th continuation piece); a
label is `cp<fenceIndex>:<slot>:label:<anchor>`; same id in every locale and across relayouts.

Relayout scope: the composed page's layout is memoised by (resolved template, slot content,
fonts, locale, page parity); an edit inside one page re-sets that page (and its continuations).
Budget (P16): < 100 ms for a property change on one page, < 300 ms with reflow.

## 7. Comics

`:::page{split}`, `::panel` and lettering keep their parser and layout unchanged in this
programme. P12 (later) re-implements them on templates: each split cell becomes a generated frame
holding the panel art, lettering stays positioned by the comics code. Every comics fixture and
Cookbook comics recipe must render unchanged before and after.

## 8. HTML and EPUB

- Reflowable HTML/EPUB: reading order is Markdown order. A composed page becomes a `<section>` in
  which each frame is a block with its callout style, in source order (not template order).
  Decoration is dropped (or kept as decorative images). A figure's labels become accessible text:
  a visually hidden list after the image, in label order.
- Fixed-layout EPUB and the HTML viewer: the template is applied (they render the paged VDT).
- Tagged PDF: structure order follows the Markdown (`contentIndex`), not paint order.

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
<tr><td>Pushes other frames' text</td><td><code>exclude: 'push'</code>, rectangular, as <code>wrap</code> today; contours in P11.</td></tr>
<tr><td>Flow frame and chaining</td><td><code>flow</code>, <code>next</code>, <code>overflow.continueIn</code>.</td></tr>
<tr><td>Fence syntax vs comics</td><td>Four-colon <code>::::page{template}</code>; <code>:::page{split}</code> unchanged (§3.1).</td></tr>
<tr><td>Geometry in Markdown?</td><td>Never; only <code>at="x% y%"</code> as a label fallback.</td></tr>
<tr><td>Determinism</td><td>Fixed ladder order and step sizes, template-order ties (§5.4).</td></tr>
<tr><td>Scope of a change</td><td>Its page or spread, plus continuation pages (§5.4, §6).</td></tr>
<tr><td>Rotation</td><td>Any angle per frame (content and box), drawn with a matrix in every backend as comic balloons are.</td></tr>
<tr><td>Comics</td><td>Unchanged now, generated frames later (P12).</td></tr>
</table>

## 11. Issue map

P2 #853 config types/validation (§2) · P3 #854 parser (§3) · P4 #855 layout (§5.1–5.2, frames,
decoration, backends) · P14 #856 groups (§5.3, log) · P16 #857 source map and page-scoped relayout
(§6) · P5 #858 ladder and warnings (§5.4, §5.7) · P15 #859 continuation (§5.6) · P6 #860 anchors
and labels (§2.6, §3.3) · P7 #861 spreads (§2.1) · P9 #862 HTML/EPUB (§8) · P11 #883 contours ·
P12 #885 comics on frames (§7).
