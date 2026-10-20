'use client';

import { useSandboxLabels } from '../../../context/SandboxContext';
import type { AnchorEdge, DesignElement, Dimension, ElementPlacement, HAlign, PageRoleFilter } from 'postext';
import { DimensionInput, SelectInput } from '../../../controls';
import {
  type SlotKind,
  CONTAINER_EDGES,
  LOGICAL_CONTAINER_EDGES,
  LOGICAL_ELEMENT_EDGES,
  alignForElementEdge,
  alignFromPlacement,
  anchorTargetId,
  applyAlign,
  type PlacementAlign,
  applyAnchorTarget,
  applyElementEdge,
  applyOffsetX,
  applyOffsetY,
  isElementAnchor,
  isPageFrameAnchor,
} from './placementAdapter';

const ZERO: Dimension = { value: 0, unit: 'pt' };

export interface Sibling {
  id: string;
  kind: DesignElement['kind'];
  index: number;
}

interface PlacementFieldsProps {
  placement: ElementPlacement;
  slotKind: SlotKind;
  siblings?: Sibling[];
  /** `impliedAlign` is set when an element-to-element edge suggests a text
   *  alignment (text elements apply it to their `align`). */
  onChange: (placement: ElementPlacement, impliedAlign?: HAlign) => void;
}

/** Anchor controls shared by the text, rule and box editors: the target
 *  picker (container / page / bleed / sibling element) followed by the
 *  fields that make sense for that target — relative edge and offsets for
 *  element and page-frame anchors, a simple alignment for the container. */
export function PlacementFields({ placement, slotKind, siblings = [], onChange }: PlacementFieldsProps) {
  const labels = useSandboxLabels();
  const anchoredToElement = isElementAnchor(placement);
  const anchoredToFrame = isPageFrameAnchor(placement);

  const kindLabel = (kind: Sibling['kind']): string =>
    kind === 'text'
      ? labels.headerFooterElementText
      : kind === 'rule'
        ? labels.headerFooterElementRule
        : kind === 'image'
          ? labels.headerFooterElementImage
          : labels.headerFooterElementBox;

  const targetOptions = [
    { value: 'container', label: labels.headerFooterElementAnchorContainer },
    { value: 'page', label: labels.headerFooterAnchorToPage },
    { value: 'bleed', label: labels.headerFooterAnchorToBleed },
    // The fore-edge: running heads and folios only.
    ...(slotKind === 'header' || slotKind === 'footer' ? [{ value: 'outer', label: labels.headerFooterAnchorToOuter }] : []),
    ...siblings.map((s) => ({ value: s.id, label: `${kindLabel(s.kind)} #${s.index + 1}` })),
  ];

  const ELEMENT_EDGE_OPTIONS: { value: AnchorEdge; label: string }[] = [
    { value: 'right-of', label: labels.headerFooterElementEdgeRightOf },
    { value: 'left-of', label: labels.headerFooterElementEdgeLeftOf },
    { value: 'below', label: labels.headerFooterElementEdgeBelow },
    { value: 'above', label: labels.headerFooterElementEdgeAbove },
    { value: 'align-top', label: labels.headerFooterElementEdgeAlignTop },
    { value: 'align-bottom', label: labels.headerFooterElementEdgeAlignBottom },
    { value: 'align-left', label: labels.headerFooterElementEdgeAlignLeft },
    { value: 'align-right', label: labels.headerFooterElementEdgeAlignRight },
    // The page's start and end sides (#936).
    ...LOGICAL_ELEMENT_EDGES.map((edge) => ({ value: edge, label: edge === 'align-start' ? labels.headerFooterElementEdgeAlignStart : labels.headerFooterElementEdgeAlignEnd })),
  ];

  const FRAME_EDGE_LABELS: Record<string, string> = {
    'top-left': labels.headerFooterFrameEdgeTopLeft,
    top: labels.headerFooterFrameEdgeTop,
    'top-right': labels.headerFooterFrameEdgeTopRight,
    left: labels.headerFooterFrameEdgeLeft,
    center: labels.headerFooterFrameEdgeCenter,
    right: labels.headerFooterFrameEdgeRight,
    'bottom-left': labels.headerFooterFrameEdgeBottomLeft,
    bottom: labels.headerFooterFrameEdgeBottom,
    'bottom-right': labels.headerFooterFrameEdgeBottomRight,
    'top-start': labels.headerFooterFrameEdgeTopStart,
    start: labels.headerFooterFrameEdgeStart,
    'bottom-start': labels.headerFooterFrameEdgeBottomStart,
    'top-end': labels.headerFooterFrameEdgeTopEnd,
    end: labels.headerFooterFrameEdgeEnd,
    'bottom-end': labels.headerFooterFrameEdgeBottomEnd,
  };
  const FRAME_EDGE_OPTIONS = [...CONTAINER_EDGES, ...LOGICAL_CONTAINER_EDGES].map((edge) => ({
    value: edge,
    label: FRAME_EDGE_LABELS[edge] ?? edge,
  }));

  const ALIGN_OPTIONS = [
    { value: 'left', label: labels.headerFooterElementAlignLeft },
    { value: 'center', label: labels.headerFooterElementAlignCenter },
    { value: 'right', label: labels.headerFooterElementAlignRight },
    // The page's start and end sides: the right and the left of a
    // right-to-left page (#936).
    { value: 'start', label: labels.headerFooterElementAlignStart },
    { value: 'end', label: labels.headerFooterElementAlignEnd },
  ];

  const offsetFields = (
    <>
      <DimensionInput
        label={labels.headerFooterElementOffsetX}
        value={placement.offset?.x ?? ZERO}
        onChange={(dim: Dimension) => onChange(applyOffsetX(placement, dim))}
        min={-2000}
        step={1}
        tooltip={labels.headerFooterElementOffsetXTooltip}
      />
      <DimensionInput
        label={labels.headerFooterElementOffsetY}
        value={placement.offset?.y ?? ZERO}
        onChange={(dim: Dimension) => onChange(applyOffsetY(placement, dim))}
        min={-2000}
        step={1}
        tooltip={labels.headerFooterElementOffsetYTooltip}
      />
    </>
  );

  return (
    <>
      <SelectInput
        label={labels.headerFooterElementAnchorTo}
        value={anchorTargetId(placement)}
        options={targetOptions}
        onChange={(v) => {
          const next = applyAnchorTarget(placement, slotKind, v);
          onChange(next, isElementAnchor(next) ? alignForElementEdge(next.anchor.edge) : undefined);
        }}
        tooltip={labels.headerFooterElementAnchorToTooltip}
      />
      {anchoredToElement ? (
        <>
          <SelectInput
            label={labels.headerFooterElementEdge}
            value={placement.anchor.edge}
            options={ELEMENT_EDGE_OPTIONS}
            onChange={(v) => {
              const edge = v as AnchorEdge;
              onChange(applyElementEdge(placement, edge), alignForElementEdge(edge));
            }}
            tooltip={labels.headerFooterElementEdgeTooltip}
          />
          {offsetFields}
        </>
      ) : anchoredToFrame ? (
        <>
          <SelectInput
            label={labels.headerFooterFrameEdge}
            value={placement.anchor.edge}
            options={FRAME_EDGE_OPTIONS}
            onChange={(v) => onChange(applyElementEdge(placement, v as AnchorEdge))}
            tooltip={labels.headerFooterFrameEdgeTooltip}
          />
          {offsetFields}
        </>
      ) : (
        <SelectInput
          label={labels.headerFooterElementAlign}
          value={alignFromPlacement(placement)}
          options={ALIGN_OPTIONS}
          onChange={(v) => onChange(applyAlign(placement, slotKind, v as PlacementAlign))}
          tooltip={labels.headerFooterElementAlignTooltip}
        />
      )}
    </>
  );
}

interface PagesSelectProps {
  value: PageRoleFilter | undefined;
  onChange: (next: PageRoleFilter | undefined) => void;
}

/** The `pages` role filter of a design element (`all` when unset). */
export function PagesSelect({ value, onChange }: PagesSelectProps) {
  const labels = useSandboxLabels();
  const options = [
    { value: 'all', label: labels.headerFooterElementPagesAll },
    { value: 'body', label: labels.headerFooterElementPagesBody },
    { value: 'opener', label: labels.headerFooterElementPagesOpener },
    { value: 'part', label: labels.headerFooterElementPagesPart },
    { value: 'blank', label: labels.headerFooterElementPagesBlank },
  ];
  return (
    <SelectInput
      label={labels.headerFooterElementPages}
      value={value ?? 'all'}
      options={options}
      onChange={(v) => onChange(v === 'all' ? undefined : (v as PageRoleFilter))}
      tooltip={labels.headerFooterElementPagesTooltip}
      isDefault={value === undefined || value === 'all'}
      onReset={() => onChange(undefined)}
    />
  );
}
