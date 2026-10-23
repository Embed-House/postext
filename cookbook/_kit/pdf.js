// ─── Kit · pdf v3 ── the same in every recipe that exports a PDF
/** The Fontsource files the screen used, as TrueType, with their range and
 *  place: the nearest weight the family ships in that style, upright with no italic;
 *  latin, then what its letters need (kitSubsetsFor). */
async function fontsourceProvider(family, weight, style, request) {
  const id = fontsourceId(family);
  const meta = await fontsourceMeta(family);
  const s = style === 'italic' && meta && !meta.styles.includes('italic') ? 'normal' : style;
  const shipped = meta ? await fontsourceWeights(family, s) : [];
  const weights = shipped.length ? shipped : [400, 700];
  const w = weights.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a));
  const text = String.fromCodePoint(...(request?.codePoints ?? []));
  const files = await Promise.all(['latin', ...kitSubsetsFor(text, meta)].map(async (subset, order) => {
    const res = await fetch(`${await fontsourceAt(id)}files/${id}-${subset}-${w}-${s}.woff2`);
    if (!res.ok) throw new Error(`Fontsource has no ${family} ${w} ${s} ${subset}`);
    return Object.assign(await decompressWoff2(new Uint8Array(await res.arrayBuffer())),
      { unicodeRange: kitRanges()[subset], order });
  }));
  return files.length === 1 ? files[0] : files;
}

/** A "Build the PDF" button; then "Open the PDF" (a new tab: CodePen's frame
 *  shows no PDFs) and a download link. */
function offerPdf(makePdf, filename) {
  viewer();
  const button = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Build the PDF' });
  button.dataset.postextPdf = filename;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Building the PDF…';
    try {
      const bytes = await makePdf();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const size = `${Math.max(1, Math.round(bytes.length / 1024))} KB`;
      button.replaceWith(
        Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener', textContent: 'Open the PDF ↗' }),
        Object.assign(document.createElement('a'), { href: url, download: filename, textContent: `Download ${filename} · ${size}` }));
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Build the PDF';
      kitFail(error);
    }
  });
  document.getElementById('pt-actions').append(button);
}
