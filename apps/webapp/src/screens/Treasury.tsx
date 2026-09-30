import { useState } from 'react';
import { displayName, type GroupSummary, type TreasurySummary } from '@church/shared';
import { Avatar } from '../components/Avatar';
import { GroupSwitcher } from '../components/GroupSwitcher';
import {
  IconArrowDown,
  IconArrowUp,
  IconChart,
  IconChevronRight,
  IconCoins,
  IconHeart,
  IconWallet,
} from '../components/icons';
import {
  DuesLegend,
  DuesStrip,
  FlowBars,
  HBars,
  TxRow,
  categoryLabel,
  mergeDues,
  useMoney,
  type LedgerEntry,
} from '../components/money';
import { FeeSheet, MemberDuesSheet, TransactionSheet } from '../components/TreasurySheets';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  EmptyState,
  HeroCard,
  Pill,
  ProgressBar,
  Row,
  Screen,
  Section,
  Segmented,
  Skeleton,
  Toggle,
} from '../components/ui';
import { useFmt } from '../lib/format';
import { useT } from '../lib/i18n';
import { useEnv } from '../lib/env';
import { useNav } from '../lib/nav';
import { storage } from '../lib/storage';
import { useDues, useTransactions, useTreasury, useTreasurySettings } from '../lib/queries';
import { QuickAction } from './Overview';

type Seg = 'dues' | 'ledger' | 'stats';
const SEG_KEY = 'church.treasurySeg';

/** Group treasury: balance, monthly dues sheet, cash book and statistics. */
export function Treasury({ groups, active }: { groups: GroupSummary[]; active: GroupSummary }) {
  const t = useT();
  const { can } = useEnv();
  const { push } = useNav();
  const summary = useTreasury(active.id);
  const [seg, setSegState] = useState<Seg>(() => {
    const saved = storage.get(SEG_KEY);
    return saved === 'ledger' || saved === 'stats' ? saved : 'dues';
  });
  const setSeg = (s: Seg) => {
    setSegState(s);
    storage.set(SEG_KEY, s);
  };
  const s = summary.data;

  return (
    <Screen tabs>
      <GroupSwitcher groups={groups} active={active} subtitle={t.treasury.subtitle} />

      {s ? (
        <BalanceHero
          s={s}
          onReports={
            can('reports') ? () => push({ name: 'reports', groupId: active.id }) : undefined
          }
        />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}

      {can('money.manage') && (
        <div className="grid grid-cols-3 gap-3">
          <QuickAction
            icon={<IconArrowDown size={22} />}
            label={t.treasury.income}
            onClick={() => push({ name: 'newTransaction', groupId: active.id, kind: 'income' })}
          />
          <QuickAction
            icon={<IconArrowUp size={22} />}
            label={t.treasury.expense}
            onClick={() => push({ name: 'newTransaction', groupId: active.id, kind: 'expense' })}
          />
          <QuickAction
            icon={<IconHeart size={22} />}
            label={t.treasury.quickDonation}
            onClick={() => push({ name: 'newTransaction', groupId: active.id, kind: 'donation' })}
          />
        </div>
      )}

      <Segmented
        options={[
          { key: 'dues', label: t.treasury.segDues },
          { key: 'ledger', label: t.treasury.segLedger },
          { key: 'stats', label: t.treasury.segStats },
        ]}
        value={seg}
        onChange={setSeg}
      />

      {seg === 'dues' && <DuesPanel groupId={active.id} summary={s} />}
      {seg === 'ledger' && <LedgerPanel key={active.id} groupId={active.id} />}
      {seg === 'stats' && (s ? <StatsPanel s={s} /> : <Skeleton className="h-56 w-full" />)}
    </Screen>
  );
}

function BalanceHero({ s, onReports }: { s: TreasurySummary; onReports?: () => void }) {
  const t = useT();
  const f = useFmt();
  const money = useMoney();
  return (
    <HeroCard>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-white/80">
          <IconWallet size={16} /> {t.treasury.balance}
        </span>
        {onReports && (
          <button
            type="button"
            onClick={onReports}
            className="flex h-8 items-center gap-1.5 rounded-full bg-white/18 px-3 text-[13px] font-semibold active:scale-95"
          >
            <IconChart size={15} /> {t.reports.title}
          </button>
        )}
      </div>
      <div className="mt-2 text-[40px] font-bold leading-none tracking-tight tabular-nums">
        {money(s.balanceCents)}
      </div>
      <div className="mt-4 text-[13px] text-white/75">
        {t.treasury.monthFlow(f.periodLong(s.month.month))}
      </div>
      <div className="mt-1.5 flex gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/18 px-3 py-1.5 text-[15px] font-semibold tabular-nums">
          <IconArrowDown size={15} /> {money(s.month.incomeCents)}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/18 px-3 py-1.5 text-[15px] font-semibold tabular-nums">
          <IconArrowUp size={15} /> {money(s.month.expenseCents)}
        </span>
      </div>
    </HeroCard>
  );
}

function DuesPanel({ groupId, summary }: { groupId: number; summary?: TreasurySummary }) {
  const t = useT();
  const { can } = useEnv();
  const f = useFmt();
  const money = useMoney();
  const toast = useToast();
  const thisYear = Number((summary?.dues.period ?? f.todayInput()).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const sheet = useDues(groupId, year);
  const settings = useTreasurySettings(groupId);
  const [openUser, setOpenUser] = useState<number | null>(null);
  const [feeOpen, setFeeOpen] = useState(false);
  const d = summary?.dues;
  const fee = summary?.monthlyFeeCents ?? 0;

  async function saveFee(cents: number) {
    try {
      await settings.mutateAsync({ monthlyFeeCents: cents });
      setFeeOpen(false);
      toast(t.common.saved);
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }

  return (
    <>
      {d && fee > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/12 text-accent">
              <IconCoins size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-hint">
                {t.treasury.duesMonth(f.periodLong(d.period))}
              </div>
              <div className="text-[19px] font-semibold">
                {t.treasury.duesPaidOf(d.paid, d.payers)}
              </div>
            </div>
            <div className="text-right text-[13px] text-hint">
              {t.treasury.collected(money(d.collectedCents))}
            </div>
          </div>
          <div className="mt-3">
            <ProgressBar value={d.paid} max={d.payers} />
          </div>
        </Card>
      )}

      {can('money.manage') && (
        <Section>
          <Row
            title={t.treasury.feePerMonth}
            after={summary ? (fee > 0 ? money(fee) : t.treasury.feeOff) : '…'}
            onClick={() => setFeeOpen(true)}
          />
          <Toggle
            label={t.treasury.membersSee}
            checked={summary?.membersSeeTreasury ?? false}
            disabled={!summary || settings.isPending}
            onChange={(v) => settings.mutate({ membersSeeTreasury: v })}
          />
        </Section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <button
            type="button"
            aria-label="previous year"
            className="glass flex h-9 w-9 items-center justify-center rounded-full"
            onClick={() => setYear((y) => y - 1)}
          >
            <IconChevronRight size={18} className="rotate-180" />
          </button>
          <span className="text-[17px] font-semibold tabular-nums">{year}</span>
          <button
            type="button"
            aria-label="next year"
            disabled={year >= thisYear + 1}
            className="glass flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-40"
            onClick={() => setYear((y) => y + 1)}
          >
            <IconChevronRight size={18} />
          </button>
        </div>
        {sheet.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !sheet.data || sheet.data.rows.length === 0 ? (
          <Card>
            <EmptyState title={t.treasury.noMembers} />
          </Card>
        ) : (
          <>
            <div className="glass overflow-hidden rounded-[var(--radius-card)] shadow-card">
              {sheet.data.rows.map((r) => (
                <button
                  key={r.member.id}
                  type="button"
                  onClick={() => can('money.manage') && setOpenUser(r.member.id)}
                  className="flex min-h-[64px] w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left last:border-b-0 active:bg-hairline"
                >
                  <Avatar
                    id={r.member.id}
                    firstName={r.member.firstName}
                    lastName={r.member.lastName}
                    size={38}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[16px] font-medium">
                        {displayName(r.member)}
                      </span>
                      <span
                        className={`shrink-0 text-[12px] font-semibold ${
                          r.exempt ? 'text-hint' : r.owedMonths > 0 ? 'text-absent' : 'text-present'
                        }`}
                      >
                        {r.exempt
                          ? t.treasury.exempt
                          : r.owedMonths > 0
                            ? t.treasury.owes(r.owedMonths)
                            : t.treasury.allPaid}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <DuesStrip cells={r.cells} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-2.5 px-2">
              <DuesLegend />
            </div>
          </>
        )}
      </section>

      {sheet.data && (
        <MemberDuesSheet
          groupId={groupId}
          sheet={sheet.data}
          userId={openUser}
          onClose={() => setOpenUser(null)}
        />
      )}
      <FeeSheet
        open={feeOpen}
        feeCents={fee}
        saving={settings.isPending}
        onClose={() => setFeeOpen(false)}
        onSave={(c) => void saveFee(c)}
      />
    </>
  );
}

const FILTERS = {
  all: '',
  income: 'income,event_payment',
  expense: 'expense,event_expense',
  dues: 'dues',
  donation: 'donation',
} as const;
type Filter = keyof typeof FILTERS;

function LedgerPanel({ groupId }: { groupId: number }) {
  const t = useT();
  const { can } = useEnv();
  const f = useFmt();
  const [filter, setFilter] = useState<Filter>('all');
  const q = useTransactions(groupId, FILTERS[filter]);
  const [open, setOpen] = useState<LedgerEntry | null>(null);
  const items = mergeDues(q.data?.pages.flatMap((p) => p.items) ?? []);

  const byMonth: [string, LedgerEntry[]][] = [];
  for (const tx of items) {
    const m = tx.occurredOn.slice(0, 7);
    const last = byMonth[byMonth.length - 1];
    if (last && last[0] === m) last[1].push(tx);
    else byMonth.push([m, [tx]]);
  }

  return (
    <>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {(Object.keys(FILTERS) as Filter[]).map((k) => (
          <div key={k} className="shrink-0">
            <Pill selected={filter === k} onClick={() => setFilter(k)}>
              {t.treasury.filters[k]}
            </Pill>
          </div>
        ))}
      </div>

      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={<IconWallet size={26} />} title={t.treasury.empty}>
            {t.treasury.emptyText}
          </EmptyState>
        </Card>
      ) : (
        byMonth.map(([month, txs]) => (
          <Section key={month} title={f.periodLong(month)}>
            {txs.map((tx) => (
              <TxRow key={tx.id} tx={tx} onClick={() => can('money.manage') && setOpen(tx)} />
            ))}
          </Section>
        ))
      )}
      {q.hasNextPage && (
        <Button
          variant="glass"
          onClick={() => void q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
        >
          {t.treasury.loadMore}
        </Button>
      )}
      <TransactionSheet tx={open} groupId={groupId} onClose={() => setOpen(null)} />
    </>
  );
}

function StatsPanel({ s }: { s: TreasurySummary }) {
  const t = useT();
  const hasFlow = s.series.some((m) => m.incomeCents || m.expenseCents);
  return (
    <>
      <Card className="p-4">
        <h2 className="text-[17px] font-semibold">{t.treasury.flowTitle}</h2>
        <p className="mb-3 flex items-center gap-3 text-[13px] text-hint">
          <span>{t.treasury.flowSubtitle}</span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-present" /> {t.treasury.income}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-absent/80" /> {t.treasury.expense}
          </span>
        </p>
        {hasFlow ? (
          <FlowBars series={s.series} />
        ) : (
          <p className="py-6 text-center text-[14px] text-hint">{t.treasury.noStats}</p>
        )}
      </Card>

      <StatCard title={t.treasury.incomeByKind(s.year)}>
        {s.incomeByKind.length > 0 && (
          <HBars
            items={s.incomeByKind.map((i) => ({
              key: i.kind,
              label:
                i.kind === 'income'
                  ? t.treasury.otherIncome
                  : i.kind === 'dues' || i.kind === 'donation'
                    ? t.treasury.filters[i.kind]
                    : t.treasury.kinds[i.kind],
              cents: i.cents,
            }))}
          />
        )}
      </StatCard>

      <StatCard title={t.treasury.byCategory(s.year)}>
        {s.expenseByCategory.length > 0 && (
          <HBars
            items={s.expenseByCategory.map((c) => ({
              key: c.category ?? '',
              label: categoryLabel(t, c.category),
              cents: c.cents,
            }))}
          />
        )}
      </StatCard>

      <StatCard title={t.treasury.donors(s.year)}>
        {s.donors.length > 0 && (
          <HBars
            items={s.donors.map((d) => ({
              key: String(d.member?.id ?? 'anon'),
              label: d.member ? displayName(d.member) : t.treasury.anonymous,
              hint: t.treasury.times(d.count),
              cents: d.cents,
            }))}
          />
        )}
      </StatCard>
    </>
  );
}

function StatCard({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold">
        <IconChart size={18} className="text-accent" /> {title}
      </h2>
      {children || <p className="py-3 text-center text-[14px] text-hint">{t.treasury.noStats}</p>}
    </Card>
  );
}
