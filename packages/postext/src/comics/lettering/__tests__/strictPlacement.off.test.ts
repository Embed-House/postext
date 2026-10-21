// #728 strictPlacement off, and on Latin lettering (split from strictPlacement.test.ts, #1118).

import { describe, it, expect, beforeAll } from 'vitest';
import { installStubMeasure } from './stubMeasure';
import { roof, ZH } from './strictPlacement.fixtures';

beforeAll(() => installStubMeasure());

describe('strictPlacement (#728)', () => {
  it('false, or unset, letters a panel as before', () => {
    const unset = roof(300, 130, 12, 'zh-Hans', ZH, {});
    const off = roof(300, 130, 12, 'zh-Hans', ZH, { strictPlacement: false });
    expect(off).toEqual(unset);
  });

  it('does not touch Latin lettering', () => {
    const en: [string, string, string] = ['Honestly, I am a little scared.', 'Me too. And I am not even playing.', 'Pff, what are you on about?'];
    expect(roof(300, 130, 12, 'en', en, { strictPlacement: true })).toEqual(roof(300, 130, 12, 'en', en, {}));
  });
});
