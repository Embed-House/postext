/**
 * The print preview a viewer paints its pages with (#606): the soft proof
 * of the output profile on the paper's white, the trim / bleed / safe-zone
 * guides and the preflight marks of each page. The Canvas and the Folio
 * show the same proof (#799).
 */

import { dimensionToPx, preflightDocument, type BoundingBox, type PdfGenerationConfig, type PrintConfig, type PrintPreview, type Resource, type VDTDocument } from 'postext';
import { preflightInputs } from './preflightInputs';
import { previewFor, type PrintSetup } from './printSetup';

/**
 * Whether the PDF prints in grays (#800): forced to DeviceGray, and not a
 * PDF/X file (which is written in CMYK whatever the colour space says).
 */
export function printsGrayscale(pdf: PdfGenerationConfig | undefined, setup: PrintSetup): boolean {
  return pdf?.forceColorSpace === true && pdf.colorSpace === 'grayscale' && setup.print.standard === 'none';
}

/**
 * The preview of a loaded setup, or undefined while its profile loads.
 * `docOf` names the document being painted (read when a page is painted:
 * its marks are worked out once per document), `resourcesOf` the
 * resources its pictures come from.
 */
export function viewerPreview(
  setup: PrintSetup,
  dpi: number,
  raw: PrintConfig | undefined,
  resourcesOf: () => Resource[],
  docOf: () => VDTDocument | null,
  /** Proof the pages as a grayscale print ({@link printsGrayscale}). */
  grayscale = false,
): PrintPreview | undefined {
  const base = previewFor(setup, dpi, true, grayscale);
  if (!base || !setup.transform) return undefined;
  const transform = setup.transform;
  const marks = new WeakMap<VDTDocument, Map<number, BoundingBox[]>>();
  const marksOf = (doc: VDTDocument): Map<number, BoundingBox[]> => {
    let byPage = marks.get(doc);
    if (!byPage) {
      byPage = new Map();
      const resources = resourcesOf();
      // The files' real pixels, as the Checks panel reads them (#631).
      const { imageSize } = preflightInputs(raw, resources);
      const issues = preflightDocument(doc, { print: setup.print, transform, resources, imageSize, cmyk: true });
      const offset = doc.pageIndexOffset ?? 0;
      for (const issue of issues) {
        if (!issue.rect) continue;
        const list = byPage.get(issue.pageIndex - offset) ?? [];
        list.push(issue.rect);
        byPage.set(issue.pageIndex - offset, list);
      }
      marks.set(doc, byPage);
    }
    return byPage;
  };
  return {
    ...base,
    guides: { safeZonePx: dimensionToPx(setup.print.preflight.safeZone, dpi) },
    marksFor: (pageIndex) => {
      const doc = docOf();
      return doc ? marksOf(doc).get(pageIndex) ?? [] : [];
    },
  };
}
