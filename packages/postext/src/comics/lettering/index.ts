// Comics lettering (SPEC D3): engine-made balloons, captions and sound
// effects over one panel. Entry: `letterPanel`.

export { letterPanel, letterPanelDetailed } from './letter.js';
export { presetLetteringStyles, type PresetInputs } from './presets.js';
export { shapeText, shapeTextCandidates, ovalProfile, type ShapedText, type ShapeOptions } from './shape-text.js';
export { prepareText, readLetteringText, breakPoints, type PreparedText, type BreakPoint } from './text.js';
export { buildBody, buildTail, buildNeck, fitSuperellipse, type Body, type Tail } from './shapes.js';
export type {
  BalloonShapeKind, BalloonTailKind, ComicBalloonOut, LetteringAnchor, LetteringDiagnostic, LetteringEnv, LetteringItem,
  LetteringPanel, LetteringPosition, LetteringResult, LetteringStyle, LetteringText, PanelSide, Point, Rect,
} from './types.js';
