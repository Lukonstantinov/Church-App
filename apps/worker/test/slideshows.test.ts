import { describe, expect, it } from 'vitest';
import type { SavedSlideshow } from '@church/shared';
import { ADMIN, api, apiJson, fakeUser } from './helpers';

const doc = (name: string) => ({
  name,
  background: { type: 'gradient', colors: ['#1d4ed8', '#7c3aed'], angle: 90 },
  layers: [{ id: 'bg1', type: 'effect', kind: 'fluted' }],
  slides: [
    {
      id: 's1',
      seconds: 4,
      transition: 'glitch',
      layers: [{ id: 't1', type: 'text', source: 'custom', text: 'THE ALTAR', size: 80 }],
    },
    { id: 's2', seconds: 3, transition: 'fade', layers: [] },
  ],
});

describe('saved slideshows', () => {
  it('saves, lists, changes and deletes a slideshow; others may not', async () => {
    const saved = await apiJson<SavedSlideshow>('/api/slideshows', {
      method: 'POST',
      user: ADMIN,
      json: doc('Алтарь'),
    });
    expect(saved.slides).toHaveLength(2);
    expect(saved.slides[0]!.layers[0]).toMatchObject({ type: 'text', text: 'THE ALTAR' });
    expect(saved.mine).toBe(true);
    const list = await apiJson<SavedSlideshow[]>('/api/slideshows', { user: ADMIN });
    expect(list.map((s) => s.name)).toContain('Алтарь');
    const changed = await apiJson<SavedSlideshow>(`/api/slideshows/${saved.id}`, {
      method: 'PUT',
      user: ADMIN,
      json: { ...doc('Алтарь 2'), slides: [doc('x').slides[1]] },
    });
    expect(changed.name).toBe('Алтарь 2');
    expect(changed.slides).toHaveLength(1);
    // Someone without the design right sees nothing and can't save.
    const stranger = fakeUser('Гость');
    expect((await api('/api/slideshows', { user: stranger })).status).toBe(403);
    expect(
      (await api('/api/slideshows', { method: 'POST', user: stranger, json: doc('x') })).status,
    ).toBe(403);
    // No slides: refused.
    expect(
      (
        await api('/api/slideshows', {
          method: 'POST',
          user: ADMIN,
          json: { ...doc('x'), slides: [] },
        })
      ).status,
    ).toBe(400);
    expect(
      (await api(`/api/slideshows/${saved.id}`, { method: 'DELETE', user: ADMIN })).status,
    ).toBe(200);
    expect(await apiJson<SavedSlideshow[]>('/api/slideshows', { user: ADMIN })).toHaveLength(0);
  });
});
