import { describe, expect, it } from 'vitest';
import { comicFontFamilies, comicLineFontFamilies } from '../../comics/fonts';
import { configFontFaces } from '../../fonts/prepare';
import { configFontFamilies } from '../../fonts/usage';

// #696: a comic line may set its own face (`sfx{font="Dela Gothic One"}`).
// The family is named in the text alone, so the list of the families a
// book needs, which the Sandbox and the CLI load from, has to read it
// there: manga-action-slants opened with ドン in a fallback face.

const page = (...lines: string[]) => `:::page{split="*"}\n::panel{art=strike}\n${lines.join('\n')}\n:::\n`;
const don = 'sfx{at="74% 30%" rotate=-8 size=2.6 font="Dela Gothic One" vertical break}: ドン';

describe('the families a comic line names itself (#696)', () => {
  it('lists the face of a line that sets one', () => {
    const markdown = `# Strike\n\n${page('rival{shout}: MEEEN!', don, 'sfx{at="64% 80%" size=0.9}: WHAM')}`;
    expect(comicLineFontFamilies(markdown)).toEqual(['Dela Gothic One']);
    expect(comicFontFamilies({}, markdown)).toContain('Dela Gothic One');
    expect(configFontFamilies({}, markdown)).toContain('Dela Gothic One');
    expect(configFontFamilies({ locale: 'ja', comics: {} }, markdown)).toContain('Dela Gothic One');
    // The faces a host is asked for before a build name it too.
    expect(configFontFaces({}, markdown).some((face) => face.family === 'Dela Gothic One')).toBe(true);
  });

  it('reads every chapter, every block and every way of writing the attribute', () => {
    const chapters = [
      '# One\n\nNo comic here.',
      `${page('ana{font=Bangers}: Bare.')}\nText between.\n\n:::strip{split="* | *"}\nsfx{font='Rock Salt'}: KRAK\n  ...and its second line\n:::\n`,
      page("narrator{font=\"Zen Antique\"}: 夜。", don),
    ];
    expect(comicLineFontFamilies(chapters)).toEqual(['Bangers', 'Rock Salt', 'Zen Antique', 'Dela Gothic One']);
    // The lettering faces come first, the lines' own after them, once each.
    const families = comicFontFamilies({}, chapters);
    expect(families.slice(-4)).toEqual(['Bangers', 'Rock Salt', 'Zen Antique', 'Dela Gothic One']);
    expect(new Set(families).size).toBe(families.length);
    expect(comicFontFamilies({ comics: { balloonStyles: [{ id: 'sfx', fontFamily: 'Bangers' }] } }, chapters).filter((f) => f === 'Bangers')).toHaveLength(1);
  });

  it('counts nothing outside a comic block, in a comment or with no value', () => {
    expect(comicLineFontFamilies(`A paragraph that says font="Dela Gothic One".\n\n${page('ana: Plain.')}`)).toEqual([]);
    expect(comicLineFontFamilies(page(`<!-- ${don} -->`, 'ana: Plain.'))).toEqual([]);
    expect(comicLineFontFamilies(page('sfx{font=""}: KRAK', 'sfx{font="  "}: KRAK'))).toEqual([]);
    // The word in a line's text is not the attribute.
    expect(comicLineFontFamilies(page('ana: Which font="Bangers" is that?'))).toEqual([]);
    expect(comicLineFontFamilies(undefined)).toEqual([]);
    expect(comicLineFontFamilies('')).toEqual([]);
    // A document with no comic block asks for no comic face at all.
    expect(comicFontFamilies({}, `Plain text with ${don}`)).toEqual([]);
    expect(configFontFamilies({}, 'Plain text.')).not.toContain('Dela Gothic One');
  });

  it('reads a block left open at the end of the text', () => {
    expect(comicLineFontFamilies(`:::page\n${don}\n`)).toEqual(['Dela Gothic One']);
  });
});
