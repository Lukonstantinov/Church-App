import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  INTL_LOCALE,
  addDays,
  displayName,
  messages,
  type BirthdayRow,
  type Locale,
} from '@church/shared';
import type { Db } from '../db/client';
import { groups, memberships, positions, users } from '../db/schema';
import { churchDefaultLocale, localeOf } from './church';
import { escapeHtml } from './html';

/**
 * People's birthdays: entered on a person's screen (by the person or whoever manages
 * them), marked in the ministry calendar for those who manage people, and sent to church
 * admins by the bot — a weekly list of the coming ones (`church_settings.birthday_report`),
 * a note on the day, and /birthdays on request.
 */

/** Everyone with a birthday who is active in one of `groupIds` (all ministries when omitted). */
export async function birthdayRows(db: Db, groupIds?: number[]): Promise<BirthdayRow[]> {
  if (groupIds && groupIds.length === 0) return [];
  // Pasted (made-up) people count like anyone else; the developer can ask for only them.
  const mockOnly =
    (await db.query.churchSettings.findFirst({ columns: { mockOnly: true } }))?.mockOnly ?? false;
  const rows = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      birthday: users.birthday,
      birthYear: users.birthYear,
      groupId: memberships.groupId,
      groupName: groups.name,
      position: positions.name,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .leftJoin(positions, eq(positions.id, memberships.positionId))
    .where(
      and(
        isNotNull(users.birthday),
        isNull(users.anonymizedAt),
        // The developer's test person is not a real person.
        isNull(users.testOf),
        mockOnly ? eq(users.isMock, true) : undefined,
        eq(memberships.status, 'active'),
        groupIds ? inArray(memberships.groupId, groupIds) : undefined,
      ),
    );
  const by = new Map<number, BirthdayRow>();
  for (const r of rows) {
    const row =
      by.get(r.userId) ??
      ({
        userId: r.userId,
        firstName: r.firstName,
        lastName: r.lastName,
        birthday: r.birthday!,
        birthYear: r.birthYear,
        roles: [],
      } satisfies BirthdayRow);
    if (r.position) row.roles.push(`${r.position} — ${r.groupName}`);
    by.set(r.userId, row);
  }
  return [...by.values()];
}

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The day a "MM-DD" birthday falls on in `year` (29 February is the 28th in other years). */
export function birthdayIn(mmdd: string, year: number): string {
  const day = mmdd === '02-29' && !leap(year) ? '02-28' : mmdd;
  return `${year}-${day}`;
}

export interface ComingBirthday extends BirthdayRow {
  /** The local date it falls on, "YYYY-MM-DD". */
  date: string;
  /** The age they turn, when the year is known. */
  turns: number | null;
}

/** Birthdays from `today` (a local "YYYY-MM-DD") for `days` days, soonest first. */
export function comingBirthdays(
  rows: BirthdayRow[],
  today: string,
  days: number,
): ComingBirthday[] {
  const last = addDays(today, days - 1);
  const year = Number(today.slice(0, 4));
  const out: ComingBirthday[] = [];
  for (const r of rows) {
    for (const y of [year, year + 1]) {
      const date = birthdayIn(r.birthday, y);
      if (date < today || date > last) continue;
      out.push({ ...r, date, turns: r.birthYear ? y - r.birthYear : null });
      break;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.firstName.localeCompare(b.firstName));
}

/** The bot's list of birthdays: a title, then one line per person with day, age and roles. */
export function birthdayMessage(locale: Locale, title: string, list: ComingBirthday[]): string {
  const t = messages(locale);
  const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const lines = list.map((b) => {
    const when = fmt.format(new Date(`${b.date}T12:00:00Z`));
    const age = b.turns ? ` · ${t.birthdays.turns(b.turns)}` : '';
    const roles = b.roles.length ? `\n   <i>${escapeHtml(b.roles.join(', '))}</i>` : '';
    return `🎂 <b>${escapeHtml(when)}</b> — ${escapeHtml(displayName(b))}${age}${roles}`;
  });
  return [`<b>${escapeHtml(title)}</b>`, '', ...(lines.length ? lines : [t.birthdays.none])].join(
    '\n',
  );
}

/**
 * People who joined through Telegram have no birthday in the app unless someone typed it.
 * Telegram gives a bot the birth date a person shows on their profile (only when their
 * privacy lets the bot see it), so a few people at a time are looked up and the date is
 * filled in — never over one already entered. Run just before the birthday lists go out,
 * and on demand from church settings.
 */
export async function syncTelegramBirthdays(
  db: Db,
  api: {
    getChat: (id: number) => Promise<{ birthdate?: { day: number; month: number; year?: number } }>;
  },
  limit = 200,
): Promise<{ checked: number; found: number }> {
  const rows = await db
    .select({ id: users.id, telegramId: users.telegramId })
    .from(users)
    .where(
      and(
        isNotNull(users.telegramId),
        isNull(users.birthday),
        isNull(users.anonymizedAt),
        isNull(users.testOf),
        eq(users.isMock, false),
      ),
    )
    .orderBy(users.id);
  let found = 0;
  let tried = 0;
  for (const r of rows) {
    if (tried >= limit) break;
    tried++;
    try {
      const b = (await api.getChat(r.telegramId!)).birthdate;
      if (!b) continue;
      const mm = String(b.month).padStart(2, '0');
      const dd = String(b.day).padStart(2, '0');
      await db
        .update(users)
        .set({ birthday: `${mm}-${dd}`, birthYear: b.year ?? null })
        .where(and(eq(users.id, r.id), isNull(users.birthday)));
      found++;
    } catch {
      // Not reachable, or Telegram says no: leave the person as they are.
    }
  }
  return { checked: tried, found };
}

/** The church admins the bot can write to. */
export async function adminRecipients(db: Db) {
  const fallback = await churchDefaultLocale(db);
  const rows = await db
    .select({ userId: users.id, chatId: users.telegramId, locale: users.locale })
    .from(users)
    .where(
      and(
        eq(users.isAdmin, true),
        isNotNull(users.telegramId),
        eq(users.isReachable, true),
        isNull(users.testOf),
      ),
    );
  return rows.flatMap((r) =>
    r.chatId === null
      ? []
      : [{ userId: r.userId, chatId: r.chatId, locale: localeOf(r, fallback) }],
  );
}
