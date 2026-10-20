/**
 * A figure's labels as text (#862): what the outputs that do not draw a
 * `:::figure`'s `::label` lines on its picture read instead. The tagged
 * PDF's `Alt` and the HTML viewer's `alt` give the picture's alternative
 * text followed by its labels; the reflowable EPUB lists them after the
 * picture.
 */
import type { VDTFigureLabel } from '../vdt';

/** A label's text read as one line (#1045): its forced line breaks (a
 *  `\\` that ends a word, `Pico Albar \\ 2565 m`) are spaces, as is any
 *  run of white space. `VDTFigureLabel.text` keeps them, as written. */
export function labelPlainText(text: string): string {
  return text.replace(/\\\\(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A figure's alternative text followed by its labels, in the order
 *  written: `Alt (Label, Label)`; the full-width brackets and the
 *  enumeration comma for Chinese and Japanese labels, the Arabic comma for
 *  Arabic ones. The labels alone when there is no alternative text; the
 *  text as it is when there are no labels. */
export function altWithLabels(alt: string, labels: readonly Pick<VDTFigureLabel, 'text'>[] | undefined): string {
  const texts = (labels ?? []).map((l) => labelPlainText(l.text)).filter(Boolean);
  if (texts.length === 0) return alt;
  const all = texts.join('');
  if (/[぀-ヿ㐀-鿿]/.test(all)) return alt ? `${alt}（${texts.join('、')}）` : texts.join('、');
  const list = texts.join(/[؀-ۿ]/.test(all) ? '، ' : ', ');
  return alt ? `${alt} (${list})` : list;
}
