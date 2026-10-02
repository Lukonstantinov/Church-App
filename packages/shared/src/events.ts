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
  /** What this duty involves. */
  description: z.string().trim().max(600).nullish(),
  /** Who leads this duty; must be one of `userIds`. */
  leaderId: z.number().int().positive().nullish(),
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
  description: optionalText(4000),
  /** Local date and time in the church time zone. */
  date,
  startTime: time,
  /** Optional end; may be on a later day (camps). */
  endDate: date.nullish(),
  endTime: time.nullish(),
  location: optionalText(120),
  coverMediaId: z.number().int().positive().nullish(),
  /** The designed cover as a picture, made by the app (for the bot). */
  posterMediaId: z.number().int().positive().nullish(),
  /** Cover design when there is no cover photo (same choices as posts). */
  design: postDesignSchema.nullish(),
  templateId: z.number().int().positive().nullish(),
  /** Show a "🔥 N days left" countdown. */
  countdown: z.boolean().default(false),
  features: featuresSchema.default({ gallery: false, rsvp: false, duties: false, cost: false }),
  priceCents: z.number().int().min(0).max(10_000_000).nullish(),
  chatUrl: chatUrlSchema,
  roles: z.array(roleInputSchema).max(30).default([]),
  /** Tell the people given a duty (bot message naming it). */
  notifyAssigned: z.boolean().optional(),
});
export type CreateEventInput = z.input<typeof createEventSchema>;

export const updateEventSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  description: optionalText(4000).optional(),
  date: date.optional(),
  startTime: time.optional(),
  endDate: date.nullish(),
  endTime: time.nullish(),
  location: optionalText(120).optional(),
  coverMediaId: z.number().int().positive().nullable().optional(),
  posterMediaId: z.number().int().positive().nullable().optional(),
  design: postDesignSchema.nullable().optional(),
  templateId: z.number().int().positive().nullable().optional(),
  countdown: z.boolean().optional(),
  features: featuresSchema.partial().optional(),
  priceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  chatUrl: chatUrlSchema.optional(),
  status: z.enum(['scheduled', 'cancelled']).optional(),
  /** Show at the top of the main page for the whole church. */
  pinned: z.boolean().optional(),
});
export type UpdateEventInput = z.input<typeof updateEventSchema>;

export const setRolesSchema = z.object({
  roles: z.array(roleInputSchema).max(30),
  /** Tell the people newly given a duty (bot message naming it). */
  notify: z.boolean().optional(),
});
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
  countdown: boolean;
  createdAt: string;
  /** The cover's look when there is no cover photo. */
  look: PosterLook | null;
  myRsvp: RsvpStatus | null;
  /** Duty names the requester is assigned to. */
  myRoles: string[];
  /** The same duties with what each involves. */
  myDuties: { name: string; description: string | null }[];
}

export interface EventRole {
  id: number;
  name: string;
  description: string | null;
  /** The duty's leader, if one is marked. */
  leader: PersonRef | null;
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

/** A message in an event's in-app chat. */
export interface EventChatMessage {
  id: number;
  user: { id: number; firstName: string; lastName: string | null };
  text: string;
  createdAt: string;
  mine: boolean;
  /** The author, or someone who manages the event, may delete it. */
  canDelete: boolean;
}

export const eventChatMessageSchema = z.object({ text: z.string().trim().min(1).max(1000) });
export type EventChatMessageInput = z.input<typeof eventChatMessageSchema>;

export interface EventDetail extends EventSummary {
  /** A Telegram chat managed by the bot (title; pending = bot not yet an admin there). */
  managedChat: { title: string | null; pending: boolean } | null;
  description: string | null;
  chatUrl: string | null;
  coverMediaId: number | null;
  /** The picture the bot sends with event messages (poster, else cover photo); null = none. */
  botPictureUrl: string | null;
  photos: { id: number; url: string }[];
  /** Filled when RSVP is on. `noAnswer` only for leaders. */
  rsvps: { going: PersonRef[]; notGoing: PersonRef[]; noAnswer: PersonRef[] };
  roles: EventRole[];
  /** The timed programme of the event. */
  program: EventProgramItem[];
  /** Only for leaders, when cost tracking is on. */
  finance: EventFinance | null;
  /** What the requester has paid for this event. */
  myPaidCents: number;
  canManage: boolean;
  /** Belongs to the ministry (can answer RSVP); false when seeing a pinned event. */
  member: boolean;
}

/** Tell the people already assigned to duties (all of them, or one duty) what they serve in. */
export const notifyDutiesSchema = z.object({ roleId: z.number().int().positive().optional() });
export type NotifyDutiesInput = z.input<typeof notifyDutiesSchema>;

/** How a duty message went: how many were sent, and who it could not reach. */
export interface DutiesNotice {
  sent: number;
  skipped: string[];
}

// ---------- Programme ----------

export const programItemSchema = z.object({
  /** Day of the event, 0 = the first. */
  day: z.number().int().min(0).max(13).default(0),
  time,
  title: z.string().trim().min(1).max(80),
  /** Who leads this part. */
  userId: z.number().int().positive().nullish(),
  note: z.string().trim().max(200).nullish(),
});
export const setProgramSchema = z.object({ items: z.array(programItemSchema).max(60) });
export type SetProgramInput = z.input<typeof setProgramSchema>;

export interface EventProgramItem {
  id: number;
  day: number;
  time: string;
  title: string;
  person: PersonRef | null;
  note: string | null;
}
