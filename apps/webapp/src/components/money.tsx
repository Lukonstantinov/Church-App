import { useMemo, type ReactNode } from 'react';
import {
  INTL_LOCALE,
  displayName,
  isOutgoing,
  type DuesCell,
  type Messages,
  type MonthFlow,
  type TransactionKind,
  type TransactionRow,
} from '@church/shared';
import { useFmt } from '../lib/format';
import { useI18n, useT } from '../lib/i18n';
import { useMe } from '../lib/queries';
import {
  IconArrowDown,
  IconArrowUp,
  IconCalendar,
  IconCoins,
  IconHeart,
  IconReceipt,
} from './icons';

/** Money formatting in the church currency. */
export function useMoney() {
  const f = useFmt();
  const { locale } = useI18n();
  const currency = useMe().data?.church.currency ?? 'EUR';
  return useMemo(() => {
    const parts = new Intl.NumberFormat(INTL_LOCALE[locale], {
      style: 'currency',
      currency,
    }).formatToParts(0);
    const symbol = parts.find((p) => p.type === 'currency')?.value ?? currency;
    const format = (cents: number, opts?: { sign?: boolean }) => f.money(cents, currency, opts);
    return Object.assign(format, { symbol, currency });
  }, [f, currency, locale]);
}

/** Category key → label; free text passes through. */
export function categoryLabel(t: Messages, category: string | null): string {
  if (!category) return t.treasury.noCategory;
  return (t.treasury.categories as Record<string, string>)[category] ?? category;
}

const KIND_STYLE: Record<TransactionKind, { tone: string; icon: ReactNode }> = {
  // Money coming in points up (green); money going out points down (red).
  income: { tone: 'bg-present/15 text-present', icon: <IconArrowUp size={18} /> },
  expense: { tone: 'bg-absent/13 text-absent', icon: <IconArrowDown size={18} /> },
  donation: { tone: 'bg-late/15 text-late', icon: <IconHeart size={18} /> },
  dues: { tone: 'bg-brand/14 text-accent', icon: <IconCoins size={18} /> },
  event_payment: { tone: 'bg-brand/14 text-accent', icon: <IconCalendar size={18} /> },
  event_expense: { tone: 'bg-absent/13 text-absent', icon: <IconCalendar size={18} /> },
};

export function KindIcon({ kind, size = 38 }: { kind: TransactionKind; size?: number }) {
  const s = KIND_STYLE[kind];
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl ${s.tone}`}
      style={{ width: size, height: size }}
    >
      {s.icon}
    </span>
  );
}

export function Amount({
  kind,
  cents,
  className = '',
  voided,
}: {
  kind: TransactionKind;
  cents: number;
  className?: string;
  voided?: boolean;
}) {
  const money = useMoney();
  const out = isOutgoing(kind);
  return (
    <span
      className={`font-semibold tabular-nums ${voided ? 'text-hint line-through' : out ? 'text-absent' : 'text-present'} ${className}`}
    >
      {money(out ? -cents : cents, { sign: true })}
    </span>
  );
}

/** A list entry: one cash-book row, or several dues months paid together (shown as one). */
export type LedgerEntry = TransactionRow & { ids: number[]; periods: string[] };

/** Merges dues rows recorded in one go (same member, date and moment) into one entry. */
export function mergeDues(rows: TransactionRow[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (
      last &&
      r.kind === 'dues' &&
      last.kind === 'dues' &&
      r.member?.id === last.member?.id &&
      r.occurredOn === last.occurredOn &&
      r.createdAt.slice(0, 19) === last.createdAt.slice(0, 19)
    ) {
      last.ids.push(r.id);
      if (r.period) last.periods.push(r.period);
      last.amountCents += r.amountCents;
      continue;
    }
    out.push({ ...r, ids: [r.id], periods: r.period ? [r.period] : [] });
  }
  for (const e of out) e.periods.sort();
  return out;
}

/** "Октябрь 2026" or "янв–сен 2026" for a set of dues months. */
export function usePeriodRange() {
  const f = useFmt();
  return (periods: string[]) => {
    const first = periods[0];
    const last = periods[periods.length - 1];
    if (!first || !last) return '';
    if (first === last) return f.periodLong(first);
    return first.slice(0, 4) === last.slice(0, 4)
      ? `${f.monthShort(first)}–${f.monthShort(last)} ${last.slice(0, 4)}`
      : `${f.monthShort(first)} ${first.slice(0, 4)} – ${f.monthShort(last)} ${last.slice(0, 4)}`;
  };
}

/** Title and subtitle of a cash-book entry for lists. */
export function useTxText() {
  const t = useT();
  const f = useFmt();
  const range = usePeriodRange();
  return (tx: TransactionRow & { periods?: string[] }) => {
    const who = tx.member ? displayName(tx.member) : null;
    let title: string;
    let detail: string | null = tx.note;
    switch (tx.kind) {
      case 'dues':
        title = who ?? t.treasury.kinds.dues;
        detail = tx.periods?.length
          ? t.treasury.forMonth(range(tx.periods))
          : tx.period
            ? t.treasury.forMonth(f.periodLong(tx.period))
            : detail;
        break;
      case 'donation':
        title = who ?? t.treasury.anonymous;
        detail = tx.note ?? t.treasury.kinds.donation;
        break;
      case 'income':
      case 'expense':
        title = tx.category
          ? categoryLabel(t, tx.category)
          : (tx.note ?? t.treasury.kinds[tx.kind]);
        if (!tx.category) detail = null;
        break;
      default:
        title = tx.note ?? t.treasury.kinds[tx.kind];
        detail = who;
    }
    const date = f.dayMonthShort(tx.occurredOn);
    return { title, subtitle: detail ? `${date} · ${detail}` : date };
  };
}

export function TxRow({ tx, onClick }: { tx: LedgerEntry; onClick: () => void }) {
  const text = useTxText()(tx);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[60px] w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left last:border-b-0 active:bg-hairline"
    >
      <KindIcon kind={tx.kind} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-medium">{text.title}</div>
        <div className="flex items-center gap-1 truncate text-[13px] text-hint">
          {tx.receiptUrl && <IconReceipt size={13} className="shrink-0" />}
          <span className="truncate">
            {text.subtitle}
            {tx.meeting ? ` · 📅 ${tx.meeting.title}` : ''}
          </span>
        </div>
      </div>
      <Amount kind={tx.kind} cents={tx.amountCents} className="text-[16px]" />
    </button>
  );
}

const CELL_TONE: Record<DuesCell['state'], string> = {
  paid: 'bg-present',
  partial: 'bg-late',
  unpaid: 'bg-absent/70',
  none: 'bg-hairline',
  future: 'border border-hint/35',
};

/** Twelve small month markers for a member's year of dues. */
export function DuesStrip({ cells }: { cells: DuesCell[] }) {
  const f = useFmt();
  return (
    <div className="flex gap-[3px]" aria-hidden="true">
      {cells.map((c) => (
        <span
          key={c.period}
          title={f.monthShort(c.period)}
          className={`h-2.5 w-2.5 rounded-[3px] ${CELL_TONE[c.state]}`}
        />
      ))}
    </div>
  );
}

export function DuesLegend() {
  const t = useT();
  const items: [DuesCell['state'], string][] = [
    ['paid', t.treasury.legend.paid],
    ['partial', t.treasury.legend.partial],
    ['unpaid', t.treasury.legend.unpaid],
    ['none', t.treasury.legend.none],
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-hint">
      {items.map(([state, label]) => (
        <span key={state} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-[3px] ${CELL_TONE[state]}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

/** Paired bars: income (green) and expenses (red) per month. */
export function FlowBars({ series }: { series: MonthFlow[] }) {
  const f = useFmt();
  const money = useMoney();
  const max = Math.max(1, ...series.flatMap((m) => [m.incomeCents, m.expenseCents]));
  return (
    <div>
      <div className="flex h-36 items-end gap-2">
        {series.map((m, i) => (
          <div key={m.month} className="flex h-full flex-1 items-end justify-center gap-[3px]">
            {(['incomeCents', 'expenseCents'] as const).map((k) => (
              <div
                key={k}
                title={money(m[k])}
                className={`bar-grow w-full max-w-[16px] rounded-t-md transition-[height] duration-500 ${k === 'incomeCents' ? 'bg-present' : 'bg-absent/80'}`}
                style={
                  {
                    height: `${Math.max(m[k] ? 3 : 0, (m[k] / max) * 100)}%`,
                    '--i': i,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2 border-t border-hairline pt-1.5">
        {series.map((m) => (
          <div key={m.month} className="flex-1 text-center text-[11px] font-medium text-hint">
            {f.monthShort(m.month)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Labelled horizontal bars (categories, income sources, donors). */
export function HBars({
  items,
}: {
  items: { key: string; label: ReactNode; cents: number; hint?: string }[];
}) {
  const money = useMoney();
  const max = Math.max(1, ...items.map((i) => i.cents));
  return (
    <div className="flex flex-col gap-3">
      {items.map((i) => (
        <div key={i.key}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[14px]">
            <span className="min-w-0 truncate font-medium">
              {i.label}
              {i.hint && <span className="ml-1.5 text-[12px] text-hint">{i.hint}</span>}
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{money(i.cents)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-hairline">
            <div
              className="bar-grow-x brand-gradient h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.max(3, (i.cents / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The balance at the end of each month as a line that draws itself in, with a soft area
 * under it and the latest amount marked. Worked out backwards from today's balance.
 */
export function BalanceLine({
  series,
  balanceCents,
}: {
  series: MonthFlow[];
  balanceCents: number;
}) {
  const f = useFmt();
  const money = useMoney();
  // End-of-month balances: today's balance minus everything that came after each month.
  const points: number[] = [];
  let running = balanceCents;
  for (let i = series.length - 1; i >= 0; i--) {
    points.unshift(running);
    running -= series[i]!.incomeCents - series[i]!.expenseCents;
  }
  const W = 320;
  const H = 120;
  const min = Math.min(0, ...points);
  const max = Math.max(1, ...points);
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * W : W / 2);
  const y = (v: number) => H - 8 - ((v - min) / (max - min || 1)) * (H - 20);
  const line = points
    .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = points[points.length - 1] ?? 0;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {min < 0 && (
          <line
            x1="0"
            x2={W}
            y1={y(0)}
            y2={y(0)}
            stroke="currentColor"
            strokeOpacity="0.2"
            strokeDasharray="4 4"
          />
        )}
        <path d={area} fill="url(#balance-fill)" className="chart-fade" />
        <path
          d={line}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          className="chart-draw"
        />
        {points.map((v, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={i === points.length - 1 ? 5 : 2.5}
            fill={i === points.length - 1 ? 'var(--brand)' : 'white'}
            stroke="var(--brand)"
            strokeWidth="2"
            className="chart-dot"
            style={{ '--i': i } as React.CSSProperties}
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] font-medium text-hint">
        <span>{f.monthShort(series[0]!.month)}</span>
        <span className="font-bold text-[var(--text)]">{money(last)}</span>
        <span>{f.monthShort(series[series.length - 1]!.month)}</span>
      </div>
    </div>
  );
}
