import { z } from 'zod';
import type { PosterLook } from './api';
import { postDesignSchema, type PostDesign } from './posts';
import type { PersonRef, TransactionRow } from './finance';

/** Optional sections of an event, switched on when creating or later when editing. */
export interface EventFeatures {
  gallery: boolean;
  rsvp: boolean;
  duties: boolean;
  cost: boolean;
}

export type RsvpStatus = 'going' | 'not_going';

/** Telegram chat link: t.me / telegram.me, public username or invite link. */
export const chatUrlSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+/-]+$/, 'telegram link')
  .nullish()
  .transform((v) => v || null);

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const roleInputSchema = z.object({
  /** Existing role id to keep its assignees; omit for a new role. */
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(40),
  slots: z.number().int().min(1).max(50).default(1),
  userIds: z.array(z.number().int().positive()).max(50).default([]),
});
export type RoleInput = z.input<typeof roleInputSchema>;

const featuresSchema = z.object({
  gallery: z.boolean().default(false),
  rsvp: z.boolean().default(false),
  duties: z.boolean().default(false),
  cost: z.boolean().default(false),
});

export const createEventSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: optionalText(2000),
  /** Local date and time in the church time zone. */
  date,
  startTime: time,
  /** Optional end; may be on a later day (camps). */
  endDate: date.nullish(),
  endTime: time.nullish(),
  location: optionalText(120),
  coverMediaId: z.number().int().positive().nullish(),
  /** Cover design when there is no cover photo (same choices as posts). */
  design: postDesignSchema.nullish(),
  templateId: z.number().int().positive().nullish(),
  features: featuresSchema.default({ gallery: false, rsvp: false, duties: false, cost: false }),
  priceCents: z.number().int().min(0).max(10_000_000).nullish(),
  chatUrl: chatUrlSchema,
  roles: z.array(roleInputSchema).max(30).default([]),
});
export type CreateEventInput = z.input<typeof createEventSchema>;

export const updateEventSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  description: optionalText(2000).optional(),
  date: date.optional(),
  startTime: time.optional(),
  endDate: date.nullish(),
  endTime: time.nullish(),
  location: optionalText(120).optional(),
  coverMediaId: z.number().int().positive().nullable().optional(),
  design: postDesignSchema.nullable().optional(),
  templateId: z.number().int().positive().nullable().optional(),
  features: featuresSchema.partial().optional(),
  priceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  chatUrl: chatUrlSchema.optional(),
  status: z.enum(['scheduled', 'cancelled']).optional(),
  /** Show at the top of the main page for the whole church. */
  pinned: z.boolean().optional(),
});
export type UpdateEventInput = z.input<typeof updateEventSchema>;

export const setRolesSchema = z.object({ roles: z.array(roleInputSchema).max(30) });
export type SetRolesInput = z.input<typeof setRolesSchema>;

export const rsvpSchema = z.object({
  status: z.enum(['going', 'not_going']).nullable(),
  /** Leaders may answer for someone else (e.g. members without Telegram). */
  userId: z.number().int().positive().optional(),
});
export type RsvpInput = z.input<typeof rsvpSchema>;

export const addPhotoSchema = z.object({
  mediaIds: z.array(z.number().int().positive()).min(1).max(20),
});

export const eventPaymentSchema = z.object({
  userId: z.number().int().positive(),
  /** Defaults to the event price. */
  amountCents: z.number().int().positive().max(10_000_000).optional(),
});
export type EventPaymentInput = z.input<typeof eventPaymentSchema>;

export const eventExpenseSchema = z.object({
  amountCents: z.number().int().positive().max(10_000_000),
  note: optionalText(300),
  receiptMediaId: z.number().int().positive().nullish(),
});
export type EventExpenseInput = z.input<typeof eventExpenseSchema>;

export interface EventSummary {
  id: number;
  groupId: number;
  groupName: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  coverUrl: string | null;
  features: EventFeatures;
  priceCents: number | null;
  status: 'scheduled' | 'cancelled';
  goingCount: number;
  pinned: boolean;
  /** The ministry's colours, for cards shown outside it (pinned on the main page). */
  brandColor: string | null;
  design: PostDesign | null;
  templateId: number | null;
  /** The cover's look when there is no cover photo. */
  look: PosterLook | null;
  myRsvp: RsvpStatus | null;
  /** Duty names the requester is assigned to. */
  myRoles: string[];
}

export interface EventRole {
  id: number;
  name: string;
  slots: number;
  assignees: PersonRef[];
}

export interface EventFinance {
  priceCents: number | null;
  collectedCents: number;
  expenseCents: number;
  /** Paid per person (going people and anyone who paid). */
  people: { member: PersonRef; paidCents: number; going: boolean }[];
  payments: TransactionRow[];
  expenses: TransactionRow[];
}

export interface EventDetail extends EventSummary {
  description: string | null;
  chatUrl: string | null;
  coverMediaId: number | null;
  photos: { id: number; url: string }[];
  /** Filled when RSVP is on. `noAnswer` only for leaders. */
  rsvps: { going: PersonRef[]; notGoing: PersonRef[]; noAnswer: PersonRef[] };
  roles: EventRole[];
  /** Only for leaders, when cost tracking is on. */
  finance: EventFinance | null;
  /** What the requester has paid for this event. */
  myPaidCents: number;
  canManage: boolean;
  /** Belongs to the ministry (can answer RSVP); false when seeing a pinned event. */
  member: boolean;
}
