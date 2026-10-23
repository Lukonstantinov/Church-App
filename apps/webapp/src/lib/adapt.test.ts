import { describe, expect, it } from 'vitest';
import { AUTO_TTL_MS, SCALE_MIN, autoLevel, stepScale } from './adapt';

describe('shader resolution', () => {
  it('never drops below the floor and climbs back to full', () => {
    let s = 1;
    for (let i = 0; i < 20; i++) s = stepScale(s, true);
    expect(s).toBe(SCALE_MIN);
    for (let i = 0; i < 20; i++) s = stepScale(s, false);
    expect(s).toBe(1);
  });
});

describe('auto quality', () => {
  const now = 1_000_000_000_000;
  it('keeps a fresh lowered level and forgets an old one', () => {
    expect(autoLevel(`lite@${now - 1000}`, now, false)).toBe('lite');
    expect(autoLevel(`still@${now - AUTO_TTL_MS - 1}`, now, false)).toBe('full');
  });
  it("falls back to the phone's default, also for the old format without a time", () => {
    expect(autoLevel(null, now, true)).toBe('lite');
    expect(autoLevel('lite', now, false)).toBe('full');
  });
});
