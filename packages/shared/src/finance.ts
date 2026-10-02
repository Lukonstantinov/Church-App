import { z } from 'zod';

/** Kinds of cash-book entries. `expense` and `event_expense` subtract from the balance. */
export const TRANSACTION_KINDS = [
  'income',
  'expense',
  'donation',
  'dues',
  'event_payment',
  'event_expense',
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const isOutgoing = (kind: TransactionKind) => kind === 'expense' || kind === 'event_expense';

/** Signed amount: negative for money going out. */
export const signedCents = (kind: TransactionKind, amountCents: number) =>
  isOutgoing(kind) ? -amountCents : amountCents;

/** Suggested categories (stored as keys, shown translated; any other text is kept as-is). */
export const EXPENSE_CATEGORIES = [
  'food',
  'transport',
  'rent',
  'supplies',
  'gifts',
  'events',
  'other',
] as const;
export const INCOME_CATEGORIES = ['collection', 'sale', 'sponsor', 'church', 'other'] as const;

/** Receipts and photos are resized in the browser; the server accepts at most this many bytes. */
export const MEDIA_MAX_BYTES = 600_000;

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
/** Up to 1 000 000.00 in the church currency. */
const cents = z.number().int().positive().max(100_000_000);
const shortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const createTransactionSchema = z.object({
  kind: z.enum(['income', 'expense', 'donation']),
  amountCents: cents,
  occurredOn: date,
  category: shortText(40),
  note: shortText(300),
  /** Donor (donations) — optional: anonymous when omitted. */
  memberUserId: z.number().int().positive().nullish(),
  receiptMediaId: z.number().int().positive().nullish(),
  /** The meeting this expense or income was for. */
  meetingId: z.number().int().positive().nullish(),
});
export type CreateTransactionInput = z.input<typeof createTransactionSchema>;

export const updateTransactionSchema = z.object({
  voided: z.literal(true).optional(),
  note: shortText(300).optional(),
  receiptMediaId: z.number().int().positive().nullable().optional(),
});
export type UpdateTransactionInput = z.input<typeof updateTransactionSchema>;

export const payDuesSchema = z.object({
  userId: z.number().int().positive(),
  periods: z.array(period).min(1).max(24),
  /** Per month; defaults to the group's fee. */
  amountCents: cents.optional(),
  occurredOn: date.optional(),
});
export type PayDuesInput = z.input<typeof payDuesSchema>;

export const treasurySettingsSchema = z.object({
  monthlyFeeCents: z.number().int().min(0).max(100_000).optional(),
  membersSeeTreasury: z.boolean().optional(),
  /** Default budget for food/expenses per meeting. */
  meetingBudgetCents: z.number().int().min(0).max(1_000_000).optional(),
});
export type TreasurySettingsInput = z.input<typeof treasurySettingsSchema>;

export const duesExemptSchema = z.object({
  userId: z.number().int().positive(),
  exempt: z.boolean(),
});
export type DuesExemptInput = z.input<typeof duesExemptSchema>;

export interface PersonRef {
  id: number;
  firstName: string;
  lastName: string | null;
}

export interface TransactionRow {
  id: number;
  groupId: number;
  kind: TransactionKind;
  amountCents: number;
  occurredOn: string;
  period: string | null;
  category: string | null;
  note: string | null;
  member: PersonRef | null;
  eventId: number | null;
  meeting: { id: number; title: string; startsAt: string } | null;
  /** Signed, short-lived URL of the receipt photo. */
  receiptUrl: string | null;
  receiptMediaId: number | null;
  createdBy: PersonRef | null;
  createdAt: string;
  voided: boolean;
}

export interface TransactionPage {
  items: TransactionRow[];
  /** Pass as `before` to load older entries; null when there are no more. */
  nextCursor: string | null;
}

export interface MonthFlow {
  /** "YYYY-MM" */
  month: string;
  incomeCents: number;
  expenseCents: number;
}

export interface TreasurySummary {
  currency: string;
  monthlyFeeCents: number;
  membersSeeTreasury: boolean;
  meetingBudgetCents: number;
  balanceCents: number;
  /** Current month in the church time zone. */
  month: MonthFlow;
  /** Oldest → newest, the last 6 months including the current one. */
  series: MonthFlow[];
  dues: {
    period: string;
    payers: number;
    paid: number;
    collectedCents: number;
  };
  /** This calendar year. */
  expenseByCategory: { category: string | null; cents: number }[];
  incomeByKind: { kind: TransactionKind; cents: number }[];
  donors: { member: PersonRef | null; cents: number; count: number }[];
  year: number;
}

/** none = not owed (before joining, exempt, or no fee). */
export type DuesCellState = 'paid' | 'partial' | 'unpaid' | 'none' | 'future';

export interface DuesCell {
  period: string;
  paidCents: number;
  state: DuesCellState;
}

export interface DuesMemberRow {
  member: PersonRef & { offline: boolean };
  exempt: boolean;
  /** Month the member joined ("YYYY-MM"), or null if unknown. */
  since: string | null;
  cells: DuesCell[];
  paidCents: number;
  /** Months up to now (since joining) not fully paid; 0 for exempt members. */
  owedMonths: number;
}

export interface DuesSheet {
  year: number;
  currency: string;
  feeCents: number;
  /** The current month; cells after it are "future". */
  currentPeriod: string;
  /** 12 periods of the year. */
  periods: string[];
  rows: DuesMemberRow[];
  /** Collected per period, same order as `periods`. */
  totals: number[];
}

/** One group's view for a regular member: their own dues and donations. */
export interface MyFinanceGroup {
  groupId: number;
  groupName: string;
  currency: string;
  feeCents: number;
  exempt: boolean;
  year: number;
  currentPeriod: string;
  paidPeriods: string[];
  owedPeriods: string[];
  donatedCents: number;
  /** Group balance, only when leaders let members see the treasury. */
  balanceCents: number | null;
}

/** "YYYY-MM" of a "YYYY-MM-DD" date. */
export const periodOf = (date: string) => date.slice(0, 7);

/** All 12 periods of a year. */
export const yearPeriods = (year: number) =>
  Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

/** Adds `n` months to a "YYYY-MM" period. */
export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Parses a user-typed money amount ("5", "5,50", "1 234.5") into cents; null if invalid. */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[\s\u00a0']/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

/** Everything needed to build a year's report on the phone. */
export interface TreasuryExport {
  year: number;
  /** The period, local "YYYY-MM-DD" (inclusive). */
  from: string;
  to: string;
  /** Title of the period for file and sheet names (filled in on the phone). */
  label?: string;
  groupName: string;
  currency: string;
  /** Balance before the period started, and at the end of it (or now). */
  openingCents: number;
  closingCents: number;
  transactions: TransactionRow[];
}

/** Largest report file the bot will send (Telegram allows 50 MB; ours are small). */
export const DOCUMENT_MAX_BYTES = 8_000_000;
/** Largest picture the bot will send to a chat (Telegram's photo limit is 10 MB). */
export const IMAGE_SEND_MAX_BYTES = 9_000_000;
