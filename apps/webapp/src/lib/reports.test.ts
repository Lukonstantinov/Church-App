import { describe, expect, it } from 'vitest';
import { messages } from '@church/shared';
import { treasuryPdf } from './reports';

describe('treasury pdf', () => {
  it('builds with the coloured summary, month chart and bars', async () => {
    const t = messages('ru');
    const f = {
      money: (c: number) => `${(c / 100).toFixed(2)} €`,
      dayMonth: (s: string) => s.slice(0, 10),
      monthShort: (p: string) => p,
      ddmm: (s: string) => s.slice(5, 10),
    } as never;
    const tx = (
      id: number,
      kind: string,
      cents: number,
      on: string,
      category: string | null = null,
    ) =>
      ({
        id,
        kind,
        amountCents: cents,
        occurredOn: on,
        category,
        note: null,
        member: null,
        periods: [],
        meeting: null,
        receiptUrl: null,
        createdBy: null,
        voidedAt: null,
      }) as never;
    const blob = await treasuryPdf(
      { t, f, currency: 'EUR', brandHex: '#dc2626' },
      {
        year: 2026,
        from: '2026-01-01',
        to: '2026-10-07',
        groupName: 'Молодежка',
        currency: 'EUR',
        openingCents: 10000,
        closingCents: 25000,
        transactions: [
          tx(1, 'income', 20000, '2026-08-03'),
          tx(2, 'expense', 5000, '2026-09-10', 'food'),
          tx(3, 'donation', 3000, '2026-10-01'),
          tx(4, 'expense', 3000, '2026-10-02', 'correction'),
        ],
      },
      null,
    );
    expect(blob.size).toBeGreaterThan(1000);
  }, 60000);
});
