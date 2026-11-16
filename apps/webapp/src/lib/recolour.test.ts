import { describe, expect, it } from 'vitest';
import { posterLayerSchema } from '@church/shared';
import { designColours, hueBetween, mainColour, recolourDoc, shiftHex } from './recolour';

describe('colour variants', () => {
  it('turns a colour round the wheel and back', () => {
    expect(shiftHex('#ff0000', 120)).toBe('#00ff00');
    expect(shiftHex('#ff0000', 240)).toBe('#0000ff');
    expect(shiftHex(shiftHex('#e8402c', 77), -77)).toBe('#e8402c');
  });

  it('leaves white, black and grey alone', () => {
    for (const c of ['#ffffff', '#000000', '#808080']) expect(shiftHex(c, 150)).toBe(c);
  });

  it('finds the turn that makes one colour another', () => {
    expect(hueBetween('#ff0000', '#0000ff')).toBe(240);
    expect(shiftHex('#ff0000', hueBetween('#ff0000', '#0000ff'))).toBe('#0000ff');
  });

  it('takes a strong colour as the main one, not white text', () => {
    expect(mainColour(['#ffffff', '#e8402c', '#111111'])).toBe('#e8402c');
    expect(mainColour(['#ffffff', '#000000'])).toBeNull();
  });

  it('recolours every part of a poster and keeps it valid', () => {
    const layers = [
      posterLayerSchema.parse({ id: 'f', type: 'fill', colors: ['#ff0000', '#ffffff'] }),
      posterLayerSchema.parse({
        id: 't',
        type: 'text',
        color: '#00ff00',
        style: { glow: '#0000ff' },
        effects: [{ kind: 'silk', tune: { colors: ['#ff0000'] } }],
      }),
      posterLayerSchema.parse({ id: 'i', type: 'image', mediaId: 1, adjust: { hue: 170 } }),
    ];
    const doc = {
      background: { type: 'gradient' as const, colors: ['#ff0000', '#000000'], angle: 160 },
      layers,
      frame: { width: 1, color: '#ff0000', inset: 3, radius: 0 },
    };
    const out = recolourDoc(doc, 120, true);
    expect(out.background.colors).toEqual(['#00ff00', '#000000']);
    expect(out.frame?.color).toBe('#00ff00');
    const [fill, text, image] = out.layers;
    expect(fill).toMatchObject({ colors: ['#00ff00', '#ffffff'] });
    expect(text).toMatchObject({ color: '#0000ff', style: { glow: '#ff0000' } });
    expect(text).toMatchObject({ effects: [{ tune: { colors: ['#00ff00'] } }] });
    // 170° + 120° goes round to −70°, inside what the hue slider allows.
    expect(image).toMatchObject({ adjust: { hue: -70 } });
    for (const l of out.layers) expect(posterLayerSchema.safeParse(l).success).toBe(true);
    // The original is untouched.
    expect(doc.background.colors[0]).toBe('#ff0000');
    expect(designColours(doc)[0]).toBe('#ff0000');
  });

  it('keeps every effect on the layers, with its settings', () => {
    const layers = [
      posterLayerSchema.parse({
        id: 'f',
        type: 'fill',
        colors: ['#ff0000'],
        effects: [{ kind: 'snow', tune: { speed: 2, density: 1.5 } }, { kind: 'silk' }],
      }),
      posterLayerSchema.parse({
        id: 'e',
        type: 'effect',
        kind: 'aurora',
        tune: { speed: 0.5, color: '#ff0000', seed: 7 },
        fade: 0.4,
      }),
    ];
    const doc = {
      background: { type: 'color' as const, colors: ['#ff0000'], angle: 160 },
      layers,
    };
    const [fill, effect] = recolourDoc(doc, 120).layers;
    // Same effects in the same order; only colours of their own are turned.
    expect(fill).toMatchObject({
      colors: ['#00ff00'],
      effects: [{ kind: 'snow', tune: { speed: 2, density: 1.5 } }, { kind: 'silk' }],
    });
    expect(effect).toMatchObject({
      kind: 'aurora',
      fade: 0.4,
      tune: { speed: 0.5, color: '#00ff00', seed: 7 },
    });
  });
});
