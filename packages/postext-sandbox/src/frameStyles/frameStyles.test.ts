import { describe, expect, it } from 'vitest';
import type { CalloutStyleConfig, PageTemplate, PostextConfig } from 'postext';
import { applyTextChanges } from '../book/textChanges';
import { calloutFences, retypeCalloutChanges } from './calloutFences';
import { frameStyleLibrary } from './library';
import { countFields, mergeSuggestions, parseHex, styleDiff, styleFields, stylesAfterMerging } from './styleCompare';
import { planMerge, planMerges, planRename, rewrittenTexts, undoOf } from './styleMerge';
import { styleUsage } from './styleUsage';
import { frameDress, previewConfig, previewMarkdown } from './stylePreview';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const pad = (v: number) => ({ top: mm(v), right: mm(v), bottom: mm(v), left: mm(v) });

/** A textbook ported page by page: one style per box, most of them the
 *  same box with its padding a hair apart. */
const STYLES: CalloutStyleConfig[] = [
  { id: 'nota', name: 'Nota', border: { enabled: true }, stripe: { enabled: true } },
  { id: 'caja-p4', background: { hex: '#fde9d9', model: 'hex' }, padding: pad(4) },
  { id: 'caja-p5', background: { hex: '#fde9d9', model: 'hex' }, padding: pad(5) },
  { id: 'caja-p6', background: { hex: '#fde9da', model: 'hex' }, padding: pad(3.6) },
  { id: 'caja-p7', background: { hex: '#fde9d9', model: 'hex' }, padding: { ...pad(4), left: mm(9) } },
  {
    id: 'aviso',
    background: { hex: '#ff0000', model: 'hex' },
    border: { enabled: true, width: { value: 1, unit: 'pt' } },
    stripe: { enabled: true },
    icon: { kind: 'glyph', glyph: '!' },
  },
];

const TEMPLATES: PageTemplate[] = [
  {
    id: 'tema',
    frames: [{ name: 'texto', flow: true }, { name: 'dinero', style: 'caja-p5' }],
    variants: { verso: { frames: [{ name: 'dinero', style: 'caja-p6' }] } },
  },
  { id: 'tema-mapa', extends: 'tema' },
];

const CHAPTERS = [
  {
    id: 'c1',
    markdown: [
      '# Uno',
      '',
      ':::callout{type="caja-p4" label="El dinero"}',
      'Texto.',
      ':::',
      '',
      '```md',
      ':::callout{type="caja-p5"}',
      '```',
      '',
      ':::callout{type=caja-p7}',
      'Más.',
      ':::',
      '',
      ':::callout',
      'Sin tipo.',
      ':::',
    ].join('\n'),
  },
  {
    id: 'c2',
    markdown: [
      '::::page{template="tema"}',
      '# Tema',
      '::::',
      '',
      ':::callout{type="caja-p4"}',
      'Otra.',
      ':::',
      ':::callout{type="caja-p4"}',
      ':::',
      ':::callout{type="caja-p4"}',
      ':::',
      ':::callout{ type = \'caja-p6\' }',
      'Y otra.',
      ':::',
      '::::page{template=tema-mapa}',
      '::::',
    ].join('\n'),
  },
];

const CONFIG: PostextConfig = { calloutStyles: STYLES, pageTemplates: TEMPLATES };

describe('calloutFences', () => {
  it('reads every fence outside code, quoted or not, with the range of its type', () => {
    const md = CHAPTERS[0]!.markdown;
    const fences = calloutFences(md);
    expect(fences.map((f) => f.type)).toEqual(['caja-p4', 'caja-p7', '']);
    expect(md.slice(fences[0]!.valueFrom, fences[0]!.valueTo)).toBe('caja-p4');
    expect(md.slice(fences[1]!.valueFrom, fences[1]!.valueTo)).toBe('caja-p7');
    expect(fences[2]!.missing).toBe(true);
    expect(calloutFences(CHAPTERS[1]!.markdown).map((f) => f.type)).toEqual(['caja-p4', 'caja-p4', 'caja-p4', 'caja-p6']);
  });

  it('retypes only the fences naming a style of the set', () => {
    const md = CHAPTERS[0]!.markdown;
    const out = applyTextChanges(md, retypeCalloutChanges(md, new Map([['caja-p7', 'caja'], ['caja-p5', 'caja']])));
    expect(out).toContain(':::callout{type=caja}');
    expect(out).toContain(':::callout{type="caja-p4" label="El dinero"}');
    // A fence inside a code block is text, not a box.
    expect(out).toContain('```md\n:::callout{type="caja-p5"}\n```');
  });
});

describe('styleUsage', () => {
  it('counts boxes per chapter, the frames written with a style and the pages laid with them', () => {
    const usage = styleUsage(CONFIG, STYLES, CHAPTERS);
    const p4 = usage.get('caja-p4')!;
    expect(p4.fenceCount).toBe(4);
    expect(p4.fences.map((f) => [f.chapterId, f.offsets.length])).toEqual([['c1', 1], ['c2', 3]]);
    // A fence that names no style takes the first one.
    expect(usage.get('nota')!.fences[0]).toMatchObject({ chapterId: 'c1', implicit: 1 });
    const p5 = usage.get('caja-p5')!;
    expect(p5.frames).toEqual([{ templateId: 'tema', frame: 'dinero', scope: 'base' }]);
    // `tema-mapa` inherits the frame: its page counts too.
    expect(p5.templates).toEqual(['tema', 'tema-mapa']);
    expect(p5.pageCount).toBe(2);
    const p6 = usage.get('caja-p6')!;
    expect(p6.frames).toEqual([{ templateId: 'tema', frame: 'dinero', scope: 'verso' }]);
    expect(p6.fenceCount).toBe(1);
  });
});

describe('styleDiff', () => {
  it('reads lengths within 0.5 mm and colours within ΔE 2 as equal, and ignores id and name', () => {
    const a = styleFields({ id: 'a', name: 'A', padding: pad(4), background: { hex: '#fde9d9', model: 'hex' } });
    const b = styleFields({ id: 'b', name: 'B', padding: pad(4.4), background: { hex: '#FDE9DA', model: 'hex' } });
    expect(styleDiff(a, b)).toEqual([]);
    const c = styleFields({ id: 'c', padding: { ...pad(4), left: mm(4.6) }, background: { hex: '#fdd0b0', model: 'hex' } });
    expect(styleDiff(a, c)).toEqual(['background', 'padding.left']);
  });

  it('converts units before comparing (12 pt is 4.23 mm)', () => {
    const a = styleFields({ id: 'a', padding: pad(4.2) });
    const b = styleFields({ id: 'b', padding: { top: { value: 12, unit: 'pt' }, right: mm(4.2), bottom: mm(4.2), left: mm(4.2) } });
    expect(styleDiff(a, b)).toEqual([]);
  });

  it('parses short and long hex colours', () => {
    expect(parseHex('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseHex('transparent')).toBeNull();
  });
});

describe('mergeSuggestions', () => {
  it('groups the styles that differ only in padding around the most used one', () => {
    const lib = frameStyleLibrary(CONFIG, CHAPTERS);
    const caja = lib.suggestions.find((s) => s.merge.includes('caja-p5'))!;
    expect(caja.keep).toBe('caja-p4');
    expect(caja.merge).toEqual(['caja-p5', 'caja-p6', 'caja-p7']);
    expect(caja.groups).toEqual(['padding']);
    // Nothing else is near enough: the plain note and the red warning stay.
    expect(lib.suggestions).toHaveLength(1);
    expect(stylesAfterMerging(STYLES.length, lib.suggestions)).toBe(3);
  });

  it('holds back styles that differ in more settings than the threshold', () => {
    const lib = frameStyleLibrary(CONFIG, CHAPTERS, { maxFields: 0 });
    // Only caja-p6 is within the tolerances on every setting.
    expect(lib.suggestions.map((s) => [s.keep, s.merge])).toEqual([['caja-p4', ['caja-p6']]]);
  });

  it('counts the four sides of a padding as one setting', () => {
    expect(countFields(['padding.left', 'padding.top', 'body.color'])).toBe(2);
  });

  it('counts where a box stands for styles of the text, unless asked to compare the look only', () => {
    const fixed = (id: string, y: number): CalloutStyleConfig => ({ id, placement: 'fixed', fixed: { anchor: { to: 'page', edge: 'top-left' }, offset: { x: mm(20), y: mm(y) } }, padding: pad(2) });
    const styles = [fixed('t-31', 31), fixed('t-58', 58), fixed('t-90', 90)];
    const chapters = [{ id: 'c', markdown: styles.map((s) => `:::callout{type="${s.id}"}\nx\n:::`).join('\n\n') }];
    const config: PostextConfig = { calloutStyles: styles };
    const strict = frameStyleLibrary(config, chapters, { maxFields: 0 });
    expect(strict.suggestions).toEqual([]);
    const look = frameStyleLibrary(config, chapters, { maxFields: 0, ignorePosition: true });
    expect(look.suggestions).toEqual([{ keep: 't-31', merge: ['t-58', 't-90'], fields: [], groups: [], moves: 2 }]);
  });

  it('compares styles only frames use on their look: a frame takes its place from the template', () => {
    const styles: CalloutStyleConfig[] = [
      { id: 'a', placement: 'fixed', padding: pad(2) },
      { id: 'b', placement: 'here', padding: pad(2) },
    ];
    const config: PostextConfig = { calloutStyles: styles, pageTemplates: [{ id: 't', frames: [{ name: 'x', style: 'a' }, { name: 'y', style: 'b' }] }] };
    const [s] = mergeSuggestions(styles, frameStyleLibrary(config, []).resolved, styleUsage(config, styles, []), { maxFields: 0 });
    expect(s).toMatchObject({ keep: 'a', merge: ['b'], moves: 0 });
  });
});

describe('planMerge', () => {
  it('rewrites every frame and fence to the kept style, drops the others and can be undone', () => {
    const plan = planMerge(CONFIG, STYLES, CHAPTERS, 'caja-p4', ['caja-p5', 'caja-p6', 'caja-p7']);
    expect(plan.calloutStyles.map((s) => s.id)).toEqual(['nota', 'caja-p4', 'aviso']);
    expect(plan.frames).toEqual([
      { templateId: 'tema', frame: 'dinero', scope: 'base', from: 'caja-p5' },
      { templateId: 'tema', frame: 'dinero', scope: 'verso', from: 'caja-p6' },
    ]);
    expect(plan.pageTemplates![0]!.frames![1]!.style).toBe('caja-p4');
    expect(plan.pageTemplates![0]!.variants!.verso!.frames![0]!.style).toBe('caja-p4');
    // The child template is left as it was: it inherits the frame.
    expect(plan.pageTemplates![1]).toBe(TEMPLATES[1]);
    expect(plan.fenceCount).toBe(2);
    const texts = rewrittenTexts(CHAPTERS, plan);
    expect(texts.get('c1')).toContain(':::callout{type=caja-p4}');
    expect(texts.get('c2')).toContain(":::callout{ type = 'caja-p4' }");
    expect(calloutFences(texts.get('c1')!).map((f) => f.type)).toEqual(['caja-p4', 'caja-p4', '']);

    const undo = undoOf(CONFIG, plan);
    expect(undo.calloutStyles).toBe(STYLES);
    for (const c of undo.chapters) {
      const after = texts.get(c.chapterId)!;
      expect(after.length).toBe(c.baseLength);
      expect(applyTextChanges(after, c.changes)).toBe(CHAPTERS.find((ch) => ch.id === c.chapterId)!.markdown);
    }
  });

  it('puts the kept style where the first of the group stood', () => {
    const styles: CalloutStyleConfig[] = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    expect(planMerge({ calloutStyles: styles }, styles, [], 'z', ['x']).calloutStyles.map((s) => s.id)).toEqual(['z', 'y']);
  });

  it('takes several groups in one rewrite', () => {
    const styles: CalloutStyleConfig[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const chapters = [{ id: 'x', markdown: ':::callout{type=b}\n:::\n:::callout{type=d}\n:::' }];
    const plan = planMerges({ calloutStyles: styles }, styles, chapters, [{ keep: 'a', merge: ['b'] }, { keep: 'd', merge: ['c'] }]);
    expect(plan.calloutStyles.map((s) => s.id)).toEqual(['a', 'd']);
    expect(rewrittenTexts(chapters, plan).get('x')).toBe(':::callout{type=a}\n:::\n:::callout{type=d}\n:::');
  });

  it('a rename rewrites the same references and keeps the style in place', () => {
    const plan = planRename(CONFIG, STYLES, CHAPTERS, 'caja-p6', 'caja-verso');
    expect(plan.calloutStyles.map((s) => s.id)).toEqual(['nota', 'caja-p4', 'caja-p5', 'caja-verso', 'caja-p7', 'aviso']);
    expect(plan.frames).toEqual([{ templateId: 'tema', frame: 'dinero', scope: 'verso', from: 'caja-p6' }]);
    expect(rewrittenTexts(CHAPTERS, plan).get('c2')).toContain("type = 'caja-verso'");
  });
});

describe('the preview of a style', () => {
  it('dresses the box as a frame: in the flow, across the measure, without its fixed place', () => {
    const style: CalloutStyleConfig = { id: 'caja', placement: 'fixed', span: 'side', fixed: { offset: { x: mm(20), y: mm(31) } }, marginBottom: mm(234), label: {} };
    const config = previewConfig({ calloutStyles: STYLES, pageTemplates: TEMPLATES, layout: { layoutType: 'double' } }, style);
    expect(config.calloutStyles).toEqual([{ id: 'caja', placement: 'here', span: 'column', width: 'fill', marginTop: mm(0), marginBottom: mm(0), floatBarrier: false, label: {} }]);
    expect(frameDress(style).fixed).toBeUndefined();
    expect(config.pageTemplates).toBeUndefined();
    expect(config.layout?.layoutType).toBe('single');
    expect(config.header).toEqual({ elements: [] });
  });

  it('widens the sample when the padding leaves less than 40 mm of measure', () => {
    expect(previewConfig({}, { id: 'a' }).page!.width).toEqual(mm(92));
    expect(previewConfig({}, { id: 'b', padding: { left: mm(114.25) } }).page!.width).toEqual(mm(167));
  });

  it('keeps a tab set far along a wide frame on the sample box', () => {
    const style: CalloutStyleConfig = { id: 'pestana', label: { inset: mm(139.74), height: mm(8) } };
    expect(previewConfig({}, style).calloutStyles![0]!.label).toEqual({ inset: mm(4), height: mm(8) });
    expect(previewConfig({}, { id: 'x', label: { inset: mm(6) } }).calloutStyles![0]!.label).toEqual({ inset: mm(6) });
  });

  it('is a single box of the style, with the sample label only when the style has a tab', () => {
    const sample = { text: 'Texto de muestra.', label: 'Una "etiqueta" {rara}' };
    expect(previewMarkdown({ id: 'caja', label: {} }, sample)).toBe(':::callout{type="caja" label="Una etiqueta rara"}\nTexto de muestra.\n:::\n');
    expect(previewMarkdown({ id: 'nota' }, sample)).toBe(':::callout{type="nota"}\nTexto de muestra.\n:::\n');
  });
});
