// ─── Kit · fonts v3 ── the same in every recipe · postext.dev/cookbook
// Postext loads the faces a config asks for before layout and asks the kit
// for Fontsource's files, the ones the PDF embeds too.

/** buildDocumentWithFonts' options: the resolver, and FONTS' faces loaded
 *  with the config's. FONTS = { 'Family Name': ['400', '400i', '700'] }. */
function kitFonts(FONTS = {}) {
  const faces = Object.entries(FONTS).flatMap(([family, specs]) => specs.map((spec) =>
    ({ family, weight: parseInt(spec, 10), style: spec.endsWith('i') ? 'italic' : 'normal' })));
  return { resolve: fontsourceResolver, faces };
}

/** A face's files with their ranges: latin, then latin-ext and greek when
 *  `text` needs them (kitSubsetsFor). Null for a face Fontsource lacks. */
async function fontsourceResolver(family, weight, style, { text = '' } = {}) {
  const id = fontsourceId(family);
  const meta = await fontsourceMeta(family);
  if (meta && !(await fontsourceWeights(family, style)).includes(weight)) return null;
  kitStatus('Loading fonts…');
  const at = await fontsourceAt(id);
  return ['latin', ...kitSubsetsFor(text, meta)].map((subset) => ({
    source: `${at}files/${id}-${subset}-${weight}-${style}.woff2`,
    unicodeRange: kitRanges()[subset],
  }));
}

/** Each file's unicode-range (a function: the kit runs after the pen's code). */
function kitRanges() {
  return {
    latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,'
      + 'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,'
      + 'U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    greek: 'U+0370-03FF',
  };
}

/** For the cjk, arabic and comics blocks: loads `faces` (as FONTS) for the
 *  sample `text`; `optional` skips a face Fontsource lacks. Files are added in
 *  the order asked, the last winning a shared character. Resolves to the count. */
async function loadFonts(faces, text = '', { optional = false } = {}) {
  kitStatus('Loading fonts…');
  const ranges = kitRanges();
  const jobs = [];
  for (const [family, specs] of Object.entries(faces)) {
    const id = fontsourceId(family);
    const todo = [...new Set(specs)].map((spec) => [parseInt(spec, 10), spec.endsWith('i') ? 'italic' : 'normal'])
      .filter(([weight, style]) => !hasFace(family, weight, style)); // before any await
    const at = fontsourceAt(id);
    const meta = optional || /[^\0-ÿ]/u.test(text) ? await fontsourceMeta(family) : null;
    const subsets = ['latin', ...kitSubsetsFor(text, meta)];
    for (const [weight, style] of todo) {
      if (optional && !(meta && (await fontsourceWeights(family, style)).includes(weight))) continue;
      for (const subset of subsets) {
        const url = `${await at}files/${id}-${subset}-${weight}-${style}.woff2`;
        const face = new FontFace(family, `url(${url}) format('woff2')`,
          { weight: String(weight), style, unicodeRange: ranges[subset] });
        jobs.push(face.load().catch(() => {
          if (subset === 'latin' && !optional) throw new Error(`Fontsource has no ${family} ${weight} ${style}`);
        }));
      }
    }
  }
  const ready = await Promise.all(jobs).catch((error) => { kitFail(error); throw error; });
  return ready.filter((face) => face && document.fonts.add(face)).length;
}

/** A loaded FontFace covers this face (fonts.check() says yes to any family). */
function hasFace(family, weight, style) {
  for (const face of document.fonts) {
    if (face.status !== 'loaded' || face.style !== style) continue;
    if (face.family.replace(/^["']|["']$/g, '') !== family) continue;
    const [low, high = low] = face.weight.split(' ').map(Number);
    if (weight >= low && weight <= high) return true;
  }
  return false;
}

/** The files beyond latin `text` needs that `meta`'s family ships. */
function kitSubsetsFor(text, meta) {
  return [[/[Ā-˿ᴀ-ᶿḀ-ỿ†ℓⱠ-Ɀ꜠-ꟿ]/u, 'latin-ext'], [/[Ͱ-Ͽ]/u, 'greek']]
    .filter(([re, x]) => re.test(text) && meta?.subsets?.includes(x)).map(([, x]) => x);
}

/** Fontsource's id for a family: 'Source Serif 4' → 'source-serif-4'. */
function fontsourceId(family) { return family.toLowerCase().replace(/\s+/g, '-'); }

/** A package's folder at the one version @5 names now (#766). */
function fontsourceAt(id, u = `https://cdn.jsdelivr.net/npm/@fontsource/${id}@`) {
  return (fontsourceAt.c ??= {})[id] ??= fetch(u + '5/package.json').then((r) => r.json())
    .then((p) => p.version || 5, () => 5).then((v) => `${u}${v}/`);
}

/** The family's Fontsource metadata (weights, styles, subsets), or null. */
function fontsourceMeta(family, id = fontsourceId(family)) {
  return (fontsourceMeta.c ??= {})[id] ??= fetch(`https://api.fontsource.org/v1/fonts/${id}`)
    .then((res) => (res.ok ? res.json() : null), () => null);
}

/** The weights the package ships in `style`: the API pairs none (no Libre
 *  Caslon 700 italic file), so italics are read from latin-italic.css. */
function fontsourceWeights(family, style, id = fontsourceId(family)) {
  return (fontsourceWeights.c ??= {})[id + style] ??= fontsourceMeta(family).then(async (m) => {
    if (!m?.styles.includes(style)) return m ? [] : [400, 700];
    const css = style === 'italic' ? await fetch(`${await fontsourceAt(id)}latin-italic.css`).then((r) => (r.ok ? r.text() : ''), () => '') : '';
    const w = [...css.matchAll(/weight: (\d+)/g)].map((x) => +x[1]);
    return w.length ? w : m.weights;
  });
}
