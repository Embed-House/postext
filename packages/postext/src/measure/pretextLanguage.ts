// The language of the text library's own measuring context (#764).
//
// A paragraph with no formatting is broken by `@chenglou/pretext`, which
// measures on a context of its own: made on first use, kept for good, and
// handed to nobody (0.0.9 exports no way to give it a context or a measure
// function). Left alone that context has the language of the host page, or
// none in a worker, while the engine's own measures in the document's
// (`measure/canvas.ts`), so the plain paragraphs of a document would break
// their lines by another language than its headings and its formatted ones.
//
// Two things are done about it, neither of which changes the library:
//
// - The context is found the first time a language is asked for. The
//   library sets `font` on its context at the start of every `prepare`,
//   before it measures anything, and the whole of a `prepare` is
//   synchronous: for the length of that one call the `font` setter of the
//   2D context classes is wrapped, the context that sets a font inside it
//   is the library's, and the setter is put back as it was found (a layout
//   worker's own wrapper of it included, `worker/fontGenerations.ts`).
//   From then on its `lang` is set like the engine's own.
// - The library keeps the widths it measured by font string. A language
//   other than the host's hands it the same font written with spaces
//   after it, one more per language met: the same font to the canvas,
//   another key to the library, so two languages never share a width and
//   going from one to the other drops nothing.
//
// Where the classes cannot be reached (no canvas classes: a measurer stub,
// a platform whose contexts have no `lang`) the library measures as it
// always did.

import { prepareWithSegments, type PreparedTextWithSegments } from '@chenglou/pretext';
import { getMeasureLanguage } from './canvas';

const HOST_LANGUAGE = 'inherit';

/** The library's context, once found; null when it could not be. */
let context: { lang: string } | null | undefined;
/** What its `lang` was last set to. */
let contextLanguage = HOST_LANGUAGE;
/** How many spaces follow the font of each language met. */
const variants = new Map<string, number>();

interface ContextClass {
  prototype: object;
}

function contextClasses(): object[] {
  const g = globalThis as { OffscreenCanvasRenderingContext2D?: ContextClass; CanvasRenderingContext2D?: ContextClass };
  return [g.OffscreenCanvasRenderingContext2D?.prototype, g.CanvasRenderingContext2D?.prototype].filter((p): p is object => p !== undefined && p !== null);
}

/** Run `prepare` with the `font` setter of the context classes watched:
 *  the first context to set a font inside it is the library's, and takes
 *  `language` before the font. */
function findContext<T>(language: string, prepare: () => T): T {
  const restore: (() => void)[] = [];
  for (const prototype of contextClasses()) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'font');
    const set = descriptor?.set;
    if (!descriptor || !set || descriptor.configurable === false) continue;
    try {
      Object.defineProperty(prototype, 'font', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(this: object, value: unknown) {
          if (context === undefined && 'lang' in this) {
            context = this as { lang: string };
            context.lang = language;
            contextLanguage = language;
          }
          set.call(this, value);
        },
      });
      restore.push(() => Object.defineProperty(prototype, 'font', descriptor));
    } catch {
      // A class that will not be wrapped is left as it is.
    }
  }
  try {
    return prepare();
  } finally {
    for (const undo of restore) undo();
    // Looked for once: a platform with no such context has none later.
    if (context === undefined) context = null;
  }
}

/**
 * `prepareWithSegments(text, font)` measured in the language the engine
 * measures in (`setMeasureLanguage`). With the host's language and a
 * library whose context was never given another, the call is the one it
 * always was.
 */
export function prepareInLanguage(text: string, font: string): PreparedTextWithSegments {
  const language = getMeasureLanguage();
  const wanted = language ?? HOST_LANGUAGE;
  let keyed = font;
  if (language !== undefined) {
    let spaces = variants.get(language);
    if (spaces === undefined) {
      spaces = variants.size + 1;
      variants.set(language, spaces);
    }
    keyed = font + ' '.repeat(spaces);
  }
  if (context === undefined) {
    // Nothing to find while the host's language is all that was asked for.
    return language === undefined ? prepareWithSegments(text, font) : findContext(language, () => prepareWithSegments(text, keyed));
  }
  if (context !== null && contextLanguage !== wanted) {
    context.lang = wanted;
    contextLanguage = wanted;
  }
  return prepareWithSegments(text, keyed);
}

/** Whether the library's context was found and follows the engine's
 *  language (for tests and diagnostics). */
export function pretextLanguageState(): 'unasked' | 'followed' | 'unreachable' {
  return context === undefined ? 'unasked' : context === null ? 'unreachable' : 'followed';
}
