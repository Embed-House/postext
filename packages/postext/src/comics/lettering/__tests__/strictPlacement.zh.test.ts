// #728 strictPlacement on Chinese panels (split from strictPlacement.test.ts, #1118).

import { describe, it, expect, beforeAll } from 'vitest';
import { installStubMeasure } from './stubMeasure';
import { roof, ZH } from './strictPlacement.fixtures';

beforeAll(() => installStubMeasure());

describe('strictPlacement (#728)', () => {
  // Panels whose lettering is clean either way (no diagnostic): what
  // changes is the shape the first balloon is given.
  for (const [w, h, em] of [[300, 130, 12], [340, 150, 14], [380, 170, 16]] as const) {
    it(`a ${w} × ${h} panel: 其实 is cut without it, whole with it`, () => {
      const lax = roof(w, h, em, 'zh-Hans', ZH, {});
      const strict = roof(w, h, em, 'zh-Hans', ZH, { strictPlacement: true });
      expect(lax.diagnostics).toEqual([]);
      expect(strict.diagnostics).toEqual([]);
      expect(lax.lines[0]).toContain('其/实');
      expect(strict.lines[0]).not.toContain('其/实');
      expect(strict.lines[0]).toContain('其实，');
      // The other two balloons keep their lines.
      expect(strict.lines.slice(1)).toEqual(lax.lines.slice(1));
    });
  }
});
