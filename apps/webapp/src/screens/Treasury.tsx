import { useEffect, useState } from 'react';
import {
  displayName,
  parseAmount,
  resolveBrand,
  type GroupSummary,
  type TreasurySummary,
} from '@church/shared';
import { GroupSwitcher } from '../components/GroupSwitcher';
import {
  IconArrowDown,
  IconArrowUp,
  IconChart,
  IconHeart,
  IconSearch,
  IconWallet,
  IconX,
} from '../components/icons';
import {
  BalanceLine,
  FlowBars,
  HBars,
  TxRow,
  categoryLabel,
  mergeDues,
  useMoney,
  type LedgerEntry,
} from '../components/money';
import { TransactionSheet } from '../components/TreasurySheets';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  EmptyState,
  HeroCard,
  Pill,
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
import {
  fetchAllTransactions,
  sendDocumentToChat,
  useMe,
  useTransactions,
  useTreasury,
  useTreasurySettings,
  useSetBalance,
  useWipeTreasury,
  type LedgerFilter,
} from '../lib/queries';
import { haptic } from '../lib/telegram';
import { QuickAction } from './Overview';

type Seg = 'ledger' | 'stats';
const SEG_KEY = 'church.treasurySeg';

/** Group treasury: balance, monthly dues sheet, cash book and statistics. */
export function Treasury({ groups, active }: { groups: GroupSummary[]; active: GroupSummary }) {
  const t = useT();
  const { can } = useEnv();
  const { push } = useNav();
  const summary = useTreasury(active.id);
  const [seg, setSegState] = useState<Seg>(() => {
    const saved = storage.get(SEG_KEY);
    return saved === 'stats' ? 'stats' : 'ledger';
  });
  const setSeg = (s: Seg) => {
    setSegState(s);
    storage.set(SEG_KEY, s);
  };
  const s = summary.data;
  const [balanceOpen, setBalanceOpen] = useState(false);
  const me = useMe();

  return (
    <Screen tabs>
      <GroupSwitcher groups={groups} active={active} subtitle={t.treasury.subtitle} />

      {s ? (
        <BalanceHero
          s={s}
          onReports={
            can('reports') ? () => push({ name: 'reports', groupId: active.id }) : undefined
          }
          onSetBalance={can('money.manage') ? () => setBalanceOpen(true) : undefined}
        />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}

      {can('money.manage') && (
        <div className="grid grid-cols-3 gap-3">
          <QuickAction
            icon={<IconArrowUp size={22} />}
            tone="good"
            label={t.treasury.income}
            onClick={() => push({ name: 'newTransaction', groupId: active.id, kind: 'income' })}
          />
          <QuickAction
            icon={<IconArrowDown size={22} />}
            tone="bad"
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
          { key: 'ledger', label: t.treasury.segLedger },
          { key: 'stats', label: t.treasury.segStats },
        ]}
        value={seg}
        onChange={setSeg}
      />

      {seg === 'ledger' && (
        <LedgerPanel key={active.id} groupId={active.id} groupName={active.name} summary={s} />
      )}
      {seg === 'stats' && (s ? <StatsPanel s={s} /> : <Skeleton className="h-56 w-full" />)}
      {me.data?.user.isAdmin && can('money.manage') && (
        <WipeTreasury groupId={active.id} name={active.name} />
      )}
      {balanceOpen && s && (
        <SetBalanceSheet
          groupId={active.id}
          current={s.balanceCents}
          onClose={() => setBalanceOpen(false)}
        />
      )}
    </Screen>
  );
}

function BalanceHero({
  s,
  onReports,
  onSetBalance,
}: {
  s: TreasurySummary;
  onReports?: () => void;
  onSetBalance?: () => void;
}) {
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
      <div className="mt-2 flex items-end gap-2">
        <span className="text-[40px] font-bold leading-none tracking-tight tabular-nums">
          {money(s.balanceCents)}
        </span>
        {onSetBalance && (
          <button
            type="button"
            onClick={onSetBalance}
            aria-label={t.treasury.setBalance}
            className="mb-1 rounded-full bg-white/18 px-2.5 py-1 text-[12px] font-semibold active:scale-95"
          >
            ✎ {t.treasury.setBalance}
          </button>
        )}
      </div>
      <div className="mt-4 text-[13px] text-white/75">
        {t.treasury.monthFlow(f.periodLong(s.month.month))}
      </div>
      <div className="mt-1.5 flex gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#22c55e]/35 px-3 py-1.5 text-[15px] font-semibold tabular-nums">
          <IconArrowUp size={15} /> {money(s.month.incomeCents)}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ef4444]/35 px-3 py-1.5 text-[15px] font-semibold tabular-nums">
          <IconArrowDown size={15} /> {money(s.month.expenseCents)}
        </span>
      </div>
    </HeroCard>
  );
}

const FILTERS = {
  all: '',
  income: 'income,event_payment,dues',
  expense: 'expense,event_expense',
  donation: 'donation',
} as const;
type Filter = keyof typeof FILTERS;

/** Cash book with filters (type, name, dates) and a download of just what is shown. */
function LedgerPanel({
  groupId,
  groupName,
  summary,
}: {
  groupId: number;
  groupName: string;
  summary?: TreasurySummary;
}) {
  const t = useT();
  const { can } = useEnv();
  const f = useFmt();
  const toast = useToast();
  const me = useMe();
  const settings = useTreasurySettings(groupId);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showDates, setShowDates] = useState(false);
  const [sending, setSending] = useState(false);
  const search = useDebounced(q.trim(), 350);
  const opts: LedgerFilter = {
    q: search || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const query = useTransactions(groupId, FILTERS[filter], opts);
  const [open, setOpen] = useState<LedgerEntry | null>(null);
  const items = mergeDues(query.data?.pages.flatMap((p) => p.items) ?? []);
  const filtered = filter !== 'all' || !!search || !!from || !!to;

  const byMonth: [string, LedgerEntry[]][] = [];
  for (const tx of items) {
    const m = tx.occurredOn.slice(0, 7);
    const last = byMonth[byMonth.length - 1];
    if (last && last[0] === m) last[1].push(tx);
    else byMonth.push([m, [tx]]);
  }

  async function download() {
    if (!me.data) return;
    setSending(true);
    try {
      const all = await fetchAllTransactions(groupId, FILTERS[filter], opts);
      const { ledgerXlsx } = await import('../lib/reports');
      const parts = [
        t.treasury.filters[filter],
        search && `«${search}»`,
        (from || to) && `${from ? f.dayMonth(from) : '…'} – ${to ? f.dayMonth(to) : '…'}`,
      ].filter(Boolean);
      const blob = await ledgerXlsx(
        {
          t,
          f,
          currency: summary?.currency ?? 'EUR',
          brandHex: resolveBrand(me.data.church.brandColor).light,
        },
        t.treasury.ledgerFile(groupName),
        parts.join(' · '),
        all.items,
      );
      const name = `${t.treasury.ledgerFile(groupName)} ${f.todayInput()}`
        .replace(/[^\p{L}\p{N} ._()«»–—-]/gu, '')
        .slice(0, 75);
      await sendDocumentToChat(blob, `${name}.xlsx`);
      haptic.success();
      toast(t.treasury.downloadSent);
    } catch {
      haptic.error();
      toast(t.reports.failed, 'error');
    } finally {
      setSending(false);
    }
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
        <div className="shrink-0">
          <Pill selected={showDates || !!from || !!to} onClick={() => setShowDates((v) => !v)}>
            📅 {t.treasury.dates}
          </Pill>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="glass flex items-center gap-2 rounded-2xl px-3.5 py-2.5 shadow-card">
          <IconSearch size={18} className="shrink-0 text-hint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.treasury.search}
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-hint"
          />
          {q && (
            <button type="button" aria-label="clear" onClick={() => setQ('')}>
              <IconX size={16} className="text-hint" />
            </button>
          )}
        </label>
        {(showDates || from || to) && (
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                [t.treasury.dateFrom, from, setFrom],
                [t.treasury.dateTo, to, setTo],
              ] as const
            ).map(([label, value, set]) => (
              <label
                key={label}
                className="glass flex flex-col rounded-2xl px-3.5 py-2 shadow-card"
              >
                <span className="text-[12px] text-hint">{label}</span>
                <input
                  type="date"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className="bg-transparent text-[16px] outline-none"
                />
              </label>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button small variant="secondary" disabled={sending} onClick={() => void download()}>
            <IconArrowDown size={16} /> {sending ? t.common.saving : t.treasury.download}
          </Button>
          {filtered && (
            <Button
              small
              variant="glass"
              onClick={() => {
                setFilter('all');
                setQ('');
                setFrom('');
                setTo('');
              }}
            >
              {t.treasury.clearFilters}
            </Button>
          )}
        </div>
        <p className="px-1 text-[12px] text-hint">{t.treasury.downloadHint}</p>
      </div>

      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={<IconWallet size={26} />} title={t.treasury.empty}>
            {filtered ? undefined : t.treasury.emptyText}
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
      {query.hasNextPage && (
        <Button
          variant="glass"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {t.treasury.loadMore}
        </Button>
      )}

      {can('money.manage') && summary && (
        <Section footer={t.treasury.meetingBudgetHint}>
          <MoneyInputRow
            label={t.treasury.meetingBudget}
            cents={summary.meetingBudgetCents}
            onSave={(c) => settings.mutate({ meetingBudgetCents: c })}
          />
          <Toggle
            label={t.treasury.membersSee}
            checked={summary.membersSeeTreasury}
            disabled={settings.isPending}
            onChange={(v) => settings.mutate({ membersSeeTreasury: v })}
          />
        </Section>
      )}
      <TransactionSheet tx={open} groupId={groupId} onClose={() => setOpen(null)} />
    </>
  );
}

/** A money amount edited in place; saved when the field loses focus. */
export function MoneyInputRow({
  label,
  cents,
  onSave,
}: {
  label: string;
  cents: number;
  onSave: (cents: number) => void;
}) {
  const money = useMoney();
  const [value, setValue] = useState((cents / 100).toFixed(2));
  return (
    <label className="flex min-h-[52px] items-center gap-3 border-b border-hairline px-4 last:border-b-0">
      <span className="flex-1 text-[16px]">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const c = parseAmount(value);
          if (c !== null && c !== cents) onSave(c);
          else setValue((cents / 100).toFixed(2));
        }}
        className="w-24 rounded-lg bg-hairline px-2 py-1.5 text-right text-[16px] tabular-nums outline-none"
      />
      <span className="text-[15px] text-hint">{money.symbol}</span>
    </label>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function StatsPanel({ s }: { s: TreasurySummary }) {
  const t = useT();
  const hasFlow = s.series.some((m) => m.incomeCents || m.expenseCents);
  return (
    <>
      {hasFlow && (
        <Card className="p-4">
          <h2 className="text-[17px] font-semibold">{t.treasury.balanceChart}</h2>
          <p className="mb-3 text-[13px] text-hint">{t.treasury.balanceChartHint}</p>
          <BalanceLine series={s.series} balanceCents={s.balanceCents} />
        </Card>
      )}
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
          <FlowBars series={s.series.slice(-6)} />
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

/** Type in how much is really in the treasury now; the difference is saved as a correction. */
function SetBalanceSheet({
  groupId,
  current,
  onClose,
}: {
  groupId: number;
  current: number;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const set = useSetBalance(groupId);
  const [amount, setAmount] = useState((current / 100).toFixed(2).replace('.', ','));
  const [note, setNote] = useState('');
  const cents = parseAmount(amount.replace(/^-/, ''));
  const negative = amount.trim().startsWith('-');
  async function save() {
    if (cents === null) return;
    try {
      await set.mutateAsync({ balanceCents: negative ? -cents : cents, note: note.trim() || null });
      haptic.success();
      toast(t.treasury.balanceSet);
      onClose();
    } catch {
      toast(t.common.saveFailed, 'error');
    }
  }
  return (
    <Sheet open onClose={onClose} title={t.treasury.setBalance}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-[13px] text-hint">{t.treasury.setBalanceHint}</p>
        <input
          inputMode="decimal"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-2xl bg-hairline px-4 py-3 text-center text-[28px] font-bold tabular-nums outline-none"
        />
        <input
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.treasury.setBalanceNote}
          className="w-full rounded-xl bg-hairline px-3 py-2.5 text-[15px] outline-none placeholder:text-hint"
        />
        <Button disabled={cents === null || set.isPending} onClick={() => void save()}>
          {t.common.save}
        </Button>
      </div>
    </Sheet>
  );
}

/** Church admins: delete all of this ministry's money records (its name typed back first). */
function WipeTreasury({ groupId, name }: { groupId: number; name: string }) {
  const t = useT();
  const toast = useToast();
  const wipe = useWipeTreasury(groupId);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const ok = typed.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 self-center rounded-full px-4 py-2 text-[14px] font-semibold text-absent active:bg-absent/10"
      >
        🗑 {t.treasury.wipeTitle}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t.treasury.wipeTitle}>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <p className="text-[14px] leading-snug text-absent">{t.treasury.wipeHint}</p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`${t.treasury.wipeConfirmLabel}: ${name}`}
            className="w-full rounded-xl bg-hairline px-3 py-2.5 text-[16px] outline-none placeholder:text-hint"
          />
          <Button
            variant="destructive"
            disabled={!ok || wipe.isPending}
            onClick={() =>
              void wipe
                .mutateAsync(typed)
                .then(() => {
                  haptic.success();
                  toast(t.treasury.wipeDone);
                  setOpen(false);
                  setTyped('');
                })
                .catch(() => toast(t.treasury.wipeMismatch, 'error'))
            }
          >
            {t.treasury.wipeTitle}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
