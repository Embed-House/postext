#!/usr/bin/env python3
"""Rebuild the Latin font of the shaping-language tests (postext #764).

Alegreya 400 (SIL OFL 1.1, see OFL.txt), cut down to the characters of TEXT
with its `locl`, `liga`, `ccmp` and `kern` rules kept. The face has forms
of its own in several languages, which a test sets through the PDF's two
shapers: the Catalan `l·l` (`CAT`), the Turkish `i` that keeps `fi` apart
(`TRK`), the Romanian `ș` and `ț` for `ş` and `ţ` (`ROM`, `MOL`), the Dutch
`íj` (`NLD`) and the Serbian `б` (`SRB`, under the Cyrillic script).

    python3 make_language_fixtures.py <Alegreya-Regular.ttf>

Writes `alegreya-language.ttf`.
"""
import os
import sys

from fontTools import subset

HERE = os.path.dirname(os.path.abspath(__file__))
TEXT = ('fil\u00b7lL'
        '\u015f\u0163\u015e\u0162\u0219\u021b\u0218\u021a'
        '\u00edj\u00cdJ'
        '\u0431\u0430'
        'aceno .,1 \u00a0')


def build(src, dst):
    opts = subset.Options()
    opts.layout_features = ['locl', 'liga', 'ccmp', 'kern']
    opts.drop_tables += ['DSIG', 'STAT']
    opts.name_IDs = [1, 2, 3, 4, 6]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False
    font = subset.load_font(src, opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=TEXT)
    sub.subset(font)
    font.flavor = None
    subset.save_font(font, dst, opts)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    build(sys.argv[1], os.path.join(HERE, 'alegreya-language.ttf'))
