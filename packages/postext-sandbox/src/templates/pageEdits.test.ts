import { describe, expect, it } from 'vitest';
import { resolvePageTemplate, type PageTemplate } from 'postext';
import { changeFrameForPage, changeTemplateFrame, frameScopeOnPage } from './pageEdits';

const mm = (value: number) => ({ value, unit: 'mm' as const });
const T: PageTemplate[] = [
  { id: 'a', frames: [{ name: 'x', width: mm(50) }], variants: { verso: { frames: [{ name: 'x', width: mm(40) }] } } },
  { id: 'b', extends: 'a' },
];

describe('frameScopeOnPage', () => {
  it('reads the scope off the frame’s pointer, for the page’s own template', () => {
    expect(frameScopeOnPage(T, { template: 'a' }, { configPath: '/pageTemplates/0/variants/verso/frames/0' })).toEqual({ templateId: 'a', scope: 'verso' });
    expect(frameScopeOnPage(T, { template: 'a' }, { configPath: '/pageTemplates/0/frames/0' })).toEqual({ templateId: 'a', scope: 'base' });
  });
  it('patches the page’s template when the frame comes from one it extends', () => {
    expect(frameScopeOnPage(T, { template: 'b' }, { configPath: '/pageTemplates/0/frames/0' })).toEqual({ templateId: 'b', scope: 'base' });
  });
});

describe('writing a frame changed on a page', () => {
  it('changes the template at the frame’s scope', () => {
    const out = changeTemplateFrame(T, { template: 'a' }, { name: 'x', configPath: '/pageTemplates/0/variants/verso/frames/0' }, { width: mm(45) });
    expect(out[0]!.variants!.verso!.frames![0]!.width).toEqual(mm(45));
    expect(out[0]!.frames![0]!.width).toEqual(mm(50));
  });
  it('or makes a template for the page that extends it', () => {
    const { templates, id } = changeFrameForPage(T, { template: 'b' }, { name: 'x' }, { height: mm(30) }, 'b, page 3');
    expect(id).toBe('b-page');
    const r = resolvePageTemplate({ pageTemplates: templates }, id, { parity: 'verso' })!;
    expect(r.frames[0]!.width).toEqual(mm(40));
    expect(r.frames[0]!.height).toEqual(mm(30));
  });
});
