'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DEFAULT_CALLOUT_STYLES, type AnchorEdge, type Dimension, type ElementPlacement, type FrameConfig, type FrameSize } from 'postext';
import { useSandboxDocRef, useSandboxLabels } from '../../../context/SandboxContext';
import { useFrameDrag } from '../../../selection/frameDrag';
import { DimensionInput, FieldGroup, FieldRow, NumberInput, SelectInput, TextControl, ToggleSwitch } from '../../../controls';
import { Button, ConfirmPopover } from '../../../ui';
import { frameEntry, removeFrame, renameFrame, namesInUse, slugify, updateFrame, type TemplateScope } from '../../../templates/templateEdits';
import { resolveAt, usePageTemplates } from './model';

const MM0: Dimension = { value: 0, unit: 'mm' };
const NINE_POINT: AnchorEdge[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const ELEMENT_EDGES: AnchorEdge[] = ['below', 'above', 'right-of', 'left-of', 'align-top', 'align-bottom', 'align-left', 'align-right'];

type SizeMode = 'fixed' | 'percent' | 'auto' | 'fill';

const sizeMode = (s: FrameSize): SizeMode => (s === 'auto' ? 'auto' : s === 'fill' ? 'fill' : 'percent' in s ? 'percent' : 'fixed');

interface FramePropertiesProps {
  templateId: string;
  scope: TemplateScope;
  name: string;
  onRenamed: (name: string) => void;
  onRemoved: () => void;
}

/** Every field of one frame of a template, at a scope: the value it
 *  resolves to, muted until the scope sets it, with a reset that hands it
 *  back to what the frame inherits. */
export function FrameProperties({ templateId, scope, name, onRenamed, onRemoved }: FramePropertiesProps) {
  const labels = useSandboxLabels();
  const { templates, calloutStyles, write } = usePageTemplates();
  const template = resolveAt({ pageTemplates: templates }, templateId, scope);
  const frame = template?.frames.find((f) => f.name === name);
  const entry = frameEntry(templates, templateId, scope, name) as (FrameConfig & Record<string, unknown>) | undefined;
  const [nameDraft, setNameDraft] = useState(name);
  useEffect(() => setNameDraft(name), [name]);
  // The frame dragged on the page (#865): its box while the pointer moves,
  // before the drop writes it.
  const drag = useFrameDrag(name);
  const docRef = useSandboxDocRef();
  if (!template || !frame) return null;
  const mmOf = (px: number) => (px * 25.4 / (docRef.current?.config.page.dpi ?? 96)).toFixed(1);

  const has = (k: keyof FrameConfig): boolean => entry !== undefined && entry[k] !== undefined;
  const set = (patch: Partial<Record<keyof FrameConfig, unknown>>) => write(updateFrame(templates, templateId, scope, name, patch));
  const reset = (k: keyof FrameConfig) => () => set({ [k]: undefined });
  /** A field of an object (`fit`, `overflow`, `padding`) set or taken off
   *  in the scope's entry; the object goes when it is left empty. */
  const setIn = <K extends 'fit' | 'overflow' | 'padding'>(k: K, field: string, value: unknown) => {
    const before = { ...((entry?.[k] as Record<string, unknown> | undefined) ?? {}) };
    if (value === undefined) delete before[field];
    else before[field] = value;
    set({ [k]: Object.keys(before).length > 0 ? before : undefined });
  };
  const hasIn = (k: 'fit' | 'overflow' | 'padding', field: string): boolean => (entry?.[k] as Record<string, unknown> | undefined)?.[field] !== undefined;

  const others = template.frames.filter((f) => f.name !== name).map((f) => f.name);
  const groups = template.groups.map((g) => g.name);
  const styles = calloutStyles ?? DEFAULT_CALLOUT_STYLES;

  const commitName = () => {
    const next = slugify(nameDraft);
    if (!next || next === name || namesInUse(templates, templateId).has(next)) {
      setNameDraft(name);
      return;
    }
    write(renameFrame(templates, templateId, name, next));
    onRenamed(next);
  };

  // --- Position ----------------------------------------------------------
  const placement = frame.placement;
  const anchorTo = placement?.anchor.to ?? 'none';
  const anchorOptions = [
    { value: 'none', label: labels.pageTemplatesAnchorWhole },
    { value: 'container', label: labels.pageTemplatesAnchorArea },
    { value: 'page', label: labels.headerFooterAnchorToPage },
    { value: 'bleed', label: labels.headerFooterAnchorToBleed },
    ...others.map((n) => ({ value: `#${n}`, label: labels.pageTemplatesAnchorFrame.replace('__name__', n) })),
    ...groups.map((n) => ({ value: `#${n}`, label: labels.pageTemplatesAnchorGroup.replace('__name__', n) })),
  ];
  if (!anchorOptions.some((o) => o.value === anchorTo)) anchorOptions.push({ value: anchorTo, label: anchorTo });
  const edgeLabel: Record<string, string> = {
    'top-left': labels.headerFooterFrameEdgeTopLeft,
    top: labels.headerFooterFrameEdgeTop,
    'top-right': labels.headerFooterFrameEdgeTopRight,
    left: labels.headerFooterFrameEdgeLeft,
    center: labels.headerFooterFrameEdgeCenter,
    right: labels.headerFooterFrameEdgeRight,
    'bottom-left': labels.headerFooterFrameEdgeBottomLeft,
    bottom: labels.headerFooterFrameEdgeBottom,
    'bottom-right': labels.headerFooterFrameEdgeBottomRight,
    'right-of': labels.headerFooterElementEdgeRightOf,
    'left-of': labels.headerFooterElementEdgeLeftOf,
    below: labels.headerFooterElementEdgeBelow,
    above: labels.headerFooterElementEdgeAbove,
    'align-top': labels.headerFooterElementEdgeAlignTop,
    'align-bottom': labels.headerFooterElementEdgeAlignBottom,
    'align-left': labels.headerFooterElementEdgeAlignLeft,
    'align-right': labels.headerFooterElementEdgeAlignRight,
  };
  const toFrame = anchorTo.startsWith('#');
  const edges = toFrame ? [...ELEMENT_EDGES, ...NINE_POINT] : NINE_POINT;
  const setPlacement = (next: ElementPlacement | undefined) => set({ placement: next });
  const onAnchor = (to: string) => {
    if (to === 'none') return setPlacement(undefined);
    const element = to.startsWith('#');
    // The edge is kept between targets of one kind (frame to frame, area to
    // page); a frame anchored to another starts below it.
    const keep = placement && placement.anchor.to.startsWith('#') === element && (element ? [...ELEMENT_EDGES, ...NINE_POINT] : NINE_POINT).includes(placement.anchor.edge);
    setPlacement({
      ...(placement ?? {}),
      anchor: { to: to as ElementPlacement['anchor']['to'], edge: keep ? placement!.anchor.edge : element ? 'below' : 'top-left' },
      offset: placement?.offset ?? { x: MM0, y: MM0 },
    });
  };

  // --- Size ----------------------------------------------------------------
  const sizeField = (k: 'width' | 'height', label: string, tooltip: string) => {
    const value = frame[k];
    const mode = sizeMode(value);
    const modes: { value: SizeMode; label: string }[] = [
      { value: 'fixed', label: labels.pageTemplatesSizeFixed },
      { value: 'percent', label: labels.pageTemplatesSizePercent },
      { value: 'auto', label: labels.pageTemplatesSizeAuto },
      { value: 'fill', label: labels.pageTemplatesSizeFill },
    ];
    return (
      <>
        <SelectInput
          label={label}
          value={mode}
          options={modes}
          onChange={(v) => {
            const m = v as SizeMode;
            set({ [k]: m === 'fixed' ? { value: k === 'width' ? 60 : 40, unit: 'mm' } : m === 'percent' ? { percent: 50 } : m });
          }}
          tooltip={tooltip}
          isDefault={!has(k)}
          onReset={reset(k)}
        />
        {mode === 'fixed' && typeof value === 'object' && !('percent' in value) && (
          <DimensionInput label={labels.pageTemplatesSizeValue} value={value} onChange={(d) => set({ [k]: d })} isDefault={!has(k)} onReset={reset(k)} />
        )}
        {mode === 'percent' && typeof value === 'object' && 'percent' in value && (
          <NumberInput label={labels.pageTemplatesSizeValue} value={value.percent} min={1} max={100} step={1} suffix="%" onChange={(n) => set({ [k]: { percent: n } })} isDefault={!has(k)} onReset={reset(k)} />
        )}
      </>
    );
  };
  const limit = (k: 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight', label: string) => (
    <DimensionInput label={label} value={frame[k] ?? MM0} onChange={(d) => set({ [k]: d })} isDefault={!has(k)} onReset={reset(k)} tooltip={labels.pageTemplatesLimitTooltip} />
  );

  const fit = frame.fit;
  const overflow = frame.overflow;
  const continueOptions = [
    { value: '', label: labels.pageTemplatesContinueNone },
    { value: 'next-page', label: labels.pageTemplatesContinueNextPage },
    ...others.map((n) => ({ value: `#${n}`, label: labels.pageTemplatesAnchorFrame.replace('__name__', n) })),
    ...templates.filter((t) => t.id !== templateId).map((t) => ({ value: `template:${t.id}`, label: labels.pageTemplatesContinueTemplate.replace('__name__', t.name || t.id) })),
  ];
  const markMode = overflow.mark === undefined ? 'default' : overflow.mark === false ? 'none' : 'custom';

  return (
    <div className="mt-2 rounded border p-2" style={{ borderColor: 'var(--rule)' }} data-frame={name}>
      {drag && (
        <p role="status" className="mb-1.5 rounded px-1.5 py-1 text-[0.7rem] text-(--brand)" style={{ backgroundColor: 'var(--surface)' }}>
          {labels.selectionFrameDrag
            .replace('__x__', mmOf(drag.rect.x))
            .replace('__y__', mmOf(drag.rect.y))
            .replace('__w__', mmOf(drag.rect.width))
            .replace('__h__', mmOf(drag.rect.height))}
        </p>
      )}
      <FieldGroup title={labels.pageTemplatesFrameGroupIdentity}>
        <FieldRow stacked label={labels.pageTemplatesFrameName} tooltip={labels.pageTemplatesFrameNameTooltip} hint={labels.pageTemplatesFrameNameHint}>
          <TextControl
            value={nameDraft}
            onChange={setNameDraft}
            onBlur={commitName}
            ariaLabel={labels.pageTemplatesFrameName}
            widthCh={18}
          />
        </FieldRow>
        <ToggleSwitch label={labels.pageTemplatesFrameOptional} tooltip={labels.pageTemplatesFrameOptionalTooltip} checked={frame.optional} onChange={(v) => set({ optional: v })} isDefault={!has('optional')} onReset={reset('optional')} />
      </FieldGroup>

      <FieldGroup title={labels.pageTemplatesFrameGroupPosition} description={labels.pageTemplatesFrameGroupPositionDescription}>
        {template.grid && (
          <ToggleSwitch
            label={labels.pageTemplatesFrameUseGrid}
            tooltip={labels.pageTemplatesFrameUseGridTooltip}
            checked={!!frame.grid}
            onChange={(v) => set({ grid: v ? { col: 1, row: 1, cols: 1, rows: 1 } : undefined })}
            isDefault={!has('grid')}
            onReset={reset('grid')}
          />
        )}
        {frame.grid && template.grid ? (
          <>
            <NumberInput label={labels.pageTemplatesGridColumn} value={frame.grid.col} min={1} max={template.grid.columns} onChange={(n) => set({ grid: { ...frame.grid, col: n } })} isDefault={!has('grid')} />
            <NumberInput label={labels.pageTemplatesGridRow} value={frame.grid.row} min={1} max={template.grid.rows} onChange={(n) => set({ grid: { ...frame.grid, row: n } })} isDefault={!has('grid')} />
            <NumberInput label={labels.pageTemplatesGridColumnSpan} value={frame.grid.cols} min={1} max={template.grid.columns} onChange={(n) => set({ grid: { ...frame.grid, cols: n } })} isDefault={!has('grid')} />
            <NumberInput label={labels.pageTemplatesGridRowSpan} value={frame.grid.rows} min={1} max={template.grid.rows} onChange={(n) => set({ grid: { ...frame.grid, rows: n } })} isDefault={!has('grid')} />
          </>
        ) : (
          <>
            <SelectInput label={labels.headerFooterElementAnchorTo} value={anchorTo} options={anchorOptions} onChange={onAnchor} tooltip={labels.pageTemplatesAnchorTooltip} isDefault={!has('placement')} onReset={reset('placement')} />
            {placement && (
              <>
                <SelectInput
                  label={toFrame ? labels.headerFooterElementEdge : labels.headerFooterFrameEdge}
                  value={placement.anchor.edge}
                  options={edges.map((e) => ({ value: e, label: edgeLabel[e] ?? e }))}
                  onChange={(v) => setPlacement({ ...placement, anchor: { ...placement.anchor, edge: v as AnchorEdge } })}
                  tooltip={labels.pageTemplatesEdgeTooltip}
                  isDefault={!has('placement')}
                  onReset={reset('placement')}
                />
                <DimensionInput
                  label={labels.headerFooterElementOffsetX}
                  value={placement.offset?.x ?? MM0}
                  min={-2000}
                  onChange={(d) => setPlacement({ ...placement, offset: { x: d, y: placement.offset?.y ?? MM0 } })}
                  tooltip={labels.headerFooterElementOffsetXTooltip}
                  isDefault={!has('placement')}
                  onReset={reset('placement')}
                />
                <DimensionInput
                  label={labels.headerFooterElementOffsetY}
                  value={placement.offset?.y ?? MM0}
                  min={-2000}
                  onChange={(d) => setPlacement({ ...placement, offset: { x: placement.offset?.x ?? MM0, y: d } })}
                  tooltip={labels.headerFooterElementOffsetYTooltip}
                  isDefault={!has('placement')}
                  onReset={reset('placement')}
                />
              </>
            )}
          </>
        )}
      </FieldGroup>

      <FieldGroup title={labels.pageTemplatesFrameGroupSize}>
        {sizeField('width', labels.pageTemplatesWidth, labels.pageTemplatesWidthTooltip)}
        {sizeField('height', labels.pageTemplatesHeight, labels.pageTemplatesHeightTooltip)}
        {limit('minWidth', labels.pageTemplatesMinWidth)}
        {limit('maxWidth', labels.pageTemplatesMaxWidth)}
        {limit('minHeight', labels.pageTemplatesMinHeight)}
        {limit('maxHeight', labels.pageTemplatesMaxHeight)}
      </FieldGroup>

      <FieldGroup title={labels.pageTemplatesFrameGroupLook}>
        <SelectInput
          label={labels.pageTemplatesFrameStyle}
          value={frame.style ?? ''}
          options={[{ value: '', label: labels.pageTemplatesFrameStyleNone }, ...styles.map((s) => ({ value: s.id, label: s.name || s.id }))]}
          onChange={(v) => set({ style: v || undefined })}
          tooltip={labels.pageTemplatesFrameStyleTooltip}
          isDefault={!has('style')}
          onReset={reset('style')}
        />
        <NumberInput label={labels.pageTemplatesFrameLayer} value={frame.layer} min={-10} max={10} onChange={(n) => set({ layer: n })} tooltip={labels.pageTemplatesFrameLayerTooltip} isDefault={!has('layer')} onReset={reset('layer')} />
        <NumberInput label={labels.pageTemplatesFrameRotate} value={frame.rotate} min={-180} max={180} suffix="°" onChange={(n) => set({ rotate: n })} tooltip={labels.pageTemplatesFrameRotateTooltip} isDefault={!has('rotate')} onReset={reset('rotate')} />
        <SelectInput
          label={labels.pageTemplatesFrameVerticalAlign}
          value={frame.verticalAlign}
          options={[
            { value: 'top', label: labels.pageTemplatesAlignTop },
            { value: 'middle', label: labels.pageTemplatesAlignMiddle },
            { value: 'bottom', label: labels.pageTemplatesAlignBottom },
            { value: 'justify', label: labels.pageTemplatesAlignJustify },
          ]}
          onChange={(v) => set({ verticalAlign: v })}
          tooltip={labels.pageTemplatesFrameVerticalAlignTooltip}
          isDefault={!has('verticalAlign')}
          onReset={reset('verticalAlign')}
        />
        <NumberInput label={labels.pageTemplatesFrameColumns} value={frame.columns} min={1} max={6} onChange={(n) => set({ columns: n })} isDefault={!has('columns')} onReset={reset('columns')} />
        {frame.columns > 1 && (
          <DimensionInput label={labels.pageTemplatesFrameColumnGap} value={frame.columnGap ?? MM0} onChange={(d) => set({ columnGap: d })} isDefault={!has('columnGap')} onReset={reset('columnGap')} />
        )}
        {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <DimensionInput
            key={side}
            label={labels[side === 'top' ? 'pageTemplatesPaddingTop' : side === 'right' ? 'pageTemplatesPaddingRight' : side === 'bottom' ? 'pageTemplatesPaddingBottom' : 'pageTemplatesPaddingLeft']}
            value={(frame.padding as Record<string, Dimension> | undefined)?.[side] ?? MM0}
            onChange={(d) => setIn('padding', side, d)}
            tooltip={labels.pageTemplatesPaddingTooltip}
            isDefault={!hasIn('padding', side)}
            onReset={() => setIn('padding', side, undefined)}
          />
        ))}
      </FieldGroup>

      <FieldGroup title={labels.pageTemplatesFrameGroupContent}>
        <ToggleSwitch label={labels.pageTemplatesFrameFlow} tooltip={labels.pageTemplatesFrameFlowTooltip} checked={frame.flow} onChange={(v) => set({ flow: v })} isDefault={!has('flow')} onReset={reset('flow')} />
        <SelectInput
          label={labels.pageTemplatesFrameTakes}
          value={frame.takes ?? ''}
          options={[{ value: '', label: labels.pageTemplatesFrameTakesNone }, ...(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((h) => ({ value: h, label: labels.pageTemplatesFrameTakesLevel.replace('__level__', h.slice(1)) }))]}
          onChange={(v) => set({ takes: v || undefined })}
          tooltip={labels.pageTemplatesFrameTakesTooltip}
          isDefault={!has('takes')}
          onReset={reset('takes')}
        />
        <SelectInput
          label={labels.pageTemplatesFrameNext}
          value={frame.next ?? ''}
          options={[{ value: '', label: labels.pageTemplatesFrameNextNone }, ...others.map((n) => ({ value: n, label: n }))]}
          onChange={(v) => set({ next: v || undefined })}
          tooltip={labels.pageTemplatesFrameNextTooltip}
          isDefault={!has('next')}
          onReset={reset('next')}
        />
        <ToggleSwitch label={labels.pageTemplatesFramePush} tooltip={labels.pageTemplatesFramePushTooltip} checked={frame.exclude === 'push'} onChange={(v) => set({ exclude: v ? 'push' : 'none' })} isDefault={!has('exclude')} onReset={reset('exclude')} />
        {/* What a pushing frame pushes with (#883): its box, or the shape
            of the pictures it holds. */}
        {frame.exclude === 'push' && (
          <SelectInput
            variant="segmented"
            label={labels.pageTemplatesFrameWrap}
            tooltip={labels.pageTemplatesFrameWrapTooltip}
            value={frame.wrap ?? 'box'}
            options={[
              { value: 'box', label: labels.pageTemplatesFrameWrapBox },
              { value: 'contour', label: labels.resourceWrapContour },
            ]}
            onChange={(v) => set({ wrap: v === 'contour' ? 'contour' : 'box' })}
            isDefault={!has('wrap')}
            onReset={reset('wrap')}
          />
        )}
        {template.spread && (
          <ToggleSwitch label={labels.pageTemplatesFrameCrossGutter} tooltip={labels.pageTemplatesFrameCrossGutterTooltip} checked={frame.crossGutter} onChange={(v) => set({ crossGutter: v })} isDefault={!has('crossGutter')} onReset={reset('crossGutter')} />
        )}
      </FieldGroup>

      <FieldGroup title={labels.pageTemplatesFrameGroupFit} description={labels.pageTemplatesFrameGroupFitDescription}>
        <ToggleSwitch label={labels.pageTemplatesFitShrinkText} checked={fit.shrinkText} onChange={(v) => setIn('fit', 'shrinkText', v)} isDefault={!hasIn('fit', 'shrinkText')} onReset={() => setIn('fit', 'shrinkText', undefined)} />
        <NumberInput label={labels.pageTemplatesFitMinScale} value={Math.round(fit.minScale * 100)} min={50} max={100} suffix="%" onChange={(n) => setIn('fit', 'minScale', n / 100)} tooltip={labels.pageTemplatesFitMinScaleTooltip} isDefault={!hasIn('fit', 'minScale')} onReset={() => setIn('fit', 'minScale', undefined)} />
        <ToggleSwitch label={labels.pageTemplatesFitScaleImages} checked={fit.scaleImages} onChange={(v) => setIn('fit', 'scaleImages', v)} isDefault={!hasIn('fit', 'scaleImages')} onReset={() => setIn('fit', 'scaleImages', undefined)} />
        <NumberInput label={labels.pageTemplatesFitImageMinScale} value={Math.round(fit.imageMinScale * 100)} min={30} max={100} suffix="%" onChange={(n) => setIn('fit', 'imageMinScale', n / 100)} isDefault={!hasIn('fit', 'imageMinScale')} onReset={() => setIn('fit', 'imageMinScale', undefined)} />
        <ToggleSwitch label={labels.pageTemplatesFitPreferContinue} tooltip={labels.pageTemplatesFitPreferContinueTooltip} checked={fit.preferContinue} onChange={(v) => setIn('fit', 'preferContinue', v)} isDefault={!hasIn('fit', 'preferContinue')} onReset={() => setIn('fit', 'preferContinue', undefined)} />
      </FieldGroup>

      <FieldGroup title={labels.pageTemplatesFrameGroupGroups} description={labels.pageTemplatesFrameGroupGroupsDescription}>
        <NumberInput label={labels.pageTemplatesFrameGrow} value={frame.grow} min={0} max={10} step={0.5} onChange={(n) => set({ grow: n })} tooltip={labels.pageTemplatesFrameGrowTooltip} isDefault={!has('grow')} onReset={reset('grow')} />
        <NumberInput label={labels.pageTemplatesFrameShrink} value={frame.shrink} min={0} max={10} step={0.5} onChange={(n) => set({ shrink: n })} tooltip={labels.pageTemplatesFrameShrinkTooltip} isDefault={!has('shrink')} onReset={reset('shrink')} />
        <NumberInput label={labels.pageTemplatesFramePriority} value={frame.priority} min={-10} max={10} onChange={(n) => set({ priority: n })} tooltip={labels.pageTemplatesFramePriorityTooltip} isDefault={!has('priority')} onReset={reset('priority')} />
        <ToggleSwitch label={labels.pageTemplatesFramePin} tooltip={labels.pageTemplatesFramePinTooltip} checked={frame.pin} onChange={(v) => set({ pin: v })} isDefault={!has('pin')} onReset={reset('pin')} />
      </FieldGroup>

      <FieldGroup title={labels.pageTemplatesFrameGroupContinuation}>
        <SelectInput
          label={labels.pageTemplatesContinueIn}
          value={overflow.continueIn ?? ''}
          options={continueOptions.some((o) => o.value === (overflow.continueIn ?? '')) ? continueOptions : [...continueOptions, { value: overflow.continueIn!, label: overflow.continueIn! }]}
          onChange={(v) => setIn('overflow', 'continueIn', v || undefined)}
          tooltip={labels.pageTemplatesContinueInTooltip}
          isDefault={!hasIn('overflow', 'continueIn')}
          onReset={() => setIn('overflow', 'continueIn', undefined)}
        />
        <SelectInput
          label={labels.pageTemplatesMark}
          value={markMode}
          options={[
            { value: 'default', label: labels.pageTemplatesMarkDefault },
            { value: 'none', label: labels.pageTemplatesMarkNone },
            { value: 'custom', label: labels.pageTemplatesMarkCustom },
          ]}
          onChange={(v) => setIn('overflow', 'mark', v === 'default' ? undefined : v === 'none' ? false : (typeof overflow.mark === 'string' ? overflow.mark : '…'))}
          tooltip={labels.pageTemplatesMarkTooltip}
          isDefault={!hasIn('overflow', 'mark')}
          onReset={() => setIn('overflow', 'mark', undefined)}
        />
        {markMode === 'custom' && (
          <FieldRow label={labels.pageTemplatesMarkText}>
            <TextControl value={typeof overflow.mark === 'string' ? overflow.mark : ''} onChange={(v) => setIn('overflow', 'mark', v)} ariaLabel={labels.pageTemplatesMarkText} widthCh={14} />
          </FieldRow>
        )}
        <FieldRow label={labels.pageTemplatesFromMark} tooltip={labels.pageTemplatesFromMarkTooltip}>
          <TextControl value={overflow.fromMark ?? ''} onChange={(v) => setIn('overflow', 'fromMark', v.trim() === '' ? undefined : v)} ariaLabel={labels.pageTemplatesFromMark} widthCh={14} />
        </FieldRow>
      </FieldGroup>

      <ConfirmPopover message={labels.pageTemplatesFrameDeleteConfirm.replace('__name__', name)} onConfirm={() => { write(removeFrame(templates, templateId, scope, name)); onRemoved(); }}>
        {({ open }) => (
          <Button variant="ghost" size="xs" icon={<Trash2 size={12} aria-hidden="true" />} onClick={open} className="mt-1">
            {labels.pageTemplatesFrameDelete}
          </Button>
        )}
      </ConfirmPopover>
    </div>
  );
}
