import { describe, expect, it } from 'vitest';
import { nameMatches } from './search';

describe('nameMatches', () => {
  it('finds Russian names typed in English', () => {
    expect(nameMatches('Анна Иванова', 'anna')).toBe(true);
    expect(nameMatches('Женя Петров', 'zhenya')).toBe(true);
    expect(nameMatches('Женя Петров', 'Evgeny')).toBe(false);
    expect(nameMatches('Юлия Щербакова', 'yulia scherb')).toBe(true);
    expect(nameMatches('Александр', 'alexandr')).toBe(true);
    expect(nameMatches('Дмитрий Хромов', 'khromov')).toBe(true);
    expect(nameMatches('Дмитрий Хромов', 'dmitri')).toBe(true);
  });
  it('still matches the way it is written, and finds nobody else', () => {
    expect(nameMatches('Анна', 'ан')).toBe(true);
    expect(nameMatches('John Smith', 'smi')).toBe(true);
    expect(nameMatches('Анна Иванова', 'boris')).toBe(false);
    expect(nameMatches('Анна', '')).toBe(true);
  });
});
