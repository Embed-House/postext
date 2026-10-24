import { describe, expect, it } from 'vitest';
import { collectConfigWarnings } from '../../configWarnings.js';
import { stripConfigDefaults } from '../../defaults/index.js';
import { stripExercisesDefaults } from '../../defaults/exercises.js';
import type { PostextConfig } from '../../types.js';

const warnings = (config: PostextConfig) => collectConfigWarnings(config).filter((w) => w.path.startsWith('exercise'));

describe('exercise settings checks (#1226)', () => {
  it('raises nothing for valid settings', () => {
    expect(warnings({
      exerciseStyles: [{
        id: 'ej', name: 'Ejercicio', box: 'note',
        number: { show: true, label: true, shape: 'disc', resetOn: 'h2', format: 'roman-upper', template: '{h1}.{n}' },
        instruction: { bold: false, italic: true },
        options: { labels: 'katakana', marker: 'box', layout: 'row', columns: 3, shuffle: true, bracket: true },
        blank: { look: 'dots', width: { value: 6, unit: 'em' } },
        trueFalse: { labels: ['V', 'F'], look: 'bracket' },
        match: { look: 'letters' },
        bank: { order: 'alpha', separator: ' · ' },
        area: { kind: 'tianzige', lines: 4 },
        grid: { uppercase: false },
        arithmetic: { division: 'potence', columns: 3 },
        level: { glyph: '★', empty: '☆', max: 5 },
        icons: { oral: { glyph: '♪', alt: 'Oral' } },
        answers: { italic: true },
        solutions: { placement: 'after', layout: 'key' },
        digital: { correctColor: { hex: '#00aa00', model: 'hex' } },
        marginTop: { value: 2, unit: 'em' },
      }],
      exercises: { edition: 'teacher', seed: 4, solutions: { placement: 'chapterEnd', heading: 'Soluciones' }, digital: { interactive: false, persist: false, check: 'instant' } },
    })).toEqual([]);
  });

  it('names unknown keys, words and numbering styles', () => {
    const found = warnings({
      exerciseStyles: [{ id: 'x', number: { shape: 'circle', format: 'klingon', colour: 'red' } as never, options: { labels: 'none', marker: 'tick' } as never, blank: { width: 'wide' } as never, icons: { oral: { glyf: '♪' } } as never }],
      exercises: { edition: 'pupil', digital: { check: 'live' }, sede: 2 } as never,
    });
    expect(found.map((w) => `${w.kind} ${w.path}`)).toEqual([
      'unknownConfigKey exerciseStyles[0].number.colour',
      'unknownConfigValue exerciseStyles[0].number.shape',
      'unknownNumberFormat exerciseStyles[0].number.format',
      'unknownConfigValue exerciseStyles[0].options.marker',
      'unknownConfigValue exerciseStyles[0].blank.width',
      'unknownConfigKey exerciseStyles[0].icons.oral.glyf',
      'unknownConfigKey exercises.sede',
      'unknownConfigValue exercises.edition',
      'unknownConfigValue exercises.digital.check',
    ]);
    expect(found.find((w) => w.path === 'exerciseStyles[0].number.colour')).toMatchObject({ suggestion: 'color' });
  });
});

describe('exercise settings for storage', () => {
  it('drops the defaults', () => {
    expect(stripExercisesDefaults({ edition: 'student', seed: 1, solutions: { placement: 'none', layout: 'full', heading: 'Solutions' }, digital: { interactive: true, persist: true, check: 'button' } }, 'en')).toBeUndefined();
    expect(stripExercisesDefaults({ solutions: { heading: 'Solutions' } }, 'es')).toEqual({ solutions: { heading: 'Solutions' } });
    expect(stripExercisesDefaults({ edition: 'teacher', digital: { check: 'instant', persist: true } })).toEqual({ edition: 'teacher', digital: { check: 'instant' } });
  });

  it('leaves the built-in style and default settings out of a stored config', () => {
    const stripped = stripConfigDefaults({ exerciseStyles: [{ id: 'exercise', name: 'Exercise' }], exercises: { seed: 1 } });
    expect(stripped.exerciseStyles).toBeUndefined();
    expect(stripped.exercises).toBeUndefined();
    expect(stripConfigDefaults({ exercises: { edition: 'teacher' } }).exercises).toEqual({ edition: 'teacher' });
  });
});
