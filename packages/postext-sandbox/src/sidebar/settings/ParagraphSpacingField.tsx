'use client';

import type { Dimension, DimensionUnit } from 'postext';
import { useSandboxLabels } from '../../context/SandboxContext';
import { DimensionInput, ToggleSwitch } from '../../controls';

/**
 * `paragraphSpacing` of the body text or of a box's body (#1115): a switch
 * (off, or one line) and, when it is on, the length between paragraphs.
 * The length shows the line it stands for while the value is `true`;
 * resetting it writes `true` again.
 */

const SPACING_UNITS: DimensionUnit[] = ['mm', 'pt', 'em', 'px'];

export function ParagraphSpacingField({
  value,
  line,
  onChange,
  isDefault,
  onReset,
}: {
  value: boolean | Dimension;
  /** The line `true` stands for, shown in the length field. */
  line: Dimension;
  onChange: (next: boolean | Dimension) => void;
  isDefault: boolean;
  onReset: () => void;
}) {
  const labels = useSandboxLabels();
  const on = typeof value === 'object' ? true : value;
  return (
    <>
      <ToggleSwitch
        label={labels.bodyParagraphSpacing}
        checked={on}
        onChange={(checked) => onChange(checked)}
        tooltip={labels.bodyParagraphSpacingTooltip}
        isDefault={isDefault}
        onReset={onReset}
      />
      {on && (
        <DimensionInput
          label={labels.bodyParagraphSpacingSize}
          value={typeof value === 'object' ? value : line}
          onChange={(dim) => onChange(dim)}
          min={0}
          step={0.25}
          units={SPACING_UNITS}
          tooltip={labels.bodyParagraphSpacingSizeTooltip}
          isDefault={value === true}
          onReset={() => onChange(true)}
        />
      )}
    </>
  );
}
