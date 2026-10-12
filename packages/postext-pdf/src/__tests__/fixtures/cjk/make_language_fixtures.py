#!/usr/bin/env python3
"""Rebuild the fonts of the shaping-language tests (postext #764).

Noto Serif SC, Noto Serif TC, Noto Sans SC and Noto Sans JP 400 (SIL OFL
1.1, see OFL.txt), each cut down to the characters of TEXT with its `locl`
forms kept: the digits, the ellipsis, the dashes and the quotes these faces
draw otherwise in their own language (`ZHS`, `ZHT`, `JAN`) and under the
Latin script, so a test can check that a PDF sets them as the browser
measured them in the document's language.

    python3 make_language_fixtures.py <NotoSerifSC-Regular> <NotoSerifTC-Regular> <NotoSansSC-Regular> <NotoSansJP-Regular>

Each argument is a font file (.ttf, .otf or .woff2). Writes
`noto-serif-sc-language.ttf`, `noto-serif-tc-language.ttf`,
`noto-sans-sc-language.ttf` and `noto-sans-jp-language.ttf`. The Japanese
serif of these tests is `noto-serif-jp-vertical.ttf`
(`make_japanese_fixtures.py`).
"""
import os
import sys

from fontTools import subset

HERE = os.path.dirname(os.path.abspath(__file__))
TEXT = ('0123456789"\'.,/:()'
        '\u2026\u2014\u201c\u201d\u2018\u2019\u00b7'
        '\u4e00\u4e2d\u5e74\u6708\u65e5\u672c\u597d'
        'abnGDP \u00a0')
NAMES = ['noto-serif-sc-language.ttf', 'noto-serif-tc-language.ttf', 'noto-sans-sc-language.ttf', 'noto-sans-jp-language.ttf']


def build(src, dst):
    opts = subset.Options()
    opts.layout_features = ['locl', 'ccmp', 'liga', 'kern']
    opts.drop_tables += ['DSIG', 'STAT', 'vhea', 'vmtx', 'VORG', 'BASE']
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
    if len(sys.argv) != 1 + len(NAMES):
        sys.exit(__doc__)
    for src, name in zip(sys.argv[1:], NAMES):
        build(src, os.path.join(HERE, name))
