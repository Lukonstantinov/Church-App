import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, eq } from 'drizzle-orm';
import {
  MEDIA_MAX_BYTES,
  TRANSACTION_KINDS,
  createTransactionSchema,
  duesExemptSchema,
  payDuesSchema,
  setBalanceSchema,
  wipeTreasurySchema,
  localDate,
  treasurySettingsSchema,
  updateTransactionSchema,
  type TransactionKind,
} from '@church/shared';
import type { Env } from '../env';
import type { AuthVariables } from '../auth/middleware';
import { groups, meetings, memberships, transactions } from '../db/schema';
import { assertCan } from '../lib/access';
import { audit } from '../lib/audit';
import { assertGroupMedia, readImageUpload, signedMediaUrl, storeMedia } from '../lib/media';
import { getChurch } from '../lib/church';
import {
  balanceOf,
  duesSheet,
  listTransactions,
  myFinance,
  payDues,
  toTransactionRows,
  treasurySummary,
} from '../lib/treasury';
import { idParam, parseBody } from './util';

type App = { Bindings: Env; Variables: AuthVariables };

/** /api/groups/:id/{treasury,transactions,dues,media} — leaders and admins only. */
export const groupTreasuryRoutes = new Hono<App>();

groupTreasuryRoutes.get('/:id/treasury', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'money.view');
  return c.json(await treasurySummary(db, group));
});

groupTreasuryRoutes.patch('/:id/treasury', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'money.manage');
  const input = await parseBody(c, treasurySettingsSchema);
  if (Object.keys(input).length > 0) {
    await db.update(groups).set(input).where(eq(groups.id, group.id));
    await audit(db, {
      actorUserId: c.get('user').id,
      action: 'treasury_settings',
      entity: 'group',
      entityId: group.id,
      groupId: group.id,
      data: input,
    });
  }
  return c.json(await treasurySummary(db, { ...group, ...input }));
});

/**
 * Sets the balance to what is really there now (a cash count): the difference goes in as
 * one income or expense marked as a correction, so the history stays explainable.
 */
groupTreasuryRoutes.post('/:id/treasury/balance', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'money.manage');
  const { balanceCents, note } = await parseBody(c, setBalanceSchema);
  const diff = balanceCents - (await balanceOf(db, group.id));
  if (diff !== 0) {
    const { timezone } = await getChurch(db);
    await db.insert(transactions).values({
      groupId: group.id,
      kind: diff > 0 ? 'income' : 'expense',
      amountCents: Math.abs(diff),
      occurredOn: localDate(Date.now(), timezone),
      category: 'correction',
      note: note || null,
      createdBy: user.id,
    });
    await audit(db, {
      actorUserId: user.id,
      action: 'treasury_balance_set',
      entity: 'group',
      entityId: group.id,
      groupId: group.id,
      data: { balanceCents, diff },
    });
  }
  return c.json(await treasurySummary(db, group));
});

/**
 * Deletes every money record of a ministry (church admins only, with its name typed back).
 * Receipts' pictures stay in storage; the cash book starts from zero.
 */
groupTreasuryRoutes.delete('/:id/treasury', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  if (!user.isAdmin) throw new HTTPException(403, { message: 'forbidden' });
  const group = await assertCan(db, user, idParam(c), 'money.manage');
  const { confirmName } = await parseBody(c, wipeTreasurySchema);
  if (confirmName.trim().toLocaleLowerCase() !== group.name.trim().toLocaleLowerCase())
    throw new HTTPException(400, { message: 'name_mismatch' });
  const removed = await db
    .delete(transactions)
    .where(eq(transactions.groupId, group.id))
    .returning({ id: transactions.id });
  await audit(db, {
    actorUserId: user.id,
    action: 'treasury_wiped',
    entity: 'group',
    entityId: group.id,
    groupId: group.id,
    data: { count: removed.length },
  });
  return c.json(await treasurySummary(db, group));
});

groupTreasuryRoutes.get('/:id/transactions', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'money.view');
  const kinds = (c.req.query('kind') ?? '')
    .split(',')
    .filter((k): k is TransactionKind => (TRANSACTION_KINDS as readonly string[]).includes(k));
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return c.json(
    await listTransactions(db, c.env.WEBHOOK_SECRET, group.id, {
      kinds,
      before: c.req.query('before') ?? null,
      memberUserId: Number(c.req.query('member')) || undefined,
      meetingId: Number(c.req.query('meeting')) || undefined,
      from: day(c.req.query('from')),
      to: day(c.req.query('to')),
      q: c.req.query('q')?.slice(0, 60) || undefined,
      all: c.req.query('all') === '1',
    }),
  );
});

async function assertMemberOf(db: AuthVariables['db'], groupId: number, userId: number) {
  const row = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(eq(memberships.groupId, groupId), eq(memberships.userId, userId)),
  });
  if (!row) throw new HTTPException(400, { message: 'not_a_member' });
}

groupTreasuryRoutes.post('/:id/transactions', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'money.manage');
  const input = await parseBody(c, createTransactionSchema);
  if (input.memberUserId) await assertMemberOf(db, group.id, input.memberUserId);
  if (input.receiptMediaId) await assertGroupMedia(db, group.id, input.receiptMediaId);
  if (input.meetingId) {
    const m = await db.query.meetings.findFirst({
      columns: { id: true },
      where: and(eq(meetings.id, input.meetingId), eq(meetings.groupId, group.id)),
    });
    if (!m) throw new HTTPException(400, { message: 'invalid_meeting' });
  }
  const [row] = await db
    .insert(transactions)
    .values({
      groupId: group.id,
      kind: input.kind,
      amountCents: input.amountCents,
      occurredOn: input.occurredOn,
      category: input.category,
      note: input.note,
      memberUserId: input.kind === 'donation' ? (input.memberUserId ?? null) : null,
      receiptMediaId: input.receiptMediaId ?? null,
      meetingId: input.meetingId ?? null,
      createdBy: user.id,
    })
    .returning();
  const [out] = await toTransactionRows(db, c.env.WEBHOOK_SECRET, [row!]);
  return c.json(out, 201);
});

/** Raw image body (already resized in the browser). Returns an id to attach. */
groupTreasuryRoutes.post('/:id/media', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), [
    'money.manage',
    'events.manage',
    'settings',
  ]);
  const { bytes, mime } = await readImageUpload(c.req, MEDIA_MAX_BYTES);
  const kind = c.req.query('kind') === 'event' ? 'event' : 'receipt';
  const id = await storeMedia(db, { groupId: group.id, kind, bytes, mime, createdBy: user.id });
  return c.json({ id, url: await signedMediaUrl(c.env.WEBHOOK_SECRET, id) }, 201);
});

groupTreasuryRoutes.get('/:id/dues', async (c) => {
  const db = c.get('db');
  const group = await assertCan(db, c.get('user'), idParam(c), 'money.view');
  const raw = Number(c.req.query('year'));
  const year =
    Number.isInteger(raw) && raw >= 2000 && raw <= 2100 ? raw : new Date().getUTCFullYear();
  return c.json(await duesSheet(db, group, year));
});

groupTreasuryRoutes.post('/:id/dues', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'money.manage');
  const input = await parseBody(c, payDuesSchema);
  const result = await payDues(db, group, user.id, input);
  return c.json(result, 201);
});

groupTreasuryRoutes.put('/:id/dues/exempt', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const group = await assertCan(db, user, idParam(c), 'money.manage');
  const { userId, exempt } = await parseBody(c, duesExemptSchema);
  const res = await db
    .update(memberships)
    .set({ duesExempt: exempt })
    .where(and(eq(memberships.groupId, group.id), eq(memberships.userId, userId)))
    .returning({ id: memberships.id });
  if (res.length === 0) throw new HTTPException(404, { message: 'not_a_member' });
  return c.json({ ok: true });
});

/** /api/transactions/:id — void an entry, edit its note, attach a receipt. */
export const transactionRoutes = new Hono<App>();

transactionRoutes.patch('/:id', async (c) => {
  const db = c.get('db');
  const user = c.get('user');
  const tx = await db.query.transactions.findFirst({ where: eq(transactions.id, idParam(c)) });
  if (!tx) throw new HTTPException(404, { message: 'not_found' });
  await assertCan(
    db,
    user,
    tx.groupId,
    tx.eventId ? ['money.manage', 'events.manage'] : 'money.manage',
  );
  const input = await parseBody(c, updateTransactionSchema);
  if (tx.voidedAt) throw new HTTPException(409, { message: 'voided' });
  if (input.receiptMediaId) await assertGroupMedia(db, tx.groupId, input.receiptMediaId);

  const patch: Partial<typeof transactions.$inferInsert> = {};
  if (input.note !== undefined) patch.note = input.note;
  if (input.receiptMediaId !== undefined) patch.receiptMediaId = input.receiptMediaId;
  if (input.voided) {
    patch.voidedAt = new Date().toISOString();
    patch.voidedBy = user.id;
  }
  const [row] = Object.keys(patch).length
    ? await db.update(transactions).set(patch).where(eq(transactions.id, tx.id)).returning()
    : [tx];
  if (input.voided) {
    await audit(db, {
      actorUserId: user.id,
      action: 'transaction_voided',
      entity: 'transaction',
      entityId: tx.id,
      groupId: tx.groupId,
      data: { kind: tx.kind, amountCents: tx.amountCents },
    });
  }
  const [out] = await toTransactionRows(db, c.env.WEBHOOK_SECRET, [row!]);
  return c.json(out);
});

/** GET /api/me/finance — the user's own dues and donations. */
export const myFinanceRoutes = new Hono<App>();

myFinanceRoutes.get('/', async (c) => c.json(await myFinance(c.get('db'), c.get('user').id)));
