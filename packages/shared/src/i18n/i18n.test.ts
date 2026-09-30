import { describe, expect, it } from 'vitest';
import { MESSAGES, messages } from './index';
import { LOCALES } from './locales';

describe('dictionaries', () => {
  it('pluralize members correctly in each language', () => {
    expect([1, 2, 5, 21].map(MESSAGES.ru.common.members)).toEqual([
      '1 участник',
      '2 участника',
      '5 участников',
      '21 участник',
    ]);
    expect([1, 2, 10, 21, 22].map(MESSAGES.lt.common.members)).toEqual([
      '1 narys',
      '2 nariai',
      '10 narių',
      '21 narys',
      '22 nariai',
    ]);
    expect([1, 3].map(MESSAGES.en.common.members)).toEqual(['1 member', '3 members']);
  });

  it('every language defines the same keys, all non-empty', () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? keys(v, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      );
    const ruKeys = keys(MESSAGES.ru).sort();
    for (const l of LOCALES) {
      expect(keys(MESSAGES[l]).sort()).toEqual(ruKeys);
      for (const k of keys(MESSAGES[l])) {
        const v = k
          .split('.')
          .reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], MESSAGES[l]);
        if (typeof v === 'string') expect(v.trim(), `${l}.${k}`).not.toBe('');
      }
      expect(MESSAGES[l].time.every).toHaveLength(7);
    }
  });

  it('falls back to Russian for unknown locales', () => {
    expect(messages('de')).toBe(MESSAGES.ru);
    expect(messages(null)).toBe(MESSAGES.ru);
  });
});
