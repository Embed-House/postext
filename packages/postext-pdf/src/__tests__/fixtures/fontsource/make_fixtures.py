#!/usr/bin/env python3
"""Rebuild the fonts of the tests of text shaped in a document's language
in right-to-left runs and across the cuts of a word (postext #764).

The files Fontsource serves, which the Cookbook's recipes load on the
screen and embed in the PDF (SIL OFL 1.1, see OFL.txt), each cut down to
the characters of the tests with every OpenType layout rule kept:

- Markazi Text 400 (1.001), its `latin` and its `arabic` file. The `latin`
  file holds the guillemets, the brackets and the stops, and draws the
  guillemets narrower for Arabic text in Arabic (`arab`, `ARA `).
- Amiri 400 (1.002), its `latin` and its `arabic` file. The `latin` file
  sets a Latin stop, brackets and guillemets under `latn` only.
- Crimson Pro 400 (1.003), its `latin` file, whose Catalan `l·l` takes a
  dot of its own between two `l` (`latn`, `CAT `).
- Aref Ruqaa 700 (1.003), its `arabic` file, whose space is 0.146 em wide
  in Arabic text (`arab`) and 0.333 em in any other: the space between two
  Arabic words, which a browser's canvas shapes as a word of its own
  (postext #770).

    python3 make_fixtures.py <folder>

`<folder>` holds `markazi-text-latin-400-normal.woff2`,
`markazi-text-arabic-400-normal.woff2`, `amiri-latin-400-normal.woff2`,
`amiri-arabic-400-normal.woff2`, `crimson-pro-latin-400-normal.woff2` and
`aref-ruqaa-arabic-700-normal.woff2`, as `@fontsource/<family>@5.3.0/files/`
names them. Writes `markazi-text-latin.ttf`, `markazi-text-arabic.ttf`,
`amiri-latin.ttf`, `amiri-arabic.ttf`, `crimson-pro-latin.ttf` and
`aref-ruqaa-arabic.ttf`.
"""
import os
import sys

from fontTools import subset

HERE = os.path.dirname(os.path.abspath(__file__))

# The words of the Arabic tests, and the marks that stand beside them.
ARABIC = ('قلت أنا يا خالة '
          'يوسف ويقال كتاب '
          'سافرت إلى البيوت '
          'ثم مشيت ب ،؟ـ')
MARKS = '  «»().:!?[]"-0123456789abcdn“”—…'
# The title of the Aref Ruqaa test, and the spaces between its words.
TITLE = 'ألف ليلة وليلة \u00a0'
# The words of the Catalan tests.
CATALAN = ('La instal·lació de la il·luminació col·lectiva fou una '
           'il·lusió paral·lela del COL·LEGI que vacil·lava. ,;-— '
           'abcdefghijklmnopqrstuvxyz')


def build(folder, name, text, dst):
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.drop_tables += ['DSIG', 'STAT']
    opts.name_IDs = [1, 2, 3, 4, 6]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False
    font = subset.load_font(os.path.join(folder, name), opts)
    cmap = font.getBestCmap()
    sub = subset.Subsetter(opts)
    # Each file keeps the characters it holds: the letters are in one,
    # the marks in the other, as the browser takes them.
    sub.populate(unicodes=sorted({ord(ch) for ch in text if ord(ch) in cmap}))
    sub.subset(font)
    font.flavor = None
    subset.save_font(font, os.path.join(HERE, dst), opts)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    folder = sys.argv[1]
    for family in ('markazi-text', 'amiri'):
        build(folder, f'{family}-latin-400-normal.woff2', MARKS, f'{family}-latin.ttf')
        build(folder, f'{family}-arabic-400-normal.woff2', ARABIC, f'{family}-arabic.ttf')
    build(folder, 'crimson-pro-latin-400-normal.woff2', CATALAN, 'crimson-pro-latin.ttf')
    build(folder, 'aref-ruqaa-arabic-700-normal.woff2', TITLE, 'aref-ruqaa-arabic.ttf')
