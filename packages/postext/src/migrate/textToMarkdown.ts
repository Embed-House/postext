/**
 * «Move the text to the Markdown» (#874): rescue a book that keeps its
 * content in heading styles — the pattern of the 1.33 ports, a hidden
 * heading style per page whose running head holds dozens of text elements
 * placed on the page — by turning each page design into a page template
 * whose frames take the text elements' boxes, and each page of the chapter
 * into a `::::page{template}` fence whose `:::frame{slot}` blocks hold the
 * text. The design's boxes and pictures become the template's decoration;
 * the text's face, size and colour a paragraph style (one the book has when
 * it matches); highlight boxes under bold words become chips. Similar pages
 * share a template and extend it.
 *
 * Pure: a configuration and the chapters' Markdown in, the new ones and a
 * report out. The Sandbox runs it from its migration dialog; the CLI and the
 * agent skill can call it as it is.
 */
import type {
  ChipStyleConfig,
  DesignElement,
  DesignSlot,
  DocumentMetadata,
  HeadingStyleConfig,
  ParagraphStyleConfig,
  PostextConfig,
} from '../types';
import type { FrameConfig, PageSide, PageTemplate, PageTemplatePatch } from '../composed/types';
import { collectConfigWarnings, contentInConfigRule } from '../configWarnings';
import { resolveAllConfig } from '../pipeline/config';
import { stableStringify } from '../util/stableHash';
import { scanChapter, type DesignRun, type HeadingLine } from './markdownRuns';
import { joinLines, planDesign, remapDecorationAnchors, toMm, type PlannedDesign, type PlannedFrame, type TextLook } from './pageDesign';

export interface TextMigrationChapter {
  id: string;
  markdown: string;
}

export interface TextMigrationInput {
  config: PostextConfig;
  chapters: readonly TextMigrationChapter[];
  /** The book's metadata: its title, author… are allowed in a design, as
   *  the `contentInConfig` check allows them, and stay there. */
  metadata?: DocumentMetadata;
}

export interface TextMigrationOptions {
  /** Join text elements of one look set under one another at an even
   *  spacing into one frame. Default `true`. */
  merge?: boolean;
  /** Pages whose frames stand in the same places share a template that
   *  their own ones extend. Default `true`. */
  shareTemplates?: boolean;
  /** A filled box under the bold words of a moved text becomes a chip of
   *  the book's chip style of that colour (else a new one). Default `true`. */
  highlightsToChips?: boolean;
  /** Heading styles that hold content and that no heading uses: `'keep'`
   *  (default) leaves them, `'remove'` deletes them. */
  unusedStyles?: 'keep' | 'remove';
  /** The side of the page a run's page falls on, when the caller laid the
   *  book out: the chapter and the offset of the page's first line in its
   *  Markdown as it was. Without it the side comes from the opening
   *  heading's `breakBefore.parity`, when it has one. */
  sideOf?: (chapterId: string, offset: number) => PageSide | undefined;
}

export interface ContentInConfigCount {
  /** `contentInConfig` warnings (one per owner). */
  warnings: number;
  /** Design texts at fault. */
  elements: number;
  /** Their letters and digits. */
  chars: number;
}

/** One `::::page` fence the migration wrote. */
export interface MigratedPage {
  chapterId: string;
  /** 0-based index among the chapter's fences. */
  fence: number;
  template: string;
  /** The heading styles of the headings on the page, as they were. */
  styles: string[];
  side?: PageSide;
  frames: number;
  elements: number;
  chars: number;
  /** Where the page may look different, by code: `letterSpacing` (a
   *  paragraph style has no tracking), `box`, `stroke`, `dropCap`,
   *  `paragraphIndent`, `height` (the text's own box), `side` (the side of
   *  the page is not known: the text of both sides' frames was written),
   *  `flow` (the page has running text, now set in the template's flow
   *  frame), `repeated` (a text the running head printed on each page of a
   *  section is written on each page). */
  differences: string[];
}

export interface TextMigrationReport {
  pages: MigratedPage[];
  templates: { id: string; extends?: string; frames: number; pages: number }[];
  /** Text elements moved, and their letters and digits. */
  movedElements: number;
  movedChars: number;
  /** Highlight boxes that became chips. */
  chips: number;
  frames: number;
  paragraphStylesCreated: string[];
  paragraphStylesReused: string[];
  chipStylesCreated: string[];
  /** Heading styles merged into one once their running heads moved out
   *  (`into` keeps; `from` are gone), and those deleted unused. */
  headingStylesMerged: { into: string; from: string[] }[];
  headingStylesRemoved: string[];
  /** Heading styles holding content that no heading uses (kept). */
  unusedStyles: string[];
  /** Hidden headings that only switched the running head, dropped. */
  headingsDropped: number;
  /** Text left in the configuration, and why. */
  left: { path: string; reason: 'placeholder' | 'anchor' | 'unused' | 'notPage' }[];
  configBytesBefore: number;
  configBytesAfter: number;
  contentInConfigBefore: ContentInConfigCount;
  contentInConfigAfter: ContentInConfigCount;
}

export interface TextMigrationResult {
  config: PostextConfig;
  chapters: TextMigrationChapter[];
  report: TextMigrationReport;
  /** Nothing to move: the result is the input. */
  unchanged: boolean;
}

interface Design {
  key: string;
  styleIds: string[];
  /** Whether the styles set their own header / footer. */
  ownHeader: boolean;
  ownFooter: boolean;
  plan: PlannedDesign;
  /** Template the design's pages use, once built. */
  template?: string;
  /** The template's own chain (it and what it extends), for `{attr.x}`. */
  attrNames?: Set<string>;
  /** An element of the design shows on some page roles only. */
  roleFiltered?: boolean;
  pages: number;
}

const ENCODER = new TextEncoder();
const bytes = (v: unknown): number => ENCODER.encode(JSON.stringify(v ?? {})).length;

function countContent(config: PostextConfig, metadata: DocumentMetadata | undefined): ContentInConfigCount {
  const ws = collectConfigWarnings({ ...config, checks: { ...config.checks, contentInConfig: { ...config.checks?.contentInConfig, enabled: true } } }, metadata ? { metadata } : {})
    .filter((w) => w.kind === 'contentInConfig');
  return { warnings: ws.length, elements: ws.reduce((n, w) => n + (w.count ?? 0), 0), chars: ws.reduce((n, w) => n + (w.chars ?? 0), 0) };
}

const slotOf = (v: unknown): DesignSlot | undefined =>
  v && typeof v === 'object' && Array.isArray((v as DesignSlot).elements) ? (v as DesignSlot) : undefined;

/** A readable id: a style's part after its last `--` (`tema--p12` → `p12`),
 *  free among `taken`. */
function freeId(base: string, taken: Set<string>): string {
  const clean = base.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
  let id = clean;
  for (let n = 2; taken.has(id); n++) id = `${clean}-${n}`;
  taken.add(id);
  return id;
}

const slug = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const ALIGN: Record<TextLook['align'], ParagraphStyleConfig['textAlign']> = { left: 'left', center: 'center', right: 'right', justify: 'justify', start: 'start', end: 'end' };

/** The paragraph style of a look and spacing, as the migration writes it. */
function styleFields(look: TextLook, gap: number): Omit<ParagraphStyleConfig, 'id' | 'name'> {
  return {
    ...(look.fontFamily ? { fontFamily: look.fontFamily } : {}),
    fontSize: look.fontSize,
    lineHeight: { value: look.lineHeight, unit: 'em' },
    ...(look.color ? { color: look.color, boldColor: look.color, italicColor: look.color } : {}),
    textAlign: ALIGN[look.align],
    fontWeight: look.fontWeight,
    boldFontWeight: Math.max(700, look.fontWeight),
    ...(look.italic ? { italic: true } : {}),
    ...(look.uppercase ? { textTransform: 'uppercase' as const } : {}),
    hyphenation: look.hyphenate,
    firstLineIndent: { value: 0, unit: 'mm' },
    spaceBetween: { value: gap, unit: 'mm' },
    marginTop: { value: 0, unit: 'mm' },
    marginBottom: { value: 0, unit: 'mm' },
    snapToGrid: false,
  };
}

/** Whether a book's paragraph style sets a look exactly (the fields the
 *  migration writes, and nothing that would change the lines). */
function sameStyle(own: ParagraphStyleConfig, want: Omit<ParagraphStyleConfig, 'id' | 'name'>): boolean {
  const harmless = new Set(['id', 'name']);
  const ownKeys = Object.keys(own).filter((k) => !harmless.has(k));
  const wantKeys = Object.keys(want);
  if (ownKeys.some((k) => !wantKeys.includes(k))) return false;
  const norm = (v: unknown): string => stableStringify(v, new Set(['paletteId', 'model']));
  return wantKeys.every((k) => {
    const a = (own as unknown as Record<string, unknown>)[k];
    const b = (want as Record<string, unknown>)[k];
    if (a === undefined) {
      // Unset values the migration only spells out.
      return (k === 'italic' && b === undefined) || (k === 'spaceBetween' && (b as { value: number }).value === 0)
        || ((k === 'marginTop' || k === 'marginBottom') && (b as { value: number }).value === 0);
    }
    return norm(a) === norm(b);
  });
}

/** Run the migration. */
export function moveTextToMarkdown(input: TextMigrationInput, options: TextMigrationOptions = {}): TextMigrationResult {
  const config = input.config;
  const merge = options.merge !== false;
  const share = options.shareTemplates !== false;
  const highlights = options.highlightsToChips !== false;
  const metadata = input.metadata;
  const verdict = contentInConfigRule(config, metadata ? { metadata } : {});
  const isContent = (c: string) => verdict(c).content;
  /** Text worth moving once a slot is migrated: any with a letter left
   *  after the allowed phrases. */
  const movable = (c: string) => /\p{L}/u.test(verdict(c).rest);
  const resolved = resolveAllConfig(config);
  const page = { width: toMm(resolved.page.width) ?? 0, height: toMm(resolved.page.height) ?? 0 };
  const before = countContent(config, metadata);

  // 1. Page designs: heading styles whose running heads hold content,
  // grouped by what those running heads draw.
  const styles = Array.isArray(config.headingStyles) ? config.headingStyles : [];
  const designs = new Map<string, Design>();
  const designOfStyle = new Map<string, Design>();
  const left: TextMigrationReport['left'] = [];
  styles.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const header = slotOf(s.header);
    const footer = slotOf(s.footer);
    const holds = (slot: DesignSlot | undefined) => !!slot && slot.elements.some((e) => e?.kind === 'text' && typeof e.content === 'string' && isContent(e.content));
    if (!holds(header) && !holds(footer)) {
      if (slotOf(s.advancedDesign?.slot) && holds(slotOf(s.advancedDesign?.slot))) left.push({ path: `headingStyles[${i}].advancedDesign.slot`, reason: 'notPage' });
      return;
    }
    const key = stableStringify({ header: header ?? null, footer: footer ?? null });
    let d = designs.get(key);
    if (!d) {
      const headerEls = header?.elements ?? [];
      const headerIds = new Set(headerEls.map((e) => e.id));
      // Footer elements whose id the header already uses are renamed.
      const footerEls = (footer?.elements ?? []).map((e) => (headerIds.has(e.id) ? ({ ...e, id: `${e.id}-footer` } as DesignElement) : e));
      const plan = planDesign({
        key,
        elements: [...headerEls, ...footerEls],
        origins: [...headerEls.map(() => 'header' as const), ...footerEls.map(() => 'footer' as const)],
        page,
        isContent: movable,
        chipStyles: config.chipStyles ?? [],
        highlightsToChips: highlights,
        merge,
      });
      const roleFiltered = [...headerEls, ...footerEls].some((e) => typeof e.pages === 'string' && e.pages !== 'all');
      d = { key, styleIds: [], ownHeader: !!header, ownFooter: !!footer, plan, pages: 0, ...(roleFiltered ? { roleFiltered } : {}) };
      designs.set(key, d);
      for (const k of plan.kept) left.push({ path: `headingStyles[${i}] #${k.id}`, reason: k.reason });
    }
    d.styleIds.push(s.id);
    designOfStyle.set(s.id, d);
  });

  const styleById = new Map(styles.map((s) => [s.id, s] as const));
  const breakBefore = (h: HeadingLine): { enabled: boolean; parity: string } => {
    const st = h.attrs.style !== undefined ? styleById.get(h.attrs.style) : undefined;
    const level = resolved.headings.levels[h.level - 1];
    const own = st?.breakBefore;
    return {
      enabled: own?.enabled ?? level?.breakBefore.enabled ?? h.level === 1,
      parity: own?.parity ?? level?.breakBefore.parity ?? 'any',
    };
  };

  // 2. The runs of each chapter.
  const scans = input.chapters.map((ch) => ({
    chapter: ch,
    scan: scanChapter(ch.markdown, {
      designOf: (id) => designOfStyle.get(id)?.key,
      breaksPage: (h) => breakBefore(h).enabled,
    }),
  }));
  for (const { scan } of scans) for (const r of scan.runs) designs.get(r.design)!.pages += r.pages.length;

  const unused = [...designOfStyle.entries()].filter(([, d]) => d.pages === 0).map(([id]) => id);
  const usedDesigns = [...designs.values()].filter((d) => d.pages > 0);
  if (usedDesigns.length === 0 && (unused.length === 0 || options.unusedStyles !== 'remove')) {
    return {
      config,
      chapters: input.chapters.map((c) => ({ ...c })),
      unchanged: true,
      report: emptyReport(before, bytes(config), left, unused),
    };
  }

  // 3. Templates.
  const takenTemplates = new Set((config.pageTemplates ?? []).map((t) => t.id));
  const templates = buildTemplates(usedDesigns, share, takenTemplates);
  // A design whose elements show on some page roles only (`pages:
  // 'opener'`) keeps showing them where they showed: its pages' templates
  // report the role each page had (a composed page reports `'composed'`).
  const pageRole = (p: { startLine: number; headings: HeadingLine[] }): 'opener' | 'body' => {
    const h = p.headings[0];
    if (!h || h.line !== p.startLine) return 'body';
    const st = h.attrs.style !== undefined ? styleById.get(h.attrs.style) : undefined;
    const span = st?.span ?? resolved.headings.levels[h.level - 1]?.span;
    return span === 'page' || breakBefore(h).enabled ? 'opener' : 'body';
  };
  const roleTemplate = new Map<string, string>();
  const templateFor = (d: Design, p: { startLine: number; headings: HeadingLine[] }): string => {
    if (!d.roleFiltered) return d.template!;
    const role = pageRole(p);
    const key = `${d.template!}\n${role}`;
    const hit = roleTemplate.get(key);
    if (hit) return hit;
    const own = templates.list.find((t) => t.id === d.template)!;
    const sharedBy = usedDesigns.filter((x) => x.template === d.template).length;
    const extended = templates.list.some((t) => t.extends === d.template);
    let id: string;
    if (own.role === undefined && sharedBy === 1 && !extended && ![...roleTemplate.keys()].some((k) => k.startsWith(`${d.template!}\n`))) {
      own.role = role;
      id = own.id;
    } else if (own.role === role) {
      id = own.id;
    } else {
      id = freeId(`${own.id}-${role}`, takenTemplates);
      templates.list.push({ id, name: `${own.id} (${role})`, extends: own.id, role });
    }
    roleTemplate.set(key, id);
    return id;
  };

  // 4. Paragraph and chip styles.
  const paragraphStyles = (config.paragraphStyles ?? []).slice();
  const takenParagraph = new Set(paragraphStyles.map((p) => p.id));
  const createdParagraph: string[] = [];
  const reusedParagraph = new Set<string>();
  const styleCache = new Map<string, string>();
  const bodyColour = (config.bodyText?.color as { hex?: string } | undefined)?.hex?.toLowerCase();
  const paragraphStyleFor = (f: PlannedFrame): string => {
    const want = styleFields(f.look, f.gap);
    const key = stableStringify(want);
    const hit = styleCache.get(key);
    if (hit) return hit;
    const own = paragraphStyles.find((p) => sameStyle(p, want));
    if (own) {
      reusedParagraph.add(own.id);
      styleCache.set(key, own.id);
      return own.id;
    }
    const size = toMm(f.look.fontSize);
    const pt = size !== undefined ? Math.round((size * 72) / 25.4 * 10) / 10 : undefined;
    const hex = (f.look.color as { hex?: string } | undefined)?.hex?.toLowerCase();
    const parts = [
      slug(f.look.fontFamily ?? 'text') || 'text',
      pt !== undefined ? String(pt).replace('.', '-') : '',
      f.look.fontWeight >= 600 ? 'bold' : '',
      f.look.italic ? 'italic' : '',
      f.look.align !== 'left' && f.look.align !== 'start' ? f.look.align : '',
      hex && hex !== bodyColour ? hex.replace('#', '') : '',
    ].filter(Boolean);
    const id = freeId(parts.join('-'), takenParagraph);
    const name = [f.look.fontFamily ?? '', pt !== undefined ? `${pt} pt` : '', f.look.fontWeight >= 600 ? 'bold' : '', f.look.italic ? 'italic' : '', f.look.align, hex ?? '']
      .filter(Boolean).join(' ');
    paragraphStyles.push({ id, name, ...want });
    createdParagraph.push(id);
    styleCache.set(key, id);
    return id;
  };
  const chipStyles: ChipStyleConfig[] = (config.chipStyles ?? []).slice();
  const createdChips: string[] = [];
  for (const d of usedDesigns) {
    for (const [id, st] of d.plan.newChipStyles) {
      if (chipStyles.some((c) => c.id === id)) continue;
      chipStyles.push(st);
      createdChips.push(id);
    }
  }

  // 5. The Markdown.
  const pages: MigratedPage[] = [];
  let headingsDropped = 0;
  const chapters = scans.map(({ chapter, scan }) => {
    const { lines } = scan;
    const lineStart: number[] = [];
    for (let i = 0, at = 0; i < lines.length; i++) {
      lineStart[i] = at;
      at += lines[i]!.length + 1;
    }
    const drop = new Set(scan.dropBreaks);
    const out: string[] = [];
    let fence = 0;
    let cursor = 0;
    const runsAt = new Map<number, DesignRun>(scan.runs.map((r) => [r.startLine, r]));
    while (cursor < lines.length) {
      const run = runsAt.get(cursor);
      if (!run) {
        if (!drop.has(cursor)) out.push(lines[cursor]!);
        cursor++;
        continue;
      }
      const d = designs.get(run.design)!;
      const firstBreak = breakBefore(run.pages[0]!.headings[0]!);
      run.pages.forEach((p, pi) => {
        const side = options.sideOf?.(chapter.id, lineStart[p.startLine]!) ?? heuristicSide(firstBreak.parity, pi);
        const written = writePage(d, templateFor(d, p), p, lines, side, styleById, paragraphStyleFor);
        headingsDropped += written.dropped;
        if (out.length > 0 && out[out.length - 1]!.trim() !== '') out.push('');
        // A composed page starts a page but reads no heading's parity: the
        // side the opening heading asked for is a page break's.
        const parity = pi === 0 && firstBreak.enabled ? sideParity(firstBreak.parity) : undefined;
        if (parity) out.push(`:::pagebreak{parity="${parity}"}`, '');
        out.push(...written.lines, '');
        pages.push({
          chapterId: chapter.id,
          fence: fence++,
          template: written.template,
          styles: [...new Set(p.headings.map((h) => h.attrs.style).filter((s): s is string => s !== undefined))],
          ...(side ? { side } : {}),
          frames: written.frames,
          elements: written.elements,
          chars: written.chars,
          differences: written.differences,
        });
      });
      cursor = run.endLine + 1;
      // The blank line after the fence is written; skip the source's.
      while (cursor < lines.length && lines[cursor]!.trim() === '' && out[out.length - 1] === '') cursor++;
    }
    return { id: chapter.id, markdown: out.join('\n') };
  });

  // 6. Heading styles: the running heads are gone; styles left the same
  // are merged; unused ones go when asked.
  const migrated = new Set(usedDesigns.flatMap((d) => d.styleIds));
  const removeUnused = options.unusedStyles === 'remove';
  const removed: string[] = [];
  const stripped: HeadingStyleConfig[] = [];
  for (const s of styles) {
    if (removeUnused && unused.includes(s.id)) {
      removed.push(s.id);
      continue;
    }
    if (!migrated.has(s.id)) {
      stripped.push(s);
      continue;
    }
    const d = designOfStyle.get(s.id)!;
    const copy = { ...s };
    if (d.ownHeader) delete copy.header;
    if (d.ownFooter) delete copy.footer;
    stripped.push(copy);
  }
  const { styles: mergedStyles, renames, merged } = mergeStyles(stripped, migrated);
  const finalChapters = chapters.map((c) => ({ ...c, markdown: renameStyles(c.markdown, renames) }));
  for (const p of pages) p.styles = p.styles.map((s) => renames.get(s) ?? s);

  const next: PostextConfig = {
    ...config,
    headingStyles: mergedStyles,
    paragraphStyles,
    ...(chipStyles.length > 0 ? { chipStyles } : {}),
    pageTemplates: [...(config.pageTemplates ?? []), ...templates.list],
  };
  for (const id of unused) if (!removeUnused) left.push({ path: `headingStyles[id=${id}]`, reason: 'unused' });

  const report: TextMigrationReport = {
    pages,
    templates: templates.list.map((t) => ({
      id: t.id,
      ...(t.extends ? { extends: t.extends } : {}),
      frames: (t.frames?.length ?? 0) + (t.variants?.recto?.frames?.length ?? 0) + (t.variants?.verso?.frames?.length ?? 0),
      pages: pages.filter((p) => p.template === t.id).length,
    })),
    movedElements: usedDesigns.reduce((n, d) => n + d.plan.movedElements, 0),
    movedChars: usedDesigns.reduce((n, d) => n + d.plan.movedChars, 0),
    chips: usedDesigns.reduce((n, d) => n + d.plan.chips, 0),
    frames: usedDesigns.reduce((n, d) => n + d.plan.frames.length, 0),
    paragraphStylesCreated: createdParagraph,
    paragraphStylesReused: [...reusedParagraph],
    chipStylesCreated: createdChips,
    headingStylesMerged: merged,
    headingStylesRemoved: removed,
    unusedStyles: unused,
    headingsDropped,
    left,
    configBytesBefore: bytes(config),
    configBytesAfter: bytes(next),
    contentInConfigBefore: before,
    contentInConfigAfter: countContent(next, metadata),
  };
  return { config: next, chapters: finalChapters, report, unchanged: false };
}

function emptyReport(before: ContentInConfigCount, size: number, left: TextMigrationReport['left'], unused: string[]): TextMigrationReport {
  return {
    pages: [], templates: [], movedElements: 0, movedChars: 0, chips: 0, frames: 0,
    paragraphStylesCreated: [], paragraphStylesReused: [], chipStylesCreated: [],
    headingStylesMerged: [], headingStylesRemoved: [], unusedStyles: unused, headingsDropped: 0, left,
    configBytesBefore: size, configBytesAfter: size, contentInConfigBefore: before, contentInConfigAfter: before,
  };
}

/** The page break parity of a heading's `breakBefore.parity`. */
function sideParity(parity: string): 'even' | 'odd' | undefined {
  return parity === 'even' || parity === 'always-even' ? 'even' : parity === 'odd' || parity === 'always-odd' ? 'odd' : undefined;
}

/** The side of a run's `index`-th page from its opening heading's parity. */
function heuristicSide(parity: string, index: number): PageSide | undefined {
  const first: PageSide | undefined = parity === 'even' || parity === 'always-even' ? 'verso' : parity === 'odd' || parity === 'always-odd' ? 'recto' : undefined;
  if (!first) return undefined;
  return index % 2 === 0 ? first : first === 'recto' ? 'verso' : 'recto';
}

/** Attributes of the opening heading the page fence carries: those the
 *  template reads (`{attr.x}`). */
const FENCE_RESERVED = new Set(['style', 'id', 'toc', 'hidden', 'numbered', 'slot', 'template', 'spread', 'background']);

function writePage(
  d: Design,
  template: string,
  p: { startLine: number; endLine: number; headings: HeadingLine[] },
  lines: readonly string[],
  side: PageSide | undefined,
  styleById: Map<string, HeadingStyleConfig>,
  paragraphStyleFor: (f: PlannedFrame) => string,
): { template: string; lines: string[]; frames: number; elements: number; chars: number; differences: string[]; dropped: number } {
  const differences = new Set<string>();
  const attrs: string[] = [`template="${template}"`];
  if (d.plan.background) attrs.push(`background="${d.plan.background.replace(/["\\]/g, '')}"`);
  const opening = p.headings[0];
  for (const name of d.attrNames ?? []) {
    if (FENCE_RESERVED.has(name)) continue;
    const token = opening?.attrTokens[name];
    if (token !== undefined) attrs.push(token);
  }
  // The page's own lines, without the hidden headings that only switched
  // the running head (no id, nothing in the contents, no words).
  const dropLines = new Set<number>();
  for (const h of p.headings) {
    const st = h.attrs.style !== undefined ? styleById.get(h.attrs.style) : undefined;
    if (h.attrs.id === undefined && st?.hidden === true && st.toc === false && !/[\p{L}\p{N}]/u.test(h.title)) dropLines.add(h.line);
  }
  const body: string[] = [];
  for (let i = p.startLine; i <= p.endLine; i++) if (!dropLines.has(i)) body.push(lines[i]!);
  while (body.length > 0 && body[body.length - 1]!.trim() === '') body.pop();
  while (body.length > 0 && body[0]!.trim() === '') body.shift();
  const flowText = body.some((l) => l.trim() !== '' && !/^#{1,6}[ \t]/.test(l.trim()));
  if (flowText) differences.add('flow');

  const out: string[] = [`::::page{${attrs.join(' ')}}`, ...body];
  let frames = 0;
  let elements = 0;
  let chars = 0;
  for (const f of d.plan.frames) {
    if (f.side && side && f.side !== side) continue;
    if (f.side && !side) differences.add('side');
    frames++;
    out.push('', `:::frame{slot="${f.name!}"}`, `:::paragraphs{style="${paragraphStyleFor(f)}"}`);
    f.pieces.forEach((piece, i) => {
      if (i > 0) out.push('');
      out.push(joinLines(piece.lines));
      elements++;
      chars += piece.chars;
      for (const n of piece.notes) differences.add(n);
    });
    out.push(':::', ':::');
  }
  if (d.pages > 1 && d.plan.frames.some((f) => !f.side)) differences.add('repeated');
  out.push('::::');
  return { template, lines: out, frames, elements, chars, differences: [...differences].sort(), dropped: dropLines.size };
}

/** A frame of the template, from a planned one. */
function frameConfig(f: PlannedFrame): FrameConfig {
  const first = f.pieces[0]!;
  const el = first.element;
  const placement = first.x !== undefined && first.y !== undefined
    ? { anchor: { to: 'page' as const, edge: 'top-left' as const }, offset: { x: { value: round3(first.x), unit: 'mm' as const }, y: { value: round3(first.y), unit: 'mm' as const } } }
    : { anchor: el.placement.anchor, ...(el.placement.offset ? { offset: el.placement.offset } : {}) };
  const width = f.width !== undefined ? { value: round3(f.width), unit: 'mm' as const }
    : typeof el.placement.size?.width === 'object' ? el.placement.size.width : undefined;
  return {
    name: f.name!,
    placement,
    ...(width ? { width } : {}),
    ...(f.look.direction ? { direction: f.look.direction } : {}),
    ...(f.look.writingMode ? { writingMode: f.look.writingMode } : {}),
  };
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The frames of a template, those of one side in its variant. */
function framesPatch(frames: readonly PlannedFrame[]): { frames: FrameConfig[]; variants?: PageTemplate['variants'] } {
  const own = frames.filter((f) => !f.side).map(frameConfig);
  const recto = frames.filter((f) => f.side === 'recto').map(frameConfig);
  const verso = frames.filter((f) => f.side === 'verso').map(frameConfig);
  const variants: PageTemplate['variants'] = {};
  if (recto.length > 0) variants.recto = { frames: recto };
  if (verso.length > 0) variants.verso = { frames: verso };
  return { frames: own, ...(recto.length > 0 || verso.length > 0 ? { variants } : {}) };
}

/** The running text's frame: the content area, under the decoration as
 *  the running text was under the running head that drew the page. */
const FLOW_FRAME: FrameConfig = { name: 'flow', flow: true, optional: true, layer: -1 };

/** The running heads a design's template sets: its styles' own (what
 *  stayed in them), hidden when nothing did; unset when the styles had
 *  none of their own. */
function runningHeads(d: Design): Pick<PageTemplatePatch, 'header' | 'footer'> {
  return {
    ...(d.ownHeader ? { header: d.plan.header.length > 0 ? { elements: d.plan.header } : false } : {}),
    ...(d.ownFooter ? { footer: d.plan.footer.length > 0 ? { elements: d.plan.footer } : false } : {}),
  };
}

/** `{attr.x}` names a template's decoration and running heads read. */
function attrNamesOf(t: Pick<PageTemplatePatch, 'decoration' | 'header' | 'footer'>[]): Set<string> {
  const names = new Set<string>();
  const text = stableStringify(t);
  for (const m of text.matchAll(/\{attr\.([\w-]+)\}/g)) names.add(m[1]!);
  return names;
}

/** Templates for the designs: one each, or (sharing) a base per family of
 *  designs whose frames stand in the same places, with the pages' own
 *  templates extending it. Names frames on the way. */
function buildTemplates(designs: Design[], share: boolean, taken: Set<string>): { list: PageTemplate[] } {
  const list: PageTemplate[] = [];
  const idFor = (d: Design): string => {
    const first = d.styleIds[0]!;
    const cut = first.lastIndexOf('--');
    return freeId(cut >= 0 ? first.slice(cut + 2) : first, taken);
  };
  // Keys of frames that more than one design has.
  const occurrences = new Map<string, Set<string>>();
  const keysOf = (d: Design): string[] => {
    const seen = new Map<string, number>();
    return d.plan.frames.map((f) => {
      const n = (seen.get(f.key) ?? 0) + 1;
      seen.set(f.key, n);
      return `${f.key}#${n}`;
    });
  };
  const designKeys = new Map(designs.map((d) => [d, keysOf(d)]));
  for (const d of designs) for (const k of designKeys.get(d)!) {
    const set = occurrences.get(k) ?? new Set<string>();
    set.add(d.key);
    occurrences.set(k, set);
  }
  const families = new Map<string, Design[]>();
  for (const d of designs) {
    const common = share ? designKeys.get(d)!.filter((k) => occurrences.get(k)!.size > 1).sort().join('\n') : '';
    const fam = common ? `${common}\n${stableStringify(runningHeads(d))}` : `solo:${d.key}`;
    const arr = families.get(fam) ?? [];
    arr.push(d);
    families.set(fam, arr);
  }
  let baseCount = 0;
  const childBySpec = new Map<string, string>();
  for (const [fam, members] of families) {
    if (fam.startsWith('solo:') || members.length < 2) {
      for (const d of members) {
        let n = 0;
        for (const f of d.plan.frames.slice().sort(byPosition)) f.name = `text-${++n}`;
        const id = idFor(d);
        const decoration = remapDecorationAnchors(d.plan.decoration, d.plan.movedTo, d.plan.frames);
        const { frames, variants } = framesPatch(d.plan.frames);
        const t: PageTemplate = {
          id,
          name: `${id} (${d.styleIds.join(', ')})`,
          ...runningHeads(d),
          decoration: { elements: decoration },
          frames: [FLOW_FRAME, ...frames],
          ...(variants ? { variants } : {}),
        };
        list.push(t);
        d.template = id;
        d.attrNames = attrNamesOf([t]);
      }
      continue;
    }
    // A base with the shared frames and the decoration every member has.
    const sharedKeys = new Set(fam.split('\n').slice(0, -1));
    const first = members[0]!;
    const firstKeys = designKeys.get(first)!;
    const baseFrames = first.plan.frames.filter((_, i) => sharedKeys.has(firstKeys[i]!)).slice().sort(byPosition);
    const nameOfKey = new Map<string, string>();
    baseFrames.forEach((f, i) => nameOfKey.set(firstKeys[first.plan.frames.indexOf(f)]!, `shared-${i + 1}`));
    for (const d of members) {
      const keys = designKeys.get(d)!;
      d.plan.frames.forEach((f, i) => {
        const shared = nameOfKey.get(keys[i]!);
        if (shared) f.name = shared;
      });
      let n = 0;
      for (const f of d.plan.frames.slice().sort(byPosition)) if (!f.name) f.name = `text-${++n}`;
    }
    // Decoration every member draws (ids aside): the base's, under the
    // first member's ids.
    const NO_ID = new Set(['id']);
    const decos = members.map((d) => remapDecorationAnchors(d.plan.decoration, d.plan.movedTo, d.plan.frames));
    const decoStrings = decos.map((list) => list.map((e) => stableStringify(e, NO_ID)));
    const countOf = (list: string[]) => list.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
    const counts = decoStrings.map(countOf);
    const shared = new Map<string, number>();
    for (const [k, n] of counts[0]!) shared.set(k, Math.min(n, ...counts.slice(1).map((c) => c.get(k) ?? 0)));
    const commonIdx: Set<number>[] = decoStrings.map((list) => {
      const left = new Map(shared);
      const picked = new Set<number>();
      list.forEach((k, i) => {
        const n = left.get(k) ?? 0;
        if (n > 0) { picked.add(i); left.set(k, n - 1); }
      });
      return picked;
    });
    const common = decos[0]!.filter((_, i) => commonIdx[0]!.has(i));
    const baseId = freeId(baseCount++ === 0 ? 'page-base' : `page-base-${baseCount}`, taken);
    const baseFramesCfg = framesPatch(baseFrames);
    const base: PageTemplate = {
      id: baseId,
      name: `Shared frames (${members.length} pages)`,
      ...runningHeads(first),
      decoration: { elements: common },
      frames: [FLOW_FRAME, ...baseFramesCfg.frames],
      ...(baseFramesCfg.variants ? { variants: baseFramesCfg.variants } : {}),
    };
    list.push(base);
    members.forEach((d, mi) => {
      const keys = designKeys.get(d)!;
      const own = d.plan.frames.filter((_, i) => !sharedKeys.has(keys[i]!));
      // A shared element goes by the base's id: anchors to it follow.
      const renamed = new Map<string, string>();
      const firstShared = decos[0]!.filter((_, i) => commonIdx[0]!.has(i));
      decos[mi]!.filter((_, i) => commonIdx[mi]!.has(i)).forEach((e, j) => { if (firstShared[j] && firstShared[j]!.id !== e.id) renamed.set(e.id, firstShared[j]!.id); });
      const ownDeco = decos[mi]!.filter((_, i) => !commonIdx[mi]!.has(i)).map((e) => {
        const to = e.placement?.anchor?.to;
        const target = typeof to === 'string' && to.startsWith('#') ? renamed.get(to.slice(1)) : undefined;
        return target ? ({ ...e, placement: { ...e.placement, anchor: { ...e.placement.anchor, to: `#${target}` } } } as DesignElement) : e;
      });
      if (own.length === 0 && ownDeco.length === 0) {
        d.template = baseId;
        d.attrNames = attrNamesOf([base]);
        return;
      }
      const patch = framesPatch(own);
      const spec = stableStringify({ patch, ownDeco, own: own.map((f) => f.key) });
      const known = childBySpec.get(spec);
      if (known) {
        d.template = known;
        d.attrNames = attrNamesOf([base, list.find((t) => t.id === known)!]);
        return;
      }
      const id = idFor(d);
      const child: PageTemplate = {
        id,
        name: `${id} (${d.styleIds.join(', ')})`,
        extends: baseId,
        ...(ownDeco.length > 0 ? { decoration: { elements: ownDeco } } : {}),
        ...(patch.frames.length > 0 ? { frames: patch.frames } : {}),
        ...(patch.variants ? { variants: patch.variants } : {}),
      };
      list.push(child);
      childBySpec.set(spec, id);
      d.template = id;
      d.attrNames = attrNamesOf([base, child]);
    });
  }
  return { list };
}

function byPosition(a: PlannedFrame, b: PlannedFrame): number {
  const ay = a.pieces[0]!.y ?? Infinity;
  const by = b.pieces[0]!.y ?? Infinity;
  return ay - by || (a.pieces[0]!.x ?? 0) - (b.pieces[0]!.x ?? 0);
}

/** Migrated heading styles that came out the same are one: the id their
 *  ids share before `--` when it is free (`tema--p04`, `tema--p05` →
 *  `tema`), else the first one's. */
function mergeStyles(styles: HeadingStyleConfig[], migrated: Set<string>): { styles: HeadingStyleConfig[]; renames: Map<string, string>; merged: { into: string; from: string[] }[] } {
  const groups = new Map<string, HeadingStyleConfig[]>();
  for (const s of styles) {
    if (!migrated.has(s.id)) continue;
    const prefix = s.id.includes('--') ? s.id.slice(0, s.id.lastIndexOf('--')) : s.id;
    const key = `${prefix}\n${stableStringify(s, new Set(['id', 'name']))}`;
    const g = groups.get(key) ?? [];
    g.push(s);
    groups.set(key, g);
  }
  const ids = new Set(styles.map((s) => s.id));
  const renames = new Map<string, string>();
  const merged: { into: string; from: string[] }[] = [];
  const keepAs = new Map<string, HeadingStyleConfig>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const prefixes = new Set(g.map((s) => (s.id.includes('--') ? s.id.slice(0, s.id.lastIndexOf('--')) : null)));
    const prefix = prefixes.size === 1 ? [...prefixes][0] : null;
    const into = prefix && (!ids.has(prefix) || g.some((s) => s.id === prefix)) ? prefix : g[0]!.id;
    ids.add(into);
    const kept: HeadingStyleConfig = { ...g[0]!, id: into, name: into === g[0]!.id ? (g[0]!.name ?? into) : into };
    keepAs.set(g[0]!.id, kept);
    const from = g.map((s) => s.id).filter((id) => id !== into);
    for (const s of g) if (s.id !== into) renames.set(s.id, into);
    merged.push({ into, from });
  }
  const grouped = new Set(merged.flatMap((m) => [m.into, ...m.from]));
  const out: HeadingStyleConfig[] = [];
  for (const s of styles) {
    const kept = keepAs.get(s.id);
    if (kept) out.push(kept);
    else if (!grouped.has(s.id)) out.push(s);
  }
  return { styles: out, renames, merged };
}

/** `style="old"` on a heading line names the merged style. */
function renameStyles(markdown: string, renames: Map<string, string>): string {
  if (renames.size === 0) return markdown;
  return markdown.split('\n').map((line) => {
    if (!/^#{1,6}[ \t]/.test(line) || !line.trimEnd().endsWith('}')) return line;
    return line.replace(/(\bstyle\s*=\s*)("([^"]*)"|'([^']*)'|([^\s}"']+))/, (m, pre: string, _v: string, a?: string, b?: string, c?: string) => {
      const id = a ?? b ?? c ?? '';
      const to = renames.get(id);
      return to ? `${pre}"${to}"` : m;
    });
  }).join('\n');
}
