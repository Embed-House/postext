#!/usr/bin/env python3
"""The probe font of `make-ot-languages.mjs`.

A font of one letter, `a`, whose `locl` feature under the Latin script
replaces it by another glyph in every OpenType language system named on the
command line: glyph 2 for the first tag, glyph 3 for the second, and so on.
Shaping `a` in a language then tells which language system the shaper chose
for it, by the glyph that comes out (glyph 1: none of them).

    python3 ot_language_probe.py <out.ttf> <TAG> [<TAG> ...]

Needs fontTools (feaLib). A tag is written without its trailing spaces.
"""
import sys

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


def build(out, tags):
    names = ['.notdef', 'a'] + ['l%04d' % i for i in range(len(tags))]
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({0x61: 'a'})
    empty = TTGlyphPen(None).glyph()
    fb.setupGlyf({name: empty for name in names})
    fb.setupHorizontalMetrics({name: (500, 0) for name in names})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({'familyName': 'Probe', 'styleName': 'Regular'})
    fb.setupOS2()
    fb.setupPost()
    # Each language system has the one rule; the default one has none.
    rules = ''.join('  language %s exclude_dflt;\n  sub a by l%04d;\n' % (tag, i) for i, tag in enumerate(tags))
    addOpenTypeFeaturesFromString(fb.font, 'languagesystem DFLT dflt;\nlanguagesystem latn dflt;\nfeature locl {\n  script latn;\n%s} locl;\n' % rules)
    fb.save(out)


if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2:])
