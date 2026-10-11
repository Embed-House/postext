// What the Checks panel has to say.

import { detailFor, titleFor } from '../../sidebar/WarningsPanel';
import { WARNING_CATEGORY_ORDER, warningCategory } from '../../warnings/categories';
import { whenSettled, type SandboxToolHost } from '../host';
import type { WebMcpTool } from '../modelContext';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function checkTools(host: SandboxToolHost): WebMcpTool[] {
  const { store } = host;

  const getWarnings: WebMcpTool = {
    name: 'sandbox_get_warnings',
    title: 'Sandbox: what the checks found',
    description: "What the Sandbox's Checks panel lists for the chapter on screen, worded as the panel words it: missing fonts and pictures, markup the engine could not read, design elements that do not fit, typesetting faults (loose lines, widows, overflowing boxes) and print preflight. Each comes with its category, the line of the source it points at and, where it names one, the setting or the resource. It waits for the layout to follow the last change. The typesetting checks read the pages of the viewer on screen, so they are current on the canvas, folio and html tabs.",
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: WARNING_CATEGORY_ORDER, description: 'Only this category.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Most warnings to list (default 100).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (args, { signal }) => {
      const laidOut = await whenSettled(host, { signal });
      // The viewer publishes its document a moment after the layout lands.
      await sleep(120);
      const s = store.getSnapshot();
      const all = store.getWarnings(s);
      const counts: Record<string, number> = {};
      for (const w of all) {
        const category = warningCategory(w.payload.kind);
        counts[category] = (counts[category] ?? 0) + 1;
      }
      const limit = (args.limit as number | undefined) ?? 100;
      const wanted = all.filter((w) => args.category === undefined || warningCategory(w.payload.kind) === args.category);
      return {
        laidOut,
        chapter: s.chapters.findIndex((c) => c.id === s.activeChapterId) + 1,
        viewer: s.activeViewport,
        total: all.length,
        byCategory: counts,
        warnings: wanted.slice(0, limit).map((w) => {
          const payload = w.payload as Record<string, unknown>;
          return {
            kind: w.payload.kind,
            category: warningCategory(w.payload.kind),
            title: titleFor(w.payload, s.labels),
            detail: detailFor(w.payload, s.labels),
            ...(w.chapterIndex !== undefined ? { chapter: w.chapterIndex + 1 } : {}),
            ...(w.chapterLine ?? w.line ? { line: w.chapterLine ?? w.line } : {}),
            ...(typeof payload.path === 'string' ? { setting: payload.path } : {}),
            ...(typeof payload.resourceId === 'string' ? { resource: payload.resourceId } : {}),
            ...(typeof payload.page === 'number' ? { page: payload.page } : {}),
          };
        }),
        ...(wanted.length > limit ? { more: wanted.length - limit } : {}),
      };
    },
  };

  return [getWarnings];
}
