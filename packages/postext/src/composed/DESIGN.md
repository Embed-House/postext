# Composed pages: design (P1, drnachio/postext#847)

Status: approved (P1); §5.8 records what P4 (#855) built. Programme tracker: drnachio/postext#846.
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
- **Not done:** spreads on vertical (`vertical-rl`) pages (the sheet is laid in physical
  boxes, the flow is rotated); per-side `mirrored` for frames' outer-corner icons (the first page's
  is used); running-head placeholders in a spread's decoration read the first page met.

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
  which keeps its side choice (the wider side free) and sets each line by the shape. Two shapes on
  either side inset both sides; text on both sides of a shape in the middle of a measure (split
  lines) is not done.
- **Fallback.** A contour wrap with no known shape runs round the box with a `textWrap` warning,
  reason `noContour` (once per resource per pass). Without contours the VDT is unchanged (preset
  parity harness, 583 chapters, 0 diffs).

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
<tr><td>Comics</td><td>Unchanged now, generated frames later (P12).</td></tr>
</table>

## 11. Issue map

P2 #853 config types/validation (§2) · P3 #854 parser (§3) · P4 #855 layout (§5.1–5.2, frames,
decoration, backends) · P14 #856 groups (§5.3, log) · P16 #857 source map and page-scoped relayout
(§6) · P5 #858 ladder and warnings (§5.4, §5.7) · P15 #859 continuation (§5.6) · P6 #860 anchors
and labels (§2.6, §3.3) · P7 #861 spreads (§2.1) · P9 #862 HTML/EPUB (§8) · P11 #883 contours (§5.12) ·
P12 #885 comics on frames (§7).
