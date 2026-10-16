"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Maximize2, X } from "lucide-react";

/** The drawing of a docs figure, fitted to the column. When the column
 *  shows it well under its drawn size (a phone), an Enlarge button opens
 *  it in a modal `<dialog>` at that size, where it pans; Esc, the Close
 *  button or a click on the backdrop closes, and focus goes back to the
 *  button. */
export function FigureZoom({
  title,
  width,
  enlargeLabel,
  closeLabel,
  children,
}: {
  title: string;
  /** The drawn width, in viewBox units (about CSS pixels). */
  width: number;
  enlargeLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [small, setSmall] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSmall(el.clientWidth < width * 0.75));
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div className="docs-figure-box">
      <div ref={box} className="scroll-wrapper">
        {children}
      </div>
      {small && (
        <button type="button" className="docs-figure-enlarge" onClick={() => setOpen(true)}>
          <Maximize2 aria-hidden="true" className="size-4" />
          <span>{enlargeLabel}</span>
        </button>
      )}
      {open && (
        <FigureDialog title={title} width={width} closeLabel={closeLabel} source={box} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function FigureDialog({
  title,
  width,
  closeLabel,
  source,
  onClose,
}: {
  title: string;
  width: number;
  closeLabel: string;
  /** The box that holds the page's drawing. */
  source: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    const returnFocus = document.activeElement as HTMLElement | null;
    // The drawing is copied from the page (its gradients and markers keep
    // resolving to the page's own definitions); the copy is labelled by the
    // dialog, not by the page's <title> ids.
    const svg = source.current?.querySelector("svg")?.cloneNode(true) as SVGSVGElement | undefined;
    if (svg && stage.current) {
      svg.removeAttribute("aria-labelledby");
      svg.setAttribute("aria-hidden", "true");
      svg.style.maxWidth = "none";
      svg.style.width = `${width}px`;
      stage.current.replaceChildren(svg);
    }
    const root = document.documentElement;
    const locked = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    if (dialog && !dialog.open) dialog.showModal();
    closeRef.current?.focus();
    return () => {
      root.style.overflow = locked.overflow;
      root.style.scrollbarGutter = locked.gutter;
      if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    };
  }, [source, width]);

  return (
    <dialog
      ref={ref}
      className="docs-figure-dialog"
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) ref.current?.close();
      }}
    >
      <div className="docs-figure-dialog-bar">
        <p className="docs-figure-dialog-title">{title}</p>
        <button ref={closeRef} type="button" className="docs-figure-dialog-close" onClick={() => ref.current?.close()} aria-label={closeLabel}>
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      <div ref={stage} className="docs-figure-dialog-stage" role="img" aria-label={title} />
    </dialog>
  );
}
