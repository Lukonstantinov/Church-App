import { yearPeriods, type MyFinanceGroup } from '@church/shared';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { IconCoins, IconHeart, IconWallet } from './icons';
import { DuesStrip, useMoney } from './money';
import { Card } from './ui';

/** Member home: my dues this year (month strip), my donations, and the group balance if shared. */
export function MyDuesCard({ g, showGroup }: { g: MyFinanceGroup; showGroup: boolean }) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  const duesOn = g.feeCents > 0 && !g.exempt;
  if (!duesOn && g.donatedCents === 0 && g.balanceCents === null && !g.exempt) return null;

  const cells = yearPeriods(g.year).map((period) => ({
    period,
    paidCents: 0,
    state: g.paidPeriods.includes(period)
      ? ('paid' as const)
      : g.owedPeriods.includes(period)
        ? ('unpaid' as const)
        : period > g.currentPeriod
          ? ('future' as const)
          : ('none' as const),
  }));
  const owed = g.owedPeriods.length;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/12 text-accent">
          <IconCoins size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold">{t.treasury.myDues}</div>
          <div className="truncate text-[13px] text-hint">
            {showGroup ? `${g.groupName} · ` : ''}
            {g.year}
            {duesOn ? ` · ${money(g.feeCents)} ${t.treasury.perMonth}` : ''}
          </div>
        </div>
      </div>

      {g.exempt ? (
        <p className="text-[14px] text-hint">{t.treasury.exemptNote}</p>
      ) : duesOn ? (
        <>
          <div className="flex justify-between gap-1">
            {cells.map((c) => (
              <div key={c.period} className="flex flex-1 flex-col items-center gap-1">
                <DuesStrip cells={[c]} />
                <span className="text-[10px] text-hint">{f.monthShort(c.period).slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <p className={`text-[15px] font-semibold ${owed > 0 ? 'text-absent' : 'text-present'}`}>
            {owed > 0 ? t.treasury.myOwed(owed, money(owed * g.feeCents)) : t.treasury.myAllPaid}
          </p>
        </>
      ) : null}

      {(g.donatedCents > 0 || g.balanceCents !== null) && (
        <div className="flex flex-col gap-2 border-t border-hairline pt-3 text-[14px]">
          {g.donatedCents > 0 && (
            <div className="flex items-center gap-2">
              <IconHeart size={16} className="text-late" />
              <span className="flex-1 text-hint">{t.treasury.myDonations}</span>
              <span className="font-semibold tabular-nums">{money(g.donatedCents)}</span>
            </div>
          )}
          {g.balanceCents !== null && (
            <div className="flex items-center gap-2">
              <IconWallet size={16} className="text-accent" />
              <span className="flex-1 text-hint">{t.treasury.groupBalance}</span>
              <span className="font-semibold tabular-nums">{money(g.balanceCents)}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
