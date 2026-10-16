"use client";

import { useEffect, useRef } from "react";

/** Shows a docs table as stacked rows (`data-stack`) whenever its grid is
 *  wider than the column. A narrow column already stacks the tables of three
 *  or more columns in CSS (a container query, so a phone never sees the wide
 *  grid first); this catches the rest — a two-column table with long code, a
 *  wide table in a mid-sized column — measured after layout, on every resize
 *  and once the fonts have loaded. */
export function TableFit() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = ref.current?.parentElement;
    if (!root) return;
    // Property tables (a description last) are cards at every width.
    const tables = [...root.querySelectorAll<HTMLTableElement>("table.docs-table:not([data-prose-last])")];
    if (tables.length === 0) return;
    const fit = (table: HTMLTableElement) => {
      const box = table.parentElement;
      if (!box) return;
      table.removeAttribute("data-stack");
      if (table.offsetWidth > box.clientWidth + 1) table.setAttribute("data-stack", "");
    };
    // After a jump in width (a phone turned, a window snapped) the first
    // layout can still carry the container query of the old width: measure
    // again on the next frame, once it has settled.
    let frame = 0;
    const pending = new Set<HTMLTableElement>();
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const table = (entry.target as HTMLElement).querySelector<HTMLTableElement>(":scope > table.docs-table:not([data-prose-last])");
        if (!table) continue;
        fit(table);
        pending.add(table);
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        pending.forEach(fit);
        pending.clear();
      });
    });
    for (const table of tables) if (table.parentElement) observer.observe(table.parentElement);
    let live = true;
    document.fonts?.ready.then(() => {
      if (live) tables.forEach(fit);
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <span ref={ref} hidden />;
}
