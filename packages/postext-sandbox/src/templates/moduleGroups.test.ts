import { describe, expect, it } from 'vitest';
import { modulesGroupParents } from './moduleEdits';

// #1095: «Inside the group» offers every other modules group of the
// template, a row or a grid too, but none that lies inside the group.

describe('modulesGroupParents', () => {
  const groups = [
    { name: 'body', modules: true },
    { name: 'band', modules: true, within: 'body' },
    { name: 'column', modules: true, within: 'band' },
    { name: 'pair', modules: true, within: 'body' },
    { name: 'frames' },
  ];

  it('offers any other modules group', () => {
    expect(modulesGroupParents(groups, 'pair')).toEqual(['body', 'band', 'column']);
  });

  it('leaves out the groups inside it, at any depth', () => {
    expect(modulesGroupParents(groups, 'band')).toEqual(['body', 'pair']);
    expect(modulesGroupParents(groups, 'body')).toEqual([]);
  });

  it('stops on a loop already written', () => {
    const loop = [{ name: 'a', modules: true, within: 'b' }, { name: 'b', modules: true, within: 'a' }, { name: 'c', modules: true }];
    expect(modulesGroupParents(loop, 'c')).toEqual(['a', 'b']);
    expect(modulesGroupParents(loop, 'a')).toEqual(['c']);
  });
});
