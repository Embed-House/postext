'use client';

import type { ModuleWidth } from 'postext';
import { useSandboxLabels } from '../../../context/SandboxContext';
import { DimensionInput, NumberInput, SelectInput } from '../../../controls';

/** A module's width in its group (#1088): a share of what the row's other
 *  modules leave (unset, `'fill'`), a length, or a percentage of the
 *  group's width. */
export function ModuleWidthField({ value, isDefault, onChange }: { value: ModuleWidth | undefined; isDefault: boolean; onChange: (v: ModuleWidth | undefined) => void }) {
  const labels = useSandboxLabels();
  const mode = value === undefined || value === 'fill' ? 'fill' : 'percent' in value ? 'percent' : 'length';
  return (
    <>
      <SelectInput
        label={labels.pageTemplatesModuleWidth}
        tooltip={labels.pageTemplatesModuleWidthTooltip}
        value={mode}
        options={[
          { value: 'fill', label: labels.pageTemplatesModuleWidthFill },
          { value: 'length', label: labels.pageTemplatesModuleWidthLength },
          { value: 'percent', label: labels.pageTemplatesModuleWidthPercent },
        ]}
        onChange={(m) => onChange(m === 'length' ? { value: 80, unit: 'mm' } : m === 'percent' ? { percent: 50 } : undefined)}
        isDefault={isDefault}
        onReset={() => onChange(undefined)}
      />
      {value !== undefined && value !== 'fill' && ('percent' in value ? (
        <NumberInput
          label={labels.pageTemplatesModuleWidthPercentValue}
          value={value.percent}
          min={1}
          max={100}
          onChange={(n) => onChange({ percent: n })}
        />
      ) : (
        <DimensionInput label={labels.pageTemplatesSizeValue} value={value} onChange={(d) => onChange(d)} />
      ))}
    </>
  );
}

/** «48%», «80 mm», or the words for a share (#1088): the module library's
 *  note of a module's width. */
export function moduleWidthText(width: ModuleWidth | undefined, share: string): string {
  if (width === undefined || width === 'fill') return share;
  if ('percent' in width) return `${width.percent}%`;
  return `${width.value} ${width.unit}`;
}
