/**
 * Configuration values the engine cannot use as written. The engine never
 * fails on them — it numbers in decimal, sets a font stack in its first
 * family, cuts the columns of a one-and-a-half layout at the nearest width
 * both can take, ignores a heading setting it does not know — but a silent
 * substitution is hard to spot, so every one is reported: on
 * `VDTDocument.configWarnings`, and to any host that asks with
 * {@link collectConfigWarnings}.
 */

import type {
  ColumnBalancingConfig,
  HeadingLevelConfig,
  HeadingsConfig,
  HeadingStyleConfig,
  ParagraphStyleConfig,
  PostextConfig,
  ResolvedLayoutConfig,
  ComicsConfig,
  PanelStyleConfig,
  NamedPanelStyleConfig,
  LetteringConfig,
  BalloonStyleConfig,
  ComicCastMember,
  LineNumbersConfig,
  ResolvedLineNumbersConfig,
  CodeStyleConfig,
  InlineCodeStyleConfig,
  CodeTokenStyle,
  TabStop,
  ParagraphDropCap,
  DropCapLeadIn,
  Resource,
  ChecksConfig,
  ContentInConfigCheckConfig,
  DocumentMetadata,
} from './types';
import type { ConfigWarning, ResolvedConfig } from './vdt';
import { parseNumberFormat } from './numbering';
import { parseTocGroupHead } from './defaults/toc';
import { isFontStack, primaryFontFamily } from './measure/font';
import { dimensionToPx } from './units';
import { resolveAllConfig, resolveDirection, resolvedLocale, sideColumnPercentUsed, columnCountUsed } from './pipeline/config';
import { computePageMetrics } from './pipeline/buildHelpers';
import { deriveSectionGeometryConfig } from './pipeline/headingStyles';
import { cjkGridGeometry } from './pipeline/cjkGrid';
import { isDigitSystem } from './locale';
import { defaultEmphasisFor, isEmphasisStyle, isTashkilMode } from './defaults/bodyText';
import { parseFootnoteNumberFormat } from './defaults/footnotes';
import { COMIC_CHOICES, isComicChoice, resolveComicsConfig } from './defaults/comics';
import { resolvePrintConfig } from './defaults/print';
import { CONTRAST_LEVELS, CONTRAST_MODES, DEFAULT_CONTRAST_CONFIG } from './defaults/contrast';
import { isTabStopAlign, parseTabStopPosition } from './defaults/tabStops';
import { resolveContentInConfigCheck } from './defaults/checks';
import { stripPlaceholders } from './pipeline/placeholders';
import { configDesignSlots } from './design/slots';
import { metadataText } from './frontmatter';
import { DROP_CAP_PUNCTUATION, DROP_CAP_SHORT_PARAGRAPH, isDropCap, readDropCap } from './defaults/dropCap';
import { outputProfileInfo } from './color/catalogue';
import { CODE_OVERFLOWS, CODE_TOKEN_KINDS } from './defaults/codeStyle';
import { closestKey } from './util/closestKey';
import { validatePageTemplates } from './composed/validate';
import { LINE_NUMBERS_ALIGNS, LINE_NUMBERS_COUNTS, LINE_NUMBERS_MULTI_COLUMN, LINE_NUMBERS_POSITIONS, LINE_NUMBERS_RESTARTS } from './defaults/lineNumbers';

/** The format fields and the decimal spelling each falls back to. A
 *  `format` is a format field only under `pageNumbering`. */
function numberFormatFallback(key: string, parentKey: string | undefined): string | undefined {
  if (key === 'numberFormat') return 'arabic';
  if (key === 'counterFormat') return 'decimal';
  if (key === 'format' && (parentKey === 'pageNumbering' || parentKey === 'lineNumbers')) return 'decimal';
  return undefined;
}

function isFontFamilyKey(key: string): boolean {
  return key === 'fontFamily' || key.endsWith('FontFamily');
}

/** A percentage as a warning prints it: at most two decimals. */
function percentText(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Walk a config for values the engine replaces: an unknown numbering
 * format (lists, page labels, resource counters — any of their spellings
 * is fine, see `parseNumberFormat`), a CSS font stack in a font-family
 * field, and the `sideColumnPercent` of a one-and-a-half layout — the
 * document's, and every heading style's own `layout` — that would leave
 * one of the columns with no width (see `sideColumnPercentUsed`). Every
 * nested partial config is covered (heading styles, part list overrides,
 * `htmlViewer.overrides`, design elements). Also a key the heading
 * settings or a paragraph style do not have (`unknownConfigKey`:
 * `headings`, its `balancing` and `levels`, `headingStyles`,
 * `paragraphStyles`). And a setting with a value outside its choices
 * (`unknownConfigValue`: `direction`, the comics settings' words), and a `numerals` value that names
 * no digit system (`unknownNumerals`). And the design texts that hold
 * the book's content instead of placeholders (`contentInConfig`, #849,
 * tuned by `checks.contentInConfig`). Pure.
 */
export function collectConfigWarnings(config: PostextConfig | undefined, options: ConfigWarningOptions = {}): ConfigWarning[] {
  if (!config) return [];
  return [
    ...collectValueWarnings(config), ...collectSideColumnWarnings(config), ...collectColumnCountWarnings(config), ...collectUnknownKeyWarnings(config),
    ...collectCjkGridWarnings(config), ...collectChoiceWarnings(config), ...collectNumeralsWarnings(config),
    ...collectPageTemplateWarnings(config, options),
    ...collectContentInConfigWarnings(config, options),
  ];
}

/** What else the config checks may read. */
export interface ConfigWarningOptions {
  /** The book's resources: an anchor's label `style` is checked against
   *  `labelStyles` (`labelStyleUnknown`). */
  resources?: readonly Resource[];
  /** The document's metadata (its front matter): its `title`, `subtitle`,
   *  `author` and `publisher` are allowed in a design text as if listed in
   *  `checks.contentInConfig.allow`, since a running head often repeats
   *  them. */
  metadata?: DocumentMetadata;
}

/** Page templates and label styles (#853): see `validatePageTemplates`.
 *  Lengths in different units are compared at the page's dpi, an em at
 *  the body text's size. */
function collectPageTemplateWarnings(config: PostextConfig, options: ConfigWarningOptions): ConfigWarning[] {
  const overrides = config.htmlViewer?.overrides;
  const any = config.pageTemplates !== undefined || config.labelStyles !== undefined
    || overrides?.pageTemplates !== undefined || overrides?.labelStyles !== undefined
    || (options.resources ?? []).some((r) => r.anchors?.some((a) => a.style !== undefined));
  if (!any) return [];
  const resolved = resolveAllConfig(config);
  const dpi = resolved.page.dpi;
  const baseFontSizePx = dimensionToPx(resolved.bodyText.fontSize, dpi, 16);
  return validatePageTemplates(config, { resources: options.resources, dpi, baseFontSizePx });
}

/** Settings whose value is one of a few words: one written otherwise is
 *  read as the default, and `used` names what that default came to. */
function collectChoiceWarnings(config: PostextConfig): ConfigWarning[] {
  const out: ConfigWarning[] = [];
  const direction = config.direction as unknown;
  if (direction !== undefined && direction !== 'auto' && direction !== 'ltr' && direction !== 'rtl') {
    const used = resolveDirection(undefined, resolvedLocale(resolveAllConfig(config)));
    out.push({ kind: 'unknownConfigValue', path: 'direction', value: String(direction), used });
  }
  // `*…*` and the Arabic vowel marks (#376).
  const emphasis = config.bodyText?.emphasis as unknown;
  if (emphasis !== undefined && emphasis !== 'auto' && !isEmphasisStyle(emphasis)) {
    out.push({ kind: 'unknownConfigValue', path: 'bodyText.emphasis', value: String(emphasis), used: defaultEmphasisFor(config.locale) });
  }
  const tashkil = config.bodyText?.tashkil as unknown;
  if (tashkil !== undefined && !isTashkilMode(tashkil)) {
    out.push({ kind: 'unknownConfigValue', path: 'bodyText.tashkil', value: String(tashkil), used: 'keep' });
  }
  const kashida = config.bodyText?.kashida as unknown;
  if (kashida !== undefined && kashida !== 'auto' && kashida !== 'none') {
    const used = resolveAllConfig(config).bodyText.kashida ?? 'none';
    out.push({ kind: 'unknownConfigValue', path: 'bodyText.kashida', value: String(kashida), used });
  }
  const patterns = config.bodyText?.kashidaPatterns as unknown;
  if (patterns !== undefined && patterns !== 'auto' && patterns !== 'naskh' && patterns !== 'simple' && patterns !== 'nastaliq') {
    out.push({ kind: 'unknownConfigValue', path: 'bodyText.kashidaPatterns', value: String(patterns), used: 'auto' });
  }
  // The level of a composition rule (#749): read as `'allow'`, the rule off.
  const rule = (path: string, value: unknown) => {
    if (value !== undefined && value !== 'allow' && value !== 'warn' && value !== 'avoid') {
      out.push({ kind: 'unknownConfigValue', path, value: String(value), used: 'allow' });
    }
  };
  rule('bodyText.shortListSplit', config.bodyText?.shortListSplit);
  rule('layout.openerFloats', config.layout?.openerFloats);
  // What heads a block of the contents (#850): read as `'part'`.
  const tocHead = config.toc?.groups?.head as unknown;
  if (tocHead !== undefined && parseTocGroupHead(tocHead) === undefined) {
    out.push({ kind: 'unknownConfigValue', path: 'toc.groups.head', value: String(tocHead), used: 'part' });
  }
  // Where a heading's number stands (#401).
  const position = (path: string, value: unknown) => {
    if (value !== undefined && value !== 'before' && value !== 'replace') {
      out.push({ kind: 'unknownConfigValue', path, value: String(value), used: 'before' });
    }
  };
  (config.headings?.levels ?? []).forEach((l, i) => position(`headings.levels[${i}].numberPosition`, (l as { numberPosition?: unknown }).numberPosition));
  (config.headingStyles ?? []).forEach((st, i) => position(`headingStyles[${i}].numberPosition`, (st as { numberPosition?: unknown }).numberPosition));
  // Sidenotes on the spread (傍注, JLReq §4.2.6) are a vertical book's: a
  // horizontal document sets them at the column foot.
  if (config.footnotes?.placement === 'spread' && resolveAllConfig(config).layout.writingMode !== 'vertical-rl') {
    out.push({ kind: 'unknownConfigValue', path: 'footnotes.placement', value: 'spread', used: 'column' });
  }
  out.push(...collectComicChoiceWarnings(config));
  out.push(...collectPrintChoiceWarnings(config));
  out.push(...collectContrastChoiceWarnings(config));
  out.push(...collectChecksValueWarnings(config));
  out.push(...collectLineNumbersWarnings(config));
  out.push(...collectWrapWarnings(config));
  out.push(...collectCodeStyleWarnings(config));
  out.push(...collectTabStopWarnings(config));
  out.push(...collectDropCapWarnings(config));
  return out;
}

/** The drop cap settings of a config (#623): each paragraph style's, each
 *  heading level's and each heading style's (and those of the HTML
 *  viewer's overrides), with their paths. */
function dropCapSettings(config: PostextConfig): { cap: ParagraphDropCap; path: string }[] {
  const out: { cap: ParagraphDropCap; path: string }[] = [];
  const add = (cap: unknown, path: string) => {
    if (isDropCap(cap)) out.push({ cap, path });
  };
  const from = (c: Pick<PostextConfig, 'headings' | 'headingStyles' | 'paragraphStyles'> | undefined, prefix: string) => {
    if (!c) return;
    (c.paragraphStyles ?? []).forEach((s, i) => add((s as { dropCap?: unknown } | undefined)?.dropCap, `${prefix}paragraphStyles[${i}].dropCap`));
    const levels = (c.headings as { levels?: unknown } | undefined)?.levels;
    if (Array.isArray(levels)) levels.forEach((l, i) => add((l as { dropCap?: unknown } | undefined)?.dropCap, `${prefix}headings.levels[${i}].dropCap`));
    (c.headingStyles ?? []).forEach((s, i) => add((s as { dropCap?: unknown } | undefined)?.dropCap, `${prefix}headingStyles[${i}].dropCap`));
  };
  from(config, '');
  from(config.htmlViewer?.overrides, 'htmlViewer.overrides.');
  return out;
}

/** A drop cap whose `punctuation` or `shortParagraph` is not one of its
 *  words, or whose `lines`, `sink` or `characters` is no whole number from
 *  1 (#623): the default is used. */
function collectDropCapWarnings(config: PostextConfig): ConfigWarning[] {
  const out: ConfigWarning[] = [];
  for (const { cap, path } of dropCapSettings(config)) {
    const read = readDropCap(cap);
    if (cap.punctuation !== undefined && !(DROP_CAP_PUNCTUATION as readonly unknown[]).includes(cap.punctuation)) {
      const suggestion = closestKey(String(cap.punctuation), DROP_CAP_PUNCTUATION);
      out.push({ kind: 'unknownConfigValue', path: `${path}.punctuation`, value: String(cap.punctuation), used: read.punctuation, ...(suggestion ? { suggestion } : {}) });
    }
    if (cap.shortParagraph !== undefined && !(DROP_CAP_SHORT_PARAGRAPH as readonly unknown[]).includes(cap.shortParagraph)) {
      const suggestion = closestKey(String(cap.shortParagraph), DROP_CAP_SHORT_PARAGRAPH);
      out.push({ kind: 'unknownConfigValue', path: `${path}.shortParagraph`, value: String(cap.shortParagraph), used: read.shortParagraph, ...(suggestion ? { suggestion } : {}) });
    }
    for (const key of ['lines', 'sink', 'characters'] as const) {
      const v: unknown = cap[key];
      if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && v >= 1)) {
        out.push({ kind: 'unknownConfigValue', path: `${path}.${key}`, value: String(v), used: String(read[key]) });
      }
    }
  }
  return out;
}

/** The tab stop lists of a config (#622): the body's, each paragraph
 *  style's and each callout body's, with their paths. */
function tabStopLists(config: PostextConfig): { stops: unknown[]; path: string }[] {
  const out: { stops: unknown[]; path: string }[] = [];
  const add = (stops: unknown, path: string) => {
    if (Array.isArray(stops)) out.push({ stops, path });
  };
  add(config.bodyText?.tabStops, 'bodyText.tabStops');
  (config.paragraphStyles ?? []).forEach((s, i) => add((s as { tabStops?: unknown } | undefined)?.tabStops, `paragraphStyles[${i}].tabStops`));
  (config.calloutStyles ?? []).forEach((s, i) => add((s as { body?: { tabStops?: unknown } } | undefined)?.body?.tabStops, `calloutStyles[${i}].body.tabStops`));
  return out;
}

/** A tab stop whose `align` is not one of its words (read as `'start'`),
 *  or whose `position` is no length, `'end'` or percentage (the stop is
 *  left out: `used` `'none'`). */
function collectTabStopWarnings(config: PostextConfig): ConfigWarning[] {
  const out: ConfigWarning[] = [];
  for (const { stops, path } of tabStopLists(config)) {
    stops.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return;
      const stop = raw as { position?: unknown; align?: unknown };
      if (stop.align !== undefined && !isTabStopAlign(stop.align)) {
        out.push({ kind: 'unknownConfigValue', path: `${path}[${i}].align`, value: String(stop.align), used: 'start' });
      }
      if (parseTabStopPosition(stop.position) === undefined) {
        out.push({ kind: 'unknownConfigValue', path: `${path}[${i}].position`, value: typeof stop.position === 'object' ? JSON.stringify(stop.position) : String(stop.position), used: 'none' });
      }
    });
  }
  return out;
}

/** The line number settings that take one of a few words (#621), and line
 *  numbers asked of a vertical document, which gets none
 *  (`lineNumbersUnsupported`). */
function collectLineNumbersWarnings(config: PostextConfig): ConfigWarning[] {
  const ln = config.lineNumbers as unknown;
  if (!ln || typeof ln !== 'object' || Array.isArray(ln)) return [];
  const c = ln as LineNumbersConfig;
  const out: ConfigWarning[] = [];
  let resolved: ResolvedLineNumbersConfig | undefined;
  const res = () => (resolved ??= resolveAllConfig(config).lineNumbers!);
  const check = (value: unknown, choices: readonly string[], key: keyof LineNumbersConfig): void => {
    if (value === undefined || (typeof value === 'string' && choices.includes(value))) return;
    const written = String(value);
    const suggestion = closestKey(written, choices);
    out.push({ kind: 'unknownConfigValue', path: `lineNumbers.${key}`, value: written, used: String(res()[key as keyof ResolvedLineNumbersConfig]), ...(suggestion ? { suggestion } : {}) });
  };
  check(c.count, LINE_NUMBERS_COUNTS, 'count');
  check(c.restart, LINE_NUMBERS_RESTARTS, 'restart');
  check(c.position, LINE_NUMBERS_POSITIONS, 'position');
  check(c.multiColumn, LINE_NUMBERS_MULTI_COLUMN, 'multiColumn');
  check(c.align, LINE_NUMBERS_ALIGNS, 'align');
  if (c.enabled === true && resolveAllConfig(config).layout.writingMode === 'vertical-rl') {
    out.push({ kind: 'lineNumbersUnsupported', path: 'lineNumbers.enabled', value: 'true', used: 'false' });
  }
  return out;
}

const WRAP_SIDES = ['none', 'left', 'right', 'start', 'end'] as const;

/** Text wrap (#627): a resource type's `defaultPlacement.wrap` that is no
 *  side (`unknownConfigValue`), and one asked of a vertical document,
 *  which sets no text beside a figure (`wrapUnsupported`). */
function collectWrapWarnings(config: PostextConfig): ConfigWarning[] {
  const types = config.resourceTypes;
  if (!Array.isArray(types)) return [];
  const out: ConfigWarning[] = [];
  let vertical: boolean | undefined;
  types.forEach((t, i) => {
    const wrap = (t as { defaultPlacement?: { wrap?: unknown } } | undefined)?.defaultPlacement?.wrap;
    if (wrap === undefined || wrap === 'none') return;
    const path = `resourceTypes[${i}].defaultPlacement.wrap`;
    if (typeof wrap !== 'string' || !(WRAP_SIDES as readonly string[]).includes(wrap)) {
      const suggestion = closestKey(String(wrap), WRAP_SIDES);
      out.push({ kind: 'unknownConfigValue', path, value: String(wrap), used: 'none', ...(suggestion ? { suggestion } : {}) });
      return;
    }
    vertical ??= resolveAllConfig(config).layout.writingMode === 'vertical-rl';
    if (vertical) out.push({ kind: 'wrapUnsupported', path, value: wrap, used: 'none' });
  });
  return out;
}

/** The code style settings that take one of a few words (#624). */
function collectCodeStyleWarnings(config: PostextConfig): ConfigWarning[] {
  const cs = config.codeStyle as unknown;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return [];
  const c = cs as CodeStyleConfig;
  const out: ConfigWarning[] = [];
  const check = (value: unknown, choices: readonly string[], key: string, used: string): void => {
    if (value === undefined || (typeof value === 'string' && choices.includes(value))) return;
    const written = String(value);
    const suggestion = closestKey(written, choices);
    out.push({ kind: 'unknownConfigValue', path: `codeStyle.${key}`, value: written, used, ...(suggestion ? { suggestion } : {}) });
  };
  check(c.overflow, CODE_OVERFLOWS, 'overflow', 'wrap');
  check(c.highlight, ['builtin', 'none'], 'highlight', 'builtin');
  check(c.span, ['column', 'page'], 'span', 'column');
  return out;
}

/** The print settings that take one of a few words (#602): the PDF/X
 *  standard, the output profile (a catalogue id, or `custom` with an
 *  uploaded profile) and the rendering intent. */
function collectPrintChoiceWarnings(config: PostextConfig): ConfigWarning[] {
  const out: ConfigWarning[] = [];
  const p = config.print;
  if (!p) return out;
  const standard = p.standard as unknown;
  if (standard !== undefined && standard !== 'none' && standard !== 'pdfx1a' && standard !== 'pdfx4') {
    out.push({ kind: 'unknownConfigValue', path: 'print.standard', value: String(standard), used: 'none' });
  }
  const profile = p.outputProfile as unknown;
  if (profile !== undefined) {
    const known = profile === 'custom' ? !!p.customProfile : typeof profile === 'string' && !!outputProfileInfo(profile);
    if (!known) out.push({ kind: 'unknownConfigValue', path: 'print.outputProfile', value: String(profile), used: resolvePrintConfig(p).outputProfile });
  }
  const intent = p.renderingIntent as unknown;
  if (intent !== undefined && intent !== 'relative' && intent !== 'perceptual') {
    out.push({ kind: 'unknownConfigValue', path: 'print.renderingIntent', value: String(intent), used: 'relative' });
  }
  return out;
}

/** The contrast check's level and mode (#748): one written otherwise
 *  reads as the default. */
function collectContrastChoiceWarnings(config: PostextConfig): ConfigWarning[] {
  const out: ConfigWarning[] = [];
  const c = config.contrast;
  if (!c) return out;
  const level = c.level as unknown;
  if (level !== undefined && !(CONTRAST_LEVELS as readonly unknown[]).includes(level)) {
    out.push({ kind: 'unknownConfigValue', path: 'contrast.level', value: String(level), used: DEFAULT_CONTRAST_CONFIG.level });
  }
  const mode = c.mode as unknown;
  if (mode !== undefined && !(CONTRAST_MODES as readonly unknown[]).includes(mode)) {
    out.push({ kind: 'unknownConfigValue', path: 'contrast.mode', value: String(mode), used: DEFAULT_CONTRAST_CONFIG.mode });
  }
  return out;
}

/** The comics settings that take one of a few words (#590): the reading
 *  and art directions, a panel style's border style and fit, the
 *  lettering's writing mode, case, final stop and joins, a balloon style's
 *  shape, tail, target, position, alignment and case. `used` is what the
 *  setting resolved to (the default, or the value of the style it is laid
 *  over), `suggestion` the word it is closest to, when one is close. */
function collectComicChoiceWarnings(config: PostextConfig): ConfigWarning[] {
  const comics = config.comics as unknown;
  if (!comics || typeof comics !== 'object' || Array.isArray(comics)) return [];
  const c = comics as ComicsConfig;
  const out: ConfigWarning[] = [];
  let resolved: ReturnType<typeof resolveComicsConfig> | undefined;
  const res = () => (resolved ??= resolveComicsConfig(c, resolvedLocale(resolveAllConfig(config))));
  const check = (value: unknown, choices: readonly string[], path: string, used: () => unknown): void => {
    if (value === undefined || isComicChoice(choices, value)) return;
    const written = String(value);
    const suggestion = closestKey(written, choices);
    out.push({ kind: 'unknownConfigValue', path, value: written, used: String(used()), ...(suggestion ? { suggestion } : {}) });
  };
  const obj = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
  check(c.readingDirection, COMIC_CHOICES.readingDirection, 'comics.readingDirection', () => res().readingDirection);
  check(c.artDirection, COMIC_CHOICES.artDirection, 'comics.artDirection', () => res().artDirection);
  const panel = obj(c.panel);
  if (panel) {
    check(panel.borderStyle, COMIC_CHOICES.borderStyle, 'comics.panel.borderStyle', () => res().panel.borderStyle);
    check(panel.fit, COMIC_CHOICES.fit, 'comics.panel.fit', () => res().panel.fit);
  }
  if (Array.isArray(c.panelStyles)) {
    c.panelStyles.forEach((raw, i) => {
      const s = obj(raw);
      if (!s) return;
      const style = () => res().panelStyles.find((p) => p.id === s.id) ?? res().panel;
      check(s.borderStyle, COMIC_CHOICES.borderStyle, `comics.panelStyles[${i}].borderStyle`, () => style().borderStyle);
      check(s.fit, COMIC_CHOICES.fit, `comics.panelStyles[${i}].fit`, () => style().fit);
    });
  }
  const lettering = obj(c.lettering);
  if (lettering) {
    for (const key of ['writingMode', 'textTransform', 'dropFinalStop', 'joinSameSpeaker'] as const) {
      check(lettering[key], COMIC_CHOICES[key], `comics.lettering.${key}`, () => res().lettering[key]);
    }
  }
  if (Array.isArray(c.balloonStyles)) {
    c.balloonStyles.forEach((raw, i) => {
      const s = obj(raw);
      if (!s) return;
      const style = () => res().balloonStyles.find((b) => b.id === s.id);
      for (const key of ['shape', 'tail', 'target', 'position', 'align'] as const) {
        check(s[key], COMIC_CHOICES[key], `comics.balloonStyles[${i}].${key}`, () => style()?.[key] ?? '');
      }
      // Unset on a resolved style: the lettering's case.
      check(s.textTransform, COMIC_CHOICES.textTransform, `comics.balloonStyles[${i}].textTransform`,
        () => style()?.textTransform ?? res().lettering.textTransform);
    });
  }
  return out;
}

/** A `numerals` value that names no digit system (`'arabic'`, `'hindi'`,
 *  a typo): the digits follow the document language, as with `'auto'`
 *  (`unknownNumerals`, `used` the digit system that gives). */
function collectNumeralsWarnings(config: PostextConfig): ConfigWarning[] {
  const value: unknown = config.numerals;
  if (value === undefined || value === 'auto' || isDigitSystem(value)) return [];
  const used = resolveAllConfig(config).numerals ?? 'latn';
  return [{ kind: 'unknownNumerals', path: 'numerals', value: String(value), used }];
}

// The keys of the heading settings, checked against their types: a key
// added to (or removed from) a type fails to compile until it is listed
// here, so the check never flags a setting the engine reads.
const HEADINGS_KEYS = {
  fontFamily: true, lineHeight: true, color: true, textAlign: true, fontWeight: true,
  marginTop: true, marginBottom: true, keepWithNext: true, keepWithNextSpread: true, keepWithNextSplit: true, snapToGrid: true, columnHeadSpace: true, inlineMarks: true, balancing: true, levels: true,
} satisfies Record<keyof HeadingsConfig, true>;
const BALANCING_KEYS = {
  enabled: true, maxLinesPerHeading: true, maxLinesBeforeLoose: true, stretchAfterLists: true, maxLinesAfterList: true, stretchAfterDisplays: true,
  stretchAfterFloats: true, maxLinesAfterFloat: true, stretchAfterWideFloats: true, looseParagraphs: true, maxLooseParagraphs: true,
  trackParagraphs: true, maxTracking: true, trailing: true, trailingStep: true, beforeSpan: true, closingBox: true, gridLines: true,
} satisfies Record<keyof ColumnBalancingConfig, true>;
const HEADING_LEVEL_KEYS = {
  level: true, fontSize: true, lineHeight: true, fontFamily: true, color: true, fontWeight: true,
  marginTop: true, marginBottom: true, numberingTemplate: true, numberSeparator: true, numberPosition: true, italic: true, letterSpacing: true,
  breakBefore: true, span: true, spanBreak: true, advancedDesign: true, textTransform: true, hidden: true, snapToGrid: true,
  lineSpan: true, indent: true, firstLineIndent: true, jidori: true, dropCap: true,
} satisfies Record<keyof HeadingLevelConfig, true>;
const HEADING_STYLE_KEYS = {
  id: true, name: true, numberingTemplate: true, numbered: true, toc: true, runningChapter: true, header: true, footer: true,
  margins: true, layout: true, bodyStyle: true, palette: true,
  fontSize: true, lineHeight: true, fontFamily: true, color: true, fontWeight: true, marginTop: true,
  marginBottom: true, numberSeparator: true, numberPosition: true, italic: true, letterSpacing: true, breakBefore: true, span: true, spanBreak: true,
  advancedDesign: true, textTransform: true, hidden: true, snapToGrid: true, lineSpan: true, indent: true, firstLineIndent: true, jidori: true,
  dropCap: true,
} satisfies Record<keyof HeadingStyleConfig, true>;
const PARAGRAPH_STYLE_KEYS = {
  id: true, name: true, fontFamily: true, fontSize: true, lineHeight: true, color: true, textAlign: true,
  boldColor: true, italicColor: true, fontWeight: true, boldFontWeight: true, italic: true, smallCaps: true,
  hyphenation: true, indent: true, endIndent: true, firstLineIndent: true, hangingIndent: true, spaceBetween: true,
  marginTop: true, marginBottom: true, snapToGrid: true, containerSpacing: true, textTransform: true, wordBreak: true, lineNumbers: true,
  tabStops: true, tabInterval: true, dropCap: true,
} satisfies Record<keyof ParagraphStyleConfig, true>;
// A body paragraph's drop cap (#623) and its lead-in.
const DROP_CAP_KEYS = {
  lines: true, sink: true, characters: true, fontFamily: true, fontWeight: true, italic: true, fontSize: true,
  color: true, gap: true, punctuation: true, leadIn: true, shortParagraph: true, each: true,
} satisfies Record<keyof ParagraphDropCap, true>;
const DROP_CAP_LEAD_IN_KEYS = { words: true, smallCaps: true, uppercase: true } satisfies Record<keyof DropCapLeadIn, true>;
// A tab stop (#622).
const TAB_STOP_KEYS = {
  position: true, align: true, leader: true, leaderGap: true, decimalChar: true,
} satisfies Record<keyof TabStop, true>;

// The checks of the configuration (#849).
const CHECKS_KEYS = { contentInConfig: true } satisfies Record<keyof ChecksConfig, true>;
const CONTENT_IN_CONFIG_KEYS = { enabled: true, allow: true, maxWords: true, maxChars: true } satisfies Record<keyof ContentInConfigCheckConfig, true>;

// Line numbers (#621).
const LINE_NUMBERS_KEYS = {
  enabled: true, count: true, interval: true, numberFirst: true, restart: true, startAt: true, position: true,
  multiColumn: true, gap: true, align: true, fontFamily: true, fontSize: true, fontWeight: true, italic: true,
  color: true, format: true,
} satisfies Record<keyof LineNumbersConfig, true>;

// Code listings and inline code (#624).
const CODE_STYLE_KEYS = {
  blocks: true, indentedCode: true, fontFamily: true, fontSize: true, fontWeight: true, boldFontWeight: true,
  lineHeight: true, snapToGrid: true, color: true, backgroundEnabled: true, background: true, padding: true,
  border: true, borderRadius: true, marginTop: true, marginBottom: true, span: true, tabSize: true, overflow: true,
  wrapIndent: true, wrapMarker: true, minFontScale: true, lineNumbers: true, lineNumberColor: true,
  lineNumberGap: true, highlightBackground: true, keepTogether: true, splitMinLines: true, repeatTitle: true,
  continuesMarkerEnabled: true, continuesMarker: true, titleStyle: true, label: true, highlight: true, tokens: true,
  inline: true,
} satisfies Record<keyof CodeStyleConfig, true>;
const CODE_TOKEN_STYLE_KEYS = { color: true, bold: true, italic: true } satisfies Record<keyof CodeTokenStyle, true>;
const INLINE_CODE_KEYS = {
  fontFamily: true, fontSize: true, color: true, bold: true, italic: true, background: true, borderColor: true,
  borderWidth: true, borderRadius: true, paddingX: true, paddingY: true,
} satisfies Record<keyof InlineCodeStyleConfig, true>;
const CODE_TOKEN_KIND_KEYS: Record<string, true> = Object.fromEntries(CODE_TOKEN_KINDS.map((k) => [k, true]));

// The comics tables (#562).
const COMICS_KEYS = {
  readingDirection: true, artDirection: true, mirrorArt: true, frame: true, gutter: true, panel: true,
  panelStyles: true, lettering: true, balloonStyles: true, cast: true, runningHeads: true, viewerLeaf: true,
} satisfies Record<keyof ComicsConfig, true>;
const COMICS_FRAME_KEYS = { margins: true } satisfies Record<keyof NonNullable<ComicsConfig['frame']>, true>;
const COMICS_GUTTER_KEYS = { horizontal: true, vertical: true } satisfies Record<keyof NonNullable<ComicsConfig['gutter']>, true>;
const PANEL_STYLE_KEYS = {
  borderWidth: true, borderColor: true, borderRadius: true, borderStyle: true, background: true, fit: true, bleed: true,
} satisfies Record<keyof PanelStyleConfig, true>;
const NAMED_PANEL_STYLE_KEYS = { ...PANEL_STYLE_KEYS, id: true, name: true } satisfies Record<keyof NamedPanelStyleConfig, true>;
const LETTERING_KEYS = {
  fontFamily: true, fontSize: true, lineHeight: true, color: true, bold: true, italic: true, letterSpacing: true,
  writingMode: true, textTransform: true, dropFinalStop: true, doubleDash: true, inset: true, joinSameSpeaker: true,
  maxColumnChars: true, strictPlacement: true,
} satisfies Record<keyof LetteringConfig, true>;
const BALLOON_STYLE_KEYS = {
  id: true, name: true, shape: true, fill: true, stroke: true, strokeWidth: true, dash: true, double: true, wobble: true,
  roundness: true, burstPoints: true, burstDepth: true, padding: true, aspect: true, tail: true, tailWidth: true,
  tailReach: true, target: true, position: true, butt: true, fontFamily: true, fontScale: true, bold: true, italic: true,
  color: true, textTransform: true, letterSpacing: true, align: true, halo: true, haloColor: true, rotate: true, skew: true,
} satisfies Record<keyof BalloonStyleConfig, true>;
const CAST_KEYS = {
  id: true, name: true, balloonStyle: true, color: true, fill: true, fontFamily: true,
} satisfies Record<keyof ComicCastMember, true>;

/**
 * Keys the heading settings do not have (EF-83), or a paragraph style
 * (EF-173): the engine reads the settings it knows and drops the rest, so
 * a misspelt or invented one (`letterSpacng`, `tracking`, a paragraph
 * style's `fontStyle`) used to change nothing without a word. The
 * `headings` section, its `balancing` and `levels`, every heading style
 * and every paragraph style are checked, in the document config and in
 * `htmlViewer.overrides`.
 */
function collectUnknownKeyWarnings(config: PostextConfig): ConfigWarning[] {
  const out: ConfigWarning[] = [];
  const check = (node: unknown, known: Record<string, true>, path: string): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const names = Object.keys(known);
    for (const [key, value] of Object.entries(node)) {
      // A key set to `undefined` sets nothing either way.
      if (value === undefined || Object.prototype.hasOwnProperty.call(known, key)) continue;
      const suggestion = closestKey(key, names);
      out.push({ kind: 'unknownConfigKey', path: `${path}.${key}`, value: key, used: '', ...(suggestion ? { suggestion } : {}) });
    }
  };
  const checkConfig = (c: Pick<PostextConfig, 'headings' | 'headingStyles' | 'paragraphStyles'> | undefined, prefix: string): void => {
    if (!c) return;
    const headings = c.headings as unknown;
    if (headings && typeof headings === 'object' && !Array.isArray(headings)) {
      const h = headings as HeadingsConfig;
      check(h, HEADINGS_KEYS, `${prefix}headings`);
      check(h.balancing, BALANCING_KEYS, `${prefix}headings.balancing`);
      if (Array.isArray(h.levels)) h.levels.forEach((l, i) => check(l, HEADING_LEVEL_KEYS, `${prefix}headings.levels[${i}]`));
    }
    if (Array.isArray(c.headingStyles)) c.headingStyles.forEach((s, i) => check(s, HEADING_STYLE_KEYS, `${prefix}headingStyles[${i}]`));
    if (Array.isArray(c.paragraphStyles)) c.paragraphStyles.forEach((s, i) => check(s, PARAGRAPH_STYLE_KEYS, `${prefix}paragraphStyles[${i}]`));
  };
  checkConfig(config, '');
  checkConfig(config.htmlViewer?.overrides, 'htmlViewer.overrides.');
  for (const { stops, path } of tabStopLists(config)) stops.forEach((st, i) => check(st, TAB_STOP_KEYS, `${path}[${i}]`));
  for (const { cap, path } of dropCapSettings(config)) {
    check(cap, DROP_CAP_KEYS, path);
    check(cap.leadIn, DROP_CAP_LEAD_IN_KEYS, `${path}.leadIn`);
  }
  check(config.lineNumbers, LINE_NUMBERS_KEYS, 'lineNumbers');
  // The checks of the configuration (#849).
  check(config.checks, CHECKS_KEYS, 'checks');
  check(config.checks?.contentInConfig, CONTENT_IN_CONFIG_KEYS, 'checks.contentInConfig');
  // Code listings (#624): the section, its token kinds and inline code.
  const codeStyle = config.codeStyle as unknown;
  if (codeStyle && typeof codeStyle === 'object' && !Array.isArray(codeStyle)) {
    const c = codeStyle as CodeStyleConfig;
    check(c, CODE_STYLE_KEYS, 'codeStyle');
    check(c.tokens, CODE_TOKEN_KIND_KEYS, 'codeStyle.tokens');
    if (c.tokens && typeof c.tokens === 'object') {
      for (const [kind, look] of Object.entries(c.tokens)) {
        if (CODE_TOKEN_KIND_KEYS[kind]) check(look, CODE_TOKEN_STYLE_KEYS, `codeStyle.tokens.${kind}`);
      }
    }
    check(c.inline, INLINE_CODE_KEYS, 'codeStyle.inline');
  }
  // Comics: the section, its frame, gutters, panel styles, lettering,
  // balloon styles and cast.
  const comics = config.comics as unknown;
  if (comics && typeof comics === 'object' && !Array.isArray(comics)) {
    const c = comics as ComicsConfig;
    check(c, COMICS_KEYS, 'comics');
    check(c.frame, COMICS_FRAME_KEYS, 'comics.frame');
    check(c.gutter, COMICS_GUTTER_KEYS, 'comics.gutter');
    check(c.panel, PANEL_STYLE_KEYS, 'comics.panel');
    if (Array.isArray(c.panelStyles)) c.panelStyles.forEach((s, i) => check(s, NAMED_PANEL_STYLE_KEYS, `comics.panelStyles[${i}]`));
    check(c.lettering, LETTERING_KEYS, 'comics.lettering');
    if (Array.isArray(c.balloonStyles)) c.balloonStyles.forEach((s, i) => check(s, BALLOON_STYLE_KEYS, `comics.balloonStyles[${i}]`));
    if (Array.isArray(c.cast)) c.cast.forEach((s, i) => check(s, CAST_KEYS, `comics.cast[${i}]`));
  }
  return out;
}

/** The format and font-family values of `config`, walked field by field. */
function collectValueWarnings(config: PostextConfig): ConfigWarning[] {
  const out: ConfigWarning[] = [];
  // The objects on the current path: a shared object is walked at every
  // path it sits at, a cycle only once.
  const ancestors = new Set<object>();
  const walk = (node: unknown, path: string, parentKey: string | undefined): void => {
    if (!node || typeof node !== 'object' || ancestors.has(node)) return;
    // Font binaries (`customFonts`) and other buffers hold no settings.
    if (node instanceof ArrayBuffer || ArrayBuffer.isView(node)) return;
    ancestors.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`, parentKey));
      ancestors.delete(node);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const at = path ? `${path}.${key}` : key;
      if (typeof value === 'string') {
        const fallback = numberFormatFallback(key, parentKey);
        // Footnotes take reference symbols too (`'symbols'`, #538).
        const known = key === 'numberFormat' && parentKey === 'footnotes' ? parseFootnoteNumberFormat(value) : parseNumberFormat(value);
        if (fallback !== undefined && known === undefined) {
          out.push({ kind: 'unknownNumberFormat', path: at, value, used: fallback });
        } else if (isFontFamilyKey(key) && isFontStack(value)) {
          out.push({ kind: 'fontFamilyStack', path: at, value, used: primaryFontFamily(value) });
        }
        continue;
      }
      walk(value, at, key);
    }
    ancestors.delete(node);
  };
  walk(config, '', undefined);
  return out;
}

/** The side columns of the one-and-a-half layouts, measured on the page the
 *  layout is cut on (a heading style's margins included). A layout of
 *  another type never reads the value and is not reported. */
function collectSideColumnWarnings(config: PostextConfig): ConfigWarning[] {
  const out: ConfigWarning[] = [];
  const resolved = resolveAllConfig(config);
  const check = (geometry: ResolvedConfig, layout: ResolvedLayoutConfig, path: string): void => {
    if (layout.layoutType !== 'oneAndHalf') return;
    const contentWidth = computePageMetrics(geometry).contentArea.width;
    const gutter = dimensionToPx(layout.gutterWidth, geometry.page.dpi);
    const used = sideColumnPercentUsed(layout.sideColumnPercent, contentWidth, gutter);
    if (used === Number(layout.sideColumnPercent)) return;
    out.push({ kind: 'sideColumnPercentClamped', path, value: String(layout.sideColumnPercent), used: percentText(used) });
  };
  check(resolved, resolved.layout, 'layout.sideColumnPercent');
  resolved.headingStyles.forEach((style, i) => {
    if (style.layout) check(deriveSectionGeometryConfig(resolved, style), style.layout, `headingStyles[${i}].layout.sideColumnPercent`);
  });
  return out;
}

/** The column counts of the `multiple` layouts (the document's and each
 *  heading style's own) that are not a whole number from 3 to 8. A layout
 *  of another type never reads the value and is not reported. */
function collectColumnCountWarnings(config: PostextConfig): ConfigWarning[] {
  const out: ConfigWarning[] = [];
  const check = (layout: { layoutType?: string; columnCount?: number } | undefined, path: string): void => {
    if (layout?.layoutType !== 'multiple' || layout.columnCount === undefined) return;
    const used = columnCountUsed(layout.columnCount);
    if (used === layout.columnCount) return;
    out.push({ kind: 'columnCountClamped', path, value: String(layout.columnCount), used: String(used) });
  };
  check(config.layout, 'layout.columnCount');
  // A heading style's own `multiple` layout (its count is the document's
  // when it sets none, reported there).
  (config.headingStyles ?? []).forEach((style, i) => {
    if (style.layout?.columnCount === undefined) return;
    check(style.layout, `headingStyles[${i}].layout.columnCount`);
  });
  return out;
}

/** A character grid (`cjk.grid`) with more characters per line or lines
 *  per page than the page's margins leave room for: the grid is reduced to
 *  what fits (`cjkGridClamped`, `used` the number set). */
function collectCjkGridWarnings(config: PostextConfig): ConfigWarning[] {
  const g = cjkGridGeometry(config);
  if (!g) return [];
  const out: ConfigWarning[] = [];
  if (g.clamped.charsPerLine !== undefined) out.push({ kind: 'cjkGridClamped', path: 'cjk.grid.charsPerLine', value: String(g.clamped.charsPerLine), used: String(g.charsPerLine) });
  if (g.clamped.linesPerPage !== undefined) out.push({ kind: 'cjkGridClamped', path: 'cjk.grid.linesPerPage', value: String(g.clamped.linesPerPage), used: String(g.linesPerPage) });
  return out;
}

/** A limit of the content check that is no whole number from 0 (#849):
 *  the default is used. */
function collectChecksValueWarnings(config: PostextConfig): ConfigWarning[] {
  const c = config.checks?.contentInConfig;
  if (!c || typeof c !== 'object') return [];
  const out: ConfigWarning[] = [];
  const used = resolveContentInConfigCheck(c);
  for (const key of ['maxWords', 'maxChars'] as const) {
    const v: unknown = c[key];
    if (v !== undefined && !(typeof v === 'number' && Number.isInteger(v) && v >= 0)) {
      out.push({ kind: 'unknownConfigValue', path: `checks.contentInConfig.${key}`, value: String(v), used: String(used[key]) });
    }
  }
  return out;
}

/** Most element paths a `contentInConfig` warning lists. */
const CONTENT_IN_CONFIG_MAX_PATHS = 20;
/** Longest sample of the first literal a `contentInConfig` warning quotes. */
const CONTENT_IN_CONFIG_SAMPLE = 40;
/** What a character of a script written without spaces (Chinese,
 *  Japanese, Korean, Thai) counts toward `maxChars`: such a text has no
 *  words to count, and one of its characters says about as much as a short
 *  Latin word, so the default limit of 24 lets eight of them through
 *  (`第{number}章`, `こころ`, `夏目漱石`). */
const UNSPACED_CHAR_WEIGHT = 3;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LETTERS_OR_DIGITS = /[\p{L}\p{N}]/gu;
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const UNSPACED_LETTERS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/gu;

/** A literal as the allow list compares it: no case, the words it holds
 *  between spaces with the punctuation around them dropped (`·`, a comma,
 *  quotes), one space between them. Punctuation inside a word stays, so an
 *  address (`postext.dev`) or a version (`4.0`) is one word. */
function comparableLiteral(text: string): string {
  return text.normalize('NFKC').toLowerCase().split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}\p{M}]+$/gu, ''))
    .filter(Boolean).join(' ');
}

/** `text` with every occurrence of the allowed phrase `phrase` taken out
 *  (both comparable): between spaces, or anywhere in text written without
 *  them. */
function withoutPhrase(text: string, phrase: string): string {
  if (!phrase || !text) return text;
  if (UNSPACED_SCRIPT.test(phrase)) return text.split(phrase).join(' ').replace(/\s+/g, ' ').trim();
  return ` ${text} `.split(` ${phrase} `).join('  ').replace(/\s+/g, ' ').trim();
}

/** The literal text a design text prints whatever the document: its
 *  content with every placeholder removed, on one line (#849). */
export function designTextLiteral(content: string): string {
  return stripPlaceholders(content).replace(/\s+/g, ' ').trim();
}

/** What {@link collectConfigWarnings} may read besides the config. */
/** The phrases of the metadata a design may repeat. */
function metadataPhrases(metadata: DocumentMetadata | undefined): string[] {
  if (!metadata) return [];
  const out: string[] = [];
  for (const key of ['title', 'subtitle', 'author', 'publisher']) {
    const v = metadata[key];
    const values = Array.isArray(v) ? v : [v];
    for (const one of values) {
      const text = metadataText(one);
      if (text) out.push(text);
    }
  }
  return out;
}

/** Content held in the configuration (#849): design text elements whose
 *  literal text — their content with every placeholder removed, and the
 *  phrases of `checks.contentInConfig.allow` (and of the metadata) taken
 *  out — is longer than `maxWords` words or `maxChars` letters and digits.
 *  One warning per owner (a heading style, a heading level, the page
 *  header, a part design…): `path` is the owner, `count` the texts at
 *  fault, `chars` their letters and digits, `elements` the path of each
 *  (the first 20), `value` the start of the first one's literal. */
function collectContentInConfigWarnings(config: PostextConfig, options: ConfigWarningOptions): ConfigWarning[] {
  const check = resolveContentInConfigCheck(config.checks?.contentInConfig);
  if (!check.enabled) return [];
  const allow = [...new Set([...check.allow, ...metadataPhrases(options.metadata)].map(comparableLiteral).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const groups = new Map<string, { ownerId?: string; elements: string[]; count: number; chars: number; sample: string }>();
  for (const slot of configDesignSlots(config)) {
    slot.slot.elements.forEach((el, i) => {
      const e = el as { kind?: unknown; content?: unknown } | null;
      if (!e || typeof e !== 'object' || e.kind !== 'text' || typeof e.content !== 'string') return;
      const literal = designTextLiteral(e.content);
      if (!LETTER_OR_DIGIT.test(literal)) return;
      let rest = comparableLiteral(literal);
      for (const phrase of allow) rest = withoutPhrase(rest, phrase);
      const chars = rest.match(LETTERS_OR_DIGITS)?.length ?? 0;
      if (chars === 0) return;
      const unspaced = rest.match(UNSPACED_LETTERS)?.length ?? 0;
      const weight = chars + unspaced * (UNSPACED_CHAR_WEIGHT - 1);
      // A run of unspaced script is no word count: its characters are weighed.
      const words = rest.split(' ').filter((w) => LETTER_OR_DIGIT.test(w) && !UNSPACED_SCRIPT.test(w)).length;
      if (words <= check.maxWords && weight <= check.maxChars) return;
      let g = groups.get(slot.owner);
      if (!g) {
        const points = Array.from(literal);
        const sample = points.length > CONTENT_IN_CONFIG_SAMPLE ? `${points.slice(0, CONTENT_IN_CONFIG_SAMPLE - 1).join('').trimEnd()}…` : literal;
        g = { ...(slot.ownerId !== undefined ? { ownerId: slot.ownerId } : {}), elements: [], count: 0, chars: 0, sample };
        groups.set(slot.owner, g);
      }
      g.count++;
      g.chars += chars;
      if (g.elements.length < CONTENT_IN_CONFIG_MAX_PATHS) g.elements.push(`${slot.path}.elements[${i}]`);
    });
  }
  return [...groups].map(([owner, g]) => ({
    kind: 'contentInConfig' as const,
    path: owner,
    value: g.sample,
    used: '',
    count: g.count,
    chars: g.chars,
    elements: g.elements,
    ...(g.ownerId !== undefined ? { ownerId: g.ownerId } : {}),
  }));
}
