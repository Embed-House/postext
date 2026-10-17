'use client';

import { memo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ColorValue, Dimension, DimensionUnit, LabelStyle, ParagraphStyleConfig } from 'postext';
import { resolveBodyTextConfig } from 'postext';
import { useSandboxDispatch, useSandboxLabels, useSandboxSelector } from '../../context/SandboxContext';
import { CollapsibleSection, ColorPicker, DimensionInput, FontPicker, NumberInput, SelectInput, ToggleSwitch } from '../../controls';
import { Button, ConfirmPopover, IconButton } from '../../ui';
import { FieldRow } from '../../controls/FieldRow';
import { SearchScope } from '../search/SearchScope';

const SIZE_UNITS: DimensionUnit[] = ['pt', 'px', 'mm', 'cm', 'in', 'em'];
const HALO_UNITS: DimensionUnit[] = ['px', 'pt', 'em'];
const PLATE_UNITS: DimensionUnit[] = ['px', 'pt', 'em'];

/** What a halo or a plate starts as when it is switched on: white, so
 *  dark lettering reads on a busy picture. */
const WHITE: ColorValue = { hex: '#ffffff', model: 'hex' };
const DEFAULT_HALO: NonNullable<LabelStyle['halo']> = { color: WHITE, width: { value: 2, unit: 'px' } };
const DEFAULT_PADDING: Dimension = { value: 2, unit: 'px' };
/** The value of the select that stands for "the field is not written". */
const INHERIT = '__inherit__';
const NO_PARAGRAPH_STYLE = '';

const inputClass = 'min-w-0 flex-1 rounded border bg-transparent px-1.5 py-1 text-xs';
const inputStyle = { borderColor: 'var(--pt-control-border)', color: 'var(--foreground)' } as const;

/** Turn free text into a `style="…"`-friendly id. */
function slugifyStyleId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nextStyleId(existing: LabelStyle[]): string {
  const taken = new Set(existing.map((s) => s.id));
  let n = existing.length + 1;
  while (taken.has(`label-${n}`)) n++;
  return `label-${n}`;
}

interface LabelStyleCardProps {
  style: LabelStyle;
  paragraphStyles: readonly ParagraphStyleConfig[];
  /** The body text: what the fields show while unset. */
  bodyFamily: string;
  bodyWeight: number;
  bodyColor: ColorValue;
  otherIds: Set<string>;
  onChange: (partial: Partial<LabelStyle>) => void;
  onResetField: (field: keyof LabelStyle) => void;
  onRename: (nextId: string) => void;
  onRemove: () => void;
}

/** One label style (#969): id (renamed on blur / Enter, never to a
 *  colliding id), display name, the type (a paragraph style to borrow, then
 *  face, size, weight, slant, colour, capitals, tracking), the halo and
 *  plate behind the letters, and how a label is fitted (smallest scale,
 *  writing mode, overlap). Unset fields show what they inherit. */
function LabelStyleCard({ style, paragraphStyles, bodyFamily, bodyWeight, bodyColor, otherIds, onChange, onResetField, onRename, onRemove }: LabelStyleCardProps) {
  const labels = useSandboxLabels();
  const [idDraft, setIdDraft] = useState(style.id);
  const draftSlug = slugifyStyleId(idDraft);
  const idTaken = draftSlug.length > 0 && draftSlug !== style.id && otherIds.has(draftSlug);
  const idEmpty = draftSlug.length === 0;

  const commitId = () => {
    if (idEmpty || idTaken) {
      setIdDraft(style.id);
      return;
    }
    setIdDraft(draftSlug);
    if (draftSlug !== style.id) onRename(draftSlug);
  };

  const unset = (field: keyof LabelStyle) => style[field] === undefined;
  const reset = (field: keyof LabelStyle) => () => onResetField(field);
  const sectionId = `labelStyles.${style.id}`;
  const borrowed = style.paragraphStyle !== undefined ? paragraphStyles.find((p) => p.id === style.paragraphStyle) : undefined;
  const inheritedFamily = borrowed?.fontFamily ?? bodyFamily;
  const inheritedWeight = borrowed?.fontWeight ?? bodyWeight;
  const inheritedColor = borrowed?.color ?? bodyColor;

  const paragraphOptions = [
    { value: NO_PARAGRAPH_STYLE, label: labels.labelStyleParagraphNone },
    ...paragraphStyles.map((p) => ({ value: p.id, label: p.name || p.id })),
    ...(style.paragraphStyle !== undefined && !borrowed ? [{ value: style.paragraphStyle, label: labels.labelStyleParagraphMissing.replace('__id__', style.paragraphStyle) }] : []),
  ];
  const slantOptions = [
    { value: INHERIT, label: labels.labelStyleInherited },
    { value: 'normal', label: labels.labelStyleUpright },
    { value: 'italic', label: labels.textStyleItalic },
  ];
  const caseOptions = [
    { value: INHERIT, label: labels.labelStyleInherited },
    { value: 'none', label: labels.headingTextTransformNone },
    { value: 'uppercase', label: labels.headingTextTransformUppercase },
  ];
  const writingOptions = [
    { value: 'horizontal-tb', label: labels.writingModeHorizontal },
    { value: 'vertical-rl', label: labels.writingModeVertical },
  ];
  const overlapOptions = [
    { value: 'check', label: labels.resourceLabelAnchorsOverlapCheck },
    { value: 'allow', label: labels.resourceLabelAnchorsOverlapAllow },
  ];

  return (
    <SearchScope title={`${style.name ?? ''} ${style.id}`} overridden>
    <div className="mb-3 rounded border p-2" style={{ borderColor: 'var(--rule)' }} data-style-id={style.id}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <span className="truncate text-xs font-medium" style={{ color: 'var(--foreground)' }} title={style.name ?? style.id}>
          {style.name || style.id}
        </span>
        <ConfirmPopover message={labels.labelStyleDeleteConfirm} onConfirm={onRemove}>
          {({ open }) => (
            <IconButton label={labels.chipStyleDelete} icon={<Trash2 size={13} />} destructive onClick={open} />
          )}
        </ConfirmPopover>
      </div>

      <div className="mb-2 flex flex-col gap-2">
        <FieldRow
          stacked
          label={labels.idLabel} tooltip={labels.styleIdHelp}
          hint={idTaken ? labels.chipStyleIdHintDuplicate : labels.labelStyleUsageHint.replace('__id__', style.id)}
          className="mb-0"
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
            aria-label={labels.labelStyleIdAria}
            className={inputClass}
            style={{ ...inputStyle, borderColor: idEmpty || idTaken ? 'var(--destructive)' : 'var(--rule)' }}
          />
        </FieldRow>
        <FieldRow stacked label={labels.chipStyleNameLabel} tooltip={labels.styleNameHelp} className="mb-0">
          <input
            dir="auto"
            type="text"
            value={style.name ?? ''}
            onChange={(e) => onChange({ name: e.target.value.length > 0 ? e.target.value : undefined })}
            aria-label={labels.labelStyleNameAria}
            placeholder={style.id}
            className={inputClass}
            style={inputStyle}
          />
        </FieldRow>
      </div>

      <CollapsibleSection title={labels.labelStyleTypeGroup} sectionId={`${sectionId}.type`} variant="subsection">
        <SelectInput
          label={labels.labelStyleParagraphStyle}
          tooltip={labels.labelStyleParagraphStyleTooltip}
          value={style.paragraphStyle ?? NO_PARAGRAPH_STYLE}
          options={paragraphOptions}
          onChange={(v) => (v === NO_PARAGRAPH_STYLE ? onResetField('paragraphStyle') : onChange({ paragraphStyle: v }))}
          isDefault={unset('paragraphStyle')}
          onReset={reset('paragraphStyle')}
        />
        <FontPicker
          label={labels.fontLabel}
          value={style.fontFamily ?? inheritedFamily}
          onChange={(v) => onChange({ fontFamily: v })}
          isDefault={unset('fontFamily')}
          onReset={reset('fontFamily')}
          searchPlaceholder={labels.bodyFontSearch}
          noResultsLabel={labels.bodyFontNoResults}
        />
        <DimensionInput
          label={labels.sizeLabel}
          value={style.fontSize ?? { value: 1, unit: 'em' }}
          onChange={(v) => onChange({ fontSize: v })}
          min={0.1}
          step={0.5}
          units={SIZE_UNITS}
          tooltip={labels.labelStyleFontSizeTooltip}
          isDefault={unset('fontSize')}
          onReset={reset('fontSize')}
        />
        <NumberInput
          label={labels.bodyFontWeight}
          value={style.fontWeight ?? inheritedWeight}
          onChange={(v) => onChange({ fontWeight: v })}
          min={100}
          max={900}
          step={10}
          tooltip={labels.labelStyleWeightTooltip}
          isDefault={unset('fontWeight')}
          onReset={reset('fontWeight')}
        />
        <SelectInput
          label={labels.labelStyleSlant}
          tooltip={labels.labelStyleSlantTooltip}
          value={style.fontStyle ?? INHERIT}
          options={slantOptions}
          onChange={(v) => (v === INHERIT ? onResetField('fontStyle') : onChange({ fontStyle: v as LabelStyle['fontStyle'] }))}
          isDefault={unset('fontStyle')}
          onReset={reset('fontStyle')}
        />
        <ColorPicker
          label={labels.colorLabel}
          value={style.color ?? inheritedColor}
          onChange={(v) => onChange({ color: v })}
          tooltip={labels.labelStyleColorTooltip}
          isDefault={unset('color')}
          onReset={reset('color')}
          fieldId={`labelStyle-${style.id}-color`}
        />
        <SelectInput
          label={labels.paragraphStyleTextTransform}
          tooltip={labels.labelStyleTextTransformTooltip}
          value={style.textTransform ?? INHERIT}
          options={caseOptions}
          onChange={(v) => (v === INHERIT ? onResetField('textTransform') : onChange({ textTransform: v as LabelStyle['textTransform'] }))}
          isDefault={unset('textTransform')}
          onReset={reset('textTransform')}
        />
        <NumberInput
          label={labels.paragraphStyleLetterSpacing}
          value={style.letterSpacing ?? 0}
          onChange={(v) => onChange({ letterSpacing: v })}
          min={-0.2}
          max={2}
          step={0.01}
          suffix="em"
          tooltip={labels.labelStyleLetterSpacingTooltip}
          isDefault={unset('letterSpacing')}
          onReset={reset('letterSpacing')}
        />
      </CollapsibleSection>

      <CollapsibleSection title={labels.labelStyleBackdropGroup} sectionId={`${sectionId}.backdrop`} variant="subsection">
        <ToggleSwitch
          label={labels.labelStyleHalo}
          tooltip={labels.labelStyleHaloTooltip}
          checked={style.halo !== undefined}
          onChange={(on) => (on ? onChange({ halo: DEFAULT_HALO }) : onResetField('halo'))}
          isDefault={unset('halo')}
          onReset={reset('halo')}
        />
        {style.halo && (
          <>
            <ColorPicker
              label={labels.labelStyleHaloColor}
              value={style.halo.color}
              onChange={(v) => onChange({ halo: { ...style.halo!, color: v } })}
              fieldId={`labelStyle-${style.id}-haloColor`}
            />
            <DimensionInput
              label={labels.labelStyleHaloWidth}
              value={style.halo.width}
              onChange={(v) => onChange({ halo: { ...style.halo!, width: v } })}
              min={0}
              step={0.25}
              units={HALO_UNITS}
            />
          </>
        )}
        <ToggleSwitch
          label={labels.labelStylePlate}
          tooltip={labels.labelStylePlateTooltip}
          checked={style.background !== undefined}
          onChange={(on) => (on ? onChange({ background: WHITE }) : onResetField('background'))}
          isDefault={unset('background')}
          onReset={reset('background')}
        />
        {style.background && (
          <ColorPicker
            label={labels.labelStylePlateColor}
            value={style.background}
            onChange={(v) => onChange({ background: v })}
            fieldId={`labelStyle-${style.id}-background`}
          />
        )}
        <DimensionInput
          label={labels.labelStylePadding}
          value={style.padding ?? DEFAULT_PADDING}
          onChange={(v) => onChange({ padding: v })}
          min={0}
          step={0.5}
          units={PLATE_UNITS}
          tooltip={labels.labelStylePaddingTooltip}
          isDefault={unset('padding')}
          onReset={reset('padding')}
        />
      </CollapsibleSection>

      <CollapsibleSection title={labels.labelStyleFitGroup} sectionId={`${sectionId}.fit`} variant="subsection">
        <NumberInput
          label={labels.labelStyleMinScale}
          value={style.minScale ?? 0.85}
          onChange={(v) => onChange({ minScale: v })}
          min={0.1}
          max={1}
          step={0.05}
          tooltip={labels.labelStyleMinScaleTooltip}
          isDefault={unset('minScale')}
          onReset={reset('minScale')}
        />
        <SelectInput
          label={labels.writingMode}
          tooltip={labels.labelStyleWritingModeTooltip}
          value={style.writingMode ?? 'horizontal-tb'}
          options={writingOptions}
          onChange={(v) => onChange({ writingMode: v as LabelStyle['writingMode'] })}
          isDefault={unset('writingMode')}
          onReset={reset('writingMode')}
        />
        <SelectInput
          label={labels.resourceLabelAnchorsOverlap}
          tooltip={labels.labelStyleOverlapTooltip}
          value={style.overlap ?? 'check'}
          options={overlapOptions}
          variant="segmented"
          onChange={(v) => onChange({ overlap: v as LabelStyle['overlap'] })}
          isDefault={unset('overlap')}
          onReset={reset('overlap')}
        />
      </CollapsibleSection>
    </div>
    </SearchScope>
  );
}

/** Config-panel section for the label styles (`config.labelStyles`, #969):
 *  the looks a `::label` on a picture takes, by its own `style` or its
 *  anchor's. No label style is built in, so the list starts empty. */
export const LabelStylesSection = memo(function LabelStylesSection() {
  const dispatch = useSandboxDispatch();
  const labels = useSandboxLabels();
  const raw = useSandboxSelector((s) => s.config.labelStyles);
  const paragraphStylesRaw = useSandboxSelector((s) => s.config.paragraphStyles);
  const bodyTextRaw = useSandboxSelector((s) => s.config.bodyText);
  const bodyText = resolveBodyTextConfig(bodyTextRaw);
  const styles: LabelStyle[] = raw ?? [];

  const write = (next: LabelStyle[]) => {
    dispatch({ type: 'UPDATE_CONFIG', payload: { labelStyles: next.length > 0 ? next : undefined } });
  };

  const updateStyle = (id: string, partial: Partial<LabelStyle>) => {
    write(styles.map((s) => (s.id === id ? { ...s, ...partial } : s)));
  };

  const resetStyleField = (id: string, field: keyof LabelStyle) => {
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
    write(styles.map((s) => (s.id === id ? { ...s, id: nextId } : s)));
  };

  const removeStyle = (id: string) => {
    write(styles.filter((s) => s.id !== id));
  };

  return (
    <CollapsibleSection
      title={labels.labelStylesSection}
      sectionId="labelStyles"
      hasOverrides={styles.length > 0}
      onReset={() => dispatch({ type: 'UPDATE_CONFIG', payload: { labelStyles: undefined } })}
      resetLabel={labels.reset}
      resetConfirmMessage={labels.labelStylesResetConfirm}
    >
      {styles.length === 0 && (
        <p className="mb-2 text-xs" style={{ color: 'var(--slate)' }}>
          {labels.labelStylesEmpty}
        </p>
      )}
      {styles.map((style) => (
        <LabelStyleCard
          key={style.id}
          style={style}
          paragraphStyles={paragraphStylesRaw ?? []}
          bodyFamily={bodyText.fontFamily}
          bodyWeight={bodyText.fontWeight}
          bodyColor={bodyText.color}
          otherIds={new Set(styles.filter((s) => s.id !== style.id).map((s) => s.id))}
          onChange={(partial) => updateStyle(style.id, partial)}
          onResetField={(field) => resetStyleField(style.id, field)}
          onRename={(nextId) => renameStyle(style.id, nextId)}
          onRemove={() => removeStyle(style.id)}
        />
      ))}
      <Button variant="outline" size="xs" icon={<Plus size={12} />} onClick={() => write([...styles, { id: nextStyleId(styles), name: labels.labelStyleNewName }])} className="mt-1">
        {labels.labelStyleAdd}
      </Button>
    </CollapsibleSection>
  );
});
