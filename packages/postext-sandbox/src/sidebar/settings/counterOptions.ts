import type { ResourceCounterFormat, ResourceCounterReset } from 'postext';
import type { SandboxLabels } from '../../types/labels.js';
import { arabicNumberFormatOptions, eastAsianNumberFormatOptions } from './eastAsianOptions.js';

/** The ways a counter is written: resource types, numbered boxes and
 *  numbered equations offer the same list. */
export function counterFormatOptions(labels: SandboxLabels): { value: ResourceCounterFormat; label: string }[] {
  return [
    { value: 'decimal', label: labels.counterFormatDecimal },
    { value: 'roman-lower', label: labels.counterFormatRomanLower },
    { value: 'roman-upper', label: labels.counterFormatRomanUpper },
    { value: 'alpha-lower', label: labels.counterFormatAlphaLower },
    { value: 'alpha-upper', label: labels.counterFormatAlphaUpper },
    ...eastAsianNumberFormatOptions(labels),
    ...arabicNumberFormatOptions(labels),
  ];
}

/** When a counter starts again at 1. */
export function resetOnOptions(labels: SandboxLabels): { value: ResourceCounterReset; label: string }[] {
  return [
    { value: 'never', label: labels.resetOnNever },
    { value: 'h1', label: labels.resetOnH1 },
    { value: 'h2', label: labels.resetOnH2 },
    { value: 'h3', label: labels.resetOnH3 },
    { value: 'h4', label: labels.resetOnH4 },
    { value: 'h5', label: labels.resetOnH5 },
    { value: 'h6', label: labels.resetOnH6 },
  ];
}
