import type {
  ContrastConfig,
  ContrastLevel,
  ContrastMode,
  ContrastReversedTextConfig,
  ResolvedContrastConfig,
  ResolvedContrastReversedTextConfig,
} from '../types';
import { dimensionsEqual } from './shared';

export const DEFAULT_CONTRAST_REVERSED_TEXT_CONFIG: ResolvedContrastReversedTextConfig = {
  enabled: true,
  minSize: { value: 8, unit: 'pt' },
  minFineSize: { value: 12, unit: 'pt' },
  lightWeight: 300,
};

export const DEFAULT_CONTRAST_CONFIG: ResolvedContrastConfig = {
  enabled: true,
  level: 'AA',
  mode: 'auto',
  reversedText: DEFAULT_CONTRAST_REVERSED_TEXT_CONFIG,
};

export const CONTRAST_LEVELS: readonly ContrastLevel[] = ['AA', 'AAA'];
export const CONTRAST_MODES: readonly ContrastMode[] = ['auto', 'screen', 'print', 'both'];

export function resolveContrastReversedTextConfig(partial?: ContrastReversedTextConfig): ResolvedContrastReversedTextConfig {
  const d = DEFAULT_CONTRAST_REVERSED_TEXT_CONFIG;
  const weight = partial?.lightWeight;
  return {
    enabled: partial?.enabled ?? d.enabled,
    minSize: partial?.minSize ?? d.minSize,
    minFineSize: partial?.minFineSize ?? d.minFineSize,
    lightWeight: typeof weight === 'number' && Number.isFinite(weight) ? weight : d.lightWeight,
  };
}

/** A level or a mode written otherwise reads as the default
 *  (`collectConfigWarnings` reports it). */
export function resolveContrastConfig(partial?: ContrastConfig): ResolvedContrastConfig {
  const d = DEFAULT_CONTRAST_CONFIG;
  return {
    enabled: partial?.enabled ?? d.enabled,
    level: CONTRAST_LEVELS.includes(partial?.level as ContrastLevel) ? (partial!.level as ContrastLevel) : d.level,
    mode: CONTRAST_MODES.includes(partial?.mode as ContrastMode) ? (partial!.mode as ContrastMode) : d.mode,
    reversedText: resolveContrastReversedTextConfig(partial?.reversedText),
  };
}

export function stripContrastDefaults(cfg?: ContrastConfig): ContrastConfig | undefined {
  if (!cfg) return undefined;
  const d = DEFAULT_CONTRAST_CONFIG;
  const result: ContrastConfig = {};
  if (cfg.enabled !== undefined && cfg.enabled !== d.enabled) result.enabled = cfg.enabled;
  if (cfg.level !== undefined && cfg.level !== d.level) result.level = cfg.level;
  if (cfg.mode !== undefined && cfg.mode !== d.mode) result.mode = cfg.mode;
  const r = cfg.reversedText;
  if (r) {
    const dr = d.reversedText;
    const reversed: ContrastReversedTextConfig = {};
    if (r.enabled !== undefined && r.enabled !== dr.enabled) reversed.enabled = r.enabled;
    if (r.minSize !== undefined && !dimensionsEqual(r.minSize, dr.minSize)) reversed.minSize = r.minSize;
    if (r.minFineSize !== undefined && !dimensionsEqual(r.minFineSize, dr.minFineSize)) reversed.minFineSize = r.minFineSize;
    if (r.lightWeight !== undefined && r.lightWeight !== dr.lightWeight) reversed.lightWeight = r.lightWeight;
    if (Object.keys(reversed).length > 0) result.reversedText = reversed;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
