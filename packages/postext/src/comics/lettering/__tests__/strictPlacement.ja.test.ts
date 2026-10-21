// #728 strictPlacement on Japanese lettering (split from strictPlacement.test.ts, #1118).

import { describe, it, expect, beforeAll } from 'vitest';
import { installStubMeasure } from './stubMeasure';
import { roof, JA } from './strictPlacement.fixtures';

beforeAll(() => installStubMeasure());

describe('strictPlacement (#728)', () => {
  for (const [w, h, em] of [[300, 130, 12], [340, 150, 14], [380, 170, 16]] as const) {
    it(`does not touch Japanese lettering, a ${w} × ${h} panel`, () => {
      expect(roof(w, h, em, 'ja', JA, { strictPlacement: true })).toEqual(roof(w, h, em, 'ja', JA, {}));
    });
  }
});
