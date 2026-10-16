/**
 * The field a double click opens over a frame's text on the page (#864):
 * a one-line field over a label tab, a text area over a paragraph, holding
 * the Markdown written for it. Enter keeps the change (written back to
 * the source by the caller), Shift+Enter starts a new line in a text area,
 * Esc leaves the text as it was; leaving the field keeps the change.
 */

import type { FrameTextTarget } from './frameLink';

/** Where the field goes: the page's element and how sheet px map to it
 *  (the comic tools' surface has the same two). */
export interface FrameEditSurface {
  host: HTMLElement;
  place(el: HTMLElement, page: number, x: number, y: number): boolean;
  sheetPxPerCssPx(pageIndex: number): number;
}

export interface FrameTextEditorOptions {
  /** Accessible name of the field. */
  label: string;
  /** Read after the name (the keys). */
  hint: string;
  onCommit(text: string): void;
  /** Called once the field is gone, kept or not. */
  onClose?(): void;
}

let closeOpen: (() => void) | null = null;

/** Close the field open on any page, keeping its change. */
export function closeFrameTextEditor(): void {
  closeOpen?.();
}

/** Open the field for `target` on page `pageIndex`; false when it cannot
 *  be placed there. */
export function openFrameTextEditor(surface: FrameEditSurface, pageIndex: number, target: FrameTextTarget, opts: FrameTextEditorOptions): boolean {
  closeFrameTextEditor();
  const multiline = target.kind === 'block';
  const field = document.createElement(multiline ? 'textarea' : 'input') as HTMLTextAreaElement | HTMLInputElement;
  if (!surface.place(field, pageIndex, target.rect.x, target.rect.y)) return false;
  const k = surface.sheetPxPerCssPx(pageIndex) || 1;
  const hintEl = document.createElement('span');
  hintEl.id = `pt-frame-edit-hint-${Math.random().toString(36).slice(2)}`;
  hintEl.textContent = opts.hint;
  Object.assign(hintEl.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' } satisfies Partial<CSSStyleDeclaration>);
  field.value = target.text;
  field.setAttribute('aria-label', opts.label);
  field.setAttribute('aria-describedby', hintEl.id);
  field.dataset.role = 'frameTextEditor';
  field.spellcheck = true;
  const fontCss = Math.max(11, target.fontPx / k);
  Object.assign(field.style, {
    position: 'absolute',
    zIndex: '8',
    boxSizing: 'border-box',
    width: `${Math.max(120, target.rect.width / k)}px`,
    minHeight: `${Math.max(fontCss * 1.6, target.rect.height / k)}px`,
    margin: '0',
    padding: '2px 4px',
    font: `${fontCss}px/1.35 system-ui, sans-serif`,
    color: '#1d1d1b',
    background: '#ffffff',
    border: '2px solid #d9480f',
    borderRadius: '2px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
    resize: 'none',
    outline: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  const grow = () => {
    if (!multiline) {
      // A label keeps its whole text in view as it is typed.
      field.style.width = `${Math.max(120, target.rect.width / k, (field.value.length + 3) * fontCss * 0.56)}px`;
      return;
    }
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + 2}px`;
  };

  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    closeOpen = null;
    const value = field.value;
    field.remove();
    hintEl.remove();
    if (keep) opts.onCommit(value);
    opts.onClose?.();
  };
  closeOpen = () => finish(true);

  // The page's own pointer and key handling stays out of the field.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'click', 'dblclick']) {
    field.addEventListener(type, (ev) => ev.stopPropagation());
  }
  field.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    } else if (e.key === 'Enter' && !(multiline && e.shiftKey) && !e.isComposing) {
      e.preventDefault();
      finish(true);
    }
  });
  field.addEventListener('input', grow);
  field.addEventListener('blur', () => finish(true));
  surface.host.appendChild(hintEl);
  surface.host.appendChild(field);
  grow();
  field.focus();
  field.select();
  return true;
}
