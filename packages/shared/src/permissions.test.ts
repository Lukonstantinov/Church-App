import { describe, expect, it } from 'vitest';
import { resolveBrand, whiteContrast } from './brand';
import { normalizePermissions } from './permissions';

describe('normalizePermissions', () => {
  it('adds implied rights, drops unknown ones, keeps a stable order', () => {
    expect(normalizePermissions(['money.manage', 'nope', 'money.manage'])).toEqual([
      'people.view',
      'money.view',
      'money.manage',
    ]);
    expect(normalizePermissions([])).toEqual([]);
  });
});

describe('resolveBrand', () => {
  it('uses palette keys as-is and falls back to the default', () => {
    expect(resolveBrand('ocean').light).toBe('#0369a1');
    expect(resolveBrand('nonsense').light).toBe('#2563eb');
  });
  it('darkens light custom colours until white text is readable', () => {
    for (const hex of ['#ffee00', '#a0e8ff', '#ff66aa', '#123456']) {
      expect(whiteContrast(resolveBrand(hex).light)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
