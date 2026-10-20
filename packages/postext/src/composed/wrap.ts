/**
 * Composed pages in the block stream (#855, DESIGN §5.1): the content of
 * each `::::page{template}` fence regrouped into one synthetic box per
 * *story*, the text a frame (and the frames it chains to with `next`)
 * receives. The layout then sets each story with the box typesetter
 * (`pipeline/frameLayout.ts`) at its frames' widths, cut at their heights.
 *
 * A story is one contiguous `:::callout` of the frameless
 * {@link FRAME_STYLE_ID} style, so the callout plan, the measure caches and
 * `contentIndex` treat it like any box. Inside it the content keeps its
 * Markdown order; the stories of a page follow each other in the order of
 * their first block, which is the reading order of the page (tagged PDF,
 * reflowable output). The frame's real style is chosen at layout time.
 *
 * Which story a block joins is decided here, with the template as written
 * (its `extends` chain, without the variant of a side, unknown at this
 * point): a block's `slot` names its frame; the first heading of a level
 * that names no slot goes to the frame that `takes` it; any other block
 * with no slot, and content naming a slot the template lacks, goes to the
 * flow frame. With no flow frame that content stays outside the stories,
 * after them, and the layout sets it in the flow on the page after.
 */
import type { ContentBlock } from '../parse/types';
import type { CalloutStyleConfig } from '../types';
import { composedPages, takenBlocks, type ParsedComposedPage } from './document';
import { repeatInstance, repeatInstanceName, resolvePageTemplate, type PageTemplateSource } from './templates';
import { pageRepeats } from './repeat';
import { nextFrameOf } from './geometry';
import type { ResolvedFrame, ResolvedPageTemplate } from './types';

/** Style id of a story's box. Not a user style: no configuration can name
 *  it. A story whose frame is missing on its page (a variant dropped it)
 *  is set in the flow in this frameless box. */
export const FRAME_STYLE_ID = '__postext-frame';

/** `containerAttrs` key of a story's box: the name of its first frame. */
export const FRAME_ATTR = '__frame';
/** `containerAttrs` key of the flow frame's story box whose first paragraph
 *  followed, in the Markdown, a heading another frame `takes` (#947): the heading's
 *  `sourceStart`. The paragraph takes the drop cap of that heading's level
 *  as the first paragraph after it in the flow does. */
export const CAP_HEADING_ATTR = '__capHeading';

/** Container ids of the stories' boxes: past any id the parser hands out
 *  and clear of the other synthetic boxes'. */
const FRAME_CONTAINER_BASE = 1_800_000_000;
/** A frame's `:::columns` group: its story's id plus this. */
const COLUMNS_ID_OFFSET = 50_000_000;

/** The frames of a chain, from its head (`next` after `next`), each once. */
export function frameChain(template: ResolvedPageTemplate, head: string): ResolvedFrame[] {
  const byName = new Map(template.frames.map((f) => [f.name, f]));
  const out: ResolvedFrame[] = [];
  const seen = new Set<string>();
  for (let f = byName.get(head); f && !seen.has(f.name); f = nextFrameOf(f) !== undefined ? byName.get(nextFrameOf(f)!) : undefined) {
    seen.add(f.name);
    out.push(f);
  }
  return out;
}

/** The head of the chain frame `name` belongs to. */
export function chainHead(template: ResolvedPageTemplate, name: string): string {
  const prev = new Map<string, string>();
  for (const f of template.frames) {
    const n = nextFrameOf(f);
    if (n && !prev.has(n)) prev.set(n, f.name);
  }
  let at = name;
  const seen = new Set<string>([at]);
  for (let p = prev.get(at); p !== undefined && !seen.has(p); p = prev.get(at)) {
    seen.add(p);
    at = p;
  }
  return at;
}

/** The flow frame of a template: the frame with `flow` that no grid
 *  repeats (an instance takes its own item's content only, #1061). */
function flowFrameOf(template: ResolvedPageTemplate, repeated: ReadonlySet<string>): ResolvedFrame | undefined {
  return template.frames.find((f) => f.flow && !repeated.has(f.name));
}

/** Which story each slot of `page` goes to: the head of its frame's chain,
 *  or undefined for content left outside every story. */
function storyOf(template: ResolvedPageTemplate, variantNames: ReadonlySet<string>, repeated: ReadonlySet<string>) {
  const names = new Set(template.frames.map((f) => f.name));
  const flow = flowFrameOf(template, repeated);
  return (slot: string | undefined): string | undefined => {
    if (slot !== undefined && names.has(slot)) return chainHead(template, slot);
    // A frame only a variant has: its own story, set where that side has it.
    if (slot !== undefined && variantNames.has(slot)) return slot;
    return flow ? chainHead(template, flow.name) : undefined;
  };
}

/** Frame names only a variant of the template adds. */
function variantFrameNames(config: PageTemplateSource, id: string, base: ResolvedPageTemplate): Set<string> {
  const out = new Set<string>();
  const known = new Set(base.frames.map((f) => f.name));
  for (const parity of ['recto', 'verso'] as const) {
    const t = resolvePageTemplate(config, id, { parity });
    for (const f of t?.frames ?? []) if (!known.has(f.name)) out.add(f.name);
  }
  return out;
}

/**
 * `blocks` with the content of every composed page of a known template
 * regrouped into its stories (see the module comment). A page whose
 * template is unknown keeps its blocks as they are: its content is set in
 * the flow (`templateUnknown`). The same array comes back when nothing
 * changes.
 */
export function wrapComposedPages(
  blocks: readonly ContentBlock[],
  config: PageTemplateSource | undefined,
): { blocks: ContentBlock[]; wrapped: boolean } {
  const pages = composedPages(blocks);
  if (pages.length === 0 || !config?.pageTemplates) return { blocks: blocks as ContentBlock[], wrapped: false };
  const out: ContentBlock[] = [];
  let at = 0;
  let wrapped = 0;
  for (const page of pages) {
    const template = resolvePageTemplate(config, page.template);
    if (!template) continue;
    const start = blocks.findIndex((b, i) => i >= at && b.type === 'containerStart' && b.containerName === 'composedPage' && b.composedPage?.fenceIndex === page.fenceIndex);
    if (start < 0) continue;
    const end = endOf(blocks, start);
    for (let i = at; i <= start; i++) out.push(blocks[i]!);
    const regrouped = regroupPage(blocks, page, template, variantFrameNames(config, page.template, template), () => FRAME_CONTAINER_BASE + wrapped++);
    out.push(...regrouped);
    out.push(blocks[end]!);
    at = end + 1;
  }
  if (wrapped === 0 && at === 0) return { blocks: blocks as ContentBlock[], wrapped: false };
  for (let i = at; i < blocks.length; i++) out.push(blocks[i]!);
  return { blocks: out, wrapped: wrapped > 0 };
}

/** Index of the marker closing the container opened at `start`. */
function endOf(blocks: readonly ContentBlock[], start: number): number {
  const id = blocks[start]!.containerId;
  for (let k = start + 1; k < blocks.length; k++) {
    const b = blocks[k]!;
    if (b.type === 'containerEnd' && b.containerId === id) return k;
  }
  return blocks.length - 1;
}

/** The blocks between a page's fences, regrouped: its stories (each a box
 *  of the frame style), then what no story takes. */
function regroupPage(
  blocks: readonly ContentBlock[],
  page: ParsedComposedPage,
  template: ResolvedPageTemplate,
  variantNames: ReadonlySet<string>,
  nextId: () => number,
): ContentBlock[] {
  const repeats = pageRepeats(page, template);
  const story = storyOf(template, variantNames, repeats.repeated);
  /** Pieces per frame name (a frame's own content), in Markdown order. */
  const pieces = new Map<string, number[]>();
  const loose: number[] = [];
  const put = (frame: string | undefined, indices: readonly number[]): void => {
    if (frame === undefined) {
      loose.push(...indices);
      return;
    }
    const list = pieces.get(frame) ?? [];
    list.push(...indices);
    pieces.set(frame, list);
  };
  const names = new Set(template.frames.map((f) => f.name));
  const flow = flowFrameOf(template, repeats.repeated)?.name;
  const taken = new Map<number, string>();
  for (const f of template.frames) {
    if (repeats.repeated.has(f.name)) continue;
    for (const idx of takenBlocks(page, f.takes)) if (!taken.has(idx)) taken.set(idx, f.name);
  }
  for (const [slot, indices] of Object.entries(page.slots)) {
    // A grid's frames take their content item by item (#1061).
    if (repeats.repeated.has(slot)) continue;
    put(names.has(slot) || variantNames.has(slot) ? slot : flow, indices);
  }
  /** The `:::frame` fence each instance's content came in (#1061). */
  const instanceFences = new Map<string, number>();
  for (const item of repeats.items) {
    for (const [f, indices] of item.frames) {
      const name = repeatInstanceName(f, item.item);
      put(name, indices);
      const fence = item.fences.get(f);
      if (fence !== undefined) instanceFences.set(name, fence);
    }
  }
  // Items past a grid's `max` go where content naming no frame goes.
  for (const o of repeats.overflow) put(flow, o.indices);
  for (const i of page.unassigned) put(taken.get(i) ?? flow, [i]);
  // The attributes of a slot's first `:::frame` fence (its `label`,
  // `title`): the frame's tab and title.
  const fenceAttrs = new Map<string, Record<string, string>>();
  const fenceAttrSources = new Map<string, Record<string, { sourceStart: number; sourceEnd: number }>>();
  const readFence = (key: string, b: ContentBlock): void => {
    fenceAttrs.set(key, Object.fromEntries(Object.entries(b.containerAttrs ?? {}).filter(([k]) => k !== 'slot')));
    if (b.containerAttrSources) fenceAttrSources.set(key, Object.fromEntries(Object.entries(b.containerAttrSources).filter(([k]) => k !== 'slot')));
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type !== 'containerStart' || b.containerName !== 'frame' || i < 0) continue;
    if (b.sourceStart < page.sourceStart || b.sourceStart > page.sourceEnd) continue;
    const slot = b.slot?.name;
    if (slot === undefined || fenceAttrs.has(slot) || repeats.repeated.has(slot)) continue;
    readFence(slot, b);
  }
  // Each instance is dressed by its own item's fence (#1061).
  for (const [name, at] of instanceFences) readFence(name, blocks[at]!);
  // Stories: each chain's frames' pieces, head first.
  const stories: { head: string; indices: number[]; attrs: Record<string, string>; attrSources?: Record<string, { sourceStart: number; sourceEnd: number }> }[] = [];
  const done = new Set<string>();
  /** An instance's story (#1061): the instance of its chain's head, the
   *  chain's frames of the set as the same item's instances. */
  const instanceStory = (name: string): { head: string; chain: string[] } | undefined => {
    const at = repeatInstance(name);
    if (!at || !repeats.repeated.has(at.frame) || !names.has(at.frame)) return undefined;
    const inSet = (f: string): boolean => repeats.repeated.has(f);
    const baseHead = chainHead(template, at.frame);
    const head = inSet(baseHead) ? baseHead : at.frame;
    const chain = frameChain(template, head).map((f) => f.name);
    // (A link out of the set is not followed: an instance's content is its
    // item's.)
    const stop = chain.findIndex((f) => !inSet(f));
    const kept = stop < 0 ? chain : chain.slice(0, Math.max(1, stop));
    return { head: repeatInstanceName(head, at.item), chain: kept.map((f) => repeatInstanceName(f, at.item)) };
  };
  for (const name of pieces.keys()) {
    const inst = names.has(name) ? undefined : instanceStory(name);
    const head = names.has(name) ? story(name)! : inst?.head ?? name;
    if (done.has(head)) continue;
    done.add(head);
    const chain = names.has(head) ? frameChain(template, head).map((f) => f.name) : inst?.chain ?? [head];
    const indices: number[] = [];
    for (const f of chain) indices.push(...(pieces.get(f) ?? []).slice().sort((a, b) => a - b));
    if (indices.length === 0) continue;
    const attrSources = fenceAttrSources.get(head);
    stories.push({ head, indices, attrs: fenceAttrs.get(head) ?? {}, ...(attrSources ? { attrSources } : {}) });
  }
  stories.sort((a, b) => Math.min(...a.indices) - Math.min(...b.indices));
  /** The heading another story took that the flow story's first block
   *  came right after in the Markdown (past fences and directives), if
   *  that block is a paragraph (#947). */
  const flowHead = story(undefined);
  const capHeadingOf = (indices: readonly number[], head: string): ContentBlock | undefined => {
    if (head !== flowHead) return undefined;
    const at = indices.find((i) => blocks[i]!.type !== 'directive' && blocks[i]!.type !== 'containerStart' && blocks[i]!.type !== 'containerEnd');
    if (at === undefined || blocks[at]!.type !== 'paragraph') return undefined;
    let j = at - 1;
    while (j >= 0 && (blocks[j]!.type === 'directive' || blocks[j]!.type === 'containerStart' || blocks[j]!.type === 'containerEnd')) j--;
    const taker = taken.get(j);
    return j >= 0 && blocks[j]!.type === 'heading' && taker !== undefined && taker !== head ? blocks[j] : undefined;
  };
  const out: ContentBlock[] = [];
  for (const s of stories) {
    const id = nextId();
    const first = blocks[s.indices[0]!]!;
    const last = blocks[s.indices[s.indices.length - 1]!]!;
    const capHeading = capHeadingOf(s.indices, s.head);
    // A frame's own `direction` (#944): its story is set in it, as a box
    // fenced `{dir=…}` is; a block or a box inside that writes its own
    // `dir` keeps it.
    // An instance of a repeated frame (#1061) is set as its frame.
    const base = names.has(s.head) ? s.head : repeatInstance(s.head)?.frame;
    const baseFrame = base !== undefined && names.has(base) ? base : undefined;
    const frameDir = baseFrame !== undefined ? frameChain(template, baseFrame)[0]?.direction : undefined;
    // Boxes inside the story that write their own `dir` are open while
    // their blocks pass: those keep the direction they were given.
    const owning: boolean[] = [];
    const directed = (b: ContentBlock): ContentBlock => {
      if (b.type === 'containerEnd') {
        owning.pop();
        return b;
      }
      const kept = owning.includes(true) || ownsDirection(b);
      if (b.type === 'containerStart') owning.push(ownsDirection(b));
      return frameDir && !kept ? { ...b, direction: frameDir } : b;
    };
    out.push({
      type: 'containerStart',
      text: '',
      spans: [],
      containerName: 'callout',
      containerAttrs: { ...s.attrs, type: FRAME_STYLE_ID, placement: 'here', span: 'column', [FRAME_ATTR]: s.head, ...(capHeading ? { [CAP_HEADING_ATTR]: String(capHeading.sourceStart) } : {}) },
      // The frame fence's `label` and `title` keep their source (#857).
      ...(s.attrSources ? { containerAttrSources: s.attrSources } : {}),
      containerId: id,
      sourceStart: first.sourceStart,
      sourceEnd: first.sourceStart,
      sourceMap: [],
      ...(frameDir ? { direction: frameDir } : first.direction ? { direction: first.direction } : {}),
    });
    // A frame set in columns (`columns`), alone in its story: its content
    // is a `:::columns` group of the box (a chain's frames may differ in
    // columns; they are set in one).
    const chain = names.has(s.head) ? frameChain(template, s.head) : baseFrame !== undefined ? [template.frames.find((f) => f.name === baseFrame)!] : [];
    const cols = chain.length === 1 && chain[0]!.columns > 1 ? chain[0]! : undefined;
    if (cols) {
      const gap: Record<string, string> = cols.columnGap ? { gap: `${cols.columnGap.value}${cols.columnGap.unit}` } : {};
      out.push({ type: 'containerStart', text: '', spans: [], containerName: 'columns', containerAttrs: { count: String(cols.columns), ...gap }, containerId: id + COLUMNS_ID_OFFSET, sourceStart: first.sourceStart, sourceEnd: first.sourceStart, sourceMap: [] });
    }
    const instance = baseFrame !== undefined && baseFrame !== s.head ? s.head : undefined;
    for (const i of s.indices) out.push(directed(instance !== undefined ? withInstanceLabels(blocks[i]!, page.fenceIndex, baseFrame!, instance) : blocks[i]!));
    if (cols) out.push({ type: 'containerEnd', text: '', spans: [], containerName: 'columns', containerId: id + COLUMNS_ID_OFFSET, sourceStart: last.sourceEnd, sourceEnd: last.sourceEnd, sourceMap: [] });
    out.push({ type: 'containerEnd', text: '', spans: [], containerName: 'callout', containerId: id, sourceStart: last.sourceEnd, sourceEnd: last.sourceEnd, sourceMap: [] });
  }
  for (const i of loose.sort((a, b) => a - b)) out.push(blocks[i]!);
  return out;
}

/** A figure of an instance's content with its labels' ids named by the
 *  instance (#1061): `cp<n>:card[2]:label:<anchor>`, one per item, not the
 *  frame's id the parser gave every item alike. */
function withInstanceLabels(b: ContentBlock, fenceIndex: number, frame: string, instance: string): ContentBlock {
  const labels = b.figure?.labels;
  const from = `cp${fenceIndex}:${frame}:label:`;
  if (!labels || !labels.some((l) => l.id?.startsWith(from))) return b;
  const to = `cp${fenceIndex}:${instance}:label:`;
  return { ...b, figure: { ...b.figure!, labels: labels.map((l) => (l.id?.startsWith(from) ? { ...l, id: to + l.id.slice(from.length) } : l)) } };
}

/** Whether a block sets its own direction in the Markdown (a heading's or
 *  a box's `{dir=…}`), which a frame's `direction` leaves as written. */
function ownsDirection(b: ContentBlock): boolean {
  const own = (attrs: Record<string, string> | undefined): boolean => {
    const v = attrs?.dir?.trim().toLowerCase();
    return v === 'ltr' || v === 'rtl';
  };
  return own(b.type === 'heading' ? b.attrs : undefined) || own(b.containerAttrs) || own(b.verse?.attrs);
}

const ZERO = { value: 0, unit: 'pt' as const };

/** The frameless box a story is laid in when its frame has no `style`:
 *  no frame, padding, title or icon, its children set in the text's own
 *  typography (`deriveCalloutMeasureContext`), cut between lines keeping
 *  `splitMinLines` lines of text on each side (the body's orphan and widow
 *  minimums). */
export function frameBoxStyle(splitMinLines: number): CalloutStyleConfig {
  return {
    id: FRAME_STYLE_ID,
    title: '',
    span: 'column',
    placement: 'here',
    backgroundEnabled: false,
    border: { enabled: false },
    borderRadius: ZERO,
    padding: { top: ZERO, right: ZERO, bottom: ZERO, left: ZERO },
    stripe: { enabled: false },
    icon: { kind: 'none' },
    marker: { kind: 'none' },
    marginTop: ZERO,
    marginBottom: ZERO,
    keepTogether: false,
    splitMinLines: Math.max(1, Math.round(splitMinLines)),
  };
}
