import { describe, it, expect } from 'vitest';
import { canvasWords } from '../canvasWords';

// #770: the words Chrome's canvas shapes a string in. Each cut below was
// measured in Chrome 154: the width of the string against the sum of its
// parts, in a face that kerns across the cut (Noto Sans JP and Noto Serif
// JP kern a kana against the mark after it and against the next kana,
// Alegreya a comma against a space) or draws a mark otherwise by script
// (the dash of Noto Serif SC, the quotes of Noto Serif JP).

describe('the words of a string on the canvas (#770)', () => {
  it('a string of one word is itself', () => {
    for (const text of ['', 'a', 'word', 'l\u00B7l', '\u201Cyes\u201D', '\u672C', '\u2014\u2014', '\u0643\u062A\u0627\u0628.']) expect(canvasWords(text)).toEqual([text]);
  });

  it('cuts at a space and at a tab, each a word of its own, and at no other space', () => {
    // A space is a word of its own.
    expect(canvasWords('Li Bai')).toEqual(['Li', ' ', 'Bai']);
    // Two spaces, two words.
    expect(canvasWords('a  b')).toEqual(['a', ' ', ' ', 'b']);
    // A tab cuts.
    expect(canvasWords('a\tb')).toEqual(['a', '\t', 'b']);
    // A no-break space does not.
    expect(canvasWords('a\u00A0b')).toEqual(['a\u00A0b']);
    // Nor a thin space or an ideographic one inside Latin text.
    expect(canvasWords('a\u2009b')).toEqual(['a\u2009b']);
    // A dash between digits stays in their word.
    expect(canvasWords('9704\u20142012 \u00B7')).toEqual(['9704\u20142012', ' ', '\u00B7']);
    // Arabic words.
    expect(canvasWords('\u0623\u0644\u0641 \u0644\u064A\u0644\u0629')).toEqual(['\u0623\u0644\u0641', ' ', '\u0644\u064A\u0644\u0629']);
  });

  it('cuts around each CJK character, which keeps the marks after it', () => {
    // Kana beside kana: two words.
    expect(canvasWords('\u3048\u308B')).toEqual(['\u3048', '\u308B']);
    // A kana and the mark after it: one word.
    expect(canvasWords('\u304C\u3001\u30D7')).toEqual(['\u304C\u3001', '\u30D7']);
    // A full stop, then a Latin letter.
    expect(canvasWords('\u3059\u3002a')).toEqual(['\u3059\u3002', 'a']);
    // A Latin word, a space, a kana with its comma.
    expect(canvasWords('a \u304C\u3001')).toEqual(['a', ' ', '\u304C\u3001']);
    // The prolonged sound mark stays with the kana before it.
    expect(canvasWords('\u30E9\u30FC\u30E0')).toEqual(['\u30E9\u30FC', '\u30E0']);
    // A word that opens with marks takes the first character with a script.
    expect(canvasWords('\u3002\u300C\u6D3B\u5B57')).toEqual(['\u3002\u300C\u6D3B', '\u5B57']);
    // A line of kana and Han.
    expect(canvasWords('\u79C1\u306F\u201C\u672C\u5F53\u201D\u3068\u66F8\u304F\u3002')).toEqual(['\u79C1', '\u306F', '\u201C', '\u672C', '\u5F53', '\u201D', '\u3068', '\u66F8', '\u304F\u3002']);
    // A quote beside a kana is a word of its own.
    expect(canvasWords('\u306F"\u306F')).toEqual(['\u306F', '"', '\u306F']);
    // An iteration mark and a voicing mark.
    expect(canvasWords('\u4EBA\u3005\u304C\u304B\u309B')).toEqual(['\u4EBA\u3005', '\u304C', '\u304B\u309B']);
    // An enclosed number has no script: it stays with the character before it.
    expect(canvasWords('\uFF21\u2460b\u2460')).toEqual(['\uFF21\u2460', 'b', '\u2460']);
    // A full-width hyphen-minus is not CJK to the canvas.
    expect(canvasWords('a\uFF0Db')).toEqual(['a\uFF0Db']);
    // Hangul is cut at its spaces only.
    expect(canvasWords('\uD55C\uAD6D \uC5B4')).toEqual(['\uD55C\uAD6D', ' ', '\uC5B4']);
    // A Han character of the upper planes.
    expect(canvasWords('\u{20BB7}\u91CE')).toEqual(['\u{20BB7}', '\u91CE']);
  });

  it('a string with no character above U+00FF is cut at its spaces only', () => {
    expect(canvasWords('caf\u00E9 \u00ABau lait\u00BB')).toEqual(['caf\u00E9', ' ', '\u00ABau', ' ', 'lait\u00BB']);
  });

  it('the words put together are the string', () => {
    for (const text of ['\u3048\u308B', '\u304C\u3001\u30D7', '\u3059\u3002a', 'a \u304C\u3001', '\u30E9\u30FC\u30E0', '\u3002\u300C\u6D3B\u5B57', '\u79C1\u306F\u201C\u672C\u5F53\u201D\u3068\u66F8\u304F\u3002', '\u306F"\u306F', '\u4EBA\u3005\u304C\u304B\u309B', '\uFF21\u2460b', 'a\uFF0Db', '\uD55C\uAD6D \uC5B4', '\u{20BB7}\u91CE', 'Li Bai', 'a  b', 'a\tb', 'a\u00A0b', 'a\u2009b', '9704\u20142012 \u00B7', '\u0623\u0644\u0641 \u0644\u064A\u0644\u0629']) expect(canvasWords(text).join('')).toBe(text);
  });
});
