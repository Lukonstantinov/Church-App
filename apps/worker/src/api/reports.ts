import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { InputFile } from 'grammy';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  DOCUMENT_MAX_BYTES,
  addDays,
  zonedToUtc,
  type AttendanceExport,
  type TreasuryExport,
} from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { attendance, meetings, memberships, transactions, users } from '../db/schema';
import { assertCan } from '../lib/access';
import { getChurch } from '../lib/church';
import { botApi, isUnreachableError } from '../lib/telegram';
import { toTransactionRows } from '../lib/treasury';
import { idParam } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

const OUT = sql`${transactions.kind} IN ('expense', 'event_expense')`;
const signed = sql<number>`coalesce(sum(case when ${OUT} then -${transactions.amountCents} else ${transactions.amountCents} end), 0)`;

function yearParam(raw: string | undefined): number {
  const y = Number(raw);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getUTCFullYear();
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The period asked for: `from`..`to` (inclusive local dates), else the whole `year`. */
function periodParam(c: { req: { query: (k: string) => string | undefined } }) {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (
    from &&
    to &&
    DAY.test(from) &&
    DAY.test(to) &&
    from <= to &&
    from >= '2000-01-01' &&
    to <= '2100-12-31'
  )
    return { from, to, year: Number(from.slice(0, 4)) };
  const year = yearParam(c.req.query('year'));
  return { from: `${year}-01-01`, to: `${year}-12-31`, year };
}

/** Data for reports, built on the phone (the Worker's CPU budget is too small for PDF/Excel). */
export const groupReportRoutes = new Hono<App>();

groupReportRoutes.get('/:id/treasury/export', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'reports');
  const { from, to, year } = periodParam(c);
  const church = await getChurch(db);
  const live = and(eq(transactions.groupId, group.id), isNull(transactions.voidedAt));
  const [rows, [opening], [closing]] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(
        and(live, gte(transactions.occurredOn, from), lt(transactions.occurredOn, addDays(to, 1))),
      )
      .orderBy(asc(transactions.occurredOn), asc(transactions.id))
      .limit(10_000),
    db
      .select({ total: signed })
      .from(transactions)
      .where(and(live, lt(transactions.occurredOn, from))),
    db
      .select({ total: signed })
      .from(transactions)
      .where(and(live, lt(transactions.occurredOn, addDays(to, 1)))),
  ]);
  const body: TreasuryExport = {
    year,
    from,
    to,
    groupName: group.name,
    currency: church.currency,
    openingCents: Number(opening?.total ?? 0),
    closingCents: Number(closing?.total ?? 0),
    transactions: await toTransactionRows(db, c.env.WEBHOOK_SECRET, rows),
  };
  return c.json(body);
});

groupReportRoutes.get('/:id/attendance/export', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'reports');
  const period = periodParam(c);
  const { year } = period;
  const { timezone } = await getChurch(db);
  const from = zonedToUtc(period.from, '00:00', timezone).toISOString();
  const to = zonedToUtc(addDays(period.to, 1), '00:00', timezone).toISOString();
  const held = await db
    .select({
      id: meetings.id,
      startsAt: meetings.startsAt,
      title: meetings.title,
      guestCount: meetings.guestCount,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.groupId, group.id),
        eq(meetings.status, 'done'),
        gte(meetings.startsAt, from),
        lt(meetings.startsAt, to),
      ),
    )
    .orderBy(asc(meetings.startsAt))
    .limit(400);
  const ids = held.map((m) => m.id);
  const marks = ids.length
    ? await db
        .select({
          meetingId: attendance.meetingId,
          userId: attendance.userId,
          status: attendance.status,
        })
        .from(attendance)
        .where(inArray(attendance.meetingId, ids))
    : [];
  // Current members, plus anyone who was marked this year but has since left.
  const active = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.groupId, group.id), eq(memberships.status, 'active')));
  const everyone = [...new Set([...active.map((a) => a.userId), ...marks.map((m) => m.userId)])];
  const people = everyone.length
    ? await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(inArray(users.id, everyone))
        .orderBy(users.firstName, users.lastName)
    : [];
  const byKey = new Map(marks.map((m) => [`${m.meetingId}:${m.userId}`, m.status]));
  const body: AttendanceExport = {
    year,
    from: period.from,
    to: period.to,
    groupName: group.name,
    meetings: held,
    rows: people.map((p) => ({
      member: p,
      statuses: held.map((m) => byKey.get(`${m.id}:${p.id}`) ?? null),
    })),
  };
  return c.json(body);
});

/**
 * POST /api/me/document?name=report.xlsx — the bot sends the uploaded file to the user's
 * own chat. Telegram's in-app browser can't reliably save downloads, a chat file can.
 */
export const documentRoutes = new Hono<App>();

const SAFE_NAME = /^[\p{L}\p{N} ._()«»–—-]{1,80}\.(pdf|xlsx)$/u;

documentRoutes.post('/', async (c) => {
  const user = c.get('user');
  if (!user.telegramId) throw new HTTPException(400, { message: 'no_telegram' });
  const name = c.req.query('name') ?? '';
  if (!SAFE_NAME.test(name)) throw new HTTPException(400, { message: 'bad_name' });
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > DOCUMENT_MAX_BYTES) throw new HTTPException(413, { message: 'too_large' });
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) throw new HTTPException(400, { message: 'empty' });
  if (bytes.length > DOCUMENT_MAX_BYTES) throw new HTTPException(413, { message: 'too_large' });
  // Only our two formats: PDF ("%PDF") or XLSX (a ZIP, "PK\x03\x04").
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!(name.endsWith('.pdf') ? isPdf : isZip)) {
    throw new HTTPException(415, { message: 'unsupported_file' });
  }
  try {
    await botApi(c.env).sendDocument(user.telegramId, new InputFile(bytes, name));
  } catch (err) {
    if (isUnreachableError(err)) throw new HTTPException(409, { message: 'bot_blocked' });
    throw err;
  }
  return c.json({ ok: true });
});
