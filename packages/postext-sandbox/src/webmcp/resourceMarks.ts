// The marks of a picture as a tool hands them over — its safe area, the
// speakers a comic's lettering points at, the zones and the faces no
// balloon covers — checked and stored the way the "Safe area & lettering"
// dialog stores them.

import { normalizeSafeArea, type Resource, type ResourceAnchor, type ResourceSafeArea } from 'postext';
import {
  anchorIdProblem,
  anchorOutsideSafeArea,
  applyMarks,
  firstAnchorIdProblem,
  marksOf,
  normalizeMarks,
  type PictureMarks,
} from '../panels/resources/pictureMarks';
import { ToolError, type JsonSchema } from './modelContext';

/** The `marks` parameter of the resource tool: each member replaces that
 *  kind of mark, `null` removes it, one left out stays as it is. */
export interface MarksInput {
  safeArea?: ResourceSafeArea | null;
  anchors?: ResourceAnchor[] | null;
  avoid?: ResourceSafeArea[] | null;
  faces?: ResourceSafeArea[] | null;
}

const RECT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
  required: ['x', 'y', 'width', 'height'],
  additionalProperties: false,
};
const POINT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
  additionalProperties: false,
};

export const MARKS_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'The marks drawn over a picture, in fractions of it (0 to 1 from its top left corner; a rectangle is { x, y, width, height }). Each member given replaces that kind of mark whole, null removes it, one left out stays.',
  properties: {
    safeArea: { ...RECT_SCHEMA, type: ['object', 'null'], description: 'The part of the picture that must stay in view: the layout may crop what lies outside it to fit the page. null: the picture always shows whole. For a bitmap, an SVG or a video\'s poster.' },
    anchors: {
      type: ['array', 'null'],
      description: 'The speakers of a comic panel\'s picture: id (the key the script names, as in "ana: Hello"), x and y of the mouth a speech balloon\'s tail points at, and optionally head (where a thought balloon points) and face (a rectangle no balloon covers).',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, head: POINT_SCHEMA, face: RECT_SCHEMA },
        required: ['id', 'x', 'y'],
        additionalProperties: false,
      },
    },
    avoid: { type: ['array', 'null'], description: 'Zones of a comic panel\'s picture the balloons keep clear of (a hand, a key object).', items: RECT_SCHEMA },
    faces: { type: ['array', 'null'], description: 'The faces of people in a comic panel\'s picture who do not speak: no balloon covers them.', items: RECT_SCHEMA },
  },
  additionalProperties: false,
};

const ID_PROBLEMS = {
  empty: 'is empty',
  invalid: 'is not a script key (letters, digits, "_", "." and "-" only)',
  reserved: 'is a key the script keeps for itself (caption, sfx, note)',
  duplicate: 'is the id of another speaker too',
} as const;

/** Whether the dialog would store `rect` (inside the picture, not a
 *  sliver). */
const storable = (rect: ResourceSafeArea): boolean => normalizeMarks({ anchors: [], avoid: [rect], faces: [] }).avoid.length === 1;

/**
 * `resource` carrying the marks `input` asks for, and what an author would
 * be told of them: the speakers a crop to the safe area may hide. Throws a
 * {@link ToolError} for marks the dialog would not save.
 */
export function withMarks(resource: Resource, input: MarksInput): { resource: Resource; notes: string[] } {
  const picture = resource.kind === 'bitmap' ? resource.bitmap?.fileId : resource.kind === 'svg' ? resource.svg?.fileId : undefined;
  const poster = resource.kind === 'video' ? resource.video?.poster?.fileId : undefined;
  if (!picture && !poster) {
    throw new ToolError(resource.kind === 'video'
      ? 'This video has no poster to mark a safe area on: give it one first (video.poster, video.posterTime, or the link of a YouTube or Vimeo video).'
      : `Marks are drawn over a picture; ${JSON.stringify(resource.id)} is a ${resource.kind}.`);
  }
  // A poster is cropped like a picture but never lettered.
  const lettering = (['anchors', 'avoid', 'faces'] as const).filter((k) => input[k] !== undefined && input[k] !== null && input[k]!.length > 0);
  if (!picture && lettering.length > 0) throw new ToolError(`A video's poster takes a safe area only, not ${lettering.join(', ')}: lettering marks are for the bitmap and SVG pictures of comic panels.`);

  const marks: PictureMarks = marksOf(resource);
  if (input.safeArea !== undefined) {
    if (input.safeArea !== null && !normalizeSafeArea(input.safeArea)) {
      throw new ToolError('marks.safeArea must be a rectangle inside the picture, in fractions of it (0 to 1), smaller than the whole picture and not a sliver. null removes the safe area.');
    }
    marks.safeArea = input.safeArea ?? undefined;
  }
  for (const key of ['avoid', 'faces'] as const) {
    const rects = input[key];
    if (rects === undefined) continue;
    const bad = (rects ?? []).findIndex((r) => !storable(r));
    if (bad >= 0) throw new ToolError(`marks.${key}[${bad}] is not a rectangle inside the picture: x, y, width and height are fractions of it (0 to 1), and it must reach into it.`);
    marks[key] = (rects ?? []).map((r) => ({ ...r }));
  }
  if (input.anchors !== undefined) {
    const anchors = (input.anchors ?? []).map((a) => ({ ...a, id: a.id.trim() }));
    const bad = firstAnchorIdProblem(anchors);
    if (bad >= 0) throw new ToolError(`marks.anchors[${bad}].id ${JSON.stringify(anchors[bad]!.id)} ${ID_PROBLEMS[anchorIdProblem(anchors, bad)!]}.`);
    const face = anchors.findIndex((a) => a.face && !storable(a.face));
    if (face >= 0) throw new ToolError(`marks.anchors[${face}].face is not a rectangle inside the picture: x, y, width and height are fractions of it (0 to 1).`);
    marks.anchors = anchors;
  }
  const next = applyMarks(resource, marks);
  const hidden = (next.anchors ?? []).filter((a) => anchorOutsideSafeArea(a, next.safeArea)).map((a) => a.id);
  return {
    resource: next,
    notes: hidden.length > 0 ? [`The mouth or the head of ${hidden.join(', ')} lies outside the safe area: a crop may hide it.`] : [],
  };
}
