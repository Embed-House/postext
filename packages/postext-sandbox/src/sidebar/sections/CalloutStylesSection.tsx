'use client';

import { memo, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import type {
  AnchorEdge,
  CalloutBodyStyleConfig,
  CalloutBorderConfig,
  CalloutDesignConfig,
  CalloutFixedConfig,
  CalloutIconAlign,
  CalloutIconConfig,
  CalloutIconCornerSide,
  CalloutIconKind,
  CalloutIconPosition,
  CalloutIconShape,
  CalloutLabelConfig,
  CalloutLabelIconKind,
  CalloutListStyleConfig,
  CalloutMarkerTextAlign,
  CalloutMarkerConfig,
  CalloutMarkerRuleConfig,
  CalloutPaddingConfig,
  CalloutPlacement,
  CalloutSideAtColumnEnd,
  CalloutSpan,
  CalloutStripeConfig,
  CalloutStripeSide,
  CalloutStyleConfig,
  CalloutTextTransform,
  CalloutTitleStyleConfig,
  CalloutWidth,
  ColorValue,
  DesignSlot,
  Dimension,
  DimensionUnit,
  ElementAnchor,
  Resource,
  ResolvedCalloutStyleConfig,
} from 'postext';
import {
  DEFAULT_CALLOUT_STYLES,
  calloutStyleChain,
  inheritCalloutStyles,
  resolveBodyTextConfig,
  resolveCalloutStylesConfig,
  resolveDesignSlot,
  resolveHeadingsConfig,
  resolveUnorderedListsConfig,
  uniformRadius,
} from 'postext';
import {
  useSandboxDispatch,
  useSandboxLabels,
  useSandboxResources,
  useSandboxSelector,
} from '../../context/SandboxContext';
import {
  CollapsibleSection,
  ItemCard,
  ItemCardListActions,
  moveCardState,
  openCard,
  ColorPicker,
  DimensionInput,
  FontPicker,
  NestedGroup,
  NumberInput,
  SelectInput,
  TextInput,
  ToggleSwitch,
} from '../../controls';
import { Button, ConfirmPopover, IconButton, cn } from '../../ui';
import { useFieldIds } from '../../controls/fieldContext';
import { FieldRow } from '../../controls/FieldRow';
import { SearchScope } from '../search/SearchScope';
import { CONTAINER_EDGES } from './HeaderFooterSection/placementAdapter';
import { BorderSidesFields, CornerRadiusFields } from './HeaderFooterSection/shapeFields';
import { SlotEditor } from './HeaderFooterSection/SlotEditor';
import { flowSideLabels, useRightToLeftFlow } from '../settings/flowSides';
import { hasSeveralColumns } from '../settings/multiColumnBook';
import { MULTIPLE_COLUMNS_MAX } from '../settings/multipleColumns';
import { TabStopsField } from '../settings/TabStopsField';
import { ParagraphSpacingField } from '../settings/ParagraphSpacingField';
import { useBookTexts } from '../../frameStyles/useBookTexts';
import { planRename } from '../../frameStyles/styleMerge';
import { applyStyleRewrite } from '../../frameStyles/applyRewrite';

const FONT_SIZE_UNITS: DimensionUnit[] = ['pt', 'px', 'em', 'rem'];
const LINE_HEIGHT_UNITS: DimensionUnit[] = ['em', 'pt', 'px'];
const SPACING_UNITS: DimensionUnit[] = ['em', 'pt', 'px'];
const STROKE_UNITS: DimensionUnit[] = ['pt', 'px', 'mm'];
const OFFSET_UNITS: DimensionUnit[] = ['mm', 'pt', 'px', 'em'];
const TRACKING_UNITS: DimensionUnit[] = ['pt', 'em', 'px'];
const MIN_HEIGHT_UNITS: DimensionUnit[] = ['pt', 'mm', 'cm', 'in', 'em', 'px'];
const ZERO_PT: Dimension = { value: 0, unit: 'pt' };

const inputClass = 'min-w-0 flex-1 rounded border bg-transparent px-1.5 py-1 text-xs';
const inputStyle = { borderColor: 'var(--pt-control-border)', color: 'var(--foreground)' } as const;

/** Turn free text into a `:::callout{type="…"}`-friendly id. */
function slugifyStyleId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function nextStyleId(existing: CalloutStyleConfig[]): string {
  const taken = new Set(existing.map((s) => s.id));
  let n = existing.length + 1;
  while (taken.has(`callout-${n}`)) n++;
  return `callout-${n}`;
}

/** Sub-objects of a callout style that are edited field by field. */
type Group = 'border' | 'padding' | 'stripe' | 'icon' | 'label' | 'marker' | 'titleStyle' | 'body' | 'lists';
type GroupConfig<G extends Group> = NonNullable<CalloutStyleConfig[G]>;

function iconLabel(r: Resource): string {
  const text = r.caption?.trim();
  return text ? `${text} (${r.id})` : r.id;
}

interface FieldProps {
  label: string;
  tooltip?: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, tooltip, hint, children }: FieldProps) {
  return (
    <FieldRow stacked label={label} tooltip={tooltip} hint={hint} className="mb-0">
      {children}
    </FieldRow>
  );
}

function CardButton({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return <IconButton label={label} icon={children} onClick={onClick} destructive={destructive} />;
}

/** What the joined switch writes (#1063): a joined tab stands on the
 *  edge, so turning it on takes a rise off (the engine reads none and
 *  warns about one). */
export function joinedTabPatch(joined: boolean): Partial<CalloutLabelConfig> {
  return joined ? { joined: true, offset: { value: 0, unit: 'pt' } } : { joined: false };
}

/** The symbols the tab's glyph picker offers (#1066); any other character
 *  is typed in the glyph field. */
export const COMMON_TAB_GLYPHS = ['◉', '●', '○', '■', '□', '▲', '★', '✓', '✎', '➜'] as const;

/** What switching a tab icon's kind writes (#1066): the kind, and for a
 *  glyph tab with no glyph yet the first common symbol, so the switch
 *  shows one at once. */
export function labelIconKindPatch(icon: CalloutLabelConfig['icon'], kind: CalloutLabelIconKind): Partial<NonNullable<CalloutLabelConfig['icon']>> {
  return kind === 'glyph' && !icon?.glyph ? { kind, glyph: COMMON_TAB_GLYPHS[0] } : { kind };
}

/** A row of common symbols for a tab's glyph: a click sets it. Each is a
 *  button named «Use ◉» and pressed when it is the glyph set. */
function GlyphPicker({ label, useLabel, value, onPick }: { label: string; useLabel: string; value: string; onPick: (glyph: string) => void }) {
  return (
    <FieldRow stacked label={label}>
      <GlyphButtons label={label} useLabel={useLabel} value={value} onPick={onPick} />
    </FieldRow>
  );
}

function GlyphButtons({ label, useLabel, value, onPick }: { label: string; useLabel: string; value: string; onPick: (glyph: string) => void }) {
  const ids = useFieldIds();
  return (
    <div id={ids?.controlId} role="group" aria-label={label} className="flex flex-wrap gap-1" data-glyph-picker="">
      {COMMON_TAB_GLYPHS.map((g) => (
        <button
          key={g}
          type="button"
          aria-label={useLabel.replace('__glyph__', g)}
          aria-pressed={value === g}
          onClick={() => onPick(g)}
          className={cn(
            'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded border text-sm leading-none transition-colors pt-large:h-11 pt-large:w-11',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 outline-(--brand)',
            value === g ? 'border-(--brand) bg-(--brand) text-(--background)' : 'border-(--rule) bg-transparent text-(--foreground) hover:bg-(--surface)',
          )}
        >
          <span aria-hidden="true">{g}</span>
        </button>
      ))}
    </div>
  );
}

/** A picture painted in one colour (#995, #1120): a switch, and the
 *  colour it is painted in (`ownColor` until one is picked). */
function TintFields({ tint, ownColor, update, isDefault, onReset, fieldId, toggleLabel, toggleTooltip }: {
  tint: boolean | ColorValue | undefined;
  ownColor: ColorValue;
  update: (tint: boolean | ColorValue) => void;
  isDefault: boolean;
  onReset: () => void;
  fieldId: string;
  toggleLabel: string;
  toggleTooltip: string;
}) {
  const labels = useSandboxLabels();
  const on = tint === true || (typeof tint === 'object' && tint !== null);
  return (
    <>
      <ToggleSwitch
        label={toggleLabel}
        checked={on}
        onChange={(v) => update(v)}
        tooltip={toggleTooltip}
        isDefault={isDefault}
        onReset={onReset}
      />
      {on && (
        <ColorPicker
          label={labels.calloutStyleIconTintColor}
          tooltip={labels.calloutStyleIconTintColorTooltip}
          value={typeof tint === 'object' ? tint : ownColor}
          onChange={(v) => update(v)}
          isDefault={tint === true}
          onReset={() => update(true)}
          fieldId={fieldId}
        />
      )}
    </>
  );
}

/** A drawn ring or dot (#1120): which, and the ring's line. */
function ShapeFields({ shape, strokeWidth, sizeForDefault, update, isDefault, onReset }: {
  shape: CalloutIconShape;
  strokeWidth: Dimension | undefined;
  sizeForDefault: Dimension;
  update: (partial: { shape?: CalloutIconShape; strokeWidth?: Dimension }) => void;
  isDefault: (field: 'shape' | 'strokeWidth') => boolean;
  onReset: (field: 'shape' | 'strokeWidth') => void;
}) {
  const labels = useSandboxLabels();
  return (
    <>
      <SelectInput
        label={labels.calloutStyleIconShape}
        value={shape}
        options={[
          { value: 'ring', label: labels.calloutStyleIconShapeRing },
          { value: 'dot', label: labels.calloutStyleIconShapeDot },
        ]}
        onChange={(v) => update({ shape: v as CalloutIconShape })}
        tooltip={labels.calloutStyleIconShapeTooltip}
        isDefault={isDefault('shape')}
        onReset={() => onReset('shape')}
      />
      {shape === 'ring' && (
        <DimensionInput
          label={labels.calloutStyleIconStrokeWidth}
          value={strokeWidth ?? { value: sizeForDefault.value / 8, unit: sizeForDefault.unit }}
          onChange={(v) => update({ strokeWidth: v })}
          min={0}
          step={0.05}
          units={SPACING_UNITS}
          tooltip={labels.calloutStyleIconStrokeWidthTooltip}
          isDefault={isDefault('strokeWidth')}
          onReset={() => onReset('strokeWidth')}
        />
      )}
    </>
  );
}

/** The fields the icon and the marker share; the position fields exist on
 *  the in-box icon only (the marker always sits in its own column). */
type IconSpec = Pick<ResolvedCalloutStyleConfig['icon'], 'kind' | 'glyph' | 'resourceId' | 'fontFamily' | 'fontWeight' | 'size' | 'color' | 'align'> &
  Partial<Pick<ResolvedCalloutStyleConfig['icon'], 'position' | 'cornerSide' | 'width' | 'shape' | 'strokeWidth' | 'tint'>>;
type IconField = keyof CalloutIconConfig;

interface IconFieldsProps {
  /** Resolved icon (or marker) spec the controls display. */
  value: IconSpec;
  kindLabel: string;
  kindTooltip: string;
  update: (partial: Partial<CalloutIconConfig>) => void;
  isDefault: (field: IconField) => boolean;
  onReset: (field: IconField) => void;
  fieldId: string;
  iconResources: Resource[];
  /** Show the inline / corner position controls (in-box icon only). */
  withPosition?: boolean;
}

/** Kind / glyph / resource / size / alignment controls shared by the in-box
 *  icon and the marker (the same `CalloutIconConfig` shape). */
function IconFields({ value, kindLabel, kindTooltip, update, isDefault, onReset, fieldId, iconResources, withPosition }: IconFieldsProps) {
  const labels = useSandboxLabels();
  const side = flowSideLabels(useRightToLeftFlow(), labels.sideColumnSideLeft, labels.sideColumnSideRight);
  const kindOptions = [
    { value: 'none', label: labels.calloutStyleIconKindNone },
    { value: 'glyph', label: labels.calloutStyleIconKindGlyph },
    { value: 'resource', label: labels.calloutStyleIconKindResource },
    { value: 'shape', label: labels.calloutStyleIconKindShape },
  ];
  const alignOptions = [
    { value: 'top', label: labels.calloutStyleIconAlignTop },
    { value: 'center', label: labels.calloutStyleIconAlignCenter },
  ];
  const positionOptions = [
    { value: 'inline', label: labels.calloutStyleIconPositionInline },
    { value: 'corner', label: labels.calloutStyleIconPositionCorner },
  ];
  // Left and right are the body flow's sides; start and end the box's own
  // (an English box in an Arabic book has its start on the left).
  const cornerSideOptions = [
    { value: 'right', label: side.right },
    { value: 'left', label: side.left },
    { value: 'outer', label: labels.sideColumnSideOuter },
    { value: 'inner', label: labels.sideColumnSideInner },
    { value: 'start', label: labels.sideTextStart },
    { value: 'end', label: labels.sideTextEnd },
  ];
  const resourceOptions = [
    { value: '', label: labels.calloutStyleIconResourceNone },
    ...iconResources.map((r) => ({ value: r.id, label: iconLabel(r) })),
  ];
  // Keep a dangling resource id selectable so the picker never shows a
  // value that is not in its option list.
  if (value.resourceId && !iconResources.some((r) => r.id === value.resourceId)) {
    resourceOptions.push({ value: value.resourceId, label: value.resourceId });
  }
  return (
    <>
      <SelectInput
        label={kindLabel}
        value={value.kind}
        options={kindOptions}
        onChange={(v) => update({ kind: v as CalloutIconKind })}
        tooltip={kindTooltip}
        isDefault={isDefault('kind')}
        onReset={() => onReset('kind')}
      />
      {value.kind === 'glyph' && (
        <>
          <TextInput
            label={labels.calloutStyleIconGlyph}
            value={value.glyph}
            onChange={(v) => update({ glyph: v })}
            tooltip={labels.calloutStyleIconGlyphTooltip}
            widthCh={6}
            isDefault={isDefault('glyph')}
            onReset={() => onReset('glyph')}
          />
          <FontPicker
            label={labels.calloutStyleIconFont}
            value={value.fontFamily}
            onChange={(v) => update({ fontFamily: v })}
            isDefault={isDefault('fontFamily')}
            onReset={() => onReset('fontFamily')}
            searchPlaceholder={labels.bodyFontSearch}
            noResultsLabel={labels.bodyFontNoResults}
          />
          <NumberInput
            label={labels.calloutStyleIconWeight}
            value={value.fontWeight}
            onChange={(v) => update({ fontWeight: v })}
            min={100}
            max={900}
            step={10}
            isDefault={isDefault('fontWeight')}
            onReset={() => onReset('fontWeight')}
          />
          <ColorPicker
            label={labels.calloutStyleIconColor}
            value={value.color}
            onChange={(v) => update({ color: v })}
            isDefault={isDefault('color')}
            onReset={() => onReset('color')}
            fieldId={fieldId}
          />
        </>
      )}
      {value.kind === 'resource' && (
        <>
          <SelectInput
            label={labels.calloutStyleIconResource}
            value={value.resourceId}
            options={resourceOptions}
            onChange={(v) => update({ resourceId: v })}
            tooltip={labels.calloutStyleIconResourceTooltip}
            isDefault={isDefault('resourceId')}
            onReset={() => onReset('resourceId')}
          />
          <TintFields
            tint={value.tint}
            ownColor={value.color}
            update={(tint) => update({ tint })}
            isDefault={isDefault('tint')}
            onReset={() => onReset('tint')}
            fieldId={`${fieldId}-tint`}
            toggleLabel={labels.calloutStyleIconTint}
            toggleTooltip={labels.calloutStyleIconTintTooltip}
          />
        </>
      )}
      {value.kind === 'shape' && (
        <>
          <ShapeFields
            shape={value.shape ?? 'ring'}
            strokeWidth={value.strokeWidth}
            sizeForDefault={value.size}
            update={update}
            isDefault={isDefault}
            onReset={onReset}
          />
          <ColorPicker
            label={labels.calloutStyleIconColor}
            value={value.color}
            onChange={(v) => update({ color: v })}
            isDefault={isDefault('color')}
            onReset={() => onReset('color')}
            fieldId={`${fieldId}-shape`}
          />
        </>
      )}
      {value.kind !== 'none' && (
        <>
          <DimensionInput
            label={labels.calloutStyleIconSize}
            value={value.size}
            onChange={(v) => update({ size: v })}
            min={0}
            step={0.1}
            units={SPACING_UNITS}
            isDefault={isDefault('size')}
            onReset={() => onReset('size')}
          />
          <DimensionInput
            label={labels.calloutStyleIconWidth}
            value={value.width ?? value.size}
            onChange={(v) => update({ width: v })}
            min={0}
            step={0.1}
            units={SPACING_UNITS}
            tooltip={labels.calloutStyleIconWidthTooltip}
            isDefault={isDefault('width')}
            onReset={() => onReset('width')}
          />
          {withPosition && (
            <SelectInput
              label={labels.calloutStyleIconPosition}
              value={value.position ?? 'inline'}
              options={positionOptions}
              onChange={(v) => update({ position: v as CalloutIconPosition })}
              tooltip={labels.calloutStyleIconPositionTooltip}
              isDefault={isDefault('position')}
              onReset={() => onReset('position')}
            />
          )}
          {withPosition && value.position === 'corner' ? (
            <SelectInput
              label={labels.calloutStyleIconCornerSide}
              value={value.cornerSide ?? 'right'}
              options={cornerSideOptions}
              onChange={(v) => update({ cornerSide: v as CalloutIconCornerSide })}
              tooltip={labels.calloutStyleIconCornerSideTooltip}
              isDefault={isDefault('cornerSide')}
              onReset={() => onReset('cornerSide')}
            />
          ) : (
            <SelectInput
              label={labels.calloutStyleIconAlign} tooltip={labels.calloutStyleIconAlignTooltip}
              value={value.align}
              options={alignOptions}
              onChange={(v) => update({ align: v as CalloutIconAlign })}
              isDefault={isDefault('align')}
              onReset={() => onReset('align')}
            />
          )}
        </>
      )}
    </>
  );
}

interface CalloutStyleCardProps {
  style: CalloutStyleConfig;
  resolved: ResolvedCalloutStyleConfig;
  otherIds: Set<string>;
  /** The styles this one may be based on (#905): every other style but
   *  those based on it, in list order, with their names. */
  parents: { id: string; name: string }[];
  /** Whether the style is stored in the config (the built-in style shown
   *  while the config has no list is not an override). */
  stored: boolean;
  iconResources: Resource[];
  /** Resolved document list values the optional bullet fields fall back to. */
  listDefaults: { bulletFontSize: Dimension; bulletFontWeight: number; bulletFontFamily: string; marginTop: Dimension; marginBottom: Dimension };
  onChange: (partial: Partial<CalloutStyleConfig>) => void;
  onResetField: (field: keyof CalloutStyleConfig) => void;
  onRename: (nextId: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

/** One callout style. Every control shows the resolved value and offers a
 *  per-field reset while the key is set, so a style only stores what
 *  differs from the built-in defaults (and from the body text, headings and
 *  list sections it inherits from). */
export function CalloutStyleCard({
  style,
  resolved,
  otherIds,
  parents,
  stored,
  iconResources,
  listDefaults,
  onChange,
  onResetField,
  onRename,
  onDuplicate,
  onRemove,
}: CalloutStyleCardProps) {
  const labels = useSandboxLabels();
  const rtl = useRightToLeftFlow();
  const stripeSide = flowSideLabels(rtl, labels.calloutStyleStripeSideLeft, labels.calloutStyleStripeSideRight);
  const labelSide = flowSideLabels(rtl, labels.calloutStyleLabelPositionTopLeft, labels.calloutStyleLabelPositionTopRight);
  const textSide = flowSideLabels(rtl, labels.bodyTextAlignLeft, labels.headingsTextAlignRight);
  const markerSide = flowSideLabels(rtl, labels.headerFooterElementAlignLeft, labels.headerFooterElementAlignRight);
  // Ragged bodies hyphenate too once the body text turns ragged hyphenation on.
  const raggedHyphenation = useSandboxSelector((s) => s.config.bodyText?.hyphenation?.ragged === true);
  // Tab stops of the box (#622): an unset interval is the body's.
  const bodyTabInterval = useSandboxSelector((s) => s.config.bodyText?.tabInterval);
  // A floated box across several columns (#505): offered when a page of the
  // book has more than one, or when the style sets it.
  const severalColumns = useSandboxSelector((s) => hasSeveralColumns(s.config));
  const [idDraft, setIdDraft] = useState(style.id);
  const draftSlug = slugifyStyleId(idDraft);
  const idTaken = draftSlug.length > 0 && draftSlug !== style.id && otherIds.has(draftSlug);
  const idEmpty = draftSlug.length === 0;
  const sectionId = `calloutStyles.${style.id}`;
  const fieldId = `calloutStyle-${style.id}`;

  const commitId = () => {
    if (idEmpty || idTaken) {
      setIdDraft(style.id);
      return;
    }
    setIdDraft(draftSlug);
    if (draftSlug !== style.id) onRename(draftSlug);
  };

  const unset = (field: keyof CalloutStyleConfig) => style[field] === undefined;

  const updateGroup = <G extends Group>(group: G, partial: Partial<GroupConfig<G>>) => {
    const current = (style[group] ?? {}) as GroupConfig<G>;
    onChange({ [group]: { ...current, ...partial } } as Partial<CalloutStyleConfig>);
  };
  const resetGroupField = <G extends Group>(group: G, field: keyof GroupConfig<G>) => {
    const current = style[group] as GroupConfig<G> | undefined;
    if (!current) return;
    const next: Partial<GroupConfig<G>> = { ...current };
    delete next[field];
    if (Object.keys(next).length > 0) onChange({ [group]: next } as Partial<CalloutStyleConfig>);
    else onResetField(group);
  };
  const groupUnset = <G extends Group>(group: G, field: keyof GroupConfig<G>) => {
    const current = style[group] as Partial<GroupConfig<G>> | undefined;
    return current === undefined || current[field] === undefined;
  };

  const border = (partial: Partial<CalloutBorderConfig>) => updateGroup('border', partial);
  const padding = (partial: Partial<CalloutPaddingConfig>) => updateGroup('padding', partial);
  const stripe = (partial: Partial<CalloutStripeConfig>) => updateGroup('stripe', partial);
  const icon = (partial: Partial<CalloutIconConfig>) => updateGroup('icon', partial);
  const marker = (partial: Partial<CalloutMarkerConfig>) => updateGroup('marker', partial);
  /** `marker.rule` is nested one level deeper: merge there and drop the
   *  rule (then the marker) when nothing is left set. */
  const updateMarkerRule = (partial: Partial<CalloutMarkerRuleConfig>) =>
    marker({ rule: { ...style.marker?.rule, ...partial } });
  const resetMarkerRuleField = (field: keyof CalloutMarkerRuleConfig) => {
    const rule: CalloutMarkerRuleConfig = { ...style.marker?.rule };
    delete rule[field];
    if (Object.keys(rule).length > 0) marker({ rule });
    else resetGroupField('marker', 'rule');
  };
  const markerRuleUnset = (field: keyof CalloutMarkerRuleConfig) => style.marker?.rule?.[field] === undefined;
  const label = (partial: Partial<CalloutLabelConfig>) => updateGroup('label', partial);
  /** `label.icon` / `label.rule` are nested one level deeper, like the
   *  marker rule: merge there and drop the sub-object when nothing is left. */
  const updateLabelIcon = (partial: Partial<NonNullable<CalloutLabelConfig['icon']>>) =>
    label({ icon: { ...style.label?.icon, ...partial } });
  const resetLabelIconField = (field: keyof NonNullable<CalloutLabelConfig['icon']>) => {
    const icon = { ...style.label?.icon };
    delete icon[field];
    if (Object.keys(icon).length > 0) label({ icon });
    else resetGroupField('label', 'icon');
  };
  const labelIconUnset = (field: keyof NonNullable<CalloutLabelConfig['icon']>) => style.label?.icon?.[field] === undefined;
  const updateLabelRule = (partial: Partial<NonNullable<CalloutLabelConfig['rule']>>) =>
    label({ rule: { ...style.label?.rule, ...partial } });
  const resetLabelRuleField = (field: keyof NonNullable<CalloutLabelConfig['rule']>) => {
    const rule = { ...style.label?.rule };
    delete rule[field];
    if (Object.keys(rule).length > 0) label({ rule });
    else resetGroupField('label', 'rule');
  };
  const labelRuleUnset = (field: keyof NonNullable<CalloutLabelConfig['rule']>) => style.label?.rule?.[field] === undefined;
  const labelResourceOptions = [
    { value: '', label: labels.calloutStyleIconResourceNone },
    ...iconResources.map((r) => ({ value: r.id, label: iconLabel(r) })),
  ];
  if (resolved.label?.icon.resourceId && !iconResources.some((r) => r.id === resolved.label?.icon.resourceId)) {
    labelResourceOptions.push({ value: resolved.label.icon.resourceId, label: resolved.label.icon.resourceId });
  }
  const labelBottomSide = flowSideLabels(rtl, labels.calloutStyleLabelPositionBottomLeft, labels.calloutStyleLabelPositionBottomRight);
  const labelPositionOptions = [
    { value: 'top-right', label: labelSide.right },
    { value: 'top-left', label: labelSide.left },
    { value: 'top-start', label: labels.calloutStyleLabelPositionTopStart },
    { value: 'top-end', label: labels.calloutStyleLabelPositionTopEnd },
    // Tabs hanging from the box's foot (#1059).
    { value: 'bottom-right', label: labelBottomSide.right },
    { value: 'bottom-left', label: labelBottomSide.left },
    { value: 'bottom-start', label: labels.calloutStyleLabelPositionBottomStart },
    { value: 'bottom-end', label: labels.calloutStyleLabelPositionBottomEnd },
  ];
  const title = (partial: Partial<CalloutTitleStyleConfig>) => updateGroup('titleStyle', partial);
  const body = (partial: Partial<CalloutBodyStyleConfig>) => updateGroup('body', partial);
  const lists = (partial: Partial<CalloutListStyleConfig>) => updateGroup('lists', partial);
  /** The style's design (#1014). The resolved one shows what a style
   *  based on another inherits; an edit writes the whole design, its
   *  elements included, so a field the edit leaves out keeps its value. */
  const rawDesign = style.design;
  const shownDesign = resolved.design;
  const designOn = shownDesign?.enabled ?? false;
  const updateDesign = (partial: Partial<CalloutDesignConfig>) => {
    const next: CalloutDesignConfig = {
      ...rawDesign,
      slot: rawDesign?.slot ?? ((shownDesign?.slot ?? { elements: [] }) as DesignSlot),
      ...partial,
    };
    if ('minHeight' in partial && partial.minHeight === undefined) delete next.minHeight;
    if ('setsContent' in partial && partial.setsContent === undefined) delete next.setsContent;
    onChange({ design: next });
  };

  const spanOptions = [
    { value: 'column', label: labels.calloutStyleSpanColumn },
    { value: 'page', label: labels.calloutStyleSpanPage },
    { value: 'side', label: labels.calloutStyleSpanSide },
  ];
  const sideAtColumnEndOptions = [
    { value: 'before', label: labels.calloutStyleSideAtColumnEndBefore },
    { value: 'after', label: labels.calloutStyleSideAtColumnEndAfter },
  ];
  const placementOptions = [
    { value: 'here', label: labels.calloutStylePlacementHere },
    { value: 'auto', label: labels.calloutStylePlacementAuto },
    { value: 'top', label: labels.calloutStylePlacementTop },
    { value: 'bottom', label: labels.calloutStylePlacementBottom },
    { value: 'fixed', label: labels.calloutStylePlacementFixed },
  ];
  const fixedAnchorToOptions = [
    { value: 'container', label: labels.calloutStyleFixedAnchorContainer },
    { value: 'page', label: labels.headerFooterAnchorToPage },
    { value: 'bleed', label: labels.headerFooterAnchorToBleed },
  ];
  const frameEdgeLabels: Record<string, string> = {
    'top-left': labels.headerFooterFrameEdgeTopLeft,
    top: labels.headerFooterFrameEdgeTop,
    'top-right': labels.headerFooterFrameEdgeTopRight,
    left: labels.headerFooterFrameEdgeLeft,
    center: labels.headerFooterFrameEdgeCenter,
    right: labels.headerFooterFrameEdgeRight,
    'bottom-left': labels.headerFooterFrameEdgeBottomLeft,
    bottom: labels.headerFooterFrameEdgeBottom,
    'bottom-right': labels.headerFooterFrameEdgeBottomRight,
  };
  const fixedEdgeOptions = CONTAINER_EDGES.map((edge: AnchorEdge) => ({ value: edge, label: frameEdgeLabels[edge] ?? edge }));
  /** `fixed.anchor` / `fixed.offset` are nested objects: merge at each level
   *  and drop the group entirely when nothing is left set. */
  const updateFixedAnchor = (partial: Partial<ElementAnchor>) =>
    onChange({ fixed: { ...style.fixed, anchor: { ...resolved.fixed.anchor, ...partial } } });
  const updateFixedOffset = (axis: 'x' | 'y', value: Dimension) =>
    onChange({ fixed: { ...style.fixed, offset: { ...style.fixed?.offset, [axis]: value } } });
  const resetFixed = (part: 'anchor' | 'x' | 'y') => {
    const next: CalloutFixedConfig = { ...style.fixed };
    if (part === 'anchor') delete next.anchor;
    else if (next.offset) {
      const offset = { ...next.offset };
      delete offset[part];
      if (Object.keys(offset).length > 0) next.offset = offset;
      else delete next.offset;
    }
    if (Object.keys(next).length > 0) onChange({ fixed: next });
    else onResetField('fixed');
  };
  const widthOptions = [
    { value: 'fill', label: labels.calloutStyleWidthFill },
    { value: 'auto', label: labels.calloutStyleWidthAuto },
  ];
  const stripeSideOptions = [
    { value: 'left', label: stripeSide.left },
    { value: 'right', label: stripeSide.right },
    { value: 'start', label: labels.sideTextStart },
    { value: 'end', label: labels.sideTextEnd },
    { value: 'top', label: labels.calloutStyleStripeSideTop },
  ];
  const transformOptions = [
    { value: 'none', label: labels.calloutStyleTitleTransformNone },
    { value: 'uppercase', label: labels.calloutStyleTitleTransformUppercase },
  ];
  const bodyAlignOptions = [
    { value: 'left', label: textSide.left },
    { value: 'justify', label: labels.bodyTextAlignJustify },
  ];
  const markerAlignOptions = [
    { value: 'left', label: markerSide.left },
    { value: 'center', label: labels.headerFooterElementAlignCenter },
    { value: 'right', label: markerSide.right },
  ];

  return (
    <SearchScope title={`${style.name ?? ''} ${style.id}`} overridden={stored}>
    <ItemCard
      list="calloutStyles"
      id={style.id}
      styleId={style.id}
      title={style.name || style.id}
      subtitle={style.name && style.name !== style.id ? style.id : undefined}
      actions={
        <>
          <CardButton label={labels.calloutStyleDuplicate} onClick={onDuplicate}>
            <Copy size={13} aria-hidden="true" />
          </CardButton>
          <ConfirmPopover message={labels.calloutStyleDeleteConfirm} onConfirm={onRemove}>
            {({ open }) => (
              <CardButton label={labels.calloutStyleDelete} onClick={open} destructive>
                <Trash2 size={13} aria-hidden="true" />
              </CardButton>
            )}
          </ConfirmPopover>
        </>
      }
    >

      <div className="mb-2 flex flex-col gap-2">
        <Field
          label={labels.idLabel} tooltip={labels.styleIdHelp}
          hint={
            idTaken
              ? labels.calloutStyleIdHintDuplicate
              : labels.calloutStyleUsageHint.replace('__id__', style.id)
          }
        >
          <input
            dir="ltr"
            type="text"
            value={idDraft}
            onChange={(e) => setIdDraft(e.target.value)}
            onBlur={commitId}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            aria-label={labels.calloutStyleIdAria}
            className={inputClass}
            style={{
              ...inputStyle,
              borderColor: idEmpty || idTaken ? 'var(--destructive)' : 'var(--rule)',
            }}
          />
        </Field>
        <Field label={labels.calloutStyleNameLabel} tooltip={labels.styleNameHelp}>
          <input
            dir="auto"
            type="text"
            value={style.name ?? ''}
            onChange={(e) => onChange({ name: e.target.value.length > 0 ? e.target.value : undefined })}
            aria-label={labels.calloutStyleNameAria}
            placeholder={style.id}
            className={inputClass}
            style={inputStyle}
          />
        </Field>
      </div>

      {(parents.length > 0 || style.extends !== undefined) && (
        <SelectInput
          label={labels.calloutStyleExtends}
          value={style.extends ?? ''}
          options={[
            { value: '', label: labels.calloutStyleExtendsNone },
            ...parents.map((p) => ({ value: p.id, label: p.name })),
            // A parent that no longer exists stays visible until changed.
            ...(style.extends !== undefined && !parents.some((p) => p.id === style.extends) ? [{ value: style.extends, label: style.extends }] : []),
          ]}
          onChange={(v) => (v === '' ? onResetField('extends') : onChange({ extends: v }))}
          tooltip={labels.calloutStyleExtendsTooltip}
          isDefault={unset('extends')}
          onReset={() => onResetField('extends')}
        />
      )}

      <TextInput
        label={labels.calloutStyleTitle}
        value={resolved.title}
        onChange={(v) => onChange({ title: v })}
        tooltip={labels.calloutStyleTitleTooltip}
        isDefault={unset('title')}
        onReset={() => onResetField('title')}
      />
      <SelectInput
        label={labels.calloutStyleSpan}
        value={resolved.span}
        options={spanOptions}
        onChange={(v) => onChange({ span: v as CalloutSpan })}
        tooltip={labels.calloutStyleSpanTooltip}
        isDefault={unset('span')}
        onReset={() => onResetField('span')}
      />
      <SelectInput
        label={labels.calloutStyleSideAtColumnEnd}
        value={resolved.sideAtColumnEnd}
        options={sideAtColumnEndOptions}
        onChange={(v) => onChange({ sideAtColumnEnd: v as CalloutSideAtColumnEnd })}
        tooltip={labels.calloutStyleSideAtColumnEndTooltip}
        isDefault={unset('sideAtColumnEnd')}
        onReset={() => onResetField('sideAtColumnEnd')}
      />
      <SelectInput
        label={labels.calloutStylePlacement}
        value={resolved.placement}
        options={placementOptions}
        onChange={(v) => onChange({ placement: v as CalloutPlacement })}
        tooltip={labels.calloutStylePlacementTooltip}
        isDefault={unset('placement')}
        onReset={() => onResetField('placement')}
      />
      {resolved.span === 'column'
        && (resolved.placement === 'auto' || resolved.placement === 'top' || resolved.placement === 'bottom')
        && (severalColumns || !unset('columns')) && (
        <NumberInput
          label={labels.calloutStyleColumns}
          value={resolved.columns}
          onChange={(v) => onChange({ columns: Math.max(1, Math.round(v)) })}
          min={1}
          max={MULTIPLE_COLUMNS_MAX}
          step={1}
          tooltip={labels.calloutStyleColumnsTooltip}
          isDefault={unset('columns')}
          onReset={() => onResetField('columns')}
        />
      )}
      {resolved.placement === 'fixed' && (
        <>
          <SelectInput
            label={labels.calloutStyleFixedAnchorTo}
            value={resolved.fixed.anchor.to}
            options={fixedAnchorToOptions}
            onChange={(v) => updateFixedAnchor({ to: v as ElementAnchor['to'] })}
            tooltip={labels.calloutStyleFixedAnchorToTooltip}
            isDefault={style.fixed?.anchor === undefined}
            onReset={() => resetFixed('anchor')}
          />
          <SelectInput
            label={labels.calloutStyleFixedEdge}
            value={resolved.fixed.anchor.edge}
            options={fixedEdgeOptions}
            onChange={(v) => updateFixedAnchor({ edge: v as AnchorEdge })}
            tooltip={labels.calloutStyleFixedEdgeTooltip}
            isDefault={style.fixed?.anchor === undefined}
            onReset={() => resetFixed('anchor')}
          />
          <DimensionInput
            label={labels.calloutStyleFixedOffsetX}
            value={resolved.fixed.offset.x}
            onChange={(v) => updateFixedOffset('x', v)}
            min={-500}
            step={0.5}
            units={OFFSET_UNITS}
            tooltip={labels.calloutStyleFixedOffsetTooltip}
            isDefault={style.fixed?.offset?.x === undefined}
            onReset={() => resetFixed('x')}
          />
          <DimensionInput
            label={labels.calloutStyleFixedOffsetY}
            value={resolved.fixed.offset.y}
            onChange={(v) => updateFixedOffset('y', v)}
            min={-500}
            step={0.5}
            units={OFFSET_UNITS}
            tooltip={labels.calloutStyleFixedOffsetTooltip}
            isDefault={style.fixed?.offset?.y === undefined}
            onReset={() => resetFixed('y')}
          />
        </>
      )}
      <ToggleSwitch
        label={labels.calloutStyleFloatBarrier}
        checked={resolved.floatBarrier}
        onChange={(v) => onChange({ floatBarrier: v })}
        tooltip={labels.calloutStyleFloatBarrierTooltip}
        isDefault={unset('floatBarrier')}
        onReset={() => onResetField('floatBarrier')}
      />
      <ToggleSwitch
        label={labels.calloutStyleKeepTogether}
        checked={resolved.keepTogether}
        onChange={(v) => onChange({ keepTogether: v })}
        tooltip={labels.calloutStyleKeepTogetherTooltip}
        isDefault={unset('keepTogether')}
        onReset={() => onResetField('keepTogether')}
      />
      {/* Also for keep-together boxes: one taller than a full column splits. */}
      <NumberInput
        label={labels.calloutStyleSplitMinLines}
        value={resolved.splitMinLines}
        onChange={(v) => onChange({ splitMinLines: Math.max(1, Math.round(v)) })}
        min={1}
        max={20}
        step={1}
        tooltip={labels.calloutStyleSplitMinLinesTooltip}
        isDefault={unset('splitMinLines')}
        onReset={() => onResetField('splitMinLines')}
      />
      <SelectInput
        label={labels.calloutStyleWidth}
        value={resolved.width}
        options={widthOptions}
        onChange={(v) => onChange({ width: v as CalloutWidth })}
        tooltip={labels.calloutStyleWidthTooltip}
        isDefault={unset('width')}
        onReset={() => onResetField('width')}
      />
      <ToggleSwitch
        label={labels.calloutStyleBackground}
        checked={resolved.backgroundEnabled}
        onChange={(v) => onChange({ backgroundEnabled: v })}
        tooltip={labels.calloutStyleBackgroundTooltip}
        isDefault={unset('backgroundEnabled')}
        onReset={() => onResetField('backgroundEnabled')}
      />
      {resolved.backgroundEnabled && (
        <ColorPicker
          label={labels.calloutStyleBackgroundColor}
          value={resolved.background}
          onChange={(v) => onChange({ background: v })}
          isDefault={unset('background')}
          onReset={() => onResetField('background')}
          fieldId={`${fieldId}-background`}
        />
      )}
      {/* One radius, or one per corner (#1059/#1063). */}
      <CornerRadiusFields
        label={labels.calloutStyleBorderRadius}
        value={resolved.borderRadius}
        fallback={uniformRadius(resolved.borderRadius) ?? { value: 0, unit: 'em' }}
        step={0.05}
        units={SPACING_UNITS}
        isDefault={unset('borderRadius')}
        onReset={() => onResetField('borderRadius')}
        onChange={(v) => onChange({ borderRadius: v })}
      />
      <DimensionInput
        label={labels.marginTop}
        value={resolved.marginTop}
        onChange={(v) => onChange({ marginTop: v })}
        min={0}
        step={0.1}
        units={SPACING_UNITS}
        tooltip={labels.calloutStyleMarginTopTooltip}
        isDefault={unset('marginTop')}
        onReset={() => onResetField('marginTop')}
      />
      <DimensionInput
        label={labels.marginBottom}
        value={resolved.marginBottom}
        onChange={(v) => onChange({ marginBottom: v })}
        min={0}
        step={0.1}
        units={SPACING_UNITS}
        tooltip={labels.calloutStyleMarginBottomTooltip}
        isDefault={unset('marginBottom')}
        onReset={() => onResetField('marginBottom')}
      />
      <ToggleSwitch
        label={labels.calloutStyleSnapToGrid}
        checked={resolved.snapToGrid}
        onChange={(v) => onChange({ snapToGrid: v })}
        tooltip={labels.calloutStyleSnapToGridTooltip}
        isDefault={unset('snapToGrid')}
        onReset={() => onResetField('snapToGrid')}
      />
      <DimensionInput
        label={labels.calloutStyleColumnGap}
        value={resolved.columnGap}
        onChange={(v) => onChange({ columnGap: v })}
        min={0}
        step={0.1}
        units={SPACING_UNITS}
        tooltip={labels.calloutStyleColumnGapTooltip}
        isDefault={unset('columnGap')}
        onReset={() => onResetField('columnGap')}
      />

      <CollapsibleSection
        title={labels.calloutStyleContinuationGroup}
        sectionId={`${sectionId}.continuation`}
        variant="subsection"
      >
        <ToggleSwitch
          label={labels.calloutStyleRepeatTitle}
          checked={resolved.repeatTitle}
          onChange={(v) => onChange({ repeatTitle: v })}
          tooltip={labels.calloutStyleRepeatTitleTooltip}
          isDefault={unset('repeatTitle')}
          onReset={() => onResetField('repeatTitle')}
        />
        {resolved.repeatTitle && (
          <TextInput
            label={labels.calloutStyleContinuedSuffix}
            value={resolved.continuedSuffix}
            onChange={(v) => onChange({ continuedSuffix: v })}
            isDefault={unset('continuedSuffix')}
            onReset={() => onResetField('continuedSuffix')}
          />
        )}
        <ToggleSwitch
          label={labels.tableContinuesMarkerEnabled}
          checked={resolved.continuesMarkerEnabled}
          onChange={(v) => onChange({ continuesMarkerEnabled: v })}
          tooltip={labels.calloutStyleContinuesMarkerTooltip}
          isDefault={unset('continuesMarkerEnabled')}
          onReset={() => onResetField('continuesMarkerEnabled')}
        />
        {resolved.continuesMarkerEnabled && (
          <>
            <TextInput
              label={labels.tableContinuesMarker} tooltip={labels.tableContinuesMarkerTooltip}
              value={resolved.continuesMarker}
              onChange={(v) => onChange({ continuesMarker: v })}
              isDefault={unset('continuesMarker')}
              onReset={() => onResetField('continuesMarker')}
            />
            <SelectInput
              label={labels.calloutStyleContinuesMarkerAlign}
              value={resolved.continuesMarkerAlign}
              options={markerAlignOptions}
              onChange={(v) => onChange({ continuesMarkerAlign: v as CalloutMarkerTextAlign })}
              isDefault={unset('continuesMarkerAlign')}
              onReset={() => onResetField('continuesMarkerAlign')}
            />
            <ToggleSwitch
              label={labels.calloutStyleContinuesMarkerItalic}
              checked={resolved.continuesMarkerItalic}
              onChange={(v) => onChange({ continuesMarkerItalic: v })}
              isDefault={unset('continuesMarkerItalic')}
              onReset={() => onResetField('continuesMarkerItalic')}
            />
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={labels.calloutStyleBorderGroup}
        sectionId={`${sectionId}.border`}
        variant="subsection"
      >
        <ToggleSwitch
          label={labels.calloutStyleBorder} tooltip={labels.calloutStyleBorderTooltip}
          checked={resolved.border.enabled}
          onChange={(v) => border({ enabled: v })}
          isDefault={groupUnset('border', 'enabled')}
          onReset={() => resetGroupField('border', 'enabled')}
        />
        {resolved.border.enabled && (
          <>
            <ColorPicker
              label={labels.calloutStyleBorderColor}
              value={resolved.border.color}
              onChange={(v) => border({ color: v })}
              isDefault={groupUnset('border', 'color')}
              onReset={() => resetGroupField('border', 'color')}
              fieldId={`${fieldId}-border`}
            />
            <DimensionInput
              label={labels.calloutStyleBorderWidth}
              value={resolved.border.width}
              onChange={(v) => border({ width: v })}
              min={0}
              step={0.1}
              units={STROKE_UNITS}
              isDefault={groupUnset('border', 'width')}
              onReset={() => resetGroupField('border', 'width')}
            />
          </>
        )}
        {/* Per side (#1059/#1063): a side can be drawn while the whole
            border is off (a rule over the box's top only). */}
        <BorderSidesFields
          sides={style.border?.sides}
          whole={{ enabled: style.border?.enabled ?? resolved.border.enabled, color: resolved.border.color, width: resolved.border.width }}
          units={STROKE_UNITS}
          fieldId={fieldId}
          onChange={(sides) => (sides === undefined ? resetGroupField('border', 'sides') : border({ sides }))}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={labels.calloutStylePaddingGroup}
        sectionId={`${sectionId}.padding`}
        variant="subsection"
      >
        {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <DimensionInput
            key={side}
            label={
              side === 'top'
                ? labels.calloutStylePaddingTop
                : side === 'right'
                  ? labels.calloutStylePaddingRight
                  : side === 'bottom'
                    ? labels.calloutStylePaddingBottom
                    : labels.calloutStylePaddingLeft
            }
            value={resolved.padding[side]}
            onChange={(v) => padding({ [side]: v })}
            min={0}
            step={0.05}
            units={SPACING_UNITS}
            isDefault={groupUnset('padding', side)}
            onReset={() => resetGroupField('padding', side)}
          />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        title={labels.calloutStyleStripeGroup}
        sectionId={`${sectionId}.stripe`}
        variant="subsection"
      >
        <ToggleSwitch
          label={labels.calloutStyleStripe}
          checked={resolved.stripe.enabled}
          onChange={(v) => stripe({ enabled: v })}
          tooltip={labels.calloutStyleStripeTooltip}
          isDefault={groupUnset('stripe', 'enabled')}
          onReset={() => resetGroupField('stripe', 'enabled')}
        />
        {resolved.stripe.enabled && (
          <>
            <SelectInput
              label={labels.calloutStyleStripeSide} tooltip={labels.calloutStyleStripeSideTooltip}
              value={resolved.stripe.side}
              options={stripeSideOptions}
              onChange={(v) => stripe({ side: v as CalloutStripeSide })}
              isDefault={groupUnset('stripe', 'side')}
              onReset={() => resetGroupField('stripe', 'side')}
            />
            <DimensionInput
              label={labels.calloutStyleStripeWidth}
              value={resolved.stripe.width}
              onChange={(v) => stripe({ width: v })}
              min={0}
              step={0.05}
              units={SPACING_UNITS}
              isDefault={groupUnset('stripe', 'width')}
              onReset={() => resetGroupField('stripe', 'width')}
            />
            <ColorPicker
              label={labels.calloutStyleStripeColor}
              value={resolved.stripe.color}
              onChange={(v) => stripe({ color: v })}
              isDefault={groupUnset('stripe', 'color')}
              onReset={() => resetGroupField('stripe', 'color')}
              fieldId={`${fieldId}-stripe`}
            />
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={labels.calloutStyleIconGroup}
        sectionId={`${sectionId}.icon`}
        variant="subsection"
      >
        <IconFields
          value={resolved.icon}
          kindLabel={labels.calloutStyleIconKind}
          kindTooltip={labels.calloutStyleIconKindTooltip}
          update={icon}
          isDefault={(f) => groupUnset('icon', f)}
          onReset={(f) => resetGroupField('icon', f)}
          fieldId={`${fieldId}-icon`}
          iconResources={iconResources}
          withPosition
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={labels.calloutStyleLabelGroup}
        sectionId={`${sectionId}.label`}
        variant="subsection"
      >
        <ToggleSwitch
          label={labels.calloutStyleLabel}
          checked={resolved.label !== undefined}
          onChange={(v) => (v ? onChange({ label: { ...style.label } }) : onResetField('label'))}
          tooltip={labels.calloutStyleLabelTooltip}
          isDefault={unset('label')}
          onReset={() => onResetField('label')}
        />
        {resolved.label && (
          <>
            <FontPicker
              label={labels.calloutStyleLabelFont}
              value={resolved.label.fontFamily}
              onChange={(v) => label({ fontFamily: v })}
              isDefault={groupUnset('label', 'fontFamily')}
              onReset={() => resetGroupField('label', 'fontFamily')}
              searchPlaceholder={labels.headingFontSearch}
              noResultsLabel={labels.headingFontNoResults}
            />
            <DimensionInput
              label={labels.calloutStyleLabelSize}
              value={resolved.label.fontSize}
              onChange={(v) => label({ fontSize: v })}
              min={1}
              step={0.5}
              units={FONT_SIZE_UNITS}
              isDefault={groupUnset('label', 'fontSize')}
              onReset={() => resetGroupField('label', 'fontSize')}
            />
            <NumberInput
              label={labels.calloutStyleLabelWeight}
              value={resolved.label.fontWeight}
              onChange={(v) => label({ fontWeight: v })}
              min={100}
              max={900}
              step={10}
              isDefault={groupUnset('label', 'fontWeight')}
              onReset={() => resetGroupField('label', 'fontWeight')}
            />
            <ColorPicker
              label={labels.calloutStyleLabelColor}
              value={resolved.label.color}
              onChange={(v) => label({ color: v })}
              isDefault={groupUnset('label', 'color')}
              onReset={() => resetGroupField('label', 'color')}
              fieldId={`${fieldId}-label`}
            />
            <ColorPicker
              label={labels.calloutStyleLabelBackground}
              value={resolved.label.background}
              onChange={(v) => label({ background: v })}
              isDefault={groupUnset('label', 'background')}
              onReset={() => resetGroupField('label', 'background')}
              fieldId={`${fieldId}-label-bg`}
            />
            <SelectInput
              label={labels.calloutStyleLabelPosition}
              value={resolved.label.position}
              options={labelPositionOptions}
              onChange={(v) => label({ position: v as NonNullable<CalloutLabelConfig['position']> })}
              isDefault={groupUnset('label', 'position')}
              onReset={() => resetGroupField('label', 'position')}
            />
            {/* The tab and the box as one outline (#1059). */}
            <ToggleSwitch
              label={labels.calloutStyleLabelJoined}
              tooltip={labels.calloutStyleLabelJoinedTooltip}
              checked={resolved.label.joined}
              onChange={(v) => label(joinedTabPatch(v))}
              isDefault={groupUnset('label', 'joined')}
              onReset={() => resetGroupField('label', 'joined')}
            />
            {resolved.label.joined && (
              <ToggleSwitch
                label={labels.calloutStyleLabelOwnBackground}
                tooltip={labels.calloutStyleLabelOwnBackgroundTooltip}
                checked={resolved.label.ownBackground === true}
                onChange={(v) => label({ ownBackground: v })}
                isDefault={groupUnset('label', 'ownBackground')}
                onReset={() => resetGroupField('label', 'ownBackground')}
              />
            )}
            {resolved.label.joined && (
              <DimensionInput
                label={labels.calloutStyleLabelFillet}
                tooltip={labels.calloutStyleLabelFilletTooltip}
                value={resolved.label.fillet ?? uniformRadius(resolved.borderRadius) ?? { value: 0, unit: 'pt' }}
                onChange={(v) => label({ fillet: v })}
                min={0}
                step={0.05}
                units={SPACING_UNITS}
                isDefault={groupUnset('label', 'fillet')}
                onReset={() => resetGroupField('label', 'fillet')}
              />
            )}
            {/* The tab's own corners (#1102): square apart from the box,
                the box's corner on a joined tab, unless set. */}
            <CornerRadiusFields
              label={labels.calloutStyleLabelBorderRadius}
              tooltip={labels.calloutStyleLabelBorderRadiusTooltip}
              value={resolved.label.borderRadius}
              fallback={(resolved.label.joined ? uniformRadius(resolved.borderRadius) : undefined) ?? { value: 0, unit: 'pt' }}
              step={0.05}
              units={SPACING_UNITS}
              isDefault={groupUnset('label', 'borderRadius')}
              onReset={() => resetGroupField('label', 'borderRadius')}
              onChange={(v) => label({ borderRadius: v })}
            />
            <DimensionInput
              label={labels.calloutStyleLabelHeight}
              value={resolved.label.height}
              onChange={(v) => label({ height: v })}
              min={0}
              step={0.1}
              units={SPACING_UNITS}
              isDefault={groupUnset('label', 'height')}
              onReset={() => resetGroupField('label', 'height')}
            />
            <DimensionInput
              label={labels.calloutStyleLabelPaddingX}
              value={resolved.label.paddingX}
              onChange={(v) => label({ paddingX: v })}
              min={0}
              step={0.05}
              units={SPACING_UNITS}
              isDefault={groupUnset('label', 'paddingX')}
              onReset={() => resetGroupField('label', 'paddingX')}
            />
            {!resolved.label.joined && <DimensionInput
              label={labels.calloutStyleLabelOffset}
              value={resolved.label.offset}
              onChange={(v) => label({ offset: v })}
              min={0}
              step={0.05}
              units={SPACING_UNITS}
              tooltip={labels.calloutStyleLabelOffsetTooltip}
              isDefault={groupUnset('label', 'offset')}
              onReset={() => resetGroupField('label', 'offset')}
            />}
            <DimensionInput
              label={labels.calloutStyleLabelInset}
              value={resolved.label.inset}
              onChange={(v) => label({ inset: v })}
              min={0}
              step={0.05}
              units={SPACING_UNITS}
              isDefault={groupUnset('label', 'inset')}
              onReset={() => resetGroupField('label', 'inset')}
            />
            <SelectInput
              label={labels.calloutStyleLabelIconKind}
              value={resolved.label.icon.kind}
              options={[
                { value: 'resource', label: labels.calloutStyleLabelIconKindPicture },
                { value: 'glyph', label: labels.calloutStyleIconKindGlyph },
                { value: 'shape', label: labels.calloutStyleIconKindShape },
              ]}
              onChange={(v) => updateLabelIcon(labelIconKindPatch(style.label?.icon, v as CalloutLabelIconKind))}
              tooltip={labels.calloutStyleLabelIconKindTooltip}
              isDefault={labelIconUnset('kind')}
              onReset={() => resetLabelIconField('kind')}
            />
            {resolved.label.icon.kind === 'glyph' && (
              <>
                <TextInput
                  label={labels.calloutStyleLabelIconGlyph}
                  value={resolved.label.icon.glyph}
                  onChange={(v) => updateLabelIcon({ glyph: v })}
                  tooltip={labels.calloutStyleLabelIconGlyphTooltip}
                  widthCh={6}
                  isDefault={labelIconUnset('glyph')}
                  onReset={() => resetLabelIconField('glyph')}
                />
                <GlyphPicker
                  label={labels.calloutStyleLabelIconGlyphCommon}
                  useLabel={labels.calloutStyleLabelIconGlyphUse}
                  value={resolved.label.icon.glyph}
                  onPick={(glyph) => updateLabelIcon({ glyph })}
                />
                <FontPicker
                  label={labels.calloutStyleIconFont}
                  value={resolved.label.icon.fontFamily}
                  onChange={(v) => updateLabelIcon({ fontFamily: v })}
                  isDefault={labelIconUnset('fontFamily')}
                  onReset={() => resetLabelIconField('fontFamily')}
                  searchPlaceholder={labels.bodyFontSearch}
                  noResultsLabel={labels.bodyFontNoResults}
                />
                <NumberInput
                  label={labels.calloutStyleIconWeight}
                  value={resolved.label.icon.fontWeight}
                  onChange={(v) => updateLabelIcon({ fontWeight: v })}
                  min={100}
                  max={900}
                  step={10}
                  isDefault={labelIconUnset('fontWeight')}
                  onReset={() => resetLabelIconField('fontWeight')}
                />
                <NumberInput
                  label={labels.calloutStyleLabelIconScale}
                  value={resolved.label.icon.scale}
                  onChange={(v) => updateLabelIcon({ scale: v })}
                  min={0.1}
                  max={4}
                  step={0.05}
                  tooltip={labels.calloutStyleLabelIconScaleTooltip}
                  isDefault={labelIconUnset('scale')}
                  onReset={() => resetLabelIconField('scale')}
                />
                <ColorPicker
                  label={labels.calloutStyleIconColor}
                  // Unset, the glyph takes the tab's words' colour.
                  value={resolved.label.icon.color ?? resolved.label.color}
                  onChange={(v) => updateLabelIcon({ color: v })}
                  isDefault={labelIconUnset('color')}
                  onReset={() => resetLabelIconField('color')}
                  fieldId={`${fieldId}-label-glyph`}
                />
                <SelectInput
                  label={labels.calloutStyleLabelIconGlyphPlacement}
                  value={resolved.label.icon.placement}
                  options={[
                    { value: 'beside', label: labels.calloutStyleLabelIconBeside },
                    { value: 'inside', label: labels.calloutStyleLabelIconInside },
                  ]}
                  onChange={(v) => updateLabelIcon({ placement: v as 'beside' | 'inside' })}
                  isDefault={labelIconUnset('placement')}
                  onReset={() => resetLabelIconField('placement')}
                />
                <DimensionInput
                  label={labels.calloutStyleLabelIconGap}
                  value={resolved.label.icon.gap}
                  onChange={(v) => updateLabelIcon({ gap: v })}
                  min={0}
                  step={0.05}
                  units={SPACING_UNITS}
                  isDefault={labelIconUnset('gap')}
                  onReset={() => resetLabelIconField('gap')}
                />
              </>
            )}
            {resolved.label.icon.kind === 'shape' && (
              <>
                <ShapeFields
                  shape={resolved.label.icon.shape ?? 'ring'}
                  strokeWidth={resolved.label.icon.strokeWidth}
                  sizeForDefault={{ value: resolved.label.icon.scale, unit: 'em' }}
                  update={(partial) => updateLabelIcon(partial)}
                  isDefault={(field) => labelIconUnset(field)}
                  onReset={(field) => resetLabelIconField(field)}
                />
                <NumberInput
                  label={labels.calloutStyleLabelIconScale}
                  value={resolved.label.icon.scale}
                  onChange={(v) => updateLabelIcon({ scale: v })}
                  min={0.1}
                  max={4}
                  step={0.05}
                  tooltip={labels.calloutStyleLabelIconScaleTooltip}
                  isDefault={labelIconUnset('scale')}
                  onReset={() => resetLabelIconField('scale')}
                />
                <ColorPicker
                  label={labels.calloutStyleIconColor}
                  value={resolved.label.icon.color ?? resolved.label.color}
                  onChange={(v) => updateLabelIcon({ color: v })}
                  isDefault={labelIconUnset('color')}
                  onReset={() => resetLabelIconField('color')}
                  fieldId={`${fieldId}-label-shape`}
                />
                <SelectInput
                  label={labels.calloutStyleLabelIconGlyphPlacement}
                  value={resolved.label.icon.placement}
                  options={[
                    { value: 'beside', label: labels.calloutStyleLabelIconBeside },
                    { value: 'inside', label: labels.calloutStyleLabelIconInside },
                  ]}
                  onChange={(v) => updateLabelIcon({ placement: v as 'beside' | 'inside' })}
                  isDefault={labelIconUnset('placement')}
                  onReset={() => resetLabelIconField('placement')}
                />
                <DimensionInput
                  label={labels.calloutStyleLabelIconGap}
                  value={resolved.label.icon.gap}
                  onChange={(v) => updateLabelIcon({ gap: v })}
                  min={0}
                  step={0.05}
                  units={SPACING_UNITS}
                  isDefault={labelIconUnset('gap')}
                  onReset={() => resetLabelIconField('gap')}
                />
              </>
            )}
            {resolved.label.icon.kind === 'resource' && (
            <SelectInput
              label={labels.calloutStyleLabelIcon}
              value={resolved.label.icon.resourceId}
              options={labelResourceOptions}
              onChange={(v) => updateLabelIcon({ resourceId: v })}
              tooltip={labels.calloutStyleLabelIconTooltip}
              isDefault={labelIconUnset('resourceId')}
              onReset={() => resetLabelIconField('resourceId')}
            />
            )}
            {resolved.label.icon.kind === 'resource' && resolved.label.icon.resourceId && (
              <>
                <DimensionInput
                  label={labels.calloutStyleLabelIconWidth}
                  value={resolved.label.icon.width}
                  onChange={(v) => updateLabelIcon({ width: v })}
                  min={0}
                  step={0.1}
                  units={SPACING_UNITS}
                  isDefault={labelIconUnset('width')}
                  onReset={() => resetLabelIconField('width')}
                />
                <SelectInput
                  label={labels.calloutStyleLabelIconPlacement}
                  value={resolved.label.icon.placement}
                  options={[
                    { value: 'beside', label: labels.calloutStyleLabelIconBeside },
                    { value: 'inside', label: labels.calloutStyleLabelIconInside },
                  ]}
                  onChange={(v) => updateLabelIcon({ placement: v as 'beside' | 'inside' })}
                  tooltip={labels.calloutStyleLabelIconPlacementTooltip}
                  isDefault={labelIconUnset('placement')}
                  onReset={() => resetLabelIconField('placement')}
                />
                <TintFields
                  tint={resolved.label.icon.tint}
                  ownColor={resolved.label.color}
                  update={(tint) => updateLabelIcon({ tint })}
                  isDefault={labelIconUnset('tint')}
                  onReset={() => resetLabelIconField('tint')}
                  fieldId={`${fieldId}-label-tint`}
                  toggleLabel={labels.calloutStyleLabelIconTint}
                  toggleTooltip={labels.calloutStyleLabelIconTintTooltip}
                />
                <DimensionInput
                  label={labels.calloutStyleLabelIconGap}
                  value={resolved.label.icon.gap}
                  onChange={(v) => updateLabelIcon({ gap: v })}
                  min={0}
                  step={0.05}
                  units={SPACING_UNITS}
                  isDefault={labelIconUnset('gap')}
                  onReset={() => resetLabelIconField('gap')}
                />
              </>
            )}
            <ToggleSwitch
              label={labels.calloutStyleLabelRule}
              checked={resolved.label.rule.enabled}
              onChange={(v) => updateLabelRule({ enabled: v })}
              tooltip={labels.calloutStyleLabelRuleTooltip}
              isDefault={labelRuleUnset('enabled')}
              onReset={() => resetLabelRuleField('enabled')}
            />
            {resolved.label.rule.enabled && (
              <>
                <ColorPicker
                  label={labels.calloutStyleLabelRuleColor}
                  value={resolved.label.rule.color}
                  onChange={(v) => updateLabelRule({ color: v })}
                  isDefault={labelRuleUnset('color')}
                  onReset={() => resetLabelRuleField('color')}
                  fieldId={`${fieldId}-label-rule`}
                />
                <DimensionInput
                  label={labels.calloutStyleLabelRuleWidth}
                  value={resolved.label.rule.width}
                  onChange={(v) => updateLabelRule({ width: v })}
                  min={0}
                  step={0.25}
                  units={STROKE_UNITS}
                  isDefault={labelRuleUnset('width')}
                  onReset={() => resetLabelRuleField('width')}
                />
              </>
            )}
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={labels.calloutStyleMarkerGroup}
        sectionId={`${sectionId}.marker`}
        variant="subsection"
      >
        <IconFields
          value={resolved.marker}
          kindLabel={labels.calloutStyleMarkerKind}
          kindTooltip={labels.calloutStyleMarkerKindTooltip}
          update={marker}
          isDefault={(f) => groupUnset('marker', f as keyof CalloutMarkerConfig)}
          onReset={(f) => resetGroupField('marker', f as keyof CalloutMarkerConfig)}
          fieldId={`${fieldId}-marker`}
          iconResources={iconResources}
        />
        {resolved.marker.kind !== 'none' && (
          <>
            <DimensionInput
              label={labels.calloutStyleMarkerGap}
              value={resolved.marker.gap}
              onChange={(v) => marker({ gap: v })}
              min={0}
              step={0.05}
              units={SPACING_UNITS}
              tooltip={labels.calloutStyleMarkerGapTooltip}
              isDefault={groupUnset('marker', 'gap')}
              onReset={() => resetGroupField('marker', 'gap')}
            />
            <ToggleSwitch
              label={labels.calloutStyleMarkerRule}
              checked={resolved.marker.rule.enabled}
              onChange={(v) => updateMarkerRule({ enabled: v })}
              tooltip={labels.calloutStyleMarkerRuleTooltip}
              isDefault={markerRuleUnset('enabled')}
              onReset={() => resetMarkerRuleField('enabled')}
            />
            {resolved.marker.rule.enabled && (
              <>
                <ColorPicker
                  label={labels.calloutStyleMarkerRuleColor}
                  value={resolved.marker.rule.color}
                  onChange={(v) => updateMarkerRule({ color: v })}
                  isDefault={markerRuleUnset('color')}
                  onReset={() => resetMarkerRuleField('color')}
                  fieldId={`${fieldId}-marker-rule`}
                />
                <DimensionInput
                  label={labels.calloutStyleMarkerRuleWidth}
                  value={resolved.marker.rule.width}
                  onChange={(v) => updateMarkerRule({ width: v })}
                  min={0}
                  step={0.25}
                  units={STROKE_UNITS}
                  isDefault={markerRuleUnset('width')}
                  onReset={() => resetMarkerRuleField('width')}
                />
                <DimensionInput
                  label={labels.calloutStyleMarkerRuleLength}
                  value={resolved.marker.rule.length}
                  onChange={(v) => updateMarkerRule({ length: v })}
                  min={0}
                  step={0.5}
                  units={OFFSET_UNITS}
                  tooltip={labels.calloutStyleMarkerRuleLengthTooltip}
                  isDefault={markerRuleUnset('length')}
                  onReset={() => resetMarkerRuleField('length')}
                />
              </>
            )}
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={labels.calloutStyleTitleGroup}
        sectionId={`${sectionId}.title`}
        variant="subsection"
      >
        <FontPicker
          label={labels.calloutStyleTitleFont}
          value={resolved.titleStyle.fontFamily}
          onChange={(v) => title({ fontFamily: v })}
          isDefault={groupUnset('titleStyle', 'fontFamily')}
          onReset={() => resetGroupField('titleStyle', 'fontFamily')}
          searchPlaceholder={labels.headingFontSearch}
          noResultsLabel={labels.headingFontNoResults}
        />
        <DimensionInput
          label={labels.calloutStyleTitleSize}
          value={resolved.titleStyle.fontSize}
          onChange={(v) => title({ fontSize: v })}
          min={1}
          step={0.5}
          units={FONT_SIZE_UNITS}
          isDefault={groupUnset('titleStyle', 'fontSize')}
          onReset={() => resetGroupField('titleStyle', 'fontSize')}
        />
        <NumberInput
          label={labels.calloutStyleTitleWeight}
          value={resolved.titleStyle.fontWeight}
          onChange={(v) => title({ fontWeight: v })}
          min={100}
          max={900}
          step={10}
          isDefault={groupUnset('titleStyle', 'fontWeight')}
          onReset={() => resetGroupField('titleStyle', 'fontWeight')}
        />
        <ToggleSwitch
          label={labels.calloutStyleTitleItalic} tooltip={labels.italicHelp}
          checked={resolved.titleStyle.italic}
          onChange={(v) => title({ italic: v })}
          isDefault={groupUnset('titleStyle', 'italic')}
          onReset={() => resetGroupField('titleStyle', 'italic')}
        />
        <ColorPicker
          label={labels.calloutStyleTitleColor}
          value={resolved.titleStyle.color}
          onChange={(v) => title({ color: v })}
          isDefault={groupUnset('titleStyle', 'color')}
          onReset={() => resetGroupField('titleStyle', 'color')}
          fieldId={`${fieldId}-title`}
        />
        <SelectInput
          label={labels.calloutStyleTitleTransform} tooltip={labels.calloutStyleTitleTransformTooltip}
          value={resolved.titleStyle.textTransform}
          options={transformOptions}
          onChange={(v) => title({ textTransform: v as CalloutTextTransform })}
          isDefault={groupUnset('titleStyle', 'textTransform')}
          onReset={() => resetGroupField('titleStyle', 'textTransform')}
        />
        <DimensionInput
          label={labels.calloutStyleTitleGap}
          value={resolved.titleStyle.gap}
          onChange={(v) => title({ gap: v })}
          min={0}
          step={0.05}
          units={SPACING_UNITS}
          tooltip={labels.calloutStyleTitleGapTooltip}
          isDefault={groupUnset('titleStyle', 'gap')}
          onReset={() => resetGroupField('titleStyle', 'gap')}
        />
        <DimensionInput
          label={labels.calloutStyleTitleLetterSpacing}
          value={resolved.titleStyle.letterSpacing}
          onChange={(v) => title({ letterSpacing: v })}
          min={-5}
          step={0.05}
          units={TRACKING_UNITS}
          isDefault={groupUnset('titleStyle', 'letterSpacing')}
          onReset={() => resetGroupField('titleStyle', 'letterSpacing')}
        />
        <DimensionInput
          label={labels.calloutStyleTitleIndent}
          value={resolved.titleStyle.indent}
          onChange={(v) => title({ indent: v })}
          min={0}
          step={0.1}
          units={SPACING_UNITS}
          tooltip={labels.calloutStyleTitleIndentTooltip}
          isDefault={groupUnset('titleStyle', 'indent')}
          onReset={() => resetGroupField('titleStyle', 'indent')}
        />
        <DimensionInput
          label={labels.calloutStyleTitleLineHeight}
          value={resolved.titleStyle.lineHeight}
          onChange={(v) => title({ lineHeight: v })}
          min={0.5}
          max={5}
          step={0.1}
          units={LINE_HEIGHT_UNITS}
          tooltip={labels.calloutStyleTitleLineHeightTooltip}
          isDefault={groupUnset('titleStyle', 'lineHeight')}
          onReset={() => resetGroupField('titleStyle', 'lineHeight')}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={labels.calloutStyleDesignGroup}
        sectionId={`${sectionId}.design`}
        variant="subsection"
      >
        <ToggleSwitch
          label={labels.calloutStyleDesign}
          checked={designOn}
          onChange={(v) => updateDesign({ enabled: v })}
          tooltip={labels.calloutStyleDesignTooltip}
          isDefault={unset('design')}
          onReset={() => onResetField('design')}
        />
        {designOn && (
          <NestedGroup>
            <p className="px-2 py-1 text-xs" style={{ color: 'var(--slate)' }}>
              {labels.calloutStyleDesignInfo}
            </p>
            <DimensionInput
              label={labels.calloutStyleDesignMinHeight}
              value={shownDesign?.minHeight ?? ZERO_PT}
              onChange={(dim) => updateDesign({ minHeight: dim })}
              min={0}
              step={1}
              tooltip={labels.calloutStyleDesignMinHeightTooltip}
              isDefault={rawDesign?.minHeight === undefined}
              onReset={() => updateDesign({ minHeight: undefined })}
              units={MIN_HEIGHT_UNITS}
            />
            <ToggleSwitch
              label={labels.calloutStyleDesignSetsContent}
              checked={shownDesign?.setsContent ?? false}
              onChange={(v) => updateDesign({ setsContent: v })}
              tooltip={labels.calloutStyleDesignSetsContentTooltip}
              isDefault={rawDesign?.setsContent === undefined}
              onReset={() => updateDesign({ setsContent: undefined })}
            />
            <SlotEditor
              slotKey="box"
              raw={rawDesign?.slot}
              resolved={shownDesign?.slot ?? resolveDesignSlot(undefined, 'box')}
              onUpdate={(slot: DesignSlot | undefined) => updateDesign({ enabled: true, slot: slot ?? { elements: [] } })}
            />
          </NestedGroup>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={labels.calloutStyleBodyGroup}
        sectionId={`${sectionId}.body`}
        variant="subsection"
      >
        <p className="mb-2 text-xs" style={{ color: 'var(--slate)' }}>
          {labels.calloutStyleBodyHint}
        </p>
        <FontPicker
          label={labels.fontLabel}
          value={resolved.body.fontFamily}
          onChange={(v) => body({ fontFamily: v })}
          isDefault={groupUnset('body', 'fontFamily')}
          onReset={() => resetGroupField('body', 'fontFamily')}
          searchPlaceholder={labels.bodyFontSearch}
          noResultsLabel={labels.bodyFontNoResults}
        />
        <DimensionInput
          label={labels.sizeLabel}
          value={resolved.body.fontSize}
          onChange={(v) => body({ fontSize: v })}
          min={1}
          step={0.5}
          units={FONT_SIZE_UNITS}
          isDefault={groupUnset('body', 'fontSize')}
          onReset={() => resetGroupField('body', 'fontSize')}
        />
        <DimensionInput
          label={labels.bodyLineHeight}
          value={resolved.body.lineHeight}
          onChange={(v) => body({ lineHeight: v })}
          min={0.5}
          max={5}
          step={0.1}
          units={LINE_HEIGHT_UNITS}
          isDefault={groupUnset('body', 'lineHeight')}
          onReset={() => resetGroupField('body', 'lineHeight')}
        />
        <ColorPicker
          label={labels.colorLabel}
          value={resolved.body.color}
          onChange={(v) => body({ color: v })}
          isDefault={groupUnset('body', 'color')}
          onReset={() => resetGroupField('body', 'color')}
          fieldId={`${fieldId}-body`}
        />
        <ColorPicker
          label={labels.calloutStyleBodyBoldColor}
          value={resolved.body.boldColor ?? resolved.body.color}
          onChange={(v) => body({ boldColor: v })}
          tooltip={labels.calloutStyleBodyBoldColorTooltip}
          isDefault={groupUnset('body', 'boldColor')}
          onReset={() => resetGroupField('body', 'boldColor')}
          fieldId={`${fieldId}-body-bold`}
        />
        <ColorPicker
          label={labels.calloutStyleBodyItalicColor}
          value={resolved.body.italicColor ?? resolved.body.color}
          onChange={(v) => body({ italicColor: v })}
          tooltip={labels.calloutStyleBodyItalicColorTooltip}
          isDefault={groupUnset('body', 'italicColor')}
          onReset={() => resetGroupField('body', 'italicColor')}
          fieldId={`${fieldId}-body-italic`}
        />
        <NumberInput
          label={labels.bodyFontWeight}
          value={resolved.body.fontWeight}
          onChange={(v) => body({ fontWeight: v })}
          min={100}
          max={900}
          step={10}
          tooltip={labels.textStyleFontWeightTooltip}
          isDefault={groupUnset('body', 'fontWeight')}
          onReset={() => resetGroupField('body', 'fontWeight')}
        />
        <NumberInput
          label={labels.bodyBoldFontWeight}
          value={resolved.body.boldFontWeight}
          onChange={(v) => body({ boldFontWeight: v })}
          min={100}
          max={900}
          step={10}
          tooltip={labels.textStyleBoldFontWeightTooltip}
          isDefault={groupUnset('body', 'boldFontWeight')}
          onReset={() => resetGroupField('body', 'boldFontWeight')}
        />
        <ToggleSwitch
          label={labels.textStyleItalic}
          checked={resolved.body.italic}
          onChange={(v) => body({ italic: v })}
          tooltip={labels.textStyleItalicTooltip}
          isDefault={groupUnset('body', 'italic')}
          onReset={() => resetGroupField('body', 'italic')}
        />
        <ToggleSwitch
          label={labels.textStyleSmallCaps}
          checked={resolved.body.smallCaps}
          onChange={(v) => body({ smallCaps: v })}
          tooltip={labels.textStyleSmallCapsTooltip}
          isDefault={groupUnset('body', 'smallCaps')}
          onReset={() => resetGroupField('body', 'smallCaps')}
        />
        <DimensionInput
          label={labels.calloutStyleBodyLetterSpacing}
          value={resolved.body.letterSpacing ?? { value: 0, unit: 'em' }}
          onChange={(v) => body({ letterSpacing: v })}
          min={-1}
          step={0.005}
          units={TRACKING_UNITS}
          tooltip={labels.calloutStyleBodyLetterSpacingTooltip}
          isDefault={groupUnset('body', 'letterSpacing')}
          onReset={() => resetGroupField('body', 'letterSpacing')}
        />
        <SelectInput
          label={labels.alignmentLabel} tooltip={labels.alignmentHelp}
          value={resolved.body.textAlign}
          options={bodyAlignOptions}
          onChange={(v) => body({ textAlign: v as CalloutBodyStyleConfig['textAlign'] })}
          isDefault={groupUnset('body', 'textAlign')}
          onReset={() => resetGroupField('body', 'textAlign')}
        />
        {(resolved.body.textAlign === 'justify' || raggedHyphenation) && (
          <ToggleSwitch
            label={labels.bodyHyphenation}
            checked={resolved.body.hyphenation}
            onChange={(v) => body({ hyphenation: v })}
            isDefault={groupUnset('body', 'hyphenation')}
            onReset={() => resetGroupField('body', 'hyphenation')}
          />
        )}
        <ParagraphSpacingField
          value={resolved.body.paragraphSpacing}
          line={resolved.body.lineHeight}
          onChange={(v) => body({ paragraphSpacing: v })}
          isDefault={groupUnset('body', 'paragraphSpacing')}
          onReset={() => resetGroupField('body', 'paragraphSpacing')}
        />
        <DimensionInput
          label={labels.bodyFirstLineIndent}
          value={resolved.body.firstLineIndent}
          onChange={(v) => body({ firstLineIndent: v })}
          min={0}
          step={0.1}
          units={SPACING_UNITS}
          isDefault={groupUnset('body', 'firstLineIndent')}
          onReset={() => resetGroupField('body', 'firstLineIndent')}
        />
        <TabStopsField
          inherits
          stops={style.body?.tabStops}
          interval={style.body?.tabInterval}
          inheritedInterval={bodyTabInterval}
          onStopsChange={(next) => (next === undefined ? resetGroupField('body', 'tabStops') : body({ tabStops: next }))}
          onIntervalChange={(next) => (next === undefined ? resetGroupField('body', 'tabInterval') : body({ tabInterval: next }))}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={labels.calloutStyleListsGroup}
        sectionId={`${sectionId}.lists`}
        variant="subsection"
      >
        <p className="mb-2 text-xs" style={{ color: 'var(--slate)' }}>
          {labels.calloutStyleListsHint}
        </p>
        <TextInput
          label={labels.unorderedListsBulletChar}
          value={resolved.lists.bulletChar}
          onChange={(v) => lists({ bulletChar: v })}
          placeholder={labels.unorderedListsBulletCharPlaceholder}
          tooltip={labels.unorderedListsBulletCharTooltip}
          widthCh={6}
          isDefault={groupUnset('lists', 'bulletChar')}
          onReset={() => resetGroupField('lists', 'bulletChar')}
        />
        <DimensionInput
          label={labels.calloutStyleListsBulletSize}
          value={resolved.lists.bulletFontSize ?? listDefaults.bulletFontSize}
          onChange={(v) => lists({ bulletFontSize: v })}
          min={1}
          step={0.5}
          units={FONT_SIZE_UNITS}
          isDefault={groupUnset('lists', 'bulletFontSize')}
          onReset={() => resetGroupField('lists', 'bulletFontSize')}
        />
        <NumberInput
          label={labels.calloutStyleListsBulletWeight}
          value={resolved.lists.bulletFontWeight ?? listDefaults.bulletFontWeight}
          onChange={(v) => lists({ bulletFontWeight: v })}
          min={100}
          max={900}
          step={10}
          isDefault={groupUnset('lists', 'bulletFontWeight')}
          onReset={() => resetGroupField('lists', 'bulletFontWeight')}
        />
        <FontPicker
          label={labels.calloutStyleListsBulletFont}
          value={resolved.lists.bulletFontFamily ?? listDefaults.bulletFontFamily}
          onChange={(v) => lists({ bulletFontFamily: v })}
          tooltip={labels.calloutStyleListsBulletFontTooltip}
          isDefault={groupUnset('lists', 'bulletFontFamily')}
          onReset={() => resetGroupField('lists', 'bulletFontFamily')}
          searchPlaceholder={labels.headingFontSearch}
          noResultsLabel={labels.headingFontNoResults}
        />
        <DimensionInput
          label={labels.calloutStyleListsMarginTop}
          tooltip={labels.calloutStyleListsMarginsTooltip}
          value={resolved.lists.marginTop ?? listDefaults.marginTop}
          onChange={(v) => lists({ marginTop: v })}
          min={0}
          step={0.1}
          units={SPACING_UNITS}
          isDefault={groupUnset('lists', 'marginTop')}
          onReset={() => resetGroupField('lists', 'marginTop')}
        />
        <DimensionInput
          label={labels.calloutStyleListsMarginBottom}
          tooltip={labels.calloutStyleListsMarginsTooltip}
          value={resolved.lists.marginBottom ?? listDefaults.marginBottom}
          onChange={(v) => lists({ marginBottom: v })}
          min={0}
          step={0.1}
          units={SPACING_UNITS}
          isDefault={groupUnset('lists', 'marginBottom')}
          onReset={() => resetGroupField('lists', 'marginBottom')}
        />
        <ColorPicker
          label={labels.colorLabel}
          value={resolved.lists.color}
          onChange={(v) => lists({ color: v })}
          isDefault={groupUnset('lists', 'color')}
          onReset={() => resetGroupField('lists', 'color')}
          fieldId={`${fieldId}-lists`}
        />
        <DimensionInput
          label={labels.unorderedListsIndent}
          value={resolved.lists.indent}
          onChange={(v) => lists({ indent: v })}
          min={0}
          step={0.1}
          units={SPACING_UNITS}
          tooltip={labels.unorderedListsIndentTooltip}
          isDefault={groupUnset('lists', 'indent')}
          onReset={() => resetGroupField('lists', 'indent')}
        />
        <DimensionInput
          label={labels.unorderedListsGap}
          value={resolved.lists.gap}
          onChange={(v) => lists({ gap: v })}
          min={0}
          step={0.1}
          units={SPACING_UNITS}
          tooltip={labels.unorderedListsGapTooltip}
          isDefault={groupUnset('lists', 'gap')}
          onReset={() => resetGroupField('lists', 'gap')}
        />
        <DimensionInput
          label={labels.unorderedListsItemSpacing}
          value={resolved.lists.itemSpacing}
          onChange={(v) => lists({ itemSpacing: v })}
          min={0}
          step={0.1}
          units={SPACING_UNITS}
          tooltip={labels.unorderedListsItemSpacingTooltip}
          isDefault={groupUnset('lists', 'itemSpacing')}
          onReset={() => resetGroupField('lists', 'itemSpacing')}
        />
      </CollapsibleSection>
    </ItemCard>
    </SearchScope>
  );
}

/** The callout styles of the book and how to edit them: what the Box
 *  styles section and the frame-style library (#873) both write. A rename
 *  also renames the style in every `:::callout` fence and template frame
 *  that names it. */
export function useCalloutStyleEdits() {
  const dispatch = useSandboxDispatch();
  const labels = useSandboxLabels();
  const raw = useSandboxSelector((s) => s.config.calloutStyles);
  const pageTemplates = useSandboxSelector((s) => s.config.pageTemplates);
  const bodyTextRaw = useSandboxSelector((s) => s.config.bodyText);
  const headingsRaw = useSandboxSelector((s) => s.config.headings);
  const unorderedListsRaw = useSandboxSelector((s) => s.config.unorderedLists);
  const chapters = useBookTexts();
  const activeChapterId = useSandboxSelector((s) => s.activeChapterId);
  const resources = useSandboxResources();
  const iconResources = resources.filter((r) => r.kind === 'svg' || r.kind === 'bitmap');

  // Continuation strings default per document language, the way the engine
  // resolves them (see the table style section).
  const docLocale = useSandboxSelector((s) => s.config.locale ?? s.config.bodyText?.hyphenation?.locale ?? s.locale);
  const bodyText = resolveBodyTextConfig(bodyTextRaw);
  const headings = resolveHeadingsConfig(headingsRaw);
  const unorderedLists = resolveUnorderedListsConfig(unorderedListsRaw, bodyText);
  const styles: CalloutStyleConfig[] = raw ?? DEFAULT_CALLOUT_STYLES;
  const resolved = resolveCalloutStylesConfig(styles, bodyText, headings, unorderedLists, docLocale);
  const resolveOne = (style: CalloutStyleConfig): ResolvedCalloutStyleConfig =>
    resolved[styles.indexOf(style)] ?? resolveCalloutStylesConfig([style], bodyText, headings, unorderedLists, docLocale)[0]!;

  const write = (next: CalloutStyleConfig[]) => {
    dispatch({
      type: 'UPDATE_CONFIG',
      payload: { calloutStyles: next.length > 0 ? next : undefined },
    });
  };

  const addStyle = () => {
    const id = nextStyleId(styles);
    openCard('calloutStyles', id);
    write([...styles, { id, name: labels.calloutStyleNewName }]);
  };

  const duplicateStyle = (id: string) => {
    const index = styles.findIndex((s) => s.id === id);
    const source = styles[index];
    if (!source) return;
    const taken = new Set(styles.map((s) => s.id));
    const copy: CalloutStyleConfig = structuredClone({ ...source, id: uniqueId(`${source.id}-copy`, taken) });
    openCard('calloutStyles', copy.id);
    const next = styles.slice();
    next.splice(index + 1, 0, copy);
    write(next);
  };

  const updateStyle = (id: string, partial: Partial<CalloutStyleConfig>) => {
    write(styles.map((s) => (s.id === id ? { ...s, ...partial } : s)));
  };

  const resetStyleField = (id: string, field: keyof CalloutStyleConfig) => {
    write(
      styles.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s };
        delete next[field];
        return next;
      }),
    );
  };

  const renameStyle = (id: string, nextId: string) => {
    if (styles.some((s) => s.id === nextId)) return;
    moveCardState('calloutStyles', id, nextId);
    const plan = planRename({ calloutStyles: raw, pageTemplates }, styles, chapters, id, nextId);
    applyStyleRewrite(dispatch, { calloutStyles: raw, pageTemplates }, plan, labels.frameStylesRenamed.replace('__from__', id).replace('__to__', nextId), activeChapterId);
  };

  /** A removed style's children (#905) take its look over, and its parent
   *  if it had one, so no box changes. */
  const removeStyle = (id: string) => {
    const gone = styles.find((s) => s.id === id);
    write(styles.filter((s) => s.id !== id).map((s) => {
      if (!gone || s.extends !== id) return s;
      const [, child] = inheritCalloutStyles([{ ...gone, id: '__parent' }, { ...s, extends: '__parent' }]);
      return { ...child!, id: s.id, ...(s.name !== undefined ? { name: s.name } : {}), ...(gone.extends !== undefined ? { extends: gone.extends } : {}) };
    }));
  };
  /** The styles `style` may be based on: not itself, nor one based on it
   *  (directly or further down), which would close a loop. */
  const parentsOf = (style: CalloutStyleConfig) => styles
    .filter((s, i) => s.id !== style.id && !calloutStyleChain(styles, i).chain.some((k) => styles[k]?.id === style.id))
    .map((s) => ({ id: s.id, name: s.name || s.id }));

  const cardProps = (style: CalloutStyleConfig) => ({
    style,
    resolved: resolveOne(style),
    otherIds: new Set(styles.filter((s) => s.id !== style.id).map((s) => s.id)),
    parents: parentsOf(style),
    stored: raw !== undefined,
    iconResources,
    listDefaults: { bulletFontSize: unorderedLists.bulletFontSize, bulletFontWeight: unorderedLists.fontWeight, bulletFontFamily: unorderedLists.fontFamily, marginTop: unorderedLists.marginTop, marginBottom: unorderedLists.marginBottom },
    onChange: (partial: Partial<CalloutStyleConfig>) => updateStyle(style.id, partial),
    onResetField: (field: keyof CalloutStyleConfig) => resetStyleField(style.id, field),
    onRename: (nextId: string) => renameStyle(style.id, nextId),
    onDuplicate: () => duplicateStyle(style.id),
    onRemove: () => removeStyle(style.id),
  });

  return { raw, styles, resolved, addStyle, cardProps, dispatch };
}

/** Config-panel section for the named callout styles selected by
 *  `:::callout{type="…"}` (`config.calloutStyles`). While the config has no
 *  list, the built-in `note` style is shown so it can be edited in place. */
export const CalloutStylesSection = memo(function CalloutStylesSection() {
  const labels = useSandboxLabels();
  const { raw, styles, addStyle, cardProps, dispatch } = useCalloutStyleEdits();

  return (
    <CollapsibleSection
      title={labels.calloutStylesSection}
      sectionId="calloutStyles"
      hasOverrides={raw !== undefined}
      onReset={() => dispatch({ type: 'UPDATE_CONFIG', payload: { calloutStyles: undefined } })}
      resetLabel={labels.reset}
      resetConfirmMessage={labels.calloutStylesResetConfirm}
    >
      {styles.length === 0 && (
        <p className="mb-2 text-xs" style={{ color: 'var(--slate)' }}>
          {labels.calloutStylesEmpty}
        </p>
      )}
      <ItemCardListActions list="calloutStyles" ids={styles.map((s) => s.id)} />
      {styles.map((style) => (
        <CalloutStyleCard key={style.id} {...cardProps(style)} />
      ))}
      <Button variant="outline" size="xs" icon={<Plus size={12} />} onClick={addStyle} className="mt-1">
        {labels.calloutStyleAdd}
      </Button>
    </CollapsibleSection>
  );
});
