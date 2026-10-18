'use client';

import { useMemo, useRef } from 'react';
import { useSandboxSelector } from '../context/SandboxContext';
import { useBookTexts } from '../frameStyles/useBookTexts';
import { labelStyleRefs, labelStyleUsage, type LabelStyleRef, type LabelStyleUse } from './labelRefs';

const NONE: never[] = [];

/** How many anchors and `::label` lines of the book name each label style
 *  (#994). A chapter is read again only when its text changed, so typing
 *  in the editor reads the one chapter being typed in. */
export function useLabelStyleUsage(): ReadonlyMap<string, LabelStyleUse> {
  const chapters = useBookTexts();
  const resources = useSandboxSelector((s) => s.resources) ?? NONE;
  const cache = useRef(new Map<string, { text: string; refs: LabelStyleRef[] }>());
  return useMemo(() => {
    const seen = new Set<string>();
    const refs = chapters.map((c) => {
      seen.add(c.id);
      const hit = cache.current.get(c.id);
      if (hit && hit.text === c.markdown) return hit.refs;
      const next = labelStyleRefs(c.markdown);
      cache.current.set(c.id, { text: c.markdown, refs: next });
      return next;
    });
    for (const id of cache.current.keys()) if (!seen.has(id)) cache.current.delete(id);
    return labelStyleUsage(resources, refs);
  }, [chapters, resources]);
}
