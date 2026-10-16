import { describe, it, expect } from 'vitest';
import { DEFAULT_LABELS } from '../types/defaultLabels';
import { fitProposalText, fitStepText, frameOverflowDetail } from './frameOverflowText';

describe('frameOverflow in the Checks panel (#858)', () => {
  it('says where, the steps tried and the fixes with their values', () => {
    const text = frameOverflowDetail({
      kind: 'frameOverflow', template: 'tema', frame: 'caja', fenceIndex: 0, overflowMm: 4.25, page: 17, configPath: '/pageTemplates/0/frames/2',
      locale: 'ca', stepsTried: ['free', 'push', 'scaleImages', 'shrinkText'], scale: 0.9, imageScale: 0.8,
      proposals: [
        { kind: 'allowShrink', path: '/pageTemplates/0/frames/2/fit/minScale', value: 0.85 },
        { kind: 'raiseMax', path: '/pageTemplates/0/frames/2/maxHeight', value: { value: 68, unit: 'mm' } },
        { kind: 'lowerMin', path: '/pageTemplates/0/frames/4/minHeight', value: { value: 40, unit: 'mm' }, frame: 'gasto' },
        { kind: 'continueNextPage', path: '/pageTemplates/0/frames/2/overflow/continueIn', value: 'next-page' },
        { kind: 'useTemplate', value: 'tema-amplio' },
        { kind: 'shortenText', value: 120 },
      ],
    }, DEFAULT_LABELS);
    expect(text).toContain('page 17 · 4.3 mm past the foot of this frame of template tema');
    expect(text).toContain('Tried: free space, room from the frames around it, pictures down to 80 %, text down to 90 %.');
    expect(text).toContain('Any of these makes it fit: let the text shrink to 85 % (fit.minScale); raise maxHeight to 68 mm; lower the minHeight of gasto to 40 mm; continue it on the next page (overflow.continueIn); set the page with template tema-amplio; cut about 120 characters.');
  });

  it('words a step and a proposal on their own', () => {
    expect(fitStepText('shrinkText', { scale: 0.925 }, DEFAULT_LABELS)).toBe('text down to 92.5 %');
    expect(fitStepText('continue', { scale: 1 }, DEFAULT_LABELS)).toContain('another page');
    expect(fitProposalText({ kind: 'shortenText', value: 9 }, DEFAULT_LABELS)).toBe('cut about 9 characters');
  });
});
