import type { ComponentType } from 'react';
import type { SettingsSectionId } from './registry.js';
import { ColorPaletteSection } from './ColorPaletteSection.js';
import { PageSection } from './PageSection.js';
import { LayoutSection } from './LayoutSection.js';
import { HeaderFooterSection } from './HeaderFooterSection/index.js';
import { BodyTextSection } from './BodyTextSection/index.js';
import { HeadingsSection } from './HeadingsSection/index.js';
import { HeadingStylesSection } from './HeadingStylesSection.js';
import { TocSection } from './TocSection.js';
import { IndexSection } from './IndexSection.js';
import { PartsSection } from './PartsSection.js';
import { UnorderedListsSection } from './UnorderedListsSection/index.js';
import { OrderedListsSection } from './OrderedListsSection/index.js';
import { MathSection } from './MathSection.js';
import { FootnotesSection } from './FootnotesSection.js';
import { LineNumbersSection } from './LineNumbersSection.js';
import { CrossRefsSection } from './CrossRefsSection.js';
import { CitationsSection } from './CitationsSection.js';
import { CjkSection } from './CjkSection.js';
import { WritingSection } from './WritingSection.js';
import { TableStyleSection } from './TableStyleSection.js';
import { TableStylesSection } from './TableStylesSection.js';
import { CaptionStyleSection } from './CaptionStyleSection.js';
import { ParagraphStylesSection } from './ParagraphStylesSection.js';
import { CalloutStylesSection } from './CalloutStylesSection.js';
import { ChipStylesSection } from './ChipStylesSection.js';
import { LabelStylesSection } from './LabelStylesSection.js';
import { MarkStylesSection } from './MarkStylesSection.js';
import { CodeStyleSection } from './CodeStyleSection.js';
import { ScoreStyleSection } from './ScoreStyleSection.js';
import { ScoreStylesSection } from './ScoreStylesSection.js';
import { DiagramStyleSection } from './DiagramStyleSection.js';
import { VideoStyleSection } from './VideoStyleSection.js';
import { ResourceTypesSection } from './ResourceTypesSection.js';
import { HtmlViewerSection } from './HtmlViewerSection.js';
import { CanvasViewerSection } from './CanvasViewerSection.js';
import { PdfGenerationSection } from './PdfGenerationSection.js';
import { PrintSection } from './PrintSection.js';
import { ContrastSection } from './ContrastSection.js';
import { ChecksSection } from './ChecksSection.js';
import { FolioSection } from './FolioSection.js';
import { DebugSection } from './DebugSection.js';
import { WarningsConfigSection } from './WarningsConfigSection.js';
import { ComicsPanelsSection } from './comics/ComicsPanelsSection.js';
import { ComicsPanelStylesSection } from './comics/ComicsPanelStylesSection.js';
import { ComicsLetteringSection } from './comics/ComicsLetteringSection.js';
import { ComicsBalloonStylesSection } from './comics/ComicsBalloonStylesSection.js';
import { ComicsCastSection } from './comics/ComicsCastSection.js';
import { PageTemplatesSection } from './PageTemplatesSection/index.js';
import { ModulesSection } from './ModulesSection/index.js';
import { FrameStylesSection } from './FrameStylesSection/index.js';
import { FrameLooksSection } from './FrameLooksSection.js';
import { ExerciseStylesSection } from './ExerciseStylesSection.js';
import { ExercisesSection } from './ExercisesSection.js';

/** Section id → component. Kept apart from the registry so the registry
 *  stays a pure data module. */
export const SECTION_COMPONENTS: Record<SettingsSectionId, ComponentType> = {
  'page': PageSection,
  'layout': LayoutSection,
  'writing': WritingSection,
  'color-palette': ColorPaletteSection,
  'headerFooter': HeaderFooterSection,
  'parts': PartsSection,
  'bodyText': BodyTextSection,
  'headings': HeadingsSection,
  'headingStyles': HeadingStylesSection,
  'toc': TocSection,
  'index': IndexSection,
  'paragraphStyles': ParagraphStylesSection,
  'unordered-lists': UnorderedListsSection,
  'ordered-lists': OrderedListsSection,
  'math': MathSection,
  'footnotes': FootnotesSection,
  'lineNumbers': LineNumbersSection,
  'crossRefs': CrossRefsSection,
  'citations': CitationsSection,
  'cjk': CjkSection,
  'resource-types': ResourceTypesSection,
  'captionStyle': CaptionStyleSection,
  'tableStyle': TableStyleSection,
  'tableStyles': TableStylesSection,
  'diagramStyle': DiagramStyleSection,
  'scoreStyle': ScoreStyleSection,
  'scoreStyles': ScoreStylesSection,
  'videoStyle': VideoStyleSection,
  'calloutStyles': CalloutStylesSection,
  'frameStyles': FrameStylesSection,
  'frameLooks': FrameLooksSection,
  'exerciseStyles': ExerciseStylesSection,
  'exercises': ExercisesSection,
  'chipStyles': ChipStylesSection,
  'markStyles': MarkStylesSection,
  'labelStyles': LabelStylesSection,
  'codeStyle': CodeStyleSection,
  'comicsPanels': ComicsPanelsSection,
  'comicsPanelStyles': ComicsPanelStylesSection,
  'comicsLettering': ComicsLetteringSection,
  'comicsBalloonStyles': ComicsBalloonStylesSection,
  'comicsCast': ComicsCastSection,
  'pageTemplates': PageTemplatesSection,
  'modules': ModulesSection,
  'htmlViewer': HtmlViewerSection,
  'canvasViewer': CanvasViewerSection,
  'folio': FolioSection,
  'pdfGeneration': PdfGenerationSection,
  'print': PrintSection,
  'contrast': ContrastSection,
  'checks': ChecksSection,
  'debug': DebugSection,
  'warnings': WarningsConfigSection,
};
