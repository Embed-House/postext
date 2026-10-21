/** Comics (`:::page`, #555–#563): the split grammar, the panel script, the
 *  page geometry, the picture crop and the page layout. */
export {
  parseComicSplit,
  serializeComicSplit,
  moveComicSplitLine,
  splitComicCell,
  mergeComicCells,
  comicSplitLines,
  comicSplitLeaves,
  comicSplitListAt,
  COMIC_MIN_CELL_PERCENT,
} from './split.js';
export type { ComicSplitAxis, ComicSplitSize, ComicSplitItem, ComicSplitList, ComicSplitToken, ComicSplitIssue, ComicSplitParse } from './split.js';
export { parseComicScript, parseComicPoint, readBalloonText } from './script.js';
export type { ComicScriptLine } from './script.js';
export { parseComicFence, isComicFence, COMIC_FENCES } from './page.js';
export { comicGeometry, pointInPolygon, polygonBBox, physicalSide } from './geometry.js';
export type { ComicCell, ComicSplitLine, ComicGeometry, ComicGeometryInput, ComicFrameSide } from './geometry.js';
export { comicArtCrop, comicCropFeasibleRange, comicArtPointToPage, comicArtRectToPage, anchorsOutsideSafeArea } from './art.js';
export type { ComicCropInput, ComicCrop } from './art.js';
export { layoutComicPage, comicViewerLeaf, letterPanels, comicLetteringStyle, comicLetteringLocale, comicLetteringVertical, comicPageDirection, comicPanelPadding, parseComicDimension, comicPageLayoutWarnings } from './layoutPage.js';
export type { ComicPageContext, LetterPanelsInput } from './layoutPage.js';
export { letterPanel, letterPanelDetailed, presetLetteringStyles } from './lettering/index.js';
export type { LetteringItem, LetteringPanel, LetteringStyle, LetteringAnchor, LetteringDiagnostic, LetteringResult, LetteringEnv } from './lettering/index.js';
export { comicSourceWarnings } from './warnings.js';
export { layoutComicFrame, comicPageFrame } from './layoutPage.js';
export type { ComicFrameContext } from './layoutPage.js';
export { layoutComicStrip, comicStripPlacement, comicStripExtent, comicStripAspect, comicSplitGrid, parseComicAspect, parseComicStripWidth, parseComicStripAlign, comicStripWidth, comicStripOffset } from './strip.js';
export type { ComicStripPlacement, ComicStripContext, ComicStripAlign } from './strip.js';
export { layoutComicSpread, isComicSpread } from './spread.js';
export type { ComicSpreadContext, ComicSpreadPage } from './spread.js';
export { translateComicPage, translateComicPanel, translateComicSplitter, translateComicBalloon, translateComicFrame, translateSvgPath, comicBlockOnSheet, pageComics } from './transform.js';
export { comicElementId, comicFrameElementId, comicBalloonElementId, comicFrameName, isComicTextPanel, comicBoxStyle, comicFrameSpecs } from './frames.js';
export type { ComicFrameSpec } from './frames.js';
export { comicTextPanelsSupported } from './textPanels.js';
export { comicFontFamilies, markdownHasComics } from './fonts.js';
export { COMIC_RESERVED_KEYS } from './types.js';
export type { ComicPageSource, ComicPanelSource, ComicScriptItem, ComicScriptRole, ComicSourceRange, ComicTailSide } from './types.js';
export {
  comicBalloonKind,
  comicBalloonText,
  comicSpeakerName,
  comicBalloonGroups,
  comicPanelPathData,
  comicBorderPathData,
  comicRoughBorder,
  polygonPathData,
  comicPanelContinues,
  isComicSpreadPartner,
  joinComicSpread,
  comicBalloonMatrix,
} from './paint.js';
export type { ComicBalloonKind } from './paint.js';
