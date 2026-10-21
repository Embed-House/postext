'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Crop, Hand, MapPin, Maximize2, MessageCircle, Plus, Smile, Trash2, TriangleAlert, Type, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { LabelStyle, Resource, ResourceSafeArea } from 'postext';
import { safeAreaHeightRange, safeAreaSource } from 'postext';
import { useSandboxDispatch, useSandboxLabels, useSandboxSelector, useSandboxStore } from '../../context/SandboxContext';
import { applyViewerEdit } from '../../editor/viewerEdits';
import type { LabelLeaderChoice } from '../../editor/labelAttrs';
import { labelLeaderEdit } from './labelLeaderEdit';
import { NumberInput } from '../../controls';
import { FieldRow } from '../../controls/FieldRow';
import { Button, IconButton, SegmentedControl, Switch, usePortalContainer } from '../../ui';
import { POPUP_SURFACE, POPUP_Z_INDEX } from '../../ui/surface';
import { useBlobObjectUrl } from './ResourcePreview';
import { SvgSymbolsReader } from './SvgSymbolsReader';
import { addZones } from './svgSymbols';
import {
  HANDLES, INITIAL_SAFE_AREA, MIN_SIDE,
  addAnchor, addBystanderFace, addFace, addHead, anchorIdProblem, anchorOutsideSafeArea, applyDrag, clamp, firstAnchorIdProblem,
  labelFieldsOf, leaderDrawn, marksOf, normalizeMarks, nudge, removeMark, sameMarks, switchZone, withAnchor, withPoint, zoneAround,
  type AnchorIdProblem, type Handle, type MarkDrag, type MarkTarget, type PictureMarks, type Point, type ZoneTarget,
} from './pictureMarks';
import { anchorLabelState, labelsInChapters, type MarkdownLabel } from './figureLabels';
import { onAnchorEditorRequest, takeAnchorEditorRequest, type AnchorEditorRequest } from './anchorEditorRequest';
import { DENSE_ANCHORS, LabelAnchorsPanel, labelStyleColor } from './LabelAnchorsPanel';
import { MAX_STAGE_ZOOM, pinchZoom, scrollForFocus, STAGE_NAMES_ZOOM, touchPair, wheelZoom, zoomStep } from './stageZoom';

// ---------------------------------------------------------------------------
// Safe area & lettering marks of a picture. The field sums them up over a
// thumbnail; the dialog draws them over the picture in three modes:
// - Safe area (`Resource.safeArea`, #442): the rectangle that always shows
//   (drag to draw, move or resize; arrows and Shift+arrows on the focused
//   rectangle; numeric fields), with the tallest and the shortest crop the
//   layout may use;
// - Anchors (`Resource.anchors`, #866): the points a map's or a diagram's
//   `::label` lines stand at, each with a name, a label style and the label
//   fields (alignment, rotation, width); the names the text uses that the
//   picture lacks are placed by clicking (see LabelAnchorsPanel);
// - Speakers (`Resource.anchors`, #557/#569): the mouth each balloon tail
//   points at, named by the speaker id the comic's script uses, with an
//   optional head point (thought balloons) and face rectangle;
// - Avoid zones (`Resource.avoid`): rectangles no balloon covers, and, in
//   the same mode, the faces of the people who do not speak
//   (`Resource.faces`, #726): rectangles no balloon covers at any
//   fallback. A switch on each row moves a rectangle between the two.
// Every mark is a focusable target (arrow keys move it, Delete removes it)
// and every pointer target is at least 44 px on touch screens.
// ---------------------------------------------------------------------------

type Mode = 'safe' | 'labels' | 'speakers' | 'avoid';

const NO_LABEL_STYLES: LabelStyle[] = [];

const pct = (v: number) => Math.round(v * 1000) / 10;

/** One colour per speaker, cycled, so a mouth, its head and its face read
 *  as one person. */
const SPEAKER_COLORS = ['#f97316', '#22d3ee', '#facc15', '#a3e635', '#e879f9', '#60a5fa'];
const speakerColor = (i: number) => SPEAKER_COLORS[i % SPEAKER_COLORS.length]!;
const AVOID_COLOR = '#ef4444';
const AVOID_FILL = 'repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.32) 0 5px, rgba(239, 68, 68, 0.08) 5px 10px)';
/** A bystander's face is drawn as a speaker's face is (a tinted box, no
 *  hatching), in a colour no speaker takes. */
const BYSTANDER_COLOR = '#a78bfa';

/** The picture's intrinsic size, from the resource or, failing that, the
 *  loaded image. */
function intrinsicOf(resource: Resource): { width: number; height: number } | undefined {
  if (resource.kind === 'bitmap' && resource.bitmap && resource.bitmap.width > 0 && resource.bitmap.height > 0) {
    return { width: resource.bitmap.width, height: resource.bitmap.height };
  }
  if (resource.kind === 'svg' && resource.svg?.width && resource.svg.height) {
    return { width: resource.svg.width, height: resource.svg.height };
  }
  const poster = resource.kind === 'video' ? resource.video?.poster : undefined;
  if (poster && poster.width > 0 && poster.height > 0) return { width: poster.width, height: poster.height };
  return undefined;
}

/** `object-fit` showing `source` of a picture in a box of the same ratio
 *  (as the HTML backend sets a cropped picture). */
function croppedStyle(source: ResourceSafeArea | undefined): CSSProperties {
  if (!source) return { objectFit: 'fill' };
  const x = source.width < 1 ? (source.x / (1 - source.width)) * 100 : 0;
  const y = source.height < 1 ? (source.y / (1 - source.height)) * 100 : 0;
  return { objectFit: 'cover', objectPosition: `${x}% ${y}%` };
}

/** The rectangle `r` of the shown picture, in % of its box. */
function boxStyle(r: ResourceSafeArea): CSSProperties {
  return { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` };
}

const targetKey = (t: MarkTarget) => (t.kind === 'safe' ? 'safe' : `${t.kind}-${t.index}`);

/** Lettering marks only mean something on a picture (a video poster is
 *  cropped like one but never lettered). */
const lettered = (resource: Resource) => resource.kind === 'bitmap' || resource.kind === 'svg';

interface SafeAreaFieldProps {
  resource: Resource;
  /** The new marks (safe area, speakers, avoid zones), normalised. */
  onChange: (marks: PictureMarks) => void;
}

/** The "Safe area & lettering" field of a bitmap or SVG resource, or the
 *  "Safe area" field of a video's poster (the engine crops a poster like a
 *  picture). */
export function SafeAreaField({ resource, onChange }: SafeAreaFieldProps) {
  const labels = useSandboxLabels();
  const fileId = resource.kind === 'bitmap'
    ? resource.bitmap?.fileId
    : resource.kind === 'video' ? resource.video?.poster?.fileId : resource.svg?.fileId;
  const url = useBlobObjectUrl(fileId);
  const marks = marksOf(resource);
  const area = marks.safeArea;
  const withLettering = lettered(resource);
  const [openIn, setOpenIn] = useState<Mode | null>(null);
  const [request, setRequest] = useState<AnchorEditorRequest | null>(null);
  const uiLocale = useSandboxSelector((s) => s.locale);
  const labelStyles = useSandboxSelector((s) => s.config?.labelStyles) ?? NO_LABEL_STYLES;
  // The book's labels of this picture (#866), the chapter on screen as typed.
  const chapters = useSandboxSelector((s) => s.chapters);
  const activeChapterId = useSandboxSelector((s) => s.activeChapterId);
  const liveMarkdown = useSandboxSelector((s) => s.markdown);
  const figureLabels = useMemo(
    () => (withLettering ? labelsInChapters((chapters ?? []).map((c) => ({ id: c.id, markdown: c.id === activeChapterId ? liveMarkdown : c.markdown })), resource.id) : []),
    [withLettering, chapters, activeChapterId, liveMarkdown, resource.id],
  );
  const labelState = useMemo(() => anchorLabelState(marks.anchors, figureLabels), [marks.anchors, figureLabels]);
  // A warning or a label on a page asks for this picture's anchors.
  useEffect(() => {
    const take = () => {
      // Taken once the picture is there to show (its blob URL may come a
      // moment after the field).
      if (!url || !withLettering) return;
      const r = takeAnchorEditorRequest(resource.id);
      if (!r) return;
      setRequest(r);
      setOpenIn('labels');
    };
    take();
    return onAnchorEditorRequest(take);
  }, [resource.id, url, withLettering]);
  const share = (v: number) => new Intl.NumberFormat(uiLocale, { maximumFractionDigits: 1 }).format(pct(v));
  const count = (n: number) => new Intl.NumberFormat(uiLocale).format(n);

  return (
    <FieldRow
      stacked
      label={withLettering ? labels.resourceMarksLabel : labels.resourceSafeAreaLabel}
      hint={withLettering ? labels.resourceMarksHint : labels.resourceSafeAreaHint}
      className="mb-0"
    >
      <div className="flex w-full min-w-0 flex-col gap-2">
        {url && (
          <div className="relative inline-block self-start overflow-hidden rounded" style={{ maxWidth: '100%' }}>
            <img src={url} alt="" className="block" style={{ maxWidth: '100%', maxHeight: 140 }} />
            {area && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute"
                style={{ ...boxStyle(area), boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)', outline: '2px solid var(--brand)' }}
              />
            )}
            {withLettering && <ThumbnailMarks marks={marks} labelStyles={labelStyles} />}
          </div>
        )}
        <span className="text-xs text-(--slate)">
          {area
            ? labels.resourceSafeAreaSummary.replace('__w__', share(area.width)).replace('__h__', share(area.height))
            : labels.resourceSafeAreaNone}
        </span>
        {withLettering && figureLabels.length > 0 && (
          <span className="text-xs text-(--slate)">
            {labels.resourceLabelAnchorsSummary
              .replace('__anchors__', count(marks.anchors.length))
              .replace('__waiting__', count(labelState.waiting.length))}
          </span>
        )}
        {withLettering && figureLabels.length === 0 && (marks.anchors.length > 0 || marks.avoid.length > 0 || marks.faces.length > 0) && (
          <span className="text-xs text-(--slate)">
            {labels.resourceMarksSummary
              .replace('__speakers__', count(marks.anchors.length))
              .replace('__zones__', count(marks.avoid.length))
              .replace('__faces__', count(marks.faces.length))}
          </span>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" icon={<Crop size={13} aria-hidden="true" />} disabled={!url} onClick={() => setOpenIn('safe')}>
            {area ? labels.resourceSafeAreaEdit : labels.resourceSafeAreaMark}
          </Button>
          {withLettering && (
            <Button size="sm" icon={<MapPin size={13} aria-hidden="true" />} disabled={!url} onClick={() => { setRequest(null); setOpenIn('labels'); }}>
              {labels.resourceLabelAnchorsEdit}
            </Button>
          )}
          {withLettering && (
            <Button size="sm" icon={<MessageCircle size={13} aria-hidden="true" />} disabled={!url} onClick={() => setOpenIn('speakers')}>
              {labels.resourceMarksEditLettering}
            </Button>
          )}
          {area && (
            <Button size="sm" variant="ghost" onClick={() => onChange(normalizeMarks({ ...marks, safeArea: undefined }))}>
              {labels.resourceSafeAreaRemove}
            </Button>
          )}
        </div>
      </div>
      {url && (
        <PictureMarksDialog
          open={openIn !== null}
          initialMode={openIn ?? 'safe'}
          url={url}
          resource={resource}
          withLettering={withLettering}
          labelStyles={labelStyles}
          figureLabels={figureLabels}
          request={request}
          onClose={() => setOpenIn(null)}
          onSave={(next) => {
            onChange(normalizeMarks(next));
            setOpenIn(null);
          }}
        />
      )}
    </FieldRow>
  );
}

/** Speakers (a dot at each mouth), avoid zones and bystanders' faces over
 *  the field's thumbnail, subtly: the dialog is where they are read and
 *  edited. */
function ThumbnailMarks({ marks, labelStyles }: { marks: PictureMarks; labelStyles: readonly LabelStyle[] }) {
  if (!marks.anchors.length && !marks.avoid.length && !marks.faces.length) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {marks.avoid.map((r, i) => (
        <div key={`a${i}`} className="absolute" style={{ ...boxStyle(r), border: `1px solid ${AVOID_COLOR}`, background: 'rgba(239, 68, 68, 0.18)' }} />
      ))}
      {marks.faces.map((r, i) => (
        <div key={`f${i}`} className="absolute" style={{ ...boxStyle(r), border: `1px solid ${BYSTANDER_COLOR}`, background: `${BYSTANDER_COLOR}2e` }} />
      ))}
      {marks.anchors.map((a, i) => (
        <span
          key={`s${i}`}
          className="absolute rounded-full"
          style={{
            left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: 7, height: 7, transform: 'translate(-50%, -50%)',
            background: a.style !== undefined ? labelStyleColor(a.style, labelStyles) : speakerColor(i), boxShadow: '0 0 0 1.5px #fff, 0 0 0 2.5px rgba(0, 0, 0, 0.5)',
          }}
        />
      ))}
    </div>
  );
}

interface PictureMarksDialogProps {
  open: boolean;
  initialMode: Mode;
  url: string;
  resource: Resource;
  withLettering: boolean;
  labelStyles: readonly LabelStyle[];
  /** The book's `::label` lines of this picture (#866). */
  figureLabels: readonly MarkdownLabel[];
  /** What opened the Anchors mode from elsewhere: an anchor to pick, a
   *  name to place. */
  request: AnchorEditorRequest | null;
  onClose: () => void;
  onSave: (marks: PictureMarks) => void;
}

function PictureMarksDialog({ open, initialMode, url, resource, withLettering, labelStyles, figureLabels, request, onClose, onSave }: PictureMarksDialogProps) {
  const labels = useSandboxLabels();
  const store = useSandboxStore();
  const dispatch = useSandboxDispatch();
  /** A label's own `leader` attribute written into its chapter (#1064):
   *  the text's, so it is not part of the dialog's marks nor of its Undo. */
  const setLabelLeader = (label: MarkdownLabel, choice: LabelLeaderChoice) => {
    const s = store.getSnapshot();
    const edit = labelLeaderEdit({ chapters: s.chapters, activeChapterId: s.activeChapterId, markdown: s.markdown }, label, choice);
    if (edit) applyViewerEdit(dispatch, edit.chapterId, [edit.change], edit.baseLength);
  };
  const styleHasLeader = (id: string | undefined) => !!id && labelStyles.some((st) => st.id === id && st.leader !== undefined);
  const container = usePortalContainer();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [marks, setMarksState] = useState<PictureMarks>(() => marksOf(resource));
  const marksRef = useRef(marks);
  const [past, setPast] = useState<PictureMarks[]>([]);
  const [selAnchor, setSelAnchor] = useState<number | null>(null);
  /** The avoid zone or the bystander's face the Avoid zones mode acts on. */
  const [selZone, setSelZone] = useState<ZoneTarget | null>(null);
  const zoneSelected = (t: ZoneTarget) => selZone?.kind === t.kind && selZone.index === t.index;
  const [showIdErrors, setShowIdErrors] = useState(false);
  /** The name the text uses that the next click on the picture places
   *  (Anchors mode). */
  const [placing, setPlacing] = useState<string | null>(null);
  /** The anchors ticked to change their label fields together (#931), the
   *  point the pointer is over, and whether a dense map names every point
   *  (unset: only the points in hand). */
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => new Set());
  const [hoverAnchor, setHoverAnchor] = useState<number | null>(null);
  const [namesOnDense, setNamesOnDense] = useState(false);
  const placingRef = useRef<string | null>(null);
  placingRef.current = placing;
  /** The zoom of the picture (1 = the picture fits), the hand tool, and the
   *  scroll a zoom step keeps under its focus (#956). */
  const [zoom, setZoom] = useState(1);
  const [hand, setHand] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const zoomFocus = useRef<{ fx: number; fy: number; ox: number; oy: number } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  /** The fingers on the stage, and the pinch two of them make (#970): the
   *  zoom and distance when the second went down and the point of the
   *  picture between them, as fractions of its extent. */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ zoom: number; distance: number; fx: number; fy: number; last: number; ox: number; oy: number } | null>(null);
  const pinchFrame = useRef(0);
  /** The name being placed when the press that a second finger took back
   *  went down. */
  const placingAtDown = useRef<string | null>(null);
  const labelState = useMemo(() => anchorLabelState(marks.anchors, figureLabels), [marks.anchors, figureLabels]);
  const [loaded, setLoaded] = useState<{ width: number; height: number } | undefined>(undefined);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<(MarkDrag & { before: PictureMarks; client: Point; moved: boolean; created?: 'anchor' | 'placed' | 'avoid' | 'label' }) | null>(null);
  const lastNudge = useRef<{ key: string; at: number } | null>(null);
  const markEls = useRef(new Map<string, HTMLElement>());
  const idInputs = useRef(new Map<number, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const zoneSwitches = useRef(new Map<string, HTMLElement>());
  const focusNext = useRef<(() => void) | null>(null);

  const setMarks = (next: PictureMarks) => {
    marksRef.current = next;
    setMarksState(next);
  };
  /** Remember `before` for Undo when it differs from the current marks. */
  const record = (before: PictureMarks) => {
    setPast((p) => (p.length && sameMarks(p[p.length - 1]!, before) ? p : [...p.slice(-49), before]));
  };
  /** Replace the marks, undoably. */
  const commit = (next: PictureMarks) => {
    record(marksRef.current);
    setMarks(next);
  };
  const undo = () => {
    if (!past.length) return;
    setMarks(past[past.length - 1]!);
    setPast(past.slice(0, -1));
  };
  /** Typing an id is one step of Undo, recorded at its first change. */
  const idEdit = useRef<{ index: number; before: PictureMarks; recorded: boolean } | null>(null);

  // Each opening starts from the saved marks, in the mode the field asked
  // for. "Mark safe area" opens with a proposal, as the field always did.
  useEffect(() => {
    if (!open) return;
    const saved = marksOf(resource);
    const start = initialMode === 'safe' && !saved.safeArea ? { ...saved, safeArea: INITIAL_SAFE_AREA } : saved;
    setMarks(start);
    setMode(withLettering ? initialMode : 'safe');
    setPast([]);
    const asked = request?.anchor !== undefined ? saved.anchors.findIndex((a) => a.id === request.anchor) : -1;
    setSelAnchor(asked >= 0 ? asked : saved.anchors.length && initialMode !== 'labels' ? 0 : null);
    setSelZone(null);
    setTicked(new Set());
    setNamesOnDense(false);
    setZoom(1);
    setHand(false);
    setShowIdErrors(false);
    // The Anchors mode starts placing the name asked for, else the first
    // name the text uses that the picture lacks: each click places one.
    const waiting = anchorLabelState(saved.anchors, figureLabels).waiting;
    setPlacing(initialMode !== 'labels' ? null : request?.place && waiting.includes(request.place) ? request.place : request?.anchor !== undefined ? null : (waiting[0] ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus requests made while changing the marks run once React drew them.
  useEffect(() => {
    const f = focusNext.current;
    if (!f) return;
    focusNext.current = null;
    requestAnimationFrame(f);
  });

  // Indices shift when an anchor is added or taken away: the ticks start over.
  const anchorCount = marks.anchors.length;
  useEffect(() => {
    setTicked((t) => (t.size === 0 ? t : new Set()));
  }, [anchorCount]);
  const tick = (indices: readonly number[], on: boolean) => {
    setTicked((t) => {
      const next = new Set(t);
      for (const i of indices) {
        if (on) next.add(i);
        else next.delete(i);
      }
      return next;
    });
  };
  const denseMap = marks.anchors.length > DENSE_ANCHORS;

  /** Zoom to `next`, keeping the point of the viewport at (`cx`, `cy`)
   *  (client pixels; the middle of it by default) under its place. */
  const zoomTo = (next: number, cx?: number, cy?: number) => {
    const v = viewportRef.current;
    const z = clamp(next, 1, MAX_STAGE_ZOOM);
    if (!v || z === zoom) return;
    const box = v.getBoundingClientRect();
    const ox = (cx ?? box.left + box.width / 2) - box.left;
    const oy = (cy ?? box.top + box.height / 2) - box.top;
    zoomFocus.current = { fx: (v.scrollLeft + ox) / Math.max(1, v.scrollWidth), fy: (v.scrollTop + oy) / Math.max(1, v.scrollHeight), ox, oy };
    setZoom(z);
  };
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  const zoomValue = useRef(zoom);
  zoomValue.current = zoom;
  // The scroll that keeps the focus of a zoom step where it was.
  useLayoutEffect(() => {
    const f = zoomFocus.current;
    const v = viewportRef.current;
    zoomFocus.current = null;
    if (!f || !v) return;
    v.scrollLeft = f.fx * v.scrollWidth - f.ox;
    v.scrollTop = f.fy * v.scrollHeight - f.oy;
  }, [zoom]);
  // Ctrl-scroll and a pinch zoom about the pointer (a plain scroll moves
  // the picture when it is zoomed, natively). A native listener, attached
  // when the viewport mounts: React's wheel handlers cannot cancel the
  // page's own zoom.
  const wheelOff = useRef<(() => void) | null>(null);
  const setViewport = useCallback((el: HTMLDivElement | null) => {
    wheelOff.current?.();
    wheelOff.current = null;
    viewportRef.current = el;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomRef.current(zoomValue.current * wheelZoom(e.deltaY), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    wheelOff.current = () => el.removeEventListener('wheel', onWheel);
  }, []);
  const panning = hand || spaceDown;

  const intrinsic = intrinsicOf(resource) ?? loaded;
  const area = marks.safeArea;

  const pointAt = (e: { clientX: number; clientY: number }): Point => {
    const box = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
  };

  /** The mark under the pointer that the current mode edits. */
  const markAt = (el: HTMLElement): { target: MarkTarget; handle: Handle } | null => {
    const host = el.closest<HTMLElement>('[data-mark]');
    if (!host) return null;
    const kind = host.dataset.mark as MarkTarget['kind'];
    const editable = mode === 'safe' ? kind === 'safe'
      : mode === 'labels' ? kind === 'mouth' || kind === 'label'
        : mode === 'speakers' ? kind === 'mouth' || kind === 'head' || kind === 'face'
          : kind === 'avoid' || kind === 'bystander';
    if (!editable) return null;
    const handle = (el.closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle | undefined) ?? 'move';
    const target = kind === 'safe' ? { kind } : { kind, index: Number(host.dataset.index) };
    return { target: target as MarkTarget, handle };
  };

  const select = (t: MarkTarget) => {
    if (t.kind === 'mouth' || t.kind === 'head' || t.kind === 'face' || t.kind === 'label') setSelAnchor(t.index);
    if (t.kind === 'avoid' || t.kind === 'bystander') setSelZone(t);
  };

  /** Two fingers went down (#970): they move and zoom the picture, and
   *  the press the first one made on the marks is taken back. */
  const startPinch = (e: PointerEvent<HTMLDivElement>) => {
    const v = viewportRef.current;
    const [a, b] = [...touches.current.values()];
    if (!v || !a || !b) return;
    const d = drag.current;
    drag.current = null;
    pan.current = null;
    if (d) {
      setMarks(d.before);
      setPlacing(placingAtDown.current);
    }
    const pair = touchPair(a, b);
    const box = v.getBoundingClientRect();
    pinch.current = {
      zoom: zoomValue.current,
      distance: pair.distance,
      fx: (v.scrollLeft + pair.cx - box.left) / Math.max(1, v.scrollWidth),
      fy: (v.scrollTop + pair.cy - box.top) / Math.max(1, v.scrollHeight),
      last: zoomValue.current,
      ox: pair.cx - box.left,
      oy: pair.cy - box.top,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    e.preventDefault();
  };
  /** The fingers moved: zoom as far apart as they are, and keep the point
   *  between them under them. The work is done once a frame, from where the
   *  fingers are then: moves come faster than renders. */
  const movePinch = () => {
    const g = pinch.current;
    const v = viewportRef.current;
    const [a, b] = [...touches.current.values()];
    if (!g || !v || !a || !b) return;
    const pair = touchPair(a, b);
    const box = v.getBoundingClientRect();
    g.last = pinchZoom(g.zoom, g.distance, pair.distance);
    g.ox = pair.cx - box.left;
    g.oy = pair.cy - box.top;
    if (pinchFrame.current) return;
    pinchFrame.current = requestAnimationFrame(() => {
      pinchFrame.current = 0;
      const now = pinch.current;
      const el = viewportRef.current;
      if (!now || !el) return;
      if (now.last !== zoomValue.current) {
        // The scroll that keeps the point under the fingers follows the
        // new size (`zoomFocus`).
        zoomFocus.current = { fx: now.fx, fy: now.fy, ox: now.ox, oy: now.oy };
        setZoom(now.last);
        return;
      }
      const at = scrollForFocus(now.fx, now.fy, now.ox, now.oy, { width: el.scrollWidth, height: el.scrollHeight });
      el.scrollLeft = at.left;
      el.scrollTop = at.top;
    });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        startPinch(e);
        return;
      }
      // A third finger is nobody's.
      if (touches.current.size > 2) {
        e.preventDefault();
        return;
      }
    }
    placingAtDown.current = placingRef.current;
    // The hand tool, Space held down or the middle button move the zoomed
    // picture instead of the marks (#956).
    const v = viewportRef.current;
    if (v && (e.button === 1 || (e.button === 0 && panning))) {
      pan.current = { x: e.clientX, y: e.clientY, left: v.scrollLeft, top: v.scrollTop };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const p = pointAt(e);
    const before = marksRef.current;
    // While a name is being placed, a click places it even on a point (the
    // names of a dense map stand close together); with none, a point under
    // the pointer is grabbed.
    const hit = mode === 'labels' && placingRef.current ? null : markAt(e.target as HTMLElement);
    const base = { before, client: { x: e.clientX, y: e.clientY }, moved: false, origin: p };
    // Shift- or Ctrl-click on a point ticks it for a change of several at
    // once (#931) and does not move it.
    if (mode === 'labels' && hit && hit.target.kind === 'mouth' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      const index = hit.target.index;
      tick([index], !ticked.has(index));
      setSelAnchor(index);
      e.preventDefault();
      return;
    }
    if (hit && hit.target.kind === 'label' && !before.anchors[hit.target.index]?.labelAt) {
      // The grip of a label still at its point (#1064): the label follows
      // the pointer from here, away from its point.
      select(hit.target);
      const start = withPoint(before, hit.target, p);
      drag.current = { ...base, ...hit, start, created: 'label' };
    } else if (hit) {
      select(hit.target);
      drag.current = { ...base, ...hit, start: before };
    } else if (mode === 'safe') {
      // Outside the rectangle: draw a new one from here (its far corner
      // follows the pointer).
      const from = { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1), width: 0, height: 0 };
      drag.current = { ...base, target: { kind: 'safe' }, handle: 'se', start: before, from };
      setMarks(applyDrag(drag.current, { x: p.x + MIN_SIDE, y: p.y + MIN_SIDE }));
    } else if (mode === 'speakers') {
      // On the picture: a new speaker, its mouth here (dragging moves it).
      const start = addAnchor(before, p);
      const index = start.anchors.length - 1;
      setSelAnchor(index);
      setMarks(start);
      drag.current = { ...base, target: { kind: 'mouth', index }, handle: 'move', start, created: 'anchor' };
    } else if (mode === 'labels') {
      // On the picture: a new anchor here, named by the name being placed
      // (else `anchorN`, to type), with the label fields of the anchor
      // picked before it, so a row of towns takes one style.
      const name = placingRef.current;
      const fields = labelFieldsOf(selAnchor !== null ? before.anchors[selAnchor] : undefined);
      const start = addAnchor(before, p, { ...(name && !before.anchors.some((a) => a.id === name) ? { id: name } : { prefix: 'anchor' }), fields });
      const index = start.anchors.length - 1;
      setSelAnchor(index);
      setMarks(start);
      drag.current = { ...base, target: { kind: 'mouth', index }, handle: 'move', start, created: name ? 'placed' : 'anchor' };
      if (name) {
        // On to the next name the text uses that the picture lacks.
        const waiting = anchorLabelState(start.anchors, figureLabels).waiting;
        const after = labelState.waiting.indexOf(name);
        const next = labelState.waiting.slice(after + 1).find((n) => waiting.includes(n)) ?? waiting[0] ?? null;
        setPlacing(next);
      }
    } else {
      // A new avoid zone, drawn from here.
      const index = before.avoid.length;
      const from = { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1), width: 0, height: 0 };
      const start = { ...before, avoid: [...before.avoid, from] };
      setSelZone({ kind: 'avoid', index });
      drag.current = { ...base, target: { kind: 'avoid', index }, handle: 'se', start, from, created: 'avoid' };
      setMarks(applyDrag(drag.current, { x: p.x + MIN_SIDE, y: p.y + MIN_SIDE }));
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current) {
        movePinch();
        return;
      }
    }
    const g = pan.current;
    const v = viewportRef.current;
    if (g && v) {
      v.scrollLeft = g.left - (e.clientX - g.x);
      v.scrollTop = g.top - (e.clientY - g.y);
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.client.x, e.clientY - d.client.y) < 3) return;
    d.moved = true;
    setMarks(applyDrag(d, pointAt(e)));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (touches.current.delete(e.pointerId) && touches.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    pan.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.created === 'avoid' && !d.moved && d.target.kind === 'avoid') {
      // A plain click: a zone of a usable size around the point.
      const index = d.target.index;
      const zone = zoneAround(d.origin);
      setMarks({ ...marksRef.current, avoid: marksRef.current.avoid.map((r, i) => (i === index ? zone : r)) });
    }
    if (d.created === 'label' && !d.moved) {
      // A press on a label's grip without a drag leaves it at its point and
      // gives it the keyboard (the arrows set it away).
      setMarks(d.before);
      markEls.current.get(targetKey(d.target))?.focus({ preventScroll: true });
      return;
    }
    if (!sameMarks(d.before, marksRef.current)) record(d.before);
    if (d.created === 'anchor' && d.target.kind === 'mouth') {
      // Type the speaker id right away.
      const index = d.target.index;
      focusNext.current = () => {
        const input = idInputs.current.get(index);
        input?.focus();
        input?.select();
      };
      setMarksState({ ...marksRef.current });
    } else if (!d.created && e.pointerType !== 'mouse') {
      // Keep the keyboard where the finger left it.
      markEls.current.get(targetKey(d.target))?.focus({ preventScroll: true });
    }
  };

  /** Arrows nudge the focused mark (Shift: resize a rectangle, or a larger
   *  step for a point); Delete or Backspace removes it. */
  const onMarkKeyDown = (target: MarkTarget) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (target.kind === 'safe') return;
      e.preventDefault();
      commit(removeMark(marksRef.current, target));
      if (target.kind === 'mouth') setSelAnchor(null);
      if (target.kind === 'label') setSelAnchor(target.index);
      if (target.kind === 'avoid' || target.kind === 'bystander') setSelZone(null);
      focusNext.current = () =>
        target.kind === 'head' || target.kind === 'face' || target.kind === 'label'
          ? markEls.current.get(targetKey({ kind: 'mouth', index: target.index }))?.focus()
          : addButton.current?.focus();
      setMarksState({ ...marksRef.current });
      return;
    }
    const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    // A run of nudges on one mark is one step of Undo.
    const key = targetKey(target);
    const now = Date.now();
    if (!lastNudge.current || lastNudge.current.key !== key || now - lastNudge.current.at > 1000) record(marksRef.current);
    lastNudge.current = { key, at: now };
    setMarks(nudge(marksRef.current, target, dx, dy, e.shiftKey));
  };

  /** Edit one side of the safe area numerically (in %). */
  const setField = (key: keyof ResourceSafeArea, value: number) => {
    const r = marksRef.current.safeArea;
    if (!r) return;
    const v = clamp(value / 100, 0, 1);
    const next = key === 'x' ? { ...r, x: Math.min(v, 1 - r.width) }
      : key === 'y' ? { ...r, y: Math.min(v, 1 - r.height) }
        : key === 'width' ? { ...r, width: clamp(v, MIN_SIDE, 1 - r.x) }
          : { ...r, height: clamp(v, MIN_SIDE, 1 - r.y) };
    commit({ ...marksRef.current, safeArea: next });
  };

  const addSpeakerAtCentre = () => {
    const next = addAnchor(marksRef.current, { x: 0.5, y: 0.5 });
    const index = next.anchors.length - 1;
    commit(next);
    setSelAnchor(index);
    focusNext.current = () => {
      idInputs.current.get(index)?.focus();
      idInputs.current.get(index)?.select();
    };
  };
  /** Anchors mode: a new anchor in the middle of the picture (or the name
   *  being placed), its name to type. */
  const addLabelAnchorAtCentre = () => {
    const before = marksRef.current;
    const name = placingRef.current;
    const fields = labelFieldsOf(selAnchor !== null ? before.anchors[selAnchor] : undefined);
    const next = addAnchor(before, { x: 0.5, y: 0.5 }, { ...(name && !before.anchors.some((a) => a.id === name) ? { id: name } : { prefix: 'anchor' }), fields });
    const index = next.anchors.length - 1;
    commit(next);
    setSelAnchor(index);
    if (name) setPlacing(anchorLabelState(next.anchors, figureLabels).waiting[0] ?? null);
    focusNext.current = () => {
      idInputs.current.get(index)?.focus();
      idInputs.current.get(index)?.select();
    };
  };
  /** Anchors mode: the anchor `index` taken away. */
  const removeLabelAnchor = (index: number) => {
    commit(removeMark(marksRef.current, { kind: 'mouth', index }));
    setSelAnchor(null);
    focusNext.current = () => addButton.current?.focus();
  };
  /** Anchors mode: a text field's edit, one step of Undo from its first
   *  change. */
  const beginAnchorEdit = (index: number) => {
    if (idEdit.current?.index === index && !idEdit.current.recorded) return;
    idEdit.current = { index, before: marksRef.current, recorded: false };
  };
  const anchorEdit = (next: PictureMarks) => {
    const edit = idEdit.current;
    if (edit && !edit.recorded) {
      record(edit.before);
      edit.recorded = true;
    }
    setMarks(next);
  };
  const addAvoidAtCentre = () => {
    const next = { ...marksRef.current, avoid: [...marksRef.current.avoid, zoneAround({ x: 0.5, y: 0.5 }, 0.2)] };
    const index = next.avoid.length - 1;
    commit(next);
    setSelZone({ kind: 'avoid', index });
    focusNext.current = () => markEls.current.get(targetKey({ kind: 'avoid', index }))?.focus();
  };
  const addBystanderAtCentre = () => {
    const next = addBystanderFace(marksRef.current, { x: 0.5, y: 0.5 });
    const target: ZoneTarget = { kind: 'bystander', index: next.faces.length - 1 };
    commit(next);
    setSelZone(target);
    focusNext.current = () => markEls.current.get(targetKey(target))?.focus();
  };
  /** Move a rectangle to the other list (zone ⇄ bystander's face) and keep
   *  the keyboard on its switch. */
  const switchKind = (target: ZoneTarget) => {
    const moved = switchZone(marksRef.current, target);
    commit(moved.marks);
    setSelZone(moved.target);
    focusNext.current = () => zoneSwitches.current.get(targetKey(moved.target))?.focus();
  };

  const save = () => {
    const bad = firstAnchorIdProblem(marksRef.current.anchors);
    if (bad >= 0) {
      setShowIdErrors(true);
      setMode(mode === 'labels' ? 'labels' : 'speakers');
      setSelAnchor(bad);
      focusNext.current = () => idInputs.current.get(bad)?.focus();
      setMarksState({ ...marksRef.current });
      return;
    }
    onSave(marksRef.current);
  };

  // The extreme crops, at a preview width: the tallest keeps the whole
  // height (sides cut to the safe area), the shortest the whole width.
  const PREVIEW_W = 96;
  const PREVIEW_MAX_H = 150;
  const previews = intrinsic && area
    ? (() => {
        const range = safeAreaHeightRange(intrinsic.width, intrinsic.height, area, PREVIEW_W);
        return ([
          [labels.resourceSafeAreaTallest, range.max],
          [labels.resourceSafeAreaShortest, range.min],
        ] as const).map(([label, h]) => {
          const k = Math.min(1, PREVIEW_MAX_H / h);
          return {
            label,
            width: PREVIEW_W * k,
            height: h * k,
            style: croppedStyle(safeAreaSource(intrinsic.width, intrinsic.height, area, PREVIEW_W, h)),
          };
        });
      })()
    : [];

  const help = mode === 'safe' ? labels.resourceSafeAreaDialogHelp
    : mode === 'labels' ? labels.resourceLabelAnchorsHelp
      : mode === 'speakers' ? labels.resourceAnchorsHelp
        : labels.resourceAvoidHelp;
  const idMessage = (problem: AnchorIdProblem, id: string) =>
    problem === 'empty' ? labels.resourceAnchorIdEmpty
      : problem === 'invalid' ? labels.resourceAnchorIdInvalid
        : problem === 'reserved' ? labels.resourceAnchorIdReserved.replace('__id__', id)
          : labels.resourceAnchorIdDuplicate;
  const nameOf = (i: number) => marks.anchors[i]?.id || String(i + 1);
  const register = (key: string) => (el: HTMLElement | null) => {
    if (el) markEls.current.set(key, el);
    else markEls.current.delete(key);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="fixed inset-0" style={{ zIndex: POPUP_Z_INDEX, backgroundColor: 'rgba(0, 0, 0, 0.4)' }} />
        <Dialog.Popup
          data-postext-popup=""
          data-testid="picture-marks-dialog"
          className="fixed left-1/2 top-1/2 flex max-h-[calc(100dvh-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto"
          style={{ ...POPUP_SURFACE, zIndex: POPUP_Z_INDEX, width: mode === 'labels' ? 'min(1240px, calc(100vw - 32px))' : 'min(920px, calc(100vw - 32px))',
            // The Anchors mode's list grows with every click: a fixed height
            // keeps the picture where the pointer is (a centred dialog would
            // move up as it grows).
            ...(mode === 'labels' ? { height: 'min(900px, calc(100dvh - 32px))' } : {}), padding: 16, fontSize: 13, lineHeight: '19px' }}
          onKeyDown={(e) => {
            // Undo inside the dialog; a text box keeps its own.
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) {
              e.preventDefault();
              undo();
              return;
            }
            // Zoom (+, -, 0) and Space for the hand, outside the controls
            // that use those keys themselves (#956).
            const t = e.target;
            const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
            if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === '+' || e.key === '=') {
              e.preventDefault();
              zoomTo(zoomStep(zoom, 1));
            } else if (e.key === '-' || e.key === '_') {
              e.preventDefault();
              zoomTo(zoomStep(zoom, -1));
            } else if (e.key === '0') {
              e.preventDefault();
              zoomTo(1);
            } else if (e.key === ' ' && !(t instanceof HTMLButtonElement)) {
              e.preventDefault();
              setSpaceDown(true);
            }
          }}
          onKeyUp={(e) => { if (e.key === ' ') setSpaceDown(false); }}
          onBlur={() => setSpaceDown(false)}
        >
          <div className="flex items-start justify-between gap-2">
            <Dialog.Title style={{ fontSize: 15, lineHeight: '20px', fontWeight: 600, margin: 0 }}>
              {withLettering ? labels.resourceMarksLabel : labels.resourceSafeAreaLabel}
            </Dialog.Title>
            <IconButton label={labels.resourceSafeAreaCancel} icon={<X size={14} aria-hidden="true" />} onClick={onClose} />
          </div>
          {withLettering && (
            <SegmentedControl<Mode>
              value={mode}
              onValueChange={setMode}
              ariaLabel={labels.resourceMarksModeAria}
              options={[
                { value: 'safe', label: labels.resourceSafeAreaLabel },
                { value: 'labels', label: labels.resourceMarksModeAnchors },
                { value: 'speakers', label: labels.resourceMarksModeSpeakers },
                { value: 'avoid', label: labels.resourceMarksModeAvoid },
              ]}
              className="self-start"
            />
          )}
          <Dialog.Description className="text-xs text-(--slate)" style={{ margin: 0 }}>
            {help}
          </Dialog.Description>

          {/* In Anchors mode the row takes the fixed height that is left and
              scrolls by itself, so nothing in it spills over the footer
              (#1039). */}
          <div className={`flex flex-wrap items-start gap-4 ${mode === 'labels' ? 'min-h-0 flex-1 overflow-y-auto' : ''}`}>
            {/* The picture with the marks over it, in a viewport that
                scrolls when the picture is zoomed (#956). */}
            <div className="flex flex-col gap-1.5" style={{ maxWidth: '100%' }}>
              <div role="group" aria-label={labels.resourceMarksZoomAria} className="flex items-center gap-0.5 self-start" title={labels.resourceMarksZoomHint}>
                <IconButton label={labels.resourceMarksZoomOut} icon={<ZoomOut size={14} aria-hidden="true" />} disabled={zoom <= 1} onClick={() => zoomTo(zoomStep(zoom, -1))} />
                <span className="min-w-10 text-center text-xs tabular-nums text-(--slate)" aria-live="polite">{Math.round(zoom * 100)}%</span>
                <IconButton label={labels.resourceMarksZoomIn} icon={<ZoomIn size={14} aria-hidden="true" />} disabled={zoom >= MAX_STAGE_ZOOM} onClick={() => zoomTo(zoomStep(zoom, 1))} />
                <IconButton label={labels.resourceMarksZoomFit} icon={<Maximize2 size={14} aria-hidden="true" />} disabled={zoom === 1} onClick={() => zoomTo(1)} />
                <IconButton label={labels.resourceMarksZoomHand} icon={<Hand size={14} aria-hidden="true" />} active={hand} disabled={zoom === 1} onClick={() => setHand((h) => !h)} />
              </div>
              <div
                ref={setViewport}
                data-testid="picture-marks-viewport"
                className="relative overflow-auto"
                style={intrinsic && intrinsic.height > 0
                  ? { width: `min(600px, calc(55dvh * ${intrinsic.width / intrinsic.height}))`, maxWidth: '100%', aspectRatio: `${intrinsic.width} / ${intrinsic.height}` }
                  : { display: 'inline-block', maxWidth: 'min(600px, 100%)' }}
              >
            <div
              ref={stageRef}
              data-testid="picture-marks-stage"
              className="relative touch-none select-none"
              style={{ cursor: panning ? (pan.current ? 'grabbing' : 'grab') : 'crosshair', overflow: 'hidden', width: intrinsic && intrinsic.height > 0 ? `${zoom * 100}%` : undefined, display: intrinsic && intrinsic.height > 0 ? 'block' : 'inline-block', maxWidth: intrinsic && intrinsic.height > 0 ? undefined : '100%' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <img
                src={url}
                alt=""
                draggable={false}
                className="block"
                // Sized from the picture's ratio, so the stage the marks are
                // laid over is the picture's own box: a picture held back by
                // the height limit would otherwise leave the stage wider
                // than it, and every mark off (#866). The viewport is that
                // box; the stage fills it, or `zoom` times it.
                style={intrinsic && intrinsic.height > 0
                  ? { width: '100%', height: 'auto' }
                  : { maxWidth: 'min(600px, 100%)', maxHeight: '55dvh' }}
                onLoad={(e) => setLoaded({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
              />

              {/* Safe area: edited in its mode, a dimmed reference in the others. */}
              {area && mode === 'safe' && (
                <div
                  ref={register('safe')}
                  data-mark="safe"
                  role="group"
                  tabIndex={0}
                  aria-label={labels.resourceSafeAreaRectAria}
                  onKeyDown={onMarkKeyDown({ kind: 'safe' })}
                  className="absolute focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--foreground)"
                  style={{ ...boxStyle(area), cursor: 'move', boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)', border: '2px solid var(--brand)' }}
                >
                  <RectHandles color="var(--brand)" />
                </div>
              )}
              {area && mode !== 'safe' && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute"
                  style={{ ...boxStyle(area), boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.28)', border: '1.5px dashed rgba(255, 255, 255, 0.85)' }}
                />
              )}

              {/* Avoid zones, and the faces of the people who do not speak. */}
              {withLettering && ([...marks.avoid.map((r, i) => [r, { kind: 'avoid', index: i }] as const), ...marks.faces.map((r, i) => [r, { kind: 'bystander', index: i }] as const)] as [ResourceSafeArea, ZoneTarget][]).map(([r, target]) => {
                const active = mode === 'avoid';
                const face = target.kind === 'bystander';
                const color = face ? BYSTANDER_COLOR : AVOID_COLOR;
                const label = (face ? labels.resourceBystanderFaceAria : labels.resourceAvoidZoneAria).replace('__n__', String(target.index + 1));
                const selected = active && zoneSelected(target);
                return (
                  <div
                    key={targetKey(target)}
                    ref={active ? register(targetKey(target)) : undefined}
                    data-mark={target.kind}
                    data-index={target.index}
                    role={active ? 'group' : undefined}
                    tabIndex={active ? 0 : undefined}
                    aria-label={active ? label : undefined}
                    aria-hidden={active ? undefined : true}
                    onKeyDown={active ? onMarkKeyDown(target) : undefined}
                    onFocus={active ? () => setSelZone(target) : undefined}
                    className={`absolute focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--foreground) ${active ? '' : 'pointer-events-none'}`}
                    style={{
                      ...boxStyle(r),
                      cursor: active ? 'move' : undefined,
                      background: face ? `${color}33` : AVOID_FILL,
                      border: `2px ${selected ? 'solid' : 'dashed'} ${color}`,
                      opacity: active ? 1 : 0.55,
                    }}
                  >
                    <MarkTag color={color}>{face ? <><Smile size={10} aria-hidden="true" />{String(target.index + 1)}</> : String(target.index + 1)}</MarkTag>
                    {selected && <RectHandles color={color} />}
                  </div>
                );
              })}

              {/* Labels away from their points (#1064): the line to the point
                  as the leader runs (dashed when no leader is drawn) and the
                  label's handle; the anchor picked has a grip by its point
                  to set its label away. */}
              {withLettering && mode === 'labels' && (
                <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {marks.anchors.map((a, i) => {
                    if (!a.labelAt) return null;
                    const first = labelState.byAnchor.get(a.id)?.[0];
                    const drawn = leaderDrawn(a, styleHasLeader(first?.style ?? a.style), first?.leader);
                    return (
                      <line
                        key={`leader-${i}`}
                        data-leader={drawn ? 'drawn' : 'none'}
                        x1={a.labelAt.x * 100} y1={a.labelAt.y * 100} x2={a.x * 100} y2={a.y * 100}
                        stroke={drawn ? labelStyleColor(a.style, labelStyles) : 'rgba(255, 255, 255, 0.8)'}
                        strokeWidth={drawn ? 2 : 1.5}
                        strokeDasharray={drawn ? undefined : '4 3'}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>
              )}
              {withLettering && mode === 'labels' && marks.anchors.map((a, i) => {
                if (!a.labelAt && selAnchor !== i) return null;
                const target: MarkTarget = { kind: 'label', index: i };
                const text = labelState.byAnchor.get(a.id)?.[0]?.text;
                return (
                  <LabelHandle
                    key={`label-${i}`}
                    markRef={register(targetKey(target))}
                    index={i}
                    point={a.labelAt ?? a}
                    away={!!a.labelAt}
                    color={labelStyleColor(a.style, labelStyles)}
                    text={text ?? (a.id || '…')}
                    label={(a.labelAt ? labels.labelAwayHandleAria : labels.labelAwayGripAria).replace('__id__', nameOf(i))}
                    onKeyDown={onMarkKeyDown(target)}
                    onFocus={() => setSelAnchor(i)}
                  />
                );
              })}

              {/* Speakers: face rectangle, head–mouth line, head and mouth.
                  Anchors (#866): the point alone, coloured by its label
                  style and named by its label's text. */}
              {withLettering && marks.anchors.map((a, i) => {
                const labelMode = mode === 'labels';
                const active = mode === 'speakers' || labelMode;
                const color = labelMode ? labelStyleColor(a.style, labelStyles) : speakerColor(i);
                const labelText = labelMode ? labelState.byAnchor.get(a.id)?.[0]?.text : undefined;
                const selected = active && selAnchor === i;
                const outside = anchorOutsideSafeArea(a, area);
                const face: MarkTarget = { kind: 'face', index: i };
                const head: MarkTarget = { kind: 'head', index: i };
                const mouth: MarkTarget = { kind: 'mouth', index: i };
                return (
                  <div key={`anchor-${i}`} className={active ? undefined : 'pointer-events-none'} style={{ opacity: active ? 1 : 0.55 }} aria-hidden={active ? undefined : true}>
                    {a.face && !labelMode && (
                      <div
                        ref={active ? register(targetKey(face)) : undefined}
                        data-mark="face"
                        data-index={i}
                        role={active ? 'group' : undefined}
                        tabIndex={active ? 0 : undefined}
                        aria-label={active ? labels.resourceAnchorFaceAria.replace('__id__', nameOf(i)) : undefined}
                        onKeyDown={active ? onMarkKeyDown(face) : undefined}
                        onFocus={active ? () => setSelAnchor(i) : undefined}
                        className="absolute focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--foreground)"
                        style={{ ...boxStyle(a.face), cursor: active ? 'move' : undefined, border: `2px ${selected ? 'solid' : 'dashed'} ${color}`, background: `${color}22` }}
                      >
                        {selected && <RectHandles color={color} />}
                      </div>
                    )}
                    {a.head && !labelMode && (
                      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <line
                          x1={a.x * 100} y1={a.y * 100} x2={a.head.x * 100} y2={a.head.y * 100}
                          stroke={color} strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                    )}
                    {a.head && !labelMode && (
                      <PointMark
                        markRef={active ? register(targetKey(head)) : undefined}
                        kind="head"
                        index={i}
                        point={a.head}
                        color={color}
                        active={active}
                        label={labels.resourceAnchorHeadAria.replace('__id__', nameOf(i))}
                        onKeyDown={onMarkKeyDown(head)}
                        onFocus={() => setSelAnchor(i)}
                      />
                    )}
                    <PointMark
                      markRef={active ? register(targetKey(mouth)) : undefined}
                      kind="mouth"
                      index={i}
                      point={a}
                      color={color}
                      active={active}
                      selected={selected}
                      ticked={labelMode && ticked.has(i)}
                      onHover={labelMode ? (on) => setHoverAnchor((h) => (on ? i : h === i ? null : h)) : undefined}
                      label={(labelMode ? labels.resourceLabelAnchorsPointAria : labels.resourceAnchorMouthAria).replace('__id__', nameOf(i))}
                      onKeyDown={onMarkKeyDown(mouth)}
                      onFocus={() => setSelAnchor(i)}
                      tag={labelMode && denseMap && !namesOnDense && zoom < STAGE_NAMES_ZOOM && !selected && hoverAnchor !== i && !ticked.has(i) ? undefined : (
                        <>
                          {outside && <TriangleAlert size={10} aria-hidden="true" style={{ color: '#fbbf24' }} />}
                          <span dir="auto">{labelText ?? (a.id || '…')}</span>
                        </>
                      )}
                    />
                  </div>
                );
              })}
            </div>
              </div>
            </div>

            {/* The side panel of the mode. */}
            <div className={`flex min-w-[220px] flex-1 flex-col gap-2 ${mode === 'labels' ? 'max-h-full self-stretch' : ''}`}>
              {mode === 'safe' && !area && (
                <div className="flex flex-col items-start gap-2">
                  <span className="text-xs text-(--slate)">{labels.resourceSafeAreaNone}</span>
                  <Button size="sm" icon={<Crop size={13} aria-hidden="true" />} onClick={() => commit({ ...marksRef.current, safeArea: INITIAL_SAFE_AREA })}>
                    {labels.resourceSafeAreaMark}
                  </Button>
                </div>
              )}
              {mode === 'safe' && previews.length > 0 && (
                <div className="flex gap-3">
                  {previews.map((p) => (
                    <figure key={p.label} className="m-0 flex flex-col items-center gap-1">
                      <img src={url} alt="" className="block rounded-sm" style={{ width: p.width, height: p.height, ...p.style }} />
                      <figcaption className="text-[11px] text-(--slate)">{p.label}</figcaption>
                    </figure>
                  ))}
                </div>
              )}

              {mode === 'labels' && (
                <LabelAnchorsPanel
                  marks={marks}
                  area={area}
                  labelStyles={labelStyles}
                  byAnchor={labelState.byAnchor}
                  waiting={labelState.waiting}
                  waitingLabel={labelState.waitingLabel}
                  placing={placing}
                  onPlacing={setPlacing}
                  selected={selAnchor}
                  onSelect={setSelAnchor}
                  commit={commit}
                  edit={anchorEdit}
                  beginEdit={beginAnchorEdit}
                  remove={removeLabelAnchor}
                  addAtCentre={addLabelAnchorAtCentre}
                  showIdErrors={showIdErrors}
                  idInputs={idInputs}
                  addButton={addButton}
                  ticked={ticked}
                  onTick={tick}
                  showNames={namesOnDense}
                  onShowNames={setNamesOnDense}
                  denseMap={denseMap}
                  onLabelLeader={setLabelLeader}
                  styleHasLeader={styleHasLeader}
                />
              )}

              {mode === 'speakers' && (
                <>
                  {marks.anchors.length === 0 && <p className="m-0 text-xs text-(--slate)">{labels.resourceAnchorsEmpty}</p>}
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {marks.anchors.map((a, i) => {
                      const problem = anchorIdProblem(marks.anchors, i);
                      // A duplicate or a reserved word shows at once; an
                      // empty or half-typed id once Save was pressed.
                      const shown = problem && (showIdErrors || problem === 'duplicate' || problem === 'reserved' || problem === 'invalid') ? problem : undefined;
                      const outside = anchorOutsideSafeArea(a, area);
                      const inputId = `pt-anchor-id-${i}`;
                      const msgId = `pt-anchor-msg-${i}`;
                      return (
                        <li
                          key={i}
                          className="flex flex-col gap-1.5 rounded-md border p-2"
                          style={{ borderColor: selAnchor === i ? speakerColor(i) : 'var(--pt-control-border)', borderInlineStartWidth: 4, borderInlineStartColor: speakerColor(i) }}
                          onFocusCapture={() => setSelAnchor(i)}
                        >
                          <div className="flex items-center gap-2">
                            <label htmlFor={inputId} className="shrink-0 text-xs text-(--slate)">{labels.resourceAnchorIdLabel}</label>
                            <input
                              ref={(el) => { if (el) idInputs.current.set(i, el); else idInputs.current.delete(i); }}
                              id={inputId}
                              dir="auto"
                              type="text"
                              spellCheck={false}
                              autoCapitalize="off"
                              autoComplete="off"
                              value={a.id}
                              aria-invalid={shown ? true : undefined}
                              aria-describedby={shown || outside ? msgId : undefined}
                              onFocus={() => { idEdit.current = { index: i, before: marksRef.current, recorded: false }; }}
                              onChange={(e) => {
                                const edit = idEdit.current;
                                if (edit && edit.index === i && !edit.recorded) {
                                  record(edit.before);
                                  edit.recorded = true;
                                }
                                setMarks(withAnchor(marksRef.current, i, (x) => ({ ...x, id: e.target.value.replace(/\s+/g, '') })));
                              }}
                              className="h-7 min-w-0 flex-1 rounded-md border bg-(--surface) px-2 font-mono text-xs text-(--foreground) outline-none focus:outline-2 focus:outline-offset-1 focus:outline-(--brand) pt-large:h-11"
                              style={{ borderColor: shown ? AVOID_COLOR : 'var(--pt-control-border)' }}
                            />
                            <IconButton
                              label={labels.resourceAnchorDelete.replace('__id__', nameOf(i))}
                              icon={<Trash2 size={13} aria-hidden="true" />}
                              destructive
                              onClick={() => {
                                commit(removeMark(marksRef.current, { kind: 'mouth', index: i }));
                                setSelAnchor(null);
                                focusNext.current = () => addButton.current?.focus();
                              }}
                            />
                          </div>
                          {(shown || outside) && (
                            <div id={msgId} className="flex flex-col gap-0.5 text-xs">
                              {shown && <span style={{ color: 'var(--pt-error, #ef4444)' }}>{idMessage(shown, a.id)}</span>}
                              {outside && (
                                <span className="inline-flex items-start gap-1" style={{ color: 'var(--pt-warning, #d97706)' }}>
                                  <TriangleAlert size={12} aria-hidden="true" className="mt-[3px] shrink-0" />
                                  {labels.resourceAnchorOutsideSafeArea}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => commit(a.head ? removeMark(marksRef.current, { kind: 'head', index: i }) : addHead(marksRef.current, i))}
                            >
                              {a.head ? labels.resourceAnchorRemoveHead : labels.resourceAnchorAddHead}
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => commit(a.face ? removeMark(marksRef.current, { kind: 'face', index: i }) : addFace(marksRef.current, i))}
                            >
                              {a.face ? labels.resourceAnchorRemoveFace : labels.resourceAnchorAddFace}
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <Button ref={addButton} size="sm" icon={<Plus size={13} aria-hidden="true" />} className="self-start" onClick={addSpeakerAtCentre}>
                    {labels.resourceAnchorAdd}
                  </Button>
                </>
              )}

              {mode === 'avoid' && (
                <>
                  {marks.avoid.length === 0 && marks.faces.length === 0 && <p className="m-0 text-xs text-(--slate)">{labels.resourceAvoidEmpty}</p>}
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {([...marks.avoid.map((r, i) => [r, { kind: 'avoid', index: i }] as const), ...marks.faces.map((r, i) => [r, { kind: 'bystander', index: i }] as const)] as [ResourceSafeArea, ZoneTarget][]).map(([r, target]) => {
                      const face = target.kind === 'bystander';
                      const n = String(target.index + 1);
                      const key = targetKey(target);
                      const switchId = `pt-zone-face-${key}`;
                      return (
                        <li
                          key={key}
                          className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md border px-2 py-1 text-xs"
                          style={{ borderColor: zoneSelected(target) ? (face ? BYSTANDER_COLOR : AVOID_COLOR) : 'var(--pt-control-border)', borderInlineStartWidth: 4, borderInlineStartColor: face ? BYSTANDER_COLOR : AVOID_COLOR }}
                        >
                          <button
                            type="button"
                            className="min-h-7 flex-1 cursor-pointer text-start text-(--foreground) pt-large:min-h-11"
                            onClick={() => {
                              setSelZone(target);
                              markEls.current.get(key)?.focus();
                            }}
                          >
                            {(face ? labels.resourceBystanderFaceAria : labels.resourceAvoidZoneAria).replace('__n__', n)}
                            <span className="ms-2 text-(--slate)">{pct(r.width)} × {pct(r.height)} %</span>
                          </button>
                          <span className="inline-flex items-center gap-1.5">
                            <span id={switchId} className="text-(--slate)">{labels.resourceZoneIsFace}</span>
                            <span ref={(el) => {
                              const root = el?.querySelector<HTMLElement>('[role="switch"]');
                              if (root) zoneSwitches.current.set(key, root);
                              else zoneSwitches.current.delete(key);
                            }}>
                              <Switch checked={face} onCheckedChange={() => switchKind(target)} ariaLabelledBy={switchId} />
                            </span>
                          </span>
                          <IconButton
                            label={(face ? labels.resourceBystanderFaceDelete : labels.resourceAvoidZoneDelete).replace('__n__', n)}
                            icon={<Trash2 size={13} aria-hidden="true" />}
                            destructive
                            onClick={() => {
                              commit(removeMark(marksRef.current, target));
                              setSelZone(null);
                              focusNext.current = () => addButton.current?.focus();
                            }}
                          />
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex flex-wrap gap-1.5">
                    <Button ref={addButton} size="sm" icon={<Plus size={13} aria-hidden="true" />} onClick={addAvoidAtCentre}>
                      {labels.resourceAvoidAdd}
                    </Button>
                    <Button size="sm" icon={<Smile size={13} aria-hidden="true" />} onClick={addBystanderAtCentre}>
                      {labels.resourceBystanderAdd}
                    </Button>
                  </div>
                  {resource.kind === 'svg' && (
                    <SvgSymbolsReader
                      fileId={resource.svg?.fileId}
                      onAdd={(found) => {
                        const { zones, added } = addZones(marksRef.current.avoid, found);
                        if (added > 0) commit({ ...marksRef.current, avoid: zones });
                        return added;
                      }}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          {mode === 'safe' && area && (
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 min-[480px]:grid-cols-2">
              {([
                ['x', labels.resourceSafeAreaLeft, 0],
                ['y', labels.resourceSafeAreaTop, 0],
                ['width', labels.resourceSafeAreaWidth, MIN_SIDE * 100],
                ['height', labels.resourceSafeAreaHeight, MIN_SIDE * 100],
              ] as const).map(([key, label, min]) => (
                <div key={key} className="@container">
                  <NumberInput label={label} value={pct(area[key])} onChange={(v) => setField(key, v)} min={min} max={100} step={1} suffix="%" isDefault />
                </div>
              ))}
            </div>
          )}

          {showIdErrors && firstAnchorIdProblem(marks.anchors) >= 0 && (
            <p role="alert" className="m-0 text-xs" style={{ color: 'var(--pt-error, #ef4444)' }}>{labels.resourceMarksFixIds}</p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" size="sm" icon={<Undo2 size={13} aria-hidden="true" />} disabled={!past.length} onClick={undo} className="me-auto">
              {labels.resourceMarksUndo}
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>
              {labels.resourceSafeAreaCancel}
            </Button>
            <Button variant="primary" size="sm" onClick={save}>
              {labels.resourceSafeAreaSave}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The eight resize handles of a rectangle being edited: 12 px squares
 *  whose hit area grows to 28 px, and to 44 px with large targets or on a
 *  touch screen. */
function RectHandles({ color }: { color: string }) {
  return (
    <>
      {HANDLES.map((h) => (
        <span
          key={h}
          data-handle={h}
          aria-hidden="true"
          className="absolute h-3 w-3 rounded-sm border border-white after:absolute after:-inset-2 pointer-coarse:after:-inset-4 pt-large:after:-inset-4"
          style={{
            background: color,
            left: h.includes('w') ? -7 : h.includes('e') ? 'calc(100% - 5px)' : 'calc(50% - 6px)',
            top: h.includes('n') ? -7 : h.includes('s') ? 'calc(100% - 5px)' : 'calc(50% - 6px)',
            cursor: `${h === 'n' || h === 's' ? 'ns' : h === 'e' || h === 'w' ? 'ew' : h === 'ne' || h === 'sw' ? 'nesw' : 'nwse'}-resize`,
          }}
        />
      ))}
    </>
  );
}

/** A small label pinned to a mark's corner (a speaker id, a zone number). */
function MarkTag({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute start-0 top-0 inline-flex items-center gap-1 whitespace-nowrap rounded-br px-1 text-[10px] font-semibold leading-[14px] text-white"
      style={{ background: 'rgba(0, 0, 0, 0.72)', borderInlineStart: `3px solid ${color}` }}
    >
      {children}
    </span>
  );
}

interface PointMarkProps {
  markRef?: (el: HTMLElement | null) => void;
  kind: 'mouth' | 'head';
  index: number;
  point: Point;
  color: string;
  active: boolean;
  selected?: boolean;
  /** Ticked for a change of several anchors together (#931). */
  ticked?: boolean;
  /** The pointer enters or leaves the point. */
  onHover?: (on: boolean) => void;
  label: string;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
  tag?: ReactNode;
}

/** A draggable point: a 44 px target centred on it, drawn as a filled dot
 *  (mouth) or a ring (head), with the speaker id beside the mouth. */
function PointMark({ markRef, kind, index, point, color, active, selected, ticked, onHover, label, onKeyDown, onFocus, tag }: PointMarkProps) {
  const dot = kind === 'mouth' ? 14 : 12;
  return (
    <div
      ref={markRef}
      data-mark={kind}
      data-index={index}
      role={active ? 'group' : undefined}
      tabIndex={active ? 0 : undefined}
      aria-label={active ? label : undefined}
      onKeyDown={active ? onKeyDown : undefined}
      onFocus={active ? onFocus : undefined}
      onPointerEnter={onHover ? () => onHover(true) : undefined}
      onPointerLeave={onHover ? () => onHover(false) : undefined}
      className="group absolute flex items-center justify-center rounded-full outline-none"
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, width: 44, height: 44, transform: 'translate(-50%, -50%)', cursor: active ? 'grab' : undefined }}
    >
      <span
        aria-hidden="true"
        className="block rounded-full group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-white"
        style={{
          width: dot,
          height: dot,
          background: kind === 'mouth' ? color : 'rgba(0, 0, 0, 0.35)',
          border: kind === 'mouth' ? '2px solid #fff' : `3px solid ${color}`,
          boxShadow: selected ? `0 0 0 3px rgba(0, 0, 0, 0.55), 0 0 0 6px ${color}` : ticked ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : '0 0 0 1.5px rgba(0, 0, 0, 0.6)',
        }}
      />
      {tag && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inline-flex items-center gap-1 whitespace-nowrap rounded px-1 text-[10px] font-semibold leading-[14px] text-white"
          style={{ left: 30, top: 2, background: 'rgba(0, 0, 0, 0.72)', borderInlineStart: `3px solid ${color}` }}
        >
          {tag}
        </span>
      )}
    </div>
  );
}

interface LabelHandleProps {
  markRef?: (el: HTMLElement | null) => void;
  index: number;
  point: Point;
  /** The label stands away from its point; else this is the grip by the
   *  point that sets it away. */
  away: boolean;
  color: string;
  text: string;
  label: string;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
}

/** The handle of a label set away from its point (#1064): a tag with the
 *  label's words where it stands, or, for the anchor picked, a grip beside
 *  its point. Dragged or nudged with the arrows it moves `labelAt`; Delete
 *  sets the label back at its point. A 44 px target. */
function LabelHandle({ markRef, index, point, away, color, text, label, onKeyDown, onFocus }: LabelHandleProps) {
  return (
    <div
      ref={markRef}
      data-mark="label"
      data-index={index}
      role="group"
      tabIndex={0}
      aria-label={label}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className="group absolute flex items-center justify-center outline-none"
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        minWidth: 44,
        height: 44,
        // The grip stands up and to the right of the point it leaves.
        transform: away ? 'translate(-50%, -50%)' : 'translate(4px, calc(-100% - 4px))',
        cursor: 'grab',
      }}
    >
      <span
        aria-hidden="true"
        className="inline-flex max-w-[11rem] items-center gap-1 whitespace-nowrap rounded px-1.5 text-[10px] font-semibold leading-[18px] text-white group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-white"
        style={{ background: 'rgba(0, 0, 0, 0.78)', border: `2px ${away ? 'solid' : 'dashed'} ${color}` }}
      >
        <Type size={10} aria-hidden="true" />
        {away && <span dir="auto" className="truncate">{text}</span>}
      </span>
    </div>
  );
}
