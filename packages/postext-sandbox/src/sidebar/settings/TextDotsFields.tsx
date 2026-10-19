'use client';

import type { Dimension, DimensionUnit, TextDotsStyle } from 'postext';
import { useSandboxLabels } from '../../context/SandboxContext';
import { DimensionInput, NestedGroup, ToggleSwitch } from '../../controls';

const DOT_UNITS: DimensionUnit[] = ['em', 'pt', 'mm', 'px'];
/** The engine's defaults (`resolveTextDots`): 0.1 em apart, 0.05 em across. */
const SPACING: Dimension = { value: 0.1, unit: 'em' };
const SIZE: Dimension = { value: 0.05, unit: 'em' };

/**
 * Letters as dots to trace (#1017), for a design text element and a chip
 * style: a switch, and the dots' spacing and size while it is on. Turned
 * off, the key goes (`undefined`); a field reset drops just its own key.
 */
export function TextDotsFields({ value, onChange }: { value: TextDotsStyle | undefined; onChange: (next: TextDotsStyle | undefined) => void }) {
  const labels = useSandboxLabels();
  const set = (field: keyof TextDotsStyle, dim: Dimension | undefined) => {
    const next: TextDotsStyle = { ...value };
    if (dim) next[field] = dim;
    else delete next[field];
    onChange(next);
  };
  return (
    <>
      <ToggleSwitch
        label={labels.textDots}
        checked={value !== undefined}
        onChange={(v) => onChange(v ? {} : undefined)}
        tooltip={labels.textDotsTooltip}
        isDefault={value === undefined}
        onReset={() => onChange(undefined)}
      />
      {value && (
        <NestedGroup>
          <DimensionInput
            label={labels.textDotsSpacing}
            value={value.spacing ?? SPACING}
            onChange={(dim: Dimension) => set('spacing', dim)}
            min={0}
            step={0.01}
            units={DOT_UNITS}
            tooltip={labels.textDotsSpacingTooltip}
            isDefault={value.spacing === undefined}
            onReset={() => set('spacing', undefined)}
          />
          <DimensionInput
            label={labels.textDotsSize}
            value={value.size ?? SIZE}
            onChange={(dim: Dimension) => set('size', dim)}
            min={0}
            step={0.01}
            units={DOT_UNITS}
            tooltip={labels.textDotsSizeTooltip}
            isDefault={value.size === undefined}
            onReset={() => set('size', undefined)}
          />
        </NestedGroup>
      )}
    </>
  );
}
