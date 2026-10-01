import { and, desc, eq, inArray, isNull, like, lt, lte, or, sql, gte } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  addMonths,
  localDate,
  periodOf,
  yearPeriods,
  type DuesCellState,
  type DuesSheet,
  type MonthFlow,
  type MyFinanceGroup,
  type PersonRef,
  type TransactionKind,
  type TransactionPage,
  type TransactionRow,
  type TreasurySummary,
} from '@church/shared';
import type { Db } from '../db/client';
import {
  groups,
  meetings,
  memberships,
  transactions,
  users,
  type Group,
  type Transaction,
} from '../db/schema';
import { getChurch } from './church';
import { signedMediaUrl } from './media';

const OUT = sql`${transactions.kind} IN ('expense', 'event_expense')`;
const signedSum = sql<number>`coalesce(sum(case when ${OUT} then -${transactions.amountCents} else ${transactions.amountCents} end), 0)`;
const live = isNull(transactions.voidedAt);

async function people(db: Db, ids: (number | null)[]): Promise<Map<number, PersonRef>> {
  const unique = [...new Set(ids.filter((x): x is number => x !== null))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function toTransactionRows(
  db: Db,
  secret: string,
  rows: Transaction[],
): Promise<TransactionRow[]> {
  const byId = await people(
    db,
    rows.flatMap((r) => [r.memberUserId, r.createdBy]),
  );
  const meetingIds = [...new Set(rows.flatMap((r) => (r.meetingId ? [r.meetingId] : [])))];
  const meetingBy = new Map(
    (meetingIds.length
      ? await db
          .select({ id: meetings.id, title: meetings.title, startsAt: meetings.startsAt })
          .from(meetings)
          .where(inArray(meetings.id, meetingIds))
      : []
    ).map((m) => [m.id, m]),
  );
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      groupId: r.groupId,
      kind: r.kind,
      amountCents: r.amountCents,
      occurredOn: r.occurredOn,
      period: r.period,
      category: r.category,
      note: r.note,
      member: r.memberUserId ? (byId.get(r.memberUserId) ?? null) : null,
      eventId: r.eventId,
      meeting: r.meetingId ? (meetingBy.get(r.meetingId) ?? null) : null,
      receiptMediaId: r.receiptMediaId,
      receiptUrl: r.receiptMediaId ? await signedMediaUrl(secret, r.receiptMediaId) : null,
      createdBy: r.createdBy ? (byId.get(r.createdBy) ?? null) : null,
      createdAt: r.createdAt,
      voided: r.voidedAt !== null,
    })),
  );
}

const PAGE = 30;

export async function listTransactions(
  db: Db,
  secret: string,
  groupId: number,
  opts: {
    kinds?: TransactionKind[];
    before?: string | null;
    eventId?: number;
    memberUserId?: number;
    meetingId?: number;
    /** Local dates "YYYY-MM-DD", inclusive. */
    from?: string;
    to?: string;
    /** Matches the person's name (donor, payer) or the note. */
    q?: string;
    /** Everything at once (for a file), not a page. */
    all?: boolean;
  },
): Promise<TransactionPage> {
  const conds = [eq(transactions.groupId, groupId), live];
  if (opts.meetingId !== undefined) conds.push(eq(transactions.meetingId, opts.meetingId));
  if (opts.from) conds.push(gte(transactions.occurredOn, opts.from));
  if (opts.to) conds.push(lte(transactions.occurredOn, opts.to));
  const q = opts.q?.trim().toLocaleLowerCase();
  if (q) {
    // SQLite can't lower-case Cyrillic, so names are matched here and notes both ways.
    const named = await db
      .selectDistinct({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(transactions)
      .innerJoin(users, eq(users.id, transactions.memberUserId))
      .where(eq(transactions.groupId, groupId));
    const ids = named
      .filter((u) => `${u.firstName} ${u.lastName ?? ''}`.toLocaleLowerCase().includes(q))
      .map((u) => u.id);
    const cap = q.charAt(0).toLocaleUpperCase() + q.slice(1);
    conds.push(
      or(
        ids.length ? inArray(transactions.memberUserId, ids) : undefined,
        like(transactions.note, `%${q}%`),
        like(transactions.note, `%${cap}%`),
        like(transactions.category, `%${q}%`),
      )!,
    );
  }
  if (opts.kinds?.length) conds.push(inArray(transactions.kind, opts.kinds));
  if (opts.eventId !== undefined) conds.push(eq(transactions.eventId, opts.eventId));
  if (opts.memberUserId !== undefined) conds.push(eq(transactions.memberUserId, opts.memberUserId));
  if (opts.before) {
    const [date, idRaw] = opts.before.split('|');
    const id = Number(idRaw);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isSafeInteger(id)) {
      conds.push(
        or(
          lt(transactions.occurredOn, date),
          and(eq(transactions.occurredOn, date), lt(transactions.id, id)),
        )!,
      );
    }
  }
  const rows = await db
    .select()
    .from(transactions)
    .where(and(...conds))
    .orderBy(desc(transactions.occurredOn), desc(transactions.id))
    .limit(opts.all ? 5000 : PAGE + 1);
  const page = opts.all ? rows : rows.slice(0, PAGE);
  const last = page[page.length - 1];
  return {
    items: await toTransactionRows(db, secret, page),
    nextCursor: !opts.all && rows.length > PAGE && last ? `${last.occurredOn}|${last.id}` : null,
  };
}

export async function balanceOf(db: Db, groupId: number): Promise<number> {
  const [row] = await db
    .select({ total: signedSum })
    .from(transactions)
    .where(and(eq(transactions.groupId, groupId), live));
  return Number(row?.total ?? 0);
}

/** Active, fee-paying members of a group. */
async function payers(db: Db, groupId: number) {
  return db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.groupId, groupId),
        eq(memberships.status, 'active'),
        eq(memberships.duesExempt, false),
      ),
    );
}

/** Dues paid per member for the given periods: Map<userId, Map<period, cents>>. */
async function duesPaid(db: Db, groupId: number, periodPrefix: string, userId?: number) {
  const rows = await db
    .select({
      userId: transactions.memberUserId,
      period: transactions.period,
      cents: sql<number>`sum(${transactions.amountCents})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.groupId, groupId),
        eq(transactions.kind, 'dues'),
        live,
        like(transactions.period, `${periodPrefix}%`),
        userId === undefined ? undefined : eq(transactions.memberUserId, userId),
      ),
    )
    .groupBy(transactions.memberUserId, transactions.period);
  const out = new Map<number, Map<string, number>>();
  for (const r of rows) {
    if (r.userId === null || r.period === null) continue;
    const m = out.get(r.userId) ?? new Map<string, number>();
    m.set(r.period, Number(r.cents));
    out.set(r.userId, m);
  }
  return out;
}

export async function treasurySummary(db: Db, group: Group): Promise<TreasurySummary> {
  const church = await getChurch(db);
  const today = localDate(Date.now(), church.timezone);
  const current = periodOf(today);
  const first = addMonths(current, -5);
  const year = Number(today.slice(0, 4));

  const [balance, flows, yearRows, donorRows, payerRows, paidNow] = await Promise.all([
    balanceOf(db, group.id),
    db
      .select({
        month: sql<string>`substr(${transactions.occurredOn}, 1, 7)`,
        income: sql<number>`coalesce(sum(case when ${OUT} then 0 else ${transactions.amountCents} end), 0)`,
        expense: sql<number>`coalesce(sum(case when ${OUT} then ${transactions.amountCents} else 0 end), 0)`,
      })
      .from(transactions)
      .where(
        and(eq(transactions.groupId, group.id), live, gte(transactions.occurredOn, `${first}-01`)),
      )
      .groupBy(sql`substr(${transactions.occurredOn}, 1, 7)`),
    db
      .select({
        kind: transactions.kind,
        category: transactions.category,
        cents: sql<number>`sum(${transactions.amountCents})`,
      })
      .from(transactions)
      .where(
        and(eq(transactions.groupId, group.id), live, like(transactions.occurredOn, `${year}-%`)),
      )
      .groupBy(transactions.kind, transactions.category),
    db
      .select({
        userId: transactions.memberUserId,
        cents: sql<number>`sum(${transactions.amountCents})`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.groupId, group.id),
          live,
          eq(transactions.kind, 'donation'),
          like(transactions.occurredOn, `${year}-%`),
        ),
      )
      .groupBy(transactions.memberUserId),
    payers(db, group.id),
    duesPaid(db, group.id, current),
  ]);

  const flowMap = new Map(flows.map((f) => [f.month, f]));
  const series: MonthFlow[] = Array.from({ length: 6 }, (_, i) => {
    const month = addMonths(first, i);
    const f = flowMap.get(month);
    return { month, incomeCents: Number(f?.income ?? 0), expenseCents: Number(f?.expense ?? 0) };
  });

  const expenseByCategory = new Map<string | null, number>();
  const incomeByKind = new Map<TransactionKind, number>();
  for (const r of yearRows) {
    const cents = Number(r.cents);
    if (r.kind === 'expense' || r.kind === 'event_expense') {
      const key = r.kind === 'event_expense' ? 'events' : r.category;
      expenseByCategory.set(key, (expenseByCategory.get(key) ?? 0) + cents);
    } else {
      incomeByKind.set(r.kind, (incomeByKind.get(r.kind) ?? 0) + cents);
    }
  }

  const donorPeople = await people(
    db,
    donorRows.map((d) => d.userId),
  );
  const fee = group.monthlyFeeCents;
  let paidCount = 0;
  let collected = 0;
  for (const [, periods] of paidNow) collected += periods.get(current) ?? 0;
  for (const p of payerRows) {
    const paid = paidNow.get(p.userId)?.get(current) ?? 0;
    if (paid > 0 && paid >= fee) paidCount++;
  }

  return {
    currency: church.currency,
    monthlyFeeCents: fee,
    membersSeeTreasury: group.membersSeeTreasury,
    meetingBudgetCents: group.meetingBudgetCents,
    balanceCents: balance,
    month: series[series.length - 1]!,
    series,
    dues: { period: current, payers: payerRows.length, paid: paidCount, collectedCents: collected },
    expenseByCategory: [...expenseByCategory]
      .map(([category, cents]) => ({ category, cents }))
      .sort((a, b) => b.cents - a.cents),
    incomeByKind: [...incomeByKind]
      .map(([kind, cents]) => ({ kind, cents }))
      .sort((a, b) => b.cents - a.cents),
    donors: donorRows
      .map((d) => ({
        member: d.userId ? (donorPeople.get(d.userId) ?? null) : null,
        cents: Number(d.cents),
        count: Number(d.count),
      }))
      .sort((a, b) => b.cents - a.cents),
    year,
  };
}

function cellState(
  period: string,
  paid: number,
  fee: number,
  opts: { current: string; since: string | null; exempt: boolean },
): DuesCellState {
  if (paid > 0 && paid >= fee) return 'paid';
  if (paid > 0) return 'partial';
  if (period > opts.current) return 'future';
  if (opts.exempt || fee === 0 || (opts.since !== null && period < opts.since)) return 'none';
  return 'unpaid';
}

export async function duesSheet(db: Db, group: Group, year: number): Promise<DuesSheet> {
  const church = await getChurch(db);
  const current = periodOf(localDate(Date.now(), church.timezone));
  const periods = yearPeriods(year);
  const fee = group.monthlyFeeCents;

  const [members, paid] = await Promise.all([
    db
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        telegramId: users.telegramId,
        exempt: memberships.duesExempt,
        joinedAt: memberships.joinedAt,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.groupId, group.id), eq(memberships.status, 'active')))
      .orderBy(users.firstName, users.lastName),
    duesPaid(db, group.id, `${year}-`),
  ]);

  const totals = periods.map(() => 0);
  const rows = members.map((m) => {
    const since = periodOf(localDate(m.joinedAt ?? m.createdAt, church.timezone));
    const mine = paid.get(m.userId);
    let paidCents = 0;
    let owedMonths = 0;
    const cells = periods.map((period, i) => {
      const cents = mine?.get(period) ?? 0;
      paidCents += cents;
      totals[i]! += cents;
      const state = cellState(period, cents, fee, { current, since, exempt: m.exempt });
      if (state === 'unpaid' || state === 'partial') owedMonths++;
      return { period, paidCents: cents, state };
    });
    return {
      member: {
        id: m.userId,
        firstName: m.firstName,
        lastName: m.lastName,
        offline: m.telegramId === null,
      },
      exempt: m.exempt,
      since,
      cells,
      paidCents,
      owedMonths,
    };
  });

  return {
    year,
    currency: church.currency,
    feeCents: fee,
    currentPeriod: current,
    periods,
    rows,
    totals,
  };
}

/** Records dues for several months at once; months already fully paid are skipped. */
export async function payDues(
  db: Db,
  group: Group,
  actorId: number,
  input: { userId: number; periods: string[]; amountCents?: number; occurredOn?: string },
): Promise<{ created: number[]; skipped: string[] }> {
  const member = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(eq(memberships.groupId, group.id), eq(memberships.userId, input.userId)),
  });
  if (!member) throw new HTTPException(400, { message: 'not_a_member' });
  const amount = input.amountCents ?? group.monthlyFeeCents;
  if (amount <= 0) throw new HTTPException(400, { message: 'no_fee' });

  const church = await getChurch(db);
  const occurredOn = input.occurredOn ?? localDate(Date.now(), church.timezone);
  const periods = [...new Set(input.periods)].sort();
  const already = await duesPaid(db, group.id, '', input.userId);
  const mine = already.get(input.userId);
  const skipped = periods.filter((p) => {
    const paid = mine?.get(p) ?? 0;
    return paid > 0 && paid >= group.monthlyFeeCents;
  });
  const todo = periods.filter((p) => !skipped.includes(p));
  if (todo.length === 0) return { created: [], skipped };

  const inserted = await db
    .insert(transactions)
    .values(
      todo.map((period) => ({
        groupId: group.id,
        kind: 'dues' as const,
        amountCents: amount,
        occurredOn,
        memberUserId: input.userId,
        period,
        createdBy: actorId,
      })),
    )
    .returning({ id: transactions.id });
  return { created: inserted.map((r) => r.id), skipped };
}

/** Each active membership of the user: own dues this year, donations, optional balance. */
export async function myFinance(db: Db, userId: number): Promise<MyFinanceGroup[]> {
  const church = await getChurch(db);
  const today = localDate(Date.now(), church.timezone);
  const current = periodOf(today);
  const year = Number(today.slice(0, 4));

  const mine = await db
    .select({
      groupId: groups.id,
      groupName: groups.name,
      fee: groups.monthlyFeeCents,
      membersSeeTreasury: groups.membersSeeTreasury,
      exempt: memberships.duesExempt,
      joinedAt: memberships.joinedAt,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, 'active'),
        isNull(groups.archivedAt),
      ),
    );

  return Promise.all(
    mine.map(async (g) => {
      const since = periodOf(localDate(g.joinedAt ?? g.createdAt, church.timezone));
      const [paid, donated, balance] = await Promise.all([
        duesPaid(db, g.groupId, `${year}-`, userId),
        db
          .select({ cents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)` })
          .from(transactions)
          .where(
            and(
              eq(transactions.groupId, g.groupId),
              eq(transactions.memberUserId, userId),
              eq(transactions.kind, 'donation'),
              live,
              like(transactions.occurredOn, `${year}-%`),
            ),
          ),
        g.membersSeeTreasury ? balanceOf(db, g.groupId) : Promise.resolve(null),
      ]);
      const cells = paid.get(userId) ?? new Map<string, number>();
      const paidPeriods: string[] = [];
      const owedPeriods: string[] = [];
      for (const period of yearPeriods(year)) {
        const state = cellState(period, cells.get(period) ?? 0, g.fee, {
          current,
          since,
          exempt: g.exempt,
        });
        if (state === 'paid') paidPeriods.push(period);
        else if (state === 'unpaid' || state === 'partial') owedPeriods.push(period);
      }
      return {
        groupId: g.groupId,
        groupName: g.groupName,
        currency: church.currency,
        feeCents: g.fee,
        exempt: g.exempt,
        year,
        currentPeriod: current,
        paidPeriods,
        owedPeriods,
        donatedCents: Number(donated[0]?.cents ?? 0),
        balanceCents: balance,
      };
    }),
  );
}
