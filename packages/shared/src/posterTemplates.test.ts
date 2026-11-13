import { describe, expect, it } from 'vitest';
import { layerGroups, posterLayerSchema } from './posterTemplates';

describe('layerGroups', () => {
  it('puts sublayers with the nearest layer under them', () => {
    const l = (id: string, clip = false) => ({ id, clip });
    const groups = layerGroups([
      l('a'),
      l('a1', true),
      l('a2', true),
      l('b'),
      l('c'),
      l('c1', true),
    ]);
    expect(groups.map((g) => [g.base.id, ...g.subs.map((s) => s.id)])).toEqual([
      ['a', 'a1', 'a2'],
      ['b'],
      ['c', 'c1'],
    ]);
  });

  it('lets a sublayer with nothing under it stand on its own', () => {
    const groups = layerGroups([
      { id: 'x', clip: true },
      { id: 'y', clip: true },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.base.id).toBe('x');
    expect(groups[0]!.subs.map((s) => s.id)).toEqual(['y']);
  });
});

describe('poster layers', () => {
  it('accepts a picture far bigger than the poster, stretched, as a sublayer', () => {
    const r = posterLayerSchema.safeParse({
      type: 'image',
      id: 'p',
      mediaId: 1,
      x: 250,
      y: -120,
      size: 900,
      stretch: 2.5,
      clip: true,
    });
    expect(r.success).toBe(true);
  });
});
