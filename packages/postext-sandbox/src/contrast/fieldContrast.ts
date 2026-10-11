/**
 * The contrast a colour field's colour has in the book (#748): the engine
 * lists every text and ground pair the pages set (`contrastPairs`); a field
 * holding one of those colours shows its ratio against the colours it is
 * set with. The ratios are worked out again from the field's current
 * colour, so they follow the picker before the next layout lands.
 */

import {
  blendColors,
  contrastRatio,
  contrastThreshold,
  printContrastRatio,
  type ContrastLevel,
  type ContrastMedium,
  type ContrastPair,
  type PrintContrastContext,
} from 'postext';

export interface ContrastSnapshot {
  pairs: readonly ContrastPair[];
  level: ContrastLevel;
  /** The renditions checked (`contrast.mode` resolved for the book). */
  media: readonly ContrastMedium[];
  /** The book's separation, once its output profile has loaded. */
  print?: PrintContrastContext;
  /** `contrast.enabled`. */
  enabled: boolean;
}

/** A colour the field's colour is set with. */
export interface Counterpart {
  /** What the field's colour is in the pair. */
  role: 'text' | 'ground';
  /** The other colour, as painted (`#rrggbb`). */
  other: string;
  /** The smallest size the pair is set at. */
  sizePt: number;
  large: boolean;
  required: number;
  count: number;
}

export interface FieldMeasure extends Counterpart {
  /** The ratio in each rendition checked. */
  screen?: number;
  print?: number;
  /** The lowest of them. */
  ratio: number;
  failing: boolean;
  /** The highest level the lowest ratio reaches at this size. */
  reaches?: ContrastLevel;
}

export interface FieldContrast {
  /** Furthest under its threshold first. */
  items: FieldMeasure[];
  worst: FieldMeasure;
  failing: boolean;
}

/** A colour as the pairs key it: lower case, six digits, with its alpha
 *  only when translucent. */
export function normalizeHex(hex: string | undefined): string {
  if (!hex) return '';
  let c = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{3,4}$/.test(c)) c = `#${[...c.slice(1)].map((d) => d + d).join('')}`;
  if (/^#[0-9a-f]{8}$/.test(c) && c.endsWith('ff')) c = c.slice(0, 7);
  return c;
}

const indexes = new WeakMap<readonly ContrastPair[], Map<string, Counterpart[]>>();

function indexOf(pairs: readonly ContrastPair[]): Map<string, Counterpart[]> {
  let index = indexes.get(pairs);
  if (index) return index;
  const byColor = new Map<string, Map<string, Counterpart>>();
  const add = (hex: string, role: Counterpart['role'], other: string, pair: ContrastPair) => {
    const key = normalizeHex(hex);
    let list = byColor.get(key);
    if (!list) byColor.set(key, (list = new Map()));
    const id = `${role}|${other}|${pair.required}`;
    const seen = list.get(id);
    if (seen) {
      seen.count += pair.count;
      seen.sizePt = Math.min(seen.sizePt, pair.sizePt);
    } else {
      list.set(id, { role, other, sizePt: pair.sizePt, large: pair.large, required: pair.required, count: pair.count });
    }
  };
  for (const pair of pairs) {
    add(pair.textColor, 'text', pair.background, pair);
    add(pair.groundColor, 'ground', pair.color, pair);
  }
  index = new Map([...byColor].map(([hex, list]) => [hex, [...list.values()]]));
  indexes.set(pairs, index);
  return index;
}

/** The colours `hex` is set with in the pairs: the grounds it is text on,
 *  the text colours it is the ground of. */
export function counterpartsFor(hex: string | undefined, pairs: readonly ContrastPair[]): Counterpart[] {
  return indexOf(pairs).get(normalizeHex(hex)) ?? [];
}

/** The ratios of `hex` against its counterparts, in the renditions the
 *  snapshot checks; null when it has none. */
export function measureField(hex: string, counterparts: readonly Counterpart[], snapshot: Pick<ContrastSnapshot, 'level' | 'media' | 'print'>): FieldContrast | null {
  if (counterparts.length === 0) return null;
  const withPrint = snapshot.media.includes('print') && !!snapshot.print;
  // With print alone and no profile yet, the screen ratio stands in.
  const withScreen = snapshot.media.includes('screen') || !withPrint;
  const items = counterparts.map((c): FieldMeasure => {
    const text = c.role === 'text' ? blendColors(hex, c.other) : c.other;
    const ground = c.role === 'text' ? c.other : blendColors(hex, '#ffffff');
    const large = c.large;
    const required = contrastThreshold(snapshot.level, large);
    const screen = withScreen ? contrastRatio(text, ground) : undefined;
    const print = withPrint ? printContrastRatio(text, ground, snapshot.print!) : undefined;
    const ratio = Math.min(screen ?? Infinity, print ?? Infinity);
    const reaches: ContrastLevel | undefined = ratio >= contrastThreshold('AAA', large) ? 'AAA' : ratio >= contrastThreshold('AA', large) ? 'AA' : undefined;
    return {
      ...c,
      required,
      ...(screen !== undefined ? { screen } : {}),
      ...(print !== undefined ? { print } : {}),
      ratio,
      failing: ratio < required,
      ...(reaches ? { reaches } : {}),
    };
  });
  items.sort((a, b) => a.ratio / a.required - b.ratio / b.required || b.count - a.count);
  return { items, worst: items[0]!, failing: items[0]!.failing };
}

/** A ratio as it is shown: cut, never rounded up past a threshold. */
export function ratioText(ratio: number, decimals = 1): string {
  const f = 10 ** decimals;
  return (Math.floor(ratio * f + 1e-9) / f).toFixed(decimals);
}
