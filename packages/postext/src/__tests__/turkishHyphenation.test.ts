import { describe, it, expect } from 'vitest';
import { hyphenateText } from '../hyphenate.js';

const SHY = '­';
const tr = (word: string): string => hyphenateText(word, 'tr').replaceAll(SHY, '-');
const MARKS = /[ʾʿ]/g;
const APOSTROPHES = /['’]/;
const ALL_APOSTROPHES = /['’]/g;

const WORDS = [
  'kütüphanelerimizdekilerden', 'kardeşlerimizden', 'çalıştırılamayacaklarından', 'cumhuriyet', 'bilgisayar',
  'üniversite', 'kitaplık', 'öğretmen', 'çocuklar', 'gözlükçü', 'elmas', 'uzunluk', 'yazılım', 'araba', 'kaldı',
  'Türkçe', 'saat', 'şiir', 'okul', 'oda', 'ayı', 'uzun',
  "İstanbul'da", "Kur'ân'ın", "Ankara'ya", "Mehmet'in", "Türkiye'nin", "Edirne'nin", "İstanbul'dakilerden",
  'Ankara’dan', "Ahmet'ten", "Ali'nin", "Ahmet'in", 'Edirne’nin', 'Türkiye’mizin', '1996’da',
  'kelâm', 'İslâm', 'mâlûm', 'kâtip', 'hâkim', 'İslâmiyet', 'kelâmın', 'mâlûmat', 'hükûmet',
  'ḥadîs', 'ḥadîsler', 'ʿilm', 'ʿilmî', 'ʿulemâ', 'Kurʾân', 'Kurʾânı', 'Ṣaḥîḥ', 'Ġazzâlî', 'ẕikr', 'ẕikrullah',
  'ḳāḍî', 'Buḫārī', 'Ṭabarī',
  'İlim', 'İlimler', 'Işık', 'Işıklar', 'ılıman', 'İstanbul', 'Irmak', 'İzmir', 'Iğdır', 'Isparta', 'Ilgaz',
  'İnebolu', 'ıhlamur', 'ırmaklar', 'Atatürk',
  'hanımeli', 'başöğretmen', 'Afyonkarahisar', 'ilkokul', 'Karaosmanoğlu',
  'biçimine', 'insanın', 'karaca', 'birlik', 'sevmek', 'altlık', 'korkmak', 'uçurtma', 'müdafaa',
  'bandrol', 'kontrol', 'portre', 'program', 'santral', 'sürpriz', 'tundra', 'volfram',
];

const pieceLengths = (word: string): number[][] =>
  tr(word).split(/[^\p{L}\p{M}'’-]+/u).map((run) => run.split('-').map((piece) => piece.replace(MARKS, '').replace(ALL_APOSTROPHES, '').length));

const breakLetters = (hyphenated: string): number[] => {
  const points: number[] = [];
  let letters = 0;
  for (const ch of hyphenated.replace(ALL_APOSTROPHES, '')) {
    if (ch === '-') points.push(letters);
    else letters++;
  }
  return points;
};

const lettersAfterApostrophes = (word: string): number[] => {
  const points: number[] = [];
  let letters = 0;
  for (const ch of word) {
    if (APOSTROPHES.test(ch)) points.push(letters);
    else letters++;
  }
  return points;
};

describe('Turkish hyphenation: rules that do not depend on the patterns', () => {
  it('keeps every character of the word', () => {
    for (const word of WORDS) expect(hyphenateText(word, 'tr').replaceAll(SHY, '')).toBe(word);
  });

  it('never leaves one letter at the end or the start of a line, apostrophes not counted', () => {
    for (const word of WORDS) {
      for (const pieces of pieceLengths(word)) {
        if (pieces.length < 2) continue;
        expect(pieces[0], word).toBeGreaterThanOrEqual(2);
        expect(pieces[pieces.length - 1], word).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('leaves a word whose first or last syllable is one vowel whole when it has two syllables', () => {
    for (const word of ['okul', 'oda', 'ayı', 'uzun', 'İlim', 'Işık', 'ilaç', 'arı']) expect(tr(word)).toBe(word);
  });

  it('puts no hyphen right before or right after an apostrophe', () => {
    for (const word of WORDS.filter((w) => APOSTROPHES.test(w))) {
      expect(tr(word), word).not.toMatch(/-['’]|['’]-/);
    }
  });

  it('syllabifies a word with an apostrophe as if it had none, but for the break at the apostrophe', () => {
    for (const word of WORDS.filter((w) => APOSTROPHES.test(w))) {
      const without = word.replace(ALL_APOSTROPHES, '');
      const atApostrophe = lettersAfterApostrophes(word);
      expect(breakLetters(tr(word)), word).toEqual(breakLetters(tr(without)).filter((p) => !atApostrophe.includes(p)));
    }
  });

  it('puts no break beside an ʿayn or a hamza, which count as no letter', () => {
    for (const word of WORDS.filter((w) => /[ʾʿ]/.test(w))) {
      expect(tr(word), word).not.toMatch(/-[ʾʿ]|[ʾʿ]-/);
    }
    expect(tr('ʿilm')).toBe('ʿilm');
    expect(tr('Kurʾân')).toBe('Kurʾân');
  });

  it('reads İ as i and I as ı', () => {
    expect(tr('İslâm')).toContain('-');
    expect(tr('İstanbul')).toContain('-');
    expect(tr('İstanbul').slice(1)).toBe(tr('istanbul').slice(1));
    expect(tr('Irmak').slice(1)).toBe(tr('ırmak').slice(1));
    expect(tr('Işıklar').slice(1)).toBe(tr('ışıklar').slice(1));
    expect(tr('İSTANBUL').replaceAll('-', '').length).toBe('İSTANBUL'.length);
  });

  it('divides a transliterated word where its plain spelling divides', () => {
    expect(tr('ḥadîsler')).toContain('-');
    expect(tr('Ṣaḥîḥ')).toContain('-');
    expect(tr('ḥadîsler').slice(1)).toBe(tr('hadîsler').slice(1));
    expect(tr('Ġazzâlî').slice(1)).toBe(tr('Gazzâlî').slice(1));
  });

  it('keeps an abbreviation in capitals whole, with or without its suffix', () => {
    expect(['TÜBİTAK', 'UNESCO', "NATO'dan", 'UNESCO’ya', 'TBMM’nin', "ASELSAN'ın"].map(tr)).toEqual(['TÜBİTAK', 'UNESCO', "NATO'dan", 'UNESCO’ya', 'TBMM’nin', "ASELSAN'ın"]);
    expect(tr('Atatürk')).toContain('-');
    expect(tr('Ankara’dan')).toContain('-');
  });

  it('applies to every Turkish tag', () => {
    expect(hyphenateText('kütüphane', 'tr-TR')).toBe(hyphenateText('kütüphane', 'tr'));
  });

  it('leaves the other languages as they were', () => {
    expect(hyphenateText('terra', 'it').replaceAll(SHY, '-')).toBe('ter-ra');
    expect(hyphenateText('dell’acqua', 'it').replaceAll(SHY, '-')).toBe('dell’ac-qua');
    expect(hyphenateText("couldn't", 'en-us').replaceAll(SHY, '-')).not.toMatch(/-n't/);
  });
});

describe('Turkish syllables (TDK)', () => {
  it('long words with suffixes', () => {
    expect(['kütüphanelerimizdekilerden', 'kardeşlerimizden', 'çalıştırılamayacaklarından', 'cumhuriyet', 'bilgisayar', 'üniversite'].map(tr))
      .toEqual(['kü-tüp-ha-ne-le-ri-miz-de-ki-ler-den', 'kar-deş-le-ri-miz-den', 'ça-lış-tı-rı-la-ma-ya-cak-la-rın-dan', 'cum-hu-ri-yet', 'bil-gi-sa-yar', 'üni-ver-si-te']);
  });

  it('one consonant goes with the next vowel, two are parted, of three the first two stay', () => {
    expect(['kitaplık', 'öğretmen', 'çocuklar', 'gözlükçü', 'elmas', 'uzunluk', 'yazılım', 'araba', 'kaldı', 'Türkçe'].map(tr))
      .toEqual(['ki-tap-lık', 'öğ-ret-men', 'ço-cuk-lar', 'göz-lük-çü', 'el-mas', 'uzun-luk', 'ya-zı-lım', 'ara-ba', 'kal-dı', 'Türk-çe']);
  });

  it('the examples of the TDK syllable rules', () => {
    expect(['biçimine', 'insanın', 'karaca', 'kaldı', 'birlik', 'sevmek', 'altlık', 'Türkçe', 'korkmak'].map(tr))
      .toEqual(['bi-çi-mi-ne', 'in-sa-nın', 'ka-ra-ca', 'kal-dı', 'bir-lik', 'sev-mek', 'alt-lık', 'Türk-çe', 'kork-mak']);
  });

  it('words of Western origin divide by the Turkish syllable', () => {
    expect(['bandrol', 'kontrol', 'portre', 'program', 'santral', 'sürpriz', 'tundra', 'volfram'].map(tr))
      .toEqual(['band-rol', 'kont-rol', 'port-re', 'prog-ram', 'sant-ral', 'sürp-riz', 'tund-ra', 'volf-ram']);
  });

  it('leaves no single letter at a line end or start', () => {
    expect(['uçurtma', 'müdafaa', 'araba'].map(tr)).toEqual(['uçurt-ma', 'mü-da-faa', 'ara-ba']);
  });

  it('two vowels side by side are parted', () => {
    expect(['saat', 'şiir'].map(tr)).toEqual(['sa-at', 'şi-ir']);
  });

  it('an apostrophe parts no syllable, and gets no hyphen where it stands', () => {
    expect(["İstanbul'da", "Ankara'ya", "Mehmet'in", "Türkiye'nin", "Edirne'nin", "İstanbul'dakilerden", 'Ankara’dan', "Ahmet'ten", "Ali'nin", "Kur'ân'ın", "Ahmet'in", 'Edirne’nin', 'Türkiye’mizin', '1996’da'].map(tr))
      .toEqual(["İs-tan-bul'da", "An-ka-ra'ya", "Meh-me-t'in", "Tür-ki-ye'nin", "Edir-ne'nin", "İs-tan-bul'da-ki-ler-den", 'An-ka-ra’dan', "Ah-met'ten", "Ali'nin", "Ku-r'â-n'ın", "Ah-me-t'in", 'Edir-ne’nin', 'Tür-ki-ye’mi-zin', '1996’da']);
  });

  it('words with a circumflex', () => {
    expect(['kelâm', 'İslâm', 'mâlûm', 'kâtip', 'hâkim', 'İslâmiyet', 'kelâmın', 'mâlûmat', 'hükûmet'].map(tr))
      .toEqual(['ke-lâm', 'İs-lâm', 'mâ-lûm', 'kâ-tip', 'hâ-kim', 'İs-lâ-mi-yet', 'ke-lâ-mın', 'mâ-lû-mat', 'hü-kû-met']);
  });

  it('transliterated words', () => {
    expect(['ḥadîs', 'ḥadîsler', 'ʿilmî', 'ʿulemâ', 'Kurʾânı', 'Ṣaḥîḥ', 'Ġazzâlî', 'ẕikr', 'ẕikrullah', 'ḳāḍî', 'Buḫārī', 'Ṭabarī'].map(tr))
      .toEqual(['ḥa-dîs', 'ḥa-dîs-ler', 'ʿil-mî', 'ʿule-mâ', 'Kurʾâ-nı', 'Ṣa-ḥîḥ', 'Ġaz-zâ-lî', 'ẕikr', 'ẕik-rul-lah', 'ḳā-ḍî', 'Bu-ḫā-rī', 'Ṭa-ba-rī']);
  });

  it('İ, I and ı', () => {
    expect(['İlimler', 'Işıklar', 'ılıman', 'İstanbul', 'Irmak', 'İzmir', 'Iğdır', 'Isparta', 'Ilgaz', 'İnebolu', 'ıhlamur', 'ırmaklar', 'Atatürk'].map(tr))
      .toEqual(['İlim-ler', 'Işık-lar', 'ılı-man', 'İs-tan-bul', 'Ir-mak', 'İz-mir', 'Iğ-dır', 'Is-par-ta', 'Il-gaz', 'İne-bo-lu', 'ıh-la-mur', 'ır-mak-lar', 'Ata-türk']);
  });

  it('compounds written as one word are divided by syllable', () => {
    expect(['hanımeli', 'başöğretmen', 'Afyonkarahisar', 'ilkokul', 'Karaosmanoğlu'].map(tr))
      .toEqual(['ha-nı-me-li', 'ba-şöğ-ret-men', 'Af-yon-ka-ra-hi-sar', 'il-ko-kul', 'Ka-ra-os-ma-noğ-lu']);
  });
});
