import type { WarningPayload } from './types';

/** The anchor a warning of a figure's labels leads to in the picture's
 *  anchor editor (#866, #902): a name still to place, or an anchor to
 *  show; none for a label placed by percentages. */
export function warningAnchor(payload: WarningPayload): { anchor: string; place: boolean } | undefined {
  switch (payload.kind) {
    case 'labelAnchorUnknown':
      return { anchor: payload.anchor, place: true };
    case 'anchorUnlabelled':
      return { anchor: payload.anchor, place: false };
    case 'labelOverflow':
    case 'labelOverlap':
      return payload.anchor !== undefined ? { anchor: payload.anchor, place: false } : undefined;
    default:
      return undefined;
  }
}
