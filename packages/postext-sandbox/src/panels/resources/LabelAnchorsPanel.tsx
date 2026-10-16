'use client';

import { useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { MapPin, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import type { LabelStyle, ResourceAnchor, ResourceSafeArea } from 'postext';
import { useSandboxLabels } from '../../context/SandboxContext';
import { Button, IconButton, NumberField, SegmentedControl, Select } from '../../ui';
import { anchorIdProblem, anchorOutsideSafeArea, withAnchor, withLabelFields, type AnchorIdProblem, type PictureMarks } from './pictureMarks';
import type { MarkdownLabel } from './figureLabels';

// ---------------------------------------------------------------------------
// The Anchors mode of the picture marks dialog (#866): the anchors a map's
// or a diagram's `::label` lines stand at, as a list. The names the text
// uses that the picture has no anchor for are offered first; the one
// picked is placed by the next click on the picture. Each anchor has a
// name, a label style and the label fields a label set at it takes
// (alignment, vertical alignment, rotation, width).
// ---------------------------------------------------------------------------

/** One colour per label style (cycled), so the points of a style read as
 *  one kind of name; anchors with no style are white. */
const STYLE_COLORS = ['#f97316', '#22d3ee', '#facc15', '#a3e635', '#e879f9', '#60a5fa', '#f87171', '#34d399', '#c084fc'];
export function labelStyleColor(style: string | undefined, styles: readonly LabelStyle[]): string {
  if (!style) return '#f8fafc';
  const i = styles.findIndex((s) => s.id === style);
  return STYLE_COLORS[(i < 0 ? styles.length : i) % STYLE_COLORS.length]!;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface LabelAnchorsPanelProps {
  marks: PictureMarks;
  area: ResourceSafeArea | undefined;
  labelStyles: readonly LabelStyle[];
  /** The labels the text sets at each anchor. */
  byAnchor: Map<string, MarkdownLabel[]>;
  /** Names labels stand at that the picture lacks. */
  waiting: readonly string[];
  waitingLabel: Map<string, MarkdownLabel>;
  placing: string | null;
  onPlacing: (name: string | null) => void;
  selected: number | null;
  onSelect: (index: number | null) => void;
  /** Replace the marks, undoably. */
  commit: (next: PictureMarks) => void;
  /** Replace the marks while typing (one step of Undo per edit, recorded
   *  by `beginEdit`). */
  edit: (next: PictureMarks) => void;
  beginEdit: (index: number) => void;
  remove: (index: number) => void;
  addAtCentre: () => void;
  showIdErrors: boolean;
  idInputs: MutableRefObject<Map<number, HTMLInputElement>>;
  addButton: MutableRefObject<HTMLButtonElement | null>;
}

export function LabelAnchorsPanel(props: LabelAnchorsPanelProps) {
  const { marks, area, labelStyles, byAnchor, waiting, waitingLabel, placing, onPlacing, selected, onSelect, commit, edit, beginEdit, remove, addAtCentre, showIdErrors, idInputs, addButton } = props;
  const labels = useSandboxLabels();
  const [filter, setFilter] = useState('');
  const uid = useId();
  const rows = useRef(new Map<number, HTMLLIElement>());
  const list = useRef<HTMLUListElement>(null);

  // The anchor picked from elsewhere (the canvas, a warning, a click on
  // its point) comes into view in the list, which alone scrolls: the
  // picture stays where the pointer is.
  useEffect(() => {
    if (selected === null) return;
    const row = rows.current.get(selected);
    const box = list.current;
    if (!row || !box) return;
    const top = row.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + row.offsetHeight - box.clientHeight;
  }, [selected]);

  const visible = useMemo(() => {
    const q = fold(filter.trim());
    return marks.anchors
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => !q || i === selected || fold(a.id).includes(q) || (byAnchor.get(a.id) ?? []).some((l) => fold(l.text).includes(q)));
  }, [marks.anchors, filter, byAnchor, selected]);

  const styleOptions = [
    { value: '', label: labels.resourceLabelAnchorsStyleNone },
    ...labelStyles.map((s) => ({ value: s.id, label: s.name && s.name !== s.id ? `${s.name} (${s.id})` : s.id })),
  ];
  const idMessage = (problem: AnchorIdProblem, id: string) =>
    problem === 'empty' ? labels.resourceLabelAnchorsNameEmpty
      : problem === 'invalid' ? labels.resourceAnchorIdInvalid
        : problem === 'reserved' ? labels.resourceAnchorIdReserved.replace('__id__', id)
          : labels.resourceLabelAnchorsNameDuplicate;

  return (
    <>
      {waiting.length > 0 && (
        <section aria-labelledby={`${uid}-waiting`} className="flex flex-col gap-1.5 rounded-md border p-2" style={{ borderColor: 'var(--pt-control-border)' }}>
          <h3 id={`${uid}-waiting`} className="m-0 text-xs font-semibold">{labels.resourceLabelAnchorsWaiting.replace('__n__', String(waiting.length))}</h3>
          <p className="m-0 text-xs text-(--slate)">{labels.resourceLabelAnchorsWaitingHint}</p>
          <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {waiting.map((name) => {
              const label = waitingLabel.get(name);
              const on = placing === name;
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  title={label?.text}
                  onClick={() => onPlacing(on ? null : name)}
                  className="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs pt-large:min-h-11"
                  style={{
                    borderColor: on ? 'var(--brand)' : 'var(--pt-control-border)',
                    background: on ? 'var(--brand)' : 'var(--surface)',
                    color: on ? 'var(--background)' : 'var(--foreground)',
                  }}
                >
                  <MapPin size={11} aria-hidden="true" />
                  <span className="font-mono" dir="auto">{name}</span>
                  {label?.text && label.text !== name && <span dir="auto" className="max-w-[9rem] truncate opacity-75">{label.text}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}
      <p role="status" aria-live="polite" className="m-0 flex min-h-5 items-center gap-1.5 text-xs" style={{ color: placing ? 'var(--brand)' : 'var(--slate)' }}>
        {placing && (
          <>
            <MapPin size={12} aria-hidden="true" />
            <span className="min-w-0 flex-1">{labels.resourceLabelAnchorsPlacing.replace('__id__', placing)}</span>
            <IconButton label={labels.resourceLabelAnchorsStopPlacing} icon={<X size={12} aria-hidden="true" />} onClick={() => onPlacing(null)} />
          </>
        )}
      </p>

      {marks.anchors.length === 0 && <p className="m-0 text-xs text-(--slate)">{labels.resourceLabelAnchorsEmpty}</p>}
      {marks.anchors.length > 8 && (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={labels.resourceLabelAnchorsFilter}
          placeholder={labels.resourceLabelAnchorsFilter}
          className="h-7 rounded-md border bg-(--surface) px-2 text-xs text-(--foreground) outline-none focus:outline-2 focus:outline-offset-1 focus:outline-(--brand) pt-large:h-11"
          style={{ borderColor: 'var(--pt-control-border)' }}
        />
      )}
      <ul ref={list} className="relative m-0 flex max-h-[45dvh] list-none flex-col gap-1 overflow-y-auto p-0" aria-label={labels.resourceMarksModeAnchors}>
        {visible.map(({ a, i }) => {
          const open = selected === i;
          const color = labelStyleColor(a.style, labelStyles);
          const texts = byAnchor.get(a.id) ?? [];
          const problem = anchorIdProblem(marks.anchors, i);
          const shown = problem && (showIdErrors || problem !== 'empty') ? problem : undefined;
          const outside = anchorOutsideSafeArea(a, area);
          const styleName = a.style ? (labelStyles.find((s) => s.id === a.style)?.name ?? a.style) : '';
          return (
            <li
              key={i}
              ref={(el) => { if (el) rows.current.set(i, el); else rows.current.delete(i); }}
              className="flex flex-col gap-1.5 rounded-md border px-2 py-1"
              style={{ borderColor: open ? color : 'var(--pt-control-border)', borderInlineStartWidth: 4, borderInlineStartColor: color }}
              onFocusCapture={() => { if (!open) onSelect(i); }}
            >
              {!open ? (
                <button type="button" className="flex min-h-7 w-full cursor-pointer items-center gap-2 text-start text-xs pt-large:min-h-11" onClick={() => onSelect(i)}>
                  <span className="font-mono text-(--foreground)" dir="auto">{a.id || '…'}</span>
                  <span dir="auto" className="min-w-0 flex-1 truncate" style={{ color: texts.length ? 'var(--foreground)' : 'var(--slate)', fontStyle: texts.length ? undefined : 'italic' }}>
                    {texts.length ? texts[0]!.text : labels.resourceLabelAnchorsNoLabel}
                  </span>
                  {styleName && <span className="shrink-0 text-[11px] text-(--slate)">{styleName}</span>}
                  {(shown || outside) && <TriangleAlert size={12} aria-hidden="true" style={{ color: shown ? '#ef4444' : '#d97706' }} />}
                </button>
              ) : (
                <AnchorFields
                  anchor={a}
                  index={i}
                  marks={marks}
                  texts={texts}
                  styleOptions={styleOptions}
                  problem={shown}
                  problemText={shown ? idMessage(shown, a.id) : undefined}
                  outside={outside}
                  commit={commit}
                  edit={edit}
                  beginEdit={beginEdit}
                  remove={remove}
                  idInputs={idInputs}
                />
              )}
            </li>
          );
        })}
      </ul>
      <Button ref={addButton} size="sm" icon={<Plus size={13} aria-hidden="true" />} className="self-start" onClick={addAtCentre}>
        {labels.resourceLabelAnchorsAdd}
      </Button>
    </>
  );
}

interface AnchorFieldsProps {
  anchor: ResourceAnchor;
  index: number;
  marks: PictureMarks;
  texts: readonly MarkdownLabel[];
  styleOptions: { value: string; label: string }[];
  problem?: AnchorIdProblem;
  problemText?: string;
  outside: boolean;
  commit: (next: PictureMarks) => void;
  edit: (next: PictureMarks) => void;
  beginEdit: (index: number) => void;
  remove: (index: number) => void;
  idInputs: MutableRefObject<Map<number, HTMLInputElement>>;
}

/** The fields of the anchor picked in the list. */
function AnchorFields({ anchor: a, index: i, marks, texts, styleOptions, problem, problemText, outside, commit, edit, beginEdit, remove, idInputs }: AnchorFieldsProps) {
  const labels = useSandboxLabels();
  const uid = useId();
  const set = (patch: Parameters<typeof withLabelFields>[2]) => commit(withLabelFields(marks, i, patch));
  return (
    <div className="flex flex-col gap-1.5 py-1 text-xs">
      <div className="flex items-center gap-2">
        <label htmlFor={`${uid}-id`} className="shrink-0 text-(--slate)">{labels.resourceLabelAnchorsNameLabel}</label>
        <input
          ref={(el) => { if (el) idInputs.current.set(i, el); else idInputs.current.delete(i); }}
          id={`${uid}-id`}
          dir="auto"
          type="text"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          value={a.id}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem || outside ? `${uid}-msg` : undefined}
          onFocus={() => beginEdit(i)}
          onChange={(e) => edit(withAnchor(marks, i, (x) => ({ ...x, id: e.target.value.replace(/\s+/g, '') })))}
          className="h-7 min-w-0 flex-1 rounded-md border bg-(--surface) px-2 font-mono text-xs text-(--foreground) outline-none focus:outline-2 focus:outline-offset-1 focus:outline-(--brand) pt-large:h-11"
          style={{ borderColor: problem ? '#ef4444' : 'var(--pt-control-border)' }}
        />
        <IconButton
          label={labels.resourceLabelAnchorsDelete.replace('__id__', a.id || String(i + 1))}
          icon={<Trash2 size={13} aria-hidden="true" />}
          destructive
          onClick={() => remove(i)}
        />
      </div>
      {(problem || outside) && (
        <div id={`${uid}-msg`} className="flex flex-col gap-0.5">
          {problem && <span style={{ color: 'var(--pt-error, #ef4444)' }}>{problemText}</span>}
          {outside && (
            <span className="inline-flex items-start gap-1" style={{ color: 'var(--pt-warning, #d97706)' }}>
              <TriangleAlert size={12} aria-hidden="true" className="mt-[3px] shrink-0" />
              {labels.resourceAnchorOutsideSafeArea}
            </span>
          )}
        </div>
      )}
      <p dir="auto" className="m-0" style={{ color: texts.length ? 'var(--foreground)' : 'var(--slate)', fontStyle: texts.length ? undefined : 'italic' }}>
        {texts.length ? texts.map((t) => t.text).join(' · ') : labels.resourceLabelAnchorsNoLabel}
      </p>
      <div className="flex items-center gap-2">
        <span id={`${uid}-style`} className="w-24 shrink-0 text-(--slate)">{labels.resourceLabelAnchorsStyle}</span>
        <Select
          value={a.style ?? ''}
          onValueChange={(v) => set({ style: v || undefined })}
          options={styleOptions}
          ariaLabelledBy={`${uid}-style`}
          muted={!a.style}
          className="min-w-0 flex-1"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span id={`${uid}-align`} className="w-24 shrink-0 text-(--slate)">{labels.resourceLabelAnchorsAlign}</span>
        <SegmentedControl<'start' | 'center' | 'end'>
          size="sm"
          value={a.align ?? 'center'}
          onValueChange={(v) => set({ align: v })}
          ariaLabel={labels.resourceLabelAnchorsAlign}
          ariaLabelledBy={`${uid}-align`}
          options={[
            { value: 'start', label: labels.resourceLabelAnchorsAlignStart },
            { value: 'center', label: labels.resourceLabelAnchorsAlignCenter },
            { value: 'end', label: labels.resourceLabelAnchorsAlignEnd },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span id={`${uid}-valign`} className="w-24 shrink-0 text-(--slate)">{labels.resourceLabelAnchorsVerticalAlign}</span>
        <SegmentedControl<'top' | 'middle' | 'bottom'>
          size="sm"
          value={a.verticalAlign ?? 'middle'}
          onValueChange={(v) => set({ verticalAlign: v })}
          ariaLabel={labels.resourceLabelAnchorsVerticalAlign}
          ariaLabelledBy={`${uid}-valign`}
          options={[
            { value: 'top', label: labels.resourceLabelAnchorsVerticalTop },
            { value: 'middle', label: labels.resourceLabelAnchorsVerticalMiddle },
            { value: 'bottom', label: labels.resourceLabelAnchorsVerticalBottom },
          ]}
        />
      </div>
      {/* Typing a number is one step of Undo, recorded at its first change. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" onFocusCapture={() => beginEdit(i)}>
        <span className="inline-flex items-center gap-2">
          <span id={`${uid}-rotate`} className="w-24 shrink-0 text-(--slate)">{labels.resourceLabelAnchorsRotate}</span>
          <NumberField
            value={a.rotate ?? 0}
            onValueChange={(v) => edit(withLabelFields(marks, i, { rotate: Number.isFinite(v) ? v : 0 }))}
            min={-360}
            max={360}
            step={1}
            widthCh={5}
            ariaLabelledBy={`${uid}-rotate`}
            muted={!a.rotate}
          />
          <span className="text-(--slate)">°</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span id={`${uid}-width`} className="shrink-0 text-(--slate)">{labels.resourceLabelAnchorsWidth}</span>
          <NumberField
            value={a.width !== undefined ? Math.round(a.width * 1000) / 10 : 0}
            onValueChange={(v) => edit(withLabelFields(marks, i, { width: v > 0 ? v / 100 : undefined }))}
            min={0}
            max={100}
            step={1}
            widthCh={5}
            ariaLabelledBy={`${uid}-width`}
            ariaDescribedBy={`${uid}-width-hint`}
            muted={a.width === undefined}
          />
          <span className="text-(--slate)">%</span>
        </span>
      </div>
      <p id={`${uid}-width-hint`} className="m-0 text-[11px] text-(--slate)">{labels.resourceLabelAnchorsWidthHint}</p>
    </div>
  );
}
