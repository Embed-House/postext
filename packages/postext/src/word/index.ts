// Word documents in and out (#599): read a `.docx` into Postext Markdown
// with a style template and a quality report, and write chapters back to a
// `.docx` that carries the template for the round trip. Pure code (fflate
// and a small XML reader): runs in the browser, a Worker and Node.

export { readDocx, DocxReadError, TEMPLATE_XML_ROOT, TEMPLATE_XML_NS } from './docxRead.js';
export { wordToPostext, pictureResolution, paragraphTargetOf, characterTargetOf, stripCaptionLabel, tableModel } from './toMarkdown.js';
export type { ChapterMode, ImportedPicture, ImportedTable, ImportedChapter, ImportResult, ImportSettings } from './toMarkdown.js';
export { postextToDocx, DEFAULT_STYLE_NAMES } from './toDocx.js';
export type { ExportChapter, WordStyleNames, ExportSettings } from './toDocx.js';
export { wordStyleTracking, applyStyleTracking } from './tracking.js';
export type { StyleTracking } from './tracking.js';
export { analyzeDocx } from './analyze.js';
export type { StyleUse, FindingId, QualityFinding, QualityVerdict, QualityReport } from './analyze.js';
export {
  DEFAULT_IMPORT_OPTIONS,
  MARKUP_STYLE,
  MARKUP_CHAR_STYLE,
  CHAPTER_STYLE,
  emptyTemplate,
  calloutStylesOf,
  chipStylesOf,
  displayStyleName,
  lookup,
  guessParagraphTarget,
  guessCharacterTarget,
  parseTemplate,
  templateFile,
  newTemplateId,
} from './template.js';
export type { ParagraphTarget, CharacterTarget, ParagraphTargetKind, CharacterTargetKind, WordImportOptions, WordTemplate } from './template.js';
export { parseInline, renderInline } from './inline.js';
export type { InlineRun, ParseInlineOptions } from './inline.js';
export { paragraphStyleName, paragraphText } from './model.js';
export type {
  WordStyleType,
  WordStyle,
  WordTextRun,
  WordRun,
  WordParagraph,
  WordCell,
  WordTable,
  WordBlock,
  WordNumberingLevel,
  WordNumbering,
  WordMedia,
  WordDocument,
} from './model.js';
