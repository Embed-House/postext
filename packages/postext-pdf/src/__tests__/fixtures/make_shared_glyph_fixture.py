#!/usr/bin/env python3
"""Build `shared-glyphs.ttf`: a TrueType face of a few Latin letters, drawn
from Lora Regular (SIL OFL 1.1), whose cmap gives two characters one glyph
twice over, as many text faces do: the space and the no-break space, the
hyphen-minus and the hyphen (U+2010). For the tests of the text a glyph
reads back as when the font's map holds another character for it (#755).

    python3 make_shared_glyph_fixture.py      # needs fontTools
"""
import os

from fontTools.fontBuilder import FontBuilder
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, '../../../../../apps/web/public/fonts/Lora-Regular.ttf')
TEXT = ' -Nabo12'
SHARED = {0x00A0: ' ', 0x2010: '-'}

src = TTFont(SOURCE)
cmap = src.getBestCmap()
hmtx = src['hmtx']
names = ['.notdef'] + sorted({cmap[ord(c)] for c in TEXT})
glyphs = {name: src['glyf'][name] for name in names}
for name, glyph in glyphs.items():
    assert not glyph.isComposite(), name
fb = FontBuilder(src['head'].unitsPerEm, isTTF=True)
fb.setupGlyphOrder(names)
fb.setupCharacterMap({**{ord(c): cmap[ord(c)] for c in TEXT}, **{cp: cmap[ord(c)] for cp, c in SHARED.items()}})
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({name: hmtx[name] for name in names})
fb.setupHorizontalHeader(ascent=src['hhea'].ascent, descent=src['hhea'].descent)
fb.setupNameTable({'familyName': 'Shared Glyphs', 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=src['OS/2'].sTypoAscender, sTypoDescender=src['OS/2'].sTypoDescender, usWinAscent=src['OS/2'].usWinAscent, usWinDescent=src['OS/2'].usWinDescent)
fb.setupPost()
fb.save(os.path.join(HERE, 'shared-glyphs.ttf'))
