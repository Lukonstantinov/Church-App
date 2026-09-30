import { describe, expect, it } from 'vitest';
import { displayName, plural } from './format';

describe('plural', () => {
  const forms: [string, string, string] = ['встреча', 'встречи', 'встреч'];
  it.each([
    [1, 'встреча'],
    [2, 'встречи'],
    [5, 'встреч'],
    [11, 'встреч'],
    [21, 'встреча'],
    [22, 'встречи'],
  ])('%i → %s', (n, expected) => {
    expect(plural(n, forms)).toBe(expected);
  });
});

describe('displayName', () => {
  it('joins first and last name', () => {
    expect(displayName({ firstName: 'Анна', lastName: 'Петрова' })).toBe('Анна Петрова');
    expect(displayName({ firstName: 'Анна', lastName: null })).toBe('Анна');
  });
});
